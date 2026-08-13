import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as pieces from './piece.service';

/**
 * Mounted under /api/organizations/:organizationId/pieces.
 *
 * `requireMember` throughout except deletion. Logging pots and moving them
 * through the kiln is the daily work of whoever is in the studio, and an
 * admin-only piece tracker is one nobody keeps up to date — the same reasoning
 * as the register.
 */
export const pieceRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

const PIECE_STATUS = [
  'GREENWARE',
  'AWAITING_BISQUE',
  'BISQUE_FIRING',
  'BISQUED',
  'AWAITING_GLAZE',
  'GLAZE_FIRING',
  'FINISHED',
  'COLLECTED',
  'BROKEN',
] as const;

pieceRouter.get(
  '/',
  requireMember,
  validateQuery(
    z.object({
      status: z.enum(PIECE_STATUS).optional(),
      customerId: z.string().uuid().optional(),
      sessionId: z.string().uuid().optional(),
      firingId: z.string().uuid().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json({
      pieces: await pieces.listPieces(
        req.tenant!.organizationId,
        req.query as Parameters<typeof pieces.listPieces>[1],
      ),
    });
  }),
);

/** Work sitting on the shelf past the studio's hold period. */
pieceRouter.get(
  '/uncollected',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(await pieces.listUncollected(req.tenant!.organizationId));
  }),
);

pieceRouter.post(
  '/',
  requireMember,
  validateBody(
    z.object({
      customerId: z.string().uuid(),
      label: z.string().min(1).max(120),
      description: z.string().max(2000).optional(),
      shelfLocation: z.string().max(120).optional(),
      sessionId: z.string().uuid().optional(),
      enrollmentId: z.string().uuid().optional(),
      notes: z.string().max(2000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      piece: await pieces.createPiece(
        req.tenant!.organizationId,
        req.body,
        req.auth?.userId,
      ),
    });
  }),
);

/**
 * Log a whole class's work at once — the realistic capture moment, with a
 * board of wet pots and no appetite for twelve separate forms.
 */
pieceRouter.post(
  '/batch',
  requireMember,
  validateBody(
    z.object({
      sessionId: z.string().uuid(),
      entries: z
        .array(
          z.object({
            customerId: z.string().uuid(),
            label: z.string().min(1).max(120).optional(),
            count: z.number().int().min(1).max(50).optional(),
          }),
        )
        .min(1)
        .max(200),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      await pieces.createPiecesForSession(
        req.tenant!.organizationId,
        req.body.sessionId,
        req.body.entries,
        req.auth?.userId,
      ),
    );
  }),
);

pieceRouter.get(
  '/:pieceId',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({
      piece: await pieces.getPiece(req.tenant!.organizationId, id(req, 'pieceId')),
    });
  }),
);

pieceRouter.patch(
  '/:pieceId',
  requireMember,
  validateBody(
    z.object({
      label: z.string().min(1).max(120).optional(),
      description: z.string().max(2000).optional(),
      shelfLocation: z.string().max(120).optional(),
      notes: z.string().max(2000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json({
      piece: await pieces.updatePiece(
        req.tenant!.organizationId,
        id(req, 'pieceId'),
        req.body,
      ),
    });
  }),
);

/** Moving a piece along. Reaching FINISHED is what texts the customer. */
pieceRouter.post(
  '/:pieceId/status',
  requireMember,
  validateBody(
    z.object({
      status: z.enum(PIECE_STATUS),
      note: z.string().max(500).optional(),
      shelfLocation: z.string().max(120).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json({
      piece: await pieces.updatePieceStatus(
        req.tenant!.organizationId,
        id(req, 'pieceId'),
        req.body.status,
        {
          note: req.body.note,
          shelfLocation: req.body.shelfLocation,
          actorUserId: req.auth?.userId,
        },
      ),
    });
  }),
);

/**
 * Deleting is an owner decision and rare. A piece that went wrong should be
 * marked BROKEN, which keeps the history; deletion is for a row logged against
 * the wrong customer entirely.
 */
pieceRouter.delete(
  '/:pieceId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { prisma } = await import('../../lib/prisma');
    const piece = await prisma.piece.findFirst({
      where: { id: id(req, 'pieceId'), organizationId: req.tenant!.organizationId },
      select: { id: true },
    });
    if (!piece) throw AppError.notFound('Piece not found.');

    await prisma.piece.delete({ where: { id: piece.id } });
    res.status(204).send();
  }),
);
