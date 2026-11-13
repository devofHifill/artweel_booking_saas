import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { uniqueSlug } from '../../lib/slug';
import { requireCapacity, type PlanId } from '../billing/plan';
import { countRunningClasses } from '../activities/class-limit';
import { assertAltText, assertOwnImage, releaseImageIfUnused } from '../media/media.service';

/**
 * Service-type administration.
 *
 * Two rules run through everything here:
 *
 *   1. `organizationId` is always part of the WHERE clause, never just the
 *      SET clause. Looking a row up by id alone and then checking ownership
 *      afterwards is how cross-tenant edits happen.
 *
 *   2. Nothing with history is ever hard-deleted. Bookings reference the
 *      service that produced them; removing it would orphan a customer's
 *      receipt. Deactivation hides a service from the booking page while
 *      leaving the record intact.
 */

async function slugTaken(organizationId: string, candidate: string, excludeId?: string) {
  const found = await prisma.serviceType.findFirst({
    where: {
      organizationId,
      slug: candidate,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return found !== null;
}

export async function listServices(
  organizationId: string,
  opts: {
    includeInactive?: boolean;
    bookingMode?: string;
    withStats?: boolean;
    withReadiness?: boolean;
  } = {},
) {
  const services = await prisma.serviceType.findMany({
    where: {
      organizationId,
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(opts.bookingMode
        ? { bookingMode: opts.bookingMode as Prisma.EnumBookingModeFilter }
        : {}),
    },
    include: {
      category: { select: { id: true, name: true } },
      cancellationPolicy: { select: { id: true, name: true } },
      /*
        The ids themselves, not just the count.

        The edit form sends `locationId: null` for "nowhere in particular", so
        a form that could not READ the current location would clear it on every
        save — the studio edits a price and the class quietly stops being
        anywhere. The count alone cannot prefill that field.
      */
      serviceLocations: { select: { locationId: true } },
      /* Who teaches it, so the catalogue can show and change the set in place
         rather than sending the studio to Staff & Guides, one chip per person. */
      staffServices: { select: { staffId: true } },
      _count: { select: { staffServices: true, serviceLocations: true } },
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });

  const readiness = opts.withReadiness
    ? await readinessFor(organizationId, services)
    : null;

  const lifecycle = await lifecycleFor(
    organizationId,
    services.map((s) => s.id),
  );
  const withLifecycle = services.map((service) => ({
    ...service,
    ...lifecycle(service.id),
  }));

  if (!opts.withStats) {
    return readiness
      ? withLifecycle.map((service) => ({ ...service, readiness: readiness.get(service.id)! }))
      : withLifecycle;
  }

  /*
    Merged here rather than joined in the query above. Revenue is payments net
    of refunds and only in two of the six payment statuses — a rule that lives
    in the analytics module and must not be re-expressed as a Prisma
    aggregate, or the catalogue and Reports would disagree about the same
    class and both look right.
  */
  const { serviceStats } = await import('../analytics/analytics.service');
  const stats = await serviceStats(organizationId);

  return withLifecycle.map((service) => ({
    ...service,
    ...(readiness ? { readiness: readiness.get(service.id)! } : {}),
    // Zero rather than absent for a class nobody has booked: the card prints
    // this, and a missing figure renders as "undefined bookings".
    stats: stats.get(service.id) ?? {
      serviceTypeId: service.id,
      bookings: 0,
      seats: 0,
      revenueCents: 0,
    },
  }));
}

/**
 * When an activity runs, and whether it is over (CLASS-EVENT-PLAN.md, Stage 1).
 *
 * PAST once it has dates and the last of them has ended. Worked out here, from
 * the dates, every time it is asked — never stored and never flipped by a
 * scheduled job, so it cannot show as live by mistake when a job is late.
 *
 * Cancelled dates do not count: a class whose final week was cancelled is
 * over when the week before it ends. An activity with no dates at all (a
 * private lesson, or a group class nobody has scheduled) is never PAST.
 */
export type Lifecycle = {
  firstStartsAt: Date | null;
  lastEndsAt: Date | null;
  lifecycle: 'LIVE' | 'PAST';
};

async function lifecycleFor(
  organizationId: string,
  serviceTypeIds: string[],
): Promise<(id: string) => Lifecycle> {
  const rows = serviceTypeIds.length
    ? await prisma.session.groupBy({
        by: ['serviceTypeId'],
        where: {
          organizationId,
          serviceTypeId: { in: serviceTypeIds },
          status: { not: 'CANCELLED' },
        },
        _min: { startsAt: true },
        _max: { endsAt: true },
      })
    : [];

  const byId = new Map(rows.map((r) => [r.serviceTypeId, r]));
  const now = Date.now();

  return (id) => {
    const row = byId.get(id);
    const firstStartsAt = row?._min.startsAt ?? null;
    const lastEndsAt = row?._max.endsAt ?? null;
    return {
      firstStartsAt,
      lastEndsAt,
      lifecycle: lastEndsAt && lastEndsAt.getTime() <= now ? 'PAST' : 'LIVE',
    };
  };
}

/**
 * Why customers cannot book a service right now, or null when they can.
 *
 * Asks what the booking page itself asks, by kind:
 *
 *   Group class  — a date the page will show: upcoming, within how far ahead
 *                  the service takes bookings, and at a location once the
 *                  studio has one (the page asks by location from then on).
 *                  An instructor is NOT needed; a group class is booked from
 *                  its dates and never asks "who with?".
 *   One to one   — an active instructor who teaches it, with working hours,
 *                  and — once the studio has locations — working at one the
 *                  service is offered at. Checked in that order, so the reason
 *                  given is the first thing to fix.
 *
 * Replaced "No instructor assigned", which was the one warning the catalogue
 * had: true of group classes that were selling fine, and silent about the
 * reasons One to one lessons really failed.
 */
export type ReadinessProblem =
  | 'NO_DATES'
  | 'NO_INSTRUCTOR'
  | 'NO_HOURS'
  | 'NO_LOCATION'
  /** A Class whose first session has begun: booking closed when it started. */
  | 'STARTED';
export type Readiness = { bookable: boolean; problem: ReadinessProblem | null };

async function readinessFor(
  organizationId: string,
  services: {
    id: string;
    bookingMode: string;
    kind?: string;
    isActive: boolean;
    maxHorizonDays: number;
    serviceLocations: { locationId: string }[];
  }[],
): Promise<Map<string, Readiness>> {
  const now = new Date();
  const live = services.filter((s) => s.isActive);

  /*
    A Class is sold as its one course, which is on sale from publishing until
    its first session starts (late joining is off by default). Its first
    session is therefore the whole question.
  */
  const classIds = live.filter((s) => s.kind === 'CLASS').map((s) => s.id);
  const classStarts = classIds.length
    ? await prisma.session.groupBy({
        by: ['serviceTypeId'],
        where: {
          organizationId,
          serviceTypeId: { in: classIds },
          courseSeriesId: { not: null },
          status: 'SCHEDULED',
          courseSeries: { status: 'PUBLISHED' },
        },
        _min: { startsAt: true },
      })
    : [];
  const classStart = new Map(classStarts.map((r) => [r.serviceTypeId, r._min.startsAt]));
  const groupIds = live.filter((s) => s.bookingMode === 'EVENT').map((s) => s.id);
  const oneToOneIds = live
    .filter((s) => s.bookingMode === 'APPOINTMENT')
    .map((s) => s.id);

  const locationIds = (
    await prisma.location.findMany({
      where: { organizationId, isActive: true },
      select: { id: true },
    })
  ).map((l) => l.id);
  const hasLocations = locationIds.length > 0;

  const [nextDates, teachers] = await Promise.all([
    groupIds.length === 0
      ? Promise.resolve([])
      : prisma.session.groupBy({
          by: ['serviceTypeId'],
          where: {
            organizationId,
            serviceTypeId: { in: groupIds },
            status: 'SCHEDULED',
            courseSeriesId: null,
            startsAt: { gte: now },
            ...(hasLocations ? { locationId: { not: null } } : {}),
          },
          _min: { startsAt: true },
        }),
    oneToOneIds.length === 0
      ? Promise.resolve([])
      : prisma.staffService.findMany({
          where: { serviceTypeId: { in: oneToOneIds }, staff: { isActive: true } },
          select: {
            serviceTypeId: true,
            staff: {
              select: {
                _count: {
                  select: { availabilityRules: { where: { ruleType: 'WORKING' } } },
                },
                staffLocations: { select: { locationId: true } },
              },
            },
          },
        }),
  ]);

  const firstDate = new Map(nextDates.map((row) => [row.serviceTypeId, row._min.startsAt]));

  const result = new Map<string, Readiness>();
  for (const service of services) {
    let problem: ReadinessProblem | null = null;

    if (service.isActive && service.kind === 'CLASS') {
      const first = classStart.get(service.id);
      const problem: ReadinessProblem | null = !first
        ? 'NO_DATES'
        : first.getTime() <= now.getTime()
          ? 'STARTED'
          : null;
      result.set(service.id, { bookable: problem === null, problem });
      continue;
    }

    if (!service.isActive || service.bookingMode === 'COURSE_SERIES') {
      // Switched off is its own state, and a course sells as a cohort.
      result.set(service.id, { bookable: false, problem: null });
      continue;
    }

    if (service.bookingMode === 'EVENT') {
      const first = firstDate.get(service.id);
      const horizon = now.getTime() + service.maxHorizonDays * 86_400_000;
      if (!first || first.getTime() > horizon) problem = 'NO_DATES';
    } else {
      const mine = teachers.filter((t) => t.serviceTypeId === service.id);
      const withHours = mine.filter((t) => t.staff._count.availabilityRules > 0);
      /* Where the service is offered: its own list when it has one, and
         anywhere the studio runs when it does not. */
      const offeredAt = service.serviceLocations.length
        ? service.serviceLocations.map((l) => l.locationId).filter((id) => locationIds.includes(id))
        : locationIds;

      if (mine.length === 0) problem = 'NO_INSTRUCTOR';
      else if (withHours.length === 0) problem = 'NO_HOURS';
      else if (
        hasLocations &&
        !withHours.some((t) =>
          t.staff.staffLocations.some((l) => offeredAt.includes(l.locationId)),
        )
      ) {
        problem = 'NO_LOCATION';
      }
    }

    result.set(service.id, { bookable: problem === null, problem });
  }

  return result;
}

/**
 * Every live activity, and whether customers can book it — for setup's "are
 * you ready" answer, which must agree with the catalogue's cards.
 */
export async function activityReadiness(organizationId: string) {
  const services = await prisma.serviceType.findMany({
    where: {
      organizationId,
      isActive: true,
      // Older course services sell from Courses; a Class is created here.
      OR: [{ bookingMode: { not: 'COURSE_SERIES' } }, { kind: 'CLASS' }],
    },
    select: {
      id: true,
      name: true,
      bookingMode: true,
      kind: true,
      isActive: true,
      maxHorizonDays: true,
      serviceLocations: { select: { locationId: true } },
    },
    orderBy: { name: 'asc' },
  });
  const readiness = await readinessFor(organizationId, services);
  return services.map((s) => ({ id: s.id, name: s.name, readiness: readiness.get(s.id)! }));
}

export async function getService(organizationId: string, id: string) {
  const service = await prisma.serviceType.findFirst({
    where: { id, organizationId },
    include: {
      category: true,
      cancellationPolicy: true,
      staffServices: { include: { staff: { select: { id: true, name: true } } } },
      serviceLocations: {
        include: { location: { select: { id: true, name: true, locationType: true } } },
      },
      serviceResources: {
        include: { resource: { select: { id: true, name: true, quantity: true } } },
      },
    },
  });

  if (!service) throw AppError.notFound('Service not found.');
  return service;
}

/**
 * `locationId` is a field on the form and a JOIN ROW in the database.
 *
 * It has to come out of the payload before the row is written or Prisma
 * rejects the whole create for an unknown column, and the studio is told
 * their class could not be saved because of a field they can see on screen.
 *
 * One id in, a list out: `service_locations` is many-to-many and stays that
 * way — a service running at two sites is a real thing this schema already
 * supports. The form offers one because a form that offers a multi-select for
 * a studio with one address is asking a question with a single answer.
 */
function peelLocationId(input: Record<string, unknown>): {
  rest: Record<string, unknown>;
  locationIds: string[] | null;
} {
  if (!('locationId' in input)) return { rest: input, locationIds: null };

  const { locationId, ...rest } = input;
  return {
    rest,
    // Explicit null means "nowhere in particular", which is an empty list and
    // NOT the same as the key being absent — that one means "leave it alone".
    locationIds: typeof locationId === 'string' && locationId ? [locationId] : [],
  };
}

export async function createService(
  organizationId: string,
  input: Record<string, unknown>,
) {
  await assertReferencesBelong(organizationId, input);
  assertAltText(input.imageKey, input.imageAlt);

  const { rest, locationIds } = peelLocationId(input);

  const slug = await uniqueSlug(
    String(rest.name),
    (c) => slugTaken(organizationId, c),
    'service',
  );

  const service = await prisma.serviceType.create({
    data: {
      ...(rest as Prisma.ServiceTypeUncheckedCreateInput),
      organizationId,
      slug,
    },
  });

  if (locationIds?.length) {
    await setServiceLocations(organizationId, service.id, locationIds);
  }

  return service;
}

export async function updateService(
  organizationId: string,
  id: string,
  input: Record<string, unknown>,
) {
  const existing = await prisma.serviceType.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw AppError.notFound('Service not found.');

  await assertReferencesBelong(organizationId, input, id);
  assertAltText(
    input.imageKey === undefined ? existing.imageKey : input.imageKey,
    input.imageAlt === undefined ? existing.imageAlt : input.imageAlt,
  );

  /*
    Showing a hidden Class makes it a running one, so it needs a place under
    the plan's class limit (Solo: 1) — or publishing Hidden and then
    switching on would be a way round it.
  */
  if (existing.kind === 'CLASS' && !existing.isActive && input.isActive === true) {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { plan: true },
    });
    requireCapacity(org.plan as PlanId, 'maxClasses', await countRunningClasses(organizationId));
  }

  /**
   * Capacity may not drop below what is already sold.
   *
   * A studio reducing a class from 8 to 6 with 7 people booked would leave
   * `seats_taken > capacity` — which the CHECK constraint would reject on the
   * next write anyway, but only at some unrelated later moment, producing an
   * error nobody can explain. Catching it here says what actually happened.
   */
  if (typeof input.capacityMax === 'number') {
    const oversold = await prisma.session.findFirst({
      where: {
        serviceTypeId: id,
        status: 'SCHEDULED',
        startsAt: { gte: new Date() },
        seatsTaken: { gt: input.capacityMax },
      },
      select: { id: true, seatsTaken: true, startsAt: true },
    });

    if (oversold) {
      throw AppError.conflict(
        `An upcoming class already has ${oversold.seatsTaken} seats booked. ` +
          'Reduce capacity to that number or higher, or cancel bookings first.',
        'CAPACITY_BELOW_BOOKED',
      );
    }
  }

  const { rest, locationIds } = peelLocationId(input);

  if (locationIds) {
    await setServiceLocations(organizationId, id, locationIds);
  }

  const data: Prisma.ServiceTypeUncheckedUpdateInput = { ...rest };

  if (typeof input.name === 'string' && input.name !== existing.name) {
    data.slug = await uniqueSlug(
      input.name,
      (c) => slugTaken(organizationId, c, id),
      'service',
    );
  }

  const updated = await prisma.serviceType.update({ where: { id }, data });
  if (existing.kind === 'CLASS') await syncClassSeries(id, input);
  // A replaced or removed photo's files go once nothing points at them.
  if (existing.imageKey && existing.imageKey !== updated.imageKey) {
    await releaseImageIfUnused(organizationId, existing.imageKey);
  }
  return updated;
}

/**
 * A Class keeps its prices and booking deadline on its cohort, where checkout
 * and enrolment read them (CLASS-EVENT-PLAN.md). Editing the Class in the
 * activity form edits the service, so the same values are carried across —
 * otherwise a changed price would show in the editor and never be charged.
 *
 * Applies to new bookings only: an enrolment keeps the total it was sold at.
 */
async function syncClassSeries(serviceTypeId: string, input: Record<string, unknown>) {
  const series = await prisma.courseSeries.findFirst({
    where: { serviceTypeId, status: { not: 'CANCELLED' } },
    select: {
      id: true,
      sessions: {
        where: { status: 'SCHEDULED' },
        orderBy: { seriesIndex: 'asc' },
        take: 1,
        select: { startsAt: true },
      },
    },
  });
  if (!series) return;

  const data: Prisma.CourseSeriesUpdateInput = {};
  if (typeof input.priceCents === 'number') data.priceCents = input.priceCents;
  if (typeof input.childPriceCents === 'number') data.childPriceCents = input.childPriceCents;
  if (typeof input.minNoticeMinutes === 'number') {
    const first = series.sessions[0]?.startsAt;
    data.enrollmentClosesAt =
      input.minNoticeMinutes > 0 && first
        ? new Date(first.getTime() - input.minNoticeMinutes * 60_000)
        : null;
  }
  if (Object.keys(data).length) {
    await prisma.courseSeries.update({ where: { id: series.id }, data });
  }
}

/** A booking someone still expects to turn up to. */
const upcomingBooking = (serviceTypeId: string, now: Date) => ({
  serviceTypeId,
  status: { in: ['PENDING', 'CONFIRMED'] as ('PENDING' | 'CONFIRMED')[] },
  startsAt: { gt: now },
});

/**
 * What deleting an activity would take with it, for the confirm dialog.
 *
 * `upcomingBookings` above zero means the delete will be refused: those
 * customers have to be cancelled (and refunded) through the normal flow first.
 */
export async function getDeletionImpact(organizationId: string, id: string) {
  const service = await prisma.serviceType.findFirst({
    where: { id, organizationId },
    select: { id: true, name: true },
  });
  if (!service) throw AppError.notFound('Service not found.');

  const now = new Date();
  const [sessions, bookings, upcomingBookings, enrollments, payments] = await Promise.all([
    prisma.session.count({ where: { serviceTypeId: id } }),
    prisma.booking.count({ where: { serviceTypeId: id } }),
    prisma.booking.count({ where: upcomingBooking(id, now) }),
    prisma.enrollment.count({ where: { courseSeries: { serviceTypeId: id } } }),
    prisma.payment.count({
      where: {
        OR: [
          { booking: { serviceTypeId: id } },
          { enrollment: { courseSeries: { serviceTypeId: id } } },
        ],
      },
    }),
  ]);

  return { id: service.id, name: service.name, sessions, bookings, upcomingBookings, enrollments, payments };
}

/**
 * Permanently removes an activity and everything scheduled under it: its
 * sessions, bookings, courses and enrollments (the database cascades them).
 *
 * Refused while anyone has an upcoming pending or confirmed booking. Those go
 * through the normal cancel flow first, which tells the customer and refunds
 * them; deleting would do neither. Past bookings go with the activity.
 *
 * Payment rows are kept: their link to the booking is cleared, not the row,
 * so the studio's money record survives.
 */
export async function deleteService(organizationId: string, id: string) {
  const service = await prisma.serviceType.findFirst({
    where: { id, organizationId },
  });
  if (!service) throw AppError.notFound('Service not found.');

  await prisma.$transaction(async (tx) => {
    // Checked in the same transaction as the delete, so a booking made a
    // moment earlier is still caught.
    const upcoming = await tx.booking.count({ where: upcomingBooking(id, new Date()) });
    if (upcoming > 0) {
      throw AppError.conflict(
        `"${service.name}" has ${upcoming} upcoming booking${upcoming === 1 ? '' : 's'}. ` +
          'Cancel them first, so those customers are told and refunded, then delete it.',
        'ACTIVITY_HAS_UPCOMING_BOOKINGS',
      );
    }
    await tx.serviceType.delete({ where: { id } });
  });

  await releaseImageIfUnused(organizationId, service.imageKey);
  return { deleted: true };
}

/** Sets which staff may deliver this service, replacing the whole list. */
export async function setQualifiedStaff(
  organizationId: string,
  serviceTypeId: string,
  staffIds: string[],
) {
  const service = await prisma.serviceType.findFirst({
    where: { id: serviceTypeId, organizationId },
  });
  if (!service) throw AppError.notFound('Service not found.');

  // Every id must belong to THIS studio. Without this check a caller could
  // attach another studio's instructor by guessing an id.
  const owned = await prisma.staff.findMany({
    where: { id: { in: staffIds }, organizationId },
    select: { id: true },
  });
  if (owned.length !== staffIds.length) {
    throw AppError.badRequest('One or more staff members were not found.');
  }

  await prisma.$transaction([
    prisma.staffService.deleteMany({ where: { serviceTypeId } }),
    prisma.staffService.createMany({
      data: staffIds.map((staffId) => ({ staffId, serviceTypeId })),
    }),
  ]);

  return { staffIds };
}

/** Sets where this service is offered, replacing the whole list. */
export async function setServiceLocations(
  organizationId: string,
  serviceTypeId: string,
  locationIds: string[],
) {
  const service = await prisma.serviceType.findFirst({
    where: { id: serviceTypeId, organizationId },
  });
  if (!service) throw AppError.notFound('Service not found.');

  const owned = await prisma.location.findMany({
    where: { id: { in: locationIds }, organizationId },
    select: { id: true },
  });
  if (owned.length !== locationIds.length) {
    throw AppError.badRequest('One or more locations were not found.');
  }

  await prisma.$transaction([
    prisma.serviceLocation.deleteMany({ where: { serviceTypeId } }),
    prisma.serviceLocation.createMany({
      data: locationIds.map((locationId) => ({ locationId, serviceTypeId })),
    }),
  ]);

  return { locationIds };
}

/** Sets the equipment this service consumes, per seat. */
export async function setServiceResources(
  organizationId: string,
  serviceTypeId: string,
  requirements: { resourceId: string; quantityPerSeat: number }[],
) {
  const service = await prisma.serviceType.findFirst({
    where: { id: serviceTypeId, organizationId },
  });
  if (!service) throw AppError.notFound('Service not found.');

  const ids = requirements.map((r) => r.resourceId);
  const owned = await prisma.resource.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true },
  });
  if (owned.length !== ids.length) {
    throw AppError.badRequest('One or more resources were not found.');
  }

  await prisma.$transaction([
    prisma.serviceResource.deleteMany({ where: { serviceTypeId } }),
    prisma.serviceResource.createMany({
      data: requirements.map((r) => ({ ...r, serviceTypeId })),
    }),
  ]);

  return { requirements };
}

/**
 * Any id supplied in a payload must belong to the caller's studio.
 *
 * These are the quiet cross-tenant holes: a valid category or policy id from
 * another organization would otherwise be accepted, since the row itself is
 * created under the right tenant.
 */
export async function assertReferencesBelong(
  organizationId: string,
  input: Record<string, unknown>,
  selfId?: string,
) {
  if (input.imageKey) {
    await assertOwnImage(organizationId, String(input.imageKey));
  }

  if (input.categoryId) {
    const category = await prisma.serviceCategory.findFirst({
      where: { id: String(input.categoryId), organizationId },
      select: { id: true },
    });
    if (!category) throw AppError.badRequest('Category not found.');
  }

  if (input.cancellationPolicyId) {
    const policy = await prisma.cancellationPolicy.findFirst({
      where: { id: String(input.cancellationPolicyId), organizationId },
      select: { id: true },
    });
    if (!policy) throw AppError.badRequest('Cancellation policy not found.');
  }

  /*
    Checked HERE and not left to setServiceLocations, which validates the same
    thing. On create the service row is written first, so a bad location id
    caught downstream would leave a saved-but-locationless class behind and
    report a failure — the studio then creates it again and has two.
  */
  if (input.locationId) {
    const location = await prisma.location.findFirst({
      where: { id: String(input.locationId), organizationId },
      select: { id: true },
    });
    if (!location) throw AppError.badRequest('Location not found.');
  }

  if (input.prerequisiteServiceTypeId) {
    const prerequisiteId = String(input.prerequisiteServiceTypeId);

    if (selfId && prerequisiteId === selfId) {
      throw AppError.badRequest('A service cannot be its own prerequisite.');
    }

    const prerequisite = await prisma.serviceType.findFirst({
      where: { id: prerequisiteId, organizationId },
      select: { id: true },
    });
    if (!prerequisite) throw AppError.badRequest('Prerequisite service not found.');
  }
}

// --- Categories -----------------------------------------------------------

/**
 * The studio's categories, each with how many activities use it (FB-13), so
 * the manager can say what deleting one would touch.
 */
export async function listCategories(organizationId: string) {
  const rows = await prisma.serviceCategory.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { serviceTypes: true } } },
  });
  return rows.map(({ _count, ...category }) => ({
    ...category,
    activityCount: _count.serviceTypes,
  }));
}

/**
 * Refuses a name another category of this studio already has, ignoring case
 * and surrounding spaces: "Kids" and "kids " side by side in a picker look
 * like a bug, and the unique index alone would let them both in.
 */
async function assertCategoryNameFree(
  organizationId: string,
  name: string,
  exceptId?: string,
) {
  const clash = await prisma.serviceCategory.findFirst({
    where: {
      organizationId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
  });
  if (clash) {
    throw AppError.conflict('A category with that name already exists.');
  }
}

export async function createCategory(
  organizationId: string,
  input: { name: string; sortOrder?: number },
) {
  const name = input.name.trim();
  if (!name) throw AppError.badRequest('Give the category a name.');
  await assertCategoryNameFree(organizationId, name);

  const category = await prisma.serviceCategory.create({
    data: { ...input, name, organizationId },
  });
  return { ...category, activityCount: 0 };
}

/** Renames a category. Its activities stay in it under the new name. */
export async function renameCategory(
  organizationId: string,
  id: string,
  input: { name: string },
) {
  const category = await prisma.serviceCategory.findFirst({
    where: { id, organizationId },
  });
  if (!category) throw AppError.notFound('Category not found.');

  const name = input.name.trim();
  if (!name) throw AppError.badRequest('Give the category a name.');
  await assertCategoryNameFree(organizationId, name, id);

  await prisma.serviceCategory.update({ where: { id }, data: { name } });
  return (await listCategories(organizationId)).find((c) => c.id === id)!;
}

export async function deleteCategory(organizationId: string, id: string) {
  const category = await prisma.serviceCategory.findFirst({
    where: { id, organizationId },
  });
  if (!category) throw AppError.notFound('Category not found.');

  // Services survive; they simply become uncategorised (onDelete: SetNull).
  await prisma.serviceCategory.delete({ where: { id } });
  return { deleted: true };
}
