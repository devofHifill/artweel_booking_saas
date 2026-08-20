import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { requireMember } from '../../middleware/authenticate';
import * as service from './dashboard.service';

/**
 * The landing page, in one request.
 *
 * `requireMember`, not `requireAdmin`. This is the screen the studio opens every
 * morning, and an instructor who cannot see today's running order or who is
 * teaching cannot do their job. Nothing here is a setting or a secret: the
 * figures are the studio's own operating picture, and the sensitive surfaces —
 * billing, payouts, platform data — live behind their own routes.
 */
export const dashboardRouter = Router({ mergeParams: true });

dashboardRouter.get(
  '/',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(await service.getDashboard(req.tenant!.organizationId));
  }),
);
