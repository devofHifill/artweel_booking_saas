/* ==========================================================================
   TourFlow — Website & booking widget
   Branding, pages, SEO and the embeddable widget builder. Everything saved
   here is what booking.html renders, so the preview is the real thing.
   ========================================================================== */
(function (global) {
  'use strict';
  var TF = global.TF;

  var SECTIONS = ['Overview', 'Pages', 'Navigation', 'Branding', 'Booking Widget', 'SEO', 'Preview'];
  var section = 'Overview';

  TF.views.website = function (root) {
    root.innerHTML =
      '<div class="page-head">' +
        '<div class="ph-text"><h1>Website &amp; Booking Widget</h1>' +
        '<p class="lede">Your storefront, and the widget you paste into any other site.</p></div>' +
        '<div class="ph-actions">' +
          '<a class="btn" href="booking.html" target="_blank" rel="noopener">' + TF.icon('eye') + ' View live site</a>' +
          '<button class="btn btn-primary" id="wsPublish">' + TF.icon('globe') + ' Publish changes</button>' +
        '</div>' +
      '</div>' +
      '<div class="settings-wrap">' +
        '<nav class="settings-nav" id="wsNav">' + SECTIONS.map(function (s) {
          return '<button data-s="' + s + '" class="' + (section === s ? 'on' : '') + '">' + s + '</button>';
        }).join('') + '</nav>' +
        '<div id="wsBody"></div>' +
      '</div>';

    draw();

    TF.on(root, 'click', '#wsNav button', function (e, el) {
      section = el.dataset.s;
      TF.qsa('#wsNav button').forEach(function (b) { b.classList.toggle('on', b.dataset.s === section); });
      draw();
    });
    root.querySelector('#wsPublish').addEventListener('click', function (e) {
      var btn = e.currentTarget;
      btn.innerHTML = '<span class="spinner"></span> Publishing…';
      btn.disabled = true;
      setTimeout(function () {
        TF.update(function (s) { s.settings.website.published = true; TF.log('website', 'Site republished'); });
        TF.toast('Site published', 'Your changes are live on book.harboradventures.example.');
        TF.rerender();
      }, 900);
    });

    function draw() {
      var host = root.querySelector('#wsBody');
      host.innerHTML =
        section === 'Overview' ? overview() :
        section === 'Pages' ? pages() :
        section === 'Navigation' ? navigation() :
        section === 'Branding' ? branding() :
        section === 'Booking Widget' ? widget() :
        section === 'SEO' ? seo() : preview();
      wire(host);
    }

    function wire(host) {
      var save = host.querySelector('[data-save]');
      if (save) save.addEventListener('click', function () {
        var d = TF.formData(host);
        TF.update(function (s) {
          Object.keys(d).forEach(function (k) {
            if (k in s.settings.website) s.settings.website[k] = d[k];
            if (k in s.settings.widget) s.settings.widget[k] = d[k];
          });
          TF.log('website', section + ' settings saved');
        });
        TF.toast('Saved', section + ' settings updated. The booking site reflects them immediately.');
        draw();
      });

      var copy = host.querySelector('#wsCopy');
      if (copy) copy.addEventListener('click', function () {
        TF.copy(host.querySelector('#wsEmbed').textContent).then(function () {
          copy.innerHTML = TF.icon('check') + ' Copied';
          TF.toast('Embed code copied', 'Paste it into any HTML page.');
          setTimeout(function () { copy.innerHTML = TF.icon('copy') + ' Copy Code'; }, 1800);
        });
      });

      TF.qsa('.js-widget-input', host).forEach(function (inp) {
        inp.addEventListener('input', function () { renderWidgetPreview(host); });
        inp.addEventListener('change', function () { renderWidgetPreview(host); });
      });
      if (host.querySelector('#wgPreview')) renderWidgetPreview(host);

      TF.on(host, 'click', '[data-page-toggle]', function (e, el) {
        var name = el.dataset.pageToggle;
        TF.update(function (s) {
          var p = s.settings.website.pages.filter(function (x) { return x.name === name; })[0];
          p.status = p.status === 'Published' ? 'Draft' : 'Published';
        });
        TF.toast('Page updated', name + ' is now ' + (TF.state().settings.website.pages
          .filter(function (x) { return x.name === name; })[0].status.toLowerCase()) + '.');
        draw();
      });
    }
  };

  /* ---------------------------------------------------------- overview */
  function overview() {
    var w = TF.state().settings.website;
    var views = w.pages.reduce(function (n, p) { return n + p.views30d; }, 0);
    var siteBookings = TF.state().bookings.filter(function (b) {
      return ['Website', 'Widget'].indexOf(b.source) !== -1;
    });
    return '<div class="grid grid-4 mb-3">' +
        '<div class="kpi"><div class="k-top"><span class="k-label">Status</span>' +
          '<span class="k-icon green">' + TF.icon('globe', 16) + '</span></div>' +
          '<div class="k-value" style="font-size:20px">' + (w.published ? 'Published' : 'Draft') + '</div>' +
          '<div class="k-foot muted">' + TF.esc(w.domain) + '</div></div>' +
        '<div class="kpi"><div class="k-top"><span class="k-label">Page views (30d)</span></div>' +
          '<div class="k-value">' + TF.fmt.num(views) + '</div></div>' +
        '<div class="kpi"><div class="k-top"><span class="k-label">Bookings from site</span></div>' +
          '<div class="k-value">' + siteBookings.length + '</div></div>' +
        '<div class="kpi"><div class="k-top"><span class="k-label">Conversion</span></div>' +
          '<div class="k-value">' + (views ? (siteBookings.length / views * 100).toFixed(1) : '0') + '%</div>' +
          '<div class="k-foot muted">visits to bookings</div></div>' +
      '</div>' +
      '<div class="grid grid-2">' +
        '<section class="card"><div class="card-head"><h2>Your booking site</h2></div><div class="card-body">' +
          heroPreview() +
          '<div class="row mt-3"><a class="btn btn-primary btn-sm" href="booking.html" target="_blank" rel="noopener">' +
            TF.icon('arrowR') + ' Open the live site</a>' +
          '<span class="small muted">Opens in a new tab — book something and watch it appear in your dashboard.</span></div>' +
        '</div></section>' +
        '<section class="card"><div class="card-head"><h2>Checklist</h2></div><div class="card-body">' +
          check(true, 'Custom domain connected') +
          check(true, 'SSL certificate issued') +
          check(true, 'Payment provider connected') +
          check(true, 'Cancellation policy published') +
          check(false, 'Gift cards page finished') +
          check(false, 'Google Analytics connected') +
        '</div></section>' +
      '</div>';
  }

  function check(done, label) {
    return '<div class="mini-row"><span class="k-icon ' + (done ? 'green' : '') + '" ' +
      'style="width:26px;height:26px;border-radius:7px">' + TF.icon(done ? 'check' : 'clock', 13) + '</span>' +
      '<span style="flex:1' + (done ? '' : ';color:var(--ink-500)') + '">' + label + '</span></div>';
  }

  function heroPreview() {
    var w = TF.state().settings.website;
    return '<div style="border:1px solid var(--border);border-radius:var(--r);overflow:hidden">' +
      '<div style="height:26px;background:var(--ink-100);display:flex;align-items:center;gap:5px;padding:0 10px">' +
        '<i style="width:8px;height:8px;border-radius:50%;background:#f87171"></i>' +
        '<i style="width:8px;height:8px;border-radius:50%;background:#fbbf24"></i>' +
        '<i style="width:8px;height:8px;border-radius:50%;background:#34d399"></i>' +
        '<span class="tiny muted" style="margin-left:8px">' + TF.esc(w.domain) + '</span></div>' +
      '<div style="padding:26px 20px;background:linear-gradient(135deg,' + w.primaryColor + ',' + w.accentColor + ');color:#fff">' +
        '<div style="font-weight:700;font-size:13px;opacity:.9">' + TF.esc(w.siteName) + '</div>' +
        '<div style="font-size:21px;font-weight:750;margin-top:10px;letter-spacing:-.02em">' + TF.esc(w.tagline) + '</div>' +
        '<div style="font-size:12px;opacity:.85;margin-top:6px;max-width:340px">' + TF.esc(w.heroSubtitle) + '</div>' +
        '<div style="margin-top:14px;display:inline-block;background:#fff;color:' + w.primaryColor +
          ';padding:7px 14px;border-radius:8px;font-size:12.5px;font-weight:650">Browse experiences</div>' +
      '</div></div>';
  }

  /* ------------------------------------------------------------- pages */
  function pages() {
    var w = TF.state().settings.website;
    return '<section class="card"><div class="card-head"><h2>Pages</h2>' +
      '<div class="right"><button class="btn btn-sm">' + TF.icon('plus') + ' Add page</button></div></div>' +
      '<div class="table-wrap"><table class="tf"><thead><tr><th>Page</th><th>Path</th>' +
      '<th class="hide-sm">Views (30d)</th><th>Status</th><th></th></tr></thead><tbody>' +
      w.pages.map(function (p) {
        return '<tr><td class="cell-main">' + TF.esc(p.name) + '</td>' +
          '<td class="mono">' + TF.esc(p.path) + '</td>' +
          '<td class="hide-sm">' + TF.fmt.num(p.views30d) + '</td>' +
          '<td>' + TF.badge(p.status === 'Published' ? 'Published' : 'Draft') + '</td>' +
          '<td><div class="act-btns"><button class="act-btn tip" data-tip="Publish / unpublish" ' +
            'data-page-toggle="' + TF.esc(p.name) + '">' + TF.icon(p.status === 'Published' ? 'eye' : 'check', 14) + '</button>' +
            '<button class="act-btn">' + TF.icon('edit', 14) + '</button></div></td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  /* -------------------------------------------------------- navigation */
  function navigation() {
    return '<section class="card"><div class="card-head"><h2>Navigation</h2>' +
      '<div class="right small muted">Drag order is out of scope in this prototype</div></div>' +
      '<div class="card-body">' +
      ['Home', 'Activities', 'About', 'Contact'].map(function (l, i) {
        return '<div class="mini-row"><span class="rank-n">' + (i + 1) + '</span>' +
          '<span style="flex:1"><b>' + l + '</b><div class="tiny muted">/' + l.toLowerCase().replace('home', '') + '</div></span>' +
          '<label class="switch"><input type="checkbox" checked><i class="track"></i><i class="thumb"></i></label></div>';
      }).join('') +
      '<div class="section-title mt-3">Header call to action</div>' +
      '<div class="form-grid"><div class="field"><label>Button label</label>' +
      '<input class="input" name="buttonText" value="' + TF.esc(TF.state().settings.widget.buttonText) + '"></div>' +
      '<div class="field"><label>Links to</label><select class="select">' +
      TF.options(['Activities list', 'Specific activity', 'Contact page'], 'Activities list') + '</select></div></div>' +
      '<button class="btn btn-primary mt-3" data-save>Save navigation</button>' +
      '</div></section>';
  }

  /* ---------------------------------------------------------- branding */
  function branding() {
    var w = TF.state().settings.website;
    return '<section class="card"><div class="card-head"><h2>Branding</h2></div><div class="card-body">' +
      '<div class="form-grid">' +
        '<div class="field"><label>Site name</label><input class="input" name="siteName" value="' + TF.esc(w.siteName) + '"></div>' +
        '<div class="field"><label>Custom domain</label><input class="input" name="domain" value="' + TF.esc(w.domain) + '"></div>' +
        '<div class="field full"><label>Hero headline</label><input class="input" name="tagline" value="' + TF.esc(w.tagline) + '"></div>' +
        '<div class="field full"><label>Hero subtitle</label>' +
          '<textarea class="textarea" name="heroSubtitle">' + TF.esc(w.heroSubtitle) + '</textarea></div>' +
        '<div class="field"><label>Primary colour</label>' +
          '<input class="input" type="color" name="primaryColor" value="' + w.primaryColor + '" style="height:38px;padding:3px"></div>' +
        '<div class="field"><label>Accent colour</label>' +
          '<input class="input" type="color" name="accentColor" value="' + w.accentColor + '" style="height:38px;padding:3px"></div>' +
        '<div class="field"><label>Contact email</label><input class="input" name="contactEmail" value="' + TF.esc(w.contactEmail) + '"></div>' +
        '<div class="field"><label>Contact phone</label><input class="input" name="contactPhone" value="' + TF.esc(w.contactPhone) + '"></div>' +
        '<div class="field full"><label>Logo <span class="hint">this demo draws a wordmark instead of uploading a file</span></label>' +
          '<div class="row"><span class="logo-mark" style="background:linear-gradient(135deg,' + w.primaryColor + ',' + w.accentColor + ')">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round">' +
          '<path d="M3 17l6-11 5 8 3-4 4 7z"/></svg></span>' +
          '<b>' + TF.esc(w.siteName) + '</b></div></div>' +
      '</div>' +
      '<button class="btn btn-primary mt-3" data-save>Save branding</button>' +
      '<div class="mt-3">' + heroPreview() + '</div>' +
      '</div></section>';
  }

  /* ------------------------------------------------------------ widget */
  function widget() {
    var s = TF.state();
    var wg = s.settings.widget;
    return '<div class="grid split" style="grid-template-columns:minmax(0,1fr) 340px;gap:16px">' +
      '<section class="card"><div class="card-head"><h2>Booking widget</h2>' +
        '<div class="sub">Paste it into any website — WordPress, Squarespace, plain HTML</div></div>' +
        '<div class="card-body">' +
          '<div class="form-grid">' +
            '<div class="field"><label>Default activity</label>' +
              '<select class="select js-widget-input" name="defaultActivity" id="wgAct">' +
              TF.options(s.activities, wg.defaultActivity, 'id', 'name') + '</select></div>' +
            '<div class="field"><label>Theme</label><select class="select js-widget-input" name="theme" id="wgTheme">' +
              TF.options(['Light', 'Dark'], wg.theme) + '</select></div>' +
            '<div class="field"><label>Accent colour</label>' +
              '<input class="input js-widget-input" type="color" name="primaryColor" id="wgColor" value="' + wg.primaryColor +
              '" style="height:38px;padding:3px"></div>' +
            '<div class="field"><label>Corners</label><select class="select js-widget-input" name="corner" id="wgCorner">' +
              TF.options(['Rounded', 'Square'], wg.corner) + '</select></div>' +
            '<div class="field"><label>Button text</label>' +
              '<input class="input js-widget-input" name="buttonText" id="wgBtn" value="' + TF.esc(wg.buttonText) + '"></div>' +
            '<div class="field"><label>Show</label><div class="row" style="gap:16px;height:36px">' +
              '<label class="check"><input type="checkbox" class="js-widget-input" id="wgPrices" name="showPrices"' +
                (wg.showPrices ? ' checked' : '') + '> Prices</label>' +
              '<label class="check"><input type="checkbox" class="js-widget-input" id="wgRatings" name="showRatings"' +
                (wg.showRatings ? ' checked' : '') + '> Ratings</label>' +
            '</div></div>' +
          '</div>' +
          '<button class="btn btn-primary mt-3" data-save>Save widget settings</button>' +
          '<div class="section-title mt-4">Embed code</div>' +
          '<div class="code" id="wsEmbed">' + embedCode() + '</div>' +
          '<div class="row mt-2"><button class="btn btn-sm" id="wsCopy">' + TF.icon('copy') + ' Copy Code</button>' +
            '<span class="small muted">Works on any page. The widget loads its own styles in an iframe.</span></div>' +
        '</div></section>' +
      '<aside class="card"><div class="card-head"><h2>Live preview</h2></div>' +
        '<div class="card-body"><div id="wgPreview"></div></div></aside>' +
      '</div>';
  }

  function embedCode() {
    var wg = TF.state().settings.widget;
    return '&lt;<span class="tag">iframe</span>\n' +
      '  <span class="attr">src</span>=<span class="val">"https://widget.tourflow.app/embed?operator=harbor-adventures&amp;activity=' +
        TF.esc(wg.defaultActivity) + '&amp;theme=' + wg.theme.toLowerCase() + '"</span>\n' +
      '  <span class="attr">width</span>=<span class="val">"100%"</span> <span class="attr">height</span>=<span class="val">"620"</span>\n' +
      '  <span class="attr">style</span>=<span class="val">"border:0;border-radius:' + (wg.corner === 'Rounded' ? '14px' : '0') + '"</span>\n' +
      '  <span class="attr">title</span>=<span class="val">"Book with Harbor Adventures"</span>&gt;\n' +
      '&lt;/<span class="tag">iframe</span>&gt;';
  }

  function renderWidgetPreview(host) {
    var el = host.querySelector('#wgPreview');
    if (!el) return;
    var actId = host.querySelector('#wgAct').value;
    var a = TF.sel.activity(actId);
    var color = host.querySelector('#wgColor').value;
    var dark = host.querySelector('#wgTheme').value === 'Dark';
    var radius = host.querySelector('#wgCorner').value === 'Rounded' ? '14px' : '2px';
    var btn = host.querySelector('#wgBtn').value || 'Book Now';
    var showPrices = host.querySelector('#wgPrices').checked;
    var showRatings = host.querySelector('#wgRatings').checked;

    var slots = TF.state().schedule.filter(function (sl) {
      return sl.activityId === actId && sl.date >= TF.today();
    }).slice(0, 3);

    el.innerHTML =
      '<div style="border-radius:' + radius + ';overflow:hidden;border:1px solid ' + (dark ? '#1f2937' : 'var(--border)') +
        ';background:' + (dark ? '#0f172a' : '#fff') + ';color:' + (dark ? '#e2e8f0' : 'inherit') + '">' +
        '<div style="height:78px;background:linear-gradient(135deg,' + a.grad[0] + ',' + a.grad[1] +
          ');display:grid;place-items:center;font-size:30px">' + a.emoji + '</div>' +
        '<div style="padding:14px">' +
          '<div style="font-weight:700;font-size:14.5px">' + TF.esc(a.name) + '</div>' +
          '<div style="font-size:12px;opacity:.7;margin-top:2px">' + TF.fmt.duration(a.duration) +
            (showRatings ? ' · ★ ' + a.rating : '') + '</div>' +
          (showPrices ? '<div style="font-size:19px;font-weight:750;margin-top:8px;color:' + color + '">' +
            TF.fmt.money(a.price) + '<span style="font-size:11.5px;font-weight:500;opacity:.7"> per adult</span></div>' : '') +
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.6;margin-top:12px;font-weight:650">Select date</div>' +
          '<div style="border:1px solid ' + (dark ? '#1f2937' : 'var(--border)') + ';border-radius:8px;padding:8px;margin-top:5px;font-size:12.5px">' +
            TF.fmt.date(TF.today()) + '</div>' +
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.6;margin-top:12px;font-weight:650">Select time</div>' +
          '<div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap">' +
            (slots.length ? slots.map(function (sl, i) {
              return '<span style="border:1.5px solid ' + (i === 0 ? color : (dark ? '#1f2937' : 'var(--border)')) +
                ';border-radius:7px;padding:5px 9px;font-size:12px;font-weight:600;' +
                (i === 0 ? 'background:' + color + '18;color:' + color : '') + '">' + TF.fmt.time(sl.start) + '</span>';
            }).join('') : '<span style="font-size:12px;opacity:.6">No departures scheduled</span>') +
          '</div>' +
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.6;margin-top:12px;font-weight:650">Guests</div>' +
          '<div style="display:flex;align-items:center;gap:10px;border:1px solid ' + (dark ? '#1f2937' : 'var(--border)') +
            ';border-radius:8px;padding:6px 10px;margin-top:5px;font-size:12.5px">' +
            '<span style="flex:1">Adults</span><span style="opacity:.5">−</span><b>2</b><span style="opacity:.5">+</span></div>' +
          '<div style="background:' + color + ';color:#fff;text-align:center;padding:10px;border-radius:8px;' +
            'font-weight:650;font-size:13.5px;margin-top:14px">' + TF.esc(btn) + '</div>' +
          '<div style="text-align:center;font-size:10.5px;opacity:.55;margin-top:8px">Powered by TourFlow</div>' +
        '</div></div>';
  }

  /* --------------------------------------------------------------- SEO */
  function seo() {
    var w = TF.state().settings.website;
    return '<section class="card"><div class="card-head"><h2>Search engine optimisation</h2></div><div class="card-body">' +
      '<div class="form-grid">' +
        '<div class="field full"><label>Page title</label><input class="input" name="seoTitle" value="' + TF.esc(w.seoTitle) + '"></div>' +
        '<div class="field full"><label>Meta description</label>' +
          '<textarea class="textarea" name="seoDescription">' + TF.esc(w.seoDescription) + '</textarea></div>' +
      '</div>' +
      '<div class="section-title mt-3">Search result preview</div>' +
      '<div class="card"><div class="card-body">' +
        '<div style="color:#1a0dab;font-size:17px">' + TF.esc(w.seoTitle) + '</div>' +
        '<div style="color:#006621;font-size:12.5px">' + TF.esc(w.domain) + '</div>' +
        '<div style="color:#545454;font-size:13px;margin-top:3px">' + TF.esc(w.seoDescription) + '</div>' +
      '</div></div>' +
      '<div class="section-title mt-3">Structured data</div>' +
      '<div class="mini-list">' +
        '<div class="mini-row"><span style="flex:1">Product schema on every activity</span>' + TF.badge('Active') + '</div>' +
        '<div class="mini-row"><span style="flex:1">Aggregate rating markup</span>' + TF.badge('Active') + '</div>' +
        '<div class="mini-row"><span style="flex:1">Sitemap submitted to Google</span>' + TF.badge('Active') + '</div>' +
        '<div class="mini-row"><span style="flex:1">Analytics</span>' + TF.badge('Disconnected') + '</div>' +
      '</div>' +
      '<button class="btn btn-primary mt-3" data-save>Save SEO settings</button>' +
      '</div></section>';
  }

  /* ----------------------------------------------------------- preview */
  function preview() {
    return '<section class="card"><div class="card-head"><h2>Live preview</h2>' +
      '<div class="right"><a class="btn btn-sm" href="booking.html" target="_blank" rel="noopener">' +
      TF.icon('arrowR') + ' Open in a new tab</a></div></div>' +
      '<div class="card-body">' +
        '<iframe src="booking.html" title="Booking site preview" ' +
        'style="width:100%;height:640px;border:1px solid var(--border);border-radius:var(--r)"></iframe>' +
        '<p class="small muted mt-2">This is the real customer site running against the same data as your dashboard. ' +
        'Anything booked in it appears in Bookings straight away.</p>' +
      '</div></section>';
  }
})(window);
