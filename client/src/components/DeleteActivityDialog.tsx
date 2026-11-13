import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './layout';

/** What the server says a delete would remove (GET /services/:id/deletion). */
type Impact = {
  id: string;
  name: string;
  sessions: number;
  bookings: number;
  upcomingBookings: number;
  enrollments: number;
  payments: number;
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Permanently deleting an activity.
 *
 * It says what goes with it before anything happens, and asks for the name
 * to be typed: this removes customers' booking history and cannot be undone.
 * While anyone has an upcoming booking the server refuses, so the dialog says
 * so up front instead of offering a button that would fail.
 *
 * `onClose` must be stable (Modal re-focuses whenever it changes).
 */
export function DeleteActivityDialog({
  base,
  serviceId,
  onClose,
  onDeleted,
}: {
  base: string;
  serviceId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .get<{ impact: Impact }>(`${base}/services/${serviceId}/deletion`)
      .then((res) => live && setImpact(res.impact))
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Could not load.'));
    return () => {
      live = false;
    };
  }, [base, serviceId]);

  const blocked = !!impact && impact.upcomingBookings > 0;
  const matches = !!impact && typed.trim() === impact.name.trim();

  async function confirm() {
    if (!impact || !matches || blocked) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`${base}/services/${impact.id}`);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete.');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={impact ? `Delete ${impact.name}?` : 'Delete activity?'}
      subtitle="This is permanent and cannot be undone."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="link" onClick={onClose}>
            {blocked ? 'Close' : 'Keep it'}
          </button>
          {!blocked && (
            <button
              type="button"
              className="danger"
              disabled={!matches || busy}
              onClick={() => void confirm()}
            >
              {busy ? 'Deleting…' : 'Delete permanently'}
            </button>
          )}
        </>
      }
    >
      <div aria-live="polite">{error && <div className="err">{error}</div>}</div>

      {!impact && !error && <p className="muted">Checking what it has…</p>}

      {impact && blocked && (
        <div className="alert warn" role="alert">
          {count(impact.upcomingBookings, 'customer has', 'customers have')} an upcoming booking.
          Cancel those first, from the session or the booking, so they are told and refunded.
          Then you can delete it.
        </div>
      )}

      {impact && !blocked && (
        <>
          {impact.sessions + impact.bookings + impact.enrollments === 0 ? (
            <p>It has never been scheduled or booked, so nothing else goes with it.</p>
          ) : (
            <>
              <p>Deleting it also removes:</p>
              <ul className="delete-impact">
                {impact.sessions > 0 && <li>{count(impact.sessions, 'session')}</li>}
                {impact.bookings > 0 && (
                  <li>{count(impact.bookings, 'past or cancelled booking')}, from customers' history</li>
                )}
                {impact.enrollments > 0 && <li>{count(impact.enrollments, 'class enrolment')}</li>}
              </ul>
              {impact.payments > 0 && (
                <p className="tiny muted">
                  {impact.payments === 1
                    ? '1 payment stays'
                    : `${impact.payments} payments stay`}{' '}
                  in your payment records, no longer linked to a booking.
                </p>
              )}
            </>
          )}
          <p className="tiny muted">
            Not deleting keeps that history. To just take it off your booking page, set it
            to Hidden instead.
          </p>
          <div className="setting setting-stack">
            <label htmlFor="deleteActivityName">
              Type <strong>{impact.name}</strong> to confirm
            </label>
            <input
              id="deleteActivityName"
              value={typed}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirm();
              }}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
