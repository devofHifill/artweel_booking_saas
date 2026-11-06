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
 * Everything else a Class carries (CLASS-EVENT-PLAN.md): the fields the
 * activity editor has always had, now asked on the Class steps — and made to
 * do something for a Class, which is booked once for the whole run.
 *
 *   Child price      priced on the cohort, for the whole run
 *   Minimum guests   the smallest party one booking may be
 *   Minimum notice   closes booking that long before the first session
 *   Bookable up to   opens booking that many days before it (blank: now)
 *   Status           Hidden keeps it off the page, and out of Solo's count
 */

/** A date about three weeks out, so the first session is always ahead. */
function weeksAhead(weeks = 3): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

const app = createApp();
let provider: FakePaymentProvider;
let studio: Studio;
let slug: string;

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
  slug = (await prisma.organization.findUniqueOrThrow({ where: { id: studio.organizationId } })).slug;
});

const klass = (overrides: Record<string, unknown> = {}) => ({
  name: 'Family Wheel',
  startDate: weeksAhead(),
  weekdays: ['SA'],
  startTime: '10:00',
  endTime: '12:00',
  sessionCount: 4,
  seats: 10,
  priceCents: 20000,
  ...overrides,
});

async function publish(overrides: Record<string, unknown> = {}, as: Studio = studio) {
  const res = await request(app)
    .post(`${as.base}/activities/classes`)
    .set(as.headers)
    .send(klass(overrides));
  return res;
}

async function publicCourse(seriesId: string) {
  const res = await request(app).get(`/public/${slug}/courses`).expect(200);
  return (res.body.courses as { id: string }[]).find((c) => c.id === seriesId) as
    | Record<string, unknown>
    | undefined;
}

function enrol(seriesId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/public/${slug}/courses/${seriesId}/enrollments`)
    .send({ customer: { name: 'Ada Potter', email: 'ada@family.test' }, ...body });
}

async function enablePayments() {
  await request(app).post(`${studio.base}/payments/connect`).set(studio.headers);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: studio.organizationId } });
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

describe('publishing a class with every detail', () => {
  it('saves each field on the activity, and the prices and deadline on its cohort', async () => {
    const category = await prisma.serviceCategory.create({
      data: { organizationId: studio.organizationId, name: 'Wheel' },
    });
    const policy = await prisma.cancellationPolicy.create({
      data: { organizationId: studio.organizationId, name: 'Two weeks', tiers: [] },
    });

    const res = await publish({
      description: 'Four Saturday mornings at the wheel, for grown-ups and kids together.',
      categoryId: category.id,
      meetingPoint: 'Studio 2, up the stairs',
      childPriceCents: 12000,
      minGuests: 2,
      depositType: 'percent',
      depositValue: 25,
      emoji: '🏺',
      color: '#059669',
      colorAccent: '#10b981',
      cancellationPolicyId: policy.id,
      minNoticeMinutes: 1440,
      maxHorizonDays: 60,
      highlights: 'Clay and tools\nFiring for two pieces',
      preparationNotes: 'Closed shoes.',
      bookingInstructions: 'Ring the top bell.',
    });
    expect(res.status).toBe(201);

    const service = await prisma.serviceType.findUniqueOrThrow({ where: { id: res.body.service.id } });
    expect(service).toMatchObject({
      kind: 'CLASS',
      description: 'Four Saturday mornings at the wheel, for grown-ups and kids together.',
      categoryId: category.id,
      meetingPoint: 'Studio 2, up the stairs',
      priceCents: 20000,
      childPriceCents: 12000,
      capacityMin: 2,
      capacityMax: 10,
      depositType: 'percent',
      depositValue: 25,
      emoji: '🏺',
      color: '#059669',
      colorAccent: '#10b981',
      cancellationPolicyId: policy.id,
      minNoticeMinutes: 1440,
      maxHorizonDays: 60,
      highlights: 'Clay and tools\nFiring for two pieces',
      preparationNotes: 'Closed shoes.',
      bookingInstructions: 'Ring the top bell.',
      isActive: true,
      durationMinutes: 120,
    });

    const series = await prisma.courseSeries.findUniqueOrThrow({ where: { id: res.body.series.id } });
    expect(series.priceCents).toBe(20000);
    expect(series.childPriceCents).toBe(12000);
    const first = new Date(res.body.sessions[0].startsAt);
    expect(series.enrollmentClosesAt?.getTime()).toBe(first.getTime() - 1440 * 60_000);
  });

  it('opens booking at once when "Bookable up to" is left blank', async () => {
    const res = await publish({ startDate: '2027-06-05' }); // seven months out
    expect(res.status).toBe(201);
    const course = await publicCourse(res.body.series.id);
    expect(course).toMatchObject({ enrollable: true, bookingOpensAt: null, childPriceCents: 0, minGuests: 1 });
  });

  it('refuses another studio\'s category and policy, and nonsense numbers', async () => {
    const other = await signUpStudio(app, { organizationName: 'Other Kiln' });
    const theirs = await prisma.serviceCategory.create({
      data: { organizationId: other.organizationId, name: 'Theirs' },
    });
    expect((await publish({ categoryId: theirs.id })).status).toBe(400);

    expect((await publish({ minGuests: 11 })).status).toBe(422);
    expect((await publish({ depositType: 'percent', depositValue: 120 })).status).toBe(422);
    expect((await publish({ depositType: 'fixed', depositValue: 0 })).status).toBe(422);
    expect(await prisma.serviceType.count({ where: { organizationId: studio.organizationId } })).toBe(0);
  });
});

describe('child price on a class', () => {
  it('quotes adults and children for the whole run', async () => {
    const res = await publish({ childPriceCents: 12000 });
    const quote = await request(app)
      .post(`/public/${slug}/quote`)
      .send({
        serviceTypeId: res.body.service.id,
        courseSeriesId: res.body.series.id,
        seats: 3,
        children: 2,
      })
      .expect(200);
    expect(quote.body).toMatchObject({
      adults: 1,
      children: 2,
      adultSubtotalCents: 20000,
      childSubtotalCents: 24000,
      totalCents: 44000,
    });
  });

  it('is charged at checkout, and the enrolment records the children', async () => {
    await enablePayments();
    const res = await publish({ childPriceCents: 12000 });
    const seriesId = res.body.series.id;

    const checkout = await request(app)
      .post(`/public/${slug}/courses/${seriesId}/checkout`)
      .send({ seats: 3, children: 2, customer: { name: 'Ada Potter', email: 'ada@family.test' } });
    expect(checkout.status).toBe(201);
    expect(checkout.body.price.totalCents).toBe(44000);

    const payment = await prisma.payment.findFirstOrThrow({});
    expect(payment.amountCents).toBe(44000);
    expect((await deliverWebhook(provider.payCheckout(payment.providerCheckoutSessionId!))).status).toBe(200);

    const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { courseSeriesId: seriesId } });
    expect(enrollment).toMatchObject({ seats: 3, children: 2, totalCents: 44000 });
    const bookings = await prisma.booking.findMany({ where: { enrollmentId: enrollment.id } });
    expect(bookings).toHaveLength(4);
    expect(bookings.every((b) => b.seats === 3 && b.children === 2)).toBe(true);
  });

  it('counts children as adults when the class has no child price', async () => {
    const res = await publish({ priceCents: 0 });
    const done = await enrol(res.body.series.id, { seats: 2, children: 1 });
    expect(done.status).toBe(201);
    const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { id: done.body.enrollment.id } });
    expect(enrollment.children).toBe(0);
  });

  it('will not enrol children for free when only adults are free', async () => {
    const res = await publish({ priceCents: 0, childPriceCents: 5000 });
    const refused = await enrol(res.body.series.id, { seats: 2, children: 1 });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('COURSE_REQUIRES_PAYMENT');
  });
});

describe('who may book, and when', () => {
  it('keeps booking closed until "Bookable up to" days before the first session', async () => {
    const res = await publish({ startDate: '2027-06-05', priceCents: 0, maxHorizonDays: 30 });
    const course = await publicCourse(res.body.series.id);
    expect(course?.enrollable).toBe(false);
    expect(course?.bookingOpensAt).toBeTruthy();

    const refused = await enrol(res.body.series.id, { seats: 1 });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/opens on/);

    const html = (await request(app).get(`/public/${slug}/book`).expect(200)).text;
    expect(html).toContain('Booking opens');
  });

  it('refuses a party smaller than the minimum guests', async () => {
    const res = await publish({ priceCents: 0, minGuests: 2 });
    const one = await enrol(res.body.series.id, { seats: 1 });
    expect(one.status).toBe(409);
    expect(one.body.error.message).toMatch(/at least 2/);
    expect((await enrol(res.body.series.id, { seats: 2 })).status).toBe(201);
  });

  it('closes booking "Minimum notice" before the first session', async () => {
    // Four weeks of notice on a class three weeks away: already closed.
    const res = await publish({ priceCents: 0, minNoticeMinutes: 28 * 24 * 60 });
    const refused = await enrol(res.body.series.id, { seats: 1 });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/closed/);
  });
});

describe('hidden', () => {
  it('is not on the booking page and cannot be booked', async () => {
    const res = await publish({ priceCents: 0, isActive: false });
    expect(res.status).toBe(201);
    expect(await publicCourse(res.body.series.id)).toBeUndefined();
    expect((await enrol(res.body.series.id, { seats: 1 })).status).toBe(404);
  });

  it('takes no Solo place until it is switched on, and then needs one', async () => {
    const solo = await signUpStudio(app, { plan: 'SOLO' });
    expect((await publish({}, solo)).status).toBe(201);

    const hidden = await publish({ name: 'Next Term', isActive: false }, solo);
    expect(hidden.status).toBe(201);

    const switchOn = await request(app)
      .patch(`${solo.base}/services/${hidden.body.service.id}`)
      .set(solo.headers)
      .send({ isActive: true });
    expect(switchOn.status).toBe(402);
    expect(switchOn.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });
});

describe('editing a class afterwards', () => {
  it('carries a new price and notice to its cohort, where checkout reads them', async () => {
    const res = await publish({ childPriceCents: 12000 });
    const patch = await request(app)
      .patch(`${studio.base}/services/${res.body.service.id}`)
      .set(studio.headers)
      .send({ priceCents: 25000, childPriceCents: 15000, minNoticeMinutes: 60 });
    expect(patch.status).toBe(200);

    const series = await prisma.courseSeries.findUniqueOrThrow({ where: { id: res.body.series.id } });
    expect(series.priceCents).toBe(25000);
    expect(series.childPriceCents).toBe(15000);
    const first = new Date(res.body.sessions[0].startsAt);
    expect(series.enrollmentClosesAt?.getTime()).toBe(first.getTime() - 60 * 60_000);
  });
});
