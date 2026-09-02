import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';

/**
 * G0 — a booking taken over the phone or at the counter.
 *
 * `createManualBooking` and `POST /bookings` have existed since Phase 1. The
 * only test touching them was `role-split.test.ts`, which asserts a 403 for an
 * instructor and a 201 for front desk — it proves the GUARD, and says nothing
 * about the booking that comes out the other side. Nothing in the client called
 * the route at all, so nothing else exercised it either.
 *
 * This covers what the 201 actually did: the seat count, the customer match,
 * and the two refusals that must not become overbooks.
 */

const app = createApp();

let studio: Studio;
let serviceId: string;
let sessionId: string;
let appointmentServiceId: string;
let staffId: string;

const CLASS_STARTS = new Date('2026-09-19T18:00:00Z');
const CLASS_ENDS = new Date('2026-09-19T20:00:00Z');

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

  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Beginner Wheel Throwing',
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMax: 8,
      priceCents: 9500,
    })
    .expect(201);
  serviceId = service.body.service.id;

  const appointment = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Private Wheel Lesson',
      bookingMode: 'APPOINTMENT',
      durationMinutes: 60,
      capacityMax: 1,
      priceCents: 12000,
    })
    .expect(201);
  appointmentServiceId = appointment.body.service.id;

  const { createSession } = await import('../../src/scheduling/session.service');
  const created = await createSession({
    organizationId: studio.organizationId,
    serviceTypeId: serviceId,
    startsAt: CLASS_STARTS,
    endsAt: CLASS_ENDS,
    timezone: 'America/New_York',
    localStartTime: '14:00',
    capacity: 8,
  });
  sessionId = created.id;

  const staff = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name: 'Rowan Pike', email: 'rowan@clay.test' });
  staffId = staff.body.staff.id;
});

function counterBooking(body: Record<string, unknown>) {
  return request(app)
    .post(`${studio.base}/bookings`)
    .set(studio.headers)
    .send(body);
}

describe('a booking taken at the counter', () => {
  it('takes the seats and shows up in the list', async () => {
    const res = await counterBooking({
      serviceTypeId: serviceId,
      sessionId,
      seats: 2,
      customer: { name: 'Mira Halloway', email: 'mira@example.test' },
      notes: 'Paid cash at the counter.',
    }).expect(201);

    expect(res.body.booking.seats).toBe(2);
    /*
      Priced from the SERVICE record, not from anything the request carried —
      the counter form deliberately has no amount field. Two places at £95.
    */
    expect(res.body.booking.totalCents).toBe(19_000);
    expect(res.body.booking.source).toBe('admin');

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(2);

    const list = await request(app)
      .get(`${studio.base}/bookings?limit=100`)
      .set(studio.headers)
      .expect(200);

    expect(
      list.body.bookings.some(
        (b: { customer: { email: string } }) =>
          b.customer.email === 'mira@example.test',
      ),
    ).toBe(true);
  });

  it('matches somebody who has booked before instead of duplicating them', async () => {
    const existing = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Mira Halloway',
        email: 'mira@example.test',
      },
    });

    /*
      Typed at the counter with different capitalisation, which is what actually
      happens when somebody reads an address down the phone. The service
      lowercases before matching; if it did not, the studio would slowly grow
      two records for the same person and their history would split between
      them.
    */
    const res = await counterBooking({
      serviceTypeId: serviceId,
      sessionId,
      seats: 1,
      customer: { name: 'Mira Halloway', email: 'Mira@Example.test' },
    }).expect(201);

    expect(res.body.booking.customerId).toBe(existing.id);

    const count = await prisma.customer.count({
      where: { organizationId: studio.organizationId },
    });
    expect(count).toBe(1);
  });

  it('refuses to overbook a full class', async () => {
    await counterBooking({
      serviceTypeId: serviceId,
      sessionId,
      seats: 8,
      customer: { name: 'A Whole Class', email: 'block@example.test' },
    }).expect(201);

    const res = await counterBooking({
      serviceTypeId: serviceId,
      sessionId,
      seats: 1,
      customer: { name: 'One Too Many', email: 'late@example.test' },
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(8);
  });

  it('refuses an appointment when the instructor is already teaching', async () => {
    /*
      A STAFFED session writes into `staff_time_blocks`, which is what a
      private lesson in the same hour then collides with. Sessions and
      appointments both write there precisely so Postgres can catch this —
      it cannot enforce exclusion across two tables.

      The point of the assertion is the STATUS: the exclusion constraint must
      surface as the app's own 4xx, not as a raw PrismaClientKnownRequestError
      and a 500.
    */
    const { createSession } = await import(
      '../../src/scheduling/session.service'
    );
    await createSession({
      organizationId: studio.organizationId,
      serviceTypeId: serviceId,
      staffId,
      startsAt: CLASS_STARTS,
      endsAt: CLASS_ENDS,
      timezone: 'America/New_York',
      localStartTime: '14:00',
      capacity: 8,
    });

    expect(await prisma.staffTimeBlock.count({ where: { staffId } })).toBe(1);

    const res = await counterBooking({
      serviceTypeId: appointmentServiceId,
      staffId,
      startsAt: new Date('2026-09-19T18:30:00Z').toISOString(),
      seats: 1,
      customer: { name: 'Late Caller', email: 'clash@example.test' },
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('refuses a class booking with no date', async () => {
    // The form cannot submit this, but the endpoint is public API surface and
    // the guard is in the service, not the schema.
    await counterBooking({
      serviceTypeId: serviceId,
      seats: 1,
      customer: { name: 'No Date', email: 'nodate@example.test' },
    }).expect(400);
  });
});
