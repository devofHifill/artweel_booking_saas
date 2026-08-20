import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';

/**
 * The app chrome.
 *
 * Badge counts and alerts look like cosmetics, and are not: a badge is a claim
 * that something needs doing. The assertions that matter here are the ones about
 * what is DELIBERATELY excluded — a count that includes things nobody can act on
 * produces a number that never reaches zero, and a badge that never reaches zero
 * stops being read within a week.
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
      name: 'Wheel Throwing',
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMin: 1,
      capacityMax: 8,
      priceCents: 6500,
    })
    .expect(201);

  serviceId = service.body.service.id;
});

/** A booking straight into the database, so the count under test is the subject. */
async function makeBooking(opts: {
  name: string;
  email: string;
  startsAt: Date;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
}) {
  const customer = await prisma.customer.create({
    data: {
      organizationId: studio.organizationId,
      name: opts.name,
      email: opts.email,
    },
  });

  const endsAt = new Date(opts.startsAt.getTime() + 2 * 60 * 60 * 1000);

  /*
    A session, because `bookings_exactly_one_target` requires exactly one of
    session_id or staff_id. A seat-based class hangs off a session; leaving both
    null is refused by the database, which is the constraint doing its job.
  */
  const session = await prisma.session.create({
    data: {
      organizationId: studio.organizationId,
      serviceTypeId: serviceId,
      startsAt: opts.startsAt,
      endsAt,
      timezone: 'America/New_York',
      localStartTime: '19:00',
      capacity: 8,
    },
  });

  return prisma.booking.create({
    data: {
      organizationId: studio.organizationId,
      customerId: customer.id,
      serviceTypeId: serviceId,
      sessionId: session.id,
      startsAt: opts.startsAt,
      endsAt,
      status: opts.status,
      seats: 1,
      totalCents: 6500,
      timezone: 'America/New_York',
      // Required and unique: a management link carries its own credential.
      cancelToken: randomBytes(32),
    },
  });
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

describe('the summary the shell renders', () => {
  it('is quiet for a studio with nothing wrong except unfinished setup', async () => {
    const res = await request(app)
      .get(`${studio.base}/shell/summary`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.counts).toEqual({ today: 0, pendingBookings: 0 });

    // A fresh studio has not connected Stripe, and should be told so.
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0].id).toBe('payments');
  });

  it('counts pending bookings that are still ahead', async () => {
    await makeBooking({
      name: 'Jane Potter',
      email: 'jane@example.test',
      startsAt: inDays(3),
      status: 'PENDING',
    });

    const res = await request(app)
      .get(`${studio.base}/shell/summary`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.counts.pendingBookings).toBe(1);
  });

  /**
   * The assertion this endpoint exists for.
   *
   * An abandoned checkout from last spring is PENDING forever and there is
   * nothing to do about it. Counting it would put a number beside "Bookings"
   * that only ever grows.
   */
  it('ignores pending bookings that are already in the past', async () => {
    await makeBooking({
      name: 'Old Abandoned',
      email: 'old@example.test',
      startsAt: inDays(-30),
      status: 'PENDING',
    });

    const res = await request(app)
      .get(`${studio.base}/shell/summary`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.counts.pendingBookings).toBe(0);
  });

  it('does not count confirmed or cancelled bookings as pending', async () => {
    await makeBooking({
      name: 'Confirmed Person',
      email: 'conf@example.test',
      startsAt: inDays(2),
      status: 'CONFIRMED',
    });
    await makeBooking({
      name: 'Cancelled Person',
      email: 'canc@example.test',
      startsAt: inDays(2),
      status: 'CANCELLED',
    });

    const res = await request(app)
      .get(`${studio.base}/shell/summary`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.counts.pendingBookings).toBe(0);
  });

  it('raises an alert when customers were not told', async () => {
    await prisma.notification.create({
      data: {
        organizationId: studio.organizationId,
        channel: 'EMAIL',
        templateKey: 'BOOKING_CONFIRMATION',
        destination: 'someone@example.test',
        payload: {},
        status: 'FAILED',
        scheduledFor: new Date(),
        // Unique per row; the outbox uses it to make redelivery idempotent.
        dedupeKey: `test-${randomBytes(8).toString('hex')}`,
      },
    });

    const res = await request(app)
      .get(`${studio.base}/shell/summary`)
      .set(studio.headers)
      .expect(200);

    const alert = res.body.alerts.find(
      (a: { id: string }) => a.id === 'notifications',
    );
    expect(alert).toBeDefined();
    expect(alert.level).toBe('danger');
    // Phrased as the consequence, not the row status.
    expect(alert.message).toContain('customer');
  });

  /** Another studio's failures must never appear in this one's chrome. */
  it('counts only this studio', async () => {
    const other = await signUpStudio(app);

    await prisma.notification.create({
      data: {
        organizationId: other.organizationId,
        channel: 'EMAIL',
        templateKey: 'BOOKING_CONFIRMATION',
        destination: 'someone@example.test',
        payload: {},
        status: 'FAILED',
        scheduledFor: new Date(),
        // Unique per row; the outbox uses it to make redelivery idempotent.
        dedupeKey: `test-${randomBytes(8).toString('hex')}`,
      },
    });

    const res = await request(app)
      .get(`${studio.base}/shell/summary`)
      .set(studio.headers)
      .expect(200);

    expect(
      res.body.alerts.find((a: { id: string }) => a.id === 'notifications'),
    ).toBeUndefined();
  });

  it('is readable by an instructor', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    await request(app)
      .get(`${studio.base}/shell/summary`)
      .set(instructor.headers)
      .expect(200);
  });

  it('hides another studio entirely', async () => {
    const stranger = await signUpStudio(app);

    await request(app)
      .get(`${studio.base}/shell/summary`)
      .set(stranger.headers)
      .expect(404);
  });
});

describe('global search', () => {
  beforeEach(async () => {
    await makeBooking({
      name: 'Jane Potter',
      email: 'jane@example.test',
      startsAt: inDays(4),
      status: 'CONFIRMED',
    });
  });

  it('finds a customer by name', async () => {
    const res = await request(app)
      .get(`${studio.base}/shell/search?q=jane`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.customers).toHaveLength(1);
    expect(res.body.customers[0].name).toBe('Jane Potter');
  });

  it('finds a customer by email, case-insensitively', async () => {
    const res = await request(app)
      .get(`${studio.base}/shell/search?q=JANE@EXAMPLE`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.customers).toHaveLength(1);
  });

  it('finds a class by name', async () => {
    const res = await request(app)
      .get(`${studio.base}/shell/search?q=wheel`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.classes).toHaveLength(1);
    expect(res.body.classes[0].name).toBe('Wheel Throwing');
  });

  /** Bookings are matched through the customer, because that is what people type. */
  it('finds an upcoming booking by the customer name', async () => {
    const res = await request(app)
      .get(`${studio.base}/shell/search?q=potter`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.bookings[0].customerName).toBe('Jane Potter');
    expect(res.body.bookings[0].className).toBe('Wheel Throwing');
  });

  it('leaves past bookings out, while still finding the customer', async () => {
    await makeBooking({
      name: 'Historic Hannah',
      email: 'hannah@example.test',
      startsAt: inDays(-60),
      status: 'CONFIRMED',
    });

    const res = await request(app)
      .get(`${studio.base}/shell/search?q=hannah`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.bookings).toHaveLength(0);
    // She is still a real customer, and looking her up is the point.
    expect(res.body.customers).toHaveLength(1);
  });

  /**
   * One character matches most of the table. Empty rather than an error,
   * because this fires while somebody is still typing and the first keystroke
   * is not a mistake.
   */
  it('says nothing for a single character', async () => {
    const res = await request(app)
      .get(`${studio.base}/shell/search?q=j`)
      .set(studio.headers)
      .expect(200);

    expect(res.body).toEqual({ customers: [], bookings: [], classes: [] });
  });

  it('handles an empty query without complaining', async () => {
    const res = await request(app)
      .get(`${studio.base}/shell/search`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.customers).toEqual([]);
  });

  /** The one that would be a data leak rather than a bug. */
  it('never reaches into another studio', async () => {
    const other = await signUpStudio(app);

    await prisma.customer.create({
      data: {
        organizationId: other.organizationId,
        name: 'Jane Potter',
        email: 'jane@other.test',
      },
    });

    const res = await request(app)
      .get(`${studio.base}/shell/search?q=jane`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.customers).toHaveLength(1);
    expect(res.body.customers[0].email).toBe('jane@example.test');
  });
});
