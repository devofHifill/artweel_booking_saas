import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { money, shortDate } from './types';
import { LoadingRegion, SkeletonTable } from '../components/states';

/**
 * The cross-studio support lists.
 *
 * One shell rather than five near-identical pages: they differ only in their
 * columns, and five copies of the same search-and-paginate plumbing is five
 * places for the paging to drift apart.
 *
 * READ ONLY by design. Every row names its studio and links there, because the
 * next step after finding something here is almost always to act on it inside
 * that studio — through a support session, which records who looked and why.
 * Editing from this screen would route around exactly that record.
 */

type ListResponse<T> = {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
};

type WithStudio = { id: string; organization: { id: string; name: string } };

function CatalogPage<T extends WithStudio>({
  title,
  endpoint,
  placeholder,
  headers,
  row,
  empty,
}: {
  title: string;
  endpoint: string;
  placeholder: string;
  headers: string[];
  row: (item: T) => ReactNode;
  empty: string;
}) {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<ListResponse<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get('search') ?? '');

  const query = params.toString();

  useEffect(() => {
    let cancelled = false;
    setError(null);

    api
      .get<ListResponse<T>>(
        `/api/platform/${endpoint}${query ? `?${query}` : ''}`,
      )
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setError(`Could not load ${title.toLowerCase()}.`));

    return () => {
      cancelled = true;
    };
  }, [query, endpoint, title]);

  /* Filters live in the URL, like the studios list: a filtered view can be
     linked to from elsewhere, shared, or bookmarked. */
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
        <h1>{title}</h1>
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
            placeholder={placeholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={`Search ${title.toLowerCase()}`}
          />
        </form>
      </div>

      {error && <div className="err">{error}</div>}

      {!data && !error && (
        <LoadingRegion label={`Loading ${title.toLowerCase()}`}>
          <SkeletonTable rows={6} />
        </LoadingRegion>
      )}

      {data && data.rows.length === 0 && <p className="sub">{empty}</p>}

      {data && data.rows.length > 0 && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>{data.rows.map((item) => row(item))}</tbody>
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

/** The studio cell, identical on every list and always a way through. */
function Studio({ org }: { org: { id: string; name: string } }) {
  return <Link to={`/admin/studios/${org.id}`}>{org.name}</Link>;
}

// --- The five lists --------------------------------------------------------

type BookingRow = WithStudio & {
  reference: string;
  startsAt: string;
  status: string;
  seats: number;
  totalCents: number;
  customer: { name: string; email: string } | null;
  serviceType: { name: string } | null;
};

export function PlatformBookings() {
  return (
    <CatalogPage<BookingRow>
      title="Bookings"
      endpoint="bookings"
      placeholder="Reference, customer name or email"
      headers={['Reference', 'Studio', 'Customer', 'Activity', 'Starts', 'Status', 'Total']}
      empty="No bookings match."
      row={(b) => (
        <tr key={b.id}>
          <td>{b.reference}</td>
          <td>
            <Studio org={b.organization} />
          </td>
          <td>
            {b.customer ? (
              <>
                {b.customer.name}
                <div className="sub">{b.customer.email}</div>
              </>
            ) : (
              <span className="muted">—</span>
            )}
          </td>
          <td>{b.serviceType?.name ?? <span className="muted">—</span>}</td>
          <td>{shortDate(b.startsAt)}</td>
          <td>
            <span className="tag">{b.status.toLowerCase().replace('_', ' ')}</span>
          </td>
          <td>{money(b.totalCents)}</td>
        </tr>
      )}
    />
  );
}

type CustomerRow = WithStudio & {
  name: string;
  email: string;
  status: string;
  createdAt: string;
  _count: { bookings: number };
};

export function PlatformCustomers() {
  return (
    <CatalogPage<CustomerRow>
      title="Customers"
      endpoint="customers"
      placeholder="Name or email"
      headers={['Customer', 'Studio', 'Status', 'Bookings', 'Added']}
      empty="No customers match."
      row={(c) => (
        <tr key={c.id}>
          <td>
            {c.name}
            <div className="sub">{c.email}</div>
          </td>
          <td>
            <Studio org={c.organization} />
          </td>
          <td>
            <span className="tag">{c.status.toLowerCase()}</span>
          </td>
          <td>{c._count.bookings}</td>
          <td>{shortDate(c.createdAt)}</td>
        </tr>
      )}
    />
  );
}

type ActivityRow = WithStudio & {
  name: string;
  bookingMode: string;
  durationMinutes: number;
  capacityMax: number;
  priceCents: number;
  isActive: boolean;
};

export function PlatformActivities() {
  return (
    <CatalogPage<ActivityRow>
      title="Activities"
      endpoint="activities"
      placeholder="Activity or studio name"
      headers={['Activity', 'Studio', 'Mode', 'Duration', 'Capacity', 'Price', '']}
      empty="No activities match."
      row={(a) => (
        <tr key={a.id}>
          <td>{a.name}</td>
          <td>
            <Studio org={a.organization} />
          </td>
          <td>{a.bookingMode.toLowerCase()}</td>
          <td>{a.durationMinutes} min</td>
          <td>{a.capacityMax}</td>
          <td>{money(a.priceCents)}</td>
          <td>{!a.isActive && <span className="tag">inactive</span>}</td>
        </tr>
      )}
    />
  );
}

type LocationRow = WithStudio & {
  name: string;
  locationType: string;
  address: string | null;
  timezone: string;
  isActive: boolean;
};

export function PlatformLocations() {
  return (
    <CatalogPage<LocationRow>
      title="Locations"
      endpoint="locations"
      placeholder="Location, address or studio"
      headers={['Location', 'Studio', 'Type', 'Address', 'Timezone', '']}
      empty="No locations match."
      row={(l) => (
        <tr key={l.id}>
          <td>{l.name}</td>
          <td>
            <Studio org={l.organization} />
          </td>
          <td>{l.locationType.toLowerCase().replace('_', ' ')}</td>
          <td>{l.address ?? <span className="muted">—</span>}</td>
          <td>{l.timezone}</td>
          <td>{!l.isActive && <span className="tag">inactive</span>}</td>
        </tr>
      )}
    />
  );
}

type ResourceRow = WithStudio & {
  name: string;
  resourceType: string;
  quantity: number;
  isExclusive: boolean;
  isActive: boolean;
};

export function PlatformResources() {
  return (
    <CatalogPage<ResourceRow>
      title="Resources"
      endpoint="resources"
      placeholder="Resource, type or studio"
      headers={['Resource', 'Studio', 'Type', 'Quantity', 'Exclusive', '']}
      empty="No resources match."
      row={(r) => (
        <tr key={r.id}>
          <td>{r.name}</td>
          <td>
            <Studio org={r.organization} />
          </td>
          <td>{r.resourceType.toLowerCase().replace('_', ' ')}</td>
          <td>{r.quantity}</td>
          <td>
            {/* Exclusivity is the property the scheduler actually enforces, so
                it earns a column rather than living in a detail view. */}
            {r.isExclusive ? 'yes' : <span className="muted">no</span>}
          </td>
          <td>{!r.isActive && <span className="tag">inactive</span>}</td>
        </tr>
      )}
    />
  );
}
