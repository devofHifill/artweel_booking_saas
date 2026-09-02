import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api,
  dateIn,
  money,
  timeIn,
  type BookingListItem,
} from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import {
  DataTable,
  Modal,
  PageHead,
  PaymentPill,
  StatusPill,
  Toolbar,
  paymentState,
} from '../components/layout';
import { EmptyState } from '../components/states';
import { CounterBookingForm } from '../components/CounterBookingForm';

type ListResponse = {
  bookings: BookingListItem[];
  nextCursor: string | null;
  /** Per-status totals behind the tabs, counted without the status filter. */
  counts: Record<string, number>;
};

/**
 * The status tabs, in the order a booking moves through them.
 *
 * A tab row rather than the dropdown this screen had, matching the prototype:
 * the counts are the point. "Pending 3" tells an owner there is something to do
 * before they have clicked anything, which a `<select>` cannot.
 */
const TABS = [
  { id: '', label: 'All' },
  { id: 'CONFIRMED', label: 'Confirmed' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'ATTENDED', label: 'Attended' },
  { id: 'NO_SHOW', label: 'No show' },
  { id: 'CANCELLED', label: 'Cancelled' },
] as const;

export default function Bookings() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';
  const currency = org?.organization.currency ?? 'USD';

  const [bookings, setBookings] = useState<BookingListItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [range, setRange] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Taking a booking is counter work — the same three roles the server's
   * `requireFrontDesk` allows. An instructor teaching a class has no reason to
   * be selling a place in it, and showing them a button that 403s is worse
   * than not showing it.
   */
  const canTakeBookings =
    org?.role === 'OWNER' || org?.role === 'ADMIN' || org?.role === 'FRONT_DESK';

  /*
    `?new=1` opens the form on arrival, which is how the Dashboard's "New
    booking" button reaches it. That button used to link to this page and stop
    there, at a list with no form — the action it named did not exist anywhere
    in the client.
  */
  const [params, setParams] = useSearchParams();
  const [showForm, setShowForm] = useState(() => params.get('new') === '1');

  const closeForm = useCallback(() => {
    setShowForm(false);
    if (params.get('new')) {
      // Dropped from the URL so a refresh does not reopen a dialog the user
      // has already dismissed.
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' });

    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    if (range === 'upcoming') params.set('from', new Date().toISOString());
    if (range === 'past') params.set('to', new Date().toISOString());

    try {
      const res = await api.get<ListResponse>(`${base}/bookings?${params}`);
      setBookings(res.bookings);
      setCounts(res.counts ?? {});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load bookings.');
    }
  }, [base, search, status, range]);

  useEffect(() => {
    // Debounced so typing a name does not fire a request per keystroke.
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function cancelOne(booking: BookingListItem) {
    const refundNote =
      booking.paidCents > 0
        ? ' Any refund due under your cancellation policy will be issued.'
        : '';

    if (!confirm(`Cancel ${booking.customer.name}'s booking?${refundNote}`)) {
      return;
    }

    setBusy(true);
    try {
      await api.post(`${base}/bookings/${booking.id}/cancel`, { refund: true });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelSelected() {
    if (
      !confirm(
        `Cancel ${selected.size} booking${selected.size === 1 ? '' : 's'}? ` +
          'Refunds will follow your cancellation policy.',
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      // Reported per booking rather than all-or-nothing, so a studio
      // cancelling a snow day learns which ones actually went.
      const result = await api.post<{ cancelled: number; failed: number }>(
        `${base}/bookings/bulk/cancel`,
        { bookingIds: [...selected], refund: true },
      );

      if (result.failed > 0) {
        setError(
          `${result.cancelled} cancelled, ${result.failed} could not be.`,
        );
      }
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk cancel failed.');
    } finally {
      setBusy(false);
    }
  }

  async function mark(booking: BookingListItem, next: 'ATTENDED' | 'NO_SHOW') {
    setBusy(true);
    try {
      await api.post(`${base}/bookings/${booking.id}/attendance`, {
        status: next,
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Bookings"
        lede="Every reservation across your booking page and the embedded widget."
        actions={
          <>
            {selected.size > 0 && (
              <button className="danger" onClick={cancelSelected} disabled={busy}>
                Cancel {selected.size} selected
              </button>
            )}
            {canTakeBookings && (
              <button className="primary" onClick={() => setShowForm(true)}>
                New booking
              </button>
            )}
          </>
        }
      />

      {showForm && (
        <Modal
          title="New booking"
          subtitle="Taken over the phone or at the counter."
          onClose={closeForm}
        >
          <CounterBookingForm
            base={base}
            timezone={timezone}
            onBooked={() => {
              closeForm();
              void load();
            }}
            onCancel={closeForm}
          />
        </Modal>
      )}

      {error && <div className="err">{error}</div>}

      {/*
        Tabs and filters live INSIDE the card, as one control surface above the
        rows they act on — the prototype's arrangement. They were a floating
        toolbar above a separate card before, which reads as two unrelated
        things and leaves the filter row homeless when the table is empty.
      */}
      <div className="card" style={{ padding: 0 }}>
        <div className="tabs-wrap">
          <div className="tabs" role="tablist" aria-label="Booking status">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={status === tab.id}
                className={`tab ${status === tab.id ? 'on' : ''}`.trim()}
                onClick={() => setStatus(tab.id)}
              >
                {tab.label}
                {/*
                  Shown once the counts have ARRIVED, then on every tab.

                  `counts` only carries statuses that have rows, so reading it
                  directly left "Cancelled" with no pill while "All" had one —
                  a blank reads as "unknown", not as "none", and the two are
                  different answers. `counts.total` is the load signal because
                  it is present whenever the server replied, including when
                  every number is zero.
                */}
                {counts.total !== undefined && (
                  <span className="pill">
                    {counts[tab.id === '' ? 'total' : tab.id] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <Toolbar>
          <input
            placeholder="Search name, email or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <select value={range} onChange={(e) => setRange(e.target.value as never)}>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="all">All</option>
          </select>
          {(search || status || range !== 'upcoming') && (
            <button
              className="sm"
              onClick={() => {
                setSearch('');
                setStatus('');
                setRange('upcoming');
              }}
            >
              Clear
            </button>
          )}
        </Toolbar>

        {bookings.length === 0 ? (
          <div style={{ padding: 'var(--space-5)' }}>
            <EmptyState>No bookings match that.</EmptyState>
          </div>
        ) : (
          <>
          <DataTable
            caption="Bookings, with class, customer, status and amount owed"
            head={
              <tr>
                <th style={{ width: 30 }} />
                <th>When</th>
                <th>Class</th>
                <th>Customer</th>
                <th className="num">Guests</th>
                <th className="num">Amount</th>
                <th>Payment</th>
                <th>Status</th>
                <th style={{ width: 190 }} />
              </tr>
            }
          >
              {bookings.map((booking) => (
                <tr key={booking.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${booking.customer.name}`}
                      checked={selected.has(booking.id)}
                      onChange={() => toggle(booking.id)}
                      disabled={booking.status === 'CANCELLED'}
                      style={{ width: 'auto' }}
                    />
                  </td>
                  <td>
                    {dateIn(booking.startsAt, timezone)}
                    <div className="sub" style={{ fontSize: '.78rem' }}>
                      {timeIn(booking.startsAt, timezone)}
                    </div>
                  </td>
                  <td>
                    <span
                      className="swatch"
                      style={{ background: booking.service.color }}
                    />
                    {booking.service.name}
                    {booking.seats > 1 && ` ×${booking.seats}`}
                  </td>
                  <td>
                    <Link to={`/customers/${booking.customer.id}`}>
                      {booking.customer.name}
                    </Link>
                    <div className="tiny muted">{booking.customer.email}</div>
                  </td>
                  <td className="num">{booking.seats}</td>
                  <td className="num">{money(booking.totalCents, currency)}</td>
                  <td>
                    {/* Paid / part paid / unpaid, derived from what is owed
                        against the total — the same three states the payments
                        screen shows, so the two agree. */}
                    <PaymentPill
                      state={paymentState(
                        booking.totalCents,
                        booking.outstandingCents,
                      )}
                    />
                  </td>
                  <td>
                    <StatusPill status={booking.status} />
                  </td>
                  <td>
                    {booking.status !== 'CANCELLED' && (
                      <>
                        <button
                          className="link"
                          onClick={() => mark(booking, 'ATTENDED')}
                          disabled={busy}
                        >
                          Attended
                        </button>
                        <button
                          className="link"
                          onClick={() => mark(booking, 'NO_SHOW')}
                          disabled={busy}
                        >
                          No show
                        </button>
                        <button
                          className="link"
                          onClick={() => cancelOne(booking)}
                          disabled={busy}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>

            {/*
              A count, not a pager.

              The prototype numbers its pages because it holds every booking in
              a JavaScript array and knows the total. This list is CURSOR
              paginated — deliberately, so a studio scrolling a busy month
              while bookings are being taken does not see rows repeat or
              vanish — and a cursor cannot know which page it is on. Numbered
              buttons would be a lie about how the data arrives.
            */}
            <div className="table-foot">
              <span className="tiny muted">
                Showing {bookings.length}
                {counts.total !== undefined && counts.total > bookings.length
                  ? ` of ${counts.total}`
                  : ''}
                {bookings.length === 1 ? ' booking' : ' bookings'}
              </span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
