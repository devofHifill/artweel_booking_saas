import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';
import { grantPlatformAdmin } from '../../src/modules/platform/platform.service';
import { withAudit, listAuditLog } from '../../src/modules/platform/audit.service';

/**
 * S2 — the platform audit log.
 *
 * The interesting cases are not "does it write a row". They are the two ways a
 * log can be *confidently wrong*: claiming something happened when it was rolled
 * back, and staying silent about something that did happen. Both are worse than
 * no log, because a log is read exactly when nobody can remember the truth
 * independently.
 */

const app = createApp();

let admin: Studio;
let adminEmail: string;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  admin = await signUpStudio(app, { organizationName: 'Clay & Co' });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: admin.userId },
    select: { email: true },
  });
  adminEmail = user.email;
  await grantPlatformAdmin({ email: adminEmail });
});

/** The actor fields a real request would supply via `auditContext`. */
function actor() {
  return {
    actorUserId: admin.userId,
    actorEmail: adminEmail,
    ip: '198.51.100.7',
    userAgent: 'vitest',
  };
}

describe('recording an action', () => {
  it('writes the actor, target, reason and metadata', async () => {
    await withAudit(
      {
        ...actor(),
        action: 'organization.rename',
        targetType: 'organization',
      },
      async (tx, audit) => {
        const before = await tx.organization.findUniqueOrThrow({
          where: { id: admin.organizationId },
          select: { name: true },
        });

        const after = await tx.organization.update({
          where: { id: admin.organizationId },
          data: { name: 'Clay & Company' },
          select: { name: true },
        });

        audit({
          targetId: admin.organizationId,
          organizationId: admin.organizationId,
          reason: 'owner asked, ticket #42',
          metadata: { before: before.name, after: after.name },
        });

        return after;
      },
    );

    const [entry] = await listAuditLog();

    expect(entry).toMatchObject({
      actorUserId: admin.userId,
      actorEmail: adminEmail,
      action: 'organization.rename',
      targetType: 'organization',
      targetId: admin.organizationId,
      organizationId: admin.organizationId,
      reason: 'owner asked, ticket #42',
      ip: '198.51.100.7',
      userAgent: 'vitest',
    });
    expect(entry!.metadata).toEqual({
      before: 'Clay & Co',
      after: 'Clay & Company',
    });
  });

  it('returns the work\'s own result to the caller', async () => {
    const result = await withAudit(
      { ...actor(), action: 'noop.check', targetType: 'organization' },
      async () => 'the-value',
    );

    expect(result).toBe('the-value');
  });
});

describe('the log cannot disagree with what happened', () => {
  /**
   * Direction one: the action fails. There must be no row claiming it happened.
   */
  it('records nothing when the action throws', async () => {
    await expect(
      withAudit(
        { ...actor(), action: 'organization.rename', targetType: 'organization' },
        async (tx, audit) => {
          await tx.organization.update({
            where: { id: admin.organizationId },
            data: { name: 'Half Done' },
          });

          audit({ organizationId: admin.organizationId });
          throw new Error('the action failed after writing');
        },
      ),
    ).rejects.toThrow('the action failed after writing');

    expect(await listAuditLog()).toHaveLength(0);

    // And the write it had already made is gone too.
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: admin.organizationId },
      select: { name: true },
    });
    expect(org.name).toBe('Clay & Co');
  });

  /**
   * Direction two, and the one that is usually left untested: the AUDIT fails.
   * The action must roll back rather than succeed unrecorded.
   *
   * Forced with an empty `action`, which the table's CHECK constraint rejects.
   * That constraint exists partly to make this case reachable — without it this
   * guarantee could only be verified by reading the code.
   */
  it('rolls the action back when the audit row cannot be written', async () => {
    await expect(
      withAudit(
        { ...actor(), action: '', targetType: 'organization' },
        async (tx) => {
          await tx.organization.update({
            where: { id: admin.organizationId },
            data: { name: 'Should Not Persist' },
          });
          return 'done';
        },
      ),
    ).rejects.toThrow();

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: admin.organizationId },
      select: { name: true },
    });
    expect(
      org.name,
      'the action succeeded but went unrecorded — the two must stand or fall together',
    ).toBe('Clay & Co');

    expect(await listAuditLog()).toHaveLength(0);
  });
});

describe('the record outlives what it refers to', () => {
  /**
   * The whole reason there are no foreign keys. A FK with SET NULL would keep
   * the row and erase the actor; CASCADE would delete the evidence with the
   * account. S11 makes deleting a studio a real future event, and "who did this"
   * has to survive it — that is when the question gets asked.
   */
  it('keeps the actor and the studio id after both rows are deleted', async () => {
    const victim = await signUpStudio(app, { organizationName: 'Gone Pottery' });
    const victimOrgId = victim.organizationId;

    await withAudit(
      { ...actor(), action: 'organization.suspend', targetType: 'organization' },
      async (tx, audit) => {
        audit({ organizationId: victimOrgId, targetId: victimOrgId });
        return tx.organization.update({
          where: { id: victimOrgId },
          data: { subscriptionStatus: 'SUSPENDED' },
        });
      },
    );

    await prisma.organization.delete({ where: { id: victimOrgId } });
    await prisma.user.delete({ where: { id: admin.userId } });

    const [entry] = await listAuditLog();
    expect(entry?.actorUserId).toBe(admin.userId);
    expect(entry?.actorEmail).toBe(adminEmail);
    expect(entry?.organizationId).toBe(victimOrgId);
  });
});

describe('reading the log over HTTP', () => {
  async function record(action: string, organizationId?: string) {
    await withAudit(
      { ...actor(), action, targetType: 'organization' },
      async (_tx, audit) => {
        audit({ organizationId: organizationId ?? null });
      },
    );
  }

  it('returns entries newest first', async () => {
    await record('first.action');
    await record('second.action');
    await record('third.action');

    const res = await request(app).get('/api/platform/audit').set(admin.headers);

    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: { action: string }) => e.action)).toEqual([
      'third.action',
      'second.action',
      'first.action',
    ]);
  });

  it('filters by studio', async () => {
    const other = await signUpStudio(app, { organizationName: 'Kiln House' });

    await record('mine.action', admin.organizationId);
    await record('theirs.action', other.organizationId);

    const res = await request(app)
      .get('/api/platform/audit')
      .query({ organizationId: other.organizationId })
      .set(admin.headers);

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].action).toBe('theirs.action');
  });

  it('rejects a malformed filter with a validation error, not a 500', async () => {
    const res = await request(app)
      .get('/api/platform/audit')
      .query({ organizationId: 'not-a-uuid' })
      .set(admin.headers);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('is invisible to an ordinary studio owner', async () => {
    const outsider = await signUpStudio(app);
    await record('secret.action');

    const res = await request(app)
      .get('/api/platform/audit')
      .set(outsider.headers);

    expect(res.status).toBe(404);
  });

  /**
   * There is no write, edit or delete route for the log, and there should never
   * be one — an entry an operator can author is not a record of their actions.
   */
  it('exposes no way to create or delete an entry', async () => {
    await record('real.action');

    const posted = await request(app)
      .post('/api/platform/audit')
      .set(admin.headers)
      .send({ action: 'invented.action', targetType: 'organization' });

    const deleted = await request(app)
      .delete('/api/platform/audit')
      .set(admin.headers);

    expect(posted.status).toBe(404);
    expect(deleted.status).toBe(404);
    expect(await listAuditLog()).toHaveLength(1);
  });
});
