import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { AppError, BookingErrorCode } from '../../src/lib/app-error';
import { bookAppointment } from '../../src/scheduling/booking.service';
import { createSession } from '../../src/scheduling/session.service';
import {
  createCustomers,
  createStudio,
  resetDb,
  at,
  type StudioFixture,
} from '../helpers/fixtures';

/**
 * PHASE 0 EXIT GATE — supporting evidence for condition 1
 *
 * The seat test proves capacity cannot be exceeded. This one proves a human
 * cannot be in two places at once, which is a different failure and needs a
 * different mechanism: EXCLUDE USING gist over a tstzrange.
 *
 * Every case here is one the plugin's
 *     UNIQUE KEY (staff_id, booking_date, booking_time)
 * would have waved straight through.
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

async function appointment(customerId: string, startIso: string, endIso: string) {
  return bookAppointment({
    organizationId: studio.organization.id,
    staffId: studio.staff.id,
    serviceTypeId: studio.serviceType.id,
    customerId,
    startsAt: at(startIso),
    endsAt: at(endIso),
    timezone: studio.timezone,
    locationId: studio.location.id,
  });
}

describe('staff overlap', () => {
  it('rejects a partial overlap that shares no start time', async () => {
    // 10:00-11:00 and 10:30-11:30. Different start times, so the old unique
    // index saw no conflict at all. They plainly overlap.
    const customers = await createCustomers(studio.organization.id, 2);

    await appointment(customers[0]!.id, '2026-09-15T14:00:00Z', '2026-09-15T15:00:00Z');

    await expect(
      appointment(customers[1]!.id, '2026-09-15T14:30:00Z', '2026-09-15T15:30:00Z'),
    ).rejects.toMatchObject({ code: BookingErrorCode.STAFF_UNAVAILABLE });

    expect(await prisma.booking.count({ where: { status: 'CONFIRMED' } })).toBe(1);
  });

  it('rejects a booking fully contained inside another', async () => {
    const customers = await createCustomers(studio.organization.id, 2);

    await appointment(customers[0]!.id, '2026-09-15T14:00:00Z', '2026-09-15T17:00:00Z');

    await expect(
      appointment(customers[1]!.id, '2026-09-15T15:00:00Z', '2026-09-15T16:00:00Z'),
    ).rejects.toMatchObject({ code: BookingErrorCode.STAFF_UNAVAILABLE });
  });

  it('allows genuinely back-to-back bookings', async () => {
    // The '[)' bounds on the range are what make this legal. A class ending
    // at 11:00 and one starting at 11:00 are adjacent, not overlapping —
    // studios run consecutive classes all day and must be able to.
    const customers = await createCustomers(studio.organization.id, 2);

    await appointment(customers[0]!.id, '2026-09-15T14:00:00Z', '2026-09-15T15:00:00Z');
    await expect(
      appointment(customers[1]!.id, '2026-09-15T15:00:00Z', '2026-09-15T16:00:00Z'),
    ).resolves.toBeTruthy();

    expect(await prisma.booking.count({ where: { status: 'CONFIRMED' } })).toBe(2);
  });

  it('lets exactly one of two simultaneous requests win the same slot', async () => {
    const customers = await createCustomers(studio.organization.id, 2);

    const results = await Promise.allSettled([
      appointment(customers[0]!.id, '2026-09-15T14:00:00Z', '2026-09-15T15:00:00Z'),
      appointment(customers[1]!.id, '2026-09-15T14:00:00Z', '2026-09-15T15:00:00Z'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(AppError);
    expect(loser.reason.code).toBe(BookingErrorCode.STAFF_UNAVAILABLE);

    expect(await prisma.staffTimeBlock.count()).toBe(1);
  });

  it('blocks an appointment that collides with a group class', async () => {
    // The cross-type case Postgres cannot see across two tables — which is
    // exactly why appointments and sessions both write into staff_time_blocks.
    const [customer] = await createCustomers(studio.organization.id, 1);

    await createSession({
      organizationId: studio.organization.id,
      serviceTypeId: studio.serviceType.id,
      staffId: studio.staff.id,
      locationId: studio.location.id,
      startsAt: at('2026-09-15T18:00:00Z'),
      endsAt: at('2026-09-15T21:00:00Z'),
      timezone: studio.timezone,
      localStartTime: '14:00',
      capacity: 8,
    });

    await expect(
      appointment(customer!.id, '2026-09-15T19:00:00Z', '2026-09-15T20:00:00Z'),
    ).rejects.toMatchObject({ code: BookingErrorCode.STAFF_UNAVAILABLE });
  });

  it('honours padding when reserving the instructor', async () => {
    // A 60-minute booking with 30 minutes of padding either side occupies
    // 120 minutes of the instructor's day. Something starting 15 minutes
    // after it ends is still inside the padding.
    const customers = await createCustomers(studio.organization.id, 2);

    await bookAppointment({
      organizationId: studio.organization.id,
      staffId: studio.staff.id,
      serviceTypeId: studio.serviceType.id,
      customerId: customers[0]!.id,
      startsAt: at('2026-09-15T14:00:00Z'),
      endsAt: at('2026-09-15T15:00:00Z'),
      timezone: studio.timezone,
      paddingBeforeMinutes: 30,
      paddingAfterMinutes: 30,
    });

    await expect(
      appointment(customers[1]!.id, '2026-09-15T15:15:00Z', '2026-09-15T16:00:00Z'),
    ).rejects.toMatchObject({ code: BookingErrorCode.STAFF_UNAVAILABLE });

    // Beyond the padding is fine.
    await expect(
      appointment(customers[1]!.id, '2026-09-15T15:30:00Z', '2026-09-15T16:00:00Z'),
    ).resolves.toBeTruthy();
  });

  it('frees the instructor when a booking is cancelled', async () => {
    const customers = await createCustomers(studio.organization.id, 2);

    const booking = await appointment(
      customers[0]!.id,
      '2026-09-15T14:00:00Z',
      '2026-09-15T15:00:00Z',
    );

    const { cancelBooking } = await import('../../src/scheduling/booking.service');
    await cancelBooking(studio.organization.id, booking!.id);

    await expect(
      appointment(customers[1]!.id, '2026-09-15T14:00:00Z', '2026-09-15T15:00:00Z'),
    ).resolves.toBeTruthy();
  });

  it('rejects an overlapping time block written directly to the table', async () => {
    // Proof the guarantee is in the database, not in the service layer.
    const [customer] = await createCustomers(studio.organization.id, 1);
    await appointment(customer!.id, '2026-09-15T14:00:00Z', '2026-09-15T15:00:00Z');

    await expect(
      prisma.$executeRaw`
        INSERT INTO staff_time_blocks
          (id, organization_id, staff_id, starts_at, ends_at, source, created_at)
        VALUES
          (gen_random_uuid(), ${studio.organization.id}::uuid, ${studio.staff.id}::uuid,
           ${at('2026-09-15T14:30:00Z')}, ${at('2026-09-15T15:30:00Z')}, 'manual', now())
      `,
    ).rejects.toThrow();
  });
});
