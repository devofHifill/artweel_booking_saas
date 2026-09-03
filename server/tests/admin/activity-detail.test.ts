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
