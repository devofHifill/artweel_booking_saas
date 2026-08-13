import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { AppError, BookingErrorCode } from '../../lib/app-error';
import { createHold, convertHold, releaseHold } from '../../scheduling/hold.service';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  timeout: 15_000,
  maxWait: 15_000,
} as const;

/**
 * Waitlists.
 *
 * The mechanism is an OFFER, not a broadcast. When a seat frees, it is held
 * for exactly one person for a fixed window and they are told; if they let it
 * lapse it passes to the next. Emailing everyone and letting them race would
 * be simpler and is wrong twice over — the person who checks email fastest
 * wins rather than the one who waited longest, and the other nine follow a
 * link to a failure.
 *
 * The hold is the same `BookingHold` used for Stripe checkout. Same problem
 * shape: a seat reserved for somebody who has not committed yet, released
 * automatically if they never do. Inventing a second reservation mechanism
 * would have meant two things that can each think a seat is theirs.
 */

export type JoinInput = {
  organizationId: string;
  sessionId: string;
  customerId: string;
  seats?: number;
};

/**
 * Joins the queue for a full class.
 *
 * Refuses when the class is NOT full, on purpose: a waitlist entry for a class
 * with seats left is a customer who thinks they are waiting when they could
 * simply book. Sending them back to book is the honest answer.
 */
export async function joinWaitlist(input: JoinInput) {
  const seats = input.seats ?? 1;
  if (seats < 1) throw AppError.badRequest('Seats must be at least 1.');

  try {
    return await prisma.$transaction(async (tx: Tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          capacity: number;
          seats_taken: number;
          status: string;
          starts_at: Date;
        }[]
      >`
        SELECT id, capacity, seats_taken, status::text AS status, starts_at
        FROM sessions
        WHERE id = ${input.sessionId}::uuid
          AND organization_id = ${input.organizationId}::uuid
        FOR UPDATE
      `;

      const session = rows[0];
      if (!session) throw AppError.notFound('Class not found.');

      if (session.status !== 'SCHEDULED') {
        throw new AppError(
          'This class is no longer running.',
          409,
          BookingErrorCode.SLOT_NOT_BOOKABLE,
        );
      }
      if (session.starts_at <= new Date()) {
        throw new AppError(
          'This class has already started.',
          409,
          BookingErrorCode.SLOT_NOT_BOOKABLE,
        );
      }

      if (session.capacity - session.seats_taken >= seats) {
        throw AppError.conflict(
          'There is room in this class — you can book it directly.',
          'SEATS_AVAILABLE',
        );
      }

      /**
       * Position is one past the highest ever issued for this class, not one
       * past the count of people waiting. Counting would reuse a number after
       * somebody withdrew and put two people in the same place in the queue.
       */
      const highest = await tx.waitlistEntry.aggregate({
        where: { sessionId: input.sessionId },
        _max: { position: true },
      });

      return tx.waitlistEntry.create({
        data: {
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          customerId: input.customerId,
          seats,
          status: 'WAITING',
          position: (highest._max.position ?? 0) + 1,
          claimToken: randomBytes(32),
        },
      });
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (isDuplicateEntry(err)) {
      throw AppError.conflict(
        'You are already on the list for this class.',
        'ALREADY_WAITING',
      );
    }
    throw err;
  }
}

function isDuplicateEntry(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; meta?: { target?: unknown }; message?: unknown };

  if (e.code === 'P2002' && Array.isArray(e.meta?.target)) {
    const columns = (e.meta.target as unknown[]).map(String);
    return columns.includes('session_id') && columns.includes('customer_id');
  }

  const message = typeof e.message === 'string' ? e.message : '';
  return message.includes('waitlist_entries_one_live_per_customer');
}

/**
 * Offers a freed seat to whoever is first in line.
 *
 * Called after anything that returns seats — a cancellation, a class being
 * made bigger. Takes a real hold first, so the seat cannot be sold to a
 * passing web visitor while the offer email is in flight.
 *
 * If no hold can be taken the queue is left alone: there was no seat to offer
 * after all, which happens when two cancellations race and the second finds
 * the first already gave the room away.
 */
export async function offerNextSeat(organizationId: string, sessionId: string) {
  const next = await prisma.$transaction(async (tx: Tx) => {
    // Lock the session so two cancellations cannot both decide there is room.
    const rows = await tx.$queryRaw<
      { id: string; capacity: number; seats_taken: number; status: string }[]
    >`
      SELECT id, capacity, seats_taken, status::text AS status
      FROM sessions
      WHERE id = ${sessionId}::uuid AND organization_id = ${organizationId}::uuid
      FOR UPDATE
    `;

    const session = rows[0];
    if (!session || session.status !== 'SCHEDULED') return null;

    const free = session.capacity - session.seats_taken;
    if (free <= 0) return null;

    /**
     * The first person in the queue who fits.
     *
     * Somebody wanting two seats is passed over when only one is free, rather
     * than blocking the queue behind them — but they keep their position, so
     * a later cancellation freeing two still reaches them ahead of people who
     * joined after.
     */
    const candidates = await tx.$queryRaw<
      { id: string; customer_id: string; seats: number }[]
    >`
      SELECT id, customer_id, seats
      FROM waitlist_entries
      WHERE session_id = ${sessionId}::uuid
        AND status = 'WAITING'
        AND seats <= ${free}
      ORDER BY position
      LIMIT 1
      FOR UPDATE
    `;

    return candidates[0] ?? null;
  }, TX_OPTIONS);

  if (!next) return { offered: false as const };

  // The seat, held for them specifically.
  let hold;
  try {
    hold = await createHold({
      organizationId,
      sessionId,
      customerId: next.customer_id,
      seats: next.seats,
      ttlMinutes: config.WAITLIST_OFFER_TTL_MINUTES,
    });
  } catch (err) {
    // Somebody took the seat between the check and the hold. Nothing to
    // offer; the entry stays WAITING for the next opening.
    logger.info({ err, sessionId }, 'Waitlist offer found no seat after all');
    return { offered: false as const };
  }

  const expiresAt = new Date(
    Date.now() + config.WAITLIST_OFFER_TTL_MINUTES * 60_000,
  );

  const claimed = await prisma.waitlistEntry.updateMany({
    where: { id: next.id, status: 'WAITING' },
    data: {
      status: 'OFFERED',
      holdId: hold!.id,
      offeredAt: new Date(),
      offerExpiresAt: expiresAt,
    },
  });

  // Another sweep got there first. Give the seat straight back.
  if (claimed.count === 0) {
    await releaseHold(organizationId, hold!.id).catch(() => {});
    return { offered: false as const };
  }

  const entry = await prisma.waitlistEntry.findUniqueOrThrow({
    where: { id: next.id },
  });

  /**
   * The offer is worthless if nobody hears about it, but a failed email must
   * not leave the seat held for a person who was never told — that is the
   * worst state available, a class showing full for nobody. So a send failure
   * releases the offer and puts them back in the queue.
   */
  try {
    const { scheduleWaitlistOffer } = await import(
      '../notifications/notification.service'
    );
    await scheduleWaitlistOffer(entry.id);
  } catch (err) {
    logger.error({ err, entryId: entry.id }, 'Failed to queue waitlist offer');
    await revokeOffer(organizationId, entry.id).catch(() => {});
    return { offered: false as const };
  }

  return { offered: true as const, entry };
}

/** Puts an offered place back in the queue and frees its seat. */
async function revokeOffer(organizationId: string, entryId: string) {
  const entry = await prisma.waitlistEntry.findFirst({
    where: { id: entryId, organizationId },
  });
  if (!entry || entry.status !== 'OFFERED') return;

  if (entry.holdId) {
    await releaseHold(organizationId, entry.holdId).catch(() => {});
  }

  await prisma.waitlistEntry.update({
    where: { id: entryId },
    data: {
      status: 'WAITING',
      holdId: null,
      offeredAt: null,
      offerExpiresAt: null,
    },
  });
}

/**
 * Takes the offered seat.
 *
 * The hold already owns the seat, so this converts rather than books — the
 * same reasoning as a paid checkout. Booking afresh here would take a second
 * seat and quietly shrink the class.
 */
// Prisma maps `Bytes` to this exact type, not the looser `Uint8Array`.
export async function claimOffer(claimToken: Uint8Array<ArrayBuffer>) {
  const entry = await prisma.waitlistEntry.findUnique({
    where: { claimToken },
    include: {
      session: { select: { id: true, serviceTypeId: true, startsAt: true } },
    },
  });

  if (!entry) throw AppError.notFound('That link is not valid.');

  if (entry.status === 'CLAIMED') {
    throw AppError.conflict('You have already taken this place.', 'ALREADY_CLAIMED');
  }
  if (entry.status !== 'OFFERED') {
    throw AppError.conflict(
      'This place is no longer on offer.',
      'OFFER_NOT_OPEN',
    );
  }
  if (entry.offerExpiresAt && entry.offerExpiresAt <= new Date()) {
    throw AppError.conflict(
      'This offer has expired and the place went to the next person.',
      'OFFER_EXPIRED',
    );
  }
  if (!entry.holdId) {
    throw AppError.conflict('This place is no longer held.', 'OFFER_NOT_OPEN');
  }

  const booking = await convertHold(entry.organizationId, entry.holdId, {
    customerId: entry.customerId,
    serviceTypeId: entry.session.serviceTypeId,
    source: 'waitlist',
  });

  const updated = await prisma.waitlistEntry.updateMany({
    where: { id: entry.id, status: 'OFFERED' },
    data: { status: 'CLAIMED', bookingId: booking.id, holdId: null },
  });

  if (updated.count === 0) {
    // The expiry sweep beat us by a hair. The booking exists and the seat is
    // genuinely theirs, so keep it — cancelling here would be worse.
    logger.warn(
      { entryId: entry.id, bookingId: booking.id },
      'Waitlist offer expired during claim; keeping the booking',
    );
    await prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: { status: 'CLAIMED', bookingId: booking.id, holdId: null },
    });
  }

  const { scheduleBookingNotifications } = await import(
    '../notifications/notification.service'
  );
  await scheduleBookingNotifications(booking.id).catch(() => {});

  return { booking, entry };
}

/**
 * Lapses offers nobody took, and passes each seat to the next in line.
 *
 * Run on the same schedule as the hold sweep. Marking EXPIRED before releasing
 * the hold matters: the other order leaves a window where the seat is free but
 * the entry still says OFFERED, and a concurrent offer round would hand the
 * same seat to two people.
 */
export async function sweepExpiredOffers(now: Date = new Date()) {
  const expired = await prisma.waitlistEntry.findMany({
    where: { status: 'OFFERED', offerExpiresAt: { lte: now } },
    select: { id: true, organizationId: true, sessionId: true, holdId: true },
    take: 200,
  });

  let passedOn = 0;

  for (const entry of expired) {
    const taken = await prisma.waitlistEntry.updateMany({
      where: { id: entry.id, status: 'OFFERED' },
      data: { status: 'EXPIRED', holdId: null },
    });
    if (taken.count === 0) continue;

    if (entry.holdId) {
      await releaseHold(entry.organizationId, entry.holdId).catch(() => {});
    }

    const result = await offerNextSeat(entry.organizationId, entry.sessionId);
    if (result.offered) passedOn += 1;
  }

  return { expired: expired.length, passedOn };
}

export async function listWaitlist(organizationId: string, sessionId: string) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, organizationId },
    select: { id: true, capacity: true, seatsTaken: true },
  });
  if (!session) throw AppError.notFound('Class not found.');

  const entries = await prisma.waitlistEntry.findMany({
    where: { sessionId },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
    },
    orderBy: [{ status: 'asc' }, { position: 'asc' }],
  });

  return {
    session,
    /** The number that answers "should I run a second class?". */
    waitingCount: entries.filter((e) => e.status === 'WAITING').length,
    seatsWanted: entries
      .filter((e) => e.status === 'WAITING')
      .reduce((sum, e) => sum + e.seats, 0),
    entries,
  };
}

/** Withdraws a place, by the studio or the customer. */
export async function leaveWaitlist(organizationId: string, entryId: string) {
  const entry = await prisma.waitlistEntry.findFirst({
    where: { id: entryId, organizationId },
  });
  if (!entry) throw AppError.notFound('Waitlist entry not found.');
  if (entry.status === 'CLAIMED') {
    throw AppError.conflict(
      'That place has already been taken and is now a booking.',
      'ALREADY_CLAIMED',
    );
  }
  if (entry.status === 'CANCELLED') return entry;

  const wasOffered = entry.status === 'OFFERED';

  const updated = await prisma.waitlistEntry.update({
    where: { id: entryId },
    data: {
      status: 'CANCELLED',
      holdId: null,
      offeredAt: null,
      offerExpiresAt: null,
    },
  });

  // Somebody turning down an offer frees the seat for the next person
  // immediately, rather than making them wait out the window.
  if (wasOffered && entry.holdId) {
    await releaseHold(organizationId, entry.holdId).catch(() => {});
    await offerNextSeat(organizationId, entry.sessionId).catch(() => {});
  }

  return updated;
}
