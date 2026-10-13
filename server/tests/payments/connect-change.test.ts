import { randomBytes } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { FakePaymentProvider } from '../../src/modules/payments/fake.provider';
import { setPaymentProvider } from '../../src/modules/payments/provider.registry';
import { handleWebhook } from '../../src/modules/payments/payment.service';
import { setProviders } from '../../src/modules/notifications/registry';
import type { EmailProvider } from '../../src/modules/notifications/provider';

/**
 * A studio leaving one Stripe account for another, by its own hand.
 *
 * Start over: an unfinished setup is thrown away and a new one begins.
 * Change: a working account is replaced ALONGSIDE itself, so bookings never
 * stop, and the old account still refunds what it took.
 */

const app = createApp();
let provider: FakePaymentProvider;
let studio: Studio;
let sent: { to: string; subject: string; text: string }[];

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

  sent = [];
  const email: EmailProvider = {
    name: 'recording',
    async send(input) {
      sent.push({ to: input.to, subject: input.subject, text: input.text });
      return { messageId: `msg_${sent.length}` };
    },
  };
  setProviders({ email });

  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
});

const org = () =>
  prisma.organization.findUniqueOrThrow({ where: { id: studio.organizationId } });

/** Starts onboarding as the owner and returns the account id it made. */
async function connect() {
  await request(app).post(`${studio.base}/payments/connect`).set(studio.headers).expect(200);
  return (await org()).stripeAccountId!;
}

/** A studio fully onboarded and taking payments. */
async function working() {
  const accountId = await connect();
  provider.completeOnboarding(accountId);
  await request(app).post(`${studio.base}/payments/refresh`).set(studio.headers).expect(200);
  return accountId;
}

const post = (path: string, as: Studio = studio, body: object = {}) =>
  request(app).post(`${studio.base}${path}`).set(as.headers).send(body);

describe('starting Stripe setup over', () => {
  it('throws the unfinished account away and onboards a new one in one step', async () => {
    const abandoned = await connect();

    const res = await post('/payments/connect/restart');

    expect(res.status).toBe(200);
    expect(res.body.url).toBeTruthy();
    const after = await org();
    expect(after.stripeAccountId).toBeTruthy();
    expect(after.stripeAccountId).not.toBe(abandoned);
    expect(res.body.url).toContain(after.stripeAccountId);
    // It never took money, so it is closed rather than left lying around.
    expect(provider.closedAccounts).toEqual([abandoned]);
  });

  it('is refused for an account that takes payments, which needs a change instead', async () => {
    const live = await working();

    const res = await post('/payments/connect/restart');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STRIPE_ACCOUNT_ACTIVE');
    expect((await org()).stripeAccountId).toBe(live);
    expect(provider.closedAccounts).toHaveLength(0);
  });

  it('is refused when there is nothing to start over', async () => {
    const res = await post('/payments/connect/restart');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STRIPE_NOT_CONNECTED');
  });

  it('is refused while a switch to a new account is under way', async () => {
    await working();
    await post('/payments/change-account', studio, { confirm: 'CHANGE' });
    // The current account stops being able to take payments mid-switch.
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { stripeChargesEnabled: false },
    });

    const res = await post('/payments/connect/restart');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACCOUNT_CHANGE_PENDING');
  });

  it('is open to admins, not to instructors', async () => {
    await connect();
    const admin = await addMemberToStudio(app, studio.organizationId, 'ADMIN');
    const instructor = await addMemberToStudio(app, studio.organizationId, 'INSTRUCTOR');

    expect((await post('/payments/connect/restart', instructor)).status).toBe(403);
    expect((await post('/payments/connect/restart', admin)).status).toBe(200);
  });
});

describe('changing a working Stripe account', () => {
  it('builds the new account alongside, leaving bookings on the current one', async () => {
    const current = await working();

    const res = await post('/payments/change-account', studio, { confirm: 'CHANGE' });

    expect(res.status).toBe(200);
    const after = await org();
    expect(after.stripeAccountId).toBe(current);
    expect(after.stripeChargesEnabled).toBe(true);
    expect(after.pendingStripeAccountId).toBeTruthy();
    expect(after.pendingStripeAccountId).not.toBe(current);
    expect(res.body.url).toContain(after.pendingStripeAccountId);

    const status = await request(app)
      .get(`${studio.base}/payments/status`)
      .set(studio.headers)
      .expect(200);
    expect(status.body.accountChange).not.toBeNull();
  });

  it('needs the typed confirmation to start', async () => {
    await working();

    const res = await post('/payments/change-account');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CONFIRMATION_REQUIRED');
    expect((await org()).pendingStripeAccountId).toBeNull();
  });

  it('resumes the same pending account rather than making another', async () => {
    await working();
    await post('/payments/change-account', studio, { confirm: 'CHANGE' });
    const pending = (await org()).pendingStripeAccountId;

    const again = await post('/payments/change-account');

    expect(again.status).toBe(200);
    expect((await org()).pendingStripeAccountId).toBe(pending);
  });

  it('switches once the new account can take payments, keeping the old one on record', async () => {
    const current = await working();
    await post('/payments/change-account', studio, { confirm: 'CHANGE' });
    const pending = (await org()).pendingStripeAccountId!;
    provider.completeOnboarding(pending);

    // The owner lands back on Settings, which refreshes.
    const res = await post('/payments/refresh');

    expect(res.body.accountChange).toMatchObject({ switched: true });
    const after = await org();
    expect(after.stripeAccountId).toBe(pending);
    expect(after.stripeChargesEnabled).toBe(true);
    expect(after.pendingStripeAccountId).toBeNull();
    expect(after.previousStripeAccountId).toBe(current);
    expect(after.stripeAccountChangedAt).not.toBeNull();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toMatch(/new Stripe account/);
    expect(sent[0]!.text).toMatch(/Refunds for bookings paid before today/);
  });

  it('switches on account.updated too, and only once when both arrive', async () => {
    await working();
    await post('/payments/change-account', studio, { confirm: 'CHANGE' });
    const pending = (await org()).pendingStripeAccountId!;
    provider.completeOnboarding(pending);

    await handleWebhook({
      id: 'evt_pending_ready',
      type: 'account.updated',
      accountId: pending,
      data: { id: pending, charges_enabled: true, payouts_enabled: true, details_submitted: true },
    });
    await post('/payments/refresh');

    expect((await org()).stripeAccountId).toBe(pending);
    expect(sent).toHaveLength(1);
  });

  it('stays on the current account while the new one is unfinished', async () => {
    const current = await working();
    await post('/payments/change-account', studio, { confirm: 'CHANGE' });

    const res = await post('/payments/refresh');

    expect(res.body.chargesEnabled).toBe(true);
    expect(res.body.accountChange).toMatchObject({ switched: false });
    expect((await org()).stripeAccountId).toBe(current);
  });

  it('can be cancelled, closing the half-built account and changing nothing', async () => {
    const current = await working();
    await post('/payments/change-account', studio, { confirm: 'CHANGE' });
    const pending = (await org()).pendingStripeAccountId!;

    const res = await post('/payments/change-account/cancel');

    expect(res.status).toBe(200);
    const after = await org();
    expect(after.stripeAccountId).toBe(current);
    expect(after.pendingStripeAccountId).toBeNull();
    expect(provider.closedAccounts).toEqual([pending]);
  });

  it('is for owners only', async () => {
    await working();
    const admin = await addMemberToStudio(app, studio.organizationId, 'ADMIN');

    const res = await post('/payments/change-account', admin, { confirm: 'CHANGE' });

    expect(res.status).toBe(403);
  });

  it('is refused for an account that cannot take payments yet', async () => {
    await connect();

    const res = await post('/payments/change-account', studio, { confirm: 'CHANGE' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STRIPE_NOT_ACTIVE');
  });

  it('waits while a customer is in the middle of paying', async () => {
    const current = await working();
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        kind: 'FULL',
        amountCents: 9500,
        status: 'PENDING',
        provider: 'fake',
        providerAccountId: current,
      },
    });

    const res = await post('/payments/change-account', studio, { confirm: 'CHANGE' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHECKOUT_IN_PROGRESS');
  });

  it('refunds an earlier payment from the account that took it', async () => {
    const current = await working();
    const customer = await prisma.customer.create({
      data: { organizationId: studio.organizationId, name: 'Ada', email: 'ada@x.test' },
    });
    const service = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({ name: 'Wheel', bookingMode: 'EVENT', durationMinutes: 60, capacityMax: 4, priceCents: 5000 });
    const startsAt = new Date(Date.now() + 5 * 86_400_000);
    const { createSession } = await import('../../src/scheduling/session.service');
    const session = await createSession({
      organizationId: studio.organizationId,
      serviceTypeId: service.body.service.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      timezone: 'America/New_York',
      localStartTime: '10:00',
      capacity: 4,
    });
    const booking = await prisma.booking.create({
      data: {
        organizationId: studio.organizationId,
        serviceTypeId: service.body.service.id,
        sessionId: session.id,
        customerId: customer.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        timezone: 'America/New_York',
        seats: 1,
        totalCents: 5000,
        status: 'CONFIRMED',
        cancelToken: randomBytes(32),
      },
    });
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        bookingId: booking.id,
        kind: 'FULL',
        amountCents: 5000,
        status: 'SUCCEEDED',
        provider: 'fake',
        succeededAt: new Date(),
        providerPaymentIntentId: 'pi_before_change',
        providerAccountId: current,
      },
    });

    await post('/payments/change-account', studio, { confirm: 'CHANGE' });
    const pending = (await org()).pendingStripeAccountId!;
    provider.completeOnboarding(pending);
    await post('/payments/refresh');

    const refund = await post(`/payments/bookings/${booking.id}/refund`, studio, { inFull: true });

    expect(refund.status).toBe(200);
    expect(provider.refundRequests[0]!.connectedAccountId).toBe(current);
  });
});
