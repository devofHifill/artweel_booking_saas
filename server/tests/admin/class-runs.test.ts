import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { planClassRuns } from '../../src/modules/activities/class-dates';
import { countRunningClasses } from '../../src/modules/activities/class-limit';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * REPEAT-PLAN.md, part 4 — runs over a date range. The same pattern runs back
 * to back from the start date while a full run fits before "Until"; every run
 * x time is its own group. Booked runs keep their dates; runs can be added.
 *
 * Fixed in 2027: 1 March 2027 is a Monday.
 */

const app = createApp();
let studio: Studio;
let slug: string;

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
  slug = (await prisma.organization.findUniqueOrThrow({ where: { id: studio.organizationId } })).slug;
});

/** Mon & Tue, 3 weeks a run (6 sessions), from 1 March to 10 May. */
const klass = (overrides: Record<string, unknown> = {}) => ({
  name: 'Wheel Basics',
  startDate: '2027-03-01',
  rangeEnd: '2027-05-10',
  weekdays: ['MO', 'TU'],
  startTime: '18:00',
  endTime: '19:00',
  sessionCount: 6,
  seats: 8,
  priceCents: 9000,
  ...overrides,
});

const publish = (overrides: Record<string, unknown> = {}) =>
  request(app).post(`${studio.base}/activities/classes`).set(studio.headers).send(klass(overrides));
const save = (id: string, overrides: Record<string, unknown> = {}) =>
  request(app).put(`${studio.base}/activities/classes/${id}`).set(studio.headers).send(klass(overrides));

async function cohortsOf(serviceTypeId: string) {
  const cohorts = await prisma.courseSeries.findMany({
    where: { serviceTypeId, status: { not: 'CANCELLED' } },
    include: {
      sessions: {
        where: { status: { not: 'CANCELLED' } },
        orderBy: { startsAt: 'asc' },
        select: { id: true, startsAt: true },
      },
    },
  });
  return cohorts.sort(
    (a, b) => a.sessions[0]!.startsAt.getTime() - b.sessions[0]!.startsAt.getTime(),
  );
}

const run = {
  repeat: 'WEEKLY' as const,
  weekdays: ['MO' as const, 'TU' as const],
  sessionCount: 6,
};

describe('the runs over a range', () => {
  it('lays runs back to back while a full run fits, and names what is left', () => {
    const plan = planClassRuns({ ...run, startDate: '2027-03-01', rangeEnd: '2027-05-10' });
    expect(plan.runs.map((r) => [r.dates[0], r.endDate])).toEqual([
      ['2027-03-01', '2027-03-16'],
      ['2027-03-22', '2027-04-06'],
      ['2027-04-12', '2027-04-27'],
    ]);
    expect(plan.leftOver).toEqual(['2027-05-03', '2027-05-04', '2027-05-10']);
  });

  it('no end date is one run, as before', () => {
    expect(planClassRuns({ ...run, startDate: '2027-03-01' }).runs).toHaveLength(1);
  });

  it('a skipped date lengthens its run and moves the later runs along', () => {
    const plan = planClassRuns({
      ...run,
      startDate: '2027-03-01',
      rangeEnd: '2027-05-10',
      skipDates: ['2027-03-08'],
    });
    expect(plan.runs[0]!.dates).toEqual([
      '2027-03-01',
      '2027-03-02',
      '2027-03-09',
      '2027-03-15',
      '2027-03-16',
      '2027-03-22',
    ]);
    expect(plan.runs[1]!.dates[0]).toBe('2027-03-23');
    expect(plan.skipped).toEqual(['2027-03-08']);
  });

  it('one-week runs: neither repeat ticked', () => {
    const plan = planClassRuns({ ...run, sessionCount: 2, startDate: '2027-03-01', rangeEnd: '2027-03-21' });
    expect(plan.runs.map((r) => r.dates)).toEqual([
      ['2027-03-01', '2027-03-02'],
      ['2027-03-08', '2027-03-09'],
      ['2027-03-15', '2027-03-16'],
    ]);
  });

  it('monthly runs keep the first run’s week of the month', () => {
    const plan = planClassRuns({
      repeat: 'MONTHLY',
      monthlyBy: 'WEEKDAY',
      weekdays: ['MO'],
      sessionCount: 2,
      startDate: '2027-03-22',
      rangeEnd: '2027-08-31',
    });
    expect(plan.runs.map((r) => r.dates)).toEqual([
      ['2027-03-22', '2027-04-26'],
      ['2027-05-24', '2027-06-28'],
      ['2027-07-26', '2027-08-23'],
    ]);
  });

  it('refuses an end date before one run can finish', () => {
    expect(() => planClassRuns({ ...run, startDate: '2027-03-01', rangeEnd: '2027-03-10' })).toThrow(
      /One run needs until 2027-03-16/,
    );
  });
});

describe('publishing runs', () => {
  it('makes one group per run and time, labelled by both, as one Class', async () => {
    const res = await publish({ startTimes: ['18:00', '20:00'] });
    expect(res.status).toBe(201);
    expect(res.body.runs).toBe(3);
    expect(res.body.leftOver).toEqual(['2027-05-03', '2027-05-04', '2027-05-10']);

    const cohorts = await cohortsOf(res.body.service.id);
    expect(cohorts).toHaveLength(6);
    expect(cohorts.map((c) => c.cohortLabel).sort()).toEqual(
      ['1 Mar · 6:00pm', '1 Mar · 8:00pm', '22 Mar · 6:00pm', '22 Mar · 8:00pm', '12 Apr · 6:00pm', '12 Apr · 8:00pm'].sort(),
    );
    expect(cohorts.every((c) => c.sessions.length === 6)).toBe(true);
    expect(await countRunningClasses(studio.organizationId)).toBe(1);
  });

  it('one time over a range is labelled by the run’s first date', async () => {
    const res = await publish();
    const cohorts = await cohortsOf(res.body.service.id);
    expect(cohorts.map((c) => c.cohortLabel)).toEqual(['1 Mar', '22 Mar', '12 Apr']);
  });

  it('refuses an Until date too early for one run', async () => {
    const res = await publish({ rangeEnd: '2027-03-10' });
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe('INVALID_SCHEDULE');
  });

  it('opens in Edit with its range, times and count', async () => {
    const res = await publish({ startTimes: ['18:00', '20:00'], skipDates: ['2027-03-23'] });
    const answers = await request(app)
      .get(`${studio.base}/activities/${res.body.service.id}/answers`)
      .set(studio.headers);
    expect(answers.body.answers).toMatchObject({
      startDate: '2027-03-01',
      // The last session of the last run: the range as it was made.
      rangeEnd: '2027-05-03',
      weekdays: ['MO', 'TU'],
      sessionCount: 6,
      startTimes: ['18:00', '20:00'],
      skipDates: ['2027-03-23'],
    });
  });
});

describe('editing runs', () => {
  /** Someone has a seat in every session of the first run. */
  async function bookFirstRun(serviceTypeId: string) {
    const first = (await cohortsOf(serviceTypeId))[0]!;
    await prisma.session.updateMany({
      where: { courseSeriesId: first.id },
      data: { seatsTaken: 1 },
    });
    return first.id;
  }

  it('adds runs after a booked one, which keeps its dates and id', async () => {
    const res = await publish({ rangeEnd: '2027-04-06' });
    const booked = await bookFirstRun(res.body.service.id);

    const saved = await save(res.body.service.id, { rangeEnd: '2027-05-31' });
    expect(saved.status).toBe(200);
    const cohorts = await cohortsOf(res.body.service.id);
    expect(cohorts.map((c) => c.cohortLabel)).toEqual(['1 Mar', '22 Mar', '12 Apr', '3 May']);
    expect(cohorts[0]!.id).toBe(booked);
  });

  it('refuses to move a booked run', async () => {
    const res = await publish();
    await bookFirstRun(res.body.service.id);
    const saved = await save(res.body.service.id, { weekdays: ['MO', 'WE'] });
    expect(saved.status).toBe(409);
    expect(JSON.stringify(saved.body)).toMatch(/run from 1 Mar has bookings/);
  });

  it('a shorter range ends an unbooked last run', async () => {
    const res = await publish();
    const before = await cohortsOf(res.body.service.id);
    const saved = await save(res.body.service.id, { rangeEnd: '2027-04-10' });
    expect(saved.status).toBe(200);
    const after = await cohortsOf(res.body.service.id);
    expect(after.map((c) => c.id)).toEqual(before.slice(0, 2).map((c) => c.id));
    const gone = await prisma.courseSeries.findUniqueOrThrow({ where: { id: before[2]!.id } });
    expect(gone.status).toBe('CANCELLED');
  });

  it('saving unchanged keeps every run as it is', async () => {
    const res = await publish();
    const saved = await save(res.body.service.id, { rangeEnd: '2027-04-27', priceCents: 9900 });
    expect(saved.status).toBe(200);
    expect(saved.body.datesChanged).toBe(false);
    const cohorts = await cohortsOf(res.body.service.id);
    expect(cohorts.map((c) => c.priceCents)).toEqual([9900, 9900, 9900]);
  });
});

describe('the booking page', () => {
  it('one card naming the runs, with a date per run in the picker data', async () => {
    await publish();
    const html = (await request(app).get(`/public/${slug}/book`).expect(200)).text;
    expect(html.match(/data-class="/g) ?? []).toHaveLength(1);
    expect(html).toContain('3 runs, from 1 Mar');
    expect(html).toContain('Choose a date');
  });
});
