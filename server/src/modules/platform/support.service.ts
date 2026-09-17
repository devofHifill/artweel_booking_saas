import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/app-error';
import { signSupportToken } from '../auth/token.service';
import { withAudit, type AuditEntry } from './audit.service';

/**
 * Support sessions — a platform operator looking inside one studio.
 *
 * The design argument, restated because it is the whole reason this module is
 * shaped the way it is: the obvious implementation is four lines in
 * `withOrganization` — `if (isPlatformAdmin) allow`. That instantly makes all
 * 144 route definitions live, including refunds, cancellations and member
 * removal, with no gradient between "look at their calendar" and "delete their
 * owner", and nothing in the logs telling a support visit apart from ordinary
 * studio traffic.
 *
 * So instead: a bounded grant, recorded as a row, that the existing choke point
 * accepts in place of a membership. No module is edited to accommodate it.
 */

/**
 * Thirty minutes.
 *
 * Long enough to actually diagnose something, short enough that a token left in
 * a terminal's scrollback is worthless by the time anyone finds it. There is no
 * extend: you start another session, which is another row and another reason,
 * and the second reason is exactly the thing an audit reader wants to see.
 */
export const SUPPORT_SESSION_TTL_MINUTES = 30;

/** Distinct endpoints kept per session. Enough to answer "what did they look
 *  at" without turning the row into a session replay. */
const MAX_TRACKED_ENDPOINTS = 40;

export type LiveSupportSession = {
  id: string;
  organizationId: string;
  actorUserId: string;
  actorEmail: string;
  reason: string;
  readOnly: boolean;
  expiresAt: Date;
};

/**
 * Resolves a session id to a session that is still good.
 *
 * Called on EVERY request carrying a support token, which is what makes the
 * grant revocable — a JWT cannot be withdrawn, but a row can, and ending a
 * session takes effect on the operator's next request rather than at expiry.
 */
export async function findLiveSupportSession(
  sessionId: string,
): Promise<LiveSupportSession | null> {
  const session = await prisma.supportSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      organizationId: true,
      actorUserId: true,
      actorEmail: true,
      reason: true,
      readOnly: true,
      expiresAt: true,
      endedAt: true,
    },
  });

  if (!session) return null;
  if (session.endedAt) return null;
  if (session.expiresAt <= new Date()) return null;

  return session;
}

/**
 * Records that a support session touched an endpoint.
 *
 * READS ARE COUNTED, NOT LOGGED. One audit row per read would bury the writes —
 * browsing a calendar is dozens of GETs around perhaps one change, and the log
 * exists to surface the change. Writes still get their own audit rows, from
 * whatever performs them.
 *
 * Fire-and-forget, and deliberately so: this is bookkeeping about a request,
 * not part of it. A failed counter update must never turn a working support
 * session into a 500 — the session row, its reason and its expiry are the parts
 * that carry the accountability, and none of them depend on this.
 *
 * One statement rather than read-modify-write, because two operators on the
 * same session (or one with two tabs) would otherwise lose increments to a
 * lost update.
 */
export function recordSupportTouch(
  sessionId: string,
  endpoint: string,
  isWrite: boolean,
): void {
  const trimmed = endpoint.slice(0, 200);

  void prisma
    .$executeRaw`
      UPDATE support_sessions
      SET read_count  = read_count  + ${isWrite ? 0 : 1},
          write_count = write_count + ${isWrite ? 1 : 0},
          endpoints = CASE
            WHEN endpoints IS NULL THEN to_jsonb(ARRAY[${trimmed}])
            WHEN endpoints @> to_jsonb(ARRAY[${trimmed}]) THEN endpoints
            WHEN jsonb_array_length(endpoints) >= ${MAX_TRACKED_ENDPOINTS} THEN endpoints
            ELSE endpoints || to_jsonb(ARRAY[${trimmed}])
          END,
          updated_at = now()
      WHERE id = ${sessionId}::uuid
    `
    .catch((err) => {
      logger.debug({ err, sessionId }, 'Support session touch not recorded');
    });
}

/**
 * Opens a session and mints its token.
 *
 * Audited as a write in its own right — the session row records what happened
 * inside it, and this row records that it was opened at all. Both matter: a
 * session with zero writes is still somebody having looked at a studio's
 * customer list, and that is the kind of thing an owner is entitled to ask
 * about.
 */
export async function startSupportSession(
  context: Pick<AuditEntry, 'actorUserId' | 'actorEmail' | 'ip' | 'userAgent'>,
  organizationId: string,
  input: { reason: string; readOnly: boolean },
) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true },
  });

  // 404 rather than 400, matching every other platform route: the caller is
  // already gated, but the shape of the answer stays uniform.
  if (!organization) {
    throw AppError.notFound('Studio not found.', 'STUDIO_NOT_FOUND');
  }

  const expiresAt = new Date(
    Date.now() + SUPPORT_SESSION_TTL_MINUTES * 60_000,
  );

  const session = await withAudit(
    {
      ...context,
      action: 'support.session.start',
      targetType: 'organization',
    },
    async (tx, audit) => {
      const created = await tx.supportSession.create({
        data: {
          organizationId,
          actorUserId: context.actorUserId,
          actorEmail: context.actorEmail,
          reason: input.reason,
          readOnly: input.readOnly,
          expiresAt,
        },
      });

      audit({
        organizationId,
        targetId: created.id,
        reason: input.reason,
        metadata: {
          readOnly: input.readOnly,
          expiresAt: expiresAt.toISOString(),
          studio: organization.name,
        },
      });

      return created;
    },
  );

  const { token } = signSupportToken({
    sessionId: session.id,
    organizationId,
    readOnly: input.readOnly,
    actor: { id: context.actorUserId, email: context.actorEmail },
    ttlMinutes: SUPPORT_SESSION_TTL_MINUTES,
  });

  return {
    session: projectSession(session),
    studio: organization,
    /**
     * Returned ONCE and never stored in a readable form anywhere. Listing
     * sessions later gives you the row, not the token — a support grant you
     * can re-fetch is a support grant that never really ended.
     */
    accessToken: token,
    expiresAt,
  };
}

/** Ends a session now, rather than waiting for its expiry. */
export async function endSupportSession(
  context: Pick<AuditEntry, 'actorUserId' | 'actorEmail' | 'ip' | 'userAgent'>,
  sessionId: string,
) {
  const existing = await prisma.supportSession.findUnique({
    where: { id: sessionId },
    select: { id: true, organizationId: true, endedAt: true },
  });

  if (!existing) {
    throw AppError.notFound('Support session not found.', 'SESSION_NOT_FOUND');
  }

  // Idempotent. Ending an already-ended session is not an error, and a second
  // audit row saying "ended" twice is noise in the log.
  if (existing.endedAt) {
    return { ended: true, alreadyEnded: true };
  }

  await withAudit(
    { ...context, action: 'support.session.end', targetType: 'organization' },
    async (tx, audit) => {
      const updated = await tx.supportSession.update({
        where: { id: sessionId },
        data: { endedAt: new Date() },
      });

      audit({
        organizationId: existing.organizationId,
        targetId: sessionId,
        metadata: {
          readCount: updated.readCount,
          writeCount: updated.writeCount,
          endpoints: updated.endpoints ?? [],
        },
      });

      return updated;
    },
  );

  return { ended: true, alreadyEnded: false };
}

function projectSession(session: {
  id: string;
  organizationId: string;
  actorUserId: string;
  actorEmail: string;
  reason: string;
  readOnly: boolean;
  expiresAt: Date;
  endedAt: Date | null;
  readCount: number;
  writeCount: number;
  endpoints: Prisma.JsonValue;
  createdAt: Date;
}) {
  return {
    id: session.id,
    organizationId: session.organizationId,
    actorUserId: session.actorUserId,
    actorEmail: session.actorEmail,
    reason: session.reason,
    readOnly: session.readOnly,
    expiresAt: session.expiresAt,
    endedAt: session.endedAt,
    readCount: session.readCount,
    writeCount: session.writeCount,
    endpoints: (session.endpoints as string[] | null) ?? [],
    createdAt: session.createdAt,
    active: session.endedAt === null && session.expiresAt > new Date(),
  };
}

/** Sessions for one studio, newest first — the audit surface for a support visit. */
export async function listSupportSessions(opts: {
  organizationId?: string;
  activeOnly?: boolean;
  limit?: number;
}) {
  const now = new Date();

  const sessions = await prisma.supportSession.findMany({
    where: {
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      ...(opts.activeOnly
        ? { endedAt: null, expiresAt: { gt: now } }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
  });

  return sessions.map(projectSession);
}

/**
 * What the studio's own dashboard shows in its banner.
 *
 * Deliberately readable by the STUDIO, not only by the platform: somebody
 * looking through a studio's bookings is something that studio is entitled to
 * see while it is happening, not afterwards in a log they have no access to.
 * The reason text is included for the same reason — a banner that says
 * "somebody is here" and will not say why is worse than none.
 */
export async function activeSessionsForStudio(organizationId: string) {
  const sessions = await prisma.supportSession.findMany({
    where: { organizationId, endedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      actorEmail: true,
      reason: true,
      readOnly: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return sessions;
}
