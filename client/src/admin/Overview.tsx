import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { money, type Health, type Metrics } from './types';

/**
 * The landing screen.
 *
 * Every tile links through to the rows behind it. A count you cannot open is a
 * count you cannot act on — "4 trials expiring this week" is only useful if the
 * next click is the list of those four studios.
 */
export default function Overview() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      api.get<{ metrics: Metrics }>('/api/platform/metrics'),
      api.get<{ health: Health }>('/api/platform/health'),
    ])
      .then(([m, h]) => {
        if (cancelled) return;
        setMetrics(m.metrics);
        setHealth(h.health);
      })
      .catch(() => !cancelled && setError('Could not load the overview.'));

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="err">{error}</div>;
  if (!metrics || !health) return <div className="empty">Loading…</div>;

  const { studios, trials, subscriptionRevenue, studioBookingVolume } = metrics;

  return (
    <>
      <div className="page-head">
        <h1>Overview</h1>
      </div>

      {/*
        The health strip. Sits on the landing screen rather than only on its own
        page, because the C2.1 failure was silent for two days — something that
        has to be navigated to is something nobody navigates to.
      */}
      {health.degraded && (
        <div className="alert danger">
          Background work needs attention.{' '}
          <Link to="/admin/health">See health</Link>
        </div>
      )}

      <section className="stats">
        <Tile
          label="Studios"
          value={studios.total}
          onClick={() => navigate('/admin/studios')}
        />
        <Tile
          label="Paying"
          value={subscriptionRevenue.payingStudios}
          onClick={() => navigate('/admin/studios?status=ACTIVE')}
        />
        <Tile
          label="Trialing"
          value={studios.byStatus.TRIALING}
          onClick={() => navigate('/admin/studios?status=TRIALING')}
        />
        <Tile
          label="Suspended"
          value={studios.byStatus.SUSPENDED}
          onClick={() => navigate('/admin/studios?status=SUSPENDED')}
        />
      </section>

      <section className="cards-2">
        <div className="card">
          <h2>Our revenue</h2>
          <p className="figure">{money(subscriptionRevenue.mrrCents)}</p>
          <p className="sub">
            MRR from {subscriptionRevenue.payingStudios} active subscription
            {subscriptionRevenue.payingStudios === 1 ? '' : 's'}. Trials and
            past-due studios are not counted.
          </p>
        </div>

        {/*
          Deliberately a separate card with its own heading, never a tile beside
          MRR. These are two unrelated numbers: Connect charges are direct with
          the studio as merchant of record, so this money never touches our
          balance. Showing them adjacent and unlabelled would overstate the
          business by roughly the size of the customer base.
        */}
        <div className="card">
          <h2>Studio volume</h2>
          <p className="figure muted">
            {money(studioBookingVolume.last30DaysCents)}
          </p>
          <p className="sub">
            Paid to studios by their own customers, last 30 days (
            {studioBookingVolume.payments} payment
            {studioBookingVolume.payments === 1 ? '' : 's'}).{' '}
            <strong>Not platform revenue.</strong>
          </p>
        </div>
      </section>

      <section className="cards-2">
        <div className="card">
          <h2>Needs a look</h2>
          <ul className="list">
            <ActionRow
              label="Trials expiring within 7 days"
              value={trials.expiringWithin7Days}
              to="/admin/studios?status=TRIALING&sort=trialEndsAt&direction=asc"
            />
            <ActionRow
              label="Signed up, never finished setup"
              value={studios.stalledInOnboarding}
              to="/admin/studios"
            />
            <ActionRow
              label="No booking in 30 days"
              value={studios.idle30Days}
              to="/admin/studios"
            />
            <ActionRow
              label="Trials that lapsed without converting"
              value={trials.lapsedWithoutConverting}
              to="/admin/studios?status=SUSPENDED"
            />
          </ul>
        </div>

        <div className="card">
          <h2>Signups</h2>
          {metrics.signups.byWeek.length === 0 ? (
            <p className="sub">No signups in the last 12 weeks.</p>
          ) : (
            <>
              <ul className="list">
                {metrics.signups.byWeek.slice(-6).map((week) => (
                  <li key={week.week} className="row-head">
                    <span>
                      week of{' '}
                      {new Date(week.week).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <strong>{week.count}</strong>
                  </li>
                ))}
              </ul>

              <p className="sub" style={{ marginTop: 10 }}>
                {trials.conversionRate === null
                  ? 'No trial has finished yet, so there is no conversion rate to report.'
                  : `${Math.round(trials.conversionRate * 100)}% of finished trials converted.`}
              </p>

              {metrics.signups.bySource.length > 0 && (
                <p className="sub">
                  Sources:{' '}
                  {metrics.signups.bySource
                    .map((s) => `${s.source} (${s.count})`)
                    .join(', ')}
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}

function Tile({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick: () => void;
}) {
  // Matches the dashboard's existing `card stat` markup (`.label` / `.value`)
  // rather than introducing a second way to draw the same tile.
  return (
    <button className="card stat stat-button" onClick={onClick}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </button>
  );
}

function ActionRow({
  label,
  value,
  to,
}: {
  label: string;
  value: number;
  to: string;
}) {
  return (
    <li className="row-head">
      <span>{label}</span>
      {value === 0 ? (
        <strong className="muted">0</strong>
      ) : (
        <Link to={to}>
          <strong>{value}</strong>
        </Link>
      )}
    </li>
  );
}
