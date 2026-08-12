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
