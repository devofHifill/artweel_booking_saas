import { useCallback, useEffect, useState } from 'react';
import { api, dateIn, timeIn } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';

/**
 * Scheduling classes.
 *
 * Kept apart from the Register page on purpose: putting a class on the
 * calendar is an owner's job and marking who turned up is the instructor's,
 * which is the same split the API enforces. One page doing both would show
 * every instructor a form they are not allowed to submit.
 */

type ServiceOption = {
  id: string;
  name: string;
  bookingMode: string;
  capacityMax: number;
  durationMinutes: number;
};

type SessionRow = {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  seatsTaken: number;
  status: string;
  seriesLabel: string | null;
  serviceType: { id: string; name: string };
  staff: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  courseSeries: { id: string; name: string } | null;
};

type Created = { id: string; localDate: string };
type Skipped = { localDate: string; reason: string };

const WEEKDAYS = [
  ['MO', 'Mon'],
  ['TU', 'Tue'],
  ['WE', 'Wed'],
  ['TH', 'Thu'],
  ['FR', 'Fri'],
  ['SA', 'Sat'],
  ['SU', 'Sun'],
] as const;

function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function plusDays(localDate: string, days: number): string {
  const d = new Date(`${localDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function Classes() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';
  const isAdmin = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const [from, setFrom] = useState(() => todayIn(timezone));
  const [to, setTo] = useState(() => plusDays(todayIn(timezone), 30));
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: Created[]; skipped: Skipped[] } | null>(
    null,
  );

  // --- The form ------------------------------------------------------------
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [startLocalDate, setStartLocalDate] = useState(() => todayIn(timezone));
  const [localStartTime, setLocalStartTime] = useState('18:00');
  const [capacity, setCapacity] = useState(8);
  const [staffId, setStaffId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [repeating, setRepeating] = useState(false);
  const [days, setDays] = useState<string[]>([]);
  const [count, setCount] = useState(6);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ sessions: SessionRow[] }>(
        `${base}/sessions?from=${from}&to=${to}`,
      );
      setSessions(res.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load classes.');
    }
  }, [base, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const [s, st, loc] = await Promise.all([
          api.get<{ services: ServiceOption[] }>(`${base}/services`),
          api.get<{ staff: { id: string; name: string }[] }>(`${base}/staff`),
          api.get<{ locations: { id: string; name: string }[] }>(`${base}/locations`),
        ]);
        // A course service cannot take a loose class, so it is not offered.
        setServices(s.services.filter((x) => x.bookingMode !== 'COURSE_SERIES'));
        setStaff(st.staff);
        setLocations(loc.locations);
      } catch {
        // The form simply stays empty; the list above is still useful.
      }
    })();
  }, [base]);

  function toggleDay(code: string) {
    setDays((current) =>
      current.includes(code)
        ? current.filter((d) => d !== code)
        : [...current, code],
    );
  }

  async function schedule(event: React.FormEvent) {
    event.preventDefault();
    if (!serviceTypeId) return;

    setBusy(true);
    setResult(null);

    try {
      const body: Record<string, unknown> = {
        serviceTypeId,
        startLocalDate,
        localStartTime,
        capacity,
      };
      if (staffId) body.staffId = staffId;
      if (locationId) body.locationId = locationId;
      if (repeating && days.length > 0) {
        body.repeat = {
          rrule: `FREQ=WEEKLY;BYDAY=${days.join(',')}`,
          count,
        };
      }

      const res = await api.post<{ created: Created[]; skipped: Skipped[] }>(
        `${base}/sessions`,
        body,
      );
      setResult(res);
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(session: SessionRow) {
    const warning =
      session.seatsTaken > 0
        ? ` ${session.seatsTaken} booked place(s) will be cancelled, and any refund is yours to issue.`
        : '';

    if (!confirm(`Cancel ${session.serviceType.name}?${warning}`)) return;

    setBusy(true);
    try {
      await api.del(`${base}/sessions/${session.id}`);
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel.');
    } finally {
      setBusy(false);
    }
  }

  const selected = services.find((s) => s.id === serviceTypeId);

  return (
    <div>
      <header className="page-head">
        <h1>Classes</h1>
        <div className="toolbar">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To"
          />
        </div>
      </header>

      {error && <div className="err">{error}</div>}

      {isAdmin && (
        <form className="card schedule" onSubmit={(e) => void schedule(e)}>
          <h2>Schedule a class</h2>

          <div className="fields">
            <label>
              Class
              <select
                value={serviceTypeId}
                onChange={(e) => {
                  setServiceTypeId(e.target.value);
                  const svc = services.find((s) => s.id === e.target.value);
                  if (svc) setCapacity(Math.min(capacity, svc.capacityMax));
                }}
                required
              >
                <option value="">Choose…</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Date
              <input
                type="date"
                value={startLocalDate}
                onChange={(e) => setStartLocalDate(e.target.value)}
                required
              />
            </label>

            <label>
              Start
              <input
                type="time"
                value={localStartTime}
                onChange={(e) => setLocalStartTime(e.target.value)}
                required
              />
            </label>

            <label>
              Places
              <input
                type="number"
                min={1}
                max={selected?.capacityMax ?? 500}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                required
              />
            </label>

            <label>
              Instructor
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                <option value="">Nobody yet</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Where
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">Not set</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={repeating}
              onChange={(e) => setRepeating(e.target.checked)}
            />
            Repeat weekly
          </label>

          {repeating && (
            <div className="repeat">
              <div className="days">
                {WEEKDAYS.map(([code, label]) => (
                  <button
                    type="button"
                    key={code}
                    className={days.includes(code) ? 'on' : ''}
                    onClick={() => toggleDay(code)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label>
                How many
                <input
                  type="number"
                  min={2}
                  max={52}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </label>
              <p className="sub">
                A longer run of dated classes is really a course — set one up
                under Courses so it sells as one thing.
              </p>
            </div>
          )}

          <button type="submit" disabled={busy || !serviceTypeId}>
            {busy ? 'Scheduling…' : 'Schedule'}
          </button>

          {result && (
            <div className="result">
              <p className="done">
                {result.created.length} class
                {result.created.length === 1 ? '' : 'es'} scheduled.
              </p>
              {result.skipped.length > 0 && (
                <div className="alert warn">
                  <strong>Skipped {result.skipped.length}:</strong>
                  <ul>
                    {result.skipped.map((s) => (
                      <li key={s.localDate}>
                        {s.localDate} — {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </form>
      )}

      {sessions.length === 0 && !error && (
        <div className="card empty">No classes in this range.</div>
      )}

      <div className="list">
        {sessions.map((session) => (
          <div key={session.id} className="card">
            <div className="row-head" style={{ cursor: 'default' }}>
              <div>
                <strong>{session.serviceType.name}</strong>
                {session.seriesLabel && (
                  <span className="tag">{session.seriesLabel}</span>
                )}
                {session.courseSeries && <span className="tag">course</span>}
                <div className="sub">
                  {dateIn(session.startsAt, timezone)} ·{' '}
                  {timeIn(session.startsAt, timezone)}
                  {session.staff ? ` · ${session.staff.name}` : ''}
                  {session.location ? ` · ${session.location.name}` : ''}
                </div>
              </div>

              <div className="counts">
                {session.seatsTaken}/{session.capacity} booked
                {isAdmin && (
                  <button
                    className="link danger"
                    onClick={() => void cancel(session)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
