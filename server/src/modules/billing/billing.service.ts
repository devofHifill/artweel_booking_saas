import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/app-error';
import { PLANS, canWrite, type PlanId } from './plan';

/**
 * Our own subscription — what the studio pays us.
 *
 * Not to be confused with Stripe Connect, which is how the studio gets paid by
 * their customers. Two Stripe relationships, one row, hence the explicit
 * `billing*` versus `stripeAccount*` field naming.
 *
 * The trial takes no card. That is a deliberate acquisition decision for a
 * self-serve product: a card wall at signup is where most people leave, and
 * a pottery studio evaluating software on a Sunday evening will simply close
 * the tab. The cost is some tyre-kickers, which is cheaper than the lost
 * signups.
 */

export const TRIAL_DAYS = 14;
/** How long a failed payment stays a warning rather than a block. */
export const GRACE_DAYS = 7;

export async function startTrial(organizationId: string) {
  return prisma.organization.update({
    where: { id: organizationId },
    data: {
      subscriptionStatus: 'TRIALING',
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
    },
  });
}

export type BillingState = {
  plan: PlanId;
  planName: string;
  status: string;
  trialEndsAt: Date | null;
  trialDaysLeft: number | null;
  currentPeriodEnd: Date | null;
  gracePeriodEndsAt: Date | null;
  canWrite: boolean;
  /** What the dashboard should say, if anything. */
  notice: { level: 'info' | 'warn' | 'danger'; message: string } | null;
  usage: { staff: number; locations: number };
  limits: { maxStaff: number | null; maxLocations: number | null };
};

export async function getBillingState(
  organizationId: string,
): Promise<BillingState> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });

  const [staff, locations] = await Promise.all([
    prisma.staff.count({ where: { organizationId, isActive: true } }),
    prisma.location.count({ where: { organizationId, isActive: true } }),
  ]);

  const plan = PLANS[org.plan as PlanId];

  const trialDaysLeft = org.trialEndsAt
    ? Math.max(
        0,
        Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 86_400_000),
      )
    : null;

  return {
    plan: org.plan as PlanId,
    planName: plan.name,
    status: org.subscriptionStatus,
    trialEndsAt: org.trialEndsAt,
    trialDaysLeft,
    currentPeriodEnd: org.currentPeriodEnd,
    gracePeriodEndsAt: org.gracePeriodEndsAt,
    canWrite: canWrite(org.subscriptionStatus),
    notice: noticeFor(org.subscriptionStatus, trialDaysLeft, org.gracePeriodEndsAt),
    usage: { staff, locations },
    limits: { maxStaff: plan.maxStaff, maxLocations: plan.maxLocations },
  };
}

/**
 * The one line the dashboard shows about billing.
 *
 * Escalating rather than constant: a banner that is always there is a banner
 * nobody reads, so nothing is said until the trial is genuinely running out.
 */
function noticeFor(
  status: string,
  trialDaysLeft: number | null,
  graceEndsAt: Date | null,
): BillingState['notice'] {
  if (status === 'TRIALING') {
    if (trialDaysLeft === null) return null;
    if (trialDaysLeft <= 0) {
      return {
        level: 'danger',
        message: 'Your trial has ended. Add a card to keep taking bookings.',
      };
    }
    if (trialDaysLeft <= 3) {
      return {
        level: 'warn',
        message: `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left on your trial.`,
      };
    }
    return null;
  }

  if (status === 'PAST_DUE') {
    const days = graceEndsAt
      ? Math.max(0, Math.ceil((graceEndsAt.getTime() - Date.now()) / 86_400_000))
      : 0;

    return {
      level: days <= 2 ? 'danger' : 'warn',
      message:
        `We could not take your last payment. Everything still works for ` +
        `${days} more day${days === 1 ? '' : 's'} — please update your card.`,
    };
  }

  if (status === 'SUSPENDED') {
    return {
      level: 'danger',
      message:
        'Your account is paused. Your data and bookings are safe — add a ' +
        'card to pick up where you left off.',
    };
  }

  return null;
}

/**
 * Starts a subscription checkout.
 *
 * Uses the platform's own Stripe account, not the studio's connected one —
 * this is money flowing to us. Reusing the Connect provider here would be a
 * subtle and expensive mistake, so billing has its own thin client.
 */
export async function createSubscriptionCheckout(
  organizationId: string,
  planId: PlanId,
  actorEmail: string,
) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });

  if (!config.STRIPE_SECRET_KEY) {
    /**
     * Development without Stripe keys: activate directly so the onboarding
     * flow can be walked end to end. Production cannot reach this — config
     * refuses to boot without keys.
     */
    logger.warn(
      { organizationId, planId },
      'No Stripe key — activating subscription locally without payment',
    );

    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        plan: planId,
        // Guarded like the webhook paths. This branch is reachable on any
        // deployment without Stripe keys — which includes staging today — so
        // leaving it unguarded would make platform suspension trivially
        // bypassable exactly where it is most likely to be tested.
        ...(platformSuspensionHolds(org)
          ? {}
          : { subscriptionStatus: 'ACTIVE', gracePeriodEndsAt: null }),
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    return { url: `${config.APP_URL}/settings/billing?activated=1`, simulated: true };
  }

  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: '2025-01-27.acacia' as never,
  });

  let customerId = org.billingCustomerId;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: actorEmail,
      name: org.name,
      metadata: { organizationId },
    });
    customerId = customer.id;

    await prisma.organization.update({
      where: { id: organizationId },
      data: { billingCustomerId: customerId },
    });
  }

  const plan = PLANS[planId];

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: plan.priceCentsMonthly,
          recurring: { interval: 'month' },
          product_data: { name: `${plan.name} plan` },
        },
      },
    ],
    success_url: `${config.APP_URL}/settings/billing?subscribed=1`,
    cancel_url: `${config.APP_URL}/settings/billing`,
    // Echoed back on the webhook so the subscription finds its studio.
    subscription_data: { metadata: { organizationId, planId } },
    metadata: { organizationId, planId },
  });

  return { url: session.url!, simulated: false };
}

/** Stripe's own billing portal — card updates, invoices, cancellation. */
export async function createBillingPortalSession(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });

  if (!org.billingCustomerId || !config.STRIPE_SECRET_KEY) {
    throw AppError.badRequest(
      'No subscription to manage yet.',
      'NO_SUBSCRIPTION',
    );
  }

  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: '2025-01-27.acacia' as never,
  });

  const session = await stripe.billingPortal.sessions.create({
    customer: org.billingCustomerId,
    return_url: `${config.APP_URL}/settings/billing`,
  });

  return { url: session.url };
}

// ---------------------------------------------------------------------------
// Webhook handlers
// ---------------------------------------------------------------------------

/**
 * Whether a platform suspension outranks whatever billing is about to say.
 *
 * An operator suspension and a billing suspension write the same `SUSPENDED`
 * status, and billing clears that status whenever money arrives. So a studio
 * suspended for abuse would be quietly reinstated by its own next invoice —
 * which is not a visible bug: the status simply reads ACTIVE again, indis-
 * tinguishable from any other paid-up studio, and the operator who suspended it
 * has no reason to look.
 *
 * A payment therefore does not lift an operator suspension. Only an operator
 * does, through `/unsuspend`.
 *
 * NOTE what this does not do: a platform-suspended studio can still complete
 * checkout and still be charged, it just does not come back on. Refusing their
 * money as well is a further decision — S4 makes the state visible on the studio
 * detail screen so the operator can act, rather than quietly deciding it here.
 */
function platformSuspensionHolds(org: { suspendedByPlatformAt: Date | null }) {
  return org.suspendedByPlatformAt !== null;
}

export async function onSubscriptionChanged(data: {
  id: string;
  status: string;
  customerId: string;
  currentPeriodEnd: number | null;
  planId?: string;
}) {
  const org = await prisma.organization.findFirst({
    where: { billingCustomerId: data.customerId },
  });
  if (!org) {
    logger.warn({ customerId: data.customerId }, 'Subscription for unknown org');
    return;
  }

  // Stripe's vocabulary is not ours; translate rather than store theirs.
  const status =
    data.status === 'active' || data.status === 'trialing'
      ? 'ACTIVE'
      : data.status === 'past_due' || data.status === 'unpaid'
        ? 'PAST_DUE'
        : data.status === 'canceled'
          ? 'CANCELED'
          : org.subscriptionStatus;

  // The Stripe-side facts are still recorded — subscription id, period end,
  // plan. Only the STATUS is withheld, because that is the one an operator
  // suspension owns.
  const effectiveStatus = platformSuspensionHolds(org) ? 'SUSPENDED' : status;

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      billingSubscriptionId: data.id,
      subscriptionStatus: effectiveStatus as never,
      ...(data.planId ? { plan: data.planId as never } : {}),
      currentPeriodEnd: data.currentPeriodEnd
        ? new Date(data.currentPeriodEnd * 1000)
        : null,
      // A successful renewal clears any outstanding grace period.
      ...(effectiveStatus === 'ACTIVE' ? { gracePeriodEndsAt: null } : {}),
    },
  });
}

/**
 * A payment failed.
 *
 * Nothing is switched off. The grace period starts, and the dashboard begins
 * warning — a bounced renewal is usually an expired card, and taking a
 * studio's booking page down over it costs them real money for an
 * administrative problem.
 */
export async function onPaymentFailed(customerId: string) {
  const org = await prisma.organization.findFirst({
    where: { billingCustomerId: customerId },
  });
  if (!org) return;

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      subscriptionStatus: 'PAST_DUE',
      // Only set on the FIRST failure, so repeated retries do not keep
      // extending the runway.
      gracePeriodEndsAt:
        org.gracePeriodEndsAt ?? new Date(Date.now() + GRACE_DAYS * 86_400_000),
    },
  });

  logger.warn({ organizationId: org.id }, 'Payment failed — grace period started');
}

export async function onPaymentSucceeded(customerId: string) {
  const org = await prisma.organization.findFirst({
    where: { billingCustomerId: customerId },
  });
  if (!org) return;

  if (platformSuspensionHolds(org)) {
    // Grace is still cleared — they have paid, and grace is a billing concept.
    // The suspension is not a billing concept and stays.
    await prisma.organization.update({
      where: { id: org.id },
      data: { gracePeriodEndsAt: null },
    });

    logger.warn(
      { organizationId: org.id },
      'Payment succeeded for a platform-suspended studio — suspension kept',
    );
    return;
  }

  await prisma.organization.update({
    where: { id: org.id },
    data: { subscriptionStatus: 'ACTIVE', gracePeriodEndsAt: null },
  });
}

/**
 * Moves expired trials and lapsed grace periods to SUSPENDED.
 *
 * SUSPENDED is read-only, never destructive. Bookings, customers and history
 * all survive — a studio that comes back after two months finds everything
 * where they left it. Deleting a lapsed account's data would be both hostile
 * and, for the customers who booked through them, unfair.
 */
export async function sweepExpiredSubscriptions(now = new Date()) {
  const expiredTrials = await prisma.organization.updateMany({
    where: {
      subscriptionStatus: 'TRIALING',
      trialEndsAt: { lt: now },
    },
    data: { subscriptionStatus: 'SUSPENDED' },
  });

  const lapsedGrace = await prisma.organization.updateMany({
    where: {
      subscriptionStatus: 'PAST_DUE',
      gracePeriodEndsAt: { lt: now },
    },
    data: { subscriptionStatus: 'SUSPENDED' },
  });

  const total = expiredTrials.count + lapsedGrace.count;
  if (total > 0) {
    logger.info(
      { trials: expiredTrials.count, grace: lapsedGrace.count },
      'Subscriptions suspended',
    );
  }

  return { suspendedTrials: expiredTrials.count, suspendedGrace: lapsedGrace.count };
}
