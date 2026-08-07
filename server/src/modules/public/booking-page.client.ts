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

  var state = {
    service: null, location: null, staff: null,
    slot: null, session: null, address: null, coverage: null, seats: 1
  };

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
  function error(msg) {
    return '<div class="err">' + esc(msg) + '</div>';
  }

  // Which steps this particular booking actually needs.
  function plan() {
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
  function showTimes() {
    drawSteps('Time');
    app.innerHTML = back() + '<h2>Pick a time</h2><p class="empty">Checking availability&hellip;</p>';
    wireBack(start);

    var from = new Date();
    var to = new Date(Date.now() + 28 * 86400000);

    var q = '?serviceTypeId=' + encodeURIComponent(state.service.id) +
      '&from=' + localDate(from) + '&to=' + localDate(to);
    if (state.location) q += '&locationId=' + encodeURIComponent(state.location.id);
    if (state.staff) q += '&staffId=' + encodeURIComponent(state.staff.id);

    api('/public/' + DATA.slug + '/availability' + q)
      .then(function (res) {
        var tz = (state.location && state.location.timezone) || DATA.timezone;
        var html = back() + '<h2>Pick a time</h2>';

        if (res.mode === 'APPOINTMENT') {
          if (!res.slots.length) {
            app.innerHTML = html + '<p class="empty">No times available in the next four weeks.</p>';
            wireBack(start); return;
          }
          var byDay = {};
          res.slots.forEach(function (s) {
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
          if (!res.sessions.length) {
            app.innerHTML = html + '<p class="empty">No dates scheduled yet. Check back soon.</p>';
            wireBack(start); return;
          }
          html += res.sessions.map(function (s) {
            return '<button class="card" type="button" data-session="' + esc(s.sessionId) + '">' +
              '<span class="swatch" style="background:var(--clay)"></span><span>' +
              '<h3>' + esc(dayIn(s.startsAt, tz)) + ' at ' + esc(timeIn(s.startsAt, tz)) + '</h3>' +
              '<p>' + s.seatsAvailable + ' of ' + s.capacity + ' places left</p>' +
              '</span></button>';
          }).join('');
        }

        app.innerHTML = html;
        wireBack(start);

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
            for (var i = 0; i < res.sessions.length; i++) {
              if (res.sessions[i].sessionId === id) state.session = res.sessions[i];
            }
            showDetails();
          });
        });
      })
      .catch(function (e) { app.innerHTML = back() + error(e.message); wireBack(start); });
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
      '<button class="primary" id="confirm" type="button">Confirm booking</button>';

    wireBack(showTimes);

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
        notes: document.getElementById('notes').value.trim() || undefined
      };
      if (state.location) body.locationId = state.location.id;
      if (state.address) body.serviceAddress = state.address;
      if (state.session) body.sessionId = state.session.sessionId;
      if (state.slot) { body.startsAt = state.slot.startsAt; body.staffId = state.slot.staffId; }

      btn.disabled = true;
      btn.textContent = 'Booking...';

      api('/public/' + DATA.slug + '/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(showConfirmed)
        .catch(function (e) {
          btn.disabled = false;
          btn.textContent = 'Confirm booking';
          document.getElementById('err').innerHTML = error(e.message);
        });
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
      '<p class="hint"><a href="/public/bookings/' + encodeURIComponent(res.manageToken) +
        '/manage">Manage or cancel this booking</a></p>' +
      '</div>';
  }

  function start() {
    state = { service: null, location: null, staff: null, slot: null,
              session: null, address: null, coverage: null, seats: 1 };
    drawSteps('Class');
    location.reload();
  }

  // Upgrade the server-rendered service list into step one.
  drawSteps('Class');
  document.querySelectorAll('[data-service]').forEach(function (el) {
    el.addEventListener('click', function () {
      pickService(el.getAttribute('data-service'));
    });
  });
})();
`;
