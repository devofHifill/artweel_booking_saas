import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * No dead ends on the booking page (docs/ux-audit-findings.md #5).
 *
 * "No dates scheduled yet. Check back soon." and "Please contact the studio"
 * ended the conversation — no contact details, no other way forward. The page
 * now offers the studio's email and phone and its other activities. That is
 * drawn in the browser, so what the server owes it is the details to draw.
 */

const app = createApp();
let studio: Studio;
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
  studio = await signUpStudio(app, { organizationName: 'Bay Paddle Club' });
  slug = (
    await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
      select: { slug: true },
    })
  ).slug;
});

const bookingPage = async () => (await request(app).get(`/public/${slug}/book`).expect(200)).text;

describe('the booking page', () => {
  it("carries the studio's contact details for when there is nothing to book", async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { contactEmail: 'hello@baypaddle.test', contactPhone: '+44 20 7946 0000' },
    });

    const html = await bookingPage();
    expect(html).toContain('"studioName":"Bay Paddle Club"');
    expect(html).toContain('"contactEmail":"hello@baypaddle.test"');
    expect(html).toContain('"contactPhone":"+44 20 7946 0000"');
    // And the script that offers them, and the studio's other activities.
    expect(html).toContain('Or book something else');
  });

  it('still works for a studio that gave no contact details', async () => {
    const html = await bookingPage();
    expect(html).toContain('"contactEmail":null');
    // The old message, as the script used to write it — not a mention of it.
    expect(html).not.toContain("'No dates scheduled yet. Check back soon.'");
  });
});
