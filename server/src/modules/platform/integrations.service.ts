import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { getIntegrationStatus } from '../integrations/integration.service';
import { withAudit, type AuditEntry } from './audit.service';

/**
 * S10 — what a studio is plugged into, from the operator's side.
 *
 * The READ is the studio's own `getIntegrationStatus`, not a second query.
 * Two implementations of "is their Stripe connected" drift the first time one
 * of them learns about a new state, and the drift shows up as an operator and
 * an owner reading the same studio differently while on the phone to each
 * other — the exact moment they most need to agree.
 *
 * The WRITE is one action, and it exists for one sentence support says
 * constantly: "their calendar sync is wedged, disconnect it and let them
 * re-auth."
 */

export async function getStudioIntegrations(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true },
  });

  // 404 rather than 400, matching every other platform route.
  if (!organization) {
    throw AppError.notFound('Studio not found.', 'STUDIO_NOT_FOUND');
  }

  return {
    studio: organization,
    ...(await getIntegrationStatus(organizationId)),
  };
}

/**
 * Disconnects one instructor's calendar, on their behalf.
 *
 * Delegates to `calendar.disconnect` rather than deleting the row, and that
 * matters more than it looks: disconnecting also stops the Google watch
 * channel and deletes the mirrored busy blocks. Skipping the second would
 * leave the instructor permanently unavailable for times their calendar no
 * longer claims, with nothing left to ever clear them — a studio would see it
 * as "support broke my availability" and be right.
 *
 * Audited as a write. A support session that ends with somebody's calendar
 * disconnected is exactly the kind of thing the studio may ask about later.
 */
export async function disconnectStudioCalendar(
  context: Pick<AuditEntry, 'actorUserId' | 'actorEmail' | 'ip' | 'userAgent'>,
  organizationId: string,
  staffId: string,
  reason: string,
) {
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, organizationId },
    select: {
      id: true,
      name: true,
      calendarConnection: { select: { accountEmail: true, status: true } },
    },
  });

  if (!staff) throw AppError.notFound('Instructor not found.', 'STAFF_NOT_FOUND');

  if (!staff.calendarConnection) {
    // Idempotent. Nothing to disconnect is not a failure, and an audit row
    // saying a calendar was disconnected when none existed would be a lie.
    return { disconnected: false, alreadyDisconnected: true };
  }

  const before = staff.calendarConnection;

  await withAudit(
    {
      ...context,
      action: 'integration.calendar.disconnect',
      targetType: 'staff',
      targetId: staffId,
      organizationId,
      reason,
    },
    async (_tx, audit) => {
      /*
        Deliberately NOT on the transaction client. `disconnect` talks to
        Google to stop the watch channel, and holding a database transaction
        open across a network call to a third party is how a slow provider
        becomes a lock nobody can explain.

        What is given up: the disconnect and its audit row are not one atomic
        unit. The failure mode is an audit row for a disconnect that threw,
        which the metadata makes visible rather than silent — and the reverse
        ordering, disconnecting and then failing to log it, is the one that
        actually loses information.
      */
      const { disconnect } = await import('../calendar/calendar.service');
      const result = await disconnect(organizationId, staffId);

      audit({
        metadata: {
          staffName: staff.name,
          accountEmail: before.accountEmail,
          statusBefore: before.status,
        },
      });

      return result;
    },
  );

  return { disconnected: true, alreadyDisconnected: false };
}
