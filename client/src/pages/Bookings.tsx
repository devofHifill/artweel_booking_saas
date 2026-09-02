import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api,
  dateIn,
  money,
  timeIn,
  todayIn,
  zonedToInstant,
  type BookingListItem,
} from '../lib/api';
import { downloadCsv, type CsvCell } from '../lib/csv';
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
import { Icon } from '../components/Icon';

type ListResponse = {
  bookings: BookingListItem[];
  nextCursor: string | null;
  /** Per-status totals behind the tabs, counted without the status filter. */
  counts: Record<string, number>;
};

/**
 * Where a booking came from, in words rather than in the enum.
 *
 * The prototype prints "Website" under every reference. Ours has three real
 * origins and they are worth telling apart: a booking taken at the counter is
 * a different conversation from one that arrived overnight through the widget
 * on the studio's own site.
 */
function sourceLabel(source: string): string {
  if (source === 'admin') return 'At the counter';
  if (source === 'embed') return 'Widget';
  return 'Booking page';
}

/** The same three words, for the filter that selects them. */
const SOURCES = [
  { id: 'web', label: 'Booking page' },
  { id: 'embed', label: 'Widget' },
  { id: 'admin', label: 'At the counter' },
] as const;

const PAYMENTS = [
  { id: 'paid', label: 'Paid' },
  { id: 'part', label: 'Part paid' },
  { id: 'unpaid', label: 'Unpaid' },
] as const;

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
  const [onDate, setOnDate] = useState('');
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [payment, setPayment] = useState('');
  const [source, setSource] = useState('');

  /* The two dropdowns that need their options from the server. Both fail
     quietly: a filter that cannot load leaves the list working, which is the
     opposite trade from letting a dropdown break the page it filters. */
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
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
    if (serviceTypeId) params.set('serviceTypeId', serviceTypeId);
    if (staffId) params.set('staffId', staffId);
    if (payment) params.set('payment', payment);
    if (source) params.set('source', source);

    if (onDate) {
      /*
        A single day, bounded in the STUDIO's zone rather than the browser's.
        A front desk working remotely, or a laptop left on another zone, would
        otherwise ask for a window shifted by hours and miss the evening class
        at either end of it.

        The date filter wins over the range: picking a day and leaving
        "Upcoming" set would otherwise clip that day to the part of it that has
        not happened yet, which is not what anybody means by choosing a date.
      */
      params.set('from', zonedToInstant(`${onDate}T00:00`, timezone).toISOString());
      params.set('to', zonedToInstant(`${onDate}T23:59`, timezone).toISOString());
    } else {
      if (range === 'upcoming') params.set('from', new Date().toISOString());
      if (range === 'past') params.set('to', new Date().toISOString());
    }

    try {
      const res = await api.get<ListResponse>(`${base}/bookings?${params}`);
      setBookings(res.bookings);
      setCounts(res.counts ?? {});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load bookings.');
    }
  }, [base, search, status, range, onDate, serviceTypeId, staffId, payment, source]);

  useEffect(() => {
    // Debounced so typing a name does not fire a request per keystroke.
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const [svc, st] = await Promise.all([
          api.get<{ services: { id: string; name: string }[] }>(`${base}/services`),
          api.get<{ staff: { id: string; name: string }[] }>(`${base}/staff`),
        ]);
        setServices(svc.services);
        setStaff(st.staff);
      } catch {
        /* The list above still works; two dropdowns simply stay empty. */
      }
    })();
  }, [base]);

  /* Anything narrowing the list, so Clear knows whether it has work to do. */
  const filtered =
    Boolean(search) ||
    Boolean(status) ||
    Boolean(onDate) ||
    Boolean(serviceTypeId) ||
    Boolean(staffId) ||
    Boolean(payment) ||
    Boolean(source) ||
    range !== 'upcoming';

  /**
   * Downloads the rows on screen, filters and all.
   *
   * The prototype's version of this button raises a toast reading "in
   * production this streams a CSV" — so there is nothing here to match, only a
   * shape to match: the two exports this product already has take what is
   * displayed, and an export that quietly returned something else would not be
   * the list the operator was looking at when they clicked.
   *
   * Which means it exports the loaded page, not the whole filtered set. The
   * count under the table is what says how many that is.
   */
  function exportRows() {
    const rows: CsvCell[][] = [
      [
        'Booking',
        'Source',
        'Customer',
        'Email',
        'Activity',
        'Date',
        'Time',
        'Guests',
        'Amount',
        'Paid',
        'Outstanding',
        'Status',
      ],
    ];

    for (const b of bookings) {
      rows.push([
        b.reference ?? '',
        sourceLabel(b.source),
        b.customer.name,
        b.customer.email,
        b.service.name,
        dateIn(b.startsAt, timezone),
        timeIn(b.startsAt, timezone),
        b.seats,
        // Money as a plain decimal, not the formatted string: a spreadsheet
        // cannot sum a column of "$95".
        (b.totalCents / 100).toFixed(2),
        (b.paidCents / 100).toFixed(2),
        (b.outstandingCents / 100).toFixed(2),
        b.status,
      ]);
    }

    downloadCsv(`artweel-bookings-${todayIn(timezone)}.csv`, rows);
  }

  function clearFilters() {
    setSearch('');
    setStatus('');
    setRange('upcoming');
    setOnDate('');
    setServiceTypeId('');
    setStaffId('');
    setPayment('');
    setSource('');
  }

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
            <button onClick={exportRows} disabled={bookings.length === 0}>
              <Icon name="download" size={16} />
              Export CSV
            </button>
            {canTakeBookings && (
              <button className="primary" onClick={() => setShowForm(true)}>
                <Icon name="plus" size={16} />
                Create manual booking
              </button>
            )}
          </>
        }
      />

      {showForm && (
        <Modal
          title="Create manual booking"
          subtitle="For walk-ins, phone bookings and anyone at the counter."
          onClose={closeForm}
        >
          <CounterBookingForm
            base={base}
            timezone={timezone}
            currency={currency}
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

        {/*
          The filter row, matched to the prototype's set.

          It wraps rather than scrolling: seven controls on one line is a
          horizontal scrollbar on a laptop, and a filter nobody can see is a
          filter nobody uses.
        */}
        <Toolbar>
          <input
            placeholder="Search booking, name, email or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />

          {/* A specific day. Overrides the range while it is set — see `load`. */}
          <input
            type="date"
            aria-label="On this date"
            value={onDate}
            onChange={(e) => setOnDate(e.target.value)}
          />

          <select
            aria-label="Activity"
            value={serviceTypeId}
            onChange={(e) => setServiceTypeId(e.target.value)}
          >
            <option value="">All activities</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Payment"
            value={payment}
            onChange={(e) => setPayment(e.target.value)}
          >
            <option value="">Any payment</option>
            {PAYMENTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          {/* The prototype calls this "guide". Ours teach. */}
          <select
            aria-label="Instructor"
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
          >
            <option value="">Any instructor</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">Any source</option>
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          {/* Kept: the prototype has no equivalent, and "everything still to
              come" is the view a studio actually opens this screen for. */}
          <select
            aria-label="When"
            value={range}
            onChange={(e) => setRange(e.target.value as never)}
            disabled={Boolean(onDate)}
          >
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="all">All</option>
          </select>

          {filtered && (
            <button className="sm" onClick={clearFilters}>
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
            caption="Bookings, with reference, customer, activity, status and amount owed"
            /*
              Column order matched to the prototype's Bookings screen.

              Booking first: the reference is what an operator reads back to
              somebody on the phone, and a table whose first column is a date
              cannot be searched by the thing the caller is holding. It had no
              column at all until now — G5 generated the reference and put it
              on the customer's confirmation, and this is the other half of
              that.

              Customer moves ahead of the activity for the same reason: the two
              questions asked at a counter are "who are you" and "what did you
              book", in that order.

              The two UNLABELLED columns are ours and stay: the checkbox drives
              bulk cancel, and the trailing actions are the register. Neither
              appears in the prototype, which has no bulk anything.
            */
            head={
              <tr>
                <th style={{ width: 30 }} />
                <th className="nowrap">Booking</th>
                <th>Customer</th>
                <th>Activity</th>
                {/* Nowrap on both halves of the pair. A ninth column squeezed
                    this one until "Wed, Sep 2 / 2:00 PM" broke across three
                    lines and every row grew to match. */}
                <th className="nowrap">Date &amp; time</th>
                <th className="num">Guests</th>
                <th className="num">Amount</th>
                <th>Payment</th>
                <th>Status</th>
                <th style={{ width: 150 }} />
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
                    {/* `.mono` already exists for exactly this — its comment
                        reads "Reference ids and amounts". A column of them
                        lines up, so a transposed pair is visible at a glance,
                        which matters for a string people read aloud. */}
                    <span className="mono">{booking.reference ?? '—'}</span>
                    <div className="tiny muted nowrap">
                      {sourceLabel(booking.source)}
                    </div>
                  </td>
                  <td>
                    <Link to={`/customers/${booking.customer.id}`}>
                      {booking.customer.name}
                    </Link>
                    <div className="tiny muted">{booking.customer.email}</div>
                  </td>
                  <td>
                    <span
                      className="swatch"
                      style={{ background: booking.service.color }}
                    />
                    {booking.service.name}
                    {booking.seats > 1 && ` ×${booking.seats}`}
                  </td>
                  <td className="nowrap">
                    {dateIn(booking.startsAt, timezone)}
                    <div className="sub" style={{ fontSize: '.78rem' }}>
                      {timeIn(booking.startsAt, timezone)}
                    </div>
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
