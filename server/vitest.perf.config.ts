import { defineConfig } from 'vitest/config';

/**
 * Timing suite, run alone: `npm run test:perf`.
 *
 * Separate config rather than a flag on the main one so the exclusion cannot
 * be forgotten, and so this can be pointed at a production-shaped machine in
 * CI without dragging the whole suite along.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/perf/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
