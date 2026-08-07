/**
 * The payment provider, behind an interface.
 *
 * Two reasons, both practical rather than architectural purity:
 *
 *   1. The test suite must be able to exercise the full checkout and refund
 *      paths — including the awkward ones, like a webhook arriving twice or
 *      before the browser redirect — without a network, an API key, or a
 *      Stripe account. A fake implementation makes those deterministic.
 *
 *   2. Payment logic that knows about Stripe types leaks Stripe into the
 *      booking domain. Keeping the boundary here means the amount, the
 *      currency and the connected account are the only things that cross it.
 *
 * The real adapter stays deliberately thin: it translates, it does not decide.
 * Every decision about how much to charge lives in money.ts.
 */

export type ConnectAccountStatus = {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  /** Anything Stripe still wants before the studio can take money. */
  requirements: string[];
};

export type CheckoutSessionInput = {
  /** The studio's connected account. Money goes here, never to us. */
  connectedAccountId: string;
  amountCents: number;
  currency: string;
  productName: string;
  productDescription?: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Carried through Stripe and returned on the webhook. This is how a payment
   * finds its way back to the hold that reserved the seats.
   */
  metadata: Record<string, string>;
  /**
   * Must expire no later than the seat hold. A session outliving its hold
   * would let somebody pay for seats that had already been released.
   */
  expiresAt: Date;
  idempotencyKey: string;
};

export type CheckoutSession = {
  id: string;
  url: string;
  expiresAt: Date;
};

export type CheckoutSessionResult = {
  id: string;
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
  paymentIntentId: string | null;
  amountTotalCents: number;
  currency: string;
  metadata: Record<string, string>;
};

export type RefundInput = {
  connectedAccountId: string;
  paymentIntentId: string;
  amountCents: number;
  reason?: string;
  idempotencyKey: string;
};

export type RefundResult = {
  id: string;
  status: string;
  amountCents: number;
};

export type WebhookEvent = {
  id: string;
  type: string;
  /** Present for Connect events; identifies the studio the event is about. */
  accountId: string | null;
  data: Record<string, unknown>;
};

export interface PaymentProvider {
  readonly name: string;

  createConnectAccount(input: {
    email: string;
    organizationName: string;
    country: string;
  }): Promise<{ accountId: string }>;

  /** A single-use onboarding URL. Stripe collects the sensitive details, not us. */
  createAccountLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string; expiresAt: Date }>;

  getAccountStatus(accountId: string): Promise<ConnectAccountStatus>;

  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>;

  retrieveCheckoutSession(
    sessionId: string,
    connectedAccountId: string,
  ): Promise<CheckoutSessionResult>;

  createRefund(input: RefundInput): Promise<RefundResult>;

  /**
   * Verifies the signature and returns the parsed event.
   *
   * Takes the RAW body, not a parsed object: the signature covers the exact
   * bytes Stripe sent, so anything that has been through JSON.parse and back
   * will fail to verify. This is why the webhook route is mounted before the
   * JSON body parser.
   *
   * Must throw on an invalid signature. An unverified webhook is an
   * unauthenticated stranger claiming somebody paid.
   */
  verifyWebhook(rawBody: Buffer, signature: string): WebhookEvent;
}
