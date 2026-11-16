import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * Publishing from a draft that was discarded meanwhile — from Activities in
 * another tab while the steps were still open. The answers being published
 * are all in the request, so the save goes ahead; it used to fail with
 * "Draft not found" and lose nothing but the studio's patience.
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
  priceCents: 0,
  ...overrides,
});

async function draft(kind: 'CLASS' | 'EVENT', on: Studio = studio) {
  const res = await request(app)
    .post(`${on.base}/activities/drafts`)
    .set(on.headers)
    .send({ kind, data: { name: 'Draft' } });
  expect(res.status).toBe(201);
  return res.body.draft.id as string;
}

async function discard(id: string) {
  await request(app).delete(`${studio.base}/activities/drafts/${id}`).set(studio.headers).expect(204);
}

describe('publishing from a discarded draft', () => {
  it('a Class still publishes', async () => {
    const id = await draft('CLASS');
    await discard(id);
    const res = await request(app)
      .post(`${studio.base}/activities/classes`)
      .set(studio.headers)
      .send(klass({ draftId: id }));
    expect(res.status).toBe(201);
  });

  it('an Event still publishes', async () => {
    const id = await draft('EVENT');
    await discard(id);
    const res = await request(app)
      .post(`${studio.base}/activities/events`)
      .set(studio.headers)
      .send({
        name: 'Date Night',
        date: '2027-02-12',
        startTime: '18:30',
        endTime: '21:00',
        seats: 12,
        priceCents: 0,
        draftId: id,
      });
    expect(res.status).toBe(201);
  });

  it('a draft that is still there is deleted, as before', async () => {
    const id = await draft('CLASS');
    await request(app)
      .post(`${studio.base}/activities/classes`)
      .set(studio.headers)
      .send(klass({ draftId: id }))
      .expect(201);
    expect(await prisma.activityDraft.count({ where: { id } })).toBe(0);
  });

  it('another studio’s draft id deletes nothing', async () => {
    const other = await signUpStudio(app, { organizationName: 'Other Studio', email: 'other@clay.test' });
    const theirs = await draft('CLASS', other);
    await request(app)
      .post(`${studio.base}/activities/classes`)
      .set(studio.headers)
      .send(klass({ draftId: theirs }))
      .expect(201);
    expect(await prisma.activityDraft.count({ where: { id: theirs } })).toBe(1);
  });
});
