import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as sessions from './session.admin.service';
import {
  createSessionSchema,
  listSessionsQuerySchema,
  markRegisterSchema,
  updateSessionSchema,
} from './session.schema';

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

/**
 * Scheduling is an owner/admin decision, unlike taking the register. An
 * instructor marking who turned up is not the same authority as one putting a
 * new class on the studio's calendar.
 */
sessionAdminRouter.post(
  '/',
  requireAdmin,
  validateBody(createSessionSchema),
  asyncHandler(async (req, res) => {
    const result = await sessions.createClass(
      req.tenant!.organizationId,
      req.body,
    );

    // DST landings are surfaced rather than buried, same as cohort generation.
    const dstAffected = result.created.filter((s) => s.resolution !== 'exact');

    res.status(201).json({
      ...result,
      ...(dstAffected.length > 0
        ? {
            warnings: dstAffected.map((s) => ({
              localDate: s.localDate,
              resolution: s.resolution,
              message:
                s.resolution === 'shifted'
                  ? 'This date falls in a daylight-saving gap; the class was moved forward to the first real time.'
                  : 'This local time occurs twice on this date; the earlier one was used.',
            })),
          }
        : {}),
    });
  }),
);

sessionAdminRouter.patch(
  '/:sessionId',
  requireAdmin,
  validateBody(updateSessionSchema),
  asyncHandler(async (req, res) => {
    res.json({
      session: await sessions.updateClass(
        req.tenant!.organizationId,
        id(req, 'sessionId'),
        req.body,
      ),
    });
  }),
);

sessionAdminRouter.delete(
  '/:sessionId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(
      await sessions.cancelClass(
        req.tenant!.organizationId,
        id(req, 'sessionId'),
      ),
    );
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
