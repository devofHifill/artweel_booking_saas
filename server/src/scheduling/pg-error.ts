import { AppError, BookingErrorCode } from '../lib/app-error';

/**
 * Postgres SQLSTATE codes we deliberately provoke.
 *
 * These are not "unexpected database errors". They are the designed failure
 * path: when a constraint rejects a write, that IS the system working. The
 * job here is to turn a raw SQLSTATE into a typed, customer-presentable
 * error rather than letting it surface as a 500.
 */
export const PgErrorCode = {
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  FOREIGN_KEY_VIOLATION: '23503',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
} as const;

/**
 * Prisma does not surface SQLSTATE consistently: sometimes it lands in
 * `meta.code`, sometimes only in the message text of an unknown-request
 * error. Rather than depend on which, we look in both places.
 */
export function extractSqlState(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;

  const anyErr = err as {
    meta?: { code?: unknown; constraint?: unknown };
    code?: unknown;
    message?: unknown;
  };

  const metaCode = anyErr.meta?.code;
  if (typeof metaCode === 'string') return metaCode;

  const message = typeof anyErr.message === 'string' ? anyErr.message : '';
  const match = /\b(\d{2}[0-9A-Z]{3})\b/.exec(message);
  return match?.[1];
}

export function extractConstraintName(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;

  const anyErr = err as {
    meta?: { constraint?: unknown };
    message?: unknown;
  };

  const c = anyErr.meta?.constraint;
  if (typeof c === 'string') return c;

  const message = typeof anyErr.message === 'string' ? anyErr.message : '';
  const match = /constraint "([^"]+)"/.exec(message);
  return match?.[1];
}

/**
 * Maps a constraint rejection to the booking error the customer should see.
 *
 * Anything not recognised is rethrown untouched — an unmapped failure is a
 * genuine bug and must not be laundered into a friendly 409.
 */
export function translateSchedulingError(err: unknown): never {
  const sqlState = extractSqlState(err);
  const constraint = extractConstraintName(err) ?? '';

  if (sqlState === PgErrorCode.EXCLUSION_VIOLATION) {
    if (constraint.startsWith('staff_time_blocks')) {
      throw new AppError(
        'That time is no longer available for this instructor.',
        409,
        BookingErrorCode.STAFF_UNAVAILABLE,
      );
    }
    if (constraint.startsWith('resource_allocations')) {
      throw new AppError(
        'A required piece of equipment is already booked for that time.',
        409,
        BookingErrorCode.RESOURCE_UNAVAILABLE,
      );
    }
    throw new AppError(
      'That time slot is no longer available.',
      409,
      BookingErrorCode.SLOT_NOT_BOOKABLE,
    );
  }

  if (sqlState === PgErrorCode.CHECK_VIOLATION) {
    if (constraint.startsWith('sessions_seats_within_capacity')) {
      throw new AppError(
        'This class is now full.',
        409,
        BookingErrorCode.SESSION_FULL,
      );
    }
  }

  // Contention, not a business rule. The caller may retry.
  if (
    sqlState === PgErrorCode.SERIALIZATION_FAILURE ||
    sqlState === PgErrorCode.DEADLOCK_DETECTED
  ) {
    throw new AppError(
      'The booking system was busy. Please try again.',
      409,
      BookingErrorCode.SLOT_NOT_BOOKABLE,
    );
  }

  throw err;
}
