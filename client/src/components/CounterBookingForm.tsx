import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  money,
  plusDays,
  timeIn,
  todayIn,
  zonedToInstant,
} from '../lib/api';

/**
 * A booking taken over the phone or at the counter.
 *
 * G0. Built because `createManualBooking` existed, was routed, gated and
 * tested, and nothing in the client called it — while the Dashboard's primary
 * button said "New booking" and linked to a list with no form.
 *
 * ---
 *
 * Laid out in three sections after the prototype's: GUEST, EXPERIENCE,
 * PAYMENT. The grouping earns its place — an operator on the phone works down
 * it in that order, and a flat column of fourteen fields does not tell them
 * when they have finished asking questions and started taking money.
 *
 * Two of the prototype's fields were declined here and BOTH decisions have
 * since been overturned. The original reasoning is kept because it says what
 * would have to stay true for them to be right:
 *
 * - **Children.** Declined because there was no child price in the schema, so
 *   a second quantity box would have collected a number and silently charged
 *   the adult rate for it. `child_price_cents` landed on 2026-09-03 and the
 *   box now prices through `priceBooking`, exactly like the public page. The
 *   objection was correct and is simply no longer true.
 * - **Waiver signed.** Declined because a checkbox with nothing behind it
 *   reads as a record that somebody signed something. Asked for anyway on
 *   2026-09-07, and it now writes `waiver_signed_at` — so it IS a record, of
 *   the desk saying paper was signed. It is still not a waiver feature:
 *   nothing collects or stores a document and the public flow does not ask.
 *
 * What IS here that the prototype fakes: the payment is a real row in the
 * ledger, so the Paid pill, the payments screen and the outstanding figure all
 * agree without being told separately. The prototype's "Payment status" is
 * also persisted now — as the desk's claim, which the ledger may contradict.
 * See the `payment_state` column's comment before believing it.
 */

type ServiceOption = {
  id: string;
  name: string;
  bookingMode: 'APPOINTMENT' | 'EVENT' | 'COURSE_SERIES';
  durationMinutes: number;
  priceCents?: number;
  /** Zero means ADULTS ONLY, not "children go free". See priceBooking. */
  childPriceCents?: number;
  isActive?: boolean;
};

type SessionOption = {
  id: string;
  startsAt: string;
  capacity: number;
  seatsTaken: number;
  status: string;
  serviceType: { id: string; name: string };
  staff: { id: string; name: string } | null;
};

type CustomerOption = { id: string; name: string; email: string };

/** How far ahead the date picker looks. Matches the default booking horizon. */
const HORIZON_DAYS = 120;

const METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'transfer', label: 'Bank transfer' },
  { id: 'other', label: 'Other' },
] as const;

export function CounterBookingForm({
  base,
  timezone,
  currency,
  customerId: presetCustomerId,
  onBooked,
  onCancel,
}: {
  base: string;
  timezone: string;
  currency: string;
  /**
   * Opened from a customer's row, so the guest is already known.
   *
   * Only the INITIAL value — the picker stays enabled. Locking it would mean
   * an operator who opened the wrong row has to close the dialog and start
   * again, and the field is right there.
   */
  customerId?: string;
  onBooked: () => void;
  onCancel: () => void;
}) {
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);

  // --- Guest ---------------------------------------------------------------
  const [customerId, setCustomerId] = useState(presetCustomerId ?? '');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // --- Experience ----------------------------------------------------------
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [onDate, setOnDate] = useState(() => todayIn(timezone));
  const [sessionId, setSessionId] = useState('');
  const [localTime, setLocalTime] = useState('18:00');
  const [staffId, setStaffId] = useState('');
  /*
    Adults and children are held SEPARATELY here and added into one `seats`
    before the request, because that is how somebody says it at the desk. The
    server and the database only ever see the total plus how many of it are
    children — the same rule the public page follows.
  */
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const seats = adults + children;

  // --- Payment -------------------------------------------------------------
  const [status, setStatus] = useState<'CONFIRMED' | 'PENDING'>('CONFIRMED');
  const [method, setMethod] = useState('cash');
  const [paymentState, setPaymentState] = useState<'paid' | 'part' | 'none'>('none');
  const [partAmount, setPartAmount] = useState('');
  const [total, setTotal] = useState('');
  const [notes, setNotes] = useState('');
  const [waiverSigned, setWaiverSigned] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const service = services.find((s) => s.id === serviceTypeId);
  const isAppointment = service?.bookingMode === 'APPOINTMENT';

  useEffect(() => {
    void (async () => {
      try {
        const [svc, st, cust] = await Promise.all([
          api.get<{ services: ServiceOption[] }>(`${base}/services`),
          api.get<{ staff: { id: string; name: string }[] }>(`${base}/staff`),
          api.get<{ customers: CustomerOption[] }>(`${base}/customers?limit=200`),
        ]);

        /*
          A course is sold as an ENROLMENT covering every week, not as one
          booking against a cohort — offering it here would sell a single
          session of something bought whole.
        */
        setServices(
          svc.services.filter(
            (s) => s.isActive !== false && s.bookingMode !== 'COURSE_SERIES',
          ),
        );
        setStaff(st.staff);
        setCustomers(cust.customers ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your classes.');
      }
    })();
  }, [base]);

  /** Every scheduled date for the chosen class, filtered client-side. */
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

  /**
   * The departures on the chosen day.
   *
   * Date and departure are two controls, not one long list, which is the
   * prototype's arrangement and the better one: a studio running a class three
   * times on a Saturday should be picked by day first, and a single dropdown
   * of ninety dated times is unreadable by the second week.
   */
  const departures = useMemo(
    () =>
      sessions.filter(
        (s) =>
          new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(s.startsAt)) === onDate,
      ),
    [sessions, onDate, timezone],
  );

  /* Auto-selected when there is only one, and cleared when the day changes to
     one that no longer contains the chosen departure. */
  useEffect(() => {
    if (departures.length === 1) setSessionId(departures[0]!.id);
    else if (!departures.some((d) => d.id === sessionId)) setSessionId('');
  }, [departures, sessionId]);

  const chosen = departures.find((s) => s.id === sessionId);
  const seatsLeft = chosen ? Math.max(0, chosen.capacity - chosen.seatsTaken) : 0;

  /**
   * The list price, which the Total field starts at and may be overridden.
   *
   * Mirrors `priceBooking` rather than multiplying, and the mirror has to
   * include the adults-only rule: a zero child price is the default every
   * service carries and means children pay the ADULT rate here, not nothing.
   * Getting that wrong client-side would quote a total the server then
   * refuses to match, and the studio would blame the server.
   */
  const childUnit = service?.childPriceCents ?? 0;
  const billedChildren = childUnit > 0 ? children : 0;
  const listCents =
    (service?.priceCents ?? 0) * (seats - billedChildren) +
    childUnit * billedChildren;
  const totalCents =
    total.trim() === '' ? listCents : Math.round(Number(total) * 100) || 0;

  const paidCents =
    paymentState === 'paid'
      ? totalCents
      : paymentState === 'part'
        ? Math.round(Number(partAmount || 0) * 100)
        : 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const body = {
      serviceTypeId,
      ...(isAppointment
        ? {
            staffId,
            /* A datetime-local carries no zone, and `new Date` on one resolves
               it against the BROWSER's — a front desk on the wrong zone would
               book a different hour than the one they typed. */
            startsAt: zonedToInstant(`${onDate}T${localTime}`, timezone),
            seats: 1,
          }
        : { sessionId, seats, children, ...(staffId ? { staffId } : {}) }),
      ...(customerId
        ? { customerId }
        : {
            customer: {
              name: name.trim(),
              email: email.trim(),
              ...(phone.trim() ? { phone: phone.trim() } : {}),
            },
          }),
      status,
      /*
        The desk's claim, sent alongside the real payment row rather than
        instead of it. 'none' means nobody has paid yet, which is PENDING —
        a claim, unlike the absent value the system's own bookings carry.
      */
      paymentState:
        paymentState === 'paid'
          ? 'PAID'
          : paymentState === 'part'
            ? 'PARTIALLY_PAID'
            : 'PENDING',
      ...(totalCents !== listCents ? { totalCents } : {}),
      ...(paidCents > 0 ? { payment: { method, amountCents: paidCents } } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(waiverSigned ? { waiverSigned: true } : {}),
    };

    try {
      await api.post(`${base}/bookings`, body);
      onBooked();
    } catch (err) {
      /* The server's message is the useful one: it knows about capacity, the
         booking horizon and the instructor-overlap constraint. */
      setError(err instanceof Error ? err.message : 'Could not take the booking.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="err">{error}</div>}

      <h3 className="form-section">Guest</h3>

      <div className="setting setting-stack">
        <label htmlFor="cbCustomer">Customer</label>
        <select
          id="cbCustomer"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
        >
          <option value="">+ New customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.email}
            </option>
          ))}
        </select>
      </div>

      {!customerId && (
        <>
          <div className="setting setting-stack">
            <label htmlFor="cbName">Name</label>
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
            {/* Not a formality: an existing customer is matched on this, so a
                typo splits one person into two records. */}
            <p className="tiny muted">
              Used to find them if they have booked here before.
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
        </>
      )}

      <h3 className="form-section">Experience</h3>

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="cbService">Activity</label>
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
        </div>

        <div className="setting setting-stack">
          <label htmlFor="cbDate">Date</label>
          <input
            id="cbDate"
            type="date"
            required
            value={onDate}
            onChange={(e) => setOnDate(e.target.value)}
          />
        </div>
      </div>

      {service && !isAppointment && (
        <>
          <div className="setting setting-stack">
            <label htmlFor="cbSession">Departure</label>
            <select
              id="cbSession"
              required
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            >
              <option value="">Choose a time…</option>
              {departures.map((s) => {
                const left = s.capacity - s.seatsTaken;
                return (
                  <option key={s.id} value={s.id} disabled={left <= 0}>
                    {timeIn(s.startsAt, timezone)}
                    {' — '}
                    {left > 0 ? `${left} of ${s.capacity} places left` : 'full'}
                    {service.priceCents
                      ? ` · ${money(service.priceCents, currency)} each`
                      : ''}
                  </option>
                );
              })}
            </select>
            <p className="tiny muted">
              {departures.length === 0
                ? 'Nothing scheduled that day.'
                : `${departures.length} ${
                    departures.length === 1 ? 'departure' : 'departures'
                  } that day.`}
            </p>
          </div>

          <div className="form-row">
            <div className="setting setting-stack">
              <label htmlFor="cbAdults">Adults</label>
              <input
                id="cbAdults"
                type="number"
                min={1}
                max={Math.max(1, seatsLeft)}
                value={adults}
                onChange={(e) =>
                  setAdults(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </div>

            <div className="setting setting-stack">
              <label htmlFor="cbChildren">Children</label>
              <input
                id="cbChildren"
                type="number"
                min={0}
                max={Math.max(0, seatsLeft - adults)}
                value={children}
                onChange={(e) =>
                  setChildren(Math.max(0, Number(e.target.value) || 0))
                }
              />
              {/* Said out loud only when it changes the price. On a service
                  with no child rate the seat costs the same, and a line
                  claiming otherwise would be the silent overcharge this field
                  was originally declined to avoid. */}
              <p className="tiny muted">
                {childUnit > 0
                  ? `${money(childUnit, currency)} each`
                  : 'Same price as an adult on this class.'}
              </p>
            </div>
          </div>
        </>
      )}

      {service && isAppointment && (
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
      )}

      <div className="setting setting-stack">
        <label htmlFor="cbStaff">Instructor</label>
        <select
          id="cbStaff"
          required={isAppointment}
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
        >
          <option value="">
            {isAppointment ? 'Choose an instructor…' : 'Whoever is teaching'}
          </option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <h3 className="form-section">Payment</h3>

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="cbPaid">Payment</label>
          <select
            id="cbPaid"
            value={paymentState}
            onChange={(e) => setPaymentState(e.target.value as never)}
          >
            <option value="none">Nothing yet</option>
            <option value="part">Part paid</option>
            <option value="paid">Paid in full</option>
          </select>
        </div>

        <div className="setting setting-stack">
          <label htmlFor="cbMethod">Method</label>
          <select
            id="cbMethod"
            value={method}
            disabled={paymentState === 'none'}
            onChange={(e) => setMethod(e.target.value)}
          >
            {METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {paymentState === 'part' && (
        <div className="setting setting-stack">
          <label htmlFor="cbPart">Taken now</label>
          <input
            id="cbPart"
            type="number"
            min={0}
            step="0.01"
            value={partAmount}
            placeholder="0.00"
            onChange={(e) => setPartAmount(e.target.value)}
          />
        </div>
      )}

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="cbStatus">Booking status</label>
          <select
            id="cbStatus"
            value={status}
            onChange={(e) => setStatus(e.target.value as never)}
          >
            <option value="CONFIRMED">Confirmed</option>
            <option value="PENDING">Pending</option>
          </select>
        </div>

        <div className="setting setting-stack">
          <label htmlFor="cbTotal">Total</label>
          <input
            id="cbTotal"
            type="number"
            min={0}
            step="0.01"
            value={total}
            placeholder={(listCents / 100).toFixed(2)}
            onChange={(e) => setTotal(e.target.value)}
          />
          {/* The list price is the default and the placeholder; typing over it
              is a deliberate act, and the line below says what it replaced. */}
          {/* The list price is the default and the placeholder; typing over it
              is a deliberate act, and the line below says what it replaced.
              The split is spelled out only when the two rates differ — on an
              adults-only service "2 × $80 + 1 × $80" is noise. */}
          <p className="tiny muted">
            {!service?.priceCents
              ? 'Free'
              : billedChildren > 0
                ? `${seats - billedChildren} × ${money(
                    service.priceCents,
                    currency,
                  )} + ${billedChildren} × ${money(childUnit, currency)}`
                : `${seats} × ${money(service.priceCents, currency)}`}
            {total.trim() !== '' && totalCents !== listCents ? ' — overridden' : ''}
          </p>
        </div>
      </div>

      {/*
        The desk's record that paper was signed. Deliberately worded as the
        desk's claim rather than "Waiver on file" — nothing here holds a
        document, and a label implying one would be a promise the product
        does not keep.
      */}
      <label className="check">
        <input
          type="checkbox"
          checked={waiverSigned}
          onChange={(e) => setWaiverSigned(e.target.checked)}
        />
        Waiver signed
      </label>

      <div className="setting setting-stack">
        <label htmlFor="cbNotes">Internal notes</label>
        <textarea
          id="cbNotes"
          rows={2}
          maxLength={2000}
          value={notes}
          placeholder="Anything the instructor should know"
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* The footer summary, as the prototype has it: the three numbers that
          decide whether the operator has understood the booking they are about
          to take. */}
      <div className="counter-foot">
        <span className="tiny muted">
          {seats} {seats === 1 ? 'place' : 'places'} ·{' '}
          {money(totalCents, currency)}
          {paidCents > 0 ? ` · ${money(paidCents, currency)} taken` : ''}
          {chosen ? ` · ${seatsLeft} still free` : ''}
        </span>

        <div className="counter-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create booking'}
          </button>
        </div>
      </div>
    </form>
  );
}
