import { randomBytes } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';

/**
 * S13 (the half worth doing) — INSTRUCTOR and FRONT_DESK stop being the same
 * role.
 *
 * `requireMember` covers all four roles, so until now an instructor and a front
 * desk account had identical authority: an instructor could cancel any booking
 * in the studio, sell a class pack, redeem a credit, and rewrite a colleague's
 * availability. Nobody noticed, because `register` only ever minted an OWNER
 * and no instructor account had ever existed to try it. S9 made them reachable;
 * this makes them mean something.
 *
 * Three of the guards changed here had a COMMENT already claiming the rule the
 * guard did not enforce — "instructors may mark their own time off", "selling
 * one to somebody standing at the desk is front desk work". The intent was
 * written down and then not implemented, which is the failure this file exists
 * to keep closed.
 */

const app = createApp();

let studio: Studio;
let instructor: Studio;
let frontDesk: Studio;
let serviceId: string;
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
  instructor = await addMemberToStudio(app, studio.organizationId, 'INSTRUCTOR');
  frontDesk = await addMemberToStudio(app, studio.organizationId, 'FRONT_DESK');

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

  const { createSession } = await import('../../src/scheduling/session.service');
  const created = await createSession({
    organizationId: studio.organizationId,
    serviceTypeId: serviceId,
    startsAt: new Date('2026-09-19T18:00:00Z'),
    endsAt: new Date('2026-09-19T20:00:00Z'),
    timezone: 'America/New_York',
    localStartTime: '14:00',
    capacity: 8,
  });
  sessionId = created.id;
});

async function makeBooking() {
  const customer = await prisma.customer.create({
    data: {
      organizationId: studio.organizationId,
      name: 'Ada Potter',
      email: `ada-${randomBytes(3).toString('hex')}@student.test`,
    },
  });

  return prisma.booking.create({
    data: {
      organizationId: studio.organizationId,
      customerId: customer.id,
      serviceTypeId: serviceId,
      sessionId,
      startsAt: new Date('2026-09-19T18:00:00Z'),
      endsAt: new Date('2026-09-19T20:00:00Z'),
      status: 'CONFIRMED',
      seats: 1,
      totalCents: 9500,
      timezone: 'America/New_York',
      cancelToken: randomBytes(32),
    },
  });
}

describe('the counter, not the classroom', () => {
  it('lets front desk cancel a booking and refuses an instructor', async () => {
    const forDesk = await makeBooking();
    const forInstructor = await makeBooking();

    await request(app)
      .post(`${studio.base}/bookings/${forDesk.id}/cancel`)
      .set(frontDesk.headers)
      .send({ refund: false })
      .expect(200);

    const refused = await request(app)
      .post(`${studio.base}/bookings/${forInstructor.id}/cancel`)
      .set(instructor.headers)
      .send({ refund: false });

    expect(refused.status).toBe(403);

    // And the booking is untouched — refused before the handler, not inside it.
    const after = await prisma.booking.findUniqueOrThrow({
      where: { id: forInstructor.id },
    });
    expect(after.status).toBe('CONFIRMED');
  });

  it('refuses an instructor taking a booking at the counter', async () => {
    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Walk In',
        email: 'walkin@student.test',
      },
    });

    const body = {
      serviceTypeId: serviceId,
      sessionId,
      seats: 1,
      customer: { name: customer.name, email: customer.email },
    };

    await request(app)
      .post(`${studio.base}/bookings`)
      .set(instructor.headers)
      .send(body)
      .expect(403);

    await request(app)
      .post(`${studio.base}/bookings`)
      .set(frontDesk.headers)
      .send(body)
      .expect(201);
  });

  it('refuses an instructor rescheduling somebody', async () => {
    const booking = await makeBooking();

    await request(app)
      .post(`${studio.base}/bookings/${booking.id}/reschedule`)
      .set(instructor.headers)
      .send({ startsAt: '2026-09-26T18:00:00Z' })
      .expect(403);
  });

  /**
   * The pack module's own header has said "selling one to somebody standing at
   * the desk is front desk work" since it was written. The guard said
   * `requireMember`, and the guard is what ran.
   */
  it('refuses an instructor selling a class pack', async () => {
    const pack = await request(app)
      .post(`${studio.base}/packs`)
      .set(studio.headers)
      .send({ name: 'Ten classes', creditCount: 10, priceCents: 80_000 })
      .expect(201);

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Buyer',
        email: 'buyer@student.test',
      },
    });

    await request(app)
      .post(`${studio.base}/packs/${pack.body.pack.id}/sell`)
      .set(instructor.headers)
      .send({ customerId: customer.id })
      .expect(403);

    await request(app)
      .post(`${studio.base}/packs/${pack.body.pack.id}/sell`)
      .set(frontDesk.headers)
      .send({ customerId: customer.id })
      .expect(201);
  });
});

describe('the classroom, not the counter', () => {
  it('still lets an instructor take the register', async () => {
    /*
      A class that has already STARTED. `markAttendance` refuses a future one —
      correctly, there is no attendance to record yet — so the shared session
      above (which the booking tests need to be bookable) is no good here.
    */
    const startedAt = new Date(Date.now() - 2 * 3_600_000);

    const { createSession } = await import(
      '../../src/scheduling/session.service'
    );
    const past = await createSession({
      organizationId: studio.organizationId,
      serviceTypeId: serviceId,
      startsAt: startedAt,
      endsAt: new Date(startedAt.getTime() + 3_600_000),
      timezone: 'America/New_York',
      localStartTime: '10:00',
      capacity: 8,
    });

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Ada Potter',
        email: `ada-${randomBytes(3).toString('hex')}@student.test`,
      },
    });

    const booking = await prisma.booking.create({
      data: {
        organizationId: studio.organizationId,
        customerId: customer.id,
        serviceTypeId: serviceId,
        sessionId: past.id,
        startsAt: startedAt,
        endsAt: new Date(startedAt.getTime() + 3_600_000),
        status: 'CONFIRMED',
        seats: 1,
        totalCents: 9500,
        timezone: 'America/New_York',
        cancelToken: randomBytes(32),
      },
    });

    await request(app)
      .post(`${studio.base}/sessions/${past.id}/register`)
      .set(instructor.headers)
      .send({ entries: [{ bookingId: booking.id, status: 'ATTENDED' }] })
      .expect(200);
  });

  it('still lets an instructor read the day and the customers', async () => {
    await request(app)
      .get(`${studio.base}/manifest?date=2026-09-19`)
      .set(instructor.headers)
      .expect(200);

    await request(app)
      .get(`${studio.base}/customers`)
      .set(instructor.headers)
      .expect(200);
  });

  /**
   * Reading what somebody is owed is not spending it. An instructor with the
   * person in front of them should be able to see a credit; booking it into a
   * class is counter work.
   */
  it('lets an instructor see credits but not redeem one', async () => {
    await request(app)
      .get(`${studio.base}/credits`)
      .set(instructor.headers)
      .expect(200);

    await request(app)
      .post(`${studio.base}/credits/${crypto.randomUUID()}/redeem`)
      .set(instructor.headers)
      .send({ sessionId })
      .expect(403);
  });
});

/**
 * The sharpest of the lot. Availability decides who gets offered work, and
 * every member could rewrite anybody's.
 */
describe('your own schedule, not a colleague', () => {
  let instructorStaffId: string;
  let colleagueStaffId: string;

  beforeEach(async () => {
    // A staff record linked to the instructor's login, and one that is not.
    const mine = await prisma.staff.create({
      data: {
        organizationId: studio.organizationId,
        userId: instructor.userId,
        name: 'The Instructor',
        email: 'instructor-staff@clay.test',
      },
    });
    instructorStaffId = mine.id;

    const theirs = await prisma.staff.create({
      data: {
        organizationId: studio.organizationId,
        name: 'A Colleague',
        email: 'colleague@clay.test',
      },
    });
    colleagueStaffId = theirs.id;
  });

  const override = {
    overrideType: 'DAY_OFF' as const,
    localDate: '2026-10-05',
    reason: 'dentist',
  };

  it('lets an instructor mark their own day off', async () => {
    await request(app)
      .post(`${studio.base}/schedules/${instructorStaffId}/overrides`)
      .set(instructor.headers)
      .send(override)
      .expect(201);
  });

  it('refuses an instructor rewriting a colleague availability', async () => {
    const res = await request(app)
      .post(`${studio.base}/schedules/${colleagueStaffId}/overrides`)
      .set(instructor.headers)
      .send(override);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_YOUR_SCHEDULE');

    const created = await prisma.availabilityOverride.count({
      where: { staffId: colleagueStaffId },
    });
    expect(created).toBe(0);
  });

  /**
   * A staff record with no login belongs to nobody, so nobody is "self" for
   * it. Without this, a null `userId` matching a null lookup would make every
   * unlinked staff member editable by anyone.
   */
  it('does not treat an unlinked staff record as anybody own', async () => {
    await request(app)
      .post(`${studio.base}/schedules/${colleagueStaffId}/overrides`)
      .set(frontDesk.headers)
      .send(override)
      .expect(403);
  });

  it('still lets an admin edit anybody', async () => {
    await request(app)
      .post(`${studio.base}/schedules/${colleagueStaffId}/overrides`)
      .set(studio.headers)
      .send(override)
      .expect(201);
  });

  it('404s for a staff member in another studio', async () => {
    const other = await signUpStudio(app);
    const theirStaff = await prisma.staff.create({
      data: {
        organizationId: other.organizationId,
        name: 'Somebody Else',
        email: 'else@other.test',
      },
    });

    // 404 rather than 403 — a 403 would confirm the id exists somewhere.
    await request(app)
      .post(`${studio.base}/schedules/${theirStaff.id}/overrides`)
      .set(instructor.headers)
      .send(override)
      .expect(404);
  });
});
