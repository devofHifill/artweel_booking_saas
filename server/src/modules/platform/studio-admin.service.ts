import type { Plan } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { logger } from '../../lib/logger';
import { PLANS } from '../billing/plan';
import { withAudit, type AuditEntry } from './audit.service';

/**
 * The platform's write actions on a studio.
 *
 * Every one of them:
 *   - requires a `reason`, which the route enforces and the audit row keeps;
 *   - runs inside `withAudit`, so the action and its record stand or fall
 *     together;
 *   - records before/after in the audit metadata, because "the plan changed" is
 *     not useful six months later and "STUDIO -> PRO" is.
 */

type Actor = Pick<AuditEntry, 'actorUserId' | 'actorEmail' | 'ip' | 'userAgent'>;

async function requireStudio(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true },
  });

  if (!org) {
    throw AppError.notFound('Studio not found.', 'STUDIO_NOT_FOUND');
  }

  return org;
}

/**
 * Extends a trial to a given date.
 *
 * Only forwards. Pulling a trial end date backwards would suspend a studio
 * mid-week through a route whose name says "extend", and if that is genuinely
 * wanted it should be a suspension — which is audited as one and is obvious in
 * the log, rather than hiding behind a date edit.
 */
export async function extendTrial(
  actor: Actor,
  organizationId: string,
  extendTo: Date,
  reason: string,
) {
  await requireStudio(organizationId);

  return withAudit(
    {
      ...actor,
      action: 'trial.extend',
      targetType: 'organization',
      targetId: organizationId,
      organizationId,
      reason,
    },
    async (tx, audit) => {
      const before = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: {
          trialEndsAt: true,
          subscriptionStatus: true,
          suspendedByPlatformAt: true,
        },
      });

      if (before.trialEndsAt && before.trialEndsAt >= extendTo) {
        throw AppError.badRequest(
          `That trial already runs to ${before.trialEndsAt.toISOString()}. ` +
            'Trials can only be extended, not shortened — suspend the studio instead.',
          'TRIAL_NOT_EXTENDED',
        );
      }

      const after = await tx.organization.update({
        where: { id: organizationId },
        data: {
          trialEndsAt: extendTo,
          /**
           * A studio already SUSPENDED for an expired trial goes back to
           * TRIALING — otherwise extending the trial changes a date and leaves
           * the booking page off, which is not what anyone means by "extend".
           *
           * But ONLY when billing was the reason. `SUSPENDED` is written by both
           * billing and by an operator, so reinstating on the status alone would
           * make this route a way to lift an abuse suspension by extending a
           * trial — the exact bypass `suspendedByPlatformAt` exists to prevent,
           * reintroduced one route later. Caught by
           * "does not lift a platform suspension".
           */
          ...(before.subscriptionStatus === 'SUSPENDED' &&
          before.suspendedByPlatformAt === null
            ? { subscriptionStatus: 'TRIALING' as const }
            : {}),
        },
        select: { trialEndsAt: true, subscriptionStatus: true },
      });

      audit({
        metadata: {
          before: {
            trialEndsAt: before.trialEndsAt,
            status: before.subscriptionStatus,
          },
          after: { trialEndsAt: after.trialEndsAt, status: after.subscriptionStatus },
        },
      });

      return after;
    },
  );
}

/**
 * Sets a studio's plan, optionally as a comp.
 *
 * COMPING DOES NOT TOUCH STRIPE — a decision taken on 2026-08-17. The local row
 * says the studio is on a plan; their Stripe subscription, if they have one,
 * carries on charging their card at whatever it was already charging.
 *
 * That divergence is intentional, so the job here is to make sure it is never
 * invisible: `compedAt` is stored, and the platform studio detail response
 * reports the conflict outright. The alternative — inferring "probably comped"
 * later from a plan that does not match a subscription — is exactly how a studio
 * ends up being charged for a year after being told the account was free.
 */
export async function setPlan(
  actor: Actor,
  organizationId: string,
  plan: Plan,
  opts: { comp: boolean; reason: string },
) {
  await requireStudio(organizationId);

  return withAudit(
    {
      ...actor,
      action: opts.comp ? 'plan.comp' : 'plan.set',
      targetType: 'organization',
      targetId: organizationId,
      organizationId,
      reason: opts.reason,
    },
    async (tx, audit) => {
      const before = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: {
          plan: true,
          subscriptionStatus: true,
          compedAt: true,
          billingSubscriptionId: true,
          suspendedByPlatformAt: true,
        },
      });

      const after = await tx.organization.update({
        where: { id: organizationId },
        data: {
          plan,
          ...(opts.comp
            ? {
                compedAt: before.compedAt ?? new Date(),
                /**
                 * A comped studio is a working studio. Left SUSPENDED it would
                 * be comped and switched off, which is nobody's intent — except
                 * where an OPERATOR suspended it, which this route must not
                 * undo.
                 *
                 * The `suspendedByPlatformAt` half of this condition was missing
                 * in the first version while this comment already claimed it,
                 * which made comping a way to reinstate a studio suspended for
                 * abuse. A comment asserting a guarantee the code does not
                 * implement is worse than no comment: it stops the next reader
                 * checking.
                 */
                ...(before.subscriptionStatus === 'SUSPENDED' &&
                before.suspendedByPlatformAt === null
                  ? { subscriptionStatus: 'ACTIVE' as const }
                  : {}),
              }
            : // Clearing the comp does not re-suspend and does not cancel
              // anything. It only stops claiming the plan is free.
              { compedAt: null }),
        },
        select: {
          plan: true,
          subscriptionStatus: true,
          compedAt: true,
          billingSubscriptionId: true,
        },
      });

      audit({
        metadata: {
          before: { plan: before.plan, comped: before.compedAt !== null },
          after: { plan: after.plan, comped: after.compedAt !== null },
          /**
           * Recorded at the moment of the decision, so the log answers "did we
           * know they were still being billed?" without anyone reconstructing
           * Stripe's state months later.
           */
          stripeSubscriptionStillActive: after.billingSubscriptionId !== null,
        },
      });

      if (opts.comp && after.billingSubscriptionId) {
        logger.warn(
          { organizationId, plan },
          'Studio comped while a Stripe subscription is still live — their card ' +
            'will continue to be charged until it is cancelled in Stripe',
        );
      }

      return after;
    },
  );
}

/**
 * Suspends a studio by operator decision.
 *
 * Reuses the existing SUSPENDED semantics rather than inventing a second kind of
 * off: new public bookings stop, everything already booked survives, and reads
 * stay open. The only new thing is `suspendedByPlatformAt`, which is what stops
 * the studio's next successful invoice from quietly reinstating them.
 */
export async function suspendStudio(
  actor: Actor,
  organizationId: string,
  reason: string,
) {
  await requireStudio(organizationId);

  return withAudit(
    {
      ...actor,
      action: 'organization.suspend',
      targetType: 'organization',
      targetId: organizationId,
      organizationId,
      reason,
    },
    async (tx, audit) => {
      const before = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { subscriptionStatus: true, suspendedByPlatformAt: true },
      });

      if (before.suspendedByPlatformAt) {
        throw AppError.conflict(
          'That studio is already suspended by the platform.',
          'ALREADY_SUSPENDED',
        );
      }

      const after = await tx.organization.update({
        where: { id: organizationId },
        data: {
          subscriptionStatus: 'SUSPENDED',
          suspendedByPlatformAt: new Date(),
          suspendedReason: reason,
        },
        select: { subscriptionStatus: true, suspendedByPlatformAt: true },
      });

      audit({
        metadata: {
          before: { status: before.subscriptionStatus },
          after: { status: after.subscriptionStatus },
        },
      });

      return after;
    },
  );
}

/**
 * Lifts an operator suspension.
 *
 * Deliberately does NOT decide what the studio's status should become on its
 * own terms — that is billing's job and billing has the facts. It restores
 * TRIALING if the trial is still running, ACTIVE if there is a live
 * subscription or a comp, and otherwise leaves them SUSPENDED for the billing
 * reason that was true before the operator ever intervened.
 *
 * Guessing ACTIVE here would hand a free account to any lapsed studio that
 * happened to get suspended twice.
 */
export async function unsuspendStudio(
  actor: Actor,
  organizationId: string,
  reason: string,
) {
  await requireStudio(organizationId);

  return withAudit(
    {
      ...actor,
      action: 'organization.unsuspend',
      targetType: 'organization',
      targetId: organizationId,
      organizationId,
      reason,
    },
    async (tx, audit) => {
      const before = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: {
          subscriptionStatus: true,
          suspendedByPlatformAt: true,
          trialEndsAt: true,
          billingSubscriptionId: true,
          compedAt: true,
        },
      });

      if (!before.suspendedByPlatformAt) {
        throw AppError.badRequest(
          'That studio is not suspended by the platform. A studio suspended by ' +
            'billing comes back when it pays.',
          'NOT_PLATFORM_SUSPENDED',
        );
      }

      const trialStillRunning =
        before.trialEndsAt !== null && before.trialEndsAt > new Date();

      const restored =
        before.billingSubscriptionId !== null || before.compedAt !== null
          ? ('ACTIVE' as const)
          : trialStillRunning
            ? ('TRIALING' as const)
            : ('SUSPENDED' as const);

      const after = await tx.organization.update({
        where: { id: organizationId },
        data: {
          subscriptionStatus: restored,
          suspendedByPlatformAt: null,
          suspendedReason: null,
        },
        select: { subscriptionStatus: true, suspendedByPlatformAt: true },
      });

      audit({
        metadata: {
          before: { status: before.subscriptionStatus },
          after: { status: after.subscriptionStatus },
          restoredTo: restored,
          /** So the log explains a studio that stayed off after an unsuspend. */
          stillSuspendedForBillingReasons: restored === 'SUSPENDED',
        },
      });

      return after;
    },
  );
}

/** Every plan an operator may set, with prices, for the dashboard's dropdown. */
export function availablePlans() {
  return Object.values(PLANS).map((plan) => ({
    id: plan.id,
    name: plan.name,
    priceCentsMonthly: plan.priceCentsMonthly,
  }));
}
