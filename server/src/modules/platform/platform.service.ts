import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { logger } from '../../lib/logger';

/**
 * Platform (Artweel) authority.
 *
 * Everything here operates on OUR data about our customers — organizations,
 * subscriptions, users. None of it goes through `withOrganization`, because
 * there is no tenant to scope to. The one capability that does need to reach
 * inside a studio is a support session, and that is S7, deliberately separate.
 */

/** A live grant, or null. Revoked grants never count. */
export async function findLiveGrant(userId: string) {
  return prisma.platformAdmin.findFirst({
    where: { userId, revokedAt: null },
    select: { id: true, grantedAt: true, note: true },
  });
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  return (await findLiveGrant(userId)) !== null;
}

/**
 * Grants platform admin.
 *
 * Called by the CLI script only — see the note on the model. There is no route
 * that reaches this, and adding one needs a better reason than convenience.
 */
export async function grantPlatformAdmin(opts: {
  email: string;
  grantedByUserId?: string;
  note?: string;
}) {
  const email = opts.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    throw AppError.notFound(
      `No user with the address ${email}. They must sign up first.`,
      'USER_NOT_FOUND',
    );
  }

  const existing = await findLiveGrant(user.id);
  if (existing) {
    return { user, grant: existing, alreadyHad: true };
  }

  const grant = await prisma.platformAdmin.create({
    data: {
      userId: user.id,
      grantedBy: opts.grantedByUserId,
      note: opts.note,
    },
    select: { id: true, grantedAt: true, note: true },
  });

  logger.warn(
    { userId: user.id, email: user.email, grantId: grant.id },
    'Platform admin GRANTED',
  );

  return { user, grant, alreadyHad: false };
}

/**
 * Revokes platform admin.
 *
 * Stamps `revoked_at` rather than deleting the row: the partial unique index
 * frees the user up to be granted again, and the history of who had it and when
 * survives. Deleting would make the answer to "was this account ever an admin?"
 * unavailable exactly when it is being asked.
 */
export async function revokePlatformAdmin(email: string) {
  const normalized = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true },
  });

  if (!user) {
    throw AppError.notFound(
      `No user with the address ${normalized}.`,
      'USER_NOT_FOUND',
    );
  }

  const { count } = await prisma.platformAdmin.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (count > 0) {
    logger.warn(
      { userId: user.id, email: user.email },
      'Platform admin REVOKED',
    );
  }

  return { user, revoked: count };
}

export async function listPlatformAdmins() {
  return prisma.platformAdmin.findMany({
    where: { revokedAt: null },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { grantedAt: 'asc' },
  });
}
