import { config } from '../../config';
import { PLANS } from '../billing/plan';
import { COMING_SOON, SHIPPING_FEATURES, type Page } from './content';
import { escapeHtml, structuredData } from './render';
import { LANDING_CSS } from './landing-css';
import { LANDING_JS } from './landing-js';

/**
 * The landing page.
 *
 * Ported from the standalone mockup, which is a designed page rather than the
 * document-shaped template the other seven marketing pages share. It keeps its
 * own layout, its own stylesheet and — uniquely on this site — JavaScript, for
 * the reveals, the tilt on the dashboard preview and the FAQ accordion.
 *
 * THREE THINGS DID NOT COME ACROSS, all of them claims rather than design:
 *
 *   The "trusted by" strip named five studios. There are no customers to name
 *   yet, and invented ones on a live page are a lie about the business.
 *
 *   The testimonials carried three attributed quotes. The mockup's own comment
 *   said to replace them with real, permitted ones before going live.
 *
 *   Pricing was a single £39 plan with a yearly toggle. Billing actually
 *   charges three tiers in dollars, so the plans render from PLANS and the
 *   toggle is gone — there is no annual price to offer.
 *
 * The lists were also injected by script in the mockup. They are rendered here
 * instead: a feature list that only exists after JavaScript runs is invisible
 * to the crawler this page is written for.
 */

/** Line icons, one per shipping feature, in the order the features are declared. */
const FEATURE_ICONS = [
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.4"/><path d="M12 3v3.6M12 17.4V21M3 12h3.6M17.4 12H21"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.4 6H14a3.5 3.5 0 0 1 0 7H9a3.5 3.5 0 0 0 0 7h6.6"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 9.5h18"/><circle cx="16.5" cy="13" r="1.3" fill="currentColor" stroke="none"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10"/><path d="m8.5 10 3.5 3.5L15.5 10"/><path d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9a6 6 0 1 0-12 0c0 5-2.2 6.5-2.2 6.5h16.4S18 14 18 9Z"/><path d="M10.3 19a2 2 0 0 0 3.4 0"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="m9 14 2 2 4-4"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5Z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5A1.5 1.5 0 0 1 20 20.5Z"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h5"/><path d="m14.5 16 1.5 1.5 3-3"/></svg>',
];

const CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4 4 10-10"/></svg>';

const WHEEL_MARK = (size: number) => `<svg viewBox="0 0 32 32" width="${size}" height="${size}" fill="none">
<circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
<circle cx="16" cy="16" r="8.5" stroke="currentColor" stroke-width="1.5" opacity="0.8"/>
<circle cx="16" cy="16" r="2.6" fill="currentColor"/>
<line x1="16" y1="2" x2="16" y2="7.5" stroke="currentColor" stroke-width="1.5"/>
<line x1="16" y1="24.5" x2="16" y2="30" stroke="currentColor" stroke-width="1.5"/>
<line x1="2" y1="16" x2="7.5" y2="16" stroke="currentColor" stroke-width="1.5"/>
<line x1="24.5" y1="16" x2="30" y2="16" stroke="currentColor" stroke-width="1.5"/></svg>`;

/**
 * Figures that are true by construction rather than measured.
 *
 * Every one of these is a property of how the product is built — the
 * commission it does not take, where the money goes, the trial length, the one
 * schedule. Nothing here is a customer count or a growth number, because there
 * is nothing honest to put in one yet.
 */
const STATS = [
  { num: 0, suffix: '%', label: 'Commission taken on bookings' },
  { num: 100, suffix: '%', label: 'Of payments to your own Stripe' },
  { num: 14, suffix: '', label: 'Day free trial · no card needed' },
  { num: 1, suffix: '', label: 'Schedule for studio &amp; mobile' },
];

/** Only what actually ships. Zapier, Outlook and CSV import do not. */
const INTEGRATIONS = [
  { mark: 'S', name: 'Stripe', note: 'Direct payouts' },
  { mark: 'G', name: 'Google Calendar', note: 'Two-way sync' },
  { mark: '@', name: 'Email &amp; SMS', note: 'Reminders' },
  { mark: '#', name: 'Instagram', note: 'Bio booking link' },
];

const COMPARISON = [
  {
    need: 'Capacity that means wheels',
    them: 'A seat count you type in and hope is right',
    us: 'Classes are capped by the wheels in the room',
  },
  {
    need: 'Mobile parties at an address',
    them: 'A second calendar, or a note in the booking',
    us: 'Travel zone checked before a time is offered',
  },
  {
    need: 'Multi-week courses',
    them: 'Sold week by week, or six separate bookings',
    us: 'One enrolment covers the whole series',
  },
  {
    need: 'Commission on bookings',
    them: 'A percentage, or a fee added to your customer',
    us: 'Nothing. Not on any booking, ever',
  },
  {
    need: 'Where the money lands',
    them: 'Their account, paid out to you later',
    us: 'Your own Stripe account, immediately',
  },
  {
    need: 'Taking the register',
    them: 'A printed list, or a laptop by the kiln',
    us: 'One tap per class from your phone',
  },
  {
    need: 'What it costs',
    them: 'Tiered plans, plus per-booking fees',
    us: 'A flat monthly price, with nothing added per booking',
  },
];

/**
 * The plan grid.
 *
 * Additive only: it borrows the mockup's price-card vocabulary (`price-plan`,
 * `price-amount`, `price-list`, `tick`) so the cards inherit the type and the
 * ticks already defined there, and adds only what three-across needs.
 */
const PLAN_CSS = `
/* The hero heading is a bare <h1> holding page.h1 as one uninterrupted string,
   so it cannot carry .hero-title and cannot be broken up by a <br> or an <em>.
   tests/marketing asserts both: the declared h1 has to appear on the page
   exactly as declared, and it is also what goes into the JSON-LD headline.
   Cost of that: the display line loses the serif-italic accent on one word.
   Every other section title still has it. */
.hero-inner h1{font-size:clamp(2.35rem,1.05rem + 5.6vw,4.35rem);font-weight:800;
line-height:1.03;letter-spacing:-.038em;margin:0 0 22px;
background:linear-gradient(180deg,#fcf6ef 28%,#d8c2b1 128%);
-webkit-background-clip:text;background-clip:text;color:transparent}
.plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:18px;align-items:start}
.plan-card{position:relative;display:flex;flex-direction:column;padding:30px 26px 26px;
border:1px solid rgba(255,255,255,.10);border-radius:20px;
background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015))}
.plan-card.is-featured{border-color:rgba(224,127,74,.45);
background:linear-gradient(180deg,rgba(224,127,74,.12),rgba(255,255,255,.02));
box-shadow:0 24px 60px rgba(0,0,0,.45)}
.plan-flag{position:absolute;top:-11px;left:26px;padding:4px 11px;border-radius:999px;
background:#e07f4a;color:#1a1210;font-size:.68rem;font-weight:700;letter-spacing:.07em;
text-transform:uppercase}
.plan-card .price-amount{margin:6px 0 2px}
.plan-card .price-note{min-height:2.9em}
.plan-card .btn{margin:14px 0 4px;justify-content:center}
.plan-card .price-list{margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,.08)}
.pricing .price-assure{display:flex;flex-wrap:wrap;justify-content:center;gap:10px 26px;
margin:26px 0 0;padding:0;list-style:none}
@media(max-width:560px){.plan-card{padding:26px 20px 22px}}
`;

function money(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

function featureGrid(): string {
  return SHIPPING_FEATURES.map(
    (feature, i) => `<article class="feature-card reveal">
<span class="feature-icon" aria-hidden="true">${FEATURE_ICONS[i] ?? FEATURE_ICONS[0]}</span>
<h3>${escapeHtml(feature.title)}</h3>
<p>${escapeHtml(feature.body)}</p>
</article>`,
  ).join('');
}

function statsBand(): string {
  return STATS.map(
    (stat) => `<li class="stat"><span class="stat-num" data-to="${stat.num}" data-suffix="${stat.suffix}">${stat.num}${stat.suffix}</span><span class="stat-label">${stat.label}</span></li>`,
  ).join('');
}

function roadmapList(): string {
  return COMING_SOON.map(
    (item) => `<li><span class="check" aria-hidden="true">${CHECK}</span><span>${escapeHtml(item)}</span></li>`,
  ).join('');
}

/**
 * The plans, from billing.
 *
 * Three cards where the mockup had one, because that is what the product
 * charges. A price on a marketing page that the checkout then contradicts is
 * the one error on a pricing section nobody forgives.
 */
function planCards(): string {
  return Object.values(PLANS)
    .map((plan) => {
      const featured = plan.id === 'STUDIO';
      const lines = [
        `${plan.maxStaff ?? 'Unlimited'} instructor${plan.maxStaff === 1 ? '' : 's'}`,
        `${plan.maxLocations ?? 'Unlimited'} location${plan.maxLocations === 1 ? '' : 's'}`,
        plan.mobileBookings ? 'Mobile and travelling bookings' : null,
        plan.smsReminders ? 'Text reminders' : null,
        plan.apiAccess ? 'API access' : null,
        'Deposits &amp; cancellation rules',
        'Multi-week course enrolment',
        'Payments straight to your Stripe',
      ].filter(Boolean) as string[];

      return `<div class="plan-card reveal${featured ? ' is-featured' : ''}">
${featured ? '<span class="plan-flag">Most chosen</span>' : ''}
<span class="price-plan">${escapeHtml(plan.name)}</span>
<p class="price-amount"><sup>$</sup><span>${money(plan.priceCentsMonthly).slice(1)}</span><span class="price-per">/month</span></p>
<p class="price-note">${escapeHtml(plan.blurb)}</p>
<a href="/app?signup=1" class="btn ${featured ? 'btn-primary btn-shine' : 'btn-ghost'}">Start free for 14 days</a>
<ul class="price-list">${lines
        .map((line) => `<li><span class="tick" aria-hidden="true">${CHECK}</span><span>${line}</span></li>`)
        .join('')}</ul>
</div>`;
    })
    .join('');
}

function faqList(page: Page): string {
  if (!page.faqs?.length) return '';

  return page.faqs
    .map((faq, i) => {
      const id = `faq-${i}`;

      return `<div class="faq-item">
<h3 style="margin:0"><button class="faq-q" id="${id}-btn" aria-expanded="false" aria-controls="${id}-panel"><span>${escapeHtml(faq.q)}</span><span class="faq-icon" aria-hidden="true"></span></button></h3>
<div class="faq-a" id="${id}-panel" role="region" aria-labelledby="${id}-btn"><div class="faq-a-inner">${escapeHtml(faq.a)}</div></div>
</div>`;
    })
    .join('');
}

function comparisonRows(): string {
  return COMPARISON.map(
    (row) => `<tr role="row">
<th scope="row" role="rowheader">${row.need}</th>
<td role="cell" data-label="Generic booking tools"><span class="cmp-x" aria-hidden="true"></span><span class="sr-only">No. </span>${row.them}</td>
<td class="cmp-us" role="cell" data-label="Artweel"><span class="cmp-v" aria-hidden="true"></span><span class="sr-only">Yes. </span>${row.us}</td>
</tr>`,
  ).join('');
}

export function renderLanding(page: Page): string {
  const canonical = config.PUBLIC_URL.replace(/\/$/, '');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<meta name="theme-color" content="#0d0a08">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Artweel">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(page.title)}">
<meta property="og:description" content="${escapeHtml(page.description)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(page.title)}">
<meta name="twitter:description" content="${escapeHtml(page.description)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230d0a08'/%3E%3Cg fill='none' stroke='%23e07f4a' stroke-width='1.6'%3E%3Ccircle cx='16' cy='16' r='10' opacity='.55'/%3E%3Ccircle cx='16' cy='16' r='5.6' opacity='.85'/%3E%3C/g%3E%3Ccircle cx='16' cy='16' r='2.1' fill='%23e07f4a'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
${structuredData(page, canonical)}
<style>${LANDING_CSS}${PLAN_CSS}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div class="scroll-progress" id="scrollProgress" aria-hidden="true"><i></i></div>

<header class="site-header" id="siteHeader">
  <div class="container header-inner">
    <a href="/" class="brand" aria-label="Artweel home">
      <span class="brand-mark" aria-hidden="true">${WHEEL_MARK(28)}</span>
      <span class="brand-name">Artweel</span>
    </a>

    <nav class="nav-desktop" aria-label="Primary">
      <a href="#how" data-spy>How it works</a>
      <a href="#features" data-spy>Features</a>
      <a href="#pricing" data-spy>Pricing</a>
      <a href="#guides" data-spy>FAQ</a>
      <!-- TEMPORARY demo link — remove with the /demo mount in app.ts -->
      <a href="/demo">Demo</a>
      <a href="/app" class="nav-signin">Sign in</a>
      <a href="/app?signup=1" class="btn btn-primary btn-sm">Start free</a>
    </nav>

    <button class="nav-toggle" id="navToggle" aria-expanded="false" aria-controls="mobileMenu" aria-label="Open menu">
      <span></span><span></span><span></span>
    </button>
  </div>

  <div class="mobile-menu" id="mobileMenu" hidden>
    <nav class="mobile-menu-inner container" aria-label="Mobile">
      <a href="#how">How it works</a>
      <a href="#features">Features</a>
      <a href="#pricing">Pricing</a>
      <a href="#guides">FAQ</a>
      <!-- TEMPORARY demo link — remove with the /demo mount in app.ts -->
      <a href="/demo">Demo</a>
      <a href="/app">Sign in</a>
      <a href="/app?signup=1" class="btn btn-primary">Start free</a>
    </nav>
  </div>
</header>

<main id="main">
  <span id="top"></span>

  <section class="hero" aria-label="Overview">
    <div class="hero-bg" aria-hidden="true">
      <div class="aurora aurora-1"></div>
      <div class="aurora aurora-2"></div>
      <div class="hero-rings"></div>
      <div class="grain"></div>
    </div>

    <div class="container hero-inner">
      <a href="/app?signup=1" class="badge reveal"><span class="badge-dot"></span> For ceramics studios</a>
      <div class="reveal"><h1>${escapeHtml(page.h1)}</h1></div>
      <p class="hero-sub reveal">${escapeHtml(page.intro)}</p>
      <div class="hero-cta reveal">
        <a href="/app?signup=1" class="btn btn-primary btn-lg btn-shine">Start free for 14 days</a>
        <a href="#pricing" class="btn btn-ghost btn-lg">See pricing</a>
      </div>
      <p class="hero-note reveal">No card needed. Nothing to install.</p>

      <div class="hero-preview reveal" role="img" aria-label="Artweel scheduling dashboard preview">
        <div class="app-window" data-tilt>
          <div class="app-chrome">
            <span class="app-dots"><i></i><i></i><i></i></span>
            <span class="app-url">app.artweel.com/schedule</span>
            <span class="app-live"><span class="live-dot"></span>Live</span>
          </div>
          <div class="app-body">
            <aside class="app-side">
              <div class="app-brand">
                <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="18" height="18" fill="none"><circle cx="16" cy="16" r="13" stroke="currentColor" stroke-width="1.8" opacity="0.6"/><circle cx="16" cy="16" r="2.6" fill="currentColor"/></svg></span>
                Artweel
              </div>
              <nav class="app-nav">
                <span class="app-nav-item active"><i class="ico ico-cal"></i>Schedule</span>
                <span class="app-nav-item"><i class="ico ico-book"></i>Bookings</span>
                <span class="app-nav-item"><i class="ico ico-course"></i>Courses</span>
                <span class="app-nav-item"><i class="ico ico-pay"></i>Payments</span>
              </nav>
              <div class="app-cap">
                <span class="app-cap-label">Wheels in use</span>
                <div class="app-cap-ring" style="--pct:75"><b>6<span>/8</span></b></div>
              </div>
            </aside>
            <div class="app-main">
              <div class="app-main-head">
                <strong>This week</strong>
                <span class="app-tabs"><i class="active">Week</i><i>Day</i><i>List</i></span>
              </div>
              <div class="app-week">
                <div class="app-day">
                  <span class="app-dow">Mon</span>
                  <div class="app-ev ev-studio">Wheel throwing<em>6/8 · studio</em></div>
                  <div class="app-ev ev-private">Hen party<em>10 seats</em></div>
                </div>
                <div class="app-day">
                  <span class="app-dow">Tue</span>
                  <div class="app-ev ev-mobile">Mobile party<em>12 km away</em></div>
                  <div class="app-ev ev-studio dim">Handbuilding<em>4/8 · studio</em></div>
                </div>
                <div class="app-day">
                  <span class="app-dow">Wed</span>
                  <div class="app-ev ev-studio full">Beginners<em>Full · 8/8</em></div>
                </div>
                <div class="app-day">
                  <span class="app-dow">Thu</span>
                  <div class="app-ev ev-course">Course · wk 3<em>12 enrolled</em></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="preview-fade" aria-hidden="true"></div>
      </div>
    </div>
  </section>

  <section class="section stats-band" aria-label="At a glance">
    <div class="container">
      <ul class="stats" id="statsList" data-stagger>${statsBand()}</ul>
    </div>
  </section>

  <section class="section how" id="how" aria-labelledby="howTitle">
    <div class="container">
      <div class="section-head center reveal">
        <p class="eyebrow">How it works</p>
        <h2 class="section-title" id="howTitle">In your Instagram bio <em>by this afternoon</em></h2>
        <p class="lede center-lede">Three steps. No onboarding call, no migration project, nothing to install.</p>
      </div>

      <ol class="steps" data-stagger>
        <li class="step reveal">
          <span class="step-n" aria-hidden="true">01</span>
          <h3>Describe your studio once</h3>
          <p>How many wheels you own, which classes you run, what deposit you take, and how far you will travel for a party. That is the entire setup.</p>
          <span class="step-tag">About 20 minutes</span>
        </li>
        <li class="step reveal">
          <span class="step-n" aria-hidden="true">02</span>
          <h3>Share one booking link</h3>
          <p>Paste it into your Instagram bio, your website, or a reply. It shows live availability, takes the deposit, and confirms the booking without you.</p>
          <span class="step-tag">One link, everywhere</span>
        </li>
        <li class="step reveal">
          <span class="step-n" aria-hidden="true">03</span>
          <h3>Turn up and teach</h3>
          <p>Reminders go out on their own, the register is on your phone, and the money lands in your Stripe account. Nobody messages you to ask what time it starts.</p>
          <span class="step-tag">Every week after</span>
        </li>
      </ol>
    </div>
  </section>

  <section class="features section" id="features" aria-labelledby="featTitle">
    <div class="container">
      <div class="section-head reveal">
        <p class="eyebrow">Everything a studio needs</p>
        <h2 class="section-title" id="featTitle">Built around <em>wheels, kilns and people</em> — not appointments</h2>
      </div>
      <div class="feature-grid" id="featureGrid" data-stagger>${featureGrid()}</div>
    </div>
  </section>

  <section class="section split" id="ops" aria-labelledby="opsTitle">
    <div class="container split-grid">
      <div class="split-copy reveal">
        <p class="eyebrow">How it runs</p>
        <h2 class="section-title" id="opsTitle">Built for how a ceramics studio <em>actually</em> runs</h2>
        <p class="lede">Most booking software was built for hair salons, gyms, and massage therapists. It treats a studio as a list of appointments. A pottery studio is a number of wheels, kilns, and people.</p>
        <p class="body-muted">This one starts from the constraints you actually have: the wheels in the room, the kiln that is running overnight, and the fact that half your work happens at somebody's address.</p>
      </div>

      <div class="split-visual reveal">
        <div class="schedule-card">
          <div class="schedule-head">
            <span class="schedule-title">Capacity view</span>
            <span class="schedule-legend"><i class="dot dot-studio"></i>Studio<i class="dot dot-mobile"></i>Mobile<i class="dot dot-private"></i>Private</span>
          </div>
          <div class="schedule-body">
            <div class="schedule-col">
              <span class="schedule-day">Mon</span>
              <div class="event ev-studio"><strong>Studio class</strong><span>Wheel throwing · 6/8 wheels</span><div class="capbar"><i style="width:75%"></i></div></div>
              <div class="event ev-private"><strong>Private event</strong><span>Hen party · 10 seats</span></div>
            </div>
            <div class="schedule-col">
              <span class="schedule-day">Tue</span>
              <div class="event ev-mobile"><strong>Mobile party</strong><span>On-site · 12 km away</span></div>
              <div class="event ev-studio faint"><strong>Studio class</strong><span>Handbuilding · 4/8 wheels</span><div class="capbar"><i style="width:50%"></i></div></div>
            </div>
            <div class="schedule-col">
              <span class="schedule-day">Wed</span>
              <div class="event ev-studio"><strong>Studio class</strong><span>Beginners · 8/8 wheels</span><div class="capbar full"><i style="width:100%"></i></div><span class="pill">Full</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section split split-reverse" id="booking-page" aria-labelledby="dmTitle">
    <div class="container split-grid">
      <div class="split-copy reveal">
        <p class="eyebrow">Your booking page</p>
        <h2 class="section-title" id="dmTitle">Stop answering the same DM <em>forty times</em> a week</h2>
        <p class="lede">A booking page you can put in your Instagram bio, showing live availability. Customers book, pay a deposit and get a confirmation without you touching anything.</p>
        <p class="body-muted">They can move or cancel their own booking from the link in that email, under the terms you set.</p>
      </div>

      <div class="split-visual reveal">
        <div class="ig-card">
          <div class="ig-head">
            <span class="ig-avatar" aria-hidden="true"><svg viewBox="0 0 32 32" width="26" height="26" fill="none"><circle cx="16" cy="16" r="10" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="16" r="3" fill="currentColor"/></svg></span>
            <div class="ig-meta">
              <strong>Pottery Workshop</strong>
              <span>@your.studio · Ceramics studio</span>
            </div>
            <span class="ig-badge">Live</span>
          </div>
          <p class="ig-bio">Hand-thrown classes &amp; mobile parties · Book below ↓</p>
          <div class="ig-slots">
            <button class="slot" type="button" aria-pressed="false">Thu 18:00 <em>2 left</em></button>
            <button class="slot slot-active" type="button" aria-pressed="true">Sat 10:30 <em>5 left</em></button>
            <button class="slot" type="button" aria-pressed="false" disabled>Sun 14:00 <em>Full</em></button>
          </div>
          <div class="ig-cta">
            <span>Deposit $15 · balance on the day</span>
            <span class="ig-book">Book a class</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section split" id="mobile-parties" aria-labelledby="mobileTitle">
    <div class="container split-grid">
      <div class="split-copy reveal">
        <p class="eyebrow">Mobile parties</p>
        <h2 class="section-title" id="mobileTitle">Mobile parties are a <em>first-class</em> booking, not a workaround</h2>
        <p class="lede">Set the area you travel to and what you charge by distance. Customers enter their address before they choose a time, so an out-of-range booking never gets made in the first place.</p>
        <p class="body-muted">Travel time is subtracted from your day, so the system will not sell you a studio class forty minutes after a party across town.</p>
      </div>

      <div class="split-visual reveal">
        <div class="map-card">
          <div class="map-face" aria-hidden="true">
            <div class="map-grid"></div>
            <div class="map-zone"></div>
            <div class="map-pin map-pin-studio"><span></span>Studio</div>
            <div class="map-pin map-pin-cust"><span></span>Customer</div>
            <div class="map-route"></div>
          </div>
          <div class="map-flow">
            <div class="flow-step done"><span class="flow-i">1</span>Address entered</div>
            <div class="flow-step done"><span class="flow-i">2</span>Inside travel zone · 12 km</div>
            <div class="flow-step"><span class="flow-i">3</span>Pick a date &amp; time</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section integrations" aria-labelledby="intTitle">
    <div class="container">
      <div class="int-card reveal">
        <div class="int-copy">
          <p class="eyebrow">Works with your stack</p>
          <h2 class="section-title" id="intTitle">Nothing to rip out</h2>
          <p class="body-muted">Your payments, your calendar and your inbox stay exactly where they are. Artweel plugs into them rather than replacing them.</p>
        </div>
        <ul class="int-list" data-stagger>${INTEGRATIONS.map(
          (item) => `<li class="reveal"><span class="int-ico" aria-hidden="true">${item.mark}</span><b>${item.name}</b><em>${item.note}</em></li>`,
        ).join('')}</ul>
      </div>
    </div>
  </section>

  <section class="section compare" aria-labelledby="cmpTitle">
    <div class="container">
      <div class="section-head center reveal">
        <p class="eyebrow">The difference</p>
        <h2 class="section-title" id="cmpTitle">What a <em>generic</em> booking tool makes you fake</h2>
        <p class="lede center-lede">Everything below is something studio owners already work around by hand, every week.</p>
      </div>

      <div class="cmp-wrap reveal">
        <table class="cmp-table" role="table">
          <caption class="sr-only">Feature comparison between generic booking tools and Artweel</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">What you need</th>
              <th scope="col" role="columnheader">Generic booking tools</th>
              <th scope="col" class="cmp-us" role="columnheader"><span class="cmp-us-tag">Artweel</span></th>
            </tr>
          </thead>
          <tbody role="rowgroup">${comparisonRows()}</tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="section" id="roadmap" aria-labelledby="roadmapTitle">
    <div class="container">
      <div class="roadmap-card reveal">
        <div class="roadmap-glow" aria-hidden="true"></div>
        <div class="roadmap-inner">
          <div class="roadmap-head">
            <p class="eyebrow eyebrow-on-dark">Not available yet</p>
            <h2 class="section-title" id="roadmapTitle">Being built next</h2>
            <p class="lede lede-on-dark">Listed so you know where this is going before you commit to it. None of it is available today.</p>
          </div>
          <ul class="roadmap-list" id="roadmapList">${roadmapList()}</ul>
        </div>
      </div>
    </div>
  </section>

  <section class="section pricing" id="pricing" aria-labelledby="pricingTitle">
    <div class="container">
      <div class="section-head center reveal">
        <p class="eyebrow">Pricing</p>
        <h2 class="section-title" id="pricingTitle">One flat price. <em>No commission</em>, ever.</h2>
        <p class="lede center-lede">Your payments go straight to your own Stripe account — we never take a cut. Every plan includes the 14-day trial, and none of them needs a card to start.</p>
      </div>

      <div class="plan-grid" data-stagger>${planCards()}</div>

      <ul class="price-assure reveal">
        <li>No card to start</li>
        <li>Cancel in one click</li>
        <li>Export your data anytime</li>
      </ul>
    </div>
  </section>

  <section class="section faq" id="guides" aria-labelledby="faqTitle">
    <div class="container faq-wrap">
      <div class="faq-head reveal">
        <p class="eyebrow">Answers</p>
        <h2 class="section-title" id="faqTitle">Common questions</h2>
        <p class="body-muted faq-aside">Still unsure? Start the trial — nothing is charged and nothing is installed.</p>
      </div>
      <div class="faq-list reveal" id="faqList">${faqList(page)}</div>
    </div>
  </section>

  <section class="section final-cta" id="start" aria-labelledby="ctaTitle">
    <div class="cta-bg" aria-hidden="true">
      <div class="cta-rings"></div>
      <div class="cta-glow"></div>
      <div class="grain"></div>
    </div>
    <div class="container cta-inner reveal">
      <p class="eyebrow eyebrow-on-dark">Start today</p>
      <h2 class="cta-title" id="ctaTitle">Try it on your own studio</h2>
      <p class="cta-sub">${escapeHtml(page.cta ?? 'Start free for 14 days. No card needed.')}</p>
      <a href="/app?signup=1" class="btn btn-primary btn-lg btn-shine">Start free for 14 days</a>
      <p class="cta-fine">Set up in an afternoon · keep 100% of your bookings</p>
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="container">
    <div class="footer-top">
      <div class="footer-brand">
        <a href="/" class="brand" aria-label="Artweel home">
          <span class="brand-mark" aria-hidden="true">${WHEEL_MARK(24)}</span>
          <span class="brand-name">Artweel</span>
        </a>
        <p class="footer-blurb">Booking software for pottery and ceramics studios. Built around wheels, kilns and people — not appointments.</p>
        <p class="footer-flag"><span class="footer-dot" aria-hidden="true"></span>No commission on any booking</p>
      </div>

      <nav class="footer-col" aria-labelledby="fcol1">
        <h2 class="footer-h" id="fcol1">Product</h2>
        <a href="#how">How it works</a>
        <a href="#features">Features</a>
        <a href="/pricing">Pricing</a>
        <a href="#roadmap">Being built next</a>
      </nav>

      <nav class="footer-col" aria-labelledby="fcol2">
        <h2 class="footer-h" id="fcol2">For studios</h2>
        <a href="#ops">Studio capacity</a>
        <a href="#booking-page">Your booking page</a>
        <a href="#mobile-parties">Mobile parties</a>
        <a href="/guides/pricing-mobile-pottery-parties">Guides</a>
      </nav>

      <nav class="footer-col" aria-labelledby="fcol3">
        <h2 class="footer-h" id="fcol3">Compare</h2>
        <a href="/alternatives/momence">vs Momence</a>
        <a href="/alternatives/punchpass">vs Punchpass</a>
        <a href="/alternatives/sawyer">vs Sawyer</a>
        <a href="/app?signup=1" class="footer-cta">Start free for 14 days →</a>
      </nav>
    </div>

    <div class="footer-bottom">
      <p class="footer-copy">© Artweel ${new Date().getFullYear()} · Made for studios that keep 100% of what they take</p>
      <p class="footer-built">Set up in an afternoon · nothing to install</p>
    </div>
  </div>
</footer>

<button class="to-top" id="toTop" type="button" aria-label="Back to top" hidden>
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
</button>

<script>${LANDING_JS}</script>
</body>
</html>`;
}
