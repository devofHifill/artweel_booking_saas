import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import { prisma } from '../../lib/prisma';
import { DEFAULT_TEMPLATES, buildValues, render } from './templates';
import { config } from '../../config';

/** Studio-side notification settings and delivery history. */
export const notificationRouter = Router({ mergeParams: true });

const channel = z.enum(['EMAIL', 'SMS']);

/**
 * Delivery log.
 *
 * "Did my customer get their reminder?" is one of the most common support
 * questions a studio has, and SKIPPED rows carry the reason — "they replied
 * STOP in March" is a very different answer from "we have no number for them".
 */
notificationRouter.get(
  '/',
  requireMember,
  validateQuery(
    z.object({
      bookingId: z.string().uuid().optional(),
      status: z
        .enum(['PENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED'])
        .optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as {
      bookingId?: string;
      status?: string;
      limit: number;
    };

    const rows = await prisma.notification.findMany({
      where: {
        organizationId: req.tenant!.organizationId,
        ...(q.bookingId ? { bookingId: q.bookingId } : {}),
        ...(q.status ? { status: q.status as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      select: {
        id: true,
        channel: true,
        templateKey: true,
        destination: true,
        status: true,
        attempts: true,
        scheduledFor: true,
        sentAt: true,
        lastError: true,
        payload: true,
        createdAt: true,
      },
    });

    /* The payload carries the rendered message — a customer's name, their
       class, sometimes their address — and the log does not need any of it to
       list a row. Only the test marker comes out. */
    const notifications = rows.map(({ payload, ...row }) => ({
      ...row,
      isTest:
        typeof payload === 'object' &&
        payload !== null &&
        !Array.isArray(payload) &&
        (payload as { test?: unknown }).test === true,
    }));

    /*
      How many sit behind each status tab, counted under every filter EXCEPT
      status — the same rule Bookings and Payments follow, and worth repeating
      because getting it wrong is invisible until somebody clicks: count under
      the status filter too and every other tab reads zero the moment one is
      chosen.
    */
    const grouped = await prisma.notification.groupBy({
      by: ['status'],
      where: {
        organizationId: req.tenant!.organizationId,
        ...(q.bookingId ? { bookingId: q.bookingId } : {}),
      },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of grouped) {
      counts[row.status] = row._count._all;
      total += row._count._all;
    }

    res.json({ notifications, counts: { total, ...counts } });
  }),
);

/**
 * Send a failed message again.
 *
 * This is what turns the dashboard's "3 customers were not sent a confirmation"
 * from a statement into something an owner can act on. Until now a permanent
 * failure — a bounced address that has since been corrected, a provider outage
 * that has passed — stayed failed forever, and the only remedy was psql.
 *
 * `attempts` is reset to zero, and that is the load-bearing line. The worker
 * claims rows with `attempts < NOTIFICATION_MAX_ATTEMPTS`, so a row that
 * exhausted its budget would be flipped back to PENDING and then never picked
 * up again — a Retry button that reports success, changes a row, and sends
 * nothing. The lack of an error message is what would make that one hard to
 * notice.
 *
 * Only FAILED rows. Retrying a PENDING one would reset a backoff that is
 * working correctly, and retrying a SENT one would send a customer a second
 * copy of a message they already have.
 */
notificationRouter.post(
  '/:notificationId/retry',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const notificationId = req.params.notificationId;
    if (!notificationId) throw AppError.badRequest('Missing notificationId.');

    const existing = await prisma.notification.findFirst({
      where: { id: notificationId, organizationId: req.tenant!.organizationId },
      select: { id: true, status: true },
    });
    if (!existing) throw AppError.notFound('Message not found.');

    if (existing.status !== 'FAILED') {
      throw AppError.badRequest(
        `Only failed messages can be sent again. This one is ${existing.status.toLowerCase()}.`,
        'NOT_RETRYABLE',
      );
    }

    const notification = await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'PENDING',
        attempts: 0,
        lastError: null,
        scheduledFor: new Date(),
      },
      select: { id: true, status: true, attempts: true, scheduledFor: true },
    });

    res.json({ notification });
  }),
);

/** Built-in defaults alongside any studio overrides, so the UI can diff them. */
notificationRouter.get(
  '/templates',
  requireMember,
  asyncHandler(async (req, res) => {
    const overrides = await prisma.notificationTemplate.findMany({
      where: { organizationId: req.tenant!.organizationId },
    });

    const defaults = Object.entries(DEFAULT_TEMPLATES).flatMap(
      ([templateKey, byChannel]) =>
        (['EMAIL', 'SMS'] as const)
          .filter((c) => byChannel[c])
          .map((c) => ({
            templateKey,
            channel: c,
            subject: byChannel[c]!.subject ?? null,
            body: byChannel[c]!.body,
          })),
    );

    res.json({ defaults, overrides });
  }),
);

notificationRouter.put(
  '/templates',
  requireAdmin,
  validateBody(
    z.object({
      templateKey: z.string().min(1).max(60),
      channel,
      subject: z.string().max(200).optional().nullable(),
      // SMS is billed per segment, so a runaway template is a runaway bill.
      body: z.string().min(1).max(4000),
      isActive: z.boolean().default(true),
    }),
  ),
  asyncHandler(async (req, res) => {
    const organizationId = req.tenant!.organizationId;

    if (!DEFAULT_TEMPLATES[req.body.templateKey]) {
      throw AppError.badRequest(
        'Unknown template. Editing is limited to the messages the system sends.',
        'UNKNOWN_TEMPLATE',
      );
    }

    if (req.body.channel === 'EMAIL' && !req.body.subject) {
      throw AppError.badRequest('An email template needs a subject.');
    }

    const template = await prisma.notificationTemplate.upsert({
      where: {
        organizationId_templateKey_channel: {
          organizationId,
          templateKey: req.body.templateKey,
          channel: req.body.channel,
        },
      },
      create: { ...req.body, organizationId },
      update: req.body,
    });

    res.json({ template });
  }),
);

/**
 * Renders a template against sample data.
 *
 * A studio editing their confirmation email should see what a customer will
 * see before a customer sees it — including which tokens resolved to nothing,
 * since unknown tokens collapse silently by design.
 */
notificationRouter.post(
  '/templates/preview',
  requireMember,
  validateBody(
    z.object({
      subject: z.string().max(200).optional(),
      body: z.string().min(1).max(4000),
    }),
  ),
  asyncHandler(async (req, res) => {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: req.tenant!.organizationId },
    });

    const values = buildValues({
      customerName: 'Ada Potter',
      studioName: org.name,
      serviceName: 'Beginner Wheel Throwing',
      startsAt: new Date(Date.now() + 86_400_000),
      timezone: org.timezone,
      locationName: 'Main Studio',
      locationAddress: '119 Kiln Street',
      staffName: 'Rowan Pike',
      seats: 2,
      totalCents: 19_000,
      currency: org.currency,
      manageUrl: 'https://example.test/manage/sample',
    });

    res.json({
      subject: req.body.subject ? render(req.body.subject, values) : null,
      body: render(req.body.body, values),
      availableTokens: Object.keys(values),
    });
  }),
);

/**
 * What has been going out, and whether it is arriving.
 *
 * Every figure here is counted from the delivery table rather than quoted from
 * a provider dashboard, which is the only version a studio can check against
 * the rows underneath it.
 *
 * SKIPPED is deliberately NOT a delivery failure. A message not sent because
 * somebody replied STOP, or because there is no number on file, is a rule
 * doing its job; folding those into the rate would make TCPA compliance read
 * as an outage and would push a studio to "fix" something that is correct.
 */
notificationRouter.get(
  '/stats',
  requireMember,
  asyncHandler(async (req, res) => {
    const organizationId = req.tenant!.organizationId;
    const since = new Date(Date.now() - 30 * 86_400_000);

    const grouped = await prisma.notification.groupBy({
      by: ['status', 'channel'],
      where: { organizationId, createdAt: { gte: since } },
      _count: { _all: true },
    });

    const byChannel: Record<string, Record<string, number>> = {
      EMAIL: {},
      SMS: {},
    };
    const totals: Record<string, number> = {};

    for (const row of grouped) {
      byChannel[row.channel]![row.status] = row._count._all;
      totals[row.status] = (totals[row.status] ?? 0) + row._count._all;
    }

    /** Sent over sent-plus-failed. Null when nothing was attempted at all. */
    const rate = (counts: Record<string, number>): number | null => {
      const sent = counts.SENT ?? 0;
      const failed = counts.FAILED ?? 0;
      return sent + failed === 0 ? null : Math.round((sent / (sent + failed)) * 100);
    };

    res.json({
      days: 30,
      totals: {
        sent: totals.SENT ?? 0,
        failed: totals.FAILED ?? 0,
        pending: totals.PENDING ?? 0,
        skipped: totals.SKIPPED ?? 0,
        cancelled: totals.CANCELLED ?? 0,
        deliveryRate: rate(totals),
      },
      channels: {
        email: {
          sent: byChannel.EMAIL!.SENT ?? 0,
          failed: byChannel.EMAIL!.FAILED ?? 0,
          deliveryRate: rate(byChannel.EMAIL!),
        },
        sms: {
          sent: byChannel.SMS!.SENT ?? 0,
          failed: byChannel.SMS!.FAILED ?? 0,
          deliveryRate: rate(byChannel.SMS!),
        },
      },
      /*
        How messages leave the building. Every one of these is a PLATFORM
        setting rather than a studio one, and the screen says so — a panel that
        displays a rule next to no way of changing it invites somebody to hunt
        for the knob, unless it tells them there isn't one.
      */
      delivery: {
        emailFrom: config.EMAIL_FROM,
        smsConfigured: Boolean(
          config.TWILIO_ACCOUNT_SID && config.TWILIO_FROM_NUMBER,
        ),
        smsFrom: config.TWILIO_FROM_NUMBER ?? null,
        /*
          `sendingWindow`, not `quietHours` — the config's own names invite the
          mistake and this payload should not repeat it. SMS_QUIET_START_HOUR
          is when texting becomes ALLOWED (8am) and SMS_QUIET_END_HOUR is when
          it stops (9pm); the quiet hours are the gap between them overnight.
          Named the other way round, the first screen to read this described
          the rule backwards, and it took reading `applyQuietHours` to notice.
        */
        sendingWindow: {
          fromHour: config.SMS_QUIET_START_HOUR,
          toHour: config.SMS_QUIET_END_HOUR,
        },
      },
    });
  }),
);

/**
 * Sends one template to the person asking for it.
 *
 * Preview renders the words; this proves the pipe. After changing a
 * confirmation email the question is "will that actually arrive", and the only
 * thing that can answer it is a real provider — a preview cannot tell you the
 * SMS credentials are wrong or that your domain fails SPF.
 *
 * **The destination is the caller's own address and cannot be anything else.**
 * There is no `to` field on this request, deliberately: an endpoint behind a
 * studio login that sends studio-authored text to an arbitrary address is a
 * spam relay, and the first person to notice would be the provider suspending
 * the account everyone shares.
 *
 * It goes through the outbox like everything else, so a test appears in the
 * delivery log as itself. Making it invisible would mean an owner seeing "not
 * delivered" and having no row to look at.
 */
notificationRouter.post(
  '/templates/test',
  requireAdmin,
  validateBody(
    z.object({
      templateKey: z.string().min(1).max(60),
      channel,
      subject: z.string().max(200).optional(),
      body: z.string().min(1).max(4000),
    }),
  ),
  asyncHandler(async (req, res) => {
    const organizationId = req.tenant!.organizationId;

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    let destination = req.auth!.email;

    if (req.body.channel === 'SMS') {
      /* Their own mobile, from their staff record — the only phone number this
         product knows for a member of the team. A studio that has not filled
         one in is told which field to fill rather than being handed a silent
         failure. */
      const staff = await prisma.staff.findFirst({
        where: { organizationId, userId: req.auth!.userId, isActive: true },
        select: { phone: true },
      });

      if (!staff?.phone) {
        throw AppError.badRequest(
          'Add a mobile number to your staff profile to test a text message.',
          'NO_TEST_NUMBER',
        );
      }

      destination = staff.phone;
    }

    const values = buildValues({
      customerName: 'Ada Potter',
      studioName: org.name,
      serviceName: 'Beginner Wheel Throwing',
      startsAt: new Date(Date.now() + 86_400_000),
      timezone: org.timezone,
      locationName: 'Main Studio',
      locationAddress: '119 Kiln Street',
      staffName: 'Rowan Pike',
      seats: 2,
      totalCents: 19_000,
      currency: org.currency,
      manageUrl: 'https://example.test/manage/sample',
    });

    const subject = req.body.subject
      ? `[test] ${render(req.body.subject, values)}`
      : '[test] Message from your studio';

    await prisma.notification.create({
      data: {
        organizationId,
        /* No customer and no booking: this message is about a template, and
           attaching it to a real booking would put a test in that customer's
           history. Same shape the daily manifest uses for the same reason. */
        bookingId: null,
        customerId: null,
        channel: req.body.channel,
        templateKey: req.body.templateKey,
        destination,
        payload: {
          subject,
          body: render(req.body.body, values),
          fromName: org.name,
          /* Marked in the row itself rather than inferred from the "[test]"
             subject prefix. A screen deriving it from a string would break the
             day somebody's own template starts with a bracket, and the delivery
             log is the one place a test must not be mistaken for a message a
             customer received. */
          test: true,
        },
        /* Backdated a second: the worker claims on Postgres's clock, and a row
           stamped into its own future waits a full polling interval before
           anybody sees it. */
        scheduledFor: new Date(Date.now() - 1000),
        status: 'PENDING',
        /*
          Unique per attempt, unlike every other row in this table.

          Enqueueing is idempotent everywhere else because a retried webhook
          must not send a customer two confirmations. A test is the opposite:
          somebody fixes a typo and immediately tries again, and a dedupe key
          that collapsed the second attempt would look exactly like the send
          having failed.
        */
        dedupeKey: `test:${req.auth!.userId}:${req.body.templateKey}:${req.body.channel}:${Date.now()}`,
      },
    });

    res.status(202).json({ queued: true, destination });
  }),
);
