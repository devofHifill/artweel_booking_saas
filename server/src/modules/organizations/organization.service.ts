import { Prisma, type MembershipRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { TRIAL_DAYS } from '../billing/billing.service';
import {
  BRAND_PRESETS,
  DEFAULT_PRESET_ID,
  deriveBrand,
  findPreset,
  resolveBrand,
} from '../../lib/brand';

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

// --- Branding -------------------------------------------------------------

/**
 * The studio's theme, plus the menu of choices.
 *
 * Returned together deliberately: the settings screen needs both, and shipping
 * the preset list from the server means adding a preset is one edit to
 * `lib/brand.ts` rather than one edit plus a matching one in the client.
 *
 * `preset` reports `custom` when an accent is stored, because an accent WINS
 * over the preset id — reporting the stale preset id underneath it would show
 * the owner a swatch they are not actually using.
 */
export async function getTheme(organizationId: string) {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { brandPreset: true, brandAccent: true },
  });

  return {
    preset: organization.brandAccent ? 'custom' : organization.brandPreset,
    accent: organization.brandAccent,
    tokens: resolveBrand(organization),
    presets: BRAND_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      swatch: preset.light['--clay'],
      swatchDark: preset.dark['--clay-text'],
    })),
  };
}

/**
 * Sets the theme.
 *
 * The two branches clear each other's column rather than leaving both set. With
 * both populated the accent silently wins and the preset row becomes a value
 * that is stored, shown nowhere, and wrong — the kind of state that is only
 * discovered when somebody later reads the column and believes it.
 *
 * A custom colour is validated by DERIVING it here, before the write. Derivation
 * is what enforces AA, so doing it after the update would mean a colour that
 * cannot be rendered legibly is already saved by the time anyone finds out.
 */
export async function updateTheme(
  organizationId: string,
  input: { preset: string; accent?: string | null },
) {
  if (input.preset === 'custom') {
    if (!input.accent) {
      throw AppError.badRequest(
        'Choose a colour to use a custom theme.',
        'ACCENT_REQUIRED',
      );
    }

    // Canonical lower-case form, matching the CHECK constraint on the column.
    const accent = input.accent.trim().toLowerCase();

    let derived;
    try {
      derived = deriveBrand(accent);
    } catch (error) {
      throw AppError.badRequest(
        error instanceof Error ? error.message : 'That colour cannot be used.',
        'ACCENT_UNUSABLE',
      );
    }

    await prisma.organization.update({
      where: { id: organizationId },
      data: { brandAccent: accent, brandPreset: DEFAULT_PRESET_ID },
    });

    return {
      preset: 'custom',
      accent,
      tokens: derived.scheme,
      adjusted: derived.adjusted,
      notes: derived.notes,
    };
  }

  const preset = findPreset(input.preset);
  if (!preset) throw AppError.badRequest('Unknown theme.', 'UNKNOWN_PRESET');

  await prisma.organization.update({
    where: { id: organizationId },
    data: { brandPreset: preset.id, brandAccent: null },
  });

  return {
    preset: preset.id,
    accent: null,
    tokens: { light: preset.light, dark: preset.dark },
    /* A curated preset is authored against AA and asserted in tests, so there is
       never anything to report here. The field is present in both shapes so the
       client has one response to render rather than two. */
    adjusted: false,
    notes: [] as string[],
  };
}
