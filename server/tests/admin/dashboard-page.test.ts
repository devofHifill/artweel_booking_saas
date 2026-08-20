import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';

/**
 * The dashboard endpoint.
 *
 * The aggregates it composes are covered in `analytics.test.ts`. What is tested
 * here is the composition: that the whole screen arrives in one response, that
 * the two things derived at this layer are derived correctly (payment state per
 * booking, and appointments appearing in the day's running order), and that
 * nothing from another studio reaches it.
 */

const app = createApp();
let studio: Studio;
let classServiceId: string;
let apptServiceId: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  studio = await signUpStudio(app);

  const cls = await request(app)
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
  classServiceId = cls.body.service.id;

  const appt = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Private Lesson',
      bookingMode: 'APPOINTMENT',
      durationMinutes: 60,
      capacityMax: 1,
      priceCents: 9000,
    })
    .expect(201);
  apptServiceId = appt.body.service.id;
});

/** Now, but inside the studio's day whatever hour the suite runs at. */
function laterToday(hoursFromNow = 2): Date {
  return new Date(Date.now() + hoursFromNow * 3_600_000);
}

async function makeCustomer() {
  return prisma.customer.create({
    data: {
      organizationId: studio.organizationId,
      name: `Customer ${randomBytes(3).toString('hex')}`,
      email: `c-${randomBytes(6).toString('hex')}@example.test`,
    },
  });
}

async function makeClassBooking(opts: {
  startsAt: Date;
  seats?: number;
  totalCents?: number;
  paidCents?: number;
}) {
  const customer = await makeCustomer();

  const session = await prisma.session.create({
    data: {
      organizationId: studio.organizationId,
      serviceTypeId: classServiceId,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 2 * 3_600_000),
      timezone: 'America/New_York',
      localStartTime: '18:00',
      capacity: 8,
      seatsTaken: opts.seats ?? 1,
    },
  });

  const booking = await prisma.booking.create({
    data: {
      organizationId: studio.organizationId,
      customerId: customer.id,
      serviceTypeId: classServiceId,
      sessionId: session.id,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 2 * 3_600_000),
      status: 'CONFIRMED',
      seats: opts.seats ?? 1,
      totalCents: opts.totalCents ?? 6500,
      timezone: 'America/New_York',
      cancelToken: randomBytes(32),
    },
  });

  if (opts.paidCents) {
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        bookingId: booking.id,
        kind: 'FULL',
        amountCents: opts.paidCents,
        status: 'SUCCEEDED',
        succeededAt: new Date(),
      },
    });
  }

  return booking;
}

describe('the shape of the response', () => {
  it('returns every block the screen renders, in one request', async () => {
    const res = await request(app)
      .get(`${studio.base}/dashboard`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.studio).toMatchObject({ currency: 'USD' });
    expect(res.body.figures.today).toEqual({
      bookings: 0,
      seatsBooked: 0,
      seatsLeft: 0,
      revenueCents: 0,
    });
    // Yesterday arrives with today, so the trend needs no second request.
    expect(res.body.figures.yesterday).toBeDefined();
    expect(res.body.revenue).toHaveLength(7);
    expect(res.body.schedule).toEqual([]);
    expect(res.body.recent).toEqual([]);
    expect(res.body.popular).toEqual([]);
    expect(res.body.attention).toHaveLength(4);
    expect(res.body.instructors).toEqual([]);
  });

  /**
   * Zero-count rows are kept rather than filtered out. A list that empties
   * itself gives no signal the check ran; "0 classes without an instructor" is
   * worth having read.
   */
  it('keeps attention rows at zero', async () => {
    const res = await request(app)
      .get(`${studio.base}/dashboard`)
      .set(studio.headers)
      .expect(200);

    const ids = res.body.attention.map((a: { id: string }) => a.id);
    expect(ids).toEqual(['pending', 'owed', 'unstaffed', 'uncollected']);
    expect(res.body.attention.every((a: { count: number }) => a.count === 0)).toBe(true);
  });

  /**
   * Both grammatical forms ship, because the client cannot derive one from the
   * other. The plural sits in the MIDDLE of these phrases — "1 bookings
   * awaiting payment", "1 classes this week with no instructor" — so stripping
   * a trailing "s" produces nonsense. This shipped wrong once and was caught in
   * the browser, not by a test; now it is a test.
   */
  it('ships a singular and a plural form of every attention label', async () => {
    const res = await request(app)
      .get(`${studio.base}/dashboard`)
      .set(studio.headers)
      .expect(200);

    for (const item of res.body.attention) {
      expect(item.label, `${item.id} has no plural label`).toBeTruthy();
      expect(item.labelOne, `${item.id} has no singular label`).toBeTruthy();
    }

    const counted = res.body.attention.filter(
      (a: { id: string }) => a.id !== 'owed',
    );
    // The money row is the one exception: it is prefixed by an amount, never a
    // count, so its two forms are legitimately identical.
    for (const item of counted) {
      expect(item.labelOne, `${item.id} did not differ`).not.toBe(item.label);
    }
  });
});

describe("today's running order", () => {
  it('reports booked against capacity, which grouping bookings could not', async () => {
    await makeClassBooking({ startsAt: laterToday(), seats: 3 });

    const res = await request(app)
      .get(`${studio.base}/dashboard`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.schedule).toHaveLength(1);
    expect(res.body.schedule[0]).toMatchObject({
      serviceName: 'Wheel Throwing',
      booked: 3,
      capacity: 8,
      kind: 'class',
    });
  });

  /**
   * The reason appointments are merged in.
   *
   * An appointment has no session — the booking hangs off a staff member — so a
   * schedule built only from sessions shows a studio of private lessons an
   * empty day, which reads as a broken product rather than as a design choice.
   */
  it('includes appointments, which have no session behind them', async () => {
    const customer = await makeCustomer();
    const startsAt = laterToday(3);

    const staff = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Ana Instructor', email: 'ana@clay.test' })
      .expect(201);

    await prisma.booking.create({
      data: {
        organizationId: studio.organizationId,
        customerId: customer.id,
        serviceTypeId: apptServiceId,
        staffId: staff.body.staff.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        status: 'CONFIRMED',
        seats: 1,
        totalCents: 9000,
        timezone: 'America/New_York',
        cancelToken: randomBytes(32),
      },
    });

    const res = await request(app)
      .get(`${studio.base}/dashboard`)
      .set(studio.headers)
      .expect(200);

    const appointment = res.body.schedule.find(
      (r: { kind: string }) => r.kind === 'appointment',
    );
    expect(appointment).toBeDefined();
    expect(appointment).toMatchObject({
      serviceName: 'Private Lesson',
      booked: 1,
      capacity: 1,
      staffName: 'Ana Instructor',
    });

    // And it puts the instructor on duty, which is the same source of truth.
    expect(res.body.instructors).toEqual([
      { name: 'Ana Instructor', classes: 1, seats: 1 },
    ]);
  });
});

describe('payment state per booking', () => {
  it('marks a fully paid booking as paid', async () => {
    await makeClassBooking({
      startsAt: laterToday(),
      totalCents: 6500,
      paidCents: 6500,
    });

    const res = await request(app)
      .get(`${studio.base}/dashboard`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.recent[0].paymentStatus).toBe('PAID');
  });

  it('marks a deposit as part paid', async () => {
    await makeClassBooking({
      startsAt: laterToday(),
      totalCents: 6500,
      paidCents: 2000,
    });

    const res = await request(app)
      .get(`${studio.base}/dashboard`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.recent[0].paymentStatus).toBe('PART_PAID');
  });

  it('marks an untouched booking as unpaid', async () => {
    await makeClassBooking({ startsAt: laterToday(), totalCents: 6500 });

    const res = await request(app)
      .get(`${studio.base}/dashboard`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.recent[0].paymentStatus).toBe('UNPAID');
  });

  /**
   * A free class is paid, not unpaid.
   *
   * Otherwise every complimentary session and every zero-price taster sits on
   * the dashboard permanently as money owed that nobody can ever collect.
   */
  it('treats a free booking as paid', async () => {
    await makeClassBooking({ startsAt: laterToday(), totalCents: 0 });

    const res = await request(app)
      .get(`${studio.base}/dashboard`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.recent[0].paymentStatus).toBe('PAID');
    // And it must not inflate the money-owed figure either.
    expect(res.body.figures.outstandingCents).toBe(0);
  });
});

describe('who may see it', () => {
  it('is open to an instructor — this is the screen they open every morning', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    await request(app)
      .get(`${studio.base}/dashboard`)
      .set(instructor.headers)
      .expect(200);
  });

  it('hides another studio entirely', async () => {
    const stranger = await signUpStudio(app);

    await request(app)
      .get(`${studio.base}/dashboard`)
      .set(stranger.headers)
      .expect(404);
  });

  it('never mixes another studio into the figures', async () => {
    const other = await signUpStudio(app);

    await prisma.payment.create({
      data: {
        organizationId: other.organizationId,
        kind: 'FULL',
        amountCents: 999_00,
        status: 'SUCCEEDED',
        succeededAt: new Date(),
      },
    });

    const res = await request(app)
      .get(`${studio.base}/dashboard`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.figures.today.revenueCents).toBe(0);
    expect(
      res.body.revenue.reduce((sum: number, d: { cents: number }) => sum + d.cents, 0),
    ).toBe(0);
  });
});
