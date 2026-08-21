import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';

/**
 * Listing payments.
 *
 * The interesting assertions are about money arithmetic and about which rows a
 * filter is allowed to hide. A payments screen that quietly drops failures is
 * answering a narrower question than the one it appears to answer, and a total
 * that forgets refunds overstates a studio's takings — both look completely
 * correct until somebody reconciles against their bank.
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

async function makePayment(opts: {
  amountCents: number;
  refundedCents?: number;
  status?: 'SUCCEEDED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'PENDING' | 'FAILED';
  createdAt?: Date;
  organizationId?: string;
}) {
  return prisma.payment.create({
    data: {
      organizationId: opts.organizationId ?? studio.organizationId,
      kind: 'FULL',
      amountCents: opts.amountCents,
      refundedCents: opts.refundedCents ?? 0,
      status: opts.status ?? 'SUCCEEDED',
      succeededAt: opts.status === 'FAILED' ? null : new Date(),
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}

describe('the totals', () => {
  it('reports received net of refunds, not gross', async () => {
    await makePayment({ amountCents: 10_000 });
    await makePayment({
      amountCents: 10_000,
      refundedCents: 2_500,
      status: 'PARTIALLY_REFUNDED',
    });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.totals.receivedCents).toBe(17_500);
    expect(res.body.totals.refundedCents).toBe(2_500);
  });

  it('counts a failed payment as received nothing', async () => {
    await makePayment({ amountCents: 9_900, status: 'FAILED' });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.totals.receivedCents).toBe(0);
    expect(res.body.totals.failed).toBe(1);
    // But the row is still listed — see below.
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].netCents).toBe(0);
  });

  /**
   * Totals cover the whole filtered set, not the page.
   *
   * A total that only added up the rows on screen would change every time
   * somebody paged, which is worse than showing no total at all.
   */
  it('covers everything matched, not just the current page', async () => {
    for (let i = 0; i < 5; i++) await makePayment({ amountCents: 1_000 });

    const res = await request(app)
      .get(`${studio.base}/payments?limit=2`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.payments).toHaveLength(2);
    expect(res.body.totals.count).toBe(5);
    expect(res.body.totals.receivedCents).toBe(5_000);
    expect(res.body.nextCursor).toBeTruthy();
  });
});

describe('what the list shows', () => {
  /**
   * Failed and pending rows are exactly what somebody opens this screen for.
   * Hiding them would make it a revenue report wearing a payments label.
   */
  it('includes failures and pending attempts, not only money that landed', async () => {
    await makePayment({ amountCents: 1_000 });
    await makePayment({ amountCents: 2_000, status: 'FAILED' });
    await makePayment({ amountCents: 3_000, status: 'PENDING' });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    const statuses = res.body.payments.map((p: { status: string }) => p.status);
    expect(statuses).toContain('FAILED');
    expect(statuses).toContain('PENDING');
    expect(res.body.payments).toHaveLength(3);
  });

  it('filters by status', async () => {
    await makePayment({ amountCents: 1_000 });
    await makePayment({ amountCents: 2_000, status: 'FAILED' });

    const res = await request(app)
      .get(`${studio.base}/payments?status=FAILED`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].amountCents).toBe(2_000);
  });

  it('filters by date range', async () => {
    await makePayment({
      amountCents: 1_000,
      createdAt: new Date('2026-01-15T12:00:00.000Z'),
    });
    await makePayment({ amountCents: 2_000 });

    const res = await request(app)
      .get(`${studio.base}/payments?from=2026-01-01&to=2026-01-31T23:59:59Z`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].amountCents).toBe(1_000);
  });

  it('pages without repeating or skipping a row', async () => {
    for (let i = 0; i < 5; i++) await makePayment({ amountCents: 1_000 + i });

    const first = await request(app)
      .get(`${studio.base}/payments?limit=2`)
      .set(studio.headers)
      .expect(200);

    const second = await request(app)
      .get(`${studio.base}/payments?limit=2&cursor=${first.body.nextCursor}`)
      .set(studio.headers)
      .expect(200);

    const firstIds = first.body.payments.map((p: { id: string }) => p.id);
    const secondIds = second.body.payments.map((p: { id: string }) => p.id);

    expect(secondIds).toHaveLength(2);
    expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false);
  });
});

describe('who may read it', () => {
  /** Front desk answers "did that go through" without being able to move money. */
  it('is open to any member', async () => {
    const desk = await addMemberToStudio(app, studio.organizationId, 'FRONT_DESK');

    await request(app)
      .get(`${studio.base}/payments`)
      .set(desk.headers)
      .expect(200);
  });

  it('never shows another studio a cent', async () => {
    const other = await signUpStudio(app);
    await makePayment({
      amountCents: 999_00,
      organizationId: other.organizationId,
    });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.payments).toHaveLength(0);
    expect(res.body.totals.receivedCents).toBe(0);
  });

  it('hides the studio entirely from a stranger', async () => {
    const stranger = await signUpStudio(app);

    await request(app)
      .get(`${studio.base}/payments`)
      .set(stranger.headers)
      .expect(404);
  });
});
