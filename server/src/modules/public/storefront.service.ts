import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';

/**
 * Everything the public storefront needs, in one read.
 *
 * Deliberately NOT folded into `getStudioPage`. That function's shape is
 * serialised into the booking page's `__BOOKING__` blob and read by the
 * booking client; widening it to carry marketing copy, staff bios and
 * per-service session lookaheads would ship all of that to every customer
 * mid-checkout, and would make the blob's "nothing secret in here" review a
 * much larger job every time either page changed.
 */

/** How far ahead a card looks for its "next available" line. */
const LOOKAHEAD_DAYS = 90;

export async function getStorefront(slug: string) {
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      currency: true,
      tagline: true,
      about: true,
      contactEmail: true,
      contactPhone: true,
      seoTitle: true,
      seoDescription: true,
      brandPreset: true,
      brandAccent: true,
      navCtaLabel: true,
      navCtaTarget: true,
    },
  });
  if (!organization) throw AppError.notFound('Studio not found.');

  const now = new Date();
  const horizon = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000);

  const [services, staff, guestsHosted, policy, pages] = await Promise.all([
    prisma.serviceType.findMany({
      where: {
        organizationId: organization.id,
        isActive: true,
        /* Same exclusion the booking page makes, and for the same reason: a
           COURSE_SERIES is the container for a cohort, and its priceCents is
           the per-class rate. Listing it would sell one week of six. */
        bookingMode: { not: 'COURSE_SERIES' },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        shortDescription: true,
        durationMinutes: true,
        capacityMax: true,
        priceCents: true,
        childPriceCents: true,
        color: true,
        colorAccent: true,
        emoji: true,
        meetingPoint: true,
        highlights: true,
        preparationNotes: true,
        bookingInstructions: true,
        category: { select: { id: true, name: true } },
        /* The per-service policy, when it names one of its own. `tiers` comes
           along so the detail page can state the actual refund ladder rather
           than the policy's name, which tells a customer nothing. */
        cancellationPolicy: { select: { name: true, tiers: true } },
        /*
          The next few departures, fetched with the service rather than per
          card. Six is enough for the detail page's list and one is enough for
          a card, so one bounded query answers both screens.
        */
        sessions: {
          where: {
            status: { not: 'CANCELLED' },
            startsAt: { gte: now, lte: horizon },
          },
          orderBy: { startsAt: 'asc' },
          take: 6,
          select: {
            id: true,
            startsAt: true,
            capacity: true,
            seatsTaken: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    }),

    prisma.staff.findMany({
      where: { organizationId: organization.id, isActive: true, isPublic: true },
      orderBy: { name: 'asc' },
      take: 6,
      select: { id: true, name: true, role: true, bio: true, color: true },
    }),

    /*
      Guests hosted: seats on bookings that have already happened.

      Past only, and cancelled excluded. A future booking is not somebody the
      studio has hosted, and counting it would make the number go DOWN when a
      class runs and somebody no-shows — a statistic that moves backwards is
      one nobody trusts twice.
    */
    prisma.booking.aggregate({
      where: {
        organizationId: organization.id,
        status: { not: 'CANCELLED' },
        startsAt: { lt: now },
      },
      _sum: { seats: true },
    }),

    /* The studio's default cancellation policy, for the hero stat and the
       reassurance line. Read rather than assumed — "24h" is the prototype's
       studio, not everybody's. */
    prisma.cancellationPolicy.findFirst({
      where: { organizationId: organization.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { name: true, tiers: true, rescheduleCutoffHours: true },
    }),

    prisma.sitePage.findMany({
      where: {
        organizationId: organization.id,
        status: 'PUBLISHED',
        showInNav: true,
      },
      orderBy: [{ navOrder: 'asc' }, { createdAt: 'asc' }],
      select: { path: true, title: true },
    }),
  ]);

  const categories = [
    ...new Map(
      services
        .filter((s) => s.category)
        .map((s) => [s.category!.id, s.category!.name]),
    ).values(),
  ].sort();

  return {
    organization,
    services,
    staff,
    categories,
    pages,
    stats: {
      experiences: services.length,
      guestsHosted: guestsHosted._sum.seats ?? 0,
      /* Null when the studio has no policy, or none of its tiers refunds in
         full — so the renderer leaves the tile out rather than printing a
         promise nobody made. */
      freeCancellationHours: freeCancellationHours(policy?.tiers),
    },
    policy,
  };
}

/**
 * "Free cancellation up to N hours before", derived from the refund ladder.
 *
 * The LOWEST tier that still refunds in full — that is the last moment a
 * customer can walk away whole, which is what the phrase promises. Reading
 * the highest instead would understate it; reading any tier below 100% would
 * advertise a partial refund as free, which is the kind of claim that ends in
 * a chargeback.
 *
 * Null when no tier refunds fully. A studio with a 50%-at-48-hours ladder has
 * no free-cancellation window and must not be given one.
 */
function freeCancellationHours(tiers: unknown): number | null {
  if (!Array.isArray(tiers)) return null;

  const full = tiers.filter(
    (t): t is { hoursBefore: number; refundPercent: number } =>
      typeof t === 'object' &&
      t !== null &&
      (t as { refundPercent?: unknown }).refundPercent === 100 &&
      typeof (t as { hoursBefore?: unknown }).hoursBefore === 'number',
  );

  if (full.length === 0) return null;
  return Math.min(...full.map((t) => t.hoursBefore));
}

export type Storefront = Awaited<ReturnType<typeof getStorefront>>;

/**
 * One service, for the detail page.
 *
 * Matched on `slug` first and id second: a studio's link should read
 * /a/beginner-wheel-throwing, but an id in the URL has to keep working
 * because that is what the booking page's own cards used to emit.
 */
export function findService(store: Storefront, idOrSlug: string) {
  return (
    store.services.find((s) => s.slug === idOrSlug) ??
    store.services.find((s) => s.id === idOrSlug) ??
    null
  );
}

/**
 * Filters, applied on the server.
 *
 * The whole storefront works without JavaScript, so search is a GET with
 * query parameters rather than a client-side array filter. That is not
 * purity: this is the page a studio links from its Instagram bio, and a
 * search that needs a bundle to run is a search that does not work on the
 * first paint on mobile data.
 */
export function filterServices(
  store: Storefront,
  filters: { q?: string; category?: string; date?: string },
) {
  const needle = filters.q?.trim().toLowerCase();

  return store.services.filter((service) => {
    if (filters.category && service.category?.name !== filters.category) {
      return false;
    }

    if (needle) {
      const haystack = [
        service.name,
        service.shortDescription ?? '',
        service.description ?? '',
        service.category?.name ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    if (filters.date) {
      /*
        Compared as the studio's local calendar date. A session at 9am on the
        7th is on the 7th for the person booking it, whatever UTC thinks, and
        matching on an ISO prefix of the instant would drop morning classes
        for any studio west of Greenwich.
      */
      const has = service.sessions.some(
        (s) =>
          new Intl.DateTimeFormat('en-CA', {
            timeZone: store.organization.timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(s.startsAt) === filters.date,
      );
      if (!has) return false;
    }

    return true;
  });
}
