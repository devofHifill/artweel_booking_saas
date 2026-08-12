import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';

/**
 * Scheduling drop-in classes.
 *
 * Until this existed, sessions could only be created by generating a course
 * cohort or by the seed script — so a studio could take a register for a class
 * it had no way to schedule.
 *
 * The interesting distinction under test is between a COURSE and a TERM OF
 * DROP-INS. A course with a hole in week four is broken, so cohort generation
 * rolls back whole. Twelve independent Saturdays are not, so a clash on one of
 * them skips that date and keeps the rest.
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
      name: 'Drop-in Wheel Class',
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMin: 1,
      capacityMax: 8,
      priceCents: 4500,
    });
  serviceId = service.body.service.id;

  const staff = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name: 'Rowan Pike', email: 'rowan@clay.test' });
  staffId = staff.body.staff.id;
});

function scheduleClass(overrides: Record<string, unknown> = {}) {
  return request(app)
    .post(`${studio.base}/sessions`)
    .set(studio.headers)
    .send({
      serviceTypeId: serviceId,
      startLocalDate: '2026-09-05',
      localStartTime: '10:00',
      capacity: 8,
      staffId,
      ...overrides,
    });
}

describe('scheduling a class', () => {
  it('creates one class at the wall-clock time given', async () => {
    const res = await scheduleClass();

    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0].localDate).toBe('2026-09-05');

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: res.body.created[0].id },
    });
    expect(session.localStartTime).toBe('10:00');
    expect(session.capacity).toBe(8);

    // 10:00 in New York on 5 Sept is 14:00 UTC (EDT, UTC-4).
    expect(session.startsAt.toISOString()).toBe('2026-09-05T14:00:00.000Z');
  });

  it('makes the instructor busy, so a clashing class is refused', async () => {
    const first = await scheduleClass();
    expect(first.status).toBe(201);

    const blocks = await prisma.staffTimeBlock.count({ where: { staffId } });
    expect(blocks).toBe(1);

    const clash = await scheduleClass({ localStartTime: '11:00' });

    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('STAFF_UNAVAILABLE');
  });

  it('allows a class that starts exactly when the previous one ends', async () => {
    await scheduleClass();

    // Two hours long, so 12:00 is adjacent rather than overlapping.
    const next = await scheduleClass({ localStartTime: '12:00' });
    expect(next.status).toBe(201);
  });

  it('refuses a loose class on a service that runs as a course', async () => {
    const courseService = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Six-Week Wheel',
        bookingMode: 'COURSE_SERIES',
        durationMinutes: 120,
        capacityMax: 8,
        priceCents: 45000,
      });

    const res = await scheduleClass({
      serviceTypeId: courseService.body.service.id,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WRONG_BOOKING_MODE');
  });

  it('refuses a class seating more than the room holds', async () => {
    const res = await scheduleClass({ capacity: 20 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CAPACITY_ABOVE_SERVICE_MAX');
  });

  it('needs owner or admin rights, not just membership', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    const res = await request(app)
      .post(`${studio.base}/sessions`)
      .set(instructor.headers)
      .send({
        serviceTypeId: serviceId,
        startLocalDate: '2026-09-05',
        localStartTime: '10:00',
        capacity: 8,
      });

    expect(res.status).toBe(403);
  });
});

describe('scheduling a run of classes', () => {
  it('creates a term of weekly drop-ins in one request', async () => {
    const res = await scheduleClass({
      repeat: { rrule: 'FREQ=WEEKLY;BYDAY=SA', count: 6 },
    });

    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(6);
    expect(res.body.skipped).toHaveLength(0);
    expect(res.body.created.map((c: { localDate: string }) => c.localDate)).toEqual([
      '2026-09-05',
      '2026-09-12',
      '2026-09-19',
      '2026-09-26',
      '2026-10-03',
      '2026-10-10',
    ]);
  });

  it('holds the wall-clock hour across a daylight-saving change', async () => {
    const res = await scheduleClass({
      startLocalDate: '2026-10-24',
      localStartTime: '10:00',
      repeat: { rrule: 'FREQ=WEEKLY;BYDAY=SA', count: 3 },
    });

    expect(res.status).toBe(201);

    const { DateTime } = await import('luxon');
    for (const created of res.body.created) {
      const local = DateTime.fromISO(created.startsAt, {
        zone: 'America/New_York',
      });
      expect(local.toFormat('HH:mm')).toBe('10:00');
    }

    // 2026-11-01 is the fall-back, so the last date sits on the other side.
    const utcHours = res.body.created.map((c: { startsAt: string }) =>
      new Date(c.startsAt).getUTCHours(),
    );
    expect(utcHours[0]).toBe(14); // EDT
    expect(utcHours[2]).toBe(15); // EST
  });

  it('skips a clashing date and keeps the rest', async () => {
    // Block the instructor on what would be the third Saturday.
    await scheduleClass({ startLocalDate: '2026-09-19' });

    const res = await scheduleClass({
      repeat: { rrule: 'FREQ=WEEKLY;BYDAY=SA', count: 4 },
    });

    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(3);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].localDate).toBe('2026-09-19');
  });

  it('fails outright when no date in the run can be scheduled', async () => {
    await scheduleClass({ startLocalDate: '2026-09-05' });
    await scheduleClass({ startLocalDate: '2026-09-12' });

    const res = await scheduleClass({
      repeat: { rrule: 'FREQ=WEEKLY;BYDAY=SA', count: 2 },
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALL_DATES_UNAVAILABLE');
  });

  it('refuses a recurrence rule that sets its own COUNT', async () => {
    const res = await scheduleClass({
      repeat: { rrule: 'FREQ=WEEKLY;BYDAY=SA;COUNT=3', count: 4 },
    });

    // 422, not 409: the schema rejects it before any date is resolved, so
    // nothing is scheduled on the way to finding out.
    expect(res.status).toBe(422);
    expect(await prisma.session.count()).toBe(0);
  });
});

describe('changing a class', () => {
  async function bookedClass(seats: number) {
    const created = await scheduleClass();
    const sessionId = created.body.created[0].id;

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Ana Vidal',
        email: 'ana@student.test',
      },
    });

    const { bookSeats } = await import('../../src/scheduling/booking.service');
    const booking = await bookSeats({
      organizationId: studio.organizationId,
      sessionId,
      customerId: customer.id,
      seats,
    });

    return { sessionId, booking };
  }

  it('resizes a class that has room', async () => {
    const { sessionId } = await bookedClass(2);

    const res = await request(app)
      .patch(`${studio.base}/sessions/${sessionId}`)
      .set(studio.headers)
      .send({ capacity: 4 });

    expect(res.status).toBe(200);
    expect(res.body.session.capacity).toBe(4);
  });

  it('refuses to shrink a class below what is already booked', async () => {
    const { sessionId } = await bookedClass(5);

    const res = await request(app)
      .patch(`${studio.base}/sessions/${sessionId}`)
      .set(studio.headers)
      .send({ capacity: 2 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CAPACITY_BELOW_COMMITTED');
  });

  it('refuses an instructor swap rather than half-doing it', async () => {
    const created = await scheduleClass();
    const other = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Sam Reed', email: 'sam@clay.test' });

    const res = await request(app)
      .patch(`${studio.base}/sessions/${created.body.created[0].id}`)
      .set(studio.headers)
      .send({ staffId: other.body.staff.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STAFF_CHANGE_UNSUPPORTED');
  });
});

describe('cancelling a class', () => {
  it('cancels its bookings, frees the seats and releases the instructor', async () => {
    const created = await scheduleClass();
    const sessionId = created.body.created[0].id;

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Ana Vidal',
        email: 'ana@student.test',
      },
    });
    const { bookSeats } = await import('../../src/scheduling/booking.service');
    await bookSeats({
      organizationId: studio.organizationId,
      sessionId,
      customerId: customer.id,
      seats: 2,
    });

    const res = await request(app)
      .delete(`${studio.base}/sessions/${sessionId}`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.body.bookingsCancelled).toBe(1);
    expect(res.body.session.status).toBe('CANCELLED');

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(0);

    const bookings = await prisma.booking.findMany({ where: { sessionId } });
    expect(bookings.every((b) => b.status === 'CANCELLED')).toBe(true);

    // The instructor is free again, so the slot can be resold.
    expect(await prisma.staffTimeBlock.count({ where: { staffId } })).toBe(0);

    const again = await scheduleClass();
    expect(again.status).toBe(201);
  });

  it("will not touch another studio's class", async () => {
    const created = await scheduleClass();
    const stranger = await signUpStudio(app);

    const res = await request(app)
      .delete(`${stranger.base}/sessions/${created.body.created[0].id}`)
      .set(stranger.headers);

    expect(res.status).toBe(404);
  });
});
