import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb, at } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { FakeCalendarProvider } from '../../src/modules/calendar/fake.provider';
import { setCalendarProvider } from '../../src/modules/calendar/registry';
import {
  completeConnection,
  queueEventSync,
  renewExpiringWatches,
  syncConnection,
} from '../../src/modules/calendar/calendar.service';
import { processCalendarBatch } from '../../src/modules/calendar/calendar.worker';
import { encryptSecret, decryptSecret } from '../../src/lib/crypto';
import { getAvailability } from '../../src/scheduling/availability/availability.service';

/**
 * Calendar sync.
 *
 * The headline case is the loop guard: everything we write to an instructor's
 * calendar comes straight back on the next push, and if we cannot tell our own
 * events apart from theirs, a class blocks its own time and its remaining
 * seats become unbookable.
 */

const app = createApp();
let provider: FakeCalendarProvider;
let studio: Studio;
let staffId: string;
let serviceId: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  provider = new FakeCalendarProvider();
  setCalendarProvider(provider);

  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });

  const staff = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name: 'Rowan Pike', email: 'rowan@clay.test', timezone: 'America/New_York' });
  staffId = staff.body.staff.id;

  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Private Wheel Lesson',
      bookingMode: 'APPOINTMENT',
      durationMinutes: 60,
      slotGranularityMinutes: 60,
      capacityMax: 1,
      priceCents: 12_000,
    });
  serviceId = service.body.service.id;

  await request(app)
    .put(`${studio.base}/services/${serviceId}/staff`)
    .set(studio.headers)
    .send({ staffIds: [staffId] });

  await request(app)
    .post(`${studio.base}/schedules/${staffId}/rules`)
    .set(studio.headers)
    .send({
      ruleType: 'WORKING',
      rrule: 'FREQ=DAILY',
      startMinute: 9 * 60,
      endMinute: 17 * 60,
      effectiveFrom: '2026-01-01T00:00:00Z',
    });
});

/** Runs the OAuth callback the way Google would. */
async function connect() {
  const state = Buffer.from(
    JSON.stringify({
      organizationId: studio.organizationId,
      staffId,
      nonce: 'test-nonce',
    }),
  ).toString('base64url');

  await completeConnection({ code: 'fake-code', state });

  return prisma.calendarConnection.findFirstOrThrow({ where: { staffId } });
}

describe('connecting', () => {
  it('stores tokens encrypted, never in plaintext', async () => {
    // A refresh token is a long-lived key to somebody's calendar. A leaked
    // dump or a stray SELECT must not hand it over.
    const connection = await connect();

    expect(connection.accessTokenEnc).toMatch(/^v1\./);
    expect(connection.refreshTokenEnc).toMatch(/^v1\./);
    expect(connection.accessTokenEnc).not.toContain('at_');
    expect(connection.refreshTokenEnc).not.toContain('rt_');

    // And they round-trip.
    expect(decryptSecret(connection.accessTokenEnc)).toMatch(/^at_/);
  });

  it('never exposes token columns through the API', async () => {
    await connect();

    const res = await request(app)
      .get(`${studio.base}/calendar/${staffId}`)
      .set(studio.headers);

    expect(res.body.connected).toBe(true);
    expect(res.body.accountEmail).toBe('instructor@gmail.test');
    expect(JSON.stringify(res.body)).not.toContain('TokenEnc');
    expect(JSON.stringify(res.body)).not.toContain('v1.');
  });

  it('refuses a connection for another studio staff member', async () => {
    const other = await signUpStudio(app);

    const state = Buffer.from(
      JSON.stringify({
        organizationId: other.organizationId,
        staffId, // belongs to the first studio
        nonce: 'x',
      }),
    ).toString('base64url');

    await expect(
      completeConnection({ code: 'fake-code', state }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('registers a push channel so inbound changes arrive', async () => {
    const connection = await connect();

    expect(connection.channelId).not.toBeNull();
    expect(connection.channelExpiresAt).not.toBeNull();
    expect(connection.channelTokenEnc).toMatch(/^v1\./);
  });

  it('removes mirrored busy blocks on disconnect', async () => {
    // Leaving them would keep the instructor permanently unavailable for
    // times their calendar no longer claims, with nothing to ever clear them.
    const connection = await connect();

    provider.addExternalEvent({
      startsAt: at('2026-09-15T15:00:00Z'),
      endsAt: at('2026-09-15T16:00:00Z'),
      summary: 'Dentist',
    });
    await syncConnection(connection.id);

    expect(await prisma.busyBlock.count()).toBeGreaterThan(0);

    await request(app)
      .delete(`${studio.base}/calendar/${staffId}`)
      .set(studio.headers);

    expect(await prisma.busyBlock.count()).toBe(0);
    expect(await prisma.calendarConnection.count()).toBe(0);
  });
});

describe('outbound sync', () => {
  async function bookOne() {
    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Ada Potter',
        email: 'ada@student.test',
      },
    });

    const { bookAppointment } = await import('../../src/scheduling/booking.service');
    return bookAppointment({
      organizationId: studio.organizationId,
      staffId,
      serviceTypeId: serviceId,
      customerId: customer.id,
      startsAt: at('2026-09-15T14:00:00Z'),
      endsAt: at('2026-09-15T15:00:00Z'),
      timezone: 'America/New_York',
    });
  }

  it('writes the booking into the instructor calendar', async () => {
    await connect();
    const booking = await bookOne();

    await queueEventSync({ bookingId: booking!.id, action: 'UPSERT' });
    const result = await processCalendarBatch();

    expect(result.synced).toBe(1);
    expect(provider.storedEvents).toHaveLength(1);
    expect(provider.storedEvents[0]!.summary).toContain('Ada Potter');

    // The link is what makes the loop guard work on the way back.
    const link = await prisma.calendarEventLink.findFirstOrThrow({});
    expect(link.bookingId).toBe(booking!.id);
  });

  it('collapses repeated edits into a single pending write', async () => {
    // A booking edited three times before the worker runs should produce one
    // write carrying the latest state, not three racing each other.
    await connect();
    const booking = await bookOne();

    await queueEventSync({ bookingId: booking!.id, action: 'UPSERT' });
    await queueEventSync({ bookingId: booking!.id, action: 'UPSERT' });
    await queueEventSync({ bookingId: booking!.id, action: 'UPSERT' });

    expect(await prisma.calendarSyncJob.count()).toBe(1);
  });

  it('updates the same event rather than creating a duplicate', async () => {
    await connect();
    const booking = await bookOne();

    await queueEventSync({ bookingId: booking!.id, action: 'UPSERT' });
    await processCalendarBatch();

    await queueEventSync({ bookingId: booking!.id, action: 'UPSERT' });
    await processCalendarBatch();

    expect(provider.storedEvents).toHaveLength(1);
  });

  it('removes the event when the booking is cancelled', async () => {
    await connect();
    const booking = await bookOne();

    await queueEventSync({ bookingId: booking!.id, action: 'UPSERT' });
    await processCalendarBatch();
    expect(provider.storedEvents).toHaveLength(1);

    await queueEventSync({ bookingId: booking!.id, action: 'DELETE' });
    await processCalendarBatch();

    expect(provider.storedEvents).toHaveLength(0);
    expect(await prisma.calendarEventLink.count()).toBe(0);
  });

  it('queues nothing when no calendar is connected', async () => {
    const booking = await bookOne();

    const result = await queueEventSync({
      bookingId: booking!.id,
      action: 'UPSERT',
    });

    expect(result.queued).toBe(false);
    expect(await prisma.calendarSyncJob.count()).toBe(0);
  });

  it('retries a transient write failure', async () => {
    await connect();
    const booking = await bookOne();

    provider.writeShouldFail = new Error('Google had a moment');
    await queueEventSync({ bookingId: booking!.id, action: 'UPSERT' });

    const first = await processCalendarBatch();
    expect(first.retrying).toBe(1);
    expect(first.synced).toBe(0);

    provider.writeShouldFail = null;
    await prisma.calendarSyncJob.updateMany({
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });

    const second = await processCalendarBatch();
    expect(second.synced).toBe(1);
  });
});

describe('the loop guard', () => {
  it('does not turn our own event into a busy block', async () => {
    // THE bug this whole mechanism exists for. Without it, a class we publish
    // to the instructor's calendar returns as busy and blocks its own slot.
    const connection = await connect();

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Ada Potter',
        email: 'ada@student.test',
      },
    });

    const { bookAppointment } = await import('../../src/scheduling/booking.service');
    const booking = await bookAppointment({
      organizationId: studio.organizationId,
      staffId,
      serviceTypeId: serviceId,
      customerId: customer.id,
      startsAt: at('2026-09-15T14:00:00Z'),
      endsAt: at('2026-09-15T15:00:00Z'),
      timezone: 'America/New_York',
    });

    await queueEventSync({ bookingId: booking!.id, action: 'UPSERT' });
    await processCalendarBatch();

    // Google now pushes everything back at us, including what we just wrote.
    provider.queueOurEventsAsChanges();
    const result = await syncConnection(connection.id);

    expect(result.skippedOurs).toBe(1);
    expect(result.mirrored).toBe(0);
    expect(await prisma.busyBlock.count()).toBe(0);
  });

  it('still mirrors events the instructor added themselves', async () => {
    const connection = await connect();

    provider.addExternalEvent({
      startsAt: at('2026-09-15T15:00:00Z'),
      endsAt: at('2026-09-15T16:00:00Z'),
      summary: 'Dentist',
    });

    const result = await syncConnection(connection.id);

    expect(result.mirrored).toBe(1);

    const block = await prisma.busyBlock.findFirstOrThrow({});
    expect(block.title).toBe('Dentist');
    expect(block.staffId).toBe(staffId);
  });

  it('makes an external event actually block availability', async () => {
    // The whole point: a dentist appointment must remove that slot.
    const connection = await connect();

    provider.addExternalEvent({
      startsAt: at('2026-09-15T15:00:00Z'), // 11:00 EDT
      endsAt: at('2026-09-15T16:00:00Z'),
      summary: 'Dentist',
    });
    await syncConnection(connection.id);

    const availability = await getAvailability({
      organizationId: studio.organizationId,
      serviceTypeId: serviceId,
      fromLocalDate: '2026-09-15',
      toLocalDate: '2026-09-15',
      now: at('2026-09-01T00:00:00Z'),
    });

    const times = availability.slots.map((s) => s.localTime);
    expect(times).not.toContain('11:00');
    expect(times).toContain('12:00');
  });

  it('respects an event the instructor marked free', async () => {
    // Their calendar, their call. A tentative lunch marked free should not
    // stop somebody booking.
    const connection = await connect();

    provider.addExternalEvent({
      startsAt: at('2026-09-15T15:00:00Z'),
      endsAt: at('2026-09-15T16:00:00Z'),
      summary: 'Maybe lunch',
      transparent: true,
    });

    const result = await syncConnection(connection.id);

    expect(result.mirrored).toBe(0);
    expect(await prisma.busyBlock.count()).toBe(0);
  });

  it('removes the block when the instructor deletes the event', async () => {
    const connection = await connect();

    const eventId = provider.addExternalEvent({
      startsAt: at('2026-09-15T15:00:00Z'),
      endsAt: at('2026-09-15T16:00:00Z'),
    });
    await syncConnection(connection.id);
    expect(await prisma.busyBlock.count()).toBe(1);

    provider.removeExternalEvent(eventId);
    const result = await syncConnection(connection.id);

    expect(result.removed).toBe(1);
    expect(await prisma.busyBlock.count()).toBe(0);
  });
});

describe('sync cursors', () => {
  it('rebuilds from scratch when the cursor has expired', async () => {
    // A 410 means we cannot know what we missed. Anything short of a full
    // rebuild risks a stale block that makes an instructor permanently busy.
    const connection = await connect();

    provider.addExternalEvent({
      startsAt: at('2026-09-15T15:00:00Z'),
      endsAt: at('2026-09-15T16:00:00Z'),
      summary: 'Dentist',
    });
    await syncConnection(connection.id);
    expect(await prisma.busyBlock.count()).toBe(1);

    provider.nextSyncIsExpired = true;
    const result = await syncConnection(connection.id);

    // Wiped and re-read, ending in the same correct state.
    expect(result.mirrored).toBe(1);
    expect(await prisma.busyBlock.count()).toBe(1);
  });

  it('stores the cursor for the next incremental sync', async () => {
    const connection = await connect();
    await syncConnection(connection.id);

    const updated = await prisma.calendarConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    expect(updated.syncToken).toMatch(/^sync_/);
    expect(updated.lastSyncedAt).not.toBeNull();
  });
});

describe('credential failure', () => {
  it('marks the connection for reauth when the refresh token is rejected', async () => {
    // invalid_grant is terminal. Retrying forever while the calendar silently
    // stops syncing is the failure mode worth avoiding.
    const connection = await connect();

    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: { tokenExpiresAt: new Date(Date.now() - 60_000) },
    });
    provider.refreshShouldFail = true;

    await expect(syncConnection(connection.id)).rejects.toThrow();

    const updated = await prisma.calendarConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    expect(updated.status).toBe('NEEDS_REAUTH');
    expect(updated.lastError).toContain('reconnect');
  });

  it('fails a queued write immediately rather than retrying a dead credential', async () => {
    const connection = await connect();

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Ada',
        email: 'ada@student.test',
      },
    });
    const { bookAppointment } = await import('../../src/scheduling/booking.service');
    const booking = await bookAppointment({
      organizationId: studio.organizationId,
      staffId,
      serviceTypeId: serviceId,
      customerId: customer.id,
      startsAt: at('2026-09-15T14:00:00Z'),
      endsAt: at('2026-09-15T15:00:00Z'),
      timezone: 'America/New_York',
    });

    await queueEventSync({ bookingId: booking!.id, action: 'UPSERT' });

    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: { tokenExpiresAt: new Date(Date.now() - 60_000) },
    });
    provider.refreshShouldFail = true;

    const result = await processCalendarBatch();

    expect(result.failed).toBe(1);
    expect(result.retrying).toBe(0);
  });

  it('refreshes an expired access token transparently', async () => {
    const connection = await connect();
    const before = decryptSecret(connection.accessTokenEnc);

    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: { tokenExpiresAt: new Date(Date.now() - 60_000) },
    });

    await syncConnection(connection.id);

    const updated = await prisma.calendarConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    expect(decryptSecret(updated.accessTokenEnc)).not.toBe(before);
  });
});

describe('push channels', () => {
  it('ignores a push for an unknown channel but still returns 200', async () => {
    // Google disables a channel that keeps erroring, and losing the channel
    // is worse than ignoring a stray push.
    const res = await request(app)
      .post('/webhooks/google/calendar')
      .set('x-goog-channel-id', 'nonexistent')
      .set('x-goog-channel-token', 'whatever')
      .set('x-goog-resource-state', 'exists');

    expect(res.status).toBe(200);
  });

  it('ignores a push whose token does not match the registered channel', async () => {
    const connection = await connect();

    const res = await request(app)
      .post('/webhooks/google/calendar')
      .set('x-goog-channel-id', connection.channelId!)
      .set('x-goog-channel-token', 'forged-token')
      .set('x-goog-resource-state', 'exists');

    expect(res.status).toBe(200);
    // Nothing synced — the push was not proven to be ours.
    const updated = await prisma.calendarConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    expect(updated.lastSyncedAt).toEqual(connection.lastSyncedAt);
  });

  it('renews a channel that is close to expiring', async () => {
    // Miss this and inbound sync stops with no error anywhere.
    const connection = await connect();
    const originalChannel = connection.channelId;

    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: { channelExpiresAt: new Date(Date.now() + 3_600_000) },
    });

    const result = await renewExpiringWatches(24);
    expect(result.renewed).toBe(1);

    const updated = await prisma.calendarConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    expect(updated.channelId).not.toBe(originalChannel);
    expect(updated.channelExpiresAt!.getTime()).toBeGreaterThan(
      Date.now() + 24 * 3_600_000,
    );
  });
});

describe('credential encryption', () => {
  it('round-trips and produces different ciphertext each time', async () => {
    const secret = 'rt_super_secret_refresh_token';

    const a = encryptSecret(secret);
    const b = encryptSecret(secret);

    expect(a).not.toBe(b); // fresh IV per value
    expect(decryptSecret(a)).toBe(secret);
    expect(decryptSecret(b)).toBe(secret);
  });

  it('rejects tampered ciphertext instead of returning garbage', async () => {
    // GCM is authenticated: a modified payload fails loudly.
    const encoded = encryptSecret('rt_secret');
    const parts = encoded.split('.');
    const flipped = Buffer.from(parts[3]!, 'base64');
    flipped[0] = flipped[0]! ^ 0xff;

    const tampered = [parts[0], parts[1], parts[2], flipped.toString('base64')].join('.');

    expect(() => decryptSecret(tampered)).toThrow();
  });
});
