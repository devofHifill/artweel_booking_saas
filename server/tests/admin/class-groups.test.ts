import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { groupTimes } from '../../src/modules/activities/class-dates';
import { countRunningClasses } from '../../src/modules/activities/class-limit';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * REPEAT-PLAN.md, part 2 — a Class at several times a day. Each time group is
 * its own run (course_series) with its own customers, under one activity.
 *
 * Dates are fixed in 2027. 1 March 2027 is a Monday; New York is UTC-5 then.
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

const klass = (overrides: Record<string, unknown> = {}) => ({
  name: 'Wheel Basics',
  startDate: '2027-03-01',
  weekdays: ['MO'],
  startTime: '18:00',
  endTime: '19:00',
  sessionCount: 3,
  seats: 8,
  priceCents: 9000,
  groups: 3,
  bufferMinutes: 15,
  ...overrides,
});

const publish = (overrides: Record<string, unknown> = {}) =>
  request(app).post(`${studio.base}/activities/classes`).set(studio.headers).send(klass(overrides));

async function addStaff(name = 'Rowan Pike') {
  const res = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name, email: `${name.split(' ')[0]!.toLowerCase()}@clay.test` });
  expect(res.status).toBe(201);
  return res.body.staff.id as string;
}

async function cohortsOf(serviceTypeId: string) {
  return prisma.courseSeries.findMany({
    where: { serviceTypeId, status: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'asc' },
    include: {
      sessions: {
        where: { status: { not: 'CANCELLED' } },
        orderBy: { startsAt: 'asc' },
        select: { startsAt: true, localStartTime: true },
      },
    },
  });
}

describe('the times of each group', () => {
  it('each starts after the one before ends, plus the buffer', () => {
    expect(groupTimes({ startTime: '06:00', endTime: '07:00', groups: 5, bufferMinutes: 15 })).toEqual([
      { startTime: '06:00', endTime: '07:00', label: '6:00am' },
      { startTime: '07:15', endTime: '08:15', label: '7:15am' },
      { startTime: '08:30', endTime: '09:30', label: '8:30am' },
      { startTime: '09:45', endTime: '10:45', label: '9:45am' },
      { startTime: '11:00', endTime: '12:00', label: '11:00am' },
    ]);
  });

  it('one group is a plain Class', () => {
    expect(groupTimes({ startTime: '18:00', endTime: '20:00' })).toHaveLength(1);
  });

  it('refuses groups that would run past midnight', () => {
    expect(() =>
      groupTimes({ startTime: '21:00', endTime: '22:00', groups: 3, bufferMinutes: 30 }),
    ).toThrow(/past midnight/);
  });
});

describe('publishing a class with time groups', () => {
  it('makes one run per group, each labelled by its time, under one activity', async () => {
    const res = await publish();
    expect(res.status).toBe(201);
    expect(res.body.groups).toHaveLength(3);

    const cohorts = await cohortsOf(res.body.service.id);
    expect(cohorts.map((c) => c.cohortLabel)).toEqual(['6:00pm', '7:15pm', '8:30pm']);
    expect(cohorts.every((c) => c.sessionCount === 3 && c.capacity === 8)).toBe(true);
    // 7:15pm on the three Mondays: EST, EST, then EDT after 14 March.
    expect(cohorts[1]!.sessions.map((s) => s.startsAt.toISOString())).toEqual([
      '2027-03-02T00:15:00.000Z',
      '2027-03-09T00:15:00.000Z',
      '2027-03-15T23:15:00.000Z',
    ]);
    expect(cohorts[1]!.sessions[0]!.localStartTime).toBe('19:15');
  });

  it('counts as one Class toward the plan limit', async () => {
    await publish();
    expect(await countRunningClasses(studio.organizationId)).toBe(1);
  });

  it('one instructor can teach the groups back to back', async () => {
    const staffId = await addStaff();
    const res = await publish({ staffId, bufferMinutes: 0 });
    expect(res.status).toBe(201);
    const blocks = await prisma.staffTimeBlock.count({ where: { staffId } });
    expect(blocks).toBe(9);
  });

  it('a clash in any group makes nothing at all', async () => {
    const staffId = await addStaff();
    // The instructor already teaches at 7:15pm on the first Monday.
    await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send({
        name: 'Glaze Night',
        date: '2027-03-01',
        startTime: '19:15',
        endTime: '20:15',
        seats: 6,
        priceCents: 0,
        staffId,
      })
      .expect(201);

    const res = await publish({ staffId });
    expect(res.status).toBe(409);
    expect(await prisma.serviceType.count({ where: { name: 'Wheel Basics' } })).toBe(0);
  });

  it('refuses groups that would run past midnight', async () => {
    const res = await publish({ startTime: '21:00', endTime: '22:00', groups: 3, bufferMinutes: 30 });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/past midnight/);
  });

  it('a request without groups is one group, unlabelled, as before', async () => {
    const res = await publish({ groups: undefined, bufferMinutes: undefined });
    expect(res.status).toBe(201);
    const cohorts = await cohortsOf(res.body.service.id);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]!.cohortLabel).toBeNull();
  });
});

describe('editing a class with time groups', () => {
  it('opens with its group count and buffer', async () => {
    const res = await publish();
    const answers = await request(app)
      .get(`${studio.base}/activities/${res.body.service.id}/answers`)
      .set(studio.headers);
    expect(answers.body.answers).toMatchObject({
      startTime: '18:00',
      endTime: '19:00',
      sessionCount: 3,
      groups: 3,
      bufferMinutes: 15,
      weekdays: ['MO'],
      skipDates: [],
    });
  });

  it('saving the same answers changes no dates', async () => {
    const res = await publish();
    const saved = await request(app)
      .put(`${studio.base}/activities/classes/${res.body.service.id}`)
      .set(studio.headers)
      .send(klass({ priceCents: 9900 }));
    expect(saved.status).toBe(200);
    expect(saved.body.datesChanged).toBe(false);
    const cohorts = await cohortsOf(res.body.service.id);
    expect(cohorts.map((c) => c.priceCents)).toEqual([9900, 9900, 9900]);
  });

  it('fewer groups before anyone books: the last group ends, the others keep their ids', async () => {
    const res = await publish();
    const before = await cohortsOf(res.body.service.id);
    const saved = await request(app)
      .put(`${studio.base}/activities/classes/${res.body.service.id}`)
      .set(studio.headers)
      .send(klass({ groups: 2 }));
    expect(saved.status).toBe(200);

    const after = await cohortsOf(res.body.service.id);
    expect(after.map((c) => c.id)).toEqual(before.slice(0, 2).map((c) => c.id));
    expect(after.every((c) => c.sessions.length === 3)).toBe(true);
    const gone = await prisma.courseSeries.findUniqueOrThrow({ where: { id: before[2]!.id } });
    expect(gone.status).toBe('CANCELLED');
  });

  it('one group becoming three adds two runs with their own times', async () => {
    const res = await publish({ groups: 1, bufferMinutes: 0 });
    const saved = await request(app)
      .put(`${studio.base}/activities/classes/${res.body.service.id}`)
      .set(studio.headers)
      .send(klass({ groups: 3, bufferMinutes: 30 }));
    expect(saved.status).toBe(200);
    const cohorts = await cohortsOf(res.body.service.id);
    expect(cohorts.map((c) => c.cohortLabel)).toEqual(['6:00pm', '7:30pm', '9:00pm']);
    expect(cohorts[0]!.id).toBe(res.body.series.id);
  });
});

describe('the booking page', () => {
  it('shows one card for the class, naming its times', async () => {
    await publish();
    const html = (await request(app).get(`/public/${slug}/book`).expect(200)).text;
    expect(html.match(/data-class="/g) ?? []).toHaveLength(1);
    expect(html).toContain('3 times: 6:00pm, 7:15pm, 8:30pm');
    // No per-run cards for it.
    expect(html.match(/data-course="/g) ?? []).toHaveLength(0);
  });

  it('a one-time class keeps its own card', async () => {
    await publish({ groups: 1 });
    const html = (await request(app).get(`/public/${slug}/book`).expect(200)).text;
    expect(html.match(/data-course="/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('data-class="');
  });
});
