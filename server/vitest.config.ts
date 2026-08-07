import { defineConfig } from 'vitest/config';

/**
 * The gate tests talk to a real Postgres. That is deliberate: the whole point
 * of Phase 0 is that correctness lives in the database, so a mocked database
 * would test nothing that matters.
 *
 * `singleThread` keeps suites from trampling each other's fixtures — several
 * of them truncate tables. Individual concurrency tests still fire many
 * simultaneous queries inside a single test; that is the behaviour under test.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Timing measurements are excluded from the default run and executed on
    // their own via `npm run test:perf`. Sharing a process with CPU-heavy
    // suites makes a wall-clock assertion measure the machine rather than the
    // code, which produces a flaky gate nobody trusts.
    exclude: ['node_modules/**', 'tests/perf/**'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'threads',
    poolOptions: {
      threads: { singleThread: true },
    },
  },
});
