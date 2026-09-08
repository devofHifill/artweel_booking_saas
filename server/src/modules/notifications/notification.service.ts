import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { encodeToken } from '../public/public.service';
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_META,
  TemplateKey,
  buildValues,
  render,
  type BookingContext,
} from './templates';
import { AppError } from '../../lib/app-error';

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

/**
 * "Your work is ready to collect."
 *
 * Written directly rather than through `enqueue`, because every other message
 * in the outbox hangs off a booking and this one hangs off a piece. Forcing a
 * piece to masquerade as a booking to reuse that path would have been the
 * worse trade — the dedupe key, the destination and the template values are
 * all different.
 *
 * SMS consent is checked with the same helper the booking path uses, so a
 * customer who replied STOP is honoured here too. That must never be allowed
 * to drift: opt-out is a legal obligation, not a preference.
 */
export async function schedulePieceReadyNotification(pieceId: string) {
  const piece = await prisma.piece.findUnique({
    where: { id: pieceId },
    include: {
      customer: true,
      organization: {
        select: { id: true, name: true, timezone: true, pieceHoldDays: true },
      },
    },
  });

  if (!piece) return { queued: 0 };

  const holdLine =
    piece.organization.pieceHoldDays > 0
      ? `Please collect within ${piece.organization.pieceHoldDays} days.`
      : '';

  const values: Record<string, string> = {
    customerName: piece.customer.name,
    studioName: piece.organization.name,
    pieceLabel: piece.label,
    shelfLine: piece.shelfLocation ? `Shelf: ${piece.shelfLocation}` : '',
    holdLine,
  };

  let queued = 0;

  const write = async (
    channel: Channel,
    destination: string,
    payload: Prisma.InputJsonValue,
    status: 'PENDING' | 'SKIPPED' = 'PENDING',
  ) => {
    try {
      await prisma.notification.create({
        data: {
          organizationId: piece.organizationId,
          customerId: piece.customerId,
          channel,
          templateKey: TemplateKey.PIECE_READY,
          destination,
          payload,
          scheduledFor: immediately(),
          status,
          // Keyed on the piece, so a refired piece becoming ready again does
          // produce a fresh message while a retry does not.
          dedupeKey: `piece:${piece.id}:${TemplateKey.PIECE_READY}:${channel}:${piece.readyAt?.getTime() ?? 0}`,
        },
      });
      if (status === 'PENDING') queued += 1;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  };

  const emailTemplate = await resolveTemplate(
    piece.organizationId,
    TemplateKey.PIECE_READY,
    'EMAIL',
  );

  if (emailTemplate && piece.customer.email) {
    await write('EMAIL', piece.customer.email, {
      subject: render(emailTemplate.subject ?? '', values),
      body: render(emailTemplate.body, values),
      fromName: piece.organization.name,
    });
  }

  const smsTemplate = await resolveTemplate(
    piece.organizationId,
    TemplateKey.PIECE_READY,
    'SMS',
  );

  if (smsTemplate) {
    const skip = smsSkipReason(piece.customer);

    if (skip) {
      await write(
        'SMS',
        piece.customer.phone ?? '',
        { skipReason: skip },
        'SKIPPED',
      );
    } else {
      await write('SMS', piece.customer.phone!, {
        body: render(smsTemplate.body, values),
      });
    }
  }

  return { queued };
}

/**
 * "A place has opened up."
 *
 * Sent immediately and never queued behind quiet hours. The offer has a clock
 * on it, so holding the message until 8am would burn hours of a window the
 * customer never knew had started — the one case where waking somebody is
 * kinder than the alternative.
 */
export async function scheduleWaitlistOffer(entryId: string) {
  const entry = await prisma.waitlistEntry.findUnique({
    where: { id: entryId },
    include: {
      customer: true,
      organization: { select: { id: true, name: true, timezone: true } },
      session: {
        include: {
          serviceType: { select: { name: true } },
          location: { select: { name: true, address: true, locationType: true } },
        },
      },
    },
  });

  if (!entry) return { queued: 0 };

  const zone = entry.session.timezone;
  const start = DateTime.fromJSDate(entry.session.startsAt, { zone });
  const expiry = entry.offerExpiresAt
    ? DateTime.fromJSDate(entry.offerExpiresAt, { zone })
    : null;

  const values: Record<string, string> = {
    customerName: entry.customer.name,
    studioName: entry.organization.name,
    serviceName: entry.session.serviceType.name,
    dateShort: start.toFormat('d LLL'),
    dateLong: start.toFormat('cccc d LLLL'),
    time: start.toFormat('h:mm a'),
    timezoneLabel: start.toFormat('ZZZZ'),
    locationLine:
      entry.session.location?.locationType === 'FIXED'
        ? (entry.session.location.address ?? entry.session.location.name)
        : (entry.session.location?.name ?? 'See booking'),
    offerExpiry: expiry ? expiry.toFormat('cccc d LLLL, h:mm a') : 'shortly',
    claimUrl: `${config.PUBLIC_URL}/public/waitlist/${encodeToken(entry.claimToken)}/claim`,
  };

  let queued = 0;

  const write = async (
    channel: Channel,
    destination: string,
    payload: Prisma.InputJsonValue,
    status: 'PENDING' | 'SKIPPED' = 'PENDING',
  ) => {
    try {
      await prisma.notification.create({
        data: {
          organizationId: entry.organizationId,
          customerId: entry.customerId,
          channel,
          templateKey: TemplateKey.WAITLIST_OFFER,
          destination,
          payload,
          scheduledFor: immediately(),
          status,
          // Keyed on the offer, so a place offered again after expiring and
          // coming back round does send a fresh message.
          dedupeKey: `waitlist:${entry.id}:${entry.offeredAt?.getTime() ?? 0}:${channel}`,
        },
      });
      if (status === 'PENDING') queued += 1;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  };

  const emailTemplate = await resolveTemplate(
    entry.organizationId,
    TemplateKey.WAITLIST_OFFER,
    'EMAIL',
  );

  if (emailTemplate && entry.customer.email) {
    await write('EMAIL', entry.customer.email, {
      subject: render(emailTemplate.subject ?? '', values),
      body: render(emailTemplate.body, values),
      fromName: entry.organization.name,
    });
  }

  const smsTemplate = await resolveTemplate(
    entry.organizationId,
    TemplateKey.WAITLIST_OFFER,
    'SMS',
  );

  if (smsTemplate) {
    const skip = smsSkipReason(entry.customer);

    if (skip) {
      await write('SMS', entry.customer.phone ?? '', { skipReason: skip }, 'SKIPPED');
    } else {
      await write('SMS', entry.customer.phone!, {
        body: render(smsTemplate.body, values),
      });
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
export function applyQuietHours(
  when: Date,
  timezone: string,
  /**
   * The studio's own quiet window, as the operator sets it: no texts between
   * `fromHour` and `toHour`.
   *
   * THE INVERSION LIVES HERE AND NOWHERE ELSE. Everything below works in the
   * SENDING window, which is what `config.SMS_QUIET_START_HOUR` and its
   * sibling have always held despite their names. A studio's quiet hours are
   * the complement of that, so they are turned around once, on the way in.
   *
   * Optional, so every existing caller keeps the platform default exactly.
   */
  quiet?: { fromHour: number; toHour: number },
): Date {
  const local = DateTime.fromJSDate(when, { zone: timezone });
  /* Quiet 21:00–08:00 means sending 08:00–21:00. */
  const start = quiet ? quiet.toHour : config.SMS_QUIET_START_HOUR;
  const end = quiet ? quiet.fromHour : config.SMS_QUIET_END_HOUR;

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

// --- Automations ------------------------------------------------------------

/**
 * The Automations table: every message the product can send, and what the
 * studio's own history with it looks like.
 *
 * Built from the CODE's list of template keys, not from what happens to be in
 * the outbox. A studio that has never had a waitlist offer fire still needs to
 * see the rule, and see that it is on — a table assembled from sent messages
 * would show them nothing and imply the feature does not exist.
 */
export async function listAutomations(organizationId: string) {
  const keys = Object.keys(DEFAULT_TEMPLATES);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [rules, overrides, recent, lastSent] = await Promise.all([
    prisma.notificationRule.findMany({ where: { organizationId } }),
    prisma.notificationTemplate.findMany({
      where: { organizationId },
      select: { templateKey: true, channel: true },
    }),
    /*
      Counted over SENT only. "486" under a heading of "30 days" is read as
      "went out"; including failures and skips would inflate it with messages
      nobody received, which is the opposite of what the number is for.
    */
    prisma.notification.groupBy({
      by: ['templateKey'],
      where: { organizationId, status: 'SENT', sentAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.notification.groupBy({
      by: ['templateKey'],
      where: { organizationId, status: 'SENT' },
      _max: { sentAt: true },
    }),
  ]);

  const countFor = new Map(recent.map((r) => [r.templateKey, r._count._all]));
  const lastFor = new Map(lastSent.map((r) => [r.templateKey, r._max.sentAt]));
  const ruleFor = new Map(rules.map((r) => [r.templateKey, r.enabled]));

  return keys.map((key) => {
    const meta = TEMPLATE_META[key];
    const defaults = DEFAULT_TEMPLATES[key]!;

    /*
      Which channels this message CAN go out on — a property of the template,
      not of the studio. SMS additionally needs the customer's consent, which
      is per person and decided at send time, so this says "email and SMS" for
      a message that supports both even when a given guest only gets the email.
    */
    const channels: ('EMAIL' | 'SMS')[] = defaults.SMS
      ? ['EMAIL', 'SMS']
      : ['EMAIL'];

    return {
      templateKey: key,
      name: meta?.name ?? key,
      trigger: meta?.trigger ?? '',
      essential: meta?.essential ?? false,
      channels,
      /** True when the studio has rewritten the words on any channel. */
      customised: overrides.some((o) => o.templateKey === key),
      /** Absent rule means on — see the migration. */
      enabled: ruleFor.get(key) ?? true,
      sentLast30Days: countFor.get(key) ?? 0,
      lastSentAt: lastFor.get(key) ?? null,
    };
  });
}

/**
 * Turns one automation on or off.
 *
 * Turning it back ON deletes the row rather than setting `enabled = true`, so
 * the table only ever holds deliberate exceptions and "no row" keeps meaning
 * exactly one thing. Storing an explicit true would make absent and true two
 * spellings of the same state, and the first piece of code to check only for
 * a row would get it wrong.
 */
export async function setAutomation(
  organizationId: string,
  templateKey: string,
  enabled: boolean,
) {
  if (!DEFAULT_TEMPLATES[templateKey]) {
    throw AppError.notFound('No such notification.');
  }

  if (enabled) {
    await prisma.notificationRule.deleteMany({
      where: { organizationId, templateKey },
    });
    return { templateKey, enabled: true };
  }

  await prisma.notificationRule.upsert({
    where: { organizationId_templateKey: { organizationId, templateKey } },
    create: { organizationId, templateKey, enabled: false },
    update: { enabled: false },
  });

  return { templateKey, enabled: false };
}
