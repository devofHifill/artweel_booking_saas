import { imageUrls } from '../media/media.service';
import { brandCss, resolveBrand } from '../../lib/brand';
import { escapeHtml } from './booking-page';
import { freeCancellationHours, type Storefront } from './storefront.service';

/*
  The cancellation promise, in words (FB-16).

  The home page said "48h · free cancellation", which read as anything from
  "cancel within 48 hours of booking" to a 48-hour window. Every surface now
  says the same sentence the checkout does: "Free cancellation up to 48 hours
  before it starts".
*/
function hoursText(hours: number): string {
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

function freeCancellationText(hours: number): string {
  return `Free cancellation up to ${hoursText(hours)} before it starts`;
}

/**
 * The public storefront: home, activities, one activity, about, contact.
 *
 * Server-rendered, like the booking page and for the same reasons — this is
 * the page a studio links from its Instagram bio, so it has to paint on
 * mobile data and be legible to a crawler. The prototype this follows is a
 * client-rendered SPA; matching its LAYOUT while keeping our rendering was a
 * deliberate choice, because porting the SPA would have thrown away the one
 * thing that makes the page findable.
 *
 * ---
 *
 * WHAT THE PROTOTYPE HAS THAT THIS DOES NOT, so nobody "restores" it:
 *
 * - **Ratings and review counts.** ★4.9, "(412)", "4.8 average rating" and a
 *   whole reviews section. Artweel has no reviews feature — nothing collects
 *   guest feedback — so every one of those numbers would be invented, printed
 *   next to a price, on the page where somebody decides to spend money.
 * - **A contact FORM.** There is no endpoint behind one and no inbox for it to
 *   land in. A form that silently discards a message is worse than no form:
 *   the customer believes they have been in touch. Replaced with the studio's
 *   real address and phone.
 * - **PayPal, and "deposit now or balance on the day" as a customer choice.**
 *   Payment is Stripe. Deposits exist, but as a studio setting, not a picker.
 *
 * Everything else is driven from real rows.
 */

type Service = Storefront['services'][number];

/*
  An uploaded photo (FB-11), or '' when there is none — every caller keeps
  its gradient and emoji as the fallback. Both stored widths go in srcset so a
  phone fetches the 400px file and a wide screen the 1200px one.
*/
function photoTag(
  key: string | null | undefined,
  alt: string | null | undefined,
  className: string,
  sizes: string,
  eager = false,
): string {
  const urls = imageUrls(key);
  if (!urls) return '';
  return `<img class="${className}" src="${urls.small}" srcset="${urls.small} 400w, ${urls.large} 1200w" sizes="${sizes}" alt="${escapeHtml(alt ?? '')}"${eager ? '' : ' loading="lazy"'} decoding="async">`;
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    /* Whole pounds and dollars read better on a card. A price with a real
       fractional part still shows it. */
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hour${h === 1 ? '' : 's'}` : `${h}h ${m}m`;
}

const dateShort = (at: Date, tz: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
  }).format(at);

const timeOf = (at: Date, tz: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);

/**
 * The card gradient.
 *
 * `color` is the service's calendar colour and `colorAccent` the second stop,
 * both already on the row. Falling back to the same colour twice gives a flat
 * panel rather than a broken one, so a studio that never picked an accent
 * still gets a coherent card.
 */
const gradient = (s: Service) =>
  `linear-gradient(135deg, ${escapeHtml(s.color)}, ${escapeHtml(
    s.colorAccent ?? s.color,
  )})`;

const seatsLeft = (session: { capacity: number; seatsTaken: number }) =>
  Math.max(0, session.capacity - session.seatsTaken);

/** "1 guest", "8 guests". A private lesson has a capacity of one. */
const guests = (n: number) => `${n} guest${n === 1 ? '' : 's'}`;

/** "up to 10 guests", or "6–10 guests" when the studio sets a minimum party. */
const guestRange = (s: { capacityMin?: number | null; capacityMax: number }) =>
  s.capacityMin && s.capacityMin > 1 && s.capacityMin < s.capacityMax
    ? `${s.capacityMin}–${guests(s.capacityMax)}`
    : `up to ${guests(s.capacityMax)}`;

/*
  FB-10. The price, in the card's text and said in full. It was only a 12px
  tag on the picture ("$65"), with no "per person", and gone once the picture
  scrolled away on a phone. Same wording as the activity page's aside: "per
  adult" when there is a child rate, "for all N sessions" for a Class.
*/
function priceLine(s: Service, currency: string): string {
  if (s.priceCents <= 0) return '<div class="sf-card-price"><b>Free</b></div>';
  const unit = s.childPriceCents > 0 ? 'per adult' : 'per person';
  const run = s.run ? `, for all ${s.run.sessionCount} sessions` : '';
  const child =
    s.childPriceCents > 0
      ? `<span class="sf-card-child">Children ${money(s.childPriceCents, currency)}</span>`
      : '';
  return `<div class="sf-card-price"><b>${money(s.priceCents, currency)}</b> <span>${unit}${run}</span>${child}</div>`;
}

// --- Chrome -----------------------------------------------------------------

function header(store: Storefront, active: string): string {
  const base = `/public/${store.organization.slug}`;

  const links: [string, string, string][] = [
    ['home', 'Home', base],
    ['activities', 'Activities', `${base}/activities`],
    ['about', 'About', `${base}/about`],
    ['contact', 'Contact', `${base}/contact`],
    /* The studio's own CMS pages sit alongside the built-in four rather than
       in a second menu — a visitor has no idea which of these is a database
       row and should not be able to tell. */
    ...store.pages.map(
      (p) => [`p:${p.path}`, p.title, `${base}/p/${p.path}`] as [string, string, string],
    ),
  ];

  const ctaLabel = store.organization.navCtaLabel?.trim() || 'Book now';

  return `<header class="sf-header"><div class="sf-header-inner">
    <a class="sf-brand" href="${base}">${escapeHtml(store.organization.name)}</a>
    <nav class="sf-nav" aria-label="Site">
      ${links
        .map(
          ([id, label, href]) =>
            `<a href="${escapeHtml(href)}"${
              active === id ? ' aria-current="page"' : ''
            }>${escapeHtml(label)}</a>`,
        )
        .join('\n      ')}
    </nav>
    <div class="sf-header-right">
      ${
        store.organization.contactPhone
          ? `<a class="sf-phone" href="tel:${escapeHtml(
              store.organization.contactPhone.replace(/\s+/g, ''),
            )}">${escapeHtml(store.organization.contactPhone)}</a>`
          : ''
      }
      <a class="sf-btn sf-btn-primary sf-btn-sm" href="${base}/book">${escapeHtml(
        ctaLabel,
      )}</a>
    </div>
  </div></header>`;
}

function footer(store: Storefront): string {
  const base = `/public/${store.organization.slug}`;
  const org = store.organization;

  return `<footer class="sf-footer">
    <div class="sf-foot-grid">
      <div>
        <b>${escapeHtml(org.name)}</b>
        ${org.tagline ? `<p>${escapeHtml(org.tagline)}</p>` : ''}
      </div>
      <div>
        <h4>Experiences</h4>
        ${store.services
          .slice(0, 5)
          .map(
            (s) =>
              `<a href="${base}/a/${escapeHtml(s.slug)}">${escapeHtml(s.name)}</a>`,
          )
          .join('\n        ')}
      </div>
      <div>
        <h4>Company</h4>
        <a href="${base}/about">About us</a>
        <a href="${base}/contact">Contact</a>
        <a href="${base}/activities">All experiences</a>
      </div>
      <div>
        <h4>Get in touch</h4>
        ${org.contactEmail ? `<a href="mailto:${escapeHtml(org.contactEmail)}">${escapeHtml(org.contactEmail)}</a>` : ''}
        ${org.contactPhone ? `<a href="tel:${escapeHtml(org.contactPhone.replace(/[^+\d]/g, ''))}">${escapeHtml(org.contactPhone)}</a>` : ''}
      </div>
    </div>
    <div class="sf-foot-bottom">
      <span>&copy; ${new Date().getFullYear()} ${escapeHtml(org.name)}</span>
      <span>Powered by Artweel</span>
    </div>
  </footer>`;
}

/**
 * The storefront's header, footer and stylesheet, for the booking page.
 *
 * `/book` is where every storefront "Book now" lands. Rendered bare, it read
 * as a different product: a dark single column with no way back to the
 * studio's own pages. Handing it the same chrome makes it one site.
 */
export function storefrontChrome(store: Storefront): {
  css: string;
  header: string;
  footer: string;
} {
  return {
    css: STOREFRONT_CSS,
    header: header(store, 'book'),
    footer: footer(store),
  };
}

function shell(
  store: Storefront,
  opts: { title: string; description?: string; active: string; body: string },
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
${opts.description ? `<meta name="description" content="${escapeHtml(opts.description)}">` : ''}
<meta property="og:title" content="${escapeHtml(opts.title)}">
${opts.description ? `<meta property="og:description" content="${escapeHtml(opts.description)}">` : ''}
<meta property="og:type" content="website">
<style>${STOREFRONT_CSS}${brandCss(resolveBrand(store.organization))}</style>
</head>
<body class="sf">
${header(store, opts.active)}
<main>${opts.body}</main>
${footer(store)}
</body>
</html>`;
}

// --- Cards ------------------------------------------------------------------

/**
 * A Class's dates and state, in a line: it is booked once for the whole run,
 * so "Next: Sat 14 Nov, 8 left" would read as one session for sale.
 */
function runLine(s: Service, tz: string): string {
  const run = s.run!;
  const when = `${run.sessionCount} sessions from ${dateShort(new Date(run.startsAt), tz)}`;
  const state = run.enrollable
    ? `<span class="sf-left">${run.seatsRemaining} ${run.seatsRemaining === 1 ? 'place' : 'places'} left</span>`
    : run.bookingOpensAt
      ? `<span class="sf-muted">Booking opens ${dateShort(new Date(run.bookingOpensAt), tz)}</span>`
      : `<span class="sf-muted">${run.seatsRemaining <= 0 ? 'Full' : 'Booking closed'}</span>`;
  return `<span>${when}</span>${state}`;
}

function serviceCard(store: Storefront, s: Service): string {
  const base = `/public/${store.organization.slug}`;
  const next = s.sessions[0];
  const tz = store.organization.timezone;
  const currency = store.organization.currency;
  const run = s.run;

  return `<article class="sf-card">
    <a class="sf-card-media" href="${base}/a/${escapeHtml(s.slug)}" style="background:${gradient(s)}">
      ${photoTag(s.imageKey, s.imageAlt, 'sf-photo', '(max-width: 700px) 100vw, 360px') ||
        (s.emoji ? `<span class="sf-emoji">${escapeHtml(s.emoji)}</span>` : '')}
      ${s.category ? `<span class="sf-chip">${escapeHtml(s.category.name)}</span>` : ''}
      <span class="sf-price">${money(s.priceCents, currency)}</span>
    </a>
    <div class="sf-card-body">
      <h3><a href="${base}/a/${escapeHtml(s.slug)}">${escapeHtml(s.name)}</a></h3>
      ${priceLine(s, currency)}
      <div class="sf-meta"><span>${duration(s.durationMinutes)}</span>
        <span>${guestRange(s)}</span></div>
      ${
        s.shortDescription || s.description
          ? `<p class="sf-desc">${escapeHtml(
              s.shortDescription ?? s.description ?? '',
            )}</p>`
          : ''
      }
      <div class="sf-meta">
        ${
          run
            ? runLine(s, tz)
            : next
            ? `<span>Next: ${dateShort(next.startsAt, tz)} ${timeOf(
                next.startsAt,
                tz,
              )}</span><span class="sf-left">${seatsLeft(next)} left</span>`
            : /* Said plainly. The prototype hides this case; a studio between
                 terms would otherwise show a Book button that leads to an
                 empty calendar. */
              '<span class="sf-muted">No dates scheduled yet</span>'
        }
      </div>
      ${
        run && !run.enrollable
          ? `<a class="sf-btn sf-btn-block" href="${base}/a/${escapeHtml(s.slug)}">See details</a>`
          : /* "Choose a date" (FB-10): it opens the date picker, and says
               what happens next rather than promising a booking. */
            `<a class="sf-btn sf-btn-primary sf-btn-block" href="${base}/book?service=${escapeHtml(
              s.id,
            )}">Choose a date</a>`
      }
    </div>
  </article>`;
}

/*
  FB-09. There was a What / Category / When search bar here, in the Home hero
  and above the Activities cards. It sent visitors to dead ends — any weekday
  date hid every activity ("Nothing matches that") — and on a phone it pushed
  the first activity below the screen. Studios sell a handful of activities;
  the cards come first, and the date is chosen on the activity's own page.
  /activities still honours ?q / ?category / ?date from old links.
*/

// --- Pages ------------------------------------------------------------------

export function renderHome(store: Storefront): string {
  const org = store.organization;
  const base = `/public/${org.slug}`;
  const hours = store.stats.freeCancellationHours;

  /* Three tiles, or two. The prototype has four and one of them is an average
     rating — there is no such number here, and a tile reading "—" is worse
     than a row of three. */
  const tiles = [
    `<div class="sf-stat"><b>${store.stats.experiences}</b><span>experiences</span></div>`,
    store.stats.guestsHosted > 0
      ? `<div class="sf-stat"><b>${store.stats.guestsHosted.toLocaleString(
          'en-US',
        )}</b><span>guests hosted</span></div>`
      : '',
    hours !== null
      ? `<div class="sf-stat"><b>${hoursText(hours)}</b><span>notice to cancel for free</span></div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  /* Payment claims only when they are true. Every studio was told "Secure card
     payment… handled by Stripe" and "held the moment you pay", including ones
     that take no payment online — whose booking form then said "Payable on the
     day". Same test as the booking page, so the two cannot disagree. */
  const pays = store.acceptsPayment;

  const features = [
    [
      'Instant confirmation',
      pays
        ? 'Your place is held the moment you pay — no waiting for someone to reply to an email.'
        : 'Your place is held the moment you book — no waiting for someone to reply to an email.',
    ],
    hours !== null
      ? [
          'Free cancellation',
          `Cancel up to ${hoursText(hours)} before it starts and get everything back, no questions.`,
        ]
      : null,
    [
      'Small groups',
      'Every class has a hard cap, so the instructor has time for you.',
    ],
    [
      'Local instructors',
      'The people running these classes work here. They are not reading a script.',
    ],
    pays
      ? [
          'Secure card payment',
          'Card payments are handled by Stripe. We never see your card details.',
        ]
      : ['Nothing to pay online', 'Any payment is taken on the day, when you come.'],
    org.contactPhone
      ? [
          'Real humans',
          `Call ${org.contactPhone} and somebody who works here picks up.`,
        ]
      : null,
  ].filter((f): f is [string, string] => f !== null);

  const body = `
  <section class="sf-hero">
    <div class="sf-wrap">
      <span class="sf-badge">${escapeHtml(org.name)}</span>
      <h1>${escapeHtml(org.tagline ?? `Book with ${org.name}`)}</h1>
      ${org.about ? `<p class="sf-lede">${escapeHtml(org.about)}</p>` : ''}
      ${tiles ? `<div class="sf-stats">${tiles}</div>` : ''}
    </div>
  </section>

  <section class="sf-section"><div class="sf-wrap">
    <div class="sf-section-head">
      <div>
        <div class="sf-eyebrow">Popular right now</div>
        <h2>Classes people are booking</h2>
        <p>Live availability — what you see here is what is actually free.</p>
      </div>
      <a class="sf-btn" href="${base}/activities">See all ${store.stats.experiences} &rarr;</a>
    </div>
    ${
      store.services.length > 0
        ? `<div class="sf-grid">${store.services
            .slice(0, 6)
            .map((s) => serviceCard(store, s))
            .join('')}</div>`
        : `<p class="sf-muted">Nothing is on sale just yet. Check back soon.</p>`
    }
  </div></section>

  <section class="sf-section sf-alt"><div class="sf-wrap">
    <div class="sf-section-head">
      <div>
        <div class="sf-eyebrow">Why book direct</div>
        <h2>Booked in under a minute</h2>
      </div>
    </div>
    <div class="sf-features">
      ${features
        .map(
          ([title, text]) =>
            `<div class="sf-feature"><b>${escapeHtml(title)}</b><p>${escapeHtml(
              text,
            )}</p></div>`,
        )
        .join('')}
    </div>
  </div></section>`;

  return shell(store, {
    title: org.seoTitle?.trim() || `${org.name} — book online`,
    description: org.seoDescription?.trim() || org.tagline || undefined,
    active: 'home',
    body,
  });
}

export function renderActivities(
  store: Storefront,
  services: Service[],
  filters: { q?: string; category?: string; date?: string },
): string {
  const base = `/public/${store.organization.slug}`;
  const filtering = Boolean(filters.q || filters.category || filters.date);

  const body = `
  <section class="sf-section"><div class="sf-wrap">
    <div class="sf-section-head">
      <div>
        <div class="sf-eyebrow">Everything we run</div>
        <h2>All experiences</h2>
        <p>${services.length} available${filtering ? ' matching your search' : ''}</p>
      </div>
    </div>

    ${
      services.length > 0
        ? `<div class="sf-grid">${services
            .map((s) => serviceCard(store, s))
            .join('')}</div>`
        : `<div class="sf-empty">
             <h3>Nothing matches that</h3>
             <p>Try a different date, or clear the filters.</p>
             <a class="sf-btn sf-btn-primary" href="${base}/activities">Clear filters</a>
           </div>`
    }
  </div></section>`;

  return shell(store, {
    title: `Experiences — ${store.organization.name}`,
    description: store.organization.seoDescription ?? undefined,
    active: 'activities',
    body,
  });
}

export function renderActivity(store: Storefront, s: Service): string {
  const org = store.organization;
  const base = `/public/${org.slug}`;
  const tz = org.timezone;
  /* The activity's own policy when it names one, else the studio's default:
     the same choice the checkout makes, so this page and the checkout cannot
     promise different terms for the same booking. */
  const hours = s.cancellationPolicy
    ? freeCancellationHours(s.cancellationPolicy.tiers)
    : store.stats.freeCancellationHours;

  /* One bullet per line, the same convention the migration that added
     `highlights` established and the same split the booking page uses. */
  const highlights = (s.highlights ?? '')
    .split('\n')
    .map((h) => h.trim())
    .filter(Boolean);

  const body = `
  <section class="sf-section"><div class="sf-wrap">
    <a class="sf-back" href="${base}/activities">&larr; All experiences</a>

    <div class="sf-detail">
      <div>
        <div class="sf-detail-hero" style="background:${gradient(s)}">
          ${photoTag(s.imageKey, s.imageAlt, 'sf-photo', '(max-width: 900px) 100vw, 640px', true) ||
            (s.emoji ? escapeHtml(s.emoji) : '')}
        </div>
        ${s.category ? `<div class="sf-eyebrow">${escapeHtml(s.category.name)}</div>` : ''}
        <h1>${escapeHtml(s.name)}</h1>
        <div class="sf-meta sf-meta-lg">
          <span>${duration(s.durationMinutes)}</span>
          <span>up to ${guests(s.capacityMax)}</span>
        </div>

        ${s.description ? `<p class="sf-prose">${escapeHtml(s.description)}</p>` : ''}

        ${
          highlights.length > 0
            ? `<h3>What is included</h3>
               <ul class="sf-highlights">${highlights
                 .map((h) => `<li>${escapeHtml(h)}</li>`)
                 .join('')}</ul>`
            : ''
        }

        ${
          s.meetingPoint
            ? `<h3>Where to meet</h3><p class="sf-prose">${escapeHtml(s.meetingPoint)}</p>`
            : ''
        }

        ${
          s.preparationNotes
            ? `<h3>Before you come</h3><p class="sf-prose">${escapeHtml(
                s.preparationNotes,
              )}</p>`
            : ''
        }

        ${
          hours !== null
            ? /* One line, deliberately. `.sf-prose` keeps newlines so the
                 STUDIO's own paragraphs survive; that also means an incidental
                 line break in this template would show up as one on the page. */
              `<h3>Cancellation</h3><p class="sf-prose">${freeCancellationText(hours)}, with a full refund.</p>`
            : ''
        }
      </div>

      <aside class="sf-aside">
        <div class="sf-aside-price">
          <div>
            <span class="sf-big">${money(s.priceCents, org.currency)}</span>
            <span class="sf-muted"> per adult${s.run ? `, for all ${s.run.sessionCount} sessions` : ''}</span>
          </div>
          ${
            /* Only when there IS a child rate. Zero means adults only — it is
               the default every service carries, and printing "Children $0"
               would advertise free places nobody offered. */
            s.childPriceCents > 0
              ? `<div class="sf-child"><span class="sf-muted">Children</span>
                 <b>${money(s.childPriceCents, org.currency)}</b></div>`
              : ''
          }
        </div>

        <div class="sf-aside-title">${s.run ? `${s.run.sessionCount} sessions, booked together` : 'Next available'}</div>
        ${
          s.run
            ? `<ul class="sf-slots">${s.run.dates
                .map(
                  (d) =>
                    `<li><span><b>${dateShort(new Date(d.startsAt), tz)}</b> ${timeOf(
                      new Date(d.startsAt),
                      tz,
                    )}</span></li>`,
                )
                .join('')}</ul>
               <p class="sf-fine">${runLine(s, tz)}</p>`
            : s.sessions.length > 0
            ? `<ul class="sf-slots">${s.sessions
                .map((session) => {
                  const left = seatsLeft(session);
                  return `<li><span><b>${dateShort(
                    session.startsAt,
                    tz,
                  )}</b> ${timeOf(session.startsAt, tz)}</span>
                  <span class="${left > 0 ? 'sf-left' : 'sf-muted'}">${
                    left > 0 ? `${left} left` : 'Sold out'
                  }</span></li>`;
                })
                .join('')}</ul>`
            : `<p class="sf-muted">No dates scheduled yet — get in touch and we
               will open one.</p>`
        }

        ${
          s.run && !s.run.enrollable
            ? ''
            : `<a class="sf-btn sf-btn-primary sf-btn-block" href="${base}/book?service=${escapeHtml(
                s.id,
              )}">Book this class</a>`
        }
        ${
          hours !== null
            ? `<p class="sf-fine">${freeCancellationText(hours)}</p>`
            : ''
        }
      </aside>
    </div>
  </div></section>`;

  return shell(store, {
    title: `${s.name} — ${org.name}`,
    description: s.shortDescription ?? s.description ?? undefined,
    active: 'activities',
    body,
  });
}

export function renderAbout(store: Storefront): string {
  const org = store.organization;

  const body = `
  <section class="sf-section"><div class="sf-wrap sf-narrow">
    <div class="sf-eyebrow">About us</div>
    <h1>${escapeHtml(org.tagline ?? `About ${org.name}`)}</h1>

    ${
      org.about
        ? /* The studio's own words, split on blank lines. Nothing is written
             for them: the prototype's About is invented copy about a harbour,
             and inventing a history for somebody's business is not a
             placeholder, it is a lie with their name on it. */
          org.about
            .split(/\n{2,}/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p) => `<p class="sf-prose">${escapeHtml(p)}</p>`)
            .join('')
        : `<p class="sf-prose sf-muted">${escapeHtml(
            org.name,
          )} has not written an About yet.</p>`
    }

    ${
      store.staff.length > 0
        ? `<div class="sf-section-head sf-mt">
             <div><div class="sf-eyebrow">The team</div>
             <h2>Who you will actually meet</h2></div>
           </div>
           <div class="sf-grid sf-grid-team">
             ${store.staff
               .map(
                 (m) => `<div class="sf-person">
                   <span class="sf-avatar" style="background:${escapeHtml(m.color)}">${
                     photoTag(m.photoKey, m.photoAlt, 'sf-photo', '96px') ||
                     escapeHtml(initials(m.name))
                   }</span>
                   <b>${escapeHtml(m.name)}</b>
                   ${m.role ? `<span class="sf-muted">${escapeHtml(m.role)}</span>` : ''}
                   ${m.bio ? `<p class="sf-fine">${escapeHtml(m.bio)}</p>` : ''}
                 </div>`,
               )
               .join('')}
           </div>`
        : ''
    }
  </div></section>`;

  return shell(store, {
    title: `About — ${org.name}`,
    description: org.about?.slice(0, 200) ?? undefined,
    active: 'about',
    body,
  });
}

export function renderContact(store: Storefront): string {
  const org = store.organization;

  const body = `
  <section class="sf-section"><div class="sf-wrap sf-narrow">
    <div class="sf-eyebrow">Contact</div>
    <h1>Talk to a human</h1>

    ${
      /*
        Details, not a form. There is no endpoint behind a contact form and no
        inbox for it to reach — a form that discards the message is worse than
        none, because the customer walks away believing they have been in
        touch. These are links so a phone dials and an email opens.
      */
      org.contactEmail || org.contactPhone
        ? `<ul class="sf-contact">
             ${
               org.contactEmail
                 ? `<li><span class="sf-muted">Email</span>
                    <a href="mailto:${escapeHtml(org.contactEmail)}">${escapeHtml(
                      org.contactEmail,
                    )}</a></li>`
                 : ''
             }
             ${
               org.contactPhone
                 ? `<li><span class="sf-muted">Phone</span>
                    <a href="tel:${escapeHtml(
                      org.contactPhone.replace(/\s+/g, ''),
                    )}">${escapeHtml(org.contactPhone)}</a></li>`
                 : ''
             }
           </ul>`
        : `<p class="sf-prose sf-muted">${escapeHtml(
            org.name,
          )} has not added contact details yet.</p>`
    }

    <p class="sf-prose">To change or cancel a booking, use the link in your confirmation email — it is quicker than waiting for a reply.</p>
  </div></section>`;

  return shell(store, {
    title: `Contact — ${org.name}`,
    active: 'contact',
    body,
  });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (
    parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : '')
  ).toUpperCase();
}

// --- Styles -----------------------------------------------------------------

/**
 * The storefront's own stylesheet.
 *
 * Separate from the booking page's `STYLES`, which is tuned for a single
 * focused checkout column. The two share only the brand variables that
 * `brandCss` emits, so a studio changing its accent changes both and neither
 * can drift into a different palette.
 */
const STOREFRONT_CSS = `
*,*::before,*::after{box-sizing:border-box}
body.sf{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  color:#14181f;background:#fff;-webkit-font-smoothing:antialiased}
img{max-width:100%}
a{color:inherit}
.sf-wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.sf-narrow{max-width:820px}
h1,h2,h3{letter-spacing:-.02em;line-height:1.2}

.sf-header{position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid #e8eaef}
.sf-header-inner{max-width:1120px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;gap:24px}
.sf-brand{font-weight:700;font-size:17px;text-decoration:none;flex:0 0 auto}
.sf-nav{display:flex;gap:20px;flex-wrap:wrap}
.sf-nav a{text-decoration:none;font-size:14px;font-weight:500;color:#4a5262}
.sf-nav a[aria-current]{color:var(--clay);}
.sf-header-right{margin-left:auto;display:flex;align-items:center;gap:14px}
.sf-phone{font-size:14px;color:#4a5262;text-decoration:none}

.sf-btn{display:inline-block;padding:9px 16px;border-radius:999px;border:1px solid #dfe3ea;
  background:#fff;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer}
.sf-btn-primary{background:var(--clay);border-color:var(--clay);color:#fff}
.sf-btn-sm{padding:7px 14px;font-size:13px}
.sf-btn-block{display:block;width:100%;text-align:center;margin-top:12px}

.sf-hero{background:linear-gradient(135deg,var(--clay),var(--clay-dk));
  color:#fff;padding:64px 0 56px}
.sf-hero h1{font-size:44px;margin:14px 0 10px;max-width:16ch}
.sf-lede{font-size:17px;opacity:.92;max-width:52ch;margin:0}
.sf-badge{display:inline-block;padding:5px 13px;border-radius:999px;
  background:rgba(255,255,255,.18);font-size:13px;font-weight:600}

.sf-stats{display:flex;gap:40px;flex-wrap:wrap;margin-top:34px}
.sf-stat b{display:block;font-size:26px;font-weight:750}
.sf-stat span{font-size:13px;opacity:.85}

.sf-section{padding:56px 0}
.sf-alt{background:#f7f8fa}
.sf-section-head{display:flex;align-items:flex-end;gap:24px;margin-bottom:26px;flex-wrap:wrap}
.sf-section-head h2{font-size:28px;margin:6px 0 4px}
.sf-section-head p{margin:0;color:#5c6472;font-size:15px}
.sf-section-head .sf-btn{margin-left:auto}
.sf-eyebrow{font-size:11px;font-weight:750;letter-spacing:.1em;text-transform:uppercase;color:var(--clay)}
.sf-mt{margin-top:44px}

.sf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:22px}
.sf-card{border:1px solid #e8eaef;border-radius:16px;overflow:hidden;background:#fff;
  display:flex;flex-direction:column}
.sf-card-media{position:relative;display:block;height:150px;text-decoration:none}
.sf-emoji{position:absolute;inset:0;display:grid;place-items:center;font-size:44px}
.sf-chip,.sf-price{position:absolute;top:12px;padding:4px 10px;border-radius:999px;
  background:rgba(255,255,255,.92);font-size:12px;font-weight:650;color:#14181f}
.sf-chip{left:12px}
.sf-price{right:12px}
.sf-card-body{padding:16px;display:flex;flex-direction:column;gap:8px;flex:1}
.sf-card-body h3{font-size:17px;margin:0}
.sf-card-body h3 a{text-decoration:none}
.sf-card-price{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;font-size:14px;color:#4a5262}
.sf-card-price b{font-size:18px;color:#14181f}
.sf-card-child{flex-basis:100%;color:#5c6472;font-size:13px}
.sf-meta{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:#5c6472}
.sf-meta-lg{font-size:14px;gap:18px;margin:8px 0 0}
.sf-desc{margin:0;font-size:14px;color:#4a5262;line-height:1.55;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sf-left{color:#1c7a4a;font-weight:650}
.sf-muted{color:#77808f}
.sf-card-body .sf-btn-block{margin-top:auto}

.sf-features{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px}
.sf-feature b{display:block;margin-bottom:4px}
.sf-feature p{margin:0;color:#5c6472;font-size:14px;line-height:1.6}

.sf-empty{border:1px solid #e8eaef;border-radius:16px;padding:44px;text-align:center}
.sf-empty h3{margin:0 0 6px}
.sf-empty p{color:#5c6472;margin:0 0 16px}

.sf-back{font-size:14px;color:#5c6472;text-decoration:none}
.sf-detail{display:grid;grid-template-columns:1fr 330px;gap:44px;margin-top:18px;align-items:start}
.sf-detail h1{font-size:34px;margin:6px 0 0}
.sf-detail h3{font-size:18px;margin:26px 0 8px}
.sf-detail-hero{height:220px;border-radius:18px;display:grid;place-items:center;font-size:64px;position:relative;overflow:hidden}
.sf-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.sf-card-media .sf-chip,.sf-card-media .sf-price{z-index:1}
.sf-prose{line-height:1.75;font-size:15px;margin:16px 0 0;white-space:pre-line}
.sf-highlights{margin:8px 0 0;padding-left:20px;line-height:1.8;font-size:15px}

.sf-aside{border:1px solid #e8eaef;border-radius:16px;padding:20px;position:sticky;top:80px}
.sf-aside-price{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.sf-big{font-size:28px;font-weight:750}
.sf-child{text-align:right;font-size:13px}
.sf-aside-title{margin:18px 0 8px;font-size:12px;font-weight:750;letter-spacing:.06em;
  text-transform:uppercase;color:#77808f}
.sf-slots{list-style:none;margin:0;padding:0}
.sf-slots li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;
  border-bottom:1px solid #eef0f4;font-size:14px}
.sf-slots li:last-child{border-bottom:0}
.sf-fine{font-size:12px;color:#77808f;text-align:center;margin:10px 0 0}

.sf-grid-team{grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}
.sf-person{border:1px solid #e8eaef;border-radius:14px;padding:18px;text-align:center;
  display:flex;flex-direction:column;gap:4px;align-items:center}
.sf-avatar{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;
  color:#fff;font-weight:700;margin-bottom:6px;position:relative;overflow:hidden}
.sf-person .sf-fine{text-align:center}

.sf-contact{list-style:none;padding:0;margin:22px 0 0}
.sf-contact li{display:flex;gap:16px;padding:12px 0;border-bottom:1px solid #eef0f4;font-size:15px}
.sf-contact li span{flex:0 0 70px}

.sf-footer{background:#11151c;color:#c9cfda;padding:48px 0 22px;margin-top:20px}
.sf-foot-grid{max-width:1120px;margin:0 auto;padding:0 24px;display:grid;
  grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:32px}
.sf-foot-grid b{color:#fff;font-size:16px}
.sf-foot-grid h4{color:#fff;font-size:13px;margin:0 0 10px;letter-spacing:.04em}
.sf-foot-grid a{display:block;text-decoration:none;font-size:14px;padding:3px 0;color:#c9cfda}
.sf-foot-grid p{margin:8px 0 0;font-size:14px;line-height:1.6}
.sf-foot-bottom{max-width:1120px;margin:32px auto 0;padding:16px 24px 0;border-top:1px solid #262c37;
  display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:13px;color:#8b93a3}

@media (max-width:860px){
  .sf-detail{grid-template-columns:1fr}
  .sf-aside{position:static}
  .sf-hero{padding:44px 0 40px}
  .sf-hero h1{font-size:32px}
  /* The nav wraps under the brand rather than scrolling sideways: a menu you
     have to discover by dragging is a menu most people never open. */
  .sf-header-inner{flex-wrap:wrap;gap:12px}
  .sf-nav{order:3;width:100%;gap:16px}
}
`;
