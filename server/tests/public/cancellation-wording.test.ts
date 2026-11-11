import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * The cancellation promise on the public site (FB-16).
 *
 * The home page said "48h · free cancellation", which a customer could read
 * as a window after booking. Every surface now uses the checkout's sentence,
 * and the activity page reads the activity's own policy, as the checkout does.
 */

const app = createApp();
let studio: Studio;
let slug: string;
let serviceId: string;

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
  slug = (
    await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
      select: { slug: true },
    })
  ).slug;

  await prisma.cancellationPolicy.deleteMany({
    where: { organizationId: studio.organizationId },
  });
  /* Two full-refund tiers on purpose: the promise is the LOWEST one. */
  await prisma.cancellationPolicy.create({
    data: {
      organizationId: studio.organizationId,
      name: 'Standard',
      isDefault: true,
      tiers: [
        { hoursBefore: 72, refundPercent: 100 },
        { hoursBefore: 48, refundPercent: 100 },
        { hoursBefore: 24, refundPercent: 50 },
      ],
    },
  });

  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Beginner Wheel Throwing',
      bookingMode: 'EVENT',
      durationMinutes: 180,
      capacityMax: 8,
      priceCents: 9500,
    });
  serviceId = service.body.service.id;
});

const get = async (path: string) =>
  (await request(app).get(`/public/${slug}${path}`).expect(200)).text;

describe('the home page', () => {
  it('spells the window out instead of "48h"', async () => {
    const html = await get('');

    expect(html).toContain('<b>48 hours</b><span>notice to cancel for free</span>');
    expect(html).toContain('Cancel up to 48 hours before it starts');
    expect(html).not.toContain('48h<');
  });

  it('makes no promise when no tier refunds in full', async () => {
    await prisma.cancellationPolicy.updateMany({
      where: { organizationId: studio.organizationId },
      data: { tiers: [{ hoursBefore: 48, refundPercent: 50 }] },
    });

    const html = await get('');

    expect(html).not.toContain('notice to cancel for free');
    expect(html).not.toContain('Free cancellation');
  });
});

describe('the activity page', () => {
  it('uses the sentence the checkout uses', async () => {
    const html = await get(`/a/${serviceId}`);

    expect(html).toContain('Free cancellation up to 48 hours before it starts');
  });

  it("reads the activity's own policy, not the studio default", async () => {
    const own = await prisma.cancellationPolicy.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Short notice',
        isDefault: false,
        tiers: [{ hoursBefore: 24, refundPercent: 100 }],
      },
    });
    await prisma.serviceType.update({
      where: { id: serviceId },
      data: { cancellationPolicyId: own.id },
    });

    const html = await get(`/a/${serviceId}`);

    expect(html).toContain('Free cancellation up to 24 hours before it starts');
    expect(html).not.toContain('up to 48 hours');
  });
});
