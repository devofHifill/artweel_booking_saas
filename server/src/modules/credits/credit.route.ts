import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as credits from './credit.service';

/**
 * Mounted under /api/organizations/:organizationId/credits.
 *
 * Reading and redeeming are `requireMember`: front desk booking a student into
 * a make-up class is routine. Granting one out of thin air, or withdrawing
 * one, is an owner decision — it is the studio giving away a seat.
 */
export const creditRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

creditRouter.get(
  '/',
  requireMember,
  validateQuery(
    z.object({
      customerId: z.string().uuid().optional(),
      status: z.enum(['AVAILABLE', 'REDEEMED', 'EXPIRED', 'CANCELLED']).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json({
      credits: await credits.listCredits(
        req.tenant!.organizationId,
        req.query as { customerId?: string; status?: string },
      ),
    });
  }),
);

creditRouter.post(
  '/',
  requireAdmin,
  validateBody(
    z.object({
      customerId: z.string().uuid(),
      reason: z.string().max(500).optional(),
      expiresInDays: z.number().int().min(0).max(3650).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      credit: await credits.grantCredit(req.tenant!.organizationId, req.body),
    });
  }),
);

creditRouter.post(
  '/:creditId/redeem',
  requireMember,
  validateBody(z.object({ sessionId: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      await credits.redeemCredit(
        req.tenant!.organizationId,
        id(req, 'creditId'),
        req.body.sessionId,
      ),
    );
  }),
);

creditRouter.delete(
  '/:creditId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({
      credit: await credits.cancelCredit(
        req.tenant!.organizationId,
        id(req, 'creditId'),
      ),
    });
  }),
);
