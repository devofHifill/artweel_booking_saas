import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * A studio's own pages, and the two things about them that must not regress.
 *
 * 1. The `/p/` prefix. `/public/:slug/data`, `/availability` and
 *    `/services/:id/staff` are the API the booking page itself calls, and an
 *    unprefixed page path would shadow them — not at deploy time, but on the
 *    day a studio names a page "data".
 * 2. Escaping. The body is plain text and rendered escaped, because a textarea
 *    that accepts markup is stored XSS on a page the studio's own customers
 *    visit.
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

const addPage = (body: Record<string, unknown>) =>
  request(app).post(`${studio.base}/site/pages`).set(studio.headers).send(body);

describe('page addresses', () => {
  it('creates a page as a draft unless told otherwise', async () => {
    const res = await addPage({ path: 'about', title: 'About', body: 'Hello.' });

    expect(res.status).toBe(201);
    expect(res.body.page.status).toBe('DRAFT');
  });

  /*
    422 from the zod middleware, which is where a malformed SHAPE is caught;
    the reserved-word check below is a service decision and answers 400. Both
    are refusals — asserted separately so a change that moved a check from one
    layer to the other would show up here rather than pass silently.
  */
  it('refuses an address that is not url-shaped', async () => {
    for (const path of ['About Us', 'a/b', '../admin', 'Ünicode']) {
      const res = await addPage({ path, title: 'X', body: 'y' });
      expect(res.status, `expected ${path} to be refused`).toBe(422);
    }
  });

  it('refuses a reserved address', async () => {
    const res = await addPage({ path: 'login', title: 'Login', body: 'y' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/reserved/i);
  });

  it('refuses a duplicate address, naming the page that has it', async () => {
    await addPage({ path: 'about', title: 'About the studio', body: 'y' });

    const clash = await addPage({ path: 'about', title: 'Another', body: 'y' });

    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toContain('About the studio');
  });
});

describe('what the public can see', () => {
  it('serves a published page and keeps drafts hidden', async () => {
    const draft = await addPage({
      path: 'visiting',
      title: 'Visiting us',
      body: 'Parking is behind the building.',
    });

    const notYet = await request(app).get(`/public/${slug}/p/visiting`);
    expect(notYet.status).toBe(404);

    await request(app)
      .patch(`${studio.base}/site/pages/${draft.body.page.id}`)
      .set(studio.headers)
      .send({ status: 'PUBLISHED' });

    const live = await request(app).get(`/public/${slug}/p/visiting`);
    expect(live.status).toBe(200);
    expect(live.text).toContain('Visiting us');
    expect(live.text).toContain('Parking is behind the building.');
  });

  it('does not shadow the booking page’s own API', async () => {
    /*
      The whole reason for the /p/ prefix. A studio naming a page "data" must
      not break `/public/:slug/data`, which is what its booking page calls for
      services and availability.
    */
    const made = await addPage({ path: 'data', title: 'Data', body: 'x' });
    // "data" is reserved outright, which is the belt to the /p/ braces.
    expect(made.status).toBe(400);
    expect(made.body.error.message).toMatch(/reserved/i);

    const api = await request(app).get(`/public/${slug}/data`);
    expect(api.status).toBe(200);
    expect(api.body.organization).toBeDefined();
  });

  it('lists published pages in the site navigation, and not drafts', async () => {
    const shown = await addPage({ path: 'about', title: 'About', body: 'y' });
    await addPage({ path: 'terms', title: 'Terms', body: 'y' });

    await request(app)
      .patch(`${studio.base}/site/pages/${shown.body.page.id}`)
      .set(studio.headers)
      .send({ status: 'PUBLISHED' });

    const page = await request(app).get(`/public/${slug}/p/about`);

    expect(page.text).toContain('About');
    // The still-draft page is not advertised in the header of a live site.
    expect(page.text).not.toContain('Terms');
  });
});

describe('escaping', () => {
  it('renders markup in a title or body as text, not as HTML', async () => {
    const made = await addPage({
      path: 'xss',
      title: '<script>alert(1)</script>',
      body: '<img src=x onerror=alert(2)>\n\nEnd.',
      status: 'PUBLISHED',
    });
    expect(made.status).toBe(201);

    const res = await request(app).get(`/public/${slug}/p/xss`);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).not.toContain('<img src=x');
    expect(res.text).toContain('&lt;script&gt;');
    expect(res.text).toContain('&lt;img');
  });

  it('splits the body on blank lines into paragraphs', async () => {
    await addPage({
      path: 'about',
      title: 'About',
      body: 'First paragraph.\n\nSecond paragraph.',
      status: 'PUBLISHED',
    });

    const res = await request(app).get(`/public/${slug}/p/about`);

    expect(res.text).toContain('<p>First paragraph.</p>');
    expect(res.text).toContain('<p>Second paragraph.</p>');
  });
});
