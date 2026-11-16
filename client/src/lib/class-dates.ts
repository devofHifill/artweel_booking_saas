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

export const MAX_MONTHLY_SESSIONS = 24;

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
    const weekday = isoWeekday(anchor);
    if (input.monthlyBy === 'DATE') return (day) => day.getUTCDate() === dom;
    if (input.monthlyBy === 'WEEKDAY') {
      const nth = Math.ceil(dom / 7);
      return (day) => isoWeekday(day) === weekday && Math.ceil(day.getUTCDate() / 7) === nth;
    }
    return (day) => isoWeekday(day) === weekday && day.getUTCDate() + 7 > daysInMonth(day);
  }
  if (input.weekdays.length === 0) return null;
  const wanted = new Set(input.weekdays.map((d) => WEEKDAYS.indexOf(d) + 1));
  return (day) => wanted.has(isoWeekday(day));
}

/** Null while the input cannot make a schedule yet — the step shows why. */
export function planClassDates(input: {
  startDate: string;
  repeat?: Repeat;
  monthlyBy?: MonthlyBy;
  weekdays: Weekday[];
  sessionCount: number;
  skipDates: string[];
}): ClassDates | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return null;
  if (!Number.isInteger(input.sessionCount) || input.sessionCount < 1) return null;
  const repeat = input.repeat ?? 'WEEKLY';
  if (repeat === 'MONTHLY' && input.sessionCount > MAX_MONTHLY_SESSIONS) return null;

  const start = new Date(`${input.startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;

  const matches = repeatMatcher(
    { repeat, monthlyBy: input.monthlyBy ?? 'WEEKDAY', weekdays: input.weekdays },
    start,
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
 * The monthly choices a start date allows, with their labels:
 * "On the 23rd", "On the fourth Monday", "On the last Monday".
 * A fifth weekday is only offered as "last", since a fifth Monday is missing
 * from most months; "last" is only offered in a month's last seven days.
 */
export function monthlyOptions(startDate: string): { value: MonthlyBy; label: string }[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return [];
  const d = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return [];
  const dom = d.getUTCDate();
  const day = LONG_DAYS[isoWeekday(d) - 1]!;
  const nth = Math.ceil(dom / 7);
  const options: { value: MonthlyBy; label: string }[] = [
    { value: 'DATE', label: `On the ${ordinalDay(dom)} of each month` },
  ];
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

/** A short line for the schedule: "Daily", "Mon & Wed", "Monthly, first Monday". */
export function repeatSummary(input: {
  startDate: string;
  repeat?: Repeat;
  monthlyBy?: MonthlyBy;
  weekdays: Weekday[];
}): string {
  const repeat = input.repeat ?? 'WEEKLY';
  if (repeat === 'DAILY') return 'Daily';
  if (repeat === 'WEEKLY') return input.weekdays.map((d) => WEEKDAY_LABELS[d]).join(' & ');
  const option = monthlyOptions(input.startDate).find((o) => o.value === (input.monthlyBy ?? 'WEEKDAY'));
  return option ? `Monthly, ${option.label.replace(/^On /, '').replace(/ of each month$/, '')}` : 'Monthly';
}
