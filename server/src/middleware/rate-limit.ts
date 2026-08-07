import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/app-error';

/**
 * A sliding-window limiter for the PUBLIC endpoints.
 *
 * These are the only routes an unauthenticated stranger can reach, which makes
 * them the ones worth protecting: availability is comparatively expensive to
 * compute, and the booking endpoint writes.
 *
 * IN-MEMORY, AND THAT IS A KNOWN LIMITATION. Counters live in this process, so
 * with two API instances behind nginx the effective limit doubles. That is
 * acceptable while this is a single container and unacceptable the moment it
 * is not — Redis is already in the compose file for exactly this, and moving
 * it is a Phase 2 task tracked in the deployment notes.
 */

type Bucket = { hits: number[]; };

const buckets = new Map<string, Bucket>();

// Stops the map growing without bound on a long-running process.
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = Date.now();

function sweep(windowMs: number, now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;

  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export function rateLimit(opts: {
  windowMs: number;
  max: number;
  /** Distinguishes limiters so a read budget cannot be spent on writes. */
  name: string;
}) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    sweep(opts.windowMs, now);

    // req.ip is trustworthy because app.set('trust proxy') is on and the app
    // only ever sits behind our own nginx.
    const key = `${opts.name}:${req.ip ?? 'unknown'}`;
    const bucket = buckets.get(key) ?? { hits: [] };

    bucket.hits = bucket.hits.filter((t) => now - t < opts.windowMs);

    if (bucket.hits.length >= opts.max) {
      buckets.set(key, bucket);
      next(
        new AppError(
          'Too many requests. Please wait a moment and try again.',
          429,
          'RATE_LIMITED',
        ),
      );
      return;
    }

    bucket.hits.push(now);
    buckets.set(key, bucket);
    next();
  };
}

/** Test hook — the suite would otherwise inherit counters between cases. */
export function resetRateLimits() {
  buckets.clear();
}
