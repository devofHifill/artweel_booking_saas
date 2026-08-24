import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { logger } from '../../lib/logger';
import { hashPassword, needsRehash, verifyPassword } from '../../lib/password';
import { TRIAL_DAYS } from '../billing/billing.service';
import {
  consumeVerificationToken,
  issueTokenPair,
  issueVerificationToken,
  revokeAllUserTokens,
} from './token.service';

/**
 * Slug generation for the public booking page URL.
 * "Clay & Co Pottery" -> "clay-co-pottery"
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = base || 'studio';
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const clash = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

export type RegisterInput = {
  email: string;
  password: string;
  name: string;
  /** Supplying this makes signup atomic: user, studio and ownership together. */
  organizationName?: string;
  timezone?: string;
  signupSource?: string;
  signupReferrer?: string;
  signupLanding?: string;
  userAgent?: string;
  ip?: string;
};

/**
 * Self-serve signup.
 *
 * Creating the user, the organization and the owner membership in ONE
 * transaction matters: a half-finished signup leaves someone with an account
 * and no studio, which is a support ticket the product cannot afford when
 * there is nobody to answer it.
 */
export async function register(input: RegisterInput) {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Deliberately explicit. Email enumeration is a real concern at LOGIN,
    // where it reveals who has an account; at registration the address is
    // already known to whoever typed it, and a vague error here just makes
    // signup fail mysteriously.
    throw AppError.conflict(
      'An account with that email already exists.',
      'EMAIL_TAKEN',
    );
  }

  const passwordHash = await hashPassword(input.password);

  const slug = input.organizationName
    ? await uniqueSlug(slugify(input.organizationName))
    : null;

  const { user, organization } = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const createdUser = await tx.user.create({
        data: { email, name: input.name.trim(), passwordHash },
      });

      if (!input.organizationName || !slug) {
        return { user: createdUser, organization: null };
      }

      const createdOrg = await tx.organization.create({
        data: {
          name: input.organizationName.trim(),
          slug,
          timezone: input.timezone ?? 'America/New_York',
          // The trial clock starts at signup, in the same transaction, so a
          // studio can never exist without one.
          subscriptionStatus: 'TRIALING',
          trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
          signupSource: input.signupSource,
          signupReferrer: input.signupReferrer,
          signupLanding: input.signupLanding,
        },
      });

      await tx.membership.create({
        data: {
          organizationId: createdOrg.id,
          userId: createdUser.id,
          role: 'OWNER',
        },
      });

      return { user: createdUser, organization: createdOrg };
    },
  );

  const verificationToken = await issueVerificationToken(
    user.id,
    'EMAIL_VERIFY',
  );

  const tokens = await issueTokenPair(user, {
    userAgent: input.userAgent,
    ip: input.ip,
  });

  return {
    user: publicUser(user),
    organization,
    tokens,
    // Handed back so the caller can send the email. Phase 1.5 replaces this
    // with a queued send; returning it keeps the flow testable meanwhile.
    verificationToken,
  };
}

export type LoginInput = {
  email: string;
  password: string;
  userAgent?: string;
  ip?: string;
};

export async function login(input: LoginInput) {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  // One message for both "no such user" and "wrong password", so login cannot
  // be used to discover which addresses have accounts.
  const invalid = () =>
    AppError.unauthorized('Incorrect email or password.', 'INVALID_CREDENTIALS');

  if (!user || !user.passwordHash) {
    // Burn comparable time even when the user does not exist, so response
    // latency does not become an oracle for which addresses are registered.
    await verifyPassword(input.password, await decoyHash());
    throw invalid();
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw invalid();

  /**
   * A disabled account (S8) is refused AFTER the password check, on purpose.
   *
   * Checking it first would make this endpoint an oracle: a wrong password on a
   * disabled account would answer differently from a wrong password on a live
   * one, and anyone could learn which addresses had been disabled by trying
   * junk. The password comparison has already happened by the time we get here,
   * so the timing matches too.
   *
   * The message is deliberately its own, not the generic one. Somebody whose
   * account was disabled needs to know to ask rather than to keep trying
   * passwords they know are right.
   */
  if (user.disabledAt) {
    throw AppError.forbidden(
      'This account has been disabled. Please contact support.',
      'ACCOUNT_DISABLED',
    );
  }

  // Transparent upgrade when the cost parameters have been raised.
  if (needsRehash(user.passwordHash)) {
    const upgraded = await hashPassword(input.password);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: upgraded },
    });
    logger.info({ userId: user.id }, 'Password hash upgraded');
  }

  const tokens = await issueTokenPair(user, {
    userAgent: input.userAgent,
    ip: input.ip,
  });

  const memberships = await listMemberships(user.id);

  return { user: publicUser(user), memberships, tokens };
}

/**
 * A real hash of a value nobody knows, used purely to spend the same CPU on a
 * missing account as on a present one.
 *
 * Built once, lazily, from the CONFIGURED cost so it always costs exactly
 * what a genuine verification costs — a hard-coded hash would diverge the
 * moment the cost parameters changed, reopening the timing channel.
 */
let decoy: string | null = null;
async function decoyHash(): Promise<string> {
  if (!decoy) decoy = await hashPassword(randomBytes(32).toString('hex'));
  return decoy;
}

export async function verifyEmail(rawToken: string) {
  const userId = await consumeVerificationToken(rawToken, 'EMAIL_VERIFY');

  const user = await prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });

  return publicUser(user);
}

export async function resendVerification(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) {
    throw AppError.badRequest('Email is already verified.', 'ALREADY_VERIFIED');
  }
  return issueVerificationToken(user.id, 'EMAIL_VERIFY');
}

/**
 * Starts a password reset.
 *
 * Always reports success. Reporting "no such account" turns this endpoint
 * into a free membership oracle for anyone with a list of email addresses.
 */
export async function requestPasswordReset(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    logger.info({ email }, 'Password reset requested for unknown address');
    return { token: null };
  }

  const token = await issueVerificationToken(user.id, 'PASSWORD_RESET');
  return { token };
}

/**
 * Completes a password reset.
 *
 * Revoking every refresh token afterwards is not optional: the usual reason
 * someone resets a password is that they believe somebody else has it, and
 * leaving existing sessions alive defeats the entire exercise.
 */
export async function resetPassword(rawToken: string, newPassword: string) {
  const userId = await consumeVerificationToken(rawToken, 'PASSWORD_RESET');
  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, emailVerifiedAt: new Date() },
  });

  const revoked = await revokeAllUserTokens(userId);
  logger.info({ userId, revoked }, 'Password reset — all sessions revoked');

  return { sessionsRevoked: revoked };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    throw AppError.badRequest(
      'Current password is incorrect.',
      'INVALID_CREDENTIALS',
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  return { sessionsRevoked: await revokeAllUserTokens(userId) };
}

export async function listMemberships(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: {
      organization: {
        select: { id: true, name: true, slug: true, timezone: true, currency: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return memberships.map((m) => ({
    organizationId: m.organizationId,
    role: m.role,
    organization: m.organization,
  }));
}

export function publicUser(user: {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerifiedAt !== null,
  };
}
