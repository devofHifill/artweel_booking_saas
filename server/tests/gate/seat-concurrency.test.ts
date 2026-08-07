import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { AppError, BookingErrorCode } from '../../src/lib/app-error';
import { bookSeats } from '../../src/scheduling/booking.service';
import { createSession } from '../../src/scheduling/session.service';
import {
  createCustomers,
  createStudio,
  resetDb,
  at,
  type StudioFixture,
} from '../helpers/fixtures';

/**
 * PHASE 0 EXIT GATE — condition 1 of 4
 *
 *   "100 concurrent requests for the final 5 seats produce exactly 5 bookings
 *    and 95 clean, correctly-typed failures."
 *
 * This is the test the whole phase exists to pass. The previous WordPress
 * implementation fails it by design: it read the seat count, decided in PHP,
 * then inserted, with nothing between the read and the write.
 */

let studio: StudioFixture;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  studio = await createStudio();
});

async function makeSession(capacity: number) {
  return createSession({
    organizationId: studio.organization.id,
    serviceTypeId: studio.serviceType.id,
    staffId: studio.staff.id,
    locationId: studio.location.id,
    startsAt: at('2026-09-15T18:00:00Z'),
    endsAt: at('2026-09-15T21:00:00Z'),
    timezone: studio.timezone,
    localStartTime: '14:00',
    capacity,
  });
}

describe('seat concurrency', () => {
  it('sells exactly the last 5 seats to 100 simultaneous bookers', async () => {
    const session = await makeSession(5);
    const customers = await createCustomers(studio.organization.id, 100);

    const results = await Promise.allSettled(
      customers.map((customer) =>
        bookSeats({
          organizationId: studio.organization.id,
          sessionId: session.id,
          customerId: customer.id,
          seats: 1,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(5);
    expect(rejected).toHaveLength(95);

    // Every loser must fail for a REASON the booking page can render.
    // A generic 500 here would mean we avoided the oversell by accident.
    for (const r of rejected) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(AppError);
      expect(reason.statusCode).toBe(409);
      expect([
        BookingErrorCode.SESSION_FULL,
        BookingErrorCode.INSUFFICIENT_SEATS,
      ]).toContain(reason.code);
    }

    const after = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(after.seatsTaken).toBe(5);
    expect(after.seatsTaken).toBeLessThanOrEqual(after.capacity);

    const bookingCount = await prisma.booking.count({
      where: { sessionId: session.id, status: 'CONFIRMED' },
    });
    expect(bookingCount).toBe(5);

    const seatSum = await prisma.booking.aggregate({
      where: { sessionId: session.id, status: 'CONFIRMED' },
      _sum: { seats: true },
    });
    expect(seatSum._sum.seats).toBe(5);
  });

  it('never oversells when bookers request multiple seats each', async () => {
    // Capacity 10, twenty people each wanting 3. The arithmetic does not
    // divide evenly, which is exactly where naive implementations leak: the
    // last request that "fits" must be rejected, not clamped.
    const session = await makeSession(10);
    const customers = await createCustomers(studio.organization.id, 20);

    const results = await Promise.allSettled(
      customers.map((customer) =>
        bookSeats({
          organizationId: studio.organization.id,
          sessionId: session.id,
          customerId: customer.id,
          seats: 3,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    expect(fulfilled).toBe(3); // 3 x 3 = 9 seats; a fourth would need 12.

    const after = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(after.seatsTaken).toBe(9);
    expect(after.seatsTaken).toBeLessThanOrEqual(10);
  });

  it('refuses a booking larger than the whole class', async () => {
    const session = await makeSession(4);
    const [customer] = await createCustomers(studio.organization.id, 1);

    await expect(
      bookSeats({
        organizationId: studio.organization.id,
        sessionId: session.id,
        customerId: customer!.id,
        seats: 6,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.INSUFFICIENT_SEATS });

    const after = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(after.seatsTaken).toBe(0);
  });

  it('returns seats to the pool on cancellation', async () => {
    const session = await makeSession(2);
    const customers = await createCustomers(studio.organization.id, 2);

    const first = await bookSeats({
      organizationId: studio.organization.id,
      sessionId: session.id,
      customerId: customers[0]!.id,
      seats: 2,
    });

    // Full — the second customer cannot get in.
    await expect(
      bookSeats({
        organizationId: studio.organization.id,
        sessionId: session.id,
        customerId: customers[1]!.id,
        seats: 1,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.SESSION_FULL });

    const { cancelBooking } = await import('../../src/scheduling/booking.service');
    await cancelBooking(studio.organization.id, first!.id);

    const freed = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(freed.seatsTaken).toBe(0);

    // And now they can.
    await expect(
      bookSeats({
        organizationId: studio.organization.id,
        sessionId: session.id,
        customerId: customers[1]!.id,
        seats: 1,
      }),
    ).resolves.toBeTruthy();
  });

  it('cannot be oversold even by a direct write that bypasses the service', async () => {
    // The CHECK constraint is the backstop for any future code path that
    // forgets to lock. If this ever passes, the safety net is gone.
    const session = await makeSession(3);

    await expect(
      prisma.$executeRaw`
        UPDATE sessions SET seats_taken = 4 WHERE id = ${session.id}::uuid
      `,
    ).rejects.toThrow();
  });
});
