/* ==========================================================================
   TourFlow — Integrations & calendar sync
   Connect/disconnect simulation plus the Google Calendar sync panel.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  var cat = '';

  TF.views.integrations = function (root) {
    var s = TF.state();
    var cats = [''].concat(s.integrations.map(function (i) { return i.cat; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; }));
    var connected = s.integrations.filter(function (i) { return i.status === 'Connected'; }).length;

    root.innerHTML =
      '<div class="page-head">' +
        '<div class="ph-text"><h1>Integrations</h1>' +
        '<p class="lede">Distribute your inventory and connect the tools you already use.</p></div>' +
        '<div class="ph-actions"><button class="btn" id="intBrowse">' + TF.icon('layers') + ' Browse marketplace</button></div>' +
      '</div>' +

      '<div class="grid grid-4 mb-3">' +
        tile('Connected', connected + ' of ' + s.integrations.length, 'plug', 'green') +
        tile('Channel bookings (30d)', TF.fmt.num(s.bookings.filter(function (b) {
          return ['Viator', 'Tripadvisor'].indexOf(b.source) !== -1;
        }).length), 'globe', 'violet') +
        tile('Calendar sync', s.calendarSync.status, 'calendar') +
        tile('Last sync', s.calendarSync.lastSync, 'refresh', 'amber') +
      '</div>' +

      '<section class="card mb-3">' +
        '<div class="card-head"><h2>' + TF.icon('calendar', 16) + ' Calendar synchronisation</h2>' +
          '<div class="right">' + TF.badge(s.calendarSync.status) +
          '<button class="btn btn-sm" id="syncNow">' + TF.icon('refresh') + ' Sync now</button></div></div>' +
        '<div class="card-body">' +
          '<div class="grid grid-4 mb-3">' +
            '<div class="stat-tile"><div class="l">Provider</div><div class="v" style="font-size:15px">' +
              TF.esc(s.calendarSync.provider) + '</div></div>' +
            '<div class="stat-tile"><div class="l">Account</div><div class="v" style="font-size:13px">' +
              TF.esc(s.calendarSync.account) + '</div></div>' +
            '<div class="stat-tile"><div class="l">Direction</div><div class="v" style="font-size:15px">' +
              TF.esc(s.calendarSync.direction) + '</div></div>' +
            '<div class="stat-tile"><div class="l">Last synchronised</div><div class="v" style="font-size:15px" id="syncStamp">' +
              TF.esc(s.calendarSync.lastSync) + '</div></div>' +
          '</div>' +
          '<div class="section-title">Synced calendars</div>' +
          '<div class="mini-list">' + s.calendarSync.calendars.map(function (c) {
            return '<div class="mini-row"><span class="k-icon" style="width:28px;height:28px;border-radius:8px">' +
              TF.icon('calendar', 14) + '</span>' +
              '<span style="flex:1"><b>' + TF.esc(c.name) + '</b>' +
              '<div class="tiny muted">' + c.events + ' events mirrored</div></span>' +
              '<span class="badge ' + (c.status === 'Syncing' ? 'badge-active' : 'badge-neutral') + '">' +
              '<i class="bdot"></i>' + c.status + '</span></div>';
          }).join('') + '</div>' +
          '<div class="section-title mt-3">Next events pushed to Google</div>' +
          '<div class="mini-list">' + upcomingEvents() + '</div>' +
        '</div>' +
      '</section>' +

      '<div class="row mb-3 wrap">' + cats.map(function (c) {
        return '<button class="chip ' + (cat === c ? 'on' : '') + '" data-cat="' + TF.esc(c) + '">' +
          (c || 'All') + '</button>';
      }).join('') + '</div>' +

      '<div class="grid grid-3" id="intGrid"></div>';

    renderGrid();

    TF.on(root, 'click', '[data-cat]', function (e, el) {
      cat = el.dataset.cat;
      TF.qsa('[data-cat]', root).forEach(function (b) { b.classList.toggle('on', b.dataset.cat === cat); });
      renderGrid();
    });
    TF.on(root, 'click', '[data-connect]', function (e, el) { connect(el.dataset.connect); });
    TF.on(root, 'click', '[data-manage]', function (e, el) { manage(el.dataset.manage); });
    root.querySelector('#syncNow').addEventListener('click', function (e) {
      var btn = e.currentTarget;
      btn.innerHTML = '<span class="spinner"></span> Syncing…';
      btn.disabled = true;
      setTimeout(function () {
        TF.update(function (st) { st.calendarSync.lastSync = 'just now'; });
        TF.toast('Calendar synced', 'All departures are mirrored to Google Calendar.');
        TF.rerender();
      }, 900);
    });
    root.querySelector('#intBrowse').addEventListener('click', function () {
      TF.toast('Marketplace', 'The full integration marketplace is out of scope for this prototype.', 'info');
    });

    function renderGrid() {
      var list = TF.state().integrations.filter(function (i) { return !cat || i.cat === cat; });
      root.querySelector('#intGrid').innerHTML = list.map(function (i) {
        return '<article class="int-card">' +
          '<div class="row"><span class="int-logo" style="background:' + i.color +
            (i.color === '#ffe01b' ? ';color:#000' : '') + '">' + i.letter + '</span>' +
            '<div style="flex:1"><b>' + TF.esc(i.name) + '</b>' +
            '<div class="tiny muted">' + TF.esc(i.cat) + '</div></div>' +
            TF.badge(i.status) + '</div>' +
          '<p class="small muted" style="flex:1">' + TF.esc(i.desc) + '</p>' +
          '<div class="tiny muted">' + TF.esc(i.meta) + '</div>' +
          (i.status === 'Connected'
            ? '<button class="btn btn-sm btn-block" data-manage="' + i.id + '">Manage</button>'
            : '<button class="btn btn-primary btn-sm btn-block" data-connect="' + i.id + '">Connect</button>') +
          '</article>';
      }).join('');
    }
  };

  function tile(label, value, icon, tone) {
    return '<div class="kpi"><div class="k-top"><span class="k-label">' + label + '</span>' +
      '<span class="k-icon ' + (tone || '') + '">' + TF.icon(icon, 16) + '</span></div>' +
      '<div class="k-value" style="font-size:20px">' + TF.esc(String(value)) + '</div></div>';
  }

  function upcomingEvents() {
    var slots = TF.state().schedule.filter(function (sl) { return sl.date >= TF.today(); })
      .sort(function (a, b) { return a.date === b.date ? (a.start < b.start ? -1 : 1) : (a.date < b.date ? -1 : 1); })
      .slice(0, 5);
    return slots.map(function (sl) {
      var a = TF.sel.activity(sl.activityId);
      return '<div class="mini-row"><span style="font-size:15px">' + a.emoji + '</span>' +
        '<span style="flex:1"><b>' + TF.esc(a.name) + '</b><div class="tiny muted">' +
        TF.fmt.dateShort(sl.date) + ' · ' + TF.fmt.time(sl.start) + ' – ' + TF.fmt.time(sl.end) +
        ' · ' + TF.esc(TF.sel.staffName(sl.guideId)) + '</div></span>' +
        '<span class="badge badge-paid"><i class="bdot"></i>Pushed</span></div>';
    }).join('');
  }

  /* ------------------------------------------------------------ connect */
  function connect(id) {
    var i = TF.state().integrations.filter(function (x) { return x.id === id; })[0];
    var ctx = TF.modal({
      title: 'Connect ' + i.name,
      subtitle: i.desc,
      body:
        '<div class="row mb-3"><span class="int-logo" style="background:' + i.color +
          (i.color === '#ffe01b' ? ';color:#000' : '') + '">' + i.letter + '</span>' +
          '<div><b>' + TF.esc(i.name) + '</b><div class="small muted">' + TF.esc(i.cat) + ' integration</div></div></div>' +
        '<div class="form-grid">' +
          '<div class="field full"><label>API key</label><input class="input" id="icKey" placeholder="sk_live_••••••••••••••••" ' +
            'value="demo_' + id + '_key"></div>' +
          '<div class="field full"><label>Account / merchant ID</label><input class="input" value="harbor-adventures"></div>' +
          '<div class="field full"><label>Sync</label><select class="select">' +
            TF.options(['Activities and availability', 'Availability only', 'Bookings only'], 'Activities and availability') +
          '</select></div>' +
          '<div class="field full"><label class="check"><input type="checkbox" checked> ' +
            'Push availability changes in real time</label></div>' +
        '</div>' +
        '<div class="card mt-3" style="background:var(--warn-50);border-color:var(--warn-100)">' +
          '<div class="card-body tiny" style="color:var(--warn-700)">Demo mode — no credentials are sent anywhere and nothing ' +
          'is stored beyond this browser.</div></div>',
      footer: '<button class="btn" data-close>Cancel</button>' +
        '<button class="btn btn-primary" id="icGo">Connect ' + TF.esc(i.name) + '</button>'
    });

    ctx.el.querySelector('#icGo').addEventListener('click', function (e) {
      var btn = e.currentTarget;
      btn.innerHTML = '<span class="spinner"></span> Connecting…';
      btn.disabled = true;
      setTimeout(function () {
        TF.update(function () {
          i.status = 'Connected';
          i.meta = 'Connected just now · syncing 9 activities';
          TF.log('integration', i.name + ' connected');
        });
        ctx.close();
        TF.toast(i.name + ' connected', 'Your activities and availability are syncing now.');
        TF.rerender();
      }, 1000);
    });
  }

  function manage(id) {
    var i = TF.state().integrations.filter(function (x) { return x.id === id; })[0];
    TF.modal({
      title: 'Manage ' + i.name,
      subtitle: i.meta,
      body:
        '<dl class="dl mb-3">' +
          '<dt>Status</dt><dd>' + TF.badge(i.status) + '</dd>' +
          '<dt>Category</dt><dd>' + TF.esc(i.cat) + '</dd>' +
          '<dt>Account</dt><dd>harbor-adventures</dd>' +
          '<dt>Connected</dt><dd>' + TF.fmt.date(TF.addDays(TF.today(), -63)) + '</dd>' +
        '</dl>' +
        '<div class="section-title">Sync settings</div>' +
        '<label class="check mb-2"><input type="checkbox" checked> Push availability in real time</label>' +
        '<label class="check mb-2"><input type="checkbox" checked> Import bookings automatically</label>' +
        '<label class="check mb-2"><input type="checkbox"> Let this channel override my prices</label>',
      footer: '<button class="btn left btn-danger" id="imDisc">Disconnect</button>' +
        '<button class="btn" data-close>Close</button>' +
        '<button class="btn btn-primary" data-close>Save</button>',
      onMount: function (ctx) {
        ctx.el.querySelector('#imDisc').addEventListener('click', function () {
          ctx.close();
          TF.confirm({
            title: 'Disconnect ' + i.name + '?',
            message: 'Availability stops syncing immediately. Existing bookings from this channel are kept.',
            confirmText: 'Disconnect',
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            TF.update(function () {
              i.status = 'Disconnected';
              i.meta = 'Not connected';
              TF.log('integration', i.name + ' disconnected');
            });
            TF.toast(i.name + ' disconnected', 'Availability is no longer being pushed.');
            TF.rerender();
          });
        });
      }
    });
  }
})(window);
