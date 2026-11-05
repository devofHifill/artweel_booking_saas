import { z } from 'zod';
import { WEEKDAYS } from './class-dates';

/**
 * What the Class and Event step flows send when the studio presses Publish.
 *
 * Deliberately small. Everything the old Create activity form asked that these
 * do not — slot granularity, deposits, padding, categories, booking horizon —
 * takes the ServiceType default. See CLASS-EVENT-PLAN.md, "What is hidden".
 */

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD.');

const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time as HH:mm.');

/** Shared by both kinds: steps "What", "Where and who", "Seats and price". */
const common = {
  name: z.string().trim().min(1).max(200),
  shortDescription: z.string().trim().max(300).optional(),
  description: z.string().trim().max(4000).optional(),
  emoji: z.string().max(16).optional(),
  locationId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  seats: z.number().int().min(1).max(500),
  priceCents: z.number().int().min(0).max(10_000_000),
  /** The draft this was built in. Deleted in the same transaction as publishing. */
  draftId: z.string().uuid().optional(),
};

const times = {
  startTime: localTime,
  endTime: localTime,
};

/** "End after start" — both kinds run within one day. */
function endsAfterStarts(value: { startTime: string; endTime: string }) {
  return value.endTime > value.startTime;
}
const endsAfterStartsMessage = {
  message: 'The end time must be after the start time.',
  path: ['endTime'],
};

export const createEventSchema = z
  .object({
    ...common,
    ...times,
    date: localDate,
  })
  .refine(endsAfterStarts, endsAfterStartsMessage);

export const createClassSchema = z
  .object({
    ...common,
    ...times,
    startDate: localDate,
    weekdays: z
      .array(z.enum(WEEKDAYS))
      .min(1, 'Choose at least one day of the week.')
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'A day is listed twice.'),
    /** Same ceiling as a course cohort (`createSeriesSchema`). */
    sessionCount: z.number().int().min(1).max(52),
    skipDates: z.array(localDate).max(100).optional(),
  })
  .refine(endsAfterStarts, endsAfterStartsMessage);

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type CreateClassInput = z.infer<typeof createClassSchema>;

// --- Drafts -----------------------------------------------------------------

/**
 * A draft holds the step flow's answers in whatever shape the client keeps
 * them; it is validated only when published. The size cap stops it being used
 * as free storage.
 */
const draftData = z
  .record(z.unknown())
  .refine((value) => JSON.stringify(value).length <= 20_000, 'This draft is too large.');

export const createDraftSchema = z.object({
  kind: z.enum(['CLASS', 'EVENT']),
  data: draftData.default({}),
});

export const updateDraftSchema = z.object({
  data: draftData,
});
