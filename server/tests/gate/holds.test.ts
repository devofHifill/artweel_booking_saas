import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { BookingErrorCode } from '../../src/lib/app-error';
import { bookSeats } from '../../src/scheduling/booking.service';
import { createSession } from '../../src/scheduling/session.service';
import {
  convertHold,
  createHold,
  releaseHold,
  sweepExpiredHolds,
} from '../../src/scheduling/hold.service';
import {
  createCustomers,
  createStudio,
  resetDb,
  at,
  type StudioFixture,
} from '../helpers/fixtures';

/**
 * Payment holds.
 *
 * The window between "customer picks a seat" and "Stripe confirms the charge"
 * is several seconds long and completely unprotected without this. Held seats
 * count toward seats_taken so that availability queries need no awareness of
 * holds at all — there is one number, and it is always the truth.
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

describe('booking holds', () => {
  it('reserves seats immediately, before any payment', async () => {
    const session = await makeSession(4);
    const customers = await createCustomers(studio.organization.id, 2);

    await createHold({
      organizationId: studio.organization.id,
      sessionId: session.id,
      customerId: customers[0]!.id,
      seats: 4,
    });

    const after = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(after.seatsTaken).toBe(4);

    // Someone else cannot take the seats that are mid-checkout.
    await expect(
      bookSeats({
        organizationId: studio.organization.id,
        sessionId: session.id,
        customerId: customers[1]!.id,
        seats: 1,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.SESSION_FULL });
  });

  it('converts to a booking without double-counting the seats', async () => {
    // The subtle bug this guards: incrementing again on conversion, which
    // silently halves the class.
    const session = await makeSession(6);
    const [customer] = await createCustomers(studio.organization.id, 1);

    const hold = await createHold({
      organizationId: studio.organization.id,
      sessionId: session.id,
      customerId: customer!.id,
      seats: 2,
    });

    const booking = await convertHold(studio.organization.id, hold!.id, {
      customerId: customer!.id,
    });

    expect(booking.seats).toBe(2);
    expect(booking.status).toBe('CONFIRMED');

    const after = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(after.seatsTaken).toBe(2);
  });

  it('releases abandoned holds and returns the seats', async () => {
    const session = await makeSession(3);
    const customers = await createCustomers(studio.organization.id, 2);

    await createHold({
      organizationId: studio.organization.id,
      sessionId: session.id,
      customerId: customers[0]!.id,
      seats: 3,
      ttlMinutes: -1, // already expired: the customer closed the tab
    });

    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: session.id } }))
        .seatsTaken,
    ).toBe(3);

    const result = await sweepExpiredHolds();
    expect(result.holdsReleased).toBe(1);
    expect(result.seatsReleased).toBe(3);

    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: session.id } }))
        .seatsTaken,
    ).toBe(0);

    await expect(
      bookSeats({
        organizationId: studio.organization.id,
        sessionId: session.id,
        customerId: customers[1]!.id,
        seats: 3,
      }),
    ).resolves.toBeTruthy();
  });

  it('is idempotent — a second sweep releases nothing', async () => {
    // Two workers running the job concurrently must not decrement twice.
    const session = await makeSession(3);
    const [customer] = await createCustomers(studio.organization.id, 1);

    await createHold({
      organizationId: studio.organization.id,
      sessionId: session.id,
      customerId: customer!.id,
      seats: 2,
      ttlMinutes: -1,
    });

    await sweepExpiredHolds();
    const second = await sweepExpiredHolds();

    expect(second.holdsReleased).toBe(0);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: session.id } }))
        .seatsTaken,
    ).toBe(0);
  });

  it('refuses to convert an expired hold', async () => {
    const session = await makeSession(3);
    const [customer] = await createCustomers(studio.organization.id, 1);

    const hold = await createHold({
      organizationId: studio.organization.id,
      sessionId: session.id,
      customerId: customer!.id,
      seats: 1,
      ttlMinutes: -1,
    });

    await expect(
      convertHold(studio.organization.id, hold!.id, { customerId: customer!.id }),
    ).rejects.toMatchObject({ code: BookingErrorCode.HOLD_EXPIRED });
  });

  it('refuses to convert a hold that was already released', async () => {
    const session = await makeSession(3);
    const [customer] = await createCustomers(studio.organization.id, 1);

    const hold = await createHold({
      organizationId: studio.organization.id,
      sessionId: session.id,
      customerId: customer!.id,
      seats: 1,
    });

    await releaseHold(studio.organization.id, hold!.id);

    await expect(
      convertHold(studio.organization.id, hold!.id, { customerId: customer!.id }),
    ).rejects.toMatchObject({ code: BookingErrorCode.HOLD_EXPIRED });
  });

  it('keeps holds and direct bookings competing for one pool of seats', async () => {
    const session = await makeSession(10);
    const customers = await createCustomers(studio.organization.id, 20);

    // Ten hold requests and ten direct bookings, all at once, all for one
    // seat. Whoever wins, the total must be exactly ten.
    const work = customers.map((customer, i) =>
      i % 2 === 0
        ? createHold({
            organizationId: studio.organization.id,
            sessionId: session.id,
            customerId: customer.id,
            seats: 1,
          })
        : bookSeats({
            organizationId: studio.organization.id,
            sessionId: session.id,
            customerId: customer.id,
            seats: 1,
          }),
    );

    const results = await Promise.allSettled(work);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);

    const after = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(after.seatsTaken).toBe(10);
  });
});
