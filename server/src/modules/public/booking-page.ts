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
    /** Smallest party the studio takes. Optional: older callers omit it. */
    capacityMin?: number;
    priceCents: number;
    color: string;
    /* The storefront's card gradient and glyph, so a class looks the same on
       the booking page as on the card that linked here. */
    colorAccent?: string | null;
    emoji?: string | null;
    shortDescription?: string | null;
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

export const STYLES = `
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
/* Numbered steps joined by a rule, so they read as progress rather than tags. */
.steps{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:26px;
font-size:.88rem;counter-reset:step}
.steps span{display:inline-flex;align-items:center;gap:8px;color:var(--muted);
counter-increment:step;white-space:nowrap}
.steps span::before{content:counter(step);display:inline-flex;align-items:center;
justify-content:center;width:26px;height:26px;border-radius:50%;font-size:.8rem;
font-weight:600;border:1.5px solid var(--line);background:var(--card)}
.steps span+span::after{order:-1;content:'';width:22px;height:1.5px;background:var(--line)}
.steps span.on{color:var(--ink);font-weight:600}
.steps span.on::before{background:var(--clay);border-color:var(--clay);color:#fff}
.steps span.done{color:var(--ink)}
.steps span.done::before{content:'\\2713';border-color:var(--clay);color:var(--clay)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
padding:16px;margin-bottom:10px;cursor:pointer;display:flex;gap:14px;
align-items:flex-start;width:100%;text-align:left;font:inherit;color:inherit;
transition:border-color .12s,transform .12s}
.card:hover{border-color:var(--clay);transform:translateY(-1px);
box-shadow:0 6px 18px -10px rgba(0,0,0,.35)}
.card.static{cursor:default}
.card.static:hover{border-color:var(--line);transform:none;box-shadow:none}
.card:disabled{cursor:not-allowed;opacity:.6}
.card-body{flex:1;min-width:0}
.card-side{display:flex;flex-direction:column;align-items:flex-end;gap:10px;
margin-left:auto;padding-left:12px}
.card-side .price{margin:0;padding:0;font-size:1.05rem}
.go{font-size:.82rem;font-weight:600;color:var(--clay);white-space:nowrap;
opacity:.85;transition:opacity .12s}
.card:hover .go{opacity:1}
.card:focus-visible{outline:2px solid var(--clay);outline-offset:2px}
.swatch{width:4px;align-self:stretch;border-radius:2px;flex:0 0 4px}
.card h3{margin:0 0 4px;font-size:1.05rem}
.card p{margin:0;color:var(--muted);font-size:.93rem}
.meta{display:block;margin-top:8px;font-size:.86rem;color:var(--muted)}
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
button.primary{background:var(--clay);color:#fff;border:0;padding:14px 24px;
border-radius:9px;font:inherit;font-weight:600;cursor:pointer;margin-top:20px;
min-width:220px}
@media(max-width:560px){button.primary{width:100%}}
button.primary:hover{background:var(--clay-dk)}
button.primary:disabled{opacity:.5;cursor:not-allowed}
.back{display:inline-flex;align-items:center;gap:6px;background:none;
border:1px solid var(--line);border-radius:99px;color:var(--muted);font:inherit;
font-size:.86rem;cursor:pointer;padding:6px 14px;margin-bottom:18px;
transition:color .12s,border-color .12s}
.back:hover{color:var(--ink);border-color:var(--muted)}
.err{background:#fdecea;border:1px solid #f5c2bd;color:#8b2c21;padding:12px 14px;
border-radius:9px;margin:14px 0;font-size:.9rem}
@media(prefers-color-scheme:dark){.err{background:#3a1d1a;border-color:#6b3029;color:#f3b8b0}}
/* An announcement, not a failure: amber, and it does not shout. */
.notice{background:var(--card);border:1px solid var(--line);border-left:4px solid #d4a017;
padding:14px 16px;border-radius:var(--radius);margin:0 0 24px;font-size:.93rem;color:var(--muted)}
.notice strong{display:block;color:var(--ink);margin-bottom:2px}
.ok{text-align:center;padding:34px 0}
.ok .tick{width:54px;height:54px;border-radius:50%;background:var(--ok);color:#fff;
display:flex;align-items:center;justify-content:center;font-size:1.6rem;margin:0 auto 16px}
.summary{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
padding:16px;margin:18px 0;text-align:left}
.summary div{display:flex;justify-content:space-between;gap:16px;padding:7px 0;font-size:.93rem}
.summary div span:last-child{text-align:right}
.summary div.total{border-top:1px solid var(--line);margin-top:6px;padding-top:11px;font-weight:600}
.summary div.total span:first-child{color:var(--ink)}
.summary div span:first-child{color:var(--muted)}
.hint{color:var(--muted);font-size:.9rem;margin:10px 0}
/* G3 — what is included, where, and what to bring. Sits above the times, so
   it is styled to read as reference material rather than as another control. */
.detail{margin:0 0 22px}
.detail h3{font-size:.9rem;margin:16px 0 6px;letter-spacing:-.01em}
.detail h3:first-child{margin-top:0}
.detail .hint{margin:0}
.included{margin:0;padding-left:18px;color:var(--muted);font-size:.9rem}
.included li{margin:4px 0}
/* G4 — the month grid. Sits above the list, which stays: a grid answers
   "which Saturday" and a list answers "the soonest thing". */
.cal{margin:0 0 20px;max-width:480px}
.cal-head{display:flex;align-items:center;justify-content:space-between;
  margin-bottom:10px}
.cal-nav{background:var(--card);border:1px solid var(--line);border-radius:8px;
  width:36px;height:36px;cursor:pointer;color:inherit;font-size:.95rem}
.cal-nav:disabled{opacity:.35;cursor:default}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.cal-dow{text-align:center;font-size:.75rem;color:var(--muted);padding:4px 0}
.cal-pad{height:52px}
.cal-day{height:52px;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:2px;border:1px solid var(--line);border-radius:10px;
  background:var(--card);color:inherit;font:inherit;font-size:.9rem;font-weight:600;
  cursor:pointer;padding:0;transition:border-color .12s}
.cal-day:hover{border-color:var(--clay)}
.cal-day.empty{font-weight:400;color:var(--muted);opacity:.45;border-color:transparent;
  background:none;cursor:default}
.cal-day .c{font-size:.68rem;color:var(--ok,#3f8f5f);font-weight:600}
.cal-day.on{border-color:var(--clay);background:var(--clay);color:#fff}
.cal-day.on .c{color:#fff}
.tiny-note{color:var(--muted);font-size:.82rem;margin:10px 0 0}
.linkish{background:none;border:0;padding:0;color:var(--clay);cursor:pointer;
  font:inherit;font-size:.82rem;text-decoration:underline}
/* The chosen time, carried onto the details step. */
.picked{display:flex;justify-content:space-between;align-items:center;gap:12px;
  background:var(--card);border:1px solid var(--line);border-left:4px solid var(--clay);
  border-radius:var(--radius);padding:12px 16px;margin:0 0 6px}
.picked b{display:block}
.picked span{color:var(--muted);font-size:.88rem}
.tz{color:var(--muted);font-weight:400;font-size:.85em}
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

/**
 * The booking flow in the storefront's clothes.
 *
 * Layered over STYLES rather than replacing it: the manage page and the CMS
 * pages still use STYLES alone. The palette is the storefront's -- white
 * ground, #14181f ink, #e8eaef rules, 16px cards, pill buttons -- and the
 * accent is still the studio's own, via `--clay` from brandCss.
 *
 * Variables are set on BODY, not :root, so they win over the token pack's
 * dark-mode block without an !important in sight. The storefront has no dark
 * mode, and a booking page that flips theme halfway through a site does not
 * look like the same site.
 */
export const BOOKING_THEME_CSS = `
body.bk{--bg:#fff;--ink:#14181f;--muted:#5c6472;--line:#e8eaef;--card:#fff;
  --soft:#f7f8fa;--radius:16px;--ok:#1c7a4a;background:#fff;color:#14181f;color-scheme:light;
  font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
/* The storefront's 1120px column, so the header, band and content share one
   left edge. The later steps are a form and a list, which read badly that
   wide, so they narrow once the class grid has gone. */
body.bk .wrap{max-width:1120px;padding:0 24px 72px}
body.bk #app:not(:has(.svc-grid)){max-width:760px}
body.bk .bk-band{background:var(--soft);border-bottom:1px solid var(--line)}
body.bk .bk-band-inner{max-width:1120px;margin:0 auto;padding:36px 24px 30px}
body.bk .bk-band h1{font-size:34px;letter-spacing:-.02em;line-height:1.2;margin:8px 0 6px}
body.bk .bk-band p{margin:0;color:var(--muted);font-size:16px}
body.bk .bk-eyebrow{font-size:11px;font-weight:750;letter-spacing:.1em;text-transform:uppercase;
  color:var(--clay)}
body.bk h2{font-size:24px;letter-spacing:-.02em;margin:0 0 16px}
body.bk #app>h3{font-size:18px;letter-spacing:-.01em}
/* What is included / where / cancellation: reference, so a quiet panel with
   eyebrow labels rather than a stack of headings competing with the calendar. */
body.bk .detail{background:var(--soft);border:1px solid var(--line);border-radius:16px;
  padding:18px 20px}
body.bk .detail h3{font-size:11px;font-weight:750;letter-spacing:.08em;
  text-transform:uppercase;color:var(--muted);margin:14px 0 4px}
body.bk .detail h3:first-child{margin-top:0}
body.bk .detail .hint,body.bk .detail .included{color:var(--ink);font-size:14px}
body.bk #app>h3{margin:28px 0 14px}

/* Steps: a quiet pill track under the band. */
body.bk .steps{margin:26px 0 26px;padding:6px;background:var(--soft);border:1px solid var(--line);
  border-radius:999px;display:inline-flex;gap:4px}
body.bk .steps span{padding:7px 14px 7px 8px;border-radius:999px;font-size:14px;font-weight:500}
body.bk .steps span+span::after{display:none}
body.bk .steps span::before{width:22px;height:22px;font-size:12px;border:0;background:#e3e6ec;color:var(--muted)}
body.bk .steps span.on{background:#fff;box-shadow:0 1px 3px rgba(12,18,32,.12)}
body.bk .steps span.on::before{background:var(--clay);color:#fff}
body.bk .steps span.done::before{background:var(--clay);color:#fff}
body.bk .steps:empty{display:none}

/* Back: the storefront's text link. */
body.bk .back{border:0;padding:0;border-radius:0;font-size:14px;color:var(--muted);margin:0 0 18px}
body.bk .back:hover{color:var(--ink)}

/* Class cards: the storefront's grid card -- gradient media, price chip. */
body.bk .svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px}
body.bk .card.svc{flex-direction:column;gap:0;padding:0;overflow:hidden;margin:0;height:100%;
  border-radius:16px}
body.bk .card.svc:hover{transform:translateY(-2px);box-shadow:0 12px 28px -14px rgba(12,18,32,.35)}
body.bk .svc-media{position:relative;display:grid;place-items:center;height:132px;width:100%;
  font-size:42px}
body.bk .svc-chip{position:absolute;top:12px;right:12px;padding:4px 10px;border-radius:999px;
  background:rgba(255,255,255,.92);font-size:12px;font-weight:650;color:#14181f}
body.bk .svc-cat{left:12px;right:auto}
body.bk .svc-body{display:flex;flex-direction:column;gap:8px;padding:16px;flex:1;width:100%}
body.bk .svc-body h3{font-size:17px;margin:0}
body.bk .svc-body p{margin:0;font-size:14px;color:#4a5262;line-height:1.55;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
body.bk .svc-meta{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:13px;color:var(--muted)}
body.bk .svc-cta{margin-top:auto;display:block;text-align:center;padding:10px 16px;
  border-radius:999px;background:var(--clay);color:#fff;font-weight:600;font-size:14px}
body.bk .card.svc.static .svc-cta{display:none}

/* Row cards: times, locations, instructors, courses. */
body.bk .card{border-radius:14px;padding:16px 18px;margin-bottom:12px;align-items:center}
body.bk .card .swatch{display:none}
body.bk .card h3{font-size:16px}
body.bk .card p{font-size:14px}
body.bk .card .go{padding:7px 14px;border-radius:999px;border:1px solid #dfe3ea;color:var(--ink);
  font-size:13px;opacity:1}
body.bk .card:hover .go{background:var(--clay);border-color:var(--clay);color:#fff}
body.bk .card:hover{box-shadow:0 8px 22px -14px rgba(12,18,32,.3)}

/* Calendar. */
body.bk .cal{max-width:none;border:1px solid var(--line);border-radius:16px;padding:16px}
body.bk .cal-nav{border-radius:999px;border-color:#dfe3ea;background:#fff}
body.bk .cal-day{height:56px;border-radius:12px;border-color:transparent;background:var(--soft)}
body.bk .cal-day:hover{border-color:var(--clay)}
body.bk .cal-day.empty{background:none;opacity:.4}
body.bk .cal-day .c{color:var(--ok)}
body.bk .cal-day.on{background:var(--clay);border-color:var(--clay);color:#fff}
/* Restated here: the green count above outranks the white one STYLES gives
   the selected day, and green on the accent is unreadable. */
body.bk .cal-day.on .c{color:#fff}

/* Details. */
body.bk label{font-size:14px;margin:16px 0 6px}
body.bk input,body.bk textarea,body.bk select{border-color:#dfe3ea;border-radius:12px;background:#fff;
  padding:12px 14px;color:var(--ink)}
body.bk .check{font-size:14px}
body.bk .picked{border-left:1px solid var(--line);border-radius:16px;background:var(--soft);padding:14px 18px}
body.bk .summary{background:var(--soft);border-color:var(--line);border-radius:16px;padding:18px 20px}
body.bk button.primary{border-radius:999px;padding:14px 28px}
body.bk .btn-link{border-radius:999px;border-color:#dfe3ea;background:#fff}
body.bk .notice{border-radius:16px;background:#fff8e6;border-color:#f3dfa6;border-left-color:#d4a017;color:#6b5314}
body.bk .notice strong{color:#4a3a0e}
body.bk .err{border-radius:12px}
body.bk .ok .tick{background:var(--ok)}
@media(max-width:560px){
  body.bk .bk-band h1{font-size:26px}
  body.bk .steps{display:flex;width:100%;justify-content:space-between}
  body.bk .steps span{padding:6px 10px 6px 6px;font-size:13px}
}
`;

export function renderBookingPage(
  data: PageData,
  /* The storefront's header, footer and stylesheet. Absent in the widget,
     where the studio's own site is the chrome. */
  chrome?: { css: string; header: string; footer: string },
): string {
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

  /*
    Real HTML for the crawler and for anyone without JavaScript. The client
    script upgrades these same buttons into the step flow.

    When the studio is not taking bookings the same cards render as plain
    blocks: no button, no hover, no "Book" cue. A card that looks clickable
    under a banner saying "not taking bookings" invites a click the page then
    has to refuse three steps later.
  */
  const serviceCard = (
    s: PageData['services'][number],
    bookable: boolean,
  ): string => {
    const minGuests = s.capacityMin ?? 1;
    const facts = [
      duration(s.durationMinutes),
      s.bookingMode !== 'APPOINTMENT'
        ? `up to ${s.capacityMax} ${s.capacityMax === 1 ? 'place' : 'places'}`
        : '',
      s.bookingMode !== 'APPOINTMENT' && minGuests > 1
        ? `minimum ${minGuests} guests`
        : '',
      s.skillLevel ? escapeHtml(s.skillLevel) : '',
    ].filter(Boolean);
    /* The storefront's gradient: the calendar colour to its accent, flat when
       no accent was picked. */
    const media = `linear-gradient(135deg, ${escapeHtml(s.color)}, ${escapeHtml(
      s.colorAccent ?? s.color,
    )})`;
    const blurb = s.shortDescription || s.description;
    const inner = `
        <span class="svc-media" style="background:${media}">
          ${s.emoji ? escapeHtml(s.emoji) : ''}
          ${s.category ? `<span class="svc-chip svc-cat">${escapeHtml(s.category.name)}</span>` : ''}
          <span class="svc-chip">${money(s.priceCents, organization.currency)}</span>
        </span>
        <span class="svc-body">
          <h3>${escapeHtml(s.name)}</h3>
          <span class="svc-meta">${facts.map((f) => `<span>${f}</span>`).join('')}</span>
          ${blurb ? `<p>${escapeHtml(blurb)}</p>` : ''}
          <span class="svc-cta" aria-hidden="true">Book now</span>
        </span>`;
    return bookable
      ? `
      <button class="card svc" data-service="${escapeHtml(s.id)}" type="button">${inner}
      </button>`
      : `
      <div class="card svc static">${inner}
      </div>`;
  };
  const serviceCards = services
    .map((s) => serviceCard(s, data.acceptingBookings))
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
<style>${STYLES}${chrome ? chrome.css : ''}${BOOKING_THEME_CSS}${brandCss(resolveBrand(organization))}</style>
</head>
<body class="bk${chrome ? ' sf' : ''}">
${chrome ? chrome.header : ''}
<div class="bk-band"><div class="bk-band-inner">
  <div class="bk-eyebrow">Book online</div>
  <h1>${escapeHtml(chrome ? `Book with ${organization.name}` : organization.name)}</h1>
  <p>${escapeHtml(tagline)}</p>
</div></div>
<div class="wrap">
  <div class="steps" id="steps"></div>
  <div id="app">
    ${
      data.acceptingBookings
        ? `<section id="step-service">
      <h2>What would you like to book?</h2>
      ${
        (serviceCards && `<div class="svc-grid">${serviceCards}</div>`) ||
        (courseCards
          ? ''
          : '<p class="empty">No classes are open for booking right now.</p>')
      }
    </section>
    ${courseSection}`
        : /* Not a 404. The studio still exists, their classes are still worth
             showing, and their existing customers can still manage bookings
             through their own links. */
          `<div class="notice">
      <strong>Online booking is paused.</strong>
      ${escapeHtml(organization.name)} is not taking online bookings right
      now${
        organization.contactEmail || organization.contactPhone
          ? ' &mdash; get in touch using the details at the bottom of this page.'
          : '. Please contact the studio directly.'
      }
    </div>
    <section>
      <h2>What they teach</h2>
      <div class="svc-grid">${serviceCards}</div>
    </section>`
    }
  </div>

  <noscript>
    <p>Booking needs JavaScript. Please call the studio, or enable it and reload.</p>
  </noscript>

  ${
    organization.about && !chrome
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
    !chrome && (organization.contactEmail || organization.contactPhone)
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
${chrome ? chrome.footer : ''}

<script>
window.__BOOKING__ = ${jsonForScript({
    slug: organization.slug,
    /* For the "nothing here" moments: somebody who finds no dates is offered
       the studio itself, not a dead end. The same details the footer shows. */
    studioName: organization.name,
    contactEmail: organization.contactEmail ?? null,
    contactPhone: organization.contactPhone ?? null,
    currency: organization.currency,
    timezone: organization.timezone,
    acceptsPayment: data.acceptsPayment,
    /* The page script leaves the cards inert when false. The server refuses
       the booking either way; this is so nobody fills in a form first. */
    acceptingBookings: data.acceptingBookings,
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
    /** Set for a class booking — which moves to a date, not a time. */
    sessionId?: string | null;
    startsAt: Date;
    endsAt: Date;
    status: string;
    seats: number;
    totalCents: number;
    timezone: string;
    serviceType: {
      name: string;
      preparationNotes?: string | null;
      bookingInstructions?: string | null;
      meetingPoint?: string | null;
    };
    staff: { name: string } | null;
    location: { name: string; address: string | null; locationType?: string } | null;
    session?: {
      location: { name: string; address: string | null; locationType?: string } | null;
    } | null;
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

/** A booking's status as a customer reads it, not as the database stores it. */
const STATUS_WORDS: Record<string, string> = {
  PENDING: 'Not confirmed yet',
  CONFIRMED: 'Confirmed',
  ATTENDED: 'Attended',
  NO_SHOW: 'Missed',
  CANCELLED: 'Cancelled',
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
  const place = b.location ?? b.session?.location ?? null;

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
    ${
      /* Where, with the address — a name alone gets nobody to a building they
         have not been to. The class's location when the booking has none of
         its own (it was made before the class had one). When nothing is known
         yet, say so rather than leave the question unanswered. */
      place
        ? `<div><span>Where</span><span>${escapeHtml(
            [place.name, place.address].filter(Boolean).join(', '),
          )}</span></div>`
        : b.serviceType.meetingPoint
          ? ''
          : `<div><span>Where</span><span>${escapeHtml(b.organization.name)} will send the details</span></div>`
    }
    ${
      /* Directly under Where, because it finishes that answer rather than
         starting a new one. "Gowanus Studio" gets somebody to the building;
         "second door, ring the bell" gets them through it. */
      b.serviceType.meetingPoint
        ? `<div><span>Meeting point</span><span>${escapeHtml(b.serviceType.meetingPoint)}</span></div>`
        : ''
    }
    ${b.seats > 1 ? `<div><span>Places</span><span>${b.seats}</span></div>` : ''}
    <div><span>Total</span><span>${money(b.totalCents, currency)}</span></div>
    <div><span>Status</span><span>${escapeHtml(STATUS_WORDS[b.status] ?? b.status)}</span></div>
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
    /* Written for somebody who has already booked, so this page is the only
       place it belongs — it never appears on the booking page, where it would
       be answering a question the reader has not asked yet. */
    b.serviceType.bookingInstructions && !cancelled
      ? `<div class="detail">
    <h3>What happens next</h3>
    <p class="hint">${escapeHtml(b.serviceType.bookingInstructions)}</p>
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
  ${
    /* Changing the date, before cancelling — most people who can no longer
       make it would rather move than lose their place. The options, and any
       reason it cannot be done (too close to the start, the studio's policy),
       come from the server when asked. */
    b.startsAt > new Date()
      ? `<div class="detail no-print" id="move">
    <h3>Need a different ${b.sessionId ? 'date' : 'time'}?</h3>
    <button type="button" class="btn-link" id="moveOpen">Change the ${b.sessionId ? 'date' : 'time'}</button>
    <div id="moveList"></div>
  </div>`
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

  var TOKEN = '${encodeURIComponent(token)}';
  var moveOpen = document.getElementById('moveOpen');
  var moveList = document.getElementById('moveList');
  function esc(s){ var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
  function fail(msg){ moveList.innerHTML = '<div class="err">' + esc(msg) + '</div>'; }
  if (moveOpen) moveOpen.addEventListener('click', function(){
    moveOpen.disabled = true;
    moveList.innerHTML = '<p class="hint">Finding other ${b.sessionId ? 'dates' : 'times'}&hellip;</p>';
    fetch('/public/bookings/' + TOKEN + '/reschedule-options')
      .then(function(r){ return r.json(); })
      .then(function(res){
        moveOpen.disabled = false;
        if (!res.allowed) { moveList.innerHTML = '<p class="hint">' + esc(res.reason) + '</p>'; return; }
        var items = res.sessions.length ? res.sessions : res.slots;
        if (!items.length) {
          moveList.innerHTML = '<p class="hint">Nothing else is free at the moment. Contact the studio, or keep your place.</p>';
          return;
        }
        var fmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long',
          hour: 'numeric', minute: '2-digit', timeZone: res.timezone });
        moveList.innerHTML = '<p class="hint">Pick one. Your booking, payment and this link stay the same.</p>' +
          items.slice(0, 40).map(function(it, i){
            return '<button type="button" class="slot" data-i="' + i + '">' + esc(fmt.format(new Date(it.startsAt))) +
              (it.seatsAvailable != null ? ' <span class="hint">' + it.seatsAvailable + ' left</span>' : '') + '</button>';
          }).join('');
        Array.prototype.forEach.call(moveList.querySelectorAll('button[data-i]'), function(el){
          el.addEventListener('click', function(){
            var it = items[Number(el.getAttribute('data-i'))];
            if (!confirm('Move your booking to ' + fmt.format(new Date(it.startsAt)) + '?')) return;
            el.disabled = true;
            var body = it.sessionId ? { sessionId: it.sessionId } : { startsAt: it.startsAt };
            fetch('/public/bookings/' + TOKEN + '/reschedule', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            })
              .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
              .then(function(r){
                if (!r.ok) throw new Error((r.j.error && r.j.error.message) || 'Could not move the booking.');
                location.reload();
              })
              .catch(function(e){ el.disabled = false; fail(e.message); });
          });
        });
      })
      .catch(function(){ moveOpen.disabled = false; fail('Could not load other dates. Try again.'); });
  });

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
