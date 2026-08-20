import { useEffect, useState } from 'react';
import {
  api,
  money,
  timeIn,
  type BookingListItem,
  type TodayResponse,
} from '../lib/api';
import { useOrgBase } from '../lib/auth';
import { PageHead } from '../components/layout';
import { LoadingRegion, SkeletonStats, SkeletonList } from '../components/states';

/**
 * The Today view.
 *
 * Answers the questions a studio owner opens the app for: who is coming, what
 * needs attention, and whether anything in the plumbing has broken. The alerts
 * matter most — a studio has no way to discover a dead calendar connection or
 * a failed batch of reminders on their own.
 *
 * The schedule is a TIMELINE of sessions, not a table of bookings. The server
 * returns one row per booking, so a class of six arrived as six rows repeating
 * the same time and class name; what an owner actually needs to know is "what
 * is happening at 09:30, and how many people is that". Bookings are grouped
 * back into the session they were made against, with the customers underneath.
 */
export default function Today() {
  const base = useOrgBase();
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .get<TodayResponse>(`${base}/bookings/today`)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message));

    return () => {
      cancelled = true;
    };
  }, [base]);

  if (error) return <div className="err">{error}</div>;
  if (!data) return (
      <LoadingRegion label="Loading today's bookings">
        <SkeletonStats count={3} className="day-figures" />
        <SkeletonList count={3} lines={2} />
      </LoadingRegion>
    );

  const { stats, alerts, today, timezone, currency } = data;
  const sessions = groupIntoSessions(today);

  // "Now" is read once per render rather than ticked. This page is opened,
  // scanned and left; a clock would redraw the whole schedule to move one dot,
  // and nothing here is precise to the second anyway.
  const now = Date.now();
  const nextIndex = sessions.findIndex((s) => Date.parse(s.endsAt) > now);

  return (
    <>
      <PageHead
        title="Today"
        lede={
          <>
            {new Intl.DateTimeFormat('en-US', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: timezone,
            }).format(new Date())}{' '}
            · {timezone.replace('_', ' ')}
          </>
        }
      />

      {alerts.paymentsNotEnabled && (
        <div className="alert warn">
          Payments are not set up yet, so you cannot take money online.
          Connect Stripe in settings to start charging for bookings.
        </div>
      )}
      {alerts.calendarsNeedingReauth > 0 && (
        <div className="alert danger">
          {alerts.calendarsNeedingReauth} calendar connection
          {alerts.calendarsNeedingReauth === 1 ? '' : 's'} stopped working.
          Availability may be wrong until it is reconnected.
        </div>
      )}
      {alerts.failedNotifications > 0 && (
        <div className="alert warn">
          {alerts.failedNotifications} message
          {alerts.failedNotifications === 1 ? '' : 's'} could not be delivered.
        </div>
      )}

      {/* Three figures, not four. Headcount is the one an owner acts on, so it
          gets the room; the booking count is what that headcount is spread
          across and belongs beside it rather than in a tile of its own. */}
      <div className="day-figures">
        <div className="card stat day-fig day-fig-lead">
          <div className="label">People expected</div>
          <div className="value">{stats.todaySeats}</div>
          <p className="day-fig-note">
            across {stats.todayCount}{' '}
            {stats.todayCount === 1 ? 'booking' : 'bookings'}
            {sessions.length > 0 && (
              <>
                {' · '}
                {sessions.length}{' '}
                {sessions.length === 1 ? 'session' : 'sessions'}
              </>
            )}
          </p>
        </div>

        <div className="card stat day-fig">
          <div className="label">Next 7 days</div>
          <div className="value">{stats.upcomingWeek}</div>
          <p className="day-fig-note">bookings on the books</p>
        </div>

        <div
          className={`card stat day-fig${
            stats.outstandingCents > 0 ? ' is-owed' : ''
          }`}
        >
          <div className="label">Outstanding</div>
          <div className="value">{money(stats.outstandingCents, currency)}</div>
          <p className="day-fig-note">
            {stats.outstandingCents > 0 ? 'still to collect' : 'all settled'}
          </p>
        </div>
      </div>

      <h2>Today's schedule</h2>

      {sessions.length === 0 ? (
        <div className="card empty-state">
          <span className="empty-mark" aria-hidden="true">☕</span>
          <p className="empty-title">A quiet one.</p>
          <p className="sub">Nothing is booked today.</p>
        </div>
      ) : (
        <ol className="day-line">
          {sessions.map((session, index) => {
            const done = Date.parse(session.endsAt) <= now;
            const next = index === nextIndex;

            return (
              <li
                key={session.key}
                className={`day-session${done ? ' is-done' : ''}${
                  next ? ' is-next' : ''
                }`}
              >
                <div className="day-when">
                  <span className="day-time">
                    {timeIn(session.startsAt, timezone)}
                  </span>
                </div>

                <div className="day-rail" aria-hidden="true" />

                <div className="card day-what">
                  <div className="day-what-head">
                    <h3 className="day-name">
                      <span
                        className="swatch"
                        style={{ background: session.service.color }}
                      />
                      {session.service.name}
                      {next && <span className="day-next">Next up</span>}
                    </h3>
                    <span className="day-heads">
                      {session.seats} {session.seats === 1 ? 'person' : 'people'}
                    </span>
                  </div>

                  <p className="day-meta">
                    {timeIn(session.startsAt, timezone)}–
                    {timeIn(session.endsAt, timezone)}
                    {session.staff && <> · with {session.staff.name}</>}
                    {session.location && <> · {session.location.name}</>}
                    {session.outstandingCents > 0 && (
                      <>
                        {' · '}
                        <span className="day-owed">
                          {money(session.outstandingCents, currency)} owed
                        </span>
                      </>
                    )}
                  </p>

                  <ul className="day-guests">
                    {session.bookings.map((booking) => (
                      <li key={booking.id}>
                        <span className="day-guest">
                          <span className="day-guest-name">
                            {booking.customer.name}
                            {booking.seats > 1 && (
                              <span className="day-seats"> ×{booking.seats}</span>
                            )}
                          </span>
                          <span className="sub">
                            {booking.customer.phone ?? booking.customer.email}
                          </span>
                        </span>

                        <span className="day-guest-end">
                          {booking.outstandingCents > 0 && (
                            <span className="day-owed">
                              {money(booking.outstandingCents, currency)}
                            </span>
                          )}
                          <span className={`tag ${booking.status}`}>
                            {booking.status.replace('_', ' ')}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

type Session = {
  key: string;
  startsAt: string;
  endsAt: string;
  service: BookingListItem['service'];
  staff: BookingListItem['staff'];
  location: BookingListItem['location'];
  seats: number;
  outstandingCents: number;
  bookings: BookingListItem[];
};

/**
 * Bookings, back into the sessions they were made against.
 *
 * Keyed on start time AND service AND staff rather than time alone: two
 * different classes can start at nine, and merging them would invent a session
 * that does not exist. Cancellations stay in the list — a name that is NOT
 * coming is exactly what somebody scanning the day needs to see — but they do
 * not count towards the headcount.
 */
function groupIntoSessions(bookings: BookingListItem[]): Session[] {
  const byKey = new Map<string, Session>();

  for (const booking of bookings) {
    const key = [
      booking.startsAt,
      booking.service.id,
      booking.staff?.id ?? '-',
    ].join('|');

    let session = byKey.get(key);
    if (!session) {
      session = {
        key,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        service: booking.service,
        staff: booking.staff,
        location: booking.location,
        seats: 0,
        outstandingCents: 0,
        bookings: [],
      };
      byKey.set(key, session);
    }

    session.bookings.push(booking);
    session.outstandingCents += booking.outstandingCents;
    if (booking.status !== 'CANCELLED') session.seats += booking.seats;
  }

  return [...byKey.values()].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
}
