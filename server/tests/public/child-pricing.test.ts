import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';

/**
 * A family booking, from the quote a stranger reads to the row it leaves.
 *
 * The unit tests in payments/child-pricing cover the arithmetic. What is
 * tested here is the wiring either side of it: that the number quoted is the
 * number stored, that `children` survives the round trip, and that the two
 * ways of getting a free seat out of the API are both shut.
 */

const app = createApp();

let studio: Studio;
let slug: string;
let serviceId: string;
let freeChildServiceId: string;
let sessionId: string;
let plainSessionId: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** A class with an adult and a child rate, and one dated session on it. */
async function publish(opts: { priceCents: number; childPriceCents: number }) {
  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: `Family Wheel ${opts.childPriceCents}`,
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMin: 1,
      capacityMax: 10,
      priceCents: opts.priceCents,
      childPriceCents: opts.childPriceCents,
    });
  expect(service.status).toBe(201);

  const starts = new Date(Date.now() + 14 * 86_400_000);
  const session = await prisma.session.create({
    data: {
      organizationId: studio.organizationId,
      serviceTypeId: service.body.service.id,
      startsAt: starts,
      endsAt: new Date(starts.getTime() + 120 * 60_000),
      timezone: 'America/New_York',
      localStartTime: '18:00',
      capacity: 10,
      seatsTaken: 0,
      status: 'SCHEDULED',
    },
  });

  return { serviceId: service.body.service.id as string, sessionId: session.id };
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: studio.organizationId },
  });
  slug = org.slug;

  const priced = await publish({ priceCents: 9500, childPriceCents: 5000 });
  serviceId = priced.serviceId;
  sessionId = priced.sessionId;

  const adultsOnly = await publish({ priceCents: 9500, childPriceCents: 0 });
  freeChildServiceId = adultsOnly.serviceId;
  plainSessionId = adultsOnly.sessionId;
});

describe('quoting a family', () => {
  it('splits the party across the two rates', async () => {
    const res = await request(app)
      .post(`/public/${slug}/quote`)
      .send({ serviceTypeId: serviceId, seats: 3, children: 1 });

    expect(res.status).toBe(200);
    expect(res.body.adults).toBe(2);
    expect(res.body.children).toBe(1);
    expect(res.body.adultSubtotalCents).toBe(19_000);
    expect(res.body.childSubtotalCents).toBe(5_000);
    expect(res.body.subtotalCents).toBe(24_000);
  });

  it('quotes an all-adult party at the adult rate', async () => {
    const res = await request(app)
      .post(`/public/${slug}/quote`)
      .send({ serviceTypeId: serviceId, seats: 3 });

    expect(res.body.subtotalCents).toBe(28_500);
    expect(res.body.children).toBe(0);
  });

  it('will not sell a seat below the child rate by overstating the children', async () => {
    /*
      Nine children in a two-seat party. Unclamped this prices minus-seven
      adults and returns a subtotal below the price of one child — reachable
      by anybody who can edit a request body.
    */
    const res = await request(app)
      .post(`/public/${slug}/quote`)
      .send({ serviceTypeId: serviceId, seats: 2, children: 9 });

    expect(res.status).toBe(200);
    expect(res.body.children).toBe(2);
    expect(res.body.subtotalCents).toBe(10_000);
  });

  it('ignores children on a class that has no child rate', async () => {
    /*
      The costlier of the two holes. Zero means "adults only" and is the
      DEFAULT every service carries, so multiplying by it would make every
      seat in the whole catalogue free to anyone who sent `children`.
    */
    const res = await request(app)
      .post(`/public/${slug}/quote`)
      .send({ serviceTypeId: freeChildServiceId, seats: 3, children: 3 });

    expect(res.body.subtotalCents).toBe(28_500);
    expect(res.body.adults).toBe(3);
    expect(res.body.children).toBe(0);
  });

  it('refuses a negative child count at the edge', async () => {
    const res = await request(app)
      .post(`/public/${slug}/quote`)
      .send({ serviceTypeId: serviceId, seats: 2, children: -1 });

    expect(res.status).toBe(422);
  });
});

describe('booking a family', () => {
  it('records the split and charges the quoted total', async () => {
    const quote = await request(app)
      .post(`/public/${slug}/quote`)
      .send({ serviceTypeId: serviceId, seats: 3, children: 1 });

    const res = await request(app)
      .post(`/public/${slug}/bookings`)
      .send({
        serviceTypeId: serviceId,
        sessionId,
        seats: 3,
        children: 1,
        customer: { name: 'Ana Vidal', email: 'ana@family.test' },
      });

    expect(res.status).toBe(201);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: res.body.booking.id },
    });

    // Seats is the WHOLE party; children is how many of those are children.
    expect(booking.seats).toBe(3);
    expect(booking.children).toBe(1);
    // And the stored total is the number the customer was shown.
    expect(booking.totalCents).toBe(quote.body.subtotalCents);
    expect(booking.totalCents).toBe(24_000);
  });

  it('leaves children at zero on an ordinary booking', async () => {
    const res = await request(app)
      .post(`/public/${slug}/bookings`)
      .send({
        serviceTypeId: serviceId,
        sessionId,
        seats: 2,
        customer: { name: 'Sam Reed', email: 'sam@family.test' },
      });

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: res.body.booking.id },
    });

    expect(booking.children).toBe(0);
    expect(booking.totalCents).toBe(19_000);
  });

  it('never stores more children than seats', async () => {
    // The CHECK constraint would refuse it; the clamp means the customer
    // never meets that refusal as a failed booking.
    const res = await request(app)
      .post(`/public/${slug}/bookings`)
      .send({
        serviceTypeId: serviceId,
        sessionId,
        seats: 2,
        children: 9,
        customer: { name: 'Jo Blake', email: 'jo@family.test' },
      });

    expect(res.status).toBe(201);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: res.body.booking.id },
    });
    expect(booking.children).toBe(2);
    expect(booking.seats).toBe(2);
  });

  it('does not give away seats on a class with no child rate', async () => {
    const res = await request(app)
      .post(`/public/${slug}/bookings`)
      .send({
        serviceTypeId: freeChildServiceId,
        sessionId: plainSessionId,
        seats: 2,
        children: 2,
        customer: { name: 'Pat Quinn', email: 'pat@family.test' },
      });

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: res.body.booking.id },
    });

    expect(booking.totalCents).toBe(19_000);
    expect(booking.children).toBe(0);
  });

  it('still takes the seats it was asked for', async () => {
    // The split must not touch the seat count the session is decremented by.
    await request(app)
      .post(`/public/${slug}/bookings`)
      .send({
        serviceTypeId: serviceId,
        sessionId,
        seats: 3,
        children: 2,
        customer: { name: 'Ana Vidal', email: 'ana@family.test' },
      });

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(3);
  });
});

describe('what the booking page is told', () => {
  it('publishes the child rate so the page can offer the field', async () => {
    const res = await request(app).get(`/public/${slug}/data`);

    const service = res.body.services.find(
      (s: { id: string }) => s.id === serviceId,
    );
    expect(service.childPriceCents).toBe(5000);
  });

  it('publishes a zero rate for a class that is adults only', async () => {
    // The page keys the whole question off this number, so it has to be
    // present and zero rather than absent.
    const res = await request(app).get(`/public/${slug}/data`);

    const service = res.body.services.find(
      (s: { id: string }) => s.id === freeChildServiceId,
    );
    expect(service.childPriceCents).toBe(0);
  });
});
