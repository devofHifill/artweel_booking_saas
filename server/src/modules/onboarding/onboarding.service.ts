import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { placeUnplacedStaff } from '../staff/staff.service';
import { adoptSessionsWithoutLocation } from '../locations/location.service';
import { activityReadiness } from '../services/service.service';

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
  | 'location'
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

/** "Rowan", "Rowan and Sam", "Rowan, Sam and Jo". */
function listNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export async function getOnboardingState(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });

  const [services, team, locations] = await Promise.all([
    prisma.serviceType.count({ where: { organizationId, isActive: true } }),
    /* Per person, not a count. "Anybody has any rule" ticked this step while a
       second instructor — the one a One to one is booked with — had none. */
    prisma.staff.findMany({
      where: { organizationId, isActive: true },
      select: {
        name: true,
        _count: { select: { availabilityRules: { where: { ruleType: 'WORKING' } } } },
        staffServices: {
          where: { serviceType: { isActive: true, bookingMode: 'APPOINTMENT' } },
          select: { serviceTypeId: true },
        },
      },
    }),
    prisma.location.count({ where: { organizationId, isActive: true } }),
  ]);

  const withHours = team.filter((s) => s._count.availabilityRules > 0);
  /* Hours only decide ONE TO ONE bookings — a group class is booked from its
     dates — so the people who must have them are those who teach one. */
  const missingHours = team
    .filter((s) => s.staffServices.length > 0 && s._count.availabilityRules === 0)
    .map((s) => s.name);

  /**
   * Completion is DERIVED from the data, not from a flag the wizard sets.
   *
   * A studio that adds a class through the normal admin screens has done that
   * step, and being asked again would be absurd. Storing "clicked next" would
   * also let the wizard and reality drift apart.
   */
  const steps: Step[] = [
    /*
      Two steps, where there was one. "Name your studio" was only ticked once
      the studio also had a LOCATION, and said nothing about one — so it sat
      unticked for a studio that had named itself at signup, with no way to
      tell what was missing. Each now says what it waits for.
    */
    {
      id: 'studio',
      title: 'Name your studio',
      description: 'Your name and timezone. This is what customers see.',
      done: Boolean(org.name),
      optional: false,
    },
    {
      id: 'location',
      title: 'Add your location',
      description: 'Where your classes happen. Customers see it when they book.',
      done: locations > 0,
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
      // Names who is missing, rather than leaving the step to be puzzled over.
      description:
        missingHours.length > 0
          ? `${listNames(missingHours)} ${missingHours.length === 1 ? 'teaches' : 'teach'} One to one lessons but ${missingHours.length === 1 ? 'has' : 'have'} no working hours yet.`
          : 'When you teach. Customers can only book inside these.',
      done: withHours.length > 0 && missingHours.length === 0,
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

  /*
    And something a customer can actually book.

    The steps only count things — a class exists, somebody has hours — and all
    of them could be ticked while the booking page had nothing to sell: a class
    with no dates, a One to one nobody teaches. Setup then said "Everything
    needed is in place" over a page that said "No dates scheduled yet". The
    same check the catalogue uses decides it here, and names what is stuck.
  */
  const live = await activityReadiness(organizationId);
  const bookable = {
    count: live.filter((s) => s.readiness.bookable).length,
    stuck: live
      .filter((s) => !s.readiness.bookable && s.readiness.problem)
      .map((s) => ({ id: s.id, name: s.name, problem: s.readiness.problem! })),
  };

  const readyToPublish = required.every((s) => s.done) && bookable.count > 0;

  return {
    steps,
    bookable,
    readyToPublish,
    complete: org.onboardingDoneAt !== null,
    bookingUrl: `${config.PUBLIC_URL}/public/${org.slug}`,
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      timezone: org.timezone,
      // So setup can offer the ceramics examples to a ceramics studio only.
      businessType: org.businessType,
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
  input: {
    instructorName?: string;
    instructorEmail?: string;
    actorUserId?: string;
    /** The example ceramics classes and equipment. See the route. */
    examples?: boolean;
  } = {},
) {
  const examples = input.examples !== false;
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

    // Anybody added on Staff & Guides before setup ran works here too, and so
    // does any class scheduled before there was anywhere to put it.
    await placeUnplacedStaff(organizationId, location.id);
    await adoptSessionsWithoutLocation(organizationId, location.id);
  }

  // --- Instructor ----------------------------------------------------------
  let staff = await prisma.staff.findFirst({
    where: { organizationId, isActive: true },
  });

  if (!staff) {
    /*
      The person who pressed the button, by default — the owner of a small
      studio is almost always its first instructor. It was "Me", at a made-up
      address (instructor@<slug>.local), linked to no login: the owner's own
      My schedule was empty and the name customers saw was "Me".

      Only somebody who is a MEMBER of this studio. A platform admin inside a
      support session is signed in too, and must not become its instructor.
    */
    const member = input.actorUserId
      ? await prisma.membership.findUnique({
          where: { organizationId_userId: { organizationId, userId: input.actorUserId } },
          select: { user: { select: { id: true, name: true, email: true } } },
        })
      : null;
    const me = member?.user ?? null;

    let email =
      input.instructorEmail?.trim().toLowerCase() ||
      me?.email.toLowerCase() ||
      `instructor@${org.slug}.local`;
    // A switched-off staff record may already hold that address; the address
    // is unique within a studio, so fall back rather than fail setup.
    if (await prisma.staff.findFirst({ where: { organizationId, email } })) {
      email = `instructor@${org.slug}.local`;
    }

    staff = await prisma.staff.create({
      data: {
        organizationId,
        name: input.instructorName?.trim() || me?.name?.trim() || 'Me',
        email,
        // Linked to the login when it is theirs, so My schedule finds it.
        userId: me && email === me.email.toLowerCase() ? me.id : null,
        timezone: org.timezone,
      },
    });
    created.staff = true;

    await prisma.staffLocation.create({
      data: { staffId: staff.id, locationId: location.id },
    });

    /*
      And they teach what nobody teaches yet. Setup only assigned the classes
      it made itself, so a studio that had created its own first ended up with
      an instructor who taught nothing — and a One to one nobody could book.
    */
    const untaught = await prisma.serviceType.findMany({
      where: { organizationId, isActive: true, staffServices: { none: {} } },
      select: { id: true },
    });
    if (untaught.length > 0) {
      await prisma.staffService.createMany({
        data: untaught.map((s) => ({ staffId: staff!.id, serviceTypeId: s.id })),
        skipDuplicates: true,
      });
    }
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
        // Full refund with two days' notice, half with one, nothing at the
        // last minute.
        tiers: [
          { hoursBefore: 48, refundPercent: 100 },
          { hoursBefore: 24, refundPercent: 50 },
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

  // Wheels and a kiln are the ceramics example, not the basics.
  if (examples && existingResources === 0) {
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

  // The three ceramics classes are the example; a kayak business says no.
  if (examples && existingServices === 0) {
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
