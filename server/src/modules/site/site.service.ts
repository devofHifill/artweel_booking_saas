import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';

/**
 * Pages on a studio's public site, and the header navigation across them.
 *
 * The booking page is not one of these and never will be: it is rendered from
 * services and availability, it always exists, and a studio must not be able
 * to delete it or leave it in draft. It appears in the navigation as a fixed
 * first item, assembled in `siteNavigation` below rather than stored.
 */

export type SitePageWrite = {
  path: string;
  title: string;
  body: string;
  status?: 'DRAFT' | 'PUBLISHED';
  showInNav?: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

/**
 * Paths a studio may not take.
 *
 * The /p/ prefix already stops a page shadowing `/public/:slug/data` and its
 * siblings, so this is not about route collisions — it is about links that
 * read as something they are not. A page at /p/admin or /p/login is a
 * phishing surface on a domain customers are asked to trust with card
 * details, and it costs nothing to refuse the handful of words that matter.
 */
const RESERVED_PATHS = new Set([
  'admin',
  'login',
  'signin',
  'sign-in',
  'account',
  'billing',
  'payment',
  'checkout',
  'api',
  'data',
]);

function assertPath(path: string) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(path) || path.length > 60) {
    throw AppError.badRequest(
      'A page address may only use lower-case letters, numbers and hyphens.',
    );
  }
  if (RESERVED_PATHS.has(path)) {
    throw AppError.badRequest(`"${path}" is reserved. Pick another address.`);
  }
}

export async function listSitePages(organizationId: string) {
  return prisma.sitePage.findMany({
    where: { organizationId },
    orderBy: [{ navOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function createSitePage(
  organizationId: string,
  input: SitePageWrite,
) {
  assertPath(input.path);

  const clash = await prisma.sitePage.findFirst({
    where: { organizationId, path: input.path },
    select: { title: true },
  });
  if (clash) {
    throw AppError.conflict(`"${clash.title}" already uses that address.`);
  }

  /*
    Added at the end of the navigation rather than the start. A studio adding
    a page has not asked for it to jump in front of About, and an order that
    rearranges itself when you add something is one nobody trusts.
  */
  const last = await prisma.sitePage.aggregate({
    where: { organizationId },
    _max: { navOrder: true },
  });

  return prisma.sitePage.create({
    data: {
      organizationId,
      path: input.path,
      title: input.title.trim(),
      body: input.body,
      /* DRAFT unless asked otherwise: a page is created before it is written,
         and publishing an empty page is never what somebody meant. */
      status: input.status ?? 'DRAFT',
      showInNav: input.showInNav ?? true,
      navOrder: (last._max.navOrder ?? 0) + 1,
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
    },
  });
}

export async function updateSitePage(
  organizationId: string,
  id: string,
  input: Partial<SitePageWrite>,
) {
  const existing = await prisma.sitePage.findFirst({
    where: { id, organizationId },
    select: { id: true },
  });
  if (!existing) throw AppError.notFound('Page not found.');

  if (input.path !== undefined) {
    assertPath(input.path);
    const clash = await prisma.sitePage.findFirst({
      where: { organizationId, path: input.path, id: { not: id } },
      select: { title: true },
    });
    if (clash) {
      throw AppError.conflict(`"${clash.title}" already uses that address.`);
    }
  }

  return prisma.sitePage.update({
    where: { id },
    data: {
      ...(input.path !== undefined ? { path: input.path } : {}),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.showInNav !== undefined ? { showInNav: input.showInNav } : {}),
      ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle } : {}),
      ...(input.seoDescription !== undefined
        ? { seoDescription: input.seoDescription }
        : {}),
    },
  });
}

export async function deleteSitePage(organizationId: string, id: string) {
  const { count } = await prisma.sitePage.deleteMany({
    where: { id, organizationId },
  });
  if (count === 0) throw AppError.notFound('Page not found.');
}

/**
 * Reorders the navigation in one transaction.
 *
 * All or nothing, because a half-applied order is a navigation with two items
 * numbered 3 — which renders in an arbitrary order and looks like the drag
 * did something random rather than that a request failed.
 */
export async function reorderSitePages(organizationId: string, ids: string[]) {
  const owned = await prisma.sitePage.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((p) => p.id));

  for (const id of ids) {
    if (!ownedIds.has(id)) throw AppError.notFound('Page not found.');
  }

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.sitePage.update({ where: { id }, data: { navOrder: index + 1 } }),
    ),
  );

  return listSitePages(organizationId);
}

export type SiteNavItem = {
  label: string;
  href: string;
  /** True for the booking page, which is not a row and cannot be removed. */
  fixed: boolean;
};

/**
 * The header navigation for a studio's public site.
 *
 * PUBLISHED pages only, and only those marked to show. A draft page is
 * reachable by anyone who knows its address — it is not secret, it is
 * unfinished — but it must not be advertised in the header of a live site.
 *
 * The booking page is prepended and always present. It is the reason the site
 * exists, and a studio that hid every page should still have somewhere to
 * send a customer.
 */
export async function siteNavigation(
  organizationId: string,
  slug: string,
): Promise<{ items: SiteNavItem[]; cta: { label: string; href: string } }> {
  const [pages, org] = await Promise.all([
    prisma.sitePage.findMany({
      where: { organizationId, status: 'PUBLISHED', showInNav: true },
      orderBy: [{ navOrder: 'asc' }, { createdAt: 'asc' }],
      select: { path: true, title: true },
    }),
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { navCtaLabel: true, navCtaTarget: true },
    }),
  ]);

  const bookingHref = `/public/${slug}`;

  const items: SiteNavItem[] = [
    { label: 'Book', href: bookingHref, fixed: true },
    ...pages.map((p) => ({
      label: p.title,
      href: `${bookingHref}/p/${p.path}`,
      fixed: false,
    })),
  ];

  /*
    The CTA falls back to the booking page when its target no longer exists —
    a studio can delete the page a button points at, and a header button
    leading to 404 on the page customers are meant to buy from is the worst
    possible place for a dead link.
  */
  const target = org.navCtaTarget;
  const targetExists =
    target && target !== 'booking'
      ? pages.some((p) => p.path === target)
      : true;

  return {
    items,
    cta: {
      label: org.navCtaLabel?.trim() || 'Book now',
      href:
        target && target !== 'booking' && targetExists
          ? `${bookingHref}/p/${target}`
          : bookingHref,
    },
  };
}

/** One published page, for the public renderer. Draft pages 404. */
export async function getPublishedPage(slug: string, path: string) {
  const org = await prisma.organization.findUnique({
    where: { slug },
    /* Brand columns come along so the renderer can paint the page in the
       studio's colours from one query rather than fetching the org twice. */
    select: {
      id: true,
      name: true,
      slug: true,
      brandPreset: true,
      brandAccent: true,
    },
  });
  if (!org) throw AppError.notFound('Studio not found.');

  const page = await prisma.sitePage.findFirst({
    where: { organizationId: org.id, path, status: 'PUBLISHED' },
  });
  if (!page) throw AppError.notFound('Page not found.');

  const nav = await siteNavigation(org.id, org.slug);

  return { org, page, nav };
}

export async function setNavCta(
  organizationId: string,
  input: { label?: string | null; target?: string | null },
) {
  return prisma.organization.update({
    where: { id: organizationId },
    data: {
      ...(input.label !== undefined
        ? { navCtaLabel: input.label?.trim() || null }
        : {}),
      ...(input.target !== undefined
        ? { navCtaTarget: input.target || null }
        : {}),
    },
    select: { navCtaLabel: true, navCtaTarget: true },
  });
}
