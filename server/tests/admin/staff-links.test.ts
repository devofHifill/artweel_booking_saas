import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, TEST_PASSWORD, type Studio } from '../helpers/api';

/**
 * The three known issues in docs/user-guide-staff.md.
 *
 * Staff added on Staff & Guides were missing what the instructor made by
 * "Set up my studio" had: a location (so they were never offered for a One to
 * one), the studio's timezone (they defaulted to New York, and their hours with
 * them), and a link to their login (so My schedule was empty). None of it
 * errored; each one just made a person quietly unbookable or mistimed.
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
  resetRateLimits();
  studio = await signUpStudio(app, { timezone: 'Europe/London' });
});

async function addLocation(name: string) {
  const res = await request(app)
    .post(`${studio.base}/locations`)
    .set(studio.headers)
    .send({ name })
    .expect(201);
  return res.body.location.id as string;
}

function addStaff(body: Record<string, unknown> = {}) {
  return request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name: 'Rowan Pike', email: 'rowan@clay.test', ...body });
}

const locationsOf = async (staffId: string) =>
  (await prisma.staffLocation.findMany({ where: { staffId } }))
    .map((l) => l.locationId)
    .sort();

describe('where new staff work (known issue 1)', () => {
  it('places somebody new at every active location', async () => {
    const a = await addLocation('Front room');
    const b = await addLocation('Back room');

    const res = await addStaff().expect(201);

    expect(await locationsOf(res.body.staff.id)).toEqual([a, b].sort());
  });

  it('places them only where asked, when asked', async () => {
    const a = await addLocation('Front room');
    await addLocation('Back room');

    const res = await addStaff({ locationIds: [a] }).expect(201);

    expect(await locationsOf(res.body.staff.id)).toEqual([a]);
  });

  it("refuses somebody else's location", async () => {
    const other = await signUpStudio(app);
    const theirs = await request(app)
      .post(`${other.base}/locations`)
      .set(other.headers)
      .send({ name: 'Not yours' })
      .expect(201);

    const res = await addStaff({ locationIds: [theirs.body.location.id] });
    expect(res.status).toBe(400);
    expect(await prisma.staff.count({ where: { organizationId: studio.organizationId } })).toBe(0);
  });

  it('places staff added before the studio had a location, once it has one', async () => {
    const staff = await addStaff().expect(201);
    expect(await locationsOf(staff.body.staff.id)).toEqual([]);

    const room = await addLocation('The studio');

    expect(await locationsOf(staff.body.staff.id)).toEqual([room]);
  });

  it('does not add a second room to somebody already placed', async () => {
    const first = await addLocation('Front room');
    const staff = await addStaff().expect(201);

    await addLocation('Back room');

    expect(await locationsOf(staff.body.staff.id)).toEqual([first]);
  });
});

describe('the timezone new staff get (known issue 2)', () => {
  it("defaults to the studio's, not New York", async () => {
    const res = await addStaff().expect(201);
    expect(res.body.staff.timezone).toBe('Europe/London');
  });

  it('keeps a zone that was chosen', async () => {
    const res = await addStaff({ timezone: 'America/Denver' }).expect(201);
    expect(res.body.staff.timezone).toBe('America/Denver');
  });

  it('refuses a zone that does not exist', async () => {
    await addStaff({ timezone: 'Europe/Atlantis' }).expect(422);
  });

  it('moves their hours with them when it changes', async () => {
    const staff = await addStaff({ timezone: 'America/New_York' }).expect(201);
    const staffId = staff.body.staff.id as string;

    const rule = (timezone: string) =>
      prisma.availabilityRule.create({
        data: {
          organizationId: studio.organizationId,
          staffId,
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          startMinute: 600,
          endMinute: 1080,
          timezone,
          effectiveFrom: new Date(),
        },
      });
    const inherited = await rule('America/New_York');
    // Deliberately somewhere else — mobile work over a line. Must be kept.
    const deliberate = await rule('America/Chicago');

    await request(app)
      .patch(`${studio.base}/staff/${staffId}`)
      .set(studio.headers)
      .send({ timezone: 'Europe/London' })
      .expect(200);

    const after = await prisma.availabilityRule.findMany({ where: { staffId } });
    const zone = (id: string) => after.find((r) => r.id === id)!.timezone;

    expect(zone(inherited.id)).toBe('Europe/London');
    expect(zone(deliberate.id)).toBe('America/Chicago');
    // Same hours on the clock, which is the point.
    expect(after.find((r) => r.id === inherited.id)!.startMinute).toBe(600);
  });
});

describe('the login a staff record belongs to (known issue 3)', () => {
  const tokenFrom = (inviteUrl: string) =>
    decodeURIComponent(inviteUrl.split('/invite/')[1]!);

  async function inviteAndAccept(email: string) {
    const sent = await request(app)
      .post(`${studio.base}/invitations`)
      .set(studio.headers)
      .send({ email, name: 'Rowan Pike', role: 'INSTRUCTOR' })
      .expect(201);

    const accepted = await request(app)
      .post(`/api/auth/invitations/${tokenFrom(sent.body.inviteUrl)}/accept`)
      .send({ password: TEST_PASSWORD })
      .expect(201);

    return accepted.body as {
      user: { id: string };
      tokens: { accessToken: string };
    };
  }

  it('links the staff record when the invitation is accepted', async () => {
    const staff = await addStaff({ email: 'Rowan@Clay.test' }).expect(201);

    const accepted = await inviteAndAccept('rowan@clay.test');

    const after = await prisma.staff.findUniqueOrThrow({
      where: { id: staff.body.staff.id },
    });
    expect(after.userId).toBe(accepted.user.id);

    // And My schedule, which finds the record by login, now finds it.
    const list = await request(app)
      .get(`${studio.base}/staff`)
      .set({ Authorization: `Bearer ${accepted.tokens.accessToken}` })
      .expect(200);
    const mine = list.body.staff.find(
      (s: { userId: string | null }) => s.userId === accepted.user.id,
    );
    expect(mine?.id).toBe(staff.body.staff.id);
  });

  it('links a staff record added after they joined', async () => {
    const accepted = await inviteAndAccept('rowan@clay.test');

    const staff = await addStaff().expect(201);

    expect(staff.body.staff.userId).toBe(accepted.user.id);
  });

  it('does not link to an account that is not on this team', async () => {
    const outsider = await signUpStudio(app);

    const staff = await addStaff({ email: outsider.email }).expect(201);

    expect(staff.body.staff.userId).toBeNull();
  });
});

describe('the backfill migration', () => {
  /**
   * Runs the real migration file against records made the old way, so the SQL
   * that repairs existing studios is tested rather than trusted.
   */
  async function runBackfill() {
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260928120000_staff_links_backfill/migration.sql',
      ),
      'utf8',
    );
    const statements = sql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  }

  it('places the unplaced and links the unlinked, and nothing else', async () => {
    const room = await addLocation('The studio');
    const accepted = await (async () => {
      const sent = await request(app)
        .post(`${studio.base}/invitations`)
        .set(studio.headers)
        .send({ email: 'rowan@clay.test', name: 'Rowan', role: 'INSTRUCTOR' })
        .expect(201);
      return (
        await request(app)
          .post(
            `/api/auth/invitations/${decodeURIComponent(sent.body.inviteUrl.split('/invite/')[1])}/accept`,
          )
          .send({ password: TEST_PASSWORD })
          .expect(201)
      ).body as { user: { id: string } };
    })();

    // The old way: straight into the table, no location, no login.
    const broken = await prisma.staff.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Rowan',
        email: 'rowan@clay.test',
      },
    });
    // Somebody deliberately placed, and not on the team as a login.
    const placed = await prisma.staff.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Sam',
        email: 'sam@clay.test',
        staffLocations: { create: { locationId: room } },
      },
    });

    await runBackfill();
    // Twice, to prove it only ever adds what is missing.
    await runBackfill();

    const fixed = await prisma.staff.findUniqueOrThrow({ where: { id: broken.id } });
    expect(fixed.userId).toBe(accepted.user.id);
    expect(await locationsOf(broken.id)).toEqual([room]);

    const untouched = await prisma.staff.findUniqueOrThrow({ where: { id: placed.id } });
    expect(untouched.userId).toBeNull();
    expect(await locationsOf(placed.id)).toEqual([room]);
  });
});
