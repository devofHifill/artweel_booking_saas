import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { requireMember } from '../../middleware/authenticate';
import { getIntegrationStatus } from './integration.service';

/**
 * Everything this studio is plugged into, on one screen.
 *
 * The reading lives in `integration.service` since S10, because the platform
 * needs the same picture for an arbitrary studio and two implementations of
 * "is their Stripe connected" would drift.
 *
 * Deliberately NOT included: worker heartbeats. They are Artweel's
 * infrastructure, not the studio's integrations, and the platform health
 * endpoint is deliberately invisible to a studio owner — there is a test
 * asserting exactly that. A studio does not care whether our queue drains; it
 * cares whether its messages arrive, which the notifications log already
 * answers.
 */
export const integrationRouter = Router({ mergeParams: true });

integrationRouter.get(
  '/',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(await getIntegrationStatus(req.tenant!.organizationId));
  }),
);
