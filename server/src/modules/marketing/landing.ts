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

type ButtonOpts = { size?: 'sm' | 'lg'; glow?: boolean; block?: boolean; play?: boolean };

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
  const play = opts.play
    ? '<span class="play" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M4 2.6v6.8L9.4 6z"/></svg></span>'
    : '';
  return `<a href="${href}" class="${cls('btn-line', opts)}${opts.play ? ' has-play' : ''}">${play}<span class="lbl">${label}</span>${GO}</a>`;
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

/** One small line icon per trade in the hero switcher. */
const SWITCH_ICONS: Record<string, string> = {
  'for/pottery': '<path d="M8 3h8"/><path d="M9 3c0 3-4 4-4 9a7 7 0 0 0 14 0c0-5-4-6-4-9"/><path d="M6.5 14h11"/>',
  'for/kayak-tours': '<path d="M2 15c2.5 2 5 2 7.5 0s5-2 7.5 0 3.5 1.5 5 1"/><path d="M4 11.5 20 6"/><path d="m17 4 4 1.5-1.5 2"/>',
  'for/woodworking': '<path d="m14 4 6 6"/><path d="M12.5 5.5 4 14l6 6 8.5-8.5"/><path d="m7 17 2-2M10 14l1.5-1.5"/>',
  'for/walking-tours': '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11Z"/><circle cx="12" cy="10" r="2.2"/>',
};

function switcherButtons(): string {
  return SWITCHER.map(bySlug)
    .filter((vertical): vertical is Vertical => Boolean(vertical))
    .map(
      (vertical, i) =>
        `<button type="button" data-trade="${escapeHtml(vertical.slug)}" aria-pressed="${i === 0}" title="${escapeHtml(`${vertical.capacity.total} · ${vertical.capacity.label}`)}"><span class="sw-ic" aria-hidden="true"><svg viewBox="0 0 24 24">${SWITCH_ICONS[vertical.slug] ?? ''}</svg></span><span class="sw-name">${escapeHtml(vertical.navLabel)}</span><span class="sw-n" aria-hidden="true">${String(vertical.capacity.total).padStart(2, '0')}</span><i class="sw-bar" aria-hidden="true"></i></button>`,
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

/**
 * The feature grid. Every tile is the same shape: an illustrated panel on
 * top (a drawn piece of the product, animated when the tile scrolls in),
 * then a label, a title and the copy. Rows share heights, so nothing
 * stretches into empty space.
 *
 *   row 1  capacity (7)           payments (5)
 *   row 2  on-site (4)   reminders (4)   courses (4)
 *   row 3  calendar sync (6)      attendance (6)
 *   row 4  just shipped (12)
 */
function bento(vertical: Vertical): string {
  const [, , keep, , reminders, calendar, courses, register] = SHIPPING_FEATURES;
  const shown = Math.min(vertical.capacity.total, 16);
  const left = shown - Math.round((vertical.capacity.used / Math.max(vertical.capacity.total, 1)) * shown);
  const first = vertical.week[0]?.events[0]?.title ?? 'Saturday session';
  const slot = vertical.bookingCard.slots[1]?.[0] ?? 'Sat 10:30';
  const course = vertical.week.flatMap((day) => day.events).find((event) => event.kind === 'course')?.title ?? 'Course';

  const text = (k: string, title: string, body: string) =>
    `<div class="tile-text"><span class="k">${escapeHtml(k)}</span><h3>${title}</h3><p>${escapeHtml(body)}</p></div>`;

  const cap = `<article class="tile t-cap rv">
  <div class="media media-cap" aria-hidden="true">
    <div class="mc-panel">
      <div class="mc-head"><span class="mc-live"><i></i>Live</span><b>${escapeHtml(first)}</b><span class="mc-time">${escapeHtml(slot)}</span></div>
      <div class="mc-row"><span class="mc-lbl">${escapeHtml(vertical.capacity.label)}</span><div class="racks" id="racks" style="grid-template-columns:repeat(${Math.min(shown, 8)},1fr)">${capacityRacks(vertical)}</div></div>
      <div class="mc-row"><span class="mc-lbl">One-at-a-time kit</span><div class="mc-block"><span>Blocked for the whole job</span></div></div>
      <div class="mc-foot"><span>Left to sell</span><b><span id="seatsLeft">${left}</span><em> of ${shown}</em></b></div>
    </div>
  </div>
  ${text('Equipment-aware capacity', escapeHtml(vertical.capacity.headline), vertical.capacity.body)}
</article>`;

  const pay = `<article class="tile t-pay rv d1">
  <div class="media media-pay" aria-hidden="true">
    <div class="pc">
      <div class="pc-top"><span class="pc-ic"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/></svg></span><span>Payout · today</span><span class="pc-ok">Paid</span></div>
      <div class="pc-amt">$540<small>.00</small></div>
      <div class="pc-line"><span>${escapeHtml(first)}</span><b>$540.00</b></div>
      <div class="pc-line"><span>${escapeHtml(BRAND)} fee</span><b class="zero">$0.00</b></div>
      <div class="pc-to"><i></i>To your own Stripe account</div>
    </div>
    <span class="fee-pill">0% commission</span>
  </div>
  ${text('Payments', escapeHtml(keep!.title), keep!.body)}
</article>`;

  const zone = `<article class="tile t-zone rv">
  <div class="media media-zone" aria-hidden="true">
    <div class="zone"><span class="ring"></span><span class="route"></span><span class="pin h"></span><span class="pin c"></span><span class="pin x"></span><span class="tag t1">12 km · inside</span><span class="tag t2">Out of range</span></div>
  </div>
  <div class="tile-text"><span class="k">${escapeHtml(vertical.travel.eyebrow)}</span><h3>${vertical.travel.title}</h3><p>${escapeHtml(vertical.travel.lede)}</p></div>
</article>`;

  const sms = `<article class="tile t-sms rv d1">
  <div class="media media-sms" aria-hidden="true">
    <div class="sms">
      <div class="bub in b1">Reminder: ${escapeHtml(first)}, ${escapeHtml(slot)}. Need to change it? Use your link.<small>1 day before</small></div>
      <div class="typing"><i></i><i></i><i></i></div>
      <div class="bub out b2">Moved to Sunday, thanks!<small>2 min later</small></div>
    </div>
  </div>
  ${text('Reminders', escapeHtml(reminders!.title), reminders!.body)}
</article>`;

  const weeks = [62, 75, 75, 88, 75, 62]
    .map((h, i) => `<div class="wk-col"><div class="wtrack"><div class="wbar" style="--h:${h}%;--i:${i}"></div></div><small>Wk ${i + 1}</small></div>`)
    .join('');
  const crs = `<article class="tile t-course rv d2">
  <div class="media media-course" aria-hidden="true">
    <div class="crs-head"><b>${escapeHtml(course)}</b><span>6 weeks · 1 enrolment</span></div>
    <div class="weeks">${weeks}</div>
  </div>
  ${text('Courses', escapeHtml(courses!.title), courses!.body)}
</article>`;

  const cal = `<article class="tile t-cal rv">
  <div class="media media-cal" aria-hidden="true">
    <div class="cal-col"><span class="cal-h">Your calendar</span><div class="cal-ev busy">Dentist<small>10:00</small></div><div class="cal-ev ghost"></div><div class="cal-ev in-sync">${escapeHtml(first)}<small>${escapeHtml(slot)}</small></div></div>
    <div class="cal-sync"><span class="cal-line"></span><span class="cal-ic"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9"/><path d="M18.5 3.5v3.8h-3.8M5.5 20.5v-3.8h3.8"/></svg></span><span class="cal-line"></span></div>
    <div class="cal-col"><span class="cal-h">${escapeHtml(BRAND)}</span><div class="cal-ev blocked">Slot blocked<small>10:00</small></div><div class="cal-ev ghost"></div><div class="cal-ev ours">${escapeHtml(first)}<small>${escapeHtml(slot)}</small></div></div>
  </div>
  ${text('Calendar sync', escapeHtml(calendar!.title), calendar!.body)}
</article>`;

  const people = [
    ['AM', 'Amira M.', true],
    ['JT', 'Jonah T.', true],
    ['SR', 'Sofia R.', true],
    ['LK', 'Leo K.', false],
  ] as const;
  const reg = `<article class="tile t-reg rv d1">
  <div class="media media-reg" aria-hidden="true">
    <div class="roster">
      <div class="ro-head"><b>${escapeHtml(first)}</b><span>Register · ${escapeHtml(slot)}</span></div>
      ${people
        .map(
          ([ini, name, here], i) =>
            `<div class="ro" style="--i:${i}"><span class="av">${ini}</span><span>${name}</span><i class="${here ? 'y' : 'n'}">${here ? '✓' : '–'}</i></div>`,
        )
        .join('')}
    </div>
  </div>
  ${text('Attendance', escapeHtml(register!.title), register!.body)}
</article>`;

  const fresh = `<article class="tile t-new rv">
  <div class="new-head"><div><span class="k">Just shipped</span><h3>Four more things you used to do by hand.</h3></div><p>On top of everything above, and included in every plan.</p></div>
  <ul class="chips">${JUST_SHIPPED.map(
    (item) =>
      `<li class="chipx"><b>${escapeHtml(item.title)} <em>New</em></b><span>${escapeHtml(item.body)}</span></li>`,
  ).join('')}</ul>
</article>`;

  return `<div class="bento">${cap}${pay}${zone}${sms}${crs}${cal}${reg}${fresh}</div>`;
}

function comparisonRows(vertical: Vertical): string {
  return [vertical.compare, ...COMPARISON]
    .map(
      (row, i) => `<tr style="--i:${i}">
<th scope="row"><span class="need-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>${row.need}</th>
<td class="them" data-label="Generic booking tools"><span class="mk" aria-hidden="true">✕</span><span class="tx">${row.them}</span></td>
<td class="us" data-label="${escapeHtml(BRAND)}"><span class="mk" aria-hidden="true">✓</span><span class="tx">${row.us}</span></td>
</tr>`,
    )
    .join('');
}

/**
 * How it works: three steps on a numbered rail that fills as you scroll,
 * beside a sticky stage that plays one scene per step. The stage has
 * story-style progress bars and a tint per step; each scene animates when
 * it becomes the active one (setup fields fill in, an Instagram profile
 * opens a booking sheet, the register ticks and the payout counts up).
 * On phones each step carries its own copy of its scene.
 */
function tour(vertical: Vertical): string {
  const card = vertical.bookingCard;
  const publicHost = new URL(config.PUBLIC_URL).host;
  const link = `${publicHost}/public/${slugify(card.name)}`;
  const first = vertical.week[0]?.events[0]?.title ?? 'Saturday session';
  const slot = card.slots[1]?.[0] ?? 'Sat 10:30';
  const ini = escapeHtml(initials(card.name));

  const steps = [
    {
      title: 'Describe your business once.',
      body: vertical.setupStep,
      tag: 'About 20 minutes',
    },
    {
      title: 'Share one booking link.',
      body: 'Paste it into your Instagram bio, your website or a reply. It shows live availability, takes the deposit and confirms the booking without you.',
      tag: 'One link, everywhere',
    },
    {
      title: 'Turn up and run it.',
      body: 'Reminders go out on their own, the register is on your phone, and the money lands in your Stripe account. Nobody messages you to ask what time it starts.',
      tag: 'Every week after',
    },
  ];

  const rail = steps
    .map(
      (step, i) => `<div class="tstep${i === 0 ? ' act' : ''}" data-step="${i}">
      <span class="t-node" aria-hidden="true"><b>${i + 1}</b><svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.5l4.5-5"/></svg></span>
      <div class="t-body"><div class="num">Step ${i + 1} of 3</div><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.body)}</p><small>${escapeHtml(step.tag)}</small></div>
    </div>`,
    )
    .join('');

  const fields: [string, string][] = [
    [vertical.capacity.label, `${vertical.capacity.total} at once`],
    ['Travel area', '15 km · +$20'],
    ['Deposit', '$15 per booking'],
    ['Cancellation terms', 'Your rules'],
  ];

  const scene1 = `<div class="scene sc-setup act">
      <div class="card-ui">
        <div class="cu-top"><h4>Set up your studio</h4><span class="cu-step">3 of 4</span></div>
        <p class="hint">What do you work with?</p>
        ${fields
          .map(
            ([label, value], i) =>
              `<div class="fld" style="--i:${i}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b><i class="fld-ok"><svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.5l4.5-5"/></svg></i></div>`,
          )
          .join('')}
        <div class="prog"><span></span></div>
        <div class="cu-foot"><span>Saved automatically</span><span class="cu-btn">Continue</span></div>
      </div>
    </div>`;

  const scene2 = `<div class="scene sc-share">
      <div class="ig-phone">
        <div class="igp-top"><span class="ig-ring"><span>${ini}</span></span><div class="igp-stats"><span><b>248</b>posts</span><span><b>3.1k</b>followers</span><span><b>180</b>following</span></div></div>
        <b class="igp-name">${escapeHtml(card.handle.replace(/^@/, ''))}</b>
        <p class="igp-bio">${card.bio}</p>
        <span class="igp-link"><svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>${escapeHtml(link)}<i class="tap"></i></span>
        <div class="igp-grid"><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="sheet-up">
          <span class="sh-grab"></span>
          <b>${escapeHtml(card.name)}</b>
          <div class="sh-slots">${card.slots
            .map(([label, note], i) => `<span class="${i === 1 ? 'sel' : ''}${i === card.slots.length - 1 ? ' sold' : ''}">${escapeHtml(label)}<em>${escapeHtml(note)}</em></span>`)
            .join('')}</div>
          <span class="sh-book">${escapeHtml(card.cta)} · ${escapeHtml(card.deposit.split('·')[0]!.trim())}</span>
        </div>
      </div>
    </div>`;

  const people = [
    ['AM', 'Amira M.', true],
    ['JT', 'Jonah T.', true],
    ['SR', 'Sofia R.', true],
    ['LK', 'Leo K.', false],
  ] as const;
  const scene3 = `<div class="scene sc-run">
      <div class="run-stack">
        <div class="run-note"><span class="rn-ic">↻</span><div><b>Reminder sent</b><span>${escapeHtml(first)} · tomorrow ${escapeHtml(slot)}</span></div></div>
        <div class="card-ui run-reg">
          <div class="cu-top"><h4>${escapeHtml(first)}</h4><span class="cu-step">${escapeHtml(slot)}</span></div>
          ${people
            .map(
              ([a, name, here], i) =>
                `<div class="reg" style="--i:${i}"><span class="av">${a}</span><span>${name}</span><i class="${here ? 'y' : 'n'}">${here ? '✓' : '–'}</i></div>`,
            )
            .join('')}
        </div>
        <div class="payline"><span>Paid to your Stripe today</span><b data-to="540">$540.00</b></div>
      </div>
    </div>`;

  return `<div class="tour" id="tour">
  <div class="t-rail"><span class="t-line" aria-hidden="true"><i></i></span>${rail}</div>
  <div class="tvis" aria-hidden="true">
    <div class="tv-bars"><i><b></b></i><i><b></b></i><i><b></b></i></div>
    <span class="tv-chip">Step <b id="tvN">1</b> of 3</span>
    ${scene1}${scene2}${scene3}
  </div>
</div>`;
}

/**
 * The commission calculator.
 *
 * Inputs: monthly booking revenue (presets and a ruled slider), the cut a
 * commission tool takes, and which BookAIHub plan to compare against (from
 * PLANS, so the price is the checkout price). Output: what you keep in a
 * year, a 12-month chart of cumulative cost (commission against the flat
 * plan, the gap between them shaded), three figures and a call to action.
 *
 * Everything is rendered server-side for the default inputs, so it reads
 * without JavaScript; the script recomputes the same numbers live. The
 * chart maths here and in landing-js must stay the same (calcChart).
 */
const CALC = { revenue: 6000, rate: 0.05, plan: 'STUDIO' as const };
const CALC_PRESETS = [2000, 6000, 12000, 25000];
const CALC_RATES = [0.03, 0.05, 0.08];
const CHART = { w: 340, h: 150, x0: 16, x1: 324, y0: 128, y1: 14 };

/** Points for the two cumulative lines and the area between them. */
function calcChart(monthlyCommission: number, monthlyPlan: number) {
  const top = Math.max(monthlyCommission, monthlyPlan) * 12 || 1;
  const pt = (m: number, v: number) => {
    const x = CHART.x0 + ((CHART.x1 - CHART.x0) * m) / 12;
    const y = CHART.y0 - ((CHART.y0 - CHART.y1) * v) / top;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const com = Array.from({ length: 13 }, (_, m) => pt(m, monthlyCommission * m));
  const flat = Array.from({ length: 13 }, (_, m) => pt(m, monthlyPlan * m));
  return {
    com: `M${com.join(' L')}`,
    flat: `M${flat.join(' L')}`,
    gap: `M${com.join(' L')} L${[...flat].reverse().join(' L')} Z`,
    comEnd: com[12]!.split(','),
    flatEnd: flat[12]!.split(','),
  };
}

function calculator(): string {
  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  const plan = PLANS[CALC.plan];
  const planMonth = plan.priceCentsMonthly / 100;
  const comMonth = CALC.revenue * CALC.rate;
  const keepYear = Math.max(0, (comMonth - planMonth) * 12);
  const ratio = planMonth > 0 ? comMonth / planMonth : 0;
  const chart = calcChart(comMonth, planMonth);

  const presets = CALC_PRESETS.map(
    (v) => `<button type="button" data-rev="${v}" aria-pressed="${v === CALC.revenue}">$${v / 1000}K</button>`,
  ).join('');
  const rates = CALC_RATES.map(
    (r) => `<button type="button" data-rate="${r}" aria-pressed="${r === CALC.rate}">${Math.round(r * 100)}%</button>`,
  ).join('');
  const plans = Object.values(PLANS)
    .map(
      (p) =>
        `<button type="button" data-plan="${p.priceCentsMonthly / 100}" data-name="${escapeHtml(p.name)}" aria-pressed="${p.id === CALC.plan}">${escapeHtml(p.name)} <em>${money(p.priceCentsMonthly)}</em></button>`,
    )
    .join('');

  return `<div class="calc">
  <div class="calc-in rv">
    <label for="revIn">Your monthly booking revenue</label>
    <div class="rev"><span id="revOut">${usd(CALC.revenue)}</span><small> /month</small></div>
    <div class="presets" role="group" aria-label="Revenue presets">${presets}</div>
    <div class="slider">
      <input type="range" id="revIn" min="1000" max="30000" step="500" value="${CALC.revenue}" data-plan="${planMonth}">
      <div class="ruler" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="scale" aria-hidden="true"><span>$1K</span><span>$10K</span><span>$20K</span><span>$30K</span></div>
    </div>
    <span class="lbl">A tool that takes, per booking</span>
    <div class="rates" role="group" aria-label="Commission rate to compare">${rates}</div>
    <span class="lbl">Compared with ${escapeHtml(BRAND)}</span>
    <div class="rates plans-pick" role="group" aria-label="${escapeHtml(BRAND)} plan to compare">${plans}</div>
  </div>
  <div class="calc-out rv d1">
    <div aria-live="polite">
      <span class="lbl">You'd keep, every year</span>
      <div class="keep" id="keep">${usd(keepYear)}</div>
      <p class="keep-sub" id="keepSub">more than with a <span id="rateTxt">${Math.round(CALC.rate * 100)}%</span> commission tool, on the <span id="planTxt">${escapeHtml(plan.name)}</span> plan.</p>
    </div>
    <figure class="chart" aria-hidden="true">
      <svg viewBox="0 0 ${CHART.w} ${CHART.h}" preserveAspectRatio="none">
        <defs><linearGradient id="gapFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a4c" stop-opacity=".42"/><stop offset="1" stop-color="#ff8a4c" stop-opacity=".04"/></linearGradient></defs>
        <g class="grid">${[0, 1, 2, 3].map((i) => `<line x1="${CHART.x0}" x2="${CHART.x1}" y1="${CHART.y1 + ((CHART.y0 - CHART.y1) * i) / 3}" y2="${CHART.y1 + ((CHART.y0 - CHART.y1) * i) / 3}"/>`).join('')}</g>
        <path id="chGap" class="gap" d="${chart.gap}"/>
        <path id="chCom" class="com" d="${chart.com}"/>
        <path id="chFlat" class="flat" d="${chart.flat}"/>
        <circle id="chComDot" class="dot com-dot" cx="${chart.comEnd[0]}" cy="${chart.comEnd[1]}" r="4"/>
        <circle id="chFlatDot" class="dot flat-dot" cx="${chart.flatEnd[0]}" cy="${chart.flatEnd[1]}" r="4"/>
      </svg>
      <figcaption><span><i class="sw com"></i>Commission tool</span><span><i class="sw flat"></i>${escapeHtml(BRAND)}</span><span class="keep-lg"><i class="sw gapsw"></i>What you keep</span><span class="months">Month 1 → 12</span></figcaption>
    </figure>
    <div class="figs">
      <div><small>Commission a month</small><b id="comMonth">${usd(comMonth)}</b></div>
      <div><small>${escapeHtml(BRAND)} a month</small><b id="planMonth">${usd(planMonth)}</b></div>
      <div><small>The cut is</small><b><span id="ratio">${ratio.toFixed(1)}</span>× the plan</b></div>
    </div>
    <div class="calc-cta">${primary('/app?signup=1', 'Start free and keep it', {})}<p class="calc-note">Illustrative. Stripe's card processing fees apply either way.</p></div>
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
 * Who it's for: an index of the ten trades beside a preview card.
 *
 * The list is grouped (studios and makers, tours and water) and every row is
 * a real link to that trade's page. Hovering or focusing a row swaps the
 * preview to that trade, built from the same Vertical data as its page:
 * the page's own headline, its capacity gauge, three sessions from its week
 * and its booking card. On a trade page the list marks the current trade and
 * the preview opens on it.
 */
const TRADE_GROUPS: { title: string; slugs: string[] }[] = [
  {
    title: 'Studios and makers',
    slugs: ['for/pottery', 'for/glass-and-jewelry', 'for/woodworking', 'for/paint-and-sip', 'for/candle-making', 'for/screen-printing'],
  },
  {
    title: 'Tours and water',
    slugs: ['for/kayak-tours', 'for/boat-tours', 'for/walking-tours', 'for/scuba-diving'],
  },
];

function tradePreview(vertical: Vertical, active: boolean): string {
  const { used, total, label } = vertical.capacity;
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const events = vertical.week.flatMap((day) => day.events.map((event) => ({ ...event, dow: day.dow }))).slice(0, 3);
  const card = vertical.bookingCard;

  return `<a class="tp${active ? ' on' : ''}" href="/${vertical.slug}" data-t="${escapeHtml(vertical.slug)}" tabindex="-1" aria-hidden="true">
  <span class="tp-badge">${escapeHtml(vertical.badge)}</span>
  <b class="tp-h">${escapeHtml(vertical.page.h1)}</b>
  <div class="tp-row">
    <div class="tp-gauge" style="--pct:${pct}"><span class="tp-ring"><b>${used}</b><em>/${total}</em></span><span class="tp-lbl">${escapeHtml(label)}</span></div>
    <div class="tp-week">${events
      .map(
        (event) =>
          `<span class="tp-ev ev-${event.kind}${event.state ? ` ${event.state}` : ''}"><small>${escapeHtml(event.dow)}</small><b>${escapeHtml(event.title)}</b><em>${escapeHtml(event.meta)}</em></span>`,
      )
      .join('')}</div>
  </div>
  <div class="tp-card"><span class="av">${escapeHtml(initials(card.name))}</span><span><b>${escapeHtml(card.name)}</b><small>${escapeHtml(card.handle)} · ${escapeHtml(card.kind)}</small></span><span class="tp-dep">${escapeHtml(card.deposit.split('·')[0]!.trim())}</span></div>
  <span class="tp-go">Open the ${escapeHtml(vertical.navLabel.toLowerCase())} page <i>→</i></span>
</a>`;
}

function tradeGrid(current: Vertical): string {
  const startSlug = VERTICALS.some((vertical) => vertical.slug === current.slug) ? current.slug : 'for/pottery';
  const list = TRADE_GROUPS.map((group) => {
    const rows = group.slugs
      .map(bySlug)
      .filter((vertical): vertical is Vertical => Boolean(vertical))
      .map((vertical) => {
        const isCurrent = vertical.slug === current.slug;
        return `<li><a class="tr-item${vertical.slug === startSlug ? ' on' : ''}" href="/${vertical.slug}" data-t="${escapeHtml(vertical.slug)}"${isCurrent ? ' aria-current="page"' : ''}><span class="tr-n">${String(vertical.capacity.total).padStart(2, '0')}</span><span class="tr-name">${escapeHtml(vertical.navLabel)}</span><span class="tr-res">${escapeHtml(vertical.capacity.label)}</span>${isCurrent ? '<span class="tr-here">You are here</span>' : ''}<span class="tr-go" aria-hidden="true">→</span></a></li>`;
      })
      .join('');
    return `<div class="tr-group"><p class="tr-gh">${escapeHtml(group.title)}</p><ul>${rows}</ul></div>`;
  }).join('');

  const previews = VERTICALS.map((vertical) => tradePreview(vertical, vertical.slug === startSlug)).join('');

  return `<div class="trades">
  <div class="tr-list">${list}</div>
  <div class="tr-preview">${previews}</div>
</div>`;
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

const CHEVRON_RIGHT = '<svg viewBox="0 0 10 10"><path d="M3.5 2 6.5 5 3.5 8"/></svg>';

const SPARKLE = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0c.4 2.6 1.4 3.6 4 4-2.6.4-3.6 1.4-4 4-.4-2.6-1.4-3.6-4-4 2.6-.4 3.6-1.4 4-4Z"/><path d="M10 8c.2 1 .6 1.4 1.6 1.6-1 .2-1.4.6-1.6 1.6-.2-1-.6-1.4-1.6-1.6 1-.2 1.4-.6 1.6-1.6Z" opacity=".7"/></svg>';

/**
 * The countable things each trade's intro names. In the hero subtitle these
 * are set in ink with a highlighter stroke, so the page's one idea (capacity
 * is what you own) is what the eye picks out of the sentence.
 */
const OWNED_NOUNS = [
  'press arms', 'wheels', 'kayaks', 'benches', 'seats', 'stations', 'looms', 'hulls',
  'guides', 'guide', 'tanks', 'boats', 'machines', 'kilns', 'vessel', 'instructor ratios',
];

const CLOSER = 'No booking fees and no commission.';

/**
 * The hero subtitle: the intro with its owned nouns marked, and the closing
 * promise lifted onto its own line as a highlighted kicker. Same words, same
 * order, so the text a crawler reads is unchanged.
 */
function introHtml(intro: string): string {
  const trimmed = intro.trim();
  const hasCloser = trimmed.endsWith(CLOSER);
  const lead = hasCloser ? trimmed.slice(0, -CLOSER.length).trim() : trimmed;
  const pattern = new RegExp(`\\b(${OWNED_NOUNS.map((n) => n.replace(/ /g, '\\s')).join('|')})\\b`, 'g');
  const marked = escapeHtml(lead).replace(pattern, '<em class="own">$1</em>');
  return hasCloser
    ? `${marked} <span class="kicker"><span class="kicker-mark">${escapeHtml(CLOSER)}</span></span>`
    : marked;
}

/**
 * The proof row under the hero buttons. Four facts, each true by construction
 * (who it is for, the trial, where payouts land, setup time) and none of them
 * repeating the "no commission" line just above it.
 */
const PROOF_ICONS = {
  who: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
  trial: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="m9 14.5 2 2 4-4"/>',
  stripe: '<rect x="2.5" y="5.5" width="19" height="13" rx="3"/><path d="M2.5 10h19"/><path d="M6.5 14.5h4"/>',
  time: '<circle cx="12" cy="12.5" r="8.5"/><path d="M12 8v4.5l3 2"/><path d="M9.5 2.5h5"/>',
};

function proofRow(vertical: Vertical): string {
  const items: [keyof typeof PROOF_ICONS, string, string][] = [
    ['who', vertical.badge.replace(/^For\s+/i, '').replace(/^./, (c) => c.toUpperCase()), 'Built for'],
    ['trial', '14 days free', 'No card needed'],
    ['stripe', 'Payouts to your Stripe', 'Not held by us'],
    ['time', 'Live this afternoon', 'Nothing to install'],
  ];
  return `<ul class="proof rv d3" aria-label="At a glance">${items
    .map(
      ([key, title, note]) =>
        `<li class="pf pf-${key}"><span class="pi" aria-hidden="true"><svg viewBox="0 0 24 24">${PROOF_ICONS[key]}</svg></span><span class="pt"><small>${escapeHtml(note)}</small><b>${escapeHtml(title)}</b></span></li>`,
    )
    .join('')}</ul>`;
}

/**
 * Background decoration for the hero, all aria-hidden, and deliberately
 * quiet: no objects, only light and line.
 *
 *   A soft beam of light falling from the top centre onto the headline.
 *   A faint warm aurora behind it that turns very slowly.
 *   A fan of hairline arcs rising from below the fold like a horizon, with
 *   one small glint of light that travels along an arc every few seconds.
 *   A fine dot matrix that fades out from the centre.
 */
function heroDeco(): string {
  const arcs = [0, 1, 2, 3, 4]
    .map((i) => `<ellipse cx="600" cy="${900 + i * 18}" rx="${520 + i * 140}" ry="${430 + i * 70}"/>`)
    .join('');
  return `<div class="deco" aria-hidden="true">
<div class="aurora"></div>
<div class="beam"></div>
<div class="dots"></div>
<svg class="horizon" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMax slice">${arcs}<ellipse class="glint" cx="600" cy="936" rx="800" ry="570" pathLength="100"/></svg>
</div>`;
}

/** "A, b, c and d", for the badge's no-JavaScript sentence. */
function listSentence(items: string[]): string {
  const lower = items.map((item, i) => (i === 0 ? item : item.charAt(0).toLowerCase() + item.slice(1)));
  return lower.length < 2 ? lower.join('') : `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`;
}

const CHECK_SVG = '<svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.5l4.5-5"/></svg>';

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
    <div class="orbs" aria-hidden="true"><i></i><i></i><i></i></div>
    ${heroDeco()}
    <div class="container hero-inner">
      <div class="hero-top">
      <a href="#features" class="badge rv"><span class="badge-new">${SPARKLE}New</span><span class="badge-sep" aria-hidden="true"></span><span class="badge-txt" data-rotate="${escapeHtml(JUST_SHIPPED.map((item) => item.title).join('|'))}">${escapeHtml(listSentence(JUST_SHIPPED.map((item) => item.title)))}</span><span class="badge-tail">are live</span><i class="badge-go" aria-hidden="true">${CHEVRON_RIGHT}</i></a>
      <div class="rv d1"><h1>${escapeHtml(page.h1)}</h1></div>
      <p class="sub hero-sub rv d2">${introHtml(page.intro)}</p>
      <div class="ctas rv d3">
        ${primary('/app?signup=1', 'Start free for 14 days', { size: 'lg', glow: true })}
        ${secondary('/demo', 'Explore the live demo', { size: 'lg', play: true })}
      </div>
      ${proofRow(vertical)}
      ${isHome ? `<div class="switch-row rv d3"><span class="switch-lbl"><i class="live-dot" aria-hidden="true"></i>Live preview</span><div class="switch" role="group" aria-label="Show the schedule for a trade">${switcherButtons()}</div></div>${switcherTemplates()}` : ''}

      </div>
      <div class="stage rv" id="stage" role="img" aria-label="${escapeHtml(BRAND)} schedule and booking page, illustrated">
        <div class="win">
          <div class="win-bar"><i></i><i></i><i></i><span class="win-url"><i class="lock" aria-hidden="true"></i>${escapeHtml(appHost)}/schedule</span><span class="live"><i></i>Live</span></div>
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
      <div class="cmp-wrap rv">
      <table class="cmp">
        <caption class="sr-only">Generic booking tools compared with ${escapeHtml(BRAND)}</caption>
        <colgroup><col class="c-need"><col class="c-them"><col class="c-us"></colgroup>
        <thead><tr><th scope="col">What you need</th><th scope="col" class="them"><span class="col-h"><span class="col-ic them-ic" aria-hidden="true">?</span>Generic booking tools</span></th><th scope="col" class="us"><span class="col-h">${BRAND_MARK}${escapeHtml(BRAND)}<span class="col-pill">Built for this</span></span></th></tr></thead>
        <tbody>${comparisonRows(vertical)}</tbody>
        <tfoot><tr><th scope="row"><span class="sr-only">In short</span></th><td class="them"><span class="foot-them">Workarounds, every week</span></td><td class="us">${primary('/app?signup=1', 'Start free for 14 days', { block: true })}</td></tr></tfoot>
      </table>
      </div>
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
      <div class="rv">${tradeGrid(vertical)}</div>
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
      ${secondary('/demo', 'Explore the live demo', { size: 'lg', play: true })}
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
