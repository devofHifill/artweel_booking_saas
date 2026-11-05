import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { planClassDates } from '../../src/modules/activities/class-dates';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';

/**
 * CLASS-EVENT-PLAN.md, Stage 1 — publishing a Class or an Event, drafts, and
 * Past.
 *
 * Dates are fixed in 2027 so the suite does not depend on today, and so one
 * class crosses the US spring-forward change (Sunday 14 March 2027): a 6pm
 * Tuesday class must stay at 6pm local, which moves it an hour in UTC.
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
  studio = await signUpStudio(app);
});

const event = (overrides: Record<string, unknown> = {}) => ({
  name: 'Valentine Date Night',
  date: '2027-02-12',
  startTime: '18:30',
  endTime: '21:00',
  seats: 12,
  priceCents: 8500,
  ...overrides,
});

const klass = (overrides: Record<string, unknown> = {}) => ({
  name: 'Beginner Wheel',
  startDate: '2027-03-01', // a Monday
  weekdays: ['TU'],
  startTime: '18:00',
  endTime: '20:00',
  sessionCount: 4,
  seats: 8,
  priceCents: 32000,
  ...overrides,
});

async function addStaff(name = 'Rowan Pike') {
  const res = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name, email: `${name.split(' ')[0]!.toLowerCase()}@clay.test` });
  expect(res.status).toBe(201);
  return res.body.staff.id as string;
}

async function addLocation(name: string) {
  const location = await prisma.location.create({
    data: { organizationId: studio.organizationId, name, lat: 40.7, lng: -74 },
  });
  return location.id;
}

describe('the dates a class runs on', () => {
  it('starts on the first chosen weekday on or after the start date', () => {
    const plan = planClassDates({ startDate: '2027-03-01', weekdays: ['TU'], sessionCount: 3 });
    expect(plan.dates).toEqual(['2027-03-02', '2027-03-09', '2027-03-16']);
    expect(plan.endDate).toBe('2027-03-16');
  });

  it('runs on two weekdays and counts sessions, not weeks', () => {
    const plan = planClassDates({
      startDate: '2027-03-01',
      weekdays: ['TH', 'TU'],
      sessionCount: 4,
    });
    expect(plan.dates).toEqual(['2027-03-02', '2027-03-04', '2027-03-09', '2027-03-11']);
  });

  it('adds a date at the end for every one skipped, so the count holds', () => {
    const plan = planClassDates({
      startDate: '2027-03-01',
      weekdays: ['TU'],
      sessionCount: 3,
      skipDates: ['2027-03-09', '2027-12-25'],
    });
    expect(plan.dates).toEqual(['2027-03-02', '2027-03-16', '2027-03-23']);
    // Only skips that fell inside the run are reported.
    expect(plan.skipped).toEqual(['2027-03-09']);
    expect(plan.endDate).toBe('2027-03-23');
  });

  it('refuses no weekdays and a bad start date', () => {
    expect(() =>
      planClassDates({ startDate: '2027-03-01', weekdays: [], sessionCount: 3 }),
    ).toThrow(/day of the week/);
    expect(() =>
      planClassDates({ startDate: '2027-02-30', weekdays: ['TU'], sessionCount: 3 }),
    ).toThrow(/Invalid start date/);
  });
});

describe('publishing an event', () => {
  it('creates an EVENT with one session at the local time asked for', async () => {
    const res = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send(event());

    expect(res.status).toBe(201);
    expect(res.body.service.kind).toBe('EVENT');
    expect(res.body.service.bookingMode).toBe('EVENT');
    expect(res.body.service.capacityMax).toBe(12);
    expect(res.body.service.durationMinutes).toBe(150);
    // 18:30 in New York in February (EST, UTC-5).
    expect(res.body.session.startsAt).toBe('2027-02-12T23:30:00.000Z');
    expect(res.body.session.capacity).toBe(12);

    const sessions = await prisma.session.count({
      where: { serviceTypeId: res.body.service.id },
    });
    expect(sessions).toBe(1);
  });

  it('refuses a date that has passed', async () => {
    const res = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send(event({ date: '2020-02-12' }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DATE_IN_PAST');
  });

  it('refuses an end time before the start time', async () => {
    const res = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send(event({ startTime: '21:00', endTime: '18:30' }));

    // Body validation answers 422 everywhere in this API.
    expect(res.status).toBe(422);
  });

  it('takes bookings far enough ahead to reach an event months away', async () => {
    const res = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send(event({ date: '2027-10-01' }));

    expect(res.status).toBe(201);
    const daysAway = (Date.parse('2027-10-01') - Date.now()) / 86_400_000;
    expect(res.body.service.maxHorizonDays).toBeGreaterThan(daysAway);
  });

  it('is an owner or admin decision', async () => {
    const instructor = await addMemberToStudio(app, studio.organizationId, 'INSTRUCTOR');
    const res = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(instructor.headers)
      .send(event());

    expect(res.status).toBe(403);
  });
});

describe('publishing a class', () => {
  it('creates a CLASS with a cohort on sale and every session, in order', async () => {
    const staffId = await addStaff();
    const res = await request(app)
      .post(`${studio.base}/activities/classes`)
      .set(studio.headers)
      .send(klass({ staffId, skipDates: ['2027-03-16'] }));

    expect(res.status).toBe(201);
    expect(res.body.service.kind).toBe('CLASS');
    expect(res.body.service.bookingMode).toBe('COURSE_SERIES');
    expect(res.body.series.status).toBe('PUBLISHED');
    expect(res.body.series.sessionCount).toBe(4);
    expect(res.body.series.capacity).toBe(8);
    expect(res.body.series.staffId).toBe(staffId);

    expect(res.body.sessions.map((s: { localDate: string }) => s.localDate)).toEqual([
      '2027-03-02',
      '2027-03-09',
      '2027-03-23',
      '2027-03-30',
    ]);
    expect(res.body.skipped).toEqual(['2027-03-16']);
    expect(res.body.endDate).toBe('2027-03-30');

    // 6pm local either side of the 14 March change: 23:00Z, then 22:00Z.
    expect(res.body.sessions[1].startsAt).toBe('2027-03-09T23:00:00.000Z');
    expect(res.body.sessions[2].startsAt).toBe('2027-03-23T22:00:00.000Z');

    // The instructor's time is taken on every date.
    const blocks = await prisma.staffTimeBlock.count({ where: { staffId } });
    expect(blocks).toBe(4);
  });

  it('creates nothing at all when the instructor is busy on one date', async () => {
    const staffId = await addStaff();
    const busy = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send(event({ date: '2027-03-09', startTime: '17:00', endTime: '19:00', staffId }));
    expect(busy.status).toBe(201);

    const res = await request(app)
      .post(`${studio.base}/activities/classes`)
      .set(studio.headers)
      .send(klass({ staffId }));

    expect(res.status).toBe(409);
    expect(
      await prisma.serviceType.count({
        where: { organizationId: studio.organizationId, kind: 'CLASS' },
      }),
    ).toBe(0);
    expect(await prisma.courseSeries.count()).toBe(0);
  });

  it('needs the plan that includes multi-week courses', async () => {
    const solo = await signUpStudio(app, { plan: 'SOLO' });
    const res = await request(app)
      .post(`${solo.base}/activities/classes`)
      .set(solo.headers)
      .send(klass());

    expect(res.status).toBe(402);
  });

  it('refuses a class whose first session has passed', async () => {
    const res = await request(app)
      .post(`${studio.base}/activities/classes`)
      .set(studio.headers)
      .send(klass({ startDate: '2020-03-02' }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DATE_IN_PAST');
  });
});

describe('where and who', () => {
  it("uses the studio's only location without asking", async () => {
    const locationId = await addLocation('Main studio');
    const res = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send(event());

    expect(res.status).toBe(201);
    expect(res.body.session.locationId).toBe(locationId);
  });

  it('uses the only building when the other location is a service area', async () => {
    const building = await addLocation('Main studio');
    await prisma.location.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Party van',
        locationType: 'SERVICE_AREA',
      },
    });

    const res = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send(event());

    expect(res.status).toBe(201);
    expect(res.body.session.locationId).toBe(building);
  });

  it('asks which location when the studio has several', async () => {
    await addLocation('Main studio');
    const annex = await addLocation('Annex');

    const missing = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send(event());
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('LOCATION_REQUIRED');

    const chosen = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send(event({ locationId: annex }));
    expect(chosen.status).toBe(201);
    expect(chosen.body.session.locationId).toBe(annex);
  });

  it("refuses another studio's instructor", async () => {
    const other = await signUpStudio(app);
    const theirs = await request(app)
      .post(`${other.base}/staff`)
      .set(other.headers)
      .send({ name: 'Not Yours', email: 'notyours@clay.test' });

    const res = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send(event({ staffId: theirs.body.staff.id }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STAFF_NOT_FOUND');
  });
});

describe('drafts', () => {
  it('saves, updates, lists and deletes a draft', async () => {
    const created = await request(app)
      .post(`${studio.base}/activities/drafts`)
      .set(studio.headers)
      .send({ kind: 'CLASS', data: { name: 'Beginner Wheel' } });
    expect(created.status).toBe(201);
    const id = created.body.draft.id;

    const updated = await request(app)
      .put(`${studio.base}/activities/drafts/${id}`)
      .set(studio.headers)
      .send({ data: { name: 'Beginner Wheel', seats: 8 } });
    expect(updated.status).toBe(200);
    expect(updated.body.draft.data).toEqual({ name: 'Beginner Wheel', seats: 8 });

    const list = await request(app).get(`${studio.base}/activities/drafts`).set(studio.headers);
    expect(list.body.drafts).toHaveLength(1);

    const removed = await request(app)
      .delete(`${studio.base}/activities/drafts/${id}`)
      .set(studio.headers);
    expect(removed.status).toBe(204);
  });

  it('is deleted when it is published', async () => {
    const draft = await request(app)
      .post(`${studio.base}/activities/drafts`)
      .set(studio.headers)
      .send({ kind: 'EVENT', data: {} });

    const res = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send(event({ draftId: draft.body.draft.id }));

    expect(res.status).toBe(201);
    expect(await prisma.activityDraft.count()).toBe(0);
  });

  it("cannot reach another studio's draft", async () => {
    const other = await signUpStudio(app);
    const theirs = await request(app)
      .post(`${other.base}/activities/drafts`)
      .set(other.headers)
      .send({ kind: 'EVENT', data: { name: 'Theirs' } });

    const update = await request(app)
      .put(`${studio.base}/activities/drafts/${theirs.body.draft.id}`)
      .set(studio.headers)
      .send({ data: { name: 'Mine now' } });
    expect(update.status).toBe(404);

    const publish = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send(event({ draftId: theirs.body.draft.id }));
    expect(publish.status).toBe(404);
    expect(await prisma.activityDraft.count()).toBe(1);
  });
});

describe('past', () => {
  it('is worked out from the dates: live until the last one ends', async () => {
    const res = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send(event());
    const id = res.body.service.id;

    const listed = async () => {
      const list = await request(app).get(`${studio.base}/services`).set(studio.headers);
      return list.body.services.find((s: { id: string }) => s.id === id);
    };

    expect((await listed()).lifecycle).toBe('LIVE');

    await prisma.session.updateMany({
      where: { serviceTypeId: id },
      data: {
        startsAt: new Date('2025-02-12T23:30:00Z'),
        endsAt: new Date('2025-02-13T02:00:00Z'),
      },
    });

    const past = await listed();
    expect(past.lifecycle).toBe('PAST');
    expect(past.lastEndsAt).toBe('2025-02-13T02:00:00.000Z');
  });

  it('counts a class as bookable until its first session starts', async () => {
    const res = await request(app)
      .post(`${studio.base}/activities/classes`)
      .set(studio.headers)
      .send(klass());
    const id = res.body.service.id;

    const readiness = async () => {
      const list = await request(app)
        .get(`${studio.base}/services?withReadiness=true`)
        .set(studio.headers);
      return list.body.services.find((s: { id: string }) => s.id === id).readiness;
    };

    expect(await readiness()).toEqual({ bookable: true, problem: null });

    // Move the first session into the past: booking closed when it began.
    const first = await prisma.session.findFirstOrThrow({
      where: { serviceTypeId: id, seriesIndex: 1 },
    });
    await prisma.session.update({
      where: { id: first.id },
      data: {
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() - 1_800_000),
      },
    });

    expect(await readiness()).toEqual({ bookable: false, problem: 'STARTED' });
  });

  it('never calls an activity with no dates past', async () => {
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Private Lesson',
        bookingMode: 'APPOINTMENT',
        durationMinutes: 60,
        slotGranularityMinutes: 30,
        capacityMin: 1,
        capacityMax: 1,
        priceCents: 9000,
      });

    const list = await request(app).get(`${studio.base}/services`).set(studio.headers);
    const lesson = list.body.services.find((s: { id: string }) => s.id === res.body.service.id);
    expect(lesson.kind).toBe('OLDER');
    expect(lesson.lifecycle).toBe('LIVE');
  });
});
