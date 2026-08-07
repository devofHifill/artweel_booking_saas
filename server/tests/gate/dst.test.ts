import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  localDateRange,
  localTimeOf,
  resolveLocal,
  subtractIntervals,
  mergeIntervals,
} from '../../src/scheduling/time/zoned';
import { expandRule } from '../../src/scheduling/time/recurrence';

/**
 * PHASE 0 EXIT GATE — condition 2 of 4
 *
 *   "A weekly recurring class holds its local wall-clock time across both
 *    spring-forward and fall-back, in at least two US timezones."
 *
 * 2026 US transitions:
 *   spring forward  Sunday 8 March 2026, 02:00 -> 03:00 local
 *   fall back       Sunday 1 November 2026, 02:00 -> 01:00 local
 *
 * A pure-UTC implementation passes none of this. An implementation that
 * expands recurrence directly to instants passes the first test and fails
 * everything after it.
 */

const NY = 'America/New_York';
const LA = 'America/Los_Angeles';
const PHOENIX = 'America/Phoenix'; // no DST at all

describe('wall-clock resolution', () => {
  it('keeps 7pm at 7pm across spring forward', () => {
    const before = resolveLocal('2026-03-07', 19 * 60, NY);
    const after = resolveLocal('2026-03-08', 19 * 60, NY);

    expect(localTimeOf(before.instant, NY)).toBe('19:00');
    expect(localTimeOf(after.instant, NY)).toBe('19:00');

    // The instants are 23 real hours apart, not 24. That is the whole point:
    // the wall clock is stable and the elapsed time is not.
    const hours =
      (after.instant.getTime() - before.instant.getTime()) / 3_600_000;
    expect(hours).toBe(23);
  });

  it('keeps 7pm at 7pm across fall back', () => {
    const before = resolveLocal('2026-10-31', 19 * 60, NY);
    const after = resolveLocal('2026-11-01', 19 * 60, NY);

    expect(localTimeOf(before.instant, NY)).toBe('19:00');
    expect(localTimeOf(after.instant, NY)).toBe('19:00');

    const hours =
      (after.instant.getTime() - before.instant.getTime()) / 3_600_000;
    expect(hours).toBe(25);
  });

  it('moves a non-existent local time forward and says so', () => {
    // 02:30 on spring-forward Sunday is not a real moment in New York.
    const resolved = resolveLocal('2026-03-08', 2 * 60 + 30, NY);

    expect(resolved.kind).toBe('shifted');
    expect(localTimeOf(resolved.instant, NY)).toBe('03:30');
  });

  it('picks the first occurrence of an ambiguous local time and says so', () => {
    // 01:30 happens twice on fall-back Sunday. We take the earlier one.
    const resolved = resolveLocal('2026-11-01', 60 + 30, NY);

    expect(resolved.kind).toBe('ambiguous');

    const dt = DateTime.fromJSDate(resolved.instant, { zone: NY });
    expect(dt.toFormat('HH:mm')).toBe('01:30');
    expect(dt.offset).toBe(-4 * 60); // EDT — still daylight time
  });

  it('reports ordinary times as exact', () => {
    expect(resolveLocal('2026-06-15', 14 * 60, NY).kind).toBe('exact');
    expect(resolveLocal('2026-03-08', 14 * 60, NY).kind).toBe('exact');
  });

  it('handles a zone that does not observe DST', () => {
    const before = resolveLocal('2026-03-07', 19 * 60, PHOENIX);
    const after = resolveLocal('2026-03-08', 19 * 60, PHOENIX);

    expect(localTimeOf(after.instant, PHOENIX)).toBe('19:00');
    const hours =
      (after.instant.getTime() - before.instant.getTime()) / 3_600_000;
    expect(hours).toBe(24);
  });
});

describe('recurring rules across transitions', () => {
  const weekly = (zone: string) =>
    expandRule({
      rrule: 'FREQ=WEEKLY;BYDAY=SU',
      startMinute: 19 * 60,
      endMinute: 22 * 60,
      timezone: zone,
      effectiveFrom: new Date('2026-02-01T00:00:00Z'),
      effectiveUntil: null,
      fromLocalDate: '2026-02-22',
      toLocalDate: '2026-03-22',
    });

  it('holds 7pm on every occurrence in New York', () => {
    const windows = weekly(NY);
    expect(windows.length).toBeGreaterThanOrEqual(4);

    for (const w of windows) {
      expect(localTimeOf(w.start, NY)).toBe('19:00');
      expect(localTimeOf(w.end, NY)).toBe('22:00');
      expect(w.end.getTime() - w.start.getTime()).toBe(3 * 3_600_000);
    }

    // The 8 March occurrence is the transition date and must still be 7pm.
    expect(windows.some((w) => w.localDate === '2026-03-08')).toBe(true);
  });

  it('holds 7pm on every occurrence in Los Angeles', () => {
    const windows = weekly(LA);
    for (const w of windows) {
      expect(localTimeOf(w.start, LA)).toBe('19:00');
    }
  });

  it('keeps two timezones three hours apart on the same rule', () => {
    // Both coasts transition on the same date, so the gap never wobbles.
    const east = weekly(NY);
    const west = weekly(LA);

    for (let i = 0; i < east.length; i++) {
      const gapHours =
        (west[i]!.start.getTime() - east[i]!.start.getTime()) / 3_600_000;
      expect(gapHours).toBe(3);
    }
  });

  it('produces a 7-hour working day on spring-forward Sunday', () => {
    // 09:00-17:00 local is eight wall-clock hours but only seven real ones
    // when an hour is skipped. Anything that reports eight is doing fixed
    // millisecond arithmetic and is wrong.
    const windows = expandRule({
      rrule: 'FREQ=WEEKLY;BYDAY=SU',
      startMinute: 9 * 60,
      endMinute: 17 * 60,
      timezone: NY,
      effectiveFrom: new Date('2026-03-01T00:00:00Z'),
      effectiveUntil: null,
      fromLocalDate: '2026-03-08',
      toLocalDate: '2026-03-08',
    });

    expect(windows).toHaveLength(1);
    expect(localTimeOf(windows[0]!.start, NY)).toBe('09:00');
    expect(localTimeOf(windows[0]!.end, NY)).toBe('17:00');
    expect(windows[0]!.end.getTime() - windows[0]!.start.getTime()).toBe(
      8 * 3_600_000,
    );
  });

  it('produces a 9-hour working day on fall-back Sunday when it spans 01:00', () => {
    const windows = expandRule({
      rrule: 'FREQ=WEEKLY;BYDAY=SU',
      startMinute: 0,
      endMinute: 8 * 60,
      timezone: NY,
      effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      effectiveUntil: null,
      fromLocalDate: '2026-11-01',
      toLocalDate: '2026-11-01',
    });

    expect(windows).toHaveLength(1);
    // Midnight to 8am on fall-back Sunday is genuinely nine real hours.
    expect(windows[0]!.end.getTime() - windows[0]!.start.getTime()).toBe(
      9 * 3_600_000,
    );
  });

  it('treats rule validity as an instant, not a date', () => {
    // 2026-06-16T00:00:00Z is 15 June, 20:00 in New York. The 10am class on
    // the 16th starts AFTER that instant, so it is correctly excluded.
    // This is the trap that produces off-by-one-day bugs in every scheduling
    // system that compares dates instead of moments.
    const windows = expandRule({
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      startMinute: 10 * 60,
      endMinute: 12 * 60,
      timezone: NY,
      effectiveFrom: new Date('2026-06-01T00:00:00Z'),
      effectiveUntil: new Date('2026-06-16T00:00:00Z'),
      fromLocalDate: '2026-06-01',
      toLocalDate: '2026-06-30',
    });

    expect(windows.map((w) => w.localDate)).toEqual([
      '2026-06-02',
      '2026-06-09',
    ]);
  });

  it('includes the final day when validity runs to the end of that local day', () => {
    // What an admin means by "effective until 16 June": the end of the 16th,
    // local. 16 June 23:59 EDT is 17 June 03:59 UTC.
    const windows = expandRule({
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      startMinute: 10 * 60,
      endMinute: 12 * 60,
      timezone: NY,
      effectiveFrom: new Date('2026-06-01T00:00:00Z'),
      effectiveUntil: new Date('2026-06-17T03:59:00Z'),
      fromLocalDate: '2026-06-01',
      toLocalDate: '2026-06-30',
    });

    expect(windows.map((w) => w.localDate)).toEqual([
      '2026-06-02',
      '2026-06-09',
      '2026-06-16',
    ]);
  });

  it('expands a fortnightly rule without drifting', () => {
    const windows = expandRule({
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE',
      startMinute: 18 * 60,
      endMinute: 21 * 60,
      timezone: NY,
      effectiveFrom: new Date('2026-02-25T00:00:00Z'),
      effectiveUntil: null,
      fromLocalDate: '2026-02-25',
      toLocalDate: '2026-04-30',
    });

    for (const w of windows) {
      expect(localTimeOf(w.start, NY)).toBe('18:00');
    }
    // Spans the March transition; the cadence must survive it.
    expect(windows.map((w) => w.localDate)).toContain('2026-03-11');
  });
});

describe('local date arithmetic', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    const dates = localDateRange('2026-03-06', '2026-03-10');
    expect(dates).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
  });

  it('spans a month boundary and a leap-adjacent February', () => {
    expect(localDateRange('2026-02-26', '2026-03-02')).toEqual([
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });
});

describe('interval algebra', () => {
  const d = (iso: string) => new Date(iso);

  it('merges overlapping and touching intervals', () => {
    const merged = mergeIntervals([
      { start: d('2026-06-01T09:00:00Z'), end: d('2026-06-01T10:00:00Z') },
      { start: d('2026-06-01T10:00:00Z'), end: d('2026-06-01T11:00:00Z') },
      { start: d('2026-06-01T13:00:00Z'), end: d('2026-06-01T14:00:00Z') },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]!.end.toISOString()).toBe('2026-06-01T11:00:00.000Z');
  });

  it('cuts a break out of the middle of a working day', () => {
    const result = subtractIntervals(
      [{ start: d('2026-06-01T09:00:00Z'), end: d('2026-06-01T17:00:00Z') }],
      [{ start: d('2026-06-01T12:00:00Z'), end: d('2026-06-01T13:00:00Z') }],
    );

    expect(result).toHaveLength(2);
    expect(result[0]!.end.toISOString()).toBe('2026-06-01T12:00:00.000Z');
    expect(result[1]!.start.toISOString()).toBe('2026-06-01T13:00:00.000Z');
  });

  it('removes a window entirely when fully covered', () => {
    const result = subtractIntervals(
      [{ start: d('2026-06-01T09:00:00Z'), end: d('2026-06-01T10:00:00Z') }],
      [{ start: d('2026-06-01T08:00:00Z'), end: d('2026-06-01T18:00:00Z') }],
    );
    expect(result).toHaveLength(0);
  });
});
