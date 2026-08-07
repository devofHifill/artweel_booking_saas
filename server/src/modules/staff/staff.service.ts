import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { requireCapacity, type PlanId } from '../billing/plan';

/**
 * Staff administration.
 *
 * A staff record is not a login. It is the schedulable *person* — the thing
 * availability rules, time blocks and bookings point at. Linking it to a User
 * account is optional and separate, because studios routinely list an
 * instructor long before that instructor ever signs in, and freelancers get
 * listed at several studios.
 */

export async function listStaff(
  organizationId: string,
  opts: { includeInactive?: boolean } = {},
) {
  return prisma.staff.findMany({
    where: {
      organizationId,
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    include: {
      staffServices: {
        include: { serviceType: { select: { id: true, name: true } } },
      },
      staffLocations: {
        include: { location: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
}

export async function getStaff(organizationId: string, id: string) {
  const staff = await prisma.staff.findFirst({
    where: { id, organizationId },
    include: {
      staffServices: { include: { serviceType: true } },
      staffLocations: { include: { location: true } },
      availabilityRules: true,
      availabilityOverride: {
        where: { localDate: { gte: new Date().toISOString().slice(0, 10) } },
        orderBy: { localDate: 'asc' },
      },
    },
  });

  if (!staff) throw AppError.notFound('Staff member not found.');
  return staff;
}

export async function createStaff(
  organizationId: string,
  input: Record<string, unknown>,
) {
  // Checked at creation, not at read: a studio that downgrades keeps the
  // instructors it already has, it just cannot add more. Deactivating
  // somebody's colleagues because a card expired would be indefensible.
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true },
  });
  const activeStaff = await prisma.staff.count({
    where: { organizationId, isActive: true },
  });
  requireCapacity(org.plan as PlanId, 'maxStaff', activeStaff);

  const email = String(input.email).trim().toLowerCase();

  // Composite unique is (organizationId, email): the same freelancer may
  // exist at several studios, but not twice at one.
  const clash = await prisma.staff.findFirst({
    where: { organizationId, email },
  });
  if (clash) {
    throw AppError.conflict(
      'A staff member with that email already exists at this studio.',
      'STAFF_EMAIL_TAKEN',
    );
  }

  return prisma.staff.create({
    data: {
      ...(input as Prisma.StaffUncheckedCreateInput),
      email,
      organizationId,
    },
  });
}

export async function updateStaff(
  organizationId: string,
  id: string,
  input: Record<string, unknown>,
) {
  const existing = await prisma.staff.findFirst({ where: { id, organizationId } });
  if (!existing) throw AppError.notFound('Staff member not found.');

  const data: Prisma.StaffUncheckedUpdateInput = { ...input };

  if (typeof input.email === 'string') {
    const email = input.email.trim().toLowerCase();
    if (email !== existing.email) {
      const clash = await prisma.staff.findFirst({
        where: { organizationId, email, id: { not: id } },
      });
      if (clash) {
        throw AppError.conflict(
          'A staff member with that email already exists at this studio.',
          'STAFF_EMAIL_TAKEN',
        );
      }
    }
    data.email = email;
  }

  /**
   * Deactivating somebody who still has work on the books is refused.
   *
   * Availability would stop offering them immediately while their existing
   * bookings stayed live, so customers would arrive for a lesson with an
   * instructor the system considers gone. Cancel or reassign first.
   */
  if (input.isActive === false && existing.isActive) {
    const upcoming = await prisma.booking.count({
      where: {
        staffId: id,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startsAt: { gte: new Date() },
      },
    });
    const upcomingSessions = await prisma.session.count({
      where: { staffId: id, status: 'SCHEDULED', startsAt: { gte: new Date() } },
    });

    if (upcoming > 0 || upcomingSessions > 0) {
      throw AppError.conflict(
        `This instructor still has ${upcoming + upcomingSessions} upcoming ` +
          'commitments. Reassign or cancel them before deactivating.',
        'STAFF_HAS_UPCOMING',
      );
    }
  }

  return prisma.staff.update({ where: { id }, data });
}

export async function deleteStaff(organizationId: string, id: string) {
  const staff = await prisma.staff.findFirst({ where: { id, organizationId } });
  if (!staff) throw AppError.notFound('Staff member not found.');

  const bookings = await prisma.booking.count({ where: { staffId: id } });
  if (bookings > 0) {
    throw AppError.conflict(
      'This instructor has booking history and cannot be deleted. ' +
        'Deactivate them instead so the record is kept.',
      'STAFF_IN_USE',
    );
  }

  await prisma.staff.delete({ where: { id } });
  return { deleted: true };
}

/** Replaces the set of services this person is qualified to deliver. */
export async function setStaffServices(
  organizationId: string,
  staffId: string,
  serviceTypeIds: string[],
) {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, organizationId } });
  if (!staff) throw AppError.notFound('Staff member not found.');

  const owned = await prisma.serviceType.findMany({
    where: { id: { in: serviceTypeIds }, organizationId },
    select: { id: true },
  });
  if (owned.length !== serviceTypeIds.length) {
    throw AppError.badRequest('One or more services were not found.');
  }

  await prisma.$transaction([
    prisma.staffService.deleteMany({ where: { staffId } }),
    prisma.staffService.createMany({
      data: serviceTypeIds.map((serviceTypeId) => ({ staffId, serviceTypeId })),
    }),
  ]);

  return { serviceTypeIds };
}

/** Replaces the set of locations this person works from. */
export async function setStaffLocations(
  organizationId: string,
  staffId: string,
  locationIds: string[],
) {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, organizationId } });
  if (!staff) throw AppError.notFound('Staff member not found.');

  const owned = await prisma.location.findMany({
    where: { id: { in: locationIds }, organizationId },
    select: { id: true },
  });
  if (owned.length !== locationIds.length) {
    throw AppError.badRequest('One or more locations were not found.');
  }

  await prisma.$transaction([
    prisma.staffLocation.deleteMany({ where: { staffId } }),
    prisma.staffLocation.createMany({
      data: locationIds.map((locationId) => ({ staffId, locationId })),
    }),
  ]);

  return { locationIds };
}
