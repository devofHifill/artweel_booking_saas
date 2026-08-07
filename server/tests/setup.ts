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
