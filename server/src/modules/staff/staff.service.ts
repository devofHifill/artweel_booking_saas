import type { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { requireCapacity, type PlanId } from '../billing/plan';

/**
 * Staff administration.
 *
 * A staff record is not a login. It is the schedulable *person* — the thing
 * availability rules, time blocks and bookings point at. Linking it to a User
 * account is optional and separate, because studios routinely list an
 * instructor long before that instructor ever signs in, and freelancers get
 * listed at several studios.
 */

/**
 * Whether this person can be booked, and if not, why not.
 *
 * DERIVED, never stored. The prototype carries a hand-set Available / On
 * Leave / Part-time field, and a stored one here would be free to contradict
 * the availability engine — a guide badged "Available" who cannot take a
 * booking, with nothing on screen explaining the difference.
 *
 * NO_HOURS is the one worth having built this. A staff member with no working
 * rules is PERMANENTLY UNBOOKABLE and nothing said so: the onboarding wizard
 * seeds hours for the first instructor only, so everybody hired afterwards
 * landed in exactly this state, silently. It was found by walking screens
 * rather than by reading code, and this badge is what makes it visible from
 * the list instead of from a customer complaining.
 */
export type StaffAvailability = 'AVAILABLE' | 'AWAY_TODAY' | 'NO_HOURS' | 'INACTIVE';

export async function listStaff(
  organizationId: string,
  opts: { includeInactive?: boolean } = {},
) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });

  /* The studio's today, not the server's. A studio in Los Angeles asking at
     23:00 UTC is asking about a date the server has already left. */
  const today = DateTime.now().setZone(org.timezone).toFormat('yyyy-MM-dd');
  const now = new Date();

  const staff = await prisma.staff.findMany({
    where: {
      organizationId,
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    include: {
      staffServices: {
        include: { serviceType: { select: { id: true, name: true } } },
      },
      staffLocations: {
        include: { location: { select: { id: true, name: true } } },
      },
      /* Counted, not listed. The card needs "does this person have any hours
         at all", and pulling every rule to answer a yes/no would carry a
         studio's entire rota to the browser for a badge. */
      _count: { select: { availabilityRules: { where: { ruleType: 'WORKING' } } } },
      availabilityOverride: {
        where: { localDate: today, overrideType: 'DAY_OFF' },
        select: { id: true, reason: true },
      },
      sessions: {
        where: { status: { not: 'CANCELLED' } },
        select: { id: true, startsAt: true, seatsTaken: true },
      },
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });

  return staff.map((member) => {
    const { sessions, availabilityOverride, _count, ...rest } = member;

    const upcoming = sessions.filter((s) => s.startsAt > now).length;
    const taught = sessions.filter((s) => s.startsAt <= now);

    const availability: StaffAvailability = !member.isActive
      ? 'INACTIVE'
      : availabilityOverride.length > 0
        ? 'AWAY_TODAY'
        : _count.availabilityRules === 0
          ? 'NO_HOURS'
          : 'AVAILABLE';

    return {
      ...rest,
      availability,
      /* The reason the studio typed on the day off, so the card can say
         "Away — holiday" rather than leaving somebody to look it up. */
      awayReason: availabilityOverride[0]?.reason ?? null,
      stats: {
        upcoming,
        classesTaught: taught.length,
        /*
          Seats on classes that have already run. Named "taught" rather than
          "guests" because a customer who books six weeks of a course is one
          person counted six times — which is right for "how much teaching has
          this person done" and wrong for "how many people have they met".
        */
        seatsTaught: taught.reduce((sum, s) => sum + s.seatsTaken, 0),
      },
    };
  });
}

/**
 * What this person is down to teach, from now on.
 *
 * Sessions rather than bookings: the question the Schedule button asks is
 * "where does this instructor have to be", and that is a class whether or not
 * anybody has booked it yet. An empty class still has to be turned up to.
 *
 * Capped, and ordered soonest first. A studio scheduling a term at a time can
 * have hundreds of future sessions per instructor, and nobody reads past the
 * next fortnight in a dialog.
 */
export async function getStaffSchedule(organizationId: string, id: string) {
  const staff = await prisma.staff.findFirst({
    where: { id, organizationId },
    select: { id: true, name: true, email: true },
  });
  if (!staff) throw AppError.notFound('Staff member not found.');

  const sessions = await prisma.session.findMany({
    where: {
      staffId: id,
      organizationId,
      startsAt: { gte: new Date() },
      status: { not: 'CANCELLED' },
    },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      seatsTaken: true,
      status: true,
      serviceType: { select: { id: true, name: true, emoji: true } },
      location: { select: { id: true, name: true } },
    },
    orderBy: { startsAt: 'asc' },
    take: 100,
  });

  return { staff, sessions };
}

export async function getStaff(organizationId: string, id: string) {
  const staff = await prisma.staff.findFirst({
    where: { id, organizationId },
    include: {
      staffServices: { include: { serviceType: true } },
      staffLocations: { include: { location: true } },
      availabilityRules: true,
      availabilityOverride: {
        where: { localDate: { gte: new Date().toISOString().slice(0, 10) } },
        orderBy: { localDate: 'asc' },
      },
    },
  });

  if (!staff) throw AppError.notFound('Staff member not found.');
  return staff;
}

export async function createStaff(
  organizationId: string,
  input: Record<string, unknown>,
) {
  // Checked at creation, not at read: a studio that downgrades keeps the
  // instructors it already has, it just cannot add more. Deactivating
  // somebody's colleagues because a card expired would be indefensible.
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true },
  });
  const activeStaff = await prisma.staff.count({
    where: { organizationId, isActive: true },
  });
  requireCapacity(org.plan as PlanId, 'maxStaff', activeStaff);

  const email = String(input.email).trim().toLowerCase();

  // Composite unique is (organizationId, email): the same freelancer may
  // exist at several studios, but not twice at one.
  const clash = await prisma.staff.findFirst({
    where: { organizationId, email },
  });
  if (clash) {
    throw AppError.conflict(
      'A staff member with that email already exists at this studio.',
      'STAFF_EMAIL_TAKEN',
    );
  }

  return prisma.staff.create({
    data: {
      ...(input as Prisma.StaffUncheckedCreateInput),
      email,
      organizationId,
    },
  });
}

export async function updateStaff(
  organizationId: string,
  id: string,
  input: Record<string, unknown>,
) {
  const existing = await prisma.staff.findFirst({ where: { id, organizationId } });
  if (!existing) throw AppError.notFound('Staff member not found.');

  const data: Prisma.StaffUncheckedUpdateInput = { ...input };

  if (typeof input.email === 'string') {
    const email = input.email.trim().toLowerCase();
    if (email !== existing.email) {
      const clash = await prisma.staff.findFirst({
        where: { organizationId, email, id: { not: id } },
      });
      if (clash) {
        throw AppError.conflict(
          'A staff member with that email already exists at this studio.',
          'STAFF_EMAIL_TAKEN',
        );
      }
    }
    data.email = email;
  }

  /**
   * Deactivating somebody who still has work on the books is refused.
   *
   * Availability would stop offering them immediately while their existing
   * bookings stayed live, so customers would arrive for a lesson with an
   * instructor the system considers gone. Cancel or reassign first.
   */
  if (input.isActive === false && existing.isActive) {
    const upcoming = await prisma.booking.count({
      where: {
        staffId: id,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startsAt: { gte: new Date() },
      },
    });
    const upcomingSessions = await prisma.session.count({
      where: { staffId: id, status: 'SCHEDULED', startsAt: { gte: new Date() } },
    });

    if (upcoming > 0 || upcomingSessions > 0) {
      throw AppError.conflict(
        `This instructor still has ${upcoming + upcomingSessions} upcoming ` +
          'commitments. Reassign or cancel them before deactivating.',
        'STAFF_HAS_UPCOMING',
      );
    }
  }

  return prisma.staff.update({ where: { id }, data });
}

export async function deleteStaff(organizationId: string, id: string) {
  const staff = await prisma.staff.findFirst({ where: { id, organizationId } });
  if (!staff) throw AppError.notFound('Staff member not found.');

  /*
    Three kinds of history, not one.

    This counted `booking.staffId` alone, which is only set for APPOINTMENTS — a
    1:1 lesson hangs off a staff member directly. A class booking hangs off a
    SESSION, and the session is what carries the instructor. So an instructor who
    had taught fifty group classes and never a single private lesson passed this
    check and was hard-deleted.

    What made that quiet rather than loud is the relation: `Session.staff` and
    `CourseSeries.staff` are both `onDelete: SetNull`. Nothing failed. Every
    class they had ever taught simply became a class with no instructor,
    including classes in the past — a register that had been taken now showing
    nobody took it.

    Found when the Staff page shipped and made Remove clickable for the first
    time; before that, nothing in the product could reach this path.
  */
  const [bookings, sessions, courses] = await Promise.all([
    prisma.booking.count({ where: { staffId: id } }),
    prisma.session.count({ where: { staffId: id } }),
    prisma.courseSeries.count({ where: { staffId: id } }),
  ]);

  if (bookings + sessions + courses > 0) {
    throw AppError.conflict(
      'This instructor has teaching history and cannot be deleted. ' +
        'Deactivate them instead so the record is kept.',
      'STAFF_IN_USE',
    );
  }

  await prisma.staff.delete({ where: { id } });
  return { deleted: true };
}

/** Replaces the set of services this person is qualified to deliver. */
export async function setStaffServices(
  organizationId: string,
  staffId: string,
  serviceTypeIds: string[],
) {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, organizationId } });
  if (!staff) throw AppError.notFound('Staff member not found.');

  const owned = await prisma.serviceType.findMany({
    where: { id: { in: serviceTypeIds }, organizationId },
    select: { id: true },
  });
  if (owned.length !== serviceTypeIds.length) {
    throw AppError.badRequest('One or more services were not found.');
  }

  await prisma.$transaction([
    prisma.staffService.deleteMany({ where: { staffId } }),
    prisma.staffService.createMany({
      data: serviceTypeIds.map((serviceTypeId) => ({ staffId, serviceTypeId })),
    }),
  ]);

  return { serviceTypeIds };
}

/** Replaces the set of locations this person works from. */
export async function setStaffLocations(
  organizationId: string,
  staffId: string,
  locationIds: string[],
) {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, organizationId } });
  if (!staff) throw AppError.notFound('Staff member not found.');

  const owned = await prisma.location.findMany({
    where: { id: { in: locationIds }, organizationId },
    select: { id: true },
  });
  if (owned.length !== locationIds.length) {
    throw AppError.badRequest('One or more locations were not found.');
  }

  await prisma.$transaction([
    prisma.staffLocation.deleteMany({ where: { staffId } }),
    prisma.staffLocation.createMany({
      data: locationIds.map((locationId) => ({ staffId, locationId })),
    }),
  ]);

  return { locationIds };
}

/**
 * The rota at a glance — the four figures above the staff list (D6).
 *
 * Its own read rather than fields on `listStaff`, because it answers a
 * different question. The list is "who works here"; this is "is the week
 * covered", which is about SESSIONS and would put three aggregates on every
 * staff row to say one thing about the studio.
 *
 * The window is the next seven days, matching the dashboard's "classes this
 * week" so the two screens cannot report different weeks.
 */
export async function getRotaSummary(organizationId: string, now = new Date()) {
  const timezone = (
    await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timezone: true },
    })
  ).timezone;

  const local = DateTime.fromJSDate(now, { zone: timezone });
  const todayStart = local.startOf('day').toJSDate();
  const todayEnd = local.endOf('day').toJSDate();
  const weekEnd = local.plus({ days: 7 }).endOf('day').toJSDate();

  const [team, teachingToday, assigned, unassigned] = await Promise.all([
    prisma.staff.count({ where: { organizationId, isActive: true } }),

    /**
     * People with a class today — distinct, because someone teaching three
     * classes is one person on duty, not three.
     */
    prisma.session
      .findMany({
        where: {
          organizationId,
          status: 'SCHEDULED',
          staffId: { not: null },
          startsAt: { gte: todayStart, lte: todayEnd },
        },
        select: { staffId: true },
        distinct: ['staffId'],
      })
      .then((rows) => rows.length),

    prisma.session.count({
      where: {
        organizationId,
        status: 'SCHEDULED',
        staffId: { not: null },
        startsAt: { gte: todayStart, lte: weekEnd },
      },
    }),

    /**
     * The number worth acting on. A class with nobody assigned is one nobody
     * has been told to teach, and it is the same signal the dashboard's
     * attention list carries.
     */
    prisma.session.count({
      where: {
        organizationId,
        status: 'SCHEDULED',
        staffId: null,
        startsAt: { gte: todayStart, lte: weekEnd },
      },
    }),
  ]);

  return { team, teachingToday, classesThisWeek: assigned, unassignedThisWeek: unassigned };
}
