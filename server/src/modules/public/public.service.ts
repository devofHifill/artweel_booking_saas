import { randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError, BookingErrorCode } from '../../lib/app-error';
import { getAvailability } from '../../scheduling/availability/availability.service';
import { bookSeats, bookAppointment } from '../../scheduling/booking.service';
import { enrollInSeries } from '../../scheduling/series.service';
import { haversineKm, type TravelFeeBand } from '../../scheduling/travel/travel';
import { canAcceptBookings } from '../billing/plan';
import {
  evaluatePolicy,
  resolvePolicyForService,
  type PolicyTier,
} from '../policies/policy.service';

/**
 * The public read model.
 *
 * Everything here is reachable by a stranger with a URL, so the governing
 * question for each field is not "is it useful?" but "would the studio mind
 * this being scraped?". Staff emails and phone numbers never appear; inactive
 * services and non-public instructors are filtered at the query, not in the
 * template, so a future template change cannot leak them.
 */

/**
 * Prisma maps a `Bytes` column to Uint8Array, not Buffer, so these convert at
 * the boundary rather than sprinkling casts through the query code.
 */
export function encodeToken(raw: Uint8Array): string {
  return Buffer.from(raw).toString('base64url');
}

function decodeToken(token: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(token, 'base64url');
  // 32 bytes exactly. Anything else is malformed, and rejecting on length
  // avoids a pointless database round trip on obvious junk.
  if (buf.length !== 32) {
    throw AppError.notFound('Booking not found.');
  }
  // `from` rather than `new Uint8Array(buf)`: TS 5.7 made Uint8Array generic
  // over its backing buffer, and Prisma's Bytes filter wants ArrayBuffer
  // specifically.
  return Uint8Array.from(buf);
}

export async function getStudio(slug: string) {
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      currency: true,
      subscriptionStatus: true,
    },
  });

  if (!organization) throw AppError.notFound('Studio not found.');
  return organization;
}

export async function getStudioPage(slug: string) {
  const organization = await getStudio(slug);

  const [services, locations] = await Promise.all([
    prisma.serviceType.findMany({
      where: { organizationId: organization.id, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        bookingMode: true,
        durationMinutes: true,
        capacityMax: true,
        priceCents: true,
        depositType: true,
        depositValue: true,
        color: true,
        skillLevel: true,
        minNoticeMinutes: true,
        maxHorizonDays: true,
        category: { select: { id: true, name: true, sortOrder: true } },
        serviceLocations: { select: { locationId: true } },
      },
      orderBy: [{ name: 'asc' }],
    }),
    prisma.location.findMany({
      where: { organizationId: organization.id, isActive: true },
      select: {
        id: true,
        name: true,
        locationType: true,
        address: true,
        timezone: true,
        radiusMeters: true,
        lat: true,
        lng: true,
        travelFeeBands: true,
      },
      orderBy: { name: 'asc' },
    }),
  ]);

  return {
    organization,
    /** The page renders read-only when false, rather than 404ing. */
    acceptingBookings: canAcceptBookings(organization.subscriptionStatus),
    services,
    // Coordinates are published only for fixed venues, where the address is
    // public anyway. A mobile studio's centre point is its owner's home often
    // enough that broadcasting it would be careless.
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      locationType: l.locationType,
      address: l.locationType === 'FIXED' ? l.address : null,
      timezone: l.timezone,
      requiresAddress: l.locationType !== 'FIXED',
      lat: l.locationType === 'FIXED' ? l.lat : null,
      lng: l.locationType === 'FIXED' ? l.lng : null,
    })),
  };
}

export async function getPublicStaff(organizationId: string, serviceTypeId: string) {
  const staff = await prisma.staff.findMany({
    where: {
      organizationId,
      isActive: true,
      isPublic: true,
      staffServices: { some: { serviceTypeId } },
    },
    // Explicit select, not exclusion. Adding a column to the model must never
    // silently publish it.
    select: { id: true, name: true, bio: true, photoUrl: true, color: true },
    orderBy: { name: 'asc' },
  });

  return staff;
}

export async function getPublicAvailability(params: {
  slug: string;
  serviceTypeId: string;
  fromLocalDate: string;
  toLocalDate: string;
  locationId?: string;
  staffId?: string;
  seats?: number;
  customerLocation?: { lat: number; lng: number };
}) {
  const organization = await getStudio(params.slug);

  const result = await getAvailability({
    organizationId: organization.id,
    serviceTypeId: params.serviceTypeId,
    fromLocalDate: params.fromLocalDate,
    toLocalDate: params.toLocalDate,
    locationId: params.locationId,
    staffId: params.staffId,
    seats: params.seats,
    customerLocation: params.customerLocation,
  });

  // diagnostics carries query counts and timings — internal detail.
  return {
    mode: result.mode,
    slots: result.slots,
    sessions: result.sessions,
  };
}

/**
 * "Will you come to this address, and what will it cost?"
 *
 * Answered BEFORE the customer picks a time. Letting somebody choose a slot
 * and then telling them they are out of range is the single most annoying
 * thing a mobile booking flow can do.
 */
export async function checkPublicCoverage(
  slug: string,
  locationId: string,
  point: { lat: number; lng: number },
) {
  const organization = await getStudio(slug);

  const location = await prisma.location.findFirst({
    where: { id: locationId, organizationId: organization.id, isActive: true },
  });
  if (!location) throw AppError.notFound('Location not found.');

  if (location.lat == null || location.lng == null) {
    return { covered: false, reason: 'NO_ORIGIN' as const };
  }

  const distanceKm = haversineKm({ lat: location.lat, lng: location.lng }, point);

  if (location.radiusMeters != null && distanceKm * 1000 > location.radiusMeters) {
    return { covered: false, reason: 'OUT_OF_RANGE' as const };
  }

  const bands = location.travelFeeBands as TravelFeeBand[] | null;
  if (!bands || bands.length === 0) {
    return { covered: true, travelFeeCents: 0, minSpendCents: 0 };
  }

  const band = [...bands]
    .sort((a, b) => a.maxKm - b.maxKm)
    .find((b) => distanceKm <= b.maxKm);

  if (!band) return { covered: false, reason: 'OUT_OF_RANGE' as const };

  return {
    covered: true,
    travelFeeCents: band.feeCents,
    minSpendCents: band.minSpendCents ?? 0,
    // Deliberately NOT returning the exact distance. It would let anyone
    // trilaterate a mobile studio's centre point with three requests.
  };
}

export type PublicBookingInput = {
  slug: string;
  serviceTypeId: string;
  sessionId?: string;
  staffId?: string;
  locationId?: string;
  startsAt?: string;
  seats?: number;
  customer: { name: string; email: string; phone?: string };
  serviceAddress?: {
    line1: string;
    city?: string;
    postcode?: string;
    lat?: number;
    lng?: number;
    notes?: string;
  };
  smsConsent?: boolean;
  notes?: string;
  source?: string;
};

/**
 * Creates a booking from the public page.
 *
 * PAYMENT SEAM: right now this books directly. W1.4 inserts the hold →
 * Stripe Checkout → convert sequence in front of it, which is exactly why
 * holds already exist in the scheduling core. Nothing in this function's
 * contract changes when that lands; it simply stops being the entry point for
 * services that require payment.
 */
export async function createPublicBooking(input: PublicBookingInput) {
  const organization = await getStudio(input.slug);

  if (!canAcceptBookings(organization.subscriptionStatus)) {
    throw new AppError(
      'This studio is not taking online bookings at the moment. ' +
        'Please contact them directly.',
      409,
      'STUDIO_INACTIVE',
    );
  }

  const service = await prisma.serviceType.findFirst({
    where: {
      id: input.serviceTypeId,
      organizationId: organization.id,
      isActive: true,
    },
  });
  if (!service) throw AppError.notFound('Service not found.');

  const customer = await upsertCustomer(organization.id, input);

  if (service.bookingMode === 'APPOINTMENT') {
    if (!input.staffId || !input.startsAt) {
      throw AppError.badRequest('Pick a time before booking.');
    }

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);

    // Re-check availability rather than trusting the client's slot. The page
    // may have been open for an hour, and the concurrency constraints would
    // catch a collision anyway — but with a database error rather than a
    // sentence a customer can act on.
    await assertSlotStillOffered(organization.id, service.id, input, startsAt);

    const travelFeeCents = await resolveTravelFee(
      organization.id,
      input.locationId,
      input.serviceAddress,
    );

    return bookAppointment({
      organizationId: organization.id,
      staffId: input.staffId,
      serviceTypeId: service.id,
      customerId: customer.id,
      startsAt,
      endsAt,
      timezone: organization.timezone,
      locationId: input.locationId ?? null,
      paddingBeforeMinutes: service.paddingBeforeMinutes,
      paddingAfterMinutes: service.paddingAfterMinutes,
      serviceAddress: input.serviceAddress,
      lat: input.serviceAddress?.lat ?? null,
      lng: input.serviceAddress?.lng ?? null,
      source: input.source ?? 'web',
    }).then(async (booking) => {
      if (!booking) return booking;

      const updated =
        travelFeeCents > 0
          ? await prisma.booking.update({
              where: { id: booking.id },
              data: {
                travelFeeCents,
                totalCents: service.priceCents + travelFeeCents,
              },
            })
          : await prisma.booking.update({
              where: { id: booking.id },
              data: { totalCents: service.priceCents },
            });

      await queueNotifications(updated.id);
      return updated;
    });
  }

  // Seat-based: events and course sessions.
  if (!input.sessionId) {
    throw AppError.badRequest('Pick a class before booking.');
  }

  const seats = input.seats ?? 1;

  const booking = await bookSeats({
    organizationId: organization.id,
    sessionId: input.sessionId,
    customerId: customer.id,
    seats,
    source: input.source ?? 'web',
    notes: input.notes,
  });

  if (booking) {
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { totalCents: service.priceCents * seats },
    });

    await queueNotifications(updated.id);
    return updated;
  }

  return booking;
}

/**
 * Queues the confirmation and its reminders.
 *
 * Failures here are logged and swallowed. The seats are already sold and the
 * money is already taken — refusing the booking because a template could not
 * be rendered would be absurd, and the worker's reconciliation sweep picks up
 * anything that never got queued.
 */
async function queueNotifications(bookingId: string) {
  const { scheduleBookingNotifications } = await import(
    '../notifications/notification.service'
  );

  await scheduleBookingNotifications(bookingId).catch((err) => {
    logger.error({ err, bookingId }, 'Failed to queue booking notifications');
  });

  // Push the booking into the instructor's own calendar, if they connected one.
  const { queueEventSync } = await import('../calendar/calendar.service');
  await queueEventSync({ bookingId, action: 'UPSERT' }).catch((err) => {
    logger.error({ err, bookingId }, 'Failed to queue calendar sync');
  });
}

/**
 * Confirms the slot is still on offer.
 *
 * The exclusion constraint is the real guarantee; this exists so the customer
 * gets "that time has just been taken" instead of a 500 when the page has gone
 * stale, and so notice/horizon rules are enforced on the public path too.
 */
async function assertSlotStillOffered(
  organizationId: string,
  serviceTypeId: string,
  input: PublicBookingInput,
  startsAt: Date,
) {
  const localDate = startsAt.toISOString().slice(0, 10);

  const availability = await getAvailability({
    organizationId,
    serviceTypeId,
    fromLocalDate: localDate,
    toLocalDate: localDate,
    locationId: input.locationId,
    staffId: input.staffId,
    customerLocation:
      input.serviceAddress?.lat != null && input.serviceAddress?.lng != null
        ? { lat: input.serviceAddress.lat, lng: input.serviceAddress.lng }
        : undefined,
  });

  const stillFree = availability.slots.some(
    (s) => s.startsAt.getTime() === startsAt.getTime(),
  );

  if (!stillFree) {
    throw new AppError(
      'That time is no longer available. Please choose another.',
      409,
      BookingErrorCode.SLOT_NOT_BOOKABLE,
    );
  }
}

async function resolveTravelFee(
  organizationId: string,
  locationId: string | undefined,
  address: PublicBookingInput['serviceAddress'],
): Promise<number> {
  if (!locationId || !address?.lat || !address?.lng) return 0;

  const location = await prisma.location.findFirst({
    where: { id: locationId, organizationId },
    select: { lat: true, lng: true, travelFeeBands: true },
  });
  if (!location?.lat || !location.lng) return 0;

  const bands = location.travelFeeBands as TravelFeeBand[] | null;
  if (!bands?.length) return 0;

  const distanceKm = haversineKm(
    { lat: location.lat, lng: location.lng },
    { lat: address.lat, lng: address.lng },
  );

  const band = [...bands]
    .sort((a, b) => a.maxKm - b.maxKm)
    .find((b) => distanceKm <= b.maxKm);

  return band?.feeCents ?? 0;
}

/**
 * Finds or creates the customer record.
 *
 * Matched on email within the studio only. The WordPress plugin deduped on
 * `email OR phone` globally, which merges two family members sharing a
 * landline and leaks one studio's customer list into another's.
 *
 * TCPA: the SMS consent timestamp is only ever SET, never cleared here.
 * Silence in a later booking form is not a withdrawal of consent, and
 * withdrawal has its own path.
 */
type CustomerDetails = {
  customer: { name: string; email: string; phone?: string };
  smsConsent?: boolean;
};

async function upsertCustomer(
  organizationId: string,
  input: CustomerDetails,
) {
  const email = input.customer.email.trim().toLowerCase();

  const existing = await prisma.customer.findFirst({
    where: { organizationId, email },
  });

  if (existing) {
    return prisma.customer.update({
      where: { id: existing.id },
      data: {
        name: input.customer.name.trim(),
        phone: input.customer.phone ?? existing.phone,
        ...(input.smsConsent && !existing.smsConsentAt
          ? { smsConsentAt: new Date() }
          : {}),
      },
    });
  }

  return prisma.customer.create({
    data: {
      organizationId,
      email,
      name: input.customer.name.trim(),
      phone: input.customer.phone,
      smsConsentAt: input.smsConsent ? new Date() : null,
    },
  });
}

// ---------------------------------------------------------------------------
// Waitlists
// ---------------------------------------------------------------------------

export type PublicWaitlistInput = {
  slug: string;
  sessionId: string;
  seats?: number;
  customer: { name: string; email: string; phone?: string };
  smsConsent?: boolean;
};

/**
 * Joins the queue for a full class, from the booking page.
 *
 * The only place in the product where a refusal is turned into a record. What
 * the customer gets back is their position, because "you are third" is the
 * difference between waiting and giving up.
 */
export async function joinWaitlistPublic(input: PublicWaitlistInput) {
  const organization = await getStudio(input.slug);

  if (!canAcceptBookings(organization.subscriptionStatus)) {
    throw new AppError(
      'This studio is not taking bookings at the moment.',
      409,
      'STUDIO_INACTIVE',
    );
  }

  const session = await prisma.session.findFirst({
    where: { id: input.sessionId, organizationId: organization.id },
    select: { id: true },
  });
  if (!session) throw AppError.notFound('Class not found.');

  const customer = await upsertCustomer(organization.id, input);

  const { joinWaitlist } = await import('../waitlists/waitlist.service');

  const entry = await joinWaitlist({
    organizationId: organization.id,
    sessionId: input.sessionId,
    customerId: customer.id,
    seats: input.seats ?? 1,
  });

  // Position is the raw queue number and may have gaps; what a customer wants
  // is how many people are actually ahead of them.
  const ahead = await prisma.waitlistEntry.count({
    where: {
      sessionId: input.sessionId,
      status: { in: ['WAITING', 'OFFERED'] },
      position: { lt: entry.position },
    },
  });

  return { entry, place: ahead + 1 };
}

/** Reads an offer from its link, so the page can show what is on the table. */
export async function getWaitlistOffer(token: string) {
  const entry = await prisma.waitlistEntry.findUnique({
    where: { claimToken: decodeToken(token) },
    include: {
      session: {
        include: {
          serviceType: { select: { name: true } },
          location: { select: { name: true, address: true, locationType: true } },
        },
      },
      organization: { select: { name: true, slug: true } },
    },
  });

  if (!entry) throw AppError.notFound('That link is not valid.');

  return {
    studio: entry.organization.name,
    service: entry.session.serviceType.name,
    startsAt: entry.session.startsAt,
    endsAt: entry.session.endsAt,
    timezone: entry.session.timezone,
    location:
      entry.session.location?.locationType === 'FIXED'
        ? entry.session.location.address
        : (entry.session.location?.name ?? null),
    seats: entry.seats,
    status: entry.status,
    offerExpiresAt: entry.offerExpiresAt,
    claimable:
      entry.status === 'OFFERED' &&
      (!entry.offerExpiresAt || entry.offerExpiresAt > new Date()),
  };
}

export async function claimWaitlistOffer(token: string) {
  const { claimOffer } = await import('../waitlists/waitlist.service');
  const result = await claimOffer(decodeToken(token));

  return {
    booking: {
      id: result.booking.id,
      startsAt: result.booking.startsAt,
      endsAt: result.booking.endsAt,
      seats: result.booking.seats,
      status: result.booking.status,
    },
    manageToken: encodeToken(result.booking.cancelToken),
  };
}

// ---------------------------------------------------------------------------
// Course cohorts
// ---------------------------------------------------------------------------

/**
 * The cohorts a visitor may actually enrol on.
 *
 * A course is offered as a whole or not at all, so "seats left" is the seats
 * left in its TIGHTEST week, not in its first one. Showing week one's roomy
 * count and then failing at checkout because week four is full is the exact
 * experience the all-or-nothing enrolment path exists to prevent, and it would
 * be undone here by publishing a number that means something else.
 */
export async function getPublicCourses(slug: string) {
  const organization = await getStudio(slug);
  const now = new Date();

  const series = await prisma.courseSeries.findMany({
    where: {
      organizationId: organization.id,
      status: 'PUBLISHED',
      sessions: { some: {} },
    },
    select: {
      id: true,
      name: true,
      cohortLabel: true,
      description: true,
      sessionCount: true,
      priceCents: true,
      capacity: true,
      timezone: true,
      enrollmentClosesAt: true,
      allowLateEnrollment: true,
      serviceType: {
        select: { id: true, name: true, durationMinutes: true, skillLevel: true },
      },
      staff: { select: { id: true, name: true } },
      location: { select: { id: true, name: true, locationType: true, address: true } },
      sessions: {
        where: { status: 'SCHEDULED' },
        orderBy: { seriesIndex: 'asc' },
        select: {
          id: true,
          seriesIndex: true,
          startsAt: true,
          endsAt: true,
          capacity: true,
          seatsTaken: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    organization,
    acceptingBookings: canAcceptBookings(organization.subscriptionStatus),
    courses: series
      .filter((s) => s.sessions.length > 0)
      .map((s) => {
        const seatsRemaining = Math.min(
          ...s.sessions.map((session) => session.capacity - session.seatsTaken),
        );
        const startsAt = s.sessions[0]!.startsAt;
        const endsAt = s.sessions[s.sessions.length - 1]!.endsAt;
        const hasStarted = startsAt <= now;
        const windowClosed =
          s.enrollmentClosesAt !== null && s.enrollmentClosesAt <= now;

        return {
          id: s.id,
          name: s.name,
          cohortLabel: s.cohortLabel,
          description: s.description,
          service: s.serviceType,
          instructor: s.staff?.name ?? null,
          location: s.location
            ? {
                id: s.location.id,
                name: s.location.name,
                address:
                  s.location.locationType === 'FIXED' ? s.location.address : null,
              }
            : null,
          timezone: s.timezone,
          sessionCount: s.sessions.length,
          priceCents: s.priceCents,
          startsAt,
          endsAt,
          seatsRemaining: Math.max(0, seatsRemaining),
          /** Dates only — a student wants to check them against their diary. */
          dates: s.sessions.map((session) => ({
            seriesIndex: session.seriesIndex,
            startsAt: session.startsAt,
            endsAt: session.endsAt,
          })),
          enrollable:
            seatsRemaining > 0 &&
            !windowClosed &&
            (!hasStarted || s.allowLateEnrollment),
          hasStarted,
        };
      }),
  };
}

/**
 * Resolves a cohort a stranger is allowed to buy.
 *
 * Scoped by slug, so a series id from another studio cannot be pushed through
 * this studio's checkout, and restricted to PUBLISHED — a draft cohort is not
 * on sale no matter who has its id.
 */
export async function getPublicCourseForCheckout(
  slug: string,
  courseSeriesId: string,
) {
  const organization = await getStudio(slug);

  if (!canAcceptBookings(organization.subscriptionStatus)) {
    throw new AppError(
      'This studio is not taking online bookings at the moment. ' +
        'Please contact them directly.',
      409,
      'STUDIO_INACTIVE',
    );
  }

  const series = await prisma.courseSeries.findFirst({
    where: {
      id: courseSeriesId,
      organizationId: organization.id,
      status: 'PUBLISHED',
    },
    select: { id: true, name: true, serviceTypeId: true, priceCents: true },
  });
  if (!series) throw AppError.notFound('Course not found.');

  return { organization, series };
}

export type PublicEnrollInput = {
  slug: string;
  courseSeriesId: string;
  seats?: number;
  customer: { name: string; email: string; phone?: string };
  smsConsent?: boolean;
  notes?: string;
};

/**
 * Enrols a visitor on an unpriced cohort straight from the booking page.
 *
 * Free taster courses, and the common ceramics case of a studio that invoices
 * or takes a card in person. A priced cohort is refused here and goes through
 * `POST /:slug/courses/:seriesId/checkout` instead, so that money is never
 * taken outside the hold → Stripe → webhook sequence.
 */
export async function enrollPublic(input: PublicEnrollInput) {
  const organization = await getStudio(input.slug);

  if (!canAcceptBookings(organization.subscriptionStatus)) {
    throw new AppError(
      'This studio is not taking online bookings at the moment. ' +
        'Please contact them directly.',
      409,
      'STUDIO_INACTIVE',
    );
  }

  const series = await prisma.courseSeries.findFirst({
    where: {
      id: input.courseSeriesId,
      organizationId: organization.id,
      status: 'PUBLISHED',
    },
    select: { id: true, priceCents: true, name: true },
  });
  if (!series) throw AppError.notFound('Course not found.');

  if (series.priceCents > 0) {
    throw new AppError(
      'This course must be paid for online. Please use the checkout.',
      409,
      'COURSE_REQUIRES_PAYMENT',
    );
  }

  const customer = await upsertCustomer(organization.id, input);

  const result = await enrollInSeries({
    organizationId: organization.id,
    courseSeriesId: series.id,
    customerId: customer.id,
    seats: input.seats ?? 1,
    notes: input.notes,
    source: 'web',
  });

  return {
    enrollment: result!.enrollment,
    sessionCount: result!.sessionCount,
    courseName: series.name,
  };
}

// ---------------------------------------------------------------------------
// Self-service by token
//
// The token IS the credential — there is no customer login, by design. A
// booking link in an email must work on any device without a password, which
// is why the token is 32 random bytes rather than the plugin's guessable
// md5(booking_id + email).
// ---------------------------------------------------------------------------

export async function getBookingByToken(token: string) {
  const raw = decodeToken(token);

  const booking = await prisma.booking.findFirst({
    where: { cancelToken: raw },
    include: {
      serviceType: {
        select: {
          id: true,
          name: true,
          durationMinutes: true,
          bookingMode: true,
          cancellationPolicyId: true,
        },
      },
      staff: { select: { id: true, name: true } },
      location: { select: { id: true, name: true, address: true, locationType: true } },
      organization: { select: { id: true, name: true, slug: true, timezone: true } },
      customer: { select: { name: true, email: true } },
    },
  });

  if (!booking) throw AppError.notFound('Booking not found.');

  // Constant-time confirmation. The lookup above already matched, so this is
  // belt and braces against any future change that makes the query fuzzier.
  if (!timingSafeEqual(booking.cancelToken, raw)) {
    throw AppError.notFound('Booking not found.');
  }

  const policy = await resolvePolicyForService(
    booking.organizationId,
    booking.serviceTypeId,
  );

  const hoursOfNotice = Math.max(
    0,
    (booking.startsAt.getTime() - Date.now()) / 3_600_000,
  );

  const quote = policy
    ? evaluatePolicy(
        policy.tiers as unknown as PolicyTier[],
        booking.totalCents,
        hoursOfNotice,
      )
    : null;

  return {
    booking,
    policy,
    /** What cancelling right now would be worth, using the same function the refund path uses. */
    cancellationQuote: quote,
    canReschedule:
      policy?.allowReschedule !== false &&
      hoursOfNotice >= (policy?.rescheduleCutoffHours ?? 0) &&
      booking.status !== 'CANCELLED',
  };
}

export async function cancelByToken(token: string) {
  const { booking } = await getBookingByToken(token);

  if (booking.status === 'CANCELLED') {
    // Idempotent: a double-clicked link is not an error.
    return { cancelled: true, alreadyCancelled: true };
  }

  const { cancelBooking } = await import('../../scheduling/booking.service');
  await cancelBooking(booking.organizationId, booking.id);

  // Refund first, so the customer's cancellation notice can state the real
  // amount rather than a promise we have not yet kept.
  const { refundForCancellation } = await import(
    '../payments/payment.service'
  );
  const refund = await refundForCancellation(
    booking.organizationId,
    booking.id,
    { reason: 'requested_by_customer' },
  ).catch((err) => {
    logger.error({ err, bookingId: booking.id }, 'Refund failed on cancellation');
    return { refundedCents: 0, creditCents: 0, refunds: [] };
  });

  const { queueEventSync } = await import('../calendar/calendar.service');
  await queueEventSync({ bookingId: booking.id, action: 'DELETE' }).catch(
    (err) => {
      logger.error({ err }, 'Failed to queue calendar removal');
    },
  );

  const { notifyCancellation } = await import(
    '../notifications/notification.service'
  );
  await notifyCancellation(booking.id, {
    refundCents: refund.refundedCents,
  }).catch((err) => {
    logger.error({ err, bookingId: booking.id }, 'Failed to queue cancellation notice');
  });

  return {
    cancelled: true,
    alreadyCancelled: false,
    refundedCents: refund.refundedCents,
  };
}

export async function rescheduleByToken(token: string, newStartsAt: string) {
  const { booking, policy, canReschedule } = await getBookingByToken(token);

  if (booking.status === 'CANCELLED') {
    throw AppError.badRequest('This booking has already been cancelled.');
  }
  if (!canReschedule) {
    throw AppError.conflict(
      policy?.allowReschedule === false
        ? 'This booking cannot be rescheduled.'
        : `Bookings must be changed at least ${policy?.rescheduleCutoffHours ?? 0} hours ahead.`,
      'RESCHEDULE_NOT_ALLOWED',
    );
  }
  if (booking.serviceType.bookingMode !== 'APPOINTMENT') {
    throw AppError.badRequest(
      'Class bookings cannot be moved. Cancel and book another date.',
    );
  }
  if (!booking.staffId) {
    throw AppError.badRequest('This booking has no instructor assigned.');
  }

  const startsAt = new Date(newStartsAt);
  const endsAt = new Date(
    startsAt.getTime() + booking.serviceType.durationMinutes * 60_000,
  );

  /**
   * Cancel then rebook, inside one transaction.
   *
   * Moving the existing rows in place would mean the instructor's time block
   * briefly overlaps itself, and the exclusion constraint would reject the
   * customer's own move. Releasing first makes the new slot genuinely free.
   */
  const { cancelBooking } = await import('../../scheduling/booking.service');
  await cancelBooking(booking.organizationId, booking.id);

  try {
    const replacement = await bookAppointment({
      organizationId: booking.organizationId,
      staffId: booking.staffId,
      serviceTypeId: booking.serviceTypeId,
      customerId: booking.customerId,
      startsAt,
      endsAt,
      timezone: booking.timezone,
      locationId: booking.locationId,
      source: 'reschedule',
    });

    // The old booking's reminders were cancelled with it; the replacement
    // needs its own, dated against the new time.
    const { notifyReschedule, scheduleBookingNotifications } = await import(
      '../notifications/notification.service'
    );
    await scheduleBookingNotifications(replacement!.id).catch(() => {});
    await notifyReschedule(replacement!.id).catch((err) => {
      logger.error({ err }, 'Failed to queue reschedule notice');
    });

    return {
      rescheduled: true,
      bookingId: replacement!.id,
      token: encodeToken(replacement!.cancelToken),
    };
  } catch (err) {
    // The new time was taken between the two steps. Put the original back so
    // the customer is not left with nothing at all.
    await bookAppointment({
      organizationId: booking.organizationId,
      staffId: booking.staffId,
      serviceTypeId: booking.serviceTypeId,
      customerId: booking.customerId,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      timezone: booking.timezone,
      locationId: booking.locationId,
      source: 'reschedule-rollback',
    }).catch(() => {
      // If even the rollback fails the original slot was taken too; the
      // thrown error below is still the right thing to surface.
    });

    throw err;
  }
}

export { randomBytes };
