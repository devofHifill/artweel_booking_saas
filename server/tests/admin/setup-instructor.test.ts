import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';
import { seedPotteryDefaults } from '../../src/modules/onboarding/onboarding.service';

/**
 * The instructor "Set up my studio" makes (docs/ux-audit-findings.md #18).
 *
 * It was called "Me", at a made-up address (instructor@<slug>.local), linked to
 * no login, and taught only the classes setup created itself — so a studio that
 * had made its own activity first got an instructor who taught nothing.
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
  resetRateLimits();
  studio = await signUpStudio(app, { organizationName: 'Harbour Kayak Tours' });
});

const seed = (body: Record<string, unknown> = {}) =>
  request(app).post(`${studio.base}/onboarding/seed`).set(studio.headers).send(body).expect(200);

const onlyInstructor = () =>
  prisma.staff.findFirstOrThrow({
    where: { organizationId: studio.organizationId },
    include: { staffServices: { include: { serviceType: { select: { name: true } } } } },
  });

describe('the instructor setup creates', () => {
  it('is the owner who pressed the button, linked to their login', async () => {
    await seed();

    const staff = await onlyInstructor();
    expect(staff.name).toBe('Studio Owner');
    expect(staff.email).toBe(studio.email.toLowerCase());
    expect(staff.userId).toBe(studio.userId);
  });

  it('teaches the activities the studio already had, not only the ones setup adds', async () => {
    const lesson = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send({ name: 'Private kayak lesson', bookingMode: 'APPOINTMENT', durationMinutes: 60 })
      .expect(201);

    await seed();

    const staff = await onlyInstructor();
    expect(staff.staffServices.map((s) => s.serviceType.name)).toEqual(['Private kayak lesson']);

    // So the lesson is bookable straight away — setup's own "ready" agrees.
    const state = (await request(app).get(`${studio.base}/onboarding`).set(studio.headers).expect(200)).body;
    expect(state.bookable.stuck.map((s: { id: string }) => s.id)).not.toContain(lesson.body.service.id);
  });

  it('uses a name and address it is given, without claiming the owner’s login', async () => {
    await seed({ instructorName: 'Rowan Pike', instructorEmail: 'rowan@clay.test' });

    const staff = await onlyInstructor();
    expect(staff.name).toBe('Rowan Pike');
    expect(staff.email).toBe('rowan@clay.test');
    expect(staff.userId).toBeNull();
  });

  it('never becomes somebody who is not on this studio’s team', async () => {
    // A platform admin in a support session is signed in, but not a member.
    const outsider = await signUpStudio(app, { organizationName: 'Somewhere Else' });

    await seedPotteryDefaults(studio.organizationId, { actorUserId: outsider.userId });

    const staff = await onlyInstructor();
    expect(staff.userId).toBeNull();
    expect(staff.email).not.toBe(outsider.email.toLowerCase());
  });
});
