import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';
import { grantPlatformAdmin } from '../../src/modules/platform/platform.service';

/**
 * S7 — read-only support sessions.
 *
 * This is the only stage that touches the tenant choke point, so most of what
 * is asserted here is what a support grant CANNOT do. The rejected design — a
 * `if (isPlatformAdmin) allow` bypass in `withOrganization` — would pass a test
 * that only checked "the operator can see the studio's bookings". The tests
 * that distinguish the two are the ones below about scope, method and role.
 */

const app = createApp();

let admin: Studio;
let target: Studio;
let other: Studio;

const REASON = 'owner reports the calendar is showing the wrong week';

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  admin = await signUpStudio(app, { organizationName: 'Artweel HQ' });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: admin.userId },
    select: { email: true },
  });
  await grantPlatformAdmin({ email: user.email });

  target = await signUpStudio(app, { organizationName: 'Clay & Co' });
  other = await signUpStudio(app, { organizationName: 'Kiln House' });
});

/**
 * NOT `async`. Supertest's chainable `Test` is a thenable, and wrapping it in a
 * promise — which `async` does — strips `.expect()` off the return value.
 */
function startSession(
  body: { reason?: string; readOnly?: boolean } = {},
  organizationId = target.organizationId,
) {
  return request(app)
    .post(`/api/platform/organizations/${organizationId}/support-sessions`)
    .set(admin.headers)
    .send({ reason: body.reason ?? REASON, ...body });
}

/** The support token as an Authorization header. */
const asSupport = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('opening a session', () => {
  it('mints a token and records the reason', async () => {
    const res = await startSession().expect(201);

    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.session.readOnly).toBe(true);
    expect(res.body.session.reason).toBe(REASON);
    expect(res.body.studio.name).toBe('Clay & Co');

    const row = await prisma.supportSession.findUniqueOrThrow({
      where: { id: res.body.session.id },
    });
    expect(row.organizationId).toBe(target.organizationId);
    // The human at the keyboard, not the studio.
    expect(row.actorUserId).toBe(admin.userId);
    expect(row.endedAt).toBeNull();
  });

  it('is read-only unless write access is asked for', async () => {
    const byDefault = await startSession().expect(201);
    expect(byDefault.body.session.readOnly).toBe(true);

    const explicit = await startSession({ readOnly: false }).expect(201);
    expect(explicit.body.session.readOnly).toBe(false);
  });

  it('refuses a reason nobody could act on', async () => {
    await startSession({ reason: 'x' }).expect(422);
  });

  it('writes an audit row naming the operator and the studio', async () => {
    await startSession().expect(201);

    const entry = await prisma.platformAuditLog.findFirstOrThrow({
      where: { action: 'support.session.start' },
    });
    expect(entry.actorUserId).toBe(admin.userId);
    expect(entry.organizationId).toBe(target.organizationId);
    expect(entry.reason).toBe(REASON);
  });

  it('is invisible to somebody who is not a platform admin', async () => {
    // Same 404 a non-existent route gives — the gate hides its own existence.
    await request(app)
      .post(
        `/api/platform/organizations/${target.organizationId}/support-sessions`,
      )
      .set(target.headers)
      .send({ reason: REASON })
      .expect(404);
  });
});

describe('what the grant reaches', () => {
  it('reads the studio it was scoped to', async () => {
    const { body } = await startSession().expect(201);

    await request(app)
      .get(`/api/organizations/${target.organizationId}/customers`)
      .set(asSupport(body.accessToken))
      .expect(200);
  });

  /**
   * The assertion the bypass design would fail. A platform-admin flag in
   * `withOrganization` makes every studio reachable; a grant reaches exactly
   * one, and answers for the rest exactly as a stranger would.
   */
  it('gets an ordinary 404 for any other studio', async () => {
    const { body } = await startSession().expect(201);

    await request(app)
      .get(`/api/organizations/${other.organizationId}/customers`)
      .set(asSupport(body.accessToken))
      .expect(404);
  });

  it('refuses a write on a read-only session, at the choke point', async () => {
    const { body } = await startSession().expect(201);

    const res = await request(app)
      .post(`/api/organizations/${target.organizationId}/services`)
      .set(asSupport(body.accessToken))
      .send({
        name: 'Should never exist',
        bookingMode: 'EVENT',
        durationMinutes: 60,
        capacityMax: 4,
        priceCents: 1000,
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SUPPORT_READ_ONLY');

    // And nothing was created — the refusal is before the handler, not inside it.
    const count = await prisma.serviceType.count({
      where: { organizationId: target.organizationId },
    });
    expect(count).toBe(0);
  });

  it('allows a write when the session was opened for one', async () => {
    const { body } = await startSession({ readOnly: false }).expect(201);

    await request(app)
      .post(`/api/organizations/${target.organizationId}/services`)
      .set(asSupport(body.accessToken))
      .send({
        name: 'Repaired by support',
        bookingMode: 'EVENT',
        durationMinutes: 60,
        capacityMax: 4,
        priceCents: 1000,
      })
      .expect(201);
  });

  /**
   * The gradient the whole design exists for. A write-enabled session is ADMIN,
   * never OWNER — so it can fix a studio's schedule and cannot remove the
   * studio's owner. "No distance between looking at a calendar and deleting
   * their account" is the specific thing the bypass was rejected for.
   */
  it('cannot touch the studio ownership even with writes enabled', async () => {
    const { body } = await startSession({ readOnly: false }).expect(201);

    const members = await request(app)
      .get(`/api/organizations/${target.organizationId}/members`)
      .set(asSupport(body.accessToken))
      .expect(200);

    const ownerMembership = members.body.members[0];

    await request(app)
      .delete(
        `/api/organizations/${target.organizationId}/members/${ownerMembership.membershipId}`,
      )
      .set(asSupport(body.accessToken))
      .expect(403);

    await request(app)
      .patch(
        `/api/organizations/${target.organizationId}/members/${ownerMembership.membershipId}`,
      )
      .set(asSupport(body.accessToken))
      .send({ role: 'INSTRUCTOR' })
      .expect(403);
  });

  it('cannot reach the platform surface with a support token', async () => {
    const { body } = await startSession().expect(201);

    // The token authenticates a studio context, not platform authority. If it
    // carried both, a leaked support token would be a platform key.
    await request(app)
      .get('/api/platform/organizations')
      .set(asSupport(body.accessToken))
      .expect(404);
  });
});

describe('the token is not an ordinary session', () => {
  it('comes with no refresh token anywhere in the response', async () => {
    const res = await startSession().expect(201);

    const serialised = JSON.stringify(res.body);
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.tokens).toBeUndefined();
    expect(serialised).not.toContain('refresh');
  });

  it('cannot be exchanged for a longer-lived one', async () => {
    const { body } = await startSession().expect(201);

    // Refresh expects a refresh token, and a support access token is not one.
    // Asserted because "expiry is a hard wall" is only true if there is no
    // path that renews it.
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: body.accessToken });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('reports the studio it is scoped to, and only that one, from /me', async () => {
    const { body } = await startSession().expect(201);

    const me = await request(app)
      .get('/api/auth/me')
      .set(asSupport(body.accessToken))
      .expect(200);

    // The operator's own studio must not appear — a support token cannot reach
    // it, so listing it would put a 404 in the dashboard's switcher.
    expect(me.body.memberships).toHaveLength(1);
    expect(me.body.memberships[0].organizationId).toBe(target.organizationId);
    expect(me.body.memberships[0].role).toBe('ADMIN');
    expect(me.body.support.readOnly).toBe(true);
    expect(me.body.support.studioName).toBe('Clay & Co');
    // Still the real human.
    expect(me.body.user.id).toBe(admin.userId);
  });
});

describe('ending a session', () => {
  it('stops the token working immediately, not at expiry', async () => {
    const { body } = await startSession().expect(201);

    await request(app)
      .get(`/api/organizations/${target.organizationId}/customers`)
      .set(asSupport(body.accessToken))
      .expect(200);

    await request(app)
      .post(`/api/platform/support-sessions/${body.session.id}/end`)
      .set(admin.headers)
      .expect(200);

    // The JWT is still perfectly valid and still within its 30 minutes. What
    // changed is the row, which is why the row is read on every request.
    const after = await request(app)
      .get(`/api/organizations/${target.organizationId}/customers`)
      .set(asSupport(body.accessToken));

    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('SUPPORT_SESSION_ENDED');
  });

  it('is idempotent', async () => {
    const { body } = await startSession().expect(201);

    const first = await request(app)
      .post(`/api/platform/support-sessions/${body.session.id}/end`)
      .set(admin.headers)
      .expect(200);
    expect(first.body.alreadyEnded).toBe(false);

    const second = await request(app)
      .post(`/api/platform/support-sessions/${body.session.id}/end`)
      .set(admin.headers)
      .expect(200);
    expect(second.body.alreadyEnded).toBe(true);
  });

  it('refuses a token whose session has expired', async () => {
    const { body } = await startSession().expect(201);

    // Backdate the row rather than waiting thirty minutes. The token's own exp
    // is still in the future, so this proves the ROW is what decides.
    await prisma.supportSession.update({
      where: { id: body.session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app)
      .get(`/api/organizations/${target.organizationId}/customers`)
      .set(asSupport(body.accessToken))
      .expect(401);
  });
});

describe('what the session records', () => {
  /**
   * Reads are counted, writes are logged. One audit row per read would bury
   * the writes — which is the thing the log exists to surface.
   */
  it('counts reads on the row instead of writing an audit row each', async () => {
    const { body } = await startSession().expect(201);

    for (let i = 0; i < 3; i++) {
      await request(app)
        .get(`/api/organizations/${target.organizationId}/customers`)
        .set(asSupport(body.accessToken))
        .expect(200);
    }

    // The counter is updated fire-and-forget, so allow it to land.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const row = await prisma.supportSession.findUniqueOrThrow({
      where: { id: body.session.id },
    });

    expect(row.readCount).toBeGreaterThanOrEqual(3);
    expect(row.endpoints).toBeTruthy();
    expect(JSON.stringify(row.endpoints)).toContain('customers');

    // Three reads produced no audit rows of their own.
    const reads = await prisma.platformAuditLog.count({
      where: { action: { startsWith: 'support.read' } },
    });
    expect(reads).toBe(0);
  });

  it('lists sessions for a studio, newest first', async () => {
    await startSession({ reason: 'first look at the calendar bug' }).expect(201);
    await startSession({ reason: 'second look after they replied' }).expect(201);

    const res = await request(app)
      .get(
        `/api/platform/support-sessions?organizationId=${target.organizationId}`,
      )
      .set(admin.headers)
      .expect(200);

    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions[0].reason).toBe('second look after they replied');
    // The token is never handed back — a grant you can re-fetch never ended.
    expect(JSON.stringify(res.body)).not.toContain('accessToken');
  });
});

/**
 * The studio is told. A support session is somebody reading their customer
 * list, and they are entitled to know while it happens rather than afterwards
 * in a log they have no access to.
 */
describe('the studio can see it happening', () => {
  it('surfaces the active session on the studio own shell summary', async () => {
    const { body } = await startSession().expect(201);

    const summary = await request(app)
      .get(`/api/organizations/${target.organizationId}/shell/summary`)
      .set(target.headers)
      .expect(200);

    expect(summary.body.support).toHaveLength(1);
    expect(summary.body.support[0].reason).toBe(REASON);
    expect(summary.body.support[0].readOnly).toBe(true);
    expect(summary.body.support[0].by).toContain('@');

    await request(app)
      .post(`/api/platform/support-sessions/${body.session.id}/end`)
      .set(admin.headers)
      .expect(200);

    const after = await request(app)
      .get(`/api/organizations/${target.organizationId}/shell/summary`)
      .set(target.headers)
      .expect(200);

    expect(after.body.support).toHaveLength(0);
  });

  it('shows nothing to a studio nobody is inside', async () => {
    await startSession().expect(201);

    const summary = await request(app)
      .get(`/api/organizations/${other.organizationId}/shell/summary`)
      .set(other.headers)
      .expect(200);

    expect(summary.body.support).toHaveLength(0);
  });
});
