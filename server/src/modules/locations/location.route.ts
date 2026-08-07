import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as service from './location.service';

export const locationRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

const travelBandSchema = z.object({
  maxKm: z.number().positive().max(1000),
  feeCents: z.number().int().min(0).max(10_000_000),
  minSpendCents: z.number().int().min(0).max(10_000_000).optional(),
});

const createLocationSchema = z.object({
  name: z.string().min(1).max(120),
  locationType: z.enum(['FIXED', 'SERVICE_AREA', 'CUSTOMER_SUPPLIED']).default('FIXED'),
  address: z.string().max(500).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  timezone: z.string().max(64).default('America/New_York'),
  radiusMeters: z.number().int().positive().max(500_000).optional().nullable(),
  travelFeeBands: z.array(travelBandSchema).max(20).optional().nullable(),
  isActive: z.boolean().default(true),
});

const updateLocationSchema = createLocationSchema.partial();

locationRouter.get(
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
      locations: await service.listLocations(
        req.tenant!.organizationId,
        req.query as { includeInactive?: boolean },
      ),
    });
  }),
);

locationRouter.post(
  '/',
  requireAdmin,
  validateBody(createLocationSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      location: await service.createLocation(req.tenant!.organizationId, req.body),
    });
  }),
);

locationRouter.get(
  '/:locationId',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({
      location: await service.getLocation(
        req.tenant!.organizationId,
        id(req, 'locationId'),
      ),
    });
  }),
);

locationRouter.patch(
  '/:locationId',
  requireAdmin,
  validateBody(updateLocationSchema),
  asyncHandler(async (req, res) => {
    res.json({
      location: await service.updateLocation(
        req.tenant!.organizationId,
        id(req, 'locationId'),
        req.body,
      ),
    });
  }),
);

locationRouter.delete(
  '/:locationId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await service.deleteLocation(req.tenant!.organizationId, id(req, 'locationId'));
    res.status(204).send();
  }),
);

/**
 * "Will you come here, and what does it cost?"
 *
 * Open to any member so front desk can answer the phone with it. The public
 * booking flow gets its own unauthenticated version in W1.3.
 */
locationRouter.post(
  '/:locationId/coverage',
  requireMember,
  validateBody(
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(
      await service.checkCoverage(
        req.tenant!.organizationId,
        id(req, 'locationId'),
        req.body,
      ),
    );
  }),
);
