import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * The booking page wears the storefront's header and footer.
 *
 * Every storefront "Book now" lands on `/book`, which used to render as a
 * different product with no way back to the studio's own pages. Inside the
 * widget it stays bare: there the studio's website is the chrome, and a
 * second header inside their page would be a site within a site.
 */

const app = createApp();
let slug: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  const studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: studio.organizationId },
  });
  slug = org.slug;
});

describe('the booking page', () => {
  it('carries the storefront header and footer', async () => {
    const page = await request(app).get(`/public/${slug}/book`);

    expect(page.status).toBe(200);
    expect(page.text).toContain('class="sf-header"');
    expect(page.text).toContain('class="sf-footer"');
    expect(page.text).toContain(`href="/public/${slug}/activities"`);
  });

  it('stays bare inside the widget', async () => {
    for (const path of [`/public/${slug}/book?embed=1`, `/public/${slug}?embed=1`]) {
      const page = await request(app).get(path);

      expect(page.status).toBe(200);
      expect(page.text).not.toContain('class="sf-header"');
      expect(page.text).not.toContain('class="sf-footer"');
    }
  });
});
