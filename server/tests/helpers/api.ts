import request from 'supertest';
import type { Express } from 'express';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * Fixture registrations must never be throttled.
 *
 * `tests/setup.ts` raises the auth limits far above anything a suite generates,
 * which works right up until `tests/auth/rate-limit.test.ts` runs. That file
 * lowers them deliberately — it is the one file that proves the limiters bite —
 * and `src/config` validates the environment ONCE at import time, so the low
 * values are frozen into config for the rest of the process. Every file that
 * happens to run after it inherits a budget of three registrations.
 *
 * That is invisible until the file order changes. Adding four test files in
 * Phase B moved `staff-delete` behind `rate-limit`, and it failed its fourth
 * through seventh tests with 429s while passing perfectly on its own.
 *
 * Two files had already patched this for themselves with a `resetRateLimits()`
 * in their own `beforeEach`. Doing it here instead fixes every file that exists
 * and every file anyone writes later, none of which should have to know that a
 * suite three directories away edits a global.
 *
 * Safe for the rate-limit suite itself: it does not use these helpers — it
 * builds its requests directly and manages `resetRateLimits` on its own terms.
 */
function clearRateLimitBudget() {
  resetRateLimits();
}

/**
 * A signed-in studio, ready to make authenticated calls.
 *
 * Tests read better when the interesting line is the assertion, not six lines
 * of token plumbing.
 */
export type Studio = {
  userId: string;
  /** The owner's own address — what a "send it to me" endpoint must use. */
  email: string;
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
    /**
     * The studio's timezone.
     *
     * Registration does not take one, so this is applied afterwards. Worth
     * having as an option rather than leaning on the default: the manifest and
     * analytics suites are specifically about the studio's day differing from
     * UTC's, and a test that silently depends on whatever `createOrganization`
     * defaults to would start passing for the wrong reason the day that
     * default changed.
     */
    timezone?: string;
  } = {},
): Promise<Studio> {
  clearRateLimitBudget();

  const suffix = Math.random().toString(36).slice(2, 10);
  const email = opts.email ?? `owner-${suffix}@clay.test`;

  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email,
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
    data: {
      plan: opts.plan ?? 'PRO',
      ...(opts.timezone ? { timezone: opts.timezone } : {}),
    },
  });

  return {
    userId: res.body.user.id,
    email,
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
  clearRateLimitBudget();

  const { prisma } = await import('../../src/lib/prisma');
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `member-${suffix}@clay.test`;

  const res = await request(app).post('/api/auth/register').send({
    email,
    password: TEST_PASSWORD,
    name: `Member ${role}`,
  });

  await prisma.membership.create({
    data: { organizationId, userId: res.body.user.id, role },
  });

  return {
    userId: res.body.user.id,
    email,
    organizationId,
    accessToken: res.body.tokens.accessToken,
    headers: { Authorization: `Bearer ${res.body.tokens.accessToken}` },
    base: `/api/organizations/${organizationId}`,
  };
}
