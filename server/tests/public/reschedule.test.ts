import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { createSession } from '../../src/scheduling/session.service';
import { bookAppointment } from '../../src/scheduling/booking.service';
import { encodeToken } from '../../src/modules/public/public.service';

/**
 * A customer changing their own booking (docs/ux-audit-findings.md #15).
 *
 * The manage page could cancel and nothing else. The API behind it moved One
 * to one lessons only, and by cancelling and rebooking — which left any
 * payment on the cancelled booking, where the refund path could not find it.
 * Moves are now made in place: same booking, same payment, same link.
 */

const app = createApp();
let studio: Studio;
let slug: string;
let classId: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  studio = await signUpStudio(app, { organizationName: 'Harbour Kayak Tours', timezone: 'Europe/London' });
  slug = (
    await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
      select: { slug: true },
    })
  ).slug;
  classId = (
    await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({ name: 'Sunset kayak tour', bookingMode: 'EVENT', durationMinutes: 120, capacityMax: 4, priceCents: 4_500 })
      .expect(201)
  ).body.service.id;
});

const DAY = 86_400_000;

async function classDate(daysAhead: number, serviceTypeId = classId, capacity = 4) {
  const startsAt = new Date(Date.now() + daysAhead * DAY);
  return (await createSession({
    organizationId: studio.organizationId,
    serviceTypeId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
    timezone: 'Europe/London',
    localStartTime: '17:00',
    capacity,
  }))!;
}

async function bookClass(sessionId: string, seats = 1) {
  const res = await request(app)
    .post(`/public/${slug}/bookings`)
    .send({
      serviceTypeId: classId,
      sessionId,
      seats,
      customer: { name: 'Tess Oyelaran', email: `tess${Math.random()}@paddler.test` },
    })
    .expect(201);
  return { id: res.body.booking.id as string, token: res.body.manageToken as string };
}

const seatsTaken = async (sessionId: string) =>
  (await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).seatsTaken;

const options = async (token: string) =>
  (await request(app).get(`/public/bookings/${token}/reschedule-options`).expect(200)).body;

describe('moving a class booking to another date', () => {
  it('offers the other dates, and moves the seats — same booking, same link', async () => {
    const first = await classDate(10);
    const second = await classDate(17);
    const { id, token } = await bookClass(first.id, 2);

    const offered = await options(token);
    expect(offered.allowed).toBe(true);
    expect(offered.sessions.map((s: { sessionId: string }) => s.sessionId)).toEqual([second.id]);

    const res = await request(app)
      .post(`/public/bookings/${token}/reschedule`)
      .send({ sessionId: second.id })
      .expect(200);
    expect(res.body.bookingId).toBe(id);
    expect(res.body.token).toBe(token);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(booking.sessionId).toBe(second.id);
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.startsAt.getTime()).toBe(second.startsAt.getTime());
    expect(await seatsTaken(first.id)).toBe(0);
    expect(await seatsTaken(second.id)).toBe(2);
  });

  it('keeps a payment attached to the booking', async () => {
    const first = await classDate(10);
    const second = await classDate(17);
    const { id, token } = await bookClass(first.id);
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        bookingId: id,
        kind: 'FULL',
        amountCents: 4_500,
        status: 'SUCCEEDED',
      },
    });

    await request(app).post(`/public/bookings/${token}/reschedule`).send({ sessionId: second.id }).expect(200);

    const payments = await prisma.payment.findMany({ where: { bookingId: id } });
    expect(payments).toHaveLength(1);
    // And nothing new was made to strand it.
    expect(await prisma.booking.count({ where: { organizationId: studio.organizationId } })).toBe(1);
  });

  it('refuses a date without enough places, and a date of another class', async () => {
    const first = await classDate(10);
    const small = await classDate(17, classId, 1);
    await bookClass(small.id); // now full
    const otherClass = (
      await request(app)
        .post(`${studio.base}/services`)
        .set(studio.headers)
        .send({ name: 'Morning paddle', bookingMode: 'EVENT', durationMinutes: 90, capacityMax: 6 })
        .expect(201)
    ).body.service.id;
    const elsewhere = await classDate(12, otherClass);
    const { token } = await bookClass(first.id);

    for (const sessionId of [small.id, elsewhere.id]) {
      const res = await request(app)
        .post(`/public/bookings/${token}/reschedule`)
        .send({ sessionId })
        .expect(409);
      expect(res.body.error.code).toBe('RESCHEDULE_TARGET_UNAVAILABLE');
    }
    expect(await seatsTaken(first.id)).toBe(1);
  });
});

describe('moving a One to one to another time', () => {
  async function lesson() {
    const serviceId = (
      await request(app)
        .post(`${studio.base}/services`)
        .set(studio.headers)
        .send({ name: 'Private lesson', bookingMode: 'APPOINTMENT', durationMinutes: 60, priceCents: 8_000 })
        .expect(201)
    ).body.service.id;
    const staffId = (
      await request(app)
        .post(`${studio.base}/staff`)
        .set(studio.headers)
        .send({ name: 'Rowan Pike', email: 'rowan@clay.test' })
        .expect(201)
    ).body.staff.id;
    await request(app)
      .put(`${studio.base}/services/${serviceId}/staff`)
      .set(studio.headers)
      .send({ staffIds: [staffId] })
      .expect(200);
    await prisma.availabilityRule.create({
      data: {
        organizationId: studio.organizationId,
        staffId,
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU',
        startMinute: 9 * 60,
        endMinute: 17 * 60,
        timezone: 'Europe/London',
        effectiveFrom: new Date(Date.now() - DAY),
      },
    });
    const customer = await prisma.customer.create({
      data: { organizationId: studio.organizationId, name: 'Sam', email: 'sam@paddler.test' },
    });

    // Ten days out at 10:00 London, inside the working hours.
    const day = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10);
    const offered = (
      await request(app)
        .get(`/public/${slug}/availability`)
        .query({ serviceTypeId: serviceId, from: day, to: day, staffId })
        .expect(200)
    ).body.slots as { startsAt: string }[];
    const startsAt = new Date(offered[0]!.startsAt);

    const booking = (await bookAppointment({
      organizationId: studio.organizationId,
      staffId,
      serviceTypeId: serviceId,
      customerId: customer.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      timezone: 'Europe/London',
    }))!;
    return { booking, token: encodeToken(booking.cancelToken) };
  }

  it('moves the booking and the instructor’s time together', async () => {
    const { booking, token } = await lesson();
    const offered = await options(token);
    const target = offered.slots.find(
      (s: { startsAt: string }) => new Date(s.startsAt).getTime() > booking.endsAt.getTime() + DAY,
    );

    await request(app).post(`/public/bookings/${token}/reschedule`).send({ startsAt: target.startsAt }).expect(200);

    const moved = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(moved.startsAt.toISOString()).toBe(new Date(target.startsAt).toISOString());
    const block = await prisma.staffTimeBlock.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(block.startsAt.getTime()).toBe(moved.startsAt.getTime());
    expect(block.endsAt.getTime()).toBe(moved.endsAt.getTime());
  });

  it('refuses a time outside working hours', async () => {
    const { booking, token } = await lesson();
    const lateNight = new Date(booking.startsAt.getTime() + 13 * 3_600_000); // 23:00-ish

    const res = await request(app)
      .post(`/public/bookings/${token}/reschedule`)
      .send({ startsAt: lateNight.toISOString() })
      .expect(409);
    expect(res.body.error.code).toBe('RESCHEDULE_TARGET_UNAVAILABLE');
  });
});

describe("the studio's policy", () => {
  it('can switch moving off, and the page says why', async () => {
    await prisma.cancellationPolicy.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Strict',
        isDefault: true,
        tiers: [],
        allowReschedule: false,
      },
    });
    const first = await classDate(10);
    const second = await classDate(17);
    const { token } = await bookClass(first.id);

    const offered = await options(token);
    expect(offered.allowed).toBe(false);
    expect(offered.reason).toContain('cannot be changed online');

    await request(app).post(`/public/bookings/${token}/reschedule`).send({ sessionId: second.id }).expect(409);
  });
});

describe('the manage page', () => {
  it('offers to change the date', async () => {
    const { token } = await bookClass((await classDate(10)).id);
    const html = (await request(app).get(`/public/bookings/${token}/manage`).expect(200)).text;
    expect(html).toContain('Change the date');
  });
});

describe('a studio moving a lesson from the dashboard', () => {
  it('keeps the same booking, so its payment stays with it', async () => {
    const serviceId = (
      await request(app)
        .post(`${studio.base}/services`)
        .set(studio.headers)
        .send({ name: 'Private lesson', bookingMode: 'APPOINTMENT', durationMinutes: 60 })
        .expect(201)
    ).body.service.id;
    const staffId = (
      await request(app)
        .post(`${studio.base}/staff`)
        .set(studio.headers)
        .send({ name: 'Rowan Pike', email: 'rowan@clay.test' })
        .expect(201)
    ).body.staff.id;
    const customer = await prisma.customer.create({
      data: { organizationId: studio.organizationId, name: 'Sam', email: 'sam@paddler.test' },
    });
    const startsAt = new Date(Date.now() + 10 * DAY);
    const booking = (await bookAppointment({
      organizationId: studio.organizationId,
      staffId,
      serviceTypeId: serviceId,
      customerId: customer.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      timezone: 'Europe/London',
    }))!;
    await prisma.payment.create({
      data: { organizationId: studio.organizationId, bookingId: booking.id, kind: 'FULL', amountCents: 8_000, status: 'SUCCEEDED' },
    });

    const res = await request(app)
      .post(`${studio.base}/bookings/${booking.id}/reschedule`)
      .set(studio.headers)
      .send({ startsAt: new Date(startsAt.getTime() + 2 * DAY).toISOString() })
      .expect(200);

    expect(res.body.booking.id).toBe(booking.id);
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CONFIRMED');
  });
});
