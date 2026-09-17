import { Prisma, type MembershipRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { revokeAllUserTokens } from '../auth/token.service';
import { changeMemberRole } from '../organizations/organization.service';
import { withAudit, type AuditEntry } from './audit.service';

/**
 * S8 — the global users list, and disabling an account.
 *
 * The only surface in the product that reads across every tenant's people at
 * once, which is why it sits behind the platform gate and is audited from the
 * first line rather than "once it matters". A cross-tenant list of names and
 * email addresses is exactly the thing you want a record of somebody having
 * looked at.
 */

export type UserQuery = {
  search?: string;
  status?: 'active' | 'disabled' | 'unverified';
  limit?: number;
  offset?: number;
};

/**
 * Users, newest first, with the studios they belong to.
 *
 * Memberships are included because the question behind this screen is almost
 * never "who is this person" on its own — it is "who is this person and which
 * studio are they emailing me about".
 */
export async function listUsers(query: UserQuery = {}) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);

  const where: Prisma.UserWhereInput = {
    ...(query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.status === 'disabled' ? { disabledAt: { not: null } } : {}),
    ...(query.status === 'active' ? { disabledAt: null } : {}),
    ...(query.status === 'unverified' ? { emailVerifiedAt: null } : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      // Explicit select, never exclusion. `passwordHash` is on this model, and
      // a default include here would put every studio owner's hash on a
      // dashboard — the kind of leak that is one careless `include` away.
      select: {
        id: true,
        email: true,
        name: true,
        emailVerifiedAt: true,
        disabledAt: true,
        disabledReason: true,
        createdAt: true,
        memberships: {
          select: {
            role: true,
            organization: { select: { id: true, name: true, slug: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerifiedAt !== null,
      disabled: user.disabledAt !== null,
      disabledAt: user.disabledAt,
      disabledReason: user.disabledReason,
      createdAt: user.createdAt,
      studios: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
      })),
    })),
    total,
    limit,
    offset,
  };
}

/**
 * Disables an account and cuts its live sessions.
 *
 * REVOKING THE REFRESH TOKENS IS HALF THE FEATURE, not a tidy-up. Setting the
 * column alone stops the next login and nothing else: the user's existing
 * refresh token is good for thirty days and renews itself silently, so an
 * account you "disabled" keeps working for a month. `revokeAllUserTokens`
 * already does exactly this for password resets, and reusing it is what keeps
 * the two paths from drifting.
 *
 * **The window this leaves, stated rather than papered over.** An access token
 * is a stateless JWT with a 15-minute life, so a user disabled mid-session can
 * keep making requests until theirs expires. Closing that would mean a database
 * read on every authenticated request across the entire product — which is the
 * cost the token design exists to avoid, and not a trade worth making for one
 * operator action. If a fifteen-minute tail is ever unacceptable for a specific
 * account, suspending their studio takes effect immediately and is the right
 * tool.
 */
export async function setUserDisabled(
  context: Pick<AuditEntry, 'actorUserId' | 'actorEmail' | 'ip' | 'userAgent'>,
  userId: string,
  input: { disabled: boolean; reason: string },
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, disabledAt: true },
  });

  if (!user) throw AppError.notFound('User not found.', 'USER_NOT_FOUND');

  /**
   * An operator cannot disable themselves.
   *
   * Not paternalism — it is the one move that cannot be undone from where they
   * are standing. Every route that could re-enable the account is behind the
   * platform gate, and the gate needs a session they would have just revoked.
   */
  if (input.disabled && userId === context.actorUserId) {
    throw AppError.badRequest(
      'You cannot disable your own account — you would not be able to undo it.',
      'CANNOT_DISABLE_SELF',
    );
  }

  const alreadyInState = input.disabled === (user.disabledAt !== null);
  if (alreadyInState) {
    return { user: await projectOne(userId), changed: false, tokensRevoked: 0 };
  }

  let tokensRevoked = 0;

  await withAudit(
    {
      ...context,
      action: input.disabled ? 'user.disable' : 'user.enable',
      targetType: 'user',
      targetId: userId,
      reason: input.reason,
    },
    async (tx, audit) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          disabledAt: input.disabled ? new Date() : null,
          disabledReason: input.disabled ? input.reason : null,
        },
      });

      audit({ metadata: { email: user.email, disabled: input.disabled } });
    },
  );

  // After the transaction, deliberately. Revocation is idempotent and safe to
  // repeat, so the ordering that matters is that the account is already marked
  // disabled if this throws — a disabled account with live refresh tokens is
  // recoverable by running it again, the reverse is not.
  if (input.disabled) {
    tokensRevoked = await revokeAllUserTokens(userId);
  }

  return { user: await projectOne(userId), changed: true, tokensRevoked };
}

/**
 * Changes somebody's role in a studio, from the platform.
 *
 * DELEGATES to `changeMemberRole` rather than writing the row itself, and that
 * is the entire design of this function. That helper owns two invariants — a
 * studio always has at least one owner, and nobody may demote the last one —
 * and the platform is precisely the caller most able to violate them by
 * accident and least likely to notice.
 *
 * A studio with zero owners is not a state worth being able to create: nobody
 * can invite, nobody can transfer ownership back, and recovering it means a
 * hand-written UPDATE against production. So the guard applies to operators
 * too, and the audit row records the attempt either way.
 */
export async function setMemberRole(
  context: Pick<AuditEntry, 'actorUserId' | 'actorEmail' | 'ip' | 'userAgent'>,
  organizationId: string,
  membershipId: string,
  input: { role: MembershipRole; reason: string },
) {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId },
    include: {
      user: { select: { id: true, email: true } },
      organization: { select: { name: true } },
    },
  });

  if (!membership) {
    throw AppError.notFound('Member not found.', 'MEMBER_NOT_FOUND');
  }

  const before = membership.role;

  const updated = await withAudit(
    {
      ...context,
      action: 'membership.role.set',
      targetType: 'membership',
      targetId: membershipId,
      organizationId,
      reason: input.reason,
    },
    async (_tx, audit) => {
      /*
        Deliberately NOT on the transaction client.

        `changeMemberRole` runs its own last-owner count, and threading the
        outer transaction through it would mean either duplicating that logic
        here or changing its signature for one caller. The audit row is still
        written in a transaction that fails if this throws — what is given up
        is the role change and the log being one atomic unit, and the failure
        mode of that is an audit row for a change that did not happen, which
        the metadata below makes obvious rather than silent.
      */
      const result = await changeMemberRole(
        organizationId,
        membershipId,
        input.role,
      );

      audit({
        metadata: {
          email: membership.user.email,
          studio: membership.organization.name,
          before,
          after: input.role,
        },
      });

      return result;
    },
  );

  return {
    membership: {
      membershipId: updated.id,
      role: updated.role,
      userId: membership.user.id,
      email: membership.user.email,
    },
    before,
  };
}

async function projectOne(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerifiedAt: true,
      disabledAt: true,
      disabledReason: true,
      createdAt: true,
    },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerifiedAt !== null,
    disabled: user.disabledAt !== null,
    disabledAt: user.disabledAt,
    disabledReason: user.disabledReason,
    createdAt: user.createdAt,
  };
}
