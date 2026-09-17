/* ==========================================================================
   TourFlow — Reports
   Tabs over the same state: overview, revenue, bookings, activities,
   customers, staff. Charts are hand-drawn with CSS and inline SVG — no
   charting library, no external request.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  var TABS = ['Overview', 'Revenue', 'Bookings', 'Activities', 'Customers', 'Staff'];
  var tab = 'Overview';
  var range = 30;

  TF.views.reports = function (root) {
    root.innerHTML =
      '<div class="page-head">' +
        '<div class="ph-text"><h1>Reports</h1><p class="lede">Where the money and the guests actually come from.</p></div>' +
        '<div class="ph-actions">' +
          '<div class="seg" id="rpRange">' +
            [[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days']].map(function (r) {
              return '<button data-r="' + r[0] + '" class="' + (range === r[0] ? 'on' : '') + '">' + r[1] + '</button>';
            }).join('') +
          '</div>' +
          '<button class="btn" id="rpCustom">' + TF.icon('calendar') + ' Custom</button>' +
          '<button class="btn" id="rpExport">' + TF.icon('download') + ' Export</button>' +
        '</div>' +
      '</div>' +
      '<div class="tabs mb-3" id="rpTabs">' + TABS.map(function (t) {
        return '<button class="tab ' + (tab === t ? 'on' : '') + '" data-t="' + t + '">' + t + '</button>';
      }).join('') + '</div>' +
      '<div id="rpBody"></div>';

    draw();

    TF.on(root, 'click', '#rpTabs .tab', function (e, el) {
      tab = el.dataset.t;
      TF.qsa('#rpTabs .tab').forEach(function (b) { b.classList.toggle('on', b.dataset.t === tab); });
      draw();
    });
    TF.on(root, 'click', '#rpRange button', function (e, el) {
      range = +el.dataset.r;
      TF.qsa('#rpRange button').forEach(function (b) { b.classList.toggle('on', +b.dataset.r === range); });
      draw();
    });
    root.querySelector('#rpCustom').addEventListener('click', function () {
      TF.modal({
        title: 'Custom date range',
        size: 'narrow',
        body: '<div class="form-grid">' +
          '<div class="field"><label>From</label><input class="input" type="date" value="' + TF.addDays(TF.today(), -30) + '"></div>' +
          '<div class="field"><label>To</label><input class="input" type="date" value="' + TF.today() + '"></div></div>',
        footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-close>Apply</button>'
      });
    });
    root.querySelector('#rpExport').addEventListener('click', function () {
      TF.toast('Report queued', tab + ' report for the last ' + range + ' days would export as CSV/PDF.', 'info');
    });

    function draw() {
      var host = root.querySelector('#rpBody');
      host.innerHTML =
        tab === 'Overview' ? overview() :
        tab === 'Revenue' ? revenue() :
        tab === 'Bookings' ? bookingsReport() :
        tab === 'Activities' ? activitiesReport() :
        tab === 'Customers' ? customersReport() : staffReport();
    }
  };

  /* ------------------------------------------------------------ helpers */
  function since() { return TF.addDays(TF.today(), -(range - 1)); }

  function inRange() {
    var from = since();
    return TF.state().bookings.filter(function (b) { return b.date >= from && b.date <= TF.today(); });
  }

  function series() {
    var out = [];
    var step = range > 30 ? 7 : 1;
    for (var i = range - 1; i >= 0; i -= step) {
      var key = TF.addDays(TF.today(), -i);
      var val = 0, count = 0;
      for (var j = 0; j < step; j++) {
        var k = TF.addDays(key, j);
        if (k > TF.today()) break;
        val += TF.sel.revenueOn(k);
        count += TF.sel.bookingsOn(k).filter(function (b) { return b.status !== 'Cancelled'; }).length;
      }
      out.push({ key: key, value: val, count: count });
    }
    return out;
  }

  function lineChart(points, color) {
    var w = 620, h = 180, pad = 6;
    var max = Math.max.apply(null, points.map(function (p) { return p.value; }).concat([1]));
    var step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
    var coords = points.map(function (p, i) {
      return [pad + i * step, h - pad - (p.value / max) * (h - pad * 2)];
    });
    var path = coords.map(function (c, i) { return (i ? 'L' : 'M') + c[0].toFixed(1) + ',' + c[1].toFixed(1); }).join(' ');
    var area = path + ' L' + coords[coords.length - 1][0].toFixed(1) + ',' + (h - pad) + ' L' + pad + ',' + (h - pad) + ' Z';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:190px" preserveAspectRatio="none">' +
      '<defs><linearGradient id="rgrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + color + '" stop-opacity=".26"/>' +
        '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#rgrad)"/>' +
      '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
      coords.map(function (c) {
        return '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="2.6" fill="#fff" stroke="' + color + '" stroke-width="1.8"/>';
      }).join('') +
      '</svg>' +
      '<div class="row-between tiny muted"><span>' + TF.fmt.dateShort(points[0].key) + '</span>' +
      '<span>' + TF.fmt.dateShort(points[points.length - 1].key) + '</span></div>';
  }

  function barChart(points) {
    var max = Math.max.apply(null, points.map(function (p) { return p.value; }).concat([1]));
    return '<div class="chart-bars">' + points.map(function (p, i) {
      return '<div class="cb"><div class="bar" style="height:' + Math.max(3, (p.value / max) * 100) +
        '%;animation-delay:' + (i * 30) + 'ms" data-v="' + TF.fmt.money(p.value) + '"></div>' +
        '<div class="lb">' + p.label + '</div></div>';
    }).join('') + '</div>';
  }

  function statCard(label, value, sub) {
    return '<div class="kpi"><div class="k-top"><span class="k-label">' + label + '</span></div>' +
      '<div class="k-value">' + value + '</div>' + (sub ? '<div class="k-foot muted">' + sub + '</div>' : '') + '</div>';
  }

  function tableCard(title, head, rows, foot) {
    return '<section class="card"><div class="card-head"><h2>' + title + '</h2>' +
      (foot ? '<div class="right small muted">' + foot + '</div>' : '') + '</div>' +
      '<div class="table-wrap"><table class="tf"><thead><tr>' +
      head.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  /* ----------------------------------------------------------- overview */
  function overview() {
    var bs = inRange();
    var live = bs.filter(function (b) { return b.status !== 'Cancelled'; });
    var rev = live.reduce(function (n, b) { return n + b.amount; }, 0);
    var guests = live.reduce(function (n, b) { return n + b.guests; }, 0);
    var pts = series();

    return '<div class="grid grid-4 mb-3">' +
        statCard('Revenue', TF.fmt.money(rev), 'last ' + range + ' days') +
        statCard('Bookings', TF.fmt.num(live.length), TF.fmt.num(guests) + ' guests') +
        statCard('Average booking', TF.fmt.money(live.length ? rev / live.length : 0), 'per reservation') +
        statCard('Cancellation rate', bs.length ? Math.round((bs.filter(function (b) { return b.status === 'Cancelled'; }).length / bs.length) * 100) + '%' : '0%', 'of all bookings') +
      '</div>' +
      '<div class="grid split mb-3" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px">' +
        '<section class="card"><div class="card-head"><h2>Revenue trend</h2>' +
          '<div class="right small muted">' + TF.fmt.money(rev) + ' total</div></div>' +
          '<div class="card-body">' + lineChart(pts, '#4f46e5') + '</div></section>' +
        '<section class="card"><div class="card-head"><h2>Booking status mix</h2></div>' +
          '<div class="card-body">' + statusMix(bs) + '</div></section>' +
      '</div>' +
      '<div class="grid grid-2">' +
        tableCard('Top activities by revenue', ['Activity', 'Bookings', 'Guests', 'Revenue'],
          topActivities(live).map(function (r) {
            return '<tr><td class="cell-main">' + r.a.emoji + ' ' + TF.esc(r.a.name) + '</td><td>' + r.bookings +
              '</td><td>' + r.guests + '</td><td class="strong">' + TF.fmt.money(r.revenue) + '</td></tr>';
          }).join('')) +
        tableCard('Busiest days', ['Day', 'Bookings', 'Revenue'], busiestDays(live)) +
      '</div>';
  }

  function statusMix(bs) {
    var by = {};
    bs.forEach(function (b) { by[b.status] = (by[b.status] || 0) + 1; });
    var COLORS = { Confirmed: '#059669', Pending: '#d97706', Completed: '#2563eb', Cancelled: '#dc2626', 'No Show': '#94a3b8' };
    var total = bs.length || 1;
    return Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).map(function (k) {
      return '<div class="mb-2"><div class="row-between small"><span>' + k + '</span><b>' + by[k] +
        ' · ' + Math.round((by[k] / total) * 100) + '%</b></div>' +
        '<div class="progress mt-1"><i style="width:' + ((by[k] / total) * 100) + '%;background:' + COLORS[k] + '"></i></div></div>';
    }).join('');
  }

  function topActivities(live) {
    var by = {};
    live.forEach(function (b) {
      by[b.activityId] = by[b.activityId] || { bookings: 0, guests: 0, revenue: 0 };
      by[b.activityId].bookings++;
      by[b.activityId].guests += b.guests;
      by[b.activityId].revenue += b.amount;
    });
    return Object.keys(by).map(function (id) {
      var a = TF.sel.activity(id) || { name: 'Removed activity', emoji: '•' };
      return { a: a, bookings: by[id].bookings, guests: by[id].guests, revenue: by[id].revenue };
    }).sort(function (x, y) { return y.revenue - x.revenue; }).slice(0, 6);
  }

  function busiestDays(live) {
    var by = {};
    live.forEach(function (b) {
      var d = TF.parseYmd(b.date).getDay();
      by[d] = by[d] || { count: 0, rev: 0 };
      by[d].count++;
      by[d].rev += b.amount;
    });
    return Object.keys(by).sort(function (a, b) { return by[b].rev - by[a].rev; }).map(function (d) {
      return '<tr><td class="cell-main">' + TF.DAYS[d] + '</td><td>' + by[d].count + '</td>' +
        '<td class="strong">' + TF.fmt.money(by[d].rev) + '</td></tr>';
    }).join('');
  }

  /* ------------------------------------------------------------ revenue */
  function revenue() {
    var pts = series();
    var live = inRange().filter(function (b) { return b.status !== 'Cancelled'; });
    var total = live.reduce(function (n, b) { return n + b.amount; }, 0);
    var collected = live.reduce(function (n, b) { return n + b.paid; }, 0);

    var weekly = [];
    for (var w = 3; w >= 0; w--) {
      var start = TF.addDays(TF.today(), -(w * 7 + 6));
      var v = 0;
      for (var i = 0; i < 7; i++) v += TF.sel.revenueOn(TF.addDays(start, i));
      weekly.push({ label: w === 0 ? 'This wk' : w + 'w ago', value: v });
    }
    var monthly = [];
    for (var m = 5; m >= 0; m--) {
      var d = TF.parseYmd(TF.today());
      d.setMonth(d.getMonth() - m);
      var prefix = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      var mv = TF.state().bookings.filter(function (b) {
        return b.date.indexOf(prefix) === 0 && b.status !== 'Cancelled';
      }).reduce(function (n, b) { return n + b.amount; }, 0);
      monthly.push({ label: TF.MONTHS_S[d.getMonth()], value: mv });
    }

    return '<div class="grid grid-4 mb-3">' +
        statCard('Gross revenue', TF.fmt.money(total), 'last ' + range + ' days') +
        statCard('Collected', TF.fmt.money(collected), Math.round((collected / (total || 1)) * 100) + '% of gross') +
        statCard('Outstanding', TF.fmt.money(total - collected), 'still to collect') +
        statCard('Daily average', TF.fmt.money(total / range), 'per day') +
      '</div>' +
      '<section class="card mb-3"><div class="card-head"><h2>Daily revenue</h2></div>' +
        '<div class="card-body">' + lineChart(pts, '#4f46e5') + '</div></section>' +
      '<div class="grid grid-2">' +
        '<section class="card"><div class="card-head"><h2>Weekly revenue</h2></div>' +
          '<div class="card-body">' + barChart(weekly) + '</div></section>' +
        '<section class="card"><div class="card-head"><h2>Monthly revenue</h2></div>' +
          '<div class="card-body">' + barChart(monthly) + '</div></section>' +
      '</div>';
  }

  /* ----------------------------------------------------------- bookings */
  function bookingsReport() {
    var bs = inRange();
    var by = function (st) { return bs.filter(function (b) { return b.status === st; }).length; };
    var live = bs.filter(function (b) { return b.status !== 'Cancelled'; });
    var rev = live.reduce(function (n, b) { return n + b.amount; }, 0);

    var bySource = {};
    bs.forEach(function (b) { bySource[b.source] = (bySource[b.source] || 0) + 1; });

    var leadTimes = live.map(function (b) {
      return Math.max(0, Math.round((TF.parseYmd(b.date) - TF.parseYmd(b.createdAt)) / 86400000));
    });
    var avgLead = leadTimes.length ? Math.round(leadTimes.reduce(function (n, x) { return n + x; }, 0) / leadTimes.length) : 0;

    return '<div class="grid grid-5 mb-3">' +
        statCard('Total', TF.fmt.num(bs.length)) +
        statCard('Completed', TF.fmt.num(by('Completed'))) +
        statCard('Cancelled', TF.fmt.num(by('Cancelled'))) +
        statCard('No show', TF.fmt.num(by('No Show'))) +
        statCard('Average value', TF.fmt.money(live.length ? rev / live.length : 0)) +
      '</div>' +
      '<div class="grid grid-2 mb-3">' +
        '<section class="card"><div class="card-head"><h2>Bookings per day</h2></div>' +
          '<div class="card-body">' + barChart(series().map(function (p) {
            return { label: TF.DAYS_S[TF.parseYmd(p.key).getDay()], value: p.count };
          }).slice(-7)) + '</div></section>' +
        '<section class="card"><div class="card-head"><h2>Channel mix</h2>' +
          '<div class="right small muted">avg lead time ' + avgLead + ' days</div></div>' +
          '<div class="card-body">' + Object.keys(bySource).sort(function (a, b) { return bySource[b] - bySource[a]; })
            .map(function (k) {
              var pct = Math.round((bySource[k] / (bs.length || 1)) * 100);
              return '<div class="mb-2"><div class="row-between small"><span>' + TF.esc(k) + '</span><b>' +
                bySource[k] + ' · ' + pct + '%</b></div><div class="progress mt-1"><i style="width:' + pct + '%"></i></div></div>';
            }).join('') + '</div></section>' +
      '</div>' +
      tableCard('Recent bookings in range', ['Booking', 'Customer', 'Activity', 'Date', 'Guests', 'Amount', 'Status'],
        bs.slice(0, 12).map(function (b) {
          return '<tr><td class="mono">' + b.id + '</td><td>' + TF.esc(TF.sel.customerName(b.customerId)) + '</td>' +
            '<td>' + TF.esc(TF.sel.activityName(b.activityId)) + '</td><td>' + TF.fmt.dateShort(b.date) + '</td>' +
            '<td>' + b.guests + '</td><td class="strong">' + TF.fmt.money(b.amount) + '</td><td>' + TF.badge(b.status) + '</td></tr>';
        }).join(''), bs.length + ' bookings');
  }

  /* --------------------------------------------------------- activities */
  function activitiesReport() {
    var from = since();
    var rows = TF.state().activities.map(function (a) {
      var bs = TF.state().bookings.filter(function (b) {
        return b.activityId === a.id && b.date >= from && b.status !== 'Cancelled';
      });
      var slots = TF.state().schedule.filter(function (sl) { return sl.activityId === a.id && sl.date >= from && sl.date <= TF.today(); });
      var cap = slots.reduce(function (n, sl) { return n + sl.capacity; }, 0);
      var guests = bs.reduce(function (n, b) { return n + b.guests; }, 0);
      return {
        a: a, bookings: bs.length, guests: guests,
        revenue: bs.reduce(function (n, b) { return n + b.amount; }, 0),
        occupancy: cap ? Math.round((guests / cap) * 100) : 0,
        conversion: 40 + ((a.rating * 7) % 25)
      };
    }).sort(function (x, y) { return y.revenue - x.revenue; });

    return tableCard('Activity performance', ['Activity', 'Category', 'Bookings', 'Guests', 'Revenue', 'Occupancy', 'Conversion'],
      rows.map(function (r) {
        return '<tr><td class="cell-main">' + r.a.emoji + ' ' + TF.esc(r.a.name) + '</td>' +
          '<td>' + TF.esc(r.a.category) + '</td><td>' + r.bookings + '</td><td>' + r.guests + '</td>' +
          '<td class="strong">' + TF.fmt.money(r.revenue) + '</td>' +
          '<td style="min-width:120px"><div class="progress ' + (r.occupancy > 70 ? 'green' : r.occupancy > 40 ? 'amber' : 'red') +
            '"><i style="width:' + Math.min(100, r.occupancy) + '%"></i></div>' +
            '<div class="tiny muted mt-1">' + r.occupancy + '%</div></td>' +
          '<td>' + Math.round(r.conversion) + '%</td></tr>';
      }).join(''), 'last ' + range + ' days');
  }

  /* ---------------------------------------------------------- customers */
  function customersReport() {
    var s = TF.state();
    var rows = s.customers.map(function (c) {
      return { c: c, st: TF.sel.customerStats(c.id) };
    }).sort(function (a, b) { return b.st.spent - a.st.spent; });

    var newInRange = s.customers.filter(function (c) { return c.createdAt >= since(); }).length;
    var repeat = rows.filter(function (r) { return r.st.bookings > 1; }).length;
    var byCountry = {};
    s.customers.forEach(function (c) { byCountry[c.country] = (byCountry[c.country] || 0) + 1; });

    return '<div class="grid grid-4 mb-3">' +
        statCard('Total customers', TF.fmt.num(s.customers.length)) +
        statCard('New in range', TF.fmt.num(newInRange), 'last ' + range + ' days') +
        statCard('Repeat rate', Math.round((repeat / (s.customers.length || 1)) * 100) + '%', repeat + ' repeat guests') +
        statCard('Lifetime value', TF.fmt.money(rows.reduce(function (n, r) { return n + r.st.spent; }, 0) / (rows.length || 1)), 'average') +
      '</div>' +
      '<div class="grid split mb-3" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px">' +
        tableCard('Top customers', ['Customer', 'Bookings', 'Total spent', 'Last booking'],
          rows.slice(0, 10).map(function (r) {
            return '<tr><td><div class="row"><span class="avatar sm">' + TF.fmt.initials(r.c.name) + '</span>' +
              '<span class="cell-main">' + TF.esc(r.c.name) + '</span></div></td>' +
              '<td>' + r.st.bookings + '</td><td class="strong">' + TF.fmt.money(r.st.spent) + '</td>' +
              '<td>' + (r.st.last ? TF.fmt.dateShort(r.st.last) : '—') + '</td></tr>';
          }).join('')) +
        '<section class="card"><div class="card-head"><h2>Where guests come from</h2></div><div class="card-body">' +
          Object.keys(byCountry).sort(function (a, b) { return byCountry[b] - byCountry[a]; }).slice(0, 8).map(function (k) {
            var pct = Math.round((byCountry[k] / s.customers.length) * 100);
            return '<div class="mb-2"><div class="row-between small"><span>' + TF.esc(k) + '</span><b>' + byCountry[k] + '</b></div>' +
              '<div class="progress mt-1"><i style="width:' + pct + '%"></i></div></div>';
          }).join('') + '</div></section>' +
      '</div>';
  }

  /* -------------------------------------------------------------- staff */
  function staffReport() {
    var from = since();
    var rows = TF.state().staff.map(function (m) {
      var bs = TF.state().bookings.filter(function (b) {
        return b.guideId === m.id && b.date >= from && b.status !== 'Cancelled';
      });
      var slots = TF.state().schedule.filter(function (sl) {
        return sl.guideId === m.id && sl.date >= from && sl.date <= TF.today();
      });
      return {
        m: m, tours: slots.length,
        guests: bs.reduce(function (n, b) { return n + b.guests; }, 0),
        revenue: bs.reduce(function (n, b) { return n + b.amount; }, 0)
      };
    }).sort(function (x, y) { return y.revenue - x.revenue; });

    var maxRev = Math.max.apply(null, rows.map(function (r) { return r.revenue; }).concat([1]));

    return tableCard('Staff performance', ['Guide', 'Role', 'Tours run', 'Customers handled', 'Revenue generated', 'Rating'],
      rows.map(function (r) {
        return '<tr><td><div class="row"><span class="avatar sm">' + TF.fmt.initials(r.m.name) + '</span>' +
          '<span class="cell-main">' + TF.esc(r.m.name) + '</span></div></td>' +
          '<td>' + TF.esc(r.m.role) + '</td><td>' + r.tours + '</td><td>' + r.guests + '</td>' +
          '<td style="min-width:150px"><b>' + TF.fmt.money(r.revenue) + '</b>' +
            '<div class="progress mt-1"><i style="width:' + Math.round((r.revenue / maxRev) * 100) + '%"></i></div></td>' +
          '<td>' + TF.icon('star', 13) + ' ' + r.m.rating + '</td></tr>';
      }).join(''), 'last ' + range + ' days');
  }
})(window);
