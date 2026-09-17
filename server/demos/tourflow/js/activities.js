/* ==========================================================================
   TourFlow — Activities
   Card and table views over the catalogue, plus the create/edit form. What is
   saved here is exactly what the customer booking site renders.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  var CATEGORIES = ['Water Sports', 'Boat Tour', 'Walking Tour', 'Food & Wine', 'Entertainment',
    'Fishing', 'Wellness', 'Cultural', 'Adventure', 'Family'];
  var EMOJI = ['🛶','⛵','🏛️','🍷','🤿','🐬','🎣','🔍','🧘','🗼','🚲','🏄','🐎','🎿','🚁','🍽️','🎨','🏰'];
  var GRADS = [['#0ea5e9','#2563eb'],['#f59e0b','#dc2626'],['#8b5cf6','#6366f1'],['#be185d','#7c3aed'],
    ['#0891b2','#0f766e'],['#06b6d4','#3b82f6'],['#1d4ed8','#0f172a'],['#059669','#0891b2'],['#f472b6','#f59e0b']];
  var view = 'cards';
  var catFilter = '';
  var q = '';

  TF.views.activities = function (root) {
    var s = TF.state();

    root.innerHTML =
      '<div class="page-head">' +
        '<div class="ph-text"><h1>Activities</h1><p class="lede">Manage everything you offer.</p></div>' +
        '<div class="ph-actions">' +
          '<div class="seg" id="actView">' +
            '<button data-v="cards" class="' + (view === 'cards' ? 'on' : '') + '">Cards</button>' +
            '<button data-v="table" class="' + (view === 'table' ? 'on' : '') + '">Table</button>' +
          '</div>' +
          '<button class="btn btn-primary" id="actNew">' + TF.icon('plus') + ' Create Activity</button>' +
        '</div>' +
      '</div>' +

      '<div class="grid grid-4 mb-3">' +
        tile('Live activities', s.activities.filter(function (a) { return a.status === 'Active'; }).length) +
        tile('Drafts', s.activities.filter(function (a) { return a.status !== 'Active'; }).length) +
        tile('Average price', TF.fmt.money(s.activities.reduce(function (n, a) { return n + a.price; }, 0) / s.activities.length)) +
        tile('Seats scheduled (30d)', TF.fmt.num(s.schedule.filter(function (sl) {
          return sl.date >= TF.today() && sl.date <= TF.addDays(TF.today(), 30);
        }).reduce(function (n, sl) { return n + sl.capacity; }, 0))) +
      '</div>' +

      '<div class="filter-bar card" style="border-radius:var(--r-md) var(--r-md) 0 0;margin-bottom:-1px">' +
        '<input class="input grow" id="actQ" placeholder="Search activities…" value="' + TF.esc(q) + '">' +
        '<select class="select" id="actCat"><option value="">All categories</option>' +
          TF.options(CATEGORIES, catFilter) + '</select>' +
      '</div>' +
      '<div id="actBody"></div>';

    renderBody();

    TF.on(root, 'click', '#actView button', function (e, el) {
      view = el.dataset.v;
      TF.qsa('#actView button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === view); });
      renderBody();
    });
    root.querySelector('#actQ').addEventListener('input', function (e) { q = e.target.value; renderBody(); });
    root.querySelector('#actCat').addEventListener('change', function (e) { catFilter = e.target.value; renderBody(); });
    root.querySelector('#actNew').addEventListener('click', function () { TF.activityForm(null); });

    TF.on(root, 'click', '[data-edit]', function (e, el) { e.stopPropagation(); TF.activityForm(el.dataset.edit); });
    TF.on(root, 'click', '[data-del]', function (e, el) { e.stopPropagation(); del(el.dataset.del); });
    TF.on(root, 'click', '[data-view]', function (e, el) { e.stopPropagation(); detail(el.dataset.view); });
    TF.on(root, 'click', '[data-sched]', function (e, el) {
      e.stopPropagation();
      TF.go('calendar', { activity: el.dataset.sched });
    });

    function list() {
      var qq = q.trim().toLowerCase();
      return TF.state().activities.filter(function (a) {
        if (catFilter && a.category !== catFilter) return false;
        if (qq && (a.name + ' ' + a.category + ' ' + a.location).toLowerCase().indexOf(qq) === -1) return false;
        return true;
      });
    }

    function renderBody() {
      var items = list();
      var host = root.querySelector('#actBody');
      if (!items.length) {
        host.innerHTML = '<div class="card">' + TF.emptyState('compass', 'No activities match',
          'Adjust the filters, or create a new experience for your catalogue.',
          '<button class="btn btn-primary btn-sm" data-newact>' + TF.icon('plus') + ' Create Activity</button>') + '</div>';
        var b = host.querySelector('[data-newact]');
        if (b) b.addEventListener('click', function () { TF.activityForm(null); });
        return;
      }
      host.innerHTML = view === 'cards'
        ? '<div class="grid grid-3">' + items.map(card).join('') + '</div>'
        : '<div class="card"><div class="table-wrap">' + table(items) + '</div></div>';
    }
  };

  function tile(label, value) {
    return '<div class="card"><div class="card-body"><div class="l small muted">' + label + '</div>' +
      '<div style="font-size:23px;font-weight:700;letter-spacing:-.02em;margin-top:4px">' + value + '</div></div></div>';
  }

  function card(a) {
    var st = TF.sel.activityStats(a.id);
    return '<article class="act-card" data-view="' + a.id + '" style="cursor:pointer">' +
      '<div class="act-thumb" style="background:linear-gradient(135deg,' + a.grad[0] + ',' + a.grad[1] + ')">' +
        '<span class="emo">' + a.emoji + '</span>' +
        '<span class="pin">' + TF.badge(a.status) + '</span>' +
        '<span class="pin2 badge badge-neutral" style="background:rgba(255,255,255,.9)">' + TF.esc(a.category) + '</span>' +
      '</div>' +
      '<div class="card-body" style="flex:1;display:flex;flex-direction:column;gap:8px">' +
        '<div class="row-between"><b style="font-size:15px">' + TF.esc(a.name) + '</b>' +
          '<span class="small strong">' + TF.fmt.money(a.price) + '</span></div>' +
        '<p class="small muted" style="min-height:36px">' + TF.esc(a.short) + '</p>' +
        '<div class="row small muted wrap" style="gap:12px">' +
          '<span>' + TF.icon('clock', 13) + ' ' + TF.fmt.duration(a.duration) + '</span>' +
          '<span>' + TF.icon('users', 13) + ' ' + a.capacity + ' max</span>' +
          '<span>' + TF.icon('star', 13) + ' ' + a.rating + '</span>' +
        '</div>' +
        '<div class="row-between mt-1" style="padding-top:10px;border-top:1px solid var(--border)">' +
          '<span class="tiny muted">' + st.bookings + ' bookings · ' + TF.fmt.money(st.revenue) + '</span>' +
          '<span class="act-btns">' +
            '<button class="act-btn tip" data-tip="Schedule" data-sched="' + a.id + '">' + TF.icon('calendar', 14) + '</button>' +
            '<button class="act-btn tip" data-tip="Edit" data-edit="' + a.id + '">' + TF.icon('edit', 14) + '</button>' +
            '<button class="act-btn danger tip" data-tip="Delete" data-del="' + a.id + '">' + TF.icon('trash', 14) + '</button>' +
          '</span>' +
        '</div>' +
      '</div></article>';
  }

  function table(items) {
    return '<table class="tf"><thead><tr><th>Activity</th><th class="hide-sm">Category</th><th>Duration</th>' +
      '<th>Price</th><th class="hide-sm">Capacity</th><th>Bookings</th><th class="hide-sm">Occupancy</th>' +
      '<th>Status</th><th></th></tr></thead><tbody>' +
      items.map(function (a) {
        var st = TF.sel.activityStats(a.id);
        return '<tr class="clickable" data-view="' + a.id + '">' +
          '<td><div class="row"><span style="font-size:18px">' + a.emoji + '</span>' +
            '<span><span class="cell-main">' + TF.esc(a.name) + '</span>' +
            '<div class="cell-sub hide-sm">' + TF.esc(a.location) + '</div></span></div></td>' +
          '<td class="hide-sm">' + TF.esc(a.category) + '</td>' +
          '<td class="nowrap">' + TF.fmt.duration(a.duration) + '</td>' +
          '<td class="strong">' + TF.fmt.money(a.price) + '</td>' +
          '<td class="hide-sm">' + a.capacity + '</td>' +
          '<td>' + st.bookings + '</td>' +
          '<td class="hide-sm" style="min-width:110px"><div class="progress ' +
            (st.occupancy > 75 ? 'green' : st.occupancy > 40 ? 'amber' : 'red') +
            '"><i style="width:' + st.occupancy + '%"></i></div><div class="tiny muted mt-1">' + st.occupancy + '%</div></td>' +
          '<td>' + TF.badge(a.status) + '</td>' +
          '<td><div class="act-btns">' +
            '<button class="act-btn" data-edit="' + a.id + '">' + TF.icon('edit', 14) + '</button>' +
            '<button class="act-btn danger" data-del="' + a.id + '">' + TF.icon('trash', 14) + '</button>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ------------------------------------------------------------- detail */
  function detail(id) {
    var a = TF.sel.activity(id);
    var st = TF.sel.activityStats(id);
    var upcoming = TF.state().schedule.filter(function (sl) {
      return sl.activityId === id && sl.date >= TF.today();
    }).sort(function (x, y) { return x.date < y.date ? -1 : 1; }).slice(0, 6);

    TF.drawer({
      eyebrow: a.category,
      title: a.name,
      subtitle: TF.fmt.money(a.price) + ' · ' + TF.fmt.duration(a.duration) + ' · up to ' + a.capacity + ' guests',
      body:
        '<div style="height:110px;border-radius:var(--r-md);background:linear-gradient(135deg,' + a.grad[0] + ',' + a.grad[1] +
          ');display:grid;place-items:center;font-size:44px;margin-bottom:16px">' + a.emoji + '</div>' +
        '<div class="grid grid-3 mb-3">' +
          '<div class="stat-tile"><div class="l">Bookings</div><div class="v">' + st.bookings + '</div></div>' +
          '<div class="stat-tile"><div class="l">Revenue</div><div class="v">' + TF.fmt.money(st.revenue) + '</div></div>' +
          '<div class="stat-tile"><div class="l">Occupancy</div><div class="v">' + st.occupancy + '%</div></div>' +
        '</div>' +
        '<p class="small" style="line-height:1.65">' + TF.esc(a.description) + '</p>' +
        '<div class="section-title mt-3">Details</div>' +
        '<dl class="dl">' +
          '<dt>Location</dt><dd>' + TF.esc(a.location) + '</dd>' +
          '<dt>Meeting point</dt><dd>' + TF.esc(a.meetingPoint) + '</dd>' +
          '<dt>Runs on</dt><dd>' + a.days.map(function (d) { return TF.DAYS_S[d]; }).join(', ') + '</dd>' +
          '<dt>Start times</dt><dd>' + a.startTimes.map(TF.fmt.time).join(' · ') + '</dd>' +
          '<dt>Group size</dt><dd>' + a.minGuests + ' – ' + a.maxGuests + ' guests</dd>' +
          '<dt>Child price</dt><dd>' + (a.childPrice ? TF.fmt.money(a.childPrice) : 'Adults only') + '</dd>' +
          '<dt>Rating</dt><dd>' + a.rating + ' from ' + TF.fmt.num(a.reviews) + ' reviews</dd>' +
        '</dl>' +
        '<div class="section-title mt-3">Cancellation policy</div>' +
        '<p class="small muted">' + TF.esc(a.cancellation) + '</p>' +
        '<div class="section-title mt-3">Booking instructions</div>' +
        '<p class="small muted">' + TF.esc(a.instructions) + '</p>' +
        '<div class="section-title mt-3">Next departures</div>' +
        (upcoming.length ? '<div class="mini-list">' + upcoming.map(function (sl) {
          var booked = TF.sel.booked(sl.id);
          return '<div class="mini-row"><span style="flex:1"><b>' + TF.fmt.dateShort(sl.date) + '</b> · ' +
            TF.fmt.time(sl.start) + '<div class="tiny muted">' + TF.esc(TF.sel.staffName(sl.guideId)) + '</div></span>' +
            '<span class="small">' + booked + '/' + sl.capacity + '</span></div>';
        }).join('') + '</div>' : '<p class="small muted">Nothing scheduled yet.</p>'),
      footer:
        '<button class="btn btn-primary btn-sm" id="adEdit">' + TF.icon('edit') + ' Edit activity</button>' +
        '<button class="btn btn-sm" id="adSched">' + TF.icon('calendar') + ' Manage schedule</button>' +
        '<button class="btn btn-sm" id="adBook">' + TF.icon('plus') + ' Take a booking</button>',
      onMount: function (ctx) {
        ctx.el.querySelector('#adEdit').addEventListener('click', function () { ctx.close(); TF.activityForm(id); });
        ctx.el.querySelector('#adSched').addEventListener('click', function () { ctx.close(); TF.go('calendar', { activity: id }); });
        ctx.el.querySelector('#adBook').addEventListener('click', function () {
          ctx.close();
          TF.bookingForm(null, TF.rerender, { activityId: id });
        });
      }
    });
  }

  /* --------------------------------------------------------- create/edit */
  TF.activityForm = function (id) {
    var a = id ? TF.sel.activity(id) : null;
    var days = a ? a.days.slice() : [1, 2, 3, 4, 5, 6, 0];
    var times = a ? a.startTimes.slice() : ['10:00'];
    var emoji = a ? a.emoji : '🛶';
    var grad = a ? a.grad : GRADS[0];

    var body =
      '<form id="afForm" class="form-grid">' +
        '<div class="fieldset-title">Basics</div>' +
        '<div class="field full"><label>Activity name</label>' +
          '<input class="input" name="name" value="' + (a ? TF.esc(a.name) : '') + '" placeholder="Sunset Kayak Tour"></div>' +
        '<div class="field full"><label>Short description</label>' +
          '<input class="input" name="short" value="' + (a ? TF.esc(a.short) : '') + '" ' +
          'placeholder="One line that sells it on the booking page"></div>' +
        '<div class="field full"><label>Full description</label>' +
          '<textarea class="textarea" name="description" placeholder="What guests actually do, in order.">' +
          (a ? TF.esc(a.description) : '') + '</textarea></div>' +
        '<div class="field"><label>Category</label><select class="select" name="category">' +
          TF.options(CATEGORIES, a ? a.category : 'Water Sports') + '</select></div>' +
        '<div class="field"><label>Status</label><select class="select" name="status">' +
          TF.options(['Active', 'Draft'], a ? a.status : 'Active') + '</select></div>' +

        '<div class="fieldset-title">Pricing &amp; capacity</div>' +
        '<div class="field"><label>Adult price</label><input class="input" type="number" min="0" name="price" value="' +
          (a ? a.price : 80) + '"></div>' +
        '<div class="field"><label>Child price <span class="hint">0 = adults only</span></label>' +
          '<input class="input" type="number" min="0" name="childPrice" value="' + (a ? a.childPrice : 50) + '"></div>' +
        '<div class="field"><label>Currency</label><select class="select" name="currency">' +
          TF.options(['USD', 'EUR', 'GBP', 'CAD', 'AUD'], 'USD') + '</select></div>' +
        '<div class="field"><label>Duration (minutes)</label><input class="input" type="number" min="15" step="15" name="duration" value="' +
          (a ? a.duration : 120) + '"></div>' +
        '<div class="field"><label>Maximum capacity</label><input class="input" type="number" min="1" name="capacity" value="' +
          (a ? a.capacity : 10) + '"></div>' +
        '<div class="field"><label>Minimum guests</label><input class="input" type="number" min="1" name="minGuests" value="' +
          (a ? a.minGuests : 1) + '"></div>' +

        '<div class="fieldset-title">Where</div>' +
        '<div class="field"><label>Location</label><input class="input" name="location" value="' +
          (a ? TF.esc(a.location) : '') + '" placeholder="Harbor Bay Marina"></div>' +
        '<div class="field"><label>Meeting point</label><input class="input" name="meetingPoint" value="' +
          (a ? TF.esc(a.meetingPoint) : '') + '" placeholder="Dock B, blue canopy"></div>' +

        '<div class="fieldset-title">Availability</div>' +
        '<div class="field full"><label>Available days</label>' +
          '<div class="chip-group" id="afDays">' + TF.DAYS_S.map(function (d, i) {
            return '<button type="button" class="chip ' + (days.indexOf(i) !== -1 ? 'on' : '') + '" data-day="' + i + '">' + d + '</button>';
          }).join('') + '</div></div>' +
        '<div class="field full"><label>Start times</label>' +
          '<div class="chip-group" id="afTimes"></div>' +
          '<div class="row mt-1"><input class="input" type="time" id="afNewTime" style="width:140px">' +
          '<button type="button" class="btn btn-sm" id="afAddTime">' + TF.icon('plus') + ' Add time</button></div></div>' +

        '<div class="fieldset-title">Presentation</div>' +
        '<div class="field full"><label>Image <span class="hint">this demo uses an icon and gradient instead of file uploads</span></label>' +
          '<div class="chip-group" id="afEmoji">' + EMOJI.map(function (e) {
            return '<button type="button" class="chip ' + (e === emoji ? 'on' : '') + '" data-emo="' + e + '" style="font-size:16px">' + e + '</button>';
          }).join('') + '</div>' +
          '<div class="chip-group mt-2" id="afGrad">' + GRADS.map(function (g, i) {
            return '<button type="button" class="chip ' + (g[0] === grad[0] ? 'on' : '') + '" data-grad="' + i + '" ' +
              'style="width:44px;height:26px;padding:0;background:linear-gradient(135deg,' + g[0] + ',' + g[1] + ');border-color:transparent"></button>';
          }).join('') + '</div></div>' +

        '<div class="fieldset-title">Policies</div>' +
        '<div class="field full"><label>Cancellation policy</label>' +
          '<textarea class="textarea" name="cancellation">' + (a ? TF.esc(a.cancellation) :
            TF.state().settings.cancellation.text) + '</textarea></div>' +
        '<div class="field full"><label>Booking instructions <span class="hint">sent with the confirmation</span></label>' +
          '<textarea class="textarea" name="instructions">' + (a ? TF.esc(a.instructions) : '') + '</textarea></div>' +
      '</form>';

    var ctx = TF.modal({
      title: a ? 'Edit ' + a.name : 'Create activity',
      subtitle: a ? 'Changes go live on your booking page immediately' : 'It will appear on your booking page as soon as it is Active',
      size: 'wide',
      body: body,
      footer: '<button class="btn" data-close>Cancel</button>' +
        '<button class="btn btn-primary" id="afSave">Save activity</button>'
    });

    var el = ctx.el;
    renderTimes();

    TF.on(el, 'click', '[data-day]', function (e, b) {
      var d = +b.dataset.day;
      var i = days.indexOf(d);
      if (i === -1) days.push(d); else days.splice(i, 1);
      b.classList.toggle('on');
    });
    TF.on(el, 'click', '[data-emo]', function (e, b) {
      emoji = b.dataset.emo;
      TF.qsa('[data-emo]', el).forEach(function (x) { x.classList.toggle('on', x === b); });
    });
    TF.on(el, 'click', '[data-grad]', function (e, b) {
      grad = GRADS[+b.dataset.grad];
      TF.qsa('[data-grad]', el).forEach(function (x) { x.classList.toggle('on', x === b); });
    });
    el.querySelector('#afAddTime').addEventListener('click', function () {
      var t = el.querySelector('#afNewTime').value;
      if (!t) return;
      if (times.indexOf(t) === -1) times.push(t);
      times.sort();
      renderTimes();
    });
    TF.on(el, 'click', '[data-rmtime]', function (e, b) {
      times.splice(times.indexOf(b.dataset.rmtime), 1);
      renderTimes();
    });

    function renderTimes() {
      el.querySelector('#afTimes').innerHTML = times.length ? times.map(function (t) {
        return '<span class="chip on rm">' + TF.fmt.time(t) +
          '<button type="button" data-rmtime="' + t + '" style="background:none;border:0;color:#fff;cursor:pointer;padding:0">' +
          TF.icon('x', 12) + '</button></span>';
      }).join('') : '<span class="small muted">No start times yet.</span>';
    }

    el.querySelector('#afSave').addEventListener('click', function () {
      if (!TF.requireFields(el, ['name', 'location'])) return;
      if (!days.length) return TF.toast('No days selected', 'Pick at least one day this activity runs.', 'err');
      if (!times.length) return TF.toast('No start times', 'Add at least one start time.', 'err');

      var d = TF.formData(el.querySelector('#afForm'));
      var payload = {
        name: d.name, short: d.short || d.name, description: d.description || '',
        category: d.category, status: d.status,
        price: +d.price || 0, childPrice: +d.childPrice || 0,
        duration: +d.duration || 60, capacity: +d.capacity || 10,
        minGuests: +d.minGuests || 1, maxGuests: +d.capacity || 10,
        location: d.location, meetingPoint: d.meetingPoint || d.location,
        cancellation: d.cancellation, instructions: d.instructions,
        days: days.slice().sort(), startTimes: times.slice(),
        emoji: emoji, grad: grad
      };

      if (a) {
        TF.update(function () {
          Object.keys(payload).forEach(function (k) { a[k] = payload[k]; });
          TF.log('activity', a.name + ' updated');
        });
        TF.toast('Activity updated', a.name + ' has been saved.');
      } else {
        TF.update(function (s) {
          payload.id = 'act-' + (s.activities.length + 1) + '-' + Date.now().toString(36);
          payload.rating = 0; payload.reviews = 0; payload.highlights = [];
          s.activities.push(payload);
          TF.log('activity', payload.name + ' created');
        });
        TF.toast('Activity created', payload.name + ' is now in your catalogue. Add departures on the calendar.');
      }
      ctx.close();
      TF.rerender();
    });
  };

  function del(id) {
    var a = TF.sel.activity(id);
    var live = TF.state().bookings.filter(function (b) {
      return b.activityId === id && b.status !== 'Cancelled' && b.date >= TF.today();
    }).length;
    TF.confirm({
      title: 'Delete ' + a.name + '?',
      message: live
        ? 'There are ' + live + ' upcoming bookings on this activity. Deleting it removes the activity and its future departures — the bookings stay in your records.'
        : 'This removes the activity and its scheduled departures. Past bookings are kept for reporting.',
      confirmText: 'Delete activity',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      TF.update(function (s) {
        s.activities = s.activities.filter(function (x) { return x.id !== id; });
        s.schedule = s.schedule.filter(function (sl) { return sl.activityId !== id || sl.date < TF.today(); });
        TF.log('activity', a.name + ' deleted');
      });
      TF.toast('Activity deleted', a.name + ' has been removed from your catalogue.');
      TF.rerender();
    });
  }
})(window);
