import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { AppError } from '../../src/lib/app-error';
import { connectError } from '../../src/modules/payments/stripe.provider';

/**
 * Stripe refusing to start Connect onboarding reached the dashboard as a bare
 * "Internal Server Error". The real reason — a platform setting in Stripe —
 * was only in the server log, so nobody looking at the button could act on
 * it. These pin the translation.
 */
describe('a Stripe refusal during Connect onboarding', () => {
  it('reaches the studio with Stripe’s own reason', () => {
    const refused = new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      message: 'Stripe no longer recommends Accounts v1 for new Connect integrations.',
    });

    const err = connectError(refused);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(502);
    expect((err as AppError).code).toBe('STRIPE_CONNECT_REFUSED');
    expect((err as AppError).message).toContain('Accounts v1');
  });

  it('says to try again when Stripe cannot be reached', () => {
    const down = new Stripe.errors.StripeConnectionError({
      type: 'api_error',
      message: 'An error occurred with our connection to Stripe.',
    });

    const err = connectError(down) as AppError;

    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('STRIPE_UNAVAILABLE');
  });

  it('leaves anything that is not a Stripe error alone', () => {
    const bug = new TypeError('cannot read properties of undefined');

    expect(connectError(bug)).toBe(bug);
  });
});
