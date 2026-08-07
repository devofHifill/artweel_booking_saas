import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as service from './policy.service';

export const policyRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

const tierSchema = z.object({
  hoursBefore: z.number().int().min(0).max(8760),
  refundPercent: z.number().int().min(0).max(100),
  creditPercent: z.number().int().min(0).max(100).optional(),
});

const createPolicySchema = z.object({
  name: z.string().min(1).max(120),
  tiers: z.array(tierSchema).min(1).max(10),
  isDefault: z.boolean().default(false),
  noShowFeeCents: z.number().int().min(0).max(10_000_000).default(0),
  allowReschedule: z.boolean().default(true),
  rescheduleCutoffHours: z.number().int().min(0).max(8760).default(24),
});

policyRouter.get(
  '/',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({ policies: await service.listPolicies(req.tenant!.organizationId) });
  }),
);

policyRouter.post(
  '/',
  requireAdmin,
  validateBody(createPolicySchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      policy: await service.createPolicy(req.tenant!.organizationId, req.body),
    });
  }),
);

policyRouter.patch(
  '/:policyId',
  requireAdmin,
  validateBody(createPolicySchema.partial()),
  asyncHandler(async (req, res) => {
    res.json({
      policy: await service.updatePolicy(
        req.tenant!.organizationId,
        id(req, 'policyId'),
        req.body,
      ),
    });
  }),
);

policyRouter.delete(
  '/:policyId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await service.deletePolicy(req.tenant!.organizationId, id(req, 'policyId'));
    res.status(204).send();
  }),
);

/**
 * "What happens if I cancel now?"
 *
 * Same function the refund path uses, so the quote a customer is shown and the
 * money actually moved can never disagree.
 */
policyRouter.post(
  '/:policyId/quote',
  requireMember,
  validateBody(
    z.object({
      amountCents: z.number().int().min(0).max(100_000_000),
      hoursOfNotice: z.number().min(0).max(8760),
    }),
  ),
  asyncHandler(async (req, res) => {
    const policies = await service.listPolicies(req.tenant!.organizationId);
    const policy = policies.find((p) => p.id === id(req, 'policyId'));
    if (!policy) throw AppError.notFound('Policy not found.');

    res.json(
      service.evaluatePolicy(
        policy.tiers as unknown as service.PolicyTier[],
        req.body.amountCents,
        req.body.hoursOfNotice,
      ),
    );
  }),
);
