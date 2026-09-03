import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { uniqueSlug } from '../../lib/slug';

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
  opts: { includeInactive?: boolean; bookingMode?: string } = {},
) {
  return prisma.serviceType.findMany({
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
      _count: { select: { staffServices: true, serviceLocations: true } },
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
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

  return prisma.serviceType.update({ where: { id }, data });
}

/**
 * Removes a service, but only when it has no history.
 *
 * Once a single booking exists the record is part of the studio's financial
 * record and must survive. The caller is told to deactivate instead, which is
 * what they almost always meant.
 */
export async function deleteService(organizationId: string, id: string) {
  const service = await prisma.serviceType.findFirst({
    where: { id, organizationId },
  });
  if (!service) throw AppError.notFound('Service not found.');

  const bookings = await prisma.booking.count({ where: { serviceTypeId: id } });
  const sessions = await prisma.session.count({ where: { serviceTypeId: id } });

  if (bookings > 0 || sessions > 0) {
    throw AppError.conflict(
      'This service has bookings and cannot be deleted. Deactivate it instead ' +
        'so it disappears from the booking page but its history is kept.',
      'SERVICE_IN_USE',
    );
  }

  await prisma.serviceType.delete({ where: { id } });
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
async function assertReferencesBelong(
  organizationId: string,
  input: Record<string, unknown>,
  selfId?: string,
) {
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

export async function listCategories(organizationId: string) {
  return prisma.serviceCategory.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function createCategory(
  organizationId: string,
  input: { name: string; sortOrder?: number },
) {
  const clash = await prisma.serviceCategory.findFirst({
    where: { organizationId, name: input.name },
  });
  if (clash) {
    throw AppError.conflict('A category with that name already exists.');
  }

  return prisma.serviceCategory.create({
    data: { ...input, organizationId },
  });
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
