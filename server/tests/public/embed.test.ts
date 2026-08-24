import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * W2.7 — the embeddable booking widget.
 *
 * Making the booking page embeddable means turning OFF the framing protection
 * that helmet applies to everything. The whole risk of this feature is doing
 * that too widely, so most of what is tested here is what must still refuse to
 * be framed.
 *
 * If somebody later "fixes" a framing complaint by relaxing helmet globally,
 * the clickjacking tests below are what fails.
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

describe('the loader script', () => {
  it('is served as javascript, cross-origin, and briefly cached', async () => {
    const res = await request(app).get('/embed.js');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    // It is fetched from somebody else's website; that is the point of it.
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toContain('max-age');
  });

  /**
   * Found in a browser, not in a header assertion.
   *
   * Helmet defaults `Cross-Origin-Resource-Policy: same-origin`, which blocks
   * this file from loading on anybody else's site. CORS does not cover it: a
   * classic `<script src>` is a no-cors request, so Access-Control-Allow-Origin
   * is never consulted and CORP decides alone. Every header looked right and
   * the widget did not appear.
   */
  it('is not blocked by the default cross-origin resource policy', async () => {
    const res = await request(app).get('/embed.js');

    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('only resizes the frame for messages from our own origin', async () => {
    const res = await request(app).get('/embed.js');

    // Without this check any script on the host page could drive the iframe.
    expect(res.text).toContain('event.origin !== ORIGIN');
    expect(res.text).toContain('artweel:height');
  });

  it('does not mount twice when a studio pastes the snippet twice', async () => {
    const res = await request(app).get('/embed.js');
    expect(res.text).toContain('MOUNTED');
  });

  it('needs no build step and pulls in nothing', async () => {
    const res = await request(app).get('/embed.js');

    // It runs as a guest on somebody else's site. No imports, no framework.
    expect(res.text).not.toContain('import ');
    expect(res.text).not.toContain('require(');
    expect(res.text.length).toBeLessThan(4000);
  });
});

describe('the booking page can be embedded', () => {
  it('permits any site to frame it', async () => {
    const res = await request(app).get(`/public/${slug}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain('frame-ancestors *');
    // X-Frame-Options predates CSP and still wins in some browsers, so
    // relaxing only the CSP would leave the widget broken.
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('reports its height to the host page so the frame can grow', async () => {
    const res = await request(app).get(`/public/${slug}`);

    expect(res.text).toContain('artweel:height');
    // A fixed-height box with its own scrollbar is the sign of a cheap embed.
    expect(res.text).toContain('MutationObserver');
  });

  /**
   * Also found in a browser. Inside an iframe the viewport IS the frame, so
   * `scrollHeight` is bounded below by whatever height the frame was first
   * given — a 900px frame around 683px of content reports 900 forever and the
   * widget can never shrink. Measuring the body's own box tracks the content
   * in both directions.
   */
  it('measures the content box, not scrollHeight', async () => {
    const res = await request(app).get(`/public/${slug}`);

    expect(res.text).toContain('getBoundingClientRect');
    expect(res.text).not.toContain('document.body.scrollHeight');
  });

  it('keeps the rest of its content security policy intact', async () => {
    const res = await request(app).get(`/public/${slug}`);
    const csp = res.headers['content-security-policy'];

    // Only framing was relaxed. Everything else still holds.
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
  });
});

/**
 * B8 gave the widget its own booking source, so the dashboard donut can
 * separate a booking placed on the studio's own page from one placed through
 * an iframe on somebody else's site. Before B8 both wrote `web`, and the
 * dashboard rendered a caveat explaining that the two shares were hidden
 * inside one slice; that caveat is now null.
 */
describe('a booking placed through the widget is attributed to the widget', () => {
  it('writes source = embed when the request says so', async () => {
    // Set up the smallest possible bookable class so a POST /bookings goes
    // all the way through.
    const service = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Handbuilding',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 4,
        priceCents: 5000,
      })
      .expect(201);

    const { createSession } = await import(
      '../../src/scheduling/session.service'
    );
    const session = await createSession({
      organizationId: studio.organizationId,
      serviceTypeId: service.body.service.id,
      startsAt: new Date('2026-10-01T18:00:00Z'),
      endsAt: new Date('2026-10-01T20:00:00Z'),
      timezone: 'America/New_York',
      localStartTime: '14:00',
      capacity: 4,
    });

    await request(app)
      .post(`/public/${slug}/bookings`)
      .send({
        serviceTypeId: service.body.service.id,
        sessionId: session.id,
        seats: 1,
        customer: { name: 'Ada', email: 'ada@student.test' },
        source: 'embed',
      })
      .expect(201);

    const stored = await prisma.booking.findFirstOrThrow({
      where: { organizationId: studio.organizationId },
      select: { source: true },
    });
    expect(stored.source).toBe('embed');
  });

  it('refuses a source the whitelist does not know about', async () => {
    // Free-form would let a caller invent its own channel and end up as a
    // slice nobody recognises on somebody else's dashboard.
    const service = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Handbuilding',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 4,
        priceCents: 5000,
      })
      .expect(201);

    const { createSession } = await import(
      '../../src/scheduling/session.service'
    );
    const session = await createSession({
      organizationId: studio.organizationId,
      serviceTypeId: service.body.service.id,
      startsAt: new Date('2026-10-01T18:00:00Z'),
      endsAt: new Date('2026-10-01T20:00:00Z'),
      timezone: 'America/New_York',
      localStartTime: '14:00',
      capacity: 4,
    });

    await request(app)
      .post(`/public/${slug}/bookings`)
      .send({
        serviceTypeId: service.body.service.id,
        sessionId: session.id,
        seats: 1,
        customer: { name: 'Ada', email: 'ada@student.test' },
        source: 'sneaky',
      })
      .expect(422);
  });

  it('has a client that reads ?embed=1 and posts source = embed', async () => {
    /*
      The loader appends `?embed=1` when it mounts the iframe. The booking
      page reads that once at startup and sends it back with the booking
      POST. This test asserts the wiring rather than the header alone: the
      constant, the read of location.search, and the field in the body all
      have to line up for the widget slice to appear on the dashboard.
    */
    const res = await request(app).get(`/public/${slug}`);

    expect(res.text).toContain('IS_EMBED');
    expect(res.text).toContain("embed=1");
    expect(res.text).toContain('BOOKING_SOURCE');
    expect(res.text).toContain('source: BOOKING_SOURCE');
  });
});

/**
 * THE GUARD. Everything below must refuse to be framed, forever.
 */
describe('everything else refuses to be framed', () => {
  it('will not let the API be framed', async () => {
    const res = await request(app)
      .get(`${studio.base}/sessions?from=2026-08-01&to=2026-08-02`)
      .set(studio.headers);

    expect(res.headers['content-security-policy']).toContain(
      "frame-ancestors 'self'",
    );
    expect(res.headers['content-security-policy']).not.toContain(
      'frame-ancestors *',
    );
  });

  it('will not let the marketing site be framed', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain(
      "frame-ancestors 'self'",
    );
  });

  it('will not let an authenticated endpoint be framed', async () => {
    // A framable dashboard is a clickjacking target: an attacker overlays an
    // invisible copy and a studio owner clicks something they cannot see.
    const res = await request(app)
      .get(`${studio.base}/courses`)
      .set(studio.headers);

    expect(res.headers['content-security-policy']).not.toContain(
      'frame-ancestors *',
    );
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('will not let the webhook endpoint be framed', async () => {
    const res = await request(app).post('/webhooks/stripe').send({});

    expect(res.headers['content-security-policy']).not.toContain(
      'frame-ancestors *',
    );
  });
});
