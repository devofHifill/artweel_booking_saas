import { Router } from 'express';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import { prisma } from '../../lib/prisma';
import { PLANS, canWrite } from './plan';
import * as service from './billing.service';

export const billingRouter = Router({ mergeParams: true });

billingRouter.get(
  '/',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({
      billing: await service.getBillingState(req.tenant!.organizationId),
      plans: Object.values(PLANS),
    });
  }),
);

billingRouter.post(
  '/subscribe',
  requireAdmin,
  validateBody(z.object({ plan: z.enum(['SOLO', 'STUDIO', 'PRO']) })),
  asyncHandler(async (req, res) => {
    res.json(
      await service.createSubscriptionCheckout(
        req.tenant!.organizationId,
        req.body.plan,
        req.auth!.email,
      ),
    );
  }),
);

billingRouter.post(
  '/portal',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await service.createBillingPortalSession(req.tenant!.organizationId));
  }),
);

/**
 * Blocks changes when a subscription has lapsed.
 *
 * READ stays open, always. A studio that has stopped paying must still be able
 * to look up tomorrow's bookings and phone the customers — locking them out of
 * their own schedule punishes the wrong people and makes an orderly wind-down
 * impossible.
 *
 * Applied to the routes that create or change things, not to the whole API.
 */
export async function requireActiveSubscription(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    if (!req.tenant) throw AppError.unauthorized();

    // Reads are never gated.
    if (req.method === 'GET' || req.method === 'HEAD') {
      next();
      return;
    }

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: req.tenant.organizationId },
      select: { subscriptionStatus: true },
    });

    if (!canWrite(org.subscriptionStatus)) {
      throw new AppError(
        'Your account is paused. Add a card to start making changes again — ' +
          'your bookings and data are safe.',
        402,
        'SUBSCRIPTION_INACTIVE',
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}
