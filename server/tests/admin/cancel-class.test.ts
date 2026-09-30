import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';
import { createSession } from '../../src/scheduling/session.service';

/**
 * A studio calling a class off.
 *
 * It cancelled the seats and nothing else: no customer was told, the
 * day-before reminder still went out for a class that was not happening, and
 * nobody was refunded — while cancelling the same bookings one by one would
 * have charged them the policy's late fee for the studio's own decision.
 */

const app = createApp();
let studio: Studio;
let slug: string;
let classId: string;

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
  slug = (
    await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
      select: { slug: true },
    })
  ).slug;

  // Strict: nothing back inside a week — so a full refund can only come from
  // the class being cancelled by the studio, not from the policy.
  const policy = await prisma.cancellationPolicy.create({
    data: {
      organizationId: studio.organizationId,
      name: 'Strict',
      isDefault: true,
      tiers: [
        { hoursBefore: 168, refundPercent: 100 },
        { hoursBefore: 0, refundPercent: 0 },
      ],
    },
  });
  classId = (
    await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Sunset kayak tour',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 10,
        priceCents: 4_500,
        cancellationPolicyId: policy.id,
      })
      .expect(201)
  ).body.service.id;
});

async function classInTwoDays() {
  const startsAt = new Date(Date.now() + 2 * 86_400_000);
  return (await createSession({
    organizationId: studio.organizationId,
    serviceTypeId: classId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
    timezone: 'Europe/London',
    localStartTime: '17:00',
    capacity: 10,
  }))!;
}

async function book(sessionId: string, email: string) {
  const res = await request(app)
    .post(`/public/${slug}/bookings`)
    .send({ serviceTypeId: classId, sessionId, seats: 1, customer: { name: email, email } })
    .expect(201);
  return res.body.booking.id as string;
}

const paid = (bookingId: string) =>
  prisma.payment.create({
    data: {
      organizationId: studio.organizationId,
      bookingId,
      kind: 'FULL',
      amountCents: 4_500,
      status: 'SUCCEEDED',
      // As a real online payment has: the charge, and the account it went to.
      providerPaymentIntentId: `pi_${randomBytes(8).toString('hex')}`,
      providerAccountId: 'acct_test_harbour',
    },
  });

const cancellationEmails = (bookingId: string) =>
  prisma.notification.count({
    where: { bookingId, channel: 'EMAIL', templateKey: 'booking.cancelled' },
  });

describe('cancelling a whole class', () => {
  it('tells every customer, and stops their reminders', async () => {
    const session = await classInTwoDays();
    const a = await book(session.id, 'ada@paddler.test');
    const b = await book(session.id, 'ben@paddler.test');
    const pendingBefore = await prisma.notification.count({
      where: { bookingId: { in: [a, b] }, status: 'PENDING', templateKey: { startsWith: 'reminder' } },
    });
    expect(pendingBefore).toBeGreaterThan(0);

    const res = await request(app)
      .delete(`${studio.base}/sessions/${session.id}`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.bookingsCancelled).toBe(2);
    expect(res.body.customersNotified).toBe(2);
    expect(await cancellationEmails(a)).toBe(1);
    expect(await cancellationEmails(b)).toBe(1);
    // No "see you tomorrow" for a class that is not happening.
    expect(
      await prisma.notification.count({
        where: { bookingId: { in: [a, b] }, status: 'PENDING', templateKey: { startsWith: 'reminder' } },
      }),
    ).toBe(0);
  });

  it('refunds in full, even under a policy that would keep it all', async () => {
    const session = await classInTwoDays();
    const bookingId = await book(session.id, 'ada@paddler.test');
    const payment = await paid(bookingId);

    const res = await request(app)
      .delete(`${studio.base}/sessions/${session.id}`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.refundedCents).toBe(4_500);
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.refundedCents).toBe(4_500);
  });

  it('leaves the money alone when the studio says so', async () => {
    const session = await classInTwoDays();
    const bookingId = await book(session.id, 'ada@paddler.test');
    const payment = await paid(bookingId);

    const res = await request(app)
      .delete(`${studio.base}/sessions/${session.id}?refund=false`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.refundedCents).toBe(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).refundedCents).toBe(0);
    // Still told.
    expect(await cancellationEmails(bookingId)).toBe(1);
  });
});

describe('cancelling one booking from Bookings', () => {
  it('still follows the policy — the late fee applies to a single cancellation', async () => {
    const session = await classInTwoDays();
    const bookingId = await book(session.id, 'ada@paddler.test');
    await paid(bookingId);

    const res = await request(app)
      .post(`${studio.base}/bookings/${bookingId}/cancel`)
      .set(studio.headers)
      .send({ refund: true })
      .expect(200);

    // Two days out under Strict: nothing back.
    expect(res.body.refundedCents).toBe(0);
  });
});
