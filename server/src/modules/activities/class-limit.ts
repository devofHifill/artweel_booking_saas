import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * How many Classes a studio is running right now, for the plan's
 * `maxClasses` (Solo: 1).
 *
 * A Class counts from publishing until its last session ends — the same
 * moment it moves to Past — so finishing a term frees the place for the next.
 * One the studio has switched off, or whose course was cancelled, does not
 * count: it is not running.
 */
export async function countRunningClasses(organizationId: string, db: Db = prisma) {
  return db.serviceType.count({
    where: {
      organizationId,
      kind: 'CLASS',
      isActive: true,
      courseSeries: { some: { status: { not: 'CANCELLED' } } },
      sessions: { some: { status: { not: 'CANCELLED' }, endsAt: { gt: new Date() } } },
    },
  });
}
