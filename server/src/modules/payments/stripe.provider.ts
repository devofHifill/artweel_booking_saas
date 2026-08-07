import Stripe from 'stripe';
import { AppError } from '../../lib/app-error';
import type {
  CheckoutSession,
  CheckoutSessionInput,
  CheckoutSessionResult,
  ConnectAccountStatus,
  PaymentProvider,
  RefundInput,
  RefundResult,
  WebhookEvent,
} from './provider';

/**
 * The real Stripe adapter. Translates, never decides.
 *
 * Connect model: **Express accounts, direct charges.** The studio is the
 * merchant of record — money lands in their balance, they own the dispute,
 * and we are never holding customer funds. Standard accounts would push the
 * studio into Stripe's full dashboard (too much for a one-person pottery
 * business); Custom would make us responsible for their onboarding and
 * compliance. Express is the middle, and it is why onboarding is a redirect
 * to Stripe rather than a form we built.
 *
 * No application fee. The pricing model is a flat subscription, and taking a
 * cut of a studio's revenue is the exact thing we position against.
 */
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe';
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey, {
      // Pinned. An unpinned version means Stripe can change response shapes
      // under a running deployment.
      apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
      typescript: true,
      maxNetworkRetries: 2,
      timeout: 20_000,
    });
  }

  async createConnectAccount(input: {
    email: string;
    organizationName: string;
    country: string;
  }) {
    const account = await this.stripe.accounts.create({
      type: 'express',
      email: input.email,
      country: input.country,
      business_profile: { name: input.organizationName },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      settings: {
        payouts: { schedule: { interval: 'daily', delay_days: 'minimum' } },
      },
    });

    return { accountId: account.id };
  }

  async createAccountLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }) {
    const link = await this.stripe.accountLinks.create({
      account: input.accountId,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: 'account_onboarding',
    });

    return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
  }

  async getAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
    const account = await this.stripe.accounts.retrieve(accountId);

    return {
      accountId: account.id,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
      requirements: [
        ...(account.requirements?.currently_due ?? []),
        ...(account.requirements?.past_due ?? []),
      ],
    };
  }

  async createCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer_email: input.customerEmail,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountCents,
              product_data: {
                name: input.productName,
                ...(input.productDescription
                  ? { description: input.productDescription }
                  : {}),
              },
            },
          },
        ],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        // Echoed back on the webhook; how a payment finds its hold.
        metadata: input.metadata,
        payment_intent_data: { metadata: input.metadata },
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
      },
      {
        // Direct charge: created ON the studio's account, so the funds are
        // theirs from the moment they settle.
        stripeAccount: input.connectedAccountId,
        // Survives a retry after a timeout without charging twice.
        idempotencyKey: input.idempotencyKey,
      },
    );

    if (!session.url) {
      throw new AppError('Stripe did not return a checkout URL.', 502);
    }

    return {
      id: session.id,
      url: session.url,
      expiresAt: new Date((session.expires_at ?? 0) * 1000),
    };
  }

  async retrieveCheckoutSession(
    sessionId: string,
    connectedAccountId: string,
  ): Promise<CheckoutSessionResult> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId, {
      stripeAccount: connectedAccountId,
    });

    return {
      id: session.id,
      paymentStatus: session.payment_status as CheckoutSessionResult['paymentStatus'],
      paymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : (session.payment_intent?.id ?? null),
      amountTotalCents: session.amount_total ?? 0,
      currency: (session.currency ?? 'usd').toUpperCase(),
      metadata: (session.metadata ?? {}) as Record<string, string>,
    };
  }

  async createRefund(input: RefundInput): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: input.paymentIntentId,
        amount: input.amountCents,
        ...(input.reason === 'requested_by_customer'
          ? { reason: 'requested_by_customer' as const }
          : {}),
        metadata: input.reason ? { reason: input.reason } : {},
      },
      {
        stripeAccount: input.connectedAccountId,
        idempotencyKey: input.idempotencyKey,
      },
    );

    return {
      id: refund.id,
      status: refund.status ?? 'pending',
      amountCents: refund.amount,
    };
  }

  verifyWebhook(rawBody: Buffer, signature: string): WebhookEvent {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch (err) {
      // An unverified webhook is an unauthenticated stranger asserting that
      // somebody paid. There is no "probably fine" here.
      throw AppError.unauthorized(
        'Invalid webhook signature.',
        'BAD_SIGNATURE',
      );
    }

    return {
      id: event.id,
      type: event.type,
      accountId: event.account ?? null,
      data: event.data.object as unknown as Record<string, unknown>,
    };
  }
}
