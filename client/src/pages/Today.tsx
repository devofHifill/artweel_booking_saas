import { useEffect, useState } from 'react';
import { api, money, timeIn, type TodayResponse } from '../lib/api';
import { useOrgBase } from '../lib/auth';

/**
 * The Today view.
 *
 * Answers the questions a studio owner opens the app for: who is coming, what
 * needs attention, and whether anything in the plumbing has broken. The alerts
 * matter most — a studio has no way to discover a dead calendar connection or
 * a failed batch of reminders on their own.
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
  if (!data) return <div className="empty">Loading…</div>;

  const { stats, alerts, today, timezone, currency } = data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Today</h1>
          <p className="sub">
            {new Intl.DateTimeFormat('en-US', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: timezone,
            }).format(new Date())}{' '}
            · {timezone.replace('_', ' ')}
          </p>
        </div>
      </div>

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

      <div className="stats">
        <div className="card stat">
          <div className="label">Bookings today</div>
          <div className="value">{stats.todayCount}</div>
        </div>
        <div className="card stat">
          <div className="label">People expected</div>
          <div className="value">{stats.todaySeats}</div>
        </div>
        <div className="card stat">
          <div className="label">Next 7 days</div>
          <div className="value">{stats.upcomingWeek}</div>
        </div>
        <div className="card stat">
          <div className="label">Outstanding</div>
          <div className="value">{money(stats.outstandingCents, currency)}</div>
        </div>
      </div>

      <h2>Today's schedule</h2>

      {today.length === 0 ? (
        <div className="card empty">Nothing booked today.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Class</th>
                <th>Customer</th>
                <th>With</th>
                <th>Seats</th>
                <th>Status</th>
                <th>Owed</th>
              </tr>
            </thead>
            <tbody>
              {today.map((booking) => (
                <tr key={booking.id}>
                  <td>{timeIn(booking.startsAt, timezone)}</td>
                  <td>
                    <span
                      className="swatch"
                      style={{ background: booking.service.color }}
                    />
                    {booking.service.name}
                  </td>
                  <td>
                    {booking.customer.name}
                    <div className="sub" style={{ fontSize: '.78rem' }}>
                      {booking.customer.phone ?? booking.customer.email}
                    </div>
                  </td>
                  <td>{booking.staff?.name ?? '—'}</td>
                  <td>{booking.seats}</td>
                  <td>
                    <span className={`tag ${booking.status}`}>
                      {booking.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td>
                    {booking.outstandingCents > 0
                      ? money(booking.outstandingCents, currency)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
