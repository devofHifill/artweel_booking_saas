import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  CalendarAuthError,
  type CalendarEventInput,
  type CalendarProvider,
  type CalendarTokens,
  type ChangeSet,
  type ChangedEvent,
  type WatchChannel,
} from './provider';

const OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/calendar/v3';

/**
 * Google Calendar, via OAuth on behalf of the instructor.
 *
 * Deliberately NOT a service account. The previous implementation used one,
 * which means a single shared identity reading one hard-coded calendar — it
 * cannot represent "each instructor's own calendar", and every studio would be
 * pointing at the same place. Per-user OAuth is the only model that scales past
 * one tenant.
 *
 * Scope is `calendar.events` rather than full `calendar`: we need to read and
 * write events, not create or delete whole calendars, and asking for less is
 * the difference between an instructor clicking Allow and closing the tab.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = 'google';

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  authorizeUrl(input: { state: string; redirectUri: string }): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events email',
      // Required for a refresh token. Without it the connection silently dies
      // an hour after the instructor sets it up.
      access_type: 'offline',
      // Forces the consent screen so Google re-issues a refresh token even for
      // an account that has approved us before — otherwise a reconnect after
      // NEEDS_REAUTH comes back with no refresh token at all.
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: input.state,
    });

    return `${OAUTH_BASE}?${params.toString()}`;
  }

  async exchangeCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<CalendarTokens> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      throw new CalendarAuthError(
        `Google token exchange failed: ${response.status}`,
      );
    }

    const json = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      id_token?: string;
    };

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
      accountEmail: emailFromIdToken(json.id_token),
    };
  }

  async refreshTokens(refreshToken: string): Promise<CalendarTokens> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');

      /**
       * `invalid_grant` means the refresh token is dead for good — revoked,
       * expired, or the password changed. No amount of retrying helps; only
       * the instructor reconnecting does. Treating this as transient would
       * retry forever while their calendar quietly stopped syncing.
       */
      if (response.status === 400 || body.includes('invalid_grant')) {
        throw new CalendarAuthError('Refresh token rejected — reconnect required.');
      }

      throw new Error(`Google token refresh failed: ${response.status}`);
    }

    const json = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      accessToken: json.access_token,
      // Google usually omits it on refresh; the caller keeps the existing one.
      refreshToken: json.refresh_token,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
    };
  }

  async upsertEvent(input: {
    accessToken: string;
    calendarId: string;
    externalEventId: string | null;
    event: CalendarEventInput;
  }): Promise<{ externalEventId: string }> {
    const body = {
      summary: input.event.summary,
      description: input.event.description,
      location: input.event.location,
      start: {
        dateTime: DateTime.fromJSDate(input.event.startsAt).toISO(),
        timeZone: input.event.timezone,
      },
      end: {
        dateTime: DateTime.fromJSDate(input.event.endsAt).toISO(),
        timeZone: input.event.timezone,
      },
      // The loop-guard marker, invisible to the instructor.
      extendedProperties: {
        private: { bookingSaas: input.event.privateMarker },
      },
      // Explicitly busy: a class must block the instructor's time.
      transparency: 'opaque',
    };

    const path = input.externalEventId
      ? `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.externalEventId)}`
      : `/calendars/${encodeURIComponent(input.calendarId)}/events`;

    const response = await fetch(`${API_BASE}${path}`, {
      method: input.externalEventId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      throw new CalendarAuthError('Access token rejected.');
    }
    if (!response.ok) {
      throw new Error(`Google event write failed: ${response.status}`);
    }

    const json = (await response.json()) as { id: string };
    return { externalEventId: json.id };
  }

  async deleteEvent(input: {
    accessToken: string;
    calendarId: string;
    externalEventId: string;
  }): Promise<void> {
    const response = await fetch(
      `${API_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.externalEventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${input.accessToken}` },
      },
    );

    // 410 means it is already gone, which is the outcome we wanted.
    if (response.status === 404 || response.status === 410) return;
    if (response.status === 401) {
      throw new CalendarAuthError('Access token rejected.');
    }
    if (!response.ok) {
      throw new Error(`Google event delete failed: ${response.status}`);
    }
  }

  async listChanges(input: {
    accessToken: string;
    calendarId: string;
    syncToken: string | null;
    from: Date;
    to: Date;
  }): Promise<ChangeSet> {
    const params = new URLSearchParams({
      singleEvents: 'true',
      maxResults: '250',
      showDeleted: 'true',
    });

    if (input.syncToken) {
      // An incremental sync cannot also constrain the time window; Google
      // rejects the combination.
      params.set('syncToken', input.syncToken);
    } else {
      params.set('timeMin', input.from.toISOString());
      params.set('timeMax', input.to.toISOString());
    }

    const response = await fetch(
      `${API_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${input.accessToken}` } },
    );

    /**
     * 410 GONE means our cursor is older than Google's retention. We cannot
     * know what changed in the gap, so the only correct response is to throw
     * the cursor away and re-read the whole window.
     */
    if (response.status === 410) {
      return { events: [], nextSyncToken: null, requiresFullSync: true };
    }
    if (response.status === 401) {
      throw new CalendarAuthError('Access token rejected.');
    }
    if (!response.ok) {
      throw new Error(`Google list failed: ${response.status}`);
    }

    const json = (await response.json()) as {
      items?: GoogleEvent[];
      nextSyncToken?: string;
    };

    return {
      events: (json.items ?? []).map(toChangedEvent),
      nextSyncToken: json.nextSyncToken ?? null,
      requiresFullSync: false,
    };
  }

  async watch(input: {
    accessToken: string;
    calendarId: string;
    callbackUrl: string;
  }): Promise<WatchChannel> {
    const channelId = randomUUID();
    const token = randomUUID();

    const response = await fetch(
      `${API_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events/watch`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: channelId,
          type: 'web_hook',
          address: input.callbackUrl,
          // Echoed back on every push; how we prove the call is ours.
          token,
        }),
      },
    );

    if (response.status === 401) {
      throw new CalendarAuthError('Access token rejected.');
    }
    if (!response.ok) {
      throw new Error(`Google watch failed: ${response.status}`);
    }

    const json = (await response.json()) as {
      resourceId: string;
      expiration?: string;
    };

    return {
      channelId,
      resourceId: json.resourceId,
      // Google caps these at about a week, so renewal is not optional.
      expiresAt: new Date(
        json.expiration ? Number(json.expiration) : Date.now() + 6 * 86_400_000,
      ),
      token,
    };
  }

  async stopWatch(input: {
    accessToken: string;
    channelId: string;
    resourceId: string;
  }): Promise<void> {
    await fetch(`${API_BASE}/channels/stop`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: input.channelId, resourceId: input.resourceId }),
    }).catch(() => {
      // Best effort. A channel we fail to stop expires on its own within a
      // week, and failing the disconnect over it would strand the row.
    });
  }
}

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
};

function toChangedEvent(event: GoogleEvent): ChangedEvent {
  return {
    id: event.id,
    status: (event.status as ChangedEvent['status']) ?? 'confirmed',
    startsAt: parseWhen(event.start),
    endsAt: parseWhen(event.end),
    summary: event.summary ?? null,
    // "transparent" means the instructor marked it free — it should not block
    // bookings even though it occupies space in their calendar.
    transparent: event.transparency === 'transparent',
    privateMarker: event.extendedProperties?.private?.bookingSaas ?? null,
  };
}

function parseWhen(when?: { dateTime?: string; date?: string }): Date | null {
  if (!when) return null;
  if (when.dateTime) return new Date(when.dateTime);
  // An all-day event. Treated as blocking the whole day.
  if (when.date) return new Date(`${when.date}T00:00:00Z`);
  return null;
}

/** Reads the email claim without verifying — it came straight from Google's
 * token endpoint over TLS, and it is only used for display. */
function emailFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;

  try {
    const payload = idToken.split('.')[1];
    if (!payload) return undefined;
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { email?: string };
    return decoded.email;
  } catch {
    return undefined;
  }
}
