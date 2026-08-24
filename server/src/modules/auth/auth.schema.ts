import { z } from 'zod';

/**
 * Request validation lives at the edge, in one place per module, so handlers
 * receive data that is already the right shape and services never re-check.
 */

/**
 * Password policy: length over composition rules.
 *
 * NIST 800-63B dropped mandatory symbol/digit mixes years ago — they push
 * people toward "Password1!" and predictable substitutions. A 12-character
 * minimum with no composition requirement produces stronger passwords in
 * practice, and the top-offenders check catches the handful that are simply
 * guessed first.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '123456789012',
  'qwertyuiop',
  'letmein12345',
  'iloveyou1234',
  'administrator',
  'welcome12345',
]);

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters.')
  .max(256, 'Password must be at most 256 characters.')
  .refine(
    (value) => !COMMON_PASSWORDS.has(value.toLowerCase()),
    'That password is too common. Please choose another.',
  );

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: passwordSchema,
  name: z.string().min(1).max(120),
  organizationName: z.string().min(1).max(120).optional(),
  timezone: z.string().max(64).optional(),

  /**
   * First-touch attribution, captured client-side.
   *
   * Bounded and optional — it is a hint for our own reporting, not something
   * anything depends on, so a missing or nonsense value must never block a
   * signup.
   */
  signupSource: z.string().max(80).optional(),
  signupReferrer: z.string().max(120).optional(),
  signupLanding: z.string().max(200).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(256),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(255),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(120),
  timezone: z.string().max(64).optional(),
  currency: z.string().length(3).optional(),
});

/**
 * No OWNER in the enum, and that is load-bearing rather than an oversight.
 *
 * Ownership is TRANSFERRED between people who already have accounts — a
 * different operation with a different guard, `changeMemberRole`, which
 * protects the last owner. Letting an invitation mint one would create a
 * second path to ownership that skips that guard entirely. The database
 * carries the same rule as a CHECK constraint, for anything that reaches the
 * table another way.
 */
export const inviteMemberSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(120),
  role: z.enum(['ADMIN', 'INSTRUCTOR', 'FRONT_DESK']),
});

/**
 * The password is optional because half the people accepting an invitation
 * already have an account — a freelance instructor who teaches at three
 * studios. The service decides which case this is and refuses with
 * `PASSWORD_REQUIRED` if one was needed and not given, rather than the schema
 * demanding a password from somebody who already has one.
 */
export const acceptInvitationSchema = z.object({
  password: passwordSchema.optional(),
});
