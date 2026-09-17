import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio } from '../helpers/api';
import {
  grantPlatformAdmin,
  listPlatformAdmins,
  revokePlatformAdmin,
} from '../../src/modules/platform/platform.service';

/**
 * S1 — the platform gate.
 *
 * The gate's job is not only to keep people out; it is to keep them from
 * learning there is anything to be kept out of. So the assertions come in pairs:
 * the admin gets through, and everyone else gets a response that is
 * indistinguishable from a path this app does not serve.
 */

const app = createApp();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

const CONTROL_PATH = '/api/definitely-not-a-route/here';

/**
 * Asserts a response is exactly what this app says about a path it does not
 * serve.
 *
 * Note what is NOT asserted: byte-equality with another path's 404. The real
 * handler echoes the URL back (`Route not found: GET /api/platform/me`), so two
 * different paths necessarily produce two different strings, and demanding they
 * match is a test that can never pass. What must match is the status, the code
 * and the TEMPLATE — because an attacker diffing the two responses then learns
 * only the path they themselves sent.
 *
 * The control response is measured rather than assumed, so a change to the
 * not-found format fails this test instead of silently opening the oracle.
 */
async function expectIndistinguishableFromMissing(
  res: { status: number; body: { error?: { code: unknown; message: unknown } } },
  method: string,
  path: string,
) {
  const control = await request(app).get(CONTROL_PATH);

  expect(res.status).toBe(404);
  expect(res.status).toBe(control.status);
  expect(res.body.error?.code).toBe(control.body.error?.code);

  expect(control.body.error?.message).toBe(`Route not found: GET ${CONTROL_PATH}`);
  expect(res.body.error?.message).toBe(`Route not found: ${method} ${path}`);
}

describe('who gets through', () => {
  it('admits a user holding a live grant', async () => {
    const studio = await signUpStudio(app);
    await grantPlatformAdmin({
      email: (await prisma.user.findUniqueOrThrow({
        where: { id: studio.userId },
        select: { email: true },
      })).email,
      note: 'test grant',
    });

    const res = await request(app)
      .get('/api/platform/me')
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.body.platformAdmin.userId).toBe(studio.userId);
    expect(res.body.platformAdmin.note).toBe('test grant');
  });
});

describe('who does not, and cannot tell why', () => {
  it('answers an ordinary studio owner exactly like a missing route', async () => {
    const studio = await signUpStudio(app);

    const gated = await request(app).get('/api/platform/me').set(studio.headers);

    await expectIndistinguishableFromMissing(gated, 'GET', '/api/platform/me');
  });

  /**
   * An unauthenticated probe must not get a 401. A 401 is an answer: it says the
   * route is real and wants credentials, which is the single fact this surface
   * exists to withhold. This is why the router uses `authenticateOptional`.
   */
  it('answers an unauthenticated probe exactly like a missing route', async () => {
    const gated = await request(app).get('/api/platform/me');

    await expectIndistinguishableFromMissing(gated, 'GET', '/api/platform/me');
  });

  it('answers a garbage token exactly like a missing route', async () => {
    const gated = await request(app)
      .get('/api/platform/me')
      .set({ Authorization: 'Bearer not-a-real-token' });

    await expectIndistinguishableFromMissing(gated, 'GET', '/api/platform/me');
  });

  it('shuts out an admin whose grant has been revoked', async () => {
    const studio = await signUpStudio(app);
    const { email } = await prisma.user.findUniqueOrThrow({
      where: { id: studio.userId },
      select: { email: true },
    });

    await grantPlatformAdmin({ email });
    const allowed = await request(app)
      .get('/api/platform/me')
      .set(studio.headers);
    expect(allowed.status).toBe(200);

    await revokePlatformAdmin(email);

    const refused = await request(app)
      .get('/api/platform/me')
      .set(studio.headers);
    expect(refused.status).toBe(404);
  });

  /**
   * The grant is checked against the database per request, not read from the
   * token, so revocation must take effect on the very next call rather than when
   * the access token happens to expire. Same token throughout, deliberately.
   */
  it('does not let an already-issued token outlive its grant', async () => {
    const studio = await signUpStudio(app);
    const { email } = await prisma.user.findUniqueOrThrow({
      where: { id: studio.userId },
      select: { email: true },
    });

    await grantPlatformAdmin({ email });
    await revokePlatformAdmin(email);

    const res = await request(app).get('/api/platform/me').set(studio.headers);
    expect(res.status).toBe(404);
  });
});

describe('granting', () => {
  it('refuses to grant to an address with no account', async () => {
    await expect(
      grantPlatformAdmin({ email: 'nobody@nowhere.test' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });
  });

  it('is idempotent — granting twice does not create a second live grant', async () => {
    const studio = await signUpStudio(app);
    const { email } = await prisma.user.findUniqueOrThrow({
      where: { id: studio.userId },
      select: { email: true },
    });

    const first = await grantPlatformAdmin({ email });
    const second = await grantPlatformAdmin({ email });

    expect(second.alreadyHad).toBe(true);
    expect(second.grant.id).toBe(first.grant.id);
    expect(await listPlatformAdmins()).toHaveLength(1);
  });

  /**
   * The partial unique index is the thing being tested, not Prisma. Two live
   * grants for one user must be impossible even for a caller that goes straight
   * to the table — which is exactly what a plain UNIQUE on (user_id, revoked_at)
   * would have permitted, since Postgres treats those NULLs as distinct.
   */
  it('cannot be given two live grants even by a direct write', async () => {
    const studio = await signUpStudio(app);
    const { email } = await prisma.user.findUniqueOrThrow({
      where: { id: studio.userId },
      select: { email: true },
    });
    await grantPlatformAdmin({ email });

    await expect(
      prisma.platformAdmin.create({ data: { userId: studio.userId } }),
    ).rejects.toThrow();
  });

  /**
   * Revoking must free the user to be granted again later. That is the whole
   * reason the index is partial rather than a plain unique on user_id.
   */
  it('allows a fresh grant after a revocation, keeping the old row', async () => {
    const studio = await signUpStudio(app);
    const { email } = await prisma.user.findUniqueOrThrow({
      where: { id: studio.userId },
      select: { email: true },
    });

    const first = await grantPlatformAdmin({ email });
    await revokePlatformAdmin(email);
    const second = await grantPlatformAdmin({ email });

    expect(second.grant.id).not.toBe(first.grant.id);

    const all = await prisma.platformAdmin.findMany({
      where: { userId: studio.userId },
    });
    expect(all).toHaveLength(2);
    expect(all.filter((row) => row.revokedAt === null)).toHaveLength(1);
  });

  it('revoking someone who never had it is a no-op, not an error', async () => {
    const studio = await signUpStudio(app);
    const { email } = await prisma.user.findUniqueOrThrow({
      where: { id: studio.userId },
      select: { email: true },
    });

    const result = await revokePlatformAdmin(email);
    expect(result.revoked).toBe(0);
  });
});

describe('the platform surface is outside tenant scoping', () => {
  /**
   * A platform admin's authority must not silently become studio authority. The
   * grant says nothing about membership, so the ordinary 404-for-non-members
   * rule still applies to another studio's data — the way in is a support
   * session (S7), not this.
   */
  it('does not give an admin access to a studio they do not belong to', async () => {
    const admin = await signUpStudio(app);
    const other = await signUpStudio(app);

    const { email } = await prisma.user.findUniqueOrThrow({
      where: { id: admin.userId },
      select: { email: true },
    });
    await grantPlatformAdmin({ email });

    const res = await request(app)
      .get(`/api/organizations/${other.organizationId}`)
      .set(admin.headers);

    expect(res.status).toBe(404);
  });
});
