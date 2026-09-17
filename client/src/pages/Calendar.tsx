import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, timeIn, type BookingListItem } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { PageHead } from '../components/layout';

/**
 * The calendar. Month and week.
 *
 * WEEK is the drag-to-reschedule grid. Dragging is a convenience over the real
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

type Slot = { hour: number; minute: number };

const SLOTS: Slot[] = [];
for (let hour = START_HOUR; hour < END_HOUR; hour++) {
  for (let minute = 0; minute < 60; minute += SLOT_MINUTES) {
    SLOTS.push({ hour, minute });
  }
}

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

function startOfWeek(date: Date): Date {
  const copy = new Date(date);
  const day = copy.getDay(); // 0 = Sunday
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export default function CalendarPage() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';

  const [mode, setMode] = useState<Mode>('month');
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [monthSessions, setMonthSessions] = useState<MonthSession[]>([]);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [bookings, setBookings] = useState<BookingListItem[]>([]);
  const [dragging, setDragging] = useState<BookingListItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        return date;
      }),
    [weekStart],
  );

  const load = useCallback(async () => {
    const from = new Date(weekStart);
    const to = new Date(weekStart);
    to.setDate(to.getDate() + 7);

    try {
      const res = await api.get<{ bookings: BookingListItem[] }>(
        `${base}/bookings?from=${from.toISOString()}&to=${to.toISOString()}&limit=200&status=PENDING,CONFIRMED,ATTENDED`,
      );
      setBookings(res.bookings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    }
  }, [base, weekStart]);

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
    const to = new Date(grid[grid.length - 1]!);
    to.setHours(23, 59, 59, 999);

    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    try {
      const res = await api.get<{ sessions: MonthSession[] }>(
        `${base}/sessions?from=${iso(from)}&to=${iso(to)}`,
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

  /** Bookings indexed by "YYYY-MM-DD HH:MM" in studio-local time. */
  const byCell = useMemo(() => {
    const map = new Map<string, BookingListItem[]>();

    for (const booking of bookings) {
      const p = partsIn(booking.startsAt, timezone);
      // Snap to the grid so a 10:10 booking still lands in the 10:00 cell.
      const snapped = Math.floor(p.minute / SLOT_MINUTES) * SLOT_MINUTES;
      const key = `${p.date} ${String(p.hour).padStart(2, '0')}:${String(snapped).padStart(2, '0')}`;

      const list = map.get(key) ?? [];
      list.push(booking);
      map.set(key, list);
    }

    return map;
  }, [bookings, timezone]);

  function localDateOf(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

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

  /** Today, as a studio-local `YYYY-MM-DD`, for marking the cell. */
  const todayInStudio = partsIn(new Date().toISOString(), timezone).date;

  const title =
    mode === 'month'
      ? monthAnchor.toLocaleDateString(undefined, {
          month: 'long',
          year: 'numeric',
        })
      : `${weekStart.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(
          weekStart.getFullYear(),
          weekStart.getMonth(),
          weekStart.getDate() + 6,
        ).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;

  /** One step back or forward, in whatever unit the current view uses. */
  function step(direction: -1 | 1) {
    if (mode === 'month') {
      setMonthAnchor(
        (current) =>
          new Date(current.getFullYear(), current.getMonth() + direction, 1),
      );
      return;
    }
    setWeekStart((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + direction * 7);
      return next;
    });
  }

  function goToday() {
    setMonthAnchor(new Date());
    setWeekStart(startOfWeek(new Date()));
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
              const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
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
                    setWeekStart(startOfWeek(day));
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
                    return (
                      <div className={`cal-ev ${tone}`.trim()} key={session.id}>
                        {timeIn(session.startsAt, timezone)} {session.serviceType.name}
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
      <div className="week" style={{ opacity: busy ? 0.6 : 1 }}>
        <div className="head" />
        {days.map((day) => (
          <div className="head" key={day.toISOString()}>
            {day.toLocaleDateString('en-US', { weekday: 'short' })}
            <small>{day.getDate()}</small>
          </div>
        ))}

        {SLOTS.map((slot) => (
          <Row
            key={`${slot.hour}:${slot.minute}`}
            slot={slot}
            days={days}
            localDateOf={localDateOf}
            byCell={byCell}
            timezone={timezone}
            dropTarget={dropTarget}
            setDropTarget={setDropTarget}
            onDragStart={setDragging}
            onDrop={drop}
          />
        ))}
      </div>
      )}
    </>
  );
}

function Row({
  slot,
  days,
  localDateOf,
  byCell,
  timezone,
  dropTarget,
  setDropTarget,
  onDragStart,
  onDrop,
}: {
  slot: Slot;
  days: Date[];
  localDateOf: (d: Date) => string;
  byCell: Map<string, BookingListItem[]>;
  timezone: string;
  dropTarget: string | null;
  setDropTarget: (key: string | null) => void;
  onDragStart: (booking: BookingListItem) => void;
  onDrop: (dayDate: string, slot: Slot) => void;
}) {
  const label =
    slot.minute === 0
      ? `${slot.hour % 12 === 0 ? 12 : slot.hour % 12}${slot.hour < 12 ? 'am' : 'pm'}`
      : '';

  return (
    <>
      <div className="hour">{label}</div>

      {days.map((day) => {
        const dayDate = localDateOf(day);
        const key = `${dayDate} ${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`;
        const items = byCell.get(key) ?? [];

        return (
          <div
            key={key}
            className={`cell${dropTarget === key ? ' drop' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget(key);
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => {
              e.preventDefault();
              onDrop(dayDate, slot);
            }}
          >
            {items.map((booking) => (
              <div
                key={booking.id}
                className="event"
                draggable
                onDragStart={() => onDragStart(booking)}
                style={{ background: booking.service.color }}
                title={`${booking.service.name} — ${booking.customer.name} at ${timeIn(booking.startsAt, timezone)}`}
              >
                <div className="who">{booking.customer.name}</div>
                {booking.service.name}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
