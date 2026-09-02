import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * G1 — the booking page reaches checkout.
 *
 * `startCheckout` and the deposit split have existed since Phase 2 and the
 * booking page never called either: every booking taken through it was created
 * unpaid, whatever the studio had priced or configured. These cover the seam,
 * and particularly the branch that is NOT the happy path — a studio that has
 * priced its classes but not finished Stripe onboarding must still be able to
 * take a booking, exactly as it could before.
 */

const app = createApp();
let studio: Studio;
let slug: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: studio.organizationId },
  });
  slug = org.slug;
});

async function makeClass(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Beginner Wheel Throwing',
      bookingMode: 'EVENT',
      durationMinutes: 180,
      capacityMax: 8,
      priceCents: 9500,
      ...overrides,
    });
  return res.body.service;
}

async function makeSession(serviceTypeId: string, capacity = 8) {
  const { createSession } = await import('../../src/scheduling/session.service');
  return createSession({
    organizationId: studio.organizationId,
    serviceTypeId,
    startsAt: new Date('2026-09-15T18:00:00Z'),
    endsAt: new Date('2026-09-15T21:00:00Z'),
    timezone: 'America/New_York',
    localStartTime: '14:00',
    capacity,
  });
}

/** What Stripe onboarding leaves behind when it finishes. */
function connectStripe() {
  return prisma.organization.update({
    where: { id: studio.organizationId },
    data: {
      stripeAccountId: `acct_${studio.organizationId.slice(0, 8)}`,
      stripeChargesEnabled: true,
    },
  });
}

function quote(body: Record<string, unknown>) {
  return request(app).post(`/public/${slug}/quote`).send(body);
}

describe('the price a customer is shown', () => {
  it('splits a deposit into due now and the balance', async () => {
    const service = await makeClass({ depositType: 'percent', depositValue: 50 });
    await connectStripe();

    const res = await quote({ serviceTypeId: service.id, seats: 2 }).expect(200);

    expect(res.body.subtotalCents).toBe(19_000);
    expect(res.body.totalCents).toBe(19_000);
    expect(res.body.dueNowCents).toBe(9_500);
    expect(res.body.balanceCents).toBe(9_500);
    expect(res.body.kind).toBe('DEPOSIT');
    expect(res.body.willCharge).toBe(true);
  });

  it('charges in full when no deposit is configured', async () => {
    /*
      The trap this pins down: depositType 'none' does NOT mean "no payment".
      `depositFor` returns the whole total for it — no deposit configured means
      payment in full at booking. Reading it the other way would have shipped a
      page that never asked anybody for money.
    */
    const service = await makeClass();
    await connectStripe();

    const res = await quote({ serviceTypeId: service.id, seats: 1 }).expect(200);

    expect(res.body.dueNowCents).toBe(9_500);
    expect(res.body.balanceCents).toBe(0);
    expect(res.body.kind).toBe('FULL');
    expect(res.body.willCharge).toBe(true);
  });

  it('charges a mobile travel fee once, not once per seat', async () => {
    const service = await makeClass();
    await connectStripe();

    const res = await quote({
      serviceTypeId: service.id,
      seats: 4,
      travelFeeCents: 2_500,
    }).expect(200);

    expect(res.body.subtotalCents).toBe(38_000);
    expect(res.body.travelFeeCents).toBe(2_500);
    expect(res.body.totalCents).toBe(40_500);
  });

  it('says it will not charge when the studio has no Stripe account', async () => {
    // Priced, but onboarding unfinished — which is every studio on day one.
    const service = await makeClass();

    const res = await quote({ serviceTypeId: service.id, seats: 1 }).expect(200);

    expect(res.body.requiresPayment).toBe(true);
    expect(res.body.willCharge).toBe(false);
  });

  it('says it will not charge for a free class', async () => {
    const service = await makeClass({ priceCents: 0 });
    await connectStripe();

    const res = await quote({ serviceTypeId: service.id, seats: 1 }).expect(200);

    expect(res.body.totalCents).toBe(0);
    expect(res.body.requiresPayment).toBe(false);
    expect(res.body.willCharge).toBe(false);
  });

  it('never publishes the studio Stripe account id', async () => {
    await makeClass();
    const org = await connectStripe();

    const res = await request(app).get(`/public/${slug}`).expect(200);

    // The page must say WHETHER it can charge, never WHERE the money lands.
    expect(res.text).toContain('"acceptsPayment":true');
    expect(res.text).not.toContain(org.stripeAccountId!);
    expect(res.text).not.toContain('stripeAccountId');
  });
});

describe('a studio that cannot take payment yet', () => {
  it('still books, exactly as it did before G1', async () => {
    const service = await makeClass();
    const session = await makeSession(service.id);

    const res = await request(app)
      .post(`/public/${slug}/bookings`)
      .send({
        serviceTypeId: service.id,
        sessionId: session.id,
        seats: 1,
        customer: { name: 'Nell Carver', email: 'nell@example.test' },
      })
      .expect(201);

    expect(res.body.booking.seats).toBe(1);
    expect(res.body.manageToken).toBeTruthy();
  });

  it('refuses checkout rather than pretending it worked', async () => {
    const service = await makeClass();
    const session = await makeSession(service.id);

    const res = await request(app)
      .post(`/public/${slug}/checkout`)
      .send({
        serviceTypeId: service.id,
        sessionId: session.id,
        seats: 1,
        customer: { name: 'Nell Carver', email: 'nell@example.test' },
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENTS_NOT_ENABLED');

    // And nothing was held on the way out.
    expect(await prisma.bookingHold.count()).toBe(0);
  });
});

describe('checkout, once Stripe is connected', () => {
  it('holds the seats before sending anybody to pay', async () => {
    const service = await makeClass({ depositType: 'percent', depositValue: 50 });
    const session = await makeSession(service.id);
    await connectStripe();

    const res = await request(app)
      .post(`/public/${slug}/checkout`)
      .send({
        serviceTypeId: service.id,
        sessionId: session.id,
        seats: 2,
        customer: { name: 'Nell Carver', email: 'nell@example.test' },
      })
      .expect(201);

    expect(res.body.checkoutUrl).toBeTruthy();
    /*
      ORDER MATTERS, and this is the assertion that keeps it. The hold exists
      before the customer has seen a card field; reversing it lets somebody
      take the last seat while they are typing, and the failure lands after
      they have paid instead of before they started.
    */
    const hold = await prisma.bookingHold.findFirstOrThrow();
    expect(hold.seats).toBe(2);

    // The deposit, not the total.
    expect(res.body.price.dueNowCents).toBe(9_500);
  });

  it('ignores a price supplied by the caller', async () => {
    const service = await makeClass();
    const session = await makeSession(service.id);
    await connectStripe();

    const res = await request(app)
      .post(`/public/${slug}/checkout`)
      .send({
        serviceTypeId: service.id,
        sessionId: session.id,
        seats: 1,
        customer: { name: 'Cheap Skate', email: 'cheap@example.test' },
        // There is no amount field on this endpoint. Sending one must not
        // create one.
        priceCents: 1,
        totalCents: 1,
      })
      .expect(201);

    expect(res.body.price.totalCents).toBe(9_500);
  });
});
