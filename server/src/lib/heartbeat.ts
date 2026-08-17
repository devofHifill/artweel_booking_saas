import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Worker heartbeats.
 *
 * Wraps one tick of a background worker and records that it happened. The point
 * is not to detect a *crashed* worker — a crashed process is loud. It is to
 * detect a worker that is not running at all while everything looks fine, which
 * is what happened in C2.1: three sweeps written, tested, and called by nothing
 * for two days, with health green the whole time.
 *
 * A WRAPPER rather than two calls the worker makes itself, so a tick cannot stamp
 * its start and then forget to stamp its finish — which would read, permanently,
 * as a worker stuck mid-run.
 */

/**
 * The workers that are SUPPOSED to exist, with how often each should run.
 *
 * This list is the other half of the C2.1 lesson. A health endpoint that reports
 * on whatever rows happen to be in the table can only ever say "these workers ran"
 * — it can never say "the sweep worker has never run once", because a worker that
 * was never started leaves no row to report on. Naming them here means absence is
 * itself a reportable state.
 *
 * `expectedIntervalMs` must match what `server.ts` actually passes.
 */
export const EXPECTED_WORKERS = {
  notifications: { expectedIntervalMs: 5_000 },
  calendar: { expectedIntervalMs: 10_000 },
  sweeps: { expectedIntervalMs: 60_000 },
} as const;

export type WorkerName = keyof typeof EXPECTED_WORKERS;

/**
 * Runs one tick and records it.
 *
 * Heartbeat failures are swallowed and logged, never thrown. This is the exact
 * opposite of the audit log's contract, and deliberately so: an audit row that
 * cannot be written must abort the action it describes, because the record is
 * part of the point. A heartbeat is only ever a report ABOUT the work, so
 * letting a failed report kill a notification send would mean observability
 * causing the outage it was installed to reveal.
 */
export async function recordWorkerRun<T>(
  name: WorkerName,
  tick: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date();
  await stamp(name, { lastStartedAt: startedAt });

  try {
    const result = await tick();

    await stamp(name, {
      lastFinishedAt: new Date(),
      runs: { increment: 1 },
    });

    return result;
  } catch (err) {
    await stamp(name, {
      lastFinishedAt: new Date(),
      runs: { increment: 1 },
      failures: { increment: 1 },
      lastError: err instanceof Error ? err.message.slice(0, 500) : String(err),
      lastErrorAt: new Date(),
    });

    // Rethrown: the worker's own loop decides what a failed tick means. This
    // function only records.
    throw err;
  }
}

type Stamp = {
  lastStartedAt?: Date;
  lastFinishedAt?: Date;
  lastError?: string;
  lastErrorAt?: Date;
  runs?: { increment: number };
  failures?: { increment: number };
};

async function stamp(name: WorkerName, data: Stamp) {
  try {
    await prisma.workerHeartbeat.upsert({
      where: { name },
      // On create there is nothing to increment from, so the counters are
      // seeded rather than incremented.
      create: {
        name,
        lastStartedAt: data.lastStartedAt ?? null,
        lastFinishedAt: data.lastFinishedAt ?? null,
        lastError: data.lastError ?? null,
        lastErrorAt: data.lastErrorAt ?? null,
        runs: data.runs ? data.runs.increment : 0,
        failures: data.failures ? data.failures.increment : 0,
      },
      update: data,
    });
  } catch (err) {
    logger.warn({ err, worker: name }, 'Could not record worker heartbeat');
  }
}
