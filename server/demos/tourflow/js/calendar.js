/* ==========================================================================
   TourFlow — Calendar & availability
   Month / week / day views over the schedule, plus slot creation (including
   recurring series), date blocking, and the departure drawer.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  var mode = 'month';
  var cursor = null;        // 'YYYY-MM-DD' anchoring the visible range
  var selected = null;      // selected day
  var actFilter = '';

  TF.views.calendar = function (root, params) {
    if (params.activity) actFilter = params.activity;
    if (params.date) { cursor = params.date; selected = params.date; }
    if (!cursor) cursor = TF.today();
    if (!selected) selected = TF.today();
    var s = TF.state();

    root.innerHTML =
      '<div class="page-head">' +
        '<div class="ph-text"><h1>Calendar</h1><p class="lede">Departures, capacity and who is running what.</p></div>' +
        '<div class="ph-actions">' +
          '<select class="select" id="calAct" style="height:36px;width:auto"><option value="">All activities</option>' +
            TF.options(s.activities, actFilter, 'id', 'name') + '</select>' +
          '<button class="btn" id="calBlock">' + TF.icon('lock') + ' Block a date</button>' +
          '<button class="btn btn-primary" id="calAdd">' + TF.icon('plus') + ' Add Time Slot</button>' +
        '</div>' +
      '</div>' +

      '<div class="grid split" style="grid-template-columns:minmax(0,1fr) 360px;gap:16px" id="calSplit">' +
        '<section class="card">' +
          '<div class="card-head">' +
            '<button class="icon-btn" id="calPrev">' + TF.icon('chevL') + '</button>' +
            '<button class="icon-btn" id="calNext">' + TF.icon('chevR') + '</button>' +
            '<h2 id="calTitle" style="margin-left:4px"></h2>' +
            '<div class="right">' +
              '<button class="btn btn-sm" id="calToday">Today</button>' +
              '<div class="seg" id="calMode">' +
                '<button data-m="month" class="' + (mode === 'month' ? 'on' : '') + '">Month</button>' +
                '<button data-m="week" class="' + (mode === 'week' ? 'on' : '') + '">Week</button>' +
                '<button data-m="day" class="' + (mode === 'day' ? 'on' : '') + '">Day</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div id="calBody"></div>' +
        '</section>' +
        '<aside id="calSide"></aside>' +
      '</div>';

    draw();

    root.querySelector('#calPrev').addEventListener('click', function () { step(-1); });
    root.querySelector('#calNext').addEventListener('click', function () { step(1); });
    root.querySelector('#calToday').addEventListener('click', function () {
      cursor = TF.today(); selected = TF.today(); draw();
    });
    TF.on(root, 'click', '#calMode button', function (e, el) {
      mode = el.dataset.m;
      TF.qsa('#calMode button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === mode); });
      draw();
    });
    root.querySelector('#calAct').addEventListener('change', function (e) { actFilter = e.target.value; draw(); });
    root.querySelector('#calAdd').addEventListener('click', function () { TF.slotForm(null, selected); });
    root.querySelector('#calBlock').addEventListener('click', function () { blockDate(); });

    TF.on(root, 'click', '[data-day]', function (e, el) {
      selected = el.dataset.day;
      if (mode === 'day') cursor = selected;
      draw();
    });
    TF.on(root, 'click', '[data-slot]', function (e, el) { e.stopPropagation(); TF.slotDrawer(el.dataset.slot); });

    function step(dir) {
      if (mode === 'month') {
        var d = TF.parseYmd(cursor);
        d.setMonth(d.getMonth() + dir);
        cursor = TF.ymd(d);
      } else if (mode === 'week') {
        cursor = TF.addDays(cursor, 7 * dir);
      } else {
        cursor = TF.addDays(cursor, dir);
        selected = cursor;
      }
      draw();
    }

    function draw() {
      var body = root.querySelector('#calBody');
      var title = root.querySelector('#calTitle');
      var d = TF.parseYmd(cursor);
      if (mode === 'month') {
        title.textContent = TF.MONTHS[d.getMonth()] + ' ' + d.getFullYear();
        body.innerHTML = monthGrid();
      } else if (mode === 'week') {
        var start = weekStart(cursor);
        title.textContent = TF.fmt.dateShort(start) + ' – ' + TF.fmt.dateShort(TF.addDays(start, 6)) + ', ' + d.getFullYear();
        body.innerHTML = weekGrid();
      } else {
        title.textContent = TF.fmt.date(cursor, true);
        body.innerHTML = dayList(cursor);
      }
      root.querySelector('#calSide').innerHTML = sidePanel(selected);
      var addBtn = root.querySelector('#sideAdd');
      if (addBtn) addBtn.addEventListener('click', function () { TF.slotForm(null, selected); });
      var unblock = root.querySelector('#sideUnblock');
      if (unblock) unblock.addEventListener('click', function () {
        TF.update(function (st) { st.blocked = st.blocked.filter(function (b) { return b.date !== selected; }); });
        TF.toast('Date unblocked', TF.fmt.date(selected) + ' is open for bookings again.');
        draw();
      });
    }
  };

  function weekStart(key) {
    var d = TF.parseYmd(key);
    return TF.addDays(key, -d.getDay());
  }

  function slotsFor(key) {
    return TF.sel.slotsOn(key).filter(function (sl) { return !actFilter || sl.activityId === actFilter; });
  }

  /* ------------------------------------------------------------- month */
  function monthGrid() {
    var d = TF.parseYmd(cursor);
    var first = new Date(d.getFullYear(), d.getMonth(), 1);
    var startKey = TF.addDays(TF.ymd(first), -first.getDay());
    var html = '<div class="cal-grid">' + TF.DAYS_S.map(function (x) { return '<div class="cal-dow">' + x + '</div>'; }).join('') + '</div>' +
      '<div class="cal-grid">';
    for (var i = 0; i < 42; i++) {
      var key = TF.addDays(startKey, i);
      var kd = TF.parseYmd(key);
      var out = kd.getMonth() !== d.getMonth();
      var slots = slotsFor(key);
      var blocked = TF.sel.isBlocked(key);
      html += '<div class="cal-cell' + (out ? ' out' : '') + (key === TF.today() ? ' today' : '') +
        (key === selected ? ' sel' : '') + (blocked ? ' blocked' : '') + '" data-day="' + key + '">' +
        '<div class="dn">' + kd.getDate() + '</div>' +
        (blocked ? '<div class="cal-ev" style="background:var(--bad-50);color:var(--bad-700);border-left-color:var(--bad-600)">Blocked</div>' : '') +
        slots.slice(0, 3).map(function (sl) {
          var booked = TF.sel.booked(sl.id);
          var pct = booked / sl.capacity;
          var cls = pct >= 1 ? 'full' : pct < 0.4 ? 'low' : '';
          var a = TF.sel.activity(sl.activityId);
          return '<div class="cal-ev ' + cls + '" data-slot="' + sl.id + '">' + TF.fmt.time(sl.start).replace(':00', '') +
            ' ' + TF.esc(a ? a.name : '') + ' ' + booked + '/' + sl.capacity + '</div>';
        }).join('') +
        (slots.length > 3 ? '<div class="cal-more">+' + (slots.length - 3) + ' more</div>' : '') +
        (slots.length ? '<div class="cal-dotrow">' + slots.slice(0, 6).map(function () { return '<i class="cal-dot"></i>'; }).join('') + '</div>' : '') +
        '</div>';
    }
    return html + '</div>';
  }

  /* -------------------------------------------------------------- week */
  function weekGrid() {
    var start = weekStart(cursor);
    var days = [];
    for (var i = 0; i < 7; i++) days.push(TF.addDays(start, i));
    return '<div class="cal-grid">' + days.map(function (key) {
      var kd = TF.parseYmd(key);
      return '<div class="cal-dow">' + TF.DAYS_S[kd.getDay()] + ' ' + kd.getDate() + '</div>';
    }).join('') + '</div>' +
    '<div class="cal-grid">' + days.map(function (key) {
      var slots = slotsFor(key);
      var blocked = TF.sel.isBlocked(key);
      return '<div class="cal-cell' + (key === TF.today() ? ' today' : '') + (key === selected ? ' sel' : '') +
        (blocked ? ' blocked' : '') + '" data-day="' + key + '" style="min-height:320px">' +
        (blocked ? '<div class="cal-ev" style="background:var(--bad-50);color:var(--bad-700)">Blocked</div>' : '') +
        (slots.length ? slots.map(function (sl) {
          var a = TF.sel.activity(sl.activityId);
          var booked = TF.sel.booked(sl.id);
          var pct = booked / sl.capacity;
          return '<div class="cal-ev ' + (pct >= 1 ? 'full' : pct < 0.4 ? 'low' : '') + '" data-slot="' + sl.id + '" ' +
            'style="white-space:normal;padding:5px 6px;margin-bottom:4px">' +
            '<b>' + TF.fmt.time(sl.start) + '</b><br>' + TF.esc(a ? a.name : '') +
            '<br><span style="opacity:.75">' + booked + '/' + sl.capacity + ' · ' + TF.esc(TF.sel.staffName(sl.guideId)) + '</span></div>';
        }).join('') : '<div class="tiny muted" style="padding:6px">No departures</div>') +
        '</div>';
    }).join('') + '</div>';
  }

  /* --------------------------------------------------------------- day */
  function dayList(key) {
    var slots = slotsFor(key);
    var blocked = TF.sel.isBlocked(key);
    if (blocked) {
      return '<div class="card-body"><div class="card" style="background:var(--bad-50);border-color:var(--bad-100)">' +
        '<div class="card-body"><b style="color:var(--bad-700)">' + TF.fmt.date(key, true) + ' is blocked</b>' +
        '<div class="small" style="color:var(--bad-700)">' + TF.esc(blocked.reason) + '</div></div></div></div>';
    }
    if (!slots.length) {
      return TF.emptyState('calendar', 'Nothing scheduled', 'Add a departure to open this day for bookings.',
        '<button class="btn btn-primary btn-sm" id="sideAdd">' + TF.icon('plus') + ' Add time slot</button>');
    }
    return slots.map(function (sl) {
      var a = TF.sel.activity(sl.activityId);
      var booked = TF.sel.booked(sl.id);
      var pct = Math.round((booked / sl.capacity) * 100);
      var t = TF.fmt.time(sl.start).split(' ');
      return '<div class="sched-row" data-slot="' + sl.id + '">' +
        '<div class="sched-time">' + t[0] + '<span class="mer">' + t[1] + '</span></div>' +
        '<div class="sched-bar" style="background:linear-gradient(180deg,' + a.grad[0] + ',' + a.grad[1] + ')"></div>' +
        '<div class="sched-main"><div class="nm">' + a.emoji + ' ' + TF.esc(a.name) + '</div>' +
          '<div class="mt"><span>' + TF.icon('clock', 12) + ' ' + TF.fmt.time(sl.start) + ' – ' + TF.fmt.time(sl.end) + '</span>' +
          '<span>' + TF.icon('badge', 12) + ' ' + TF.esc(TF.sel.staffName(sl.guideId)) + '</span>' +
          '<span>' + TF.icon('dollar', 12) + ' ' + TF.fmt.money(sl.price) + '</span></div></div>' +
        '<div class="sched-cap"><div class="txt"><span>' + booked + ' / ' + sl.capacity + '</span>' +
          '<span class="muted">' + pct + '%</span></div>' +
          '<div class="progress ' + (pct >= 90 ? 'red' : pct >= 60 ? 'amber' : 'green') + '">' +
          '<i style="width:' + Math.min(100, pct) + '%"></i></div></div>' +
        '<div class="sched-rev">' + TF.fmt.money(TF.sel.bookingsForSlot(sl.id).reduce(function (n, b) { return n + b.amount; }, 0)) + '</div>' +
        '</div>';
    }).join('');
  }

  /* -------------------------------------------------------- side panel */
  function sidePanel(key) {
    var slots = slotsFor(key);
    var blocked = TF.sel.isBlocked(key);
    var bookings = TF.sel.bookingsOn(key).filter(function (b) { return b.status !== 'Cancelled'; });
    var guests = bookings.reduce(function (n, b) { return n + b.guests; }, 0);
    var capacity = slots.reduce(function (n, sl) { return n + sl.capacity; }, 0);

    return '<div class="card"><div class="card-head"><div><h2>' + TF.fmt.dateShort(key) + '</h2>' +
      '<div class="sub">' + TF.DAYS[TF.parseYmd(key).getDay()] + '</div></div>' +
      '<div class="right"><button class="btn btn-sm btn-primary" id="sideAdd">' + TF.icon('plus') + ' Slot</button></div></div>' +
      (blocked
        ? '<div class="card-body"><div class="badge badge-cancelled"><i class="bdot"></i>Blocked</div>' +
          '<p class="small mt-2">' + TF.esc(blocked.reason) + '</p>' +
          '<button class="btn btn-sm mt-2" id="sideUnblock">Unblock this date</button></div>'
        : '<div class="card-body">' +
            '<div class="grid grid-3" style="gap:8px">' +
              '<div class="stat-tile"><div class="l">Departures</div><div class="v">' + slots.length + '</div></div>' +
              '<div class="stat-tile"><div class="l">Guests</div><div class="v">' + guests + '</div></div>' +
              '<div class="stat-tile"><div class="l">Revenue</div><div class="v">' +
                TF.fmt.money(TF.sel.revenueOn(key)) + '</div></div>' +
            '</div>' +
            '<div class="section-title mt-3">Utilisation</div>' +
            '<div class="progress ' + (capacity && guests / capacity > 0.8 ? 'red' : 'green') + '">' +
              '<i style="width:' + (capacity ? Math.min(100, Math.round((guests / capacity) * 100)) : 0) + '%"></i></div>' +
            '<div class="tiny muted mt-1">' + guests + ' of ' + capacity + ' seats sold</div>' +
            '<div class="section-title mt-3">Departures</div>' +
            (slots.length ? '<div class="mini-list">' + slots.map(function (sl) {
              var a = TF.sel.activity(sl.activityId);
              var booked = TF.sel.booked(sl.id);
              return '<div class="mini-row" style="cursor:pointer" data-slot="' + sl.id + '">' +
                '<span style="font-size:16px">' + a.emoji + '</span>' +
                '<span style="flex:1"><b>' + TF.fmt.time(sl.start) + '</b> ' + TF.esc(a.name) +
                '<div class="tiny muted">' + TF.esc(TF.sel.staffName(sl.guideId)) + '</div></span>' +
                '<span class="small strong">' + booked + '/' + sl.capacity + '</span></div>';
            }).join('') + '</div>' : '<p class="small muted">Nothing scheduled.</p>') +
          '</div>') +
      '</div>';
  }

  /* -------------------------------------------------------- slot drawer */
  TF.slotDrawer = function (slotId) {
    var sl = TF.sel.slot(slotId);
    if (!sl) return;
    var a = TF.sel.activity(sl.activityId);
    var bookings = TF.sel.bookingsForSlot(slotId);
    var booked = TF.sel.booked(slotId);

    var ctx = TF.drawer({
      eyebrow: TF.fmt.date(sl.date, true),
      title: a.name,
      subtitle: TF.fmt.time(sl.start) + ' – ' + TF.fmt.time(sl.end) + ' · ' + TF.sel.staffName(sl.guideId),
      body:
        '<div class="grid grid-3 mb-3">' +
          '<div class="stat-tile"><div class="l">Booked</div><div class="v">' + booked + '/' + sl.capacity + '</div></div>' +
          '<div class="stat-tile"><div class="l">Seats left</div><div class="v">' + TF.sel.seatsLeft(sl) + '</div></div>' +
          '<div class="stat-tile"><div class="l">Revenue</div><div class="v">' +
            TF.fmt.money(bookings.reduce(function (n, b) { return n + b.amount; }, 0)) + '</div></div>' +
        '</div>' +
        '<div class="section-title">Assigned guide</div>' +
        '<div class="card mb-3"><div class="card-body row">' +
          '<span class="avatar">' + TF.fmt.initials(TF.sel.staffName(sl.guideId)) + '</span>' +
          '<div style="flex:1"><b>' + TF.esc(TF.sel.staffName(sl.guideId)) + '</b>' +
          '<div class="small muted">' + (sl.guideId ? TF.esc(TF.sel.staff(sl.guideId).role) : 'Nobody is running this departure') + '</div></div>' +
          '<button class="btn btn-sm" id="sdAssign">Reassign</button></div></div>' +
        '<div class="section-title">Guest list</div>' +
        (bookings.length ? '<div class="mini-list">' + bookings.map(function (b) {
          var c = TF.sel.customer(b.customerId);
          return '<div class="mini-row" style="cursor:pointer" data-booking="' + b.id + '">' +
            '<span class="avatar sm">' + TF.fmt.initials(c ? c.name : '?') + '</span>' +
            '<span style="flex:1"><b>' + TF.esc(c ? c.name : '') + '</b>' +
            '<div class="tiny muted">' + b.id + ' · ' + b.guests + ' guests · ' + TF.esc(b.source) + '</div></span>' +
            TF.badge(b.paymentStatus) + '</div>';
        }).join('') + '</div>' : '<p class="small muted">No bookings on this departure yet.</p>') +
        '<div class="section-title mt-3">Slot settings</div>' +
        '<dl class="dl"><dt>Capacity</dt><dd>' + sl.capacity + ' seats</dd>' +
        '<dt>Price</dt><dd>' + TF.fmt.money(sl.price) + ' per adult</dd>' +
        '<dt>Status</dt><dd>' + TF.badge(sl.status) + '</dd></dl>',
      footer:
        '<button class="btn btn-primary btn-sm" id="sdBook">' + TF.icon('plus') + ' Add booking</button>' +
        '<button class="btn btn-sm" id="sdEdit">' + TF.icon('edit') + ' Edit slot</button>' +
        '<button class="btn btn-sm" id="sdManifest">' + TF.icon('file') + ' Manifest</button>' +
        '<button class="btn btn-danger btn-sm" id="sdDelete">' + TF.icon('trash') + ' Delete slot</button>'
    });

    TF.on(ctx.el, 'click', '[data-booking]', function (e, el) {
      ctx.close(); TF.bookingDrawer(el.dataset.booking);
    });
    ctx.el.querySelector('#sdBook').addEventListener('click', function () {
      ctx.close();
      TF.bookingForm(null, TF.rerender, { activityId: sl.activityId, date: sl.date, slotId: sl.id });
    });
    ctx.el.querySelector('#sdEdit').addEventListener('click', function () { ctx.close(); TF.slotForm(sl.id); });
    ctx.el.querySelector('#sdAssign').addEventListener('click', function () { ctx.close(); assignGuide(sl.id); });
    ctx.el.querySelector('#sdManifest').addEventListener('click', function () {
      ctx.close(); TF.go('manifest', { date: sl.date, slot: sl.id });
    });
    ctx.el.querySelector('#sdDelete').addEventListener('click', function () {
      ctx.close();
      TF.confirm({
        title: 'Delete this departure?',
        message: bookings.length
          ? 'There are ' + bookings.length + ' bookings on it. Delete the departure and those guests lose their slot — cancel the bookings first.'
          : 'Nobody has booked it, so this is safe to remove.',
        confirmText: 'Delete departure',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        TF.update(function (s) {
          s.schedule = s.schedule.filter(function (x) { return x.id !== sl.id; });
          TF.log('schedule', 'Departure removed from ' + sl.date);
        });
        TF.toast('Departure deleted', TF.fmt.time(sl.start) + ' on ' + TF.fmt.date(sl.date) + ' removed.');
        TF.rerender();
      });
    });
  };

  function assignGuide(slotId) {
    var sl = TF.sel.slot(slotId);
    var eligible = TF.state().staff.filter(function (m) { return m.activities.indexOf(sl.activityId) !== -1; });
    var ctx = TF.modal({
      title: 'Assign a guide',
      subtitle: TF.sel.activityName(sl.activityId) + ' · ' + TF.fmt.date(sl.date) + ' ' + TF.fmt.time(sl.start),
      size: 'narrow',
      body: '<div class="field"><label>Guide</label><select class="select" id="agSel">' +
        '<option value="">Unassigned</option>' + eligible.map(function (m) {
          var busy = TF.state().schedule.filter(function (x) {
            return x.guideId === m.id && x.date === sl.date && x.id !== sl.id;
          }).length;
          return '<option value="' + m.id + '"' + (m.id === sl.guideId ? ' selected' : '') + '>' +
            TF.esc(m.name) + ' — ' + m.role + (busy ? ' (' + busy + ' other departures that day)' : ' (free)') +
            (m.status === 'On Leave' ? ' · on leave' : '') + '</option>';
        }).join('') + '</select></div>',
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="agSave">Assign</button>'
    });
    ctx.el.querySelector('#agSave').addEventListener('click', function () {
      var id = ctx.el.querySelector('#agSel').value || null;
      TF.update(function (s) {
        sl.guideId = id;
        // Bookings inherit the departure's guide so the manifest stays truthful.
        s.bookings.forEach(function (b) { if (b.slotId === sl.id) b.guideId = id; });
        TF.log('schedule', 'Guide assigned to ' + TF.sel.activityName(sl.activityId) + ' on ' + sl.date);
      });
      ctx.close();
      TF.toast('Guide assigned', TF.sel.staffName(id) + ' is now running this departure.');
      TF.rerender();
    });
  }

  /* --------------------------------------------------------- slot form */
  TF.slotForm = function (slotId, presetDate) {
    var s = TF.state();
    var sl = slotId ? TF.sel.slot(slotId) : null;
    var actId = sl ? sl.activityId : s.activities[0].id;

    var ctx = TF.modal({
      title: sl ? 'Edit departure' : 'Add time slot',
      subtitle: sl ? 'Changing capacity affects what the booking page offers' : 'Open a new departure for bookings',
      body:
        '<form id="slForm" class="form-grid">' +
          '<div class="field"><label>Activity</label><select class="select" name="activityId" id="slAct">' +
            TF.options(s.activities, actId, 'id', 'name') + '</select></div>' +
          '<div class="field"><label>Date</label><input class="input" type="date" name="date" value="' +
            (sl ? sl.date : (presetDate || TF.today())) + '"></div>' +
          '<div class="field"><label>Start time</label><input class="input" type="time" name="start" value="' +
            (sl ? sl.start : '10:00') + '"></div>' +
          '<div class="field"><label>End time</label><input class="input" type="time" name="end" value="' +
            (sl ? sl.end : '12:00') + '"></div>' +
          '<div class="field"><label>Capacity</label><input class="input" type="number" min="1" name="capacity" value="' +
            (sl ? sl.capacity : 10) + '"></div>' +
          '<div class="field"><label>Price per adult</label><input class="input" type="number" min="0" name="price" value="' +
            (sl ? sl.price : TF.sel.activity(actId).price) + '"></div>' +
          '<div class="field"><label>Assigned guide</label><select class="select" name="guideId" id="slGuide"></select></div>' +
          '<div class="field"><label>Status</label><select class="select" name="status">' +
            TF.options(['Open', 'Cancelled'], sl ? sl.status : 'Open') + '</select></div>' +
          (sl ? '' :
            '<div class="fieldset-title">Repeat</div>' +
            '<div class="field full"><label class="check"><input type="checkbox" name="repeat" id="slRepeat"> ' +
              'Create a recurring series</label></div>' +
            '<div class="full" id="slRepeatBox" style="display:none"><div class="form-grid">' +
              '<div class="field full"><label>On these days</label><div class="chip-group" id="slDays">' +
                TF.DAYS_S.map(function (d, i) { return '<button type="button" class="chip" data-day="' + i + '">' + d + '</button>'; }).join('') +
              '</div></div>' +
              '<div class="field"><label>Repeat for</label><select class="select" name="weeks">' +
                TF.options(['2 weeks', '4 weeks', '8 weeks', '12 weeks'], '4 weeks') + '</select></div>' +
              '<div class="field"><label>Skip blocked dates</label><select class="select" name="skipBlocked">' +
                TF.options(['Yes', 'No'], 'Yes') + '</select></div>' +
            '</div></div>') +
        '</form>',
      footer: '<button class="btn" data-close>Cancel</button>' +
        '<button class="btn btn-primary" id="slSave">' + (sl ? 'Save departure' : 'Create departure') + '</button>'
    });

    var el = ctx.el;
    var repeatDays = [];
    fillGuides();
    el.querySelector('#slAct').addEventListener('change', function () {
      fillGuides();
      var a = TF.sel.activity(el.querySelector('#slAct').value);
      el.querySelector('[name="price"]').value = a.price;
      el.querySelector('[name="capacity"]').value = a.capacity;
    });

    if (el.querySelector('#slRepeat')) {
      el.querySelector('#slRepeat').addEventListener('change', function (e) {
        el.querySelector('#slRepeatBox').style.display = e.target.checked ? 'block' : 'none';
      });
      TF.on(el, 'click', '[data-day]', function (e, b) {
        var d = +b.dataset.day;
        var i = repeatDays.indexOf(d);
        if (i === -1) repeatDays.push(d); else repeatDays.splice(i, 1);
        b.classList.toggle('on');
      });
    }

    function fillGuides() {
      var aId = el.querySelector('#slAct').value;
      var eligible = TF.state().staff.filter(function (m) { return m.activities.indexOf(aId) !== -1; });
      el.querySelector('#slGuide').innerHTML = '<option value="">Unassigned</option>' +
        TF.options(eligible, sl ? sl.guideId : '', 'id', 'name');
    }

    el.querySelector('#slSave').addEventListener('click', function () {
      var d = TF.formData(el.querySelector('#slForm'));
      if (!d.date || !d.start) return TF.toast('Missing details', 'A departure needs a date and a start time.', 'err');

      if (sl) {
        var booked = TF.sel.booked(sl.id);
        if (+d.capacity < booked) {
          return TF.toast('Capacity too low', booked + ' seats are already sold on this departure.', 'err');
        }
        TF.update(function () {
          sl.activityId = d.activityId; sl.date = d.date; sl.start = d.start; sl.end = d.end;
          sl.capacity = +d.capacity; sl.price = +d.price; sl.guideId = d.guideId || null; sl.status = d.status;
          TF.log('schedule', 'Departure updated on ' + d.date);
        });
        TF.toast('Departure saved', TF.fmt.time(d.start) + ' on ' + TF.fmt.date(d.date) + ' updated.');
      } else {
        var dates = [d.date];
        if (d.repeat && repeatDays.length) {
          var weeks = parseInt(d.weeks, 10) || 4;
          dates = [];
          for (var i = 0; i < weeks * 7; i++) {
            var key = TF.addDays(d.date, i);
            if (repeatDays.indexOf(TF.parseYmd(key).getDay()) === -1) continue;
            if (d.skipBlocked === 'Yes' && TF.sel.isBlocked(key)) continue;
            dates.push(key);
          }
        }
        TF.update(function (st) {
          dates.forEach(function (key) {
            st.schedule.push({
              id: TF.sel.nextSlotId(), activityId: d.activityId, date: key,
              start: d.start, end: d.end, capacity: +d.capacity, price: +d.price,
              guideId: d.guideId || null, status: d.status
            });
          });
          TF.log('schedule', dates.length + ' departures created');
        });
        TF.toast(dates.length > 1 ? dates.length + ' departures created' : 'Departure created',
          TF.sel.activityName(d.activityId) + ' is now bookable' + (dates.length > 1 ? ' across ' + dates.length + ' dates.' : ' on ' + TF.fmt.date(d.date) + '.'));
      }
      ctx.close();
      TF.rerender();
    });
  };

  /* -------------------------------------------------------- block date */
  function blockDate() {
    var ctx = TF.modal({
      title: 'Block a date',
      subtitle: 'Nothing can be booked on a blocked date',
      size: 'narrow',
      body: '<div class="form-grid">' +
        '<div class="field full"><label>Date</label><input class="input" type="date" id="bdDate" value="' + (selected || TF.today()) + '"></div>' +
        '<div class="field full"><label>Reason</label><input class="input" id="bdReason" placeholder="Closed for maintenance"></div>' +
        '<div class="field full"><label class="check"><input type="checkbox" id="bdCancel"> ' +
          'Also cancel the bookings already on that date</label></div>' +
        '</div>',
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="bdGo">Block date</button>'
    });
    ctx.el.querySelector('#bdGo').addEventListener('click', function () {
      var date = ctx.el.querySelector('#bdDate').value;
      var reason = ctx.el.querySelector('#bdReason').value || 'Closed';
      var alsoCancel = ctx.el.querySelector('#bdCancel').checked;
      if (!date) return;
      var affected = TF.sel.bookingsOn(date).filter(function (b) { return b.status !== 'Cancelled'; });
      TF.update(function (s) {
        if (!TF.sel.isBlocked(date)) s.blocked.push({ date: date, reason: reason });
        s.schedule = s.schedule.filter(function (sl) { return sl.date !== date; });
        if (alsoCancel) {
          affected.forEach(function (b) { b.status = 'Cancelled'; });
        }
        TF.log('schedule', TF.fmt.date(date) + ' blocked — ' + reason);
      });
      ctx.close();
      TF.toast('Date blocked', TF.fmt.date(date) + ' — ' + reason +
        (alsoCancel && affected.length ? '. ' + affected.length + ' bookings cancelled.' : '.'));
      TF.rerender();
    });
  }
})(window);
