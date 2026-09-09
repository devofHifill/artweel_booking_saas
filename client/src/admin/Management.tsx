import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { dateTime, money } from './types';
import { LoadingRegion, SkeletonTable } from '../components/states';

/**
 * Platform management: the webhook log, integration status, and the plan
 * matrix.
 *
 * All read-only. The plan matrix in particular is read-only for a reason worth
 * stating on the screen: prices live in code that the marketing site and Stripe
 * checkout also read, so an editable copy here is how the advertised price and
 * the charged price come apart.
 */

// --- Webhooks --------------------------------------------------------------

type WebhookRow = {
  id: string;
  provider: string;
  eventId: string;
  eventType: string;
  processedAt: string | null;
  error: string | null;
  createdAt: string;
  organization: { id: string; name: string } | null;
};

type WebhookList = {
  rows: WebhookRow[];
  total: number;
  limit: number;
  offset: number;
  failedLast24h: number;
  note: string;
};

export function PlatformWebhooks() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<WebhookList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get('search') ?? '');

  const query = params.toString();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .get<WebhookList>(`/api/platform/webhooks${query ? `?${query}` : ''}`)
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setError('Could not load webhooks.'));
    return () => {
      cancelled = true;
    };
  }, [query]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset');
    setParams(next);
  }

  return (
    <>
      <div className="page-head">
        <h1>Webhooks</h1>
        {data && (
          <span className="sub">
            {data.total} total
            {data.failedLast24h > 0 &&
              ` — ${data.failedLast24h} failed in the last 24 hours`}
          </span>
        )}
      </div>

      <div className="toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update('search', search.trim());
          }}
        >
          <input
            type="search"
            placeholder="Event type or Stripe event id"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search webhooks"
          />
        </form>

        <select
          value={params.get('status') ?? ''}
          onChange={(e) => update('status', e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="failed">Failed</option>
          <option value="processed">Processed</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      {error && <div className="err">{error}</div>}

      {!data && !error && (
        <LoadingRegion label="Loading webhooks">
          <SkeletonTable rows={6} />
        </LoadingRegion>
      )}

      {data && data.rows.length === 0 && (
        <p className="sub">No webhook deliveries match.</p>
      )}

      {data && data.rows.length > 0 && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Studio</th>
                <th>Status</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((w) => (
                <tr key={w.id}>
                  <td>
                    {w.eventType}
                    <div className="sub">{w.eventId}</div>
                  </td>
                  <td>
                    {w.organization ? (
                      <Link to={`/admin/studios/${w.organization.id}`}>
                        {w.organization.name}
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {w.error ? (
                      <>
                        <span className="tag tag-danger">failed</span>
                        <div className="sub">{w.error.slice(0, 90)}</div>
                      </>
                    ) : w.processedAt ? (
                      <span className="tag tag-ok">processed</span>
                    ) : (
                      <span className="tag tag-warn">pending</span>
                    )}
                  </td>
                  <td>{dateTime(w.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > data.limit && (
        <div className="toolbar">
          <button
            disabled={data.offset === 0}
            onClick={() =>
              update('offset', String(Math.max(data.offset - data.limit, 0)))
            }
          >
            Previous
          </button>
          <button
            disabled={data.offset + data.limit >= data.total}
            onClick={() => update('offset', String(data.offset + data.limit))}
          >
            Next
          </button>
        </div>
      )}

      {/* An empty Twilio column would read as "no Twilio failures". It is not
          recorded at all, which is a different thing. */}
      {data && <p className="insight-note subtle">{data.note}</p>}
    </>
  );
}

// --- Integrations ----------------------------------------------------------

type IntegrationRow = {
  id: string;
  name: string;
  stripe: {
    connected: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    onboardedAt: string | null;
  };
  calendars: { active: number; needsReauth: number; disabled: number };
};

type IntegrationList = {
  rows: IntegrationRow[];
  total: number;
  limit: number;
  offset: number;
  providers: { stripe: boolean; googleCalendar: boolean };
};

export function PlatformIntegrations() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<IntegrationList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get('search') ?? '');

  const query = params.toString();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .get<IntegrationList>(
        `/api/platform/integrations${query ? `?${query}` : ''}`,
      )
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setError('Could not load integrations.'));
    return () => {
      cancelled = true;
    };
  }, [query]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset');
    setParams(next);
  }

  return (
    <>
      <div className="page-head">
        <h1>Integrations</h1>
        {data && <span className="sub">{data.total} studios</span>}
      </div>

      {/*
        Platform-level first. If Google credentials are blank every studio falls
        back to an in-memory fake, and no amount of studio-side reconnecting
        fixes that — so the per-studio table below would be misleading without
        this line above it.
      */}
      {data && (
        <div
          className={`alert ${data.providers.googleCalendar && data.providers.stripe ? '' : 'warn'}`}
        >
          Stripe:{' '}
          <strong>
            {data.providers.stripe ? 'configured' : 'no key — payments disabled'}
          </strong>
          {' · '}
          Google Calendar:{' '}
          <strong>
            {data.providers.googleCalendar
              ? 'configured'
              : 'not configured — using the in-memory fake'}
          </strong>
        </div>
      )}

      <div className="toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update('search', search.trim());
          }}
        >
          <input
            type="search"
            placeholder="Studio name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search studios"
          />
        </form>
      </div>

      {error && <div className="err">{error}</div>}

      {!data && !error && (
        <LoadingRegion label="Loading integrations">
          <SkeletonTable rows={6} />
        </LoadingRegion>
      )}

      {data && data.rows.length > 0 && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Studio</th>
                <th>Stripe Connect</th>
                <th>Calendars</th>
                <th>Connected</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/admin/studios/${s.id}`}>{s.name}</Link>
                  </td>
                  <td>
                    {!s.stripe.connected ? (
                      <span className="muted">not connected</span>
                    ) : s.stripe.chargesEnabled && s.stripe.payoutsEnabled ? (
                      <span className="tag tag-ok">enabled</span>
                    ) : (
                      <>
                        <span className="tag tag-warn">restricted</span>
                        <div className="sub">
                          {!s.stripe.chargesEnabled && 'charges off'}
                          {!s.stripe.chargesEnabled &&
                            !s.stripe.payoutsEnabled &&
                            ' · '}
                          {!s.stripe.payoutsEnabled && 'payouts off'}
                        </div>
                      </>
                    )}
                  </td>
                  <td>
                    {s.calendars.active === 0 &&
                    s.calendars.needsReauth === 0 ? (
                      <span className="muted">none</span>
                    ) : (
                      <>
                        {s.calendars.active} active
                        {s.calendars.needsReauth > 0 && (
                          <div className="sub">
                            <span className="tag tag-warn">
                              {s.calendars.needsReauth} need re-auth
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    {s.stripe.onboardedAt ? (
                      dateTime(s.stripe.onboardedAt)
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > data.limit && (
        <div className="toolbar">
          <button
            disabled={data.offset === 0}
            onClick={() =>
              update('offset', String(Math.max(data.offset - data.limit, 0)))
            }
          >
            Previous
          </button>
          <button
            disabled={data.offset + data.limit >= data.total}
            onClick={() => update('offset', String(data.offset + data.limit))}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}

// --- Plans and limits ------------------------------------------------------

type PlanRow = {
  id: string;
  name: string;
  priceCentsMonthly: number;
  blurb: string;
  maxStaff: number | null;
  maxLocations: number | null;
  studios: number;
  payingStudios: number;
  mrrCents: number;
  features: {
    key: string;
    label: string;
    included: boolean;
    enforced: boolean;
  }[];
};

type PlansOverview = {
  plans: PlanRow[];
  unenforced: { key: string; label: string }[];
  editable: boolean;
  readOnlyReason: string;
};

export function PlatformPlans() {
  const [data, setData] = useState<PlansOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<PlansOverview>('/api/platform/plans-overview')
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setError('Could not load plans.'));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="err">{error}</div>;
  if (!data)
    return (
      <LoadingRegion label="Loading plans">
        <SkeletonTable rows={4} />
      </LoadingRegion>
    );

  return (
    <>
      <div className="page-head">
        <h1>Plans &amp; Limits</h1>
        <span className="sub">Read-only</span>
      </div>

      {/*
        The gap this screen exists to show. A plan matrix that lists only what
        each plan claims is how "sold but never gated" survives — three of the
        five features here are advertised and enforced by nothing.
      */}
      {data.unenforced.length > 0 && (
        <div className="alert warn">
          <strong>
            {data.unenforced.length} advertised feature
            {data.unenforced.length === 1 ? '' : 's'} not enforced anywhere:
          </strong>{' '}
          {data.unenforced.map((f) => f.label).join(', ')}. A studio on any plan
          can use them.
        </div>
      )}

      <div className="plan-grid">
        {data.plans.map((plan) => (
          <div className="card plan-card" key={plan.id}>
            <h2>{plan.name}</h2>
            <p className="plan-price">
              {money(plan.priceCentsMonthly)}
              <span className="sub"> /month</span>
            </p>
            <p className="sub">{plan.blurb}</p>

            <dl className="plan-limits">
              <dt>Instructors</dt>
              <dd>{plan.maxStaff ?? 'Unlimited'}</dd>
              <dt>Locations</dt>
              <dd>{plan.maxLocations ?? 'Unlimited'}</dd>
              <dt>Studios on plan</dt>
              <dd>{plan.studios}</dd>
              <dt>Paying</dt>
              <dd>{plan.payingStudios}</dd>
              <dt>MRR</dt>
              <dd>{money(plan.mrrCents)}</dd>
            </dl>

            <ul className="plan-features">
              {plan.features.map((f) => (
                <li key={f.key} className={f.included ? '' : 'off'}>
                  <span className="plan-mark">{f.included ? '✓' : '—'}</span>
                  <span>{f.label}</span>
                  {f.included && !f.enforced && (
                    <span className="tag tag-warn" title="Nothing checks this">
                      not enforced
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="insight-note subtle">{data.readOnlyReason}</p>
    </>
  );
}
