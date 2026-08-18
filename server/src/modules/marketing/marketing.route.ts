import { Router } from 'express';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { asyncHandler } from '../../lib/async-handler';
import { rateLimit } from '../../middleware/rate-limit';
import { ALL_PAGES, type Page } from './content';
import { renderMarketingPage, renderRobots, renderSitemap } from './render';
import { renderLanding } from './landing';

export const marketingRouter = Router();

const readLimit = rateLimit({ windowMs: 60_000, max: 240, name: 'marketing' });

const BY_SLUG = new Map<string, Page>(ALL_PAGES.map((page) => [page.slug, page]));

/**
 * Records a page view as an aggregate counter.
 *
 * No cookie, no identifier, nothing that can be tied back to a person — only
 * "this path was viewed N times on this day, from this referring host". That
 * is enough to tell which content works, and it is why the site needs no
 * consent banner.
 *
 * Fire-and-forget: an analytics write must never delay or fail a page.
 */
function recordView(path: string, referrer: string | undefined, source?: string) {
  const day = new Date().toISOString().slice(0, 10);

  // Empty string, never null — see the schema comment. A nullable column in
  // the unique index would make every direct visit its own row.
  let referrerHost = '';
  if (referrer) {
    try {
      // Host only. A full referrer can carry a search query or a private
      // page title, neither of which we have any business storing.
      referrerHost = new URL(referrer).hostname;
    } catch {
      referrerHost = '';
    }
  }

  void prisma.marketingEvent
    .upsert({
      where: {
        day_path_referrerHost_source: {
          day,
          path,
          referrerHost,
          source: source ?? '',
        },
      },
      create: { day, path, referrerHost, source: source ?? '', views: 1 },
      update: { views: { increment: 1 } },
    })
    .catch((err) => {
      logger.debug({ err }, 'Analytics write failed');
    });
}

// --- Machine-readable ------------------------------------------------------

marketingRouter.get(
  '/robots.txt',
  asyncHandler(async (_req, res) => {
    res.type('text/plain').send(renderRobots());
  }),
);

marketingRouter.get(
  '/sitemap.xml',
  asyncHandler(async (_req, res) => {
    res.type('application/xml').send(renderSitemap(ALL_PAGES));
  }),
);

/**
 * The dashboard, which lives somewhere else.
 *
 * Every "Sign in" and "Start free" link on the marketing site points at /app,
 * so this redirect IS the signup funnel. It sends people to APP_URL — the Vite
 * port in development, the dashboard hostname in production.
 *
 * This was hardcoded to `http://localhost:5173` until 2026-08-14, written when
 * the plan was for nginx to serve the built client from this same origin. The
 * deploy later moved to Traefik with a separate `app.` hostname and no host
 * nginx, which left a development fallback serving as production behaviour:
 * staging sent every visitor who clicked "Sign in" to their own machine. It
 * broke nothing that a health check, a smoke test or a log line could see.
 */
marketingRouter.get(
  '/app',
  asyncHandler(async (req, res) => {
    const query = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
      : '';
    res.redirect(302, `${config.APP_URL}${query}`);
  }),
);

// --- Pages -----------------------------------------------------------------

marketingRouter.get(
  '/',
  readLimit,
  asyncHandler(async (req, res) => {
    const page = BY_SLUG.get('')!;
    recordView('/', req.get('referer'), String(req.query.utm_source ?? '') || undefined);
    // The home page is a designed landing page rather than the document
    // template the other seven share, so it renders from its own module.
    res.type('html').send(renderLanding(page));
  }),
);

/**
 * Matched against a KNOWN list of slugs rather than a wildcard lookup.
 *
 * It keeps arbitrary paths from being reflected into a page, and means an
 * unknown URL returns a real 404 — which matters, because a site that answers
 * 200 for every path teaches a crawler that none of its URLs are meaningful.
 */
marketingRouter.get(
  '/:a/:b?',
  readLimit,
  asyncHandler(async (req, res, next) => {
    const slug = [req.params.a, req.params.b].filter(Boolean).join('/');
    const page = BY_SLUG.get(slug);

    // Not ours — hand it to whatever is mounted after (public pages, API).
    if (!page) {
      next();
      return;
    }

    recordView(
      `/${slug}`,
      req.get('referer'),
      String(req.query.utm_source ?? '') || undefined,
    );

    res.type('html').send(renderMarketingPage(page));
  }),
);

/**
 * Read-only traffic summary.
 *
 * Deliberately unauthenticated-free: mounted under the org-scoped router so
 * only a signed-in studio owner can see it. It answers one question — which
 * pages bring people in.
 */
export async function getTrafficSummary(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const rows = await prisma.marketingEvent.groupBy({
    by: ['path'],
    where: { day: { gte: since } },
    _sum: { views: true },
    orderBy: { _sum: { views: 'desc' } },
    take: 25,
  });

  const referrers = await prisma.marketingEvent.groupBy({
    by: ['referrerHost'],
    where: { day: { gte: since }, referrerHost: { not: '' } },
    _sum: { views: true },
    orderBy: { _sum: { views: 'desc' } },
    take: 15,
  });

  /**
   * The number that actually matters: which landing page produced a signup.
   * Page views are a proxy; this is the outcome.
   */
  const signups = await prisma.organization.groupBy({
    by: ['signupLanding'],
    where: { createdAt: { gte: new Date(Date.now() - days * 86_400_000) } },
    _count: { _all: true },
  });

  return {
    days,
    pages: rows.map((row) => ({ path: row.path, views: row._sum.views ?? 0 })),
    referrers: referrers.map((row) => ({
      host: row.referrerHost,
      views: row._sum.views ?? 0,
    })),
    signupsByLanding: signups.map((row) => ({
      landing: row.signupLanding ?? 'direct',
      signups: row._count._all,
    })),
  };
}
