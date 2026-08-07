import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

/**
 * Resolve .env relative to THIS file, not to process.cwd().
 *
 * `dotenv/config` looks in the working directory, so the app would silently
 * boot without configuration whenever it is started from somewhere else — a
 * process manager, a monorepo script, the compiled build. Anchoring to the
 * source location makes the lookup independent of how the process was launched.
 *
 * Works for both src/config (tsx) and dist/config (compiled): both are two
 * levels below server/.
 */
loadEnv({ path: path.resolve(__dirname, '../../.env') });

/**
 * Configuration is read and VALIDATED exactly once, here, at startup.
 * Nothing else in the codebase touches `process.env`.
 *
 * The app refuses to boot with a clear message if config is wrong, instead of
 * failing mysteriously three layers deep at request time.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),

  /**
   * How long a seat stays reserved while a customer is inside checkout.
   * Long enough to enter card details, short enough that abandoned carts
   * do not starve a popular class.
   */
  BOOKING_HOLD_TTL_MINUTES: z.coerce.number().int().positive().default(10),

  // --- Auth --------------------------------------------------------------
  // Separate secrets for access and refresh tokens. One secret for both means
  // a leaked access token can be replayed as a refresh token.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),

  /** Access tokens are short-lived because they cannot be revoked. */
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  /** Refresh tokens are long-lived but rotate on every use and CAN be revoked. */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  EMAIL_VERIFY_TTL_HOURS: z.coerce.number().int().positive().default(48),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  /**
   * scrypt cost exponent. Memory used is roughly 128 * 2^N * r bytes, so
   * 16 is about 67MB per hash — deliberately expensive, which is the point.
   * Tests override it downward; production must not.
   */
  PASSWORD_COST_EXPONENT: z.coerce.number().int().min(12).max(20).default(16),

  APP_URL: z.string().url().default('http://localhost:5173'),
  /** Where the public booking page lives; used to build Stripe return URLs. */
  PUBLIC_URL: z.string().url().default('http://localhost:4000'),

  // --- Payments ----------------------------------------------------------
  // Optional so the app boots without them: with no key configured the fake
  // provider is used, which keeps local development and the test suite
  // working offline. Production is guarded below.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** ISO country for new Connect accounts. US-only at launch. */
  STRIPE_ACCOUNT_COUNTRY: z.string().length(2).default('US'),

  // --- Notifications -----------------------------------------------------
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default('bookings@example.test'),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  /** Hours before the booking that reminders go out. */
  REMINDER_HOURS_AHEAD: z.coerce.number().int().min(1).max(168).default(24),
  SECOND_REMINDER_HOURS_AHEAD: z.coerce.number().int().min(1).max(48).default(2),

  /**
   * TCPA quiet hours, in the STUDIO's local time. An SMS that would land
   * outside this window is deferred to the start of it. Texting somebody at
   * 6am is both illegal and a good way to lose a customer.
   */
  SMS_QUIET_START_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  SMS_QUIET_END_HOUR: z.coerce.number().int().min(0).max(23).default(21),

  NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(6),
  /** How long a worker's claim on a message lasts before it becomes due again. */
  NOTIFICATION_LEASE_SECONDS: z.coerce.number().int().min(10).default(120),

  // --- Calendar sync -----------------------------------------------------
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  /**
   * 32 bytes, base64. Encrypts third-party refresh tokens at rest.
   * Generate with: openssl rand -base64 32
   */
  CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // The logger depends on this config, so console is the only option here.
  // eslint-disable-next-line no-console
  console.error('Invalid environment variables:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;

/**
 * Falling back to the fake payment provider is a convenience in development
 * and a catastrophe in production — bookings would confirm without anyone
 * being charged. Refuse to boot instead.
 */
if (
  config.NODE_ENV === 'production' &&
  (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET)
) {
  // eslint-disable-next-line no-console
  console.error(
    'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required in production.',
  );
  process.exit(1);
}

/**
 * The development fallback key is derived from JWT_ACCESS_SECRET, which is
 * fine locally and unacceptable in production: it would mean anyone who learns
 * the JWT secret can also decrypt every studio's calendar credentials.
 */
if (config.NODE_ENV === 'production' && !config.CREDENTIAL_ENCRYPTION_KEY) {
  // eslint-disable-next-line no-console
  console.error(
    'CREDENTIAL_ENCRYPTION_KEY is required in production. ' +
      'Generate one with: openssl rand -base64 32',
  );
  process.exit(1);
}
