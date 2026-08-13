import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { FakePaymentProvider } from '../../src/modules/payments/fake.provider';
import { setPaymentProvider } from '../../src/modules/payments/provider.registry';

/**
 * W2.6b — class packs.
 *
 * A pack is a purchase that books nothing, and that is the only genuinely new
 * thing about it. Spending one is NOT new: a pack mints the same ClassCredit a
 * missed class produces, redeemed through the same path that already locks the
 * row and hands the seat back on a lost race.
 *
 * So the tests here are about issuance — exactly N credits, exactly once, even
 * when Stripe delivers the webhook twice — and about the two currencies being
 * genuinely one.
 */

const app = createApp();
let provider: FakePaymentProvider;
let studio: Studio;
let packId: string;
let customerId: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  provider = new FakePaymentProvider();
  setPaymentProvider(provider);

  studio = await signUpStudio(app);

  const pack = await request(app)
    .post(`${studio.base}/packs`)
    .set(studio.headers)
    .send({
      name: 'Ten Class Pack',
      creditCount: 10,
      priceCents: 40000,
      validityDays: 180,
    });
  expect(pack.status).toBe(201);
  packId = pack.body.pack.id;

  const customer = await prisma.customer.create({
    data: {
      organizationId: studio.organizationId,
      name: 'Ana Vidal',
      email: 'ana@student.test',
    },
  });
  customerId = customer.id;
});

async function enablePayments() {
  await request(app).post(`${studio.base}/payments/connect`).set(studio.headers);
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: studio.organizationId },
  });
  provider.completeOnboarding(org.stripeAccountId!);
  await request(app).post(`${studio.base}/payments/refresh`).set(studio.headers);
}

async function deliverWebhook(event: unknown) {
  const raw = JSON.stringify(event);
  return request(app)
    .post('/webhooks/stripe')
    .set('stripe-signature', provider.sign(Buffer.from(raw, 'utf8')))
    .set('Content-Type', 'application/json')
    .send(raw);
}

describe('selling a pack', () => {
  it('issues exactly the credits the pack is worth', async () => {
    const res = await request(app)
      .post(`${studio.base}/packs/${packId}/sell`)
      .set(studio.headers)
      .send({ customerId });

    expect(res.status).toBe(201);
    expect(res.body.credits).toBe(10);

    const credits = await prisma.classCredit.findMany();
    expect(credits).toHaveLength(10);
    expect(credits.every((c) => c.source === 'PACK')).toBe(true);
    expect(credits.every((c) => c.status === 'AVAILABLE')).toBe(true);
    expect(credits.every((c) => c.expiresAt !== null)).toBe(true);
  });

  it('snapshots price and validity, so later edits cannot reach back', async () => {
    const sold = await request(app)
      .post(`${studio.base}/packs/${packId}/sell`)
      .set(studio.headers)
      .send({ customerId });

    // The studio puts its prices up and shortens validity.
    await request(app)
      .patch(`${studio.base}/packs/${packId}`)
      .set(studio.headers)
      .send({ priceCents: 60000, validityDays: 30 });

    const purchase = await prisma.classPackPurchase.findUniqueOrThrow({
      where: { id: sold.body.purchase.id },
    });

    // What Ana bought is what Ana bought.
    expect(purchase.pricePaidCents).toBe(40000);
    expect(purchase.validityDays).toBe(180);
  });

  it('withdraws a pack from sale without disturbing what was sold', async () => {
    await request(app)
      .post(`${studio.base}/packs/${packId}/sell`)
      .set(studio.headers)
      .send({ customerId });

    const res = await request(app)
      .delete(`${studio.base}/packs/${packId}`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.body.pack.isActive).toBe(false);
    // Deactivated, not deleted — the purchase still points at it.
    expect(await prisma.classCredit.count()).toBe(10);
  });

  it('needs owner rights to decide what to sell', async () => {
    const { addMemberToStudio } = await import('../helpers/api');
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    const res = await request(app)
      .post(`${studio.base}/packs`)
      .set(instructor.headers)
      .send({ name: 'Rogue pack', creditCount: 5, priceCents: 100 });

    expect(res.status).toBe(403);
  });
});

describe('buying a pack online', () => {
  async function startCheckout() {
    await enablePayments();

    const purchase = await prisma.classPackPurchase.create({
      data: {
        organizationId: studio.organizationId,
        classPackId: packId,
        customerId,
        status: 'PENDING',
        creditCount: 10,
        pricePaidCents: 40000,
        validityDays: 180,
      },
    });

    const { startPackCheckout } = await import(
      '../../src/modules/payments/payment.service'
    );

    return {
      purchase,
      checkout: await startPackCheckout({
        organizationId: studio.organizationId,
        purchaseId: purchase.id,
        customerEmail: 'ana@student.test',
        customerName: 'Ana Vidal',
        successUrl: 'https://example.test/ok',
        cancelUrl: 'https://example.test/no',
      }),
    };
  }

  it('mints nothing until the money lands', async () => {
    await startCheckout();

    // A purchase in flight is worth zero classes.
    expect(await prisma.classCredit.count()).toBe(0);
    const purchase = await prisma.classPackPurchase.findFirstOrThrow();
    expect(purchase.status).toBe('PENDING');
    expect(purchase.issuedAt).toBeNull();
  });

  it('issues the credits when payment completes', async () => {
    const { purchase } = await startCheckout();

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;
    const res = await deliverWebhook(provider.payCheckout(csid));
    expect(res.status).toBe(200);

    expect(await prisma.classCredit.count()).toBe(10);

    const after = await prisma.classPackPurchase.findUniqueOrThrow({
      where: { id: purchase.id },
    });
    expect(after.status).toBe('ACTIVE');
    expect(after.issuedAt).not.toBeNull();
    expect(after.expiresAt).not.toBeNull();

    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.status).toBe('SUCCEEDED');
    expect(payment.packPurchaseId).toBe(purchase.id);
    // A pack books nothing, so no booking claims this money.
    expect(payment.bookingId).toBeNull();
  });

  /** THE GATE. Stripe does not promise single delivery. */
  it('does not double-issue when the webhook is redelivered', async () => {
    await startCheckout();

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;
    const event = provider.payCheckout(csid);

    await deliverWebhook(event);
    const replay = await deliverWebhook(event);
    expect(replay.status).toBe(200);

    // Ten, not twenty.
    expect(await prisma.classCredit.count()).toBe(10);
  });

  it('refuses to start checkout twice for one purchase', async () => {
    const { purchase } = await startCheckout();

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;
    await deliverWebhook(provider.payCheckout(csid));

    const { startPackCheckout } = await import(
      '../../src/modules/payments/payment.service'
    );

    await expect(
      startPackCheckout({
        organizationId: studio.organizationId,
        purchaseId: purchase.id,
        customerEmail: 'ana@student.test',
        customerName: 'Ana Vidal',
        successUrl: 'https://example.test/ok',
        cancelUrl: 'https://example.test/no',
      }),
    ).rejects.toMatchObject({ code: 'PURCHASE_NOT_PENDING' });
  });
});

describe('spending pack credits', () => {
  async function soldPack() {
    const res = await request(app)
      .post(`${studio.base}/packs/${packId}/sell`)
      .set(studio.headers)
      .send({ customerId });
    return res.body.purchase.id as string;
  }

  async function futureClass() {
    const service = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Wheel Class',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 8,
        priceCents: 4500,
      });

    const cls = await request(app)
      .post(`${studio.base}/sessions`)
      .set(studio.headers)
      .send({
        serviceTypeId: service.body.service.id,
        startLocalDate: '2027-06-05',
        localStartTime: '10:00',
        capacity: 8,
      });
    return cls.body.created[0].id as string;
  }

  /**
   * The point of sharing one table: a pack credit spends through the very same
   * path a missed class does, with the same double-spend guard.
   */
  it('books a real seat through the shared redemption path', async () => {
    await soldPack();
    const sessionId = await futureClass();
    const credit = await prisma.classCredit.findFirstOrThrow();

    const res = await request(app)
      .post(`${studio.base}/credits/${credit.id}/redeem`)
      .set(studio.headers)
      .send({ sessionId });

    expect(res.status).toBe(201);
    expect(res.body.credit.status).toBe('REDEEMED');

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(1);

    expect(
      await prisma.classCredit.count({ where: { status: 'AVAILABLE' } }),
    ).toBe(9);
  });

  it('cannot spend one pack credit twice, even simultaneously', async () => {
    await soldPack();
    const first = await futureClass();
    const second = await futureClass();
    const credit = await prisma.classCredit.findFirstOrThrow();

    const [a, b] = await Promise.all([
      request(app)
        .post(`${studio.base}/credits/${credit.id}/redeem`)
        .set(studio.headers)
        .send({ sessionId: first }),
      request(app)
        .post(`${studio.base}/credits/${credit.id}/redeem`)
        .set(studio.headers)
        .send({ sessionId: second }),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(
      await prisma.classCredit.count({ where: { status: 'REDEEMED' } }),
    ).toBe(1);
  });

  it('shows one balance across packs and absences alike', async () => {
    await soldPack();

    // Plus one granted by hand, from a different source entirely.
    await request(app)
      .post(`${studio.base}/credits`)
      .set(studio.headers)
      .send({ customerId, reason: 'Kiln broke' });

    const res = await request(app)
      .get(`${studio.base}/packs/balance/${customerId}`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    // A customer asking "how many classes do I have?" gets one number.
    expect(res.body.available).toBe(11);
    expect(res.body.bySource.PACK).toBe(10);
    expect(res.body.nextExpiry).toBeTruthy();
  });

  it('leaves expired credits out of the balance', async () => {
    await soldPack();

    await prisma.classCredit.updateMany({
      data: { expiresAt: new Date('2020-01-01') },
    });

    const res = await request(app)
      .get(`${studio.base}/packs/balance/${customerId}`)
      .set(studio.headers);

    expect(res.body.available).toBe(0);
  });
});

describe('refunding a pack', () => {
  it('withdraws what is unspent and leaves what was used', async () => {
    const purchaseId = await (async () => {
      const res = await request(app)
        .post(`${studio.base}/packs/${packId}/sell`)
        .set(studio.headers)
        .send({ customerId });
      return res.body.purchase.id as string;
    })();

    // Ana uses three of her ten.
    const service = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Wheel Class',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 8,
        priceCents: 4500,
      });

    const credits = await prisma.classCredit.findMany({ take: 3 });
    for (const credit of credits) {
      const cls = await request(app)
        .post(`${studio.base}/sessions`)
        .set(studio.headers)
        .send({
          serviceTypeId: service.body.service.id,
          startLocalDate: '2027-06-05',
          localStartTime: '10:00',
          capacity: 8,
        });

      // Each in its own class, since one credit is one seat.
      await request(app)
        .post(`${studio.base}/credits/${credit.id}/redeem`)
        .set(studio.headers)
        .send({ sessionId: cls.body.created[0].id });
    }

    const res = await request(app)
      .post(`${studio.base}/packs/purchases/${purchaseId}/refund`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(7);
    expect(res.body.spent).toBe(3);

    /**
     * The three she used stay REDEEMED. Clawing them back would mean
     * un-booking somebody from classes they have already attended.
     */
    expect(
      await prisma.classCredit.count({ where: { status: 'REDEEMED' } }),
    ).toBe(3);
    expect(
      await prisma.classCredit.count({ where: { status: 'AVAILABLE' } }),
    ).toBe(0);
  });

  it('is idempotent', async () => {
    const sold = await request(app)
      .post(`${studio.base}/packs/${packId}/sell`)
      .set(studio.headers)
      .send({ customerId });

    await request(app)
      .post(`${studio.base}/packs/purchases/${sold.body.purchase.id}/refund`)
      .set(studio.headers);

    const second = await request(app)
      .post(`${studio.base}/packs/purchases/${sold.body.purchase.id}/refund`)
      .set(studio.headers);

    expect(second.status).toBe(200);
    expect(second.body.cancelled).toBe(0);
  });

  it("will not touch another studio's pack", async () => {
    const stranger = await signUpStudio(app);

    const res = await request(app)
      .patch(`${stranger.base}/packs/${packId}`)
      .set(stranger.headers)
      .send({ priceCents: 1 });

    expect(res.status).toBe(404);
  });
});
