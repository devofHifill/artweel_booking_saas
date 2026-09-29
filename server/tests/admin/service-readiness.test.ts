import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';

/**
 * "Can customers book this, and if not, why not?" — per activity.
 *
 * The catalogue's only warning was "No instructor assigned", which was true of
 * group classes that were selling fine (a group class is booked from its dates
 * and never asks "who with?") and silent about why One to one lessons really
 * failed. Its headline figure, "Bookable right now", counted every activity
 * that was switched on. Found walking a new studio through the app
 * (docs/ux-audit-findings.md #6, #7).
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
  studio = await signUpStudio(app, { timezone: 'Europe/London' });
  slug = (
    await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
      select: { slug: true },
    })
  ).slug;
});

const localDate = (daysAhead: number) =>
  new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);

async function createService(body: Record<string, unknown>) {
  const res = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send(body)
    .expect(201);
  return res.body.service.id as string;
}

const groupClass = () =>
  createService({
    name: 'Sunset kayak tour',
    bookingMode: 'EVENT',
    durationMinutes: 120,
    capacityMin: 1,
    capacityMax: 10,
    priceCents: 4500,
  });

const oneToOne = () =>
  createService({ name: 'Private lesson', bookingMode: 'APPOINTMENT', durationMinutes: 60 });

async function readiness(serviceId: string) {
  const res = await request(app)
    .get(`${studio.base}/services`)
    .query({ includeInactive: 'true', withReadiness: 'true' })
    .set(studio.headers)
    .expect(200);
  return res.body.services.find((s: { id: string }) => s.id === serviceId).readiness as {
    bookable: boolean;
    problem: string | null;
  };
}

async function addStaff(email = 'rowan@clay.test') {
  const res = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name: 'Rowan Pike', email })
    .expect(201);
  return res.body.staff.id as string;
}

const teaches = (serviceId: string, staffIds: string[]) =>
  request(app)
    .put(`${studio.base}/services/${serviceId}/staff`)
    .set(studio.headers)
    .send({ staffIds })
    .expect(200);

const giveHours = (staffId: string) =>
  prisma.availabilityRule.create({
    data: {
      organizationId: studio.organizationId,
      staffId,
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU',
      startMinute: 9 * 60,
      endMinute: 18 * 60,
      timezone: 'Europe/London',
      effectiveFrom: new Date(Date.now() - 86_400_000),
    },
  });

async function scheduleClass(serviceId: string, daysAhead = 10) {
  await request(app)
    .post(`${studio.base}/sessions`)
    .set(studio.headers)
    .send({
      serviceTypeId: serviceId,
      startLocalDate: localDate(daysAhead),
      localStartTime: '17:00',
      capacity: 10,
    })
    .expect(201);
}

describe('a group class', () => {
  it('is not bookable with no dates', async () => {
    const id = await groupClass();
    expect(await readiness(id)).toEqual({ bookable: false, problem: 'NO_DATES' });
  });

  it('is bookable with an upcoming date — and needs no instructor for it', async () => {
    const id = await groupClass();
    await scheduleClass(id);

    expect(await readiness(id)).toEqual({ bookable: true, problem: null });
  });

  it('does not count a date further ahead than it takes bookings', async () => {
    const id = await groupClass();
    await prisma.serviceType.update({ where: { id }, data: { maxHorizonDays: 7 } });
    await scheduleClass(id, 20);

    expect((await readiness(id)).problem).toBe('NO_DATES');
  });

  it('does not count a date the booking page hides for having no location', async () => {
    const id = await groupClass();
    await request(app).post(`${studio.base}/locations`).set(studio.headers).send({ name: 'A' }).expect(201);
    await request(app).post(`${studio.base}/locations`).set(studio.headers).send({ name: 'B' }).expect(201);
    await scheduleClass(id); // two locations: left unplaced, so hidden

    expect((await readiness(id)).problem).toBe('NO_DATES');
  });
});

describe('a One to one activity', () => {
  it('needs somebody who teaches it', async () => {
    const id = await oneToOne();
    expect((await readiness(id)).problem).toBe('NO_INSTRUCTOR');
  });

  it('needs that somebody to have working hours', async () => {
    const id = await oneToOne();
    await teaches(id, [await addStaff()]);

    expect((await readiness(id)).problem).toBe('NO_HOURS');
  });

  it('needs them to work where it runs, once there are locations', async () => {
    const id = await oneToOne();
    const staffId = await addStaff();
    await teaches(id, [staffId]);
    await giveHours(staffId);
    // The location arrives after the person, then they are taken off it.
    await request(app).post(`${studio.base}/locations`).set(studio.headers).send({ name: 'The studio' }).expect(201);
    await request(app)
      .put(`${studio.base}/staff/${staffId}/locations`)
      .set(studio.headers)
      .send({ locationIds: [] })
      .expect(200);

    expect((await readiness(id)).problem).toBe('NO_LOCATION');
  });

  it('is bookable when all three hold — and the booking page agrees', async () => {
    const id = await oneToOne();
    const staffId = await addStaff();
    await teaches(id, [staffId]);
    await giveHours(staffId);

    expect(await readiness(id)).toEqual({ bookable: true, problem: null });

    const times = await request(app)
      .get(`/public/${slug}/availability`)
      .query({ serviceTypeId: id, from: localDate(2), to: localDate(9) })
      .expect(200);
    expect(times.body.slots.length).toBeGreaterThan(0);
  });

  it('ignores a deactivated instructor', async () => {
    const id = await oneToOne();
    const staffId = await addStaff();
    await teaches(id, [staffId]);
    await giveHours(staffId);
    await prisma.staff.update({ where: { id: staffId }, data: { isActive: false } });

    expect((await readiness(id)).problem).toBe('NO_INSTRUCTOR');
  });
});

describe('the list', () => {
  it('reports a switched-off activity as neither bookable nor a problem', async () => {
    const id = await groupClass();
    await prisma.serviceType.update({ where: { id }, data: { isActive: false } });

    expect(await readiness(id)).toEqual({ bookable: false, problem: null });
  });

  it('only works it out when asked', async () => {
    const id = await groupClass();
    const res = await request(app)
      .get(`${studio.base}/services`)
      .set(studio.headers)
      .expect(200);

    const svc = res.body.services.find((s: { id: string }) => s.id === id);
    expect(svc.readiness).toBeUndefined();
    // The picker's current set comes back either way.
    expect(svc.staffServices).toEqual([]);
  });
});
