import { Prisma, type MembershipRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { TRIAL_DAYS } from '../billing/billing.service';

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

/** Creating a studio makes the creator its owner, atomically. */
export async function createOrganization(
  userId: string,
  input: { name: string; timezone?: string; currency?: string },
) {
  const slug = await uniqueSlug(slugify(input.name));

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const organization = await tx.organization.create({
      data: {
        name: input.name.trim(),
        slug,
        timezone: input.timezone ?? 'America/New_York',
        currency: input.currency ?? 'USD',
        subscriptionStatus: 'TRIALING',
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
      },
    });

    await tx.membership.create({
      data: { organizationId: organization.id, userId, role: 'OWNER' },
    });

    return organization;
  });
}

export async function getOrganization(organizationId: string) {
  return prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });
}

export async function updateOrganization(
  organizationId: string,
  data: {
    name?: string;
    timezone?: string;
    currency?: string;
    makeUpCreditsEnabled?: boolean;
    makeUpCreditDays?: number;
    makeUpRequiresNotice?: boolean;
    makeUpNoticeHours?: number;
    makeUpCrossCohort?: boolean;
    pieceHoldDays?: number;
  },
) {
  return prisma.organization.update({ where: { id: organizationId }, data });
}

export async function listMembers(organizationId: string) {
  const members = await prisma.membership.findMany({
    where: { organizationId },
    include: {
      user: {
        select: { id: true, name: true, email: true, emailVerifiedAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return members.map((m) => ({
    membershipId: m.id,
    role: m.role,
    joinedAt: m.createdAt,
    user: {
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      emailVerified: m.user.emailVerifiedAt !== null,
    },
  }));
}

/**
 * Changes a member's role.
 *
 * Two invariants, both learned from every team-management system that has
 * ever locked somebody out of their own account:
 *
 *   1. A studio must always have at least one OWNER.
 *   2. Nobody may demote themselves out of the last owner seat.
 */
export async function changeMemberRole(
  organizationId: string,
  membershipId: string,
  role: MembershipRole,
) {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId },
  });
  if (!membership) throw AppError.notFound('Member not found.');

  if (membership.role === 'OWNER' && role !== 'OWNER') {
    const owners = await prisma.membership.count({
      where: { organizationId, role: 'OWNER' },
    });
    if (owners <= 1) {
      throw AppError.badRequest(
        'A studio must have at least one owner.',
        'LAST_OWNER',
      );
    }
  }

  return prisma.membership.update({
    where: { id: membershipId },
    data: { role },
  });
}

export async function removeMember(
  organizationId: string,
  membershipId: string,
) {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId },
  });
  if (!membership) throw AppError.notFound('Member not found.');

  if (membership.role === 'OWNER') {
    const owners = await prisma.membership.count({
      where: { organizationId, role: 'OWNER' },
    });
    if (owners <= 1) {
      throw AppError.badRequest(
        'A studio must have at least one owner.',
        'LAST_OWNER',
      );
    }
  }

  await prisma.membership.delete({ where: { id: membershipId } });
  return { removed: true };
}
