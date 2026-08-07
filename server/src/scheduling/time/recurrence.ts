import { RRule } from 'rrule';
import { DateTime } from 'luxon';
import { resolveLocal, type Interval, type ResolutionKind } from './zoned';

/**
 * Recurrence expansion.
 *
 * The critical decision here is WHAT an RRULE produces. It produces LOCAL
 * DATES, not instants.
 *
 * Expanding straight to instants is the classic trap: the library computes
 * "every 7 days" as a fixed 604,800,000 ms step, so the day after a DST
 * transition every occurrence is an hour out. Instead we expand to a set of
 * calendar dates, then re-resolve the wall-clock time against the zone for
 * each one individually. A 7pm class stays at 7pm forever, by construction.
 *
 * This also means the plugin's three tables — staff_schedule (one row per
 * weekday), staff_breaks, staff_days_off — collapse into rules plus
 * overrides. No pre-generated rows to drift out of sync.
 */

export type RecurrenceWindow = Interval & {
  localDate: string;
  resolution: ResolutionKind;
};

export type ExpandInput = {
  rrule: string;
  startMinute: number;
  endMinute: number;
  timezone: string;
  effectiveFrom: Date;
  effectiveUntil?: Date | null;
  /** Inclusive local-date bounds of the query, in `timezone`. */
  fromLocalDate: string;
  toLocalDate: string;
};

/**
 * Expands one rule into concrete windows over a local-date range.
 *
 * The RRULE is evaluated against naive UTC midnights purely as a DATE
 * generator — no wall-clock meaning is attached at that stage, which is what
 * keeps the library's fixed-duration arithmetic harmless.
 */
export function expandRule(input: ExpandInput): RecurrenceWindow[] {
  const {
    rrule,
    startMinute,
    endMinute,
    timezone,
    fromLocalDate,
    toLocalDate,
  } = input;

  if (endMinute <= startMinute) {
    throw new Error('Availability rule must end after it starts.');
  }

  // Clamp the query window to the rule's own validity period, expressed in
  // the rule's zone.
  const effectiveFromLocal = DateTime.fromJSDate(input.effectiveFrom, {
    zone: timezone,
  }).toFormat('yyyy-MM-dd');

  const effectiveUntilLocal = input.effectiveUntil
    ? DateTime.fromJSDate(input.effectiveUntil, { zone: timezone }).toFormat(
        'yyyy-MM-dd',
      )
    : null;

  const windowStart =
    fromLocalDate > effectiveFromLocal ? fromLocalDate : effectiveFromLocal;
  const windowEnd =
    effectiveUntilLocal && effectiveUntilLocal < toLocalDate
      ? effectiveUntilLocal
      : toLocalDate;

  if (windowStart > windowEnd) return [];

  const rule = RRule.fromString(
    `DTSTART:${effectiveFromLocal.replace(/-/g, '')}T000000Z\nRRULE:${rrule}`,
  );

  const occurrences = rule.between(
    new Date(`${windowStart}T00:00:00.000Z`),
    new Date(`${windowEnd}T23:59:59.999Z`),
    true,
  );

  const windows: RecurrenceWindow[] = [];

  for (const occurrence of occurrences) {
    // Read back in UTC: these are date markers, never instants.
    const localDate = DateTime.fromJSDate(occurrence, { zone: 'utc' }).toFormat(
      'yyyy-MM-dd',
    );

    // Re-resolve the wall-clock intent for THIS date. This single line is
    // what makes the whole thing DST-correct.
    const start = resolveLocal(localDate, startMinute, timezone);
    const end = resolveLocal(localDate, endMinute, timezone);

    if (end.instant <= start.instant) continue;

    // Validity is an INSTANT comparison, not a date one.
    //
    // `effectiveUntil` of 2026-06-16T00:00:00Z is 15 June 20:00 in New York,
    // so a 10am class on the 16th falls outside it. Callers who mean "the
    // whole of the 16th" must pass the end of that local day — which is what
    // the admin UI will construct. The date clamp above is only a coarse
    // pre-filter; this is the authoritative test.
    if (start.instant < input.effectiveFrom) continue;
    if (input.effectiveUntil && start.instant >= input.effectiveUntil) continue;

    windows.push({
      localDate,
      start: start.instant,
      end: end.instant,
      resolution:
        start.kind !== 'exact'
          ? start.kind
          : end.kind !== 'exact'
            ? end.kind
            : 'exact',
    });
  }

  return windows;
}

/**
 * Applies overrides on top of expanded rule windows for a single date.
 *
 *   DAY_OFF       removes the day entirely
 *   CUSTOM_HOURS  replaces the day's windows
 *   EXTRA_HOURS   adds a window on top
 *
 * Replacement beats addition: an instructor who sets custom hours means
 * "instead of", not "as well as".
 */
export type OverrideInput = {
  overrideType: 'DAY_OFF' | 'CUSTOM_HOURS' | 'EXTRA_HOURS';
  localDate: string;
  startMinute: number | null;
  endMinute: number | null;
};

export function applyOverrides(
  localDate: string,
  base: Interval[],
  overrides: OverrideInput[],
  timezone: string,
): Interval[] {
  const forDate = overrides.filter((o) => o.localDate === localDate);
  if (forDate.length === 0) return base;

  if (forDate.some((o) => o.overrideType === 'DAY_OFF')) return [];

  let result = base;

  const custom = forDate.filter((o) => o.overrideType === 'CUSTOM_HOURS');
  if (custom.length > 0) {
    result = custom
      .filter((o) => o.startMinute !== null && o.endMinute !== null)
      .map((o) => ({
        start: resolveLocal(localDate, o.startMinute!, timezone).instant,
        end: resolveLocal(localDate, o.endMinute!, timezone).instant,
      }));
  }

  const extra = forDate.filter((o) => o.overrideType === 'EXTRA_HOURS');
  for (const o of extra) {
    if (o.startMinute === null || o.endMinute === null) continue;
    result = [
      ...result,
      {
        start: resolveLocal(localDate, o.startMinute, timezone).instant,
        end: resolveLocal(localDate, o.endMinute, timezone).instant,
      },
    ];
  }

  return result;
}
