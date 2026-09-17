import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import {
  requireAdmin,
  requireAdminOrSelf,
  requireMember,
} from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as service from './schedule.service';

/**
 * Mounted at /schedules/:staffId/... — schedules always belong to a person,
 * and there is no such thing as a studio-wide working pattern here.
 */
export const scheduleRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be written as YYYY-MM-DD.');

scheduleRouter.get(
  '/:staffId/rules',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({
      rules: await service.listRules(
        req.tenant!.organizationId,
        id(req, 'staffId'),
      ),
    });
  }),
);

scheduleRouter.post(
  '/:staffId/rules',
  requireAdmin,
  validateBody(
    z.object({
      ruleType: z.enum(['WORKING', 'BREAK']).default('WORKING'),
      /** iCal RRULE, e.g. FREQ=WEEKLY;BYDAY=TU,TH */
      rrule: z.string().min(3).max(500),
      startMinute: z.number().int().min(0).max(2880),
      endMinute: z.number().int().min(1).max(2880),
      timezone: z.string().max(64).optional(),
      locationId: z.string().uuid().optional().nullable(),
      effectiveFrom: z.coerce.date(),
      effectiveUntil: z.coerce.date().optional().nullable(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      rule: await service.createRule(
        req.tenant!.organizationId,
        id(req, 'staffId'),
        req.body,
      ),
    });
  }),
);

scheduleRouter.delete(
  '/:staffId/rules/:ruleId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await service.deleteRule(
      req.tenant!.organizationId,
      id(req, 'staffId'),
      id(req, 'ruleId'),
    );
    res.status(204).send();
  }),
);

/** Turns a repeat pattern into real dates, so nobody has to trust an RRULE. */
scheduleRouter.get(
  '/:staffId/rules/:ruleId/preview',
  requireMember,
  validateQuery(z.object({ from: localDate, to: localDate })),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as unknown as { from: string; to: string };
    res.json(
      await service.previewRule(
        req.tenant!.organizationId,
        id(req, 'staffId'),
        id(req, 'ruleId'),
        from,
        to,
      ),
    );
  }),
);

scheduleRouter.get(
  '/:staffId/overrides',
  requireMember,
  validateQuery(z.object({ from: localDate.optional() })),
  asyncHandler(async (req, res) => {
    const { from } = req.query as unknown as { from?: string };
    res.json({
      overrides: await service.listOverrides(
        req.tenant!.organizationId,
        id(req, 'staffId'),
        from,
      ),
    });
  }),
);

scheduleRouter.post(
  '/:staffId/overrides',
  /*
    Their OWN time off, or an admin's.

    This comment said "instructors may mark their own time off" from the day it
    was written, and `requireMember` never enforced the word "own" — every
    member could rewrite any colleague's availability, which decides who gets
    offered work. Invisible until S9 made instructor accounts reachable; the
    guard now says what the comment always claimed. The service still refuses
    anything that would strand a booking.
  */
  requireAdminOrSelf(),
  validateBody(
    z.object({
      overrideType: z.enum(['DAY_OFF', 'CUSTOM_HOURS', 'EXTRA_HOURS']),
      localDate,
      startMinute: z.number().int().min(0).max(2880).optional().nullable(),
      endMinute: z.number().int().min(1).max(2880).optional().nullable(),
      reason: z.string().max(500).optional().nullable(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      override: await service.createOverride(
        req.tenant!.organizationId,
        id(req, 'staffId'),
        req.body,
      ),
    });
  }),
);

scheduleRouter.delete(
  '/:staffId/overrides/:overrideId',
  // Same rule as creating one: your own, or an admin's.
  requireAdminOrSelf(),
  asyncHandler(async (req, res) => {
    await service.deleteOverride(
      req.tenant!.organizationId,
      id(req, 'staffId'),
      id(req, 'overrideId'),
    );
    res.status(204).send();
  }),
);
