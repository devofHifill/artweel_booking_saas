import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { AppError, BookingErrorCode } from '../../src/lib/app-error';
import { bookSeats } from '../../src/scheduling/booking.service';
import {
  cancelEnrollment,
  enrollInSeries,
  generateSeriesSessions,
} from '../../src/scheduling/series.service';
import {
  createCohort,
  createCustomer,
  createCustomers,
  createStudio,
  resetDb,
  type StudioFixture,
} from '../helpers/fixtures';

/**
 * PHASE 2, W2.1 — course enrolment under contention.
 *
 * A course is sold as one thing, so its seat arithmetic spans N rows rather
 * than one. That makes two failure modes possible that a single-session
 * booking simply cannot have:
 *
 *   PARTIAL ENROLMENT — a student ends up in five of six weeks. Worse than a
 *   clean rejection, because it is invisible until week four.
 *
 *   DEADLOCK — two enrolments grab the same weeks in opposite orders and
 *   Postgres kills one. Correct, but it turns a queueing problem into a
 *   user-visible error, so the lock order must make it impossible.
 *
 * Everything below exists to pin those two down.
 */

let studio: StudioFixture;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  studio = await createStudio();
});

/**
 * The Tuesday a fortnight out, computed once when this file loads.
 *
 * This used to be the literal '2026-09-01', which stopped being in the future
 * on 2026-09-02 and took six tests with it: a cohort that has already begun
 * answers COURSE_ALREADY_STARTED, so every enrolment case below failed on a
 * date rather than on a defect. The sister file in tests/public had the same
 * bug on the same day.
 *
 * Computed ONCE at module load rather than per test, so a suite running across
 * midnight cannot have two tests disagree about which Tuesday they meant.
 *
 * Date-only arithmetic, so UTC is safe here — no daylight saving applies to
 * counting calendar days, and the generator resolves the wall-clock time
 * against the studio's zone from this local date.
 */
const COURSE_START = (() => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 14);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1); // 2 = Tuesday
  return d.toISOString().slice(0, 10);
})();

/** The local dates a weekly course starting on `from` actually lands on. */
function weeklyFrom(from: string, count: number): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

/** 19:00 in the studio's zone on a given local date, as a real instant. */
async function sevenPmOn(localDate: string): Promise<Date> {
  const { DateTime } = await import('luxon');
  return DateTime.fromISO(`${localDate}T19:00`, {
    zone: 'America/New_York',
  }).toJSDate();
}

/** Six Tuesdays at 19:00 New York, starting a fortnight from today. */
async function sixTuesdays(opts?: Parameters<typeof createCohort>[1]) {
  const { series, serviceType } = await createCohort(studio, opts);
  const sessions = await generateSeriesSessions({
    organizationId: studio.organization.id,
    courseSeriesId: series.id,
    rrule: 'FREQ=WEEKLY;BYDAY=TU',
    startLocalDate: COURSE_START,
    localStartTime: '19:00',
  });
  return { series, serviceType, sessions };
}

describe('course session generation', () => {
  it('produces exactly the requested number of dated sessions', async () => {
    const { series, sessions } = await sixTuesdays();

    expect(sessions).toHaveLength(6);
    expect(sessions.map((s) => s.seriesIndex)).toEqual([1, 2, 3, 4, 5, 6]);
    // Derived from the same start the generator was given, so the assertion
    // moves with it instead of being a second place to update.
    expect(sessions.map((s) => s.localDate)).toEqual(weeklyFrom(COURSE_START, 6));

    const stored = await prisma.session.findMany({
      where: { courseSeriesId: series.id },
    });
    expect(stored).toHaveLength(6);
    expect(stored.every((s) => s.capacity === 8)).toBe(true);
  });

  it('makes the instructor genuinely busy for every week', async () => {
    const { sessions } = await sixTuesdays();

    const blocks = await prisma.staffTimeBlock.count({
      where: { staffId: studio.staff.id },
    });
    expect(blocks).toBe(6);

    // The point of those blocks: a private lesson in week three now collides.
    const week3 = sessions[2]!;
    const { bookAppointment } = await import(
      '../../src/scheduling/booking.service'
    );
    const customer = await createCustomer(studio.organization.id);

    await expect(
      bookAppointment({
        organizationId: studio.organization.id,
        staffId: studio.staff.id,
        serviceTypeId: studio.serviceType.id,
        customerId: customer.id,
        startsAt: week3.startsAt,
        endsAt: new Date(week3.startsAt.getTime() + 60 * 60_000),
        timezone: studio.timezone,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.STAFF_UNAVAILABLE });
  });

  /**
   * The DST case, and the reason recurrence expands to DATES rather than
   * instants. 2026-11-01 is when the US falls back, so a Tuesday course
   * running late October into November straddles it.
   *
   * THESE DATES STAY LITERAL. Everything else in this file was moved to a
   * relative start after 2026-09-01 expired and broke six tests — do not do
   * the same here. The whole assertion is that these particular weeks sit
   * either side of a real transition; a floating start would drift off it and
   * leave a test that passes while proving nothing.
   *
   * It does not rot the way the others did, because generating sessions in the
   * past is allowed — only ENROLLING in a started cohort is refused, and this
   * case never enrols.
   */
  it('keeps a 19:00 class at 19:00 across a daylight-saving transition', async () => {
    const { series } = await createCohort(studio, { sessionCount: 4 });

    const sessions = await generateSeriesSessions({
      organizationId: studio.organization.id,
      courseSeriesId: series.id,
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      startLocalDate: '2026-10-20',
      localStartTime: '19:00',
    });

    expect(sessions.map((s) => s.localDate)).toEqual([
      '2026-10-20',
      '2026-10-27',
      '2026-11-03',
      '2026-11-10',
    ]);

    const { DateTime } = await import('luxon');
    for (const session of sessions) {
      const local = DateTime.fromJSDate(session.startsAt, {
        zone: 'America/New_York',
      });
      expect(local.toFormat('HH:mm')).toBe('19:00');
    }

    // And the UTC instants MUST differ by an hour either side of the
    // transition. If they didn't, the wall-clock time would have drifted.
    const beforeUtc = sessions[1]!.startsAt.getUTCHours(); // EDT, UTC-4 -> 23
    const afterUtc = sessions[2]!.startsAt.getUTCHours(); // EST, UTC-5 -> 00
    expect(beforeUtc).toBe(23);
    expect(afterUtc).toBe(0);
  });

  it('refuses a recurrence rule that sets its own COUNT', async () => {
    const { series } = await createCohort(studio);

    await expect(
      generateSeriesSessions({
        organizationId: studio.organization.id,
        courseSeriesId: series.id,
        rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3',
        startLocalDate: COURSE_START,
        localStartTime: '19:00',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rolls back every session when one week collides with the instructor', async () => {
    // Book the instructor solid on what would be week three.
    const customer = await createCustomer(studio.organization.id);
    const { bookAppointment } = await import(
      '../../src/scheduling/booking.service'
    );

    /*
      Resolved through luxon rather than written as a UTC literal. 19:00 in New
      York is 23:00Z in summer and 00:00Z the next day once the clocks go back,
      so a hardcoded instant only collides with week three for part of the year
      — and this test would then pass while asserting nothing.
    */
    const weekThree = weeklyFrom(COURSE_START, 3)[2]!;
    const startsAt = await sevenPmOn(weekThree);

    await bookAppointment({
      organizationId: studio.organization.id,
      staffId: studio.staff.id,
      serviceTypeId: studio.serviceType.id,
      customerId: customer.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60_000),
      timezone: studio.timezone,
    });

    const { series } = await createCohort(studio);

    await expect(
      generateSeriesSessions({
        organizationId: studio.organization.id,
        courseSeriesId: series.id,
        rrule: 'FREQ=WEEKLY;BYDAY=TU',
        startLocalDate: COURSE_START,
        localStartTime: '19:00',
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.STAFF_UNAVAILABLE });

    // Weeks one and two must NOT survive. A cohort with a hole in it is worse
    // than no cohort.
    const orphans = await prisma.session.count({
      where: { courseSeriesId: series.id },
    });
    expect(orphans).toBe(0);
  });
});

describe('course enrolment', () => {
  it('puts the student in every week, in one enrolment', async () => {
    const { series } = await sixTuesdays();
    const customer = await createCustomer(studio.organization.id);

    const result = await enrollInSeries({
      organizationId: studio.organization.id,
      courseSeriesId: series.id,
      customerId: customer.id,
    });

    expect(result!.sessionCount).toBe(6);

    const bookings = await prisma.booking.findMany({
      where: { enrollmentId: result!.enrollment.id },
      orderBy: { startsAt: 'asc' },
    });
    expect(bookings).toHaveLength(6);
    expect(bookings.every((b) => b.status === 'CONFIRMED')).toBe(true);

    // The money is on the enrolment, not smeared across the weeks.
    expect(result!.enrollment.totalCents).toBe(45000);
    expect(bookings.every((b) => b.totalCents === 0)).toBe(true);

    const sessions = await prisma.session.findMany({
      where: { courseSeriesId: series.id },
    });
    expect(sessions.every((s) => s.seatsTaken === 1)).toBe(true);
  });

  /**
   * THE GATE. A course whose week three is nearly full must sell only as many
   * places as week three can take — and every student who fails must fail
   * cleanly, with nobody half-enrolled.
   */
  it('never partially enrols, and is limited by its tightest week', async () => {
    const { series, sessions } = await sixTuesdays({ capacity: 8 });

    // A drop-in student already took 7 of the 8 seats in week three, so the
    // course as a whole has exactly one place left.
    const dropIn = await createCustomer(studio.organization.id, 'dropin');
    await bookSeats({
      organizationId: studio.organization.id,
      sessionId: sessions[2]!.id,
      customerId: dropIn.id,
      seats: 7,
    });

    const customers = await createCustomers(studio.organization.id, 20);

    const results = await Promise.allSettled(
      customers.map((customer) =>
        enrollInSeries({
          organizationId: studio.organization.id,
          courseSeriesId: series.id,
          customerId: customer.id,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(19);

    // Every loser fails for a stated reason — and NOT with a deadlock, which
    // is what a careless lock order would produce here.
    for (const r of rejected) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(AppError);
      expect(reason.statusCode).toBe(409);
      expect(reason.code).toBe(BookingErrorCode.COURSE_FULL);
    }

    // No week is oversold.
    const after = await prisma.session.findMany({
      where: { courseSeriesId: series.id },
      orderBy: { seriesIndex: 'asc' },
    });
    for (const session of after) {
      expect(session.seatsTaken).toBeLessThanOrEqual(session.capacity);
    }
    expect(after[2]!.seatsTaken).toBe(8); // 7 drop-in + 1 enrolled

    // And the decisive assertion: every surviving enrolment is COMPLETE.
    const enrollments = await prisma.enrollment.findMany({
      where: { courseSeriesId: series.id, status: 'ACTIVE' },
      include: { _count: { select: { bookings: true } } },
    });
    expect(enrollments).toHaveLength(1);
    for (const enrollment of enrollments) {
      expect(enrollment._count.bookings).toBe(6);
    }
  });

  it('frees a seat in every week when an enrolment is cancelled', async () => {
    const { series } = await sixTuesdays({ capacity: 1 });
    const first = await createCustomer(studio.organization.id, 'first');
    const second = await createCustomer(studio.organization.id, 'second');

    const enrolled = await enrollInSeries({
      organizationId: studio.organization.id,
      courseSeriesId: series.id,
      customerId: first.id,
    });

    await expect(
      enrollInSeries({
        organizationId: studio.organization.id,
        courseSeriesId: series.id,
        customerId: second.id,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.COURSE_FULL });

    await cancelEnrollment(studio.organization.id, enrolled!.enrollment.id);

    const freed = await prisma.session.findMany({
      where: { courseSeriesId: series.id },
    });
    expect(freed.every((s) => s.seatsTaken === 0)).toBe(true);

    await expect(
      enrollInSeries({
        organizationId: studio.organization.id,
        courseSeriesId: series.id,
        customerId: second.id,
      }),
    ).resolves.toBeTruthy();
  });

  it('is idempotent when an enrolment is cancelled twice', async () => {
    const { series } = await sixTuesdays();
    const customer = await createCustomer(studio.organization.id);

    const enrolled = await enrollInSeries({
      organizationId: studio.organization.id,
      courseSeriesId: series.id,
      customerId: customer.id,
    });

    await cancelEnrollment(studio.organization.id, enrolled!.enrollment.id);
    await cancelEnrollment(studio.organization.id, enrolled!.enrollment.id);

    const sessions = await prisma.session.findMany({
      where: { courseSeriesId: series.id },
    });
    // GREATEST(0, ...) would hide a double decrement here; the released-once
    // guard is what actually prevents it.
    expect(sessions.every((s) => s.seatsTaken === 0)).toBe(true);
  });

  it('refuses a second active enrolment but allows rejoining after cancelling', async () => {
    const { series } = await sixTuesdays();
    const customer = await createCustomer(studio.organization.id);

    const first = await enrollInSeries({
      organizationId: studio.organization.id,
      courseSeriesId: series.id,
      customerId: customer.id,
    });

    await expect(
      enrollInSeries({
        organizationId: studio.organization.id,
        courseSeriesId: series.id,
        customerId: customer.id,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.ALREADY_ENROLLED });

    await cancelEnrollment(studio.organization.id, first!.enrollment.id);

    // The partial index only covers ACTIVE rows, so a student who cancelled by
    // mistake is not locked out of their own course.
    await expect(
      enrollInSeries({
        organizationId: studio.organization.id,
        courseSeriesId: series.id,
        customerId: customer.id,
      }),
    ).resolves.toBeTruthy();
  });

  it('refuses enrolment once the course has started', async () => {
    const { series } = await createCohort(studio, { sessionCount: 3 });
    await generateSeriesSessions({
      organizationId: studio.organization.id,
      courseSeriesId: series.id,
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      startLocalDate: '2020-01-07',
      localStartTime: '19:00',
    });

    const customer = await createCustomer(studio.organization.id);

    await expect(
      enrollInSeries({
        organizationId: studio.organization.id,
        courseSeriesId: series.id,
        customerId: customer.id,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.COURSE_ALREADY_STARTED });
  });

  it('allows late enrolment on a cohort that permits it, and records it', async () => {
    const { series } = await createCohort(studio, {
      sessionCount: 3,
      allowLateEnrollment: true,
    });
    await generateSeriesSessions({
      organizationId: studio.organization.id,
      courseSeriesId: series.id,
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      startLocalDate: '2020-01-07',
      localStartTime: '19:00',
    });

    const customer = await createCustomer(studio.organization.id);
    const result = await enrollInSeries({
      organizationId: studio.organization.id,
      courseSeriesId: series.id,
      customerId: customer.id,
    });

    expect(result!.enrollment.joinedLate).toBe(true);
  });

  it('refuses to enrol in a cohort that is not on sale', async () => {
    const { series } = await sixTuesdays();
    await prisma.courseSeries.update({
      where: { id: series.id },
      data: { status: 'DRAFT' },
    });

    const customer = await createCustomer(studio.organization.id);

    await expect(
      enrollInSeries({
        organizationId: studio.organization.id,
        courseSeriesId: series.id,
        customerId: customer.id,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.COURSE_NOT_ENROLLABLE });
  });

  it('refuses once the enrolment window has closed', async () => {
    const { series } = await sixTuesdays();
    await prisma.courseSeries.update({
      where: { id: series.id },
      data: { enrollmentClosesAt: new Date('2020-01-01T00:00:00Z') },
    });

    const customer = await createCustomer(studio.organization.id);

    await expect(
      enrollInSeries({
        organizationId: studio.organization.id,
        courseSeriesId: series.id,
        customerId: customer.id,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.COURSE_NOT_ENROLLABLE });
  });
});
