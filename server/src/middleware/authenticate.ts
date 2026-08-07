import type { NextFunction, Request, Response } from 'express';
import type { MembershipRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/app-error';
import { verifyAccessToken } from '../modules/auth/token.service';

/**
 * Auth and tenancy are two separate questions, answered by two separate
 * middlewares:
 *
 *   authenticate     WHO is this?           -> req.auth
 *   withOrganization WHAT may they touch?   -> req.tenant
 *
 * Keeping them apart is what makes multi-organization membership work. A
 * freelance instructor genuinely teaches at three studios; identity is global,
 * authority is per-studio, and baking an organization id into the access
 * token would force a re-login to switch between them.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string; email: string };
      tenant?: { organizationId: string; role: MembershipRole };
    }
  }
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw AppError.unauthorized(
        'Authentication required.',
        'NO_CREDENTIALS',
      );
    }

    const payload = verifyAccessToken(header.slice(7).trim());
    req.auth = { userId: payload.sub, email: payload.email };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Resolves the caller's membership of the organization named in the route.
 *
 * This is the single choke point for tenant isolation on the HTTP surface.
 * A 404 rather than a 403 for a non-member is deliberate: 403 confirms the
 * organization exists, which lets an outsider enumerate studios.
 */
export function withOrganization(param = 'organizationId') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.auth) {
        throw AppError.unauthorized('Authentication required.');
      }

      const organizationId = req.params[param];
      if (!organizationId) {
        throw AppError.badRequest(`Missing ${param} in path.`);
      }

      const membership = await prisma.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: req.auth.userId,
          },
        },
      });

      if (!membership) {
        throw AppError.notFound('Organization not found.', 'NOT_A_MEMBER');
      }

      req.tenant = { organizationId, role: membership.role };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Role gate. Must run after withOrganization — roles are per-organization,
 * so asking "is this user an admin?" without naming a studio is meaningless.
 */
export function requireRole(...roles: MembershipRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.tenant) {
      next(
        new AppError(
          'Organization context missing — withOrganization must run first.',
          500,
        ),
      );
      return;
    }

    if (!roles.includes(req.tenant.role)) {
      next(
        AppError.forbidden(
          'You do not have permission to do that.',
          'INSUFFICIENT_ROLE',
        ),
      );
      return;
    }

    next();
  };
}

/** Owners and admins — the roles that may change how the studio operates. */
export const requireAdmin = requireRole('OWNER', 'ADMIN');

/** Anyone with a seat at the studio, including front desk and instructors. */
export const requireMember = requireRole(
  'OWNER',
  'ADMIN',
  'INSTRUCTOR',
  'FRONT_DESK',
);
