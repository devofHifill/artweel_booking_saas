import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody } from '../../middleware/validate';
import { requireAdmin } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as activities from './activity.service';
import {
  createClassSchema,
  createDraftSchema,
  createEventSchema,
  editEventSchema,
  previewSchema,
  updateDraftSchema,
} from './activity.schema';

/**
 * Mounted under /api/organizations/:organizationId/activities.
 *
 * Creating what the studio sells is an owner/admin decision, and so are its
 * drafts — a draft is a class or event on its way to being published.
 * Listing published activities stays on /services.
 */
export const activityRouter = Router({ mergeParams: true });

const draftId = (req: { params: Record<string, string | undefined> }) => {
  const value = req.params.draftId;
  if (!value) throw AppError.badRequest('Missing draftId.');
  return value;
};

activityRouter.post(
  '/events',
  requireAdmin,
  validateBody(createEventSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await activities.createEvent(req.tenant!.organizationId, req.body));
  }),
);

activityRouter.post(
  '/classes',
  requireAdmin,
  validateBody(createClassSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await activities.createClass(req.tenant!.organizationId, req.body));
  }),
);

/** The dates and their clashes, while the studio is still choosing. Writes nothing. */
activityRouter.post(
  '/preview',
  requireAdmin,
  validateBody(previewSchema),
  asyncHandler(async (req, res) => {
    res.json(await activities.previewActivity(req.tenant!.organizationId, req.body));
  }),
);

// --- Drafts -----------------------------------------------------------------

activityRouter.get(
  '/drafts',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ drafts: await activities.listDrafts(req.tenant!.organizationId) });
  }),
);

activityRouter.post(
  '/drafts',
  requireAdmin,
  validateBody(createDraftSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      draft: await activities.createDraft(
        req.tenant!.organizationId,
        req.auth?.userId ?? null,
        req.body,
      ),
    });
  }),
);

activityRouter.put(
  '/drafts/:draftId',
  requireAdmin,
  validateBody(updateDraftSchema),
  asyncHandler(async (req, res) => {
    res.json({
      draft: await activities.updateDraft(req.tenant!.organizationId, draftId(req), req.body.data),
    });
  }),
);

activityRouter.delete(
  '/drafts/:draftId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await activities.deleteDraft(req.tenant!.organizationId, draftId(req));
    res.status(204).send();
  }),
);

// --- Editing a published Class or Event ---------------------------------------

const activityId = (req: { params: Record<string, string | undefined> }) => {
  const value = req.params.activityId;
  if (!value || !/^[0-9a-f-]{36}$/i.test(value)) throw AppError.badRequest('Missing activityId.');
  return value;
};

/** Its answers, for the steps to open filled in. */
activityRouter.get(
  '/:activityId/answers',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await activities.getActivityAnswers(req.tenant!.organizationId, activityId(req)));
  }),
);

activityRouter.put(
  '/classes/:activityId',
  requireAdmin,
  validateBody(createClassSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await activities.editActivity(req.tenant!.organizationId, activityId(req), 'CLASS', req.body),
    );
  }),
);

activityRouter.put(
  '/events/:activityId',
  requireAdmin,
  validateBody(editEventSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await activities.editActivity(req.tenant!.organizationId, activityId(req), 'EVENT', req.body),
    );
  }),
);
