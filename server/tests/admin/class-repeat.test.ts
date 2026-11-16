import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import {
  fromRepeatRule,
  planClassDates,
  toRepeatRule,
} from '../../src/modules/activities/class-dates';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * REPEAT-PLAN.md, part 1 — a Class that repeats Daily, Weekly or Monthly.
 *
 * Dates are fixed in 2027 so the suite does not depend on today. 1 March 2027
 * is a Monday, and the US spring-forward change is Sunday 14 March 2027.
 */

const app = createApp();
let studio: Studio;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  studio = await signUpStudio(app);
});

const klass = (overrides: Record<string, unknown> = {}) => ({
  name: 'Wheel Basics',
  startDate: '2027-03-01',
  weekdays: ['MO'],
  startTime: '18:00',
  endTime: '19:00',
  sessionCount: 3,
  seats: 8,
  priceCents: 9000,
  ...overrides,
});

async function publish(overrides: Record<string, unknown> = {}) {
  return request(app)
    .post(`${studio.base}/activities/classes`)
    .set(studio.headers)
    .send(klass(overrides));
}

async function sessionsOf(serviceTypeId: string) {
  return prisma.session.findMany({
    where: { serviceTypeId, status: { not: 'CANCELLED' } },
    orderBy: { startsAt: 'asc' },
    select: { startsAt: true },
  });
}

async function answers(id: string) {
  const res = await request(app).get(`${studio.base}/activities/${id}/answers`).set(studio.headers);
  expect(res.status).toBe(200);
  return res.body.answers;
}

describe('the dates a repeating class runs on', () => {
  it('Daily runs every day from the start date', () => {
    const plan = planClassDates({
      startDate: '2027-03-01',
      repeat: 'DAILY',
      weekdays: [],
      sessionCount: 4,
      skipDates: ['2027-03-02'],
    });
    expect(plan.dates).toEqual(['2027-03-01', '2027-03-03', '2027-03-04', '2027-03-05']);
    expect(plan.skipped).toEqual(['2027-03-02']);
  });

  it('Weekly is still the default, on the chosen days', () => {
    const plan = planClassDates({ startDate: '2027-03-01', weekdays: ['WE'], sessionCount: 2 });
    expect(plan.dates).toEqual(['2027-03-03', '2027-03-10']);
  });

  it('Monthly by date passes over months without that day', () => {
    const plan = planClassDates({
      startDate: '2027-01-31',
      repeat: 'MONTHLY',
      monthlyBy: 'DATE',
      weekdays: [],
      sessionCount: 3,
    });
    expect(plan.dates).toEqual(['2027-01-31', '2027-03-31', '2027-05-31']);
  });

  it('Monthly by weekday keeps the position: the first Monday', () => {
    const plan = planClassDates({
      startDate: '2027-03-01',
      repeat: 'MONTHLY',
      monthlyBy: 'WEEKDAY',
      weekdays: [],
      sessionCount: 3,
    });
    expect(plan.dates).toEqual(['2027-03-01', '2027-04-05', '2027-05-03']);
  });

  it('Monthly by last weekday: the last Monday, four or five weeks in', () => {
    const plan = planClassDates({
      startDate: '2027-03-29',
      repeat: 'MONTHLY',
      monthlyBy: 'LAST_WEEKDAY',
      weekdays: [],
      sessionCount: 3,
    });
    expect(plan.dates).toEqual(['2027-03-29', '2027-04-26', '2027-05-31']);
  });

  it('Monthly ignores weekday chips left over from Weekly', () => {
    const plan = planClassDates({
      startDate: '2027-03-01',
      repeat: 'MONTHLY',
      weekdays: ['FR'],
      sessionCount: 2,
    });
    expect(plan.dates).toEqual(['2027-03-01', '2027-04-05']);
  });

  it('refuses more than 24 monthly sessions', () => {
    expect(() =>
      planClassDates({ startDate: '2027-03-01', repeat: 'MONTHLY', weekdays: [], sessionCount: 25 }),
    ).toThrow(/up to 24/);
  });

  it('24 monthly sessions fit, even by the last weekday', () => {
    const plan = planClassDates({
      startDate: '2027-03-29',
      repeat: 'MONTHLY',
      monthlyBy: 'LAST_WEEKDAY',
      weekdays: [],
      sessionCount: 24,
    });
    expect(plan.dates).toHaveLength(24);
    expect(plan.endDate).toBe('2029-02-26');
  });
});

describe('the stored rule', () => {
  it('writes RRULE text without COUNT or UNTIL, and reads it back', () => {
    const cases = [
      [{ repeat: 'DAILY', weekdays: [] }, '2027-03-01', 'FREQ=DAILY'],
      [{ repeat: 'WEEKLY', weekdays: ['WE', 'MO'] }, '2027-03-01', 'FREQ=WEEKLY;BYDAY=MO,WE'],
      [{ repeat: 'MONTHLY', monthlyBy: 'DATE', weekdays: [] }, '2027-03-07', 'FREQ=MONTHLY;BYMONTHDAY=7'],
      [{ repeat: 'MONTHLY', monthlyBy: 'WEEKDAY', weekdays: [] }, '2027-03-22', 'FREQ=MONTHLY;BYDAY=4MO'],
      [{ repeat: 'MONTHLY', monthlyBy: 'LAST_WEEKDAY', weekdays: [] }, '2027-03-29', 'FREQ=MONTHLY;BYDAY=-1MO'],
    ] as const;
    for (const [pattern, start, rule] of cases) {
      expect(toRepeatRule({ ...pattern, weekdays: [...pattern.weekdays] }, start)).toBe(rule);
      const back = fromRepeatRule(rule)!;
      expect(back.repeat).toBe(pattern.repeat);
      if (pattern.repeat === 'MONTHLY') expect(back.monthlyBy).toBe(pattern.monthlyBy);
    }
    expect(fromRepeatRule(null)).toBeNull();
    expect(fromRepeatRule('FREQ=YEARLY')).toBeNull();
  });
});

describe('publishing a repeating class', () => {
  it('Daily: a session every day, stored as FREQ=DAILY, open to late joiners', async () => {
    const res = await publish({ repeat: 'DAILY', weekdays: [], sessionCount: 5 });
    expect(res.status).toBe(201);
    expect(res.body.sessions.map((s: { localDate: string }) => s.localDate)).toEqual([
      '2027-03-01',
      '2027-03-02',
      '2027-03-03',
      '2027-03-04',
      '2027-03-05',
    ]);
    expect(res.body.series.repeatRule).toBe('FREQ=DAILY');
    expect(res.body.series.allowLateEnrollment).toBe(true);
  });

  it('Weekly: as before, and still closes once it starts', async () => {
    const res = await publish();
    expect(res.status).toBe(201);
    expect(res.body.series.repeatRule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(res.body.series.allowLateEnrollment).toBe(false);
  });

  it('Monthly keeps 6pm local across the spring-forward change', async () => {
    const res = await publish({ repeat: 'MONTHLY', monthlyBy: 'WEEKDAY', weekdays: [] });
    expect(res.status).toBe(201);
    expect(res.body.series.repeatRule).toBe('FREQ=MONTHLY;BYDAY=1MO');
    const sessions = await sessionsOf(res.body.service.id);
    // 6pm EST is 23:00Z; after 14 March, 6pm EDT is 22:00Z.
    expect(sessions.map((s) => s.startsAt.toISOString())).toEqual([
      '2027-03-01T23:00:00.000Z',
      '2027-04-05T22:00:00.000Z',
      '2027-05-03T22:00:00.000Z',
    ]);
  });

  it('refuses Weekly with no days, and Monthly over 24 sessions', async () => {
    const noDays = await publish({ weekdays: [] });
    expect(noDays.status).toBe(422);
    expect(JSON.stringify(noDays.body)).toMatch(/day of the week/);

    const tooMany = await publish({ repeat: 'MONTHLY', weekdays: [], sessionCount: 25 });
    expect(tooMany.status).toBe(422);
    expect(JSON.stringify(tooMany.body)).toMatch(/up to 24/);
  });

  it('a request without `repeat` is Weekly, as older drafts send', async () => {
    const res = await publish({ weekdays: ['TU'] });
    expect(res.status).toBe(201);
    expect(res.body.sessions[0].localDate).toBe('2027-03-02');
  });

  it('the live preview shows the same dates', async () => {
    const res = await request(app)
      .post(`${studio.base}/activities/preview`)
      .set(studio.headers)
      .send({
        kind: 'CLASS',
        startDate: '2027-01-31',
        repeat: 'MONTHLY',
        monthlyBy: 'DATE',
        weekdays: [],
        sessionCount: 2,
        startTime: '18:00',
        endTime: '19:00',
      });
    expect(res.status).toBe(200);
    expect(res.body.dates.map((d: { localDate: string }) => d.localDate)).toEqual([
      '2027-01-31',
      '2027-03-31',
    ]);
  });
});

describe('editing a repeating class', () => {
  it('opens Monthly with its choice and a skipped month, exactly as published', async () => {
    const res = await publish({
      startDate: '2027-03-29',
      repeat: 'MONTHLY',
      monthlyBy: 'LAST_WEEKDAY',
      weekdays: [],
      skipDates: ['2027-04-26'],
    });
    expect(res.status).toBe(201);
    expect(await answers(res.body.service.id)).toMatchObject({
      startDate: '2027-03-29',
      repeat: 'MONTHLY',
      monthlyBy: 'LAST_WEEKDAY',
      weekdays: [],
      sessionCount: 3,
      skipDates: ['2027-04-26'],
    });
  });

  it('a Class made before repeat opens as Weekly on its days', async () => {
    const res = await publish({ weekdays: ['MO', 'TH'], sessionCount: 4 });
    await prisma.courseSeries.update({
      where: { id: res.body.series.id },
      data: { repeatRule: null },
    });
    expect(await answers(res.body.service.id)).toMatchObject({
      repeat: 'WEEKLY',
      weekdays: ['MO', 'TH'],
      sessionCount: 4,
      skipDates: [],
    });
  });

  it('switching Weekly to Daily before anyone books remakes the dates and the rule', async () => {
    const res = await publish();
    const id = res.body.service.id as string;
    const saved = await request(app)
      .put(`${studio.base}/activities/classes/${id}`)
      .set(studio.headers)
      .send(klass({ repeat: 'DAILY', weekdays: [] }));
    expect(saved.status).toBe(200);
    expect(saved.body.datesChanged).toBe(true);

    const sessions = await sessionsOf(id);
    expect(sessions).toHaveLength(3);
    // 1, 2 and 3 March at 6pm EST.
    expect(sessions[2]!.startsAt.toISOString()).toBe('2027-03-03T23:00:00.000Z');

    const series = await prisma.courseSeries.findUniqueOrThrow({ where: { id: res.body.series.id } });
    expect(series.repeatRule).toBe('FREQ=DAILY');
    expect(series.allowLateEnrollment).toBe(true);
  });

  it('saving without changing the dates leaves a hand-set late-join switch alone', async () => {
    const res = await publish();
    const id = res.body.service.id as string;
    await prisma.courseSeries.update({
      where: { id: res.body.series.id },
      data: { allowLateEnrollment: true },
    });
    const saved = await request(app)
      .put(`${studio.base}/activities/classes/${id}`)
      .set(studio.headers)
      .send(klass({ name: 'Wheel Basics II' }));
    expect(saved.status).toBe(200);
    expect(saved.body.datesChanged).toBe(false);
    const series = await prisma.courseSeries.findUniqueOrThrow({ where: { id: res.body.series.id } });
    expect(series.allowLateEnrollment).toBe(true);
    expect(series.repeatRule).toBe('FREQ=WEEKLY;BYDAY=MO');
  });
});
