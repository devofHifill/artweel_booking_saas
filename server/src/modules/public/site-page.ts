import { brandCss, resolveBrand } from '../../lib/brand';
import { STYLES, escapeHtml } from './booking-page';
import type { SiteNavItem } from '../site/site.service';

/**
 * One of a studio's own pages — an About, a Contact, a policies page.
 *
 * Shares the booking page's stylesheet and brand resolution rather than
 * carrying its own, so a studio that changes its accent changes every page at
 * once. Two stylesheets pointing at one set of brand columns is how a site
 * ends up half-rebranded, and the half nobody notices is always the page the
 * customer reads before deciding to book.
 */

type RenderInput = {
  org: { name: string; slug: string };
  page: {
    path: string;
    title: string;
    body: string;
    seoTitle: string | null;
    seoDescription: string | null;
  };
  nav: { items: SiteNavItem[]; cta: { label: string; href: string } };
  /** The brand columns, passed through to `resolveBrand` unchanged. */
  brand: Parameters<typeof resolveBrand>[0];
};

/**
 * Plain text into paragraphs.
 *
 * The body is stored as plain text and this is the whole of its formatting:
 * blank lines separate paragraphs, everything is escaped. Deliberately not
 * markdown — a studio owner has no reason to need it, and accepting markup on
 * a page their own customers visit means owning a sanitiser and its CVEs
 * forever.
 *
 * A single newline inside a paragraph becomes a space rather than a <br>,
 * which is what somebody typing into a soft-wrapping textarea means by it.
 */
function paragraphs(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block.replace(/\s*\n\s*/g, ' '))}</p>`)
    .join('\n      ');
}

function renderNav(nav: RenderInput['nav'], currentHref: string): string {
  const links = nav.items
    .map(
      (item) =>
        `<a href="${escapeHtml(item.href)}"${
          item.href === currentHref ? ' aria-current="page"' : ''
        }>${escapeHtml(item.label)}</a>`,
    )
    .join('\n      ');

  return `<nav class="site-nav" aria-label="Site">
      ${links}
      <a class="site-cta" href="${escapeHtml(nav.cta.href)}">${escapeHtml(
        nav.cta.label,
      )}</a>
    </nav>`;
}

export function renderSitePage(input: RenderInput): string {
  const { org, page, nav } = input;

  /* The SEO fields override the page title when set, because a title written
     for a search result ("Pottery classes in Newport — Clay & Co") is rarely
     the one you want as a heading on the page itself. */
  const title = page.seoTitle?.trim() || `${page.title} — ${org.name}`;
  const description = page.seoDescription?.trim() || '';
  const here = `/public/${org.slug}/p/${page.path}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ''}
<meta property="og:title" content="${escapeHtml(title)}">
${description ? `<meta property="og:description" content="${escapeHtml(description)}">` : ''}
<meta property="og:type" content="article">
<style>${STYLES}${brandCss(resolveBrand(input.brand))}
  .site-nav { display:flex; gap:16px; align-items:center; flex-wrap:wrap; margin:0 0 24px; }
  .site-nav a { color:inherit; text-decoration:none; font-weight:500; }
  .site-nav a[aria-current="page"] { text-decoration:underline; }
  /* Pushed to the far end so the button reads as the action rather than as
     one more link in the list. */
  .site-nav .site-cta { margin-left:auto; padding:8px 16px; border-radius:999px;
    background:var(--clay); color:#fff; }
  .site-body { max-width:64ch; }
  .site-body p { line-height:1.6; }
</style>
</head>
<body>
<div class="wrap">
  <header class="studio">
    <h1>${escapeHtml(org.name)}</h1>
  </header>

  ${renderNav(nav, here)}

  <main class="site-body">
    <h2>${escapeHtml(page.title)}</h2>
    ${paragraphs(page.body)}
  </main>
</div>
</body>
</html>`;
}
