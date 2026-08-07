/**
 * Development seed: one realistic ceramics studio.
 *
 * Mirrors the defaults the W1.8 onboarding wizard will pre-fill, so what a
 * developer sees locally is what a new studio will see on day one — a studio
 * that edits rather than creates is the difference between a ten-minute
 * signup and an abandoned one.
 *
 * Idempotent: safe to run repeatedly.
 */
import { PrismaClient } from '@prisma/client';
import { createSession } from '../src/scheduling/session.service';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();
const TZ = 'America/New_York';

async function main() {
  const slug = 'clay-and-co';

  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (existing) {
    await prisma.organization.delete({ where: { id: existing.id } });
  }

  const org = await prisma.organization.create({
    data: { name: 'Clay & Co', slug, timezone: TZ, currency: 'USD' },
  });

  /**
   * An owner account, so the dashboard is usable straight after seeding.
   * Development only — these credentials are printed to the console on purpose.
   */
  const ownerEmail = 'owner@clayandco.test';
  const ownerPassword = 'kiln-shelf-glaze-42';

  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    create: {
      email: ownerEmail,
      name: 'Rowan Pike',
      passwordHash: await hashPassword(ownerPassword),
      emailVerifiedAt: new Date(),
    },
    update: { passwordHash: await hashPassword(ownerPassword) },
  });

  await prisma.membership.create({
    data: { organizationId: org.id, userId: owner.id, role: 'OWNER' },
  });

  const studio = await prisma.location.create({
    data: {
      organizationId: org.id,
      name: 'Gowanus Studio',
      locationType: 'FIXED',
      address: '119 Kiln Street, Brooklyn, NY',
      lat: 40.6782,
      lng: -73.9442,
      timezone: TZ,
    },
  });

  const mobile = await prisma.location.create({
    data: {
      organizationId: org.id,
      name: 'Mobile parties (we come to you)',
      locationType: 'SERVICE_AREA',
      lat: 40.6782,
      lng: -73.9442,
      radiusMeters: 30_000,
      timezone: TZ,
      travelFeeBands: [
        { maxKm: 10, feeCents: 2500 },
        { maxKm: 25, feeCents: 6500, minSpendCents: 40_000 },
      ],
    },
  });

  const rowan = await prisma.staff.create({
    data: {
      organizationId: org.id,
      name: 'Rowan Pike',
      email: 'rowan@clayandco.test',
      bio: 'Fifteen years at the wheel. Teaches beginners and throws production ware.',
      timezone: TZ,
    },
  });

  const sam = await prisma.staff.create({
    data: {
      organizationId: org.id,
      name: 'Sam Ortega',
      email: 'sam@clayandco.test',
      bio: 'Handbuilding and surface decoration. Runs the kiln room.',
      timezone: TZ,
    },
  });

  for (const staff of [rowan, sam]) {
    await prisma.staffLocation.createMany({
      data: [
        { staffId: staff.id, locationId: studio.id },
        { staffId: staff.id, locationId: mobile.id },
      ],
    });

    await prisma.availabilityRule.create({
      data: {
        organizationId: org.id,
        staffId: staff.id,
        ruleType: 'WORKING',
        rrule: 'FREQ=WEEKLY;BYDAY=TU,WE,TH,FR,SA',
        startMinute: 10 * 60,
        endMinute: 19 * 60,
        timezone: TZ,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      },
    });

    await prisma.availabilityRule.create({
      data: {
        organizationId: org.id,
        staffId: staff.id,
        ruleType: 'BREAK',
        rrule: 'FREQ=WEEKLY;BYDAY=TU,WE,TH,FR,SA',
        startMinute: 13 * 60,
        endMinute: 14 * 60,
        timezone: TZ,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      },
    });
  }

  const wheels = await prisma.resource.create({
    data: {
      organizationId: org.id,
      locationId: studio.id,
      name: 'Pottery wheels',
      resourceType: 'WHEEL',
      quantity: 8,
      isExclusive: false,
    },
  });

  await prisma.resource.create({
    data: {
      organizationId: org.id,
      locationId: studio.id,
      name: 'Skutt KM-1027',
      resourceType: 'KILN',
      quantity: 1,
      isExclusive: true,
    },
  });

  const policy = await prisma.cancellationPolicy.create({
    data: {
      organizationId: org.id,
      name: 'Standard',
      isDefault: true,
      tiers: [
        { hoursBefore: 48, refundPercent: 100 },
        { hoursBefore: 24, refundPercent: 0, creditPercent: 100 },
        { hoursBefore: 0, refundPercent: 0 },
      ],
      noShowFeeCents: 0,
      allowReschedule: true,
      rescheduleCutoffHours: 24,
    },
  });

  const classes = await prisma.serviceType.create({
    data: {
      organizationId: org.id,
      name: 'Beginner Wheel Throwing',
      slug: 'beginner-wheel-throwing',
      description:
        'Three hours at the wheel. Clay, tools and firing all included — leave with two pieces.',
      bookingMode: 'EVENT',
      durationMinutes: 180,
      slotGranularityMinutes: 30,
      capacityMax: 8,
      priceCents: 9500,
      skillLevel: 'Beginner',
      cancellationPolicyId: policy.id,
      color: '#a6522c',
    },
  });

  const privateLesson = await prisma.serviceType.create({
    data: {
      organizationId: org.id,
      name: 'Private Wheel Lesson',
      slug: 'private-wheel-lesson',
      description: 'One to one, at your pace. Good for a first try or a stuck technique.',
      bookingMode: 'APPOINTMENT',
      durationMinutes: 60,
      slotGranularityMinutes: 30,
      capacityMax: 1,
      priceCents: 12_000,
      paddingAfterMinutes: 15,
      cancellationPolicyId: policy.id,
      color: '#6e3418',
    },
  });

  const party = await prisma.serviceType.create({
    data: {
      organizationId: org.id,
      name: 'Mobile Pottery Party',
      slug: 'mobile-pottery-party',
      description:
        'We bring the wheels, clay and aprons to you. Birthdays, team days, hen dos.',
      bookingMode: 'APPOINTMENT',
      durationMinutes: 150,
      slotGranularityMinutes: 60,
      capacityMax: 1,
      priceCents: 45_000,
      paddingBeforeMinutes: 45,
      paddingAfterMinutes: 45,
      minNoticeMinutes: 72 * 60,
      cancellationPolicyId: policy.id,
      color: '#8a6a3f',
    },
  });

  await prisma.serviceLocation.createMany({
    data: [
      { serviceTypeId: classes.id, locationId: studio.id },
      { serviceTypeId: privateLesson.id, locationId: studio.id },
      { serviceTypeId: party.id, locationId: mobile.id },
    ],
  });

  await prisma.staffService.createMany({
    data: [
      { staffId: rowan.id, serviceTypeId: classes.id },
      { staffId: rowan.id, serviceTypeId: privateLesson.id },
      { staffId: rowan.id, serviceTypeId: party.id },
      { staffId: sam.id, serviceTypeId: classes.id },
      { staffId: sam.id, serviceTypeId: privateLesson.id },
    ],
  });

  await prisma.serviceResource.create({
    data: { serviceTypeId: classes.id, resourceId: wheels.id, quantityPerSeat: 1 },
  });

  // A month of Saturday classes, alternating instructors.
  const now = new Date();
  let created = 0;
  for (let i = 1; i <= 40 && created < 6; i++) {
    const day = new Date(now.getTime() + i * 86_400_000);
    if (day.getUTCDay() !== 6) continue;

    await createSession({
      organizationId: org.id,
      serviceTypeId: classes.id,
      staffId: created % 2 === 0 ? rowan.id : sam.id,
      locationId: studio.id,
      startsAt: new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 18, 0),
      ),
      endsAt: new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 21, 0),
      ),
      timezone: TZ,
      localStartTime: '14:00',
      capacity: 8,
    });
    created++;
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded "${org.name}" with ${created} classes.`);
  // eslint-disable-next-line no-console
  console.log(`Booking page: http://localhost:4000/public/${slug}`);
  // eslint-disable-next-line no-console
  console.log(`Dashboard:    http://localhost:5173`);
  // eslint-disable-next-line no-console
  console.log(`Sign in:      ${ownerEmail} / ${ownerPassword}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
