import { Prisma, type Plan, type SubscriptionStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { PLANS } from '../billing/plan';
import { getOnboardingState } from '../onboarding/onboarding.service';
import {
  countryForTimezone,
  MAPPED_TIMEZONES,
  timezonesForCountry,
} from './insights.service';

/**
 * Reading the platform: which studios exist, what state they are in.
 *
 * All of it is OUR data about our customers, so none of it goes through
 * `withOrganization` — there is no tenant to scope to. Looking inside a studio
 * at its bookings and customers is a different capability (support sessions,
 * S7) and keeps the choke point.
 */

export type StudioSort =
  | 'createdAt'
  | 'name'
  | 'trialEndsAt'
  | 'lastBookingAt';

/** Stripe Connect state, as three answers rather than two booleans. */
export type StripeFilter = 'connected' | 'restricted' | 'none';

/** Presets rather than a date picker: these are the questions actually asked. */
export type CreatedFilter = '30d' | '90d' | '12m';

export type StudioListQuery = {
  search?: string;
  status?: SubscriptionStatus;
  plan?: Plan;
  /** Derived from the studio's timezone — no studio declares a country. */
  country?: string;
  stripe?: StripeFilter;
  created?: CreatedFilter;
  sort?: StudioSort;
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

/**
 * Per-studio counts, gathered as ONE grouped query per relation rather than a
 * handful per row.
 *
 * The N+1 version is invisible at ten studios and is the thing that makes this
 * screen unusable at a thousand — and it is the screen most likely to be left
 * open all day. Even so this is not free forever: `groupBy` over the whole
 * bookings table grows with total bookings, not with the page size. When studio
 * count gets into the hundreds, move counts to the detail view only or
 * precompute a rollup. Named here so the decision is made deliberately rather
 * than discovered.
 */
async function countsFor(organizationIds: string[]) {
  if (organizationIds.length === 0) {
    return new Map<string, StudioCounts>();
  }

  const where = { organizationId: { in: organizationIds } };

  const [staff, locations, customers, bookings, lastBookings] = await Promise.all([
    prisma.staff.groupBy({
      by: ['organizationId'],
      where: { ...where, isActive: true },
      _count: { _all: true },
    }),
    prisma.location.groupBy({
      by: ['organizationId'],
      where: { ...where, isActive: true },
      _count: { _all: true },
    }),
    prisma.customer.groupBy({
      by: ['organizationId'],
      where,
      _count: { _all: true },
    }),
    prisma.booking.groupBy({
      by: ['organizationId'],
      where,
      _count: { _all: true },
    }),
    prisma.booking.groupBy({
      by: ['organizationId'],
      where,
      _max: { createdAt: true },
    }),
  ]);

  const map = new Map<string, StudioCounts>();
  for (const id of organizationIds) {
    map.set(id, { staff: 0, locations: 0, customers: 0, bookings: 0, lastBookingAt: null });
  }

  for (const row of staff) {
    map.get(row.organizationId)!.staff = row._count._all;
  }
  for (const row of locations) {
    map.get(row.organizationId)!.locations = row._count._all;
  }
  for (const row of customers) {
    map.get(row.organizationId)!.customers = row._count._all;
  }
  for (const row of bookings) {
    map.get(row.organizationId)!.bookings = row._count._all;
  }
  for (const row of lastBookings) {
    map.get(row.organizationId)!.lastBookingAt = row._max.createdAt;
  }

  return map;
}

export type StudioCounts = {
  staff: number;
  /** Active only, matching how the plan limit is enforced on create. */
  locations: number;
  customers: number;
  bookings: number;
  lastBookingAt: Date | null;
};

const DAY_MS = 86_400_000;

/** Stripe Connect state expressed as a where-clause. */
function stripeWhere(filter: StripeFilter): Prisma.OrganizationWhereInput {
  if (filter === 'none') return { stripeAccountId: null };
  if (filter === 'connected') {
    return {
      stripeAccountId: { not: null },
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    };
  }
  /* Restricted is the interesting one: an account exists, so the studio thinks
     it is set up, but Stripe will not let money move in one direction or the
     other. */
  return {
    stripeAccountId: { not: null },
    OR: [{ stripeChargesEnabled: false }, { stripePayoutsEnabled: false }],
  };
}

function buildWhere(query: StudioListQuery): Prisma.OrganizationWhereInput {
  const search = query.search?.trim();

  const createdSince =
    query.created === '30d'
      ? 30
      : query.created === '90d'
        ? 90
        : query.created === '12m'
          ? 365
          : null;

  /* Country is derived from the timezone, so filtering by it means filtering
     by the set of zones that map to it. "Other" is everything unmapped, which
     has to be expressed as an exclusion rather than a list. */
  const zones = query.country ? timezonesForCountry(query.country) : undefined;

  return {
    ...(query.status ? { subscriptionStatus: query.status } : {}),
    ...(query.plan ? { plan: query.plan } : {}),
    ...(query.stripe ? stripeWhere(query.stripe) : {}),
    ...(createdSince
      ? { createdAt: { gte: new Date(Date.now() - createdSince * DAY_MS) } }
      : {}),
    ...(zones === undefined
      ? {}
      : zones === null
        ? { timezone: { notIn: MAPPED_TIMEZONES } }
        : { timezone: { in: zones } }),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { slug: { contains: search, mode: 'insensitive' as const } },
            // Searching by the owner's address is how a support email is
            // actually turned into a studio — the sender rarely mentions the
            // studio name, and never the slug.
            {
              memberships: {
                some: {
                  role: 'OWNER',
                  user: {
                    email: { contains: search, mode: 'insensitive' as const },
                  },
                },
              },
            },
          ],
        }
      : {}),
  };
}

/**
 * The counts above the table.
 *
 * Deliberately NOT filtered by the query: these describe the platform, and a
 * strip that moved every time somebody typed in the search box would stop being
 * a reference point. Only "added in 30 days" is a window, and it says so.
 *
 * Cancelled carries no time qualifier because it cannot: nothing records WHEN a
 * studio cancelled, so "cancelled in the last 12 months" is unanswerable and
 * this is the all-time figure instead.
 */
async function summarise() {
  const [byStatus, total, addedLast30Days] = await Promise.all([
    prisma.organization.groupBy({
      by: ['subscriptionStatus'],
      _count: { _all: true },
    }),
    prisma.organization.count(),
    prisma.organization.count({
      where: { createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) } },
    }),
  ]);

  const by = new Map(byStatus.map((r) => [r.subscriptionStatus, r._count._all]));
  const active = by.get('ACTIVE') ?? 0;

  return {
    total,
    active,
    activePct: total > 0 ? Math.round((active / total) * 100) : 0,
    trialing: by.get('TRIALING') ?? 0,
    pastDue: by.get('PAST_DUE') ?? 0,
    suspended: by.get('SUSPENDED') ?? 0,
    cancelled: by.get('CANCELED') ?? 0,
    addedLast30Days,
  };
}

export async function listStudios(query: StudioListQuery = {}) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const where = buildWhere(query);

  /**
   * `lastBookingAt` is not a column, so it cannot be an ORDER BY. Sorting by it
   * would mean either a join-and-aggregate over every booking or fetching
   * everything and sorting in memory — the first is a real query to write, the
   * second stops working at exactly the scale you would want the sort. Falls
   * back to newest-first and the response says so, rather than silently
   * returning a different order than was asked for.
   */
  const sortable = query.sort && query.sort !== 'lastBookingAt' ? query.sort : 'createdAt';
  const direction = query.direction ?? (sortable === 'name' ? 'asc' : 'desc');

  const [total, organizations, summary, timezones] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      orderBy: { [sortable]: direction },
      take: limit,
      skip: offset,
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        gracePeriodEndsAt: true,
        currentPeriodEnd: true,
        onboardingDoneAt: true,
        stripeAccountId: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        subscribedPriceCents: true,
        timezone: true,
        signupSource: true,
        createdAt: true,
        memberships: {
          where: { role: 'OWNER' },
          take: 1,
          orderBy: { createdAt: 'asc' },
          select: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    }),
    summarise(),
    /* Only the countries that actually have a studio, so the filter never
       offers one that returns nothing. */
    prisma.organization.findMany({
      distinct: ['timezone'],
      select: { timezone: true },
    }),
  ]);

  const counts = await countsFor(organizations.map((o) => o.id));

  return {
    total,
    limit,
    offset,
    summary,
    availableCountries: [
      ...new Set(timezones.map((t) => countryForTimezone(t.timezone))),
    ].sort((a, b) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b))),
    sortedBy: sortable,
    direction,
    /** True when the requested sort could not be honoured. */
    sortFellBack: Boolean(query.sort && query.sort !== sortable),
    studios: organizations.map((org) => {
      const { memberships, ...rest } = org;

      return {
        ...rest,
        /**
         * Onboarding read straight off the column here rather than through
         * `getOnboardingState`, which runs five queries per studio — fine for
         * one studio's detail view, not for a page of fifty. It is the same
         * fact: that function's `complete` is exactly this column being set.
         */
        onboardingComplete: org.onboardingDoneAt !== null,
        owner: memberships[0]?.user ?? null,
        counts: counts.get(org.id)!,

        /* Derived, not declared — see countryForTimezone. */
        country: countryForTimezone(org.timezone),

        /* The limits this studio is measured against, so the row can render
           "4 / 5" without the client needing its own copy of the plan table. */
        limits: {
          maxStaff: PLANS[org.plan].maxStaff,
          maxLocations: PLANS[org.plan].maxLocations,
        },

        /*
          What this studio actually pays, monthly. Null unless ACTIVE: a
          trialing or cancelled studio pays nothing, and printing the list
          price against it would read as revenue.
        */
        mrrCents:
          org.subscriptionStatus === 'ACTIVE'
            ? (org.subscribedPriceCents ?? PLANS[org.plan].priceCentsMonthly)
            : null,

        stripeState: org.stripeAccountId === null
          ? ('none' as const)
          : org.stripeChargesEnabled && org.stripePayoutsEnabled
            ? ('connected' as const)
            : ('restricted' as const),
      };
    }),
  };
}

export type StudioWarning = {
  code: string;
  message: string;
};

/**
 * States that are legal, intended, and would be dangerous to leave unnoticed.
 *
 * These are not validation errors — every one of them is a state an operator
 * deliberately created. The point is that the consequences arrive later and
 * elsewhere: on a studio's card statement, or as a booking page that stayed dark
 * after somebody thought they had turned it back on. Surfacing them here is the
 * whole mitigation for decisions taken knowingly.
 */
function studioWarnings(org: {
  compedAt: Date | null;
  billingSubscriptionId: string | null;
  subscriptionStatus: string;
  suspendedByPlatformAt: Date | null;
  suspendedReason: string | null;
  stripeChargesEnabled: boolean;
}): StudioWarning[] {
  const warnings: StudioWarning[] = [];

  /**
   * The one that exists because comping deliberately does not touch Stripe.
   * The studio has been told the account is free and their card is still being
   * charged every month — visible here, or discovered by them.
   */
  if (org.compedAt && org.billingSubscriptionId) {
    warnings.push({
      code: 'COMPED_BUT_STILL_BILLING',
      message:
        'This studio is comped but still has a live Stripe subscription, so ' +
        'their card is still being charged. Cancel it in the Stripe dashboard ' +
        'if that is not intended.',
    });
  }

  if (org.suspendedByPlatformAt) {
    warnings.push({
      code: 'PLATFORM_SUSPENDED',
      message:
        `Suspended by the platform${org.suspendedReason ? `: ${org.suspendedReason}` : ''}. ` +
        'A successful payment will not lift this — only an unsuspend will.',
    });
  }

  /**
   * A studio that is live and cannot take money. Legal — plenty of studios take
   * cash at the door, which is why payments is an optional onboarding step — but
   * worth seeing next to a support question about a failed checkout.
   */
  if (!org.stripeChargesEnabled && org.subscriptionStatus !== 'SUSPENDED') {
    warnings.push({
      code: 'NO_CONNECTED_PAYMENTS',
      message:
        'Stripe Connect charges are not enabled, so this studio cannot take ' +
        'online payment. Deposits and paid classes will fail.',
    });
  }

  return warnings;
}

export async function getStudio(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      memberships: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: {
            select: { id: true, name: true, email: true, emailVerifiedAt: true },
          },
        },
      },
    },
  });

  if (!org) {
    throw AppError.notFound('Studio not found.', 'STUDIO_NOT_FOUND');
  }

  const [counts, onboarding] = await Promise.all([
    countsFor([org.id]),
    // The full step breakdown is worth its five queries for a single studio —
    // "signed up and never finished" is only actionable if you can see WHICH
    // step they stopped at.
    getOnboardingState(org.id),
  ]);

  const { memberships, ...rest } = org;

  return {
    studio: {
      ...rest,
      counts: counts.get(org.id)!,
      planDefinition: PLANS[org.plan],
    },
    warnings: studioWarnings(org),
    members: memberships,
    onboarding: {
      complete: onboarding.complete,
      readyToPublish: onboarding.readyToPublish,
      steps: onboarding.steps,
      bookingUrl: onboarding.bookingUrl,
    },
  };
}

/**
 * The studio list as CSV, honouring whatever filters are on screen.
 *
 * Exports the FILTERED set rather than everything: an operator who has narrowed
 * to "restricted Stripe accounts in Germany" wants those rows, and handing them
 * the whole platform instead is the kind of helpfulness that gets a spreadsheet
 * quietly filtered by hand and got wrong.
 *
 * Capped, because a CSV is built entirely in memory before it is sent.
 */
export async function exportStudiosCsv(query: StudioListQuery = {}) {
  const { studios } = await listStudios({ ...query, limit: 5000, offset: 0 });

  const header = [
    'Studio',
    'Slug',
    'Country',
    'Owner',
    'Owner email',
    'Plan',
    'Status',
    'Locations',
    'Location limit',
    'Instructors',
    'Instructor limit',
    'Bookings',
    'MRR',
    'Stripe',
    'Trial ends',
    'Created',
  ];

  const rows = studios.map((s) => [
    s.name,
    s.slug,
    s.country,
    s.owner?.name ?? '',
    s.owner?.email ?? '',
    PLANS[s.plan].name,
    s.subscriptionStatus,
    String(s.counts.locations),
    s.limits.maxLocations === null ? 'unlimited' : String(s.limits.maxLocations),
    String(s.counts.staff),
    s.limits.maxStaff === null ? 'unlimited' : String(s.limits.maxStaff),
    String(s.counts.bookings),
    s.mrrCents === null ? '' : (s.mrrCents / 100).toFixed(2),
    s.stripeState,
    s.trialEndsAt ? s.trialEndsAt.toISOString().slice(0, 10) : '',
    s.createdAt.toISOString().slice(0, 10),
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/**
 * Quotes a cell, and defuses a leading =/+/-/@ so a spreadsheet treats it as
 * text rather than a formula. A studio is free to call itself "=cmd|..." and
 * this file is opened by an operator on a work laptop.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
