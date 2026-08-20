import { useCallback, useEffect, useState } from 'react';
import { api, dateIn, timeIn } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { PageHead, StatusPill } from '../components/layout';
import { EmptyState } from '../components/states';

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

type WaitlistEntry = {
  id: string;
  status: 'WAITING' | 'OFFERED' | 'CLAIMED' | 'EXPIRED' | 'CANCELLED';
  position: number;
  seats: number;
  offerExpiresAt: string | null;
  customer: { id: string; name: string; email: string; phone: string | null };
};

type WaitlistResponse = {
  session: { id: string; capacity: number; seatsTaken: number };
  waitingCount: number;
  seatsWanted: number;
  entries: WaitlistEntry[];
};

const WEEKDAYS = [
  ['MO', 'Mon'],
  ['TU', 'Tue'],
  ['WE', 'Wed'],
  ['TH', 'Thu'],
  ['FR', 'Fri'],
  ['SA', 'Sat'],
  ['SU', 'Sun'],
] as const;

/** Still in the running: holding a seat, or in line for one. */
const LIVE = new Set(['WAITING', 'OFFERED']);

/**
 * Queue order, not status order.
 *
 * The API sorts by status first, which puts the one person actually holding a
 * seat BELOW everyone merely waiting behind them — position 1 rendering last,
 * under positions 2 and 3. Whoever is next is the whole point of the panel, so
 * live entries come first in position order and finished ones settle
 * underneath as history.
 */
function orderedQueue(entries: WaitlistEntry[]): WaitlistEntry[] {
  return [...entries].sort((a, b) => {
    const aLive = LIVE.has(a.status);
    const bLive = LIVE.has(b.status);
    if (aLive !== bLive) return aLive ? -1 : 1;
    return a.position - b.position;
  });
}

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

  // --- The waitlist panel ----------------------------------------------------
  //
  // Loaded per session on expand rather than alongside the list. A month of
  // classes is thirty rows, and thirty waitlist queries to render badges almost
  // none of them need is a bad trade.
  const [openId, setOpenId] = useState<string | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistResponse | null>(null);
  const [wlBusy, setWlBusy] = useState(false);
  const [wlError, setWlError] = useState<string | null>(null);

  const loadWaitlist = useCallback(
    async (sessionId: string) => {
      setWlBusy(true);
      setWlError(null);
      try {
        setWaitlist(
          await api.get<WaitlistResponse>(
            `${base}/sessions/${sessionId}/waitlist`,
          ),
        );
      } catch (err) {
        setWaitlist(null);
        setWlError(
          err instanceof Error ? err.message : 'Could not load the waitlist.',
        );
      } finally {
        setWlBusy(false);
      }
    },
    [base],
  );

  function toggleWaitlist(sessionId: string) {
    if (openId === sessionId) {
      setOpenId(null);
      setWaitlist(null);
      setWlError(null);
      return;
    }
    setOpenId(sessionId);
    setWaitlist(null);
    void loadWaitlist(sessionId);
  }

  /**
   * Offering holds the seat, so the class stays full while the offer stands.
   * Said plainly here because the opposite guess — that offering merely sends
   * an email and the seat is still up for grabs — leads an owner to offer it to
   * three people at once.
   */
  async function offerNext(sessionId: string) {
    if (
      !confirm(
        'Offer the next free seat to the first person waiting?\n\n' +
          'The seat is held for them until the offer runs out, so the class ' +
          'stays full in the meantime.',
      )
    )
      return;

    setWlBusy(true);
    try {
      const res = await api.post<{ offered: boolean }>(
        `${base}/sessions/${sessionId}/waitlist/offer`,
        {},
      );
      if (!res.offered) {
        setWlError('Nothing to offer — no free seat, or nobody waiting for one.');
      }
      await loadWaitlist(sessionId);
      await load();
    } catch (err) {
      setWlError(err instanceof Error ? err.message : 'Could not offer a seat.');
      setWlBusy(false);
    }
  }

  async function removeEntry(sessionId: string, entry: WaitlistEntry) {
    const held =
      entry.status === 'OFFERED'
        ? '\n\nThey currently hold a seat; removing them frees it for the next person.'
        : '';
    if (!confirm(`Remove ${entry.customer.name} from the waitlist?${held}`)) return;

    setWlBusy(true);
    try {
      await api.del(`${base}/sessions/${sessionId}/waitlist/${entry.id}`);
      await loadWaitlist(sessionId);
      await load();
    } catch (err) {
      setWlError(err instanceof Error ? err.message : 'Could not remove them.');
      setWlBusy(false);
    }
  }

  const selected = services.find((s) => s.id === serviceTypeId);

  return (
    <div>
      <PageHead
        title="Classes"
        actions={
          <>
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
          </>
        }
      />

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
        <EmptyState icon="◷">No classes in this range.</EmptyState>
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
                <button
                  className="link"
                  onClick={() => toggleWaitlist(session.id)}
                >
                  {openId === session.id ? 'Hide waitlist' : 'Waitlist'}
                </button>
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

            {openId === session.id && (
              <div className="waitlist">
                {wlError && <div className="err">{wlError}</div>}
                {wlBusy && !waitlist && <p className="sub">Loading…</p>}

                {waitlist && waitlist.entries.length === 0 && (
                  <p className="sub">Nobody has joined this waitlist.</p>
                )}

                {waitlist && waitlist.entries.length > 0 && (
                  <>
                    <div className="row-head" style={{ cursor: 'default' }}>
                      <div className="sub">
                        {waitlist.waitingCount} waiting for{' '}
                        {waitlist.seatsWanted} seat
                        {waitlist.seatsWanted === 1 ? '' : 's'}
                      </div>
                      {isAdmin && (
                        <button
                          className="link"
                          onClick={() => void offerNext(session.id)}
                          disabled={wlBusy || waitlist.waitingCount === 0}
                        >
                          Offer next seat
                        </button>
                      )}
                    </div>

                    <ul className="queue">
                      {orderedQueue(waitlist.entries).map((entry) => (
                        <li key={entry.id}>
                          <span className="pos">
                            {LIVE.has(entry.status) ? entry.position : '·'}
                          </span>
                          <span className="who">
                            {entry.customer.name}
                            <span className="sub">
                              {entry.customer.email}
                              {entry.seats > 1 ? ` · ${entry.seats} seats` : ''}
                            </span>
                          </span>
                          <StatusPill status={entry.status}>
                            {entry.status === 'OFFERED' && entry.offerExpiresAt
                              ? `held until ${timeIn(entry.offerExpiresAt, timezone)}`
                              : undefined}
                          </StatusPill>
                          {isAdmin &&
                            (entry.status === 'WAITING' ||
                              entry.status === 'OFFERED') && (
                              <button
                                className="link danger"
                                onClick={() => void removeEntry(session.id, entry)}
                                disabled={wlBusy}
                              >
                                Remove
                              </button>
                            )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
