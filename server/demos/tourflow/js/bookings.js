/* ==========================================================================
   TourFlow — Bookings
   List + filters + tabs, the booking detail drawer, and the create/edit form.
   The drawer and the form are exported on TF so the dashboard, calendar,
   customer and staff screens can all open the same UI.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  var TABS = ['All', 'Confirmed', 'Pending', 'Completed', 'Cancelled', 'No Show'];
  var filters = { tab: 'All', q: '', date: '', activity: '', payment: '', staff: '', source: '' };
  var page = 1;
  var PER_PAGE = 12;

  /* ================================================================ list */
  TF.views.bookings = function (root, params) {
    if (params.tab && TABS.indexOf(params.tab) !== -1) filters.tab = params.tab;
    if (params.q) filters.q = params.q;
    if (params.date) filters.date = params.date;

    var s = TF.state();

    root.innerHTML =
      '<div class="page-head">' +
        '<div class="ph-text"><h1>Bookings</h1>' +
        '<p class="lede">Every reservation across your website, the widget and your resellers.</p></div>' +
        '<div class="ph-actions">' +
          '<button class="btn" id="bkExport">' + TF.icon('download') + ' Export CSV</button>' +
          '<button class="btn btn-primary" id="bkNew">' + TF.icon('plus') + ' Create Manual Booking</button>' +
        '</div>' +
      '</div>' +
      '<section class="card">' +
        '<div style="padding:0 18px"><div class="tabs" id="bkTabs">' + TABS.map(function (t) {
          var n = countFor(t);
          return '<button class="tab ' + (filters.tab === t ? 'on' : '') + '" data-tab="' + t + '">' + t +
            '<span class="pill">' + n + '</span></button>';
        }).join('') + '</div></div>' +
        '<div class="filter-bar">' +
          '<div class="grow" style="position:relative">' +
            '<input class="input" id="bkQ" placeholder="Search booking ID, guest name or email…" value="' + TF.esc(filters.q) + '">' +
          '</div>' +
          '<input class="input" type="date" id="bkDate" value="' + TF.esc(filters.date) + '" title="Filter by date">' +
          '<select class="select" id="bkAct"><option value="">All activities</option>' +
            TF.options(s.activities, filters.activity, 'id', 'name') + '</select>' +
          '<select class="select" id="bkPay"><option value="">Any payment</option>' +
            TF.options(['Paid', 'Partially Paid', 'Pending', 'Refunded'], filters.payment) + '</select>' +
          '<select class="select" id="bkStaff"><option value="">Any guide</option>' +
            TF.options(s.staff, filters.staff, 'id', 'name') + '</select>' +
          '<select class="select" id="bkSrc"><option value="">Any source</option>' +
            TF.options(['Website', 'Widget', 'Admin', 'Viator', 'Tripadvisor'], filters.source) + '</select>' +
          '<button class="btn btn-sm" id="bkClear">Clear</button>' +
        '</div>' +
        '<div id="bkTable"></div>' +
      '</section>';

    renderTable();

    TF.on(root, 'click', '[data-tab]', function (e, el) {
      filters.tab = el.dataset.tab; page = 1;
      TF.qsa('#bkTabs .tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === filters.tab); });
      renderTable();
    });
    root.querySelector('#bkQ').addEventListener('input', function (e) { filters.q = e.target.value; page = 1; renderTable(); });
    root.querySelector('#bkDate').addEventListener('change', function (e) { filters.date = e.target.value; page = 1; renderTable(); });
    root.querySelector('#bkAct').addEventListener('change', function (e) { filters.activity = e.target.value; page = 1; renderTable(); });
    root.querySelector('#bkPay').addEventListener('change', function (e) { filters.payment = e.target.value; page = 1; renderTable(); });
    root.querySelector('#bkStaff').addEventListener('change', function (e) { filters.staff = e.target.value; page = 1; renderTable(); });
    root.querySelector('#bkSrc').addEventListener('change', function (e) { filters.source = e.target.value; page = 1; renderTable(); });
    root.querySelector('#bkClear').addEventListener('click', function () {
      filters = { tab: 'All', q: '', date: '', activity: '', payment: '', staff: '', source: '' };
      page = 1; TF.views.bookings(root, {});
    });
    root.querySelector('#bkNew').addEventListener('click', function () {
      TF.bookingForm(null, function () { TF.rerender(); });
    });
    root.querySelector('#bkExport').addEventListener('click', function () {
      TF.toast('Export queued', 'In production this streams a CSV of the ' + filtered().length + ' filtered bookings.', 'info');
    });

    TF.on(root, 'click', 'tr.clickable', function (e, el) {
      if (e.target.closest('.act-btn')) return;
      TF.bookingDrawer(el.dataset.id);
    });
    TF.on(root, 'click', '.js-page', function (e, el) {
      page = +el.dataset.p; renderTable();
      root.querySelector('#bkTable').scrollIntoView({ block: 'nearest' });
    });
    TF.on(root, 'click', '.js-row-menu', function (e, el) {
      e.stopPropagation();
      rowMenu(el, el.dataset.id);
    });

    function renderTable() {
      var rows = filtered();
      var host = root.querySelector('#bkTable');
      if (!rows.length) {
        host.innerHTML = TF.emptyState('ticket', 'No bookings match these filters',
          'Try clearing a filter, or create a booking manually for a walk-in guest.',
          '<button class="btn btn-primary btn-sm" id="bkEmptyNew">' + TF.icon('plus') + ' Create booking</button>');
        var b = host.querySelector('#bkEmptyNew');
        if (b) b.addEventListener('click', function () { TF.bookingForm(null, function () { TF.rerender(); }); });
        return;
      }
      var pages = Math.ceil(rows.length / PER_PAGE);
      if (page > pages) page = 1;
      var slice = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);

      host.innerHTML =
        '<div class="table-wrap"><table class="tf"><thead><tr>' +
          '<th>Booking</th><th>Customer</th><th class="hide-sm">Activity</th><th>Date &amp; time</th>' +
          '<th class="hide-sm">Guests</th><th>Amount</th><th class="hide-sm">Payment</th><th>Status</th><th></th>' +
        '</tr></thead><tbody>' + slice.map(rowHtml).join('') + '</tbody></table></div>' +
        pager(rows.length, pages);
    }

    function pager(total, pages) {
      if (pages <= 1) return '<div class="card-foot small muted">' + total + ' bookings</div>';
      var btns = '';
      for (var i = 1; i <= pages; i++) {
        btns += '<button class="btn btn-sm js-page ' + (i === page ? 'btn-primary' : '') + '" data-p="' + i + '">' + i + '</button>';
      }
      return '<div class="card-foot row-between"><span class="small muted">' +
        ((page - 1) * PER_PAGE + 1) + '–' + Math.min(page * PER_PAGE, total) + ' of ' + total + ' bookings</span>' +
        '<div class="row" style="gap:4px">' + btns + '</div></div>';
    }
  };

  function countFor(tab) {
    var all = TF.state().bookings;
    return tab === 'All' ? all.length : all.filter(function (b) { return b.status === tab; }).length;
  }

  function filtered() {
    var q = filters.q.trim().toLowerCase();
    return TF.state().bookings.filter(function (b) {
      if (filters.tab !== 'All' && b.status !== filters.tab) return false;
      if (filters.date && b.date !== filters.date) return false;
      if (filters.activity && b.activityId !== filters.activity) return false;
      if (filters.payment && b.paymentStatus !== filters.payment) return false;
      if (filters.staff && b.guideId !== filters.staff) return false;
      if (filters.source && b.source !== filters.source) return false;
      if (q) {
        var c = TF.sel.customer(b.customerId);
        var hay = (b.id + ' ' + (c ? c.name + ' ' + c.email : '') + ' ' + TF.sel.activityName(b.activityId)).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.time < b.time ? 1 : -1;
    });
  }

  function rowHtml(b) {
    var c = TF.sel.customer(b.customerId);
    return '<tr class="clickable" data-id="' + b.id + '">' +
      '<td class="mono">' + b.id + '<div class="tiny muted">' + TF.esc(b.source) + '</div></td>' +
      '<td><div class="row"><span class="avatar sm">' + TF.fmt.initials(c ? c.name : '?') + '</span>' +
        '<span><span class="cell-main">' + TF.esc(c ? c.name : 'Unknown') + '</span>' +
        '<div class="cell-sub hide-sm">' + TF.esc(c ? c.email : '') + '</div></span></div></td>' +
      '<td class="hide-sm">' + TF.esc(TF.sel.activityName(b.activityId)) + '</td>' +
      '<td class="nowrap">' + TF.fmt.dateShort(b.date) + '<div class="cell-sub">' + TF.fmt.time(b.time) + '</div></td>' +
      '<td class="hide-sm">' + b.guests + '</td>' +
      '<td class="strong">' + TF.fmt.money(b.amount) +
        (b.paid < b.amount && b.status !== 'Cancelled' ? '<div class="tiny" style="color:var(--warn-700)">' +
          TF.fmt.money(b.amount - b.paid) + ' due</div>' : '') + '</td>' +
      '<td class="hide-sm">' + TF.badge(b.paymentStatus) + '</td>' +
      '<td>' + TF.badge(b.status) + '</td>' +
      '<td><div class="act-btns dropdown">' +
        '<button class="act-btn js-row-menu" data-id="' + b.id + '" aria-label="Actions">' + TF.icon('more', 14) + '</button>' +
      '</div></td></tr>';
  }

  function rowMenu(anchor, id) {
    var b = TF.sel.booking(id);
    TF.dropdown(anchor, [
      { key: 'view', label: 'View details', icon: 'eye', onSelect: function () { TF.bookingDrawer(id); } },
      { key: 'edit', label: 'Edit booking', icon: 'edit', onSelect: function () { TF.bookingForm(id, TF.rerender); } },
      { key: 'resched', label: 'Reschedule', icon: 'calendar', onSelect: function () { TF.rescheduleBooking(id, TF.rerender); } },
      { sep: true },
      { key: 'confirm', label: 'Send confirmation', icon: 'send', onSelect: function () { TF.sendConfirmation(id); } },
      { key: 'done', label: 'Mark completed', icon: 'checkCircle', onSelect: function () {
          TF.actions.setBookingStatus(id, 'Completed'); TF.toast('Booking updated', id + ' marked completed.'); TF.rerender(); } },
      { key: 'noshow', label: 'Mark no show', icon: 'alert', onSelect: function () {
          TF.actions.setBookingStatus(id, 'No Show'); TF.toast('Booking updated', id + ' marked as a no show.'); TF.rerender(); } },
      { sep: true },
      { key: 'cancel', label: 'Cancel booking', icon: 'x', danger: true, onSelect: function () { TF.cancelBookingFlow(id, TF.rerender); } }
    ]);
    void b;
  }

  /* ============================================================== drawer */
  TF.bookingDrawer = function (id) {
    var b = TF.sel.booking(id);
    if (!b) return TF.toast('Not found', 'That booking no longer exists.', 'err');
    var c = TF.sel.customer(b.customerId);
    var act = TF.sel.activity(b.activityId);
    var slot = TF.sel.slot(b.slotId);
    var pays = TF.state().payments.filter(function (p) { return p.bookingId === b.id; });

    var body =
      '<div class="row-between mb-3">' + TF.badge(b.status) + TF.badge(b.paymentStatus) +
        '<span class="badge badge-neutral">' + TF.esc(b.source) + '</span><span class="spacer"></span>' +
        '<span class="small muted">Booked ' + TF.fmt.date(b.createdAt) + '</span></div>' +

      '<div class="card mb-3"><div class="card-body">' +
        '<div class="row" style="align-items:flex-start">' +
          '<div style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;font-size:22px;' +
          'background:linear-gradient(135deg,' + act.grad[0] + ',' + act.grad[1] + ')">' + act.emoji + '</div>' +
          '<div style="flex:1"><b style="font-size:15px">' + TF.esc(act.name) + '</b>' +
          '<div class="small muted">' + TF.fmt.date(b.date, true) + ' · ' + TF.fmt.time(b.time) +
          ' · ' + TF.fmt.duration(act.duration) + '</div></div>' +
        '</div>' +
        '<div class="grid grid-3 mt-3">' +
          '<div class="stat-tile"><div class="l">Guests</div><div class="v">' + b.guests + '</div>' +
            '<div class="tiny muted">' + b.adults + ' adult' + (b.adults === 1 ? '' : 's') +
            (b.children ? ' · ' + b.children + ' child' + (b.children === 1 ? '' : 'ren') : '') + '</div></div>' +
          '<div class="stat-tile"><div class="l">Total</div><div class="v">' + TF.fmt.money(b.amount) + '</div>' +
            '<div class="tiny muted">' + TF.fmt.money(b.paid) + ' collected</div></div>' +
          '<div class="stat-tile"><div class="l">Balance</div><div class="v">' + TF.fmt.money(Math.max(0, b.amount - b.paid)) + '</div>' +
            '<div class="tiny muted">' + TF.esc(b.paymentMethod) + '</div></div>' +
        '</div>' +
      '</div></div>' +

      '<div class="section-title">Guest</div>' +
      '<div class="card mb-3"><div class="card-body">' +
        '<div class="row"><span class="avatar">' + TF.fmt.initials(c ? c.name : '?') + '</span>' +
        '<div style="flex:1"><b>' + TF.esc(c ? c.name : 'Unknown') + '</b>' +
        '<div class="small muted">' + TF.esc(c ? c.email : '') + ' · ' + TF.esc(c ? c.phone : '') + '</div></div>' +
        '<button class="btn btn-sm" id="bdCust">Profile</button></div>' +
      '</div></div>' +

      '<div class="section-title">Operations</div>' +
      '<dl class="dl mb-3">' +
        '<dt>Booking ID</dt><dd class="mono">' + b.id + '</dd>' +
        '<dt>Departure</dt><dd>' + (slot ? TF.fmt.time(slot.start) + ' – ' + TF.fmt.time(slot.end) : TF.fmt.time(b.time)) + '</dd>' +
        '<dt>Guide</dt><dd>' + TF.esc(TF.sel.staffName(b.guideId)) + '</dd>' +
        '<dt>Meeting point</dt><dd>' + TF.esc(act.meetingPoint) + '</dd>' +
        '<dt>Seats on slot</dt><dd>' + (slot ? TF.sel.booked(slot.id) + ' / ' + slot.capacity + ' booked' : '—') + '</dd>' +
        '<dt>Waiver</dt><dd>' + (b.waiver
          ? '<span class="badge badge-paid"><i class="bdot"></i>Signed</span>'
          : '<span class="badge badge-pending"><i class="bdot"></i>Not signed</span> ' +
            '<button class="btn btn-sm" id="bdWaiver" style="margin-left:6px">Send reminder</button>') + '</dd>' +
      '</dl>' +

      '<div class="section-title">Payments</div>' +
      '<div class="card mb-3">' + (pays.length ? '<div class="card-body mini-list" style="padding-top:4px;padding-bottom:4px">' +
        pays.map(function (p) {
          return '<div class="mini-row"><span class="k-icon ' + (p.amount < 0 ? 'red' : 'green') +
            '" style="width:28px;height:28px;border-radius:8px">' + TF.icon(p.amount < 0 ? 'arrowL' : 'dollar', 14) + '</span>' +
            '<span style="flex:1"><b>' + TF.esc(p.type) + '</b><div class="tiny muted">' + TF.esc(p.method) + ' · ' +
            TF.fmt.date(p.date) + ' · <span class="mono">' + p.id + '</span></div></span>' +
            '<b style="color:' + (p.amount < 0 ? 'var(--bad-600)' : 'inherit') + '">' + TF.fmt.money(p.amount) + '</b></div>';
        }).join('') + '</div>' : '<div class="card-body small muted">No transactions recorded — payment is due on arrival.</div>') +
      '</div>' +

      '<div class="section-title">Internal notes</div>' +
      '<textarea class="textarea" id="bdNotes" placeholder="Notes are visible to your team, never to the guest.">' +
        TF.esc(b.notes) + '</textarea>' +
      '<button class="btn btn-sm mt-2" id="bdSaveNotes">Save note</button>';

    var footer =
      '<button class="btn btn-primary btn-sm" id="bdEdit">' + TF.icon('edit') + ' Edit</button>' +
      '<button class="btn btn-sm" id="bdResched">' + TF.icon('calendar') + ' Reschedule</button>' +
      '<button class="btn btn-sm" id="bdSend">' + TF.icon('send') + ' Send confirmation</button>' +
      '<button class="btn btn-sm" id="bdPrint">' + TF.icon('printer') + ' Print</button>' +
      (b.paid > 0 ? '<button class="btn btn-sm" id="bdRefund">' + TF.icon('arrowL') + ' Refund</button>' : '') +
      (b.paid < b.amount && b.status !== 'Cancelled' ? '<button class="btn btn-sm" id="bdCollect">' + TF.icon('dollar') + ' Collect balance</button>' : '') +
      (b.status !== 'Completed' ? '<button class="btn btn-sm" id="bdDone">' + TF.icon('check') + ' Mark completed</button>' : '') +
      (b.status !== 'No Show' ? '<button class="btn btn-sm" id="bdNoShow">' + TF.icon('alert') + ' No show</button>' : '') +
      (b.status !== 'Cancelled' ? '<button class="btn btn-danger btn-sm" id="bdCancel">' + TF.icon('x') + ' Cancel</button>' : '');

    var ctx = TF.drawer({
      eyebrow: b.id,
      title: (c ? c.name : 'Guest') + ' · ' + act.name,
      subtitle: TF.fmt.date(b.date, true) + ' at ' + TF.fmt.time(b.time),
      body: body,
      footer: footer
    });

    function refresh() { ctx.close(); TF.rerender(); }
    var q = function (sel) { return ctx.el.querySelector(sel); };

    q('#bdCust').addEventListener('click', function () { ctx.close(); TF.customerDrawer(b.customerId); });
    q('#bdSaveNotes').addEventListener('click', function () {
      TF.update(function () { b.notes = q('#bdNotes').value; });
      TF.toast('Note saved', 'Visible to your team on ' + b.id + '.');
    });
    if (q('#bdWaiver')) q('#bdWaiver').addEventListener('click', function () {
      TF.toast('Waiver reminder sent', 'Simulated email to ' + (c ? c.email : 'the guest') + '.', 'info');
    });
    q('#bdEdit').addEventListener('click', function () { ctx.close(); TF.bookingForm(b.id, TF.rerender); });
    q('#bdResched').addEventListener('click', function () { ctx.close(); TF.rescheduleBooking(b.id, TF.rerender); });
    q('#bdSend').addEventListener('click', function () { TF.sendConfirmation(b.id); });
    q('#bdPrint').addEventListener('click', function () { printBooking(b); });
    if (q('#bdRefund')) q('#bdRefund').addEventListener('click', function () { ctx.close(); TF.refundModal(b.id, TF.rerender); });
    if (q('#bdCollect')) q('#bdCollect').addEventListener('click', function () { ctx.close(); collectBalance(b.id); });
    if (q('#bdDone')) q('#bdDone').addEventListener('click', function () {
      TF.actions.setBookingStatus(b.id, 'Completed');
      TF.toast('Booking completed', b.id + ' marked completed.');
      refresh();
    });
    if (q('#bdNoShow')) q('#bdNoShow').addEventListener('click', function () {
      TF.actions.setBookingStatus(b.id, 'No Show');
      TF.toast('Marked as no show', b.id + ' will be excluded from occupancy reporting.');
      refresh();
    });
    if (q('#bdCancel')) q('#bdCancel').addEventListener('click', function () {
      ctx.close();
      TF.cancelBookingFlow(b.id, TF.rerender);
    });
  };

  /* ================================================== create / edit form */
  /**
   * @param {string|null} id     booking to edit, or null to create
   * @param {function} onDone    called after a successful save
   */
  TF.bookingForm = function (id, onDone, preset) {
    var s = TF.state();
    var editing = id ? TF.sel.booking(id) : null;
    var p = preset || {};
    var actId = editing ? editing.activityId : (p.activityId || s.activities.filter(function (a) { return a.status === 'Active'; })[0].id);
    var date = editing ? editing.date : (p.date || TF.today());

    var body =
      '<form id="bkForm" class="form-grid">' +
        '<div class="fieldset-title">Guest</div>' +
        '<div class="field full"><label>Customer</label>' +
          '<select class="select" name="customerId" id="bfCustomer">' +
            '<option value="__new">+ New customer…</option>' +
            TF.options(s.customers.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; }),
              editing ? editing.customerId : '', 'id', 'name') +
          '</select></div>' +
        '<div id="bfNewCustomer" class="full" style="display:none">' +
          '<div class="form-grid">' +
            '<div class="field"><label>Full name</label><input class="input" name="newName" placeholder="Jane Doe"></div>' +
            '<div class="field"><label>Email</label><input class="input" name="newEmail" type="email" placeholder="jane@example.com"></div>' +
            '<div class="field"><label>Phone</label><input class="input" name="newPhone" placeholder="+1 555 000 0000"></div>' +
            '<div class="field"><label>Country</label><input class="input" name="newCountry" value="United States"></div>' +
          '</div></div>' +

        '<div class="fieldset-title">Experience</div>' +
        '<div class="field"><label>Activity</label>' +
          '<select class="select" name="activityId" id="bfActivity">' +
            TF.options(s.activities, actId, 'id', 'name') + '</select></div>' +
        '<div class="field"><label>Date</label><input class="input" type="date" name="date" id="bfDate" value="' + date + '"></div>' +
        '<div class="field full"><label>Departure</label>' +
          '<select class="select" name="slotId" id="bfSlot"></select>' +
          '<span class="hint" id="bfSlotHint"></span></div>' +
        '<div class="field"><label>Adults</label><input class="input" type="number" min="0" name="adults" id="bfAdults" value="' +
          (editing ? editing.adults : 2) + '"></div>' +
        '<div class="field"><label>Children</label><input class="input" type="number" min="0" name="children" id="bfChildren" value="' +
          (editing ? editing.children : 0) + '"></div>' +
        '<div class="field full"><label>Guide</label><select class="select" name="guideId" id="bfGuide"></select></div>' +

        '<div class="fieldset-title">Payment</div>' +
        '<div class="field"><label>Method</label><select class="select" name="paymentMethod">' +
          TF.options(['Credit Card', 'PayPal', 'Cash', 'Bank Transfer', 'Other'], editing ? editing.paymentMethod : 'Credit Card') +
        '</select></div>' +
        '<div class="field"><label>Payment status</label><select class="select" name="paymentStatus" id="bfPayStatus">' +
          TF.options(['Paid', 'Partially Paid', 'Pending'], editing ? editing.paymentStatus : 'Paid') + '</select></div>' +
        '<div class="field"><label>Booking status</label><select class="select" name="status">' +
          TF.options(['Confirmed', 'Pending', 'Completed'], editing ? editing.status : 'Confirmed') + '</select></div>' +
        '<div class="field"><label>Total</label><input class="input" name="amount" id="bfAmount" value="' +
          (editing ? editing.amount : 0) + '"><span class="hint" id="bfPriceHint"></span></div>' +
        '<div class="field full"><label class="check"><input type="checkbox" name="waiver"' +
          (editing && editing.waiver ? ' checked' : '') + '> Waiver signed</label></div>' +
        '<div class="field full"><label>Internal notes</label><textarea class="textarea" name="notes" ' +
          'placeholder="Anything the guide should know">' + (editing ? TF.esc(editing.notes) : '') + '</textarea></div>' +
      '</form>';

    var ctx = TF.modal({
      title: editing ? 'Edit booking ' + editing.id : 'Create manual booking',
      subtitle: editing ? 'Changes apply everywhere immediately' : 'For walk-ins, phone bookings and agency requests',
      size: 'wide',
      body: body,
      footer: '<span class="left small muted" id="bfSummary"></span>' +
        '<button class="btn" data-close>Cancel</button>' +
        '<button class="btn btn-primary" id="bfSave">' + (editing ? 'Save changes' : 'Create booking') + '</button>'
    });

    var el = ctx.el;
    var custSel = el.querySelector('#bfCustomer');
    var newBox = el.querySelector('#bfNewCustomer');

    custSel.addEventListener('change', function () {
      newBox.style.display = custSel.value === '__new' ? 'block' : 'none';
    });

    ['#bfActivity', '#bfDate'].forEach(function (sel) {
      el.querySelector(sel).addEventListener('change', function () { fillSlots(); });
    });
    ['#bfAdults', '#bfChildren', '#bfSlot'].forEach(function (sel) {
      el.querySelector(sel).addEventListener('change', recalc);
      el.querySelector(sel).addEventListener('input', recalc);
    });

    fillSlots(editing ? editing.slotId : p.slotId);

    function fillSlots(selectId) {
      var aId = el.querySelector('#bfActivity').value;
      var d = el.querySelector('#bfDate').value;
      var slots = TF.state().schedule.filter(function (sl) {
        return sl.activityId === aId && sl.date === d && sl.status !== 'Cancelled';
      }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });

      var sel = el.querySelector('#bfSlot');
      if (!slots.length) {
        sel.innerHTML = '<option value="">No departures scheduled that day</option>';
        el.querySelector('#bfSlotHint').textContent = 'Add a time slot from the Calendar screen first.';
      } else {
        sel.innerHTML = slots.map(function (sl) {
          var left = TF.sel.seatsLeft(sl);
          return '<option value="' + sl.id + '"' + (sl.id === selectId ? ' selected' : '') + '>' +
            TF.fmt.time(sl.start) + ' — ' + left + ' of ' + sl.capacity + ' seats left · ' + TF.fmt.money(sl.price) + '/adult</option>';
        }).join('');
        el.querySelector('#bfSlotHint').textContent = slots.length + ' departure' + (slots.length === 1 ? '' : 's') + ' that day.';
      }
      fillGuides();
      recalc();
    }

    function fillGuides() {
      var aId = el.querySelector('#bfActivity').value;
      var slot = TF.sel.slot(el.querySelector('#bfSlot').value);
      var eligible = TF.state().staff.filter(function (m) { return m.activities.indexOf(aId) !== -1; });
      var current = editing ? editing.guideId : (slot ? slot.guideId : '');
      el.querySelector('#bfGuide').innerHTML = '<option value="">Unassigned</option>' +
        TF.options(eligible, current, 'id', 'name');
    }

    function recalc() {
      var act = TF.sel.activity(el.querySelector('#bfActivity').value);
      var slot = TF.sel.slot(el.querySelector('#bfSlot').value);
      var unit = slot ? slot.price : act.price;
      var adults = +el.querySelector('#bfAdults').value || 0;
      var children = +el.querySelector('#bfChildren').value || 0;
      var total = adults * unit + children * act.childPrice;
      el.querySelector('#bfAmount').value = total;
      el.querySelector('#bfPriceHint').textContent =
        adults + ' × ' + TF.fmt.money(unit) + (children ? ' + ' + children + ' × ' + TF.fmt.money(act.childPrice) : '');
      var left = slot ? TF.sel.seatsLeft(slot) + (editing && editing.slotId === slot.id ? editing.guests : 0) : 0;
      el.querySelector('#bfSummary').innerHTML = slot
        ? (adults + children) + ' guests · ' + TF.fmt.money(total) + ' · ' + left + ' seats available'
        : 'Pick a departure to price this booking';
    }

    el.querySelector('#bfSave').addEventListener('click', function () {
      var d = TF.formData(el.querySelector('#bkForm'));
      var slot = TF.sel.slot(d.slotId);
      if (!slot) return TF.toast('No departure selected', 'Pick a time slot, or schedule one on the calendar first.', 'err');

      var adults = +d.adults || 0, children = +d.children || 0;
      var guests = adults + children;
      if (guests < 1) return TF.toast('No guests', 'A booking needs at least one guest.', 'err');

      var seatsLeft = TF.sel.seatsLeft(slot) + (editing && editing.slotId === slot.id ? editing.guests : 0);
      if (guests > seatsLeft) {
        return TF.toast('Not enough capacity', 'That departure has ' + seatsLeft + ' seats left.', 'err');
      }

      var customerId = d.customerId;
      if (customerId === '__new') {
        if (!TF.requireFields(el, ['newName', 'newEmail'])) return;
        var c = TF.actions.findOrCreateCustomer({
          name: d.newName, email: d.newEmail, phone: d.newPhone, country: d.newCountry
        });
        customerId = c.id;
      }

      var amount = +d.amount || 0;
      var paid = d.paymentStatus === 'Paid' ? amount
        : d.paymentStatus === 'Partially Paid' ? Math.round(amount * (s.settings.payments.depositPercent / 100)) : 0;

      if (editing) {
        TF.update(function () {
          var before = editing.paid;
          editing.customerId = customerId;
          editing.activityId = d.activityId;
          editing.slotId = slot.id;
          editing.date = slot.date;
          editing.time = slot.start;
          editing.adults = adults;
          editing.children = children;
          editing.guests = guests;
          editing.amount = amount;
          editing.paymentStatus = d.paymentStatus;
          editing.paymentMethod = d.paymentMethod;
          editing.status = d.status;
          editing.guideId = d.guideId || null;
          editing.waiver = !!d.waiver;
          editing.notes = d.notes;
          editing.paid = paid;
          if (paid > before) {
            TF.state().payments.unshift({
              id: TF.sel.nextTxId(), bookingId: editing.id, customerId: customerId,
              amount: paid - before, method: d.paymentMethod,
              type: paid < amount ? 'Deposit' : 'Full Payment', date: TF.today(), status: 'Succeeded'
            });
          }
          TF.log('booking', 'Booking ' + editing.id + ' edited');
        });
        TF.toast('Booking updated', editing.id + ' saved. Capacity and reports have been recalculated.');
      } else {
        var created = TF.actions.createBooking({
          customerId: customerId,
          activityId: d.activityId,
          slotId: slot.id,
          adults: adults,
          children: children,
          amount: amount,
          paid: paid,
          paymentStatus: d.paymentStatus,
          paymentMethod: d.paymentMethod,
          status: d.status,
          guideId: d.guideId || null,
          waiver: !!d.waiver,
          notes: d.notes,
          source: 'Admin'
        });
        TF.toast('Booking created successfully', created.id + ' · ' + TF.sel.activityName(created.activityId) +
          ' on ' + TF.fmt.date(created.date));
      }
      ctx.close();
      if (onDone) onDone();
    });
  };

  /* =========================================================== reschedule */
  TF.rescheduleBooking = function (id, onDone) {
    var b = TF.sel.booking(id);
    var ctx = TF.modal({
      title: 'Reschedule ' + id,
      subtitle: TF.sel.activityName(b.activityId) + ' · currently ' + TF.fmt.date(b.date) + ' at ' + TF.fmt.time(b.time),
      body:
        '<div class="form-grid">' +
          '<div class="field"><label>New date</label><input class="input" type="date" id="rsDate" value="' + b.date + '"></div>' +
          '<div class="field"><label>New departure</label><select class="select" id="rsSlot"></select></div>' +
          '<div class="field full"><label class="check"><input type="checkbox" id="rsNotify" checked> ' +
            'Send the guest a reschedule confirmation</label></div>' +
        '</div>',
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="rsSave">Move booking</button>'
    });

    function fill() {
      var d = ctx.el.querySelector('#rsDate').value;
      var slots = TF.state().schedule.filter(function (sl) {
        return sl.activityId === b.activityId && sl.date === d && sl.status !== 'Cancelled';
      });
      var sel = ctx.el.querySelector('#rsSlot');
      sel.innerHTML = slots.length ? slots.map(function (sl) {
        var left = TF.sel.seatsLeft(sl) + (sl.id === b.slotId ? b.guests : 0);
        return '<option value="' + sl.id + '"' + (sl.id === b.slotId ? ' selected' : '') + '>' +
          TF.fmt.time(sl.start) + ' — ' + left + ' seats free</option>';
      }).join('') : '<option value="">No departures that day</option>';
    }
    fill();
    ctx.el.querySelector('#rsDate').addEventListener('change', fill);

    ctx.el.querySelector('#rsSave').addEventListener('click', function () {
      var slot = TF.sel.slot(ctx.el.querySelector('#rsSlot').value);
      if (!slot) return TF.toast('No departure', 'Pick a day that has a scheduled departure.', 'err');
      var left = TF.sel.seatsLeft(slot) + (slot.id === b.slotId ? b.guests : 0);
      if (b.guests > left) return TF.toast('Not enough capacity', 'That departure only has ' + left + ' seats free.', 'err');
      var notify = ctx.el.querySelector('#rsNotify').checked;
      TF.update(function () {
        b.slotId = slot.id; b.date = slot.date; b.time = slot.start; b.guideId = slot.guideId;
        TF.log('booking', 'Booking ' + b.id + ' rescheduled to ' + slot.date);
      });
      ctx.close();
      TF.toast('Booking rescheduled', b.id + ' moved to ' + TF.fmt.date(slot.date) + ' at ' + TF.fmt.time(slot.start) +
        (notify ? '. Guest notified.' : '.'));
      if (onDone) onDone();
    });
  };

  /* =============================================================== cancel */
  TF.cancelBookingFlow = function (id, onDone) {
    var b = TF.sel.booking(id);
    TF.confirm({
      title: 'Cancel booking ' + id + '?',
      message: 'The seats go back into inventory immediately and the guest is notified. ' +
        (b.paid > 0 ? TF.fmt.money(b.paid) + ' has been collected on this booking.' : 'No money has been collected.'),
      confirmText: 'Cancel booking',
      danger: true,
      extra: b.paid > 0
        ? '<label class="check mt-3"><input type="checkbox" id="cbRefund" checked> Refund ' + TF.fmt.money(b.paid) + ' to the guest</label>'
        : '',
      collect: function (el) {
        var cb = el.querySelector('#cbRefund');
        return { refund: cb ? cb.checked : false };
      }
    }).then(function (res) {
      if (!res) return;
      TF.actions.cancelBooking(id, res.refund);
      TF.toast('Booking ' + id + ' has been cancelled', res.refund ? 'Refund issued and seats released.' : 'Seats released back to inventory.');
      if (onDone) onDone();
    });
  };

  /* ========================================================= misc actions */
  TF.sendConfirmation = function (id) {
    var b = TF.sel.booking(id);
    var c = TF.sel.customer(b.customerId);
    TF.toast('Confirmation sent', 'Simulated email + SMS to ' + (c ? c.email : 'the guest') + '.', 'info');
    TF.update(function () { TF.log('email', 'Confirmation resent for ' + id); });
  };

  function collectBalance(id) {
    var b = TF.sel.booking(id);
    var due = b.amount - b.paid;
    var ctx = TF.modal({
      title: 'Collect balance',
      subtitle: b.id + ' · ' + TF.fmt.money(due) + ' outstanding',
      size: 'narrow',
      body: '<div class="form-grid">' +
        '<div class="field full"><label>Amount</label><input class="input" id="cbAmt" value="' + due + '"></div>' +
        '<div class="field full"><label>Method</label><select class="select" id="cbMethod">' +
          TF.options(['Credit Card', 'PayPal', 'Cash', 'Bank Transfer'], b.paymentMethod) + '</select></div>' +
        '</div>',
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="cbGo">Take payment</button>'
    });
    ctx.el.querySelector('#cbGo').addEventListener('click', function () {
      var amt = +ctx.el.querySelector('#cbAmt').value || 0;
      if (amt <= 0) return TF.toast('Invalid amount', 'Enter an amount greater than zero.', 'err');
      TF.actions.takePayment(id, amt, ctx.el.querySelector('#cbMethod').value, amt < due ? 'Partial Payment' : 'Full Payment');
      ctx.close();
      TF.toast('Payment recorded', TF.fmt.money(amt) + ' collected on ' + id + '.');
      TF.rerender();
    });
  }

  function printBooking(b) {
    var c = TF.sel.customer(b.customerId);
    var act = TF.sel.activity(b.activityId);
    var w = global.open('', '_blank', 'width=760,height=900');
    if (!w) return TF.toast('Popup blocked', 'Allow popups to print a booking voucher.', 'err');
    w.document.write(
      '<html><head><title>' + b.id + '</title><style>' +
      'body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:40px;color:#0f172a}' +
      'h1{font-size:22px;margin:0 0 4px}.m{color:#64748b;font-size:13px}' +
      'table{width:100%;border-collapse:collapse;margin-top:24px;font-size:14px}' +
      'td{padding:9px 0;border-bottom:1px solid #e2e8f0}td:first-child{color:#64748b;width:180px}' +
      '.tot{font-size:20px;font-weight:700;margin-top:20px}</style></head><body>' +
      '<h1>Harbor Adventures</h1><div class="m">Booking voucher · ' + b.id + '</div>' +
      '<table>' +
      row('Guest', c ? c.name : '—') + row('Email', c ? c.email : '—') + row('Phone', c ? c.phone : '—') +
      row('Activity', act.name) + row('Date', TF.fmt.date(b.date, true)) + row('Time', TF.fmt.time(b.time)) +
      row('Guests', b.adults + ' adults' + (b.children ? ', ' + b.children + ' children' : '')) +
      row('Guide', TF.sel.staffName(b.guideId)) + row('Meeting point', act.meetingPoint) +
      row('Payment', b.paymentStatus + ' · ' + b.paymentMethod) + row('Status', b.status) +
      '</table><div class="tot">Total ' + TF.fmt.money(b.amount) + '</div>' +
      '<p class="m" style="margin-top:26px">' + act.instructions + '</p>' +
      '<p class="m">Demo document — generated by the TourFlow prototype.</p>' +
      '</body></html>');
    w.document.close();
    setTimeout(function () { w.print(); }, 250);
    function row(k, v) { return '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; }
  }
})(window);
