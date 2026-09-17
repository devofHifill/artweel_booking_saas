import { randomBytes } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/**
 * B9 — the daily manifest.
 *
 * The sheet an instructor carries. What is tested here is mostly the things
 * the register it replaces could not answer: appointments are on it, balances
 * are on it and agree with the rest of the product, first visits are flagged,
 * and the day is the STUDIO's day rather than UTC's.
 *
 * The send path is tested as far as the outbox and no further. Nothing in this
 * codebase sends from a request, and asserting that a row lands with the right
 * destination and body is asserting the contract the worker consumes.
 */

const app = createApp();
let studio: Studio;
let classServiceId: string;
let apptServiceId: string;
let staffId: string;

/**
 * A fixed studio timezone, and dates chosen to sit either side of UTC
 * midnight in it. `America/New_York` is UTC-4 in September, so 2026-09-19
 * 22:00 local is 2026-09-20 02:00 UTC — a class that UTC would file under
 * the wrong day.
 */
const ZONE = 'America/New_York';

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  studio = await signUpStudio(app, {
    organizationName: 'Clay & Co',
    timezone: ZONE,
  });

  const staff = await request(app)
    .post(`${studio.base}/staff`)
    .set(studio.headers)
    .send({ name: 'Rowan Pike', email: 'rowan@clay.test', timezone: ZONE })
    .expect(201);
  staffId = staff.body.staff.id;

  const klass = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Beginner Wheel Throwing',
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMax: 8,
      priceCents: 9500,
    })
    .expect(201);
  classServiceId = klass.body.service.id;

  const appt = await request(app)
    .post(`${studio.base}/services`)
    .set(studio.headers)
    .send({
      name: 'Private Wheel Lesson',
      bookingMode: 'APPOINTMENT',
      durationMinutes: 60,
      slotGranularityMinutes: 60,
      capacityMax: 1,
      priceCents: 12_000,
    })
    .expect(201);
  apptServiceId = appt.body.service.id;
});

async function makeCustomer(name?: string) {
  return prisma.customer.create({
    data: {
      organizationId: studio.organizationId,
      name: name ?? `Customer ${randomBytes(3).toString('hex')}`,
      email: `c-${randomBytes(6).toString('hex')}@example.test`,
      phone: '+15550001111',
    },
  });
}

async function makeSession(opts: {
  startsAt: Date;
  capacity?: number;
  withStaff?: boolean;
}) {
  return prisma.session.create({
    data: {
      organizationId: studio.organizationId,
      serviceTypeId: classServiceId,
      staffId: opts.withStaff === false ? null : staffId,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 2 * 3_600_000),
      timezone: ZONE,
      localStartTime: '18:00',
      capacity: opts.capacity ?? 8,
      seatsTaken: 0,
    },
  });
}

async function bookInto(opts: {
  sessionId: string;
  startsAt: Date;
  customerId?: string;
  seats?: number;
  totalCents?: number;
  paidCents?: number;
  status?: 'CONFIRMED' | 'ATTENDED' | 'CANCELLED';
}) {
  const customerId = opts.customerId ?? (await makeCustomer()).id;

  const booking = await prisma.booking.create({
    data: {
      organizationId: studio.organizationId,
      customerId,
      serviceTypeId: classServiceId,
      sessionId: opts.sessionId,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 2 * 3_600_000),
      status: opts.status ?? 'CONFIRMED',
      seats: opts.seats ?? 1,
      totalCents: opts.totalCents ?? 9500,
      timezone: ZONE,
      cancelToken: randomBytes(32),
    },
  });

  if (opts.paidCents) {
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        bookingId: booking.id,
        kind: 'FULL',
        amountCents: opts.paidCents,
        status: 'SUCCEEDED',
        succeededAt: new Date(),
      },
    });
  }

  return booking;
}

async function makeAppointment(opts: { startsAt: Date; totalCents?: number }) {
  const customer = await makeCustomer('Jo Mercer');

  return prisma.booking.create({
    data: {
      organizationId: studio.organizationId,
      customerId: customer.id,
      serviceTypeId: apptServiceId,
      staffId,
      sessionId: null,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 3_600_000),
      status: 'CONFIRMED',
      seats: 1,
      totalCents: opts.totalCents ?? 12_000,
      timezone: ZONE,
      cancelToken: randomBytes(32),
    },
  });
}

const get = (date: string, headers = studio.headers) =>
  request(app).get(`${studio.base}/manifest?date=${date}`).set(headers);

describe('the shape of the day', () => {
  it('returns classes and appointments together, in time order', async () => {
    // 14:00 local, then 10:00 local — inserted out of order on purpose.
    const session = await makeSession({
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });
    await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });
    await makeAppointment({ startsAt: new Date('2026-09-19T14:00:00Z') });

    const res = await get('2026-09-19').expect(200);

    expect(res.body.sessions).toHaveLength(2);
    // The private lesson is first because it is earlier, not because of which
    // query returned it.
    expect(res.body.sessions[0].kind).toBe('appointment');
    expect(res.body.sessions[0].serviceName).toBe('Private Wheel Lesson');
    expect(res.body.sessions[1].kind).toBe('class');
  });

  /**
   * The omission that made the register useless to a studio running private
   * lessons: the booking hangs off a staff member rather than a session, so a
   * session-only query showed them an empty day.
   */
  it('shows a day that is only appointments', async () => {
    await makeAppointment({ startsAt: new Date('2026-09-19T14:00:00Z') });

    const res = await get('2026-09-19').expect(200);

    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.totals.appointments).toBe(1);
    expect(res.body.totals.heads).toBe(1);
    // An appointment is its own capacity, so the row shape matches a class.
    expect(res.body.sessions[0].capacity).toBe(1);
    expect(res.body.sessions[0].roll).toHaveLength(1);
  });

  it('leaves cancelled bookings off the roll', async () => {
    const session = await makeSession({
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });
    await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });
    await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
      status: 'CANCELLED',
    });

    const res = await get('2026-09-19').expect(200);

    // Somebody who cancelled in advance is not on the register — putting them
    // there invites an instructor to mark them absent.
    expect(res.body.sessions[0].roll).toHaveLength(1);
    expect(res.body.totals.heads).toBe(1);
  });

  it('marks a class that has not started yet as unmarkable', async () => {
    const future = new Date(Date.now() + 30 * 86_400_000);
    const session = await makeSession({ startsAt: future });
    await bookInto({ sessionId: session.id, startsAt: future });

    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(future);

    const res = await get(date).expect(200);

    expect(res.body.sessions[0].markable).toBe(false);
    // Nothing to mark, because nothing has happened yet.
    expect(res.body.totals.toMark).toBe(0);
  });
});

/**
 * Rule 1 of the analytics module, applied to a sheet somebody carries: money
 * means the same thing everywhere. A manifest quoting a different balance from
 * the payments screen for the same booking is worse than a manifest with no
 * balances on it at all.
 */
describe('balances', () => {
  it('shows what is still owed, net of what has been paid', async () => {
    const session = await makeSession({
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });

    await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
      totalCents: 9500,
      paidCents: 4000,
    });
    await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
      totalCents: 9500,
      paidCents: 9500,
    });

    const res = await get('2026-09-19').expect(200);

    const balances = res.body.sessions[0].roll
      .map((e: { balanceCents: number }) => e.balanceCents)
      .sort((a: number, b: number) => a - b);

    expect(balances).toEqual([0, 5500]);
    expect(res.body.sessions[0].balanceCents).toBe(5500);
    expect(res.body.totals.balanceOwedCents).toBe(5500);
  });

  it('subtracts refunds rather than ignoring them', async () => {
    const session = await makeSession({
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });
    const booking = await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
      totalCents: 9500,
    });

    // Paid in full, then half given back. The customer owes that half again.
    await prisma.payment.create({
      data: {
        organizationId: studio.organizationId,
        bookingId: booking.id,
        kind: 'FULL',
        amountCents: 9500,
        refundedCents: 5000,
        status: 'PARTIALLY_REFUNDED',
        succeededAt: new Date(),
      },
    });

    const res = await get('2026-09-19').expect(200);

    expect(res.body.sessions[0].roll[0].balanceCents).toBe(5000);
  });

  it('never reports a negative balance', async () => {
    const session = await makeSession({
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });
    await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
      totalCents: 9500,
      paidCents: 12_000,
    });

    const res = await get('2026-09-19').expect(200);

    // An overpayment is a refund question, not money to collect at the door.
    expect(res.body.sessions[0].roll[0].balanceCents).toBe(0);
    expect(res.body.totals.balanceOwedCents).toBe(0);
  });
});

describe('first visits', () => {
  it('flags somebody with no earlier booking', async () => {
    const session = await makeSession({
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });
    await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });

    const res = await get('2026-09-19').expect(200);

    expect(res.body.sessions[0].roll[0].firstVisit).toBe(true);
    expect(res.body.totals.firstVisits).toBe(1);
  });

  it('does not flag somebody who came last month', async () => {
    const returning = await makeCustomer('Ada Potter');

    const earlier = await makeSession({
      startsAt: new Date('2026-08-19T18:00:00Z'),
    });
    await bookInto({
      sessionId: earlier.id,
      startsAt: new Date('2026-08-19T18:00:00Z'),
      customerId: returning.id,
      status: 'ATTENDED',
    });

    const session = await makeSession({
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });
    await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
      customerId: returning.id,
    });

    const res = await get('2026-09-19').expect(200);

    expect(res.body.sessions[0].roll[0].firstVisit).toBe(false);
    expect(res.body.totals.firstVisits).toBe(0);
  });

  it('keeps somebody new all day, across two classes', async () => {
    const newcomer = await makeCustomer('Kit Vale');

    const morning = await makeSession({
      startsAt: new Date('2026-09-19T14:00:00Z'),
    });
    const afternoon = await makeSession({
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });

    await bookInto({
      sessionId: morning.id,
      startsAt: new Date('2026-09-19T14:00:00Z'),
      customerId: newcomer.id,
    });
    await bookInto({
      sessionId: afternoon.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
      customerId: newcomer.id,
    });

    const res = await get('2026-09-19').expect(200);

    // Being told they are a returning student four hours later is not useful.
    expect(res.body.sessions[0].roll[0].firstVisit).toBe(true);
    expect(res.body.sessions[1].roll[0].firstVisit).toBe(true);
  });
});

/**
 * The studio's midnight, not UTC's. New York is UTC-4 in September, so a class
 * at 10pm local is already tomorrow by UTC — and would appear on the wrong
 * sheet for every studio west of Greenwich.
 */
describe("the day is the studio's own", () => {
  it('includes a late class that UTC would file under tomorrow', async () => {
    // 22:00 in New York = 02:00 UTC the following day.
    const lateLocal = new Date('2026-09-20T02:00:00Z');
    const session = await makeSession({ startsAt: lateLocal });
    await bookInto({ sessionId: session.id, startsAt: lateLocal });

    const onTheDay = await get('2026-09-19').expect(200);
    expect(onTheDay.body.sessions).toHaveLength(1);

    const theNextDay = await get('2026-09-20').expect(200);
    expect(theNextDay.body.sessions).toHaveLength(0);
  });

  it('refuses a date that is not a date', async () => {
    await get('19-09-2026').expect(422);
    await get('not-a-day').expect(422);
  });
});

describe('tenant scoping', () => {
  it('does not show another studio the day', async () => {
    const stranger = await signUpStudio(app);

    await request(app)
      .get(`${studio.base}/manifest?date=2026-09-19`)
      .set(stranger.headers)
      .expect(404);
  });

  it('does not leak another studio bookings into this sheet', async () => {
    const session = await makeSession({
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });
    await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });

    // A second studio with its own class at the same hour.
    const other = await signUpStudio(app, { timezone: ZONE });
    const otherService = await request(app)
      .post(`${other.base}/services`)
      .set(other.headers)
      .send({
        name: 'Handbuilding',
        bookingMode: 'EVENT',
        durationMinutes: 120,
        capacityMax: 6,
        priceCents: 6000,
      })
      .expect(201);

    await prisma.session.create({
      data: {
        organizationId: other.organizationId,
        serviceTypeId: otherService.body.service.id,
        startsAt: new Date('2026-09-19T18:00:00Z'),
        endsAt: new Date('2026-09-19T20:00:00Z'),
        timezone: ZONE,
        localStartTime: '14:00',
        capacity: 6,
        seatsTaken: 0,
      },
    });

    const res = await get('2026-09-19').expect(200);

    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].serviceName).toBe('Beginner Wheel Throwing');
  });
});

describe('who can read it', () => {
  it('is readable by an instructor — they are the one carrying it', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    await get('2026-09-19', instructor.headers).expect(200);
  });
});

describe('sending it to the instructors', () => {
  it('queues one email per instructor on the rota', async () => {
    const session = await makeSession({
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });
    await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
      totalCents: 9500,
      paidCents: 4000,
    });

    const res = await request(app)
      .post(`${studio.base}/manifest/send`)
      .set(studio.headers)
      .send({ date: '2026-09-19' })
      .expect(200);

    expect(res.body.queued).toBe(1);
    expect(res.body.sentTo).toEqual(['Rowan Pike']);

    const queued = await prisma.notification.findFirstOrThrow({
      where: { organizationId: studio.organizationId, templateKey: 'manifest.daily' },
    });

    // Addressed to the staff member, not to a customer.
    expect(queued.destination).toBe('rowan@clay.test');
    expect(queued.customerId).toBeNull();
    expect(queued.bookingId).toBeNull();
    expect(queued.status).toBe('PENDING');

    const payload = queued.payload as { subject: string; body: string };
    expect(payload.subject).toContain('Clay & Co');
    expect(payload.body).toContain('Beginner Wheel Throwing');
    // The balance is on the sheet, so it is in the email too.
    expect(payload.body).toContain('owes');
  });

  it('says who it went to, so the button can be trusted', async () => {
    const session = await makeSession({
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });
    await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });

    const manifest = await get('2026-09-19').expect(200);

    expect(manifest.body.recipients).toEqual([
      { staffId, name: 'Rowan Pike', sessions: 1 },
    ]);
  });

  /**
   * The accident the dedupe key exists for. An owner double-tapping Send must
   * not mail their staff twice.
   */
  it('does not send twice when the button is double-tapped', async () => {
    const session = await makeSession({
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });
    await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });

    await request(app)
      .post(`${studio.base}/manifest/send`)
      .set(studio.headers)
      .send({ date: '2026-09-19' })
      .expect(200);

    const second = await request(app)
      .post(`${studio.base}/manifest/send`)
      .set(studio.headers)
      .send({ date: '2026-09-19' })
      .expect(200);

    expect(second.body.queued).toBe(0);

    const count = await prisma.notification.count({
      where: { organizationId: studio.organizationId, templateKey: 'manifest.daily' },
    });
    expect(count).toBe(1);
  });

  it('sends nothing when nobody is on the rota', async () => {
    const session = await makeSession({
      startsAt: new Date('2026-09-19T18:00:00Z'),
      withStaff: false,
    });
    await bookInto({
      sessionId: session.id,
      startsAt: new Date('2026-09-19T18:00:00Z'),
    });

    const res = await request(app)
      .post(`${studio.base}/manifest/send`)
      .set(studio.headers)
      .send({ date: '2026-09-19' })
      .expect(200);

    expect(res.body.queued).toBe(0);
    expect(res.body.sentTo).toEqual([]);
  });

  /**
   * Reading the sheet is an instructor's job; mailing the whole rota is not.
   * Same line the product already draws between taking a register and putting
   * a class on the calendar.
   */
  it('refuses an instructor', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    await request(app)
      .post(`${studio.base}/manifest/send`)
      .set(instructor.headers)
      .send({ date: '2026-09-19' })
      .expect(403);
  });
});

/* ------------------------------------------------------------------ D9 ---
   The three things the sheet knew and never said: who to call, where the
   building is, and where a travelling class actually happens.
   ------------------------------------------------------------------------ */

const DAY = '2026-09-19';
const AT = new Date('2026-09-19T18:00:00Z');

describe('reaching the instructor', () => {
  it('puts the instructor phone number on the sheet', async () => {
    await request(app)
      .patch(`${studio.base}/staff/${staffId}`)
      .set(studio.headers)
      .send({ phone: '+15550142' })
      .expect(200);

    const session = await makeSession({ startsAt: AT });
    await bookInto({ sessionId: session.id, startsAt: AT });

    const res = await get(DAY).expect(200);

    expect(res.body.sessions[0].staff).toMatchObject({
      name: 'Rowan Pike',
      phone: '+15550142',
    });
  });

  /** A studio that never recorded one gets null, not an empty string that
      renders as a stray separator on paper. */
  it('reports null when nobody recorded a number', async () => {
    const session = await makeSession({ startsAt: AT });
    await bookInto({ sessionId: session.id, startsAt: AT });

    const res = await get(DAY).expect(200);

    expect(res.body.sessions[0].staff.phone).toBeNull();
  });
});

describe('where a travelling class happens', () => {
  /**
   * The address is taken at booking time and stored on the booking, because a
   * mobile class is one visit to one doorstep — two bookings on the same
   * service are two different houses.
   */
  it('carries the customer address down to the roll entry', async () => {
    const session = await makeSession({ startsAt: AT });
    const booking = await bookInto({ sessionId: session.id, startsAt: AT });

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        serviceAddress: {
          line1: '14 Kiln Lane',
          city: 'Portland',
          postcode: '97205',
          notes: 'Side gate, code 4417',
          lat: 45.52,
          lng: -122.68,
        },
      },
    });

    const res = await get(DAY).expect(200);
    const entry = res.body.sessions[0].roll[0];

    expect(entry.serviceAddress).toBe(
      '14 Kiln Lane, Portland, 97205 — Side gate, code 4417',
    );
  });

  /**
   * Coordinates are how the scheduler works out travel time. They are not how
   * a person finds a door, and a sheet left on a passenger seat should not
   * carry more of somebody's location than the job needs.
   */
  it('leaves the coordinates off the sheet', async () => {
    const session = await makeSession({ startsAt: AT });
    const booking = await bookInto({ sessionId: session.id, startsAt: AT });

    await prisma.booking.update({
      where: { id: booking.id },
      data: { serviceAddress: { line1: '14 Kiln Lane', lat: 45.52, lng: -122.68 } },
    });

    const res = await get(DAY).expect(200);
    const entry = res.body.sessions[0].roll[0];

    expect(entry.serviceAddress).toBe('14 Kiln Lane');
    expect(JSON.stringify(entry)).not.toContain('45.52');
  });

  it('reports nothing for a booking at the studio', async () => {
    const session = await makeSession({ startsAt: AT });
    await bookInto({ sessionId: session.id, startsAt: AT });

    const res = await get(DAY).expect(200);

    expect(res.body.sessions[0].roll[0].serviceAddress).toBeNull();
  });

  /** A private lesson at somebody's home is the commonest mobile booking of
      all, and it takes the appointment path rather than the session one. */
  it('carries it on an appointment too', async () => {
    const booking = await makeAppointment({ startsAt: AT });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { serviceAddress: { line1: '9 Glaze Street', city: 'Portland' } },
    });

    const res = await get(DAY).expect(200);

    expect(res.body.sessions[0].roll[0].serviceAddress).toBe(
      '9 Glaze Street, Portland',
    );
  });

  /** Nothing usable in the stored object means no line, rather than an
      address that reads as a lone comma. */
  it('says nothing when the stored address has no street', async () => {
    const session = await makeSession({ startsAt: AT });
    const booking = await bookInto({ sessionId: session.id, startsAt: AT });

    await prisma.booking.update({
      where: { id: booking.id },
      data: { serviceAddress: { notes: 'Ring twice' } },
    });

    const res = await get(DAY).expect(200);

    expect(res.body.sessions[0].roll[0].serviceAddress).toBeNull();
  });
});
