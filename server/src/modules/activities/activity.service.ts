import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
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
import {
  fromRepeatRule,
  groupTimes,
  planClassRuns,
  repeatMatcher,
  toRepeatRule,
  type RepeatPattern,
  type Weekday,
} from './class-dates';
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

  /*
    The draft it was built in goes with publishing. One already discarded —
    from Activities in another tab while this one was open — is simply gone:
    the answers being published are all here, so refusing to save them over a
    missing draft would only lose the studio's work. Scoped to the studio, so
    another studio's draft id deletes nothing.
  */
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

type PlannedSession = {
  seriesIndex: number;
  localDate: string;
  startsAt: Date;
  endsAt: Date;
  resolution: ResolutionKind;
};

type PlannedGroup = {
  startTime: string;
  endTime: string;
  /**
   * Tells the groups apart on cards, the Manifest and the desk form: the time
   * ("6:00pm") when there are several times, the run's first date ("23 Nov")
   * when there are several runs, both ("23 Nov · 6:00pm") when both. Null for
   * a Class of one run at one time.
   */
  label: string | null;
  planned: PlannedSession[];
};

/** Every session a Class may make across all its groups (runs x times x sessions). */
const MAX_CLASS_SESSIONS = 600;

/** "23 Nov" for a calendar date. */
function dayMonth(localDate: string): string {
  return DateTime.fromISO(localDate, { zone: 'UTC' }).toFormat('d LLL');
}

/**
 * A Class's sessions as instants, one list per group — one group per run and
 * time: the calendar dates from `planClassRuns` (back-to-back runs over the
 * range, or one run), each time re-resolved against the studio's zone, so 6pm
 * stays 6pm across a daylight-saving change. Shared by publishing, editing
 * and the preview (REPEAT-PLAN.md, parts 2 and 4).
 */
function classGroups(
  input: Pick<
    CreateClassInput,
    | 'startDate'
    | 'repeat'
    | 'monthlyBy'
    | 'weekdays'
    | 'sessionCount'
    | 'skipDates'
    | 'startTime'
    | 'endTime'
    | 'groups'
    | 'bufferMinutes'
    | 'startTimes'
    | 'rangeEnd'
  >,
  timezone: string,
) {
  let runs;
  let times;
  try {
    runs = planClassRuns(input);
    times = groupTimes(input);
  } catch (err) {
    throw AppError.badRequest(
      err instanceof Error ? err.message : 'Those dates do not work.',
      'INVALID_SCHEDULE',
    );
  }

  const several = { runs: runs.runs.length > 1, times: times.length > 1 };
  if (runs.runs.length * times.length * input.sessionCount > MAX_CLASS_SESSIONS) {
    throw AppError.badRequest(
      `That is ${runs.runs.length * times.length * input.sessionCount} sessions in all; a class can have up to ${MAX_CLASS_SESSIONS}. Shorten the dates or remove a time.`,
      'INVALID_SCHEDULE',
    );
  }

  const groups: PlannedGroup[] = runs.runs.flatMap((run) =>
    times.map((t) => {
      const startMinute = minutesOf(t.startTime);
      const endMinute = minutesOf(t.endTime);
      const day = dayMonth(run.dates[0]!);
      return {
        startTime: t.startTime,
        endTime: t.endTime,
        label:
          several.runs && several.times
            ? `${day} · ${t.label}`
            : several.runs
              ? day
              : several.times
                ? t.label
                : null,
        planned: run.dates.map((localDate, index) => {
          const start = resolveLocal(localDate, startMinute, timezone);
          const end = resolveLocal(localDate, endMinute, timezone);
          return {
            seriesIndex: index + 1,
            localDate,
            startsAt: start.instant,
            endsAt: end.instant,
            resolution: start.kind,
          };
        }),
      };
    }),
  );

  /** Every group's sessions, soonest first: what clash checks and edits compare. */
  const all = groups
    .flatMap((g) => g.planned)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const last = runs.runs[runs.runs.length - 1]!;
  const plan = {
    skipped: runs.skipped,
    endDate: last.endDate,
    leftOver: runs.leftOver,
    runCount: runs.runs.length,
  };
  return { plan, groups, all };
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

  const { plan, groups, all } = classGroups(input, org.timezone);
  const startMinute = minutesOf(input.startTime);
  const endMinute = minutesOf(input.endTime);

  if (all[0]!.startsAt.getTime() <= Date.now()) {
    throw AppError.badRequest(
      'The first session has already passed. Choose a later start date.',
      'DATE_IN_PAST',
    );
  }

  const { location, staffId } = await resolveWhereAndWho(organizationId, input);
  await assertReferencesBelong(organizationId, input);
  const slug = await slugFor(organizationId, input.name);

  return inTransaction(async (tx) => {
    // Every group's dates at once: one clash anywhere and nothing is made.
    await assertNoClashes(tx, organizationId, org.timezone, all, {
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
          Math.max(120, Math.ceil((all[0]!.startsAt.getTime() - Date.now()) / 86_400_000) + 1),
        highlights: input.highlights || null,
        preparationNotes: input.preparationNotes || null,
        bookingInstructions: input.bookingInstructions || null,
        isActive: input.isActive,
      },
    });

    // One cohort per group: each is its own run with its own customers.
    const made: { series: Awaited<ReturnType<typeof tx.courseSeries.create>>; sessions: PublishedClassSession[] }[] = [];
    for (const group of groups) {
      const series = await tx.courseSeries.create({
        data: {
          organizationId,
          serviceTypeId: service.id,
          name: input.name,
          cohortLabel: group.label,
          description: input.description,
          sessionCount: input.sessionCount,
          capacity: input.seats,
          priceCents: input.priceCents,
          childPriceCents: input.childPriceCents,
          /*
            "Minimum notice" on a Class closes booking that long before its
            FIRST session — a Class is booked once, for the whole run. It is
            written to the cohort's enrolment deadline, which enrolment
            already enforces. Each group counts from its own first session.
          */
          enrollmentClosesAt:
            input.minNoticeMinutes > 0
              ? new Date(group.planned[0]!.startsAt.getTime() - input.minNoticeMinutes * 60_000)
              : null,
          timezone: org.timezone,
          staffId,
          locationId: location?.id ?? null,
          repeatRule: toRepeatRule(input, input.startDate),
          /*
            On sale from the moment it is published. A weekly course closes when
            its first session starts, as before. A daily or monthly run is long
            enough that turning people away after day one would empty it, so
            those take late joiners (REPEAT-PLAN.md).
          */
          allowLateEnrollment: input.repeat !== 'WEEKLY',
          status: 'PUBLISHED',
        },
      });

      const sessions: PublishedClassSession[] = [];
      for (const week of group.planned) {
        const session = await insertSession(tx, {
          organizationId,
          serviceTypeId: service.id,
          courseSeriesId: series.id,
          seriesIndex: week.seriesIndex,
          startsAt: week.startsAt,
          endsAt: week.endsAt,
          timezone: org.timezone,
          localStartTime: group.startTime,
          capacity: input.seats,
          staffId,
          locationId: location?.id ?? null,
          lat: location?.lat ?? null,
          lng: location?.lng ?? null,
        });
        sessions.push({ id: session.id, ...week });
      }
      made.push({ series, sessions });
    }

    return {
      service,
      // The first group, as a one-group Class has always answered.
      series: made[0]!.series,
      sessions: made[0]!.sessions,
      groups: made,
      skipped: plan.skipped,
      endDate: plan.endDate,
      runs: plan.runCount,
      leftOver: plan.leftOver,
    };
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
      // Every group's cohort, in the order they were made (earliest time first).
      courseSeries: { where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'asc' } },
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
          courseSeriesId: true,
        },
      },
    },
  });
  if (!service) throw AppError.notFound('Class or event not found.');

  const now = new Date();
  const seriesList = service.courseSeries;
  const series = seriesList[0] ?? null;
  const booked =
    service.sessions.some((x) => x.seatsTaken > 0) ||
    (seriesList.length
      ? (await prisma.enrollment.count({
          where: { courseSeriesId: { in: seriesList.map((x) => x.id) }, status: 'ACTIVE' },
        })) > 0
      : false);
  const started = service.sessions.some((x) => x.startsAt <= now);
  return { service, series, seriesList, booked, started };
}

/**
 * The answers the Class or Event steps need to show a published activity, for
 * Edit. `datesLocked` says why its dates cannot change, when they cannot.
 */
export async function getActivityAnswers(organizationId: string, id: string) {
  const { service, series, seriesList, booked, started } = await loadActivity(organizationId, id);
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const tz = org.timezone;
  /*
    A Class's groups are its runs x its times (REPEAT-PLAN.md, part 4). The
    earliest group carries the dates and time the steps show; the other times
    are its "more times", and the other runs follow from the date range.
  */
  const ofGroup = (seriesId: string | undefined) =>
    seriesId ? service.sessions.filter((x) => x.courseSeriesId === seriesId) : service.sessions;
  const groupSessions = (seriesList.length ? seriesList : [null])
    .map((cohort) => ofGroup(cohort?.id))
    .filter((xs) => xs.length > 0)
    .sort((a, b) => a[0]!.startsAt.getTime() - b[0]!.startsAt.getTime());
  const firstGroup = groupSessions[0] ?? [];
  const first = firstGroup[0];
  const last = firstGroup[firstGroup.length - 1];
  const start = first ? localParts(first.startsAt, tz) : null;
  const end = first ? localParts(first.endsAt, tz) : null;
  /** The cohort whose sessions are the first group's: its rule is the Class's. */
  const firstCohort =
    seriesList.find((c) => first && ofGroup(c.id)[0]?.id === first.id) ?? series;

  const schedule: Record<string, unknown> = {};
  if (service.kind === 'EVENT') {
    if (start) schedule.date = start.date;
  } else if (start && last) {
    const days = firstGroup.map((x) => localParts(x.startsAt, tz));
    /* The stored rule says how it repeats. A Class made before repeat has
       none, and is weekly on the days its sessions fall. */
    const pattern: RepeatPattern = fromRepeatRule(firstCohort?.repeatRule) ?? {
      repeat: 'WEEKLY',
      weekdays: WEEK_ORDER.filter((d) => days.some((x) => x.weekday === d)) as Weekday[],
    };

    // Runs: the groups' distinct date lists. More than one is a date range.
    const datesOf = (xs: typeof firstGroup) => xs.map((x) => localParts(x.startsAt, tz).date);
    const runKeys = [...new Set(groupSessions.map((xs) => datesOf(xs).join(',')))];
    const allHeld = new Set(groupSessions.flatMap(datesOf));
    const lastOfAll = [...allHeld].sort().at(-1)!;
    const rangeEnd = runKeys.length > 1 ? lastOfAll : null;

    /* Skipped dates: the ones the pattern passes through, from the first
       session to the last of the last run, with no session on them — a
       holiday the studio unticked, or one it later cancelled. */
    const matches = repeatMatcher(pattern, start.date);
    const until = rangeEnd ?? localParts(last.startsAt, tz).date;
    const skipDates: string[] = [];
    for (
      let d = DateTime.fromISO(start.date, { zone: 'UTC' });
      d.toISODate()! <= until;
      d = d.plus({ days: 1 })
    ) {
      const iso = d.toISODate()!;
      if (matches(d) && !allHeld.has(iso)) skipDates.push(iso);
    }

    // Times: each group's start, earliest first, without repeats across runs.
    const startTimes = [
      ...new Set(groupSessions.map((xs) => localParts(xs[0]!.startsAt, tz).time)),
    ].sort();
    const length = (last.endsAt.getTime() - last.startsAt.getTime()) / 60_000;
    const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

    Object.assign(schedule, {
      startDate: start.date,
      rangeEnd,
      repeat: pattern.repeat ?? 'WEEKLY',
      monthlyBy: pattern.monthlyBy ?? 'WEEKDAY',
      weekdays: pattern.weekdays,
      sessionCount: firstGroup.length,
      skipDates,
      startTimes,
      // The older fields, for anything still reading them.
      groups: startTimes.length,
      bufferMinutes:
        startTimes.length > 1
          ? Math.max(0, toMinutes(startTimes[1]!) - toMinutes(startTimes[0]!) - length)
          : 0,
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

/**
 * A Class's stored rule follows its answers. Late joining follows the repeat
 * only when the dates are being remade (nobody has booked yet), so a switch a
 * studio changed by hand on a running class is left alone.
 */
function classRepeatUpdate(
  input: CreateClassInput,
  series: { repeatRule: string | null },
  datesChanged: boolean,
) {
  const rule = toRepeatRule(input, input.startDate);
  const was = fromRepeatRule(series.repeatRule)?.repeat ?? 'WEEKLY';
  return {
    repeatRule: rule,
    ...(datesChanged && was !== input.repeat
      ? { allowLateEnrollment: input.repeat !== 'WEEKLY' }
      : {}),
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
  const { service, seriesList, booked, started } = await loadActivity(organizationId, id);
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
  let groups: PlannedGroup[] = [];
  if (kind === 'EVENT') {
    const e = input as EditEventInput;
    const start = resolveLocal(e.date, minutesOf(e.startTime), tz);
    const end = resolveLocal(e.date, minutesOf(e.endTime), tz);
    planned = [{ localDate: e.date, startsAt: start.instant, endsAt: end.instant, seriesIndex: 1 }];
  } else {
    const made = classGroups(input as CreateClassInput, tz);
    planned = made.all;
    groups = made.groups;
  }

  /*
    A Class is matched group by group (REPEAT-PLAN.md, part 4): a cohort whose
    sessions are exactly a wanted group's is KEPT as it is; the wanted groups
    nobody has yet are ADDED; the cohorts no group wants any more are DROPPED.
    Only a dropped cohort that somebody booked, or that has started, stops
    the save — so a booked run stays put while runs are added beside it, and
    an unbooked one can still move. An Event keeps its one-date rule.
  */
  const signature = (xs: { startsAt: Date; endsAt: Date }[]) =>
    xs.map((x) => `${x.startsAt.getTime()}-${x.endsAt.getTime()}`).join(',');
  const sessionsOf = (seriesId: string) =>
    service.sessions.filter((x) => x.courseSeriesId === seriesId);
  const existingBySignature = new Map(seriesList.map((c) => [signature(sessionsOf(c.id)), c]));
  const kept = new Map<number, (typeof seriesList)[number]>();
  const added: number[] = [];
  if (kind === 'CLASS') {
    groups.forEach((g, i) => {
      const match = existingBySignature.get(signature(g.planned));
      if (match && ![...kept.values()].includes(match)) kept.set(i, match);
      else added.push(i);
    });
  }
  const keptIds = new Set([...kept.values()].map((c) => c.id));
  const dropped = seriesList.filter((c) => !keptIds.has(c.id));

  const datesChanged =
    kind === 'EVENT' ? !sameDates(planned, service.sessions) : added.length > 0 || dropped.length > 0;

  if (datesChanged && kind === 'EVENT' && (booked || started)) {
    throw AppError.conflict(
      booked
        ? 'People have booked, so the dates and times cannot change. To call one date off, cancel it from Scheduled sessions.'
        : 'It has started, so the dates and times cannot change.',
      'DATES_LOCKED',
    );
  }
  if (kind === 'CLASS' && dropped.length) {
    const enrolled = new Set(
      (
        await prisma.enrollment.findMany({
          where: { courseSeriesId: { in: dropped.map((c) => c.id) }, status: 'ACTIVE' },
          select: { courseSeriesId: true },
        })
      ).map((e) => e.courseSeriesId),
    );
    for (const cohort of dropped) {
      const own = sessionsOf(cohort.id);
      const isBooked = enrolled.has(cohort.id) || own.some((x) => x.seatsTaken > 0);
      const hasStarted = own.some((x) => x.startsAt <= now);
      if (isBooked || hasStarted) {
        const from = own[0] ? dayMonth(localParts(own[0].startsAt, tz).date) : 'the first date';
        throw AppError.conflict(
          isBooked
            ? `The run from ${from} has bookings, so its dates and times stay as they are. Add new runs after it instead.`
            : `The run from ${from} has started, so its dates and times stay as they are.`,
          'DATES_LOCKED',
        );
      }
    }
  }
  const newDates =
    kind === 'EVENT' ? planned : added.flatMap((i) => groups[i]!.planned);
  if (datesChanged && newDates.some((x) => x.startsAt <= now)) {
    throw AppError.badRequest(
      'A new date has already passed. Choose a later one.',
      'DATE_IN_PAST',
    );
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

  // The sessions that stay: an Event's when its date holds, a Class's kept runs.
  const staying =
    kind === 'EVENT'
      ? datesChanged
        ? []
        : upcoming
      : upcoming.filter((x) => x.courseSeriesId && keptIds.has(x.courseSeriesId));
  const whoOrWhereChanged = staying.some(
    (x) => x.staffId !== staffId || x.locationId !== locationId,
  );
  const firstStart = (datesChanged ? planned[0]!.startsAt : service.sessions[0]?.startsAt) ?? null;
  const notice = input.minNoticeMinutes ?? 0;

  const result = await inTransaction(async (tx) => {
    // Clashes on the dates it will run, ignoring its own sessions.
    if (datesChanged || whoOrWhereChanged) {
      const dates = (kind === 'EVENT' ? planned : planned.filter((x) => x.startsAt > now)).map(
        (x) => ({ localDate: x.localDate, startsAt: x.startsAt, endsAt: x.endsAt }),
      );
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

    /* Its cohorts (a Class), one per group: what the booking page and
       checkout read. Each group's booking deadline counts from its own first
       session. */
    const cohortData = (firstOfGroup: Date | null | undefined) => ({
      name: input.name,
      description: input.description || null,
      priceCents: input.priceCents,
      childPriceCents: input.childPriceCents ?? 0,
      capacity: input.seats,
      staffId,
      locationId,
      enrollmentClosesAt:
        notice > 0 && firstOfGroup ? new Date(firstOfGroup.getTime() - notice * 60_000) : null,
    });

    /** Cancels sessions that are going, freeing the instructor's time. */
    const cancelSessions = async (ids: string[]) => {
      if (!ids.length) return;
      await tx.staffTimeBlock.deleteMany({ where: { sessionId: { in: ids } } });
      await tx.resourceAllocation.deleteMany({ where: { sessionId: { in: ids } } });
      await tx.session.updateMany({ where: { id: { in: ids } }, data: { status: 'CANCELLED' } });
    };
    const makeSessions = async (
      seriesId: string | null,
      startTime: string,
      dates: { startsAt: Date; endsAt: Date; seriesIndex: number }[],
    ) => {
      for (const date of dates) {
        await insertSession(tx, {
          organizationId,
          serviceTypeId: id,
          ...(seriesId ? { courseSeriesId: seriesId, seriesIndex: date.seriesIndex } : {}),
          startsAt: date.startsAt,
          endsAt: date.endsAt,
          timezone: tz,
          localStartTime: startTime,
          capacity: input.seats,
          staffId,
          locationId,
          lat: location?.lat ?? null,
          lng: location?.lng ?? null,
        });
      }
    };

    if (kind === 'EVENT') {
      if (datesChanged) {
        // Nobody has booked: the old date goes, the new one is made.
        await cancelSessions(service.sessions.map((x) => x.id));
        await makeSessions(null, input.startTime, planned);
      }
    } else {
      const answers = input as CreateClassInput;

      // Kept runs: same dates, so only their details and label follow.
      for (const [i, cohort] of kept) {
        await tx.courseSeries.update({
          where: { id: cohort.id },
          data: {
            ...cohortData(groups[i]!.planned[0]?.startsAt),
            cohortLabel: groups[i]!.label,
            ...classRepeatUpdate(answers, cohort, false),
          },
        });
      }

      /* Added runs reuse a dropped cohort where there is one (nobody booked
         it, or the save would have stopped above), so links to a one-run
         Class's page stay good; otherwise a new cohort is made. */
      const recycle = [...dropped];
      for (const i of added) {
        const group = groups[i]!;
        const data = {
          ...cohortData(group.planned[0]?.startsAt),
          cohortLabel: group.label,
          sessionCount: group.planned.length,
        };
        const reuse = recycle.shift();
        let seriesId: string;
        if (reuse) {
          await cancelSessions(sessionsOf(reuse.id).map((x) => x.id));
          seriesId = (
            await tx.courseSeries.update({
              where: { id: reuse.id },
              data: { ...data, ...classRepeatUpdate(answers, reuse, true) },
            })
          ).id;
        } else {
          seriesId = (
            await tx.courseSeries.create({
              data: {
                ...data,
                organizationId,
                serviceTypeId: id,
                timezone: tz,
                repeatRule: toRepeatRule(answers, answers.startDate),
                allowLateEnrollment: answers.repeat !== 'WEEKLY',
                status: 'PUBLISHED',
              },
            })
          ).id;
        }
        await makeSessions(seriesId, group.startTime, group.planned);
      }

      // Runs no longer wanted (and not reused): nobody booked them, so they end.
      for (const cohort of recycle) {
        await cancelSessions(sessionsOf(cohort.id).map((x) => x.id));
        await tx.courseSeries.update({ where: { id: cohort.id }, data: { status: 'CANCELLED' } });
      }
    }

    // What stays: seats, instructor and place reach every session to come.
    const ids = staying.map((x) => x.id);
    if (ids.length) {
      await tx.session.updateMany({
        where: { id: { in: ids } },
        data: { capacity: input.seats, staffId, locationId },
      });
    }
    if (kind === 'EVENT' && !datesChanged) {
      for (const cohort of seriesList) {
        await tx.courseSeries.update({
          where: { id: cohort.id },
          data: cohortData(sessionsOf(cohort.id)[0]?.startsAt),
        });
      }
    }
    if (whoOrWhereChanged) {
      await tx.staffTimeBlock.deleteMany({ where: { sessionId: { in: ids } } });
      if (staffId) {
        for (const x of staying) {
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
    // Every group's dates: a clash at 7:15 matters as much as one at 6:00.
    const { plan, all } = classGroups(input, org.timezone);
    dates = all;
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
