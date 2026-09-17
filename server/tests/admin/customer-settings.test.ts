import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { signUpStudio, type Studio } from '../helpers/api';
import { evaluatePolicy } from '../../src/modules/policies/policy.service';

/**
 * Customer writes, the CSV export, and the no-show branch of the refund ladder.
 *
 * The export test is the one that matters most and looks least important: a
 * cell beginning =, +, - or @ is executed as a FORMULA by Excel and Sheets, so
 * a customer who types one into their own name gets it run on the machine of
 * whoever opens the file.
 */

const app = createApp();
let studio: Studio;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  studio = await signUpStudio(app, { organizationName: 'Clay & Co' });
});

const create = (body: Record<string, unknown>) =>
  request(app).post(`${studio.base}/customers`).set(studio.headers).send(body);

describe('creating and editing a customer', () => {
  it('creates one and lists it', async () => {
    const res = await create({
      name: 'Ada Potter',
      email: 'Ada@Example.com',
      phone: '+1 555 010 2200',
      country: 'United States',
      status: 'VIP',
    });

    expect(res.status).toBe(201);
    // Stored lower-case, so the uniqueness check cannot be dodged by casing.
    expect(res.body.customer.email).toBe('ada@example.com');
    expect(res.body.customer.status).toBe('VIP');

    const list = await request(app)
      .get(`${studio.base}/customers`)
      .set(studio.headers);

    expect(list.body.total).toBe(1);
    expect(list.body.customers[0].name).toBe('Ada Potter');
  });

  it('refuses a second customer with the same email, naming the first', async () => {
    await create({ name: 'Ada Potter', email: 'ada@example.com' });

    const clash = await create({ name: 'Someone Else', email: 'ADA@example.com' });

    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toContain('Ada Potter');
  });

  it('edits one without touching consent', async () => {
    const made = await create({ name: 'Ada Potter', email: 'ada@example.com' });
    const id = made.body.customer.id;

    /* A customer who texted STOP. The form must not be able to undo it. */
    await prisma.customer.update({
      where: { id },
      data: { smsOptedOutAt: new Date() },
    });

    const res = await request(app)
      .patch(`${studio.base}/customers/${id}`)
      .set(studio.headers)
      .send({ name: 'Ada P.', smsOptedOutAt: null, phone: '+1 555 999 0000' });

    expect(res.status).toBe(200);
    expect(res.body.customer.name).toBe('Ada P.');

    const after = await prisma.customer.findUniqueOrThrow({ where: { id } });
    expect(after.smsOptedOutAt).not.toBeNull();
  });

  it('will not reach into another studio', async () => {
    const other = await signUpStudio(app, { organizationName: 'Other Clay' });
    const made = await create({ name: 'Ada Potter', email: 'ada@example.com' });

    const res = await request(app)
      .patch(`${other.base}/customers/${made.body.customer.id}`)
      .set(other.headers)
      .send({ name: 'Stolen' });

    expect(res.status).toBe(404);
  });
});

describe('the CSV export', () => {
  it('neutralises a name that would run as a spreadsheet formula', async () => {
    await create({ name: '=HYPERLINK("http://evil","click")', email: 'a@x.test' });
    await create({ name: '+1 special', email: 'b@x.test' });
    await create({ name: '@handle', email: 'c@x.test' });
    await create({ name: 'Ada Potter', email: 'd@x.test' });

    const res = await request(app)
      .get(`${studio.base}/customers/export.csv`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');

    const body = res.text;

    /* Every risky cell is prefixed with a quote, so the spreadsheet treats it
       as text. The dangerous thing is a cell whose FIRST character is one of
       these, so that is what is asserted. */
    expect(body).toContain(`"'=HYPERLINK`);
    expect(body).toContain(`"'+1 special"`);
    expect(body).toContain(`"'@handle"`);

    // An ordinary name is left exactly as it is.
    expect(body).toContain('"Ada Potter"');
    expect(body).not.toContain(`"'Ada Potter"`);
  });

  it('respects the search filter and ignores pagination', async () => {
    for (let i = 0; i < 30; i++) {
      await create({ name: `Person ${i}`, email: `p${i}@x.test` });
    }
    await create({ name: 'Findable Fern', email: 'fern@x.test' });

    const all = await request(app)
      .get(`${studio.base}/customers/export.csv`)
      .set(studio.headers);

    /* 31 rows plus a header: the export is the whole filtered set, not the
       25 the screen happens to show. */
    expect(all.text.trim().split('\r\n')).toHaveLength(32);

    const filtered = await request(app)
      .get(`${studio.base}/customers/export.csv?search=Fern`)
      .set(studio.headers);

    expect(filtered.text.trim().split('\r\n')).toHaveLength(2);
    expect(filtered.text).toContain('Findable Fern');
  });
});

describe('customer list paging', () => {
  it('pages, and reports the total for the filtered set', async () => {
    for (let i = 0; i < 30; i++) {
      await create({ name: `Person ${String(i).padStart(2, '0')}`, email: `p${i}@x.test` });
    }

    const first = await request(app)
      .get(`${studio.base}/customers?sort=name&page=1&pageSize=25`)
      .set(studio.headers);

    expect(first.body.customers).toHaveLength(25);
    expect(first.body.total).toBe(30);
    expect(first.body.customers[0].name).toBe('Person 00');

    const second = await request(app)
      .get(`${studio.base}/customers?sort=name&page=2&pageSize=25`)
      .set(studio.headers);

    expect(second.body.customers).toHaveLength(5);
    expect(second.body.customers[0].name).toBe('Person 25');

    /*
      The bug this guards. The list used to take the page size from the
      database and THEN sort in memory, so page two was five arbitrary rows
      wearing a sort's label. Sorting must happen across everything before the
      page is cut.
    */
    const names = [
      ...first.body.customers.map((c: { name: string }) => c.name),
      ...second.body.customers.map((c: { name: string }) => c.name),
    ];
    expect(names).toEqual([...names].sort());
  });

  it('counts the filtered set, not the studio', async () => {
    await create({ name: 'Ada Potter', email: 'ada@x.test', status: 'VIP' });
    await create({ name: 'Bo Clay', email: 'bo@x.test' });
    await create({ name: 'Cy Kiln', email: 'cy@x.test' });

    const res = await request(app)
      .get(`${studio.base}/customers?status=VIP`)
      .set(studio.headers);

    expect(res.body.total).toBe(1);
    expect(res.body.totals.customers).toBe(1);
  });
});

/**
 * The no-show branch of the refund ladder.
 *
 * Pure, so it needs no database — and worth asserting precisely, because it is
 * the difference between refunding a guest who never turned up and refusing
 * one who cancelled a minute before.
 */
describe('evaluatePolicy and no-shows', () => {
  const ladder = [
    { hoursBefore: 24, refundPercent: 100 },
    { hoursBefore: 0, refundPercent: 50 },
  ];

  it('uses the ladder when no no-show is given', () => {
    expect(evaluatePolicy(ladder, 10_000, 48).refundCents).toBe(10_000);
    expect(evaluatePolicy(ladder, 10_000, 2).refundCents).toBe(5_000);
  });

  it('charges the no-show fee instead of the ladder', () => {
    // 100% fee: they get nothing, even though the ladder would refund half.
    expect(
      evaluatePolicy(ladder, 10_000, 0, { feePercent: 100 }).refundCents,
    ).toBe(0);

    // 40% fee: they get 60% back.
    expect(
      evaluatePolicy(ladder, 10_000, 0, { feePercent: 40 }).refundCents,
    ).toBe(6_000);
  });

  it('never refunds more than was taken, whatever it is handed', () => {
    expect(
      evaluatePolicy(ladder, 10_000, 0, { feePercent: -50 }).refundCents,
    ).toBe(10_000);
    expect(
      evaluatePolicy(ladder, 10_000, 0, { feePercent: 500 }).refundCents,
    ).toBe(0);
  });

  it('rounds down, so float dust cannot over-refund', () => {
    // 33% fee on 999 leaves 669.33 → 669.
    expect(evaluatePolicy(ladder, 999, 0, { feePercent: 33 }).refundCents).toBe(
      669,
    );
  });
});
