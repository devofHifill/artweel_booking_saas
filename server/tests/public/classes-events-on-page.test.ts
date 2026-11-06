import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * CLASS-EVENT-PLAN.md, Stage 6 — Classes and Events have their own sections
 * on the booking page, events lead with their date, and both leave the page
 * once they are over.
 */

const app = createApp();
let studio: Studio;
let slug: string;

/** Fixed dates in 2027, so the suite does not depend on today. */
const event = (overrides: Record<string, unknown> = {}) => ({
  name: 'Valentine Date Night',
  date: '2027-02-12',
  startTime: '18:30',
  endTime: '21:00',
  seats: 12,
  priceCents: 8500,
  ...overrides,
});

const klass = (overrides: Record<string, unknown> = {}) => ({
  name: 'Beginner Wheel',
  startDate: '2027-03-01',
  weekdays: ['TU'],
  startTime: '18:00',
  endTime: '20:00',
  sessionCount: 4,
  seats: 8,
  priceCents: 32000,
  ...overrides,
});

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

/** The text of one <section>, by id, or null when the page has none. */
function section(html: string, id: string): string | null {
  const match = new RegExp(`<section id="${id}">([\\s\\S]*?)</section>`).exec(html);
  return match ? match[1]! : null;
}

async function page() {
  return (await request(app).get(`/public/${slug}/book`).expect(200)).text;
}

describe('Classes and Events on the booking page', () => {
  it('puts each in its own section, events with their date', async () => {
    await request(app).post(`${studio.base}/activities/events`).set(studio.headers).send(event()).expect(201);
    await request(app).post(`${studio.base}/activities/classes`).set(studio.headers).send(klass()).expect(201);

    const html = await page();

    const events = section(html, 'step-events');
    expect(events).toContain('<h2>Events</h2>');
    expect(events).toContain('Valentine Date Night');
    // 18:30 in New York, the studio's zone.
    expect(events).toContain('Fri 12 Feb, 6:30pm');

    const classes = section(html, 'step-classes');
    expect(classes).toContain('<h2>Classes</h2>');
    expect(classes).toContain('Beginner Wheel');
    expect(classes).toContain('4 sessions');
    expect(classes).toContain('$320');

    // Neither is repeated under the older headings.
    expect(section(html, 'step-course')).toBeNull();
    expect(section(html, 'step-service')).not.toContain('Valentine Date Night');
  });

  it('lists events soonest first', async () => {
    await request(app).post(`${studio.base}/activities/events`).set(studio.headers)
      .send(event({ name: 'Spring Raku', date: '2027-04-10' })).expect(201);
    await request(app).post(`${studio.base}/activities/events`).set(studio.headers)
      .send(event({ name: 'Winter Glaze', date: '2027-01-20' })).expect(201);

    const events = section(await page(), 'step-events')!;
    expect(events.indexOf('Winter Glaze')).toBeLessThan(events.indexOf('Spring Raku'));
  });

  it('heads older activities as more to book once the new sections are above them', async () => {
    await request(app).post(`${studio.base}/services`).set(studio.headers).send({
      name: 'Private Wheel Lesson',
      bookingMode: 'APPOINTMENT',
      durationMinutes: 60,
      slotGranularityMinutes: 30,
      capacityMin: 1,
      capacityMax: 1,
      priceCents: 12000,
    }).expect(201);

    const alone = section(await page(), 'step-service')!;
    expect(alone).toContain('<h2>What would you like to book?</h2>');

    await request(app).post(`${studio.base}/activities/events`).set(studio.headers).send(event()).expect(201);
    const withEvent = section(await page(), 'step-service')!;
    expect(withEvent).toContain('<h2>More to book</h2>');
    expect(withEvent).toContain('Private Wheel Lesson');
  });

  it('takes an event and a class off the page once they are over', async () => {
    const ev = await request(app).post(`${studio.base}/activities/events`).set(studio.headers)
      .send(event()).expect(201);
    const cl = await request(app).post(`${studio.base}/activities/classes`).set(studio.headers)
      .send(klass()).expect(201);

    // Move every date into the past.
    for (const serviceTypeId of [ev.body.service.id, cl.body.service.id]) {
      const sessions = await prisma.session.findMany({ where: { serviceTypeId } });
      for (const s of sessions) {
        await prisma.session.update({
          where: { id: s.id },
          data: {
            startsAt: new Date(s.startsAt.getTime() - 3 * 365 * 86_400_000),
            endsAt: new Date(s.endsAt.getTime() - 3 * 365 * 86_400_000),
          },
        });
      }
    }

    const html = await page();
    expect(html).not.toContain('Valentine Date Night');
    expect(html).not.toContain('Beginner Wheel');
    expect(html).toContain('No classes are open for booking right now.');
  });
});
