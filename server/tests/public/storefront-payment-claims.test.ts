import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * The storefront's promises about payment (docs/ux-audit-findings.md #13).
 *
 * Every studio's home page said "Secure card payment — card payments are
 * handled by Stripe" and "held the moment you pay", including studios that
 * take no payment online, whose booking form then said "Payable on the day".
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
  studio = await signUpStudio(app, { organizationName: 'Harbour Kayak Tours' });
  slug = (
    await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
      select: { slug: true },
    })
  ).slug;
});

const home = async () => (await request(app).get(`/public/${slug}`).expect(200)).text;

describe('a studio that takes no payment online', () => {
  it('does not promise card payment', async () => {
    const html = await home();

    expect(html).not.toContain('Secure card payment');
    expect(html).not.toContain('handled by Stripe');
    expect(html).not.toContain('the moment you pay');
    expect(html).toContain('Nothing to pay online');
    expect(html).toContain('the moment you book');
  });
});

describe('a studio that does', () => {
  it('says so', async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { stripeAccountId: 'acct_test_harbour', stripeChargesEnabled: true },
    });

    const html = await home();

    expect(html).toContain('Secure card payment');
    expect(html).toContain('the moment you pay');
    expect(html).not.toContain('Nothing to pay online');
  });

  it('does not while its Stripe account cannot take charges yet', async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { stripeAccountId: 'acct_test_harbour', stripeChargesEnabled: false },
    });

    expect(await home()).not.toContain('Secure card payment');
  });

  it('never puts the account id on the page', async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { stripeAccountId: 'acct_test_harbour', stripeChargesEnabled: true },
    });

    expect(await home()).not.toContain('acct_test_harbour');
  });
});
