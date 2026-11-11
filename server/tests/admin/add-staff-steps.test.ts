import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * Add staff in steps (docs/STAFF-STEPS-PLAN.md).
 *
 * Adding someone used to save a person who could not be booked: what they
 * teach and their hours were separate calls afterwards, so a studio that
 * stopped half-way had an instructor badged "No hours set". The steps send
 * both with the person, and they are saved together or not at all.
 */

const app = createApp();
let studio: Studio;
let serviceId: string;

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

  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Beginner Wheel Throwing',
      bookingMode: 'EVENT',
      durationMinutes: 180,
      capacityMax: 8,
      priceCents: 9500,
    });
  serviceId = service.body.service.id;
});

const person = {
  name: 'Rowan Pike',
  email: 'rowan@clay.test',
  role: 'Wheel instructor',
};

const everyDay = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const add = (body: Record<string, unknown>) =>
  request(app).post(`${studio.base}/staff`).set(studio.headers).send(body);

const nothingSaved = async () => {
  expect(await prisma.staff.count({ where: { email: person.email } })).toBe(0);
  expect(await prisma.availabilityRule.count()).toBe(0);
  expect(await prisma.staffService.count()).toBe(0);
};

describe('adding someone with what they teach and their hours', () => {
  it('saves both with the person, so they can be booked straight away', async () => {
    const res = await add({
      ...person,
      serviceTypeIds: [serviceId],
      weeklyHours: { days: everyDay, startMinute: 0, endMinute: 1440 },
    });
    expect(res.status).toBe(201);
    const staffId = res.body.staff.id;

    const teaches = await prisma.staffService.findMany({ where: { staffId } });
    expect(teaches.map((t) => t.serviceTypeId)).toEqual([serviceId]);

    const rules = await prisma.availabilityRule.findMany({ where: { staffId } });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      ruleType: 'WORKING',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU',
      startMinute: 0,
      endMinute: 1440,
      timezone: res.body.staff.timezone,
    });

    const list = await request(app).get(`${studio.base}/staff`).set(studio.headers);
    const row = list.body.staff.find((s: { id: string }) => s.id === staffId);
    expect(row.availability).not.toBe('NO_HOURS');
  });

  it('still adds someone from the old one-call form, with no hours', async () => {
    const res = await add(person);
    expect(res.status).toBe(201);
    expect(await prisma.availabilityRule.count()).toBe(0);

    const list = await request(app).get(`${studio.base}/staff`).set(studio.headers);
    expect(list.body.staff[0].availability).toBe('NO_HOURS');
  });

  it('keeps a bio', async () => {
    const res = await add({ ...person, bio: 'Twenty years at the wheel.' });
    expect(res.status).toBe(201);
    expect(res.body.staff.bio).toBe('Twenty years at the wheel.');
  });
});

describe('nothing is half-made', () => {
  it("refuses another studio's activity and saves nothing", async () => {
    const other = await signUpStudio(app);
    const theirs = await request(app)
      .post(`${other.base}/services`)
      .set(other.headers)
      .send({ name: 'Theirs', bookingMode: 'EVENT', durationMinutes: 60, capacityMax: 4, priceCents: 1000 });

    const res = await add({
      ...person,
      serviceTypeIds: [theirs.body.service.id],
      weeklyHours: { days: ['TU'], startMinute: 600, endMinute: 1080 },
    });

    expect(res.status).toBe(400);
    await nothingSaved();
  });

  it('refuses hours that end before they start, and saves nothing', async () => {
    const res = await add({
      ...person,
      weeklyHours: { days: ['TU'], startMinute: 1080, endMinute: 600 },
    });

    expect(res.status).toBe(422);
    await nothingSaved();
  });

  it('refuses hours with no days, and saves nothing', async () => {
    const res = await add({
      ...person,
      weeklyHours: { days: [], startMinute: 600, endMinute: 1080 },
    });

    expect(res.status).toBe(422);
    await nothingSaved();
  });

  it('still applies the plan limit before anything is written', async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { plan: 'SOLO' },
    });
    await add({ name: 'First', email: 'first@clay.test' });

    const res = await add({
      ...person,
      serviceTypeIds: [serviceId],
      weeklyHours: { days: ['TU'], startMinute: 600, endMinute: 1080 },
    });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');
    await nothingSaved();
  });
});
