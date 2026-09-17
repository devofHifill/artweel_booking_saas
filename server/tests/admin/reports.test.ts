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

/* ------------------------------------------------------------------ D8 ---
   Bookings per day, occupancy, lead time, weekdays and the customer base.
   ------------------------------------------------------------------------ */

/** A second studio in a named zone, with a class of its own to book. */
async function studioIn(timezone: string) {
  const other = await signUpStudio(app, { timezone });

  const service = await request(app)
    .post(`${other.base}/services`)
    .set(other.headers)
    .send({
      name: 'Evening Wheel',
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMin: 1,
      capacityMax: 8,
      priceCents: 6500,
    })
    .expect(201);

  return { studio: other, serviceId: service.body.service.id as string };
}

async function bookingIn(
  target: { studio: Studio; serviceId: string },
  opts: { startsAt: Date; seats?: number; paidCents?: number },
) {
  const customer = await prisma.customer.create({
    data: {
      organizationId: target.studio.organizationId,
      name: `Customer ${randomBytes(3).toString('hex')}`,
      email: `c-${randomBytes(6).toString('hex')}@example.test`,
    },
  });

  const session = await prisma.session.create({
    data: {
      organizationId: target.studio.organizationId,
      serviceTypeId: target.serviceId,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 2 * 3_600_000),
      timezone: 'UTC',
      localStartTime: '18:00',
      capacity: 8,
    },
  });

  const booking = await prisma.booking.create({
    data: {
      organizationId: target.studio.organizationId,
      customerId: customer.id,
      serviceTypeId: target.serviceId,
      sessionId: session.id,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 2 * 3_600_000),
      status: 'CONFIRMED',
      seats: opts.seats ?? 1,
      totalCents: 6500,
      timezone: 'UTC',
      cancelToken: randomBytes(32),
    },
  });

  if (opts.paidCents) {
    await prisma.payment.create({
      data: {
        organizationId: target.studio.organizationId,
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

describe('bookings per day', () => {
  it('returns the same buckets the revenue series does', async () => {
    const res = await request(app)
      .get(`${studio.base}/reports?days=7`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.perDay).toHaveLength(7);
    expect(res.body.perDay.map((d: { date: string }) => d.date)).toEqual(
      res.body.revenue.map((d: { date: string }) => d.date),
    );
  });

  it('counts a booking on the day its class runs, in the studio zone', async () => {
    /*
      03:00 UTC is the previous EVENING in Los Angeles — 8pm, which is exactly
      when a pottery class runs. Bucketed on UTC it would be filed under the
      following day, and a studio's Sunday evening would appear on Monday.
    */
    const target = await studioIn('America/Los_Angeles');
    const instant = new Date();
    instant.setUTCHours(3, 0, 0, 0);

    await bookingIn(target, { startsAt: instant });

    const res = await request(app)
      .get(`${target.studio.base}/reports?days=7`)
      .set(target.studio.headers)
      .expect(200);

    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
    }).format(instant);

    const bucket = res.body.perDay.find((d: { date: string }) => d.date === local);
    expect(bucket).toMatchObject({ bookings: 1, seats: 1 });
  });

  it('leaves cancelled bookings out', async () => {
    await makeBooking({ startsAt: daysAgo(1), status: 'CANCELLED' });

    const res = await request(app)
      .get(`${studio.base}/reports?days=7`)
      .set(studio.headers)
      .expect(200);

    const total = res.body.perDay.reduce(
      (sum: number, d: { bookings: number }) => sum + d.bookings,
      0,
    );
    expect(total).toBe(0);
  });
});

describe('how full the classes ran', () => {
  it('measures seats sold against seats offered, across every session', async () => {
    const first = await makeSession({ startsAt: daysAgo(3), seatsTaken: 3 });
    const second = await makeSession({ startsAt: daysAgo(2), seatsTaken: 5 });

    await makeBooking({ startsAt: daysAgo(3), sessionId: first.id, paidCents: 6500 });
    await makeBooking({ startsAt: daysAgo(2), sessionId: second.id, paidCents: 6500 });

    const res = await request(app)
      .get(`${studio.base}/reports`)
      .set(studio.headers)
      .expect(200);

    /* 8 seats + 8 seats offered, 3 + 5 sold. */
    const row = res.body.popular.find(
      (r: { serviceTypeId: string }) => r.serviceTypeId === serviceId,
    );
    expect(row).toMatchObject({ capacity: 16, occupancy: 50 });
  });

  /**
   * A private lesson hangs off a staff member, not a session, so it never had
   * seats on sale. Reporting 0% would accuse it of failing to fill them.
   */
  it('reports nothing rather than zero for a class with no sessions', async () => {
    const staff = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Rowan Pike', email: 'rowan@clay.test', timezone: 'America/New_York' })
      .expect(201);

    const appointment = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Private Lesson',
        bookingMode: 'APPOINTMENT',
        durationMinutes: 60,
        capacityMax: 1,
        priceCents: 12_000,
      })
      .expect(201);

    const customer = await makeCustomer();
    await prisma.booking.create({
      data: {
        organizationId: studio.organizationId,
        customerId: customer.id,
        serviceTypeId: appointment.body.service.id,
        staffId: staff.body.staff.id,
        startsAt: daysAgo(2),
        endsAt: new Date(daysAgo(2).getTime() + 3_600_000),
        status: 'CONFIRMED',
        totalCents: 12_000,
        timezone: 'America/New_York',
        cancelToken: randomBytes(32),
      },
    });

    const res = await request(app)
      .get(`${studio.base}/reports`)
      .set(studio.headers)
      .expect(200);

    const row = res.body.popular.find(
      (r: { serviceTypeId: string }) => r.serviceTypeId === appointment.body.service.id,
    );
    expect(row.occupancy).toBeNull();
    expect(row.capacity).toBeNull();
  });

  /** Seats withdrawn were never on sale. */
  it('ignores cancelled sessions', async () => {
    const live = await makeSession({ startsAt: daysAgo(3), seatsTaken: 4 });
    await makeBooking({ startsAt: daysAgo(3), sessionId: live.id, paidCents: 6500 });

    await prisma.session.create({
      data: {
        organizationId: studio.organizationId,
        serviceTypeId: serviceId,
        startsAt: daysAgo(2),
        endsAt: new Date(daysAgo(2).getTime() + 2 * 3_600_000),
        timezone: 'America/New_York',
        localStartTime: '18:00',
        capacity: 8,
        seatsTaken: 0,
        status: 'CANCELLED',
      },
    });

    const res = await request(app)
      .get(`${studio.base}/reports`)
      .set(studio.headers)
      .expect(200);

    const row = res.body.popular.find(
      (r: { serviceTypeId: string }) => r.serviceTypeId === serviceId,
    );
    expect(row).toMatchObject({ capacity: 8, occupancy: 50 });
  });
});

describe('how far ahead people book', () => {
  /**
   * The median leads because lead times are long-tailed: one person booking a
   * course months out drags the mean past anything a studio would recognise.
   * Both are returned, and this pins the difference rather than the values
   * happening to agree.
   */
  it('reports a median that a long booking cannot drag', async () => {
    const runsAt = daysAgo(1);

    for (const bookedDaysBefore of [1, 1, 1]) {
      const booking = await makeBooking({ startsAt: runsAt });
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          createdAt: new Date(runsAt.getTime() - bookedDaysBefore * 86_400_000),
        },
      });
    }

    const early = await makeBooking({ startsAt: runsAt });
    await prisma.booking.update({
      where: { id: early.id },
      data: { createdAt: new Date(runsAt.getTime() - 60 * 86_400_000) },
    });

    const res = await request(app)
      .get(`${studio.base}/reports`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.lead.sample).toBe(4);
    expect(res.body.lead.medianDays).toBe(1);
    expect(res.body.lead.averageDays).toBeGreaterThan(10);
  });

  it('says nothing rather than zero when nobody booked', async () => {
    const res = await request(app)
      .get(`${studio.base}/reports`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.lead).toMatchObject({
      medianDays: null,
      averageDays: null,
      sample: 0,
    });
  });
});

describe('which weekday earns', () => {
  it('groups on the studio day, not on UTC', async () => {
    const target = await studioIn('America/Los_Angeles');
    const instant = new Date();
    instant.setUTCHours(3, 0, 0, 0);

    await bookingIn(target, { startsAt: instant, paidCents: 6500 });

    const res = await request(app)
      .get(`${target.studio.base}/reports?days=7`)
      .set(target.studio.headers)
      .expect(200);

    /* Luxon numbering: 1 = Monday. Derived from the LOCAL day rather than
       hard-coded, so the test does not depend on which day it runs. */
    const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const localName = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
    }).format(instant);
    const localWeekday = NAMES.indexOf(localName) + 1;

    const row = res.body.weekdays.find(
      (w: { weekday: number }) => w.weekday === localWeekday,
    );
    expect(row).toMatchObject({ bookings: 1, revenueCents: 6500 });
  });

  /** All seven, always — a missing Tuesday reads as data that failed to load. */
  it('lists every weekday even when nothing happened', async () => {
    const res = await request(app)
      .get(`${studio.base}/reports?days=7`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.weekdays).toHaveLength(7);
    expect(res.body.weekdays.map((w: { weekday: number }) => w.weekday)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });
});

describe('the customer base', () => {
  it('counts everyone on the books, including people who never booked', async () => {
    await makeCustomer();
    await makeCustomer();
    await makeBooking({ startsAt: daysAgo(2), paidCents: 6500 });

    const res = await request(app)
      .get(`${studio.base}/reports`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.customerBase.total).toBe(3);
  });

  it('counts a repeat customer as somebody with more than one booking', async () => {
    const loyal = await makeCustomer({ name: 'Returning Rita' });
    await makeBooking({ startsAt: daysAgo(4), customerId: loyal.id, paidCents: 6500 });
    await makeBooking({ startsAt: daysAgo(2), customerId: loyal.id, paidCents: 6500 });
    await makeBooking({ startsAt: daysAgo(2), paidCents: 6500 });

    const res = await request(app)
      .get(`${studio.base}/reports`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.customerBase.repeat).toBe(1);
    expect(res.body.customerBase.repeatRate).toBe(50);
  });

  /**
   * The denominator is everyone, not everyone who paid. Excluding the people
   * who never spent would quietly measure "what a paying customer is worth"
   * under a label saying "average customer".
   */
  it('divides takings by every customer, not only the paying ones', async () => {
    await makeCustomer();
    await makeBooking({ startsAt: daysAgo(2), paidCents: 10_000 });

    const res = await request(app)
      .get(`${studio.base}/reports`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.customerBase.averageSpendCents).toBe(5_000);
  });

  it('never counts another studio into any of it', async () => {
    const other = await studioIn('America/New_York');
    await bookingIn(other, { startsAt: daysAgo(2), paidCents: 99_000 });

    const res = await request(app)
      .get(`${studio.base}/reports`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.customerBase).toMatchObject({
      total: 0,
      repeat: 0,
      averageSpendCents: 0,
    });
    expect(res.body.popular).toEqual([]);
    expect(res.body.weekdays.every((w: { bookings: number }) => w.bookings === 0)).toBe(
      true,
    );
  });
});

describe('the last class a customer came to', () => {
  it('reports their most recent one, not their first', async () => {
    const regular = await makeCustomer({ name: 'Nora Potter' });
    await makeBooking({ startsAt: daysAgo(9), customerId: regular.id, paidCents: 6500 });
    await makeBooking({ startsAt: daysAgo(2), customerId: regular.id, paidCents: 6500 });

    const res = await request(app)
      .get(`${studio.base}/reports`)
      .set(studio.headers)
      .expect(200);

    const row = res.body.customers.top.find(
      (c: { id: string }) => c.id === regular.id,
    );

    expect(new Date(row.lastBookingAt).toISOString().slice(0, 10)).toBe(
      daysAgo(2).toISOString().slice(0, 10),
    );
  });
});
