import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { getAvailability } from '../../src/scheduling/availability/availability.service';
import { bookAppointment } from '../../src/scheduling/booking.service';
import { createSession } from '../../src/scheduling/session.service';
import { allocateResource } from '../../src/scheduling/resource.service';
import { localTimeOf } from '../../src/scheduling/time/zoned';
import {
  createCustomers,
  createStudio,
  resetDb,
  at,
  type StudioFixture,
} from '../helpers/fixtures';

/**
 * The availability engine.
 *
 * Availability is set arithmetic: working windows, minus breaks, minus
 * existing commitments, minus travel time, minus resource contention, minus
 * notice and horizon limits. Each subtraction gets its own test.
 */

let studio: StudioFixture;
const NOW = at('2026-06-01T12:00:00Z');

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

/** A 60-minute private lesson, bookable on the half hour. */
async function privateLesson(overrides: Record<string, unknown> = {}) {
  const service = await prisma.serviceType.create({
    data: {
      organizationId: studio.organization.id,
      name: 'Private Wheel Lesson',
      slug: `private-lesson-${Math.random().toString(36).slice(2, 10)}`,
      bookingMode: 'APPOINTMENT',
      durationMinutes: 60,
      slotGranularityMinutes: 30,
      capacityMax: 1,
      priceCents: 12000,
      ...overrides,
    },
  });

  await prisma.staffService.create({
    data: { staffId: studio.staff.id, serviceTypeId: service.id },
  });
  await prisma.serviceLocation.create({
    data: { serviceTypeId: service.id, locationId: studio.location.id },
  });

  return service;
}

/** Tuesdays and Thursdays, 09:00-17:00 local. */
async function workingHours(rrule = 'FREQ=WEEKLY;BYDAY=TU,TH') {
  return prisma.availabilityRule.create({
    data: {
      organizationId: studio.organization.id,
      staffId: studio.staff.id,
      ruleType: 'WORKING',
      rrule,
      startMinute: 9 * 60,
      endMinute: 17 * 60,
      timezone: studio.timezone,
      effectiveFrom: at('2026-01-01T00:00:00Z'),
    },
  });
}

describe('appointment availability', () => {
  it('generates slots only on days the rule covers', async () => {
    const service = await privateLesson();
    await workingHours();

    const result = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: service.id,
      locationId: studio.location.id,
      fromLocalDate: '2026-06-01', // Monday
      toLocalDate: '2026-06-07', // Sunday
      now: NOW,
    });

    const days = new Set(result.slots.map((s) => s.localDate));
    expect([...days].sort()).toEqual(['2026-06-02', '2026-06-04']);
  });

  it('respects duration and granularity at the end of the day', async () => {
    const service = await privateLesson();
    await workingHours();

    const result = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: service.id,
      locationId: studio.location.id,
      fromLocalDate: '2026-06-02',
      toLocalDate: '2026-06-02',
      now: NOW,
    });

    const times = result.slots.map((s) => s.localTime);
    expect(times[0]).toBe('09:00');
    // A 60-minute lesson cannot start at 16:30 — it would run past close.
    expect(times[times.length - 1]).toBe('16:00');
    expect(times).not.toContain('16:30');
  });

  it('removes slots taken by an existing booking', async () => {
    const service = await privateLesson();
    await workingHours();
    const [customer] = await createCustomers(studio.organization.id, 1);

    await bookAppointment({
      organizationId: studio.organization.id,
      staffId: studio.staff.id,
      serviceTypeId: service.id,
      customerId: customer!.id,
      startsAt: at('2026-06-02T14:00:00Z'), // 10:00 EDT
      endsAt: at('2026-06-02T15:00:00Z'),
      timezone: studio.timezone,
    });

    const result = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: service.id,
      locationId: studio.location.id,
      fromLocalDate: '2026-06-02',
      toLocalDate: '2026-06-02',
      now: NOW,
    });

    const times = result.slots.map((s) => s.localTime);
    expect(times).not.toContain('10:00');
    // 09:30 would still be running at 10:00, so it must go too.
    expect(times).not.toContain('09:30');
    expect(times).toContain('11:00');
  });

  it('removes slots taken by a group class', async () => {
    // Cross-type again: the instructor teaching a class is unavailable for
    // private lessons, even though the class lives in a different table.
    const service = await privateLesson();
    await workingHours();

    await createSession({
      organizationId: studio.organization.id,
      serviceTypeId: studio.serviceType.id,
      staffId: studio.staff.id,
      locationId: studio.location.id,
      startsAt: at('2026-06-02T17:00:00Z'), // 13:00 EDT
      endsAt: at('2026-06-02T20:00:00Z'), // 16:00 EDT
      timezone: studio.timezone,
      localStartTime: '13:00',
      capacity: 8,
    });

    const result = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: service.id,
      locationId: studio.location.id,
      fromLocalDate: '2026-06-02',
      toLocalDate: '2026-06-02',
      now: NOW,
    });

    const times = result.slots.map((s) => s.localTime);
    expect(times).not.toContain('13:00');
    expect(times).not.toContain('15:00');
    expect(times).toContain('16:00');
  });

  it('subtracts recurring breaks', async () => {
    const service = await privateLesson();
    await workingHours();

    await prisma.availabilityRule.create({
      data: {
        organizationId: studio.organization.id,
        staffId: studio.staff.id,
        ruleType: 'BREAK',
        rrule: 'FREQ=WEEKLY;BYDAY=TU,TH',
        startMinute: 12 * 60,
        endMinute: 13 * 60,
        timezone: studio.timezone,
        effectiveFrom: at('2026-01-01T00:00:00Z'),
      },
    });

    const result = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: service.id,
      locationId: studio.location.id,
      fromLocalDate: '2026-06-02',
      toLocalDate: '2026-06-02',
      now: NOW,
    });

    const times = result.slots.map((s) => s.localTime);
    expect(times).not.toContain('12:00');
    expect(times).not.toContain('11:30');
    expect(times).toContain('13:00');
  });

  it('honours a day-off override', async () => {
    const service = await privateLesson();
    await workingHours();

    await prisma.availabilityOverride.create({
      data: {
        organizationId: studio.organization.id,
        staffId: studio.staff.id,
        overrideType: 'DAY_OFF',
        localDate: '2026-06-02',
        reason: 'Kiln repair',
      },
    });

    const result = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: service.id,
      locationId: studio.location.id,
      fromLocalDate: '2026-06-02',
      toLocalDate: '2026-06-04',
      now: NOW,
    });

    const days = new Set(result.slots.map((s) => s.localDate));
    expect(days.has('2026-06-02')).toBe(false);
    expect(days.has('2026-06-04')).toBe(true);
  });

  it('lets custom hours replace the normal day', async () => {
    const service = await privateLesson();
    await workingHours();

    await prisma.availabilityOverride.create({
      data: {
        organizationId: studio.organization.id,
        staffId: studio.staff.id,
        overrideType: 'CUSTOM_HOURS',
        localDate: '2026-06-02',
        startMinute: 14 * 60,
        endMinute: 16 * 60,
      },
    });

    const result = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: service.id,
      locationId: studio.location.id,
      fromLocalDate: '2026-06-02',
      toLocalDate: '2026-06-02',
      now: NOW,
    });

    expect(result.slots.map((s) => s.localTime)).toEqual(['14:00', '14:30', '15:00']);
  });

  it('applies the minimum notice window', async () => {
    const service = await privateLesson({ minNoticeMinutes: 48 * 60 });
    await workingHours();

    const result = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: service.id,
      locationId: studio.location.id,
      fromLocalDate: '2026-06-02',
      toLocalDate: '2026-06-04',
      now: at('2026-06-02T08:00:00Z'),
    });

    // 48 hours' notice from 2 June rules out the whole of the 2nd.
    const days = new Set(result.slots.map((s) => s.localDate));
    expect(days.has('2026-06-02')).toBe(false);
    expect(days.has('2026-06-04')).toBe(true);
  });

  it('applies the booking horizon', async () => {
    const service = await privateLesson({ maxHorizonDays: 3 });
    await workingHours();

    const result = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: service.id,
      locationId: studio.location.id,
      fromLocalDate: '2026-06-02',
      toLocalDate: '2026-06-30',
      now: NOW,
    });

    const days = new Set(result.slots.map((s) => s.localDate));
    expect(days.has('2026-06-02')).toBe(true);
    expect(days.has('2026-06-11')).toBe(false);
  });

  it('honours padding around an existing booking', async () => {
    const service = await privateLesson({
      paddingBeforeMinutes: 30,
      paddingAfterMinutes: 30,
    });
    await workingHours();
    const [customer] = await createCustomers(studio.organization.id, 1);

    await bookAppointment({
      organizationId: studio.organization.id,
      staffId: studio.staff.id,
      serviceTypeId: service.id,
      customerId: customer!.id,
      startsAt: at('2026-06-02T14:00:00Z'), // 10:00 EDT
      endsAt: at('2026-06-02T15:00:00Z'),
      timezone: studio.timezone,
      paddingBeforeMinutes: 30,
      paddingAfterMinutes: 30,
    });

    const times = (
      await getAvailability({
        organizationId: studio.organization.id,
        serviceTypeId: service.id,
        locationId: studio.location.id,
        fromLocalDate: '2026-06-02',
        toLocalDate: '2026-06-02',
        now: NOW,
      })
    ).slots.map((s) => s.localTime);

    // Booking occupies 09:30-11:30 once padded; a padded candidate needs
    // clear air on both sides of that.
    expect(times).not.toContain('11:30');
    expect(times).toContain('12:30');
  });

  it('keeps wall-clock slot times across a DST transition', async () => {
    const service = await privateLesson();
    await prisma.availabilityRule.create({
      data: {
        organizationId: studio.organization.id,
        staffId: studio.staff.id,
        ruleType: 'WORKING',
        rrule: 'FREQ=DAILY',
        startMinute: 9 * 60,
        endMinute: 17 * 60,
        timezone: studio.timezone,
        effectiveFrom: at('2026-01-01T00:00:00Z'),
      },
    });

    const result = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: service.id,
      locationId: studio.location.id,
      fromLocalDate: '2026-03-07',
      toLocalDate: '2026-03-09',
      now: at('2026-03-01T00:00:00Z'),
    });

    for (const date of ['2026-03-07', '2026-03-08', '2026-03-09']) {
      const first = result.slots.find((s) => s.localDate === date);
      expect(first, `no slots on ${date}`).toBeTruthy();
      expect(localTimeOf(first!.startsAt, studio.timezone)).toBe('09:00');
    }
  });
});

describe('resource-constrained availability', () => {
  it('hides slots when the exclusive resource is already committed', async () => {
    const service = await privateLesson();
    await workingHours();

    await prisma.serviceResource.create({
      data: {
        serviceTypeId: service.id,
        resourceId: studio.kiln.id,
        quantityPerSeat: 1,
      },
    });

    // A long glaze firing owns the kiln for most of the day.
    await allocateResource({
      organizationId: studio.organization.id,
      resourceId: studio.kiln.id,
      quantity: 1,
      startsAt: at('2026-06-02T13:00:00Z'),
      endsAt: at('2026-06-02T19:00:00Z'),
      note: 'glaze firing',
    });

    const times = (
      await getAvailability({
        organizationId: studio.organization.id,
        serviceTypeId: service.id,
        locationId: studio.location.id,
        fromLocalDate: '2026-06-02',
        toLocalDate: '2026-06-02',
        now: NOW,
      })
    ).slots.map((s) => s.localTime);

    // The firing runs 13:00Z-19:00Z, which is 09:00-15:00 local. Every slot
    // inside that is gone, and the studio's day effectively starts at 15:00.
    expect(times).not.toContain('09:00');
    expect(times).not.toContain('10:00');
    expect(times).not.toContain('14:00');
    // 15:00 local is 19:00Z — the instant the firing ends. Adjacent, so legal,
    // matching the '[)' bounds used by the exclusion constraint.
    expect(times).toContain('15:00');
  });

  it('hides slots when every counted resource is in use', async () => {
    const service = await privateLesson();
    await workingHours();

    await prisma.serviceResource.create({
      data: {
        serviceTypeId: service.id,
        resourceId: studio.wheels.id,
        quantityPerSeat: 1,
      },
    });

    // All eight wheels tied up by a morning class.
    await allocateResource({
      organizationId: studio.organization.id,
      resourceId: studio.wheels.id,
      quantity: 8,
      startsAt: at('2026-06-02T13:00:00Z'),
      endsAt: at('2026-06-02T16:00:00Z'),
    });

    const times = (
      await getAvailability({
        organizationId: studio.organization.id,
        serviceTypeId: service.id,
        locationId: studio.location.id,
        fromLocalDate: '2026-06-02',
        toLocalDate: '2026-06-02',
        now: NOW,
      })
    ).slots.map((s) => s.localTime);

    expect(times).not.toContain('10:00');
    expect(times).toContain('12:00'); // 16:00Z — the wheels are free again
  });
});

describe('seat-based availability', () => {
  it('reports remaining seats per session and hides full ones', async () => {
    const openSession = await createSession({
      organizationId: studio.organization.id,
      serviceTypeId: studio.serviceType.id,
      staffId: studio.staff.id,
      locationId: studio.location.id,
      startsAt: at('2026-06-02T18:00:00Z'),
      endsAt: at('2026-06-02T21:00:00Z'),
      timezone: studio.timezone,
      localStartTime: '14:00',
      capacity: 8,
    });

    const fullSession = await createSession({
      organizationId: studio.organization.id,
      serviceTypeId: studio.serviceType.id,
      locationId: studio.location.id,
      startsAt: at('2026-06-03T18:00:00Z'),
      endsAt: at('2026-06-03T21:00:00Z'),
      timezone: studio.timezone,
      localStartTime: '14:00',
      capacity: 2,
    });

    const customers = await createCustomers(studio.organization.id, 2);
    const { bookSeats } = await import('../../src/scheduling/booking.service');
    await bookSeats({
      organizationId: studio.organization.id,
      sessionId: openSession.id,
      customerId: customers[0]!.id,
      seats: 3,
    });
    await bookSeats({
      organizationId: studio.organization.id,
      sessionId: fullSession.id,
      customerId: customers[1]!.id,
      seats: 2,
    });

    const result = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: studio.serviceType.id,
      fromLocalDate: '2026-06-01',
      toLocalDate: '2026-06-07',
      now: NOW,
    });

    expect(result.mode).toBe('EVENT');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.sessionId).toBe(openSession.id);
    expect(result.sessions[0]!.seatsAvailable).toBe(5);
  });

  it('filters sessions that cannot fit the requested party', async () => {
    const session = await createSession({
      organizationId: studio.organization.id,
      serviceTypeId: studio.serviceType.id,
      locationId: studio.location.id,
      startsAt: at('2026-06-02T18:00:00Z'),
      endsAt: at('2026-06-02T21:00:00Z'),
      timezone: studio.timezone,
      localStartTime: '14:00',
      capacity: 4,
    });

    const [customer] = await createCustomers(studio.organization.id, 1);
    const { bookSeats } = await import('../../src/scheduling/booking.service');
    await bookSeats({
      organizationId: studio.organization.id,
      sessionId: session.id,
      customerId: customer!.id,
      seats: 2,
    });

    const forTwo = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: studio.serviceType.id,
      fromLocalDate: '2026-06-01',
      toLocalDate: '2026-06-07',
      seats: 2,
      now: NOW,
    });
    expect(forTwo.sessions).toHaveLength(1);

    const forThree = await getAvailability({
      organizationId: studio.organization.id,
      serviceTypeId: studio.serviceType.id,
      fromLocalDate: '2026-06-01',
      toLocalDate: '2026-06-07',
      seats: 3,
      now: NOW,
    });
    expect(forThree.sessions).toHaveLength(0);
  });
});
