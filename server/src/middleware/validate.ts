import type { NextFunction, Request, Response } from 'express';
import type { ZodType, ZodTypeDef } from 'zod';
import { AppError } from '../lib/app-error';

/**
 * Input and output types are separate generics because schemas transform.
 * A query flag arrives as the string "true" and leaves as a boolean; a single
 * generic would force those to be the same type and reject the schema.
 */
type Schema<TOut, TIn> = ZodType<TOut, ZodTypeDef, TIn>;

/**
 * Parses and REPLACES req.body with the validated result.
 *
 * Replacing rather than merely checking is the point: anything the schema did
 * not declare is stripped, so a handler cannot accidentally forward an
 * attacker-supplied field into a Prisma call. That is the mass-assignment
 * hole, closed by construction.
 */
export function validateBody<TOut, TIn = TOut>(schema: Schema<TOut, TIn>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      }));

      next(
        new ValidationError('The submitted details are not valid.', details),
      );
      return;
    }

    req.body = result.data;
    next();
  };
}

export function validateQuery<TOut, TIn = TOut>(schema: Schema<TOut, TIn>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      }));
      next(new ValidationError('Invalid query parameters.', details));
      return;
    }

    // Express 4's req.query is a getter on some versions; assign defensively.
    Object.defineProperty(req, 'query', { value: result.data, writable: true });
    next();
  };
}

/**
 * Carries per-field messages so a form can highlight the offending input
 * instead of showing one generic banner.
 */
export class ValidationError extends AppError {
  public readonly details: { field: string; message: string }[];

  constructor(
    message: string,
    details: { field: string; message: string }[],
  ) {
    super(message, 422, 'VALIDATION_FAILED');
    this.name = 'ValidationError';
    this.details = details;
  }
}
