import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, TEST_PASSWORD, type Studio } from '../helpers/api';
import { grantPlatformAdmin } from '../../src/modules/platform/platform.service';

/**
 * S8 — the global users list, and disabling an account.
 *
 * Two things carry the weight here, and neither is the list.
 *
 * The first is that disabling REVOKES REFRESH TOKENS. Setting a column and
 * stopping there leaves the account working for thirty days, because a refresh
 * token renews itself and nothing consults the column. That failure is
 * invisible to a test that only checks login.
 *
 * The second is that a disabled account is refused AFTER the password check, so
 * this endpoint does not become an oracle for which addresses have been
 * disabled.
 */

const app = createApp();

let admin: Studio;
let victim: Studio;
let victimEmail: string;

const REASON = 'chargeback fraud on ticket #91';

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

  victim = await signUpStudio(app, { organizationName: 'Clay & Co' });
  victimEmail = (
    await prisma.user.findUniqueOrThrow({
      where: { id: victim.userId },
      select: { email: true },
    })
  ).email;
});

function setDisabled(userId: string, disabled: boolean, reason = REASON) {
  return request(app)
    .post(`/api/platform/users/${userId}/disabled`)
    .set(admin.headers)
    .send({ disabled, reason });
}

describe('the list', () => {
  it('reads across every tenant, with the studios each person belongs to', async () => {
    const res = await request(app)
      .get('/api/platform/users')
      .set(admin.headers)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(2);

    const found = res.body.users.find(
      (u: { email: string }) => u.email === victimEmail,
    );
    expect(found.studios[0].name).toBe('Clay & Co');
    expect(found.studios[0].role).toBe('OWNER');
    expect(found.disabled).toBe(false);
  });

  /**
   * `passwordHash` lives on this model. An `include` where a `select` belongs
   * would put every studio owner's hash on an operator dashboard, and it is one
   * careless edit away at all times.
   */
  it('never returns a password hash', async () => {
    const res = await request(app)
      .get('/api/platform/users')
      .set(admin.headers)
      .expect(200);

    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('scrypt');
  });

  it('finds somebody by email or name', async () => {
    const res = await request(app)
      .get(`/api/platform/users?search=${encodeURIComponent(victimEmail)}`)
      .set(admin.headers)
      .expect(200);

    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].email).toBe(victimEmail);
  });

  it('filters to disabled accounts', async () => {
    await setDisabled(victim.userId, true).expect(200);

    const res = await request(app)
      .get('/api/platform/users?status=disabled')
      .set(admin.headers)
      .expect(200);

    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].email).toBe(victimEmail);
  });

  it('is invisible without the platform gate', async () => {
    await request(app)
      .get('/api/platform/users')
      .set(victim.headers)
      .expect(404);
  });
});

describe('disabling an account', () => {
  it('stops the next login', async () => {
    await setDisabled(victim.userId, true).expect(200);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: victimEmail, password: TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  /**
   * HALF THE FEATURE. Without revocation the account keeps working for the
   * refresh token's full thirty days, renewing itself silently — and a test
   * that only checks login would report this as working.
   */
  it('revokes every live refresh token, so an open session cannot renew', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: victimEmail, password: TEST_PASSWORD })
      .expect(200);

    const refreshToken = login.body.tokens.refreshToken;

    // Works before.
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    const secondLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: victimEmail, password: TEST_PASSWORD })
      .expect(200);

    const res = await setDisabled(victim.userId, true).expect(200);
    expect(res.body.tokensRevoked).toBeGreaterThan(0);

    // And not after.
    const after = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: secondLogin.body.tokens.refreshToken });

    expect(after.status).toBeGreaterThanOrEqual(400);
    expect(after.body.tokens).toBeUndefined();
  });

  /**
   * The endpoint must not tell an attacker which addresses have been disabled.
   * A wrong password answers the same on a disabled account as on a live one,
   * because the disabled check runs after the comparison.
   */
  it('does not become an oracle for which accounts are disabled', async () => {
    await setDisabled(victim.userId, true).expect(200);

    const disabledWrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: victimEmail, password: 'not-the-password' });

    const unknownAddress = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody-at-all@clay.test', password: 'not-the-password' });

    expect(disabledWrongPassword.status).toBe(unknownAddress.status);
    expect(disabledWrongPassword.body.error.code).toBe(
      unknownAddress.body.error.code,
    );
    expect(disabledWrongPassword.body.error.message).toBe(
      unknownAddress.body.error.message,
    );
  });

  it('re-enables, and login works again', async () => {
    await setDisabled(victim.userId, true).expect(200);
    await setDisabled(victim.userId, false, 'resolved — not their card').expect(
      200,
    );

    await request(app)
      .post('/api/auth/login')
      .send({ email: victimEmail, password: TEST_PASSWORD })
      .expect(200);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: victim.userId },
      select: { disabledAt: true, disabledReason: true },
    });
    // The reason is cleared with the state — a stale "chargeback fraud" sitting
    // on a live account is worse than no reason at all.
    expect(row.disabledAt).toBeNull();
    expect(row.disabledReason).toBeNull();
  });

  it('is idempotent, and says so', async () => {
    const first = await setDisabled(victim.userId, true).expect(200);
    expect(first.body.changed).toBe(true);

    const second = await setDisabled(victim.userId, true).expect(200);
    expect(second.body.changed).toBe(false);
  });

  it('records who, what and why', async () => {
    await setDisabled(victim.userId, true).expect(200);

    const entry = await prisma.platformAuditLog.findFirstOrThrow({
      where: { action: 'user.disable' },
    });
    expect(entry.actorUserId).toBe(admin.userId);
    expect(entry.targetId).toBe(victim.userId);
    expect(entry.reason).toBe(REASON);
  });

  it('refuses a reason nobody could act on', async () => {
    await setDisabled(victim.userId, true, 'x').expect(422);
  });

  /**
   * The one move that cannot be undone from where the operator is standing:
   * every route that could re-enable the account is behind the platform gate,
   * and the gate needs a session they would have just revoked.
   */
  it('refuses to let an operator disable themselves', async () => {
    const res = await setDisabled(admin.userId, true);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_DISABLE_SELF');

    // And they can still sign in.
    const email = (
      await prisma.user.findUniqueOrThrow({
        where: { id: admin.userId },
        select: { email: true },
      })
    ).email;

    await request(app)
      .post('/api/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
  });

  it('404s on a user id that is not a uuid', async () => {
    await request(app)
      .post('/api/platform/users/not-a-uuid/disabled')
      .set(admin.headers)
      .send({ disabled: true, reason: REASON })
      .expect(404);
  });
});
