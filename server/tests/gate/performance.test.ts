import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { getAvailability } from '../../src/scheduling/availability/availability.service';
import { createStudio, resetDb, at, type StudioFixture } from '../helpers/fixtures';
import { seedBusyStudio } from '../helpers/busy-studio';

/**
 * PHASE 0 EXIT GATE — condition 3, the load-independent half.
 *
 * The 200ms budget is met STRUCTURALLY: every read happens up front in a fixed
 * number of queries and everything after that is in-memory set arithmetic.
 * The assertions here test that structure, and they give the same answer on a
 * fast laptop, a loaded CI runner and a cheap VPS.
 *
 * The wall-clock measurement lives in tests/perf/, run on its own via
 * `npm run test:perf`. A timing assertion sharing a process with scrypt-heavy
 * auth suites measures the machine, not the engine — it reported 146ms alone
 * and 234ms inside the full run, which would make it a flaky gate rather than
 * a meaningful one.
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

describe('availability scaling', () => {
  it('issues the same number of queries for 1 day and for 31 days', async () => {
    // The invariant that actually protects the budget. The moment somebody
    // puts I/O inside the per-day loop this fails, regardless of hardware.
    const { service } = await seedBusyStudio(studio);

    const oneDay = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: service.id,
      locationId: studio.location.id,
      fromLocalDate: '2026-06-01',
      toLocalDate: '2026-06-01',
      now: NOW,
    });

    const wholeMonth = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: service.id,
      locationId: studio.location.id,
      fromLocalDate: '2026-06-01',
      toLocalDate: '2026-07-01',
      now: NOW,
    });

    expect(wholeMonth.diagnostics.queries).toBe(oneDay.diagnostics.queries);
    expect(wholeMonth.diagnostics.queries).toBeLessThanOrEqual(8);
    expect(wholeMonth.slots.length).toBeGreaterThan(oneDay.slots.length * 10);
  });

  it('makes no external network call on the read path', async () => {
    // Guards the worst available regression: the previous implementation
    // called the Google Calendar API from inside slot generation, making
    // availability exactly as slow and as fragile as Google was.
    const { service } = await seedBusyStudio(studio);

    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => {
      calls++;
      return originalFetch(...args);
    };

    try {
      await getAvailability({
        organizationId: studio.organization.id,
        serviceTypeId: service.id,
        locationId: studio.location.id,
        fromLocalDate: '2026-06-01',
        toLocalDate: '2026-07-01',
        now: NOW,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toBe(0);
  });
});
