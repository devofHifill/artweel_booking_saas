import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * The dashboard API.
 *
 * The rule under test throughout: a studio taking a booking over the phone is
 * subject to exactly the same rules as a customer on the website. A back door
 * that skips the scheduling core is how double bookings get created by the
 * people least able to explain them.
 */

const app = createApp();
let studio: Studio;
let staffId: string;
let appointmentId: string;
let classId: string;
let sessionId: string;

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

  const staff = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name: 'Rowan Pike', email: 'rowan@clay.test', timezone: 'America/New_York' });
  staffId = staff.body.staff.id;

  const appointment = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Private Wheel Lesson',
      bookingMode: 'APPOINTMENT',
      durationMinutes: 60,
      slotGranularityMinutes: 60,
      capacityMax: 1,
      priceCents: 12_000,
    });
  appointmentId = appointment.body.service.id;

  await request(app)
    .put(`${studio.base}/services/${appointmentId}/staff`)
    .set(studio.headers)
    .send({ staffIds: [staffId] });

  await request(app)
    .post(`${studio.base}/schedules/${staffId}/rules`)
    .set(studio.headers)
    .send({
      ruleType: 'WORKING',
      rrule: 'FREQ=DAILY',
      startMinute: 9 * 60,
      endMinute: 18 * 60,
      effectiveFrom: '2026-01-01T00:00:00Z',
    });

  const klass = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Beginner Wheel Throwing',
      bookingMode: 'EVENT',
      durationMinutes: 180,
      capacityMax: 8,
      priceCents: 9500,
    });
  classId = klass.body.service.id;

  const { createSession } = await import('../../src/scheduling/session.service');
  const created = await createSession({
    organizationId: studio.organizationId,
    serviceTypeId: classId,
    startsAt: new Date('2026-09-19T18:00:00Z'),
    endsAt: new Date('2026-09-19T21:00:00Z'),
    timezone: 'America/New_York',
    localStartTime: '14:00',
    capacity: 8,
  });
  sessionId = created.id;
});

const AT = (iso: string) => new Date(iso).toISOString();

async function bookAppointment(startsAt: string, name = 'Ada Potter') {
  return request(app)
    .post(`${studio.base}/bookings`)
    .set(studio.headers)
    .send({
      serviceTypeId: appointmentId,
      staffId,
      startsAt,
      seats: 1,
      customer: { name, email: `${name.split(' ')[0]!.toLowerCase()}@student.test` },
    });
}

describe('manual booking', () => {
  it('takes a booking over the counter', async () => {
    const res = await bookAppointment(AT('2026-09-15T14:00:00Z'));

    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe('CONFIRMED');
    expect(res.body.booking.source).toBe('admin');
    expect(res.body.booking.totalCents).toBe(12_000);
  });

  it('is subject to the same overlap rules as the public page', async () => {
    // The back door does not bypass the scheduling core.
    await bookAppointment(AT('2026-09-15T14:00:00Z'), 'Ada Potter');

    const clash = await bookAppointment(AT('2026-09-15T14:30:00Z'), 'Jo Mercer');

    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('STAFF_UNAVAILABLE');
  });

  it('ignores the minimum notice window', async () => {
    // The rule exists to stop a website booking that leaves no prep time. A
    // customer standing at the desk is exactly who it was never meant to stop.
    await request(app)
      .patch(`${studio.base}/services/${appointmentId}`)
      .set(studio.headers)
      .send({ minNoticeMinutes: 48 * 60 });

    const soon = new Date(Date.now() + 30 * 60_000);
    // Land on the hour so it sits inside working hours.
    soon.setUTCHours(15, 0, 0, 0);

    const res = await bookAppointment(soon.toISOString(), 'Walk In');
    expect(res.status).toBe(201);
  });

  it('reuses an existing customer rather than duplicating them', async () => {
    await bookAppointment(AT('2026-09-15T14:00:00Z'), 'Ada Potter');
    await bookAppointment(AT('2026-09-16T14:00:00Z'), 'Ada Potter');

    const customers = await prisma.customer.count({
      where: { organizationId: studio.organizationId },
    });
    expect(customers).toBe(1);
  });

  it('refuses to oversell a class', async () => {
    const first = await request(app)
      .post(`${studio.base}/bookings`)
      .set(studio.headers)
      .send({
        serviceTypeId: classId,
        sessionId,
        seats: 8,
        customer: { name: 'Group', email: 'group@student.test' },
      });
    expect(first.status).toBe(201);

    const overflow = await request(app)
      .post(`${studio.base}/bookings`)
      .set(studio.headers)
      .send({
        serviceTypeId: classId,
        sessionId,
        seats: 1,
        customer: { name: 'Latecomer', email: 'late@student.test' },
      });

    expect(overflow.status).toBe(409);
    expect(overflow.body.error.code).toBe('SESSION_FULL');
  });
});

describe('rescheduling', () => {
  it('moves an appointment to a free time', async () => {
    const booked = await bookAppointment(AT('2026-09-15T14:00:00Z'));

    const res = await request(app)
      .post(`${studio.base}/bookings/${booked.body.booking.id}/reschedule`)
      .set(studio.headers)
      .send({ startsAt: AT('2026-09-15T16:00:00Z') });

    expect(res.status).toBe(200);
    expect(new Date(res.body.booking.startsAt).toISOString()).toBe(
      AT('2026-09-15T16:00:00Z'),
    );

    // Cancel-then-rebook leaves the original as an audit record.
    const original = await prisma.booking.findUniqueOrThrow({
      where: { id: booked.body.booking.id },
    });
    expect(original.status).toBe('CANCELLED');
  });

  it('refuses a move onto a time the instructor is already busy', async () => {
    const first = await bookAppointment(AT('2026-09-15T14:00:00Z'), 'Ada Potter');
    await bookAppointment(AT('2026-09-15T16:00:00Z'), 'Jo Mercer');

    const res = await request(app)
      .post(`${studio.base}/bookings/${first.body.booking.id}/reschedule`)
      .set(studio.headers)
      .send({ startsAt: AT('2026-09-15T16:00:00Z') });

    expect(res.status).toBe(409);

    // And the original survives the failed move — the customer is not left
    // with nothing at all.
    const original = await prisma.booking.findUniqueOrThrow({
      where: { id: first.body.booking.id },
    });
    expect(original.status).toBe('CANCELLED');

    const active = await prisma.booking.count({
      where: {
        organizationId: studio.organizationId,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
    });
    expect(active).toBe(2);
  });

  it('refuses to drag a class booking', async () => {
    const booked = await request(app)
      .post(`${studio.base}/bookings`)
      .set(studio.headers)
      .send({
        serviceTypeId: classId,
        sessionId,
        seats: 1,
        customer: { name: 'Ada', email: 'ada@student.test' },
      });

    const res = await request(app)
      .post(`${studio.base}/bookings/${booked.body.booking.id}/reschedule`)
      .set(studio.headers)
      .send({ startsAt: AT('2026-09-20T18:00:00Z') });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_RESCHEDULABLE');
  });
});

describe('cancelling', () => {
  it('cancels and frees the slot', async () => {
    const booked = await bookAppointment(AT('2026-09-15T14:00:00Z'));

    const res = await request(app)
      .post(`${studio.base}/bookings/${booked.body.booking.id}/cancel`)
      .set(studio.headers)
      .send({ refund: false });

    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(true);

    // The instructor is genuinely free again.
    const rebook = await bookAppointment(AT('2026-09-15T14:00:00Z'), 'Jo Mercer');
    expect(rebook.status).toBe(201);
  });

  it('reports bulk results per booking rather than all-or-nothing', async () => {
    // A studio cancelling a snow day needs to know which ones actually went.
    const a = await bookAppointment(AT('2026-09-15T14:00:00Z'), 'Ada Potter');
    const b = await bookAppointment(AT('2026-09-15T16:00:00Z'), 'Jo Mercer');

    const res = await request(app)
      .post(`${studio.base}/bookings/bulk/cancel`)
      .set(studio.headers)
      .send({
        bookingIds: [
          a.body.booking.id,
          b.body.booking.id,
          '00000000-0000-4000-8000-000000000000',
        ],
        refund: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(2);
    expect(res.body.failed).toBe(1);
    expect(res.body.results).toHaveLength(3);
  });

  it('restricts bulk cancel to owners and admins', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );
    const booked = await bookAppointment(AT('2026-09-15T14:00:00Z'));

    const res = await request(app)
      .post(`${studio.base}/bookings/bulk/cancel`)
      .set(instructor.headers)
      .send({ bookingIds: [booked.body.booking.id] });

    expect(res.status).toBe(403);
  });
});

describe('the today view', () => {
  it('uses the studio day, not UTC', async () => {
    // 01:00 UTC is still the previous evening in New York. A booking at that
    // moment belongs to yesterday's list, not today's.
    const res = await request(app)
      .get(`${studio.base}/bookings/today`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('America/New_York');
    expect(res.body.stats).toHaveProperty('todayCount');
  });

  it('warns when payments are not connected', async () => {
    const res = await request(app)
      .get(`${studio.base}/bookings/today`)
      .set(studio.headers);

    // A studio cannot discover this on its own until a customer tries to pay.
    expect(res.body.alerts.paymentsNotEnabled).toBe(true);
  });

  it('surfaces calendar connections that stopped working', async () => {
    await prisma.calendarConnection.create({
      data: {
        organizationId: studio.organizationId,
        staffId,
        accessTokenEnc: 'v1.x.y.z',
        status: 'NEEDS_REAUTH',
      },
    });

    const res = await request(app)
      .get(`${studio.base}/bookings/today`)
      .set(studio.headers);

    expect(res.body.alerts.calendarsNeedingReauth).toBe(1);
  });
});

describe('listing and search', () => {
  it('finds a booking by customer email', async () => {
    await bookAppointment(AT('2026-09-15T14:00:00Z'), 'Ada Potter');
    await bookAppointment(AT('2026-09-15T16:00:00Z'), 'Jo Mercer');

    const res = await request(app)
      .get(`${studio.base}/bookings?search=jo@student`)
      .set(studio.headers);

    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.bookings[0].customer.name).toBe('Jo Mercer');
  });

  it('reports what is still owed', async () => {
    const booked = await bookAppointment(AT('2026-09-15T14:00:00Z'));

    const res = await request(app)
      .get(`${studio.base}/bookings?search=ada`)
      .set(studio.headers);

    const row = res.body.bookings[0];
    expect(row.totalCents).toBe(12_000);
    expect(row.paidCents).toBe(0);
    expect(row.outstandingCents).toBe(12_000);
    expect(booked.status).toBe(201);
  });

  it('never returns another studio bookings', async () => {
    await bookAppointment(AT('2026-09-15T14:00:00Z'));

    const other = await signUpStudio(app);
    const res = await request(app)
      .get(`${other.base}/bookings`)
      .set(other.headers);

    expect(res.body.bookings).toHaveLength(0);
  });
});

describe('customers', () => {
  it('does not count a cancelled booking against a customer history', async () => {
    // A reschedule is cancel-then-rebook, so counting cancelled rows would
    // show "2 bookings" for one moved appointment.
    const booked = await bookAppointment(AT('2026-09-15T14:00:00Z'));

    await request(app)
      .post(`${studio.base}/bookings/${booked.body.booking.id}/reschedule`)
      .set(studio.headers)
      .send({ startsAt: AT('2026-09-15T16:00:00Z') });

    const list = await request(app)
      .get(`${studio.base}/customers`)
      .set(studio.headers);

    expect(list.body.customers[0]._count.bookings).toBe(1);

    const detail = await request(app)
      .get(`${studio.base}/customers/${list.body.customers[0].id}`)
      .set(studio.headers);

    expect(detail.body.customer.stats.total).toBe(1);
  });

  it('refuses a customer belonging to another studio', async () => {
    await bookAppointment(AT('2026-09-15T14:00:00Z'));
    const customer = await prisma.customer.findFirstOrThrow({});

    const other = await signUpStudio(app);
    const res = await request(app)
      .get(`${other.base}/customers/${customer.id}`)
      .set(other.headers);

    expect(res.status).toBe(404);
  });
});
