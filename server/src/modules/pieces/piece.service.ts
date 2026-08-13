import { Prisma, type PieceStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/app-error';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  timeout: 15_000,
  maxWait: 15_000,
} as const;

/**
 * Piece tracking.
 *
 * ---------------------------------------------------------------------------
 * THE LIFECYCLE BELOW IS AN ASSUMPTION. It models the common two-firing studio
 * path — throw, dry, bisque, glaze, glaze-fire, collect — because that matches
 * the Phase 2 exit gate and most teaching studios. It is NOT universal:
 * single-fire, raku, salt and multiple glaze firings all break it.
 *
 * The transition table is data, in one place, so widening it is an edit rather
 * than a rewrite.
 * ---------------------------------------------------------------------------
 *
 * What is NOT an assumption: a piece belongs to exactly one customer, moves
 * through states in a recorded order, and every move is kept. "Where is my
 * mug" is answerable from the status; "you told me it was ready three weeks
 * ago" is only answerable from the history.
 */

/**
 * Which moves are legal.
 *
 * Written out rather than inferred from enum order, because the interesting
 * transitions are the ones that skip: a piece can break at any point, and a
 * studio correcting a mistake needs to step backwards.
 */
const TRANSITIONS: Record<PieceStatus, PieceStatus[]> = {
  GREENWARE: ['AWAITING_BISQUE', 'BROKEN'],
  AWAITING_BISQUE: ['BISQUE_FIRING', 'GREENWARE', 'BROKEN'],
  BISQUE_FIRING: ['BISQUED', 'BROKEN', 'AWAITING_BISQUE'],
  BISQUED: ['AWAITING_GLAZE', 'BROKEN'],
  AWAITING_GLAZE: ['GLAZE_FIRING', 'BISQUED', 'BROKEN'],
  GLAZE_FIRING: ['FINISHED', 'BROKEN', 'AWAITING_GLAZE'],
  /**
   * A finished piece can go back to AWAITING_GLAZE: refiring for a thin glaze
   * or a missed spot is ordinary studio practice, not an error path.
   */
  FINISHED: ['COLLECTED', 'AWAITING_GLAZE', 'BROKEN'],
  /** Collected is not quite final — a customer can bring work back to refire. */
  COLLECTED: ['AWAITING_GLAZE'],
  /** Broken is final. Mistakes get a new piece, not a resurrection. */
  BROKEN: [],
};

function assertTransition(from: PieceStatus, to: PieceStatus) {
  if (from === to) return;

  if (!TRANSITIONS[from].includes(to)) {
    throw AppError.conflict(
      `A piece cannot go from ${from.toLowerCase().replace(/_/g, ' ')} to ` +
        `${to.toLowerCase().replace(/_/g, ' ')}.`,
      'INVALID_PIECE_TRANSITION',
    );
  }
}

export type CreatePieceInput = {
  customerId: string;
  label: string;
  description?: string;
  shelfLocation?: string;
  sessionId?: string;
  enrollmentId?: string;
  notes?: string;
};

export async function createPiece(
  organizationId: string,
  input: CreatePieceInput,
  actorUserId?: string,
) {
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId },
    select: { id: true },
  });
  if (!customer) throw AppError.badRequest('Customer not found.');

  if (input.sessionId) {
    const session = await prisma.session.findFirst({
      where: { id: input.sessionId, organizationId },
      select: { id: true },
    });
    if (!session) throw AppError.badRequest('Class not found.');
  }

  return prisma.$transaction(async (tx: Tx) => {
    const piece = await tx.piece.create({
      data: {
        organizationId,
        customerId: input.customerId,
        label: input.label,
        description: input.description,
        shelfLocation: input.shelfLocation,
        sessionId: input.sessionId,
        enrollmentId: input.enrollmentId,
        notes: input.notes,
        status: 'GREENWARE',
      },
    });

    await tx.pieceEvent.create({
      data: {
        pieceId: piece.id,
        fromStatus: null,
        toStatus: 'GREENWARE',
        note: 'Made',
        actorUserId,
      },
    });

    return piece;
  }, TX_OPTIONS);
}

/**
 * Creates a piece for every student on a class register, in one go.
 *
 * The realistic capture moment: an instructor at the end of a wheel class with
 * twelve wet pots on a board and no interest in twelve separate forms. Labels
 * default to the student's name, which is what most studios write anyway.
 */
export async function createPiecesForSession(
  organizationId: string,
  sessionId: string,
  entries: { customerId: string; label?: string; count?: number }[],
  actorUserId?: string,
) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, organizationId },
    select: { id: true },
  });
  if (!session) throw AppError.notFound('Class not found.');

  const customers = await prisma.customer.findMany({
    where: {
      id: { in: entries.map((e) => e.customerId) },
      organizationId,
    },
    select: { id: true, name: true },
  });

  const known = new Map(customers.map((c) => [c.id, c.name]));
  const strangers = entries.filter((e) => !known.has(e.customerId));

  if (strangers.length > 0) {
    throw AppError.badRequest(
      `${strangers.length} customer(s) do not belong to this studio.`,
      'UNKNOWN_CUSTOMER',
    );
  }

  const created = [];

  for (const entry of entries) {
    const count = entry.count ?? 1;

    for (let i = 0; i < count; i++) {
      const base = entry.label ?? known.get(entry.customerId)!;
      const label = count > 1 ? `${base} ${i + 1}` : base;

      created.push(
        await createPiece(
          organizationId,
          { customerId: entry.customerId, label, sessionId },
          actorUserId,
        ),
      );
    }
  }

  return { created };
}

/**
 * Moves a piece along, recording the move.
 *
 * Reaching FINISHED stamps `readyAt` and queues the "your work is ready"
 * message — once, guarded by `notifiedAt`, so a studio correcting a status
 * back and forth does not text somebody four times.
 */
export async function updatePieceStatus(
  organizationId: string,
  pieceId: string,
  toStatus: PieceStatus,
  opts: { note?: string; shelfLocation?: string; actorUserId?: string } = {},
) {
  const updated = await prisma.$transaction(async (tx: Tx) => {
    const piece = await tx.piece.findFirst({
      where: { id: pieceId, organizationId },
    });
    if (!piece) throw AppError.notFound('Piece not found.');

    assertTransition(piece.status, toStatus);

    const now = new Date();

    const data: Prisma.PieceUncheckedUpdateInput = {
      status: toStatus,
      ...(opts.shelfLocation !== undefined
        ? { shelfLocation: opts.shelfLocation }
        : {}),
    };

    // The CHECK constraint requires collectedAt to track COLLECTED exactly.
    if (toStatus === 'COLLECTED') data.collectedAt = now;
    else if (piece.status === 'COLLECTED') data.collectedAt = null;

    // The hold period counts from when it FIRST became ready, so a refire
    // does not quietly restart somebody's collection clock.
    if (toStatus === 'FINISHED' && !piece.readyAt) data.readyAt = now;

    const next = await tx.piece.update({ where: { id: pieceId }, data });

    if (piece.status !== toStatus) {
      await tx.pieceEvent.create({
        data: {
          pieceId,
          fromStatus: piece.status,
          toStatus,
          note: opts.note,
          actorUserId: opts.actorUserId,
        },
      });
    }

    return { piece: next, wasStatus: piece.status, notifiedAt: piece.notifiedAt };
  }, TX_OPTIONS);

  if (
    updated.piece.status === 'FINISHED' &&
    updated.wasStatus !== 'FINISHED' &&
    !updated.notifiedAt
  ) {
    await notifyPieceReady(organizationId, pieceId).catch((err) => {
      logger.error({ err, pieceId }, 'Failed to queue piece-ready notification');
    });
  }

  return updated.piece;
}

/**
 * Tells the customer their work is ready.
 *
 * `notifiedAt` is stamped BEFORE queueing rather than after. Telling somebody
 * twice that their mug is ready is a small annoyance; the studio's phone bill
 * and their patience both prefer the failure mode where a message is
 * occasionally missed to the one where it repeats.
 */
async function notifyPieceReady(organizationId: string, pieceId: string) {
  const claimed = await prisma.piece.updateMany({
    where: { id: pieceId, organizationId, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });

  // Somebody else already claimed it.
  if (claimed.count === 0) return { queued: 0 };

  const { schedulePieceReadyNotification } = await import(
    '../notifications/notification.service'
  );

  return schedulePieceReadyNotification(pieceId);
}

export async function listPieces(
  organizationId: string,
  opts: {
    status?: PieceStatus;
    customerId?: string;
    sessionId?: string;
    firingId?: string;
    uncollectedOnly?: boolean;
  } = {},
) {
  return prisma.piece.findMany({
    where: {
      organizationId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      ...(opts.firingId ? { firingId: opts.firingId } : {}),
      ...(opts.uncollectedOnly ? { status: 'FINISHED' } : {}),
    },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      firing: { select: { id: true, firingType: true, startsAt: true, status: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  });
}

export async function getPiece(organizationId: string, pieceId: string) {
  const piece = await prisma.piece.findFirst({
    where: { id: pieceId, organizationId },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      session: { select: { id: true, startsAt: true } },
      firing: { select: { id: true, firingType: true, startsAt: true, status: true } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!piece) throw AppError.notFound('Piece not found.');
  return piece;
}

export async function updatePiece(
  organizationId: string,
  pieceId: string,
  input: { label?: string; description?: string; shelfLocation?: string; notes?: string },
) {
  const piece = await prisma.piece.findFirst({
    where: { id: pieceId, organizationId },
    select: { id: true },
  });
  if (!piece) throw AppError.notFound('Piece not found.');

  return prisma.piece.update({ where: { id: pieceId }, data: input });
}

/**
 * Work that has been sitting finished past the studio's hold period.
 *
 * The studio's own shelf-space problem, and the reason `pieceHoldDays` exists.
 * Reports rather than deletes — nobody wants software that bins a customer's
 * work on a timer.
 */
export async function listUncollected(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { pieceHoldDays: true },
  });

  const cutoff =
    org.pieceHoldDays > 0
      ? new Date(Date.now() - org.pieceHoldDays * 86_400_000)
      : null;

  const pieces = await prisma.piece.findMany({
    where: {
      organizationId,
      status: 'FINISHED',
      ...(cutoff ? { readyAt: { lte: cutoff } } : {}),
    },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
    },
    orderBy: { readyAt: 'asc' },
  });

  return {
    holdDays: org.pieceHoldDays,
    /** Null when the studio holds work indefinitely. */
    cutoff,
    pieces: pieces.map((piece) => ({
      ...piece,
      daysWaiting: piece.readyAt
        ? Math.floor((Date.now() - piece.readyAt.getTime()) / 86_400_000)
        : null,
    })),
  };
}
