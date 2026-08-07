import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { FakePaymentProvider } from '../../src/modules/payments/fake.provider';
import { setPaymentProvider } from '../../src/modules/payments/provider.registry';
import { handleWebhook } from '../../src/modules/payments/payment.service';

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
          { hoursBefore: 24, refundPercent: 50, creditPercent: 50 },
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

  it('refunds partially and records the credit the policy grants instead', async () => {
    await setPolicy();
    const booking = await paidBooking(2);

    const res = await request(app)
      .post(`${studio.base}/payments/bookings/${booking.id}/refund`)
      .set(studio.headers)
      .send({ hoursOfNotice: 30 });

    expect(res.body.refundedCents).toBe(9500);
    expect(res.body.creditCents).toBe(9500);

    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.status).toBe('PARTIALLY_REFUNDED');
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
