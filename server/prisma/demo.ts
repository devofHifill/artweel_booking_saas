/**
 * Demo data: five studios with real histories.
 *
 * SEPARATE from `seed.ts`, deliberately. That script documents itself as "what
 * a new studio sees on day one" — one studio, no customers, no bookings — and
 * it is the thing a developer looks at to know whether onboarding starts from
 * a sensible place. Burying it under a demo dataset would destroy the one
 * question it answers.
 *
 * This exists for the other question: what does the product look like with
 * something in it. Five studios, so tenant isolation is visible rather than
 * theoretical; four timezones, so "the studio's day" is testable by eye;
 * bookings in the past AND the future, so the manifest, reports and revenue
 * charts have something to draw.
 *
 *   npm run db:demo
 *
 * Destructive and idempotent: it deletes any studio whose slug it owns and
 * rebuilds. It never touches a studio it did not create.
 */
import { PrismaClient, type BookingStatus } from '@prisma/client';
import { createSession } from '../src/scheduling/session.service';
import { bookSeats } from '../src/scheduling/booking.service';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();

const PASSWORD = 'kiln-shelf-glaze-42';

/**
 * Deterministic pseudo-random.
 *
 * A demo dataset that reshuffles on every run makes "did my change do that?"
 * unanswerable — you cannot tell a real difference from a different roll. Same
 * seed, same studios, same bookings, every time.
 */
let rngState = 0x2f6e2b1;
function rand(): number {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  return Math.abs(rngState) / 0x7fffffff;
}
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const FIRST = [
  'Ada', 'Marcus', 'Jo', 'Priya', 'Tomas', 'Neve', 'Idris', 'Lena', 'Kwame',
  'Sofia', 'Hugo', 'Mei', 'Rafael', 'Astrid', 'Omar', 'Clara', 'Dev', 'Ines',
  'Yusuf', 'Nora', 'Callum', 'Ravi', 'Elsa', 'Bruno', 'Thea',
] as const;

const LAST = [
  'Potter', 'Reed', 'Mercer', 'Shah', 'Almeida', 'Byrne', 'Khan', 'Vogel',
  'Mensah', 'Ruiz', 'Lindqvist', 'Chen', 'Okafor', 'Duarte', 'Novak',
] as const;

type StudioSpec = {
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  ownerEmail: string;
  ownerName: string;
  city: string;
  staff: { name: string; email: string; color: string }[];
  customers: number;
  /** Which of the shared service shapes this studio offers. */
  priceMultiplier: number;
};

/**
 * Five studios, in four timezones and two currencies.
 *
 * The timezone spread is the point of having more than one: every figure in
 * this product is computed in the STUDIO's day, and a bug in that is invisible
 * when every studio is in New York.
 */
const STUDIOS: StudioSpec[] = [
  {
    slug: 'clay-and-co',
    name: 'Clay & Co',
    timezone: 'America/New_York',
    currency: 'USD',
    ownerEmail: 'owner@clayandco.test',
    ownerName: 'Rowan Pike',
    city: 'Gowanus, Brooklyn',
    staff: [
      { name: 'Rowan Pike', email: 'rowan@clayandco.test', color: '#4f46e5' },
      { name: 'Sam Ortega', email: 'sam@clayandco.test', color: '#0ea5e9' },
    ],
    customers: 18,
    priceMultiplier: 1,
  },
  {
    slug: 'kiln-house',
    name: 'Kiln House',
    timezone: 'America/Los_Angeles',
    currency: 'USD',
    ownerEmail: 'owner@kilnhouse.test',
    ownerName: 'Delia Marsh',
    city: 'Portland',
    staff: [
      { name: 'Delia Marsh', email: 'delia@kilnhouse.test', color: '#2f6b4f' },
      { name: 'Theo Blake', email: 'theo@kilnhouse.test', color: '#d97706' },
      { name: 'Nina Falk', email: 'nina@kilnhouse.test', color: '#7c3aed' },
    ],
    customers: 24,
    priceMultiplier: 0.9,
  },
  {
    slug: 'wildflower-ceramics',
    name: 'Wildflower Ceramics',
    timezone: 'America/Chicago',
    currency: 'USD',
    ownerEmail: 'owner@wildflower.test',
    ownerName: 'Mira Chen',
    city: 'Austin',
    staff: [
      { name: 'Mira Chen', email: 'mira@wildflower.test', color: '#a6522c' },
      { name: 'Jonah Reyes', email: 'jonah@wildflower.test', color: '#0891b2' },
    ],
    customers: 12,
    priceMultiplier: 1.1,
  },
  {
    slug: 'the-throwing-room',
    name: 'The Throwing Room',
    timezone: 'Europe/London',
    currency: 'GBP',
    ownerEmail: 'owner@throwingroom.test',
    ownerName: 'Harriet Vale',
    city: 'Hackney, London',
    staff: [
      { name: 'Harriet Vale', email: 'harriet@throwingroom.test', color: '#be123c' },
      { name: '0mar Idris', email: 'omar@throwingroom.test', color: '#15803d' },
    ],
    customers: 20,
    priceMultiplier: 0.85,
  },
  {
    slug: 'terra-studio',
    name: 'Terra Studio',
    timezone: 'America/Denver',
    currency: 'USD',
    ownerEmail: 'owner@terrastudio.test',
    ownerName: 'Bea Lindqvist',
    city: 'Denver',
    staff: [{ name: 'Bea Lindqvist', email: 'bea@terrastudio.test', color: '#0f766e' }],
    /** Deliberately the quiet one — an empty-ish studio is a state worth seeing. */
    customers: 5,
    priceMultiplier: 1,
  },
];

/** Midnight UTC on a day offset from today, so runs are stable within a day. */
function dayAt(offsetDays: number, hourUtc: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  d.setUTCHours(hourUtc);
  return d;
}

async function buildStudio(spec: StudioSpec) {
  const existing = await prisma.organization.findUnique({
    where: { slug: spec.slug },
  });
  if (existing) await prisma.organization.delete({ where: { id: existing.id } });

  const org = await prisma.organization.create({
    data: {
      name: spec.name,
      slug: spec.slug,
      timezone: spec.timezone,
      currency: spec.currency,
      plan: 'STUDIO',
      subscriptionStatus: 'ACTIVE',
      tagline: `Hand-thrown pottery classes in ${spec.city}.`,
      about:
        'A small studio with big kilns. Beginners welcome — everything you need is here, ' +
        'including the apron.\n\nClasses run most evenings and all weekend.',
      contactEmail: spec.ownerEmail,

      /**
       * Past onboarding.
       *
       * `complete` is derived as `onboardingDoneAt !== null`, so without this
       * every one of these studios — full of staff, classes and a year of
       * bookings — lands on the setup wizard instead of its own dashboard.
       * Found by opening the page rather than by the script failing, which it
       * happily did not.
       */
      onboardingDoneAt: new Date(),
    },
  });

  const owner = await prisma.user.upsert({
    where: { email: spec.ownerEmail },
    create: {
      email: spec.ownerEmail,
      name: spec.ownerName,
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
    },
    update: { passwordHash: await hashPassword(PASSWORD) },
  });

  await prisma.membership.create({
    data: { organizationId: org.id, userId: owner.id, role: 'OWNER' },
  });

  const location = await prisma.location.create({
    data: {
      organizationId: org.id,
      name: `${spec.city} Studio`,
      locationType: 'FIXED',
      address: `${between(10, 400)} Kiln Street, ${spec.city}`,
      timezone: spec.timezone,
    },
  });

  const staff = [];
  for (const person of spec.staff) {
    const row = await prisma.staff.create({
      data: {
        organizationId: org.id,
        name: person.name,
        email: person.email,
        color: person.color,
        timezone: spec.timezone,
        isPublic: true,
      },
    });
    await prisma.staffLocation.create({
      data: { staffId: row.id, locationId: location.id },
    });
    await prisma.availabilityRule.create({
      data: {
        organizationId: org.id,
        staffId: row.id,
        ruleType: 'WORKING',
        rrule: 'FREQ=WEEKLY;BYDAY=TU,WE,TH,FR,SA,SU',
        startMinute: 9 * 60,
        endMinute: 21 * 60,
        timezone: spec.timezone,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      },
    });
    staff.push(row);
  }

  const money = (base: number) => Math.round((base * spec.priceMultiplier) / 100) * 100;

  const wheel = await prisma.serviceType.create({
    data: {
      organizationId: org.id,
      name: 'Beginner Wheel Throwing',
      slug: 'beginner-wheel-throwing',
      description:
        'Three hours at the wheel. Clay, tools and firing included — leave with two pieces.',
      bookingMode: 'EVENT',
      durationMinutes: 180,
      capacityMin: 1,
      capacityMax: 8,
      priceCents: money(9500),
      color: '#4f46e5',
    },
  });

  const handbuilding = await prisma.serviceType.create({
    data: {
      organizationId: org.id,
      name: 'Handbuilding Workshop',
      slug: 'handbuilding-workshop',
      description: 'No wheel, no pressure. Coil and slab building for absolute beginners.',
      bookingMode: 'EVENT',
      durationMinutes: 120,
      capacityMin: 1,
      capacityMax: 10,
      priceCents: money(6500),
      color: '#0ea5e9',
    },
  });

  const privateLesson = await prisma.serviceType.create({
    data: {
      organizationId: org.id,
      name: 'Private Wheel Lesson',
      slug: 'private-wheel-lesson',
      description: 'One to one, at your pace.',
      bookingMode: 'APPOINTMENT',
      durationMinutes: 60,
      slotGranularityMinutes: 60,
      capacityMin: 1,
      capacityMax: 1,
      priceCents: money(12_000),
      color: '#7c3aed',
    },
  });

  for (const service of [wheel, handbuilding, privateLesson]) {
    await prisma.serviceLocation.create({
      data: { serviceTypeId: service.id, locationId: location.id },
    });
    for (const person of staff) {
      await prisma.staffService.create({
        data: { staffId: person.id, serviceTypeId: service.id },
      });
    }
  }

  const customers = [];
  for (let i = 0; i < spec.customers; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    customers.push(
      await prisma.customer.create({
        data: {
          organizationId: org.id,
          name,
          email: `${name.toLowerCase().replace(/[^a-z]/g, '.')}.${i}@example.test`,
          phone: `+1555${between(1000000, 9999999)}`,
          // Roughly half consent to texts, which is what makes the
          // notifications screen show a realistic split rather than all-yes.
          smsConsentAt: rand() > 0.5 ? new Date() : null,
        },
      }),
    );
  }

  /*
    Sessions across five weeks — two behind, three ahead.

    The past ones are what give the manifest, reports and the revenue chart
    something to draw; the future ones are what Bookings and the calendar are
    mostly about. A dataset with only future bookings looks fine on every
    screen and proves nothing about any of them.
  */
  const sessions = [];
  for (let offset = -14; offset <= 21; offset++) {
    const service = offset % 3 === 0 ? handbuilding : wheel;
    // Evenings on weekdays, afternoons at weekends — 18:00 and 14:00 UTC are
    // close enough to both across the timezones in play.
    if (offset % 2 !== 0) continue;

    sessions.push(
      await createSession({
        organizationId: org.id,
        serviceTypeId: service.id,
        // Every fifth class has NOBODY assigned, so "unassigned this week" and
        // the dashboard's attention list have something real to report.
        staffId: offset % 10 === 0 ? null : staff[Math.abs(offset) % staff.length]!.id,
        locationId: location.id,
        startsAt: dayAt(offset, 18),
        endsAt: dayAt(offset, 18 + service.durationMinutes / 60),
        timezone: spec.timezone,
        localStartTime: '14:00',
        capacity: service.capacityMax,
      }),
    );
  }

  let bookings = 0;
  let payments = 0;

  for (const session of sessions) {
    const past = session.startsAt < new Date();
    // Past classes fill up; future ones are still filling.
    const wanted = past ? between(3, session.capacity) : between(0, session.capacity - 2);

    for (let i = 0; i < wanted; i++) {
      const customer = pick(customers);
      const seats = rand() > 0.85 ? 2 : 1;

      const booking = await bookSeats({
        organizationId: org.id,
        sessionId: session.id,
        customerId: customer.id,
        seats,
        source: pick(['web', 'embed', 'admin'] as const),
      }).catch(() => null);

      if (!booking) continue; // Session filled up; that is a fine outcome.
      bookings++;

      const service = [wheel, handbuilding].find(
        (s) => s.id === session.serviceTypeId,
      )!;
      const totalCents = service.priceCents * seats;

      /**
       * Past bookings resolve into attendance; future ones stay pending or
       * confirmed. A no-show now and then is what makes the credits ledger and
       * the manifest's absent column non-empty.
       */
      let status: BookingStatus = 'CONFIRMED';
      if (past) status = rand() > 0.12 ? 'ATTENDED' : 'NO_SHOW';
      else if (rand() > 0.85) status = 'PENDING';

      await prisma.booking.update({
        where: { id: booking.id },
        data: { status, totalCents },
      });

      // Most are paid. A few are not, so "money owed" and the payment pills
      // have something to show.
      if (rand() > 0.18) {
        await prisma.payment.create({
          data: {
            organizationId: org.id,
            bookingId: booking.id,
            kind: 'FULL',
            amountCents: totalCents,
            currency: spec.currency,
            status: 'SUCCEEDED',
            succeededAt: new Date(session.startsAt.getTime() - 86_400_000),
          },
        });
        payments++;
      }
    }
  }

  return { org, staff: staff.length, customers: customers.length, sessions: sessions.length, bookings, payments };
}

/**
 * Refuses to run anywhere that looks like production.
 *
 * This script DELETES organizations by slug and rebuilds them. That is fine on
 * a laptop and catastrophic on a box with a real studio on it — and the two
 * are one `npm run` apart in a repo that gets deployed. The guard is here
 * rather than in documentation because documentation does not stop a tired
 * person at 11pm.
 *
 * `DEMO_SEED_I_MEAN_IT=yes` overrides it, deliberately verbose: anybody typing
 * that has been told exactly what they are doing.
 */
function assertSafeToRun() {
  if (process.env.DEMO_SEED_I_MEAN_IT === 'yes') return;

  const url = process.env.DATABASE_URL ?? '';

  /*
    Judged on the DATABASE NAME, not the host.

    The first version of this allowlisted hosts and included `postgres` —
    which is exactly what a containerised database is called in
    docker-compose, on the VPS included. A guard written to protect production
    would have waved production straight through. Hostnames describe where a
    database runs; the name describes what it is for, and only the second is
    a safe thing to gate on.

    `booking_dev` and `booking_test` are this project's local databases. The
    deployed one is plain `booking`, and it is not on this list.
  */
  const database = url.split('/').pop()?.split('?')[0] ?? '';
  const isDisposable = database === 'booking_dev' || database === 'booking_test';

  if (process.env.NODE_ENV === 'production' || !isDisposable) {
    // eslint-disable-next-line no-console
    console.error(
      [
        'Refusing to run: this script deletes and rebuilds studios, and this',
        'does not look like a local database.',
        '',
        `  NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`,
        `  DATABASE_URL=${url.replace(/\/\/[^@]*@/, '//***@') || '(unset)'}`,
        '',
        'If you are certain, re-run with DEMO_SEED_I_MEAN_IT=yes.',
      ].join('\n'),
    );
    process.exit(1);
  }
}

async function main() {
  assertSafeToRun();

  const summary = [];

  for (const spec of STUDIOS) {
    const built = await buildStudio(spec);
    summary.push({
      studio: built.org.name,
      tz: spec.timezone,
      staff: built.staff,
      customers: built.customers,
      classes: built.sessions,
      bookings: built.bookings,
      paid: built.payments,
    });
  }

  // eslint-disable-next-line no-console
  console.table(summary);
  // eslint-disable-next-line no-console
  console.log(`\nEvery owner signs in with:  ${PASSWORD}`);
  for (const spec of STUDIOS) {
    // eslint-disable-next-line no-console
    console.log(
      `  ${spec.ownerEmail.padEnd(32)} ${spec.name.padEnd(22)} /public/${spec.slug}`,
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
