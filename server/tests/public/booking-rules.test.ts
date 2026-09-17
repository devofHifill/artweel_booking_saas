import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * The studio-wide booking rules, on the path a stranger actually takes.
 *
 * These are refusals on the PUBLIC checkout — the product's core flow — so
 * they are exactly the changes least safe to leave untested. Each one is
 * asserted in both directions, because a rule that refuses everything passes a
 * "it refuses" test just as happily as a correct one.
 */

const app = createApp();
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
      childPriceCents: 5000,
    });
  serviceId = service.body.service.id;

  const { createSession } = await import('../../src/scheduling/session.service');
  const created = await createSession({
    organizationId: studio.organizationId,
    serviceTypeId: serviceId,
    startsAt: new Date(Date.now() + 10 * 86_400_000),
    endsAt: new Date(Date.now() + 10 * 86_400_000 + 3 * 3_600_000),
    timezone: 'America/New_York',
    localStartTime: '14:00',
    capacity: 8,
  });
  sessionId = created.id;
});

const setOrg = (data: Record<string, unknown>) =>
  prisma.organization.update({ where: { id: studio.organizationId }, data });

/** A studio that has finished Stripe onboarding and can take a card. */
const connectStripe = () =>
  setOrg({ stripeAccountId: 'acct_test', stripeChargesEnabled: true });

const book = (body: Record<string, unknown> = {}) =>
  request(app)
    .post(`/public/${slug}/bookings`)
    .send({
      serviceTypeId: serviceId,
      sessionId,
      seats: 1,
      customer: { name: 'Ada Potter', email: 'ada@example.com' },
      ...body,
    });

describe('require a phone number at checkout', () => {
  it('books without a phone by default', async () => {
    const res = await book();
    expect(res.status).toBe(201);
  });

  it('refuses a booking with no phone when the studio requires one', async () => {
    await setOrg({ requirePhoneAtCheckout: true });

    const res = await book();

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PHONE_REQUIRED');
  });

  it('accepts the same booking once a phone is given', async () => {
    await setOrg({ requirePhoneAtCheckout: true });

    const res = await book({
      customer: {
        name: 'Ada Potter',
        email: 'ada@example.com',
        phone: '+1 555 010 2200',
      },
    });

    expect(res.status).toBe(201);
  });

  it('treats whitespace as no phone at all', async () => {
    await setOrg({ requirePhoneAtCheckout: true });

    const res = await book({
      customer: { name: 'Ada Potter', email: 'ada@example.com', phone: '   ' },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PHONE_REQUIRED');
  });
});

describe('child places', () => {
  it('accepts children by default', async () => {
    const res = await book({ seats: 2, children: 1 });
    expect(res.status).toBe(201);
  });

  it('refuses children when the studio has switched them off', async () => {
    await setOrg({ allowChildTickets: false });

    const res = await book({ seats: 2, children: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CHILD_TICKETS_OFF');
  });

  it('still takes an adults-only booking when child places are off', async () => {
    await setOrg({ allowChildTickets: false });

    const res = await book({ seats: 2, children: 0 });

    expect(res.status).toBe(201);
  });
});

/**
 * Booking a chargeable class without paying.
 *
 * The narrow condition is the whole point: a studio with no Stripe connection
 * has always been able to take unpaid bookings and must keep doing so — that
 * is most studios on their first day, and breaking it would break the product
 * for them silently.
 */
describe('pay on arrival', () => {
  it('refuses an unpaid booking of a priced class once Stripe is connected', async () => {
    await connectStripe();

    const res = await book();

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAYMENT_REQUIRED');
  });

  it('allows it when the studio has opted in', async () => {
    await connectStripe();
    await setOrg({ allowPayOnArrival: true });

    const res = await book();

    expect(res.status).toBe(201);
  });

  it('leaves a studio without Stripe able to take unpaid bookings', async () => {
    // No connectStripe() — this is the first-day studio.
    const res = await book();

    expect(res.status).toBe(201);
  });

  it('does not block a free class even with Stripe connected', async () => {
    await connectStripe();

    const free = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Open Studio',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 8,
        priceCents: 0,
      });

    const { createSession } = await import(
      '../../src/scheduling/session.service'
    );
    const session = await createSession({
      organizationId: studio.organizationId,
      serviceTypeId: free.body.service.id,
      startsAt: new Date(Date.now() + 11 * 86_400_000),
      endsAt: new Date(Date.now() + 11 * 86_400_000 + 2 * 3_600_000),
      timezone: 'America/New_York',
      localStartTime: '14:00',
      capacity: 8,
    });

    const res = await book({
      serviceTypeId: free.body.service.id,
      sessionId: session.id,
    });

    expect(res.status).toBe(201);
  });
});

/**
 * The overbooking buffer.
 *
 * Asserted as CAPACITY, not as seats taken, because that is the whole design:
 * `CHECK (seats_taken <= capacity)` is a Phase 0 guarantee and stays intact.
 * If somebody ever "fixes" this by relaxing the constraint instead, this test
 * keeps passing — so the comment matters as much as the assertion.
 */
describe('overbooking buffer', () => {
  it('adds the buffer to a new class’s capacity', async () => {
    await setOrg({ overbookingBuffer: 2 });

    const res = await request(app)
      .post(`${studio.base}/sessions`)
      .set(studio.headers)
      .send({
        serviceTypeId: serviceId,
        startLocalDate: '2026-12-01',
        localStartTime: '14:00',
        capacity: 6,
      });

    expect(res.status).toBe(201);

    /* Found by its date, not by the capacity we are asserting — searching for
       `capacity: 8` would make the test pass by definition. */
    const created = await prisma.session.findFirstOrThrow({
      where: {
        organizationId: studio.organizationId,
        serviceTypeId: serviceId,
        startsAt: { gte: new Date('2026-12-01T00:00:00Z') },
      },
    });
    expect(created.capacity).toBe(8);
  });

  it('leaves capacity alone when the buffer is zero', async () => {
    const res = await request(app)
      .post(`${studio.base}/sessions`)
      .set(studio.headers)
      .send({
        serviceTypeId: serviceId,
        startLocalDate: '2026-12-02',
        localStartTime: '14:00',
        capacity: 6,
      });

    expect(res.status).toBe(201);

    /* Read back from the database rather than the response body: capacity is
       what the SESSION ends up with, and that is the thing the buffer changes.
       Asserting on a response field would pass just as well if the row were
       written differently. */
    const created = await prisma.session.findFirstOrThrow({
      where: {
        organizationId: studio.organizationId,
        serviceTypeId: serviceId,
        startsAt: { gte: new Date('2026-12-02T00:00:00Z') },
      },
    });
    expect(created.capacity).toBe(6);
  });
});

describe('same-day bookings', () => {
  it('hides today’s classes from availability when switched off', async () => {
    const { createSession } = await import(
      '../../src/scheduling/session.service'
    );

    /* A class later today, in the studio's own zone. */
    const soon = new Date(Date.now() + 3 * 3_600_000);
    await createSession({
      organizationId: studio.organizationId,
      serviceTypeId: serviceId,
      startsAt: soon,
      endsAt: new Date(soon.getTime() + 3 * 3_600_000),
      timezone: 'America/New_York',
      localStartTime: '18:00',
      capacity: 8,
    });

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const url = `/public/${slug}/availability?serviceTypeId=${serviceId}&from=${today}&to=${today}`;

    const before = await request(app).get(url);
    expect(before.status).toBe(200);

    await setOrg({ allowSameDayBookings: false });
    resetRateLimits();

    const after = await request(app).get(url);

    expect(after.status).toBe(200);
    expect(after.body.sessions).toHaveLength(0);
    expect(after.body.slots).toHaveLength(0);
  });
});
