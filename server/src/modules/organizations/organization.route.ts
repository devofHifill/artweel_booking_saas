import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody } from '../../middleware/validate';
import {
  authenticate,
  requireAdmin,
  requireMember,
  requireRole,
  withOrganization,
} from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import { createOrganizationSchema } from '../auth/auth.schema';
import * as service from './organization.service';
import { listMemberships } from '../auth/auth.service';

export const organizationRouter = Router();

// Everything below requires a signed-in user.
organizationRouter.use(authenticate);

organizationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ memberships: await listMemberships(req.auth!.userId) });
  }),
);

organizationRouter.post(
  '/',
  validateBody(createOrganizationSchema),
  asyncHandler(async (req, res) => {
    const organization = await service.createOrganization(
      req.auth!.userId,
      req.body,
    );
    res.status(201).json({ organization });
  }),
);

// --- Scoped to one organization ------------------------------------------
// withOrganization is the choke point: it proves membership before any
// handler below can touch a single row.

organizationRouter.get(
  '/:organizationId',
  withOrganization(),
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({
      organization: await service.getOrganization(req.tenant!.organizationId),
      role: req.tenant!.role,
    });
  }),
);

organizationRouter.patch(
  '/:organizationId',
  withOrganization(),
  requireAdmin,
  validateBody(
    z.object({
      name: z.string().min(1).max(120).optional(),
      timezone: z.string().max(64).optional(),
      currency: z.string().length(3).optional(),

      /**
       * Studio policy.
       *
       * These columns existed from the credits migration and nothing could
       * write them — not this route, not the seed, not onboarding. Only the
       * tests, reaching past the API. `makeUpCreditsEnabled` defaults to
       * false, so make-up credits were shipped switched off with no switch:
       * a whole workstream that no studio could ever reach.
       *
       * The bounds mirror the CHECK constraints in the migration, so a value
       * the database would reject is refused here with a readable message
       * rather than a 500.
       */
      makeUpCreditsEnabled: z.boolean().optional(),
      makeUpCreditDays: z.number().int().min(0).max(3650).optional(),
      makeUpRequiresNotice: z.boolean().optional(),
      makeUpNoticeHours: z.number().int().min(0).max(720).optional(),
      makeUpCrossCohort: z.boolean().optional(),
      pieceHoldDays: z.number().int().min(0).max(3650).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json({
      organization: await service.updateOrganization(
        req.tenant!.organizationId,
        req.body,
      ),
    });
  }),
);

organizationRouter.get(
  '/:organizationId/members',
  withOrganization(),
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({ members: await service.listMembers(req.tenant!.organizationId) });
  }),
);

organizationRouter.patch(
  '/:organizationId/members/:membershipId',
  withOrganization(),
  requireRole('OWNER'),
  validateBody(
    z.object({
      role: z.enum(['OWNER', 'ADMIN', 'INSTRUCTOR', 'FRONT_DESK']),
    }),
  ),
  asyncHandler(async (req, res) => {
    const membershipId = req.params.membershipId;
    if (!membershipId) throw AppError.badRequest('Missing membershipId.');

    res.json({
      membership: await service.changeMemberRole(
        req.tenant!.organizationId,
        membershipId,
        req.body.role,
      ),
    });
  }),
);

organizationRouter.delete(
  '/:organizationId/members/:membershipId',
  withOrganization(),
  requireRole('OWNER'),
  asyncHandler(async (req, res) => {
    const membershipId = req.params.membershipId;
    if (!membershipId) throw AppError.badRequest('Missing membershipId.');

    await service.removeMember(req.tenant!.organizationId, membershipId);
    res.status(204).send();
  }),
);
