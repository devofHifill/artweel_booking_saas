import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';

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
  studio = await signUpStudio(app);
});

const wheelClass = {
  name: 'Beginner Wheel Throwing',
  bookingMode: 'EVENT',
  durationMinutes: 180,
  slotGranularityMinutes: 30,
  capacityMin: 1,
  capacityMax: 8,
  priceCents: 9500,
};

describe('service types', () => {
  it('creates a service and derives a URL slug from the name', async () => {
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(wheelClass);

    expect(res.status).toBe(201);
    expect(res.body.service.slug).toBe('beginner-wheel-throwing');
    expect(res.body.service.organizationId).toBe(studio.organizationId);
  });

  it('gives a second service of the same name a distinct slug', async () => {
    await request(app).post(`${studio.base}/services`).set(studio.headers).send(wheelClass);
    const second = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(wheelClass);

    expect(second.status).toBe(201);
    expect(second.body.service.slug).toBe('beginner-wheel-throwing-2');
  });

  it('lets two studios use the same slug', async () => {
    // Slugs are scoped per studio. Global uniqueness would mean the second
    // pottery studio in the world cannot name its beginner class properly.
    const other = await signUpStudio(app);

    const a = await request(app).post(`${studio.base}/services`).set(studio.headers).send(wheelClass);
    const b = await request(app).post(`${other.base}/services`).set(other.headers).send(wheelClass);

    expect(a.body.service.slug).toBe('beginner-wheel-throwing');
    expect(b.body.service.slug).toBe('beginner-wheel-throwing');
  });

  it('refuses an appointment with capacity above one', async () => {
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({ ...wheelClass, bookingMode: 'APPOINTMENT', capacityMax: 8 });

    expect(res.status).toBe(422);
  });

  it('refuses a minimum capacity above the maximum', async () => {
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({ ...wheelClass, capacityMin: 10, capacityMax: 8 });

    expect(res.status).toBe(422);
  });

  it('refuses a percentage deposit above 100', async () => {
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({ ...wheelClass, depositType: 'percent', depositValue: 150 });

    expect(res.status).toBe(422);
  });

  it('refuses a category belonging to another studio', async () => {
    // The quiet cross-tenant hole: the row is created under the right tenant,
    // but points at somebody else's data.
    const other = await signUpStudio(app);
    const theirCategory = await request(app)
      .post(`${other.base}/services/categories`)
      .set(other.headers)
      .send({ name: 'Wheel Work' });

    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({ ...wheelClass, categoryId: theirCategory.body.category.id });

    expect(res.status).toBe(400);
  });

  it('refuses a service as its own prerequisite', async () => {
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(wheelClass);

    const res = await request(app)
      .patch(`${studio.base}/services/${created.body.service.id}`)
      .set(studio.headers)
      .send({ prerequisiteServiceTypeId: created.body.service.id });

    expect(res.status).toBe(400);
  });

  it('hides inactive services unless asked for them', async () => {
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(wheelClass);

    await request(app)
      .patch(`${studio.base}/services/${created.body.service.id}`)
      .set(studio.headers)
      .send({ isActive: false });

    const visible = await request(app).get(`${studio.base}/services`).set(studio.headers);
    expect(visible.body.services).toHaveLength(0);

    const all = await request(app)
      .get(`${studio.base}/services?includeInactive=true`)
      .set(studio.headers);
    expect(all.body.services).toHaveLength(1);
  });
});

describe('capacity changes', () => {
  it('refuses to shrink a class below the seats already sold', async () => {
    // Otherwise seats_taken exceeds capacity and the CHECK constraint fires
    // later, during some unrelated write, with an error nobody can explain.
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(wheelClass);
    const serviceId = created.body.service.id;

    const { createSession } = await import('../../src/scheduling/session.service');
    const { bookSeats } = await import('../../src/scheduling/booking.service');

    // UPCOMING, and computed rather than written down. The guard only looks at
    // sessions still ahead of now — `startsAt: { gte: new Date() }` — so a
    // fixed date here quietly stops testing anything the day it passes: the
    // query finds nothing, the shrink is allowed, and the 409 never comes.
    const startsAt = new Date(Date.now() + 30 * 86_400_000);

    const session = await createSession({
      organizationId: studio.organizationId,
      serviceTypeId: serviceId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
      timezone: 'America/New_York',
      localStartTime: '14:00',
      capacity: 8,
    });

    const customer = await prisma.customer.create({
      data: {
        organizationId: studio.organizationId,
        name: 'Student',
        email: 'student@clay.test',
      },
    });

    await bookSeats({
      organizationId: studio.organizationId,
      sessionId: session.id,
      customerId: customer.id,
      seats: 7,
    });

    const res = await request(app)
      .patch(`${studio.base}/services/${serviceId}`)
      .set(studio.headers)
      .send({ capacityMax: 6 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CAPACITY_BELOW_BOOKED');

    // Reducing to exactly what is sold is fine.
    expect(
      (
        await request(app)
          .patch(`${studio.base}/services/${serviceId}`)
          .set(studio.headers)
          .send({ capacityMax: 7 })
      ).status,
    ).toBe(200);
  });
});

describe('deletion protection', () => {
  it('deletes a service that has no history', async () => {
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(wheelClass);

    const res = await request(app)
      .delete(`${studio.base}/services/${created.body.service.id}`)
      .set(studio.headers);

    expect(res.status).toBe(204);
  });

  it('refuses to delete a service with bookings and suggests deactivating', async () => {
    // A booking is part of the studio's financial record. Deleting the service
    // it came from would orphan a customer's receipt.
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(wheelClass);

    const { createSession } = await import('../../src/scheduling/session.service');
    await createSession({
      organizationId: studio.organizationId,
      serviceTypeId: created.body.service.id,
      startsAt: new Date('2026-09-15T18:00:00Z'),
      endsAt: new Date('2026-09-15T21:00:00Z'),
      timezone: 'America/New_York',
      localStartTime: '14:00',
      capacity: 8,
    });

    const res = await request(app)
      .delete(`${studio.base}/services/${created.body.service.id}`)
      .set(studio.headers);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SERVICE_IN_USE');
    expect(res.body.error.message).toContain('Deactivate');
  });
});

describe('assignment', () => {
  it('replaces the qualified staff list wholesale', async () => {
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(wheelClass);

    const one = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Rowan', email: 'rowan@clay.test' });
    const two = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Sam', email: 'sam@clay.test' });

    await request(app)
      .put(`${studio.base}/services/${created.body.service.id}/staff`)
      .set(studio.headers)
      .send({ staffIds: [one.body.staff.id, two.body.staff.id] });

    // PUT is a replacement, not an append.
    await request(app)
      .put(`${studio.base}/services/${created.body.service.id}/staff`)
      .set(studio.headers)
      .send({ staffIds: [one.body.staff.id] });

    const detail = await request(app)
      .get(`${studio.base}/services/${created.body.service.id}`)
      .set(studio.headers);

    expect(detail.body.service.staffServices).toHaveLength(1);
  });

  it('refuses to attach staff from another studio', async () => {
    const other = await signUpStudio(app);
    const theirStaff = await request(app)
      .post(`${other.base}/staff`)
      .set(other.headers)
      .send({ name: 'Outsider', email: 'outsider@clay.test' });

    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(wheelClass);

    const res = await request(app)
      .put(`${studio.base}/services/${created.body.service.id}/staff`)
      .set(studio.headers)
      .send({ staffIds: [theirStaff.body.staff.id] });

    expect(res.status).toBe(400);
  });
});

describe('role gates', () => {
  it('lets an instructor read services but not create them', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    expect(
      (await request(app).get(`${studio.base}/services`).set(instructor.headers)).status,
    ).toBe(200);

    const denied = await request(app)
      .post(`${studio.base}/services`)
      .set(instructor.headers)
      .send(wheelClass);

    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('refuses a non-member entirely, with a 404', async () => {
    const outsider = await signUpStudio(app);

    const res = await request(app)
      .get(`${studio.base}/services`)
      .set(outsider.headers);

    expect(res.status).toBe(404);
  });
});
