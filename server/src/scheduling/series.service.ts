import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { AppError, BookingErrorCode } from '../lib/app-error';
import { translateSchedulingError } from './pg-error';
import { expandLocalDates } from './time/recurrence';
import { resolveLocal, type ResolutionKind } from './time/zoned';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  timeout: 30_000,
  maxWait: 15_000,
} as const;

// ---------------------------------------------------------------------------
// Session generation
// ---------------------------------------------------------------------------

export type GenerateSessionsInput = {
  organizationId: string;
  courseSeriesId: string;
  /** e.g. "FREQ=WEEKLY;BYDAY=TU". Must not carry COUNT or UNTIL. */
  rrule: string;
  /** Local date of the first candidate occurrence, "YYYY-MM-DD". */
  startLocalDate: string;
  /** Wall-clock start, "HH:mm". Re-resolved per date, never stepped. */
  localStartTime: string;
};

export type GeneratedSession = {
  id: string;
  seriesIndex: number;
  localDate: string;
  startsAt: Date;
  endsAt: Date;
  /** 'shifted' or 'ambiguous' means this week landed on a DST transition. */
  resolution: ResolutionKind;
};

function parseLocalTime(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw AppError.badRequest(`Invalid time "${value}", expected HH:mm.`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw AppError.badRequest(`Invalid time "${value}".`);
  }
  return hours * 60 + minutes;
}

/**
 * Generates the cohort's sessions.
 *
 * Two properties are worth stating plainly, because both are load-bearing:
 *
 * ALL OR NOTHING. Every session, and every instructor time block, is written
 * in one transaction. If the instructor is already teaching on week four, the
 * exclusion constraint rejects that insert and the whole cohort rolls back.
 * Publishing a course with a hole in week four and discovering it once
 * students have paid is far worse than refusing to create it.
 *
 * DST-CORRECT BY CONSTRUCTION. The RRULE yields calendar dates; the 19:00 is
 * re-resolved against the zone for each one. A Tuesday evening course spanning
 * the November transition keeps every session at 19:00 local, and the UTC
 * instants deliberately differ by an hour either side of it.
 */
export async function generateSeriesSessions(
  input: GenerateSessionsInput,
): Promise<GeneratedSession[]> {
  const series = await prisma.courseSeries.findFirst({
    where: { id: input.courseSeriesId, organizationId: input.organizationId },
    include: { serviceType: true },
  });

  if (!series) throw AppError.notFound('Course series not found.');

  if (series.status === 'CANCELLED') {
    throw AppError.conflict('This cohort has been cancelled.');
  }

  const existing = await prisma.session.count({
    where: { courseSeriesId: series.id },
  });
  if (existing > 0) {
    throw AppError.conflict(
      'This cohort already has sessions. Cancel it and create a new one to reschedule.',
    );
  }

  const startMinute = parseLocalTime(input.localStartTime);
  const duration = series.serviceType.durationMinutes;
  const endMinute = startMinute + duration;

  let localDates: string[];
  try {
    localDates = expandLocalDates(
      input.rrule,
      input.startLocalDate,
      series.sessionCount,
    );
  } catch (err) {
    throw AppError.badRequest(
      err instanceof Error ? err.message : 'Invalid recurrence rule.',
    );
  }

  const planned = localDates.map((localDate, index) => {
    const start = resolveLocal(localDate, startMinute, series.timezone);
    const end = resolveLocal(localDate, endMinute, series.timezone);
    return {
      seriesIndex: index + 1,
      localDate,
      startsAt: start.instant,
      endsAt: end.instant,
      // Report the start's resolution: that is the one a student reads off
      // their calendar, and the one an admin needs warning about.
      resolution: start.kind,
    };
  });

  const padBefore = series.serviceType.paddingBeforeMinutes;
  const padAfter = series.serviceType.paddingAfterMinutes;

  const location = series.locationId
    ? await prisma.location.findFirst({
        where: { id: series.locationId, organizationId: series.organizationId },
        select: { lat: true, lng: true },
      })
    : null;

  try {
    return await prisma.$transaction(async (tx: Tx) => {
      const created: GeneratedSession[] = [];

      for (const week of planned) {
        const session = await tx.session.create({
          data: {
            organizationId: series.organizationId,
            serviceTypeId: series.serviceTypeId,
            courseSeriesId: series.id,
            seriesIndex: week.seriesIndex,
            staffId: series.staffId,
            locationId: series.locationId,
            startsAt: week.startsAt,
            endsAt: week.endsAt,
            timezone: series.timezone,
            localStartTime: input.localStartTime,
            capacity: series.capacity,
            seatsTaken: 0,
            status: 'SCHEDULED',
          },
        });

        // Same reasoning as createSession: a class with an instructor MUST
        // occupy that instructor's time, or a private lesson booked into the
        // same hour has nothing to collide with.
        if (series.staffId) {
          await tx.$executeRaw`
            INSERT INTO staff_time_blocks
              (id, organization_id, staff_id, session_id, starts_at, ends_at,
               lat, lng, source, created_at)
            VALUES
              (gen_random_uuid(), ${series.organizationId}::uuid,
               ${series.staffId}::uuid, ${session.id}::uuid,
               ${new Date(week.startsAt.getTime() - padBefore * 60_000)},
               ${new Date(week.endsAt.getTime() + padAfter * 60_000)},
               ${location?.lat ?? null}, ${location?.lng ?? null},
               'session', now())
          `;
        }

        created.push({ id: session.id, ...week });
      }

      return created;
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof AppError) throw err;
    translateSchedulingError(err);
  }
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

export type EnrollInput = {
  organizationId: string;
  courseSeriesId: string;
  customerId: string;
  seats?: number;
  source?: string;
  notes?: string;
  /** Skips the on-sale and enrolment-window checks. Admin adding someone by hand. */
  overrideWindow?: boolean;
};

type LockedSeriesSession = {
  id: string;
  series_index: number;
  capacity: number;
  seats_taken: number;
  status: string;
  starts_at: Date;
  ends_at: Date;
  timezone: string;
  service_type_id: string;
  location_id: string | null;
};

/**
 * Locks every scheduled session in a cohort, in series order.
 *
 * The ORDER BY is the deadlock defence and the reason this is a function
 * rather than an inlined query in two places: enrolling and holding must take
 * the same locks in the same sequence, or a paid checkout and a free enrolment
 * racing on one cohort can deadlock each other.
 */
async function lockSeriesSessions(
  tx: Tx,
  organizationId: string,
  courseSeriesId: string,
): Promise<LockedSeriesSession[]> {
  return tx.$queryRaw<LockedSeriesSession[]>`
    SELECT id, series_index, capacity, seats_taken, status::text AS status,
           starts_at, ends_at, timezone, service_type_id, location_id
    FROM sessions
    WHERE course_series_id = ${courseSeriesId}::uuid
      AND organization_id = ${organizationId}::uuid
      AND status = 'SCHEDULED'
    ORDER BY series_index
    FOR UPDATE
  `;
}

type EnrollableSeries = {
  status: string;
  enrollmentClosesAt: Date | null;
  allowLateEnrollment: boolean;
};

/**
 * Decides whether a cohort can take `seats` more people, under the locks.
 *
 * A course is full when its TIGHTEST week is full, not its first. Selling
 * five-sixths of a course is not something a studio can honour, so the whole
 * thing is refused and the limiting week is named — the studio needs to know
 * which one to open up.
 */
function assertSeriesEnrollable(
  series: EnrollableSeries,
  sessions: LockedSeriesSession[],
  seats: number,
  opts: { overrideWindow?: boolean } = {},
): { joinedLate: boolean } {
  if (!opts.overrideWindow) {
    if (series.status !== 'PUBLISHED') {
      throw new AppError(
        'This course is not open for enrolment.',
        409,
        BookingErrorCode.COURSE_NOT_ENROLLABLE,
      );
    }
    if (series.enrollmentClosesAt && series.enrollmentClosesAt <= new Date()) {
      throw new AppError(
        'Enrolment for this course has closed.',
        409,
        BookingErrorCode.COURSE_NOT_ENROLLABLE,
      );
    }
  }

  if (sessions.length === 0) {
    throw new AppError(
      'This course has no scheduled sessions yet.',
      409,
      BookingErrorCode.COURSE_NOT_ENROLLABLE,
    );
  }

  const joinedLate = sessions[0]!.starts_at <= new Date();

  if (joinedLate && !series.allowLateEnrollment && !opts.overrideWindow) {
    throw new AppError(
      'This course has already started and does not accept late enrolment.',
      409,
      BookingErrorCode.COURSE_ALREADY_STARTED,
    );
  }

  let tightest = sessions[0]!;
  for (const session of sessions) {
    if (
      session.capacity - session.seats_taken <
      tightest.capacity - tightest.seats_taken
    ) {
      tightest = session;
    }
  }
  const worstRemaining = tightest.capacity - tightest.seats_taken;

  if (worstRemaining < seats) {
    throw new AppError(
      worstRemaining <= 0
        ? `This course is full (week ${tightest.series_index} has no seats left).`
        : `Only ${worstRemaining} place(s) left on this course — week ${tightest.series_index} is the limit.`,
      409,
      BookingErrorCode.COURSE_FULL,
    );
  }

  return { joinedLate };
}

/** Fans an enrolment out into one ordinary booking per week. */
async function createEnrollmentBookings(
  tx: Tx,
  organizationId: string,
  enrollmentId: string,
  customerId: string,
  sessions: LockedSeriesSession[],
  seats: number,
  source: string,
) {
  for (const session of sessions) {
    await tx.booking.create({
      data: {
        organizationId,
        customerId,
        serviceTypeId: session.service_type_id,
        sessionId: session.id,
        enrollmentId,
        locationId: session.location_id,
        startsAt: session.starts_at,
        endsAt: session.ends_at,
        timezone: session.timezone,
        seats,
        status: 'CONFIRMED',
        cancelToken: randomBytes(32),
        source,
        // The money is on the enrolment. Splitting it across weeks would
        // invent per-session revenue nobody agreed to.
        totalCents: 0,
      },
    });
  }
}

/**
 * Enrols a customer in a whole cohort.
 *
 * The ordering is the same discipline as `bookSeats`, extended across N rows:
 *
 *   1. Lock EVERY scheduled session in the cohort, ORDER BY series_index.
 *   2. Re-read every seat count under those locks.
 *   3. Decide once, for the whole course.
 *   4. Increment all of them, then write the enrolment and its bookings.
 *
 * Step 1's ordering is not cosmetic. Two enrolments racing on the same cohort
 * take the same locks; without a deterministic order one could hold week 1 and
 * want week 2 while the other holds week 2 and wants week 1, and Postgres
 * would break the tie by killing one with a deadlock. `ORDER BY series_index`
 * inside `FOR UPDATE` makes every writer queue in the same sequence, so the
 * second simply waits.
 *
 * Step 3 is what makes the course a single product. A cohort with one seat
 * left in week four is full, even though five of its six weeks have space.
 * Selling five-sixths of a course is not a thing a studio can honour.
 */
export async function enrollInSeries(input: EnrollInput) {
  const seats = input.seats ?? 1;
  if (seats < 1) throw AppError.badRequest('Seats must be at least 1.');

  try {
    return await prisma.$transaction(async (tx: Tx) => {
      const series = await tx.courseSeries.findFirst({
        where: { id: input.courseSeriesId, organizationId: input.organizationId },
      });
      if (!series) throw AppError.notFound('Course series not found.');

      const sessions = await lockSeriesSessions(
        tx,
        input.organizationId,
        series.id,
      );

      const { joinedLate } = assertSeriesEnrollable(series, sessions, seats, {
        overrideWindow: input.overrideWindow,
      });

      const enrollment = await tx.enrollment.create({
        data: {
          organizationId: input.organizationId,
          courseSeriesId: series.id,
          customerId: input.customerId,
          seats,
          status: 'ACTIVE',
          totalCents: series.priceCents * seats,
          cancelToken: randomBytes(32),
          source: input.source ?? 'web',
          notes: input.notes,
          joinedLate,
        },
      });

      for (const session of sessions) {
        await tx.$executeRaw`
          UPDATE sessions
          SET seats_taken = seats_taken + ${seats}, updated_at = now()
          WHERE id = ${session.id}::uuid
        `;
      }

      await createEnrollmentBookings(
        tx,
        input.organizationId,
        enrollment.id,
        input.customerId,
        sessions,
        seats,
        input.source ?? 'web',
      );

      return { enrollment, sessionCount: sessions.length };
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (isDuplicateEnrollment(err)) {
      throw new AppError(
        'This customer is already enrolled on this course.',
        409,
        BookingErrorCode.ALREADY_ENROLLED,
      );
    }
    translateSchedulingError(err);
  }
}

const ACTIVE_ENROLLMENT_INDEX = 'enrollments_active_per_customer';
const ACTIVE_ENROLLMENT_COLUMNS = ['course_series_id', 'customer_id'];

/**
 * Recognises the partial unique index rejecting a second active enrolment.
 *
 * Prisma raises P2002 and reports the COLUMNS in `meta.target`, not the index
 * name — it resolves the index back to its columns, so
 * `enrollments_active_per_customer` never appears anywhere in the error. The
 * column pair is therefore the only signal available from the Prisma path.
 * Raw-SQL writes fail differently, as SQLSTATE 23505 carrying the constraint
 * name, so both are checked.
 */
function isDuplicateEnrollment(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  const e = err as { code?: unknown; meta?: { target?: unknown }; message?: unknown };
  const target = e.meta?.target;

  if (e.code === 'P2002' && Array.isArray(target)) {
    const columns = target.map(String);
    if (ACTIVE_ENROLLMENT_COLUMNS.every((c) => columns.includes(c))) return true;
  }

  const message = typeof e.message === 'string' ? e.message : '';
  return message.includes(ACTIVE_ENROLLMENT_INDEX);
}

// ---------------------------------------------------------------------------
// Paid enrolment: hold, then convert
// ---------------------------------------------------------------------------

export type CreateSeriesHoldInput = {
  organizationId: string;
  courseSeriesId: string;
  customerId?: string;
  seats?: number;
  ttlMinutes?: number;
};

/**
 * Reserves a place on a whole cohort while the customer is inside checkout.
 *
 * ONE hold row, holding a seat in EVERY week. The alternative — a hold per
 * session — is worse in a way that only shows up under load: the expiry sweep
 * works per row, so it could release week three while weeks one and two stayed
 * held, and the customer would come back from Stripe having paid for a course
 * they can no longer be enrolled on.
 *
 * The seats are counted into `sessions.seats_taken` immediately, exactly as a
 * single-session hold is, so availability and the enrolment path both see them
 * without knowing holds exist.
 */
export async function createSeriesHold(input: CreateSeriesHoldInput) {
  const seats = input.seats ?? 1;
  if (seats < 1) throw AppError.badRequest('Seats must be at least 1.');

  const ttl = input.ttlMinutes ?? config.BOOKING_HOLD_TTL_MINUTES;

  try {
    return await prisma.$transaction(async (tx: Tx) => {
      const series = await tx.courseSeries.findFirst({
        where: { id: input.courseSeriesId, organizationId: input.organizationId },
      });
      if (!series) throw AppError.notFound('Course series not found.');

      const sessions = await lockSeriesSessions(
        tx,
        input.organizationId,
        series.id,
      );

      assertSeriesEnrollable(series, sessions, seats);

      for (const session of sessions) {
        await tx.$executeRaw`
          UPDATE sessions
          SET seats_taken = seats_taken + ${seats}, updated_at = now()
          WHERE id = ${session.id}::uuid
        `;
      }

      return tx.bookingHold.create({
        data: {
          organizationId: input.organizationId,
          courseSeriesId: series.id,
          customerId: input.customerId ?? null,
          seats,
          // The span of the whole course, so an admin looking at open holds
          // sees what is actually reserved.
          startsAt: sessions[0]!.starts_at,
          endsAt: sessions[sessions.length - 1]!.ends_at,
          expiresAt: new Date(Date.now() + ttl * 60_000),
        },
      });
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof AppError) throw err;
    translateSchedulingError(err);
  }
}

export type ConvertSeriesHoldInput = {
  organizationId: string;
  holdId: string;
  customerId: string;
  totalCents: number;
  source?: string;
  notes?: string;
};

/**
 * Turns a paid course hold into an enrolment.
 *
 * The seats are ALREADY counted — the hold owns them — so nothing here
 * increments `seats_taken`. This transfers ownership. Incrementing again would
 * silently shrink every week of the course by the size of the enrolment, and
 * it would not surface until the class filled early.
 *
 * Idempotent by way of the hold's `released_at`: Stripe does not promise
 * single delivery, so a replayed `checkout.session.completed` must find the
 * hold already spent and return the existing enrolment rather than creating a
 * second one.
 */
export async function convertSeriesHold(input: ConvertSeriesHoldInput) {
  return prisma.$transaction(async (tx: Tx) => {
    const rows = await tx.$queryRaw<
      {
        id: string;
        course_series_id: string | null;
        seats: number;
        expires_at: Date;
        released_at: Date | null;
      }[]
    >`
      SELECT id, course_series_id, seats, expires_at, released_at
      FROM booking_holds
      WHERE id = ${input.holdId}::uuid
        AND organization_id = ${input.organizationId}::uuid
      FOR UPDATE
    `;

    const hold = rows[0];
    if (!hold) throw AppError.notFound('Hold not found.');
    if (!hold.course_series_id) {
      throw AppError.badRequest('Hold is not attached to a course.');
    }

    if (hold.released_at) {
      /**
       * Already converted, or swept. A redelivered webhook lands here, and the
       * right answer is the enrolment we made the first time — not an error,
       * and emphatically not a second enrolment charged once.
       *
       * A swept hold has no enrolment, and that IS an error: the seats went
       * back to the pool while the customer was paying.
       */
      const existing = await tx.enrollment.findFirst({
        where: {
          organizationId: input.organizationId,
          courseSeriesId: hold.course_series_id,
          customerId: input.customerId,
          status: 'ACTIVE',
        },
      });

      if (existing) {
        const bookingCount = await tx.booking.count({
          where: { enrollmentId: existing.id },
        });
        return { enrollment: existing, sessionCount: bookingCount, replayed: true };
      }

      throw new AppError(
        'Your reservation expired before payment completed.',
        409,
        BookingErrorCode.HOLD_EXPIRED,
      );
    }

    const series = await tx.courseSeries.findUniqueOrThrow({
      where: { id: hold.course_series_id },
    });

    const sessions = await lockSeriesSessions(
      tx,
      input.organizationId,
      series.id,
    );

    if (sessions.length === 0) {
      throw new AppError(
        'This course no longer has scheduled sessions.',
        409,
        BookingErrorCode.COURSE_NOT_ENROLLABLE,
      );
    }

    const enrollment = await tx.enrollment.create({
      data: {
        organizationId: input.organizationId,
        courseSeriesId: series.id,
        customerId: input.customerId,
        seats: hold.seats,
        status: 'ACTIVE',
        totalCents: input.totalCents,
        cancelToken: randomBytes(32),
        source: input.source ?? 'web',
        notes: input.notes,
        joinedLate: sessions[0]!.starts_at <= new Date(),
      },
    });

    await createEnrollmentBookings(
      tx,
      input.organizationId,
      enrollment.id,
      input.customerId,
      sessions,
      hold.seats,
      input.source ?? 'web',
    );

    await tx.bookingHold.update({
      where: { id: hold.id },
      data: { releasedAt: new Date(), customerId: input.customerId },
    });

    return { enrollment, sessionCount: sessions.length, replayed: false };
  }, TX_OPTIONS);
}

/**
 * Cancels an enrolment and releases the customer's seat in every week.
 *
 * Idempotent, for the same reason `cancelBooking` is: a retried webhook and a
 * double-clicked cancel link must not double-refund seats.
 */
export async function cancelEnrollment(
  organizationId: string,
  enrollmentId: string,
) {
  return prisma.$transaction(async (tx: Tx) => {
    const enrollment = await tx.enrollment.findFirst({
      where: { id: enrollmentId, organizationId },
    });
    if (!enrollment) throw AppError.notFound('Enrolment not found.');
    if (enrollment.status !== 'ACTIVE') return enrollment;

    const bookings = await tx.booking.findMany({
      where: { enrollmentId: enrollment.id, status: { not: 'CANCELLED' } },
      select: { id: true, sessionId: true, seats: true },
      orderBy: { startsAt: 'asc' },
    });

    for (const booking of bookings) {
      if (booking.sessionId) {
        await tx.$queryRaw`
          SELECT id FROM sessions WHERE id = ${booking.sessionId}::uuid FOR UPDATE
        `;
        await tx.$executeRaw`
          UPDATE sessions
          SET seats_taken = GREATEST(0, seats_taken - ${booking.seats}),
              updated_at = now()
          WHERE id = ${booking.sessionId}::uuid
        `;
      }
    }

    const ids = bookings.map((b) => b.id);
    if (ids.length > 0) {
      await tx.staffTimeBlock.deleteMany({ where: { bookingId: { in: ids } } });
      await tx.resourceAllocation.deleteMany({ where: { bookingId: { in: ids } } });
      await tx.booking.updateMany({
        where: { id: { in: ids } },
        data: { status: 'CANCELLED' },
      });
    }

    return tx.enrollment.update({
      where: { id: enrollment.id },
      data: { status: 'CANCELLED' },
    });
  }, TX_OPTIONS);
}

/**
 * Cancels a whole cohort: every session, every enrolment.
 *
 * Refunds are deliberately NOT issued here. Money is a separate decision with
 * its own audit trail, and a studio calling off a course may owe full refunds,
 * partial ones, or credit — that is theirs to choose, not ours to assume.
 */
export async function cancelSeries(organizationId: string, courseSeriesId: string) {
  const series = await prisma.courseSeries.findFirst({
    where: { id: courseSeriesId, organizationId },
    include: { enrollments: { where: { status: 'ACTIVE' }, select: { id: true } } },
  });
  if (!series) throw AppError.notFound('Course series not found.');

  for (const enrollment of series.enrollments) {
    await cancelEnrollment(organizationId, enrollment.id);
  }

  return prisma.$transaction(async (tx: Tx) => {
    const sessionIds = (
      await tx.session.findMany({
        where: { courseSeriesId: series.id },
        select: { id: true },
      })
    ).map((s) => s.id);

    if (sessionIds.length > 0) {
      await tx.staffTimeBlock.deleteMany({
        where: { sessionId: { in: sessionIds } },
      });
      await tx.resourceAllocation.deleteMany({
        where: { sessionId: { in: sessionIds } },
      });
      await tx.session.updateMany({
        where: { id: { in: sessionIds } },
        data: { status: 'CANCELLED' },
      });
    }

    return tx.courseSeries.update({
      where: { id: series.id },
      data: { status: 'CANCELLED' },
    });
  }, TX_OPTIONS);
}
