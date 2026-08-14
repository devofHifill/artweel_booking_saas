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

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
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

  if (response.status === 401 && !retrying && tokens.refresh) {
    if (await refreshTokens()) {
      return request<T>(path, init, true);
    }
    // Refresh failed — the session is genuinely over.
    window.dispatchEvent(new CustomEvent('bsaas:signed-out'));
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

export type TodayResponse = {
  timezone: string;
  currency: string;
  today: BookingListItem[];
  stats: {
    todayCount: number;
    todaySeats: number;
    upcomingWeek: number;
    outstandingCents: number;
  };
  alerts: {
    paymentsNotEnabled: boolean;
    failedNotifications: number;
    calendarsNeedingReauth: number;
  };
};

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
