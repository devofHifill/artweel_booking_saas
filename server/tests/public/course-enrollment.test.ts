import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * Courses on the public booking page.
 *
 * The load-bearing assertion in here is the seats number. A course is sold
 * whole, so the count a stranger sees has to be the count of its TIGHTEST
 * week. Publishing week one's roomier number would make the page promise
 * something the enrolment path then refuses.
 */

const app = createApp();
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

  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: studio.organizationId },
  });
  slug = org.slug;
});

/** A local date N weeks out, so the fixture cannot expire the way a literal does. */
function weeksFromNow(weeks: number): string {
  return new Date(Date.now() + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

/** A published cohort with six dated Tuesdays. */
async function publishCourse(
  opts: { priceCents?: number; capacity?: number; sessionCount?: number } = {},
) {
  const serviceRes = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Six-Week Beginner Wheel',
      bookingMode: 'COURSE_SERIES',
      durationMinutes: 120,
      slotGranularityMinutes: 30,
      capacityMin: 1,
      capacityMax: 8,
      priceCents: opts.priceCents ?? 0,
    });
  expect(serviceRes.status).toBe(201);

  const created = await request(app)
    .post(`${studio.base}/courses`)
    .set(studio.headers)
    .send({
      serviceTypeId: serviceRes.body.service.id,
      name: 'Beginner Wheel Throwing',
      cohortLabel: 'Autumn 2026 — Tuesdays',
      description: 'Centring, pulling and trimming over six weeks.',
      sessionCount: opts.sessionCount ?? 6,
      capacity: opts.capacity ?? 8,
      priceCents: opts.priceCents ?? 0,
    });
  expect(created.status).toBe(201);
  const seriesId = created.body.series.id as string;

  const generated = await request(app)
    .post(`${studio.base}/courses/${seriesId}/sessions`)
    .set(studio.headers)
    .send({
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      /*
        Relative, not fixed. This read '2026-09-01', which stopped being in the
        future on 2026-09-02 and took three tests with it: a cohort that has
        already begun answers COURSE_ALREADY_STARTED, so the enrolment cases
        failed on a date rather than on a defect. A fixture pinned to a literal
        date is a test with an expiry stamped on it.
      */
      startLocalDate: weeksFromNow(2),
      localStartTime: '19:00',
    });
  expect(generated.status).toBe(201);

  await request(app)
    .patch(`${studio.base}/courses/${seriesId}`)
    .set(studio.headers)
    .send({ status: 'PUBLISHED' });

  return { seriesId, sessions: generated.body.sessions };
}

const student = {
  customer: { name: 'Ana Vidal', email: 'ana@student.test', phone: '+15550100' },
};

describe('public course listing', () => {
  it('lists a published cohort with its dates and seats', async () => {
    await publishCourse();

    const res = await request(app).get(`/public/${slug}/courses`);

    expect(res.status).toBe(200);
    expect(res.body.courses).toHaveLength(1);

    const course = res.body.courses[0];
    expect(course.name).toBe('Beginner Wheel Throwing');
    expect(course.cohortLabel).toBe('Autumn 2026 — Tuesdays');
    expect(course.sessionCount).toBe(6);
    expect(course.dates).toHaveLength(6);
    expect(course.seatsRemaining).toBe(8);
    expect(course.enrollable).toBe(true);
  });

  it('hides a cohort that is still a draft', async () => {
    const { seriesId } = await publishCourse();
    await prisma.courseSeries.update({
      where: { id: seriesId },
      data: { status: 'DRAFT' },
    });

    const res = await request(app).get(`/public/${slug}/courses`);
    expect(res.body.courses).toHaveLength(0);
  });

  it('reports seats from the tightest week, not the first', async () => {
    const { sessions } = await publishCourse({ capacity: 8 });

    // Week four is nearly full; the course therefore has one place.
    const dropIn = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Drop-in',
        email: 'dropin@student.test',
      },
    });
    const { bookSeats } = await import('../../src/scheduling/booking.service');
    await bookSeats({
      organizationId: studio.organizationId,
      sessionId: sessions[3].id,
      customerId: dropIn.id,
      seats: 7,
    });

    const res = await request(app).get(`/public/${slug}/courses`);
    expect(res.body.courses[0].seatsRemaining).toBe(1);
  });

  it('marks a full course as not enrollable', async () => {
    const { seriesId } = await publishCourse({ capacity: 1 });

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'First',
        email: 'first@student.test',
      },
    });
    await request(app)
      .post(`${studio.base}/courses/${seriesId}/enrollments`)
      .set(studio.headers)
      .send({ customerId: customer.id });

    const res = await request(app).get(`/public/${slug}/courses`);
    expect(res.body.courses[0].seatsRemaining).toBe(0);
    expect(res.body.courses[0].enrollable).toBe(false);
  });

  it('does not expose the instructor\'s contact details', async () => {
    await publishCourse();
    const res = await request(app).get(`/public/${slug}/courses`);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('@clay.test');
  });
});

describe('public course enrolment', () => {
  it('enrols a stranger across every week of a free course', async () => {
    const { seriesId } = await publishCourse({ priceCents: 0 });

    const res = await request(app)
      .post(`/public/${slug}/courses/${seriesId}/enrollments`)
      .send(student);

    expect(res.status).toBe(201);
    expect(res.body.enrollment.sessionCount).toBe(6);
    expect(res.body.enrollment.status).toBe('ACTIVE');
    expect(res.body.manageToken).toBeTruthy();

    const bookings = await prisma.booking.findMany({
      where: { enrollmentId: res.body.enrollment.id },
    });
    expect(bookings).toHaveLength(6);

    // And the customer record was created from the form.
    const customer = await prisma.customer.findFirstOrThrow({
      where: { organizationId: studio.organizationId, email: 'ana@student.test' },
    });
    expect(customer.name).toBe('Ana Vidal');
  });

  it('refuses to enrol on a priced course from the public page', async () => {
    const { seriesId } = await publishCourse({ priceCents: 45000 });

    const res = await request(app)
      .post(`/public/${slug}/courses/${seriesId}/enrollments`)
      .send(student);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_REQUIRES_PAYMENT');

    const enrollments = await prisma.enrollment.count();
    expect(enrollments).toBe(0);
  });

  it('refuses to enrol on a draft cohort', async () => {
    const { seriesId } = await publishCourse();
    await prisma.courseSeries.update({
      where: { id: seriesId },
      data: { status: 'DRAFT' },
    });

    const res = await request(app)
      .post(`/public/${slug}/courses/${seriesId}/enrollments`)
      .send(student);

    expect(res.status).toBe(404);
  });

  it('refuses a second enrolment for the same email', async () => {
    const { seriesId } = await publishCourse();

    await request(app)
      .post(`/public/${slug}/courses/${seriesId}/enrollments`)
      .send(student);

    const second = await request(app)
      .post(`/public/${slug}/courses/${seriesId}/enrollments`)
      .send(student);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_ENROLLED');
  });

  it('cannot enrol on another studio\'s cohort through this studio\'s slug', async () => {
    const { seriesId } = await publishCourse();

    const stranger = await signUpStudio(app);
    const strangerOrg = await prisma.organization.findUniqueOrThrow({
      where: { id: stranger.organizationId },
    });

    const res = await request(app)
      .post(`/public/${strangerOrg.slug}/courses/${seriesId}/enrollments`)
      .send(student);

    expect(res.status).toBe(404);
  });

  it('records SMS consent only when it is given', async () => {
    const { seriesId } = await publishCourse();

    await request(app)
      .post(`/public/${slug}/courses/${seriesId}/enrollments`)
      .send({ ...student, smsConsent: true });

    const customer = await prisma.customer.findFirstOrThrow({
      where: { organizationId: studio.organizationId, email: 'ana@student.test' },
    });
    expect(customer.smsConsentAt).not.toBeNull();
  });
});
