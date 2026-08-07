import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as service from './service.service';
import {
  createCategorySchema,
  createServiceSchema,
  listServicesQuerySchema,
  updateServiceSchema,
} from './service.schema';

/**
 * Mounted under /api/organizations/:organizationId/services, so authentication
 * and membership are already proved. Reading is open to any member; changing
 * what the studio sells is an owner/admin decision.
 */
export const serviceRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

// --- Categories (declared before /:serviceId so they are not swallowed) ----

serviceRouter.get(
  '/categories',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({ categories: await service.listCategories(req.tenant!.organizationId) });
  }),
);

serviceRouter.post(
  '/categories',
  requireAdmin,
  validateBody(createCategorySchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      category: await service.createCategory(req.tenant!.organizationId, req.body),
    });
  }),
);

serviceRouter.delete(
  '/categories/:categoryId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await service.deleteCategory(req.tenant!.organizationId, id(req, 'categoryId'));
    res.status(204).send();
  }),
);

// --- Services -------------------------------------------------------------

serviceRouter.get(
  '/',
  requireMember,
  validateQuery(listServicesQuerySchema),
  asyncHandler(async (req, res) => {
    res.json({
      services: await service.listServices(
        req.tenant!.organizationId,
        req.query as { includeInactive?: boolean; bookingMode?: string },
      ),
    });
  }),
);

serviceRouter.post(
  '/',
  requireAdmin,
  validateBody(createServiceSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      service: await service.createService(req.tenant!.organizationId, req.body),
    });
  }),
);

serviceRouter.get(
  '/:serviceId',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({
      service: await service.getService(
        req.tenant!.organizationId,
        id(req, 'serviceId'),
      ),
    });
  }),
);

serviceRouter.patch(
  '/:serviceId',
  requireAdmin,
  validateBody(updateServiceSchema),
  asyncHandler(async (req, res) => {
    res.json({
      service: await service.updateService(
        req.tenant!.organizationId,
        id(req, 'serviceId'),
        req.body,
      ),
    });
  }),
);

serviceRouter.delete(
  '/:serviceId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await service.deleteService(req.tenant!.organizationId, id(req, 'serviceId'));
    res.status(204).send();
  }),
);

// --- Assignment (whole-list replacement, so the UI can PUT a set) ---------

serviceRouter.put(
  '/:serviceId/staff',
  requireAdmin,
  validateBody(z.object({ staffIds: z.array(z.string().uuid()).max(200) })),
  asyncHandler(async (req, res) => {
    res.json(
      await service.setQualifiedStaff(
        req.tenant!.organizationId,
        id(req, 'serviceId'),
        req.body.staffIds,
      ),
    );
  }),
);

serviceRouter.put(
  '/:serviceId/locations',
  requireAdmin,
  validateBody(z.object({ locationIds: z.array(z.string().uuid()).max(200) })),
  asyncHandler(async (req, res) => {
    res.json(
      await service.setServiceLocations(
        req.tenant!.organizationId,
        id(req, 'serviceId'),
        req.body.locationIds,
      ),
    );
  }),
);

serviceRouter.put(
  '/:serviceId/resources',
  requireAdmin,
  validateBody(
    z.object({
      requirements: z
        .array(
          z.object({
            resourceId: z.string().uuid(),
            quantityPerSeat: z.number().int().min(1).max(100).default(1),
          }),
        )
        .max(50),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(
      await service.setServiceResources(
        req.tenant!.organizationId,
        id(req, 'serviceId'),
        req.body.requirements,
      ),
    );
  }),
);
