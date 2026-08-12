import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { encodeToken } from '../public/public.service';
import {
  DEFAULT_TEMPLATES,
  TemplateKey,
  buildValues,
  render,
  type BookingContext,
} from './templates';

/**
 * Enqueueing side of the outbox.
 *
 * Nothing here sends anything. Messages are written as rows and drained by the
 * worker, so a slow email provider can never make a booking fail and a crash
 * mid-send cannot lose a message.
 */

type Channel = 'EMAIL' | 'SMS';

/**
 * Why an SMS was not queued.
 *
 * Recorded as a SKIPPED row rather than silently dropped: a studio asking
 * "why didn't my customer get a text?" needs an answer, and "they replied
 * STOP in March" is a very different answer from "we have no number for them".
 */
type SkipReason = 'NO_CONSENT' | 'OPTED_OUT' | 'NO_DESTINATION';

/**
 * "Now", backdated by a second.
 *
 * The worker claims rows with `scheduled_for <= now()` evaluated by POSTGRES,
 * while this timestamp comes from NODE. Those clocks are close but not
 * identical, and a message stamped a few milliseconds into the database's
 * future waits a whole polling interval for no reason. A second of slack
 * costs nothing and removes the race.
 */
function immediately(): Date {
  return new Date(Date.now() - 1000);
}

export async function scheduleBookingNotifications(bookingId: string) {
  const booking = await loadBooking(bookingId);
  if (!booking) return { queued: 0 };

  const ctx = await buildContext(booking);
  let queued = 0;

  queued += await enqueue({
    booking,
    ctx,
    templateKey: TemplateKey.BOOKING_CONFIRMED,
    scheduledFor: immediately(),
    immediate: true,
  });

  /**
   * Reminders are queued NOW and dated forward, not scheduled by a timer.
   *
   * A timer lives in one process and dies with it. A dated row survives a
   * restart, a deploy and a crash, and the worker simply finds it when it
   * becomes due.
   */
  const reminders: [string, number][] = [
    [TemplateKey.REMINDER_24H, config.REMINDER_HOURS_AHEAD],
    [TemplateKey.REMINDER_2H, config.SECOND_REMINDER_HOURS_AHEAD],
  ];

  for (const [templateKey, hoursAhead] of reminders) {
    const sendAt = new Date(
      booking.startsAt.getTime() - hoursAhead * 3_600_000,
    );

    // A class booked this afternoon for tomorrow morning should not fire a
    // "24 hours to go" reminder that is already in the past.
    if (sendAt.getTime() <= Date.now()) continue;

    queued += await enqueue({ booking, ctx, templateKey, scheduledFor: sendAt });
  }

  return { queued };
}

/**
 * Queues messages for a whole course enrolment.
 *
 * ONE confirmation, then reminders before every week.
 *
 * The obvious implementation — call `scheduleBookingNotifications` for each of
 * the six fanned-out bookings — sends six identical "booking confirmed" emails
 * within a second of each other. The student bought one course; they get one
 * receipt. Reminders are the opposite case: they genuinely want one before
 * each Tuesday, so those do fan out.
 */
export async function scheduleEnrollmentNotifications(enrollmentId: string) {
  const bookings = await prisma.booking.findMany({
    where: { enrollmentId, status: { not: 'CANCELLED' } },
    select: { id: true },
    orderBy: { startsAt: 'asc' },
  });

  if (bookings.length === 0) return { queued: 0 };

  let queued = 0;

  // The confirmation names the first session, which is the date the student
  // actually needs to remember.
  const first = await loadBooking(bookings[0]!.id);
  if (first) {
    queued += await enqueue({
      booking: first,
      ctx: await buildContext(first),
      templateKey: TemplateKey.BOOKING_CONFIRMED,
      scheduledFor: immediately(),
      immediate: true,
    });
  }

  const reminders: [string, number][] = [
    [TemplateKey.REMINDER_24H, config.REMINDER_HOURS_AHEAD],
    [TemplateKey.REMINDER_2H, config.SECOND_REMINDER_HOURS_AHEAD],
  ];

  for (const row of bookings) {
    const booking = await loadBooking(row.id);
    if (!booking) continue;

    const ctx = await buildContext(booking);

    for (const [templateKey, hoursAhead] of reminders) {
      const sendAt = new Date(
        booking.startsAt.getTime() - hoursAhead * 3_600_000,
      );
      if (sendAt.getTime() <= Date.now()) continue;

      queued += await enqueue({ booking, ctx, templateKey, scheduledFor: sendAt });
    }
  }

  return { queued };
}

export async function notifyCancellation(
  bookingId: string,
  opts: { refundCents?: number } = {},
) {
  const booking = await loadBooking(bookingId);
  if (!booking) return { queued: 0 };

  // Reminders for a booking that no longer exists would be worse than useless.
  await cancelPendingFor(bookingId);

  const ctx = await buildContext(booking, opts);

  return {
    queued: await enqueue({
      booking,
      ctx,
      templateKey: TemplateKey.BOOKING_CANCELLED,
      scheduledFor: immediately(),
      immediate: true,
    }),
  };
}

export async function notifyReschedule(bookingId: string) {
  const booking = await loadBooking(bookingId);
  if (!booking) return { queued: 0 };

  const ctx = await buildContext(booking);

  return {
    queued: await enqueue({
      booking,
      ctx,
      templateKey: TemplateKey.BOOKING_RESCHEDULED,
      scheduledFor: immediately(),
      immediate: true,
    }),
  };
}

/** Stops anything still queued for a booking, leaving sent history intact. */
export async function cancelPendingFor(bookingId: string) {
  const result = await prisma.notification.updateMany({
    where: { bookingId, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });
  return result.count;
}

type LoadedBooking = NonNullable<Awaited<ReturnType<typeof loadBooking>>>;

async function loadBooking(bookingId: string) {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: true,
      serviceType: { select: { name: true } },
      staff: { select: { name: true } },
      location: { select: { name: true, address: true, locationType: true } },
      organization: {
        select: { id: true, name: true, slug: true, currency: true },
      },
    },
  });
}

async function buildContext(
  booking: LoadedBooking,
  opts: { refundCents?: number } = {},
): Promise<BookingContext> {
  return {
    customerName: booking.customer.name,
    studioName: booking.organization.name,
    serviceName: booking.serviceType.name,
    startsAt: booking.startsAt,
    timezone: booking.timezone,
    // A mobile booking's "location" is the customer's own address, which they
    // already know; naming our service area back at them is noise.
    locationName:
      booking.location?.locationType === 'FIXED' ? booking.location.name : null,
    locationAddress:
      booking.location?.locationType === 'FIXED' ? booking.location.address : null,
    staffName: booking.staff?.name ?? null,
    seats: booking.seats,
    totalCents: booking.totalCents,
    currency: booking.organization.currency,
    manageUrl: `${config.PUBLIC_URL}/public/bookings/${encodeToken(booking.cancelToken)}/manage`,
    refundCents: opts.refundCents,
  };
}

/**
 * Writes one message per channel the customer can actually receive.
 *
 * The destination and the rendered payload are snapshotted here rather than
 * resolved at send time: a customer changing their email tomorrow must not
 * redirect a message queued today, and a studio editing a template must not
 * retroactively rewrite messages already waiting to go out.
 */
async function enqueue(input: {
  booking: LoadedBooking;
  ctx: BookingContext;
  templateKey: string;
  scheduledFor: Date;
  /**
   * True for a message that answers something the customer just did.
   *
   * Quiet hours exist to stop us waking people up with proactive reminders.
   * They must NOT delay a confirmation: somebody who books at 11pm is plainly
   * awake, and holding their receipt until 8am reads as a failed booking.
   * TCPA restricts unsolicited contact, not a response to a transaction the
   * customer initiated seconds earlier.
   */
  immediate?: boolean;
}): Promise<number> {
  const { booking, ctx, templateKey } = input;
  const values = buildValues(ctx);
  let written = 0;

  // --- Email ---------------------------------------------------------------
  const emailTemplate = await resolveTemplate(
    booking.organizationId,
    templateKey,
    'EMAIL',
  );

  if (emailTemplate && booking.customer.email) {
    written += await writeRow({
      booking,
      channel: 'EMAIL',
      templateKey,
      destination: booking.customer.email,
      scheduledFor: input.scheduledFor,
      payload: {
        subject: render(emailTemplate.subject ?? '', values),
        body: render(emailTemplate.body, values),
        fromName: ctx.studioName,
      },
    });
  }

  // --- SMS -----------------------------------------------------------------
  const smsTemplate = await resolveTemplate(
    booking.organizationId,
    templateKey,
    'SMS',
  );

  if (smsTemplate) {
    const skip = smsSkipReason(booking.customer);

    if (skip) {
      await writeRow({
        booking,
        channel: 'SMS',
        templateKey,
        destination: booking.customer.phone ?? 'unknown',
        scheduledFor: input.scheduledFor,
        payload: { body: '', skipped: skip },
        status: 'SKIPPED',
      });
    } else {
      written += await writeRow({
        booking,
        channel: 'SMS',
        templateKey,
        destination: booking.customer.phone!,
        scheduledFor: input.immediate
          ? input.scheduledFor
          : applyQuietHours(input.scheduledFor, booking.timezone),
        payload: { body: render(smsTemplate.body, values) },
      });
    }
  }

  return written;
}

/**
 * Opt-out beats consent, always.
 *
 * A customer who replied STOP and later ticks the box on a booking form has
 * not resubscribed — under TCPA that requires an explicit opt-back-in, and
 * getting it wrong is per-message statutory damages.
 */
function smsSkipReason(customer: {
  phone: string | null;
  smsConsentAt: Date | null;
  smsOptedOutAt: Date | null;
}): SkipReason | null {
  if (customer.smsOptedOutAt) return 'OPTED_OUT';
  if (!customer.phone) return 'NO_DESTINATION';
  if (!customer.smsConsentAt) return 'NO_CONSENT';
  return null;
}

/**
 * Moves a send out of the quiet window.
 *
 * Evaluated in the studio's zone, which is the jurisdiction the studio
 * operates in. A message due at 03:00 goes at 08:00; one due at 22:30 goes at
 * 08:00 the next morning.
 */
export function applyQuietHours(when: Date, timezone: string): Date {
  const local = DateTime.fromJSDate(when, { zone: timezone });
  const start = config.SMS_QUIET_START_HOUR;
  const end = config.SMS_QUIET_END_HOUR;

  if (local.hour >= start && local.hour < end) return when;

  const target =
    local.hour < start
      ? local.set({ hour: start, minute: 0, second: 0, millisecond: 0 })
      : local
          .plus({ days: 1 })
          .set({ hour: start, minute: 0, second: 0, millisecond: 0 });

  return target.toJSDate();
}

async function writeRow(input: {
  booking: LoadedBooking;
  channel: Channel;
  templateKey: string;
  destination: string;
  scheduledFor: Date;
  payload: Prisma.InputJsonValue;
  status?: 'PENDING' | 'SKIPPED';
}): Promise<number> {
  const dedupeKey = `${input.booking.id}:${input.templateKey}:${input.channel}`;

  try {
    await prisma.notification.create({
      data: {
        organizationId: input.booking.organizationId,
        bookingId: input.booking.id,
        customerId: input.booking.customerId,
        channel: input.channel,
        templateKey: input.templateKey,
        destination: input.destination,
        payload: input.payload,
        scheduledFor: input.scheduledFor,
        status: input.status ?? 'PENDING',
        dedupeKey,
      },
    });
    return input.status === 'SKIPPED' ? 0 : 1;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      // Already queued. Enqueueing is idempotent by design: a retried webhook
      // must not produce two confirmation emails.
      return 0;
    }
    throw err;
  }
}

/** Studio wording if they have set any, otherwise the built-in default. */
async function resolveTemplate(
  organizationId: string,
  templateKey: string,
  channel: Channel,
): Promise<{ subject?: string | null; body: string } | null> {
  const custom = await prisma.notificationTemplate.findFirst({
    where: { organizationId, templateKey, channel, isActive: true },
  });
  if (custom) return custom;

  const fallback = DEFAULT_TEMPLATES[templateKey];
  if (!fallback) {
    logger.warn({ templateKey }, 'No template registered');
    return null;
  }

  return channel === 'EMAIL' ? fallback.EMAIL : (fallback.SMS ?? null);
}

/**
 * Records an opt-out.
 *
 * Applied to EVERY customer record with that number, across studios. We send
 * from one platform number, so the customer is opting out of messages from
 * that number — narrowing it to a single studio would keep texting somebody
 * who has plainly said stop.
 */
export async function recordSmsOptOut(phone: string) {
  const normalized = normalizePhone(phone);

  const result = await prisma.customer.updateMany({
    where: { phone: { contains: normalized.slice(-10) } },
    data: { smsOptedOutAt: new Date() },
  });

  // Anything already queued must not go out.
  await prisma.notification.updateMany({
    where: {
      channel: 'SMS',
      status: 'PENDING',
      destination: { contains: normalized.slice(-10) },
    },
    data: { status: 'CANCELLED' },
  });

  logger.info({ customers: result.count }, 'SMS opt-out recorded');
  return { optedOut: result.count };
}

export async function recordSmsOptIn(phone: string) {
  const normalized = normalizePhone(phone);

  const result = await prisma.customer.updateMany({
    where: { phone: { contains: normalized.slice(-10) } },
    data: { smsOptedOutAt: null, smsConsentAt: new Date() },
  });

  return { optedIn: result.count };
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}
