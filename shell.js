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

  // ── Appearance: every app page ships light + dark tokens keyed on
  // :root[data-theme]; this is the ONE control that sets it. Default (no
  // choice stored) follows the device via prefers-color-scheme, exactly as
  // before — applying nothing changes nothing. Applied before boot so a saved
  // choice doesn't flash the wrong theme.
  var THEME = '';
  try { THEME = localStorage.getItem('dds-theme') || ''; } catch (_) { /* */ }
  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
  }
  applyTheme(THEME);
  function themeLabel() { return 'Appearance: ' + (THEME === 'light' ? 'Light' : THEME === 'dark' ? 'Dark' : 'System'); }
  function cycleTheme() {
    THEME = THEME === '' ? 'light' : THEME === 'light' ? 'dark' : '';
    try { THEME ? localStorage.setItem('dds-theme', THEME) : localStorage.removeItem('dds-theme'); } catch (_) { /* */ }
    applyTheme(THEME);
  }
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
  function flatten(nav) { var o = []; (nav || []).forEach(function (s) { (s.items || []).forEach(function (i) { o.push({ label: i.label, href: i.href, section: s.label, desc: i.desc || "" }); }); }); return o; }

  // ── supabase (reuse the portal session) ──
  function ensureSupabase() {
    return new Promise(function (resolve) {
      if (window.supabase) return resolve();
      var s = document.createElement('script');
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4";
      s.integrity = "sha384-GFr3yTh5lJznCbZfpTtXnwboFsxqtTQoeTZCRHhE0579KrRmlCzen5AA8ohaB5ug";
      s.crossOrigin = "anonymous";
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

  // ── THE shared API helper for app pages ──────────────────────────────────────
  // Every app page historically defines its own api() fetch wrapper (~28 copies);
  // any auth-header or error-shape change means ~28 coordinated edits. This is
  // the ONE canonical helper: same headers (incl. scope carry), same normalized
  // {ok,status,body} shape, plus method/body support. New code MUST use it;
  // existing pages migrate opportunistically after human browser QA.
  // ── Editing opens the full editor IN PLACE (same tab) ────────────────────────
  // Owner preference: when you open a page/section to edit — from the site map,
  // Today, Inbox, anywhere — the whole editor opens in the SAME TAB so you don't
  // lose your session. presence.html reads the same operator realm
  // ('dds-portal-auth'), so a same-tab navigation carries the live session — no
  // separate-window "signed out" edge case, no popup blocker to fight. Any link
  // marked [data-dds-editor] or .edit, or a deep-link into the editor
  // (/presence.html#section), routes through here.
  window.ddsOpenEditor = function (href) { location.assign(href); return true; };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank') return;
    var href = a.getAttribute('href') || '';
    var isEdit = a.hasAttribute('data-dds-editor') || a.classList.contains('edit') || /\/presence\.html#[a-z]/i.test(href);
    if (!isEdit) return;
    e.preventDefault();
    window.ddsOpenEditor(a.href);
  }, true);

  window.ddsApi = function (path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-dds-user-jwt': TOKEN, 'x-dds-scope-site': scopeId() } };
    if (opts.body !== undefined) init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    return fetch(FN + path, init)
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, status: r.status, body: b }; }).catch(function () { return { ok: r.ok, status: r.status, body: {} }; }); })
      .catch(function () { return { ok: false, status: 0, body: {} }; });
  };

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
      '<button class="dds-ic dds-burger" id="dds-burger" aria-label="Menu" aria-haspopup="true" aria-expanded="false" aria-controls="dds-drawer">☰</button>' +
      brandHtml +
      '<nav class="dds-nav" aria-label="Workspace">' + navHtml + '</nav>' +
      '<div class="dds-search" id="dds-search" role="button" tabindex="0" aria-label="Search"><span>🔍</span><span>Search</span><kbd>' + (/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl K') + '</kbd></div>' +
      '<div class="dds-right">' +
        '<button class="dds-ic" id="dds-bell" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">🔔' + (att > 0 ? '<span class="dot">' + (att > 9 ? '9+' : att) + '</span>' : '') + '</button>' +
        '<a class="dds-ic" href="/help.html" id="dds-help" aria-label="Help — how do I…?" aria-haspopup="true" aria-expanded="false">?</a>' +
        '<button class="dds-ic" id="dds-profile" aria-label="Account" aria-haspopup="true" aria-expanded="false">◐</button>' +
      '</div>';

    wire(nav);
    mountMobileBar(nav, activeKey, att);
  }

  // ── mobile bottom bar (≤760px): the daily loop in one tap — Today · Inbox ·
  //    Menu. presence.html keeps its own dock, so we stay out of its way. ──
  function mountMobileBar(nav, activeKey, att) {
    if (location.pathname.indexOf('/presence') === 0) return;
    var isReviewer = (CTX && CTX.site_role === 'client_reviewer') || (CTX && CTX.is_managed_client);
    var old = document.getElementById('dds-mbar'); if (old) old.remove();
    var bar = document.createElement('nav');
    bar.id = 'dds-mbar'; bar.setAttribute('aria-label', 'Quick navigation');
    var home = isReviewer ? { href: '/client.html', label: 'Updates' } : { href: (CTX && CTX.landing) || '/today.html', label: 'Home' };
    var inbox = isReviewer ? null : { href: '/inbox.html', label: 'Inbox' };
    var herePath = normalizePath(location.pathname);
    var cur = function (href) { return normalizePath(href) === herePath ? ' aria-current="page"' : ''; };
    bar.innerHTML =
      '<a href="' + esc(withScope(home.href)) + '"' + cur(home.href) + '>' + esc(home.label) + '</a>' +
      (inbox ? '<a href="' + esc(withScope(inbox.href)) + '"' + cur(inbox.href) + '>' + esc(inbox.label) + (att > 0 ? ' <span class="mdot">' + (att > 9 ? '9+' : att) + '</span>' : '') + '</a>' : '') +
      '<button type="button" id="dds-mbar-menu" aria-expanded="false" aria-controls="dds-drawer" aria-haspopup="true">Menu</button>';
    document.body.appendChild(bar);
    var mb = document.getElementById('dds-mbar-menu');
    if (mb) mb.addEventListener('click', function (e) {
      e.stopPropagation(); toggleDrawer(nav);
      var open = drawer && drawer.classList.contains('open');
      mb.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
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
    // in-app help (HELP-1): the "?" opens a grounded "how do I…?" panel; the href
    // stays a real fallback to the full Help page if JS is off.
    var helpTrig = document.getElementById('dds-help');
    if (helpTrig) helpTrig.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleHelp(); });
    // burger
    document.getElementById('dds-burger').addEventListener('click', function (e) { e.stopPropagation(); toggleDrawer(nav); });
  }
  function closeMenus() { root.querySelectorAll('.dds-nav .sec.open').forEach(function (s) { s.classList.remove('open'); }); }

  // ── command palette ──
  var pal;
  function openPalette() {
    if (!pal) {
      pal = el('<div class="dds-palette"><div class="box" role="dialog" aria-modal="true" aria-label="Search Studio OS"><input placeholder="Search Studio OS…" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="dds-pal-list" aria-autocomplete="list"><div class="results" id="dds-pal-list" role="listbox" aria-label="Results"></div></div></div>');
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
          all.forEach(function (r) { r.classList.remove('sel'); r.setAttribute('aria-selected', 'false'); });
          var pick = all[i < 0 ? 0 : i]; pick.classList.add('sel'); pick.setAttribute('aria-selected', 'true');
          e.target.setAttribute('aria-activedescendant', pick.id);
          if (pick.scrollIntoView) pick.scrollIntoView({ block: 'nearest' });
        }
      });
    }
    pal.classList.add('open'); var inp = pal.querySelector('input'); inp.value = ''; paintResults(''); setTimeout(function () { inp.focus(); }, 20);
  }
  function closePalette() {
    if (!pal || !pal.classList.contains('open')) return;
    pal.classList.remove('open');
    // return focus to the control that opened it (same pattern as bell/profile)
    var s = document.getElementById('dds-search'); if (s) s.focus();
  }
  function hasFiles() { return (CTX && CTX.nav || []).some(function (s) { return s.key === 'files'; }); }
  var fileSearchTok = 0;
  function paintResults(q) {
    var qq = String(q || '').trim().toLowerCase();
    var list = qq ? DESTS.filter(function (d) { return d.label.toLowerCase().indexOf(qq) >= 0 || d.section.toLowerCase().indexOf(qq) >= 0 || (d.desc && d.desc.toLowerCase().indexOf(qq) >= 0); }) : DESTS;
    var box = pal.querySelector('.results');
    var navHtml = list.map(function (d, i) { return '<a class="res' + (i === 0 ? ' sel' : '') + '" id="dds-res-' + i + '" role="option" aria-selected="' + (i === 0 ? 'true' : 'false') + '" href="' + esc(withScope(d.href)) + '">' + esc(d.label) + '<span class="s">' + esc(d.section) + '</span></a>'; }).join('');
    box.innerHTML = navHtml || (qq ? '' : '');
    var inp0 = pal.querySelector('input'); if (inp0) inp0.setAttribute('aria-activedescendant', navHtml ? 'dds-res-0' : '');
    // ── Files: search actual files by name/tag/description (reuses GET /assets?q=) ──
    var tok = ++fileSearchTok;
    if (qq.length >= 2 && hasFiles()) {
      api('/assets?q=' + encodeURIComponent(qq) + '&limit=6').then(function (r) {
        if (tok !== fileSearchTok) return; // a newer keystroke won
        var files = (r.ok && r.body && r.body.data && r.body.data.assets) || [];
        var cur = pal.querySelector('.results'); if (!cur) return;
        var have = !!navHtml;
        if (!files.length) { if (!have) cur.innerHTML = '<div class="none">Nothing matches “' + esc(q) + '”.</div>'; return; }
        // file rows join the SAME listbox contract as nav rows (role=option +
        // id + aria-selected) — arrowing onto one must announce, not go silent.
        var base = (navHtml.match(/id="dds-res-/g) || []).length;
        var fhtml = files.map(function (a, i) {
          var sub = a.in_use ? 'Files · on your site' : 'Files';
          var sel = !have && i === 0;
          return '<a class="res' + (sel ? ' sel' : '') + '" id="dds-res-' + (base + i) + '" role="option" aria-selected="' + (sel ? 'true' : 'false') + '" href="' + esc(withScope('/files.html?focus=' + a.id)) + '">' + esc(a.name || 'File') + '<span class="s">' + esc(sub) + '</span></a>';
        }).join('');
        cur.innerHTML = navHtml + fhtml;
        var inpF = pal.querySelector('input'); var firstSel = cur.querySelector('.res.sel');
        if (inpF) inpF.setAttribute('aria-activedescendant', firstSel ? firstSel.id : '');
      });
    } else if (!list.length) {
      box.innerHTML = '<div class="none">Nothing matches “' + esc(q) + '”.</div>';
    }
  }

  // ── notifications (lazy; reuses /portal/feed — no new system) ──
  var notif;
  function setExpanded(id, open) { var b = document.getElementById(id); if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false'); }
  function toggleNotifications() {
    closeProfile();
    if (notif && notif.classList.contains('open')) { notif.classList.remove('open'); setExpanded('dds-bell', false); return; }
    if (!notif) { notif = el('<div class="dds-pop" role="region" aria-label="Notifications"><h4>Needs a look</h4><div class="body"><div class="muted">Loading…</div></div></div>'); document.body.appendChild(notif); notif.addEventListener('click', function (e) { e.stopPropagation(); }); }
    notif.classList.add('open');
    setExpanded('dds-bell', true);
    api('/portal/feed').then(function (r) {
      var body = notif.querySelector('.body');
      if (!r.ok) { body.innerHTML = '<div class="muted">You’re all caught up.</div>'; return; }
      var d = r.body.data || {}; var out = '';
      // A reviewer's whole world is client.html — every bell row lands THERE
      // (the owner pages these rows normally target are 403 walls for them).
      var revr = (CTX && CTX.site_role === 'client_reviewer') || (CTX && CTX.is_managed_client);
      // Phase FLOW: notices first (a lead waiting, a domain expiring) — each taps
      // straight through to the page that resolves it, from any screen.
      (d.notices || []).forEach(function (n) { out += '<a class="row" href="' + esc(revr ? '/client.html' : withScope(n.href || '/today.html')) + '"><b>' + esc(n.headline || 'Needs a look') + '</b>' + (n.body ? '<div class="sub">' + esc(n.body) + '</div>' : '') + '</a>'; });
      // An approval tap lands on the thing that RESOLVES it (file → Files,
      // connected → Connections, infra → the Foundations desk) — never a generic landing.
      (d.pending_approvals || []).forEach(function (p) {
        var target = revr ? '/client.html' : (p.href ? p.href : p.kind === 'connected' ? '/connections.html' : p.kind === 'file' ? '/files.html' : '/presence.html#foundations');
        out += '<a class="row" href="' + esc(revr ? target : withScope(target)) + '"><b>Waiting for approval</b><div class="sub">' + esc(p.title || 'A change is ready') + '</div></a>';
      });
      (d.moments || []).slice(0, 4).forEach(function (m) { out += '<a class="row" href="' + esc(revr ? '/client.html' : withScope('/today.html')) + '">' + esc(m.headline || 'A moment') + (m.summary ? '<div class="sub">' + esc(m.summary) + '</div>' : '') + '</a>'; });
      // W4: the bell is the quick glance; the Inbox is the complete "everything that
      // needs you" (also client messages, surveys, new leads). Send them to the one
      // place rather than have two surfaces compete. A client's "one place" is their
      // updates page — never the owner Inbox.
      var isReviewer = (CTX && CTX.site_role === 'client_reviewer') || (CTX && CTX.is_managed_client);
      var footer = isReviewer
        ? '<a class="row" href="/client.html" style="text-align:center;font-weight:600;color:var(--dds-accent,#5b3fa0)">See all your updates →</a>'
        : '<a class="row" href="' + esc(withScope('/inbox.html')) + '" style="text-align:center;font-weight:600;color:var(--dds-accent,#5b3fa0)">See everything in your Inbox →</a>';
      body.innerHTML = (out || '<div class="muted">You’re all caught up.</div>') + footer;
    });
  }
  function closeNotifications() { if (notif) notif.classList.remove('open'); setExpanded('dds-bell', false); }

  // ── in-app "how do I…?" helper (HELP-1) ─────────────────────────────────────
  // A grounded product-help panel: type a question, the server (/help/ask) matches
  // it to a curated answer with a deep link straight to the right screen. Deterministic
  // and honest — no invented features; the full Help page is always one tap away.
  // Distinct from the site-aware Concierge; this is help ABOUT the product.
  var help, helpTok = 0;
  var HELP_IN = 'width:100%;box-sizing:border-box;margin:8px 0;padding:8px 10px;border:1px solid var(--dds-line,#e5e5e5);border-radius:9px;font:inherit;font-size:14px;background:var(--dds-card,#fff);color:inherit';
  var HELP_CHIP = 'font:inherit;font-size:12.5px;margin:3px 4px 0 0;padding:4px 11px;border-radius:999px;border:1px solid var(--dds-line,#ddd);background:transparent;color:inherit;cursor:pointer';
  var HELP_LINK = 'display:inline-block;margin:6px 8px 0 0;font-weight:600;font-size:13px;color:var(--dds-accent,#5b3fa0);text-decoration:none';
  function toggleHelp() {
    closeNotifications(); closeProfile();
    if (help && help.classList.contains('open')) { closeHelp(); return; }
    if (!help) {
      help = el('<div class="dds-pop" role="region" aria-label="Help — how do I…?"><h4>How do I…?</h4>' +
        '<input id="dds-help-q" type="text" placeholder="Ask a question — e.g. change my hours" aria-label="Ask a how-to question" autocomplete="off" style="' + HELP_IN + '">' +
        '<div class="body" id="dds-help-body"></div>' +
        '<a class="row" href="/help.html" style="text-align:center;font-weight:600;color:var(--dds-accent,#5b3fa0)">Open full Help →</a></div>');
      document.body.appendChild(help);
      help.addEventListener('click', function (e) { e.stopPropagation(); });
      var inp = help.querySelector('#dds-help-q'); var deb;
      inp.addEventListener('input', function () { clearTimeout(deb); var v = inp.value; deb = setTimeout(function () { askHelp(v); }, 250); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(deb); askHelp(inp.value); } else if (e.key === 'Escape') { closeHelp(); var t = document.getElementById('dds-help'); if (t) t.focus(); } });
    }
    help.classList.add('open'); setExpanded('dds-help', true);
    helpSuggest();
    setTimeout(function () { var i = help.querySelector('#dds-help-q'); if (i) i.focus(); }, 20);
  }
  function closeHelp() { if (help) help.classList.remove('open'); setExpanded('dds-help', false); }
  function helpSuggest() {
    var body = help.querySelector('#dds-help-body');
    var qs = ['Change my hours', 'Publish my changes', 'Set up booking', 'Send a broadcast', 'Connect a service'];
    body.innerHTML = '<div class="muted" style="font-size:12px;margin-bottom:2px">Popular questions</div>' +
      qs.map(function (q) { return '<button type="button" class="dds-help-chip" style="' + HELP_CHIP + '">' + esc(q) + '</button>'; }).join('');
    Array.prototype.forEach.call(body.querySelectorAll('.dds-help-chip'), function (b) {
      b.addEventListener('click', function () { var i = help.querySelector('#dds-help-q'); i.value = b.textContent; askHelp(b.textContent); });
    });
  }
  function askHelp(q) {
    q = String(q || '').trim();
    var body = help.querySelector('#dds-help-body');
    if (q.length < 2) { helpSuggest(); return; }
    var tok = ++helpTok;
    body.innerHTML = '<div class="muted" style="font-size:12px">Looking…</div>';
    window.ddsApi('/help/ask', { method: 'POST', body: { question: q } }).then(function (r) {
      if (tok !== helpTok) return;
      var d = (r && r.body && r.body.data) || {};
      var links = (d.links || []).map(function (l) {
        var href = String(l.href || '');
        return '<a style="' + HELP_LINK + '" href="' + esc(href.charAt(0) === '/' ? withScope(href) : href) + '">' + esc(l.label) + ' →</a>';
      }).join('');
      body.innerHTML = '<div style="font-size:13.5px;line-height:1.55">' + esc(d.answer || 'Open the full Help below for more.') + '</div>' +
        (links ? '<div style="margin-top:4px">' + links + '</div>' : '');
    }).catch(function () {
      if (tok !== helpTok) return;
      body.innerHTML = '<div style="font-size:13.5px;line-height:1.55">Couldn’t reach help just now — open the full Help below.</div>';
    });
  }

  // ── profile / context menu (role, edition, agency, sign out) ──
  var prof;
  function toggleProfile() {
    closeNotifications();
    if (prof && prof.classList.contains('open')) { prof.classList.remove('open'); setExpanded('dds-profile', false); return; }
    if (!prof) { prof = el('<div class="dds-pop" role="region" aria-label="Account menu"></div>'); document.body.appendChild(prof); prof.addEventListener('click', function (e) { e.stopPropagation(); }); }
    setExpanded('dds-profile', true);
    var email = (sb && sb.__email) || 'Signed in';
    var role = (CTX && CTX.site_role) || '';
    var edition = (CTX && CTX.edition) || '';
    var rows = '';
    if (CTX && CTX.is_agency) rows += '<a class="row" href="/agency.html">Studio</a>';
    // Architecture v1.0: utility destinations (Connections, Settings, Help) live here.
    // Multi-item groups get a quiet header so a long menu stays scannable.
    UTILS.forEach(function (sec) {
      if (sec.items.length > 1) rows += '<div style="padding:8px 14px 2px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--dds-soft,#8a8198)">' + esc(sec.label) + '</div>';
      sec.items.forEach(function (i) { rows += '<a class="row" href="' + esc(withScope(i.href)) + '">' + esc(i.label) + (i.desc ? '<span class="sub">' + esc(i.desc) + '</span>' : '') + '</a>'; });
    });
    // Notifications toggle (Web Push) — reviewers don't get it (their world is
    // one calm page). Label reflects current permission/subscription state.
    if (!isReviewerCtx() && 'serviceWorker' in navigator && 'PushManager' in window) {
      rows += '<a class="row" href="#" id="dds-notif-toggle">' + (pushOn ? 'Turn off notifications' : 'Turn on notifications') + '</a>';
    }
    // Light / Dark / System — the styling for both themes has always shipped;
    // this row makes the choice reachable (clients get it too — it's their eyes).
    rows += '<a class="row" href="#" id="dds-theme-toggle">' + esc(themeLabel()) + '</a>';
    // Re-take the first-login tour any time (it marks itself seen on finish/skip)
    if (tourAvailable()) rows += '<a class="row" href="#" id="dds-tour-again">Show me around</a>';
    rows += '<a class="row" href="mailto:support@davisdigitalstudio.com">Support</a>';
    rows += '<a class="row" href="#" id="dds-signout">Sign out</a>';
    prof.innerHTML = '<div class="who"><div class="n">' + esc(email) + '</div><div class="r">' + esc([role.replace(/_/g, ' '), edition].filter(Boolean).join(' · ')) + '</div></div>' + rows;
    prof.classList.add('open');
    var nt = document.getElementById('dds-notif-toggle');
    if (nt) nt.addEventListener('click', function (e) { e.preventDefault(); togglePush(); });
    var th = document.getElementById('dds-theme-toggle');
    if (th) th.addEventListener('click', function (e) { e.preventDefault(); cycleTheme(); th.textContent = themeLabel(); });
    var ta = document.getElementById('dds-tour-again');
    if (ta) ta.addEventListener('click', function (e) { e.preventDefault(); var op = document.getElementById('dds-profile'); closeProfile(); try { startTour(op); } catch (_) { /* */ } });
    var so = document.getElementById('dds-signout');
    // Sign out to the RIGHT door: clients back to the client door, everyone else
    // (owners, team, agency) to the Studio OS door.
    var door = ((CTX && CTX.site_role === 'client_reviewer') || (CTX && CTX.is_managed_client)) ? '/portal.html' : '/studio.html';
    if (so) so.addEventListener('click', function (e) { e.preventDefault(); if (sb) sb.auth.signOut().then(function () { location.href = door; }); else location.href = door; });
  }
  function closeProfile() { if (prof) prof.classList.remove('open'); setExpanded('dds-profile', false); }
  document.addEventListener('click', function () { closeNotifications(); closeProfile(); closeHelp(); });
  // Escape closes whatever shell popover is open (WCAG 1.4.13) and returns
  // focus to its trigger so a keyboard user isn't stranded.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (notif && notif.classList.contains('open')) { closeNotifications(); var b1 = document.getElementById('dds-bell'); if (b1) b1.focus(); }
    if (prof && prof.classList.contains('open')) { closeProfile(); var b2 = document.getElementById('dds-profile'); if (b2) b2.focus(); }
    if (help && help.classList.contains('open')) { closeHelp(); var b3 = document.getElementById('dds-help'); if (b3) b3.focus(); }
  });

  // ── Web Push opt-in (notifications when the app is closed) ──────────────────
  var pushOn = false;
  function isReviewerCtx() { return (CTX && CTX.site_role === 'client_reviewer') || (CTX && CTX.is_managed_client); }
  function urlB64ToU8(s) { var pad = '='.repeat((4 - s.length % 4) % 4); var b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); var u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function refreshPushState() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.ready) return;
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (s) { pushOn = !!s; }).catch(function () { pushOn = false; });
  }
  function togglePush() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (existing) {
        if (existing) {
          // turn OFF
          var ep = existing.endpoint;
          return existing.unsubscribe().then(function () {
            pushOn = false;
            return fetch(FN + '/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-dds-user-jwt': TOKEN }, body: JSON.stringify({ endpoint: ep }) }).then(function () { window.ddsToast && window.ddsToast('Notifications turned off'); closeProfile(); });
          });
        }
        // turn ON — fetch the VAPID key, request permission, subscribe, save.
        return fetch(FN + '/push/key', { headers: { 'Authorization': 'Bearer ' + SUPABASE_KEY, 'apikey': SUPABASE_KEY } })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            var key = j && j.data && j.data.key;
            if (!j || !j.data || !j.data.enabled || !key) { window.ddsToast && window.ddsToast('Notifications aren’t switched on yet.', 'err'); return; }
            return Notification.requestPermission().then(function (perm) {
              if (perm !== 'granted') { window.ddsToast && window.ddsToast('Notifications need permission — allow them in your browser.', 'err'); return; }
              return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(key) }).then(function (sub) {
                var j2 = sub.toJSON();
                return fetch(FN + '/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-dds-user-jwt': TOKEN }, body: JSON.stringify({ endpoint: j2.endpoint, keys: j2.keys }) })
                  .then(function () { pushOn = true; window.ddsToast && window.ddsToast('Notifications on — we’ll ping you when something needs you.'); closeProfile(); });
              });
            });
          });
      });
    }).catch(function () { window.ddsToast && window.ddsToast('Couldn’t change notifications just now.', 'err'); });
  }

  // ── mobile drawer ──
  var drawer;
  function closeDrawer() {
    if (drawer && drawer.classList.contains('open')) {
      drawer.classList.remove('open');
      setExpanded('dds-burger', false); setExpanded('dds-mbar-menu', false);
    }
  }
  // Escape closes the drawer and returns focus to the burger (WCAG 1.4.13)
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !drawer || !drawer.classList.contains('open')) return;
    closeDrawer(); var b = document.getElementById('dds-burger'); if (b) b.focus();
  });
  function toggleDrawer(nav) {
    if (drawer && drawer.classList.contains('open')) { closeDrawer(); return; }
    var activeKey = activeItemKey(location.pathname, nav);
    var html = (nav || []).map(function (s) {
      return '<div class="g"><p class="t">' + esc(s.label) + '</p>' + s.items.map(function (i) { return '<a href="' + esc(withScope(i.href)) + '" class="' + (i.key === activeKey ? 'here' : '') + '">' + esc(i.label) + '</a>'; }).join('') + '</div>';
    }).join('');
    if (!drawer) { drawer = el('<div class="dds-drawer" id="dds-drawer" role="navigation" aria-label="Workspace menu"></div>'); document.body.appendChild(drawer); }
    drawer.innerHTML = html; drawer.classList.add('open');
    setExpanded('dds-burger', true); setExpanded('dds-mbar-menu', true);
  }

  // ── SC-1 (global): carry the agency drill-in scope on EVERY static app link ──
  // Nav/bell/palette links already scope via withScope(); this covers the page-
  // authored anchors ("← Back to Today", empty-state CTAs, rail exits) that were
  // the one systematic leak — a scoped operator must never silently switch
  // tenants by tapping a hardcoded exit.
  var APP_PAGES = /^\/(today|presence|crm|contacts|pipeline|leads|projects|inbox|files|visual-studio|analytics|schedule|connections|sharing|attention|approval-center|timeline|upcoming|business-insights|content-tree|snapshot-history|website-health)\.html/;
  function carryScopeGlobally() {
    var s = scopeId(); if (!s) return;
    document.querySelectorAll('a[href^="/"]').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      if (!APP_PAGES.test(h) || h.indexOf('client=') >= 0) return;
      a.setAttribute('href', withScope(h));
    });
  }
  document.addEventListener('DOMContentLoaded', carryScopeGlobally);
  // re-apply after page re-renders (delegated, cheap, debounced by rAF)
  (function () {
    var pend = false;
    var mo2 = (typeof MutationObserver !== 'undefined') ? new MutationObserver(function () {
      if (pend || !scopeId()) return; pend = true;
      (window.requestAnimationFrame || setTimeout)(function () { pend = false; carryScopeGlobally(); });
    }) : null;
    if (mo2) document.addEventListener('DOMContentLoaded', function () { if (document.body) mo2.observe(document.body, { childList: true, subtree: true }); });
  })();

  // ── boot ──
  // Make every signed-in page installable as the "Studio OS" app — inject the
  // workspace manifest + iOS install meta into <head> centrally (the public site
  // keeps its own manifest; these tags only exist on shelled pages).
  function ensureInstallable() {
    try {
      var head = document.head; if (!head) return;
      if (!head.querySelector('link[rel="manifest"][href="/manifest-app.json"]')) {
        // replace any existing (public-site) manifest link so the app identity wins
        var old = head.querySelector('link[rel="manifest"]'); if (old) old.remove();
        var m = document.createElement('link'); m.rel = 'manifest'; m.href = '/manifest-app.json'; head.appendChild(m);
      }
      var add = function (sel, make) { if (!head.querySelector(sel)) head.appendChild(make()); };
      add('link[rel="apple-touch-icon"]', function () { var l = document.createElement('link'); l.rel = 'apple-touch-icon'; l.href = '/icon-192.png'; return l; });
      add('meta[name="apple-mobile-web-app-capable"]', function () { var t = document.createElement('meta'); t.name = 'apple-mobile-web-app-capable'; t.content = 'yes'; return t; });
      add('meta[name="apple-mobile-web-app-title"]', function () { var t = document.createElement('meta'); t.name = 'apple-mobile-web-app-title'; t.content = 'Studio OS'; return t; });
      add('meta[name="mobile-web-app-capable"]', function () { var t = document.createElement('meta'); t.name = 'mobile-web-app-capable'; t.content = 'yes'; return t; });
      if (!head.querySelector('meta[name="theme-color"]')) { var tc = document.createElement('meta'); tc.name = 'theme-color'; tc.content = '#5b3fa0'; head.appendChild(tc); }
    } catch (_) { /* best-effort */ }
  }

  function mountFrame() {
    ensureInstallable();
    root = document.getElementById('dds-shell');
    if (!root) { root = document.createElement('div'); root.id = 'dds-shell'; document.body.insertBefore(root, document.body.firstChild); }
    document.documentElement.classList.add('dds-has-shell');
    // A11y (central): give EVERY shelled page a skip link + a main landmark
    // without editing each one. The page's primary container is #main on most
    // pages; fall back to .wrap or a real <main>. role=main is the ARIA landmark
    // screen-reader users jump to; the skip link is the first focusable element.
    try {
      var mainEl = document.getElementById('main') || document.querySelector('main') || document.querySelector('.wrap');
      if (mainEl) {
        if (mainEl.tagName !== 'MAIN' && !mainEl.getAttribute('role')) mainEl.setAttribute('role', 'main');
        if (!mainEl.id) mainEl.id = 'dds-main-target';
        if (!mainEl.hasAttribute('tabindex')) mainEl.setAttribute('tabindex', '-1');
        if (!document.getElementById('dds-skip')) {
          var skip = el('<a id="dds-skip" href="#' + mainEl.id + '" class="dds-skip">Skip to content</a>');
          document.body.insertBefore(skip, document.body.firstChild);
        }
      }
    } catch (_) { /* a11y enhancement is best-effort */ }
  }
  function minimalShell() {
    root.innerHTML = '<a class="dds-brand" href="/"><span class="mark">P</span>Studio OS</a><div style="flex:1"></div><a class="dds-ic" href="/help.html" aria-label="Help">?</a><a class="dds-ic" href="/studio.html" aria-label="Sign in">◐</a>';
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

  // ── First-login tour: a short walk around the chrome, once per role ─────────
  // PT-5 hints teach page-by-page; nothing TOURED the chrome on first arrival.
  // Trigger: after /portal/context loads, if 'dds-toured:<role>' is absent and
  // this isn't the setup wizard (get-started stays single-purpose). Every step
  // points at the REAL element; a step whose target isn't on screen (the desktop
  // nav on a phone) falls back to its mobile-bar equivalent or is skipped.
  // Finish OR skip marks it seen — it never nags. Re-runnable from the profile
  // menu ("Show me around"). Every entry point is wrapped: a tour bug must
  // never break the shell.
  var tour = null; // { steps, i, ring, card, opener }
  function tourKey() { return 'dds-toured:' + ((CTX && CTX.site_role) || 'member'); }
  function tourSeen() { try { return !!localStorage.getItem(tourKey()); } catch (_) { return true; } }
  function tourMark() { try { localStorage.setItem(tourKey(), '1'); } catch (_) { /* */ } }
  function tourStepList() {
    if (isReviewerCtx()) {
      // a reviewer's whole world is client.html — tour it there, nowhere else
      if (normalizePath(location.pathname) !== '/client') return [];
      return [
        { sel: ['#main'], title: 'Your updates', text: 'Everything your studio shares with you lands on this one page — updates, files, and anything waiting for your OK.' },
        { sel: ['.card.approve'], title: 'Your OK matters', text: 'When something is ready for you, it appears as a card like this. Approve it or ask for changes — nothing happens without you.' },
        { sel: ['#dds-bell'], title: 'The bell', text: 'When something new arrives, the bell will let you know. Quiet means you’re all caught up.' }
      ];
    }
    return [
      { sel: ['.dds-nav .sec > button[data-href^="/today"]', '#dds-mbar a[href^="/today"]'], title: 'Today', text: 'This is Today — the one page that tells you what’s changed and what needs you. Nothing here is urgent by surprise.' },
      { sel: ['.dds-nav .sec > button[data-sec="website"]', '#dds-mbar-menu'], title: 'Your website', text: 'Everything about your website lives in this group — edit pages, update business info, and publish. Nothing goes live without your OK.', mtext: 'On a phone, Menu holds the rest — your Website (edit and publish) and your Customers live in there. Nothing goes live without your OK.' },
      { sel: ['.dds-nav .sec > button[data-sec="customers"]'], title: 'Customers', text: 'Enquiries, contacts, and your pipeline — the people side of your business, all in one place.' },
      { sel: ['#dds-bell'], title: 'The bell', text: 'The bell gathers what needs you — approvals, new enquiries, anything worth a look. Quiet means you’re all caught up.' },
      { sel: ['#dds-profile'], title: 'Your account', text: 'Notifications, light or dark appearance, settings, and help live here — and you can take this tour again any time.' }
    ];
  }
  // resolve a step to a VISIBLE element (selectors in order; later = fallback)
  function tourFind(step) {
    for (var i = 0; i < step.sel.length; i++) {
      var els = document.querySelectorAll(step.sel[i]);
      for (var j = 0; j < els.length; j++) { if (els[j].getClientRects().length) return { el: els[j], fb: i > 0 }; }
    }
    return null;
  }
  function tourAvailable() {
    try {
      if (normalizePath(location.pathname) === '/get-started') return false;
      var steps = tourStepList();
      for (var i = 0; i < steps.length; i++) if (tourFind(steps[i])) return true;
    } catch (_) { /* */ }
    return false;
  }
  // position ring + card to the CURRENT step's live element (re-resolved every
  // time — mountFrame/pages re-render via innerHTML, so cached nodes go stale)
  function tourPlace() {
    if (!tour) return;
    var found = tourFind(tour.steps[tour.i]); if (!found) return;
    var r = found.el.getBoundingClientRect(), pad = 6;
    var rs = tour.ring.style;
    rs.top = (r.top - pad) + 'px'; rs.left = (r.left - pad) + 'px';
    rs.width = (r.width + pad * 2) + 'px'; rs.height = (r.height + pad * 2) + 'px';
    var c = tour.card, vw = window.innerWidth, vh = window.innerHeight;
    var cw = c.offsetWidth || 320, ch = c.offsetHeight || 160;
    var top = r.bottom + pad + 12;                                   // below the ring…
    if (top + ch > vh - 12) top = Math.max(12, r.top - pad - 12 - ch); // …or above if no room
    var left = Math.min(Math.max(12, r.left), Math.max(8, vw - cw - 12));
    c.style.top = top + 'px'; c.style.left = left + 'px';
  }
  function tourShow(i) {
    if (!tour) return;
    var dir = i >= tour.i ? 1 : -1, idx = i, found = null;
    // a target can leave the page between steps — keep skipping in the travel direction
    while (idx >= 0 && idx < tour.steps.length && !(found = tourFind(tour.steps[idx]))) idx += dir;
    if (!found) { endTour(true); return; }
    tour.i = idx;
    var step = tour.steps[idx], last = idx === tour.steps.length - 1;
    tour.card.setAttribute('aria-label', step.title + ' — step ' + (idx + 1) + ' of ' + tour.steps.length);
    tour.card.querySelector('#dds-tour-t').textContent = step.title;
    tour.card.querySelector('#dds-tour-p').textContent = (found.fb && step.mtext) ? step.mtext : step.text;
    var dots = ''; for (var d = 0; d < tour.steps.length; d++) dots += '<span class="' + (d === idx ? 'on' : '') + '"></span>';
    tour.card.querySelector('.dots').innerHTML = dots;
    var back = tour.card.querySelector('.back');
    back.style.display = idx === 0 ? 'none' : '';
    tour.card.querySelector('.next').textContent = last ? 'Done' : 'Next';
    tour.ring.classList.add('open'); tour.card.classList.add('open');
    // bring an off-screen target into view first (approve cards live mid-page)
    var r = found.el.getBoundingClientRect();
    if (r.top < 60 || r.bottom > window.innerHeight - 40) { try { found.el.scrollIntoView({ block: 'center' }); } catch (_) { try { found.el.scrollIntoView(); } catch (__) { /* */ } } }
    tourPlace();
    // Back just vanished under the focused finger — keep focus inside the card
    if (idx === 0 && document.activeElement === back) tour.card.querySelector('.next').focus();
  }
  function startTour(opener) {
    if (tour) return;
    var steps = [], all = tourStepList();
    for (var i = 0; i < all.length; i++) if (tourFind(all[i])) steps.push(all[i]); // only steps whose target is really on screen
    if (!steps.length) return;
    var ring = el('<div class="dds-tour-ring" aria-hidden="true"></div>');
    // role=dialog + aria-modal + display:none-when-closed → the shell's shared
    // focus trap handles Tab; Escape (below) skips.
    var card = el('<div class="dds-tour-card" role="dialog" aria-modal="true" aria-describedby="dds-tour-p" tabindex="-1">' +
      '<h3 id="dds-tour-t"></h3><p id="dds-tour-p"></p><div class="dots" aria-hidden="true"></div>' +
      '<div class="btns"><button type="button" class="skip">Skip the tour</button><span class="grow"></span>' +
      '<button type="button" class="back">Back</button><button type="button" class="next">Next</button></div></div>');
    document.body.appendChild(ring); document.body.appendChild(card);
    tour = { steps: steps, i: 0, ring: ring, card: card, opener: opener || null };
    card.querySelector('.skip').addEventListener('click', function () { endTour(true); });
    card.querySelector('.back').addEventListener('click', function () { try { tourShow(tour ? tour.i - 1 : 0); } catch (_) { endTour(true); } });
    card.querySelector('.next').addEventListener('click', function () {
      try { if (tour && tour.i >= tour.steps.length - 1) endTour(true); else tourShow(tour.i + 1); } catch (_) { endTour(true); }
    });
    tourShow(0);
    try { card.focus(); } catch (_) { /* */ }
  }
  function endTour(mark) {
    if (!tour) return;
    if (mark) tourMark();                       // finish OR skip — never nag again
    var op = tour.opener;
    tour.ring.remove(); tour.card.remove(); tour = null;
    if (op && op.focus) { try { op.focus(); } catch (_) { /* */ } }
  }
  function maybeTour() {
    if (tourSeen()) return;
    if (normalizePath(location.pathname) === '/get-started') return; // never stack onto the setup wizard
    // small pause: let the page paint so the tour arrives calm, not mid-load
    setTimeout(function () { try { if (!tour && !tourSeen()) startTour(); } catch (_) { /* */ } }, 600);
  }
  window.ddsTour = function () { try { startTour(); } catch (_) { /* */ } };
  // Escape = skip (capture: the tour is the front-most layer while it's open)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && tour) { e.stopPropagation(); endTour(true); }
  }, true);
  // the page scrolls/resizes under the tour — follow the target
  var tourRz;
  window.addEventListener('resize', function () { if (!tour) return; clearTimeout(tourRz); tourRz = setTimeout(function () { try { tourPlace(); } catch (_) { /* */ } }, 120); });
  var tourScrollPend = false;
  window.addEventListener('scroll', function () {
    if (!tour || tourScrollPend) return; tourScrollPend = true;
    (window.requestAnimationFrame || setTimeout)(function () { tourScrollPend = false; try { tourPlace(); } catch (_) { /* */ } });
  }, true);

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

  // ── Offline awareness (B-5): a save that silently dies mid-edit is data loss
  // to a non-technical owner. One central banner: appears offline, retracts on
  // reconnect with a toast. Pages need nothing — fetch failures already surface
  // their own errors; this explains WHY.
  var offBanner;
  function setOffline(off) {
    if (off) {
      if (!offBanner) {
        offBanner = el('<div id="dds-offline" role="alert" style="position:fixed;top:var(--dds-shell-h,54px);left:0;right:0;z-index:2147483003;background:#8a6d3b;color:#fff;font-family:var(--dds-sans,sans-serif);font-size:13px;font-weight:600;text-align:center;padding:8px 14px">You’re offline — changes can’t save until the connection returns. Keep this tab open.</div>');
        document.body.appendChild(offBanner);
      }
      offBanner.style.display = 'block';
    } else if (offBanner && offBanner.style.display !== 'none') {
      offBanner.style.display = 'none';
      if (window.ddsToast) window.ddsToast('Back online.');
    }
  }
  window.addEventListener('offline', function () { setOffline(true); });
  window.addEventListener('online', function () { setOffline(false); });
  if (typeof navigator !== 'undefined' && navigator.onLine === false) setOffline(true);

  // ── Draft preservation (opt-in): long-form fields marked data-dds-draft keep
  // a local draft (this browser only), restored while the field is empty and
  // cleared by the page via window.ddsDraftClear(el) after a successful send.
  document.addEventListener('input', function (e) {
    var f = e.target;
    if (!f || !f.hasAttribute || !f.hasAttribute('data-dds-draft')) return;
    var key = 'dds-draft:' + location.pathname + ':' + (f.id || f.getAttribute('data-dds-draft'));
    try { f.value ? localStorage.setItem(key, f.value) : localStorage.removeItem(key); } catch (_) { /* */ }
  });
  window.ddsDraftRestore = function (f) {
    if (!f || f.value) return;
    var key = 'dds-draft:' + location.pathname + ':' + (f.id || f.getAttribute('data-dds-draft'));
    try { var v = localStorage.getItem(key); if (v) f.value = v; } catch (_) { /* */ }
  };
  window.ddsDraftClear = function (f) {
    if (!f) return;
    var key = 'dds-draft:' + location.pathname + ':' + (f.id || f.getAttribute('data-dds-draft'));
    try { localStorage.removeItem(key); } catch (_) { /* */ }
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
          // PERF: /portal/context is the single most expensive boot read (~17
          // queries incl. 3× auth). The shell already fetched it — publish it so
          // a page can reuse it instead of firing an identical second request.
          try { window.__ddsContext = CTX; document.dispatchEvent(new CustomEvent('dds:context', { detail: CTX })); } catch (_) { /* */ }
          try { maybeTour(); } catch (_) { /* the tour must never break the shell */ }
        });
      }).catch(minimalShell);
    });
  }
  // Register the service worker on app pages too — this is what makes the
  // workspace installable (manifest + SW) and enables push. sw.js already
  // excludes every app/token page from stale caching, so registration is safe.
  if ('serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('/sw.js').then(function () { refreshPushState(); }).catch(function () {}); } catch (_) { /* */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

/* ── A11y enhancer (shared) ───────────────────────────────────────────────────
   The single most common a11y defect across the app is a clickable <div>/<span>/
   <tr> with an onclick but no keyboard support. This makes every such element
   keyboard-operable (role=button + tabindex + Enter/Space activates) and traps
   Tab inside a visible modal. Additive + delegated, so it survives the constant
   innerHTML re-renders. Included automatically wherever shell.js loads. (The
   standalone doors — portal.html, the admin console — do NOT load shell.js and
   do not inline this; they are transitional surfaces slated for retirement.) */
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
    // getClientRects, NOT offsetParent: offsetParent is always null for
    // position:fixed elements in Chromium, which silently exempted every
    // fixed-position modal (files slide-over, presence ritual) from the trap.
    var vis = function (el) { return el.getClientRects().length > 0; };
    var mm = document.querySelectorAll('[aria-modal="true"],[role="dialog"]'), modal = null;
    for (var i = 0; i < mm.length; i++) { if (vis(mm[i])) modal = mm[i]; }
    if (!modal) return;
    var f = modal.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
    f = Array.prototype.filter.call(f, vis);
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
