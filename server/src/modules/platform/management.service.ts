import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  FEATURE_ENFORCED,
  FEATURE_LABELS,
  PLANS,
  refreshPlans,
  type Feature,
  type PlanId,
} from '../billing/plan';
import { withAudit, type AuditEntry } from './audit.service';
import { currentMrr } from './mrr.service';
import { config } from '../../config';
import type { ListQuery } from './catalog.service';

/**
 * Platform management: webhooks, integrations, and the plan matrix.
 *
 * The webhook and integration views are read-only. Retrying a webhook or
 * reconnecting a calendar from here would act as the studio without a support
 * session recording it — and in the webhook case would duplicate work Stripe
 * already does on its own schedule.
 *
 * Plan price and limits are the exception: they are platform-wide settings
 * rather than one studio's data, nobody is impersonated by changing them, and
 * every change is audited with its before and after.
 */

function envelope<T>(rows: T[], total: number, query: ListQuery) {
  return { rows, total, limit: query.limit, offset: query.offset };
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type WebhookStatus = 'processed' | 'failed' | 'pending';

/**
 * The webhook log.
 *
 * ONLY STRIPE IS IN HERE. `webhookEvent` rows are written in exactly one place
 * — the Stripe handler — so Twilio and Google deliveries leave no trace at all.
 * The screen says so rather than presenting an empty Twilio column as "no
 * failures", which is the reading that would get somebody hurt.
 */
export async function listWebhooks(
  query: ListQuery & { status?: WebhookStatus },
) {
  const statusWhere: Prisma.WebhookEventWhereInput =
    query.status === 'failed'
      ? { error: { not: null } }
      : query.status === 'processed'
        ? { processedAt: { not: null }, error: null }
        : query.status === 'pending'
          ? { processedAt: null, error: null }
          : {};

  const where: Prisma.WebhookEventWhereInput = {
    ...statusWhere,
    ...(query.organizationId ? { organizationId: query.organizationId } : {}),
    ...(query.search
      ? {
          OR: [
            { eventType: { contains: query.search, mode: 'insensitive' } },
            { eventId: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total, failedLast24h] = await Promise.all([
    prisma.webhookEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
      select: {
        id: true,
        provider: true,
        eventId: true,
        eventType: true,
        processedAt: true,
        error: true,
        createdAt: true,
        organization: { select: { id: true, name: true } },
      },
    }),
    prisma.webhookEvent.count({ where }),
    prisma.webhookEvent.count({
      where: {
        error: { not: null },
        createdAt: { gte: new Date(Date.now() - 86_400_000) },
      },
    }),
  ]);

  return {
    ...envelope(rows, total, query),
    failedLast24h,
    note: 'Only Stripe webhooks are recorded. Twilio and Google deliveries are not logged.',
  };
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

/**
 * Every studio's integration state, in one list.
 *
 * Two genuinely different things sit side by side here. Stripe Connect is a
 * property of the STUDIO — one account, mirrored from `account.updated`.
 * Calendars are per INSTRUCTOR, so a studio can be half-connected, and the
 * count that matters is how many of its instructors need to reconnect.
 */
export async function listIntegrations(query: ListQuery) {
  const where: Prisma.OrganizationWhereInput = query.search
    ? { name: { contains: query.search, mode: 'insensitive' } }
    : {};

  const [studios, total, calendars] = await Promise.all([
    prisma.organization.findMany({
      where,
      orderBy: { name: 'asc' },
      take: query.limit,
      skip: query.offset,
      select: {
        id: true,
        name: true,
        stripeAccountId: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeOnboardedAt: true,
      },
    }),
    prisma.organization.count({ where }),
    prisma.calendarConnection.groupBy({
      by: ['organizationId', 'status'],
      _count: { _all: true },
    }),
  ]);

  const byStudio = new Map<string, { active: number; needsReauth: number; disabled: number }>();
  for (const row of calendars) {
    const entry = byStudio.get(row.organizationId) ?? {
      active: 0,
      needsReauth: 0,
      disabled: 0,
    };
    if (row.status === 'ACTIVE') entry.active += row._count._all;
    else if (row.status === 'NEEDS_REAUTH') entry.needsReauth += row._count._all;
    else entry.disabled += row._count._all;
    byStudio.set(row.organizationId, entry);
  }

  const rows = studios.map((studio) => ({
    id: studio.id,
    name: studio.name,
    stripe: {
      connected: studio.stripeAccountId !== null,
      chargesEnabled: studio.stripeChargesEnabled,
      payoutsEnabled: studio.stripePayoutsEnabled,
      onboardedAt: studio.stripeOnboardedAt,
    },
    calendars: byStudio.get(studio.id) ?? {
      active: 0,
      needsReauth: 0,
      disabled: 0,
    },
  }));

  return {
    ...envelope(rows, total, query),
    /* Whether the PLATFORM can do these at all, which is upstream of any
       studio's own state: with no Google credentials every calendar falls back
       to an in-memory fake, and no amount of studio-side connecting fixes it. */
    providers: {
      stripe: Boolean(config.STRIPE_SECRET_KEY),
      googleCalendar: Boolean(
        config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET,
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Plans and limits
// ---------------------------------------------------------------------------

/**
 * The plan matrix: what each plan costs, what it allows, what it CLAIMS, and
 * what is actually enforced.
 *
 * Price and the two limits are editable — they live in `plan_settings`. The
 * feature flags are not, because a feature is only real when something calls
 * `requireFeature` with it, and a toggle for one nothing reads would be a
 * control that does nothing.
 */
export async function getPlansOverview() {
  const [byPlan, activeByPlan, mrr] = await Promise.all([
    prisma.organization.groupBy({ by: ['plan'], _count: { _all: true } }),
    prisma.organization.groupBy({
      by: ['plan'],
      where: { subscriptionStatus: 'ACTIVE' },
      _count: { _all: true },
    }),
    /* Per-plan MRR from what studios AGREED to pay, not list price times a
       headcount — the same reason the column exists. After a price edit the
       two differ, and the card must show the money actually being billed. */
    currentMrr(),
  ]);

  const total = new Map(byPlan.map((r) => [r.plan, r._count._all]));
  const paying = new Map(activeByPlan.map((r) => [r.plan, r._count._all]));
  const mrrByPlan = new Map(mrr.byPlan.map((r) => [r.plan, r.mrrCents]));

  const features = Object.keys(FEATURE_LABELS) as Feature[];

  const plans = (['SOLO', 'STUDIO', 'PRO'] as PlanId[]).map((id) => {
    const plan = PLANS[id];
    const payingCount = paying.get(id) ?? 0;

    return {
      id,
      name: plan.name,
      priceCentsMonthly: plan.priceCentsMonthly,
      blurb: plan.blurb,
      maxStaff: plan.maxStaff,
      maxLocations: plan.maxLocations,
      studios: total.get(id) ?? 0,
      payingStudios: payingCount,
      mrrCents: mrrByPlan.get(id) ?? 0,
      features: features.map((key) => ({
        key,
        label: FEATURE_LABELS[key],
        included: plan[key],
        /* The distinction the screen exists to make: included is a claim,
           enforced is whether anything checks it. */
        enforced: FEATURE_ENFORCED[key],
      })),
    };
  });

  const [nearLimit, history] = await Promise.all([
    studiosNearLimit(),
    planChangeHistory(),
  ]);

  return {
    plans,
    unenforced: features.filter((f) => !FEATURE_ENFORCED[f]).map((f) => ({
      key: f,
      label: FEATURE_LABELS[f],
    })),
    nearLimit,
    history,
    /**
     * What actually happens at each boundary, as the code behaves — not as a
     * policy document would like it to. Two entries the reference design had
     * are absent because they describe machinery that does not exist (an SMS
     * allowance and a storage quota), and the downgrade row is stated as it
     * really is rather than as "downgrades are blocked", which nothing does.
     */
    enforcement: [
      {
        boundary: 'Instructor limit reached',
        behaviour: 'Adding an instructor is blocked, naming the plan that lifts it',
        real: true,
      },
      {
        boundary: 'Location limit reached',
        behaviour: 'Adding a location is blocked, naming the plan that lifts it',
        real: true,
      },
      {
        boundary: 'Trial expired',
        behaviour: 'Suspended: the booking page stops taking new bookings',
        real: true,
      },
      {
        boundary: 'Past due',
        behaviour:
          'Nothing switches off during the grace period — booking pages stay live',
        real: true,
      },
      {
        boundary: 'Downgraded below current usage',
        behaviour:
          'Allowed. The studio keeps the instructors and locations it has and simply cannot add more',
        real: true,
      },
    ],
    editable: true,
    editableFields: ['priceCentsMonthly', 'maxStaff', 'maxLocations'],
    /* Features are not editable: a toggle for a flag nothing reads would be a
       control that does nothing. See FEATURE_ENFORCED. */
    featuresEditable: false,
  };
}

/**
 * Studios at or one short of their plan's instructor limit.
 *
 * The upgrade candidates, and the same rule the dashboard's attention list
 * uses — counted on ACTIVE staff, matching how the limit is actually enforced
 * when somebody tries to add one.
 */
async function studiosNearLimit() {
  const [orgs, staff] = await Promise.all([
    prisma.organization.findMany({
      select: { id: true, name: true, plan: true },
    }),
    prisma.staff.groupBy({
      by: ['organizationId'],
      where: { isActive: true },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map(staff.map((s) => [s.organizationId, s._count._all]));

  return orgs
    .map((org) => ({
      id: org.id,
      name: org.name,
      plan: org.plan as PlanId,
      planName: PLANS[org.plan as PlanId].name,
      staff: counts.get(org.id) ?? 0,
      limit: PLANS[org.plan as PlanId].maxStaff,
    }))
    .filter((row) => row.limit !== null && row.staff >= row.limit - 1)
    .sort((a, b) => b.staff / (b.limit ?? 1) - a.staff / (a.limit ?? 1));
}

/** Every plan edit, read back out of the audit log rather than a second table. */
async function planChangeHistory() {
  const rows = await prisma.platformAuditLog.findMany({
    where: { action: 'plan.settings.set' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      actorEmail: true,
      targetId: true,
      reason: true,
      metadata: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    plan: row.targetId,
    actor: row.actorEmail,
    reason: row.reason,
    changes: row.metadata,
    at: row.createdAt,
  }));
}

export type PlanSettingsPatch = {
  priceCentsMonthly?: number;
  maxStaff?: number | null;
  maxLocations?: number | null;
};

/**
 * Changes a plan's price or limits.
 *
 * Audited, and the audit row carries before AND after — a price change is the
 * kind of thing somebody asks about a quarter later, and "who set it to $49"
 * is unanswerable from the current value alone.
 *
 * EXISTING SUBSCRIBERS ARE UNTOUCHED. Their `subscribedPriceCents` was fixed
 * when they subscribed, so this moves the list price for new subscriptions
 * only — which is also what Stripe does, since it holds each subscription's own
 * price. The two therefore stay in step instead of drifting apart.
 */
/** Same shape the other audited platform writes take. */
type Actor = Pick<AuditEntry, 'actorUserId' | 'actorEmail' | 'ip' | 'userAgent'>;

export async function updatePlanSettings(
  actor: Actor,
  planId: PlanId,
  patch: PlanSettingsPatch,
  reason: string,
) {
  const result = await withAudit(
    {
      ...actor,
      action: 'plan.settings.set',
      targetType: 'plan',
      targetId: planId,
      reason,
    },
    async (tx, audit) => {
      const before = await tx.planSetting.findUniqueOrThrow({
        where: { id: planId },
      });

      const after = await tx.planSetting.update({
        where: { id: planId },
        data: {
          ...(patch.priceCentsMonthly !== undefined
            ? { priceCentsMonthly: patch.priceCentsMonthly }
            : {}),
          ...(patch.maxStaff !== undefined ? { maxStaff: patch.maxStaff } : {}),
          ...(patch.maxLocations !== undefined
            ? { maxLocations: patch.maxLocations }
            : {}),
        },
      });

      audit({
        metadata: {
          before: {
            priceCentsMonthly: before.priceCentsMonthly,
            maxStaff: before.maxStaff,
            maxLocations: before.maxLocations,
          },
          after: {
            priceCentsMonthly: after.priceCentsMonthly,
            maxStaff: after.maxStaff,
            maxLocations: after.maxLocations,
          },
        },
      });

      return after;
    },
  );

  // The cache every synchronous PLANS[id] reader sees, updated immediately in
  // this process; other processes pick it up on the sweep worker's hourly beat.
  await refreshPlans();

  return result;
}
