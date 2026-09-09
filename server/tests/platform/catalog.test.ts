import { randomBytes } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createCustomer, createStudio, resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';
import { grantPlatformAdmin } from '../../src/modules/platform/platform.service';

/**
 * The cross-studio support lists.
 *
 * Two properties matter more than the columns: they reach ACROSS studios,
 * which is the whole reason they exist and the thing the tenant-scoped API
 * refuses to do — and they are invisible to anyone without a platform grant,
 * because reaching across studios is exactly the power that must not leak.
 */

const app = createApp();
let admin: Studio;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  admin = await signUpStudio(app, { organizationName: 'Clay & Co' });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: admin.userId },
    select: { email: true },
  });
  await grantPlatformAdmin({ email: user.email });
});

const get = (path: string, query: Record<string, unknown> = {}) =>
  request(app).get(path).query(query).set(admin.headers);

describe('the lists reach across every studio', () => {
  it('returns rows from more than one studio, each naming its own', async () => {
    const a = await createStudio({ name: 'Kiln House' });
    const b = await createStudio({ name: 'Mud & Fire' });

    const res = await get('/api/platform/activities');

    expect(res.status).toBe(200);
    const studios = new Set(
      res.body.rows.map((r: { organization: { name: string } }) => r.organization.name),
    );
    expect(studios.has('Kiln House')).toBe(true);
    expect(studios.has('Mud & Fire')).toBe(true);

    // Every row carries the studio it belongs to — without it a cross-studio
    // list is a pile of rows nobody can act on.
    for (const row of res.body.rows) {
      expect(row.organization.id).toBeTruthy();
    }

    expect(a.organization.id).not.toBe(b.organization.id);
  });

  it('finds a booking by reference and by the customer on it', async () => {
    const studio = await createStudio({ name: 'Kiln House' });
    const customer = await createCustomer(studio.organization.id);
    await prisma.customer.update({
      where: { id: customer.id },
      data: { name: 'Wilhelmina Rooke', email: 'wilhelmina@rooke.test' },
    });

    const booking = await prisma.booking.create({
      data: {
        organizationId: studio.organization.id,
        customerId: customer.id,
        serviceTypeId: studio.serviceType.id,
        staffId: studio.staff.id,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
        timezone: studio.timezone,
        status: 'CONFIRMED',
        cancelToken: randomBytes(16),
      },
      select: { reference: true },
    });

    const byRef = await get('/api/platform/bookings', {
      search: booking.reference,
    });
    expect(byRef.body.total).toBe(1);

    // The question an operator is actually asked is about a person, not a code.
    const byName = await get('/api/platform/bookings', { search: 'Wilhelmina' });
    expect(byName.body.total).toBe(1);
    expect(byName.body.rows[0].customer.email).toBe('wilhelmina@rooke.test');
  });

  it('narrows to one studio when asked', async () => {
    const only = await createStudio({ name: 'Kiln House' });
    await createStudio({ name: 'Mud & Fire' });

    const res = await get('/api/platform/locations', {
      organizationId: only.organization.id,
    });

    expect(res.body.total).toBe(1);
    expect(res.body.rows[0].organization.name).toBe('Kiln House');
  });

  it('matches a resource type by its enum value, not by substring', async () => {
    /* Named so it does NOT contain the search term: search also matches the
       studio name, so a studio called "Kiln House" would legitimately return
       its wheels too and say nothing about the enum path. */
    await createStudio({ name: 'Mud & Fire' });

    /* `resourceType` is an enum, so "kiln" cannot be a LIKE. It is matched as
       an exact value when the term names one, and skipped when it does not —
       a term that is not a type must not silently return everything. */
    const kilns = await get('/api/platform/resources', { search: 'kiln' });
    expect(kilns.body.total).toBeGreaterThan(0);
    for (const row of kilns.body.rows) {
      expect(row.resourceType).toBe('KILN');
    }

    const nonsense = await get('/api/platform/resources', {
      search: 'zzz-not-a-type',
    });
    expect(nonsense.body.total).toBe(0);
  });

  it('pages without losing the total', async () => {
    const studio = await createStudio({ name: 'Kiln House' });
    const customer = await createCustomer(studio.organization.id);

    await prisma.booking.createMany({
      data: Array.from({ length: 5 }, () => ({
        organizationId: studio.organization.id,
        customerId: customer.id,
        serviceTypeId: studio.serviceType.id,
        staffId: studio.staff.id,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
        timezone: studio.timezone,
        status: 'CONFIRMED' as const,
        cancelToken: randomBytes(16),
      })),
    });

    const page = await get('/api/platform/bookings', { limit: 2, offset: 2 });

    expect(page.body.rows).toHaveLength(2);
    // The count is of everything matching, not of the page.
    expect(page.body.total).toBe(5);
    expect(page.body.offset).toBe(2);
  });
});

describe('who can see them', () => {
  it('is invisible to an ordinary studio owner', async () => {
    const outsider = await signUpStudio(app, { organizationName: 'Other Clay' });

    for (const path of [
      'bookings',
      'customers',
      'activities',
      'locations',
      'resources',
      'nav-counts',
    ]) {
      const res = await request(app)
        .get(`/api/platform/${path}`)
        .set(outsider.headers);

      /* 404, not 403: the platform surface does not confirm it exists to
         somebody who is not on it. */
      expect(res.status, path).toBe(404);
    }
  });
});
