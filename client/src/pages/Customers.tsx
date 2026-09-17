import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dateIn, money } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import {
  DataTable,
  Kpi,
  Modal,
  PageHead,
  Pager,
  StatusPill,
} from '../components/layout';
import { EmptyState } from '../components/states';
import { Icon } from '../components/Icon';
import { CounterBookingForm } from '../components/CounterBookingForm';
import {
  CustomerForm,
  type CustomerStatus,
  type EditableCustomer,
} from '../components/CustomerForm';

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  status: CustomerStatus;
  notes: string | null;
  smsConsentAt: string | null;
  smsOptedOutAt: string | null;
  spentCents: number;
  lastVisit: string | null;
  /** Bookings still to come. Counted from the same rows as the total. */
  upcoming: number;
  _count: { bookings: number };
};

type ListResponse = {
  customers: CustomerRow[];
  total: number;
  page: number;
  pageSize: number;
  truncated: boolean;
  totals: { customers: number; repeat: number; spentCents: number };
};

const SORTS = [
  { value: 'spent', label: 'Highest spend' },
  { value: 'bookings', label: 'Most bookings' },
  { value: 'recent', label: 'Most recent' },
  { value: 'name', label: 'Name A–Z' },
] as const;

const STATUS_FILTERS = [
  { value: '', label: 'Any status' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'VIP', label: 'VIP' },
  { value: 'BLOCKED', label: 'Blocked' },
] as const;

/**
 * The pill for a customer's status.
 *
 * Mapped onto the booking-status palette rather than given its own: three
 * more colours for three more words would make the product's vocabulary of
 * coloured pills harder to read, not richer. VIP borrows the confirmed green
 * and Blocked the cancelled red, which is what each one means at a glance.
 */
const STATUS_TONE: Record<CustomerStatus, string> = {
  ACTIVE: 'PENDING',
  VIP: 'CONFIRMED',
  BLOCKED: 'CANCELLED',
};

const STATUS_LABEL: Record<CustomerStatus, string> = {
  ACTIVE: 'Active',
  VIP: 'VIP',
  BLOCKED: 'Blocked',
};

/**
 * Two letters for the avatar.
 *
 * First and last word, so "Mary Anne Fitzgerald" is MF rather than MA — a
 * middle name is the part people drop when they say a name out loud.
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}

export default function Customers() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const currency = org?.organization.currency ?? 'USD';
  const timezone = org?.organization.timezone ?? 'UTC';

  const [data, setData] = useState<ListResponse | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<string>('spent');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  /** Null means closed; a row means edit; 'new' means add. */
  const [editing, setEditing] = useState<EditableCustomer | 'new' | null>(null);
  /** The customer a new booking is being taken for. */
  const [booking, setBooking] = useState<CustomerRow | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      sort,
      page: String(page),
      pageSize: '25',
    });
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);

    try {
      setData(await api.get<ListResponse>(`${base}/customers?${params}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    }
  }, [base, search, status, sort, page]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  /*
    Any change to what is being listed sends you back to page one.

    Without this, narrowing a search while on page four leaves you looking at
    an empty table with a pager saying "Page 4 of 1" — the rows are gone and
    nothing on screen explains why.
  */
  useEffect(() => {
    setPage(1);
  }, [search, status, sort]);

  /**
   * Export.
   *
   * Fetched with the session's credentials and turned into a blob rather than
   * pointed at with a plain link, because the API is on another origin and a
   * bare <a href> carries no Authorization header — the studio would download
   * a 401 saved as a .csv and have no idea why.
   *
   * The current filters go with it: somebody who has searched for "school"
   * and clicked Export wants those rows, not the whole studio.
   */
  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    setError(null);

    const params = new URLSearchParams({ sort });
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);

    try {
      const blob = await api.blob(`${base}/customers/export.csv?${params}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      /* Revoked, or the blob is held for the life of the tab. */
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export.');
    } finally {
      setExporting(false);
    }
  }

  const rows = data?.customers ?? [];
  const totals = data?.totals ?? { customers: 0, repeat: 0, spentCents: 0 };
  const repeatPct = totals.customers
    ? Math.round((totals.repeat / totals.customers) * 100)
    : 0;
  const average = totals.customers
    ? Math.round(totals.spentCents / totals.customers)
    : 0;

  const filtering = search.trim() !== '' || status !== '';

  return (
    <>
      <PageHead
        title="Customers"
        lede="Everyone who has ever booked with you."
        actions={
          <>
            <button type="button" onClick={exportCsv} disabled={exporting}>
              <Icon name="download" /> {exporting ? 'Exporting…' : 'Export'}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setEditing('new')}
            >
              <Icon name="plus" /> Add customer
            </button>
          </>
        }
      />

      {/* The four figures describe the FILTERED set, not the page — see the
          note on `totals` in listCustomers. The label says "shown" because a
          search narrows them, which is the behaviour worth keeping. */}
      <div className="kpis">
        <Kpi
          label={filtering ? 'Customers shown' : 'Total customers'}
          value={String(totals.customers)}
          icon="customers"
        />
        <Kpi
          label="Repeat guests"
          value={`${totals.repeat} · ${repeatPct}%`}
          tone="violet"
          icon="bookings"
        />
        <Kpi
          label="Lifetime revenue"
          value={money(totals.spentCents, currency)}
          tone="green"
          icon="plan"
        />
        <Kpi
          label="Average spend"
          value={money(average, currency)}
          tone="amber"
          icon="health"
        />
      </div>

      {error && <div className="err">{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        <div className="filter-bar" style={{ margin: 0, padding: 'var(--space-4)' }}>
          <input
            className="grow"
            placeholder="Search name, email or phone…"
            aria-label="Search customers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={status}
            aria-label="Filter by status"
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={sort}
            aria-label="Sort by"
            onChange={(e) => setSort(e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: 'var(--space-4)', paddingTop: 0 }}>
            <EmptyState
              hint={
                filtering
                  ? 'Try a different search, or clear the status.'
                  : 'Add one, or take a booking and we will create them.'
              }
            >
              {filtering ? 'No customers match' : 'No customers yet'}
            </EmptyState>
          </div>
        ) : (
          <>
            <DataTable
              caption="Customers, with contact details, bookings and lifetime spend"
              head={
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Country</th>
                  <th className="num">Bookings</th>
                  <th className="num">Total spent</th>
                  <th>Last booking</th>
                  <th>Status</th>
                  {/* Unlabelled: a header over two icon buttons reads as a
                      column of data that is not there. */}
                  <th aria-label="Actions" />
                </tr>
              }
            >
              {rows.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <div className="name-cell">
                      <span className="avatar sm" aria-hidden="true">
                        {initials(customer.name)}
                      </span>
                      <Link to={`/customers/${customer.id}`}>
                        {customer.name}
                      </Link>
                    </div>
                  </td>
                  <td>
                    <div className="sub">{customer.email}</div>
                    {customer.phone && (
                      <div className="sub">{customer.phone}</div>
                    )}
                  </td>
                  <td className="muted">{customer.country ?? '—'}</td>
                  <td className="num">
                    {customer._count.bookings}
                    {/* Only when there are some. "0 upcoming" under a count is
                        a line of text that says nothing. */}
                    {customer.upcoming > 0 && (
                      <div className="tiny upcoming-note">
                        {customer.upcoming} upcoming
                      </div>
                    )}
                  </td>
                  <td className="num strong">
                    {money(customer.spentCents, currency)}
                  </td>
                  <td className="tiny muted">
                    {/* Never visited is not zero — an em dash says "none yet",
                        where a date would have to invent one. */}
                    {customer.lastVisit
                      ? dateIn(customer.lastVisit, timezone)
                      : '—'}
                  </td>
                  <td>
                    <StatusPill status={STATUS_TONE[customer.status]}>
                      {STATUS_LABEL[customer.status]}
                    </StatusPill>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title={`New booking for ${customer.name}`}
                        aria-label={`New booking for ${customer.name}`}
                        onClick={() => setBooking(customer)}
                      >
                        <Icon name="plus" size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title={`Edit ${customer.name}`}
                        aria-label={`Edit ${customer.name}`}
                        onClick={() => setEditing(customer)}
                      >
                        <Icon name="edit" size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>

            <div className="table-foot">
              <Pager
                page={data?.page ?? 1}
                pageSize={data?.pageSize ?? 25}
                total={data?.total ?? 0}
                noun="customers"
                onPage={setPage}
              />
            </div>
          </>
        )}
      </div>

      {/* Said out loud rather than logged, because the list is wrong at this
          point and only the studio can tell us it has grown that far. */}
      {data?.truncated && (
        <p className="tiny muted" style={{ marginTop: 'var(--space-3)' }}>
          Showing the first 5,000 customers. Sorting and totals cover those
          only — get in touch and we will raise it.
        </p>
      )}

      {editing && (
        <Modal
          title={editing === 'new' ? 'Add customer' : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
        >
          <CustomerForm
            base={base}
            editing={editing === 'new' ? null : editing}
            onSaved={() => {
              setEditing(null);
              void load();
            }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {booking && (
        <Modal
          title="Create manual booking"
          subtitle={`For ${booking.name} — walk-ins, phone bookings and anyone at the counter.`}
          size="wide"
          onClose={() => setBooking(null)}
        >
          <CounterBookingForm
            base={base}
            timezone={timezone}
            currency={currency}
            customerId={booking.id}
            onBooked={() => {
              setBooking(null);
              void load();
            }}
            onCancel={() => setBooking(null)}
          />
        </Modal>
      )}
    </>
  );
}
