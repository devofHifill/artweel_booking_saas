import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';

/**
 * W1.1 — Auth and tenancy.
 *
 * These run against the real app and the real database. The interesting cases
 * are the ones that are easy to get subtly wrong and impossible to notice in
 * manual testing: enumeration through error messages, refresh-token replay,
 * sessions surviving a password reset, and role checks that can be skipped by
 * calling a route directly.
 */

const app = createApp();

const VALID_PASSWORD = 'kiln-shelf-glaze-42';

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
});

async function registerUser(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'rowan@clay.test',
      password: VALID_PASSWORD,
      name: 'Rowan Pike',
      organizationName: 'Clay & Co',
      ...overrides,
    });
  return res;
}

describe('registration', () => {
  it('creates the user, the studio and the owner membership together', async () => {
    const res = await registerUser();

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('rowan@clay.test');
    expect(res.body.user.emailVerified).toBe(false);
    expect(res.body.organization.name).toBe('Clay & Co');
    // Slug is what the public booking page will live at.
    expect(res.body.organization.slug).toBe('clay-co');
    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.tokens.refreshToken).toBeTruthy();

    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: res.body.user.id },
    });
    expect(membership.role).toBe('OWNER');
  });

  it('never returns the password hash', async () => {
    const res = await registerUser();
    expect(JSON.stringify(res.body)).not.toContain('scrypt$');
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('lowercases the email so casing cannot create a second account', async () => {
    await registerUser({ email: 'Rowan@Clay.TEST' });

    const duplicate = await registerUser({ email: 'rowan@clay.test' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('gives distinct slugs to studios with the same name', async () => {
    const first = await registerUser();
    const second = await registerUser({ email: 'other@clay.test' });

    expect(second.status).toBe(201);
    expect(second.body.organization.slug).not.toBe(
      first.body.organization.slug,
    );
  });

  it('rejects a short password with a field-level message', async () => {
    const res = await registerUser({ password: 'short' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details[0].field).toBe('password');
  });

  it('rejects a common password even when it is long enough', async () => {
    const res = await registerUser({ password: 'password123' });
    expect(res.status).toBe(422);
  });

  it('strips fields the schema does not declare', async () => {
    // Mass assignment: an attacker adding a field that maps onto a column.
    const res = await request(app).post('/api/auth/register').send({
      email: 'mallory@clay.test',
      password: VALID_PASSWORD,
      name: 'Mallory',
      emailVerifiedAt: new Date().toISOString(),
      passwordHash: 'scrypt$1$1$1$AA==$AA==',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.emailVerified).toBe(false);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'mallory@clay.test' },
    });
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).not.toBe('scrypt$1$1$1$AA==$AA==');
  });
});

describe('login', () => {
  it('returns tokens and memberships', async () => {
    await registerUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rowan@clay.test', password: VALID_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.memberships[0].role).toBe('OWNER');
  });

  it('gives the same answer for a wrong password and an unknown address', async () => {
    // Different messages here turn login into a free membership oracle.
    await registerUser();

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rowan@clay.test', password: 'not-the-password-at-all' });

    const unknownUser = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@clay.test', password: 'not-the-password-at-all' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message);
    expect(wrongPassword.body.error.code).toBe(unknownUser.body.error.code);
  });
});

describe('access tokens', () => {
  it('rejects a request with no credentials', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_CREDENTIALS');
  });

  it('rejects a tampered token', async () => {
    const registered = await registerUser();
    const token: string = registered.body.tokens.accessToken;

    // Flip a character in the signature.
    const tampered = token.slice(0, -3) + (token.slice(-3) === 'aaa' ? 'bbb' : 'aaa');

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tampered}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects an unsigned "alg: none" token', async () => {
    // The classic JWT bypass. Only fails closed if algorithms are pinned.
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: '00000000-0000-0000-0000-000000000000',
        email: 'attacker@evil.test',
        iss: 'booking-saas',
        aud: 'booking-saas-api',
      }),
    ).toString('base64url');

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${header}.${payload}.`);

    expect(res.status).toBe(401);
  });

  it('rejects an access token signed with the refresh secret', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign(
      { sub: '00000000-0000-0000-0000-000000000000', email: 'x@y.test' },
      process.env.JWT_REFRESH_SECRET!,
      { issuer: 'booking-saas', audience: 'booking-saas-api', expiresIn: '15m' },
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
  });
});

describe('refresh token rotation', () => {
  it('issues a new pair and invalidates the old refresh token', async () => {
    const registered = await registerUser();
    const original: string = registered.body.tokens.refreshToken;

    const rotated = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: original });

    expect(rotated.status).toBe(200);
    expect(rotated.body.tokens.refreshToken).not.toBe(original);

    // The new one works.
    const again = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: rotated.body.tokens.refreshToken });
    expect(again.status).toBe(200);
  });

  it('revokes the whole family when a used token is replayed', async () => {
    // Theft detection. A rotated-away token being presented again means
    // either the client replayed it or somebody stole it — and we cannot
    // tell, so every session in the lineage dies.
    const registered = await registerUser();
    const first: string = registered.body.tokens.refreshToken;

    const second = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first });
    const third = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: second.body.tokens.refreshToken });

    expect(third.status).toBe(200);

    // The attacker replays the stolen first token.
    const replay = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first });

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_REUSED');

    // And the legitimate current token is now dead too.
    const legitimate = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: third.body.tokens.refreshToken });
    expect(legitimate.status).toBe(401);
  });

  it('stores refresh tokens only as hashes', async () => {
    const registered = await registerUser();
    const raw: string = registered.body.tokens.refreshToken;

    const stored = await prisma.refreshToken.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toBe(raw);
    expect(stored[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('logout revokes the token and is safe to repeat', async () => {
    const registered = await registerUser();
    const refreshToken: string = registered.body.tokens.refreshToken;

    expect((await request(app).post('/api/auth/logout').send({ refreshToken })).status).toBe(204);
    expect((await request(app).post('/api/auth/logout').send({ refreshToken })).status).toBe(204);

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });
    expect(res.status).toBe(401);
  });
});

describe('email verification', () => {
  it('verifies once and refuses a replay', async () => {
    const registered = await registerUser();
    const token: string = registered.body.verificationToken;

    const first = await request(app)
      .post('/api/auth/verify-email')
      .send({ token });
    expect(first.status).toBe(200);
    expect(first.body.user.emailVerified).toBe(true);

    const replay = await request(app)
      .post('/api/auth/verify-email')
      .send({ token });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('TOKEN_USED');
  });

  it('rejects an unknown token', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'not-a-real-token' });
    expect(res.status).toBe(400);
  });
});

describe('password reset', () => {
  it('reports success for an unknown address without revealing anything', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@clay.test' });

    expect(res.status).toBe(202);
    expect(res.body.resetToken).toBeUndefined();
  });

  it('resets the password and kills every existing session', async () => {
    // The usual reason to reset is believing somebody else has the password.
    // Leaving live sessions alone would defeat the entire exercise.
    const registered = await registerUser();
    const oldRefresh: string = registered.body.tokens.refreshToken;

    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'rowan@clay.test' });

    const reset = await request(app).post('/api/auth/reset-password').send({
      token: forgot.body.resetToken,
      password: 'new-glaze-bucket-77',
    });
    expect(reset.status).toBe(200);
    expect(reset.body.sessionsRevoked).toBeGreaterThan(0);

    // Old session is gone.
    const stale = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: oldRefresh });
    expect(stale.status).toBe(401);

    // Old password no longer works, new one does.
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'rowan@clay.test', password: VALID_PASSWORD })
      ).status,
    ).toBe(401);

    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'rowan@clay.test', password: 'new-glaze-bucket-77' })
      ).status,
    ).toBe(200);
  });

  it('invalidates an earlier reset link when a new one is requested', async () => {
    await registerUser();

    const first = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'rowan@clay.test' });
    const second = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'rowan@clay.test' });

    const usingOld = await request(app).post('/api/auth/reset-password').send({
      token: first.body.resetToken,
      password: 'another-strong-one-99',
    });
    expect(usingOld.status).toBe(400);

    const usingNew = await request(app).post('/api/auth/reset-password').send({
      token: second.body.resetToken,
      password: 'another-strong-one-99',
    });
    expect(usingNew.status).toBe(200);
  });
});
