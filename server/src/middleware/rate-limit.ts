import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/app-error';

/**
 * A sliding-window limiter for the endpoints a stranger can reach.
 *
 * Originally the PUBLIC routes only: availability is comparatively expensive to
 * compute, and the booking endpoint writes. The auth routes now use it too,
 * where the thing being rationed is password guesses rather than CPU.
 *
 * IN-MEMORY, AND THAT IS A KNOWN LIMITATION. Counters live in this process, so
 * with two API instances behind nginx the effective limit doubles. That is
 * acceptable while this is a single container and unacceptable the moment it
 * is not — Redis is already in the compose file for exactly this, and moving
 * it is a Phase 2 task tracked in the deployment notes.
 */

/**
 * The window is stored PER BUCKET, not passed to the sweep.
 *
 * It used to be a sweep argument, which was harmless only because every
 * limiter happened to use the same 60s window. The sweep prunes *all* buckets,
 * so whichever limiter triggered it imposed its own window on everyone else's
 * counters: one marketing request (60s) would prune a 15-minute auth bucket
 * down to the last 60 seconds of hits and hand an attacker a fresh budget.
 *
 * A limiter whose window is silently shortened by unrelated traffic still
 * returns 429 in a unit test and still lets the attack through in production,
 * which is the worst combination available.
 */
type Bucket = { hits: number[]; windowMs: number };

const buckets = new Map<string, Bucket>();

// Stops the map growing without bound on a long-running process.
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;

  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < bucket.windowMs);
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
    sweep(now);

    // req.ip is trustworthy because app.set('trust proxy') is on and the app
    // only ever sits behind our own nginx.
    const key = `${opts.name}:${req.ip ?? 'unknown'}`;
    const bucket = buckets.get(key) ?? { hits: [], windowMs: opts.windowMs };
    bucket.windowMs = opts.windowMs;

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
