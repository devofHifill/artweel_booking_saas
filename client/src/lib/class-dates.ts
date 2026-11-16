/**
 * The dates a Class runs on — the client's copy of
 * `server/src/modules/activities/class-dates.ts`.
 *
 * It exists so the Schedule step can show the real dates as the studio types,
 * and it MUST give the same answer as the server, which recomputes them on
 * publish: the list the studio approved is the list that gets created. Change
 * one, change both.
 *
 * Calendar arithmetic at UTC midnight, never on instants, so no daylight-saving
 * shift can move a date (same reasoning as `plusDays` in ./api).
 */

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};

export type ClassDates = { dates: string[]; skipped: string[]; endDate: string };

/** How a Class repeats (REPEAT-PLAN.md). Same values as the server. */
export type Repeat = 'DAILY' | 'WEEKLY' | 'MONTHLY';
/** Monthly by the same date, the same weekday position, or the last such weekday. */
export type MonthlyBy = 'DATE' | 'WEEKDAY' | 'LAST_WEEKDAY';

/** Months a monthly Class may run (the form's limit). Same as the server. */
export const MAX_MONTHLY_SESSIONS = 24;
/** Sessions in one run. Same as the server. */
export const MAX_SESSIONS = 52;

const MAX_DAYS_SCANNED = 731;

/** Monday 1 … Sunday 7, matching the server (Luxon). */
function isoWeekday(d: Date): number {
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
}

function daysInMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/** Which days a pattern runs on, anchored on the start date. Null: it cannot run. */
function repeatMatcher(
  input: { repeat: Repeat; monthlyBy: MonthlyBy; weekdays: Weekday[] },
  anchor: Date,
): ((day: Date) => boolean) | null {
  if (input.repeat === 'DAILY') return () => true;
  if (input.repeat === 'MONTHLY') {
    const dom = anchor.getUTCDate();
    if (input.monthlyBy === 'DATE') return (day) => day.getUTCDate() === dom;
    // The chosen days, or the start date's when none were (as the server).
    const days = new Set(
      input.weekdays.length
        ? input.weekdays.map((d) => WEEKDAYS.indexOf(d) + 1)
        : [isoWeekday(anchor)],
    );
    if (input.monthlyBy === 'WEEKDAY') {
      const nth = Math.ceil(dom / 7);
      return (day) => days.has(isoWeekday(day)) && Math.ceil(day.getUTCDate() / 7) === nth;
    }
    return (day) => days.has(isoWeekday(day)) && day.getUTCDate() + 7 > daysInMonth(day);
  }
  if (input.weekdays.length === 0) return null;
  const wanted = new Set(input.weekdays.map((d) => WEEKDAYS.indexOf(d) + 1));
  return (day) => wanted.has(isoWeekday(day));
}

/** Null while the input cannot make a schedule yet — the step shows why. */
export function planClassDates(input: {
  startDate: string;
  /** What a monthly pattern counts from; a later run keeps the first run's. */
  anchorDate?: string;
  repeat?: Repeat;
  monthlyBy?: MonthlyBy;
  weekdays: Weekday[];
  sessionCount: number;
  skipDates: string[];
}): ClassDates | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return null;
  if (!Number.isInteger(input.sessionCount) || input.sessionCount < 1) return null;
  const repeat = input.repeat ?? 'WEEKLY';
  if (input.sessionCount > MAX_SESSIONS) return null;

  const start = new Date(`${input.startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const anchor = new Date(`${input.anchorDate ?? input.startDate}T00:00:00Z`);

  const matches = repeatMatcher(
    { repeat, monthlyBy: input.monthlyBy ?? 'WEEKDAY', weekdays: input.weekdays },
    anchor,
  );
  if (!matches) return null;
  const skip = new Set(input.skipDates);
  const dates: string[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < MAX_DAYS_SCANNED && dates.length < input.sessionCount; i++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    if (!matches(day)) continue;

    const iso = day.toISOString().slice(0, 10);
    if (skip.has(iso)) skipped.push(iso);
    else dates.push(iso);
  }

  if (dates.length < input.sessionCount) return null;
  return { dates, skipped, endDate: dates[dates.length - 1]! };
}

/** "Tue 3 Mar" — a calendar date, read without any zone. */
export function shortDate(localDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${localDate}T00:00:00Z`));
}

/** "6:00pm" from "18:00". */
export function clockTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h)) return time;
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];
const LONG_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * The monthly choices a start date and the chosen days allow, with labels:
 * "On the 23rd", "On the fourth Monday and Wednesday", "On the last Monday".
 * The week of the month comes from the start date. A fifth weekday is only
 * offered as "last", since a fifth Monday is missing from most months; "last"
 * is only offered in a month's last seven days; and "the 23rd" only with one
 * day chosen, since a date cannot fall on two weekdays.
 */
export function monthlyOptions(
  startDate: string,
  weekdays: Weekday[] = [],
): { value: MonthlyBy; label: string }[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return [];
  const d = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return [];
  const dom = d.getUTCDate();
  const names = weekdays.length
    ? WEEKDAYS.filter((w) => weekdays.includes(w)).map((w) => LONG_DAYS[WEEKDAYS.indexOf(w)]!)
    : [LONG_DAYS[isoWeekday(d) - 1]!];
  const day =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]!;
  const nth = Math.ceil(dom / 7);
  const options: { value: MonthlyBy; label: string }[] =
    weekdays.length <= 1 ? [{ value: 'DATE', label: `On the ${ordinalDay(dom)} of each month` }] : [];
  if (nth <= 4) {
    options.push({ value: 'WEEKDAY', label: `On the ${ORDINALS[nth - 1]} ${day} of each month` });
  }
  if (dom + 7 > daysInMonth(d)) {
    options.push({ value: 'LAST_WEEKDAY', label: `On the last ${day} of each month` });
  }
  return options;
}

/** "1st", "2nd", "23rd", "31st". */
function ordinalDay(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** A short line for the schedule: "Daily", "Mon & Wed", "Monthly, the first Monday". */
export function repeatSummary(input: {
  startDate: string;
  repeat?: Repeat;
  monthlyBy?: MonthlyBy;
  weekdays: Weekday[];
}): string {
  const repeat = input.repeat ?? 'WEEKLY';
  if (repeat === 'DAILY') return 'Daily';
  if (repeat === 'WEEKLY') {
    return input.weekdays.length === 7
      ? 'Every day'
      : input.weekdays.map((d) => WEEKDAY_LABELS[d]).join(' & ');
  }
  const option = monthlyOptions(input.startDate, input.weekdays).find(
    (o) => o.value === (input.monthlyBy ?? 'WEEKDAY'),
  );
  return option ? `Monthly, ${option.label.replace(/^On /, '').replace(/ of each month$/, '')}` : 'Monthly';
}

/** How many time groups a Class may run a day. Same as the server. */
export const MAX_GROUPS = 12;

export type GroupTime = { startTime: string; endTime: string };

/**
 * Each group's times: the first as asked, each next one after the previous
 * ends plus the buffer — the server's `groupTimes`, which MUST agree. Null when
 * the times do not work yet, or the last group would run past midnight.
 */
export function groupTimes(input: {
  startTime: string;
  endTime: string;
  groups: number;
  bufferMinutes: number;
}): GroupTime[] | null {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h! * 60 + m!;
  };
  const toTime = (n: number) =>
    `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const start = toMinutes(input.startTime);
  const length = toMinutes(input.endTime) - start;
  const { groups, bufferMinutes } = input;
  if (!(length > 0)) return null;
  if (!Number.isInteger(groups) || groups < 1 || groups > MAX_GROUPS) return null;
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 240) return null;

  const out: GroupTime[] = [];
  for (let g = 0; g < groups; g++) {
    const from = start + g * (length + bufferMinutes);
    const to = from + length;
    if (to > 24 * 60 - 1) return null;
    out.push({ startTime: toTime(from), endTime: toTime(to) });
  }
  return out;
}

/**
 * Each time's start and end from the first time and the extra start times
 * the studio typed, earliest first; every one keeps the first one's length.
 * Null while a time is missing, repeated, or would run past midnight.
 */
export function timesFrom(input: {
  startTime: string;
  endTime: string;
  extraTimes: string[];
}): GroupTime[] | null {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h! * 60 + m!;
  };
  const toTime = (n: number) =>
    `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const length = toMinutes(input.endTime) - toMinutes(input.startTime);
  if (!(length > 0)) return null;
  const starts = [input.startTime, ...input.extraTimes];
  if (starts.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return null;
  if (new Set(starts).size !== starts.length || starts.length > MAX_GROUPS) return null;
  const out = starts.sort().map((t) => ({ startTime: t, endTime: toTime(toMinutes(t) + length) }));
  return out.every((t) => toMinutes(t.startTime) + length <= 24 * 60 - 1) ? out : null;
}

/** Runs in one date range, and how far apart its dates may be. Same as the server. */
export const MAX_RUNS = 52;
export const MAX_RANGE_DAYS = 366;

export type ClassRuns = { runs: ClassDates[]; skipped: string[]; leftOver: string[] };

/**
 * The runs over a date range: the first from the start date, each next one
 * straight after the previous one ends, while a full run still ends by
 * `rangeEnd` — the server's `planClassRuns`, which MUST agree. No end date:
 * one run. Null while the answers cannot make one run yet.
 */
export function planClassRuns(input: Parameters<typeof planClassDates>[0] & { rangeEnd?: string }): ClassRuns | null {
  const first = planClassDates(input);
  if (!first) return null;
  if (!input.rangeEnd) return { runs: [first], skipped: first.skipped, leftOver: [] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.rangeEnd) || input.rangeEnd < input.startDate) return null;
  const startMs = Date.parse(`${input.startDate}T00:00:00Z`);
  const endMs = Date.parse(`${input.rangeEnd}T00:00:00Z`);
  if ((endMs - startMs) / 86_400_000 > MAX_RANGE_DAYS) return null;
  if (first.endDate > input.rangeEnd) return null;

  const plusDay = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const anchorDate = input.anchorDate ?? input.startDate;
  const runs = [first];
  const leftOver: string[] = [];
  while (runs.length < MAX_RUNS) {
    const from = plusDay(runs[runs.length - 1]!.endDate);
    if (from > input.rangeEnd) break;
    const next = planClassDates({ ...input, startDate: from, anchorDate });
    if (!next || next.endDate > input.rangeEnd) {
      // Too short for a full run: the dates are named, not booked.
      const matches = repeatMatcher(
        {
          repeat: input.repeat ?? 'WEEKLY',
          monthlyBy: input.monthlyBy ?? 'WEEKDAY',
          weekdays: input.weekdays,
        },
        new Date(`${anchorDate}T00:00:00Z`),
      );
      const skip = new Set(input.skipDates);
      for (let d = from; d <= input.rangeEnd; d = plusDay(d)) {
        if (matches?.(new Date(`${d}T00:00:00Z`)) && !skip.has(d)) leftOver.push(d);
      }
      break;
    }
    runs.push(next);
  }
  return { runs, skipped: runs.flatMap((r) => r.skipped), leftOver };
}
