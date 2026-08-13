import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as firings from './firing.service';

/**
 * Mounted under /api/organizations/:organizationId/firings.
 *
 * `requireMember` throughout: packing and firing a kiln is studio work, not an
 * administrative act. Scheduling one is included, unlike class scheduling —
 * whoever is loading the kiln is the person who knows when it can run.
 */
export const firingRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

firingRouter.get(
  '/',
  requireMember,
  validateQuery(
    z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      status: z
        .enum(['SCHEDULED', 'LOADING', 'FIRING', 'COOLING', 'COMPLETE', 'CANCELLED'])
        .optional(),
      resourceId: z.string().uuid().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json({
      firings: await firings.listFirings(
        req.tenant!.organizationId,
        req.query as Parameters<typeof firings.listFirings>[1],
      ),
    });
  }),
);

/** How much work is waiting — the "should I fire today" question. */
firingRouter.get(
  '/queue',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(await firings.firingQueue(req.tenant!.organizationId));
  }),
);

firingRouter.post(
  '/',
  requireMember,
  validateBody(
    z.object({
      resourceId: z.string().uuid(),
      firingType: z.enum(['BISQUE', 'GLAZE']),
      /** Must cover cooling, not just the hours the elements are on. */
      startsAt: z.coerce.date(),
      endsAt: z.coerce.date(),
      cone: z.string().max(10).optional(),
      notes: z.string().max(2000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      firing: await firings.createFiring(req.tenant!.organizationId, req.body),
    });
  }),
);

firingRouter.get(
  '/:firingId',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({
      firing: await firings.getFiring(
        req.tenant!.organizationId,
        id(req, 'firingId'),
      ),
    });
  }),
);

firingRouter.post(
  '/:firingId/pieces',
  requireMember,
  validateBody(
    z.object({ pieceIds: z.array(z.string().uuid()).min(1).max(500) }),
  ),
  asyncHandler(async (req, res) => {
    res.json(
      await firings.loadPieces(
        req.tenant!.organizationId,
        id(req, 'firingId'),
        req.body.pieceIds,
        req.auth?.userId,
      ),
    );
  }),
);

firingRouter.delete(
  '/:firingId/pieces/:pieceId',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(
      await firings.unloadPiece(
        req.tenant!.organizationId,
        id(req, 'firingId'),
        id(req, 'pieceId'),
        req.auth?.userId,
      ),
    );
  }),
);

/** Completing a glaze firing is what tells its owners their work is ready. */
firingRouter.post(
  '/:firingId/status',
  requireMember,
  validateBody(
    z.object({
      status: z.enum([
        'SCHEDULED',
        'LOADING',
        'FIRING',
        'COOLING',
        'COMPLETE',
        'CANCELLED',
      ]),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(
      await firings.updateFiringStatus(
        req.tenant!.organizationId,
        id(req, 'firingId'),
        req.body.status,
        req.auth?.userId,
      ),
    );
  }),
);
