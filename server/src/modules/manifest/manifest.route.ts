import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import * as service from './manifest.service';

/**
 * Mounted under /api/organizations/:organizationId/manifest.
 *
 * Reading is `requireMember`, on the same reasoning as the register it
 * replaces: the person who needs the day's sheet is the instructor standing in
 * the room, and a manifest only an admin can open is a manifest nobody carries.
 *
 * Sending is `requireAdmin`. It mails every instructor on the rota, and that is
 * a studio-wide action rather than a personal one — the same line the product
 * already draws between taking a register and putting a class on the calendar.
 */
export const manifestRouter = Router({ mergeParams: true });

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-08-24.');

manifestRouter.get(
  '/',
  requireMember,
  validateQuery(z.object({ date: localDate })),
  asyncHandler(async (req, res) => {
    res.json(
      await service.getManifest(
        req.tenant!.organizationId,
        (req.query as unknown as { date: string }).date,
      ),
    );
  }),
);

manifestRouter.post(
  '/send',
  requireAdmin,
  validateBody(
    z.object({
      date: localDate,
      /**
       * Optional. Omitted, every instructor on the day's rota gets their own
       * sheet; supplied, only these do — which is what an owner wants when one
       * person says they never got it.
       */
      staffIds: z.array(z.string().uuid()).max(100).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(
      await service.sendManifest(req.tenant!.organizationId, req.body.date, {
        staffIds: req.body.staffIds,
      }),
    );
  }),
);
