/**
 * First-touch attribution, without tracking anybody.
 *
 * Stored in this browser's own localStorage and sent once, at signup. No
 * cookie, no third-party script, no identifier that follows a person between
 * sites — which is also why neither the marketing site nor the dashboard needs
 * a consent banner.
 *
 * FIRST touch, not last: the page that introduced somebody to the product is
 * the one worth crediting. Overwriting it on every visit would attribute every
 * signup to whichever page they happened to reload before deciding.
 */

const KEY = 'bsaas.attribution';

export type Attribution = {
  signupSource?: string;
  signupReferrer?: string;
  signupLanding?: string;
};

export function captureAttribution(): void {
  // Already recorded — leave it alone.
  if (localStorage.getItem(KEY)) return;

  const params = new URLSearchParams(window.location.search);

  let referrerHost: string | undefined;
  if (document.referrer) {
    try {
      const url = new URL(document.referrer);
      // Ignore our own pages: arriving at the dashboard from the pricing page
      // is not a referral, and recording it would bury the real sources.
      if (url.hostname !== window.location.hostname) {
        referrerHost = url.hostname;
      }
    } catch {
      referrerHost = undefined;
    }
  }

  const attribution: Attribution = {
    signupSource: params.get('utm_source') ?? undefined,
    signupReferrer: referrerHost,
    signupLanding: window.location.pathname,
  };

  // Nothing worth storing for a direct visit to the dashboard root.
  if (
    !attribution.signupSource &&
    !attribution.signupReferrer &&
    attribution.signupLanding === '/'
  ) {
    return;
  }

  localStorage.setItem(KEY, JSON.stringify(attribution));
}

export function readAttribution(): Attribution {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Attribution) : {};
  } catch {
    return {};
  }
}

/** Cleared after signup — it has done its job and is nobody's business after. */
export function clearAttribution(): void {
  localStorage.removeItem(KEY);
}
