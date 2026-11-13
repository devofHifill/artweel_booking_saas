import { AppError } from '../../lib/app-error';

/**
 * What each plan includes.
 *
 * Limits are defined here, in one object, rather than scattered through the
 * code that enforces them. A studio hitting a wall must be told which plan
 * fixes it — "upgrade to continue" with no specifics is how a paying customer
 * becomes a support ticket.
 */

export type PlanId = 'SOLO' | 'STUDIO' | 'PRO';

export type PlanDefinition = {
  id: PlanId;
  name: string;
  priceCentsMonthly: number;
  /** null means unlimited. */
  maxStaff: number | null;
  maxLocations: number | null;
  /**
   * Classes running at once (CLASS-EVENT-PLAN.md). A Class counts from
   * publishing until its last session ends, so a Solo studio runs one term at
   * a time and duplicates it for the next. null means unlimited.
   *
   * A constant, not a `plan_settings` column: refreshPlans() leaves it alone.
   */
  maxClasses: number | null;
  /**
   * Most studios allowed on the plan, set on Admin > Plans. null means
   * unlimited. Only new arrivals are checked (see requireStudioRoom): a cap
   * lowered below the current count moves nobody off.
   */
  maxStudios: number | null;
  mobileBookings: boolean;
  smsReminders: boolean;
  courseSeries: boolean;
  apiAccess: boolean;
  whiteLabel: boolean;
  blurb: string;
};

/**
 * The plan table, read synchronously by everything that branches on a plan.
 *
 * PRICE AND THE TWO LIMITS ARE NOW DATA. They live in `plan_settings` and are
 * loaded into this object at boot by `refreshPlans()`. It is mutated in place
 * rather than replaced so that the several dozen existing `PLANS[id]` call
 * sites — the marketing site, Stripe checkout, requireCapacity — keep working
 * unchanged and synchronous. Turning all of them async to read a table on every
 * request would have been a far larger change for no benefit.
 *
 * The values below are therefore the SHAPE and the seed, not the truth: once
 * the table exists it is the source. Feature flags are the exception and stay
 * genuinely constant here, because a feature is only real when something calls
 * `requireFeature` with it.
 *
 * The cache is refreshed on write and hourly by the sweep worker, so a second
 * API process picks up a change within the hour rather than at next restart.
 */
export const PLANS: Record<PlanId, PlanDefinition> = {
  SOLO: {
    id: 'SOLO',
    name: 'Solo',
    priceCentsMonthly: 3900,
    maxStaff: 1,
    maxLocations: 1,
    maxClasses: 1,
    maxStudios: null,
    mobileBookings: false,
    smsReminders: false,
    courseSeries: false,
    apiAccess: false,
    whiteLabel: false,
    blurb: 'One instructor, one studio. Unlimited bookings and a booking page.',
  },
  STUDIO: {
    id: 'STUDIO',
    name: 'Studio',
    priceCentsMonthly: 8900,
    maxStaff: 5,
    maxLocations: 3,
    maxClasses: null,
    maxStudios: null,
    mobileBookings: true,
    smsReminders: true,
    courseSeries: true,
    apiAccess: false,
    whiteLabel: false,
    blurb:
      'Up to five instructors, mobile parties, text reminders and multi-week courses.',
  },
  PRO: {
    id: 'PRO',
    name: 'Pro',
    priceCentsMonthly: 18900,
    maxStaff: null,
    maxLocations: null,
    maxClasses: null,
    maxStudios: null,
    mobileBookings: true,
    smsReminders: true,
    courseSeries: true,
    apiAccess: true,
    whiteLabel: true,
    blurb: 'Unlimited instructors and locations, API access and your own domain.',
  },
};

export type Feature = keyof Pick<
  PlanDefinition,
  'mobileBookings' | 'smsReminders' | 'courseSeries' | 'apiAccess' | 'whiteLabel'
>;

export const FEATURE_LABELS: Record<Feature, string> = {
  mobileBookings: 'Mobile and travelling bookings',
  smsReminders: 'Text reminders',
  courseSeries: 'Multi-week courses',
  apiAccess: 'API access',
  whiteLabel: 'Your own domain',
};

/**
 * Whether a plan feature is actually GATED, as opposed to merely advertised.
 *
 * A flag in `PLANS` is a claim about what a plan includes. It only becomes a
 * limit when something calls `requireFeature` with it, and today only two
 * things do. The other three are sold and not enforced:
 *
 *   smsReminders — the pricing page offers text reminders from Studio, and
 *                  nothing stops a Solo studio using them.
 *   apiAccess    — offered on Pro. There is no public API to gate.
 *   whiteLabel   — declared and labelled here, referenced by nothing at all,
 *                  not even the marketing site.
 *
 * Recorded next to the definition rather than discovered again later, and
 * surfaced on the platform Plans screen, because a plan matrix that shows only
 * the claims is how the gap survives.
 *
 * MUST be updated when a `requireFeature` call is added or removed. There is
 * no way to derive this at runtime — a call site is not introspectable — so
 * this list is only as true as the last person to change one made it.
 */
export const FEATURE_ENFORCED: Record<Feature, boolean> = {
  mobileBookings: true, // locations/location.service.ts
  courseSeries: true, // courses/course.service.ts
  smsReminders: false,
  apiAccess: false,
  whiteLabel: false,
};

/** The cheapest plan that includes a feature — so the message can name it. */
function cheapestWith(feature: Feature): PlanDefinition {
  const order: PlanId[] = ['SOLO', 'STUDIO', 'PRO'];
  for (const id of order) {
    if (PLANS[id][feature]) return PLANS[id];
  }
  return PLANS.PRO;
}

export function requireFeature(plan: PlanId, feature: Feature) {
  if (PLANS[plan][feature]) return;

  const needed = cheapestWith(feature);

  throw new AppError(
    `${FEATURE_LABELS[feature]} is included from the ${needed.name} plan. ` +
      `You are on ${PLANS[plan].name}.`,
    402,
    'PLAN_UPGRADE_REQUIRED',
  );
}

export function requireCapacity(
  plan: PlanId,
  kind: 'maxStaff' | 'maxLocations' | 'maxClasses',
  current: number,
) {
  const limit = PLANS[plan][kind];
  if (limit === null || current < limit) return;

  const noun = kind === 'maxStaff' ? 'instructor' : kind === 'maxLocations' ? 'location' : 'class';
  const label = limit === 1 ? noun : kind === 'maxClasses' ? 'classes' : `${noun}s`;
  const next = kind === 'maxLocations' ? PLANS.PRO : nextPlanWithMoreStaff(plan);

  throw new AppError(
    kind === 'maxClasses'
      ? `The ${PLANS[plan].name} plan includes ${limit} ${label} at a time. ` +
          `Upgrade to ${next.name} to run more, or publish the next one when this one ends.`
      : `The ${PLANS[plan].name} plan includes ${limit} ${label}. ` +
          `Upgrade to ${next.name} to add more.`,
    402,
    'PLAN_LIMIT_REACHED',
  );
}

/**
 * Refuses a studio arriving on a plan that is full (Admin > Plans, "Studios
 * on plan"). `onPlan` is how many studios are on it now, not counting the one
 * arriving. Studios already on the plan are never checked, so lowering a cap
 * moves nobody off.
 */
export function requireStudioRoom(plan: PlanId, onPlan: number) {
  const limit = PLANS[plan].maxStudios;
  if (limit === null || onPlan < limit) return;

  throw new AppError(
    `The ${PLANS[plan].name} plan is not taking new studios at the moment. ` +
      'Choose another plan, or contact us.',
    409,
    'PLAN_FULL',
  );
}

function nextPlanWithMoreStaff(plan: PlanId): PlanDefinition {
  if (plan === 'SOLO') return PLANS.STUDIO;
  return PLANS.PRO;
}

/**
 * Whether the studio may still make changes.
 *
 * Deliberately permissive during PAST_DUE. A failed card is usually an expired
 * one, and a studio whose booking page dies the moment a renewal bounces loses
 * real revenue over an administrative problem. The grace period buys them time
 * to notice, with escalating warnings in the dashboard.
 */
export function canWrite(status: string): boolean {
  return status === 'TRIALING' || status === 'ACTIVE' || status === 'PAST_DUE';
}

/**
 * Whether the PUBLIC booking page still takes NEW bookings.
 *
 * Kept separate from `canWrite`, and deliberately more generous during
 * PAST_DUE: a studio whose renewal bounced is a paying customer with an
 * expired card, and taking their booking page down mid-week punishes their
 * customers for an administrative problem.
 *
 * SUSPENDED is different. That is a trial that ended without payment, or a
 * grace period that ran out — continuing to take bookings would mean the
 * product is free to anyone who ignores the invoice.
 *
 * In every case EXISTING bookings are untouched and the data survives. The
 * page says it is not currently taking bookings; it does not 404, and the
 * studio's customers can still manage what they already have.
 */
export function canAcceptBookings(status: string): boolean {
  return status === 'TRIALING' || status === 'ACTIVE' || status === 'PAST_DUE';
}

// ---------------------------------------------------------------------------
// Plan settings, loaded from the database
// ---------------------------------------------------------------------------

/**
 * Loads price and limits from `plan_settings` into `PLANS`.
 *
 * Mutating the exported object is deliberate — see the note on PLANS. It is the
 * one place that does it, and it only ever writes the three fields the table
 * owns; feature flags are never touched.
 *
 * Never throws. A studio hitting an upgrade wall because the plan table was
 * briefly unreadable would be a worse failure than serving the last known
 * prices, which are correct until somebody edits them.
 */
export async function refreshPlans(): Promise<void> {
  try {
    const { prisma } = await import('../../lib/prisma');
    const rows = await prisma.planSetting.findMany();

    for (const row of rows) {
      const plan = PLANS[row.id as PlanId];
      if (!plan) continue;
      plan.priceCentsMonthly = row.priceCentsMonthly;
      plan.maxStaff = row.maxStaff;
      plan.maxLocations = row.maxLocations;
      plan.maxStudios = row.maxStudios;
    }
  } catch (err) {
    const { logger } = await import('../../lib/logger');
    logger.error({ err }, 'Plan settings not refreshed — serving last known');
  }
}

/**
 * The plan card line for Classes, worded the same on the pricing page, the
 * home page's plans and Billing: "1 class at a time" or "Unlimited classes".
 */
export function classesLine(plan: Pick<PlanDefinition, 'maxClasses'>): string {
  if (plan.maxClasses === null) return 'Unlimited classes';
  return `${plan.maxClasses} ${plan.maxClasses === 1 ? 'class' : 'classes'} at a time`;
}
