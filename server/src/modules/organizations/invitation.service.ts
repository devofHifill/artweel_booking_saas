import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma, type MembershipRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/app-error';
import { hashPassword } from '../../lib/password';
import { issueTokenPair } from '../auth/token.service';

/**
 * Invitations — how anybody other than a founder gets into a studio.
 *
 * Until this existed, `register` was the only path that created a membership
 * and it only ever minted an OWNER. `ADMIN`, `INSTRUCTOR` and `FRONT_DESK` were
 * enforced by `requireRole` in 144 route definitions, carried in
 * `inviteMemberSchema`, and grantable by nothing — so three quarters of the
 * role model was theoretical, and the Staff page shipped in B2 described people
 * who could not sign in.
 */

/** Seven days. Long enough to survive a holiday, short enough to expire. */
const INVITE_TTL_DAYS = 7;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Everything about an invitation except the thing that would let you use it. */
function project(invitation: {
  id: string;
  email: string;
  name: string;
  role: MembershipRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  // Only the name is read. Widened so callers that select more — or less —
  // than the list route does can share this projection.
  invitedBy?: { name: string } | null;
}) {
  const now = new Date();

  return {
    id: invitation.id,
    email: invitation.email,
    name: invitation.name,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    invitedBy: invitation.invitedBy?.name ?? null,
    /**
     * One derived word rather than three booleans the client has to combine.
     * Every consumer wants the same answer and deriving it twice is how two
     * screens end up disagreeing about whether an invitation is still good.
     */
    status: invitation.revokedAt
      ? ('REVOKED' as const)
      : invitation.acceptedAt
        ? ('ACCEPTED' as const)
        : invitation.expiresAt <= now
          ? ('EXPIRED' as const)
          : ('PENDING' as const),
  };
}

export async function listInvitations(organizationId: string) {
  const invitations = await prisma.invitation.findMany({
    where: { organizationId },
    include: { invitedBy: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return invitations.map(project);
}

/**
 * Invites somebody, and returns the raw token exactly once.
 *
 * The token is emailed through the outbox and handed back to the caller in the
 * same breath. Returning it is not a leak — the caller is already an admin of
 * this studio, and it is what lets an owner re-send a link by hand when a
 * studio's email is going to spam, which happens constantly and is otherwise a
 * support ticket nobody can resolve.
 */
export async function inviteMember(
  organizationId: string,
  invitedByUserId: string,
  input: { email: string; name: string; role: 'ADMIN' | 'INSTRUCTOR' | 'FRONT_DESK' },
) {
  const email = input.email.trim().toLowerCase();

  /**
   * Somebody who is already here does not need an invitation.
   *
   * Checked before the insert so the answer is a sentence rather than a unique
   * violation — and because the alternative is worse than untidy: accepting a
   * second invitation would silently CHANGE their role, which is a different
   * operation with a different guard (`changeMemberRole`, which protects the
   * last owner).
   */
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: { organizationId, userId: existingUser.id },
      },
      select: { role: true },
    });

    if (membership) {
      throw AppError.conflict(
        `${input.name} is already on this studio's team as ${membership.role.toLowerCase()}. Change their role instead.`,
        'ALREADY_A_MEMBER',
      );
    }
  }

  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);

  let invitation;
  try {
    invitation = await prisma.invitation.create({
      data: {
        organizationId,
        email,
        name: input.name.trim(),
        role: input.role,
        tokenHash: sha256(raw),
        expiresAt,
        invitedByUserId,
      },
      include: { invitedBy: { select: { name: true, email: true } } },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw AppError.conflict(
        'There is already an open invitation for that address. Withdraw it first, or resend it.',
        'INVITATION_EXISTS',
      );
    }
    throw err;
  }

  await queueInvitationEmail(invitation.id, raw).catch((err) => {
    // The invitation exists and its link is in the response. Failing the whole
    // request because a template could not be queued would destroy the useful
    // part to report the recoverable one.
    logger.error({ err, invitationId: invitation.id }, 'Failed to queue invite');
  });

  return { invitation: project(invitation), token: raw };
}

/**
 * Withdraws an invitation that has not been used.
 *
 * Kept as a row rather than deleted. "We invited the wrong person and took it
 * back" is exactly the kind of thing somebody needs to be able to show later,
 * and a deleted row shows nothing.
 */
export async function revokeInvitation(
  organizationId: string,
  invitationId: string,
) {
  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, organizationId },
  });

  if (!invitation) throw AppError.notFound('Invitation not found.');

  if (invitation.acceptedAt) {
    throw AppError.conflict(
      'That invitation has already been accepted. Remove them from the team instead.',
      'ALREADY_ACCEPTED',
    );
  }

  if (invitation.revokedAt) return { revoked: true, alreadyRevoked: true };

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { revokedAt: new Date() },
  });

  return { revoked: true, alreadyRevoked: false };
}

/**
 * Reads an invitation from its token, so the accept page can describe it.
 *
 * Public and unauthenticated by necessity — the recipient has no account yet.
 * It returns the studio name, the role and the address it was sent to, and
 * nothing else about the studio or the person who sent it.
 */
export async function getInvitation(rawToken: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: {
      organization: { select: { name: true, slug: true } },
      invitedBy: { select: { name: true } },
    },
  });

  if (!invitation) throw AppError.notFound('That invitation link is not valid.');

  const status = project(invitation).status;

  // Whether the recipient needs to choose a password, or already has an
  // account and only needs to say yes.
  const existing = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });

  return {
    studio: invitation.organization.name,
    role: invitation.role,
    email: invitation.email,
    name: invitation.name,
    invitedBy: invitation.invitedBy.name,
    status,
    needsPassword: existing === null,
  };
}

export type AcceptInput = {
  token: string;
  /** Required only when the invitee has no account yet. */
  password?: string;
  userAgent?: string;
  ip?: string;
};

/**
 * Accepts an invitation.
 *
 * Two shapes behind one entry point, because the invitee cannot be expected to
 * know which one they are:
 *
 *   no account yet   — create the user (email already verified: they proved
 *                      control of the address by receiving this link) and the
 *                      membership together
 *   already has one  — add the membership only, and do NOT touch their password
 *
 * The whole thing is one transaction. A user created without their membership
 * is an account that can sign in and belongs to nothing, which looks exactly
 * like a bug to whoever it happens to.
 */
export async function acceptInvitation(input: AcceptInput) {
  const tokenHash = sha256(input.token);

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash },
    include: { organization: { select: { id: true, name: true } } },
  });

  if (!invitation) throw AppError.notFound('That invitation link is not valid.');

  // Constant-time confirmation, matching the booking-token path. The lookup
  // already matched; this guards any future change that makes it fuzzier.
  if (
    !timingSafeEqual(
      Buffer.from(invitation.tokenHash),
      Buffer.from(tokenHash),
    )
  ) {
    throw AppError.notFound('That invitation link is not valid.');
  }

  if (invitation.revokedAt) {
    throw AppError.conflict(
      'That invitation was withdrawn. Ask the studio to send a new one.',
      'INVITATION_REVOKED',
    );
  }
  if (invitation.acceptedAt) {
    throw AppError.conflict(
      'That invitation has already been used.',
      'INVITATION_USED',
    );
  }
  if (invitation.expiresAt <= new Date()) {
    throw AppError.conflict(
      'That invitation has expired. Ask the studio to send a new one.',
      'INVITATION_EXPIRED',
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });

  if (!existing && !input.password) {
    throw AppError.badRequest(
      'Choose a password to finish setting up your account.',
      'PASSWORD_REQUIRED',
    );
  }

  const passwordHash = input.password
    ? await hashPassword(input.password)
    : null;

  const user = await prisma.$transaction(async (tx) => {
    const account = existing
      ? await tx.user.findUniqueOrThrow({ where: { id: existing.id } })
      : await tx.user.create({
          data: {
            email: invitation.email,
            name: invitation.name,
            passwordHash: passwordHash!,
            /**
             * Verified on creation, deliberately. Receiving this link IS proof
             * of control of the address — it was sent there and nowhere else —
             * and making somebody verify an address they just demonstrated
             * they can read is a step that teaches them the product wastes
             * their time.
             */
            emailVerifiedAt: new Date(),
          },
        });

    /**
     * `createMany ... skipDuplicates` rather than `create`.
     *
     * The already-a-member case is refused at invite time, but a membership can
     * appear between the invite and the accept — somebody adds them by hand, or
     * they accept two invitations sent minutes apart. Accepting should be
     * idempotent rather than a unique violation the invitee has to interpret.
     */
    await tx.membership.createMany({
      data: [
        {
          organizationId: invitation.organizationId,
          userId: account.id,
          role: invitation.role,
        },
      ],
      skipDuplicates: true,
    });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date(), acceptedUserId: account.id },
    });

    return account;
  });

  /**
   * A disabled account cannot be revived by accepting an invitation.
   *
   * Checked after the membership is written rather than before: the membership
   * is legitimate either way — somebody re-enabled later should find themselves
   * on the team — but they are not getting a session out of it now.
   */
  if (user.disabledAt) {
    throw AppError.forbidden(
      'This account has been disabled. Please contact support.',
      'ACCOUNT_DISABLED',
    );
  }

  const tokens = await issueTokenPair(user, {
    userAgent: input.userAgent,
    ip: input.ip,
  });

  return {
    user: { id: user.id, email: user.email, name: user.name },
    organizationId: invitation.organizationId,
    studio: invitation.organization.name,
    role: invitation.role,
    tokens,
  };
}

/**
 * Queues the invitation email through the outbox.
 *
 * Written directly rather than through the notification module's template
 * machinery, on the same reasoning as B9's manifest: those templates are
 * CUSTOMER messages in a studio's own voice, editable on the Notifications
 * screen. An operational email that carries a credential must not be
 * something a studio can accidentally break the link out of.
 */
async function queueInvitationEmail(invitationId: string, rawToken: string) {
  const invitation = await prisma.invitation.findUniqueOrThrow({
    where: { id: invitationId },
    include: {
      organization: { select: { name: true } },
      invitedBy: { select: { name: true } },
    },
  });

  const url = `${config.APP_URL}/invite/${encodeURIComponent(rawToken)}`;
  const roleLabel = invitation.role.toLowerCase().replace('_', ' ');

  await prisma.notification.create({
    data: {
      organizationId: invitation.organizationId,
      channel: 'EMAIL',
      templateKey: 'team.invitation',
      destination: invitation.email,
      payload: {
        subject: `${invitation.invitedBy.name} invited you to ${invitation.organization.name}`,
        body: [
          `Hi ${invitation.name},`,
          '',
          `${invitation.invitedBy.name} has invited you to join ${invitation.organization.name} on Artweel as ${roleLabel}.`,
          '',
          url,
          '',
          `This link works for ${INVITE_TTL_DAYS} days and can only be used once.`,
          '',
          invitation.organization.name,
        ].join('\n'),
        fromName: invitation.organization.name,
      },
      scheduledFor: new Date(Date.now() - 1000),
      status: 'PENDING',
      // Keyed on the invitation, so resending after a withdrawal produces a
      // fresh message while a double-clicked Invite button does not.
      dedupeKey: `invitation:${invitation.id}`,
    },
  });
}
