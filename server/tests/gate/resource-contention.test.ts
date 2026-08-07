import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { BookingErrorCode } from '../../src/lib/app-error';
import { allocateResource } from '../../src/scheduling/resource.service';
import {
  createStudio,
  resetDb,
  at,
  type StudioFixture,
} from '../helpers/fixtures';

/**
 * Resource contention.
 *
 * Two different guarantees, deliberately implemented two different ways:
 *
 *   Counted (8 wheels)   — locked row + SUM. Overlap legal up to quantity.
 *   Exclusive (1 kiln)   — partial EXCLUDE constraint. No overlap, ever.
 *
 * This is what makes a studio's capacity physically true rather than
 * aspirational: eight wheels means eight students, whatever the class
 * capacity field says.
 */

let studio: StudioFixture;

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

const WINDOW = {
  startsAt: at('2026-09-15T18:00:00Z'),
  endsAt: at('2026-09-15T21:00:00Z'),
};

describe('counted resources', () => {
  it('allocates at most `quantity` across 20 simultaneous requests', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        allocateResource({
          organizationId: studio.organization.id,
          resourceId: studio.wheels.id,
          quantity: 1,
          ...WINDOW,
        }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(8);

    const total = await prisma.resourceAllocation.aggregate({
      where: { resourceId: studio.wheels.id },
      _sum: { quantity: true },
    });
    expect(total._sum.quantity).toBe(8);
  });

  it('permits overlap up to capacity and refuses the one that exceeds it', async () => {
    await allocateResource({
      organizationId: studio.organization.id,
      resourceId: studio.wheels.id,
      quantity: 6,
      ...WINDOW,
    });

    await expect(
      allocateResource({
        organizationId: studio.organization.id,
        resourceId: studio.wheels.id,
        quantity: 2,
        ...WINDOW,
      }),
    ).resolves.toBeTruthy();

    await expect(
      allocateResource({
        organizationId: studio.organization.id,
        resourceId: studio.wheels.id,
        quantity: 1,
        ...WINDOW,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.RESOURCE_UNAVAILABLE });
  });

  it('does not count allocations that finish before this one starts', async () => {
    await allocateResource({
      organizationId: studio.organization.id,
      resourceId: studio.wheels.id,
      quantity: 8,
      startsAt: at('2026-09-15T14:00:00Z'),
      endsAt: at('2026-09-15T17:00:00Z'),
    });

    // Morning class is over; the afternoon class gets the same wheels.
    await expect(
      allocateResource({
        organizationId: studio.organization.id,
        resourceId: studio.wheels.id,
        quantity: 8,
        startsAt: at('2026-09-15T17:00:00Z'),
        endsAt: at('2026-09-15T20:00:00Z'),
      }),
    ).resolves.toBeTruthy();
  });
});

describe('exclusive resources', () => {
  it('lets exactly one of two simultaneous firings claim the kiln', async () => {
    const results = await Promise.allSettled([
      allocateResource({
        organizationId: studio.organization.id,
        resourceId: studio.kiln.id,
        quantity: 1,
        startsAt: at('2026-09-16T02:00:00Z'),
        endsAt: at('2026-09-16T16:00:00Z'),
        note: 'bisque',
      }),
      allocateResource({
        organizationId: studio.organization.id,
        resourceId: studio.kiln.id,
        quantity: 1,
        startsAt: at('2026-09-16T08:00:00Z'),
        endsAt: at('2026-09-16T22:00:00Z'),
        note: 'glaze',
      }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.resourceAllocation.count()).toBe(1);
  });

  it('blocks a 14-hour firing from overlapping another', async () => {
    await allocateResource({
      organizationId: studio.organization.id,
      resourceId: studio.kiln.id,
      quantity: 1,
      startsAt: at('2026-09-16T02:00:00Z'),
      endsAt: at('2026-09-16T16:00:00Z'),
    });

    await expect(
      allocateResource({
        organizationId: studio.organization.id,
        resourceId: studio.kiln.id,
        quantity: 1,
        startsAt: at('2026-09-16T15:00:00Z'),
        endsAt: at('2026-09-17T05:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.RESOURCE_UNAVAILABLE });
  });

  it('allows a firing to start the instant the previous one ends', async () => {
    await allocateResource({
      organizationId: studio.organization.id,
      resourceId: studio.kiln.id,
      quantity: 1,
      startsAt: at('2026-09-16T02:00:00Z'),
      endsAt: at('2026-09-16T16:00:00Z'),
    });

    await expect(
      allocateResource({
        organizationId: studio.organization.id,
        resourceId: studio.kiln.id,
        quantity: 1,
        startsAt: at('2026-09-16T16:00:00Z'),
        endsAt: at('2026-09-17T06:00:00Z'),
      }),
    ).resolves.toBeTruthy();
  });

  it('sets `exclusive` from the resource even when the caller lies', async () => {
    // The service always writes `exclusive = false`; the BEFORE trigger
    // overwrites it from resources.is_exclusive. Without that, a caller could
    // silently exempt a kiln from the constraint that protects it.
    await allocateResource({
      organizationId: studio.organization.id,
      resourceId: studio.kiln.id,
      quantity: 1,
      ...WINDOW,
    });

    const row = await prisma.resourceAllocation.findFirstOrThrow({
      where: { resourceId: studio.kiln.id },
    });
    expect(row.exclusive).toBe(true);

    await allocateResource({
      organizationId: studio.organization.id,
      resourceId: studio.wheels.id,
      quantity: 1,
      ...WINDOW,
    });

    const wheelRow = await prisma.resourceAllocation.findFirstOrThrow({
      where: { resourceId: studio.wheels.id },
    });
    expect(wheelRow.exclusive).toBe(false);
  });
});
