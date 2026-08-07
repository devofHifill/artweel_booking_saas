import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * The public booking flow.
 *
 * This is the only surface an unauthenticated stranger can reach, so the tests
 * lean on two questions: does a customer get through end to end, and does
 * anything leak or break when the request is hostile or the page is stale.
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
  // The limiter is process-wide, so counters would otherwise bleed between
  // cases and fail whichever test happened to run last.
  resetRateLimits();

  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: studio.organizationId },
  });
  slug = org.slug;
});

async function makeClass(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Beginner Wheel Throwing',
      description: 'Three hours at the wheel. Clay and firing included.',
      bookingMode: 'EVENT',
      durationMinutes: 180,
      capacityMax: 8,
      priceCents: 9500,
      ...overrides,
    });
  return res.body.service;
}

async function makeSession(serviceTypeId: string, capacity = 8) {
  const { createSession } = await import('../../src/scheduling/session.service');
  return createSession({
    organizationId: studio.organizationId,
    serviceTypeId,
    startsAt: new Date('2026-09-15T18:00:00Z'),
    endsAt: new Date('2026-09-15T21:00:00Z'),
    timezone: 'America/New_York',
    localStartTime: '14:00',
    capacity,
  });
}

describe('the booking page', () => {
  it('server-renders the studio and its classes', async () => {
    await makeClass();

    const res = await request(app).get(`/public/${slug}`);

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    // Real HTML in the first response, not an empty div for a bundle to fill.
    expect(res.text).toContain('Clay &amp; Co');
    expect(res.text).toContain('Beginner Wheel Throwing');
    expect(res.text).toContain('$95');
    expect(res.text).toContain('3 hr');
  });

  it('emits JSON-LD so a search result can show the price', async () => {
    await makeClass();
    const res = await request(app).get(`/public/${slug}`);

    expect(res.text).toContain('application/ld+json');
    expect(res.text).toContain('"@type":"LocalBusiness"');
    expect(res.text).toContain('"price":"95.00"');
  });

  it('escapes studio content rather than trusting it', async () => {
    // A studio owner is not an attacker, but their copy still lands in HTML.
    const evil = await signUpStudio(app, {
      organizationName: '<script>alert(1)</script>',
    });
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: evil.organizationId },
    });

    const res = await request(app).get(`/public/${org.slug}`);

    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });

  it('returns 404 for an unknown studio', async () => {
    expect((await request(app).get('/public/no-such-studio')).status).toBe(404);
  });

  it('hides inactive services from the public page', async () => {
    const service = await makeClass();
    await request(app)
      .patch(`${studio.base}/services/${service.id}`)
      .set(studio.headers)
      .send({ isActive: false });

    const res = await request(app).get(`/public/${slug}/data`);
    expect(res.body.services).toHaveLength(0);
  });
});

describe('what the public API exposes', () => {
  it('never publishes staff contact details', async () => {
    const service = await makeClass();
    const staff = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Rowan Pike', email: 'rowan@clay.test', phone: '+15551234567' });

    await request(app)
      .put(`${studio.base}/services/${service.id}/staff`)
      .set(studio.headers)
      .send({ staffIds: [staff.body.staff.id] });

    const res = await request(app).get(
      `/public/${slug}/services/${service.id}/staff`,
    );

    expect(res.body.staff[0].name).toBe('Rowan Pike');
    expect(res.body.staff[0].email).toBeUndefined();
    expect(res.body.staff[0].phone).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('rowan@clay.test');
  });

  it('omits instructors the studio has marked private', async () => {
    const service = await makeClass();
    const hidden = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Back Office', email: 'admin@clay.test', isPublic: false });

    await request(app)
      .put(`${studio.base}/services/${service.id}/staff`)
      .set(studio.headers)
      .send({ staffIds: [hidden.body.staff.id] });

    const res = await request(app).get(
      `/public/${slug}/services/${service.id}/staff`,
    );
    expect(res.body.staff).toHaveLength(0);
  });

  it('does not publish a mobile service area centre point', async () => {
    // That coordinate is frequently the owner's home address.
    await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({
        name: 'Mobile parties',
        locationType: 'SERVICE_AREA',
        lat: 40.6782,
        lng: -73.9442,
        radiusMeters: 25_000,
      });

    const res = await request(app).get(`/public/${slug}/data`);
    const mobile = res.body.locations.find(
      (l: { locationType: string }) => l.locationType === 'SERVICE_AREA',
    );

    expect(mobile.requiresAddress).toBe(true);
    expect(mobile.lat).toBeNull();
    expect(mobile.lng).toBeNull();
  });

  it('answers coverage without revealing the exact distance', async () => {
    // Returning a distance lets three requests trilaterate the centre point.
    const location = await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({
        name: 'Mobile parties',
        locationType: 'SERVICE_AREA',
        lat: 40.6782,
        lng: -73.9442,
        radiusMeters: 25_000,
        travelFeeBands: [{ maxKm: 10, feeCents: 2500 }],
      });

    const res = await request(app)
      .post(`/public/${slug}/coverage`)
      .send({ locationId: location.body.location.id, lat: 40.7128, lng: -74.006 });

    expect(res.body.covered).toBe(true);
    expect(res.body.travelFeeCents).toBe(2500);
    expect(res.body.distanceKm).toBeUndefined();
  });
});

describe('booking a class', () => {
  it('books a seat and returns a management token', async () => {
    const service = await makeClass();
    const session = await makeSession(service.id);

    const res = await request(app)
      .post(`/public/${slug}/bookings`)
      .send({
        serviceTypeId: service.id,
        sessionId: session.id,
        seats: 2,
        customer: { name: 'Ada Potter', email: 'ada@student.test' },
        smsConsent: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.booking.seats).toBe(2);
    expect(res.body.booking.totalCents).toBe(19_000);
    // 32 random bytes, base64url — not a guessable hash of the email.
    expect(res.body.manageToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const customer = await prisma.customer.findFirstOrThrow({
      where: { organizationId: studio.organizationId },
    });
    expect(customer.smsConsentAt).not.toBeNull();
  });

  it('reuses the customer record for a repeat booking', async () => {
    const service = await makeClass();
    const session = await makeSession(service.id);

    for (let i = 0; i < 2; i++) {
      await request(app)
        .post(`/public/${slug}/bookings`)
        .send({
          serviceTypeId: service.id,
          sessionId: session.id,
          seats: 1,
          customer: { name: 'Ada Potter', email: 'ADA@student.test' },
        });
    }

    const customers = await prisma.customer.count({
      where: { organizationId: studio.organizationId },
    });
    expect(customers).toBe(1);
  });

  it('keeps customers of different studios separate', async () => {
    // The plugin deduped globally, which leaked one studio's list into another.
    const service = await makeClass();
    const session = await makeSession(service.id);

    const other = await signUpStudio(app);
    const otherOrg = await prisma.organization.findUniqueOrThrow({
      where: { id: other.organizationId },
    });
    const otherService = await request(app)
      .post(`${other.base}/services`)
      .set(other.headers)
      .send({
        name: 'Handbuilding',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 6,
        priceCents: 6000,
      });

    const { createSession } = await import('../../src/scheduling/session.service');
    const otherSession = await createSession({
      organizationId: other.organizationId,
      serviceTypeId: otherService.body.service.id,
      startsAt: new Date('2026-09-16T18:00:00Z'),
      endsAt: new Date('2026-09-16T20:00:00Z'),
      timezone: 'America/New_York',
      localStartTime: '14:00',
      capacity: 6,
    });

    const customer = { name: 'Ada Potter', email: 'ada@student.test' };

    await request(app).post(`/public/${slug}/bookings`).send({
      serviceTypeId: service.id,
      sessionId: session.id,
      customer,
    });
    await request(app).post(`/public/${otherOrg.slug}/bookings`).send({
      serviceTypeId: otherService.body.service.id,
      sessionId: otherSession.id,
      customer,
    });

    expect(
      await prisma.customer.count({ where: { organizationId: studio.organizationId } }),
    ).toBe(1);
    expect(
      await prisma.customer.count({ where: { organizationId: other.organizationId } }),
    ).toBe(1);
  });

  it('refuses a session belonging to another studio', async () => {
    const other = await signUpStudio(app);
    const theirService = await request(app)
      .post(`${other.base}/services`)
      .set(other.headers)
      .send({
        name: 'Handbuilding',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 6,
      });

    const service = await makeClass();

    const res = await request(app)
      .post(`/public/${slug}/bookings`)
      .send({
        serviceTypeId: theirService.body.service.id,
        sessionId: 'bfe1d7f0-0000-4000-8000-000000000000',
        customer: { name: 'Mallory', email: 'm@x.test' },
      });

    // The service belongs to another studio, so this slug cannot see it.
    expect(res.status).toBe(404);
    expect(service).toBeTruthy();
  });

  it('reports a full class in words a customer can act on', async () => {
    const service = await makeClass();
    const session = await makeSession(service.id, 1);

    await request(app).post(`/public/${slug}/bookings`).send({
      serviceTypeId: service.id,
      sessionId: session.id,
      customer: { name: 'First', email: 'first@student.test' },
    });

    const res = await request(app).post(`/public/${slug}/bookings`).send({
      serviceTypeId: service.id,
      sessionId: session.id,
      customer: { name: 'Second', email: 'second@student.test' },
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_FULL');
    expect(res.body.error.message).toBe('This class is now full.');
  });
});

describe('booking an appointment', () => {
  async function setupAppointment() {
    const service = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Private Wheel Lesson',
        bookingMode: 'APPOINTMENT',
        durationMinutes: 60,
        slotGranularityMinutes: 60,
        capacityMax: 1,
        priceCents: 12_000,
      });

    const staff = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Rowan Pike', email: 'rowan@clay.test' });

    await request(app)
      .put(`${studio.base}/services/${service.body.service.id}/staff`)
      .set(studio.headers)
      .send({ staffIds: [staff.body.staff.id] });

    await request(app)
      .post(`${studio.base}/schedules/${staff.body.staff.id}/rules`)
      .set(studio.headers)
      .send({
        ruleType: 'WORKING',
        rrule: 'FREQ=DAILY',
        startMinute: 9 * 60,
        endMinute: 17 * 60,
        effectiveFrom: '2026-01-01T00:00:00Z',
      });

    return { serviceId: service.body.service.id, staffId: staff.body.staff.id };
  }

  it('offers slots and books one', async () => {
    const { serviceId, staffId } = await setupAppointment();

    const tomorrow = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const availability = await request(app).get(
      `/public/${slug}/availability?serviceTypeId=${serviceId}&from=${tomorrow}&to=${tomorrow}`,
    );

    expect(availability.status).toBe(200);
    expect(availability.body.mode).toBe('APPOINTMENT');
    expect(availability.body.slots.length).toBeGreaterThan(0);

    const slot = availability.body.slots[0];
    const res = await request(app)
      .post(`/public/${slug}/bookings`)
      .send({
        serviceTypeId: serviceId,
        staffId: slot.staffId,
        startsAt: slot.startsAt,
        customer: { name: 'Ada Potter', email: 'ada@student.test' },
      });

    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe('CONFIRMED');
    expect(staffId).toBeTruthy();
  });

  it('rejects a slot the page thought was free but is not', async () => {
    // The page may have been open for an hour. The exclusion constraint would
    // catch it regardless, but a customer deserves a sentence, not a 500.
    const { serviceId } = await setupAppointment();
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

    const availability = await request(app).get(
      `/public/${slug}/availability?serviceTypeId=${serviceId}&from=${day}&to=${day}`,
    );
    const slot = availability.body.slots[0];

    await request(app).post(`/public/${slug}/bookings`).send({
      serviceTypeId: serviceId,
      staffId: slot.staffId,
      startsAt: slot.startsAt,
      customer: { name: 'First', email: 'first@student.test' },
    });

    const stale = await request(app).post(`/public/${slug}/bookings`).send({
      serviceTypeId: serviceId,
      staffId: slot.staffId,
      startsAt: slot.startsAt,
      customer: { name: 'Second', email: 'second@student.test' },
    });

    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toContain('no longer available');
  });
});

describe('managing a booking by token', () => {
  async function bookOne() {
    const service = await makeClass();
    const session = await makeSession(service.id);

    const res = await request(app).post(`/public/${slug}/bookings`).send({
      serviceTypeId: service.id,
      sessionId: session.id,
      seats: 1,
      customer: { name: 'Ada Potter', email: 'ada@student.test' },
    });

    return { token: res.body.manageToken as string, sessionId: session.id };
  }

  it('shows the booking and what cancelling would refund', async () => {
    const { token } = await bookOne();

    const res = await request(app).get(`/public/bookings/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.booking.service).toBe('Beginner Wheel Throwing');
    expect(res.body.booking.studio).toBe('Clay & Co');
  });

  it('renders a manage page that search engines must not index', async () => {
    // The token in the URL is the credential.
    const { token } = await bookOne();

    const res = await request(app).get(`/public/bookings/${token}/manage`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('noindex,nofollow');
  });

  it('cancels, returns the seat, and is safe to click twice', async () => {
    const { token, sessionId } = await bookOne();

    expect((await request(app).post(`/public/bookings/${token}/cancel`)).status).toBe(200);

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(0);

    const second = await request(app).post(`/public/bookings/${token}/cancel`);
    expect(second.status).toBe(200);
    expect(second.body.alreadyCancelled).toBe(true);
  });

  it('rejects a malformed or unknown token', async () => {
    expect((await request(app).get('/public/bookings/nonsense')).status).toBe(404);

    const wellFormedButWrong = Buffer.alloc(32, 7).toString('base64url');
    expect(
      (await request(app).get(`/public/bookings/${wellFormedButWrong}`)).status,
    ).toBe(404);
  });
});

describe('rate limiting', () => {
  it('throttles repeated booking attempts from one address', async () => {
    // The only unauthenticated write in the system.
    const service = await makeClass();
    const session = await makeSession(service.id);

    let limited = false;
    for (let i = 0; i < 14; i++) {
      const res = await request(app)
        .post(`/public/${slug}/bookings`)
        .send({
          serviceTypeId: service.id,
          sessionId: session.id,
          customer: { name: `Person ${i}`, email: `p${i}@student.test` },
        });
      if (res.status === 429) {
        expect(res.body.error.code).toBe('RATE_LIMITED');
        limited = true;
        break;
      }
    }

    expect(limited).toBe(true);
  });
});
