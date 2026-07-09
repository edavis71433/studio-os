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
  function api(path) {
    return fetch(FN + path, { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-dds-user-jwt': TOKEN } })
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

  function render() {
    var nav = (CTX && CTX.nav) || [];
    var activeKey = activeItemKey(location.pathname, nav);
    DESTS = flatten(nav);
    var ctxLabel = brandCtxLabel(nav, activeKey);
    var att = (CTX && CTX.attention_count) || 0;   // Phase FLOW: bell badge from context (no extra request)

    var navHtml = nav.map(function (sec) {
      var single = sec.items.length === 1;
      var open = false;
      var isActive = sec.items.some(function (i) { return i.key === activeKey; });
      if (single) {
        var it = sec.items[0];
        return '<div class="sec' + (isActive ? ' active' : '') + '"><button data-href="' + esc(it.href) + '">' + esc(sec.label) + '</button></div>';
      }
      var items = sec.items.map(function (i) { return '<a href="' + esc(i.href) + '" class="' + (i.key === activeKey ? 'here' : '') + '">' + esc(i.label) + '</a>'; }).join('');
      return '<div class="sec' + (isActive ? ' active' : '') + '"><button data-sec="' + esc(sec.key) + '">' + esc(sec.label) + ' ▾</button><div class="menu">' + items + '</div></div>';
    }).join('');

    root.innerHTML =
      '<button class="dds-ic dds-burger" id="dds-burger" aria-label="Menu">☰</button>' +
      '<a class="dds-brand" href="' + esc((CTX && CTX.landing) || '/today.html') + '"><span class="mark">P</span>Presence' + (ctxLabel ? ' <span class="ctx">· ' + esc(ctxLabel) + '</span>' : '') + '</a>' +
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
  function paintResults(q) {
    var qq = String(q || '').trim().toLowerCase();
    var list = qq ? DESTS.filter(function (d) { return d.label.toLowerCase().indexOf(qq) >= 0 || d.section.toLowerCase().indexOf(qq) >= 0; }) : DESTS;
    var box = pal.querySelector('.results');
    if (!list.length) { box.innerHTML = '<div class="none">Nothing matches “' + esc(q) + '”.</div>'; return; }
    box.innerHTML = list.map(function (d, i) { return '<a class="res' + (i === 0 ? ' sel' : '') + '" href="' + esc(d.href) + '">' + esc(d.label) + '<span class="s">' + esc(d.section) + '</span></a>'; }).join('');
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
      (d.notices || []).forEach(function (n) { out += '<a class="row" href="' + esc(n.href || '/today.html') + '"><b>' + esc(n.headline || 'Needs a look') + '</b>' + (n.body ? '<div class="sub">' + esc(n.body) + '</div>' : '') + '</a>'; });
      (d.pending_approvals || []).forEach(function (p) { out += '<a class="row" href="' + esc((CTX && CTX.landing) || '/today.html') + '"><b>Waiting for approval</b><div class="sub">' + esc(p.title || 'A change is ready') + '</div></a>'; });
      (d.moments || []).slice(0, 4).forEach(function (m) { out += '<a class="row" href="/today.html">' + esc(m.headline || 'A moment') + (m.summary ? '<div class="sub">' + esc(m.summary) + '</div>' : '') + '</a>'; });
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
    if (CTX && CTX.is_agency) rows += '<a class="row" href="/agency.html">Agency portfolio</a>';
    if (CTX && CTX.is_operator) rows += '<a class="row" href="/dds-studio-manage-9k2p.html">Admin & operator tools</a>';
    rows += '<a class="row" href="/help.html">Help</a>';
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
      return '<div class="g"><p class="t">' + esc(s.label) + '</p>' + s.items.map(function (i) { return '<a href="' + esc(i.href) + '" class="' + (i.key === activeKey ? 'here' : '') + '">' + esc(i.label) + '</a>'; }).join('') + '</div>';
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
    root.innerHTML = '<a class="dds-brand" href="/"><span class="mark">P</span>Presence</a><div style="flex:1"></div><a class="dds-ic" href="/help.html" aria-label="Help">?</a><a class="dds-ic" href="/portal.html" aria-label="Sign in">◐</a>';
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

  function boot() {
    mountFrame();
    scanHints();
    ensureSupabase().then(function () {
      if (!window.supabase) { minimalShell(); return; }
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: 'dds-portal-auth', persistSession: true, autoRefreshToken: true } });
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
