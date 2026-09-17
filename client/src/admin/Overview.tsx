import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import {
  money,
  type BookingVolume,
  type Health,
  type Metrics,
  type Insights,
  type MrrHistory,
  type PlatformGrowth,
} from './types';
import { Icon, type IconName } from '../components/Icon';
import MrrPanel from './MrrPanel';
import HealthPanel from './HealthPanel';
import { BookingVolumePanel, GrowthPanel } from './GrowthPanel';
import {
  ActivityPanel,
  GeographyPanel,
  NeedsAttentionPanel,
  PlanDistributionPanel,
  RevenueModelPanel,
} from './InsightPanels';
import { LoadingRegion, SkeletonStats, SkeletonList } from '../components/states';

/**
 * The platform landing screen — "Dashboard" in the sidebar.
 *
 * Eight headline cards, then the actionable lists. Every tile links through to
 * the rows behind it: a count you cannot open is a count you cannot act on.
 *
 * WHAT IS NOT HERE, and why. The prototype this was drawn from carried a Churn
 * card (2.8%) and a net-revenue-retention line (108.6%). Neither is on screen,
 * because neither can be computed: the platform stores only current state — no
 * MRR history, no subscription-event log — so "what churned last month" has
 * nothing to read from. Rather than print a number nothing measures, the eighth
 * card is the churn LEADING indicator that IS real: studios that have gone quiet.
 *
 * For the same reason only three cards carry a delta. Bookings, GMV and new
 * studios are each dated at the row level, so a window can be compared to the
 * one before it. How many studios are ACTIVE, or what MRR is, are facts about
 * this instant with no recorded past — so those cards state the number and stop,
 * rather than inventing a trend.
 */

const RANGES = [
  { label: 'Today', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
] as const;

type Range =
  | { kind: 'preset'; days: number; label: string }
  | { kind: 'custom'; from: string; to: string };

export default function Overview() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [mrr, setMrr] = useState<MrrHistory | null>(null);
  const [growth, setGrowth] = useState<PlatformGrowth | null>(null);
  const [volume, setVolume] = useState<BookingVolume | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>({
    kind: 'preset',
    days: 30,
    label: '30 days',
  });
  const [refreshing, setRefreshing] = useState(false);
  /* Bumped by Refresh to force a refetch without changing the range. */
  const [nonce, setNonce] = useState(0);

  const query = useMemo(() => {
    if (range.kind === 'custom') {
      if (!range.from || !range.to) return '';
      return `?from=${range.from}&to=${range.to}`;
    }
    return `?days=${range.days}`;
  }, [range]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [m, h, r, g, i] = await Promise.all([
        api.get<{ metrics: Metrics }>(`/api/platform/metrics${query}`),
        api.get<{ health: Health }>('/api/platform/health'),
        api.get<{ history: MrrHistory }>('/api/platform/mrr?days=365'),
        api.get<{ growth: PlatformGrowth; volume: BookingVolume }>(
          '/api/platform/growth?months=12',
        ),
        api.get<Insights>('/api/platform/insights'),
      ]);
      setMetrics(m.metrics);
      setHealth(h.health);
      setMrr(r.history);
      setGrowth(g.growth);
      setVolume(g.volume);
      setInsights(i);
      setError(null);
    } catch {
      setError('Could not load the overview.');
    } finally {
      setRefreshing(false);
    }
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load, nonce]);

  function exportCsv() {
    if (!metrics) return;
    const rows = metricRows(metrics);
    const csv = [
      'Metric,Value',
      ...rows.map((r) => `${csvCell(r.label)},${csvCell(r.plain)}`),
    ].join('\r\n');

    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `artweel-platform-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) return <div className="err">{error}</div>;
  if (!metrics || !health)
    return (
      <LoadingRegion label="Loading the platform overview">
        <SkeletonStats />
        <SkeletonList count={2} lines={3} />
      </LoadingRegion>
    );

  const { studios, trials, subscriptionRevenue, window: w } = metrics;
  const activePct =
    studios.total > 0
      ? Math.round((subscriptionRevenue.payingStudios / studios.total) * 100)
      : 0;
  const arrCents = subscriptionRevenue.mrrCents * 12;

  return (
    <>
      <div className="page-head ov-head">
        <div>
          <h1>Platform Overview</h1>
          <p className="sub">Monitor Artweel&rsquo;s entire booking ecosystem.</p>
        </div>

        <div className="ov-controls">
          <div className="ov-ranges" role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                className={
                  range.kind === 'preset' && range.days === r.days
                    ? 'is-active'
                    : ''
                }
                onClick={() =>
                  setRange({ kind: 'preset', days: r.days, label: r.label })
                }
              >
                {r.label}
              </button>
            ))}
            <button
              type="button"
              className={range.kind === 'custom' ? 'is-active' : ''}
              onClick={() =>
                setRange((prev) =>
                  prev.kind === 'custom'
                    ? prev
                    : { kind: 'custom', from: '', to: '' },
                )
              }
            >
              Custom
            </button>
          </div>

          <button type="button" className="ov-btn" onClick={exportCsv}>
            <Icon name="download" size={16} />
            Export
          </button>
          <button
            type="button"
            className="ov-btn primary"
            onClick={() => setNonce((n) => n + 1)}
            disabled={refreshing}
          >
            <Icon name="refund" size={16} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {range.kind === 'custom' && (
        <div className="ov-custom">
          <label>
            From
            <input
              type="date"
              value={range.from}
              max={range.to || undefined}
              onChange={(e) =>
                setRange({ kind: 'custom', from: e.target.value, to: range.to })
              }
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={range.to}
              min={range.from || undefined}
              onChange={(e) =>
                setRange({ kind: 'custom', from: range.from, to: e.target.value })
              }
            />
          </label>
          {(!range.from || !range.to) && (
            <span className="sub">Pick both dates to apply.</span>
          )}
        </div>
      )}

      {/*
        Health strip on the landing screen, not only on its own page: the C2.1
        failure was silent for two days, and a page nobody navigates to is a
        page nobody sees.
      */}
      {health.degraded && (
        <div className="alert danger">
          Background work needs attention.{' '}
          <Link to="/admin/health">See health</Link>
        </div>
      )}

      <section className="ov-grid">
        <Card
          icon="studios"
          label="Total Studios"
          value={String(studios.total)}
          delta={w.studiosDeltaPct}
          sub={`${w.studiosNew} new in ${w.days} day${w.days === 1 ? '' : 's'}`}
          onClick={() => navigate('/admin/studios')}
        />
        <Card
          icon="studio"
          label="Active Studios"
          value={String(subscriptionRevenue.payingStudios)}
          sub={`${activePct}% of platform`}
          onClick={() => navigate('/admin/studios?status=ACTIVE')}
        />
        <Card
          icon="today"
          label="Trial Studios"
          value={String(studios.byStatus.TRIALING)}
          sub="14-day trial · no card required"
          onClick={() => navigate('/admin/studios?status=TRIALING')}
        />
        <Card
          icon="plan"
          label="Monthly Recurring Revenue"
          value={money(subscriptionRevenue.mrrCents)}
          sub={`${money(arrCents)} ARR`}
        />
        <Card
          icon="bookings"
          label="Bookings"
          value={w.bookings.toLocaleString('en-US')}
          delta={w.bookingsDeltaPct}
          sub={`across ${w.bookingsAcrossStudios} studio${
            w.bookingsAcrossStudios === 1 ? '' : 's'
          }`}
        />
        <Card
          icon="money"
          label="GMV"
          value={money(w.gmvCents)}
          delta={w.gmvDeltaPct}
          sub="processed on studio accounts"
        />
        <Card
          icon="refund"
          label="Platform Payments"
          value={money(w.platformPaymentsCents)}
          sub="0% commission — direct charges"
        />
        {/*
          Where the prototype showed Churn. This is the real, computed leading
          indicator instead — studios that have gone quiet — labelled as what it
          is rather than dressed up as a churn rate nothing measures.
        */}
        <Card
          icon="customers"
          label="At-risk studios"
          value={String(studios.idle30Days)}
          sub="no booking in 30 days"
          onClick={() => navigate('/admin/studios')}
        />
      </section>

      {/*
        The chart and the health panel, side by side. The chart is the wider of
        the two because a line needs width to be a line, while the health list
        is a column of short rows.
      */}
      {/*
        What needs a person, first — before any chart.

        The two action lists sit together at the top because an operator opens
        this page to find out what is wrong, not to read MRR history. They were
        sixth and eleventh, below four charts, purely because that is the order
        they were built in.
      */}
      <section className="ov-panels even">
        <NeedsAttentionPanel attention={insights?.attention ?? null} />
        <div className="card">
          <h2>Lifecycle watchlist</h2>
          <p className="sub">
            Studios drifting through the funnel — distinct from the faults in
            Needs Attention beside it.
          </p>
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
      </section>

      <section className="ov-panels">
        <MrrPanel
          history={mrr}
          currentMrrCents={subscriptionRevenue.mrrCents}
        />
        <HealthPanel health={health} />
      </section>

      {/* The two historical charts. Equal width: both are time series read the
          same way, unlike the MRR row where one side is a list. */}
      <section className="ov-panels even">
        <GrowthPanel growth={growth} />
        <BookingVolumePanel volume={volume} />
      </section>

      {/* Plan mix, geography and the action list: three columns, because each
          is a short list rather than a chart needing width. */}
      {/* Composition: what the platform is made of. */}
      <section className="ov-panels three">
        <PlanDistributionPanel plans={insights?.plans ?? null} />
        <GeographyPanel geography={insights?.geography ?? null} />
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

      <section className="ov-panels">
        <ActivityPanel activity={insights?.activity ?? null} />
        <RevenueModelPanel revenue={insights?.revenueModel ?? null} />
      </section>

    </>
  );
}

function Card({
  icon,
  label,
  value,
  sub,
  delta,
  onClick,
}: {
  icon: IconName;
  label: string;
  value: string;
  sub: string;
  /** undefined = a point-in-time metric with no honest delta; null = a windowed
   *  one whose prior window was empty (shown as "new"). */
  delta?: number | null;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="ov-card-top">
        <span className="ov-card-icon">
          <Icon name={icon} size={16} />
        </span>
        <span className="ov-card-label">{label}</span>
      </div>
      <div className="ov-card-value">{value}</div>
      <div className="ov-card-foot">
        {delta !== undefined && <Delta pct={delta} />}
        <span className="ov-card-sub">{sub}</span>
      </div>
    </>
  );

  /*
    A div, not a <button>, even when clickable. A <button> made a flex-column
    container collapses to its header instead of growing to fit its children —
    the value and footer then spill outside the card box. Kept a real control
    for the keyboard and screen readers via role/tabIndex and an Enter/Space
    handler rather than the element type.
  */
  if (!onClick) return <div className="card ov-card">{inner}</div>;

  return (
    <div
      className="card ov-card ov-card-button"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {inner}
    </div>
  );
}

/** Green up, red down, and "new" when there is no prior window to divide by. */
function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="ov-delta new">new</span>;
  const up = pct >= 0;
  return (
    <span className={`ov-delta ${up ? 'up' : 'down'}`}>
      <Icon name="chevron" size={12} />
      {up ? '+' : ''}
      {pct}%
    </span>
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

/** The rows the CSV export writes — label plus a plain, unformatted value. */
function metricRows(m: Metrics) {
  const arr = m.subscriptionRevenue.mrrCents * 12;
  return [
    { label: 'Total studios', plain: String(m.studios.total) },
    { label: 'Active studios', plain: String(m.subscriptionRevenue.payingStudios) },
    { label: 'Trial studios', plain: String(m.studios.byStatus.TRIALING) },
    { label: 'MRR', plain: money(m.subscriptionRevenue.mrrCents) },
    { label: 'ARR', plain: money(arr) },
    { label: `Bookings (${m.window.days}d)`, plain: String(m.window.bookings) },
    { label: `GMV (${m.window.days}d)`, plain: money(m.window.gmvCents) },
    { label: 'Platform payments', plain: money(m.window.platformPaymentsCents) },
    { label: 'At-risk studios (no booking 30d)', plain: String(m.studios.idle30Days) },
  ];
}

/** Quote a CSV cell, and defuse a leading =/+/-/@ so a spreadsheet cannot run it. */
function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
