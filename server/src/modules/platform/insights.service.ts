import { prisma } from '../../lib/prisma';
import { PLANS, type PlanId } from '../billing/plan';
import { currentMrr } from './mrr.service';

/**
 * The lower half of the platform dashboard: plan mix, geography, what needs a
 * human, recent activity, and how the business actually earns.
 *
 * Everything here is computed from rows that already exist. Where the reference
 * design asked for something the system does not record, it is either omitted
 * or replaced by the nearest real thing and labelled as that — see
 * `needsAttention` for the two substitutions and `revenueModel` for the two
 * figures that are returned null with a reason instead of a plausible number.
 */

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Plan distribution
// ---------------------------------------------------------------------------

/**
 * Studios by plan, with the revenue each plan actually contributes.
 *
 * Only ACTIVE studios carry an amount. A studio on the Studio plan that is
 * trialing or past due sits in its own bucket rather than in the Studio slice,
 * because counting it there would let the slice totals imply revenue nobody is
 * paying — the segment counts would multiply out to an MRR the business does
 * not have.
 */
export async function getPlanDistribution() {
  const [{ byPlan, mrrCents, payingStudios }, byStatus, total] =
    await Promise.all([
      currentMrr(),
      prisma.organization.groupBy({
        by: ['subscriptionStatus'],
        _count: { _all: true },
      }),
      prisma.organization.count(),
    ]);

  const status = new Map(
    byStatus.map((row) => [row.subscriptionStatus, row._count._all]),
  );

  const paying = byPlan
    .filter((row) => row.studios > 0)
    .map((row) => ({
      key: row.plan as string,
      label: PLANS[row.plan as PlanId].name,
      studios: row.studios,
      mrrCents: row.mrrCents,
    }));

  const trialing = status.get('TRIALING') ?? 0;
  /* Past due, suspended and cancelled together. Separately they are four thin
     slices that say less than one honest one. */
  const inactive =
    (status.get('PAST_DUE') ?? 0) +
    (status.get('SUSPENDED') ?? 0) +
    (status.get('CANCELED') ?? 0);

  const segments = [
    ...paying,
    ...(trialing > 0
      ? [{ key: 'TRIAL', label: 'Trial', studios: trialing, mrrCents: 0 }]
      : []),
    ...(inactive > 0
      ? [
          {
            key: 'INACTIVE',
            label: 'Past due or cancelled',
            studios: inactive,
            mrrCents: 0,
          },
        ]
      : []),
  ];

  return { total, segments, mrrCents, payingStudios };
}

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

/**
 * DERIVED FROM TIMEZONE, NOT DECLARED.
 *
 * No studio ever states a country — there is no such column, only a free-text
 * address — so this maps each studio's IANA timezone to the country that zone
 * belongs to. That is deterministic and right for the overwhelming majority,
 * and wrong for the studio that runs in one country on another's clock. The
 * screen says so rather than presenting it as declared data.
 *
 * Anything unmapped lands in "Other" instead of being guessed at.
 */
const TZ_COUNTRY: Record<string, string> = {
  'America/New_York': 'United States',
  'America/Chicago': 'United States',
  'America/Denver': 'United States',
  'America/Phoenix': 'United States',
  'America/Los_Angeles': 'United States',
  'America/Anchorage': 'United States',
  'America/Detroit': 'United States',
  'Pacific/Honolulu': 'United States',
  'America/Toronto': 'Canada',
  'America/Vancouver': 'Canada',
  'America/Edmonton': 'Canada',
  'America/Winnipeg': 'Canada',
  'America/Halifax': 'Canada',
  'America/Montreal': 'Canada',
  'America/Mexico_City': 'Mexico',
  'America/Sao_Paulo': 'Brazil',
  'America/Bogota': 'Colombia',
  'America/Lima': 'Peru',
  'America/Argentina/Buenos_Aires': 'Argentina',
  'America/Santiago': 'Chile',
  'Europe/London': 'United Kingdom',
  'Europe/Dublin': 'Ireland',
  'Europe/Paris': 'France',
  'Europe/Berlin': 'Germany',
  'Europe/Madrid': 'Spain',
  'Europe/Rome': 'Italy',
  'Europe/Amsterdam': 'Netherlands',
  'Europe/Brussels': 'Belgium',
  'Europe/Lisbon': 'Portugal',
  'Europe/Vienna': 'Austria',
  'Europe/Zurich': 'Switzerland',
  'Europe/Stockholm': 'Sweden',
  'Europe/Oslo': 'Norway',
  'Europe/Copenhagen': 'Denmark',
  'Europe/Helsinki': 'Finland',
  'Europe/Warsaw': 'Poland',
  'Europe/Prague': 'Czechia',
  'Europe/Budapest': 'Hungary',
  'Europe/Athens': 'Greece',
  'Europe/Bucharest': 'Romania',
  'Europe/Moscow': 'Russia',
  'Europe/Istanbul': 'Türkiye',
  'Europe/Kyiv': 'Ukraine',
  'Asia/Kolkata': 'India',
  'Asia/Calcutta': 'India',
  'Asia/Dubai': 'United Arab Emirates',
  'Asia/Karachi': 'Pakistan',
  'Asia/Dhaka': 'Bangladesh',
  'Asia/Colombo': 'Sri Lanka',
  'Asia/Kathmandu': 'Nepal',
  'Asia/Bangkok': 'Thailand',
  'Asia/Jakarta': 'Indonesia',
  'Asia/Singapore': 'Singapore',
  'Asia/Kuala_Lumpur': 'Malaysia',
  'Asia/Manila': 'Philippines',
  'Asia/Hong_Kong': 'Hong Kong',
  'Asia/Shanghai': 'China',
  'Asia/Tokyo': 'Japan',
  'Asia/Seoul': 'South Korea',
  'Asia/Taipei': 'Taiwan',
  'Asia/Jerusalem': 'Israel',
  'Asia/Riyadh': 'Saudi Arabia',
  'Australia/Sydney': 'Australia',
  'Australia/Melbourne': 'Australia',
  'Australia/Brisbane': 'Australia',
  'Australia/Perth': 'Australia',
  'Australia/Adelaide': 'Australia',
  'Australia/Hobart': 'Australia',
  'Australia/Darwin': 'Australia',
  'Pacific/Auckland': 'New Zealand',
  'Africa/Cairo': 'Egypt',
  'Africa/Lagos': 'Nigeria',
  'Africa/Johannesburg': 'South Africa',
  'Africa/Nairobi': 'Kenya',
  'Africa/Accra': 'Ghana',
  'Africa/Casablanca': 'Morocco',
  'Atlantic/Reykjavik': 'Iceland',
};

export function countryForTimezone(timezone: string): string {
  return TZ_COUNTRY[timezone] ?? 'Other';
}

export async function getGeographicDistribution(now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY_MS);

  const [studios, gmv] = await Promise.all([
    prisma.organization.findMany({ select: { id: true, timezone: true } }),
    prisma.payment.groupBy({
      by: ['organizationId'],
      where: { status: 'SUCCEEDED', createdAt: { gte: since } },
      _sum: { amountCents: true },
    }),
  ]);

  const gmvByOrg = new Map(
    gmv.map((row) => [row.organizationId, row._sum.amountCents ?? 0]),
  );

  const byCountry = new Map<string, { studios: number; gmvCents: number }>();
  for (const studio of studios) {
    const country = countryForTimezone(studio.timezone);
    const entry = byCountry.get(country) ?? { studios: 0, gmvCents: 0 };
    entry.studios += 1;
    entry.gmvCents += gmvByOrg.get(studio.id) ?? 0;
    byCountry.set(country, entry);
  }

  /* "Other" sorts last however big it is: it is a bucket, not a place, and
     letting it head the list would read as a country with the most studios. */
  const rows = [...byCountry.entries()]
    .map(([country, v]) => ({ country, ...v }))
    .sort((a, b) => {
      if (a.country === 'Other') return 1;
      if (b.country === 'Other') return -1;
      return b.studios - a.studios;
    });

  return { rows, derivedFrom: 'timezone' as const };
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

export type AttentionItem = {
  key: string;
  title: string;
  detail: string;
  count: number;
  href: string;
};

/**
 * The checks that mean somebody has to do something.
 *
 * TWO SUBSTITUTIONS, both deliberate. The reference design listed "expired
 * payment cards", which lives in Stripe and not here; the local fact of the
 * same shape is a past-due subscription, so that is what is reported and what
 * it is called. It also broke webhook failures down by Stripe, Twilio and
 * Google — only Stripe webhooks are ever written to `webhook_events`, so the
 * count says Stripe rather than implying coverage of three providers.
 */
export async function getNeedsAttention(now = new Date()) {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS);

  const [orgs, staffCounts, stripeTrouble, webhookFailures, reauth, bookings] =
    await Promise.all([
      prisma.organization.findMany({
        select: { id: true, name: true, plan: true, subscriptionStatus: true },
      }),
      /* isActive only, matching how the limit is enforced on create. Counting
         deactivated staff would flag studios that are nowhere near it. */
      prisma.staff.groupBy({
        by: ['organizationId'],
        where: { isActive: true },
        _count: { _all: true },
      }),
      prisma.organization.findMany({
        where: {
          stripeAccountId: { not: null },
          OR: [{ stripeChargesEnabled: false }, { stripePayoutsEnabled: false }],
        },
        select: { name: true },
        take: 10,
      }),
      prisma.webhookEvent.count({
        where: { error: { not: null }, createdAt: { gte: dayAgo } },
      }),
      prisma.calendarConnection.findMany({
        where: { status: 'NEEDS_REAUTH' },
        select: { organizationId: true },
      }),
      prisma.$queryRaw<
        { organization_id: string; cancelled: bigint; total: bigint }[]
      >`
        SELECT organization_id,
               count(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
               count(*) AS total
        FROM bookings
        WHERE created_at >= ${ninetyDaysAgo}
        GROUP BY 1
      `,
    ]);

  const nameById = new Map(orgs.map((o) => [o.id, o.name]));
  const staffById = new Map(
    staffCounts.map((row) => [row.organizationId, row._count._all]),
  );

  const items: AttentionItem[] = [];

  // --- Approaching the instructor limit ------------------------------------
  const nearLimit = orgs.filter((org) => {
    const limit = PLANS[org.plan as PlanId].maxStaff;
    if (limit === null) return false;
    return (staffById.get(org.id) ?? 0) >= limit - 1;
  });
  if (nearLimit.length > 0) {
    items.push({
      key: 'staff-limit',
      title: `${nearLimit.length} studio${nearLimit.length === 1 ? '' : 's'} at or approaching their instructor limit`,
      detail: nearLimit
        .slice(0, 4)
        .map((o) => o.name)
        .join(', '),
      count: nearLimit.length,
      href: '/admin/studios',
    });
  }

  // --- Stripe Connect not fully enabled ------------------------------------
  if (stripeTrouble.length > 0) {
    items.push({
      key: 'stripe',
      title: `${stripeTrouble.length} Stripe account${stripeTrouble.length === 1 ? '' : 's'} need attention`,
      detail: `${stripeTrouble.map((o) => o.name).join(', ')} — charges or payouts disabled`,
      count: stripeTrouble.length,
      href: '/admin/studios',
    });
  }

  // --- Webhook failures ----------------------------------------------------
  if (webhookFailures > 0) {
    items.push({
      key: 'webhooks',
      title: `${webhookFailures} webhook failure${webhookFailures === 1 ? '' : 's'} in the last 24 hours`,
      // Named, because only Stripe webhooks are recorded at all.
      detail: 'Stripe only — Twilio and Google webhooks are not recorded',
      count: webhookFailures,
      href: '/admin/health',
    });
  }

  // --- Past due (the local stand-in for an expired card) -------------------
  const pastDue = orgs.filter((o) => o.subscriptionStatus === 'PAST_DUE');
  if (pastDue.length > 0) {
    items.push({
      key: 'past-due',
      title: `${pastDue.length} studio${pastDue.length === 1 ? '' : 's'} past due on payment`,
      detail: `${pastDue
        .slice(0, 4)
        .map((o) => o.name)
        .join(', ')} — card details live in Stripe, not here`,
      count: pastDue.length,
      href: '/admin/studios?status=PAST_DUE',
    });
  }

  // --- Calendars needing re-authorisation ----------------------------------
  const reauthStudios = new Set(reauth.map((c) => c.organizationId));
  if (reauthStudios.size > 0) {
    items.push({
      key: 'calendar-reauth',
      title: `${reauthStudios.size} studio${reauthStudios.size === 1 ? '' : 's'} need to re-authorise Google Calendar`,
      detail: 'Refresh token rejected — only the instructor can reconnect',
      count: reauthStudios.size,
      href: '/admin/studios',
    });
  }

  // --- Cancellation-rate outliers ------------------------------------------
  const totals = bookings.reduce(
    (acc, row) => ({
      cancelled: acc.cancelled + Number(row.cancelled),
      total: acc.total + Number(row.total),
    }),
    { cancelled: 0, total: 0 },
  );
  const platformRate = totals.total > 0 ? totals.cancelled / totals.total : 0;

  /* A floor as well as a multiple: on a platform cancelling 1% of bookings,
     "twice the average" is 2%, which is not a problem and would flag half the
     studios every week. A list that cries wolf stops being read. */
  const outliers = bookings
    .filter((row) => Number(row.total) >= 10)
    .map((row) => ({
      id: row.organization_id,
      rate: Number(row.cancelled) / Number(row.total),
    }))
    .filter((row) => row.rate >= Math.max(platformRate * 2, 0.15));

  if (outliers.length > 0) {
    const worst = outliers.sort((a, b) => b.rate - a.rate)[0]!;
    items.push({
      key: 'cancellations',
      title: `${outliers.length} studio${outliers.length === 1 ? '' : 's'} with an unusually high cancellation rate`,
      detail: `${nameById.get(worst.id) ?? 'A studio'} — ${(worst.rate * 100).toFixed(1)}% vs ${(platformRate * 100).toFixed(1)}% platform average`,
      count: outliers.length,
      href: '/admin/studios',
    });
  }

  return { items };
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

export type ActivityEntry = {
  id: string;
  at: Date;
  title: string;
  category: string;
  actor: string;
  status: 'success' | 'failed' | 'review';
};

/**
 * A feed of what actually happened, from the sources that actually record it.
 *
 * WHAT IS NOT HERE. The reference design showed studio-side events — an
 * instructor added, a course created, SMS switched on. None of those are
 * logged anywhere: `platform_audit_log` records platform-ADMIN actions only,
 * by design, and there is no studio-side audit trail. Rather than invent one
 * row of it, this combines the four trails that do exist: admin actions,
 * failed webhooks, new signups, and subscription changes from Stripe.
 */
export async function getRecentActivity(limit = 12) {
  const [audit, failures, signups, subscriptions] = await Promise.all([
    prisma.platformAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        actorEmail: true,
        organizationId: true,
        createdAt: true,
      },
    }),
    prisma.webhookEvent.findMany({
      where: { error: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        eventType: true,
        organizationId: true,
        createdAt: true,
      },
    }),
    prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, name: true, createdAt: true },
    }),
    prisma.webhookEvent.findMany({
      where: { eventType: { startsWith: 'customer.subscription.' } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        eventType: true,
        organizationId: true,
        createdAt: true,
      },
    }),
  ]);

  const orgIds = new Set<string>();
  for (const row of [...audit, ...failures, ...subscriptions]) {
    if (row.organizationId) orgIds.add(row.organizationId);
  }
  const orgs = await prisma.organization.findMany({
    where: { id: { in: [...orgIds] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(orgs.map((o) => [o.id, o.name]));
  const studio = (id: string | null) =>
    (id && nameById.get(id)) || 'A studio';

  const entries: ActivityEntry[] = [
    ...audit.map((row) => ({
      id: `audit-${row.id}`,
      at: row.createdAt,
      title: `${studio(row.organizationId)} — ${row.action.replace(/[._]/g, ' ')}`,
      category: 'Platform admin',
      actor: row.actorEmail,
      status: (row.action.includes('suspend') || row.action.includes('support')
        ? 'review'
        : 'success') as ActivityEntry['status'],
    })),

    ...failures.map((row) => ({
      id: `hook-${row.id}`,
      at: row.createdAt,
      title: `${studio(row.organizationId)} — ${row.eventType} failed`,
      category: 'Webhook',
      actor: 'System',
      status: 'failed' as const,
    })),

    ...signups.map((row) => ({
      id: `signup-${row.id}`,
      at: row.createdAt,
      title: `${row.name} signed up`,
      category: 'Trial',
      actor: 'Self-serve',
      status: 'success' as const,
    })),

    ...subscriptions.map((row) => ({
      id: `sub-${row.id}`,
      at: row.createdAt,
      title: `${studio(row.organizationId)} — ${row.eventType.replace('customer.subscription.', 'subscription ')}`,
      category: 'Billing',
      status: (row.eventType.endsWith('deleted')
        ? 'review'
        : 'success') as ActivityEntry['status'],
      actor: 'Stripe',
    })),
  ];

  return {
    entries: entries
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, limit),
    /* So the screen can say why it is thinner than a full activity log. */
    note: 'Platform-admin actions, failed webhooks, signups and subscription changes. Studio-side actions are not audited.',
  };
}

// ---------------------------------------------------------------------------
// Revenue model
// ---------------------------------------------------------------------------

/**
 * How the business earns, in figures rather than prose.
 *
 * LTV and net revenue retention come back NULL, each with a reason. Both need
 * churn — LTV is ARPA divided by a churn rate, NRR is cohort revenue compared
 * against itself a year on — and churn only began being measurable when the
 * daily snapshot started. A plausible number in either slot would be the most
 * quotable fabrication on the whole dashboard.
 */
export async function getRevenueModel() {
  const { mrrCents, payingStudios } = await currentMrr();

  return {
    /* Not a query. Connect charges are direct, so the platform's cut is zero
       by architecture rather than by a setting somebody could change. */
    platformCommissionPct: 0,
    takeRateOnGmvPct: 0,
    mrrCents,
    payingStudios,
    arpaCents: payingStudios > 0 ? Math.round(mrrCents / payingStudios) : null,
    ltvCents: null as number | null,
    ltvUnavailableReason:
      'Needs a churn rate. Churn is only measurable from the first daily snapshot onward.',
    nrrPct: null as number | null,
    nrrUnavailableReason:
      'Needs cohort revenue history, which the platform has only just begun recording.',
  };
}
