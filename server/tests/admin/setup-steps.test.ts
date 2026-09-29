import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';

/**
 * The setup checklist says what each step waits for
 * (docs/ux-audit-findings.md #9).
 *
 * "Name your studio" was only ticked once the studio also had a location,
 * and said nothing about one — so a studio named at signup sat there unticked
 * with no way to tell what was missing.
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
  studio = await signUpStudio(app, { organizationName: 'Harbour Kayak Tours' });
});

const steps = async () =>
  (await request(app).get(`${studio.base}/onboarding`).set(studio.headers).expect(200)).body
    .steps as { id: string; title: string; done: boolean }[];

const step = async (id: string) => (await steps()).find((s) => s.id === id)!;

describe('naming the studio and adding its location', () => {
  it('ticks the name as soon as there is one, and asks for the location separately', async () => {
    expect((await step('studio')).done).toBe(true);
    expect(await step('location')).toMatchObject({ title: 'Add your location', done: false });
  });

  it('ticks the location once there is one', async () => {
    await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({ name: 'The boathouse' })
      .expect(201);

    expect((await step('location')).done).toBe(true);
  });

  it('names the missing location when publishing is refused', async () => {
    const res = await request(app)
      .post(`${studio.base}/onboarding/publish`)
      .set(studio.headers)
      .expect(400);

    expect(res.body.error.message).toContain('Add your location');
    expect(res.body.error.message).not.toContain('Name your studio');
  });

  it('is not ready while nothing can be booked, even with every step ticked', async () => {
    // Every step's condition met: a name, a location, a class, somebody with hours.
    await request(app).post(`${studio.base}/locations`).set(studio.headers).send({ name: 'The boathouse' }).expect(201);
    const classId = (
      await request(app)
        .post(`${studio.base}/services`)
        .set(studio.headers)
        .send({ name: 'Sunset kayak tour', bookingMode: 'EVENT', durationMinutes: 120, capacityMax: 10 })
        .expect(201)
    ).body.service.id;
    const staffId = (
      await request(app)
        .post(`${studio.base}/staff`)
        .set(studio.headers)
        .send({ name: 'Rowan Pike', email: 'rowan@clay.test' })
        .expect(201)
    ).body.staff.id;
    await prisma.availabilityRule.create({
      data: {
        organizationId: studio.organizationId,
        staffId,
        rrule: 'FREQ=WEEKLY;BYDAY=SA',
        startMinute: 600,
        endMinute: 1080,
        timezone: 'Europe/London',
        effectiveFrom: new Date(),
      },
    });

    // ...but the class has no dates, so the booking page has nothing to sell.
    const before = (await request(app).get(`${studio.base}/onboarding`).set(studio.headers).expect(200)).body;
    expect(before.steps.filter((s: { done: boolean; optional: boolean; id: string }) => !s.done && !s.optional && s.id !== 'publish')).toEqual([]);
    expect(before.readyToPublish).toBe(false);
    expect(before.bookable).toEqual({
      count: 0,
      stuck: [{ id: classId, name: 'Sunset kayak tour', problem: 'NO_DATES' }],
    });

    const refused = await request(app).post(`${studio.base}/onboarding/publish`).set(studio.headers).expect(400);
    expect(refused.body.error.message).toContain('an activity customers can book');

    // A date makes it ready.
    await request(app)
      .post(`${studio.base}/sessions`)
      .set(studio.headers)
      .send({
        serviceTypeId: classId,
        startLocalDate: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
        localStartTime: '17:00',
        capacity: 10,
      })
      .expect(201);

    const after = (await request(app).get(`${studio.base}/onboarding`).set(studio.headers).expect(200)).body;
    expect(after.readyToPublish).toBe(true);
    expect(after.bookable).toEqual({ count: 1, stuck: [] });
  });

  it('is not done while a One to one instructor has no hours, and says who (#3)', async () => {
    const addStaff = async (name: string, email: string) =>
      (
        await request(app)
          .post(`${studio.base}/staff`)
          .set(studio.headers)
          .send({ name, email })
          .expect(201)
      ).body.staff.id as string;
    const hours = (staffId: string) =>
      prisma.availabilityRule.create({
        data: {
          organizationId: studio.organizationId,
          staffId,
          rrule: 'FREQ=WEEKLY;BYDAY=SA',
          startMinute: 600,
          endMinute: 1080,
          timezone: 'Europe/London',
          effectiveFrom: new Date(),
        },
      });

    const rowan = await addStaff('Rowan Pike', 'rowan@clay.test');
    await hours(rowan);
    const sam = await addStaff('Sam Ortega', 'sam@clay.test');
    const lesson = (
      await request(app)
        .post(`${studio.base}/services`)
        .set(studio.headers)
        .send({ name: 'Private lesson', bookingMode: 'APPOINTMENT', durationMinutes: 60 })
        .expect(201)
    ).body.service.id;
    await request(app).put(`${studio.base}/services/${lesson}/staff`).set(studio.headers).send({ staffIds: [sam] }).expect(200);

    // Somebody has hours — which used to be enough — but not the one who teaches it.
    const before = await step('hours');
    expect(before.done).toBe(false);
    expect((before as unknown as { description: string }).description).toContain('Sam Ortega');

    await hours(sam);
    expect((await step('hours')).done).toBe(true);
  });

  it('keeps the order a studio meets them in', async () => {
    expect((await steps()).map((s) => s.id)).toEqual([
      'studio',
      'location',
      'service',
      'hours',
      'payments',
      'publish',
    ]);
  });
});
