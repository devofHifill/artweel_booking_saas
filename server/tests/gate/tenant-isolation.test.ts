import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { getAvailability } from '../../src/scheduling/availability/availability.service';
import { bookSeats, cancelBooking } from '../../src/scheduling/booking.service';
import { createSession, cancelSession } from '../../src/scheduling/session.service';
import { createHold, convertHold, releaseHold } from '../../src/scheduling/hold.service';
import { allocateResource } from '../../src/scheduling/resource.service';
import {
  createCustomers,
  createStudio,
  resetDb,
  at,
  type StudioFixture,
} from '../helpers/fixtures';

/**
 * PHASE 0 EXIT GATE — condition 4 of 4
 *
 *   "The isolation suite reports zero cross-organization reads or writes
 *    under adversarial input."
 *
 * The threat model is not a malicious outsider — it is an authenticated user
 * of studio A passing studio B's ID. Every one of these tests supplies a
 * valid, real ID that simply belongs to somebody else, which is exactly what
 * a broken tenant check lets through.
 *
 * The WordPress plugin had no concept of tenancy at all: `categories.name`
 * and `staff.email` were globally unique, so studio B could not even create
 * a category studio A had already used.
 */

let alpha: StudioFixture;
let beta: StudioFixture;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  alpha = await createStudio({ name: 'Alpha Clay' });
  beta = await createStudio({ name: 'Beta Ceramics', timezone: 'America/Los_Angeles' });
});

async function sessionFor(studio: StudioFixture, capacity = 5) {
  return createSession({
    organizationId: studio.organization.id,
    serviceTypeId: studio.serviceType.id,
    staffId: studio.staff.id,
    locationId: studio.location.id,
    startsAt: at('2026-06-02T18:00:00Z'),
    endsAt: at('2026-06-02T21:00:00Z'),
    timezone: studio.timezone,
    localStartTime: '14:00',
    capacity,
  });
}

describe('cross-tenant writes', () => {
  it('refuses to book a seat on another studio session', async () => {
    const betaSession = await sessionFor(beta);
    const [alphaCustomer] = await createCustomers(alpha.organization.id, 1);

    await expect(
      bookSeats({
        organizationId: alpha.organization.id, // attacker's own org
        sessionId: betaSession.id, // someone else's session
        customerId: alphaCustomer!.id,
        seats: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const untouched = await prisma.session.findUniqueOrThrow({
      where: { id: betaSession.id },
    });
    expect(untouched.seatsTaken).toBe(0);
  });

  it('refuses to hold seats on another studio session', async () => {
    const betaSession = await sessionFor(beta);

    await expect(
      createHold({
        organizationId: alpha.organization.id,
        sessionId: betaSession.id,
        seats: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: betaSession.id } }))
        .seatsTaken,
    ).toBe(0);
  });

  it('refuses to cancel another studio booking', async () => {
    const betaSession = await sessionFor(beta);
    const [betaCustomer] = await createCustomers(beta.organization.id, 1);

    const booking = await bookSeats({
      organizationId: beta.organization.id,
      sessionId: betaSession.id,
      customerId: betaCustomer!.id,
      seats: 2,
    });

    await expect(
      cancelBooking(alpha.organization.id, booking!.id),
    ).rejects.toMatchObject({ statusCode: 404 });

    const still = await prisma.booking.findUniqueOrThrow({
      where: { id: booking!.id },
    });
    expect(still.status).toBe('CONFIRMED');
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: betaSession.id } }))
        .seatsTaken,
    ).toBe(2);
  });

  it('refuses to cancel another studio session', async () => {
    const betaSession = await sessionFor(beta);

    await expect(
      cancelSession(alpha.organization.id, betaSession.id),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: betaSession.id } }))
        .status,
    ).toBe('SCHEDULED');
  });

  it('refuses to convert or release another studio hold', async () => {
    const betaSession = await sessionFor(beta);
    const [betaCustomer] = await createCustomers(beta.organization.id, 1);

    const hold = await createHold({
      organizationId: beta.organization.id,
      sessionId: betaSession.id,
      customerId: betaCustomer!.id,
      seats: 2,
    });

    await expect(
      convertHold(alpha.organization.id, hold!.id, {
        customerId: betaCustomer!.id,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    await expect(
      releaseHold(alpha.organization.id, hold!.id),
    ).rejects.toMatchObject({ statusCode: 404 });

    // The seats are still held for beta.
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: betaSession.id } }))
        .seatsTaken,
    ).toBe(2);
  });

  it('refuses to allocate another studio equipment', async () => {
    await expect(
      allocateResource({
        organizationId: alpha.organization.id,
        resourceId: beta.kiln.id,
        quantity: 1,
        startsAt: at('2026-06-02T18:00:00Z'),
        endsAt: at('2026-06-03T08:00:00Z'),
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(
      await prisma.resourceAllocation.count({
        where: { resourceId: beta.kiln.id },
      }),
    ).toBe(0);
  });
});

describe('cross-tenant reads', () => {
  it('will not return another studio service', async () => {
    await expect(
      getAvailability({
        organizationId: alpha.organization.id,
        serviceTypeId: beta.serviceType.id,
        fromLocalDate: '2026-06-01',
        toLocalDate: '2026-06-07',
        now: at('2026-06-01T08:00:00Z'),
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('never leaks another studio sessions into availability', async () => {
    await sessionFor(alpha);
    await sessionFor(beta);

    const result = await getAvailability({
      organizationId: alpha.organization.id,
      serviceTypeId: alpha.serviceType.id,
      fromLocalDate: '2026-06-01',
      toLocalDate: '2026-06-07',
      now: at('2026-06-01T08:00:00Z'),
    });

    expect(result.sessions).toHaveLength(1);

    const ids = result.sessions.map((s) => s.sessionId);
    const owners = await prisma.session.findMany({
      where: { id: { in: ids } },
      select: { organizationId: true },
    });
    for (const o of owners) {
      expect(o.organizationId).toBe(alpha.organization.id);
    }
  });

  it('never offers another studio staff as bookable', async () => {
    // Both studios have an instructor and a service with the same shape.
    // Alpha's availability must reference only Alpha's people.
    const service = await prisma.serviceType.create({
      data: {
        organizationId: alpha.organization.id,
        name: 'Private Lesson',
        slug: 'private-iso',
        bookingMode: 'APPOINTMENT',
        durationMinutes: 60,
        slotGranularityMinutes: 60,
      },
    });
    await prisma.staffService.create({
      data: { staffId: alpha.staff.id, serviceTypeId: service.id },
    });
    await prisma.availabilityRule.create({
      data: {
        organizationId: alpha.organization.id,
        staffId: alpha.staff.id,
        ruleType: 'WORKING',
        rrule: 'FREQ=DAILY',
        startMinute: 9 * 60,
        endMinute: 17 * 60,
        timezone: alpha.timezone,
        effectiveFrom: at('2026-01-01T00:00:00Z'),
      },
    });

    // Beta's instructor is deliberately given a rule for the same service id,
    // which is the shape a broken join would happily pick up.
    await prisma.availabilityRule.create({
      data: {
        organizationId: beta.organization.id,
        staffId: beta.staff.id,
        ruleType: 'WORKING',
        rrule: 'FREQ=DAILY',
        startMinute: 9 * 60,
        endMinute: 17 * 60,
        timezone: beta.timezone,
        effectiveFrom: at('2026-01-01T00:00:00Z'),
      },
    });

    const result = await getAvailability({
      organizationId: alpha.organization.id,
      serviceTypeId: service.id,
      fromLocalDate: '2026-06-02',
      toLocalDate: '2026-06-02',
      now: at('2026-06-01T08:00:00Z'),
    });

    expect(result.slots.length).toBeGreaterThan(0);
    const staffIds = new Set(result.slots.map((s) => s.staffId));
    expect([...staffIds]).toEqual([alpha.staff.id]);
    expect(staffIds.has(beta.staff.id)).toBe(false);
  });
});

describe('tenant-scoped uniqueness', () => {
  it('lets two studios use the same category name', async () => {
    await prisma.serviceCategory.create({
      data: { organizationId: alpha.organization.id, name: 'Wheel Throwing' },
    });

    // Global uniqueness here would make studio B's signup fail because
    // studio A got there first. This is the plugin's exact schema bug.
    await expect(
      prisma.serviceCategory.create({
        data: { organizationId: beta.organization.id, name: 'Wheel Throwing' },
      }),
    ).resolves.toBeTruthy();
  });

  it('lets two studios employ the same person by email', async () => {
    await prisma.staff.create({
      data: {
        organizationId: alpha.organization.id,
        name: 'Sam Reed',
        email: 'sam@freelance.test',
        timezone: alpha.timezone,
      },
    });

    // Freelance instructors genuinely teach at multiple studios.
    await expect(
      prisma.staff.create({
        data: {
          organizationId: beta.organization.id,
          name: 'Sam Reed',
          email: 'sam@freelance.test',
          timezone: beta.timezone,
        },
      }),
    ).resolves.toBeTruthy();
  });

  it('still rejects a duplicate within one studio', async () => {
    await prisma.serviceCategory.create({
      data: { organizationId: alpha.organization.id, name: 'Handbuilding' },
    });

    await expect(
      prisma.serviceCategory.create({
        data: { organizationId: alpha.organization.id, name: 'Handbuilding' },
      }),
    ).rejects.toThrow();
  });
});
