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

/**
 * What has actually been received against a set of payment rows.
 *
 * Exported because it is rule 1 above applied to payments already loaded in
 * memory, and three callers now need exactly that: the dashboard's schedule
 * revenue, the manifest's balance-owed column, and `outstandingCents`. Each
 * had grown its own copy of the same four lines — identical today, and one
 * refund-status change away from the dashboard and the sheet an instructor
 * carries quoting different money for the same class.
 *
 * The queries above cannot use this (they filter in SQL, via MONEY_IN); this
 * is for the rows a caller has already selected.
 */
export function paidCentsOf(
  payments: {
    amountCents: number;
    refundedCents: number;
    status: PaymentStatus;
  }[],
): number {
  return payments
    .filter((payment) => MONEY_IN_STATUSES.includes(payment.status))
    .reduce((sum, payment) => sum + net(payment), 0);
}

/**
 * What is still owed on a set of bookings already loaded.
 *
 * The other half of rule 1. `paidCentsOf` says what came in; this says what
 * has not, and the pair were being written out longhand in three places —
 * `getBooking`, the dashboard summary and now the payments screen. The
 * `Math.max` matters: an over-refunded or comped booking must read as zero
 * owed, never as the studio owing the customer money on a figure headed
 * "outstanding".
 */
export function outstandingCentsOf(
  bookings: {
    totalCents: number;
    payments: {
      amountCents: number;
      refundedCents: number;
      status: PaymentStatus;
    }[];
  }[],
): number {
  return bookings.reduce(
    (sum, booking) =>
      sum + Math.max(0, booking.totalCents - paidCentsOf(booking.payments)),
    0,
  );
}

/**
 * Everything the studio is still owed, as one figure.
 *
 * `from` exists because the dashboard and the payments screen want different
 * windows on the same rule, not different rules. The dashboard asks about
 * bookings still to come — money it can still collect at the door. Payments
 * asks with no window at all, because a class somebody attended in March and
 * never paid for is exactly what a screen headed "owed" is for.
 *
 * Free bookings are excluded at the query rather than filtered after: a studio
 * running a free taster session would otherwise load every one of them to
 * subtract zero.
 */
export async function outstandingTotal(
  organizationId: string,
  opts: { from?: Date } = {},
): Promise<number> {
  const bookings = await prisma.booking.findMany({
    where: {
      organizationId,
      /* PENDING and CONFIRMED only. An ATTENDED booking that was never paid is
         a real debt, but it is also how a studio records a comped seat, and
         chasing those is a decision this figure should not make for them. */
      status: { in: ['PENDING', 'CONFIRMED'] },
      totalCents: { gt: 0 },
      ...(opts.from ? { startsAt: { gte: opts.from } } : {}),
    },
    select: {
      totalCents: true,
      payments: {
        select: { amountCents: true, refundedCents: true, status: true },
      },
    },
  });

  return outstandingCentsOf(bookings);
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
    row.revenueCents += paidCentsOf(booking.payments);

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

// --- Reporting aggregates ---------------------------------------------------
//
// Added for the Reports screen. They live here rather than beside it for the
// same reason the rest of this module exists: the dashboard already answers
// "how are we doing" and the two screens must not answer it differently.

export type BookingBreakdown = {
  total: number;
  seats: number;
  byStatus: { status: string; count: number }[];
  cancellationRate: number;
};

/**
 * What happened to the bookings in a window.
 *
 * Includes CANCELLED, unlike almost every other aggregate here — the
 * cancellation rate is the number this tab exists for, and it cannot be
 * computed from a set that excludes cancellations. Everything else stays
 * consistent by dividing rather than by filtering.
 */
export async function bookingBreakdown(
  organizationId: string,
  opts: { days: number; now?: Date },
): Promise<BookingBreakdown> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * 86_400_000);

  const rows = await prisma.booking.findMany({
    where: { organizationId, startsAt: { gte: since, lte: now } },
    select: { status: true, seats: true },
  });

  const byStatus = new Map<string, number>();
  let seats = 0;

  for (const row of rows) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
    if (row.status !== 'CANCELLED') seats += row.seats;
  }

  const cancelled = byStatus.get('CANCELLED') ?? 0;

  return {
    total: rows.length,
    seats,
    byStatus: [...byStatus.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    /* Rounded to a whole percent. A cancellation rate quoted to two decimals
       implies a precision that a studio doing forty bookings a month does not
       have. */
    cancellationRate: rows.length
      ? Math.round((cancelled / rows.length) * 100)
      : 0,
  };
}

export type CustomerStats = {
  newCustomers: number;
  returning: number;
  top: {
    id: string;
    name: string;
    bookings: number;
    spentCents: number;
    /** Their most recent class IN THIS WINDOW, not ever. */
    lastBookingAt: Date | null;
  }[];
};

/**
 * Who is booking.
 *
 * "New" is measured by when the CUSTOMER record was created, not by whether
 * this is their first booking in the window — somebody who joined two years ago
 * and came back last week is a returning customer, and counting them as new
 * would flatter the number that a studio uses to judge its marketing.
 */
export async function customerStats(
  organizationId: string,
  opts: { days: number; limit?: number; now?: Date },
): Promise<CustomerStats> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * 86_400_000);

  const [newCustomers, bookings] = await Promise.all([
    prisma.customer.count({
      where: { organizationId, createdAt: { gte: since, lte: now } },
    }),

    prisma.booking.findMany({
      where: {
        organizationId,
        ...LIVE_BOOKING,
        startsAt: { gte: since, lte: now },
      },
      select: {
        customerId: true,
        startsAt: true,
        customer: { select: { id: true, name: true, createdAt: true } },
        payments: { select: { amountCents: true, refundedCents: true, status: true } },
      },
    }),
  ]);

  const byCustomer = new Map<
    string,
    {
      id: string;
      name: string;
      bookings: number;
      spentCents: number;
      joinedAt: Date;
      lastBookingAt: Date | null;
    }
  >();

  for (const booking of bookings) {
    const entry = byCustomer.get(booking.customerId) ?? {
      id: booking.customer.id,
      name: booking.customer.name,
      bookings: 0,
      spentCents: 0,
      joinedAt: booking.customer.createdAt,
      lastBookingAt: null as Date | null,
    };

    entry.bookings += 1;
    entry.spentCents += paidCentsOf(booking.payments);

    /* The latest class they attended, which the query has already limited to
       this window and to classes that have started. A booking still to come is
       not a visit, and letting one win would sort somebody who booked ahead
       above somebody who was actually here yesterday — the same rule the
       customer list settled on in D5. */
    if (!entry.lastBookingAt || booking.startsAt > entry.lastBookingAt) {
      entry.lastBookingAt = booking.startsAt;
    }

    byCustomer.set(booking.customerId, entry);
  }

  const everyone = [...byCustomer.values()];

  return {
    newCustomers,
    returning: everyone.filter((c) => c.joinedAt < since).length,
    top: everyone
      .sort((a, b) => b.spentCents - a.spentCents || b.bookings - a.bookings)
      .slice(0, opts.limit ?? 5)
      .map(({ id, name, bookings: count, spentCents, lastBookingAt }) => ({
        id,
        name,
        bookings: count,
        spentCents,
        lastBookingAt,
      })),
  };
}

export type StaffPerformance = {
  staffId: string;
  name: string;
  classes: number;
  seats: number;
  revenueCents: number;
};

/**
 * What each instructor actually taught.
 *
 * Counted from SESSIONS, not from bookings — a class with nobody in it was
 * still taught, still occupied a kiln and still cost the studio an instructor's
 * evening. Counting bookings would make a quiet week look like an instructor
 * who did not work.
 */
export async function staffPerformance(
  organizationId: string,
  opts: { days: number; now?: Date },
): Promise<StaffPerformance[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * 86_400_000);

  const sessions = await prisma.session.findMany({
    where: {
      organizationId,
      staffId: { not: null },
      startsAt: { gte: since, lte: now },
      status: 'SCHEDULED',
    },
    select: {
      staffId: true,
      seatsTaken: true,
      staff: { select: { id: true, name: true } },
      bookings: {
        where: { status: { in: LIVE_BOOKING_STATUSES } },
        select: {
          payments: { select: { amountCents: true, refundedCents: true, status: true } },
        },
      },
    },
  });

  const byStaff = new Map<string, StaffPerformance>();

  for (const session of sessions) {
    if (!session.staff) continue;

    const entry = byStaff.get(session.staff.id) ?? {
      staffId: session.staff.id,
      name: session.staff.name,
      classes: 0,
      seats: 0,
      revenueCents: 0,
    };

    entry.classes += 1;
    entry.seats += session.seatsTaken;
    entry.revenueCents += session.bookings.reduce(
      (sum, booking) => sum + paidCentsOf(booking.payments),
      0,
    );

    byStaff.set(session.staff.id, entry);
  }

  return [...byStaff.values()].sort((a, b) => b.classes - a.classes);
}

// --- D8: what Reports asks that nothing else did --------------------------

export type DayBookings = {
  /** Studio-local calendar date, `YYYY-MM-DD`. */
  date: string;
  bookings: number;
  seats: number;
};

/**
 * Bookings per day, bucketed exactly like `revenueByDay`.
 *
 * A separate function rather than another column on the revenue series,
 * because the two count different things at different moments: revenue is
 * attributed to the day money LANDED (`succeededAt`), and a booking to the day
 * the class RUNS. Folding them into one row would silently invite the reader
 * to compare a bar against the bar beside it as though both described the same
 * event, and on any day with an advance payment they do not.
 *
 * Same day boundaries as everything else here — the studio's midnight.
 */
export async function bookingsByDay(
  organizationId: string,
  opts: { days: number; now?: Date },
): Promise<DayBookings[]> {
  const timezone = await timezoneOf(organizationId);
  const now = opts.now ?? new Date();

  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  const firstDay = today.minus({ days: opts.days - 1 });

  const bookings = await prisma.booking.findMany({
    where: {
      organizationId,
      ...LIVE_BOOKING,
      startsAt: {
        gte: firstDay.toJSDate(),
        lte: today.endOf('day').toJSDate(),
      },
    },
    select: { startsAt: true, seats: true },
  });

  const buckets = new Map<string, { bookings: number; seats: number }>();
  for (let i = 0; i < opts.days; i++) {
    buckets.set(firstDay.plus({ days: i }).toISODate()!, { bookings: 0, seats: 0 });
  }

  for (const booking of bookings) {
    const key = DateTime.fromJSDate(booking.startsAt, { zone: timezone }).toISODate();
    const bucket = key ? buckets.get(key) : undefined;
    if (bucket) {
      bucket.bookings += 1;
      bucket.seats += booking.seats;
    }
  }

  return [...buckets.entries()].map(([date, counts]) => ({ date, ...counts }));
}

export type ServiceOccupancy = {
  serviceTypeId: string;
  /** Seats sold across every session of this class in the window. */
  seatsTaken: number;
  /** Seats the studio actually put on sale. */
  capacity: number;
};

/**
 * How full each class ran.
 *
 * Read from SESSIONS, not bookings, and that is the whole point: only a
 * session knows how many seats were OFFERED. A class that sold four seats is
 * either thriving or emptying depending on whether it had six or twenty, and
 * bookings alone cannot tell those apart.
 *
 * Appointments have no session at all, so they are simply absent from this
 * result rather than present with a zero. The screen renders their occupancy
 * as "—", because "0%" would be a claim about a class that never had seats to
 * fill, and a private lesson is not a class that failed to sell out.
 *
 * Cancelled sessions are excluded: seats that were withdrawn were never on
 * sale, and counting them would make a studio that cancelled a snow day look
 * like one nobody wanted to book.
 */
export async function serviceOccupancy(
  organizationId: string,
  opts: { days: number; now?: Date },
): Promise<ServiceOccupancy[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * 86_400_000);

  const grouped = await prisma.session.groupBy({
    by: ['serviceTypeId'],
    where: {
      organizationId,
      status: 'SCHEDULED',
      startsAt: { gte: since, lte: now },
    },
    _sum: { seatsTaken: true, capacity: true },
  });

  return grouped.map((row) => ({
    serviceTypeId: row.serviceTypeId,
    seatsTaken: row._sum.seatsTaken ?? 0,
    capacity: row._sum.capacity ?? 0,
  }));
}

export type LeadTime = {
  /** The middle booking. Null when nothing was booked in the window. */
  medianDays: number | null;
  averageDays: number | null;
  /** How many bookings the figures are drawn from. */
  sample: number;
};

/**
 * How far ahead people book.
 *
 * The median leads, and the average is reported beside it rather than instead
 * of it. Lead times are long-tailed by nature — one person books a six-week
 * course in January for April and drags the mean past anything a studio would
 * recognise — so the mean alone answers "how far ahead do people book" with a
 * number almost nobody actually booked at.
 *
 * Measured from when the booking was CREATED to when the class starts, over
 * classes running in the window. Negative values are impossible by
 * construction and clamped anyway: a studio adding a booking for a class that
 * already started (the front desk catching up after a busy evening) is a real
 * thing that would otherwise subtract from the figure.
 */
export async function leadTime(
  organizationId: string,
  opts: { days: number; now?: Date },
): Promise<LeadTime> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * 86_400_000);

  const bookings = await prisma.booking.findMany({
    where: {
      organizationId,
      ...LIVE_BOOKING,
      startsAt: { gte: since, lte: now },
    },
    select: { createdAt: true, startsAt: true },
  });

  if (bookings.length === 0) {
    return { medianDays: null, averageDays: null, sample: 0 };
  }

  const days = bookings
    .map((b) =>
      Math.max(0, (b.startsAt.getTime() - b.createdAt.getTime()) / 86_400_000),
    )
    .sort((a, b) => a - b);

  const middle = Math.floor(days.length / 2);
  const median =
    days.length % 2 === 0
      ? (days[middle - 1]! + days[middle]!) / 2
      : days[middle]!;

  const average = days.reduce((sum, d) => sum + d, 0) / days.length;

  return {
    medianDays: Math.round(median),
    averageDays: Math.round(average),
    sample: days.length,
  };
}

export type WeekdayPerformance = {
  /** 1 = Monday … 7 = Sunday, matching Luxon's `weekday`. */
  weekday: number;
  bookings: number;
  seats: number;
  revenueCents: number;
};

/**
 * Which day of the week earns.
 *
 * The one figure on this screen a studio can act on the same afternoon: it
 * decides which evening gets another class on the timetable. Grouped in the
 * STUDIO's zone — a Sunday 9am class in Los Angeles is stamped Sunday 16:00
 * UTC, and grouping on UTC would file half a studio's weekend under Monday.
 *
 * Every weekday is present even with nothing on it, so the table reads as
 * "Tuesday earns nothing" rather than leaving the reader to notice Tuesday is
 * missing.
 */
export async function weekdayPerformance(
  organizationId: string,
  opts: { days: number; now?: Date },
): Promise<WeekdayPerformance[]> {
  const timezone = await timezoneOf(organizationId);
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * 86_400_000);

  const bookings = await prisma.booking.findMany({
    where: {
      organizationId,
      ...LIVE_BOOKING,
      startsAt: { gte: since, lte: now },
    },
    select: {
      startsAt: true,
      seats: true,
      payments: { select: { amountCents: true, refundedCents: true, status: true } },
    },
  });

  const byWeekday = new Map<number, WeekdayPerformance>();
  for (let weekday = 1; weekday <= 7; weekday++) {
    byWeekday.set(weekday, { weekday, bookings: 0, seats: 0, revenueCents: 0 });
  }

  for (const booking of bookings) {
    const weekday = DateTime.fromJSDate(booking.startsAt, {
      zone: timezone,
    }).weekday;

    const row = byWeekday.get(weekday)!;
    row.bookings += 1;
    row.seats += booking.seats;
    row.revenueCents += paidCentsOf(booking.payments);
  }

  return [...byWeekday.values()];
}

export type CustomerTotals = {
  total: number;
  /** Customers with more than one booking, ever. */
  repeat: number;
  repeatRate: number;
  /** Everything ever received, divided by everyone on the books. */
  averageSpendCents: number;
};

/**
 * The customer base as a whole, not the window.
 *
 * Deliberately unwindowed, and the screen says so. "How many customers do we
 * have" and "how many of them come back" are questions about the business
 * rather than about the last thirty days, and answering them inside the range
 * would make the repeat rate collapse every time somebody chose a shorter one
 * — a studio with a healthy base would read as having no repeat customers at
 * all on the Today window.
 *
 * The spend average is two aggregates rather than a per-customer rollup:
 * everything received, over everyone on the books. That includes people who
 * have never paid, which is the honest denominator for "what is a customer
 * worth" — excluding them would quietly measure only the customers who
 * already spent.
 */
export async function customerTotals(
  organizationId: string,
): Promise<CustomerTotals> {
  const [total, byCustomer, money] = await Promise.all([
    prisma.customer.count({ where: { organizationId } }),

    prisma.booking.groupBy({
      by: ['customerId'],
      where: { organizationId, ...LIVE_BOOKING },
      _count: { _all: true },
    }),

    prisma.payment.aggregate({
      where: { organizationId, ...MONEY_IN },
      _sum: { amountCents: true, refundedCents: true },
    }),
  ]);

  const repeat = byCustomer.filter((row) => row._count._all > 1).length;

  /* Net across the whole table: summing both columns and subtracting is the
     same rule as `net()` applied in SQL, and the only way to get it without
     loading every payment row. */
  const receivedCents =
    (money._sum.amountCents ?? 0) - (money._sum.refundedCents ?? 0);

  return {
    total,
    repeat,
    repeatRate: total > 0 ? Math.round((repeat / total) * 100) : 0,
    averageSpendCents: total > 0 ? Math.round(receivedCents / total) : 0,
  };
}
