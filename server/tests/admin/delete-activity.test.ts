import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createCustomer, resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';

/**
 * Deleting an activity permanently: its sessions and bookings go with it, its
 * payments stay (unlinked), and it is refused while anyone has an upcoming
 * booking, because those customers must be cancelled and refunded first.
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

const wheelClass = {
  name: 'Beginner Wheel Throwing',
  bookingMode: 'EVENT',
  durationMinutes: 180,
  slotGranularityMinutes: 30,
  capacityMin: 1,
  capacityMax: 8,
  priceCents: 9500,
};

const DAY = 24 * 60 * 60 * 1000;

async function activity() {
  const res = await request(app).post(`${studio.base}/services`).set(studio.headers).send(wheelClass);
  return res.body.service.id as string;
}

/** A session and one booking on it, `daysFromNow` away (negative = past). */
async function booked(serviceTypeId: string, daysFromNow: number, status: 'CONFIRMED' | 'CANCELLED' | 'ATTENDED') {
  const startsAt = new Date(Date.now() + daysFromNow * DAY);
  const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: {
      organizationId: studio.organizationId,
      serviceTypeId,
      startsAt,
      endsAt,
      timezone: 'America/New_York',
      localStartTime: '14:00',
      capacity: 8,
    },
  });
  const customer = await createCustomer(studio.organizationId);
  const booking = await prisma.booking.create({
    data: {
      organizationId: studio.organizationId,
      customerId: customer.id,
      serviceTypeId,
      sessionId: session.id,
      startsAt,
      endsAt,
      timezone: 'America/New_York',
      status,
      cancelToken: randomBytes(32),
    },
  });
  const payment = await prisma.payment.create({
    data: {
      organizationId: studio.organizationId,
      bookingId: booking.id,
      kind: 'FULL',
      amountCents: 9500,
    },
  });
  return { session, booking, payment };
}

const del = (id: string, s: Studio = studio) =>
  request(app).delete(`${s.base}/services/${id}`).set(s.headers);
const impact = (id: string) =>
  request(app).get(`${studio.base}/services/${id}/deletion`).set(studio.headers);

describe('deleting an activity', () => {
  it('removes past sessions and bookings, and keeps the payments', async () => {
    const id = await activity();
    const past = await booked(id, -10, 'ATTENDED');
    await booked(id, 5, 'CANCELLED'); // upcoming but cancelled: not in the way

    const before = await impact(id);
    expect(before.status).toBe(200);
    expect(before.body.impact).toMatchObject({
      name: 'Beginner Wheel Throwing',
      sessions: 2,
      bookings: 2,
      upcomingBookings: 0,
      payments: 2,
    });

    expect((await del(id)).status).toBe(204);

    expect(await prisma.serviceType.count({ where: { id } })).toBe(0);
    expect(await prisma.session.count({ where: { serviceTypeId: id } })).toBe(0);
    expect(await prisma.booking.count({ where: { serviceTypeId: id } })).toBe(0);
    const payment = await prisma.payment.findUnique({ where: { id: past.payment.id } });
    expect(payment).not.toBeNull();
    expect(payment!.bookingId).toBeNull();
  });

  it('refuses while someone has an upcoming booking, and changes nothing', async () => {
    const id = await activity();
    await booked(id, -10, 'ATTENDED');
    await booked(id, 3, 'CONFIRMED');

    expect((await impact(id)).body.impact.upcomingBookings).toBe(1);

    const res = await del(id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACTIVITY_HAS_UPCOMING_BOOKINGS');
    expect(res.body.error.message).toContain('1 upcoming booking');

    expect(await prisma.serviceType.count({ where: { id } })).toBe(1);
    expect(await prisma.booking.count({ where: { serviceTypeId: id } })).toBe(2);
  });

  it("is not another studio's to delete or inspect", async () => {
    const id = await activity();
    const other = await signUpStudio(app);

    expect((await del(id, other)).status).toBe(404);
    const peek = await request(app).get(`${other.base}/services/${id}/deletion`).set(other.headers);
    expect(peek.status).toBe(404);
    expect(await prisma.serviceType.count({ where: { id } })).toBe(1);
  });
});
