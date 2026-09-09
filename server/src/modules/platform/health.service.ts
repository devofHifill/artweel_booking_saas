import { prisma } from '../../lib/prisma';
import { config } from '../../config';
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

/**
 * A single line on the health panel.
 *
 * THERE IS NO UPTIME FIGURE HERE, deliberately. Nothing in this system records
 * availability over time — no probe history, no incident log — so a "99.98%"
 * would be a number with no measurement behind it, on the one screen whose
 * entire job is to be trusted when something is wrong.
 *
 * `latencyMs` is present only where it was actually timed on this request. For
 * the database that is a real round trip. For Stripe, Resend, Twilio and Google
 * it is absent on purpose: timing them would mean calling four third-party APIs
 * every time an operator opens the dashboard, which buys a number nobody acts
 * on at the cost of rate limits and a page that fails when a vendor is slow.
 * What those rows report instead is whether they are configured at all — which
 * is the question that has actually been wrong in this deployment.
 */
export type HealthComponent = {
  key: string;
  label: string;
  status: 'ok' | 'degraded' | 'down' | 'not-configured';
  detail: string;
  latencyMs: number | null;
};

/** Configured means "a real provider will be used", not "we called it". */
function providerComponent(
  key: string,
  label: string,
  configured: boolean,
  fallback: string,
): HealthComponent {
  return {
    key,
    label,
    status: configured ? 'ok' : 'not-configured',
    detail: configured ? 'Configured' : fallback,
    latencyMs: null,
  };
}

export async function getPlatformHealth(now = new Date()) {
  /*
    Timed around a trivial round trip, so the number means "the pool answered",
    not "this query is fast". It is the one latency on the panel that was
    genuinely measured.
  */
  const dbStartedAt = Date.now();
  let dbLatencyMs: number | null = null;
  let dbError: string | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStartedAt;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

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

  const workersDown = workers.filter((w) => w.state !== 'ok');

  const components: HealthComponent[] = [
    {
      key: 'database',
      label: 'Database',
      status: dbError ? 'down' : 'ok',
      detail: dbError ? dbError.slice(0, 120) : 'Responding',
      latencyMs: dbLatencyMs,
    },
    {
      key: 'workers',
      label: 'Workers',
      status: workersDown.length === 0 ? 'ok' : 'degraded',
      detail:
        workersDown.length === 0
          ? `All ${workers.length} running`
          : workersDown.map((w) => `${w.name}: ${w.state}`).join(', '),
      latencyMs: null,
    },
    {
      key: 'notifications',
      label: 'Notification queue',
      status:
        notificationsOverdue > 0 || notificationsFailed > 0 ? 'degraded' : 'ok',
      detail:
        notificationsOverdue > 0 || notificationsFailed > 0
          ? `${notificationsOverdue} overdue, ${notificationsFailed} failed`
          : `${notificationsPending} queued, none overdue`,
      latencyMs: null,
    },
    {
      key: 'calendar-queue',
      label: 'Calendar sync queue',
      status: calendarOverdue > 0 || calendarFailed > 0 ? 'degraded' : 'ok',
      detail:
        calendarOverdue > 0 || calendarFailed > 0
          ? `${calendarOverdue} overdue, ${calendarFailed} failed`
          : `${calendarPending} queued, none overdue`,
      latencyMs: null,
    },
    providerComponent(
      'stripe',
      'Stripe',
      Boolean(config.STRIPE_SECRET_KEY),
      'No key — payments cannot be taken',
    ),
    providerComponent(
      'email',
      'Email (Resend)',
      Boolean(config.RESEND_API_KEY),
      'No key — email is logged, not sent',
    ),
    providerComponent(
      'sms',
      'SMS (Twilio)',
      Boolean(
        config.TWILIO_ACCOUNT_SID &&
          config.TWILIO_AUTH_TOKEN &&
          config.TWILIO_FROM_NUMBER,
      ),
      'Not configured — SMS is logged, not sent',
    ),
    providerComponent(
      'google-calendar',
      'Google Calendar',
      Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
      'Not configured — using the in-memory fake',
    ),
  ];

  return {
    checkedAt: now,
    workers,
    /**
     * The rows the health panel draws. `not-configured` is deliberately not
     * counted as a fault below: a staging box with no Twilio key is working as
     * intended, and colouring it red would train the one person who reads this
     * screen to ignore it.
     */
    components,
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
