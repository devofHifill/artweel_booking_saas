import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/app-error';
import { logger } from '../lib/logger';
import { ValidationError } from './validate';
import { PAGE_NOT_FOUND, linkNotFound, renderNotFound } from '../modules/marketing/landing';

/**
 * Whether this 404 should be a page rather than JSON.
 *
 * Only a GET or HEAD from something that prefers HTML over JSON: a browser
 * following a link sends `Accept: text/html,...`, while fetch() accepts any
 * type (which `accepts` resolves to json, listed first) and API clients ask
 * for JSON outright. The API and the webhooks never get a page, whatever they
 * accept, so nothing that parses these responses can be handed HTML.
 */
function wantsPage(req: Request): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (req.path.startsWith('/api/') || req.path.startsWith('/webhooks/')) return false;
  return req.accepts(['json', 'html']) === 'html';
}

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
    /*
      Until 2026-11-24 a mistyped URL or a dead booking link showed a visitor
      the raw JSON below. A link under /public/ is a customer's (a booking, a
      studio, a waitlist offer), so it says which thing is missing; anything
      else is a page that does not exist.
    */
    if (err.statusCode === 404 && wantsPage(req)) {
      const copy = req.path.startsWith('/public/') ? linkNotFound(err.message) : PAGE_NOT_FOUND;
      res.status(404).type('html').send(renderNotFound(copy));
      return;
    }

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
