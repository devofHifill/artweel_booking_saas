import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as waitlists from './waitlist.service';

/**
 * Mounted under /api/organizations/:organizationId/sessions/:sessionId/waitlist
 * via the sessions router, plus a flat entry route for removals.
 *
 * Reading is any member's business — "how many are waiting" is the number that
 * decides whether to open another class. Removing somebody, and forcing an
 * offer by hand, are owner decisions.
 */
export const waitlistRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

waitlistRouter.get(
  '/:sessionId/waitlist',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(
      await waitlists.listWaitlist(
        req.tenant!.organizationId,
        id(req, 'sessionId'),
      ),
    );
  }),
);

/**
 * Offers the next free seat by hand.
 *
 * Normally this happens automatically on cancellation. It exists for the case
 * where a studio makes a class bigger — capacity went up, nobody cancelled, so
 * nothing triggered the queue.
 */
waitlistRouter.post(
  '/:sessionId/waitlist/offer',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(
      await waitlists.offerNextSeat(
        req.tenant!.organizationId,
        id(req, 'sessionId'),
      ),
    );
  }),
);

waitlistRouter.delete(
  '/:sessionId/waitlist/:entryId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({
      entry: await waitlists.leaveWaitlist(
        req.tenant!.organizationId,
        id(req, 'entryId'),
      ),
    });
  }),
);
