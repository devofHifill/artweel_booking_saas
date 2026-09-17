/* ==========================================================================
   TourFlow — admin shell
   Sidebar, top bar, hash router, global search. Every module registers itself
   on TF.views and gets handed a container to render into.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;
  TF.views = TF.views || {};

  var NAV = [
    { key: 'dashboard',     label: 'Dashboard',     icon: 'grid' },
    { key: 'bookings',      label: 'Bookings',      icon: 'ticket', count: function () {
        return TF.state().bookings.filter(function (b) { return b.status === 'Pending'; }).length; } },
    { key: 'calendar',      label: 'Calendar',      icon: 'calendar' },
    { key: 'activities',    label: 'Activities',    icon: 'compass' },
    { key: 'customers',     label: 'Customers',     icon: 'users' },
    { key: 'staff',         label: 'Staff & Guides', icon: 'badge' },
    { key: 'payments',      label: 'Payments',      icon: 'card' },
    { key: 'reports',       label: 'Reports',       icon: 'chart' },
    { key: 'manifest',      label: 'Daily Manifest', icon: 'file' },
    { key: 'notifications', label: 'Notifications', icon: 'bell' },
    { key: 'integrations',  label: 'Integrations',  icon: 'plug' },
    { key: 'website',       label: 'Website & Widget', icon: 'globe' },
    { key: 'settings',      label: 'Settings',      icon: 'cog' }
  ];

  var MOBILE_NAV = ['dashboard', 'bookings', 'calendar', 'activities', 'customers'];

  var currentRoute = null;

  /* ---------------------------------------------------------------- shell */
  function renderShell() {
    document.body.innerHTML =
      '<div class="app">' +
        '<aside class="sidebar" id="sidebar">' +
          '<div class="sidebar-head">' +
            '<span class="logo-mark">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M3 17l6-11 5 8 3-4 4 7z"/><circle cx="8" cy="5" r="1.6"/></svg>' +
            '</span>' +
            '<span class="logo-text">TourFlow</span>' +
          '</div>' +
          '<div class="demo-pill"><i class="dot"></i> Demo mode</div>' +
          '<nav class="side-nav" id="sideNav"></nav>' +
          '<div class="side-foot">' +
            '<button class="nav-item" id="helpBtn">' + TF.icon('help') + ' Help &amp; Support</button>' +
            '<div class="side-user" id="sideUser">' +
              '<span class="avatar">AR</span>' +
              '<span class="who"><span class="nm">Alex Rivera</span><span class="rl">Owner · Harbor Adventures</span></span>' +
            '</div>' +
          '</div>' +
        '</aside>' +
        '<div class="scrim" id="scrim"></div>' +
        '<div class="main">' +
          '<header class="topbar">' +
            '<button class="hamburger" id="hamburger" aria-label="Open navigation">' + TF.icon('menu') + '</button>' +
            '<div class="search-wrap">' +
              TF.icon('search') +
              '<input class="search-input" id="globalSearch" placeholder="Search bookings, customers, activities…" autocomplete="off">' +
              '<span class="kbd">/</span>' +
              '<div id="searchResults"></div>' +
            '</div>' +
            '<div class="top-right">' +
              '<span class="top-date">' + TF.fmt.date(TF.today(), true) + '</span>' +
              '<div class="dropdown">' +
                '<button class="icon-btn" id="bellBtn" aria-label="Notifications">' + TF.icon('bell') + '<i class="dot-badge"></i></button>' +
              '</div>' +
              '<button class="icon-btn tip" data-tip="Help" id="helpTop" aria-label="Help">' + TF.icon('help') + '</button>' +
              '<a class="btn btn-sm" href="booking.html" target="_blank" rel="noopener" title="View booking page">' +
                TF.icon('globe') + '<span class="lbl">View Booking Page</span></a>' +
              '<div class="dropdown"><button class="icon-btn" id="profileBtn" aria-label="Account" style="width:auto;padding:0 4px">' +
                '<span class="avatar sm">AR</span></button></div>' +
            '</div>' +
          '</header>' +
          '<main class="view" id="view"></main>' +
        '</div>' +
      '</div>' +
      '<nav class="bottom-nav" id="bottomNav"></nav>';

    renderNav();
    wireShell();
  }

  function renderNav() {
    var s = TF.state();
    TF.qs('#sideNav').innerHTML =
      '<div class="nav-label">Operations</div>' +
      NAV.slice(0, 9).map(navItemHtml).join('') +
      '<div class="nav-label">Growth &amp; setup</div>' +
      NAV.slice(9).map(navItemHtml).join('');

    TF.qs('#bottomNav').innerHTML = MOBILE_NAV.map(function (k) {
      var n = NAV.filter(function (x) { return x.key === k; })[0];
      return '<button data-route="' + n.key + '" class="' + (currentRoute === n.key ? 'on' : '') + '">' +
        TF.icon(n.icon, 20) + n.label.split(' ')[0] + '</button>';
    }).join('');
    void s;
  }

  function navItemHtml(n) {
    var c = n.count ? n.count() : 0;
    return '<button class="nav-item' + (currentRoute === n.key ? ' active' : '') + '" data-route="' + n.key + '">' +
      TF.icon(n.icon) + '<span>' + n.label + '</span>' +
      (c ? '<span class="count">' + c + '</span>' : '') + '</button>';
  }

  function wireShell() {
    document.addEventListener('click', function (e) {
      var r = e.target.closest('[data-route]');
      if (r) {
        e.preventDefault();
        TF.go(r.dataset.route);
        document.body.classList.remove('nav-open');
      }
    });

    TF.qs('#hamburger').addEventListener('click', function () {
      document.body.classList.toggle('nav-open');
    });
    TF.qs('#scrim').addEventListener('click', function () {
      document.body.classList.remove('nav-open');
    });

    TF.qs('#helpBtn').addEventListener('click', helpModal);
    TF.qs('#helpTop').addEventListener('click', helpModal);
    TF.qs('#bellBtn').addEventListener('click', notificationsMenu);
    TF.qs('#profileBtn').addEventListener('click', profileMenu);
    TF.qs('#sideUser').addEventListener('click', profileMenu);

    wireSearch();

    global.addEventListener('hashchange', function () { route(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        TF.qs('#globalSearch').focus();
      }
    });
  }

  /* --------------------------------------------------------------- router */
  TF.go = function (route, params) {
    var hash = '#/' + route + (params ? '?' + new URLSearchParams(params).toString() : '');
    if (global.location.hash === hash) { render(route, params || {}); return; }
    global.location.hash = hash;
  };

  function parseHash() {
    var h = (global.location.hash || '#/dashboard').replace(/^#\/?/, '');
    var qi = h.indexOf('?');
    var route = qi === -1 ? h : h.slice(0, qi);
    var params = {};
    if (qi !== -1) {
      new URLSearchParams(h.slice(qi + 1)).forEach(function (v, k) { params[k] = v; });
    }
    return { route: route || 'dashboard', params: params };
  }

  function route() {
    var r = parseHash();
    render(r.route, r.params);
  }

  function render(name, params) {
    if (!TF.views[name]) name = 'dashboard';
    currentRoute = name;
    renderNav();
    var view = TF.qs('#view');
    view.innerHTML = '';
    view.scrollTop = 0;
    global.scrollTo(0, 0);
    try {
      TF.views[name](view, params || {});
    } catch (err) {
      console.error(err);
      view.innerHTML = '<div class="card"><div class="card-body empty">' +
        '<div class="ei">' + TF.icon('alert', 24) + '</div><h3>Something went wrong rendering this screen</h3>' +
        '<p class="mono small">' + TF.esc(err.message) + '</p></div></div>';
    }
  }

  TF.rerender = function () { route(); };

  /* --------------------------------------------------------------- search */
  function wireSearch() {
    var input = TF.qs('#globalSearch');
    var host = TF.qs('#searchResults');

    function close() { host.innerHTML = ''; }

    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) return close();
      var s = TF.state();

      var bookings = s.bookings.filter(function (b) {
        return b.id.toLowerCase().indexOf(q) !== -1 ||
          TF.sel.customerName(b.customerId).toLowerCase().indexOf(q) !== -1 ||
          TF.sel.activityName(b.activityId).toLowerCase().indexOf(q) !== -1;
      }).slice(0, 5);

      var customers = s.customers.filter(function (c) {
        return c.name.toLowerCase().indexOf(q) !== -1 || c.email.toLowerCase().indexOf(q) !== -1 ||
          (c.phone || '').indexOf(q) !== -1;
      }).slice(0, 4);

      var activities = s.activities.filter(function (a) {
        return a.name.toLowerCase().indexOf(q) !== -1 || a.category.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 4);

      var staff = s.staff.filter(function (m) {
        return m.name.toLowerCase().indexOf(q) !== -1 || m.role.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 3);

      if (!bookings.length && !customers.length && !activities.length && !staff.length) {
        host.innerHTML = '<div class="search-results"><div class="sr-empty">No matches for “' + TF.esc(input.value) + '”</div></div>';
        return;
      }

      var html = '<div class="search-results">';
      if (bookings.length) {
        html += '<div class="sr-group">Bookings</div>' + bookings.map(function (b) {
          return '<div class="sr-item" data-kind="booking" data-id="' + b.id + '">' +
            '<span class="avatar sm gray">' + TF.icon('ticket', 12) + '</span>' +
            '<span><span class="t">' + TF.esc(b.id) + ' · ' + TF.esc(TF.sel.customerName(b.customerId)) + '</span>' +
            '<span class="s">' + TF.esc(TF.sel.activityName(b.activityId)) + ' · ' + TF.fmt.date(b.date) + '</span></span>' +
            '<span style="margin-left:auto">' + TF.badge(b.status) + '</span></div>';
        }).join('');
      }
      if (customers.length) {
        html += '<div class="sr-group">Customers</div>' + customers.map(function (c) {
          return '<div class="sr-item" data-kind="customer" data-id="' + c.id + '">' +
            '<span class="avatar sm">' + TF.fmt.initials(c.name) + '</span>' +
            '<span><span class="t">' + TF.esc(c.name) + '</span><span class="s">' + TF.esc(c.email) + '</span></span></div>';
        }).join('');
      }
      if (activities.length) {
        html += '<div class="sr-group">Activities</div>' + activities.map(function (a) {
          return '<div class="sr-item" data-kind="activity" data-id="' + a.id + '">' +
            '<span style="font-size:17px">' + a.emoji + '</span>' +
            '<span><span class="t">' + TF.esc(a.name) + '</span><span class="s">' + TF.esc(a.category) +
            ' · ' + TF.fmt.money(a.price) + '</span></span></div>';
        }).join('');
      }
      if (staff.length) {
        html += '<div class="sr-group">Staff</div>' + staff.map(function (m) {
          return '<div class="sr-item" data-kind="staff" data-id="' + m.id + '">' +
            '<span class="avatar sm">' + TF.fmt.initials(m.name) + '</span>' +
            '<span><span class="t">' + TF.esc(m.name) + '</span><span class="s">' + TF.esc(m.role) + '</span></span></div>';
        }).join('');
      }
      html += '</div>';
      host.innerHTML = html;
    });

    host.addEventListener('click', function (e) {
      var item = e.target.closest('.sr-item');
      if (!item) return;
      var kind = item.dataset.kind, id = item.dataset.id;
      input.value = '';
      close();
      if (kind === 'booking') { TF.go('bookings'); setTimeout(function () { TF.bookingDrawer(id); }, 60); }
      if (kind === 'customer') { TF.go('customers'); setTimeout(function () { TF.customerDrawer(id); }, 60); }
      if (kind === 'activity') { TF.go('activities'); }
      if (kind === 'staff') { TF.go('staff'); setTimeout(function () { TF.staffDrawer(id); }, 60); }
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.search-wrap')) close();
    });
  }

  /* ------------------------------------------------------------- menus */
  function notificationsMenu() {
    var s = TF.state();
    var feed = s.activityLog.slice(0, 6);
    var today = TF.sel.bookingsOn(TF.today());
    var body =
      '<div class="mini-list">' +
      (feed.length ? feed.map(function (f) {
        return '<div class="mini-row"><span class="avatar sm gray">' + TF.icon('zap', 12) + '</span>' +
          '<span style="flex:1"><b>' + TF.esc(f.text) + '</b><br><span class="tiny muted">' + TF.fmt.relative(f.at) + '</span></span></div>';
      }).join('') : '') +
      '<div class="mini-row"><span class="avatar sm">' + TF.icon('ticket', 12) + '</span>' +
        '<span style="flex:1"><b>' + today.length + ' bookings on today\'s departures</b><br>' +
        '<span class="tiny muted">Daily summary · this morning</span></span></div>' +
      '<div class="mini-row"><span class="avatar sm">' + TF.icon('alert', 12) + '</span>' +
        '<span style="flex:1"><b>' + s.bookings.filter(function (b) { return !b.waiver && b.status === 'Confirmed' && b.date >= TF.today(); }).length +
        ' upcoming guests have not signed a waiver</b><br><span class="tiny muted">Waiver reminder automation · 6 hours ago</span></span></div>' +
      '<div class="mini-row"><span class="avatar sm">' + TF.icon('refresh', 12) + '</span>' +
        '<span style="flex:1"><b>Google Calendar synced</b><br><span class="tiny muted">2 minutes ago · healthy</span></span></div>' +
      '</div>';
    TF.modal({
      title: 'Notifications',
      subtitle: 'Simulated activity feed for this demo',
      size: 'narrow',
      body: body,
      footer: '<button class="btn" data-close>Close</button>' +
        '<button class="btn btn-primary" id="goNtf">Notification settings</button>',
      onMount: function (ctx) {
        ctx.el.querySelector('#goNtf').addEventListener('click', function () {
          ctx.close(); TF.go('notifications');
        });
      }
    });
  }

  function profileMenu() {
    TF.modal({
      title: 'Alex Rivera',
      subtitle: 'Owner · Harbor Adventures',
      size: 'narrow',
      body:
        '<dl class="dl">' +
          '<dt>Email</dt><dd>alex@harboradventures.com</dd>' +
          '<dt>Role</dt><dd>Owner (all permissions)</dd>' +
          '<dt>Plan</dt><dd>Professional · billed monthly</dd>' +
          '<dt>Timezone</dt><dd>' + TF.esc(TF.state().settings.business.timezone) + '</dd>' +
        '</dl>' +
        '<div class="card mt-3" style="background:var(--warn-50);border-color:var(--warn-100)">' +
          '<div class="card-body small" style="color:var(--warn-700)">' +
            '<b>Demo mode.</b> Nothing here reaches a real system — payments, emails and integrations are simulated in the browser. ' +
            'Resetting restores the original demo business.' +
          '</div>' +
        '</div>',
      footer: '<button class="btn btn-danger" id="resetDemo">Reset demo data</button>' +
        '<button class="btn" data-close>Close</button>',
      onMount: function (ctx) {
        ctx.el.querySelector('#resetDemo').addEventListener('click', function () {
          ctx.close();
          TF.confirm({
            title: 'Reset the demo?',
            message: 'Every booking, activity and setting you changed will be thrown away and the original demo business restored.',
            confirmText: 'Reset everything',
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            TF.reset();
            TF.rerender();
            TF.toast('Demo reset', 'Harbor Adventures is back to its original state.');
          });
        });
      }
    });
  }

  function helpModal() {
    TF.modal({
      title: 'Help & Support',
      subtitle: 'What to click in this prototype',
      body:
        '<p class="small muted mb-3">TourFlow is a working front-end prototype. Every screen reads from one shared JavaScript state, ' +
        'so anything you change shows up everywhere else — including the customer booking site.</p>' +
        '<div class="grid grid-2">' +
          helpCard('ticket', 'Take a booking', 'Bookings → Create Manual Booking, or open the customer site and book as a guest.') +
          helpCard('calendar', 'Manage availability', 'Calendar → click a day → Add Time Slot, or block a date entirely.') +
          helpCard('compass', 'Build your catalogue', 'Activities → Create Activity. New activities appear on the booking site immediately.') +
          helpCard('card', 'Money movements', 'Payments → click any transaction to refund it. Booking payment status follows.') +
          helpCard('file', 'Run the day', 'Daily Manifest → pick a departure, print it, or send it to the guide.') +
          helpCard('globe', 'Sell everywhere', 'Website &amp; Widget → theme the embeddable widget and copy its embed code.') +
        '</div>' +
        '<div class="card mt-3"><div class="card-body">' +
          '<div class="section-title">Keyboard</div>' +
          '<div class="row small"><kbd class="kbd" style="position:static;transform:none">/</kbd> focus search &nbsp;·&nbsp; ' +
          '<kbd class="kbd" style="position:static;transform:none">Esc</kbd> close any dialog</div>' +
        '</div></div>',
      footer: '<button class="btn btn-primary" data-close>Got it</button>'
    });
  }
  function helpCard(icon, title, text) {
    return '<div class="card"><div class="card-body">' +
      '<div class="row"><span class="k-icon" style="width:28px;height:28px;border-radius:8px;background:var(--brand-50);color:var(--brand-600);display:grid;place-items:center">' +
      TF.icon(icon, 15) + '</span><b>' + title + '</b></div>' +
      '<p class="small muted mt-1">' + text + '</p></div></div>';
  }

  /* ---------------------------------------------------------------- boot */
  function boot() {
    TF.state();
    renderShell();
    route();
    if (!TF.storageAvailable) {
      TF.toast('Storage unavailable', 'Your browser blocked localStorage, so changes last until you reload.', 'info');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
