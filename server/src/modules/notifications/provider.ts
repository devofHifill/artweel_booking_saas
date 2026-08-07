import { logger } from '../../lib/logger';

/**
 * Delivery providers, behind interfaces.
 *
 * Same reasoning as payments: the interesting cases are the failures. A
 * provider that times out, rejects a number as unreachable, or succeeds only
 * on the third attempt cannot be produced on demand from a real API, and
 * those are the paths that decide whether a customer gets their reminder.
 */

export type SendResult = {
  messageId: string;
};

/**
 * Distinguishes "try again" from "never going to work".
 *
 * Retrying a permanent failure burns the budget and delays every message
 * behind it; giving up on a transient one loses a message that would have
 * gone through a second later. Providers must classify.
 */
export class DeliveryError extends Error {
  constructor(
    message: string,
    public readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'DeliveryError';
  }
}

export interface EmailProvider {
  readonly name: string;
  send(input: {
    to: string;
    subject: string;
    text: string;
    replyTo?: string;
    fromName: string;
  }): Promise<SendResult>;
}

export interface SmsProvider {
  readonly name: string;
  send(input: { to: string; body: string }): Promise<SendResult>;
}

/**
 * Development default: writes to the log instead of sending.
 *
 * Deliberately loud. A silent no-op provider makes it far too easy to ship
 * believing notifications work.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  async send(input: { to: string; subject: string; text: string }) {
    logger.info(
      { to: input.to, subject: input.subject },
      `[EMAIL NOT SENT — no provider configured]\n${input.text}`,
    );
    return { messageId: `console_${Date.now()}` };
  }
}

export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';

  async send(input: { to: string; body: string }) {
    logger.info(
      { to: input.to },
      `[SMS NOT SENT — no provider configured] ${input.body}`,
    );
    return { messageId: `console_${Date.now()}` };
  }
}

// ---------------------------------------------------------------------------
// Real adapters
// ---------------------------------------------------------------------------

/**
 * Resend. Chosen over SES for the same reason as everything else here: it can
 * be configured by a studio owner in an afternoon, and deliverability is
 * somebody else's full-time job.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  async send(input: {
    to: string;
    subject: string;
    text: string;
    replyTo?: string;
    fromName: string;
  }): Promise<SendResult> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // The studio's name, our verified domain. Sending as their domain
        // would need per-studio DNS verification, which is a Phase 2 feature.
        from: `${input.fromName} <${this.fromAddress}>`,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // 4xx is our mistake or a dead address; retrying will not fix it.
      // 429 is the exception — that is explicitly "try again later".
      const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
      throw new DeliveryError(
        `Resend ${response.status}: ${body.slice(0, 200)}`,
        permanent,
      );
    }

    const json = (await response.json()) as { id?: string };
    return { messageId: json.id ?? 'unknown' };
  }
}

/**
 * Twilio.
 *
 * US SMS additionally requires an approved A2P 10DLC campaign. Without one,
 * messages are filtered by the carriers rather than rejected by Twilio — they
 * look sent and never arrive, which is the worst possible failure mode. That
 * registration is an external dependency with a multi-week queue and cannot be
 * shortcut in code.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
  ) {}

  async send(input: { to: string; body: string }): Promise<SendResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: input.to,
        From: this.fromNumber,
        Body: input.body,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const permanent =
        response.status >= 400 && response.status < 500 && response.status !== 429;
      throw new DeliveryError(
        `Twilio ${response.status}: ${body.slice(0, 200)}`,
        permanent,
      );
    }

    const json = (await response.json()) as { sid?: string };
    return { messageId: json.sid ?? 'unknown' };
  }
}
