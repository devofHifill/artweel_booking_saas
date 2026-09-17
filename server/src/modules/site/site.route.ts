import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as service from './site.service';

/** The studio's own pages, and the navigation across them. */
export const siteRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

const pageWriteSchema = z.object({
  /* Shape checked here for a readable message and again in the service and
     the CHECK constraint, because a path becomes a URL and one arriving from
     a fixture must be no less valid than one typed into the form. */
  path: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and hyphens.')
    .max(60),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(20_000),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
  showInNav: z.boolean().optional(),
  seoTitle: z.string().trim().max(70).nullish(),
  seoDescription: z.string().trim().max(200).nullish(),
});

siteRouter.get(
  '/pages',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({ pages: await service.listSitePages(req.tenant!.organizationId) });
  }),
);

siteRouter.post(
  '/pages',
  requireAdmin,
  validateBody(pageWriteSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      page: await service.createSitePage(
        req.tenant!.organizationId,
        req.body as service.SitePageWrite,
      ),
    });
  }),
);

siteRouter.patch(
  '/pages/:pageId',
  requireAdmin,
  validateBody(pageWriteSchema.partial()),
  asyncHandler(async (req, res) => {
    res.json({
      page: await service.updateSitePage(
        req.tenant!.organizationId,
        id(req, 'pageId'),
        req.body as Partial<service.SitePageWrite>,
      ),
    });
  }),
);

siteRouter.delete(
  '/pages/:pageId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await service.deleteSitePage(req.tenant!.organizationId, id(req, 'pageId'));
    res.status(204).end();
  }),
);

/*
  Registered before `/pages/:pageId` would matter if it shared that prefix; it
  does not, but the order is kept deliberate anyway so a later `/pages/reorder`
  cannot be added above without somebody noticing the param route below it.
*/
siteRouter.put(
  '/navigation/order',
  requireAdmin,
  validateBody(z.object({ ids: z.array(z.string().uuid()).max(100) })),
  asyncHandler(async (req, res) => {
    res.json({
      pages: await service.reorderSitePages(
        req.tenant!.organizationId,
        (req.body as { ids: string[] }).ids,
      ),
    });
  }),
);

siteRouter.put(
  '/navigation/cta',
  requireAdmin,
  validateBody(
    z.object({
      label: z.string().trim().max(40).nullish(),
      /** "booking", or the path of one of this studio's own pages. */
      target: z.string().trim().max(60).nullish(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json({
      cta: await service.setNavCta(
        req.tenant!.organizationId,
        req.body as { label?: string | null; target?: string | null },
      ),
    });
  }),
);
