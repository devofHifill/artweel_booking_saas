import { prisma } from '../../src/lib/prisma';
import { bookAppointment } from '../../src/scheduling/booking.service';
import { createCustomers, at, type StudioFixture } from './fixtures';

/**
 * A realistically busy studio: four instructors, six-day weeks with a lunch
 * break each, and roughly 120 existing commitments across the month.
 *
 * Shared by the availability invariant suite and the timing suite so both
 * measure the same shape of work.
 */
export async function seedBusyStudio(studio: StudioFixture) {
  const service = await prisma.serviceType.create({
    data: {
      organizationId: studio.organization.id,
      name: 'Private Wheel Lesson',
      slug: `private-lesson-perf-${Math.random().toString(36).slice(2, 8)}`,
      bookingMode: 'APPOINTMENT',
      durationMinutes: 60,
      slotGranularityMinutes: 15,
      capacityMax: 1,
    },
  });

  const staffIds = [studio.staff.id];
  for (let i = 0; i < 3; i++) {
    const extra = await prisma.staff.create({
      data: {
        organizationId: studio.organization.id,
        name: `Instructor ${i}`,
        email: `perf-${i}-${Math.random().toString(36).slice(2, 8)}@clay.test`,
        timezone: studio.timezone,
      },
    });
    await prisma.staffLocation.create({
      data: { staffId: extra.id, locationId: studio.location.id },
    });
    staffIds.push(extra.id);
  }

  for (const staffId of staffIds) {
    await prisma.staffService.create({
      data: { staffId, serviceTypeId: service.id },
    });
    await prisma.availabilityRule.create({
      data: {
        organizationId: studio.organization.id,
        staffId,
        ruleType: 'WORKING',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA',
        startMinute: 9 * 60,
        endMinute: 18 * 60,
        timezone: studio.timezone,
        effectiveFrom: at('2026-01-01T00:00:00Z'),
      },
    });
    await prisma.availabilityRule.create({
      data: {
        organizationId: studio.organization.id,
        staffId,
        ruleType: 'BREAK',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA',
        startMinute: 12 * 60 + 30,
        endMinute: 13 * 60 + 30,
        timezone: studio.timezone,
        effectiveFrom: at('2026-01-01T00:00:00Z'),
      },
    });
  }

  await prisma.serviceLocation.create({
    data: { serviceTypeId: service.id, locationId: studio.location.id },
  });

  const customers = await createCustomers(studio.organization.id, 6);
  let created = 0;

  for (let day = 1; day <= 30; day++) {
    for (let slot = 0; slot < 4; slot++) {
      const staffId = staffIds[slot % staffIds.length]!;
      const dd = String(day).padStart(2, '0');
      const hour = 14 + slot * 2;
      try {
        await bookAppointment({
          organizationId: studio.organization.id,
          staffId,
          serviceTypeId: service.id,
          customerId: customers[created % customers.length]!.id,
          startsAt: at(`2026-06-${dd}T${String(hour).padStart(2, '0')}:00:00Z`),
          endsAt: at(`2026-06-${dd}T${String(hour + 1).padStart(2, '0')}:00:00Z`),
          timezone: studio.timezone,
          lat: 40.7128,
          lng: -74.006,
        });
        created++;
      } catch {
        // Collisions just mean the fixture is dense, which is the point.
      }
    }
  }

  return { service, staffIds, bookings: created };
}
