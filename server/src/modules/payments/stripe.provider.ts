import Stripe from 'stripe';
import { AppError } from '../../lib/app-error';
import { logger } from '../../lib/logger';
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
/**
 * A Stripe refusal during Connect onboarding, as something a studio can read.
 *
 * These used to reach the error handler as unknown errors and come back as a
 * bare "Internal Server Error" — which is how "Stripe no longer allows
 * Accounts v1 for this platform" sat unnoticed behind every Connect button.
 * Stripe's own message is kept: it names the setting to change, and it holds
 * nothing secret. Anything that is not a Stripe error is left alone, so a bug
 * here still surfaces as a bug.
 *
 * Logged here because the error handler does not log operational errors, and
 * a platform misconfiguration is something the operator needs to see.
 */
export function connectError(err: unknown): unknown {
  if (!(err instanceof Stripe.errors.StripeError)) return err;

  const unreachable = accountError(err);
  if (unreachable !== err) return unreachable;

  logger.warn(
    { err, requestId: err.requestId, stripeType: err.type },
    'Stripe refused a Connect onboarding request',
  );

  if (
    err instanceof Stripe.errors.StripeConnectionError ||
    err instanceof Stripe.errors.StripeAPIError ||
    err instanceof Stripe.errors.StripeRateLimitError
  ) {
    return new AppError(
      'Could not reach Stripe to set up payments. Try again in a minute.',
      503,
      'STRIPE_UNAVAILABLE',
    );
  }

  return new AppError(
    `Stripe would not start payment setup: ${err.message}`,
    502,
    'STRIPE_CONNECT_REFUSED',
  );
}

/**
 * A connected account this platform key cannot reach, as a 409 a person can act on.
 *
 * A connected account belongs to the Stripe account that created it. One made
 * under another key — staging's, or a sandbox since replaced — answers every
 * call with `account_invalid`, and that reached the error handler as a bare 500
 * on refresh, checkout and refunds alike. Nothing retried will fix it: the
 * studio has to connect again, which is what the message says.
 *
 * Stripe says it two ways. Reading the account, or acting on it, answers
 * `account_invalid` (a permission error). Minting an onboarding link for it
 * answers `resource_missing` on the `account` param — "No such account" — and
 * that one used to reach the owner as a 502 refusal behind "Finish Stripe
 * setup", on every click. A `resource_missing` on anything else (a checkout
 * session, say) is a different problem and is left alone.
 *
 * Logged without Stripe's message, which echoes part of the secret key.
 */
export function accountError(err: unknown): unknown {
  if (
    !(err instanceof Stripe.errors.StripeError) ||
    !(
      err.code === 'account_invalid' ||
      err instanceof Stripe.errors.StripePermissionError ||
      (err.code === 'resource_missing' && err.param === 'account')
    )
  ) {
    return err;
  }

  logger.warn(
    { requestId: err.requestId, stripeType: err.type, stripeCode: err.code },
    'Connected account is not reachable with this Stripe key',
  );

  return new AppError(
    "This studio's Stripe account can't be reached with the platform's Stripe key. " +
      'It was connected under a different Stripe account, or access was revoked, ' +
      'so the studio needs to connect Stripe again.',
    409,
    'STRIPE_ACCOUNT_UNREACHABLE',
  );
}

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe';
  private readonly stripe: Stripe;

  /**
   * One secret per Stripe event destination, and a Connect integration needs
   * two of them.
   *
   * Stripe scopes a destination to EITHER "your account" OR "connected
   * accounts" — the `connect` boolean — and issues a separate signing secret
   * for each. Our events land on both sides: checkout sessions are created
   * with `stripeAccount` set, so `checkout.session.*` and `account.updated`
   * arrive on the connected-accounts destination, while our own SaaS billing
   * (`customer.subscription.*`, `invoice.payment_*`) arrives on the platform
   * one. A single secret can only ever verify half of that, and the other half
   * fails as a forged signature.
   *
   * So STRIPE_WEBHOOK_SECRET accepts a comma-separated list. One value still
   * works exactly as before.
   */
  private readonly webhookSecrets: string[];

  constructor(secretKey: string, webhookSecret: string) {
    this.webhookSecrets = webhookSecret
      .split(',')
      .map((secret) => secret.trim())
      .filter((secret) => secret.length > 0);

    if (this.webhookSecrets.length === 0) {
      throw new Error(
        'STRIPE_WEBHOOK_SECRET must contain at least one signing secret.',
      );
    }

    this.stripe = new Stripe(secretKey, {
      // Pinned. An unpinned version means Stripe can change response shapes
      // under a running deployment.
      apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
      typescript: true,
      maxNetworkRetries: 2,
      timeout: 20_000,
    });
  }

  /**
   * Created through Accounts v2 (`/v2/core/accounts`), the one place this
   * adapter leaves v1.
   *
   * Stripe now refuses `accounts.create` for new Connect platforms with "Stripe
   * no longer recommends Accounts v1", which surfaced as STRIPE_CONNECT_REFUSED
   * behind every Connect button. A v2 account answers to every v1 endpoint used
   * below — account links, `accounts.retrieve`, direct-charge checkout and
   * refunds — in v1's shape, so nothing else changes.
   *
   * The body is v1's Express account restated: Express dashboard, the platform
   * collecting Stripe's fees and covering losses (what an Express account
   * defaulted to), and the merchant configuration, which carries card payments
   * and payouts. No recipient configuration — that is for transfers, and
   * direct charges never transfer.
   *
   * SDK 17 has no typed v2 Accounts, hence `rawRequest`. The version is pinned
   * here for the same reason the client's is.
   */
  async createConnectAccount(input: {
    email: string;
    organizationName: string;
    country: string;
  }) {
    const account = (await this.stripe
      .rawRequest(
        'POST',
        '/v2/core/accounts',
        {
          contact_email: input.email,
          display_name: input.organizationName,
          dashboard: 'express',
          identity: { country: input.country.toLowerCase() },
          defaults: {
            responsibilities: {
              fees_collector: 'application',
              losses_collector: 'application',
            },
          },
          configuration: {
            merchant: { capabilities: { card_payments: { requested: true } } },
          },
        },
        { apiVersion: '2026-09-30.endive' },
      )
      .catch((err: unknown) => {
        throw connectError(err);
      })) as unknown as { id: string };

    return { accountId: account.id };
  }

  async createAccountLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }) {
    const link = await this.stripe.accountLinks
      .create({
        account: input.accountId,
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
        type: 'account_onboarding',
      })
      .catch((err: unknown) => {
        throw connectError(err);
      });

    return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
  }

  async getAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
    const account = await this.stripe.accounts
      .retrieve(accountId)
      .catch((err: unknown) => {
        throw accountError(err);
      });

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
    ).catch((err: unknown) => {
      throw accountError(err);
    });

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
    const session = await this.stripe.checkout.sessions
      .retrieve(sessionId, { stripeAccount: connectedAccountId })
      .catch((err: unknown) => {
        throw accountError(err);
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
    ).catch((err: unknown) => {
      throw accountError(err);
    });

    return {
      id: refund.id,
      status: refund.status ?? 'pending',
      amountCents: refund.amount,
    };
  }

  verifyWebhook(rawBody: Buffer, signature: string): WebhookEvent {
    let event: Stripe.Event | null = null;

    /**
     * Try each configured secret and accept the first that verifies.
     *
     * This is not a weakening of the check. Every candidate still has to pass
     * Stripe's full HMAC comparison and timestamp tolerance; we are asking
     * "was this signed by ANY destination we registered", which is precisely
     * the question, because we registered more than one.
     */
    for (const secret of this.webhookSecrets) {
      try {
        event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
        break;
      } catch {
        // Try the next one. Failing every secret is handled below.
      }
    }

    if (!event) {
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
