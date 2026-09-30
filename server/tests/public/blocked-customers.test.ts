import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { createSession } from '../../src/scheduling/session.service';

/**
 * A customer the studio has blocked cannot book themselves.
 *
 * "Blocked" on the Customers screen turned a pill red and nothing else — a
 * blocked customer went on booking as before. Found while writing the
 * "Running your studio" guide.
 */

const app = createApp();
let studio: Studio;
let slug: string;
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
  studio = await signUpStudio(app);
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
      .send({ name: 'Sunset kayak tour', bookingMode: 'EVENT', durationMinutes: 120, capacityMax: 2, priceCents: 4_500 })
      .expect(201)
  ).body.service.id;
  const startsAt = new Date(Date.now() + 10 * 86_400_000);
  sessionId = (await createSession({
    organizationId: studio.organizationId,
    serviceTypeId: classId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
    timezone: 'Europe/London',
    localStartTime: '17:00',
    capacity: 2,
  }))!.id;
});

const customerWith = (status: 'ACTIVE' | 'VIP' | 'BLOCKED') =>
  prisma.customer.create({
    data: { organizationId: studio.organizationId, name: 'Sam', email: 'sam@paddler.test', status },
  });

const bookAs = (email: string) =>
  request(app)
    .post(`/public/${slug}/bookings`)
    .send({ serviceTypeId: classId, sessionId, seats: 1, customer: { name: 'Sam', email } });

describe('a blocked customer', () => {
  it('cannot book on the booking page, however they type their email', async () => {
    await customerWith('BLOCKED');

    for (const email of ['sam@paddler.test', 'Sam@Paddler.TEST']) {
      const res = await bookAs(email).expect(403);
      expect(res.body.error.code).toBe('CUSTOMER_BLOCKED');
      // Says what to do, not "you are blocked".
      expect(res.body.error.message).toBe("We can't take this booking online. Please contact the studio.");
    }
    expect(await prisma.booking.count({ where: { organizationId: studio.organizationId } })).toBe(0);
  });

  it('cannot join a waitlist', async () => {
    await customerWith('BLOCKED');
    // Fill the class so a waitlist is what is on offer.
    await bookAs('one@paddler.test').expect(201);
    await bookAs('two@paddler.test').expect(201);

    const res = await request(app)
      .post(`/public/${slug}/sessions/${sessionId}/waitlist`)
      .send({ seats: 1, customer: { name: 'Sam', email: 'sam@paddler.test' } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CUSTOMER_BLOCKED');
  });

  it('is stopped before paying online, not after', async () => {
    await customerWith('BLOCKED');
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { stripeAccountId: 'acct_test_harbour', stripeChargesEnabled: true },
    });

    const res = await request(app)
      .post(`/public/${slug}/checkout`)
      .send({ serviceTypeId: classId, sessionId, seats: 1, customer: { name: 'Sam', email: 'sam@paddler.test' } });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CUSTOMER_BLOCKED');
    // No seat held for them while they were refused.
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).seatsTaken).toBe(0);
  });

  it('can still be booked by the studio at the counter', async () => {
    await customerWith('BLOCKED');

    await request(app)
      .post(`${studio.base}/bookings`)
      .set(studio.headers)
      .send({ serviceTypeId: classId, sessionId, seats: 1, customer: { name: 'Sam', email: 'sam@paddler.test' } })
      .expect(201);
  });
});

describe('everyone else', () => {
  it('books as before, VIPs included', async () => {
    await customerWith('VIP');
    await bookAs('sam@paddler.test').expect(201);
    await bookAs('new@paddler.test').expect(201);
  });
});

describe('the policy form', () => {
  it('saves a studio-credit step and the reschedule window', async () => {
    const policy = await prisma.cancellationPolicy.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Flexible',
        isDefault: true,
        tiers: [{ hoursBefore: 0, refundPercent: 50 }],
      },
    });

    await request(app)
      .patch(`${studio.base}/cancellation-policies/${policy.id}`)
      .set(studio.headers)
      .send({
        name: 'Standard',
        tiers: [
          { hoursBefore: 48, refundPercent: 100 },
          { hoursBefore: 24, refundPercent: 0, creditPercent: 100 },
          { hoursBefore: 0, refundPercent: 0 },
        ],
        allowReschedule: true,
        rescheduleCutoffHours: 6,
      })
      .expect(200);

    const saved = await prisma.cancellationPolicy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(saved.tiers).toEqual([
      { hoursBefore: 48, refundPercent: 100 },
      { hoursBefore: 24, refundPercent: 0, creditPercent: 100 },
      { hoursBefore: 0, refundPercent: 0 },
    ]);
    expect(saved.rescheduleCutoffHours).toBe(6);
  });
});
