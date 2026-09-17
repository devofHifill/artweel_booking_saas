import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
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

/* ------------------------------------------------------------------ D7 ---
   What the money was for, the status tabs, the breakdown, what is owed, and
   one transaction in full.
   ------------------------------------------------------------------------ */

/** A service to hang bookings off. Created per booking; nothing shares one. */
async function makeService(name = 'Beginner Wheel Throwing') {
  return prisma.serviceType.create({
    data: {
      organizationId: studio.organizationId,
      name,
      slug: `svc-${randomBytes(4).toString('hex')}`,
      bookingMode: 'EVENT',
      durationMinutes: 180,
      capacityMax: 8,
      priceCents: 9_500,
    },
  });
}

async function makeCustomer(name: string) {
  return prisma.customer.create({
    data: {
      organizationId: studio.organizationId,
      name,
      email: `${randomBytes(5).toString('hex')}@student.test`,
    },
  });
}

async function makeBooking(opts: {
  customerName?: string;
  totalCents?: number;
  status?: 'PENDING' | 'CONFIRMED' | 'ATTENDED' | 'CANCELLED';
  serviceName?: string;
}) {
  const service = await makeService(opts.serviceName);
  const customer = await makeCustomer(opts.customerName ?? 'Jane Potter');

  /* A booking must point at exactly one target — a session for a class, a
     staff member for an appointment. The database enforces it
     (`bookings_exactly_one_target`), so a fixture cannot skip the session
     just because this suite is about money. */
  const session = await prisma.session.create({
    data: {
      organizationId: studio.organizationId,
      serviceTypeId: service.id,
      startsAt: new Date('2026-09-19T18:00:00.000Z'),
      endsAt: new Date('2026-09-19T21:00:00.000Z'),
      timezone: 'America/New_York',
      localStartTime: '14:00',
      capacity: 8,
    },
  });

  return prisma.booking.create({
    data: {
      organizationId: studio.organizationId,
      customerId: customer.id,
      serviceTypeId: service.id,
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00.000Z'),
      endsAt: new Date('2026-09-19T21:00:00.000Z'),
      timezone: 'America/New_York',
      status: opts.status ?? 'CONFIRMED',
      totalCents: opts.totalCents ?? 9_500,
      cancelToken: randomBytes(32),
    },
  });
}

async function makePackPurchase(customerName: string, packName = 'Ten class pack') {
  const customer = await makeCustomer(customerName);
  const pack = await prisma.classPack.create({
    data: {
      organizationId: studio.organizationId,
      name: packName,
      creditCount: 10,
      priceCents: 80_000,
    },
  });

  return prisma.classPackPurchase.create({
    data: {
      organizationId: studio.organizationId,
      classPackId: pack.id,
      customerId: customer.id,
      creditCount: 10,
      pricePaidCents: 80_000,
      validityDays: 365,
      /* ACTIVE means the credits have been minted, and the database checks
         that the dates back that up (`class_pack_purchases_issue_coherent`). */
      status: 'ACTIVE',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 86_400_000),
    },
  });
}

async function makeEnrollment(
  customerName: string,
  courseName = 'Six-week wheel course',
) {
  const service = await makeService('Course service');
  const customer = await makeCustomer(customerName);
  const series = await prisma.courseSeries.create({
    data: {
      organizationId: studio.organizationId,
      serviceTypeId: service.id,
      name: courseName,
      sessionCount: 6,
      priceCents: 42_000,
      timezone: 'America/New_York',
      capacity: 8,
    },
  });

  return prisma.enrollment.create({
    data: {
      organizationId: studio.organizationId,
      courseSeriesId: series.id,
      customerId: customer.id,
      totalCents: 42_000,
      cancelToken: randomBytes(32),
    },
  });
}

describe('what the money was for', () => {
  /**
   * The column used to fall back to `kind`, which is FULL on nearly every row
   * in the product — so a class pack purchase read "full" and told nobody
   * anything.
   */
  it('names the pack a pack bought, not its payment kind', async () => {
    const purchase = await makePackPurchase('Marcus Reed');
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        packPurchaseId: purchase.id,
        kind: 'FULL',
        amountCents: 80_000,
        status: 'SUCCEEDED',
        succeededAt: new Date(),
      },
    });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.payments[0].subject).toMatchObject({
      kind: 'PACK',
      label: 'Ten class pack',
    });
    /* And the customer comes through the purchase, which is the only route
       there is — a pack is bought against no booking at all. */
    expect(res.body.payments[0].customer.name).toBe('Marcus Reed');
  });

  it('names the course a course was paid for', async () => {
    const enrollment = await makeEnrollment('Ada Kiln');
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        enrollmentId: enrollment.id,
        kind: 'FULL',
        amountCents: 42_000,
        status: 'SUCCEEDED',
        succeededAt: new Date(),
      },
    });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.payments[0].subject).toMatchObject({
      kind: 'COURSE',
      label: 'Six-week wheel course',
    });
  });

  /**
   * A payment still pointing at a hold is a checkout that never completed. It
   * is named rather than swept into "other" because it is exactly the row
   * somebody scanning this screen is hunting for.
   */
  it('says a payment against a hold is a checkout in progress', async () => {
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        holdId: randomUUID(),
        kind: 'FULL',
        amountCents: 9_500,
        status: 'PENDING',
      },
    });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.payments[0].subject.kind).toBe('HOLD');
    expect(res.body.payments[0].customer).toBeNull();
  });

  /**
   * The search followed `booking.customer` only, so a customer who had bought
   * a pack and nothing else came back as "no payments" while their purchase
   * sat in the table. An empty result reads as an answer, which is what makes
   * that worse than having no search at all.
   */
  it('finds a customer through a pack purchase, not only through a booking', async () => {
    const purchase = await makePackPurchase('Persimmon Vale');
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        packPurchaseId: purchase.id,
        kind: 'FULL',
        amountCents: 80_000,
        status: 'SUCCEEDED',
        succeededAt: new Date(),
      },
    });

    const res = await request(app)
      .get(`${studio.base}/payments?search=Persimmon`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.payments).toHaveLength(1);
    expect(res.body.totals.count).toBe(1);
  });
});

describe('the status tabs', () => {
  /**
   * Counted under every filter EXCEPT status.
   *
   * Count under the status filter too and every other tab collapses to zero
   * the moment one is clicked; count under none of the filters and the row
   * describes a different list from the one on screen. Both asserted — here
   * and in the test below.
   */
  it('keeps every count while one status is selected', async () => {
    await makePayment({ amountCents: 1_000 });
    await makePayment({ amountCents: 2_000, status: 'FAILED' });
    await makePayment({ amountCents: 3_000, status: 'PENDING' });

    const res = await request(app)
      .get(`${studio.base}/payments?status=FAILED`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.payments).toHaveLength(1);
    expect(res.body.counts).toMatchObject({
      total: 3,
      SUCCEEDED: 1,
      FAILED: 1,
      PENDING: 1,
    });
  });

  it('still obeys every other filter', async () => {
    await makePayment({
      amountCents: 1_000,
      createdAt: new Date('2026-01-15T12:00:00.000Z'),
    });
    await makePayment({ amountCents: 2_000 });

    const res = await request(app)
      .get(`${studio.base}/payments?from=2026-01-01&to=2026-01-31T23:59:59Z`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.counts.total).toBe(1);
  });

  /** A status with no rows is absent, so the screen prints a 0 rather than a
      blank — which reads as "unknown", and is a different answer. */
  it('reports only the statuses that have rows', async () => {
    await makePayment({ amountCents: 1_000 });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.counts.total).toBe(1);
    expect(res.body.counts.CANCELLED).toBeUndefined();
  });
});

describe('where it came from', () => {
  it('splits received money by subject', async () => {
    const booking = await makeBooking({});
    const purchase = await makePackPurchase('Marcus Reed');

    await prisma.payment.createMany({
      data: [
        {
          organizationId: studio.organizationId,
          bookingId: booking.id,
          kind: 'FULL',
          amountCents: 9_500,
          status: 'SUCCEEDED',
          succeededAt: new Date(),
        },
        {
          organizationId: studio.organizationId,
          packPurchaseId: purchase.id,
          kind: 'FULL',
          amountCents: 80_000,
          status: 'SUCCEEDED',
          succeededAt: new Date(),
        },
      ],
    });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.totals.breakdown).toEqual([
      { kind: 'PACK', cents: 80_000 },
      { kind: 'CLASS', cents: 9_500 },
    ]);
  });

  /**
   * The bars are shares of the figure printed beside them, so they count money
   * RECEIVED. A failed charge belongs in the failed count and nowhere near a
   * chart headed "where it came from".
   */
  it('leaves failed and refunded money out of the bars', async () => {
    const booking = await makeBooking({});

    await prisma.payment.createMany({
      data: [
        {
          organizationId: studio.organizationId,
          bookingId: booking.id,
          kind: 'FULL',
          amountCents: 10_000,
          refundedCents: 2_500,
          status: 'PARTIALLY_REFUNDED',
          succeededAt: new Date(),
        },
        {
          organizationId: studio.organizationId,
          bookingId: booking.id,
          kind: 'FULL',
          amountCents: 5_000,
          status: 'FAILED',
        },
      ],
    });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.totals.breakdown).toEqual([{ kind: 'CLASS', cents: 7_500 }]);
    expect(res.body.totals.receivedCents).toBe(7_500);
  });

  it('never counts another studio into the bars', async () => {
    const other = await signUpStudio(app);
    await makePayment({
      amountCents: 999_00,
      organizationId: other.organizationId,
    });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.totals.breakdown).toEqual([]);
  });
});

describe('what the studio is owed', () => {
  /**
   * Owed does not move with the date range, and cannot: an unpaid class from
   * March is still unpaid while somebody is looking at last week. It is
   * returned outside `totals` for that reason, and the screen labels it so.
   */
  it('ignores the date range the rest of the screen obeys', async () => {
    await makeBooking({ totalCents: 9_500 });

    const res = await request(app)
      .get(`${studio.base}/payments?from=2026-08-01&to=2026-08-07T23:59:59Z`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.payments).toHaveLength(0);
    expect(res.body.outstandingCents).toBe(9_500);
  });

  it('subtracts what has been paid', async () => {
    const booking = await makeBooking({ totalCents: 9_500 });
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        bookingId: booking.id,
        kind: 'DEPOSIT',
        amountCents: 4_000,
        status: 'SUCCEEDED',
        succeededAt: new Date(),
      },
    });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.outstandingCents).toBe(5_500);
  });

  /** A cancelled seat is not a debt. */
  it('does not chase a cancelled booking', async () => {
    await makeBooking({ totalCents: 9_500, status: 'CANCELLED' });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.outstandingCents).toBe(0);
  });

  /**
   * Over-refunded or overpaid, the figure reads zero — never a negative, which
   * under a heading of "owed" would say the studio owes the customer.
   */
  it('never goes negative when more was paid than the booking is worth', async () => {
    const booking = await makeBooking({ totalCents: 5_000 });
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        bookingId: booking.id,
        kind: 'FULL',
        amountCents: 9_500,
        status: 'SUCCEEDED',
        succeededAt: new Date(),
      },
    });

    const res = await request(app)
      .get(`${studio.base}/payments`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.outstandingCents).toBe(0);
  });
});

describe('one transaction', () => {
  it('carries the reference, the refunds and what was credited', async () => {
    const booking = await makeBooking({});
    const payment = await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        bookingId: booking.id,
        kind: 'FULL',
        amountCents: 9_500,
        refundedCents: 2_000,
        status: 'PARTIALLY_REFUNDED',
        succeededAt: new Date(),
        providerPaymentIntentId: `pi_${randomBytes(8).toString('hex')}`,
      },
    });

    await prisma.refund.create({
      data: {
        paymentId: payment.id,
        amountCents: 2_000,
        creditCents: 1_000,
        reason: 'Late cancellation, half as credit',
      },
    });

    const res = await request(app)
      .get(`${studio.base}/payments/${payment.id}`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.reference).toMatch(/^pi_/);
    expect(res.body.netCents).toBe(7_500);
    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0]).toMatchObject({
      amountCents: 2_000,
      creditCents: 1_000,
      reason: 'Late cancellation, half as credit',
    });
  });

  /** Why a card was declined is stored and has never been visible anywhere. */
  it('says why a payment failed', async () => {
    const payment = await makePayment({ amountCents: 9_500, status: 'FAILED' });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { failureReason: 'card_declined' },
    });

    const res = await request(app)
      .get(`${studio.base}/payments/${payment.id}`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.failureReason).toBe('card_declined');
    expect(res.body.reference).toBeNull();
  });

  /**
   * The booking's money, across ALL its payments — not this charge's.
   *
   * One booking can be paid in two goes, and the question asked at the counter
   * is always about the booking. Reading it off the open payment alone would
   * answer confidently and wrongly.
   */
  it('reports the whole booking balance, not this payment alone', async () => {
    const booking = await makeBooking({ totalCents: 9_500 });

    const first = await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        bookingId: booking.id,
        kind: 'DEPOSIT',
        amountCents: 4_000,
        status: 'SUCCEEDED',
        succeededAt: new Date(),
      },
    });

    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        bookingId: booking.id,
        kind: 'BALANCE',
        amountCents: 5_500,
        status: 'SUCCEEDED',
        succeededAt: new Date(),
      },
    });

    const res = await request(app)
      .get(`${studio.base}/payments/${first.id}`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.booking).toMatchObject({
      totalCents: 9_500,
      paidCents: 9_500,
      outstandingCents: 0,
    });
  });

  it('is a 404 for a payment belonging to another studio', async () => {
    const other = await signUpStudio(app);
    const theirs = await makePayment({
      amountCents: 12_000,
      organizationId: other.organizationId,
    });

    await request(app)
      .get(`${studio.base}/payments/${theirs.id}`)
      .set(studio.headers)
      .expect(404);
  });

  /**
   * '/:paymentId' happily matches '/status'.
   *
   * Declared above the literal route, it turned the Connect status endpoint —
   * which Integrations and Settings both read — into a lookup for a payment
   * called "status", and the uuid guard made that a 404 rather than a crash.
   * Nothing in a green suite would have noticed, so it is asserted.
   */
  it('does not shadow the Connect status route', async () => {
    const res = await request(app)
      .get(`${studio.base}/payments/status`)
      .set(studio.headers)
      .expect(200);

    expect(res.body).toHaveProperty('chargesEnabled');
  });
});
