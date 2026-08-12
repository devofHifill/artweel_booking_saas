import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
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

/** The roster: who is on the course, not who turned up on a given week. */
export async function listRoster(organizationId: string, id: string) {
  const series = await prisma.courseSeries.findFirst({
    where: { id, organizationId },
    select: { id: true },
  });
  if (!series) throw AppError.notFound('Course series not found.');

  return prisma.enrollment.findMany({
    where: { courseSeriesId: id },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      _count: { select: { bookings: true } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
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
