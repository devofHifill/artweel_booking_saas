import { createHmac, randomUUID } from 'node:crypto';
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
 * An in-memory Stripe stand-in, used by tests and by local development when no
 * API key is configured.
 *
 * This is not a shortcut around testing payments — it is what makes the hard
 * cases testable at all. Real Stripe cannot be made to deliver the same
 * webhook twice on demand, or to deliver it before the browser redirect, or to
 * fail a signature check. Those are exactly the paths where money gets lost,
 * so they need to be reproducible.
 *
 * The signature scheme is a real HMAC over the raw body. Verification is
 * genuinely exercised, just against a secret we control.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';

  private accounts = new Map<string, ConnectAccountStatus>();
  private sessions = new Map<string, CheckoutSessionResult & { accountId: string }>();
  private refunds: RefundResult[] = [];
  /** Idempotency keys already seen, so a repeat returns the original result. */
  private issued = new Map<string, CheckoutSession>();

  constructor(private readonly webhookSecret = 'whsec_fake') {}

  async createConnectAccount(input: { email: string; organizationName: string }) {
    const accountId = `acct_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    // A brand new account cannot take money yet. Tests that forget to complete
    // onboarding should hit the same wall a real studio would.
    this.accounts.set(accountId, {
      accountId,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      requirements: ['business_profile.url', 'external_account'],
    });

    return { accountId };
  }

  async createAccountLink(input: { accountId: string; returnUrl: string }) {
    return {
      url: `https://connect.stripe.test/setup/${input.accountId}`,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    };
  }

  async getAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
    const status = this.accounts.get(accountId);
    if (!status) throw AppError.notFound('Connected account not found.');
    return status;
  }

  /** Test hook: pretend the studio finished Stripe onboarding. */
  completeOnboarding(accountId: string) {
    this.accounts.set(accountId, {
      accountId,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      requirements: [],
    });
  }

  async createCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<CheckoutSession> {
    const replayed = this.issued.get(input.idempotencyKey);
    if (replayed) return replayed;

    const id = `cs_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    this.sessions.set(id, {
      id,
      accountId: input.connectedAccountId,
      paymentStatus: 'unpaid',
      paymentIntentId: null,
      amountTotalCents: input.amountCents,
      currency: input.currency,
      metadata: input.metadata,
    });

    const session = {
      id,
      url: `https://checkout.stripe.test/pay/${id}`,
      expiresAt: input.expiresAt,
    };

    this.issued.set(input.idempotencyKey, session);
    return session;
  }

  async retrieveCheckoutSession(
    sessionId: string,
  ): Promise<CheckoutSessionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw AppError.notFound('Checkout session not found.');
    return session;
  }

  /** Test hook: the customer pays. Returns the webhook Stripe would send. */
  payCheckout(sessionId: string): WebhookEvent {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown checkout session ${sessionId}`);

    session.paymentStatus = 'paid';
    session.paymentIntentId = `pi_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    return {
      id: `evt_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      type: 'checkout.session.completed',
      accountId: session.accountId,
      data: {
        id: session.id,
        payment_status: 'paid',
        payment_intent: session.paymentIntentId,
        amount_total: session.amountTotalCents,
        currency: session.currency.toLowerCase(),
        metadata: session.metadata,
      },
    };
  }

  /** Test hook: the session times out unpaid. */
  expireCheckout(sessionId: string): WebhookEvent {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown checkout session ${sessionId}`);

    return {
      id: `evt_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      type: 'checkout.session.expired',
      accountId: session.accountId,
      data: { id: session.id, metadata: session.metadata },
    };
  }

  async createRefund(input: RefundInput): Promise<RefundResult> {
    const refund = {
      id: `re_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      status: 'succeeded',
      amountCents: input.amountCents,
    };
    this.refunds.push(refund);
    return refund;
  }

  get refundsIssued() {
    return [...this.refunds];
  }

  /** Signs a payload the way Stripe would, so tests can post a real webhook. */
  sign(rawBody: Buffer): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');
    return `t=${timestamp},v1=${digest}`;
  }

  verifyWebhook(rawBody: Buffer, signature: string): WebhookEvent {
    const match = /t=(\d+),v1=([0-9a-f]+)/.exec(signature ?? '');
    if (!match) {
      throw AppError.unauthorized('Invalid webhook signature.', 'BAD_SIGNATURE');
    }

    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${match[1]}.${rawBody.toString('utf8')}`)
      .digest('hex');

    if (expected !== match[2]) {
      throw AppError.unauthorized('Invalid webhook signature.', 'BAD_SIGNATURE');
    }

    return JSON.parse(rawBody.toString('utf8')) as WebhookEvent;
  }

  reset() {
    this.accounts.clear();
    this.sessions.clear();
    this.issued.clear();
    this.refunds = [];
  }
}
