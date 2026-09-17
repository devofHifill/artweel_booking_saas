/**
 * S0 — the auth routes are rate limited.
 *
 * This file is the one place in the suite where the limits are set LOW. Every
 * other file raises them out of the way (tests/setup.ts) so that fixture volume
 * does not trip them, which means every other file proves the limiters are
 * harmless and none of them proves the limiters work. That is what this file is
 * for.
 *
 * `src/config` validates the environment ONCE, at import time, so the low limits
 * have to be in `process.env` before anything that reaches config is loaded.
 * That makes the import list load-bearing, and every module below is imported
 * dynamically for a reason:
 *
 *   src/app                  -> config, obviously
 *   src/lib/prisma           -> config, one hop
 *   tests/helpers/fixtures   -> src/lib/prisma -> config, two hops
 *
 * Static `import` statements are hoisted above the assignments below, so any one
 * of those three at the top of this file would freeze config at the raised
 * limits from tests/setup.ts and this whole file would pass while asserting
 * nothing. It did exactly that on the first run: five 401s and 201s where 429s
 * were expected, because the limits under test were 100000.
 *
 * `src/middleware/rate-limit` is the exception and stays static — it imports
 * only `app-error`, which imports nothing at all.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { resetRateLimits } from '../../src/middleware/rate-limit';

const LOGIN_MAX = 4;
const REGISTER_MAX = 3;
const RESET_MAX = 3;

process.env.AUTH_LOGIN_RATE_MAX = String(LOGIN_MAX);
process.env.AUTH_REGISTER_RATE_MAX = String(REGISTER_MAX);
process.env.AUTH_RESET_RATE_MAX = String(RESET_MAX);
process.env.AUTH_RATE_WINDOW_MINUTES = '15';

const PASSWORD = 'kiln-shelf-glaze-42';

let app: Express;
let prisma: PrismaClient;
let resetDb: () => Promise<void>;

beforeAll(async () => {
  const [{ createApp }, prismaModule, fixtures] = await Promise.all([
    import('../../src/app'),
    import('../../src/lib/prisma'),
    import('../helpers/fixtures'),
  ]);

  app = createApp();
  prisma = prismaModule.prisma;
  resetDb = fixtures.resetDb;

  // The limits the rest of this file asserts against must be the ones the app
  // actually loaded. Without this, a stray static import reintroduces the bug
  // above and every assertion below quietly stops meaning anything.
  const { config } = await import('../../src/config');
  expect(config.AUTH_LOGIN_RATE_MAX).toBe(LOGIN_MAX);
  expect(config.AUTH_REGISTER_RATE_MAX).toBe(REGISTER_MAX);
  expect(config.AUTH_RESET_RATE_MAX).toBe(RESET_MAX);

  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

function login(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}

function register(email: string) {
  return request(app).post('/api/auth/register').send({
    email,
    password: PASSWORD,
    name: 'Rowan Pike',
    organizationName: 'Clay & Co',
  });
}

describe('login is rate limited', () => {
  it('stops accepting password guesses once the budget is spent', async () => {
    await register('rowan@clay.test');
    resetRateLimits();

    for (let attempt = 1; attempt <= LOGIN_MAX; attempt++) {
      const res = await login('rowan@clay.test', 'wrong-password');
      expect(res.status, `attempt ${attempt} should still be answered`).toBe(401);
    }

    const blocked = await login('rowan@clay.test', 'wrong-password');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error?.code ?? blocked.body.code).toBe('RATE_LIMITED');
  });

  /**
   * The point of the limiter is that it runs BEFORE the password check. If it
   * were applied after, an attacker's guesses would still be evaluated and the
   * budget would only shape the responses they saw.
   */
  it('blocks the correct password too, once the budget is spent', async () => {
    await register('rowan@clay.test');
    resetRateLimits();

    for (let attempt = 1; attempt <= LOGIN_MAX; attempt++) {
      await login('rowan@clay.test', 'wrong-password');
    }

    const res = await login('rowan@clay.test', PASSWORD);
    expect(res.status).toBe(429);
  });

  /**
   * An attacker working through a list of addresses must not get a fresh budget
   * for each one. This is the case an email-keyed limiter would miss and the
   * reason this one is keyed on the caller.
   */
  it('counts attempts across different email addresses', async () => {
    for (let attempt = 1; attempt <= LOGIN_MAX; attempt++) {
      const res = await login(`stranger-${attempt}@nowhere.test`, 'guess');
      expect(res.status).toBe(401);
    }

    const blocked = await login('another@nowhere.test', 'guess');
    expect(blocked.status).toBe(429);
  });
});

describe('registration is rate limited', () => {
  it('stops accepting signups once the budget is spent', async () => {
    for (let n = 1; n <= REGISTER_MAX; n++) {
      const res = await register(`owner-${n}@clay.test`);
      expect(res.status, `signup ${n} should succeed`).toBe(201);
    }

    const blocked = await register('owner-overflow@clay.test');
    expect(blocked.status).toBe(429);
  });
});

describe('password reset is rate limited', () => {
  /**
   * forgot-password and reset-password deliberately share one budget, because
   * they are two halves of one flow. Spending it on the first must leave none
   * for the second.
   */
  it('shares one budget between requesting and completing a reset', async () => {
    for (let n = 1; n <= RESET_MAX; n++) {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'rowan@clay.test' });
      expect(res.status, `request ${n} should be accepted`).toBe(202);
    }

    const blocked = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'irrelevant', password: PASSWORD });

    expect(blocked.status).toBe(429);
  });
});

describe('budgets are independent', () => {
  /**
   * Named limiters must not share counters, or an attacker exhausts the cheap
   * endpoint to lock the expensive one — or worse, a burst of legitimate
   * signups disables login for everyone behind the same IP.
   */
  it('spending the register budget leaves login usable', async () => {
    for (let n = 1; n <= REGISTER_MAX + 1; n++) {
      await register(`owner-${n}@clay.test`);
    }

    const res = await login('owner-1@clay.test', PASSWORD);
    expect(res.status).toBe(200);
  });

  /**
   * Refresh is intentionally unlimited: every signed-in client hits it on a
   * 15-minute cycle without being asked, so a limit tight enough to matter
   * would sign out a whole studio sharing one office IP. Rotation with family
   * revocation is what protects it instead.
   */
  it('leaves token refresh unlimited', async () => {
    const signup = await register('rowan@clay.test');
    let refreshToken = signup.body.tokens.refreshToken as string;

    for (let n = 1; n <= LOGIN_MAX + 3; n++) {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken });

      expect(res.status, `refresh ${n} should be allowed`).toBe(200);
      // Rotation is mandatory, so each round needs the token it just issued.
      refreshToken = res.body.tokens.refreshToken;
    }
  });
});
