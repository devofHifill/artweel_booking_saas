import { Prisma, type FiringType, type PieceStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { allocateResource } from '../../scheduling/resource.service';
import { updatePieceStatus } from '../pieces/piece.service';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  timeout: 15_000,
  maxWait: 15_000,
} as const;

/**
 * Kiln firings.
 *
 * The pleasing part of this workstream is how little of it is new. A kiln was
 * already an EXCLUSIVE Resource in Phase 0, and exclusive resources already
 * cannot overlap — a partial `EXCLUDE` constraint in Postgres says so, kept
 * honest by a BEFORE trigger. So "two firings cannot claim one kiln" needs no
 * code here at all: a firing takes a ResourceAllocation and the database
 * refuses the second one.
 *
 * ASSUMPTION, UNVALIDATED: firings are SCHEDULED in advance, like a class.
 * Some studios instead fill a kiln opportunistically and fire when it is full,
 * which is a queue rather than a calendar. That model would keep this table
 * and drop the times, so the shape survives either way — but a studio that
 * works the second way will find the scheduling here beside the point.
 */

/**
 * Which piece states a firing of each type can accept, and where it leaves
 * them. Data rather than branches, so a third firing type is an entry.
 */
const FIRING_RULES: Record<
  FiringType,
  { accepts: PieceStatus[]; loaded: PieceStatus; fired: PieceStatus }
> = {
  BISQUE: {
    accepts: ['AWAITING_BISQUE'],
    loaded: 'BISQUE_FIRING',
    fired: 'BISQUED',
  },
  GLAZE: {
    accepts: ['AWAITING_GLAZE'],
    loaded: 'GLAZE_FIRING',
    fired: 'FINISHED',
  },
};

export type CreateFiringInput = {
  resourceId: string;
  firingType: FiringType;
  startsAt: Date;
  endsAt: Date;
  cone?: string;
  notes?: string;
};

/**
 * Books a kiln for a firing.
 *
 * The span must cover COOLING as well as the firing itself. A kiln full of
 * cooling work is not available, and a studio that books over that opens it
 * early and cracks the load — so the allocation deliberately holds the whole
 * period rather than just the hours the elements are on.
 */
export async function createFiring(
  organizationId: string,
  input: CreateFiringInput,
) {
  if (input.startsAt >= input.endsAt) {
    throw AppError.badRequest('A firing must start before it ends.');
  }

  const kiln = await prisma.resource.findFirst({
    where: { id: input.resourceId, organizationId },
    select: { id: true, resourceType: true, isExclusive: true, isActive: true },
  });
  if (!kiln) throw AppError.badRequest('Kiln not found.');
  if (!kiln.isActive) {
    throw AppError.conflict('That kiln is not currently available.');
  }

  /**
   * Refusing a non-exclusive resource rather than coping with one.
   *
   * A "kiln" with quantity 8 would take eight simultaneous firings without
   * complaint, because the EXCLUDE constraint only guards exclusive rows. That
   * is a data-entry mistake with a physical consequence, and it is far better
   * caught here than discovered by two loads booked into one kiln.
   */
  if (!kiln.isExclusive) {
    throw AppError.badRequest(
      'A kiln must be set up as an exclusive resource with a quantity of 1, ' +
        'so that two firings cannot be booked into it at once.',
      'KILN_NOT_EXCLUSIVE',
    );
  }

  // This is the check. The EXCLUDE constraint rejects an overlapping firing.
  const allocation = await allocateResource({
    organizationId,
    resourceId: input.resourceId,
    quantity: 1,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    note: `${input.firingType} firing`,
  });

  try {
    return await prisma.firing.create({
      data: {
        organizationId,
        resourceId: input.resourceId,
        firingType: input.firingType,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        cone: input.cone,
        notes: input.notes,
        status: 'SCHEDULED',
        resourceAllocationId: allocation.id,
      },
    });
  } catch (err) {
    // Give the kiln back rather than leaving it held by a firing that does
    // not exist.
    await prisma.resourceAllocation
      .delete({ where: { id: allocation.id } })
      .catch(() => {});
    throw err;
  }
}

export async function listFirings(
  organizationId: string,
  opts: { from?: Date; to?: Date; status?: string; resourceId?: string } = {},
) {
  const firings = await prisma.firing.findMany({
    where: {
      organizationId,
      ...(opts.resourceId ? { resourceId: opts.resourceId } : {}),
      ...(opts.status ? { status: opts.status as never } : {}),
      ...(opts.from || opts.to
        ? {
            startsAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    include: {
      resource: { select: { id: true, name: true } },
      _count: { select: { pieces: true } },
    },
    orderBy: { startsAt: 'asc' },
  });

  return firings;
}

export async function getFiring(organizationId: string, firingId: string) {
  const firing = await prisma.firing.findFirst({
    where: { id: firingId, organizationId },
    include: {
      resource: { select: { id: true, name: true } },
      pieces: {
        include: {
          customer: { select: { id: true, name: true } },
        },
        orderBy: { label: 'asc' },
      },
    },
  });

  if (!firing) throw AppError.notFound('Firing not found.');
  return firing;
}

/**
 * Packs pieces into a firing.
 *
 * Only work that is actually waiting for THIS kind of firing can go in: a
 * greenware pot cannot join a glaze load. Rejected pieces are reported rather
 * than silently dropped, because "I put twelve in and it says nine" is a
 * conversation a studio should never have to have with its own software.
 */
export async function loadPieces(
  organizationId: string,
  firingId: string,
  pieceIds: string[],
  actorUserId?: string,
) {
  const firing = await prisma.firing.findFirst({
    where: { id: firingId, organizationId },
  });
  if (!firing) throw AppError.notFound('Firing not found.');

  if (firing.status === 'COMPLETE' || firing.status === 'CANCELLED') {
    throw AppError.conflict(
      'That firing is finished. Pieces cannot be added to it.',
      'FIRING_CLOSED',
    );
  }

  const rules = FIRING_RULES[firing.firingType];

  const pieces = await prisma.piece.findMany({
    where: { id: { in: pieceIds }, organizationId },
    select: { id: true, status: true, label: true },
  });

  const found = new Map(pieces.map((p) => [p.id, p]));
  const loaded: string[] = [];
  const rejected: { pieceId: string; reason: string }[] = [];

  for (const pieceId of pieceIds) {
    const piece = found.get(pieceId);

    if (!piece) {
      rejected.push({ pieceId, reason: 'Not found in this studio.' });
      continue;
    }

    if (!rules.accepts.includes(piece.status)) {
      rejected.push({
        pieceId,
        reason: `${piece.label} is ${piece.status
          .toLowerCase()
          .replace(/_/g, ' ')}, which is not ready for a ${firing.firingType.toLowerCase()} firing.`,
      });
      continue;
    }

    await prisma.piece.update({
      where: { id: pieceId },
      data: { firingId: firing.id },
    });

    await updatePieceStatus(organizationId, pieceId, rules.loaded, {
      note: `Loaded into ${firing.firingType.toLowerCase()} firing`,
      actorUserId,
    });

    loaded.push(pieceId);
  }

  return { loaded: loaded.length, rejected };
}

export async function unloadPiece(
  organizationId: string,
  firingId: string,
  pieceId: string,
  actorUserId?: string,
) {
  const firing = await prisma.firing.findFirst({
    where: { id: firingId, organizationId },
  });
  if (!firing) throw AppError.notFound('Firing not found.');

  const piece = await prisma.piece.findFirst({
    where: { id: pieceId, organizationId, firingId },
  });
  if (!piece) throw AppError.notFound('That piece is not in this firing.');

  const rules = FIRING_RULES[firing.firingType];

  await prisma.piece.update({ where: { id: pieceId }, data: { firingId: null } });

  // Back to the queue it came from.
  await updatePieceStatus(organizationId, pieceId, rules.accepts[0]!, {
    note: 'Taken back out of the load',
    actorUserId,
  });

  return { unloaded: true };
}

/**
 * Which firing states may follow which.
 *
 * The intermediate states are ADVISORY, not a gate. A studio that fired the
 * kiln on Saturday and opened the app on Monday must be able to mark the load
 * complete without first walking it through loading, firing and cooling —
 * that is ceremony the software would be inventing, and the reliable result
 * of demanding it is a studio that stops updating statuses at all.
 *
 * The invariant worth enforcing is only that the terminal states are terminal:
 * a completed firing has already advanced its pieces and notified their
 * owners, so reopening it would double-count both.
 */
const IN_PROGRESS = ['LOADING', 'FIRING', 'COOLING', 'COMPLETE', 'CANCELLED'];

const FIRING_FLOW: Record<string, string[]> = {
  SCHEDULED: IN_PROGRESS,
  LOADING: ['SCHEDULED', ...IN_PROGRESS],
  FIRING: IN_PROGRESS,
  COOLING: IN_PROGRESS,
  COMPLETE: [],
  CANCELLED: [],
};

/**
 * Advances the firing, and on COMPLETE advances everything in it.
 *
 * Completing a glaze firing is what moves its pieces to FINISHED, which is
 * what texts their owners. One action in the studio — closing off a load —
 * produces the notification the customer has been waiting for, rather than
 * asking someone to remember to mark twelve pieces individually.
 */
export async function updateFiringStatus(
  organizationId: string,
  firingId: string,
  status: string,
  actorUserId?: string,
) {
  const firing = await prisma.firing.findFirst({
    where: { id: firingId, organizationId },
  });
  if (!firing) throw AppError.notFound('Firing not found.');

  if (firing.status !== status && !FIRING_FLOW[firing.status]!.includes(status)) {
    throw AppError.conflict(
      `A firing cannot go from ${firing.status.toLowerCase()} to ${status.toLowerCase()}.`,
      'INVALID_FIRING_TRANSITION',
    );
  }

  const updated = await prisma.firing.update({
    where: { id: firingId },
    data: { status: status as never },
  });

  if (status === 'COMPLETE') {
    const rules = FIRING_RULES[firing.firingType];

    const pieces = await prisma.piece.findMany({
      where: { firingId, organizationId, status: rules.loaded },
      select: { id: true },
    });

    for (const piece of pieces) {
      await updatePieceStatus(organizationId, piece.id, rules.fired, {
        note: `${firing.firingType} firing complete`,
        actorUserId,
      });
    }

    return { firing: updated, piecesAdvanced: pieces.length };
  }

  if (status === 'CANCELLED') {
    return { firing: await releaseKiln(organizationId, firing.id), piecesAdvanced: 0 };
  }

  return { firing: updated, piecesAdvanced: 0 };
}

/**
 * Frees the kiln and returns every piece to its queue.
 *
 * A cancelled firing that kept its allocation would block the kiln for a load
 * that is never happening — the most annoying possible bug in a studio with
 * one kiln and a waiting list.
 */
async function releaseKiln(organizationId: string, firingId: string) {
  return prisma.$transaction(async (tx: Tx) => {
    const firing = await tx.firing.findFirstOrThrow({
      where: { id: firingId, organizationId },
    });

    if (firing.resourceAllocationId) {
      await tx.resourceAllocation
        .delete({ where: { id: firing.resourceAllocationId } })
        .catch(() => {});
    }

    const rules = FIRING_RULES[firing.firingType];

    await tx.piece.updateMany({
      where: { firingId, status: rules.loaded },
      data: { status: rules.accepts[0]!, firingId: null },
    });

    return tx.firing.update({
      where: { id: firingId },
      data: { status: 'CANCELLED', resourceAllocationId: null },
    });
  }, TX_OPTIONS);
}

/** What is waiting for a kiln — the studio's "should I fire today" question. */
export async function firingQueue(organizationId: string) {
  const [awaitingBisque, awaitingGlaze] = await Promise.all([
    prisma.piece.count({ where: { organizationId, status: 'AWAITING_BISQUE' } }),
    prisma.piece.count({ where: { organizationId, status: 'AWAITING_GLAZE' } }),
  ]);

  return { awaitingBisque, awaitingGlaze };
}
