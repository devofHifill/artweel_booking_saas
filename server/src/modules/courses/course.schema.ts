import { z } from 'zod';

/**
 * A cohort is described by two separable things, and keeping them separable
 * matters: WHAT the course is (name, price, seats) and WHEN it runs (rule,
 * start date, time of day). The first is edited freely; the second is fixed
 * the moment sessions exist, because students have those dates in a calendar.
 */

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD.');

const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time as HH:mm.');

/**
 * IANA zone, validated against the runtime's own tz database rather than a
 * hand-maintained list. A typo here is not cosmetic — it silently changes
 * what time every student turns up.
 */
const timezone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Unknown timezone.');

export const createSeriesSchema = z.object({
  serviceTypeId: z.string().uuid(),
  name: z.string().min(1).max(200),
  cohortLabel: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).optional(),
  sessionCount: z.number().int().min(1).max(52),
  capacity: z.number().int().min(1).max(500),
  priceCents: z.number().int().min(0).max(10_000_000),
  timezone: timezone.optional(),
  staffId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  enrollmentClosesAt: z.coerce.date().optional(),
  allowLateEnrollment: z.boolean().optional(),
});

export const updateSeriesSchema = z
  .object({
    name: z.string().min(1).max(200),
    cohortLabel: z.string().min(1).max(120).nullable(),
    description: z.string().max(4000).nullable(),
    capacity: z.number().int().min(1).max(500),
    priceCents: z.number().int().min(0).max(10_000_000),
    staffId: z.string().uuid().nullable(),
    locationId: z.string().uuid().nullable(),
    enrollmentClosesAt: z.coerce.date().nullable(),
    allowLateEnrollment: z.boolean(),
    status: z.enum(['DRAFT', 'PUBLISHED']),
  })
  .partial();

export const generateSessionsSchema = z.object({
  /**
   * No COUNT or UNTIL: sessionCount on the cohort governs how many weeks it
   * runs, and two sources of truth for that is one too many.
   */
  rrule: z
    .string()
    .min(3)
    .max(500)
    .refine(
      (value) => !/\b(COUNT|UNTIL)=/i.test(value),
      'Set the number of sessions on the course, not in the recurrence rule.',
    ),
  startLocalDate: localDate,
  localStartTime: localTime,
});

export const listSeriesQuerySchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED']).optional(),
  serviceTypeId: z.string().uuid().optional(),
});

export const enrollSchema = z.object({
  customerId: z.string().uuid(),
  seats: z.number().int().min(1).max(50).optional(),
  notes: z.string().max(2000).optional(),
});
