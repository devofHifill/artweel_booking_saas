import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { ALL_PAGES, COMING_SOON } from '../../src/modules/marketing/content';

/**
 * The marketing site.
 *
 * Two things are being protected here. First, technical SEO — a landing page
 * with a missing canonical or a duplicated title is invisible, and nothing
 * about the product matters if nobody arrives. Second, honesty: the copy must
 * never describe a feature that does not ship, because a trial that starts on
 * a false promise churns in week one.
 */

const app = createApp();

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

describe('pages', () => {
  it('serves the home page as real HTML', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('<h1>Booking software built for pottery studios');
    // Content in the first response, not an empty div for a bundle to fill.
    expect(res.text).toContain('Eight wheels means eight students');
  });

  it('serves every declared page', async () => {
    for (const page of ALL_PAGES) {
      const res = await request(app).get(`/${page.slug}`);
      expect(res.status, `page /${page.slug}`).toBe(200);
      expect(res.text).toContain(page.h1);
    }
  });

  it('404s an unknown path rather than answering 200 for everything', async () => {
    // A site that returns 200 for any URL teaches a crawler that none of its
    // URLs are meaningful.
    const res = await request(app).get('/not-a-real-page');
    expect(res.status).toBe(404);
  });

  it('does not shadow the API or the booking pages', async () => {
    // The marketing router owns the root and matches two path segments, so
    // this is the regression worth guarding.
    const studio = await signUpStudio(app);

    const api = await request(app)
      .get(`${studio.base}/services`)
      .set(studio.headers);
    expect(api.status).toBe(200);

    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);

    const unknownStudio = await request(app).get('/public/no-such-studio');
    expect(unknownStudio.status).toBe(404);
  });
});

describe('the way in', () => {
  /**
   * Every "Sign in" and "Start free" link points at /app, so this redirect is
   * the entire self-serve funnel. It was hardcoded to localhost:5173 and
   * shipped that way to staging, where it sent visitors to their own machine
   * and broke nothing any health check could see.
   */
  it('sends people to the dashboard, wherever that is', async () => {
    const { config } = await import('../../src/config');

    const res = await request(app).get('/app');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(config.APP_URL);
    // The bug: a literal that ignores configuration entirely.
    expect(res.headers.location).not.toBe('http://localhost:5173');
  });

  it('carries the signup flag through', async () => {
    const { config } = await import('../../src/config');

    const res = await request(app).get('/app?signup=1');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${config.APP_URL}?signup=1`);
  });
});

describe('technical SEO', () => {
  it('gives every page a unique title and description', async () => {
    // Duplicated metadata is one of the few things that reliably suppresses a
    // whole set of pages.
    const titles = new Set<string>();
    const descriptions = new Set<string>();

    for (const page of ALL_PAGES) {
      expect(page.title.length, page.slug).toBeGreaterThan(15);
      // Google truncates beyond roughly 155 characters.
      expect(page.description.length, page.slug).toBeLessThanOrEqual(165);

      titles.add(page.title);
      descriptions.add(page.description);
    }

    expect(titles.size).toBe(ALL_PAGES.length);
    expect(descriptions.size).toBe(ALL_PAGES.length);
  });

  it('emits a canonical URL on every page', async () => {
    for (const page of ALL_PAGES) {
      const res = await request(app).get(`/${page.slug}`);
      expect(res.text, page.slug).toContain('rel="canonical"');
    }
  });

  it('marks up FAQs so a result can occupy more of the page', async () => {
    const res = await request(app).get('/');

    expect(res.text).toContain('"@type":"FAQPage"');
    expect(res.text).toContain('Do you take a cut of my bookings?');
  });

  it('marks up guides as articles', async () => {
    const res = await request(app).get('/guides/pricing-mobile-pottery-parties');

    expect(res.text).toContain('"@type":"Article"');
    expect(res.text).toContain('datePublished');
  });

  it('emits structured data that is valid JSON and cannot break out', async () => {
    /**
     * The failure this guards is the one already caught on the booking page:
     * a `<` inside a JSON-LD block can close the script element early and
     * turn the rest of the payload into markup.
     *
     * Parsing every block is the meaningful assertion — an escaping mistake
     * either produces invalid JSON or a stray `</script>`, and this catches
     * both without depending on today's copy containing an angle bracket.
     */
    for (const page of ALL_PAGES) {
      const res = await request(app).get(`/${page.slug}`);

      const blocks = [
        ...res.text.matchAll(
          /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
        ),
      ].map((match) => match[1]!);

      for (const block of blocks) {
        expect(() => JSON.parse(block), page.slug).not.toThrow();
        expect(block, page.slug).not.toContain('</script');
      }
    }
  });

  it('publishes a sitemap listing every page', async () => {
    const res = await request(app).get('/sitemap.xml');

    expect(res.status).toBe(200);
    expect(res.type).toContain('xml');

    for (const page of ALL_PAGES) {
      const expected = page.slug ? `/${page.slug}<` : '';
      if (expected) expect(res.text).toContain(expected);
    }
  });

  it('keeps booking-management links out of the index', async () => {
    // The token in that URL is the credential.
    const res = await request(app).get('/robots.txt');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Disallow: /public/bookings/');
    // But a studio's own booking page SHOULD be indexed — it is how their
    // customers find them.
    expect(res.text).toContain('Allow: /public/');
    expect(res.text).toContain('Sitemap:');
  });

  it('needs no JavaScript to show its content', async () => {
    // The visitor is on a phone on mobile data, and the crawler decides
    // whether anyone ever sees this.
    const res = await request(app).get('/pricing');

    const withoutJsonLd = res.text.replace(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
      '',
    );
    expect(withoutJsonLd).not.toContain('<script');
    expect(res.text).toContain('$39');
  });
});

describe('honesty of the copy', () => {
  it('labels unbuilt features as coming, not as shipping', async () => {
    // A trial that starts on a false promise churns in week one.
    const res = await request(app).get('/');

    expect(res.text).toContain('Being built next');
    expect(res.text).toContain('Not available yet');

    for (const item of COMING_SOON) {
      expect(res.text).toContain(item.slice(0, 30));
    }
  });

  it('does not claim piece tracking or courses anywhere as shipping', async () => {
    // These are Phase 2. They may only appear under the "being built" heading.
    for (const page of ALL_PAGES) {
      const shippingCopy = [
        page.intro,
        ...page.sections.flatMap((s) => s.body),
        ...(page.faqs?.map((f) => f.a) ?? []),
      ].join(' ');

      expect(shippingCopy, page.slug).not.toMatch(/piece tracking/i);
      expect(shippingCopy, page.slug).not.toMatch(/make-?up class/i);
      expect(shippingCopy, page.slug).not.toMatch(/waitlist/i);
    }
  });

  it('is fair about what competitors do well', async () => {
    // A page that only attacks is not believable, and a studio that switches
    // on a false promise churns anyway.
    const res = await request(app).get('/alternatives/momence');

    expect(res.text).toContain('What Momence does well');
    expect(res.text).toContain('we would not pretend otherwise');
  });

  it('states the pricing promise on the pricing page', async () => {
    const res = await request(app).get('/pricing');

    expect(res.text).toContain('No commission');
    expect(res.text).toContain('$39');
    expect(res.text).toContain('$89');
    expect(res.text).toContain('$189');
  });
});

describe('analytics', () => {
  it('counts a page view without storing anything about the person', async () => {
    await request(app).get('/');

    // Fire-and-forget write; give it a moment.
    await new Promise((r) => setTimeout(r, 250));

    const rows = await prisma.marketingEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.path).toBe('/');
    expect(rows[0]!.views).toBe(1);

    // No cookie was set, and nothing identifies a visitor.
    const res = await request(app).get('/');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('increments rather than inserting a row per view', async () => {
    // The reason referrerHost and source are '' and not NULL: Postgres treats
    // NULLs as distinct in a unique index, so nullable columns here would make
    // every direct visit its own row.
    for (let i = 0; i < 4; i++) await request(app).get('/pricing');
    await new Promise((r) => setTimeout(r, 400));

    const rows = await prisma.marketingEvent.findMany({
      where: { path: '/pricing' },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.views).toBe(4);
  });

  it('records only the referrer host, never the full URL', async () => {
    // A full referrer can carry a search query or a private page title.
    await request(app)
      .get('/')
      .set('referer', 'https://www.google.com/search?q=secret+personal+thing');

    await new Promise((r) => setTimeout(r, 250));

    const row = await prisma.marketingEvent.findFirstOrThrow({});
    expect(row.referrerHost).toBe('www.google.com');
    expect(JSON.stringify(row)).not.toContain('secret');
  });

  it('attributes a signup to the page that introduced them', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'mira@wildflower.test',
      password: 'thrown-bowl-glaze-77',
      name: 'Mira Chen',
      organizationName: 'Wildflower Ceramics',
      signupSource: 'google',
      signupReferrer: 'www.google.com',
      signupLanding: '/guides/pricing-mobile-pottery-parties',
    });

    expect(res.status).toBe(201);

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: res.body.organization.id },
    });
    expect(org.signupSource).toBe('google');
    expect(org.signupLanding).toBe('/guides/pricing-mobile-pottery-parties');
  });

  it('never lets a broken attribution value block a signup', async () => {
    // It is a hint for our own reporting. Nothing depends on it.
    const res = await request(app).post('/api/auth/register').send({
      email: 'someone@studio.test',
      password: 'thrown-bowl-glaze-77',
      name: 'Someone',
      organizationName: 'Some Studio',
      signupSource: 'x'.repeat(500),
    });

    // Rejected by validation rather than accepted silently, and the message
    // points at the field.
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].field).toBe('signupSource');
  });

  it('reports which pages brought people in', async () => {
    const studio = await signUpStudio(app);

    await request(app).get('/');
    await request(app).get('/pricing');
    await request(app).get('/pricing');
    await new Promise((r) => setTimeout(r, 400));

    const res = await request(app)
      .get(`${studio.base}/traffic`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    const pricing = res.body.pages.find(
      (p: { path: string }) => p.path === '/pricing',
    );
    expect(pricing.views).toBe(2);
  });
});
