import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { AppError } from '../../lib/app-error';
import { logger } from '../../lib/logger';

/**
 * Token strategy.
 *
 *   ACCESS  — a short-lived JWT. Stateless, so it cannot be revoked; that is
 *             why it expires in minutes rather than days.
 *   REFRESH — 32 random bytes, stored hashed, rotated on every single use.
 *
 * Rotation plus family tracking is what turns a stolen refresh token from a
 * permanent backdoor into a detectable, self-limiting incident.
 */

export type AccessTokenPayload = {
  sub: string;
  email: string;
};

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function signAccessToken(user: { id: string; email: string }): {
  token: string;
  expiresAt: Date;
} {
  const expiresAt = new Date(
    Date.now() + config.ACCESS_TOKEN_TTL_MINUTES * 60_000,
  );

  const token = jwt.sign(
    { sub: user.id, email: user.email } satisfies AccessTokenPayload,
    config.JWT_ACCESS_SECRET,
    {
      expiresIn: `${config.ACCESS_TOKEN_TTL_MINUTES}m`,
      issuer: 'booking-saas',
      audience: 'booking-saas-api',
    },
  );

  return { token, expiresAt };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      issuer: 'booking-saas',
      audience: 'booking-saas-api',
      // Explicit: without it, a token with alg "none" would be accepted.
      algorithms: ['HS256'],
    });

    if (typeof decoded === 'string' || !decoded.sub) {
      throw AppError.unauthorized('Invalid token.', 'INVALID_TOKEN');
    }

    return { sub: String(decoded.sub), email: String(decoded.email ?? '') };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized('Access token expired.', 'TOKEN_EXPIRED');
    }
    throw AppError.unauthorized('Invalid token.', 'INVALID_TOKEN');
  }
}

/** Issues a refresh token, optionally continuing an existing rotation family. */
export async function issueRefreshToken(
  userId: string,
  opts?: { familyId?: string; userAgent?: string; ip?: string },
) {
  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(
    Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60_000,
  );

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      familyId: opts?.familyId ?? randomUUID(),
      expiresAt,
      userAgent: opts?.userAgent,
      ip: opts?.ip,
    },
  });

  return { token: raw, expiresAt };
}

export async function issueTokenPair(
  user: { id: string; email: string },
  context?: { userAgent?: string; ip?: string },
): Promise<IssuedTokens> {
  const access = signAccessToken(user);
  const refresh = await issueRefreshToken(user.id, context);

  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    accessExpiresAt: access.expiresAt,
    refreshExpiresAt: refresh.expiresAt,
  };
}

/**
 * Rotates a refresh token.
 *
 * The reuse branch is the important one. A token that has already been
 * rotated away being presented again means one of two things: the legitimate
 * client replayed it, or somebody stole it. We cannot distinguish those, so
 * we assume the worse and revoke the WHOLE FAMILY — every descendant session
 * from that lineage. The real user logs in again; the attacker gets nothing.
 */
export async function rotateRefreshToken(
  rawToken: string,
  context?: { userAgent?: string; ip?: string },
): Promise<IssuedTokens> {
  const tokenHash = sha256(rawToken);

  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!existing) {
    throw AppError.unauthorized('Invalid refresh token.', 'INVALID_REFRESH');
  }

  if (existing.revokedAt) {
    logger.warn(
      { userId: existing.userId, familyId: existing.familyId },
      'Refresh token reuse detected — revoking family',
    );

    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    throw AppError.unauthorized(
      'Session is no longer valid. Please sign in again.',
      'REFRESH_REUSED',
    );
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw AppError.unauthorized('Refresh token expired.', 'REFRESH_EXPIRED');
  }

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });

  const access = signAccessToken(existing.user);
  const refresh = await issueRefreshToken(existing.userId, {
    familyId: existing.familyId,
    userAgent: context?.userAgent,
    ip: context?.ip,
  });

  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    accessExpiresAt: access.expiresAt,
    refreshExpiresAt: refresh.expiresAt,
  };
}

/** Logout. Idempotent — an unknown or already-revoked token is not an error. */
export async function revokeRefreshToken(rawToken: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Logout everywhere. Used on password reset, and available to the user. */
export async function revokeAllUserTokens(userId: string) {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Single-use verification tokens
// ---------------------------------------------------------------------------

export async function issueVerificationToken(
  userId: string,
  purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET',
) {
  const raw = randomBytes(32).toString('base64url');

  const ttlMs =
    purpose === 'EMAIL_VERIFY'
      ? config.EMAIL_VERIFY_TTL_HOURS * 60 * 60_000
      : config.PASSWORD_RESET_TTL_MINUTES * 60_000;

  // Only one live token per purpose: requesting a new reset link must
  // invalidate the previous one.
  await prisma.verificationToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.verificationToken.create({
    data: {
      userId,
      purpose,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });

  return raw;
}

export async function consumeVerificationToken(
  rawToken: string,
  purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET',
): Promise<string> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
  });

  if (!record || record.purpose !== purpose) {
    throw AppError.badRequest('Invalid or expired link.', 'INVALID_TOKEN');
  }
  if (record.usedAt) {
    throw AppError.badRequest('This link has already been used.', 'TOKEN_USED');
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw AppError.badRequest('This link has expired.', 'TOKEN_EXPIRED');
  }

  await prisma.verificationToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return record.userId;
}
