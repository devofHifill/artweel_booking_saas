import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';

/**
 * W2.3 + W2.4 — piece tracking and kiln firings.
 *
 * The lifecycle modelled here is an assumption and is expected to change once
 * studios have been asked. What these tests defend is not the lifecycle but
 * the things that must hold whatever it turns out to be:
 *
 *   a piece cannot skip states, two firings cannot claim one kiln, completing
 *   a glaze load tells its owners exactly once, and cancelling a firing gives
 *   both the kiln and the work back.
 *
 * The last test in this file is the firing half of the Phase 2 exit gate.
 */

const app = createApp();
let studio: Studio;
let kilnId: string;
let customerId: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  studio = await signUpStudio(app);

  const kiln = await request(app)
    .post(`${studio.base}/resources`)
    .set(studio.headers)
    .send({
      name: 'Skutt KM-1027',
      resourceType: 'KILN',
      quantity: 1,
      isExclusive: true,
    });
  kilnId = kiln.body.resource.id;

  const customer = await prisma.customer.create({
    data: {
      organizationId: studio.organizationId,
      name: 'Ana Vidal',
      email: 'ana@student.test',
      phone: '+15550100',
      smsConsentAt: new Date(),
    },
  });
  customerId = customer.id;
});

async function makePiece(label = 'Ana mug') {
  const res = await request(app)
    .post(`${studio.base}/pieces`)
    .set(studio.headers)
    .send({ customerId, label, shelfLocation: 'B3' });
  expect(res.status).toBe(201);
  return res.body.piece.id as string;
}

function setStatus(pieceId: string, status: string) {
  return request(app)
    .post(`${studio.base}/pieces/${pieceId}/status`)
    .set(studio.headers)
    .send({ status });
}

function scheduleFiring(
  firingType: 'BISQUE' | 'GLAZE',
  startsAt = '2026-09-10T08:00:00Z',
  endsAt = '2026-09-11T08:00:00Z',
) {
  return request(app)
    .post(`${studio.base}/firings`)
    .set(studio.headers)
    .send({ resourceId: kilnId, firingType, startsAt, endsAt, cone: '04' });
}

describe('pieces', () => {
  it('logs a piece as greenware with its history started', async () => {
    const pieceId = await makePiece();

    const res = await request(app)
      .get(`${studio.base}/pieces/${pieceId}`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.body.piece.status).toBe('GREENWARE');
    expect(res.body.piece.shelfLocation).toBe('B3');
    expect(res.body.piece.events).toHaveLength(1);
    expect(res.body.piece.events[0].toStatus).toBe('GREENWARE');
  });

  it('logs a whole class of work in one request', async () => {
    const second = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Ben Okonjo',
        email: 'ben@student.test',
      },
    });

    const service = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Drop-in',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 8,
        priceCents: 0,
      });
    const cls = await request(app)
      .post(`${studio.base}/sessions`)
      .set(studio.headers)
      .send({
        serviceTypeId: service.body.service.id,
        startLocalDate: '2026-08-01',
        localStartTime: '10:00',
        capacity: 8,
      });

    const res = await request(app)
      .post(`${studio.base}/pieces/batch`)
      .set(studio.headers)
      .send({
        sessionId: cls.body.created[0].id,
        entries: [
          { customerId, count: 3 },
          { customerId: second.id, count: 1 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(4);
    // Labels default to the student's name, numbered when there are several.
    expect(res.body.created.map((p: { label: string }) => p.label)).toContain(
      'Ana Vidal 1',
    );
    expect(res.body.created.map((p: { label: string }) => p.label)).toContain(
      'Ben Okonjo',
    );
  });

  it('refuses a move that skips the kiln', async () => {
    const pieceId = await makePiece();

    // Wet clay cannot become finished work.
    const res = await setStatus(pieceId, 'FINISHED');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_PIECE_TRANSITION');
  });

  it('allows a piece to break at any point, and never come back', async () => {
    const pieceId = await makePiece();

    expect((await setStatus(pieceId, 'BROKEN')).status).toBe(200);

    const res = await setStatus(pieceId, 'AWAITING_BISQUE');
    expect(res.status).toBe(409);
  });

  it('records every move with what it came from', async () => {
    const pieceId = await makePiece();
    await setStatus(pieceId, 'AWAITING_BISQUE');

    const res = await request(app)
      .get(`${studio.base}/pieces/${pieceId}`)
      .set(studio.headers);

    const events = res.body.piece.events;
    expect(events).toHaveLength(2);
    expect(events[1].fromStatus).toBe('GREENWARE');
    expect(events[1].toStatus).toBe('AWAITING_BISQUE');
  });

  it("hides another studio's piece", async () => {
    const pieceId = await makePiece();
    const stranger = await signUpStudio(app);

    const res = await request(app)
      .get(`${stranger.base}/pieces/${pieceId}`)
      .set(stranger.headers);

    expect(res.status).toBe(404);
  });
});

describe('firings', () => {
  it('books the kiln for the whole span, cooling included', async () => {
    const res = await scheduleFiring('BISQUE');

    expect(res.status).toBe(201);
    expect(res.body.firing.status).toBe('SCHEDULED');
    expect(res.body.firing.resourceAllocationId).not.toBeNull();
  });

  /** The Phase 0 exclusion constraint doing the work, with no new code. */
  it('refuses a second firing overlapping the same kiln', async () => {
    await scheduleFiring('BISQUE');

    const clash = await scheduleFiring(
      'GLAZE',
      '2026-09-10T20:00:00Z',
      '2026-09-11T20:00:00Z',
    );

    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('RESOURCE_UNAVAILABLE');
  });

  it('allows a firing that starts exactly when the last one ends', async () => {
    await scheduleFiring('BISQUE');

    const next = await scheduleFiring(
      'GLAZE',
      '2026-09-11T08:00:00Z',
      '2026-09-12T08:00:00Z',
    );

    expect(next.status).toBe(201);
  });

  it('refuses a kiln that is not set up as exclusive', async () => {
    const shelf = await request(app)
      .post(`${studio.base}/resources`)
      .set(studio.headers)
      .send({
        name: 'Drying shelves',
        resourceType: 'OTHER',
        quantity: 8,
        isExclusive: false,
      });

    const res = await request(app)
      .post(`${studio.base}/firings`)
      .set(studio.headers)
      .send({
        resourceId: shelf.body.resource.id,
        firingType: 'BISQUE',
        startsAt: '2026-09-10T08:00:00Z',
        endsAt: '2026-09-11T08:00:00Z',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('KILN_NOT_EXCLUSIVE');
  });

  it('only accepts work that is waiting for that kind of firing', async () => {
    const ready = await makePiece('ready');
    await setStatus(ready, 'AWAITING_BISQUE');
    const wet = await makePiece('still wet');

    const firing = await scheduleFiring('BISQUE');

    const res = await request(app)
      .post(`${studio.base}/firings/${firing.body.firing.id}/pieces`)
      .set(studio.headers)
      .send({ pieceIds: [ready, wet] });

    expect(res.status).toBe(200);
    expect(res.body.loaded).toBe(1);
    expect(res.body.rejected).toHaveLength(1);
    // Rejections are reported, never silently dropped.
    expect(res.body.rejected[0].reason).toContain('still wet');
  });

  it('gives the kiln and the work back when a firing is called off', async () => {
    const pieceId = await makePiece();
    await setStatus(pieceId, 'AWAITING_BISQUE');

    const firing = await scheduleFiring('BISQUE');
    await request(app)
      .post(`${studio.base}/firings/${firing.body.firing.id}/pieces`)
      .set(studio.headers)
      .send({ pieceIds: [pieceId] });

    const res = await request(app)
      .post(`${studio.base}/firings/${firing.body.firing.id}/status`)
      .set(studio.headers)
      .send({ status: 'CANCELLED' });

    expect(res.status).toBe(200);

    // The piece is back in the queue, not stranded mid-firing.
    const piece = await prisma.piece.findUniqueOrThrow({ where: { id: pieceId } });
    expect(piece.status).toBe('AWAITING_BISQUE');
    expect(piece.firingId).toBeNull();

    // And the kiln is free, or a studio with one kiln is stuck forever.
    expect(await prisma.resourceAllocation.count()).toBe(0);

    const rebooked = await scheduleFiring('BISQUE');
    expect(rebooked.status).toBe(201);
  });

  it('reports what is waiting for a kiln', async () => {
    const a = await makePiece('a');
    await setStatus(a, 'AWAITING_BISQUE');

    const res = await request(app)
      .get(`${studio.base}/firings/queue`)
      .set(studio.headers);

    expect(res.body).toMatchObject({ awaitingBisque: 1, awaitingGlaze: 0 });
  });
});

describe('the firing cycle, end to end', () => {
  /**
   * PHASE 2 EXIT GATE — the firing half.
   *
   *   "a piece created → both firings → collected, with the pickup
   *    notification delivered"
   */
  it('takes a pot from wet clay to collected, notifying its owner once', async () => {
    const pieceId = await makePiece('Ana mug');

    // --- Dry, then bisque ---------------------------------------------------
    await setStatus(pieceId, 'AWAITING_BISQUE');

    const bisque = await scheduleFiring('BISQUE');
    await request(app)
      .post(`${studio.base}/firings/${bisque.body.firing.id}/pieces`)
      .set(studio.headers)
      .send({ pieceIds: [pieceId] });

    expect(
      (await prisma.piece.findUniqueOrThrow({ where: { id: pieceId } })).status,
    ).toBe('BISQUE_FIRING');

    await request(app)
      .post(`${studio.base}/firings/${bisque.body.firing.id}/status`)
      .set(studio.headers)
      .send({ status: 'FIRING' });

    const bisqueDone = await request(app)
      .post(`${studio.base}/firings/${bisque.body.firing.id}/status`)
      .set(studio.headers)
      .send({ status: 'COMPLETE' });

    expect(bisqueDone.body.piecesAdvanced).toBe(1);
    expect(
      (await prisma.piece.findUniqueOrThrow({ where: { id: pieceId } })).status,
    ).toBe('BISQUED');

    // Nothing has been sent yet — it is not ready to collect.
    expect(
      await prisma.notification.count({ where: { templateKey: 'piece.ready' } }),
    ).toBe(0);

    // --- Glaze, then glaze fire ---------------------------------------------
    await setStatus(pieceId, 'AWAITING_GLAZE');

    const glaze = await scheduleFiring(
      'GLAZE',
      '2026-09-15T08:00:00Z',
      '2026-09-16T08:00:00Z',
    );
    await request(app)
      .post(`${studio.base}/firings/${glaze.body.firing.id}/pieces`)
      .set(studio.headers)
      .send({ pieceIds: [pieceId] });

    const glazeDone = await request(app)
      .post(`${studio.base}/firings/${glaze.body.firing.id}/status`)
      .set(studio.headers)
      .send({ status: 'COMPLETE' });

    expect(glazeDone.body.piecesAdvanced).toBe(1);

    const finished = await prisma.piece.findUniqueOrThrow({ where: { id: pieceId } });
    expect(finished.status).toBe('FINISHED');
    expect(finished.readyAt).not.toBeNull();

    // --- The customer is told, once -----------------------------------------
    const emails = await prisma.notification.findMany({
      where: { templateKey: 'piece.ready', channel: 'EMAIL' },
    });
    expect(emails).toHaveLength(1);
    expect(String(emails[0]!.payload)).toBeTruthy();

    const sms = await prisma.notification.findMany({
      where: { templateKey: 'piece.ready', channel: 'SMS' },
    });
    // Consent was given in the fixture, so this is a real queued message.
    expect(sms).toHaveLength(1);
    expect(sms[0]!.status).toBe('PENDING');

    // --- Collected ----------------------------------------------------------
    const collected = await setStatus(pieceId, 'COLLECTED');
    expect(collected.status).toBe(200);

    const done = await prisma.piece.findUniqueOrThrow({ where: { id: pieceId } });
    expect(done.status).toBe('COLLECTED');
    expect(done.collectedAt).not.toBeNull();

    // The whole story is on the record.
    const events = await prisma.pieceEvent.findMany({
      where: { pieceId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.toStatus)).toEqual([
      'GREENWARE',
      'AWAITING_BISQUE',
      'BISQUE_FIRING',
      'BISQUED',
      'AWAITING_GLAZE',
      'GLAZE_FIRING',
      'FINISHED',
      'COLLECTED',
    ]);
  });

  it('does not tell the customer twice when a piece is refired', async () => {
    const pieceId = await makePiece();
    await setStatus(pieceId, 'AWAITING_BISQUE');
    await setStatus(pieceId, 'BISQUE_FIRING');
    await setStatus(pieceId, 'BISQUED');
    await setStatus(pieceId, 'AWAITING_GLAZE');
    await setStatus(pieceId, 'GLAZE_FIRING');
    await setStatus(pieceId, 'FINISHED');

    const first = await prisma.notification.count({
      where: { templateKey: 'piece.ready', channel: 'EMAIL' },
    });
    expect(first).toBe(1);

    // Back for a refire, then finished again.
    await setStatus(pieceId, 'AWAITING_GLAZE');
    await setStatus(pieceId, 'GLAZE_FIRING');
    await setStatus(pieceId, 'FINISHED');

    // `notifiedAt` is already stamped, so no second message.
    const after = await prisma.notification.count({
      where: { templateKey: 'piece.ready', channel: 'EMAIL' },
    });
    expect(after).toBe(1);
  });

  it('lists work left on the shelf past the hold period', async () => {
    const pieceId = await makePiece();
    await setStatus(pieceId, 'AWAITING_BISQUE');
    await setStatus(pieceId, 'BISQUE_FIRING');
    await setStatus(pieceId, 'BISQUED');
    await setStatus(pieceId, 'AWAITING_GLAZE');
    await setStatus(pieceId, 'GLAZE_FIRING');
    await setStatus(pieceId, 'FINISHED');

    // Ready 60 days ago, against a 30-day hold.
    await prisma.piece.update({
      where: { id: pieceId },
      data: { readyAt: new Date(Date.now() - 60 * 86_400_000) },
    });

    const res = await request(app)
      .get(`${studio.base}/pieces/uncollected`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.body.holdDays).toBe(30);
    expect(res.body.pieces).toHaveLength(1);
    expect(res.body.pieces[0].daysWaiting).toBeGreaterThanOrEqual(59);
  });
});
