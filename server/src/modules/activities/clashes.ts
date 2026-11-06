import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * What already happens at the times a Class or Event wants
 * (CLASS-EVENT-PLAN.md, Stage 4).
 *
 * Used twice, with the same answer both times: by the preview, so the Schedule
 * step can show "Tue 17 Mar — Maya is teaching Wheel Basics 6–8pm" beside the
 * date while the studio is still choosing, and by publishing, which refuses
 * while any clash remains.
 *
 * Two kinds:
 *
 *   STAFF     the instructor already has time blocked — a class, a lesson, or
 *             time off. Postgres enforces this anyway (the exclusion constraint
 *             on staff_time_blocks); checking first is what lets the studio be
 *             told WHICH date and what is there, instead of "a conflict".
 *
 *   LOCATION  something else is on at a location that runs one thing at a
 *             time (`Location.oneAtATime`). A whole studio with several wheels
 *             and a glaze room runs things side by side, so this is opt-in.
 *
 * Equipment (more seats than wheels) is not checked: the Class and Event steps
 * do not ask which equipment an activity uses, so there is nothing to compare.
 */

export type ClashKind = 'STAFF' | 'LOCATION';
export type Clash = { kind: ClashKind; message: string };

export type PlannedDate = { localDate: string; startsAt: Date; endsAt: Date };

type Db = PrismaClient | Prisma.TransactionClient;

function clock(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  })
    .format(date)
    .replace(':00', '')
    .replace(' ', '')
    .toLowerCase();
}

/** "6–8pm", or "11am–1pm" when the two halves of the day differ. */
function span(start: Date, end: Date, timezone: string): string {
  const from = clock(start, timezone);
  const to = clock(end, timezone);
  const shared = from.slice(-2) === to.slice(-2);
  return `${shared ? from.slice(0, -2) : from}–${to}`;
}

const overlaps = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/**
 * Every clash on every date, keyed by local date. Dates with none are absent.
 *
 * Two queries whatever the number of dates — one for the instructor's blocks
 * and one for the location — bounded by the first start and last end, then
 * matched per date here.
 */
export async function findClashes(
  db: Db,
  organizationId: string,
  timezone: string,
  dates: PlannedDate[],
  where: { staffId?: string | null; locationId?: string | null },
): Promise<Map<string, Clash[]>> {
  const result = new Map<string, Clash[]>();
  if (dates.length === 0) return result;

  const from = new Date(Math.min(...dates.map((d) => d.startsAt.getTime())));
  const to = new Date(Math.max(...dates.map((d) => d.endsAt.getTime())));
  const add = (localDate: string, clash: Clash) =>
    result.set(localDate, [...(result.get(localDate) ?? []), clash]);

  if (where.staffId) {
    const staff = await db.staff.findFirst({
      where: { id: where.staffId, organizationId },
      select: { name: true },
    });
    const blocks = await db.staffTimeBlock.findMany({
      where: {
        organizationId,
        staffId: where.staffId,
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
      select: {
        startsAt: true,
        endsAt: true,
        session: {
          select: { startsAt: true, endsAt: true, serviceType: { select: { name: true } } },
        },
        booking: {
          select: { startsAt: true, endsAt: true, serviceType: { select: { name: true } } },
        },
      },
    });

    const who = staff?.name ?? 'The instructor';
    for (const date of dates) {
      for (const block of blocks.filter((b) => overlaps(b, date))) {
        // The block itself is widened by padding; report the class's own times.
        const what = block.session ?? block.booking;
        add(date.localDate, {
          kind: 'STAFF',
          message: what
            ? `${who} is teaching ${what.serviceType.name} ${span(what.startsAt, what.endsAt, timezone)}`
            : `${who} is away ${span(block.startsAt, block.endsAt, timezone)}`,
        });
      }
    }
  }

  if (where.locationId) {
    const location = await db.location.findFirst({
      where: { id: where.locationId, organizationId },
      select: { name: true, oneAtATime: true },
    });

    if (location?.oneAtATime) {
      const [sessions, lessons] = await Promise.all([
        db.session.findMany({
          where: {
            organizationId,
            locationId: where.locationId,
            status: { not: 'CANCELLED' },
            startsAt: { lt: to },
            endsAt: { gt: from },
          },
          select: { startsAt: true, endsAt: true, serviceType: { select: { name: true } } },
        }),
        // A private lesson is a booking with no session of its own.
        db.booking.findMany({
          where: {
            organizationId,
            locationId: where.locationId,
            sessionId: null,
            status: { not: 'CANCELLED' },
            startsAt: { lt: to },
            endsAt: { gt: from },
          },
          select: { startsAt: true, endsAt: true, serviceType: { select: { name: true } } },
        }),
      ]);

      for (const date of dates) {
        for (const other of [...sessions, ...lessons].filter((s) => overlaps(s, date))) {
          add(date.localDate, {
            kind: 'LOCATION',
            message: `${location.name} has ${other.serviceType.name} ${span(other.startsAt, other.endsAt, timezone)}`,
          });
        }
      }
    }
  }

  return result;
}

/** "Tue 17 Mar" for a local date, for messages that name the date. */
export function dayLabel(localDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${localDate}T00:00:00Z`));
}
