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

/* ----------------------------------------------------------------- D10 ---
   The figures over the log, its tab counts, and testing a template on
   yourself.
   ------------------------------------------------------------------------ */

async function withStatus(
  status: 'SENT' | 'FAILED' | 'PENDING' | 'SKIPPED' | 'CANCELLED',
  opts: { channel?: 'EMAIL' | 'SMS'; createdAt?: Date } = {},
) {
  return prisma.notification.create({
    data: {
      organizationId: studio.organizationId,
      channel: opts.channel ?? 'EMAIL',
      templateKey: 'booking.confirmed',
      destination: `someone-${randomBytes(3).toString('hex')}@example.test`,
      payload: { body: 'hello' },
      status,
      scheduledFor: new Date(Date.now() - 60_000),
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      dedupeKey: `d10-${randomBytes(8).toString('hex')}`,
    },
  });
}

describe('the figures over the log', () => {
  /**
   * A message held because somebody replied STOP is a rule working, not a
   * delivery that failed. Counting the two together would make TCPA
   * compliance read as an outage and push a studio to "fix" it.
   */
  it('leaves skipped messages out of the delivery rate', async () => {
    await withStatus('SENT');
    await withStatus('SENT');
    await withStatus('SENT');
    await withStatus('FAILED');
    await withStatus('SKIPPED');
    await withStatus('SKIPPED');

    const res = await request(app)
      .get(`${studio.base}/notifications/stats`)
      .set(studio.headers)
      .expect(200);

    // 3 of 4 attempted, not 3 of 6.
    expect(res.body.totals.deliveryRate).toBe(75);
    expect(res.body.totals.skipped).toBe(2);
  });

  it('reports no rate at all rather than a hopeful zero', async () => {
    const res = await request(app)
      .get(`${studio.base}/notifications/stats`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.totals.deliveryRate).toBeNull();
    expect(res.body.totals.sent).toBe(0);
  });

  it('splits the rate by channel', async () => {
    await withStatus('SENT', { channel: 'EMAIL' });
    await withStatus('SENT', { channel: 'SMS' });
    await withStatus('FAILED', { channel: 'SMS' });

    const res = await request(app)
      .get(`${studio.base}/notifications/stats`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.channels.email.deliveryRate).toBe(100);
    expect(res.body.channels.sms.deliveryRate).toBe(50);
  });

  it('covers thirty days and not the whole history', async () => {
    await withStatus('SENT');
    await withStatus('SENT', { createdAt: new Date(Date.now() - 60 * 86_400_000) });

    const res = await request(app)
      .get(`${studio.base}/notifications/stats`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.totals.sent).toBe(1);
  });

  it('never counts another studio', async () => {
    const other = await signUpStudio(app);
    await prisma.notification.create({
      data: {
        organizationId: other.organizationId,
        channel: 'EMAIL',
        templateKey: 'booking.confirmed',
        destination: 'theirs@example.test',
        payload: {},
        status: 'SENT',
        scheduledFor: new Date(),
        dedupeKey: `other-${randomBytes(8).toString('hex')}`,
      },
    });

    const res = await request(app)
      .get(`${studio.base}/notifications/stats`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.totals.sent).toBe(0);
  });
});

describe('the log tab counts', () => {
  it('keeps every count while one status is selected', async () => {
    await withStatus('SENT');
    await withStatus('FAILED');
    await withStatus('SKIPPED');

    const res = await request(app)
      .get(`${studio.base}/notifications?status=FAILED`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.counts).toMatchObject({
      total: 3,
      SENT: 1,
      FAILED: 1,
      SKIPPED: 1,
    });
  });

  it('reports only the statuses that have rows, so the screen can print a 0', async () => {
    await withStatus('SENT');

    const res = await request(app)
      .get(`${studio.base}/notifications`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.counts.total).toBe(1);
    expect(res.body.counts.CANCELLED).toBeUndefined();
  });
});

describe('sending yourself a test', () => {
  /**
   * The destination is the caller's own address and there is no field to
   * change it. An endpoint behind a studio login that sends studio-authored
   * text to an arbitrary address is a spam relay, and the first person to
   * notice would be the provider suspending the number everyone shares.
   */
  it('goes to the person who asked for it, and takes no recipient', async () => {
    const res = await request(app)
      .post(`${studio.base}/notifications/templates/test`)
      .set(studio.headers)
      .send({
        templateKey: 'booking.confirmed',
        channel: 'EMAIL',
        subject: 'Your class is booked',
        body: 'Hello {{customerName}}, see you at {{serviceName}}.',
        // Ignored: there is no such field on the schema.
        to: 'somebody-else@example.test',
      })
      .expect(202);

    expect(res.body.destination).toBe(studio.email);

    const row = await prisma.notification.findFirst({
      where: { organizationId: studio.organizationId },
      orderBy: { createdAt: 'desc' },
    });

    expect(row?.destination).toBe(studio.email);
    expect(row?.bookingId).toBeNull();
    expect(row?.customerId).toBeNull();
  });

  it('renders the tokens rather than sending braces to a human', async () => {
    await request(app)
      .post(`${studio.base}/notifications/templates/test`)
      .set(studio.headers)
      .send({
        templateKey: 'booking.confirmed',
        channel: 'EMAIL',
        subject: 'Booked',
        body: 'Hello {{customerName}}.',
      })
      .expect(202);

    const row = await prisma.notification.findFirst({
      where: { organizationId: studio.organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const payload = row?.payload as { subject: string; body: string };
    expect(payload.body).toContain('Ada Potter');
    expect(payload.body).not.toContain('{{');
    // Marked, so nobody mistakes it for a message a customer received.
    expect(payload.subject.startsWith('[test]')).toBe(true);
  });

  /** Somebody fixes a typo and sends again immediately; a dedupe key that
      collapsed the second attempt would look exactly like a failure. */
  it('can be sent twice in a row', async () => {
    for (let i = 0; i < 2; i++) {
      await request(app)
        .post(`${studio.base}/notifications/templates/test`)
        .set(studio.headers)
        .send({
          templateKey: 'booking.confirmed',
          channel: 'EMAIL',
          subject: 'Booked',
          body: 'Hello.',
        })
        .expect(202);
    }

    const count = await prisma.notification.count({
      where: { organizationId: studio.organizationId },
    });
    expect(count).toBe(2);
  });

  /** A text needs a number, and the message says which field to fill. */
  it('refuses a text message when the caller has no mobile on file', async () => {
    const res = await request(app)
      .post(`${studio.base}/notifications/templates/test`)
      .set(studio.headers)
      .send({
        templateKey: 'booking.confirmed',
        channel: 'SMS',
        body: 'See you at {{serviceName}}.',
      })
      .expect(400);

    expect(res.body.code ?? res.body.error?.code).toBe('NO_TEST_NUMBER');
  });

  /** The log must never let a test pass for a message a customer received. */
  it('is marked as a test in the delivery log', async () => {
    await request(app)
      .post(`${studio.base}/notifications/templates/test`)
      .set(studio.headers)
      .send({
        templateKey: 'booking.confirmed',
        channel: 'EMAIL',
        subject: 'Booked',
        body: 'Hello.',
      })
      .expect(202);

    const res = await request(app)
      .get(`${studio.base}/notifications`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.notifications[0].isTest).toBe(true);
  });

  /**
   * The rendered message — a customer's name, their class, sometimes their
   * address — has no business in a list that only draws rows.
   */
  it('keeps the rendered payload out of the log listing', async () => {
    await withStatus('SENT');

    const res = await request(app)
      .get(`${studio.base}/notifications`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.notifications[0]).not.toHaveProperty('payload');
    expect(res.body.notifications[0].isTest).toBe(false);
  });

  it('is refused to front desk — it sends a real message', async () => {
    const desk = await addMemberToStudio(app, studio.organizationId, 'FRONT_DESK');

    await request(app)
      .post(`${studio.base}/notifications/templates/test`)
      .set(desk.headers)
      .send({
        templateKey: 'booking.confirmed',
        channel: 'EMAIL',
        subject: 'Booked',
        body: 'Hello.',
      })
      .expect(403);
  });
});
