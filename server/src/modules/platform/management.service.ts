import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  FEATURE_ENFORCED,
  FEATURE_LABELS,
  PLANS,
  type Feature,
  type PlanId,
} from '../billing/plan';
import { config } from '../../config';
import type { ListQuery } from './catalog.service';

/**
 * Platform management: webhooks, integrations, and the plan matrix.
 *
 * All read-only. Retrying a webhook or reconnecting a calendar from here would
 * act as the studio without a support session recording it — and in the webhook
 * case would duplicate work Stripe already does on its own schedule.
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
 * The plan matrix, with what each plan CLAIMS and what is actually enforced.
 *
 * Read-only, and not for want of a form: `PLANS` is a TypeScript constant that
 * the marketing site, Stripe checkout and this screen all read. Editing a price
 * here would need it to become data, and then the pricing page and the checkout
 * would have to read that data too — otherwise the site advertises one number
 * and the card is charged another.
 */
export async function getPlansOverview() {
  const [byPlan, activeByPlan] = await Promise.all([
    prisma.organization.groupBy({ by: ['plan'], _count: { _all: true } }),
    prisma.organization.groupBy({
      by: ['plan'],
      where: { subscriptionStatus: 'ACTIVE' },
      _count: { _all: true },
    }),
  ]);

  const total = new Map(byPlan.map((r) => [r.plan, r._count._all]));
  const paying = new Map(activeByPlan.map((r) => [r.plan, r._count._all]));

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
      mrrCents: plan.priceCentsMonthly * payingCount,
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

  return {
    plans,
    unenforced: features.filter((f) => !FEATURE_ENFORCED[f]).map((f) => ({
      key: f,
      label: FEATURE_LABELS[f],
    })),
    editable: false,
    readOnlyReason:
      'Plan prices and limits are defined in code (billing/plan.ts), which the marketing site and Stripe checkout also read. Changing them here would let the advertised price and the charged price disagree.',
  };
}
