import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { haversineKm, type TravelFeeBand } from '../../scheduling/travel/travel';
import { requireCapacity, requireFeature, type PlanId } from '../billing/plan';

/**
 * Locations.
 *
 * This is where the product's differentiator gets its admin surface. A
 * location is one of three genuinely different things:
 *
 *   FIXED             the studio. Customers come to it.
 *   SERVICE_AREA      a region the studio travels to. Coverage is a radius,
 *                     and travel time becomes a scheduling constraint.
 *   CUSTOMER_SUPPLIED the customer's own venue, captured at booking time.
 *
 * Competitors model all three as a text label. Treating coverage as real
 * geometry is what lets availability answer "can this instructor physically
 * get there in time" rather than merely "is the calendar free".
 */

export async function listLocations(
  organizationId: string,
  opts: { includeInactive?: boolean } = {},
) {
  return prisma.location.findMany({
    where: {
      organizationId,
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
}

export async function getLocation(organizationId: string, id: string) {
  const location = await prisma.location.findFirst({
    where: { id, organizationId },
    include: {
      staffLocations: { include: { staff: { select: { id: true, name: true } } } },
      serviceLocations: {
        include: { serviceType: { select: { id: true, name: true } } },
      },
    },
  });
  if (!location) throw AppError.notFound('Location not found.');
  return location;
}

export async function createLocation(
  organizationId: string,
  input: Record<string, unknown>,
) {
  validateGeometry(input);

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true },
  });

  const activeLocations = await prisma.location.count({
    where: { organizationId, isActive: true },
  });
  requireCapacity(org.plan as PlanId, 'maxLocations', activeLocations);

  // Mobile work is the product's differentiator and the reason to move up a
  // plan, so it is gated rather than merely limited.
  if (input.locationType === 'SERVICE_AREA') {
    requireFeature(org.plan as PlanId, 'mobileBookings');
  }

  return prisma.location.create({
    data: {
      ...(input as Prisma.LocationUncheckedCreateInput),
      organizationId,
    },
  });
}

export async function updateLocation(
  organizationId: string,
  id: string,
  input: Record<string, unknown>,
) {
  const existing = await prisma.location.findFirst({ where: { id, organizationId } });
  if (!existing) throw AppError.notFound('Location not found.');

  // Validate the MERGED shape: a patch that only changes locationType must
  // still satisfy that type's requirements using the existing coordinates.
  validateGeometry({ ...existing, ...input });

  return prisma.location.update({
    where: { id },
    data: input as Prisma.LocationUncheckedUpdateInput,
  });
}

export async function deleteLocation(organizationId: string, id: string) {
  const location = await prisma.location.findFirst({ where: { id, organizationId } });
  if (!location) throw AppError.notFound('Location not found.');

  const bookings = await prisma.booking.count({ where: { locationId: id } });
  if (bookings > 0) {
    throw AppError.conflict(
      'This location has booking history and cannot be deleted. ' +
        'Deactivate it instead.',
      'LOCATION_IN_USE',
    );
  }

  await prisma.location.delete({ where: { id } });
  return { deleted: true };
}

/**
 * Coverage and pricing rules, enforced at write time.
 *
 * A SERVICE_AREA without coordinates or a radius is not merely incomplete —
 * it silently makes every address "in range", which means the studio starts
 * accepting jobs three hours away.
 */
function validateGeometry(input: Record<string, unknown>) {
  const type = String(input.locationType ?? 'FIXED');

  if (type === 'SERVICE_AREA') {
    if (input.lat == null || input.lng == null) {
      throw AppError.badRequest(
        'A service area needs a centre point. Add coordinates for the location.',
        'MISSING_COORDINATES',
      );
    }
    if (input.radiusMeters == null || Number(input.radiusMeters) <= 0) {
      throw AppError.badRequest(
        'A service area needs a travel radius, otherwise every address counts as in range.',
        'MISSING_RADIUS',
      );
    }
  }

  if (input.lat != null) {
    const lat = Number(input.lat);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw AppError.badRequest('Latitude must be between -90 and 90.');
    }
  }
  if (input.lng != null) {
    const lng = Number(input.lng);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw AppError.badRequest('Longitude must be between -180 and 180.');
    }
  }

  if (input.travelFeeBands != null) {
    validateTravelFeeBands(input.travelFeeBands as TravelFeeBand[]);
  }
}

/**
 * Travel fee bands must be an ascending ladder with no duplicate boundaries.
 *
 * Lookup returns the FIRST band whose maxKm covers the distance, so an
 * out-of-order or duplicated ladder would charge a price nobody intended and
 * the studio would not discover it until a customer complained.
 */
function validateTravelFeeBands(bands: TravelFeeBand[]) {
  if (!Array.isArray(bands)) {
    throw AppError.badRequest('Travel fee bands must be a list.');
  }

  let previous = -1;
  for (const band of bands) {
    if (typeof band?.maxKm !== 'number' || band.maxKm <= 0) {
      throw AppError.badRequest('Each travel band needs a positive maxKm.');
    }
    if (typeof band.feeCents !== 'number' || band.feeCents < 0) {
      throw AppError.badRequest('Each travel band needs a fee of zero or more.');
    }
    if (band.maxKm <= previous) {
      throw AppError.badRequest(
        'Travel bands must be listed smallest distance first, with no repeats.',
        'BANDS_OUT_OF_ORDER',
      );
    }
    previous = band.maxKm;
  }
}

/**
 * Answers "will you come to this address, and what does it cost?"
 *
 * Used by the admin UI to sanity-check a service area, and by the public
 * booking flow in W1.3 to gate the address step before a customer picks a
 * time they can never actually have.
 */
export async function checkCoverage(
  organizationId: string,
  locationId: string,
  point: { lat: number; lng: number },
) {
  const location = await prisma.location.findFirst({
    where: { id: locationId, organizationId },
  });
  if (!location) throw AppError.notFound('Location not found.');

  if (location.lat == null || location.lng == null) {
    return { covered: false, reason: 'NO_ORIGIN' as const, distanceKm: null };
  }

  const distanceKm = haversineKm(
    { lat: location.lat, lng: location.lng },
    point,
  );

  if (location.radiusMeters != null && distanceKm * 1000 > location.radiusMeters) {
    return { covered: false, reason: 'OUT_OF_RANGE' as const, distanceKm };
  }

  const bands = location.travelFeeBands as TravelFeeBand[] | null;
  if (!bands || bands.length === 0) {
    return { covered: true, distanceKm, travelFeeCents: 0, minSpendCents: 0 };
  }

  const band = [...bands]
    .sort((a, b) => a.maxKm - b.maxKm)
    .find((b) => distanceKm <= b.maxKm);

  // Beyond every band means outside the service area, even if the radius
  // technically allowed it — the ladder is the stricter statement of intent.
  if (!band) {
    return { covered: false, reason: 'OUT_OF_RANGE' as const, distanceKm };
  }

  return {
    covered: true,
    distanceKm,
    travelFeeCents: band.feeCents,
    minSpendCents: band.minSpendCents ?? 0,
  };
}
