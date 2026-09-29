import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';

/**
 * The Locations screen (docs/ux-audit-findings.md #10), and the API rules it
 * leans on.
 *
 * The screen could only be built safely once three gaps were closed: a new
 * location defaulted to New York whatever the studio's zone; switching one off
 * silently hid every class still to run there; and deleting one with classes
 * but no bookings wiped where those classes were, hiding them the same way.
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
  resetRateLimits();
  studio = await signUpStudio(app, { timezone: 'Asia/Kolkata' });
  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Sunset kayak tour',
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMin: 1,
      capacityMax: 10,
      priceCents: 4500,
    })
    .expect(201);
  serviceId = service.body.service.id;
});

const localDate = (daysAhead: number) =>
  new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);

const addLocation = (body: Record<string, unknown>) =>
  request(app).post(`${studio.base}/locations`).set(studio.headers).send(body);

async function scheduleAt(locationId: string) {
  const res = await request(app)
    .post(`${studio.base}/sessions`)
    .set(studio.headers)
    .send({
      serviceTypeId: serviceId,
      startLocalDate: localDate(10),
      localStartTime: '17:00',
      capacity: 10,
      locationId,
    })
    .expect(201);
  return res.body.created[0].id as string;
}

describe('adding a location', () => {
  it("uses the studio's timezone when none is given", async () => {
    const res = await addLocation({ name: 'The boathouse' }).expect(201);
    expect(res.body.location.timezone).toBe('Asia/Kolkata');
  });

  it('keeps a timezone that was chosen, and refuses one that does not exist', async () => {
    const res = await addLocation({ name: 'Harbour wall', timezone: 'Europe/London' }).expect(201);
    expect(res.body.location.timezone).toBe('Europe/London');

    await addLocation({ name: 'Nowhere', timezone: 'Europe/Atlantis' }).expect(422);
  });

  it('says "1 location", not "1 locations", at the plan limit', async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { plan: 'SOLO' },
    });
    await addLocation({ name: 'The boathouse' }).expect(201);

    const res = await addLocation({ name: 'Harbour wall' }).expect(402);
    expect(res.body.error.message).toContain('includes 1 location.');
  });
});

describe('switching a location off', () => {
  it('is refused while classes are still to run there', async () => {
    const loc = (await addLocation({ name: 'The boathouse' }).expect(201)).body.location.id;
    await addLocation({ name: 'Harbour wall' }).expect(201);
    const sessionId = await scheduleAt(loc);

    const refused = await request(app)
      .patch(`${studio.base}/locations/${loc}`)
      .set(studio.headers)
      .send({ isActive: false })
      .expect(409);
    expect(refused.body.error.code).toBe('LOCATION_HAS_UPCOMING');
    expect(refused.body.error.message).toContain('1 upcoming class is at The boathouse');

    // Once the class is cancelled there is nothing left to hide.
    await request(app).delete(`${studio.base}/sessions/${sessionId}`).set(studio.headers).expect(200);
    await request(app)
      .patch(`${studio.base}/locations/${loc}`)
      .set(studio.headers)
      .send({ isActive: false })
      .expect(200);
  });

  it('takes a plan slot again when switched back on', async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { plan: 'SOLO' },
    });
    const off = (await addLocation({ name: 'Old room', isActive: false }).expect(201)).body.location.id;
    await addLocation({ name: 'The boathouse' }).expect(201);

    await request(app)
      .patch(`${studio.base}/locations/${off}`)
      .set(studio.headers)
      .send({ isActive: true })
      .expect(402);
  });
});

describe('removing a location', () => {
  it('is refused when classes have been at it, even with no bookings', async () => {
    const loc = (await addLocation({ name: 'The boathouse' }).expect(201)).body.location.id;
    await addLocation({ name: 'Harbour wall' }).expect(201);
    const sessionId = await scheduleAt(loc);

    const res = await request(app)
      .delete(`${studio.base}/locations/${loc}`)
      .set(studio.headers)
      .expect(409);
    expect(res.body.error.code).toBe('LOCATION_IN_USE');

    // The class still knows where it is.
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.locationId).toBe(loc);
  });

  it('is allowed for a location nothing has used', async () => {
    const loc = (await addLocation({ name: 'The boathouse' }).expect(201)).body.location.id;

    await request(app).delete(`${studio.base}/locations/${loc}`).set(studio.headers).expect(204);
  });
});
