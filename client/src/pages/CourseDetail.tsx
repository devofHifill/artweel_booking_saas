import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, dateIn, money, timeIn } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { PageHead, StatusPill } from '../components/layout';
import { LoadingRegion, SkeletonStats, SkeletonList } from '../components/states';

/**
 * One cohort: its weeks, and who is on it.
 *
 * The screen is built around the rule that makes courses different from
 * classes — a cohort is sold whole, so it is full when its TIGHTEST week is
 * full, not its first. That is invisible in a list of six weeks unless the
 * screen points at the limiting one, so it does.
 */

type Week = {
  id: string;
  seriesIndex: number;
  startsAt: string;
  endsAt: string;
  capacity: number;
  seatsTaken: number;
  status: string;
};

type Series = {
  id: string;
  name: string;
  cohortLabel: string | null;
  description: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  sessionCount: number;
  capacity: number;
  priceCents: number;
  allowLateEnrollment: boolean;
  enrolledCount: number;
  seatsRemaining: number;
  serviceType: { id: string; name: string; durationMinutes: number };
  staff: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  sessions: Week[];
};

type RosterEntry = {
  id: string;
  status: string;
  seats: number;
  notes: string | null;
  customer: { id: string; name: string; email: string; phone: string | null };
  attendance: {
    attended: number;
    missed: number;
    upcoming: number;
    unmarked: number;
  };
};

type CustomerOption = { id: string; name: string; email: string };

type GenerateWarning = {
  seriesIndex: number;
  localDate: string;
  message: string;
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

const roomIn = (week: Week) => week.capacity - week.seatsTaken;

/**
 * Only the parts that happened. Concatenating them conditionally leaves a
 * leading separator whenever the first ones are zero — a brand new enrolment
 * reading "· 6 to come".
 */
function attendanceLine(a: RosterEntry['attendance']): string {
  const parts: string[] = [];
  if (a.attended > 0) parts.push(`${a.attended} attended`);
  if (a.missed > 0) parts.push(`${a.missed} missed`);
  if (a.unmarked > 0) parts.push(`${a.unmarked} unmarked`);
  if (a.upcoming > 0) parts.push(`${a.upcoming} to come`);
  return parts.join(' · ');
}

/**
 * The week that decides whether anyone else can join — when there is one.
 *
 * Returns null when every week is equally full, which is the normal state of a
 * freshly generated cohort. Naming a "limiting week" there would be arbitrary:
 * `reduce` would pick week 1 on a tie and the screen would claim week 1 is the
 * bottleneck when all six are identical. A limit only means something once one
 * week is genuinely tighter than another.
 */
function tightestWeek(weeks: Week[]): Week | null {
  if (weeks.length === 0) return null;

  const room = weeks.map(roomIn);
  if (Math.min(...room) === Math.max(...room)) return null;

  return weeks.reduce((worst, week) =>
    roomIn(week) < roomIn(worst) ? week : worst,
  );
}

export default function CourseDetail() {
  const { seriesId } = useParams();
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';
  const currency = org?.organization.currency ?? 'USD';
  const isAdmin = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const [series, setSeries] = useState<Series | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Money moved, so the studio is told what happened rather than guessing. */
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- Generating the dates --------------------------------------------------
  const [days, setDays] = useState<string[]>([]);
  const [startLocalDate, setStartLocalDate] = useState('');
  const [localStartTime, setLocalStartTime] = useState('18:00');
  const [warnings, setWarnings] = useState<GenerateWarning[]>([]);

  // --- Enrolling -------------------------------------------------------------
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<CustomerOption[]>([]);
  const [enrollError, setEnrollError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        api.get<{ series: Series }>(`${base}/courses/${seriesId}`),
        api.get<{ enrollments: RosterEntry[] }>(
          `${base}/courses/${seriesId}/enrollments`,
        ),
      ]);
      setSeries(s.series);
      setRoster(r.enrollments);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    }
  }, [base, seriesId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!search.trim()) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await api.get<{ customers: CustomerOption[] }>(
            `${base}/customers?limit=8&search=${encodeURIComponent(search.trim())}`,
          );
          setMatches(res.customers);
        } catch {
          setMatches([]);
        }
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [base, search]);

  function toggleDay(code: string) {
    setDays((current) =>
      current.includes(code)
        ? current.filter((d) => d !== code)
        : [...current, code],
    );
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (days.length === 0 || !startLocalDate) return;

    if (
      !confirm(
        `Generate ${series?.sessionCount} dates for this course?\n\n` +
          'Students will hold these dates once they enrol, so moving them later ' +
          'means telling people the course changed.',
      )
    )
      return;

    setBusy(true);
    try {
      const res = await api.post<{ warnings?: GenerateWarning[] }>(
        `${base}/courses/${seriesId}/sessions`,
        {
          rrule: `FREQ=WEEKLY;BYDAY=${days.join(',')}`,
          startLocalDate,
          localStartTime,
        },
      );
      setWarnings(res.warnings ?? []);
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate dates.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: 'DRAFT' | 'PUBLISHED') {
    setBusy(true);
    try {
      await api.patch(`${base}/courses/${seriesId}`, { status });
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update.');
    } finally {
      setBusy(false);
    }
  }

  async function enroll(customer: CustomerOption) {
    setBusy(true);
    setEnrollError(null);
    try {
      await api.post(`${base}/courses/${seriesId}/enrollments`, {
        customerId: customer.id,
      });
      setSearch('');
      setMatches([]);
      await load();
    } catch (err) {
      // The API names the limiting week in this message. Showing it verbatim
      // is the whole point — "this course is full" without saying which week
      // leaves an owner with six weeks to check by hand.
      setEnrollError(
        err instanceof Error ? err.message : 'Could not enrol them.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeEnrollment(entry: RosterEntry) {
    if (
      !confirm(
        `Cancel ${entry.customer.name}'s place on this course?\n\n` +
          'Every week they hold is released, and whatever your cancellation ' +
          'policy allows is refunded to them automatically.',
      )
    )
      return;

    setBusy(true);
    try {
      const res = await api.del<{ refundedCents: number }>(
        `${base}/courses/${seriesId}/enrollments/${entry.id}`,
      );
      setNotice(
        res.refundedCents > 0
          ? `Place cancelled. ${money(res.refundedCents, currency)} refunded to ${entry.customer.name}.`
          : 'Place cancelled. Nothing was refunded — check your cancellation policy if that is wrong.',
      );
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !series) return <div className="err">{error}</div>;
  if (!series) return (
      <LoadingRegion label="Loading this course">
        <SkeletonStats />
        <SkeletonList count={3} lines={3} />
      </LoadingRegion>
    );

  const weeks = series.sessions;
  const tightest = tightestWeek(weeks);
  // The whole cohort can only take as many as its fullest week allows,
  // whether or not one week stands out as the reason.
  const worstRemaining =
    weeks.length > 0 ? Math.min(...weeks.map(roomIn)) : series.capacity;
  const activeRoster = roster.filter((r) => r.status !== 'CANCELLED');

  return (
    <div>
      <PageHead
        title={series.name}
        lede={
          <>
            <Link to="/courses">Courses</Link> · {series.serviceType.name} ·{' '}
            {series.sessionCount} week{series.sessionCount === 1 ? '' : 's'} ·{' '}
            {money(series.priceCents, currency)}
            {series.staff ? ` · ${series.staff.name}` : ''}
            {series.location ? ` · ${series.location.name}` : ''}
          </>
        }
        actions={
          <>
            <StatusPill status={series.status} />
          {isAdmin && series.status === 'DRAFT' && weeks.length > 0 && (
            <button onClick={() => void setStatus('PUBLISHED')} disabled={busy}>
              Publish
            </button>
          )}
          {isAdmin && series.status === 'PUBLISHED' && (
            <button
              className="link"
              onClick={() => void setStatus('DRAFT')}
              disabled={busy}
            >
              Unpublish
            </button>
          )}
          </>
        }
      />

      {error && <div className="err">{error}</div>}
      {notice && <div className="alert warn">{notice}</div>}

      {/* --- Dates ---------------------------------------------------------- */}

      {weeks.length === 0 ? (
        isAdmin ? (
          <form className="card schedule" onSubmit={(e) => void generate(e)}>
            <h2>Pick the dates</h2>
            <p className="sub">
              This course has no dates yet, so nobody can enrol. Choose the day
              it runs and the first date; {series.sessionCount} weekly session
              {series.sessionCount === 1 ? '' : 's'} will be created.
            </p>

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

            <div className="fields">
              <label>
                First date
                <input
                  type="date"
                  value={startLocalDate}
                  onChange={(e) => setStartLocalDate(e.target.value)}
                  required
                />
              </label>
              <label>
                Start time
                <input
                  type="time"
                  value={localStartTime}
                  onChange={(e) => setLocalStartTime(e.target.value)}
                  required
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={busy || days.length === 0 || !startLocalDate}
            >
              {busy ? 'Generating…' : 'Generate dates'}
            </button>
          </form>
        ) : (
          <div className="card empty">
            This course has no dates yet.
          </div>
        )
      ) : (
        <div className="card">
          <div className="row-head" style={{ cursor: 'default' }}>
            <h2>Weeks</h2>
            <div className="counts">
              {series.enrolledCount}/{series.capacity} enrolled
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="alert warn">
              <strong>Daylight saving:</strong>
              <ul>
                {warnings.map((w) => (
                  <li key={w.seriesIndex}>
                    Week {w.seriesIndex} ({w.localDate}) — {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
            The sentence an owner needs before they try to enrol somebody and
            get refused. A course is sold whole, so the tightest week is the
            one that decides.
          */}
          <p className={`sub ${worstRemaining <= 0 ? 'limit-full' : ''}`}>
            {worstRemaining <= 0
              ? tightest
                ? `Full — week ${tightest.seriesIndex} has no seats left, so no one else can take the whole course.`
                : 'Full — no seats left, so no one else can take the whole course.'
              : tightest
                ? `Room for ${worstRemaining} more — week ${tightest.seriesIndex} is the limit.`
                : `Room for ${worstRemaining} more.`}
          </p>

          <ul className="weeks">
            {weeks.map((week) => {
              const isLimit = tightest?.id === week.id;
              return (
                <li key={week.id} className={isLimit ? 'limit' : ''}>
                  <span className="pos">{week.seriesIndex}</span>
                  <span className="who">
                    {dateIn(week.startsAt, timezone)}
                    <span className="sub">
                      {timeIn(week.startsAt, timezone)}
                    </span>
                  </span>
                  <span className="counts">
                    {week.seatsTaken}/{week.capacity}
                    {isLimit && weeks.length > 1 && (
                      <span className="tag"> limits the course</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* --- Roster --------------------------------------------------------- */}

      <div className="card">
        <div className="row-head" style={{ cursor: 'default' }}>
          <h2>Roster</h2>
          <div className="counts">{activeRoster.length} enrolled</div>
        </div>

        {isAdmin && weeks.length > 0 && (
          <div className="enroll">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Add someone — search name or email"
              aria-label="Find a customer to enrol"
            />
            {enrollError && <div className="err">{enrollError}</div>}
            {matches.length > 0 && (
              <ul className="matches">
                {matches.map((c) => (
                  <li key={c.id}>
                    <span className="who">
                      {c.name}
                      <span className="sub">{c.email}</span>
                    </span>
                    <button
                      className="link"
                      onClick={() => void enroll(c)}
                      disabled={busy}
                    >
                      Enrol
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {roster.length === 0 && <p className="sub">Nobody enrolled yet.</p>}

        {roster.length > 0 && (
          <ul className="queue">
            {roster.map((entry) => (
              <li key={entry.id}>
                <span className="who">
                  <Link to={`/customers/${entry.customer.id}`}>
                    {entry.customer.name}
                  </Link>
                  <span className="sub">
                    {entry.customer.email}
                    {entry.seats > 1 ? ` · ${entry.seats} places` : ''}
                  </span>
                </span>

                <span className="counts">{attendanceLine(entry.attendance)}</span>

                <StatusPill status={entry.status} />

                {isAdmin && entry.status !== 'CANCELLED' && (
                  <button
                    className="link danger"
                    onClick={() => void removeEnrollment(entry)}
                    disabled={busy}
                  >
                    Cancel place
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
