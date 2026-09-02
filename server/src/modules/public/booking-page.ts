import { config } from '../../config';
import { clientScript } from './booking-page.client';
import { tokensCss } from '../../lib/design-tokens';
import { brandCss, resolveBrand } from '../../lib/brand';
import { EMBED_HEIGHT_SCRIPT } from './embed';

/**
 * The public booking page, rendered on the server.
 *
 * Not a client bundle, deliberately. This is the link a studio puts in its
 * Instagram bio, so it has to paint fast on a phone over mobile data and be
 * legible to a crawler — "pottery classes brooklyn" is a search a studio
 * genuinely wants to win. The service list is real HTML in the first response;
 * the step-by-step flow is progressive enhancement on top of it.
 *
 * Everything is inlined: one request, no build step, no CDN.
 */

/**
 * Serialises data for embedding inside a <script> block.
 *
 * HTML escaping is NOT enough here and is in fact wrong — the browser does not
 * decode entities inside a script element. What matters is that the string
 * `</script>` can never appear, because it terminates the block early and
 * everything after it is parsed as HTML. A studio named
 * `</script><script>alert(1)</script>` would otherwise execute.
 *
 * Escaping `<` as < is valid JSON, parses back to the original character,
 * and makes the sequence unrepresentable. Line separators are escaped too:
 * U+2028 and U+2029 are legal in JSON strings but terminate a JavaScript
 * statement.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/**
 * "6 Oct – 10 Nov", in the STUDIO's zone.
 *
 * A cohort's span is the first thing a student checks against their diary, and
 * it must be the studio's calendar dates: a term starting Monday evening in
 * Portland is still Monday for a student reading the page from Berlin.
 */
function dateRange(from: Date, to: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  });
  return `${fmt.format(from)} – ${fmt.format(to)}`;
}

type PageData = {
  organization: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
    /* Read into the page's <style> block by resolveBrand. Optional so a caller
       that has not selected them renders the default rather than failing to
       compile: these are decoration, not data the page depends on. */
    brandPreset?: string | null;
    brandAccent?: string | null;
    /* Owner-authored copy. Every field is optional and every use has a
       fallback below, so a studio that has not touched Website & Widget still
       gets a working page — just a generic one. */
    tagline?: string | null;
    about?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    seoTitle?: string | null;
    seoDescription?: string | null;
  };
  acceptingBookings: boolean;
  /** Whether the studio has finished Stripe onboarding. Never the account id. */
  acceptsPayment: boolean;
  services: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    bookingMode: string;
    durationMinutes: number;
    capacityMax: number;
    priceCents: number;
    color: string;
    skillLevel: string | null;
    /** G3. One bullet per line, split in the page script. */
    highlights?: string | null;
    preparationNotes?: string | null;
    category: { id: string; name: string } | null;
    serviceLocations: { locationId: string }[];
    /* Read by the page script to decide whether to ask for a card, and to
       label the summary. The AMOUNT is never computed from them here — that
       is what /quote is for. */
    depositType?: string;
    depositValue?: number;
    cancellationTiers?:
      | { hoursBefore: number; refundPercent: number; creditPercent?: number }[]
      | null;
  }[];
  locations: {
    id: string;
    name: string;
    locationType: string;
    address: string | null;
    requiresAddress: boolean;
  }[];
  /** Open cohorts. Sold once, covering every dated session in the series. */
  courses?: {
    id: string;
    name: string;
    cohortLabel: string | null;
    description: string | null;
    service: { id: string; name: string };
    sessionCount: number;
    priceCents: number;
    startsAt: Date;
    endsAt: Date;
    seatsRemaining: number;
    enrollable: boolean;
    instructor: string | null;
  }[];
};

const STYLES = `
${tokensCss(config.THEME_PACK)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:24px 20px 64px}
header.studio{padding:28px 0 20px;border-bottom:1px solid var(--line);margin-bottom:24px}
h1{margin:0 0 6px;font-size:1.85rem;letter-spacing:-.02em}
.sub{color:var(--muted);margin:0;font-size:.95rem}
h2{font-size:1.1rem;margin:0 0 14px;letter-spacing:-.01em}
.steps{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:22px;font-size:.78rem}
.steps span{padding:4px 10px;border-radius:99px;background:var(--card);
border:1px solid var(--line);color:var(--muted)}
.steps span.on{background:var(--clay);border-color:var(--clay);color:#fff}
.steps span.done{border-color:var(--clay);color:var(--clay)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
padding:16px;margin-bottom:10px;cursor:pointer;display:flex;gap:14px;
align-items:flex-start;width:100%;text-align:left;font:inherit;color:inherit;
transition:border-color .12s,transform .12s}
.card:hover{border-color:var(--clay);transform:translateY(-1px)}
.card:focus-visible{outline:2px solid var(--clay);outline-offset:2px}
.swatch{width:4px;align-self:stretch;border-radius:2px;flex:0 0 4px}
.card h3{margin:0 0 3px;font-size:1rem}
.card p{margin:0;color:var(--muted);font-size:.88rem}
.meta{margin-top:6px;font-size:.82rem;color:var(--muted)}
.price{margin-left:auto;font-weight:600;white-space:nowrap;padding-left:12px}
.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.slot{padding:11px 6px;border:1px solid var(--line);border-radius:9px;background:var(--card);
cursor:pointer;font:inherit;color:inherit;text-align:center;transition:all .12s}
.slot:hover,.slot.sel{border-color:var(--clay);background:var(--clay);color:#fff}
.day{margin:20px 0 10px;font-weight:600;font-size:.9rem}
label{display:block;margin:14px 0 5px;font-size:.86rem;font-weight:600}
input,textarea,select{width:100%;padding:11px 12px;border:1px solid var(--line);
border-radius:9px;background:var(--card);color:var(--ink);font:inherit}
input:focus,textarea:focus{outline:2px solid var(--clay);outline-offset:-1px;border-color:var(--clay)}
.row{display:flex;gap:12px}.row>*{flex:1}
.check{display:flex;gap:9px;align-items:flex-start;margin:16px 0;font-size:.86rem;
color:var(--muted);font-weight:400}
.check input{width:auto;margin-top:3px;flex:0 0 auto}
button.primary{background:var(--clay);color:#fff;border:0;padding:13px 22px;
border-radius:9px;font:inherit;font-weight:600;cursor:pointer;margin-top:20px}
button.primary:hover{background:var(--clay-dk)}
button.primary:disabled{opacity:.5;cursor:not-allowed}
.back{background:none;border:0;color:var(--muted);font:inherit;cursor:pointer;
padding:6px 0;margin-bottom:14px;text-decoration:underline}
.err{background:#fdecea;border:1px solid #f5c2bd;color:#8b2c21;padding:12px 14px;
border-radius:9px;margin:14px 0;font-size:.9rem}
@media(prefers-color-scheme:dark){.err{background:#3a1d1a;border-color:#6b3029;color:#f3b8b0}}
.ok{text-align:center;padding:34px 0}
.ok .tick{width:54px;height:54px;border-radius:50%;background:var(--ok);color:#fff;
display:flex;align-items:center;justify-content:center;font-size:1.6rem;margin:0 auto 16px}
.summary{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
padding:16px;margin:18px 0;text-align:left}
.summary div{display:flex;justify-content:space-between;padding:6px 0;font-size:.9rem}
.summary div span:first-child{color:var(--muted)}
.hint{color:var(--muted);font-size:.85rem;margin:10px 0}
/* G3 — what is included, where, and what to bring. Sits above the times, so
   it is styled to read as reference material rather than as another control. */
.detail{margin:0 0 22px}
.detail h3{font-size:.9rem;margin:16px 0 6px;letter-spacing:-.01em}
.detail h3:first-child{margin-top:0}
.detail .hint{margin:0}
.included{margin:0;padding-left:18px;color:var(--muted);font-size:.85rem}
.included li{margin:4px 0}
/* G4 — the month grid. Sits above the list, which stays: a grid answers
   "which Saturday" and a list answers "the soonest thing". */
.cal{margin:0 0 20px}
.cal-head{display:flex;align-items:center;justify-content:space-between;
  margin-bottom:10px}
.cal-nav{background:var(--card);border:1px solid var(--line);border-radius:8px;
  width:32px;height:32px;cursor:pointer;color:inherit;font-size:.9rem}
.cal-nav:disabled{opacity:.35;cursor:default}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.cal-dow{text-align:center;font-size:.7rem;color:var(--muted);padding:4px 0}
.cal-pad{aspect-ratio:1}
.cal-day{aspect-ratio:1;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:1px;border:1px solid var(--line);border-radius:8px;
  background:var(--card);color:inherit;font-size:.8rem;cursor:pointer;padding:0}
.cal-day.empty{opacity:.3;border-color:transparent;background:none;cursor:default}
.cal-day .c{font-size:.65rem;color:var(--ok,#3f8f5f);font-weight:600}
.cal-day.on{border-color:var(--clay);background:var(--clay);color:#fff}
.cal-day.on .c{color:#fff}
.tiny-note{color:var(--muted);font-size:.75rem;margin:8px 0 0}
.linkish{background:none;border:0;padding:0;color:var(--clay);cursor:pointer;
  font-size:.75rem;text-decoration:underline}
/* G5 — the confirmation extras. */
.ref{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em}
.row-actions{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 16px}
.btn-link{display:inline-block;background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);padding:9px 14px;font-size:.85rem;color:inherit;
  text-decoration:none;cursor:pointer;font-family:inherit}
.btn-link:hover{border-color:var(--clay)}
/*
  A printed booking is somebody's paper copy: it wants the reference, the time
  and the address, and nothing that only works on a screen. Buttons print as
  empty rectangles, so they are removed rather than greyed.
*/
@media print{
  :root{color-scheme:light}
  body{background:#fff;color:#000}
  .no-print{display:none!important}
  .wrap{max-width:none;padding:0}
  .summary,.detail{border-color:#bbb;background:#fff}
  a[href]::after{content:''}
}
.empty{color:var(--muted);padding:22px 0;text-align:center}
.hidden{display:none}
noscript p{padding:12px;border:1px solid var(--line);border-radius:9px;background:var(--card)}
.about{margin:36px 0 0;padding-top:24px;border-top:1px solid var(--line);color:var(--muted)}
.about p{margin:0 0 12px}
.about p:last-child{margin-bottom:0}
.contact{margin:28px 0 0;padding-top:20px;border-top:1px solid var(--line);
font-size:.9rem;color:var(--muted);text-align:center}
.contact p{margin:4px 0}
.contact a{color:var(--clay);text-decoration:none}
.contact a:hover{text-decoration:underline}
`;

export function renderBookingPage(data: PageData): string {
  const { organization, services, locations } = data;
  const courses = data.courses ?? [];

  /*
    Studio-authored copy wins over the generic fallback. The fallback is what
    every studio got before B8 and is exactly what an untouched studio still
    gets — so a customer landing on `slug/` never sees an empty page while
    the owner works out what to write.
  */
  const title =
    organization.seoTitle?.trim() || `Book a class at ${organization.name}`;
  const description =
    organization.seoDescription?.trim() ||
    (services.length > 0
      ? `Book ${services
          .slice(0, 3)
          .map((s) => s.name)
          .join(', ')} at ${organization.name}. Check live availability and reserve your place online.`
      : `Book online at ${organization.name}.`);
  const tagline =
    organization.tagline?.trim() || 'Choose a class and reserve your place';

  /**
   * JSON-LD so a search result can show price and duration directly. This is
   * cheap to emit and is the difference between a blue link and a rich result
   * for "pottery class near me".
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: organization.name,
    url: `/public/${organization.slug}`,
    makesOffer: services.map((s) => ({
      '@type': 'Offer',
      name: s.name,
      price: (s.priceCents / 100).toFixed(2),
      priceCurrency: organization.currency,
      category: s.category?.name,
    })),
  };

  // Real HTML for the crawler and for anyone without JavaScript. The client
  // script upgrades these same buttons into the step flow.
  const serviceCards = services
    .map(
      (s) => `
      <button class="card" data-service="${escapeHtml(s.id)}" type="button">
        <span class="swatch" style="background:${escapeHtml(s.color)}"></span>
        <span>
          <h3>${escapeHtml(s.name)}</h3>
          ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ''}
          <span class="meta">${duration(s.durationMinutes)}${
            s.bookingMode !== 'APPOINTMENT'
              ? ` &middot; up to ${s.capacityMax} places`
              : ''
          }${s.skillLevel ? ` &middot; ${escapeHtml(s.skillLevel)}` : ''}</span>
        </span>
        <span class="price">${money(s.priceCents, organization.currency)}</span>
      </button>`,
    )
    .join('');

  /*
    Cohorts, in the same first response as the classes.

    A course is not a class with more dates: it is one purchase covering every
    week, so it gets its own section rather than being mixed into the service
    list where "book" would mean a single session. A full or closed cohort is
    still rendered — a student deciding whether to wait for the next one needs
    to see that this one ran — but it is not clickable.
  */
  const courseCards = courses
    .map((c) => {
      const window = `${dateRange(c.startsAt, c.endsAt, organization.timezone)}`;
      const places = c.enrollable
        ? `${c.seatsRemaining} ${c.seatsRemaining === 1 ? 'place' : 'places'} left`
        : 'Closed';

      return `
      <button class="card" data-course="${escapeHtml(c.id)}" type="button"${
        c.enrollable ? '' : ' disabled'
      }>
        <span>
          <h3>${escapeHtml(c.name)}${
            c.cohortLabel ? ` &middot; ${escapeHtml(c.cohortLabel)}` : ''
          }</h3>
          ${c.description ? `<p>${escapeHtml(c.description)}</p>` : ''}
          <span class="meta">${c.sessionCount} sessions &middot; ${window}${
            c.instructor ? ` &middot; ${escapeHtml(c.instructor)}` : ''
          } &middot; ${places}</span>
        </span>
        <span class="price">${money(c.priceCents, organization.currency)}</span>
      </button>`;
    })
    .join('');

  const courseSection = courseCards
    ? `<section id="step-course">
      <h2>Courses</h2>
      <p class="hint">Booked once, covering every week.</p>
      ${courseCards}
    </section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<script type="application/ld+json">${jsonForScript(jsonLd)}</script>
<style>${STYLES}${brandCss(resolveBrand(organization))}</style>
</head>
<body>
<div class="wrap">
  <header class="studio">
    <h1>${escapeHtml(organization.name)}</h1>
    <p class="sub">${escapeHtml(tagline)}</p>
  </header>

  <div class="steps" id="steps"></div>
  <div id="app">
    ${
      data.acceptingBookings
        ? `<section id="step-service">
      <h2>What would you like to book?</h2>
      ${
        serviceCards ||
        (courseCards
          ? ''
          : '<p class="empty">No classes are open for booking right now.</p>')
      }
    </section>
    ${courseSection}`
        : /* Not a 404. The studio still exists, their classes are still worth
             showing, and their existing customers can still manage bookings
             through their own links. */
          `<div class="err">
      ${escapeHtml(organization.name)} is not taking online bookings at the
      moment. Please contact the studio directly.
    </div>
    <section>
      <h2>What they teach</h2>
      ${serviceCards}
    </section>`
    }
  </div>

  <noscript>
    <p>Booking needs JavaScript. Please call the studio, or enable it and reload.</p>
  </noscript>

  ${
    organization.about
      ? /*
          Plain text, split on blank lines into paragraphs. The template
          escapes each paragraph, so a studio pasting from a Word doc gets
          no markdown, no HTML, and no chance to put a <script> onto their
          own booking page — the trade for that is that a link in the about
          box is not clickable, which is fine: this is a description of the
          studio, not a link farm.
        */
        `<section class="about">
      ${organization.about
        .split(/\n\s*\n/)
        .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
        .join('')}
    </section>`
      : ''
  }

  ${
    organization.contactEmail || organization.contactPhone
      ? /*
          The contact block is the fallback when online booking cannot help —
          a session is full, an address is out of range, or the flow just
          confuses somebody. Rendered on every page, not only the not-taking-
          bookings branch, because a customer's question does not know which
          branch produced their frustration.
        */
        `<footer class="contact">
      <p class="hint">Prefer to reach the studio directly?</p>
      ${
        organization.contactEmail
          ? `<p><a href="mailto:${escapeHtml(organization.contactEmail)}">${escapeHtml(organization.contactEmail)}</a></p>`
          : ''
      }
      ${
        organization.contactPhone
          ? `<p><a href="tel:${escapeHtml(organization.contactPhone.replace(/[^+\d]/g, ''))}">${escapeHtml(organization.contactPhone)}</a></p>`
          : ''
      }
    </footer>`
      : ''
  }
</div>

<script>
window.__BOOKING__ = ${jsonForScript({
    slug: organization.slug,
    currency: organization.currency,
    timezone: organization.timezone,
    acceptsPayment: data.acceptsPayment,
    services,
    locations,
    courses,
  })};
</script>
<script>${clientScript}</script>
<script>${EMBED_HEIGHT_SCRIPT}</script>
</body>
</html>`;
}

type ManageData = {
  booking: {
    id: string;
    /** Generated by Postgres. Safe to print; the token in the URL is not. */
    reference?: string | null;
    startsAt: Date;
    endsAt: Date;
    status: string;
    seats: number;
    totalCents: number;
    timezone: string;
    serviceType: { name: string; preparationNotes?: string | null };
    staff: { name: string } | null;
    location: { name: string; address: string | null } | null;
    organization: {
      name: string;
      slug: string;
      currency?: string;
      brandPreset?: string | null;
      brandAccent?: string | null;
    };
    customer: { name: string };
  };
  cancellationQuote: { refundCents: number; creditCents: number } | null;
  canReschedule: boolean;
};

/** Where the "manage your booking" link in a confirmation email lands. */
export function renderManagePage(data: ManageData, token: string): string {
  const b = data.booking;
  const currency = b.organization.currency ?? 'USD';

  const when = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: b.timezone,
    timeZoneName: 'short',
  }).format(b.startsAt);

  const cancelled = b.status === 'CANCELLED';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your booking at ${escapeHtml(b.organization.name)}</title>
<!-- A booking link must never be indexed: the token in the URL is the credential. -->
<meta name="robots" content="noindex,nofollow">
<style>${STYLES}${brandCss(resolveBrand(b.organization))}</style>
</head>
<body>
<div class="wrap">
  <header class="studio">
    <h1>${escapeHtml(b.organization.name)}</h1>
    <p class="sub">${cancelled ? 'This booking was cancelled' : 'Your booking'}</p>
  </header>

  <div class="summary">
    ${
      /* First row on purpose. It is the line somebody reads out when they ring
         the studio, and it is the only identifier here safe to say aloud —
         the token in the URL is the credential. */
      b.reference
        ? `<div><span>Reference</span><span class="ref">${escapeHtml(b.reference)}</span></div>`
        : ''
    }
    <div><span>Class</span><span>${escapeHtml(b.serviceType.name)}</span></div>
    <div><span>When</span><span>${escapeHtml(when)}</span></div>
    ${b.staff ? `<div><span>With</span><span>${escapeHtml(b.staff.name)}</span></div>` : ''}
    ${b.location ? `<div><span>Where</span><span>${escapeHtml(b.location.name)}</span></div>` : ''}
    ${b.seats > 1 ? `<div><span>Places</span><span>${b.seats}</span></div>` : ''}
    <div><span>Total</span><span>${money(b.totalCents, currency)}</span></div>
    <div><span>Status</span><span>${escapeHtml(b.status)}</span></div>
  </div>

  ${
    b.serviceType.preparationNotes && !cancelled
      ? /* G5. This is the page a customer comes back to the night before, from
           the link in their email — which makes it the place "what should I
           bring" is actually read, more than the booking flow was. */
        `<div class="detail">
    <h3>Before you come</h3>
    <p class="hint">${escapeHtml(b.serviceType.preparationNotes)}</p>
  </div>`
      : ''
  }

  ${
    cancelled
      ? '<p class="hint">Nothing more to do here. Book again any time.</p>'
      : `
  <div class="row-actions no-print">
    <a class="btn-link" href="/public/bookings/${encodeURIComponent(token)}/calendar.ics">Add to calendar</a>
    <button type="button" class="btn-link" id="printBtn">Print</button>
  </div>

  ${
    data.cancellationQuote
      ? `<p class="hint">Cancelling now would refund
         ${money(data.cancellationQuote.refundCents, currency)}${
           data.cancellationQuote.creditCents > 0
             ? ` and give ${money(data.cancellationQuote.creditCents, currency)} in studio credit`
             : ''
         }.</p>`
      : ''
  }
  <div id="err"></div>
  <button class="primary no-print" id="cancel" type="button"
    style="background:#8b2c21">Cancel this booking</button>
  `
  }
</div>
<script>
(function(){
  var print = document.getElementById('printBtn');
  if (print) print.addEventListener('click', function(){ window.print(); });

  var btn = document.getElementById('cancel');
  if (!btn) return;
  btn.addEventListener('click', function(){
    if (!confirm('Cancel this booking? This cannot be undone.')) return;
    btn.disabled = true;
    fetch('/public/bookings/${encodeURIComponent(token)}/cancel', { method: 'POST' })
      .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
      .then(function(res){
        if (!res.ok) throw new Error((res.j.error && res.j.error.message) || 'Could not cancel.');
        location.reload();
      })
      .catch(function(e){
        btn.disabled = false;
        document.getElementById('err').innerHTML =
          '<div class="err">' + e.message + '</div>';
      });
  });
})();
</script>
</body>
</html>`;
}
