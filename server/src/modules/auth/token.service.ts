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

    /**
     * A support token is not an access token and must never be mistaken for
     * one here.
     *
     * They are signed with the same secret and the same audience, so without
     * this check a support token would sail through as an ordinary session for
     * whoever `sub` names — which for a support token is a synthetic
     * `support:<orgId>` string, not a user at all. Callers that want one ask
     * for it by name, through `verifySupportToken`.
     */
    if ((decoded as { scope?: string }).scope === SUPPORT_SCOPE) {
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

// ---------------------------------------------------------------------------
// Support session tokens (S7)
// ---------------------------------------------------------------------------

export const SUPPORT_SCOPE = 'support';

/**
 * What a support token carries, in the RFC 8693 actor-claim shape.
 *
 *   sub  the STUDIO context — `support:<organizationId>`. Synthetic on
 *        purpose: there is no studio user being impersonated, and borrowing a
 *        real one would put a member's id on actions they did not take.
 *   act  the actor — the real human at the keyboard. RFC 8693 §4.1 exists for
 *        exactly this: "delegation has occurred, and here is who is driving".
 *
 * The split is what keeps the audit trail honest. `authenticate` resolves
 * `req.auth` from `act`, never from `sub`, so every downstream writer records
 * the operator rather than the studio — while `withOrganization` reads the
 * studio from `sub`. Collapsing the two into one claim is what would lose the
 * human, which is the one thing this must not do.
 *
 * NO REFRESH TOKEN IS ISSUED with this, anywhere. The expiry is a wall, not an
 * opening position — a session that can renew itself is a permanent grant with
 * extra steps.
 */
export type SupportTokenPayload = {
  sub: string;
  scope: typeof SUPPORT_SCOPE;
  /** Support session row id. Ties every action back to one reason. */
  sid: string;
  organizationId: string;
  readOnly: boolean;
  act: { sub: string; email: string };
};

export function signSupportToken(input: {
  sessionId: string;
  organizationId: string;
  readOnly: boolean;
  actor: { id: string; email: string };
  ttlMinutes: number;
}): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000);

  const token = jwt.sign(
    {
      sub: `${SUPPORT_SCOPE}:${input.organizationId}`,
      scope: SUPPORT_SCOPE,
      sid: input.sessionId,
      organizationId: input.organizationId,
      readOnly: input.readOnly,
      act: { sub: input.actor.id, email: input.actor.email },
    } satisfies SupportTokenPayload,
    config.JWT_ACCESS_SECRET,
    {
      expiresIn: `${input.ttlMinutes}m`,
      issuer: 'booking-saas',
      audience: 'booking-saas-api',
    },
  );

  return { token, expiresAt };
}

/**
 * Reads a support token, or returns null if this is not one.
 *
 * Null rather than throwing for the not-a-support-token case, because the
 * caller's next move is to try it as an ordinary access token. A malformed or
 * expired token that IS claiming support scope still throws — that is a real
 * failure and must not silently degrade into anonymous access.
 */
export function verifySupportToken(token: string): SupportTokenPayload | null {
  let decoded: unknown;

  try {
    decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      issuer: 'booking-saas',
      audience: 'booking-saas-api',
      algorithms: ['HS256'],
    });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      // Only claim this as a support expiry if it actually is one — decoding
      // without verifying is safe here because we are reading the scope to
      // pick an error message, not to grant anything.
      const payload = jwt.decode(token);
      if (
        payload &&
        typeof payload !== 'string' &&
        (payload as { scope?: string }).scope === SUPPORT_SCOPE
      ) {
        throw AppError.unauthorized(
          'This support session has expired.',
          'SUPPORT_SESSION_EXPIRED',
        );
      }
    }
    return null;
  }

  if (typeof decoded === 'string' || decoded === null) return null;

  const payload = decoded as Partial<SupportTokenPayload>;
  if (payload.scope !== SUPPORT_SCOPE) return null;

  if (!payload.sid || !payload.organizationId || !payload.act?.sub) {
    throw AppError.unauthorized('Invalid token.', 'INVALID_TOKEN');
  }

  return {
    sub: String(payload.sub),
    scope: SUPPORT_SCOPE,
    sid: payload.sid,
    organizationId: payload.organizationId,
    readOnly: payload.readOnly !== false,
    act: { sub: payload.act.sub, email: String(payload.act.email ?? '') },
  };
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

  /**
   * A disabled account (S8) cannot renew a session.
   *
   * `setUserDisabled` revokes every outstanding refresh token, so in the
   * ordinary case the reuse branch above has already caught this. The check is
   * here anyway because that revocation is one `updateMany` and this is the
   * gate it protects: a token issued in the window between the disable landing
   * and the revocation completing, or one restored by any future code path,
   * must still be refused. The cheap check belongs next to the guarantee, not
   * only in the operation that usually enforces it.
   */
  if (existing.user.disabledAt) {
    throw AppError.forbidden(
      'This account has been disabled. Please contact support.',
      'ACCOUNT_DISABLED',
    );
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
