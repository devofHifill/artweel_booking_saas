import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, BookingErrorCode } from '../lib/app-error';
import { translateSchedulingError } from './pg-error';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  timeout: 15_000,
  maxWait: 15_000,
} as const;

/**
 * Resources come in two flavours and they need different protection.
 *
 *   EXCLUSIVE (kiln, room, van)
 *     Cannot be shared for any overlapping period. Enforced entirely by the
 *     partial EXCLUDE constraint — we just insert and let Postgres decide.
 *
 *   COUNTED (eight wheels)
 *     Overlap is legal up to `quantity`. No exclusion constraint can express
 *     "at most eight", so correctness comes from locking the resource row and
 *     summing existing overlapping allocations inside the same transaction.
 *
 * The counted case is the one that makes a studio's capacity physically real:
 * eight wheels means eight students, regardless of what number somebody typed
 * into the class capacity field.
 */

export type AllocateInput = {
  organizationId: string;
  resourceId: string;
  quantity: number;
  startsAt: Date;
  endsAt: Date;
  bookingId?: string | null;
  sessionId?: string | null;
  note?: string;
};

export async function allocateResource(input: AllocateInput) {
  const { organizationId, resourceId, quantity, startsAt, endsAt } = input;

  if (startsAt >= endsAt) {
    throw AppError.badRequest('Allocation must start before it ends.');
  }
  if (quantity < 1) {
    throw AppError.badRequest('Quantity must be at least 1.');
  }

  try {
    return await prisma.$transaction(async (tx: Tx) => {
      // Locking the resource row serialises all writers for THIS resource.
      // Without it, two transactions could each see 7 of 8 wheels used and
      // both allocate the eighth.
      const locked = await tx.$queryRaw<
        { id: string; quantity: number; is_exclusive: boolean; is_active: boolean }[]
      >`
        SELECT id, quantity, is_exclusive, is_active
        FROM resources
        WHERE id = ${resourceId}::uuid AND organization_id = ${organizationId}::uuid
        FOR UPDATE
      `;

      const resource = locked[0];
      if (!resource) throw AppError.notFound('Resource not found.');
      if (!resource.is_active) {
        throw new AppError(
          'That equipment is not currently available.',
          409,
          BookingErrorCode.RESOURCE_UNAVAILABLE,
        );
      }

      if (!resource.is_exclusive) {
        // Counted resource: sum what already overlaps this window.
        // '[)' matches the exclusion constraint's bounds so that back-to-back
        // allocations behave identically in both paths.
        const used = await tx.$queryRaw<{ used: bigint | null }[]>`
          SELECT SUM(quantity) AS used
          FROM resource_allocations
          WHERE resource_id = ${resourceId}::uuid
            AND tstzrange(starts_at, ends_at, '[)')
                && tstzrange(${startsAt}, ${endsAt}, '[)')
        `;

        const alreadyUsed = Number(used[0]?.used ?? 0);
        const available = resource.quantity - alreadyUsed;

        if (quantity > available) {
          throw new AppError(
            available <= 0
              ? 'All of that equipment is in use at that time.'
              : `Only ${available} available at that time.`,
            409,
            BookingErrorCode.RESOURCE_UNAVAILABLE,
          );
        }
      }

      // For exclusive resources this insert is the check: the EXCLUDE
      // constraint rejects any overlap. The BEFORE trigger sets `exclusive`
      // from the resource, so a caller cannot opt out of it.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO resource_allocations
          (id, organization_id, resource_id, booking_id, session_id,
           quantity, starts_at, ends_at, exclusive, note, created_at)
        VALUES
          (gen_random_uuid(), ${organizationId}::uuid, ${resourceId}::uuid,
           ${input.bookingId ?? null}::uuid, ${input.sessionId ?? null}::uuid,
           ${quantity}, ${startsAt}, ${endsAt}, false, ${input.note ?? null}, now())
        RETURNING id
      `;

      return rows[0]!;
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof AppError) throw err;
    translateSchedulingError(err);
  }
}

/**
 * Allocates every resource a service requires, for one booking.
 *
 * `quantityPerSeat` is why this is per-seat rather than per-booking: a class
 * of six students needs six wheels, not one.
 */
export async function allocateForService(params: {
  organizationId: string;
  serviceTypeId: string;
  seats: number;
  startsAt: Date;
  endsAt: Date;
  bookingId?: string;
  sessionId?: string;
}) {
  const requirements = await prisma.serviceResource.findMany({
    where: { serviceTypeId: params.serviceTypeId },
  });

  const allocated: string[] = [];
  for (const req of requirements) {
    const result = await allocateResource({
      organizationId: params.organizationId,
      resourceId: req.resourceId,
      quantity: req.quantityPerSeat * params.seats,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      bookingId: params.bookingId ?? null,
      sessionId: params.sessionId ?? null,
    });
    allocated.push(result.id);
  }

  return allocated;
}
