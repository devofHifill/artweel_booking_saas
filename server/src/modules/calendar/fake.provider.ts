import { randomUUID } from 'node:crypto';
import {
  CalendarAuthError,
  type CalendarEventInput,
  type CalendarProvider,
  type CalendarTokens,
  type ChangeSet,
  type ChangedEvent,
  type WatchChannel,
} from './provider';

/**
 * In-memory calendar, for tests and for local development without Google
 * credentials.
 *
 * The states worth testing are the ones Google will not produce on demand: an
 * expired sync cursor, a revoked refresh token, an event the instructor added
 * themselves arriving in the same batch as one we wrote. Each has a hook.
 */
export class FakeCalendarProvider implements CalendarProvider {
  readonly name = 'fake';

  private events = new Map<string, ChangedEvent & { marker: string | null }>();
  private pendingChanges: ChangedEvent[] = [];

  /** Test hooks. */
  refreshShouldFail = false;
  nextSyncIsExpired = false;
  writeShouldFail: Error | null = null;

  authorizeUrl(input: { state: string; redirectUri: string }): string {
    return `https://accounts.google.test/consent?state=${encodeURIComponent(input.state)}`;
  }

  async exchangeCode(): Promise<CalendarTokens> {
    return {
      accessToken: `at_${randomUUID().slice(0, 12)}`,
      refreshToken: `rt_${randomUUID().slice(0, 12)}`,
      expiresAt: new Date(Date.now() + 3600_000),
      accountEmail: 'instructor@gmail.test',
    };
  }

  async refreshTokens(): Promise<CalendarTokens> {
    if (this.refreshShouldFail) {
      throw new CalendarAuthError('Refresh token rejected — reconnect required.');
    }

    return {
      accessToken: `at_${randomUUID().slice(0, 12)}`,
      expiresAt: new Date(Date.now() + 3600_000),
    };
  }

  async upsertEvent(input: {
    externalEventId: string | null;
    event: CalendarEventInput;
  }): Promise<{ externalEventId: string }> {
    if (this.writeShouldFail) throw this.writeShouldFail;

    const id = input.externalEventId ?? `ev_${randomUUID().slice(0, 12)}`;

    this.events.set(id, {
      id,
      status: 'confirmed',
      startsAt: input.event.startsAt,
      endsAt: input.event.endsAt,
      summary: input.event.summary,
      transparent: false,
      privateMarker: input.event.privateMarker,
      marker: input.event.privateMarker,
    });

    return { externalEventId: id };
  }

  async deleteEvent(input: { externalEventId: string }): Promise<void> {
    this.events.delete(input.externalEventId);
  }

  /**
   * Simulates the instructor adding something to their own calendar — a
   * dentist appointment, a holiday. No marker, so it must block bookings.
   */
  addExternalEvent(event: {
    startsAt: Date;
    endsAt: Date;
    summary?: string;
    transparent?: boolean;
  }) {
    const id = `ext_${randomUUID().slice(0, 12)}`;

    const record = {
      id,
      status: 'confirmed' as const,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      summary: event.summary ?? 'Busy',
      transparent: event.transparent ?? false,
      privateMarker: null,
      marker: null,
    };

    this.events.set(id, record);
    this.pendingChanges.push(record);
    return id;
  }

  /** Simulates the instructor deleting something. */
  removeExternalEvent(id: string) {
    const existing = this.events.get(id);
    if (!existing) return;

    this.events.delete(id);
    this.pendingChanges.push({ ...existing, status: 'cancelled' });
  }

  /** Everything currently on the calendar, however it got there. */
  queueOurEventsAsChanges() {
    for (const event of this.events.values()) {
      this.pendingChanges.push(event);
    }
  }

  async listChanges(input: { syncToken: string | null }): Promise<ChangeSet> {
    if (this.nextSyncIsExpired) {
      this.nextSyncIsExpired = false;
      return { events: [], nextSyncToken: null, requiresFullSync: true };
    }

    // A full sync returns everything; an incremental one returns only what has
    // been queued since the last call.
    const events = input.syncToken
      ? this.pendingChanges.splice(0)
      : [...this.events.values()];

    return {
      events,
      nextSyncToken: `sync_${randomUUID().slice(0, 8)}`,
      requiresFullSync: false,
    };
  }

  async watch(): Promise<WatchChannel> {
    return {
      channelId: randomUUID(),
      resourceId: `res_${randomUUID().slice(0, 8)}`,
      expiresAt: new Date(Date.now() + 6 * 86_400_000),
      token: randomUUID(),
    };
  }

  async stopWatch(): Promise<void> {}

  get storedEvents() {
    return [...this.events.values()];
  }

  reset() {
    this.events.clear();
    this.pendingChanges = [];
    this.refreshShouldFail = false;
    this.nextSyncIsExpired = false;
    this.writeShouldFail = null;
  }
}
