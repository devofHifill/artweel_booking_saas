/* ==========================================================================
   TourFlow — Staff & guides
   Cards, profile drawer with the real upcoming schedule, add/edit, and
   activity assignment.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  var ROLES = ['Kayak Guide', 'Boat Captain', 'Tour Guide', 'Dive Instructor', 'Fishing Captain',
    'Sommelier', 'Adventure Guide', 'Experience Host', 'Front Desk', 'Operations Manager'];
  var STATUSES = ['Available', 'On Leave', 'Part-time'];
  var filter = '';

  TF.views.staff = function (root) {
    var s = TF.state();

    root.innerHTML =
      '<div class="page-head">' +
        '<div class="ph-text"><h1>Staff &amp; Guides</h1><p class="lede">Who is qualified for what, and who is free.</p></div>' +
        '<div class="ph-actions">' +
          '<select class="select" id="stFilter" style="height:36px;width:auto"><option value="">All statuses</option>' +
            TF.options(STATUSES, filter) + '</select>' +
          '<button class="btn btn-primary" id="stNew">' + TF.icon('plus') + ' Add Staff</button>' +
        '</div>' +
      '</div>' +

      '<div class="grid grid-4 mb-3">' +
        stat('Team members', s.staff.length, 'users') +
        stat('Available today', s.staff.filter(function (m) { return m.status === 'Available'; }).length, 'checkCircle', 'green') +
        stat('Departures this week', s.schedule.filter(function (sl) {
          return sl.date >= TF.today() && sl.date <= TF.addDays(TF.today(), 7) && sl.guideId;
        }).length, 'calendar', 'violet') +
        stat('Unassigned this week', s.schedule.filter(function (sl) {
          return sl.date >= TF.today() && sl.date <= TF.addDays(TF.today(), 7) && !sl.guideId;
        }).length, 'alert', 'amber') +
      '</div>' +

      '<div class="grid grid-4" id="stGrid"></div>';

    renderCards();

    root.querySelector('#stFilter').addEventListener('change', function (e) { filter = e.target.value; renderCards(); });
    root.querySelector('#stNew').addEventListener('click', function () { TF.staffForm(null); });
    TF.on(root, 'click', '[data-staff]', function (e, el) {
      if (e.target.closest('.act-btn')) return;
      TF.staffDrawer(el.dataset.staff);
    });
    TF.on(root, 'click', '[data-edit]', function (e, el) { e.stopPropagation(); TF.staffForm(el.dataset.edit); });
    TF.on(root, 'click', '[data-sched]', function (e, el) { e.stopPropagation(); TF.staffSchedule(el.dataset.sched); });

    function renderCards() {
      var list = s.staff.filter(function (m) { return !filter || m.status === filter; });
      var host = root.querySelector('#stGrid');
      if (!list.length) {
        host.innerHTML = '<div class="span-2">' + TF.emptyState('badge', 'Nobody matches', 'Try a different status filter.') + '</div>';
        return;
      }
      host.innerHTML = list.map(function (m) {
        var st = TF.sel.staffStats(m.id);
        return '<article class="staff-card" data-staff="' + m.id + '">' +
          '<div class="row" style="align-items:flex-start">' +
            '<span class="avatar lg">' + TF.fmt.initials(m.name) + '</span>' +
            '<div style="flex:1;min-width:0"><b style="font-size:15px">' + TF.esc(m.name) + '</b>' +
            '<div class="small muted">' + TF.esc(m.role) + '</div>' +
            '<div class="mt-1">' + TF.badge(m.status) + '</div></div>' +
          '</div>' +
          '<div class="grid grid-2 mt-3" style="gap:8px">' +
            '<div class="stat-tile"><div class="l">Upcoming</div><div class="v">' + st.upcoming + '</div></div>' +
            '<div class="stat-tile"><div class="l">Rating</div><div class="v">' + m.rating + '</div></div>' +
          '</div>' +
          '<div class="tiny muted mt-2">' + m.activities.map(function (a) {
            return TF.esc(TF.sel.activityName(a));
          }).join(' · ') + '</div>' +
          '<div class="row-between mt-2" style="padding-top:10px;border-top:1px solid var(--border)">' +
            '<span class="tiny muted">' + TF.fmt.num(m.completed) + ' tours run</span>' +
            '<span class="act-btns">' +
              '<button class="act-btn tip" data-tip="Schedule" data-sched="' + m.id + '">' + TF.icon('calendar', 14) + '</button>' +
              '<button class="act-btn tip" data-tip="Edit" data-edit="' + m.id + '">' + TF.icon('edit', 14) + '</button>' +
            '</span>' +
          '</div></article>';
      }).join('');
    }
  };

  function stat(label, value, icon, tone) {
    return '<div class="kpi"><div class="k-top"><span class="k-label">' + label + '</span>' +
      '<span class="k-icon ' + (tone || '') + '">' + TF.icon(icon, 16) + '</span></div>' +
      '<div class="k-value">' + value + '</div></div>';
  }

  /* --------------------------------------------------------- profile */
  TF.staffDrawer = function (id) {
    var m = TF.sel.staff(id);
    if (!m) return;
    var st = TF.sel.staffStats(id);
    var slots = TF.state().schedule.filter(function (sl) { return sl.guideId === id && sl.date >= TF.today(); })
      .sort(function (a, b) { return a.date === b.date ? (a.start < b.start ? -1 : 1) : (a.date < b.date ? -1 : 1); })
      .slice(0, 8);

    var ctx = TF.drawer({
      eyebrow: m.role,
      title: m.name,
      subtitle: m.email + ' · ' + m.phone,
      body:
        '<div class="row mb-3">' + TF.badge(m.status) +
          '<span class="badge badge-neutral">Since ' + TF.fmt.date(m.since) + '</span></div>' +
        '<div class="grid grid-3 mb-3">' +
          '<div class="stat-tile"><div class="l">Upcoming tours</div><div class="v">' + st.upcoming + '</div></div>' +
          '<div class="stat-tile"><div class="l">Guests handled</div><div class="v">' + TF.fmt.num(st.guests) + '</div></div>' +
          '<div class="stat-tile"><div class="l">Revenue generated</div><div class="v">' + TF.fmt.money(st.revenue) + '</div></div>' +
        '</div>' +
        '<div class="section-title">Performance</div>' +
        '<div class="card mb-3"><div class="card-body">' +
          '<div class="row-between small"><span>Guest rating</span><b>' + m.rating + ' / 5.0</b></div>' +
          '<div class="progress green mt-1"><i style="width:' + (m.rating / 5 * 100) + '%"></i></div>' +
          '<div class="row-between small mt-3"><span>Tours completed</span><b>' + TF.fmt.num(m.completed) + '</b></div>' +
          '<div class="row-between small mt-2"><span>Working days</span><b>' +
            m.days.map(function (d) { return TF.DAYS_S[d]; }).join(', ') + '</b></div>' +
          '<div class="row-between small mt-2"><span>Working hours</span><b>' + TF.esc(m.hours) + '</b></div>' +
        '</div></div>' +
        '<div class="section-title">Qualified for</div>' +
        '<div class="chip-group mb-3">' + m.activities.map(function (a) {
          var act = TF.sel.activity(a);
          return '<span class="chip on">' + (act ? act.emoji + ' ' + TF.esc(act.name) : a) + '</span>';
        }).join('') + '</div>' +
        '<div class="section-title">Upcoming schedule</div>' +
        (slots.length ? '<div class="mini-list">' + slots.map(function (sl) {
          var a = TF.sel.activity(sl.activityId);
          return '<div class="mini-row" style="cursor:pointer" data-slot="' + sl.id + '">' +
            '<span style="font-size:16px">' + a.emoji + '</span>' +
            '<span style="flex:1"><b>' + TF.fmt.dateShort(sl.date) + ' · ' + TF.fmt.time(sl.start) + '</b>' +
            '<div class="tiny muted">' + TF.esc(a.name) + '</div></span>' +
            '<span class="small">' + TF.sel.booked(sl.id) + '/' + sl.capacity + '</span></div>';
        }).join('') + '</div>' : '<p class="small muted">Nothing assigned yet.</p>'),
      footer:
        '<button class="btn btn-primary btn-sm" id="sfEdit">' + TF.icon('edit') + ' Edit</button>' +
        '<button class="btn btn-sm" id="sfAssign">' + TF.icon('compass') + ' Assign activities</button>' +
        '<button class="btn btn-sm" id="sfSched">' + TF.icon('calendar') + ' View schedule</button>' +
        '<button class="btn btn-sm" id="sfToggle">' + TF.icon(m.status === 'On Leave' ? 'check' : 'lock') + ' ' +
          (m.status === 'On Leave' ? 'Mark available' : 'Set on leave') + '</button>'
    });

    TF.on(ctx.el, 'click', '[data-slot]', function (e, el) { ctx.close(); TF.slotDrawer(el.dataset.slot); });
    ctx.el.querySelector('#sfEdit').addEventListener('click', function () { ctx.close(); TF.staffForm(id); });
    ctx.el.querySelector('#sfAssign').addEventListener('click', function () { ctx.close(); assignActivities(id); });
    ctx.el.querySelector('#sfSched').addEventListener('click', function () { ctx.close(); TF.staffSchedule(id); });
    ctx.el.querySelector('#sfToggle').addEventListener('click', function () {
      TF.update(function () { m.status = m.status === 'On Leave' ? 'Available' : 'On Leave'; });
      ctx.close();
      TF.toast('Staff updated', m.name + ' is now ' + m.status.toLowerCase() + '.');
      TF.rerender();
    });
  };

  /* -------------------------------------------------------- schedule */
  TF.staffSchedule = function (id) {
    var m = TF.sel.staff(id);
    var slots = TF.state().schedule.filter(function (sl) { return sl.guideId === id && sl.date >= TF.today(); })
      .sort(function (a, b) { return a.date === b.date ? (a.start < b.start ? -1 : 1) : (a.date < b.date ? -1 : 1); });

    var byDate = {};
    slots.forEach(function (sl) { (byDate[sl.date] = byDate[sl.date] || []).push(sl); });

    TF.modal({
      title: m.name + '’s schedule',
      subtitle: slots.length + ' upcoming departures',
      body: slots.length ? Object.keys(byDate).map(function (d) {
        return '<div class="section-title mt-3">' + TF.fmt.date(d, true) + '</div>' +
          '<div class="mini-list">' + byDate[d].map(function (sl) {
            var a = TF.sel.activity(sl.activityId);
            return '<div class="mini-row"><span style="font-size:16px">' + a.emoji + '</span>' +
              '<span style="flex:1"><b>' + TF.fmt.time(sl.start) + ' – ' + TF.fmt.time(sl.end) + '</b>' +
              '<div class="tiny muted">' + TF.esc(a.name) + ' · ' + TF.esc(a.meetingPoint) + '</div></span>' +
              '<span class="small">' + TF.sel.booked(sl.id) + '/' + sl.capacity + '</span></div>';
          }).join('') + '</div>';
      }).join('') : '<p class="small muted">Nothing scheduled.</p>',
      footer: '<button class="btn" data-close>Close</button>' +
        '<button class="btn btn-primary" id="ssSend">' + TF.icon('send') + ' Send to ' + TF.esc(m.name.split(' ')[0]) + '</button>',
      onMount: function (ctx) {
        ctx.el.querySelector('#ssSend').addEventListener('click', function () {
          TF.toast('Schedule sent', 'Simulated email to ' + m.email + '.', 'info');
          ctx.close();
        });
      }
    });
  };

  function assignActivities(id) {
    var m = TF.sel.staff(id);
    var picked = m.activities.slice();
    var ctx = TF.modal({
      title: 'Assign activities',
      subtitle: m.name + ' can be scheduled on whatever is selected here',
      body: '<div class="chip-group" id="aaList">' + TF.state().activities.map(function (a) {
        return '<button type="button" class="chip ' + (picked.indexOf(a.id) !== -1 ? 'on' : '') + '" data-a="' + a.id + '">' +
          a.emoji + ' ' + TF.esc(a.name) + '</button>';
      }).join('') + '</div>',
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="aaSave">Save</button>'
    });
    TF.on(ctx.el, 'click', '[data-a]', function (e, b) {
      var a = b.dataset.a;
      var i = picked.indexOf(a);
      if (i === -1) picked.push(a); else picked.splice(i, 1);
      b.classList.toggle('on');
    });
    ctx.el.querySelector('#aaSave').addEventListener('click', function () {
      TF.update(function () { m.activities = picked; });
      ctx.close();
      TF.toast('Assignments saved', m.name + ' can now run ' + picked.length + ' activities.');
      TF.rerender();
    });
  }

  /* ------------------------------------------------------ create/edit */
  TF.staffForm = function (id) {
    var m = id ? TF.sel.staff(id) : null;
    var days = m ? m.days.slice() : [1, 2, 3, 4, 5];
    var picked = m ? m.activities.slice() : [];

    var ctx = TF.modal({
      title: m ? 'Edit ' + m.name : 'Add staff member',
      body: '<form id="stForm" class="form-grid">' +
        '<div class="field"><label>Full name</label><input class="input" name="name" value="' +
          (m ? TF.esc(m.name) : '') + '"></div>' +
        '<div class="field"><label>Role</label><select class="select" name="role">' +
          TF.options(ROLES, m ? m.role : 'Tour Guide') + '</select></div>' +
        '<div class="field"><label>Email</label><input class="input" type="email" name="email" value="' +
          (m ? TF.esc(m.email) : '') + '"></div>' +
        '<div class="field"><label>Phone</label><input class="input" name="phone" value="' +
          (m ? TF.esc(m.phone) : '') + '"></div>' +
        '<div class="field"><label>Status</label><select class="select" name="status">' +
          TF.options(STATUSES, m ? m.status : 'Available') + '</select></div>' +
        '<div class="field"><label>Working hours</label><input class="input" name="hours" value="' +
          (m ? TF.esc(m.hours) : '09:00 – 17:00') + '"></div>' +
        '<div class="field full"><label>Working days</label><div class="chip-group" id="stDays">' +
          TF.DAYS_S.map(function (d, i) {
            return '<button type="button" class="chip ' + (days.indexOf(i) !== -1 ? 'on' : '') + '" data-day="' + i + '">' + d + '</button>';
          }).join('') + '</div></div>' +
        '<div class="field full"><label>Activities they can run</label><div class="chip-group" id="stActs">' +
          TF.state().activities.map(function (a) {
            return '<button type="button" class="chip ' + (picked.indexOf(a.id) !== -1 ? 'on' : '') + '" data-a="' + a.id + '">' +
              a.emoji + ' ' + TF.esc(a.name) + '</button>';
          }).join('') + '</div></div>' +
        '</form>',
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="stSave">Save staff member</button>'
    });

    TF.on(ctx.el, 'click', '[data-day]', function (e, b) {
      var d = +b.dataset.day, i = days.indexOf(d);
      if (i === -1) days.push(d); else days.splice(i, 1);
      b.classList.toggle('on');
    });
    TF.on(ctx.el, 'click', '[data-a]', function (e, b) {
      var a = b.dataset.a, i = picked.indexOf(a);
      if (i === -1) picked.push(a); else picked.splice(i, 1);
      b.classList.toggle('on');
    });

    ctx.el.querySelector('#stSave').addEventListener('click', function () {
      if (!TF.requireFields(ctx.el, ['name', 'email'])) return;
      var d = TF.formData(ctx.el.querySelector('#stForm'));
      if (m) {
        TF.update(function () {
          m.name = d.name; m.role = d.role; m.email = d.email; m.phone = d.phone;
          m.status = d.status; m.hours = d.hours; m.days = days.slice().sort(); m.activities = picked;
        });
        TF.toast('Staff updated', m.name + ' has been saved.');
      } else {
        TF.update(function (s) {
          s.staff.push({
            id: 'stf-' + (s.staff.length + 1) + '-' + Date.now().toString(36),
            name: d.name, role: d.role, email: d.email, phone: d.phone,
            status: d.status, activities: picked, days: days.slice().sort(), hours: d.hours,
            completed: 0, rating: 0, since: TF.today()
          });
          TF.log('staff', d.name + ' joined the team');
        });
        TF.toast('Staff member added', d.name + ' can now be assigned to departures.');
      }
      ctx.close();
      TF.rerender();
    });
  };
})(window);
