import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';

/**
 * Equipment administration.
 *
 * Resources are what make a studio's capacity physically true rather than
 * aspirational. Eight wheels means eight students, whatever number somebody
 * typed into the class capacity field.
 */

export async function listResources(
  organizationId: string,
  opts: { includeInactive?: boolean } = {},
) {
  return prisma.resource.findMany({
    where: {
      organizationId,
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    include: {
      location: { select: { id: true, name: true } },
      _count: { select: { serviceResources: true } },
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
}

export async function createResource(
  organizationId: string,
  input: Record<string, unknown>,
) {
  if (input.locationId) {
    const location = await prisma.location.findFirst({
      where: { id: String(input.locationId), organizationId },
      select: { id: true },
    });
    if (!location) throw AppError.badRequest('Location not found.');
  }

  /**
   * Exclusivity and quantity are mutually constrained. An "exclusive"
   * resource with quantity 5 is incoherent: the EXCLUDE constraint permits
   * exactly one allocation at a time regardless of what the quantity says,
   * so the extra four would silently never be usable.
   */
  if (input.isExclusive === true && Number(input.quantity ?? 1) !== 1) {
    throw AppError.badRequest(
      'An exclusive resource must have a quantity of 1. Model multiple kilns ' +
        'as separate resources so each can be scheduled independently.',
      'EXCLUSIVE_QUANTITY',
    );
  }

  return prisma.resource.create({
    data: {
      ...(input as Prisma.ResourceUncheckedCreateInput),
      organizationId,
    },
  });
}

export async function updateResource(
  organizationId: string,
  id: string,
  input: Record<string, unknown>,
) {
  const existing = await prisma.resource.findFirst({ where: { id, organizationId } });
  if (!existing) throw AppError.notFound('Resource not found.');

  const merged = { ...existing, ...input };
  if (merged.isExclusive === true && Number(merged.quantity) !== 1) {
    throw AppError.badRequest(
      'An exclusive resource must have a quantity of 1.',
      'EXCLUSIVE_QUANTITY',
    );
  }

  if (
    typeof input.quantity === 'number' &&
    input.quantity < existing.quantity
  ) {
    await assertReductionSafe(id, input.quantity);
  }

  return prisma.resource.update({
    where: { id },
    data: input as Prisma.ResourceUncheckedUpdateInput,
  });
}

/**
 * Refuses a quantity reduction that would retroactively oversell equipment.
 *
 * A studio selling two of its eight wheels while classes are already booked
 * would leave those classes needing kit that no longer exists. Nothing would
 * fail at the moment of the edit — it would fail on the day, in front of
 * customers.
 *
 * This is a sweep line over allocation boundaries: walk every start and end in
 * chronological order, tracking concurrent usage, and record the peak.
 */
async function assertReductionSafe(resourceId: string, newQuantity: number) {
  const allocations = await prisma.resourceAllocation.findMany({
    where: { resourceId, endsAt: { gt: new Date() } },
    select: { startsAt: true, endsAt: true, quantity: true },
  });

  if (allocations.length === 0) return;

  const events: { at: number; delta: number }[] = [];
  for (const a of allocations) {
    events.push({ at: a.startsAt.getTime(), delta: a.quantity });
    events.push({ at: a.endsAt.getTime(), delta: -a.quantity });
  }

  // Ends before starts at the same instant: back-to-back allocations do not
  // overlap, matching the '[)' bounds used everywhere else.
  events.sort((x, y) => x.at - y.at || x.delta - y.delta);

  let current = 0;
  let peak = 0;
  let peakAt = 0;
  for (const event of events) {
    current += event.delta;
    if (current > peak) {
      peak = current;
      peakAt = event.at;
    }
  }

  if (peak > newQuantity) {
    throw AppError.conflict(
      `Upcoming bookings already need ${peak} of these at once ` +
        `(on ${new Date(peakAt).toISOString().slice(0, 10)}). ` +
        'Reduce the quantity to that number or higher, or cancel bookings first.',
      'QUANTITY_BELOW_COMMITTED',
    );
  }
}

export async function deleteResource(organizationId: string, id: string) {
  const resource = await prisma.resource.findFirst({ where: { id, organizationId } });
  if (!resource) throw AppError.notFound('Resource not found.');

  const allocations = await prisma.resourceAllocation.count({
    where: { resourceId: id },
  });
  if (allocations > 0) {
    throw AppError.conflict(
      'This equipment has allocation history and cannot be deleted. ' +
        'Deactivate it instead.',
      'RESOURCE_IN_USE',
    );
  }

  await prisma.resource.delete({ where: { id } });
  return { deleted: true };
}

/**
 * Blocks a resource for maintenance, or for a kiln firing that has no booking
 * behind it. The EXCLUDE constraint treats this exactly like any other
 * allocation, so a firing genuinely prevents a class from claiming the kiln.
 */
export async function blockResource(
  organizationId: string,
  resourceId: string,
  input: { startsAt: Date; endsAt: Date; quantity?: number; note?: string },
) {
  const { allocateResource } = await import(
    '../../scheduling/resource.service'
  );

  return allocateResource({
    organizationId,
    resourceId,
    quantity: input.quantity ?? 1,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    note: input.note ?? 'Blocked by studio',
  });
}
