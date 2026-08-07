import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as service from './staff.service';

export const staffRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

const createStaffSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(255),
  phone: z.string().max(32).optional().nullable(),
  bio: z.string().max(4000).optional().nullable(),
  photoUrl: z.string().url().max(1000).optional().nullable(),
  /**
   * Per person, not per studio. A studio running mobile work across a state
   * line genuinely has instructors in two zones, and this one is authoritative
   * for their working hours.
   */
  timezone: z.string().max(64).default('America/New_York'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#A6522C'),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  /** 0 means unlimited. */
  maxBookingsPerDay: z.number().int().min(0).max(100).default(0),
});

const updateStaffSchema = createStaffSchema.partial();
const listQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

staffRouter.get(
  '/',
  requireMember,
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    res.json({
      staff: await service.listStaff(
        req.tenant!.organizationId,
        req.query as { includeInactive?: boolean },
      ),
    });
  }),
);

staffRouter.post(
  '/',
  requireAdmin,
  validateBody(createStaffSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      staff: await service.createStaff(req.tenant!.organizationId, req.body),
    });
  }),
);

staffRouter.get(
  '/:staffId',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({
      staff: await service.getStaff(req.tenant!.organizationId, id(req, 'staffId')),
    });
  }),
);

staffRouter.patch(
  '/:staffId',
  requireAdmin,
  validateBody(updateStaffSchema),
  asyncHandler(async (req, res) => {
    res.json({
      staff: await service.updateStaff(
        req.tenant!.organizationId,
        id(req, 'staffId'),
        req.body,
      ),
    });
  }),
);

staffRouter.delete(
  '/:staffId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await service.deleteStaff(req.tenant!.organizationId, id(req, 'staffId'));
    res.status(204).send();
  }),
);

staffRouter.put(
  '/:staffId/services',
  requireAdmin,
  validateBody(z.object({ serviceTypeIds: z.array(z.string().uuid()).max(200) })),
  asyncHandler(async (req, res) => {
    res.json(
      await service.setStaffServices(
        req.tenant!.organizationId,
        id(req, 'staffId'),
        req.body.serviceTypeIds,
      ),
    );
  }),
);

staffRouter.put(
  '/:staffId/locations',
  requireAdmin,
  validateBody(z.object({ locationIds: z.array(z.string().uuid()).max(200) })),
  asyncHandler(async (req, res) => {
    res.json(
      await service.setStaffLocations(
        req.tenant!.organizationId,
        id(req, 'staffId'),
        req.body.locationIds,
      ),
    );
  }),
);
