/* ==========================================================================
   TourFlow — Payments
   The money ledger. Every row here was written by a booking action somewhere
   else in the app, so refunds made here flow back to the booking's status.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  var f = { q: '', method: '', type: '', range: '30' };

  TF.views.payments = function (root) {
    var s = TF.state();
    var since = f.range === 'all' ? '0000-00-00' : TF.addDays(TF.today(), -parseInt(f.range, 10));

    var inRange = s.payments.filter(function (p) { return p.date >= since; });
    var gross = inRange.filter(function (p) { return p.amount > 0; }).reduce(function (n, p) { return n + p.amount; }, 0);
    var refunded = Math.abs(inRange.filter(function (p) { return p.amount < 0; }).reduce(function (n, p) { return n + p.amount; }, 0));
    var pending = s.bookings.filter(function (b) { return b.status !== 'Cancelled' && b.paid < b.amount; })
      .reduce(function (n, b) { return n + (b.amount - b.paid); }, 0);

    root.innerHTML =
      '<div class="page-head">' +
        '<div class="ph-text"><h1>Payments</h1><p class="lede">Every charge, deposit and refund across your business.</p></div>' +
        '<div class="ph-actions">' +
          '<div class="seg" id="payRange">' +
            ['7', '30', '90', 'all'].map(function (r) {
              return '<button data-r="' + r + '" class="' + (f.range === r ? 'on' : '') + '">' +
                (r === 'all' ? 'All time' : r + ' days') + '</button>';
            }).join('') +
          '</div>' +
          '<button class="btn" id="payExport">' + TF.icon('download') + ' Export</button>' +
        '</div>' +
      '</div>' +

      '<div class="grid grid-4 mb-3">' +
        kpi('Total revenue', TF.fmt.money(gross - refunded), 'dollar', 'green', 'net of refunds') +
        kpi('Collected', TF.fmt.money(gross), 'card', '', inRange.filter(function (p) { return p.amount > 0; }).length + ' transactions') +
        kpi('Pending', TF.fmt.money(pending), 'clock', 'amber', 'balances still owed') +
        kpi('Refunded', TF.fmt.money(refunded), 'arrowL', 'red', inRange.filter(function (p) { return p.amount < 0; }).length + ' refunds') +
      '</div>' +

      '<div class="grid split mb-3" style="grid-template-columns:minmax(0,1fr) 340px;gap:16px">' +
        '<section class="card">' +
          '<div class="card-head"><h2>Transactions</h2>' +
            '<div class="right small muted" id="payCount"></div></div>' +
          '<div class="filter-bar">' +
            '<input class="input grow" id="payQ" placeholder="Search transaction, booking or guest…" value="' + TF.esc(f.q) + '">' +
            '<select class="select" id="payMethod"><option value="">Any method</option>' +
              TF.options(['Credit Card', 'PayPal', 'Cash', 'Bank Transfer', 'Other'], f.method) + '</select>' +
            '<select class="select" id="payType"><option value="">Any type</option>' +
              TF.options(['Full Payment', 'Deposit', 'Partial Payment', 'Refund'], f.type) + '</select>' +
          '</div>' +
          '<div id="payTable"></div>' +
        '</section>' +
        '<aside class="stack">' +
          '<section class="card"><div class="card-head"><h2>By method</h2></div>' +
            '<div class="card-body">' + byMethod(inRange) + '</div></section>' +
          '<section class="card"><div class="card-head"><h2>Payout schedule</h2></div>' +
            '<div class="card-body">' + payouts(gross) + '</div></section>' +
        '</aside>' +
      '</div>';

    renderTable();

    TF.on(root, 'click', '#payRange button', function (e, el) {
      f.range = el.dataset.r; TF.views.payments(root);
    });
    root.querySelector('#payQ').addEventListener('input', function (e) { f.q = e.target.value; renderTable(); });
    root.querySelector('#payMethod').addEventListener('change', function (e) { f.method = e.target.value; renderTable(); });
    root.querySelector('#payType').addEventListener('change', function (e) { f.type = e.target.value; renderTable(); });
    root.querySelector('#payExport').addEventListener('click', function () {
      TF.toast('Export queued', 'A reconciliation CSV would download here.', 'info');
    });
    TF.on(root, 'click', 'tr.clickable', function (e, el) { txDetail(el.dataset.id); });

    function rows() {
      var q = f.q.trim().toLowerCase();
      return inRange.filter(function (p) {
        if (f.method && p.method !== f.method) return false;
        if (f.type && p.type !== f.type) return false;
        if (q) {
          var hay = (p.id + ' ' + p.bookingId + ' ' + TF.sel.customerName(p.customerId)).toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    }

    function renderTable() {
      var list = rows().slice(0, 40);
      root.querySelector('#payCount').textContent = rows().length + ' transactions';
      root.querySelector('#payTable').innerHTML = list.length
        ? '<div class="table-wrap"><table class="tf"><thead><tr>' +
          '<th>Transaction</th><th class="hide-sm">Booking</th><th>Customer</th><th class="hide-sm">Method</th>' +
          '<th class="hide-sm">Type</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>' +
          list.map(function (p) {
            return '<tr class="clickable" data-id="' + p.id + '">' +
              '<td class="mono">' + p.id + '</td>' +
              '<td class="mono hide-sm">' + p.bookingId + '</td>' +
              '<td><div class="row"><span class="avatar sm">' + TF.fmt.initials(TF.sel.customerName(p.customerId)) + '</span>' +
                '<span class="cell-main">' + TF.esc(TF.sel.customerName(p.customerId)) + '</span></div></td>' +
              '<td class="hide-sm">' + TF.esc(p.method) + '</td>' +
              '<td class="hide-sm">' + TF.esc(p.type) + '</td>' +
              '<td class="nowrap">' + TF.fmt.dateShort(p.date) + '</td>' +
              '<td class="strong" style="color:' + (p.amount < 0 ? 'var(--bad-600)' : 'inherit') + '">' +
                TF.fmt.money(p.amount) + '</td>' +
              '<td>' + TF.badge(p.status) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          (rows().length > 40 ? '<div class="card-foot small muted">Showing the 40 most recent of ' + rows().length + '</div>' : '')
        : TF.emptyState('card', 'No transactions match', 'Widen the date range or clear a filter.');
    }
  };

  function kpi(label, value, icon, tone, foot) {
    return '<div class="kpi"><div class="k-top"><span class="k-label">' + label + '</span>' +
      '<span class="k-icon ' + (tone || '') + '">' + TF.icon(icon, 16) + '</span></div>' +
      '<div class="k-value">' + value + '</div><div class="k-foot muted">' + foot + '</div></div>';
  }

  function byMethod(list) {
    var by = {};
    list.filter(function (p) { return p.amount > 0; }).forEach(function (p) {
      by[p.method] = (by[p.method] || 0) + p.amount;
    });
    var total = Object.keys(by).reduce(function (n, k) { return n + by[k]; }, 0) || 1;
    var COLORS = { 'Credit Card': '#4f46e5', 'PayPal': '#0ea5e9', 'Cash': '#059669', 'Bank Transfer': '#7c3aed', 'Other': '#94a3b8' };
    return Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).map(function (k) {
      var pct = Math.round((by[k] / total) * 100);
      return '<div class="mb-2"><div class="row-between small"><span>' + TF.esc(k) + '</span>' +
        '<b>' + TF.fmt.money(by[k]) + '</b></div>' +
        '<div class="progress mt-1"><i style="width:' + pct + '%;background:' + (COLORS[k] || '#94a3b8') + '"></i></div></div>';
    }).join('') || '<p class="small muted">Nothing collected in this range.</p>';
  }

  function payouts(gross) {
    var next = TF.addDays(TF.today(), 1);
    return '<div class="mini-list">' +
      '<div class="mini-row"><span style="flex:1"><b>Next payout</b><div class="tiny muted">' +
        TF.fmt.date(next) + ' · Stripe · ****4429</div></span><b>' + TF.fmt.money(gross * 0.31) + '</b></div>' +
      '<div class="mini-row"><span style="flex:1"><b>In transit</b><div class="tiny muted">Settling now</div></span>' +
        '<b>' + TF.fmt.money(gross * 0.12) + '</b></div>' +
      '<div class="mini-row"><span style="flex:1"><b>Processing fees</b><div class="tiny muted">2.9% + $0.30 per charge</div></span>' +
        '<b>' + TF.fmt.money(gross * 0.029) + '</b></div>' +
      '</div>' +
      '<div class="card mt-3" style="background:var(--brand-50);border-color:var(--brand-100)">' +
        '<div class="card-body tiny" style="color:var(--brand-700)">Payouts are simulated. In production these come from the ' +
        'payment provider, not from TourFlow\'s own ledger.</div></div>';
  }

  /* ------------------------------------------------------- tx detail */
  function txDetail(id) {
    var p = TF.state().payments.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var b = TF.sel.booking(p.bookingId);
    var c = TF.sel.customer(p.customerId);

    TF.modal({
      title: p.type + ' · ' + TF.fmt.money(p.amount),
      subtitle: p.id,
      body:
        '<dl class="dl">' +
          '<dt>Amount</dt><dd style="font-size:17px;font-weight:700">' + TF.fmt.money(p.amount, { cents: true }) + '</dd>' +
          '<dt>Status</dt><dd>' + TF.badge(p.status) + '</dd>' +
          '<dt>Method</dt><dd>' + TF.esc(p.method) + (p.method === 'Credit Card' ? ' · Visa ****4242' : '') + '</dd>' +
          '<dt>Date</dt><dd>' + TF.fmt.date(p.date, true) + '</dd>' +
          '<dt>Booking</dt><dd class="mono">' + p.bookingId + '</dd>' +
          '<dt>Customer</dt><dd>' + TF.esc(c ? c.name : '—') + '</dd>' +
          '<dt>Activity</dt><dd>' + TF.esc(b ? TF.sel.activityName(b.activityId) : '—') + '</dd>' +
          (p.reason ? '<dt>Reason</dt><dd>' + TF.esc(p.reason) + '</dd>' : '') +
        '</dl>' +
        (b ? '<div class="card mt-3"><div class="card-body">' +
          '<div class="row-between small"><span class="muted">Booking total</span><b>' + TF.fmt.money(b.amount) + '</b></div>' +
          '<div class="row-between small mt-1"><span class="muted">Collected</span><b>' + TF.fmt.money(b.paid) + '</b></div>' +
          '<div class="row-between small mt-1"><span class="muted">Balance</span><b>' +
            TF.fmt.money(Math.max(0, b.amount - b.paid)) + '</b></div>' +
          '</div></div>' : ''),
      footer:
        '<button class="btn" data-close>Close</button>' +
        (b ? '<button class="btn" id="txBooking">View booking</button>' : '') +
        (p.amount > 0 && b ? '<button class="btn btn-danger" id="txRefund">Refund</button>' : ''),
      onMount: function (ctx) {
        if (ctx.el.querySelector('#txBooking')) {
          ctx.el.querySelector('#txBooking').addEventListener('click', function () {
            ctx.close(); TF.bookingDrawer(b.id);
          });
        }
        if (ctx.el.querySelector('#txRefund')) {
          ctx.el.querySelector('#txRefund').addEventListener('click', function () {
            ctx.close(); TF.refundModal(b.id, TF.rerender, p.amount);
          });
        }
      }
    });
  }

  /* ---------------------------------------------------------- refund */
  TF.refundModal = function (bookingId, onDone, suggested) {
    var b = TF.sel.booking(bookingId);
    var max = b.paid;
    var ctx = TF.modal({
      title: 'Issue a refund',
      subtitle: b.id + ' · ' + TF.fmt.money(max) + ' available to refund',
      size: 'narrow',
      body: '<div class="form-grid">' +
        '<div class="field full"><label>Refund amount</label>' +
          '<input class="input" id="rfAmt" type="number" min="0" max="' + max + '" value="' +
            Math.min(max, suggested != null ? Math.abs(suggested) : max) + '"></div>' +
        '<div class="field full"><label>Reason</label><select class="select" id="rfReason">' +
          TF.options(['Guest cancelled', 'Weather cancellation', 'Operator cancelled', 'Duplicate charge',
            'Goodwill gesture', 'Other'], 'Guest cancelled') + '</select></div>' +
        '<div class="field full"><label class="check"><input type="checkbox" id="rfCancel"> ' +
          'Also cancel the booking and release the seats</label></div>' +
        '<div class="field full"><label class="check"><input type="checkbox" id="rfNotify" checked> ' +
          'Email the guest a refund confirmation</label></div>' +
        '</div>' +
        '<div class="card mt-3" style="background:var(--warn-50);border-color:var(--warn-100)">' +
          '<div class="card-body tiny" style="color:var(--warn-700)">Demo mode — no money moves. In production this calls the ' +
          'payment provider and the result is only final once their webhook confirms it.</div></div>',
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-danger" id="rfGo">Refund</button>'
    });

    ctx.el.querySelector('#rfGo').addEventListener('click', function () {
      var amt = +ctx.el.querySelector('#rfAmt').value || 0;
      if (amt <= 0 || amt > max) return TF.toast('Invalid amount', 'Refund between $0 and ' + TF.fmt.money(max) + '.', 'err');
      var reason = ctx.el.querySelector('#rfReason').value;
      var alsoCancel = ctx.el.querySelector('#rfCancel').checked;
      TF.actions.refund(bookingId, amt, reason);
      if (alsoCancel) TF.actions.setBookingStatus(bookingId, 'Cancelled');
      ctx.close();
      TF.toast('Refund issued', TF.fmt.money(amt) + ' refunded on ' + bookingId +
        (alsoCancel ? ' and the booking was cancelled.' : '.'));
      if (onDone) onDone();
    });
  };
})(window);
