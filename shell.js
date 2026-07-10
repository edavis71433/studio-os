/* ── Studio OS — Unified Workspace Shell (Phase C1) ───────────────────────────
   ONE application frame for every signed-in surface. It consumes buildNav (the
   one nav source of truth) via /portal/context — it does NOT define navigation,
   permissions, or visibility. Include on any page:
       <link rel="stylesheet" href="/shell.css">
       <script src="/shell.js" defer></script>
   The shell injects its own top bar, so pages need no structural change; it
   adapts by role/edition/capabilities/entitlements exactly as buildNav does. */
(function () {
  'use strict';
  if (window.__ddsShell) return; window.__ddsShell = true;

  var SUPABASE_URL = "https://qksstlqzbhesadrrofgn.supabase.co";
  var SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrc3N0bHF6Ymhlc2FkcnJvZmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NzMwMDMsImV4cCI6MjA5NzU0OTAwM30.4V94Ua7z5cntPWtvtqN24TUnfY5A6K6-zCxY0iEcgYo";
  var FN = SUPABASE_URL + "/functions/v1/presence";
  var TOKEN = "";
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };

  // ── pure nav helpers (mirror of lib/shell.ts — locked by shell_test.mjs) ──
  function normalizePath(p) {
    var s = String(p || '').split('#')[0].split('?')[0].trim();
    s = s.replace(/^https?:\/\/[^/]+/, '');
    if (s.charAt(0) !== '/') s = '/' + s;
    s = s.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    if (s.length > 1) s = s.replace(/\/$/, '');
    return s || '/';
  }
  function activeItemKey(pathname, nav) {
    var here = normalizePath(pathname), best = null;
    (nav || []).forEach(function (sec) {
      (sec.items || []).forEach(function (it) {
        var href = normalizePath(it.href);
        if (href === here) best = { key: it.key, len: 999, exact: true };
        else if (!(best && best.exact) && href !== '/' && (here === href || here.indexOf(href + '/') === 0)) {
          if (!best || href.length > best.len) best = { key: it.key, len: href.length };
        }
      });
    });
    return best ? best.key : null;
  }
  function flatten(nav) { var o = []; (nav || []).forEach(function (s) { (s.items || []).forEach(function (i) { o.push({ label: i.label, href: i.href, section: s.label }); }); }); return o; }

  // ── supabase (reuse the portal session) ──
  function ensureSupabase() {
    return new Promise(function (resolve) {
      if (window.supabase) return resolve();
      var s = document.createElement('script');
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4";
      s.onload = function () { resolve(); }; s.onerror = function () { resolve(); };
      document.head.appendChild(s);
    });
  }
  // SC-1: the active client scope lives in the URL (?client=<id>) — per-tab,
  // shareable, refresh-safe. It is a REQUEST; the server re-validates it and
  // fails closed. Only send something UUID-shaped (cosmetic guard; server is law).
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function scopeId() { try { var v = new URLSearchParams(location.search).get('client') || ''; return UUID_RE.test(v) ? v : ''; } catch (_) { return ''; } }
  function withScope(href) {
    var s = scopeId(); if (!s || !href || href.charAt(0) !== '/') return href;
    var hash = '', h = href, hi = h.indexOf('#'); if (hi >= 0) { hash = h.slice(hi); h = h.slice(0, hi); }
    return h + (h.indexOf('?') >= 0 ? '&' : '?') + 'client=' + encodeURIComponent(s) + hash;
  }
  function api(path) {
    var s = scopeId();
    return fetch(FN + path, { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-dds-user-jwt': TOKEN, 'x-dds-scope-site': s } })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, status: r.status, body: b }; }).catch(function () { return { ok: r.ok, status: r.status, body: {} }; }); })
      .catch(function () { return { ok: false, status: 0, body: {} }; });
  }

  // ── DOM ──
  var root, sb, CTX = null, DESTS = [];
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  function brandCtxLabel(nav, activeKey) {
    var lbl = '';
    (nav || []).forEach(function (s) { (s.items || []).forEach(function (i) { if (i.key === activeKey) lbl = s.label; }); });
    return lbl;
  }

  var UTILS = [];
  function render() {
    var nav = (CTX && CTX.nav) || [];
    var activeKey = activeItemKey(location.pathname, nav);
    DESTS = flatten(nav);                          // ⌘K reaches EVERY capability (primary + utility)
    // Architecture v1.0: the primary bar is outcomes only; utility sections
    // (Connections, Settings, Help) render in the profile/overflow menu.
    var primary = nav.filter(function (s) { return !s.utility; });
    UTILS = nav.filter(function (s) { return s.utility; });
    var ctxLabel = brandCtxLabel(nav, activeKey);
    var att = (CTX && CTX.attention_count) || 0;   // Phase FLOW: bell badge from context (no extra request)

    var navHtml = primary.map(function (sec) {
      var single = sec.items.length === 1;
      var open = false;
      var isActive = sec.items.some(function (i) { return i.key === activeKey; });
      if (single) {
        var it = sec.items[0];
        return '<div class="sec' + (isActive ? ' active' : '') + '"><button data-href="' + esc(withScope(it.href)) + '">' + esc(sec.label) + '</button></div>';
      }
      var items = sec.items.map(function (i) { return '<a href="' + esc(withScope(i.href)) + '" class="' + (i.key === activeKey ? 'here' : '') + '">' + esc(i.label) + '</a>'; }).join('');
      return '<div class="sec' + (isActive ? ' active' : '') + '"><button data-sec="' + esc(sec.key) + '">' + esc(sec.label) + ' ▾</button><div class="menu">' + items + '</div></div>';
    }).join('');

    // SC-1: the breadcrumb — "Studio › {client}" whenever an operator is scoped.
    var scope = CTX && CTX.scope;
    var brandHtml = scope && scope.name
      ? '<span class="dds-brand"><span class="mark">P</span><a href="/agency.html" id="dds-scope-exit" style="color:inherit;text-decoration:none">Studio</a> <span class="ctx">›</span> <span class="ctx" style="color:var(--dds-p);font-weight:600">' + esc(scope.name) + '</span></span>'
      : '<a class="dds-brand" href="' + esc((CTX && CTX.landing) || '/today.html') + '"><span class="mark">P</span>Studio OS' + (ctxLabel ? ' <span class="ctx">· ' + esc(ctxLabel) + '</span>' : '') + '</a>';

    root.innerHTML =
      '<button class="dds-ic dds-burger" id="dds-burger" aria-label="Menu">☰</button>' +
      brandHtml +
      '<nav class="dds-nav" aria-label="Workspace">' + navHtml + '</nav>' +
      '<div class="dds-search" id="dds-search" role="button" tabindex="0" aria-label="Search"><span>🔍</span><span>Search</span><kbd>⌘K</kbd></div>' +
      '<div class="dds-right">' +
        '<button class="dds-ic" id="dds-bell" aria-label="Notifications">🔔' + (att > 0 ? '<span class="dot">' + (att > 9 ? '9+' : att) + '</span>' : '') + '</button>' +
        '<a class="dds-ic" href="/help.html" aria-label="Help">?</a>' +
        '<button class="dds-ic" id="dds-profile" aria-label="Account">◐</button>' +
      '</div>';

    wire(nav);
  }

  function wire(nav) {
    // section dropdowns
    root.querySelectorAll('.dds-nav .sec > button[data-sec]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var sec = b.parentNode; var wasOpen = sec.classList.contains('open');
        closeMenus(); if (!wasOpen) sec.classList.add('open');
      });
    });
    root.querySelectorAll('.dds-nav .sec > button[data-href]').forEach(function (b) {
      b.addEventListener('click', function () { location.href = b.getAttribute('data-href'); });
    });
    document.addEventListener('click', closeMenus);
    // search
    var s = document.getElementById('dds-search');
    s.addEventListener('click', openPalette);
    s.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPalette(); } });
    document.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); } });
    // bell + profile
    document.getElementById('dds-bell').addEventListener('click', function (e) { e.stopPropagation(); toggleNotifications(); });
    document.getElementById('dds-profile').addEventListener('click', function (e) { e.stopPropagation(); toggleProfile(); });
    // burger
    document.getElementById('dds-burger').addEventListener('click', function (e) { e.stopPropagation(); toggleDrawer(nav); });
  }
  function closeMenus() { root.querySelectorAll('.dds-nav .sec.open').forEach(function (s) { s.classList.remove('open'); }); }

  // ── command palette ──
  var pal;
  function openPalette() {
    if (!pal) {
      pal = el('<div class="dds-palette"><div class="box"><input placeholder="Search Studio OS…" aria-label="Search"><div class="results"></div></div></div>');
      document.body.appendChild(pal);
      pal.addEventListener('click', function (e) { if (e.target === pal) closePalette(); });
      pal.querySelector('input').addEventListener('input', function (e) { paintResults(e.target.value); });
      pal.querySelector('input').addEventListener('keydown', function (e) {
        var sel = pal.querySelector('.res.sel');
        if (e.key === 'Escape') return closePalette();
        if (e.key === 'Enter' && sel) { location.href = sel.getAttribute('href'); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); var all = [].slice.call(pal.querySelectorAll('.res')); if (!all.length) return;
          var i = all.indexOf(sel); i = e.key === 'ArrowDown' ? Math.min(all.length - 1, i + 1) : Math.max(0, i - 1);
          all.forEach(function (r) { r.classList.remove('sel'); }); all[i < 0 ? 0 : i].classList.add('sel');
        }
      });
    }
    pal.classList.add('open'); var inp = pal.querySelector('input'); inp.value = ''; paintResults(''); setTimeout(function () { inp.focus(); }, 20);
  }
  function closePalette() { if (pal) pal.classList.remove('open'); }
  function hasFiles() { return (CTX && CTX.nav || []).some(function (s) { return s.key === 'files'; }); }
  var fileSearchTok = 0;
  function paintResults(q) {
    var qq = String(q || '').trim().toLowerCase();
    var list = qq ? DESTS.filter(function (d) { return d.label.toLowerCase().indexOf(qq) >= 0 || d.section.toLowerCase().indexOf(qq) >= 0; }) : DESTS;
    var box = pal.querySelector('.results');
    var navHtml = list.map(function (d, i) { return '<a class="res' + (i === 0 ? ' sel' : '') + '" href="' + esc(withScope(d.href)) + '">' + esc(d.label) + '<span class="s">' + esc(d.section) + '</span></a>'; }).join('');
    box.innerHTML = navHtml || (qq ? '' : '');
    // ── Files: search actual files by name/tag/description (reuses GET /assets?q=) ──
    var tok = ++fileSearchTok;
    if (qq.length >= 2 && hasFiles()) {
      api('/assets?q=' + encodeURIComponent(qq) + '&limit=6').then(function (r) {
        if (tok !== fileSearchTok) return; // a newer keystroke won
        var files = (r.ok && r.body && r.body.data && r.body.data.assets) || [];
        var cur = pal.querySelector('.results'); if (!cur) return;
        var have = !!navHtml;
        if (!files.length) { if (!have) cur.innerHTML = '<div class="none">Nothing matches “' + esc(q) + '”.</div>'; return; }
        var fhtml = files.map(function (a, i) {
          var sub = a.in_use ? 'Files · on your site' : 'Files';
          return '<a class="res' + (!have && i === 0 ? ' sel' : '') + '" href="' + esc(withScope('/files.html?focus=' + a.id)) + '">' + esc(a.name || 'File') + '<span class="s">' + esc(sub) + '</span></a>';
        }).join('');
        cur.innerHTML = navHtml + fhtml;
      });
    } else if (!list.length) {
      box.innerHTML = '<div class="none">Nothing matches “' + esc(q) + '”.</div>';
    }
  }

  // ── notifications (lazy; reuses /portal/feed — no new system) ──
  var notif;
  function toggleNotifications() {
    closeProfile();
    if (notif && notif.classList.contains('open')) { notif.classList.remove('open'); return; }
    if (!notif) { notif = el('<div class="dds-pop"><h4>Needs a look</h4><div class="body"><div class="muted">Loading…</div></div></div>'); document.body.appendChild(notif); notif.addEventListener('click', function (e) { e.stopPropagation(); }); }
    notif.classList.add('open');
    api('/portal/feed').then(function (r) {
      var body = notif.querySelector('.body');
      if (!r.ok) { body.innerHTML = '<div class="muted">You’re all caught up.</div>'; return; }
      var d = r.body.data || {}; var out = '';
      // Phase FLOW: notices first (a lead waiting, a domain expiring) — each taps
      // straight through to the page that resolves it, from any screen.
      (d.notices || []).forEach(function (n) { out += '<a class="row" href="' + esc(withScope(n.href || '/today.html')) + '"><b>' + esc(n.headline || 'Needs a look') + '</b>' + (n.body ? '<div class="sub">' + esc(n.body) + '</div>' : '') + '</a>'; });
      (d.pending_approvals || []).forEach(function (p) { out += '<a class="row" href="' + esc(withScope((CTX && CTX.landing) || '/today.html')) + '"><b>Waiting for approval</b><div class="sub">' + esc(p.title || 'A change is ready') + '</div></a>'; });
      (d.moments || []).slice(0, 4).forEach(function (m) { out += '<a class="row" href="' + esc(withScope('/today.html')) + '">' + esc(m.headline || 'A moment') + (m.summary ? '<div class="sub">' + esc(m.summary) + '</div>' : '') + '</a>'; });
      body.innerHTML = out || '<div class="muted">You’re all caught up.</div>';
    });
  }
  function closeNotifications() { if (notif) notif.classList.remove('open'); }

  // ── profile / context menu (role, edition, agency, sign out) ──
  var prof;
  function toggleProfile() {
    closeNotifications();
    if (prof && prof.classList.contains('open')) { prof.classList.remove('open'); return; }
    if (!prof) { prof = el('<div class="dds-pop"></div>'); document.body.appendChild(prof); prof.addEventListener('click', function (e) { e.stopPropagation(); }); }
    var email = (sb && sb.__email) || 'Signed in';
    var role = (CTX && CTX.site_role) || '';
    var edition = (CTX && CTX.edition) || '';
    var rows = '';
    if (CTX && CTX.is_agency) rows += '<a class="row" href="/agency.html">Studio</a>';
    if (CTX && CTX.is_operator) rows += '<a class="row" href="/dds-studio-manage-9k2p.html">Admin & operator tools</a>';
    // Architecture v1.0: utility destinations (Connections, Settings, Help) live here.
    UTILS.forEach(function (sec) { sec.items.forEach(function (i) { rows += '<a class="row" href="' + esc(withScope(i.href)) + '">' + esc(i.label) + '</a>'; }); });
    rows += '<a class="row" href="mailto:support@davisdigitalstudio.com">Support</a>';
    rows += '<a class="row" href="#" id="dds-signout">Sign out</a>';
    prof.innerHTML = '<div class="who"><div class="n">' + esc(email) + '</div><div class="r">' + esc([role.replace(/_/g, ' '), edition].filter(Boolean).join(' · ')) + '</div></div>' + rows;
    prof.classList.add('open');
    var so = document.getElementById('dds-signout');
    if (so) so.addEventListener('click', function (e) { e.preventDefault(); if (sb) sb.auth.signOut().then(function () { location.href = '/portal.html'; }); else location.href = '/portal.html'; });
  }
  function closeProfile() { if (prof) prof.classList.remove('open'); }
  document.addEventListener('click', function () { closeNotifications(); closeProfile(); });

  // ── mobile drawer ──
  var drawer;
  function toggleDrawer(nav) {
    if (drawer && drawer.classList.contains('open')) { drawer.classList.remove('open'); return; }
    var activeKey = activeItemKey(location.pathname, nav);
    var html = (nav || []).map(function (s) {
      return '<div class="g"><p class="t">' + esc(s.label) + '</p>' + s.items.map(function (i) { return '<a href="' + esc(withScope(i.href)) + '" class="' + (i.key === activeKey ? 'here' : '') + '">' + esc(i.label) + '</a>'; }).join('') + '</div>';
    }).join('');
    if (!drawer) { drawer = el('<div class="dds-drawer"></div>'); document.body.appendChild(drawer); }
    drawer.innerHTML = html; drawer.classList.add('open');
  }

  // ── boot ──
  function mountFrame() {
    root = document.getElementById('dds-shell');
    if (!root) { root = document.createElement('div'); root.id = 'dds-shell'; document.body.insertBefore(root, document.body.firstChild); }
    document.documentElement.classList.add('dds-has-shell');
  }
  function minimalShell() {
    root.innerHTML = '<a class="dds-brand" href="/"><span class="mark">P</span>Studio OS</a><div style="flex:1"></div><a class="dds-ic" href="/help.html" aria-label="Help">?</a><a class="dds-ic" href="/portal.html" aria-label="Sign in">◐</a>';
  }

  // ── PT-5: contextual onboarding — teach in context, show ONCE, disappear ────
  // Declarative + reuses the shell: any page marks a `.dds-hint[data-hint]`
  // element (hidden) next to the thing it explains. We reveal unseen ones with a
  // "Got it", remember the dismissal, and never show it again. No tour, no steps.
  function hintsSeen() { try { return JSON.parse(localStorage.getItem('dds-hints') || '{}'); } catch (_) { return {}; } }
  function markHint(k) { try { var s = hintsSeen(); s[k] = 1; localStorage.setItem('dds-hints', JSON.stringify(s)); } catch (_) { /* */ } }
  function attachDismiss(node, key) {
    var x = document.createElement('button');
    x.className = 'x'; x.type = 'button'; x.setAttribute('aria-label', 'Dismiss tip'); x.textContent = 'Got it';
    x.addEventListener('click', function () { markHint(key); node.classList.remove('show'); setTimeout(function () { node.remove(); }, 200); });
    node.appendChild(x);
    requestAnimationFrame(function () { node.classList.add('show'); });
  }
  // declarative page-level hints (marked in the HTML). One at a time; never intrusive.
  function scanHints() {
    var seen = hintsSeen();
    Array.prototype.forEach.call(document.querySelectorAll('.dds-hint[data-hint]:not(.dds-live)'), function (node) {
      var key = node.getAttribute('data-hint');
      if (!key || seen[key]) { node.remove(); return; }
      if (document.querySelector('.dds-hint.show')) return;   // only one hint visible at once
      node.classList.add('dds-live'); node.hidden = false; attachDismiss(node, key);
    });
  }
  // imperative: teach the moment a context opens (a Studio-OS view, a desk).
  window.ddsHint = function (key, html) {
    var seen = hintsSeen();
    if (!key || seen[key]) return false;
    if (document.querySelector('.dds-hint.show')) return false;   // never stack
    var bar = el('<div class="dds-hint dds-live" role="note"><span class="t"></span></div>');
    bar.querySelector('.t').innerHTML = html;
    document.body.appendChild(bar); attachDismiss(bar, key);
    return true;
  };
  window.ddsScanHints = scanHints;

  // ── BR-1: shared state helpers — one empty / loading / error / success set for
  //    every surface. Additive; pages opt in. Markup uses the canonical shell
  //    classes above, so it's theme-aware and consistent everywhere it's used.
  function sEsc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function hostOf(h) { return typeof h === 'string' ? document.querySelector(h) : h; }
  window.ddsEmpty = function (host, opts) {
    host = hostOf(host); if (!host) return; opts = opts || {};
    var act = opts.actionLabel ? '<div class="act"><button type="button" class="primary" data-dds-act>' + sEsc(opts.actionLabel) + '</button></div>' : '';
    host.innerHTML = '<div class="dds-empty">' + (opts.icon ? '<div class="ico">' + sEsc(opts.icon) + '</div>' : '') +
      '<h3>' + sEsc(opts.title || 'Nothing here yet') + '</h3>' +
      (opts.body ? '<p>' + sEsc(opts.body) + '</p>' : '') + act + '</div>';
    if (opts.onAction) { var b = host.querySelector('[data-dds-act]'); if (b) b.addEventListener('click', opts.onAction); }
  };
  window.ddsSkeleton = function (host, rows) {
    host = hostOf(host); if (!host) return;
    var n = rows || 3, out = '';
    for (var i = 0; i < n; i++) out += '<div class="dds-skeleton" style="height:14px;width:' + (100 - (i % 3) * 12) + '%"></div>';
    host.innerHTML = out;
  };
  window.ddsError = function (host, message, onRetry) {
    host = hostOf(host); if (!host) return;
    host.innerHTML = '<div class="dds-error"><span class="ico">!</span><span>' + sEsc(message || 'Something went wrong.') + '</span>' +
      (onRetry ? '<button type="button" class="retry" data-dds-retry>Try again</button>' : '') + '</div>';
    if (onRetry) { var b = host.querySelector('[data-dds-retry]'); if (b) b.addEventListener('click', onRetry); }
  };
  window.ddsToast = function (message, kind) {
    var t = el('<div class="dds-toast ' + (kind === 'err' ? 'err' : 'ok') + '" role="status" aria-live="polite"><span class="ico">' + (kind === 'err' ? '!' : '✓') + '</span><span class="t"></span></div>');
    t.querySelector('.t').textContent = String(message == null ? '' : message);
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 250); }, kind === 'err' ? 5200 : 3200);
    return t;
  };

  function boot() {
    mountFrame();
    scanHints();
    ensureSupabase().then(function () {
      if (!window.supabase) { minimalShell(); return; }
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: 'dds-portal-auth', persistSession: true, autoRefreshToken: true } });
      // Keep TOKEN fresh: the SDK auto-refreshes the session (~hourly) and fires
      // this — without it the captured token goes stale and every call 401s.
      sb.auth.onAuthStateChange(function (_evt, session) { if (session && session.access_token) TOKEN = session.access_token; });
      sb.auth.getSession().then(function (res) {
        var sess = res && res.data && res.data.session;
        TOKEN = (sess && sess.access_token) || "";
        sb.__email = (sess && sess.user && sess.user.email) || '';
        if (!TOKEN) { minimalShell(); return; }
        api('/portal/context').then(function (r) {
          if (!r.ok || !r.body || !r.body.data) { minimalShell(); return; }
          CTX = r.body.data; render();
        });
      }).catch(minimalShell);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

/* ── A11y enhancer (shared) ───────────────────────────────────────────────────
   The single most common a11y defect across the app is a clickable <div>/<span>/
   <tr> with an onclick but no keyboard support. This makes every such element
   keyboard-operable (role=button + tabindex + Enter/Space activates) and traps
   Tab inside a visible modal. Additive + delegated, so it survives the constant
   innerHTML re-renders. Included automatically wherever shell.js loads; the two
   standalone big surfaces (portal, admin console) inline the same block. */
(function () {
  'use strict';
  if (window.__ddsA11y) return; window.__ddsA11y = true;
  function enhance() {
    var els = document.querySelectorAll('[onclick]:not(button):not(a):not(input):not(select):not(textarea):not([data-kbd])');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.setAttribute('data-kbd', '1');
      if (el.isContentEditable) continue;
      if (!el.getAttribute('role')) el.setAttribute('role', 'button');
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    }
  }
  var pending = false;
  function schedule() { if (pending) return; pending = true; (window.requestAnimationFrame || setTimeout)(function () { pending = false; enhance(); }); }
  // Enter/Space activates a click-handler element (delegated → covers re-renders).
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var t = e.target;
    if (!t || !t.matches) return;
    if (t.isContentEditable || t.matches('button,a,input,select,textarea')) return;
    if (t.hasAttribute('onclick') || t.getAttribute('role') === 'button') { e.preventDefault(); t.click(); }
  });
  // Tab focus-trap for a visible dialog; pulls focus in on the first Tab.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var mm = document.querySelectorAll('[aria-modal="true"],[role="dialog"]'), modal = null;
    for (var i = 0; i < mm.length; i++) { if (mm[i].offsetParent !== null) modal = mm[i]; }
    if (!modal) return;
    var f = modal.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
    f = Array.prototype.filter.call(f, function (el) { return el.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  var mo = (typeof MutationObserver !== 'undefined') ? new MutationObserver(schedule) : null;
  function start() { enhance(); if (mo && document.body) mo.observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
