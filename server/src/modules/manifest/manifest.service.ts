import { DateTime } from 'luxon';
import { Prisma, type BookingStatus, type PaymentStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/app-error';
import { paidCentsOf } from '../analytics/analytics.service';

/**
 * The daily manifest — the sheet an instructor actually carries.
 *
 * The Register screen this replaces answered one question, one class at a
 * time: who is booked in. That is the right thing on a phone halfway through
 * a session and the wrong thing at 8am, when the person opening the studio
 * wants the whole day on one surface — including the parts that are not a
 * class at all.
 *
 * Three things it does that the register did not:
 *
 * **Appointments are on it.** They hang off a staff member rather than a
 * session, so a studio whose Tuesday is four private lessons had a register
 * that showed nothing and read as broken. The dashboard already learned this;
 * repeating the omission on the sheet somebody carries would be worse.
 *
 * **Balances are on it.** The one question a front desk is asked at the door
 * is "have they paid?", and until now the answer lived on a different screen.
 * The rule comes from `paidCentsOf` so this cannot disagree with the
 * dashboard or the payments list about the same booking.
 *
 * **First visits are flagged.** You greet somebody differently on their first
 * morning, and nothing in the product told an instructor which of the eleven
 * names in front of them had never held clay before.
 */

/** A cancelled seat is not attendance, demand, or a head to count. */
const LIVE_BOOKING_STATUSES: BookingStatus[] = [
  'PENDING',
  'CONFIRMED',
  'ATTENDED',
  'NO_SHOW',
];

/**
 * NO_SHOW is included here and NOT in the analytics list, deliberately.
 *
 * Analytics counts demand, where a no-show is a seat that was sold — it
 * belongs in revenue and not in attendance. A manifest is a record of a day
 * that has happened, and somebody marked absent must stay visible on it:
 * dropping them would make the sheet disagree with itself the moment a mark
 * is saved, and would quietly hide the row an instructor might need to undo.
 */

function dayBoundsFor(localDate: string, timezone: string) {
  const local = DateTime.fromISO(localDate, { zone: timezone });

  if (!local.isValid) {
    throw AppError.badRequest('That is not a real date.', 'BAD_DATE');
  }

  return {
    start: local.startOf('day').toJSDate(),
    end: local.endOf('day').toJSDate(),
  };
}

export type RollEntry = {
  bookingId: string;
  customer: { id: string; name: string; email: string; phone: string | null };
  seats: number;
  status: string;
  /** Distinguishes a course student from a drop-in on the same sheet. */
  viaEnrollment: boolean;
  notes: string | null;
  /** What is still owed on this booking. Zero for anything paid in full. */
  balanceCents: number;
  /** Nobody has taught this person before today. */
  firstVisit: boolean;
  /**
   * Where a TRAVELLING class actually happens — the customer's address, taken
   * at booking time.
   *
   * Per booking rather than per session because that is what it is: a mobile
   * class is one visit to one address, and two bookings on the same mobile
   * service are two different doorsteps. Null for anything at a fixed studio,
   * where the location's own address already answers it once for the whole
   * class instead of repeating down every row.
   */
  serviceAddress: string | null;
};

export type ManifestSession = {
  id: string;
  kind: 'class' | 'appointment';
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  serviceName: string;
  color: string;
  /** `phone` because "who do I call" is the second question this page gets. */
  staff: { id: string; name: string; phone: string | null } | null;
  location: { id: string; name: string; address: string | null } | null;
  course: { id: string; name: string; cohortLabel: string | null } | null;
  seriesIndex: number | null;
  capacity: number;
  seatsTaken: number;
  /** False until the class starts; the UI disables the check-in controls. */
  markable: boolean;
  roll: RollEntry[];
  balanceCents: number;
};

/**
 * Which customers are new today.
 *
 * One grouped query for the whole day rather than a count per booking: a busy
 * Saturday is sixty rolls, and sixty round trips to answer a decoration on a
 * name badge is not a trade worth making.
 *
 * "Before this day" rather than "before this session" on purpose. Somebody
 * booked into a 10am and a 2pm on their first Saturday is new at both — being
 * told they are a returning student four hours later is not useful, and the
 * simpler rule is the one an instructor would give you themselves.
 */
async function firstVisitorsAmong(
  organizationId: string,
  customerIds: string[],
  dayStart: Date,
): Promise<Set<string>> {
  if (customerIds.length === 0) return new Set();

  const priors = await prisma.booking.groupBy({
    by: ['customerId'],
    where: {
      organizationId,
      customerId: { in: customerIds },
      status: { in: LIVE_BOOKING_STATUSES },
      startsAt: { lt: dayStart },
    },
    _count: { _all: true },
  });

  const seenBefore = new Set(priors.map((row) => row.customerId));
  return new Set(customerIds.filter((id) => !seenBefore.has(id)));
}

function toRollEntry(
  booking: {
    id: string;
    seats: number;
    status: string;
    notes: string | null;
    totalCents: number;
    customerId: string;
    customer: { id: string; name: string; email: string; phone: string | null };
    enrollment: { id: string } | null;
    serviceAddress: Prisma.JsonValue;
    payments: {
      amountCents: number;
      refundedCents: number;
      status: PaymentStatus;
    }[];
  },
  firstVisitors: Set<string>,
): RollEntry {
  return {
    bookingId: booking.id,
    customer: booking.customer,
    seats: booking.seats,
    status: booking.status,
    viaEnrollment: booking.enrollment !== null,
    notes: booking.notes,
    // Never negative. An overpayment is a refund question, not a balance the
    // front desk should be asked to collect as a credit at the door.
    balanceCents: Math.max(
      0,
      booking.totalCents - paidCentsOf(booking.payments),
    ),
    firstVisit: firstVisitors.has(booking.customerId),
    serviceAddress: formatServiceAddress(booking.serviceAddress),
  };
}

/**
 * The stored address, as one line somebody can read at a doorstep.
 *
 * Formatted here rather than on the client because the sheet is also sent by
 * SMS and email to an instructor, and those have no client — two formatters
 * would eventually disagree about a booking, which on this screen means an
 * instructor at the wrong house.
 *
 * The coordinates are deliberately dropped. They are how the scheduler
 * computes travel time; they are not what a person needs to find a door, and
 * printing them on a sheet that gets left on a passenger seat is a privacy
 * cost with no operational return. `notes` — "gate code", "side entrance" —
 * IS kept, because that is the half a driver actually uses.
 */
function formatServiceAddress(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const address = value as {
    line1?: unknown;
    city?: unknown;
    postcode?: unknown;
    notes?: unknown;
  };

  const parts = [address.line1, address.city, address.postcode]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map((part) => part.trim());

  if (parts.length === 0) return null;

  const notes = typeof address.notes === 'string' ? address.notes.trim() : '';
  return notes ? `${parts.join(', ')} — ${notes}` : parts.join(', ');
}

const ROLL_INCLUDE = {
  customer: { select: { id: true, name: true, email: true, phone: true } },
  enrollment: { select: { id: true } },
  serviceAddress: true,
  payments: {
    select: { amountCents: true, refundedCents: true, status: true },
  },
} as const;

/**
 * The whole day, in one request.
 *
 * One round trip for the same reason the dashboard is one: this is a sheet
 * somebody prints or reads on a phone in a doorway, and a page that arrives in
 * six pieces is a page that gets printed half-empty.
 */
export async function getManifest(
  organizationId: string,
  localDate: string,
  now = new Date(),
) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, timezone: true, currency: true },
  });

  const { start, end } = dayBoundsFor(localDate, org.timezone);

  const [sessions, appointments] = await Promise.all([
    prisma.session.findMany({
      where: {
        organizationId,
        startsAt: { gte: start, lte: end },
        status: 'SCHEDULED',
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        capacity: true,
        seatsTaken: true,
        seriesIndex: true,
        serviceType: { select: { name: true, color: true } },
        staff: { select: { id: true, name: true, phone: true } },
        location: {
          select: { id: true, name: true, address: true, locationType: true },
        },
        courseSeries: { select: { id: true, name: true, cohortLabel: true } },
        bookings: {
          where: { status: { in: LIVE_BOOKING_STATUSES } },
          select: {
            id: true,
            seats: true,
            status: true,
            notes: true,
            totalCents: true,
            customerId: true,
            ...ROLL_INCLUDE,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { startsAt: 'asc' },
    }),

    prisma.booking.findMany({
      where: {
        organizationId,
        sessionId: null,
        status: { in: LIVE_BOOKING_STATUSES },
        startsAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        seats: true,
        status: true,
        notes: true,
        totalCents: true,
        customerId: true,
        serviceType: { select: { name: true, color: true } },
        staff: { select: { id: true, name: true, phone: true } },
        location: {
          select: { id: true, name: true, address: true, locationType: true },
        },
        ...ROLL_INCLUDE,
      },
      orderBy: { startsAt: 'asc' },
    }),
  ]);

  const customerIds = [
    ...new Set([
      ...sessions.flatMap((s) => s.bookings.map((b) => b.customerId)),
      ...appointments.map((b) => b.customerId),
    ]),
  ];
  const firstVisitors = await firstVisitorsAmong(
    organizationId,
    customerIds,
    start,
  );

  const rows: ManifestSession[] = [
    ...sessions.map((session) => {
      const roll = session.bookings.map((b) => toRollEntry(b, firstVisitors));

      return {
        id: session.id,
        kind: 'class' as const,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        timezone: session.timezone,
        serviceName: session.serviceType.name,
        color: session.serviceType.color,
        staff: session.staff,
        location: session.location
          ? {
              id: session.location.id,
              name: session.location.name,
              address:
                session.location.locationType === 'FIXED'
                  ? session.location.address
                  : null,
            }
          : null,
        course: session.courseSeries,
        seriesIndex: session.seriesIndex,
        capacity: session.capacity,
        seatsTaken: session.seatsTaken,
        markable: session.startsAt <= now,
        roll,
        balanceCents: roll.reduce((sum, e) => sum + e.balanceCents, 0),
      };
    }),

    ...appointments.map((booking) => {
      const entry = toRollEntry(booking, firstVisitors);

      return {
        id: booking.id,
        kind: 'appointment' as const,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        timezone: booking.timezone,
        serviceName: booking.serviceType.name,
        color: booking.serviceType.color,
        staff: booking.staff,
        location: booking.location
          ? {
              id: booking.location.id,
              name: booking.location.name,
              address:
                booking.location.locationType === 'FIXED'
                  ? booking.location.address
                  : null,
            }
          : null,
        course: null,
        seriesIndex: null,
        /* An appointment is its own capacity: it is booked or it does not
           exist. Reporting seats/seats keeps one row shape rather than a
           second variant every consumer has to branch on. */
        capacity: booking.seats,
        seatsTaken: booking.seats,
        markable: booking.startsAt <= now,
        roll: [entry],
        balanceCents: entry.balanceCents,
      };
    }),
  ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const allEntries = rows.flatMap((row) => row.roll);

  return {
    studio: { name: org.name, timezone: org.timezone, currency: org.currency },
    date: localDate,
    sessions: rows,
    totals: {
      classes: rows.filter((r) => r.kind === 'class').length,
      appointments: rows.filter((r) => r.kind === 'appointment').length,
      heads: allEntries.reduce((sum, e) => sum + e.seats, 0),
      checkedIn: allEntries
        .filter((e) => e.status === 'ATTENDED')
        .reduce((sum, e) => sum + e.seats, 0),
      /** Still to mark: live bookings on a class that has already started. */
      toMark: rows
        .filter((row) => row.markable)
        .flatMap((row) => row.roll)
        .filter((e) => e.status !== 'ATTENDED' && e.status !== 'NO_SHOW').length,
      balanceOwedCents: allEntries.reduce((sum, e) => sum + e.balanceCents, 0),
      firstVisits: allEntries.filter((e) => e.firstVisit).length,
    },
    /**
     * Who would receive the sheet if it were sent right now.
     *
     * Returned with the manifest so the Send button can name them before it
     * is pressed. A button that mails eleven people without saying who is a
     * button nobody presses twice.
     */
    recipients: recipientsFrom(rows),
  };
}

type Recipient = { staffId: string; name: string; sessions: number };

function recipientsFrom(rows: ManifestSession[]): Recipient[] {
  const byStaff = new Map<string, Recipient>();

  for (const row of rows) {
    if (!row.staff) continue;
    const existing = byStaff.get(row.staff.id);
    if (existing) existing.sessions += 1;
    else
      byStaff.set(row.staff.id, {
        staffId: row.staff.id,
        name: row.staff.name,
        sessions: 1,
      });
  }

  return [...byStaff.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Sending it
// ---------------------------------------------------------------------------

/**
 * Renders one instructor's part of the day as plain text.
 *
 * Deliberately not the studio's notification templates. Those are customer
 * messages with a studio's voice in them and an owner editing them in
 * Notifications should never be able to break the operational sheet their
 * staff work from — nor should the token help on that screen have to explain
 * a variable that only appears in one internal email.
 */
function renderForStaff(
  manifest: Awaited<ReturnType<typeof getManifest>>,
  staffId: string,
): { subject: string; body: string } | null {
  const mine = manifest.sessions.filter((row) => row.staff?.id === staffId);
  if (mine.length === 0) return null;

  const zone = manifest.studio.timezone;
  const dayLabel = DateTime.fromISO(manifest.date, { zone }).toFormat(
    'cccc d LLLL',
  );

  const time = (at: Date) =>
    DateTime.fromJSDate(at, { zone }).toFormat('h:mm a');

  const money = (cents: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: manifest.studio.currency,
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);

  const blocks = mine.map((row) => {
    const header = [
      `${time(row.startsAt)}–${time(row.endsAt)}  ${row.serviceName}`,
      row.location ? `Where: ${row.location.name}` : null,
      row.kind === 'class'
        ? `Booked: ${row.seatsTaken} of ${row.capacity}`
        : 'Private appointment',
    ]
      .filter(Boolean)
      .join('\n');

    const names = row.roll.length
      ? row.roll
          .map((entry) => {
            const flags = [
              entry.seats > 1 ? `${entry.seats} places` : null,
              entry.firstVisit ? 'FIRST VISIT' : null,
              entry.viaEnrollment ? 'course' : null,
              entry.balanceCents > 0
                ? `owes ${money(entry.balanceCents)}`
                : null,
            ].filter(Boolean);

            return `  - ${entry.customer.name}${
              flags.length ? ` (${flags.join(', ')})` : ''
            }`;
          })
          .join('\n')
      : '  - nobody booked in';

    return `${header}\n${names}`;
  });

  const owed = mine.reduce((sum, row) => sum + row.balanceCents, 0);

  return {
    subject: `Your classes on ${dayLabel} — ${manifest.studio.name}`,
    body: [
      `${dayLabel}`,
      '',
      blocks.join('\n\n'),
      '',
      owed > 0
        ? `Balances to collect: ${money(owed)}`
        : 'Everyone has paid in full.',
      '',
      manifest.studio.name,
    ].join('\n'),
  };
}

/**
 * Queues the day's sheet to each instructor teaching it.
 *
 * Written into the outbox rather than sent here, like everything else that
 * leaves the building: an owner pressing this at 7am must not be waiting on
 * an email provider, and a crash mid-send must not lose half the staff.
 *
 * There is no SMS path. This is a page of names and balances, and the
 * cheapest way to make an instructor stop reading a message is to deliver it
 * as nine text fragments.
 */
export async function sendManifest(
  organizationId: string,
  localDate: string,
  opts: { staffIds?: string[]; now?: Date } = {},
) {
  const now = opts.now ?? new Date();
  const manifest = await getManifest(organizationId, localDate, now);

  const wanted = opts.staffIds?.length
    ? manifest.recipients.filter((r) => opts.staffIds!.includes(r.staffId))
    : manifest.recipients;

  if (wanted.length === 0) {
    return { queued: 0, sentTo: [] as string[] };
  }

  const staff = await prisma.staff.findMany({
    where: {
      organizationId,
      id: { in: wanted.map((r) => r.staffId) },
      isActive: true,
    },
    select: { id: true, name: true, email: true },
  });

  /**
   * The dedupe key carries the minute the send was requested.
   *
   * A studio owner double-tapping Send must not mail their staff twice — that
   * is the accident this is here to stop. But an owner who sends the sheet,
   * then cancels the 11am, must be able to send the corrected one, and a key
   * fixed on the date alone would refuse that silently, which is the worse
   * failure of the two. A minute bucket absorbs the double-tap and lets a
   * deliberate resend through.
   */
  const minute = DateTime.fromJSDate(now, { zone: 'utc' }).toFormat(
    'yyyyLLddHHmm',
  );

  let queued = 0;
  const sentTo: string[] = [];

  for (const person of staff) {
    const rendered = renderForStaff(manifest, person.id);
    if (!rendered) continue;

    try {
      await prisma.notification.create({
        data: {
          organizationId,
          // No customer and no booking: this is an internal message about a
          // whole day, and pinning it to one of the day's bookings would put
          // it in that customer's notification history where it does not
          // belong.
          customerId: null,
          bookingId: null,
          channel: 'EMAIL',
          templateKey: 'manifest.daily',
          destination: person.email,
          payload: {
            subject: rendered.subject,
            body: rendered.body,
            fromName: manifest.studio.name,
          },
          // Backdated a second: the worker claims on Postgres's clock and a
          // row stamped into its future waits a whole polling interval.
          scheduledFor: new Date(now.getTime() - 1000),
          status: 'PENDING',
          dedupeKey: `manifest:${organizationId}:${person.id}:${localDate}:${minute}`,
        },
      });

      queued += 1;
      sentTo.push(person.name);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Already queued this minute — the double-tap this key exists for.
        continue;
      }

      logger.error(
        { err, staffId: person.id, localDate },
        'Failed to queue daily manifest',
      );
      throw err;
    }
  }

  return { queued, sentTo };
}
