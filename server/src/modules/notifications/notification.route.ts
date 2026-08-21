import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import { prisma } from '../../lib/prisma';
import { DEFAULT_TEMPLATES, buildValues, render } from './templates';

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

    res.json({ notifications: rows });
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
