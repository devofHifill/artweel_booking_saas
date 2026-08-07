import { DateTime } from 'luxon';

/**
 * W0.3 — Time and recurrence
 *
 * Every timezone bug in scheduling software comes from the same mistake:
 * treating "7pm on Tuesdays" as a fixed number of milliseconds. It isn't.
 * It is a WALL-CLOCK INTENT that must be re-resolved against the zone for
 * each individual date, because the offset changes twice a year.
 *
 * So: a recurring rule stores minutes-past-local-midnight plus an IANA zone,
 * and an instant is COMPUTED per date. It is never stored and reused.
 *
 * The previous implementation stored DATE + TIME with no zone at all and
 * mixed `strtotime()` (server-local) with `gmdate()` (UTC) in the same
 * expression. That works only while the server, the studio and the customer
 * share one offset.
 */

export type Interval = { start: Date; end: Date };

/**
 * What happened when a wall-clock time was resolved against a zone.
 *
 *  - `exact`      : the local time exists exactly once. The normal case.
 *  - `shifted`    : the local time does not exist. Spring forward skips an
 *                   hour, so 02:30 on that date is not a real moment.
 *  - `ambiguous`  : the local time exists twice. Fall back repeats an hour,
 *                   so 01:30 happens once in DST and again in standard time.
 */
export type ResolutionKind = 'exact' | 'shifted' | 'ambiguous';

export type ResolvedInstant = {
  instant: Date;
  kind: ResolutionKind;
  /** The local time actually landed on, "HH:mm". Differs from the request when shifted. */
  localTime: string;
};

/**
 * DST RESOLUTION POLICY — decided once, here, and applied everywhere.
 *
 *   Non-existent local time  -> move FORWARD to the first real moment.
 *       A 2:30am class on spring-forward Sunday becomes 3:00am. Moving
 *       backward would place it before the studio opens.
 *
 *   Ambiguous local time     -> take the FIRST occurrence (DST still active).
 *       A 1:30am class on fall-back Sunday runs at the earlier 1:30am. The
 *       alternative silently delays it an hour.
 *
 * Both cases are reported in `kind` rather than hidden, so an admin UI can
 * warn ("this class falls in a daylight-saving gap") instead of quietly
 * moving someone's booking.
 */
export function resolveLocal(
  localDate: string,
  minutesPastMidnight: number,
  zone: string,
): ResolvedInstant {
  const dayOffset = Math.floor(minutesPastMidnight / 1440);
  const within = minutesPastMidnight - dayOffset * 1440;

  const parts = localDate.split('-').map(Number);
  const base = DateTime.fromObject(
    { year: parts[0], month: parts[1], day: parts[2] },
    { zone },
  ).plus({ days: dayOffset });

  if (!base.isValid) {
    throw new Error(`Invalid local date "${localDate}" for zone "${zone}"`);
  }

  const hour = Math.floor(within / 60);
  const minute = within % 60;

  // fromObject constructs by WALL CLOCK, which is what we want. `plus()` with
  // hours would do exact millisecond arithmetic and drift across a
  // transition — the exact bug this module exists to prevent.
  const dt = DateTime.fromObject(
    { year: base.year, month: base.month, day: base.day, hour, minute },
    { zone },
  );

  const landedMinutes = dt.hour * 60 + dt.minute;
  const instant = dt.toJSDate();

  let kind: ResolutionKind = 'exact';

  if (landedMinutes !== within) {
    // Luxon already moves forward out of a gap, which matches our policy.
    kind = 'shifted';
  } else {
    // A wall-clock time that still reads the same one real hour later is one
    // that occurs twice.
    const oneHourLater = DateTime.fromMillis(instant.getTime() + 3_600_000, {
      zone,
    });
    if (oneHourLater.hour === dt.hour && oneHourLater.minute === dt.minute) {
      kind = 'ambiguous';
    }
  }

  return {
    instant,
    kind,
    localTime: `${String(dt.hour).padStart(2, '0')}:${String(dt.minute).padStart(2, '0')}`,
  };
}

/** Convenience: the instant only, discarding how it resolved. */
export function toInstant(
  localDate: string,
  minutesPastMidnight: number,
  zone: string,
): Date {
  return resolveLocal(localDate, minutesPastMidnight, zone).instant;
}

/** "HH:mm" in the given zone. */
export function localTimeOf(instant: Date, zone: string): string {
  return DateTime.fromJSDate(instant, { zone }).toFormat('HH:mm');
}

/** "YYYY-MM-DD" in the given zone. */
export function localDateOf(instant: Date, zone: string): string {
  return DateTime.fromJSDate(instant, { zone }).toFormat('yyyy-MM-dd');
}

/** Inclusive list of local dates. Calendar arithmetic, so DST-safe. */
export function localDateRange(from: string, to: string): string[] {
  let cursor = DateTime.fromISO(from, { zone: 'utc' });
  const end = DateTime.fromISO(to, { zone: 'utc' });

  if (!cursor.isValid || !end.isValid) {
    throw new Error(`Invalid local date range ${from}..${to}`);
  }

  const dates: string[] = [];
  while (cursor <= end) {
    dates.push(cursor.toFormat('yyyy-MM-dd'));
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

// ---------------------------------------------------------------------------
// Interval algebra
//
// Availability is set arithmetic: working windows minus everything that makes
// the instructor unavailable. Doing it with explicit, tested helpers keeps
// the engine readable and the edge cases (touching, nested, identical
// intervals) in one place.
//
// Half-open [start, end) throughout, matching the '[)' bounds on the database
// exclusion constraints. Back-to-back is adjacent, not overlapping.
// ---------------------------------------------------------------------------

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort(
    (x, y) => x.start.getTime() - y.start.getTime(),
  );

  const merged: Interval[] = [{ ...sorted[0]! }];

  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (current.start <= last.end) {
      if (current.end > last.end) last.end = current.end;
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/** `base` minus every interval in `cuts`. */
export function subtractIntervals(
  base: Interval[],
  cuts: Interval[],
): Interval[] {
  const blocked = mergeIntervals(cuts);
  let result = [...base];

  for (const cut of blocked) {
    const next: Interval[] = [];
    for (const segment of result) {
      if (!overlaps(segment, cut)) {
        next.push(segment);
        continue;
      }
      if (segment.start < cut.start) {
        next.push({ start: segment.start, end: cut.start });
      }
      if (cut.end < segment.end) {
        next.push({ start: cut.end, end: segment.end });
      }
    }
    result = next;
  }

  return result;
}

/** Widens each interval outward — used for padding and for travel time. */
export function padIntervals(
  intervals: Interval[],
  beforeMinutes: number,
  afterMinutes: number,
): Interval[] {
  return intervals.map((i) => ({
    start: new Date(i.start.getTime() - beforeMinutes * 60_000),
    end: new Date(i.end.getTime() + afterMinutes * 60_000),
  }));
}
