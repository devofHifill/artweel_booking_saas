import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';

/**
 * What this studio is plugged into.
 *
 * The states worth asserting are not "connected" — they are **connected but not
 * working**. A Stripe account that exists and cannot take charges, a calendar
 * whose token expired: both look fine everywhere else in the product, and both
 * silently break something a customer depends on. Those are the two this screen
 * exists to surface, so those are the two pinned here.
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
  studio = await signUpStudio(app);
});

async function addInstructor(name: string) {
  const res = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name, email: `${randomBytes(4).toString('hex')}@clay.test` })
    .expect(201);
  return res.body.staff.id as string;
}

describe('payments', () => {
  it('reports a studio that has never connected', async () => {
    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.payments).toMatchObject({
      connected: false,
      chargesEnabled: false,
    });
  });

  /**
   * The state the screen exists for.
   *
   * Stripe mirrors its own verdict through `account.updated`: an account can
   * exist, look connected, and still be unable to take a payment because Stripe
   * is waiting on identity documents. Nothing else in the product says so.
   */
  it('distinguishes connected from actually able to charge', async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: {
        stripeAccountId: `acct_${randomBytes(6).toString('hex')}`,
        stripeChargesEnabled: false,
        stripePayoutsEnabled: false,
      },
    });

    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.payments.connected).toBe(true);
    expect(res.body.payments.chargesEnabled).toBe(false);
  });

  /** The account id is not secret, but nothing below admin needs it. */
  it('never publishes the Stripe account id', async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { stripeAccountId: 'acct_secret_value' },
    });

    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    expect(JSON.stringify(res.body)).not.toContain('acct_secret_value');
  });
});

describe('calendars', () => {
  /**
   * Every active instructor, connected or not.
   *
   * Listing only the connected ones answers "which calendars sync" while hiding
   * the more useful question — whose outside commitments we cannot see, and
   * therefore who might get double-booked.
   */
  it('lists instructors with no calendar, not just connected ones', async () => {
    await addInstructor('Rowan Pike');
    await addInstructor('Sam Ortega');

    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.calendars).toHaveLength(2);
    expect(res.body.calendars.every((c: { connected: boolean }) => !c.connected)).toBe(
      true,
    );
  });

  it('surfaces a connection whose token has expired', async () => {
    const staffId = await addInstructor('Rowan Pike');

    await prisma.calendarConnection.create({
      data: {
        organizationId: studio.organizationId,
        staffId,
        accountEmail: 'rowan@gmail.test',
        accessTokenEnc: 'enc',
        refreshTokenEnc: 'enc',
        status: 'NEEDS_REAUTH',
      },
    });

    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    const row = res.body.calendars[0];
    expect(row.connected).toBe(true);
    expect(row.status).toBe('NEEDS_REAUTH');
    expect(row.accountEmail).toBe('rowan@gmail.test');
  });

  /** Encrypted tokens must never leave the server, in any shape. */
  it('never publishes calendar credentials', async () => {
    const staffId = await addInstructor('Rowan Pike');
    await prisma.calendarConnection.create({
      data: {
        organizationId: studio.organizationId,
        staffId,
        accessTokenEnc: 'super-secret-access',
        refreshTokenEnc: 'super-secret-refresh',
        status: 'ACTIVE',
      },
    });

    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('super-secret-access');
    expect(body).not.toContain('super-secret-refresh');
  });

  it('leaves deactivated instructors out', async () => {
    const staffId = await addInstructor('Retired Person');
    await prisma.staff.update({
      where: { id: staffId },
      data: { isActive: false },
    });

    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.calendars).toHaveLength(0);
  });
});

describe('text messages', () => {
  it('reports whether SMS can be sent at all, and the quiet window', async () => {
    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    expect(typeof res.body.sms.available).toBe('boolean');
    /*
      `sendingWindow`, because these two numbers are the hours in which a text
      MAY be sent — the quiet hours are the gap between them. Named
      `quietHours` (which is what the config calls them), one of the two
      screens reading it described the rule backwards.
    */
    expect(res.body.sms.sendingWindow).toMatchObject({
      fromHour: expect.any(Number),
      toHour: expect.any(Number),
    });
    expect(res.body.sms.quietHours).toBeUndefined();
  });

  it('counts customers who replied STOP', async () => {
    await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Opted Out',
        email: `out-${randomBytes(3).toString('hex')}@example.test`,
        smsOptedOutAt: new Date(),
      },
    });
    await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Still Subscribed',
        email: `in-${randomBytes(3).toString('hex')}@example.test`,
      },
    });

    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.sms.optedOutCustomers).toBe(1);
  });
});

describe('who may see it', () => {
  it('is open to any member — it explains why something is not working', async () => {
    const desk = await addMemberToStudio(app, studio.organizationId, 'FRONT_DESK');

    await request(app)
      .get(`${studio.base}/integrations`)
      .set(desk.headers)
      .expect(200);
  });

  it('hides another studio entirely', async () => {
    const stranger = await signUpStudio(app);

    await request(app)
      .get(`${studio.base}/integrations`)
      .set(stranger.headers)
      .expect(404);
  });

  it('never mixes another studio into the counts', async () => {
    const other = await signUpStudio(app);
    await prisma.customer.create({
      data: {
        organizationId: other.organizationId,
        name: 'Their Customer',
        email: `theirs-${randomBytes(3).toString('hex')}@example.test`,
        smsOptedOutAt: new Date(),
      },
    });

    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.sms.optedOutCustomers).toBe(0);
    expect(res.body.calendars).toHaveLength(0);
  });
});

describe('whether a calendar is still working', () => {
  /**
   * "Connected" and "still hearing about changes" are different facts, and
   * they only diverge when something is wrong — which is when this page gets
   * read. `updatedAt` moves on any write at all, so it cannot answer the
   * second question.
   */
  it('reports when it last actually synced, not when the row last changed', async () => {
    const staffId = await addInstructor('Rowan Pike');
    const lastSyncedAt = new Date('2026-08-20T09:00:00.000Z');

    await prisma.calendarConnection.create({
      data: {
        organizationId: studio.organizationId,
        staffId,
        accountEmail: 'rowan@gmail.test',
        accessTokenEnc: 'enc',
        refreshTokenEnc: 'enc',
        lastSyncedAt,
      },
    });

    // A later write that is not a sync — a token refresh looks exactly like this.
    await prisma.calendarConnection.update({
      where: { staffId },
      data: { accessTokenEnc: 'enc2' },
    });

    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    const row = res.body.calendars[0];
    expect(new Date(row.lastSyncedAt).toISOString()).toBe(lastSyncedAt.toISOString());
    expect(new Date(row.lastChangedAt).getTime()).toBeGreaterThan(
      lastSyncedAt.getTime(),
    );
  });

  /**
   * Google expires a push channel after about a week and inbound sync then
   * stops without failing: availability keeps being offered from stale data.
   * The field was already being selected by the status service and dropped
   * before it reached anybody.
   */
  it('reports when the push channel lapses', async () => {
    const staffId = await addInstructor('Rowan Pike');
    const channelExpiresAt = new Date('2026-09-01T00:00:00.000Z');

    await prisma.calendarConnection.create({
      data: {
        organizationId: studio.organizationId,
        staffId,
        accountEmail: 'rowan@gmail.test',
        accessTokenEnc: 'enc',
        refreshTokenEnc: 'enc',
        channelExpiresAt,
      },
    });

    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    expect(new Date(res.body.calendars[0].pushExpiresAt).toISOString()).toBe(
      channelExpiresAt.toISOString(),
    );
  });

  it('carries the last error, which is why it stopped', async () => {
    const staffId = await addInstructor('Rowan Pike');

    await prisma.calendarConnection.create({
      data: {
        organizationId: studio.organizationId,
        staffId,
        accountEmail: 'rowan@gmail.test',
        accessTokenEnc: 'enc',
        refreshTokenEnc: 'enc',
        status: 'NEEDS_REAUTH',
        lastError: 'invalid_grant',
      },
    });

    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.calendars[0].lastError).toBe('invalid_grant');
  });

  it('says nothing about either for an instructor with no calendar', async () => {
    await addInstructor('Sam Ortega');

    const res = await request(app)
      .get(`${studio.base}/integrations`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.calendars[0]).toMatchObject({
      connected: false,
      lastSyncedAt: null,
      lastError: null,
      pushExpiresAt: null,
    });
  });
});
