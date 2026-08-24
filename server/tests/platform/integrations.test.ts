import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';
import { grantPlatformAdmin } from '../../src/modules/platform/platform.service';

/**
 * S10 — a studio's integrations, from the operator's side.
 *
 * The read is deliberately the STUDIO'S OWN function rather than a second
 * query, so the two surfaces cannot drift. The test that pins that down is the
 * one comparing both responses for the same studio — without it, the shared
 * implementation is a convention that survives exactly until somebody adds a
 * field to one route.
 */

const app = createApp();

let admin: Studio;
let studio: Studio;
let staffId: string;

const REASON = 'their calendar sync is wedged on ticket #55';

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  admin = await signUpStudio(app, { organizationName: 'Artweel HQ' });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: admin.userId },
    select: { email: true },
  });
  await grantPlatformAdmin({ email: user.email });

  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });

  const staff = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name: 'Rowan Pike', email: 'rowan@clay.test' })
    .expect(201);
  staffId = staff.body.staff.id;
});

const platformPath = `/api/platform/organizations`;

describe('reading a studio integrations', () => {
  it('reports payments, calendars and messaging in one response', async () => {
    const res = await request(app)
      .get(`${platformPath}/${studio.organizationId}/integrations`)
      .set(admin.headers)
      .expect(200);

    expect(res.body.studio.name).toBe('Clay & Co');
    expect(res.body.payments.connected).toBe(false);
    expect(res.body.payments.provider).toBe('stripe');
    expect(res.body.sms).toHaveProperty('available');

    // Every active instructor, connected or not — the useful question is who
    // is still MISSING, not only who is wired up.
    expect(res.body.calendars).toHaveLength(1);
    expect(res.body.calendars[0]).toMatchObject({
      staffId,
      staffName: 'Rowan Pike',
      connected: false,
    });
  });

  /**
   * The assertion that keeps the shared implementation honest. If somebody
   * later adds a field to one route and not the other, an operator and an
   * owner start reading the same studio differently — which is worst exactly
   * when they are on the phone to each other about it.
   */
  it('says the same thing the studio own screen says', async () => {
    const asOperator = await request(app)
      .get(`${platformPath}/${studio.organizationId}/integrations`)
      .set(admin.headers)
      .expect(200);

    const asOwner = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    const { studio: _envelope, ...shared } = asOperator.body;
    expect(shared).toEqual(asOwner.body);
  });

  it('never leaks messaging credentials', async () => {
    const res = await request(app)
      .get(`${platformPath}/${studio.organizationId}/integrations`)
      .set(admin.headers)
      .expect(200);

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('AUTH_TOKEN');
    expect(serialised).not.toContain('accessToken');
    expect(serialised).not.toContain('refreshToken');
    // The boolean, and only the boolean.
    expect(typeof res.body.sms.available).toBe('boolean');
  });

  it('404s on a studio that does not exist', async () => {
    await request(app)
      .get(`${platformPath}/${crypto.randomUUID()}/integrations`)
      .set(admin.headers)
      .expect(404);
  });

  it('is invisible without the platform gate', async () => {
    await request(app)
      .get(`${platformPath}/${studio.organizationId}/integrations`)
      .set(studio.headers)
      .expect(404);
  });
});

describe('disconnecting a wedged calendar', () => {
  async function connectCalendar() {
    return prisma.calendarConnection.create({
      data: {
        organizationId: studio.organizationId,
        staffId,
        provider: 'google',
        accountEmail: 'rowan@gmail.test',
        status: 'NEEDS_REAUTH',
        accessTokenEnc: 'enc:not-a-real-token',
        refreshTokenEnc: 'enc:not-a-real-token',
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        // No channelId, so `disconnect` skips the Google stopWatch call —
        // this suite is about what happens in OUR database, not about
        // exercising the provider.
      },
    });
  }

  function disconnect(reason = REASON) {
    return request(app)
      .post(
        `${platformPath}/${studio.organizationId}/integrations/calendar/${staffId}/disconnect`,
      )
      .set(admin.headers)
      .send({ reason });
  }

  it('removes the connection and records why', async () => {
    await connectCalendar();

    const res = await disconnect().expect(200);
    expect(res.body.disconnected).toBe(true);

    const remaining = await prisma.calendarConnection.count({
      where: { staffId },
    });
    expect(remaining).toBe(0);

    const entry = await prisma.platformAuditLog.findFirstOrThrow({
      where: { action: 'integration.calendar.disconnect' },
    });
    expect(entry.organizationId).toBe(studio.organizationId);
    expect(entry.targetId).toBe(staffId);
    expect(entry.reason).toBe(REASON);
    // The state before the change, because "a calendar was disconnected" is
    // not useful six months later and "it was wedged in NEEDS_REAUTH" is.
    expect(entry.metadata).toMatchObject({ statusBefore: 'NEEDS_REAUTH' });
  });

  /**
   * Disconnecting must take the mirrored busy blocks with it. Leaving them
   * would keep the instructor permanently unavailable for times their calendar
   * no longer claims, with nothing left to ever clear them — which a studio
   * would report as "support broke my availability", correctly.
   */
  it('clears the busy blocks the calendar had mirrored in', async () => {
    await connectCalendar();

    await prisma.busyBlock.create({
      data: {
        organizationId: studio.organizationId,
        staffId,
        startsAt: new Date('2026-09-01T10:00:00Z'),
        endsAt: new Date('2026-09-01T11:00:00Z'),
        externalSource: 'google',
        externalId: 'evt-mirrored-from-their-calendar',
      },
    });

    await disconnect().expect(200);

    const blocks = await prisma.busyBlock.count({ where: { staffId } });
    expect(blocks).toBe(0);
  });

  it('is idempotent when there is nothing connected', async () => {
    const res = await disconnect().expect(200);

    expect(res.body.disconnected).toBe(false);
    expect(res.body.alreadyDisconnected).toBe(true);

    // And writes no audit row for something that did not happen.
    const entries = await prisma.platformAuditLog.count({
      where: { action: 'integration.calendar.disconnect' },
    });
    expect(entries).toBe(0);
  });

  it('refuses a reason nobody could act on', async () => {
    await connectCalendar();
    await disconnect('x').expect(422);
  });

  it('404s on an instructor from another studio', async () => {
    const other = await signUpStudio(app);
    const otherStaff = await request(app)
      .post(`${other.base}/staff`)
      .set(other.headers)
      .send({ name: 'Someone Else', email: 'else@other.test' })
      .expect(201);

    await request(app)
      .post(
        `${platformPath}/${studio.organizationId}/integrations/calendar/${otherStaff.body.staff.id}/disconnect`,
      )
      .set(admin.headers)
      .send({ reason: REASON })
      .expect(404);
  });

  it('is invisible without the platform gate', async () => {
    await connectCalendar();

    await request(app)
      .post(
        `${platformPath}/${studio.organizationId}/integrations/calendar/${staffId}/disconnect`,
      )
      .set(studio.headers)
      .send({ reason: REASON })
      .expect(404);
  });
});
