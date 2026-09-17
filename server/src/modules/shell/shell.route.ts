import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateQuery } from '../../middleware/validate';
import { requireMember } from '../../middleware/authenticate';
import * as service from './shell.service';

/**
 * The app chrome: badge counts, alerts, and global search.
 *
 * `requireMember` rather than `requireAdmin` throughout. Everything here is a
 * read, and an instructor who cannot see today's count or find a customer by
 * name is an instructor who cannot do their job — the sensitive settings are
 * behind their own routes.
 */
export const shellRouter = Router({ mergeParams: true });

shellRouter.get(
  '/summary',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(await service.getSummary(req.tenant!.organizationId));
  }),
);

shellRouter.get(
  '/search',
  requireMember,
  validateQuery(
    z.object({
      /*
        Capped, and not because of the database. This string is typed by a human
        into a box; anything past a sentence is a paste accident or somebody
        probing, and neither deserves a query across three tables.
      */
      q: z.string().max(120).default(''),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(
      await service.search(
        req.tenant!.organizationId,
        (req.query as unknown as { q: string }).q,
      ),
    );
  }),
);
