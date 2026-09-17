import type { NextFunction, Request, Response } from 'express';
import { notFound } from './not-found';
import { findLiveGrant } from '../modules/platform/platform.service';

/**
 * The platform gate. Runs after `authenticate`.
 *
 * Three deliberate choices:
 *
 * 1. **Checked against the database on every request, never read from the
 *    token.** The access token already omits the organization for a reason;
 *    platform status is the same argument with a much larger blast radius. A
 *    claim baked into a JWT cannot be revoked before it expires, so a stolen
 *    token would carry cross-tenant authority for its full lifetime and a
 *    revocation would do nothing. Platform requests are rare, so a lookup per
 *    request costs nothing worth having.
 *
 * 2. **404, not 403**, and produced by DELEGATING to the app's own `notFound`
 *    rather than by throwing a 404 of our own. Copied from `withOrganization`
 *    in spirit — a 403 confirms the platform surface exists and is worth
 *    attacking — but a hand-rolled 404 is not enough on its own. The real
 *    handler's body reads `Route not found: GET /api/platform/me`, while
 *    `AppError.notFound('Not Found')` produces `Not Found`, and that difference
 *    is a perfectly good oracle: same status, different body, surface located.
 *    Calling the same producer means the two cannot drift apart later either.
 *
 * 3. **Revoked grants do not count**, which is `findLiveGrant`'s whole job.
 */
export async function requirePlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    // No token, a bad token, an ordinary studio owner and a revoked admin all
    // arrive here and all leave the same way.
    if (!req.auth) {
      notFound(req, res, next);
      return;
    }

    const grant = await findLiveGrant(req.auth.userId);
    if (!grant) {
      notFound(req, res, next);
      return;
    }

    req.platform = { adminId: grant.id, userId: req.auth.userId };
    next();
  } catch (err) {
    next(err);
  }
}
