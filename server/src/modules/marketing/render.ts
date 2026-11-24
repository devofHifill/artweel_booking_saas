import { config } from '../../config';
import { PLANS } from '../billing/plan';
import { BRAND, type Page } from './content';

/**
 * Helpers shared by the marketing site: HTML escaping, structured data, the
 * sitemap and robots.txt.
 *
 * The pages themselves render in landing.ts: the landing pages through
 * renderLanding, and pricing, the comparisons, the guides and the legal pages
 * through renderDocumentPage, which shares the landing page's header, footer
 * and styles. Until 2026-11-24 those document pages had a darker template of
 * their own here, which made the site read as two sites.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Structured data.
 *
 * FAQ markup is the highest-leverage thing on a page like this: it is what
 * turns a plain blue link into a result that occupies four times the space.
 */
export function structuredData(page: Page, canonical: string): string {
  const blocks: unknown[] = [];

  /*
    The pages that actually quote a price.

    The trade pages joined this list when they started rendering the plan grid:
    a landing page that shows three prices and declares no Offer is asking to
    be summarised without them. Guides and comparison pages stay out — they
    link to pricing rather than stating it.
  */
  if (page.slug === '' || page.slug === 'pricing' || page.slug.startsWith('for/')) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: BRAND,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: page.description,
      offers: Object.values(PLANS).map((plan) => ({
        '@type': 'Offer',
        name: `${plan.name} plan`,
        price: (plan.priceCentsMonthly / 100).toFixed(2),
        priceCurrency: 'USD',
      })),
    });
  }

  if (page.article) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: page.h1,
      description: page.description,
      datePublished: page.article.published,
      mainEntityOfPage: canonical,
      author: { '@type': 'Organization', name: BRAND },
    });
  }

  if (page.faqs?.length) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.q,
        acceptedAnswer: { '@type': 'Answer', text: faq.a },
      })),
    });
  }

  return blocks
    .map(
      (block) =>
        `<script type="application/ld+json">${jsonForScript(block)}</script>`,
    )
    .join('');
}

/** Search engines get an explicit map rather than having to crawl for it. */
export function renderSitemap(pages: Page[]): string {
  const base = config.PUBLIC_URL.replace(/\/$/, '');

  const urls = pages
    .map((page) => {
      const loc = page.slug ? `${base}/${page.slug}` : base;
      // Landing pages matter more than guides; guides earn the links.
      const priority = page.slug === '' ? '1.0' : page.article ? '0.6' : '0.8';

      return `  <url><loc>${escapeHtml(loc)}</loc><priority>${priority}</priority></url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export function renderRobots(): string {
  const base = config.PUBLIC_URL.replace(/\/$/, '');

  return `User-agent: *
Allow: /

# A studio's booking page should be indexed — it is how customers find them.
Allow: /public/

# A booking management link contains the token that authorises it.
Disallow: /public/bookings/

# The dashboard is behind a login and has nothing to index.
Disallow: /app
Disallow: /api/

Sitemap: ${base}/sitemap.xml
`;
}
