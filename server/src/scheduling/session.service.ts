import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/app-error';
import { translateSchedulingError } from './pg-error';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  timeout: 15_000,
  maxWait: 15_000,
} as const;

export type CreateSessionInput = {
  organizationId: string;
  serviceTypeId: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  /** Wall-clock intent, e.g. "19:00". Survives DST; the instant does not. */
  localStartTime: string;
  capacity: number;
  staffId?: string | null;
  locationId?: string | null;
  courseSeriesId?: string | null;
  seriesIndex?: number | null;
  paddingBeforeMinutes?: number;
  paddingAfterMinutes?: number;
  /** Where the session physically happens. Drives travel-time widening. */
  lat?: number | null;
  lng?: number | null;
};

/**
 * Creates a bookable session.
 *
 * The important half is the second insert. When a session has an instructor,
 * it MUST occupy that instructor's time in staff_time_blocks — otherwise the
 * exclusion constraint has nothing to compare a later private appointment
 * against, and the instructor gets booked twice at 2pm.
 *
 * This is precisely the gap in the previous implementation: event bookings
 * stored staff_id = NULL, so nothing anywhere knew the instructor was busy.
 */
export async function createSession(input: CreateSessionInput) {
  if (input.startsAt >= input.endsAt) {
    throw AppError.badRequest('Session must start before it ends.');
  }
  if (input.capacity < 1) {
    throw AppError.badRequest('Capacity must be at least 1.');
  }

  const blockStart = new Date(
    input.startsAt.getTime() - (input.paddingBeforeMinutes ?? 0) * 60_000,
  );
  const blockEnd = new Date(
    input.endsAt.getTime() + (input.paddingAfterMinutes ?? 0) * 60_000,
  );

  try {
    return await prisma.$transaction(async (tx: Tx) => {
      const session = await tx.session.create({
        data: {
          organizationId: input.organizationId,
          serviceTypeId: input.serviceTypeId,
          courseSeriesId: input.courseSeriesId ?? null,
          seriesIndex: input.seriesIndex ?? null,
          staffId: input.staffId ?? null,
          locationId: input.locationId ?? null,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          timezone: input.timezone,
          localStartTime: input.localStartTime,
          capacity: input.capacity,
          seatsTaken: 0,
          status: 'SCHEDULED',
        },
      });

      if (input.staffId) {
        await tx.$executeRaw`
          INSERT INTO staff_time_blocks
            (id, organization_id, staff_id, session_id, starts_at, ends_at,
             lat, lng, source, created_at)
          VALUES
            (gen_random_uuid(), ${input.organizationId}::uuid, ${input.staffId}::uuid,
             ${session.id}::uuid, ${blockStart}, ${blockEnd},
             ${input.lat ?? null}, ${input.lng ?? null}, 'session', now())
        `;
      }

      return session;
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof AppError) throw err;
    translateSchedulingError(err);
  }
}

/** Cancels a session and frees the instructor. Bookings are cancelled separately. */
export async function cancelSession(organizationId: string, sessionId: string) {
  return prisma.$transaction(async (tx: Tx) => {
    const session = await tx.session.findFirst({
      where: { id: sessionId, organizationId },
    });
    if (!session) throw AppError.notFound('Session not found.');

    await tx.staffTimeBlock.deleteMany({ where: { sessionId } });
    await tx.resourceAllocation.deleteMany({ where: { sessionId } });

    return tx.session.update({
      where: { id: sessionId },
      data: { status: 'CANCELLED' },
    });
  }, TX_OPTIONS);
}
