import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as service from './onboarding.service';

export const onboardingRouter = Router({ mergeParams: true });

onboardingRouter.get(
  '/',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(await service.getOnboardingState(req.tenant!.organizationId));
  }),
);

/** Fills in a working ceramics studio so the owner edits rather than creates. */
onboardingRouter.post(
  '/seed',
  requireAdmin,
  validateBody(
    z.object({
      instructorName: z.string().max(120).optional(),
      instructorEmail: z.string().email().max(255).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const created = await service.seedPotteryDefaults(
      req.tenant!.organizationId,
      req.body,
    );

    res.json({
      created,
      state: await service.getOnboardingState(req.tenant!.organizationId),
    });
  }),
);

onboardingRouter.post(
  '/publish',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const state = await service.getOnboardingState(req.tenant!.organizationId);

    if (!state.readyToPublish) {
      const missing = state.steps
        .filter((s) => !s.optional && !s.done && s.id !== 'publish')
        .map((s) => s.title);

      throw AppError.badRequest(
        `Still to do: ${missing.join(', ')}.`,
        'NOT_READY',
      );
    }

    await service.markPublished(req.tenant!.organizationId);

    res.json(await service.getOnboardingState(req.tenant!.organizationId));
  }),
);
