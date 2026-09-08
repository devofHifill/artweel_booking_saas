import { useEffect, useState } from 'react';
import { api, timeIn } from '../lib/api';
import { useActiveOrg } from '../lib/auth';
import { LoadingRegion } from './states';

/**
 * What one instructor is down to teach, from now on.
 *
 * Sessions, not bookings. The question this answers is "where does this
 * person have to be", and an empty class still has to be turned up to — a
 * list built from bookings would silently drop exactly the classes worth
 * chasing.
 *
 * Read only. The prototype's version offers to email the schedule to the
 * guide; that is not built here because there is no such notification
 * template, and a button that appears to send something and does not is worse
 * than no button. The rota is already visible to instructors on /my-schedule.
 */

type ScheduleSession = {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  seatsTaken: number;
  status: string;
  serviceType: { id: string; name: string; emoji: string | null };
  location: { id: string; name: string } | null;
};

export function StaffSchedule({
  base,
  staffId,
  onClose,
}: {
  base: string;
  staffId: string;
  onClose: () => void;
}) {
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';

  const [sessions, setSessions] = useState<ScheduleSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ sessions: ScheduleSession[] }>(`${base}/staff/${staffId}/schedule`)
      .then((res) => setSessions(res.sessions))
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load.'),
      );
  }, [base, staffId]);

  /*
    Grouped by the studio's local date, not the browser's. An instructor in a
    studio two zones away would otherwise see a Tuesday class filed under
    Monday, which is exactly the kind of quiet wrongness nobody reports.
  */
  const byDate = new Map<string, ScheduleSession[]>();
  for (const session of sessions ?? []) {
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(session.startsAt));
    byDate.set(key, [...(byDate.get(key) ?? []), session]);
  }

  const heading = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(`${iso}T12:00:00Z`));

  return (
    <>
      {error && <div className="err">{error}</div>}

      {!sessions && !error && (
        <LoadingRegion label="Loading the schedule">
          <p className="tiny muted">Loading…</p>
        </LoadingRegion>
      )}

      {sessions && sessions.length === 0 && (
        <p className="tiny muted">
          Nothing scheduled. Classes they are assigned to will appear here.
        </p>
      )}

      {[...byDate.entries()].map(([date, list]) => (
        <section key={date} className="staff-sched-day">
          <h3 className="form-section">{heading(date)}</h3>
          {list.map((session) => (
            <div key={session.id} className="staff-sched-row">
              <span className="staff-sched-when">
                {timeIn(session.startsAt, timezone)} –{' '}
                {timeIn(session.endsAt, timezone)}
              </span>
              <span className="staff-sched-what">
                <b>
                  {session.serviceType.emoji
                    ? `${session.serviceType.emoji} `
                    : ''}
                  {session.serviceType.name}
                </b>
                {session.location && (
                  <div className="tiny muted">{session.location.name}</div>
                )}
              </span>
              {/* Taken over capacity, the way a register reads. A bare
                  "12" leaves you working out whether that is full. */}
              <span className="tiny muted">
                {session.seatsTaken}/{session.capacity}
              </span>
            </div>
          ))}
        </section>
      ))}

      <div className="counter-foot">
        <span />
        <div className="counter-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  );
}
