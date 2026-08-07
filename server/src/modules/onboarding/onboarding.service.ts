import { prisma } from '../../lib/prisma';
import { config } from '../../config';

/**
 * Getting a studio from signup to a live booking page.
 *
 * The Phase 1 exit gate is a stranger doing this unaided in under ten minutes,
 * which rules out asking them to invent anything. Every default here is a
 * real ceramics studio's actual setup, so the job is EDITING rather than
 * creating — the difference between a ten-minute signup and an abandoned one.
 */

export type StepId =
  | 'studio'
  | 'service'
  | 'hours'
  | 'payments'
  | 'publish';

export type Step = {
  id: StepId;
  title: string;
  description: string;
  done: boolean;
  /** True when the studio can go live without it. */
  optional: boolean;
};

export async function getOnboardingState(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });

  const [services, staff, rules, locations] = await Promise.all([
    prisma.serviceType.count({ where: { organizationId, isActive: true } }),
    prisma.staff.count({ where: { organizationId, isActive: true } }),
    prisma.availabilityRule.count({ where: { organizationId } }),
    prisma.location.count({ where: { organizationId, isActive: true } }),
  ]);

  /**
   * Completion is DERIVED from the data, not from a flag the wizard sets.
   *
   * A studio that adds a class through the normal admin screens has done that
   * step, and being asked again would be absurd. Storing "clicked next" would
   * also let the wizard and reality drift apart.
   */
  const steps: Step[] = [
    {
      id: 'studio',
      title: 'Name your studio',
      description: 'Your name and timezone. This is what customers see.',
      done: Boolean(org.name) && locations > 0,
      optional: false,
    },
    {
      id: 'service',
      title: 'Add a class',
      description: 'What you teach, how long it runs and what it costs.',
      done: services > 0,
      optional: false,
    },
    {
      id: 'hours',
      title: 'Set your hours',
      description: 'When you teach. Customers can only book inside these.',
      done: staff > 0 && rules > 0,
      optional: false,
    },
    {
      id: 'payments',
      title: 'Connect payments',
      description: 'Take deposits and payments online. Money goes to you directly.',
      done: org.stripeChargesEnabled,
      // A studio taking cash at the door is a real business. This must not
      // block them from going live.
      optional: true,
    },
    {
      id: 'publish',
      title: 'Share your booking page',
      description: 'Put the link in your bio and start taking bookings.',
      done: org.onboardingDoneAt !== null,
      optional: false,
    },
  ];

  const required = steps.filter((s) => !s.optional && s.id !== 'publish');
  const readyToPublish = required.every((s) => s.done);

  return {
    steps,
    readyToPublish,
    complete: org.onboardingDoneAt !== null,
    bookingUrl: `${config.PUBLIC_URL}/public/${org.slug}`,
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      timezone: org.timezone,
    },
  };
}

export async function markPublished(organizationId: string) {
  return prisma.organization.update({
    where: { id: organizationId },
    data: { onboardingDoneAt: new Date() },
  });
}

/**
 * Seeds a working ceramics studio.
 *
 * Idempotent and additive: it never overwrites something the studio has
 * already set up, so pressing the button twice is harmless and a partially
 * configured studio can still use it to fill the gaps.
 */
export async function seedPotteryDefaults(
  organizationId: string,
  input: { instructorName?: string; instructorEmail?: string } = {},
) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });

  const created = {
    location: false,
    staff: false,
    services: 0,
    hours: false,
    policy: false,
    resources: 0,
  };

  // --- Location ------------------------------------------------------------
  let location = await prisma.location.findFirst({
    where: { organizationId, isActive: true },
  });

  if (!location) {
    location = await prisma.location.create({
      data: {
        organizationId,
        name: 'The studio',
        locationType: 'FIXED',
        timezone: org.timezone,
      },
    });
    created.location = true;
  }

  // --- Instructor ----------------------------------------------------------
  let staff = await prisma.staff.findFirst({
    where: { organizationId, isActive: true },
  });

  if (!staff) {
    staff = await prisma.staff.create({
      data: {
        organizationId,
        name: input.instructorName?.trim() || 'Me',
        email:
          input.instructorEmail?.trim().toLowerCase() ||
          `instructor@${org.slug}.local`,
        timezone: org.timezone,
      },
    });
    created.staff = true;

    await prisma.staffLocation.create({
      data: { staffId: staff.id, locationId: location.id },
    });
  }

  // --- Cancellation terms --------------------------------------------------
  let policy = await prisma.cancellationPolicy.findFirst({
    where: { organizationId, isDefault: true },
  });

  if (!policy) {
    policy = await prisma.cancellationPolicy.create({
      data: {
        organizationId,
        name: 'Standard',
        isDefault: true,
        // What most studios actually run: full refund with notice, credit
        // inside a day, nothing at the last minute.
        tiers: [
          { hoursBefore: 48, refundPercent: 100 },
          { hoursBefore: 24, refundPercent: 0, creditPercent: 100 },
          { hoursBefore: 0, refundPercent: 0 },
        ],
        allowReschedule: true,
        rescheduleCutoffHours: 24,
      },
    });
    created.policy = true;
  }

  // --- Equipment -----------------------------------------------------------
  const existingResources = await prisma.resource.count({ where: { organizationId } });

  if (existingResources === 0) {
    await prisma.resource.create({
      data: {
        organizationId,
        locationId: location.id,
        name: 'Pottery wheels',
        resourceType: 'WHEEL',
        quantity: 6,
        isExclusive: false,
      },
    });
    await prisma.resource.create({
      data: {
        organizationId,
        locationId: location.id,
        name: 'Kiln',
        resourceType: 'KILN',
        quantity: 1,
        isExclusive: true,
      },
    });
    created.resources = 2;
  }

  // --- Classes -------------------------------------------------------------
  const existingServices = await prisma.serviceType.count({
    where: { organizationId },
  });

  if (existingServices === 0) {
    const defaults = [
      {
        name: 'Beginner Wheel Throwing',
        slug: 'beginner-wheel-throwing',
        description:
          'Three hours at the wheel. Clay, tools and firing included — leave with two pieces.',
        bookingMode: 'EVENT' as const,
        durationMinutes: 180,
        capacityMax: 6,
        priceCents: 9500,
        skillLevel: 'Beginner',
        color: '#a6522c',
      },
      {
        name: 'Handbuilding Workshop',
        slug: 'handbuilding-workshop',
        description: 'No wheel needed. Pinch, coil and slab building for all levels.',
        bookingMode: 'EVENT' as const,
        durationMinutes: 120,
        capacityMax: 8,
        priceCents: 6500,
        skillLevel: 'All levels',
        color: '#8a6a3f',
      },
      {
        name: 'Private Lesson',
        slug: 'private-lesson',
        description: 'One to one, at your pace.',
        bookingMode: 'APPOINTMENT' as const,
        durationMinutes: 60,
        capacityMax: 1,
        priceCents: 12_000,
        color: '#6e3418',
      },
    ];

    for (const definition of defaults) {
      const service = await prisma.serviceType.create({
        data: {
          ...definition,
          organizationId,
          slotGranularityMinutes: 30,
          cancellationPolicyId: policy.id,
        },
      });

      await prisma.staffService.create({
        data: { staffId: staff.id, serviceTypeId: service.id },
      });
      await prisma.serviceLocation.create({
        data: { serviceTypeId: service.id, locationId: location.id },
      });

      created.services++;
    }
  }

  // --- Working hours -------------------------------------------------------
  const existingRules = await prisma.availabilityRule.count({
    where: { organizationId, staffId: staff.id },
  });

  if (existingRules === 0) {
    await prisma.availabilityRule.create({
      data: {
        organizationId,
        staffId: staff.id,
        ruleType: 'WORKING',
        // Tuesday to Saturday is the shape of nearly every studio's week.
        rrule: 'FREQ=WEEKLY;BYDAY=TU,WE,TH,FR,SA',
        startMinute: 10 * 60,
        endMinute: 18 * 60,
        timezone: org.timezone,
        effectiveFrom: new Date(),
      },
    });
    created.hours = true;
  }

  return created;
}
