import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { getMrrHistory, takeMrrSnapshot } from '../../src/modules/platform/mrr.service';
import { getPlatformHealth } from '../../src/modules/platform/health.service';

/**
 * MRR history: the snapshot, and the movement arithmetic it exists to support.
 *
 * The movements are the part worth testing hardest. They are not stored — they
 * are derived by diffing consecutive days, so an off-by-one in that diff would
 * report a downgrade as churn, or a studio's very first day as expansion, and
 * nothing else in the system would contradict it.
 */

const app = createApp();

const DAY_MS = 86_400_000;

/** Midnight UTC, N days before today — the shape the DATE column stores. */
function dayAgo(n: number): Date {
  const at = new Date(Date.now() - n * DAY_MS);
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}

let a: Studio;
let b: Studio;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  a = await signUpStudio(app, { organizationName: 'Clay & Co' });
  b = await signUpStudio(app, { organizationName: 'Kiln House' });
});

/** Writes history directly, because the alternative is waiting a day. */
function row(organizationId: string, days: number, mrrCents: number) {
  return prisma.mrrDailyStudio.create({
    data: {
      date: dayAgo(days),
      organizationId,
      plan: mrrCents >= 18_900 ? 'PRO' : mrrCents >= 8_900 ? 'STUDIO' : 'SOLO',
      mrrCents,
    },
  });
}

describe('taking a snapshot', () => {
  it('records only ACTIVE studios, priced from the plan', async () => {
    await prisma.organization.update({
      where: { id: a.organizationId },
      data: { subscriptionStatus: 'ACTIVE', plan: 'STUDIO' },
    });
    // Trialing pays nothing and must not appear, exactly as it contributes
    // nothing to the headline MRR the chart sits under.
    await prisma.organization.update({
      where: { id: b.organizationId },
      data: { subscriptionStatus: 'TRIALING', plan: 'PRO' },
    });

    const result = await takeMrrSnapshot();

    expect(result.studios).toBe(1);
    expect(result.mrrCents).toBe(8900);

    const rows = await prisma.mrrDailyStudio.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organizationId).toBe(a.organizationId);
    expect(rows[0]!.mrrCents).toBe(8900);
  });

  it('is idempotent, and drops a studio that stopped being active today', async () => {
    await prisma.organization.update({
      where: { id: a.organizationId },
      data: { subscriptionStatus: 'ACTIVE', plan: 'SOLO' },
    });

    await takeMrrSnapshot();
    await takeMrrSnapshot();
    expect(await prisma.mrrDailyStudio.count()).toBe(1);

    /*
      The row must GO, not linger. A stale row reads as "still paying"
      tomorrow, which would swallow the churn event entirely — the one thing
      this table exists to catch.
    */
    await prisma.organization.update({
      where: { id: a.organizationId },
      data: { subscriptionStatus: 'CANCELED' },
    });
    await takeMrrSnapshot();

    expect(await prisma.mrrDailyStudio.count()).toBe(0);
  });
});

describe('the movements between days', () => {
  it('separates new, expansion, contraction and churn', async () => {
    // Day 3: A on SOLO ($39).
    await row(a.organizationId, 3, 3900);
    // Day 2: A upgrades to STUDIO ($89), B arrives on SOLO.
    await row(a.organizationId, 2, 8900);
    await row(b.organizationId, 2, 3900);
    // Day 1: A downgrades back to SOLO, B is gone.
    await row(a.organizationId, 1, 3900);

    const { points } = await getMrrHistory(5);
    expect(points).toHaveLength(3);

    const [first, second, third] = points;

    // A's first ever day is new, and nothing else.
    expect(first!.newCents).toBe(3900);
    expect(first!.expansionCents).toBe(0);
    expect(first!.churnedCents).toBe(0);

    // A's upgrade is expansion, not new; B's arrival is new, not expansion.
    expect(second!.expansionCents).toBe(5000);
    expect(second!.newCents).toBe(3900);
    expect(second!.mrrCents).toBe(12800);
    expect(second!.activeStudios).toBe(2);

    // A downgrading is contraction; B leaving is churn. Both negative, and
    // kept apart — folding a downgrade into churn would overstate churn by
    // the whole of A rather than the $50 actually lost.
    expect(third!.contractionCents).toBe(-5000);
    expect(third!.churnedCents).toBe(-3900);
    expect(third!.mrrCents).toBe(3900);
  });

  it('diffs the first day in the window against the day before it', async () => {
    /*
      Without a baseline read from outside the window, the earliest point would
      diff against nothing and report every existing studio as new — a spike at
      the left edge that moves whenever the operator changes the range.
    */
    await row(a.organizationId, 10, 8900);
    await row(a.organizationId, 2, 8900);

    const { points } = await getMrrHistory(4);

    expect(points).toHaveLength(1);
    expect(points[0]!.mrrCents).toBe(8900);
    expect(points[0]!.newCents).toBe(0);
  });

  it('reports no history rather than a zero line when nothing was recorded', async () => {
    const history = await getMrrHistory(30);

    expect(history.hasHistory).toBe(false);
    expect(history.points).toEqual([]);
    expect(history.firstDate).toBeNull();
  });
});

describe('the health panel components', () => {
  it('reports unconfigured providers as their own state, not as a fault', async () => {
    const health = await getPlatformHealth();
    const byKey = new Map(health.components.map((c) => [c.key, c]));

    // The test environment has no Resend or Twilio credentials, which is the
    // same shape staging is in.
    expect(byKey.get('email')!.status).toBe('not-configured');
    expect(byKey.get('email')!.detail).toMatch(/logged, not sent/i);
    expect(byKey.get('sms')!.status).toBe('not-configured');

    // The database was genuinely reached, and timed.
    const db = byKey.get('database')!;
    expect(db.status).toBe('ok');
    expect(typeof db.latencyMs).toBe('number');

    /*
      No component claims an uptime percentage, because nothing measures one.
      Asserted rather than trusted: a figure like that is easy to add later and
      impossible to notice is fabricated.
    */
    for (const c of health.components) {
      expect(JSON.stringify(c)).not.toMatch(/99\.\d/);
    }

    // Only what was timed carries a latency. The provider rows report whether
    // they are configured; timing them would mean calling four vendors on
    // every dashboard load.
    expect(byKey.get('stripe')!.latencyMs).toBeNull();
    expect(byKey.get('email')!.latencyMs).toBeNull();
  });

  it('names the snapshot worker, so its absence is reportable', async () => {
    const health = await getPlatformHealth();

    // Never run in a fresh test database — which is precisely the state that
    // must be visible rather than silent.
    const snapshot = health.workers.find((w) => w.name === 'mrrSnapshot');
    expect(snapshot).toBeDefined();
    expect(snapshot!.state).toBe('never-run');
  });
});
