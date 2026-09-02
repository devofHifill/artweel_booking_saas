import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * G3 — what is included, and what to bring.
 *
 * Two nullable columns, and the reason they are worth a migration is that a
 * three-hour wheel class raises both questions and the booking page could
 * answer neither. Unanswered, they arrive as a phone call the studio takes one
 * customer at a time.
 *
 * The bounds are asserted in two places on purpose — zod for a readable
 * message, CHECK so a value arriving any other way cannot get through. Both
 * are tested here, because a constraint nobody exercises is a constraint that
 * silently stops matching its schema.
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

  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: studio.organizationId },
  });
  slug = org.slug;
});

function makeClass(body: Record<string, unknown> = {}) {
  return request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Beginner Wheel Throwing',
      bookingMode: 'EVENT',
      durationMinutes: 180,
      capacityMax: 8,
      priceCents: 9_500,
      ...body,
    });
}

const HIGHLIGHTS = 'Clay, tools and glazes\nFiring for two pieces';
const PREP = 'Short nails, closed shoes, and clothes you can lose to clay.';

describe('writing the detail', () => {
  it('saves both fields and gives them back on read', async () => {
    const created = await makeClass({
      highlights: HIGHLIGHTS,
      preparationNotes: PREP,
    }).expect(201);

    const read = await request(app)
      .get(`${studio.base}/services/${created.body.service.id}`)
      .set(studio.headers)
      .expect(200);

    expect(read.body.service.highlights).toBe(HIGHLIGHTS);
    expect(read.body.service.preparationNotes).toBe(PREP);
  });

  it('leaves them null when a studio says nothing', async () => {
    const created = await makeClass().expect(201);

    expect(created.body.service.highlights).toBeNull();
    expect(created.body.service.preparationNotes).toBeNull();
  });

  it('refuses more than twelve highlights with a readable message', async () => {
    const res = await makeClass({
      highlights: Array.from({ length: 13 }, (_, i) => `Thing ${i + 1}`).join('\n'),
    });

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('Twelve highlights');
  });

  it('refuses a highlights block past the length bound', async () => {
    await makeClass({ highlights: 'x'.repeat(1_201) }).expect(422);
  });

  it('holds the same bounds in the database, not only in zod', async () => {
    /*
      The API is not the only way in. A fixture, a support session or a psql
      window all reach this table, and the CHECK is what stops any of them
      putting a thousand-line list onto somebody's booking page.
    */
    const created = await makeClass().expect(201);

    await expect(
      prisma.serviceType.update({
        where: { id: created.body.service.id },
        data: { highlights: 'x'.repeat(1_201) },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.serviceType.update({
        where: { id: created.body.service.id },
        data: {
          highlights: Array.from({ length: 13 }, (_, i) => `Thing ${i}`).join('\n'),
        },
      }),
    ).rejects.toThrow();
  });
});

describe('reading it on the booking page', () => {
  it('publishes both to the page', async () => {
    await makeClass({ highlights: HIGHLIGHTS, preparationNotes: PREP });

    const res = await request(app).get(`/public/${slug}`).expect(200);

    expect(res.text).toContain('Clay, tools and glazes');
    expect(res.text).toContain('Short nails, closed shoes');
  });

  it('escapes them rather than trusting the studio that wrote them', async () => {
    // An owner is not an attacker, but their copy still lands in a page.
    await makeClass({
      highlights: '<script>alert(1)</script>',
      preparationNotes: '<img src=x onerror=alert(1)>',
    });

    const res = await request(app).get(`/public/${slug}`).expect(200);

    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).not.toContain('<img src=x onerror');
  });

  it('says nothing at all when a studio has written nothing', async () => {
    await makeClass();

    const res = await request(app).get(`/public/${slug}`).expect(200);

    /*
      The headings live in the page script and are emitted only when there is
      something under them, so a studio that has filled nothing in gets the
      page it had before G3 rather than a column of empty sections.
    */
    expect(res.text).toContain('"highlights":null');
    expect(res.text).toContain('"preparationNotes":null');
  });
});
