import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import {
  GRACE_DAYS,
  TRIAL_DAYS,
  onPaymentFailed,
  onPaymentSucceeded,
  sweepExpiredSubscriptions,
} from '../../src/modules/billing/billing.service';

/**
 * Billing, plan limits and onboarding.
 *
 * The load-bearing decisions here are about what happens when somebody stops
 * paying. Getting that wrong either gives the product away or takes a working
 * business offline over an expired card.
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
  // SOLO on purpose: here the plan limit is the subject, not an obstacle.
  studio = await signUpStudio(app, { organizationName: 'Clay & Co', plan: 'SOLO' });
});

const setStatus = (status: string, extra: Record<string, unknown> = {}) =>
  prisma.organization.update({
    where: { id: studio.organizationId },
    data: { subscriptionStatus: status as never, ...extra },
  });

describe('the trial', () => {
  it('starts at signup with no card', async () => {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
    });

    expect(org.subscriptionStatus).toBe('TRIALING');
    expect(org.billingCustomerId).toBeNull();

    const daysLeft = Math.round(
      (org.trialEndsAt!.getTime() - Date.now()) / 86_400_000,
    );
    expect(daysLeft).toBe(TRIAL_DAYS);
  });

  it('says nothing until the trial is nearly over', async () => {
    // A banner that is always there is a banner nobody reads.
    const quiet = await request(app)
      .get(`${studio.base}/billing`)
      .set(studio.headers);
    expect(quiet.body.billing.notice).toBeNull();

    await setStatus('TRIALING', {
      trialEndsAt: new Date(Date.now() + 2 * 86_400_000),
    });

    const warned = await request(app)
      .get(`${studio.base}/billing`)
      .set(studio.headers);
    expect(warned.body.billing.notice.level).toBe('warn');
    expect(warned.body.billing.notice.message).toContain('2 days');
  });

  it('suspends a trial that expires without payment', async () => {
    await setStatus('TRIALING', {
      trialEndsAt: new Date(Date.now() - 86_400_000),
    });

    const result = await sweepExpiredSubscriptions();
    expect(result.suspendedTrials).toBe(1);

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
    });
    expect(org.subscriptionStatus).toBe('SUSPENDED');
  });
});

describe('a failed payment', () => {
  it('changes nothing except the warning', async () => {
    // A bounced renewal is usually an expired card. Taking a studio's booking
    // page down over it costs them real money for an administrative problem.
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { billingCustomerId: 'cus_test', subscriptionStatus: 'ACTIVE' },
    });

    await onPaymentFailed('cus_test');

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
    });
    expect(org.subscriptionStatus).toBe('PAST_DUE');
    expect(org.gracePeriodEndsAt).not.toBeNull();

    // Still fully usable.
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({ name: 'Still Works', bookingMode: 'APPOINTMENT', durationMinutes: 60 });
    expect(res.status).toBe(201);
  });

  it('does not extend the grace period on every retry', async () => {
    // Stripe retries a failed invoice several times. Resetting the clock each
    // time would give an unpaying account an indefinite runway.
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { billingCustomerId: 'cus_test' },
    });

    await onPaymentFailed('cus_test');
    const first = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
    });

    await onPaymentFailed('cus_test');
    await onPaymentFailed('cus_test');

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
    });
    expect(after.gracePeriodEndsAt!.getTime()).toBe(
      first.gracePeriodEndsAt!.getTime(),
    );
  });

  it('clears the grace period the moment payment succeeds', async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { billingCustomerId: 'cus_test' },
    });

    await onPaymentFailed('cus_test');
    await onPaymentSucceeded('cus_test');

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
    });
    expect(org.subscriptionStatus).toBe('ACTIVE');
    expect(org.gracePeriodEndsAt).toBeNull();
  });

  it('suspends once the grace period runs out', async () => {
    await setStatus('PAST_DUE', {
      gracePeriodEndsAt: new Date(Date.now() - 86_400_000),
    });

    const result = await sweepExpiredSubscriptions();
    expect(result.suspendedGrace).toBe(1);
    expect(GRACE_DAYS).toBeGreaterThan(0);
  });
});

describe('a suspended account', () => {
  beforeEach(async () => {
    await setStatus('SUSPENDED');
  });

  it('can still be read', async () => {
    // Locking a studio out of their own schedule punishes the wrong people
    // and makes an orderly wind-down impossible.
    const res = await request(app)
      .get(`${studio.base}/services`)
      .set(studio.headers);

    expect(res.status).toBe(200);
  });

  it('cannot make changes', async () => {
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({ name: 'Nope', bookingMode: 'APPOINTMENT', durationMinutes: 60 });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
    // The message must say the data is safe, or the studio assumes the worst.
    expect(res.body.error.message).toContain('safe');
  });

  it('can still reach billing to pay', async () => {
    // The most self-defeating checkout wall possible is one that blocks the
    // page where you would have paid.
    const res = await request(app)
      .post(`${studio.base}/billing/subscribe`)
      .set(studio.headers)
      .send({ plan: 'STUDIO' });

    expect(res.status).toBe(200);
  });

  it('can still reach onboarding', async () => {
    const res = await request(app)
      .get(`${studio.base}/onboarding`)
      .set(studio.headers);

    expect(res.status).toBe(200);
  });
});

describe('the public page when a studio lapses', () => {
  async function publish() {
    await request(app)
      .post(`${studio.base}/onboarding/seed`)
      .set(studio.headers)
      .send({});

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
    });
    return org.slug;
  }

  it('keeps taking bookings while a payment is merely late', async () => {
    // Their customers did nothing wrong.
    const slug = await publish();
    await setStatus('PAST_DUE', {
      gracePeriodEndsAt: new Date(Date.now() + 3 * 86_400_000),
    });

    const page = await request(app).get(`/public/${slug}/data`);
    expect(page.body.acceptingBookings).toBe(true);
  });

  it('stops taking new bookings once suspended', async () => {
    // Otherwise the product is free to anyone who ignores the invoice.
    const slug = await publish();
    await setStatus('SUSPENDED');

    const page = await request(app).get(`/public/${slug}/data`);
    expect(page.body.acceptingBookings).toBe(false);

    const service = page.body.services[0];
    const attempt = await request(app)
      .post(`/public/${slug}/bookings`)
      .send({
        serviceTypeId: service.id,
        sessionId: '00000000-0000-4000-8000-000000000000',
        customer: { name: 'Ada', email: 'ada@student.test' },
      });

    expect(attempt.status).toBe(409);
    expect(attempt.body.error.code).toBe('STUDIO_INACTIVE');
  });

  it('still shows the studio rather than a dead link', async () => {
    const slug = await publish();
    await setStatus('SUSPENDED');

    const page = await request(app).get(`/public/${slug}`);

    expect(page.status).toBe(200);
    expect(page.text).toContain('not taking online bookings');
    // Their classes are still worth showing.
    expect(page.text).toContain('Beginner Wheel Throwing');
  });
});

describe('plan limits', () => {
  it('lets Solo add one instructor and names the plan that allows more', async () => {
    // Seeding creates the first instructor.
    await request(app)
      .post(`${studio.base}/onboarding/seed`)
      .set(studio.headers)
      .send({});

    const res = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Second Teacher', email: 'two@clay.test' });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');
    // "Upgrade to continue" with no specifics is how a customer becomes a
    // support ticket.
    expect(res.body.error.message).toContain('Studio');
  });

  it('allows more once the plan is raised', async () => {
    await request(app)
      .post(`${studio.base}/onboarding/seed`)
      .set(studio.headers)
      .send({});

    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { plan: 'STUDIO' },
    });

    const res = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Second Teacher', email: 'two@clay.test' });

    expect(res.status).toBe(201);
  });

  it('gates mobile bookings behind the Studio plan', async () => {
    // The product's differentiator, and the reason to move up a plan.
    const res = await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({
        name: 'Mobile parties',
        locationType: 'SERVICE_AREA',
        lat: 40.6782,
        lng: -73.9442,
        radiusMeters: 25_000,
      });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PLAN_UPGRADE_REQUIRED');
    expect(res.body.error.message).toContain('Mobile');
  });

  it('does not touch instructors a studio already has when it downgrades', async () => {
    // Deactivating somebody's colleagues because a card expired would be
    // indefensible. Limits bite on CREATE, not on read.
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { plan: 'STUDIO' },
    });

    for (const name of ['One', 'Two', 'Three']) {
      await request(app)
        .post(`${studio.base}/staff`)
        .set(studio.headers)
        .send({ name, email: `${name.toLowerCase()}@clay.test` });
    }

    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { plan: 'SOLO' },
    });

    const list = await request(app)
      .get(`${studio.base}/staff`)
      .set(studio.headers);

    expect(list.body.staff).toHaveLength(3);

    // But no more can be added.
    const blocked = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Four', email: 'four@clay.test' });
    expect(blocked.status).toBe(402);
  });
});

describe('onboarding', () => {
  it('derives progress from the data, not from a clicked flag', async () => {
    // A studio that adds a class through the normal screens has done that
    // step; asking again would be absurd.
    const before = await request(app)
      .get(`${studio.base}/onboarding`)
      .set(studio.headers);

    expect(before.body.readyToPublish).toBe(false);
    expect(before.body.steps.find((s: { id: string }) => s.id === 'service').done)
      .toBe(false);

    await request(app)
      .post(`${studio.base}/onboarding/seed`)
      .set(studio.headers)
      .send({ instructorName: 'Rowan Pike' });

    const after = await request(app)
      .get(`${studio.base}/onboarding`)
      .set(studio.headers);

    expect(after.body.readyToPublish).toBe(true);
    for (const step of after.body.steps) {
      if (step.id !== 'publish' && !step.optional) expect(step.done).toBe(true);
    }
  });

  it('treats payments as optional so a cash studio can still go live', async () => {
    await request(app)
      .post(`${studio.base}/onboarding/seed`)
      .set(studio.headers)
      .send({});

    const state = await request(app)
      .get(`${studio.base}/onboarding`)
      .set(studio.headers);

    const payments = state.body.steps.find(
      (s: { id: string }) => s.id === 'payments',
    );
    expect(payments.done).toBe(false);
    expect(payments.optional).toBe(true);
    expect(state.body.readyToPublish).toBe(true);
  });

  it('seeds a studio that can actually be booked', async () => {
    const seeded = await request(app)
      .post(`${studio.base}/onboarding/seed`)
      .set(studio.headers)
      .send({ instructorName: 'Rowan Pike' });

    expect(seeded.body.created.services).toBe(3);
    expect(seeded.body.created.staff).toBe(true);
    expect(seeded.body.created.hours).toBe(true);
    expect(seeded.body.created.policy).toBe(true);

    // The real test: does the availability engine produce slots from it?
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
    });
    const page = await request(app).get(`/public/${org.slug}/data`);
    const lesson = page.body.services.find(
      (s: { bookingMode: string }) => s.bookingMode === 'APPOINTMENT',
    );

    const from = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);

    const availability = await request(app).get(
      `/public/${org.slug}/availability?serviceTypeId=${lesson.id}&from=${from}&to=${to}`,
    );

    expect(availability.body.slots.length).toBeGreaterThan(0);
  });

  it('is idempotent and never overwrites existing setup', async () => {
    await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'My Own Class',
        bookingMode: 'EVENT',
        durationMinutes: 90,
        capacityMax: 4,
      });

    const seeded = await request(app)
      .post(`${studio.base}/onboarding/seed`)
      .set(studio.headers)
      .send({});

    // Their class already existed, so no defaults were forced on top.
    expect(seeded.body.created.services).toBe(0);

    const services = await request(app)
      .get(`${studio.base}/services`)
      .set(studio.headers);
    expect(services.body.services).toHaveLength(1);
    expect(services.body.services[0].name).toBe('My Own Class');
  });

  it('refuses to publish before the required steps are done', async () => {
    const res = await request(app)
      .post(`${studio.base}/onboarding/publish`)
      .set(studio.headers);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_READY');
    // Names what is missing rather than just refusing.
    expect(res.body.error.message).toContain('Add a class');
  });

  it('publishes and hands back the booking link', async () => {
    await request(app)
      .post(`${studio.base}/onboarding/seed`)
      .set(studio.headers)
      .send({});

    const res = await request(app)
      .post(`${studio.base}/onboarding/publish`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(true);
    expect(res.body.bookingUrl).toContain('/public/');
  });
});
