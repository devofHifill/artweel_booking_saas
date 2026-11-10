import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  money,
  plusDays,
  timeIn,
  todayIn,
  zonedToInstant,
} from '../lib/api';
import { useActiveOrg } from '../lib/auth';

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
  /** The most a session of it may seat; the default for a new session. */
  capacityMax?: number;
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

type LocationOption = { id: string; name: string };

type Clash = { kind: 'STAFF' | 'LOCATION'; message: string };

/**
 * FB-01. The desk could only book into a session that already existed, so a
 * caller asking for a day with nothing scheduled was a dead end: an empty time
 * list and a browser bubble. Now the operator either picks an existing session
 * or creates one right here, without losing the guest details they have
 * already typed.
 */
type SessionMode = 'existing' | 'new';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "18:00" plus minutes, or null when it would run past midnight. */
function addMinutes(time: string, minutes: number): string | null {
  const [h, m] = time.split(':').map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * A guest-count box's text, cleaned on every keystroke: digits only, no
 * leading zeros ("01" → "1", "007" → "7"), at most three digits. Empty stays
 * empty so the operator can clear the box and type; blur turns it back to 0.
 */
function cleanCount(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 3);
  if (digits === '') return '';
  return String(Number(digits));
}

/** The studio's own date and 24-hour time right now, for refusing the past. */
function nowIn(timezone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** "Sat 14 Nov" for a `YYYY-MM-DD`, read as a calendar date (no zone shift). */
function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

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
  const [locations, setLocations] = useState<LocationOption[]>([]);

  /* Creating a session is scheduling, which the server keeps to owners and
     admins. Instructors still get the existing-session path. */
  const org = useActiveOrg();
  const canSchedule = org?.role === 'OWNER' || org?.role === 'ADMIN';

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

  // --- A new session, when none on the day fits ----------------------------
  const [sessionMode, setSessionMode] = useState<SessionMode>('existing');
  const [newTime, setNewTime] = useState('10:00');
  const [newCapacity, setNewCapacity] = useState('');
  const [newLocationId, setNewLocationId] = useState('');
  const [clashes, setClashes] = useState<Clash[]>([]);
  const [checking, setChecking] = useState(false);
  /** Set once Create booking is pressed, so blockers show only when asked. */
  const [tried, setTried] = useState(false);
  /** Same, for the Create session button. */
  const [triedSession, setTriedSession] = useState(false);
  /** "Session created … now create the booking", after step one. */
  const [createdNote, setCreatedNote] = useState<string | null>(null);
  /*
    Adults and children are held SEPARATELY here and added into one `seats`
    before the request, because that is how somebody says it at the desk. The
    server and the database only ever see the total plus how many of it are
    children — the same rule the public page follows.
  */
  /*
    FB-03. Held as the TEXT in each box, not as numbers. As numbers, clearing
    the box snapped it straight back to 1 (so typing 2 gave "12"), and React
    leaves a number input's text alone when it parses to the same value (so
    "01" stayed on screen). As text, the box can be empty while the operator
    types, and the cleaned-up text is written back on every keystroke.
    Both start at zero: the operator says how many, rather than correcting a
    guess.
  */
  const [adultsText, setAdultsText] = useState('0');
  const [childrenText, setChildrenText] = useState('0');
  const adults = Number(adultsText) || 0;
  const children = Number(childrenText) || 0;
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
        setError(err instanceof Error ? err.message : 'Could not load your activities.');
      }

      /* Only for a new session, so a failure here must not break the form:
         without it the new session simply goes to the studio's default. */
      try {
        const loc = await api.get<{ locations: LocationOption[] }>(`${base}/locations`);
        setLocations(loc.locations ?? []);
        if (loc.locations?.length === 1) setNewLocationId(loc.locations[0]!.id);
      } catch {
        setLocations([]);
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
    setSessionMode('existing');
    void loadSessions();
  }, [loadSessions]);

  /* A new session starts at the activity's full size; the operator can lower
     it. Reset when the activity changes so one class's size never carries
     into another's. */
  useEffect(() => {
    setNewCapacity(service?.capacityMax ? String(service.capacityMax) : '');
  }, [service?.id, service?.capacityMax]);

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

  /** Local `YYYY-MM-DD` of a session, in the studio's zone. */
  const localDateOf = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(iso)),
    [timezone],
  );

  /**
   * The next few days that DO have a session with room, so an empty day is
   * never a dead end: one click moves the date there and keeps everything
   * else the operator has typed.
   */
  const nextDates = useMemo(() => {
    const today = todayIn(timezone);
    const seen = new Set<string>();
    for (const s of sessions) {
      if (s.capacity - s.seatsTaken <= 0) continue;
      const day = localDateOf(s.startsAt);
      if (day === onDate || day < today) continue;
      seen.add(day);
    }
    return [...seen].sort().slice(0, 4);
  }, [sessions, onDate, timezone, localDateOf]);

  const creating = sessionMode === 'new' && !isAppointment;

  /* A studio with one instructor (every Solo studio) has only one answer, so
     it is filled in rather than asked. */
  useEffect(() => {
    if (creating && !staffId && staff.length === 1) setStaffId(staff[0]!.id);
  }, [creating, staffId, staff]);

  /* The "session created" note belongs to that date and activity only. */
  useEffect(() => {
    setCreatedNote(null);
  }, [onDate, serviceTypeId]);
  const newCapacityNum = Math.floor(Number(newCapacity) || 0);
  const newEndTime = service ? addMinutes(newTime, service.durationMinutes) : null;

  /*
    Clashes for the new session, asked while the operator is still choosing —
    the same preview Create activity uses. Writes nothing. Debounced so typing
    a time does not fire a request per keystroke.
  */
  useEffect(() => {
    if (!creating || !service || !newEndTime || !canSchedule) {
      setClashes([]);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(() => {
      api
        .post<{ dates: { localDate: string; clashes: Clash[] }[] }>(
          `${base}/activities/preview`,
          {
            kind: 'EVENT',
            date: onDate,
            startTime: newTime,
            endTime: newEndTime,
            ...(staffId ? { staffId } : {}),
            ...(newLocationId ? { locationId: newLocationId } : {}),
          },
        )
        .then((res) => {
          if (!cancelled) setClashes(res.dates.flatMap((d) => d.clashes));
        })
        .catch(() => {
          // The server checks again on create; a failed preview is not a clash.
          if (!cancelled) setClashes([]);
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [creating, service, newEndTime, canSchedule, base, onDate, newTime, staffId, newLocationId]);

  const chosen = departures.find((s) => s.id === sessionId);
  const seatsLeft = creating
    ? newCapacityNum
    : chosen
      ? Math.max(0, chosen.capacity - chosen.seatsTaken)
      : 0;
  /** Only meaningful once a session is chosen; before that nothing is "left". */
  const hasSession = Boolean(chosen && !creating);
  const overCapacity = hasSession && seats > seatsLeft;

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

  /**
   * Everything standing between the operator and a booking, in words.
   *
   * Replaces the browser's own "Please select an item in the list" bubble,
   * which pointed at an empty dropdown and said nothing about why it was
   * empty or what to do instead.
   */
  /**
   * What stops the NEW session being created. Checked by its own button, so
   * the operator can fix the session without being told about guest fields
   * they have not reached yet.
   */
  const sessionBlockers: string[] = [];
  if (creating && service) {
    const now = nowIn(timezone);
    if (onDate < now.date || (onDate === now.date && newTime <= now.time))
      sessionBlockers.push(
        `${dayLabel(onDate)} at ${newTime} has already passed. Choose a later date or time.`,
      );
    if (!newEndTime)
      sessionBlockers.push('The session would run past midnight. Choose an earlier start time.');
    if (newCapacityNum < 1) sessionBlockers.push('Set how many places the new session has.');
    else if (service.capacityMax && newCapacityNum > service.capacityMax)
      sessionBlockers.push(`${service.name} seats at most ${service.capacityMax}.`);
    if (!staffId) sessionBlockers.push('Choose the instructor who teaches the new session.');
    if (locations.length > 1 && !newLocationId)
      sessionBlockers.push('Choose where the new session runs.');
    if (clashes.length > 0)
      sessionBlockers.push('The new session clashes — see the note under Session time.');
  }

  /**
   * Everything standing between the operator and a booking, in words.
   *
   * Replaces the browser's own "Please select an item in the list" bubble,
   * which pointed at an empty dropdown and said nothing about why it was
   * empty or what to do instead.
   */
  const blockers: string[] = [];
  if (!customerId) {
    if (!name.trim()) blockers.push('Add the guest’s name.');
    if (!EMAIL.test(email.trim())) blockers.push('Add a valid email for the guest.');
  }
  if (!service) blockers.push('Choose an activity.');
  if (service && isAppointment) {
    if (!staffId) blockers.push('Choose an instructor.');
  }
  if (service && !isAppointment && creating) {
    blockers.push('Press “Create session” first, then create the booking.');
  }
  if (service && !isAppointment && !creating) {
    if (departures.length === 0) {
      blockers.push(
        canSchedule
          ? `Nothing is scheduled for ${service.name} on ${dayLabel(onDate)}. Pick another date, or choose “Create a new session”.`
          : `Nothing is scheduled for ${service.name} on ${dayLabel(onDate)}. Pick another date, or ask an owner or admin to add a session.`,
      );
    } else if (!chosen) {
      blockers.push('Choose a session time.');
    }
  }
  if (service && !isAppointment && seats === 0) {
    blockers.push('Add at least one guest — Adults or Children.');
  }
  if (service && !isAppointment && overCapacity) {
    blockers.push(
      `That is ${seats} ${seats === 1 ? 'guest' : 'guests'} and only ${seatsLeft} ${
        seatsLeft === 1 ? 'place is' : 'places are'
      } free.`,
    );
  }

  /**
   * Step one of two: put the session on the calendar, then come back to the
   * form with it selected — the client's requested flow. The booking is a
   * separate, deliberate press of Create booking, so the operator sees the
   * session exist before any money is recorded against it.
   */
  async function createSession() {
    setTriedSession(true);
    if (!service || sessionBlockers.length > 0) return;

    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ created: { id: string }[] }>(`${base}/sessions`, {
        serviceTypeId,
        startLocalDate: onDate,
        localStartTime: newTime,
        timezone,
        capacity: newCapacityNum,
        staffId,
        ...(newLocationId ? { locationId: newLocationId } : {}),
      });
      const id = res.created[0]!.id;
      await loadSessions();
      // Batched with the reload above, so the list already holds it.
      setSessionMode('existing');
      setSessionId(id);
      setTriedSession(false);
      setCreatedNote(
        `Session created: ${dayLabel(onDate)} at ${newTime}, ${newCapacityNum} places. It is selected below — now create the booking.`,
      );
    } catch (err) {
      setError(
        `Could not create the session: ${
          err instanceof Error ? err.message : 'something went wrong.'
        }`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTried(true);
    if (blockers.length > 0) return;

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
    /* noValidate: the blockers list below says what is missing in words,
       instead of the browser pointing a bubble at one field at a time. */
    <form onSubmit={submit} noValidate>
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
            <label htmlFor={creating ? 'cbNewTime' : 'cbSession'}>Session time</label>

            {canSchedule && (
              <div
                className="seg"
                role="group"
                aria-label="Session"
                style={{ marginBottom: 8, alignSelf: 'flex-start' }}
              >
                <button
                  type="button"
                  className={!creating ? 'on' : ''}
                  aria-pressed={!creating}
                  onClick={() => setSessionMode('existing')}
                >
                  Choose an existing session
                </button>
                <button
                  type="button"
                  className={creating ? 'on' : ''}
                  aria-pressed={creating}
                  onClick={() => setSessionMode('new')}
                >
                  Create a new session
                </button>
              </div>
            )}

            {!creating && (
              <>
                <select
                  id="cbSession"
                  value={sessionId}
                  disabled={departures.length === 0}
                  onChange={(e) => setSessionId(e.target.value)}
                >
                  <option value="">
                    {departures.length === 0 ? 'No sessions on this date' : 'Choose a time…'}
                  </option>
                  {departures.map((s) => {
                    const left = s.capacity - s.seatsTaken;
                    return (
                      <option key={s.id} value={s.id} disabled={left <= 0}>
                        {timeIn(s.startsAt, timezone)}
                        {' — '}
                        {left > 0 ? `${left} of ${s.capacity} places left` : 'full'}
                        {s.staff ? ` · ${s.staff.name}` : ''}
                        {service.priceCents
                          ? ` · ${money(service.priceCents, currency)} each`
                          : ''}
                      </option>
                    );
                  })}
                </select>

                {departures.length === 0 ? (
                  <div className="tiny muted" style={{ marginTop: 6 }}>
                    <p style={{ margin: 0 }}>
                      Nothing scheduled on {dayLabel(onDate)}.
                      {nextDates.length > 0 ? ' Next dates with places:' : ' No upcoming dates with places.'}
                    </p>
                    {nextDates.length > 0 && (
                      <div className="chips" style={{ marginTop: 6 }}>
                        {nextDates.map((d) => (
                          <button
                            type="button"
                            key={d}
                            className="chip"
                            onClick={() => setOnDate(d)}
                          >
                            {dayLabel(d)}
                          </button>
                        ))}
                      </div>
                    )}
                    {canSchedule && (
                      <p style={{ margin: '6px 0 0' }}>
                        Or{' '}
                        <button
                          type="button"
                          className="link"
                          onClick={() => setSessionMode('new')}
                        >
                          create a new session on {dayLabel(onDate)}
                        </button>
                        .
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="tiny muted">
                    {departures.length} {departures.length === 1 ? 'session' : 'sessions'} that day.
                  </p>
                )}

                {createdNote && (
                  <div
                    className="tiny"
                    role="status"
                    style={{
                      marginTop: 6,
                      padding: '6px 8px',
                      borderRadius: 6,
                      color: 'var(--ok)',
                      background: 'color-mix(in srgb, var(--ok) 12%, var(--card))',
                    }}
                  >
                    {createdNote}
                  </div>
                )}
              </>
            )}

            {creating && (
              <>
                <div className="form-row">
                  <div className="setting setting-stack">
                    <label htmlFor="cbNewTime" className="tiny">
                      Starts
                    </label>
                    <input
                      id="cbNewTime"
                      type="time"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                    />
                  </div>
                  <div className="setting setting-stack">
                    <label htmlFor="cbNewCap" className="tiny">
                      Places
                    </label>
                    <input
                      id="cbNewCap"
                      type="number"
                      min={1}
                      max={service.capacityMax || undefined}
                      value={newCapacity}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setNewCapacity(e.target.value)}
                    />
                  </div>
                </div>

                <div className="setting setting-stack">
                  <label htmlFor="cbNewStaff" className="tiny">
                    Instructor
                  </label>
                  <select
                    id="cbNewStaff"
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

                {locations.length > 1 && (
                  <div className="setting setting-stack">
                    <label htmlFor="cbNewLoc" className="tiny">
                      Where
                    </label>
                    <select
                      id="cbNewLoc"
                      value={newLocationId}
                      onChange={(e) => setNewLocationId(e.target.value)}
                    >
                      <option value="">Choose a location…</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <p className="tiny muted">
                  {dayLabel(onDate)}, {newTime}
                  {newEndTime ? `–${newEndTime}` : ''} ({service.durationMinutes} min)
                  {locations.length === 1 ? ` · ${locations[0]!.name}` : ''}. It goes on the
                  calendar and booking page like any session.
                </p>
                {checking ? (
                  <p className="tiny muted">Checking for clashes…</p>
                ) : clashes.length > 0 ? (
                  <div className="err" style={{ marginTop: 6 }}>
                    {clashes.map((c, i) => (
                      <div key={i}>{c.message}</div>
                    ))}
                  </div>
                ) : newEndTime ? (
                  <p className="tiny muted">No clashes.</p>
                ) : null}

                {triedSession && sessionBlockers.length > 0 && (
                  <div className="err" role="alert" style={{ marginTop: 6 }}>
                    <b>Before the session can be created:</b>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {sessionBlockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => void createSession()}
                  >
                    {busy ? 'Creating session…' : 'Create session'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setSessionMode('existing')}
                  >
                    Back to existing sessions
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="form-row">
            <div className="setting setting-stack">
              <label htmlFor="cbAdults">Adults</label>
              {/* Selected on focus, so typing replaces the value instead of
                  appending to it. The arrows still step within the places
                  left; typing past them is allowed but flagged below. */}
              <input
                id="cbAdults"
                type="number"
                inputMode="numeric"
                min={0}
                max={hasSession ? Math.max(0, seatsLeft - children) : undefined}
                value={adultsText}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setAdultsText(cleanCount(e.target.value))}
                onBlur={() => adultsText === '' && setAdultsText('0')}
              />
            </div>

            <div className="setting setting-stack">
              <label htmlFor="cbChildren">Children</label>
              <input
                id="cbChildren"
                type="number"
                inputMode="numeric"
                min={0}
                max={hasSession ? Math.max(0, seatsLeft - adults) : undefined}
                value={childrenText}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setChildrenText(cleanCount(e.target.value))}
                onBlur={() => childrenText === '' && setChildrenText('0')}
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

          {/* The party and its price, right under the boxes that change
              them — the same `seats` and `totalCents` the footer and the
              request use, so the three can never disagree. */}
          {seats > 0 && overCapacity ? (
            <div className="err" role="status">
              {seats} {seats === 1 ? 'guest' : 'guests'}, but only {seatsLeft}{' '}
              {seatsLeft === 1 ? 'place is' : 'places are'} free in this session.
            </div>
          ) : (
            <p className="tiny muted" role="status">
              {seats === 0
                ? 'Add at least one guest.'
                : `${seats} ${seats === 1 ? 'guest' : 'guests'} · ${money(totalCents, currency)}`}
            </p>
          )}
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

      {/* Hidden while creating a session: the session panel asks for its
          instructor itself, and two boxes for one answer read as two answers. */}
      {!creating && (
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
      )}

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
      {tried && blockers.length > 0 && (
        <div className="err" role="alert">
          <b>Before this booking can be created:</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="counter-foot">
        <span className="tiny muted">
          {seats} {seats === 1 ? 'place' : 'places'} ·{' '}
          {money(totalCents, currency)}
          {paidCents > 0 ? ` · ${money(paidCents, currency)} taken` : ''}
          {chosen && !creating ? ` · ${seatsLeft} still free` : ''}
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
