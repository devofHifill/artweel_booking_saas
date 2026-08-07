import { z } from 'zod';

/**
 * A booking mode is not a cosmetic label — it selects which availability
 * engine runs. APPOINTMENT is driven by staff schedules; EVENT and
 * COURSE_SERIES are driven by seat counts on concrete sessions.
 */
export const bookingModeSchema = z.enum([
  'APPOINTMENT',
  'EVENT',
  'COURSE_SERIES',
]);

const baseService = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  bookingMode: bookingModeSchema.default('APPOINTMENT'),

  /** 5 minutes to a full day. Longer than a day is a course, not a session. */
  durationMinutes: z.number().int().min(5).max(1440),

  /**
   * Per service, never global. A three-hour wheel class and a thirty-minute
   * consultation cannot share one granularity, which is precisely what the
   * WordPress plugin's single `slot_length` setting forced.
   */
  slotGranularityMinutes: z.number().int().min(5).max(480).default(15),

  capacityMin: z.number().int().min(1).max(500).default(1),
  capacityMax: z.number().int().min(1).max(500).default(1),

  priceCents: z.number().int().min(0).max(100_000_000).default(0),

  paddingBeforeMinutes: z.number().int().min(0).max(480).default(0),
  paddingAfterMinutes: z.number().int().min(0).max(480).default(0),

  minNoticeMinutes: z.number().int().min(0).max(525_600).default(0),
  maxHorizonDays: z.number().int().min(1).max(730).default(120),

  staffPreference: z
    .enum(['MANUAL', 'LEAST_BUSY', 'MOST_BUSY', 'ROUND_ROBIN'])
    .default('MANUAL'),

  skillLevel: z.string().max(40).optional().nullable(),
  prerequisiteServiceTypeId: z.string().uuid().optional().nullable(),
  cancellationPolicyId: z.string().uuid().optional().nullable(),

  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #A6522C.')
    .default('#A6522C'),

  isActive: z.boolean().default(true),

  depositType: z.enum(['none', 'percent', 'fixed']).default('none'),
  /** Percent when depositType is "percent", otherwise cents. */
  depositValue: z.number().int().min(0).default(0),
});

export const createServiceSchema = baseService
  .refine(
    (s) => s.capacityMin <= s.capacityMax,
    'Minimum capacity cannot exceed maximum capacity.',
  )
  .refine(
    (s) => s.depositType !== 'percent' || s.depositValue <= 100,
    'A percentage deposit cannot exceed 100.',
  )
  .refine(
    (s) => s.depositType === 'none' || s.depositValue > 0,
    'A deposit needs a value above zero.',
  )
  .refine(
    (s) => s.bookingMode !== 'APPOINTMENT' || s.capacityMax === 1,
    'Appointments are one-to-one; use EVENT for group classes.',
  );

export const updateServiceSchema = baseService
  .partial()
  .refine(
    (s) =>
      s.capacityMin === undefined ||
      s.capacityMax === undefined ||
      s.capacityMin <= s.capacityMax,
    'Minimum capacity cannot exceed maximum capacity.',
  );

export const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export const listServicesQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  bookingMode: bookingModeSchema.optional(),
});
