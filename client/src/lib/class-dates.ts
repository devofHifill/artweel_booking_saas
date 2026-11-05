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

const MAX_DAYS_SCANNED = 731;

/** Monday 1 … Sunday 7, matching the server (Luxon). */
function isoWeekday(d: Date): number {
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
}

/** Null while the input cannot make a schedule yet — the step shows why. */
export function planClassDates(input: {
  startDate: string;
  weekdays: Weekday[];
  sessionCount: number;
  skipDates: string[];
}): ClassDates | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return null;
  if (input.weekdays.length === 0) return null;
  if (!Number.isInteger(input.sessionCount) || input.sessionCount < 1) return null;

  const start = new Date(`${input.startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;

  const wanted = new Set(input.weekdays.map((d) => WEEKDAYS.indexOf(d) + 1));
  const skip = new Set(input.skipDates);
  const dates: string[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < MAX_DAYS_SCANNED && dates.length < input.sessionCount; i++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    if (!wanted.has(isoWeekday(day))) continue;

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
