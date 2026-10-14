import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../../src/lib/prisma';
import { createStudio, resetDb } from '../helpers/fixtures';
import {
  getPlansOverview,
  listIntegrations,
  listWebhooks,
} from '../../src/modules/platform/management.service';
import { FEATURE_ENFORCED, type Feature } from '../../src/modules/billing/plan';
import { handleWebhook } from '../../src/modules/payments/payment.service';

/**
 * Platform management.
 *
 * The load-bearing test here is the last one. `FEATURE_ENFORCED` is a hand-kept
 * claim about the code — which plan features something actually gates — and a
 * hand-kept claim is exactly the kind that drifts silently. It is checked
 * against the source rather than trusted, because the screen it feeds exists to
 * report a gap, and a stale map would report the gap as closed.
 */

const query = { limit: 50, offset: 0 };

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
});

describe('plans overview', () => {
  it('counts studios per plan and only bills the paying ones', async () => {
    const paying = await createStudio({ name: 'Clay & Co' });
    await prisma.organization.update({
      where: { id: paying.organization.id },
      data: { plan: 'STUDIO', subscriptionStatus: 'ACTIVE' },
    });

    const trialing = await createStudio({ name: 'Kiln House' });
    await prisma.organization.update({
      where: { id: trialing.organization.id },
      data: { plan: 'STUDIO', subscriptionStatus: 'TRIALING' },
    });

    const { plans, editable, featuresEditable } = await getPlansOverview();
    const studio = plans.find((p) => p.id === 'STUDIO')!;

    expect(studio.studios).toBe(2);
    expect(studio.payingStudios).toBe(1);
    // Two studios on the plan, one paying: MRR is one subscription.
    expect(studio.mrrCents).toBe(8900);

    /*
      Price and limits are editable now that they are data and every studio
      records what it agreed to pay. Features are still not: a toggle for a
      flag nothing reads would be a control that does nothing, and three of the
      five are in exactly that state.
    */
    expect(editable).toBe(true);
    expect(featuresEditable).toBe(false);
  });

  it('separates a feature being included from it being enforced', async () => {
    const { plans, unenforced } = await getPlansOverview();
    const pro = plans.find((p) => p.id === 'PRO')!;

    const courses = pro.features.find((f) => f.key === 'courseSeries')!;
    expect(courses.included).toBe(true);
    expect(courses.enforced).toBe(true);

    // Sold on Pro, gated by nothing — and there is no public API to gate.
    const apiAccess = pro.features.find((f) => f.key === 'apiAccess')!;
    expect(apiAccess.included).toBe(true);
    expect(apiAccess.enforced).toBe(false);

    expect(unenforced.map((f) => f.key)).toEqual(
      expect.arrayContaining(['smsReminders', 'apiAccess', 'whiteLabel']),
    );
  });

  /**
   * The map is a claim about the code; this is the check that it still is one.
   *
   * `requireFeature` call sites cannot be introspected at runtime, so the
   * source is read instead. Adding a gate without updating the map would leave
   * the Plans screen reporting a hole that is no longer there — and removing
   * one would leave it reporting a gate that no longer exists, which is worse.
   */
  it('matches the requireFeature calls that actually exist in the source', () => {
    /* The WHOLE source tree, not a list of files somebody has to remember to
       extend. A hardcoded list is the same failure mode as the map itself:
       a gate added in an unlisted file would leave this passing while the
       Plans screen reports a hole that has since been closed. */
    function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        return entry.isFile() && path.endsWith('.ts') ? [path] : [];
      });
    }

    const gated = new Set<string>();
    for (const file of walk(join(__dirname, '../../src'))) {
      const text = readFileSync(file, 'utf8');
      // The definition itself, not a call site.
      if (file.endsWith(join('billing', 'plan.ts'))) continue;
      for (const match of text.matchAll(
        /requireFeature\([^,]+,\s*'([a-zA-Z]+)'/g,
      )) {
        gated.add(match[1]!);
      }
    }

    for (const [feature, claimed] of Object.entries(FEATURE_ENFORCED)) {
      expect(
        gated.has(feature),
        `FEATURE_ENFORCED says ${feature} is ${claimed ? 'enforced' : 'not enforced'}, but the source ${gated.has(feature) ? 'does' : 'does not'} gate it`,
      ).toBe(claimed as boolean);
    }

    // And the type has not gained a feature nobody classified.
    const known = Object.keys(FEATURE_ENFORCED) as Feature[];
    for (const feature of gated) {
      expect(known).toContain(feature as Feature);
    }
  });
});

describe('webhooks', () => {
  it('filters by outcome and counts recent failures', async () => {
    const studio = await createStudio({ name: 'Clay & Co' });

    await prisma.webhookEvent.createMany({
      data: [
        {
          organizationId: studio.organization.id,
          provider: 'stripe',
          eventId: 'evt_ok',
          eventType: 'checkout.session.completed',
          payload: {},
          processedAt: new Date(),
        },
        {
          organizationId: studio.organization.id,
          provider: 'stripe',
          eventId: 'evt_bad',
          eventType: 'invoice.payment_failed',
          payload: {},
          error: 'boom',
        },
        {
          organizationId: studio.organization.id,
          provider: 'stripe',
          eventId: 'evt_pending',
          eventType: 'account.updated',
          payload: {},
        },
      ],
    });

    const failed = await listWebhooks({ ...query, status: 'failed' });
    expect(failed.total).toBe(1);
    expect(failed.rows[0]!.eventId).toBe('evt_bad');
    expect(failed.failedLast24h).toBe(1);

    const processed = await listWebhooks({ ...query, status: 'processed' });
    expect(processed.total).toBe(1);

    // Received but not yet handled is its own state, not a failure.
    const pending = await listWebhooks({ ...query, status: 'pending' });
    expect(pending.total).toBe(1);
    expect(pending.rows[0]!.eventId).toBe('evt_pending');

    // The screen must not let an absent provider read as a healthy one.
    expect(failed.note).toMatch(/only stripe/i);
  });

  /*
    The log's Studio column read "—" for every row: events were stored
    without the studio they concern. Types the handlers ignore are used here
    so only the attribution is under test.
  */
  it('records which studio each event is about', async () => {
    const studio = await createStudio({ name: 'Clay & Co' });
    const id = studio.organization.id;
    await prisma.organization.update({
      where: { id },
      data: {
        stripeAccountId: 'acct_current',
        previousStripeAccountId: 'acct_previous',
        billingCustomerId: 'cus_clay',
      },
    });

    const send = (eventId: string, accountId: string | null, data: Record<string, unknown>) =>
      handleWebhook({ id: eventId, type: 'test.ignored', accountId, data });

    await send('evt_connect', 'acct_current', { id: 'pi_1' });
    await send('evt_old_account', 'acct_previous', { id: 'pi_2' });
    await send('evt_metadata', null, { id: 'cs_1', metadata: { organizationId: id } });
    await send('evt_billing', null, { id: 'in_1', customer: 'cus_clay' });
    await send('evt_stranger', 'acct_unknown', { id: 'pi_3' });
    // Not a studio: must not trip the foreign key and lose the event.
    await send('evt_bad_meta', null, {
      id: 'cs_2',
      metadata: { organizationId: '00000000-0000-0000-0000-000000000000' },
    });

    const { rows } = await listWebhooks(query);
    const studioOf = (eventId: string) =>
      rows.find((r) => r.eventId === eventId)?.organization?.name ?? null;

    expect(studioOf('evt_connect')).toBe('Clay & Co');
    expect(studioOf('evt_old_account')).toBe('Clay & Co');
    expect(studioOf('evt_metadata')).toBe('Clay & Co');
    expect(studioOf('evt_billing')).toBe('Clay & Co');
    expect(studioOf('evt_stranger')).toBeNull();
    expect(studioOf('evt_bad_meta')).toBeNull();
    expect(rows).toHaveLength(6);
  });

  it('fills in the studio for events logged before it was recorded', async () => {
    const studio = await createStudio({ name: 'Clay & Co' });
    const id = studio.organization.id;
    await prisma.organization.update({
      where: { id },
      data: { stripeAccountId: 'acct_current', billingCustomerId: 'cus_clay' },
    });
    await prisma.webhookEvent.createMany({
      data: [
        { eventId: 'evt_a', eventType: 'checkout.session.completed', payload: { metadata: { organizationId: id } } },
        { eventId: 'evt_b', eventType: 'invoice.payment_succeeded', payload: { customer: 'cus_clay' } },
        { eventId: 'evt_c', eventType: 'account.updated', payload: { id: 'acct_current' } },
        { eventId: 'evt_d', eventType: 'account.updated', payload: { id: 'acct_someone_else' } },
      ],
    });

    const sql = readFileSync(
      join(__dirname, '../../prisma/migrations/20261014120000_webhook_event_studio/migration.sql'),
      'utf8',
    );
    // Comments out first: they contain semicolons.
    const statements = sql.replace(/--.*$/gm, '').split(';').map((s) => s.trim());
    for (const statement of statements.filter(Boolean)) {
      await prisma.$executeRawUnsafe(statement);
    }

    const rows = await prisma.webhookEvent.findMany({ select: { eventId: true, organizationId: true } });
    const of = (e: string) => rows.find((r) => r.eventId === e)!.organizationId;
    expect(of('evt_a')).toBe(id);
    expect(of('evt_b')).toBe(id);
    expect(of('evt_c')).toBe(id);
    expect(of('evt_d')).toBeNull();
  });
});

describe('integrations', () => {
  it('reports per-studio state and whether the platform can do it at all', async () => {
    const connected = await createStudio({ name: 'Clay & Co' });
    await prisma.organization.update({
      where: { id: connected.organization.id },
      data: {
        stripeAccountId: 'acct_1',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: false,
      },
    });

    const res = await listIntegrations(query);
    const row = res.rows.find((r) => r.id === connected.organization.id)!;

    expect(row.stripe.connected).toBe(true);
    // Half-enabled is the state that matters: charges work, money never lands.
    expect(row.stripe.chargesEnabled).toBe(true);
    expect(row.stripe.payoutsEnabled).toBe(false);

    /* Platform-level truth, upstream of any studio's own state: with no Google
       credentials every calendar is an in-memory fake regardless. */
    expect(res.providers.googleCalendar).toBe(false);
  });
});
