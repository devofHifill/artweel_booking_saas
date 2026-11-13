import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createStudio, resetDb } from '../helpers/fixtures';
import { signUpStudio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import {
  getPlansOverview,
  updatePlanSettings,
} from '../../src/modules/platform/management.service';
import { setPlan } from '../../src/modules/platform/studio-admin.service';
import { createSubscriptionCheckout } from '../../src/modules/billing/billing.service';
import { PLANS, refreshPlans } from '../../src/modules/billing/plan';

/**
 * "Studios on plan" as a cap (Admin > Plans).
 *
 * The count itself only moves as studios join or leave, so what the operator
 * sets is the most studios a plan takes. Only arrivals are checked: sign-ups
 * (which start on Solo) and moves onto the plan. Studios already on it stay.
 */

const app = createApp();
const actor = {
  actorUserId: '00000000-0000-4000-8000-000000000001',
  actorEmail: 'ops@bookaihub.test',
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
  resetRateLimits();
  await prisma.planSetting.createMany({
    data: [
      { id: 'SOLO', priceCentsMonthly: 3900, maxStaff: 1, maxLocations: 1 },
      { id: 'STUDIO', priceCentsMonthly: 8900, maxStaff: 5, maxLocations: 3 },
      { id: 'PRO', priceCentsMonthly: 18900, maxStaff: null, maxLocations: null },
    ],
  });
  await refreshPlans();
});

const onPlan = (plan: 'SOLO' | 'STUDIO' | 'PRO') =>
  prisma.organization.count({ where: { plan } });

describe('setting the cap', () => {
  it('is unlimited until set, then saved, shown and audited', async () => {
    expect(PLANS.STUDIO.maxStudios).toBeNull();

    await updatePlanSettings(actor, 'STUDIO', { maxStudios: 2 }, 'Limited beta');

    expect(PLANS.STUDIO.maxStudios).toBe(2);
    const overview = await getPlansOverview();
    expect(overview.plans.find((p) => p.id === 'STUDIO')!.maxStudios).toBe(2);

    const audit = await prisma.platformAuditLog.findFirstOrThrow({
      where: { action: 'plan.settings.set', targetId: 'STUDIO' },
    });
    expect(audit.metadata).toMatchObject({
      before: { maxStudios: null },
      after: { maxStudios: 2 },
    });
  });
});

describe('a full plan', () => {
  it('refuses a move onto it from the platform, and allows staying on it', async () => {
    const a = await createStudio({ name: 'A' });
    const b = await createStudio({ name: 'B' });
    await setPlan(actor, a.organization.id, 'STUDIO', { comp: true, reason: 'test' });
    await updatePlanSettings(actor, 'STUDIO', { maxStudios: 1 }, 'Full');

    await expect(
      setPlan(actor, b.organization.id, 'STUDIO', { comp: true, reason: 'test' }),
    ).rejects.toMatchObject({ code: 'PLAN_FULL' });

    // Re-saving the plan a studio is already on is not a move.
    await setPlan(actor, a.organization.id, 'STUDIO', { comp: true, reason: 'again' });
    expect(await onPlan('STUDIO')).toBe(1);
  });

  it('refuses a studio choosing it in Billing', async () => {
    // The fixture puts studios on Pro; B starts on Solo so choosing Pro is a move.
    await createStudio({ name: 'A' });
    const b = await createStudio({ name: 'B' });
    await prisma.organization.update({ where: { id: b.organization.id }, data: { plan: 'SOLO' } });
    await updatePlanSettings(actor, 'PRO', { maxStudios: 1 }, 'Full');

    await expect(
      createSubscriptionCheckout(b.organization.id, 'PRO', 'owner@b.test'),
    ).rejects.toMatchObject({ code: 'PLAN_FULL' });
    expect(await onPlan('PRO')).toBe(1);
  });

  it('stops sign-ups when Solo is full, and saves nothing', async () => {
    await createStudio({ name: 'A' });
    const solo = await onPlan('SOLO');
    await updatePlanSettings(actor, 'SOLO', { maxStudios: solo }, 'Closed for now');

    const users = await prisma.user.count();
    const res = await request(app).post('/api/auth/register').send({
      email: 'new@studio.test',
      password: 'a-long-enough-password-42',
      name: 'New Owner',
      organizationName: 'New Studio',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PLAN_FULL');
    expect(await prisma.user.count()).toBe(users);
    expect(await onPlan('SOLO')).toBe(solo);
  });

  it('keeps studios already on it when the cap is lowered below the count', async () => {
    await signUpStudio(app);
    await signUpStudio(app);
    const before = await onPlan('SOLO');

    await updatePlanSettings(actor, 'SOLO', { maxStudios: 0 }, 'Closing Solo');

    expect(await onPlan('SOLO')).toBe(before);
  });
});
