import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';
import { grantPlatformAdmin } from '../../src/modules/platform/platform.service';
import { getPlatformHealth } from '../../src/modules/platform/health.service';
import { recordWorkerRun } from '../../src/lib/heartbeat';
import { startSweepWorker, stopSweepWorker } from '../../src/workers/sweep.worker';

/**
 * S5 — worker and queue health.
 *
 * These tests are written against the failure this screen exists for, which is
 * NOT a crash. It is C2.1: three sweeps written, tested, and called by nothing for
 * two days, with every health check green and every route returning 200. So the
 * cases that matter are "has never run", "runs and always fails", and "the work
 * is not getting done regardless of what the worker rows say".
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

  admin = await signUpStudio(app, { organizationName: 'Artweel HQ' });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: admin.userId },
    select: { email: true },
  });
  await grantPlatformAdmin({ email: user.email });
});

afterEach(() => {
  stopSweepWorker();
});

function worker(health: Awaited<ReturnType<typeof getPlatformHealth>>, name: string) {
  return health.workers.find((w) => w.name === name)!;
}

/**
 * Stamps every expected worker as having just run.
 *
 * Needed by any test asserting `degraded` is caused by something specific: a
 * fresh database has no heartbeats, so all three workers read `never-run` and
 * `degraded` is true no matter what else is going on.
 */
async function allWorkersHealthy() {
  await recordWorkerRun('notifications', async () => undefined);
  await recordWorkerRun('calendar', async () => undefined);
  await recordWorkerRun('sweeps', async () => undefined);
}

/** A queued notification due at the given moment. */
async function queueNotification(organizationId: string, scheduledFor: Date) {
  return prisma.notification.create({
    data: {
      organizationId,
      channel: 'EMAIL',
      templateKey: 'booking_confirmation',
      destination: 'ana@example.test',
      payload: { studioName: 'Clay & Co' },
      status: 'PENDING',
      scheduledFor,
      // Unique per row; the outbox uses it to make queueing idempotent.
      dedupeKey: `test-${Math.random().toString(36).slice(2)}`,
    },
  });
}

/** Polls rather than sleeping a fixed period — see tests/gate/sweeps.test.ts. */
async function eventually<T>(
  read: () => Promise<T | null | undefined>,
  what: string,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}.`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('a worker that has never run', () => {
  /**
   * The C2.1 case, and the one an implementation driven by "what rows exist"
   * cannot report: a worker that was never started leaves no heartbeat row, so
   * iterating rows finds nothing wrong. The expected-worker list is what makes
   * absence reportable.
   */
  it('is reported as never-run rather than omitted', async () => {
    const health = await getPlatformHealth();

    expect(health.workers).toHaveLength(3);
    for (const w of health.workers) {
      expect(w.state).toBe('never-run');
      expect(w.lastFinishedAt).toBeNull();
      expect(w.secondsSinceLastRun).toBeNull();
    }
  });

  it('marks the platform degraded', async () => {
    const health = await getPlatformHealth();
    expect(health.degraded).toBe(true);
  });
});

describe('a worker that is running', () => {
  it('is reported ok, with a run count', async () => {
    await recordWorkerRun('sweeps', async () => undefined);

    const health = await getPlatformHealth();
    const sweeps = worker(health, 'sweeps');

    expect(sweeps.state).toBe('ok');
    expect(sweeps.runs).toBe(1);
    expect(sweeps.failures).toBe(0);
    expect(sweeps.lastFinishedAt).not.toBeNull();
  });

  /**
   * Late only after several missed turns. One skipped tick on a busy box is not
   * an incident, and a check that cries wolf gets ignored — which is how the
   * genuine signal gets lost.
   */
  it('is reported late once it has missed several intervals', async () => {
    await recordWorkerRun('sweeps', async () => undefined);

    const oneTickLater = new Date(Date.now() + 61_000);
    expect(worker(await getPlatformHealth(oneTickLater), 'sweeps').state).toBe('ok');

    const muchLater = new Date(Date.now() + 10 * 60_000);
    expect(worker(await getPlatformHealth(muchLater), 'sweeps').state).toBe('late');
  });

  /**
   * A worker whose every tick throws is still ticking, so a liveness check reports
   * it healthy — running perfectly and achieving nothing, which is the same shape
   * of problem C2.1 was. `failing` outranks `late` because it is more specific.
   */
  it('is reported failing when its last tick threw', async () => {
    await expect(
      recordWorkerRun('sweeps', async () => {
        throw new Error('Google said no');
      }),
    ).rejects.toThrow('Google said no');

    const health = await getPlatformHealth();
    const sweeps = worker(health, 'sweeps');

    expect(sweeps.state).toBe('failing');
    expect(sweeps.failures).toBe(1);
    expect(sweeps.lastError).toBe('Google said no');
    expect(health.degraded).toBe(true);
  });

  /**
   * The error is kept after a later success, so a fault that has since cleared is
   * still visible instead of erased by the next quiet tick — but the state goes
   * back to ok, because it is working now.
   */
  it('recovers to ok while keeping the last error visible', async () => {
    await expect(
      recordWorkerRun('sweeps', async () => {
        throw new Error('transient');
      }),
    ).rejects.toThrow();

    await recordWorkerRun('sweeps', async () => undefined);

    const sweeps = worker(await getPlatformHealth(), 'sweeps');
    expect(sweeps.state).toBe('ok');
    expect(sweeps.lastError).toBe('transient');
    expect(sweeps.failures).toBe(1);
    expect(sweeps.runs).toBe(2);
  });
});

describe('the real sweep worker stamps its own heartbeat', () => {
  /**
   * Not "does the heartbeat helper work" but "does the worker use it" — the same
   * distinction that made C2.1 invisible, where every sweep passed its own test
   * and nothing called them.
   */
  it('records a run without being asked', async () => {
    expect(worker(await getPlatformHealth(), 'sweeps').state).toBe('never-run');

    startSweepWorker(50);

    /**
     * Polls for `lastFinishedAt`, not for the row.
     *
     * `recordWorkerRun` stamps the START first, so the row exists a moment before
     * the tick completes — polling for mere existence wins the race and then
     * asserts on a half-written row. Which is exactly what happened on the first
     * run of this test: it failed on a null `lastFinishedAt` while the worker was
     * behaving perfectly.
     */
    const row = await eventually(
      async () => {
        const found = await prisma.workerHeartbeat.findUnique({
          where: { name: 'sweeps' },
        });
        return found?.lastFinishedAt ? found : null;
      },
      'the sweep worker to finish a tick and stamp its heartbeat',
    );

    expect(row.lastFinishedAt).not.toBeNull();
    expect(row.runs).toBeGreaterThanOrEqual(1);
    expect(worker(await getPlatformHealth(), 'sweeps').state).toBe('ok');
  });
});

describe('work that should already have been swept', () => {
  /**
   * The outcome check rather than the liveness one. An offer past its expiry that
   * is still OFFERED is a seat held for somebody who never replied, with nothing
   * coming to release it — literally what C2.1 left in the database for two days.
   * This climbs whatever the worker rows claim.
   */
  it('counts an overdue waitlist offer and marks the platform degraded', async () => {
    const studio = await signUpStudio(app, { organizationName: 'Clay & Co' });

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Ana Reyes',
        email: 'ana@example.test',
      },
    });

    const service = await prisma.serviceType.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Wheel Class',
        slug: 'wheel-class',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 8,
        priceCents: 0,
      },
    });

    const startsAt = new Date(Date.now() + 7 * 86_400_000);

    const session = await prisma.session.create({
      data: {
        organizationId: studio.organizationId,
        serviceTypeId: service.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 7_200_000),
        // Both required and both load-bearing elsewhere: sessions carry their
        // own timezone and wall-clock time so a studio's schedule survives a
        // DST change. Irrelevant to this test, but not optional.
        timezone: 'America/New_York',
        localStartTime: '19:00',
        capacity: 8,
        seatsTaken: 8,
      },
    });

    /**
     * An OFFERED entry must carry a `hold_id` — the schema enforces it with the
     * `waitlist_entries_offer_coherent` check, because an offer that does not
     * hold a real seat is an offer of nothing. So the fixture has to create the
     * hold too, and that is the seat this test is showing as stranded.
     */
    const hold = await prisma.bookingHold.create({
      data: {
        organizationId: studio.organizationId,
        sessionId: session.id,
        customerId: customer.id,
        seats: 1,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 7_200_000),
        expiresAt: new Date(Date.now() - 3_600_000),
      },
    });

    await prisma.waitlistEntry.create({
      data: {
        organizationId: studio.organizationId,
        sessionId: session.id,
        customerId: customer.id,
        status: 'OFFERED',
        position: 1,
        holdId: hold.id,
        // Offered, and the window closed an hour ago.
        offeredAt: new Date(Date.now() - 7_200_000),
        offerExpiresAt: new Date(Date.now() - 3_600_000),
        claimToken: Buffer.from('token'),
      },
    });

    const health = await getPlatformHealth();

    expect(health.unswept.waitlistOffersHeld).toBe(1);
    expect(health.unswept.waitlistOffersOverdue).toBe(1);
    expect(health.degraded).toBe(true);
  });
});

describe('counting only work that is genuinely outstanding', () => {
  /**
   * Regression for a bug found by LOOKING at the screen, not by a test.
   *
   * The hold count originally had no `releasedAt: null` filter, so it counted
   * every hold that had ever expired — released or not. That number only grows,
   * so the page reported "degraded" permanently after the first abandoned
   * checkout. The fixtures had no released holds, so nothing failed.
   *
   * A health check that cries wolf is worse than none: it trains the one person
   * who reads it to stop reading it, which is how the next real signal gets
   * missed.
   */
  it('ignores an expired hold that was already released', async () => {
    const studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
    const startsAt = new Date(Date.now() + 7 * 86_400_000);

    await prisma.bookingHold.create({
      data: {
        organizationId: studio.organizationId,
        seats: 1,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 7_200_000),
        expiresAt: new Date(Date.now() - 3_600_000),
        // The sweep did its job. This is history, not outstanding work.
        releasedAt: new Date(Date.now() - 3_500_000),
      },
    });

    const health = await getPlatformHealth();
    expect(health.unswept.expiredHoldsStillOpen).toBe(0);
  });

  it('counts an expired hold that is still open', async () => {
    const studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
    const startsAt = new Date(Date.now() + 7 * 86_400_000);

    await prisma.bookingHold.create({
      data: {
        organizationId: studio.organizationId,
        seats: 1,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 7_200_000),
        expiresAt: new Date(Date.now() - 3_600_000),
      },
    });

    await allWorkersHealthy();

    const health = await getPlatformHealth();
    expect(health.unswept.expiredHoldsStillOpen).toBe(1);
    expect(
      health.degraded,
      'workers are fine here, so this can only be the hold',
    ).toBe(true);
  });

  /**
   * The other half of the same mistake. Most pending notifications are reminders
   * deliberately scheduled days ahead, so a large `pending` figure is a healthy
   * queue — the dev database showed 32 waiting with nothing wrong. Only `overdue`
   * means the drain has stopped.
   */
  it('does not treat a notification scheduled for the future as overdue', async () => {
    const studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
    await queueNotification(studio.organizationId, new Date(Date.now() + 2 * 86_400_000));

    /**
     * Required for this assertion to mean anything. A fresh test database has no
     * heartbeats, so all three workers read `never-run` and `degraded` is true
     * regardless of the queue — the assertion below would pass for entirely the
     * wrong reason without this.
     */
    await allWorkersHealthy();

    const health = await getPlatformHealth();

    expect(health.queues.notifications.pending).toBe(1);
    expect(health.queues.notifications.overdue).toBe(0);
    expect(
      health.degraded,
      'a queue holding future reminders is working, not failing',
    ).toBe(false);
  });

  it('counts a notification whose moment has passed as overdue', async () => {
    const studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
    await queueNotification(studio.organizationId, new Date(Date.now() - 3_600_000));
    await allWorkersHealthy();

    const health = await getPlatformHealth();

    expect(health.queues.notifications.overdue).toBe(1);
    expect(health.degraded).toBe(true);
  });
});

describe('over HTTP', () => {
  it('returns the health payload to a platform admin', async () => {
    await recordWorkerRun('sweeps', async () => undefined);

    const res = await request(app)
      .get('/api/platform/health')
      .set(admin.headers);

    expect(res.status).toBe(200);
    expect(res.body.health.workers).toHaveLength(3);
    expect(res.body.health).toHaveProperty('queues.notifications.pending');
    expect(res.body.health).toHaveProperty('unswept.waitlistOffersOverdue');
  });

  it('is invisible to an ordinary studio owner', async () => {
    const outsider = await signUpStudio(app);

    const res = await request(app)
      .get('/api/platform/health')
      .set(outsider.headers);

    expect(res.status).toBe(404);
  });

  /**
   * The public liveness endpoint must stay unchanged and must not start reporting
   * worker state — it answers "can this container serve traffic" for the load
   * balancer and is reachable without a grant.
   */
  it('does not leak worker state into the public health endpoint', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('never-run');
  });
});
