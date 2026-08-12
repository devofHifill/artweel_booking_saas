/**
 * Marketing copy, as data.
 *
 * ONE RULE ABOVE ALL: nothing here may describe a feature that does not ship
 * today. Promising piece tracking or multi-week courses before they exist
 * produces trials that churn in week one and refund requests from people who
 * were told the truth by a competitor instead. What is coming is labelled as
 * coming.
 *
 * Shipping today: classes and appointments, mobile/travelling bookings with
 * travel areas and fees, equipment-aware capacity, Stripe payments with
 * deposits and policy-driven refunds, email and SMS reminders, two-way Google
 * Calendar sync, and the owner dashboard.
 */

export type Page = {
  slug: string;
  title: string;
  /** Under ~155 characters, or Google truncates it. */
  description: string;
  h1: string;
  intro: string;
  sections: { heading: string; body: string[] }[];
  faqs?: { q: string; a: string }[];
  cta?: string;
  /** Long-form pages are articles; landing pages are not. */
  article?: { published: string; readingMinutes: number };
};

export const SHIPPING_FEATURES = [
  {
    title: 'Your kiln and wheels are real constraints',
    body:
      'Eight wheels means eight students — not whatever number you typed into a ' +
      'capacity box. A kiln firing blocks the kiln. The schedule reflects what ' +
      'your studio can physically do, so you stop discovering conflicts on the day.',
  },
  {
    title: 'Studio and mobile, in one schedule',
    body:
      'Set a travel area with a radius and distance-based fees. Customers give ' +
      'their address before they pick a time, so nobody chooses a slot you were ' +
      'never going to reach. Travel time counts against your day.',
  },
  {
    title: 'You keep what your customers pay',
    body:
      'Payments go straight to your Stripe account. No booking fees, no ' +
      'commission, no cut. A flat monthly price and nothing else.',
  },
  {
    title: 'Deposits and cancellation terms you set',
    body:
      'Take a deposit or the full amount. Write your own refund ladder — full ' +
      'refund with two days notice, studio credit inside a day, whatever you ' +
      'actually run. Refunds follow it automatically.',
  },
  {
    title: 'Reminders that cut no-shows',
    body:
      'Automatic email and text reminders before every class. Customers can ' +
      'cancel or move their own booking from the link, without messaging you.',
  },
  {
    title: 'Your calendar stays yours',
    body:
      'Two-way Google Calendar sync per instructor. A dentist appointment in ' +
      'your own calendar blocks that slot automatically, and classes appear ' +
      'where you already look.',
  },
  {
    title: 'Multi-week courses that sell as one thing',
    body:
      'Publish a six-week course and students enrol once, for the whole run. ' +
      'A course is only sold while every week of it has room, so nobody pays ' +
      'for six weeks and finds week four was full.',
  },
  {
    title: 'Take the register from the studio floor',
    body:
      'Mark a whole class present or absent in one tap, on the phone in your ' +
      'apron pocket. Course rosters show who has missed which week, so you ' +
      'know who is falling behind before they quietly stop coming.',
  },
];

/**
 * Phase 2 work that is genuinely not built yet.
 *
 * This list has been split twice now, each time a piece of it shipped: courses
 * left when W2.1 landed, attendance registers when W2.2a did. Keep doing that.
 * Half-true is the shape of promise a studio signs up on and churns over, and
 * it costs nothing to move a line.
 */
export const COMING_SOON = [
  'Piece tracking through the firing cycle, with a text when a piece is ready',
  'Kiln loads and firing schedules',
  'Make-up classes for a missed week',
  'Waitlists and class packs',
];

const CTA = 'Start free for 14 days. No card needed.';

export const HOME: Page = {
  slug: '',
  title: 'Booking software for pottery studios',
  description:
    'Take class and private lesson bookings online, run mobile pottery parties, and keep every penny your customers pay. Free for 14 days, no card.',
  h1: 'Booking software built for pottery studios',
  intro:
    'Classes, private lessons and mobile parties in one schedule that knows how ' +
    'many wheels you own. No booking fees and no commission.',
  sections: [
    {
      heading: 'Built for how a ceramics studio actually runs',
      body: [
        'Most booking software was built for haircuts or gym classes and then ' +
          'pointed at studios. It treats a location as a text label, capacity as ' +
          'a number you type in, and has no idea a kiln exists.',
        'This one starts from the constraints you actually have: the wheels in ' +
          'the room, the kiln that is running overnight, and the fact that half ' +
          'your work happens at somebody else’s address.',
      ],
    },
    {
      heading: 'Stop answering the same DM forty times a week',
      body: [
        'A booking page you can put in your Instagram bio, showing live ' +
          'availability. Customers book, pay a deposit and get a confirmation ' +
          'without you touching anything.',
        'They can move or cancel their own booking from the link in that email, ' +
          'under the terms you set.',
      ],
    },
    {
      heading: 'Mobile parties are a first-class booking, not a workaround',
      body: [
        'Set the area you travel to and what you charge by distance. Customers ' +
          'enter their address before they choose a time, so an out-of-range ' +
          'booking never gets made in the first place.',
        'Travel time is subtracted from your day, so the system will not sell ' +
          'you a studio class forty minutes after a party across town.',
      ],
    },
  ],
  faqs: [
    {
      q: 'Do you take a cut of my bookings?',
      a: 'No. Payments go straight to your own Stripe account. You pay a flat monthly fee and nothing else — no booking fees, no percentage.',
    },
    {
      q: 'What happens after the free trial?',
      a: 'Nothing is deleted. If you do not subscribe, your account becomes read-only and your booking page stops taking new bookings. Everything is still there if you come back.',
    },
    {
      q: 'Can I take bookings for both studio classes and mobile parties?',
      a: 'Yes, and they share one schedule. Travel time between them is accounted for, so you cannot be double-booked across town.',
    },
    {
      q: 'Do I need a card to try it?',
      a: 'No. The 14-day trial takes no payment details at all.',
    },
  ],
  cta: CTA,
};

export const PRICING: Page = {
  slug: 'pricing',
  title: 'Pricing — no booking fees, no commission',
  description:
    'Flat monthly pricing from $39. No per-booking fees and no cut of your revenue. 14 days free, no card required.',
  h1: 'Simple pricing. No commission.',
  intro:
    'A flat monthly fee. What your customers pay goes to you — we never take a ' +
    'percentage or a booking fee.',
  sections: [
    {
      heading: 'Why not a percentage?',
      body: [
        'Because it punishes you for growing. A studio taking $4,000 a month ' +
          'through a platform charging 3% is paying $120 for the same software a ' +
          'quieter studio gets for $39.',
        'A flat fee means a good month is a good month for you, not for us.',
      ],
    },
    {
      heading: 'What the trial includes',
      body: [
        'Everything. Fourteen days, no card, no feature held back. If it does ' +
          'not fit how your studio runs, you will know inside a week and you will ' +
          'not have paid anything.',
      ],
    },
  ],
  faqs: [
    {
      q: 'Are there setup fees?',
      a: 'No. There is no setup fee, no onboarding fee and no charge for support.',
    },
    {
      q: 'What if I need more instructors mid-month?',
      a: 'Move up a plan whenever you like. Your existing instructors and bookings are untouched.',
    },
    {
      q: 'Do you charge for text reminders?',
      a: 'Text reminders are included from the Studio plan. Very high volumes are metered, but a typical studio never reaches that.',
    },
  ],
  cta: CTA,
};

/**
 * Competitor comparison pages.
 *
 * Low volume, extremely high intent: somebody searching "Momence alternative"
 * has already decided to leave. The copy is deliberately fair — naming what a
 * competitor genuinely does better is what makes the rest believable, and a
 * studio that switches on a false promise churns in a month anyway.
 */
export const ALTERNATIVES: Page[] = [
  {
    slug: 'alternatives/momence',
    title: 'A Momence alternative for pottery studios',
    description:
      'Momence is built for fitness and wellness. If you run a ceramics studio with wheels, a kiln and mobile parties, here is an alternative built for that.',
    h1: 'Looking for a Momence alternative?',
    intro:
      'Momence is a capable product with a lot in it. It was also built for ' +
      'fitness and wellness studios, and it shows once you try to run a ' +
      'ceramics studio on it.',
    sections: [
      {
        heading: 'What Momence does well',
        body: [
          'Memberships, marketing automation, a large feature surface and an ' +
            'established company behind it. If you run a yoga or pilates studio, ' +
            'it is a reasonable choice and we would not pretend otherwise.',
        ],
      },
      {
        heading: 'Where it fits a pottery studio badly',
        body: [
          'Equipment is not a scheduling concept. You can tell it a class holds ' +
            'eight people, but it does not know you own six wheels, so it will ' +
            'happily sell a ninth seat.',
          'A location is a label. There is no travel radius, no distance-based ' +
            'fee and no travel time between a mobile party and your next studio ' +
            'class.',
          'The price starts well above what a small studio wants to pay for ' +
            'software, and much of what you are paying for is fitness tooling you ' +
            'will never open.',
        ],
      },
      {
        heading: 'What you would get instead',
        body: [
          'Equipment-aware capacity, mobile bookings as a real scheduling ' +
            'constraint, and flat pricing from $39 with no commission.',
          'Less overall. Deliberately — the parts that are here are the parts a ' +
            'ceramics studio uses every day.',
        ],
      },
    ],
    cta: CTA,
  },
  {
    slug: 'alternatives/sawyer',
    title: 'A Sawyer alternative for adult ceramics classes',
    description:
      'Sawyer is built around kids’ activities and parent discovery. If you teach adults at a pottery studio, here is an alternative built for that.',
    h1: 'Looking for a Sawyer alternative?',
    intro:
      'Sawyer is strong at what it is for: children’s classes, camps and ' +
      'the parent marketplace around them.',
    sections: [
      {
        heading: 'Where the fit breaks down',
        body: [
          'The whole model assumes a parent booking for a child. If most of your ' +
            'students are adults booking for themselves, you are working around ' +
            'the product rather than with it.',
          'No concept of equipment, no travel areas for mobile work, and pricing ' +
            'aimed at larger providers than a single-room studio.',
        ],
      },
      {
        heading: 'What you would get instead',
        body: [
          'A booking flow written for an adult booking their own place, ' +
            'equipment-aware capacity, and mobile parties handled properly.',
        ],
      },
    ],
    cta: CTA,
  },
  {
    slug: 'alternatives/punchpass',
    title: 'A Punchpass alternative for pottery studios',
    description:
      'Punchpass is simple and affordable but built around class passes. If you need deposits, mobile bookings and equipment-aware capacity, here is an alternative.',
    h1: 'Looking for a Punchpass alternative?',
    intro:
      'Punchpass is genuinely simple and reasonably priced, which is why so ' +
      'many small studios start there.',
    sections: [
      {
        heading: 'Where studios outgrow it',
        body: [
          'It is built around class passes and attendance. Once you need ' +
            'deposits on a $450 mobile party, a refund ladder you control, or a ' +
            'schedule that knows how many wheels you own, you are past what it ' +
            'was designed to do.',
          'Mobile and travelling work in particular has no real home in it.',
        ],
      },
      {
        heading: 'What you would get instead',
        body: [
          'Deposits and cancellation terms you write yourself, travel areas with ' +
            'distance-based fees, and equipment as a scheduling constraint — ' +
            'while keeping the flat, commission-free pricing you are used to.',
        ],
      },
    ],
    cta: CTA,
  },
];

/**
 * Long-form content.
 *
 * Written for the studio owner, not for a crawler. The test each piece has to
 * pass: would this still be worth reading by somebody who never becomes a
 * customer? If not, it will not earn a link or a ranking either.
 */
export const GUIDES: Page[] = [
  {
    slug: 'guides/pricing-mobile-pottery-parties',
    title: 'How to price a mobile pottery party',
    description:
      'A practical method for pricing mobile pottery parties: your true hourly cost, travel, minimum spend and the deposit that stops no-shows.',
    h1: 'How to price a mobile pottery party',
    intro:
      'Most studios price mobile parties by guessing at a per-head number and ' +
      'quietly losing money on the drive. Here is a method that holds up.',
    article: { published: '2026-08-07', readingMinutes: 7 },
    sections: [
      {
        heading: 'Start from the hours the job actually takes',
        body: [
          'A two-hour party is not a two-hour job. Loading wheels and clay, ' +
            'driving, setting up, running it, packing down, driving back, then ' +
            'unloading and cleaning. A two-hour party is commonly a five to six ' +
            'hour day.',
          'Price against that number. If you want $60 an hour for your time, a ' +
            'two-hour party starts at $300 before materials, before travel, and ' +
            'before the firing you will do next week.',
        ],
      },
      {
        heading: 'Charge for travel separately, and by distance',
        body: [
          'Rolling travel into a per-head price means every local booking ' +
            'subsidises every distant one, and you cannot see which jobs are ' +
            'actually worth taking.',
          'Set bands. Something like: free within 10km, $25 to 25km, $65 to ' +
            '50km, and nothing beyond that. The bands also stop you agreeing to a ' +
            'two-hour drive because somebody asked nicely on a Tuesday.',
        ],
      },
      {
        heading: 'Set a minimum spend, not just a per-head price',
        body: [
          'Six people at $45 is a good Saturday. Three people at $45 is a loss ' +
            'once you have driven there. A minimum spend on the booking — say ' +
            '$400 — protects the floor without punishing larger groups.',
        ],
      },
      {
        heading: 'Take a deposit, and mean it',
        body: [
          'Mobile parties cancel more than studio classes, and they cancel later. ' +
            'A 25% deposit with a clear refund window changes behaviour: people ' +
            'who have paid something turn up, and people who cancel do it early ' +
            'enough for you to rebook.',
          'Write the terms down and apply them consistently. The awkwardness of ' +
            'a policy is far smaller than the awkwardness of deciding case by ' +
            'case in a message thread.',
        ],
      },
      {
        heading: 'Remember the firing',
        body: [
          'Every piece made at that party comes back to your kiln. That is ' +
            'electricity, glaze, shelf space, two firings and your handling time, ' +
            'usually two to three weeks after the money arrived. Build it into ' +
            'the price at the start; it is nearly impossible to add later.',
        ],
      },
    ],
    cta: CTA,
  },
  {
    slug: 'guides/reduce-no-shows-pottery-classes',
    title: 'How to cut no-shows at a pottery class',
    description:
      'No-shows cost a pottery studio more than an empty seat — the clay is bought and the wheel is idle. Five things that actually reduce them.',
    h1: 'How to cut no-shows at a pottery class',
    intro:
      'A no-show at a pottery class costs more than an empty chair. The clay is ' +
      'bought, the wheel sits idle and the seat could have gone to somebody on ' +
      'your waiting list.',
    article: { published: '2026-08-07', readingMinutes: 6 },
    sections: [
      {
        heading: 'Take money at booking',
        body: [
          'This is the single biggest lever, and everything else is a rounding ' +
            'error next to it. A free booking costs nothing to abandon. Even a ' +
            'small deposit changes the decision.',
        ],
      },
      {
        heading: 'Remind them twice, and make cancelling easy',
        body: [
          'One reminder the day before and one on the morning. It sounds ' +
            'counterintuitive, but make cancelling easy in both — a person who ' +
            'cancels at 9am is a seat you can still fill, while a person who ' +
            'silently does not turn up is not.',
          'Text reminders outperform email substantially for this, because they ' +
            'get read.',
        ],
      },
      {
        heading: 'Write a cancellation policy you will actually enforce',
        body: [
          'A policy nobody applies is worse than none, because it teaches people ' +
            'the rules do not matter. Pick terms you are comfortable holding to ' +
            'on a bad day — full refund with 48 hours notice, studio credit ' +
            'inside 24, nothing after that is a common and defensible shape.',
        ],
      },
      {
        heading: 'Offer credit instead of cash for late cancellations',
        body: [
          'It keeps the money in the studio and keeps the relationship. Most ' +
            'people accept credit far more readily than they accept losing the ' +
            'payment entirely, and a good share of that credit gets spent on a ' +
            'more expensive class later.',
        ],
      },
      {
        heading: 'Watch who repeats it',
        body: [
          'A first no-show is life. A third is a pattern. Knowing which is which ' +
            'lets you have a quiet word, or ask for full payment up front, ' +
            'instead of writing off the seat every time.',
        ],
      },
    ],
    cta: CTA,
  },
  {
    slug: 'guides/how-many-wheels-can-you-fill',
    title: 'How many pottery wheels can you actually fill?',
    description:
      'Working out the real capacity of a pottery studio: wheels, kiln throughput, instructor time and the number that actually limits you.',
    h1: 'How many wheels can you actually fill?',
    intro:
      'Studios usually buy another wheel when the real bottleneck is somewhere ' +
      'else entirely. Here is how to find out which constraint is binding.',
    article: { published: '2026-08-07', readingMinutes: 5 },
    sections: [
      {
        heading: 'Four constraints, and only one of them is binding',
        body: [
          'Wheels, kiln throughput, instructor hours and demand. Your capacity is ' +
            'whichever runs out first, and it is very often not the wheels.',
        ],
      },
      {
        heading: 'Kiln throughput is the one people forget',
        body: [
          'Every student produces two to three pieces per class, and every piece ' +
            'needs a bisque firing and a glaze firing. A single kiln doing two ' +
            'firings a week has a hard ceiling on how many pieces can pass ' +
            'through it, whatever the wheel room can seat.',
          'If pieces are waiting two weeks for a shelf, another wheel makes the ' +
            'queue longer, not the revenue larger.',
        ],
      },
      {
        heading: 'Instructor hours are usually the real limit',
        body: [
          'One person can teach perhaps 20 to 25 contact hours a week before ' +
            'quality drops and admin stops getting done. At three-hour classes ' +
            'that is seven or eight classes — and if your room seats six, that is ' +
            'your ceiling regardless of how many wheels you own.',
        ],
      },
      {
        heading: 'Measure before you buy',
        body: [
          'Track the fill rate of the classes you already run. If beginner wheel ' +
            'throwing is selling out in a day and handbuilding is running at 40%, ' +
            'the answer is more of one class, not more equipment.',
          'Buy the wheel when your best-selling class is consistently full AND ' +
            'the kiln can absorb the extra pieces AND somebody is free to teach.',
        ],
      },
    ],
    cta: CTA,
  },
];

export const ALL_PAGES: Page[] = [HOME, PRICING, ...ALTERNATIVES, ...GUIDES];
