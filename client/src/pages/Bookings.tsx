import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  dateIn,
  money,
  timeIn,
  type BookingListItem,
} from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';

type ListResponse = { bookings: BookingListItem[]; nextCursor: string | null };

export default function Bookings() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';
  const currency = org?.organization.currency ?? 'USD';

  const [bookings, setBookings] = useState<BookingListItem[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [range, setRange] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' });

    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    if (range === 'upcoming') params.set('from', new Date().toISOString());
    if (range === 'past') params.set('to', new Date().toISOString());

    try {
      const res = await api.get<ListResponse>(`${base}/bookings?${params}`);
      setBookings(res.bookings);
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
      <div className="page-head">
        <div>
          <h1>Bookings</h1>
          <p className="sub">{bookings.length} shown</p>
        </div>
        {selected.size > 0 && (
          <button className="danger" onClick={cancelSelected} disabled={busy}>
            Cancel {selected.size} selected
          </button>
        )}
      </div>

      <div className="toolbar">
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
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="PENDING">Pending</option>
          <option value="ATTENDED">Attended</option>
          <option value="NO_SHOW">No show</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {error && <div className="err">{error}</div>}

      {bookings.length === 0 ? (
        <div className="card empty">No bookings match that.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 30 }} />
                <th>When</th>
                <th>Class</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Owed</th>
                <th style={{ width: 190 }} />
              </tr>
            </thead>
            <tbody>
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
                  </td>
                  <td>
                    <span className={`tag ${booking.status}`}>
                      {booking.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td>
                    {booking.outstandingCents > 0
                      ? money(booking.outstandingCents, currency)
                      : '—'}
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
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
