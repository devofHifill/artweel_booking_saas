import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not catch rejected promises from async handlers — an
 * unhandled rejection would hang the request instead of returning a 500.
 * Wrapping a handler here forwards any rejection to the error middleware.
 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
