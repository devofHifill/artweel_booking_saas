import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/lib/prisma';

/**
 * Wipes every tenant table between tests.
 *
 * _prisma_migrations is preserved (it is the migration ledger) and
 * spatial_ref_sys is PostGIS reference data, not ours.
 */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')
  `;

  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export type StudioFixture = Awaited<ReturnType<typeof createStudio>>;

/**
 * A realistic single-studio fixture: one organization, one instructor, one
 * wheel-throwing service, a studio location, eight wheels and one kiln.
 */
export async function createStudio(opts?: { name?: string; timezone?: string }) {
  const timezone = opts?.timezone ?? 'America/New_York';
  const suffix = randomUUID().slice(0, 8);

  const organization = await prisma.organization.create({
    data: {
      name: opts?.name ?? 'Clay & Co',
      slug: `clay-co-${suffix}`,
      timezone,
      // Scheduling tests are not about billing; PRO keeps plan limits from
      // interfering with what they actually assert.
      plan: 'PRO',
      subscriptionStatus: 'ACTIVE',
    },
  });

  const location = await prisma.location.create({
    data: {
      organizationId: organization.id,
      name: 'Main Studio',
      locationType: 'FIXED',
      address: '119 Kiln St',
      lat: 40.7128,
      lng: -74.006,
      timezone,
    },
  });

  const staff = await prisma.staff.create({
    data: {
      organizationId: organization.id,
      name: 'Rowan Pike',
      email: `rowan-${suffix}@clay.test`,
      timezone,
    },
  });

  await prisma.staffLocation.create({
    data: { staffId: staff.id, locationId: location.id },
  });

  const serviceType = await prisma.serviceType.create({
    data: {
      organizationId: organization.id,
      name: 'Beginner Wheel Throwing',
      slug: `beginner-wheel-${suffix}`,
      bookingMode: 'EVENT',
      durationMinutes: 180,
      slotGranularityMinutes: 30,
      capacityMax: 8,
      priceCents: 9500,
    },
  });

  await prisma.staffService.create({
    data: { staffId: staff.id, serviceTypeId: serviceType.id },
  });
  await prisma.serviceLocation.create({
    data: { serviceTypeId: serviceType.id, locationId: location.id },
  });

  const wheels = await prisma.resource.create({
    data: {
      organizationId: organization.id,
      locationId: location.id,
      name: 'Pottery wheels',
      resourceType: 'WHEEL',
      quantity: 8,
      isExclusive: false,
    },
  });

  const kiln = await prisma.resource.create({
    data: {
      organizationId: organization.id,
      locationId: location.id,
      name: 'Skutt KM-1027',
      resourceType: 'KILN',
      quantity: 1,
      isExclusive: true,
    },
  });

  return { organization, location, staff, serviceType, wheels, kiln, timezone };
}

export async function createCustomer(organizationId: string, label = 'c') {
  const suffix = randomUUID().slice(0, 8);
  return prisma.customer.create({
    data: {
      organizationId,
      name: `Customer ${label}`,
      email: `${label}-${suffix}@student.test`,
      phone: '+15550100',
    },
  });
}

/** N distinct customers — concurrency tests need one per competing request. */
export async function createCustomers(organizationId: string, count: number) {
  const customers = [];
  for (let i = 0; i < count; i++) {
    customers.push(await createCustomer(organizationId, `c${i}`));
  }
  return customers;
}

/** Absolute instants, so tests never depend on when they happen to run. */
export function at(iso: string) {
  return new Date(iso);
}
