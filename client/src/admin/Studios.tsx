import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, tokens } from '../lib/api';
import {
  money,
  relativeDays,
  shortDate,
  type PlanId,
  type StudioList,
  type StudioRow,
  type SubscriptionStatus,
} from './types';
import { Icon } from '../components/Icon';
import { LoadingRegion, SkeletonTable } from '../components/states';

const STATUSES: SubscriptionStatus[] = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELED',
];

const PLANS: PlanId[] = ['SOLO', 'STUDIO', 'PRO'];

const CREATED = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '12m', label: 'Last 12 months' },
];

const STRIPE = [
  { value: 'connected', label: 'Connected' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'none', label: 'Not connected' },
];

/**
 * Every studio on the platform.
 *
 * Filters live in the URL rather than in component state, so a tile on the
 * dashboard can link straight to a filtered list and an operator can share or
 * bookmark "the studios I was looking at".
 *
 * The counts above the table describe the PLATFORM and deliberately do not
 * follow the filters: a strip that moved every time somebody typed would stop
 * being the reference point the rest of the screen is read against.
 */
export default function Studios() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<StudioList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get('search') ?? '');

  const query = params.toString();

  useEffect(() => {
    let cancelled = false;
    setError(null);

    api
      .get<StudioList>(`/api/platform/organizations${query ? `?${query}` : ''}`)
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setError('Could not load studios.'));

    return () => {
      cancelled = true;
    };
  }, [query]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Any filter change invalidates the page you were on.
    next.delete('offset');
    setParams(next);
  }

  /*
    Exports whatever is on screen, filters included. The download goes through
    fetch rather than a bare link because the endpoint is behind the platform
    guard and a plain <a> carries no Authorization header.
  */
  async function exportCsv() {
    const q = new URLSearchParams(params);
    q.delete('limit');
    q.delete('offset');

    const res = await fetch(
      `/api/platform/organizations/export.csv${q.toString() ? `?${q}` : ''}`,
      { headers: { Authorization: `Bearer ${tokens.access ?? ''}` } },
    );
    if (!res.ok) {
      setError('Could not export.');
      return;
    }

    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `artweel-studios-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const page = data ? Math.floor(data.offset / data.limit) + 1 : 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <div className="page-head studios-head">
        <div>
          <h1>Studios</h1>
          <p className="sub">
            Every organisation on the Artweel platform. Each studio is an
            isolated tenant.
          </p>
        </div>

        <button type="button" className="ov-btn" onClick={exportCsv}>
          <Icon name="download" size={16} />
          Export CSV
        </button>
      </div>

      {data && <SummaryStrip summary={data.summary} onPick={update} />}

      <div className="studio-filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update('search', search.trim());
          }}
        >
          <input
            type="search"
            placeholder="Search studios and owners…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search studios"
          />
        </form>

        <Select
          label="Plan"
          value={params.get('plan') ?? ''}
          onChange={(v) => update('plan', v)}
          options={PLANS.map((p) => ({ value: p, label: p.toLowerCase() }))}
        />
        <Select
          label="Status"
          value={params.get('status') ?? ''}
          onChange={(v) => update('status', v)}
          options={STATUSES.map((s) => ({
            value: s,
            label: s.toLowerCase().replace('_', ' '),
          }))}
        />
        <Select
          label="Country"
          value={params.get('country') ?? ''}
          onChange={(v) => update('country', v)}
          options={(data?.availableCountries ?? []).map((c) => ({
            value: c,
            label: c,
          }))}
        />
        <Select
          label="Created"
          value={params.get('created') ?? ''}
          onChange={(v) => update('created', v)}
          options={CREATED}
        />
        <Select
          label="Stripe"
          value={params.get('stripe') ?? ''}
          onChange={(v) => update('stripe', v)}
          options={STRIPE}
        />
      </div>

      {error && <div className="err">{error}</div>}

      {!data && !error && (
        <LoadingRegion label="Loading studios">
          <SkeletonTable rows={8} />
        </LoadingRegion>
      )}

      {data && data.studios.length === 0 && (
        <p className="sub">No studio matches these filters.</p>
      )}

      {data && data.studios.length > 0 && (
        <div className="table-wrap">
          <table className="admin-table studio-table">
            <thead>
              <tr>
                <SortHeader
                  label="Studio"
                  field="name"
                  data={data}
                  onSort={update}
                />
                <th>Owner</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Locations</th>
                <th>Instructors</th>
                <th>Bookings</th>
                <th>MRR</th>
                <SortHeader
                  label="Trial ends"
                  field="trialEndsAt"
                  data={data}
                  onSort={update}
                />
                <SortHeader
                  label="Created"
                  field="createdAt"
                  data={data}
                  onSort={update}
                />
              </tr>
            </thead>
            <tbody>
              {data.studios.map((studio) => (
                <Row key={studio.id} studio={studio} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.studios.length > 0 && (
        <div className="studio-foot">
          <span className="sub">
            Showing <strong>{data.offset + 1}–
            {Math.min(data.offset + data.limit, data.total)}</strong> of{' '}
            {data.total}
          </span>

          <div className="pager">
            <button
              type="button"
              disabled={page === 1}
              onClick={() =>
                update('offset', String(Math.max(data.offset - data.limit, 0)))
              }
              aria-label="Previous page"
            >
              ‹
            </button>
            <span className="sub">
              Page {page} of {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => update('offset', String(data.offset + data.limit))}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The platform at a glance. Each tile filters the table to what it counts —
 * a number you cannot open into the rows behind it is a number you cannot act
 * on.
 */
function SummaryStrip({
  summary,
  onPick,
}: {
  summary: StudioList['summary'];
  onPick: (key: string, value: string) => void;
}) {
  const tiles = [
    {
      label: 'Total studios',
      value: summary.total,
      sub: `${summary.addedLast30Days} added in 30 days`,
      status: '',
    },
    {
      label: 'Active',
      value: summary.active,
      sub: `${summary.activePct}% of platform`,
      status: 'ACTIVE',
    },
    {
      label: 'Trial',
      value: summary.trialing,
      sub: '14-day trial, no card',
      status: 'TRIALING',
    },
    {
      label: 'Past due',
      value: summary.pastDue,
      sub: 'Grace period, still live',
      status: 'PAST_DUE',
    },
    {
      label: 'Suspended',
      value: summary.suspended,
      sub: 'Not taking bookings',
      status: 'SUSPENDED',
    },
    {
      /* No time qualifier: nothing records WHEN a studio cancelled, so
         "in the last 12 months" is a claim this data cannot support. */
      label: 'Cancelled',
      value: summary.cancelled,
      sub: 'All time',
      status: 'CANCELED',
    },
  ];

  return (
    <section className="studio-strip">
      {tiles.map((t) => (
        <button
          key={t.label}
          type="button"
          className="card studio-stat"
          onClick={() => onPick('status', t.status)}
        >
          <span className="studio-stat-label">{t.label}</span>
          <span className="studio-stat-value">{t.value}</span>
          <span className="studio-stat-sub">{t.sub}</span>
        </button>
      ))}
    </section>
  );
}

function Row({ studio }: { studio: StudioRow }) {
  return (
    <tr>
      <td>
        <div className="studio-cell">
          <span className="studio-avatar" aria-hidden>
            {initials(studio.name)}
          </span>
          <span>
            <Link to={`/admin/studios/${studio.id}`}>{studio.name}</Link>
            <div className="sub">{studio.country}</div>
            {!studio.onboardingComplete && (
              <span className="tag">setup unfinished</span>
            )}
          </span>
        </div>
      </td>

      <td>
        {studio.owner ? (
          <>
            {studio.owner.name}
            <div className="sub">{studio.owner.email}</div>
          </>
        ) : (
          <span className="muted">no owner</span>
        )}
      </td>

      <td>
        <span className="tag">{studio.plan.toLowerCase()}</span>
      </td>

      <td>
        <StatusTag status={studio.subscriptionStatus} />
      </td>

      <td>
        <Usage used={studio.counts.locations} limit={studio.limits.maxLocations} />
      </td>
      <td>
        <Usage used={studio.counts.staff} limit={studio.limits.maxStaff} />
      </td>

      <td>{studio.counts.bookings.toLocaleString('en-US')}</td>

      <td>
        {studio.mrrCents === null ? (
          <span className="muted">—</span>
        ) : (
          <>
            {money(studio.mrrCents)}
            <span className="sub">/mo</span>
          </>
        )}
      </td>

      <td>
        {studio.subscriptionStatus === 'TRIALING' && studio.trialEndsAt ? (
          <>
            {shortDate(studio.trialEndsAt)}
            <div className="sub">{relativeDays(studio.trialEndsAt)}</div>
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </td>

      <td>{shortDate(studio.createdAt)}</td>
    </tr>
  );
}

/**
 * "4 / 5", amber once the studio is at or one short of the limit.
 *
 * The colour is the point: this column exists so an operator can see who is
 * about to hit a wall, and a plain number makes that scan impossible.
 */
function Usage({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) {
    return (
      <span>
        {used} <span className="muted">/ ∞</span>
      </span>
    );
  }

  const tight = used >= limit - 1;
  return (
    <span className={tight ? 'usage-tight' : undefined}>
      {used} <span className="muted">/ {limit}</span>
    </span>
  );
}

/** Two letters from the studio name, for the row's badge. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

function SortHeader({
  label,
  field,
  data,
  onSort,
}: {
  label: string;
  field: string;
  data: StudioList;
  onSort: (key: string, value: string) => void;
}) {
  const active = data.sortedBy === field;
  return (
    <th>
      <button
        type="button"
        className="sort-header"
        onClick={() => {
          onSort('sort', field);
          onSort('direction', active && data.direction === 'asc' ? 'desc' : 'asc');
        }}
        aria-label={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span className={`sort-caret${active ? ' is-active' : ''}`}>
          {active && data.direction === 'desc' ? '▾' : '▴'}
        </span>
      </button>
    </th>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="studio-filter">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StatusTag({ status }: { status: SubscriptionStatus }) {
  const tone =
    status === 'ACTIVE'
      ? 'ok'
      : status === 'TRIALING'
        ? 'info'
        : status === 'PAST_DUE'
          ? 'warn'
          : 'danger';

  return (
    <span className={`tag tag-${tone}`}>
      {status.toLowerCase().replace('_', ' ')}
    </span>
  );
}
