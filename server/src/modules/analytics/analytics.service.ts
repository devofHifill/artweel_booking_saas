import { DateTime } from 'luxon';
import type { BookingStatus, PaymentStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';

/**
 * The aggregate layer.
 *
 * Every figure the dashboard and Reports display comes from here, and that is
 * the whole reason the module exists as its own thing rather than as helpers
 * hanging off whichever screen needed them first.
 *
 * Two screens computing "revenue this week" independently do not stay equal.
 * They drift the first time one of them is asked to exclude refunds, or to use
 * the studio's midnight rather than UTC's, and the drift surfaces as the
 * dashboard and Reports quoting different numbers for the same seven days. An
 * owner who spots that stops trusting both.
 *
 * ---
 *
 * Three rules hold everywhere below.
 *
 * **1. Money means the same thing every time.** Successful payments, minus what
 * was refunded — the rule `outstandingCents` in booking.admin.service already
 * uses. It is expressed once, in `MONEY_IN` and `net()`, and nothing here
 * counts money any other way.
 *
 * **2. Days are the studio's, not UTC's.** A studio in California closing at
 * 9pm has takings that belong to that day; bucketing on UTC would move them to
 * tomorrow for every studio west of Greenwich. Same rule `getToday` follows.
 *
 * **3. Every query is tenant-scoped, and it is asserted.** These are the first
 * queries in the product that aggregate across a whole table instead of reading
 * one row, so a forgotten `organizationId` is a cross-tenant leak rather than a
 * 404. Each function has a test that plants a row in another studio and proves
 * it does not appear.
 */

/**
 * Which payment rows count as money received.
 *
 * Matches `outstandingCents` exactly, deliberately. A fully REFUNDED row would
 * contribute `amount - refunded = 0` and could be included harmlessly, but
 * having two nearly-identical filters in the codebase is how the two drift; one
 * definition is worth more than the marginal tidiness.
 */
const MONEY_IN_STATUSES: PaymentStatus[] = ['SUCCEEDED', 'PARTIALLY_REFUNDED'];

const MONEY_IN = { status: { in: MONEY_IN_STATUSES } };

/** Net of refunds. Never sum `amountCents` directly. */
function net(payment: { amountCents: number; refundedCents: number }): number {
  return payment.amountCents - payment.refundedCents;
}

/** Bookings that still count — a cancelled seat is not attendance or demand. */
const LIVE_BOOKING_STATUSES: BookingStatus[] = [
  'PENDING',
  'CONFIRMED',
  'ATTENDED',
];

const LIVE_BOOKING = { status: { in: LIVE_BOOKING_STATUSES } };

async function timezoneOf(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return org.timezone;
}

/** The studio's own midnight-to-midnight, as UTC instants. */
function dayBounds(date: Date, timezone: string): { start: Date; end: Date } {
  const local = DateTime.fromJSDate(date, { zone: timezone });
  return {
    start: local.startOf('day').toJSDate(),
    end: local.endOf('day').toJSDate(),
  };
}

// --- revenue --------------------------------------------------------------

export type DayRevenue = {
  /** Studio-local calendar date, `YYYY-MM-DD`. */
  date: string;
  cents: number;
};

/**
 * Revenue per day, oldest first, including days that took nothing.
 *
 * Zero-days are emitted rather than omitted because the consumer is a bar
 * chart. A week with two quiet days should render two empty slots, not a
 * five-bar chart that silently changes shape.
 *
 * Bucketed in JS rather than by a SQL `date_trunc(... AT TIME ZONE ...)`. For a
 * single studio over a month this is a few hundred rows, and doing the timezone
 * arithmetic in Luxon keeps one implementation of "which day is this" instead of
 * one here and a different one in Postgres. If a studio ever makes that
 * expensive, the fix is a materialised daily rollup, not a cleverer query.
 *
 * Attributed by `succeededAt` — when the money actually landed — not
 * `createdAt`, which is when the checkout session was opened and can be the
 * previous day.
 */
export async function revenueByDay(
  organizationId: string,
  opts: { days: number; now?: Date },
): Promise<DayRevenue[]> {
  const timezone = await timezoneOf(organizationId);
  const now = opts.now ?? new Date();

  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  const firstDay = today.minus({ days: opts.days - 1 });

  const payments = await prisma.payment.findMany({
    where: {
      organizationId,
      ...MONEY_IN,
      succeededAt: {
        gte: firstDay.toJSDate(),
        lte: today.endOf('day').toJSDate(),
      },
    },
    select: { amountCents: true, refundedCents: true, succeededAt: true },
  });

  const buckets = new Map<string, number>();
  for (let i = 0; i < opts.days; i++) {
    buckets.set(firstDay.plus({ days: i }).toISODate()!, 0);
  }

  for (const payment of payments) {
    if (!payment.succeededAt) continue;
    const key = DateTime.fromJSDate(payment.succeededAt, {
      zone: timezone,
    }).toISODate();
    if (key && buckets.has(key)) {
      buckets.set(key, buckets.get(key)! + net(payment));
    }
  }

  return [...buckets.entries()].map(([date, cents]) => ({ date, cents }));
}

// --- one day --------------------------------------------------------------

export type DayFigures = {
  bookings: number;
  seatsBooked: number;
  seatsLeft: number;
  revenueCents: number;
};

/**
 * Everything the KPI row needs about a single day.
 *
 * Takes a date rather than assuming today, because the dashboard renders the
 * same shape twice: once for today and once for yesterday, to compute the
 * trend. A function that could only answer "today" would have needed a second,
 * nearly identical one.
 */
export async function dayFigures(
  organizationId: string,
  opts: { date?: Date } = {},
): Promise<DayFigures> {
  const timezone = await timezoneOf(organizationId);
  const { start, end } = dayBounds(opts.date ?? new Date(), timezone);

  const [bookings, sessions, payments] = await Promise.all([
    prisma.booking.findMany({
      where: { organizationId, ...LIVE_BOOKING, startsAt: { gte: start, lte: end } },
      select: { seats: true },
    }),

    prisma.session.findMany({
      where: {
        organizationId,
        startsAt: { gte: start, lte: end },
        status: 'SCHEDULED',
      },
      select: { capacity: true, seatsTaken: true },
    }),

    prisma.payment.findMany({
      where: { organizationId, ...MONEY_IN, succeededAt: { gte: start, lte: end } },
      select: { amountCents: true, refundedCents: true },
    }),
  ]);

  return {
    bookings: bookings.length,
    seatsBooked: bookings.reduce((sum, b) => sum + b.seats, 0),
    /*
      Not floored at zero, deliberately.

      The obvious defensive `Math.max(0, ...)` would guard against an overbooked
      session lending negative capacity to its neighbours — but
      `sessions_seats_within_capacity` makes `seats_taken > capacity` impossible
      to write, so that branch could never run. Phase 0's thesis is that
      correctness lives in the database; defensive arithmetic against a state the
      database forbids is code nobody can test and everybody has to read.

      `analytics.test.ts` asserts the constraint still refuses such a row, so if
      it is ever dropped the test says so and this line needs the floor back.
    */
    seatsLeft: sessions.reduce((sum, s) => sum + (s.capacity - s.seatsTaken), 0),
    revenueCents: payments.reduce((sum, p) => sum + net(p), 0),
  };
}

// --- what sells -----------------------------------------------------------

export type PopularService = {
  serviceTypeId: string;
  name: string;
  color: string;
  bookings: number;
  seats: number;
  revenueCents: number;
};

/**
 * The best-selling classes over a window, ranked by bookings.
 *
 * Windowed on when the class RUNS, not on when it was booked. "Our most popular
 * classes this month" is a question about what the studio taught; ordering by
 * booking date would rank a course that sold out in January and runs in June
 * above everything actually happening now.
 *
 * Revenue is the payments attached to those bookings, net of refunds — rule 1.
 * It is deliberately not `booking.totalCents`, which is what was *owed*: a
 * screen that ranks by money should rank by money received, or an unpaid
 * booking inflates a class's apparent performance.
 */
export async function popularServices(
  organizationId: string,
  opts: { days: number; limit?: number; now?: Date },
): Promise<PopularService[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * 86_400_000);

  const bookings = await prisma.booking.findMany({
    where: {
      organizationId,
      ...LIVE_BOOKING,
      startsAt: { gte: since, lte: now },
    },
    select: {
      seats: true,
      serviceTypeId: true,
      serviceType: { select: { name: true, color: true } },
      payments: { select: { amountCents: true, refundedCents: true, status: true } },
    },
  });

  const byService = new Map<string, PopularService>();

  for (const booking of bookings) {
    const row = byService.get(booking.serviceTypeId) ?? {
      serviceTypeId: booking.serviceTypeId,
      name: booking.serviceType.name,
      color: booking.serviceType.color,
      bookings: 0,
      seats: 0,
      revenueCents: 0,
    };

    row.bookings += 1;
    row.seats += booking.seats;
    row.revenueCents += booking.payments
      .filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED')
      .reduce((sum, p) => sum + net(p), 0);

    byService.set(booking.serviceTypeId, row);
  }

  return [...byService.values()]
    .sort((a, b) => b.bookings - a.bookings || b.revenueCents - a.revenueCents)
    .slice(0, opts.limit ?? 5);
}

// --- where they come from -------------------------------------------------

export type SourceShare = { source: string; bookings: number };

/**
 * Booking counts by origin.
 *
 * Windowed on when the booking was TAKEN, unlike `popularServices` above —
 * "where did this month's bookings come from" is a question about the channel
 * at the moment of sale, and a booking placed today for a class in September
 * belongs to today's marketing, not September's.
 *
 * Known limitation, honest until B8: the embed widget posts through the same
 * public route as the booking page, so both write `web`. There is no way to
 * separate them from this column today, and the dashboard says so on screen
 * rather than presenting two slices as the whole picture.
 */
export async function bookingSources(
  organizationId: string,
  opts: { days: number; now?: Date },
): Promise<SourceShare[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * 86_400_000);

  const grouped = await prisma.booking.groupBy({
    by: ['source'],
    where: {
      organizationId,
      ...LIVE_BOOKING,
      createdAt: { gte: since, lte: now },
    },
    _count: true,
  });

  return grouped
    .map((row) => ({ source: row.source, bookings: row._count }))
    .sort((a, b) => b.bookings - a.bookings);
}

// --- what is coming, and what is wrong ------------------------------------

/** Classes scheduled between tomorrow and `days` ahead. */
export async function upcomingSessions(
  organizationId: string,
  opts: { days: number; now?: Date },
): Promise<number> {
  const timezone = await timezoneOf(organizationId);
  const now = opts.now ?? new Date();
  const local = DateTime.fromJSDate(now, { zone: timezone });

  return prisma.session.count({
    where: {
      organizationId,
      status: 'SCHEDULED',
      startsAt: {
        gt: local.endOf('day').toJSDate(),
        lte: local.plus({ days: opts.days }).endOf('day').toJSDate(),
      },
    },
  });
}

export type UnstaffedSession = {
  id: string;
  startsAt: Date;
  serviceName: string;
};

/**
 * Scheduled classes in the near future with nobody assigned to teach them.
 *
 * This is one of the two substitutes for TourFlow's "guests have not signed a
 * waiver" row — waivers do not exist in this product, and inventing a fake
 * number to fill the slot would be worse than answering a different question
 * honestly.
 *
 * Only forward-looking. A class last Tuesday that nobody was assigned to has
 * already happened; listing it as needing attention gives an owner something
 * they cannot act on, and a list that cannot be emptied stops being read.
 */
export async function unstaffedSessions(
  organizationId: string,
  opts: { days: number; now?: Date; limit?: number },
): Promise<UnstaffedSession[]> {
  const now = opts.now ?? new Date();

  const sessions = await prisma.session.findMany({
    where: {
      organizationId,
      status: 'SCHEDULED',
      staffId: null,
      startsAt: {
        gte: now,
        lte: new Date(now.getTime() + opts.days * 86_400_000),
      },
    },
    select: {
      id: true,
      startsAt: true,
      serviceType: { select: { name: true } },
    },
    orderBy: { startsAt: 'asc' },
    take: opts.limit ?? 20,
  });

  return sessions.map((s) => ({
    id: s.id,
    startsAt: s.startsAt,
    serviceName: s.serviceType.name,
  }));
}

/**
 * Finished pieces nobody has collected, past the studio's own hold period.
 *
 * The second waiver substitute. `pieceHoldDays` is a studio setting — the
 * threshold is theirs, not ours — and a studio that sets it to zero is saying
 * "never chase", which this respects by returning nothing.
 */
export async function uncollectedPieces(
  organizationId: string,
  opts: { now?: Date } = {},
): Promise<number> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { pieceHoldDays: true },
  });

  if (org.pieceHoldDays <= 0) return 0;

  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - org.pieceHoldDays * 86_400_000);

  /*
    Measured from `readyAt`, not `updatedAt`.

    `updatedAt` moves whenever anything on the row changes — a corrected label, a
    new shelf location — so a studio tidying its shelves would silently restart
    the hold clock on every piece it touched, and nothing would ever age past the
    threshold. `readyAt` is stamped once, when the piece became collectable,
    which is the event the hold period is actually measured from.
  */
  return prisma.piece.count({
    where: {
      organizationId,
      status: 'FINISHED',
      readyAt: { not: null, lt: cutoff },
    },
  });
}
