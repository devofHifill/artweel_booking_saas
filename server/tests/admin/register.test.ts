import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';

/**
 * W2.2 — attendance registers.
 *
 * A register belongs to a session, so the same endpoint serves week three of a
 * course and a Saturday drop-in. The cases that matter are the ones that keep
 * the record trustworthy: you cannot mark a class that has not happened, you
 * cannot mark somebody who cancelled, and a request naming a booking from
 * another class is refused whole rather than applied in part.
 *
 * Make-up credits are NOT here. They rest on studio-specific policy and are
 * deliberately left until that has been asked about; what this gives them is
 * the absence data they will be computed from.
 */

const app = createApp();
let studio: Studio;
let serviceId: string;

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
      durationMinutes: 180,
      capacityMax: 8,
      priceCents: 0,
    });
  serviceId = service.body.service.id;
});

/** A class in the past, so its register can actually be marked. */
async function pastClass(startsAt = '2026-08-04T18:00:00Z') {
  const { createSession } = await import('../../src/scheduling/session.service');
  return createSession({
    organizationId: studio.organizationId,
    serviceTypeId: serviceId,
    startsAt: new Date(startsAt),
    endsAt: new Date(new Date(startsAt).getTime() + 3 * 3_600_000),
    timezone: 'America/New_York',
    localStartTime: '14:00',
    capacity: 8,
  });
}

async function futureClass() {
  return pastClass('2027-06-01T18:00:00Z');
}

async function book(sessionId: string, label: string) {
  const customer = await prisma.customer.create({
    data: {
      organizationId: studio.organizationId,
      name: label,
      email: `${label}@student.test`,
    },
  });

  const { bookSeats } = await import('../../src/scheduling/booking.service');
  return bookSeats({
    organizationId: studio.organizationId,
    sessionId,
    customerId: customer.id,
    seats: 1,
  });
}

describe('session register', () => {
  it('lists everyone expected in the room', async () => {
    const session = await pastClass();
    await book(session.id, 'ana');
    await book(session.id, 'ben');

    const res = await request(app)
      .get(`${studio.base}/sessions/${session.id}/register`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.markable).toBe(true);
    expect(res.body.session.capacity).toBe(8);
    expect(res.body.entries.map((e: { customer: { name: string } }) => e.customer.name).sort())
      .toEqual(['ana', 'ben']);
  });

  it('leaves a cancelled booking off the register entirely', async () => {
    const session = await pastClass();
    const staying = await book(session.id, 'ana');
    const leaving = await book(session.id, 'ben');

    const { cancelBooking } = await import('../../src/scheduling/booking.service');
    await cancelBooking(studio.organizationId, leaving!.id);

    const res = await request(app)
      .get(`${studio.base}/sessions/${session.id}/register`)
      .set(studio.headers);

    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].bookingId).toBe(staying!.id);
  });

  it('marks a whole class in one request', async () => {
    const session = await pastClass();
    const ana = await book(session.id, 'ana');
    const ben = await book(session.id, 'ben');

    const res = await request(app)
      .post(`${studio.base}/sessions/${session.id}/register`)
      .set(studio.headers)
      .send({
        entries: [
          { bookingId: ana!.id, status: 'ATTENDED' },
          { bookingId: ben!.id, status: 'NO_SHOW' },
        ],
      });

    expect(res.status).toBe(200);

    const byId = Object.fromEntries(
      res.body.entries.map((e: { bookingId: string; status: string }) => [
        e.bookingId,
        e.status,
      ]),
    );
    expect(byId[ana!.id]).toBe('ATTENDED');
    expect(byId[ben!.id]).toBe('NO_SHOW');
  });

  it('lets a mistake be undone by marking back to CONFIRMED', async () => {
    const session = await pastClass();
    const ana = await book(session.id, 'ana');

    await request(app)
      .post(`${studio.base}/sessions/${session.id}/register`)
      .set(studio.headers)
      .send({ entries: [{ bookingId: ana!.id, status: 'NO_SHOW' }] });

    const res = await request(app)
      .post(`${studio.base}/sessions/${session.id}/register`)
      .set(studio.headers)
      .send({ entries: [{ bookingId: ana!.id, status: 'CONFIRMED' }] });

    expect(res.status).toBe(200);
    expect(res.body.entries[0].status).toBe('CONFIRMED');
  });

  it('refuses to mark a class that has not started', async () => {
    const session = await futureClass();
    const ana = await book(session.id, 'ana');

    const read = await request(app)
      .get(`${studio.base}/sessions/${session.id}/register`)
      .set(studio.headers);
    expect(read.body.markable).toBe(false);

    const res = await request(app)
      .post(`${studio.base}/sessions/${session.id}/register`)
      .set(studio.headers)
      .send({ entries: [{ bookingId: ana!.id, status: 'ATTENDED' }] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_NOT_STARTED');
  });

  it('refuses a booking that belongs to a different class, without marking any', async () => {
    const session = await pastClass();
    const other = await pastClass('2026-08-05T18:00:00Z');

    const ana = await book(session.id, 'ana');
    const stranger = await book(other.id, 'ben');

    const res = await request(app)
      .post(`${studio.base}/sessions/${session.id}/register`)
      .set(studio.headers)
      .send({
        entries: [
          { bookingId: ana!.id, status: 'ATTENDED' },
          { bookingId: stranger!.id, status: 'ATTENDED' },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_ON_REGISTER');

    // All or nothing: Ana must NOT have been marked on the way to failing.
    const unchanged = await prisma.booking.findUniqueOrThrow({
      where: { id: ana!.id },
    });
    expect(unchanged.status).toBe('CONFIRMED');
  });

  it('refuses to record attendance against a cancelled booking', async () => {
    const session = await pastClass();
    const ana = await book(session.id, 'ana');

    const { cancelBooking } = await import('../../src/scheduling/booking.service');
    await cancelBooking(studio.organizationId, ana!.id);

    // Straight at the per-booking endpoint, since the register hides it.
    const res = await request(app)
      .post(`${studio.base}/bookings/${ana!.id}/attendance`)
      .set(studio.headers)
      .send({ status: 'NO_SHOW' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_CANCELLED');
  });

  it('lets an instructor take the register', async () => {
    const session = await pastClass();
    const ana = await book(session.id, 'ana');
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    const res = await request(app)
      .post(`${studio.base}/sessions/${session.id}/register`)
      .set(instructor.headers)
      .send({ entries: [{ bookingId: ana!.id, status: 'ATTENDED' }] });

    expect(res.status).toBe(200);
  });

  it("hides another studio's session", async () => {
    const session = await pastClass();
    const stranger = await signUpStudio(app);

    const res = await request(app)
      .get(`${stranger.base}/sessions/${session.id}/register`)
      .set(stranger.headers);

    expect(res.status).toBe(404);
  });
});

describe('session listing', () => {
  it('reports how much of each register is still outstanding', async () => {
    const session = await pastClass();
    const ana = await book(session.id, 'ana');
    await book(session.id, 'ben');

    await request(app)
      .post(`${studio.base}/sessions/${session.id}/register`)
      .set(studio.headers)
      .send({ entries: [{ bookingId: ana!.id, status: 'ATTENDED' }] });

    const res = await request(app)
      .get(`${studio.base}/sessions`)
      .query({ from: '2026-08-01', to: '2026-08-31' })
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].attendance).toMatchObject({
      attended: 1,
      noShow: 0,
      outstanding: 1,
    });
  });

  it('excludes sessions outside the window', async () => {
    await pastClass('2026-08-04T18:00:00Z');
    await pastClass('2026-09-04T18:00:00Z');

    const res = await request(app)
      .get(`${studio.base}/sessions`)
      .query({ from: '2026-08-01', to: '2026-08-31' })
      .set(studio.headers);

    expect(res.body.sessions).toHaveLength(1);
  });
});

describe('course attendance', () => {
  it('counts attendance per student across the whole course', async () => {
    // A three-week course that has already run.
    const courseService = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Three-Week Wheel',
        bookingMode: 'COURSE_SERIES',
        durationMinutes: 120,
        capacityMax: 8,
        priceCents: 0,
      });

    const created = await request(app)
      .post(`${studio.base}/courses`)
      .set(studio.headers)
      .send({
        serviceTypeId: courseService.body.service.id,
        name: 'Beginner Wheel',
        sessionCount: 3,
        capacity: 8,
        priceCents: 0,
      });
    const seriesId = created.body.series.id;

    const generated = await request(app)
      .post(`${studio.base}/courses/${seriesId}/sessions`)
      .set(studio.headers)
      .send({
        rrule: 'FREQ=WEEKLY;BYDAY=TU',
        startLocalDate: '2026-07-07',
        localStartTime: '19:00',
      });
    const weeks = generated.body.sessions;

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

    // Came to week one, missed week two, week three never marked.
    for (const [index, status] of [
      [0, 'ATTENDED'],
      [1, 'NO_SHOW'],
    ] as const) {
      const register = await request(app)
        .get(`${studio.base}/sessions/${weeks[index].id}/register`)
        .set(studio.headers);

      await request(app)
        .post(`${studio.base}/sessions/${weeks[index].id}/register`)
        .set(studio.headers)
        .send({
          entries: [{ bookingId: register.body.entries[0].bookingId, status }],
        });
    }

    const roster = await request(app)
      .get(`${studio.base}/courses/${seriesId}/enrollments`)
      .set(studio.headers);

    expect(roster.status).toBe(200);
    expect(roster.body.enrollments[0].attendance).toMatchObject({
      attended: 1,
      missed: 1,
      upcoming: 0,
      unmarked: 1,
    });
  });
});
