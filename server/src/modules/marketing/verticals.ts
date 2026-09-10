/**
 * The landing page, once per kind of business.
 *
 * WHY THIS FILE EXISTS. The scheduling core was never about pottery. Capacity
 * comes from `resources.is_exclusive` and `resources.quantity` — a thing is
 * either counted (eight wheels, twelve kayaks, six press arms) or it is booked
 * alone for the whole job (a kiln, a boat, a CNC). Nothing in the scheduler
 * branches on `resource_type`; it is a label and a search filter. So the
 * product already fits every business below. Only the words were pottery.
 *
 * WHY NOT ONE GENERIC PAGE. "Booking software for pottery studios" converts
 * because it is specific, and a visitor who runs a dive centre does not
 * recognise themselves in "experiences and workshops". One engine, many
 * landing pages: the neutral home explains the constraint, and each vertical
 * page names it in that trade's own nouns. `organizations.signup_landing`
 * already records which page produced a signup, so this is measurable rather
 * than a matter of taste.
 *
 * THE SAME RULE AS content.ts APPLIES, AND HARDER. Nothing here may describe a
 * feature that does not ship today, and the temptation is worse on a page
 * aimed at a trade nobody here has run. Everything claimed below is one of:
 * counted and exclusive resources, travel areas with distance fees, deposits
 * and policy-driven refunds, email and SMS reminders, Google Calendar sync,
 * multi-week courses, attendance, per-service child pricing
 * (`child_price_cents`), a meeting point on the confirmation
 * (`meeting_point`), a skill level, a prerequisite service
 * (`prerequisite_service_type_id`), and padding either side of a booking.
 *
 * WHAT IS DELIBERATELY NOT CLAIMED: waitlists, class packs, piece tracking and
 * kiln loads are in COMING_SOON and stay there. Neither is OTA channel sync —
 * Viator, GetYourGuide, Bókun — which the tour pages must not imply, because
 * an operator who assumes it and finds it missing churns inside a week.
 */

import type { Page } from './content';

/** Maps to the existing `ev-*` classes in landing-css; adds no CSS. */
export type EventKind = 'studio' | 'private' | 'mobile' | 'course';

export type Vertical = {
  /** Route slug. `''` is the neutral home; everything else mounts at /for/x. */
  slug: string;
  /** Full name — the picker card and the page's own eyebrow. */
  name: string;
  /** Short label for nav, footer and the picker grid. */
  navLabel: string;
  /** The hero pill. */
  badge: string;
  /** One line on the picker card. Sentence case, no full stop needed. */
  blurb: string;
  /** Title, description, h1, intro, sections and FAQs. */
  page: Page;

  /**
   * The counted thing, and the capacity claim built on it. This is the whole
   * argument of the page — every vertical below differs here first.
   */
  capacity: {
    /** The dashboard gauge, e.g. "Kayaks out". */
    label: string;
    used: number;
    total: number;
    /** Replaces the first feature card, and heads the "how it runs" split. */
    headline: string;
    body: string;
  };

  /** Step 01 of "how it works" — what setup actually asks for. */
  setupStep: string;

  /** The first comparison row. The other six are true for everyone. */
  compare: { need: string; them: string; us: string };

  /** The dashboard preview. Four days, one or two bookings each. */
  week: {
    dow: string;
    events: { title: string; meta: string; kind: EventKind; state?: 'dim' | 'full' }[];
  }[];

  /** The booking-page card — what their own customers would see. */
  bookingCard: {
    name: string;
    handle: string;
    kind: string;
    bio: string;
    /** Three slots as [label, note]. The third renders sold out. */
    slots: [string, string][];
    deposit: string;
    cta: string;
  };

  /**
   * The geography section. Every business here has one, but it is not the same
   * story twice: some travel to the customer, some need people to find a dock.
   */
  travel: {
    eyebrow: string;
    title: string;
    lede: string;
    body: string;
    flow: [string, string, string];
  };

  /** Overrides COMING_SOON where its pottery nouns would not make sense. */
  comingSoon?: string[];

  footerBlurb: string;
};

const CTA = 'Start free for 14 days. No card needed.';

/**
 * The roadmap in trade-neutral words.
 *
 * Same four unbuilt things as COMING_SOON, which stays as it is for the
 * pottery page. A dive centre reading "kiln loads" learns only that this page
 * was written for somebody else.
 */
const NEUTRAL_COMING_SOON = [
  'Waitlists when a session is full',
  'Class packs and multi-session credits',
  'Make-up sessions for a missed week',
  'Tracking work customers leave with you, with a text when it is ready',
];

// ===========================================================================
// The neutral home
// ===========================================================================

export const GENERAL: Vertical = {
  slug: '',
  name: 'Studios, tours and workshops',
  navLabel: 'Overview',
  badge: 'For studios, tours and workshops',
  blurb: 'The constraint-aware schedule, whatever you run',
  page: {
    slug: '',
    title: 'Booking software for studios, tours and workshops',
    description:
      'Classes, tours and private bookings in one schedule that counts the equipment, boats and people you actually have. No commission. Free for 14 days, no card.',
    h1: 'Booking software built around what you actually own',
    intro:
      'Classes, tours, private sessions and mobile work in one schedule that ' +
      'counts the wheels, kayaks, benches or seats you really have. No booking ' +
      'fees and no commission.',
    sections: [
      {
        heading: 'Capacity is a fact about your business, not a number in a box',
        body: [
          'Most booking software asks how many people fit and takes your word ' +
            'for it. That is fine until two sessions overlap and both quietly ' +
            'claim the same twelve kayaks, the same six benches, the same boat.',
          'Here a resource is either counted — eight wheels means eight people ' +
            'at once — or exclusive, booked alone for the whole job, cool-down ' +
            'and turnaround included. The database enforces it, so a double ' +
            'booking is not something the software has to remember to check.',
        ],
      },
      {
        heading: 'One schedule, whether they come to you or you go to them',
        body: [
          'Set the area you travel to and what you charge by distance. ' +
            'Customers give their address before they pick a time, so a booking ' +
            'you were never going to reach cannot be made in the first place.',
          'Travel time counts against your day. The system will not sell a ' +
            'studio session forty minutes after a job across town.',
        ],
      },
      {
        heading: 'You keep what your customers pay',
        body: [
          'Payments land in your own Stripe account. No booking fees, no ' +
            'commission, no percentage — a flat monthly price from $39 and ' +
            'nothing else.',
          'Deposits, refund ladders and cancellation terms are yours to write, ' +
            'and refunds follow them without you arbitrating a message thread.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Do you take a cut of my bookings?',
        a: 'No. Payments go straight to your own Stripe account. You pay a flat monthly fee and nothing else — no booking fees, no percentage.',
      },
      {
        q: 'My equipment is not on your list. Does that matter?',
        a: 'No. A resource is just a name, a quantity, and whether it can be shared. Kayaks, benches, looms, tanks, easels and vans are all the same two ideas to the scheduler.',
      },
      {
        q: 'Can I run classes, tours and private bookings together?',
        a: 'Yes, in one schedule. Seat-based sessions, one-to-one appointments and multi-week courses are all first-class, and they compete for the same equipment and people.',
      },
      {
        q: 'Do I need a card to try it?',
        a: 'No. The 14-day trial takes no payment details at all.',
      },
    ],
    cta: CTA,
  },
  capacity: {
    label: 'Capacity used',
    used: 6,
    total: 8,
    headline: 'Your equipment is a real constraint',
    body:
      'Eight wheels, twelve kayaks, six press arms — whatever you own, that is ' +
      'the number. Shared kit is counted per person and one-at-a-time kit is ' +
      'blocked for the whole job, so you stop finding conflicts on the day.',
  },
  setupStep:
    'What you own, what you run, what deposit you take, and how far you will ' +
    'travel. That is the entire setup.',
  compare: {
    need: 'Capacity that means equipment',
    them: 'A seat count you type in and hope is right',
    us: 'Sessions are capped by what you physically own',
  },
  week: [
    {
      dow: 'Mon',
      events: [
        { title: 'Beginners class', meta: '6/8 · on site', kind: 'studio' },
        { title: 'Private session', meta: '2 seats', kind: 'private' },
      ],
    },
    {
      dow: 'Tue',
      events: [
        { title: 'On-site booking', meta: '12 km away', kind: 'mobile' },
        { title: 'Workshop', meta: '4/8 · on site', kind: 'studio', state: 'dim' },
      ],
    },
    {
      dow: 'Wed',
      events: [{ title: 'Sunset session', meta: 'Full · 12/12', kind: 'studio', state: 'full' }],
    },
    {
      dow: 'Thu',
      events: [{ title: 'Course · wk 3', meta: '12 enrolled', kind: 'course' }],
    },
  ],
  bookingCard: {
    name: 'Your Studio',
    handle: '@your.studio',
    kind: 'Classes & tours',
    bio: 'Classes, tours &amp; private bookings · Book below ↓',
    slots: [
      ['Thu 18:00', '2 left'],
      ['Sat 10:30', '5 left'],
      ['Sun 14:00', 'Full'],
    ],
    deposit: 'Deposit $15 · balance on the day',
    cta: 'Book now',
  },
  travel: {
    eyebrow: 'On-site work',
    title: 'Going to them is a <em>first-class</em> booking, not a workaround',
    lede:
      'Set the area you travel to and what you charge by distance. Customers ' +
      'enter their address before they choose a time, so an out-of-range ' +
      'booking never gets made in the first place.',
    body:
      'Travel time is subtracted from your day, so the system will not sell ' +
      'you a session forty minutes after a job across town.',
    flow: ['Address entered', 'Inside travel zone · 12 km', 'Pick a date & time'],
  },
  comingSoon: NEUTRAL_COMING_SOON,
  footerBlurb:
    'Booking software for studios, tours and workshops. Built around the ' +
    'equipment, boats and people you actually have — not appointments.',
};

// ===========================================================================
// Makers
// ===========================================================================

const POTTERY: Vertical = {
  slug: 'for/pottery',
  name: 'Pottery & ceramics studios',
  navLabel: 'Pottery studios',
  badge: 'For ceramics studios',
  blurb: 'Wheels counted, kilns blocked, mobile parties in the same schedule',
  page: {
    slug: 'for/pottery',
    title: 'Booking software for pottery studios',
    description:
      'Take class and private lesson bookings online, run mobile pottery parties, and keep every penny your customers pay. Free for 14 days, no card.',
    h1: 'Booking software built for pottery studios',
    intro:
      'Classes, private lessons and mobile parties in one schedule that knows ' +
      'how many wheels you own. No booking fees and no commission.',
    sections: [
      {
        heading: 'Built for how a ceramics studio actually runs',
        body: [
          'Most booking software was built for haircuts or gym classes and then ' +
            'pointed at studios. It treats a location as a text label, capacity ' +
            'as a number you type in, and has no idea a kiln exists.',
          'This one starts from the constraints you actually have: the wheels in ' +
            'the room, the kiln that is running overnight, and the fact that ' +
            'half your work happens at somebody else’s address.',
        ],
      },
      {
        heading: 'Stop answering the same DM forty times a week',
        body: [
          'A booking page you can put in your Instagram bio, showing live ' +
            'availability. Customers book, pay a deposit and get a confirmation ' +
            'without you touching anything.',
          'They can move or cancel their own booking from the link in that ' +
            'email, under the terms you set.',
        ],
      },
      {
        heading: 'Mobile parties are a first-class booking, not a workaround',
        body: [
          'Set the area you travel to and what you charge by distance. ' +
            'Customers enter their address before they choose a time, so an ' +
            'out-of-range booking never gets made in the first place.',
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
  },
  capacity: {
    label: 'Wheels in use',
    used: 6,
    total: 8,
    headline: 'Your kiln and wheels are real constraints',
    body:
      'Eight wheels means eight students — not whatever number you typed into ' +
      'a capacity box. A kiln firing blocks the kiln. The schedule reflects ' +
      'what your studio can physically do, so you stop discovering conflicts ' +
      'on the day.',
  },
  setupStep:
    'How many wheels you own, which classes you run, what deposit you take, ' +
    'and how far you will travel for a party. That is the entire setup.',
  compare: {
    need: 'Capacity that means wheels',
    them: 'A seat count you type in and hope is right',
    us: 'Classes are capped by the wheels in the room',
  },
  week: [
    {
      dow: 'Mon',
      events: [
        { title: 'Wheel throwing', meta: '6/8 · studio', kind: 'studio' },
        { title: 'Hen party', meta: '10 seats', kind: 'private' },
      ],
    },
    {
      dow: 'Tue',
      events: [
        { title: 'Mobile party', meta: '12 km away', kind: 'mobile' },
        { title: 'Handbuilding', meta: '4/8 · studio', kind: 'studio', state: 'dim' },
      ],
    },
    {
      dow: 'Wed',
      events: [{ title: 'Beginners', meta: 'Full · 8/8', kind: 'studio', state: 'full' }],
    },
    {
      dow: 'Thu',
      events: [{ title: 'Course · wk 3', meta: '12 enrolled', kind: 'course' }],
    },
  ],
  bookingCard: {
    name: 'Pottery Workshop',
    handle: '@your.studio',
    kind: 'Ceramics studio',
    bio: 'Hand-thrown classes &amp; mobile parties · Book below ↓',
    slots: [
      ['Thu 18:00', '2 left'],
      ['Sat 10:30', '5 left'],
      ['Sun 14:00', 'Full'],
    ],
    deposit: 'Deposit $15 · balance on the day',
    cta: 'Book a class',
  },
  travel: {
    eyebrow: 'Mobile parties',
    title: 'Mobile parties are a <em>first-class</em> booking, not a workaround',
    lede:
      'Set the area you travel to and what you charge by distance. Customers ' +
      'enter their address before they choose a time, so an out-of-range ' +
      'booking never gets made in the first place.',
    body:
      'Travel time is subtracted from your day, so the system will not sell ' +
      'you a studio class forty minutes after a party across town.',
    flow: ['Address entered', 'Inside travel zone · 12 km', 'Pick a date & time'],
  },
  footerBlurb:
    'Booking software for pottery and ceramics studios. Built around wheels, ' +
    'kilns and people — not appointments.',
};

const GLASS_JEWELRY: Vertical = {
  slug: 'for/glass-and-jewelry',
  name: 'Glass, jewelry & metalsmithing studios',
  navLabel: 'Glass & jewelry',
  badge: 'For glass, jewelry and metal studios',
  blurb: 'Torch stations counted, kilns blocked for the whole cool-down',
  page: {
    slug: 'for/glass-and-jewelry',
    title: 'Booking software for jewelry and glass studios',
    description:
      'Class bookings for jewelry, glass and metalsmithing studios. Torch stations counted per maker, kilns blocked through the cool-down. No commission, 14 days free.',
    h1: 'Booking software for jewelry, glass and metal studios',
    intro:
      'Bench and torch stations counted per maker, kilns booked for the whole ' +
      'cycle, and one schedule for classes, private commissions and studio ' +
      'hire. No booking fees and no commission.',
    sections: [
      {
        heading: 'A bench is not a chair',
        body: [
          'Generic booking tools ask how many people fit in the room. The room ' +
            'is rarely the limit — the eight torch stations are, and so is the ' +
            'one rolling mill everybody needs for twenty minutes.',
          'Each station is counted per seat, so a class of eight is only sold ' +
            'while eight stations are genuinely free. A shared tool that cannot ' +
            'be split is booked alone.',
        ],
      },
      {
        heading: 'The kiln is busy long after the firing stops',
        body: [
          'A casting or annealing cycle occupies the kiln through the cool-down, ' +
            'not just the hours it is drawing power. Schedule over that and ' +
            'somebody opens it early.',
          'An exclusive resource is blocked for its whole span here, cool-down ' +
            'included, and the database refuses the overlap rather than trusting ' +
            'anyone to remember.',
        ],
      },
      {
        heading: 'Beginners and experienced makers, told apart before they book',
        body: [
          'Put a skill level on a class so people self-select, and require an ' +
            'introductory session before an advanced one. Somebody who has not ' +
            'done the prerequisite cannot book the class that needs it.',
          'It saves the awkward email, and it stops a beginner turning up to a ' +
            'session that will not work for them.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can I limit a class by torch stations rather than seats?',
        a: 'Yes. Define the stations as a resource with a quantity, attach it to the class at one per seat, and the class caps itself. Add the rolling mill as an exclusive resource and it will never be double-booked.',
      },
      {
        q: 'Can I run studio hire alongside taught classes?',
        a: 'Yes. Studio hire is an appointment-style booking and taught classes are seat-based, and they compete for the same benches in the same schedule.',
      },
      {
        q: 'Does it track pieces left for firing?',
        a: 'Not yet — that is on the roadmap and deliberately not sold as available. Bookings, capacity, payments and reminders all work today.',
      },
    ],
    cta: CTA,
  },
  capacity: {
    label: 'Torch stations',
    used: 5,
    total: 8,
    headline: 'Stations are counted, kilns are blocked',
    body:
      'Eight torch stations means eight makers. A casting kiln or an annealing ' +
      'oven is booked for the entire cycle — cool-down included — so nobody ' +
      'schedules a class that opens it early.',
  },
  setupStep:
    'How many benches and torch stations you have, your kiln cycles, which ' +
    'classes you run, and the deposit you take. That is the entire setup.',
  compare: {
    need: 'Equipment as a real constraint',
    them: 'A seat count, with the bench rota kept on paper',
    us: 'Stations counted per maker, kilns blocked cycle and cool-down',
  },
  week: [
    {
      dow: 'Mon',
      events: [
        { title: 'Ring making', meta: '5/8 · bench', kind: 'studio' },
        { title: 'Private commission', meta: '1 seat', kind: 'private' },
      ],
    },
    {
      dow: 'Tue',
      events: [
        { title: 'Studio hire', meta: '2 benches', kind: 'mobile' },
        { title: 'Enamelling', meta: '3/8 · bench', kind: 'studio', state: 'dim' },
      ],
    },
    {
      dow: 'Wed',
      events: [{ title: 'Silver stacking', meta: 'Full · 8/8', kind: 'studio', state: 'full' }],
    },
    {
      dow: 'Thu',
      events: [{ title: 'Silversmithing · wk 3', meta: '10 enrolled', kind: 'course' }],
    },
  ],
  bookingCard: {
    name: 'Ember & Ore',
    handle: '@ember.ore',
    kind: 'Jewelry studio',
    bio: 'Ring-making &amp; silversmithing classes · Book below ↓',
    slots: [
      ['Thu 18:30', '2 left'],
      ['Sat 11:00', '4 left'],
      ['Sun 14:00', 'Full'],
    ],
    deposit: 'Deposit $25 · balance on the day',
    cta: 'Book a class',
  },
  travel: {
    eyebrow: 'Off-site work',
    title: 'Hen parties and pop-ups <em>without</em> a second calendar',
    lede:
      'Set the area you will travel to with a torch kit and what you charge by ' +
      'distance. Customers enter the address before they pick a time, so a job ' +
      'you were never going to reach cannot be booked.',
    body:
      'Travel and pack-down time come out of your day, so nothing gets sold ' +
      'into the hour you are still loading the van.',
    flow: ['Address entered', 'Inside travel zone · 12 km', 'Pick a date & time'],
  },
  comingSoon: NEUTRAL_COMING_SOON,
  footerBlurb:
    'Booking software for jewelry, glass and metalsmithing studios. Built ' +
    'around benches, torches and kilns — not appointments.',
};

const WOODWORKING: Vertical = {
  slug: 'for/woodworking',
  name: 'Woodworking studios & makerspaces',
  navLabel: 'Makerspaces',
  badge: 'For woodshops and makerspaces',
  blurb: 'Benches counted, the CNC booked solid, the finishing room to itself',
  page: {
    slug: 'for/woodworking',
    title: 'Booking software for makerspaces and woodworking studios',
    description:
      'Bench hire, inductions and classes in one schedule. Shared benches counted per member, machines like the CNC booked exclusively. No commission, 14 days free.',
    h1: 'Booking software for woodshops and makerspaces',
    intro:
      'Bench hire, inductions and taught classes in one schedule that knows ' +
      'which machines can be shared and which cannot. No booking fees and no ' +
      'commission.',
    sections: [
      {
        heading: 'Some machines are shared. Some are one job at a time.',
        body: [
          'Ten benches is ten makers. One CNC is one job — for its whole run, ' +
            'whether that is forty minutes or six hours. Treating both as "a ' +
            'seat count" is how two members arrive for the same spindle moulder.',
          'Here that difference is the model, not a convention. A counted ' +
            'resource allows overlap up to its quantity; an exclusive one allows ' +
            'none at all, and the database is what enforces it.',
        ],
      },
      {
        heading: 'Inductions before the machine, automatically',
        body: [
          'Make the induction a prerequisite for the machine time. Somebody who ' +
            'has not done it cannot book the slot, so you are not checking a ' +
            'list at the door or trusting a note in the booking.',
          'Skill levels on a class do the softer version of the same job, ' +
            'letting people place themselves before they pay.',
        ],
      },
      {
        heading: 'Clean-down time is part of the booking',
        body: [
          'A three-hour class is not three hours of room. Padding either side ' +
            'of a session is a property of the service, so the schedule stops ' +
            'selling the half hour you spend sweeping.',
          'Multi-week courses sell as one enrolment, and are only offered while ' +
            'every week of the run still has room.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can members book bench time as well as classes?',
        a: 'Yes. Bench hire is an appointment against a counted resource; a taught class is seat-based against the same benches. One schedule, no double-booking between them.',
      },
      {
        q: 'How do I stop the CNC being booked twice?',
        a: 'Mark it exclusive. An exclusive resource takes an allocation over its whole span, and an overlapping booking is refused by a database constraint rather than by application code.',
      },
      {
        q: 'Can I require an induction first?',
        a: 'Yes. Set the induction as the prerequisite service on the machine slot, and it cannot be booked by anyone who has not completed it with you.',
      },
    ],
    cta: CTA,
  },
  capacity: {
    label: 'Benches in use',
    used: 7,
    total: 10,
    headline: 'One CNC is one job at a time',
    body:
      'Benches and lathes are counted per person. A CNC or a finishing room is ' +
      'exclusive — booked for the whole run — so a class cannot be scheduled ' +
      'into a machine that is already cutting.',
  },
  setupStep:
    'Your benches, lathes and machines, which are shared and which are ' +
    'one-at-a-time, and what a session costs. That is the entire setup.',
  compare: {
    need: 'Machines that cannot be shared',
    them: 'A note on the booking, and a clash found on the day',
    us: 'Exclusive machines are blocked for the whole run',
  },
  week: [
    {
      dow: 'Mon',
      events: [
        { title: 'Hand tools', meta: '7/10 · bench', kind: 'studio' },
        { title: 'CNC induction', meta: '1 seat', kind: 'private' },
      ],
    },
    {
      dow: 'Tue',
      events: [
        { title: 'Bench hire', meta: '3 members', kind: 'mobile' },
        { title: 'Spoon carving', meta: '4/10 · bench', kind: 'studio', state: 'dim' },
      ],
    },
    {
      dow: 'Wed',
      events: [{ title: 'Box making', meta: 'Full · 10/10', kind: 'studio', state: 'full' }],
    },
    {
      dow: 'Thu',
      events: [{ title: 'Furniture · wk 5', meta: '9 enrolled', kind: 'course' }],
    },
  ],
  bookingCard: {
    name: 'Sawdust & Co',
    handle: '@sawdust.co',
    kind: 'Makerspace',
    bio: 'Woodworking classes &amp; bench hire · Book below ↓',
    slots: [
      ['Wed 18:00', '3 left'],
      ['Sat 09:30', '5 left'],
      ['Sun 13:00', 'Full'],
    ],
    deposit: 'Deposit $30 · balance on arrival',
    cta: 'Book a bench',
  },
  travel: {
    eyebrow: 'Off-site work',
    title: 'Corporate workshops <em>without</em> a second calendar',
    lede:
      'Set how far you will take a mobile workshop and what you charge by ' +
      'distance. The address is entered before a time is offered, so a job out ' +
      'of range never reaches your diary.',
    body:
      'Loading and travel come out of the same day as your bench sessions, so ' +
      'nothing gets sold into the hours you are on the road.',
    flow: ['Address entered', 'Inside travel zone · 18 km', 'Pick a date & time'],
  },
  comingSoon: NEUTRAL_COMING_SOON,
  footerBlurb:
    'Booking software for makerspaces and woodworking studios. Built around ' +
    'benches, machines and inductions — not appointments.',
};

const PAINT_AND_SIP: Vertical = {
  slug: 'for/paint-and-sip',
  name: 'Paint & sip and paint-your-own studios',
  navLabel: 'Paint & sip',
  badge: 'For paint & sip and PYOP studios',
  blurb: 'Seats, easels and private hire that actually takes the room',
  page: {
    slug: 'for/paint-and-sip',
    title: 'Booking software for paint & sip and paint-your-own studios',
    description:
      'Sell seats at public sessions and private parties from one schedule, with deposits, adult and child pricing, and reminders that cut no-shows. 14 days free.',
    h1: 'Booking software for paint & sip studios',
    intro:
      'Public sessions and private parties in one schedule, with deposits, ' +
      'child pricing and reminders that cut no-shows. No booking fees and no ' +
      'commission.',
    sections: [
      {
        heading: 'A private party takes the room, and the software should know',
        body: [
          'The expensive mistake is a private booking that leaves the public ' +
            'session still on sale for the same evening. Somebody buys a seat at ' +
            'a party they were not invited to, and you refund it by hand.',
          'Book the room as an exclusive resource and the party blocks it. ' +
            'Nothing else can be sold into that slot, because the database will ' +
            'not allow the overlap.',
        ],
      },
      {
        heading: 'Adults and children at different prices, on the same booking',
        body: [
          'A family booking four seats is often two adults and two children. ' +
            'Set a child price on the session and the booking page charges the ' +
            'right total without a phone call or a manual adjustment.',
          'Deposits work the same way: take a fixed amount or a percentage, and ' +
            'let the balance land on the night.',
        ],
      },
      {
        heading: 'No-shows are the whole margin',
        body: [
          'An empty easel is a paid-for canvas and a seat you could have sold. ' +
            'Automatic email and text reminders go out before every session, and ' +
            'the cancel link in them is deliberately easy to use.',
          'A person who cancels at 9am is a seat you can still fill. A person ' +
            'who quietly does not turn up is not.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can I take private party bookings and public seats at once?',
        a: 'Yes. Private hire is a booking against the room itself, so it blocks public sales for that slot. Public sessions sell seat by seat against the same room.',
      },
      {
        q: 'Can I charge children less?',
        a: 'Yes. Each session carries its own child price, and the booking page works out the total from the mix of adults and children.',
      },
      {
        q: 'We fire what people paint. Does that work?',
        a: 'The kiln can be a resource that a firing blocks, so nothing is scheduled into it. Tracking individual pieces through the firing cycle is on the roadmap and not available yet.',
      },
    ],
    cta: CTA,
  },
  capacity: {
    label: 'Easels set',
    used: 16,
    total: 20,
    headline: 'Seats, easels and the room they sit in',
    body:
      'Twenty easels is twenty painters, and a private party takes the whole ' +
      'room. If you fire what people paint, the kiln is a booked resource too, ' +
      'not an afterthought.',
  },
  setupStep:
    'How many seats and easels you set, which sessions you run, whether you ' +
    'take private parties, and the deposit on them. That is the entire setup.',
  compare: {
    need: 'Private hire that takes the room',
    them: 'A booking that leaves the public session on sale',
    us: 'A private party blocks the room; nothing else sells into it',
  },
  week: [
    {
      dow: 'Mon',
      events: [
        { title: 'Sip & paint', meta: '16/20 seats', kind: 'studio' },
        { title: 'Birthday party', meta: 'Room booked', kind: 'private' },
      ],
    },
    {
      dow: 'Tue',
      events: [
        { title: 'Mobile paint party', meta: '18 km away', kind: 'mobile' },
        { title: 'Pottery painting', meta: '7/20 seats', kind: 'studio', state: 'dim' },
      ],
    },
    {
      dow: 'Wed',
      events: [{ title: 'Sip & paint', meta: 'Full · 20/20', kind: 'studio', state: 'full' }],
    },
    {
      dow: 'Thu',
      events: [{ title: 'Acrylics · wk 2', meta: '12 enrolled', kind: 'course' }],
    },
  ],
  bookingCard: {
    name: 'Brush & Bottle',
    handle: '@brush.bottle',
    kind: 'Paint & sip',
    bio: 'BYO wine · two-hour guided sessions · Book below ↓',
    slots: [
      ['Thu 19:00', '4 left'],
      ['Fri 19:00', '1 left'],
      ['Sat 14:00', 'Full'],
    ],
    deposit: 'Deposit $10 · balance on the night',
    cta: 'Book a seat',
  },
  travel: {
    eyebrow: 'Mobile parties',
    title: 'Paint parties at their place, <em>priced by distance</em>',
    lede:
      'Set the area you travel to and what you charge to get there. The ' +
      'address is entered before a time is offered, so an out-of-range party ' +
      'is never booked in the first place.',
    body:
      'Travel time comes out of the same day as your studio sessions, so you ' +
      'cannot be sold into an evening you are still driving back from.',
    flow: ['Address entered', 'Inside travel zone · 18 km', 'Pick a date & time'],
  },
  comingSoon: NEUTRAL_COMING_SOON,
  footerBlurb:
    'Booking software for paint & sip and paint-your-own studios. Built ' +
    'around seats, easels and private hire — not appointments.',
};

const CANDLE: Vertical = {
  slug: 'for/candle-making',
  name: 'Candle, soap & resin studios',
  navLabel: 'Candle & soap',
  badge: 'For candle, soap and resin makers',
  blurb: 'Pour stations counted, cure and collection built into the booking',
  page: {
    slug: 'for/candle-making',
    title: 'Booking software for candle and soap making studios',
    description:
      'Pour-your-own workshops and parties in one schedule. Stations counted per maker, clean-down time built in, deposits and reminders as standard. 14 days free.',
    h1: 'Booking software for candle and soap studios',
    intro:
      'Pour-your-own workshops, hen parties and corporate sessions in one ' +
      'schedule that counts stations rather than chairs. No booking fees and ' +
      'no commission.',
    sections: [
      {
        heading: 'A pour station is not a chair',
        body: [
          'Fourteen stations is fourteen makers, each with a burner, a mould ' +
            'and a bench space. The room might seat twenty; it cannot run twenty.',
          'Attach the stations to the session at one per person and the class ' +
            'caps itself at the real number, whatever you typed anywhere else.',
        ],
      },
      {
        heading: 'The room is not free the moment the session ends',
        body: [
          'Wax has to set, benches have to be scraped, and the next group ' +
            'cannot start into that. Padding after a session is part of the ' +
            'service definition here, so the schedule stops selling the gap you ' +
            'always needed anyway.',
          'It is the difference between a full day and a day that ran forty ' +
            'minutes late from ten in the morning.',
        ],
      },
      {
        heading: 'Tell them when to come back, on the confirmation',
        body: [
          'What people pour is not ready to take home. The collection window ' +
            'goes on the booking confirmation itself, alongside anything else ' +
            'they need to know before they arrive.',
          'Fewer messages asking when it will be ready, and fewer candles ' +
            'sitting on your shelf in March.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can I cap a workshop by pour stations?',
        a: 'Yes. Define the stations as a resource with a quantity and attach them to the workshop at one per seat. The session is only sold while the stations are genuinely free.',
      },
      {
        q: 'Can I build in clean-down time?',
        a: 'Yes. Each service has padding before and after, so a two-hour session can hold two hours forty of the room without you remembering to leave the gap.',
      },
      {
        q: 'Do you handle the collection reminder?',
        a: 'The collection window is shown on the confirmation, and you can write it into the booking instructions. Automatic "your order is ready" tracking is on the roadmap, not available today.',
      },
    ],
    cta: CTA,
  },
  capacity: {
    label: 'Pour stations',
    used: 10,
    total: 14,
    headline: 'A pour station is not a chair',
    body:
      'Fourteen stations is fourteen makers, each with a burner and a mould. ' +
      'And because the room needs scraping down afterwards, that time is part ' +
      'of the booking rather than a gap you keep forgetting to leave.',
  },
  setupStep:
    'How many pour stations you run, your session lengths, the clean-down you ' +
    'need after, and the deposit on a party. That is the entire setup.',
  compare: {
    need: 'Time the room needs after a session',
    them: 'Back-to-back bookings and a rushed clean-down',
    us: 'Padding after a session is part of the service, not a habit',
  },
  week: [
    {
      dow: 'Mon',
      events: [
        { title: 'Candle pouring', meta: '10/14 stations', kind: 'studio' },
        { title: 'Hen party', meta: '14 seats', kind: 'private' },
      ],
    },
    {
      dow: 'Tue',
      events: [
        { title: 'Mobile pour party', meta: '9 km away', kind: 'mobile' },
        { title: 'Soap making', meta: '5/14 stations', kind: 'studio', state: 'dim' },
      ],
    },
    {
      dow: 'Wed',
      events: [{ title: 'Candle pouring', meta: 'Full · 14/14', kind: 'studio', state: 'full' }],
    },
    {
      dow: 'Thu',
      events: [{ title: 'Resin art · wk 2', meta: '8 enrolled', kind: 'course' }],
    },
  ],
  bookingCard: {
    name: 'Wick & Wax',
    handle: '@wick.wax',
    kind: 'Candle studio',
    bio: 'Pour-your-own candles &amp; soaps · Book below ↓',
    slots: [
      ['Thu 18:00', '3 left'],
      ['Sat 11:00', '6 left'],
      ['Sun 15:00', 'Full'],
    ],
    deposit: 'Deposit $15 · collect after 48 hours',
    cta: 'Book a pour',
  },
  travel: {
    eyebrow: 'Mobile parties',
    title: 'Hen parties at their place, <em>priced by distance</em>',
    lede:
      'Set the area you travel to with a pour kit and what you charge to get ' +
      'there. Customers enter the address before choosing a time, so an ' +
      'out-of-range party never gets booked.',
    body:
      'Travel and setup come out of your day, so the system will not sell a ' +
      'studio workshop into the hour you are still unloading wax.',
    flow: ['Address entered', 'Inside travel zone · 9 km', 'Pick a date & time'],
  },
  comingSoon: NEUTRAL_COMING_SOON,
  footerBlurb:
    'Booking software for candle, soap and resin studios. Built around pour ' +
    'stations and the time a room really needs — not appointments.',
};

const SCREEN_PRINTING: Vertical = {
  slug: 'for/screen-printing',
  name: 'Screen printing & weaving studios',
  navLabel: 'Print & textiles',
  badge: 'For print and textile studios',
  blurb: 'Presses and looms counted; the exposure unit booked alone',
  page: {
    slug: 'for/screen-printing',
    title: 'Booking software for screen printing and weaving studios',
    description:
      'Classes and studio hire for print and textile studios. Press arms and looms counted per printer, the exposure unit booked exclusively. No commission, 14 days free.',
    h1: 'Booking software for print and textile studios',
    intro:
      'Classes, studio hire and multi-week courses in one schedule that counts ' +
      'press arms and looms instead of chairs. No booking fees and no ' +
      'commission.',
    sections: [
      {
        heading: 'The press is the class size',
        body: [
          'Six arms on the carousel is six printers, however many people the ' +
            'room holds. A floor loom is one weaver for the entire session — not ' +
            'a seat that two people can rotate through.',
          'Counted kit and exclusive kit are different things in the model, so ' +
            'a class caps itself correctly without you keeping the real numbers ' +
            'in your head.',
        ],
      },
      {
        heading: 'Two screens cannot burn at once',
        body: [
          'The exposure unit is the classic bottleneck: shared by everyone, ' +
            'usable by one. Booked as an exclusive resource, it takes the whole ' +
            'span it needs and nothing overlaps it.',
          'The queue that used to form around it becomes something the schedule ' +
            'refuses to create.',
        ],
      },
      {
        heading: 'Courses that sell as one thing',
        body: [
          'A six-week weaving course is one enrolment, not six bookings. It is ' +
            'only offered while every week of the run still has a loom free, so ' +
            'nobody pays for six weeks and finds week four was full.',
          'Registers are per week, so you can see who has missed which session ' +
            'before they quietly stop coming.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can I cap a class by press arms?',
        a: 'Yes. Add the carousel as a counted resource with the number of arms and attach it at one per seat. The class will not oversell past the equipment.',
      },
      {
        q: 'How do I stop the exposure unit being double-booked?',
        a: 'Mark it exclusive. It then takes an allocation over its whole span, and any overlapping booking is refused by a database constraint.',
      },
      {
        q: 'Can members book studio time between classes?',
        a: 'Yes. Studio hire and taught classes share the same equipment in the same schedule, so one cannot oversell the other.',
      },
    ],
    cta: CTA,
  },
  capacity: {
    label: 'Press arms',
    used: 4,
    total: 6,
    headline: 'Presses and looms are the class size',
    body:
      'Six press arms is six printers. A floor loom is one weaver for the ' +
      'whole session, and the exposure unit is exclusive — booked on its own, ' +
      'because two screens cannot burn at once.',
  },
  setupStep:
    'Your presses, looms and exposure unit, which are shared and which are ' +
    'not, and what a session costs. That is the entire setup.',
  compare: {
    need: 'Equipment that cannot overlap',
    them: 'A seat count, and a queue at the exposure unit',
    us: 'Exclusive kit is blocked; shared kit is counted per printer',
  },
  week: [
    {
      dow: 'Mon',
      events: [
        { title: 'Screen printing', meta: '4/6 · press', kind: 'studio' },
        { title: 'Studio hire', meta: '1 loom', kind: 'private' },
      ],
    },
    {
      dow: 'Tue',
      events: [
        { title: 'Exposure unit', meta: 'Booked alone', kind: 'mobile' },
        { title: 'Weaving', meta: '3/6 · looms', kind: 'studio', state: 'dim' },
      ],
    },
    {
      dow: 'Wed',
      events: [{ title: 'Tote printing', meta: 'Full · 6/6', kind: 'studio', state: 'full' }],
    },
    {
      dow: 'Thu',
      events: [{ title: 'Weaving · wk 4', meta: '7 enrolled', kind: 'course' }],
    },
  ],
  bookingCard: {
    name: 'Press & Thread',
    handle: '@press.thread',
    kind: 'Print studio',
    bio: 'Screen printing &amp; weaving classes · Book below ↓',
    slots: [
      ['Wed 18:30', '2 left'],
      ['Sat 10:00', '4 left'],
      ['Sun 13:30', 'Full'],
    ],
    deposit: 'Deposit $20 · balance in the studio',
    cta: 'Book a session',
  },
  travel: {
    eyebrow: 'Off-site work',
    title: 'Pop-ups and markets, <em>in the same diary</em>',
    lede:
      'Set how far you will take a print kit and what the travel costs. The ' +
      'address is entered before a time is offered, so a booking out of range ' +
      'never reaches you.',
    body:
      'Time on the road comes out of the same day as your studio sessions, so ' +
      'the two cannot be sold over each other.',
    flow: ['Address entered', 'Inside travel zone · 15 km', 'Pick a date & time'],
  },
  comingSoon: NEUTRAL_COMING_SOON,
  footerBlurb:
    'Booking software for screen printing and weaving studios. Built around ' +
    'presses, looms and the exposure unit — not appointments.',
};

// ===========================================================================
// Tours and activities
// ===========================================================================

const KAYAK: Vertical = {
  slug: 'for/kayak-tours',
  name: 'Kayak, paddle & watersports tours',
  navLabel: 'Kayak tours',
  badge: 'For paddle and watersports operators',
  blurb: 'Hulls and boards counted, guides never in two places',
  page: {
    slug: 'for/kayak-tours',
    title: 'Booking software for kayak and paddle tour operators',
    description:
      'Take tour bookings online with the fleet counted properly — doubles, singles and boards — plus guide availability, deposits and pickup zones. 14 days free.',
    h1: 'Booking software for kayak and paddle tours',
    intro:
      'Tours, lessons and private groups in one schedule that counts the hulls ' +
      'on the rack and the guides who can lead them. No booking fees and no ' +
      'commission.',
    sections: [
      {
        heading: 'Twelve kayaks is twelve paddlers',
        body: [
          'Not fourteen because two tours overlap by ten minutes at the ' +
            'turnaround. Doubles, singles and boards are each counted, and a ' +
            'tour is only sold while enough of them are genuinely free.',
          'The fleet stops living on a whiteboard, and the sunrise tour stops ' +
            'being the reason the 9am lesson has no boats.',
        ],
      },
      {
        heading: 'A guide can only lead one group',
        body: [
          'Guides are scheduled with their own working hours and their own ' +
            'calendars, and a two-way Google Calendar sync means a guide’s own ' +
            'commitments block the slot without anyone being told twice.',
          'Assign manually, or let the schedule spread work round-robin across ' +
            'whoever is qualified and free.',
        ],
      },
      {
        heading: 'Where to meet, and what to bring, before they arrive',
        body: [
          'The launch point is rarely the address on the map. A meeting point ' +
            'goes on the confirmation — "the slipway past the car park" — along ' +
            'with what to wear and what you provide.',
          'Deposits hold the booking, reminders go out the day before, and the ' +
            'cancellation terms you wrote are the ones that get applied.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can it stop me overselling the fleet?',
        a: 'Yes. Boats are a counted resource attached to the tour at one per paddler, so two overlapping tours cannot claim the same hulls. The limit is enforced in the database, not by a warning.',
      },
      {
        q: 'Can I charge children less than adults?',
        a: 'Yes. Each tour carries its own child price, and the booking page works the total out from the group.',
      },
      {
        q: 'Do you connect to Viator or GetYourGuide?',
        a: 'No, and we would rather say so plainly than let you find out later. This runs your own direct bookings — your booking page, your customers, your Stripe account. If OTA channel management is what you need, this is not it yet.',
      },
    ],
    cta: CTA,
  },
  capacity: {
    label: 'Kayaks out',
    used: 9,
    total: 12,
    headline: 'The fleet is the capacity',
    body:
      'Twelve kayaks is twelve paddlers — not fourteen because two tours ' +
      'overlap at the turnaround. Doubles, singles and boards are counted ' +
      'separately, and a guide can only ever lead one group.',
  },
  setupStep:
    'How many boats and boards you own, which tours you run, what deposit you ' +
    'take, and how far you will travel for a pickup. That is the entire setup.',
  compare: {
    need: 'Capacity that means boats',
    them: 'A headcount, with the fleet tracked on a whiteboard',
    us: 'A tour is capped by the hulls actually on the rack',
  },
  week: [
    {
      dow: 'Mon',
      events: [
        { title: 'Sunrise paddle', meta: '9/12 · launch', kind: 'studio' },
        { title: 'Private lesson', meta: '2 seats', kind: 'private' },
      ],
    },
    {
      dow: 'Tue',
      events: [
        { title: 'Mangrove tour', meta: 'Pickup · 12 km', kind: 'mobile' },
        { title: 'Intro to SUP', meta: '4/10 · boards', kind: 'studio', state: 'dim' },
      ],
    },
    {
      dow: 'Wed',
      events: [{ title: 'Sunset paddle', meta: 'Full · 12/12', kind: 'studio', state: 'full' }],
    },
    {
      dow: 'Thu',
      events: [{ title: 'Skills course · wk 2', meta: '8 enrolled', kind: 'course' }],
    },
  ],
  bookingCard: {
    name: 'Coastline Kayak',
    handle: '@coastline.kayak',
    kind: 'Kayak tours',
    bio: 'Sunrise &amp; sunset paddles · Book below ↓',
    slots: [
      ['Fri 06:30', '3 left'],
      ['Sat 17:15', '6 left'],
      ['Sun 06:30', 'Full'],
    ],
    deposit: 'Deposit $20 · balance at the launch',
    cta: 'Book a paddle',
  },
  travel: {
    eyebrow: 'Pickups & launches',
    title: 'Pickups priced by distance, <em>checked before</em> the booking',
    lede:
      'Set the stretch of coast you cover and what a pickup costs by distance. ' +
      'The address goes in before a time is offered, so a pickup you were ' +
      'never going to make cannot be booked.',
    body:
      'Driving time comes out of the same day as your launches, so the ' +
      'schedule will not sell a tour you would still be towing a trailer to.',
    flow: ['Pickup address entered', 'Inside pickup zone · 12 km', 'Pick a date & time'],
  },
  comingSoon: NEUTRAL_COMING_SOON,
  footerBlurb:
    'Booking software for kayak, paddle and watersports operators. Built ' +
    'around the fleet and the guides — not appointments.',
};

const BOAT: Vertical = {
  slug: 'for/boat-tours',
  name: 'Boat trips & sunset cruises',
  navLabel: 'Boat & cruises',
  badge: 'For boat and cruise operators',
  blurb: 'One hull, one departure — never sold twice',
  page: {
    slug: 'for/boat-tours',
    title: 'Booking software for boat tours and sunset cruises',
    description:
      'Sell seats and private charters on the same vessel without ever double-booking it. Turnaround time included, deposits, meeting points and reminders. 14 days free.',
    h1: 'Booking software for boat trips and cruises',
    intro:
      'Scheduled departures and private charters on one schedule that blocks ' +
      'the vessel for the whole trip, turnaround included. No booking fees and ' +
      'no commission.',
    sections: [
      {
        heading: 'A boat cannot be in two places',
        body: [
          'The vessel is an exclusive resource: booked for the entire ' +
            'departure, including loading and the turnaround before the next ' +
            'one. A second trip cannot be sold over the top of it.',
          'That is a database constraint rather than a rule the software has to ' +
            'remember, which is why it holds on the busy Saturday as well as the ' +
            'quiet Tuesday.',
        ],
      },
      {
        heading: 'Seats up to the licensed number, and not one more',
        body: [
          'Capacity comes from the hull that is actually running, so swapping a ' +
            'departure onto the smaller boat changes what can be sold rather ' +
            'than leaving you to notice.',
          'Private charters take the whole vessel, which stops the classic ' +
            'mistake: a charter booked while the public sailing is still on sale ' +
            'for the same evening.',
        ],
      },
      {
        heading: 'The dock, on the confirmation',
        body: [
          '"Dock B, blue canopy" is the part a map cannot give somebody, and ' +
            'the part that stops a phone call from the car park ten minutes ' +
            'before you cast off.',
          'It goes on the confirmation with your boarding time, alongside ' +
            'automatic reminders and the cancellation terms you set yourself.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can I run more than one vessel?',
        a: 'Yes. Each is its own exclusive resource with its own capacity, and a departure is tied to the boat that is actually doing it.',
      },
      {
        q: 'Does it handle private charters?',
        a: 'Yes. A charter books the vessel itself, so public seats for that slot stop being sold the moment it is confirmed.',
      },
      {
        q: 'Do you connect to Viator or GetYourGuide?',
        a: 'No. This handles your own direct bookings — your booking page, your customers, payments into your own Stripe account. OTA channel management is not something we do today, and we would rather you knew that now.',
      },
    ],
    cta: CTA,
  },
  capacity: {
    label: 'Seats sold',
    used: 22,
    total: 30,
    headline: 'A boat cannot be in two places',
    body:
      'The vessel is booked for the whole departure — loading, cruise and ' +
      'turnaround — so a second trip cannot be sold over the top of it. Seats ' +
      'are capped by the licensed capacity of that hull, not a number in a box.',
  },
  setupStep:
    'Which vessels you run, their licensed capacity, your departure times, ' +
    'and the deposit on a private charter. That is the entire setup.',
  compare: {
    need: 'Capacity that means a hull',
    them: 'Two calendars, or a spreadsheet for each boat',
    us: 'The vessel is blocked for the departure, turnaround included',
  },
  week: [
    {
      dow: 'Mon',
      events: [
        { title: 'Sunset cruise', meta: '22/30 · Harbour Belle', kind: 'studio' },
        { title: 'Private charter', meta: 'Whole vessel', kind: 'private' },
      ],
    },
    {
      dow: 'Tue',
      events: [
        { title: 'Coastal transfer', meta: 'Second jetty', kind: 'mobile' },
        { title: 'Island hop', meta: '14/30 seats', kind: 'studio', state: 'dim' },
      ],
    },
    {
      dow: 'Wed',
      events: [{ title: 'Sunset cruise', meta: 'Full · 30/30', kind: 'studio', state: 'full' }],
    },
    {
      dow: 'Thu',
      events: [{ title: 'Skipper course · wk 4', meta: '6 enrolled', kind: 'course' }],
    },
  ],
  bookingCard: {
    name: 'Harbour Belle',
    handle: '@harbour.belle',
    kind: 'Sunset cruises',
    bio: 'Two-hour sunset sailings · Book below ↓',
    slots: [
      ['Fri 18:45', '8 left'],
      ['Sat 18:45', '2 left'],
      ['Sun 18:45', 'Full'],
    ],
    deposit: 'Deposit 25% · balance on the dock',
    cta: 'Book a cruise',
  },
  travel: {
    eyebrow: 'Meeting point',
    title: 'They find the dock <em>without</em> phoning you',
    lede:
      'A meeting point is not an address. Put the real instruction on the ' +
      'confirmation — the pontoon, the gate code, the blue canopy — and it ' +
      'travels with the booking to everyone on it.',
    body:
      'Second departure points are locations of their own, each with their own ' +
      'timezone and their own hours, so a cross-water run is not a note in a ' +
      'booking.',
    flow: ['Departure point chosen', 'Boarding time confirmed', 'Meeting point on the ticket'],
  },
  comingSoon: NEUTRAL_COMING_SOON,
  footerBlurb:
    'Booking software for boat tours and sunset cruises. Built around the ' +
    'vessel, the departure and the dock — not appointments.',
};

const WALKING: Vertical = {
  slug: 'for/walking-tours',
  name: 'Walking tours & tastings',
  navLabel: 'Walking tours',
  badge: 'For guides, walking tours and tastings',
  blurb: 'Guide-limited group sizes and a meeting point people can find',
  page: {
    slug: 'for/walking-tours',
    title: 'Booking software for walking tours and tastings',
    description:
      'Small-group walking tours, food and wine tastings, sold from one schedule that knows which guide is free. Deposits, reminders and meeting points. 14 days free.',
    h1: 'Booking software for walking tours and tastings',
    intro:
      'Scheduled walks, private groups and tastings in one schedule that knows ' +
      'which guide is genuinely free. No booking fees and no commission.',
    sections: [
      {
        heading: 'Your ceiling is guides, not group size',
        body: [
          'Two tours that overlap cannot share one guide, however small each ' +
            'group is. The limit that binds is who is free and where they ' +
            'already are — and that is the limit the schedule uses.',
          'Guides carry their own working hours and their own two-way calendar ' +
            'sync, so a guide’s own commitments close the slot without anyone ' +
            'having to tell you.',
        ],
      },
      {
        heading: 'Walking back is part of the tour',
        body: [
          'A ninety-minute walk that ends a mile from where it started is not ' +
            'ninety minutes of that guide. Padding after a booking accounts for ' +
            'the walk back, so the next tour is not sold into it.',
          'The same padding covers the tasting room that needs resetting ' +
            'between sittings.',
        ],
      },
      {
        heading: 'A meeting point beats an address',
        body: [
          '"By the fountain, north side of the square" is what actually gets ' +
            'eighteen people to the same place at the same time. It goes on the ' +
            'confirmation, with whatever else they need to know beforehand.',
          'Reminders go out the day before, and people can move or cancel their ' +
            'own booking under the terms you wrote.',
        ],
      },
    ],
    faqs: [
      {
        q: 'We have no equipment. Is this still for us?',
        a: 'Yes. Your constraint is guides and time rather than kit, and both are first-class here. A tour is only offered while a qualified guide is genuinely free.',
      },
      {
        q: 'Can I run private group bookings alongside scheduled walks?',
        a: 'Yes. A private booking takes the guide, so the public walk that would have used them stops being sold for that slot.',
      },
      {
        q: 'Can I charge children a different price?',
        a: 'Yes. Each tour has its own child price, and the total is worked out from the mix on the booking.',
      },
    ],
    cta: CTA,
  },
  capacity: {
    label: 'Guides booked',
    used: 3,
    total: 4,
    headline: 'A guide can only lead one group',
    body:
      'Your ceiling is not the size of the group, it is how many guides you ' +
      'have and where they already are. Two tours that overlap cannot share ' +
      'one, and the walk back from the end point counts against the next slot.',
  },
  setupStep:
    'Who guides, which tours they lead, your group size, and the exact spot ' +
    'people should meet you. That is the entire setup.',
  compare: {
    need: 'Capacity that means guides',
    them: 'A seat count that ignores who is actually free',
    us: 'A tour is only sold while a guide is genuinely available',
  },
  week: [
    {
      dow: 'Mon',
      events: [
        { title: 'Old Town walk', meta: '14/18 · Mira', kind: 'studio' },
        { title: 'Private group', meta: '8 seats', kind: 'private' },
      ],
    },
    {
      dow: 'Tue',
      events: [
        { title: 'Tasting at their venue', meta: '6 km away', kind: 'mobile' },
        { title: 'Wine tasting', meta: '9/12 seats', kind: 'studio', state: 'dim' },
      ],
    },
    {
      dow: 'Wed',
      events: [{ title: 'Ghost walk', meta: 'Full · 18/18', kind: 'studio', state: 'full' }],
    },
    {
      dow: 'Thu',
      events: [{ title: 'Guide training · wk 2', meta: '5 enrolled', kind: 'course' }],
    },
  ],
  bookingCard: {
    name: 'Old Town Walks',
    handle: '@oldtown.walks',
    kind: 'Walking tours',
    bio: 'Small-group city walks &amp; tastings · Book below ↓',
    slots: [
      ['Fri 10:00', '4 left'],
      ['Sat 10:00', '9 left'],
      ['Sun 15:30', 'Full'],
    ],
    deposit: 'Pay in full · free cancellation to 24h',
    cta: 'Book a walk',
  },
  travel: {
    eyebrow: 'Meeting point',
    title: 'Eighteen people, <em>one</em> place, on time',
    lede:
      'The meeting point goes on the confirmation in the words that actually ' +
      'work — the fountain, the north side, the green door — rather than a pin ' +
      'that drops them across the road.',
    body:
      'And when the tasting comes to them instead, the travel area and its ' +
      'distance fee are checked before a time is ever offered.',
    flow: ['Tour chosen', 'Meeting point on the ticket', 'Reminder the day before'],
  },
  comingSoon: NEUTRAL_COMING_SOON,
  footerBlurb:
    'Booking software for walking tours, food tours and tastings. Built ' +
    'around guides and meeting points — not appointments.',
};

const SCUBA: Vertical = {
  slug: 'for/scuba-diving',
  name: 'Scuba diving & dive centres',
  navLabel: 'Dive centres',
  badge: 'For dive centres and instructors',
  blurb: 'Tanks, boats and ratios that all bind at once',
  page: {
    slug: 'for/scuba-diving',
    title: 'Booking software for dive centres and scuba operators',
    description:
      'Dive and course bookings with tanks, boats and instructor ratios all counted, and prerequisites enforced before the booking rather than on the dock. 14 days free.',
    h1: 'Booking software for dive centres',
    intro:
      'Fun dives, courses and private guiding in one schedule that counts ' +
      'tanks, boats and instructor ratios together. No booking fees and no ' +
      'commission.',
    sections: [
      {
        heading: 'Three limits, and the real one changes daily',
        body: [
          'A dive is capped by filled tanks, by the boat, and by how many ' +
            'divers one instructor may take. Whichever runs out first is your ' +
            'actual capacity, and on a busy weekend it is rarely the same one.',
          'All three are modelled: tanks and gear sets are counted per diver, ' +
            'the boat is exclusive for the whole trip, and instructors have ' +
            'their own availability.',
        ],
      },
      {
        heading: 'Certification checked before the money, not on the dock',
        body: [
          'Make your own Open Water course the prerequisite for the dives that ' +
            'need it. Somebody who has not completed it cannot book the ' +
            'advanced dive at all — the booking is refused before it exists.',
          'A skill level on the listing does the softer version, so people ' +
            'place themselves correctly before they get as far as paying.',
        ],
      },
      {
        heading: 'Courses that run over several days',
        body: [
          'A four-day course sells as one enrolment covering every session, and ' +
            'is only offered while all of them still have a place, a tank and an ' +
            'instructor. Nobody pays for the course and finds day three is full.',
          'The register is per session, so you can see who missed which dive ' +
            'without keeping it on paper.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can I enforce instructor-to-diver ratios?',
        a: 'Yes — as a counted resource on the dive, alongside the tanks. Whichever limit binds first is the one that caps the booking.',
      },
      {
        q: 'Can I require a course before an advanced dive?',
        a: 'Yes. Set the course as the prerequisite service, and the dive cannot be booked by anyone who has not completed it with you. Certifications earned elsewhere still need your own check.',
      },
      {
        q: 'Do you connect to Viator or GetYourGuide?',
        a: 'No. This runs your direct bookings — your page, your customers, your Stripe account. OTA channel management is genuinely not part of this today.',
      },
    ],
    cta: CTA,
  },
  capacity: {
    label: 'Tanks filled',
    used: 14,
    total: 20,
    headline: 'Tanks, boats and ratios all bind at once',
    body:
      'A dive is limited by filled tanks, by the boat, and by how many divers ' +
      'one instructor may take. Whichever runs out first is the real capacity, ' +
      'and it is the one the schedule uses.',
  },
  setupStep:
    'Your tanks and gear sets, which boats you run, your instructor ratios, ' +
    'and which certification each dive requires. That is the entire setup.',
  compare: {
    need: 'Certification checked before booking',
    them: 'A note in the booking, checked at the dock',
    us: 'A dive needing your course is not offered to anyone without it',
  },
  week: [
    {
      dow: 'Mon',
      events: [
        { title: 'Reef dive', meta: '8/12 · two tanks', kind: 'studio' },
        { title: 'Discover Scuba', meta: '4 seats', kind: 'private' },
      ],
    },
    {
      dow: 'Tue',
      events: [
        { title: 'Boat dive', meta: 'Pickup · 12 km', kind: 'mobile' },
        { title: 'Night dive', meta: '6/10 · tanks', kind: 'studio', state: 'dim' },
      ],
    },
    {
      dow: 'Wed',
      events: [{ title: 'Wreck dive', meta: 'Full · 12/12', kind: 'studio', state: 'full' }],
    },
    {
      dow: 'Thu',
      events: [{ title: 'Open Water · day 2', meta: '6 enrolled', kind: 'course' }],
    },
  ],
  bookingCard: {
    name: 'Blue Reef Divers',
    handle: '@bluereef.divers',
    kind: 'Dive centre',
    bio: 'Daily reef &amp; wreck dives · Book below ↓',
    slots: [
      ['Fri 08:00', '4 left'],
      ['Sat 08:00', '6 left'],
      ['Sun 08:00', 'Full'],
    ],
    deposit: 'Deposit $40 · balance at the centre',
    cta: 'Book a dive',
  },
  travel: {
    eyebrow: 'Pickups & sites',
    title: 'Hotel pickups <em>checked</em> before a time is offered',
    lede:
      'Set how far you collect from and what the transfer costs by distance. ' +
      'The address is entered first, so a pickup outside your range is never ' +
      'agreed to in the first place.',
    body:
      'Transfer time comes out of the same day as the dive itself, so the boat ' +
      'is not sold a departure you could not physically make.',
    flow: ['Pickup address entered', 'Inside transfer zone · 12 km', 'Pick a date & time'],
  },
  comingSoon: NEUTRAL_COMING_SOON,
  footerBlurb:
    'Booking software for dive centres and scuba operators. Built around ' +
    'tanks, boats and ratios — not appointments.',
};

/**
 * Order matters: it is the picker grid, the footer column and the sitemap.
 * Pottery leads because it is the one with customers on it.
 */
export const VERTICALS: Vertical[] = [
  POTTERY,
  KAYAK,
  BOAT,
  WALKING,
  SCUBA,
  GLASS_JEWELRY,
  WOODWORKING,
  PAINT_AND_SIP,
  CANDLE,
  SCREEN_PRINTING,
];

/** Every vertical page, plus the home page under its empty slug. */
export const VERTICAL_BY_SLUG = new Map<string, Vertical>([
  [GENERAL.slug, GENERAL],
  ...VERTICALS.map((vertical) => [vertical.slug, vertical] as const),
]);

export const VERTICAL_PAGES: Page[] = VERTICALS.map((vertical) => vertical.page);
