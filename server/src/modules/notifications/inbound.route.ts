import { Router, urlencoded } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { asyncHandler } from '../../lib/async-handler';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/app-error';
import { recordSmsOptIn, recordSmsOptOut } from './notification.service';

/**
 * Inbound SMS from Twilio.
 *
 * This endpoint is a legal requirement, not a nicety. Under TCPA a recipient
 * must be able to stop messages by replying with a standard keyword, and
 * continuing to text somebody after they have is per-message statutory
 * damages. Twilio auto-replies to STOP on its own, but only *it* knows the
 * opt-out happened — our database would carry on queueing messages that are
 * silently dropped, which looks like working software and is not.
 */
export const inboundRouter = Router();

/** The keywords carriers and the FCC treat as opt-out. */
const STOP_WORDS = new Set([
  'stop',
  'stopall',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
  'revoke',
  'optout',
]);

const START_WORDS = new Set(['start', 'unstop', 'yes', 'optin']);

/**
 * Verifies Twilio's signature: HMAC-SHA1 over the full URL with the POST
 * parameters appended in sorted key order.
 *
 * Same reasoning as the Stripe webhook — without this, anyone who learns the
 * URL can opt any number in or out.
 */
function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expected = createHmac('sha1', authToken).update(payload, 'utf8').digest('base64');

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);

  return a.length === b.length && timingSafeEqual(a, b);
}

inboundRouter.post(
  '/twilio/sms',
  urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const params = req.body as Record<string, string>;
    const signature = req.headers['x-twilio-signature'];

    if (config.TWILIO_AUTH_TOKEN) {
      const url = `${config.PUBLIC_URL}/webhooks/twilio/sms`;

      if (
        typeof signature !== 'string' ||
        !verifyTwilioSignature(config.TWILIO_AUTH_TOKEN, url, params, signature)
      ) {
        throw AppError.unauthorized('Invalid signature.', 'BAD_SIGNATURE');
      }
    }

    const from = String(params.From ?? '').trim();
    // Carriers strip punctuation and case inconsistently; normalise before
    // matching so "Stop." and "STOP" both register.
    const body = String(params.Body ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, '');

    if (!from) {
      res.type('text/xml').send('<Response></Response>');
      return;
    }

    if (STOP_WORDS.has(body)) {
      const result = await recordSmsOptOut(from);
      logger.info({ optedOut: result.optedOut }, 'Inbound STOP');
    } else if (START_WORDS.has(body)) {
      // An explicit opt-back-in. Only this clears an opt-out — a later tick on
      // a booking form does not.
      const result = await recordSmsOptIn(from);
      logger.info({ optedIn: result.optedIn }, 'Inbound START');
    }

    // Empty TwiML: Twilio sends its own compliance confirmation for STOP and
    // START, so replying here would double-text the customer.
    res.type('text/xml').send('<Response></Response>');
  }),
);
