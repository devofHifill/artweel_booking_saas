import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { recordWorkerRun } from '../../lib/heartbeat';
import { CalendarAuthError } from './provider';
import { executeSyncJob, renewExpiringWatches } from './calendar.service';

/**
 * Drains queued calendar writes.
 *
 * Same lease-claim pattern as the notification outbox — `FOR UPDATE
 * SKIP LOCKED`, attempts incremented on claim, `scheduled_for` pushed forward
 * so a dead worker's job becomes due again rather than sticking.
 */

type ClaimedJob = {
  id: string;
  connection_id: string;
  booking_id: string | null;
  session_id: string | null;
  action: string;
  payload: Record<string, unknown>;
  attempts: number;
};

function backoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts - 1), 30) * 60_000;
}

export async function claimSyncJobs(limit = 20): Promise<ClaimedJob[]> {
  const leaseSeconds = config.NOTIFICATION_LEASE_SECONDS;

  return prisma.$queryRaw<ClaimedJob[]>`
    UPDATE calendar_sync_jobs
    SET attempts = attempts + 1,
        scheduled_for = now() + make_interval(secs => ${leaseSeconds}::double precision),
        updated_at = now()
    WHERE id IN (
      SELECT id FROM calendar_sync_jobs
      -- Same two-second allowance as the notification queue: scheduled_for is
      -- stamped by Node, compared by Postgres, and the two clocks are close
      -- but not identical.
      WHERE status = 'PENDING'
        AND scheduled_for <= now() + interval '2 seconds'
        AND attempts < ${config.NOTIFICATION_MAX_ATTEMPTS}
      ORDER BY scheduled_for ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, connection_id, booking_id, session_id,
              action::text AS action, payload, attempts
  `;
}

export async function processCalendarBatch(limit = 20) {
  const jobs = await claimSyncJobs(limit);
  let synced = 0;
  let failed = 0;
  let retrying = 0;

  for (const job of jobs) {
    try {
      await executeSyncJob({
        id: job.id,
        connectionId: job.connection_id,
        bookingId: job.booking_id,
        sessionId: job.session_id,
        action: job.action,
        payload: job.payload,
      });

      await prisma.calendarSyncJob.update({
        where: { id: job.id },
        data: { status: 'SENT', lastError: null },
      });
      synced++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      /**
       * An auth failure is terminal for this job. The connection has already
       * been marked NEEDS_REAUTH by the service; retrying would hammer a dead
       * credential and bury the real problem under noise.
       */
      const terminal = err instanceof CalendarAuthError;
      const exhausted = job.attempts >= config.NOTIFICATION_MAX_ATTEMPTS;

      if (terminal || exhausted) {
        await prisma.calendarSyncJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', lastError: message },
        });
        failed++;
      } else {
        await prisma.calendarSyncJob.update({
          where: { id: job.id },
          data: {
            scheduledFor: new Date(Date.now() + backoffMs(job.attempts)),
            lastError: message,
          },
        });
        retrying++;
      }
    }
  }

  return { claimed: jobs.length, synced, failed, retrying };
}

let timer: NodeJS.Timeout | null = null;

export function startCalendarWorker(intervalMs = 10_000) {
  if (timer) return;

  let renewCounter = 0;

  const tick = async () => {
    try {
      await recordWorkerRun('calendar', async () => {
        const result = await processCalendarBatch();
        if (result.claimed > 0) logger.debug(result, 'Calendar sync batch');

        // Roughly hourly at the default interval. Channels last about a week,
        // so this has plenty of margin — but missing it entirely stops inbound
        // sync silently, which is the failure worth guarding against.
        if (++renewCounter >= 360) {
          renewCounter = 0;
          await renewExpiringWatches();
        }
      });
    } catch (err) {
      logger.error({ err }, 'Calendar worker tick failed');
    }
  };

  timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  logger.info({ intervalMs }, 'Calendar worker started');
}

export function stopCalendarWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
