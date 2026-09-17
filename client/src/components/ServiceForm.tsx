import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './layout';

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
 * D4 asked six questions and let the server default the rest, on the argument
 * that the difference between a studio that finishes setup and one that
 * abandons it is how many questions stand between them and a bookable class.
 * The argument was right and the conclusion — hide the rest behind editing —
 * was not: there was no later. `minNoticeMinutes`, `maxHorizonDays`,
 * `depositType` and `depositValue` were all accepted by the API, validated
 * there, driving real behaviour, and written by nothing.
 *
 * SECTIONS solve that problem better than hiding does. Everything is on
 * screen, grouped, and every field has a default that a studio can walk past —
 * a name and a price is still a complete answer. What was gained by hiding
 * them was never fewer decisions, only fewer visible ones.
 *
 * ---
 *
 * Three fields here close the same fault one more time. `categoryId`,
 * `cancellationPolicyId` and `capacityMin` have been accepted and validated
 * by the API since W1 with no form able to write any of them — a studio that
 * would not run a wheel class for one person had no way to say so.
 */

export type ServiceDraft = {
  id?: string;
  name: string;
  description?: string | null;
  shortDescription?: string | null;
  bookingMode: 'APPOINTMENT' | 'EVENT' | 'COURSE_SERIES';
  durationMinutes: number;
  capacityMax: number;
  capacityMin?: number;
  priceCents: number;
  childPriceCents?: number;
  color: string;
  colorAccent?: string | null;
  emoji?: string | null;
  isActive?: boolean;
  minNoticeMinutes?: number;
  maxHorizonDays?: number;
  depositType?: 'none' | 'percent' | 'fixed';
  /** A percentage when depositType is "percent", otherwise cents. */
  depositValue?: number;
  /** G3 — booking-page copy. One highlight per line. */
  highlights?: string | null;
  preparationNotes?: string | null;
  /** Sent with the confirmation rather than shown before booking. */
  bookingInstructions?: string | null;
  meetingPoint?: string | null;
  categoryId?: string | null;
  cancellationPolicyId?: string | null;
  locationId?: string | null;
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

/**
 * Ordered Monday-first, and each carries the iCal code the recurrence rule
 * needs. The prototype stores day NUMBERS and converts at every use; keeping
 * the code on the option means the rule is a join, not a lookup table.
 */
const DAYS = [
  { code: 'MO', label: 'Mon' },
  { code: 'TU', label: 'Tue' },
  { code: 'WE', label: 'Wed' },
  { code: 'TH', label: 'Thu' },
  { code: 'FR', label: 'Fri' },
  { code: 'SA', label: 'Sat' },
  { code: 'SU', label: 'Sun' },
] as const;

/**
 * A studio picks a glyph; there is no asset pipeline here to upload one to.
 *
 * Deliberately OLD code points. A potted plant and the artist ZWJ sequence
 * were in this list and rendered as empty boxes on the machine it was built
 * on — a picker whose options are blank squares is worse than no picker, and
 * the studio only finds out when the card is already on their booking page.
 * Everything here predates Emoji 5.0 and is a single code point.
 */
const EMOJI = [
  '🏺', '🎨', '🖌️', '🔥', '🌿', '☕', '🌺', '✨', '🧵', '📷', '🍰', '🌟',
];

/**
 * Card gradients, as [from, to] pairs.
 *
 * `from` is also the calendar colour, so picking a gradient sets both and the
 * two can never look like they belong to different classes.
 */
const GRADS = [
  ['#4f46e5', '#7c3aed'],
  ['#0891b2', '#0ea5e9'],
  ['#059669', '#10b981'],
  ['#c2410c', '#f59e0b'],
  ['#be123c', '#f43f5e'],
  ['#7c3aed', '#d946ef'],
  ['#a6522c', '#d97706'],
  ['#334155', '#64748b'],
] as const satisfies readonly (readonly [string, string])[];

/** The first gradient, named so the defaults below do not index into it. */
const DEFAULT_COLOR = '#4f46e5';
const DEFAULT_ACCENT = '#7c3aed';

/** Sensible default for a studio that has not opened the time picker yet. */
const DEFAULT_TIME = '18:00';

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
  const [shortDescription, setShortDescription] = useState(
    existing?.shortDescription ?? '',
  );
  const [description, setDescription] = useState(existing?.description ?? '');
  const [bookingMode, setBookingMode] = useState<ServiceDraft['bookingMode']>(
    existing?.bookingMode ?? 'EVENT',
  );
  const [duration, setDuration] = useState(existing?.durationMinutes ?? 120);
  const [capacity, setCapacity] = useState(existing?.capacityMax ?? 8);
  /**
   * Money is held as a STRING, here and for the child rate and the deposit.
   * A number input the user is halfway through clearing produces NaN, and NaN
   * in a controlled input is a React warning and a box they cannot type into.
   */
  const [price, setPrice] = useState(
    existing ? String(existing.priceCents / 100) : '',
  );
  const [childPrice, setChildPrice] = useState(
    existing?.childPriceCents ? String(existing.childPriceCents / 100) : '',
  );

  const [color, setColor] = useState(existing?.color ?? DEFAULT_COLOR);
  const [colorAccent, setColorAccent] = useState(
    existing?.colorAccent ?? DEFAULT_ACCENT,
  );
  const [emoji, setEmoji] = useState(existing?.emoji ?? '🏺');

  const [notice, setNotice] = useState(existing?.minNoticeMinutes ?? 0);
  const [horizon, setHorizon] = useState(existing?.maxHorizonDays ?? 120);
  const [depositType, setDepositType] = useState<
    NonNullable<ServiceDraft['depositType']>
  >(existing?.depositType ?? 'none');
  const [depositValue, setDepositValue] = useState(() => {
    if (!existing?.depositValue) return '';
    return existing.depositType === 'fixed'
      ? String(existing.depositValue / 100)
      : String(existing.depositValue);
  });

  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '');
  const [policyId, setPolicyId] = useState(existing?.cancellationPolicyId ?? '');
  const [locationId, setLocationId] = useState(existing?.locationId ?? '');
  const [meetingPoint, setMeetingPoint] = useState(existing?.meetingPoint ?? '');
  const [minGuests, setMinGuests] = useState(existing?.capacityMin ?? 1);
  const [isActive, setIsActive] = useState(existing?.isActive !== false);

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [policies, setPolicies] = useState<
    { id: string; name: string; isDefault: boolean }[]
  >([]);
  const [locations, setLocations] = useState<
    { id: string; name: string; locationType?: string }[]
  >([]);
  const [currency, setCurrency] = useState('USD');

  const [highlights, setHighlights] = useState(existing?.highlights ?? '');
  const [preparationNotes, setPreparationNotes] = useState(
    existing?.preparationNotes ?? '',
  );
  const [bookingInstructions, setBookingInstructions] = useState(
    existing?.bookingInstructions ?? '',
  );

  /**
   * Availability. Only offered when CREATING.
   *
   * These chips do not describe the service — they schedule it. On save they
   * generate real Sessions through the same endpoint the "Schedule a class"
   * form below uses, so there is exactly one answer anywhere in the product to
   * "when does this run", and it is the sessions.
   *
   * Storing the pattern on the service INSTEAD was the obvious alternative and
   * is the wrong one: it would be a second claim about a class's dates that
   * nothing keeps in step with the sessions actually on the calendar, and the
   * first time a studio cancelled one week the two would disagree with no way
   * to tell which was true.
   *
   * Editing therefore does not show them. The sessions already exist by then
   * and the schedule below is where they are managed.
   */
  const [days, setDays] = useState<string[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  const [newTime, setNewTime] = useState(DEFAULT_TIME);
  const [weeks, setWeeks] = useState(8);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice2, setNotice2] = useState<string | null>(null);

  /* Every picker fails quietly. One that cannot load leaves the rest of the
     form usable, and the server defaults each to null — which is what an
     untouched service already has. */
  useEffect(() => {
    void (async () => {
      try {
        const [cats, pols, locs, org] = await Promise.all([
          api.get<{ categories: { id: string; name: string }[] }>(
            `${base}/services/categories`,
          ),
          api.get<{ policies: { id: string; name: string; isDefault: boolean }[] }>(
            `${base}/cancellation-policies`,
          ),
          api.get<{
            locations: { id: string; name: string; locationType?: string }[];
          }>(`${base}/locations`),
          api.get<{ organization: { currency?: string } }>(base),
        ]);
        setCategories(cats.categories ?? []);
        setPolicies(pols.policies ?? []);

        const found = locs.locations ?? [];
        setLocations(found);

        /*
          A studio that has only one place to hold a class is not asked which.

          This is not a convenience. Public availability filters sessions by
          the location the page has selected, so a class scheduled with NO
          location is scheduled INVISIBLY — it sits on the calendar, the
          dashboard counts its seats, and no customer can ever see it. This
          removes the way to reach that state without meaning to.

          Falling back to the only FIXED location matters as much as the
          single-location case, and covers more studios: a building plus a
          mobile service area is the ordinary shape — it is what the seed
          models — and "one location" is false for all of them. A class is
          held somewhere; a SERVICE_AREA is where a van goes. Picking the
          building is the answer a studio would have given.

          Deliberately NOT defaulting when there are two buildings. That is a
          real question with a real answer only the studio has, and guessing
          it would put classes in the wrong one silently, which is worse than
          asking.

          Only when creating: an existing service's blank means somebody chose
          blank, and overwriting that on open would move classes.
        */
        if (!existing) {
          const fixed = found.filter((l) => l.locationType === 'FIXED');
          const only =
            found.length === 1 ? found[0] : fixed.length === 1 ? fixed[0] : null;
          if (only) setLocationId(only.id);
        }

        if (org.organization?.currency) setCurrency(org.organization.currency);
      } catch {
        /* Left empty; each field then offers only its "none" option. */
      }
    })();
  }, [base, existing]);

  /**
   * An appointment is one-to-one by definition and the server refuses anything
   * else — `capacityMax === 1` is a schema-level rule, not a convention. So
   * capacity, minimum guests and the child rate disappear rather than being
   * submitted and rejected.
   */
  const isAppointment = bookingMode === 'APPOINTMENT';

  const adultCents = Math.round(Number(price || 0) * 100);
  const childCents = Math.round(Number(childPrice || 0) * 100);

  function toggleDay(code: string) {
    setDays((current) =>
      current.includes(code)
        ? current.filter((d) => d !== code)
        : [...current, code],
    );
  }

  function addTime() {
    if (!newTime) return;
    setTimes((current) =>
      current.includes(newTime) ? current : [...current, newTime].sort(),
    );
  }

  /**
   * Turns the chips into sessions.
   *
   * One call PER START TIME, because a recurrence rule carries days but not
   * times — "Tuesdays and Thursdays at 18:00 and 20:00" is two weekly rules,
   * not one. `count` is sessions, not weeks, so it multiplies out by the
   * number of days chosen.
   *
   * Failures here are reported and NOT rethrown. The activity has already
   * been created by this point and it is a real, editable, sellable thing;
   * throwing would leave the studio looking at an error next to a class that
   * did in fact save, and they would create it again.
   */
  async function generateSessions(serviceTypeId: string): Promise<string | null> {
    if (days.length === 0 || times.length === 0) return null;

    const rrule = `FREQ=WEEKLY;BYDAY=${days.join(',')}`;
    const count = Math.min(52, days.length * weeks);
    const startLocalDate = new Date().toISOString().slice(0, 10);

    let created = 0;
    let failed = 0;

    for (const localStartTime of times) {
      try {
        const res = await api.post<{ created: { id: string }[] }>(`${base}/sessions`, {
          serviceTypeId,
          startLocalDate,
          localStartTime,
          capacity: isAppointment ? 1 : capacity,
          ...(locationId ? { locationId } : {}),
          ...(count >= 2 ? { repeat: { rrule, count } } : {}),
        });
        created += res.created?.length ?? 0;
      } catch {
        failed += 1;
      }
    }

    if (created === 0) {
      return 'The activity was saved, but no classes could be scheduled. Add them below.';
    }
    if (failed > 0) {
      return `${created} classes scheduled. Some start times could not be — add them below.`;
    }
    return `${created} classes scheduled.`;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice2(null);

    const body = {
      name: name.trim(),
      shortDescription: shortDescription.trim() || null,
      description: description.trim() || undefined,
      bookingMode,
      durationMinutes: duration,
      capacityMax: isAppointment ? 1 : capacity,
      /* An appointment is one-to-one, so a minimum above one could never be
         met. Everything else takes what the form was given. */
      capacityMin: isAppointment ? 1 : Math.min(minGuests, capacity),
      isActive,
      categoryId: categoryId || null,
      cancellationPolicyId: policyId || null,
      /* Explicit null rather than omitted: the server reads the key's presence
         as "change this", so omitting it would make "nowhere in particular"
         impossible to say once a location had been set. */
      locationId: locationId || null,
      meetingPoint: meetingPoint.trim() || null,
      // Entered in whole currency, stored in cents — the boundary is here so
      // no caller downstream has to remember which unit it is holding.
      priceCents: adultCents,
      /* Zero means adults only. An appointment has one seat and cannot have a
         party, so a child rate on one could never apply. */
      childPriceCents: isAppointment ? 0 : childCents,
      color,
      colorAccent,
      emoji: emoji || null,
      minNoticeMinutes: notice,
      maxHorizonDays: horizon,
      depositType,
      // Percent goes as typed; a fixed deposit is money, so it crosses into
      // cents at the same boundary `price` does.
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
      bookingInstructions: bookingInstructions.trim() || null,
    };

    try {
      if (existing?.id) {
        await api.patch(`${base}/services/${existing.id}`, body);
      } else {
        const res = await api.post<{ service: { id: string } }>(
          `${base}/services`,
          body,
        );
        const scheduled = await generateSessions(res.service.id);
        if (scheduled) setNotice2(scheduled);
      }
      onSaved();
    } catch (err) {
      // The server's message is the useful one — it knows about capacity
      // bounds, deposit rules and the appointment constraint.
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  const title = existing ? `Edit ${existing.name}` : 'Create activity';
  const subtitle = existing
    ? 'Changes go live on your booking page immediately.'
    : 'It appears on your booking page as soon as it is active.';

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      size="wide"
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form="serviceForm"
            className="primary"
            disabled={busy || !name.trim()}
          >
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Create activity'}
          </button>
        </>
      }
    >
      {/* The buttons live in the modal's footer, outside this element, so they
          reach the form through `form=` rather than by nesting. */}
      <form id="serviceForm" className="service-form" onSubmit={submit}>
        <h3 className="form-section">Basics</h3>

        <div className="setting setting-stack">
          <label htmlFor="svcName">Activity name</label>
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
          <label htmlFor="svcShort">Short description</label>
          <input
            id="svcShort"
            maxLength={200}
            value={shortDescription ?? ''}
            placeholder="One line that sells it on the booking page"
            onChange={(e) => setShortDescription(e.target.value)}
          />
          <p className="tiny muted">
            What fits on the card, next to everything else you offer.
          </p>
        </div>

        <div className="setting setting-stack">
          <label htmlFor="svcDesc">Full description</label>
          <textarea
            id="svcDesc"
            rows={3}
            maxLength={4000}
            value={description ?? ''}
            placeholder="What happens in the session, in order, and what a beginner should expect."
            onChange={(e) => setDescription(e.target.value)}
          />
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

        <div className="form-row">
          <div className="setting setting-stack">
            <label htmlFor="svcCategory">Category</label>
            <select
              id="svcCategory"
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="tiny muted">
              {categories.length === 0
                ? 'None set up. They group classes on your booking page.'
                : 'Groups classes on your booking page.'}
            </p>
          </div>

          <div className="setting setting-stack">
            <label htmlFor="svcStatus">Status</label>
            <select
              id="svcStatus"
              value={isActive ? 'active' : 'off'}
              onChange={(e) => setIsActive(e.target.value === 'active')}
            >
              <option value="active">Active</option>
              <option value="off">Draft</option>
            </select>
            <p className="tiny muted">
              {isActive
                ? 'Bookable on your page.'
                : 'Hidden from your page. Existing bookings stand.'}
            </p>
          </div>
        </div>

        <h3 className="form-section">Pricing &amp; capacity</h3>

        <div className="row">
          <div>
            <label htmlFor="svcPrice">{isAppointment ? 'Price' : 'Adult price'}</label>
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

          {!isAppointment && (
            <div>
              <label htmlFor="svcChildPrice">
                Child price <span className="tiny muted">0 = adults only</span>
              </label>
              <input
                id="svcChildPrice"
                type="number"
                min={0}
                step="0.01"
                value={childPrice}
                placeholder="0.00"
                onChange={(e) => setChildPrice(e.target.value)}
              />
            </div>
          )}

          <div>
            {/*
              Read only, and shown rather than hidden.

              The prototype offers a currency picker per activity. Ours is one
              setting for the whole studio — it is what Stripe was connected
              with, and a studio cannot price one class in dollars and take
              the money in euros. Leaving the field out entirely would look
              like an omission; showing where it actually lives answers the
              question instead.
            */}
            <label htmlFor="svcCurrency">Currency</label>
            <input id="svcCurrency" value={currency} readOnly disabled />
          </div>
        </div>

        {!isAppointment && childCents > adultCents && adultCents > 0 && (
          <p className="tiny muted">
            The child price is above the adult price. That is allowed — a
            children's workshop with a discounted accompanying adult is a real
            thing — but it is usually a typo.
          </p>
        )}

        <div className="row">
          <div>
            <label htmlFor="svcDuration">Duration (minutes)</label>
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
              <label htmlFor="svcCapacity">Maximum capacity</label>
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

          {!isAppointment && (
            <div>
              {/* `capacityMin` has been accepted and validated by the API since
                  W1 and no form ever sent it. A studio that will not run a
                  wheel class for one person had no way to say so. */}
              <label htmlFor="svcMinGuests">Minimum guests</label>
              <input
                id="svcMinGuests"
                type="number"
                min={1}
                max={capacity}
                value={minGuests}
                onChange={(e) =>
                  setMinGuests(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </div>
          )}
        </div>

        <h3 className="form-section">Where</h3>

        <div className="form-row">
          <div className="setting setting-stack">
            <label htmlFor="svcLocation">Location</label>
            <select
              id="svcLocation"
              value={locationId ?? ''}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Anywhere you run it</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <p className="tiny muted">
              {locations.length === 0
                ? 'None set up. Add them in Settings.'
                : 'Where this one runs.'}
            </p>
          </div>

          <div className="setting setting-stack">
            <label htmlFor="svcMeeting">Meeting point</label>
            <input
              id="svcMeeting"
              maxLength={300}
              value={meetingPoint ?? ''}
              placeholder="Second door on the left, ring the bell"
              onChange={(e) => setMeetingPoint(e.target.value)}
            />
            <p className="tiny muted">
              The bit a map cannot tell them. Sent with the confirmation.
            </p>
          </div>
        </div>

        {!existing && (
          <>
            <h3 className="form-section">Availability</h3>

            <div className="setting setting-stack">
              <label>Available days</label>
              <div className="chip-group">
                {DAYS.map((d) => (
                  <button
                    key={d.code}
                    type="button"
                    className={days.includes(d.code) ? 'chip on' : 'chip'}
                    aria-pressed={days.includes(d.code)}
                    onClick={() => toggleDay(d.code)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="setting setting-stack">
              <label htmlFor="svcNewTime">Start times</label>
              <div className="chip-group">
                {times.length === 0 ? (
                  <span className="tiny muted">No start times yet.</span>
                ) : (
                  times.map((t) => (
                    <span key={t} className="chip on">
                      {t}
                      <button
                        type="button"
                        aria-label={`Remove ${t}`}
                        className="chip-x"
                        onClick={() =>
                          setTimes((cur) => cur.filter((x) => x !== t))
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="row">
                <input
                  id="svcNewTime"
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                />
                <button type="button" onClick={addTime}>
                  Add time
                </button>
              </div>
            </div>

            <div className="setting setting-stack">
              <label htmlFor="svcWeeks">Schedule for</label>
              <select
                id="svcWeeks"
                value={weeks}
                onChange={(e) => setWeeks(Number(e.target.value))}
              >
                <option value={4}>The next 4 weeks</option>
                <option value={8}>The next 8 weeks</option>
                <option value={12}>The next 12 weeks</option>
              </select>
              <p className="tiny muted">
                {days.length === 0 || times.length === 0
                  ? 'Pick days and times and the classes are put on your calendar when you save. Or leave this and schedule them below.'
                  : `${Math.min(52, days.length * weeks) * times.length} classes go on your calendar when you save.`}
              </p>
              {days.length > 0 && times.length > 0 && !locationId && (
                <p className="tiny muted">
                  Pick a location above, or these classes will not appear on
                  your booking page — it only shows classes at a location.
                </p>
              )}
            </div>
          </>
        )}

        <h3 className="form-section">Presentation</h3>

        <div className="setting setting-stack">
          <label>Icon</label>
          {/* A picked glyph rather than an upload: there is no asset pipeline
              in this product, and a booking page half-rendering broken images
              is worse than one with no pictures at all. */}
          <div className="chip-group">
            {EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                className={emoji === e ? 'chip on' : 'chip'}
                aria-pressed={emoji === e}
                aria-label={`Icon ${e}`}
                onClick={() => setEmoji(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="setting setting-stack">
          <label>Colour</label>
          {/* Picking a gradient sets the calendar colour too — they are the
              same class, and two independently chosen colours look like two. */}
          <div className="chip-group">
            {GRADS.map(([from, to]) => (
              <button
                key={from}
                type="button"
                className={color === from ? 'chip chip-grad on' : 'chip chip-grad'}
                aria-pressed={color === from}
                aria-label={`Colour ${from}`}
                style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
                onClick={() => {
                  setColor(from);
                  setColorAccent(to);
                }}
              />
            ))}
          </div>
          <p className="tiny muted">
            The card on your booking page, and the block on your calendar.
          </p>
        </div>

        <h3 className="form-section">Policies</h3>

        <div className="setting setting-stack">
          <label htmlFor="svcPolicy">Cancellation policy</label>
          {/*
            A choice, not free text. The prototype types its terms into a
            textarea; ours are structured — each policy carries a refund ladder
            that `evaluatePolicy` actually applies when somebody cancels. Prose
            would look the same on the page and refund nobody.
          */}
          <select
            id="svcPolicy"
            value={policyId ?? ''}
            onChange={(e) => setPolicyId(e.target.value)}
          >
            <option value="">
              {policies.some((p) => p.isDefault)
                ? 'Use the studio default'
                : 'No policy — free cancellation'}
            </option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <p className="tiny muted">
            {policies.length === 0
              ? 'None set up. Add them in Settings.'
              : 'Shown before they pay, and applied when they cancel.'}
          </p>
        </div>

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
          Every availability search is bounded by these: nothing sooner than the
          notice, nothing further out than the horizon.
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

        <div className="setting setting-stack">
          <label htmlFor="svcHighlights">What is included</label>
          <textarea
            id="svcHighlights"
            rows={4}
            maxLength={1200}
            value={highlights ?? ''}
            placeholder={
              'Clay, tools and glazes\nFiring for two pieces\nAn apron, if you forget yours'
            }
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

        <div className="setting setting-stack">
          <label htmlFor="svcInstructions">Booking instructions</label>
          <textarea
            id="svcInstructions"
            rows={3}
            maxLength={2000}
            value={bookingInstructions ?? ''}
            placeholder="Park on Kiln Street. If the door is locked, ring the top bell."
            onChange={(e) => setBookingInstructions(e.target.value)}
          />
          <p className="tiny muted">
            Sent with the confirmation — written for somebody who has already
            booked, so it never appears on your booking page.
          </p>
        </div>

        {notice2 && <div className="alert">{notice2}</div>}

        {error && (
          <div className="alert danger" role="alert">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
