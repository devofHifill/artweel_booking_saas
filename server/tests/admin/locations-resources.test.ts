import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';

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

// Brooklyn-ish, so the distances below are realistic.
const STUDIO_POINT = { lat: 40.6782, lng: -73.9442 };

describe('service areas', () => {
  it('refuses a service area with no centre point', async () => {
    // Without coordinates every address counts as in range, and the studio
    // silently starts accepting jobs three hours away.
    const res = await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({ name: 'Mobile parties', locationType: 'SERVICE_AREA' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_COORDINATES');
  });

  it('refuses a service area with no radius', async () => {
    const res = await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({
        name: 'Mobile parties',
        locationType: 'SERVICE_AREA',
        ...STUDIO_POINT,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_RADIUS');
  });

  it('accepts a properly specified service area', async () => {
    const res = await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({
        name: 'Mobile parties',
        locationType: 'SERVICE_AREA',
        ...STUDIO_POINT,
        radiusMeters: 25_000,
      });

    expect(res.status).toBe(201);
    expect(res.body.location.radiusMeters).toBe(25_000);
  });

  it('rejects travel bands that are not an ascending ladder', async () => {
    // Lookup takes the FIRST band covering the distance, so an out-of-order
    // ladder charges a price nobody intended.
    const res = await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({
        name: 'Mobile parties',
        locationType: 'SERVICE_AREA',
        ...STUDIO_POINT,
        radiusMeters: 40_000,
        travelFeeBands: [
          { maxKm: 30, feeCents: 9000 },
          { maxKm: 10, feeCents: 2500 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BANDS_OUT_OF_ORDER');
  });

  it('answers coverage questions with a distance and a fee', async () => {
    const created = await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({
        name: 'Mobile parties',
        locationType: 'SERVICE_AREA',
        ...STUDIO_POINT,
        radiusMeters: 40_000,
        travelFeeBands: [
          { maxKm: 10, feeCents: 2500 },
          { maxKm: 30, feeCents: 9000, minSpendCents: 40_000 },
        ],
      });

    const near = await request(app)
      .post(`${studio.base}/locations/${created.body.location.id}/coverage`)
      .set(studio.headers)
      .send({ lat: 40.7128, lng: -74.006 }); // Manhattan, roughly 6-7km

    expect(near.body.covered).toBe(true);
    expect(near.body.travelFeeCents).toBe(2500);

    const farAway = await request(app)
      .post(`${studio.base}/locations/${created.body.location.id}/coverage`)
      .set(studio.headers)
      .send({ lat: 42.6526, lng: -73.7562 }); // Albany, ~200km

    expect(farAway.body.covered).toBe(false);
    expect(farAway.body.reason).toBe('OUT_OF_RANGE');
  });

  it('treats beyond-the-last-band as out of range even inside the radius', async () => {
    // The ladder is the stricter statement of intent: if no band prices a
    // distance, the studio has not said it will travel there.
    const created = await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({
        name: 'Mobile parties',
        locationType: 'SERVICE_AREA',
        ...STUDIO_POINT,
        radiusMeters: 200_000,
        travelFeeBands: [{ maxKm: 10, feeCents: 2500 }],
      });

    const res = await request(app)
      .post(`${studio.base}/locations/${created.body.location.id}/coverage`)
      .set(studio.headers)
      .send({ lat: 41.5, lng: -73.9 }); // ~90km: inside radius, beyond bands

    expect(res.body.covered).toBe(false);
    expect(res.body.reason).toBe('OUT_OF_RANGE');
  });

  it('validates the merged shape when a patch changes the type', async () => {
    const created = await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({ name: 'Studio', locationType: 'FIXED', address: '119 Kiln St' });

    // Promoting a coordinate-less fixed venue to a service area must fail.
    const res = await request(app)
      .patch(`${studio.base}/locations/${created.body.location.id}`)
      .set(studio.headers)
      .send({ locationType: 'SERVICE_AREA' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_COORDINATES');
  });
});

describe('resources', () => {
  it('refuses an exclusive resource with a quantity above one', async () => {
    // The EXCLUDE constraint permits one allocation at a time regardless of
    // quantity, so the extra units would silently never be usable.
    const res = await request(app)
      .post(`${studio.base}/resources`)
      .set(studio.headers)
      .send({
        name: 'Kilns',
        resourceType: 'KILN',
        quantity: 3,
        isExclusive: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXCLUSIVE_QUANTITY');
  });

  it('refuses to shrink equipment below what upcoming bookings need', async () => {
    // Nothing fails at the moment of the edit otherwise — it fails on the day,
    // in front of customers.
    const wheels = await request(app)
      .post(`${studio.base}/resources`)
      .set(studio.headers)
      .send({ name: 'Pottery wheels', resourceType: 'WHEEL', quantity: 8 });

    const { allocateResource } = await import(
      '../../src/scheduling/resource.service'
    );
    const future = new Date(Date.now() + 30 * 24 * 60 * 60_000);

    await allocateResource({
      organizationId: studio.organizationId,
      resourceId: wheels.body.resource.id,
      quantity: 6,
      startsAt: future,
      endsAt: new Date(future.getTime() + 3 * 60 * 60_000),
    });

    const tooSmall = await request(app)
      .patch(`${studio.base}/resources/${wheels.body.resource.id}`)
      .set(studio.headers)
      .send({ quantity: 4 });

    expect(tooSmall.status).toBe(409);
    expect(tooSmall.body.error.code).toBe('QUANTITY_BELOW_COMMITTED');

    // Down to exactly what is committed is allowed.
    expect(
      (
        await request(app)
          .patch(`${studio.base}/resources/${wheels.body.resource.id}`)
          .set(studio.headers)
          .send({ quantity: 6 })
      ).status,
    ).toBe(200);
  });

  it('measures peak concurrency, not the sum of all allocations', async () => {
    // Two 4-wheel classes that do not overlap peak at 4, not 8. A naive SUM
    // would block a perfectly legal reduction.
    const wheels = await request(app)
      .post(`${studio.base}/resources`)
      .set(studio.headers)
      .send({ name: 'Pottery wheels', resourceType: 'WHEEL', quantity: 8 });

    const { allocateResource } = await import(
      '../../src/scheduling/resource.service'
    );
    const day = new Date(Date.now() + 30 * 24 * 60 * 60_000);
    const morning = new Date(day.getTime());
    const afternoon = new Date(day.getTime() + 4 * 60 * 60_000);

    await allocateResource({
      organizationId: studio.organizationId,
      resourceId: wheels.body.resource.id,
      quantity: 4,
      startsAt: morning,
      endsAt: new Date(morning.getTime() + 3 * 60 * 60_000),
    });
    await allocateResource({
      organizationId: studio.organizationId,
      resourceId: wheels.body.resource.id,
      quantity: 4,
      startsAt: afternoon,
      endsAt: new Date(afternoon.getTime() + 3 * 60 * 60_000),
    });

    const res = await request(app)
      .patch(`${studio.base}/resources/${wheels.body.resource.id}`)
      .set(studio.headers)
      .send({ quantity: 4 });

    expect(res.status).toBe(200);
  });

  it('blocks a kiln for a firing that has no booking behind it', async () => {
    const kiln = await request(app)
      .post(`${studio.base}/resources`)
      .set(studio.headers)
      .send({
        name: 'Skutt KM-1027',
        resourceType: 'KILN',
        quantity: 1,
        isExclusive: true,
      });

    const start = new Date(Date.now() + 24 * 60 * 60_000);
    const firing = {
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 14 * 60 * 60_000).toISOString(),
      note: 'Bisque firing',
    };

    expect(
      (
        await request(app)
          .post(`${studio.base}/resources/${kiln.body.resource.id}/blocks`)
          .set(studio.headers)
          .send(firing)
      ).status,
    ).toBe(201);

    // A second overlapping firing is refused by the exclusion constraint.
    const overlapping = await request(app)
      .post(`${studio.base}/resources/${kiln.body.resource.id}/blocks`)
      .set(studio.headers)
      .send({
        startsAt: new Date(start.getTime() + 6 * 60 * 60_000).toISOString(),
        endsAt: new Date(start.getTime() + 20 * 60 * 60_000).toISOString(),
      });

    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error.code).toBe('RESOURCE_UNAVAILABLE');
  });
});
