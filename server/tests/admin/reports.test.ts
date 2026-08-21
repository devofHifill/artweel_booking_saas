import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';

/**
 * Reports.
 *
 * The aggregates themselves are covered in `analytics.test.ts`. What is pinned
 * here is the handful of decisions this screen makes that a plausible
 * implementation would make differently — and that nobody would notice were
 * wrong, because a wrong number looks exactly like a right one.
 */

const app = createApp();
let studio: Studio;
let serviceId: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  studio = await signUpStudio(app);

  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Wheel Throwing',
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMin: 1,
      capacityMax: 8,
      priceCents: 6500,
    })
    .expect(201);
  serviceId = service.body.service.id;
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function makeCustomer(opts: { name?: string; createdAt?: Date } = {}) {
  return prisma.customer.create({
    data: {
      organizationId: studio.organizationId,
      name: opts.name ?? `Customer ${randomBytes(3).toString('hex')}`,
      email: `c-${randomBytes(6).toString('hex')}@example.test`,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}

async function makeSession(opts: { startsAt: Date; staffId?: string; seatsTaken?: number }) {
  return prisma.session.create({
    data: {
      organizationId: studio.organizationId,
      serviceTypeId: serviceId,
      staffId: opts.staffId ?? null,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 2 * 3_600_000),
      timezone: 'America/New_York',
      localStartTime: '18:00',
      capacity: 8,
      seatsTaken: opts.seatsTaken ?? 0,
    },
  });
}

async function makeBooking(opts: {
  startsAt: Date;
  status?: 'CONFIRMED' | 'CANCELLED' | 'ATTENDED';
  seats?: number;
  customerId?: string;
  sessionId?: string;
  paidCents?: number;
}) {
  const customerId = opts.customerId ?? (await makeCustomer()).id;
  const sessionId =
    opts.sessionId ?? (await makeSession({ startsAt: opts.startsAt })).id;

  const booking = await prisma.booking.create({
    data: {
      organizationId: studio.organizationId,
      customerId,
      serviceTypeId: serviceId,
      sessionId,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 2 * 3_600_000),
      status: opts.status ?? 'CONFIRMED',
      seats: opts.seats ?? 1,
      totalCents: 6500,
      timezone: 'America/New_York',
      cancelToken: randomBytes(32),
    },
  });

  if (opts.paidCents) {
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        bookingId: booking.id,
        kind: 'FULL',
        amountCents: opts.paidCents,
        status: 'SUCCEEDED',
        succeededAt: opts.startsAt,
      },
    });
  }

  return booking;
}

describe('the window', () => {
  it('defaults to thirty days and returns a bucket per day', async () => {
    const res = await request(app)
      .get(`${studio.base}/reports`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.range.days).toBe(30);
    expect(res.body.revenue).toHaveLength(30);
  });

  it('accepts the four ranges the screen offers', async () => {
    for (const days of [1, 7, 30, 90]) {
      const res = await request(app)
        .get(`${studio.base}/reports?days=${days}`)
        .set(studio.headers)
        .expect(200);
      expect(res.body.revenue).toHaveLength(days);
    }
  });

  /**
   * A fixed set, not a free number: it bounds the work per request and every
   * option maps onto a sentence somebody would say out loud.
   */
  it('refuses a range it does not offer', async () => {
    await request(app)
      .get(`${studio.base}/reports?days=365`)
      .set(studio.headers)
      .expect(422);
  });
});

describe('the numbers that are easy to get wrong', () => {
  /**
   * Cancellations count towards the rate and not towards anything else.
   *
   * The rate cannot be computed from a set that excludes cancellations, so this
   * one aggregate deliberately includes them — while seats, revenue and the
   * average all still exclude them.
   */
  it('counts cancellations in the rate but not in the seats', async () => {
    await makeBooking({ startsAt: daysAgo(3), seats: 2 });
    await makeBooking({ startsAt: daysAgo(3), seats: 4, status: 'CANCELLED' });

    const res = await request(app)
      .get(`${studio.base}/reports?days=30`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.bookings.total).toBe(2);
    expect(res.body.bookings.cancellationRate).toBe(50);
    expect(res.body.bookings.seats).toBe(2);
  });

  /**
   * The average is per booking that happened.
   *
   * Dividing by every booking taken would let a run of cancellations drag the
   * average down for a reason that has nothing to do with what a studio charges
   * — and that average is a number somebody prices against.
   */
  it('averages over bookings that were not cancelled', async () => {
    await makeBooking({ startsAt: daysAgo(2), paidCents: 10_000 });
    await makeBooking({ startsAt: daysAgo(2), status: 'CANCELLED' });

    const res = await request(app)
      .get(`${studio.base}/reports?days=30`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.totals.receivedCents).toBe(10_000);
    expect(res.body.totals.averageBookingCents).toBe(10_000);
  });

  /**
   * "New" is when they joined, not whether this is their first booking here.
   *
   * Somebody who joined two years ago and came back last week is returning.
   * Counting them as new flatters the number a studio judges its marketing by.
   */
  it('separates new customers from returning ones by when they joined', async () => {
    const old = await makeCustomer({ name: 'Long Timer', createdAt: daysAgo(400) });
    const fresh = await makeCustomer({ name: 'Just Joined' });

    await makeBooking({ startsAt: daysAgo(2), customerId: old.id });
    await makeBooking({ startsAt: daysAgo(2), customerId: fresh.id });

    const res = await request(app)
      .get(`${studio.base}/reports?days=30`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.customers.newCustomers).toBe(1);
    expect(res.body.customers.returning).toBe(1);
  });

  /**
   * Instructor work is counted from SESSIONS, not bookings.
   *
   * A class nobody booked was still taught, still occupied a kiln and still
   * cost an evening. Counting bookings would show an instructor who worked a
   * quiet week as one who did not work.
   */
  it('credits an instructor for a class that nobody booked', async () => {
    const staff = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Rowan Pike', email: 'rowan@clay.test' })
      .expect(201);

    await makeSession({ startsAt: daysAgo(4), staffId: staff.body.staff.id });

    const res = await request(app)
      .get(`${studio.base}/reports?days=30`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.staff).toHaveLength(1);
    expect(res.body.staff[0]).toMatchObject({
      name: 'Rowan Pike',
      classes: 1,
      seats: 0,
    });
  });
});

describe('who may read the studio commercial position', () => {
  /**
   * Admin-only, unlike almost every other read here. Everything an instructor
   * sees is operational; this is takings and a table of their colleagues'
   * performance.
   */
  it('is refused to an instructor', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    await request(app)
      .get(`${studio.base}/reports`)
      .set(instructor.headers)
      .expect(403);
  });

  it('is refused to front desk', async () => {
    const desk = await addMemberToStudio(app, studio.organizationId, 'FRONT_DESK');

    await request(app)
      .get(`${studio.base}/reports`)
      .set(desk.headers)
      .expect(403);
  });

  it('hides another studio entirely', async () => {
    const stranger = await signUpStudio(app);

    await request(app)
      .get(`${studio.base}/reports`)
      .set(stranger.headers)
      .expect(404);
  });

  it('never mixes another studio into the figures', async () => {
    const other = await signUpStudio(app);
    await prisma.payment.create({
      data: {
        organizationId: other.organizationId,
        kind: 'FULL',
        amountCents: 500_00,
        status: 'SUCCEEDED',
        succeededAt: daysAgo(1),
      },
    });

    const res = await request(app)
      .get(`${studio.base}/reports?days=30`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.totals.receivedCents).toBe(0);
    expect(res.body.customers.top).toHaveLength(0);
  });
});
