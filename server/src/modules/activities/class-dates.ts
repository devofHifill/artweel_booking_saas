import { DateTime } from 'luxon';

/**
 * The dates a Class runs on, from what the studio types in its Schedule step.
 *
 * Pure, and shared by publishing and (Stage 4) the live preview, so the list a
 * studio sees before publishing is exactly the list that gets created. The
 * client keeps a copy (`client/src/lib/class-dates.ts`) that MUST agree.
 *
 * The studio asks for a NUMBER of sessions, not a number of weeks: "8 sessions"
 * is what the customer buys and what the price covers. A skipped date (a
 * holiday) therefore does not shorten the class — the next matching day is
 * added at the end instead, and the end date moves.
 *
 * How it repeats (REPEAT-PLAN.md):
 *
 *   DAILY    every day from the start date.
 *   WEEKLY   on the chosen weekdays, the first on or after the start date.
 *   MONTHLY  anchored on the start date itself, by one of:
 *            DATE          the same day of the month ("the 7th"); a month
 *                          without that day (the 31st) is passed over;
 *            WEEKDAY       the start date's week of the month, on each
 *                          chosen weekday ("the fourth Monday and
 *                          Wednesday"); no days chosen: the start date's;
 *            LAST_WEEKDAY  the last such weekdays of the month ("the last
 *                          Friday").
 *
 * Works in calendar dates only. Times are resolved per date against the
 * studio's zone afterwards (`resolveLocal`), so a 6pm class stays at 6pm across
 * a daylight-saving change.
 */

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const REPEATS = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type Repeat = (typeof REPEATS)[number];

export const MONTHLY_BY = ['DATE', 'WEEKDAY', 'LAST_WEEKDAY'] as const;
export type MonthlyBy = (typeof MONTHLY_BY)[number];

/**
 * A monthly Class runs two years at most, inside the planner's scan. It caps
 * the MONTHS the form asks; with several days a month, the sessions can be
 * more (two days for 24 months is 48).
 */
export const MAX_MONTHLY_SESSIONS = 24;

/** Sessions in one run, whatever the repeat. */
export const MAX_SESSIONS = 52;

export type RepeatPattern = {
  /** Left out: WEEKLY, which is how every Class before repeat was made. */
  repeat?: Repeat;
  /** WEEKLY only. */
  weekdays: Weekday[];
  /** MONTHLY only. Left out: WEEKDAY. */
  monthlyBy?: MonthlyBy;
};

export type ClassDatesInput = RepeatPattern & {
  /** "YYYY-MM-DD". The first session is the first matching day on or after it. */
  startDate: string;
  /**
   * What a monthly pattern counts from ("the fourth Monday", "the 23rd").
   * Left out: the start date. A later run of a range keeps the first run's.
   */
  anchorDate?: string;
  sessionCount: number;
  /** Dates the studio unticked. Matching days are skipped, not counted. */
  skipDates?: string[];
};

export type ClassDates = {
  /** The session dates, in order, exactly `sessionCount` of them. */
  dates: string[];
  /** Skipped dates that actually fell inside the run, in order. */
  skipped: string[];
  endDate: string;
};

/**
 * Two years of days. A weekly class of 52 sessions with every other week
 * skipped still fits, and so do 24 monthly sessions; anything that does not
 * is a mistake, not a schedule.
 */
const MAX_DAYS_SCANNED = 731;

/**
 * Which days a pattern runs on, anchored on `startDate`. Throws on a pattern
 * that cannot run (a weekly one with no days).
 */
export function repeatMatcher(
  pattern: RepeatPattern,
  startDate: string,
): (day: DateTime) => boolean {
  const repeat = pattern.repeat ?? 'WEEKLY';
  const anchor = DateTime.fromISO(startDate, { zone: 'UTC' });

  if (repeat === 'DAILY') return () => true;

  if (repeat === 'MONTHLY') {
    const by = pattern.monthlyBy ?? 'WEEKDAY';
    if (by === 'DATE') return (day) => day.day === anchor.day;
    const nth = Math.ceil(anchor.day / 7);
    const days = monthlyWeekdays(pattern, anchor);
    if (by === 'WEEKDAY') {
      return (day) => days.has(day.weekday) && Math.ceil(day.day / 7) === nth;
    }
    return (day) => days.has(day.weekday) && day.day + 7 > day.daysInMonth!;
  }

  if (pattern.weekdays.length === 0) {
    throw new Error('Choose at least one day of the week.');
  }
  // Luxon numbers Monday 1 … Sunday 7, the same order as WEEKDAYS.
  const wanted = new Set(pattern.weekdays.map((d) => WEEKDAYS.indexOf(d) + 1));
  return (day) => wanted.has(day.weekday);
}

/** Monthly by weekday: the chosen days, or the start date's when none were. */
function monthlyWeekdays(pattern: RepeatPattern, anchor: DateTime): Set<number> {
  return new Set(
    pattern.weekdays.length
      ? pattern.weekdays.map((d) => WEEKDAYS.indexOf(d) + 1)
      : [anchor.weekday],
  );
}

export function planClassDates(input: ClassDatesInput): ClassDates {
  const start = DateTime.fromISO(input.startDate, { zone: 'UTC' });
  if (!start.isValid || !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) {
    throw new Error(`Invalid start date "${input.startDate}".`);
  }
  if (!Number.isInteger(input.sessionCount) || input.sessionCount < 1) {
    throw new Error('A class needs at least one session.');
  }
  if (input.sessionCount > MAX_SESSIONS) {
    throw new Error(`A class can have up to ${MAX_SESSIONS} sessions.`);
  }

  const matches = repeatMatcher(input, input.anchorDate ?? input.startDate);
  const skip = new Set(input.skipDates ?? []);

  const dates: string[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < MAX_DAYS_SCANNED && dates.length < input.sessionCount; i++) {
    const day = start.plus({ days: i });
    if (!matches(day)) continue;

    const iso = day.toISODate()!;
    if (skip.has(iso)) skipped.push(iso);
    else dates.push(iso);
  }

  if (dates.length < input.sessionCount) {
    throw new Error('Those sessions do not fit within two years. Choose fewer, or skip fewer dates.');
  }

  return { dates, skipped, endDate: dates[dates.length - 1]! };
}

// --- Stored form ---------------------------------------------------------------

const NTH_LAST = -1;

/**
 * The pattern as RRULE text, as stored on the cohort (`course_series.repeat_rule`).
 * Never COUNT or UNTIL: the session count governs. Monthly rules carry the
 * anchor they were made from, so the editor can rebuild them exactly.
 */
export function toRepeatRule(pattern: RepeatPattern, startDate: string): string {
  const repeat = pattern.repeat ?? 'WEEKLY';
  if (repeat === 'DAILY') return 'FREQ=DAILY';
  if (repeat === 'WEEKLY') {
    const days = WEEKDAYS.filter((d) => pattern.weekdays.includes(d));
    return `FREQ=WEEKLY;BYDAY=${days.join(',')}`;
  }
  const anchor = DateTime.fromISO(startDate, { zone: 'UTC' });
  const by = pattern.monthlyBy ?? 'WEEKDAY';
  if (by === 'DATE') return `FREQ=MONTHLY;BYMONTHDAY=${anchor.day}`;
  const nth = by === 'LAST_WEEKDAY' ? NTH_LAST : Math.ceil(anchor.day / 7);
  const days = [...monthlyWeekdays(pattern, anchor)].sort().map((n) => WEEKDAYS[n - 1]!);
  return `FREQ=MONTHLY;BYDAY=${days.map((d) => `${nth}${d}`).join(',')}`;
}

/**
 * Reads a stored rule back into the Schedule step's answers. Null for
 * anything this module did not write, so the caller falls back to reading
 * the session dates as before.
 */
export function fromRepeatRule(rule: string | null | undefined): RepeatPattern | null {
  if (!rule) return null;
  const parts = Object.fromEntries(
    rule.split(';').map((p) => p.split('=') as [string, string]),
  );
  if (parts.FREQ === 'DAILY') return { repeat: 'DAILY', weekdays: [] };
  if (parts.FREQ === 'WEEKLY' && parts.BYDAY) {
    const days = parts.BYDAY.split(',').filter((d): d is Weekday =>
      (WEEKDAYS as readonly string[]).includes(d),
    );
    return days.length ? { repeat: 'WEEKLY', weekdays: days } : null;
  }
  if (parts.FREQ === 'MONTHLY') {
    if (parts.BYMONTHDAY) return { repeat: 'MONTHLY', monthlyBy: 'DATE', weekdays: [] };
    // "4MO" or "4MO,4WE": one week of the month, on one or more days.
    const matches = (parts.BYDAY ?? '').split(',').map((d) => /^(-?\d)([A-Z]{2})$/.exec(d));
    if (matches.length && matches.every(Boolean)) {
      return {
        repeat: 'MONTHLY',
        monthlyBy: Number(matches[0]![1]) === NTH_LAST ? 'LAST_WEEKDAY' : 'WEEKDAY',
        weekdays: matches
          .map((m) => m![2])
          .filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d!)),
      };
    }
  }
  return null;
}

// --- Groups per day ----------------------------------------------------------

/** How many time groups a Class may run a day (REPEAT-PLAN.md, part 2). */
export const MAX_GROUPS = 12;

export type GroupTime = {
  /** "HH:mm", wall clock. */
  startTime: string;
  endTime: string;
  /** "6:00am": tells the groups apart on cards, the Manifest and the calendar. */
  label: string;
};

function minutesOfTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
}

function timeOfMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "6:00am" from a minute of the day. Matches the dashboard's `clockTime`. */
export function clockLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h! >= 12 ? 'pm' : 'am';
  const hour = h! % 12 === 0 ? 12 : h! % 12;
  return `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

/**
 * The start and end of each group: the first at the times asked, each next
 * one after the previous ends plus the buffer. 6:00–7:00, 3 groups, 15 min:
 * 6:00–7:00 · 7:15–8:15 · 8:30–9:30.
 *
 * Back to back (buffer 0) is fine for one instructor: time blocks are
 * half-open, so 7:00 ending and 7:00 starting do not overlap. Throws when the
 * last group would run past midnight.
 */
export function groupTimes(input: {
  startTime: string;
  endTime: string;
  /**
   * The studio's own start times, the first included: every group keeps the
   * first one's length. Wins over `groups` and `bufferMinutes`, which remain
   * for requests made before the times could be typed.
   */
  startTimes?: string[];
  groups?: number;
  bufferMinutes?: number;
}): GroupTime[] {
  const start = minutesOfTime(input.startTime);
  const length = minutesOfTime(input.endTime) - start;
  if (length <= 0) throw new Error('The end time must be after the start time.');

  if (input.startTimes?.length) {
    const starts = [...new Set([input.startTime, ...input.startTimes])].sort();
    if (starts.length > MAX_GROUPS) throw new Error(`Up to ${MAX_GROUPS} times a day.`);
    return starts.map((from) => {
      const to = minutesOfTime(from) + length;
      if (to > 24 * 60 - 1) {
        throw new Error(`A class starting at ${clockLabel(from)} would run past midnight.`);
      }
      return { startTime: from, endTime: timeOfMinutes(to), label: clockLabel(from) };
    });
  }

  const groups = input.groups ?? 1;
  const buffer = input.bufferMinutes ?? 0;
  if (!Number.isInteger(groups) || groups < 1 || groups > MAX_GROUPS) {
    throw new Error(`Between 1 and ${MAX_GROUPS} groups a day.`);
  }

  const out: GroupTime[] = [];
  for (let g = 0; g < groups; g++) {
    const from = start + g * (length + buffer);
    const to = from + length;
    if (to > 24 * 60 - 1) {
      throw new Error('The last group would run past midnight. Choose fewer groups or a shorter buffer.');
    }
    const startTime = timeOfMinutes(from);
    out.push({ startTime, endTime: timeOfMinutes(to), label: clockLabel(startTime) });
  }
  return out;
}

// --- Runs over a date range (REPEAT-PLAN.md, part 4) -------------------------

/** The longest range a studio may fill with runs: a year. */
export const MAX_RANGE_DAYS = 366;
/** Runs in one range, so a range of one-week runs stays a sensible size. */
export const MAX_RUNS = 52;

export type ClassRuns = {
  /** Each run's dates, in order; every run has the same session count. */
  runs: ClassDates[];
  /** Skipped dates that fell inside a run, in order. */
  skipped: string[];
  /** Dates after the last run, before the end, too few for another full run. */
  leftOver: string[];
};

/**
 * The runs of a Class over a date range: the first run from the start date,
 * each next one straight after the previous one ends (from its next matching
 * day), for as long as a FULL run still ends by `rangeEnd`. Runs never share
 * a date, so the same time on two runs can never clash.
 *
 * Without `rangeEnd`, one run — a Class as it was before ranges.
 *
 * A skipped date pushes its run's end out, and so every later run, exactly
 * as a skipped date always has: the count is what the price covers.
 */
export function planClassRuns(input: ClassDatesInput & { rangeEnd?: string | null }): ClassRuns {
  const first = planClassDates(input);
  if (!input.rangeEnd) return { runs: [first], skipped: first.skipped, leftOver: [] };

  const start = DateTime.fromISO(input.startDate, { zone: 'UTC' });
  const end = DateTime.fromISO(input.rangeEnd, { zone: 'UTC' });
  if (!end.isValid || !/^\d{4}-\d{2}-\d{2}$/.test(input.rangeEnd)) {
    throw new Error(`Invalid end date "${input.rangeEnd}".`);
  }
  if (end < start) throw new Error('The end date must be after the start date.');
  if (end.diff(start, 'days').days > MAX_RANGE_DAYS) {
    throw new Error('Choose dates up to a year apart.');
  }
  if (first.endDate > input.rangeEnd) {
    throw new Error(
      `One run needs until ${first.endDate}. Move the end date later, or choose fewer weeks.`,
    );
  }

  const anchorDate = input.anchorDate ?? input.startDate;
  const matches = repeatMatcher(input, anchorDate);
  const skip = new Set(input.skipDates ?? []);
  const runs = [first];
  const leftOver: string[] = [];

  while (runs.length < MAX_RUNS) {
    const from = DateTime.fromISO(runs[runs.length - 1]!.endDate, { zone: 'UTC' }).plus({ days: 1 });
    if (from > end) break;
    let next: ClassDates | null = null;
    try {
      next = planClassDates({ ...input, startDate: from.toISODate()!, anchorDate });
    } catch {
      next = null;
    }
    if (!next || next.endDate > input.rangeEnd) {
      // What is left is too short for a full run: named, not booked.
      for (let d = from; d <= end; d = d.plus({ days: 1 })) {
        const iso = d.toISODate()!;
        if (matches(d) && !skip.has(iso)) leftOver.push(iso);
      }
      break;
    }
    runs.push(next);
  }

  return { runs, skipped: runs.flatMap((r) => r.skipped), leftOver };
}
