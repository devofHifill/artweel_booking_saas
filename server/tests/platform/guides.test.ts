import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';
import { grantPlatformAdmin } from '../../src/modules/platform/platform.service';
import { PLATFORM_GUIDES } from '../../src/modules/platform/guides.service';

/**
 * Guides for platform admins.
 *
 * The point of serving these from the API is that a studio owner cannot read
 * them, so most of what is asserted is the refusal: the same 404 an unknown
 * route gives, for both the list and the guide itself.
 */

const app = createApp();

let admin: Studio;
let owner: Studio;

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
  owner = await signUpStudio(app, { organizationName: 'Clay Corner' });
  await grantPlatformAdmin({ email: admin.email });
});

describe('platform guides', () => {
  it('lists the guides for a platform admin', async () => {
    const res = await request(app).get('/api/platform/guides').set(admin.headers);

    expect(res.status).toBe(200);
    expect(res.body.guides.map((g: { slug: string }) => g.slug)).toContain('stripe');
    // The list carries no Markdown; that comes with the guide.
    expect(res.body.guides[0].markdown).toBeUndefined();
  });

  it('opens the Stripe guide with its Markdown', async () => {
    const res = await request(app).get('/api/platform/guides/stripe').set(admin.headers);

    expect(res.status).toBe(200);
    expect(res.body.guide.title).toBe('Stripe: platform setup');
    expect(res.body.guide.markdown).toContain('STRIPE_WEBHOOK_SECRET');
  });

  it('can read every guide it lists', async () => {
    // A guide registered without its file would list fine and fail to open.
    for (const guide of PLATFORM_GUIDES) {
      const res = await request(app)
        .get(`/api/platform/guides/${guide.slug}`)
        .set(admin.headers);
      expect(res.status, guide.slug).toBe(200);
    }
  });

  it('answers an unknown guide with 404', async () => {
    const res = await request(app).get('/api/platform/guides/nope').set(admin.headers);
    expect(res.status).toBe(404);
  });

  it('refuses a studio owner as if the route did not exist', async () => {
    const list = await request(app).get('/api/platform/guides').set(owner.headers);
    const guide = await request(app).get('/api/platform/guides/stripe').set(owner.headers);

    expect(list.status).toBe(404);
    expect(guide.status).toBe(404);
    expect(JSON.stringify(guide.body)).not.toContain('STRIPE_WEBHOOK_SECRET');
  });

  it('refuses a caller with no token', async () => {
    const res = await request(app).get('/api/platform/guides/stripe');
    expect(res.status).toBe(404);
  });
});
