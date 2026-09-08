import type { MembershipRole } from '@prisma/client';

/**
 * What each role may do, and the studio's ability to change it.
 *
 * ---
 *
 * THE DEFAULTS BELOW REPRODUCE THE OLD MIDDLEWARE EXACTLY.
 *
 * Before this file, access was three hard-coded guards: `requireMember`
 * (everybody), `requireFrontDesk` (owner, admin, front desk) and
 * `requireAdmin` (owner, admin). Every default here is derived from which of
 * those guarded the route in question, so a studio that never opens the
 * permissions screen behaves precisely as it did yesterday.
 *
 * That is what makes this change safe to make at all: nothing moves until
 * somebody deliberately moves it, and the only rows ever written are
 * exceptions.
 *
 * ---
 *
 * OWNER IS NOT IN THE TABLE and is not overridable. An owner can always do
 * everything. A studio that could untick a permission for its own owner would
 * be one support ticket away from nobody being able to fix it.
 *
 * MANAGER is new. It sits between admin and the counter: it runs the day —
 * bookings, refunds, activities, staff, reports — and does not touch settings
 * or billing, which is the distinction an owner actually wants when they say
 * "I want somebody to run the place but not change the pricing".
 */

export const PERMISSIONS = [
  'booking.view',
  'booking.create',
  'booking.edit',
  'booking.cancel',
  'payment.view',
  'payment.refund',
  'report.view',
  'activity.manage',
  'staff.manage',
  'settings.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Shown on the settings screen, in this order. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'booking.view': 'View bookings',
  'booking.create': 'Create booking',
  'booking.edit': 'Edit booking',
  'booking.cancel': 'Cancel booking',
  'payment.view': 'View payments',
  'payment.refund': 'Issue refunds',
  'report.view': 'View reports',
  'activity.manage': 'Manage activities',
  'staff.manage': 'Manage staff',
  'settings.manage': 'Manage settings',
};

/**
 * The roles a studio can configure, in the order the screen shows them.
 *
 * OWNER is deliberately absent — see above. INSTRUCTOR keeps its database
 * name and is labelled "Guide" in the interface, because renaming an enum
 * value in place would rewrite every membership row for the sake of a word.
 */
export const CONFIGURABLE_ROLES = [
  'ADMIN',
  'MANAGER',
  'INSTRUCTOR',
  'FRONT_DESK',
] as const satisfies readonly MembershipRole[];

export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

export const ROLE_LABELS: Record<MembershipRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  INSTRUCTOR: 'Guide',
  FRONT_DESK: 'Front desk',
};

/**
 * The defaults, one row per role.
 *
 * ADMIN mirrors the old `requireAdmin` — everything except billing, which is
 * owner-only and is not a permission here because it is not the studio's to
 * delegate.
 *
 * FRONT_DESK mirrors the old `requireFrontDesk`: it could take, edit and
 * cancel bookings and see payments, and could not manage activities, staff or
 * settings. It could NOT issue refunds — that guard was admin-only.
 *
 * INSTRUCTOR mirrors the old `requireMember`-only routes: reads, and the
 * register. It could not take a booking or see money.
 */
const DEFAULTS: Record<ConfigurableRole, Permission[]> = {
  ADMIN: [...PERMISSIONS],
  MANAGER: [
    'booking.view',
    'booking.create',
    'booking.edit',
    'booking.cancel',
    'payment.view',
    'report.view',
    'activity.manage',
    'staff.manage',
  ],
  INSTRUCTOR: ['booking.view'],
  FRONT_DESK: [
    'booking.view',
    'booking.create',
    'booking.edit',
    /*
      CANCEL BELONGS HERE, and its absence was a real bug caught by
      `role-split.test.ts` on the first full run.

      The old guard on cancelling was `requireFrontDesk`, so the counter has
      always been able to do it — which is right: the customer rings the desk
      to cancel, not the person teaching. It was dropped from this list because
      the prototype's matrix shows the cell unticked, and matching a screenshot
      is not a reason to take a capability away from every existing studio.

      A studio that wants the prototype's arrangement can untick it. That is
      what the screen is for.
    */
    'booking.cancel',
    'payment.view',
  ],
};

export function defaultAllows(
  role: MembershipRole,
  permission: Permission,
): boolean {
  if (role === 'OWNER') return true;
  return DEFAULTS[role as ConfigurableRole]?.includes(permission) ?? false;
}

/**
 * The effective answer, given the studio's stored exceptions.
 *
 * `overrides` is keyed `role:permission`. An owner short-circuits before it is
 * consulted at all, so no stored row can ever lock an owner out.
 */
export function allows(
  role: MembershipRole,
  permission: Permission,
  overrides: Map<string, boolean>,
): boolean {
  if (role === 'OWNER') return true;

  const stored = overrides.get(`${role}:${permission}`);
  return stored ?? defaultAllows(role, permission);
}

/** The whole matrix for one studio, for the settings screen. */
export function buildMatrix(overrides: Map<string, boolean>) {
  return PERMISSIONS.map((permission) => ({
    permission,
    label: PERMISSION_LABELS[permission],
    roles: Object.fromEntries(
      CONFIGURABLE_ROLES.map((role) => [
        role,
        allows(role, permission, overrides),
      ]),
    ) as Record<ConfigurableRole, boolean>,
  }));
}
