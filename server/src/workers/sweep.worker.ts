import { logger } from '../lib/logger';
import { recordWorkerRun } from '../lib/heartbeat';
import { sweepExpiredOffers } from '../modules/waitlists/waitlist.service';
import { sweepExpiredSubscriptions } from '../modules/billing/billing.service';
import { sweepExpiredHolds } from '../scheduling/hold.service';

/**
 * The state changes that happen because time passed, and for no other reason.
 *
 * Every other transition in this system is driven by a request: somebody books,
 * cancels, pays, marks a register. These three are not. A trial ends because a
 * date arrives, a hold dies because nobody finished checking out, a waitlist
 * offer lapses because the person never opened the email. Nothing will ever
 * arrive to trigger them, so something has to go looking.
 *
 * All three sweeps existed and were tested from the day they were written, but
 * nothing outside the test suite called them — the seats an ignored waitlist
 * offer was holding stayed held, and no trial ever ended. This worker is that
 * missing caller.
 *
 * They live together rather than one worker each because they share a shape:
 * cheap indexed queries, no external I/O, and idempotence by construction. The
 * notification and calendar workers earn their own loops by talking to networks
 * that fail in interesting ways; these do not.
 */

/**
 * Order is deliberate: offers, then holds.
 *
 * A waitlist offer holds its seat through a booking hold, created with the
 * offer's own TTL, so both fall due at the same instant. Sweeping offers first
 * lets the coordinated path do the work — mark EXPIRED, release the seat, pass
 * it to the next person in the queue — and the hold sweep then finds nothing to
 * do. The other order still ends correctly, because releasing a hold twice is a
 * no-op, but it releases the seat a beat before the queue is told it is free.
 *
 * Each sweep is isolated. One of them throwing must not starve the other two,
 * which is exactly what a single try/catch around all three would do.
 */
export async function processSweepBatch(opts: { billing?: boolean } = {}) {
  let offers: Awaited<ReturnType<typeof sweepExpiredOffers>> | null = null;
  let holds: Awaited<ReturnType<typeof sweepExpiredHolds>> | null = null;
  let subscriptions:
    | Awaited<ReturnType<typeof sweepExpiredSubscriptions>>
    | null = null;

  try {
    offers = await sweepExpiredOffers();
  } catch (err) {
    logger.error({ err }, 'Waitlist offer sweep failed');
  }

  try {
    holds = await sweepExpiredHolds();
  } catch (err) {
    logger.error({ err }, 'Hold sweep failed');
  }

  if (opts.billing) {
    try {
      subscriptions = await sweepExpiredSubscriptions();
    } catch (err) {
      logger.error({ err }, 'Subscription sweep failed');
    }
  }

  return { offers, holds, subscriptions };
}

let timer: NodeJS.Timeout | null = null;

/**
 * A minute is the right cadence for the two that matter.
 *
 * Booking holds live ten minutes and waitlist offers twelve hours, so a
 * one-minute poll costs at most a minute of over-holding on the tightest of
 * them — invisible against a ten-minute TTL, and cheap because both queries are
 * covered by partial indexes on the open rows rather than on all history.
 *
 * Subscriptions are different in kind: a trial ends on a date, so sweeping one
 * every minute would be sixty pointless scans an hour to notice something that
 * changes at most once a day. Hourly has all the margin it needs.
 */
export function startSweepWorker(intervalMs = 60_000) {
  if (timer) return;

  let billingCounter = 0;

  const tick = async () => {
    // Roughly hourly at the default interval.
    const billing = ++billingCounter >= 60;
    if (billing) billingCounter = 0;

    // Wrapped so that "this worker has not run" is a visible state rather than
    // an absence of log lines. `processSweepBatch` swallows each sweep's own
    // errors by design, so the heartbeat records the TICK happening; per-sweep
    // failures stay in the log.
    const result = await recordWorkerRun('sweeps', () =>
      processSweepBatch({ billing }),
    );

    // Quiet when there is nothing to do, which is most ticks. A sweep that
    // logged every minute would bury the one line that matters.
    if (
      result.offers?.expired ||
      result.holds?.holdsReleased ||
      result.subscriptions?.suspendedTrials ||
      result.subscriptions?.suspendedGrace
    ) {
      logger.info(result, 'Sweep batch');
    }
  };

  timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  logger.info({ intervalMs }, 'Sweep worker started');
}

export function stopSweepWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
