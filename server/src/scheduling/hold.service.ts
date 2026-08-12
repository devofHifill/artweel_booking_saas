import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { AppError, BookingErrorCode } from '../lib/app-error';
import { translateSchedulingError } from './pg-error';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  timeout: 15_000,
  maxWait: 15_000,
} as const;

/**
 * Holds exist to close the payment window.
 *
 * Without them, a customer who reaches Stripe Checkout has not actually
 * reserved anything — the last seat can be sold to somebody else while their
 * card details are in flight, and they get a failure after paying. The
 * previous implementation created the booking first and hoped payment
 * followed, which produces the mirror-image problem: phantom bookings for
 * abandoned carts.
 *
 * Held seats count toward sessions.seats_taken. One authoritative counter,
 * so availability queries need no knowledge of holds at all.
 */

export type CreateHoldInput = {
  organizationId: string;
  sessionId: string;
  customerId?: string;
  seats: number;
  ttlMinutes?: number;
  checkoutReference?: string;
};

type LockedSession = {
  id: string;
  capacity: number;
  seats_taken: number;
  status: string;
  starts_at: Date;
  ends_at: Date;
};

export async function createHold(input: CreateHoldInput) {
  const { organizationId, sessionId, seats } = input;
  const ttl = input.ttlMinutes ?? config.BOOKING_HOLD_TTL_MINUTES;

  try {
    return await prisma.$transaction(async (tx: Tx) => {
      const locked = await tx.$queryRaw<LockedSession[]>`
        SELECT id, capacity, seats_taken, status::text AS status, starts_at, ends_at
        FROM sessions
        WHERE id = ${sessionId}::uuid AND organization_id = ${organizationId}::uuid
        FOR UPDATE
      `;

      const session = locked[0];
      if (!session) throw AppError.notFound('Session not found.');
      if (session.status !== 'SCHEDULED') {
        throw new AppError(
          'This class is no longer open for booking.',
          409,
          BookingErrorCode.SLOT_NOT_BOOKABLE,
        );
      }

      const remaining = session.capacity - session.seats_taken;
      if (seats > remaining) {
        throw new AppError(
          remaining <= 0
            ? 'This class is now full.'
            : `Only ${remaining} seat(s) left in this class.`,
          409,
          remaining <= 0
            ? BookingErrorCode.SESSION_FULL
            : BookingErrorCode.INSUFFICIENT_SEATS,
        );
      }

      await tx.$executeRaw`
        UPDATE sessions
        SET seats_taken = seats_taken + ${seats}, updated_at = now()
        WHERE id = ${sessionId}::uuid
      `;

      return tx.bookingHold.create({
        data: {
          organizationId,
          sessionId,
          customerId: input.customerId ?? null,
          seats,
          startsAt: session.starts_at,
          endsAt: session.ends_at,
          expiresAt: new Date(Date.now() + ttl * 60_000),
          checkoutReference: input.checkoutReference,
        },
      });
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof AppError) throw err;
    translateSchedulingError(err);
  }
}

/**
 * Turns a live hold into a confirmed booking.
 *
 * The seats are ALREADY counted in seats_taken, so this must not increment
 * again — it transfers ownership of seats the hold is holding. Getting this
 * wrong double-counts and silently shrinks the class.
 */
export async function convertHold(
  organizationId: string,
  holdId: string,
  opts: { customerId: string; serviceTypeId?: string; source?: string },
) {
  return prisma.$transaction(async (tx: Tx) => {
    // Lock the hold itself so a concurrent expiry sweep cannot release the
    // same seats we are about to convert.
    const rows = await tx.$queryRaw<
      {
        id: string;
        session_id: string | null;
        seats: number;
        expires_at: Date;
        released_at: Date | null;
      }[]
    >`
      SELECT id, session_id, seats, expires_at, released_at
      FROM booking_holds
      WHERE id = ${holdId}::uuid AND organization_id = ${organizationId}::uuid
      FOR UPDATE
    `;

    const hold = rows[0];
    if (!hold) throw AppError.notFound('Hold not found.');
    if (hold.released_at) {
      throw new AppError(
        'This reservation has already been used or released.',
        409,
        BookingErrorCode.HOLD_EXPIRED,
      );
    }
    if (hold.expires_at.getTime() <= Date.now()) {
      throw new AppError(
        'Your reservation expired. Please pick your seats again.',
        409,
        BookingErrorCode.HOLD_EXPIRED,
      );
    }
    if (!hold.session_id) {
      throw AppError.badRequest('Hold is not attached to a session.');
    }

    const session = await tx.session.findUniqueOrThrow({
      where: { id: hold.session_id },
    });

    const booking = await tx.booking.create({
      data: {
        organizationId,
        customerId: opts.customerId,
        serviceTypeId: opts.serviceTypeId ?? session.serviceTypeId,
        sessionId: session.id,
        locationId: session.locationId,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        timezone: session.timezone,
        seats: hold.seats,
        status: 'CONFIRMED',
        cancelToken: randomBytes(32),
        source: opts.source ?? 'web',
      },
    });

    await tx.bookingHold.update({
      where: { id: hold.id },
      data: { releasedAt: new Date() },
    });

    return booking;
  }, TX_OPTIONS);
}

/**
 * Releases a single hold and returns its seats. Safe to call twice.
 *
 * Handles both shapes of hold. A course hold reserves a seat in every week of
 * its cohort, so releasing it gives back N seats across N sessions — and it
 * must do so in series order, matching every other writer, or the sweep can
 * deadlock against a concurrent enrolment.
 *
 * The expiry sweep calls this and needs no knowledge of courses at all.
 */
export async function releaseHold(organizationId: string, holdId: string) {
  return prisma.$transaction(async (tx: Tx) => {
    const rows = await tx.$queryRaw<
      {
        id: string;
        session_id: string | null;
        course_series_id: string | null;
        seats: number;
        released_at: Date | null;
      }[]
    >`
      SELECT id, session_id, course_series_id, seats, released_at
      FROM booking_holds
      WHERE id = ${holdId}::uuid AND organization_id = ${organizationId}::uuid
      FOR UPDATE
    `;

    const hold = rows[0];
    if (!hold) throw AppError.notFound('Hold not found.');
    if (hold.released_at) return { released: 0 };

    let released = 0;

    if (hold.session_id) {
      await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${hold.session_id}::uuid FOR UPDATE`;
      await tx.$executeRaw`
        UPDATE sessions
        SET seats_taken = GREATEST(0, seats_taken - ${hold.seats}), updated_at = now()
        WHERE id = ${hold.session_id}::uuid
      `;
      released = hold.seats;
    } else if (hold.course_series_id) {
      const sessions = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM sessions
        WHERE course_series_id = ${hold.course_series_id}::uuid
          AND organization_id = ${organizationId}::uuid
        ORDER BY series_index
        FOR UPDATE
      `;

      for (const session of sessions) {
        await tx.$executeRaw`
          UPDATE sessions
          SET seats_taken = GREATEST(0, seats_taken - ${hold.seats}), updated_at = now()
          WHERE id = ${session.id}::uuid
        `;
      }

      // One place on the course, however many weeks it spans. Reporting six
      // here would make the sweep's totals meaningless.
      released = sessions.length > 0 ? hold.seats : 0;
    }

    await tx.bookingHold.update({
      where: { id: hold.id },
      data: { releasedAt: new Date() },
    });

    return { released };
  }, TX_OPTIONS);
}

/**
 * Background sweep for abandoned checkouts.
 *
 * `released_at IS NULL` is what makes this idempotent — a hold cannot be
 * released twice no matter how often the job runs or how many workers run it,
 * and the partial index means the scan costs are proportional to open holds
 * rather than to all holds ever created.
 *
 * Runs on a queue in Phase 1. Exposed as a plain function so the gate tests
 * can drive it deterministically instead of waiting on a timer.
 */
export async function sweepExpiredHolds(now: Date = new Date()) {
  const expired = await prisma.$queryRaw<{ id: string; organization_id: string }[]>`
    SELECT id, organization_id
    FROM booking_holds
    WHERE released_at IS NULL AND expires_at <= ${now}
    LIMIT 500
  `;

  let seatsReleased = 0;
  for (const row of expired) {
    const result = await releaseHold(row.organization_id, row.id);
    seatsReleased += result.released;
  }

  return { holdsReleased: expired.length, seatsReleased };
}
