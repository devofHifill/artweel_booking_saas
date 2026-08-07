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
  mobileBookings: boolean;
  smsReminders: boolean;
  courseSeries: boolean;
  apiAccess: boolean;
  whiteLabel: boolean;
  blurb: string;
};

export const PLANS: Record<PlanId, PlanDefinition> = {
  SOLO: {
    id: 'SOLO',
    name: 'Solo',
    priceCentsMonthly: 3900,
    maxStaff: 1,
    maxLocations: 1,
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

const FEATURE_LABELS: Record<Feature, string> = {
  mobileBookings: 'Mobile and travelling bookings',
  smsReminders: 'Text reminders',
  courseSeries: 'Multi-week courses',
  apiAccess: 'API access',
  whiteLabel: 'Your own domain',
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
  kind: 'maxStaff' | 'maxLocations',
  current: number,
) {
  const limit = PLANS[plan][kind];
  if (limit === null || current < limit) return;

  const label = kind === 'maxStaff' ? 'instructors' : 'locations';
  const next = kind === 'maxStaff' ? nextPlanWithMoreStaff(plan) : PLANS.PRO;

  throw new AppError(
    `The ${PLANS[plan].name} plan includes ${limit} ${label}. ` +
      `Upgrade to ${next.name} to add more.`,
    402,
    'PLAN_LIMIT_REACHED',
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
