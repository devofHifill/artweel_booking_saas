import { prisma } from '../../lib/prisma';
import { EXPECTED_WORKERS, type WorkerName } from '../../lib/heartbeat';

/**
 * Platform health: are the background workers actually running, and are the
 * queues actually draining.
 *
 * The failure this is built for is not a crash. It is C2.1: three sweeps that
 * were written, tested, and called by nothing for two days, while every health
 * check stayed green and every route returned 200. And a deploy that shipped
 * nothing, which looked identical from outside — health green, fresh uptime,
 * because the container really had restarted, on the old image.
 *
 * So the questions here are deliberately not "is the process up". They are:
 * has each worker run RECENTLY, and is anything in a queue older than it should
 * be.
 */

/** A worker is late once it has missed several turns, not one. */
const LATE_AFTER_MISSED_INTERVALS = 5;

export type WorkerHealth = {
  name: WorkerName;
  /**
   * `never-run` is the state that matters most and the one a naive
   * implementation cannot report: a worker that was never started leaves no row,
   * so anything driven by "what rows exist" reports nothing wrong at all.
   */
  state: 'ok' | 'late' | 'never-run' | 'failing';
  expectedIntervalMs: number;
  lastFinishedAt: Date | null;
  secondsSinceLastRun: number | null;
  runs: number;
  failures: number;
  lastError: string | null;
  lastErrorAt: Date | null;
};

export async function getPlatformHealth(now = new Date()) {
  const rows = await prisma.workerHeartbeat.findMany();
  const byName = new Map(rows.map((row) => [row.name, row]));

  /**
   * Iterating the EXPECTED list rather than the rows found. This is the whole
   * point: absence has to be reportable, and a missing row is the loudest signal
   * available, not the quietest.
   */
  const workers: WorkerHealth[] = (
    Object.keys(EXPECTED_WORKERS) as WorkerName[]
  ).map((name) => {
    const expectedIntervalMs = EXPECTED_WORKERS[name].expectedIntervalMs;
    const row = byName.get(name);

    if (!row || !row.lastFinishedAt) {
      return {
        name,
        state: 'never-run' as const,
        expectedIntervalMs,
        lastFinishedAt: null,
        secondsSinceLastRun: null,
        runs: row?.runs ?? 0,
        failures: row?.failures ?? 0,
        lastError: row?.lastError ?? null,
        lastErrorAt: row?.lastErrorAt ?? null,
      };
    }

    const sinceMs = now.getTime() - row.lastFinishedAt.getTime();
    const late = sinceMs > expectedIntervalMs * LATE_AFTER_MISSED_INTERVALS;

    /**
     * "Failing" outranks "late" because it is more specific. A worker whose every
     * tick throws is still ticking, so it would otherwise report ok — running
     * perfectly and achieving nothing, which is the same shape of problem C2.1
     * was.
     */
    const failingNow =
      row.lastErrorAt !== null &&
      row.lastFinishedAt.getTime() <= row.lastErrorAt.getTime();

    return {
      name,
      state: failingNow ? ('failing' as const) : late ? ('late' as const) : ('ok' as const),
      expectedIntervalMs,
      lastFinishedAt: row.lastFinishedAt,
      secondsSinceLastRun: Math.round(sinceMs / 1000),
      runs: row.runs,
      failures: row.failures,
      lastError: row.lastError,
      lastErrorAt: row.lastErrorAt,
    };
  });

  const [
    notificationsPending,
    notificationsOverdue,
    notificationsFailed,
    oldestPendingNotification,
    calendarPending,
    calendarOverdue,
    calendarFailed,
    oldestPendingCalendarJob,
    offersHeld,
    offersOverdue,
    holdsOpen,
  ] = await Promise.all([
    prisma.notification.count({ where: { status: 'PENDING' } }),
    /**
     * OVERDUE is the signal; pending is not.
     *
     * Most pending notifications are reminders deliberately scheduled days
     * ahead, so a large pending count is a healthy queue doing its job. Only a
     * message whose moment has passed and which is still unsent means the drain
     * has stopped.
     */
    prisma.notification.count({
      where: { status: 'PENDING', scheduledFor: { lt: now } },
    }),
    prisma.notification.count({ where: { status: 'FAILED' } }),
    prisma.notification.aggregate({
      where: { status: 'PENDING' },
      _min: { scheduledFor: true },
    }),

    prisma.calendarSyncJob.count({ where: { status: 'PENDING' } }),
    prisma.calendarSyncJob.count({
      where: { status: 'PENDING', scheduledFor: { lt: now } },
    }),
    prisma.calendarSyncJob.count({ where: { status: 'FAILED' } }),
    prisma.calendarSyncJob.aggregate({
      where: { status: 'PENDING' },
      _min: { scheduledFor: true },
    }),

    prisma.waitlistEntry.count({ where: { status: 'OFFERED' } }),
    /**
     * An offer past its expiry that is still OFFERED is the exact C2.1 symptom:
     * a seat held for somebody who never replied, with nothing coming to release
     * it. Zero here is the sweep working; a growing number is the sweep not
     * running, whatever the worker row says.
     */
    prisma.waitlistEntry.count({
      where: { status: 'OFFERED', offerExpiresAt: { lt: now } },
    }),

    /**
     * `releasedAt: null` is load-bearing.
     *
     * Without it this counts every hold that has EVER expired, released or not —
     * a number that only grows, so the page reports "degraded" permanently after
     * the first abandoned checkout. Found by looking at the screen rather than by
     * a test: the fixtures had no released holds, so nothing failed. A health
     * check that cries wolf is worse than none, because it trains the one person
     * who reads it to stop.
     */
    prisma.bookingHold.count({
      where: { expiresAt: { lt: now }, releasedAt: null },
    }),
  ]);

  return {
    checkedAt: now,
    workers,
    /**
     * True when anything needs a human. The dashboard uses this for the strip on
     * the Overview screen, so a problem is visible without opening this page.
     */
    degraded:
      workers.some((w) => w.state !== 'ok') ||
      offersOverdue > 0 ||
      holdsOpen > 0 ||
      notificationsOverdue > 0 ||
      calendarOverdue > 0 ||
      notificationsFailed > 0 ||
      calendarFailed > 0,

    queues: {
      notifications: {
        pending: notificationsPending,
        overdue: notificationsOverdue,
        failed: notificationsFailed,
        /** Informational. A future date here means nothing is late. */
        nextScheduledFor: oldestPendingNotification._min.scheduledFor,
      },
      calendar: {
        pending: calendarPending,
        overdue: calendarOverdue,
        failed: calendarFailed,
        nextScheduledFor: oldestPendingCalendarJob._min.scheduledFor,
      },
    },

    /**
     * Work that should already have been swept. These are the numbers that stay
     * at zero when the sweeps run and climb when they do not — an outcome check
     * rather than a liveness one, which is what made C2.1 invisible.
     */
    unswept: {
      waitlistOffersHeld: offersHeld,
      waitlistOffersOverdue: offersOverdue,
      expiredHoldsStillOpen: holdsOpen,
    },
  };
}
