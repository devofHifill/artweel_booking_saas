import { RRule } from 'rrule';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { expandRule } from '../../scheduling/time/recurrence';

/**
 * Working hours and time off.
 *
 * Three tables in the WordPress plugin — one row per weekday, plus breaks,
 * plus days off — collapse into two concepts here: a recurring RULE and a
 * dated OVERRIDE. Nothing is pre-generated, so nothing can drift out of sync
 * with the pattern it came from.
 *
 * Minutes past local midnight rather than a TIME column, because a TIME has
 * no timezone and daylight saving then becomes invisible arithmetic.
 */

/** 09:00 - 17:00 becomes 540 - 1020. Values above 1440 run past midnight. */
const MAX_MINUTE = 2880;

function validateWindow(startMinute: number, endMinute: number) {
  if (startMinute < 0 || startMinute >= MAX_MINUTE) {
    throw AppError.badRequest('Start time is out of range.');
  }
  if (endMinute <= startMinute) {
    throw AppError.badRequest('The end time must be after the start time.');
  }
  if (endMinute > MAX_MINUTE) {
    throw AppError.badRequest('A single window cannot run beyond 48 hours.');
  }
}

/**
 * Rejects an RRULE the expander cannot read.
 *
 * Storing an unparseable rule means availability silently returns nothing for
 * that instructor, with no error anywhere — the studio just quietly stops
 * taking bookings.
 */
function validateRrule(rrule: string) {
  try {
    const parsed = RRule.fromString(`DTSTART:20260101T000000Z\nRRULE:${rrule}`);
    if (!parsed.options.freq && parsed.options.freq !== 0) {
      throw new Error('missing FREQ');
    }
  } catch {
    throw AppError.badRequest(
      'That repeat pattern could not be read. Expected something like ' +
        'FREQ=WEEKLY;BYDAY=TU,TH',
      'INVALID_RRULE',
    );
  }
}

async function assertStaffBelongs(organizationId: string, staffId: string) {
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, organizationId },
    select: { id: true, timezone: true },
  });
  if (!staff) throw AppError.notFound('Staff member not found.');
  return staff;
}

export async function listRules(organizationId: string, staffId: string) {
  await assertStaffBelongs(organizationId, staffId);

  return prisma.availabilityRule.findMany({
    where: { organizationId, staffId },
    orderBy: [{ ruleType: 'asc' }, { startMinute: 'asc' }],
  });
}

export async function createRule(
  organizationId: string,
  staffId: string,
  input: {
    ruleType: 'WORKING' | 'BREAK';
    rrule: string;
    startMinute: number;
    endMinute: number;
    timezone?: string;
    locationId?: string | null;
    effectiveFrom: Date;
    effectiveUntil?: Date | null;
  },
) {
  const staff = await assertStaffBelongs(organizationId, staffId);

  validateWindow(input.startMinute, input.endMinute);
  validateRrule(input.rrule);

  if (input.effectiveUntil && input.effectiveUntil <= input.effectiveFrom) {
    throw AppError.badRequest('The end date must be after the start date.');
  }

  if (input.locationId) {
    const location = await prisma.location.findFirst({
      where: { id: input.locationId, organizationId },
      select: { id: true },
    });
    if (!location) throw AppError.badRequest('Location not found.');
  }

  return prisma.availabilityRule.create({
    data: {
      organizationId,
      staffId,
      ruleType: input.ruleType,
      rrule: input.rrule,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      // Defaults to the person's own zone, which is what makes a mobile studio
      // spanning two zones behave correctly without extra thought.
      timezone: input.timezone ?? staff.timezone,
      locationId: input.locationId ?? null,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil ?? null,
    },
  });
}

export async function deleteRule(
  organizationId: string,
  staffId: string,
  ruleId: string,
) {
  const rule = await prisma.availabilityRule.findFirst({
    where: { id: ruleId, staffId, organizationId },
  });
  if (!rule) throw AppError.notFound('Schedule rule not found.');

  await prisma.availabilityRule.delete({ where: { id: ruleId } });
  return { deleted: true };
}

export async function listOverrides(
  organizationId: string,
  staffId: string,
  fromLocalDate?: string,
) {
  await assertStaffBelongs(organizationId, staffId);

  return prisma.availabilityOverride.findMany({
    where: {
      organizationId,
      staffId,
      ...(fromLocalDate ? { localDate: { gte: fromLocalDate } } : {}),
    },
    orderBy: { localDate: 'asc' },
  });
}

export async function createOverride(
  organizationId: string,
  staffId: string,
  input: {
    overrideType: 'DAY_OFF' | 'CUSTOM_HOURS' | 'EXTRA_HOURS';
    localDate: string;
    startMinute?: number | null;
    endMinute?: number | null;
    reason?: string | null;
  },
) {
  await assertStaffBelongs(organizationId, staffId);

  if (input.overrideType === 'DAY_OFF') {
    if (input.startMinute != null || input.endMinute != null) {
      throw AppError.badRequest('A day off cannot carry a time window.');
    }
  } else {
    if (input.startMinute == null || input.endMinute == null) {
      throw AppError.badRequest(
        `${input.overrideType === 'CUSTOM_HOURS' ? 'Custom' : 'Extra'} hours need a start and end time.`,
      );
    }
    validateWindow(input.startMinute, input.endMinute);
  }

  /**
   * A studio marking a day off when somebody is already booked would strip the
   * slot from availability while leaving the booking live — the customer turns
   * up and nobody is there. Refuse, and say how many bookings are in the way.
   */
  if (input.overrideType === 'DAY_OFF') {
    const staff = await prisma.staff.findUniqueOrThrow({
      where: { id: staffId },
      select: { timezone: true },
    });

    const dayStart = new Date(`${input.localDate}T00:00:00Z`);
    const dayEnd = new Date(dayStart.getTime() + 48 * 60 * 60_000);

    const clashes = await prisma.booking.count({
      where: {
        staffId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startsAt: { gte: dayStart, lt: dayEnd },
      },
    });

    if (clashes > 0) {
      throw AppError.conflict(
        `There ${clashes === 1 ? 'is' : 'are'} still ${clashes} booking(s) on that ` +
          `day (${staff.timezone}). Cancel or move them before marking it off.`,
        'DAY_HAS_BOOKINGS',
      );
    }
  }

  // Upsert: setting the same override twice is a correction, not an error.
  return prisma.availabilityOverride.upsert({
    where: {
      staffId_localDate_overrideType: {
        staffId,
        localDate: input.localDate,
        overrideType: input.overrideType,
      },
    },
    create: {
      organizationId,
      staffId,
      overrideType: input.overrideType,
      localDate: input.localDate,
      startMinute: input.startMinute ?? null,
      endMinute: input.endMinute ?? null,
      reason: input.reason ?? null,
    },
    update: {
      startMinute: input.startMinute ?? null,
      endMinute: input.endMinute ?? null,
      reason: input.reason ?? null,
    },
  });
}

export async function deleteOverride(
  organizationId: string,
  staffId: string,
  overrideId: string,
) {
  const override = await prisma.availabilityOverride.findFirst({
    where: { id: overrideId, staffId, organizationId },
  });
  if (!override) throw AppError.notFound('Override not found.');

  await prisma.availabilityOverride.delete({ where: { id: overrideId } });
  return { deleted: true };
}

/**
 * Shows the studio what a rule actually produces before they rely on it.
 *
 * RRULEs are easy to get subtly wrong, and the failure mode is silence. This
 * turns "FREQ=WEEKLY;BYDAY=TU,TH" into a list of real dates and times, with
 * daylight-saving anomalies flagged rather than buried.
 */
export async function previewRule(
  organizationId: string,
  staffId: string,
  ruleId: string,
  fromLocalDate: string,
  toLocalDate: string,
) {
  const rule = await prisma.availabilityRule.findFirst({
    where: { id: ruleId, staffId, organizationId },
  });
  if (!rule) throw AppError.notFound('Schedule rule not found.');

  const windows = expandRule({
    rrule: rule.rrule,
    startMinute: rule.startMinute,
    endMinute: rule.endMinute,
    timezone: rule.timezone,
    effectiveFrom: rule.effectiveFrom,
    effectiveUntil: rule.effectiveUntil,
    fromLocalDate,
    toLocalDate,
  });

  return {
    timezone: rule.timezone,
    occurrences: windows.map((w) => ({
      localDate: w.localDate,
      startsAt: w.start,
      endsAt: w.end,
      /**
       * 'shifted' means the clocks skipped this time and it moved forward;
       * 'ambiguous' means it happened twice and we took the first. Surfacing
       * these lets the UI warn instead of quietly relocating a class.
       */
      resolution: w.resolution,
    })),
  };
}
