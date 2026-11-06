import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { uniqueSlug } from '../../lib/slug';
import { requireCapacity, type PlanId } from '../billing/plan';
import { countRunningClasses } from './class-limit';
import { insertSession } from '../../scheduling/session.service';
import { translateSchedulingError } from '../../scheduling/pg-error';
import { resolveLocal, type ResolutionKind } from '../../scheduling/time/zoned';
import { planClassDates } from './class-dates';
import { dayLabel, findClashes, type Clash, type PlannedDate } from './clashes';
import type { CreateClassInput, CreateEventInput, PreviewInput } from './activity.schema';

/**
 * Publishing a Class or an Event (CLASS-EVENT-PLAN.md, Stage 1).
 *
 * Each is ONE transaction: the activity, where and who, and every date. An
 * instructor who is already teaching on one of the dates makes the exclusion
 * constraint on staff_time_blocks reject that insert, and nothing at all is
 * created — a class with a hole in it is broken (students buy the whole run),
 * and an event without its date is not an event.
 *
 * Built on what already sells: an Event is a seat-based activity
 * (BookingMode.EVENT) with one session; a Class is a course
 * (BookingMode.COURSE_SERIES) with one cohort that is on sale from the start.
 */

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  // A 52-session class is 104 inserts.
  timeout: 30_000,
  maxWait: 15_000,
} as const;

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
}

async function slugFor(organizationId: string, name: string) {
  return uniqueSlug(
    name,
    async (candidate) =>
      (await prisma.serviceType.findFirst({
        where: { organizationId, slug: candidate },
        select: { id: true },
      })) !== null,
    'service',
  );
}

/**
 * Where it runs, and who teaches it, checked before anything is written.
 *
 * A studio with exactly one location — or exactly one building — gets it
 * without asking (the plan's "defaults filled in"). Otherwise it MUST choose: the booking page
 * asks by location once a studio has any, so a date at none is invisible to
 * customers, and with several there is no safe guess.
 */
async function resolveWhereAndWho(
  organizationId: string,
  input: { locationId?: string; staffId?: string },
) {
  const active = await prisma.location.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, lat: true, lng: true, locationType: true },
  });
  /*
    The only building counts as the only place too. A studio plus a mobile
    service area is the ordinary shape (the seed models it), and a class is
    held in the building — the same rule the dashboard form applies.
  */
  const buildings = active.filter((l) => l.locationType === 'FIXED');

  let location: { id: string; lat: number | null; lng: number | null } | null = null;
  if (input.locationId) {
    location = active.find((l) => l.id === input.locationId) ?? null;
    if (!location) throw AppError.badRequest('Location not found.', 'LOCATION_NOT_FOUND');
  } else if (active.length === 1) {
    location = active[0]!;
  } else if (buildings.length === 1) {
    location = buildings[0]!;
  } else if (active.length > 1) {
    throw AppError.badRequest(
      'Choose where this runs. Customers only see dates at one of your locations.',
      'LOCATION_REQUIRED',
    );
  }

  if (input.staffId) {
    const staff = await prisma.staff.findFirst({
      where: { id: input.staffId, organizationId, isActive: true },
      select: { id: true },
    });
    if (!staff) throw AppError.badRequest('Instructor not found.', 'STAFF_NOT_FOUND');
  }

  return { location, staffId: input.staffId ?? null };
}

async function assertDraftBelongs(organizationId: string, draftId?: string) {
  if (!draftId) return;
  const draft = await prisma.activityDraft.findFirst({
    where: { id: draftId, organizationId },
    select: { id: true },
  });
  if (!draft) throw AppError.notFound('Draft not found.', 'DRAFT_NOT_FOUND');
}

/** The rows both kinds write before their dates. */
async function insertActivity(
  tx: Tx,
  organizationId: string,
  input: CreateEventInput | CreateClassInput,
  fields: {
    kind: 'CLASS' | 'EVENT';
    bookingMode: 'EVENT' | 'COURSE_SERIES';
    slug: string;
    durationMinutes: number;
    maxHorizonDays?: number;
    locationId: string | null;
    staffId: string | null;
  },
) {
  const service = await tx.serviceType.create({
    data: {
      organizationId,
      kind: fields.kind,
      bookingMode: fields.bookingMode,
      name: input.name,
      slug: fields.slug,
      shortDescription: input.shortDescription,
      description: input.description,
      emoji: input.emoji,
      durationMinutes: fields.durationMinutes,
      capacityMin: 1,
      capacityMax: input.seats,
      priceCents: input.priceCents,
      ...(fields.maxHorizonDays ? { maxHorizonDays: fields.maxHorizonDays } : {}),
    },
  });

  if (fields.locationId) {
    await tx.serviceLocation.create({
      data: { serviceTypeId: service.id, locationId: fields.locationId },
    });
  }
  if (fields.staffId) {
    await tx.staffService.create({
      data: { serviceTypeId: service.id, staffId: fields.staffId },
    });
  }

  if (input.draftId) {
    await tx.activityDraft.deleteMany({ where: { id: input.draftId, organizationId } });
  }

  return service;
}

/**
 * Refuses to publish over a clash, inside the publishing transaction.
 *
 * The location row is locked first, so two studios-worth of admins publishing
 * into the same one-at-a-time room cannot both pass the check and both write.
 * The instructor needs no lock: the exclusion constraint on staff_time_blocks
 * catches a race there regardless, and this check only exists to say which
 * date clashed and with what.
 */
async function assertNoClashes(
  tx: Tx,
  organizationId: string,
  timezone: string,
  dates: PlannedDate[],
  where: { staffId: string | null; locationId: string | null },
) {
  if (where.locationId) {
    await tx.$queryRaw`SELECT id FROM locations WHERE id = ${where.locationId}::uuid FOR UPDATE`;
  }
  const clashes = await findClashes(tx, organizationId, timezone, dates, where);
  const first = dates.find((d) => clashes.has(d.localDate));
  if (first) {
    const total = [...clashes.keys()].length;
    throw AppError.conflict(
      `${dayLabel(first.localDate)}: ${clashes.get(first.localDate)![0]!.message}.` +
        (total > 1 ? ` ${total - 1} more ${total === 2 ? 'date clashes' : 'dates clash'} too.` : ''),
      'CLASH',
    );
  }
}

async function inTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(work, TX_OPTIONS);
  } catch (err) {
    if (err instanceof AppError) throw err;
    translateSchedulingError(err);
  }
}

// --- Event ------------------------------------------------------------------

export async function createEvent(organizationId: string, input: CreateEventInput) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });

  const start = resolveLocal(input.date, minutesOf(input.startTime), org.timezone);
  const end = resolveLocal(input.date, minutesOf(input.endTime), org.timezone);

  if (start.instant.getTime() <= Date.now()) {
    throw AppError.badRequest('Choose a date and time that has not passed.', 'DATE_IN_PAST');
  }

  const { location, staffId } = await resolveWhereAndWho(organizationId, input);
  await assertDraftBelongs(organizationId, input.draftId);
  const slug = await slugFor(organizationId, input.name);

  /*
    How far ahead the activity takes bookings. The default is 120 days, and an
    event further out than that would be hidden from its own booking page and
    reported as "no dates" — so the window always reaches the event.
  */
  const daysAway = Math.ceil((start.instant.getTime() - Date.now()) / 86_400_000) + 1;

  return inTransaction(async (tx) => {
    await assertNoClashes(
      tx,
      organizationId,
      org.timezone,
      [{ localDate: input.date, startsAt: start.instant, endsAt: end.instant }],
      { staffId, locationId: location?.id ?? null },
    );

    const service = await insertActivity(tx, organizationId, input, {
      kind: 'EVENT',
      bookingMode: 'EVENT',
      slug,
      durationMinutes: Math.round((end.instant.getTime() - start.instant.getTime()) / 60_000),
      maxHorizonDays: Math.max(120, daysAway),
      locationId: location?.id ?? null,
      staffId,
    });

    const session = await insertSession(tx, {
      organizationId,
      serviceTypeId: service.id,
      startsAt: start.instant,
      endsAt: end.instant,
      timezone: org.timezone,
      localStartTime: input.startTime,
      capacity: input.seats,
      staffId,
      locationId: location?.id ?? null,
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
    });

    return { service, session, resolution: start.kind };
  });
}

// --- Class ------------------------------------------------------------------

export type PublishedClassSession = {
  id: string;
  seriesIndex: number;
  localDate: string;
  startsAt: Date;
  endsAt: Date;
  /** 'shifted' or 'ambiguous' means the date lands on a daylight-saving change. */
  resolution: ResolutionKind;
};

/**
 * A Class's sessions as instants: the calendar dates from `planClassDates`,
 * each start and end re-resolved against the studio's zone, so 6pm stays 6pm
 * across a daylight-saving change. Shared by publishing and the preview.
 */
function classSessions(
  input: Pick<CreateClassInput, 'startDate' | 'weekdays' | 'sessionCount' | 'skipDates' | 'startTime' | 'endTime'>,
  timezone: string,
) {
  let plan;
  try {
    plan = planClassDates(input);
  } catch (err) {
    throw AppError.badRequest(
      err instanceof Error ? err.message : 'Those dates do not work.',
      'INVALID_SCHEDULE',
    );
  }

  const startMinute = minutesOf(input.startTime);
  const endMinute = minutesOf(input.endTime);
  const planned = plan.dates.map((localDate, index) => {
    const start = resolveLocal(localDate, startMinute, timezone);
    const end = resolveLocal(localDate, endMinute, timezone);
    return {
      seriesIndex: index + 1,
      localDate,
      startsAt: start.instant,
      endsAt: end.instant,
      resolution: start.kind,
    };
  });

  return { plan, planned };
}

export async function createClass(organizationId: string, input: CreateClassInput) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true, plan: true },
  });

  /*
    Classes are on every plan, limited by how many run at once (Solo: 1). The
    older Courses module stays a Studio/Pro feature; a Class is a course
    underneath, but it is created here and counted here.
  */
  requireCapacity(org.plan as PlanId, 'maxClasses', await countRunningClasses(organizationId));

  const { plan, planned } = classSessions(input, org.timezone);
  const startMinute = minutesOf(input.startTime);
  const endMinute = minutesOf(input.endTime);

  if (planned[0]!.startsAt.getTime() <= Date.now()) {
    throw AppError.badRequest(
      'The first session has already passed. Choose a later start date.',
      'DATE_IN_PAST',
    );
  }

  const { location, staffId } = await resolveWhereAndWho(organizationId, input);
  await assertDraftBelongs(organizationId, input.draftId);
  const slug = await slugFor(organizationId, input.name);

  return inTransaction(async (tx) => {
    await assertNoClashes(tx, organizationId, org.timezone, planned, {
      staffId,
      locationId: location?.id ?? null,
    });

    const service = await insertActivity(tx, organizationId, input, {
      kind: 'CLASS',
      bookingMode: 'COURSE_SERIES',
      slug,
      durationMinutes: endMinute - startMinute,
      locationId: location?.id ?? null,
      staffId,
    });

    const series = await tx.courseSeries.create({
      data: {
        organizationId,
        serviceTypeId: service.id,
        name: input.name,
        description: input.description,
        sessionCount: input.sessionCount,
        capacity: input.seats,
        priceCents: input.priceCents,
        timezone: org.timezone,
        staffId,
        locationId: location?.id ?? null,
        // On sale from the moment it is published. Booking closes when the
        // first session starts: allowLateEnrollment stays at its default, false.
        status: 'PUBLISHED',
      },
    });

    const sessions: PublishedClassSession[] = [];
    for (const week of planned) {
      const session = await insertSession(tx, {
        organizationId,
        serviceTypeId: service.id,
        courseSeriesId: series.id,
        seriesIndex: week.seriesIndex,
        startsAt: week.startsAt,
        endsAt: week.endsAt,
        timezone: org.timezone,
        localStartTime: input.startTime,
        capacity: input.seats,
        staffId,
        locationId: location?.id ?? null,
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
      });
      sessions.push({ id: session.id, ...week });
    }

    return { service, series, sessions, skipped: plan.skipped, endDate: plan.endDate };
  });
}

// --- Preview ----------------------------------------------------------------

export type PreviewDate = {
  localDate: string;
  startsAt: Date;
  endsAt: Date;
  clashes: Clash[];
};

/**
 * The dates a Class or Event would have, and what already happens at each —
 * for the steps to show while the studio is still choosing. Writes nothing.
 *
 * Forgiving where publishing is strict: it is called on every change, often
 * mid-way through filling a step, so a location the studio has not chosen yet
 * is simply not checked rather than an error.
 */
export async function previewActivity(organizationId: string, input: PreviewInput) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });

  let dates: PlannedDate[];
  let skipped: string[] = [];
  if (input.kind === 'EVENT') {
    const start = resolveLocal(input.date, minutesOf(input.startTime), org.timezone);
    const end = resolveLocal(input.date, minutesOf(input.endTime), org.timezone);
    dates = [{ localDate: input.date, startsAt: start.instant, endsAt: end.instant }];
  } else {
    const { plan, planned } = classSessions(input, org.timezone);
    dates = planned;
    skipped = plan.skipped;
  }

  let locationId: string | null = null;
  let staffId: string | null = null;
  try {
    const resolved = await resolveWhereAndWho(organizationId, input);
    locationId = resolved.location?.id ?? null;
    staffId = resolved.staffId;
  } catch (err) {
    // LOCATION_REQUIRED: not chosen yet. Anything else is a real error.
    if (!(err instanceof AppError) || err.code !== 'LOCATION_REQUIRED') throw err;
    staffId = input.staffId ?? null;
  }

  const clashes = await findClashes(prisma, organizationId, org.timezone, dates, {
    staffId,
    locationId,
  });

  return {
    dates: dates.map(
      (d): PreviewDate => ({
        localDate: d.localDate,
        startsAt: d.startsAt,
        endsAt: d.endsAt,
        clashes: clashes.get(d.localDate) ?? [],
      }),
    ),
    skipped,
    clashCount: [...clashes.keys()].length,
  };
}

// --- Drafts -----------------------------------------------------------------

export async function listDrafts(organizationId: string) {
  return prisma.activityDraft.findMany({
    where: { organizationId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
}

export async function createDraft(
  organizationId: string,
  userId: string | null,
  input: { kind: 'CLASS' | 'EVENT'; data: Record<string, unknown> },
) {
  return prisma.activityDraft.create({
    data: {
      organizationId,
      kind: input.kind,
      data: input.data as Prisma.InputJsonValue,
      createdById: userId,
    },
  });
}

export async function updateDraft(
  organizationId: string,
  id: string,
  data: Record<string, unknown>,
) {
  const { count } = await prisma.activityDraft.updateMany({
    where: { id, organizationId },
    data: { data: data as Prisma.InputJsonValue },
  });
  if (count === 0) throw AppError.notFound('Draft not found.', 'DRAFT_NOT_FOUND');
  return prisma.activityDraft.findFirstOrThrow({ where: { id, organizationId } });
}

export async function deleteDraft(organizationId: string, id: string) {
  const { count } = await prisma.activityDraft.deleteMany({ where: { id, organizationId } });
  if (count === 0) throw AppError.notFound('Draft not found.', 'DRAFT_NOT_FOUND');
}
