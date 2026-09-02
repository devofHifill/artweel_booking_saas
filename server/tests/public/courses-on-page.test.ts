import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * G2 — cohorts appear on the booking page.
 *
 * The three course routes have existed since W2.1 and the page mentioned
 * courses nowhere, so a studio could sell a six-week course through the API
 * and had no way to put it in front of a customer.
 *
 * The assertion that matters most is the price. A cohort carries its own, and
 * the service behind it carries the PER-CLASS drop-in rate; charging the
 * second for the first undercharges by however many weeks the course runs.
 */

const app = createApp();
let studio: Studio;
let slug: string;

/** Far enough ahead that these do not expire the way a fixed date does. */
function weeksFromNow(weeks: number): string {
  const d = new Date(Date.now() + weeks * 7 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

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

/**
 * A published cohort.
 *
 * `servicePriceCents` is deliberately separate from the cohort's price: it is
 * the drop-in rate, and every price assertion below turns on the two being
 * different.
 */
async function publishCourse(
  opts: { priceCents?: number; servicePriceCents?: number; capacity?: number } = {},
) {
  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Six-Week Beginner Wheel',
      bookingMode: 'COURSE_SERIES',
      durationMinutes: 120,
      capacityMax: 8,
      priceCents: opts.servicePriceCents ?? 9_500,
    })
    .expect(201);

  const created = await request(app)
    .post(`${studio.base}/courses`)
    .set(studio.headers)
    .send({
      serviceTypeId: service.body.service.id,
      name: 'Six Weeks at the Wheel',
      cohortLabel: 'Autumn 2026',
      description: 'Centring, pulling and trimming over six weeks.',
      sessionCount: 6,
      capacity: opts.capacity ?? 8,
      priceCents: opts.priceCents ?? 48_000,
    })
    .expect(201);

  const seriesId = created.body.series.id as string;

  await request(app)
    .post(`${studio.base}/courses/${seriesId}/sessions`)
    .set(studio.headers)
    .send({
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      startLocalDate: weeksFromNow(2),
      localStartTime: '19:00',
    })
    .expect(201);

  await request(app)
    .patch(`${studio.base}/courses/${seriesId}`)
    .set(studio.headers)
    .send({ status: 'PUBLISHED' });

  return { seriesId, serviceTypeId: service.body.service.id as string };
}

function connectStripe() {
  return prisma.organization.update({
    where: { id: studio.organizationId },
    data: {
      stripeAccountId: `acct_${studio.organizationId.slice(0, 8)}`,
      stripeChargesEnabled: true,
    },
  });
}

describe('the booking page', () => {
  it('lists an open cohort in its first response', async () => {
    await publishCourse();

    const res = await request(app).get(`/public/${slug}`).expect(200);

    // Server-rendered, not left for a script to fill — a crawler and a reader
    // with no JavaScript both see it.
    expect(res.text).toContain('Six Weeks at the Wheel');
    expect(res.text).toContain('Autumn 2026');
    expect(res.text).toContain('6 sessions');
    expect(res.text).toContain('$480');
  });

  it('never offers the course container as a drop-in class', async () => {
    /*
      The bug this pins down, found by walking the page: a COURSE_SERIES
      service was listed beside the real classes, priced at its per-class rate.
      A customer could have bought one week of a $480 course for $95. It was
      invisible only because no studio had a cohort yet.
    */
    const { serviceTypeId } = await publishCourse({ servicePriceCents: 9_500 });

    const res = await request(app).get(`/public/${slug}`).expect(200);

    /*
      The id, not the name. The name legitimately appears inside the cohort's
      own record in the data blob — what must not exist is a clickable card
      offering that service as a single bookable class.
    */
    expect(res.text).not.toContain(`data-service="${serviceTypeId}"`);
    expect(res.text).toContain('data-course=');
  });
});

describe('what a cohort costs', () => {
  it('quotes the cohort price, not the drop-in rate behind it', async () => {
    const { seriesId, serviceTypeId } = await publishCourse({
      priceCents: 48_000,
      servicePriceCents: 9_500,
    });
    await connectStripe();

    const res = await request(app)
      .post(`/public/${slug}/quote`)
      .send({ serviceTypeId, courseSeriesId: seriesId, seats: 1 })
      .expect(200);

    expect(res.body.totalCents).toBe(48_000);
    expect(res.body.willCharge).toBe(true);
  });

  it('quotes the drop-in rate when no cohort is named', async () => {
    // The same service, without courseSeriesId, must not silently inherit the
    // cohort's price — the two answers have to stay distinguishable.
    const { serviceTypeId } = await publishCourse({ servicePriceCents: 9_500 });
    await connectStripe();

    const res = await request(app)
      .post(`/public/${slug}/quote`)
      .send({ serviceTypeId, seats: 1 })
      .expect(200);

    expect(res.body.totalCents).toBe(9_500);
  });

  it('refuses a cohort id belonging to another studio', async () => {
    const mine = await publishCourse();

    const other = await signUpStudio(app, { organizationName: 'Kiln House' });
    const otherOrg = await prisma.organization.findUniqueOrThrow({
      where: { id: other.organizationId },
    });

    await request(app)
      .post(`/public/${otherOrg.slug}/quote`)
      .send({ serviceTypeId: mine.serviceTypeId, courseSeriesId: mine.seriesId, seats: 1 })
      .expect(404);
  });

  it('charges the cohort price at checkout', async () => {
    const { seriesId } = await publishCourse({
      priceCents: 48_000,
      servicePriceCents: 9_500,
    });
    await connectStripe();

    const res = await request(app)
      .post(`/public/${slug}/courses/${seriesId}/checkout`)
      .send({
        seats: 1,
        customer: { name: 'Ines Vaughn', email: 'ines@student.test' },
      })
      .expect(201);

    expect(res.body.price.totalCents).toBe(48_000);
    expect(res.body.checkoutUrl).toBeTruthy();

    // Held across every week before anybody sees a card field.
    expect(await prisma.bookingHold.count()).toBeGreaterThan(0);
  });
});

describe('a priced cohort at a studio with no Stripe', () => {
  it('cannot be enrolled in for free, which is why the page says so', async () => {
    /*
      Courses and classes part company here, and the page has to know it.

      A class at a studio without Stripe falls back to an unpaid booking.
      enrollPublic refuses ANY priced cohort, so the same fallback would 409 —
      which is why the course step renders an explanation instead of a button
      when the studio cannot take payment.
    */
    const { seriesId } = await publishCourse({ priceCents: 48_000 });

    const res = await request(app)
      .post(`/public/${slug}/courses/${seriesId}/enrollments`)
      .send({
        seats: 1,
        customer: { name: 'Ines Vaughn', email: 'ines@student.test' },
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_REQUIRES_PAYMENT');
  });

  it('still enrolls in a free cohort', async () => {
    const { seriesId } = await publishCourse({ priceCents: 0 });

    const res = await request(app)
      .post(`/public/${slug}/courses/${seriesId}/enrollments`)
      .send({
        seats: 1,
        customer: { name: 'Ines Vaughn', email: 'ines@student.test' },
      })
      .expect(201);

    expect(res.body.enrollment.sessionCount).toBe(6);
    expect(res.body.manageToken).toBeTruthy();
  });
});
