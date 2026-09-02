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
 * The schema behind this has twenty fields. Creating one asks for SIX and lets
 * the server default the rest, because the difference between a studio that
 * finishes setup and one that abandons it is how many questions stand between
 * them and a bookable class. Padding, notice windows, deposit terms and staff
 * preference are all real; none of them belongs in the way of a first class.
 *
 * ---
 *
 * That reasoning was right and the sentence that followed it — "all editable
 * later" — was not true. There was no later. `minNoticeMinutes`,
 * `maxHorizonDays`, `depositType` and `depositValue` are accepted by the API,
 * validated there, and drive real behaviour: the first two bound every
 * availability query, and the second two decide whether checkout takes part of
 * the price or all of it. No screen wrote any of them, so every studio ran on
 * the defaults — no notice, 120 days, no deposits — and could not say
 * otherwise.
 *
 * D12's finding in a different costume, and D4's before that: the capability
 * was whole and had nobody to speak for it.
 *
 * So they appear when EDITING and not when creating. That keeps the six
 * questions a new studio answers, and builds the later the comment promised.
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
  /** Optional because creating a service never sends them — see the note above. */
  minNoticeMinutes?: number;
  maxHorizonDays?: number;
  depositType?: 'none' | 'percent' | 'fixed';
  /** A percentage when depositType is "percent", otherwise cents. */
  depositValue?: number;
  /** G3 — booking-page copy. One highlight per line. */
  highlights?: string | null;
  preparationNotes?: string | null;
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

  const [notice, setNotice] = useState(existing?.minNoticeMinutes ?? 0);
  const [horizon, setHorizon] = useState(existing?.maxHorizonDays ?? 120);
  const [depositType, setDepositType] = useState<
    NonNullable<ServiceDraft['depositType']>
  >(existing?.depositType ?? 'none');
  /**
   * Held as a string for the same reason `price` is: a number input the user is
   * mid-way through clearing produces NaN, and NaN in a controlled input is a
   * React warning and an empty box the user cannot type into.
   */
  const [depositValue, setDepositValue] = useState(() => {
    if (!existing?.depositValue) return '';
    return existing.depositType === 'fixed'
      ? String(existing.depositValue / 100)
      : String(existing.depositValue);
  });

  const [highlights, setHighlights] = useState(existing?.highlights ?? '');
  const [preparationNotes, setPreparationNotes] = useState(
    existing?.preparationNotes ?? '',
  );

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
      /**
       * Only when editing. Sending them on create would put the server's
       * defaults back as if they were choices, and the whole point of leaving
       * them out of the create form is that nobody has made one yet.
       */
      ...(existing
        ? {
            minNoticeMinutes: notice,
            maxHorizonDays: horizon,
            depositType,
            // Percent goes as typed; a fixed deposit is money, so it crosses
            // into cents at the same boundary `price` does.
            depositValue:
              depositType === 'none'
                ? 0
                : depositType === 'fixed'
                  ? Math.round(Number(depositValue || 0) * 100)
                  : Number(depositValue || 0),
            /* Empty means "nothing to say", which is null rather than an empty
               string — the renderer omits the whole heading on null, and would
               otherwise print a bare "What is included" over nothing. */
            highlights: highlights.trim() || null,
            preparationNotes: preparationNotes.trim() || null,
          }
        : {}),
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

      {existing && (
        <>
          <hr />

          <h3>Booking terms</h3>
          <p className="tiny muted">
            Kept out of the way when you created this, because none of it should
            stand between a new studio and its first class. Set it here.
          </p>

          <div className="row">
            <div>
              <label htmlFor="svcNotice">Minimum notice (minutes)</label>
              <input
                id="svcNotice"
                type="number"
                min={0}
                max={525_600}
                value={notice}
                onChange={(e) => setNotice(Number(e.target.value))}
              />
            </div>

            <div>
              <label htmlFor="svcHorizon">Bookable up to (days ahead)</label>
              <input
                id="svcHorizon"
                type="number"
                min={1}
                max={730}
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
              />
            </div>
          </div>
          <p className="tiny muted">
            Every availability search is bounded by these: nothing sooner than
            the notice, nothing further out than the horizon.
          </p>

          <div className="row">
            <div>
              <label htmlFor="svcDepositType">Deposit</label>
              <select
                id="svcDepositType"
                value={depositType}
                onChange={(e) =>
                  setDepositType(
                    e.target.value as NonNullable<ServiceDraft['depositType']>,
                  )
                }
              >
                <option value="none">Pay in full</option>
                <option value="percent">Percentage of the price</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>

            {depositType !== 'none' && (
              <div>
                <label htmlFor="svcDepositValue">
                  {depositType === 'percent' ? 'Percent' : 'Amount'}
                </label>
                <input
                  id="svcDepositValue"
                  type="number"
                  min={depositType === 'percent' ? 1 : 0.01}
                  max={depositType === 'percent' ? 100 : undefined}
                  step={depositType === 'percent' ? 1 : 0.01}
                  value={depositValue}
                  placeholder={depositType === 'percent' ? '25' : '0.00'}
                  onChange={(e) => setDepositValue(e.target.value)}
                />
              </div>
            )}
          </div>
          <p className="tiny muted">
            A deposit takes part of the price at checkout and leaves the balance
            owing, which then shows on the customer and on the daily sheet.
          </p>

          <hr />

          {/*
            G3. Written here rather than on the create form for the same reason
            the booking terms are: six questions stand between a new studio and
            its first class, and these are not among them.

            But they ARE the two questions a first-time customer asks, and
            answering them here is the difference between a booking page that
            replaces a phone call and one that causes it.
          */}
          <h3>On your booking page</h3>

          <div className="setting setting-stack">
            <label htmlFor="svcHighlights">What is included</label>
            <textarea
              id="svcHighlights"
              rows={4}
              maxLength={1200}
              value={highlights ?? ''}
              placeholder={'Clay, tools and glazes\nFiring for two pieces\nAn apron, if you forget yours'}
              onChange={(e) => setHighlights(e.target.value)}
            />
            <p className="tiny muted">
              One per line, up to twelve. Shown as a list when somebody is
              choosing a time.
            </p>
          </div>

          <div className="setting setting-stack">
            <label htmlFor="svcPrep">Before you come</label>
            <textarea
              id="svcPrep"
              rows={3}
              maxLength={2000}
              value={preparationNotes ?? ''}
              placeholder="Short nails, closed shoes, and clothes you do not mind losing to clay."
              onChange={(e) => setPreparationNotes(e.target.value)}
            />
            <p className="tiny muted">
              What to wear or bring. The question that otherwise arrives as a
              phone call the morning of the class.
            </p>
          </div>
        </>
      )}

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
