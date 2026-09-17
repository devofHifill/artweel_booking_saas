import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';
import { grantPlatformAdmin } from '../../src/modules/platform/platform.service';
import { listAuditLog } from '../../src/modules/platform/audit.service';
import {
  onPaymentSucceeded,
  onSubscriptionChanged,
  sweepExpiredSubscriptions,
} from '../../src/modules/billing/billing.service';

/**
 * S4 — the platform's write actions on a studio.
 *
 * Two themes worth stating, because they are what the tests are actually for:
 *
 * 1. Nothing writes without an audit row, and the reason is mandatory.
 * 2. An operator suspension outranks billing. Both write the same SUSPENDED
 *    status, and billing clears that status when money arrives — so without the
 *    guard, suspending a studio for abuse is undone by its own next invoice, and
 *    invisibly, because the status just reads ACTIVE again.
 */

const app = createApp();

let admin: Studio;
let target: Studio;

const REASON = 'owner asked on ticket #42';

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  admin = await signUpStudio(app, { organizationName: 'Artweel HQ' });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: admin.userId },
    select: { email: true },
  });
  await grantPlatformAdmin({ email: user.email });

  target = await signUpStudio(app, { organizationName: 'Clay & Co' });
});

function post(path: string, body: object) {
  return request(app)
    .post(`/api/platform/organizations/${target.organizationId}${path}`)
    .set(admin.headers)
    .send(body);
}

function org() {
  return prisma.organization.findUniqueOrThrow({
    where: { id: target.organizationId },
  });
}

describe('every write requires a real reason', () => {
  it('refuses a missing reason', async () => {
    const res = await post('/suspend', {});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  /**
   * An operator who can satisfy the field with one character will, and then the
   * log records that somebody typed a character.
   */
  it('refuses a token reason', async () => {
    const res = await post('/suspend', { reason: 'x' });
    expect(res.status).toBe(422);
  });

  it('writes no audit row when validation rejects the request', async () => {
    await post('/suspend', { reason: 'x' });
    expect(await listAuditLog()).toHaveLength(0);
  });
});

describe('extending a trial', () => {
  it('moves the date forward and audits before and after', async () => {
    const extendTo = new Date(Date.now() + 40 * 86_400_000);

    const res = await post('/trial', {
      extendTo: extendTo.toISOString(),
      reason: REASON,
    });

    expect(res.status).toBe(200);
    expect(new Date((await org()).trialEndsAt!).toISOString()).toBe(
      extendTo.toISOString(),
    );

    const [entry] = await listAuditLog();
    expect(entry).toMatchObject({
      action: 'trial.extend',
      organizationId: target.organizationId,
      reason: REASON,
    });
    expect(entry!.metadata).toHaveProperty('before');
    expect(entry!.metadata).toHaveProperty('after');
  });

  /**
   * Extending is one-directional. Pulling the date backwards would switch a
   * studio off mid-week through a route called "extend"; if that is wanted, it
   * should be a suspension, which is audited as one.
   */
  it('refuses to shorten a trial', async () => {
    const res = await post('/trial', {
      extendTo: new Date(Date.now() - 86_400_000).toISOString(),
      reason: REASON,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TRIAL_NOT_EXTENDED');
  });

  /**
   * A studio already suspended for an expired trial must come back on. Moving a
   * date and leaving the booking page dark is not what "extend the trial" means.
   */
  it('brings a trial-expired studio back to TRIALING', async () => {
    await prisma.organization.update({
      where: { id: target.organizationId },
      data: {
        trialEndsAt: new Date(Date.now() - 86_400_000),
        subscriptionStatus: 'SUSPENDED',
      },
    });

    await post('/trial', {
      extendTo: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      reason: REASON,
    });

    expect((await org()).subscriptionStatus).toBe('TRIALING');
  });

  /** But it must not lift an operator suspension as a side effect. */
  it('does not lift a platform suspension', async () => {
    await post('/suspend', { reason: 'suspected card testing' });

    await post('/trial', {
      extendTo: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      reason: REASON,
    });

    const after = await org();
    expect(after.subscriptionStatus).toBe('SUSPENDED');
    expect(after.suspendedByPlatformAt).not.toBeNull();
  });
});

describe('setting a plan', () => {
  it('changes the plan and audits it', async () => {
    const res = await post('/plan', { plan: 'STUDIO', reason: REASON });

    expect(res.status).toBe(200);
    expect((await org()).plan).toBe('STUDIO');
    expect((await listAuditLog())[0]!.action).toBe('plan.set');
  });

  it('does not mark an account comped unless asked', async () => {
    await post('/plan', { plan: 'STUDIO', reason: REASON });
    expect((await org()).compedAt).toBeNull();
  });

  it('marks a comp and audits it under its own action', async () => {
    const res = await post('/plan', {
      plan: 'PRO',
      comp: true,
      reason: 'friends-and-family for the pilot studio',
    });

    expect(res.status).toBe(200);
    const after = await org();
    expect(after.plan).toBe('PRO');
    expect(after.compedAt).not.toBeNull();
    expect((await listAuditLog())[0]!.action).toBe('plan.comp');
  });

  /**
   * Comping deliberately does not touch Stripe (decided 2026-08-17), so the
   * local row and Stripe diverge by design. The requirement is that the
   * divergence is recorded at the moment of the decision and surfaced afterwards
   * — not that it does not happen.
   */
  it('records that a Stripe subscription was still live when comping', async () => {
    await prisma.organization.update({
      where: { id: target.organizationId },
      data: { billingSubscriptionId: 'sub_still_charging' },
    });

    await post('/plan', { plan: 'PRO', comp: true, reason: 'pilot studio comp' });

    const [entry] = await listAuditLog();
    expect(entry!.metadata).toMatchObject({ stripeSubscriptionStillActive: true });
  });

  /**
   * The sibling of the extend-trial case. Comping reinstates a studio suspended
   * by BILLING, because a comped studio that stays dark is nobody's intent — but
   * it must not reinstate one an operator suspended. Both routes had this hole in
   * their first version.
   */
  it('does not lift a platform suspension when comping', async () => {
    await post('/suspend', { reason: 'suspected card testing' });

    await post('/plan', { plan: 'PRO', comp: true, reason: 'attempted bypass' });

    const after = await org();
    expect(after.subscriptionStatus).toBe('SUSPENDED');
    expect(after.suspendedByPlatformAt).not.toBeNull();
    expect(after.compedAt, 'the comp itself still applies').not.toBeNull();
  });

  it('reinstates a billing-suspended studio when comping', async () => {
    await prisma.organization.update({
      where: { id: target.organizationId },
      data: { subscriptionStatus: 'SUSPENDED' },
    });

    await post('/plan', { plan: 'PRO', comp: true, reason: 'pilot studio comp' });

    expect((await org()).subscriptionStatus).toBe('ACTIVE');
  });

  it('warns on the studio detail screen that a comped studio is still billing', async () => {
    await prisma.organization.update({
      where: { id: target.organizationId },
      data: { billingSubscriptionId: 'sub_still_charging' },
    });
    await post('/plan', { plan: 'PRO', comp: true, reason: 'pilot studio comp' });

    const res = await request(app)
      .get(`/api/platform/organizations/${target.organizationId}`)
      .set(admin.headers);

    const codes = res.body.warnings.map((w: { code: string }) => w.code);
    expect(codes).toContain('COMPED_BUT_STILL_BILLING');
  });
});

describe('suspending and unsuspending', () => {
  it('suspends, records the reason, and warns on the detail screen', async () => {
    const res = await post('/suspend', { reason: 'chargeback fraud, case 8812' });

    expect(res.status).toBe(200);
    const after = await org();
    expect(after.subscriptionStatus).toBe('SUSPENDED');
    expect(after.suspendedByPlatformAt).not.toBeNull();
    expect(after.suspendedReason).toBe('chargeback fraud, case 8812');

    const detail = await request(app)
      .get(`/api/platform/organizations/${target.organizationId}`)
      .set(admin.headers);
    const codes = detail.body.warnings.map((w: { code: string }) => w.code);
    expect(codes).toContain('PLATFORM_SUSPENDED');
  });

  it('refuses to suspend twice', async () => {
    await post('/suspend', { reason: 'chargeback fraud, case 8812' });
    const again = await post('/suspend', { reason: 'chargeback fraud, case 8812' });

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_SUSPENDED');
  });

  it('refuses to unsuspend a studio the platform did not suspend', async () => {
    await prisma.organization.update({
      where: { id: target.organizationId },
      data: { subscriptionStatus: 'SUSPENDED' },
    });

    const res = await post('/unsuspend', { reason: REASON });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_PLATFORM_SUSPENDED');
  });

  it('restores TRIALING when the trial is still running', async () => {
    await post('/suspend', { reason: 'investigating a complaint' });
    await post('/unsuspend', { reason: 'complaint withdrawn' });

    const after = await org();
    expect(after.subscriptionStatus).toBe('TRIALING');
    expect(after.suspendedByPlatformAt).toBeNull();
    expect(after.suspendedReason).toBeNull();
  });

  it('restores ACTIVE when there is a live subscription', async () => {
    await prisma.organization.update({
      where: { id: target.organizationId },
      data: { billingSubscriptionId: 'sub_live' },
    });

    await post('/suspend', { reason: 'investigating a complaint' });
    await post('/unsuspend', { reason: 'complaint withdrawn' });

    expect((await org()).subscriptionStatus).toBe('ACTIVE');
  });

  /**
   * The case that would otherwise hand out a free account: a studio whose trial
   * had already lapsed, suspended by an operator, then unsuspended. It must go
   * back to the billing reason that was true before the operator intervened, not
   * to ACTIVE.
   */
  it('leaves a lapsed studio suspended after an unsuspend, and says why', async () => {
    await prisma.organization.update({
      where: { id: target.organizationId },
      data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
    });

    await post('/suspend', { reason: 'investigating a complaint' });
    await post('/unsuspend', { reason: 'complaint withdrawn' });

    const after = await org();
    expect(after.subscriptionStatus).toBe('SUSPENDED');
    expect(after.suspendedByPlatformAt).toBeNull();

    const [entry] = await listAuditLog();
    expect(entry!.metadata).toMatchObject({
      stillSuspendedForBillingReasons: true,
    });
  });
});

describe('billing cannot undo an operator suspension', () => {
  /**
   * THE regression test this column exists for. Suspend for abuse, then let the
   * studio's invoice succeed. Before the guard, the next payment silently
   * reinstated them and nothing anywhere recorded that it had happened.
   */
  it('survives a successful payment', async () => {
    await prisma.organization.update({
      where: { id: target.organizationId },
      data: { billingCustomerId: 'cus_paying' },
    });

    await post('/suspend', { reason: 'chargeback fraud, case 8812' });

    await onPaymentSucceeded('cus_paying');

    expect((await org()).subscriptionStatus).toBe('SUSPENDED');
  });

  it('survives a Stripe subscription going active', async () => {
    await prisma.organization.update({
      where: { id: target.organizationId },
      data: { billingCustomerId: 'cus_paying' },
    });

    await post('/suspend', { reason: 'chargeback fraud, case 8812' });

    await onSubscriptionChanged({
      id: 'sub_new',
      status: 'active',
      customerId: 'cus_paying',
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 86_400,
    });

    const after = await org();
    expect(after.subscriptionStatus).toBe('SUSPENDED');
    // The Stripe-side facts are still recorded; only the status is withheld.
    expect(after.billingSubscriptionId).toBe('sub_new');
    expect(after.currentPeriodEnd).not.toBeNull();
  });

  it('survives the no-Stripe-key local activation path', async () => {
    await post('/suspend', { reason: 'chargeback fraud, case 8812' });

    // The same route a studio uses to subscribe. With no Stripe key configured
    // — which is staging today — this activates locally, and would otherwise be
    // a one-click way around a suspension.
    const res = await request(app)
      .post(`/api/organizations/${target.organizationId}/billing/checkout`)
      .set(target.headers)
      .send({ plan: 'STUDIO' });

    // Whatever the route answers, the suspension must hold.
    expect([200, 402, 403, 404]).toContain(res.status);
    expect((await org()).subscriptionStatus).toBe('SUSPENDED');
  });

  /**
   * The sweep only ever moves studios INTO suspension, so it cannot lift one —
   * but it must also not thrash a platform-suspended studio's row or count it as
   * newly suspended every time it runs.
   */
  it('is not re-suspended by the billing sweep', async () => {
    await prisma.organization.update({
      where: { id: target.organizationId },
      data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
    });

    await post('/suspend', { reason: 'chargeback fraud, case 8812' });

    const result = await sweepExpiredSubscriptions();

    expect(result.suspendedTrials).toBe(0);
    expect((await org()).subscriptionStatus).toBe('SUSPENDED');
  });
});

describe('the write routes are invisible to a studio owner', () => {
  it('404s a suspend attempt from an ordinary owner', async () => {
    const res = await request(app)
      .post(`/api/platform/organizations/${target.organizationId}/suspend`)
      .set(target.headers)
      .send({ reason: 'let me out of jail please' });

    expect(res.status).toBe(404);
    expect((await org()).subscriptionStatus).toBe('TRIALING');
  });
});
