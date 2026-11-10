import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { uniqueSlug } from '../../lib/slug';
import { requireCapacity, type PlanId } from '../billing/plan';
import { countRunningClasses } from './class-limit';
import { assertReferencesBelong } from '../services/service.service';
import { assertAltText, assertOwnImage, releaseImageIfUnused } from '../media/media.service';
import { insertSession } from '../../scheduling/session.service';
import { translateSchedulingError } from '../../scheduling/pg-error';
import { resolveLocal, type ResolutionKind } from '../../scheduling/time/zoned';
import { planClassDates } from './class-dates';
import { dayLabel, findClashes, type Clash, type PlannedDate } from './clashes';
import type {
  CreateClassInput,
  CreateEventInput,
  EditEventInput,
  PreviewInput,
} from './activity.schema';

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

async function slugFor(organizationId: string, name: string, selfId?: string) {
  return uniqueSlug(
    name,
    async (candidate) =>
      (await prisma.serviceType.findFirst({
        where: { organizationId, slug: candidate, ...(selfId ? { id: { not: selfId } } : {}) },
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
    /** The rest of a Class's answers. An Event's steps do not ask them yet. */
    details?: Partial<Prisma.ServiceTypeUncheckedCreateInput>;
  },
) {
  if (input.imageKey) await assertOwnImage(organizationId, input.imageKey);
  assertAltText(input.imageKey, input.imageAlt);

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
      imageKey: input.imageKey || null,
      imageAlt: input.imageKey ? input.imageAlt?.trim() || null : null,
      durationMinutes: fields.durationMinutes,
      capacityMin: 1,
      capacityMax: input.seats,
      priceCents: input.priceCents,
      ...(fields.maxHorizonDays ? { maxHorizonDays: fields.maxHorizonDays } : {}),
      ...fields.details,
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
  where: { staffId: string | null; locationId: string | null; exceptServiceTypeId?: string },
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
  // A Class published Hidden is not running, so it takes no place yet. Showing
  // it later checks again (updateService).
  if (input.isActive) {
    requireCapacity(org.plan as PlanId, 'maxClasses', await countRunningClasses(organizationId));
  }

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
  await assertReferencesBelong(organizationId, input);
  await assertDraftBelongs(organizationId, input.draftId);
  const slug = await slugFor(organizationId, input.name);

  /*
    "Minimum notice" on a Class closes booking that long before its FIRST
    session — a Class is booked once, for the whole run. It is written to the
    cohort's enrolment deadline, which enrolment already enforces.
  */
  const enrollmentClosesAt =
    input.minNoticeMinutes > 0
      ? new Date(planned[0]!.startsAt.getTime() - input.minNoticeMinutes * 60_000)
      : null;

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
      details: {
        categoryId: input.categoryId ?? null,
        meetingPoint: input.meetingPoint || null,
        // The service's own prices mirror the cohort's: for a Class both are
        // for the whole run.
        childPriceCents: input.childPriceCents,
        capacityMin: input.minGuests,
        depositType: input.depositType,
        depositValue: input.depositType === 'none' ? 0 : input.depositValue,
        ...(input.color ? { color: input.color, colorAccent: input.colorAccent ?? null } : {}),
        cancellationPolicyId: input.cancellationPolicyId ?? null,
        minNoticeMinutes: input.minNoticeMinutes,
        // Left blank, booking opens at once — far enough to reach the first
        // session, as an Event's does.
        maxHorizonDays:
          input.maxHorizonDays ??
          Math.max(120, Math.ceil((planned[0]!.startsAt.getTime() - Date.now()) / 86_400_000) + 1),
        highlights: input.highlights || null,
        preparationNotes: input.preparationNotes || null,
        bookingInstructions: input.bookingInstructions || null,
        isActive: input.isActive,
      },
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
        childPriceCents: input.childPriceCents,
        enrollmentClosesAt,
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

// --- Editing a Class or an Event ---------------------------------------------
//
// The same answers the steps collect, applied to what was published: the
// activity, its cohort (a Class), and every session that has not started.
// Started and past sessions are history and are left as they ran.
//
// Dates and times change only while nobody has booked and nothing has
// started: moving a date under somebody who paid for it is a conversation
// with them, not a field edit. Everything else can change at any time, and
// reaches the sessions — seats (never below what is sold), the instructor
// (their time moves with it, clash-checked) and where it runs.

/** The detail answers both edit bodies carry. */
type Details = {
  description?: string;
  categoryId?: string;
  meetingPoint?: string;
  childPriceCents: number;
  minGuests: number;
  depositType: 'none' | 'percent' | 'fixed';
  depositValue: number;
  emoji?: string;
  color?: string;
  colorAccent?: string;
  cancellationPolicyId?: string;
  minNoticeMinutes: number;
  maxHorizonDays?: number;
  highlights?: string;
  preparationNotes?: string;
  bookingInstructions?: string;
  isActive: boolean;
};

/** An instant as the studio's wall clock: its date, time and weekday. */
function localParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    weekday: get('weekday').slice(0, 2).toUpperCase(),
  };
}

const WEEK_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** What editing needs to know about a published Class or Event. */
async function loadActivity(organizationId: string, id: string) {
  const service = await prisma.serviceType.findFirst({
    where: { id, organizationId, kind: { in: ['CLASS', 'EVENT'] } },
    include: {
      courseSeries: { where: { status: { not: 'CANCELLED' } }, take: 1 },
      serviceLocations: { select: { locationId: true }, take: 1 },
      staffServices: { select: { staffId: true }, take: 1 },
      sessions: {
        where: { status: { not: 'CANCELLED' } },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          seatsTaken: true,
          staffId: true,
          locationId: true,
        },
      },
    },
  });
  if (!service) throw AppError.notFound('Class or event not found.');

  const now = new Date();
  const series = service.courseSeries[0] ?? null;
  const booked =
    service.sessions.some((x) => x.seatsTaken > 0) ||
    (series
      ? (await prisma.enrollment.count({
          where: { courseSeriesId: series.id, status: 'ACTIVE' },
        })) > 0
      : false);
  const started = service.sessions.some((x) => x.startsAt <= now);
  return { service, series, booked, started };
}

/**
 * The answers the Class or Event steps need to show a published activity, for
 * Edit. `datesLocked` says why its dates cannot change, when they cannot.
 */
export async function getActivityAnswers(organizationId: string, id: string) {
  const { service, series, booked, started } = await loadActivity(organizationId, id);
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const tz = org.timezone;
  const first = service.sessions[0];
  const last = service.sessions[service.sessions.length - 1];
  const start = first ? localParts(first.startsAt, tz) : null;
  const end = first ? localParts(first.endsAt, tz) : null;

  const schedule: Record<string, unknown> = {};
  if (service.kind === 'EVENT') {
    if (start) schedule.date = start.date;
  } else if (start && last) {
    const days = service.sessions.map((x) => localParts(x.startsAt, tz));
    const weekdays = WEEK_ORDER.filter((d) => days.some((x) => x.weekday === d));
    /* Skipped dates: the ones the weekly pattern passes through between the
       first and last session with no session on them — a holiday the studio
       unticked, or one it later cancelled. */
    const held = new Set(days.map((x) => x.date));
    const lastDate = localParts(last.startsAt, tz).date;
    const skipDates: string[] = [];
    for (
      let d = new Date(`${start.date}T00:00:00Z`);
      d.toISOString().slice(0, 10) <= lastDate;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const iso = d.toISOString().slice(0, 10);
      const wd = WEEK_ORDER[(d.getUTCDay() + 6) % 7]!;
      if (weekdays.includes(wd) && !held.has(iso)) skipDates.push(iso);
    }
    Object.assign(schedule, {
      startDate: start.date,
      weekdays,
      sessionCount: service.sessions.length,
      skipDates,
    });
  }

  return {
    id: service.id,
    kind: service.kind as 'CLASS' | 'EVENT',
    answers: {
      name: service.name,
      shortDescription: service.shortDescription ?? '',
      description: service.description ?? '',
      categoryId: service.categoryId ?? '',
      ...schedule,
      startTime: start?.time ?? '18:00',
      endTime: end?.time ?? '20:00',
      locationId:
        series?.locationId ?? first?.locationId ?? service.serviceLocations[0]?.locationId ?? '',
      staffId: series?.staffId ?? first?.staffId ?? service.staffServices[0]?.staffId ?? '',
      meetingPoint: service.meetingPoint ?? '',
      seats: series?.capacity ?? service.capacityMax,
      priceCents: series?.priceCents ?? service.priceCents,
      childPriceCents: series?.childPriceCents ?? service.childPriceCents,
      minGuests: service.capacityMin,
      depositType: service.depositType,
      depositValue: service.depositValue,
      emoji: service.emoji ?? '',
      imageKey: service.imageKey ?? '',
      imageAlt: service.imageAlt ?? '',
      color: service.color ?? '',
      colorAccent: service.colorAccent ?? '',
      cancellationPolicyId: service.cancellationPolicyId ?? '',
      minNoticeMinutes: service.minNoticeMinutes,
      maxHorizonDays: service.maxHorizonDays,
      highlights: service.highlights ?? '',
      preparationNotes: service.preparationNotes ?? '',
      bookingInstructions: service.bookingInstructions ?? '',
      isActive: service.isActive,
    },
    datesLocked: booked
      ? 'People have booked, so the dates and times stay as they are. To call one date off, cancel it from Scheduled sessions.'
      : started
        ? 'It has started, so the dates and times stay as they are.'
        : null,
  };
}

/** Same instants, in the same order? Then the dates did not change. */
function sameDates(
  a: { startsAt: Date; endsAt: Date }[],
  b: { startsAt: Date; endsAt: Date }[],
) {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.startsAt.getTime() === b[i]!.startsAt.getTime() &&
        x.endsAt.getTime() === b[i]!.endsAt.getTime(),
    )
  );
}

/**
 * Applies the Class or Event steps' answers to a published activity. `input`
 * is the whole set of answers: the steps always send everything.
 */
export async function editActivity(
  organizationId: string,
  id: string,
  kind: 'CLASS' | 'EVENT',
  input: (CreateClassInput | EditEventInput) & Partial<Details>,
) {
  const { service, series, booked, started } = await loadActivity(organizationId, id);
  if (service.kind !== kind) {
    throw AppError.badRequest(kind === 'CLASS' ? 'This is not a class.' : 'This is not an event.');
  }
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true, plan: true },
  });
  const tz = org.timezone;
  const now = new Date();

  // Switching a hidden Class on takes a place under the plan's class limit.
  if (kind === 'CLASS' && !service.isActive && input.isActive !== false) {
    requireCapacity(org.plan as PlanId, 'maxClasses', await countRunningClasses(organizationId));
  }

  // --- The dates wanted, and whether they moved ---------------------------
  let planned: { localDate: string; startsAt: Date; endsAt: Date; seriesIndex: number }[];
  if (kind === 'EVENT') {
    const e = input as EditEventInput;
    const start = resolveLocal(e.date, minutesOf(e.startTime), tz);
    const end = resolveLocal(e.date, minutesOf(e.endTime), tz);
    planned = [{ localDate: e.date, startsAt: start.instant, endsAt: end.instant, seriesIndex: 1 }];
  } else {
    planned = classSessions(input as CreateClassInput, tz).planned;
  }
  const datesChanged = !sameDates(planned, service.sessions);
  if (datesChanged) {
    if (booked || started) {
      throw AppError.conflict(
        booked
          ? 'People have booked, so the dates and times cannot change. To call one date off, cancel it from Scheduled sessions.'
          : 'It has started, so the dates and times cannot change.',
        'DATES_LOCKED',
      );
    }
    if (planned[0]!.startsAt <= now) {
      throw AppError.badRequest(
        'The first date has already passed. Choose a later one.',
        'DATE_IN_PAST',
      );
    }
  }

  // --- Seats: never below what is sold on any session still to run --------
  const upcoming = service.sessions.filter((x) => x.startsAt > now);
  const sold = Math.max(0, ...upcoming.map((x) => x.seatsTaken));
  if (input.seats < sold) {
    throw AppError.conflict(
      `${sold} ${sold === 1 ? 'place is' : 'places are'} already booked, so seats cannot go below that.`,
      'CAPACITY_BELOW_BOOKED',
    );
  }

  const { location, staffId } = await resolveWhereAndWho(organizationId, input);
  await assertReferencesBelong(organizationId, input as Record<string, unknown>);
  assertAltText(input.imageKey, input.imageAlt);
  const locationId = location?.id ?? null;
  const slug =
    input.name !== service.name ? await slugFor(organizationId, input.name, id) : service.slug;

  const whoOrWhereChanged = upcoming.some(
    (x) => x.staffId !== staffId || x.locationId !== locationId,
  );
  const firstStart =
    (datesChanged ? planned[0]!.startsAt : service.sessions[0]?.startsAt) ?? null;
  const notice = input.minNoticeMinutes ?? 0;

  const result = await inTransaction(async (tx) => {
    // Clashes on the dates it will run, ignoring its own sessions.
    if (datesChanged || whoOrWhereChanged) {
      const dates = datesChanged
        ? planned
        : upcoming.map((x) => ({
            localDate: localParts(x.startsAt, tz).date,
            startsAt: x.startsAt,
            endsAt: x.endsAt,
          }));
      await assertNoClashes(tx, organizationId, tz, dates, {
        staffId,
        locationId,
        exceptServiceTypeId: id,
      });
    }

    // The activity itself.
    await tx.serviceType.update({
      where: { id },
      data: {
        name: input.name,
        slug,
        shortDescription: input.shortDescription || null,
        description: input.description || null,
        categoryId: input.categoryId || null,
        meetingPoint: input.meetingPoint || null,
        durationMinutes: minutesOf(input.endTime) - minutesOf(input.startTime),
        capacityMax: input.seats,
        capacityMin: input.minGuests ?? 1,
        priceCents: input.priceCents,
        childPriceCents: input.childPriceCents ?? 0,
        depositType: input.depositType ?? 'none',
        depositValue: (input.depositType ?? 'none') === 'none' ? 0 : (input.depositValue ?? 0),
        emoji: input.emoji || null,
        imageKey: input.imageKey || null,
        imageAlt: input.imageKey ? input.imageAlt?.trim() || null : null,
        ...(input.color ? { color: input.color, colorAccent: input.colorAccent || null } : {}),
        cancellationPolicyId: input.cancellationPolicyId || null,
        minNoticeMinutes: notice,
        maxHorizonDays:
          input.maxHorizonDays ??
          (firstStart
            ? Math.max(120, Math.ceil((firstStart.getTime() - now.getTime()) / 86_400_000) + 1)
            : service.maxHorizonDays),
        highlights: input.highlights || null,
        preparationNotes: input.preparationNotes || null,
        bookingInstructions: input.bookingInstructions || null,
        isActive: input.isActive ?? true,
      },
    });
    await tx.serviceLocation.deleteMany({ where: { serviceTypeId: id } });
    if (locationId) await tx.serviceLocation.create({ data: { serviceTypeId: id, locationId } });
    await tx.staffService.deleteMany({ where: { serviceTypeId: id } });
    if (staffId) await tx.staffService.create({ data: { serviceTypeId: id, staffId } });

    // Its cohort (a Class): what the booking page and checkout read.
    if (series) {
      await tx.courseSeries.update({
        where: { id: series.id },
        data: {
          name: input.name,
          description: input.description || null,
          priceCents: input.priceCents,
          childPriceCents: input.childPriceCents ?? 0,
          capacity: input.seats,
          staffId,
          locationId,
          sessionCount: datesChanged ? planned.length : series.sessionCount,
          enrollmentClosesAt:
            notice > 0 && firstStart ? new Date(firstStart.getTime() - notice * 60_000) : null,
        },
      });
    }

    if (datesChanged) {
      // Nobody has booked: the old dates go, the new ones are made.
      const old = service.sessions.map((x) => x.id);
      await tx.staffTimeBlock.deleteMany({ where: { sessionId: { in: old } } });
      await tx.resourceAllocation.deleteMany({ where: { sessionId: { in: old } } });
      await tx.session.updateMany({ where: { id: { in: old } }, data: { status: 'CANCELLED' } });
      for (const date of planned) {
        await insertSession(tx, {
          organizationId,
          serviceTypeId: id,
          ...(series ? { courseSeriesId: series.id, seriesIndex: date.seriesIndex } : {}),
          startsAt: date.startsAt,
          endsAt: date.endsAt,
          timezone: tz,
          localStartTime: input.startTime,
          capacity: input.seats,
          staffId,
          locationId,
          lat: location?.lat ?? null,
          lng: location?.lng ?? null,
        });
      }
    } else {
      // Same dates: seats, instructor and place reach every session to come.
      const ids = upcoming.map((x) => x.id);
      await tx.session.updateMany({
        where: { id: { in: ids } },
        data: { capacity: input.seats, staffId, locationId },
      });
      if (whoOrWhereChanged) {
        await tx.staffTimeBlock.deleteMany({ where: { sessionId: { in: ids } } });
        if (staffId) {
          for (const x of upcoming) {
            await tx.$executeRaw`
              INSERT INTO staff_time_blocks
                (id, organization_id, staff_id, session_id, starts_at, ends_at,
                 lat, lng, source, created_at)
              VALUES
                (gen_random_uuid(), ${organizationId}::uuid, ${staffId}::uuid,
                 ${x.id}::uuid, ${x.startsAt}, ${x.endsAt},
                 ${location?.lat ?? null}, ${location?.lng ?? null}, 'session', now())
            `;
          }
        }
      }
    }

    return { id, datesChanged };
  });

  // A replaced or removed photo's files go once nothing points at them.
  if (service.imageKey && service.imageKey !== (input.imageKey || null)) {
    await releaseImageIfUnused(organizationId, service.imageKey);
  }
  return result;
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
    ...(input.activityId ? { exceptServiceTypeId: input.activityId } : {}),
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
