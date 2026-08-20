/* ==========================================================================
   TourFlow — demo dataset
   --------------------------------------------------------------------------
   Everything the prototype knows lives here. The data is GENERATED relative to
   today rather than hard-coded to fixed dates, so the demo never goes stale:
   "today's schedule" is always today. A seeded PRNG keeps it deterministic, so
   two people opening the demo see the same business.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- deterministic pseudo-random ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rnd = mulberry32(20260819);
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function int(min, max) { return Math.floor(rnd() * (max - min + 1)) + min; }
  function chance(p) { return rnd() < p; }

  /* ---------- date helpers (local time, no libraries) ---------- */
  function ymd(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function addDays(base, n) {
    var d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }
  var TODAY = new Date();
  var TODAY_KEY = ymd(TODAY);

  /* ---------- activities ---------- */
  var ACTIVITIES = [
    {
      id: 'act-1', name: 'Kayak Adventure', category: 'Water Sports',
      duration: 120, price: 80, childPrice: 50, capacity: 10, minGuests: 1, maxGuests: 10,
      emoji: '🛶', grad: ['#0ea5e9', '#2563eb'], rating: 4.9, reviews: 412,
      location: 'Harbor Bay Marina', meetingPoint: 'Harbor Entrance, Dock B',
      short: 'Paddle the sheltered bay past sea caves and a resident seal colony.',
      description: 'A guided two-hour paddle through calm harbour waters. Stable sit-on-top kayaks, a short shore briefing, then out past the sea caves and the seal haul-out at Gull Point. No experience needed — our guides run this route several times a day and adjust the pace to the group.',
      highlights: ['Small groups, max 10 paddlers', 'All gear and dry bags included', 'Sea caves and seal colony', 'Photos taken by your guide'],
      days: [1, 2, 3, 4, 5, 6, 0], startTimes: ['08:00', '10:00', '13:00', '15:30'],
      cancellation: 'Free cancellation up to 24 hours before departure. Inside 24 hours the booking is non-refundable, but we will move you to another date once at no charge.',
      instructions: 'Arrive 15 minutes early. Wear clothes that can get wet and bring a change. Sunscreen and water provided.',
      status: 'Active'
    },
    {
      id: 'act-2', name: 'Sunset Boat Tour', category: 'Boat Tour',
      duration: 120, price: 120, childPrice: 70, capacity: 20, minGuests: 2, maxGuests: 20,
      emoji: '⛵', grad: ['#f59e0b', '#dc2626'], rating: 4.8, reviews: 706,
      location: 'Pier 9', meetingPoint: 'Pier 9, Berth 4 (blue canopy)',
      short: 'Golden hour on the water with sparkling wine and the skyline behind you.',
      description: 'Two hours aboard a 42ft catamaran timed to the sunset. A glass of sparkling wine on boarding, a light meze platter, and the run out past the lighthouse as the light goes. Our most-booked evening experience — weekends sell out roughly ten days ahead.',
      highlights: ['Sparkling wine on arrival', 'Licensed captain and crew of two', 'Covered deck and heated cabin', 'Skyline and lighthouse route'],
      days: [1, 2, 3, 4, 5, 6, 0], startTimes: ['17:30', '19:30'],
      cancellation: 'Free cancellation up to 48 hours before sailing. Sailings cancelled by us for weather are always refunded in full.',
      instructions: 'Boarding closes 10 minutes before departure. Flat shoes please — the deck gets slippery.',
      status: 'Active'
    },
    {
      id: 'act-3', name: 'City Walking Tour', category: 'Walking Tour',
      duration: 180, price: 50, childPrice: 25, capacity: 15, minGuests: 1, maxGuests: 15,
      emoji: '🏛️', grad: ['#8b5cf6', '#6366f1'], rating: 4.7, reviews: 1123,
      location: 'Old Town', meetingPoint: 'Fountain Square, under the clock',
      short: 'Three hours through the old quarter with a historian who actually lives there.',
      description: 'The full old-town circuit: the merchant quarter, the covered market, the cathedral crypt and the harbour wall. Our guides are local historians, not scripted actors, and the route bends toward whatever the group finds interesting.',
      highlights: ['Local historian guide', 'Cathedral crypt access included', 'Covered market tasting stop', 'Max 15 people'],
      days: [1, 2, 3, 4, 5, 6], startTimes: ['09:30', '14:00', '16:30'],
      cancellation: 'Free cancellation up to 12 hours before the tour starts.',
      instructions: 'Comfortable shoes — roughly 3km on cobblestones. Runs rain or shine.',
      status: 'Active'
    },
    {
      id: 'act-4', name: 'Wine Tasting Experience', category: 'Food & Wine',
      duration: 120, price: 90, childPrice: 0, capacity: 12, minGuests: 2, maxGuests: 12,
      emoji: '🍷', grad: ['#be185d', '#7c3aed'], rating: 4.9, reviews: 284,
      location: 'Cellar Door, Vine Street', meetingPoint: 'Cellar Door, 14 Vine Street',
      short: 'Six regional pours, a cheese board and a sommelier who tells you the truth.',
      description: 'A seated tasting of six wines from the surrounding valley, poured and talked through by our sommelier, with a board of local cheeses and cured meats. Adults only. Bottles from the tasting are available at cellar-door prices afterwards.',
      highlights: ['Six regional wines', 'Local cheese and charcuterie board', 'Sommelier-led, seated', 'Adults only (21+)'],
      days: [3, 4, 5, 6], startTimes: ['15:00', '18:00'],
      cancellation: 'Free cancellation up to 48 hours before. Inside that window we charge 50%, since the wine is opened for your session.',
      instructions: 'Photo ID required. Please tell us about allergies at least 24 hours ahead.',
      status: 'Active'
    },
    {
      id: 'act-5', name: 'Scuba Diving Experience', category: 'Water Sports',
      duration: 240, price: 180, childPrice: 0, capacity: 8, minGuests: 1, maxGuests: 8,
      emoji: '🤿', grad: ['#0891b2', '#0f766e'], rating: 4.9, reviews: 198,
      location: 'Blue Reef Dive Centre', meetingPoint: 'Blue Reef Dive Centre, Marina Road',
      short: 'A half day and two guided dives on the reef — no certification needed.',
      description: 'A full discover-scuba morning: pool skills session, kit fitting, then two guided shallow dives on the inner reef with a PADI instructor at a 1:4 ratio. Certified divers can skip the pool session and go straight out.',
      highlights: ['PADI instructor, 1:4 ratio', 'All equipment included', 'Two guided reef dives', 'Underwater photos included'],
      days: [1, 3, 5, 6, 0], startTimes: ['08:00', '13:00'],
      cancellation: 'Free cancellation up to 72 hours before. Medical cancellations are always refunded in full.',
      instructions: 'Bring a swimsuit, towel and your medical questionnaire. No flying within 18 hours after diving.',
      status: 'Active'
    },
    {
      id: 'act-6', name: 'Dolphin Watch Cruise', category: 'Boat Tour',
      duration: 150, price: 95, childPrice: 55, capacity: 24, minGuests: 1, maxGuests: 24,
      emoji: '🐬', grad: ['#06b6d4', '#3b82f6'], rating: 4.6, reviews: 533,
      location: 'Pier 9', meetingPoint: 'Pier 9, Berth 2',
      short: 'Out to the feeding grounds with a marine biologist on board.',
      description: 'Two and a half hours to the offshore feeding grounds where the resident bottlenose pod works the tide line. A marine biologist narrates and logs sightings for the regional survey. Sighting rate last season was 94% — if you see nothing, you sail again free.',
      highlights: ['Marine biologist on board', 'Hydrophone audio on deck', 'Free re-sail if no sighting', 'Family friendly'],
      days: [0, 2, 4, 6], startTimes: ['09:00', '12:30'],
      cancellation: 'Free cancellation up to 24 hours before departure.',
      instructions: 'Bring a windproof layer — it is cooler offshore than in the harbour.',
      status: 'Active'
    },
    {
      id: 'act-7', name: 'Deep Sea Fishing Charter', category: 'Fishing',
      duration: 300, price: 220, childPrice: 120, capacity: 6, minGuests: 2, maxGuests: 6,
      emoji: '🎣', grad: ['#1d4ed8', '#0f172a'], rating: 4.8, reviews: 141,
      location: 'Harbor Bay Marina', meetingPoint: 'Harbor Bay Marina, Charter Dock',
      short: 'Five hours offshore for tuna, mahi and whatever the day gives you.',
      description: 'A five-hour offshore charter on a 38ft sportfisher. Rods, tackle, bait and licences are covered; the crew rigs, gaffs and fillets your catch at the dock. Maximum six anglers so everyone gets a rod on the rail.',
      highlights: ['All tackle and licences included', 'Catch cleaned and bagged', 'Six anglers maximum', 'Experienced offshore crew'],
      days: [2, 4, 6, 0], startTimes: ['06:00'],
      cancellation: 'Free cancellation up to 72 hours before. Charters are per-boat, so late cancellations cannot be resold.',
      instructions: 'Bring food, drinks and motion sickness tablets taken an hour before boarding.',
      status: 'Active'
    },
    {
      id: 'act-8', name: 'Escape Room Challenge', category: 'Entertainment',
      duration: 60, price: 35, childPrice: 25, capacity: 6, minGuests: 2, maxGuests: 6,
      emoji: '🔍', grad: ['#7c3aed', '#be185d'], rating: 4.5, reviews: 892,
      location: 'Downtown Studio', meetingPoint: '22 Mill Street, second floor',
      short: 'Sixty minutes to crack the Lighthouse Keeper before the tide comes in.',
      description: 'Our flagship room. You are locked in the lighthouse keeper\'s quarters with sixty minutes to work out what he knew. Physical puzzles, no maths tests, and a game master watching to nudge you if you stall. Escape rate sits around 38%.',
      highlights: ['Private room per booking', 'Game master hints on request', '38% escape rate', 'Great for teams and families'],
      days: [1, 2, 3, 4, 5, 6, 0], startTimes: ['11:00', '13:00', '15:00', '17:00', '19:00'],
      cancellation: 'Free cancellation up to 24 hours before your slot.',
      instructions: 'Arrive 10 minutes early for the briefing. Latecomers lose the time, not the room.',
      status: 'Active'
    },
    {
      id: 'act-9', name: 'Sunrise Paddleboard Yoga', category: 'Wellness',
      duration: 90, price: 65, childPrice: 0, capacity: 12, minGuests: 1, maxGuests: 12,
      emoji: '🧘', grad: ['#f472b6', '#f59e0b'], rating: 4.8, reviews: 167,
      location: 'Still Water Cove', meetingPoint: 'Still Water Cove car park',
      short: 'A floating vinyasa flow at first light on glassy water.',
      description: 'Ninety minutes on the water at sunrise — twenty minutes of paddling out to the cove, a fifty-minute anchored flow on wide stable boards, then a slow paddle back. Falling in is part of it. Boards, anchors and a warm drink afterwards are included.',
      highlights: ['Sunrise start on flat water', 'Wide stable yoga boards', 'All levels welcome', 'Hot drink after the session'],
      days: [2, 4, 6, 0], startTimes: ['06:30'],
      cancellation: 'Free cancellation up to 12 hours before. Cancelled by us for wind — full refund.',
      instructions: 'Swimwear under warm layers. Leave valuables in the car — everything on the board gets wet.',
      status: 'Active'
    },
    {
      id: 'act-10', name: 'Historic Lighthouse Tour', category: 'Walking Tour',
      duration: 90, price: 40, childPrice: 20, capacity: 18, minGuests: 1, maxGuests: 18,
      emoji: '🗼', grad: ['#059669', '#0891b2'], rating: 4.4, reviews: 96,
      location: 'Gull Point', meetingPoint: 'Gull Point visitor gate',
      short: '187 steps, a working Fresnel lens and the best view on the coast.',
      description: 'Guided access to the 1874 lighthouse: the keeper\'s quarters, the machinery room, and the lamp gallery with its original Fresnel lens. Ends on the outer balcony, weather allowing. Being drafted as a seasonal-only listing for next year.',
      highlights: ['Interior access, normally closed', 'Original 1874 Fresnel lens', 'Balcony views along the coast', '187 steps — no lift'],
      days: [5, 6, 0], startTimes: ['11:00', '14:00'],
      cancellation: 'Free cancellation up to 24 hours before.',
      instructions: 'Not suitable for guests with limited mobility. 187 steps, no lift.',
      status: 'Draft'
    }
  ];

  /* ---------- staff ---------- */
  var STAFF = [
    { id: 'stf-1', name: 'Sarah Wilson', role: 'Kayak Guide', email: 'sarah@harboradventures.com', phone: '+1 555 204 8871', status: 'Available', activities: ['act-1', 'act-9'], days: [1,2,3,4,5,6,0], hours: '07:00 – 17:00', completed: 342, rating: 4.9, since: '2023-04-11' },
    { id: 'stf-2', name: 'Mike Johnson', role: 'Boat Captain', email: 'mike@harboradventures.com', phone: '+1 555 204 3312', status: 'Available', activities: ['act-2', 'act-6'], days: [1,2,3,4,5,6,0], hours: '11:00 – 22:00', completed: 511, rating: 4.8, since: '2022-06-02' },
    { id: 'stf-3', name: 'Daniel Smith', role: 'Tour Guide', email: 'daniel@harboradventures.com', phone: '+1 555 204 7745', status: 'On Leave', activities: ['act-3', 'act-10'], days: [1,2,3,4,5], hours: '09:00 – 18:00', completed: 288, rating: 4.7, since: '2023-09-18' },
    { id: 'stf-4', name: 'Elena Rodriguez', role: 'Dive Instructor', email: 'elena@harboradventures.com', phone: '+1 555 204 5590', status: 'Available', activities: ['act-5'], days: [1,3,5,6,0], hours: '07:00 – 16:00', completed: 176, rating: 5.0, since: '2024-02-05' },
    { id: 'stf-5', name: 'Tom Baker', role: 'Fishing Captain', email: 'tom@harboradventures.com', phone: '+1 555 204 1123', status: 'Available', activities: ['act-7'], days: [2,4,6,0], hours: '05:00 – 14:00', completed: 203, rating: 4.8, since: '2021-11-30' },
    { id: 'stf-6', name: 'Priya Nair', role: 'Sommelier', email: 'priya@harboradventures.com', phone: '+1 555 204 6678', status: 'Available', activities: ['act-4'], days: [3,4,5,6], hours: '14:00 – 21:00', completed: 149, rating: 4.9, since: '2024-05-20' },
    { id: 'stf-7', name: 'Chris Okafor', role: 'Adventure Guide', email: 'chris@harboradventures.com', phone: '+1 555 204 9902', status: 'Available', activities: ['act-1', 'act-3', 'act-8', 'act-10'], days: [1,2,3,4,5,6,0], hours: '08:00 – 19:00', completed: 264, rating: 4.7, since: '2023-01-16' },
    { id: 'stf-8', name: 'Nina Petrova', role: 'Experience Host', email: 'nina@harboradventures.com', phone: '+1 555 204 4408', status: 'Part-time', activities: ['act-8', 'act-9'], days: [2,3,4,5,6,0], hours: '10:00 – 20:00', completed: 118, rating: 4.6, since: '2024-08-09' }
  ];

  /* ---------- customers ---------- */
  var CUSTOMER_SEED = [
    ['John Smith', 'john.smith@example.com', '+1 555 123 4567', 'United States'],
    ['Emily Brown', 'emily.brown@example.com', '+1 555 987 6543', 'United States'],
    ['Michael Lee', 'm.lee@example.com', '+1 555 442 1198', 'Canada'],
    ['Sofia Martinez', 'sofia.m@example.com', '+34 612 445 990', 'Spain'],
    ['James O\'Connor', 'james.oc@example.com', '+353 87 221 4455', 'Ireland'],
    ['Aisha Rahman', 'aisha.rahman@example.com', '+44 7700 900321', 'United Kingdom'],
    ['Lucas Meyer', 'lucas.meyer@example.com', '+49 151 2233 4455', 'Germany'],
    ['Grace Kim', 'grace.kim@example.com', '+82 10 5566 7788', 'South Korea'],
    ['Oliver Bennett', 'oliver.b@example.com', '+61 412 556 998', 'Australia'],
    ['Isabella Rossi', 'bella.rossi@example.com', '+39 333 224 5566', 'Italy'],
    ['Noah Andersen', 'noah.a@example.com', '+45 20 44 55 66', 'Denmark'],
    ['Maya Patel', 'maya.patel@example.com', '+1 555 778 2210', 'United States'],
    ['Ethan Clarke', 'ethan.clarke@example.com', '+1 555 331 4477', 'United States'],
    ['Chloe Dubois', 'chloe.d@example.com', '+33 6 12 44 55 66', 'France'],
    ['Ryan Mitchell', 'ryan.mitchell@example.com', '+1 555 660 2299', 'United States'],
    ['Hannah Fischer', 'hannah.f@example.com', '+49 170 998 2211', 'Germany'],
    ['Diego Silva', 'diego.silva@example.com', '+55 11 98877 6655', 'Brazil'],
    ['Amelia Wright', 'amelia.w@example.com', '+44 7700 900654', 'United Kingdom']
  ];

  var CUSTOMERS = CUSTOMER_SEED.map(function (c, i) {
    return {
      id: 'cus-' + (i + 1),
      name: c[0], email: c[1], phone: c[2], country: c[3],
      status: i === 12 ? 'VIP' : (i === 16 ? 'Blocked' : 'Active'),
      notes: i === 0 ? 'Repeat guest. Prefers morning departures and always brings his own camera gear.'
        : (i === 12 ? 'Corporate account — books the escape room for team offsites every quarter. Invoice, do not charge card.' : ''),
      createdAt: ymd(addDays(TODAY, -int(40, 700)))
    };
  });

  /* ---------- schedule (slots) ---------- */
  var schedule = [];
  var slotSeq = 1;
  var DAY_FROM = -14, DAY_TO = 30;

  var BLOCKED = [
    { date: ymd(addDays(TODAY, 6)), reason: 'Annual dock maintenance — no water departures' },
    { date: ymd(addDays(TODAY, 21)), reason: 'Staff training day' }
  ];
  var blockedSet = {};
  BLOCKED.forEach(function (b) { blockedSet[b.date] = true; });

  for (var d = DAY_FROM; d <= DAY_TO; d++) {
    var date = addDays(TODAY, d);
    var key = ymd(date);
    var dow = date.getDay();
    ACTIVITIES.forEach(function (a) {
      if (a.status !== 'Active') return;
      if (a.days.indexOf(dow) === -1) return;
      if (blockedSet[key]) return;
      a.startTimes.forEach(function (t) {
        // Not every possible departure is published — midweek especially.
        // Without this the operator looks like an airline rather than a
        // harbour outfit with a dozen departures a day.
        if (dow > 0 && dow < 5 ? chance(0.34) : chance(0.14)) return;
        var guides = STAFF.filter(function (s) {
          return s.activities.indexOf(a.id) !== -1 && s.status !== 'On Leave' && s.days.indexOf(dow) !== -1;
        });
        var guide = guides.length ? guides[Math.floor(rnd() * guides.length)] : null;
        var hh = parseInt(t.slice(0, 2), 10), mm = parseInt(t.slice(3), 10);
        var endMin = hh * 60 + mm + a.duration;
        schedule.push({
          id: 'slt-' + (slotSeq++),
          activityId: a.id,
          date: key,
          start: t,
          end: String(Math.floor(endMin / 60) % 24).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0'),
          capacity: a.capacity,
          price: (dow === 0 || dow === 6) ? Math.round(a.price * 1.1) : a.price,
          guideId: guide ? guide.id : null,
          status: 'Open'
        });
      });
    });
  }

  /* ---------- bookings ---------- */
  var bookings = [];
  var payments = [];
  var bookingSeq = 10201;
  var txSeq = 90001;
  var METHODS = ['Credit Card', 'Credit Card', 'Credit Card', 'PayPal', 'PayPal', 'Cash', 'Bank Transfer'];
  var SOURCES = ['Website', 'Website', 'Website', 'Widget', 'Admin', 'Viator', 'Tripadvisor'];

  /**
   * @param slot        the departure being filled
   * @param dayOffset   days from today — drives status and payment realism
   * @param seatsFree   hard ceiling; a generated party may never exceed the
   *                    seats actually left, or the demo would open on a
   *                    dashboard showing 133% booked
   */
  function bookSlot(slot, dayOffset, seatsFree) {
    var act = ACTIVITIES.filter(function (a) { return a.id === slot.activityId; })[0];
    var cust = CUSTOMERS[Math.floor(rnd() * CUSTOMERS.length)];
    var adults = int(1, Math.max(1, Math.min(4, act.maxGuests, seatsFree)));
    var children = (act.childPrice > 0 && chance(0.28) && adults < seatsFree)
      ? int(1, Math.min(2, seatsFree - adults)) : 0;
    var amount = adults * slot.price + children * act.childPrice;

    var status, payStatus, paid;
    if (dayOffset < 0) {
      // Past: mostly completed, a few cancellations and no-shows.
      var r = rnd();
      status = r < 0.86 ? 'Completed' : (r < 0.94 ? 'Cancelled' : 'No Show');
      payStatus = status === 'Cancelled' ? (chance(0.6) ? 'Refunded' : 'Paid') : 'Paid';
    } else if (dayOffset === 0) {
      status = chance(0.92) ? 'Confirmed' : 'Pending';
      payStatus = status === 'Pending' ? 'Pending' : (chance(0.08) ? 'Partially Paid' : 'Paid');
    } else {
      var r2 = rnd();
      status = r2 < 0.9 ? 'Confirmed' : (r2 < 0.96 ? 'Pending' : 'Cancelled');
      payStatus = status === 'Pending' ? 'Pending'
        : status === 'Cancelled' ? (chance(0.5) ? 'Refunded' : 'Paid')
        : (chance(0.09) ? 'Partially Paid' : 'Paid');
    }
    paid = payStatus === 'Paid' ? amount
      : payStatus === 'Partially Paid' ? Math.round(amount * 0.25)
      : payStatus === 'Refunded' ? 0 : 0;

    var id = 'TF-' + (bookingSeq++);
    var createdOffset = dayOffset - int(1, 20);
    var booking = {
      id: id,
      customerId: cust.id,
      activityId: act.id,
      slotId: slot.id,
      date: slot.date,
      time: slot.start,
      adults: adults,
      children: children,
      guests: adults + children,
      amount: amount,
      paid: paid,
      paymentStatus: payStatus,
      paymentMethod: pick(METHODS),
      status: status,
      guideId: slot.guideId,
      source: pick(SOURCES),
      waiver: status === 'Pending' ? chance(0.3) : chance(0.88),
      notes: chance(0.14) ? pick([
        'Celebrating a birthday — bringing a cake.',
        'One guest is a nervous swimmer, please pair with the guide.',
        'Requested vegetarian option.',
        'Arriving directly from the airport, may be 5 minutes late.',
        'Group would like photos at the end.'
      ]) : '',
      createdAt: ymd(addDays(TODAY, createdOffset))
    };
    bookings.push(booking);

    // Matching payment ledger rows.
    if (payStatus !== 'Pending') {
      payments.push({
        id: 'TXN-' + (txSeq++),
        bookingId: id,
        customerId: cust.id,
        amount: payStatus === 'Partially Paid' ? Math.round(amount * 0.25) : amount,
        method: booking.paymentMethod,
        type: payStatus === 'Partially Paid' ? 'Deposit' : 'Full Payment',
        date: booking.createdAt,
        status: 'Succeeded'
      });
    }
    if (payStatus === 'Refunded') {
      payments.push({
        id: 'TXN-' + (txSeq++),
        bookingId: id,
        customerId: cust.id,
        amount: -amount,
        method: booking.paymentMethod,
        type: 'Refund',
        date: ymd(addDays(TODAY, Math.min(0, dayOffset - 1))),
        status: 'Refunded'
      });
    }
    return booking;
  }

  schedule.forEach(function (slot) {
    var dayOffset = Math.round(
      (new Date(slot.date + 'T00:00:00') - new Date(TODAY_KEY + 'T00:00:00')) / 86400000
    );
    // How busy a slot gets: today and the near future look healthy, further
    // out is thinner — which is what a real booking curve looks like.
    var fill = dayOffset < 0 ? 0.62 : dayOffset === 0 ? 0.6 : dayOffset < 7 ? 0.45 : dayOffset < 18 ? 0.28 : 0.14;
    var target = Math.min(slot.capacity, Math.round(slot.capacity * fill * (0.6 + rnd() * 0.8)));
    var placed = 0, guard = 0;
    while (placed < target && guard++ < 12) {
      var free = slot.capacity - placed;
      if (free < 1) break;
      var b = bookSlot(slot, dayOffset, free);
      if (b.status !== 'Cancelled') placed += b.guests;
    }
  });

  /* ---------- notifications ---------- */
  var NOTIFICATIONS = [
    { id: 'ntf-1', name: 'Booking Confirmation', trigger: 'Immediately after booking', channel: 'Email + SMS', status: 'Active', lastSent: '4 minutes ago', sent30d: 486,
      template: 'Hi {{customer_name}}, your booking for {{activity}} on {{date}} at {{time}} is confirmed. Booking reference {{booking_id}}. Meeting point: {{meeting_point}}. See you there!' },
    { id: 'ntf-2', name: 'Payment Receipt', trigger: 'When a payment succeeds', channel: 'Email', status: 'Active', lastSent: '4 minutes ago', sent30d: 471,
      template: 'Thanks {{customer_name}} — we received {{amount}} for booking {{booking_id}}. This email is your receipt.' },
    { id: 'ntf-3', name: 'Booking Reminder', trigger: '24 hours before the activity', channel: 'Email + SMS', status: 'Active', lastSent: '2 hours ago', sent30d: 402,
      template: 'Reminder: {{activity}} is tomorrow at {{time}}. Meet at {{meeting_point}} 15 minutes early. Reply STOP to opt out.' },
    { id: 'ntf-4', name: 'Waiver Reminder', trigger: '48 hours before, if the waiver is unsigned', channel: 'Email', status: 'Active', lastSent: '6 hours ago', sent30d: 88,
      template: 'Hi {{customer_name}}, we still need a signed waiver for {{activity}} on {{date}}. It takes about a minute: {{waiver_link}}' },
    { id: 'ntf-5', name: 'Cancellation Notice', trigger: 'When a booking is cancelled', channel: 'Email', status: 'Active', lastSent: 'Yesterday', sent30d: 34,
      template: 'Your booking {{booking_id}} for {{activity}} on {{date}} has been cancelled. Any refund due will appear within 5–10 business days.' },
    { id: 'ntf-6', name: 'Reschedule Confirmation', trigger: 'When a booking moves date or time', channel: 'Email + SMS', status: 'Active', lastSent: '3 days ago', sent30d: 27,
      template: 'Your booking {{booking_id}} has moved to {{date}} at {{time}}. Everything else stays the same.' },
    { id: 'ntf-7', name: 'Review Request', trigger: '24 hours after the activity finishes', channel: 'Email', status: 'Paused', lastSent: '12 days ago', sent30d: 0,
      template: 'Hope you enjoyed {{activity}}, {{customer_name}}. A one-line review helps other travellers find us: {{review_link}}' },
    { id: 'ntf-8', name: 'Weather Warning', trigger: 'Manually, per departure', channel: 'SMS', status: 'Paused', lastSent: '5 weeks ago', sent30d: 0,
      template: 'Heads up — the forecast for {{date}} looks marginal for {{activity}}. We will confirm by 6pm the night before.' }
  ];

  /* ---------- integrations ---------- */
  var INTEGRATIONS = [
    { id: 'int-1', name: 'Google Things to Do', cat: 'Distribution', desc: 'Show your activities directly in Google Search and Maps results.', status: 'Connected', letter: 'G', color: '#4285f4', meta: 'Feed refreshed 18 minutes ago · 9 activities live' },
    { id: 'int-2', name: 'Viator', cat: 'Distribution', desc: 'Sync activities and live availability to the Viator marketplace.', status: 'Connected', letter: 'V', color: '#00a680', meta: '38 bookings this month · 12% commission' },
    { id: 'int-3', name: 'Tripadvisor', cat: 'Distribution', desc: 'Push availability and pull reviews into your listing.', status: 'Connected', letter: 'T', color: '#34e0a1', meta: '4.8 average from 1,204 reviews' },
    { id: 'int-4', name: 'GetYourGuide', cat: 'Distribution', desc: 'List your experiences on GetYourGuide with live inventory.', status: 'Disconnected', letter: 'G', color: '#ff5533', meta: 'Not connected' },
    { id: 'int-5', name: 'Google Calendar', cat: 'Operations', desc: 'Mirror every departure onto your guides\' calendars.', status: 'Connected', letter: 'C', color: '#1a73e8', meta: 'Last sync 2 minutes ago · healthy' },
    { id: 'int-6', name: 'Stripe', cat: 'Payments', desc: 'Card payments, deposits and refunds, settled to your bank.', status: 'Connected', letter: 'S', color: '#635bff', meta: 'Payouts daily · next payout tomorrow' },
    { id: 'int-7', name: 'PayPal', cat: 'Payments', desc: 'Let guests check out with a PayPal balance or account.', status: 'Connected', letter: 'P', color: '#0070ba', meta: '14% of checkouts this month' },
    { id: 'int-8', name: 'Mailchimp', cat: 'Marketing', desc: 'Sync guests into audiences and trigger post-trip campaigns.', status: 'Disconnected', letter: 'M', color: '#ffe01b', meta: 'Not connected' },
    { id: 'int-9', name: 'Twilio SMS', cat: 'Messaging', desc: 'Send reminders and departure changes by text message.', status: 'Connected', letter: 'T', color: '#f22f46', meta: '1,204 messages sent this month' },
    { id: 'int-10', name: 'Zapier', cat: 'Automation', desc: 'Connect TourFlow to 6,000+ apps without writing code.', status: 'Disconnected', letter: 'Z', color: '#ff4a00', meta: 'Not connected' },
    { id: 'int-11', name: 'QuickBooks', cat: 'Finance', desc: 'Post daily revenue and refunds straight into your ledger.', status: 'Disconnected', letter: 'Q', color: '#2ca01c', meta: 'Not connected' },
    { id: 'int-12', name: 'Klaviyo', cat: 'Marketing', desc: 'Behavioural email flows built on your booking data.', status: 'Disconnected', letter: 'K', color: '#000000', meta: 'Not connected' }
  ];

  /* ---------- users, roles, permissions ---------- */
  var PERMISSIONS = [
    'View Bookings', 'Create Booking', 'Edit Booking', 'Cancel Booking',
    'View Payments', 'Issue Refunds', 'View Reports', 'Manage Activities',
    'Manage Staff', 'Manage Settings'
  ];
  var ROLES = [
    { id: 'rol-1', name: 'Owner', desc: 'Full access, including billing and account deletion.', locked: true,
      perms: { 'View Bookings': 1, 'Create Booking': 1, 'Edit Booking': 1, 'Cancel Booking': 1, 'View Payments': 1, 'Issue Refunds': 1, 'View Reports': 1, 'Manage Activities': 1, 'Manage Staff': 1, 'Manage Settings': 1 } },
    { id: 'rol-2', name: 'Admin', desc: 'Everything except billing and account deletion.', locked: false,
      perms: { 'View Bookings': 1, 'Create Booking': 1, 'Edit Booking': 1, 'Cancel Booking': 1, 'View Payments': 1, 'Issue Refunds': 1, 'View Reports': 1, 'Manage Activities': 1, 'Manage Staff': 1, 'Manage Settings': 0 } },
    { id: 'rol-3', name: 'Manager', desc: 'Runs the day: bookings, schedule and staff.', locked: false,
      perms: { 'View Bookings': 1, 'Create Booking': 1, 'Edit Booking': 1, 'Cancel Booking': 1, 'View Payments': 1, 'Issue Refunds': 0, 'View Reports': 1, 'Manage Activities': 1, 'Manage Staff': 1, 'Manage Settings': 0 } },
    { id: 'rol-4', name: 'Guide', desc: 'Sees their own departures and the daily manifest.', locked: false,
      perms: { 'View Bookings': 1, 'Create Booking': 0, 'Edit Booking': 0, 'Cancel Booking': 0, 'View Payments': 0, 'Issue Refunds': 0, 'View Reports': 0, 'Manage Activities': 0, 'Manage Staff': 0, 'Manage Settings': 0 } },
    { id: 'rol-5', name: 'Front Desk', desc: 'Takes walk-ins and handles arrivals.', locked: false,
      perms: { 'View Bookings': 1, 'Create Booking': 1, 'Edit Booking': 1, 'Cancel Booking': 0, 'View Payments': 1, 'Issue Refunds': 0, 'View Reports': 0, 'Manage Activities': 0, 'Manage Staff': 0, 'Manage Settings': 0 } }
  ];
  var USERS = [
    { id: 'usr-1', name: 'Alex Rivera', email: 'alex@harboradventures.com', role: 'Owner', status: 'Active', lastActive: 'Now' },
    { id: 'usr-2', name: 'Sarah Wilson', email: 'sarah@harboradventures.com', role: 'Manager', status: 'Active', lastActive: '20 minutes ago' },
    { id: 'usr-3', name: 'Mike Johnson', email: 'mike@harboradventures.com', role: 'Guide', status: 'Active', lastActive: '2 hours ago' },
    { id: 'usr-4', name: 'Priya Nair', email: 'priya@harboradventures.com', role: 'Front Desk', status: 'Active', lastActive: 'Yesterday' },
    { id: 'usr-5', name: 'Daniel Smith', email: 'daniel@harboradventures.com', role: 'Guide', status: 'Suspended', lastActive: '3 weeks ago' }
  ];

  /* ---------- settings ---------- */
  var SETTINGS = {
    business: {
      name: 'Harbor Adventures',
      legalName: 'Harbor Adventures LLC',
      email: 'hello@harboradventures.com',
      phone: '+1 555 010 2200',
      address: '18 Harbor Bay Marina, Newport, RI 02840',
      website: 'https://harboradventures.example',
      type: 'Tour & Activity Operator',
      currency: 'USD',
      timezone: 'America/New_York',
      dateFormat: 'MMM D, YYYY',
      timeFormat: '12h'
    },
    booking: {
      minNoticeHours: 2,
      maxAdvanceDays: 365,
      allowSameDay: true,
      autoConfirm: true,
      requireWaiver: true,
      requirePhone: true,
      allowChildren: true,
      holdMinutes: 15,
      overbookBuffer: 0
    },
    payments: {
      gateway: 'Stripe',
      depositEnabled: true,
      depositPercent: 25,
      payLater: true,
      cashOnArrival: true,
      currency: 'USD',
      taxRate: 7,
      taxLabel: 'Sales Tax',
      taxIncluded: false,
      serviceFee: 0
    },
    cancellation: {
      policy: 'Flexible',
      freeUntilHours: 24,
      lateFeePercent: 50,
      noShowFeePercent: 100,
      text: 'Free cancellation up to 24 hours before your activity starts. Cancellations inside 24 hours are charged 50%. No-shows are charged in full.'
    },
    email: { fromName: 'Harbor Adventures', fromEmail: 'bookings@harboradventures.com', replyTo: 'hello@harboradventures.com', footer: 'Harbor Adventures · 18 Harbor Bay Marina, Newport RI · +1 555 010 2200', bcc: '' },
    sms: { enabled: true, senderId: 'HARBOR', quietFrom: '21:00', quietTo: '08:00', provider: 'Twilio' },
    website: {
      siteName: 'TourFlow Adventures',
      tagline: 'Book Your Next Adventure',
      heroSubtitle: 'Kayaks, sunsets, reefs and old town alleys — every experience we run, bookable in under a minute.',
      primaryColor: '#4f46e5',
      accentColor: '#0ea5e9',
      published: true,
      domain: 'book.harboradventures.example',
      contactEmail: 'hello@harboradventures.com',
      contactPhone: '+1 555 010 2200',
      seoTitle: 'Harbor Adventures — Tours & Experiences in Newport',
      seoDescription: 'Kayak tours, sunset cruises, scuba, wine tastings and walking tours in Newport. Instant confirmation, free cancellation up to 24 hours.',
      pages: [
        { name: 'Home', path: '/', status: 'Published', views30d: 12840 },
        { name: 'Activities', path: '/activities', status: 'Published', views30d: 9317 },
        { name: 'About', path: '/about', status: 'Published', views30d: 1204 },
        { name: 'Contact', path: '/contact', status: 'Published', views30d: 882 },
        { name: 'Booking', path: '/book', status: 'Published', views30d: 6603 },
        { name: 'Gift Cards', path: '/gift-cards', status: 'Draft', views30d: 0 }
      ]
    },
    widget: {
      theme: 'Light',
      primaryColor: '#4f46e5',
      corner: 'Rounded',
      showPrices: true,
      showRatings: true,
      defaultActivity: 'act-1',
      buttonText: 'Book Now'
    }
  };

  var CALENDAR_SYNC = {
    provider: 'Google Calendar',
    account: 'alex@harboradventures.com',
    status: 'Healthy',
    lastSync: '2 minutes ago',
    direction: 'Two-way',
    calendars: [
      { name: 'Harbor Adventures — Departures', events: 184, status: 'Syncing' },
      { name: 'Sarah Wilson (guide)', events: 42, status: 'Syncing' },
      { name: 'Mike Johnson (guide)', events: 37, status: 'Syncing' },
      { name: 'Personal — Alex', events: 0, status: 'Ignored' }
    ]
  };

  /* ---------- exported seed ---------- */
  global.TFData = {
    version: 5,
    today: TODAY_KEY,
    seed: function () {
      return {
        version: 5,
        generatedFor: TODAY_KEY,
        activities: JSON.parse(JSON.stringify(ACTIVITIES)),
        staff: JSON.parse(JSON.stringify(STAFF)),
        customers: JSON.parse(JSON.stringify(CUSTOMERS)),
        schedule: JSON.parse(JSON.stringify(schedule)),
        blocked: JSON.parse(JSON.stringify(BLOCKED)),
        bookings: JSON.parse(JSON.stringify(bookings)),
        payments: JSON.parse(JSON.stringify(payments)),
        notifications: JSON.parse(JSON.stringify(NOTIFICATIONS)),
        integrations: JSON.parse(JSON.stringify(INTEGRATIONS)),
        roles: JSON.parse(JSON.stringify(ROLES)),
        permissions: PERMISSIONS.slice(),
        users: JSON.parse(JSON.stringify(USERS)),
        settings: JSON.parse(JSON.stringify(SETTINGS)),
        calendarSync: JSON.parse(JSON.stringify(CALENDAR_SYNC)),
        activityLog: [],
        counters: { booking: bookingSeq, tx: txSeq, slot: slotSeq }
      };
    }
  };
})(window);
