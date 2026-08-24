import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import {
  addMemberToStudio,
  signUpStudio,
  TEST_PASSWORD,
  type Studio,
} from '../helpers/api';
import { grantPlatformAdmin } from '../../src/modules/platform/platform.service';

/**
 * S9 — invitations, and the roles they unblock.
 *
 * Before this, `register` was the only path that created a membership and it
 * only ever minted an OWNER. `ADMIN`, `INSTRUCTOR` and `FRONT_DESK` were
 * enforced by `requireRole` across 144 route definitions and grantable by
 * nothing — so the assertions that matter most here are the ones proving an
 * invited person actually lands with a working, correctly-limited account.
 */

const app = createApp();
let studio: Studio;

const NEWCOMER = 'sam@newcomer.test';

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
});

function invite(
  body: Partial<{ email: string; name: string; role: string }> = {},
  headers = studio.headers,
) {
  return request(app)
    .post(`${studio.base}/invitations`)
    .set(headers)
    .send({
      email: body.email ?? NEWCOMER,
      name: body.name ?? 'Sam Rivers',
      role: body.role ?? 'INSTRUCTOR',
    });
}

/** The raw token out of the invite URL the API hands back. */
const tokenFrom = (inviteUrl: string) =>
  decodeURIComponent(inviteUrl.split('/invite/')[1]!);

describe('sending an invitation', () => {
  it('creates it and returns a usable link', async () => {
    const res = await invite().expect(201);

    expect(res.body.invitation.status).toBe('PENDING');
    expect(res.body.invitation.role).toBe('INSTRUCTOR');
    expect(res.body.inviteUrl).toContain('/invite/');

    // The token is stored hashed — the raw value exists only in the email and
    // in this one response.
    const row = await prisma.invitation.findFirstOrThrow({
      where: { organizationId: studio.organizationId },
    });
    expect(row.tokenHash).not.toContain(tokenFrom(res.body.inviteUrl));
  });

  it('queues the email through the outbox', async () => {
    await invite().expect(201);

    const queued = await prisma.notification.findFirstOrThrow({
      where: { templateKey: 'team.invitation' },
    });
    expect(queued.destination).toBe(NEWCOMER);
    expect(queued.status).toBe('PENDING');

    const payload = queued.payload as { subject: string; body: string };
    expect(payload.subject).toContain('Clay & Co');
    expect(payload.body).toContain('/invite/');
  });

  /**
   * Ownership is transferred between people who already have accounts, never
   * handed to somebody who has not clicked a link yet — otherwise there would
   * be a second path to OWNER that skips the last-owner guard entirely.
   */
  it('cannot invite anybody to be an owner', async () => {
    await invite({ role: 'OWNER' }).expect(422);
  });

  it('refuses a second open invitation to the same address', async () => {
    await invite().expect(201);

    const second = await invite();
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('INVITATION_EXISTS');
  });

  /** Everything else here treats an address case-insensitively; so does this. */
  it('treats a differently-cased address as the same person', async () => {
    await invite({ email: 'Sam@Newcomer.test' }).expect(201);

    const second = await invite({ email: 'sam@newcomer.test' });
    expect(second.status).toBe(409);
  });

  it('refuses somebody who is already on the team', async () => {
    const existing = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );
    const email = (
      await prisma.user.findUniqueOrThrow({
        where: { id: existing.userId },
        select: { email: true },
      })
    ).email;

    const res = await invite({ email });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_A_MEMBER');
  });

  it('is refused to an instructor', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    await invite({}, instructor.headers).expect(403);
  });

  it('lets an admin invite, not only an owner', async () => {
    const admin = await addMemberToStudio(app, studio.organizationId, 'ADMIN');

    await invite({}, admin.headers).expect(201);
  });
});

describe('accepting as somebody new', () => {
  it('creates the account, the membership, and signs them in', async () => {
    const sent = await invite().expect(201);
    const token = tokenFrom(sent.body.inviteUrl);

    const preview = await request(app)
      .get(`/api/auth/invitations/${token}`)
      .expect(200);

    expect(preview.body.studio).toBe('Clay & Co');
    expect(preview.body.role).toBe('INSTRUCTOR');
    expect(preview.body.needsPassword).toBe(true);
    expect(preview.body.status).toBe('PENDING');

    const accepted = await request(app)
      .post(`/api/auth/invitations/${token}/accept`)
      .send({ password: TEST_PASSWORD })
      .expect(201);

    expect(accepted.body.role).toBe('INSTRUCTOR');
    expect(accepted.body.tokens.accessToken).toBeTruthy();

    // The membership exists at the invited role — the whole point of S9.
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: studio.organizationId, userId: accepted.body.user.id },
    });
    expect(membership.role).toBe('INSTRUCTOR');
  });

  /**
   * Receiving the link IS proof of control of the address — it was sent there
   * and nowhere else. Making them verify an address they have just
   * demonstrated they can read is a step that teaches them the product wastes
   * their time.
   */
  it('marks the address verified without a second round trip', async () => {
    const sent = await invite().expect(201);

    const accepted = await request(app)
      .post(`/api/auth/invitations/${tokenFrom(sent.body.inviteUrl)}/accept`)
      .send({ password: TEST_PASSWORD })
      .expect(201);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: accepted.body.user.id },
      select: { emailVerifiedAt: true },
    });
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it('needs a password when there is no account yet', async () => {
    const sent = await invite().expect(201);

    const res = await request(app)
      .post(`/api/auth/invitations/${tokenFrom(sent.body.inviteUrl)}/accept`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PASSWORD_REQUIRED');
  });

  /**
   * The role model becomes real here: an invited instructor must be limited by
   * the same `requireRole` gates a founder-created one would be. Without this
   * assertion the invite flow could hand out memberships that are nominally
   * INSTRUCTOR and behave like OWNER.
   */
  it('lands with a role that is actually enforced', async () => {
    const sent = await invite({ role: 'INSTRUCTOR' }).expect(201);

    const accepted = await request(app)
      .post(`/api/auth/invitations/${tokenFrom(sent.body.inviteUrl)}/accept`)
      .send({ password: TEST_PASSWORD })
      .expect(201);

    const headers = { Authorization: `Bearer ${accepted.body.tokens.accessToken}` };

    // An instructor may take a register.
    await request(app)
      .get(`${studio.base}/manifest?date=2026-09-19`)
      .set(headers)
      .expect(200);

    // And may not restyle the studio or invite anybody.
    await request(app)
      .patch(`${studio.base}/theme`)
      .set(headers)
      .send({ preset: 'indigo' })
      .expect(403);

    await invite({ email: 'someone@else.test' }, headers).expect(403);
  });
});

describe('accepting when you already have an account', () => {
  /**
   * A freelance instructor genuinely teaches at three studios. Identity is
   * global and authority is per-studio, so this must add a membership and
   * leave everything else about their account alone.
   */
  it('adds the membership without touching the existing password', async () => {
    const other = await signUpStudio(app, { organizationName: 'Kiln House' });
    const email = (
      await prisma.user.findUniqueOrThrow({
        where: { id: other.userId },
        select: { email: true },
      })
    ).email;

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: other.userId },
      select: { passwordHash: true },
    });

    const sent = await invite({ email, name: 'Freelancer' }).expect(201);

    const preview = await request(app)
      .get(`/api/auth/invitations/${tokenFrom(sent.body.inviteUrl)}`)
      .expect(200);
    expect(preview.body.needsPassword).toBe(false);

    await request(app)
      .post(`/api/auth/invitations/${tokenFrom(sent.body.inviteUrl)}/accept`)
      .send({})
      .expect(201);

    const memberships = await prisma.membership.findMany({
      where: { userId: other.userId },
    });
    expect(memberships).toHaveLength(2);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: other.userId },
      select: { passwordHash: true },
    });
    expect(after.passwordHash).toBe(before.passwordHash);

    // Their original password still works.
    await request(app)
      .post('/api/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
  });
});

describe('an invitation is single-use and revocable', () => {
  it('cannot be used twice', async () => {
    const sent = await invite().expect(201);
    const token = tokenFrom(sent.body.inviteUrl);

    await request(app)
      .post(`/api/auth/invitations/${token}/accept`)
      .send({ password: TEST_PASSWORD })
      .expect(201);

    const second = await request(app)
      .post(`/api/auth/invitations/${token}/accept`)
      .send({ password: TEST_PASSWORD });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('INVITATION_USED');
  });

  it('stops working once withdrawn', async () => {
    const sent = await invite().expect(201);

    await request(app)
      .delete(`${studio.base}/invitations/${sent.body.invitation.id}`)
      .set(studio.headers)
      .expect(200);

    const res = await request(app)
      .post(`/api/auth/invitations/${tokenFrom(sent.body.inviteUrl)}/accept`)
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVITATION_REVOKED');
  });

  /** Withdrawing must not block inviting the same person again later. */
  it('lets the same person be re-invited after a withdrawal', async () => {
    const first = await invite().expect(201);

    await request(app)
      .delete(`${studio.base}/invitations/${first.body.invitation.id}`)
      .set(studio.headers)
      .expect(200);

    await invite().expect(201);
  });

  it('refuses to be used after it expires', async () => {
    const sent = await invite().expect(201);

    await prisma.invitation.update({
      where: { id: sent.body.invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post(`/api/auth/invitations/${tokenFrom(sent.body.inviteUrl)}/accept`)
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVITATION_EXPIRED');
  });

  it('404s on a token that was never issued', async () => {
    await request(app)
      .get('/api/auth/invitations/not-a-real-token')
      .expect(404);
  });

  it('is listed for the studio, without the token', async () => {
    await invite().expect(201);

    const res = await request(app)
      .get(`${studio.base}/invitations`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.invitations).toHaveLength(1);
    expect(res.body.invitations[0].status).toBe('PENDING');
    expect(JSON.stringify(res.body)).not.toContain('tokenHash');
  });
});

/**
 * The platform half of S9. The rule under test is that an operator gets no
 * path around the last-owner invariant — a studio with zero owners cannot
 * invite, cannot transfer ownership back, and needs a hand-written UPDATE
 * against production to recover.
 */
describe('cross-tenant role assignment', () => {
  let admin: Studio;

  beforeEach(async () => {
    admin = await signUpStudio(app, { organizationName: 'Artweel HQ' });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: admin.userId },
      select: { email: true },
    });
    await grantPlatformAdmin({ email: user.email });
  });

  function setRole(membershipId: string, role: string) {
    return request(app)
      .post(
        `/api/platform/organizations/${studio.organizationId}/members/${membershipId}/role`,
      )
      .set(admin.headers)
      .send({ role, reason: 'owner asked on ticket #12' });
  }

  async function membershipOf(userId: string) {
    return prisma.membership.findFirstOrThrow({
      where: { organizationId: studio.organizationId, userId },
    });
  }

  it('promotes somebody, and records it', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );
    const membership = await membershipOf(instructor.userId);

    const res = await setRole(membership.id, 'ADMIN').expect(200);

    expect(res.body.before).toBe('INSTRUCTOR');
    expect(res.body.membership.role).toBe('ADMIN');

    const entry = await prisma.platformAuditLog.findFirstOrThrow({
      where: { action: 'membership.role.set' },
    });
    expect(entry.organizationId).toBe(studio.organizationId);
    expect(entry.reason).toBe('owner asked on ticket #12');
  });

  it('will not let the platform demote the last owner', async () => {
    const ownerMembership = await membershipOf(studio.userId);

    const res = await setRole(ownerMembership.id, 'INSTRUCTOR');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LAST_OWNER');

    // Unchanged, and the studio still has an owner.
    const after = await membershipOf(studio.userId);
    expect(after.role).toBe('OWNER');
  });

  /** The support case this exists for: restoring a studio's ownership. */
  it('can promote somebody to owner', async () => {
    const other = await addMemberToStudio(app, studio.organizationId, 'ADMIN');
    const membership = await membershipOf(other.userId);

    await setRole(membership.id, 'OWNER').expect(200);

    // And now the original owner CAN be demoted, because there are two.
    const ownerMembership = await membershipOf(studio.userId);
    await setRole(ownerMembership.id, 'ADMIN').expect(200);
  });

  it('is invisible without the platform gate', async () => {
    const ownerMembership = await membershipOf(studio.userId);

    await request(app)
      .post(
        `/api/platform/organizations/${studio.organizationId}/members/${ownerMembership.id}/role`,
      )
      .set(studio.headers)
      .send({ role: 'ADMIN', reason: 'owner asked on ticket #12' })
      .expect(404);
  });
});
