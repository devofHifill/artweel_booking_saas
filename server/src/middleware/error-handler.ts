import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/app-error';
import { logger } from '../lib/logger';
import { ValidationError } from './validate';

/**
 * The single place errors become HTTP responses.
 *
 * Operational AppErrors are surfaced to the client with their status, message
 * and code. Everything else is logged in full and returned as an opaque 500 —
 * we never leak internals.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError && err.isOperational) {
    res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: err.code ?? null,
        ...(err instanceof ValidationError ? { details: err.details } : {}),
      },
    });
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  res.status(500).json({
    error: { message: 'Internal Server Error', code: null },
  });
}
