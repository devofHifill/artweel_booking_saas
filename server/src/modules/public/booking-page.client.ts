/**
 * The booking flow, as a plain string of browser JavaScript.
 *
 * Kept as a string rather than a bundled module because the whole point of
 * this page is that it ships in one request with no build step. It is written
 * in ES5-ish style deliberately: no template literals (the outer file is a TS
 * template literal), no optional chaining, nothing that needs transpiling.
 *
 * Flow: service -> [address] -> [instructor] -> time -> details -> confirmed.
 * Steps that would ask a pointless question are skipped, never shown empty —
 * a studio with one location should not make anyone "choose" it.
 */
export const clientScript = String.raw`
(function () {
  var DATA = window.__BOOKING__;
  var app = document.getElementById('app');
  var stepsEl = document.getElementById('steps');

  /*
    Whether this page is being shown inside the embeddable widget.

    Set once, from the ?embed=1 the loader appends. The alternatives were both
    worse: sniffing window.parent (a booking page on the studio's own site can
    be iframed too, and would look identical), or a header (fetch does not
    let a public page add one). A query flag is simple, testable, and the
    thing the loader controls anyway.
  */
  var IS_EMBED = /(?:^|[?&])embed=1(?:&|$)/.test(location.search);
  var BOOKING_SOURCE = IS_EMBED ? 'embed' : 'web';

  var state = {
    service: null, location: null, staff: null,
    slot: null, session: null, address: null, coverage: null, seats: 1
  };

  /** The last /quote answer. Drives the summary AND which endpoint submits. */
  var quote = null;

  /**
   * The cohort being bought, when one is.
   *
   * A course skips the time step entirely: its dates are fixed when the studio
   * creates the cohort, and offering a choice of them would imply a student
   * could attend week three and not week two. Service and course are mutually
   * exclusive — picking either clears the other.
   */
  var course = null;

  function money(cents) {
    return new Intl.NumberFormat('en-US',
      { style: 'currency', currency: DATA.currency,
        minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;',
               '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(path, opts) {
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j.error && j.error.message) || 'Something went wrong.');
        return j;
      });
    });
  }
  function localDate(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function timeIn(iso, tz) {
    return new Intl.DateTimeFormat('en-US',
      { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));
  }
  function dayIn(iso, tz) {
    return new Intl.DateTimeFormat('en-US',
      { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz })
      .format(new Date(iso));
  }
  /**
   * The same instant as a sortable YYYY-MM-DD, in the STUDIO's zone.
   *
   * dayIn produces a label for a human; this produces a key for a calendar
   * cell, and the two must agree about which day it is. en-CA because it
   * formats as ISO.
   *
   * The zone is the whole point. A class at 6pm Portland time is the NEXT day
   * in UTC, so grouping on the browser's idea of the date puts a Monday
   * evening class in Tuesday's cell for a guest reading the page from Berlin.
   */
  function ymdIn(iso, tz) {
    return new Intl.DateTimeFormat('en-CA',
      { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz })
      .format(new Date(iso));
  }
  /** Month label from a YYYY-MM key, without constructing a zoned date. */
  function monthLabel(ym) {
    var parts = ym.split('-');
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
      .format(new Date(Number(parts[0]), Number(parts[1]) - 1, 1));
  }
  function error(msg) {
    return '<div class="err">' + esc(msg) + '</div>';
  }

  // Which steps this particular booking actually needs.
  function plan() {
    /* A cohort has fixed dates and one price, so there is nothing between
       choosing it and saying who you are. */
    if (course) return ['Course', 'Details'];

    var steps = ['Class'];
    if (state.service) {
      if (needsAddress()) steps.push('Address');
      if (state.service.bookingMode === 'APPOINTMENT') steps.push('Instructor');
      steps.push('Time');
      steps.push('Details');
    }
    return steps;
  }
  function needsAddress() {
    if (!state.location) return false;
    return state.location.requiresAddress === true;
  }
  function drawSteps(current) {
    var list = plan();
    stepsEl.innerHTML = list.map(function (name, i) {
      var idx = list.indexOf(current);
      var cls = name === current ? 'on' : (i < idx ? 'done' : '');
      return '<span class="' + cls + '">' + esc(name) + '</span>';
    }).join('');
  }

  function back(handler) {
    return '<button class="back" type="button" id="back">&larr; Back</button>';
  }
  function wireBack(fn) {
    var b = document.getElementById('back');
    if (b) b.addEventListener('click', fn);
  }

  // --- Step 1: service ----------------------------------------------------
  function pickService(id) {
    for (var i = 0; i < DATA.services.length; i++) {
      if (DATA.services[i].id === id) state.service = DATA.services[i];
    }
    if (!state.service) return;

    // Only locations this service is actually offered at.
    var allowed = state.service.serviceLocations.map(function (l) { return l.locationId; });
    var options = DATA.locations.filter(function (l) {
      return allowed.length === 0 || allowed.indexOf(l.id) !== -1;
    });

    if (options.length === 1) { state.location = options[0]; afterLocation(); }
    else if (options.length === 0) { state.location = null; afterLocation(); }
    else showLocations(options);
  }

  /*
    Step 1, the other kind: a whole cohort.

    Sets the cohort and the service it belongs to — the service is still needed,
    because the deposit terms are the studio's policy and live there, not on
    the cohort. Then straight to details: no location step (a cohort's venue is
    fixed when it is created), no time step, no seat-availability lookup.
  */
  function pickCourse(id) {
    var list = DATA.courses || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) course = list[i];
    }
    if (!course || !course.enrollable) return;

    /* Deliberately NOT looked up in DATA.services: a COURSE_SERIES service is
       filtered out of that list, because it is the container for a cohort and
       not a drop-in anybody can buy a single seat in. The cohort carries the
       service id it needs. */
    state = { service: null, location: null, staff: null, slot: null,
              session: null, address: null, coverage: null, seats: 1 };

    showCourseDetails();
  }

  function showCourseDetails() {
    drawSteps('Details');

    var head = back() +
      '<h2>' + esc(course.name) +
        (course.cohortLabel ? ' &middot; ' + esc(course.cohortLabel) : '') + '</h2>' +
      '<p class="hint">' + course.sessionCount + ' sessions' +
        (course.instructor ? ' with ' + esc(course.instructor) : '') +
        '. Booked once, covering every week.</p>';

    /*
      A course is not a class, and this is where they part.

      enrollPublic refuses any cohort with a price — COURSE_REQUIRES_PAYMENT —
      so /enrollments sells free courses only. A class at a studio without
      Stripe falls back to an unpaid booking; a priced course at the same
      studio has no path at all, by the server's own rule.

      So say so, rather than render a form whose button is guaranteed to 409.
      The contact details are already in the footer, which is the only thing
      that can actually help here.
    */
    if (course.priceCents > 0 && !DATA.acceptsPayment) {
      app.innerHTML = head +
        '<div class="err">This course has to be paid for online, and the ' +
        'studio has not finished setting up online payments yet. Please get ' +
        'in touch with them directly to take a place.</div>';
      wireBack(function () { course = null; start(); });
      return;
    }

    app.innerHTML = head +
      '<div id="err"></div>' +
      '<label for="name">Full name</label><input id="name" autocomplete="name">' +
      '<label for="email">Email</label><input id="email" type="email" autocomplete="email">' +
      '<label for="phone">Mobile (optional)</label><input id="phone" type="tel" autocomplete="tel">' +
      (course.seatsRemaining > 1
        ? '<label for="seats">How many places?</label>' +
          '<input id="seats" type="number" min="1" max="' + course.seatsRemaining + '" value="1">'
        : '') +
      '<label for="notes">Anything else? (optional)</label><textarea id="notes" rows="3"></textarea>' +
      '<label class="check"><input type="checkbox" id="sms">' +
      '<span>Text me a reminder before each session. Message rates may apply, ' +
      'and you can reply STOP at any time.</span></label>' +
      '<div id="summary"></div>' +
      '<button class="primary" id="confirm" type="button">Confirm booking</button>';

    wireBack(function () { course = null; start(); });
    paintSummary();

    var seatsInput = document.getElementById('seats');
    if (seatsInput) {
      seatsInput.addEventListener('change', function () {
        state.seats = parseInt(seatsInput.value, 10) || 1;
        paintSummary();
      });
    }

    document.getElementById('confirm').addEventListener('click', function () {
      submitCourse(this);
    });
  }

  function submitCourse(btn) {
    var name = document.getElementById('name').value.trim();
    var email = document.getElementById('email').value.trim();
    var seatsEl = document.getElementById('seats');
    var seats = seatsEl ? parseInt(seatsEl.value, 10) || 1 : 1;

    if (!name || !email) {
      document.getElementById('err').innerHTML = error('Please add your name and email.');
      return;
    }

    var customer = {
      name: name, email: email,
      phone: document.getElementById('phone').value.trim() || undefined
    };
    var paying = quote && quote.willCharge;
    var url = '/public/' + DATA.slug + '/courses/' + course.id +
      (paying ? '/checkout' : '/enrollments');

    btn.disabled = true;
    btn.textContent = paying ? 'Taking you to payment...' : 'Booking...';

    var body = paying
      ? { seats: seats, customer: customer }
      : {
          seats: seats,
          customer: customer,
          smsConsent: document.getElementById('sms').checked,
          notes: document.getElementById('notes').value.trim() || undefined
        };

    api(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        if (paying) { location.href = res.checkoutUrl; return; }
        showEnrolled(res);
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = paying ? 'Continue to payment' : 'Confirm booking';
        document.getElementById('err').innerHTML = error(e.message);
      });
  }

  function showEnrolled(res) {
    stepsEl.innerHTML = '';
    var e = res.enrollment;

    app.innerHTML =
      '<div class="ok">' +
      '<div class="tick">&#10003;</div>' +
      '<h2>You are booked in</h2>' +
      '<p class="hint">A confirmation is on its way to your email.</p>' +
      '<div class="summary">' +
        '<div><span>Course</span><span>' + esc(e.courseName) + '</span></div>' +
        '<div><span>Sessions</span><span>' + e.sessionCount + '</span></div>' +
        (e.seats > 1
          ? '<div><span>Places</span><span>' + e.seats + '</span></div>' : '') +
        '<div><span>Total</span><span>' + money(e.totalCents) + '</span></div>' +
      '</div>' +
      '<p class="hint"><a href="/public/bookings/' + encodeURIComponent(res.manageToken) +
        '/manage">Manage or cancel this booking</a></p>' +
      '</div>';
  }

  function showLocations(options) {
    drawSteps('Class');
    app.innerHTML = back() +
      '<h2>Where would you like it?</h2>' +
      options.map(function (l) {
        return '<button class="card" type="button" data-loc="' + esc(l.id) + '">' +
          '<span class="swatch" style="background:var(--clay)"></span><span>' +
          '<h3>' + esc(l.name) + '</h3>' +
          '<p>' + esc(l.requiresAddress ? 'We come to you' : (l.address || 'At the studio')) + '</p>' +
          '</span></button>';
      }).join('');

    wireBack(start);
    app.querySelectorAll('[data-loc]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-loc');
        for (var i = 0; i < options.length; i++) {
          if (options[i].id === id) state.location = options[i];
        }
        afterLocation();
      });
    });
  }

  function afterLocation() {
    if (needsAddress()) showAddress();
    else if (state.service.bookingMode === 'APPOINTMENT') showStaff();
    else showTimes();
  }

  // --- Step 2: address (mobile only) --------------------------------------
  // Asked BEFORE any time is chosen. Letting someone pick a slot and then
  // telling them they are out of range is the worst thing a mobile flow can do.
  function showAddress() {
    drawSteps('Address');
    app.innerHTML = back() +
      '<h2>Where are we coming to?</h2>' +
      '<p class="hint">We will check this is inside the travel area before you pick a time.</p>' +
      '<div id="err"></div>' +
      '<label for="line1">Address</label><input id="line1" autocomplete="address-line1">' +
      '<div class="row">' +
        '<div><label for="city">Town or city</label><input id="city" autocomplete="address-level2"></div>' +
        '<div><label for="postcode">ZIP</label><input id="postcode" autocomplete="postal-code"></div>' +
      '</div>' +
      '<label for="anotes">Anything we should know? (parking, stairs, table space)</label>' +
      '<textarea id="anotes" rows="3"></textarea>' +
      '<button class="primary" id="next" type="button">Continue</button>';

    wireBack(start);
    document.getElementById('next').addEventListener('click', function () {
      var line1 = document.getElementById('line1').value.trim();
      if (!line1) {
        document.getElementById('err').innerHTML = error('Please enter an address.');
        return;
      }
      state.address = {
        line1: line1,
        city: document.getElementById('city').value.trim() || undefined,
        postcode: document.getElementById('postcode').value.trim() || undefined,
        notes: document.getElementById('anotes').value.trim() || undefined
      };
      // Geocoding lands with the maps provider in W1.4; until then the studio
      // confirms coverage manually and the flow continues.
      if (state.service.bookingMode === 'APPOINTMENT') showStaff();
      else showTimes();
    });
  }

  // --- Step 3: instructor -------------------------------------------------
  function showStaff() {
    drawSteps('Instructor');
    app.innerHTML = back() + '<h2>Who with?</h2><p class="empty">Loading&hellip;</p>';
    wireBack(start);

    api('/public/' + DATA.slug + '/services/' + state.service.id + '/staff')
      .then(function (res) {
        if (!res.staff.length) {
          app.innerHTML = back() +
            '<h2>Who with?</h2>' +
            '<p class="empty">Nobody is set up to teach this yet. Please contact the studio.</p>';
          wireBack(start);
          return;
        }
        if (res.staff.length === 1) { state.staff = res.staff[0]; showTimes(); return; }

        app.innerHTML = back() + '<h2>Who with?</h2>' +
          res.staff.map(function (s) {
            return '<button class="card" type="button" data-staff="' + esc(s.id) + '">' +
              '<span class="swatch" style="background:' + esc(s.color) + '"></span><span>' +
              '<h3>' + esc(s.name) + '</h3>' +
              (s.bio ? '<p>' + esc(s.bio) + '</p>' : '') + '</span></button>';
          }).join('');

        wireBack(start);
        app.querySelectorAll('[data-staff]').forEach(function (el) {
          el.addEventListener('click', function () {
            var id = el.getAttribute('data-staff');
            for (var i = 0; i < res.staff.length; i++) {
              if (res.staff[i].id === id) state.staff = res.staff[i];
            }
            showTimes();
          });
        });
      })
      .catch(function (e) { app.innerHTML = back() + error(e.message); wireBack(start); });
  }

  // --- Step 4: time -------------------------------------------------------
  /**
   * G3 — what is included, where to go, what to bring.
   *
   * Rendered above the times rather than as a step of its own. A first-time
   * customer wants this BEFORE committing to a Tuesday, and a returning one
   * should not have to click past a screen they have read before — an extra
   * step would charge every booking for a question only some people have.
   *
   * Every part is omitted when empty, so a studio that has written nothing
   * gets the page it had before G3 rather than a set of blank headings.
   */
  function serviceDetail() {
    var s = state.service;
    if (!s) return '';

    var out = '';

    if (s.highlights) {
      var lines = s.highlights.split('\n').filter(function (l) {
        return l.trim() !== '';
      });
      if (lines.length) {
        out += '<h3>What is included</h3><ul class="included">' +
          lines.map(function (l) { return '<li>' + esc(l.trim()) + '</li>'; }).join('') +
          '</ul>';
      }
    }

    /* The meeting point is the LOCATION's address, not a column of its own.
       Only fixed venues publish one — a mobile studio's centre point is often
       its owner's home. */
    if (state.location && state.location.address) {
      out += '<h3>Where</h3><p class="hint">' + esc(state.location.name) +
        ' &middot; ' + esc(state.location.address) + '</p>';
    }

    if (s.preparationNotes) {
      out += '<h3>Before you come</h3><p class="hint">' +
        esc(s.preparationNotes) + '</p>';
    }

    var t = terms(s);
    if (t) out += '<h3>If you cannot make it</h3>' + t;

    return out ? '<div class="detail">' + out + '</div>' : '';
  }

  /*
    G4 — the month grid.

    What is loaded, which month is on screen, and which day is filtered to.
    Held here rather than passed around because the grid re-renders on paging
    and on selection, and neither refetches: one call covers the window and
    the rest is arithmetic.
  */
  var times = null;

  /** How far ahead the time step looks. Three months of paging in one call. */
  var WINDOW_DAYS = 90;

  /**
   * Groups what came back into calendar cells, keyed YYYY-MM-DD.
   *
   * Sessions carry their own seat count; appointment slots do not, so a day's
   * "count" is the number of start times on offer. Both answer the question a
   * calendar cell exists to answer — is there anything this day, and roughly
   * how much.
   */
  function byDayIndex() {
    var index = {};

    function add(key, seats) {
      if (!index[key]) index[key] = { count: 0, seats: 0 };
      index[key].count += 1;
      index[key].seats += seats;
    }

    if (times.mode === 'APPOINTMENT') {
      times.slots.forEach(function (s) { add(ymdIn(s.startsAt, times.tz), 0); });
    } else {
      times.sessions.forEach(function (s) {
        add(ymdIn(s.startsAt, times.tz), s.seatsAvailable);
      });
    }
    return index;
  }

  function calendar() {
    var index = byDayIndex();
    var months = Object.keys(index).map(function (d) { return d.slice(0, 7); });
    months = months.filter(function (m, i) { return months.indexOf(m) === i; }).sort();
    if (!months.length) return '';

    if (months.indexOf(times.month) === -1) times.month = months[0];
    var at = months.indexOf(times.month);

    var parts = times.month.split('-');
    var year = Number(parts[0]);
    var mon = Number(parts[1]) - 1;

    /*
      Built from a plain local Date, NOT from a zoned one. This is calendar
      arithmetic — how many days has September, and which weekday does it open
      on — and the answer does not depend on anybody's timezone. Only the
      KEYS come from the studio's zone, and those are already computed.
    */
    var first = new Date(year, mon, 1);
    var pad = first.getDay();
    var days = new Date(year, mon + 1, 0).getDate();

    var cells = '';
    for (var p = 0; p < pad; p++) cells += '<span class="cal-pad"></span>';

    for (var d = 1; d <= days; d++) {
      var key = year + '-' + String(mon + 1).padStart(2, '0') + '-' +
        String(d).padStart(2, '0');
      var day = index[key];
      var on = times.day === key ? ' on' : '';

      if (!day) {
        cells += '<span class="cal-day empty">' + d + '</span>';
      } else {
        cells += '<button type="button" class="cal-day' + on + '" data-day="' + key + '">' +
          '<span class="n">' + d + '</span>' +
          '<span class="c">' + (times.mode === 'APPOINTMENT'
            ? day.count
            : day.seats) + '</span></button>';
      }
    }

    return '<div class="cal">' +
      '<div class="cal-head">' +
        '<button type="button" class="cal-nav" id="calPrev"' +
          (at === 0 ? ' disabled' : '') + ' aria-label="Previous month">&larr;</button>' +
        '<b>' + esc(monthLabel(times.month)) + '</b>' +
        '<button type="button" class="cal-nav" id="calNext"' +
          (at === months.length - 1 ? ' disabled' : '') +
          ' aria-label="Next month">&rarr;</button>' +
      '</div>' +
      '<div class="cal-grid">' +
        ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (d, i) {
          return '<span class="cal-dow" aria-hidden="true" data-i="' + i + '">' + d + '</span>';
        }).join('') + cells +
      '</div>' +
      '<p class="tiny-note">' +
        (times.mode === 'APPOINTMENT'
          ? 'The number is how many start times are free that day.'
          : 'The number is how many places are still free that day.') +
        (times.day
          ? ' <button type="button" class="linkish" id="calAll">Show all dates</button>'
          : '') +
      '</p>' +
    '</div>';
  }

  function showTimes() {
    drawSteps('Time');
    app.innerHTML = back() + '<h2>Pick a time</h2><p class="empty">Checking availability&hellip;</p>';
    wireBack(start);

    var from = new Date();
    var to = new Date(Date.now() + WINDOW_DAYS * 86400000);

    var q = '?serviceTypeId=' + encodeURIComponent(state.service.id) +
      '&from=' + localDate(from) + '&to=' + localDate(to);
    if (state.location) q += '&locationId=' + encodeURIComponent(state.location.id);
    if (state.staff) q += '&staffId=' + encodeURIComponent(state.staff.id);

    api('/public/' + DATA.slug + '/availability' + q)
      .then(function (res) {
        times = {
          mode: res.mode,
          slots: res.slots || [],
          sessions: res.sessions || [],
          tz: (state.location && state.location.timezone) || DATA.timezone,
          month: null,
          day: null
        };
        paintTimes();
      })
      .catch(function (e) { app.innerHTML = back() + error(e.message); wireBack(start); });
  }

  /**
   * The times, with the calendar above them.
   *
   * The list stays. A grid answers "which Saturday" and a list answers "the
   * soonest thing", and those are different questions asked by different
   * people — the prototype has only the grid and is worse for it. Picking a
   * day filters the list; nothing refetches.
   */
  function paintTimes() {
    var tz = times.tz;
    /* The detail goes above the times, and above the two empty states as
       well: "no dates yet" is exactly when somebody wants to read what the
       class involves before deciding to check back. */
    var html = back() + '<h2>' + esc(state.service.name) + '</h2>' +
      serviceDetail() + '<h3>Pick a time</h3>';

    var empty = times.mode === 'APPOINTMENT'
      ? !times.slots.length
      : !times.sessions.length;

    if (empty) {
      app.innerHTML = html + '<p class="empty">' +
        (times.mode === 'APPOINTMENT'
          ? 'No times available in the next three months.'
          : 'No dates scheduled yet. Check back soon.') + '</p>';
      wireBack(start);
      return;
    }

    html += calendar();

    /**
     * The list shows what the grid above it is describing.
     *
     * Scoped to the visible MONTH, then to the chosen day when there is one.
     * Without the month scope, paging to October left September at the top of
     * the list — a grid and a list side by side, disagreeing about which weeks
     * they are talking about.
     *
     * "Soonest thing" still works: the grid opens on the first month that has
     * anything, so the default view is the next few dates.
     */
    function keep(iso) {
      var key = ymdIn(iso, tz);
      if (times.day) return key === times.day;
      return !times.month || key.slice(0, 7) === times.month;
    }

    if (times.mode === 'APPOINTMENT') {
      var byDay = {};
      times.slots.filter(function (s) { return keep(s.startsAt); })
        .forEach(function (s) {
          var d = dayIn(s.startsAt, tz);
          (byDay[d] = byDay[d] || []).push(s);
        });
      Object.keys(byDay).forEach(function (day) {
        html += '<div class="day">' + esc(day) + '</div><div class="slots">' +
          byDay[day].map(function (s) {
            return '<button class="slot" type="button" data-at="' + esc(s.startsAt) +
              '" data-staff="' + esc(s.staffId) + '">' + esc(timeIn(s.startsAt, tz)) +
              '</button>';
          }).join('') + '</div>';
      });
    } else {
      html += times.sessions.filter(function (s) { return keep(s.startsAt); })
        .map(function (s) {
          return '<button class="card" type="button" data-session="' + esc(s.sessionId) + '">' +
            '<span class="swatch" style="background:var(--clay)"></span><span>' +
            '<h3>' + esc(dayIn(s.startsAt, tz)) + ' at ' + esc(timeIn(s.startsAt, tz)) + '</h3>' +
            '<p>' + s.seatsAvailable + ' of ' + s.capacity + ' places left</p>' +
            '</span></button>';
        }).join('');
    }

    app.innerHTML = html;
    wireBack(start);

    /* Month paging walks the months that actually HAVE something, not the
       calendar's — skipping an empty November is better than showing it. */
    function months() {
      var index = byDayIndex();
      var list = Object.keys(index).map(function (d) { return d.slice(0, 7); });
      return list.filter(function (m, i) { return list.indexOf(m) === i; }).sort();
    }
    function step(by) {
      var list = months();
      var at = list.indexOf(times.month);
      if (list[at + by]) {
        times.month = list[at + by];
        /* The day filter is cleared on paging: a day selected in September is
           not on screen in October, and leaving it set would show a list that
           does not match the grid above it. */
        times.day = null;
        paintTimes();
      }
    }

    var prev = document.getElementById('calPrev');
    if (prev) prev.addEventListener('click', function () { step(-1); });
    var next = document.getElementById('calNext');
    if (next) next.addEventListener('click', function () { step(1); });
    var all = document.getElementById('calAll');
    if (all) all.addEventListener('click', function () {
      times.day = null;
      paintTimes();
    });

    app.querySelectorAll('[data-day]').forEach(function (el) {
      el.addEventListener('click', function () {
        var key = el.getAttribute('data-day');
        times.day = times.day === key ? null : key;
        paintTimes();
      });
    });

    app.querySelectorAll('[data-at]').forEach(function (el) {
      el.addEventListener('click', function () {
        state.slot = { startsAt: el.getAttribute('data-at'),
                       staffId: el.getAttribute('data-staff') };
        showDetails();
      });
    });
    app.querySelectorAll('[data-session]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-session');
        for (var i = 0; i < times.sessions.length; i++) {
          if (times.sessions[i].sessionId === id) state.session = times.sessions[i];
        }
        showDetails();
      });
    });
  }

  /*
    The cancellation terms, in words, BEFORE money moves.

    They existed only on the manage page until G1 — which is to say a customer
    could only read the terms after agreeing to them. The top tier is the one
    worth stating: it is the promise ("free cancellation up to N hours"), and
    the rest of the ladder is detail nobody reads standing at a checkout.
  */
  function terms(service) {
    /* Null for a cohort: its service is not in DATA.services, so the ladder is
       not to hand. Saying nothing beats guessing at somebody's refund terms. */
    if (!service) return '';
    var tiers = service.cancellationTiers;
    if (!tiers || !tiers.length) return '';

    var best = null;
    for (var i = 0; i < tiers.length; i++) {
      if (tiers[i].refundPercent >= 100) { best = tiers[i]; break; }
    }
    if (!best) return '';

    return '<p class="hint">Free cancellation up to ' + best.hoursBefore +
      ' hours before it starts.</p>';
  }

  /*
    The running total.

    Every number comes from /quote, which runs the same priceBooking the
    checkout runs. Nothing is multiplied here — a second copy of the deposit
    arithmetic in this file is how the summary and the charge drift apart.
  */
  function renderSummary(q) {
    var label = course ? course.name : state.service.name;
    var rows =
      '<div><span>' + esc(label) + (state.seats > 1
        ? ' &times; ' + state.seats : '') + '</span><span>' +
        money(q.subtotalCents) + '</span></div>';

    if (course) {
      rows += '<div><span>Sessions</span><span>' + course.sessionCount +
        '</span></div>';
    }

    if (q.travelFeeCents) {
      rows += '<div><span>Travel</span><span>' + money(q.travelFeeCents) +
        '</span></div>';
    }

    rows += '<div><span>Total</span><span>' + money(q.totalCents) + '</span></div>';

    if (q.willCharge && q.balanceCents > 0) {
      // A deposit. Both halves are stated, because "due now" alone reads as
      // the price and produces a surprise on the day.
      rows += '<div><span>Due now</span><span>' + money(q.dueNowCents) +
        '</span></div>' +
        '<div><span>Due on the day</span><span>' + money(q.balanceCents) +
        '</span></div>';
    }

    var note = q.willCharge
      ? '<p class="hint">You will be taken to our payment page to pay ' +
        money(q.dueNowCents) + '.</p>'
      : q.totalCents > 0
        ? '<p class="hint">Payable at the studio.</p>'
        : '';

    return '<div class="summary">' + rows + '</div>' + note + terms(state.service);
  }

  /** Asks the server what this costs. Never computes it. */
  function fetchQuote() {
    var body = {
      serviceTypeId: course ? course.service.id : state.service.id,
      seats: state.seats
    };
    /* The cohort's price wins over the service's drop-in rate. Sending the id
       rather than a price keeps that decision on the server, where checkout
       makes the same one. */
    if (course) body.courseSeriesId = course.id;
    if (state.coverage && state.coverage.travelFeeCents) {
      body.travelFeeCents = state.coverage.travelFeeCents;
    }

    return api('/public/' + DATA.slug + '/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function paintSummary() {
    var host = document.getElementById('summary');
    if (!host) return;

    /* Cleared first. A stale quote from a previously chosen service would
       otherwise decide which endpoint submits, and could send somebody to
       Stripe for a class they are no longer booking. */
    quote = null;

    fetchQuote()
      .then(function (q) {
        quote = q;
        host.innerHTML = renderSummary(q);
        var btn = document.getElementById('confirm');
        if (btn) {
          btn.textContent = q.willCharge ? 'Continue to payment' : 'Confirm booking';
        }
      })
      .catch(function () {
        /* A quote that will not load must not block a booking. The price is
           on the service card either way, and checkout recomputes it. */
        host.innerHTML = '';
      });
  }

  // --- Step 5: details ----------------------------------------------------
  function showDetails() {
    drawSteps('Details');
    var maxSeats = state.session ? state.session.seatsAvailable : 1;

    app.innerHTML = back() +
      '<h2>Your details</h2>' +
      '<div id="err"></div>' +
      '<label for="name">Full name</label><input id="name" autocomplete="name">' +
      '<label for="email">Email</label><input id="email" type="email" autocomplete="email">' +
      '<label for="phone">Mobile (optional)</label><input id="phone" type="tel" autocomplete="tel">' +
      (maxSeats > 1
        ? '<label for="seats">How many places?</label>' +
          '<input id="seats" type="number" min="1" max="' + maxSeats + '" value="1">'
        : '') +
      '<label for="notes">Anything else? (optional)</label><textarea id="notes" rows="3"></textarea>' +
      // TCPA: unbundled, opt-in, never pre-ticked.
      '<label class="check"><input type="checkbox" id="sms">' +
      '<span>Text me a reminder before my class. Message rates may apply, ' +
      'and you can reply STOP at any time.</span></label>' +
      '<div id="summary"></div>' +
      '<button class="primary" id="confirm" type="button">Confirm booking</button>';

    wireBack(showTimes);
    paintSummary();

    /* Re-quoted on change rather than multiplied locally — the deposit is not
       always a straight proportion of the total, so two places cannot be
       assumed to cost twice one. */
    var seatsInput = document.getElementById('seats');
    if (seatsInput) {
      seatsInput.addEventListener('change', function () {
        state.seats = parseInt(seatsInput.value, 10) || 1;
        paintSummary();
      });
    }

    document.getElementById('confirm').addEventListener('click', function () {
      var btn = this;
      var name = document.getElementById('name').value.trim();
      var email = document.getElementById('email').value.trim();
      var seatsEl = document.getElementById('seats');

      if (!name || !email) {
        document.getElementById('err').innerHTML = error('Please add your name and email.');
        return;
      }

      var body = {
        serviceTypeId: state.service.id,
        seats: seatsEl ? parseInt(seatsEl.value, 10) || 1 : 1,
        customer: {
          name: name, email: email,
          phone: document.getElementById('phone').value.trim() || undefined
        },
        smsConsent: document.getElementById('sms').checked,
        notes: document.getElementById('notes').value.trim() || undefined,
        source: BOOKING_SOURCE
      };
      if (state.location) body.locationId = state.location.id;
      if (state.address) body.serviceAddress = state.address;
      if (state.session) body.sessionId = state.session.sessionId;
      if (state.slot) { body.startsAt = state.slot.startsAt; body.staffId = state.slot.staffId; }

      var paying = quote && quote.willCharge;

      btn.disabled = true;
      btn.textContent = paying ? 'Taking you to payment...' : 'Booking...';

      function failed(e) {
        btn.disabled = false;
        btn.textContent = paying ? 'Continue to payment' : 'Confirm booking';
        document.getElementById('err').innerHTML = error(e.message);
      }

      if (paying) {
        /*
          Checkout, not /bookings.

          The seats are held server-side BEFORE the Stripe session exists, and
          the booking itself is created by the webhook — so this branch ends at
          a redirect and never renders a confirmation. Anything it rendered
          would be a guess about a payment that has not happened yet.

          Only the fields checkout accepts are sent. It has no notes, no SMS
          consent and no address field, and inventing them here would be
          inventing an API.
        */
        var checkout = {
          serviceTypeId: body.serviceTypeId,
          sessionId: body.sessionId,
          seats: body.seats,
          customer: body.customer
        };

        api('/public/' + DATA.slug + '/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(checkout)
        })
          .then(function (res) { location.href = res.checkoutUrl; })
          .catch(failed);
        return;
      }

      api('/public/' + DATA.slug + '/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(showConfirmed)
        .catch(failed);
    });
  }

  // --- Done ---------------------------------------------------------------
  function showConfirmed(res) {
    stepsEl.innerHTML = '';
    var tz = (state.location && state.location.timezone) || DATA.timezone;

    app.innerHTML =
      '<div class="ok">' +
      '<div class="tick">&#10003;</div>' +
      '<h2>You are booked in</h2>' +
      '<p class="hint">A confirmation is on its way to your email.</p>' +
      '<div class="summary">' +
        /* First, and the only identifier on this page safe to say aloud. */
        (res.booking.reference
          ? '<div><span>Reference</span><span class="ref">' +
            esc(res.booking.reference) + '</span></div>'
          : '') +
        '<div><span>Class</span><span>' + esc(state.service.name) + '</span></div>' +
        '<div><span>When</span><span>' + esc(dayIn(res.booking.startsAt, tz)) +
          ' at ' + esc(timeIn(res.booking.startsAt, tz)) + '</span></div>' +
        (state.staff ? '<div><span>With</span><span>' + esc(state.staff.name) + '</span></div>' : '') +
        (res.booking.seats > 1
          ? '<div><span>Places</span><span>' + res.booking.seats + '</span></div>' : '') +
        (res.booking.travelFeeCents
          ? '<div><span>Travel</span><span>' + money(res.booking.travelFeeCents) + '</span></div>' : '') +
        '<div><span>Total</span><span>' + money(res.booking.totalCents) + '</span></div>' +
      '</div>' +
      (state.service.preparationNotes
        ? '<div class="detail"><h3>Before you come</h3><p class="hint">' +
          esc(state.service.preparationNotes) + '</p></div>'
        : '') +
      '<div class="row-actions">' +
        '<a class="btn-link" href="/public/bookings/' +
          encodeURIComponent(res.manageToken) + '/calendar.ics">Add to calendar</a>' +
        '<a class="btn-link" href="/public/bookings/' +
          encodeURIComponent(res.manageToken) + '/manage">Manage or cancel</a>' +
      '</div>';
  }

  function start() {
    state = { service: null, location: null, staff: null, slot: null,
              session: null, address: null, coverage: null, seats: 1 };
    drawSteps('Class');
    location.reload();
  }

  /*
    Coming back from Stripe.

    startCheckout sends the customer to ?paid=1 or ?cancelled=1 on this same
    page. Neither is the source of truth: the booking is created by the WEBHOOK,
    not by the browser returning, so a customer who pays and closes the tab is
    still booked. That is why the paid branch says the confirmation is on its
    way rather than rendering a booking it has not been told about.
  */
  function returnedFromCheckout() {
    /* Course checkout returns to ?enrolled=1, class checkout to ?paid=1. The
       message is the same; only the wording of what was bought differs. */
    if (/(?:^|[?&])enrolled=1(?:&|$)/.test(location.search)) {
      stepsEl.innerHTML = '';
      app.innerHTML =
        '<div class="ok">' +
        '<div class="tick">&#10003;</div>' +
        '<h2>Payment received</h2>' +
        '<p class="hint">Your place on the course is booked, every week of it. ' +
        'A confirmation is on its way to your email — it carries the link to ' +
        'manage or cancel it.</p>' +
        '</div>';
      return true;
    }

    if (/(?:^|[?&])paid=1(?:&|$)/.test(location.search)) {
      stepsEl.innerHTML = '';
      app.innerHTML =
        '<div class="ok">' +
        '<div class="tick">&#10003;</div>' +
        '<h2>Payment received</h2>' +
        '<p class="hint">Your place is booked. A confirmation is on its way to ' +
        'your email — it carries the link to manage or cancel it.</p>' +
        '</div>';
      return true;
    }

    if (/(?:^|[?&])cancelled=1(?:&|$)/.test(location.search)) {
      /* The hold expires on its own; saying so is kinder than silence and
         stops somebody refreshing in a panic because their seat "vanished". */
      app.insertAdjacentHTML('afterbegin',
        '<div class="err">Payment was cancelled, so nothing has been charged ' +
        'and the places have been released. You can start again below.</div>');
    }

    return false;
  }

  // Upgrade the server-rendered lists into step one.
  if (!returnedFromCheckout()) {
    drawSteps('Class');
    document.querySelectorAll('[data-service]').forEach(function (el) {
      el.addEventListener('click', function () {
        pickService(el.getAttribute('data-service'));
      });
    });
    document.querySelectorAll('[data-course]').forEach(function (el) {
      el.addEventListener('click', function () {
        pickCourse(el.getAttribute('data-course'));
      });
    });
  }
})();
`;
