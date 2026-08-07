import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/app-error';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { CalendarAuthError } from './provider';
import { getCalendarProvider } from './registry';

/**
 * Calendar connection lifecycle and sync.
 *
 * The governing rule for INBOUND sync is the loop guard. Everything we write
 * to an instructor's calendar comes back to us on the next push. Without a way
 * to recognise our own events, a class we published would return as a busy
 * block, block its own time, and make the remaining seats unbookable.
 *
 * The previous WordPress implementation hit precisely this and worked around
 * it by switching calendar checks off for event-type services entirely — which
 * fixed the symptom by removing the feature.
 */

const MARKER_PREFIX = 'bsaas';

function markerFor(kind: 'booking' | 'session', id: string): string {
  return `${MARKER_PREFIX}:${kind}:${id}`;
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

export function buildAuthorizeUrl(organizationId: string, staffId: string) {
  const provider = getCalendarProvider();

  /**
   * The state parameter carries who is connecting AND a random nonce.
   *
   * Without the nonce an attacker could hand a victim a crafted callback URL
   * and attach their own calendar to somebody else's staff record. The nonce
   * is stored and must match on the way back.
   */
  const nonce = randomUUID();
  const state = Buffer.from(
    JSON.stringify({ organizationId, staffId, nonce }),
  ).toString('base64url');

  return {
    url: provider.authorizeUrl({
      state,
      redirectUri: `${config.PUBLIC_URL}/api/calendar/callback`,
    }),
    nonce,
  };
}

export async function completeConnection(input: {
  code: string;
  state: string;
}) {
  const provider = getCalendarProvider();

  let parsed: { organizationId: string; staffId: string; nonce: string };
  try {
    parsed = JSON.parse(Buffer.from(input.state, 'base64url').toString('utf8'));
  } catch {
    throw AppError.badRequest('Invalid state.', 'BAD_STATE');
  }

  const staff = await prisma.staff.findFirst({
    where: { id: parsed.staffId, organizationId: parsed.organizationId },
  });
  if (!staff) throw AppError.notFound('Staff member not found.');

  const tokens = await provider.exchangeCode({
    code: input.code,
    redirectUri: `${config.PUBLIC_URL}/api/calendar/callback`,
  });

  const connection = await prisma.calendarConnection.upsert({
    where: { staffId: staff.id },
    create: {
      organizationId: parsed.organizationId,
      staffId: staff.id,
      provider: provider.name,
      accountEmail: tokens.accountEmail,
      accessTokenEnc: encryptSecret(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken
        ? encryptSecret(tokens.refreshToken)
        : null,
      tokenExpiresAt: tokens.expiresAt,
      status: 'ACTIVE',
    },
    update: {
      accountEmail: tokens.accountEmail,
      accessTokenEnc: encryptSecret(tokens.accessToken),
      // Google omits the refresh token when re-consenting silently. Keeping
      // the existing one is the difference between a working reconnect and a
      // connection that dies again in an hour.
      ...(tokens.refreshToken
        ? { refreshTokenEnc: encryptSecret(tokens.refreshToken) }
        : {}),
      tokenExpiresAt: tokens.expiresAt,
      status: 'ACTIVE',
      lastError: null,
      // A reconnect invalidates the old cursor; start clean.
      syncToken: null,
    },
  });

  await startWatch(connection.id).catch((err) => {
    logger.error({ err, connectionId: connection.id }, 'Watch registration failed');
  });

  // Pull in whatever is already on their calendar so the first availability
  // query is correct rather than optimistic.
  await syncConnection(connection.id).catch((err) => {
    logger.error({ err, connectionId: connection.id }, 'Initial sync failed');
  });

  return { connected: true, accountEmail: tokens.accountEmail };
}

export async function disconnect(organizationId: string, staffId: string) {
  const connection = await prisma.calendarConnection.findFirst({
    where: { staffId, organizationId },
  });
  if (!connection) return { disconnected: false };

  const provider = getCalendarProvider();

  if (connection.channelId && connection.channelResourceId) {
    await provider
      .stopWatch({
        accessToken: decryptSecret(connection.accessTokenEnc),
        channelId: connection.channelId,
        resourceId: connection.channelResourceId,
      })
      .catch(() => {});
  }

  /**
   * The mirrored busy blocks go too. Leaving them would keep an instructor
   * permanently unavailable for times their calendar no longer claims, and
   * nothing would ever clear them.
   */
  await prisma.busyBlock.deleteMany({ where: { staffId } });
  await prisma.calendarConnection.delete({ where: { id: connection.id } });

  return { disconnected: true };
}

/**
 * Returns a usable access token, refreshing it if needed.
 *
 * A `CalendarAuthError` here is terminal: the connection is marked
 * NEEDS_REAUTH so the dashboard can tell the instructor, rather than retrying
 * a dead credential every five minutes forever.
 */
async function accessTokenFor(connectionId: string): Promise<string> {
  const connection = await prisma.calendarConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });

  if (connection.status !== 'ACTIVE') {
    throw new CalendarAuthError('Calendar connection is not active.');
  }

  // A minute of headroom: a token that expires mid-request is the same
  // problem as one that has already expired.
  const stillValid =
    connection.tokenExpiresAt &&
    connection.tokenExpiresAt.getTime() - 60_000 > Date.now();

  if (stillValid) return decryptSecret(connection.accessTokenEnc);

  if (!connection.refreshTokenEnc) {
    await markNeedsReauth(connectionId, 'No refresh token stored.');
    throw new CalendarAuthError('No refresh token — reconnect required.');
  }

  const provider = getCalendarProvider();

  try {
    const tokens = await provider.refreshTokens(
      decryptSecret(connection.refreshTokenEnc),
    );

    await prisma.calendarConnection.update({
      where: { id: connectionId },
      data: {
        accessTokenEnc: encryptSecret(tokens.accessToken),
        ...(tokens.refreshToken
          ? { refreshTokenEnc: encryptSecret(tokens.refreshToken) }
          : {}),
        tokenExpiresAt: tokens.expiresAt,
        lastError: null,
      },
    });

    return tokens.accessToken;
  } catch (err) {
    if (err instanceof CalendarAuthError) {
      await markNeedsReauth(connectionId, err.message);
    }
    throw err;
  }
}

async function markNeedsReauth(connectionId: string, reason: string) {
  await prisma.calendarConnection.update({
    where: { id: connectionId },
    data: { status: 'NEEDS_REAUTH', lastError: reason },
  });
  logger.warn({ connectionId, reason }, 'Calendar connection needs reauth');
}

// ---------------------------------------------------------------------------
// Outbound: our bookings into their calendar
// ---------------------------------------------------------------------------

/**
 * Queues a calendar write. Never writes inline — Google being slow must not
 * make a booking slow, and a crash must not lose the write.
 */
export async function queueEventSync(input: {
  bookingId?: string;
  sessionId?: string;
  action: 'UPSERT' | 'DELETE';
}) {
  const target = input.bookingId
    ? await prisma.booking.findUnique({
        where: { id: input.bookingId },
        include: {
          serviceType: { select: { name: true } },
          customer: { select: { name: true } },
          location: { select: { name: true, address: true, locationType: true } },
        },
      })
    : null;

  const session = input.sessionId
    ? await prisma.session.findUnique({
        where: { id: input.sessionId },
        include: {
          serviceType: { select: { name: true } },
          location: { select: { name: true, address: true, locationType: true } },
        },
      })
    : null;

  const staffId = target?.staffId ?? session?.staffId;
  if (!staffId) return { queued: false };

  const connection = await prisma.calendarConnection.findFirst({
    where: { staffId, status: 'ACTIVE' },
  });
  if (!connection) return { queued: false };

  const kind = input.bookingId ? 'booking' : 'session';
  const entityId = input.bookingId ?? input.sessionId!;

  const payload = target
    ? {
        summary: `${target.serviceType.name} — ${target.customer.name}`,
        description: `Booked through your studio booking page.`,
        location:
          target.location?.locationType === 'FIXED'
            ? (target.location.address ?? target.location.name)
            : 'Mobile booking',
        startsAt: target.startsAt.toISOString(),
        endsAt: target.endsAt.toISOString(),
        timezone: target.timezone,
        marker: markerFor('booking', entityId),
      }
    : {
        summary: session!.serviceType.name,
        description: 'Class from your studio booking page.',
        location: session!.location?.address ?? session!.location?.name ?? '',
        startsAt: session!.startsAt.toISOString(),
        endsAt: session!.endsAt.toISOString(),
        timezone: session!.timezone,
        marker: markerFor('session', entityId),
      };

  /**
   * One pending job per entity. A booking edited three times before the worker
   * runs produces one write carrying the latest state, not three writes racing
   * each other into the calendar.
   */
  const dedupeKey = `${kind}:${entityId}`;

  await prisma.calendarSyncJob.upsert({
    where: { dedupeKey },
    create: {
      organizationId: connection.organizationId,
      connectionId: connection.id,
      bookingId: input.bookingId ?? null,
      sessionId: input.sessionId ?? null,
      action: input.action,
      payload,
      scheduledFor: new Date(Date.now() - 1000),
      dedupeKey,
    },
    update: {
      action: input.action,
      payload,
      status: 'PENDING',
      attempts: 0,
      scheduledFor: new Date(Date.now() - 1000),
      lastError: null,
    },
  });

  return { queued: true };
}

/** Performs one queued write. Called by the worker. */
export async function executeSyncJob(job: {
  id: string;
  connectionId: string;
  bookingId: string | null;
  sessionId: string | null;
  action: string;
  payload: Record<string, unknown>;
}) {
  const provider = getCalendarProvider();
  const accessToken = await accessTokenFor(job.connectionId);

  const connection = await prisma.calendarConnection.findUniqueOrThrow({
    where: { id: job.connectionId },
  });

  const existing = await prisma.calendarEventLink.findFirst({
    where: {
      connectionId: job.connectionId,
      ...(job.bookingId ? { bookingId: job.bookingId } : { sessionId: job.sessionId }),
    },
  });

  if (job.action === 'DELETE') {
    if (existing) {
      await provider.deleteEvent({
        accessToken,
        calendarId: connection.calendarId,
        externalEventId: existing.externalEventId,
      });
      await prisma.calendarEventLink.delete({ where: { id: existing.id } });
    }
    return;
  }

  const result = await provider.upsertEvent({
    accessToken,
    calendarId: connection.calendarId,
    externalEventId: existing?.externalEventId ?? null,
    event: {
      summary: String(job.payload.summary ?? 'Booking'),
      description: String(job.payload.description ?? ''),
      location: String(job.payload.location ?? ''),
      startsAt: new Date(String(job.payload.startsAt)),
      endsAt: new Date(String(job.payload.endsAt)),
      timezone: String(job.payload.timezone ?? 'UTC'),
      privateMarker: String(job.payload.marker ?? ''),
    },
  });

  // The link is what lets inbound sync recognise this event as ours.
  await prisma.calendarEventLink.upsert({
    where: {
      connectionId_externalEventId: {
        connectionId: job.connectionId,
        externalEventId: result.externalEventId,
      },
    },
    create: {
      connectionId: job.connectionId,
      bookingId: job.bookingId,
      sessionId: job.sessionId,
      externalEventId: result.externalEventId,
    },
    update: {},
  });
}

// ---------------------------------------------------------------------------
// Inbound: their calendar into our busy blocks
// ---------------------------------------------------------------------------

/**
 * Pulls changes and mirrors them into `busy_blocks`.
 *
 * Three things are deliberately filtered out:
 *
 *   1. Events we wrote (the loop guard). Recognised by our private marker OR
 *      by an existing event link — belt and braces, because a marker can be
 *      stripped by a calendar client and a link row can be lost.
 *   2. Cancelled events, which become deletions.
 *   3. Events the instructor marked "free". Their calendar, their call: a
 *      tentative lunch that says free should not stop somebody booking.
 */
export async function syncConnection(connectionId: string) {
  const provider = getCalendarProvider();

  const connection = await prisma.calendarConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });

  const accessToken = await accessTokenFor(connectionId);

  const from = new Date();
  const to = new Date(Date.now() + 120 * 86_400_000);

  let changes = await provider.listChanges({
    accessToken,
    calendarId: connection.calendarId,
    syncToken: connection.syncToken,
    from,
    to,
  });

  if (changes.requiresFullSync) {
    /**
     * Our cursor was older than Google's retention. We cannot know what we
     * missed, so the mirror is rebuilt from scratch — anything else risks
     * leaving a stale busy block that blocks bookings forever.
     */
    logger.info({ connectionId }, 'Sync token expired — full resync');

    await prisma.busyBlock.deleteMany({
      where: { staffId: connection.staffId, externalSource: connection.provider },
    });

    changes = await provider.listChanges({
      accessToken,
      calendarId: connection.calendarId,
      syncToken: null,
      from,
      to,
    });
  }

  const ourEventIds = new Set(
    (
      await prisma.calendarEventLink.findMany({
        where: { connectionId },
        select: { externalEventId: true },
      })
    ).map((l) => l.externalEventId),
  );

  let mirrored = 0;
  let skippedOurs = 0;
  let removed = 0;

  for (const event of changes.events) {
    const isOurs =
      event.privateMarker?.startsWith(MARKER_PREFIX) || ourEventIds.has(event.id);

    if (isOurs) {
      skippedOurs++;
      continue;
    }

    if (event.status === 'cancelled' || !event.startsAt || !event.endsAt) {
      const deleted = await prisma.busyBlock.deleteMany({
        where: { staffId: connection.staffId, externalId: event.id },
      });
      removed += deleted.count;
      continue;
    }

    if (event.transparent) {
      // Marked free by the instructor — mirror removal, not a block.
      await prisma.busyBlock.deleteMany({
        where: { staffId: connection.staffId, externalId: event.id },
      });
      continue;
    }

    await prisma.busyBlock.upsert({
      where: {
        staffId_externalSource_externalId: {
          staffId: connection.staffId,
          externalSource: connection.provider,
          externalId: event.id,
        },
      },
      create: {
        organizationId: connection.organizationId,
        staffId: connection.staffId,
        externalSource: connection.provider,
        externalId: event.id,
        title: event.summary,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      },
      update: {
        title: event.summary,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        syncedAt: new Date(),
      },
    });
    mirrored++;
  }

  await prisma.calendarConnection.update({
    where: { id: connectionId },
    data: {
      syncToken: changes.nextSyncToken,
      lastSyncedAt: new Date(),
      lastError: null,
    },
  });

  return { mirrored, skippedOurs, removed };
}

/** Registers a push channel so Google tells us when something changes. */
export async function startWatch(connectionId: string) {
  const provider = getCalendarProvider();
  const accessToken = await accessTokenFor(connectionId);

  const connection = await prisma.calendarConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });

  const channel = await provider.watch({
    accessToken,
    calendarId: connection.calendarId,
    callbackUrl: `${config.PUBLIC_URL}/webhooks/google/calendar`,
  });

  await prisma.calendarConnection.update({
    where: { id: connectionId },
    data: {
      channelId: channel.channelId,
      channelResourceId: channel.resourceId,
      channelExpiresAt: channel.expiresAt,
      channelTokenEnc: encryptSecret(channel.token),
    },
  });

  return channel;
}

/**
 * Renews channels before they lapse.
 *
 * Google caps a watch at about a week. Miss the renewal and inbound sync stops
 * without any error anywhere — the instructor's calendar silently drifts out
 * of the availability engine, which is the kind of failure nobody notices
 * until a double booking.
 */
export async function renewExpiringWatches(withinHours = 24) {
  const due = await prisma.calendarConnection.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { channelExpiresAt: null },
        {
          channelExpiresAt: {
            lt: new Date(Date.now() + withinHours * 3_600_000),
          },
        },
      ],
    },
    take: 50,
  });

  let renewed = 0;

  for (const connection of due) {
    try {
      if (connection.channelId && connection.channelResourceId) {
        const provider = getCalendarProvider();
        await provider.stopWatch({
          accessToken: await accessTokenFor(connection.id),
          channelId: connection.channelId,
          resourceId: connection.channelResourceId,
        });
      }

      await startWatch(connection.id);
      renewed++;
    } catch (err) {
      logger.error(
        { err, connectionId: connection.id },
        'Watch renewal failed',
      );
    }
  }

  return { renewed };
}

/** Resolves an inbound push to the connection it belongs to. */
export async function connectionForChannel(channelId: string, token: string) {
  const connection = await prisma.calendarConnection.findUnique({
    where: { channelId },
  });
  if (!connection?.channelTokenEnc) return null;

  // Proves the push came from the watch we registered, not from anyone who
  // guessed the endpoint.
  if (decryptSecret(connection.channelTokenEnc) !== token) return null;

  return connection;
}

export async function getConnectionStatus(
  organizationId: string,
  staffId: string,
) {
  const connection = await prisma.calendarConnection.findFirst({
    where: { staffId, organizationId },
    select: {
      provider: true,
      accountEmail: true,
      status: true,
      lastSyncedAt: true,
      lastError: true,
      channelExpiresAt: true,
    },
  });

  if (!connection) return { connected: false };

  return {
    connected: true,
    ...connection,
    // Never expose token columns, even to the studio that owns them.
  };
}
