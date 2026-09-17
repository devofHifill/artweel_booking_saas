import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../lib/prisma';

/**
 * The platform audit log.
 *
 * ONE RULE, and everything here exists to enforce it: the audit row is written
 * inside the same transaction as the action it describes.
 *
 * Written outside, the two can diverge in both directions. An action that rolled
 * back leaves a log entry claiming it happened; an action that succeeded leaves
 * no trace because the log insert failed. Both are worse than having no log at
 * all, because both are *confidently wrong* — and a log is consulted precisely
 * when nobody can remember what actually occurred, so there is nothing left to
 * check it against.
 *
 * `withAudit` is therefore the only intended entry point. It opens the
 * transaction, hands the caller the transaction client, and writes the row
 * before committing — so an audited action cannot half-happen, and there is no
 * shorter path that skips the log.
 */

export type AuditEntry = {
  actorUserId: string;
  actorEmail: string;
  /** Dotted, e.g. `organization.suspend`. Never empty — the DB rejects that. */
  action: string;
  targetType: string;
  targetId?: string | null;
  organizationId?: string | null;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  ip?: string | null;
  userAgent?: string | null;
};

/** Fields a caller may fill in once it knows them — typically before/after. */
export type AuditPatch = Partial<
  Pick<AuditEntry, 'targetId' | 'organizationId' | 'reason' | 'metadata'>
>;

/**
 * Pulls the actor and request context off a gated request.
 *
 * Safe to call only behind `requirePlatformAdmin`, which is what guarantees
 * `req.platform` and `req.auth` are both set.
 */
export function auditContext(
  req: Request,
): Pick<AuditEntry, 'actorUserId' | 'actorEmail' | 'ip' | 'userAgent'> {
  return {
    actorUserId: req.platform!.userId,
    actorEmail: req.auth!.email,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
  };
}

/**
 * Runs `work` and records it, atomically.
 *
 * The `audit` callback lets the work enrich the entry once it has read the
 * "before" state or created the row it is about to reference — which is the
 * common case, and the reason the entry is not simply passed in complete.
 *
 * ```ts
 * await withAudit(
 *   { ...auditContext(req), action: 'organization.suspend', targetType: 'organization' },
 *   async (tx, audit) => {
 *     const before = await tx.organization.findUniqueOrThrow({ where: { id } });
 *     const after = await tx.organization.update({ ... });
 *     audit({ organizationId: id, metadata: { before: before.status, after: after.status } });
 *     return after;
 *   },
 * );
 * ```
 */
export async function withAudit<T>(
  entry: AuditEntry,
  work: (tx: Prisma.TransactionClient, audit: (patch: AuditPatch) => void) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const pending: AuditEntry = { ...entry };

    const result = await work(tx, (patch) => {
      Object.assign(pending, patch);
    });

    // After the work, so it can describe what actually happened — and inside the
    // transaction, so a failure here undoes the action rather than leaving it
    // unrecorded.
    await recordPlatformAction(tx, pending);

    return result;
  });
}

/**
 * Writes one audit row on the given transaction client.
 *
 * `tx` is first and has no default. Defaulting it to the global client would
 * make the unsafe call the shortest one to write, and the failure mode is
 * invisible in review — the row appears, the tests pass, and the guarantee is
 * quietly gone. Prefer `withAudit`; reach for this directly only when the
 * surrounding transaction is already open for other reasons.
 */
export async function recordPlatformAction(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
) {
  return tx.platformAuditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      actorEmail: entry.actorEmail,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      organizationId: entry.organizationId ?? null,
      reason: entry.reason ?? null,
      metadata: entry.metadata ?? undefined,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}

export type AuditQuery = {
  organizationId?: string;
  actorUserId?: string;
  action?: string;
  limit?: number;
};

/**
 * Reads the log, newest first.
 *
 * There is no update and no delete path anywhere in the codebase, and none
 * should be added. Immutability is convention here rather than enforcement:
 * making it real means revoking UPDATE and DELETE on the table from the
 * application's database role, which needs a separate migration role to do and
 * is noted in the plan rather than done.
 */
export async function listAuditLog(query: AuditQuery = {}) {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);

  return prisma.platformAuditLog.findMany({
    where: {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.action ? { action: query.action } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
