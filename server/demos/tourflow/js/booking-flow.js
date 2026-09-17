/* ==========================================================================
   TourFlow — customer booking site
   The storefront and the seven-step booking flow. It reads the SAME state as
   the admin app, so availability is real: a seat sold here disappears from
   the operator's capacity, and the booking shows up in their dashboard.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  var STEPS = ['Date', 'Time', 'Guests', 'Details', 'Waiver', 'Payment', 'Done'];
  var flow = null;      // active booking flow state
  var calMonth = null;  // month cursor in the step-1 calendar
  var filters = { q: '', category: '', date: '' };

  /* ================================================================ boot */
  function boot() {
    applyTheme();
    render();
    global.addEventListener('hashchange', render);
  }

  function applyTheme() {
    var w = TF.state().settings.website;
    document.documentElement.style.setProperty('--site-primary', w.primaryColor);
    document.documentElement.style.setProperty('--site-accent', w.accentColor);
    document.title = w.seoTitle;
  }

  function go(hash) {
    if (global.location.hash === hash) render();
    else global.location.hash = hash;
  }

  function route() {
    var h = (global.location.hash || '#/').replace(/^#\/?/, '');
    var parts = h.split('/');
    return { name: parts[0] || 'home', id: parts[1] || null };
  }

  /* ============================================================== render */
  function render() {
    var r = route();
    var host = document.getElementById('site');
    var w = TF.state().settings.website;

    var main =
      r.name === 'a' ? detailPage(r.id) :
      r.name === 'book' ? bookPage(r.id) :
      r.name === 'confirm' ? confirmPage(r.id) :
      r.name === 'activities' ? activitiesPage() :
      r.name === 'about' ? aboutPage() :
      r.name === 'contact' ? contactPage() : homePage();

    host.innerHTML = ribbon() + header(w, r.name) + '<main>' + main + '</main>' + footer(w);
    global.scrollTo(0, 0);
    wire(host);
  }

  function ribbon() {
    return '<div class="demo-ribbon">Demo mode — no real payments are taken. ' +
      '<a href="admin.html">Open the operator dashboard →</a></div>';
  }

  function header(w, active) {
    var links = [['home', 'Home', '#/'], ['activities', 'Activities', '#/activities'],
      ['about', 'About', '#/about'], ['contact', 'Contact', '#/contact']];
    return '<header class="cust-header"><div class="cust-header-inner">' +
      '<a class="cust-brand" href="#/"><span class="mark">' +
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 17l6-11 5 8 3-4 4 7z"/><circle cx="8" cy="5" r="1.6"/></svg></span>' +
        TF.esc(w.siteName) + '</a>' +
      '<nav class="cust-nav-links">' + links.map(function (l) {
        return '<a href="' + l[2] + '" class="' + (active === l[0] ? 'on' : '') + '">' + l[1] + '</a>';
      }).join('') + '</nav>' +
      '<div class="right">' +
        '<span class="small muted hide-sm">' + TF.icon('phone', 14) + ' ' + TF.esc(w.contactPhone) + '</span>' +
        '<a class="btn btn-site btn-sm" href="#/activities">Book now</a>' +
        '<button class="cust-burger" id="custBurger" aria-label="Menu">' + TF.icon('menu') + '</button>' +
      '</div></div>' +
      '<div class="cust-mobile-menu" id="custMobile">' + links.map(function (l) {
        return '<a href="' + l[2] + '">' + l[1] + '</a>';
      }).join('') + '</div></header>';
  }

  function footer(w) {
    return '<footer class="cust-footer"><div class="cust-foot-grid">' +
      '<div><b style="color:#fff;font-size:16px">' + TF.esc(w.siteName) + '</b>' +
        '<p>' + TF.esc(w.heroSubtitle) + '</p>' +
        '<p style="margin-top:10px">' + TF.esc(TF.state().settings.business.address) + '</p></div>' +
      '<div><h4>Experiences</h4>' + TF.state().activities.filter(function (a) { return a.status === 'Active'; })
        .slice(0, 5).map(function (a) {
          return '<a href="#/a/' + a.id + '">' + TF.esc(a.name) + '</a>';
        }).join('') + '</div>' +
      '<div><h4>Company</h4><a href="#/about">About us</a><a href="#/contact">Contact</a>' +
        '<a href="#/activities">All activities</a><a href="admin.html">Operator login</a></div>' +
      '<div><h4>Get in touch</h4><p>' + TF.esc(w.contactEmail) + '</p><p>' + TF.esc(w.contactPhone) + '</p>' +
        '<p style="margin-top:8px">Open daily 7am – 9pm</p></div>' +
      '</div>' +
      '<div class="foot-bottom"><span>© ' + new Date().getFullYear() + ' ' + TF.esc(w.siteName) +
        '. A TourFlow demo — every booking, price and review here is fictional.</span>' +
        '<span>Powered by TourFlow</span></div></footer>';
  }

  /* =============================================================== home */
  function homePage() {
    var w = TF.state().settings.website;
    var acts = liveActivities();
    var guests = TF.state().bookings.filter(function (b) { return b.status !== 'Cancelled'; })
      .reduce(function (n, b) { return n + b.guests; }, 0);
    var avg = acts.reduce(function (n, a) { return n + a.rating; }, 0) / (acts.length || 1);

    return '<section class="cust-hero"><div class="cust-hero-inner">' +
        '<span class="hero-badge">' + TF.icon('anchor', 14) + ' ' + TF.esc(TF.state().settings.business.name) + '</span>' +
        '<h1>' + TF.esc(w.tagline) + '</h1>' +
        '<p class="lede">' + TF.esc(w.heroSubtitle) + '</p>' +
        '<div class="search-panel">' +
          '<div class="sp-field"><label>What</label>' +
            '<input id="hSearch" placeholder="Kayak, sunset, wine…" value="' + TF.esc(filters.q) + '"></div>' +
          '<div class="sp-field"><label>Category</label><select id="hCat"><option value="">Anything</option>' +
            TF.options(categories(), filters.category) + '</select></div>' +
          '<div class="sp-field"><label>When</label><input id="hDate" type="date" value="' + TF.esc(filters.date) + '"></div>' +
          '<button class="btn btn-site btn-lg" id="hGo" style="flex:0 0 auto">' + TF.icon('search') + ' Search</button>' +
        '</div>' +
        '<div class="hero-stats">' +
          '<div class="hs"><b>' + acts.length + '</b><span>experiences</span></div>' +
          '<div class="hs"><b>' + TF.fmt.num(guests) + '</b><span>guests hosted</span></div>' +
          '<div class="hs"><b>' + avg.toFixed(1) + ' ★</b><span>average rating</span></div>' +
          '<div class="hs"><b>24h</b><span>free cancellation</span></div>' +
        '</div>' +
      '</div></section>' +

      '<section class="cust-section"><div class="cust-wrap">' +
        '<div class="section-head"><div><div class="eyebrow">Popular right now</div>' +
          '<h2>Experiences people are booking</h2>' +
          '<p>Live availability — what you see here is what is actually free.</p></div>' +
          '<a class="btn" href="#/activities" style="margin-left:auto">See all ' + acts.length + ' →</a></div>' +
        '<div class="act-grid">' + acts.slice(0, 6).map(expCard).join('') + '</div>' +
      '</div></section>' +

      '<section class="cust-section alt"><div class="cust-wrap">' +
        '<div class="section-head"><div><div class="eyebrow">Why book direct</div>' +
          '<h2>Booked in under a minute</h2></div></div>' +
        '<div class="feature-row">' +
          feature('zap', 'Instant confirmation', 'Your seat is held the moment you pay — no waiting for someone to reply to an email.') +
          feature('shield', 'Free cancellation', 'Cancel up to 24 hours before and get everything back, no questions.') +
          feature('users', 'Small groups', 'Every departure has a hard cap, so the guide has time for you.') +
          feature('star', 'Local guides', 'The people running these trips live here. They are not reading a script.') +
          feature('card', 'Pay how you like', 'Card, PayPal, a deposit now, or the balance on the day.') +
          feature('phone', 'Real humans', 'Call the number in the header between 7am and 9pm and somebody picks up.') +
        '</div>' +
      '</div></section>' +

      '<section class="cust-section"><div class="cust-wrap">' +
        '<div class="section-head"><div><div class="eyebrow">Reviews</div><h2>What guests say</h2></div></div>' +
        '<div class="feature-row">' +
          review('Sofia M.', 'Kayak Adventure', 'The sea caves were unreal and our guide spotted the seals before anyone else did. Booked again for Friday.') +
          review('James O.', 'Sunset Boat Tour', 'Worth it for the light alone. Boarding was quick, the crew were great, the wine was cold.') +
          review('Aisha R.', 'City Walking Tour', 'Three hours went past in about twenty minutes. Our guide knew every alley and every story.') +
        '</div>' +
      '</div></section>';
  }

  function feature(icon, title, text) {
    return '<div class="feature"><span class="fi">' + TF.icon(icon, 17) + '</span>' +
      '<div><b>' + title + '</b><p>' + text + '</p></div></div>';
  }

  function review(who, what, text) {
    return '<div class="card"><div class="card-body">' +
      '<div class="stars">★★★★★</div>' +
      '<p class="small mt-1" style="line-height:1.65">“' + text + '”</p>' +
      '<div class="row mt-2"><span class="avatar sm">' + TF.fmt.initials(who) + '</span>' +
      '<span><b class="small">' + who + '</b><div class="tiny muted">' + what + '</div></span></div>' +
      '</div></div>';
  }

  /* ========================================================= activities */
  function activitiesPage() {
    var acts = filtered();
    return '<section class="cust-section"><div class="cust-wrap">' +
      '<div class="section-head"><div><div class="eyebrow">Everything we run</div>' +
        '<h2>All experiences</h2><p>' + acts.length + ' available' +
        (filters.date ? ' on ' + TF.fmt.date(filters.date) : '') + '</p></div></div>' +
      '<div class="search-panel" style="box-shadow:var(--shadow-sm);border:1px solid var(--border);margin:0 0 26px">' +
        '<div class="sp-field"><label>Search</label><input id="hSearch" placeholder="Anything" value="' + TF.esc(filters.q) + '"></div>' +
        '<div class="sp-field"><label>Category</label><select id="hCat"><option value="">Anything</option>' +
          TF.options(categories(), filters.category) + '</select></div>' +
        '<div class="sp-field"><label>Date</label><input id="hDate" type="date" value="' + TF.esc(filters.date) + '"></div>' +
        '<button class="btn btn-site" id="hGo" style="flex:0 0 auto">Apply</button>' +
      '</div>' +
      (acts.length ? '<div class="act-grid">' + acts.map(expCard).join('') + '</div>'
        : '<div class="card"><div class="empty"><div class="ei">' + TF.icon('search', 24) + '</div>' +
          '<h3>Nothing matches that</h3><p>Try a different date or clear the filters.</p>' +
          '<button class="btn btn-site btn-sm" id="clearFilters">Clear filters</button></div></div>') +
      '</div></section>';
  }

  function expCard(a) {
    var next = nextSlot(a.id);
    return '<article class="exp-card" data-act="' + a.id + '">' +
      '<div class="exp-media" style="background:linear-gradient(135deg,' + a.grad[0] + ',' + a.grad[1] + ')">' +
        '<span class="emo">' + a.emoji + '</span>' +
        '<span class="tagline">' + TF.esc(a.category) + '</span>' +
        '<span class="price-pill">' + TF.fmt.money(a.price) + '</span>' +
      '</div>' +
      '<div class="exp-body">' +
        '<h3>' + TF.esc(a.name) + '</h3>' +
        '<div class="exp-meta"><span class="stars">★ ' + a.rating + '</span>' +
          '<span>(' + TF.fmt.num(a.reviews) + ')</span>' +
          '<span>' + TF.icon('clock', 12) + ' ' + TF.fmt.duration(a.duration) + '</span></div>' +
        '<p class="desc">' + TF.esc(a.short) + '</p>' +
        '<div class="exp-meta">' + (next
          ? '<span>' + TF.icon('calendar', 12) + ' Next: ' + TF.fmt.dateShort(next.date) + ' ' + TF.fmt.time(next.start) + '</span>' +
            '<span style="color:var(--ok-600);font-weight:650">' + TF.sel.seatsLeft(next) + ' spots left</span>'
          : '<span class="muted">No dates scheduled</span>') + '</div>' +
        '<button class="btn btn-site btn-block mt-1" data-book="' + a.id + '">Book Now</button>' +
      '</div></article>';
  }

  /* ============================================================= detail */
  function detailPage(id) {
    var a = TF.sel.activity(id);
    if (!a) return notFound();
    var slots = upcomingSlots(id).slice(0, 6);

    return '<section class="cust-section"><div class="cust-wrap">' +
      '<a class="small muted" href="#/activities">' + TF.icon('arrowL', 13) + ' All experiences</a>' +
      '<div class="detail-split mt-3">' +
        '<div>' +
          '<div class="detail-hero" style="background:linear-gradient(135deg,' + a.grad[0] + ',' + a.grad[1] + ')">' +
            a.emoji + '</div>' +
          '<div class="eyebrow">' + TF.esc(a.category) + '</div>' +
          '<h1 style="font-size:34px;letter-spacing:-.03em;margin:6px 0 10px">' + TF.esc(a.name) + '</h1>' +
          '<div class="row wrap small muted" style="gap:18px">' +
            '<span class="stars">★ ' + a.rating + '</span><span>' + TF.fmt.num(a.reviews) + ' reviews</span>' +
            '<span>' + TF.icon('clock', 13) + ' ' + TF.fmt.duration(a.duration) + '</span>' +
            '<span>' + TF.icon('users', 13) + ' up to ' + a.capacity + ' guests</span>' +
            '<span>' + TF.icon('pin', 13) + ' ' + TF.esc(a.location) + '</span>' +
          '</div>' +
          '<p style="margin-top:20px;line-height:1.75;font-size:15px">' + TF.esc(a.description) + '</p>' +
          (a.highlights && a.highlights.length ? '<h3 style="margin-top:26px;font-size:19px">What is included</h3>' +
            '<ul class="highlight-list mt-2">' + a.highlights.map(function (h) {
              return '<li>' + TF.icon('checkCircle', 17) + '<span>' + TF.esc(h) + '</span></li>';
            }).join('') + '</ul>' : '') +
          '<h3 style="margin-top:26px;font-size:19px">Meeting point</h3>' +
          '<p class="small muted mt-1">' + TF.esc(a.meetingPoint) + '</p>' +
          '<h3 style="margin-top:26px;font-size:19px">Before you come</h3>' +
          '<p class="small muted mt-1">' + TF.esc(a.instructions) + '</p>' +
          '<h3 style="margin-top:26px;font-size:19px">Cancellation policy</h3>' +
          '<p class="small muted mt-1">' + TF.esc(a.cancellation) + '</p>' +
        '</div>' +
        '<aside class="book-summary">' +
          '<div class="row-between"><div><span style="font-size:29px;font-weight:750">' + TF.fmt.money(a.price) + '</span>' +
            '<span class="small muted"> per adult</span></div>' +
            (a.childPrice ? '<div class="right small muted">Children<br><b>' + TF.fmt.money(a.childPrice) + '</b></div>' : '') +
          '</div>' +
          '<div class="section-title mt-3">Next available</div>' +
          (slots.length ? '<div class="mini-list">' + slots.map(function (sl) {
            var left = TF.sel.seatsLeft(sl);
            return '<div class="mini-row"><span style="flex:1"><b>' + TF.fmt.dateShort(sl.date) + '</b> ' +
              TF.fmt.time(sl.start) + '</span><span class="small" style="color:' +
              (left ? 'var(--ok-600)' : 'var(--ink-400)') + ';font-weight:650">' +
              (left ? left + ' left' : 'Sold out') + '</span></div>';
          }).join('') + '</div>' : '<p class="small muted">No dates scheduled yet — get in touch and we will open one.</p>') +
          '<button class="btn btn-site btn-lg btn-block mt-3" data-book="' + a.id + '">Book this experience</button>' +
          '<p class="tiny muted center mt-2">Free cancellation up to 24 hours before</p>' +
          '<div class="mt-3" style="padding-top:14px;border-top:1px solid var(--border)">' +
            '<div class="mini-row"><span class="fi" style="width:30px;height:30px;border-radius:9px;background:var(--ok-50);' +
              'color:var(--ok-600);display:grid;place-items:center">' + TF.icon('checkCircle', 15) + '</span>' +
              '<span class="small">Instant confirmation</span></div>' +
            '<div class="mini-row"><span class="fi" style="width:30px;height:30px;border-radius:9px;background:var(--brand-50);' +
              'color:var(--brand-600);display:grid;place-items:center">' + TF.icon('phone', 15) + '</span>' +
              '<span class="small">Mobile ticket accepted</span></div>' +
          '</div>' +
        '</aside>' +
      '</div></div></section>';
  }

  /* =============================================================== flow */
  function bookPage(activityId) {
    var a = TF.sel.activity(activityId);
    if (!a) return notFound();
    if (!flow || flow.activityId !== activityId) {
      flow = {
        activityId: activityId, step: 1, date: null, slotId: null,
        adults: 2, children: 0,
        customer: { firstName: '', lastName: '', email: '', phone: '', country: 'United States' },
        waiver: false, signature: '', payment: 'Credit Card', card: {}
      };
      calMonth = TF.today();
    }

    return '<section class="cust-section"><div class="cust-wrap">' +
      '<a class="small muted" href="#/a/' + activityId + '">' + TF.icon('arrowL', 13) + ' Back to ' + TF.esc(a.name) + '</a>' +
      '<h1 style="font-size:30px;letter-spacing:-.03em;margin:12px 0 22px">Book ' + TF.esc(a.name) + '</h1>' +
      '<div class="steps-rail">' + STEPS.slice(0, 6).map(function (s, i) {
        var n = i + 1;
        return '<div class="step-pip ' + (flow.step > n ? 'done' : flow.step === n ? 'on' : '') + '">' +
          '<div class="bar"></div><div class="lb">' + n + '. ' + s + '</div></div>';
      }).join('') + '</div>' +
      '<div class="book-layout">' +
        '<div class="card"><div class="card-body" style="padding:24px">' + stepBody(a) + '</div></div>' +
        '<aside class="book-summary">' + summary(a) + '</aside>' +
      '</div>' +
      '</div></section>';
  }

  function stepBody(a) {
    if (flow.step === 1) return stepDate(a);
    if (flow.step === 2) return stepTime(a);
    if (flow.step === 3) return stepGuests(a);
    if (flow.step === 4) return stepDetails();
    if (flow.step === 5) return stepWaiver(a);
    return stepPayment(a);
  }

  /* --- step 1: date --- */
  function stepDate(a) {
    var d = TF.parseYmd(calMonth);
    var first = new Date(d.getFullYear(), d.getMonth(), 1);
    var startPad = first.getDay();
    var daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

    var cells = '';
    for (var i = 0; i < startPad; i++) cells += '<div class="blank"></div>';
    for (var day = 1; day <= daysInMonth; day++) {
      var key = TF.ymd(new Date(d.getFullYear(), d.getMonth(), day));
      var slots = availableSlots(a.id, key);
      var seats = slots.reduce(function (n, sl) { return n + TF.sel.seatsLeft(sl); }, 0);
      var ok = key >= TF.today() && slots.length > 0 && seats > 0;
      cells += '<button data-date="' + key + '" class="' + (flow.date === key ? 'on' : '') + '"' +
        (ok ? '' : ' disabled') + '>' + day +
        (ok ? '<span class="av">' + seats + '</span>' : '') + '</button>';
    }

    return '<h2 style="font-size:21px">Select a date</h2>' +
      '<p class="small muted mt-1">Green numbers are the seats still free that day.</p>' +
      '<div class="row-between mt-3 mb-2">' +
        '<button class="btn btn-sm" id="calPrevM">' + TF.icon('chevL') + '</button>' +
        '<b>' + TF.MONTHS[d.getMonth()] + ' ' + d.getFullYear() + '</b>' +
        '<button class="btn btn-sm" id="calNextM">' + TF.icon('chevR') + '</button>' +
      '</div>' +
      '<div class="mini-cal">' + TF.DAYS_S.map(function (x) { return '<div class="dow">' + x[0] + '</div>'; }).join('') +
        cells + '</div>' +
      '<div class="row mt-4"><button class="btn btn-site btn-lg" id="next" ' +
        (flow.date ? '' : 'disabled') + '>Continue' + TF.icon('arrowR') + '</button></div>';
  }

  /* --- step 2: time --- */
  function stepTime(a) {
    var slots = availableSlots(a.id, flow.date);
    return '<h2 style="font-size:21px">Select a time</h2>' +
      '<p class="small muted mt-1">' + TF.fmt.date(flow.date, true) + '</p>' +
      '<div class="time-grid mt-3">' + slots.map(function (sl) {
        var left = TF.sel.seatsLeft(sl);
        var low = left > 0 && left <= 4;
        return '<button class="time-opt ' + (flow.slotId === sl.id ? 'on' : '') + (low ? ' low' : '') + '" ' +
          'data-slot="' + sl.id + '"' + (left ? '' : ' disabled') + '>' +
          '<div class="t">' + TF.fmt.time(sl.start) + '</div>' +
          '<div class="s">' + (left ? left + ' spots left' : 'Fully booked') + '</div>' +
          '<div class="tiny muted mt-1">' + TF.fmt.money(sl.price) + ' / adult</div></button>';
      }).join('') + '</div>' +
      '<div class="row mt-4"><button class="btn btn-lg" id="back">' + TF.icon('arrowL') + ' Back</button>' +
        '<button class="btn btn-site btn-lg" id="next"' + (flow.slotId ? '' : ' disabled') + '>Continue' + TF.icon('arrowR') + '</button></div>';
  }

  /* --- step 3: guests --- */
  function stepGuests(a) {
    var slot = TF.sel.slot(flow.slotId);
    var left = TF.sel.seatsLeft(slot);
    var unit = slot.price;
    return '<h2 style="font-size:21px">How many guests?</h2>' +
      '<p class="small muted mt-1">' + left + ' seats available on this departure.</p>' +
      '<div class="mt-3">' +
        qtyRow('adults', 'Adults', 'Age 13+', unit, flow.adults) +
        (a.childPrice > 0 ? qtyRow('children', 'Children', 'Age 3–12', a.childPrice, flow.children)
          : '<p class="small muted mt-2">This experience is adults only.</p>') +
      '</div>' +
      (a.minGuests > 1 ? '<p class="small muted mt-2">Minimum ' + a.minGuests + ' guests for this experience.</p>' : '') +
      '<div class="row mt-4"><button class="btn btn-lg" id="back">' + TF.icon('arrowL') + ' Back</button>' +
        '<button class="btn btn-site btn-lg" id="next">Continue' + TF.icon('arrowR') + '</button></div>';
  }

  function qtyRow(key, label, sub, price, value) {
    return '<div class="qty-row"><div><b>' + label + '</b><div class="tiny muted">' + sub + ' · ' +
      TF.fmt.money(price) + ' each</div></div>' +
      '<div class="qty-ctl"><button class="qty-btn" data-qty="' + key + '" data-dir="-1"' +
        (value <= (key === 'adults' ? 1 : 0) ? ' disabled' : '') + '>−</button>' +
      '<span class="qty-val">' + value + '</span>' +
      '<button class="qty-btn" data-qty="' + key + '" data-dir="1">+</button></div></div>';
  }

  /* --- step 4: details --- */
  function stepDetails() {
    var c = flow.customer;
    return '<h2 style="font-size:21px">Your details</h2>' +
      '<p class="small muted mt-1">We only use these to confirm your booking and reach you if the weather turns.</p>' +
      '<form id="detailsForm" class="form-grid mt-3">' +
        '<div class="field"><label>First name</label><input class="input" name="firstName" value="' + TF.esc(c.firstName) + '"></div>' +
        '<div class="field"><label>Last name</label><input class="input" name="lastName" value="' + TF.esc(c.lastName) + '"></div>' +
        '<div class="field"><label>Email</label><input class="input" type="email" name="email" value="' + TF.esc(c.email) + '"></div>' +
        '<div class="field"><label>Phone</label><input class="input" name="phone" value="' + TF.esc(c.phone) + '"></div>' +
        '<div class="field full"><label>Country</label><select class="select" name="country">' +
          TF.options(['United States', 'Canada', 'United Kingdom', 'Ireland', 'Germany', 'France', 'Spain',
            'Italy', 'Denmark', 'Australia', 'New Zealand', 'Brazil', 'South Korea', 'Japan'], c.country) + '</select></div>' +
        '<div class="field full"><label>Anything we should know? <span class="hint">optional</span></label>' +
          '<textarea class="textarea" name="notes" placeholder="Dietary needs, mobility, celebrating something">' +
          TF.esc(flow.notes || '') + '</textarea></div>' +
      '</form>' +
      '<div class="row mt-4"><button class="btn btn-lg" id="back">' + TF.icon('arrowL') + ' Back</button>' +
        '<button class="btn btn-site btn-lg" id="next">Continue' + TF.icon('arrowR') + '</button></div>';
  }

  /* --- step 5: waiver --- */
  function stepWaiver(a) {
    var name = (flow.customer.firstName + ' ' + flow.customer.lastName).trim();
    return '<h2 style="font-size:21px">Liability waiver</h2>' +
      '<p class="small muted mt-1">Everyone joining ' + TF.esc(a.name) + ' needs to accept this before departure.</p>' +
      '<div class="waiver-box mt-3">' +
        '<b>Assumption of risk and release of liability</b><br><br>' +
        'I understand that ' + TF.esc(TF.state().settings.business.name) + ' operates outdoor activities that carry inherent risks, ' +
        'including but not limited to weather, water conditions, equipment failure, and the actions of other participants. ' +
        'I confirm that I and everyone in my party are in adequate physical condition to take part in ' + TF.esc(a.name) + '.<br><br>' +
        'I agree to follow all safety instructions given by the guide, to wear the safety equipment provided, and to declare ' +
        'any medical condition that could affect my participation. I understand that the operator may refuse participation on ' +
        'safety grounds, in which case the cancellation policy for operator-cancelled departures applies.<br><br>' +
        'I release ' + TF.esc(TF.state().settings.business.name) + ', its staff and contractors from claims arising from ordinary ' +
        'participation in this activity, except where caused by gross negligence. I consent to first aid being administered ' +
        'if needed, and to photographs taken during the activity being used for promotional purposes unless I say otherwise ' +
        'in writing.<br><br>' +
        '<b>Cancellation.</b> ' + TF.esc(a.cancellation) +
      '</div>' +
      '<label class="check mt-3"><input type="checkbox" id="waiverAgree"' + (flow.waiver ? ' checked' : '') + '> ' +
        '<span>I have read and agree to the terms and waiver above, on behalf of everyone in my booking.</span></label>' +
      '<div class="section-title mt-3">Signature</div>' +
      '<div class="sig-pad ' + (flow.signature ? 'signed' : '') + '" id="sigPad">' +
        (flow.signature ? '<span class="sig-name">' + TF.esc(flow.signature) + '</span>'
          : '<span class="small muted">Click to sign as ' + TF.esc(name || 'your name') + '</span>') +
      '</div>' +
      '<p class="tiny muted mt-1">Simulated signature — a production build captures a real drawn or typed signature and stores it with the booking.</p>' +
      '<div class="row mt-4"><button class="btn btn-lg" id="back">' + TF.icon('arrowL') + ' Back</button>' +
        '<button class="btn btn-site btn-lg" id="next">Continue to payment' + TF.icon('arrowR') + '</button></div>';
  }

  /* --- step 6: payment --- */
  function stepPayment(a) {
    var p = TF.state().settings.payments;
    var total = totals(a).total;
    var deposit = Math.round(total * (p.depositPercent / 100));

    return '<h2 style="font-size:21px">Payment</h2>' +
      '<p class="small muted mt-1">Demo mode — no card is charged and nothing leaves your browser.</p>' +
      '<div class="stack mt-3" style="gap:10px">' +
        payOpt('Credit Card', 'card', 'Visa, Mastercard, Amex — charged now') +
        payOpt('PayPal', 'globe', 'You will be redirected to approve the payment') +
        (p.depositEnabled ? payOpt('Deposit', 'dollar', 'Pay ' + TF.fmt.money(deposit) + ' now, ' +
          TF.fmt.money(total - deposit) + ' on the day') : '') +
        (p.payLater ? payOpt('Pay Later', 'clock', 'Pay in full at the meeting point') : '') +
      '</div>' +
      (flow.payment === 'Credit Card' || flow.payment === 'Deposit'
        ? '<div class="form-grid mt-3" id="cardForm">' +
            '<div class="field full"><label>Card number</label>' +
              '<input class="input" name="cardNumber" placeholder="4242 4242 4242 4242" value="4242 4242 4242 4242"></div>' +
            '<div class="field"><label>Expiry</label><input class="input" name="exp" placeholder="12 / 28" value="12 / 28"></div>' +
            '<div class="field"><label>CVC</label><input class="input" name="cvc" placeholder="123" value="123"></div>' +
            '<div class="field full"><label>Name on card</label><input class="input" name="cardName" value="' +
              TF.esc((flow.customer.firstName + ' ' + flow.customer.lastName).trim()) + '"></div>' +
          '</div>'
        : '') +
      '<div class="card mt-3" style="background:var(--ink-50)"><div class="card-body">' +
        '<div class="summary-line"><span>Charged today</span><b>' +
          TF.fmt.money(flow.payment === 'Deposit' ? deposit : flow.payment === 'Pay Later' ? 0 : total) + '</b></div>' +
        '<div class="summary-line"><span>Due on the day</span><b>' +
          TF.fmt.money(flow.payment === 'Deposit' ? total - deposit : flow.payment === 'Pay Later' ? total : 0) + '</b></div>' +
      '</div></div>' +
      '<div class="row mt-4"><button class="btn btn-lg" id="back">' + TF.icon('arrowL') + ' Back</button>' +
        '<button class="btn btn-site btn-lg" id="pay">' + TF.icon('lock') + ' Confirm and pay ' +
          TF.fmt.money(flow.payment === 'Deposit' ? deposit : flow.payment === 'Pay Later' ? 0 : total) + '</button></div>';
  }

  function payOpt(name, icon, sub) {
    return '<div class="pay-opt ' + (flow.payment === name ? 'on' : '') + '" data-pay="' + name + '">' +
      '<span class="radio"></span>' + TF.icon(icon, 18) +
      '<span style="flex:1"><b>' + name + '</b><div class="tiny muted">' + sub + '</div></span></div>';
  }

  /* --- summary sidebar --- */
  function summary(a) {
    var slot = flow.slotId ? TF.sel.slot(flow.slotId) : null;
    var t = totals(a);
    return '<div class="row" style="align-items:flex-start">' +
        '<div style="width:46px;height:46px;border-radius:12px;display:grid;place-items:center;font-size:23px;' +
        'background:linear-gradient(135deg,' + a.grad[0] + ',' + a.grad[1] + ')">' + a.emoji + '</div>' +
        '<div><b>' + TF.esc(a.name) + '</b><div class="tiny muted">' + TF.fmt.duration(a.duration) +
        ' · ' + TF.esc(a.location) + '</div></div></div>' +
      '<div class="mt-3" style="padding-top:14px;border-top:1px solid var(--border)">' +
        '<div class="summary-line"><span class="muted">Date</span><b>' +
          (flow.date ? TF.fmt.date(flow.date) : '—') + '</b></div>' +
        '<div class="summary-line"><span class="muted">Time</span><b>' +
          (slot ? TF.fmt.time(slot.start) : '—') + '</b></div>' +
        '<div class="summary-line"><span class="muted">Meeting point</span><b class="right" style="max-width:60%">' +
          TF.esc(a.meetingPoint) + '</b></div>' +
      '</div>' +
      '<div class="mt-3" style="padding-top:14px;border-top:1px solid var(--border)">' +
        '<div class="summary-line"><span>Adults × ' + flow.adults + '</span><span>' +
          TF.fmt.money(t.adultTotal) + '</span></div>' +
        (flow.children ? '<div class="summary-line"><span>Children × ' + flow.children + '</span><span>' +
          TF.fmt.money(t.childTotal) + '</span></div>' : '') +
        (t.tax ? '<div class="summary-line"><span class="muted">' + TF.esc(TF.state().settings.payments.taxLabel) +
          ' (' + TF.state().settings.payments.taxRate + '%)</span><span>' + TF.fmt.money(t.tax) + '</span></div>' : '') +
        '<div class="summary-total"><span>Total</span><span>' + TF.fmt.money(t.total) + '</span></div>' +
      '</div>' +
      '<p class="tiny muted mt-3">' + TF.icon('shield', 12) + ' Free cancellation up to ' +
        TF.state().settings.cancellation.freeUntilHours + ' hours before departure.</p>';
  }

  function totals(a) {
    var slot = flow.slotId ? TF.sel.slot(flow.slotId) : null;
    var unit = slot ? slot.price : a.price;
    var adultTotal = flow.adults * unit;
    var childTotal = flow.children * a.childPrice;
    var sub = adultTotal + childTotal;
    var p = TF.state().settings.payments;
    var tax = p.taxIncluded ? 0 : Math.round(sub * (p.taxRate / 100));
    return { adultTotal: adultTotal, childTotal: childTotal, sub: sub, tax: tax, total: sub + tax };
  }

  /* ========================================================= confirmation */
  function confirmPage(bookingId) {
    var b = TF.sel.booking(bookingId);
    if (!b) return notFound();
    var a = TF.sel.activity(b.activityId);
    var c = TF.sel.customer(b.customerId);

    return '<section class="cust-section"><div class="cust-wrap" style="max-width:760px">' +
      '<div class="confirm-hero">' +
        '<div class="confirm-check">' + TF.icon('check', 34) + '</div>' +
        '<h1 style="font-size:31px;letter-spacing:-.03em">Booking Confirmed!</h1>' +
        '<p class="muted mt-1">We have emailed the details to ' + TF.esc(c ? c.email : '') + '.</p>' +
        '<div class="mono mt-2" style="font-size:19px;font-weight:700">#' + b.id + '</div>' +
      '</div>' +
      '<div class="card mt-3"><div class="card-body">' +
        '<div class="row" style="align-items:flex-start">' +
          '<div style="width:52px;height:52px;border-radius:13px;display:grid;place-items:center;font-size:26px;' +
          'background:linear-gradient(135deg,' + a.grad[0] + ',' + a.grad[1] + ')">' + a.emoji + '</div>' +
          '<div><b style="font-size:17px">' + TF.esc(a.name) + '</b>' +
          '<div class="small muted">' + TF.fmt.date(b.date, true) + ' at ' + TF.fmt.time(b.time) + '</div></div></div>' +
        '<dl class="dl mt-3">' +
          '<dt>Guests</dt><dd>' + b.adults + ' adult' + (b.adults === 1 ? '' : 's') +
            (b.children ? ', ' + b.children + ' children' : '') + '</dd>' +
          '<dt>Meeting point</dt><dd>' + TF.esc(a.meetingPoint) + '</dd>' +
          '<dt>Guide</dt><dd>' + TF.esc(TF.sel.staffName(b.guideId)) + '</dd>' +
          '<dt>Total</dt><dd>' + TF.fmt.money(b.amount) + '</dd>' +
          '<dt>Paid today</dt><dd>' + TF.fmt.money(b.paid) +
            (b.paid < b.amount ? ' <span class="small muted">(' + TF.fmt.money(b.amount - b.paid) + ' due on the day)</span>' : '') + '</dd>' +
          '<dt>Payment status</dt><dd>' + TF.badge(b.paymentStatus) + '</dd>' +
          '<dt>Waiver</dt><dd>' + (b.waiver ? 'Signed' : 'Outstanding') + '</dd>' +
        '</dl>' +
        '<div class="card mt-3" style="background:var(--warn-50);border-color:var(--warn-100)">' +
          '<div class="card-body small" style="color:var(--warn-700)"><b>Before you come.</b> ' +
          TF.esc(a.instructions) + '</div></div>' +
        '<div class="row wrap mt-3">' +
          '<button class="btn btn-site" id="addCal">' + TF.icon('calendar') + ' Add to Calendar</button>' +
          '<button class="btn" id="printBk">' + TF.icon('printer') + ' Print</button>' +
          '<a class="btn" href="#/">Back to Website</a>' +
        '</div>' +
      '</div></div>' +
      '<div class="card mt-3" style="background:var(--brand-50);border-color:var(--brand-100)">' +
        '<div class="card-body small" style="color:var(--brand-700)">' +
        '<b>This is the point of the demo.</b> Open the ' +
        '<a href="admin.html" style="text-decoration:underline">operator dashboard</a> and you will find ' + b.id +
        ' in Bookings, the seat gone from that departure\'s capacity, the payment in the ledger, ' +
        (c ? TF.esc(c.name) : 'the guest') + ' in Customers, and today\'s revenue changed on the dashboard.</div></div>' +
      '</div></section>';
  }

  function notFound() {
    return '<section class="cust-section"><div class="cust-wrap center">' +
      '<h1>Not found</h1><p class="muted mt-2">That page does not exist.</p>' +
      '<a class="btn btn-site mt-3" href="#/">Back to the homepage</a></div></section>';
  }

  /* =============================================================== about */
  function aboutPage() {
    var s = TF.state().settings.business;
    return '<section class="cust-section"><div class="cust-wrap" style="max-width:820px">' +
      '<div class="eyebrow">About us</div>' +
      '<h1 style="font-size:36px;letter-spacing:-.03em;margin:8px 0 16px">Small groups, local guides, honest weather calls</h1>' +
      '<p style="font-size:16px;line-height:1.75">' + TF.esc(s.name) + ' has run trips out of this harbour since 2019. ' +
        'We started with four kayaks and one van. Today we run ' + liveActivities().length +
        ' different experiences with a team of ' + TF.state().staff.length + ' guides, captains and hosts — ' +
        'and we still cap every departure at a size where the guide learns your name.</p>' +
      '<p style="font-size:16px;line-height:1.75;margin-top:16px">If the weather is wrong, we say so and move you, ' +
        'rather than taking you out to a grey wall of rain because the boat was already paid for. That policy costs us ' +
        'money a few times a season and is the single thing guests mention most in reviews.</p>' +
      '<div class="feature-row mt-4">' +
        feature('anchor', 'Since 2019', 'Independent, owner-operated, based in the harbour we take you out on.') +
        feature('users', 'Small by design', 'Hard caps on every departure. No packed boats.') +
        feature('shield', 'Fully licensed', 'Coast Guard certified vessels, PADI instructors, insured throughout.') +
      '</div>' +
      '<div class="section-head mt-4"><div><div class="eyebrow">The team</div><h2>Who you will actually meet</h2></div></div>' +
      '<div class="act-grid">' + TF.state().staff.slice(0, 6).map(function (m) {
        return '<div class="card"><div class="card-body center">' +
          '<span class="avatar lg" style="margin:0 auto">' + TF.fmt.initials(m.name) + '</span>' +
          '<b class="mt-2" style="display:block">' + TF.esc(m.name) + '</b>' +
          '<div class="small muted">' + TF.esc(m.role) + '</div>' +
          '<div class="tiny muted mt-1">' + TF.fmt.num(m.completed) + ' trips · ★ ' + m.rating + '</div>' +
        '</div></div>';
      }).join('') + '</div>' +
      '</div></section>';
  }

  function contactPage() {
    var s = TF.state().settings.business;
    var w = TF.state().settings.website;
    return '<section class="cust-section"><div class="cust-wrap" style="max-width:900px">' +
      '<div class="eyebrow">Contact</div>' +
      '<h1 style="font-size:36px;letter-spacing:-.03em;margin:8px 0 22px">Talk to a human</h1>' +
      '<div class="detail-split">' +
        '<div class="card"><div class="card-body">' +
          '<form id="contactForm" class="form-grid">' +
            '<div class="field"><label>Name</label><input class="input" name="name"></div>' +
            '<div class="field"><label>Email</label><input class="input" type="email" name="email"></div>' +
            '<div class="field full"><label>What can we help with?</label>' +
              '<textarea class="textarea" name="message" style="min-height:120px"></textarea></div>' +
          '</form>' +
          '<button class="btn btn-site mt-3" id="contactSend">Send message</button>' +
        '</div></div>' +
        '<aside class="card"><div class="card-body">' +
          '<div class="mini-row">' + TF.icon('mail', 16) + '<span style="flex:1">' + TF.esc(w.contactEmail) + '</span></div>' +
          '<div class="mini-row">' + TF.icon('phone', 16) + '<span style="flex:1">' + TF.esc(w.contactPhone) + '</span></div>' +
          '<div class="mini-row">' + TF.icon('pin', 16) + '<span style="flex:1">' + TF.esc(s.address) + '</span></div>' +
          '<div class="mini-row">' + TF.icon('clock', 16) + '<span style="flex:1">Open daily 7am – 9pm</span></div>' +
        '</div></aside>' +
      '</div></div></section>';
  }

  /* =============================================================== wiring */
  function wire(host) {
    var burger = host.querySelector('#custBurger');
    if (burger) burger.addEventListener('click', function () {
      host.querySelector('#custMobile').classList.toggle('open');
    });

    TF.on(host, 'click', '[data-act]', function (e, el) {
      if (e.target.closest('[data-book]')) return;
      go('#/a/' + el.dataset.act);
    });
    TF.on(host, 'click', '[data-book]', function (e, el) {
      e.stopPropagation();
      flow = null;
      go('#/book/' + el.dataset.book);
    });

    var apply = host.querySelector('#hGo');
    if (apply) apply.addEventListener('click', function () {
      filters.q = host.querySelector('#hSearch').value;
      filters.category = host.querySelector('#hCat').value;
      filters.date = host.querySelector('#hDate').value;
      go('#/activities');
    });
    var clear = host.querySelector('#clearFilters');
    if (clear) clear.addEventListener('click', function () {
      filters = { q: '', category: '', date: '' };
      render();
    });

    var send = host.querySelector('#contactSend');
    if (send) send.addEventListener('click', function () {
      TF.toast('Message sent', 'Simulated — in production this reaches the operator inbox.', 'info');
      host.querySelector('#contactForm').reset();
    });

    /* ---- flow ---- */
    if (host.querySelector('#calPrevM')) {
      host.querySelector('#calPrevM').addEventListener('click', function () {
        var d = TF.parseYmd(calMonth); d.setMonth(d.getMonth() - 1); calMonth = TF.ymd(d); render();
      });
      host.querySelector('#calNextM').addEventListener('click', function () {
        var d = TF.parseYmd(calMonth); d.setMonth(d.getMonth() + 1); calMonth = TF.ymd(d); render();
      });
    }
    TF.on(host, 'click', '[data-date]', function (e, el) {
      flow.date = el.dataset.date;
      flow.slotId = null;
      render();
    });
    TF.on(host, 'click', '[data-slot]', function (e, el) {
      flow.slotId = el.dataset.slot;
      render();
    });
    TF.on(host, 'click', '[data-qty]', function (e, el) {
      var a = TF.sel.activity(flow.activityId);
      var slot = TF.sel.slot(flow.slotId);
      var dir = +el.dataset.dir;
      var key = el.dataset.qty;
      var next = flow[key] + dir;
      var totalGuests = flow.adults + flow.children + dir;
      if (next < (key === 'adults' ? 1 : 0)) return;
      if (dir > 0 && totalGuests > Math.min(TF.sel.seatsLeft(slot), a.maxGuests)) {
        return TF.toast('That is everything we have', 'Only ' + TF.sel.seatsLeft(slot) +
          ' seats are left on this departure.', 'err');
      }
      flow[key] = next;
      render();
    });
    TF.on(host, 'click', '[data-pay]', function (e, el) {
      flow.payment = el.dataset.pay;
      render();
    });

    var sig = host.querySelector('#sigPad');
    if (sig) sig.addEventListener('click', function () {
      var name = (flow.customer.firstName + ' ' + flow.customer.lastName).trim();
      if (!name) return TF.toast('Name needed', 'Go back a step and tell us your name first.', 'err');
      flow.signature = name;
      render();
    });
    var agree = host.querySelector('#waiverAgree');
    if (agree) agree.addEventListener('change', function (e) { flow.waiver = e.target.checked; });

    var back = host.querySelector('#back');
    if (back) back.addEventListener('click', function () {
      captureStep(host);
      flow.step--;
      render();
    });
    var next = host.querySelector('#next');
    if (next) next.addEventListener('click', function () {
      if (!validateStep(host)) return;
      flow.step++;
      render();
    });
    var pay = host.querySelector('#pay');
    if (pay) pay.addEventListener('click', function (e) { completeBooking(e.currentTarget); });

    var addCal = host.querySelector('#addCal');
    if (addCal) addCal.addEventListener('click', function () {
      TF.toast('Calendar event created', 'Simulated .ics — a production build downloads a real calendar file.', 'info');
    });
    var pr = host.querySelector('#printBk');
    if (pr) pr.addEventListener('click', function () { global.print(); });
  }

  function captureStep(host) {
    if (flow.step === 4 && host.querySelector('#detailsForm')) {
      var d = TF.formData(host.querySelector('#detailsForm'));
      flow.customer = { firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, country: d.country };
      flow.notes = d.notes;
    }
    if ((flow.step === 6) && host.querySelector('#cardForm')) {
      flow.card = TF.formData(host.querySelector('#cardForm'));
    }
  }

  function validateStep(host) {
    var a = TF.sel.activity(flow.activityId);
    if (flow.step === 1 && !flow.date) return false;
    if (flow.step === 2 && !flow.slotId) return false;
    if (flow.step === 3) {
      var guests = flow.adults + flow.children;
      if (guests < a.minGuests) {
        TF.toast('Minimum group size', a.name + ' needs at least ' + a.minGuests + ' guests.', 'err');
        return false;
      }
    }
    if (flow.step === 4) {
      var form = host.querySelector('#detailsForm');
      if (!TF.requireFields(form, ['firstName', 'lastName', 'email'])) return false;
      var d = TF.formData(form);
      if (d.email.indexOf('@') === -1) {
        TF.toast('Check the email', 'That does not look like an email address.', 'err');
        return false;
      }
      if (TF.state().settings.booking.requirePhone && !d.phone.trim()) {
        TF.toast('Phone required', 'We need a number to reach you if the weather changes.', 'err');
        return false;
      }
      captureStep(host);
    }
    if (flow.step === 5) {
      if (!flow.waiver) { TF.toast('Waiver not accepted', 'Tick the box to continue.', 'err'); return false; }
      if (!flow.signature) { TF.toast('Signature missing', 'Click the signature box to sign.', 'err'); return false; }
    }
    return true;
  }

  function completeBooking(btn) {
    var a = TF.sel.activity(flow.activityId);
    var slot = TF.sel.slot(flow.slotId);
    var guests = flow.adults + flow.children;

    // Last-second capacity check — someone else may have taken the seats
    // while this guest was filling in the form.
    if (guests > TF.sel.seatsLeft(slot)) {
      TF.toast('Those seats just went', 'Only ' + TF.sel.seatsLeft(slot) + ' left on this departure. Pick another time.', 'err');
      flow.step = 2;
      return render();
    }

    btn.innerHTML = '<span class="spinner"></span> Processing payment…';
    btn.disabled = true;

    setTimeout(function () {
      var t = totals(a);
      var p = TF.state().settings.payments;
      var paid = flow.payment === 'Deposit' ? Math.round(t.total * (p.depositPercent / 100))
        : flow.payment === 'Pay Later' ? 0 : t.total;

      var customer = TF.actions.findOrCreateCustomer({
        name: (flow.customer.firstName + ' ' + flow.customer.lastName).trim(),
        email: flow.customer.email,
        phone: flow.customer.phone,
        country: flow.customer.country
      });

      var booking = TF.actions.createBooking({
        customerId: customer.id,
        activityId: flow.activityId,
        slotId: flow.slotId,
        adults: flow.adults,
        children: flow.children,
        amount: t.total,
        paid: paid,
        paymentStatus: paid >= t.total ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Pending',
        paymentMethod: flow.payment === 'Deposit' ? 'Credit Card' : flow.payment === 'Pay Later' ? 'Cash' : flow.payment,
        status: 'Confirmed',
        guideId: slot.guideId,
        waiver: true,
        notes: flow.notes || '',
        source: 'Website'
      });

      TF.toast('Booking confirmed', booking.id + ' — a confirmation email has been simulated.');
      flow = null;
      go('#/confirm/' + booking.id);
    }, 1300);
  }

  /* ============================================================ helpers */
  function liveActivities() {
    return TF.state().activities.filter(function (a) { return a.status === 'Active'; });
  }
  function categories() {
    return liveActivities().map(function (a) { return a.category; })
      .filter(function (v, i, arr) { return arr.indexOf(v) === i; });
  }
  function filtered() {
    var q = filters.q.trim().toLowerCase();
    return liveActivities().filter(function (a) {
      if (filters.category && a.category !== filters.category) return false;
      if (q && (a.name + ' ' + a.short + ' ' + a.category + ' ' + a.location).toLowerCase().indexOf(q) === -1) return false;
      if (filters.date && !availableSlots(a.id, filters.date).length) return false;
      return true;
    });
  }
  function availableSlots(activityId, dateKey) {
    if (!dateKey) return [];
    if (TF.sel.isBlocked(dateKey)) return [];
    return TF.state().schedule.filter(function (sl) {
      return sl.activityId === activityId && sl.date === dateKey && sl.status !== 'Cancelled';
    }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
  }
  function upcomingSlots(activityId) {
    return TF.state().schedule.filter(function (sl) {
      return sl.activityId === activityId && sl.date >= TF.today() && sl.status !== 'Cancelled';
    }).sort(function (a, b) { return a.date === b.date ? (a.start < b.start ? -1 : 1) : (a.date < b.date ? -1 : 1); });
  }
  function nextSlot(activityId) {
    return upcomingSlots(activityId).filter(function (sl) { return TF.sel.seatsLeft(sl) > 0; })[0] || null;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
