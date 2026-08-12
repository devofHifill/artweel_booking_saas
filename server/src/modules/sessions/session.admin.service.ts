import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { markAttendance } from '../bookings/booking.admin.service';

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

  return getRegister(organizationId, sessionId);
}
