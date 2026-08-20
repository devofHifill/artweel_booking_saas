/* ==========================================================================
   TourFlow — Dashboard
   Every number here is derived from state at render time. Nothing is stored
   pre-computed, so a booking taken on the customer site changes this screen.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  function greeting() {
    var h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  TF.views.dashboard = function (root) {
    var s = TF.state();
    var today = TF.today();

    var todaysBookings = TF.sel.bookingsOn(today).filter(function (b) { return b.status !== 'Cancelled'; });
    var todaysRevenue = todaysBookings.reduce(function (n, b) { return n + b.amount; }, 0);
    var todaySlots = TF.sel.slotsOn(today);
    var upcoming = s.schedule.filter(function (sl) { return sl.date > today && sl.date <= TF.addDays(today, 7); }).length;
    var capacityToday = todaySlots.reduce(function (n, sl) { return n + TF.sel.seatsLeft(sl); }, 0);
    var pendingMoney = s.bookings
      .filter(function (b) { return b.status !== 'Cancelled' && b.paid < b.amount; })
      .reduce(function (n, b) { return n + (b.amount - b.paid); }, 0);

    // Yesterday, for the trend line under the KPIs.
    var yBookings = TF.sel.bookingsOn(TF.addDays(today, -1)).filter(function (b) { return b.status !== 'Cancelled'; });
    var yRevenue = yBookings.reduce(function (n, b) { return n + b.amount; }, 0);
    var revTrend = yRevenue ? Math.round(((todaysRevenue - yRevenue) / yRevenue) * 100) : 0;
    var bkTrend = yBookings.length ? Math.round(((todaysBookings.length - yBookings.length) / yBookings.length) * 100) : 0;

    root.innerHTML =
      '<div class="page-head">' +
        '<div class="ph-text">' +
          '<h1>' + greeting() + ', Alex</h1>' +
          '<p class="lede">Here\'s what\'s happening with Harbor Adventures today.</p>' +
        '</div>' +
        '<div class="ph-actions">' +
          '<button class="btn" data-route="manifest">' + TF.icon('file') + ' Daily manifest</button>' +
          '<button class="btn btn-primary" id="dashNewBooking">' + TF.icon('plus') + ' New booking</button>' +
        '</div>' +
      '</div>' +

      '<div class="grid grid-5 mb-3">' +
        kpi('Today\'s Bookings', TF.fmt.num(todaysBookings.length), 'ticket', '', trend(bkTrend, 'vs yesterday')) +
        kpi('Today\'s Revenue', TF.fmt.money(todaysRevenue), 'dollar', 'green', trend(revTrend, 'vs yesterday')) +
        kpi('Upcoming Tours', TF.fmt.num(upcoming), 'calendar', 'violet', '<span class="muted">next 7 days</span>') +
        kpi('Available Capacity', TF.fmt.num(capacityToday), 'users', 'amber', '<span class="muted">seats left today</span>') +
        kpi('Pending Payments', TF.fmt.money(pendingMoney), 'card', 'red', '<span class="muted">across all bookings</span>') +
      '</div>' +

      '<div class="grid dash-split mb-3" style="grid-template-columns: minmax(0,1.55fr) minmax(0,1fr)">' +
        '<section class="card">' +
          '<div class="card-head">' +
            '<div><h2>Today\'s schedule</h2><div class="sub">' + TF.fmt.date(today, true) + '</div></div>' +
            '<div class="right"><button class="btn btn-sm" data-route="calendar">Open calendar</button></div>' +
          '</div>' +
          (todaySlots.length ? '<div id="todaySchedule">' + todaySlots.map(scheduleRow).join('') + '</div>'
            : emptyState('calendar', 'Nothing scheduled today', 'Add a time slot from the calendar to start taking bookings.',
              '<button class="btn btn-primary btn-sm" data-route="calendar">Go to calendar</button>')) +
        '</section>' +

        '<section class="card">' +
          '<div class="card-head"><h2>Revenue this week</h2>' +
            '<div class="right small muted">' + TF.fmt.money(weekRevenue()) + ' total</div></div>' +
          '<div class="card-body">' + weekChart() + '</div>' +
        '</section>' +
      '</div>' +

      '<div class="grid dash-split mb-3" style="grid-template-columns: minmax(0,1.55fr) minmax(0,1fr)">' +
        '<section class="card">' +
          '<div class="card-head"><h2>Recent bookings</h2>' +
            '<div class="right"><button class="btn btn-sm" data-route="bookings">View all</button></div></div>' +
          '<div class="table-wrap">' + recentTable() + '</div>' +
        '</section>' +

        '<section class="card">' +
          '<div class="card-head"><h2>Popular activities</h2><div class="right small muted">last 30 days</div></div>' +
          '<div class="card-body">' + popular() + '</div>' +
        '</section>' +
      '</div>' +

      '<div class="grid grid-3">' +
        '<section class="card"><div class="card-head"><h2>Needs attention</h2></div>' +
          '<div class="card-body">' + attention() + '</div></section>' +
        '<section class="card"><div class="card-head"><h2>Guides on duty today</h2></div>' +
          '<div class="card-body">' + guidesToday() + '</div></section>' +
        '<section class="card"><div class="card-head"><h2>Where bookings come from</h2><div class="right small muted">last 30 days</div></div>' +
          '<div class="card-body">' + sources() + '</div></section>' +
      '</div>';

    root.querySelector('#dashNewBooking').addEventListener('click', function () {
      TF.bookingForm(null, function () { TF.rerender(); });
    });

    TF.on(root, 'click', '.sched-row', function (e, el) {
      TF.slotDrawer(el.dataset.slot);
    });
    TF.on(root, 'click', 'tr.clickable', function (e, el) {
      TF.bookingDrawer(el.dataset.id);
    });
  };

  /* ---------------------------------------------------------- fragments */
  function kpi(label, value, icon, tone, foot) {
    return '<div class="kpi">' +
      '<div class="k-top"><span class="k-label">' + label + '</span>' +
      '<span class="k-icon ' + (tone || '') + '">' + TF.icon(icon, 16) + '</span></div>' +
      '<div class="k-value">' + value + '</div>' +
      '<div class="k-foot">' + foot + '</div></div>';
  }

  function trend(pct, label) {
    if (!pct) return '<span class="muted">level ' + label + '</span>';
    var up = pct > 0;
    return '<span class="trend ' + (up ? 'up' : 'down') + '">' + TF.icon(up ? 'trendUp' : 'trendDown', 13) +
      Math.abs(pct) + '%</span><span class="muted">' + label + '</span>';
  }

  function scheduleRow(slot) {
    var act = TF.sel.activity(slot.activityId);
    var booked = TF.sel.booked(slot.id);
    var pct = Math.round((booked / slot.capacity) * 100);
    var tone = pct >= 90 ? 'red' : pct >= 60 ? 'amber' : 'green';
    var revenue = TF.sel.bookingsForSlot(slot.id).reduce(function (n, b) { return n + b.amount; }, 0);
    var t = TF.fmt.time(slot.start).split(' ');
    return '<div class="sched-row" data-slot="' + slot.id + '">' +
      '<div class="sched-time">' + t[0] + '<span class="mer">' + t[1] + '</span></div>' +
      '<div class="sched-bar" style="background:linear-gradient(180deg,' + act.grad[0] + ',' + act.grad[1] + ')"></div>' +
      '<div class="sched-main">' +
        '<div class="nm">' + act.emoji + ' ' + TF.esc(act.name) + '</div>' +
        '<div class="mt"><span>' + TF.icon('badge', 12) + ' ' + TF.esc(TF.sel.staffName(slot.guideId)) + '</span>' +
        '<span>' + TF.icon('pin', 12) + ' ' + TF.esc(act.meetingPoint) + '</span></div>' +
      '</div>' +
      '<div class="sched-cap">' +
        '<div class="txt"><span>' + booked + ' / ' + slot.capacity + '</span><span class="muted">' + pct + '%</span></div>' +
        '<div class="progress ' + tone + '"><i style="width:' + Math.min(100, pct) + '%"></i></div>' +
      '</div>' +
      '<div class="sched-rev">' + TF.fmt.money(revenue) + '</div>' +
    '</div>';
  }

  function weekRevenue() {
    var total = 0;
    for (var i = 6; i >= 0; i--) total += TF.sel.revenueOn(TF.addDays(TF.today(), -i));
    return total;
  }

  function weekChart() {
    var days = [];
    var max = 1;
    for (var i = 6; i >= 0; i--) {
      var key = TF.addDays(TF.today(), -i);
      var v = TF.sel.revenueOn(key);
      max = Math.max(max, v);
      days.push({ key: key, label: TF.DAYS_S[TF.parseYmd(key).getDay()], value: v, today: i === 0 });
    }
    return '<div class="chart-bars">' + days.map(function (d, i) {
      var h = Math.max(4, Math.round((d.value / max) * 100));
      return '<div class="cb ' + (d.today ? 'peak' : '') + '">' +
        '<div class="bar" style="height:' + h + '%;animation-delay:' + (i * 45) + 'ms" data-v="' + TF.fmt.money(d.value) + '"></div>' +
        '<div class="lb">' + d.label + '</div></div>';
    }).join('') + '</div>' +
    '<div class="row-between mt-3 small"><span class="muted">Peak day</span><b>' +
      TF.esc(days.slice().sort(function (a, b) { return b.value - a.value; })[0].label) + ' · ' +
      TF.fmt.money(days.slice().sort(function (a, b) { return b.value - a.value; })[0].value) + '</b></div>' +
    '<div class="row-between small mt-1"><span class="muted">Daily average</span><b>' +
      TF.fmt.money(days.reduce(function (n, d) { return n + d.value; }, 0) / 7) + '</b></div>';
  }

  function recentTable() {
    var rows = TF.state().bookings.slice()
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })
      .slice(0, 7);
    return '<table class="tf"><thead><tr>' +
      '<th>Booking</th><th>Customer</th><th class="hide-sm">Activity</th><th class="hide-sm">Date</th>' +
      '<th>Guests</th><th>Amount</th><th class="hide-sm">Payment</th><th>Status</th></tr></thead><tbody>' +
      rows.map(function (b) {
        return '<tr class="clickable" data-id="' + b.id + '">' +
          '<td class="mono">' + b.id + '</td>' +
          '<td><div class="row"><span class="avatar sm">' + TF.fmt.initials(TF.sel.customerName(b.customerId)) + '</span>' +
            '<span class="cell-main">' + TF.esc(TF.sel.customerName(b.customerId)) + '</span></div></td>' +
          '<td class="hide-sm">' + TF.esc(TF.sel.activityName(b.activityId)) + '</td>' +
          '<td class="hide-sm nowrap">' + TF.fmt.dateShort(b.date) + ', ' + TF.fmt.time(b.time) + '</td>' +
          '<td>' + b.guests + '</td>' +
          '<td class="strong">' + TF.fmt.money(b.amount) + '</td>' +
          '<td class="hide-sm">' + TF.badge(b.paymentStatus) + '</td>' +
          '<td>' + TF.badge(b.status) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function popular() {
    var since = TF.addDays(TF.today(), -30);
    var stats = TF.state().activities.map(function (a) {
      var bs = TF.state().bookings.filter(function (b) {
        return b.activityId === a.id && b.status !== 'Cancelled' && b.date >= since;
      });
      return {
        a: a,
        bookings: bs.length,
        guests: bs.reduce(function (n, b) { return n + b.guests; }, 0),
        revenue: bs.reduce(function (n, b) { return n + b.amount; }, 0)
      };
    }).sort(function (x, y) { return y.bookings - x.bookings; }).slice(0, 5);

    var max = Math.max.apply(null, stats.map(function (s) { return s.bookings; }).concat([1]));
    return stats.map(function (s, i) {
      return '<div class="rank-row">' +
        '<span class="rank-n">' + (i + 1) + '</span>' +
        '<div class="rank-main">' +
          '<div class="nm"><span>' + s.a.emoji + ' ' + TF.esc(s.a.name) + '</span>' +
          '<span class="muted small">' + Math.round((s.bookings / max) * 100) + '%</span></div>' +
          '<div class="progress mt-1"><i style="width:' + Math.round((s.bookings / max) * 100) + '%"></i></div>' +
          '<div class="tiny muted mt-1">' + s.bookings + ' bookings · ' + s.guests + ' guests · ' + TF.fmt.money(s.revenue) + '</div>' +
        '</div></div>';
    }).join('');
  }

  function attention() {
    var s = TF.state();
    var pending = s.bookings.filter(function (b) { return b.status === 'Pending'; });
    var unpaid = s.bookings.filter(function (b) { return b.status !== 'Cancelled' && b.paid < b.amount; });
    var noWaiver = s.bookings.filter(function (b) { return !b.waiver && b.status === 'Confirmed' && b.date >= TF.today(); });
    var unstaffed = s.schedule.filter(function (sl) { return !sl.guideId && sl.date >= TF.today() && sl.date <= TF.addDays(TF.today(), 7); });
    var items = [
      { icon: 'clock', tone: 'amber', label: pending.length + ' bookings awaiting confirmation', route: 'bookings', p: { tab: 'Pending' } },
      { icon: 'card', tone: 'red', label: unpaid.length + ' bookings with a balance owing', route: 'payments' },
      { icon: 'shield', tone: 'violet', label: noWaiver.length + ' guests have not signed a waiver', route: 'bookings' },
      { icon: 'badge', tone: '', label: unstaffed.length + ' departures without a guide this week', route: 'calendar' }
    ];
    return '<div class="mini-list">' + items.map(function (it) {
      return '<div class="mini-row" style="cursor:pointer" data-route="' + it.route + '">' +
        '<span class="k-icon ' + it.tone + '" style="width:28px;height:28px;border-radius:8px">' + TF.icon(it.icon, 14) + '</span>' +
        '<span style="flex:1">' + it.label + '</span>' + TF.icon('chevR', 15) + '</div>';
    }).join('') + '</div>';
  }

  function guidesToday() {
    var today = TF.today();
    var slots = TF.sel.slotsOn(today);
    var byGuide = {};
    slots.forEach(function (sl) {
      if (!sl.guideId) return;
      byGuide[sl.guideId] = byGuide[sl.guideId] || { slots: 0, guests: 0 };
      byGuide[sl.guideId].slots++;
      byGuide[sl.guideId].guests += TF.sel.booked(sl.id);
    });
    var keys = Object.keys(byGuide);
    if (!keys.length) return '<p class="small muted">No guides assigned today.</p>';
    return '<div class="mini-list">' + keys.map(function (id) {
      var g = TF.sel.staff(id);
      return '<div class="mini-row" style="cursor:pointer" data-staff="' + id + '">' +
        '<span class="avatar sm">' + TF.fmt.initials(g.name) + '</span>' +
        '<span style="flex:1"><b>' + TF.esc(g.name) + '</b><br><span class="tiny muted">' + TF.esc(g.role) + '</span></span>' +
        '<span class="right"><b>' + byGuide[id].slots + '</b><br><span class="tiny muted">' + byGuide[id].guests + ' guests</span></span></div>';
    }).join('') + '</div>';
  }

  function sources() {
    var since = TF.addDays(TF.today(), -30);
    var bs = TF.state().bookings.filter(function (b) { return b.date >= since && b.status !== 'Cancelled'; });
    var by = {};
    bs.forEach(function (b) { by[b.source] = (by[b.source] || 0) + 1; });
    var COLORS = { Website: '#4f46e5', Widget: '#0ea5e9', Admin: '#94a3b8', Viator: '#00a680', Tripadvisor: '#34e0a1' };
    var total = bs.length || 1;
    var entries = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
    var stops = [], acc = 0;
    entries.forEach(function (k) {
      var pct = (by[k] / total) * 100;
      stops.push((COLORS[k] || '#cbd5e1') + ' ' + acc + '% ' + (acc + pct) + '%');
      acc += pct;
    });
    return '<div class="donut-wrap">' +
      '<div style="width:118px;height:118px;border-radius:50%;background:conic-gradient(' + stops.join(',') + ');' +
      'display:grid;place-items:center;flex:0 0 auto">' +
        '<div style="width:74px;height:74px;border-radius:50%;background:#fff;display:grid;place-items:center;text-align:center">' +
          '<div><div style="font-size:18px;font-weight:700">' + total + '</div><div class="tiny muted">bookings</div></div>' +
        '</div></div>' +
      '<div class="legend">' + entries.map(function (k) {
        return '<div class="lg"><span class="sw" style="background:' + (COLORS[k] || '#cbd5e1') + '"></span>' +
          TF.esc(k) + '<span class="v">' + Math.round((by[k] / total) * 100) + '%</span></div>';
      }).join('') + '</div></div>';
  }

  function emptyState(icon, title, text, action) {
    return '<div class="empty"><div class="ei">' + TF.icon(icon, 24) + '</div>' +
      '<h3>' + title + '</h3><p>' + text + '</p>' + (action || '') + '</div>';
  }
  TF.emptyState = emptyState;
})(window);
