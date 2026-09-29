import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { createSession } from '../../src/scheduling/session.service';

/**
 * Telling a customer where to go (docs/ux-audit-findings.md #14).
 *
 * A kayak tour was booked and nothing said where it left from: not the
 * confirmation, not the manage page, and the email said "Where: Details to
 * follow". Part of it was that the booking was made before its class had a
 * location, and the booking's own copy of the place is written at checkout —
 * so it stayed empty after the class got one.
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

async function bookClass(opts: { meetingPoint?: string; locationId?: string } = {}) {
  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Sunset kayak tour',
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMax: 10,
      priceCents: 4_500,
      ...(opts.meetingPoint ? { meetingPoint: opts.meetingPoint } : {}),
    })
    .expect(201);

  const startsAt = new Date(Date.now() + 10 * 86_400_000);
  const session = await createSession({
    organizationId: studio.organizationId,
    serviceTypeId: service.body.service.id,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
    timezone: 'Europe/London',
    localStartTime: '17:00',
    capacity: 10,
    locationId: opts.locationId ?? null,
  });

  const res = await request(app)
    .post(`/public/${slug}/bookings`)
    .send({
      serviceTypeId: service.body.service.id,
      sessionId: session!.id,
      seats: 1,
      customer: { name: 'Tess Oyelaran', email: 'tess@paddler.test' },
    })
    .expect(201);

  return {
    sessionId: session!.id,
    bookingId: res.body.booking.id as string,
    manageToken: res.body.manageToken as string,
  };
}

const managePage = async (token: string) =>
  (await request(app).get(`/public/bookings/${token}/manage`).expect(200)).text;

const confirmationEmail = async (bookingId: string) => {
  const row = await prisma.notification.findFirstOrThrow({
    where: { bookingId, channel: 'EMAIL' },
    orderBy: { createdAt: 'asc' },
  });
  return (row.payload as { body: string }).body;
};

describe('a booking made before its class had a location', () => {
  it("shows the class's location, with the address, once it has one", async () => {
    const { sessionId, manageToken } = await bookClass();

    // The studio adds its location afterwards, and the class gets it.
    const loc = await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({ name: 'The boathouse', address: 'North pier, gate 3' })
      .expect(201);
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.locationId).toBe(loc.body.location.id);

    const html = await managePage(manageToken);
    expect(html).toContain('The boathouse, North pier, gate 3');
  });
});

describe('the manage page', () => {
  it('says the details are coming when nothing is known yet', async () => {
    const { manageToken } = await bookClass();

    const html = await managePage(manageToken);
    expect(html).toContain('Harbour Kayak Tours will send the details');
  });

  it('gives the meeting point instead, when that is all there is', async () => {
    const { manageToken } = await bookClass({ meetingPoint: 'Blue shed by the slipway' });

    const html = await managePage(manageToken);
    expect(html).toContain('Blue shed by the slipway');
    expect(html).not.toContain('will send the details');
  });

  it('says the status in words', async () => {
    const { manageToken } = await bookClass();

    const html = await managePage(manageToken);
    expect(html).toContain('<span>Confirmed</span>');
    expect(html).not.toContain('<span>CONFIRMED</span>');
  });
});

describe('the confirmation email', () => {
  it('gives the place, the address and the meeting point', async () => {
    const loc = await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({ name: 'The boathouse', address: 'North pier, gate 3' })
      .expect(201);

    const { bookingId } = await bookClass({
      meetingPoint: 'Blue shed by the slipway',
      locationId: loc.body.location.id,
    });

    const body = await confirmationEmail(bookingId);
    expect(body).toContain(
      'Where: The boathouse — North pier, gate 3. Meeting point: Blue shed by the slipway',
    );
  });

  it("uses the class's location when the booking has none of its own", async () => {
    const loc = await request(app)
      .post(`${studio.base}/locations`)
      .set(studio.headers)
      .send({ name: 'The boathouse', address: 'North pier, gate 3' })
      .expect(201);

    // Booked without a location on the booking itself, as a studio with none
    // selected on the page would send it.
    const { bookingId } = await bookClass({ locationId: loc.body.location.id });
    await prisma.booking.update({ where: { id: bookingId }, data: { locationId: null } });

    const { notifyReschedule } = await import(
      '../../src/modules/notifications/notification.service'
    );
    await notifyReschedule(bookingId);

    const latest = await prisma.notification.findFirstOrThrow({
      where: { bookingId, channel: 'EMAIL' },
      orderBy: { createdAt: 'desc' },
    });
    expect((latest.payload as { body: string }).body).toContain(
      'The boathouse — North pier, gate 3',
    );
  });
});
