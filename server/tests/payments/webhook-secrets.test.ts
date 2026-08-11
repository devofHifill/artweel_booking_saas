import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { StripeProvider } from '../../src/modules/payments/stripe.provider';

/**
 * Multi-destination webhook verification.
 *
 * A Connect integration cannot be served by one signing secret. Stripe scopes
 * every event destination to EITHER the platform account OR connected
 * accounts, and issues a separate secret for each. Our events land on both
 * sides: checkout sessions are created with `stripeAccount` set, so
 * `checkout.session.*` and `account.updated` arrive on the connected-accounts
 * destination, while our own SaaS billing arrives on the platform one.
 *
 * With a single secret, half of those deliveries fail as forged signatures —
 * and the failure is silent from the studio's point of view. Their plan simply
 * stops reflecting reality.
 *
 * These tests need no network: constructEvent is an HMAC comparison, and
 * generateTestHeaderString is how Stripe's own SDK signs a fixture.
 */

const PLATFORM_SECRET = 'whsec_platform_destination_secret';
const CONNECT_SECRET = 'whsec_connected_accounts_destination_secret';

const signer = new Stripe('sk_test_unused_for_signing', {
  apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
});

function sign(secret: string, event: Record<string, unknown>) {
  const payload = JSON.stringify(event);

  return {
    body: Buffer.from(payload),
    signature: signer.webhooks.generateTestHeaderString({ payload, secret }),
  };
}

const platformEvent = {
  id: 'evt_platform',
  object: 'event',
  type: 'invoice.payment_succeeded',
  // Platform events carry no account. This is what the service uses to tell
  // our own billing apart from a studio's takings.
  account: null,
  data: { object: { id: 'in_123' } },
};

const connectEvent = {
  id: 'evt_connect',
  object: 'event',
  type: 'checkout.session.completed',
  account: 'acct_studio_123',
  data: { object: { id: 'cs_123' } },
};

describe('StripeProvider webhook signature verification', () => {
  it('accepts an event signed by either configured destination', () => {
    const provider = new StripeProvider(
      'sk_test_x',
      `${PLATFORM_SECRET},${CONNECT_SECRET}`,
    );

    const platform = sign(PLATFORM_SECRET, platformEvent);
    const connect = sign(CONNECT_SECRET, connectEvent);

    expect(
      provider.verifyWebhook(platform.body, platform.signature).id,
    ).toBe('evt_platform');

    const verifiedConnect = provider.verifyWebhook(
      connect.body,
      connect.signature,
    );
    expect(verifiedConnect.id).toBe('evt_connect');
    // The connected account has to survive verification — refunds and seat
    // releases are issued against that account, not the platform.
    expect(verifiedConnect.accountId).toBe('acct_studio_123');
  });

  it('still works with a single secret, unchanged', () => {
    const provider = new StripeProvider('sk_test_x', PLATFORM_SECRET);
    const platform = sign(PLATFORM_SECRET, platformEvent);

    expect(provider.verifyWebhook(platform.body, platform.signature).id).toBe(
      'evt_platform',
    );
  });

  it('tolerates whitespace around a comma-separated pair', () => {
    const provider = new StripeProvider(
      'sk_test_x',
      ` ${PLATFORM_SECRET} , ${CONNECT_SECRET} `,
    );
    const connect = sign(CONNECT_SECRET, connectEvent);

    expect(provider.verifyWebhook(connect.body, connect.signature).id).toBe(
      'evt_connect',
    );
  });

  it('rejects a signature from a secret that is not configured', () => {
    const provider = new StripeProvider(
      'sk_test_x',
      `${PLATFORM_SECRET},${CONNECT_SECRET}`,
    );
    const forged = sign('whsec_not_ours', connectEvent);

    expect(() => provider.verifyWebhook(forged.body, forged.signature)).toThrow(
      /signature/i,
    );
  });

  it('rejects a tampered body even when the signature is otherwise valid', () => {
    const provider = new StripeProvider('sk_test_x', CONNECT_SECRET);
    const connect = sign(CONNECT_SECRET, connectEvent);

    const tampered = Buffer.from(
      JSON.stringify({ ...connectEvent, data: { object: { id: 'cs_other' } } }),
    );

    expect(() => provider.verifyWebhook(tampered, connect.signature)).toThrow(
      /signature/i,
    );
  });

  it('refuses to construct with no usable secret', () => {
    expect(() => new StripeProvider('sk_test_x', '   ,  ')).toThrow(
      /at least one signing secret/i,
    );
  });
});
