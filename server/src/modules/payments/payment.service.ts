import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { AppError, BookingErrorCode } from '../../lib/app-error';
import { createHold, convertHold, releaseHold } from '../../scheduling/hold.service';
import {
  evaluatePolicy,
  resolvePolicyForService,
  type PolicyTier,
} from '../policies/policy.service';
import { allocateRefund, collectedCents, priceBooking } from './money';
import { getPaymentProvider } from './provider.registry';
import type { WebhookEvent } from './provider';

// ---------------------------------------------------------------------------
// Connect onboarding
// ---------------------------------------------------------------------------

/**
 * Starts or resumes Stripe onboarding.
 *
 * The account is created by us; everything sensitive — bank details, identity
 * documents, tax information — is collected by Stripe on their own domain. We
 * never see it, store it, or become responsible for it.
 */
export async function startConnectOnboarding(
  organizationId: string,
  actorEmail: string,
) {
  const provider = getPaymentProvider();

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });

  let accountId = org.stripeAccountId;

  if (!accountId) {
    const created = await provider.createConnectAccount({
      email: actorEmail,
      organizationName: org.name,
      country: config.STRIPE_ACCOUNT_COUNTRY,
    });
    accountId = created.accountId;

    await prisma.organization.update({
      where: { id: organizationId },
      data: { stripeAccountId: accountId },
    });
  }

  const link = await provider.createAccountLink({
    accountId,
    // Stripe expires the link quickly; refresh sends them back to us to mint
    // a new one rather than showing a dead page.
    refreshUrl: `${config.APP_URL}/settings/payments?refresh=1`,
    returnUrl: `${config.APP_URL}/settings/payments?done=1`,
  });

  return { accountId, url: link.url, expiresAt: link.expiresAt };
}

/**
 * Re-reads the account from Stripe and mirrors the verdict locally.
 *
 * `chargesEnabled` is Stripe's decision, not ours. An account can exist, look
 * finished, and still be unable to take a payment — so availability of
 * checkout is gated on this mirrored flag rather than on "have they clicked
 * through onboarding".
 */
export async function refreshConnectStatus(organizationId: string) {
  const provider = getPaymentProvider();

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });
  if (!org.stripeAccountId) {
    return { connected: false, chargesEnabled: false, requirements: [] };
  }

  const status = await provider.getAccountStatus(org.stripeAccountId);

  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      stripeChargesEnabled: status.chargesEnabled,
      stripePayoutsEnabled: status.payoutsEnabled,
      stripeOnboardedAt:
        status.detailsSubmitted && !org.stripeOnboardedAt
          ? new Date()
          : org.stripeOnboardedAt,
    },
  });

  return {
    connected: true,
    chargesEnabled: status.chargesEnabled,
    payoutsEnabled: status.payoutsEnabled,
    requirements: status.requirements,
  };
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export type StartCheckoutInput = {
  organizationId: string;
  serviceTypeId: string;
  sessionId: string;
  customerEmail: string;
  customerName: string;
  seats: number;
  travelFeeCents?: number;
  successUrl: string;
  cancelUrl: string;
};

/**
 * Reserves the seats, then sends the customer to Stripe.
 *
 * ORDER MATTERS. The hold is taken FIRST, before the checkout session exists.
 * Reversing it means the customer can be three fields into their card details
 * when somebody else takes the last seat, and the failure lands after they
 * have paid rather than before they started.
 *
 * The amount is computed here from our own records. Nothing in the request
 * body influences it.
 */
export async function startCheckout(input: StartCheckoutInput) {
  const provider = getPaymentProvider();

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
  });

  if (!org.stripeAccountId || !org.stripeChargesEnabled) {
    throw AppError.conflict(
      'This studio is not set up to take payments yet.',
      'PAYMENTS_NOT_ENABLED',
    );
  }

  const service = await prisma.serviceType.findFirst({
    where: { id: input.serviceTypeId, organizationId: input.organizationId },
  });
  if (!service) throw AppError.notFound('Service not found.');

  const price = priceBooking({
    unitPriceCents: service.priceCents,
    seats: input.seats,
    travelFeeCents: input.travelFeeCents,
    depositType: service.depositType as 'none' | 'percent' | 'fixed',
    depositValue: service.depositValue,
  });

  if (!price.requiresPayment) {
    throw AppError.badRequest(
      'This booking does not require payment.',
      'NO_PAYMENT_REQUIRED',
    );
  }

  const hold = await createHold({
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    seats: input.seats,
  });

  // The Stripe session must die no later than the hold, or somebody could pay
  // for seats that had already been released back to the pool.
  const expiresAt = new Date(
    Math.min(
      hold!.expiresAt.getTime(),
      Date.now() + config.BOOKING_HOLD_TTL_MINUTES * 60_000,
    ),
  );

  try {
    const checkout = await provider.createCheckoutSession({
      connectedAccountId: org.stripeAccountId,
      amountCents: price.dueNowCents,
      currency: org.currency,
      productName: service.name,
      productDescription:
        price.kind === 'DEPOSIT'
          ? `Deposit — balance of ${(price.balanceCents / 100).toFixed(2)} due at the studio`
          : undefined,
      customerEmail: input.customerEmail,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      metadata: {
        holdId: hold!.id,
        organizationId: input.organizationId,
        serviceTypeId: input.serviceTypeId,
        sessionId: input.sessionId,
        customerEmail: input.customerEmail,
        customerName: input.customerName,
        seats: String(input.seats),
        totalCents: String(price.totalCents),
        travelFeeCents: String(price.travelFeeCents),
      },
      expiresAt,
      idempotencyKey: `checkout_${hold!.id}`,
    });

    const payment = await prisma.payment.create({
      data: {
        organizationId: input.organizationId,
        holdId: hold!.id,
        kind: price.kind,
        amountCents: price.dueNowCents,
        currency: org.currency,
        status: 'PENDING',
        provider: provider.name,
        providerCheckoutSessionId: checkout.id,
        providerAccountId: org.stripeAccountId,
      },
    });

    await prisma.bookingHold.update({
      where: { id: hold!.id },
      data: { checkoutReference: checkout.id },
    });

    return {
      checkoutUrl: checkout.url,
      paymentId: payment.id,
      holdId: hold!.id,
      expiresAt,
      price,
    };
  } catch (err) {
    // Stripe refused. Give the seats straight back rather than leaving them
    // reserved for ten minutes for a checkout that will never happen.
    await releaseHold(input.organizationId, hold!.id).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * Processes a verified webhook exactly once.
 *
 * Stripe retries until it receives a 2xx and does not promise single delivery,
 * so the same `checkout.session.completed` can arrive several times. The
 * unique constraint on (provider, event_id) is what makes that safe: a
 * duplicate loses the insert race and returns without doing the work again.
 *
 * This is also the AUTHORITATIVE path. The browser redirect after payment is
 * a convenience that may never happen — the customer can close the tab — so
 * nothing depends on it.
 */
export async function handleWebhook(event: WebhookEvent) {
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: event.id,
        eventType: event.type,
        payload: event.data as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      logger.info({ eventId: event.id }, 'Duplicate webhook ignored');
      return { handled: false, reason: 'duplicate' as const };
    }
    throw err;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutCompleted(event);
        break;
      case 'checkout.session.expired':
        await onCheckoutExpired(event);
        break;
      case 'account.updated':
        await onAccountUpdated(event);
        break;

      /**
       * Our own subscription events, not Connect ones.
       *
       * They arrive on the same endpoint because they come from the same
       * Stripe account — the platform's. `event.account` is null for these
       * and set for Connect events, which is what tells them apart.
       */
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await onSubscriptionEvent(event);
        break;
      case 'invoice.payment_failed':
        await onInvoicePaymentFailed(event);
        break;
      case 'invoice.payment_succeeded':
        await onInvoicePaymentSucceeded(event);
        break;
      default:
        logger.debug({ type: event.type }, 'Unhandled webhook type');
    }

    await prisma.webhookEvent.update({
      where: { provider_eventId: { provider: 'stripe', eventId: event.id } },
      data: { processedAt: new Date() },
    });

    return { handled: true };
  } catch (err) {
    // Record the failure and rethrow. A non-2xx makes Stripe retry, which is
    // what we want for a transient fault — and the row is already there, so a
    // retry of a genuinely broken event will not loop forever unnoticed.
    await prisma.webhookEvent.update({
      where: { provider_eventId: { provider: 'stripe', eventId: event.id } },
      data: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

async function onCheckoutCompleted(event: WebhookEvent) {
  const data = event.data as {
    id: string;
    payment_intent?: string;
    payment_status?: string;
    amount_total?: number;
    metadata?: Record<string, string>;
  };

  const metadata = data.metadata ?? {};
  const holdId = metadata.holdId;
  const organizationId = metadata.organizationId;

  if (!holdId || !organizationId) {
    logger.warn({ sessionId: data.id }, 'Checkout completed without metadata');
    return;
  }

  if (data.payment_status !== 'paid') {
    logger.warn({ sessionId: data.id }, 'Checkout completed but not paid');
    return;
  }

  const customer = await upsertCustomer(organizationId, {
    email: metadata.customerEmail ?? '',
    name: metadata.customerName ?? 'Customer',
  });

  // The hold already owns the seats, so this transfers them rather than
  // taking more. Double-incrementing here would silently shrink the class.
  const booking = await convertHold(organizationId, holdId, {
    customerId: customer.id,
    serviceTypeId: metadata.serviceTypeId,
    source: 'web',
  });

  const totalCents = Number(metadata.totalCents ?? data.amount_total ?? 0);
  const travelFeeCents = Number(metadata.travelFeeCents ?? 0);

  await prisma.booking.update({
    where: { id: booking.id },
    data: { totalCents, travelFeeCents, status: 'CONFIRMED' },
  });

  await prisma.payment.updateMany({
    where: { providerCheckoutSessionId: data.id },
    data: {
      bookingId: booking.id,
      status: 'SUCCEEDED',
      providerPaymentIntentId: data.payment_intent ?? null,
      succeededAt: new Date(),
    },
  });

  // Queued, not sent. The webhook must return 200 quickly or Stripe retries
  // it, and an email provider is not something to make Stripe wait on.
  const { scheduleBookingNotifications } = await import(
    '../notifications/notification.service'
  );
  await scheduleBookingNotifications(booking.id).catch((err) => {
    logger.error({ err, bookingId: booking.id }, 'Failed to queue notifications');
  });

  logger.info({ bookingId: booking.id }, 'Booking confirmed by payment');
}

/**
 * The customer walked away. Give the seats back immediately rather than
 * waiting for the sweep — a popular class should not sit half-reserved
 * because somebody opened checkout and changed their mind.
 */
async function onCheckoutExpired(event: WebhookEvent) {
  const data = event.data as { id: string; metadata?: Record<string, string> };
  const holdId = data.metadata?.holdId;
  const organizationId = data.metadata?.organizationId;

  if (holdId && organizationId) {
    await releaseHold(organizationId, holdId).catch(() => {});
  }

  await prisma.payment.updateMany({
    where: { providerCheckoutSessionId: data.id, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });
}

async function onAccountUpdated(event: WebhookEvent) {
  const data = event.data as {
    id: string;
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
    details_submitted?: boolean;
  };

  await prisma.organization.updateMany({
    where: { stripeAccountId: data.id },
    data: {
      stripeChargesEnabled: data.charges_enabled ?? false,
      stripePayoutsEnabled: data.payouts_enabled ?? false,
      ...(data.details_submitted ? { stripeOnboardedAt: new Date() } : {}),
    },
  });
}

async function onSubscriptionEvent(event: WebhookEvent) {
  const data = event.data as {
    id: string;
    status: string;
    customer: string;
    current_period_end?: number;
    metadata?: Record<string, string>;
  };

  const { onSubscriptionChanged } = await import('../billing/billing.service');

  await onSubscriptionChanged({
    id: data.id,
    // A deletion arrives with whatever status it had; treat it as cancelled.
    status: event.type === 'customer.subscription.deleted' ? 'canceled' : data.status,
    customerId: data.customer,
    currentPeriodEnd: data.current_period_end ?? null,
    planId: data.metadata?.planId,
  });
}

async function onInvoicePaymentFailed(event: WebhookEvent) {
  const data = event.data as { customer: string };
  const { onPaymentFailed } = await import('../billing/billing.service');
  await onPaymentFailed(data.customer);
}

async function onInvoicePaymentSucceeded(event: WebhookEvent) {
  const data = event.data as { customer: string };
  const { onPaymentSucceeded } = await import('../billing/billing.service');
  await onPaymentSucceeded(data.customer);
}

async function upsertCustomer(
  organizationId: string,
  input: { email: string; name: string },
) {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.customer.findFirst({
    where: { organizationId, email },
  });
  if (existing) return existing;

  return prisma.customer.create({
    data: { organizationId, email, name: input.name },
  });
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

/**
 * Refunds a cancelled booking according to the studio's policy.
 *
 * The amount comes from the same `evaluatePolicy` the customer saw quoted on
 * the manage page, so the number they were promised and the number they
 * receive cannot disagree.
 *
 * Refunds are apportioned across the payments that actually happened — a
 * deposit and a balance are two separate charges, possibly on two cards, and
 * "refund 50%" has to be split between them.
 */
export async function refundForCancellation(
  organizationId: string,
  bookingId: string,
  opts: { reason?: string; hoursOfNotice?: number } = {},
) {
  const provider = getPaymentProvider();

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId },
    include: { payments: true },
  });
  if (!booking) throw AppError.notFound('Booking not found.');

  const succeeded = booking.payments.filter(
    (p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED',
  );

  const collected = collectedCents(succeeded);
  if (collected <= 0) {
    return { refundedCents: 0, creditCents: 0, refunds: [] };
  }

  const policy = await resolvePolicyForService(
    organizationId,
    booking.serviceTypeId,
  );

  const hoursOfNotice =
    opts.hoursOfNotice ??
    Math.max(0, (booking.startsAt.getTime() - Date.now()) / 3_600_000);

  const outcome = policy
    ? evaluatePolicy(
        policy.tiers as unknown as PolicyTier[],
        collected,
        hoursOfNotice,
      )
    : { refundCents: collected, creditCents: 0, tier: null };

  if (outcome.refundCents <= 0) {
    return {
      refundedCents: 0,
      creditCents: outcome.creditCents,
      refunds: [],
    };
  }

  const allocations = allocateRefund(
    succeeded.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      refundedCents: p.refundedCents,
      succeededAt: p.succeededAt,
    })),
    outcome.refundCents,
  );

  const issued: { paymentId: string; amountCents: number; refundId: string }[] = [];

  for (const allocation of allocations) {
    const payment = succeeded.find((p) => p.id === allocation.paymentId)!;
    if (!payment.providerPaymentIntentId || !payment.providerAccountId) continue;

    const refund = await provider.createRefund({
      connectedAccountId: payment.providerAccountId,
      paymentIntentId: payment.providerPaymentIntentId,
      amountCents: allocation.amountCents,
      reason: opts.reason ?? 'requested_by_customer',
      // Deterministic per payment per booking: a retried cancellation cannot
      // refund the same money twice.
      idempotencyKey: `refund_${booking.id}_${payment.id}`,
    });

    const refundedTotal = payment.refundedCents + allocation.amountCents;

    await prisma.$transaction([
      prisma.refund.create({
        data: {
          paymentId: payment.id,
          amountCents: allocation.amountCents,
          creditCents: outcome.creditCents,
          reason: opts.reason,
          providerRefundId: refund.id,
          status: refund.status,
        },
      }),
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          refundedCents: refundedTotal,
          status:
            refundedTotal >= payment.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        },
      }),
    ]);

    issued.push({
      paymentId: payment.id,
      amountCents: allocation.amountCents,
      refundId: refund.id,
    });
  }

  logger.info(
    { bookingId, refundedCents: outcome.refundCents },
    'Cancellation refund issued',
  );

  return {
    refundedCents: outcome.refundCents,
    creditCents: outcome.creditCents,
    refunds: issued,
  };
}

/** What has been paid and what is still owed, for the dashboard and receipts. */
export async function getBookingPaymentSummary(
  organizationId: string,
  bookingId: string,
) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId },
    include: { payments: { include: { refunds: true } } },
  });
  if (!booking) throw AppError.notFound('Booking not found.');

  const paidCents = collectedCents(booking.payments);

  return {
    totalCents: booking.totalCents,
    paidCents,
    outstandingCents: Math.max(0, booking.totalCents - paidCents),
    payments: booking.payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      amountCents: p.amountCents,
      refundedCents: p.refundedCents,
      status: p.status,
      succeededAt: p.succeededAt,
    })),
  };
}

export { randomUUID };
