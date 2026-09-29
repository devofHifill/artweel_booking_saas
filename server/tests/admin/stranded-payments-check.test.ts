import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';
import { bookAppointment } from '../../src/scheduling/booking.service';

/**
 * server/scripts/check-stranded-payments.sql finds what the old reschedule left.
 *
 * It is run by hand against live data, once, so it is tested here against the
 * exact trail the old code wrote — and against the look-alikes it must not
 * report — rather than trusted.
 */

const app = createApp();
let studio: Studio;
let serviceId: string;
let staffId: string;
let customerId: string;

const sql = readFileSync(join(process.cwd(), 'scripts/check-stranded-payments.sql'), 'utf8')
  .replace(/--.*$/gm, '')
  .trim()
  .replace(/;\s*$/, '');

const check = () => prisma.$queryRawUnsafe<{ cancelled_booking_id: string; unrefunded_cents: number }[]>(sql);

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
  serviceId = (
    await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({ name: 'Private lesson', bookingMode: 'APPOINTMENT', durationMinutes: 60 })
      .expect(201)
  ).body.service.id;
  staffId = (
    await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Rowan Pike', email: 'rowan@clay.test' })
      .expect(201)
  ).body.staff.id;
  customerId = (
    await prisma.customer.create({
      data: { organizationId: studio.organizationId, name: 'Sam', email: 'sam@paddler.test' },
    })
  ).id;
});

const DAY = 86_400_000;
let slot = 0;

async function booking(source?: string) {
  const startsAt = new Date(Date.now() + (10 + slot++) * DAY);
  const b = (await bookAppointment({
    organizationId: studio.organizationId,
    staffId,
    serviceTypeId: serviceId,
    customerId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3_600_000),
    timezone: 'Europe/London',
    ...(source ? { source } : {}),
  }))!;
  return b;
}

const pay = (bookingId: string, refundedCents = 0) =>
  prisma.payment.create({
    data: {
      organizationId: studio.organizationId,
      bookingId,
      kind: 'FULL',
      amountCents: 8_000,
      refundedCents,
      status: refundedCents >= 8_000 ? 'REFUNDED' : 'SUCCEEDED',
    },
  });

const cancel = (id: string) =>
  prisma.booking.update({ where: { id }, data: { status: 'CANCELLED' } });

describe('the stranded-payment check', () => {
  it('finds a paid booking the old reschedule cancelled and replaced', async () => {
    const original = await booking();
    await pay(original.id);
    // The old code: cancel, then book the new time as a new booking.
    await cancel(original.id);
    await booking('admin-reschedule');

    const rows = await check();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cancelled_booking_id).toBe(original.id);
    expect(Number(rows[0]!.unrefunded_cents)).toBe(8_000);
  });

  it('finds the same trail left by a customer move and by a failed move', async () => {
    const byCustomer = await booking();
    await pay(byCustomer.id);
    await cancel(byCustomer.id);
    await booking('reschedule');

    const failed = await booking();
    await pay(failed.id);
    await cancel(failed.id);
    await booking('admin-reschedule-rollback');

    expect((await check()).map((r) => r.cancelled_booking_id).sort()).toEqual(
      [byCustomer.id, failed.id].sort(),
    );
  });

  it('ignores a payment that was refunded in full', async () => {
    const original = await booking();
    await pay(original.id, 8_000);
    await cancel(original.id);
    await booking('admin-reschedule');

    expect(await check()).toEqual([]);
  });

  it('ignores an ordinary cancellation, and a move made the new way', async () => {
    const cancelled = await booking();
    await pay(cancelled.id);
    await cancel(cancelled.id);
    // A new booking made normally, not by a reschedule.
    await booking();

    // The fixed reschedule moves in place: one booking, payment still on it.
    const moved = await booking();
    await pay(moved.id);
    await request(app)
      .post(`${studio.base}/bookings/${moved.id}/reschedule`)
      .set(studio.headers)
      .send({ startsAt: new Date(moved.startsAt.getTime() + 2 * DAY).toISOString() })
      .expect(200);

    expect(await check()).toEqual([]);
  });
});
