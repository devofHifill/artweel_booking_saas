import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { buildIcs } from '../../src/modules/public/ics';

/**
 * G5 — a reference to quote, and a file to keep.
 *
 * A booking had no short handle: the uuid is unreadable and cancel_token is a
 * credential. And nothing in the product emitted a calendar file, so "add to
 * calendar" existed only in the prototype.
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

async function book(overrides: Record<string, unknown> = {}) {
  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Beginner Wheel Throwing',
      bookingMode: 'EVENT',
      durationMinutes: 180,
      capacityMax: 8,
      priceCents: 9_500,
      preparationNotes: 'Short nails, closed shoes.',
      ...overrides,
    })
    .expect(201);

  const { createSession } = await import('../../src/scheduling/session.service');
  const session = await createSession({
    organizationId: studio.organizationId,
    serviceTypeId: service.body.service.id,
    startsAt: new Date('2026-09-15T18:00:00Z'),
    endsAt: new Date('2026-09-15T21:00:00Z'),
    timezone: 'America/New_York',
    localStartTime: '14:00',
    capacity: 8,
  });

  const res = await request(app)
    .post(`/public/${slug}/bookings`)
    .send({
      serviceTypeId: service.body.service.id,
      sessionId: session.id,
      seats: 1,
      customer: { name: 'Tess Oyelaran', email: 'tess@student.test' },
    })
    .expect(201);

  return res.body as {
    booking: { id: string; reference: string };
    manageToken: string;
  };
}

describe('the booking reference', () => {
  it('is generated for every booking without the app writing it', async () => {
    const { booking } = await book();

    expect(booking.reference).toMatch(/^[0-9A-F]{8}$/);
  });

  it('uses an alphabet with no letter that can be misread as a digit', async () => {
    /*
      Hex, uppercased: 0-9A-F. It contains no O, I or L, which is the whole
      reason 0 and 1 are safe to read down a telephone here.
    */
    const { booking } = await book();

    expect(booking.reference).not.toMatch(/[OIL]/);
  });

  it('cannot be written, so it can never drift from the booking', async () => {
    const { booking } = await book();

    // GENERATED ALWAYS. Postgres refuses, which is the guardrail that keeps
    // this derived rather than becoming a second identity for the row.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE bookings SET reference = 'HACKED' WHERE id = '${booking.id}'`,
      ),
    ).rejects.toThrow();
  });

  it('is not the cancel token, and does not leak it', async () => {
    const { booking, manageToken } = await book();

    expect(booking.reference).not.toBe(manageToken);
    expect(manageToken).not.toContain(booking.reference);

    const page = await request(app)
      .get(`/public/bookings/${manageToken}/manage`)
      .expect(200);

    // The reference is printed; the raw token bytes are never rendered as
    // anything but the URL the customer already holds.
    expect(page.text).toContain(booking.reference);
  });
});

describe('the calendar file', () => {
  it('serves a booking as a valid VEVENT', async () => {
    const { booking, manageToken } = await book();

    const res = await request(app)
      .get(`/public/bookings/${manageToken}/calendar.ics`)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.headers['content-disposition']).toContain(
      `${booking.reference}.ics`,
    );

    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('BEGIN:VEVENT');
    expect(res.text).toContain('DTSTART:20260915T180000Z');
    expect(res.text).toContain('DTEND:20260915T210000Z');
    expect(res.text).toContain('END:VCALENDAR');

    // CRLF throughout. Outlook is the one that minds.
    expect(res.text.split('\n').every((l) => l === '' || l.endsWith('\r'))).toBe(
      true,
    );
  });

  it('puts the booking id in the UID, never the token', async () => {
    const { booking, manageToken } = await book();

    const res = await request(app)
      .get(`/public/bookings/${manageToken}/calendar.ics`)
      .expect(200);

    /*
      A UID is written into the reader's calendar and may sync onward to other
      devices and services. The token is a credential and has no business
      travelling with it.
    */
    expect(res.text).toContain(`UID:booking-${booking.id}@artweel`);
    expect(res.text).not.toContain(manageToken);
  });

  it('refuses a token that is not a booking', async () => {
    await request(app)
      .get('/public/bookings/not-a-real-token/calendar.ics')
      .expect(404);
  });
});

describe('the ics writer', () => {
  it('escapes the characters that would otherwise end a property', async () => {
    const ics = buildIcs({
      uid: 'x@artweel',
      startsAt: new Date('2026-09-15T18:00:00Z'),
      endsAt: new Date('2026-09-15T19:00:00Z'),
      title: 'Wheel; throwing, for beginners\\here',
      description: 'One line\nAnother line',
    });

    expect(ics).toContain('SUMMARY:Wheel\\; throwing\\, for beginners\\\\here');
    // A raw newline would end the property and produce a file most calendars
    // reject outright.
    expect(ics).toContain('DESCRIPTION:One line\\nAnother line');
  });

  it('folds long lines without splitting a multi-byte character', async () => {
    const ics = buildIcs({
      uid: 'x@artweel',
      startsAt: new Date('2026-09-15T18:00:00Z'),
      endsAt: new Date('2026-09-15T19:00:00Z'),
      // Accented throughout, so every fold point lands near a two-byte char.
      title: 'Café Céramique — '.repeat(12),
    });

    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }

    // Unfolding restores the original exactly — no character was cut in half.
    const unfolded = ics.replace(/\r\n[ \t]/g, '');
    expect(unfolded).toContain('Café Céramique');
    expect(unfolded).not.toContain('�');
  });
});

describe('the manage page', () => {
  it('shows what to bring, which is where somebody actually reads it', async () => {
    const { manageToken } = await book();

    const res = await request(app)
      .get(`/public/bookings/${manageToken}/manage`)
      .expect(200);

    expect(res.text).toContain('Before you come');
    expect(res.text).toContain('Short nails, closed shoes.');
    expect(res.text).toContain('calendar.ics');
  });

  it('keeps the controls off a printed copy', async () => {
    const { manageToken } = await book();

    const res = await request(app)
      .get(`/public/bookings/${manageToken}/manage`)
      .expect(200);

    expect(res.text).toContain('@media print');
    // A printed booking is somebody's paper copy: buttons print as empty
    // rectangles, so both the actions and the cancel control are excluded.
    expect(res.text).toMatch(/class="primary no-print" id="cancel"/);
    expect(res.text).toMatch(/class="row-actions no-print"/);
  });
});
