import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { FakePaymentProvider } from '../../src/modules/payments/fake.provider';
import { setPaymentProvider } from '../../src/modules/payments/provider.registry';
import {
  CHECKOUT_HOLD_GRACE_MINUTES,
  handleWebhook,
} from '../../src/modules/payments/payment.service';

/**
 * The paid booking path, end to end.
 *
 * These cases are the reason the provider sits behind an interface. Real
 * Stripe cannot be asked to deliver the same webhook twice on demand, or to
 * deliver it before the browser redirect, or to fail a signature check — and
 * those are precisely the paths where money and seats get lost.
 */

const app = createApp();
let provider: FakePaymentProvider;
let studio: Studio;
let slug: string;
let serviceId: string;
let sessionId: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  provider = new FakePaymentProvider();
  setPaymentProvider(provider);

  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: studio.organizationId },
  });
  slug = org.slug;

  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Beginner Wheel Throwing',
      bookingMode: 'EVENT',
      durationMinutes: 180,
      capacityMax: 8,
      priceCents: 9500,
    });
  serviceId = service.body.service.id;

  const { createSession } = await import('../../src/scheduling/session.service');
  const created = await createSession({
    organizationId: studio.organizationId,
    serviceTypeId: serviceId,
    startsAt: new Date('2026-09-15T18:00:00Z'),
    endsAt: new Date('2026-09-15T21:00:00Z'),
    timezone: 'America/New_York',
    localStartTime: '14:00',
    capacity: 8,
  });
  sessionId = created.id;
});

/** Puts the studio in a state where it can take money. */
async function enablePayments() {
  const connect = await request(app)
    .post(`${studio.base}/payments/connect`)
    .set(studio.headers);
  expect(connect.status).toBe(200);

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: studio.organizationId },
  });
  provider.completeOnboarding(org.stripeAccountId!);

  await request(app).post(`${studio.base}/payments/refresh`).set(studio.headers);
  return org.stripeAccountId!;
}

async function startCheckout(seats = 1, email = 'ada@student.test') {
  return request(app)
    .post(`/public/${slug}/checkout`)
    .send({
      serviceTypeId: serviceId,
      sessionId,
      seats,
      customer: { name: 'Ada Potter', email },
    });
}

/**
 * Posts a webhook the way Stripe would, signature and all.
 *
 * The body is sent as a STRING, not a Buffer. Supertest serialises a Buffer
 * under a JSON content type into `{"type":"Buffer","data":[...]}`, so the
 * bytes signed would not be the bytes received and every signature check
 * would fail for the wrong reason.
 */
async function deliverWebhook(event: unknown) {
  const raw = JSON.stringify(event);
  return request(app)
    .post('/webhooks/stripe')
    .set('stripe-signature', provider.sign(Buffer.from(raw, 'utf8')))
    .set('Content-Type', 'application/json')
    .send(raw);
}

describe('connect onboarding', () => {
  it('will not take payments until Stripe says the account is ready', async () => {
    // An account can exist, look finished, and still be unable to charge.
    // chargesEnabled is Stripe's verdict, not ours.
    await request(app).post(`${studio.base}/payments/connect`).set(studio.headers);

    const res = await startCheckout();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENTS_NOT_ENABLED');
  });

  it('reports readiness once onboarding completes', async () => {
    await enablePayments();

    const status = await request(app)
      .get(`${studio.base}/payments/status`)
      .set(studio.headers);

    expect(status.body.connected).toBe(true);
    expect(status.body.chargesEnabled).toBe(true);
  });

  it('restricts connecting an account to owners and admins', async () => {
    const { addMemberToStudio } = await import('../helpers/api');
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    const res = await request(app)
      .post(`${studio.base}/payments/connect`)
      .set(instructor.headers);

    expect(res.status).toBe(403);
  });
});

describe('checkout', () => {
  it('holds the seats before sending anyone to Stripe', async () => {
    // Reversed, a customer can be three fields into their card details when
    // somebody else takes the last seat.
    await enablePayments();

    const res = await startCheckout(2);

    expect(res.status).toBe(201);
    expect(res.body.checkoutUrl).toContain('checkout.stripe.test');

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(2);

    // No booking yet — that only exists once the money does.
    expect(await prisma.booking.count()).toBe(0);
  });

  it('holds the seats at least as long as Stripe will keep a checkout open', async () => {
    // Stripe refuses a session expiring under 30 minutes away. With the
    // studio's 15-minute default every paid booking on live failed with a 500.
    await enablePayments();
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { seatHoldMinutes: 15 },
    });

    const res = await startCheckout(1);

    expect(res.status).toBe(201);
    const checkoutExpires = new Date(res.body.expiresAt).getTime();
    expect(checkoutExpires).toBeGreaterThanOrEqual(Date.now() + 30 * 60_000);

    // And the session still never outlives the hold it pays for.
    const hold = await prisma.bookingHold.findFirstOrThrow({
      where: { organizationId: studio.organizationId },
    });
    expect(hold.expiresAt.getTime()).toBeGreaterThanOrEqual(checkoutExpires);
  });

  it('computes the amount server-side and ignores anything sent', async () => {
    await enablePayments();

    const res = await request(app)
      .post(`/public/${slug}/checkout`)
      .send({
        serviceTypeId: serviceId,
        sessionId,
        seats: 2,
        customer: { name: 'Mallory', email: 'm@x.test' },
        // Not in the schema, so stripped before anything reads it.
        amountCents: 1,
        totalCents: 1,
        priceCents: 1,
      });

    expect(res.status).toBe(201);
    expect(res.body.price.totalCents).toBe(19_000);

    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.amountCents).toBe(19_000);
  });

  it('takes only the deposit when the service asks for one', async () => {
    await enablePayments();
    await request(app)
      .patch(`${studio.base}/services/${serviceId}`)
      .set(studio.headers)
      .send({ depositType: 'percent', depositValue: 25 });

    const res = await startCheckout(2);

    expect(res.body.price.totalCents).toBe(19_000);
    expect(res.body.price.dueNowCents).toBe(4750);
    expect(res.body.price.balanceCents).toBe(14_250);

    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.kind).toBe('DEPOSIT');
    expect(payment.amountCents).toBe(4750);
  });

  it('gives the seats straight back if Stripe refuses', async () => {
    await enablePayments();

    // Make session creation fail.
    provider.createCheckoutSession = async () => {
      throw new Error('Stripe is having a bad day');
    };

    await startCheckout(3).catch(() => undefined);

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    // Otherwise three seats sit reserved for ten minutes for a checkout that
    // will never exist.
    expect(session.seatsTaken).toBe(0);
  });

  it('refuses to hold seats that are already gone', async () => {
    await enablePayments();

    const { bookSeats } = await import('../../src/scheduling/booking.service');
    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Filler',
        email: 'filler@x.test',
      },
    });
    await bookSeats({
      organizationId: studio.organizationId,
      sessionId,
      customerId: customer.id,
      seats: 8,
    });

    const res = await startCheckout(1);
    expect(res.status).toBe(409);
  });
});

describe('the payment webhook', () => {
  it('creates the booking, not the browser redirect', async () => {
    // A customer who pays and immediately closes the tab must still be booked.
    await enablePayments();
    const checkout = await startCheckout(2);

    const sessionId2 = (
      await prisma.payment.findFirstOrThrow({})
    ).providerCheckoutSessionId!;

    const res = await deliverWebhook(provider.payCheckout(sessionId2));
    expect(res.status).toBe(200);

    const booking = await prisma.booking.findFirstOrThrow({});
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.seats).toBe(2);
    expect(booking.totalCents).toBe(19_000);

    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.status).toBe('SUCCEEDED');
    expect(payment.bookingId).toBe(booking.id);
    expect(payment.providerPaymentIntentId).toMatch(/^pi_/);

    expect(checkout.status).toBe(201);
  });

  it('does not double-count seats when the hold converts', async () => {
    // The hold already owns the seats. Incrementing again on conversion
    // silently halves the class.
    await enablePayments();
    await startCheckout(3);

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;
    await deliverWebhook(provider.payCheckout(csid));

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(3);
  });

  it('ignores a redelivered webhook', async () => {
    // Stripe retries until it gets a 2xx and does not promise single delivery.
    await enablePayments();
    await startCheckout(1);

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;
    const event = provider.payCheckout(csid);

    const first = await deliverWebhook(event);
    const second = await deliverWebhook(event);
    const third = await deliverWebhook(event);

    expect(first.status).toBe(200);
    // A duplicate must still be 200, or Stripe retries it forever.
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);

    expect(await prisma.booking.count()).toBe(1);
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(1);
  });

  it('rejects an unsigned webhook', async () => {
    // Otherwise anyone who knows the URL can assert that somebody paid.
    await enablePayments();
    await startCheckout(1);

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;
    const raw = JSON.stringify(provider.payCheckout(csid));

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(raw);

    expect(res.status).toBe(401);
    expect(await prisma.booking.count()).toBe(0);
  });

  it('rejects a webhook with a forged signature', async () => {
    await enablePayments();
    await startCheckout(1);

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;
    const raw = JSON.stringify(provider.payCheckout(csid));

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .set('Content-Type', 'application/json')
      .send(raw);

    expect(res.status).toBe(401);
    expect(await prisma.booking.count()).toBe(0);
  });

  it('rejects a body that has been tampered with after signing', async () => {
    // The signature covers the exact bytes. This is what would break if the
    // JSON parser ran before the webhook route.
    await enablePayments();
    await startCheckout(1);

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;
    const event = provider.payCheckout(csid);
    const signature = provider.sign(Buffer.from(JSON.stringify(event), 'utf8'));

    const tampered = JSON.stringify({
      ...event,
      data: { ...event.data, amount_total: 1 },
    });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(tampered);

    expect(res.status).toBe(401);
  });

  it('releases the seats when checkout expires', async () => {
    await enablePayments();
    await startCheckout(4);

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;

    await deliverWebhook(provider.expireCheckout(csid));

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(0);

    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.status).toBe('CANCELLED');
    expect(await prisma.booking.count()).toBe(0);
  });

  it('mirrors account.updated so a suspended studio stops taking money', async () => {
    const accountId = await enablePayments();

    await handleWebhook({
      id: 'evt_account_1',
      type: 'account.updated',
      accountId,
      data: { id: accountId, charges_enabled: false, payouts_enabled: false },
    });

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
    });
    expect(org.stripeChargesEnabled).toBe(false);

    const res = await startCheckout();
    expect(res.status).toBe(409);
  });
});

/*
  Launch review 2026-11-25 (docs/LAUNCH-REVIEW-TRACKER.md, RV-01 to RV-04).
  Every case here used to end with a customer's money kept and no place given,
  or a place given for less than it costs.
*/
describe('money is never kept without a place', () => {
  async function pendingCheckoutId() {
    return (await prisma.payment.findFirstOrThrow({})).providerCheckoutSessionId!;
  }

  async function seatsTaken() {
    return (await prisma.session.findUniqueOrThrow({ where: { id: sessionId } }))
      .seatsTaken;
  }

  it('runs a redelivery when the first attempt failed, which wrote nothing', async () => {
    // RV-01. The first delivery answered 500, and every retry Stripe then sent
    // was waved through as a duplicate: charged, never booked.
    await enablePayments();
    await startCheckout(2);
    const event = provider.payCheckout(await pendingCheckoutId());

    // The same event failing part-way through the conversion — a total the
    // database refuses, standing in for any fault inside it.
    const metadata = event.data.metadata as Record<string, string>;
    const failing = {
      ...event,
      data: { ...event.data, metadata: { ...metadata, totalCents: 'not-a-number' } },
    };
    expect((await deliverWebhook(failing)).status).toBe(500);

    // All or nothing: no booking, the hold still live, the payment pending.
    expect(await prisma.booking.count()).toBe(0);
    expect((await prisma.bookingHold.findFirstOrThrow({})).releasedAt).toBeNull();
    expect((await prisma.payment.findFirstOrThrow({})).status).toBe('PENDING');

    // Stripe's retry of the same event now runs to the end.
    expect((await deliverWebhook(event)).status).toBe(200);

    const booking = await prisma.booking.findFirstOrThrow({});
    expect(booking.seats).toBe(2);
    expect(booking.totalCents).toBe(19_000);
    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.status).toBe('SUCCEEDED');
    expect(payment.bookingId).toBe(booking.id);
    expect(await seatsTaken()).toBe(2);

    const logged = await prisma.webhookEvent.findFirstOrThrow({
      where: { eventId: event.id },
    });
    expect(logged.processedAt).not.toBeNull();
    expect(logged.error).toBeNull();

    // Once it has run, it is a duplicate like any other.
    expect((await deliverWebhook(event)).status).toBe(200);
    expect(await prisma.booking.count()).toBe(1);
  });

  it('asks Stripe to come back when another delivery of the event is mid-run', async () => {
    await enablePayments();
    await startCheckout(1);
    const event = provider.payCheckout(await pendingCheckoutId());

    // Recorded, neither finished nor failed: another delivery is running it.
    await prisma.webhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: event.id,
        eventType: event.type,
        payload: event.data as object,
      },
    });

    // Not 200: that would promise an outcome nobody knows yet.
    const res = await deliverWebhook(event);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('WEBHOOK_IN_PROGRESS');
    expect(await prisma.booking.count()).toBe(0);
  });

  it('takes over an event whose processing died part-way', async () => {
    await enablePayments();
    await startCheckout(1);
    const event = provider.payCheckout(await pendingCheckoutId());

    await prisma.webhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: event.id,
        eventType: event.type,
        payload: event.data as object,
        createdAt: new Date(Date.now() - 10 * 60_000),
      },
    });

    expect((await deliverWebhook(event)).status).toBe(200);
    expect(await prisma.booking.count()).toBe(1);
  });

  it('keeps the seats well past the end of the checkout, for a late webhook', async () => {
    // RV-03. The hold and the checkout used to end together, so a payment in
    // the last seconds met an expired hold when its webhook arrived.
    await enablePayments();
    const res = await startCheckout(1);

    const checkoutEnds = new Date(res.body.expiresAt).getTime();
    const hold = await prisma.bookingHold.findFirstOrThrow({});
    expect(hold.expiresAt.getTime()).toBeGreaterThanOrEqual(
      checkoutEnds + CHECKOUT_HOLD_GRACE_MINUTES * 60_000,
    );
  });

  it('books a payment that lands after the hold expired but before it was swept', async () => {
    // Unswept, the hold still owns its seats, and the customer has paid.
    await enablePayments();
    await startCheckout(1);
    await prisma.bookingHold.updateMany({
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    expect((await deliverWebhook(provider.payCheckout(await pendingCheckoutId()))).status).toBe(200);

    expect((await prisma.booking.findFirstOrThrow({})).status).toBe('CONFIRMED');
    expect(await seatsTaken()).toBe(1);
  });

  it('refunds in full when the seats went back before the payment arrived', async () => {
    await enablePayments();
    await startCheckout(2);
    const csid = await pendingCheckoutId();

    // The sweep got there first: the seats are back in the pool.
    const { releaseHold } = await import('../../src/scheduling/hold.service');
    const hold = await prisma.bookingHold.findFirstOrThrow({});
    await releaseHold(studio.organizationId, hold.id);

    const event = provider.payCheckout(csid);
    expect((await deliverWebhook(event)).status).toBe(200);

    expect(await prisma.booking.count()).toBe(0);
    expect(await seatsTaken()).toBe(0);
    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.status).toBe('REFUNDED');
    expect(payment.refundedCents).toBe(19_000);
    expect(provider.refundsIssued.map((r) => r.amountCents)).toEqual([19_000]);

    // Running it again (a fresh event for the same checkout) refunds nothing more.
    await handleWebhook({ ...event, id: `${event.id}_again` });
    expect(provider.refundsIssued).toHaveLength(1);
    expect(await prisma.refund.count()).toBe(1);
  });

  it('refuses a class date that belongs to a cheaper service', async () => {
    // RV-02. The service sets the price and the session gets the seat; paired
    // freely, a $5 option's id bought a seat in the $95 class.
    await enablePayments();
    const cheap = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Taster',
        bookingMode: 'EVENT',
        durationMinutes: 60,
        capacityMax: 8,
        priceCents: 500,
      });

    const res = await request(app)
      .post(`/public/${slug}/checkout`)
      .send({
        serviceTypeId: cheap.body.service.id,
        sessionId,
        seats: 1,
        customer: { name: 'Mallory', email: 'm@x.test' },
      });

    expect(res.status).toBe(404);
    expect(await prisma.bookingHold.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
    expect(await seatsTaken()).toBe(0);
  });

  it('refuses a free booking that names a free service but a paid class', async () => {
    await enablePayments();
    const free = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Open studio',
        bookingMode: 'EVENT',
        durationMinutes: 60,
        capacityMax: 8,
        priceCents: 0,
      });

    const res = await request(app)
      .post(`/public/${slug}/bookings`)
      .send({
        serviceTypeId: free.body.service.id,
        sessionId,
        seats: 1,
        customer: { name: 'Mallory', email: 'm@x.test' },
      });

    expect(res.status).toBe(404);
    expect(await prisma.booking.count()).toBe(0);
    expect(await seatsTaken()).toBe(0);
    // Refused before anything was written about the customer.
    expect(await prisma.customer.count({ where: { email: 'm@x.test' } })).toBe(0);
  });

  it('refuses paid checkout for a hidden service', async () => {
    await enablePayments();
    await prisma.serviceType.update({
      where: { id: serviceId },
      data: { isActive: false },
    });

    expect((await startCheckout(1)).status).toBe(404);
  });

  it('confirms a paid booking even where the old auto-confirm setting was switched off', async () => {
    // RV-08. The setting never worked and is gone; a studio that had switched
    // it off still gets every paid booking confirmed, as it always did.
    await enablePayments();
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { autoConfirmOnPayment: false },
    });
    await startCheckout(1);

    await deliverWebhook(provider.payCheckout(await pendingCheckoutId()));

    expect((await prisma.booking.findFirstOrThrow({})).status).toBe('CONFIRMED');

    // And it can no longer be set through the API.
    await request(app)
      .patch(studio.base)
      .set(studio.headers)
      .send({ autoConfirmOnPayment: true });
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
    });
    expect(org.autoConfirmOnPayment).toBe(false);
  });

  it('refuses paid checkout at a studio that is not taking bookings', async () => {
    // RV-04. A trial that ended, an unpaid plan, a suspension: free bookings
    // were refused and paid ones went through.
    await enablePayments();
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { subscriptionStatus: 'SUSPENDED' },
    });

    const res = await startCheckout(1);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STUDIO_INACTIVE');
    expect(await prisma.bookingHold.count()).toBe(0);
  });
});

/* FB-15: the phone typed on a paid booking stopped at the route. */
describe('the customer phone on a paid booking', () => {
  async function payWithPhone(phone?: string) {
    await request(app)
      .post(`/public/${slug}/checkout`)
      .send({
        serviceTypeId: serviceId,
        sessionId,
        seats: 1,
        customer: { name: 'Ada Potter', email: 'ada@student.test', ...(phone ? { phone } : {}) },
      });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    await deliverWebhook(provider.payCheckout(payment.providerCheckoutSessionId!));
    return prisma.customer.findFirstOrThrow({
      where: { organizationId: studio.organizationId, email: 'ada@student.test' },
    });
  }

  it('keeps the phone on the customer the webhook creates', async () => {
    await enablePayments();
    const customer = await payWithPhone('+1 555 010 2200');
    expect(customer.phone).toBe('+1 555 010 2200');
  });

  it('updates a returning customer with a new phone, and keeps it when none is given', async () => {
    await enablePayments();
    await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        email: 'ada@student.test',
        name: 'Ada Potter',
        phone: '+1 555 000 0000',
      },
    });

    expect((await payWithPhone()).phone).toBe('+1 555 000 0000');
    expect((await payWithPhone('+1 555 010 2200')).phone).toBe('+1 555 010 2200');
  });
});

describe('refunds', () => {
  async function paidBooking(seats = 2) {
    await enablePayments();
    await startCheckout(seats);

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;
    await deliverWebhook(provider.payCheckout(csid));

    return prisma.booking.findFirstOrThrow({});
  }

  async function setPolicy() {
    const policy = await request(app)
      .post(`${studio.base}/cancellation-policies`)
      .set(studio.headers)
      .send({
        name: 'Standard',
        isDefault: true,
        tiers: [
          { hoursBefore: 48, refundPercent: 100 },
          { hoursBefore: 24, refundPercent: 50 },
          { hoursBefore: 0, refundPercent: 0 },
        ],
      });
    return policy.body.policy.id;
  }

  it('refunds in full when the policy says so', async () => {
    await setPolicy();
    const booking = await paidBooking(2);

    const res = await request(app)
      .post(`${studio.base}/payments/bookings/${booking.id}/refund`)
      .set(studio.headers)
      .send({ hoursOfNotice: 72 });

    expect(res.status).toBe(200);
    expect(res.body.refundedCents).toBe(19_000);
    expect(provider.refundsIssued[0]!.amountCents).toBe(19_000);

    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.status).toBe('REFUNDED');
    expect(payment.refundedCents).toBe(19_000);
  });

  it('refunds partially when the policy says so', async () => {
    await setPolicy();
    const booking = await paidBooking(2);

    const res = await request(app)
      .post(`${studio.base}/payments/bookings/${booking.id}/refund`)
      .set(studio.headers)
      .send({ hoursOfNotice: 30 });

    expect(res.body.refundedCents).toBe(9500);
    expect(res.body).not.toHaveProperty('creditCents');

    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.status).toBe('PARTIALLY_REFUNDED');
  });

  it('refunds everything with inFull, whatever the policy says', async () => {
    // The Payments screen's "Refund in full": a goodwill refund.
    await setPolicy();
    const booking = await paidBooking(2);

    const res = await request(app)
      .post(`${studio.base}/payments/bookings/${booking.id}/refund`)
      .set(studio.headers)
      .send({ hoursOfNotice: 2, inFull: true });

    expect(res.body.refundedCents).toBe(19_000);
    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.status).toBe('REFUNDED');

    // The booking itself is left alone.
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe(booking.status);
  });

  it('refunds the rest after a partial refund, as a second Stripe refund', async () => {
    // Both refunds once shared one idempotency key, which Stripe refuses for
    // a different amount, so the rest could never be given back.
    await setPolicy();
    const booking = await paidBooking(2);

    await request(app)
      .post(`${studio.base}/payments/bookings/${booking.id}/refund`)
      .set(studio.headers)
      .send({ hoursOfNotice: 30 });

    const rest = await request(app)
      .post(`${studio.base}/payments/bookings/${booking.id}/refund`)
      .set(studio.headers)
      .send({ inFull: true });

    expect(rest.status).toBe(200);
    expect(rest.body.refundedCents).toBe(9500);
    expect(provider.refundsIssued.map((r) => r.amountCents)).toEqual([9500, 9500]);

    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.status).toBe('REFUNDED');
    expect(payment.refundedCents).toBe(19_000);
  });

  it('refunds in full when the studio cancels with refundInFull', async () => {
    // The studio calling it off: no late-cancellation terms against itself.
    await setPolicy();
    const booking = await paidBooking(2);
    await prisma.booking.update({
      where: { id: booking.id },
      // Two hours away: inside the policy's nothing-back band.
      data: {
        startsAt: new Date(Date.now() + 2 * 3_600_000),
        endsAt: new Date(Date.now() + 5 * 3_600_000),
      },
    });

    const res = await request(app)
      .post(`${studio.base}/bookings/${booking.id}/cancel`)
      .set(studio.headers)
      .send({ refundInFull: true });

    expect(res.status).toBe(200);
    expect(res.body.refundedCents).toBe(19_000);
  });

  it('applies the policy when the studio cancels without it', async () => {
    await setPolicy();
    const booking = await paidBooking(2);
    await prisma.booking.update({
      where: { id: booking.id },
      // Two hours away: inside the policy's nothing-back band.
      data: {
        startsAt: new Date(Date.now() + 2 * 3_600_000),
        endsAt: new Date(Date.now() + 5 * 3_600_000),
      },
    });

    const res = await request(app)
      .post(`${studio.base}/bookings/${booking.id}/cancel`)
      .set(studio.headers)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.refundedCents).toBe(0);
  });

  it('refunds nothing for a late cancellation', async () => {
    await setPolicy();
    const booking = await paidBooking(1);

    const res = await request(app)
      .post(`${studio.base}/payments/bookings/${booking.id}/refund`)
      .set(studio.headers)
      .send({ hoursOfNotice: 2 });

    expect(res.body.refundedCents).toBe(0);
    expect(provider.refundsIssued).toHaveLength(0);
  });

  it('does not refund the same money twice', async () => {
    // A double-clicked refund button, or a retried request.
    await setPolicy();
    const booking = await paidBooking(1);

    await request(app)
      .post(`${studio.base}/payments/bookings/${booking.id}/refund`)
      .set(studio.headers)
      .send({ hoursOfNotice: 72 });

    const second = await request(app)
      .post(`${studio.base}/payments/bookings/${booking.id}/refund`)
      .set(studio.headers)
      .send({ hoursOfNotice: 72 });

    expect(second.body.refundedCents).toBe(0);

    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.refundedCents).toBe(9500);
  });

  it('refuses to refund another studio booking', async () => {
    await setPolicy();
    const booking = await paidBooking(1);

    const other = await signUpStudio(app);
    const res = await request(app)
      .post(`${other.base}/payments/bookings/${booking.id}/refund`)
      .set(other.headers)
      .send({ hoursOfNotice: 72 });

    expect(res.status).toBe(404);
    expect(provider.refundsIssued).toHaveLength(0);
  });
});
