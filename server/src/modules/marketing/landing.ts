import { config } from '../../config';
import { PLANS, classesLine } from '../billing/plan';
import { BRAND, JUST_SHIPPED, SHIPPING_FEATURES, type Page } from './content';
import { GENERAL, VERTICALS, type Vertical } from './verticals';
import { escapeHtml, structuredData } from './render';
import { LANDING_CSS } from './landing-css';
import { LANDING_JS } from './landing-js';

/**
 * The landing page: the home page and the ten /for/<trade> pages.
 *
 * Redesigned 2026-11-20 ("premium light", LANDING-REDESIGN-PLAN.md). One
 * template; every word comes from the page and its Vertical, so the ten trade
 * pages get the layout for free and still speak in their own nouns.
 *
 * Rules carried over from the previous version, and still binding:
 *
 *   No invented customers, logos, testimonials or growth numbers. The figures
 *   on the page are properties of the product (0% commission, 14-day trial)
 *   or clearly drawn mock-ups.
 *
 *   Plans render from PLANS, so a price here cannot disagree with checkout.
 *   Pro is not sold with API access or a custom domain: neither exists
 *   (billing/plan.ts, FEATURE_ENFORCED).
 *
 *   The page must read in full with JavaScript blocked. The script only adds
 *   motion; reveals are hidden only after it has run, the FAQ is native
 *   <details>, and the calculator renders its default answer server-side.
 *
 *   The <h1> is page.h1 as one uninterrupted string (tests/marketing asserts
 *   it, and it is the JSON-LD headline). The serif accent on its last word is
 *   applied by the script, not by markup.
 */

const ARROW_SVG = '<svg viewBox="0 0 12 12"><path d="M2 6h8M6.5 2.5L10 6l-3.5 3.5"/></svg>';

/** The arrow disc: two arrows, so hover can slide one out and the next in. */
const ARROW = `<span class="arr" aria-hidden="true">${ARROW_SVG}${ARROW_SVG}</span>`;

const GO = '<span class="go" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3 8h10M9 4l4 4-4 4"/></svg></span>';

type ButtonOpts = { size?: 'sm' | 'lg'; glow?: boolean; block?: boolean };

function cls(base: string, opts: ButtonOpts): string {
  return [
    'btn',
    base,
    opts.size ? `btn-${opts.size}` : '',
    opts.block ? 'btn-block' : '',
    opts.glow ? 'glow' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Primary: ink pill with the arrow disc. `glow` adds the ring and halo. */
function primary(href: string, label: string, opts: ButtonOpts = {}): string {
  const extra = opts.glow ? '<span class="bg" aria-hidden="true"></span><span class="glow-halo" aria-hidden="true"></span>' : '';
  return `<a href="${href}" class="${cls('btn-ink', opts)}" data-magnet>${extra}<span class="lbl">${label}</span>${ARROW}</a>`;
}

/** The one orange button: the featured plan. */
function accent(href: string, label: string, opts: ButtonOpts = {}): string {
  return `<a href="${href}" class="${cls('btn-accent', opts)}"><span class="lbl">${label}</span>${ARROW}</a>`;
}

/** Secondary: frosted glass, gradient ring and an arrow on hover. */
function secondary(href: string, label: string, opts: ButtonOpts = {}): string {
  return `<a href="${href}" class="${cls('btn-line', opts)}"><span class="lbl">${label}</span>${GO}</a>`;
}

const BRAND_MARK = `<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="16" height="16" fill="none">
<circle cx="16" cy="16" r="11" stroke="currentColor" stroke-width="2.6"/><circle cx="16" cy="16" r="3.4" fill="currentColor"/></svg></span>`;

/**
 * The rows that are true for every trade. The FIRST row — the capacity claim —
 * is not here: it has to speak in the reader's own nouns, so each vertical
 * supplies its own and `comparisonRows` puts it on top.
 */
const COMPARISON = [
  {
    need: 'Travelling work at an address',
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
    us: 'None, on any booking, ever',
  },
  {
    need: 'Where the money lands',
    them: 'Their account, paid out to you later',
    us: 'Your own Stripe account, immediately',
  },
  {
    need: 'Taking the register',
    them: 'A printed list, or a laptop by the door',
    us: 'One tap per class from your phone',
  },
];

/**
 * The hero switcher on the home page. Four trades chosen for spread — a maker,
 * a makerspace, and two kinds of tour — so the mock-up visibly changes nouns.
 */
const SWITCHER = ['for/pottery', 'for/kayak-tours', 'for/woodworking', 'for/walking-tours'];

/** The footer's trade column: four of the ten, the full set is on the page. */
const FOOTER_VERTICALS = ['for/pottery', 'for/kayak-tours', 'for/walking-tours', 'for/woodworking'];

const bySlug = (slug: string) => VERTICALS.find((vertical) => vertical.slug === slug);

function money(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

function initials(name: string): string {
  return name
    .replace(/&amp;/g, '')
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/&amp;|&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Hero mock-up
// ---------------------------------------------------------------------------

function weekHtml(vertical: Vertical): string {
  return vertical.week
    .map(
      (day, di) => `<div class="dy"><small>${escapeHtml(day.dow)}</small>${day.events
        .map(
          (event, ei) =>
            `<div class="ev ev-${event.kind}${event.state ? ` ${event.state}` : ''}${di === 0 && ei === 0 ? ' hl' : ''}"><b>${escapeHtml(event.title)}</b><span>${escapeHtml(event.meta)}</span></div>`,
        )
        .join('')}</div>`,
    )
    .join('');
}

function gaugeCells(vertical: Vertical): string {
  const { used, total } = vertical.capacity;
  const shown = Math.min(total, 16);
  const filled = total > 0 ? Math.round((used / total) * shown) : 0;
  return Array.from({ length: shown }, (_, i) => `<i${i < filled ? ' class="on"' : ''}></i>`).join('');
}

function gaugeNum(vertical: Vertical): string {
  return `${vertical.capacity.used} <em>/ ${vertical.capacity.total}</em>`;
}

function toastTitle(vertical: Vertical): string {
  return `${escapeHtml(vertical.capacity.label)} · ${vertical.capacity.used} of ${vertical.capacity.total}`;
}

/**
 * The data the home page's switcher swaps in, as inert <template>s. Rendered
 * server-side from the same Vertical data as the trade pages, so the mock-up
 * on the home page can never describe a business the trade page does not.
 */
function switcherTemplates(): string {
  return SWITCHER.map(bySlug)
    .filter((vertical): vertical is Vertical => Boolean(vertical))
    .map(
      (vertical) => `<template data-trade="${escapeHtml(vertical.slug)}">
<div class="t-wk">${weekHtml(vertical)}</div>
<span class="t-label">${escapeHtml(vertical.capacity.label)}</span>
<span class="t-num">${gaugeNum(vertical)}</span>
<span class="t-cells">${gaugeCells(vertical)}</span>
<span class="t-studio">${escapeHtml(vertical.bookingCard.name)}</span>
<span class="t-av">${escapeHtml(initials(vertical.bookingCard.name))}</span>
<span class="t-toast">${toastTitle(vertical)}</span>
</template>`,
    )
    .join('');
}

function switcherButtons(): string {
  return SWITCHER.map(bySlug)
    .filter((vertical): vertical is Vertical => Boolean(vertical))
    .map(
      (vertical, i) =>
        `<button type="button" data-trade="${escapeHtml(vertical.slug)}" aria-pressed="${i === 0}">${escapeHtml(vertical.navLabel)}</button>`,
    )
    .join('');
}

function phoneSlots(vertical: Vertical): string {
  const slots = vertical.bookingCard.slots;
  return slots
    .map(([label, note], i) => {
      const sold = i === slots.length - 1;
      return `<div class="slot${i === 1 ? ' sel' : ''}${sold ? ' sold' : ''}"><span>${escapeHtml(label)}</span><em>${escapeHtml(note)}</em></div>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function capacityRacks(vertical: Vertical): string {
  const { used, total } = vertical.capacity;
  const shown = Math.min(total, 16);
  const filled = total > 0 ? Math.round((used / total) * shown) : 0;
  return Array.from({ length: shown }, (_, i) => `<div class="rk${i < filled ? ' on' : ''}"></div>`).join('');
}

function bento(vertical: Vertical): string {
  const [, , keep, , reminders, calendar, courses, register] = SHIPPING_FEATURES;
  const shown = Math.min(vertical.capacity.total, 16);
  const left = shown - Math.round((vertical.capacity.used / Math.max(vertical.capacity.total, 1)) * shown);
  const first = vertical.week[0]?.events[0]?.title ?? 'Saturday session';
  const slot = vertical.bookingCard.slots[1]?.[0] ?? 'Sat 10:30';

  return `<div class="bento">
  <article class="tile t-cap rv">
    <span class="k">Equipment-aware capacity</span>
    <h3>${escapeHtml(vertical.capacity.headline)}</h3>
    <p>${escapeHtml(vertical.capacity.body)}</p>
    <div class="cap-vis" aria-hidden="true">
      <div class="racks" id="racks" style="grid-template-columns:repeat(${Math.min(shown, 8)},1fr)">${capacityRacks(vertical)}</div>
      <div class="cap-meta">
        <div class="cap-big"><span id="seatsLeft">${left}</span> <em>left to sell</em></div>
        <div class="legend"><span><i style="background:var(--accent)"></i>Booked</span><span><i style="background:#f3f2ef;box-shadow:inset 0 0 0 1px var(--line-2)"></i>Free</span></div>
      </div>
    </div>
  </article>
  <article class="tile t-pay rv d1">
    <span class="k">Payments</span>
    <h3>${escapeHtml(keep!.title)}</h3>
    <p>${escapeHtml(keep!.body)}</p>
    <div class="money" aria-hidden="true">
      <div><span>${escapeHtml(first)}</span><b>$540.00</b></div>
      <div><span>${escapeHtml(BRAND)} fee</span><b style="color:var(--green)">$0.00</b></div>
      <div class="tot"><span>To your Stripe</span><b>$540.00</b></div>
    </div>
  </article>
  <article class="tile t-zone rv d2">
    <span class="k">${escapeHtml(vertical.travel.eyebrow)}</span>
    <h3>${vertical.travel.title}</h3>
    <div class="zone" aria-hidden="true"><span class="ring"></span><span class="pin h"></span><span class="pin c"></span><span class="pin x"></span><span class="tag" style="left:66%;top:12%">12 km</span><span class="tag" style="left:58%;top:84%;color:var(--muted)">Out of range</span></div>
    <ol class="flow">${vertical.travel.flow.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
  </article>
  <article class="tile t-sms rv">
    <span class="k">Reminders</span>
    <h3>${escapeHtml(reminders!.title)}</h3>
    <p>${escapeHtml(reminders!.body)}</p>
    <div class="sms" aria-hidden="true">
      <div class="bub in">Reminder: ${escapeHtml(first)}, ${escapeHtml(slot)} with ${escapeHtml(vertical.bookingCard.name)}. Need to change it? Use the link in your confirmation.<small>1 day before</small></div>
      <div class="bub out">Moved to Sunday, thanks!<small>2 minutes later</small></div>
    </div>
  </article>
  <article class="tile t-course rv d1">
    <span class="k">Courses</span>
    <h3>${escapeHtml(courses!.title)}</h3>
    <p>${escapeHtml(courses!.body)}</p>
    <div class="weeks" aria-hidden="true">${[62, 75, 75, 88, 75, 62]
      .map((h, i) => `<div class="wbar" style="height:${h}%"><span>Wk ${i + 1}</span></div>`)
      .join('')}</div>
  </article>
  <article class="tile t-cal rv">
    <span class="k">Calendar sync</span>
    <h3>${escapeHtml(calendar!.title)}</h3>
    <p>${escapeHtml(calendar!.body)}</p>
    <div class="cal" aria-hidden="true">
      <div class="g"><span>${escapeHtml(first)}</span><em>Synced</em></div>
      <div class="b"><span>Dentist (your calendar)</span><em>Slot blocked</em></div>
    </div>
  </article>
  <article class="tile t-reg rv d1">
    <span class="k">Attendance</span>
    <h3>${escapeHtml(register!.title)}</h3>
    <p>${escapeHtml(register!.body)}</p>
    <div class="ticks" aria-hidden="true"><span><i>✓</i>Amira</span><span><i>✓</i>Jonah</span><span><i>✓</i>Sofia</span><span class="no"><i>–</i>Leo</span></div>
  </article>
  <article class="tile t-new rv">
    <div><span class="k">Just shipped</span><h3 style="font-size:30px">Four more things you used to do by hand.</h3><p>On top of everything above, and included in every plan.</p></div>
    <ul class="chips">${JUST_SHIPPED.map(
      (item) =>
        `<li class="chipx"><b>${escapeHtml(item.title)} <em>New</em></b><span>${escapeHtml(item.body)}</span></li>`,
    ).join('')}</ul>
  </article>
</div>`;
}

function comparisonRows(vertical: Vertical): string {
  return [vertical.compare, ...COMPARISON]
    .map(
      (row) => `<tr>
<th scope="row">${row.need}</th>
<td class="them" data-label="Generic booking tools"><span class="mk" aria-hidden="true">✕</span>${row.them}</td>
<td class="us" data-label="${escapeHtml(BRAND)}"><span class="mk" aria-hidden="true">✓</span>${row.us}</td>
</tr>`,
    )
    .join('');
}

function tour(vertical: Vertical): string {
  const card = vertical.bookingCard;
  const publicHost = new URL(config.PUBLIC_URL).host;
  const link = `${publicHost}/public/${slugify(card.name)}`;
  const first = vertical.week[0]?.events[0]?.title ?? 'Saturday session';

  return `<div class="tour">
  <div>
    <div class="tstep act" data-step="0"><div class="num">01 / 03</div><h3>Describe your business once.</h3><p>${escapeHtml(vertical.setupStep)}</p><small>About 20 minutes</small></div>
    <div class="tstep" data-step="1"><div class="num">02 / 03</div><h3>Share one booking link.</h3><p>Paste it into your Instagram bio, your website or a reply. It shows live availability, takes the deposit and confirms the booking without you.</p><small>One link, everywhere</small></div>
    <div class="tstep" data-step="2"><div class="num">03 / 03</div><h3>Turn up and run it.</h3><p>Reminders go out on their own, the register is on your phone, and the money lands in your Stripe account. Nobody messages you to ask what time it starts.</p><small>Every week after</small></div>
  </div>
  <div class="tvis" aria-hidden="true">
    <div class="scene act">
      <div class="card-ui">
        <h4>What do you work with?</h4><p class="hint">Setup · step 3 of 4</p>
        <div class="fld"><span>${escapeHtml(vertical.capacity.label)}</span><b>${vertical.capacity.total} at once</b></div>
        <div class="fld focus"><span>Travel area</span><b>15 km · +$20</b></div>
        <div class="fld"><span>Deposit</span><b>$15 per booking</b></div>
        <div class="fld"><span>Cancellation terms</span><b>Your rules</b></div>
        <div class="prog"><span></span></div>
      </div>
    </div>
    <div class="scene">
      <div class="card-ui">
        <h4>Your booking link is ready</h4><p class="hint">Live availability, deposits and confirmations</p>
        <div class="linkbox"><span>${escapeHtml(link)}</span><em>Copy</em></div>
        <p class="copied">✓ Copied · paste it in your bio</p>
        <div class="ig"><span class="ig-ring"><span>${escapeHtml(initials(card.name))}</span></span><div><b>${escapeHtml(card.handle.replace(/^@/, ''))}</b><p>${card.bio}<br><span>${escapeHtml(link)}</span></p></div></div>
      </div>
    </div>
    <div class="scene">
      <div class="card-ui">
        <h4>${escapeHtml(first)} · ${escapeHtml(card.slots[1]?.[0] ?? '')}</h4><p class="hint">Register</p>
        <div class="reg"><span class="av">AM</span><span>Amira M.</span><i class="y">✓</i></div>
        <div class="reg"><span class="av" style="background:var(--blue-soft);color:var(--blue)">JT</span><span>Jonah T.</span><i class="y">✓</i></div>
        <div class="reg"><span class="av" style="background:var(--green-soft);color:var(--green)">SR</span><span>Sofia R.</span><i class="y">✓</i></div>
        <div class="reg"><span class="av">LK</span><span>Leo K.</span><i class="n">–</i></div>
        <div class="payline"><span>Paid to your Stripe today</span><b>$540.00</b></div>
      </div>
    </div>
  </div>
</div>`;
}

/** Default calculator state, rendered server-side so it reads without JS. */
const CALC = { revenue: 6000, rate: 0.05 };

function calculator(): string {
  const planYear = (PLANS.STUDIO.priceCentsMonthly / 100) * 12;
  const comYear = CALC.revenue * CALC.rate * 12;
  const top = Math.max(comYear, planYear);
  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

  return `<div class="calc">
  <div class="calc-in rv">
    <label for="revIn">Your monthly booking revenue</label>
    <div class="rev"><span id="revOut">${usd(CALC.revenue)}</span><small> /month</small></div>
    <input type="range" id="revIn" min="1000" max="30000" step="500" value="${CALC.revenue}" data-plan="${planYear}">
    <div class="scale" aria-hidden="true"><span>$1K</span><span>$10K</span><span>$20K</span><span>$30K</span></div>
    <span class="lbl" style="margin-top:34px">A tool that takes, per booking</span>
    <div class="rates" role="group" aria-label="Commission rate to compare">
      <button type="button" data-rate="0.03" aria-pressed="false">3%</button>
      <button type="button" data-rate="0.05" aria-pressed="true">5%</button>
      <button type="button" data-rate="0.08" aria-pressed="false">8%</button>
    </div>
  </div>
  <div class="calc-out rv d1" aria-live="polite">
    <span class="lbl">You'd keep, every year</span>
    <div class="keep" id="keep">${usd(comYear - planYear)}</div>
    <p class="keep-sub">more than with a <span id="rateTxt">5%</span> commission tool, on the ${escapeHtml(PLANS.STUDIO.name)} plan.</p>
    <div class="vs">
      <div class="vsr"><span>Commission</span><span class="bar"><span id="comBar" style="background:#6b6f7a;width:${(comYear / top) * 100}%"></span></span><b id="comYear">${usd(comYear)}</b></div>
      <div class="vsr"><span>${escapeHtml(BRAND)}</span><span class="bar"><span id="planBar" style="background:var(--accent);width:${(planYear / top) * 100}%"></span></span><b>${usd(planYear)}</b></div>
    </div>
    <p class="calc-note">Per year. Illustrative: Stripe's card processing fees apply either way.</p>
  </div>
</div>`;
}

/**
 * The plans, from billing. A price here that the checkout then contradicts is
 * the one error on a pricing section nobody forgives.
 */
function planCards(): string {
  return Object.values(PLANS)
    .map((plan, i) => {
      const featured = plan.id === 'STUDIO';
      const lines = [
        `${plan.maxStaff ?? 'Unlimited'} instructor${plan.maxStaff === 1 ? '' : 's'}`,
        `${plan.maxLocations ?? 'Unlimited'} location${plan.maxLocations === 1 ? '' : 's'}`,
        classesLine(plan),
        'Unlimited events',
        plan.mobileBookings ? 'Mobile and travelling bookings' : null,
        plan.smsReminders ? 'Text reminders' : null,
        plan.courseSeries ? 'Multi-week courses' : null,
        'Deposits and cancellation rules',
        'Payments straight to your Stripe',
      ].filter(Boolean) as string[];

      return `<div class="plan rv${i ? ` d${i}` : ''}${featured ? ' featured' : ''}">
<div class="plan-name">${escapeHtml(plan.name)}${featured ? '<span class="plan-flag">Most chosen</span>' : ''}</div>
<p class="price"><sup>$</sup>${money(plan.priceCentsMonthly).slice(1)}<small> /month</small></p>
<p class="plan-note">${escapeHtml(plan.blurb)}</p>
${featured ? accent('/app?signup=1', 'Start free for 14 days', { block: true }) : secondary('/app?signup=1', 'Start free for 14 days', { block: true })}
<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
</div>`;
    })
    .join('');
}

function faqList(page: Page): string {
  return (page.faqs ?? [])
    .map(
      (faq, i) =>
        `<details${i === 0 ? ' open' : ''}><summary>${escapeHtml(faq.q)}<i aria-hidden="true"></i></summary><p>${escapeHtml(faq.a)}</p></details>`,
    )
    .join('');
}

/**
 * Who it's for. On a trade page the grid still renders with that trade
 * marked, so a visitor who landed on the wrong one can move without going
 * back to the root.
 */
function tradeGrid(current: Vertical): string {
  return VERTICALS.map((vertical) => {
    const inner = `<span class="cnt">${String(vertical.capacity.total).padStart(2, '0')}</span><span class="res">${escapeHtml(vertical.capacity.label)}</span><b>${escapeHtml(vertical.navLabel)}</b>`;
    return vertical.slug === current.slug
      ? `<li><span class="tr current" aria-current="page">${inner}</span></li>`
      : `<li><a class="tr" href="/${vertical.slug}">${inner}</a></li>`;
  }).join('');
}

function marquee(): string {
  const items = VERTICALS.map(
    (vertical) =>
      `<span>${escapeHtml(vertical.navLabel)} <em>${String(vertical.capacity.total).padStart(2, '0')} · ${escapeHtml(vertical.capacity.label.toLowerCase())}</em></span>`,
  ).join('');
  return items + items;
}

// ---------------------------------------------------------------------------
// Header menus
// ---------------------------------------------------------------------------

const CHEVRON = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5"/></svg>';

const icon = (d: string) =>
  `<span class="mi-ic" aria-hidden="true"><svg viewBox="0 0 24 24">${d}</svg></span>`;

/**
 * Product menu: each entry points at the section of THIS page that shows it,
 * so it works the same on the home page and on every trade page.
 */
const PRODUCT_LINKS = [
  {
    href: '#features',
    title: 'Equipment-aware capacity',
    note: 'Sessions capped by what you own',
    icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.4"/>',
  },
  {
    href: '#features',
    title: 'Payments and deposits',
    note: 'Straight to your Stripe, 0% fee',
    icon: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/>',
  },
  {
    href: '#how',
    title: 'Booking link',
    note: 'For your bio, site or a reply',
    icon: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  },
  {
    href: '#features',
    title: 'Courses and register',
    note: 'Multi-week runs, one-tap attendance',
    icon: '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="m9 14 2 2 4-4"/>',
  },
  {
    href: '#features',
    title: 'Waitlists and class packs',
    note: 'Plus make-up credits and piece tracking',
    icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    isNew: true,
  },
  {
    href: '#calc',
    title: 'Commission calculator',
    note: 'What a per-booking cut really costs',
    icon: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
  },
];

function productMenu(): string {
  const items = PRODUCT_LINKS.map(
    (item) =>
      `<a class="mi" href="${item.href}">${icon(item.icon)}<span><b>${escapeHtml(item.title)}${item.isNew ? '<span class="tag-new">New</span>' : ''}</b><small>${escapeHtml(item.note)}</small></span></a>`,
  ).join('');

  return `<div class="mega-grid">${items}
<a class="mega-feature" href="/demo"><span class="k">Live demo</span><b>Click around a real studio, no sign-up.</b><span class="fs">Explore the demo →</span></a>
</div>
<div class="mega-foot"><span>0% commission · 14-day trial · no card</span><a href="#pricing">See pricing →</a></div>`;
}

function tradesMenu(current: Vertical): string {
  const items = VERTICALS.map((vertical) => {
    const isCurrent = vertical.slug === current.slug;
    return `<a class="mi${isCurrent ? ' cur' : ''}" href="/${vertical.slug}"${isCurrent ? ' aria-current="page"' : ''}><span class="n" aria-hidden="true">${String(vertical.capacity.total).padStart(2, '0')}</span><span><b>${escapeHtml(vertical.navLabel)}</b><small>${escapeHtml(vertical.capacity.label)}</small></span></a>`;
  }).join('');

  return `<div class="mega-grid">${items}
<a class="mega-feature" href="#verticals"><span class="k">One engine</span><b>Ten trades, each in its own nouns.</b><span class="fs">Compare them all →</span></a>
</div>`;
}

function mobileTrades(): string {
  return VERTICALS.map(
    (vertical) =>
      `<a href="/${vertical.slug}"><span>${String(vertical.capacity.total).padStart(2, '0')}</span>${escapeHtml(vertical.navLabel)}</a>`,
  ).join('');
}

function footerTrades(): string {
  return FOOTER_VERTICALS.map(bySlug)
    .filter((vertical): vertical is Vertical => Boolean(vertical))
    .map((vertical) => `<a href="/${vertical.slug}">${escapeHtml(vertical.navLabel)}</a>`)
    .join('');
}

// ---------------------------------------------------------------------------

export function renderLanding(page: Page, vertical: Vertical = GENERAL): string {
  /**
   * Per PAGE, not per site: every trade page declaring the home page as its
   * canonical would ask to be dropped from the index.
   */
  const canonical =
    `${config.PUBLIC_URL}/${page.slug}`.replace(/\/$/, '') || config.PUBLIC_URL;
  // The mock browser chrome shows the REAL dashboard host, so staging and
  // live each advertise their own.
  const appHost = new URL(config.APP_URL).host;
  const isHome = vertical.slug === GENERAL.slug;
  const card = vertical.bookingCard;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<meta name="theme-color" content="#faf9f6">
<meta name="color-scheme" content="light">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(BRAND)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(page.title)}">
<meta property="og:description" content="${escapeHtml(page.description)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(page.title)}">
<meta name="twitter:description" content="${escapeHtml(page.description)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%23ef5a24'/%3E%3Ccircle cx='16' cy='16' r='7.5' fill='none' stroke='%23fff' stroke-width='2.6'/%3E%3Ccircle cx='16' cy='16' r='2.4' fill='%23fff'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@1&display=swap" rel="stylesheet">
${structuredData(page, canonical)}
<style>${LANDING_CSS}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>

<header class="site-header" id="siteHeader">
  <div class="container">
    <div class="header-bar">
      <a href="/" class="brand" aria-label="${escapeHtml(BRAND)} home">${BRAND_MARK}<span>${escapeHtml(BRAND)}</span></a>
      <nav class="nav-desktop" aria-label="Primary">
        <span class="nav-ind" id="navInd" aria-hidden="true"></span>
        <div class="nav-item" data-menu>
          <button class="nav-trig" type="button" aria-expanded="false" aria-controls="megaProduct">Product${CHEVRON}</button>
          <div class="mega" id="megaProduct">${productMenu()}</div>
        </div>
        <div class="nav-item" data-menu>
          <button class="nav-trig" type="button" aria-expanded="false" aria-controls="megaTrades">Who it's for${CHEVRON}</button>
          <div class="mega mega-trades" id="megaTrades">${tradesMenu(vertical)}</div>
        </div>
        <a href="#how" data-spy>How it works</a>
        <a href="#pricing" data-spy>Pricing</a>
        <a href="#faq" data-spy>FAQ</a>
        <!-- TEMPORARY demo link — remove with the /demo mount in app.ts -->
        <a href="/demo" class="nav-demo">Demo</a>
      </nav>
      <div class="header-actions">
        <a href="/app" class="nav-signin">Sign in</a>
        ${primary('/app?signup=1', 'Start free', { size: 'sm' })}
      </div>
      <button class="nav-toggle" id="navToggle" type="button" aria-expanded="false" aria-controls="mobileMenu" aria-label="Open menu"><i></i></button>
      <span class="progress" aria-hidden="true"><i id="readBar"></i></span>
    </div>
    <nav class="mobile-menu" id="mobileMenu" aria-label="Mobile" hidden>
      <div class="mm-links">
        <a href="#features">Product</a>
        <a href="#difference">Why us</a>
        <a href="#how">How it works</a>
        <a href="#pricing">Pricing</a>
        <a href="#faq">FAQ</a>
        <!-- TEMPORARY demo link — remove with the /demo mount in app.ts -->
        <a href="/demo">Live demo</a>
      </div>
      <p class="mm-h">Who it's for</p>
      <div class="mm-trades">${mobileTrades()}</div>
      <div class="mm-actions">
        ${primary('/app?signup=1', 'Start free for 14 days', { block: true, size: 'lg' })}
        ${secondary('/app', 'Sign in', { block: true, size: 'lg' })}
      </div>
    </nav>
  </div>
</header>

<main id="main">
  <section class="hero" id="hero" aria-label="Overview">
    <div class="spot" id="spot" aria-hidden="true"></div>
    <div class="container hero-inner">
      <a href="#features" class="badge rv"><b>New</b>${escapeHtml(vertical.badge)} · waitlists and class packs are live</a>
      <div class="rv d1"><h1>${escapeHtml(page.h1)}</h1></div>
      <p class="sub hero-sub rv d2">${escapeHtml(page.intro)}</p>
      <div class="ctas rv d3">
        ${primary('/app?signup=1', 'Start free for 14 days', { size: 'lg', glow: true })}
        ${secondary('/demo', 'Explore the live demo', { size: 'lg' })}
      </div>
      <p class="hero-note rv d3">No card needed · nothing to install · 0% commission</p>
      ${isHome ? `<div class="switch rv d3" role="group" aria-label="Show the schedule for a trade">${switcherButtons()}</div>${switcherTemplates()}` : ''}

      <div class="stage rv" id="stage" role="img" aria-label="${escapeHtml(BRAND)} schedule and booking page, illustrated">
        <div class="win">
          <div class="win-bar"><i></i><i></i><i></i><span class="win-url">${escapeHtml(appHost)}/schedule</span></div>
          <div class="app">
            <div class="app-side">
              <div class="app-who"><span class="av" id="av">${escapeHtml(initials(card.name))}</span><div><b id="studio">${escapeHtml(card.name)}</b><small>${escapeHtml(PLANS.STUDIO.name)} plan</small></div></div>
              <div class="app-it on"><i></i>Schedule</div><div class="app-it"><i></i>Bookings</div><div class="app-it"><i></i>Courses</div><div class="app-it"><i></i>Customers</div><div class="app-it"><i></i>Payments</div>
              <div class="gauge"><small id="gaugeLabel">${escapeHtml(vertical.capacity.label)}</small><div class="gauge-n" id="gaugeNum">${gaugeNum(vertical)}</div><div class="cells" id="cells">${gaugeCells(vertical)}</div></div>
            </div>
            <div class="app-main">
              <div class="app-top"><b>This week</b><div class="seg"><span class="on">Week</span><span>Day</span><span>List</span></div></div>
              <div class="wk" id="wk">${weekHtml(vertical)}</div>
            </div>
          </div>
        </div>
        <div class="float phone">
          <div class="phone-head"><span class="av" id="av2">${escapeHtml(initials(card.name))}</span><div><b id="studio2">${escapeHtml(card.name)}</b><small>${escapeHtml(card.kind)}</small></div></div>
          ${phoneSlots(vertical)}
          <div class="phone-pay"><span>${escapeHtml(card.deposit)}</span><span class="btn btn-ink btn-sm"><span class="lbl">${escapeHtml(card.cta)}</span></span></div>
        </div>
        <div class="float toasts">
          <div class="toast"><span class="ic" style="background:var(--green-soft);color:var(--green)">$</span><div><b>Deposit paid</b><span>${escapeHtml(card.slots[1]?.[0] ?? '')} · straight into your Stripe</span></div></div>
          <div class="toast"><span class="ic" style="background:var(--accent-soft);color:var(--accent)">+1</span><div><b id="toastTitle">${toastTitle(vertical)}</b><span>Booked a moment ago</span></div></div>
          <div class="toast"><span class="ic" style="background:var(--blue-soft);color:var(--blue)">↻</span><div><b>Reminder sent by text</b><span>The day before · no reply needed</span></div></div>
        </div>
      </div>
    </div>
    <div class="mq" aria-hidden="true"><div class="mq-track">${marquee()}</div></div>
  </section>

  <section class="section" id="features" aria-labelledby="featTitle">
    <div class="container">
      <div class="head rv">
        <div><span class="label">The product</span><h2 class="h2" id="featTitle">Everything a hands-on business runs on. <span class="dim">Nothing it doesn't.</span></h2></div>
        <p class="sub">No add-ons to buy, nothing to install and no per-booking fees hiding in the small print.</p>
      </div>
      ${bento(vertical)}
    </div>
  </section>

  <section class="section dark" id="difference" aria-labelledby="cmpTitle">
    <div class="container">
      <div class="head rv">
        <div><span class="label">Why it's different</span><h2 class="h2" id="cmpTitle">What a <em>generic</em> booking tool makes you fake.</h2></div>
        <p class="sub">Most booking software was built for salons and gyms, where a business is a list of appointments. Everything below is something owners work around by hand, every week.</p>
      </div>
      <table class="cmp rv">
        <caption class="sr-only">Generic booking tools compared with ${escapeHtml(BRAND)}</caption>
        <thead><tr><th scope="col">What you need</th><th scope="col" class="them">Generic booking tools</th><th scope="col" class="us">${escapeHtml(BRAND)}</th></tr></thead>
        <tbody>${comparisonRows(vertical)}</tbody>
      </table>
    </div>
  </section>

  <section class="section" id="how" aria-labelledby="howTitle">
    <div class="container">
      <div class="head rv">
        <div><span class="label">How it works</span><h2 class="h2" id="howTitle">In your Instagram bio <em>by this afternoon.</em></h2></div>
        <p class="sub">Three steps. No onboarding call, no migration project, nothing to install.</p>
      </div>
      ${tour(vertical)}
    </div>
  </section>

  <section class="section tight" id="verticals" aria-labelledby="vertTitle">
    <div class="container">
      <div class="head rv">
        <div><span class="label">Who it's for</span><h2 class="h2" id="vertTitle">One engine. <span class="dim">Ten trades. Your nouns.</span></h2></div>
        <p class="sub">The same scheduler underneath every one of these. Each page talks about the wheels, hulls, benches or guides you actually have.</p>
      </div>
      <ul class="tgrid rv">${tradeGrid(vertical)}</ul>
    </div>
  </section>

  <section class="section tight" id="calc" aria-labelledby="calcTitle">
    <div class="container">
      <div class="head rv">
        <div><span class="label">Do the maths</span><h2 class="h2" id="calcTitle">What a commission <em>really</em> costs.</h2></div>
        <p class="sub">Set your monthly booking revenue and compare a per-booking cut with one flat price.</p>
      </div>
      ${calculator()}
    </div>
  </section>

  <section class="section tight" id="pricing" aria-labelledby="pricingTitle">
    <div class="container">
      <div class="head rv">
        <div><span class="label">Pricing</span><h2 class="h2" id="pricingTitle">One flat price. <em>No commission.</em></h2></div>
        <p class="sub">Your customers' payments go straight to your own Stripe account. Every plan starts with the 14-day trial, and none of them needs a card.</p>
      </div>
      <div class="plans">${planCards()}</div>
      <ul class="assure"><li>No card to start</li><li>Cancel in one click</li><li>Export your data any time</li></ul>
    </div>
  </section>

  <section class="section tight faq" id="faq" aria-labelledby="faqTitle">
    <div class="container faq-wrap">
      <div class="rv"><span class="label">Questions</span><h2 class="h2" id="faqTitle" style="margin-top:18px">Common questions</h2><p class="faq-aside">Still unsure? Start the trial. Nothing is charged and nothing is installed.</p></div>
      <div class="rv d1">${faqList(page)}</div>
    </div>
  </section>

  <section class="cta rv" id="start" aria-labelledby="ctaTitle">
    <h2 id="ctaTitle">Try it on your own <em>bookings.</em></h2>
    <p>${escapeHtml(page.cta ?? 'Start free for 14 days. No card needed.')}</p>
    <div class="ctas">
      ${primary('/app?signup=1', 'Start free for 14 days', { size: 'lg', glow: true })}
      ${secondary('/demo', 'Explore the live demo', { size: 'lg' })}
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <a href="/" class="brand" aria-label="${escapeHtml(BRAND)} home">${BRAND_MARK}<span>${escapeHtml(BRAND)}</span></a>
        <p class="footer-blurb">${escapeHtml(vertical.footerBlurb)}</p>
      </div>
      <nav class="footer-col" aria-labelledby="fcol1">
        <h2 class="footer-h" id="fcol1">Product</h2>
        <a href="#features">Features</a>
        <a href="#how">How it works</a>
        <a href="/pricing">Pricing</a>
        <a href="/demo">Live demo</a>
        <a href="/guides/how-many-wheels-can-you-fill">Guides</a>
      </nav>
      <nav class="footer-col" aria-labelledby="fcol2">
        <h2 class="footer-h" id="fcol2">Who it's for</h2>
        ${footerTrades()}
        <a href="#verticals">All ten →</a>
      </nav>
      <nav class="footer-col" aria-labelledby="fcol3">
        <h2 class="footer-h" id="fcol3">Compare</h2>
        <a href="/alternatives/momence">vs Momence</a>
        <a href="/alternatives/punchpass">vs Punchpass</a>
        <a href="/alternatives/sawyer">vs Sawyer</a>
      </nav>
    </div>
    <div class="wordmark" aria-hidden="true">${escapeHtml(BRAND)}</div>
    <div class="footer-bottom"><span>© ${escapeHtml(BRAND)} ${new Date().getFullYear()}</span><span>0% commission on every booking</span></div>
  </div>
</footer>

<script>${LANDING_JS}</script>
</body>
</html>`;
}
