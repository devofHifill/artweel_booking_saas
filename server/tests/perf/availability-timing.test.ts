import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { getAvailability } from '../../src/scheduling/availability/availability.service';
import { createStudio, resetDb, at, type StudioFixture } from '../helpers/fixtures';
import { seedBusyStudio } from '../helpers/busy-studio';

/**
 * PHASE 0 EXIT GATE — condition 3, the wall-clock half.
 *
 *   "Availability for a 31-day window returns at p95 under 200ms."
 *
 * Run ISOLATED: `npm run test:perf`. It is excluded from the default suite on
 * purpose. Sharing a process with the scrypt-heavy auth tests moved the same
 * measurement from 146ms to 234ms — which says nothing about the engine and
 * everything about what else was competing for the CPU. A gate that fails for
 * that reason teaches people to ignore it.
 *
 * The structural invariants that hold under any load live in
 * tests/gate/performance.test.ts and run every time.
 */

let studio: StudioFixture;
const NOW = at('2026-06-01T08:00:00Z');

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  studio = await createStudio();
});

describe('availability timing', () => {
  it('returns a 31-day window at p95 under 200ms', async () => {
    const { service, bookings } = await seedBusyStudio(studio);
    expect(bookings).toBeGreaterThan(80);

    const query = {
      organizationId: studio.organization.id,
      serviceTypeId: service.id,
      locationId: studio.location.id,
      fromLocalDate: '2026-06-01',
      toLocalDate: '2026-07-01',
      now: NOW,
    };

    // Warm the pool and the planner. Measuring cold start measures Prisma's
    // startup, not the engine.
    await getAvailability(query);

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      const result = await getAvailability(query);
      samples.push(performance.now() - started);
      expect(result.slots.length).toBeGreaterThan(0);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95) - 1]!;
    const median = samples[Math.floor(samples.length / 2)]!;

    // eslint-disable-next-line no-console
    console.log(
      `availability 31d — median ${median.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms, ` +
        `${bookings} existing bookings, 4 staff`,
    );

    expect(p95).toBeLessThan(200);
  });
});
