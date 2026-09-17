import { randomBytes } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createCustomer, createStudio, resetDb } from '../helpers/fixtures';
import {
  getBookingVolume,
  getPlatformGrowth,
} from '../../src/modules/platform/growth.service';

/**
 * Studio growth and booking volume.
 *
 * The point of interest is the split between what is genuinely historical and
 * what is not. Signups, activations and bookings are all dated on their own
 * rows and can be counted backwards over any window. Churn cannot: nothing
 * records when a studio stopped paying, so it is derived from the daily MRR
 * snapshot and is only claimable for months that snapshot covers.
 *
 * The assertion that matters most is that an unmeasured month reports null and
 * not zero — zero is a statement about a month nobody counted, and it is the
 * kind that ends up quoted.
 */

const DAY_MS = 86_400_000;

function utcDay(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}

function monthKey(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

const thisMonthKey = monthKey(new Date());

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
});

describe('studio growth', () => {
  it('counts signups and activations into the month they happened', async () => {
    const recent = await createStudio({ name: 'Clay & Co' });
    const old = await createStudio({ name: 'Kiln House' });

    // Backdated two months, which is only possible because the signup date is
    // on the row — no snapshot was needed to know this.
    const twoMonthsAgo = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 15),
    );
    await prisma.organization.update({
      where: { id: old.organization.id },
      data: { createdAt: twoMonthsAgo, onboardingDoneAt: twoMonthsAgo },
    });

    await prisma.organization.update({
      where: { id: recent.organization.id },
      data: { onboardingDoneAt: new Date() },
    });

    const { months } = await getPlatformGrowth(12);
    expect(months).toHaveLength(12);

    const now = months.find((m) => m.month === thisMonthKey)!;
    expect(now.newStudios).toBe(1);
    expect(now.activated).toBe(1);

    const then = months.find((m) => m.month === monthKey(twoMonthsAgo))!;
    expect(then.newStudios).toBe(1);
    expect(then.activated).toBe(1);
  });

  it('reports churn as null for months no snapshot covered', async () => {
    await createStudio({ name: 'Clay & Co' });

    const { months, churnMeasuredFrom } = await getPlatformGrowth(12);

    // Nothing has been snapshotted, so no month can claim a churn figure.
    expect(churnMeasuredFrom).toBeNull();
    for (const m of months) {
      expect(m.churned).toBeNull();
    }
  });

  it('counts a departure once the snapshot covers it', async () => {
    const staying = await createStudio({ name: 'Clay & Co' });
    const leaving = await createStudio({ name: 'Kiln House' });

    // Two adjacent recorded days: both present, then only one.
    const yesterday = utcDay(new Date(Date.now() - DAY_MS));
    const today = utcDay(new Date());

    await prisma.mrrDailyStudio.createMany({
      data: [
        {
          date: yesterday,
          organizationId: staying.organization.id,
          plan: 'SOLO',
          mrrCents: 3900,
        },
        {
          date: yesterday,
          organizationId: leaving.organization.id,
          plan: 'SOLO',
          mrrCents: 3900,
        },
        {
          date: today,
          organizationId: staying.organization.id,
          plan: 'SOLO',
          mrrCents: 3900,
        },
      ],
    });

    const { months, churnMeasuredFrom } = await getPlatformGrowth(12);

    expect(churnMeasuredFrom).not.toBeNull();

    const now = months.find((m) => m.month === thisMonthKey)!;
    expect(now.churned).toBe(1);

    /*
      A month before measurement began still reports null even though the
      series now has numbers in it — the line starts where counting started
      rather than being back-filled with zeroes.
    */
    const earlier = months[0]!;
    if (earlier.month < (churnMeasuredFrom as string)) {
      expect(earlier.churned).toBeNull();
    }
  });
});

describe('booking volume', () => {
  it('counts bookings by the month they were created, ignoring cancelled ones', async () => {
    const studio = await createStudio({ name: 'Clay & Co' });
    const customer = await createCustomer(studio.organization.id);

    const make = (status: 'CONFIRMED' | 'CANCELLED', createdAt?: Date) =>
      prisma.booking.create({
        data: {
          organizationId: studio.organization.id,
          customerId: customer.id,
          serviceTypeId: studio.serviceType.id,
          // `bookings_exactly_one_target`: a booking points at a session or at
          // a staff member, never both and never neither.
          staffId: studio.staff.id,
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 3_600_000),
          timezone: studio.timezone,
          status,
          cancelToken: randomBytes(16),
          ...(createdAt ? { createdAt } : {}),
        },
      });

    await make('CONFIRMED');
    await make('CONFIRMED');
    // Excluded, to agree with the Bookings card at the top of the dashboard.
    await make('CANCELLED');

    const lastMonth = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 10),
    );
    await make('CONFIRMED', lastMonth);

    const { months, thisMonth } = await getBookingVolume(12);

    expect(months).toHaveLength(12);
    expect(thisMonth).toBe(2);
    expect(months[months.length - 1]!.bookings).toBe(2);
    expect(months.find((m) => m.month === monthKey(lastMonth))!.bookings).toBe(1);
  });

  it('returns a full run of months even with no bookings at all', async () => {
    const { months, thisMonth } = await getBookingVolume(12);

    // A flat run of zeroes, not an empty array: the chart needs an axis even
    // on a platform that has taken nothing yet.
    expect(months).toHaveLength(12);
    expect(thisMonth).toBe(0);
    expect(months.every((m) => m.bookings === 0)).toBe(true);
  });
});
