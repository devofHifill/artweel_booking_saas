import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { evaluatePolicy } from '../../src/modules/policies/policy.service';

const app = createApp();
let studio: Studio;
let staffId: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  studio = await signUpStudio(app);

  const staff = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name: 'Rowan Pike', email: 'rowan@clay.test', timezone: 'America/New_York' });
  staffId = staff.body.staff.id;
});

describe('working hours', () => {
  it('creates a recurring rule and previews the real dates it produces', async () => {
    // RRULEs are easy to get subtly wrong and the failure mode is silence,
    // so the studio gets to see actual dates before relying on the pattern.
    const created = await request(app)
      .post(`${studio.base}/schedules/${staffId}/rules`)
      .set(studio.headers)
      .send({
        ruleType: 'WORKING',
        rrule: 'FREQ=WEEKLY;BYDAY=TU,TH',
        startMinute: 9 * 60,
        endMinute: 17 * 60,
        effectiveFrom: '2026-06-01T00:00:00Z',
      });

    expect(created.status).toBe(201);
    // Defaults to the instructor's own zone.
    expect(created.body.rule.timezone).toBe('America/New_York');

    const preview = await request(app)
      .get(
        `${studio.base}/schedules/${staffId}/rules/${created.body.rule.id}/preview?from=2026-06-01&to=2026-06-14`,
      )
      .set(studio.headers);

    expect(preview.status).toBe(200);
    expect(preview.body.occurrences.map((o: { localDate: string }) => o.localDate)).toEqual([
      '2026-06-02',
      '2026-06-04',
      '2026-06-09',
      '2026-06-11',
    ]);
  });

  it('rejects an unreadable repeat pattern', async () => {
    // Storing this would make the instructor silently unbookable forever.
    const res = await request(app)
      .post(`${studio.base}/schedules/${staffId}/rules`)
      .set(studio.headers)
      .send({
        ruleType: 'WORKING',
        rrule: 'EVERY_OTHER_TUESDAY_ISH',
        startMinute: 540,
        endMinute: 1020,
        effectiveFrom: '2026-06-01T00:00:00Z',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RRULE');
  });

  it('rejects a window that ends before it starts', async () => {
    const res = await request(app)
      .post(`${studio.base}/schedules/${staffId}/rules`)
      .set(studio.headers)
      .send({
        rrule: 'FREQ=DAILY',
        startMinute: 1020,
        endMinute: 540,
        effectiveFrom: '2026-06-01T00:00:00Z',
      });

    expect(res.status).toBe(400);
  });

  it('flags daylight-saving anomalies in a preview instead of hiding them', async () => {
    const created = await request(app)
      .post(`${studio.base}/schedules/${staffId}/rules`)
      .set(studio.headers)
      .send({
        rrule: 'FREQ=DAILY',
        startMinute: 2 * 60 + 30, // 02:30 does not exist on 8 March 2026
        endMinute: 4 * 60,
        effectiveFrom: '2026-03-01T00:00:00Z',
      });

    const preview = await request(app)
      .get(
        `${studio.base}/schedules/${staffId}/rules/${created.body.rule.id}/preview?from=2026-03-08&to=2026-03-08`,
      )
      .set(studio.headers);

    expect(preview.body.occurrences[0].resolution).toBe('shifted');
  });
});

describe('time off', () => {
  it('records a day off', async () => {
    const res = await request(app)
      .post(`${studio.base}/schedules/${staffId}/overrides`)
      .set(studio.headers)
      .send({ overrideType: 'DAY_OFF', localDate: '2026-07-04', reason: 'Holiday' });

    expect(res.status).toBe(201);
  });

  it('refuses a day off that would strand an existing booking', async () => {
    // Availability would stop offering the slot while the booking stayed live,
    // so the customer arrives and nobody is there.
    const service = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Private Lesson',
        bookingMode: 'APPOINTMENT',
        durationMinutes: 60,
        capacityMax: 1,
      });

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Student',
        email: 'student@clay.test',
      },
    });

    const { bookAppointment } = await import('../../src/scheduling/booking.service');
    await bookAppointment({
      organizationId: studio.organizationId,
      staffId,
      serviceTypeId: service.body.service.id,
      customerId: customer.id,
      startsAt: new Date('2026-07-04T14:00:00Z'),
      endsAt: new Date('2026-07-04T15:00:00Z'),
      timezone: 'America/New_York',
    });

    const res = await request(app)
      .post(`${studio.base}/schedules/${staffId}/overrides`)
      .set(studio.headers)
      .send({ overrideType: 'DAY_OFF', localDate: '2026-07-04' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DAY_HAS_BOOKINGS');
  });

  it('requires a time window for custom hours and forbids one for a day off', async () => {
    const missingWindow = await request(app)
      .post(`${studio.base}/schedules/${staffId}/overrides`)
      .set(studio.headers)
      .send({ overrideType: 'CUSTOM_HOURS', localDate: '2026-07-05' });
    expect(missingWindow.status).toBe(400);

    const strayWindow = await request(app)
      .post(`${studio.base}/schedules/${staffId}/overrides`)
      .set(studio.headers)
      .send({
        overrideType: 'DAY_OFF',
        localDate: '2026-07-05',
        startMinute: 540,
        endMinute: 1020,
      });
    expect(strayWindow.status).toBe(400);
  });

  it('treats a repeated override as a correction, not an error', async () => {
    const body = {
      overrideType: 'CUSTOM_HOURS' as const,
      localDate: '2026-07-06',
      startMinute: 600,
      endMinute: 900,
    };

    await request(app)
      .post(`${studio.base}/schedules/${staffId}/overrides`)
      .set(studio.headers)
      .send(body);

    const second = await request(app)
      .post(`${studio.base}/schedules/${staffId}/overrides`)
      .set(studio.headers)
      .send({ ...body, endMinute: 1020 });

    expect(second.status).toBe(201);
    expect(second.body.override.endMinute).toBe(1020);

    const all = await request(app)
      .get(`${studio.base}/schedules/${staffId}/overrides`)
      .set(studio.headers);
    expect(all.body.overrides).toHaveLength(1);
  });

  it('refuses to schedule for another studio staff member', async () => {
    const other = await signUpStudio(app);
    const theirStaff = await request(app)
      .post(`${other.base}/staff`)
      .set(other.headers)
      .send({ name: 'Outsider', email: 'outsider@clay.test' });

    const res = await request(app)
      .post(`${studio.base}/schedules/${theirStaff.body.staff.id}/rules`)
      .set(studio.headers)
      .send({
        rrule: 'FREQ=DAILY',
        startMinute: 540,
        endMinute: 1020,
        effectiveFrom: '2026-06-01T00:00:00Z',
      });

    expect(res.status).toBe(404);
  });
});

describe('cancellation policies', () => {
  const standardTiers = [
    { hoursBefore: 48, refundPercent: 100 },
    { hoursBefore: 24, refundPercent: 50, creditPercent: 50 },
    { hoursBefore: 0, refundPercent: 0 },
  ];

  it('creates a policy with a descending tier ladder', async () => {
    const res = await request(app)
      .post(`${studio.base}/cancellation-policies`)
      .set(studio.headers)
      .send({ name: 'Standard', tiers: standardTiers, isDefault: true });

    expect(res.status).toBe(201);
    expect(res.body.policy.isDefault).toBe(true);
  });

  it('rejects an ascending ladder', async () => {
    // The first matching tier wins, so an ascending ladder quietly applies the
    // wrong terms and the studio finds out from an angry customer.
    const res = await request(app)
      .post(`${studio.base}/cancellation-policies`)
      .set(studio.headers)
      .send({
        name: 'Backwards',
        tiers: [
          { hoursBefore: 0, refundPercent: 0 },
          { hoursBefore: 48, refundPercent: 100 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TIERS_OUT_OF_ORDER');
  });

  it('rejects a ladder with no zero-hour tier', async () => {
    const res = await request(app)
      .post(`${studio.base}/cancellation-policies`)
      .set(studio.headers)
      .send({ name: 'Incomplete', tiers: [{ hoursBefore: 24, refundPercent: 50 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FINAL_TIER');
  });

  it('rejects refund plus credit above 100 percent', async () => {
    const res = await request(app)
      .post(`${studio.base}/cancellation-policies`)
      .set(studio.headers)
      .send({
        name: 'Too generous',
        tiers: [{ hoursBefore: 0, refundPercent: 80, creditPercent: 40 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OVER_REFUND');
  });

  it('keeps only one default per studio', async () => {
    await request(app)
      .post(`${studio.base}/cancellation-policies`)
      .set(studio.headers)
      .send({ name: 'Standard', tiers: standardTiers, isDefault: true });

    await request(app)
      .post(`${studio.base}/cancellation-policies`)
      .set(studio.headers)
      .send({ name: 'Workshops', tiers: standardTiers, isDefault: true });

    const defaults = await prisma.cancellationPolicy.count({
      where: { organizationId: studio.organizationId, isDefault: true },
    });
    expect(defaults).toBe(1);
  });

  it('refuses to delete a policy still in use', async () => {
    const policy = await request(app)
      .post(`${studio.base}/cancellation-policies`)
      .set(studio.headers)
      .send({ name: 'Standard', tiers: standardTiers });

    await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Private Lesson',
        bookingMode: 'APPOINTMENT',
        durationMinutes: 60,
        cancellationPolicyId: policy.body.policy.id,
      });

    const res = await request(app)
      .delete(`${studio.base}/cancellation-policies/${policy.body.policy.id}`)
      .set(studio.headers);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POLICY_IN_USE');
  });
});

describe('policy evaluation', () => {
  const tiers = [
    { hoursBefore: 48, refundPercent: 100 },
    { hoursBefore: 24, refundPercent: 50, creditPercent: 50 },
    { hoursBefore: 0, refundPercent: 0 },
  ];

  it('picks the tier matching the notice actually given', () => {
    expect(evaluatePolicy(tiers, 10_000, 72).refundCents).toBe(10_000);
    expect(evaluatePolicy(tiers, 10_000, 30)).toMatchObject({
      refundCents: 5_000,
      creditCents: 5_000,
    });
    expect(evaluatePolicy(tiers, 10_000, 2).refundCents).toBe(0);
  });

  it('treats the boundary as inclusive', () => {
    // Cancelling at exactly 48 hours gets the 48-hour terms, not the next
    // tier down. Off-by-one here is a refund dispute.
    expect(evaluatePolicy(tiers, 10_000, 48).refundCents).toBe(10_000);
    expect(evaluatePolicy(tiers, 10_000, 47.9).refundCents).toBe(5_000);
  });

  it('rounds down so a refund can never exceed what was taken', () => {
    const result = evaluatePolicy(
      [{ hoursBefore: 0, refundPercent: 33 }],
      10_001,
      1,
    );
    expect(result.refundCents).toBe(3_300);
  });
});
