import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createStudio, resetDb } from '../helpers/fixtures';
import {
  countryForTimezone,
  getGeographicDistribution,
  getNeedsAttention,
  getPlanDistribution,
  getRecentActivity,
  getRevenueModel,
} from '../../src/modules/platform/insights.service';

/**
 * The lower half of the dashboard.
 *
 * The assertions worth having are the ones about restraint: that a trialing
 * studio contributes no revenue to its plan's slice, that a country nobody
 * declared is not invented, and that LTV and net revenue retention come back
 * empty with a reason rather than filled with something plausible.
 */

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
});

describe('plan distribution', () => {
  it('gives revenue only to studios that are actually paying', async () => {
    const paying = await createStudio({ name: 'Clay & Co' });
    await prisma.organization.update({
      where: { id: paying.organization.id },
      data: { plan: 'STUDIO', subscriptionStatus: 'ACTIVE' },
    });

    // Same plan, but trialing: it must not add $89 to the Studio slice.
    const trialing = await createStudio({ name: 'Kiln House' });
    await prisma.organization.update({
      where: { id: trialing.organization.id },
      data: { plan: 'STUDIO', subscriptionStatus: 'TRIALING' },
    });

    const { total, segments, mrrCents } = await getPlanDistribution();

    expect(total).toBe(2);
    expect(mrrCents).toBe(8900);

    const studioPlan = segments.find((s) => s.key === 'STUDIO')!;
    expect(studioPlan.studios).toBe(1);
    expect(studioPlan.mrrCents).toBe(8900);

    const trial = segments.find((s) => s.key === 'TRIAL')!;
    expect(trial.studios).toBe(1);
    expect(trial.mrrCents).toBe(0);

    // Every studio is accounted for exactly once.
    expect(segments.reduce((n, s) => n + s.studios, 0)).toBe(total);
  });
});

describe('geography', () => {
  it('derives country from timezone and buckets what it cannot map', () => {
    expect(countryForTimezone('Asia/Kolkata')).toBe('India');
    expect(countryForTimezone('Europe/London')).toBe('United Kingdom');
    expect(countryForTimezone('Australia/Perth')).toBe('Australia');
    // Not guessed at. A zone with no entry is Other, never a country picked
    // by resemblance.
    expect(countryForTimezone('Antarctica/Troll')).toBe('Other');
  });

  it('groups studios by their derived country and sorts Other last', async () => {
    await createStudio({ name: 'A', timezone: 'Asia/Kolkata' });
    await createStudio({ name: 'B', timezone: 'Asia/Kolkata' });
    await createStudio({ name: 'C', timezone: 'Europe/London' });
    await createStudio({ name: 'D', timezone: 'Antarctica/Troll' });

    const { rows, derivedFrom } = await getGeographicDistribution();

    expect(derivedFrom).toBe('timezone');
    expect(rows[0]).toMatchObject({ country: 'India', studios: 2 });
    expect(rows.find((r) => r.country === 'United Kingdom')!.studios).toBe(1);

    /* Other is a bucket, not a place: it goes last however many are in it, so
       it never reads as the country with the most studios. */
    expect(rows[rows.length - 1]!.country).toBe('Other');
  });
});

describe('needs attention', () => {
  it('says nothing when every check is clear', async () => {
    await createStudio({ name: 'Clay & Co' });

    const { items } = await getNeedsAttention();

    // The fixture studio is PRO (unlimited staff), has no Stripe account and
    // is not past due, so there is genuinely nothing to report.
    expect(items).toEqual([]);
  });

  it('flags a restricted Stripe account and a past-due studio', async () => {
    const restricted = await createStudio({ name: 'Studio Terra' });
    await prisma.organization.update({
      where: { id: restricted.organization.id },
      data: {
        stripeAccountId: 'acct_test_123',
        stripeChargesEnabled: false,
        stripePayoutsEnabled: false,
      },
    });

    const late = await createStudio({ name: 'The Kiln Room' });
    await prisma.organization.update({
      where: { id: late.organization.id },
      data: { subscriptionStatus: 'PAST_DUE' },
    });

    const { items } = await getNeedsAttention();
    const byKey = new Map(items.map((i) => [i.key, i]));

    expect(byKey.get('stripe')!.count).toBe(1);
    expect(byKey.get('stripe')!.detail).toContain('Studio Terra');

    const pastDue = byKey.get('past-due')!;
    expect(pastDue.count).toBe(1);
    /* Named for what it is. The reference design called this "expired payment
       cards", which is a fact that lives in Stripe and not in this database. */
    expect(pastDue.title).toMatch(/past due/i);
    expect(pastDue.detail).toMatch(/Stripe/);
  });

  it('flags a studio at its plan instructor limit', async () => {
    const solo = await createStudio({ name: 'Solo Potter' });
    // SOLO includes one instructor, and the fixture creates one.
    await prisma.organization.update({
      where: { id: solo.organization.id },
      data: { plan: 'SOLO' },
    });

    const { items } = await getNeedsAttention();
    expect(items.find((i) => i.key === 'staff-limit')!.count).toBe(1);
  });
});

describe('revenue model', () => {
  it('states commission and ARPA, and refuses to state LTV or NRR', async () => {
    const studio = await createStudio({ name: 'Clay & Co' });
    await prisma.organization.update({
      where: { id: studio.organization.id },
      data: { plan: 'STUDIO', subscriptionStatus: 'ACTIVE' },
    });

    const model = await getRevenueModel();

    expect(model.platformCommissionPct).toBe(0);
    expect(model.takeRateOnGmvPct).toBe(0);
    expect(model.mrrCents).toBe(8900);
    expect(model.arpaCents).toBe(8900);

    /*
      The two that cannot be computed. Both need churn, which only became
      measurable when the daily snapshot started, so both return null WITH a
      reason — a number here would be the most quotable fabrication on the
      dashboard.
    */
    expect(model.ltvCents).toBeNull();
    expect(model.ltvUnavailableReason).toMatch(/churn/i);
    expect(model.nrrPct).toBeNull();
    expect(model.nrrUnavailableReason).toMatch(/history/i);
  });
});

describe('recent activity', () => {
  it('reports signups and says what the feed does not cover', async () => {
    await createStudio({ name: 'Clay & Co' });

    const { entries, note } = await getRecentActivity(10);

    expect(entries.some((e) => e.title.includes('Clay & Co'))).toBe(true);
    // The feed's own limits, on the feed, so its thinness is not read as a
    // quiet week.
    expect(note).toMatch(/not audited/i);
  });
});
