import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * B8 — the Website & Widget page.
 *
 * The columns behind it existed only after the storefront_copy migration and
 * had no writer, so almost everything under test here is reachable from HTTP
 * only through the /page endpoint added in this phase. That is deliberately
 * why these run over supertest rather than by calling the service: the six
 * policy columns caught out in B4 had readers, tests and no writer, and one
 * more feature that could be edited by the tests and by nobody else would be
 * exactly the same shape of gap.
 */

const app = createApp();
let studio: Studio;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  studio = await signUpStudio(app);
});

describe('reading the page content', () => {
  it('starts empty, and ships the embed helpers with it', async () => {
    const res = await request(app)
      .get(`${studio.base}/page`)
      .set(studio.headers)
      .expect(200);

    // Every field is null on a fresh studio — the renderer has a fallback for
    // each, and the client renders placeholders against the same nulls.
    expect(res.body.page).toEqual({
      tagline: null,
      about: null,
      contactEmail: null,
      contactPhone: null,
      seoTitle: null,
      seoDescription: null,
    });

    // Copy and preview share one round-trip. The snippet is what a studio
    // pastes; the booking URL is what Preview points at.
    expect(res.body.embed.snippet).toContain('data-studio=');
    expect(res.body.embed.snippet).toContain('embed.js');
    expect(res.body.embed.bookingUrl).toMatch(/\/public\/[a-z0-9-]+$/);
    expect(res.body.embed.scriptUrl).toMatch(/\/embed\.js$/);
  });

  it('is readable by any member, not just admins', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );
    await request(app)
      .get(`${studio.base}/page`)
      .set(instructor.headers)
      .expect(200);
  });
});

describe('editing the page content', () => {
  it('saves what the owner writes and returns it back', async () => {
    const res = await request(app)
      .patch(`${studio.base}/page`)
      .set(studio.headers)
      .send({
        tagline: 'Handmade classes in Brooklyn',
        about: 'A neighbourhood studio.\n\nDrop in any Saturday.',
        contactEmail: 'hello@studio.test',
        contactPhone: '(555) 234-5678',
        seoTitle: 'Book pottery in Brooklyn — Clay & Co',
        seoDescription: 'Small-group classes, seven days a week.',
      })
      .expect(200);

    expect(res.body.page.tagline).toBe('Handmade classes in Brooklyn');
    expect(res.body.page.about).toContain('any Saturday');

    // Read it back — the store round-trips and the renderer picks it up.
    const reload = await request(app)
      .get(`${studio.base}/page`)
      .set(studio.headers)
      .expect(200);
    expect(reload.body.page.seoTitle).toBe('Book pottery in Brooklyn — Clay & Co');
  });

  it('treats an empty string as clearing back to the fallback', async () => {
    // Save something, then clear it. The store must land back at null, not
    // at a lone empty string — otherwise a future reader would see "yes there
    // is a tagline, it is nothing" and render a blank line.
    await request(app)
      .patch(`${studio.base}/page`)
      .set(studio.headers)
      .send({ tagline: 'A tagline' })
      .expect(200);

    await request(app)
      .patch(`${studio.base}/page`)
      .set(studio.headers)
      .send({ tagline: '   ' })
      .expect(200);

    const stored = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
      select: { tagline: true },
    });
    expect(stored.tagline).toBeNull();
  });

  it('refuses a tagline longer than the column can carry', async () => {
    await request(app)
      .patch(`${studio.base}/page`)
      .set(studio.headers)
      .send({ tagline: 'x'.repeat(200) })
      .expect(422);
  });

  it('refuses a contact address that is not an email', async () => {
    await request(app)
      .patch(`${studio.base}/page`)
      .set(studio.headers)
      .send({ contactEmail: 'not-an-email' })
      .expect(422);
  });

  it('refuses an instructor', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    await request(app)
      .patch(`${studio.base}/page`)
      .set(instructor.headers)
      .send({ tagline: 'nope' })
      .expect(403);
  });

  it('hides another studio entirely', async () => {
    const stranger = await signUpStudio(app);
    await request(app)
      .patch(`${studio.base}/page`)
      .set(stranger.headers)
      .send({ tagline: 'nope' })
      .expect(404);
  });
});

describe('the copy reaches the booking page', () => {
  /*
    The point of the /page endpoint is what a customer sees. If the fields
    save cleanly and the renderer ignores them, nothing has actually been
    built. This is the assertion that catches that.
  */
  it('overrides the title, tagline and description on /public/{slug}', async () => {
    await request(app)
      .patch(`${studio.base}/page`)
      .set(studio.headers)
      .send({
        tagline: 'Bring a friend',
        seoTitle: 'Pottery in Brooklyn',
        seoDescription: 'A hands-on introduction to the wheel.',
        about: 'Fifteen years of taking people from zero to their first bowl.',
        contactEmail: 'hello@studio.test',
      })
      .expect(200);

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
      select: { slug: true },
    });

    const page = await request(app).get(`/public/${org.slug}`).expect(200);

    expect(page.text).toContain('<title>Pottery in Brooklyn</title>');
    expect(page.text).toContain(
      '<meta name="description" content="A hands-on introduction to the wheel.">',
    );
    // The default sub-heading is replaced by the studio's tagline.
    expect(page.text).toContain('Bring a friend');
    expect(page.text).not.toContain('Choose a class and reserve your place');
    // The about paragraph and the contact address appear.
    expect(page.text).toContain('Fifteen years of taking people');
    expect(page.text).toContain('mailto:hello@studio.test');
  });

  it('falls back to the generic strings when nothing is set', async () => {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
      select: { slug: true, name: true },
    });

    const page = await request(app).get(`/public/${org.slug}`).expect(200);

    // Untouched studio: the pre-B8 wording is what still shows.
    expect(page.text).toContain(`Book a class at ${org.name}`);
    expect(page.text).toContain('Choose a class and reserve your place');
  });
});
