/**
 * AppError is what any layer throws when something goes wrong in an
 * ANTICIPATED way. It carries an HTTP status and a machine-readable code.
 * The error middleware is the single place these become responses, so
 * services and controllers never format error output themselves.
 *
 * Anything that is not an operational AppError is treated as a bug and
 * hidden from the client.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, code?: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad Request', code?: string) {
    return new AppError(message, 400, code);
  }

  static unauthorized(message = 'Unauthorized', code?: string) {
    return new AppError(message, 401, code);
  }

  static forbidden(message = 'Forbidden', code?: string) {
    return new AppError(message, 403, code);
  }

  static notFound(message = 'Not Found', code?: string) {
    return new AppError(message, 404, code);
  }

  static conflict(message = 'Conflict', code?: string) {
    return new AppError(message, 409, code);
  }
}

/**
 * Booking-specific failure codes.
 *
 * These are not decoration. The concurrency gate test asserts that 95 of 100
 * losing requests fail with a CORRECTLY TYPED error — a generic 500 would
 * mean we prevented the overbooking by accident rather than by design, and
 * the public booking page could not tell a customer what actually happened.
 */
export const BookingErrorCode = {
  SESSION_FULL: 'SESSION_FULL',
  INSUFFICIENT_SEATS: 'INSUFFICIENT_SEATS',
  STAFF_UNAVAILABLE: 'STAFF_UNAVAILABLE',
  RESOURCE_UNAVAILABLE: 'RESOURCE_UNAVAILABLE',
  SLOT_NOT_BOOKABLE: 'SLOT_NOT_BOOKABLE',
  HOLD_EXPIRED: 'HOLD_EXPIRED',
  OUTSIDE_NOTICE_WINDOW: 'OUTSIDE_NOTICE_WINDOW',
} as const;

export type BookingErrorCode =
  (typeof BookingErrorCode)[keyof typeof BookingErrorCode];
