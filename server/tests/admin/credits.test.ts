import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';

/**
 * W2.2b — make-up credits.
 *
 * The POLICY here is guesswork and is expected to change once studios have
 * been asked. What is not guesswork, and is what these tests defend, is the
 * integrity around it:
 *
 *   one absence mints at most ONE credit, however many times the register is
 *   saved, and a credit is spent at most ONCE however many requests race for
 *   it.
 *
 * Both are enforced in Postgres. If either of these tests starts failing, the
 * studio is either giving away seats or refusing ones it owes.
 */

const app = createApp();
let studio: Studio;
let serviceId: string;
let seriesId: string;
let weeks: { id: string }[];
let customerId: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  studio = await signUpStudio(app);

  // Credits off by default, so every test that wants them says so.
  await prisma.organization.update({
    where: { id: studio.organizationId },
    data: { makeUpCreditsEnabled: true, makeUpRequiresNotice: false },
  });

  const service = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Six-Week Wheel',
      bookingMode: 'COURSE_SERIES',
      durationMinutes: 120,
      capacityMax: 8,
      priceCents: 0,
    });
  serviceId = service.body.service.id;

  const created = await request(app)
    .post(`${studio.base}/courses`)
    .set(studio.headers)
    .send({
      serviceTypeId: serviceId,
      name: 'Beginner Wheel',
      sessionCount: 3,
      capacity: 8,
      priceCents: 0,
    });
  seriesId = created.body.series.id;

  // Dated in the past so registers can be marked.
  const generated = await request(app)
    .post(`${studio.base}/courses/${seriesId}/sessions`)
    .set(studio.headers)
    .send({
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      startLocalDate: '2026-07-07',
      localStartTime: '19:00',
    });
  weeks = generated.body.sessions;

  const customer = await prisma.customer.create({
    data: {
      organizationId: studio.organizationId,
      name: 'Ana Vidal',
      email: 'ana@student.test',
    },
  });
  customerId = customer.id;

  await request(app)
    .post(`${studio.base}/courses/${seriesId}/enrollments`)
    .set(studio.headers)
    .send({ customerId });
});

async function markAbsent(sessionId: string) {
  const register = await request(app)
    .get(`${studio.base}/sessions/${sessionId}/register`)
    .set(studio.headers);

  return request(app)
    .post(`${studio.base}/sessions/${sessionId}/register`)
    .set(studio.headers)
    .send({
      entries: [
        { bookingId: register.body.entries[0].bookingId, status: 'NO_SHOW' },
      ],
    });
}

describe('issuing credits', () => {
  it('mints a credit when a course student is marked absent', async () => {
    const res = await markAbsent(weeks[0]!.id);

    expect(res.status).toBe(200);
    expect(res.body.creditsIssued).toBe(1);

    const credits = await prisma.classCredit.findMany();
    expect(credits).toHaveLength(1);
    expect(credits[0]!.status).toBe('AVAILABLE');
    expect(credits[0]!.customerId).toBe(customerId);
    expect(credits[0]!.expiresAt).not.toBeNull();
  });

  /** THE GATE. A register saved twice must not pay the student twice. */
  it('does not mint a second credit when the register is saved again', async () => {
    await markAbsent(weeks[0]!.id);
    const second = await markAbsent(weeks[0]!.id);

    expect(second.status).toBe(200);
    expect(second.body.creditsIssued).toBe(0);
    expect(await prisma.classCredit.count()).toBe(1);
  });

  it('mints nothing when the studio has credits switched off', async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { makeUpCreditsEnabled: false },
    });

    const res = await markAbsent(weeks[0]!.id);

    expect(res.status).toBe(200);
    expect(await prisma.classCredit.count()).toBe(0);
  });

  it('mints nothing for a drop-in, who has a refund question instead', async () => {
    const dropInService = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Drop-in',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 8,
        priceCents: 4500,
      });

    const cls = await request(app)
      .post(`${studio.base}/sessions`)
      .set(studio.headers)
      .send({
        serviceTypeId: dropInService.body.service.id,
        startLocalDate: '2026-07-08',
        localStartTime: '10:00',
        capacity: 8,
      });
    const sessionId = cls.body.created[0].id;

    const walkIn = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Ben',
        email: 'ben@student.test',
      },
    });
    const { bookSeats } = await import('../../src/scheduling/booking.service');
    await bookSeats({
      organizationId: studio.organizationId,
      sessionId,
      customerId: walkIn.id,
      seats: 1,
    });

    await markAbsent(sessionId);

    expect(await prisma.classCredit.count()).toBe(0);
  });

  it('honours a notice requirement, refusing a silent no-show', async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { makeUpRequiresNotice: true },
    });

    await markAbsent(weeks[0]!.id);

    // They simply did not appear, so under this policy nothing is owed.
    expect(await prisma.classCredit.count()).toBe(0);
  });
});

describe('spending credits', () => {
  /** A future class to spend a credit on. */
  async function futureClass() {
    const res = await request(app)
      .post(`${studio.base}/sessions`)
      .set(studio.headers)
      .send({
        serviceTypeId: (
          await request(app)
            .post(`${studio.base}/services`)
            .set(studio.headers)
            .send({
              name: 'Make-up Slot',
              bookingMode: 'EVENT',
              durationMinutes: 120,
              capacityMax: 8,
              priceCents: 0,
            })
        ).body.service.id,
        startLocalDate: '2027-05-01',
        localStartTime: '10:00',
        capacity: 8,
      });
    return res.body.created[0].id as string;
  }

  async function aCredit() {
    await markAbsent(weeks[0]!.id);
    return prisma.classCredit.findFirstOrThrow();
  }

  it('books a real seat and marks the credit spent', async () => {
    const credit = await aCredit();
    const sessionId = await futureClass();

    const res = await request(app)
      .post(`${studio.base}/credits/${credit.id}/redeem`)
      .set(studio.headers)
      .send({ sessionId });

    expect(res.status).toBe(201);
    expect(res.body.credit.status).toBe('REDEEMED');
    expect(res.body.booking.source).toBe('make-up-credit');

    // A make-up student takes a real seat, or the class runs over capacity.
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(1);
  });

  /** THE OTHER GATE. One credit, one seat, however many requests race. */
  it('cannot be spent twice by simultaneous requests', async () => {
    const credit = await aCredit();
    const first = await futureClass();
    const second = await futureClass();

    const [a, b] = await Promise.all([
      request(app)
        .post(`${studio.base}/credits/${credit.id}/redeem`)
        .set(studio.headers)
        .send({ sessionId: first }),
      request(app)
        .post(`${studio.base}/credits/${credit.id}/redeem`)
        .set(studio.headers)
        .send({ sessionId: second }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    expect(await prisma.classCredit.count({ where: { status: 'REDEEMED' } })).toBe(1);

    // And the loser's seat was given back, not left booked against nothing.
    const seats = await prisma.session.findMany({
      where: { id: { in: [first, second] } },
      select: { seatsTaken: true },
    });
    expect(seats.map((s) => s.seatsTaken).sort()).toEqual([0, 1]);
  });

  it('refuses an expired credit and keeps the seat', async () => {
    const credit = await aCredit();
    await prisma.classCredit.update({
      where: { id: credit.id },
      data: { expiresAt: new Date('2020-01-01') },
    });
    const sessionId = await futureClass();

    const res = await request(app)
      .post(`${studio.base}/credits/${credit.id}/redeem`)
      .set(studio.headers)
      .send({ sessionId });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CREDIT_EXPIRED');

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.seatsTaken).toBe(0);
  });

  it('refuses a class that has already started', async () => {
    const credit = await aCredit();

    const res = await request(app)
      .post(`${studio.base}/credits/${credit.id}/redeem`)
      .set(studio.headers)
      .send({ sessionId: weeks[1]!.id });

    expect(res.status).toBe(409);
  });

  it('keeps a credit inside its own cohort when the studio says so', async () => {
    await prisma.organization.update({
      where: { id: studio.organizationId },
      data: { makeUpCrossCohort: false },
    });

    const credit = await aCredit();
    const sessionId = await futureClass(); // a different service entirely

    const res = await request(app)
      .post(`${studio.base}/credits/${credit.id}/redeem`)
      .set(studio.headers)
      .send({ sessionId });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CREDIT_WRONG_COHORT');
  });
});

describe('managing credits by hand', () => {
  it('grants one out of thin air', async () => {
    const res = await request(app)
      .post(`${studio.base}/credits`)
      .set(studio.headers)
      .send({ customerId, reason: 'Kiln broke, class abandoned' });

    expect(res.status).toBe(201);
    expect(res.body.credit.status).toBe('AVAILABLE');
    expect(res.body.credit.reason).toBe('Kiln broke, class abandoned');

    /**
     * GRANT, not the column's ABSENCE default. A credit the studio hands over
     * is not a missed class, and once a row is written with the wrong source
     * nothing else records which it really was.
     */
    expect(res.body.credit.source).toBe('GRANT');
  });

  it('separates given credits from missed ones in the balance', async () => {
    await request(app)
      .post(`${studio.base}/credits`)
      .set(studio.headers)
      .send({ customerId, reason: 'Goodwill' });

    const balance = await request(app)
      .get(`${studio.base}/packs/balance/${customerId}`)
      .set(studio.headers);

    expect(balance.status).toBe(200);
    expect(balance.body.bySource.GRANT).toBe(1);
    expect(balance.body.bySource.ABSENCE).toBeUndefined();
  });

  it('withdraws an unused credit', async () => {
    const credit = await request(app)
      .post(`${studio.base}/credits`)
      .set(studio.headers)
      .send({ customerId });

    const withdrawn = await request(app)
      .delete(`${studio.base}/credits/${credit.body.credit.id}`)
      .set(studio.headers);

    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.credit.status).toBe('CANCELLED');
  });

  it('refuses to withdraw one that has already been spent', async () => {
    const granted = await request(app)
      .post(`${studio.base}/credits`)
      .set(studio.headers)
      .send({ customerId });

    // Spend it for real rather than forcing the row, so the state under test
    // is one the system can actually produce.
    const slot = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({
        name: 'Make-up Slot',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 8,
        priceCents: 0,
      });

    const cls = await request(app)
      .post(`${studio.base}/sessions`)
      .set(studio.headers)
      .send({
        serviceTypeId: slot.body.service.id,
        startLocalDate: '2027-05-01',
        localStartTime: '10:00',
        capacity: 8,
      });

    const redeemed = await request(app)
      .post(`${studio.base}/credits/${granted.body.credit.id}/redeem`)
      .set(studio.headers)
      .send({ sessionId: cls.body.created[0].id });
    expect(redeemed.status).toBe(201);

    const res = await request(app)
      .delete(`${studio.base}/credits/${granted.body.credit.id}`)
      .set(studio.headers);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CREDIT_SPENT');
  });

  it('lapses credits past their date', async () => {
    await request(app)
      .post(`${studio.base}/credits`)
      .set(studio.headers)
      .send({ customerId, expiresInDays: 1 });

    const { expireCredits } = await import('../../src/modules/credits/credit.service');
    const result = await expireCredits(new Date(Date.now() + 2 * 86_400_000));

    expect(result.expired).toBe(1);
    const credit = await prisma.classCredit.findFirstOrThrow();
    expect(credit.status).toBe('EXPIRED');
  });

  it('refuses an incoherent redemption at the database level', async () => {
    const credit = await request(app)
      .post(`${studio.base}/credits`)
      .set(studio.headers)
      .send({ customerId });

    // REDEEMED with nothing to show for it must not be storable.
    await expect(
      prisma.$executeRaw`
        UPDATE class_credits
        SET status = 'REDEEMED', redeemed_at = now(), redeemed_booking_id = NULL
        WHERE id = ${credit.body.credit.id}::uuid
      `,
    ).rejects.toThrow();
  });
});
