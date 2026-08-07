import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import { logger } from '../../lib/logger';
import * as service from './calendar.service';
import { syncConnection, connectionForChannel } from './calendar.service';
import { prisma } from '../../lib/prisma';

/** Studio-side connection management, mounted under the org-scoped router. */
export const calendarRouter = Router({ mergeParams: true });

const staffIdOf = (req: { params: Record<string, string | undefined> }) => {
  const id = req.params.staffId;
  if (!id) throw AppError.badRequest('Missing staffId.');
  return id;
};

calendarRouter.get(
  '/:staffId',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(
      await service.getConnectionStatus(
        req.tenant!.organizationId,
        staffIdOf(req),
      ),
    );
  }),
);

/**
 * Starts the OAuth dance.
 *
 * Admin-only: connecting a calendar grants this system read access to
 * everything on it, which is not a decision an instructor's colleague should
 * be able to make for them.
 */
calendarRouter.post(
  '/:staffId/connect',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const staffId = staffIdOf(req);

    const staff = await prisma.staff.findFirst({
      where: { id: staffId, organizationId: req.tenant!.organizationId },
    });
    if (!staff) throw AppError.notFound('Staff member not found.');

    const { url } = service.buildAuthorizeUrl(
      req.tenant!.organizationId,
      staffId,
    );

    res.json({ url });
  }),
);

calendarRouter.delete(
  '/:staffId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(
      await service.disconnect(req.tenant!.organizationId, staffIdOf(req)),
    );
  }),
);

/** Manual pull, for an instructor who has just changed something and is watching. */
calendarRouter.post(
  '/:staffId/sync',
  requireMember,
  asyncHandler(async (req, res) => {
    const connection = await prisma.calendarConnection.findFirst({
      where: {
        staffId: staffIdOf(req),
        organizationId: req.tenant!.organizationId,
      },
    });
    if (!connection) throw AppError.notFound('No calendar connected.');

    res.json(await syncConnection(connection.id));
  }),
);

// ---------------------------------------------------------------------------
// Unauthenticated endpoints
// ---------------------------------------------------------------------------

/** Where Google sends the instructor back after consent. */
export const calendarCallbackRouter = Router();

calendarCallbackRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');

    if (!code || !state) {
      // The instructor pressed Deny, or something mangled the redirect.
      res.status(400).type('html').send(
        '<p>Calendar connection was cancelled. You can close this window.</p>',
      );
      return;
    }

    try {
      const result = await service.completeConnection({ code, state });
      res
        .type('html')
        .send(
          `<p>Calendar connected${result.accountEmail ? ` as ${escapeHtml(result.accountEmail)}` : ''}. You can close this window.</p>`,
        );
    } catch (err) {
      logger.error({ err }, 'Calendar callback failed');
      res
        .status(400)
        .type('html')
        .send('<p>Could not connect that calendar. Please try again.</p>');
    }
  }),
);

/**
 * Google's push notification endpoint.
 *
 * The body is empty by design — a push says only "something changed on this
 * resource", never what. The response to it is always to pull.
 *
 * Always 200, even on a channel we do not recognise: Google retries and then
 * disables a channel that keeps erroring, and losing the channel is worse
 * than ignoring a stray push.
 */
export const calendarWebhookRouter = Router();

calendarWebhookRouter.post(
  '/google/calendar',
  asyncHandler(async (req, res) => {
    const channelId = req.headers['x-goog-channel-id'];
    const token = req.headers['x-goog-channel-token'];
    const state = req.headers['x-goog-resource-state'];

    // Google sends one of these immediately on registration. Nothing changed.
    if (state === 'sync') {
      res.status(200).send();
      return;
    }

    if (typeof channelId !== 'string' || typeof token !== 'string') {
      res.status(200).send();
      return;
    }

    const connection = await connectionForChannel(channelId, token);
    if (!connection) {
      logger.warn({ channelId }, 'Push for unknown or unverified channel');
      res.status(200).send();
      return;
    }

    // Respond first, sync after. Google times these out aggressively and a
    // slow response counts against the channel.
    res.status(200).send();

    void syncConnection(connection.id).catch((err) => {
      logger.error({ err, connectionId: connection.id }, 'Push sync failed');
    });
  }),
);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
