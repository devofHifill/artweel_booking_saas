import { useState } from 'react';
import { api } from '../lib/api';

/**
 * Creating and editing what a studio offers.
 *
 * Built in D4, and NOT because the prototype's Activities screen has a form —
 * because the product did not have one at all. `POST /services` has existed
 * since W1, the onboarding wizard has a REQUIRED step called "Add a class"
 * that completes when `services > 0`, and nothing in the client could create
 * one. A studio that signed up could not finish setup, and the step could
 * never be ticked.
 *
 * That is the same shape as the six writer-less policy columns and the three
 * ungrantable roles, and it is the worst instance of it: a booking product
 * where you cannot say what you sell.
 *
 * ---
 *
 * The schema behind this has twenty fields. This form asks for SIX and lets
 * the server default the rest, because the difference between a studio that
 * finishes setup and one that abandons it is how many questions stand between
 * them and a bookable class. Padding, notice windows, deposit terms and staff
 * preference are all real and all editable later; none of them belongs in the
 * way of a first class.
 */

export type ServiceDraft = {
  id?: string;
  name: string;
  description?: string | null;
  bookingMode: 'APPOINTMENT' | 'EVENT' | 'COURSE_SERIES';
  durationMinutes: number;
  capacityMax: number;
  priceCents: number;
  color: string;
  isActive?: boolean;
};

const MODES = [
  {
    value: 'EVENT',
    label: 'Group class',
    help: 'Several people book seats on the same session. Wheel throwing, handbuilding.',
  },
  {
    value: 'APPOINTMENT',
    label: 'One to one',
    help: 'A single person books time with an instructor. Private lessons.',
  },
] as const;

export function ServiceForm({
  base,
  existing,
  onSaved,
  onCancel,
}: {
  base: string;
  existing?: ServiceDraft;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [bookingMode, setBookingMode] = useState<ServiceDraft['bookingMode']>(
    existing?.bookingMode ?? 'EVENT',
  );
  const [duration, setDuration] = useState(existing?.durationMinutes ?? 120);
  const [capacity, setCapacity] = useState(existing?.capacityMax ?? 8);
  const [price, setPrice] = useState(
    existing ? String(existing.priceCents / 100) : '',
  );
  const [color, setColor] = useState(existing?.color ?? '#4f46e5');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * An appointment is one-to-one by definition and the server refuses anything
   * else — `capacityMax === 1` is a schema-level rule, not a convention. So the
   * capacity field disappears rather than being submitted and rejected.
   */
  const isAppointment = bookingMode === 'APPOINTMENT';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      bookingMode,
      durationMinutes: duration,
      capacityMax: isAppointment ? 1 : capacity,
      capacityMin: 1,
      // Entered in whole currency, stored in cents — the boundary is here so
      // no caller downstream has to remember which unit it is holding.
      priceCents: Math.round(Number(price || 0) * 100),
      color,
    };

    try {
      if (existing?.id) {
        await api.patch(`${base}/services/${existing.id}`, body);
      } else {
        await api.post(`${base}/services`, body);
      }
      onSaved();
    } catch (err) {
      // The server's message is the useful one — it knows about capacity
      // bounds, deposit rules and the appointment constraint.
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card settings-section" onSubmit={submit}>
      <h2>{existing ? 'Edit activity' : 'New activity'}</h2>

      <div className="setting setting-stack">
        <label htmlFor="svcName">Name</label>
        <input
          id="svcName"
          required
          maxLength={120}
          value={name}
          placeholder="Beginner wheel throwing"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="setting setting-stack">
        <label htmlFor="svcDesc">Description</label>
        <textarea
          id="svcDesc"
          rows={3}
          maxLength={4000}
          value={description ?? ''}
          placeholder="What happens in the session, and what a beginner should expect."
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="tiny muted">Shown on your booking page.</p>
      </div>

      <div className="setting setting-stack">
        <label htmlFor="svcMode">Type</label>
        <select
          id="svcMode"
          value={bookingMode}
          onChange={(e) =>
            setBookingMode(e.target.value as ServiceDraft['bookingMode'])
          }
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="tiny muted">
          {MODES.find((m) => m.value === bookingMode)?.help}
        </p>
      </div>

      <div className="row">
        <div>
          <label htmlFor="svcDuration">Length (minutes)</label>
          <input
            id="svcDuration"
            type="number"
            min={5}
            max={1440}
            required
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </div>

        {!isAppointment && (
          <div>
            <label htmlFor="svcCapacity">Places</label>
            <input
              id="svcCapacity"
              type="number"
              min={1}
              max={500}
              required
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
            />
          </div>
        )}

        <div>
          <label htmlFor="svcPrice">Price</label>
          <input
            id="svcPrice"
            type="number"
            min={0}
            step="0.01"
            value={price}
            placeholder="0.00"
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
      </div>

      <div className="setting setting-stack">
        <label htmlFor="svcColor">Colour</label>
        {/* The colour this activity wears on the calendar and the schedule.
            Not the studio's brand — that is one setting for the whole studio,
            in Settings → Appearance. */}
        <input
          id="svcColor"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={{ width: 60, padding: 2 }}
        />
        <p className="tiny muted">How it appears on your calendar.</p>
      </div>

      {error && (
        <div className="alert danger" role="alert">
          {error}
        </div>
      )}

      <div className="page-actions">
        <button type="submit" className="primary" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Create activity'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
