import 'dotenv/config';

/**
 * Runs before any test module is imported, which is the only window in which
 * DATABASE_URL can still be redirected — src/config reads it once, at import
 * time, and everything downstream holds the result.
 *
 * The gate suites truncate tables freely, so they must never point at the
 * development database.
 */
process.env.NODE_ENV = 'test';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Tests refuse to run against the development database.',
  );
}

const url = new URL(process.env.TEST_DATABASE_URL);
// Concurrency suites open up to 100 simultaneous transactions. The default
// pool (cores * 2 + 1) would make them queue on connection acquisition rather
// than on the row locks actually under test.
url.searchParams.set('connection_limit', '30');
url.searchParams.set('pool_timeout', '30');

process.env.DATABASE_URL = url.toString();

/**
 * Password hashing is deliberately expensive in production — roughly 67MB and
 * 150ms per hash at cost 16. A suite that registers and logs in dozens of
 * times would spend most of its runtime in scrypt and prove nothing extra, so
 * tests run at the lowest permitted cost.
 *
 * The hash format carries its own parameters, so this changes nothing about
 * what is being tested apart from the wall time.
 */
process.env.PASSWORD_COST_EXPONENT = '12';

// Deterministic secrets, so a missing .env cannot silently weaken the suite.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789abcdefghijkl';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-0123456789abcdefghijkl';

/**
 * Auth rate limits, raised far above anything a test generates.
 *
 * Every fixture in the suite registers through `/api/auth/register`, and all of
 * it arrives from one IP under supertest, so production limits would fail most
 * files for reasons unrelated to what they assert.
 *
 * Raised rather than disabled, deliberately: the limiters stay genuinely mounted
 * in all 34 files, so a mistake in the wiring — wrong order, thrown from the
 * wrong place, applied to the wrong route — still shows up as a broken suite.
 * A limiter switched off by NODE_ENV is a limiter nothing exercises until
 * production. `tests/auth/rate-limit.test.ts` sets them low on purpose and is
 * the file that proves they bite.
 *
 * `??=` rather than `=` so a value exported in the environment survives, which
 * is what lets the suite be run once against production-like limits on purpose.
 * (An individual test file does not need that: setup files run before test
 * modules, so a file assigning its own value already wins.)
 */
process.env.AUTH_LOGIN_RATE_MAX ??= '100000';
process.env.AUTH_REGISTER_RATE_MAX ??= '100000';
process.env.AUTH_RESET_RATE_MAX ??= '100000';

/**
 * Deliberately NOT the development defaults.
 *
 * These are the values the app builds customer-facing links from — the "Sign
 * in" redirect, the Stripe Connect return URL, the billing checkout success
 * page. A test asserting such a link is worthless if the expected value is
 * also what a hardcoded localhost literal would produce: the /app redirect was
 * hardcoded to `http://localhost:5173` and reached staging precisely because
 * that string looked correct everywhere anyone checked.
 */
process.env.APP_URL = 'https://dashboard.test';
process.env.PUBLIC_URL = 'https://public.test';
