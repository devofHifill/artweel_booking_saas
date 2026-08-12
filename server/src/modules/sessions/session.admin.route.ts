import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as sessions from './session.admin.service';
import { listSessionsQuerySchema, markRegisterSchema } from './session.schema';

/**
 * Mounted under /api/organizations/:organizationId/sessions.
 *
 * Everything here is `requireMember` rather than `requireAdmin`, deliberately.
 * Taking the register is the instructor's job — the person actually standing
 * in the room — and an admin-only register would be a register nobody fills
 * in.
 */
export const sessionAdminRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

sessionAdminRouter.get(
  '/',
  requireMember,
  validateQuery(listSessionsQuerySchema),
  asyncHandler(async (req, res) => {
    res.json({
      sessions: await sessions.listSessions(
        req.tenant!.organizationId,
        req.query as unknown as {
          from: string;
          to: string;
          staffId?: string;
          locationId?: string;
          courseSeriesId?: string;
          includeCancelled?: boolean;
        },
      ),
    });
  }),
);

sessionAdminRouter.get(
  '/:sessionId/register',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(
      await sessions.getRegister(
        req.tenant!.organizationId,
        id(req, 'sessionId'),
      ),
    );
  }),
);

sessionAdminRouter.post(
  '/:sessionId/register',
  requireMember,
  validateBody(markRegisterSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await sessions.markRegister(
        req.tenant!.organizationId,
        id(req, 'sessionId'),
        req.body.entries,
      ),
    );
  }),
);
