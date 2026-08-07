import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { setProviders } from '../../src/modules/notifications/registry';
import {
  DeliveryError,
  type EmailProvider,
  type SmsProvider,
} from '../../src/modules/notifications/provider';
import {
  processBatch,
  reconcileMissingConfirmations,
} from '../../src/modules/notifications/worker';
import { applyQuietHours } from '../../src/modules/notifications/notification.service';

/**
 * Notifications.
 *
 * The interesting cases are the ones a real provider cannot be asked to
 * produce: a transient failure that succeeds on retry, a permanent rejection
 * that must not be retried, and a customer who replied STOP six months ago.
 */

const app = createApp();

/** Records what would have been sent, and can be told to fail. */
class RecordingEmail implements EmailProvider {
  readonly name = 'recording';
  sent: { to: string; subject: string; text: string }[] = [];
  failWith: DeliveryError | null = null;
  failuresRemaining = 0;

  async send(input: { to: string; subject: string; text: string }) {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw this.failWith ?? new DeliveryError('temporary', false);
    }
    if (this.failWith) throw this.failWith;

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
let slug: string;
let serviceId: string;
let sessionId: string;

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
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: studio.organizationId },
  });
  slug = org.slug;

  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Beginner Wheel Throwing',
      bookingMode: 'EVENT',
      durationMinutes: 180,
      capacityMax: 8,
      priceCents: 9500,
    });
  serviceId = service.body.service.id;

  const { createSession } = await import('../../src/scheduling/session.service');
  // Far enough ahead that both reminders are in the future.
  const created = await createSession({
    organizationId: studio.organizationId,
    serviceTypeId: serviceId,
    startsAt: new Date(Date.now() + 10 * 86_400_000),
    endsAt: new Date(Date.now() + 10 * 86_400_000 + 3 * 3_600_000),
    timezone: 'America/New_York',
    localStartTime: '14:00',
    capacity: 8,
  });
  sessionId = created.id;
});

async function book(overrides: Record<string, unknown> = {}) {
  return request(app)
    .post(`/public/${slug}/bookings`)
    .send({
      serviceTypeId: serviceId,
      sessionId,
      seats: 1,
      customer: { name: 'Ada Potter', email: 'ada@student.test' },
      ...overrides,
    });
}

describe('queueing', () => {
  it('queues a confirmation and both reminders on booking', async () => {
    const res = await book();
    expect(res.status).toBe(201);

    const rows = await prisma.notification.findMany({
      orderBy: { scheduledFor: 'asc' },
    });

    const keys = rows.map((r) => `${r.templateKey}:${r.channel}`);
    expect(keys).toContain('booking.confirmed:EMAIL');
    expect(keys).toContain('reminder.24h:EMAIL');
    expect(keys).toContain('reminder.2h:EMAIL');

    // Reminders are dated forward, not fired by a timer that dies with the
    // process.
    const reminder = rows.find((r) => r.templateKey === 'reminder.24h')!;
    expect(reminder.scheduledFor.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not send anything during the request itself', async () => {
    // A slow email provider must never be able to fail a booking.
    await book();
    expect(email.sent).toHaveLength(0);
  });

  it('skips a reminder whose moment has already passed', async () => {
    const { createSession } = await import('../../src/scheduling/session.service');
    const soon = await createSession({
      organizationId: studio.organizationId,
      serviceTypeId: serviceId,
      startsAt: new Date(Date.now() + 3 * 3_600_000),
      endsAt: new Date(Date.now() + 6 * 3_600_000),
      timezone: 'America/New_York',
      localStartTime: '14:00',
      capacity: 8,
    });

    await book({ sessionId: soon.id });

    const rows = await prisma.notification.findMany();
    const keys = rows.map((r) => r.templateKey);

    // A class three hours away cannot have a "24 hours to go" reminder.
    expect(keys).not.toContain('reminder.24h');
    expect(keys).toContain('reminder.2h');
  });

  it('is idempotent — queueing twice produces one message', async () => {
    const res = await book();
    const bookingId = (await prisma.booking.findFirstOrThrow({})).id;

    const { scheduleBookingNotifications } = await import(
      '../../src/modules/notifications/notification.service'
    );
    await scheduleBookingNotifications(bookingId);
    await scheduleBookingNotifications(bookingId);

    const confirmations = await prisma.notification.count({
      where: { templateKey: 'booking.confirmed', channel: 'EMAIL' },
    });
    expect(confirmations).toBe(1);
    expect(res.status).toBe(201);
  });
});

describe('SMS consent', () => {
  it('records a SKIPPED row with a reason when there is no consent', async () => {
    // "Why didn't my customer get a text?" needs an answer.
    await book({ customer: { name: 'Ada', email: 'ada@student.test', phone: '+15550100' } });

    const row = await prisma.notification.findFirstOrThrow({
      where: { channel: 'SMS', templateKey: 'booking.confirmed' },
    });

    expect(row.status).toBe('SKIPPED');
    expect((row.payload as { skipped?: string }).skipped).toBe('NO_CONSENT');
  });

  it('queues SMS when consent was given', async () => {
    await book({
      customer: { name: 'Ada', email: 'ada@student.test', phone: '+15550100' },
      smsConsent: true,
    });

    const row = await prisma.notification.findFirstOrThrow({
      where: { channel: 'SMS', templateKey: 'booking.confirmed' },
    });
    expect(row.status).toBe('PENDING');
    expect(row.destination).toBe('+15550100');
  });

  it('skips SMS with no number even when consent was ticked', async () => {
    await book({
      customer: { name: 'Ada', email: 'ada@student.test' },
      smsConsent: true,
    });

    const row = await prisma.notification.findFirstOrThrow({
      where: { channel: 'SMS' },
    });
    expect((row.payload as { skipped?: string }).skipped).toBe('NO_DESTINATION');
  });

  it('lets an opt-out beat a later consent tick', async () => {
    // Under TCPA, someone who replied STOP has not resubscribed by ticking a
    // box on a booking form. Getting this wrong is per-message damages.
    await book({
      customer: { name: 'Ada', email: 'ada@student.test', phone: '+15550100' },
      smsConsent: true,
    });

    const { recordSmsOptOut } = await import(
      '../../src/modules/notifications/notification.service'
    );
    await recordSmsOptOut('+15550100');

    await book({
      customer: { name: 'Ada', email: 'ada@student.test', phone: '+15550100' },
      smsConsent: true,
      seats: 1,
    });

    const customer = await prisma.customer.findFirstOrThrow({});
    expect(customer.smsOptedOutAt).not.toBeNull();

    // And nothing already queued goes out either.
    const pending = await prisma.notification.count({
      where: { channel: 'SMS', status: 'PENDING' },
    });
    expect(pending).toBe(0);
  });
});

describe('the inbound STOP webhook', () => {
  it('opts the number out and cancels queued messages', async () => {
    await book({
      customer: { name: 'Ada', email: 'ada@student.test', phone: '+15550100' },
      smsConsent: true,
    });

    const res = await request(app)
      .post('/webhooks/twilio/sms')
      .type('form')
      .send({ From: '+15550100', Body: 'STOP' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('<Response>');

    const customer = await prisma.customer.findFirstOrThrow({});
    expect(customer.smsOptedOutAt).not.toBeNull();

    const cancelled = await prisma.notification.count({
      where: { channel: 'SMS', status: 'CANCELLED' },
    });
    expect(cancelled).toBeGreaterThan(0);
  });

  it('recognises the keyword regardless of case or punctuation', async () => {
    // Carriers normalise inconsistently; "Stop." must register.
    await book({
      customer: { name: 'Ada', email: 'ada@student.test', phone: '+15550100' },
      smsConsent: true,
    });

    await request(app)
      .post('/webhooks/twilio/sms')
      .type('form')
      .send({ From: '+15550100', Body: '  Stop. ' });

    const customer = await prisma.customer.findFirstOrThrow({});
    expect(customer.smsOptedOutAt).not.toBeNull();
  });

  it('allows an explicit opt back in', async () => {
    await book({
      customer: { name: 'Ada', email: 'ada@student.test', phone: '+15550100' },
      smsConsent: true,
    });

    await request(app)
      .post('/webhooks/twilio/sms')
      .type('form')
      .send({ From: '+15550100', Body: 'STOP' });

    await request(app)
      .post('/webhooks/twilio/sms')
      .type('form')
      .send({ From: '+15550100', Body: 'START' });

    const customer = await prisma.customer.findFirstOrThrow({});
    expect(customer.smsOptedOutAt).toBeNull();
    expect(customer.smsConsentAt).not.toBeNull();
  });

  it('ignores an ordinary reply', async () => {
    await book({
      customer: { name: 'Ada', email: 'ada@student.test', phone: '+15550100' },
      smsConsent: true,
    });

    await request(app)
      .post('/webhooks/twilio/sms')
      .type('form')
      .send({ From: '+15550100', Body: 'see you saturday!' });

    const customer = await prisma.customer.findFirstOrThrow({});
    expect(customer.smsOptedOutAt).toBeNull();
  });
});

describe('quiet hours', () => {
  const TZ = 'America/New_York';

  it('leaves a daytime send alone', () => {
    // 2pm EDT.
    const noon = new Date('2026-06-15T18:00:00Z');
    expect(applyQuietHours(noon, TZ).getTime()).toBe(noon.getTime());
  });

  it('defers an overnight send to the morning', () => {
    // 3am EDT — legal to send at 8am, not at 3am.
    const middleOfNight = new Date('2026-06-15T07:00:00Z');
    const moved = applyQuietHours(middleOfNight, TZ);

    expect(moved.getTime()).toBeGreaterThan(middleOfNight.getTime());
    expect(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone: TZ }).format(moved),
    ).toBe('8 AM');
  });

  it('pushes a late-evening send to the next morning', () => {
    // 10:30pm EDT.
    const late = new Date('2026-06-16T02:30:00Z');
    const moved = applyQuietHours(late, TZ);

    expect(moved.getTime()).toBeGreaterThan(late.getTime());
    expect(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone: TZ }).format(moved),
    ).toBe('8 AM');
  });
});

describe('the worker', () => {
  it('sends what is due and leaves what is not', async () => {
    await book();

    const result = await processBatch();

    // Confirmation only; the reminders are days away.
    expect(result.sent).toBe(1);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe('ada@student.test');
    expect(email.sent[0]!.subject).toContain('Beginner Wheel Throwing');
    expect(email.sent[0]!.text).toContain('Ada Potter');
    // The manage link must survive templating.
    expect(email.sent[0]!.text).toContain('/manage');

    const row = await prisma.notification.findFirstOrThrow({
      where: { templateKey: 'booking.confirmed', channel: 'EMAIL' },
    });
    expect(row.status).toBe('SENT');
    expect(row.sentAt).not.toBeNull();
  });

  it('retries a transient failure and succeeds', async () => {
    await book();

    email.failWith = new DeliveryError('provider hiccup', false);
    email.failuresRemaining = 1;

    const first = await processBatch();
    expect(first.retrying).toBe(1);
    expect(first.sent).toBe(0);

    let row = await prisma.notification.findFirstOrThrow({
      where: { templateKey: 'booking.confirmed', channel: 'EMAIL' },
    });
    expect(row.status).toBe('PENDING');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('hiccup');

    // Backoff pushed it forward; bring it back so the retry is testable
    // without waiting a minute.
    email.failWith = null;
    await prisma.notification.update({
      where: { id: row.id },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });

    const second = await processBatch();
    expect(second.sent).toBe(1);

    row = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(row.status).toBe('SENT');
  });

  it('gives up immediately on a permanent failure', async () => {
    // A malformed address will never succeed. Retrying it five more times
    // delays every message behind it for nothing.
    await book();

    email.failWith = new DeliveryError('invalid recipient', true);

    const result = await processBatch();
    expect(result.failed).toBe(1);
    expect(result.retrying).toBe(0);

    const row = await prisma.notification.findFirstOrThrow({
      where: { templateKey: 'booking.confirmed', channel: 'EMAIL' },
    });
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(1);
  });

  it('does not hand the same message to two workers', async () => {
    // The lease claim uses FOR UPDATE SKIP LOCKED, so concurrent drains
    // partition the queue rather than duplicating it.
    await book();

    const [a, b, c] = await Promise.all([
      processBatch(),
      processBatch(),
      processBatch(),
    ]);

    expect(a.claimed + b.claimed + c.claimed).toBe(1);
    expect(email.sent).toHaveLength(1);
  });

  it('leaves a claimed message recoverable if the worker dies', async () => {
    // The claim is a lease, not a status flag: nothing gets stuck forever.
    await book();

    const { claimBatch } = await import('../../src/modules/notifications/worker');
    const claimed = await claimBatch(10);
    expect(claimed).toHaveLength(1);

    // Simulate the process dying here — no completion is written.
    expect(await processBatch()).toMatchObject({ claimed: 0 });

    await prisma.notification.update({
      where: { id: claimed[0]!.id },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });

    const recovered = await processBatch();
    expect(recovered.sent).toBe(1);
  });

  it('sends SMS through the SMS provider, not email', async () => {
    await book({
      customer: { name: 'Ada', email: 'ada@student.test', phone: '+15550100' },
      smsConsent: true,
    });

    await processBatch();

    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]!.to).toBe('+15550100');
    expect(sms.sent[0]!.body).toContain('Clay & Co');
    // Every marketing-adjacent SMS must carry an opt-out instruction.
    expect(sms.sent[0]!.body).toContain('STOP');
  });
});

describe('cancellation', () => {
  it('cancels pending reminders and queues a cancellation notice', async () => {
    const booked = await book();
    const token = booked.body.manageToken;

    await processBatch(); // clear the confirmation

    await request(app).post(`/public/bookings/${token}/cancel`);

    // A reminder for a booking that no longer exists is worse than useless.
    // (Rows already SKIPPED — no consent, no number — stay SKIPPED: their
    // reason is history worth keeping, not something to overwrite.)
    const stillPending = await prisma.notification.count({
      where: { templateKey: { startsWith: 'reminder' }, status: 'PENDING' },
    });
    expect(stillPending).toBe(0);

    const cancelled = await prisma.notification.count({
      where: { templateKey: { startsWith: 'reminder' }, status: 'CANCELLED' },
    });
    expect(cancelled).toBeGreaterThan(0);

    const notice = await prisma.notification.findFirst({
      where: { templateKey: 'booking.cancelled', channel: 'EMAIL' },
    });
    expect(notice).not.toBeNull();
    expect(notice!.status).toBe('PENDING');
  });
});

describe('reconciliation', () => {
  it('queues a confirmation for a booking that never got one', async () => {
    // The outbox row is written just after the booking commits, not inside
    // the same transaction. A crash in that window would otherwise leave a
    // confirmed booking silently unconfirmed.
    await book();
    await prisma.notification.deleteMany({});

    // Backdate past the grace period.
    await prisma.booking.updateMany({
      data: { createdAt: new Date(Date.now() - 10 * 60_000) },
    });

    const result = await reconcileMissingConfirmations();
    expect(result.reconciled).toBe(1);

    const rows = await prisma.notification.count();
    expect(rows).toBeGreaterThan(0);
  });

  it('leaves a fresh booking alone', async () => {
    // Never race the normal path.
    await book();
    await prisma.notification.deleteMany({});

    const result = await reconcileMissingConfirmations();
    expect(result.reconciled).toBe(0);
  });
});

describe('studio templates', () => {
  it('uses studio wording in place of the default', async () => {
    await request(app)
      .put(`${studio.base}/notifications/templates`)
      .set(studio.headers)
      .send({
        templateKey: 'booking.confirmed',
        channel: 'EMAIL',
        subject: 'Wheel time, {{customerName}}!',
        body: 'See you {{dateLong}} at {{time}}. — {{studioName}}',
      });

    const booked = await book();
    expect(booked.status).toBe(201);

    const queued = await prisma.notification.findMany({
      where: { channel: 'EMAIL' },
    });
    expect(queued).toHaveLength(3);

    const result = await processBatch();
    expect(result.sent).toBe(1);

    expect(email.sent[0]!.subject).toBe('Wheel time, Ada Potter!');
    expect(email.sent[0]!.text).toContain('Clay & Co');
  });

  it('collapses an unknown token instead of showing it to a customer', async () => {
    const res = await request(app)
      .post(`${studio.base}/notifications/templates/preview`)
      .set(studio.headers)
      .send({ body: 'Hello {{customerName}}, your {{nonsenseToken}} awaits.' });

    expect(res.body.body).toBe('Hello Ada Potter, your  awaits.');
    expect(res.body.availableTokens).toContain('manageUrl');
  });

  it('refuses a template the system never sends', async () => {
    const res = await request(app)
      .put(`${studio.base}/notifications/templates`)
      .set(studio.headers)
      .send({
        templateKey: 'invented.key',
        channel: 'EMAIL',
        subject: 'x',
        body: 'y',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_TEMPLATE');
  });

  it('keeps one studio templates out of another', async () => {
    const other = await signUpStudio(app);

    await request(app)
      .put(`${other.base}/notifications/templates`)
      .set(other.headers)
      .send({
        templateKey: 'booking.confirmed',
        channel: 'EMAIL',
        subject: 'OTHER STUDIO',
        body: 'other',
      });

    await book();
    await processBatch();

    expect(email.sent[0]!.subject).not.toBe('OTHER STUDIO');
  });
});
