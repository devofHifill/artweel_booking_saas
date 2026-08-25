import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';

/**
 * Deleting an instructor who has taught.
 *
 * The guard counted `booking.staffId` only, which is set for APPOINTMENTS — a
 * 1:1 lesson points at a staff member directly. A group class points at a
 * SESSION, and the session carries the instructor. So the common case for a
 * ceramics studio — somebody who only ever taught group classes — sailed through
 * the check and was hard-deleted.
 *
 * It failed silently rather than loudly: `Session.staff` and `CourseSeries.staff`
 * are `onDelete: SetNull`, so every class they had ever taught quietly became a
 * class nobody taught, past ones included.
 *
 * Nothing in the product could reach the delete path until the Staff page
 * shipped, which is why this was still latent.
 */

const app = createApp();
let studio: Studio;
let serviceId: string;
let staffId: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  studio = await signUpStudio(app);

  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Wheel Throwing',
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMin: 1,
      capacityMax: 8,
      priceCents: 6500,
    })
    .expect(201);
  serviceId = service.body.service.id;

  const staff = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name: 'Rowan Pike', email: 'rowan@clay.test' })
    .expect(201);
  staffId = staff.body.staff.id;
});

const soon = () => new Date(Date.now() + 3 * 86_400_000);

async function scheduleClassWith(staff: string | null, at?: Date) {
  const startsAt = at ?? soon();
  return prisma.session.create({
    data: {
      organizationId: studio.organizationId,
      serviceTypeId: serviceId,
      staffId: staff,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
      timezone: 'America/New_York',
      localStartTime: '18:00',
      capacity: 8,
    },
  });
}

describe('removing an instructor', () => {
  it('allows it when they have taught nothing', async () => {
    await request(app)
      .delete(`${studio.base}/staff/${staffId}`)
      .set(studio.headers)
      .expect(204);
  });

  /** The case that was wrong: a group class, not an appointment. */
  it('refuses when they are teaching a class', async () => {
    await scheduleClassWith(staffId);

    const res = await request(app)
      .delete(`${studio.base}/staff/${staffId}`)
      .set(studio.headers)
      .expect(409);

    expect(res.body.error?.code ?? res.body.code).toBe('STAFF_IN_USE');
  });

  it('refuses when they are leading a course', async () => {
    const courseService = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Six-Week Wheel',
        bookingMode: 'COURSE_SERIES',
        durationMinutes: 120,
        capacityMin: 1,
        capacityMax: 8,
        priceCents: 45000,
      })
      .expect(201);

    await prisma.courseSeries.create({
      data: {
        organizationId: studio.organizationId,
        serviceTypeId: courseService.body.service.id,
        staffId,
        name: 'Six-Week Wheel',
        sessionCount: 6,
        priceCents: 45000,
        capacity: 8,
        timezone: 'America/New_York',
      },
    });

    await request(app)
      .delete(`${studio.base}/staff/${staffId}`)
      .set(studio.headers)
      .expect(409);
  });

  it('refuses when they have an appointment, as it always did', async () => {
    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Jane Potter',
        email: `jane-${randomBytes(3).toString('hex')}@example.test`,
      },
    });

    const startsAt = soon();
    await prisma.booking.create({
      data: {
        organizationId: studio.organizationId,
        customerId: customer.id,
        serviceTypeId: serviceId,
        staffId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        status: 'CONFIRMED',
        seats: 1,
        totalCents: 6500,
        timezone: 'America/New_York',
        cancelToken: randomBytes(32),
      },
    });

    await request(app)
      .delete(`${studio.base}/staff/${staffId}`)
      .set(studio.headers)
      .expect(409);
  });

  /**
   * The consequence the guard exists to prevent, asserted directly.
   *
   * Without it the delete succeeds and the session survives with a null
   * instructor — no error, no warning, and a past class that nobody taught.
   */
  it('leaves taught classes with their instructor intact', async () => {
    const session = await scheduleClassWith(staffId);

    await request(app)
      .delete(`${studio.base}/staff/${staffId}`)
      .set(studio.headers)
      .expect(409);

    const after = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
      select: { staffId: true },
    });
    expect(after.staffId).toBe(staffId);
  });

  /**
   * The route the 409 points at, for somebody whose teaching is behind them.
   *
   * A past class is history — exactly what the delete guard protects — while
   * nothing is on the books, so deactivating is safe and allowed.
   */
  it('lets you deactivate someone whose classes are in the past', async () => {
    await scheduleClassWith(staffId, new Date(Date.now() - 30 * 86_400_000));

    const res = await request(app)
      .patch(`${studio.base}/staff/${staffId}`)
      .set(studio.headers)
      .send({ isActive: false })
      .expect(200);

    expect(res.body.staff.isActive).toBe(false);
  });

  /**
   * The full advice chain, pinned.
   *
   * Somebody still teaching next week cannot be deleted (history) and cannot be
   * deactivated either (availability would stop offering them while their booked
   * classes stayed live, so customers would turn up to a class the system thinks
   * has no instructor). Each refusal names the next step: delete says
   * "deactivate instead", deactivate says "reassign or cancel first".
   *
   * Worth asserting because the two guards are in different functions with
   * different conditions, and it would be easy to change one into advice that
   * leads nowhere.
   */
  it('sends you from delete to deactivate to reassign, in that order', async () => {
    await scheduleClassWith(staffId);

    const deleted = await request(app)
      .delete(`${studio.base}/staff/${staffId}`)
      .set(studio.headers)
      .expect(409);
    expect(deleted.body.error?.code ?? deleted.body.code).toBe('STAFF_IN_USE');

    const deactivated = await request(app)
      .patch(`${studio.base}/staff/${staffId}`)
      .set(studio.headers)
      .send({ isActive: false })
      .expect(409);
    expect(deactivated.body.error?.code ?? deactivated.body.code).toBe(
      'STAFF_HAS_UPCOMING',
    );
  });
});

/**
 * D6 — the rota summary above the staff list.
 *
 * The route is registered BEFORE `/:staffId`, and that ordering is the whole
 * risk: with it reversed, Express matches "summary" as a staff id and the
 * endpoint 404s on a lookup nobody asked for. The first test here is the one
 * that catches a future reshuffle.
 */
describe('the rota summary', () => {
  it('is not swallowed by the :staffId route', async () => {
    const res = await request(app)
      .get(`${studio.base}/staff/summary`)
      .set(studio.headers)
      .expect(200);

    expect(res.body).toHaveProperty('team');
    expect(res.body).toHaveProperty('unassignedThisWeek');
  });

  it('counts a class with nobody assigned', async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000);

    await prisma.session.create({
      data: {
        organizationId: studio.organizationId,
        serviceTypeId: serviceId,
        staffId: null,
        startsAt: soon,
        endsAt: new Date(soon.getTime() + 2 * 3_600_000),
        timezone: 'America/New_York',
        localStartTime: '14:00',
        capacity: 8,
        seatsTaken: 0,
      },
    });

    const res = await request(app)
      .get(`${studio.base}/staff/summary`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.unassignedThisWeek).toBe(1);
    expect(res.body.classesThisWeek).toBe(0);
  });

  it('does not count another studio classes', async () => {
    const other = await signUpStudio(app);

    const res = await request(app)
      .get(`${other.base}/staff/summary`)
      .set(other.headers)
      .expect(200);

    expect(res.body.team).toBe(0);
    expect(res.body.unassignedThisWeek).toBe(0);
  });
});
