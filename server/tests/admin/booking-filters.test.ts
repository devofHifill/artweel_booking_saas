import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';

/**
 * The Bookings filter row.
 *
 * Five of these are columns and Prisma expresses them directly. The payment
 * one is not: `paidCents` is the sum of money-in payments net of refunds,
 * computed per booking, and no `where` clause can sum a relation — so it runs
 * as a raw query returning ids. These tests exist mostly to keep that one
 * honest, because it is the filter that can silently disagree with the pill
 * rendered beside every row.
 */

const app = createApp();

let studio: Studio;
let serviceId: string;
let otherServiceId: string;
let sessionId: string;
let otherSessionId: string;
let staffId: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function makeService(name: string) {
  const res = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name,
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMax: 20,
      priceCents: 9_500,
    })
    .expect(201);
  return res.body.service.id as string;
}

async function makeSession(serviceTypeId: string, day: string) {
  const { createSession } = await import('../../src/scheduling/session.service');
  const created = await createSession({
    organizationId: studio.organizationId,
    serviceTypeId,
    startsAt: new Date(`${day}T18:00:00Z`),
    endsAt: new Date(`${day}T20:00:00Z`),
    timezone: 'America/New_York',
    localStartTime: '14:00',
    capacity: 20,
  });
  return created.id;
}

/** A booking, optionally with money against it. */
async function book(opts: {
  email: string;
  sessionId: string;
  serviceTypeId: string;
  source?: string;
  paidCents?: number;
  totalCents?: number;
}) {
  const customer = await prisma.customer.create({
    data: {
      organizationId: studio.organizationId,
      name: opts.email,
      email: opts.email,
    },
  });

  const booking = await prisma.booking.create({
    data: {
      organizationId: studio.organizationId,
      customerId: customer.id,
      serviceTypeId: opts.serviceTypeId,
      sessionId: opts.sessionId,
      startsAt: new Date('2026-10-06T18:00:00Z'),
      endsAt: new Date('2026-10-06T20:00:00Z'),
      timezone: 'America/New_York',
      status: 'CONFIRMED',
      seats: 1,
      totalCents: opts.totalCents ?? 9_500,
      source: opts.source ?? 'web',
      cancelToken: Buffer.from(
        crypto.getRandomValues(new Uint8Array(32)),
      ),
    },
  });

  if (opts.paidCents) {
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        bookingId: booking.id,
        amountCents: opts.paidCents,
        refundedCents: 0,
        status: 'SUCCEEDED',
        currency: 'USD',
        // FULL when it settles the booking, DEPOSIT when it is a part payment
        // — which is the case the "part paid" filter exists for.
        kind:
          opts.paidCents >= (opts.totalCents ?? 9_500) ? 'FULL' : 'DEPOSIT',
      },
    });
  }

  return booking;
}

function list(query: string) {
  return request(app)
    .get(`${studio.base}/bookings?limit=200&${query}`)
    .set(studio.headers);
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });

  serviceId = await makeService('Beginner Wheel Throwing');
  otherServiceId = await makeService('Handbuilding Workshop');
  sessionId = await makeSession(serviceId, '2026-10-06');
  otherSessionId = await makeSession(otherServiceId, '2026-10-07');

  const staff = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name: 'Rowan Pike', email: 'rowan@clay.test' });
  staffId = staff.body.staff.id;
});

describe('filtering by what has been paid', () => {
  beforeEach(async () => {
    await book({ email: 'paid@t.test', sessionId, serviceTypeId: serviceId, paidCents: 9_500 });
    await book({ email: 'part@t.test', sessionId, serviceTypeId: serviceId, paidCents: 4_000 });
    await book({ email: 'none@t.test', sessionId, serviceTypeId: serviceId });
  });

  it('separates paid, part paid and unpaid', async () => {
    const paid = await list('payment=paid').expect(200);
    const part = await list('payment=part').expect(200);
    const unpaid = await list('payment=unpaid').expect(200);

    expect(paid.body.bookings.map((b: never) => (b as { customer: { email: string } }).customer.email)).toEqual(['paid@t.test']);
    expect(part.body.bookings).toHaveLength(1);
    expect(part.body.bookings[0].customer.email).toBe('part@t.test');
    expect(unpaid.body.bookings).toHaveLength(1);
    expect(unpaid.body.bookings[0].customer.email).toBe('none@t.test');
  });

  it('agrees with the outstanding figure each row is rendered from', async () => {
    /*
      The filter and the pill must not disagree. If they did, a studio would
      filter to "unpaid" and read "Paid" beside every row — which is worse
      than having no filter, because it makes the screen untrustworthy.
    */
    for (const state of ['paid', 'part', 'unpaid'] as const) {
      const res = await list(`payment=${state}`).expect(200);

      for (const b of res.body.bookings as {
        totalCents: number;
        outstandingCents: number;
      }[]) {
        if (state === 'paid') expect(b.outstandingCents).toBe(0);
        if (state === 'unpaid') expect(b.outstandingCents).toBe(b.totalCents);
        if (state === 'part') {
          expect(b.outstandingCents).toBeGreaterThan(0);
          expect(b.outstandingCents).toBeLessThan(b.totalCents);
        }
      }
    }
  });

  it('treats a refunded payment as money no longer in', async () => {
    const booking = await book({
      email: 'refunded@t.test',
      sessionId,
      serviceTypeId: serviceId,
      paidCents: 9_500,
    });

    // Refunded in full: the row is owed the whole amount again.
    await prisma.payment.updateMany({
      where: { bookingId: booking.id },
      data: { refundedCents: 9_500, status: 'REFUNDED' },
    });

    const unpaid = await list('payment=unpaid').expect(200);
    const emails = unpaid.body.bookings.map(
      (b: { customer: { email: string } }) => b.customer.email,
    );

    expect(emails).toContain('refunded@t.test');
  });
});

describe('the other filters', () => {
  it('filters by activity', async () => {
    await book({ email: 'wheel@t.test', sessionId, serviceTypeId: serviceId });
    await book({
      email: 'hand@t.test',
      sessionId: otherSessionId,
      serviceTypeId: otherServiceId,
    });

    const res = await list(`serviceTypeId=${otherServiceId}`).expect(200);

    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.bookings[0].customer.email).toBe('hand@t.test');
  });

  it('filters by where the booking came from', async () => {
    await book({ email: 'page@t.test', sessionId, serviceTypeId: serviceId, source: 'web' });
    await book({ email: 'desk@t.test', sessionId, serviceTypeId: serviceId, source: 'admin' });
    await book({ email: 'widget@t.test', sessionId, serviceTypeId: serviceId, source: 'embed' });

    const res = await list('source=admin').expect(200);

    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.bookings[0].customer.email).toBe('desk@t.test');
  });

  it('refuses a source that is not one of the three', async () => {
    await list('source=carrier-pigeon').expect(422);
  });

  it('finds a booking by the reference the customer reads out', async () => {
    const booking = await book({
      email: 'ref@t.test',
      sessionId,
      serviceTypeId: serviceId,
    });
    await book({ email: 'other@t.test', sessionId, serviceTypeId: serviceId });

    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: { reference: true },
    });

    // Lower case, as somebody would type it off a phone screen.
    const res = await list(`search=${row.reference!.toLowerCase()}`).expect(200);

    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.bookings[0].reference).toBe(row.reference);
  });

  it('still finds a booking by the customer name', async () => {
    await book({ email: 'searchable@t.test', sessionId, serviceTypeId: serviceId });

    const res = await list('search=searchable').expect(200);

    expect(res.body.bookings).toHaveLength(1);
  });

  it('combines filters rather than replacing one with the next', async () => {
    await book({
      email: 'both@t.test',
      sessionId,
      serviceTypeId: serviceId,
      source: 'admin',
      paidCents: 9_500,
    });
    await book({
      email: 'wrong-source@t.test',
      sessionId,
      serviceTypeId: serviceId,
      source: 'web',
      paidCents: 9_500,
    });
    await book({
      email: 'wrong-payment@t.test',
      sessionId,
      serviceTypeId: serviceId,
      source: 'admin',
    });

    const res = await list('source=admin&payment=paid').expect(200);

    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.bookings[0].customer.email).toBe('both@t.test');
  });

  it('leaves the status counts alone, which are the tabs', async () => {
    await book({ email: 'a@t.test', sessionId, serviceTypeId: serviceId, source: 'admin' });
    await book({ email: 'b@t.test', sessionId, serviceTypeId: serviceId, source: 'web' });

    /*
      Counts are taken with every filter EXCEPT status, so a source filter must
      narrow them too — otherwise the tabs advertise rows the list will not
      show.
    */
    const res = await list('source=admin').expect(200);

    expect(res.body.counts.total).toBe(1);
  });
});
