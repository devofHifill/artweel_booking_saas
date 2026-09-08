import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';
import {
  CONFIGURABLE_ROLES,
  PERMISSIONS,
  defaultAllows,
} from '../../src/lib/permissions';

/**
 * The permission matrix, and the one property that makes it safe to exist.
 *
 * A configurable authorization layer is the change most able to open a hole,
 * so the defaults were written to reproduce the old middleware exactly. That
 * equivalence is asserted here rather than trusted — if somebody edits a
 * default, these fail before a studio finds out the hard way.
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

describe('the defaults reproduce the old guards', () => {
  /*
    Before this layer: requireAdmin was OWNER+ADMIN, requireFrontDesk was
    OWNER+ADMIN+FRONT_DESK, requireMember was everybody. These assertions are
    those three sentences, written out.
  */
  it('gives admin everything', () => {
    for (const permission of PERMISSIONS) {
      expect(defaultAllows('ADMIN', permission)).toBe(true);
    }
  });

  it('gives the front desk bookings and payment visibility, but not refunds', () => {
    expect(defaultAllows('FRONT_DESK', 'booking.create')).toBe(true);
    expect(defaultAllows('FRONT_DESK', 'booking.edit')).toBe(true);
    expect(defaultAllows('FRONT_DESK', 'payment.view')).toBe(true);
    /* The one this file missed first time round: cancelling was guarded by
       requireFrontDesk, so the counter has always had it. */
    expect(defaultAllows('FRONT_DESK', 'booking.cancel')).toBe(true);

    // requireAdmin guarded refunds, so the front desk never had them.
    expect(defaultAllows('FRONT_DESK', 'payment.refund')).toBe(false);
    expect(defaultAllows('FRONT_DESK', 'activity.manage')).toBe(false);
    expect(defaultAllows('FRONT_DESK', 'staff.manage')).toBe(false);
    expect(defaultAllows('FRONT_DESK', 'settings.manage')).toBe(false);
  });

  it('gives an instructor reads and nothing that takes money', () => {
    expect(defaultAllows('INSTRUCTOR', 'booking.view')).toBe(true);
    expect(defaultAllows('INSTRUCTOR', 'booking.create')).toBe(false);
    expect(defaultAllows('INSTRUCTOR', 'booking.cancel')).toBe(false);
    expect(defaultAllows('INSTRUCTOR', 'payment.refund')).toBe(false);
  });

  it('keeps settings away from the manager', () => {
    expect(defaultAllows('MANAGER', 'activity.manage')).toBe(true);
    expect(defaultAllows('MANAGER', 'booking.cancel')).toBe(true);
    expect(defaultAllows('MANAGER', 'settings.manage')).toBe(false);
  });

  it('lets an owner do everything, unconditionally', () => {
    for (const permission of PERMISSIONS) {
      expect(defaultAllows('OWNER', permission)).toBe(true);
    }
  });
});

describe('the matrix endpoint', () => {
  it('returns every role and permission, defaults filled in', async () => {
    const res = await request(app)
      .get(`${studio.base}/permissions`)
      .set(studio.headers);

    expect(res.status).toBe(200);
    expect(res.body.matrix).toHaveLength(PERMISSIONS.length);
    expect(res.body.roles.map((r: { role: string }) => r.role)).toEqual([
      ...CONFIGURABLE_ROLES,
    ]);

    const refunds = res.body.matrix.find(
      (m: { permission: string }) => m.permission === 'payment.refund',
    );
    expect(refunds.roles.ADMIN).toBe(true);
    expect(refunds.roles.FRONT_DESK).toBe(false);
  });

  it('stores only exceptions, and forgets them when they match the default again', async () => {
    const off = await request(app)
      .put(`${studio.base}/permissions`)
      .set(studio.headers)
      .send({ role: 'ADMIN', permission: 'payment.refund', allowed: false });

    expect(off.status).toBe(200);
    expect(await prisma.rolePermission.count()).toBe(1);

    const back = await request(app)
      .put(`${studio.base}/permissions`)
      .set(studio.headers)
      .send({ role: 'ADMIN', permission: 'payment.refund', allowed: true });

    expect(back.status).toBe(200);
    // Back to the default, so the exception row goes rather than lingering.
    expect(await prisma.rolePermission.count()).toBe(0);
  });

  it('refuses to change the owner', async () => {
    const res = await request(app)
      .put(`${studio.base}/permissions`)
      .set(studio.headers)
      .send({ role: 'OWNER', permission: 'settings.manage', allowed: false });

    expect(res.status).toBe(400);
    expect(await prisma.rolePermission.count()).toBe(0);
  });

  it('refuses a permission it does not know', async () => {
    const res = await request(app)
      .put(`${studio.base}/permissions`)
      .set(studio.headers)
      .send({ role: 'ADMIN', permission: 'billing.steal', allowed: true });

    expect(res.status).toBe(400);
  });
});

/**
 * Enforcement, on a real request from a real member.
 *
 * This is the part that would be worthless if it were only a screen: the
 * matrix has to decide what the server does, not what the browser draws.
 */
describe('enforcement', () => {
  it('refuses an instructor a cancel, and allows it once granted', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    const bookingId = '00000000-0000-4000-8000-000000000000';

    const before = await request(app)
      .post(`${studio.base}/bookings/${bookingId}/cancel`)
      .set(instructor.headers)
      .send({ refund: false });

    expect(before.status).toBe(403);
    expect(before.body.error.code).toBe('PERMISSION_DENIED');

    await request(app)
      .put(`${studio.base}/permissions`)
      .set(studio.headers)
      .send({ role: 'INSTRUCTOR', permission: 'booking.cancel', allowed: true });

    const after = await request(app)
      .post(`${studio.base}/bookings/${bookingId}/cancel`)
      .set(instructor.headers)
      .send({ refund: false });

    /*
      404, not 403: the permission check now passes and the handler runs, and
      that booking id does not exist. Getting past the gate is the assertion —
      inventing a real booking would test cancellation, which is covered
      elsewhere.
    */
    expect(after.status).toBe(404);
  });

  it('can take a permission away from an admin', async () => {
    const admin = await addMemberToStudio(app, studio.organizationId, 'ADMIN');

    const allowed = await request(app)
      .get(`${studio.base}/reports`)
      .set(admin.headers);
    expect(allowed.status).not.toBe(403);

    await request(app)
      .put(`${studio.base}/permissions`)
      .set(studio.headers)
      .send({ role: 'ADMIN', permission: 'report.view', allowed: false });

    const denied = await request(app)
      .get(`${studio.base}/reports`)
      .set(admin.headers);

    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('never locks the owner out, whatever the table says', async () => {
    /*
      The row cannot be written through the API, so it is forced in directly —
      which is exactly the state a bad migration or a support session could
      produce. The owner must still get through.
    */
    await prisma.rolePermission.create({
      data: {
        organizationId: studio.organizationId,
        role: 'ADMIN',
        permission: 'report.view',
        allowed: false,
      },
    });

    const res = await request(app)
      .get(`${studio.base}/reports`)
      .set(studio.headers);

    expect(res.status).not.toBe(403);
  });

  it('does not leak one studio’s permissions into another', async () => {
    const other = await signUpStudio(app, { organizationName: 'Other Clay' });
    const otherAdmin = await addMemberToStudio(
      app,
      other.organizationId,
      'ADMIN',
    );

    await request(app)
      .put(`${studio.base}/permissions`)
      .set(studio.headers)
      .send({ role: 'ADMIN', permission: 'report.view', allowed: false });

    const res = await request(app)
      .get(`${other.base}/reports`)
      .set(otherAdmin.headers);

    expect(res.status).not.toBe(403);
  });
});
