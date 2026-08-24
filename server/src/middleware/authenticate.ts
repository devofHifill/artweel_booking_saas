import type { NextFunction, Request, Response } from 'express';
import type { MembershipRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/app-error';
import {
  verifyAccessToken,
  verifySupportToken,
} from '../modules/auth/token.service';
import {
  findLiveSupportSession,
  recordSupportTouch,
} from '../modules/platform/support.service';

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
      /** Set only by requirePlatformAdmin. Platform authority, not a studio role. */
      platform?: { adminId: string; userId: string };
      /**
       * Set only by a live support session (S7). Its presence is what lets
       * `withOrganization` accept a grant in place of a membership — and its
       * ABSENCE is what keeps that from being possible any other way.
       */
      support?: {
        sessionId: string;
        organizationId: string;
        readOnly: boolean;
      };
    }
  }
}

/**
 * Reads a support token if the header carries one, and resolves it against the
 * session row.
 *
 * The row lookup is the point. A JWT cannot be revoked, so without this a
 * support session ended by an operator would keep working until it expired.
 * Reading the row on every request makes "ended" mean ended.
 */
async function applySupportGrant(req: Request, raw: string): Promise<boolean> {
  const payload = verifySupportToken(raw);
  if (!payload) return false;

  const session = await findLiveSupportSession(payload.sid);
  if (!session) {
    throw AppError.unauthorized(
      'This support session is no longer active.',
      'SUPPORT_SESSION_ENDED',
    );
  }

  /**
   * The token says one thing, the row says another — trust the row.
   *
   * They can only disagree if a token was minted for a session that was later
   * changed, or if one was forged with a valid signature (which would mean the
   * signing secret is gone and this is the least of it). Either way the row is
   * the record an operator can be held to.
   */
  req.support = {
    sessionId: session.id,
    organizationId: session.organizationId,
    readOnly: session.readOnly,
  };

  /**
   * `req.auth` is the ACTOR, never the studio.
   *
   * This single line is what keeps the audit trail honest: everything
   * downstream that records "who did this" reads `req.auth.userId`, and for a
   * support session that must be the operator at the keyboard rather than the
   * synthetic `support:<orgId>` subject the token carries.
   */
  req.auth = { userId: payload.act.sub, email: payload.act.email };

  return true;
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

    const raw = header.slice(7).trim();

    // Support tokens first: `verifyAccessToken` deliberately refuses them, so
    // trying it the other way round would reject every support request.
    if (await applySupportGrant(req, raw)) {
      next();
      return;
    }

    const payload = verifyAccessToken(raw);
    req.auth = { userId: payload.sub, email: payload.email };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Identifies the caller if they present a valid token, and says nothing if they
 * do not.
 *
 * Exists for the platform routes, where `authenticate`'s 401 would itself be a
 * disclosure. An unauthenticated probe of `/api/platform/*` must be answered
 * exactly like a probe of any path that does not exist — a 401 says "this route
 * is real, bring credentials", which is precisely the fact worth hiding. Pairing
 * this with `requirePlatformAdmin` makes no-token, bad-token, ordinary-user and
 * revoked-admin all produce the same 404.
 *
 * Use it ONLY where the handler behind it treats an absent `req.auth` as a hard
 * failure. On a route that merely behaves differently when signed in, this
 * silently turns a broken token into anonymous access.
 */
export function authenticateOptional(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }

  try {
    const payload = verifyAccessToken(header.slice(7).trim());
    req.auth = { userId: payload.sub, email: payload.email };
  } catch {
    // An invalid token is indistinguishable from no token here, on purpose.
  }

  next();
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

      /**
       * A support grant, accepted in place of a membership — for ONE studio.
       *
       * This is the only exception in the tenant choke point, and it lives here
       * rather than as a bypass flag precisely because this function is what
       * already owns the decision. Three things have to hold, and all three are
       * checked before `req.tenant` is set:
       *
       *   1. the grant names THIS organization — a session into studio A gets
       *      the ordinary 404 for studio B, exactly as a stranger would
       *   2. a read-only grant refuses anything that is not GET or HEAD, at the
       *      same choke point rather than in 144 route definitions
       *   3. the role granted is ADMIN, never OWNER (see below)
       */
      if (req.support) {
        if (req.support.organizationId !== organizationId) {
          // Same answer a non-member gets. A support session must not become a
          // way to confirm which studios exist.
          throw AppError.notFound('Organization not found.', 'NOT_A_MEMBER');
        }

        if (req.support.readOnly && req.method !== 'GET' && req.method !== 'HEAD') {
          throw AppError.forbidden(
            'This is a read-only support session.',
            'SUPPORT_READ_ONLY',
          );
        }

        /**
         * ADMIN, not OWNER — and this is the gradient the whole design exists
         * for.
         *
         * OWNER would let a write-enabled support session change member roles
         * and remove the studio's actual owner, which is the precise failure
         * the "why not a bypass" argument rejects: no distance between looking
         * at a calendar and deleting somebody's account. ADMIN reaches every
         * operational surface a support visit could need while
         * `requireRole('OWNER')` keeps the studio's own ownership out of reach.
         */
        req.tenant = { organizationId, role: 'ADMIN' };

        // Counted, not logged — a row per read would bury the writes. Writes
        // are audited by whatever performs them, as they always were.
        recordSupportTouch(
          req.support.sessionId,
          `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`,
          req.method !== 'GET' && req.method !== 'HEAD',
        );

        next();
        return;
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

/**
 * Anyone with a seat at the studio.
 *
 * The right gate for READS and for the handful of writes both a teacher and a
 * counter genuinely share. It is the WRONG gate for anything that takes money
 * or moves somebody else's day — see the two below.
 */
export const requireMember = requireRole(
  'OWNER',
  'ADMIN',
  'INSTRUCTOR',
  'FRONT_DESK',
);

/**
 * The counter: taking bookings, selling packs, redeeming credits.
 *
 * Until S9 shipped invitations these two roles were indistinguishable in
 * practice, because `register` only ever minted an OWNER and nobody could hold
 * either one. `requireMember` covered all four, so an instructor could cancel
 * any booking in the studio and sell a class pack — which nobody noticed,
 * because no instructor account had ever existed.
 *
 * Splitting them properly is the valuable half of S13. The expensive half —
 * turning every guard into a data-driven permission matrix — is deliberately
 * NOT done: it is a real chance of an authorization hole in exchange for
 * configurability nobody has asked for.
 */
export const requireFrontDesk = requireRole('OWNER', 'ADMIN', 'FRONT_DESK');

/** The floor: the register, attendance, pieces through the kiln. */
export const requireInstructor = requireRole('OWNER', 'ADMIN', 'INSTRUCTOR');

/**
 * An admin, or the staff member this route is about.
 *
 * For the endpoints keyed on `:staffId` where "may they touch this" depends on
 * WHOSE it is. An instructor editing their own availability is ordinary; an
 * instructor editing a colleague's is changing who gets booked for work they
 * do not do, and that was reachable by every member until now.
 *
 * Resolved through `Staff.userId`, which is nullable — a staff record that was
 * never linked to a login belongs to nobody, so nobody passes this as "self".
 */
export function requireAdminOrSelf(param = 'staffId') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.tenant) {
        throw new AppError(
          'Organization context missing — withOrganization must run first.',
          500,
        );
      }

      if (req.tenant.role === 'OWNER' || req.tenant.role === 'ADMIN') {
        next();
        return;
      }

      const staffId = req.params[param];
      if (!staffId) throw AppError.badRequest(`Missing ${param} in path.`);

      const staff = await prisma.staff.findFirst({
        where: { id: staffId, organizationId: req.tenant.organizationId },
        select: { userId: true },
      });

      /*
        404, not 403, when the staff member is not this studio's — same
        reasoning as `withOrganization`. A 403 would confirm the id exists
        somewhere.
      */
      if (!staff) throw AppError.notFound('Staff member not found.');

      if (!staff.userId || staff.userId !== req.auth?.userId) {
        throw AppError.forbidden(
          'You can only change your own schedule.',
          'NOT_YOUR_SCHEDULE',
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
