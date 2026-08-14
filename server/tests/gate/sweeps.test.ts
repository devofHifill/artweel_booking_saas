import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import {
  processSweepBatch,
  startSweepWorker,
  stopSweepWorker,
} from '../../src/workers/sweep.worker';

/**
 * The sweep worker.
 *
 * `sweepExpiredOffers`, `sweepExpiredHolds` and `sweepExpiredSubscriptions`
 * were each written with their own tests, and each of those tests called the
 * sweep directly. That is precisely why nobody noticed for two days that
 * nothing in `src/` called them at all — every sweep passed its test while
 * doing nothing in production, holding seats for people who had stopped
 * reading their email and running trials that would never end.
 *
 * So these tests deliberately do not call the sweeps. They drive the worker and
 * assert on the outcome, because "the sweep works" was never the thing in
 * doubt.
 */

const app = createApp();
let studio: Studio;
let slug: string;
let sessionId: string;

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

  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Wheel Class',
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMax: 8,
      priceCents: 0,
    });

  const cls = await request(app)
    .post(`${studio.base}/sessions`)
    .set(studio.headers)
    .send({
      serviceTypeId: service.body.service.id,
      startLocalDate: '2027-04-03',
      localStartTime: '10:00',
      capacity: 2,
    });
  sessionId = cls.body.created[0].id;
});

afterEach(() => {
  stopSweepWorker();
});

async function fillClass(count = 2) {
  const { bookSeats } = await import('../../src/scheduling/booking.service');
  const bookings = [];

  for (let i = 0; i < count; i++) {
    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: `Booked ${i}`,
        email: `booked${i}@student.test`,
      },
    });
    bookings.push(
      await bookSeats({
        organizationId: studio.organizationId,
        sessionId,
        customerId: customer.id,
        seats: 1,
      }),
    );
  }

  return bookings;
}

function join(name: string, seats = 1) {
  return request(app)
    .post(`/public/${slug}/sessions/${sessionId}/waitlist`)
    .send({
      seats,
      customer: { name, email: `${name.toLowerCase()}@student.test` },
    });
}

/** Waits for the fire-and-forget offer triggered by a cancellation. */
async function settle(ms = 900) {
  await new Promise((r) => setTimeout(r, ms));
}

/** A freed seat, offered to Ana, whose window has since closed. */
async function lapsedOffer() {
  const bookings = await fillClass();
  await join('Ana');
  await join('Ben');

  const { cancelBooking } = await import('../../src/scheduling/booking.service');
  await cancelBooking(studio.organizationId, bookings[0]!.id);
  await settle();

  await prisma.waitlistEntry.updateMany({
    where: { status: 'OFFERED' },
    data: { offerExpiresAt: new Date(Date.now() - 60_000) },
  });
}

describe('the sweep batch', () => {
  it('gives an ignored waitlist offer to the next person', async () => {
    await lapsedOffer();

    const result = await processSweepBatch();

    expect(result.offers?.expired).toBe(1);
    expect(result.offers?.passedOn).toBe(1);

    const [ana, ben] = await prisma.waitlistEntry.findMany({
      orderBy: { position: 'asc' },
    });
    expect(ana!.status).toBe('EXPIRED');
    expect(ben!.status).toBe('OFFERED');
  });

  it('leaves billing alone unless asked', async () => {
    const quiet = await processSweepBatch();
    expect(quiet.subscriptions).toBeNull();

    const asked = await processSweepBatch({ billing: true });
    expect(asked.subscriptions).not.toBeNull();
  });

  /**
   * Each sweep has its own try/catch rather than one around all three, so that
   * a waitlist query that throws is not the reason nobody's trial ever ends.
   * That isolation is not exercised here: this suite mocks nothing anywhere,
   * and faking a failure would mean introducing the first mock in the codebase
   * to test four lines of error handling. Verified by reading instead.
   */
  it('reports every sweep it ran', async () => {
    await lapsedOffer();

    const result = await processSweepBatch({ billing: true });

    expect(result.offers).not.toBeNull();
    expect(result.holds).not.toBeNull();
    expect(result.subscriptions).not.toBeNull();
  });
});

describe('the worker loop', () => {
  /**
   * The test that would have caught the original bug: not "does the sweep
   * work" but "does anything run it".
   */
  it('sweeps on its own without being called', async () => {
    await lapsedOffer();

    const before = await prisma.waitlistEntry.findFirst({
      where: { status: 'OFFERED' },
    });
    expect(before).not.toBeNull();

    startSweepWorker(50);
    await new Promise((r) => setTimeout(r, 400));

    const ana = await prisma.waitlistEntry.findFirst({
      orderBy: { position: 'asc' },
    });
    expect(ana!.status).toBe('EXPIRED');
  });

  it('stops when told to', async () => {
    startSweepWorker(50);
    stopSweepWorker();

    await lapsedOffer();
    await new Promise((r) => setTimeout(r, 300));

    const ana = await prisma.waitlistEntry.findFirst({
      orderBy: { position: 'asc' },
    });
    expect(ana!.status).toBe('OFFERED');
  });
});
