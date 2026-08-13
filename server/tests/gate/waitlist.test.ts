import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * W2.6 — waitlists.
 *
 * A freed seat is OFFERED to one person at a time, not broadcast. That choice
 * creates the two races worth testing:
 *
 *   two cancellations freeing seats at the same instant must not hand one seat
 *   to two people, and an offer expiring exactly as it is claimed must resolve
 *   one way or the other — never into a seat that is both booked and released.
 *
 * The seat is held using the same BookingHold as Stripe checkout, so the
 * "reserved for somebody who has not committed" machinery has one owner.
 */

const app = createApp();
let studio: Studio;
let slug: string;
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
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: studio.organizationId },
  });
  slug = org.slug;

  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Wheel Class',
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMax: 8,
      priceCents: 0,
    });

  const cls = await request(app)
    .post(`${studio.base}/sessions`)
    .set(studio.headers)
    .send({
      serviceTypeId: service.body.service.id,
      startLocalDate: '2027-04-03',
      localStartTime: '10:00',
      capacity: 2,
    });
  sessionId = cls.body.created[0].id;
});

async function fillClass(count = 2) {
  const { bookSeats } = await import('../../src/scheduling/booking.service');
  const bookings = [];

  for (let i = 0; i < count; i++) {
    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: `Booked ${i}`,
        email: `booked${i}@student.test`,
      },
    });
    bookings.push(
      await bookSeats({
        organizationId: studio.organizationId,
        sessionId,
        customerId: customer.id,
        seats: 1,
      }),
    );
  }

  return bookings;
}

function join(name: string, seats = 1) {
  return request(app)
    .post(`/public/${slug}/sessions/${sessionId}/waitlist`)
    .send({
      seats,
      customer: { name, email: `${name.toLowerCase()}@student.test` },
    });
}

/** Waits for the fire-and-forget offer triggered by a cancellation. */
async function settle(ms = 900) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('joining a waitlist', () => {
  it('records demand that would otherwise walk away', async () => {
    await fillClass();

    const res = await join('Ana');

    expect(res.status).toBe(201);
    expect(res.body.place).toBe(1);
    expect(res.body.status).toBe('WAITING');
  });

  it('tells each person where they stand', async () => {
    await fillClass();

    expect((await join('Ana')).body.place).toBe(1);
    expect((await join('Ben')).body.place).toBe(2);
    expect((await join('Cleo')).body.place).toBe(3);
  });

  it('refuses to queue somebody for a class with room in it', async () => {
    // Only one of two seats taken.
    await fillClass(1);

    const res = await join('Ana');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEATS_AVAILABLE');
  });

  it('refuses a second live place for the same person', async () => {
    await fillClass();
    await join('Ana');

    const again = await join('Ana');

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_WAITING');
    expect(await prisma.waitlistEntry.count()).toBe(1);
  });

  it('refuses a class that has already started', async () => {
    const service = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Past Class',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 1,
        priceCents: 0,
      });
    const past = await request(app)
      .post(`${studio.base}/sessions`)
      .set(studio.headers)
      .send({
        serviceTypeId: service.body.service.id,
        startLocalDate: '2026-07-01',
        localStartTime: '10:00',
        capacity: 1,
      });

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Filled',
        email: 'filled@student.test',
      },
    });
    const { bookSeats } = await import('../../src/scheduling/booking.service');
    await bookSeats({
      organizationId: studio.organizationId,
      sessionId: past.body.created[0].id,
      customerId: customer.id,
      seats: 1,
    });

    const res = await request(app)
      .post(`/public/${slug}/sessions/${past.body.created[0].id}/waitlist`)
      .send({ customer: { name: 'Ana', email: 'ana@student.test' } });

    expect(res.status).toBe(409);
  });
});

describe('offering a freed seat', () => {
  it('offers to the person who waited longest, and holds the seat', async () => {
    const bookings = await fillClass();
    await join('Ana');
    await join('Ben');

    const { cancelBooking } = await import('../../src/scheduling/booking.service');
    await cancelBooking(studio.organizationId, bookings[0]!.id);
    await settle();

    const entries = await prisma.waitlistEntry.findMany({
      orderBy: { position: 'asc' },
    });

    expect(entries[0]!.status).toBe('OFFERED');
    expect(entries[0]!.holdId).not.toBeNull();
    expect(entries[0]!.offerExpiresAt).not.toBeNull();
    // Second in line is untouched.
    expect(entries[1]!.status).toBe('WAITING');

    /**
     * The decisive assertion. The seat is HELD, so the class still reads full
     * — a passing web visitor cannot take the place being offered to Ana.
     */
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(2);
  });

  it('emails the offer with a claim link and an expiry', async () => {
    const bookings = await fillClass();
    await join('Ana');

    const { cancelBooking } = await import('../../src/scheduling/booking.service');
    await cancelBooking(studio.organizationId, bookings[0]!.id);
    await settle();

    const offer = await prisma.notification.findFirst({
      where: { templateKey: 'waitlist.offer', channel: 'EMAIL' },
    });

    expect(offer).not.toBeNull();
    expect(JSON.stringify(offer!.payload)).toContain('/claim');
  });

  it('skips somebody wanting more seats than freed, without blocking the queue', async () => {
    const bookings = await fillClass();
    await join('Ana', 2); // wants both seats
    await join('Ben', 1);

    const { cancelBooking } = await import('../../src/scheduling/booking.service');
    await cancelBooking(studio.organizationId, bookings[0]!.id);
    await settle();

    const [ana, ben] = await prisma.waitlistEntry.findMany({
      orderBy: { position: 'asc' },
    });

    // One seat is no use to Ana, so it goes to Ben — but Ana keeps her place.
    expect(ana!.status).toBe('WAITING');
    expect(ben!.status).toBe('OFFERED');
    expect(ana!.position).toBeLessThan(ben!.position);
  });

  /** THE GATE. Two seats freeing at once must reach two different people. */
  it('never offers one seat to two people when cancellations race', async () => {
    const bookings = await fillClass();
    await join('Ana');
    await join('Ben');
    await join('Cleo');

    const { cancelBooking } = await import('../../src/scheduling/booking.service');
    await Promise.all([
      cancelBooking(studio.organizationId, bookings[0]!.id),
      cancelBooking(studio.organizationId, bookings[1]!.id),
    ]);
    await settle(1500);

    const offered = await prisma.waitlistEntry.findMany({
      where: { status: 'OFFERED' },
    });

    // Two seats freed, so at most two offers — and never the same seat twice.
    expect(offered.length).toBeLessThanOrEqual(2);

    const holds = await prisma.bookingHold.findMany({
      where: { releasedAt: null },
    });
    expect(holds.length).toBe(offered.length);

    // Seats held plus seats booked can never exceed the room.
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBeLessThanOrEqual(session.capacity);

    // Nobody is offered a place twice.
    const ids = offered.map((o) => o.customerId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('claiming an offer', () => {
  async function offerTo(name: string) {
    const bookings = await fillClass();
    await join(name);

    const { cancelBooking } = await import('../../src/scheduling/booking.service');
    await cancelBooking(studio.organizationId, bookings[0]!.id);
    await settle();

    const entry = await prisma.waitlistEntry.findFirstOrThrow({
      where: { status: 'OFFERED' },
    });
    return Buffer.from(entry.claimToken).toString('base64url');
  }

  it('shows what is on offer before taking it', async () => {
    const token = await offerTo('Ana');

    const res = await request(app).get(`/public/waitlist/${token}/claim`);

    expect(res.status).toBe(200);
    expect(res.body.claimable).toBe(true);
    expect(res.body.service).toBe('Wheel Class');
    expect(res.body.offerExpiresAt).toBeTruthy();
  });

  it('converts the held seat rather than taking a second one', async () => {
    const token = await offerTo('Ana');

    const res = await request(app).post(`/public/waitlist/${token}/claim`);

    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe('CONFIRMED');
    expect(res.body.manageToken).toBeTruthy();

    // Still exactly full: the hold became the booking, it did not add to it.
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(2);

    const entry = await prisma.waitlistEntry.findFirstOrThrow();
    expect(entry.status).toBe('CLAIMED');
    expect(entry.bookingId).toBe(res.body.booking.id);
  });

  it('cannot be claimed twice', async () => {
    const token = await offerTo('Ana');

    await request(app).post(`/public/waitlist/${token}/claim`);
    const second = await request(app).post(`/public/waitlist/${token}/claim`);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_CLAIMED');

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(2);
  });

  it('refuses an expired offer', async () => {
    const token = await offerTo('Ana');

    await prisma.waitlistEntry.updateMany({
      where: { status: 'OFFERED' },
      data: { offerExpiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await request(app).post(`/public/waitlist/${token}/claim`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OFFER_EXPIRED');
  });
});

describe('offers that lapse', () => {
  it('passes the seat to the next person and frees nothing in between', async () => {
    const bookings = await fillClass();
    await join('Ana');
    await join('Ben');

    const { cancelBooking } = await import('../../src/scheduling/booking.service');
    await cancelBooking(studio.organizationId, bookings[0]!.id);
    await settle();

    // Ana's window runs out.
    await prisma.waitlistEntry.updateMany({
      where: { status: 'OFFERED' },
      data: { offerExpiresAt: new Date(Date.now() - 60_000) },
    });

    const { sweepExpiredOffers } = await import(
      '../../src/modules/waitlists/waitlist.service'
    );
    const result = await sweepExpiredOffers();

    expect(result.expired).toBe(1);
    expect(result.passedOn).toBe(1);

    const [ana, ben] = await prisma.waitlistEntry.findMany({
      orderBy: { position: 'asc' },
    });
    expect(ana!.status).toBe('EXPIRED');
    expect(ben!.status).toBe('OFFERED');

    // The seat never became publicly bookable on the way between them.
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(2);
  });

  it('releases the seat when the last person in the queue lets it lapse', async () => {
    const bookings = await fillClass();
    await join('Ana');

    const { cancelBooking } = await import('../../src/scheduling/booking.service');
    await cancelBooking(studio.organizationId, bookings[0]!.id);
    await settle();

    await prisma.waitlistEntry.updateMany({
      where: { status: 'OFFERED' },
      data: { offerExpiresAt: new Date(Date.now() - 60_000) },
    });

    const { sweepExpiredOffers } = await import(
      '../../src/modules/waitlists/waitlist.service'
    );
    await sweepExpiredOffers();

    // Nobody left to offer it to, so the seat goes back on sale.
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(1);
  });

  it('hands the seat straight on when somebody turns it down', async () => {
    const bookings = await fillClass();
    await join('Ana');
    await join('Ben');

    const { cancelBooking } = await import('../../src/scheduling/booking.service');
    await cancelBooking(studio.organizationId, bookings[0]!.id);
    await settle();

    const ana = await prisma.waitlistEntry.findFirstOrThrow({
      where: { status: 'OFFERED' },
    });

    const res = await request(app)
      .delete(`${studio.base}/sessions/${sessionId}/waitlist/${ana.id}`)
      .set(studio.headers);
    expect(res.status).toBe(200);
    await settle();

    const ben = await prisma.waitlistEntry.findFirstOrThrow({
      where: { customerId: { not: ana.customerId } },
    });
    expect(ben.status).toBe('OFFERED');
  });
});

describe('the studio view', () => {
  it('reports how many people were turned away', async () => {
    await fillClass();
    await join('Ana');
    await join('Ben', 2);

    const res = await request(app)
      .get(`${studio.base}/sessions/${sessionId}/waitlist`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.body.waitingCount).toBe(2);
    // The number that argues for opening a second class.
    expect(res.body.seatsWanted).toBe(3);
  });

  it("hides another studio's waitlist", async () => {
    await fillClass();
    await join('Ana');

    const stranger = await signUpStudio(app);
    const res = await request(app)
      .get(`${stranger.base}/sessions/${sessionId}/waitlist`)
      .set(stranger.headers);

    expect(res.status).toBe(404);
  });
});
