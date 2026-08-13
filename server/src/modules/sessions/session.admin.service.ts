import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/app-error';
import { markAttendance } from '../bookings/booking.admin.service';
import { createSession, cancelSession } from '../../scheduling/session.service';
import { cancelBooking } from '../../scheduling/booking.service';
import { expandLocalDates } from '../../scheduling/time/recurrence';
import { resolveLocal } from '../../scheduling/time/zoned';

/**
 * Sessions and their registers.
 *
 * A register belongs to a SESSION, not to a course. Week three of a six-week
 * course and a Saturday drop-in class are the same thing to an instructor
 * holding a phone: a list of people who should be in the room. Attaching the
 * register to courses would have left drop-in classes without one and
 * duplicated the logic the moment they needed it.
 */

/** Local-date bounds resolved against the studio's own zone. */
async function windowFor(organizationId: string, from: string, to: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });

  const { DateTime } = await import('luxon');

  const start = DateTime.fromISO(from, { zone: org.timezone }).startOf('day');
  const end = DateTime.fromISO(to, { zone: org.timezone }).endOf('day');

  if (!start.isValid || !end.isValid) {
    throw AppError.badRequest('Invalid date range.');
  }
  if (end < start) {
    throw AppError.badRequest('The range must end after it starts.');
  }

  return { start: start.toJSDate(), end: end.toJSDate() };
}

export async function listSessions(
  organizationId: string,
  opts: {
    from: string;
    to: string;
    staffId?: string;
    locationId?: string;
    courseSeriesId?: string;
    includeCancelled?: boolean;
  },
) {
  const { start, end } = await windowFor(organizationId, opts.from, opts.to);

  const sessions = await prisma.session.findMany({
    where: {
      organizationId,
      startsAt: { gte: start, lte: end },
      ...(opts.staffId ? { staffId: opts.staffId } : {}),
      ...(opts.locationId ? { locationId: opts.locationId } : {}),
      ...(opts.courseSeriesId ? { courseSeriesId: opts.courseSeriesId } : {}),
      ...(opts.includeCancelled ? {} : { status: { not: 'CANCELLED' } }),
    },
    include: {
      serviceType: { select: { id: true, name: true } },
      staff: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      courseSeries: { select: { id: true, name: true, cohortLabel: true } },
    },
    orderBy: { startsAt: 'asc' },
  });

  const marked = await attendanceCounts(sessions.map((s) => s.id));

  return sessions.map((session) => {
    const counts = marked.get(session.id);
    const expected = counts?.expected ?? 0;

    return {
      ...session,
      /** "week 3 of 6", for a session that belongs to a course. */
      seriesLabel:
        session.courseSeries && session.seriesIndex
          ? `Week ${session.seriesIndex}`
          : null,
      attendance: {
        expected,
        attended: counts?.attended ?? 0,
        noShow: counts?.noShow ?? 0,
        /** Whether the register still needs finishing. */
        outstanding: expected,
      },
    };
  });
}

type Counts = { expected: number; attended: number; noShow: number };

/** One grouped query rather than one per session. */
async function attendanceCounts(
  sessionIds: string[],
): Promise<Map<string, Counts>> {
  if (sessionIds.length === 0) return new Map();

  const rows = await prisma.booking.groupBy({
    by: ['sessionId', 'status'],
    where: { sessionId: { in: sessionIds }, status: { not: 'CANCELLED' } },
    _count: { _all: true },
  });

  const result = new Map<string, Counts>();

  for (const row of rows) {
    if (!row.sessionId) continue;

    const entry =
      result.get(row.sessionId) ?? { expected: 0, attended: 0, noShow: 0 };

    if (row.status === 'ATTENDED') entry.attended += row._count._all;
    else if (row.status === 'NO_SHOW') entry.noShow += row._count._all;
    // PENDING and CONFIRMED are people not yet accounted for.
    else entry.expected += row._count._all;

    result.set(row.sessionId, entry);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Scheduling classes
// ---------------------------------------------------------------------------

export type CreateClassInput = {
  serviceTypeId: string;
  startLocalDate: string;
  localStartTime: string;
  timezone?: string;
  capacity: number;
  staffId?: string;
  locationId?: string;
  durationMinutes?: number;
  repeat?: { rrule: string; count: number };
};

function parseLocalTime(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours! * 60 + minutes!;
}

/**
 * Schedules a drop-in class.
 *
 * Course weeks do NOT come through here — they are generated from a cohort, so
 * that the six of them share a price, a roster and an all-or-nothing enrolment.
 * A loose session hanging off a COURSE_SERIES service would be a seventh week
 * nobody enrolled in and nobody could sell, which is why that combination is
 * refused rather than quietly allowed.
 *
 * Times arrive as wall-clock intent and the instant is derived here, for the
 * same reason cohorts work that way: a class repeated across a DST boundary
 * has to stay at the hour the studio advertised.
 */
export async function createClass(
  organizationId: string,
  input: CreateClassInput,
) {
  const service = await prisma.serviceType.findFirst({
    where: { id: input.serviceTypeId, organizationId },
  });
  if (!service) throw AppError.badRequest('Service not found.');

  if (service.bookingMode === 'COURSE_SERIES') {
    throw AppError.badRequest(
      'This service runs as a multi-week course. Create a cohort and generate ' +
        'its dates instead of scheduling a single class.',
      'WRONG_BOOKING_MODE',
    );
  }

  if (input.capacity > service.capacityMax) {
    throw AppError.badRequest(
      `This class seats at most ${service.capacityMax}.`,
      'CAPACITY_ABOVE_SERVICE_MAX',
    );
  }

  if (input.staffId) {
    const staff = await prisma.staff.findFirst({
      where: { id: input.staffId, organizationId },
      select: { id: true },
    });
    if (!staff) throw AppError.badRequest('Instructor not found.');
  }

  const location = input.locationId
    ? await prisma.location.findFirst({
        where: { id: input.locationId, organizationId },
        select: { id: true, lat: true, lng: true },
      })
    : null;

  if (input.locationId && !location) {
    throw AppError.badRequest('Location not found.');
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });

  const zone = input.timezone ?? org.timezone;
  const startMinute = parseLocalTime(input.localStartTime);
  const duration = input.durationMinutes ?? service.durationMinutes;

  let localDates: string[];
  if (input.repeat) {
    try {
      localDates = expandLocalDates(
        input.repeat.rrule,
        input.startLocalDate,
        input.repeat.count,
      );
    } catch (err) {
      throw AppError.badRequest(
        err instanceof Error ? err.message : 'Invalid recurrence rule.',
      );
    }
  } else {
    localDates = [input.startLocalDate];
  }

  /**
   * Created one at a time rather than in a single transaction, and that is a
   * real difference from cohort generation.
   *
   * A course with a hole in week four is broken — students bought the whole
   * run. A term of independent drop-ins is not: if the instructor is already
   * busy on one of the twelve Saturdays, the other eleven are still worth
   * having. So a clash SKIPS that date and is reported, rather than rolling
   * back the lot.
   */
  const created = [];
  const skipped: { localDate: string; reason: string }[] = [];

  for (const localDate of localDates) {
    const start = resolveLocal(localDate, startMinute, zone);
    const end = resolveLocal(localDate, startMinute + duration, zone);

    try {
      const session = await createSession({
        organizationId,
        serviceTypeId: service.id,
        startsAt: start.instant,
        endsAt: end.instant,
        timezone: zone,
        localStartTime: input.localStartTime,
        capacity: input.capacity,
        staffId: input.staffId ?? null,
        locationId: input.locationId ?? null,
        paddingBeforeMinutes: service.paddingBeforeMinutes,
        paddingAfterMinutes: service.paddingAfterMinutes,
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
      });

      created.push({
        id: session!.id,
        localDate,
        startsAt: session!.startsAt,
        endsAt: session!.endsAt,
        resolution: start.kind,
      });
    } catch (err) {
      // A single class that clashes is an error the caller must see. One
      // date inside a repeat is a skip.
      if (localDates.length === 1) throw err;

      skipped.push({
        localDate,
        reason: err instanceof AppError ? err.message : 'Could not be scheduled.',
      });
    }
  }

  if (created.length === 0) {
    throw AppError.conflict(
      'None of those dates could be scheduled.',
      'ALL_DATES_UNAVAILABLE',
    );
  }

  return { created, skipped };
}

export async function updateClass(
  organizationId: string,
  sessionId: string,
  input: { capacity?: number; staffId?: string | null; locationId?: string | null },
) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, organizationId },
  });
  if (!session) throw AppError.notFound('Session not found.');

  if (session.status === 'CANCELLED') {
    throw AppError.conflict('This class has been cancelled.');
  }

  /**
   * Capacity cannot go below what is already sold. Letting it would leave the
   * CHECK constraint on seats_taken permanently violated for that row, so
   * every later booking and cancellation on the class would start failing.
   */
  if (input.capacity !== undefined && input.capacity < session.seatsTaken) {
    throw AppError.conflict(
      `${session.seatsTaken} place(s) are already booked. Capacity cannot go below that.`,
      'CAPACITY_BELOW_COMMITTED',
    );
  }

  /**
   * Changing the instructor is deliberately NOT supported here.
   *
   * The instructor's time block is what the exclusion constraint compares
   * against, so a swap has to move the block and the session together, and be
   * rejected as a whole if the new instructor is already teaching. That is a
   * scheduling operation, not a field edit, and doing it as one here would
   * quietly leave the old instructor blocked and the new one free.
   */
  if (input.staffId !== undefined && input.staffId !== session.staffId) {
    throw AppError.badRequest(
      'Changing the instructor is not supported yet. Cancel the class and ' +
        'schedule it again with the right person.',
      'STAFF_CHANGE_UNSUPPORTED',
    );
  }

  return prisma.session.update({
    where: { id: sessionId },
    data: {
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
    },
  });
}

/**
 * Calls a class off.
 *
 * Every booking is cancelled first, which returns its seats and clears its
 * time blocks, and only then is the session marked. Doing it the other way
 * round would leave bookings pointing at a cancelled class while still
 * counting against a seat total nobody can now use.
 *
 * Refunds are not issued here, for the same reason cancelling a cohort does
 * not: what a studio owes when it cancels is theirs to decide.
 */
export async function cancelClass(organizationId: string, sessionId: string) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, organizationId },
    select: { id: true },
  });
  if (!session) throw AppError.notFound('Session not found.');

  const bookings = await prisma.booking.findMany({
    where: { sessionId, status: { not: 'CANCELLED' } },
    select: { id: true },
  });

  for (const booking of bookings) {
    await cancelBooking(organizationId, booking.id);
  }

  const cancelled = await cancelSession(organizationId, sessionId);

  return { session: cancelled, bookingsCancelled: bookings.length };
}

/**
 * The register for one session.
 *
 * Cancelled bookings are excluded rather than shown greyed out. Somebody who
 * cancelled in advance is not on the register — putting them there invites an
 * instructor to mark them absent, which is exactly the confusion the guard in
 * `markAttendance` refuses.
 */
export async function getRegister(organizationId: string, sessionId: string) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, organizationId },
    include: {
      serviceType: { select: { id: true, name: true } },
      staff: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      courseSeries: { select: { id: true, name: true, cohortLabel: true } },
    },
  });

  if (!session) throw AppError.notFound('Session not found.');

  const bookings = await prisma.booking.findMany({
    where: { sessionId, status: { not: 'CANCELLED' } },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      enrollment: { select: { id: true, courseSeriesId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return {
    session: {
      id: session.id,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      timezone: session.timezone,
      capacity: session.capacity,
      seatsTaken: session.seatsTaken,
      status: session.status,
      service: session.serviceType,
      staff: session.staff,
      location: session.location,
      course: session.courseSeries,
      seriesIndex: session.seriesIndex,
    },
    /** False until the class starts; the UI disables the controls on it. */
    markable: session.startsAt <= new Date(),
    entries: bookings.map((booking) => ({
      bookingId: booking.id,
      customer: booking.customer,
      seats: booking.seats,
      status: booking.status,
      /** Distinguishes a course student from a drop-in on the same register. */
      viaEnrollment: booking.enrollment !== null,
    })),
  };
}

/**
 * Marks a whole register.
 *
 * Every entry is checked against the session before anything is written, so a
 * request naming one booking from another class is rejected in full rather
 * than applied in part. Individual marks then reuse `markAttendance`, which
 * owns the future-session and cancelled-booking rules — duplicating them here
 * is how the two paths would drift.
 */
export async function markRegister(
  organizationId: string,
  sessionId: string,
  entries: { bookingId: string; status: 'ATTENDED' | 'NO_SHOW' | 'CONFIRMED' }[],
) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, organizationId },
    select: { id: true, startsAt: true },
  });
  if (!session) throw AppError.notFound('Session not found.');

  const ids = entries.map((e) => e.bookingId);
  const bookings = await prisma.booking.findMany({
    where: { id: { in: ids }, organizationId, sessionId },
    select: { id: true },
  });

  const known = new Set(bookings.map((b) => b.id));
  const strangers = ids.filter((id) => !known.has(id));

  if (strangers.length > 0) {
    throw AppError.badRequest(
      `${strangers.length} booking(s) are not on this class's register.`,
      'NOT_ON_REGISTER',
    );
  }

  for (const entry of entries) {
    await markAttendance(organizationId, entry.bookingId, entry.status);
  }

  /**
   * Marking somebody absent is what mints a make-up credit, under whatever
   * policy the studio has set. Issuance is idempotent — a partial unique index
   * on the source booking — so saving the same register twice cannot mint two.
   *
   * Deliberately not fatal. A register that failed to save because the credit
   * ledger hiccuped would be a bad trade: the attendance record is the thing
   * the instructor is standing there to capture, and a missing credit can be
   * granted by hand.
   */
  const { issueCreditForBooking } = await import('../credits/credit.service');
  const creditsIssued: string[] = [];

  for (const entry of entries) {
    if (entry.status !== 'NO_SHOW') continue;

    try {
      const result = await issueCreditForBooking(organizationId, entry.bookingId);
      if (result.issued && result.creditId) creditsIssued.push(result.creditId);
    } catch (err) {
      logger.error(
        { err, bookingId: entry.bookingId },
        'Failed to issue make-up credit',
      );
    }
  }

  const register = await getRegister(organizationId, sessionId);
  return { ...register, creditsIssued: creditsIssued.length };
}
