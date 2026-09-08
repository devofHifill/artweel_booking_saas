import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { setProviders } from '../../src/modules/notifications/registry';
import type {
  EmailProvider,
  SmsProvider,
} from '../../src/modules/notifications/provider';
import { processBatch } from '../../src/modules/notifications/worker';
import { applyQuietHours } from '../../src/modules/notifications/notification.service';

/**
 * The switches that decide whether a message reaches a customer.
 *
 * These are the settings added on 2026-09-07 — automations on/off, the SMS
 * gate, and the studio's own from-name, reply-to, BCC and footer. Every one
 * of them fails SILENTLY when wrong: nothing errors, a message simply does or
 * does not arrive, and the studio finds out from the customer.
 *
 * All of them are enforced in `processBatch`, which is the single point every
 * message passes through on its way out, so that is what these drive.
 */

const app = createApp();

type SentEmail = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  bcc?: string;
  fromName: string;
  fromAddress?: string;
};

class RecordingEmail implements EmailProvider {
  readonly name = 'recording';
  sent: SentEmail[] = [];

  async send(input: SentEmail) {
    this.sent.push(input);
    return { messageId: `msg_${this.sent.length}` };
  }
}

class RecordingSms implements SmsProvider {
  readonly name = 'recording';
  sent: { to: string; body: string }[] = [];

  async send(input: { to: string; body: string }) {
    this.sent.push(input);
    return { messageId: `sms_${this.sent.length}` };
  }
}

let email: RecordingEmail;
let sms: RecordingSms;
let studio: Studio;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  email = new RecordingEmail();
  sms = new RecordingSms();
  setProviders({ email, sms });

  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
});

/**
 * A message sitting in the outbox, due now.
 *
 * Written directly rather than by taking a booking: these tests are about
 * what the DRAINER does with a row, and going through the booking flow to
 * produce one would make them fail for reasons that have nothing to do with
 * the setting under test.
 */
async function queue(
  overrides: Partial<{
    channel: 'EMAIL' | 'SMS';
    templateKey: string;
    destination: string;
  }> = {},
) {
  return prisma.notification.create({
    data: {
      organizationId: studio.organizationId,
      channel: overrides.channel ?? 'EMAIL',
      templateKey: overrides.templateKey ?? 'booking.confirmed',
      destination: overrides.destination ?? 'ada@example.com',
      payload: {
        subject: 'You are booked in',
        body: 'See you Tuesday.',
        fromName: 'Payload Name',
      },
      scheduledFor: new Date(Date.now() - 1000),
      status: 'PENDING',
      dedupeKey: `test:${Math.random()}`,
    },
  });
}

const setOrg = (data: Record<string, unknown>) =>
  prisma.organization.update({ where: { id: studio.organizationId }, data });

describe('automations on and off', () => {
  it('sends when no rule row exists, because absent means on', async () => {
    await queue();

    const result = await processBatch();

    expect(result.sent).toBe(1);
    expect(email.sent).toHaveLength(1);
  });

  it('marks a switched-off automation SKIPPED instead of sending it', async () => {
    const row = await queue();

    await prisma.notificationRule.create({
      data: {
        organizationId: studio.organizationId,
        templateKey: 'booking.confirmed',
        enabled: false,
      },
    });

    const result = await processBatch();

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(email.sent).toHaveLength(0);

    /*
      SKIPPED and not deleted, with a reason. "Why did my customer not get a
      confirmation" has to be answerable from the delivery log — a message
      that silently never existed cannot be explained to anybody.
    */
    const after = await prisma.notification.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after.status).toBe('SKIPPED');
    expect(after.lastError).toMatch(/switched off/i);
  });

  it('only skips the template that was switched off', async () => {
    await queue({ templateKey: 'booking.confirmed' });
    await queue({ templateKey: 'reminder.24h' });

    await prisma.notificationRule.create({
      data: {
        organizationId: studio.organizationId,
        templateKey: 'booking.confirmed',
        enabled: false,
      },
    });

    const result = await processBatch();

    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(1);
  });

  it('does not skip another studio', async () => {
    const other = await signUpStudio(app, { organizationName: 'Other Clay' });

    await queue();
    await prisma.notification.create({
      data: {
        organizationId: other.organizationId,
        channel: 'EMAIL',
        templateKey: 'booking.confirmed',
        destination: 'someone@else.test',
        payload: { subject: 's', body: 'b' },
        scheduledFor: new Date(Date.now() - 1000),
        status: 'PENDING',
        dedupeKey: `other:${Math.random()}`,
      },
    });

    await prisma.notificationRule.create({
      data: {
        organizationId: studio.organizationId,
        templateKey: 'booking.confirmed',
        enabled: false,
      },
    });

    const result = await processBatch();

    // One studio's switch must not reach into another's outbox.
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(1);
  });
});

describe('the SMS gate', () => {
  it('skips texts when the studio has switched SMS off, and still sends email', async () => {
    await queue({ channel: 'SMS', destination: '+15550100' });
    await queue({ channel: 'EMAIL' });

    await setOrg({ smsEnabled: false });

    const result = await processBatch();

    expect(sms.sent).toHaveLength(0);
    expect(email.sent).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it('sends texts when SMS is on', async () => {
    await queue({ channel: 'SMS', destination: '+15550100' });

    const result = await processBatch();

    expect(result.sent).toBe(1);
    expect(sms.sent).toHaveLength(1);
  });
});

describe('the studio’s email identity', () => {
  it('uses the studio’s from name, reply-to, BCC and footer', async () => {
    await setOrg({
      emailFromName: 'Clay & Co Bookings',
      emailReplyTo: 'hello@clay.test',
      emailBcc: 'archive@clay.test',
      emailFooter: 'Clay & Co · 18 Kiln Street',
    });

    await queue();
    await processBatch();

    const sent = email.sent[0]!;
    expect(sent.fromName).toBe('Clay & Co Bookings');
    expect(sent.replyTo).toBe('hello@clay.test');
    expect(sent.bcc).toBe('archive@clay.test');
    expect(sent.text).toContain('See you Tuesday.');
    expect(sent.text).toContain('Clay & Co · 18 Kiln Street');
  });

  it('falls back to the payload name when the studio has set none', async () => {
    await queue();
    await processBatch();

    expect(email.sent[0]!.fromName).toBe('Payload Name');
    expect(email.sent[0]!.replyTo).toBeUndefined();
    expect(email.sent[0]!.bcc).toBeUndefined();
  });

  it('leaves the body alone when there is no footer', async () => {
    await queue();
    await processBatch();

    expect(email.sent[0]!.text).toBe('See you Tuesday.');
  });

  /**
   * The gate that stops a studio breaking its own mail.
   *
   * Resend refuses a from-address on an unverified domain outright, so
   * supplying one before verification would fail every message rather than
   * falling back — which is why the address is stored but withheld.
   */
  it('withholds an unverified from-address, and uses it once ACTIVE', async () => {
    await setOrg({
      emailFromAddress: 'bookings@clay.test',
      emailDomainStatus: 'NOT_SET',
    });

    await queue();
    await processBatch();
    expect(email.sent[0]!.fromAddress).toBeUndefined();

    await setOrg({ emailDomainStatus: 'PENDING' });
    await queue();
    await processBatch();
    expect(email.sent[1]!.fromAddress).toBeUndefined();

    await setOrg({ emailDomainStatus: 'ACTIVE' });
    await queue();
    await processBatch();
    expect(email.sent[2]!.fromAddress).toBe('bookings@clay.test');
  });
});

/**
 * Quiet hours, and the inversion that makes them dangerous.
 *
 * `config.SMS_QUIET_START_HOUR`/`_END_HOUR` hold the SENDING window despite
 * their names; the settings screen asks for the QUIET window. If the
 * conversion is ever flipped, nothing throws — somebody gets a text at three
 * in the morning.
 */
describe('quiet hours', () => {
  const zone = 'America/New_York';
  const hourIn = (d: Date) =>
    Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hour: 'numeric',
        hour12: false,
      }).format(d),
    );

  it('leaves a time inside the sending window untouched', () => {
    const noon = new Date('2026-09-08T16:00:00Z'); // 12:00 in New York
    const out = applyQuietHours(noon, zone, { fromHour: 21, toHour: 8 });
    expect(out.getTime()).toBe(noon.getTime());
  });

  it('pushes a 3am message to the start of the sending window', () => {
    const threeAm = new Date('2026-09-08T07:00:00Z'); // 03:00 in New York
    const out = applyQuietHours(threeAm, zone, { fromHour: 21, toHour: 8 });

    expect(out.getTime()).toBeGreaterThan(threeAm.getTime());
    expect(hourIn(out)).toBe(8);
  });

  it('honours a studio’s own window rather than the platform default', () => {
    // Quiet 23:00–06:00, so 07:00 is fine here and would be quiet by default.
    const sevenAm = new Date('2026-09-08T11:00:00Z'); // 07:00 in New York
    const out = applyQuietHours(sevenAm, zone, { fromHour: 23, toHour: 6 });
    expect(out.getTime()).toBe(sevenAm.getTime());
  });
});
