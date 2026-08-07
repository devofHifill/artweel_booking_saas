import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as service from './resource.service';

export const resourceRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

const createResourceSchema = z.object({
  name: z.string().min(1).max(120),
  resourceType: z
    .enum(['WHEEL', 'KILN', 'SLAB_ROLLER', 'KIT', 'VEHICLE', 'ROOM', 'OTHER'])
    .default('OTHER'),
  quantity: z.number().int().min(1).max(1000).default(1),
  /**
   * True for anything that cannot be shared for ANY overlapping period —
   * a kiln, a room, a van. False for counted equipment where overlap is legal
   * up to the quantity.
   */
  isExclusive: z.boolean().default(false),
  locationId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().default(true),
});

resourceRouter.get(
  '/',
  requireMember,
  validateQuery(
    z.object({
      includeInactive: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json({
      resources: await service.listResources(
        req.tenant!.organizationId,
        req.query as { includeInactive?: boolean },
      ),
    });
  }),
);

resourceRouter.post(
  '/',
  requireAdmin,
  validateBody(createResourceSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      resource: await service.createResource(req.tenant!.organizationId, req.body),
    });
  }),
);

resourceRouter.patch(
  '/:resourceId',
  requireAdmin,
  validateBody(createResourceSchema.partial()),
  asyncHandler(async (req, res) => {
    res.json({
      resource: await service.updateResource(
        req.tenant!.organizationId,
        id(req, 'resourceId'),
        req.body,
      ),
    });
  }),
);

resourceRouter.delete(
  '/:resourceId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await service.deleteResource(req.tenant!.organizationId, id(req, 'resourceId'));
    res.status(204).send();
  }),
);

/** Maintenance windows and kiln firings that have no booking behind them. */
resourceRouter.post(
  '/:resourceId/blocks',
  requireMember,
  validateBody(
    z.object({
      startsAt: z.coerce.date(),
      endsAt: z.coerce.date(),
      quantity: z.number().int().min(1).max(1000).optional(),
      note: z.string().max(500).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      allocation: await service.blockResource(
        req.tenant!.organizationId,
        id(req, 'resourceId'),
        req.body,
      ),
    });
  }),
);
