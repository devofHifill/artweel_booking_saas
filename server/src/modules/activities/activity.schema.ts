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

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #A6522C.');

/**
 * Everything else an activity carries, asked on the Class steps (Look,
 * Policies, For customers) — all optional, with the same limits as the
 * activity editor (`service.schema.ts`) so a Class published here can be
 * opened and saved there unchanged.
 */
const classDetails = {
  categoryId: z.string().uuid().optional(),
  meetingPoint: z.string().trim().max(300).optional(),
  /** Per child place, for the whole run. 0 means adults only. */
  childPriceCents: z.number().int().min(0).max(10_000_000).default(0),
  /** The smallest party one booking may be. Not the minimum class size. */
  minGuests: z.number().int().min(1).max(500).default(1),
  depositType: z.enum(['none', 'percent', 'fixed']).default('none'),
  /** Percent when depositType is "percent", otherwise cents. */
  depositValue: z.number().int().min(0).default(0),
  color: hex.optional(),
  colorAccent: hex.optional(),
  cancellationPolicyId: z.string().uuid().optional(),
  minNoticeMinutes: z.number().int().min(0).max(525_600).default(0),
  /** Booking opens this many days before the first session. Left out: open now. */
  maxHorizonDays: z.number().int().min(1).max(730).optional(),
  highlights: z.string().trim().max(1200).optional(),
  preparationNotes: z.string().trim().max(2000).optional(),
  bookingInstructions: z.string().trim().max(2000).optional(),
  /** false publishes it Hidden: made, but not on the booking page. */
  isActive: z.boolean().default(true),
};

/** Matches the database's CHECK on highlights, which counts newlines exactly. */
function countLines(value: string | undefined): number {
  return value ? value.split('\n').length : 0;
}

export const createClassSchema = z
  .object({
    ...common,
    ...times,
    ...classDetails,
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
  .refine(endsAfterStarts, endsAfterStartsMessage)
  .refine((c) => c.minGuests <= c.seats, {
    message: 'The minimum guests cannot be more than the seats.',
    path: ['minGuests'],
  })
  .refine((c) => c.depositType !== 'percent' || c.depositValue <= 100, {
    message: 'A percentage deposit cannot exceed 100.',
    path: ['depositValue'],
  })
  .refine((c) => c.depositType === 'none' || c.depositValue > 0, {
    message: 'A deposit needs a value above zero.',
    path: ['depositValue'],
  })
  .refine((c) => countLines(c.highlights) <= 12, {
    message: 'Twelve lines is the most a booking page will show.',
    path: ['highlights'],
  });

/**
 * Editing an Event: everything its steps ask, plus every detail a Class's
 * steps ask — an Event created in four steps can still have its deposit,
 * policy and the rest set when it is edited.
 */
export const editEventSchema = z
  .object({
    ...common,
    ...times,
    ...classDetails,
    date: localDate,
  })
  .refine(endsAfterStarts, endsAfterStartsMessage)
  .refine((c) => c.minGuests <= c.seats, {
    message: 'The minimum guests cannot be more than the seats.',
    path: ['minGuests'],
  })
  .refine((c) => c.depositType !== 'percent' || c.depositValue <= 100, {
    message: 'A percentage deposit cannot exceed 100.',
    path: ['depositValue'],
  })
  .refine((c) => c.depositType === 'none' || c.depositValue > 0, {
    message: 'A deposit needs a value above zero.',
    path: ['depositValue'],
  })
  .refine((c) => countLines(c.highlights) <= 12, {
    message: 'Twelve lines is the most a booking page will show.',
    path: ['highlights'],
  });

export type EditEventInput = z.infer<typeof editEventSchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type CreateClassInput = z.infer<typeof createClassSchema>;

/**
 * The live clash check (Stage 4): only what decides WHEN, WHERE and WHO. Name,
 * seats and price play no part, so the steps can ask before they are filled.
 */
const previewWhereAndWho = {
  locationId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  /** Editing: that activity's own sessions are not clashes. */
  activityId: z.string().uuid().optional(),
};

// The refine sits on the union: a discriminated union takes plain objects only.
export const previewSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('EVENT'), ...times, ...previewWhereAndWho, date: localDate }),
    z.object({
      kind: z.literal('CLASS'),
      ...times,
      ...previewWhereAndWho,
      startDate: localDate,
      weekdays: z.array(z.enum(WEEKDAYS)).min(1).max(7),
      sessionCount: z.number().int().min(1).max(52),
      skipDates: z.array(localDate).max(100).optional(),
    }),
  ])
  .refine(endsAfterStarts, endsAfterStartsMessage);

export type PreviewInput = z.infer<typeof previewSchema>;

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
