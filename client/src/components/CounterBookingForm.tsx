import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dateIn, plusDays, timeIn, todayIn, zonedToInstant } from '../lib/api';

/**
 * A booking taken over the phone or at the counter.
 *
 * G0. Built for the same reason D4's activity editor was: not because the
 * prototype has the screen, but because the product had the capability and no
 * way to reach it. `createManualBooking` has existed since Phase 1, is routed
 * at `POST /bookings`, is gated to front desk, and `role-split.test.ts` asserts
 * a 201 on it. Outside its own definition and route the name appeared nowhere
 * in the repository — no client code called it.
 *
 * Worse, the Dashboard's primary call to action said "New booking" and linked
 * to the bookings LIST, which had no form. The most prominent button on the
 * first screen an owner sees promised something the product could not do.
 *
 * ---
 *
 * The demo's version of this form also captures amount, payment status,
 * payment method and a guide. Three of those are deliberately absent here:
 *
 * - **Amount.** The price is computed server-side from the service record.
 *   `payment.service.ts` is explicit that no client-supplied total influences
 *   anything, and a hand-typed amount on the counter form is the same hole
 *   through a different door.
 * - **Payment status and method.** Those belong to the payments ledger, which
 *   is real here and faked in the prototype. A counter booking settled in cash
 *   is a payment record, not a dropdown on a booking form.
 * - **Waiver.** Does not exist in this product. See BOOKING-PAGE-PLAN.md.
 *
 * The guide survives as `staffId`, which the schema already has — and which
 * the `staff_time_blocks` exclusion constraint rejects if that instructor is
 * already teaching. Postgres answers that question, not this form.
 */

type ServiceOption = {
  id: string;
  name: string;
  bookingMode: 'APPOINTMENT' | 'EVENT' | 'COURSE_SERIES';
  durationMinutes: number;
  isActive?: boolean;
};

type SessionOption = {
  id: string;
  startsAt: string;
  capacity: number;
  seatsTaken: number;
  status: string;
  serviceType: { id: string; name: string };
};

/** How far ahead the class picker looks. Matches the default booking horizon. */
const HORIZON_DAYS = 120;

export function CounterBookingForm({
  base,
  timezone,
  onBooked,
  onCancel,
}: {
  base: string;
  timezone: string;
  onBooked: () => void;
  onCancel: () => void;
}) {
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);

  const [serviceTypeId, setServiceTypeId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [localDate, setLocalDate] = useState(() => todayIn(timezone));
  const [localTime, setLocalTime] = useState('18:00');
  const [seats, setSeats] = useState(1);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const service = services.find((s) => s.id === serviceTypeId);
  const isAppointment = service?.bookingMode === 'APPOINTMENT';

  useEffect(() => {
    void (async () => {
      try {
        const [svc, st] = await Promise.all([
          api.get<{ services: ServiceOption[] }>(`${base}/services`),
          api.get<{ staff: { id: string; name: string }[] }>(`${base}/staff`),
        ]);

        /*
          A course is sold as an ENROLMENT, not a loose booking — one purchase
          covering six dated sessions. Offering it here would create a single
          booking against a cohort and leave the other five sessions unsold,
          so it is filtered out rather than accepted and half-honoured.
        */
        setServices(
          svc.services.filter(
            (s) => s.isActive !== false && s.bookingMode !== 'COURSE_SERIES',
          ),
        );
        setStaff(st.staff);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Could not load your classes.',
        );
      }
    })();
  }, [base]);

  /**
   * The class dates for the chosen service.
   *
   * `/sessions` filters by staff, location and cohort but not by service, so
   * the range is fetched once and narrowed here. That is deliberate: G0 ships
   * no server change, and a hundred-odd sessions is not worth a query
   * parameter and a migration to the query schema.
   */
  const loadSessions = useCallback(async () => {
    if (!serviceTypeId || isAppointment) return;

    const from = todayIn(timezone);
    try {
      const res = await api.get<{ sessions: SessionOption[] }>(
        `${base}/sessions?from=${from}&to=${plusDays(from, HORIZON_DAYS)}`,
      );
      setSessions(
        res.sessions.filter(
          (s) => s.serviceType.id === serviceTypeId && s.status === 'SCHEDULED',
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dates.');
    }
  }, [base, serviceTypeId, isAppointment, timezone]);

  useEffect(() => {
    setSessionId('');
    void loadSessions();
  }, [loadSessions]);

  const chosen = sessions.find((s) => s.id === sessionId);

  /**
   * Seats left on the chosen session, which is the ceiling on the number input.
   *
   * The server refuses an overbook regardless — `seats_taken <= capacity` is a
   * CHECK constraint, not a convention — but a form that lets somebody type 9
   * into a class with 2 places left and only then rejects it has wasted the
   * customer's time on the phone.
   */
  const seatsLeft = chosen ? Math.max(0, chosen.capacity - chosen.seatsTaken) : 0;

  const full = useMemo(
    () => sessions.filter((s) => s.capacity - s.seatsTaken <= 0).length,
    [sessions],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const body = {
      serviceTypeId,
      ...(isAppointment
        ? {
            staffId,
            /*
              A `datetime-local` value carries no zone, and `new Date(...)` on
              one resolves it against the BROWSER's. Front desk staff working
              remotely, or a laptop left on the wrong zone, would book a
              different hour than the one they typed.
            */
            startsAt: zonedToInstant(`${localDate}T${localTime}`, timezone),
            seats: 1,
          }
        : { sessionId, seats }),
      customer: {
        name: name.trim(),
        email: email.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      },
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };

    try {
      await api.post(`${base}/bookings`, body);
      onBooked();
    } catch (err) {
      /*
        The server's message is the useful one. It knows about capacity, the
        booking horizon, and the instructor-overlap exclusion constraint — none
        of which this form can check without asking it.
      */
      setError(err instanceof Error ? err.message : 'Could not take the booking.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="err">{error}</div>}

      <div className="setting setting-stack">
        <label htmlFor="cbService">Class</label>
        <select
          id="cbService"
          required
          value={serviceTypeId}
          onChange={(e) => setServiceTypeId(e.target.value)}
        >
          <option value="">Choose a class…</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.bookingMode === 'APPOINTMENT' ? ' (one to one)' : ''}
            </option>
          ))}
        </select>
        {services.length === 0 && (
          <p className="tiny muted">
            Nothing to book yet — add a class on the Classes page first.
          </p>
        )}
      </div>

      {service && !isAppointment && (
        <>
          <div className="setting setting-stack">
            <label htmlFor="cbSession">Date</label>
            <select
              id="cbSession"
              required
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            >
              <option value="">Choose a date…</option>
              {sessions.map((s) => {
                const left = s.capacity - s.seatsTaken;
                return (
                  <option key={s.id} value={s.id} disabled={left <= 0}>
                    {dateIn(s.startsAt, timezone)} at {timeIn(s.startsAt, timezone)}
                    {' — '}
                    {left > 0 ? `${left} of ${s.capacity} left` : 'full'}
                  </option>
                );
              })}
            </select>
            {sessions.length === 0 ? (
              <p className="tiny muted">
                No dates scheduled in the next {HORIZON_DAYS} days.
              </p>
            ) : (
              full > 0 && (
                <p className="tiny muted">
                  {full} of these {sessions.length} are full and cannot be picked.
                </p>
              )
            )}
          </div>

          <div className="setting setting-stack">
            <label htmlFor="cbSeats">Places</label>
            <input
              id="cbSeats"
              type="number"
              min={1}
              max={Math.max(1, seatsLeft)}
              value={seats}
              onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))}
            />
            {chosen && (
              <p className="tiny muted">
                {seatsLeft} {seatsLeft === 1 ? 'place' : 'places'} left on this
                date.
              </p>
            )}
          </div>
        </>
      )}

      {service && isAppointment && (
        <>
          <div className="setting setting-stack">
            <label htmlFor="cbStaff">With</label>
            <select
              id="cbStaff"
              required
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
            >
              <option value="">Choose an instructor…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="setting setting-stack">
            <label htmlFor="cbDate">Date</label>
            <input
              id="cbDate"
              type="date"
              required
              value={localDate}
              onChange={(e) => setLocalDate(e.target.value)}
            />
          </div>

          <div className="setting setting-stack">
            <label htmlFor="cbTime">Time</label>
            <input
              id="cbTime"
              type="time"
              required
              value={localTime}
              onChange={(e) => setLocalTime(e.target.value)}
            />
            <p className="tiny muted">
              {service.durationMinutes} minutes, in your studio's timezone.
            </p>
          </div>
        </>
      )}

      <div className="setting setting-stack">
        <label htmlFor="cbName">Customer name</label>
        <input
          id="cbName"
          required
          maxLength={120}
          value={name}
          placeholder="Jane Potter"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="setting setting-stack">
        <label htmlFor="cbEmail">Email</label>
        <input
          id="cbEmail"
          type="email"
          required
          maxLength={255}
          value={email}
          placeholder="jane@example.com"
          onChange={(e) => setEmail(e.target.value)}
        />
        {/* Not a formality: the server matches an existing customer on this
            address rather than creating a second record for somebody who has
            booked before, so a typo here splits one person into two. */}
        <p className="tiny muted">
          Used to find them if they have booked before, and to send the
          confirmation.
        </p>
      </div>

      <div className="setting setting-stack">
        <label htmlFor="cbPhone">Mobile</label>
        <input
          id="cbPhone"
          maxLength={32}
          value={phone}
          placeholder="Optional"
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      <div className="setting setting-stack">
        <label htmlFor="cbNotes">Notes</label>
        <textarea
          id="cbNotes"
          rows={2}
          maxLength={2000}
          value={notes}
          placeholder="Paid cash at the counter, left-handed, first time on a wheel…"
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Taking the booking…' : 'Take booking'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
