/**
 * The limiter's sweep must respect each bucket's OWN window.
 *
 * This is a regression test for a bug that was latent for as long as every
 * limiter shared a 60-second window. The sweep prunes all buckets at once, and
 * it used to prune them using the window of whichever limiter happened to
 * trigger it — so a single request to a short-window limiter would discard a
 * long-window limiter's counters and hand the caller a fresh budget.
 *
 * S0 introduced the first long window (15 minutes on the auth routes), which
 * turned the latent bug into a live one: any marketing or public request would
 * have reset the login limit. It is worth a dedicated test because the failure
 * is invisible from inside a single limiter — the limiter returns 429 exactly
 * when it should in isolation, and leaks only in the presence of other traffic.
 *
 * Driven through the middleware directly rather than over HTTP: the mechanism
 * under test is time-dependent, and faking the clock around supertest and
 * Prisma buys nothing but flakiness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit, resetRateLimits } from '../../src/middleware/rate-limit';
import { AppError } from '../../src/lib/app-error';

const MINUTE = 60_000;

/** Runs one request through a limiter and reports the status it would produce. */
function hit(
  middleware: ReturnType<typeof rateLimit>,
  ip = '198.51.100.7',
): number {
  let status = 200;

  middleware({ ip } as Request, {} as Response, ((err?: unknown) => {
    if (err instanceof AppError) status = err.statusCode;
    else if (err) throw err;
  }) as NextFunction);

  return status;
}

let now: number;

beforeEach(() => {
  resetRateLimits();
  now = Date.UTC(2026, 7, 17, 9, 0, 0);
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimits();
});

describe('sweeping with mixed windows', () => {
  it('does not let short-window traffic refill a long-window budget', () => {
    const short = rateLimit({ windowMs: MINUTE, max: 100, name: 'short' });
    const long = rateLimit({ windowMs: 15 * MINUTE, max: 2, name: 'long' });

    expect(hit(long)).toBe(200);
    expect(hit(long)).toBe(200);
    expect(hit(long)).toBe(429);

    // Past the sweep interval, so the next request anywhere triggers a sweep —
    // but well inside the long limiter's 15-minute window.
    now += 61_000;
    expect(hit(short)).toBe(200);

    expect(
      hit(long),
      'the long window has not elapsed, so the budget must still be spent',
    ).toBe(429);
  });

  it('still frees a budget once that bucket\'s own window elapses', () => {
    const long = rateLimit({ windowMs: 15 * MINUTE, max: 2, name: 'long' });

    expect(hit(long)).toBe(200);
    expect(hit(long)).toBe(200);
    expect(hit(long)).toBe(429);

    now += 15 * MINUTE + 1;
    expect(hit(long)).toBe(200);
  });

  it('keeps budgets separate per caller', () => {
    const limiter = rateLimit({ windowMs: 15 * MINUTE, max: 1, name: 'per-ip' });

    expect(hit(limiter, '198.51.100.7')).toBe(200);
    expect(hit(limiter, '198.51.100.7')).toBe(429);
    expect(hit(limiter, '203.0.113.9')).toBe(200);
  });
});
