import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createStudio, resetDb } from '../helpers/fixtures';
import {
  getPlansOverview,
  updatePlanSettings,
} from '../../src/modules/platform/management.service';
import { currentMrr, takeMrrSnapshot } from '../../src/modules/platform/mrr.service';
import { PLANS, refreshPlans } from '../../src/modules/billing/plan';

/**
 * Editable plan pricing.
 *
 * The property everything else rests on: a price change must move the LIST
 * price and leave every existing subscriber alone. Without that, the first edit
 * silently restates the revenue of the whole customer base while Stripe goes on
 * billing the old amount — which is the exact failure this feature was built to
 * avoid rather than introduce.
 */

const actor = {
  actorUserId: '00000000-0000-4000-8000-000000000001',
  actorEmail: 'ops@artweel.test',
  ip: null,
  userAgent: null,
};

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  /* resetDb truncates plan_settings too, so the three rows the migration seeded
     have to be put back — and the cache reloaded from them. */
  await prisma.planSetting.createMany({
    data: [
      { id: 'SOLO', priceCentsMonthly: 3900, maxStaff: 1, maxLocations: 1 },
      { id: 'STUDIO', priceCentsMonthly: 8900, maxStaff: 5, maxLocations: 3 },
      { id: 'PRO', priceCentsMonthly: 18900, maxStaff: null, maxLocations: null },
    ],
  });
  await refreshPlans();
});

describe('changing a price', () => {
  it('does not move what an existing subscriber pays', async () => {
    const studio = await createStudio({ name: 'Clay & Co' });
    await prisma.organization.update({
      where: { id: studio.organization.id },
      data: {
        plan: 'SOLO',
        subscriptionStatus: 'ACTIVE',
        // What they agreed to when they subscribed.
        subscribedPriceCents: 3900,
      },
    });

    expect((await currentMrr()).mrrCents).toBe(3900);

    await updatePlanSettings(actor, 'SOLO', { priceCentsMonthly: 4900 }, 'Price rise');

    // The list price moved...
    expect(PLANS.SOLO.priceCentsMonthly).toBe(4900);

    /*
      ...and the revenue did NOT. This is the whole point: Stripe still bills
      this studio $39, so reporting $49 would overstate real revenue by the
      difference times the entire existing customer base.
    */
    expect((await currentMrr()).mrrCents).toBe(3900);
  });

  it('falls back to the list price only for studios that never recorded one', async () => {
    const legacy = await createStudio({ name: 'Kiln House' });
    await prisma.organization.update({
      where: { id: legacy.organization.id },
      data: {
        plan: 'SOLO',
        subscriptionStatus: 'ACTIVE',
        subscribedPriceCents: null,
      },
    });

    expect((await currentMrr()).mrrCents).toBe(3900);
  });

  it('records the change in the audit log with before and after', async () => {
    await updatePlanSettings(
      actor,
      'STUDIO',
      { priceCentsMonthly: 9900, maxStaff: 6 },
      'Annual pricing review',
    );

    const { history } = await getPlansOverview();
    expect(history).toHaveLength(1);
    expect(history[0]!.plan).toBe('STUDIO');
    expect(history[0]!.reason).toBe('Annual pricing review');

    /* The current value cannot answer "who set it to this, and from what", so
       the row carries both sides. */
    const changes = history[0]!.changes as {
      before: { priceCentsMonthly: number };
      after: { priceCentsMonthly: number; maxStaff: number | null };
    };
    expect(changes.before.priceCentsMonthly).toBe(8900);
    expect(changes.after.priceCentsMonthly).toBe(9900);
    expect(changes.after.maxStaff).toBe(6);
  });

  it('takes effect for the limit that is actually enforced', async () => {
    await updatePlanSettings(actor, 'SOLO', { maxStaff: 3 }, 'More room on Solo');

    // requireCapacity reads PLANS, which the cache has just refreshed.
    expect(PLANS.SOLO.maxStaff).toBe(3);
  });
});

describe('the MRR snapshot', () => {
  it('records what each studio agreed to pay, not the list price', async () => {
    const studio = await createStudio({ name: 'Clay & Co' });
    await prisma.organization.update({
      where: { id: studio.organization.id },
      data: {
        plan: 'SOLO',
        subscriptionStatus: 'ACTIVE',
        subscribedPriceCents: 3900,
      },
    });

    await updatePlanSettings(actor, 'SOLO', { priceCentsMonthly: 9900 }, 'Rise');
    const result = await takeMrrSnapshot();

    /* A snapshot at the list price would put a step change into the history
       chart on the day of the edit — a jump that never happened in anyone's
       bank account. */
    expect(result.mrrCents).toBe(3900);

    const row = await prisma.mrrDailyStudio.findFirstOrThrow();
    expect(row.mrrCents).toBe(3900);
  });
});
