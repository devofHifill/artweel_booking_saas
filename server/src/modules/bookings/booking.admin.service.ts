import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import type { PaymentStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { paidCentsOf } from '../analytics/analytics.service';
import { AppError } from '../../lib/app-error';
import { logger } from '../../lib/logger';
import { bookAppointment, bookSeats, cancelBooking } from '../../scheduling/booking.service';
import { getAvailability } from '../../scheduling/availability/availability.service';

/**
 * Studio-side booking management.
 *
 * Everything here runs through the same scheduling core as the public path.
 * A studio taking a booking over the phone must be subject to the same
 * overlap and capacity rules as a customer on the website — a back door that
 * skips them is how double bookings get created by the people least able to
 * explain them.
 */

export type BookingListFilters = {
  from?: Date;
  to?: Date;
  status?: string[];
  staffId?: string;
  serviceTypeId?: string;
  /** Matches customer name, email or phone. */
  search?: string;
  limit: number;
  cursor?: string;
};

export async function listBookings(
  organizationId: string,
  filters: BookingListFilters,
) {
  const where = {
    organizationId,
    ...(filters.from || filters.to
      ? {
          startsAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    ...(filters.status?.length ? { status: { in: filters.status as never } } : {}),
    ...(filters.staffId ? { staffId: filters.staffId } : {}),
    ...(filters.serviceTypeId ? { serviceTypeId: filters.serviceTypeId } : {}),
    ...(filters.search
      ? {
          customer: {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' as const } },
              { email: { contains: filters.search, mode: 'insensitive' as const } },
              { phone: { contains: filters.search } },
            ],
          },
        }
      : {}),
  };

  const rows = await prisma.booking.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      serviceType: { select: { id: true, name: true, color: true, bookingMode: true } },
      staff: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      payments: { select: { amountCents: true, refundedCents: true, status: true } },
    },
    orderBy: { startsAt: 'asc' },
    // Cursor pagination, not offset: a studio scrolling a busy month while
    // bookings are being made would otherwise see rows repeat or vanish.
    take: filters.limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;

  /**
   * How many bookings sit behind each status tab.
   *
   * Counted with EVERY filter except `status` — which is the only shape that
   * makes the tabs mean anything. A tab row that re-counted under its own
   * filter would read "Cancelled 4" while showing four cancelled bookings and
   * "Confirmed 0" beside it, which is worse than no counts at all.
   *
   * A `groupBy` rather than five counts: one query, and the statuses come back
   * from the data instead of from a list here that could fall behind the enum.
   */
  const { status: _ignored, ...whereWithoutStatus } = where;

  const grouped = await prisma.booking.groupBy({
    by: ['status'],
    where: whereWithoutStatus,
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of grouped) {
    counts[row.status] = row._count._all;
    total += row._count._all;
  }

  return {
    bookings: page.map(toListItem),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
    counts: { total, ...counts },
  };
}

function toListItem(booking: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  status: string;
  seats: number;
  totalCents: number;
  notes: string | null;
  customer: { id: string; name: string; email: string; phone: string | null };
  serviceType: { id: string; name: string; color: string; bookingMode: string };
  staff: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  payments: {
    amountCents: number;
    refundedCents: number;
    status: PaymentStatus;
  }[];
}) {
  /* Was a fourth hand-copy of the money rule until D5. `paidCentsOf` is the
     one definition — successful payments minus refunds — and it exists so the
     dashboard, the manifest, this list and the customer list cannot disagree
     about what a booking is worth. */
  const paidCents = paidCentsOf(booking.payments);

  return {
    id: booking.id,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    timezone: booking.timezone,
    status: booking.status,
    seats: booking.seats,
    totalCents: booking.totalCents,
    paidCents,
    outstandingCents: Math.max(0, booking.totalCents - paidCents),
    notes: booking.notes,
    customer: booking.customer,
    service: booking.serviceType,
    staff: booking.staff,
    location: booking.location,
  };
}

export async function getBooking(organizationId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId },
    include: {
      customer: true,
      serviceType: true,
      staff: { select: { id: true, name: true } },
      location: true,
      session: { select: { id: true, capacity: true, seatsTaken: true } },
      payments: { include: { refunds: true } },
      notifications: {
        select: {
          id: true,
          channel: true,
          templateKey: true,
          status: true,
          sentAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!booking) throw AppError.notFound('Booking not found.');
  return booking;
}

/**
 * The Today view.
 *
 * Answers the four questions a studio owner actually opens the app for:
 * who is coming, what needs attention, is anything unpaid, and did the
 * plumbing break.
 */
export async function getToday(organizationId: string, now = new Date()) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true, currency: true, stripeChargesEnabled: true },
  });

  // "Today" is the studio's day, not UTC's and not the viewer's.
  const local = DateTime.fromJSDate(now, { zone: org.timezone });
  const dayStart = local.startOf('day').toJSDate();
  const dayEnd = local.endOf('day').toJSDate();
  const weekEnd = local.plus({ days: 7 }).endOf('day').toJSDate();

  const [todays, upcoming, unpaid, failedNotifications, staleCalendars] =
    await Promise.all([
      prisma.booking.findMany({
        where: {
          organizationId,
          startsAt: { gte: dayStart, lte: dayEnd },
          status: { in: ['PENDING', 'CONFIRMED', 'ATTENDED'] },
        },
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          serviceType: { select: { id: true, name: true, color: true, bookingMode: true } },
          staff: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          payments: { select: { amountCents: true, refundedCents: true, status: true } },
        },
        orderBy: { startsAt: 'asc' },
      }),

      prisma.booking.count({
        where: {
          organizationId,
          startsAt: { gt: dayEnd, lte: weekEnd },
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
      }),

      prisma.booking.findMany({
        where: {
          organizationId,
          status: { in: ['PENDING', 'CONFIRMED'] },
          startsAt: { gte: dayStart },
          totalCents: { gt: 0 },
        },
        select: {
          id: true,
          totalCents: true,
          payments: { select: { amountCents: true, refundedCents: true, status: true } },
        },
      }),

      // Plumbing failures the studio would otherwise never learn about.
      prisma.notification.count({
        where: { organizationId, status: 'FAILED' },
      }),

      prisma.calendarConnection.count({
        where: { organizationId, status: 'NEEDS_REAUTH' },
      }),
    ]);

  const outstandingCents = unpaid.reduce((sum, booking) => {
    const paid = booking.payments
      .filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED')
      .reduce((s, p) => s + p.amountCents - p.refundedCents, 0);
    return sum + Math.max(0, booking.totalCents - paid);
  }, 0);

  return {
    timezone: org.timezone,
    currency: org.currency,
    today: todays.map(toListItem),
    stats: {
      todayCount: todays.length,
      todaySeats: todays.reduce((s, b) => s + b.seats, 0),
      upcomingWeek: upcoming,
      outstandingCents,
    },
    alerts: {
      paymentsNotEnabled: !org.stripeChargesEnabled,
      failedNotifications,
      calendarsNeedingReauth: staleCalendars,
    },
  };
}

/**
 * A booking taken by the studio — over the phone, at the counter.
 *
 * Deliberately routed through the same core as a public booking. The only
 * difference permitted is skipping the minimum-notice window: a customer
 * standing at the desk asking about the class starting in twenty minutes is
 * exactly who that rule was never meant to stop.
 */
export async function createManualBooking(
  organizationId: string,
  input: {
    serviceTypeId: string;
    sessionId?: string;
    staffId?: string;
    startsAt?: Date;
    seats: number;
    customer: { name: string; email: string; phone?: string };
    notes?: string;
  },
) {
  const service = await prisma.serviceType.findFirst({
    where: { id: input.serviceTypeId, organizationId },
  });
  if (!service) throw AppError.notFound('Service not found.');

  const email = input.customer.email.trim().toLowerCase();

  const customer =
    (await prisma.customer.findFirst({ where: { organizationId, email } })) ??
    (await prisma.customer.create({
      data: {
        organizationId,
        email,
        name: input.customer.name.trim(),
        phone: input.customer.phone,
      },
    }));

  let booking;

  if (service.bookingMode === 'APPOINTMENT') {
    if (!input.staffId || !input.startsAt) {
      throw AppError.badRequest('An appointment needs a staff member and a time.');
    }

    booking = await bookAppointment({
      organizationId,
      staffId: input.staffId,
      serviceTypeId: service.id,
      customerId: customer.id,
      startsAt: input.startsAt,
      endsAt: new Date(
        input.startsAt.getTime() + service.durationMinutes * 60_000,
      ),
      timezone: (
        await prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: { timezone: true },
        })
      ).timezone,
      paddingBeforeMinutes: service.paddingBeforeMinutes,
      paddingAfterMinutes: service.paddingAfterMinutes,
      source: 'admin',
    });
  } else {
    if (!input.sessionId) throw AppError.badRequest('Pick a class date.');

    booking = await bookSeats({
      organizationId,
      sessionId: input.sessionId,
      customerId: customer.id,
      seats: input.seats,
      source: 'admin',
      notes: input.notes,
    });
  }

  const updated = await prisma.booking.update({
    where: { id: booking!.id },
    data: { totalCents: service.priceCents * input.seats, notes: input.notes },
  });

  await afterBookingChange(updated.id, 'UPSERT');
  return updated;
}

export async function cancelBookingAsStudio(
  organizationId: string,
  bookingId: string,
  opts: { refund?: boolean; reason?: string } = {},
) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId },
  });
  if (!booking) throw AppError.notFound('Booking not found.');
  if (booking.status === 'CANCELLED') {
    return { cancelled: true, alreadyCancelled: true, refundedCents: 0 };
  }

  await cancelBooking(organizationId, bookingId);

  let refundedCents = 0;

  if (opts.refund !== false) {
    const { refundForCancellation } = await import(
      '../payments/payment.service'
    );
    const refund = await refundForCancellation(organizationId, bookingId, {
      reason: opts.reason ?? 'cancelled_by_studio',
    }).catch((err) => {
      logger.error({ err, bookingId }, 'Studio cancellation refund failed');
      return { refundedCents: 0, creditCents: 0, refunds: [] };
    });
    refundedCents = refund.refundedCents;
  }

  const { notifyCancellation } = await import(
    '../notifications/notification.service'
  );
  await notifyCancellation(bookingId, { refundCents: refundedCents }).catch(
    () => {},
  );

  await afterBookingChange(bookingId, 'DELETE');

  return { cancelled: true, alreadyCancelled: false, refundedCents };
}

/**
 * Moves an appointment.
 *
 * Cancel-then-rebook rather than an in-place update, for the same reason the
 * customer-facing path does it: editing the rows would leave the instructor's
 * time block briefly overlapping itself, and the exclusion constraint would
 * reject the studio's own move.
 */
export async function rescheduleBooking(
  organizationId: string,
  bookingId: string,
  newStartsAt: Date,
) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId },
    include: { serviceType: true },
  });
  if (!booking) throw AppError.notFound('Booking not found.');
  if (booking.status === 'CANCELLED') {
    throw AppError.badRequest('This booking has been cancelled.');
  }
  if (booking.serviceType.bookingMode !== 'APPOINTMENT') {
    throw AppError.badRequest(
      'Class bookings cannot be moved. Cancel and rebook onto another date.',
      'NOT_RESCHEDULABLE',
    );
  }
  if (!booking.staffId) {
    throw AppError.badRequest('This booking has no instructor assigned.');
  }

  const endsAt = new Date(
    newStartsAt.getTime() + booking.serviceType.durationMinutes * 60_000,
  );

  await cancelBooking(organizationId, bookingId);

  try {
    const replacement = await bookAppointment({
      organizationId,
      staffId: booking.staffId,
      serviceTypeId: booking.serviceTypeId,
      customerId: booking.customerId,
      startsAt: newStartsAt,
      endsAt,
      timezone: booking.timezone,
      locationId: booking.locationId,
      paddingBeforeMinutes: booking.serviceType.paddingBeforeMinutes,
      paddingAfterMinutes: booking.serviceType.paddingAfterMinutes,
      source: 'admin-reschedule',
    });

    await prisma.booking.update({
      where: { id: replacement!.id },
      data: { totalCents: booking.totalCents, notes: booking.notes },
    });

    await afterBookingChange(bookingId, 'DELETE');
    await afterBookingChange(replacement!.id, 'UPSERT');

    const { notifyReschedule, scheduleBookingNotifications } = await import(
      '../notifications/notification.service'
    );
    await scheduleBookingNotifications(replacement!.id).catch(() => {});
    await notifyReschedule(replacement!.id).catch(() => {});

    return replacement;
  } catch (err) {
    // Put the original back so a failed move does not leave the customer with
    // nothing at all.
    await bookAppointment({
      organizationId,
      staffId: booking.staffId,
      serviceTypeId: booking.serviceTypeId,
      customerId: booking.customerId,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      timezone: booking.timezone,
      locationId: booking.locationId,
      source: 'admin-reschedule-rollback',
    }).catch(() => {});

    throw err;
  }
}

/**
 * Records whether someone turned up.
 *
 * `CONFIRMED` is the undo: it puts a booking back to "expected", which is what
 * a studio needs after tapping the wrong row on a phone.
 *
 * Two things are refused, both because the alternative silently corrupts the
 * record a make-up credit will later be computed from:
 *
 *   A FUTURE CLASS. Nobody has attended or missed a class that has not
 *   started. The check is against the START, not the end, so a register can
 *   be marked while the class is running — which is when instructors actually
 *   do it.
 *
 *   A CANCELLED BOOKING. Somebody who cancelled in advance is not a no-show;
 *   they are not on the register at all. Conflating the two would make a
 *   student look unreliable for doing exactly the right thing.
 */
export async function markAttendance(
  organizationId: string,
  bookingId: string,
  status: 'ATTENDED' | 'NO_SHOW' | 'CONFIRMED',
) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId },
  });
  if (!booking) throw AppError.notFound('Booking not found.');

  if (booking.status === 'CANCELLED') {
    throw AppError.conflict(
      'This booking was cancelled, so there is no attendance to record.',
      'BOOKING_CANCELLED',
    );
  }

  if (booking.startsAt > new Date()) {
    throw AppError.conflict(
      'This class has not started yet.',
      'SESSION_NOT_STARTED',
    );
  }

  return prisma.booking.update({
    where: { id: bookingId },
    data: { status },
  });
}

/** Slots the studio can move a booking into, from the same engine as the public page. */
export async function reschedulingOptions(
  organizationId: string,
  bookingId: string,
  fromLocalDate: string,
  toLocalDate: string,
) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId },
  });
  if (!booking) throw AppError.notFound('Booking not found.');

  const availability = await getAvailability({
    organizationId,
    serviceTypeId: booking.serviceTypeId,
    staffId: booking.staffId ?? undefined,
    locationId: booking.locationId ?? undefined,
    fromLocalDate,
    toLocalDate,
    // The studio is standing in front of the customer; the notice window is
    // for the website, not for them.
    now: new Date(0),
  });

  return { slots: availability.slots, sessions: availability.sessions };
}

async function afterBookingChange(
  bookingId: string,
  action: 'UPSERT' | 'DELETE',
) {
  const { queueEventSync } = await import('../calendar/calendar.service');
  await queueEventSync({ bookingId, action }).catch((err) => {
    logger.error({ err, bookingId }, 'Calendar sync queue failed');
  });
}

// --- Customers -------------------------------------------------------------

export type CustomerSort = 'name' | 'spent' | 'bookings' | 'recent';

export async function listCustomers(
  organizationId: string,
  opts: { search?: string; limit: number; sort?: CustomerSort },
) {
  const rows = await prisma.customer.findMany({
    where: {
      organizationId,
      ...(opts.search
        ? {
            OR: [
              { name: { contains: opts.search, mode: 'insensitive' } },
              { email: { contains: opts.search, mode: 'insensitive' } },
              { phone: { contains: opts.search } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      smsConsentAt: true,
      smsOptedOutAt: true,
      createdAt: true,
      /**
       * Cancelled bookings are excluded from the count.
       *
       * A reschedule is implemented as cancel-then-rebook, so a customer who
       * moved a lesson once would otherwise show "2 bookings" for a single
       * appointment — which reads as a data error to the person looking at it.
       */
      _count: {
        select: { bookings: { where: { status: { not: 'CANCELLED' } } } },
      },
      /**
       * What they have spent, and when they were last in (D5).
       *
       * Selected alongside rather than aggregated in SQL because the money
       * rule is `paidCentsOf` — successful payments minus refunds — and that
       * lives in one place on purpose. A `_sum` here would be a second
       * definition of "spent" that drifts from the dashboard the first time
       * refund handling changes.
       *
       * The cost is real and bounded: this list is capped at 200 customers and
       * a studio's payment rows are hundreds, not millions. If that stops
       * being true the fix is a materialised per-customer rollup, not a
       * cleverer query here.
       */
      bookings: {
        where: { status: { not: 'CANCELLED' } },
        select: {
          startsAt: true,
          payments: {
            select: { amountCents: true, refundedCents: true, status: true },
          },
        },
      },
    },
    take: opts.limit,
  });

  const now = Date.now();

  const projected = rows.map((customer) => {
    const { bookings, ...rest } = customer;

    const spentCents = bookings.reduce(
      (sum, booking) => sum + paidCentsOf(booking.payments),
      0,
    );

    /**
     * Their most recent visit that has actually HAPPENED.
     *
     * A booking three weeks out is not a visit, and letting it win would sort
     * somebody who booked ahead above somebody who was here yesterday — under
     * a column labelled "last visit".
     */
    const past = bookings
      .map((b) => b.startsAt)
      .filter((at) => at.getTime() <= now);
    const lastVisit =
      past.length > 0
        ? past.reduce((latest, at) => (at > latest ? at : latest))
        : null;

    return { ...rest, spentCents, lastVisit };
  });

  /*
    Sorted in JS rather than by the database, because two of the four keys —
    spend and last visit — are derived above and cannot be ordered by in the
    query that produced them. Doing one in SQL and the others here would make
    `limit` mean something different depending on which sort was chosen, which
    is the kind of inconsistency nobody thinks to test.
  */
  const sorted = [...projected];
  switch (opts.sort) {
    case 'spent':
      sorted.sort((a, b) => b.spentCents - a.spentCents);
      break;
    case 'bookings':
      sorted.sort((a, b) => b._count.bookings - a._count.bookings);
      break;
    case 'recent':
      sorted.sort(
        (a, b) => (b.lastVisit?.getTime() ?? 0) - (a.lastVisit?.getTime() ?? 0),
      );
      break;
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name));
  }

  return sorted;
}

export async function getCustomer(organizationId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId },
    include: {
      bookings: {
        include: {
          serviceType: { select: { name: true, color: true } },
          staff: { select: { name: true } },
        },
        orderBy: { startsAt: 'desc' },
        take: 50,
      },
    },
  });

  if (!customer) throw AppError.notFound('Customer not found.');

  const attended = customer.bookings.filter((b) => b.status === 'ATTENDED').length;
  const noShows = customer.bookings.filter((b) => b.status === 'NO_SHOW').length;

  return {
    ...customer,
    stats: {
      // Same reasoning as the list: a rescheduled booking leaves a cancelled
      // row behind, and counting it would double the customer's history.
      total: customer.bookings.filter((b) => b.status !== 'CANCELLED').length,
      attended,
      noShows,
      lifetimeCents: customer.bookings
        .filter((b) => b.status !== 'CANCELLED')
        .reduce((s, b) => s + b.totalCents, 0),
    },
  };
}

export { randomBytes };
