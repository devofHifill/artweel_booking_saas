import request from 'supertest';
import type { Express } from 'express';

/**
 * A signed-in studio, ready to make authenticated calls.
 *
 * Tests read better when the interesting line is the assertion, not six lines
 * of token plumbing.
 */
export type Studio = {
  userId: string;
  organizationId: string;
  accessToken: string;
  headers: { Authorization: string };
  /** Path prefix for everything the studio owns. */
  base: string;
};

export const TEST_PASSWORD = 'kiln-shelf-glaze-42';

export async function signUpStudio(
  app: Express,
  opts: {
    email?: string;
    organizationName?: string;
    /**
     * Defaults to PRO so plan limits stay out of the way.
     *
     * Almost every suite predates billing and is testing something else — a
     * service-area test failing because the default plan does not include
     * mobile bookings tells you nothing about service areas. The billing
     * suite opts into SOLO explicitly, because there the limit IS the subject.
     */
    plan?: 'SOLO' | 'STUDIO' | 'PRO';
  } = {},
): Promise<Studio> {
  const suffix = Math.random().toString(36).slice(2, 10);

  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email: opts.email ?? `owner-${suffix}@clay.test`,
      password: TEST_PASSWORD,
      name: 'Studio Owner',
      organizationName: opts.organizationName ?? `Clay Studio ${suffix}`,
    });

  if (res.status !== 201) {
    throw new Error(`signUpStudio failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const organizationId = res.body.organization.id as string;

  const { prisma } = await import('../../src/lib/prisma');
  await prisma.organization.update({
    where: { id: organizationId },
    data: { plan: opts.plan ?? 'PRO' },
  });

  return {
    userId: res.body.user.id,
    organizationId,
    accessToken: res.body.tokens.accessToken,
    headers: { Authorization: `Bearer ${res.body.tokens.accessToken}` },
    base: `/api/organizations/${organizationId}`,
  };
}

/** Registers a user and drops them into an existing studio at a given role. */
export async function addMemberToStudio(
  app: Express,
  organizationId: string,
  role: 'ADMIN' | 'INSTRUCTOR' | 'FRONT_DESK',
): Promise<Studio> {
  const { prisma } = await import('../../src/lib/prisma');
  const suffix = Math.random().toString(36).slice(2, 10);

  const res = await request(app).post('/api/auth/register').send({
    email: `member-${suffix}@clay.test`,
    password: TEST_PASSWORD,
    name: `Member ${role}`,
  });

  await prisma.membership.create({
    data: { organizationId, userId: res.body.user.id, role },
  });

  return {
    userId: res.body.user.id,
    organizationId,
    accessToken: res.body.tokens.accessToken,
    headers: { Authorization: `Bearer ${res.body.tokens.accessToken}` },
    base: `/api/organizations/${organizationId}`,
  };
}
