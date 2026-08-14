import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { logger } from '../../lib/logger';
import { requireFeature, type PlanId } from '../billing/plan';
import {
  cancelSeries,
  enrollInSeries,
  generateSeriesSessions,
} from '../../scheduling/series.service';

/**
 * Course cohort administration.
 *
 * The scheduling half — generating sessions, enrolling students — lives in
 * `scheduling/series.service`, alongside the other things that hold database
 * locks. This module is the tenant-scoped, plan-gated, validation layer above
 * it, and holds no concurrency logic of its own.
 */

async function planOf(organizationId: string): Promise<PlanId> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true },
  });
  return org.plan as PlanId;
}

/** Every write path goes through here. Courses are a paid-tier feature. */
async function requireCourses(organizationId: string) {
  requireFeature(await planOf(organizationId), 'courseSeries');
}

export async function listSeries(
  organizationId: string,
  opts: { status?: string; serviceTypeId?: string } = {},
) {
  const series = await prisma.courseSeries.findMany({
    where: {
      organizationId,
      ...(opts.status ? { status: opts.status as never } : {}),
      ...(opts.serviceTypeId ? { serviceTypeId: opts.serviceTypeId } : {}),
    },
    include: {
      serviceType: { select: { id: true, name: true, durationMinutes: true } },
      staff: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      _count: { select: { sessions: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  const counts = await activeEnrollmentCounts(series.map((s) => s.id));

  return series.map((s) => ({
    ...s,
    enrolledCount: counts.get(s.id) ?? 0,
    seatsRemaining: Math.max(0, s.capacity - (counts.get(s.id) ?? 0)),
  }));
}

/**
 * Enrolled headcount per cohort, counting seats rather than rows — a parent
 * booking two children is one enrolment and two seats.
 */
async function activeEnrollmentCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();

  const rows = await prisma.enrollment.groupBy({
    by: ['courseSeriesId'],
    where: { courseSeriesId: { in: ids }, status: 'ACTIVE' },
    _sum: { seats: true },
  });

  return new Map(rows.map((r) => [r.courseSeriesId, r._sum.seats ?? 0]));
}

export async function getSeries(organizationId: string, id: string) {
  const series = await prisma.courseSeries.findFirst({
    where: { id, organizationId },
    include: {
      serviceType: { select: { id: true, name: true, durationMinutes: true } },
      staff: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      sessions: {
        orderBy: { seriesIndex: 'asc' },
        select: {
          id: true,
          seriesIndex: true,
          startsAt: true,
          endsAt: true,
          timezone: true,
          localStartTime: true,
          capacity: true,
          seatsTaken: true,
          status: true,
        },
      },
    },
  });

  if (!series) throw AppError.notFound('Course series not found.');

  const counts = await activeEnrollmentCounts([series.id]);
  const enrolledCount = counts.get(series.id) ?? 0;

  return {
    ...series,
    enrolledCount,
    seatsRemaining: Math.max(0, series.capacity - enrolledCount),
  };
}

export async function createSeries(
  organizationId: string,
  input: {
    serviceTypeId: string;
    name: string;
    cohortLabel?: string;
    description?: string;
    sessionCount: number;
    capacity: number;
    priceCents: number;
    timezone?: string;
    staffId?: string;
    locationId?: string;
    enrollmentClosesAt?: Date;
    allowLateEnrollment?: boolean;
  },
) {
  await requireCourses(organizationId);

  const serviceType = await prisma.serviceType.findFirst({
    where: { id: input.serviceTypeId, organizationId },
    select: { id: true, bookingMode: true, capacityMax: true },
  });
  if (!serviceType) throw AppError.badRequest('Service not found.');

  if (serviceType.bookingMode !== 'COURSE_SERIES') {
    throw AppError.badRequest(
      'That service is not set up as a multi-week course. Change its booking ' +
        'mode to COURSE_SERIES first.',
      'WRONG_BOOKING_MODE',
    );
  }

  // The service's capacity ceiling exists because it reflects something
  // physical — how many wheels are in the room. A cohort may run smaller, but
  // not larger.
  if (input.capacity > serviceType.capacityMax) {
    throw AppError.badRequest(
      `This course seats at most ${serviceType.capacityMax}. Raise the ` +
        "service's maximum capacity if the room really does hold more.",
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

  if (input.locationId) {
    const location = await prisma.location.findFirst({
      where: { id: input.locationId, organizationId },
      select: { id: true },
    });
    if (!location) throw AppError.badRequest('Location not found.');
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });

  return prisma.courseSeries.create({
    data: {
      organizationId,
      serviceTypeId: input.serviceTypeId,
      name: input.name,
      cohortLabel: input.cohortLabel,
      description: input.description,
      sessionCount: input.sessionCount,
      capacity: input.capacity,
      priceCents: input.priceCents,
      timezone: input.timezone ?? org.timezone,
      staffId: input.staffId,
      locationId: input.locationId,
      enrollmentClosesAt: input.enrollmentClosesAt,
      allowLateEnrollment: input.allowLateEnrollment ?? false,
      status: 'DRAFT',
    },
  });
}

export async function updateSeries(
  organizationId: string,
  id: string,
  input: Record<string, unknown>,
) {
  await requireCourses(organizationId);

  const series = await prisma.courseSeries.findFirst({
    where: { id, organizationId },
  });
  if (!series) throw AppError.notFound('Course series not found.');

  if (series.status === 'CANCELLED') {
    throw AppError.conflict('A cancelled cohort cannot be edited.');
  }

  const sessionCount = await prisma.session.count({
    where: { courseSeriesId: id },
  });

  if (input.status === 'PUBLISHED' && sessionCount === 0) {
    throw AppError.conflict(
      'Generate the course dates before putting it on sale.',
      'NO_SESSIONS',
    );
  }

  /**
   * Capacity changes propagate to the sessions, because the cohort's capacity
   * IS the sessions' capacity — but never below what is already sold. Shrinking
   * a course under its roster would leave students holding seats the database
   * says do not exist, and the CHECK constraint would start rejecting ordinary
   * writes on that session from then on.
   */
  if (typeof input.capacity === 'number' && input.capacity !== series.capacity) {
    const busiest = await prisma.session.aggregate({
      where: { courseSeriesId: id },
      _max: { seatsTaken: true },
    });
    const committed = busiest._max.seatsTaken ?? 0;

    if (input.capacity < committed) {
      throw AppError.conflict(
        `${committed} place(s) on this course are already taken. Capacity ` +
          'cannot go below that.',
        'CAPACITY_BELOW_COMMITTED',
      );
    }

    await prisma.session.updateMany({
      where: { courseSeriesId: id },
      data: { capacity: input.capacity },
    });
  }

  return prisma.courseSeries.update({
    where: { id },
    data: input as Prisma.CourseSeriesUncheckedUpdateInput,
  });
}

export async function generateSessions(
  organizationId: string,
  id: string,
  input: { rrule: string; startLocalDate: string; localStartTime: string },
) {
  await requireCourses(organizationId);

  return generateSeriesSessions({
    organizationId,
    courseSeriesId: id,
    rrule: input.rrule,
    startLocalDate: input.startLocalDate,
    localStartTime: input.localStartTime,
  });
}

export async function cancelCourseSeries(organizationId: string, id: string) {
  await requireCourses(organizationId);
  return cancelSeries(organizationId, id);
}

/**
 * The roster, with how each student is tracking through the course.
 *
 * The attendance breakdown is the thing a studio actually looks at mid-course:
 * who has missed weeks. It is also precisely the data a make-up credit will be
 * computed from later — counting absences is the cheap, uncontroversial half
 * of that feature, and it is worth having on its own before any decision about
 * how credits should behave.
 */
/**
 * Cancels a place on a course and settles the money for it.
 *
 * Same shape as cancelling a booking: release the seats first, then refund,
 * and never let a refund failure leave the place still occupied. The seats are
 * the thing a studio needs back immediately; the money can be chased.
 */
export async function cancelEnrollmentAsStudio(
  organizationId: string,
  enrollmentId: string,
  opts: { refund?: boolean; reason?: string } = {},
) {
  const { cancelEnrollment } = await import('../../scheduling/series.service');
  const enrollment = await cancelEnrollment(organizationId, enrollmentId);

  let refundedCents = 0;

  if (opts.refund !== false) {
    const { refundForEnrollmentCancellation } = await import(
      '../payments/payment.service'
    );
    const refund = await refundForEnrollmentCancellation(
      organizationId,
      enrollmentId,
      { reason: opts.reason ?? 'cancelled_by_studio' },
    ).catch((err) => {
      logger.error(
        { err, enrollmentId },
        'Course cancellation refund failed',
      );
      return { refundedCents: 0, creditCents: 0, refunds: [] };
    });
    refundedCents = refund.refundedCents;
  }

  return { enrollment, refundedCents };
}

export async function listRoster(organizationId: string, id: string) {
  const series = await prisma.courseSeries.findFirst({
    where: { id, organizationId },
    select: { id: true },
  });
  if (!series) throw AppError.notFound('Course series not found.');

  const enrollments = await prisma.enrollment.findMany({
    where: { courseSeriesId: id },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      _count: { select: { bookings: true } },
      bookings: {
        select: { id: true, status: true, startsAt: true },
        orderBy: { startsAt: 'asc' },
      },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
  });

  const now = new Date();

  return enrollments.map((enrollment) => {
    const attended = enrollment.bookings.filter(
      (b) => b.status === 'ATTENDED',
    ).length;
    const missed = enrollment.bookings.filter(
      (b) => b.status === 'NO_SHOW',
    ).length;
    // Weeks still to come. Distinct from "not yet marked", which is a class
    // that has run and whose register was never filled in.
    const upcoming = enrollment.bookings.filter(
      (b) => b.status !== 'CANCELLED' && b.startsAt > now,
    ).length;
    const unmarked = enrollment.bookings.filter(
      (b) =>
        b.startsAt <= now &&
        b.status !== 'ATTENDED' &&
        b.status !== 'NO_SHOW' &&
        b.status !== 'CANCELLED',
    ).length;

    // The booking list itself is an implementation detail of the counts.
    const { bookings: _bookings, ...rest } = enrollment;

    return {
      ...rest,
      attendance: { attended, missed, upcoming, unmarked },
    };
  });
}

/**
 * Enrols someone by hand — a phone booking, or a student the studio is
 * comping. Bypasses the on-sale window because an admin taking a booking over
 * the phone has already made that decision.
 */
export async function enrollCustomer(
  organizationId: string,
  id: string,
  input: { customerId: string; seats?: number; notes?: string },
) {
  await requireCourses(organizationId);

  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId },
    select: { id: true },
  });
  if (!customer) throw AppError.badRequest('Customer not found.');

  return enrollInSeries({
    organizationId,
    courseSeriesId: id,
    customerId: input.customerId,
    seats: input.seats,
    notes: input.notes,
    source: 'admin',
    overrideWindow: true,
  });
}
