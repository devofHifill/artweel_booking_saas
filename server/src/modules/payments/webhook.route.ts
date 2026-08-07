import { Router, raw } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { AppError } from '../../lib/app-error';
import { logger } from '../../lib/logger';
import { getPaymentProvider } from './provider.registry';
import { handleWebhook } from './payment.service';

/**
 * Stripe's webhook endpoint.
 *
 * TWO THINGS ARE NON-NEGOTIABLE HERE.
 *
 * 1. RAW BODY. The signature covers the exact bytes Stripe sent. Anything that
 *    has been through JSON.parse and re-serialised will not verify, which is
 *    why this router uses express.raw and is mounted BEFORE express.json in
 *    app.ts. Getting the order wrong produces a signature failure that looks
 *    like a configuration problem and is not.
 *
 * 2. VERIFY BEFORE READING. An unverified webhook is an anonymous stranger
 *    asserting that somebody paid. Nothing is read out of the payload until
 *    the signature checks out.
 */
export const webhookRouter = Router();

webhookRouter.post(
  '/stripe',
  raw({ type: 'application/json', limit: '1mb' }),
  asyncHandler(async (req, res) => {
    const signature = req.headers['stripe-signature'];

    if (typeof signature !== 'string') {
      throw AppError.unauthorized('Missing signature.', 'NO_SIGNATURE');
    }

    const provider = getPaymentProvider();
    const event = provider.verifyWebhook(req.body as Buffer, signature);

    const result = await handleWebhook(event);

    /**
     * Always 200 once processed, including for a duplicate. A non-2xx makes
     * Stripe retry, and retrying a duplicate forever achieves nothing.
     *
     * Genuine processing failures throw, which reaches the error handler as a
     * 500 — and that retry is exactly what we want.
     */
    logger.info(
      { eventId: event.id, type: event.type, handled: result.handled },
      'Stripe webhook',
    );

    res.json({ received: true });
  }),
);
