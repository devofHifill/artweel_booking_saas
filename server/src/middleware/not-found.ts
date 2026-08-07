import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/app-error';

/** Anything that matched no route becomes a 404 AppError. */
export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}
