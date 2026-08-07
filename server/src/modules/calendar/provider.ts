/**
 * Calendar providers, behind an interface.
 *
 * Google is the only implementation at launch, but the shape here is
 * deliberately provider-neutral: Outlook via Microsoft Graph is the same three
 * operations (write an event, list what changed, watch for pushes) with
 * different nouns, and that is a Phase 3 item.
 *
 * As with payments, the fake is not a shortcut. The paths that matter —
 * an expired sync token, a rejected refresh token, a push arriving for an
 * event we wrote ourselves — cannot be produced on demand from the real API.
 */

export type CalendarTokens = {
  accessToken: string;
  refreshToken?: string;
  /** Absolute expiry, already resolved from the provider's relative value. */
  expiresAt: Date;
  accountEmail?: string;
};

export type CalendarEventInput = {
  summary: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  /**
   * Written into the provider's own private metadata. This is the belt to the
   * event-link table's braces: even if our mapping row is lost, an event we
   * authored still identifies itself on the way back in.
   */
  privateMarker: string;
};

export type ChangedEvent = {
  id: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  startsAt: Date | null;
  endsAt: Date | null;
  summary: string | null;
  /** Whether the busy/free flag says this event actually blocks time. */
  transparent: boolean;
  /** Our marker, if this event came from us. */
  privateMarker: string | null;
};

export type ChangeSet = {
  events: ChangedEvent[];
  /** Cursor for the next incremental sync. */
  nextSyncToken: string | null;
  /**
   * True when the provider rejected the cursor as too old. Everything must be
   * re-read from scratch, because we cannot know what was missed.
   */
  requiresFullSync: boolean;
};

export type WatchChannel = {
  channelId: string;
  resourceId: string;
  expiresAt: Date;
  token: string;
};

/** Distinguishes "reconnect required" from "try again later". */
export class CalendarAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarAuthError';
  }
}

export interface CalendarProvider {
  readonly name: string;

  authorizeUrl(input: { state: string; redirectUri: string }): string;

  exchangeCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<CalendarTokens>;

  refreshTokens(refreshToken: string): Promise<CalendarTokens>;

  upsertEvent(input: {
    accessToken: string;
    calendarId: string;
    externalEventId: string | null;
    event: CalendarEventInput;
  }): Promise<{ externalEventId: string }>;

  deleteEvent(input: {
    accessToken: string;
    calendarId: string;
    externalEventId: string;
  }): Promise<void>;

  listChanges(input: {
    accessToken: string;
    calendarId: string;
    syncToken: string | null;
    /** Used only for a full sync; incremental ignores it. */
    from: Date;
    to: Date;
  }): Promise<ChangeSet>;

  watch(input: {
    accessToken: string;
    calendarId: string;
    callbackUrl: string;
  }): Promise<WatchChannel>;

  stopWatch(input: {
    accessToken: string;
    channelId: string;
    resourceId: string;
  }): Promise<void>;
}
