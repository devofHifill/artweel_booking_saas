import { config } from '../../config';
import { tokensCss } from '../../lib/design-tokens';
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
 *
 * ONE TEMPLATE, EIGHT PAGES. The home page, pricing, three comparisons and
 * three guides all render through here, which is why the layout branches on
 * what a page IS rather than on its slug: the home page opens on a dark hero,
 * everything else opens on a compact head, and a guide keeps its text in a
 * narrow column while the feature grid and the plans use the full width.
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

/**
 * The mark: concentric rings, a pot seen from directly above the wheel.
 *
 * Inline SVG rather than a file, because an <img> here would be a second
 * request blocking the first paint of a page whose whole argument is that it
 * arrives in one.
 */
const MARK = `<svg class="mark" width="24" height="24" viewBox="0 0 26 26" aria-hidden="true">
<defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="#6e3418"/><stop offset="55%" stop-color="#c06a3c"/>
<stop offset="100%" stop-color="#e0a878"/></linearGradient></defs>
<circle cx="13" cy="13" r="11" fill="none" stroke="url(#m)" stroke-width="2.4"/>
<circle cx="13" cy="13" r="4.5" fill="none" stroke="url(#m)" stroke-width="1.6"/></svg>`;

const STYLES = `
${tokensCss()}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
-webkit-font-smoothing:antialiased}
a{color:var(--clay-text)}
img,svg{max-width:100%}

/* One shell width for structural rows; text sits in a narrower column inside
   it, because a 1080px paragraph is unreadable and a 1080px card grid is not. */
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
/* 36rem is about 73 characters at 17px, measured rather than guessed. The old
   layout ran to 90, which is past the point where the eye loses the start of
   the next line — and the guides are the longest text on the site. */
.prose{max-width:36rem}
.prose p{margin:0 0 15px}

h1{font-size:clamp(2.1rem,4.4vw,3.1rem);line-height:1.06;letter-spacing:-.035em;margin:0 0 16px}
h2{font-size:1.5rem;letter-spacing:-.025em;margin:0 0 12px}
h3{font-size:1.05rem;letter-spacing:-.01em;margin:0 0 6px}
p{margin:0 0 15px}
.lede{font-size:1.18rem;color:var(--muted);margin:0 0 26px;line-height:1.55;max-width:38rem}

/* --- Header --- */
header.site{position:sticky;top:0;z-index:10;
border-bottom:1px solid var(--line);background:var(--card)}
header.site .wrap{display:flex;align-items:center;gap:18px;padding-top:13px;padding-bottom:13px;
flex-wrap:wrap}
.logo{display:inline-flex;align-items:center;gap:9px;font-weight:600;text-decoration:none;
color:var(--ink);letter-spacing:-.02em;font-size:1.15rem}
header nav{display:flex;gap:20px;font-size:.92rem;margin-left:auto;align-items:center;flex-wrap:wrap}
header nav a{color:var(--muted);text-decoration:none}
header nav a:hover{color:var(--clay-text)}

/* --- Buttons --- */
/* The gradient stops at --clay rather than running on to a lighter terracotta:
   the lightest point still carries white text at 5.4:1, and a brighter one
   does not. */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
background:linear-gradient(115deg,var(--clay-dk) 0%,var(--clay) 78%);color:#fff!important;
padding:11px 20px;border-radius:var(--radius-pill);text-decoration:none;font-weight:600;
font-size:.95rem;box-shadow:0 8px 20px rgba(110,52,24,.24);
transition:box-shadow var(--motion-base) var(--ease),filter var(--motion-base) var(--ease)}
.btn:hover{filter:brightness(1.07);box-shadow:0 12px 26px rgba(110,52,24,.32)}
.btn.sm{padding:9px 16px;font-size:.9rem}
.btn.ghost{background:none;color:var(--clay-text)!important;border:1px solid var(--clay);
box-shadow:none}
.btn.ghost:hover{background:var(--clay-lt);filter:none;box-shadow:none}
/* On the dark bands the clay outline disappears, so the ghost goes to glass. */
.dark .btn.ghost{color:#f6efe9!important;border-color:rgba(255,255,255,.3)}
.dark .btn.ghost:hover{background:rgba(255,255,255,.08)}

/* --- Dark bands (hero, closing CTA) --- */
/* Fixed colours, not tokens: this is brand surface and reads the same in both
   themes, so everything on it is written against a known dark ground. */
.dark{position:relative;overflow:hidden;color:#f6efe9;
background:radial-gradient(620px 420px at 82% 88%,rgba(166,82,44,.34),transparent 66%),
linear-gradient(158deg,#33261f 0%,#241a15 52%,#191210 100%)}
.dark::before,.dark::after{content:"";position:absolute;left:50%;top:42%;
border:1px solid rgba(255,255,255,.07);border-radius:50%;
transform:translate(-50%,-50%);pointer-events:none}
.dark::before{width:620px;height:620px}
.dark::after{width:940px;height:940px}
.dark .wrap{position:relative}
.dark h1,.dark h2{color:#f6efe9}
.dark .lede{color:rgba(246,239,233,.74)}

.hero{padding:84px 0 76px}
.eyebrow{margin:0 0 18px;font-size:.8rem;letter-spacing:.1em;text-transform:uppercase;
color:rgba(246,239,233,.55)}
.hero-cta{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.hero-note{color:rgba(246,239,233,.6);font-size:.9rem;margin:0}

/* --- Page head, for everything that is not the home page --- */
.page-head{border-bottom:1px solid var(--line);background:var(--card);padding:52px 0 40px}
.page-head .eyebrow{color:var(--clay-text);margin-bottom:14px}
.page-head .meta{color:var(--muted);font-size:.88rem;margin:-14px 0 20px}

main{padding:56px 0 76px}
section.band{margin:0 0 56px}
section.band:last-child{margin-bottom:0}

/* --- Feature cards --- */
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);
padding:22px 22px 24px;box-shadow:var(--shadow-sm);
transition:box-shadow var(--motion-base) var(--ease),transform var(--motion-base) var(--ease)}
.card:hover{box-shadow:var(--shadow-md);transform:translateY(-2px)}
.card h3{display:flex;align-items:baseline;gap:9px}
.card h3::before{content:"";flex:none;width:7px;height:7px;border-radius:50%;
background:var(--clay);transform:translateY(-2px)}
.card p{margin:0;color:var(--muted);font-size:.95rem;line-height:1.6}

/* --- Prose sections --- */
.prose h2{margin-top:38px}
.prose h2:first-child{margin-top:0}

/* --- Plans --- */
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;
align-items:start}
.plan{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);
padding:24px;display:flex;flex-direction:column;box-shadow:var(--shadow-sm)}
.plan.featured{border-color:var(--clay);box-shadow:var(--shadow-lg)}
.plan-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:2px}
.plan h3{margin:0}
.pop{flex:none;font-size:.7rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
color:var(--clay-text)}
.plan .price{font-size:2.4rem;font-weight:700;letter-spacing:-.03em;margin:6px 0 2px}
.plan .price span{font-size:.9rem;font-weight:400;color:var(--muted);letter-spacing:0}
.plan .blurb{color:var(--muted);font-size:.92rem;margin:6px 0 0}
.plan ul{list-style:none;padding:0;margin:16px 0 22px;color:var(--muted);font-size:.92rem}
.plan li{position:relative;padding-left:22px;margin-bottom:7px}
.plan li::before{content:"";position:absolute;left:2px;top:.55em;width:9px;height:5px;
border-left:1.5px solid var(--clay);border-bottom:1.5px solid var(--clay);
transform:rotate(-45deg)}
.plan .btn{margin-top:auto}

/* --- Being built next --- */
.soon{background:var(--clay-lt);border-radius:var(--radius-lg);padding:24px 26px}
.soon h2{margin:0 0 6px}
.soon .note{color:var(--muted);font-size:.95rem;margin:0 0 12px;max-width:40rem}
.soon ul{margin:0;padding-left:20px;color:var(--muted)}
.soon li{margin-bottom:5px}
.not-yet{display:inline-block;margin-bottom:12px;padding:3px 10px;border-radius:var(--radius-pill);
border:1px solid var(--clay);color:var(--clay-text);font-size:.72rem;font-weight:600;
letter-spacing:.06em;text-transform:uppercase}

/* --- FAQ --- */
.faq{border-top:1px solid var(--line);padding:18px 0}
.faq:last-of-type{border-bottom:1px solid var(--line)}
.faq h3{margin-bottom:5px}
.faq p{margin:0;color:var(--muted)}

/* --- Closing CTA --- */
.cta-band{border-radius:var(--radius-lg);padding:44px 32px;text-align:center}
.cta-inner{position:relative}
.cta-band h2{margin:0 0 10px;font-size:1.7rem;letter-spacing:-.03em}
.cta-band p{color:rgba(246,239,233,.74);margin:0 auto 22px;max-width:34rem}
.cta-band::before{width:420px;height:420px}
.cta-band::after{width:640px;height:640px}

/* --- Footer --- */
footer{border-top:1px solid var(--line);padding:34px 0;color:var(--muted);font-size:.88rem}
footer .wrap{display:flex;gap:18px;flex-wrap:wrap;align-items:center}
footer .logo{font-size:1rem;color:var(--muted)}
footer nav{display:flex;gap:18px;flex-wrap:wrap;margin-left:auto}
footer a{color:var(--muted);text-decoration:none}
footer a:hover{color:var(--clay-text)}

@media(max-width:640px){
/* The nav wraps to a second line on a phone, and a 116px sticky header there
   costs a seventh of the viewport on every scroll. It stays at the top. */
header.site{position:static}
.hero{padding:56px 0 52px}
.page-head{padding:36px 0 28px}
main{padding:38px 0 52px}
section.band{margin-bottom:42px}
.cta-band{padding:34px 22px}
footer nav{margin-left:0}
}
`;

const NAV = `
<header class="site">
  <div class="wrap">
    <a class="logo" href="/">${MARK}Artweel</a>
    <nav>
      <a href="/pricing">Pricing</a>
      <a href="/guides/pricing-mobile-pottery-parties">Guides</a>
      <!-- TEMPORARY demo link — remove with the /demo mount in app.ts -->
      <a href="/demo">Demo</a>
      <a href="/app">Sign in</a>
      <a class="btn sm" href="/app?signup=1">Start free</a>
    </nav>
  </div>
</header>`;

function footer(): string {
  return `
<footer>
  <div class="wrap">
    <a class="logo" href="/">${MARK}Artweel</a>
    <span>&copy; ${new Date().getFullYear()}</span>
    <nav>
      <a href="/pricing">Pricing</a>
      <a href="/alternatives/momence">vs Momence</a>
      <a href="/alternatives/punchpass">vs Punchpass</a>
      <a href="/sitemap.xml">Sitemap</a>
    </nav>
  </div>
</footer>`;
}

function ctaBand(text: string): string {
  return `
<section class="band">
  <div class="cta-band dark">
    <div class="cta-inner">
      <h2>Try it on your own studio</h2>
      <p>${escapeHtml(text)}</p>
      <a class="btn" href="/app?signup=1">Start free for 14 days</a>
    </div>
  </div>
</section>`;
}

function planCards(): string {
  return `<section class="band"><div class="plans">${Object.values(PLANS)
    .map((plan) => {
      const featured = plan.id === 'STUDIO';

      return `
    <div class="plan${featured ? ' featured' : ''}">
      <div class="plan-top">
        <h3>${escapeHtml(plan.name)}</h3>
        ${featured ? '<span class="pop">Most chosen</span>' : ''}
      </div>
      <div class="price">${money(plan.priceCentsMonthly)}<span> / month</span></div>
      <p class="blurb">${escapeHtml(plan.blurb)}</p>
      <ul>
        <li>${plan.maxStaff ?? 'Unlimited'} instructor${plan.maxStaff === 1 ? '' : 's'}</li>
        <li>${plan.maxLocations ?? 'Unlimited'} location${plan.maxLocations === 1 ? '' : 's'}</li>
        ${plan.mobileBookings ? '<li>Mobile and travelling bookings</li>' : ''}
        ${plan.smsReminders ? '<li>Text reminders</li>' : ''}
        ${plan.apiAccess ? '<li>API access</li>' : ''}
      </ul>
      <a class="btn${featured ? '' : ' ghost'}" href="/app?signup=1">Start free</a>
    </div>`;
    })
    .join('')}</div></section>`;
}

/**
 * What kind of page this is, in the reader's words.
 *
 * Derived rather than stored: the shape of a page is already knowable from the
 * content it carries, and a label in the data would be a third place to keep
 * in sync with the slug and the structured data.
 */
function eyebrow(page: Page): string {
  if (page.article) return 'Guide';
  if (page.slug.startsWith('alternatives/')) return 'Comparison';
  if (page.slug === 'pricing') return 'Pricing';
  return '';
}

/**
 * Structured data.
 *
 * FAQ markup is the highest-leverage thing on a page like this: it is what
 * turns a plain blue link into a result that occupies four times the space.
 */
export function structuredData(page: Page, canonical: string): string {
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

  const isHome = page.slug === '';
  const isPricing = page.slug === 'pricing';
  const label = eyebrow(page);

  const body = page.sections
    .map(
      (section) =>
        `<h2>${escapeHtml(section.heading)}</h2>` +
        section.body.map((p) => `<p>${escapeHtml(p)}</p>`).join(''),
    )
    .join('');

  const faqs = page.faqs?.length
    ? `<section class="band"><div class="prose">
      <h2>Common questions</h2>` +
      page.faqs
        .map(
          (faq) =>
            `<div class="faq"><h3>${escapeHtml(faq.q)}</h3><p>${escapeHtml(faq.a)}</p></div>`,
        )
        .join('') +
      `</div></section>`
    : '';

  /* The home page opens on the dark band; every other page opens on a compact
     head. A guide is something somebody is reading, and a full-height hero
     above 2,000 words of it is a wall between them and the first sentence. */
  const head = isHome
    ? `<div class="hero dark">
  <div class="wrap">
    <p class="eyebrow">For ceramics studios</p>
    <h1>${escapeHtml(page.h1)}</h1>
    <p class="lede">${escapeHtml(page.intro)}</p>
    <div class="hero-cta">
      <a class="btn" href="/app?signup=1">Start free for 14 days</a>
      <a class="btn ghost" href="/pricing">See pricing</a>
    </div>
    <p class="hero-note">No card needed. Nothing to install.</p>
  </div>
</div>`
    : `<div class="page-head">
  <div class="wrap">
    <div class="prose">
      ${label ? `<p class="eyebrow">${escapeHtml(label)}</p>` : ''}
      <h1>${escapeHtml(page.h1)}</h1>
      ${
        page.article
          ? `<p class="meta">${escapeHtml(page.article.readingMinutes)} minute read</p>`
          : ''
      }
      <p class="lede">${escapeHtml(page.intro)}</p>
    </div>
  </div>
</div>`;

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
${head}
<main>
  <div class="wrap">
    ${
      isHome
        ? `<section class="band">
      <div class="grid">
      ${SHIPPING_FEATURES.map(
        (feature) =>
          `<div class="card"><h3>${escapeHtml(feature.title)}</h3><p>${escapeHtml(feature.body)}</p></div>`,
      ).join('')}
      </div>
    </section>`
        : ''
    }

    ${isPricing ? planCards() : ''}

    ${body ? `<section class="band"><div class="prose">${body}</div></section>` : ''}

    ${
      isHome
        ? `<section class="band">
      <div class="soon">
        <span class="not-yet">Not available yet</span>
        <h2>Being built next</h2>
        <p class="note">Listed so you know where this is going before you commit
        to it. None of it is available today.</p>
        <ul>${COMING_SOON.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
    </section>`
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
