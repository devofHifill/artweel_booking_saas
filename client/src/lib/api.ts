/**
 * The API client.
 *
 * Two things it exists to get right:
 *
 *   1. Access tokens are short-lived and expire mid-session. Every caller
 *      handling that individually would mean every caller getting it slightly
 *      wrong, so a 401 is retried ONCE here after a refresh, transparently.
 *
 *   2. Concurrent requests must not each fire their own refresh. The first
 *      one to notice starts it; the rest await the same promise. Without
 *      that, five parallel calls produce five refreshes, four of which are
 *      replays of a rotated token — and rotation treats a replay as theft and
 *      revokes the whole family.
 */

const ACCESS_KEY = 'bsaas.access';
const REFRESH_KEY = 'bsaas.refresh';

/**
 * A platform support session (S7), handed over by the /admin client.
 *
 * In sessionStorage, not localStorage, and deliberately: it dies with the tab,
 * which is about the lifetime of the session anyway, and it does not follow the
 * operator into every other tab they have open.
 */
const SUPPORT_KEY = 'bsaas.support';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Picks up a support session handed over in the URL fragment, and strips it.
 *
 * Runs before React mounts, from main.tsx, because `tokens.access` is consulted
 * by the very first request the app makes.
 *
 * WHY A FRAGMENT, given a token in a URL is normally a smell. Two other
 * options were tried and are worse:
 *
 *   sessionStorage written by the ADMIN tab before `window.open` — this poisons
 *   the operator's own tab. `tokens.access` prefers a support token, so every
 *   `/api/platform/*` call the admin surface makes would start using a token
 *   that cannot reach it, and the operator's console breaks the moment they
 *   open a session. Found by opening the page rather than by any test.
 *
 *   Relying on `window.open` to COPY sessionStorage into the new tab — it does
 *   not when the tab is opened with `noopener`, which is not something to give
 *   up on a window opened from an operator console.
 *
 * A fragment is never sent to the server, never reaches a log, and lives in the
 * new tab's address bar for a single paint before `replaceState` removes it —
 * so it does not enter history and is not in the URL if the operator later
 * screenshots the page. That is a better exposure profile than either
 * alternative, not merely a different one.
 */
export function adoptSupportTokenFromUrl(): void {
  const hash = window.location.hash;
  if (!hash.startsWith('#support=')) return;

  const token = decodeURIComponent(hash.slice('#support='.length));

  try {
    sessionStorage.setItem(SUPPORT_KEY, token);
  } catch {
    /* Private mode. The session simply will not start, which is safe. */
  }

  // Out of the address bar before anything can screenshot or bookmark it.
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search,
  );
}

export const tokens = {
  /** Set while this tab is driving a support session. */
  get support() {
    try {
      return sessionStorage.getItem(SUPPORT_KEY);
    } catch {
      return null;
    }
  },

  /** A support token wins for this tab, so the whole client works unchanged. */
  get access() {
    return this.support ?? localStorage.getItem(ACCESS_KEY);
  },

  /**
   * A support session has NO refresh token, and must never borrow the
   * operator's own.
   *
   * This guard is the whole reason `refresh` is not just a localStorage read.
   * Without it, the moment the 30-minute support token expired the client would
   * quietly refresh using the operator's personal credentials and carry on —
   * except now as an ordinary session for a studio they are very likely not a
   * member of, with no support row, no banner on the studio's dashboard, and
   * nothing in the audit log. The expiry is supposed to be a wall; this is what
   * stops the client from walking around it.
   */
  get refresh() {
    if (this.support) return null;
    return localStorage.getItem(REFRESH_KEY);
  },

  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },

  /**
   * Lets go of a finished support session without touching the operator's own
   * credentials.
   *
   * Separate from `clear()` because a dead support token must not sign the
   * operator out of everything — and because leaving it in place is worse than
   * either: `access` prefers it, so the tab would keep sending a token the
   * server has already refused, including after a fresh login.
   */
  dropSupport() {
    try {
      sessionStorage.removeItem(SUPPORT_KEY);
    } catch {
      /* Nothing was stored, so nothing to remove. */
    }
  },

  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    this.dropSupport();
  },
};

/** Shared so parallel 401s collapse into one refresh. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refreshToken = tokens.refresh;
  if (!refreshToken) return false;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        if (!response.ok) {
          tokens.clear();
          return false;
        }

        const json = await response.json();
        tokens.set(json.tokens.accessToken, json.tokens.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        // Cleared in a microtask so everyone awaiting this attempt resolves
        // against it before a new one can start.
        queueMicrotask(() => {
          refreshInFlight = null;
        });
      }
    })();
  }

  return refreshInFlight;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retrying = false,
): Promise<T> {
  const headers = new Headers(init.headers);

  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const access = tokens.access;
  if (access) headers.set('Authorization', `Bearer ${access}`);

  const response = await fetch(path, { ...init, headers });

  if (response.status === 401 && !retrying) {
    /**
     * A support session cannot refresh — it has no refresh token, by design.
     * What it must do instead is LET GO.
     *
     * Leaving the dead token in sessionStorage is the failure worth naming:
     * `tokens.access` prefers it, so the tab would go on presenting a token
     * the server has already refused — and because signing in again only
     * writes localStorage, even a fresh login would not rescue it. The tab
     * 401s forever.
     */
    if (tokens.support) {
      tokens.dropSupport();
      window.dispatchEvent(new CustomEvent('bsaas:signed-out'));
    } else if (tokens.refresh) {
      if (await refreshTokens()) {
        return request<T>(path, init, true);
      }
      // Refresh failed — the session is genuinely over.
      window.dispatchEvent(new CustomEvent('bsaas:signed-out'));
    }
  }

  if (response.status === 204) return undefined as T;

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      json?.error?.message ?? 'Something went wrong.',
      response.status,
      json?.error?.code,
      json?.error?.details,
    );
  }

  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// --- Shared shapes ---------------------------------------------------------

export type BookingListItem = {
  id: string;
  /** The short handle, generated by Postgres. Null only on rows predating G5. */
  reference: string | null;
  /** web | embed | admin. Rendered under the reference, as the demo does. */
  source: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: string;
  seats: number;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  notes: string | null;
  customer: { id: string; name: string; email: string; phone: string | null };
  service: { id: string; name: string; color: string; bookingMode: string };
  staff: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
};

/*
   `TodayResponse` lived here until the dashboard replaced the Today page.
   The server route `/bookings/today` still exists and is still tested — B9
   (Daily Manifest) is the likely next consumer — but nothing in the client
   calls it now, so the type went with the page rather than sitting here as a
   shape nobody constructs.
*/

export type Membership = {
  organizationId: string;
  role: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
  };
};

export function money(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/**
 * Times are always rendered in the STUDIO's zone, never the browser's.
 *
 * A studio owner checking today's schedule from an airport must see the times
 * their customers will actually turn up at.
 */
export function timeIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(iso));
}

/**
 * A wall-clock time the user typed, read as the STUDIO's clock.
 *
 * The mirror image of `timeIn`, and needed for the same reason. A
 * `datetime-local` input hands back "2026-08-14T20:00" with no zone attached,
 * and `new Date(...)` on that resolves it against the BROWSER's zone. An owner
 * scheduling a kiln for 8pm from a laptop set to another timezone would book
 * it for a different eight hours than the one they meant.
 *
 * Endpoints that take wall-clock parts (`startLocalDate` + `localStartTime`)
 * do not need this — the server resolves those against the studio's zone
 * already. It is for the ones that take an absolute instant.
 *
 * Two passes: the first finds the zone's offset near the target instant, the
 * second re-checks it at the corrected instant, which matters when the two
 * land on opposite sides of a daylight-saving change.
 */
export function zonedToInstant(local: string, timezone: string): Date {
  const naive = new Date(`${local}:00Z`).getTime();

  const offsetAt = (instant: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(instant));

    const at = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);

    // "24" appears at midnight in some locales; Date.UTC handles 0 correctly.
    const shown = Date.UTC(
      at('year'),
      at('month') - 1,
      at('day'),
      at('hour') % 24,
      at('minute'),
      at('second'),
    );
    return shown - instant;
  };

  const firstPass = naive - offsetAt(naive);
  return new Date(naive - offsetAt(firstPass));
}

/**
 * A date far enough away that the year matters.
 *
 * `dateIn` deliberately omits the year, which is right for a schedule — nobody
 * needs telling that tonight's class is this year. It is wrong for an expiry:
 * a credit lapsing on 14 August 2027 renders as "Sat, Aug 14", indisting-
 * uishable from one lapsing today.
 */
export function expiryIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(iso));
}

export function dateIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  }).format(new Date(iso));
}

/**
 * Today's date in the STUDIO's zone, as `YYYY-MM-DD`.
 *
 * `en-CA` because it formats as ISO, which is what every endpoint taking a
 * `localDate` expects. Not `new Date().toISOString().slice(0, 10)` — that is
 * today in UTC, and a studio in Portland loading this at 6pm would be handed
 * tomorrow.
 *
 * Lived privately in Classes.tsx until the counter booking form wanted the
 * same two. A third copy of a date helper is how the three drift apart.
 */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Walks a `YYYY-MM-DD` forward by whole days.
 *
 * Anchored at UTC midnight deliberately: this is calendar arithmetic on a
 * wall-clock date, not on an instant, so it must not pick up a daylight-saving
 * shift on the way. Adding 30 days to a local date should land on the same
 * clock date regardless of what the zone did in between.
 */
export function plusDays(localDate: string, days: number): string {
  const d = new Date(`${localDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
