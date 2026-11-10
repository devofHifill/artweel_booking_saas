import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, timeIn, type BookingListItem } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { PageHead } from '../components/layout';

/**
 * The calendar. Month and week.
 *
 * WEEK shows the same sessions as MONTH, each sized to its length with the
 * bookings in it, plus one-to-one appointments on their own (FB-05: it used to
 * read bookings only, so an unbooked class was invisible there).
 *
 * WEEK is also the drag-to-reschedule grid. Dragging is a convenience over the real
 * mechanism, not a replacement for it: the drop calls the same reschedule
 * endpoint the customer-facing flow uses, which cancels and rebooks through the
 * scheduling core. If the instructor is busy at the target time, the exclusion
 * constraint refuses it and the card snaps back — the UI cannot talk the server
 * into a double booking.
 *
 * MONTH is the overview, added in D3 to match the prototype, which opens on it.
 * It reads SESSIONS rather than bookings, because the question a month grid
 * answers is "what is running and how full is it" — and only a session knows
 * its capacity. A month of bookings could say how many people are coming and
 * never how many seats there were.
 *
 * The prototype also has a day view and a side panel for the selected day.
 * Neither is built: day view is week view with one column, and the side panel
 * duplicates what the Daily Manifest already does better. Recorded as a gap in
 * TOURFLOW-PARITY-PLAN.md rather than half-built here.
 */

type Mode = 'month' | 'week';

type MonthSession = {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  seatsTaken: number;
  serviceType: { name: string; color: string };
};

/** Sunday-anchored grid of 42 days covering the month `anchor` falls in. */
function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });
}

const START_HOUR = 8;
const END_HOUR = 21;
const SLOT_MINUTES = 30;

/** "11a", "2:30p" — the time a phone-width month cell has room for (FB-06). */
function shortTime(iso: string, timezone: string): string {
  const { hour, minute } = partsIn(iso, timezone);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${hour < 12 ? 'a' : 'p'}`;
}

/** Default grid hours; the week stretches them to fit what is on (FB-05). */
type Slot = { hour: number; minute: number };

/** Local-time parts of an instant, in the studio's zone. */
function partsIn(iso: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/**
 * Builds the instant for a local date and wall-clock time in a given zone.
 *
 * Binary search over the offset rather than assuming one: the browser cannot
 * construct "2pm in New York" directly, and guessing the offset breaks twice a
 * year — which is exactly the class of bug the server side goes to lengths to
 * avoid.
 */
function instantFor(
  localDate: string,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const target = `${localDate} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  // Start from the naive UTC reading and correct by the observed offset.
  let guess = new Date(`${localDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);

  for (let i = 0; i < 3; i++) {
    const observed = partsIn(guess.toISOString(), timezone);
    const observedText = `${observed.date} ${String(observed.hour).padStart(2, '0')}:${String(observed.minute).padStart(2, '0')}`;
    if (observedText === target) break;

    const drift =
      new Date(`${observedText.replace(' ', 'T')}:00Z`).getTime() -
      new Date(`${target.replace(' ', 'T')}:00Z`).getTime();

    guess = new Date(guess.getTime() - drift);
  }

  return guess;
}


/*
  FB-05. The week is a run of STUDIO-local dates ("2026-11-08"), not browser
  Dates. It used to start at the browser's midnight, so from a laptop in
  another zone the fetched range slid off the studio's week — from India it
  ended at 2:30 PM New York time on Saturday and that evening's bookings were
  never drawn. Calendar dates carry no zone; plain UTC arithmetic on them is
  exact.
*/
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function sundayOf(ymd: string): string {
  return addDays(ymd, -new Date(`${ymd}T00:00:00Z`).getUTCDay());
}

/** A studio-local date as text, e.g. "Nov 8" or "Sun". */
function dateLabel(ymd: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', {
    ...options,
    timeZone: 'UTC',
  });
}

/** A browser Date's own calendar date, for the month grid's cells. */
function ymdOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** What the week view draws for a session. */
type WeekSession = {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  seatsTaken: number;
  serviceType: { id: string; name: string; color: string };
  staff: { id: string; name: string } | null;
  seriesLabel: string | null;
};

/** One block on a day column: a session (with its bookings) or a lone booking. */
type Block =
  | { kind: 'session'; id: string; startsAt: string; endsAt: string; session: WeekSession; bookings: BookingListItem[] }
  | { kind: 'booking'; id: string; startsAt: string; endsAt: string; booking: BookingListItem };

type Placed = Block & { top: number; height: number; column: number; columns: number };

const SLOT_PX = 30;

/** Minutes past studio-local midnight. */
function minuteOfDay(iso: string, timezone: string): number {
  const p = partsIn(iso, timezone);
  return p.hour * 60 + p.minute;
}

/**
 * Lays one day's blocks out side by side where they overlap — a 10:00 class
 * running to 12:00 and an 11:00 class share the column rather than one
 * covering the other.
 */
function layoutDay(blocks: Block[], timezone: string, gridStartHour: number): Placed[] {
  const sorted = [...blocks].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];

  const closeCluster = () => {
    for (const p of cluster) p.columns = columnEnds.length;
    cluster = [];
    columnEnds = [];
  };

  for (const block of sorted) {
    const start = minuteOfDay(block.startsAt, timezone);
    // An end on the next day (past midnight) is drawn to the bottom of the grid.
    const sameDay = partsIn(block.endsAt, timezone).date === partsIn(block.startsAt, timezone).date;
    const end = Math.max(start + SLOT_MINUTES, sameDay ? minuteOfDay(block.endsAt, timezone) : 24 * 60);

    if (start >= clusterEnd) closeCluster();

    let column = columnEnds.findIndex((e) => e <= start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }
    clusterEnd = Math.max(clusterEnd, end);

    const item: Placed = {
      ...block,
      top: ((start - gridStartHour * 60) / SLOT_MINUTES) * SLOT_PX,
      height: ((end - start) / SLOT_MINUTES) * SLOT_PX,
      column,
      columns: 1,
    };
    cluster.push(item);
    placed.push(item);
  }
  closeCluster();
  return placed;
}

export default function CalendarPage() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';

  /** Today, as a studio-local `YYYY-MM-DD`. */
  const todayInStudio = partsIn(new Date().toISOString(), timezone).date;

  const [mode, setMode] = useState<Mode>('month');
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [monthSessions, setMonthSessions] = useState<MonthSession[]>([]);
  const [weekStart, setWeekStart] = useState(() => sundayOf(todayInStudio));
  const [weekSessions, setWeekSessions] = useState<WeekSession[]>([]);
  const [bookings, setBookings] = useState<BookingListItem[]>([]);
  const [dragging, setDragging] = useState<BookingListItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  /*
    FB-05. The week reads SESSIONS, like the month, and the bookings inside
    them. It used to read bookings only, so a class nobody had booked yet —
    most of a new studio's calendar — showed in Month and not in Week.
  */
  const load = useCallback(async () => {
    const from = instantFor(weekStart, 0, 0, timezone);
    const to = instantFor(addDays(weekStart, 7), 0, 0, timezone);

    try {
      const [bookingRes, sessionRes] = await Promise.all([
        api.get<{ bookings: BookingListItem[] }>(
          `${base}/bookings?from=${from.toISOString()}&to=${to.toISOString()}&limit=200&status=PENDING,CONFIRMED,ATTENDED`,
        ),
        // Studio-local dates, both ends inclusive (the server's windowFor).
        api.get<{ sessions: WeekSession[] }>(
          `${base}/sessions?from=${weekStart}&to=${addDays(weekStart, 6)}`,
        ),
      ]);
      setBookings(bookingRes.bookings);
      setWeekSessions(sessionRes.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    }
  }, [base, weekStart, timezone]);

  useEffect(() => {
    if (mode === 'week') void load();
  }, [load, mode]);

  /**
   * The month's sessions.
   *
   * Fetched over the whole visible GRID, not the calendar month — the grid
   * spills into the neighbouring months at both ends, and a class on the 31st
   * of the previous month is visible in the first row. Loading only the month
   * would leave those cells wrongly empty.
   */
  const loadMonth = useCallback(async () => {
    const grid = monthGrid(monthAnchor);
    const from = grid[0]!;
    const to = grid[grid.length - 1]!;

    try {
      const res = await api.get<{ sessions: MonthSession[] }>(
        `${base}/sessions?from=${ymdOf(from)}&to=${ymdOf(to)}`,
      );
      setMonthSessions(res.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the month.');
    }
  }, [base, monthAnchor]);

  useEffect(() => {
    if (mode === 'month') void loadMonth();
  }, [loadMonth, mode]);

  /** Sessions grouped by studio-local date, for the month grid. */
  const sessionsByDate = useMemo(() => {
    const map = new Map<string, MonthSession[]>();
    for (const session of monthSessions) {
      const key = partsIn(session.startsAt, timezone).date;
      const list = map.get(key);
      if (list) list.push(session);
      else map.set(key, [session]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return map;
  }, [monthSessions, timezone]);

  /**
   * The week's blocks by studio-local date: each session with the bookings
   * that sit in it, plus any booking with no session in view (one-to-one
   * appointments) on its own.
   */
  const blocksByDate = useMemo(() => {
    const inSession = new Map<string, BookingListItem[]>();
    const sessionIds = new Set(weekSessions.map((s) => s.id));
    const loose: BookingListItem[] = [];

    for (const booking of bookings) {
      if (booking.sessionId && sessionIds.has(booking.sessionId)) {
        const list = inSession.get(booking.sessionId) ?? [];
        list.push(booking);
        inSession.set(booking.sessionId, list);
      } else {
        loose.push(booking);
      }
    }

    const map = new Map<string, Block[]>();
    const add = (block: Block) => {
      const key = partsIn(block.startsAt, timezone).date;
      const list = map.get(key) ?? [];
      list.push(block);
      map.set(key, list);
    };

    for (const session of weekSessions) {
      add({
        kind: 'session',
        id: session.id,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        session,
        bookings: inSession.get(session.id) ?? [],
      });
    }
    for (const booking of loose) {
      add({ kind: 'booking', id: booking.id, startsAt: booking.startsAt, endsAt: booking.endsAt, booking });
    }
    return map;
  }, [bookings, weekSessions, timezone]);

  /*
    The grid's hours: 8am–9pm, stretched to fit anything earlier or later
    this week. A 7am class or a 9pm party was simply not drawn before.
  */
  const { gridStartHour, slots } = useMemo(() => {
    let first = START_HOUR;
    let last = END_HOUR;
    for (const list of blocksByDate.values()) {
      for (const block of list) {
        const start = partsIn(block.startsAt, timezone);
        first = Math.min(first, start.hour);
        const end = partsIn(block.endsAt, timezone);
        const endHour = end.date === start.date ? Math.ceil(end.hour + end.minute / 60) : 24;
        last = Math.max(last, endHour);
      }
    }
    const list: Slot[] = [];
    for (let hour = first; hour < Math.min(last, 24); hour++) {
      for (let minute = 0; minute < 60; minute += SLOT_MINUTES) list.push({ hour, minute });
    }
    return { gridStartHour: first, slots: list };
  }, [blocksByDate, timezone]);

  async function drop(dayDate: string, slot: Slot) {
    if (!dragging) return;

    const booking = dragging;
    setDragging(null);
    setDropTarget(null);

    if (booking.service.bookingMode !== 'APPOINTMENT') {
      setError(
        'Class bookings cannot be dragged. Cancel and rebook onto another date.',
      );
      return;
    }

    const startsAt = instantFor(dayDate, slot.hour, slot.minute, timezone);
    setBusy(true);

    try {
      await api.post(`${base}/bookings/${booking.id}/reschedule`, {
        startsAt: startsAt.toISOString(),
      });
      setError(null);
      await load();
    } catch (err) {
      // The server refused — usually because the instructor is busy then.
      // The card simply stays where it was.
      setError(err instanceof Error ? err.message : 'Could not move that.');
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === 'month'
      ? monthAnchor.toLocaleDateString(undefined, {
          month: 'long',
          year: 'numeric',
        })
      : `${dateLabel(weekStart, { month: 'short', day: 'numeric' })} – ${dateLabel(addDays(weekStart, 6), { month: 'short', day: 'numeric' })}`;

  /** One step back or forward, in whatever unit the current view uses. */
  function step(direction: -1 | 1) {
    if (mode === 'month') {
      setMonthAnchor(
        (current) =>
          new Date(current.getFullYear(), current.getMonth() + direction, 1),
      );
      return;
    }
    setWeekStart((current) => addDays(current, direction * 7));
  }

  function goToday() {
    setMonthAnchor(new Date());
    setWeekStart(sundayOf(todayInStudio));
  }

  return (
    <>
      <PageHead
        title="Calendar"
        lede={
          mode === 'week'
            ? `Drag an appointment to move it. Times shown in ${timezone.replace('_', ' ')}.`
            : 'Classes, capacity and who is running what.'
        }
      />

      {error && <div className="err">{error}</div>}

      {/*
        Navigation lives in the card head with the grid, not in the page head.
        It acts on the grid below it, and putting it up beside the page title
        left the two looking unrelated — the prototype's arrangement is right
        here for a reason that has nothing to do with matching it.
      */}
      <div className="card" style={{ padding: 0 }}>
        <div className="panel-head">
          <div className="cal-nav">
            <button
              className="sm"
              aria-label={mode === 'month' ? 'Previous month' : 'Previous week'}
              onClick={() => step(-1)}
            >
              ←
            </button>
            <button
              className="sm"
              aria-label={mode === 'month' ? 'Next month' : 'Next week'}
              onClick={() => step(1)}
            >
              →
            </button>
            <h2>{title}</h2>
          </div>

          <div className="right">
            <button className="sm" onClick={goToday}>
              Today
            </button>
            <div className="seg" role="group" aria-label="Calendar view">
              <button
                className={mode === 'month' ? 'on' : ''}
                aria-pressed={mode === 'month'}
                onClick={() => setMode('month')}
              >
                Month
              </button>
              <button
                className={mode === 'week' ? 'on' : ''}
                aria-pressed={mode === 'week'}
                onClick={() => setMode('week')}
              >
                Week
              </button>
            </div>
          </div>
        </div>

        {mode === 'month' && (
          <div className="cal-grid">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div className="cal-dow" key={d}>
                {d}
              </div>
            ))}

            {monthGrid(monthAnchor).map((day) => {
              const key = ymdOf(day);
              const sessions = sessionsByDate.get(key) ?? [];
              const outside = day.getMonth() !== monthAnchor.getMonth();
              const isToday = key === todayInStudio;

              return (
                <button
                  type="button"
                  key={key}
                  className={`cal-cell ${outside ? 'out' : ''} ${isToday ? 'today' : ''}`.trim()}
                  onClick={() => {
                    // Jump to the week containing this day, which is where
                    // anything can actually be changed.
                    setWeekStart(sundayOf(key));
                    setMode('week');
                  }}
                >
                  <span className="dn">{day.getDate()}</span>
                  {sessions.slice(0, 3).map((session) => {
                    const pct =
                      session.capacity > 0
                        ? (session.seatsTaken / session.capacity) * 100
                        : 0;
                    const tone = pct >= 100 ? 'full' : pct < 60 ? 'quiet' : '';
                    /*
                      FB-06. Time and name on their own lines, the name
                      allowed two: as one 11px line every label was cut off
                      ("11:00 AM Pottery Wh…") at every width. The full
                      detail is in the hover title, and a phone-width cell
                      shows the short time only.
                    */
                    return (
                      <div
                        className={`cal-ev ${tone}`.trim()}
                        key={session.id}
                        title={`${timeIn(session.startsAt, timezone)}–${timeIn(session.endsAt, timezone)} ${session.serviceType.name}
${session.seatsTaken} of ${session.capacity} places booked`}
                      >
                        <span className="t">{timeIn(session.startsAt, timezone)}</span>
                        <span className="t-short">{shortTime(session.startsAt, timezone)}</span>
                        <span className="n">{session.serviceType.name}</span>
                      </div>
                    );
                  })}
                  {sessions.length > 3 && (
                    <div className="cal-more">+{sessions.length - 3} more</div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {mode === 'week' && (
        <div
          className="week"
          style={{
            opacity: busy ? 0.6 : 1,
            gridTemplateRows: `auto repeat(${slots.length}, ${SLOT_PX}px)`,
          }}
        >
          <div className="head" style={{ gridRow: 1, gridColumn: 1 }} />
          {days.map((day, i) => (
            <div
              className={`head${day === todayInStudio ? ' today' : ''}`}
              key={day}
              style={{ gridRow: 1, gridColumn: i + 2 }}
            >
              {dateLabel(day, { weekday: 'short' })}
              <small>{Number(day.slice(8))}</small>
            </div>
          ))}

          {slots.map((slot, index) => (
            <Row
              key={`${slot.hour}:${slot.minute}`}
              row={index + 2}
              slot={slot}
              days={days}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              onDrop={drop}
            />
          ))}

          {/* One layer per day, over its cells: blocks sized to their length. */}
          {days.map((day, i) => (
            <div
              key={`layer-${day}`}
              className="week-layer"
              style={{ gridColumn: i + 2, gridRow: `2 / span ${slots.length}` }}
            >
              {layoutDay(blocksByDate.get(day) ?? [], timezone, gridStartHour).map((p) => (
                <WeekBlock key={p.id} placed={p} timezone={timezone} onDragStart={setDragging} />
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/*
  Every hour cell has an explicit grid position: the day layers are placed
  explicitly too, and auto-placed cells would otherwise flow around them.
*/
function Row({
  row,
  slot,
  days,
  dropTarget,
  setDropTarget,
  onDrop,
}: {
  row: number;
  slot: Slot;
  days: string[];
  dropTarget: string | null;
  setDropTarget: (key: string | null) => void;
  onDrop: (dayDate: string, slot: Slot) => void;
}) {
  const label =
    slot.minute === 0
      ? `${slot.hour % 12 === 0 ? 12 : slot.hour % 12}${slot.hour < 12 ? 'am' : 'pm'}`
      : '';

  return (
    <>
      <div className="hour" style={{ gridRow: row, gridColumn: 1 }}>{label}</div>

      {days.map((dayDate, i) => {
        const key = `${dayDate} ${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`;

        return (
          <div
            key={key}
            className={`cell${dropTarget === key ? ' drop' : ''}`}
            style={{ gridRow: row, gridColumn: i + 2 }}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget(key);
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => {
              e.preventDefault();
              onDrop(dayDate, slot);
            }}
          />
        );
      })}
    </>
  );
}

function WeekBlock({
  placed,
  timezone,
  onDragStart,
}: {
  placed: Placed;
  timezone: string;
  onDragStart: (booking: BookingListItem) => void;
}) {
  const position = {
    top: placed.top + 1,
    height: placed.height - 2,
    left: `calc(${(placed.column / placed.columns) * 100}% + 2px)`,
    width: `calc(${100 / placed.columns}% - 4px)`,
  };

  if (placed.kind === 'booking') {
    const booking = placed.booking;
    const movable = booking.service.bookingMode === 'APPOINTMENT';
    return (
      <div
        className="event"
        draggable={movable}
        onDragStart={() => onDragStart(booking)}
        style={{ ...position, background: booking.service.color }}
        title={`${booking.service.name} — ${booking.customer.name} at ${timeIn(booking.startsAt, timezone)}`}
      >
        <div className="who">{booking.customer.name}</div>
        {booking.service.name}
      </div>
    );
  }

  const { session, bookings } = placed;
  const color = session.serviceType.color;
  const full = session.capacity > 0 && session.seatsTaken >= session.capacity;
  const names = bookings.map((b) => `${b.customer.name}${b.seats > 1 ? ` (${b.seats})` : ''}`);

  return (
    <div
      className="event session"
      style={{
        ...position,
        borderLeftColor: color,
        background: `color-mix(in srgb, ${color} 14%, var(--card))`,
      }}
      title={[
        `${timeIn(session.startsAt, timezone)}–${timeIn(session.endsAt, timezone)} ${session.serviceType.name}`,
        `${session.seatsTaken} of ${session.capacity} places booked`,
        session.staff ? `With ${session.staff.name}` : null,
        ...names,
      ]
        .filter(Boolean)
        .join('\n')}
    >
      <div className="who">
        {timeIn(session.startsAt, timezone)} {session.serviceType.name}
      </div>
      <div className={`fill${full ? ' full' : ''}`}>
        {session.seatsTaken}/{session.capacity} booked
        {session.seriesLabel ? ` · ${session.seriesLabel}` : ''}
      </div>
      {bookings.map((booking) => (
        <div
          key={booking.id}
          className="guest"
          draggable={booking.service.bookingMode === 'APPOINTMENT'}
          onDragStart={(e) => {
            e.stopPropagation();
            onDragStart(booking);
          }}
        >
          {booking.customer.name}
          {booking.seats > 1 ? ` (${booking.seats})` : ''}
        </div>
      ))}
    </div>
  );
}
