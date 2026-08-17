import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';
import { grantPlatformAdmin } from '../../src/modules/platform/platform.service';

/**
 * S3 — platform reads: the studios list, one studio's detail, and the overview
 * metrics.
 */

const app = createApp();

let admin: Studio;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  admin = await signUpStudio(app, { organizationName: 'Clay & Co' });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: admin.userId },
    select: { email: true },
  });
  await grantPlatformAdmin({ email: user.email });
});

function get(path: string, query: Record<string, unknown> = {}) {
  return request(app).get(path).query(query).set(admin.headers);
}

describe('the studios list', () => {
  it('returns every studio with its owner and counts', async () => {
    await signUpStudio(app, { organizationName: 'Kiln House' });

    const res = await get('/api/platform/organizations');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.studios).toHaveLength(2);

    const clay = res.body.studios.find(
      (s: { name: string }) => s.name === 'Clay & Co',
    );
    expect(clay.owner.email).toContain('@clay.test');
    expect(clay.counts).toEqual({
      staff: 0,
      customers: 0,
      bookings: 0,
      lastBookingAt: null,
    });
  });

  it('finds a studio by name, by slug and by its owner address', async () => {
    const other = await signUpStudio(app, {
      organizationName: 'Kiln House',
      email: 'rowan@kilnhouse.test',
    });

    const byName = await get('/api/platform/organizations', { search: 'kiln' });
    expect(byName.body.studios).toHaveLength(1);

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: other.organizationId },
      select: { slug: true },
    });
    const bySlug = await get('/api/platform/organizations', { search: org.slug });
    expect(bySlug.body.studios).toHaveLength(1);

    /**
     * The case that matters in practice: a support email arrives from an address
     * and mentions neither the studio name nor the slug.
     */
    const byOwner = await get('/api/platform/organizations', {
      search: 'rowan@kilnhouse',
    });
    expect(byOwner.body.studios).toHaveLength(1);
    expect(byOwner.body.studios[0].name).toBe('Kiln House');
  });

  it('filters by subscription status and by plan', async () => {
    const other = await signUpStudio(app, { organizationName: 'Kiln House' });
    await prisma.organization.update({
      where: { id: other.organizationId },
      data: { subscriptionStatus: 'SUSPENDED', plan: 'SOLO' },
    });

    const suspended = await get('/api/platform/organizations', {
      status: 'SUSPENDED',
    });
    expect(suspended.body.studios).toHaveLength(1);
    expect(suspended.body.studios[0].name).toBe('Kiln House');

    const solo = await get('/api/platform/organizations', { plan: 'SOLO' });
    expect(solo.body.studios).toHaveLength(1);
  });

  it('paginates and reports the unpaged total', async () => {
    await signUpStudio(app, { organizationName: 'Kiln House' });
    await signUpStudio(app, { organizationName: 'Wheel Works' });

    const page = await get('/api/platform/organizations', { limit: 2 });

    expect(page.body.studios).toHaveLength(2);
    expect(page.body.total).toBe(3);
    expect(page.body.limit).toBe(2);
  });

  /**
   * `lastBookingAt` is not a column, so it cannot be an ORDER BY. Asking for it
   * must not silently return a different order than requested — the response
   * says which sort was actually applied.
   */
  it('says so when a requested sort cannot be honoured', async () => {
    const res = await get('/api/platform/organizations', {
      sort: 'lastBookingAt',
    });

    expect(res.status).toBe(200);
    expect(res.body.sortFellBack).toBe(true);
    expect(res.body.sortedBy).toBe('createdAt');

    const honoured = await get('/api/platform/organizations', { sort: 'name' });
    expect(honoured.body.sortFellBack).toBe(false);
    expect(honoured.body.sortedBy).toBe('name');
  });

  /**
   * The counts must be gathered as grouped queries, not per studio. The N+1
   * version passes every other test in this file and makes the screen unusable
   * at scale, so the query count is pinned rather than left to a comment.
   *
   * Asserted as "does not grow with the number of studios" rather than as an
   * exact number, so refactoring stays possible and regressions still fail.
   */
  it('does not issue more queries for more studios', async () => {
    async function queriesFor(studioCount: number) {
      await resetDb();
      const owner = await signUpStudio(app, { organizationName: 'Clay & Co' });
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: owner.userId },
        select: { email: true },
      });
      await grantPlatformAdmin({ email: user.email });

      for (let n = 1; n < studioCount; n++) {
        await signUpStudio(app, { organizationName: `Studio ${n}` });
      }

      let count = 0;
      const tally = () => {
        count += 1;
      };
      prisma.$on('query' as never, tally as never);

      await request(app)
        .get('/api/platform/organizations')
        .set({ Authorization: `Bearer ${owner.accessToken}` });

      return count;
    }

    const forTwo = await queriesFor(2);
    const forSix = await queriesFor(6);

    expect(forSix).toBeLessThanOrEqual(forTwo);
  });

  it('is invisible to an ordinary studio owner', async () => {
    const outsider = await signUpStudio(app);

    const res = await request(app)
      .get('/api/platform/organizations')
      .set(outsider.headers);

    expect(res.status).toBe(404);
  });
});

describe('one studio in detail', () => {
  it('returns members, plan definition and the onboarding breakdown', async () => {
    const res = await get(`/api/platform/organizations/${admin.organizationId}`);

    expect(res.status).toBe(200);
    expect(res.body.studio.name).toBe('Clay & Co');
    expect(res.body.studio.planDefinition.priceCentsMonthly).toBe(18900);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].role).toBe('OWNER');

    /**
     * The step breakdown, not just a boolean — "signed up and never finished" is
     * only actionable if you can see which step they stopped at.
     */
    expect(res.body.onboarding.complete).toBe(false);
    expect(res.body.onboarding.steps.map((s: { id: string }) => s.id)).toContain(
      'publish',
    );
  });

  it('404s for an unknown studio', async () => {
    const res = await get(
      '/api/platform/organizations/3f7c1e64-0000-4000-8000-000000000000',
    );
    expect(res.status).toBe(404);
  });

  /**
   * A malformed id must not reach Prisma, where it becomes an opaque 500 rather
   * than an answer.
   */
  it('404s for an id that is not a uuid', async () => {
    const res = await get('/api/platform/organizations/not-a-uuid');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('STUDIO_NOT_FOUND');
  });
});

describe('overview metrics', () => {
  it('counts studios by status and by plan', async () => {
    const other = await signUpStudio(app, { organizationName: 'Kiln House' });
    await prisma.organization.update({
      where: { id: other.organizationId },
      data: { subscriptionStatus: 'ACTIVE', plan: 'STUDIO' },
    });

    const res = await get('/api/platform/metrics');

    expect(res.status).toBe(200);
    expect(res.body.metrics.studios.total).toBe(2);
    expect(res.body.metrics.studios.byStatus.ACTIVE).toBe(1);
    expect(res.body.metrics.studios.byStatus.TRIALING).toBe(1);
    expect(res.body.metrics.studios.byPlan.STUDIO).toBe(1);
  });

  /**
   * MRR counts ACTIVE only. A trial pays nothing and PAST_DUE is money we have
   * not been paid; including either would report hoped-for revenue as real.
   */
  it('computes MRR from active subscriptions only', async () => {
    const active = await signUpStudio(app, { organizationName: 'Paying' });
    await prisma.organization.update({
      where: { id: active.organizationId },
      data: { subscriptionStatus: 'ACTIVE', plan: 'STUDIO' },
    });

    const pastDue = await signUpStudio(app, { organizationName: 'Bounced' });
    await prisma.organization.update({
      where: { id: pastDue.organizationId },
      data: { subscriptionStatus: 'PAST_DUE', plan: 'PRO' },
    });

    const res = await get('/api/platform/metrics');

    // Only the STUDIO plan at $89. The trialing and past-due studios contribute
    // nothing, including the PRO one.
    expect(res.body.metrics.subscriptionRevenue.mrrCents).toBe(8900);
    expect(res.body.metrics.subscriptionRevenue.payingStudios).toBe(1);
  });

  /**
   * The two money numbers must stay apart. Studio volume is paid directly to the
   * studio under Connect and is not ours in any sense.
   */
  it('keeps studio booking volume separate from our revenue', async () => {
    await prisma.payment.create({
      data: {
        organizationId: admin.organizationId,
        amountCents: 5000,
        status: 'SUCCEEDED',
        currency: 'USD',
        provider: 'FAKE',
        // DEPOSIT | BALANCE | FULL — every kind in this table is studio-side
        // booking money. Our subscription charges are not recorded here at all,
        // which is what keeps the two figures below from being the same money.
        kind: 'FULL',
      },
    });

    const res = await get('/api/platform/metrics');
    const metrics = res.body.metrics;

    expect(metrics.studioBookingVolume.last30DaysCents).toBe(5000);
    expect(metrics.studioBookingVolume.note).toMatch(/not platform revenue/i);
    // Nobody is ACTIVE, so our revenue is zero even though 5000 flowed through.
    expect(metrics.subscriptionRevenue.mrrCents).toBe(0);
  });

  it('counts studios still stalled in onboarding', async () => {
    await signUpStudio(app, { organizationName: 'Kiln House' });
    await prisma.organization.update({
      where: { id: admin.organizationId },
      data: { onboardingDoneAt: new Date() },
    });

    const res = await get('/api/platform/metrics');
    expect(res.body.metrics.studios.stalledInOnboarding).toBe(1);
  });

  /**
   * A studio that has NEVER taken a booking must count as idle. Expressed as
   * "has no booking newer than X" rather than comparing a max date, which would
   * exclude exactly the studios most worth calling.
   */
  it('counts a studio with no bookings at all as idle', async () => {
    const res = await get('/api/platform/metrics');
    expect(res.body.metrics.studios.idle30Days).toBe(1);
  });

  it('reports no conversion rate before anyone has finished a trial', async () => {
    const res = await get('/api/platform/metrics');
    expect(res.body.metrics.trials.conversionRate).toBeNull();
  });

  it('is invisible to an ordinary studio owner', async () => {
    const outsider = await signUpStudio(app);
    const res = await request(app)
      .get('/api/platform/metrics')
      .set(outsider.headers);

    expect(res.status).toBe(404);
  });
});
