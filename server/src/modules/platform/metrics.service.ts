import type { Plan, SubscriptionStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { PLANS } from '../billing/plan';

/**
 * The numbers the Overview screen renders.
 *
 * Grouped into one response because they are read together and each is one
 * cheap query. Every count here is deliberately clickable-through in the UI: a
 * number you cannot open into the rows behind it is a number you cannot act on.
 */

const DAY_MS = 86_400_000;

/**
 * TWO UNRELATED MONEY NUMBERS LIVE HERE. They must never be summed, and must
 * never appear next to each other unlabelled.
 *
 *   subscriptionRevenue — what studios pay US. Our revenue, on our books.
 *   studioBookingVolume — what studios' own customers pay THEM.
 *
 * The second is not ours in any sense. Connect charges are direct, with the
 * studio as merchant of record: the money never touches our balance, which is
 * what keeps us out of money-transmission territory. Showing it as "revenue"
 * would overstate the business by roughly the size of the customer base, which
 * is the kind of error that survives all the way into a pitch deck.
 *
 * The separation currently rests on a property of the schema, verified rather
 * than assumed: the `payments` table is written ONLY by
 * `payments/payment.service.ts`, and `PaymentKind` is `DEPOSIT | BALANCE | FULL`
 * — all studio-side. Our own subscription charges are never recorded there;
 * they live in Stripe, which is why MRR below has to be computed from plan
 * prices instead of summed from rows.
 *
 * IF a `SUBSCRIPTION` kind is ever added to that table, the aggregate below
 * starts silently including our revenue in theirs and this whole distinction
 * collapses. Filter by kind at that point.
 */
export type PlatformMetrics = Awaited<ReturnType<typeof getPlatformMetrics>>;

export async function getPlatformMetrics() {
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * DAY_MS);
  const days30Ago = new Date(now.getTime() - 30 * DAY_MS);
  const weeks12Ago = new Date(now.getTime() - 84 * DAY_MS);

  const [
    byStatus,
    byPlan,
    trialsExpiringSoon,
    trialsLapsed,
    stalledInOnboarding,
    signupsByWeek,
    recentSignupSources,
    bookingVolume,
    totalStudios,
  ] = await Promise.all([
    prisma.organization.groupBy({
      by: ['subscriptionStatus'],
      _count: { _all: true },
    }),
    prisma.organization.groupBy({ by: ['plan'], _count: { _all: true } }),

    prisma.organization.count({
      where: {
        subscriptionStatus: 'TRIALING',
        trialEndsAt: { gte: now, lte: in7Days },
      },
    }),

    /**
     * Trials that ran out without converting. The conversion denominator, and
     * the most actionable list on the screen — these are studios that signed up,
     * tried it, and stopped.
     */
    prisma.organization.count({
      where: {
        subscriptionStatus: { in: ['SUSPENDED', 'CANCELED'] },
        billingSubscriptionId: null,
      },
    }),

    prisma.organization.count({ where: { onboardingDoneAt: null } }),

    prisma.$queryRaw<{ week: Date; count: bigint }[]>`
      SELECT date_trunc('week', created_at) AS week, count(*) AS count
      FROM organizations
      WHERE created_at >= ${weeks12Ago}
      GROUP BY 1
      ORDER BY 1 ASC
    `,

    prisma.organization.groupBy({
      by: ['signupSource'],
      where: { createdAt: { gte: weeks12Ago } },
      _count: { _all: true },
    }),

    /**
     * Studio volume: what their customers paid THEM. `SUCCEEDED` only — a
     * created-but-unpaid intent is not volume.
     *
     * That also drops `PARTIALLY_REFUNDED` entirely rather than counting the
     * kept portion, so this slightly understates. Deliberate: an understated
     * figure that is never mistaken for our revenue beats an exact one that
     * needs a footnote.
     */
    prisma.payment.aggregate({
      where: { status: 'SUCCEEDED', createdAt: { gte: days30Ago } },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),

    prisma.organization.count(),
  ]);

  const statusCounts = emptyStatusCounts();
  for (const row of byStatus) {
    statusCounts[row.subscriptionStatus] = row._count._all;
  }

  const planCounts = emptyPlanCounts();
  for (const row of byPlan) {
    planCounts[row.plan] = row._count._all;
  }

  /**
   * MRR is COMPUTED, not stored — from the plan each paying studio is on, times
   * that plan's price in `billing/plan.ts`.
   *
   * That file is the single definition of what a plan costs (the marketing site
   * and Stripe checkout both read it), so there is no second price map to drift.
   * It does mean this figure is only as current as `PLANS`: change pricing and
   * this number changes with it, which is right for new subscriptions and WRONG
   * for studios still billing at an old price. Nothing records what a given
   * studio actually agreed to pay. That is fine while pricing has never
   * changed, and it is one of the pressures that argues for S12 rather than a
   * bug to fix here.
   *
   * Counts ACTIVE only. Trials pay nothing, and PAST_DUE is money we have not
   * been paid — including either would report hoped-for revenue as real.
   */
  const activeByPlan = await prisma.organization.groupBy({
    by: ['plan'],
    where: { subscriptionStatus: 'ACTIVE' },
    _count: { _all: true },
  });

  const mrrCents = activeByPlan.reduce(
    (total, row) => total + PLANS[row.plan].priceCentsMonthly * row._count._all,
    0,
  );

  const paying = activeByPlan.reduce((n, row) => n + row._count._all, 0);
  const everTrialed = paying + trialsLapsed;

  return {
    studios: {
      total: totalStudios,
      byStatus: statusCounts,
      byPlan: planCounts,
      stalledInOnboarding,
      idle30Days: await countIdleStudios(days30Ago),
    },

    trials: {
      expiringWithin7Days: trialsExpiringSoon,
      lapsedWithoutConverting: trialsLapsed,
      /** null rather than 0 when nobody has finished a trial yet. */
      conversionRate: everTrialed > 0 ? paying / everTrialed : null,
    },

    /** OUR revenue. See the note at the top of this file. */
    subscriptionRevenue: {
      mrrCents,
      payingStudios: paying,
      currency: 'USD',
    },

    /** THEIR revenue, passing through. Not ours, never added to the above. */
    studioBookingVolume: {
      last30DaysCents: bookingVolume._sum.amountCents ?? 0,
      payments: bookingVolume._count._all,
      note: 'Paid directly to studios via Connect. Not platform revenue.',
    },

    signups: {
      byWeek: signupsByWeek.map((row) => ({
        week: row.week,
        count: Number(row.count),
      })),
      bySource: recentSignupSources
        .map((row) => ({
          source: row.signupSource ?? 'direct',
          count: row._count._all,
        }))
        .sort((a, b) => b.count - a.count),
    },
  };
}

/**
 * Studios with no booking in the window — the churn leading indicator, and the
 * one number here that cannot be a simple count.
 *
 * Expressed as "has no booking newer than X" rather than "max(created_at) < X"
 * so that a studio which has never taken a booking at all is included. Those are
 * the ones most worth calling.
 */
async function countIdleStudios(since: Date) {
  return prisma.organization.count({
    where: { bookings: { none: { createdAt: { gte: since } } } },
  });
}

function emptyStatusCounts(): Record<SubscriptionStatus, number> {
  return {
    TRIALING: 0,
    ACTIVE: 0,
    PAST_DUE: 0,
    SUSPENDED: 0,
    CANCELED: 0,
  };
}

function emptyPlanCounts(): Record<Plan, number> {
  return { SOLO: 0, STUDIO: 0, PRO: 0 };
}
