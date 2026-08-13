import { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../../config';

/**
 * The embeddable booking widget.
 *
 * A studio pastes two lines into their own site and gets their booking page
 * inline. The spec calls this a distribution channel rather than a feature,
 * and the WordPress plugin is a thin shim around the same two lines.
 */

/**
 * Lets a page be framed by anybody.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE ONE PLACE IN THE APP WHERE FRAMING IS ALLOWED, AND IT MUST STAY
 * THAT WAY. The global helmet policy sets `frame-ancestors 'self'` and
 * `X-Frame-Options: SAMEORIGIN` across everything; both are undone here, for
 * the public booking pages only.
 *
 * Relaxing it globally instead would make the DASHBOARD framable, and a
 * framable dashboard is a clickjacking target: an attacker overlays an
 * invisible copy of it and a studio owner clicks "cancel all bookings"
 * thinking they clicked something else. There is a test asserting the
 * dashboard and API still refuse to be framed, precisely so that a future
 * blanket relaxation fails loudly rather than silently.
 *
 * Why `*` rather than a per-studio allowlist: a booking page is public, and
 * anything it can do inside a frame it can already do at its own URL. There is
 * no session and no cookie to steal — the only credential in this whole
 * surface is a booking's own cancel token, which arrives by email and is not
 * in the page. An allowlist would add configuration a studio has to maintain
 * in exchange for protecting nothing.
 * ---------------------------------------------------------------------------
 */
export function allowEmbedding(_req: Request, res: Response, next: NextFunction) {
  // Helmet's default. It predates frame-ancestors and still wins in some
  // browsers, so removing it is not optional.
  res.removeHeader('X-Frame-Options');

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      'frame-ancestors *',
    ].join('; '),
  );

  next();
}

/**
 * The loader script.
 *
 * Deliberately tiny and dependency-free: it runs on somebody else's website,
 * where it is a guest. It must not need a build step, must not fight whatever
 * framework is already there, and must not throw if the studio pastes it twice.
 */
const LOADER = `(function () {
  'use strict';

  var ORIGIN = '${config.PUBLIC_URL}';
  var MOUNTED = 'artweelMounted';

  function mount(el) {
    // Pasting the snippet twice is a thing studios do. Mounting twice is not.
    if (el.dataset[MOUNTED]) return;
    el.dataset[MOUNTED] = '1';

    var slug = el.getAttribute('data-studio');
    if (!slug) return;

    var iframe = document.createElement('iframe');
    iframe.src = ORIGIN + '/public/' + encodeURIComponent(slug) + '?embed=1';
    iframe.setAttribute('title', 'Book a class');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('allow', 'payment');
    iframe.style.width = '100%';
    iframe.style.border = '0';
    iframe.style.display = 'block';
    // A first guess before the real height arrives, so the page does not
    // visibly jump from nothing to full size.
    iframe.style.height = (el.getAttribute('data-height') || '900') + 'px';

    el.appendChild(iframe);
    el.__artweelFrame = iframe;
  }

  function mountAll() {
    var nodes = document.querySelectorAll('[data-studio]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  window.addEventListener('message', function (event) {
    // Only our own booking page may resize our own frame. Without this check
    // any script on the host page could drive the iframe's height.
    if (event.origin !== ORIGIN) return;

    var data = event.data;
    if (!data || data.type !== 'artweel:height') return;

    var height = parseInt(data.height, 10);
    if (!height || height < 100 || height > 20000) return;

    var nodes = document.querySelectorAll('[data-studio]');
    for (var i = 0; i < nodes.length; i++) {
      var frame = nodes[i].__artweelFrame;
      if (frame && frame.contentWindow === event.source) {
        frame.style.height = height + 'px';
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }
})();
`;

export const embedRouter = Router();

embedRouter.get('/embed.js', (_req, res) => {
  res.type('application/javascript');
  // Cached, but briefly: a studio that pastes the snippet and then sees a bug
  // fixed should not wait a day for it. The file is under 2KB.
  res.setHeader('Cache-Control', 'public, max-age=300');
  // The loader itself is meant to be fetched cross-origin; that is its job.
  res.setHeader('Access-Control-Allow-Origin', '*');

  /**
   * Helmet defaults `Cross-Origin-Resource-Policy: same-origin`, which blocks
   * this file from loading on anybody else's site — the browser refuses with
   * ERR_BLOCKED_BY_RESPONSE.NotSameOrigin and the widget never appears.
   *
   * Worth knowing that CORS headers do NOT cover this. A classic `<script
   * src>` is a no-cors subresource request, so `Access-Control-Allow-Origin`
   * is never consulted and CORP decides alone. Setting one without the other
   * looks correct in every header assertion and fails in every browser, which
   * is exactly how this was found.
   */
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  res.send(LOADER);
});

/**
 * The snippet a studio copies.
 *
 * Lives server-side so the dashboard and the docs cannot drift from what the
 * loader actually expects.
 */
export function embedSnippet(slug: string): string {
  return (
    `<div data-studio="${slug}"></div>\n` +
    `<script src="${config.PUBLIC_URL}/embed.js" async></script>`
  );
}

/**
 * Posted by the booking page to its host, so the frame grows with content.
 *
 * Without it the widget is a fixed-height box with its own scrollbar inside
 * somebody else's page, which is the single most obvious sign of a cheap
 * embed. Sent on load, on resize, and whenever the page mutates — the booking
 * flow changes height at every step.
 */
export const EMBED_HEIGHT_SCRIPT = `(function () {
  if (window.parent === window) return;

  var last = 0;

  function report() {
    /**
     * Measured from the body's own box, NOT scrollHeight.
     *
     * scrollHeight is bounded below by the viewport, and inside an iframe the
     * viewport IS the frame — so a 900px frame containing 400px of content
     * reports 900 and the frame can never shrink below whatever it was first
     * given. The bottom edge of the body is content-driven, so the frame
     * tracks the content in both directions.
     */
    var rect = document.body.getBoundingClientRect();
    var height = Math.ceil(rect.height + rect.top);
    // Only on real change, or a MutationObserver in a busy page turns into a
    // postMessage flood.
    if (Math.abs(height - last) < 8) return;
    last = height;
    parent.postMessage({ type: 'artweel:height', height: height }, '*');
  }

  window.addEventListener('load', report);
  window.addEventListener('resize', report);
  new MutationObserver(report).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
  });
  setTimeout(report, 60);
})();`;
