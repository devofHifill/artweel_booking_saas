import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';

/**
 * Tenancy on the HTTP surface.
 *
 * Phase 0 proved the SERVICE layer refuses cross-tenant work. This proves the
 * ROUTE layer refuses it too, before a service is ever reached — and that the
 * role gates cannot be stepped around by calling an endpoint directly.
 *
 * Every hostile request here uses a real, valid organization id that simply
 * belongs to somebody else. That is what a broken tenant check lets through.
 */

const app = createApp();
const PASSWORD = 'kiln-shelf-glaze-42';

type Actor = {
  userId: string;
  accessToken: string;
  organizationId: string;
};

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
});

async function signUp(email: string, orgName: string): Promise<Actor> {
  const res = await request(app).post('/api/auth/register').send({
    email,
    password: PASSWORD,
    name: email.split('@')[0],
    organizationName: orgName,
  });

  return {
    userId: res.body.user.id,
    accessToken: res.body.tokens.accessToken,
    organizationId: res.body.organization.id,
  };
}

/** Adds a user to an organization at a given role, without going through invites. */
async function addMember(
  organizationId: string,
  email: string,
  role: 'ADMIN' | 'INSTRUCTOR' | 'FRONT_DESK',
): Promise<Actor> {
  const registered = await request(app).post('/api/auth/register').send({
    email,
    password: PASSWORD,
    name: email.split('@')[0],
  });

  await prisma.membership.create({
    data: { organizationId, userId: registered.body.user.id, role },
  });

  return {
    userId: registered.body.user.id,
    accessToken: registered.body.tokens.accessToken,
    organizationId,
  };
}

const auth = (actor: Actor) => ({ Authorization: `Bearer ${actor.accessToken}` });

describe('cross-organization access', () => {
  it('hides another studio behind a 404, not a 403', async () => {
    // 403 would confirm the studio exists, letting an outsider enumerate
    // organizations by id. 404 gives nothing away.
    const alpha = await signUp('alpha@clay.test', 'Alpha Clay');
    const beta = await signUp('beta@clay.test', 'Beta Ceramics');

    const res = await request(app)
      .get(`/api/organizations/${beta.organizationId}`)
      .set(auth(alpha));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_A_MEMBER');
  });

  it('refuses to update another studio', async () => {
    const alpha = await signUp('alpha@clay.test', 'Alpha Clay');
    const beta = await signUp('beta@clay.test', 'Beta Ceramics');

    const res = await request(app)
      .patch(`/api/organizations/${beta.organizationId}`)
      .set(auth(alpha))
      .send({ name: 'Owned By Alpha Now' });

    expect(res.status).toBe(404);

    const unchanged = await prisma.organization.findUniqueOrThrow({
      where: { id: beta.organizationId },
    });
    expect(unchanged.name).toBe('Beta Ceramics');
  });

  it('refuses to list another studio members', async () => {
    const alpha = await signUp('alpha@clay.test', 'Alpha Clay');
    const beta = await signUp('beta@clay.test', 'Beta Ceramics');

    const res = await request(app)
      .get(`/api/organizations/${beta.organizationId}/members`)
      .set(auth(alpha));

    expect(res.status).toBe(404);
  });

  it('lists only the studios the caller actually belongs to', async () => {
    const alpha = await signUp('alpha@clay.test', 'Alpha Clay');
    await signUp('beta@clay.test', 'Beta Ceramics');

    const res = await request(app)
      .get('/api/organizations')
      .set(auth(alpha));

    expect(res.status).toBe(200);
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.memberships[0].organizationId).toBe(alpha.organizationId);
  });

  it('supports one person belonging to several studios', async () => {
    // Freelance instructors genuinely teach at multiple studios, which is why
    // the organization is not baked into the access token.
    const alpha = await signUp('alpha@clay.test', 'Alpha Clay');
    const beta = await signUp('beta@clay.test', 'Beta Ceramics');

    await prisma.membership.create({
      data: {
        organizationId: beta.organizationId,
        userId: alpha.userId,
        role: 'INSTRUCTOR',
      },
    });

    const res = await request(app).get('/api/organizations').set(auth(alpha));
    expect(res.body.memberships).toHaveLength(2);

    // Same token, both studios, different authority in each.
    const asOwner = await request(app)
      .get(`/api/organizations/${alpha.organizationId}`)
      .set(auth(alpha));
    expect(asOwner.body.role).toBe('OWNER');

    const asInstructor = await request(app)
      .get(`/api/organizations/${beta.organizationId}`)
      .set(auth(alpha));
    expect(asInstructor.body.role).toBe('INSTRUCTOR');
  });
});

describe('role gates', () => {
  it('lets an admin edit the studio but not an instructor', async () => {
    const owner = await signUp('owner@clay.test', 'Clay & Co');
    const admin = await addMember(owner.organizationId, 'admin@clay.test', 'ADMIN');
    const instructor = await addMember(
      owner.organizationId,
      'teacher@clay.test',
      'INSTRUCTOR',
    );

    expect(
      (
        await request(app)
          .patch(`/api/organizations/${owner.organizationId}`)
          .set(auth(admin))
          .send({ name: 'Clay and Company' })
      ).status,
    ).toBe(200);

    const denied = await request(app)
      .patch(`/api/organizations/${owner.organizationId}`)
      .set(auth(instructor))
      .send({ name: 'Instructor Was Here' });

    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('restricts role changes to owners', async () => {
    const owner = await signUp('owner@clay.test', 'Clay & Co');
    const admin = await addMember(owner.organizationId, 'admin@clay.test', 'ADMIN');
    const instructor = await addMember(
      owner.organizationId,
      'teacher@clay.test',
      'INSTRUCTOR',
    );

    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: instructor.userId, organizationId: owner.organizationId },
    });

    // An admin cannot promote people — that is an owner's decision.
    expect(
      (
        await request(app)
          .patch(
            `/api/organizations/${owner.organizationId}/members/${membership.id}`,
          )
          .set(auth(admin))
          .send({ role: 'ADMIN' })
      ).status,
    ).toBe(403);

    expect(
      (
        await request(app)
          .patch(
            `/api/organizations/${owner.organizationId}/members/${membership.id}`,
          )
          .set(auth(owner))
          .send({ role: 'ADMIN' })
      ).status,
    ).toBe(200);
  });

  it('refuses to remove the last owner', async () => {
    // Otherwise a studio can be left with nobody able to administer it.
    const owner = await signUp('owner@clay.test', 'Clay & Co');

    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: owner.userId },
    });

    const demote = await request(app)
      .patch(`/api/organizations/${owner.organizationId}/members/${membership.id}`)
      .set(auth(owner))
      .send({ role: 'ADMIN' });

    expect(demote.status).toBe(400);
    expect(demote.body.error.code).toBe('LAST_OWNER');

    const remove = await request(app)
      .delete(`/api/organizations/${owner.organizationId}/members/${membership.id}`)
      .set(auth(owner));

    expect(remove.status).toBe(400);
    expect(remove.body.error.code).toBe('LAST_OWNER');
  });

  it('allows demotion once a second owner exists', async () => {
    const owner = await signUp('owner@clay.test', 'Clay & Co');
    const second = await addMember(owner.organizationId, 'two@clay.test', 'ADMIN');

    const secondMembership = await prisma.membership.findFirstOrThrow({
      where: { userId: second.userId },
    });
    await request(app)
      .patch(
        `/api/organizations/${owner.organizationId}/members/${secondMembership.id}`,
      )
      .set(auth(owner))
      .send({ role: 'OWNER' });

    const firstMembership = await prisma.membership.findFirstOrThrow({
      where: { userId: owner.userId },
    });
    const res = await request(app)
      .patch(
        `/api/organizations/${owner.organizationId}/members/${firstMembership.id}`,
      )
      .set(auth(owner))
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(200);
  });

  it('refuses to touch a membership belonging to another studio', async () => {
    // A valid membership id, just not one of ours.
    const alpha = await signUp('alpha@clay.test', 'Alpha Clay');
    const beta = await signUp('beta@clay.test', 'Beta Ceramics');

    const betaMembership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: beta.organizationId },
    });

    const res = await request(app)
      .patch(
        `/api/organizations/${alpha.organizationId}/members/${betaMembership.id}`,
      )
      .set(auth(alpha))
      .send({ role: 'FRONT_DESK' });

    expect(res.status).toBe(404);

    const unchanged = await prisma.membership.findUniqueOrThrow({
      where: { id: betaMembership.id },
    });
    expect(unchanged.role).toBe('OWNER');
  });
});
