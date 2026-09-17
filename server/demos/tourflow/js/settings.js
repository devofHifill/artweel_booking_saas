/* ==========================================================================
   TourFlow — Settings
   Business, booking rules, payments, policies, messaging, users, roles, tax
   and localisation. Everything persists to localStorage through TF.update.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  var SECTIONS = ['Business Information', 'Booking Settings', 'Payment Settings', 'Cancellation Policy',
    'Email Settings', 'SMS Settings', 'Users & Permissions', 'Tax & Currency', 'Localisation', 'Danger Zone'];
  var section = 'Business Information';

  TF.views.settings = function (root) {
    root.innerHTML =
      '<div class="page-head">' +
        '<div class="ph-text"><h1>Settings</h1><p class="lede">How your business, bookings and money behave.</p></div>' +
      '</div>' +
      '<div class="settings-wrap">' +
        '<nav class="settings-nav" id="stNav">' + SECTIONS.map(function (s) {
          return '<button data-s="' + s + '" class="' + (section === s ? 'on' : '') + '">' + s + '</button>';
        }).join('') + '</nav>' +
        '<div id="stBody"></div>' +
      '</div>';

    draw();

    TF.on(root, 'click', '#stNav button', function (e, el) {
      section = el.dataset.s;
      TF.qsa('#stNav button').forEach(function (b) { b.classList.toggle('on', b.dataset.s === section); });
      draw();
    });

    function draw() {
      var host = root.querySelector('#stBody');
      var s = TF.state();
      host.innerHTML =
        section === 'Business Information' ? business(s) :
        section === 'Booking Settings' ? booking(s) :
        section === 'Payment Settings' ? payments(s) :
        section === 'Cancellation Policy' ? cancellation(s) :
        section === 'Email Settings' ? email(s) :
        section === 'SMS Settings' ? sms(s) :
        section === 'Users & Permissions' ? users(s) :
        section === 'Tax & Currency' ? tax(s) :
        section === 'Localisation' ? localisation(s) : danger();
      wire(host);
    }

    function wire(host) {
      var save = host.querySelector('[data-save]');
      if (save) {
        save.addEventListener('click', function () {
          var group = save.dataset.save;
          var d = TF.formData(host);
          TF.update(function (s) {
            Object.keys(d).forEach(function (k) {
              if (!(group in s.settings)) return;
              var current = s.settings[group][k];
              if (typeof current === 'number') s.settings[group][k] = +d[k];
              else if (typeof current === 'boolean') s.settings[group][k] = !!d[k];
              else if (k in s.settings[group]) s.settings[group][k] = d[k];
            });
            TF.log('settings', section + ' saved');
          });
          TF.toast('Settings saved', section + ' has been updated.');
          draw();
        });
      }

      TF.on(host, 'change', '.js-perm', function (e, el) {
        TF.update(function (s) {
          var role = s.roles.filter(function (r) { return r.id === el.dataset.role; })[0];
          role.perms[el.dataset.perm] = el.checked ? 1 : 0;
        });
        TF.toast('Permission updated', el.dataset.perm + ' ' + (el.checked ? 'granted to' : 'revoked from') +
          ' ' + TF.state().roles.filter(function (r) { return r.id === el.dataset.role; })[0].name + '.');
      });

      TF.on(host, 'click', '[data-user-toggle]', function (e, el) {
        TF.update(function (s) {
          var u = s.users.filter(function (x) { return x.id === el.dataset.userToggle; })[0];
          u.status = u.status === 'Active' ? 'Suspended' : 'Active';
        });
        draw();
        TF.toast('User updated', 'Access has been changed.');
      });

      var invite = host.querySelector('#stInvite');
      if (invite) invite.addEventListener('click', inviteUser);

      var reset = host.querySelector('#stReset');
      if (reset) reset.addEventListener('click', function () {
        TF.confirm({
          title: 'Reset all demo data?',
          message: 'Every booking, activity, customer and setting returns to the original Harbor Adventures demo.',
          confirmText: 'Reset everything',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          TF.reset();
          TF.toast('Demo reset', 'Harbor Adventures is back to its original state.');
          TF.go('dashboard');
        });
      });
    }
  };

  function card(title, sub, inner, group) {
    return '<section class="card"><div class="card-head"><div><h2>' + title + '</h2>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div></div>' +
      '<div class="card-body">' + inner +
      (group ? '<button class="btn btn-primary mt-3" data-save="' + group + '">Save changes</button>' : '') +
      '</div></section>';
  }

  /* --------------------------------------------------------- sections */
  function business(s) {
    var b = s.settings.business;
    return card('Business information', 'Shown on confirmations, receipts and your booking site',
      '<div class="form-grid">' +
        '<div class="field"><label>Business name</label><input class="input" name="name" value="' + TF.esc(b.name) + '"></div>' +
        '<div class="field"><label>Legal name</label><input class="input" name="legalName" value="' + TF.esc(b.legalName) + '"></div>' +
        '<div class="field"><label>Email</label><input class="input" name="email" value="' + TF.esc(b.email) + '"></div>' +
        '<div class="field"><label>Phone</label><input class="input" name="phone" value="' + TF.esc(b.phone) + '"></div>' +
        '<div class="field full"><label>Address</label><input class="input" name="address" value="' + TF.esc(b.address) + '"></div>' +
        '<div class="field"><label>Website</label><input class="input" name="website" value="' + TF.esc(b.website) + '"></div>' +
        '<div class="field"><label>Business type</label><select class="select" name="type">' +
          TF.options(['Tour & Activity Operator', 'Rental Business', 'Adventure Park', 'Museum / Attraction',
            'Classes & Workshops', 'Transport'], b.type) + '</select></div>' +
      '</div>', 'business');
  }

  function booking(s) {
    var b = s.settings.booking;
    return card('Booking rules', 'How far ahead guests can book and what they must provide',
      '<div class="form-grid">' +
        '<div class="field"><label>Minimum notice (hours)</label><input class="input" type="number" name="minNoticeHours" value="' + b.minNoticeHours + '"></div>' +
        '<div class="field"><label>Maximum advance (days)</label><input class="input" type="number" name="maxAdvanceDays" value="' + b.maxAdvanceDays + '"></div>' +
        '<div class="field"><label>Seat hold during checkout (minutes)</label><input class="input" type="number" name="holdMinutes" value="' + b.holdMinutes + '"></div>' +
        '<div class="field"><label>Overbooking buffer</label><input class="input" type="number" name="overbookBuffer" value="' + b.overbookBuffer + '"></div>' +
        '<div class="field full">' + toggle('allowSameDay', 'Allow same-day bookings', b.allowSameDay) + '</div>' +
        '<div class="field full">' + toggle('autoConfirm', 'Confirm bookings automatically when payment succeeds', b.autoConfirm) + '</div>' +
        '<div class="field full">' + toggle('requireWaiver', 'Require a signed waiver before departure', b.requireWaiver) + '</div>' +
        '<div class="field full">' + toggle('requirePhone', 'Require a phone number at checkout', b.requirePhone) + '</div>' +
        '<div class="field full">' + toggle('allowChildren', 'Allow child tickets where the activity supports them', b.allowChildren) + '</div>' +
      '</div>', 'booking');
  }

  function payments(s) {
    var p = s.settings.payments;
    return card('Payments', 'What guests can pay with, and when',
      '<div class="form-grid">' +
        '<div class="field"><label>Payment provider</label><select class="select" name="gateway">' +
          TF.options(['Stripe', 'PayPal', 'Square', 'Adyen'], p.gateway) + '</select></div>' +
        '<div class="field"><label>Deposit percentage</label><input class="input" type="number" name="depositPercent" value="' + p.depositPercent + '"></div>' +
        '<div class="field full">' + toggle('depositEnabled', 'Let guests pay a deposit instead of the full amount', p.depositEnabled) + '</div>' +
        '<div class="field full">' + toggle('payLater', 'Allow "pay on arrival" bookings', p.payLater) + '</div>' +
        '<div class="field full">' + toggle('cashOnArrival', 'Accept cash at the meeting point', p.cashOnArrival) + '</div>' +
      '</div>' +
      '<div class="card mt-3" style="background:var(--ink-50)"><div class="card-body">' +
        '<div class="row-between small"><span>Connected account</span><b>acct_demo_harbor · Visa ****4429</b></div>' +
        '<div class="row-between small mt-2"><span>Payout schedule</span><b>Daily, 2-day rolling</b></div>' +
        '<div class="row-between small mt-2"><span>Processing fee</span><b>2.9% + $0.30</b></div>' +
      '</div></div>', 'payments');
  }

  function cancellation(s) {
    var c = s.settings.cancellation;
    return card('Cancellation policy', 'The default for new activities — each activity can override it',
      '<div class="form-grid">' +
        '<div class="field"><label>Policy type</label><select class="select" name="policy">' +
          TF.options(['Flexible', 'Moderate', 'Strict', 'Non-refundable'], c.policy) + '</select></div>' +
        '<div class="field"><label>Free cancellation until (hours before)</label>' +
          '<input class="input" type="number" name="freeUntilHours" value="' + c.freeUntilHours + '"></div>' +
        '<div class="field"><label>Late cancellation fee (%)</label>' +
          '<input class="input" type="number" name="lateFeePercent" value="' + c.lateFeePercent + '"></div>' +
        '<div class="field"><label>No-show fee (%)</label>' +
          '<input class="input" type="number" name="noShowFeePercent" value="' + c.noShowFeePercent + '"></div>' +
        '<div class="field full"><label>Policy text shown to guests</label>' +
          '<textarea class="textarea" name="text">' + TF.esc(c.text) + '</textarea></div>' +
      '</div>', 'cancellation');
  }

  function email(s) {
    var e = s.settings.email;
    return card('Email', 'Where your transactional email comes from',
      '<div class="form-grid">' +
        '<div class="field"><label>From name</label><input class="input" name="fromName" value="' + TF.esc(e.fromName) + '"></div>' +
        '<div class="field"><label>From address</label><input class="input" name="fromEmail" value="' + TF.esc(e.fromEmail) + '"></div>' +
        '<div class="field"><label>Reply-to</label><input class="input" name="replyTo" value="' + TF.esc(e.replyTo) + '"></div>' +
        '<div class="field"><label>BCC every message to</label><input class="input" name="bcc" value="' + TF.esc(e.bcc) + '" placeholder="optional"></div>' +
        '<div class="field full"><label>Email footer</label><textarea class="textarea" name="footer">' + TF.esc(e.footer) + '</textarea></div>' +
      '</div>' +
      '<div class="mini-list mt-3"><div class="mini-row"><span style="flex:1">Domain authentication (SPF + DKIM)</span>' +
        TF.badge('Active') + '</div></div>', 'email');
  }

  function sms(s) {
    var m = s.settings.sms;
    return card('SMS', 'Text messages for reminders and departure changes',
      '<div class="form-grid">' +
        '<div class="field full">' + toggle('enabled', 'Send SMS messages', m.enabled) + '</div>' +
        '<div class="field"><label>Provider</label><select class="select" name="provider">' +
          TF.options(['Twilio', 'MessageBird', 'Vonage'], m.provider) + '</select></div>' +
        '<div class="field"><label>Sender ID</label><input class="input" name="senderId" value="' + TF.esc(m.senderId) + '"></div>' +
        '<div class="field"><label>Quiet hours from</label><input class="input" type="time" name="quietFrom" value="' + m.quietFrom + '"></div>' +
        '<div class="field"><label>Quiet hours to</label><input class="input" type="time" name="quietTo" value="' + m.quietTo + '"></div>' +
      '</div>' +
      '<div class="card mt-3" style="background:var(--warn-50);border-color:var(--warn-100)">' +
        '<div class="card-body tiny" style="color:var(--warn-700)">In production, US SMS needs an approved A2P 10DLC campaign ' +
        'and explicit consent per recipient. Reminders respect quiet hours; booking confirmations do not.</div></div>', 'sms');
  }

  function users(s) {
    return '<section class="card mb-3"><div class="card-head"><h2>Team</h2>' +
      '<div class="right"><button class="btn btn-sm btn-primary" id="stInvite">' + TF.icon('plus') + ' Invite user</button></div></div>' +
      '<div class="table-wrap"><table class="tf"><thead><tr><th>User</th><th>Email</th><th>Role</th>' +
      '<th class="hide-sm">Last active</th><th>Status</th><th></th></tr></thead><tbody>' +
      s.users.map(function (u) {
        return '<tr><td><div class="row"><span class="avatar sm">' + TF.fmt.initials(u.name) + '</span>' +
          '<span class="cell-main">' + TF.esc(u.name) + '</span></div></td>' +
          '<td class="small muted">' + TF.esc(u.email) + '</td>' +
          '<td><span class="badge badge-brand">' + TF.esc(u.role) + '</span></td>' +
          '<td class="hide-sm small muted">' + TF.esc(u.lastActive) + '</td>' +
          '<td>' + TF.badge(u.status) + '</td>' +
          '<td><div class="act-btns"><button class="act-btn tip" data-tip="' +
            (u.status === 'Active' ? 'Suspend' : 'Reactivate') + '" data-user-toggle="' + u.id + '">' +
            TF.icon(u.status === 'Active' ? 'lock' : 'check', 14) + '</button></div></td></tr>';
      }).join('') + '</tbody></table></div></section>' +

      '<section class="card"><div class="card-head"><div><h2>Roles &amp; permissions</h2>' +
        '<div class="sub">Toggle what each role can do. Owner is fixed.</div></div></div>' +
      '<div class="table-wrap"><table class="tf"><thead><tr><th>Permission</th>' +
      s.roles.map(function (r) { return '<th class="center">' + TF.esc(r.name) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      s.permissions.map(function (p) {
        return '<tr><td class="cell-main">' + TF.esc(p) + '</td>' +
          s.roles.map(function (r) {
            return '<td class="center"><label class="check" style="justify-content:center">' +
              '<input type="checkbox" class="js-perm" data-role="' + r.id + '" data-perm="' + TF.esc(p) + '"' +
              (r.perms[p] ? ' checked' : '') + (r.locked ? ' disabled' : '') + '></label></td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="card-foot tiny muted">Front-end simulation only — a real product enforces these on the server, never in the browser.</div>' +
      '</section>';
  }

  function tax(s) {
    var p = s.settings.payments;
    return card('Tax &amp; currency', 'How prices are displayed and taxed',
      '<div class="form-grid">' +
        '<div class="field"><label>Currency</label><select class="select" name="currency">' +
          TF.options(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD'], p.currency) + '</select></div>' +
        '<div class="field"><label>Tax label</label><input class="input" name="taxLabel" value="' + TF.esc(p.taxLabel) + '"></div>' +
        '<div class="field"><label>Tax rate (%)</label><input class="input" type="number" name="taxRate" value="' + p.taxRate + '"></div>' +
        '<div class="field"><label>Service fee (%)</label><input class="input" type="number" name="serviceFee" value="' + p.serviceFee + '"></div>' +
        '<div class="field full">' + toggle('taxIncluded', 'Prices already include tax', p.taxIncluded) + '</div>' +
      '</div>', 'payments');
  }

  function localisation(s) {
    var b = s.settings.business;
    return card('Localisation', 'Everything the operator sees is rendered in this timezone',
      '<div class="form-grid">' +
        '<div class="field"><label>Timezone</label><select class="select" name="timezone">' +
          TF.options(['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
            'Europe/London', 'Europe/Paris', 'Australia/Sydney'], b.timezone) + '</select></div>' +
        '<div class="field"><label>Date format</label><select class="select" name="dateFormat">' +
          TF.options(['MMM D, YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'], b.dateFormat) + '</select></div>' +
        '<div class="field"><label>Time format</label><select class="select" name="timeFormat">' +
          TF.options(['12h', '24h'], b.timeFormat) + '</select></div>' +
        '<div class="field"><label>Currency</label><select class="select" name="currency">' +
          TF.options(['USD', 'EUR', 'GBP', 'CAD', 'AUD'], b.currency) + '</select></div>' +
      '</div>' +
      '<div class="card mt-3" style="background:var(--ink-50)"><div class="card-body tiny muted">' +
        'Timezone is a data problem, not a display one: a departure at 10:00 in New York is a different instant for a guest ' +
        'booking from Berlin. A production build stores instants, not wall-clock strings.</div></div>', 'business');
  }

  function danger() {
    return '<section class="card" style="border-color:var(--bad-100)">' +
      '<div class="card-head"><div><h2 style="color:var(--bad-700)">Danger zone</h2>' +
      '<div class="sub">Demo controls</div></div></div><div class="card-body">' +
      '<div class="row-between"><div><b>Reset demo data</b>' +
        '<div class="small muted">Throw away everything you changed and restore the original Harbor Adventures business.</div></div>' +
        '<button class="btn btn-danger" id="stReset">Reset demo</button></div>' +
      '<div class="row-between mt-3" style="padding-top:16px;border-top:1px solid var(--border)">' +
        '<div><b>Delete account</b><div class="small muted">Disabled in this prototype.</div></div>' +
        '<button class="btn" disabled>Delete account</button></div>' +
      '</div></section>';
  }

  function toggle(name, label, on) {
    return '<label class="row" style="gap:10px;cursor:pointer">' +
      '<span class="switch"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '>' +
      '<i class="track"></i><i class="thumb"></i></span>' +
      '<span style="font-size:13.5px">' + label + '</span></label>';
  }

  function inviteUser() {
    var ctx = TF.modal({
      title: 'Invite a team member',
      size: 'narrow',
      body: '<form id="iuForm" class="form-grid">' +
        '<div class="field full"><label>Full name</label><input class="input" name="name"></div>' +
        '<div class="field full"><label>Email</label><input class="input" type="email" name="email"></div>' +
        '<div class="field full"><label>Role</label><select class="select" name="role">' +
          TF.options(TF.state().roles.filter(function (r) { return r.name !== 'Owner'; }), 'Manager', 'name', 'name') +
        '</select></div>' +
        '</form>',
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="iuGo">Send invite</button>'
    });
    ctx.el.querySelector('#iuGo').addEventListener('click', function () {
      if (!TF.requireFields(ctx.el, ['name', 'email'])) return;
      var d = TF.formData(ctx.el.querySelector('#iuForm'));
      TF.update(function (s) {
        s.users.push({
          id: 'usr-' + (s.users.length + 1) + '-' + Date.now().toString(36),
          name: d.name, email: d.email, role: d.role, status: 'Active', lastActive: 'Never'
        });
        TF.log('settings', d.name + ' invited as ' + d.role);
      });
      ctx.close();
      TF.toast('Invite sent', d.email + ' has been invited as ' + d.role + '.');
      TF.rerender();
    });
  }
})(window);
