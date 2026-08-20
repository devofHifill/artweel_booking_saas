/* ==========================================================================
   TourFlow — Customers
   List, profile drawer (with real booking + payment history pulled from the
   same state), and add/edit.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  var q = '';
  var sort = 'spent';
  var statusFilter = '';

  TF.views.customers = function (root) {
    var s = TF.state();
    var all = s.customers;
    var totalSpent = all.reduce(function (n, c) { return n + TF.sel.customerStats(c.id).spent; }, 0);
    var repeat = all.filter(function (c) { return TF.sel.customerStats(c.id).bookings > 1; }).length;

    root.innerHTML =
      '<div class="page-head">' +
        '<div class="ph-text"><h1>Customers</h1><p class="lede">Everyone who has ever booked with you.</p></div>' +
        '<div class="ph-actions">' +
          '<button class="btn" id="cuExport">' + TF.icon('download') + ' Export</button>' +
          '<button class="btn btn-primary" id="cuNew">' + TF.icon('plus') + ' Add Customer</button>' +
        '</div>' +
      '</div>' +

      '<div class="grid grid-4 mb-3">' +
        stat('Total customers', TF.fmt.num(all.length), 'users') +
        stat('Repeat guests', TF.fmt.num(repeat) + ' · ' + Math.round((repeat / all.length) * 100) + '%', 'refresh', 'violet') +
        stat('Lifetime revenue', TF.fmt.money(totalSpent), 'dollar', 'green') +
        stat('Average spend', TF.fmt.money(totalSpent / (all.length || 1)), 'chart', 'amber') +
      '</div>' +

      '<section class="card">' +
        '<div class="filter-bar">' +
          '<input class="input grow" id="cuQ" placeholder="Search name, email or phone…" value="' + TF.esc(q) + '">' +
          '<select class="select" id="cuStatus"><option value="">Any status</option>' +
            TF.options(['Active', 'VIP', 'Blocked'], statusFilter) + '</select>' +
          '<select class="select" id="cuSort">' +
            TF.options([{ v: 'spent', l: 'Highest spend' }, { v: 'bookings', l: 'Most bookings' },
              { v: 'recent', l: 'Most recent' }, { v: 'name', l: 'Name A–Z' }], sort, 'v', 'l') + '</select>' +
        '</div>' +
        '<div id="cuTable"></div>' +
      '</section>';

    renderTable();

    root.querySelector('#cuQ').addEventListener('input', function (e) { q = e.target.value; renderTable(); });
    root.querySelector('#cuStatus').addEventListener('change', function (e) { statusFilter = e.target.value; renderTable(); });
    root.querySelector('#cuSort').addEventListener('change', function (e) { sort = e.target.value; renderTable(); });
    root.querySelector('#cuNew').addEventListener('click', function () { TF.customerForm(null); });
    root.querySelector('#cuExport').addEventListener('click', function () {
      TF.toast('Export queued', 'A CSV of ' + all.length + ' customers would download here.', 'info');
    });
    TF.on(root, 'click', 'tr.clickable', function (e, el) {
      if (e.target.closest('.act-btn')) return;
      TF.customerDrawer(el.dataset.id);
    });
    TF.on(root, 'click', '[data-edit]', function (e, el) { e.stopPropagation(); TF.customerForm(el.dataset.edit); });
    TF.on(root, 'click', '[data-book]', function (e, el) {
      e.stopPropagation();
      TF.bookingForm(null, TF.rerender);
    });

    function renderTable() {
      var qq = q.trim().toLowerCase();
      var rows = all.filter(function (c) {
        if (statusFilter && c.status !== statusFilter) return false;
        if (qq && (c.name + ' ' + c.email + ' ' + c.phone).toLowerCase().indexOf(qq) === -1) return false;
        return true;
      }).map(function (c) {
        return { c: c, st: TF.sel.customerStats(c.id) };
      });

      rows.sort(function (a, b) {
        if (sort === 'spent') return b.st.spent - a.st.spent;
        if (sort === 'bookings') return b.st.bookings - a.st.bookings;
        if (sort === 'recent') return (b.st.last || '') < (a.st.last || '') ? -1 : 1;
        return a.c.name < b.c.name ? -1 : 1;
      });

      var host = root.querySelector('#cuTable');
      if (!rows.length) {
        host.innerHTML = TF.emptyState('users', 'No customers match', 'Try a different search term.');
        return;
      }
      host.innerHTML = '<div class="table-wrap"><table class="tf"><thead><tr>' +
        '<th>Name</th><th class="hide-sm">Contact</th><th class="hide-sm">Country</th>' +
        '<th>Bookings</th><th>Total spent</th><th class="hide-sm">Last booking</th><th>Status</th><th></th>' +
        '</tr></thead><tbody>' + rows.map(function (r) {
          return '<tr class="clickable" data-id="' + r.c.id + '">' +
            '<td><div class="row"><span class="avatar sm">' + TF.fmt.initials(r.c.name) + '</span>' +
              '<span class="cell-main">' + TF.esc(r.c.name) + '</span></div></td>' +
            '<td class="hide-sm"><div class="cell-sub">' + TF.esc(r.c.email) + '</div>' +
              '<div class="cell-sub">' + TF.esc(r.c.phone) + '</div></td>' +
            '<td class="hide-sm">' + TF.esc(r.c.country) + '</td>' +
            '<td>' + r.st.bookings + (r.st.upcoming ? '<div class="tiny" style="color:var(--brand-600)">' +
              r.st.upcoming + ' upcoming</div>' : '') + '</td>' +
            '<td class="strong">' + TF.fmt.money(r.st.spent) + '</td>' +
            '<td class="hide-sm">' + (r.st.last ? TF.fmt.dateShort(r.st.last) : '—') + '</td>' +
            '<td>' + TF.badge(r.c.status) + '</td>' +
            '<td><div class="act-btns">' +
              '<button class="act-btn tip" data-tip="New booking" data-book="' + r.c.id + '">' + TF.icon('plus', 14) + '</button>' +
              '<button class="act-btn tip" data-tip="Edit" data-edit="' + r.c.id + '">' + TF.icon('edit', 14) + '</button>' +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="card-foot small muted">' + rows.length + ' customers</div>';
    }
  };

  function stat(label, value, icon, tone) {
    return '<div class="kpi"><div class="k-top"><span class="k-label">' + label + '</span>' +
      '<span class="k-icon ' + (tone || '') + '">' + TF.icon(icon, 16) + '</span></div>' +
      '<div class="k-value">' + value + '</div></div>';
  }

  /* -------------------------------------------------------- profile */
  TF.customerDrawer = function (id) {
    var c = TF.sel.customer(id);
    if (!c) return;
    var st = TF.sel.customerStats(id);
    var bookings = TF.state().bookings.filter(function (b) { return b.customerId === id; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var upcoming = bookings.filter(function (b) { return b.date >= TF.today() && b.status !== 'Cancelled'; });
    var past = bookings.filter(function (b) { return b.date < TF.today() || b.status === 'Cancelled'; });
    var pays = TF.state().payments.filter(function (p) { return p.customerId === id; }).slice(0, 8);

    var ctx = TF.drawer({
      eyebrow: c.status + ' customer since ' + TF.fmt.date(c.createdAt),
      title: c.name,
      subtitle: c.email + ' · ' + c.phone,
      body:
        '<div class="grid grid-3 mb-3">' +
          '<div class="stat-tile"><div class="l">Bookings</div><div class="v">' + st.bookings + '</div></div>' +
          '<div class="stat-tile"><div class="l">Total spent</div><div class="v">' + TF.fmt.money(st.spent) + '</div></div>' +
          '<div class="stat-tile"><div class="l">Upcoming</div><div class="v">' + st.upcoming + '</div></div>' +
        '</div>' +
        '<dl class="dl mb-3">' +
          '<dt>Email</dt><dd>' + TF.esc(c.email) + '</dd>' +
          '<dt>Phone</dt><dd>' + TF.esc(c.phone || '—') + '</dd>' +
          '<dt>Country</dt><dd>' + TF.esc(c.country) + '</dd>' +
          '<dt>Status</dt><dd>' + TF.badge(c.status) + '</dd>' +
        '</dl>' +
        '<div class="section-title">Upcoming bookings</div>' +
        (upcoming.length ? '<div class="mini-list mb-3">' + upcoming.map(bookingRow).join('') + '</div>'
          : '<p class="small muted mb-3">Nothing booked at the moment.</p>') +
        '<div class="section-title">Past bookings</div>' +
        (past.length ? '<div class="mini-list mb-3">' + past.slice(0, 8).map(bookingRow).join('') + '</div>'
          : '<p class="small muted mb-3">No history yet.</p>') +
        '<div class="section-title">Payment history</div>' +
        (pays.length ? '<div class="mini-list mb-3">' + pays.map(function (p) {
          return '<div class="mini-row"><span style="flex:1"><b>' + TF.esc(p.type) + '</b>' +
            '<div class="tiny muted">' + TF.fmt.date(p.date) + ' · ' + TF.esc(p.method) + ' · <span class="mono">' + p.id + '</span></div></span>' +
            '<b style="color:' + (p.amount < 0 ? 'var(--bad-600)' : 'inherit') + '">' + TF.fmt.money(p.amount) + '</b></div>';
        }).join('') + '</div>' : '<p class="small muted mb-3">No transactions.</p>') +
        '<div class="section-title">Notes</div>' +
        '<textarea class="textarea" id="cdNotes">' + TF.esc(c.notes) + '</textarea>' +
        '<button class="btn btn-sm mt-2" id="cdSaveNotes">Save note</button>',
      footer:
        '<button class="btn btn-primary btn-sm" id="cdBook">' + TF.icon('plus') + ' New booking</button>' +
        '<button class="btn btn-sm" id="cdEdit">' + TF.icon('edit') + ' Edit</button>' +
        '<button class="btn btn-sm" id="cdEmail">' + TF.icon('mail') + ' Email guest</button>'
    });

    TF.on(ctx.el, 'click', '[data-booking]', function (e, el) {
      ctx.close(); TF.bookingDrawer(el.dataset.booking);
    });
    ctx.el.querySelector('#cdSaveNotes').addEventListener('click', function () {
      TF.update(function () { c.notes = ctx.el.querySelector('#cdNotes').value; });
      TF.toast('Note saved', 'Updated on ' + c.name + '.');
    });
    ctx.el.querySelector('#cdBook').addEventListener('click', function () {
      ctx.close();
      TF.bookingForm(null, TF.rerender);
    });
    ctx.el.querySelector('#cdEdit').addEventListener('click', function () { ctx.close(); TF.customerForm(id); });
    ctx.el.querySelector('#cdEmail').addEventListener('click', function () {
      TF.toast('Email composed', 'Simulated message to ' + c.email + '.', 'info');
    });

    function bookingRow(b) {
      return '<div class="mini-row" style="cursor:pointer" data-booking="' + b.id + '">' +
        '<span style="font-size:16px">' + (TF.sel.activity(b.activityId) || { emoji: '•' }).emoji + '</span>' +
        '<span style="flex:1"><b>' + TF.esc(TF.sel.activityName(b.activityId)) + '</b>' +
        '<div class="tiny muted">' + b.id + ' · ' + TF.fmt.dateShort(b.date) + ' ' + TF.fmt.time(b.time) +
        ' · ' + b.guests + ' guests</div></span>' +
        '<span class="right"><b>' + TF.fmt.money(b.amount) + '</b><div>' + TF.badge(b.status) + '</div></span></div>';
    }
  };

  /* ------------------------------------------------------ create/edit */
  TF.customerForm = function (id) {
    var c = id ? TF.sel.customer(id) : null;
    var ctx = TF.modal({
      title: c ? 'Edit ' + c.name : 'Add customer',
      size: 'narrow',
      body: '<form id="cfForm" class="form-grid">' +
        '<div class="field full"><label>Full name</label><input class="input" name="name" value="' +
          (c ? TF.esc(c.name) : '') + '"></div>' +
        '<div class="field full"><label>Email</label><input class="input" type="email" name="email" value="' +
          (c ? TF.esc(c.email) : '') + '"></div>' +
        '<div class="field"><label>Phone</label><input class="input" name="phone" value="' +
          (c ? TF.esc(c.phone) : '') + '"></div>' +
        '<div class="field"><label>Country</label><input class="input" name="country" value="' +
          (c ? TF.esc(c.country) : 'United States') + '"></div>' +
        '<div class="field full"><label>Status</label><select class="select" name="status">' +
          TF.options(['Active', 'VIP', 'Blocked'], c ? c.status : 'Active') + '</select></div>' +
        '<div class="field full"><label>Notes</label><textarea class="textarea" name="notes">' +
          (c ? TF.esc(c.notes) : '') + '</textarea></div>' +
        '</form>',
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="cfSave">Save customer</button>'
    });
    ctx.el.querySelector('#cfSave').addEventListener('click', function () {
      if (!TF.requireFields(ctx.el, ['name', 'email'])) return;
      var d = TF.formData(ctx.el.querySelector('#cfForm'));
      if (c) {
        TF.update(function () { Object.keys(d).forEach(function (k) { c[k] = d[k]; }); });
        TF.toast('Customer updated', c.name + ' has been saved.');
      } else {
        TF.update(function (s) {
          s.customers.push({
            id: 'cus-' + (s.customers.length + 1) + '-' + Date.now().toString(36),
            name: d.name, email: d.email, phone: d.phone, country: d.country,
            status: d.status, notes: d.notes, createdAt: TF.today()
          });
          TF.log('customer', d.name + ' added');
        });
        TF.toast('Customer added', d.name + ' is now in your customer list.');
      }
      ctx.close();
      TF.rerender();
    });
  };
})(window);
