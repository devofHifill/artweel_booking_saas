import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { AppError } from '../../lib/app-error';
import { config } from '../../config';
import { authenticateOptional } from '../../middleware/authenticate';
import { requirePlatformAdmin } from '../../middleware/require-platform-admin';
import { rateLimit } from '../../middleware/rate-limit';
import { validateBody, validateQuery } from '../../middleware/validate';
import { findLiveGrant } from './platform.service';
import { auditContext, listAuditLog } from './audit.service';
import { getStudio, listStudios } from './studios.service';
import { getPlatformMetrics } from './metrics.service';
import { getPlatformHealth } from './health.service';
import {
  availablePlans,
  extendTrial,
  setPlan,
  suspendStudio,
  unsuspendStudio,
} from './studio-admin.service';

/**
 * `/api/platform/*` — Artweel's own operator surface.
 *
 * Mounted OUTSIDE `/api/organizations`, so nothing here passes through
 * `withOrganization`. That is not an oversight: these routes act on platform
 * data — which studios exist, what they pay, whether they are suspended — and
 * there is no tenant to scope them to. Reaching inside a single studio is a
 * different capability with a different design (support sessions, S7) and it
 * does go through the choke point.
 *
 * `authenticateOptional` rather than `authenticate` so that a caller with no
 * token gets the same 404 as a caller with a perfectly good token and no grant.
 */
export const platformRouter = Router();

/**
 * Rationed like the auth routes, and for the same reason.
 *
 * Every request here is answered with a 404 unless the caller holds a grant,
 * which makes the endpoint a cheap oracle to hammer while probing for one. The
 * budget is generous — a real operator loading a dashboard makes a handful of
 * calls — and shares nothing with any other limiter.
 */
platformRouter.use(
  rateLimit({
    windowMs: config.AUTH_RATE_WINDOW_MINUTES * 60_000,
    max: 300,
    name: 'platform',
  }),
);

platformRouter.use(authenticateOptional, requirePlatformAdmin);

/**
 * Discovery for the /admin client, and nothing else.
 *
 * Kept separate from `/api/auth/me` on purpose: the studio dashboard calls that
 * one on every load, and adding a `platformAdmin` field to it would ship the
 * existence of this surface to every customer's browser. The admin client probes
 * here instead and treats a 404 as "not for you".
 */
platformRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const grant = await findLiveGrant(req.platform!.userId);

    res.json({
      platformAdmin: {
        userId: req.platform!.userId,
        grantedAt: grant?.grantedAt ?? null,
        note: grant?.note ?? null,
      },
    });
  }),
);

/**
 * The audit log.
 *
 * Read-only, and there is deliberately no route that writes, edits or deletes a
 * row — entries are only ever created as a side effect of the action they
 * describe, inside its transaction. An endpoint that could author an audit entry
 * on its own would make the log something an operator can compose rather than
 * something that records them.
 */
const auditQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  action: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

platformRouter.get(
  '/audit',
  validateQuery(auditQuerySchema),
  asyncHandler(async (req, res) => {
    res.json({
      entries: await listAuditLog(req.query as z.infer<typeof auditQuerySchema>),
    });
  }),
);

// --- Studios --------------------------------------------------------------

const studioListQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  status: z
    .enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'])
    .optional(),
  plan: z.enum(['SOLO', 'STUDIO', 'PRO']).optional(),
  sort: z.enum(['createdAt', 'name', 'trialEndsAt', 'lastBookingAt']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

platformRouter.get(
  '/organizations',
  validateQuery(studioListQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as z.infer<typeof studioListQuerySchema>;
    res.json(await listStudios(query));
  }),
);

platformRouter.get(
  '/organizations/:organizationId',
  asyncHandler(async (req, res) => {
    res.json(await getStudio(studioId(req)));
  }),
);

// --- Studio write actions -------------------------------------------------

/**
 * Every action below requires a `reason`, and the schema enforces a real one.
 *
 * The reason is the field that makes the audit log worth keeping — "who" and
 * "what" are usually recoverable from other evidence, "why" never is. A minimum
 * length is not bureaucracy: an operator who can satisfy the field with "x" will,
 * and then the log records that somebody typed a character.
 */
const reasonSchema = z
  .string()
  .trim()
  .min(8, 'Give a reason of at least 8 characters — it goes in the audit log.')
  .max(500);

/**
 * Resolves the studio id from the path.
 *
 * A malformed id must 404 here rather than reach Prisma, where a non-uuid comes
 * back as an opaque 500 instead of an answer. Shared by the detail route and
 * every write below so there is one place to get this right.
 */
function studioId(req: Request): string {
  const parsed = z.string().uuid().safeParse(req.params.organizationId);
  if (!parsed.success) {
    throw AppError.notFound('Studio not found.', 'STUDIO_NOT_FOUND');
  }
  return parsed.data;
}

const extendTrialSchema = z.object({
  extendTo: z.coerce.date(),
  reason: reasonSchema,
});

platformRouter.post(
  '/organizations/:organizationId/trial',
  validateBody(extendTrialSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof extendTrialSchema>;

    res.json({
      studio: await extendTrial(
        auditContext(req),
        studioId(req),
        body.extendTo,
        body.reason,
      ),
    });
  }),
);

const setPlanSchema = z.object({
  plan: z.enum(['SOLO', 'STUDIO', 'PRO']),
  /**
   * Defaults to false so a plain plan change never silently marks an account
   * free. Comping is the unusual, consequential one and should have to be asked
   * for.
   */
  comp: z.boolean().default(false),
  reason: reasonSchema,
});

platformRouter.post(
  '/organizations/:organizationId/plan',
  validateBody(setPlanSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof setPlanSchema>;

    res.json({
      studio: await setPlan(auditContext(req), studioId(req), body.plan, {
        comp: body.comp,
        reason: body.reason,
      }),
    });
  }),
);

const reasonOnlySchema = z.object({ reason: reasonSchema });

platformRouter.post(
  '/organizations/:organizationId/suspend',
  validateBody(reasonOnlySchema),
  asyncHandler(async (req, res) => {
    const { reason } = req.body as z.infer<typeof reasonOnlySchema>;
    res.json({
      studio: await suspendStudio(auditContext(req), studioId(req), reason),
    });
  }),
);

platformRouter.post(
  '/organizations/:organizationId/unsuspend',
  validateBody(reasonOnlySchema),
  asyncHandler(async (req, res) => {
    const { reason } = req.body as z.infer<typeof reasonOnlySchema>;
    res.json({
      studio: await unsuspendStudio(auditContext(req), studioId(req), reason),
    });
  }),
);

platformRouter.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    res.json({ plans: availablePlans() });
  }),
);

// --- Overview -------------------------------------------------------------

platformRouter.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    res.json({ metrics: await getPlatformMetrics() });
  }),
);

/**
 * Worker and queue health.
 *
 * Separate from `/api/health`, which answers "can this container serve traffic"
 * for the load balancer and must stay cheap and public. This one answers "is the
 * work actually getting done", which is a different question — and the one that
 * was green throughout C2.1 while three sweeps ran never.
 */
platformRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.json({ health: await getPlatformHealth() });
  }),
);
