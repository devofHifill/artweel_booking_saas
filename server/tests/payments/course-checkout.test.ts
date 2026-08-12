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
 * Buying a six-week course.
 *
 * A course diverges from a class in three places at once — the hold spans
 * every week, the result is an enrolment rather than a booking, and the
 * confirmation is sent once rather than six times. Each of those is a place
 * where seats or money can go missing, so each gets a case here.
 */

const app = createApp();
let provider: FakePaymentProvider;
let studio: Studio;
let slug: string;
let serviceId: string;
let seriesId: string;

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

  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: studio.organizationId },
  });
  slug = org.slug;

  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Six-Week Beginner Wheel',
      bookingMode: 'COURSE_SERIES',
      durationMinutes: 120,
      capacityMax: 8,
      // The DROP-IN price. The cohort's own price is what must be charged,
      // and these differ by design so a mix-up cannot pass unnoticed.
      priceCents: 9500,
    });
  serviceId = service.body.service.id;

  const created = await request(app)
    .post(`${studio.base}/courses`)
    .set(studio.headers)
    .send({
      serviceTypeId: serviceId,
      name: 'Beginner Wheel Throwing',
      sessionCount: 6,
      capacity: 8,
      priceCents: 45000,
    });
  seriesId = created.body.series.id;

  await request(app)
    .post(`${studio.base}/courses/${seriesId}/sessions`)
    .set(studio.headers)
    .send({
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      startLocalDate: '2026-09-01',
      localStartTime: '19:00',
    });

  await request(app)
    .patch(`${studio.base}/courses/${seriesId}`)
    .set(studio.headers)
    .send({ status: 'PUBLISHED' });
});

async function enablePayments() {
  await request(app).post(`${studio.base}/payments/connect`).set(studio.headers);
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: studio.organizationId },
  });
  provider.completeOnboarding(org.stripeAccountId!);
  await request(app).post(`${studio.base}/payments/refresh`).set(studio.headers);
  return org.stripeAccountId!;
}

async function startCourseCheckout(seats = 1, email = 'ada@student.test') {
  return request(app)
    .post(`/public/${slug}/courses/${seriesId}/checkout`)
    .send({ seats, customer: { name: 'Ada Potter', email } });
}

async function deliverWebhook(event: unknown) {
  const raw = JSON.stringify(event);
  return request(app)
    .post('/webhooks/stripe')
    .set('stripe-signature', provider.sign(Buffer.from(raw, 'utf8')))
    .set('Content-Type', 'application/json')
    .send(raw);
}

function sessionsOf() {
  return prisma.session.findMany({
    where: { courseSeriesId: seriesId },
    orderBy: { seriesIndex: 'asc' },
  });
}

describe('course checkout', () => {
  it('charges the cohort price, not the drop-in price', async () => {
    await enablePayments();

    const res = await startCourseCheckout();

    expect(res.status).toBe(201);
    expect(res.body.price.totalCents).toBe(45000);
    expect(res.body.checkoutUrl).toBeTruthy();
  });

  it('holds a seat in every week before the customer reaches Stripe', async () => {
    await enablePayments();
    await startCourseCheckout();

    // The whole point: week six is reserved while the card is in flight.
    const sessions = await sessionsOf();
    expect(sessions).toHaveLength(6);
    expect(sessions.every((s) => s.seatsTaken === 1)).toBe(true);

    // One hold, not six.
    const holds = await prisma.bookingHold.findMany();
    expect(holds).toHaveLength(1);
    expect(holds[0]!.courseSeriesId).toBe(seriesId);
    expect(holds[0]!.sessionId).toBeNull();
  });

  it('creates an enrolment with all six bookings when payment lands', async () => {
    await enablePayments();
    await startCourseCheckout();

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;
    const res = await deliverWebhook(provider.payCheckout(csid));
    expect(res.status).toBe(200);

    const enrollment = await prisma.enrollment.findFirstOrThrow({});
    expect(enrollment.status).toBe('ACTIVE');
    expect(enrollment.totalCents).toBe(45000);

    const bookings = await prisma.booking.findMany({
      where: { enrollmentId: enrollment.id },
    });
    expect(bookings).toHaveLength(6);

    // Seats were TRANSFERRED from the hold, not taken again. If conversion
    // double-counted, every week would read 2.
    const sessions = await sessionsOf();
    expect(sessions.every((s) => s.seatsTaken === 1)).toBe(true);

    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.status).toBe('SUCCEEDED');
    expect(payment.enrollmentId).toBe(enrollment.id);
    // The money is on the enrolment, so no booking claims it.
    expect(payment.bookingId).toBeNull();
  });

  it('sends one confirmation for the course, not one per week', async () => {
    await enablePayments();
    await startCourseCheckout();

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;
    await deliverWebhook(provider.payCheckout(csid));

    // Counted per EMAIL row: every message also writes an SMS row, recorded
    // as SKIPPED here because this student never gave consent.
    const confirmations = await prisma.notification.count({
      where: { templateKey: 'booking.confirmed', channel: 'EMAIL' },
    });
    expect(confirmations).toBe(1);

    // Reminders DO fan out — a student wants one before each Tuesday.
    // Six weeks, two reminders each.
    const reminders = await prisma.notification.count({
      where: {
        templateKey: { in: ['reminder.24h', 'reminder.2h'] },
        channel: 'EMAIL',
      },
    });
    expect(reminders).toBe(12);
  });

  it('does not enrol twice when Stripe redelivers the webhook', async () => {
    await enablePayments();
    await startCourseCheckout();

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;
    const event = provider.payCheckout(csid);

    await deliverWebhook(event);
    const replay = await deliverWebhook(event);
    expect(replay.status).toBe(200);

    expect(await prisma.enrollment.count()).toBe(1);
    expect(await prisma.booking.count()).toBe(6);

    const sessions = await sessionsOf();
    expect(sessions.every((s) => s.seatsTaken === 1)).toBe(true);
  });

  it('returns seats to every week when the checkout is abandoned', async () => {
    await enablePayments();
    await startCourseCheckout();

    const csid = (await prisma.payment.findFirstOrThrow({}))
      .providerCheckoutSessionId!;
    await deliverWebhook(provider.expireCheckout(csid));

    const sessions = await sessionsOf();
    expect(sessions.every((s) => s.seatsTaken === 0)).toBe(true);
    expect(await prisma.enrollment.count()).toBe(0);
  });

  it('returns seats to every week when the hold expires unpaid', async () => {
    await enablePayments();
    await startCourseCheckout();

    // Age the hold past its TTL, then run the ordinary sweep — which knows
    // nothing about courses and must still do the right thing.
    await prisma.bookingHold.updateMany({
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const { sweepExpiredHolds } = await import('../../src/scheduling/hold.service');
    const result = await sweepExpiredHolds();

    expect(result.holdsReleased).toBe(1);
    // One PLACE released, not six. Counting per week would make the sweep's
    // own reporting meaningless.
    expect(result.seatsReleased).toBe(1);

    const sessions = await sessionsOf();
    expect(sessions.every((s) => s.seatsTaken === 0)).toBe(true);
  });

  it('refuses to sell a course whose middle week is full', async () => {
    await enablePayments();

    // A drop-in student takes the last seat in week four.
    const sessions = await sessionsOf();
    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Drop-in',
        email: 'dropin@student.test',
      },
    });
    const { bookSeats } = await import('../../src/scheduling/booking.service');
    await bookSeats({
      organizationId: studio.organizationId,
      sessionId: sessions[3]!.id,
      customerId: customer.id,
      seats: 8,
    });

    const res = await startCourseCheckout();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_FULL');
    // No money was taken and nothing was reserved.
    expect(await prisma.payment.count()).toBe(0);
    const after = await sessionsOf();
    expect(after[0]!.seatsTaken).toBe(0);
  });

  it('never oversells a course under concurrent checkouts', async () => {
    await enablePayments();

    // Capacity 8, everyone wanting 3. Two fit; a third would need 9.
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        startCourseCheckout(3, `racer${i}@student.test`),
      ),
    );

    const accepted = attempts.filter((r) => r.status === 201);
    const refused = attempts.filter((r) => r.status !== 201);

    expect(accepted).toHaveLength(2);
    for (const r of refused) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('COURSE_FULL');
    }

    // Every week holds exactly 6, and none exceeds capacity.
    const sessions = await sessionsOf();
    for (const session of sessions) {
      expect(session.seatsTaken).toBe(6);
      expect(session.seatsTaken).toBeLessThanOrEqual(session.capacity);
    }
  });

  it('refuses checkout for a draft cohort', async () => {
    await enablePayments();
    await prisma.courseSeries.update({
      where: { id: seriesId },
      data: { status: 'DRAFT' },
    });

    const res = await startCourseCheckout();
    expect(res.status).toBe(404);
  });

  it('refuses checkout when the studio cannot take payments', async () => {
    const res = await startCourseCheckout();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENTS_NOT_ENABLED');

    // And nothing was held on the way to finding that out.
    const sessions = await sessionsOf();
    expect(sessions.every((s) => s.seatsTaken === 0)).toBe(true);
  });

  it('still refuses the free-enrolment route for a priced cohort', async () => {
    await enablePayments();

    const res = await request(app)
      .post(`/public/${slug}/courses/${seriesId}/enrollments`)
      .send({ customer: { name: 'Ada Potter', email: 'ada@student.test' } });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_REQUIRES_PAYMENT');
    expect(await prisma.enrollment.count()).toBe(0);
  });
});
