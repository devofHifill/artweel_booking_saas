import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { processBatch } from '../../src/modules/notifications/worker';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';

/**
 * Sending a failed message again.
 *
 * The assertion that matters is not that the row changed — it is that the
 * WORKER then picks it up. The worker claims rows with
 * `attempts < NOTIFICATION_MAX_ATTEMPTS`, so a retry that only flipped the
 * status back to PENDING would leave an exhausted row untouchable: the button
 * reports success, the row visibly changes, and nothing is ever sent. Nothing
 * errors, so nothing tells anybody.
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

async function makeNotification(opts: {
  status: 'FAILED' | 'PENDING' | 'SENT';
  attempts?: number;
}) {
  return prisma.notification.create({
    data: {
      organizationId: studio.organizationId,
      channel: 'EMAIL',
      templateKey: 'BOOKING_CONFIRMATION',
      destination: `someone-${randomBytes(3).toString('hex')}@example.test`,
      payload: { studioName: 'Clay & Co' },
      status: opts.status,
      attempts: opts.attempts ?? 0,
      lastError: opts.status === 'FAILED' ? 'mailbox unavailable' : null,
      scheduledFor: new Date(Date.now() - 60_000),
      dedupeKey: `retry-${randomBytes(8).toString('hex')}`,
    },
  });
}

describe('retrying a failed message', () => {
  it('queues it again and clears the error', async () => {
    const row = await makeNotification({ status: 'FAILED', attempts: 5 });

    const res = await request(app)
      .post(`${studio.base}/notifications/${row.id}/retry`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.notification.status).toBe('PENDING');

    const after = await prisma.notification.findUniqueOrThrow({
      where: { id: row.id },
      select: { attempts: true, lastError: true },
    });
    expect(after.lastError).toBeNull();
  });

  /**
   * The load-bearing one.
   *
   * Five attempts is the exhausted state. Without resetting the counter the
   * worker's claim query skips the row forever, and the retry silently does
   * nothing at all.
   */
  it('is actually picked up by the worker afterwards', async () => {
    const row = await makeNotification({ status: 'FAILED', attempts: 5 });

    await request(app)
      .post(`${studio.base}/notifications/${row.id}/retry`)
      .set(studio.headers)
      .expect(200);

    await processBatch();

    const after = await prisma.notification.findUniqueOrThrow({
      where: { id: row.id },
      select: { status: true },
    });
    expect(after.status).toBe('SENT');
  });

  it('refuses a message that already went out', async () => {
    const row = await makeNotification({ status: 'SENT' });

    const res = await request(app)
      .post(`${studio.base}/notifications/${row.id}/retry`)
      .set(studio.headers)
      .expect(400);

    expect(res.body.error?.code ?? res.body.code).toBe('NOT_RETRYABLE');
  });

  /** Retrying a pending row would reset a backoff that is working correctly. */
  it('refuses one that is still waiting its turn', async () => {
    const row = await makeNotification({ status: 'PENDING', attempts: 2 });

    await request(app)
      .post(`${studio.base}/notifications/${row.id}/retry`)
      .set(studio.headers)
      .expect(400);
  });

  it('is refused to an instructor — it sends a customer a message', async () => {
    const row = await makeNotification({ status: 'FAILED', attempts: 5 });
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    await request(app)
      .post(`${studio.base}/notifications/${row.id}/retry`)
      .set(instructor.headers)
      .expect(403);
  });

  it('cannot reach into another studio', async () => {
    const other = await signUpStudio(app);
    const row = await makeNotification({ status: 'FAILED', attempts: 5 });

    await request(app)
      .post(`${other.base}/notifications/${row.id}/retry`)
      .set(other.headers)
      .expect(404);
  });
});
