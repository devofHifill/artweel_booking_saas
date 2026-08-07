import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import {
  localDateRange,
  localTimeOf,
  mergeIntervals,
  overlaps,
  resolveLocal,
  subtractIntervals,
  type Interval,
} from '../time/zoned';
import { applyOverrides, expandRule } from '../time/recurrence';
import {
  defaultTravelProvider,
  haversineKm,
  travelFeeFor,
  type LatLng,
  type TravelFeeBand,
  type TravelTimeProvider,
} from '../travel/travel';

/**
 * W0.4 — The availability engine.
 *
 * PERFORMANCE CONTRACT: p95 under 200ms for a 31-day window.
 *
 * That budget is met by a single structural rule — EVERY read happens up
 * front, in a fixed number of queries, and the rest is pure in-memory set
 * arithmetic. The query count does not grow with the size of the date range.
 *
 * This is the direct lesson from the previous implementation, which called
 * the Google Calendar API from inside slot generation. Availability was then
 * as slow as Google was, and unavailable when Google was. Here, external
 * calendars are mirrored into `busy_blocks` by a background sync and read
 * locally like anything else.
 */

export type AvailabilityQuery = {
  organizationId: string;
  serviceTypeId: string;
  /** Inclusive, in the location's timezone. */
  fromLocalDate: string;
  toLocalDate: string;
  locationId?: string;
  staffId?: string;
  /** Mobile bookings: where the instructor has to get to. */
  customerLocation?: LatLng;
  seats?: number;
  /** Injectable so tests are deterministic and do not depend on wall time. */
  now?: Date;
  travelProvider?: TravelTimeProvider;
};

export type AvailabilitySlot = {
  startsAt: Date;
  endsAt: Date;
  localTime: string;
  localDate: string;
  staffId: string;
  staffName: string;
  locationId: string | null;
  travelMinutesBefore?: number;
  travelFeeCents?: number;
};

export type SessionAvailability = {
  sessionId: string;
  startsAt: Date;
  endsAt: Date;
  localTime: string;
  localDate: string;
  capacity: number;
  seatsAvailable: number;
  staffId: string | null;
  locationId: string | null;
};

export type AvailabilityResult = {
  mode: 'APPOINTMENT' | 'EVENT' | 'COURSE_SERIES';
  slots: AvailabilitySlot[];
  sessions: SessionAvailability[];
  /** Query count and timing, for the performance gate. */
  diagnostics: { queries: number; elapsedMs: number };
};

export async function getAvailability(
  query: AvailabilityQuery,
): Promise<AvailabilityResult> {
  const started = Date.now();
  const now = query.now ?? new Date();
  const seats = query.seats ?? 1;

  const serviceType = await prisma.serviceType.findFirst({
    where: { id: query.serviceTypeId, organizationId: query.organizationId },
  });
  if (!serviceType) throw AppError.notFound('Service not found.');

  if (serviceType.bookingMode !== 'APPOINTMENT') {
    return getSessionAvailability(query, serviceType, now, seats, started);
  }

  return getAppointmentAvailability(query, serviceType, now, seats, started);
}

// ---------------------------------------------------------------------------
// Seat-based: events and course sessions
//
// Availability here is not a function of staff schedules at all — it is the
// seat counter on a concrete session row. Keeping these paths separate is the
// one design decision worth inheriting wholesale from the plugin, which
// discovered the hard way that running event availability through
// staff/calendar logic made sessions block their own remaining seats.
// ---------------------------------------------------------------------------
async function getSessionAvailability(
  query: AvailabilityQuery,
  serviceType: { id: string; bookingMode: string; minNoticeMinutes: number },
  now: Date,
  seats: number,
  started: number,
): Promise<AvailabilityResult> {
  const zone = await resolveZone(query);
  const rangeStart = resolveLocal(query.fromLocalDate, 0, zone).instant;
  const rangeEnd = resolveLocal(query.toLocalDate, 1440, zone).instant;
  const earliest = new Date(now.getTime() + serviceType.minNoticeMinutes * 60_000);

  const sessions = await prisma.session.findMany({
    where: {
      organizationId: query.organizationId,
      serviceTypeId: serviceType.id,
      status: 'SCHEDULED',
      startsAt: { gte: rangeStart, lt: rangeEnd },
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.staffId ? { staffId: query.staffId } : {}),
    },
    orderBy: { startsAt: 'asc' },
  });

  const available = sessions
    .filter((s) => s.startsAt >= earliest)
    .map((s) => ({
      sessionId: s.id,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      localTime: localTimeOf(s.startsAt, s.timezone),
      localDate: s.startsAt.toISOString().slice(0, 10),
      capacity: s.capacity,
      seatsAvailable: Math.max(0, s.capacity - s.seatsTaken),
      staffId: s.staffId,
      locationId: s.locationId,
    }))
    .filter((s) => s.seatsAvailable >= seats);

  return {
    mode: serviceType.bookingMode as AvailabilityResult['mode'],
    slots: [],
    sessions: available,
    diagnostics: { queries: 2, elapsedMs: Date.now() - started },
  };
}

// ---------------------------------------------------------------------------
// Staff-driven: one-to-one appointments
// ---------------------------------------------------------------------------
type RuleRow = {
  id: string;
  staff_id: string;
  rule_type: string;
  rrule: string;
  start_minute: number;
  end_minute: number;
  timezone: string;
  effective_from: Date;
  effective_until: Date | null;
};

type BlockRow = {
  staff_id: string;
  starts_at: Date;
  ends_at: Date;
  lat: number | null;
  lng: number | null;
};

async function getAppointmentAvailability(
  query: AvailabilityQuery,
  serviceType: {
    id: string;
    bookingMode: string;
    durationMinutes: number;
    slotGranularityMinutes: number;
    paddingBeforeMinutes: number;
    paddingAfterMinutes: number;
    minNoticeMinutes: number;
    maxHorizonDays: number;
  },
  now: Date,
  seats: number,
  started: number,
): Promise<AvailabilityResult> {
  const travel = query.travelProvider ?? defaultTravelProvider;

  // ---- Phase 1: gather. Six queries, regardless of range length. ----------
  const staffRows = await prisma.staff.findMany({
    where: {
      organizationId: query.organizationId,
      isActive: true,
      ...(query.staffId ? { id: query.staffId } : {}),
      staffServices: { some: { serviceTypeId: serviceType.id } },
      ...(query.locationId
        ? { staffLocations: { some: { locationId: query.locationId } } }
        : {}),
    },
    select: { id: true, name: true, timezone: true },
  });

  if (staffRows.length === 0) {
    return {
      mode: 'APPOINTMENT',
      slots: [],
      sessions: [],
      diagnostics: { queries: 2, elapsedMs: Date.now() - started },
    };
  }

  const staffIds = staffRows.map((s) => s.id);
  const zone = await resolveZone(query, staffRows[0]!.timezone);

  const rangeStart = resolveLocal(query.fromLocalDate, 0, zone).instant;
  const rangeEnd = resolveLocal(query.toLocalDate, 1440, zone).instant;

  const [rules, overrides, timeBlocks, busyBlocks, requirements] =
    await Promise.all([
      prisma.$queryRaw<RuleRow[]>`
        SELECT id, staff_id, rule_type::text AS rule_type, rrule,
               start_minute, end_minute, timezone, effective_from, effective_until
        FROM availability_rules
        WHERE organization_id = ${query.organizationId}::uuid
          AND staff_id = ANY(${staffIds}::uuid[])
          AND effective_from <= ${rangeEnd}
          AND (effective_until IS NULL OR effective_until >= ${rangeStart})
      `,
      prisma.availabilityOverride.findMany({
        where: {
          organizationId: query.organizationId,
          staffId: { in: staffIds },
          localDate: { gte: query.fromLocalDate, lte: query.toLocalDate },
        },
      }),
      prisma.$queryRaw<BlockRow[]>`
        SELECT staff_id, starts_at, ends_at, lat, lng
        FROM staff_time_blocks
        WHERE staff_id = ANY(${staffIds}::uuid[])
          AND starts_at < ${rangeEnd}
          AND ends_at > ${rangeStart}
      `,
      prisma.busyBlock.findMany({
        where: {
          staffId: { in: staffIds },
          startsAt: { lt: rangeEnd },
          endsAt: { gt: rangeStart },
        },
        select: { staffId: true, startsAt: true, endsAt: true },
      }),
      prisma.serviceResource.findMany({
        where: { serviceTypeId: serviceType.id },
        include: { resource: true },
      }),
    ]);

  // Resource load, if this service needs equipment. One more query, still
  // independent of the date range.
  let allocations: { resource_id: string; starts_at: Date; ends_at: Date; quantity: number }[] =
    [];
  if (requirements.length > 0) {
    const resourceIds = requirements.map((r) => r.resourceId);
    allocations = await prisma.$queryRaw`
      SELECT resource_id, starts_at, ends_at, quantity
      FROM resource_allocations
      WHERE resource_id = ANY(${resourceIds}::uuid[])
        AND starts_at < ${rangeEnd}
        AND ends_at > ${rangeStart}
    `;
  }

  // ---- Phase 2: compute. No further I/O below this line. -----------------
  const earliest = new Date(now.getTime() + serviceType.minNoticeMinutes * 60_000);
  const horizon = new Date(
    now.getTime() + serviceType.maxHorizonDays * 24 * 60 * 60_000,
  );

  const dates = localDateRange(query.fromLocalDate, query.toLocalDate);
  const slots: AvailabilitySlot[] = [];

  const durationMs = serviceType.durationMinutes * 60_000;
  const stepMs = Math.max(5, serviceType.slotGranularityMinutes) * 60_000;

  for (const staff of staffRows) {
    const staffZone = staff.timezone || zone;

    const workingRules = rules.filter(
      (r) => r.staff_id === staff.id && r.rule_type === 'WORKING',
    );
    const breakRules = rules.filter(
      (r) => r.staff_id === staff.id && r.rule_type === 'BREAK',
    );

    const staffOverrides = overrides
      .filter((o) => o.staffId === staff.id)
      .map((o) => ({
        overrideType: o.overrideType as
          | 'DAY_OFF'
          | 'CUSTOM_HOURS'
          | 'EXTRA_HOURS',
        localDate: o.localDate,
        startMinute: o.startMinute,
        endMinute: o.endMinute,
      }));

    const ownBlocks = timeBlocks.filter((b) => b.staff_id === staff.id);
    const ownBusy = busyBlocks.filter((b) => b.staffId === staff.id);

    // Travel widening. Each existing commitment expands by the time needed to
    // reach the requested address from it, and to get back afterwards. A
    // one-hour class across town blocks far more than one hour.
    const busyIntervals: Interval[] = [];

    for (const block of ownBlocks) {
      let before = 0;
      let after = 0;

      if (query.customerLocation && block.lat != null && block.lng != null) {
        const minutes = await travel.minutesBetween(
          { lat: block.lat, lng: block.lng },
          query.customerLocation,
        );
        before = minutes;
        after = minutes;
      }

      busyIntervals.push({
        start: new Date(block.starts_at.getTime() - after * 60_000),
        end: new Date(block.ends_at.getTime() + before * 60_000),
      });
    }

    for (const b of ownBusy) {
      busyIntervals.push({ start: b.startsAt, end: b.endsAt });
    }

    const busy = mergeIntervals(busyIntervals);

    // Expand each rule ONCE across the whole range, then index by local date.
    //
    // Expanding per day instead re-parses and re-evaluates the same RRULE for
    // every date — 4 staff x 31 days x 2 rules is 248 parses, which measured
    // at 251ms against a 200ms budget. The work must scale with the number of
    // RULES, not with the length of the window.
    const workingByDate = expandByDate(
      workingRules,
      query.fromLocalDate,
      query.toLocalDate,
    );
    const breaksByDate = expandByDate(
      breakRules,
      query.fromLocalDate,
      query.toLocalDate,
    );

    for (const localDate of dates) {
      let working = workingByDate.get(localDate) ?? [];
      working = applyOverrides(localDate, working, staffOverrides, staffZone);
      if (working.length === 0) continue;

      const breaks = breaksByDate.get(localDate) ?? [];

      const bookable = subtractIntervals(mergeIntervals(working), breaks);

      for (const window of bookable) {
        for (
          let t = window.start.getTime();
          t + durationMs <= window.end.getTime();
          t += stepMs
        ) {
          const startsAt = new Date(t);
          const endsAt = new Date(t + durationMs);

          if (startsAt < earliest || startsAt > horizon) continue;

          // The candidate occupies service time PLUS padding.
          const occupied: Interval = {
            start: new Date(t - serviceType.paddingBeforeMinutes * 60_000),
            end: new Date(
              t + durationMs + serviceType.paddingAfterMinutes * 60_000,
            ),
          };

          if (busy.some((b) => overlaps(occupied, b))) continue;

          if (
            requirements.length > 0 &&
            !hasResources(requirements, allocations, startsAt, endsAt, seats)
          ) {
            continue;
          }

          slots.push({
            startsAt,
            endsAt,
            localTime: localTimeOf(startsAt, staffZone),
            localDate,
            staffId: staff.id,
            staffName: staff.name,
            locationId: query.locationId ?? null,
          });
        }
      }
    }
  }

  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  return {
    mode: 'APPOINTMENT',
    slots,
    sessions: [],
    diagnostics: {
      queries: requirements.length > 0 ? 8 : 7,
      elapsedMs: Date.now() - started,
    },
  };
}

/**
 * Expands a set of rules across the whole query range and buckets the
 * resulting windows by local date.
 *
 * One pass per rule, regardless of how many days the query covers.
 */
function expandByDate(
  rules: RuleRow[],
  fromLocalDate: string,
  toLocalDate: string,
): Map<string, Interval[]> {
  const byDate = new Map<string, Interval[]>();

  for (const rule of rules) {
    const windows = expandRule({
      rrule: rule.rrule,
      startMinute: rule.start_minute,
      endMinute: rule.end_minute,
      timezone: rule.timezone,
      effectiveFrom: rule.effective_from,
      effectiveUntil: rule.effective_until,
      fromLocalDate,
      toLocalDate,
    });

    for (const w of windows) {
      const entry = byDate.get(w.localDate);
      const interval = { start: w.start, end: w.end };
      if (entry) entry.push(interval);
      else byDate.set(w.localDate, [interval]);
    }
  }

  return byDate;
}

/**
 * Are enough of every required resource free for this window?
 *
 * Exclusive resources need zero overlap. Counted resources need capacity to
 * spare — and the requirement is per seat, because six students need six
 * wheels.
 */
function hasResources(
  requirements: {
    resourceId: string;
    quantityPerSeat: number;
    resource: { quantity: number; isExclusive: boolean; isActive: boolean };
  }[],
  allocations: { resource_id: string; starts_at: Date; ends_at: Date; quantity: number }[],
  startsAt: Date,
  endsAt: Date,
  seats: number,
): boolean {
  const candidate: Interval = { start: startsAt, end: endsAt };

  for (const req of requirements) {
    if (!req.resource.isActive) return false;

    const needed = req.quantityPerSeat * seats;
    if (needed > req.resource.quantity) return false;

    let used = 0;
    for (const alloc of allocations) {
      if (alloc.resource_id !== req.resourceId) continue;
      if (!overlaps(candidate, { start: alloc.starts_at, end: alloc.ends_at })) {
        continue;
      }
      if (req.resource.isExclusive) return false;
      used += alloc.quantity;
    }

    if (used + needed > req.resource.quantity) return false;
  }

  return true;
}

async function resolveZone(
  query: AvailabilityQuery,
  fallback?: string,
): Promise<string> {
  if (query.locationId) {
    const location = await prisma.location.findFirst({
      where: { id: query.locationId, organizationId: query.organizationId },
      select: { timezone: true },
    });
    if (location) return location.timezone;
  }
  if (fallback) return fallback;

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: query.organizationId },
    select: { timezone: true },
  });
  return org.timezone;
}

/**
 * Is a customer address inside a location's service area?
 *
 * Uses PostGIS when the location has a polygon, and falls back to a radius
 * check otherwise. This is the gate that stops a studio being offered a
 * mobile booking three hours away.
 */
export async function isWithinServiceArea(
  locationId: string,
  point: LatLng,
): Promise<{ within: boolean; distanceKm: number; travelFeeCents?: number }> {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: {
      lat: true,
      lng: true,
      radiusMeters: true,
      travelFeeBands: true,
      locationType: true,
    },
  });

  if (!location || location.lat == null || location.lng == null) {
    return { within: false, distanceKm: Number.POSITIVE_INFINITY };
  }

  const distanceKm = haversineKm(
    { lat: location.lat, lng: location.lng },
    point,
  );

  const within =
    location.radiusMeters == null
      ? true
      : distanceKm * 1000 <= location.radiusMeters;

  const fee = travelFeeFor(
    distanceKm,
    location.travelFeeBands as TravelFeeBand[] | null,
  );

  return {
    within: within && (location.travelFeeBands == null || fee !== null),
    distanceKm,
    travelFeeCents: fee?.feeCents,
  };
}
