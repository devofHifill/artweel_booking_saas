import { createApp } from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import {
  startNotificationWorker,
  stopNotificationWorker,
} from './modules/notifications/worker';
import {
  startCalendarWorker,
  stopCalendarWorker,
} from './modules/calendar/calendar.worker';
import { startSweepWorker, stopSweepWorker } from './workers/sweep.worker';

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, env: config.NODE_ENV },
    'Scheduling core listening',
  );
});

/**
 * The outbox drainer runs in-process for now.
 *
 * It is safe to run several of these — claiming uses FOR UPDATE SKIP LOCKED —
 * so this can be pulled out into its own container the day the API needs to
 * scale independently of message volume, with no code change.
 */
startNotificationWorker();
startCalendarWorker();

/**
 * Expiry. Without this nothing in the system ever notices that a deadline
 * passed — trials run forever and an ignored waitlist offer holds its seat
 * indefinitely, because the seat is really taken the moment the offer is made.
 */
startSweepWorker();

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests
 * finish, then close the database pool. A booking write killed mid-transaction
 * is exactly the kind of thing that produces phantom reservations.
 */
async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  // Awaited: stopping only clears the interval, so a tick already inside a
  // transaction is still running. Closing the pool underneath one is the
  // mid-transaction kill this shutdown path exists to avoid. The 10s failsafe
  // below still applies if a tick will not finish.
  await Promise.all([
    stopNotificationWorker(),
    stopCalendarWorker(),
    stopSweepWorker(),
  ]);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
