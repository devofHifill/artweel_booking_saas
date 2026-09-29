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
