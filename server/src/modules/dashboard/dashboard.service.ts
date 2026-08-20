import { DateTime } from 'luxon';
import type { BookingStatus, PaymentStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import * as analytics from '../analytics/analytics.service';

/**
 * The dashboard, composed in one request.
 *
 * Nine blocks, one round trip. Fetching them separately would mean nine chances
 * to render a half-built page and nine spinners resolving out of order, on the
 * screen a studio opens first every morning.
 *
 * Most of the numbers come from `analytics`, which exists so this screen and
 * Reports cannot disagree about what "revenue this week" means. What is
 * assembled here is the part only a dashboard wants: today's running order, the
 * last few bookings, who is teaching, and the short list of things that are
 * wrong.
 */

const MONEY_IN_STATUSES: PaymentStatus[] = ['SUCCEEDED', 'PARTIALLY_REFUNDED'];
const LIVE_BOOKING_STATUSES: BookingStatus[] = ['PENDING', 'CONFIRMED', 'ATTENDED'];

/** Net of refunds — the same rule as analytics and `outstandingCents`. */
function paidCents(
  payments: { amountCents: number; refundedCents: number; status: PaymentStatus }[],
): number {
  return payments
    .filter((p) => MONEY_IN_STATUSES.includes(p.status))
    .reduce((sum, p) => sum + p.amountCents - p.refundedCents, 0);
}

export type ScheduleRow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  serviceName: string;
  color: string;
  staffName: string | null;
  locationName: string | null;
  booked: number;
  capacity: number;
  revenueCents: number;
  /** Appointments have no session behind them; the UI links them differently. */
  kind: 'class' | 'appointment';
};

/**
 * Today's running order.
 *
 * Built from SESSIONS rather than by grouping bookings, which is what the old
 * Today page did. Grouping bookings can only ever report how many people are
 * coming; it has no idea how many seats there were, so it could not show
 * capacity. Reading sessions gives `booked / capacity` and the fill bar that
 * makes the panel worth looking at.
 *
 * Appointments are merged in afterwards. They have no session — the booking
 * hangs off a staff member instead — so a studio whose day is private lessons
 * would otherwise open the product to an empty schedule and reasonably conclude
 * it was broken.
 */
async function todaySchedule(
  organizationId: string,
  start: Date,
  end: Date,
): Promise<ScheduleRow[]> {
  const [sessions, appointments] = await Promise.all([
    prisma.session.findMany({
      where: {
        organizationId,
        startsAt: { gte: start, lte: end },
        status: 'SCHEDULED',
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        seatsTaken: true,
        serviceType: { select: { name: true, color: true } },
        staff: { select: { name: true } },
        location: { select: { name: true } },
        bookings: {
          where: { status: { in: LIVE_BOOKING_STATUSES } },
          select: {
            payments: {
              select: { amountCents: true, refundedCents: true, status: true },
            },
          },
        },
      },
      orderBy: { startsAt: 'asc' },
    }),

    prisma.booking.findMany({
      where: {
        organizationId,
        sessionId: null,
        status: { in: LIVE_BOOKING_STATUSES },
        startsAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        seats: true,
        serviceType: { select: { name: true, color: true } },
        staff: { select: { name: true } },
        location: { select: { name: true } },
        payments: {
          select: { amountCents: true, refundedCents: true, status: true },
        },
      },
      orderBy: { startsAt: 'asc' },
    }),
  ]);

  const rows: ScheduleRow[] = [
    ...sessions.map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      serviceName: s.serviceType.name,
      color: s.serviceType.color,
      staffName: s.staff?.name ?? null,
      locationName: s.location?.name ?? null,
      booked: s.seatsTaken,
      capacity: s.capacity,
      revenueCents: s.bookings.reduce((sum, b) => sum + paidCents(b.payments), 0),
      kind: 'class' as const,
    })),

    ...appointments.map((b) => ({
      id: b.id,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      serviceName: b.serviceType.name,
      color: b.serviceType.color,
      staffName: b.staff?.name ?? null,
      locationName: b.location?.name ?? null,
      booked: b.seats,
      /* An appointment is its own capacity: it is booked or it does not exist.
         Reporting 1/1 keeps one shape for the row rather than a second variant
         the UI has to branch on. */
      capacity: b.seats,
      revenueCents: paidCents(b.payments),
      kind: 'appointment' as const,
    })),
  ];

  return rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export type RecentBooking = {
  id: string;
  createdAt: Date;
  startsAt: Date;
  customerId: string;
  customerName: string;
  serviceName: string;
  seats: number;
  totalCents: number;
  status: string;
  /** Derived, not stored: PAID · PART_PAID · UNPAID. */
  paymentStatus: 'PAID' | 'PART_PAID' | 'UNPAID';
};

/** The last few bookings taken, newest first — by when they were MADE. */
async function recentBookings(
  organizationId: string,
  take: number,
): Promise<RecentBooking[]> {
  const bookings = await prisma.booking.findMany({
    where: { organizationId },
    select: {
      id: true,
      createdAt: true,
      startsAt: true,
      seats: true,
      totalCents: true,
      status: true,
      customer: { select: { id: true, name: true } },
      serviceType: { select: { name: true } },
      payments: { select: { amountCents: true, refundedCents: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  });

  return bookings.map((b) => {
    const paid = paidCents(b.payments);

    return {
      id: b.id,
      createdAt: b.createdAt,
      startsAt: b.startsAt,
      customerId: b.customer.id,
      customerName: b.customer.name,
      serviceName: b.serviceType.name,
      seats: b.seats,
      totalCents: b.totalCents,
      status: b.status,
      /*
        A free booking counts as paid. Otherwise every complimentary class and
        every zero-price taster sits in the dashboard forever as an unpaid
        booking nobody can collect on.
      */
      paymentStatus:
        b.totalCents === 0 || paid >= b.totalCents
          ? 'PAID'
          : paid > 0
            ? 'PART_PAID'
            : 'UNPAID',
    };
  });
}

/**
 * Money still owed, across everything still ahead.
 *
 * Same computation as `getToday.outstandingCents`, deliberately — two places
 * quoting a different "outstanding" is exactly the drift the analytics module
 * exists to prevent, and this one is on the same screen as the revenue chart.
 */
async function outstandingCents(
  organizationId: string,
  since: Date,
): Promise<number> {
  const bookings = await prisma.booking.findMany({
    where: {
      organizationId,
      status: { in: ['PENDING', 'CONFIRMED'] },
      startsAt: { gte: since },
      totalCents: { gt: 0 },
    },
    select: {
      totalCents: true,
      payments: { select: { amountCents: true, refundedCents: true, status: true } },
    },
  });

  return bookings.reduce(
    (sum, b) => sum + Math.max(0, b.totalCents - paidCents(b.payments)),
    0,
  );
}

export type Instructor = {
  name: string;
  classes: number;
  seats: number;
};

/** Who is teaching today, and how much of the day each is carrying. */
function instructorsFrom(rows: ScheduleRow[]): Instructor[] {
  const byName = new Map<string, Instructor>();

  for (const row of rows) {
    if (!row.staffName) continue;
    const entry = byName.get(row.staffName) ?? {
      name: row.staffName,
      classes: 0,
      seats: 0,
    };
    entry.classes += 1;
    entry.seats += row.booked;
    byName.set(row.staffName, entry);
  }

  return [...byName.values()].sort((a, b) => b.classes - a.classes);
}

export type AttentionItem = {
  id: 'pending' | 'owed' | 'unstaffed' | 'uncollected';
  count: number;
  /** Plural form, used for every count except one. */
  label: string;
  /**
   * Singular form, sent rather than derived.
   *
   * The client cannot strip an "s" and be right: "1 bookings awaiting payment"
   * needs "booking awaiting payment", and "1 classes this week with no
   * instructor" needs "class this week…" — the plural is in the middle of the
   * phrase, not at the end. Sending both forms costs four strings and removes a
   * whole category of wrong-looking copy.
   */
  labelOne: string;
  /** Where the owner goes to deal with it. */
  href: string;
};

export async function getDashboard(organizationId: string, now = new Date()) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true, currency: true, name: true },
  });

  const local = DateTime.fromJSDate(now, { zone: org.timezone });
  const start = local.startOf('day').toJSDate();
  const end = local.endOf('day').toJSDate();
  const yesterday = local.minus({ days: 1 }).toJSDate();

  const [
    today,
    priorDay,
    upcoming,
    owed,
    schedule,
    recent,
    revenue,
    popular,
    sources,
    unstaffed,
    uncollected,
    pendingBookings,
  ] = await Promise.all([
    analytics.dayFigures(organizationId, { date: now }),
    analytics.dayFigures(organizationId, { date: yesterday }),
    analytics.upcomingSessions(organizationId, { days: 7, now }),
    outstandingCents(organizationId, start),
    todaySchedule(organizationId, start, end),
    recentBookings(organizationId, 7),
    analytics.revenueByDay(organizationId, { days: 7, now }),
    analytics.popularServices(organizationId, { days: 30, limit: 5, now }),
    analytics.bookingSources(organizationId, { days: 30, now }),
    analytics.unstaffedSessions(organizationId, { days: 7, now }),
    analytics.uncollectedPieces(organizationId, { now }),
    prisma.booking.count({
      where: { organizationId, status: 'PENDING', startsAt: { gte: start } },
    }),
  ]);

  /*
    The attention list.

    Two of these four replace TourFlow's "guests have not signed a waiver" row,
    which cannot be built here because waivers do not exist. Substituting a
    different real problem is honest; rendering a zero for a feature the product
    does not have would be a lie with a number on it.

    Rows with a count of zero are kept rather than filtered. A list that empties
    itself gives no signal that the check ran at all, and "0 classes without an
    instructor" is a useful thing to have read.
  */
  const attention: AttentionItem[] = [
    {
      id: 'pending',
      count: pendingBookings,
      label: 'bookings awaiting payment or confirmation',
      labelOne: 'booking awaiting payment or confirmation',
      href: '/bookings',
    },
    {
      id: 'owed',
      count: owed > 0 ? 1 : 0,
      /* Both forms are the same here: the client renders the AMOUNT in front of
         it, not a count, so this phrase never has to agree with a number. */
      label: 'owed across upcoming bookings',
      labelOne: 'owed across upcoming bookings',
      href: '/payments',
    },
    {
      id: 'unstaffed',
      count: unstaffed.length,
      label: 'classes this week with no instructor',
      labelOne: 'class this week with no instructor',
      href: '/calendar',
    },
    {
      id: 'uncollected',
      count: uncollected,
      label: 'finished pieces past their pickup date',
      labelOne: 'finished piece past its pickup date',
      href: '/studio/pieces',
    },
  ];

  return {
    studio: { name: org.name, currency: org.currency, timezone: org.timezone },
    figures: {
      today,
      yesterday: priorDay,
      upcomingSessions: upcoming,
      outstandingCents: owed,
    },
    schedule,
    recent,
    revenue,
    popular,
    sources,
    attention,
    instructors: instructorsFrom(schedule),
    /*
      Stated rather than implied. The embed widget posts through the same public
      route as the booking page, so both write `web` and the donut cannot
      separate them. The screen says so; presenting two slices as the whole
      picture would be worse than admitting the gap.
    */
    sourcesCaveat: 'web covers both the booking page and the embedded widget',
  };
}
