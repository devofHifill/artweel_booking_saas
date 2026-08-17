import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { recordWorkerRun } from '../../lib/heartbeat';
import { DeliveryError } from './provider';
import { getEmailProvider, getSmsProvider } from './registry';
import { scheduleBookingNotifications } from './notification.service';

/**
 * The outbox drainer.
 *
 * Claiming uses a LEASE rather than a status flag: a claimed row has its
 * `scheduled_for` pushed into the future and its attempt count incremented,
 * so a worker that dies mid-send does not strand the message — it simply
 * becomes due again when the lease expires. No separate reaper, no rows stuck
 * in a PROCESSING state forever.
 *
 * `FOR UPDATE SKIP LOCKED` means several workers can run against one queue
 * without ever handing the same message to two of them.
 *
 * Sending happens OUTSIDE the transaction. Holding a database connection open
 * across a network call to an email provider is how a connection pool dies.
 */

type ClaimedRow = {
  id: string;
  organization_id: string;
  booking_id: string | null;
  channel: 'EMAIL' | 'SMS';
  template_key: string;
  destination: string;
  payload: Record<string, unknown>;
  attempts: number;
};

/**
 * Exponential backoff with a ceiling: 1, 2, 4, 8, 16, 30 minutes.
 *
 * A provider having a bad ten minutes should not cost the message, and a
 * message that has failed five times should not be retried every second.
 */
function backoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts - 1), 30) * 60_000;
}

export async function claimBatch(limit = 20): Promise<ClaimedRow[]> {
  const leaseSeconds = config.NOTIFICATION_LEASE_SECONDS;

  return prisma.$queryRaw<ClaimedRow[]>`
    UPDATE notifications
    SET attempts = attempts + 1,
        scheduled_for = now() + make_interval(secs => ${leaseSeconds}::double precision),
        updated_at = now()
    WHERE id IN (
      SELECT id FROM notifications
      -- Two seconds of slack, because two clocks are involved: scheduled_for
      -- is stamped by NODE and this comparison is made by POSTGRES. Without
      -- it, a message queued "now" can land a few milliseconds in the
      -- database's future and wait a whole polling interval — which shows up
      -- as an intermittently failing test and, in production, as a
      -- confirmation email that arrives five seconds late for no reason.
      -- Picking a job up two seconds early is harmless.
      WHERE status = 'PENDING'
        AND scheduled_for <= now() + interval '2 seconds'
        AND attempts < ${config.NOTIFICATION_MAX_ATTEMPTS}
      ORDER BY scheduled_for ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, organization_id, booking_id, channel::text AS channel,
              template_key, destination, payload, attempts
  `;
}

async function deliver(row: ClaimedRow) {
  if (row.channel === 'EMAIL') {
    const provider = getEmailProvider();
    return provider.send({
      to: row.destination,
      subject: String(row.payload.subject ?? ''),
      text: String(row.payload.body ?? ''),
      fromName: String(row.payload.fromName ?? 'Bookings'),
    });
  }

  const provider = getSmsProvider();
  return provider.send({
    to: row.destination,
    body: String(row.payload.body ?? ''),
  });
}

/**
 * Processes one batch. Returns counts so a caller — or a test — can assert on
 * what happened rather than waiting on a timer.
 */
export async function processBatch(limit = 20) {
  const rows = await claimBatch(limit);
  let sent = 0;
  let failed = 0;
  let retrying = 0;

  for (const row of rows) {
    try {
      const result = await deliver(row);

      await prisma.notification.update({
        where: { id: row.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: result.messageId,
          lastError: null,
        },
      });
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // A permanent failure is one no amount of retrying fixes: a malformed
      // address, a rejected number. Burning five more attempts on it delays
      // every message behind it for nothing.
      const permanent = err instanceof DeliveryError && err.permanent;
      const exhausted = row.attempts >= config.NOTIFICATION_MAX_ATTEMPTS;

      if (permanent || exhausted) {
        await prisma.notification.update({
          where: { id: row.id },
          data: { status: 'FAILED', lastError: message },
        });
        failed++;
        logger.warn(
          { notificationId: row.id, permanent, attempts: row.attempts },
          'Notification failed',
        );
      } else {
        await prisma.notification.update({
          where: { id: row.id },
          data: {
            scheduledFor: new Date(Date.now() + backoffMs(row.attempts)),
            lastError: message,
          },
        });
        retrying++;
      }
    }
  }

  return { claimed: rows.length, sent, failed, retrying };
}

/**
 * Self-healing sweep for confirmations that were never queued.
 *
 * The outbox row is written just AFTER the booking commits, not inside the
 * same transaction — keeping the scheduling core free of any knowledge of
 * notifications is worth more than closing a millisecond-wide window. A crash
 * in that window would otherwise leave a confirmed booking with no
 * confirmation, and nobody would ever find out.
 *
 * Two minutes of grace, so this never races the normal path.
 */
export async function reconcileMissingConfirmations(graceMinutes = 2) {
  const cutoff = new Date(Date.now() - graceMinutes * 60_000);

  const orphans = await prisma.booking.findMany({
    where: {
      status: { in: ['PENDING', 'CONFIRMED'] },
      createdAt: { lt: cutoff },
      startsAt: { gt: new Date() },
      notifications: { none: {} },
    },
    select: { id: true },
    take: 100,
  });

  for (const booking of orphans) {
    await scheduleBookingNotifications(booking.id).catch((err) => {
      logger.error({ err, bookingId: booking.id }, 'Reconcile failed');
    });
  }

  if (orphans.length > 0) {
    logger.warn({ count: orphans.length }, 'Reconciled missing confirmations');
  }

  return { reconciled: orphans.length };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Polling loop.
 *
 * A poll every few seconds rather than a message broker: the volume is a
 * handful of messages per studio per day, Postgres is already here, and
 * SKIP LOCKED makes it correct under concurrency. BullMQ can replace this the
 * day the volume justifies a second moving part.
 */
export function startNotificationWorker(intervalMs = 5_000) {
  if (timer) return;

  let reconcileCounter = 0;

  const tick = async () => {
    try {
      // Inside the existing try/catch, which keeps its behaviour: a failed tick
      // is still logged and still does not kill the loop. The heartbeat records
      // the failure too, so "running but failing every time" is distinguishable
      // from "running quietly" without reading logs.
      await recordWorkerRun('notifications', async () => {
        const result = await processBatch();
        if (result.claimed > 0) {
          logger.debug(result, 'Notification batch');
        }

        // Roughly every five minutes at the default interval.
        if (++reconcileCounter >= 60) {
          reconcileCounter = 0;
          await reconcileMissingConfirmations();
        }
      });
    } catch (err) {
      logger.error({ err }, 'Notification worker tick failed');
    }
  };

  timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  logger.info({ intervalMs }, 'Notification worker started');
}

export function stopNotificationWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
