import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';
import { getStorefront } from '../../src/modules/public/storefront.service';

/**
 * Sessions that lost their booking page when the studio got a location.
 *
 * Found walking a new studio through the app (docs/ux-audit-findings.md #16).
 * A studio with no location schedules classes; the booking page does not ask
 * by location, so they show and get booked. The studio then gets its first
 * location — the setup wizard is the only way — and from then on the page asks
 * for sessions AT it. Every session scheduled before matched nothing: "No
 * dates scheduled yet", a confirmed booking's class included, while the
 * dashboard listed them as normal and the home page still said "Book now".
 */

const app = createApp();
let studio: Studio;
let slug: string;
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
  studio = await signUpStudio(app, { timezone: 'Europe/London' });
  slug = (
    await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
      select: { slug: true },
    })
  ).slug;

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

async function scheduleClass(body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`${studio.base}/sessions`)
    .set(studio.headers)
    .send({
      serviceTypeId: serviceId,
      startLocalDate: localDate(10),
      localStartTime: '17:00',
      capacity: 10,
      ...body,
    })
    .expect(201);
  return res.body.created[0].id as string;
}

async function addLocation(name: string) {
  const res = await request(app)
    .post(`${studio.base}/locations`)
    .set(studio.headers)
    .send({ name })
    .expect(201);
  return res.body.location.id as string;
}

/** What the booking page sees: it asks by location as soon as there is one. */
async function bookableSessionIds(locationId?: string) {
  const res = await request(app)
    .get(`/public/${slug}/availability`)
    .query({
      serviceTypeId: serviceId,
      from: localDate(0),
      to: localDate(60),
      ...(locationId ? { locationId } : {}),
    })
    .expect(200);
  return (res.body.sessions as { sessionId?: string; id?: string }[]).map(
    (s) => s.sessionId ?? s.id,
  );
}

const locationOf = async (sessionId: string) =>
  (await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).locationId;

describe("a studio's first location", () => {
  it('keeps the classes scheduled before it on the booking page', async () => {
    const before = await scheduleClass();
    expect(await locationOf(before)).toBeNull();
    expect(await bookableSessionIds()).toContain(before);

    const room = await addLocation('The boathouse');

    expect(await locationOf(before)).toBe(room);
    expect(await bookableSessionIds(room)).toContain(before);
  });

  it('does the same when the setup wizard creates it', async () => {
    const before = await scheduleClass();

    await request(app)
      .post(`${studio.base}/onboarding/seed`)
      .set(studio.headers)
      .send({})
      .expect(200);

    const room = (
      await prisma.location.findFirstOrThrow({
        where: { organizationId: studio.organizationId },
      })
    ).id;
    expect(await locationOf(before)).toBe(room);
    expect(await bookableSessionIds(room)).toContain(before);
  });

  it('leaves classes that already ran alone', async () => {
    const past = await prisma.session.create({
      data: {
        organizationId: studio.organizationId,
        serviceTypeId: serviceId,
        startsAt: new Date(Date.now() - 3 * 86_400_000),
        endsAt: new Date(Date.now() - 3 * 86_400_000 + 7_200_000),
        timezone: 'Europe/London',
        localStartTime: '17:00',
        capacity: 10,
      },
    });

    await addLocation('The boathouse');

    expect(await locationOf(past.id)).toBeNull();
  });

  it('does not move classes onto a second location', async () => {
    const first = await addLocation('The boathouse');
    const unplaced = await prisma.session.create({
      data: {
        organizationId: studio.organizationId,
        serviceTypeId: serviceId,
        startsAt: new Date(Date.now() + 5 * 86_400_000),
        endsAt: new Date(Date.now() + 5 * 86_400_000 + 7_200_000),
        timezone: 'Europe/London',
        localStartTime: '17:00',
        capacity: 10,
      },
    });

    await addLocation('The harbour wall');

    // Which of two rooms is a real choice, so nothing is guessed.
    expect(await locationOf(unplaced.id)).toBeNull();
    expect(first).toBeTruthy();
  });
});

describe('scheduling a class with no location chosen', () => {
  it('uses the studio’s only location', async () => {
    const room = await addLocation('The boathouse');

    const id = await scheduleClass();

    expect(await locationOf(id)).toBe(room);
    expect(await bookableSessionIds(room)).toContain(id);
  });

  it('guesses nothing when there are several', async () => {
    await addLocation('The boathouse');
    await addLocation('The harbour wall');

    const id = await scheduleClass();

    expect(await locationOf(id)).toBeNull();
  });

  it('still honours a location that was chosen', async () => {
    await addLocation('The boathouse');
    const wall = await addLocation('The harbour wall');

    const id = await scheduleClass({ locationId: wall });

    expect(await locationOf(id)).toBe(wall);
  });
});

describe('the storefront home page', () => {
  it('does not advertise a class the booking page cannot sell', async () => {
    await addLocation('The boathouse');
    await addLocation('The harbour wall');
    const lost = await scheduleClass(); // several locations: stays unplaced

    const store = await getStorefront(slug);
    const kayak = store.services.find((s) => s.id === serviceId)!;

    expect(kayak.sessions.map((s) => s.id)).not.toContain(lost);
  });

  it('still lists classes while the studio has no location at all', async () => {
    const id = await scheduleClass();

    const store = await getStorefront(slug);
    const kayak = store.services.find((s) => s.id === serviceId)!;

    // The booking page shows these too — it only asks by location once one exists.
    expect(kayak.sessions.map((s) => s.id)).toContain(id);
  });
});

describe('the repair migration', () => {
  async function runMigration() {
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260929120000_sessions_adopt_only_location/migration.sql',
      ),
      'utf8',
    );
    const statements = sql
      .replace(/--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  }

  const rawSession = (daysAhead: number) =>
    prisma.session.create({
      data: {
        organizationId: studio.organizationId,
        serviceTypeId: serviceId,
        startsAt: new Date(Date.now() + daysAhead * 86_400_000),
        endsAt: new Date(Date.now() + daysAhead * 86_400_000 + 7_200_000),
        timezone: 'Europe/London',
        localStartTime: '17:00',
        capacity: 10,
      },
    });

  it('places upcoming classes in a one-location studio, and nothing else', async () => {
    // Made the old way: the location arrives without the adoption step.
    const upcoming = await rawSession(7);
    const past = await rawSession(-7);
    const room = await prisma.location.create({
      data: { organizationId: studio.organizationId, name: 'The boathouse' },
    });

    await runMigration();
    await runMigration(); // twice: it only ever fills what is missing

    expect(await locationOf(upcoming.id)).toBe(room.id);
    expect(await locationOf(past.id)).toBeNull();
  });

  it('leaves a studio with several locations alone', async () => {
    const upcoming = await rawSession(7);
    await prisma.location.createMany({
      data: [
        { organizationId: studio.organizationId, name: 'The boathouse' },
        { organizationId: studio.organizationId, name: 'The harbour wall' },
      ],
    });

    await runMigration();

    expect(await locationOf(upcoming.id)).toBeNull();
  });
});
