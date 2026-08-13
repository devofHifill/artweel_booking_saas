import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as packs from './pack.service';

/**
 * Mounted under /api/organizations/:organizationId/packs.
 *
 * Deciding what to sell and at what price is an owner decision. Selling one to
 * somebody standing at the desk, and looking up what they have left, is front
 * desk work.
 */
export const packRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

packRouter.get(
  '/',
  requireMember,
  validateQuery(z.object({ includeInactive: z.coerce.boolean().optional() })),
  asyncHandler(async (req, res) => {
    res.json({
      packs: await packs.listPacks(
        req.tenant!.organizationId,
        req.query as { includeInactive?: boolean },
      ),
    });
  }),
);

packRouter.post(
  '/',
  requireAdmin,
  validateBody(
    z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      creditCount: z.number().int().min(1).max(200),
      priceCents: z.number().int().min(0).max(10_000_000),
      validityDays: z.number().int().min(0).max(3650).optional(),
      serviceTypeId: z.string().uuid().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      pack: await packs.createPack(req.tenant!.organizationId, req.body),
    });
  }),
);

packRouter.patch(
  '/:packId',
  requireAdmin,
  validateBody(
    z
      .object({
        name: z.string().min(1).max(200),
        description: z.string().max(2000).nullable(),
        creditCount: z.number().int().min(1).max(200),
        priceCents: z.number().int().min(0).max(10_000_000),
        validityDays: z.number().int().min(0).max(3650),
        isActive: z.boolean(),
      })
      .partial(),
  ),
  asyncHandler(async (req, res) => {
    res.json({
      pack: await packs.updatePack(
        req.tenant!.organizationId,
        id(req, 'packId'),
        req.body,
      ),
    });
  }),
);

/** Withdrawn from sale, never deleted — purchases reference it. */
packRouter.delete(
  '/:packId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({
      pack: await packs.deactivatePack(
        req.tenant!.organizationId,
        id(req, 'packId'),
      ),
    });
  }),
);

// --- Purchases ------------------------------------------------------------

packRouter.get(
  '/purchases/all',
  requireMember,
  validateQuery(
    z.object({
      customerId: z.string().uuid().optional(),
      status: z.enum(['PENDING', 'ACTIVE', 'REFUNDED']).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json({
      purchases: await packs.listPurchases(
        req.tenant!.organizationId,
        req.query as { customerId?: string; status?: string },
      ),
    });
  }),
);

/**
 * Sells a pack over the counter.
 *
 * Issues the credits immediately, without payment — the studio has taken the
 * money in the room and the software's job is to record it, not to insist on
 * processing the card itself.
 */
packRouter.post(
  '/:packId/sell',
  requireMember,
  validateBody(z.object({ customerId: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    const organizationId = req.tenant!.organizationId;

    const purchase = await packs.startPurchase(
      organizationId,
      id(req, 'packId'),
      req.body.customerId,
    );
    const issued = await packs.issuePurchaseCredits(organizationId, purchase.id);

    res.status(201).json({ purchase, credits: issued.issued });
  }),
);

packRouter.post(
  '/purchases/:purchaseId/refund',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(
      await packs.refundPurchase(
        req.tenant!.organizationId,
        id(req, 'purchaseId'),
      ),
    );
  }),
);

/** One balance across every source — packs, absences and gifts alike. */
packRouter.get(
  '/balance/:customerId',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(
      await packs.creditBalance(
        req.tenant!.organizationId,
        id(req, 'customerId'),
      ),
    );
  }),
);
