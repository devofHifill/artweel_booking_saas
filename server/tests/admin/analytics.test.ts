import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import * as analytics from '../../src/modules/analytics/analytics.service';

/**
 * The aggregate layer.
 *
 * Two screens will read these figures, so a wrong answer here is wrong in two
 * places and consistent between them, which is the hardest kind to notice. The
 * assertions that matter are not "it adds up" — they are the four ways a
 * plausible implementation gets it quietly wrong:
 *
 *   1. bucketing on UTC rather than the studio's own midnight
 *   2. summing `amountCents` and forgetting refunds
 *   3. ranking by money owed instead of money received
 *   4. leaking another studio's rows into an aggregate
 *
 * Every one of those has a test below, and every one of them would otherwise
 * ship looking correct.
 */

const app = createApp();
let studio: Studio;
let serviceId: string;

/** Fixed so nothing depends on when the suite runs. */
const NOW = new Date('2026-08-20T15:00:00.000Z');

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  studio = await signUpStudio(app);

  // Los Angeles, deliberately: UTC-7 in August, so a studio evening lands on
  // the FOLLOWING UTC day and any UTC-based bucketing is visibly wrong.
  await prisma.organization.update({
    where: { id: studio.organizationId },
    data: { timezone: 'America/Los_Angeles' },
  });

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

async function makeSession(opts: {
  startsAt: Date;
  capacity?: number;
  seatsTaken?: number;
  staffId?: string | null;
  serviceTypeId?: string;
}) {
  return prisma.session.create({
    data: {
      organizationId: studio.organizationId,
      serviceTypeId: opts.serviceTypeId ?? serviceId,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 2 * 3_600_000),
      timezone: 'America/Los_Angeles',
      localStartTime: '18:00',
      capacity: opts.capacity ?? 8,
      seatsTaken: opts.seatsTaken ?? 0,
      staffId: opts.staffId ?? null,
    },
  });
}

async function makeBooking(opts: {
  startsAt: Date;
  seats?: number;
  status?: 'PENDING' | 'CONFIRMED' | 'ATTENDED' | 'CANCELLED';
  source?: string;
  createdAt?: Date;
  serviceTypeId?: string;
  organizationId?: string;
}) {
  const organizationId = opts.organizationId ?? studio.organizationId;
  const serviceTypeId = opts.serviceTypeId ?? serviceId;

  const customer = await prisma.customer.create({
    data: {
      organizationId,
      name: `Customer ${randomBytes(4).toString('hex')}`,
      email: `c-${randomBytes(6).toString('hex')}@example.test`,
    },
  });

  const session = await prisma.session.create({
    data: {
      organizationId,
      serviceTypeId,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 2 * 3_600_000),
      timezone: 'America/Los_Angeles',
      localStartTime: '18:00',
      capacity: 8,
    },
  });

  return prisma.booking.create({
    data: {
      organizationId,
      customerId: customer.id,
      serviceTypeId,
      sessionId: session.id,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 2 * 3_600_000),
      status: opts.status ?? 'CONFIRMED',
      seats: opts.seats ?? 1,
      totalCents: 6500,
      timezone: 'America/Los_Angeles',
      source: opts.source ?? 'web',
      cancelToken: randomBytes(32),
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}

async function makePayment(opts: {
  succeededAt: Date;
  amountCents: number;
  refundedCents?: number;
  status?: 'SUCCEEDED' | 'PARTIALLY_REFUNDED' | 'PENDING' | 'FAILED' | 'REFUNDED';
  bookingId?: string;
  organizationId?: string;
}) {
  return prisma.payment.create({
    data: {
      organizationId: opts.organizationId ?? studio.organizationId,
      bookingId: opts.bookingId,
      kind: 'FULL',
      amountCents: opts.amountCents,
      refundedCents: opts.refundedCents ?? 0,
      status: opts.status ?? 'SUCCEEDED',
      succeededAt: opts.succeededAt,
    },
  });
}

describe('revenue by day', () => {
  it('returns one bucket per day, including days that took nothing', async () => {
    const days = await analytics.revenueByDay(studio.organizationId, {
      days: 7,
      now: NOW,
    });

    expect(days).toHaveLength(7);
    expect(days.every((d) => d.cents === 0)).toBe(true);
    // Oldest first, and the last bucket is today in the studio's timezone.
    expect(days[6]!.date).toBe('2026-08-20');
    expect(days[0]!.date).toBe('2026-08-14');
  });

  /**
   * The timezone assertion, and the reason the fixture studio is in Los Angeles.
   *
   * 2026-08-21T02:00Z is 19:00 on 2026-08-20 in Los Angeles — an evening class
   * being paid for. Bucketed on UTC it lands on the 21st, moving a day's takings
   * into tomorrow for every studio in the Americas.
   */
  it('buckets on the studio day, not the UTC day', async () => {
    await makePayment({
      succeededAt: new Date('2026-08-21T02:00:00.000Z'),
      amountCents: 5000,
    });

    const days = await analytics.revenueByDay(studio.organizationId, {
      days: 7,
      now: NOW,
    });

    const twentieth = days.find((d) => d.date === '2026-08-20');
    const twentyFirst = days.find((d) => d.date === '2026-08-21');

    expect(twentieth?.cents).toBe(5000);
    expect(twentyFirst).toBeUndefined();
  });

  it('subtracts refunds rather than counting the gross', async () => {
    await makePayment({
      succeededAt: new Date('2026-08-19T18:00:00.000Z'),
      amountCents: 10_000,
      refundedCents: 2_500,
      status: 'PARTIALLY_REFUNDED',
    });

    const days = await analytics.revenueByDay(studio.organizationId, {
      days: 7,
      now: NOW,
    });

    expect(days.find((d) => d.date === '2026-08-19')?.cents).toBe(7_500);
  });

  it('ignores payments that never succeeded', async () => {
    await makePayment({
      succeededAt: new Date('2026-08-19T18:00:00.000Z'),
      amountCents: 9_900,
      status: 'FAILED',
    });

    const days = await analytics.revenueByDay(studio.organizationId, {
      days: 7,
      now: NOW,
    });

    expect(days.find((d) => d.date === '2026-08-19')?.cents).toBe(0);
  });

  it('never counts another studio', async () => {
    const other = await signUpStudio(app);
    await makePayment({
      succeededAt: new Date('2026-08-19T18:00:00.000Z'),
      amountCents: 50_000,
      organizationId: other.organizationId,
    });

    const days = await analytics.revenueByDay(studio.organizationId, {
      days: 7,
      now: NOW,
    });

    expect(days.every((d) => d.cents === 0)).toBe(true);
  });
});

describe('a single day', () => {
  it('counts bookings, seats and money for the studio day', async () => {
    // 18:00 on the 20th in Los Angeles.
    const evening = new Date('2026-08-21T01:00:00.000Z');

    await makeBooking({ startsAt: evening, seats: 2 });
    await makeBooking({ startsAt: evening, seats: 3 });
    await makePayment({ succeededAt: evening, amountCents: 6_500 });

    const figures = await analytics.dayFigures(studio.organizationId, {
      date: NOW,
    });

    expect(figures.bookings).toBe(2);
    expect(figures.seatsBooked).toBe(5);
    expect(figures.revenueCents).toBe(6_500);
  });

  it('leaves cancelled bookings out', async () => {
    const evening = new Date('2026-08-21T01:00:00.000Z');
    await makeBooking({ startsAt: evening, seats: 4, status: 'CANCELLED' });

    const figures = await analytics.dayFigures(studio.organizationId, {
      date: NOW,
    });

    expect(figures.bookings).toBe(0);
    expect(figures.seatsBooked).toBe(0);
  });

  it('reports seats left across the day', async () => {
    const evening = new Date('2026-08-21T01:00:00.000Z');
    await makeSession({ startsAt: evening, capacity: 8, seatsTaken: 3 });
    await makeSession({ startsAt: evening, capacity: 6, seatsTaken: 6 });

    const figures = await analytics.dayFigures(studio.organizationId, {
      date: NOW,
    });

    expect(figures.seatsLeft).toBe(5);
  });

  /**
   * Why `seatsLeft` needs no floor.
   *
   * The natural defensive move is `Math.max(0, capacity - seatsTaken)`, so an
   * overbooked class cannot lend negative capacity to its neighbours and hide
   * free seats elsewhere in the day. That branch is unreachable: the database
   * refuses to store the row.
   *
   * This test exists to pin that. If `sessions_seats_within_capacity` is ever
   * dropped, this fails — and the floor has to go back into `dayFigures`.
   */
  it('cannot have an overbooked session in the first place', async () => {
    const evening = new Date('2026-08-21T01:00:00.000Z');

    await expect(
      makeSession({ startsAt: evening, capacity: 4, seatsTaken: 6 }),
    ).rejects.toThrow(/sessions_seats_within_capacity/);
  });

  it('can be asked about yesterday, for the trend', async () => {
    const yesterdayEvening = new Date('2026-08-20T01:00:00.000Z');
    await makeBooking({ startsAt: yesterdayEvening, seats: 2 });

    const yesterday = DateTime.fromJSDate(NOW, {
      zone: 'America/Los_Angeles',
    })
      .minus({ days: 1 })
      .toJSDate();

    const figures = await analytics.dayFigures(studio.organizationId, {
      date: yesterday,
    });

    expect(figures.bookings).toBe(1);
    expect(figures.seatsBooked).toBe(2);
  });
});

describe('popular classes', () => {
  it('ranks by bookings and reports seats and money received', async () => {
    const recent = new Date('2026-08-18T18:00:00.000Z');

    const b1 = await makeBooking({ startsAt: recent, seats: 2 });
    const b2 = await makeBooking({ startsAt: recent, seats: 1 });

    await makePayment({
      succeededAt: recent,
      amountCents: 6_500,
      bookingId: b1.id,
    });
    await makePayment({
      succeededAt: recent,
      amountCents: 6_500,
      refundedCents: 1_000,
      status: 'PARTIALLY_REFUNDED',
      bookingId: b2.id,
    });

    const rows = await analytics.popularServices(studio.organizationId, {
      days: 30,
      now: NOW,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Wheel Throwing',
      bookings: 2,
      seats: 3,
    });
    // 6500 + (6500 - 1000) — money received, refunds off.
    expect(rows[0]!.revenueCents).toBe(12_000);
  });

  /**
   * Ranked on money RECEIVED, not money owed.
   *
   * `booking.totalCents` is what the customer agreed to pay. Ranking on it lets
   * an unpaid booking inflate a class's apparent performance, which is the
   * number an owner would use to decide what to run more of.
   */
  it('does not count an unpaid booking as revenue', async () => {
    await makeBooking({
      startsAt: new Date('2026-08-18T18:00:00.000Z'),
      seats: 1,
    });

    const rows = await analytics.popularServices(studio.organizationId, {
      days: 30,
      now: NOW,
    });

    expect(rows[0]!.bookings).toBe(1);
    expect(rows[0]!.revenueCents).toBe(0);
  });

  it('windows on when the class runs, not when it was booked', async () => {
    // Booked today, runs in three months — outside a 30-day window.
    await makeBooking({
      startsAt: new Date('2026-11-20T18:00:00.000Z'),
      createdAt: NOW,
    });

    const rows = await analytics.popularServices(studio.organizationId, {
      days: 30,
      now: NOW,
    });

    expect(rows).toHaveLength(0);
  });

  it('never counts another studio', async () => {
    const other = await signUpStudio(app);
    const otherService = await request(app)
      .post(`${other.base}/services`)
      .set(other.headers)
      .send({
        name: 'Someone Else Class',
        bookingMode: 'EVENT',
        durationMinutes: 60,
        capacityMin: 1,
        capacityMax: 4,
        priceCents: 1000,
      })
      .expect(201);

    await makeBooking({
      startsAt: new Date('2026-08-18T18:00:00.000Z'),
      organizationId: other.organizationId,
      serviceTypeId: otherService.body.service.id,
    });

    const rows = await analytics.popularServices(studio.organizationId, {
      days: 30,
      now: NOW,
    });

    expect(rows).toHaveLength(0);
  });
});

describe('booking sources', () => {
  it('counts by origin, most common first', async () => {
    const runsAt = new Date('2026-08-25T18:00:00.000Z');
    await makeBooking({ startsAt: runsAt, source: 'web', createdAt: NOW });
    await makeBooking({ startsAt: runsAt, source: 'web', createdAt: NOW });
    await makeBooking({ startsAt: runsAt, source: 'admin', createdAt: NOW });

    const sources = await analytics.bookingSources(studio.organizationId, {
      days: 30,
      now: NOW,
    });

    expect(sources).toEqual([
      { source: 'web', bookings: 2 },
      { source: 'admin', bookings: 1 },
    ]);
  });

  /**
   * Windowed on when the booking was TAKEN — unlike popular classes, which
   * window on when the class runs. A booking placed today for a class in
   * November belongs to this month's marketing.
   */
  it('windows on when the booking was taken', async () => {
    await makeBooking({
      startsAt: new Date('2026-11-20T18:00:00.000Z'),
      createdAt: NOW,
      source: 'web',
    });

    const sources = await analytics.bookingSources(studio.organizationId, {
      days: 30,
      now: NOW,
    });

    expect(sources).toEqual([{ source: 'web', bookings: 1 }]);
  });
});

describe('what is coming, and what is wrong', () => {
  it('counts classes scheduled after today', async () => {
    await makeSession({ startsAt: new Date('2026-08-22T18:00:00.000Z') });
    await makeSession({ startsAt: new Date('2026-08-24T18:00:00.000Z') });
    // Today — excluded, it is not "upcoming".
    await makeSession({ startsAt: new Date('2026-08-21T01:00:00.000Z') });

    const count = await analytics.upcomingSessions(studio.organizationId, {
      days: 7,
      now: NOW,
    });

    expect(count).toBe(2);
  });

  it('lists future classes with nobody teaching them', async () => {
    await makeSession({ startsAt: new Date('2026-08-22T18:00:00.000Z') });

    const rows = await analytics.unstaffedSessions(studio.organizationId, {
      days: 7,
      now: NOW,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.serviceName).toBe('Wheel Throwing');
  });

  /**
   * A class last Tuesday that nobody was assigned to has already happened.
   * Listing it gives an owner something they cannot act on, and an attention
   * list that cannot be emptied stops being read.
   */
  it('leaves past unstaffed classes alone', async () => {
    await makeSession({ startsAt: new Date('2026-08-10T18:00:00.000Z') });

    const rows = await analytics.unstaffedSessions(studio.organizationId, {
      days: 7,
      now: NOW,
    });

    expect(rows).toHaveLength(0);
  });
});

describe('uncollected pieces', () => {
  async function makePiece(opts: { readyAt: Date | null; status?: 'FINISHED' | 'COLLECTED' }) {
    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Piece Owner',
        email: `p-${randomBytes(6).toString('hex')}@example.test`,
      },
    });

    return prisma.piece.create({
      data: {
        organizationId: studio.organizationId,
        customerId: customer.id,
        label: 'Blue mug',
        status: opts.status ?? 'FINISHED',
        readyAt: opts.readyAt,
        /* `pieces_collection_coherent` ties the two together: COLLECTED
           requires a collectedAt, and anything else requires it to be null. */
        collectedAt: opts.status === 'COLLECTED' ? new Date() : null,
      },
    });
  }

  it('counts finished pieces past the studio hold period', async () => {
    // Default hold is 30 days; this one has been sitting for 60.
    await makePiece({ readyAt: new Date('2026-06-21T00:00:00.000Z') });
    await makePiece({ readyAt: new Date('2026-08-18T00:00:00.000Z') });

    const count = await analytics.uncollectedPieces(studio.organizationId, {
      now: NOW,
    });

    expect(count).toBe(1);
  });

  it('does not count pieces already collected', async () => {
    await makePiece({
      readyAt: new Date('2026-06-21T00:00:00.000Z'),
      status: 'COLLECTED',
    });

    const count = await analytics.uncollectedPieces(studio.organizationId, {
      now: NOW,
    });

    expect(count).toBe(0);
  });

  /** A studio that sets the hold to zero is saying "never chase". Respect it. */
  it('returns nothing when the studio has no hold period', async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { pieceHoldDays: 0 },
    });

    await makePiece({ readyAt: new Date('2026-01-01T00:00:00.000Z') });

    const count = await analytics.uncollectedPieces(studio.organizationId, {
      now: NOW,
    });

    expect(count).toBe(0);
  });
});
