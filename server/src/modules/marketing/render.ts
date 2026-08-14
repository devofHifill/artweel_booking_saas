import { config } from '../../config';
import { PLANS } from '../billing/plan';
import {
  COMING_SOON,
  SHIPPING_FEATURES,
  type Page,
} from './content';

/**
 * The marketing site, server-rendered.
 *
 * Same approach as the booking page and for the same reasons: one request,
 * inline CSS, no build step, no CDN. A landing page that needs a JavaScript
 * bundle to show its first paragraph loses both the visitor on a phone and the
 * crawler that decides whether anyone ever sees it.
 *
 * There is no analytics script, no font from a third party and no cookie —
 * which is also why there is no consent banner. A banner on a landing page
 * measurably costs signups, and the only number worth acting on here is which
 * page produced a trial.
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

function money(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

const STYLES = `
:root{--ink:#1f2328;--muted:#5c6570;--clay:#a6522c;--clay-dk:#6e3418;
--clay-lt:#f6ece5;--line:#e4e7ea;--bg:#fffdfb;--card:#fff;--ok:#1f6f43;--r:12px}
@media(prefers-color-scheme:dark){:root{--ink:#eceff3;--muted:#9aa4b0;
--clay-lt:#33200f;--line:#2b3138;--bg:#131619;--card:#1b1f24}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:0 22px}
a{color:var(--clay)}
header.site{border-bottom:1px solid var(--line);background:var(--card)}
header.site .wrap{display:flex;align-items:center;gap:18px;padding-top:14px;padding-bottom:14px;
max-width:1040px;flex-wrap:wrap}
.logo{font-weight:700;text-decoration:none;color:var(--ink);letter-spacing:-.02em;font-size:1.05rem}
header nav{display:flex;gap:16px;font-size:.92rem;margin-left:auto;align-items:center;flex-wrap:wrap}
header nav a{color:var(--muted);text-decoration:none}
header nav a:hover{color:var(--clay)}
.btn{display:inline-block;background:var(--clay);color:#fff!important;padding:9px 17px;
border-radius:9px;text-decoration:none;font-weight:600;font-size:.94rem}
.btn:hover{background:var(--clay-dk)}
.btn.ghost{background:transparent;color:var(--clay)!important;border:1px solid var(--clay)}
main{padding:52px 0 72px}
h1{font-size:2.5rem;line-height:1.15;letter-spacing:-.03em;margin:0 0 14px}
.lede{font-size:1.2rem;color:var(--muted);margin:0 0 26px;line-height:1.55}
h2{font-size:1.4rem;letter-spacing:-.02em;margin:44px 0 12px}
h3{font-size:1.05rem;margin:0 0 6px}
p{margin:0 0 15px}
.hero-cta{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.hero-note{color:var(--muted);font-size:.9rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:26px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:18px}
.card p{margin:0;color:var(--muted);font-size:.95rem}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:14px;margin:26px 0}
.plan{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:20px;
display:flex;flex-direction:column}
.plan.featured{border-color:var(--clay);border-width:2px}
.plan .price{font-size:2rem;font-weight:700;letter-spacing:-.02em;margin:2px 0 2px}
.plan .price span{font-size:.9rem;font-weight:400;color:var(--muted)}
.plan ul{padding-left:19px;margin:12px 0 18px;color:var(--muted);font-size:.92rem}
.plan li{margin-bottom:5px}
.plan .btn{margin-top:auto;text-align:center}
.faq{border-top:1px solid var(--line);padding:16px 0}
.faq h3{margin-bottom:4px}
.faq p{margin:0;color:var(--muted)}
.soon{background:var(--clay-lt);border-radius:var(--r);padding:18px 20px;margin:30px 0}
.soon h2{margin-top:0}
.soon ul{margin:0;padding-left:19px;color:var(--muted)}
.cta-band{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
padding:26px;text-align:center;margin:44px 0 0}
.cta-band h2{margin:0 0 8px}
.cta-band p{color:var(--muted)}
.meta{color:var(--muted);font-size:.88rem;margin:-6px 0 22px}
footer{border-top:1px solid var(--line);padding:26px 0;color:var(--muted);font-size:.88rem}
footer .wrap{display:flex;gap:18px;flex-wrap:wrap;max-width:1040px}
footer a{color:var(--muted)}
@media(max-width:640px){h1{font-size:2rem}main{padding:34px 0 50px}}
`;

const NAV = `
<header class="site">
  <div class="wrap">
    <a class="logo" href="/">Studio&nbsp;Bookings</a>
    <nav>
      <a href="/pricing">Pricing</a>
      <a href="/guides/pricing-mobile-pottery-parties">Guides</a>
      <a href="/app">Sign in</a>
      <a class="btn" href="/app?signup=1">Start free</a>
    </nav>
  </div>
</header>`;

function footer(): string {
  return `
<footer>
  <div class="wrap">
    <span>&copy; ${new Date().getFullYear()} Artweel</span>
    <a href="/pricing">Pricing</a>
    <a href="/alternatives/momence">vs Momence</a>
    <a href="/alternatives/punchpass">vs Punchpass</a>
    <a href="/sitemap.xml">Sitemap</a>
  </div>
</footer>`;
}

function ctaBand(text: string): string {
  return `
<div class="cta-band">
  <h2>Try it on your own studio</h2>
  <p>${escapeHtml(text)}</p>
  <a class="btn" href="/app?signup=1">Start free</a>
</div>`;
}

function planCards(): string {
  return `<div class="plans">${Object.values(PLANS)
    .map(
      (plan) => `
    <div class="plan${plan.id === 'STUDIO' ? ' featured' : ''}">
      <h3>${escapeHtml(plan.name)}</h3>
      <div class="price">${money(plan.priceCentsMonthly)}<span> / month</span></div>
      <p style="color:var(--muted);font-size:.92rem">${escapeHtml(plan.blurb)}</p>
      <ul>
        <li>${plan.maxStaff ?? 'Unlimited'} instructor${plan.maxStaff === 1 ? '' : 's'}</li>
        <li>${plan.maxLocations ?? 'Unlimited'} location${plan.maxLocations === 1 ? '' : 's'}</li>
        ${plan.mobileBookings ? '<li>Mobile and travelling bookings</li>' : ''}
        ${plan.smsReminders ? '<li>Text reminders</li>' : ''}
        ${plan.apiAccess ? '<li>API access</li>' : ''}
      </ul>
      <a class="btn${plan.id === 'STUDIO' ? '' : ' ghost'}" href="/app?signup=1">Start free</a>
    </div>`,
    )
    .join('')}</div>`;
}

/**
 * Structured data.
 *
 * FAQ markup is the highest-leverage thing on a page like this: it is what
 * turns a plain blue link into a result that occupies four times the space.
 */
function structuredData(page: Page, canonical: string): string {
  const blocks: unknown[] = [];

  if (page.slug === '' || page.slug === 'pricing') {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Artweel',
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
      author: { '@type': 'Organization', name: 'Artweel' },
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

export function renderMarketingPage(page: Page): string {
  const canonical = `${config.PUBLIC_URL}/${page.slug}`.replace(/\/$/, '') || config.PUBLIC_URL;

  const body = page.sections
    .map(
      (section) =>
        `<h2>${escapeHtml(section.heading)}</h2>` +
        section.body.map((p) => `<p>${escapeHtml(p)}</p>`).join(''),
    )
    .join('');

  const faqs = page.faqs?.length
    ? `<h2>Common questions</h2>` +
      page.faqs
        .map(
          (faq) =>
            `<div class="faq"><h3>${escapeHtml(faq.q)}</h3><p>${escapeHtml(faq.a)}</p></div>`,
        )
        .join('')
    : '';

  const isHome = page.slug === '';
  const isPricing = page.slug === 'pricing';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="${page.article ? 'article' : 'website'}">
<meta property="og:title" content="${escapeHtml(page.title)}">
<meta property="og:description" content="${escapeHtml(page.description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta name="twitter:card" content="summary_large_image">
${structuredData(page, canonical)}
<style>${STYLES}</style>
</head>
<body>
${NAV}
<main>
  <div class="wrap">
    <h1>${escapeHtml(page.h1)}</h1>
    ${
      page.article
        ? `<p class="meta">${escapeHtml(page.article.readingMinutes)} minute read</p>`
        : ''
    }
    <p class="lede">${escapeHtml(page.intro)}</p>

    ${
      isHome
        ? `<div class="hero-cta">
      <a class="btn" href="/app?signup=1">Start free for 14 days</a>
      <a class="btn ghost" href="/pricing">See pricing</a>
    </div>
    <p class="hero-note">No card needed. Nothing to install.</p>

    <div class="grid">
      ${SHIPPING_FEATURES.map(
        (feature) =>
          `<div class="card"><h3>${escapeHtml(feature.title)}</h3><p>${escapeHtml(feature.body)}</p></div>`,
      ).join('')}
    </div>`
        : ''
    }

    ${isPricing ? planCards() : ''}

    ${body}

    ${
      isHome
        ? `<div class="soon">
      <h2>Being built next</h2>
      <p style="color:var(--muted);margin-bottom:8px">Not available yet — listed
      so you know where this is going before you commit to it.</p>
      <ul>${COMING_SOON.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </div>`
        : ''
    }

    ${faqs}
    ${page.cta ? ctaBand(page.cta) : ''}
  </div>
</main>
${footer()}
</body>
</html>`;
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
