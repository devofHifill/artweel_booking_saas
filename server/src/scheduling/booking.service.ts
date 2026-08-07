import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, BookingErrorCode } from '../lib/app-error';
import { translateSchedulingError } from './pg-error';

type Tx = Prisma.TransactionClient;

/**
 * Seat reservations always run at READ COMMITTED with an explicit row lock
 * rather than at SERIALIZABLE.
 *
 * SERIALIZABLE would also be correct, but it fails writers with 40001 under
 * contention and pushes the retry burden onto every caller. An explicit
 * `SELECT ... FOR UPDATE` on the session row makes concurrent bookers queue
 * politely instead: the second request blocks, then re-reads the committed
 * seat count and sees the truth.
 */
const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  timeout: 15_000,
  maxWait: 15_000,
} as const;

export type BookSeatsInput = {
  organizationId: string;
  sessionId: string;
  customerId: string;
  seats: number;
  source?: string;
  notes?: string;
};

type LockedSession = {
  id: string;
  capacity: number;
  seats_taken: number;
  status: string;
  starts_at: Date;
  ends_at: Date;
  timezone: string;
  service_type_id: string;
  location_id: string | null;
};

/**
 * Books seats on an existing session (a class, a workshop, one week of a
 * course).
 *
 * The ordering matters and is not negotiable:
 *
 *   1. Lock the session row. Every other writer for this session now waits.
 *   2. Re-read seats_taken — under READ COMMITTED the lock acquisition
 *      re-evaluates the row, so this is the committed truth, not a stale
 *      snapshot from before we queued.
 *   3. Decide. If there is not enough room, fail with a typed error.
 *   4. Increment, then insert. The CHECK constraint backstops step 3.
 *
 * This is the exact shape the previous WordPress implementation lacked: it
 * read the seat count outside any lock, decided, and inserted, so two
 * simultaneous bookings for the last seat both succeeded.
 */
export async function bookSeats(input: BookSeatsInput) {
  const { organizationId, sessionId, customerId, seats } = input;

  if (seats < 1) {
    throw AppError.badRequest('Seats must be at least 1.');
  }

  try {
    return await prisma.$transaction(async (tx: Tx) => {
      const locked = await tx.$queryRaw<LockedSession[]>`
        SELECT id, capacity, seats_taken, status::text AS status,
               starts_at, ends_at, timezone, service_type_id, location_id
        FROM sessions
        WHERE id = ${sessionId}::uuid
          AND organization_id = ${organizationId}::uuid
        FOR UPDATE
      `;

      const session = locked[0];
      if (!session) {
        throw AppError.notFound('Session not found.');
      }
      if (session.status !== 'SCHEDULED') {
        throw new AppError(
          'This class is no longer open for booking.',
          409,
          BookingErrorCode.SLOT_NOT_BOOKABLE,
        );
      }

      const remaining = session.capacity - session.seats_taken;
      if (remaining <= 0) {
        throw new AppError(
          'This class is now full.',
          409,
          BookingErrorCode.SESSION_FULL,
        );
      }
      if (seats > remaining) {
        throw new AppError(
          `Only ${remaining} seat(s) left in this class.`,
          409,
          BookingErrorCode.INSUFFICIENT_SEATS,
        );
      }

      await tx.$executeRaw`
        UPDATE sessions
        SET seats_taken = seats_taken + ${seats}, updated_at = now()
        WHERE id = ${sessionId}::uuid
      `;

      const booking = await tx.booking.create({
        data: {
          organizationId,
          customerId,
          serviceTypeId: session.service_type_id,
          sessionId: session.id,
          locationId: session.location_id,
          startsAt: session.starts_at,
          endsAt: session.ends_at,
          timezone: session.timezone,
          seats,
          status: 'CONFIRMED',
          cancelToken: randomBytes(32),
          source: input.source ?? 'web',
          notes: input.notes,
        },
      });

      return booking;
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof AppError) throw err;
    translateSchedulingError(err);
  }
}

export type BookAppointmentInput = {
  organizationId: string;
  staffId: string;
  serviceTypeId: string;
  customerId: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  locationId?: string | null;
  /**
   * Minutes of padding and, for mobile work, travel. The time block written
   * for the instructor covers service time PLUS this, because that is the
   * span during which they genuinely cannot do anything else.
   */
  paddingBeforeMinutes?: number;
  paddingAfterMinutes?: number;
  serviceAddress?: Prisma.InputJsonValue;
  /** Where the instructor must physically be. Drives travel-time widening. */
  lat?: number | null;
  lng?: number | null;
  source?: string;
};

/**
 * Books a one-to-one appointment against a staff member.
 *
 * There is no read-then-check here at all. The staff_time_blocks insert is
 * the check: if the instructor is already committed for any overlapping
 * period — by another appointment, by a group class, by anything — the
 * EXCLUDE constraint rejects it and Postgres decides the winner.
 *
 * Doing the block insert BEFORE the booking insert matters: it means the
 * losing transaction aborts before writing anything a customer could see.
 */
export async function bookAppointment(input: BookAppointmentInput) {
  const {
    organizationId,
    staffId,
    serviceTypeId,
    customerId,
    startsAt,
    endsAt,
    timezone,
  } = input;

  if (startsAt >= endsAt) {
    throw AppError.badRequest('Booking must start before it ends.');
  }

  const blockStart = new Date(
    startsAt.getTime() - (input.paddingBeforeMinutes ?? 0) * 60_000,
  );
  const blockEnd = new Date(
    endsAt.getTime() + (input.paddingAfterMinutes ?? 0) * 60_000,
  );

  try {
    return await prisma.$transaction(async (tx: Tx) => {
      const booking = await tx.booking.create({
        data: {
          organizationId,
          customerId,
          serviceTypeId,
          staffId,
          locationId: input.locationId ?? null,
          serviceAddress: input.serviceAddress,
          startsAt,
          endsAt,
          timezone,
          seats: 1,
          status: 'CONFIRMED',
          cancelToken: randomBytes(32),
          source: input.source ?? 'web',
        },
      });

      // Raw, because Prisma does not surface SQLSTATE 23P01 from its own
      // create() in a form we can reliably translate.
      await tx.$executeRaw`
        INSERT INTO staff_time_blocks
          (id, organization_id, staff_id, booking_id, starts_at, ends_at,
           lat, lng, source, created_at)
        VALUES
          (gen_random_uuid(), ${organizationId}::uuid, ${staffId}::uuid,
           ${booking.id}::uuid, ${blockStart}, ${blockEnd},
           ${input.lat ?? null}, ${input.lng ?? null}, 'booking', now())
      `;

      return booking;
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof AppError) throw err;
    translateSchedulingError(err);
  }
}

/**
 * Cancels a booking and returns its seats or its time block.
 *
 * Idempotent: cancelling an already-cancelled booking is a no-op, not an
 * error. Retried webhook deliveries and double-clicked cancel links both
 * depend on that.
 */
export async function cancelBooking(organizationId: string, bookingId: string) {
  return prisma.$transaction(async (tx: Tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, organizationId },
    });

    if (!booking) throw AppError.notFound('Booking not found.');
    if (booking.status === 'CANCELLED') return booking;

    if (booking.sessionId) {
      // Lock before decrementing, for the same reason we lock before
      // incrementing.
      await tx.$queryRaw`
        SELECT id FROM sessions WHERE id = ${booking.sessionId}::uuid FOR UPDATE
      `;
      await tx.$executeRaw`
        UPDATE sessions
        SET seats_taken = GREATEST(0, seats_taken - ${booking.seats}),
            updated_at = now()
        WHERE id = ${booking.sessionId}::uuid
      `;
    }

    // Deleting the block frees the instructor immediately and keeps the
    // exclusion index small. The booking row itself is retained as the audit
    // record, marked CANCELLED.
    await tx.staffTimeBlock.deleteMany({ where: { bookingId: booking.id } });
    await tx.resourceAllocation.deleteMany({ where: { bookingId: booking.id } });

    return tx.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED' },
    });
  }, TX_OPTIONS);
}
