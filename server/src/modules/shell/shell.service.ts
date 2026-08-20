import { DateTime } from 'luxon';
import { prisma } from '../../lib/prisma';

/**
 * What the app shell needs on every page: a few counts and anything wrong.
 *
 * Deliberately its own endpoint rather than reusing `/bookings/today`. That one
 * loads every booking for the day with five relations attached, because it
 * renders a schedule. The shell needs numbers. Calling it from a persistent
 * chrome element would run that query on every navigation to display two badges
 * — the classic way a sidebar becomes the most expensive thing on the page.
 *
 * Everything here is a COUNT or a boolean, so it stays cheap enough to sit in
 * the shell and be refreshed without thinking about it.
 */

export type ShellAlert = {
  /** Stable key, so the client can decide what to link to without parsing prose. */
  id: 'payments' | 'notifications' | 'calendars';
  level: 'warn' | 'danger';
  message: string;
};

export async function getSummary(organizationId: string, now = new Date()) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true, stripeChargesEnabled: true },
  });

  // The studio's day, not UTC's and not the viewer's — same rule as getToday.
  const local = DateTime.fromJSDate(now, { zone: org.timezone });
  const dayStart = local.startOf('day').toJSDate();
  const dayEnd = local.endOf('day').toJSDate();

  const [todayCount, pendingBookings, failedNotifications, calendarsNeedingReauth] =
    await Promise.all([
      prisma.booking.count({
        where: {
          organizationId,
          startsAt: { gte: dayStart, lte: dayEnd },
          status: { in: ['PENDING', 'CONFIRMED', 'ATTENDED'] },
        },
      }),

      /*
        Pending bookings still AHEAD of us.

        A badge is a call to action, so it must only count things somebody can
        still act on. Counting every PENDING row ever written would produce a
        number that only grows — abandoned checkouts from last year sitting
        permanently next to "Bookings" — and a badge that never reaches zero is
        one people stop seeing within a week.
      */
      prisma.booking.count({
        where: {
          organizationId,
          status: 'PENDING',
          startsAt: { gte: dayStart },
        },
      }),

      // Plumbing failures the studio would otherwise never learn about.
      prisma.notification.count({ where: { organizationId, status: 'FAILED' } }),

      prisma.calendarConnection.count({
        where: { organizationId, status: 'NEEDS_REAUTH' },
      }),
    ]);

  const alerts: ShellAlert[] = [];

  if (!org.stripeChargesEnabled) {
    alerts.push({
      id: 'payments',
      level: 'warn',
      message: 'You cannot take payments yet — finish connecting Stripe.',
    });
  }

  if (failedNotifications > 0) {
    alerts.push({
      id: 'notifications',
      level: 'danger',
      /*
        Worded as what it means to the studio, not as what the row says. "3
        notifications failed" is a status; "3 customers were not told" is the
        consequence, and it is the consequence that decides whether somebody
        picks up the phone.
      */
      message:
        failedNotifications === 1
          ? '1 customer was not sent their confirmation or reminder.'
          : `${failedNotifications} customers were not sent a confirmation or reminder.`,
    });
  }

  if (calendarsNeedingReauth > 0) {
    alerts.push({
      id: 'calendars',
      level: 'warn',
      message:
        calendarsNeedingReauth === 1
          ? 'A calendar connection expired — classes are not syncing.'
          : `${calendarsNeedingReauth} calendar connections expired — classes are not syncing.`,
    });
  }

  return {
    counts: { today: todayCount, pendingBookings },
    alerts,
  };
}

/**
 * Global search.
 *
 * One request across the three things an owner looks for by name, rather than
 * the client fanning out to `/customers?search=`, `/bookings?search=` and the
 * services list on every keystroke. Three requests per keystroke is three times
 * the chance of them landing out of order, and the client would then have to
 * decide which of three in-flight responses is still current.
 *
 * Every group is capped hard. This is a jump-to, not a report: somebody typing
 * a name wants the row they are thinking of, and a list long enough to scroll
 * means they should have gone to the page that filters properly.
 */
export async function search(organizationId: string, q: string) {
  const term = q.trim();

  /*
    A single character matches most of the table and tells nobody anything, so
    the floor is two. Returning empty rather than erroring: this runs while
    somebody is still typing, and the first keystroke is not a mistake.
  */
  if (term.length < 2) {
    return { customers: [], bookings: [], classes: [] };
  }

  const like = { contains: term, mode: 'insensitive' as const };

  const [customers, bookings, classes] = await Promise.all([
    prisma.customer.findMany({
      where: {
        organizationId,
        OR: [{ name: like }, { email: like }, { phone: { contains: term } }],
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
      take: 5,
    }),

    /*
      Bookings are matched through the CUSTOMER, because that is what a person
      searching for a booking actually types — a name, not a uuid. Restricted to
      what is still ahead: "find Jane's booking" means the one she is coming to,
      and her four from last spring are noise ranked above it.
    */
    prisma.booking.findMany({
      where: {
        organizationId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startsAt: { gte: new Date() },
        customer: { is: { OR: [{ name: like }, { email: like }] } },
      },
      select: {
        id: true,
        startsAt: true,
        status: true,
        customer: { select: { id: true, name: true } },
        serviceType: { select: { name: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 5,
    }),

    prisma.serviceType.findMany({
      where: { organizationId, isActive: true, name: like },
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
      take: 5,
    }),
  ]);

  return {
    customers,
    bookings: bookings.map((booking) => ({
      id: booking.id,
      startsAt: booking.startsAt,
      status: booking.status,
      customerId: booking.customer.id,
      customerName: booking.customer.name,
      className: booking.serviceType.name,
    })),
    classes,
  };
}
