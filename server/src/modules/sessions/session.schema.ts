import { z } from 'zod';

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD.');

export const listSessionsQuerySchema = z.object({
  from: localDate,
  to: localDate,
  staffId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  courseSeriesId: z.string().uuid().optional(),
  includeCancelled: z.coerce.boolean().optional(),
});

/**
 * A whole register in one request.
 *
 * Marking students one at a time is how the register gets left half-finished:
 * an instructor on studio wifi taps six rows, two fail silently, and the
 * record is wrong in a way nobody notices until a make-up credit is disputed.
 * One request, one outcome.
 */
const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time as HH:mm.');

const timezone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Unknown timezone.');

export const createSessionSchema = z.object({
  serviceTypeId: z.string().uuid(),
  /** Wall-clock intent. The instant is derived, never supplied. */
  startLocalDate: localDate,
  localStartTime: localTime,
  timezone: timezone.optional(),
  capacity: z.number().int().min(1).max(500),
  staffId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  /** Overrides the service's duration for a one-off longer class. */
  durationMinutes: z.number().int().min(5).max(1440).optional(),

  /**
   * Scheduling a term of weekly drop-ins one request at a time is the kind of
   * chore that drives a studio back to a spreadsheet. Capped low because a
   * genuinely long run of dated classes is a course, and courses already have
   * their own model.
   */
  repeat: z
    .object({
      rrule: z
        .string()
        .min(3)
        .max(500)
        .refine(
          (value) => !/\b(COUNT|UNTIL)=/i.test(value),
          'Set the number of classes in `count`, not in the recurrence rule.',
        ),
      count: z.number().int().min(2).max(52),
    })
    .optional(),
});

export const updateSessionSchema = z
  .object({
    capacity: z.number().int().min(1).max(500),
    staffId: z.string().uuid().nullable(),
    locationId: z.string().uuid().nullable(),
  })
  .partial();

export const markRegisterSchema = z.object({
  entries: z
    .array(
      z.object({
        bookingId: z.string().uuid(),
        status: z.enum(['ATTENDED', 'NO_SHOW', 'CONFIRMED']),
      }),
    )
    .min(1)
    .max(500),
});
