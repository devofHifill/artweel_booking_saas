/* ==========================================================================
   TourFlow — Daily manifest
   The sheet a guide actually carries: who is coming, how many, waivers,
   balances owed, and where to meet.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  var date = null;
  var slotId = null;

  TF.views.manifest = function (root, params) {
    if (params.date) date = params.date;
    if (params.slot) slotId = params.slot;
    if (!date) date = TF.today();

    var slots = TF.sel.slotsOn(date);
    if (!slots.length) slotId = null;
    else if (!slotId || !slots.filter(function (s) { return s.id === slotId; }).length) slotId = slots[0].id;

    root.innerHTML =
      '<div class="page-head no-print">' +
        '<div class="ph-text"><h1>Daily manifest</h1>' +
        '<p class="lede">Print it, or send it to the guide running the departure.</p></div>' +
        '<div class="ph-actions">' +
          '<input class="input" type="date" id="mfDate" value="' + date + '" style="width:auto">' +
          '<button class="btn" id="mfPrint">' + TF.icon('printer') + ' Print manifest</button>' +
          '<button class="btn" id="mfPdf">' + TF.icon('download') + ' Download PDF</button>' +
          '<button class="btn btn-primary" id="mfSend">' + TF.icon('send') + ' Send to guide</button>' +
        '</div>' +
      '</div>' +
      (slots.length
        ? '<div class="row wrap mb-3 no-print">' + slots.map(function (sl) {
            var a = TF.sel.activity(sl.activityId);
            return '<button class="chip ' + (sl.id === slotId ? 'on' : '') + '" data-slot="' + sl.id + '">' +
              TF.fmt.time(sl.start) + ' · ' + a.emoji + ' ' + TF.esc(a.name) +
              ' (' + TF.sel.booked(sl.id) + '/' + sl.capacity + ')</button>';
          }).join('') + '</div>' + sheet()
        : '<div class="card">' + TF.emptyState('file', 'No departures on ' + TF.fmt.date(date),
            'Pick another date, or schedule a departure from the calendar.',
            '<button class="btn btn-primary btn-sm" data-route="calendar">Open calendar</button>') + '</div>');

    root.querySelector('#mfDate').addEventListener('change', function (e) {
      date = e.target.value; slotId = null; TF.views.manifest(root, {});
    });
    TF.on(root, 'click', '[data-slot]', function (e, el) {
      slotId = el.dataset.slot; TF.views.manifest(root, {});
    });
    root.querySelector('#mfPrint').addEventListener('click', function () { global.print(); });
    root.querySelector('#mfPdf').addEventListener('click', function () {
      TF.toast('PDF queued', 'In production this renders a PDF server-side and downloads it.', 'info');
    });
    root.querySelector('#mfSend').addEventListener('click', function () {
      var sl = TF.sel.slot(slotId);
      if (!sl) return TF.toast('Nothing to send', 'Pick a departure first.', 'err');
      var g = TF.sel.staff(sl.guideId);
      TF.toast('Manifest sent', g ? 'Simulated email + SMS to ' + g.name + ' (' + g.email + ').'
        : 'No guide is assigned to this departure yet.', g ? 'ok' : 'err');
    });
    TF.on(root, 'click', '[data-booking]', function (e, el) { TF.bookingDrawer(el.dataset.booking); });
    TF.on(root, 'change', '.js-checkin', function (e, el) {
      var b = TF.sel.booking(el.dataset.booking);
      TF.update(function () { b.status = el.checked ? 'Completed' : 'Confirmed'; });
      TF.toast(el.checked ? 'Checked in' : 'Check-in undone', b.id + ' · ' + TF.sel.customerName(b.customerId));
    });

    function sheet() {
      var sl = TF.sel.slot(slotId);
      if (!sl) return '';
      var a = TF.sel.activity(sl.activityId);
      var bookings = TF.sel.bookingsForSlot(sl.id);
      var guests = TF.sel.booked(sl.id);
      var owing = bookings.reduce(function (n, b) { return n + Math.max(0, b.amount - b.paid); }, 0);
      var noWaiver = bookings.filter(function (b) { return !b.waiver; }).length;

      return '<section class="card">' +
        '<div class="card-head" style="align-items:flex-start">' +
          '<div style="width:46px;height:46px;border-radius:12px;display:grid;place-items:center;font-size:23px;' +
            'background:linear-gradient(135deg,' + a.grad[0] + ',' + a.grad[1] + ')">' + a.emoji + '</div>' +
          '<div><h2 style="font-size:18px">' + TF.esc(a.name) + '</h2>' +
            '<div class="sub">' + TF.fmt.date(date, true) + ' · ' + TF.fmt.time(sl.start) + ' – ' + TF.fmt.time(sl.end) + '</div></div>' +
          '<div class="right"><div class="right">' +
            '<div style="font-size:22px;font-weight:700">' + guests + ' / ' + sl.capacity + '</div>' +
            '<div class="tiny muted">guests booked</div></div></div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="grid grid-4 mb-3">' +
            '<div class="stat-tile"><div class="l">Guide</div><div class="v" style="font-size:15px">' +
              TF.esc(TF.sel.staffName(sl.guideId)) + '</div>' +
              (sl.guideId ? '<div class="tiny muted">' + TF.esc(TF.sel.staff(sl.guideId).phone) + '</div>' : '') + '</div>' +
            '<div class="stat-tile"><div class="l">Meeting point</div><div class="v" style="font-size:15px">' +
              TF.esc(a.meetingPoint) + '</div></div>' +
            '<div class="stat-tile"><div class="l">Balance owing</div><div class="v">' + TF.fmt.money(owing) + '</div></div>' +
            '<div class="stat-tile"><div class="l">Waivers missing</div><div class="v">' + noWaiver + '</div></div>' +
          '</div>' +
          (a.instructions ? '<div class="card mb-3" style="background:var(--warn-50);border-color:var(--warn-100)">' +
            '<div class="card-body small" style="color:var(--warn-700)"><b>Special instructions.</b> ' +
            TF.esc(a.instructions) + '</div></div>' : '') +
        '</div>' +
        '<div class="table-wrap"><table class="tf"><thead><tr>' +
          '<th style="width:36px">#</th><th>Guest</th><th class="hide-sm">Contact</th><th>Guests</th>' +
          '<th class="hide-sm">Booking</th><th>Waiver</th><th>Balance</th><th class="no-print">Check in</th>' +
        '</tr></thead><tbody>' +
        (bookings.length ? bookings.map(function (b, i) {
          var c = TF.sel.customer(b.customerId);
          var due = Math.max(0, b.amount - b.paid);
          return '<tr>' +
            '<td class="muted">' + (i + 1) + '</td>' +
            '<td><div class="cell-main">' + TF.esc(c ? c.name : '—') + '</div>' +
              (b.notes ? '<div class="cell-sub">' + TF.esc(b.notes) + '</div>' : '') + '</td>' +
            '<td class="hide-sm cell-sub">' + TF.esc(c ? c.phone : '') + '<br>' + TF.esc(c ? c.email : '') + '</td>' +
            '<td class="strong">' + b.guests + '</td>' +
            '<td class="hide-sm mono" style="cursor:pointer" data-booking="' + b.id + '">' + b.id + '</td>' +
            '<td>' + (b.waiver ? '<span class="badge badge-paid"><i class="bdot"></i>Signed</span>'
              : '<span class="badge badge-pending"><i class="bdot"></i>Missing</span>') + '</td>' +
            '<td>' + (due ? '<b style="color:var(--warn-700)">' + TF.fmt.money(due) + '</b>' :
              '<span class="muted">Paid</span>') + '</td>' +
            '<td class="no-print"><label class="switch"><input type="checkbox" class="js-checkin" data-booking="' + b.id + '"' +
              (b.status === 'Completed' ? ' checked' : '') + '><i class="track"></i><i class="thumb"></i></label></td>' +
            '</tr>';
        }).join('') : '<tr><td colspan="8" class="center muted" style="padding:26px">Nobody has booked this departure yet.</td></tr>') +
        '</tbody><tfoot><tr style="background:var(--ink-50);font-weight:700">' +
          '<td></td><td>Total</td><td class="hide-sm"></td><td>' + guests + ' / ' + sl.capacity + '</td>' +
          '<td class="hide-sm"></td><td></td><td>' + TF.fmt.money(owing) + '</td><td class="no-print"></td>' +
        '</tr></tfoot></table></div>' +
      '</section>';
    }
  };
})(window);
