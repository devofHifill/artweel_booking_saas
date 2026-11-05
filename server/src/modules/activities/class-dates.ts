import { DateTime } from 'luxon';

/**
 * The dates a Class runs on, from what the studio types in its Schedule step.
 *
 * Pure, and shared by publishing and (Stage 4) the live preview, so the list a
 * studio sees before publishing is exactly the list that gets created.
 *
 * The studio asks for a NUMBER of sessions, not a number of weeks: "8 sessions"
 * is what the customer buys and what the price covers. A skipped date (a
 * holiday) therefore does not shorten the class — the next matching day is
 * added at the end instead, and the end date moves.
 *
 * Works in calendar dates only. Times are resolved per date against the
 * studio's zone afterwards (`resolveLocal`), so a 6pm class stays at 6pm across
 * a daylight-saving change.
 */

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type ClassDatesInput = {
  /** "YYYY-MM-DD". The first session is the first chosen weekday on or after it. */
  startDate: string;
  weekdays: Weekday[];
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
 * skipped still fits; anything that does not is a mistake, not a schedule.
 */
const MAX_DAYS_SCANNED = 731;

export function planClassDates(input: ClassDatesInput): ClassDates {
  const start = DateTime.fromISO(input.startDate, { zone: 'UTC' });
  if (!start.isValid || !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) {
    throw new Error(`Invalid start date "${input.startDate}".`);
  }
  if (input.weekdays.length === 0) {
    throw new Error('Choose at least one day of the week.');
  }
  if (!Number.isInteger(input.sessionCount) || input.sessionCount < 1) {
    throw new Error('A class needs at least one session.');
  }

  // Luxon numbers Monday 1 … Sunday 7, the same order as WEEKDAYS.
  const wanted = new Set(input.weekdays.map((d) => WEEKDAYS.indexOf(d) + 1));
  const skip = new Set(input.skipDates ?? []);

  const dates: string[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < MAX_DAYS_SCANNED && dates.length < input.sessionCount; i++) {
    const day = start.plus({ days: i });
    if (!wanted.has(day.weekday)) continue;

    const iso = day.toISODate()!;
    if (skip.has(iso)) skipped.push(iso);
    else dates.push(iso);
  }

  if (dates.length < input.sessionCount) {
    throw new Error('Those sessions do not fit within two years. Skip fewer dates.');
  }

  return { dates, skipped, endDate: dates[dates.length - 1]! };
}
