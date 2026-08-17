import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  dateTime,
  type Health as HealthData,
  type QueueHealth,
  type WorkerHealth,
} from './types';

/**
 * Are the background workers running, and are the queues draining.
 *
 * Deliberately not a liveness page. The failure this exists for is C2.1: three
 * sweeps written, tested, and called by nothing for two days, while every health
 * check stayed green and every route returned 200. So the two things shown are
 * "has each worker run recently" and "is work piling up that should already have
 * been done" — the second being the one that stays true even if a heartbeat lies.
 */
export default function Health() {
  const [data, setData] = useState<HealthData | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = () =>
      api
        .get<{ health: HealthData }>('/api/platform/health')
        .then((res) => {
          if (cancelled) return;
          setData(res.health);
          // Cleared on every success. Without this the first blip would leave the
          // page reading "could not load" for the rest of the session while the
          // polls behind it quietly succeeded — which is how this was found: a
          // dev-server restart mid-poll, and the error never went away.
          setStale(false);
        })
        .catch(() => !cancelled && setStale(true));

    void load();

    // Workers tick every few seconds, so a static snapshot goes stale while you
    // are looking at it — which is exactly the wrong impression for this page.
    const timer = setInterval(() => void load(), 10_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!data) {
    return stale ? (
      <div className="err">Could not load health.</div>
    ) : (
      <div className="empty">Loading…</div>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Health</h1>
        <span className="sub">checked {dateTime(data.checkedAt)}</span>
      </div>

      {/*
        A failed refresh keeps the last known numbers on screen and says they are
        old, rather than throwing them away. On a monitoring page the previous
        reading is still the most useful thing available.
      */}
      {stale && (
        <div className="alert warn">
          Could not refresh — the figures below are from{' '}
          {dateTime(data.checkedAt)}.
        </div>
      )}

      {data.degraded ? (
        <div className="alert danger">
          Something is not doing its job. Details below.
        </div>
      ) : (
        <div className="alert ok">
          Workers are running and nothing is waiting that should not be.
        </div>
      )}

      <section className="card">
        <h2>Workers</h2>
        <ul className="list">
          {data.workers.map((worker) => (
            <WorkerRow key={worker.name} worker={worker} />
          ))}
        </ul>
      </section>

      <section className="cards-2">
        <div className="card">
          <h2>Queues</h2>
          {/*
            Overdue is listed above pending, and pending is explained. A queue
            holding 32 reminders scheduled for next week is working perfectly, and
            an operator who reads that as a backlog will go looking for a fault
            that is not there.
          */}
          <QueueRows label="Notifications" queue={data.queues.notifications} />
          <QueueRows label="Calendar sync" queue={data.queues.calendar} />
        </div>

        <div className="card">
          <h2>Work that should already be done</h2>
          <p className="sub">
            These climb whatever the worker rows above claim. A seat held for
            somebody who never replied is what C2.1 left in the database for two
            days.
          </p>
          <ul className="list">
            <li className="row-head">
              <span>Waitlist offers held</span>
              <strong>{data.unswept.waitlistOffersHeld}</strong>
            </li>
            <li className="row-head">
              <span>Waitlist offers past expiry</span>
              <strong className={data.unswept.waitlistOffersOverdue ? 'bad' : 'ok'}>
                {data.unswept.waitlistOffersOverdue}
              </strong>
            </li>
            <li className="row-head">
              <span>Expired holds still open</span>
              <strong className={data.unswept.expiredHoldsStillOpen ? 'bad' : 'ok'}>
                {data.unswept.expiredHoldsStillOpen}
              </strong>
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}

function QueueRows({ label, queue }: { label: string; queue: QueueHealth }) {
  return (
    <div className="queue-block">
      <h3>{label}</h3>
      <ul className="list">
        <li className="row-head">
          <span>Overdue (should have gone out)</span>
          <strong className={queue.overdue ? 'bad' : 'ok'}>{queue.overdue}</strong>
        </li>
        <li className="row-head">
          <span>Failed</span>
          <strong className={queue.failed ? 'bad' : 'muted'}>{queue.failed}</strong>
        </li>
        <li className="row-head">
          <span>
            Waiting
            <div className="sub">scheduled ahead — not a backlog</div>
          </span>
          <strong className="muted">{queue.pending}</strong>
        </li>
        <li className="row-head">
          <span>Next one due</span>
          <strong className="muted">{dateTime(queue.nextScheduledFor)}</strong>
        </li>
      </ul>
    </div>
  );
}

function WorkerRow({ worker }: { worker: WorkerHealth }) {
  const label: Record<WorkerHealth['state'], string> = {
    ok: 'running',
    late: 'late',
    'never-run': 'has never run',
    failing: 'failing',
  };

  const tone = worker.state === 'ok' ? 'ok' : 'bad';

  return (
    <li className="worker-row">
      <div className="row-head">
        <span>
          <strong>{worker.name}</strong>
          <div className="sub">
            expected every {Math.round(worker.expectedIntervalMs / 1000)}s ·{' '}
            {worker.runs} run{worker.runs === 1 ? '' : 's'}
            {worker.failures > 0 && `, ${worker.failures} failed`}
          </div>
        </span>
        <span className={`tag tag-${tone === 'ok' ? 'ok' : 'danger'}`}>
          {label[worker.state]}
        </span>
      </div>

      {/*
        "Has never run" gets its own explanation, because it is the state that
        looks like a missing feature and is actually the most serious one
        available — a worker nothing started.
      */}
      {worker.state === 'never-run' && (
        <p className="sub">
          No tick has ever completed. Either the process was started without it or
          it has thrown on every attempt since boot.
        </p>
      )}

      {worker.state === 'late' && (
        <p className="sub">
          Last finished {worker.secondsSinceLastRun}s ago, which is several
          intervals.
        </p>
      )}

      {worker.lastError && (
        <p className="sub bad">
          Last error {dateTime(worker.lastErrorAt)}: {worker.lastError}
        </p>
      )}
    </li>
  );
}
