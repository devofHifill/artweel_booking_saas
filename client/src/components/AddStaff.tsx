import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Modal } from './layout';
import { ImagePicker } from './ImagePicker';
import { TIMEZONES } from './settings-sections';

/**
 * Add staff, in steps (docs/STAFF-STEPS-PLAN.md).
 *
 * The one long form saved a person, not someone who could be booked: what
 * they teach was chips on their card afterwards and their hours a separate
 * panel, so everyone added after the first instructor started as "No hours
 * set". The steps ask for all of it in the order a studio thinks of it, and
 * the person, their activities and their week are saved in one request: all
 * of it or none of it. The login invite goes afterwards, on its own, so a
 * mail that fails to send never undoes the person.
 *
 * Same look as Create activity: the step names along the top, Back and Next
 * at the bottom, Enter moving on.
 */

type Option = { id: string; name: string; isActive?: boolean };

const STEPS = ['Who', 'What they teach', 'Hours', 'Profile', 'Review'] as const;

const DAYS = [
  { code: 'MO', label: 'Mon' },
  { code: 'TU', label: 'Tue' },
  { code: 'WE', label: 'Wed' },
  { code: 'TH', label: 'Thu' },
  { code: 'FR', label: 'Fri' },
  { code: 'SA', label: 'Sat' },
  { code: 'SU', label: 'Sun' },
];

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** 10:00 → "10am", 17:30 → "5:30pm". For the review, not the inputs. */
function clock(hhmm: string) {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
}

function daysText(codes: string[]) {
  const ordered = DAYS.filter((d) => codes.includes(d.code));
  if (ordered.length === 7) return 'Every day';
  const idx = ordered.map((d) => DAYS.indexOf(d));
  const runs = idx.length > 2 && idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1);
  return runs
    ? `${ordered[0]!.label} to ${ordered[ordered.length - 1]!.label}`
    : ordered.map((d) => d.label).join(', ');
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Someone being edited (Phase 2): the fields the steps show, as the list holds them. */
export type StaffForEdit = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string | null;
  bio?: string | null;
  photoKey: string | null;
  photoAlt: string | null;
  color: string;
  isPublic: boolean;
  maxBookingsPerDay: number;
  timezone: string;
  staffLocations: { location: { id: string } }[];
  staffServices: { serviceType: { id: string } }[];
};

type Rule = { id: string; ruleType: string; rrule: string; startMinute: number; endMinute: number };

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function AddStaff({
  base,
  existing,
  onClose,
  onAdded,
  onOpenHours,
}: {
  base: string;
  /** Present when editing (Phase 2): the same steps, all reachable at once. */
  existing?: StaffForEdit;
  onClose: () => void;
  /** After the person is saved, so the page can reload its list. */
  onAdded: () => void;
  /** Editing: hours have their own panel; this opens it after saving. */
  onOpenHours?: (staff: { id: string; name: string }) => void;
}) {
  const editing = Boolean(existing);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(editing ? STEPS.length - 1 : 0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Who
  const [name, setName] = useState(existing?.name ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [role, setRole] = useState(existing?.role ?? '');

  // What they teach, and where
  const [services, setServices] = useState<Option[] | null>(null);
  const [locations, setLocations] = useState<Option[]>([]);
  const [teaches, setTeaches] = useState<string[]>(
    existing?.staffServices.map((s) => s.serviceType.id) ?? [],
  );
  /** Null means every location, the server's default for someone new. */
  const [worksAt, setWorksAt] = useState<string[] | null>(
    existing ? existing.staffLocations.map((l) => l.location.id) : null,
  );

  // Hours
  const [setHours, setSetHours] = useState(true);
  const [days, setDays] = useState<string[]>(['TU', 'WE', 'TH', 'FR', 'SA']);
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('18:00');
  const [timezone, setTimezone] = useState(existing?.timezone ?? '');
  /** Editing: their current weekly patterns, shown rather than re-asked. */
  const [rules, setRules] = useState<Rule[] | null>(null);

  // Profile
  const [photo, setPhoto] = useState<{ key: string | null; alt: string }>({
    key: existing?.photoKey ?? null,
    alt: existing?.photoAlt ?? '',
  });
  const [bio, setBio] = useState(existing?.bio ?? '');
  const [color, setColor] = useState(existing?.color ?? '#a6522c');
  const [isPublic, setIsPublic] = useState(existing?.isPublic ?? true);
  const [maxPerDay, setMaxPerDay] = useState(existing?.maxBookingsPerDay ?? 0);

  // Review and after
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null);
  const [inviteResult, setInviteResult] = useState<
    { ok: true; url: string } | { ok: false; message: string } | null
  >(null);

  /** The plan's staff limit, checked before step one rather than at Add. */
  const [full, setFull] = useState<{ planName: string; max: number } | null>(null);

  useEffect(() => {
    api
      /* Hidden activities too: someone can be lined up to teach one before it
         is published. */
      .get<{ services: Option[] }>(`${base}/services?includeInactive=true`)
      .then((res) => setServices(res.services ?? []))
      .catch(() => setServices([]));
    api
      .get<{ locations: Option[] }>(`${base}/locations`)
      .then((res) => setLocations(res.locations ?? []))
      .catch(() => setLocations([]));
    if (existing) {
      api
        .get<{ rules: Rule[] }>(`${base}/schedules/${existing.id}/rules`)
        .then((res) => setRules((res.rules ?? []).filter((r) => r.ruleType === 'WORKING')))
        .catch(() => setRules([]));
      return;
    }
    api
      .get<{
        billing: {
          planName: string;
          usage: { staff?: number };
          limits: { maxStaff?: number | null };
        };
      }>(`${base}/billing`)
      .then((res) => {
        const max = res.billing.limits.maxStaff ?? null;
        if (max !== null && (res.billing.usage.staff ?? 0) >= max) {
          setFull({ planName: res.billing.planName, max });
        }
      })
      .catch(() => {
        /* Unknown: let the server say so on Add. */
      });
  }, [base, existing]);

  const stepName = STEPS[step]!;
  const last = step === STEPS.length - 1;

  /** The current step's problems, by field. Empty means it can move on. */
  function check(at: (typeof STEPS)[number]): Record<string, string> {
    const found: Record<string, string> = {};
    if (at === 'Who') {
      if (!name.trim()) found.name = 'Add their name.';
      if (!EMAIL.test(email.trim())) found.email = 'Add an email address that works.';
    }
    if (at === 'Hours' && setHours && !editing) {
      if (days.length === 0) found.days = 'Pick at least one day, or choose "Set hours later".';
      if (toMinutes(end) <= toMinutes(start)) found.time = 'The end time must be after the start time.';
    }
    if (at === 'Profile' && photo.key && !photo.alt.trim()) {
      found.photo = 'Describe the photo. It is read aloud to people who cannot see it.';
    }
    return found;
  }

  function goTo(index: number) {
    setErrors({});
    setServerError(null);
    setStep(index);
    setReached((r) => Math.max(r, index));
  }

  function next() {
    const found = check(stepName);
    setErrors(found);
    if (Object.keys(found).length === 0) goTo(step + 1);
  }

  async function sendInvite(person: { name: string; email: string }) {
    setInviteResult(null);
    try {
      const res = await api.post<{ inviteUrl: string }>(`${base}/invitations`, {
        email: person.email,
        name: person.name,
        role: 'INSTRUCTOR',
      });
      setInviteResult({ ok: true, url: res.inviteUrl });
    } catch (err) {
      setInviteResult({
        ok: false,
        message: err instanceof Error ? err.message : 'The invite did not send.',
      });
    }
  }

  /** Editing: one PATCH with the details, what they teach and where they work. */
  async function saveEdit(then?: 'hours') {
    for (const [index, at] of STEPS.entries()) {
      const found = check(at);
      if (Object.keys(found).length > 0) {
        setStep(index);
        setErrors(found);
        return;
      }
    }
    if (!existing) return;

    setBusy(true);
    setServerError(null);
    try {
      await api.patch(`${base}/staff/${existing.id}`, {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        role: role.trim() || null,
        bio: bio.trim() || null,
        photoKey: photo.key,
        photoAlt: photo.key ? photo.alt.trim() : null,
        color,
        isPublic,
        maxBookingsPerDay: Number(maxPerDay) || 0,
        ...(timezone ? { timezone } : {}),
        serviceTypeIds: teaches,
        ...(locations.length > 0 && worksAt ? { locationIds: worksAt } : {}),
      });
      onAdded();
      onClose();
      if (then === 'hours') onOpenHours?.({ id: existing.id, name: name.trim() });
    } catch (err) {
      setServerError(
        `${err instanceof Error ? err.message : 'Could not save.'} Nothing was changed.`,
      );
      setBusy(false);
    }
  }

  async function add() {
    /* Every step again: a step reached from the bar may never have been
       checked with Next. */
    for (const [index, at] of STEPS.entries()) {
      const found = check(at);
      if (Object.keys(found).length > 0) {
        setStep(index);
        setErrors(found);
        return;
      }
    }

    setBusy(true);
    setServerError(null);
    try {
      const res = await api.post<{ staff: { id: string; name: string; email: string } }>(
        `${base}/staff`,
        {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          role: role.trim() || null,
          bio: bio.trim() || null,
          photoKey: photo.key,
          photoAlt: photo.key ? photo.alt.trim() : null,
          color,
          isPublic,
          maxBookingsPerDay: Number(maxPerDay) || 0,
          ...(timezone ? { timezone } : {}),
          ...(worksAt ? { locationIds: worksAt } : {}),
          ...(teaches.length ? { serviceTypeIds: teaches } : {}),
          ...(setHours
            ? {
                weeklyHours: {
                  days: DAYS.map((d) => d.code).filter((c) => days.includes(c)),
                  startMinute: toMinutes(start),
                  endMinute: toMinutes(end),
                },
              }
            : {}),
        },
      );
      setAdded({ id: res.staff.id, name: res.staff.name });
      onAdded();
      if (invite) await sendInvite(res.staff);
    } catch (err) {
      setServerError(
        `${err instanceof Error ? err.message : 'Could not add them.'} Nothing was saved.`,
      );
    } finally {
      setBusy(false);
    }
  }

  // --- After Add ------------------------------------------------------------

  if (added) {
    return (
      <Modal
        title={`${added.name} is added`}
        onClose={onClose}
        footer={
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <ul className="added-summary">
          <li>{teaches.length ? `Teaches ${teaches.length} ${teaches.length === 1 ? 'activity' : 'activities'}.` : 'Teaches nothing yet. Choose on their card.'}</li>
          <li>
            {setHours
              ? `Works ${daysText(days)}, ${clock(start)} to ${clock(end)}. Customers can book them.`
              : 'No hours yet, so customers cannot book them. Use Hours on their card.'}
          </li>
        </ul>
        {invite && !inviteResult && <p className="muted">Sending the login invite…</p>}
        {inviteResult?.ok && (
          <div className="alert" role="status">
            Login invite sent to {email.trim()}. If it does not arrive, send them this link:
            <input
              className="invite-link"
              readOnly
              value={inviteResult.url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Invite link"
            />
          </div>
        )}
        {inviteResult && !inviteResult.ok && (
          <div className="err" role="alert">
            Added, but the invite did not send: {inviteResult.message}{' '}
            <button
              type="button"
              className="link"
              onClick={() => void sendInvite({ name: added.name, email: email.trim() })}
            >
              Try again
            </button>
          </div>
        )}
      </Modal>
    );
  }

  // --- The plan is full -----------------------------------------------------

  if (full && !editing) {
    return (
      <Modal title="Add staff" onClose={onClose}>
        <p>
          Your {full.planName} plan has room for {full.max}{' '}
          {full.max === 1 ? 'instructor' : 'instructors'}, and that place is taken. Deactivate
          someone, or upgrade to add more.
        </p>
        <p>
          <Link to="/billing" onClick={onClose}>
            See plans →
          </Link>
        </p>
      </Modal>
    );
  }

  // --- The steps ------------------------------------------------------------

  const fieldError = (key: string) =>
    errors[key] ? (
      <p className="field-error" role="alert">
        {errors[key]}
      </p>
    ) : null;

  const allLocations = locations.map((l) => l.id);
  const atLocations = worksAt ?? allLocations;

  return (
    <Modal
      title={existing ? `Edit ${existing.name}` : 'Add staff'}
      subtitle={
        <span className="step-bar" role="list" aria-label="Steps">
          {STEPS.map((label, index) => (
            <span
              role="listitem"
              key={label}
              className={index === step ? 'on' : index <= reached ? 'done' : undefined}
            >
              <button
                type="button"
                disabled={index > reached || index === step}
                aria-current={index === step ? 'step' : undefined}
                onClick={() => goTo(index)}
              >
                {label}
              </button>
            </span>
          ))}
        </span>
      }
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={() => (step === 0 ? onClose() : goTo(step - 1))} disabled={busy}>
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          {/* Editing saves from any step: the steps are a way to find a
              field, not a sequence that must be walked again. */}
          {editing && !last && (
            <button type="button" onClick={next}>
              Next
            </button>
          )}
          {editing ? (
            <button type="button" className="primary" onClick={() => void saveEdit()} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          ) : last ? (
            <button type="button" className="primary" onClick={() => void add()} disabled={busy}>
              {busy ? 'Adding…' : `Add ${name.trim() || 'them'}`}
            </button>
          ) : (
            <button type="button" className="primary" onClick={next}>
              Next
            </button>
          )}
        </>
      }
    >
      <form
        className="step-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (editing) void saveEdit();
          else if (last) void add();
          else next();
        }}
      >
        {/* Enter on a field moves on, as Next does. */}
        <button type="submit" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />

        {stepName === 'Who' && (
          <>
            <div className="form-row">
              <div className="setting setting-stack step-field">
                <label htmlFor="stName">Name</label>
                <input id="stName" value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} />
                {fieldError('name')}
              </div>
              <div className="setting setting-stack step-field">
                <label htmlFor="stEmail">Email</label>
                <input id="stEmail" type="email" value={email} maxLength={255} onChange={(e) => setEmail(e.target.value)} />
                {fieldError('email') ?? (
                  <p className="tiny muted">Where their schedule and login invite go.</p>
                )}
              </div>
            </div>
            <div className="form-row">
              <div className="setting setting-stack step-field">
                <label htmlFor="stPhone">Phone</label>
                <input id="stPhone" type="tel" value={phone} maxLength={32} placeholder="Optional" onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="setting setting-stack step-field">
                <label htmlFor="stRole">Role</label>
                <input id="stRole" value={role} maxLength={80} placeholder="Wheel instructor" onChange={(e) => setRole(e.target.value)} />
                <p className="tiny muted">Two or three words, shown under their name.</p>
              </div>
            </div>
          </>
        )}

        {stepName === 'What they teach' && (
          <>
            <div className="setting setting-stack step-field" role="group" aria-labelledby="stTeachLabel">
              <span id="stTeachLabel" className="step-label">Activities they teach</span>
              {services === null ? (
                <p className="tiny muted">Loading…</p>
              ) : services.length === 0 ? (
                <p className="tiny muted">
                  No activities yet. You can choose these later on their card.
                </p>
              ) : (
                <span className="chips">
                  {services.map((s) => {
                    const on = teaches.includes(s.id);
                    return (
                      <button
                        type="button"
                        key={s.id}
                        className={`chip ${on ? 'on' : ''}`.trim()}
                        aria-pressed={on}
                        onClick={() =>
                          setTeaches(on ? teaches.filter((t) => t !== s.id) : [...teaches, s.id])
                        }
                      >
                        {s.isActive === false ? `${s.name} (hidden)` : s.name}
                      </button>
                    );
                  })}
                </span>
              )}
              <p className="tiny muted">Optional. Only these are offered with them on your booking page.</p>
            </div>

            {locations.length > 1 && (
              <div className="setting setting-stack step-field" role="group" aria-labelledby="stWhereLabel">
                <span id="stWhereLabel" className="step-label">Works at</span>
                <span className="chips">
                  {locations.map((l) => {
                    const on = atLocations.includes(l.id);
                    return (
                      <button
                        type="button"
                        key={l.id}
                        className={`chip ${on ? 'on' : ''}`.trim()}
                        aria-pressed={on}
                        onClick={() =>
                          setWorksAt(on ? atLocations.filter((x) => x !== l.id) : [...atLocations, l.id])
                        }
                      >
                        {l.name}
                      </button>
                    );
                  })}
                </span>
                {atLocations.length === 0 && (
                  <p className="not-bookable">Not offered for One to one bookings anywhere</p>
                )}
              </div>
            )}
          </>
        )}

        {stepName === 'Hours' && editing && (
          <>
            {/* Shown, not re-asked: someone can have several weekly patterns and
                days off, which the Hours panel already edits in full. */}
            <div className="setting setting-stack step-field">
              <span className="step-label">Their week</span>
              {rules === null ? (
                <p className="tiny muted">Loading…</p>
              ) : rules.length === 0 ? (
                <p className="not-bookable">No hours yet, so customers cannot book them.</p>
              ) : (
                <ul className="added-summary">
                  {rules.map((r) => (
                    <li key={r.id}>
                      {daysText(/BYDAY=([A-Z,]+)/.exec(r.rrule)?.[1]?.split(',') ?? [])},{' '}
                      {clock(hhmm(r.startMinute))} to {clock(hhmm(r.endMinute))}
                    </li>
                  ))}
                </ul>
              )}
              {onOpenHours && (
                <p>
                  <button type="button" disabled={busy} onClick={() => void saveEdit('hours')}>
                    Save and open Hours
                  </button>
                </p>
              )}
              <p className="tiny muted">Days off, breaks and other patterns are in Hours too.</p>
            </div>
            <div className="setting setting-stack step-field">
              <label htmlFor="stTzEdit">Timezone</label>
              <select id="stTzEdit" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {timezone && !TIMEZONES.includes(timezone) && (
                  <option value={timezone}>{timezone.replace('_', ' ')}</option>
                )}
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace('_', ' ')}
                  </option>
                ))}
              </select>
              <p className="tiny muted">
                Their hours are read in this timezone. Changing it keeps the same hours on the clock.
              </p>
            </div>
          </>
        )}

        {stepName === 'Hours' && !editing && (
          <>
            <div className="setting setting-stack step-field" role="radiogroup" aria-label="Working hours">
              <label className="check">
                <input type="radio" checked={setHours} onChange={() => setSetHours(true)} />
                Set their usual week now
              </label>
              <label className="check">
                <input type="radio" checked={!setHours} onChange={() => setSetHours(false)} />
                Set hours later
              </label>
              {!setHours && (
                <p className="not-bookable">
                  Until they have hours, customers cannot book them.
                </p>
              )}
            </div>

            {setHours && (
              <>
                <div className="setting setting-stack step-field" role="group" aria-labelledby="stDaysLabel">
                  <span id="stDaysLabel" className="step-label">Days</span>
                  <span className="chips">
                    {DAYS.map((d) => {
                      const on = days.includes(d.code);
                      return (
                        <button
                          type="button"
                          key={d.code}
                          className={`chip ${on ? 'on' : ''}`.trim()}
                          aria-pressed={on}
                          onClick={() => setDays(on ? days.filter((c) => c !== d.code) : [...days, d.code])}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </span>
                  {fieldError('days')}
                </div>
                <div className="form-row">
                  <div className="setting setting-stack step-field">
                    <label htmlFor="stFrom">From</label>
                    <input id="stFrom" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                  </div>
                  <div className="setting setting-stack step-field">
                    <label htmlFor="stUntil">Until</label>
                    <input id="stUntil" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
                    {fieldError('time')}
                  </div>
                </div>
                <div className="setting setting-stack step-field">
                  <label htmlFor="stTz">Timezone</label>
                  <select id="stTz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    <option value="">Same as the studio</option>
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                  <p className="tiny muted">
                    Days off, breaks and a second pattern (say, Saturday afternoons) go in Hours on
                    their card afterwards.
                  </p>
                </div>
              </>
            )}
          </>
        )}

        {stepName === 'Profile' && (
          <>
            <ImagePicker
              base={base}
              id="stPhoto"
              label="Photo"
              shape="square"
              value={photo}
              onChange={(v) => setPhoto({ key: v.key, alt: v.alt })}
              hint="Shown on your booking page and team section. A head-and-shoulders photo works best."
            />
            {fieldError('photo')}
            <div className="setting setting-stack step-field">
              <label htmlFor="stBio">About them</label>
              <textarea
                id="stBio"
                rows={4}
                maxLength={4000}
                value={bio}
                placeholder="A line or two customers read before they book: what they make, how long they have taught."
                onChange={(e) => setBio(e.target.value)}
              />
              <p className="tiny muted">Optional.</p>
            </div>
            <div className="form-row">
              <div className="setting setting-stack step-field">
                <label htmlFor="stColour">Calendar colour</label>
                <input id="stColour" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </div>
              <div className="setting setting-stack step-field">
                <span className="step-label">Booking page</span>
                <label className="check">
                  <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                  Show them on the booking page
                </label>
              </div>
            </div>
            <details className="more-options">
              <summary>More options</summary>
              <div className="setting setting-stack step-field">
                <label htmlFor="stMax">Most bookings in a day</label>
                <input
                  id="stMax"
                  type="number"
                  min={0}
                  max={100}
                  value={maxPerDay}
                  onChange={(e) => setMaxPerDay(Number(e.target.value))}
                />
                <p className="tiny muted">0 means no limit.</p>
              </div>
            </details>
          </>
        )}

        {stepName === 'Review' && (
          <>
            <dl className="review-list">
              <dt>Who</dt>
              <dd>
                <b>{name.trim()}</b>
                {role.trim() && ` · ${role.trim()}`}
                <br />
                {email.trim()}
                {phone.trim() && ` · ${phone.trim()}`}
              </dd>
              <dt>Teaches</dt>
              <dd>
                {teaches.length
                  ? (services ?? []).filter((s) => teaches.includes(s.id)).map((s) => s.name).join(', ')
                  : 'Nothing yet'}
              </dd>
              {locations.length > 1 && (
                <>
                  <dt>Works at</dt>
                  <dd>
                    {atLocations.length === locations.length
                      ? 'Every location'
                      : locations.filter((l) => atLocations.includes(l.id)).map((l) => l.name).join(', ') ||
                        'Nowhere'}
                  </dd>
                </>
              )}
              <dt>Hours</dt>
              <dd>
                {editing ? (
                  rules && rules.length > 0 ? (
                    rules
                      .map(
                        (r) =>
                          `${daysText(/BYDAY=([A-Z,]+)/.exec(r.rrule)?.[1]?.split(',') ?? [])}, ${clock(
                            hhmm(r.startMinute),
                          )} to ${clock(hhmm(r.endMinute))}`,
                      )
                      .join('; ')
                  ) : (
                    <span className="not-bookable">None yet: customers cannot book them</span>
                  )
                ) : setHours ? (
                  `${daysText(days)}, ${clock(start)} to ${clock(end)}`
                ) : (
                  <span className="not-bookable">None yet: customers cannot book them</span>
                )}
              </dd>
              <dt>Booking page</dt>
              <dd>{isPublic ? 'Shown' : 'Not shown'}</dd>
            </dl>

            {!editing && (
              <label className="check">
                <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
                Send them a login invite, so they can see their own schedule
              </label>
            )}
          </>
        )}

        {/* On every step: editing saves from any of them. */}
        {serverError && <div className="err">{serverError}</div>}
      </form>
    </Modal>
  );
}
