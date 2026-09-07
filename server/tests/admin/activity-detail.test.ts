import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';

/**
 * The fields the Create-activity form gained when it was brought up to the
 * prototype's.
 *
 * Two things are worth testing here and the second is the one that bites.
 * The columns are ordinary and either round-trip or do not. `locationId` is
 * NOT ordinary: it is a field on the form and a join row in the database, so
 * it has to be peeled out of the payload before the row is written, and the
 * edit path has to be able to read it back — a form that cannot read it sends
 * null on the next save and quietly unsets where the class runs.
 */

const app = createApp();

let studio: Studio;
let locationId: string;
let otherLocationId: string;

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

  const first = await prisma.location.create({
    data: {
      organizationId: studio.organizationId,
      name: 'Gowanus Studio',
      locationType: 'FIXED',
      address: '119 Kiln Street, Brooklyn, NY',
      timezone: 'America/New_York',
    },
  });
  locationId = first.id;

  const second = await prisma.location.create({
    data: {
      organizationId: studio.organizationId,
      name: 'Red Hook Annexe',
      locationType: 'FIXED',
      address: '4 Wharf Road, Brooklyn, NY',
      timezone: 'America/New_York',
    },
  });
  otherLocationId = second.id;
});

/** The form's payload, minus whatever a case is actually about. */
function activity(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Family Wheel Afternoon',
    shortDescription: 'A two-hour throw for grown-ups and children together',
    description: 'Centring, pulling, and a cup each to take home.',
    bookingMode: 'EVENT',
    durationMinutes: 120,
    capacityMax: 8,
    capacityMin: 2,
    priceCents: 9500,
    childPriceCents: 5000,
    meetingPoint: 'Second door on the left, ring the bell',
    bookingInstructions: 'Park on Kiln Street. If the door is locked, ring the top bell.',
    emoji: '🏺',
    color: '#4f46e5',
    colorAccent: '#7c3aed',
    isActive: true,
    ...overrides,
  };
}

describe('creating an activity with the full form', () => {
  it('stores every field the form sends', async () => {
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity());

    expect(res.status).toBe(201);

    const saved = await prisma.serviceType.findUniqueOrThrow({
      where: { id: res.body.service.id },
    });

    expect(saved.shortDescription).toBe(
      'A two-hour throw for grown-ups and children together',
    );
    expect(saved.childPriceCents).toBe(5000);
    expect(saved.meetingPoint).toBe('Second door on the left, ring the bell');
    expect(saved.bookingInstructions).toContain('ring the top bell');
    expect(saved.emoji).toBe('🏺');
    expect(saved.colorAccent).toBe('#7c3aed');
    expect(saved.capacityMin).toBe(2);
  });

  it('defaults the child rate to adults only', async () => {
    // Zero, not null. A studio that has not thought about children must not
    // accidentally be offering them a free place.
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ childPriceCents: undefined }));

    expect(res.status).toBe(201);
    expect(res.body.service.childPriceCents).toBe(0);
  });

  it('refuses a colour that is not a hex value', async () => {
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ colorAccent: 'purple' }));

    expect(res.status).toBe(422);
  });

  it('refuses a short description longer than a card can hold', async () => {
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ shortDescription: 'x'.repeat(201) }));

    expect(res.status).toBe(422);
  });

  it('refuses a caption in the icon field', async () => {
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ emoji: 'a wheel throwing class' }));

    expect(res.status).toBe(422);
  });
});

describe('where an activity runs', () => {
  it('writes the join row rather than trying to write a column', async () => {
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ locationId }));

    expect(res.status).toBe(201);

    const links = await prisma.serviceLocation.findMany({
      where: { serviceTypeId: res.body.service.id },
    });
    expect(links).toHaveLength(1);
    expect(links[0]!.locationId).toBe(locationId);
  });

  it('hands the location back on the list, so the edit form can prefill it', async () => {
    /*
      The one that stops a silent unset.

      The form sends `locationId: null` for "nowhere in particular", so if the
      list did not return the current location the form would open blank and
      the next save — of a price, of a typo in the name — would clear where
      the class runs, with nobody having touched that field.
    */
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ locationId }));

    const list = await request(app)
      .get(`${studio.base}/services?includeInactive=true`)
      .set(studio.headers);

    const row = list.body.services.find(
      (s: { id: string }) => s.id === created.body.service.id,
    );
    expect(row.serviceLocations).toEqual([{ locationId }]);
  });

  it('replaces the location rather than adding a second one', async () => {
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ locationId }));

    await request(app)
      .patch(`${studio.base}/services/${created.body.service.id}`)
      .set(studio.headers)
      .send({ locationId: otherLocationId });

    const links = await prisma.serviceLocation.findMany({
      where: { serviceTypeId: created.body.service.id },
    });
    expect(links).toHaveLength(1);
    expect(links[0]!.locationId).toBe(otherLocationId);
  });

  it('clears the location when the form sends null', async () => {
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ locationId }));

    await request(app)
      .patch(`${studio.base}/services/${created.body.service.id}`)
      .set(studio.headers)
      .send({ locationId: null });

    const links = await prisma.serviceLocation.findMany({
      where: { serviceTypeId: created.body.service.id },
    });
    expect(links).toHaveLength(0);
  });

  it('leaves the location alone when the form does not mention it', async () => {
    // Absent and null mean different things: one is "leave it", the other is
    // "clear it". A partial update of the price must not move the class.
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ locationId }));

    await request(app)
      .patch(`${studio.base}/services/${created.body.service.id}`)
      .set(studio.headers)
      .send({ priceCents: 11000 });

    const links = await prisma.serviceLocation.findMany({
      where: { serviceTypeId: created.body.service.id },
    });
    expect(links).toHaveLength(1);
    expect(links[0]!.locationId).toBe(locationId);
  });

  it('cannot attach another studio\'s location, and saves nothing when it tries', async () => {
    const stranger = await signUpStudio(app);
    const theirs = await prisma.location.create({
      data: {
        organizationId: stranger.organizationId,
        name: 'Somebody else',
        locationType: 'FIXED',
        timezone: 'America/New_York',
      },
    });

    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ locationId: theirs.id }));

    expect(res.status).toBe(400);

    /*
      And no orphan behind it. The location is validated BEFORE the service
      row is written precisely so a rejected create does not leave a saved
      class the studio was told had failed — they would create it again and
      have two.
    */
    const services = await prisma.serviceType.count({
      where: { organizationId: studio.organizationId },
    });
    expect(services).toBe(0);
  });
});

/**
 * The figures printed on a catalogue card.
 *
 * `withStats` is opt-in and carries the money rule, which is the part worth
 * pinning down: revenue is what was RECEIVED, not what was owed. A card that
 * counted `booking.totalCents` would show a studio thousands it has not been
 * paid, and it would disagree with Reports about the same class.
 */
describe('catalogue statistics', () => {
  /** A confirmed booking on a dated session, optionally paid. */
  async function bookOnce(
    serviceTypeId: string,
    opts: { seats?: number; paidCents?: number; status?: 'CONFIRMED' | 'CANCELLED' } = {},
  ) {
    const starts = new Date(Date.now() + 7 * 86_400_000);
    const session = await prisma.session.create({
      data: {
        organizationId: studio.organizationId,
        serviceTypeId,
        startsAt: starts,
        endsAt: new Date(starts.getTime() + 120 * 60_000),
        timezone: 'America/New_York',
        localStartTime: '18:00',
        capacity: 10,
        seatsTaken: 0,
        status: 'SCHEDULED',
      },
    });

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Ana Vidal',
        email: `ana-${Math.random().toString(36).slice(2)}@family.test`,
      },
    });

    const booking = await prisma.booking.create({
      data: {
        organizationId: studio.organizationId,
        customerId: customer.id,
        serviceTypeId,
        sessionId: session.id,
        startsAt: starts,
        endsAt: new Date(starts.getTime() + 120 * 60_000),
        timezone: 'America/New_York',
        seats: opts.seats ?? 1,
        status: opts.status ?? 'CONFIRMED',
        totalCents: 9500,
        cancelToken: Buffer.from(
          Math.random().toString(36).padEnd(32, 'x').slice(0, 32),
        ),
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

  async function statsFor(serviceTypeId: string) {
    const res = await request(app)
      .get(`${studio.base}/services?includeInactive=true&withStats=true`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    return res.body.services.find((s: { id: string }) => s.id === serviceTypeId)
      ?.stats;
  }

  it('is left out unless it is asked for', async () => {
    // Every other caller of this route — the booking form's class picker,
    // onboarding — should not pay for a read of every booking in the studio.
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity());

    const res = await request(app)
      .get(`${studio.base}/services?includeInactive=true`)
      .set(studio.headers);

    const row = res.body.services.find(
      (s: { id: string }) => s.id === created.body.service.id,
    );
    expect(row.stats).toBeUndefined();
  });

  it('reports zero for a class nobody has booked', async () => {
    // Zero rather than absent: the card prints this, and a missing figure
    // renders as "undefined bookings".
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity());

    expect(await statsFor(created.body.service.id)).toEqual({
      serviceTypeId: created.body.service.id,
      bookings: 0,
      seats: 0,
      revenueCents: 0,
    });
  });

  it('counts bookings and seats separately', async () => {
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity());

    await bookOnce(created.body.service.id, { seats: 3 });
    await bookOnce(created.body.service.id, { seats: 2 });

    const stats = await statsFor(created.body.service.id);
    expect(stats.bookings).toBe(2);
    expect(stats.seats).toBe(5);
  });

  it('counts money received, not money owed', async () => {
    /*
      THE rule. This booking owes $95 and has paid nothing — a studio taking
      cash at the door has a catalogue full of these. Reporting the total
      would show revenue that has not arrived.
    */
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity());

    await bookOnce(created.body.service.id);

    const stats = await statsFor(created.body.service.id);
    expect(stats.bookings).toBe(1);
    expect(stats.revenueCents).toBe(0);
  });

  it('adds up what was actually paid', async () => {
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity());

    await bookOnce(created.body.service.id, { paidCents: 9500 });
    await bookOnce(created.body.service.id, { paidCents: 5000 });

    const stats = await statsFor(created.body.service.id);
    expect(stats.revenueCents).toBe(14_500);
  });

  it('ignores a cancelled booking', async () => {
    // A cancelled seat is not demand, and a card ranking classes by it would
    // flatter one that everybody books and nobody keeps.
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity());

    await bookOnce(created.body.service.id, { status: 'CANCELLED', seats: 4 });

    const stats = await statsFor(created.body.service.id);
    expect(stats.bookings).toBe(0);
    expect(stats.seats).toBe(0);
  });

  it('does not leak another studio\'s figures', async () => {
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity());
    await bookOnce(created.body.service.id, { seats: 2, paidCents: 9500 });

    const stranger = await signUpStudio(app);
    const theirs = await request(app)
      .get(`${stranger.base}/services?includeInactive=true&withStats=true`)
      .set(stranger.headers);

    expect(theirs.body.services).toHaveLength(0);
  });
});
