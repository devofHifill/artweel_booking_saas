import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * Editing a published Class or Event (CLASS-EVENT-PLAN.md): the same answers
 * the steps collect, reaching the activity, its course and every session
 * still to run. Dates move only while nobody has booked.
 */

function weeksAhead(weeks = 3): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

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
  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
  slug = (await prisma.organization.findUniqueOrThrow({ where: { id: studio.organizationId } })).slug;
});

const klass = (overrides: Record<string, unknown> = {}) => ({
  name: 'Family Wheel',
  startDate: weeksAhead(),
  weekdays: ['SA'],
  startTime: '10:00',
  endTime: '12:00',
  sessionCount: 4,
  seats: 8,
  priceCents: 0,
  ...overrides,
});

const event = (overrides: Record<string, unknown> = {}) => ({
  name: 'Date Night',
  date: weeksAhead(4),
  startTime: '18:30',
  endTime: '21:00',
  seats: 12,
  priceCents: 8500,
  ...overrides,
});

async function addStaff(name: string) {
  const res = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name, email: `${name.split(' ')[0]!.toLowerCase()}@clay.test` });
  return res.body.staff.id as string;
}

async function publishClass(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`${studio.base}/activities/classes`)
    .set(studio.headers)
    .send(klass(overrides));
  expect(res.status).toBe(201);
  return res.body as { service: { id: string }; series: { id: string } };
}

async function answers(id: string) {
  const res = await request(app).get(`${studio.base}/activities/${id}/answers`).set(studio.headers);
  expect(res.status).toBe(200);
  return res.body;
}

const saveClass = (id: string, body: Record<string, unknown>) =>
  request(app).put(`${studio.base}/activities/classes/${id}`).set(studio.headers).send(body);

describe('opening a class for Edit', () => {
  it('gives back the answers it was published with, dates included', async () => {
    const { service } = await publishClass({
      weekdays: ['TU', 'SA'],
      skipDates: [],
      childPriceCents: 500,
      minGuests: 2,
      maxHorizonDays: 60,
    });
    const res = await answers(service.id);
    expect(res.kind).toBe('CLASS');
    expect(res.datesLocked).toBeNull();
    expect(res.answers).toMatchObject({
      name: 'Family Wheel',
      weekdays: ['TU', 'SA'],
      sessionCount: 4,
      startTime: '10:00',
      endTime: '12:00',
      seats: 8,
      childPriceCents: 500,
      minGuests: 2,
      maxHorizonDays: 60,
      skipDates: [],
    });
  });
});

describe('saving an edited class', () => {
  it('renames it everywhere: the activity, its course, and the booking page', async () => {
    const { service, series } = await publishClass();
    const now = (await answers(service.id)).answers;
    const res = await saveClass(service.id, { ...klass({ startDate: now.startDate }), name: 'Family Clay Club', description: 'New words.' });
    expect(res.status).toBe(200);
    expect(res.body.datesChanged).toBe(false);

    const course = await prisma.courseSeries.findUniqueOrThrow({ where: { id: series.id } });
    expect(course).toMatchObject({ name: 'Family Clay Club', description: 'New words.' });
    const html = (await request(app).get(`/public/${slug}/book`).expect(200)).text;
    expect(html).toContain('Family Clay Club');
    expect(html).not.toContain('Family Wheel<');
  });

  it('carries seats and a new instructor to every session, moving their time', async () => {
    const rowan = await addStaff('Rowan Pike');
    const sam = await addStaff('Sam Ortega');
    const { service } = await publishClass({ staffId: rowan });
    const start = (await answers(service.id)).answers.startDate;

    const res = await saveClass(service.id, klass({ startDate: start, staffId: sam, seats: 10 }));
    expect(res.status).toBe(200);

    const sessions = await prisma.session.findMany({ where: { serviceTypeId: service.id, status: 'SCHEDULED' } });
    expect(sessions).toHaveLength(4);
    expect(sessions.every((x) => x.capacity === 10 && x.staffId === sam)).toBe(true);
    const blocks = await prisma.staffTimeBlock.findMany({ where: { sessionId: { in: sessions.map((x) => x.id) } } });
    expect(blocks).toHaveLength(4);
    expect(blocks.every((b) => b.staffId === sam)).toBe(true);
  });

  it('refuses a new instructor who is busy, naming the date', async () => {
    const rowan = await addStaff('Rowan Pike');
    const sam = await addStaff('Sam Ortega');
    const { service } = await publishClass({ staffId: rowan });
    const start = (await answers(service.id)).answers.startDate;
    // Sam already teaches another class at the same time.
    await publishClass({ name: 'Other Class', staffId: sam, startDate: start });

    const res = await saveClass(service.id, klass({ startDate: start, staffId: sam }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLASH');
  });

  it('does not count its own sessions as clashes', async () => {
    const rowan = await addStaff('Rowan Pike');
    const { service } = await publishClass({ staffId: rowan });
    const start = (await answers(service.id)).answers.startDate;
    const res = await saveClass(service.id, klass({ startDate: start, staffId: rowan, name: 'Renamed' }));
    expect(res.status).toBe(200);
  });

  it('moves its dates while nobody has booked', async () => {
    const { service, series } = await publishClass();
    const res = await saveClass(
      service.id,
      klass({ startDate: weeksAhead(5), weekdays: ['SU'], sessionCount: 3, startTime: '14:00', endTime: '15:30' }),
    );
    expect(res.status).toBe(200);
    expect(res.body.datesChanged).toBe(true);

    const live = await prisma.session.findMany({
      where: { serviceTypeId: service.id, status: 'SCHEDULED' },
      orderBy: { startsAt: 'asc' },
    });
    expect(live).toHaveLength(3);
    expect(live.map((x) => x.seriesIndex)).toEqual([1, 2, 3]);
    expect(live.every((x) => x.courseSeriesId === series.id)).toBe(true);
    const after = (await answers(service.id)).answers;
    expect(after).toMatchObject({ weekdays: ['SU'], sessionCount: 3, startTime: '14:00', endTime: '15:30' });
    const svc = await prisma.serviceType.findUniqueOrThrow({ where: { id: service.id } });
    expect(svc.durationMinutes).toBe(90);
  });

  it('keeps its dates once somebody has booked, but still saves everything else', async () => {
    const { service, series } = await publishClass();
    const start = (await answers(service.id)).answers.startDate;
    await request(app)
      .post(`/public/${slug}/courses/${series.id}/enrollments`)
      .send({ seats: 2, customer: { name: 'Ada Potter', email: 'ada@family.test' } })
      .expect(201);

    const opened = await answers(service.id);
    expect(opened.datesLocked).toMatch(/booked/);

    const moved = await saveClass(service.id, klass({ startDate: weeksAhead(6) }));
    expect(moved.status).toBe(409);
    expect(moved.body.error.code).toBe('DATES_LOCKED');

    const tooFew = await saveClass(service.id, klass({ startDate: start, seats: 1 }));
    expect(tooFew.status).toBe(409);
    expect(tooFew.body.error.code).toBe('CAPACITY_BELOW_BOOKED');

    const ok = await saveClass(service.id, klass({ startDate: start, seats: 6, name: 'Still Booked' }));
    expect(ok.status).toBe(200);
    const sessions = await prisma.session.findMany({ where: { serviceTypeId: service.id, status: 'SCHEDULED' } });
    expect(sessions.every((x) => x.capacity === 6 && x.seatsTaken === 2)).toBe(true);
  });

  it('switching a hidden class on still respects Solo’s one class', async () => {
    const solo = await signUpStudio(app, { plan: 'SOLO' });
    const one = await request(app).post(`${solo.base}/activities/classes`).set(solo.headers).send(klass());
    expect(one.status).toBe(201);
    const hidden = await request(app)
      .post(`${solo.base}/activities/classes`)
      .set(solo.headers)
      .send(klass({ name: 'Next Term', isActive: false }));
    const start = (
      await request(app).get(`${solo.base}/activities/${hidden.body.service.id}/answers`).set(solo.headers)
    ).body.answers.startDate;

    const res = await request(app)
      .put(`${solo.base}/activities/classes/${hidden.body.service.id}`)
      .set(solo.headers)
      .send(klass({ name: 'Next Term', startDate: start, isActive: true }));
    expect(res.status).toBe(402);
  });
});

describe('editing an event', () => {
  it('saves every detail, and its seats and time reach its one session', async () => {
    const created = await request(app).post(`${studio.base}/activities/events`).set(studio.headers).send(event());
    expect(created.status).toBe(201);
    const id = created.body.service.id;

    const res = await request(app)
      .put(`${studio.base}/activities/events/${id}`)
      .set(studio.headers)
      .send(
        event({
          seats: 20,
          startTime: '19:00',
          endTime: '22:00',
          childPriceCents: 4000,
          depositType: 'fixed',
          depositValue: 2000,
          highlights: 'Wine\nClay',
        }),
      );
    expect(res.status).toBe(200);

    const svc = await prisma.serviceType.findUniqueOrThrow({ where: { id } });
    expect(svc).toMatchObject({
      capacityMax: 20,
      childPriceCents: 4000,
      depositType: 'fixed',
      depositValue: 2000,
      highlights: 'Wine\nClay',
      durationMinutes: 180,
    });
    const sessions = await prisma.session.findMany({ where: { serviceTypeId: id, status: 'SCHEDULED' } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.capacity).toBe(20);
    expect((await answers(id)).answers).toMatchObject({ startTime: '19:00', endTime: '22:00' });
  });

  it('will not open a class as an event', async () => {
    const { service } = await publishClass();
    const res = await request(app)
      .put(`${studio.base}/activities/events/${service.id}`)
      .set(studio.headers)
      .send(event());
    expect(res.status).toBe(400);
  });
});
