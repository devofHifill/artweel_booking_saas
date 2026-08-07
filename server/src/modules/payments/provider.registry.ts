import { config } from '../../config';
import { logger } from '../../lib/logger';
import { FakePaymentProvider } from './fake.provider';
import { StripeProvider } from './stripe.provider';
import type { PaymentProvider } from './provider';

/**
 * One provider per process, chosen once at startup.
 *
 * With no Stripe key configured the fake is used, so the app runs offline for
 * development and tests. Production cannot reach this fallback: config.ts
 * refuses to boot without real keys.
 */
let instance: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (instance) return instance;

  if (config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET) {
    instance = new StripeProvider(
      config.STRIPE_SECRET_KEY,
      config.STRIPE_WEBHOOK_SECRET,
    );
  } else {
    if (config.NODE_ENV !== 'test') {
      logger.warn(
        'No Stripe credentials configured — using the fake payment provider. ' +
          'No money will move.',
      );
    }
    instance = new FakePaymentProvider();
  }

  return instance;
}

/** Tests swap in their own instance so they can drive webhooks deterministically. */
export function setPaymentProvider(provider: PaymentProvider) {
  instance = provider;
}
