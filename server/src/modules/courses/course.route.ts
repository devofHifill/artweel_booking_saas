import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as courses from './course.service';
import {
  createSeriesSchema,
  enrollSchema,
  generateSessionsSchema,
  listSeriesQuerySchema,
  updateSeriesSchema,
} from './course.schema';

/**
 * Mounted under /api/organizations/:organizationId/courses, so authentication,
 * membership and the subscription gate have already run.
 *
 * Reading a roster is any member's job — the instructor teaching tonight needs
 * it. Creating a cohort, putting it on sale or cancelling one is an
 * owner/admin decision.
 */
export const courseRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

courseRouter.get(
  '/',
  requireMember,
  validateQuery(listSeriesQuerySchema),
  asyncHandler(async (req, res) => {
    res.json({
      series: await courses.listSeries(
        req.tenant!.organizationId,
        req.query as { status?: string; serviceTypeId?: string },
      ),
    });
  }),
);

courseRouter.post(
  '/',
  requireAdmin,
  validateBody(createSeriesSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      series: await courses.createSeries(req.tenant!.organizationId, req.body),
    });
  }),
);

courseRouter.get(
  '/:seriesId',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({
      series: await courses.getSeries(
        req.tenant!.organizationId,
        id(req, 'seriesId'),
      ),
    });
  }),
);

courseRouter.patch(
  '/:seriesId',
  requireAdmin,
  validateBody(updateSeriesSchema),
  asyncHandler(async (req, res) => {
    res.json({
      series: await courses.updateSeries(
        req.tenant!.organizationId,
        id(req, 'seriesId'),
        req.body,
      ),
    });
  }),
);

/**
 * Turns the cohort's recurrence into concrete dates. Separate from creation
 * because it is the irreversible half: once students hold these dates,
 * changing them means telling people the course moved.
 */
courseRouter.post(
  '/:seriesId/sessions',
  requireAdmin,
  validateBody(generateSessionsSchema),
  asyncHandler(async (req, res) => {
    const sessions = await courses.generateSessions(
      req.tenant!.organizationId,
      id(req, 'seriesId'),
      req.body,
    );

    // Surface DST landings rather than burying them. An admin who scheduled a
    // 2:30am class on spring-forward Sunday should hear about it now.
    const dstAffected = sessions.filter((s) => s.resolution !== 'exact');

    res.status(201).json({
      sessions,
      ...(dstAffected.length > 0
        ? {
            warnings: dstAffected.map((s) => ({
              seriesIndex: s.seriesIndex,
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

courseRouter.delete(
  '/:seriesId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({
      series: await courses.cancelCourseSeries(
        req.tenant!.organizationId,
        id(req, 'seriesId'),
      ),
    });
  }),
);

// --- Roster ---------------------------------------------------------------

courseRouter.get(
  '/:seriesId/enrollments',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({
      enrollments: await courses.listRoster(
        req.tenant!.organizationId,
        id(req, 'seriesId'),
      ),
    });
  }),
);

courseRouter.post(
  '/:seriesId/enrollments',
  requireAdmin,
  validateBody(enrollSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      await courses.enrollCustomer(
        req.tenant!.organizationId,
        id(req, 'seriesId'),
        req.body,
      ),
    );
  }),
);

/**
 * Cancelling a place refunds it by default, under the studio's own policy.
 *
 * `?refund=false` is for the case where the studio has already settled with
 * the student off-platform, which is common enough that forcing a double
 * refund would be worse than offering the escape hatch.
 */
courseRouter.delete(
  '/:seriesId/enrollments/:enrollmentId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await courses.cancelEnrollmentAsStudio(
      req.tenant!.organizationId,
      id(req, 'enrollmentId'),
      { refund: req.query.refund !== 'false' },
    );

    res.json({
      enrollment: result.enrollment,
      refundedCents: result.refundedCents,
    });
  }),
);
