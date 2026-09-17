/* ==========================================================================
   TourFlow — Notifications
   Automation rules with triggers, channels and templates. "Sending" writes to
   the demo activity log and raises a toast; nothing leaves the browser.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  var TRIGGERS = [
    'Immediately after booking',
    'When a payment succeeds',
    '24 hours before the activity',
    '48 hours before the activity',
    '2 hours before the activity',
    'When a booking is cancelled',
    'When a booking moves date or time',
    '24 hours after the activity finishes',
    'Manually, per departure'
  ];
  var CHANNELS = ['Email', 'SMS', 'Email + SMS'];
  var TOKENS = ['{{customer_name}}', '{{activity}}', '{{date}}', '{{time}}', '{{booking_id}}',
    '{{meeting_point}}', '{{amount}}', '{{guests}}', '{{guide_name}}', '{{waiver_link}}', '{{review_link}}'];

  TF.views.notifications = function (root) {
    var s = TF.state();
    var active = s.notifications.filter(function (n) { return n.status === 'Active'; }).length;
    var sent30 = s.notifications.reduce(function (n, x) { return n + x.sent30d; }, 0);

    root.innerHTML =
      '<div class="page-head">' +
        '<div class="ph-text"><h1>Notifications</h1>' +
        '<p class="lede">Automated messages your guests receive, and when.</p></div>' +
        '<div class="ph-actions">' +
          '<button class="btn" id="ntfTest">' + TF.icon('send') + ' Send a test</button>' +
          '<button class="btn btn-primary" id="ntfNew">' + TF.icon('plus') + ' Create notification</button>' +
        '</div>' +
      '</div>' +

      '<div class="grid grid-4 mb-3">' +
        tile('Active automations', active + ' of ' + s.notifications.length, 'zap') +
        tile('Messages (30 days)', TF.fmt.num(sent30), 'send', 'green') +
        tile('Email delivery', '99.2%', 'mail', 'violet') +
        tile('SMS delivery', '97.8%', 'phone', 'amber') +
      '</div>' +

      '<section class="card mb-3">' +
        '<div class="card-head"><h2>Automations</h2>' +
          '<div class="right small muted">Toggle any rule on or off</div></div>' +
        '<div class="table-wrap"><table class="tf"><thead><tr>' +
          '<th>Notification</th><th class="hide-sm">Trigger</th><th>Channel</th>' +
          '<th class="hide-sm">Last sent</th><th class="hide-sm">30 days</th><th>Status</th><th></th>' +
        '</tr></thead><tbody>' + s.notifications.map(row).join('') + '</tbody></table></div>' +
      '</section>' +

      '<div class="grid grid-2">' +
        '<section class="card"><div class="card-head"><h2>Channels</h2></div><div class="card-body">' +
          channelRow('mail', 'Email', s.settings.email.fromEmail, 'Connected via Postmark', true) +
          channelRow('phone', 'SMS', s.settings.sms.senderId, s.settings.sms.enabled ? 'Connected via Twilio' : 'Disabled', s.settings.sms.enabled) +
          '<div class="card mt-3" style="background:var(--ink-50)"><div class="card-body tiny muted">' +
            'Quiet hours ' + TF.esc(s.settings.sms.quietFrom) + ' – ' + TF.esc(s.settings.sms.quietTo) +
            '. Reminders wait; booking confirmations always go out immediately.</div></div>' +
        '</div></section>' +
        '<section class="card"><div class="card-head"><h2>Recent sends</h2></div><div class="card-body">' +
          recentSends() + '</div></section>' +
      '</div>';

    TF.on(root, 'change', '.js-toggle', function (e, el) {
      var n = TF.state().notifications.filter(function (x) { return x.id === el.dataset.id; })[0];
      TF.update(function () { n.status = el.checked ? 'Active' : 'Paused'; });
      TF.toast('Automation ' + (el.checked ? 'enabled' : 'paused'), n.name + ' is now ' + n.status.toLowerCase() + '.');
    });
    TF.on(root, 'click', '[data-edit]', function (e, el) { form(el.dataset.edit); });
    TF.on(root, 'click', '[data-preview]', function (e, el) { preview(el.dataset.preview); });
    TF.on(root, 'click', '[data-send]', function (e, el) { sendNow(el.dataset.send); });
    root.querySelector('#ntfNew').addEventListener('click', function () { form(null); });
    root.querySelector('#ntfTest').addEventListener('click', function () {
      TF.modal({
        title: 'Send a test message',
        size: 'narrow',
        body: '<div class="form-grid">' +
          '<div class="field full"><label>Automation</label><select class="select" id="tsWhich">' +
            TF.options(TF.state().notifications, '', 'id', 'name') + '</select></div>' +
          '<div class="field full"><label>Send to</label><input class="input" id="tsTo" value="alex@harboradventures.com"></div>' +
          '</div>',
        footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="tsGo">Send test</button>',
        onMount: function (ctx) {
          ctx.el.querySelector('#tsGo').addEventListener('click', function () {
            var to = ctx.el.querySelector('#tsTo').value;
            ctx.close();
            TF.toast('Test sent', 'Simulated delivery to ' + to + '.', 'info');
          });
        }
      });
    });

    function row(n) {
      return '<tr>' +
        '<td><div class="row"><span class="k-icon" style="width:28px;height:28px;border-radius:8px">' +
          TF.icon(n.channel.indexOf('SMS') !== -1 ? 'phone' : 'mail', 14) + '</span>' +
          '<span class="cell-main">' + TF.esc(n.name) + '</span></div></td>' +
        '<td class="hide-sm small muted">' + TF.esc(n.trigger) + '</td>' +
        '<td><span class="badge badge-neutral">' + TF.esc(n.channel) + '</span></td>' +
        '<td class="hide-sm small muted">' + TF.esc(n.lastSent) + '</td>' +
        '<td class="hide-sm">' + TF.fmt.num(n.sent30d) + '</td>' +
        '<td><label class="switch"><input type="checkbox" class="js-toggle" data-id="' + n.id + '"' +
          (n.status === 'Active' ? ' checked' : '') + '><i class="track"></i><i class="thumb"></i></label></td>' +
        '<td><div class="act-btns">' +
          '<button class="act-btn tip" data-tip="Preview" data-preview="' + n.id + '">' + TF.icon('eye', 14) + '</button>' +
          '<button class="act-btn tip" data-tip="Send now" data-send="' + n.id + '">' + TF.icon('send', 14) + '</button>' +
          '<button class="act-btn tip" data-tip="Edit" data-edit="' + n.id + '">' + TF.icon('edit', 14) + '</button>' +
        '</div></td></tr>';
    }
  };

  function tile(label, value, icon, tone) {
    return '<div class="kpi"><div class="k-top"><span class="k-label">' + label + '</span>' +
      '<span class="k-icon ' + (tone || '') + '">' + TF.icon(icon, 16) + '</span></div>' +
      '<div class="k-value" style="font-size:22px">' + value + '</div></div>';
  }

  function channelRow(icon, name, id, meta, on) {
    return '<div class="mini-row" style="padding:12px 0">' +
      '<span class="k-icon" style="width:34px;height:34px;border-radius:10px">' + TF.icon(icon, 16) + '</span>' +
      '<span style="flex:1"><b>' + name + '</b><div class="tiny muted">' + TF.esc(id) + ' · ' + meta + '</div></span>' +
      TF.badge(on ? 'Connected' : 'Disconnected') + '</div>';
  }

  function recentSends() {
    var s = TF.state();
    var recent = s.bookings.slice(0, 6);
    return '<div class="mini-list">' + recent.map(function (b) {
      var c = TF.sel.customer(b.customerId);
      return '<div class="mini-row"><span class="avatar sm gray">' + TF.icon('mail', 12) + '</span>' +
        '<span style="flex:1"><b>Booking Confirmation</b><div class="tiny muted">' +
        TF.esc(c ? c.email : '—') + ' · ' + b.id + '</div></span>' +
        '<span class="badge badge-paid"><i class="bdot"></i>Delivered</span></div>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------ preview */
  function preview(id) {
    var n = TF.state().notifications.filter(function (x) { return x.id === id; })[0];
    var b = TF.state().bookings[0];
    var c = TF.sel.customer(b.customerId);
    var act = TF.sel.activity(b.activityId);
    var rendered = n.template
      .replace(/\{\{customer_name\}\}/g, c ? c.name : 'Guest')
      .replace(/\{\{activity\}\}/g, act.name)
      .replace(/\{\{date\}\}/g, TF.fmt.date(b.date))
      .replace(/\{\{time\}\}/g, TF.fmt.time(b.time))
      .replace(/\{\{booking_id\}\}/g, b.id)
      .replace(/\{\{meeting_point\}\}/g, act.meetingPoint)
      .replace(/\{\{amount\}\}/g, TF.fmt.money(b.amount))
      .replace(/\{\{guests\}\}/g, b.guests)
      .replace(/\{\{guide_name\}\}/g, TF.sel.staffName(b.guideId))
      .replace(/\{\{waiver_link\}\}/g, 'https://book.harboradventures.example/waiver/' + b.id)
      .replace(/\{\{review_link\}\}/g, 'https://book.harboradventures.example/review/' + b.id);

    TF.modal({
      title: n.name,
      subtitle: n.trigger + ' · ' + n.channel,
      body:
        '<div class="card"><div class="card-head" style="background:var(--ink-50)">' +
          '<span class="avatar sm">HA</span>' +
          '<div><b class="small">Harbor Adventures</b><div class="tiny muted">to ' +
            TF.esc(c ? c.email : 'guest@example.com') + '</div></div></div>' +
          '<div class="card-body" style="line-height:1.7;font-size:14px">' + TF.esc(rendered) + '</div>' +
          '<div class="card-foot tiny muted">' + TF.esc(TF.state().settings.email.footer) + '</div>' +
        '</div>' +
        '<div class="section-title mt-3">Template</div>' +
        '<div class="code">' + TF.esc(n.template) + '</div>',
      footer: '<button class="btn" data-close>Close</button>' +
        '<button class="btn btn-primary" id="pvEdit">Edit template</button>',
      onMount: function (ctx) {
        ctx.el.querySelector('#pvEdit').addEventListener('click', function () { ctx.close(); form(id); });
      }
    });
  }

  function sendNow(id) {
    var n = TF.state().notifications.filter(function (x) { return x.id === id; })[0];
    var recipients = TF.state().bookings.filter(function (b) {
      return b.date >= TF.today() && b.status !== 'Cancelled';
    }).length;
    TF.confirm({
      title: 'Send “' + n.name + '” now?',
      message: 'This would go to ' + recipients + ' guests with upcoming bookings. In the demo it only writes to the activity log.',
      confirmText: 'Send now'
    }).then(function (ok) {
      if (!ok) return;
      TF.update(function () {
        n.lastSent = 'just now';
        n.sent30d += recipients;
        TF.log('email', n.name + ' sent to ' + recipients + ' guests');
      });
      TF.toast('Messages queued', recipients + ' guests will receive “' + n.name + '”.', 'info');
      TF.rerender();
    });
  }

  /* --------------------------------------------------------- create/edit */
  function form(id) {
    var n = id ? TF.state().notifications.filter(function (x) { return x.id === id; })[0] : null;
    var ctx = TF.modal({
      title: n ? 'Edit ' + n.name : 'Create notification',
      subtitle: 'Tokens in double braces are replaced with real booking data',
      body: '<form id="ntForm" class="form-grid">' +
        '<div class="field full"><label>Notification name</label><input class="input" name="name" value="' +
          (n ? TF.esc(n.name) : '') + '" placeholder="Pre-departure checklist"></div>' +
        '<div class="field"><label>Trigger</label><select class="select" name="trigger">' +
          TF.options(TRIGGERS, n ? n.trigger : TRIGGERS[0]) + '</select></div>' +
        '<div class="field"><label>Channel</label><select class="select" name="channel">' +
          TF.options(CHANNELS, n ? n.channel : 'Email') + '</select></div>' +
        '<div class="field full"><label>Message template</label>' +
          '<textarea class="textarea" name="template" id="ntTemplate" style="min-height:130px">' +
          (n ? TF.esc(n.template) : '') + '</textarea>' +
          '<div class="chip-group mt-1">' + TOKENS.map(function (t) {
            return '<button type="button" class="chip" data-token="' + t + '" style="font-family:var(--mono);font-size:11.5px">' +
              t + '</button>';
          }).join('') + '</div></div>' +
        '<div class="field full"><label>Status</label><select class="select" name="status">' +
          TF.options(['Active', 'Paused'], n ? n.status : 'Active') + '</select></div>' +
        '</form>',
      footer: '<button class="btn" data-close>Cancel</button>' +
        '<button class="btn btn-primary" id="ntSave">Save notification</button>'
    });

    TF.on(ctx.el, 'click', '[data-token]', function (e, b) {
      var ta = ctx.el.querySelector('#ntTemplate');
      var pos = ta.selectionStart || ta.value.length;
      ta.value = ta.value.slice(0, pos) + b.dataset.token + ta.value.slice(pos);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos + b.dataset.token.length;
    });

    ctx.el.querySelector('#ntSave').addEventListener('click', function () {
      if (!TF.requireFields(ctx.el, ['name', 'template'])) return;
      var d = TF.formData(ctx.el.querySelector('#ntForm'));
      if (n) {
        TF.update(function () { Object.keys(d).forEach(function (k) { n[k] = d[k]; }); });
        TF.toast('Notification saved', n.name + ' updated.');
      } else {
        TF.update(function (s) {
          s.notifications.push({
            id: 'ntf-' + (s.notifications.length + 1) + '-' + Date.now().toString(36),
            name: d.name, trigger: d.trigger, channel: d.channel, template: d.template,
            status: d.status, lastSent: 'Never', sent30d: 0
          });
          TF.log('email', d.name + ' automation created');
        });
        TF.toast('Notification created', d.name + ' is now ' + d.status.toLowerCase() + '.');
      }
      ctx.close();
      TF.rerender();
    });
  }
})(window);
