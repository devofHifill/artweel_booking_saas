import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';

/**
 * W2.1 — the admin surface for course cohorts.
 *
 * The concurrency behaviour is pinned in tests/gate/course-enrollment. What is
 * under test here is everything a studio owner can do wrong through the API:
 * mismatched booking modes, capacity that outgrows the room, putting an empty
 * course on sale, and reaching into another studio's cohort.
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

async function makeCourseService(
  owner: Studio = studio,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post(`${owner.base}/services`)
    .set(owner.headers)
    .send({
      name: 'Six-Week Beginner Wheel',
      bookingMode: 'COURSE_SERIES',
      durationMinutes: 120,
      slotGranularityMinutes: 30,
      capacityMin: 1,
      capacityMax: 8,
      priceCents: 45000,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.service.id as string;
}

async function makeCohort(
  serviceTypeId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post(`${studio.base}/courses`)
    .set(studio.headers)
    .send({
      serviceTypeId,
      name: 'Beginner Wheel Throwing',
      cohortLabel: 'Autumn 2026 — Tuesdays',
      sessionCount: 6,
      capacity: 8,
      priceCents: 45000,
      ...overrides,
    });
  return res;
}

const dates = {
  rrule: 'FREQ=WEEKLY;BYDAY=TU',
  startLocalDate: '2026-09-01',
  localStartTime: '19:00',
};

describe('course cohorts', () => {
  it('creates a cohort in DRAFT, inheriting the studio timezone', async () => {
    const serviceTypeId = await makeCourseService();
    const res = await makeCohort(serviceTypeId);

    expect(res.status).toBe(201);
    expect(res.body.series.status).toBe('DRAFT');
    expect(res.body.series.timezone).toBe('America/New_York');
    expect(res.body.series.sessionCount).toBe(6);
  });

  it('refuses a cohort on a service that is not a course', async () => {
    const serviceTypeId = await makeCourseService(studio, {
      name: 'Drop-in Wheel Class',
      bookingMode: 'EVENT',
    });

    const res = await makeCohort(serviceTypeId);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WRONG_BOOKING_MODE');
  });

  it('refuses a cohort that seats more than the room holds', async () => {
    const serviceTypeId = await makeCourseService();
    const res = await makeCohort(serviceTypeId, { capacity: 20 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CAPACITY_ABOVE_SERVICE_MAX');
  });

  it('generates dated sessions and reports them in order', async () => {
    const serviceTypeId = await makeCourseService();
    const created = await makeCohort(serviceTypeId);
    const seriesId = created.body.series.id;

    const res = await request(app)
      .post(`${studio.base}/courses/${seriesId}/sessions`)
      .set(studio.headers)
      .send(dates);

    expect(res.status).toBe(201);
    expect(res.body.sessions).toHaveLength(6);
    expect(res.body.sessions[0].localDate).toBe('2026-09-01');
    expect(res.body.sessions[5].localDate).toBe('2026-10-06');
    // Nothing here lands on a DST transition, so no warnings.
    expect(res.body.warnings).toBeUndefined();
  });

  it('warns when a generated session lands in a daylight-saving gap', async () => {
    const serviceTypeId = await makeCourseService();
    const created = await makeCohort(serviceTypeId, { sessionCount: 1 });
    const seriesId = created.body.series.id;

    // 2026-03-08 is spring forward in the US; 02:30 does not exist that day.
    const res = await request(app)
      .post(`${studio.base}/courses/${seriesId}/sessions`)
      .set(studio.headers)
      .send({
        rrule: 'FREQ=WEEKLY;BYDAY=SU',
        startLocalDate: '2026-03-08',
        localStartTime: '02:30',
      });

    expect(res.status).toBe(201);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].resolution).toBe('shifted');
  });

  it('refuses to regenerate dates for a cohort that already has them', async () => {
    const serviceTypeId = await makeCourseService();
    const created = await makeCohort(serviceTypeId);
    const seriesId = created.body.series.id;

    await request(app)
      .post(`${studio.base}/courses/${seriesId}/sessions`)
      .set(studio.headers)
      .send(dates);

    const second = await request(app)
      .post(`${studio.base}/courses/${seriesId}/sessions`)
      .set(studio.headers)
      .send(dates);

    expect(second.status).toBe(409);
  });

  it('refuses to put a cohort on sale before it has dates', async () => {
    const serviceTypeId = await makeCourseService();
    const created = await makeCohort(serviceTypeId);

    const res = await request(app)
      .patch(`${studio.base}/courses/${created.body.series.id}`)
      .set(studio.headers)
      .send({ status: 'PUBLISHED' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_SESSIONS');
  });

  it('publishes a cohort once it has dates', async () => {
    const serviceTypeId = await makeCourseService();
    const created = await makeCohort(serviceTypeId);
    const seriesId = created.body.series.id;

    await request(app)
      .post(`${studio.base}/courses/${seriesId}/sessions`)
      .set(studio.headers)
      .send(dates);

    const res = await request(app)
      .patch(`${studio.base}/courses/${seriesId}`)
      .set(studio.headers)
      .send({ status: 'PUBLISHED' });

    expect(res.status).toBe(200);
    expect(res.body.series.status).toBe('PUBLISHED');
  });

  it('propagates a capacity change to every session', async () => {
    const serviceTypeId = await makeCourseService();
    const created = await makeCohort(serviceTypeId);
    const seriesId = created.body.series.id;

    await request(app)
      .post(`${studio.base}/courses/${seriesId}/sessions`)
      .set(studio.headers)
      .send(dates);

    const res = await request(app)
      .patch(`${studio.base}/courses/${seriesId}`)
      .set(studio.headers)
      .send({ capacity: 6 });

    expect(res.status).toBe(200);

    const sessions = await prisma.session.findMany({
      where: { courseSeriesId: seriesId },
    });
    expect(sessions).toHaveLength(6);
    expect(sessions.every((s) => s.capacity === 6)).toBe(true);
  });

  it('refuses to shrink a cohort below what is already sold', async () => {
    const serviceTypeId = await makeCourseService();
    const created = await makeCohort(serviceTypeId, { capacity: 4 });
    const seriesId = created.body.series.id;

    await request(app)
      .post(`${studio.base}/courses/${seriesId}/sessions`)
      .set(studio.headers)
      .send(dates);
    await request(app)
      .patch(`${studio.base}/courses/${seriesId}`)
      .set(studio.headers)
      .send({ status: 'PUBLISHED' });

    // Two students on the course.
    for (const label of ['ana', 'ben']) {
      const customer = await prisma.customer.create({
        data: {
          organizationId: studio.organizationId,
          name: label,
          email: `${label}@student.test`,
        },
      });
      const enrolled = await request(app)
        .post(`${studio.base}/courses/${seriesId}/enrollments`)
        .set(studio.headers)
        .send({ customerId: customer.id });
      expect(enrolled.status).toBe(201);
    }

    const res = await request(app)
      .patch(`${studio.base}/courses/${seriesId}`)
      .set(studio.headers)
      .send({ capacity: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CAPACITY_BELOW_COMMITTED');
  });

  it('lists the roster with remaining seats', async () => {
    const serviceTypeId = await makeCourseService();
    const created = await makeCohort(serviceTypeId, { capacity: 5 });
    const seriesId = created.body.series.id;

    await request(app)
      .post(`${studio.base}/courses/${seriesId}/sessions`)
      .set(studio.headers)
      .send(dates);

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Ana Vidal',
        email: 'ana@student.test',
      },
    });
    await request(app)
      .post(`${studio.base}/courses/${seriesId}/enrollments`)
      .set(studio.headers)
      .send({ customerId: customer.id, seats: 2 });

    const roster = await request(app)
      .get(`${studio.base}/courses/${seriesId}/enrollments`)
      .set(studio.headers);

    expect(roster.status).toBe(200);
    expect(roster.body.enrollments).toHaveLength(1);
    expect(roster.body.enrollments[0].customer.name).toBe('Ana Vidal');
    // One enrolment, six weeks booked.
    expect(roster.body.enrollments[0]._count.bookings).toBe(6);

    const detail = await request(app)
      .get(`${studio.base}/courses/${seriesId}`)
      .set(studio.headers);
    // Seats, not enrolment rows: two children on one enrolment is two places.
    expect(detail.body.series.enrolledCount).toBe(2);
    expect(detail.body.series.seatsRemaining).toBe(3);
  });

  it('cancels a cohort, its sessions and its enrolments together', async () => {
    const serviceTypeId = await makeCourseService();
    const created = await makeCohort(serviceTypeId);
    const seriesId = created.body.series.id;

    await request(app)
      .post(`${studio.base}/courses/${seriesId}/sessions`)
      .set(studio.headers)
      .send(dates);

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Ana Vidal',
        email: 'ana@student.test',
      },
    });
    await request(app)
      .post(`${studio.base}/courses/${seriesId}/enrollments`)
      .set(studio.headers)
      .send({ customerId: customer.id });

    const res = await request(app)
      .delete(`${studio.base}/courses/${seriesId}`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.body.series.status).toBe('CANCELLED');

    const sessions = await prisma.session.findMany({
      where: { courseSeriesId: seriesId },
    });
    expect(sessions.every((s) => s.status === 'CANCELLED')).toBe(true);

    const enrollments = await prisma.enrollment.findMany({
      where: { courseSeriesId: seriesId },
    });
    expect(enrollments.every((e) => e.status === 'CANCELLED')).toBe(true);

    // The instructor is free again — cancelling a course must release the
    // Tuesday evenings, or they can never be resold.
    const blocks = await prisma.staffTimeBlock.count({
      where: { organizationId: studio.organizationId },
    });
    expect(blocks).toBe(0);
  });
});

describe('course cohort access control', () => {
  it('hides another studio\'s cohort', async () => {
    const serviceTypeId = await makeCourseService();
    const created = await makeCohort(serviceTypeId);

    const stranger = await signUpStudio(app);

    // Their own base path, our cohort id — the tenant scope must not care that
    // the id is real.
    const res = await request(app)
      .get(`${stranger.base}/courses/${created.body.series.id}`)
      .set(stranger.headers);

    expect(res.status).toBe(404);
  });

  it('lets an instructor read the roster but not create a cohort', async () => {
    const serviceTypeId = await makeCourseService();
    const created = await makeCohort(serviceTypeId);
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    const read = await request(app)
      .get(`${studio.base}/courses/${created.body.series.id}/enrollments`)
      .set(instructor.headers);
    expect(read.status).toBe(200);

    const write = await request(app)
      .post(`${studio.base}/courses`)
      .set(instructor.headers)
      .send({
        serviceTypeId,
        name: 'Unauthorised cohort',
        sessionCount: 4,
        capacity: 4,
        priceCents: 1000,
      });
    expect(write.status).toBe(403);
  });

  it('refuses course cohorts on the Solo plan', async () => {
    const solo = await signUpStudio(app, { plan: 'SOLO' });

    const serviceTypeId = await makeCourseService(solo);

    const res = await request(app)
      .post(`${solo.base}/courses`)
      .set(solo.headers)
      .send({
        serviceTypeId,
        name: 'Beginner Wheel Throwing',
        sessionCount: 6,
        capacity: 8,
        priceCents: 45000,
      });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PLAN_UPGRADE_REQUIRED');
    // The message must name the plan that fixes it.
    expect(res.body.error.message).toContain('Studio');
  });
});
