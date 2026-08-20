/* ==========================================================================
   TourFlow — shared runtime
   State store, selectors, formatting, icons and UI primitives (toast, modal,
   drawer, confirm). Loaded by BOTH the admin app and the customer booking
   site, which is what keeps the two sides of the demo in sync.
   ========================================================================== */
(function (global) {
  'use strict';

  var TF = global.TF = global.TF || {};
  // Screen modules register themselves here as they load; app.js (which does
  // the routing) is the LAST script on the page, so the registry has to exist
  // before it rather than being created by it.
  TF.views = TF.views || {};
  var KEY = 'tourflow.demo.v5';

  /* ======================================================================
     Storage — falls back to memory so the demo still works when a browser
     blocks localStorage (file:// in some browsers, private mode in others).
     ====================================================================== */
  var memoryStore = {};
  var storageOK = (function () {
    try {
      var k = '__tf_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  var raw = {
    get: function (k) { return storageOK ? localStorage.getItem(k) : (memoryStore[k] || null); },
    set: function (k, v) { if (storageOK) { try { localStorage.setItem(k, v); } catch (e) { memoryStore[k] = v; } } else { memoryStore[k] = v; } },
    del: function (k) { if (storageOK) { try { localStorage.removeItem(k); } catch (e) {} } delete memoryStore[k]; }
  };
  TF.storageAvailable = storageOK;

  /* ======================================================================
     State
     ====================================================================== */
  var state = null;
  var listeners = [];

  function load() {
    var stored = raw.get(KEY);
    if (stored) {
      try {
        var parsed = JSON.parse(stored);
        // A saved demo from a previous day would show an empty "today", so the
        // seed is regenerated whenever the day rolls over.
        if (parsed && parsed.version === global.TFData.version && parsed.generatedFor === global.TFData.today) {
          return parsed;
        }
      } catch (e) { /* corrupt payload — fall through to a fresh seed */ }
    }
    var fresh = global.TFData.seed();
    raw.set(KEY, JSON.stringify(fresh));
    return fresh;
  }

  TF.state = function () {
    if (!state) state = load();
    return state;
  };
  TF.save = function () {
    slotIndex = null;
    raw.set(KEY, JSON.stringify(state));
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
  };

  /**
   * Seats-per-departure index.
   *
   * Capacity is always DERIVED from the bookings rather than stored on the
   * slot, which is what keeps the operator screens and the customer site from
   * ever disagreeing. Deriving it naively meant re-scanning every booking once
   * per calendar cell, so the month view is indexed instead. Thrown away on
   * every save, which is the only way state changes.
   */
  var slotIndex = null;
  function index() {
    if (slotIndex) return slotIndex;
    slotIndex = {};
    TF.state().bookings.forEach(function (b) {
      if (b.status === 'Cancelled' || !b.slotId) return;
      var e = slotIndex[b.slotId] || (slotIndex[b.slotId] = { seats: 0, list: [] });
      e.seats += b.guests;
      e.list.push(b);
    });
    return slotIndex;
  }
  TF.onChange = function (fn) { listeners.push(fn); };
  TF.reset = function () {
    slotIndex = null;
    raw.del(KEY);
    state = load();
    listeners.forEach(function (fn) { try { fn(state); } catch (e) {} });
  };

  /** Mutate + persist + notify in one call. */
  TF.update = function (fn) {
    fn(TF.state());
    TF.save();
  };

  TF.log = function (type, text) {
    var s = TF.state();
    s.activityLog.unshift({ type: type, text: text, at: new Date().toISOString() });
    if (s.activityLog.length > 60) s.activityLog.length = 60;
  };

  // Another tab (the booking site opened alongside the admin) changed things.
  global.addEventListener('storage', function (e) {
    if (e.key !== KEY || !e.newValue) return;
    try {
      state = JSON.parse(e.newValue);
      slotIndex = null;
      listeners.forEach(function (fn) { try { fn(state); } catch (err) {} });
    } catch (err) {}
  });

  /* ======================================================================
     Formatting
     ====================================================================== */
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MONTHS_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var DAYS_S = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  TF.MONTHS = MONTHS; TF.MONTHS_S = MONTHS_S; TF.DAYS = DAYS; TF.DAYS_S = DAYS_S;

  TF.fmt = {
    money: function (n, opts) {
      var neg = n < 0;
      var v = Math.abs(Math.round((n || 0) * 100) / 100);
      var s = v.toLocaleString('en-US', {
        minimumFractionDigits: (opts && opts.cents) ? 2 : 0,
        maximumFractionDigits: (opts && opts.cents) ? 2 : 0
      });
      return (neg ? '-$' : '$') + s;
    },
    num: function (n) { return (n || 0).toLocaleString('en-US'); },
    pct: function (n) { return Math.round(n || 0) + '%'; },
    /** 'YYYY-MM-DD' -> 'Aug 20, 2026' */
    date: function (key, long) {
      if (!key) return '—';
      var p = key.split('-');
      var d = new Date(+p[0], +p[1] - 1, +p[2]);
      return long
        ? DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear()
        : MONTHS_S[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    },
    dateShort: function (key) {
      if (!key) return '—';
      var p = key.split('-');
      return MONTHS_S[+p[1] - 1] + ' ' + (+p[2]);
    },
    /** '14:30' -> '2:30 PM' */
    time: function (t) {
      if (!t) return '—';
      var p = t.split(':'), h = +p[0], m = p[1];
      var mer = h >= 12 ? 'PM' : 'AM';
      var hh = h % 12; if (hh === 0) hh = 12;
      return hh + ':' + m + ' ' + mer;
    },
    duration: function (min) {
      var h = Math.floor(min / 60), m = min % 60;
      if (h && m) return h + 'h ' + m + 'm';
      if (h) return h + (h === 1 ? ' hour' : ' hours');
      return m + ' min';
    },
    relative: function (iso) {
      var diff = (Date.now() - new Date(iso).getTime()) / 1000;
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return Math.floor(diff / 86400) + 'd ago';
    },
    initials: function (name) {
      return (name || '?').split(' ').filter(Boolean).slice(0, 2)
        .map(function (p) { return p[0]; }).join('').toUpperCase();
    }
  };

  TF.today = function () { return global.TFData.today; };
  TF.ymd = function (d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  TF.parseYmd = function (key) {
    var p = key.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  };
  TF.addDays = function (key, n) {
    var d = TF.parseYmd(key);
    d.setDate(d.getDate() + n);
    return TF.ymd(d);
  };
  TF.dayOffset = function (key) {
    return Math.round((TF.parseYmd(key) - TF.parseYmd(TF.today())) / 86400000);
  };

  TF.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* ======================================================================
     Selectors — every screen reads through these, so the numbers can never
     disagree between the dashboard, the calendar and the booking site.
     ====================================================================== */
  var S = TF.sel = {
    activity: function (id) { return TF.state().activities.filter(function (a) { return a.id === id; })[0] || null; },
    activityName: function (id) { var a = S.activity(id); return a ? a.name : 'Unknown activity'; },
    customer: function (id) { return TF.state().customers.filter(function (c) { return c.id === id; })[0] || null; },
    customerName: function (id) { var c = S.customer(id); return c ? c.name : 'Unknown guest'; },
    staff: function (id) { return TF.state().staff.filter(function (s) { return s.id === id; })[0] || null; },
    staffName: function (id) { var s = S.staff(id); return s ? s.name : 'Unassigned'; },
    slot: function (id) { return TF.state().schedule.filter(function (s) { return s.id === id; })[0] || null; },
    booking: function (id) { return TF.state().bookings.filter(function (b) { return b.id === id; })[0] || null; },

    /** Bookings that still hold a seat. Cancelled and no-shows release theirs. */
    liveBookings: function () {
      return TF.state().bookings.filter(function (b) { return b.status !== 'Cancelled'; });
    },
    bookingsForSlot: function (slotId) {
      var e = index()[slotId];
      return e ? e.list : [];
    },
    /** Seats taken on a slot — always derived, never stored. */
    booked: function (slotId) {
      var e = index()[slotId];
      return e ? e.seats : 0;
    },
    seatsLeft: function (slot) {
      return Math.max(0, slot.capacity - S.booked(slot.id));
    },
    slotsOn: function (dateKey) {
      return TF.state().schedule
        .filter(function (s) { return s.date === dateKey && s.status !== 'Cancelled'; })
        .sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    },
    bookingsOn: function (dateKey) {
      return TF.state().bookings.filter(function (b) { return b.date === dateKey; });
    },
    isBlocked: function (dateKey) {
      return TF.state().blocked.filter(function (b) { return b.date === dateKey; })[0] || null;
    },
    revenueOn: function (dateKey) {
      return S.bookingsOn(dateKey)
        .filter(function (b) { return b.status !== 'Cancelled'; })
        .reduce(function (n, b) { return n + b.amount; }, 0);
    },
    customerStats: function (customerId) {
      var bs = TF.state().bookings.filter(function (b) { return b.customerId === customerId; });
      var live = bs.filter(function (b) { return b.status !== 'Cancelled'; });
      var spent = live.reduce(function (n, b) { return n + b.paid; }, 0);
      var last = bs.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
      return {
        bookings: bs.length,
        live: live.length,
        spent: spent,
        upcoming: live.filter(function (b) { return b.date >= TF.today(); }).length,
        last: last ? last.date : null
      };
    },
    staffStats: function (staffId) {
      var bs = TF.state().bookings.filter(function (b) { return b.guideId === staffId && b.status !== 'Cancelled'; });
      var slots = TF.state().schedule.filter(function (s) { return s.guideId === staffId; });
      return {
        upcoming: slots.filter(function (s) { return s.date >= TF.today(); }).length,
        guests: bs.reduce(function (n, b) { return n + b.guests; }, 0),
        revenue: bs.reduce(function (n, b) { return n + b.amount; }, 0),
        bookings: bs.length
      };
    },
    activityStats: function (activityId) {
      var bs = TF.state().bookings.filter(function (b) { return b.activityId === activityId && b.status !== 'Cancelled'; });
      var slots = TF.state().schedule.filter(function (s) { return s.activityId === activityId; });
      var cap = slots.reduce(function (n, s) { return n + s.capacity; }, 0);
      var seats = bs.reduce(function (n, b) { return n + b.guests; }, 0);
      return {
        bookings: bs.length,
        guests: seats,
        revenue: bs.reduce(function (n, b) { return n + b.amount; }, 0),
        occupancy: cap ? Math.round((seats / cap) * 100) : 0,
        slots: slots.length
      };
    },
    nextBookingId: function () {
      var s = TF.state();
      s.counters.booking += 1;
      return 'TF-' + s.counters.booking;
    },
    nextTxId: function () {
      var s = TF.state();
      s.counters.tx += 1;
      return 'TXN-' + s.counters.tx;
    },
    nextSlotId: function () {
      var s = TF.state();
      s.counters.slot += 1;
      return 'slt-' + s.counters.slot;
    }
  };

  /* ======================================================================
     Core mutations — shared by the admin and the customer booking flow so a
     booking made on either side behaves identically.
     ====================================================================== */
  TF.actions = {
    createBooking: function (input) {
      var s = TF.state();
      var act = S.activity(input.activityId);
      var slot = S.slot(input.slotId);
      var id = S.nextBookingId();
      var adults = input.adults || 0, children = input.children || 0;
      var unit = slot ? slot.price : act.price;
      var amount = input.amount != null ? input.amount : (adults * unit + children * act.childPrice);
      var paid = input.paid != null ? input.paid : (input.paymentStatus === 'Paid' ? amount
        : input.paymentStatus === 'Partially Paid' ? Math.round(amount * (s.settings.payments.depositPercent / 100)) : 0);

      var booking = {
        id: id,
        customerId: input.customerId,
        activityId: input.activityId,
        slotId: input.slotId,
        date: slot ? slot.date : input.date,
        time: slot ? slot.start : input.time,
        adults: adults,
        children: children,
        guests: adults + children,
        amount: amount,
        paid: paid,
        paymentStatus: input.paymentStatus || 'Pending',
        paymentMethod: input.paymentMethod || 'Credit Card',
        status: input.status || (s.settings.booking.autoConfirm ? 'Confirmed' : 'Pending'),
        guideId: input.guideId || (slot ? slot.guideId : null),
        source: input.source || 'Admin',
        waiver: !!input.waiver,
        notes: input.notes || '',
        createdAt: TF.today()
      };
      s.bookings.unshift(booking);

      if (paid > 0) {
        s.payments.unshift({
          id: S.nextTxId(),
          bookingId: id,
          customerId: booking.customerId,
          amount: paid,
          method: booking.paymentMethod,
          type: paid < amount ? 'Deposit' : 'Full Payment',
          date: TF.today(),
          status: 'Succeeded'
        });
      }
      TF.log('booking', 'Booking ' + id + ' created for ' + S.customerName(booking.customerId));
      TF.save();
      return booking;
    },

    cancelBooking: function (id, refund) {
      var s = TF.state();
      var b = S.booking(id);
      if (!b) return null;
      b.status = 'Cancelled';
      if (refund && b.paid > 0) {
        s.payments.unshift({
          id: S.nextTxId(), bookingId: id, customerId: b.customerId,
          amount: -b.paid, method: b.paymentMethod, type: 'Refund',
          date: TF.today(), status: 'Refunded'
        });
        b.paymentStatus = 'Refunded';
        b.paid = 0;
      }
      TF.log('cancel', 'Booking ' + id + ' cancelled' + (refund ? ' and refunded' : ''));
      TF.save();
      return b;
    },

    setBookingStatus: function (id, status) {
      var b = S.booking(id);
      if (!b) return null;
      b.status = status;
      TF.log('booking', 'Booking ' + id + ' marked ' + status);
      TF.save();
      return b;
    },

    takePayment: function (bookingId, amount, method, type) {
      var s = TF.state();
      var b = S.booking(bookingId);
      if (!b) return null;
      s.payments.unshift({
        id: S.nextTxId(), bookingId: bookingId, customerId: b.customerId,
        amount: amount, method: method || 'Credit Card', type: type || 'Full Payment',
        date: TF.today(), status: 'Succeeded'
      });
      b.paid += amount;
      b.paymentStatus = b.paid >= b.amount ? 'Paid' : (b.paid > 0 ? 'Partially Paid' : 'Pending');
      TF.log('payment', TF.fmt.money(amount) + ' collected on ' + bookingId);
      TF.save();
      return b;
    },

    refund: function (bookingId, amount, reason) {
      var s = TF.state();
      var b = S.booking(bookingId);
      if (!b) return null;
      s.payments.unshift({
        id: S.nextTxId(), bookingId: bookingId, customerId: b.customerId,
        amount: -Math.abs(amount), method: b.paymentMethod, type: 'Refund',
        date: TF.today(), status: 'Refunded', reason: reason || ''
      });
      b.paid = Math.max(0, b.paid - Math.abs(amount));
      b.paymentStatus = b.paid <= 0 ? 'Refunded' : 'Partially Paid';
      TF.log('payment', TF.fmt.money(amount) + ' refunded on ' + bookingId);
      TF.save();
      return b;
    },

    findOrCreateCustomer: function (info) {
      var s = TF.state();
      var email = (info.email || '').trim().toLowerCase();
      var existing = s.customers.filter(function (c) { return c.email.toLowerCase() === email; })[0];
      if (existing) {
        if (info.phone && !existing.phone) existing.phone = info.phone;
        return existing;
      }
      var c = {
        id: 'cus-' + (s.customers.length + 1) + '-' + Date.now().toString(36),
        name: info.name, email: info.email, phone: info.phone || '',
        country: info.country || 'United States', status: 'Active',
        notes: info.notes || '', createdAt: TF.today()
      };
      s.customers.push(c);
      TF.log('customer', c.name + ' added to customers');
      return c;
    }
  };

  /* ======================================================================
     Icons — a small inline set. No icon font, no external request.
     ====================================================================== */
  var ICONS = {
    grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
    ticket: '<path d="M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 1 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z"/><path d="M13 5v3M13 11v2M13 16v3"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    badge: '<path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.4 7.2 16.9l.9-5.4L4.2 7.7l5.4-.8z"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    plug: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    edit: '<path d="M11 4H4v16h16v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    printer: '<path d="M6 9V2h12v7"/><rect x="2" y="9" width="20" height="8" rx="2"/><path d="M6 14h12v8H6z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 6 10-6"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    pin: '<path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    dollar: '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    trendUp: '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
    trendDown: '<path d="M23 18l-9.5-9.5-5 5L1 6"/><path d="M17 18h6v-6"/>',
    chevL: '<path d="M15 18l-6-6 6-6"/>',
    chevR: '<path d="M9 18l6-6-6-6"/>',
    chevD: '<path d="M6 9l6 6 6-6"/>',
    arrowR: '<path d="M5 12h14M13 5l7 7-7 7"/>',
    arrowL: '<path d="M19 12H5M11 19l-7-7 7-7"/>',
    more: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
    refresh: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M20.5 9a9 9 0 0 0-15-3.4L1 10M23 14l-4.5 4.4A9 9 0 0 1 3.5 15"/>',
    star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',
    layers: '<path d="M12 2L2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    anchor: '<circle cx="12" cy="5" r="3"/><path d="M12 22V8M5 12H2a10 10 0 0 0 20 0h-3"/>'
  };
  TF.icon = function (name, size) {
    var p = ICONS[name] || ICONS.info;
    var s = size || 18;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  };

  /* ======================================================================
     Badges
     ====================================================================== */
  var BADGE_CLASS = {
    'Confirmed': 'badge-confirmed', 'Pending': 'badge-pending', 'Completed': 'badge-completed',
    'Cancelled': 'badge-cancelled', 'No Show': 'badge-noshow',
    'Paid': 'badge-paid', 'Partially Paid': 'badge-partial', 'Refunded': 'badge-refunded',
    'Active': 'badge-active', 'Draft': 'badge-draft', 'Available': 'badge-active',
    'On Leave': 'badge-pending', 'Part-time': 'badge-brand', 'Connected': 'badge-active',
    'Disconnected': 'badge-neutral', 'Paused': 'badge-pending', 'VIP': 'badge-partial',
    'Blocked': 'badge-cancelled', 'Suspended': 'badge-cancelled', 'Succeeded': 'badge-paid',
    'Open': 'badge-active', 'Published': 'badge-active', 'Healthy': 'badge-active'
  };
  TF.badge = function (text, extraClass) {
    var cls = BADGE_CLASS[text] || 'badge-neutral';
    return '<span class="badge ' + cls + ' ' + (extraClass || '') + '"><i class="bdot"></i>' + TF.esc(text) + '</span>';
  };

  /* ======================================================================
     Toasts
     ====================================================================== */
  function toastHost() {
    var h = document.querySelector('.toast-host');
    if (!h) {
      h = document.createElement('div');
      h.className = 'toast-host';
      document.body.appendChild(h);
    }
    return h;
  }
  TF.toast = function (title, message, kind) {
    var k = kind || 'ok';
    var icon = k === 'err' ? 'alert' : k === 'info' ? 'info' : 'checkCircle';
    var el = document.createElement('div');
    el.className = 'toast ' + k;
    el.innerHTML = '<span class="ti">' + TF.icon(icon, 17) + '</span><div class="tx"><b>' +
      TF.esc(title) + '</b>' + (message ? '<span>' + TF.esc(message) + '</span>' : '') + '</div>';
    toastHost().appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 200);
    }, 3600);
  };

  /* ======================================================================
     Modal / drawer / confirm
     ====================================================================== */
  function mountOverlay(cls, inner, opts) {
    var wrap = document.createElement('div');
    wrap.className = cls;
    wrap.innerHTML = inner;
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';

    function close() {
      wrap.remove();
      if (!document.querySelector('.overlay, .drawer-overlay')) document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      if (opts && opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    wrap.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', close);
    });
    return { el: wrap, close: close };
  }

  /**
   * opts: { title, subtitle, body, footer, size, onMount(ctx) }
   */
  TF.modal = function (opts) {
    var html =
      '<div class="modal ' + (opts.size || '') + '" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' +
          '<div><h2>' + TF.esc(opts.title) + '</h2>' +
          (opts.subtitle ? '<div class="sub">' + TF.esc(opts.subtitle) + '</div>' : '') + '</div>' +
          '<button class="icon-btn x" data-close aria-label="Close">' + TF.icon('x') + '</button>' +
        '</div>' +
        '<div class="modal-body">' + (opts.body || '') + '</div>' +
        (opts.footer === null ? '' : '<div class="modal-foot">' + (opts.footer ||
          '<button class="btn" data-close>Close</button>') + '</div>') +
      '</div>';
    var ctx = mountOverlay('overlay', html, opts);
    ctx.body = ctx.el.querySelector('.modal-body');
    ctx.foot = ctx.el.querySelector('.modal-foot');
    if (opts.onMount) opts.onMount(ctx);
    var first = ctx.el.querySelector('input, select, textarea');
    if (first && !('ontouchstart' in window)) setTimeout(function () { first.focus(); }, 40);
    return ctx;
  };

  TF.drawer = function (opts) {
    var html =
      '<div class="drawer" role="dialog" aria-modal="true">' +
        '<div class="drawer-head">' +
          '<div style="min-width:0">' + (opts.eyebrow ? '<div class="tiny muted mono">' + TF.esc(opts.eyebrow) + '</div>' : '') +
            '<h2>' + TF.esc(opts.title) + '</h2>' +
            (opts.subtitle ? '<div class="small muted">' + TF.esc(opts.subtitle) + '</div>' : '') +
          '</div>' +
          '<button class="icon-btn" data-close style="margin-left:auto" aria-label="Close">' + TF.icon('x') + '</button>' +
        '</div>' +
        '<div class="drawer-body">' + (opts.body || '') + '</div>' +
        (opts.footer ? '<div class="drawer-foot">' + opts.footer + '</div>' : '') +
      '</div>';
    var ctx = mountOverlay('drawer-overlay', html, opts);
    ctx.body = ctx.el.querySelector('.drawer-body');
    ctx.foot = ctx.el.querySelector('.drawer-foot');
    if (opts.onMount) opts.onMount(ctx);
    return ctx;
  };

  TF.confirm = function (opts) {
    return new Promise(function (resolve) {
      var ctx = TF.modal({
        title: opts.title,
        size: 'narrow',
        body: '<p class="small" style="color:var(--ink-600)">' + TF.esc(opts.message) + '</p>' +
          (opts.extra || ''),
        footer: '<button class="btn" data-close>' + TF.esc(opts.cancelText || 'Cancel') + '</button>' +
          '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" id="cfmOk">' +
          TF.esc(opts.confirmText || 'Confirm') + '</button>',
        onClose: function () { resolve(false); }
      });
      ctx.el.querySelector('#cfmOk').addEventListener('click', function () {
        var payload = true;
        if (opts.collect) payload = opts.collect(ctx.el);
        ctx.el.remove();
        if (!document.querySelector('.overlay, .drawer-overlay')) document.body.style.overflow = '';
        resolve(payload);
      });
    });
  };

  /* Dropdown menus — one open at a time, closes on outside click. */
  TF.dropdown = function (anchorEl, items) {
    document.querySelectorAll('.dd-menu').forEach(function (m) { m.remove(); });
    var menu = document.createElement('div');
    menu.className = 'dd-menu';
    menu.innerHTML = items.map(function (it) {
      if (it.sep) return '<div class="dd-sep"></div>';
      return '<button class="dd-item ' + (it.danger ? 'danger' : '') + '" data-k="' + TF.esc(it.key) + '">' +
        (it.icon ? TF.icon(it.icon, 15) : '') + TF.esc(it.label) + '</button>';
    }).join('');
    var host = anchorEl.closest('.dropdown') || anchorEl.parentElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(menu);

    function away(e) {
      if (!menu.contains(e.target) && e.target !== anchorEl) {
        menu.remove();
        document.removeEventListener('mousedown', away);
      }
    }
    setTimeout(function () { document.addEventListener('mousedown', away); }, 0);

    menu.addEventListener('click', function (e) {
      var btn = e.target.closest('.dd-item');
      if (!btn) return;
      menu.remove();
      document.removeEventListener('mousedown', away);
      var item = items.filter(function (i) { return i.key === btn.dataset.k; })[0];
      if (item && item.onSelect) item.onSelect();
    });
    return menu;
  };

  /* ======================================================================
     Small DOM helpers
     ====================================================================== */
  TF.qs = function (sel, root) { return (root || document).querySelector(sel); };
  TF.qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  TF.on = function (root, event, sel, fn) {
    root.addEventListener(event, function (e) {
      var t = e.target.closest(sel);
      if (t && root.contains(t)) fn(e, t);
    });
  };
  TF.copy = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  };
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  /** Renders a value into a form-ready <option> list. */
  TF.options = function (list, selected, valueKey, labelKey) {
    return list.map(function (o) {
      var v = valueKey ? o[valueKey] : o;
      var l = labelKey ? o[labelKey] : o;
      return '<option value="' + TF.esc(v) + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + TF.esc(l) + '</option>';
    }).join('');
  };

  /** Pulls a whole form into a plain object. */
  TF.formData = function (root) {
    var out = {};
    TF.qsa('[name]', root).forEach(function (f) {
      if (f.type === 'checkbox') {
        if (f.dataset.multi) {
          out[f.name] = out[f.name] || [];
          if (f.checked) out[f.name].push(f.value);
        } else out[f.name] = f.checked;
      } else if (f.type === 'radio') {
        if (f.checked) out[f.name] = f.value;
      } else {
        out[f.name] = f.value;
      }
    });
    return out;
  };

  TF.requireFields = function (root, names) {
    var ok = true;
    names.forEach(function (n) {
      var f = root.querySelector('[name="' + n + '"]');
      if (!f) return;
      var bad = !String(f.value || '').trim();
      f.classList.toggle('err', bad);
      if (bad) ok = false;
    });
    if (!ok) TF.toast('Missing information', 'Fill in the highlighted fields to continue.', 'err');
    return ok;
  };
})(window);
