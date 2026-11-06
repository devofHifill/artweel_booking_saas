import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * The studio's website (Home, Activities, an activity's page) lists Classes
 * too (CLASS-EVENT-PLAN.md). It was built before Classes existed and showed
 * only the older activities, so a Class could be found on the booking page
 * but not on the website that links to it.
 */

function weeksAhead(weeks = 3): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

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
  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
  slug = (await prisma.organization.findUniqueOrThrow({ where: { id: studio.organizationId } })).slug;
});

async function publishClass(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`${studio.base}/activities/classes`)
    .set(studio.headers)
    .send({
      name: 'Family Wheel Saturdays',
      shortDescription: 'Parents and kids at the wheel',
      startDate: weeksAhead(),
      weekdays: ['SA'],
      startTime: '10:00',
      endTime: '12:00',
      sessionCount: 4,
      seats: 8,
      priceCents: 33300,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body as { service: { id: string; slug: string }; series: { id: string } };
}

const page = async (path: string) =>
  (await request(app).get(`/public/${slug}${path}`).expect(200)).text;

describe('Classes on the website', () => {
  it('lists a Class on Home and Activities, as a run of sessions, booking straight into it', async () => {
    const { service } = await publishClass();

    for (const path of ['', '/activities']) {
      const html = await page(path);
      expect(html).toContain('Family Wheel Saturdays');
      expect(html).toContain('4 sessions from');
      expect(html).toContain('8 places left');
      expect(html).toContain(`/book?service=${service.id}`);
      // Not dressed up as one session for sale.
      expect(html).not.toMatch(/Family Wheel Saturdays[\s\S]{0,800}Next:/);
    }
  });

  it("gives a Class its own page with every date, booked together", async () => {
    const { service } = await publishClass();
    const html = await page(`/a/${service.slug}`);
    expect(html).toContain('4 sessions, booked together');
    expect(html).toContain('per adult, for all 4 sessions');
    expect(html).toContain('Book this class');
  });

  it('says when booking opens, and offers no Book button until then', async () => {
    const { service } = await publishClass({ startDate: '2027-06-05', maxHorizonDays: 30 });
    const html = await page('/activities');
    expect(html).toContain('Booking opens');
    expect(html).not.toContain(`/book?service=${service.id}`);
  });

  it('leaves out a Hidden Class', async () => {
    await publishClass({ isActive: false });
    expect(await page('/activities')).not.toContain('Family Wheel Saturdays');
  });

  it('opens the class from a website link on the booking page', async () => {
    await publishClass();
    const html = await page('/book');
    // The booking page script finds a Class by its activity id in DATA.courses.
    expect(html).toContain('c.service.id === wantedId && c.enrollable');
  });
});
