import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

/**
 * Cross-studio lists: bookings, customers, activities, locations, resources.
 *
 * These are the support surface. The question an operator is actually asked is
 * "this customer says they booked and got nothing" — answering it means finding
 * one row across every studio at once, which is the one thing the studio-scoped
 * API deliberately cannot do.
 *
 * READ ONLY, all of them. Editing a studio's booking from here would be acting
 * as the studio without being inside a support session, which is exactly the
 * accountability gap `SupportSession` exists to close. Anything that changes
 * state stays on the studio's own surface, entered through a session that
 * records who looked and why.
 */

export type ListQuery = {
  search?: string;
  organizationId?: string;
  limit: number;
  offset: number;
};

/** The envelope every list returns, so one client component can page them all. */
function envelope<T>(rows: T[], total: number, query: ListQuery) {
  return { rows, total, limit: query.limit, offset: query.offset };
}

const contains = (search: string) => ({
  contains: search,
  mode: 'insensitive' as const,
});

/** Studio filter, shared by every list. */
function scope(query: ListQuery) {
  return query.organizationId
    ? { organizationId: query.organizationId }
    : {};
}

// ---------------------------------------------------------------------------

export async function listBookings(query: ListQuery) {
  const where: Prisma.BookingWhereInput = {
    ...scope(query),
    ...(query.search
      ? {
          OR: [
            { reference: contains(query.search) },
            { customer: { name: contains(query.search) } },
            { customer: { email: contains(query.search) } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      /* Newest first: an operator looking a booking up is almost always
         looking at something that just happened. */
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
      select: {
        id: true,
        reference: true,
        startsAt: true,
        status: true,
        seats: true,
        totalCents: true,
        createdAt: true,
        organization: { select: { id: true, name: true } },
        customer: { select: { name: true, email: true } },
        serviceType: { select: { name: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return envelope(rows, total, query);
}

export async function listCustomers(query: ListQuery) {
  const where: Prisma.CustomerWhereInput = {
    ...scope(query),
    ...(query.search
      ? {
          OR: [
            { name: contains(query.search) },
            { email: contains(query.search) },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        organization: { select: { id: true, name: true } },
        _count: { select: { bookings: true } },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  return envelope(rows, total, query);
}

export async function listActivities(query: ListQuery) {
  const where: Prisma.ServiceTypeWhereInput = {
    ...scope(query),
    ...(query.search
      ? {
          OR: [
            { name: contains(query.search) },
            { organization: { name: contains(query.search) } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.serviceType.findMany({
      where,
      orderBy: [{ organization: { name: 'asc' } }, { name: 'asc' }],
      take: query.limit,
      skip: query.offset,
      select: {
        id: true,
        name: true,
        bookingMode: true,
        durationMinutes: true,
        capacityMax: true,
        priceCents: true,
        isActive: true,
        organization: { select: { id: true, name: true } },
      },
    }),
    prisma.serviceType.count({ where }),
  ]);

  return envelope(rows, total, query);
}

export async function listLocations(query: ListQuery) {
  const where: Prisma.LocationWhereInput = {
    ...scope(query),
    ...(query.search
      ? {
          OR: [
            { name: contains(query.search) },
            { address: contains(query.search) },
            { organization: { name: contains(query.search) } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.location.findMany({
      where,
      orderBy: [{ organization: { name: 'asc' } }, { name: 'asc' }],
      take: query.limit,
      skip: query.offset,
      select: {
        id: true,
        name: true,
        locationType: true,
        address: true,
        timezone: true,
        isActive: true,
        organization: { select: { id: true, name: true } },
      },
    }),
    prisma.location.count({ where }),
  ]);

  return envelope(rows, total, query);
}

/**
 * `resourceType` is an enum (WHEEL, KILN, SLAB_ROLLER, KIT, VEHICLE, ROOM,
 * OTHER), not free text, so it cannot be substring-matched. Searching "kiln"
 * should still find kilns, so an exact enum match is added when the term names
 * one — and quietly skipped when it does not.
 */
function resourceTypeMatch(search: string): Prisma.ResourceWhereInput[] {
  const candidate = search.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const values: string[] = [
    'WHEEL',
    'KILN',
    'SLAB_ROLLER',
    'KIT',
    'VEHICLE',
    'ROOM',
    'OTHER',
  ];
  return values.includes(candidate)
    ? [{ resourceType: candidate as Prisma.ResourceWhereInput['resourceType'] }]
    : [];
}

export async function listResources(query: ListQuery) {
  const where: Prisma.ResourceWhereInput = {
    ...scope(query),
    ...(query.search
      ? {
          OR: [
            { name: contains(query.search) },
            ...resourceTypeMatch(query.search),
            { organization: { name: contains(query.search) } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.resource.findMany({
      where,
      orderBy: [{ organization: { name: 'asc' } }, { name: 'asc' }],
      take: query.limit,
      skip: query.offset,
      select: {
        id: true,
        name: true,
        resourceType: true,
        quantity: true,
        isExclusive: true,
        isActive: true,
        organization: { select: { id: true, name: true } },
      },
    }),
    prisma.resource.count({ where }),
  ]);

  return envelope(rows, total, query);
}

/**
 * Counts for the sidebar badges. Cheap counts, read on every admin load.
 *
 * The webhook badge counts FAILURES in the last 24 hours rather than total
 * deliveries: a number that only ever goes up is wallpaper, and the point of a
 * badge is that a non-zero one means go and look.
 */
export async function getNavCounts() {
  const [studios, users, failedWebhooks] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.webhookEvent.count({
      where: {
        error: { not: null },
        createdAt: { gte: new Date(Date.now() - 86_400_000) },
      },
    }),
  ]);
  return { studios, users, failedWebhooks };
}
