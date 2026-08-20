import { useCallback, useEffect, useState } from 'react';
import { api, dateIn, timeIn } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { PageHead } from '../components/layout';
import { EmptyState } from '../components/states';

/**
 * Taking the register.
 *
 * Built for the phone in an apron pocket, not the office desktop. That drives
 * three choices:
 *
 *   The classes shown default to TODAY, because an instructor opening this is
 *   almost always standing in front of one of them.
 *
 *   Marks are held locally and submitted as ONE request. Marking six students
 *   over studio wifi one tap at a time is how a register ends up half-saved,
 *   and half-saved is worse than unsaved because nobody notices.
 *
 *   A class that has not started cannot be marked, and says so, rather than
 *   offering buttons that fail.
 */

type Attendance = { expected: number; attended: number; noShow: number; outstanding: number };

type SessionRow = {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  seatsTaken: number;
  status: string;
  seriesIndex: number | null;
  seriesLabel: string | null;
  serviceType: { id: string; name: string };
  staff: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  courseSeries: { id: string; name: string; cohortLabel: string | null } | null;
  attendance: Attendance;
};

type RegisterEntry = {
  bookingId: string;
  seats: number;
  status: string;
  viaEnrollment: boolean;
  customer: { id: string; name: string; email: string; phone: string | null };
};

type RegisterResponse = {
  session: {
    id: string;
    startsAt: string;
    endsAt: string;
    capacity: number;
    seatsTaken: number;
    seriesIndex: number | null;
    service: { id: string; name: string };
    staff: { id: string; name: string } | null;
    location: { id: string; name: string } | null;
    course: { id: string; name: string; cohortLabel: string | null } | null;
  };
  markable: boolean;
  entries: RegisterEntry[];
};

type Mark = 'ATTENDED' | 'NO_SHOW' | 'CONFIRMED';

/** Local date in the STUDIO's zone, not the browser's. */
function todayIn(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts;
}

export default function Register() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';

  const [day, setDay] = useState(() => todayIn(timezone));
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [register, setRegister] = useState<RegisterResponse | null>(null);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const res = await api.get<{ sessions: SessionRow[] }>(
        `${base}/sessions?from=${day}&to=${day}`,
      );
      setSessions(res.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load classes.');
    }
  }, [base, day]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const openRegister = useCallback(
    async (sessionId: string) => {
      setOpenId(sessionId);
      setRegister(null);
      setMarks({});
      setSaved(false);

      try {
        const res = await api.get<RegisterResponse>(
          `${base}/sessions/${sessionId}/register`,
        );
        setRegister(res);
        // Seed from what is already recorded, so reopening a part-marked
        // register shows the existing marks rather than a blank slate.
        setMarks(
          Object.fromEntries(
            res.entries
              .filter((e) => e.status === 'ATTENDED' || e.status === 'NO_SHOW')
              .map((e) => [e.bookingId, e.status as Mark]),
          ),
        );
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the register.');
      }
    },
    [base],
  );

  function setMark(bookingId: string, mark: Mark) {
    setSaved(false);
    setMarks((current) => {
      // Tapping the same button again clears it, which is how you undo a
      // mistap without hunting for a third control.
      if (current[bookingId] === mark) {
        const next = { ...current };
        delete next[bookingId];
        return next;
      }
      return { ...current, [bookingId]: mark };
    });
  }

  function markAllPresent() {
    if (!register) return;
    setSaved(false);
    setMarks(
      Object.fromEntries(
        register.entries.map((e) => [e.bookingId, 'ATTENDED' as Mark]),
      ),
    );
  }

  async function save() {
    if (!register) return;

    // Everyone on the register goes in the request. Anybody left untouched is
    // sent as CONFIRMED, which is what "not marked" means — and it also undoes
    // a previous mark that has just been cleared.
    const entries = register.entries.map((entry) => ({
      bookingId: entry.bookingId,
      status: marks[entry.bookingId] ?? ('CONFIRMED' as Mark),
    }));

    setBusy(true);
    try {
      const res = await api.post<RegisterResponse>(
        `${base}/sessions/${register.session.id}/register`,
        { entries },
      );
      setRegister(res);
      setSaved(true);
      setError(null);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the register.');
    } finally {
      setBusy(false);
    }
  }

  const marked = Object.keys(marks).length;

  return (
    <div>
      <PageHead
        title="Register"
        actions={
          <input
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              setOpenId(null);
              setRegister(null);
            }}
            aria-label="Day"
          />
        }
      />

      {error && <div className="err">{error}</div>}

      {sessions.length === 0 && !error && (
        <EmptyState icon="◷">No classes on this day.</EmptyState>
      )}

      <div className="list">
        {sessions.map((session) => {
          const isOpen = openId === session.id;

          return (
            <div key={session.id} className="card">
              <button
                className="row-head"
                onClick={() => (isOpen ? setOpenId(null) : void openRegister(session.id))}
              >
                <div>
                  <strong>{session.serviceType.name}</strong>
                  {session.seriesLabel && (
                    <span className="tag">{session.seriesLabel}</span>
                  )}
                  <div className="sub">
                    {dateIn(session.startsAt, timezone)} ·{' '}
                    {timeIn(session.startsAt, timezone)}
                    {session.staff ? ` · ${session.staff.name}` : ''}
                    {session.location ? ` · ${session.location.name}` : ''}
                  </div>
                </div>

                <div className="counts">
                  {session.attendance.outstanding === 0 &&
                  session.seatsTaken > 0 ? (
                    <span className="done">Register taken</span>
                  ) : (
                    <span>
                      {session.attendance.attended} in ·{' '}
                      {session.attendance.outstanding} to mark
                    </span>
                  )}
                </div>
              </button>

              {isOpen && register && (
                <div className="register">
                  {!register.markable && (
                    <p className="sub">
                      This class has not started yet, so there is no attendance
                      to record.
                    </p>
                  )}

                  {register.entries.length === 0 && (
                    <p className="sub">Nobody is booked into this class.</p>
                  )}

                  {register.entries.map((entry) => (
                    <div key={entry.bookingId} className="register-row">
                      <div>
                        {entry.customer.name}
                        {entry.seats > 1 && (
                          <span className="tag">{entry.seats} places</span>
                        )}
                        {entry.viaEnrollment && (
                          <span className="tag">course</span>
                        )}
                      </div>

                      <div className="marks">
                        <button
                          disabled={!register.markable || busy}
                          aria-pressed={marks[entry.bookingId] === 'ATTENDED'}
                          className={
                            marks[entry.bookingId] === 'ATTENDED' ? 'on' : ''
                          }
                          onClick={() => setMark(entry.bookingId, 'ATTENDED')}
                        >
                          Here
                        </button>
                        <button
                          disabled={!register.markable || busy}
                          aria-pressed={marks[entry.bookingId] === 'NO_SHOW'}
                          className={
                            marks[entry.bookingId] === 'NO_SHOW' ? 'on' : ''
                          }
                          onClick={() => setMark(entry.bookingId, 'NO_SHOW')}
                        >
                          Absent
                        </button>
                      </div>
                    </div>
                  ))}

                  {register.markable && register.entries.length > 0 && (
                    <div className="register-actions">
                      <button className="link" onClick={markAllPresent} disabled={busy}>
                        Everyone is here
                      </button>
                      <div className="spacer" />
                      {saved && <span className="done">Saved</span>}
                      <button onClick={() => void save()} disabled={busy}>
                        {busy
                          ? 'Saving…'
                          : `Save register (${marked}/${register.entries.length})`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
