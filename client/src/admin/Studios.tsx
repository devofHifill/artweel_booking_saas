import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import {
  relativeDays,
  shortDate,
  type PlanId,
  type StudioList,
  type SubscriptionStatus,
} from './types';
import { LoadingRegion, SkeletonTable } from '../components/states';

const STATUSES: SubscriptionStatus[] = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELED',
];

const PLANS: PlanId[] = ['SOLO', 'STUDIO', 'PRO'];

/**
 * Every studio, searchable.
 *
 * Filters live in the URL rather than in component state, so a tile on the
 * Overview screen can link straight to a filtered list and an operator can share
 * or bookmark "the studios I was looking at".
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

  return (
    <>
      <div className="page-head">
        <h1>Studios</h1>
        {data && (
          <span className="sub">
            {data.total} total
            {data.offset > 0 && ` — showing from ${data.offset + 1}`}
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
            placeholder="Name, slug or owner email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search studios"
          />
        </form>

        <select
          value={params.get('status') ?? ''}
          onChange={(e) => update('status', e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status.toLowerCase().replace('_', ' ')}
            </option>
          ))}
        </select>

        <select
          value={params.get('plan') ?? ''}
          onChange={(e) => update('plan', e.target.value)}
          aria-label="Filter by plan"
        >
          <option value="">Any plan</option>
          {PLANS.map((plan) => (
            <option key={plan} value={plan}>
              {plan.toLowerCase()}
            </option>
          ))}
        </select>

        {query && (
          <button className="link" onClick={() => setParams(new URLSearchParams())}>
            Clear
          </button>
        )}
      </div>

      {error && <div className="err">{error}</div>}

      {/*
        The API reports when a requested sort could not be honoured rather than
        silently returning a different order. Saying so here is the point of that
        flag — otherwise the operator reads the wrong order as the right one.
      */}
      {data?.sortFellBack && (
        <div className="alert warn">
          Sorting by last booking is not supported yet, so these are ordered by
          signup date instead.
        </div>
      )}

      {!data ? (
      <LoadingRegion label="Loading studios">
        <SkeletonTable rows={6} cols={5} />
      </LoadingRegion>
      ) : data.studios.length === 0 ? (
        <div className="empty-state">
          <span className="empty-mark" aria-hidden="true">◍</span>
          <p className="empty-title">No studios match that.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Studio</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Trial ends</th>
                <th>Bookings</th>
                <th>Last booking</th>
                <th>Signed up</th>
              </tr>
            </thead>
            <tbody>
              {data.studios.map((studio) => (
                <tr key={studio.id}>
                  <td>
                    <Link to={`/admin/studios/${studio.id}`}>{studio.name}</Link>
                    <div className="sub">{studio.slug}</div>
                    {!studio.onboardingComplete && (
                      <span className="tag">setup unfinished</span>
                    )}
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
                    <StatusTag status={studio.subscriptionStatus} />
                  </td>
                  <td>{studio.plan.toLowerCase()}</td>
                  <td>
                    {studio.subscriptionStatus === 'TRIALING'
                      ? relativeDays(studio.trialEndsAt)
                      : '—'}
                  </td>
                  <td>{studio.counts.bookings}</td>
                  <td>
                    {studio.counts.lastBookingAt ? (
                      relativeDays(studio.counts.lastBookingAt)
                    ) : (
                      <span className="muted">never</span>
                    )}
                  </td>
                  <td>{shortDate(studio.createdAt)}</td>
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
