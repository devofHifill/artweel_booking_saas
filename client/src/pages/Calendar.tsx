import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, timeIn, type BookingListItem } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';

/**
 * Week view with drag-to-reschedule.
 *
 * Dragging is a convenience over the real mechanism, not a replacement for it:
 * the drop calls the same reschedule endpoint the customer-facing flow uses,
 * which cancels and rebooks through the scheduling core. If the instructor is
 * busy at the target time, the exclusion constraint refuses it and the card
 * snaps back — the UI cannot talk the server into a double booking.
 */

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
    void load();
  }, [load]);

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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p className="sub">
            Drag an appointment to move it. Times shown in {timezone.replace('_', ' ')}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              const previous = new Date(weekStart);
              previous.setDate(previous.getDate() - 7);
              setWeekStart(previous);
            }}
          >
            ← Previous
          </button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))}>
            This week
          </button>
          <button
            onClick={() => {
              const next = new Date(weekStart);
              next.setDate(next.getDate() + 7);
              setWeekStart(next);
            }}
          >
            Next →
          </button>
        </div>
      </div>

      {error && <div className="err">{error}</div>}

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
