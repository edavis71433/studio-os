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
        // the FIRST exact match wins (lib/shell.ts returns on it) — the old
        // "last exact wins" let /presence.html#settings outrank /presence.html,
        // so the Website page read as "Settings" in the breadcrumb
        if (href === here) { if (!(best && best.exact)) best = { key: it.key, len: 999, exact: true }; }
        else if (!(best && best.exact) && href !== '/' && (here === href || here.indexOf(href + '/') === 0)) {
          if (!best || href.length > best.len) best = { key: it.key, len: href.length };
        }
      });
    });
    return best ? best.key : null;
  }
  // Oct 2026 nav cut: `hidden: true` items are ⌘K destinations the menu does not
  // draw. flatten keeps them (the palette reaches every page); visibleItems is
  // what the sidebar, the drawer and the account menu draw.
  function flatten(nav) { var o = []; (nav || []).forEach(function (s) { (s.items || []).forEach(function (i) { o.push({ key: i.key, label: i.label, href: i.href, section: s.label, desc: i.desc || "", hidden: !!i.hidden }); }); }); return o; }
  function visibleItems(sec) { return ((sec && sec.items) || []).filter(function (i) { return i && !i.hidden; }); }

  // ── recent records (slice 7): the last ~5 records the operator opened, cached
  // locally for the Customers caret's "Recent" group. Written from (1) a ⌘K
  // record selection and (2) a crm.html record open (trackCrmRecent below).
  // hrefs are full record URLs (identity params included) — rendered as-is,
  // never re-scoped by withScope.
  var RECENTS_KEY = 'dds-recent-records';
  // Strict same-origin-path guard: a single leading '/', NOT '//host' (protocol-
  // relative) and NOT '/\host' (backslash tricks). Applied on WRITE (pushRecent),
  // on READ (readRecents — localStorage is user-tamperable/legacy), and in
  // withScope so no scheme-carrying href ever renders as a live shell link.
  var SAFE_HREF = /^\/(?![/\\])/;
  function readRecents() {
    try {
      var a = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
      return Array.isArray(a) ? a.filter(function (r) { return r && r.label && typeof r.href === 'string' && SAFE_HREF.test(r.href); }).slice(0, 5) : [];
    } catch (_) { return []; }
  }
  function pushRecent(label, href) {
    label = String(label == null ? '' : label).trim(); href = String(href == null ? '' : href);
    if (!label || !SAFE_HREF.test(href)) return;
    try {
      var list = readRecents().filter(function (r) { return r.href !== href; });
      list.unshift({ label: label, href: href, at: Date.now() });
      localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 5)));
    } catch (_) { /* private mode: recents are a nicety, never load-bearing */ }
  }
  // crm.html renders the record name into #pagehead (renderShell) — poll for it
  // once per record-open and cache {name, canonical record URL}. Read-only; no
  // crm.html change needed. 'Client' is renderShell's placeholder name — skip it.
  function trackCrmRecent() {
    if (normalizePath(location.pathname) !== '/crm') return;
    var keep = [];
    try {
      var p = new URLSearchParams(location.search);
      ['client', 'client_id', 'deal', 'contact', 'project'].forEach(function (k) { var v = p.get(k); if (v) keep.push(k + '=' + encodeURIComponent(v)); });
    } catch (_) { return; }
    if (!keep.length) return;
    var href = '/crm.html?' + keep.join('&'), tries = 0;
    (function poll() {
      var h = document.getElementById('pagehead');
      var t = h && h.textContent ? h.textContent.trim() : '';
      if (t && t !== 'Client') { pushRecent(t, href); return; }
      if (++tries < 25) setTimeout(poll, 400);
    })();
  }

  // ── supabase (reuse the portal session) ──
  function ensureSupabase() {
    return new Promise(function (resolve) {
      if (window.supabase) return resolve();
      var s = document.createElement('script');
      s.src = "/vendor/supabase-js-2.45.4.js";
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
    var s = scopeId(); if (!s || !href || !SAFE_HREF.test(href)) return href;
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

  // ── An emailed reply's quoted earlier email (item 71, Nov 2026). A client who
  //    answers by email sends back the whole thread under their words ("On Sun,
  //    Nov 8 … wrote:" and every line after it starting with ">"), nested deeper
  //    with each reply. ddsQuote.split finds that TRAILING quote and nothing else:
  //    a client who answers INSIDE the quote (their lines between the ">" lines)
  //    keeps the whole message as it is, and a message that is only a quote is
  //    never folded to nothing. ddsQuote.html shows the reply and puts the rest
  //    behind "Show earlier email" — folded, never cut.
  /* quote-fold:start — pure; tests/presence/inbound_rough_edges_test.mjs runs this exact text */
  function ddsSplitQuote(text) {
    var s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    var lines = s.split('\n');
    var ATTR = /\b(wrote|writes|escribió|a écrit|schrieb|scrisse|escreveu)\s*:\s*$/i;
    var quoted = function (l) { return /^\s*>/.test(l); };
    var blank = function (l) { return !/\S/.test(l); };
    var restQuoted = function (from) {
      var any = false;
      for (var k = from; k < lines.length; k++) { if (blank(lines[k])) continue; if (!quoted(lines[k])) return false; any = true; }
      return any;
    };
    var start = -1;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], next = lines[i + 1] || '';
      if (quoted(l)) { if (restQuoted(i)) { start = i; break; } continue; }
      // Gmail / Apple Mail: "On <date>, <name> <address> wrote:" — Gmail wraps it, so "wrote:" may sit alone on the next line
      if (ATTR.test(l) && restQuoted(i + 1)) { start = i; break; }
      if (/^\s*On\s\S/i.test(l) && ATTR.test(next) && !quoted(next) && restQuoted(i + 2)) { start = i; break; }
      // Outlook: "-----Original Message-----", or a From: line (under a rule of underscores) followed by Sent:/Date:
      if (/^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i.test(l)) { start = i; break; }
      if (/^\s*From:\s*\S/i.test(l) && /^\s*(Sent|Date):\s*\S/i.test(next)) { start = (i > 0 && /^\s*_{8,}\s*$/.test(lines[i - 1])) ? i - 1 : i; break; }
    }
    var head = start > 0 ? lines.slice(0, start).join('\n').trim() : '';
    if (!head) return { text: s.trim(), quoted: '' };
    return { text: head, quoted: lines.slice(start).join('\n').trim() };
  }
  /* quote-fold:end */
  window.ddsQuote = {
    split: ddsSplitQuote,
    html: function (text, esc) {
      var raw = String(text == null ? '' : text);
      var p = ddsSplitQuote(raw);
      if (!p.quoted) return esc(raw);
      if (!document.getElementById('dds-quoted-css')) {
        var st = document.createElement('style'); st.id = 'dds-quoted-css';
        st.textContent = '.dds-quoted{display:block;margin-top:8px;white-space:normal}.dds-quoted>summary{cursor:pointer;font-size:12px;color:var(--faint,#6b6478);min-height:24px;line-height:24px}.dds-quoted-body{white-space:pre-wrap;font-size:12.5px;color:var(--faint,#6b6478);border-left:2px solid var(--line,#e2dff0);padding-left:8px;margin-top:4px}';
        document.head.appendChild(st);
      }
      return esc(p.text) + '<details class="dds-quoted"><summary>Show earlier email</summary><div class="dds-quoted-body">' + esc(p.quoted) + '</div></details>';
    },
  };

  // ── The list tools Customers, Contacts and Pipeline share (sales review items
  //    31, 32 and 39, Nov 2026): saved views, a column picker, "send an update to
  //    the people you picked" and the CSV import (the contacts importer, shared).
  //    A page hands over its own request function with use(); without one, ddsApi.
  window.ddsListKit = (function () {
    var REQ = null, VIEWS_P = null, styled = false;
    function req(path, method, body) { return REQ ? REQ(path, method, body) : window.ddsApi(path, { method: method, body: body }); }
    function esc2(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function style() {
      if (styled) return; styled = true;
      var st = document.createElement('style');
      st.textContent = '.dds-ask{border:none;border-radius:12px;padding:0;width:min(420px,calc(100% - 32px));background:var(--card,#fff);color:var(--ink,#1b1525);box-shadow:0 20px 60px rgba(0,0,0,.3)}'
        + '.dds-ask::backdrop{background:rgba(27,21,37,.4)}.dds-ask form{padding:20px}.dds-ask h2{margin:0 0 10px;font-size:17px}'
        + '.dds-ask label{display:block;font-size:13px;color:var(--soft,#5c5468);margin-bottom:6px}.dds-ask input{width:100%;box-sizing:border-box;font:inherit;font-size:15px;padding:9px 12px;border:1px solid var(--line,#e6e1ee);border-radius:8px;background:var(--card,#fff);color:inherit}'
        + '.dds-ask .row{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.dds-ask button{font:inherit;font-size:14px;font-weight:600;border-radius:8px;padding:8px 16px;cursor:pointer;border:1px solid var(--line,#e6e1ee);background:var(--card,#fff);color:inherit}.dds-ask button[value=ok]{background:var(--p,#5b3fa0);border-color:var(--p,#5b3fa0);color:#fff}'
        + '.dds-colmenu{position:absolute;z-index:40;top:calc(100% + 4px);left:0;min-width:200px;background:var(--card,#fff);border:1px solid var(--line,#e6e1ee);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.14);padding:8px}'
        + '.dds-colmenu label{display:flex;align-items:center;gap:8px;padding:7px 8px;font-size:14px;border-radius:6px;cursor:pointer}.dds-colmenu label:hover{background:var(--p-soft,#efe9fa)}.dds-colmenu input{width:16px;height:16px}'
        + '.dds-bulk{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin:0 0 10px;padding:8px 12px;border:1px solid var(--p,#5b3fa0);border-radius:10px;background:var(--p-soft,#efe9fa);font-size:13.5px}'
        + '.dds-bulk b{margin-right:4px}.dds-bulk button,.dds-bulk select{font:inherit;font-size:13px;font-weight:600;border-radius:999px;padding:5px 12px;min-height:32px;border:1px solid var(--line,#e6e1ee);background:var(--card,#fff);color:var(--ink,#1b1525);cursor:pointer}'
        + '.dds-bulk .go{background:var(--p,#5b3fa0);border-color:var(--p,#5b3fa0);color:#fff}.dds-bulk .clr{border-color:transparent;background:none;color:var(--p,#5b3fa0)}'
        + 'td.pick,th.pick{width:34px;padding-right:0!important;cursor:pointer}td.pick input,th.pick input{width:17px;height:17px;cursor:pointer}'
        // final pass (Nov 8, batch C): white on the dark theme's light purple read 2.3:1 — dark text on the filled buttons
        + '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .dds-ask button[value=ok],:root:not([data-theme="light"]) .dds-bulk .go,:root:not([data-theme="light"]) .dds-confirm .go{color:#171320}}'
        + ':root[data-theme="dark"] .dds-ask button[value=ok],:root[data-theme="dark"] .dds-bulk .go,:root[data-theme="dark"] .dds-confirm .go{color:#171320}'
        // …a confirm that asks in place, where the button was
        + '.dds-confirm{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px 8px}.dds-confirm .q{font-weight:600}'
        + '.dds-confirm button{font:inherit;font-size:13px;font-weight:600;border-radius:999px;padding:5px 12px;min-height:32px;border:1px solid var(--line,#e6e1ee);background:var(--card,#fff);color:var(--ink,#1b1525);cursor:pointer}'
        + '.dds-confirm .go{background:var(--p,#5b3fa0);border-color:var(--p,#5b3fa0);color:#fff}'
        // builder item 75 + sales item 90: a question that takes an answer (askIn), in the same place
        + '.dds-askin select,.dds-askin input{font:inherit;font-size:13px;min-height:32px;max-width:240px;box-sizing:border-box;border:1px solid var(--line,#e6e1ee);border-radius:8px;padding:4px 8px;background:var(--card,#fff);color:var(--ink,#1b1525)}'
        + '.dds-askin input[type=text]{min-width:180px}.dds-askin .why{flex-basis:100%;font-size:12.5px;color:var(--bad,#a3423a)}.dds-askin .why:empty{display:none}'
        // sales item 90: field filter chips (pressed = on; the two with a value carry a select)
        + '.dds-fchips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 10px}'
        + '.dds-fchip{font:inherit;font-size:13px;font-weight:500;border:1px solid var(--line,#e6e1ee);background:var(--card,#fff);color:var(--soft,#5c5468);border-radius:999px;padding:5px 12px;min-height:32px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;box-sizing:border-box}'
        + '.dds-fchip .n{font-size:11.5px;font-weight:600;color:var(--faint,#6b6478);font-variant-numeric:tabular-nums}'
        + '.dds-fchip:hover{border-color:var(--p,#5b3fa0);color:var(--ink,#1b1525)}'
        + '.dds-fchip[aria-pressed="true"],.dds-fchip.on{background:var(--p-soft,#efe9fa);border-color:transparent;color:var(--p,#5b3fa0);font-weight:600}'
        + '.dds-fchip.sel{padding-right:6px}.dds-fchip select{font:inherit;font-size:13px;font-weight:600;border:0;background:transparent;color:inherit;padding:2px 4px;cursor:pointer;max-width:150px}'
        + '.dds-fclear{font:inherit;font-size:13px;font-weight:600;border:0;background:none;color:var(--p,#5b3fa0);padding:5px 8px;cursor:pointer;min-height:32px}'
        // …and on a phone every control here is at least 44px, the pick cell included
        + '@media (max-width:767px){td.pick,th.pick{width:44px;min-width:44px}td.pick input,th.pick input{width:22px;height:22px}.dds-bulk button,.dds-bulk select,.dds-confirm button{min-height:44px}.dds-colmenu label{min-height:44px}.dds-askin select,.dds-askin input,.dds-fchip,.dds-fclear{min-height:44px}.dds-askin input[type=text]{min-width:0;flex:1 1 160px}}'
        // Safari draws a native drop-down at its own height whatever min-height says — the bulk bar's is drawn here, arrow included
        + '.dds-bulk select{-webkit-appearance:none;appearance:none;padding-right:28px;background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%276%27 viewBox=%270 0 10 6%27%3E%3Cpath d=%27M1 1l4 4 4-4%27 fill=%27none%27 stroke=%27%236b6478%27 stroke-width=%271.6%27/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 11px center;background-size:10px 6px}'
        + '.dds-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}'
        // item 89: a tag box and the tag chips a list shows
        + '.dds-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:42px;box-sizing:border-box;border:1px solid var(--line,#e6e1ee);border-radius:10px;background:var(--bg,#fff);padding:5px 8px;cursor:text}'
        + '.dds-tags:focus-within{border-color:var(--p,#5b3fa0)}.dds-tags .chips{display:contents}'
        + '.dds-tags input{flex:1 1 120px;min-width:100px;border:0!important;outline:none;background:none!important;padding:4px 2px!important;font:inherit;font-size:15px;color:inherit;width:auto!important}'
        + '.dds-tags input:focus,.dds-tags input:focus-visible{outline:none!important;box-shadow:none!important}'   // the box shows the focus, once
        + '.dds-tags .chip,.dds-tag{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:600;line-height:1.3;color:var(--p,#5b3fa0);background:var(--p-soft,#efe9fa);border-radius:999px;padding:3px 10px;white-space:nowrap}'
        + '.dds-tags .chip button{font:inherit;font-size:11px;line-height:1;color:inherit;background:none;border:0;padding:2px;margin-right:-4px;cursor:pointer;min-width:20px;min-height:20px}'
        + 'button.dds-tag{border:0;cursor:pointer;font-family:inherit}button.dds-tag:hover{text-decoration:underline}'
        + '@media (pointer:coarse){.dds-tags .chip button{min-width:32px;min-height:32px}}'
        // item 86: the import's matching step
        + '.dds-csvfile{margin:10px 0 8px;font-size:13px;color:var(--soft,#5c5468)}'
        + '.dds-csvmap{border:1px solid var(--line,#e6e1ee);border-radius:12px;overflow:auto;max-height:min(52vh,520px)}'
        + '.dds-csvmap table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:520px}'
        + '.dds-csvmap thead th{position:sticky;top:0;background:var(--card,#fff);text-align:left;font-size:12px;font-weight:600;color:var(--faint,#6b6478);padding:9px 12px;border-bottom:1px solid var(--line,#e6e1ee)}'
        + '.dds-csvmap tbody th,.dds-csvmap td{text-align:left;font-weight:500;padding:7px 12px;border-bottom:1px solid var(--line,#e6e1ee);vertical-align:middle}'
        + '.dds-csvmap td:nth-child(2){color:var(--soft,#5c5468);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
        + '.dds-csvmap tr:last-child th,.dds-csvmap tr:last-child td{border-bottom:0}.dds-csvmap tr.off th,.dds-csvmap tr.off td:nth-child(2){color:var(--faint,#6b6478);opacity:.75}'
        + '.dds-csvmap select{font:inherit;font-size:13.5px;min-height:36px;width:100%;max-width:220px;border:1px solid var(--line,#e6e1ee);border-radius:8px;background:var(--card,#fff);color:inherit;padding:4px 8px}'
        + '.dds-csvexist{border:0;margin:14px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px 18px;font-size:14px}.dds-csvexist legend{font-weight:600;margin-bottom:6px;padding:0}'
        + '.dds-csvexist label{display:inline-flex;align-items:center;gap:8px;min-height:32px;cursor:pointer}.dds-csvexist input{width:17px;height:17px;accent-color:var(--p,#5b3fa0)}'
        + '.dds-csvmax{display:inline-block;margin:12px 0 0;font-size:12.5px;color:var(--p,#5b3fa0);background:var(--p-soft,#efe9fa);border-radius:999px;padding:4px 12px}'
        + '.dds-csvact{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}'
        + '@media (pointer:coarse){.dds-csvmap select,.dds-csvexist label{min-height:44px}}';
      document.head.appendChild(st);
    }
    // ── saved views: GET/PUT /sales/views (one read per page) ──
    var VIEWS_OK = false;
    function views(list) {
      if (!VIEWS_P) VIEWS_P = req('/sales/views').then(function (r) { var d = r && r.ok && r.body && r.body.data ? r.body.data : null; VIEWS_OK = !!d; return d; }).catch(function () { VIEWS_OK = false; return null; });
      return VIEWS_P.then(function (all) { return all ? (all[list] || []) : null; });
    }
    function saveViews(list, arr) {
      // final pass (Nov 8, batch D): a page whose views couldn't be read builds its list from
      // nothing, and saving that list replaced the team's saved views. Read again first and keep
      // every view the page didn't know about; if the read fails again, don't save.
      var ready = VIEWS_OK ? Promise.resolve(arr) : (VIEWS_P = null, views(list).then(function (cur) {
        if (cur === null) return null;
        var mine = arr || [];
        return cur.filter(function (v) { return !mine.some(function (a) { return (a.id && a.id === v.id) || String(a.name || '').toLowerCase() === String(v.name || '').toLowerCase(); }); }).concat(mine);
      }));
      return ready.then(function (body) {
        if (!body) return null;
        return req('/sales/views', 'PUT', { list: list, views: body }).then(function (r) {
          if (!r || !r.ok || !r.body || !r.body.data) return null;
          VIEWS_P = Promise.resolve(r.body.data); VIEWS_OK = true; return r.body.data[list] || [];
        });
      }).catch(function () { return null; });
    }
    // ── a small named prompt (a <dialog>, never window.prompt) ──
    function ask(o) {
      style(); o = o || {};
      return new Promise(function (resolve) {
        var d = document.createElement('dialog'); d.className = 'dds-ask'; d.setAttribute('aria-labelledby', 'ddsAskH');
        d.innerHTML = '<form method="dialog"><h2 id="ddsAskH"></h2><label for="ddsAskIn"></label><input id="ddsAskIn" maxlength="60" autocomplete="off"><div class="row"><button type="button" value="cancel">Cancel</button><button type="submit" value="ok"></button></div></form>';
        d.querySelector('h2').textContent = o.title || 'Name it';
        d.querySelector('label').textContent = o.label || 'Name';
        d.querySelector('button[value=ok]').textContent = o.ok || 'Save';
        var inp = d.querySelector('input'); inp.value = o.value || '';
        // batch C: focus goes back where it came from (it was left on <body>). Safari never
        // focuses a clicked button, so a page names its button (o.back) rather than trusting it
        var done = false, back = pickBack(o.back, document.activeElement);
        function finish(v) {
          if (done) return; done = true; try { d.close(); } catch (_) { } d.remove(); resolve(v);
          if (back && back.isConnected && back.focus) try { back.focus(); } catch (_) { /* */ }
        }
        d.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); var v = inp.value.trim(); if (!v) { inp.focus(); return; } finish(v); });
        d.querySelector('button[value=cancel]').addEventListener('click', function () { finish(null); });
        d.addEventListener('cancel', function (e) { e.preventDefault(); finish(null); });
        document.body.appendChild(d);
        if (d.showModal) d.showModal(); inp.focus(); inp.select();
      });
    }
    // ── the column picker: a checkbox per column; the first column always shows ──
    function columnsMenu(anchor, cols, hidden, onChange) {
      style();
      var host = anchor.parentNode, open = host.querySelector('.dds-colmenu');
      if (open) { open.remove(); anchor.setAttribute('aria-expanded', 'false'); return; }
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      var m = document.createElement('div'); m.className = 'dds-colmenu'; m.setAttribute('role', 'group'); m.setAttribute('aria-label', 'Columns to show');
      m.innerHTML = cols.map(function (c, i) { return '<label><input type="checkbox" data-col="' + esc2(c[0]) + '"' + (hidden.has(c[0]) ? '' : ' checked') + (i === 0 ? ' disabled' : '') + '> ' + esc2(c[1]) + '</label>'; }).join('');
      host.appendChild(m); anchor.setAttribute('aria-expanded', 'true'); fit(m);
      var first = m.querySelector('input:not([disabled])'); if (first) first.focus();
      m.addEventListener('change', function (e) {
        var k = e.target && e.target.getAttribute('data-col'); if (!k) return;
        var next = new Set(hidden); if (e.target.checked) next.delete(k); else next.add(k); hidden = next; onChange(next);
      });
      function close(back) { if (!m.isConnected) return; m.remove(); anchor.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside, true); if (back) anchor.focus(); }
      function outside(e) { if (!m.contains(e.target) && e.target !== anchor) close(false); }
      m.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); close(true); } });
      setTimeout(function () { document.addEventListener('click', outside, true); }, 0);
    }
    // ── send an update to the people picked: keep them as a list, open the composer on it ──
    function sendTo(people, name) {
      return req('/broadcasts/lists', 'POST', { name: name || '', people: people }).then(function (r) {
        // S4: people who aren't your contacts, enquiries or customers are left off; the composer says how many
        if (r && r.ok && r.body && r.body.data && r.body.data.id) { var left = Number(r.body.data.left_out) || 0; location.href = '/broadcasts.html?list=' + encodeURIComponent(r.body.data.id) + (left > 0 ? '&left=' + left : ''); return true; }
        if (window.ddsToast) window.ddsToast((r && r.body && r.body.message) || 'That list didn’t save — try again in a moment.', 'err');
        return false;
      });
    }
    // ── CSV: the contacts importer's parser, shared ──
    function parseCsv(text) {
      var rows = [], row = [], cell = '', inQ = false;
      // final pass (Nov 8, batch D): Excel starts a "CSV UTF-8" file with a byte-order mark. The
      // importers' header match trims it off, but the first cell kept it, so the reader drops it here
      text = String(text || ''); if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch; }
        // a quote opens a quoted cell only as its first character: `6" sub` mid-cell is an inch mark,
        // and reading it as an opening quote swallowed every row after it into that one cell
        else if (ch === '"' && cell === '') inQ = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(function (c) { return c.trim() !== ''; })) rows.push(row); row = []; }
        else cell += ch;
      }
      if (cell !== '' || row.length) { row.push(cell); if (row.some(function (c) { return c.trim() !== ''; })) rows.push(row); }
      return rows;
    }
    // Google and Outlook exports put a label, type or display-name column beside each value
    // ("E-mail 1 - Label" · "E-mail 1 - Value", "E-mail Type", "Phonetic First Name", "Surname Yomi").
    // None of those is ever what a key means, so none is read as one.
    // (a heading that is only "Labels" or "Categories" is the person's groups, not a side column: item 86 reads it as tags)
    function csvSideColumn(h) { var t = String(h || '').trim(); if (/^(labels|categories)$/i.test(t)) return false; return /\b(label|labels|type|display name|yomi|phonetic)\b/i.test(t); }
    // One row under the keys. When several columns mean the same key, the first one with a value
    // wins: the last one used to, even when it was empty or held "Home", so a Google or Outlook
    // file came in without its emails, phones and names.
    function csvObject(keys, r) {
      var obj = {};
      keys.forEach(function (k, i) { if (!k) return; var v = String(r[i] || '').trim(); if (v && !obj[k]) obj[k] = v; });
      return obj;
    }
    var IMPORT_MAX = 500;   // one run's worth; the rest of a bigger file is named, never dropped in silence
    // host: an element to fill. o: {title, help, mapHeader(h)→key|null, ready(keys)→'' or a message, toItem(obj)→item|null,
    // label(item)→string, noun, send(item)→Promise<'added'|'existed'|'skipped'|'failed'>, summary(counts)→string, done()}
    function importPanel(host, o) {
      // One run per panel: Import CSV again while rows are going in leaves the running panel as it is
      // (a second run of the same file doubled everyone without an email, who can't be matched)
      if (host.__ddsImport && host.__ddsImport.running) return;
      var run = host.__ddsImport = { running: false, stop: false };
      host.innerHTML = '<div class="card" style="margin:10px 0;padding:14px 16px"><p style="font-weight:600;margin:0 0 4px"></p><p class="muted" style="margin-top:0"></p>'
        + '<input type="file" accept=".csv,text/csv" aria-label="Choose a CSV file"><div class="dds-csvprev"></div><p class="muted" style="margin:10px 0 0"><button type="button" class="linkbtn dds-csvx" style="font:inherit;color:var(--p,#5b3fa0);background:none;border:none;padding:0;cursor:pointer">Close</button></p></div>';
      host.querySelector('p').textContent = o.title; host.querySelectorAll('p')[1].textContent = o.help;
      var prev = host.querySelector('.dds-csvprev'), file = host.querySelector('input[type=file]'), closer = host.querySelector('.dds-csvx');
      var opener = pickBack(o.back, document.activeElement);   // batch C: closing the panel gives focus back (it was left on <body>)
      closer.addEventListener('click', function () {
        // Close (Stop, while it runs) ends the run before its next rows: closing only hid the panel
        // and every row still went in. What already went in stays, and the summary says how far it got.
        run.stop = true; if (host.__ddsImport === run) host.__ddsImport = null;
        host.innerHTML = '';
        if (opener && opener.isConnected && opener.focus) try { opener.focus(); } catch (_) { /* */ }
      });
      file.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0]; if (!f || run.running) return;
        f.text().then(function (text) {
          if (run.stop || run.running) return;   // closed, or started, while the file was read
          var rows = parseCsv(text);
          if (rows.length < 2) { prev.innerHTML = '<p class="muted">That file looks empty (or has only a header row).</p>'; return; }
          var guess = rows[0].map(function (h) { return csvSideColumn(h) ? null : o.mapHeader(h); });
          if (o.targets) { matchStep(rows, guess, f.name || ''); return; }   // item 86: a page that names its fields lets you match each column
          preview(rows, guess, {});
        });
      });
      // ── item 86: match the columns. One row per column of the file: its heading, its first
      //    value, and where it goes (the guess first; label and type columns start at "Don't
      //    bring in"). Then, for a page that can update, what to do with people already there.
      function matchStep(rows, guess, fileName) {
        var n = rows.length - 1;
        var first = function (i) { for (var r = 1; r < rows.length && r < 50; r++) { var v = String(rows[r][i] || '').trim(); if (v) return v; } return ''; };
        var opts = o.targets.concat([['', 'Don’t bring in']]);
        var trs = rows[0].map(function (h, i) {
          var g = guess[i] || '';
          var sel = '<select data-col="' + i + '" aria-label="Where ' + esc2(h || ('column ' + (i + 1))) + ' goes">' + opts.map(function (t) { return '<option value="' + esc2(t[0]) + '"' + (t[0] === g ? ' selected' : '') + '>' + esc2(t[1]) + '</option>'; }).join('') + '</select>';
          return '<tr' + (g ? '' : ' class="off"') + '><th scope="row">' + esc2(h || ('Column ' + (i + 1))) + '</th><td>' + esc2(first(i)) + '</td><td>' + sel + '</td></tr>';
        }).join('');
        var left = Math.max(0, n - IMPORT_MAX);
        prev.innerHTML = '<p class="dds-csvfile">' + esc2(fileName ? fileName + ' · ' : '') + n + ' ' + o.noun + (n === 1 ? '' : 's') + ' in the file</p>'
          + '<div class="dds-csvmap"><table><thead><tr><th scope="col">In your file</th><th scope="col">First row</th><th scope="col">Goes to</th></tr></thead><tbody>' + trs + '</tbody></table></div>'
          + (o.existing ? '<fieldset class="dds-csvexist"><legend>' + esc2(o.existing.legend) + '</legend>'
            + '<label><input type="radio" name="dds-csvex" value="update" checked> ' + esc2(o.existing.update) + '</label>'
            + '<label><input type="radio" name="dds-csvex" value="skip"> ' + esc2(o.existing.skip) + '</label></fieldset>' : '')
          + (left ? '<p class="dds-csvmax">' + n + ' in the file. This brings in the first ' + IMPORT_MAX + ' now; run it again for the other ' + left + '.</p>' : '')
          + '<div class="dds-csvact"><button type="button" class="btn dds-csvmatch">Import ' + Math.min(n, IMPORT_MAX) + '</button><span class="muted dds-csvwhy" role="status" aria-live="polite"></span></div>';
        prev.querySelectorAll('select[data-col]').forEach(function (s) { s.addEventListener('change', function () { s.closest('tr').classList.toggle('off', !s.value); }); });
        prev.querySelector('.dds-csvmatch').addEventListener('click', function () {
          var keys = rows[0].map(function (_, i) { var s = prev.querySelector('select[data-col="' + i + '"]'); return s && s.value ? s.value : null; });
          var why = o.ready(keys); if (why) { prev.querySelector('.dds-csvwhy').textContent = why; return; }
          var ex = prev.querySelector('input[name="dds-csvex"]:checked');
          preview(rows, keys, { onExisting: ex ? ex.value : 'skip', fileName: fileName, go: true });
        });
        var fs = prev.querySelector('select[data-col]'); if (fs) fs.focus();
      }
      function preview(rows, keys, how) {
          var why = o.ready(keys); if (why) { prev.innerHTML = '<p class="muted"></p>'; prev.firstChild.textContent = why; return; }
          // counted before the cut: an 800-row file said "500 found", finished "500 imported" and never named the other 300
          var all = rows.slice(1).map(function (r) { return o.toItem(csvObject(keys, r)); }).filter(Boolean);
          var items = all.slice(0, IMPORT_MAX), left = all.length - items.length;
          if (!items.length) { prev.innerHTML = '<p class="muted">None of the rows had what an import needs.</p>'; return; }
          var many = function (n) { return n + ' ' + o.noun + (n === 1 ? '' : 's'); };
          prev.innerHTML = '<p class="muted" style="margin:10px 0 6px"></p><button type="button" class="btn dds-csvgo"></button> <span class="muted dds-csvlive" role="status" aria-live="polite"></span>';
          prev.querySelector('p').textContent = (left ? many(all.length) + ' in the file — this imports the first ' + IMPORT_MAX + '. Put the other ' + left + ' in a second file and import that. First few: ' : many(items.length) + ' found — first few: ')
            + items.slice(0, 3).map(o.label).join(', ') + (items.length > 3 ? '…' : '');
          var go = prev.querySelector('.dds-csvgo'), live = prev.querySelector('.dds-csvlive');
          go.textContent = 'Import ' + items.length;
          go.addEventListener('click', function () {
            if (run.running || run.stop) return;
            run.running = true; go.disabled = true; file.disabled = true; closer.textContent = 'Stop';   // no second file under a running one
            var counts = { added: 0, updated: 0, existed: 0, skipped: 0, failed: 0 }, done = 0, i = 0, ctx = { onExisting: how.onExisting || 'skip', importId: null };
            function finish(stopped) {
              run.running = false;
              if (host.__ddsImport === run) { host.__ddsImport = null; host.innerHTML = ''; }
              var msg = (stopped ? 'Stopped after ' + done + ' of ' + items.length + ' — ' : '') + o.summary(counts)
                + (left && !stopped ? ' ' + left + ' more in the file weren’t imported — put them in a second file.' : '');
              if (window.ddsToast) window.ddsToast(msg, counts.failed ? 'err' : 'ok');
              if (o.done) o.done(counts, ctx);
            }
            function next() {
              if (run.stop) { finish(true); return; }
              if (i >= items.length) { finish(false); return; }
              var chunk = items.slice(i, i + 5); i += 5;
              Promise.all(chunk.map(function (it) { return Promise.resolve().then(function () { return o.send(it, ctx); }).catch(function () { return 'failed'; }).then(function (k) { counts[k in counts ? k : 'failed']++; done++; }); }))
                .then(function () { go.textContent = 'Importing ' + Math.min(done, items.length) + '/' + items.length + '…'; live.textContent = 'Imported ' + done + ' of ' + items.length; next(); });
            }
            // item 86: a page that keeps imports starts one first (its id rides on every row, for Undo)
            Promise.resolve(o.start ? o.start({ onExisting: ctx.onExisting, fileName: how.fileName || '' }) : null).then(function (id) { ctx.importId = id || null; }, function () { ctx.importId = null; }).then(next);
          });
          if (how.go) go.click();   // the matching step's Import button already said go
      }
    }
    // ── batch C (final pass, Nov 8) ──
    // where focus goes back to: the button a page names (shown on screen), else whatever had focus —
    // never <body> (Safari leaves a clicked button unfocused)
    function pickBack(named, active) {
      var n = typeof named === 'string' ? document.querySelector(named) : named;
      if (n && n.getClientRects && n.getClientRects().length) return n;
      return (active && active !== document.body && active !== document.documentElement) ? active : null;
    }
    // keep a dropdown on screen: on a phone the Columns and Views menus ran off the right edge
    function fit(m) {
      try {
        m.style.transform = ''; var r = m.getBoundingClientRect(), vw = document.documentElement.clientWidth, pad = 8, dx = 0;
        if (r.right > vw - pad) dx = (vw - pad) - r.right;
        if (r.left + dx < pad) dx = pad - r.left;
        if (dx) m.style.transform = 'translateX(' + Math.round(dx) + 'px)';
      } catch (_) { /* */ }
    }
    // a confirm that asks in place: the button steps aside for "the question · [Yes, …] [Cancel]".
    // The newer pages ask this way (never a pop-up). Focus lands on Cancel, the safe answer.
    function confirmIn(anchor, o) {
      style(); o = o || {};
      return new Promise(function (resolve) {
        if (!anchor || !anchor.parentNode) { resolve(false); return; }
        var id = 'ddsCq' + Math.random().toString(36).slice(2, 8);
        var box = document.createElement('span'); box.className = 'dds-confirm'; box.setAttribute('role', 'group'); box.setAttribute('aria-labelledby', id);
        box.innerHTML = '<span class="q"></span><button type="button" class="go"></button><button type="button" class="no">Cancel</button>';
        box.querySelector('.q').id = id; box.querySelector('.q').textContent = o.text || 'Are you sure?';
        box.querySelector('.go').textContent = o.yes || 'Yes';
        box.querySelector('.go').setAttribute('aria-describedby', id); box.querySelector('.no').setAttribute('aria-describedby', id);
        anchor.hidden = true; anchor.parentNode.insertBefore(box, anchor.nextSibling);
        var done = false;
        function finish(v) {
          if (done) return; done = true;
          if (box.isConnected) box.remove();
          anchor.hidden = false; resolve(v);
          if (!v && anchor.isConnected && anchor.focus) try { anchor.focus(); } catch (_) { /* */ }
        }
        box.querySelector('.go').addEventListener('click', function () { finish(true); });
        box.querySelector('.no').addEventListener('click', function () { finish(false); });
        box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
        box.querySelector('.no').focus();
      });
    }
    // ── builder item 75 + sales item 90: a question that takes an answer, asked in place the way
    //    confirmIn asks: "the question · [answer] · [Yes, …] [Cancel]". o.field (or o.fields, for
    //    more than one) = { kind: 'select'|'date'|'text', label, options: [[value, label]], value,
    //    placeholder, required, need }. Resolves the answer (an array of them for o.fields; '' for
    //    an optional one left empty), or null for Cancel or Escape. Focus starts in the first answer.
    function askIn(anchor, o) {
      style(); o = o || {};
      var specs = o.fields || [o.field || {}];
      return new Promise(function (resolve) {
        if (!anchor || !anchor.parentNode) { resolve(null); return; }
        var id = 'ddsAq' + Math.random().toString(36).slice(2, 8);
        var box = document.createElement('span'); box.className = 'dds-confirm dds-askin'; box.setAttribute('role', 'group'); box.setAttribute('aria-labelledby', id);
        box.innerHTML = '<span class="q"></span>';
        box.querySelector('.q').id = id; box.querySelector('.q').textContent = o.text || '';
        var inputs = specs.map(function (f) {
          var el;
          if (f.kind === 'select') {
            el = document.createElement('select');
            el.innerHTML = (f.placeholder ? '<option value="">' + esc2(f.placeholder) + '</option>' : '') + (f.options || []).map(function (op) { return '<option value="' + esc2(op[0]) + '">' + esc2(op[1]) + '</option>'; }).join('');
          } else {
            el = document.createElement('input'); el.type = f.kind === 'date' ? 'date' : 'text';
            if (f.kind !== 'date') { el.maxLength = f.max || 200; el.autocomplete = 'off'; }
            if (f.placeholder) el.placeholder = f.placeholder;
          }
          if (f.value != null) el.value = f.value;
          el.setAttribute('aria-label', f.label || o.text || '');
          box.appendChild(el);
          return el;
        });
        var go = document.createElement('button'); go.type = 'button'; go.className = 'go'; go.textContent = o.yes || 'Yes';
        var no = document.createElement('button'); no.type = 'button'; no.className = 'no'; no.textContent = 'Cancel';
        var why = document.createElement('span'); why.className = 'why'; why.setAttribute('role', 'status');
        box.appendChild(go); box.appendChild(no); box.appendChild(why);
        go.setAttribute('aria-describedby', id); no.setAttribute('aria-describedby', id);
        anchor.hidden = true; anchor.parentNode.insertBefore(box, anchor.nextSibling);
        var done = false;
        function finish(v) {
          if (done) return; done = true;
          if (box.isConnected) box.remove();
          anchor.hidden = false; resolve(v);
          if (v === null && anchor.isConnected && anchor.focus) try { anchor.focus(); } catch (_) { /* */ }
        }
        go.addEventListener('click', function () {
          var vals = inputs.map(function (el) { return String(el.value || '').trim(); });
          for (var i = 0; i < specs.length; i++) if (specs[i].required && !vals[i]) { why.textContent = specs[i].need || 'Fill this in first.'; inputs[i].focus(); return; }
          finish(o.fields ? vals : vals[0]);
        });
        no.addEventListener('click', function () { finish(null); });
        box.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { e.preventDefault(); finish(null); }
          else if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); go.click(); }
        });
        inputs[0].focus();
      });
    }
    // ── sales item 90: a list's field filters as chips (lib/list_filters.ts is the server's copy of
    //    the rules). o = { value: { quiet, owes, nodeal, closing, added, via }, offer: the keys this
    //    list has, in order, counts: { key: n } (optional), vias: the "How they found you" picks,
    //    onChange(next) }. A chip is pressed or not; "Not contacted in" and "Found via" pick a value.
    var FCHIP_WORDS = { owes: 'Owes you money', nodeal: 'No deal yet', closing: 'Closing this month', added: 'Added this month' };
    function filterChips(host, o) {
      style(); o = o || {};
      if (!host) return;
      var v = o.value || {}, counts = o.counts || {};
      var n = function (k) { return counts[k] != null ? ' <span class="n">' + counts[k] + '</span>' : ''; };
      var h = '<div class="dds-fchips" role="group" aria-label="Filter this list">';
      (o.offer || []).forEach(function (k) {
        if (k === 'quiet') {
          h += '<label class="dds-fchip sel' + (v.quiet ? ' on' : '') + '"><span>Not contacted in</span><select data-fchip="quiet" aria-label="Not contacted in">'
            + '<option value="">any time</option>' + [30, 60, 90].map(function (d) { return '<option value="' + d + '"' + (v.quiet === d ? ' selected' : '') + '>' + d + ' days</option>'; }).join('') + '</select></label>';
        } else if (k === 'via') {
          h += '<label class="dds-fchip sel' + (v.via ? ' on' : '') + '"><span>Found via</span><select data-fchip="via" aria-label="How they found you">'
            + '<option value="">anywhere</option>' + (o.vias || []).map(function (x) { return '<option value="' + esc2(x) + '"' + (v.via === x ? ' selected' : '') + '>' + esc2(x) + '</option>'; }).join('') + '</select></label>';
        } else if (FCHIP_WORDS[k]) {
          h += '<button type="button" class="dds-fchip" data-fchip="' + k + '" aria-pressed="' + (v[k] ? 'true' : 'false') + '">' + esc2(FCHIP_WORDS[k]) + n(k) + '</button>';
        }
      });
      var any = Object.keys(v).some(function (k) { return !!v[k]; });
      if (any) h += '<button type="button" class="dds-fclear" data-fchip="clear">Clear filters</button>';
      host.innerHTML = h + '</div>';
      function next(k, val) {
        var out = {}; Object.keys(v).forEach(function (x) { if (v[x]) out[x] = v[x]; });
        if (k === 'clear') out = {};
        else if (val) out[k] = val; else delete out[k];
        if (o.onChange) o.onChange(out, k);
      }
      host.querySelectorAll('button[data-fchip]').forEach(function (b) {
        b.addEventListener('click', function () { var k = b.getAttribute('data-fchip'); next(k, k === 'clear' ? null : !v[k]); });
      });
      host.querySelectorAll('select[data-fchip]').forEach(function (s) {
        s.addEventListener('change', function () { var k = s.getAttribute('data-fchip'); next(k, k === 'quiet' ? (Number(s.value) || 0) : s.value); });
      });
    }
    // a bulk change's message with its Undo (the Undo runs once; a second press does nothing)
    function undoToast(msg, undo, kind) {
      if (!window.ddsToast) return null;
      var used = false;
      return window.ddsToast(msg, kind || 'ok', { label: 'Undo', onClick: function () { if (used) return; used = true; Promise.resolve().then(undo).catch(function () { window.ddsToast('That couldn’t be undone just now.', 'err'); }); } });
    }
    // one polite announcer for the whole page ("3 selected")
    function announce(text) {
      style();
      var n = document.getElementById('dds-sr-status');
      if (!n) { n = document.createElement('div'); n.id = 'dds-sr-status'; n.className = 'dds-sr'; n.setAttribute('role', 'status'); n.setAttribute('aria-live', 'polite'); document.body.appendChild(n); }
      n.textContent = ''; setTimeout(function () { n.textContent = String(text || ''); }, 30);
    }
    // whole-cell picking: the cell around a row's checkbox toggles it (17px was hard to hit on
    // a phone), and the new count is announced — the pages' own change handlers do the rest
    document.addEventListener('click', function (e) {
      var t = e.target; if (!t || !t.closest) return;
      var cell = t.closest('td.pick,th.pick'); if (!cell || t.closest('input')) return;
      var box = cell.querySelector('input[type=checkbox]'); if (box && !box.disabled) box.click();
    });
    document.addEventListener('change', function (e) {
      var t = e.target; if (!t || !t.matches || !t.matches('td.pick input[type=checkbox],th.pick input[type=checkbox]')) return;
      setTimeout(function () { var b = document.querySelector('.dds-bulk b'); announce(b ? b.textContent : 'None selected'); }, 60);
    });
    // ── tags (sales item 89): a box that turns what you type into chips. Enter or a comma adds
    //    one, ✕ or Backspace in an empty box takes one off. Lower-case words, each once, at
    //    most twelve (lib/contact_fields.ts normalizeTags is the server's copy of the rule).
    function cleanTag(t) { return String(t == null ? '' : t).replace(/[,;#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30).toLowerCase(); }
    function tagInput(host, initial, o) {
      style(); o = o || {};
      var tags = [];
      host.classList.add('dds-tags');
      host.innerHTML = '<span class="chips"></span><input type="text" autocomplete="off" maxlength="60">';
      var box = host.querySelector('.chips'), inp = host.querySelector('input');
      if (o.id) inp.id = o.id;
      inp.placeholder = o.placeholder || 'Add a tag…';
      if (o.label) inp.setAttribute('aria-label', o.label);
      function paint() {
        box.innerHTML = tags.map(function (t, i) { return '<span class="chip">' + esc2(t) + '<button type="button" data-i="' + i + '" aria-label="Remove the tag ' + esc2(t) + '">✕</button></span>'; }).join('');
      }
      function add(v) {
        String(v || '').split(/[,;\n]/).forEach(function (p) { var t = cleanTag(p); if (t && tags.indexOf(t) < 0 && tags.length < 12) tags.push(t); });
        paint();
      }
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ',') { if (inp.value.trim()) { e.preventDefault(); add(inp.value); inp.value = ''; } else if (e.key === ',') e.preventDefault(); }
        else if (e.key === 'Backspace' && !inp.value && tags.length) { tags.pop(); paint(); }
      });
      // no chip on blur: the box would grow under a finger on its way to Save, and the tap would miss.
      // What is still typed is taken when the form saves (get, below).
      host.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button[data-i]') : null;
        if (b) { tags.splice(Number(b.getAttribute('data-i')), 1); paint(); inp.focus(); return; }
        if (e.target === host || e.target === box) inp.focus();
      });
      add((initial || []).join(','));
      // what is still being typed counts too, so Save never drops it
      return { get: function () { if (inp.value.trim()) { add(inp.value); inp.value = ''; } return tags.slice(); }, set: function (list) { tags = []; add((list || []).join(',')); }, input: inp };
    }
    // ── charts on a list, and a printable list (sales item 105) ──────────────
    // charts(panels, foot) returns a chart card's insides, one plain bar list per
    // panel: panels = [{ title, rows: [{ label, n, extra, none }], unit: ['deal',
    // 'deals'], extra: true, empty }]. A bar is as long as its count against the
    // panel's longest row; the count is written beside it (then `extra`, a stage's
    // value), so no figure rests on a bar alone. Rows of nothing are left out; a
    // `none` row ("Not recorded") is grey. shell.css styles it (.dds-charts).
    function charts(panels, foot) {
      var h = '<h2 class="dc-h">Charts</h2><div class="dc-grid">';
      (panels || []).forEach(function (p) {
        var rows = (p.rows || []).filter(function (r) { return r && r.n > 0; });
        var max = 0, all = 0; rows.forEach(function (r) { max = Math.max(max, r.n); all += r.n; });
        var unit = p.unit || ['', ''];
        h += '<div class="dc-panel"><h3>' + esc2(p.title) + '</h3>';
        if (!rows.length) { h += '<p class="dc-none">' + esc2(p.empty || 'Nothing to count in this view.') + '</p></div>'; return; }
        h += '<ul class="dc-bars' + (p.extra ? ' has-v' : '') + '">' + rows.map(function (r) {
          var word = r.n === 1 ? unit[0] : unit[1];
          var tip = r.label + ': ' + r.n + (word ? ' ' + word : '') + (r.extra ? ', ' + r.extra : '') + ' · ' + Math.round(r.n / all * 100) + '% of this view';
          return '<li class="dc-row' + (r.none ? ' none' : '') + '" data-tip="' + esc2(tip) + '"><span class="dc-l">' + esc2(r.label) + '</span>'
            + '<span class="dc-track" aria-hidden="true"><span class="dc-fill" style="width:' + Math.max(2, Math.round(r.n / max * 100)) + '%"></span></span>'
            + '<span class="dc-n">' + r.n + (word ? '<span class="sr-only"> ' + esc2(word) + '</span>' : '') + '</span>'
            + (p.extra ? '<span class="dc-v">' + esc2(r.extra || '') + '</span>' : '') + '</li>';
        }).join('') + '</ul></div>';
      });
      return h + '</div>' + (foot ? '<p class="dc-foot">' + esc2(foot) + '</p>' : '');
    }
    // pointing at a row (or touching it) shows its count and its share of the view
    var TIP = null;
    function chartTips(host) {
      if (!host || host.__ddsTips) return; host.__ddsTips = true;
      function hide() { if (TIP) TIP.hidden = true; }
      host.addEventListener('pointerover', function (e) {
        var row = e.target && e.target.closest ? e.target.closest('.dc-row[data-tip]') : null;
        if (!row) { hide(); return; }
        if (!TIP) { TIP = document.createElement('div'); TIP.className = 'dc-tip'; TIP.setAttribute('aria-hidden', 'true'); document.body.appendChild(TIP); }
        var bar = (row.querySelector('.dc-fill') || row).getBoundingClientRect(), r = row.getBoundingClientRect();
        TIP.textContent = row.getAttribute('data-tip'); TIP.hidden = false;
        var half = TIP.offsetWidth / 2 + 8, above = r.top > TIP.offsetHeight + 16;
        TIP.style.left = Math.min(Math.max(bar.right, half), window.innerWidth - half) + 'px';
        TIP.style.top = (above ? r.top : r.bottom + TIP.offsetHeight + 16) + 'px';   // under the row when it sits at the top of the screen
      });
      host.addEventListener('pointerleave', hide);
      window.addEventListener('scroll', hide, { passive: true });
    }
    // printList(o) prints exactly the rows in view as a plain table:
    // o = { title, sub, cols: [{ label, num }], rows: [[cell, …]] }. While it prints,
    // shell.css shows only #ddsPrint (body[data-print=list]); then the page is back.
    function printList(o) {
      var old = document.getElementById('ddsPrint'); if (old) old.remove();
      var cols = o.cols || [], d = document.createElement('div'); d.id = 'ddsPrint';
      var num = function (i) { return cols[i] && cols[i].num ? ' class="num"' : ''; };
      d.innerHTML = '<h1>' + esc2(o.title) + '</h1>' + (o.sub ? '<p class="pl-sub">' + esc2(o.sub) + '</p>' : '')
        + '<table><thead><tr>' + cols.map(function (c, i) { return '<th scope="col"' + num(i) + '>' + esc2(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>'
        + (o.rows || []).map(function (r) { return '<tr>' + r.map(function (v, i) { return '<td' + num(i) + '>' + esc2(v) + '</td>'; }).join('') + '</tr>'; }).join('')
        + '</tbody></table><p class="pl-foot">Printed from Studio OS</p>';
      document.body.appendChild(d);
      document.body.setAttribute('data-print', 'list');
      var done = false;
      function back() {
        if (done) return; done = true;
        document.body.removeAttribute('data-print'); d.remove();
        window.removeEventListener('afterprint', back); document.removeEventListener('pointerdown', back, true); document.removeEventListener('keydown', back, true);
      }
      window.addEventListener('afterprint', back);
      window.print();
      // a browser that never says the print is done gets the page back on the next tap or key
      setTimeout(function () { if (!done) { document.addEventListener('pointerdown', back, true); document.addEventListener('keydown', back, true); } }, 0);
    }
    return { use: function (fn) { REQ = fn; }, views: views, saveViews: saveViews, ask: ask, columnsMenu: columnsMenu, sendTo: sendTo, parseCsv: parseCsv, importPanel: importPanel, style: style, fit: fit, confirmIn: confirmIn, askIn: askIn, filterChips: filterChips, undoToast: undoToast, announce: announce, tagInput: tagInput, cleanTag: cleanTag, charts: charts, chartTips: chartTips, printList: printList };
  })();

  // ── The Email box (sales item 80, Nov 2026; drawn in Figma 264:1136, 264:1604 and 265:1452):
  //    email one person from their record or their deal, with or without a project. GET
  //    /sales/email says who it goes to (the address on file, never one typed here), who it goes
  //    out as and where a reply comes back, so a missing or stopped address is said before a word
  //    is written; POST /sales/email sends it and keeps it on their timeline. One box, two homes:
  //    the record's composer and Pipeline's deal card. The page hands over its own request
  //    function (the record asks the studio's own site, even from inside a client). ──
  window.ddsEmailBox = (function () {
    var INFO = {}, SR = null, styled = false, seq = 0;
    var NOT_YET = 'Email from here arrives with an update that’s on its way. Try again a little later.';
    var MAIL = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6 8.5-6"/></svg>';
    function esc3(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function first(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
    function initials(n) { var w = String(n || '').trim().split(/\s+/).filter(Boolean); return (Array.from(w[0] || '?')[0] + (w.length > 1 ? Array.from(w[w.length - 1])[0] : '')).toUpperCase(); }
    function key(ids) { var k = ['deal_id', 'contact_id', 'client_id']; for (var i = 0; i < k.length; i++) if (ids && ids[k[i]]) return k[i] + '=' + encodeURIComponent(ids[k[i]]); return ''; }
    function style() {
      if (styled) return; styled = true;
      var st = document.createElement('style');
      st.textContent = '.dm{display:flex;flex-direction:column;gap:10px;margin:0}'
        + '.dm-r{display:flex;align-items:center;gap:12px;min-width:0}.dm-l{flex:0 0 56px;font-size:13px;color:var(--soft,#5c5468)}'
        + '.dm-to{display:inline-flex;align-items:center;gap:8px;min-width:0;max-width:100%;padding:4px 14px 4px 4px;border-radius:999px;background:var(--p-soft,#efe9fa);font-size:14px;color:var(--ink,#1b1525)}'
        + '.dm-to b{font-weight:600;white-space:nowrap}.dm-a{color:var(--soft,#5c5468);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}'
        + '.dm-av{flex:0 0 auto;width:26px;height:26px;border-radius:50%;display:inline-grid;place-items:center;font-size:11px;font-weight:700;letter-spacing:.02em;background:var(--p,#5b3fa0);color:#fff}'
        + '.dm-s{flex:1;min-width:0;font:inherit;font-size:14.5px;padding:9px 12px;min-height:40px;box-sizing:border-box;border:1px solid var(--line,#e6e1ee);border-radius:10px;background:var(--card,#fff);color:var(--ink,#1b1525)}'
        + '.dm-b{display:block;width:100%;box-sizing:border-box;min-height:150px;resize:vertical;font:inherit;font-size:14.5px;line-height:1.5;padding:12px 14px;border:1px solid var(--line,#e6e1ee);border-radius:12px;background:var(--card,#fff);color:var(--ink,#1b1525)}'
        + '.dm-sr{align-self:flex-start;max-width:100%;font:inherit;font-size:13px;color:var(--ink,#1b1525);background:var(--card,#fff);border:1px solid var(--line,#e6e1ee);border-radius:999px;padding:6px 12px;min-height:32px;cursor:pointer}'
        + '.dm-f{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap}'
        + '.dm-n{flex:1 1 220px;margin:0;display:flex;gap:8px;align-items:flex-start;font-size:12.5px;line-height:1.45;color:var(--soft,#5c5468)}.dm-n svg{flex:0 0 auto;margin-top:1px}.dm-n span{overflow-wrap:anywhere}'
        + '.dm-go{font:inherit;font-size:14px;font-weight:600;border:0;border-radius:999px;padding:10px 22px;min-height:40px;background:var(--p,#5b3fa0);color:#fff;cursor:pointer;margin-left:auto}.dm-go:disabled{opacity:.65;cursor:default}'
        + '.dm-err{margin:0;font-size:13px;color:var(--bad,#a3423a)}.dm-err:empty{display:none}.dm-hint{margin:0;font-size:12.5px;color:var(--soft,#5c5468)}'
        + '.dm-say{margin:0;font-size:13.5px;line-height:1.5;color:var(--soft,#5c5468)}.dm-say button{font:inherit;font-size:13px;font-weight:600;margin-left:6px;border:1px solid var(--line,#e6e1ee);border-radius:999px;padding:4px 12px;min-height:32px;background:var(--card,#fff);color:var(--ink,#1b1525);cursor:pointer}'
        // white on the dark theme's light purple reads 2.3:1: dark text on the filled parts
        + '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .dm-go,:root:not([data-theme="light"]) .dm-av{color:#171320}}'
        + ':root[data-theme="dark"] .dm-go,:root[data-theme="dark"] .dm-av{color:#171320}'
        // a phone: 16px type, so focusing a field never zooms the page, and finger-sized controls
        + '@media (max-width:767px){.dm-s,.dm-b{font-size:16px}.dm-s,.dm-sr,.dm-go,.dm-say button{min-height:44px}.dm-l{flex-basis:50px}.dm-go{flex:1 1 auto}}'
        + '@media (pointer:coarse){.dm-s,.dm-sr,.dm-go,.dm-say button{min-height:44px}}';
      document.head.appendChild(st);
    }
    // host: where the box draws. o: { req(path, method, body) → {ok, status, body}, ids: one of
    // {deal_id} {contact_id} {client_id}, idp: the field ids' start (idp+'Subject', idp+'Body'),
    // values: {subject, body} typed before, focus: put the caret in it once drawn, onSent(data, firstName) }
    function open(host, o) {
      style(); o = o || {};
      var req = o.req || function (p, m, b) { return window.ddsApi(p, { method: m, body: b }); };
      var k = key(o.ids), mine = String(++seq);
      host.setAttribute('data-dm', mine);
      var live = function () { return host.isConnected && host.getAttribute('data-dm') === mine; };
      if (!k) { host.innerHTML = '<p class="dm-say">Open their record to email them.</p>'; return; }
      var c = INFO[k];
      if (c && c.r) { draw(c.r); return; }   // read before: drawn at once, so a redraw keeps what's typed
      if (!c) c = INFO[k] = { p: Promise.resolve(req('/sales/email?' + k)).then(function (r) { if (r && r.ok && r.body && r.body.data) c.r = r; else delete INFO[k]; return r; }, function () { delete INFO[k]; return { ok: false, status: 0, body: {} }; }) };
      host.innerHTML = '<p class="dm-say" role="status">Getting the email ready…</p>';
      c.p.then(function (r) { if (live()) draw(r); });
      function draw(r) {
        var d = r && r.body && r.body.data;
        if (!r || !r.ok || !d) {
          // pages go live before the server's update: an older server has no /sales/email yet
          if (r && r.status === 404 && !(r.body && r.body.message)) { host.innerHTML = '<p class="dm-say">' + esc3(NOT_YET) + '</p>'; return; }
          host.innerHTML = '<p class="dm-say">' + esc3((r && r.body && r.body.message) || (r && r.status === 0 ? 'You look offline. Try again when you’re back online.' : 'We couldn’t get the email ready just now.')) + '<button type="button" class="dm-retry">Try again</button></p>';
          host.querySelector('.dm-retry').onclick = function () { open(host, o); };
          return;
        }
        var to = d.to || {}, nm = to.name || to.email || 'them', fn = first(to.name) || nm;
        if (!to.email) { host.innerHTML = '<p class="dm-say">There’s no email address on file for ' + esc3(nm) + '. Add one on their details first.</p>'; return; }
        if (d.stopped) { host.innerHTML = '<p class="dm-say">' + esc3(d.stopped === 'complaint' ? fn + ' marked an earlier email as spam, so no more email goes to them from here.' : 'Email to ' + to.email + ' bounced, so it can’t be sent there. Check the address on their details.') + '</p>'; return; }
        var idp = o.idp || ('dm' + mine), v = o.values || {};
        var back = d.replies === 'inbox' ? 'Replies come to your Inbox' : 'Replies go to ' + (d.reply_to || 'your email');
        host.innerHTML = '<form class="dm" novalidate>'
          + '<div class="dm-r"><span class="dm-l">To</span><span class="dm-to"><span class="dm-av" aria-hidden="true">' + esc3(initials(to.name || to.email)) + '</span><b>' + esc3(to.name || to.email) + '</b>' + (to.name ? '<span class="dm-a">' + esc3(to.email) + '</span>' : '') + '</span></div>'
          + '<div class="dm-r"><label class="dm-l" for="' + idp + 'Subject">Subject</label><input id="' + idp + 'Subject" class="dm-s" type="text" maxlength="200" autocomplete="off" value="' + esc3(v.subject || '') + '"></div>'
          + '<textarea id="' + idp + 'Body" class="dm-b" rows="7" maxlength="8000" placeholder="Write your email…" aria-label="Your email to ' + esc3(fn) + '">' + esc3(v.body || '') + '</textarea>'
          + (d.unsubscribed ? '<p class="dm-hint">' + esc3(fn) + ' unsubscribed from your updates. An email you write to just them still reaches them.</p>' : '')
          + '<div class="dm-f"><p class="dm-n">' + MAIL + '<span>Sent as <b>' + esc3(d.as || 'your studio') + '</b>' + (d.from ? ' from ' + esc3(d.from) : '') + ' · ' + esc3(back) + '</span></p><button type="submit" class="dm-go">Send email</button></div>'
          + '<p class="dm-err" role="alert"></p></form>';
        var form = host.querySelector('form'), subj = form.querySelector('.dm-s'), body = form.querySelector('.dm-b'), go = form.querySelector('.dm-go'), errEl = form.querySelector('.dm-err');
        // saved replies, when there are any (read once a page)
        if (!SR) SR = Promise.resolve(req('/service/saved-replies')).then(function (r) { return (r && r.ok && r.body && r.body.data && r.body.data.replies) || []; }, function () { return []; });
        SR.then(function (list) {
          if (!list.length || !body.isConnected || form.querySelector('.dm-sr')) return;
          var map = {}; list.forEach(function (x) { map[x.id] = x.body; });
          var sel = document.createElement('select'); sel.className = 'dm-sr'; sel.setAttribute('aria-label', 'Insert a saved reply');
          sel.innerHTML = '<option value="">Insert a saved reply…</option>' + list.map(function (x) { return '<option value="' + esc3(x.id) + '">' + esc3(x.title) + '</option>'; }).join('');
          sel.onchange = function () { var b = map[sel.value]; if (b) { var cur = body.value; body.value = cur ? cur.replace(/\s*$/, '') + '\n\n' + b : b; body.dispatchEvent(new Event('input', { bubbles: true })); body.focus(); } sel.value = ''; };
          body.parentNode.insertBefore(sel, body);
        });
        function err(m) { errEl.textContent = m || ''; }
        function ready() { go.disabled = false; go.textContent = 'Send email'; }
        form.addEventListener('input', function () { if (errEl.textContent) err(''); });
        body.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } });
        form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
        if (o.focus) (subj.value ? body : subj).focus({ preventScroll: true });
        function send() {
          if (go.disabled) return;
          var s = subj.value.trim(), b = body.value.trim();
          if (!s) { err('Give the email a subject.'); subj.focus(); return; }
          if (!b) { err('Write your message first.'); body.focus(); return; }
          go.disabled = true; go.textContent = 'Sending…'; err('');
          var payload = {}; for (var x in o.ids) if (o.ids[x]) payload[x] = o.ids[x];
          payload.subject = s; payload.body = b;
          Promise.resolve(req('/sales/email', 'POST', payload)).then(function (r) {
            ready();
            if (r && r.ok && r.body && r.body.data && r.body.data.sent) { subj.value = ''; body.value = ''; if (o.onSent) o.onSent(r.body.data, fn); return; }
            err(r && r.status === 404 && !(r.body && r.body.message) ? NOT_YET : (r && r.body && r.body.message) || (r && r.status === 0 ? 'You look offline. Nothing was sent.' : 'That didn’t send, and nothing went out. Try again in a moment.'));
          }, function () { ready(); err('That didn’t send, and nothing went out. Try again in a moment.'); });
        }
      }
    }
    return { open: open };
  })();

  // ── DOM ──
  var root, sb, CTX = null, DESTS = [];
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  function brandCtxLabel(nav, sectionKey) {
    var lbl = '';
    (nav || []).forEach(function (s) { if (s.key === sectionKey) lbl = s.label; });
    return lbl;
  }

  // Section-level active state (the underline) is SEPARATE from item-level
  // aria-current: a record page (/crm.html) is Customers WORK, so the Customers
  // section underlines — but no item link gets `here`/aria-current there,
  // because the operator is not ON any of those pages (screen-reader honesty).
  function activeSectionKey(nav, itemKey) {
    var k = null;
    (nav || []).forEach(function (s) { if ((s.items || []).some(function (i) { return i.key === itemKey; })) k = s.key; });
    if (!k && normalizePath(location.pathname) === '/crm' && (nav || []).some(function (s) { return s.key === 'customers'; })) k = 'customers';
    return k;
  }

  var UTILS = [];
  // The body of a multi-item section's dropdown. Factored out so the Customers
  // caret can REBUILD it each time it opens (recents re-read from localStorage —
  // the record you just opened shows up without a reload; cross-tab too).
  function sectionMenuHtml(sec, activeKey) {
    var items = visibleItems(sec).map(function (i) { return '<a href="' + esc(withScope(i.href)) + '" class="' + (i.key === activeKey ? 'here' : '') + '"' + (i.key === activeKey ? ' aria-current="page"' : '') + '>' + esc(i.label) + '</a>'; }).join('');
    // The Customers caret also lists RECENT RECORDS (⌘K/crm.html opens,
    // localStorage-cached — see pushRecent) + quick actions. Recents hrefs are
    // full record URLs (they already carry their identity params), so they are
    // NOT re-scoped; data-noscope keeps carryScopeGlobally's rewrite pass off
    // them too — a recent must navigate exactly as originally addressed.
    if (sec.key === 'customers') {
      var recents = readRecents();
      if (recents.length) {
        items += '<div class="grp">Recent</div>' + recents.map(function (r) {
          return '<a class="rec" data-noscope="1" href="' + esc(r.href) + '">' + esc(r.label) + '</a>';
        }).join('');
      }
      // "+ New deal" links plain /pipeline.html — pipeline.html has no ?new=1
      // handling today (verified), so the link opens the pipeline where the
      // + New deal button sits, rather than carrying a dead parameter.
      items += '<div class="grp">Quick actions</div>' +
        '<a class="qa" href="' + esc(withScope('/pipeline.html')) + '">+ New deal</a>' +
        '<a class="qa" href="' + esc(withScope('/contacts.html')) + '">+ Contact</a>';
    }
    return items;
  }
  // The bell's contents (icon + badge) — factored out of render() so the B4
  // refresh below can repaint JUST the badge without re-rendering the whole bar
  // (a re-render would tear down any open dropdown under the operator's cursor).
  // ── Visual refresh: stroke icons for the chrome and the nav (no emoji) ──────
  // Keyed by nav section key; unknown keys fall back to a plain dot so a new
  // section never renders without an icon slot (the sidebar aligns labels on it).
  var ICON = {
    today: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    overview: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    record: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>',
    project: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    messages: '<path d="M4 5h16v11H9l-5 4z"/>',
    get_started: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/>',
    connections: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6"/>',
    inbox: '<path d="M3 13l2-8h14l2 8v6H3z"/><path d="M3 13h5l1.5 3h5L16 13h5"/>',
    customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5A5 5 0 0 1 21.5 20"/>',
    pipeline: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="9.5" y="4" width="5" height="10" rx="1"/><rect x="16" y="4" width="5" height="13" rx="1"/>',
    projects: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    files: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
    analytics: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15l4-5 3 3 5-6"/>',
    website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    studio: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>',
    client: '<path d="M4 4h16v12H4z"/><path d="M8 20h8M12 16v4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5"/><path d="M12 17h.01"/>',
    account: '<circle cx="12" cy="9" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    dot: '<circle cx="12" cy="12" r="3"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    // ⌘K results (sales item 84): a document, a to-do, a note, money, a phone
    doc: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    todo: '<path d="M5 12l4 4 10-10"/>',
    todos: '<path d="M5 12l4 4 10-10"/>',   // sales item 85: the To-dos page in the menu
    invoices: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',   // …and Invoices
    note: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>'
  };
  function icon(key, cls) { return '<svg class="' + (cls || 'nic') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICON[key] || ICON.dot) + '</svg>'; }
  function bellInner(n) { return icon('bell') + (n > 0 ? '<span class="dot">' + (n > 9 ? '9+' : n) + '</span>' : ''); }

  // ── "+ Create" (sales list item 70, the bold redesign, Nov 2026) ─────────────
  // Timed against Salesforce, every everyday job (log a call, a new deal, an
  // invoice, a proposal, a to-do) began by finding the customer and opening
  // their page. A studio at studio level with the sales tools (Pipeline in its
  // menu) gets one button for all of them on every page: the top of the
  // sidebar, the middle of the phone bar, "c", ⌘K ("log a call") and any
  // "#create:<kind>" link. create.js draws the forms; it loads while the
  // browser is idle, so the first press opens at once.
  function canCreate() {
    if (!CTX || !CTX.is_agency || (CTX.scope && CTX.scope.name) || isReviewerCtx()) return false;
    return (CTX.nav || []).some(function (s) { return s.key === 'pipeline'; });
  }
  var createP = null;
  function loadCreate() {
    if (window.ddsCreate) return Promise.resolve(window.ddsCreate);
    if (!createP) createP = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = '/create.js'; sc.async = true;
      sc.onload = function () { if (window.ddsCreate) resolve(window.ddsCreate); else { createP = null; reject(new Error('create')); } };
      sc.onerror = function () { createP = null; sc.remove(); reject(new Error('create')); };
      document.head.appendChild(sc);
    });
    return createP;
  }
  // viaKey: opened from the keyboard, so the menu's first job takes focus (a tap leaves no ring)
  // preset: { deal_id } starts the form on that deal (a page that already knows
  // it, like the Customers preview)
  function openCreate(kind, from, viaKey, preset) {
    if (!canCreate()) return false;
    closeAllLayers(); closePalette();
    loadCreate().then(function (c) { c.open(kind || '', from || null, !!viaKey, preset || null); }, function () {
      if (window.ddsToast) window.ddsToast('Create didn’t load — check your connection and try again.', 'err');
    });
    return true;
  }
  window.ddsOpenCreate = openCreate;
  // ── Tap to call, then log it (sales item 89, Nov 2026) ──────────────────────
  // A phone number on a deal (data-call-deal) is a call link. The tap is kept for half
  // an hour; coming back to the page (a phone returns from its dialler) offers to log
  // that call on the deal in one tap, through + Create's Log a call. Nothing is logged
  // by itself, and a tap that never left the page (a computer with no phone app) asks nothing.
  var CALL_KEY = 'dds-call-tap';
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="tel:"][data-call-deal]') : null;
    if (!a || !a.getAttribute('data-call-deal')) return;
    try { sessionStorage.setItem(CALL_KEY, JSON.stringify({ deal: a.getAttribute('data-call-deal'), who: a.getAttribute('data-call-who') || '', at: Date.now(), left: false })); } catch (_) { /* storage may be denied */ }
  }, true);
  function callTap() { try { return JSON.parse(sessionStorage.getItem(CALL_KEY) || 'null'); } catch (_) { return null; } }
  function dropCallTap() { try { sessionStorage.removeItem(CALL_KEY); } catch (_) { /* */ } }
  // Asked once, from whichever comes last: the page showing again, or the shell learning
  // who is signed in. A page back before its first read has finished keeps the question
  // until then, and a phone that reloaded the page during the call (no visibilitychange
  // comes after a reload) still asks.
  function offerCallLog() {
    var t = callTap();
    if (!t || !t.left || document.visibilityState === 'hidden') return;
    if (Date.now() - t.at > 30 * 60000) { dropCallTap(); return; }
    if (!CTX) return;   // asked again on dds:context
    dropCallTap();
    if (!canCreate() || !window.ddsToast) return;
    var ask = window.ddsToast('Back from your call' + (t.who ? ' with ' + t.who : '') + '?', 'ok', { label: 'Log it', onClick: function () { openCreate('call', null, false, { deal_id: t.deal }); } });
    // an open sheet (a modal dialog, like the deal's preview on a phone) blocks taps on everything
    // outside it, so the question goes inside the sheet
    var sheet = null; try { sheet = document.querySelector('dialog:modal'); } catch (_) { /* an older browser: no :modal */ }
    if (sheet && ask && ask.parentNode !== sheet) sheet.appendChild(ask);
  }
  document.addEventListener('visibilitychange', function () {
    var t = callTap(); if (!t) return;
    if (document.visibilityState === 'hidden') { t.left = true; try { sessionStorage.setItem(CALL_KEY, JSON.stringify(t)); } catch (_) { /* */ } return; }
    if (!t.left) { dropCallTap(); return; }   // a tap that never left the page asks nothing
    offerCallLog();
  });
  document.addEventListener('dds:context', offerCallLog);
  // ⌘K finds them by what you'd type ("log a call", "invoice"); listed last so
  // a page's own name still comes first
  var CREATE_DESTS = [
    { key: 'create_call', create: 'call', label: 'Log a call', section: 'Create', desc: 'phone call talked note' },
    { key: 'create_deal', create: 'deal', label: 'New deal', section: 'Create', desc: 'add a deal lead' },
    { key: 'create_invoice', create: 'invoice', label: 'Send an invoice', section: 'Create', desc: 'new invoice bill' },
    { key: 'create_proposal', create: 'proposal', label: 'Send a proposal', section: 'Create', desc: 'new proposal quote' },
    { key: 'create_todo', create: 'todo', label: 'Add a to-do', section: 'Create', desc: 'new task reminder' },
  ].map(function (d) { d.href = '#create:' + d.create; return d; });
  var SETTINGS_DESTS = [
    { key: 'set_stages', label: 'Deal stages', section: 'Settings', desc: 'stage names rename pipeline chance', href: '/settings.html#stages' },
    { key: 'set_automations', label: 'Automations', section: 'Settings', desc: 'reminders follow up review request automatic emails switches', href: '/settings.html#automations' },
  ];
  // "#create" or "#create:call" in the address (a link from another page, a
  // bookmark) opens it once; the hash is cleared so a reload doesn't reopen it
  var CREATE_HASH = /^#create(?::(call|deal|invoice|proposal|todo|customer|update))?$/;
  function createFromHash() {
    var m = CREATE_HASH.exec(location.hash || '');
    if (!m || !canCreate()) return;
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (_) { /* */ }
    openCreate(m[1] || '', document.getElementById('dds-create'));
  }
  window.addEventListener('hashchange', createFromHash);

  function render() {
    var nav = (CTX && CTX.nav) || [];
    var activeKey = activeItemKey(location.pathname, nav);
    // Slice 7 (context bar): crm.html is never IN the nav (records open from
    // rosters/⌘K), but a record page is Customers work — activeSectionKey keeps
    // the Customers SECTION lit (underline) so the flat bar never reads
    // "nowhere", while item-level `here`/aria-current stays honest (only a
    // genuine item href match earns it). The pure activeItemKey mirror of
    // lib/shell.ts stays byte-identical.
    var secKey = activeSectionKey(nav, activeKey);
    DESTS = flatten(nav);                          // ⌘K reaches EVERY capability (primary + utility)
    if (canCreate()) DESTS = DESTS.concat(CREATE_DESTS);
    // item 84: two Settings cards by name ("deal stages", "automations"), for whoever can change them
    if ((CTX && CTX.nav || []).some(function (s) { return s.key === 'settings'; }) && !(CTX.scope && CTX.scope.site_id) && !(window.ddsLacks && window.ddsLacks('configure')))
      DESTS = DESTS.concat(SETTINGS_DESTS);
    // Architecture v1.0: the primary bar is outcomes only; utility sections
    // (Connections, Settings, Help) render in the profile/overflow menu.
    // Oct 2026 nav cut: a section whose items are ALL hidden (⌘K-only) is not drawn.
    // Get started is the first run of a NEW client site. A studio at studio level
    // keeps its own draft site as a practice site, so the wizard never belongs in
    // its menu (the server stops sending it; this covers the deployed version).
    if (CTX && CTX.is_agency && !(CTX.scope && CTX.scope.name)) nav = nav.filter(function (s) { return s.key !== 'get_started'; });
    var drawn = nav.filter(function (s) { return visibleItems(s).length > 0; });
    var primary = drawn.filter(function (s) { return !s.utility; });
    UTILS = drawn.filter(function (s) { return s.utility; });
    var ctxLabel = brandCtxLabel(nav, secKey);
    var att = badgeCount();   // Phase FLOW: bell badge from context (no extra request); quiet after Mark read until the count changes

    // ── Lightning context bar (salesforce-reference §11.5): each nav SECTION is
    // ONE flat item. Single-link sections render as a plain link (aria-current
    // marks the active page — nav landmark semantics, not a tablist); multi-item
    // sections render label + caret and open their dropdown on CLICK (never
    // hover), with the slice-2 popup contract (Escape/arrows/outside-click).
    var secHtml = function (sec) {
      var vis = visibleItems(sec);
      var single = vis.length === 1;
      var isActive = sec.key === secKey;                                              // section-level: the underline (a hidden child page counts — /broadcasts lights Inbox)
      var hasItem = vis.some(function (i) { return i.key === activeKey; });           // item-level: a genuine, DRAWN href match
      if (single) {
        var it = vis[0];
        return '<div class="sec' + (isActive ? ' active' : '') + '"><a class="it" data-href="' + esc(it.href) + '" href="' + esc(withScope(it.href)) + '"' + (hasItem ? ' aria-current="page"' : '') + '>' + icon(sec.key) + '<span class="lbl">' + esc(sec.label) + '</span></a></div>';
      }
      // Visual refresh (sidebar ≥761px): a multi-item section's menu is an INLINE
      // list under its item, not a flyout — and the section you are IN starts
      // expanded (pinned: see pinnedSec), with the current page's row lit.
      var startOpen = isActive && sidebarMode();
      return '<div class="sec' + (isActive ? ' active' : '') + (startOpen ? ' open' : '') + '"><button class="it" data-sec="' + esc(sec.key) + '" aria-haspopup="true" aria-expanded="' + (startOpen ? 'true' : 'false') + '"' + (hasItem ? ' aria-current="true"' : '') + '>' + icon(sec.key) + '<span class="lbl">' + esc(sec.label) + '</span> <span class="car" aria-hidden="true">▾</span></button><div class="menu">' + sectionMenuHtml(sec, activeKey) + '</div></div>';
    };
    // Oct 2026 nav cut: the utilities (Your website · Settings · Get started until
    // live) are drawn at the FOOT of the sidebar, under a rule; on the top-bar
    // layout (phones, the website builder) shell.css hides the group and the
    // account menu lists them, as before.
    var navHtml = primary.map(secHtml).join('') + (UTILS.length ? '<div class="dds-util">' + UTILS.map(secHtml).join('') + '</div>' : '');

    // SC-1: the breadcrumb — "Studio › {client}" whenever an operator is scoped.
    var scope = CTX && CTX.scope;
    var brandHtml = scope && scope.name
      ? '<span class="dds-brand"><span class="mark">S</span><a href="/agency.html" id="dds-scope-exit" style="color:inherit;text-decoration:none">Studio</a> <span class="ctx">›</span> <span class="ctx" style="color:var(--dds-p);font-weight:600">' + esc(scope.name) + '</span></span>'
      : '<a class="dds-brand" href="' + esc((CTX && CTX.landing) || '/today.html') + '"><span class="mark">S</span>Studio OS' + (ctxLabel ? ' <span class="ctx">· ' + esc(ctxLabel) + '</span>' : '') + '</a>';
    root.innerHTML =
      // The App Launcher waffle (the burger's successor at EVERY width): CLICK-
      // invoked only (§11.5 — the one nav element that never opens on hover);
      // its panel is the full grouped destination list the burger sheet held.
      '<button class="dds-ic dds-waffle" id="dds-waffle" aria-label="App Launcher" aria-haspopup="true" aria-expanded="false" aria-controls="dds-drawer"><span class="wic" aria-hidden="true"></span></button>' +
      brandHtml +
      (canCreate() ? '<button type="button" class="dds-create" id="dds-create" aria-haspopup="dialog" aria-expanded="false" aria-keyshortcuts="c">' + icon('plus') + '<span class="lbl">Create</span><kbd aria-hidden="true">C</kbd></button>' : '') +
      '<nav class="dds-nav" aria-label="Workspace">' + navHtml + '</nav>' +
      '<div class="dds-search" id="dds-search" role="button" tabindex="0" aria-label="Search"><span>' + icon('search', 'nic') + '</span><span>Search</span><kbd>' + (/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl K') + '</kbd></div>' +
      '<div class="dds-right">' +
        '<button class="dds-ic" id="dds-bell" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">' + bellInner(att) + '</button>' +
        '<a class="dds-ic" href="/help.html" id="dds-help" aria-label="Help — how do I…?" aria-haspopup="true" aria-expanded="false">' + icon('help') + '</a>' +
        '<button class="dds-ic" id="dds-profile" aria-label="Account" aria-haspopup="true" aria-expanded="false">' + icon('account') + '</button>' +
      '</div>';

    wire(nav);
    mountMobileBar(nav, activeKey, att);
    mountContextBar(scope);
    if (canCreate()) {
      (window.requestIdleCallback || function (f) { return setTimeout(f, 1500); })(function () { loadCreate()['catch'](function () { /* a press retries */ }); });
      createFromHash();
    }
  }

  // ── client context bar (Phase 1 overhaul) ────────────────────────────────────
  // Whenever an agency operator is drilled into ONE client, a colored band sits
  // under the top bar saying so — with the record, the client's own Today, and
  // the exit back to the studio. The breadcrumb alone ("Studio › name") was too
  // quiet: the studio-level and client-level pages look identical otherwise.
  function mountContextBar(scope) {
    var old = document.getElementById('dds-ctxbar'); if (old) old.remove();
    closeBizSwitch(false);
    // builder item 83: someone with a place in two or more businesses sees which one this is, and can switch
    var biz = !(scope && scope.name) ? businessInHand() : null;
    if (biz) { mountBusinessBar(biz); return; }
    if (!scope || !scope.name || !CTX || !CTX.is_agency) { document.documentElement.classList.remove('dds-has-ctxbar'); return; }
    // Oct 2026 nav cut: the card carries WHO (initials + name) and the way out.
    // Their record, Today and website are the client's own menu items now
    // (Record · Overview · Website), not links here. Item 96: "Switch client" and
    // "Exit to studio" both opened Home, so it is one "Back to studio" until a
    // real client switcher exists.
    var initials = String(scope.name).split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || 'C';
    var bar = el('<div id="dds-ctxbar" role="region" aria-label="Client context">' +
      '<span class="lbl">Viewing client</span>' +
      '<span class="who"><span class="av" aria-hidden="true">' + esc(initials) + '</span><strong>' + esc(scope.name) + '</strong></span>' +
      '<span class="acts">' +
        // item 44 (Nov 9 2026): jump to another site from inside one, like Wix's All Sites switcher
        '<button type="button" class="switch" id="dds-site-switch" aria-haspopup="dialog" aria-expanded="false" aria-controls="dds-sites-pop">Switch site</button>' +
        '<a href="/agency.html" class="exit" data-noscope="1">Back to studio</a>' +
      '</span></div>');
    bar.querySelector('#dds-site-switch').addEventListener('click', function (e) { e.stopPropagation(); toggleSiteSwitch(); });
    // Visual refresh: the bar lives INSIDE the shell so the desktop sidebar can
    // lay it out as a card ABOVE the client's menu; on phones shell.css keeps it
    // fixed under the top bar (a fixed child escapes the column's flow).
    root.appendChild(bar);
    document.documentElement.classList.add('dds-has-ctxbar');
  }

  // ── builder item 83 (Nov 2026): one person, two businesses ─────────────────────
  // /portal/context lists `businesses` only for someone invited somewhere with two or
  // more, each with their role in words, the one in hand marked `current` and the one
  // the server opens unasked marked `default`. The bar says which business this is
  // ("You’re Staff"); Switch business lists them. A pick opens that business's own
  // first page: the default one with no ?client=, any other with ?client=<its id>,
  // which every page already sends, and which the server reads as one of the person's
  // own businesses, never as a studio inside a client. A business seen through the
  // client portal opens at the client door. The last one used is remembered, so the
  // sign-in doors open it next time.
  var HELD_KEY = 'dds-held-businesses', LAST_KEY = 'dds-last-business';
  function businessInHand() {
    if (!CTX || (CTX.scope && CTX.scope.site_id) || !CTX.business) return null;
    return Array.isArray(CTX.businesses) && CTX.businesses.length > 1 ? CTX.business : null;
  }
  function rememberBusinesses() {
    try {
      var list = CTX && Array.isArray(CTX.businesses) ? CTX.businesses : [];
      if (list.length > 1) localStorage.setItem(HELD_KEY, JSON.stringify(list.map(function (b) { return b.site_id; })));
      else localStorage.removeItem(HELD_KEY);
      if (list.length > 1 && CTX.business && ctxUid) localStorage.setItem(LAST_KEY, JSON.stringify({ uid: ctxUid, site_id: CTX.business.site_id }));
    } catch (_) { /* storage may be denied: the bar still works, nothing is remembered */ }
  }
  // the URL scope is one of this person's own businesses (known before the context lands, from the last visit)
  function heldBusinessId(id) {
    if (!id) return false;
    if (CTX && Array.isArray(CTX.businesses) && CTX.businesses.some(function (b) { return b.site_id === id; })) return true;
    try { var held = JSON.parse(localStorage.getItem(HELD_KEY) || '[]'); return Array.isArray(held) && held.indexOf(id) >= 0; } catch (_) { return false; }
  }
  function bizInitials(name) { return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || 'B'; }
  function bizRoleLine(b) {
    if (b.role === 'client_reviewer') return 'You review its work · opens the client view';
    return b.role_words === 'Owner' ? 'You own it' : 'You’re ' + b.role_words;
  }
  function mountBusinessBar(b) {
    var bar = el('<div id="dds-ctxbar" class="biz" role="region" aria-label="Your business">' +
      '<span class="lbl">' + esc(b.role_words === 'Owner' ? 'You own it' : 'You’re ' + b.role_words) + '</span>' +
      '<span class="who"><span class="av" aria-hidden="true">' + esc(bizInitials(b.name)) + '</span><strong>' + esc(b.name) + '</strong></span>' +
      '<span class="acts"><button type="button" class="switch" id="dds-biz-switch" aria-haspopup="dialog" aria-expanded="false" aria-controls="dds-biz-pop">Switch business</button></span></div>');
    bar.querySelector('#dds-biz-switch').addEventListener('click', function (e) { e.stopPropagation(); toggleBizSwitch(); });
    root.appendChild(bar);
    document.documentElement.classList.add('dds-has-ctxbar');
  }
  function bizPop() { return document.getElementById('dds-biz-pop'); }
  function closeBizSwitch(refocus) {
    var pop = bizPop(); if (pop) pop.remove();
    var b = document.getElementById('dds-biz-switch'); if (b) { b.setAttribute('aria-expanded', 'false'); if (refocus) b.focus(); }
  }
  function toggleBizSwitch() {
    if (bizPop()) { closeBizSwitch(true); return; }
    var btn = document.getElementById('dds-biz-switch'); if (!btn || !CTX) return;
    [].forEach.call(document.querySelectorAll('.dds-pop.open'), function (o) { o.classList.remove('open'); });
    var list = CTX.businesses || [];
    var pop = el('<div class="dds-pop dds-sites-pop open" id="dds-biz-pop" role="dialog" aria-label="Your businesses">' +
      '<div class="n" style="font-weight:600;padding:4px 6px 8px">Your businesses</div>' +
      (list.length > 6 ? '<input type="search" class="q" id="dds-biz-q" placeholder="Find a business…" aria-label="Find a business" autocomplete="off">' : '') +
      '<div class="list" id="dds-biz-list" role="list"></div>' +
      '<div class="sub" style="font-size:12px;color:var(--dds-faint);padding:8px 6px 2px">Each business keeps its own pages, people and settings. Next time you sign in, you come back to the last one you used.</div></div>');
    document.body.appendChild(pop);
    btn.setAttribute('aria-expanded', 'true');
    paintBizRows(pop, '');
    placeSiteSwitch(btn, pop);
    var q = pop.querySelector('#dds-biz-q');
    var firstRow = pop.querySelector('.list a.row');
    (q || firstRow || btn).focus();
    pop.addEventListener('click', function (e) { e.stopPropagation(); });
    pop.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeBizSwitch(true); return; }
      var rows = [].slice.call(pop.querySelectorAll('.list a.row'));
      var i = rows.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (rows[i + 1] || rows[0] || q).focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? rows[i - 1] : (q || rows[rows.length - 1])).focus(); }
    });
    if (q) q.addEventListener('input', function () { paintBizRows(pop, q.value); });
  }
  function paintBizRows(pop, query) {
    var box = pop.querySelector('#dds-biz-list'); if (!box) return;
    var q = String(query || '').trim().toLowerCase();
    var rows = (CTX.businesses || []).filter(function (b) { return !q || String(b.name || '').toLowerCase().indexOf(q) >= 0; });
    if (!rows.length) { box.innerHTML = '<div class="muted">No business matches that.</div>'; return; }
    box.innerHTML = rows.map(function (b) {
      return '<a class="row site' + (b.current ? ' now' : '') + '" role="listitem" href="#" data-biz="' + esc(b.site_id) + '" data-noscope="1"' + (b.current ? ' aria-current="true"' : '') + '>' +
        '<span class="av" aria-hidden="true">' + esc(bizInitials(b.name)) + '</span><span class="tx"><span class="n">' + esc(b.name) + '</span><span class="sub">' + esc(bizRoleLine(b)) + (b.current ? ' · here now' : '') + '</span></span></a>';
    }).join('');
    [].forEach.call(box.querySelectorAll('[data-biz]'), function (a) { a.addEventListener('click', function (e) { e.preventDefault(); openBusiness(a.getAttribute('data-biz')); }); });
  }
  // a business's own first page, as the server says for that business (a studio's client lands in the portal)
  function openBusiness(id) {
    var b = (CTX && CTX.businesses || []).filter(function (x) { return x.site_id === id; })[0];
    if (!b) return;
    if (b.current) { closeBizSwitch(true); return; }
    try { if (ctxUid) localStorage.setItem(LAST_KEY, JSON.stringify({ uid: ctxUid, site_id: id })); } catch (_) { /* */ }
    var withId = function (path) { return b['default'] ? path : path + (path.indexOf('?') >= 0 ? '&' : '?') + 'client=' + encodeURIComponent(id); };
    if (b.role === 'client_reviewer') { location.href = withId('/portal.html'); return; }
    fetch(FN + '/portal/context', { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-dds-user-jwt': TOKEN, 'x-dds-scope-site': b['default'] ? '' : id } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var land = j && j.data && j.data.landing;
        if (!land || !SAFE_HREF.test(land)) { if (window.ddsToast) window.ddsToast('That business wouldn’t open just now. Try again in a moment.', 'err'); return; }
        location.href = land === '/client.html' ? withId('/portal.html') : withId(land);
      })['catch'](function () { if (window.ddsToast) window.ddsToast('That business wouldn’t open just now. Try again in a moment.', 'err'); });
  }
  document.addEventListener('click', function () { if (bizPop()) closeBizSwitch(false); });
  window.addEventListener('resize', function () { var b = document.getElementById('dds-biz-switch'), p = bizPop(); if (b && p) placeSiteSwitch(b, p); });

  // ── item 44 (Nov 9 2026): the site switcher. "Switch site" on the client card
  // opens a small panel with a search box and every site the studio looks after
  // (the same rows the Sites page shows, GET /agency/sites at studio level, read
  // once per page and kept). A pick opens that site's own home, as the Sites page
  // does; "All sites" opens the Sites page. Escape or a click outside closes it. ──
  var SWITCH_ROWS = null, SWITCH_LOADING = null;
  function siteRows() {
    if (SWITCH_ROWS) return Promise.resolve(SWITCH_ROWS);
    if (SWITCH_LOADING) return SWITCH_LOADING;
    SWITCH_LOADING = fetch(FN + '/agency/sites', { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-dds-user-jwt': TOKEN, 'x-dds-scope-site': '' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) { if (!b || !Array.isArray(b.data)) return null; SWITCH_ROWS = b.data; return SWITCH_ROWS; })   // a failed read is said, never "no sites"; the next open tries again
      .catch(function () { return null; })
      .then(function (rows) { SWITCH_LOADING = null; return rows; });
    return SWITCH_LOADING;
  }
  function siteSwitchPop() { return document.getElementById('dds-sites-pop'); }
  function closeSiteSwitch(refocus) {
    var pop = siteSwitchPop(); if (pop) pop.remove();
    var b = document.getElementById('dds-site-switch'); if (b) { b.setAttribute('aria-expanded', 'false'); if (refocus) b.focus(); }
  }
  function toggleSiteSwitch() {
    if (siteSwitchPop()) { closeSiteSwitch(true); return; }
    var btn = document.getElementById('dds-site-switch'); if (!btn) return;
    [].forEach.call(document.querySelectorAll('.dds-pop.open'), function (o) { o.classList.remove('open'); });   // one panel at a time
    var pop = el('<div class="dds-pop dds-sites-pop open" id="dds-sites-pop" role="dialog" aria-label="Switch site">' +
      '<input type="search" class="q" id="dds-sites-q" placeholder="Find a site…" aria-label="Find a site" autocomplete="off">' +
      '<div class="list" id="dds-sites-list" role="list"><div class="muted">Loading your sites…</div></div>' +
      '<a class="row all" href="/sites.html" data-noscope="1">All sites →</a></div>');
    document.body.appendChild(pop);
    btn.setAttribute('aria-expanded', 'true');
    placeSiteSwitch(btn, pop);
    var q = pop.querySelector('#dds-sites-q'); q.focus();
    pop.addEventListener('click', function (e) { e.stopPropagation(); });
    pop.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeSiteSwitch(true); return; }
      // arrows move between the box and the rows
      var rows = [].slice.call(pop.querySelectorAll('.list a.row'));
      var i = rows.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (rows[i + 1] || rows[0] || q).focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? rows[i - 1] : q).focus(); }
    });
    q.addEventListener('input', function () { paintSiteRows(pop, q.value); });
    siteRows().then(function (rows) {
      if (!siteSwitchPop()) return;
      if (rows === null) { pop.querySelector('#dds-sites-list').innerHTML = '<div class="muted">Couldn’t load your sites just now.</div>'; return; }
      paintSiteRows(pop, q.value);
    });
  }
  function placeSiteSwitch(btn, pop) {
    var r = btn.getBoundingClientRect();
    pop.style.right = 'auto'; pop.style.bottom = 'auto';   // the sidebar layout pins panels to the bottom; this one hangs from its button
    var left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left));
    var below = r.bottom + 6 + pop.offsetHeight <= window.innerHeight - 8;
    pop.style.left = left + 'px';
    pop.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - 6 - pop.offsetHeight)) + 'px';
  }
  function paintSiteRows(pop, query) {
    var list = pop.querySelector('#dds-sites-list'); if (!list) return;
    var q = String(query || '').trim().toLowerCase();
    var here = scopeId();
    var host = function (u) { return String(u || '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''); };
    var rows = (SWITCH_ROWS || []).filter(function (x) {
      if (!q) return true;
      return [x.name, x.domain, host(x.address), (x.tags || []).join(' ')].some(function (v) { return String(v || '').toLowerCase().indexOf(q) >= 0; });
    });
    if (!rows.length) { list.innerHTML = '<div class="muted">' + (SWITCH_ROWS && SWITCH_ROWS.length ? 'No site matches that.' : 'No client sites yet.') + '</div>'; return; }
    list.innerHTML = rows.map(function (x) {
      var now = x.site_id === here;
      var ini = String(x.name || '?').trim().charAt(0).toUpperCase();
      return '<a class="row site' + (now ? ' now' : '') + '" role="listitem" href="/today.html?client=' + encodeURIComponent(x.site_id) + '" data-noscope="1"' + (now ? ' aria-current="true"' : '') + '>' +
        '<span class="av" aria-hidden="true">' + esc(ini) + '</span><span class="tx"><span class="n">' + esc(x.name || '(unnamed)') + '</span><span class="sub">' + esc(host(x.address) || x.domain || 'No address yet') + (x.state_words ? ' · ' + esc(x.state_words) : '') + (now ? ' · here now' : '') + '</span></span></a>';
    }).join('');
  }
  document.addEventListener('click', function () { if (siteSwitchPop()) closeSiteSwitch(false); });
  window.addEventListener('resize', function () { var b = document.getElementById('dds-site-switch'), p = siteSwitchPop(); if (b && p) placeSiteSwitch(b, p); });

  // ── mobile bottom bar (≤760px): the daily loop in one tap — Today · Inbox ·
  //    Menu. presence.html keeps its own dock, so we stay out of its way. ──
  function mountMobileBar(nav, activeKey, att) {
    if (location.pathname.indexOf('/presence') === 0) return;
    var isReviewer = (CTX && CTX.site_role === 'client_reviewer') || (CTX && CTX.is_managed_client);
    var old = document.getElementById('dds-mbar'); if (old) old.remove();
    var bar = document.createElement('nav');
    bar.id = 'dds-mbar'; bar.setAttribute('aria-label', 'Quick navigation');
    // Oct 2026 nav cut: the bar follows the same list as the menu. Inside a
    // client the first item is the client's (Overview) and the second is their
    // Messages; at studio level / for an owner it is Home (the landing) · Inbox.
    var scopedNow = !!(CTX && CTX.scope && CTX.scope.name && CTX.is_agency);
    var firstPrimary = null, inboxItem = null, inboxHidden = false;
    (nav || []).forEach(function (s) {
      var vis = visibleItems(s);
      if (!s.utility && !firstPrimary && vis.length) firstPrimary = vis[0];
      vis.forEach(function (i) { if (!inboxItem && (i.key === 'inbox' || i.key === 'messages')) inboxItem = i; });
      // bug hunt C17: the studio hid Inbox in Settings › Your menu (its items come ⌘K-only)
      ((s && s.items) || []).forEach(function (i) { if (i && i.hidden && i.key === 'inbox' && s.key === 'inbox') inboxHidden = true; });
    });
    var home = isReviewer ? { href: '/client.html', label: 'Updates' }
      : (scopedNow && firstPrimary) ? { href: firstPrimary.href, label: firstPrimary.label }
      : { href: (CTX && CTX.landing) || '/today.html', label: 'Home' };
    // the fallback stands in for a menu that names no Inbox at all, never for one the studio hid
    var inbox = isReviewer ? null : inboxItem ? { href: inboxItem.href, label: inboxItem.label } : inboxHidden ? null : { href: '/inbox.html', label: 'Inbox' };
    var herePath = normalizePath(location.pathname);
    var cur = function (href) { return normalizePath(href) === herePath ? ' aria-current="page"' : ''; };
    // Look refresh E: an icon over each word (the words stay the names)
    var homeA = '<a href="' + esc(withScope(home.href)) + '"' + cur(home.href) + '>' + icon(isReviewer ? 'messages' : 'home') + '<span class="mlbl">' + esc(home.label) + '</span></a>';
    var inboxA = inbox ? '<a data-mbar="inbox" href="' + esc(withScope(inbox.href)) + '"' + cur(inbox.href) + '>' + icon('inbox') + '<span class="mlbl">' + esc(inbox.label) + (att > 0 ? ' <span class="mdot">' + (att > 9 ? '9+' : att) + '</span>' : '') + '</span></a>' : '';
    // The bold redesign (item 70): a studio at studio level gets the sales loop,
    // Home · Inbox · + · Pipeline · Customers. The + opens Create; the rest of
    // the menu is the top bar's App Launcher, which opens the same drawer.
    var first = function (key) { var f = null; (nav || []).forEach(function (s) { if (!f && s.key === key) f = visibleItems(s)[0] || null; }); return f; };
    var pipe = canCreate() ? first('pipeline') : null, custs = pipe ? first('customers') : null;
    if (pipe && custs) {
      bar.className = 'sales';
      bar.innerHTML = homeA + inboxA +
        '<button type="button" id="dds-mbar-create" class="mplus" aria-label="Create" aria-haspopup="dialog" aria-expanded="false">' + icon('plus') + '</button>' +
        '<a href="' + esc(withScope(pipe.href)) + '"' + cur(pipe.href) + '>' + icon('pipeline') + '<span class="mlbl">' + esc(pipe.label) + '</span></a>' +
        '<a href="' + esc(withScope(custs.href)) + '"' + cur(custs.href) + '>' + icon('customers') + '<span class="mlbl">' + esc(custs.label) + '</span></a>';
      document.body.appendChild(bar);
      var plus = document.getElementById('dds-mbar-create');
      plus.addEventListener('click', function (e) { e.stopPropagation(); openCreate('', plus, e.detail === 0); });
      return;
    }
    // bug hunt A3: a studio that hid Pipeline or Customers in Your menu still creates;
    // on a phone the + is the only Create button, so it stays (Home · Inbox · + · Menu)
    var plusHere = canCreate();
    if (plusHere) bar.className = 'plus';
    bar.innerHTML = homeA + inboxA +
      (plusHere ? '<button type="button" id="dds-mbar-create" class="mplus" aria-label="Create" aria-haspopup="dialog" aria-expanded="false">' + icon('plus') + '</button>' : '') +
      '<button type="button" id="dds-mbar-menu" aria-expanded="false" aria-controls="dds-drawer" aria-haspopup="true">' + icon('menu') + '<span class="mlbl">Menu</span></button>';
    document.body.appendChild(bar);
    var plus2 = document.getElementById('dds-mbar-create');
    if (plus2) plus2.addEventListener('click', function (e) { e.stopPropagation(); openCreate('', plus2, e.detail === 0); });
    var mb = document.getElementById('dds-mbar-menu');
    if (mb) mb.addEventListener('click', function (e) {
      e.stopPropagation(); toggleDrawer(nav, 'dds-mbar-menu');
      var open = drawer && drawer.classList.contains('open');
      mb.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  var docWired = false;   // wire() may run again on a re-render — document-level listeners register ONCE
  function wire(nav) {
    // section dropdowns — click-invoked (never hover), slice-2 popup contract:
    // a keyboard invocation focuses the first item (pointer clicks leave focus
    // on the trigger — menu-button pattern), arrows move, Escape closes back to
    // the trigger, outside clicks close via the document-level listener below.
    root.querySelectorAll('.dds-nav .sec > button[data-sec]').forEach(function (b) {
      var sec = b.parentNode;
      function openSec(focusFirst) {
        closeAllLayers();
        // the Customers caret re-reads recents each OPEN — the record you just
        // opened (this tab or another) appears without a reload
        if (b.getAttribute('data-sec') === 'customers') {
          var cs = null; (nav || []).forEach(function (x) { if (x.key === 'customers') cs = x; });
          var m0 = sec.querySelector('.menu');
          if (cs && m0) m0.innerHTML = sectionMenuHtml(cs, activeItemKey(location.pathname, nav));
        }
        sec.classList.add('open'); b.setAttribute('aria-expanded', 'true');
        if (focusFirst) { var f = sec.querySelector('.menu a'); if (f) f.focus(); }
      }
      // A pointer press on the trigger or inside the menu must NOT move focus.
      // Safari (and WebKit on iPad with a trackpad) does not focus a <button> or
      // <a> on mousedown — it moves focus to the nearest focusable ANCESTOR
      // (#main on every page) — so the focusout guard below saw focus "leave"
      // the section and closed the menu before mouseup: a menu link's click
      // fell through to the page, and a click on the trigger of an OPEN menu
      // closed-then-reopened it. Focus is placed explicitly instead: the
      // trigger after a pointer click, the first item after a keyboard one.
      sec.addEventListener('mousedown', function (e) {
        if (e.target.closest && e.target.closest('button, a')) e.preventDefault();
      });
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var wasOpen = sec.classList.contains('open');
        closeAllLayers();
        // e.detail === 0 → keyboard activation (Enter/Space): move focus into the
        // menu. A pointer click keeps focus on the trigger (menu-button pattern)
        // — placed explicitly, since the mousedown above no longer does it.
        // The trigger of an OPEN section folds it — a pinned (active, sidebar)
        // section too, since closeAllLayers leaves pinned sections alone.
        if (e.detail !== 0) b.focus();
        if (wasOpen) closeSec(sec); else openSec(e.detail === 0);
      });
      // ArrowDown from the trigger opens the menu (if needed) and enters it
      b.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowDown') return;
        e.preventDefault();
        if (!sec.classList.contains('open')) openSec(true);
        else { var f = sec.querySelector('.menu a'); if (f) f.focus(); }
      });
      // focus leaving the section (menu AND trigger) closes it — no stuck-open
      // panel after Tab-out. Never steals focus back on this path. A NULL
      // relatedTarget is NOT "focus left the document": on iOS Safari a tap
      // blurs the current element and focuses nothing, so closing here would
      // un-render the menu between pointerdown and click and eat the tap
      // (.dds-nav shows ≥761px and iPads have touch). Only a demonstrable move
      // to an element OUTSIDE the section closes it.
      sec.addEventListener('focusout', function (e) {
        if (!sec.classList.contains('open')) return;
        var to = e.relatedTarget;
        if (!to) return;                      // iOS tap / focus left the document — keep open
        if (sec.contains(to)) return;         // focus moved WITHIN the section — keep open
        if (pinnedSec(sec)) return;           // the section you are in stays expanded (sidebar)
        closeSec(sec);
      });
      var menu = sec.querySelector('.menu');
      if (menu) menu.addEventListener('keydown', function (e) {
        var links = [].slice.call(menu.querySelectorAll('a'));
        var i = links.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenus(); closeSec(sec); b.focus(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); if (links.length) links[Math.min(i + 1, links.length - 1)].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); if (links.length) links[Math.max(i - 1, 0)].focus(); }
      });
    });
    var cr = document.getElementById('dds-create');
    if (cr) cr.addEventListener('click', function (e) { e.stopPropagation(); openCreate('', cr, e.detail === 0); });
    // search
    var s = document.getElementById('dds-search');
    s.addEventListener('click', openPalette);
    s.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPalette(); } });
    if (!docWired) {
      docWired = true;
      document.addEventListener('click', closeMenus);
      document.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); } });
    }
    // bell + profile
    document.getElementById('dds-bell').addEventListener('click', function (e) { e.stopPropagation(); toggleNotifications(); });
    document.getElementById('dds-profile').addEventListener('click', function (e) { e.stopPropagation(); toggleProfile(); });
    // in-app help (HELP-1): the "?" opens a grounded "how do I…?" panel; the href
    // stays a real fallback to the full Help page if JS is off.
    var helpTrig = document.getElementById('dds-help');
    if (helpTrig) helpTrig.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleHelp(); });
    // waffle App Launcher — CLICK-invoked; the panel is the drawer element
    document.getElementById('dds-waffle').addEventListener('click', function (e) { e.stopPropagation(); toggleDrawer(nav, 'dds-waffle'); });
    // create the (closed) panel now so aria-controls="dds-drawer" always
    // references a real element, not a lazily-created one
    ensureDrawer();
  }
  // The sidebar layout (shell.css html.dds-side, ≥761px). Phones/tablets under
  // 761px keep the top bar, where a section menu is still a dropdown.
  function sidebarMode() {
    try { return document.documentElement.classList.contains('dds-side') && window.matchMedia('(min-width:761px)').matches; } catch (_) { return false; }
  }
  // A PINNED section: in the sidebar, the section the operator is working in
  // stays expanded — outside clicks and Tab-out never fold it (it is the map
  // of where you are, not a popup). Its own trigger and Escape still toggle it.
  function pinnedSec(sec) { return sidebarMode() && sec.classList.contains('active'); }
  function closeSec(sec) {
    sec.classList.remove('open');
    var b = sec.querySelector('button[data-sec]'); if (b) b.setAttribute('aria-expanded', 'false');
  }
  function closeMenus() {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.dds-nav .sec.open').forEach(function (s) {
      if (pinnedSec(s)) return;   // the section you are in stays expanded in the sidebar
      closeSec(s);
    });
  }
  // ── layer mutual exclusion: the shell has five floating layers (section
  // dropdowns, bell popover, profile menu, help panel, App Launcher drawer).
  // Opening ANY of them closes all the others — never two at once. (The ⌘K
  // palette is a modal overlay above them; it closes them on open instead.)
  function closeAllLayers() {
    closeMenus(); closeNotifications(); closeProfile(); closeHelp(); closeDrawer(); closeShortcuts();
    if (siteSwitchPop()) closeSiteSwitch(false);   // bug hunt A11: Switch site is one of the layers too
  }

  // ── command palette ──
  var pal;
  function openPalette() {
    if (window.ddsCreate && window.ddsCreate.isOpen()) window.ddsCreate.close();
    closeAllLayers();   // the palette is the front-most layer — no stacking under it
    if (!pal) {
      pal = el('<div class="dds-palette"><div class="box" role="dialog" aria-modal="true" aria-label="Search Studio OS"><div class="inrow">' + icon('search', 'pic') + '<input placeholder="Search people, websites, deals, messages…" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="dds-pal-list" aria-autocomplete="list"><button type="button" class="pclose">Cancel</button></div><div class="results" id="dds-pal-list" role="listbox" aria-label="Results"></div><p class="hint" aria-hidden="true"></p></div></div>');
      document.body.appendChild(pal);
      pal.addEventListener('click', function (e) {
        if (e.target === pal) return closePalette();
        if (e.target && e.target.closest && e.target.closest('.pclose')) return closePalette();   // a phone fills the screen with search: Cancel closes it
        var cr = e.target && e.target.closest ? e.target.closest('a.res[data-create]') : null;
        if (cr) { e.preventDefault(); openCreate(cr.getAttribute('data-create'), document.getElementById('dds-create')); return; }
        // item 84: "Open website" on a website row opens the live site, not the row's own place
        var alt = e.target && e.target.closest ? e.target.closest('.res [data-alt-href]') : null;
        if (alt) { e.preventDefault(); e.stopPropagation(); window.open(alt.getAttribute('data-alt-href'), '_blank', 'noopener'); return; }
        // a record selection feeds the Customers caret's "Recent" group
        var a = e.target && e.target.closest ? e.target.closest('a.res[data-rec-label]') : null;
        if (a) pushRecent(a.getAttribute('data-rec-label'), a.getAttribute('data-rec-href'));
      });
      pal.querySelector('input').addEventListener('input', function (e) { paintResults(e.target.value); });
      pal.querySelector('input').addEventListener('keydown', function (e) {
        var sel = pal.querySelector('.res.sel');
        if (e.key === 'Escape') return closePalette();
        if (e.key === 'Enter' && sel && sel.hasAttribute('data-create')) { e.preventDefault(); openCreate(sel.getAttribute('data-create'), document.getElementById('dds-create'), true); return; }
        // Shift+Enter on a website row opens the site itself (its "Open website")
        if (e.key === 'Enter' && sel && e.shiftKey && sel.querySelector('[data-alt-href]')) { e.preventDefault(); window.open(sel.querySelector('[data-alt-href]').getAttribute('data-alt-href'), '_blank', 'noopener'); return; }
        if (e.key === 'Enter' && sel) {
          if (sel.hasAttribute('data-rec-label')) pushRecent(sel.getAttribute('data-rec-label'), sel.getAttribute('data-rec-href'));
          location.href = sel.getAttribute('href');
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); var all = [].slice.call(pal.querySelectorAll('.res')); if (!all.length) return;
          var i = all.indexOf(sel); i = e.key === 'ArrowDown' ? Math.min(all.length - 1, i + 1) : Math.max(0, i - 1);
          all.forEach(function (r) { r.classList.remove('sel'); r.setAttribute('aria-selected', 'false'); });
          var pick = all[i < 0 ? 0 : i]; pick.classList.add('sel'); pick.setAttribute('aria-selected', 'true');
          e.target.setAttribute('aria-activedescendant', pick.id);
          if (pick.scrollIntoView) pick.scrollIntoView({ block: 'nearest' });
          palHint();
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
  // ── ⌘K across everything (sales item 84, Nov 2026) ──
  // Results come in groups under small headings (Places, People, Websites, Enquiries,
  // Deals and documents, Money, Projects, To-dos, Messages, Notes, Files, Actions), the
  // words typed in bold, an icon for each kind, and what it is on the right. A website
  // row carries "Open website" (Shift+Enter) beside opening it in Studio OS. A search
  // that couldn't run says so above the places; it never reads as "nothing matches".
  var PAL_GROUP = { places: 'Places', people: 'People', websites: 'Websites', enquiries: 'Enquiries', deals: 'Deals and documents', money: 'Money', projects: 'Projects', todos: 'To-dos', messages: 'Messages', notes: 'Notes', files: 'Files', actions: 'Actions' };
  var PAL_ICON = { customer: 'customers', contact: 'customers', website: 'website', enquiry: 'inbox', deal: 'pipeline', proposal: 'doc', estimate: 'doc', agreement: 'doc', invoice: 'money', page: 'money', project: 'projects', todo: 'todo', message: 'messages', note: 'note', action: 'plus', file: 'files', place: 'dot' };
  function palMark(text, q) {
    // the typed words in bold (escaped first); a phone typed as digits marks its digits in a written number
    var t = String(text == null ? '' : text), qq = String(q || '').trim();
    if (!qq) return esc(t);
    var at = t.toLowerCase().indexOf(qq.toLowerCase());
    if (at >= 0) return esc(t.slice(0, at)) + '<b>' + esc(t.slice(at, at + qq.length)) + '</b>' + esc(t.slice(at + qq.length));
    var d = qq.replace(/\D/g, '');
    if (d.length >= 4 && /^[\d\s().+\-]+$/.test(qq)) {
      for (var i = 0; i < t.length; i++) {
        if (!/\d/.test(t[i])) continue;
        var j = i, got = '';
        while (j < t.length && got.length < d.length) { if (/\d/.test(t[j])) { if (t[j] !== d[got.length]) break; got += t[j]; } j++; }
        if (got === d) return esc(t.slice(0, i)) + '<b>' + esc(t.slice(i, j)) + '</b>' + esc(t.slice(j));
      }
    }
    return esc(t);
  }
  function palRow(o, n, q, selFirst) {
    var sel = selFirst ? ' sel' : '';
    var attrs = o.rec ? ' data-rec-label="' + esc(o.label) + '" data-rec-href="' + esc(o.href) + '"' : '';
    if (o.create) attrs += ' data-create="' + esc(o.create) + '"';
    var href = o.raw ? o.href : (/[?&]client=/.test(o.href) ? o.href : withScope(o.href));
    var alt = o.alt && o.alt.href ? '<span class="alt" data-alt-href="' + esc(o.alt.href) + '" title="Opens the website itself (Shift+Enter)">' + esc(o.alt.label || 'Open website') + '</span>' : '';
    return '<a class="res' + sel + '" id="dds-res-' + n + '" role="option" aria-selected="' + (selFirst ? 'true' : 'false') + '" href="' + esc(href) + '"' + attrs + '>'
      + '<span class="ri" aria-hidden="true">' + icon(PAL_ICON[o.kind] || 'dot', 'pic') + '</span>'
      + '<span class="rt"><span class="rl">' + palMark(o.label, q) + '</span>' + (o.snippet ? '<span class="rs">' + palMark(o.snippet, q) + '</span>' : '') + '</span>'
      + alt + '<span class="s">' + palMark(o.sub || '', q) + '</span></a>';
  }
  function palGroups(groups, q) {
    // groups: [[key, rows]]; one heading per group, the first row selected
    var n = 0, html = '';
    groups.forEach(function (g) {
      if (!g[1].length) return;
      var hid = 'dds-grp-' + g[0];
      html += '<div class="grp" role="group" aria-labelledby="' + hid + '"><div class="gh" id="' + hid + '" role="presentation">' + esc(PAL_GROUP[g[0]] || g[0]) + '</div>';
      g[1].forEach(function (o) { html += palRow(o, n, q, n === 0); n++; });
      html += '</div>';
    });
    return html;
  }
  function palHint() {
    var h = pal && pal.querySelector('.hint'); if (!h) return;
    var sel = pal.querySelector('.res.sel');
    h.textContent = '↑ ↓ to move · Enter to open · Esc to close' + (sel && sel.querySelector('[data-alt-href]') ? ' · Shift+Enter opens the website' : '');
  }
  var fileSearchTok = 0;
  function paintResults(q) {
    var qq = String(q || '').trim().toLowerCase();
    var list = qq ? DESTS.filter(function (d) { return d.label.toLowerCase().indexOf(qq) >= 0 || d.section.toLowerCase().indexOf(qq) >= 0 || (d.desc && d.desc.toLowerCase().indexOf(qq) >= 0); }) : DESTS;
    var box = pal.querySelector('.results');
    var places = list.map(function (d) { return { kind: d.create ? 'action' : 'place', label: d.label, sub: d.section, href: d.href, create: d.create || '', raw: !!d.create }; });
    var placesHtml = palGroups([['places', places]], q);
    box.innerHTML = placesHtml;
    var inp0 = pal.querySelector('input'); if (inp0) inp0.setAttribute('aria-activedescendant', placesHtml ? 'dds-res-0' : '');
    palHint();
    // ── Records + Files: global search across CRM records (GET /crm/search) AND
    //    files (GET /assets?q=) — the Salesforce global-search pattern. Both join the
    //    SAME listbox contract as nav rows (role=option + id + aria-selected).
    var tok = ++fileSearchTok;
    if (qq.length >= 2 && (hasFiles() || hasCrm())) {
      var enc = encodeURIComponent(qq);
      // finding A15: both searches went out on every key press, so a seven-letter name sent
      // fourteen. Wait for a short pause in the typing; a newer key press cancels this one.
      new Promise(function (go) { setTimeout(go, 200); }).then(function () { return tok !== fileSearchTok ? [null, []] : Promise.all([
        hasCrm() ? api('/crm/search?q=' + enc).then(function (r) { return (r.ok && r.body && r.body.data) ? r.body.data : { failed: true }; }, function () { return { failed: true }; }) : Promise.resolve({ results: [] }),
        hasFiles() ? api('/assets?q=' + enc + '&limit=6').then(function (r) { return (r.ok && r.body && r.body.data && r.body.data.assets) || []; }, function () { return []; }) : Promise.resolve([]),
      ]); }).then(function (res) {
        if (tok !== fileSearchTok || !res[0]) return; // a newer keystroke won
        var crm = res[0], files = res[1];
        var recs = crm.results || [];
        var cur = pal.querySelector('.results'); if (!cur) return;
        // a search that couldn't run says so, above whatever places still match
        var note = crm.failed ? '<div class="pnote" role="status">' + icon('overview', 'pic') + '<span>We couldn’t search just now. Try again in a moment.</span></div>' : '';
        if (!recs.length && !files.length && !note) { if (!places.length) cur.innerHTML = '<div class="none">Nothing matches “' + esc(q) + '”.</div>'; return; }
        var byGroup = {};
        recs.forEach(function (r) { var g = r.group || (r.kind === 'action' ? 'actions' : 'people'); (byGroup[g] = byGroup[g] || []).push({ kind: r.kind, label: r.label, sub: r.sub, href: r.href, snippet: r.snippet, alt: r.alt, rec: true }); });
        var order = ['places', 'people', 'websites', 'enquiries', 'deals', 'money', 'projects', 'todos', 'messages', 'notes', 'files', 'actions'];
        byGroup.places = places;
        byGroup.files = files.map(function (a) { return { kind: 'file', label: a.name || 'File', sub: a.in_use ? 'Files · on your site' : 'Files', href: '/files.html?focus=' + a.id }; });
        cur.innerHTML = note + palGroups(order.map(function (k) { return [k, byGroup[k] || []]; }), q)
          + (crm.partial ? '<p class="pnote quiet">Some places couldn’t be searched just now.</p>' : '');
        var inpF = pal.querySelector('input'); var firstSel = cur.querySelector('.res.sel');
        if (inpF) inpF.setAttribute('aria-activedescendant', firstSel ? firstSel.id : '');
        palHint();
      });
    } else if (!list.length) {
      box.innerHTML = '<div class="none">Nothing matches “' + esc(q) + '”.</div>';
    }
  }
  function hasCrm() { return (CTX && CTX.nav || []).some(function (s) { return s.key === 'customers' || s.key === 'record'; }); }

  // ── B4: the attention badge refreshes when the tab comes back ───────────────
  // CTX.attention_count used to be baked in at page load and only moved on
  // navigation, so a client message could arrive, email the operator, and the
  // badge would still read stale while the tab sat open — the email beat the
  // badge. Refresh on RETURN TO THE TAB only.
  //
  // ENDPOINT: /portal/context. It is the only surface that produces
  // attention_count (workspace.ts computes it there via studioBellCount);
  // /portal/feed returns the bell RAIL — notices, approvals, moments — and no
  // count, and it is not cheaper (its own ~14-query wave plus a content-tree
  // read). Reusing the count's own endpoint keeps one source of truth.
  //
  // NO INTERVAL, deliberately: a polling timer would have a backgrounded tab
  // generating traffic forever, against the single most expensive read in the
  // app. visibilitychange fires only when someone actually comes back.
  //
  // THROTTLE: at most one read per 60s, and the window is CLAIMED BEFORE the
  // request goes out — so a tab-flipper cannot stack requests, and a failing
  // endpoint waits out the full window instead of being retried on every flip.
  // boot() primes the clock because boot's own /portal/context read IS a read of
  // this endpoint; a badge is therefore never more than ~60s stale.
  //
  // DEGRADES SILENTLY: a failed, non-OK, malformed or non-numeric response is
  // NOT a zero. Anything short of a good number leaves the last good badge
  // exactly where it is, and nothing here can throw into the shell.
  var ATTENTION_THROTTLE_MS = 60000;
  var lastAttentionAt = 0;
  function markAttentionFresh() { lastAttentionAt = Date.now(); }
  function paintBell() {
    var b = document.getElementById('dds-bell');
    if (b) b.innerHTML = bellInner(badgeCount());
    paintMobileInboxDot();
  }
  // bug hunt A7: the phone bar's Inbox number was drawn once at boot; it follows the bell now
  function paintMobileInboxDot() {
    var lbl = document.querySelector('#dds-mbar a[data-mbar="inbox"] .mlbl'); if (!lbl) return;
    var n = badgeCount(), dot = lbl.querySelector('.mdot');
    if (n > 0) { if (!dot) { lbl.appendChild(document.createTextNode(' ')); dot = document.createElement('span'); dot.className = 'mdot'; lbl.appendChild(dot); } dot.textContent = n > 9 ? '9+' : String(n); }
    else if (dot) { if (dot.previousSibling && dot.previousSibling.nodeType === 3) dot.previousSibling.remove(); dot.remove(); }
  }
  // Final pass (Nov 8, batch B): at STUDIO level /portal/context no longer
  // builds the needs-you list on every page boot. It hands back the kept total
  // (null when none is kept yet) and attention_stale; the shell then reads just
  // the total (/agency/needs-you?only=total) behind the page. Home reads the
  // whole list anyway and hands the bell its number (ddsBellSet), so the shell
  // skips its own read there. Every new number also goes out as 'dds:attention'
  // for a page that shows it (Analytics' "things need you" line).
  function studioTotals() { return !!(CTX && CTX.is_agency && !(CTX.scope && CTX.scope.site_id) && typeof CTX.attention_stale === 'boolean'); }
  function setAttention(n) {
    if (!CTX || typeof n !== 'number' || !isFinite(n) || n < 0) return;   // anything short of a good number keeps the last good badge
    var changed = n !== CTX.attention_count;
    CTX.attention_count = n; CTX.attention_stale = false;
    try { window.__ddsContext = CTX; } catch (_) { /* */ }
    keepContext(ctxKeptAt);
    if (changed) paintBell();
    try { document.dispatchEvent(new CustomEvent('dds:attention', { detail: n })); } catch (_) { /* */ }
  }
  var pageSetBell = false, pendingBell = null;
  window.ddsBellSet = function (n) {
    pageSetBell = true; markAttentionFresh();
    if (!CTX) { pendingBell = n; return; }                        // the page beat the shell's own boot read — applied when it lands
    setAttention(Number(n));
  };
  function readStudioTotal(fresh) {
    return api('/agency/needs-you?only=total' + (fresh ? '&fresh=1' : '')).then(function (r) {
      if (r && r.ok && r.body && r.body.data) setAttention(r.body.data.total);
    })['catch'](function () { /* keep the last good badge */ });
  }
  // Oct 2026 review: a page that just CLEARED a needs-you item (the Inbox
  // resolving a support request) can ask for the badge now, past the throttle.
  window.ddsBellRefresh = function () { lastAttentionAt = 0; refreshAttention(true); };
  function refreshAttention(changed) {
    if (!TOKEN || !CTX) return;                                   // signed out, or the minimal shell — nothing to refresh
    if (Date.now() - lastAttentionAt < ATTENTION_THROTTLE_MS) return;
    markAttentionFresh();                                         // claim the window BEFORE the request
    if (studioTotals()) { try { readStudioTotal(!!changed); } catch (_) { /* */ } return; }   // batch B: just the studio's total
    try {
      api('/portal/context').then(function (r) {
        if (!r || !r.ok || !r.body || !r.body.data) return;        // a failed read is not "nothing needs you"
        var n = r.body.data.attention_count;
        if (typeof n !== 'number' || !isFinite(n) || n < 0) return; // keep the last good badge
        if (!CTX || n === CTX.attention_count) return;
        CTX.attention_count = n;
        try { window.__ddsContext = CTX; } catch (_) { /* */ }
        paintBell();                                              // badge only — never a full re-render
        keepContext(ctxKeptAt);
      })['catch'](function () { /* keep the last good badge */ });
    } catch (_) { /* the shell must never break over its own badge */ }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refreshAttention();
  });

  // ── notifications (lazy; reuses /portal/feed — no new system) ──
  // Benchmark 8 — the bell grows up: three tabs (All · Needs you · Updates),
  // "Mark read" distinct from "Clear", and a priority tier (approvals + money)
  // that sits on top with a stronger left accent. The rows are the SAME feed
  // rows every other surface reads; each arrives tagged `tier` and `priority`
  // by routes/workspace.ts. The Inbox stays the one place for conversations —
  // the bell is the glance, and its footer still sends you there.
  var notif, bellTab = 'all', bellRows = [];
  var BELL_READ_KEY = 'dds-bell-read';
  var NOTICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function bellRead() { try { return JSON.parse(localStorage.getItem(BELL_READ_KEY) || 'null') || null; } catch (_) { return null; } }
  // "Mark read" is the operator's own read mark, kept locally: the rows dim and
  // the badge quiets until the server's count CHANGES (something new arrived,
  // or something cleared). The server's number itself is never touched — a
  // marked-read invoice is still unpaid, and the Inbox still lists it.
  function markBellRead() {
    var ids = bellRows.map(function (r) { return r.id; }).filter(Boolean);
    try { localStorage.setItem(BELL_READ_KEY, JSON.stringify({ count: (CTX && CTX.attention_count) || 0, ids: ids, at: Date.now() })); } catch (_) { /* */ }
    paintBell(); paintBellRows();
  }
  function badgeCount() {
    var n = (CTX && CTX.attention_count) || 0, m = bellRead();
    return (m && typeof m.count === 'number' && m.count === n) ? 0 : n;
  }
  function setExpanded(id, open) { var b = document.getElementById(id); if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false'); }
  // one row shape for every kind of feed item the bell draws
  function shapeBellRows(d, revr) {
    var out = [];
    var at = function (href) { return revr ? '/client.html' : withScope(href || '/today.html'); };
    (d.notices || []).forEach(function (n) {
      out.push({ id: String(n.id || ''), href: at(n.href), title: n.headline || 'Needs a look', sub: n.body || '', tier: n.tier === 'update' ? 'update' : 'needs_you', priority: !!n.priority, clearable: NOTICE_ID_RE.test(String(n.id || '')) && n.dismissible !== false });
    });
    // An approval tap lands on the thing that RESOLVES it (file → Files,
    // connected → Connections, infra → the Foundations desk) — never a generic landing.
    (d.pending_approvals || []).forEach(function (p) {
      var target = revr ? '/client.html' : (p.href ? p.href : p.kind === 'connected' ? '/connections.html' : p.kind === 'file' ? '/files.html' : '/presence.html#foundations');
      out.push({ id: 'approval:' + String(p.id || ''), href: revr ? target : withScope(target), title: 'Waiting for approval', sub: p.title || 'A change is ready', tier: 'needs_you', priority: true, clearable: false });
    });
    (d.moments || []).slice(0, 4).forEach(function (m) {
      out.push({ id: 'moment:' + String(m.id || ''), href: at('/today.html'), title: m.headline || 'A moment', sub: m.summary || '', tier: 'update', priority: false, clearable: false });
    });
    // priority first, then the asks, then the updates — stable within each band
    return out.map(function (r, i) { r.i = i; return r; }).sort(function (a, b) {
      var ka = (a.priority ? 0 : 2) + (a.tier === 'needs_you' ? 0 : 1), kb = (b.priority ? 0 : 2) + (b.tier === 'needs_you' ? 0 : 1);
      return ka - kb || a.i - b.i;
    });
  }
  // Studio level: the needs-you rows (one per thing, money first) + the feed's news.
  function studioBellRows(d, ny) {
    var needs = (ny.rows || []).concat(ny.rest || []).map(function (n) {
      return { id: 'need:' + String(n.key || ''), href: n.href || '/agency.html', title: (n.name ? n.name + ' — ' : '') + (n.what || ''), sub: n.when || '', tier: 'needs_you', priority: n.kind === 'money', clearable: false };
    });
    var news = shapeBellRows({ notices: (d.notices || []).filter(function (n) { return n.tier === 'update'; }) }, false);
    // builder list item 47: news per client site, each naming the site and opening the right
    // place inside it ("Bacchus Kitchen — Published 3 changes"); the server carries ?client=
    var perSite = (ny.news || []).map(function (n) {
      return { id: 'news:' + String(n.id || n.site_id + ':' + n.kind), href: n.href || ('/today.html?client=' + encodeURIComponent(n.site_id)), title: (n.name ? n.name + ' — ' : '') + (n.headline || ''), sub: n.body || '', tier: 'update', priority: false, clearable: false };
    });
    return needs.concat(perSite).concat(news);
  }
  function bellRowHtml(r, seen) {
    return '<a class="row' + (r.priority ? ' pri' : '') + (seen ? ' seen' : '') + '" data-tier="' + r.tier + '" href="' + esc(r.href) + '"><b>' + esc(r.title) + '</b>' + (r.sub ? '<div class="sub">' + esc(r.sub) + '</div>' : '') + '</a>';
  }
  function paintBellRows() {
    if (!notif) return;
    var body = notif.querySelector('.body'); if (!body) return;
    var m = bellRead(), seenIds = {};
    (m && m.ids || []).forEach(function (id) { seenIds[id] = 1; });
    var list = bellRows.filter(function (r) { return bellTab === 'all' || r.tier === bellTab; });
    var out = list.map(function (r) { return bellRowHtml(r, !!seenIds[r.id]); }).join('');
    var empty = bellTab === 'update' ? 'No updates right now.' : bellTab === 'needs_you' ? 'Nothing needs you right now.' : 'You’re all caught up.';
    body.innerHTML = out || '<div class="muted">' + empty + '</div>';
    Array.prototype.forEach.call(notif.querySelectorAll('.tabs [role=tab]'), function (t) {
      var on = t.getAttribute('data-tab') === bellTab;
      t.setAttribute('aria-selected', on ? 'true' : 'false'); t.setAttribute('tabindex', on ? '0' : '-1'); t.classList.toggle('on', on);
    });
    var clr = notif.querySelector('#dds-bell-clear');
    if (clr) { var can = bellRows.some(function (r) { return r.clearable; }); clr.disabled = !can; clr.title = can ? 'Clear the rows that can be cleared by hand' : 'Nothing here can be cleared by hand — money and approvals clear when they are resolved'; }
    var mr = notif.querySelector('#dds-bell-read');
    if (mr) mr.disabled = !bellRows.length;
  }
  // "Clear" dismisses every row the server lets a hand dismiss — the SAME rule
  // Today's "Done" buttons follow (a real notice id + dismissible). Approvals,
  // money and the synthetic rows stay: they clear when the thing is resolved.
  function clearBell() {
    var targets = bellRows.filter(function (r) { return r.clearable; });
    if (!targets.length) return;
    var btn = notif.querySelector('#dds-bell-clear'); if (btn) btn.disabled = true;
    Promise.all(targets.map(function (r) {
      return window.ddsApi('/commerce/notices/dismiss', { method: 'POST', body: { id: r.id } }).then(function (res) { return res && res.ok ? r.id : null; });
    })).then(function (done) {
      var gone = {}; done.forEach(function (id) { if (id) gone[id] = 1; });
      var n = Object.keys(gone).length;
      bellRows = bellRows.filter(function (r) { return !gone[r.id]; });
      paintBellRows();
      if (n) { if (window.ddsToast) window.ddsToast(n === 1 ? 'Cleared.' : 'Cleared ' + n + '.'); window.ddsBellRefresh(); }
      else if (window.ddsToast) window.ddsToast('Couldn’t clear those just now — try again in a moment.', 'err');
    });
  }
  function toggleNotifications() {
    if (notif && notif.classList.contains('open')) { notif.classList.remove('open'); setExpanded('dds-bell', false); return; }
    closeAllLayers();
    if (!notif) {
      notif = el('<div class="dds-pop dds-bell-pop" role="region" aria-label="Notifications"><h4>Needs a look</h4>' +
        '<div class="tabs" role="tablist" aria-label="Notification views"><button type="button" role="tab" data-tab="all" aria-selected="true">All</button><button type="button" role="tab" data-tab="needs_you" aria-selected="false">Needs you</button><button type="button" role="tab" data-tab="update" aria-selected="false">Updates</button></div>' +
        '<div class="body"><div class="muted">Loading…</div></div>' +
        '<div class="acts"><button type="button" id="dds-bell-read" disabled>Mark read</button><button type="button" id="dds-bell-clear" disabled>Clear</button></div></div>');
      document.body.appendChild(notif); notif.addEventListener('click', function (e) { e.stopPropagation(); });
      Array.prototype.forEach.call(notif.querySelectorAll('.tabs [role=tab]'), function (t) {
        t.addEventListener('click', function () { bellTab = t.getAttribute('data-tab'); paintBellRows(); t.focus(); });
      });
      // the tablist keyboard contract: arrows move between tabs
      notif.querySelector('.tabs').addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        var tabs = [].slice.call(notif.querySelectorAll('.tabs [role=tab]')), i = tabs.indexOf(document.activeElement);
        if (i < 0) return; e.preventDefault();
        var j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
        bellTab = tabs[j].getAttribute('data-tab'); paintBellRows(); tabs[j].focus();
      });
      notif.querySelector('#dds-bell-read').addEventListener('click', markBellRead);
      notif.querySelector('#dds-bell-clear').addEventListener('click', clearBell);
    }
    notif.classList.add('open');
    setExpanded('dds-bell', true);
    // Sales review item 11: at STUDIO level the badge is the studio's one
    // needs-you list, so the Needs-you tab lists exactly those rows (the same
    // read Home heads its list with); Updates keeps the news from the feed.
    var studioLevel = !!(CTX && CTX.is_agency && !(CTX.scope && CTX.scope.site_id));
    // Final pass (Nov 8, batch B): at studio level ONE call. /agency/needs-you
    // builds the studio's feed anyway and sends its update rows along
    // (update_notices); an older server without them gets the feed as before.
    var nyP = studioLevel ? api('/agency/needs-you') : Promise.resolve(null);
    var feedP = studioLevel ? nyP.then(function (x) {
      var dd = x && x.ok && x.body && x.body.data;
      return (dd && Array.isArray(dd.update_notices)) ? { ok: true, status: 200, body: { data: { notices: dd.update_notices } } } : api('/portal/feed');
    }) : api('/portal/feed');
    Promise.all([feedP, nyP]).then(function (res) {
      var r = res[0], ny = res[1];
      if (ny && ny.ok && ny.body && ny.body.data) setAttention(Number(ny.body.data.total));   // the list in the bell and its badge agree
      var body = notif.querySelector('.body');
      // A FAILED read is not an empty one — never claim "caught up" on an error.
      if (!r.ok || (ny && !ny.ok)) { body.innerHTML = '<div class="muted">We couldn’t check just now — try again in a moment.</div>'; return; }
      var d = r.body.data || {};
      // A reviewer's whole world is client.html — every bell row lands THERE
      // (the owner pages these rows normally target are 403 walls for them).
      var revr = (CTX && CTX.site_role === 'client_reviewer') || (CTX && CTX.is_managed_client);
      bellRows = ny ? studioBellRows(d, (ny.body && ny.body.data) || {}) : shapeBellRows(d, revr);
      paintBellRows();
      // W4: the bell is the quick glance; the Inbox is the complete "everything that
      // needs you" (also client messages, surveys, new leads). Send them to the one
      // place rather than have two surfaces compete. A client's "one place" is their
      // updates page — never the owner Inbox.
      var old = notif.querySelector('.foot'); if (old) old.remove();
      var foot = revr
        ? '<a class="row foot" href="/client.html" style="text-align:center;font-weight:600;color:var(--dds-accent,#5b3fa0)">See all your updates →</a>'
        : '<a class="row foot" href="' + esc(withScope('/inbox.html')) + '" style="text-align:center;font-weight:600;color:var(--dds-accent,#5b3fa0)">See everything in your Inbox →</a>';
      notif.appendChild(el(foot));
    });
  }
  function closeNotifications() { if (notif) notif.classList.remove('open'); setExpanded('dds-bell', false); }

  // ── in-app "how do I…?" helper (HELP-1) ─────────────────────────────────────
  // A grounded product-help panel: type a question, the server (/help/ask) matches
  // it to a curated answer with a deep link straight to the right screen. Deterministic
  // and honest — no invented features; the full Help page is always one tap away.
  // Distinct from the site-aware Concierge; this is help ABOUT the product.
  var help, helpTok = 0;
  var HELP_IN = 'width:100%;box-sizing:border-box;margin:var(--dds-s2,8px) 0;padding:var(--dds-s2,8px) 10px;border:1px solid var(--dds-line,#e5e5e5);border-radius:var(--dds-r,8px);font:inherit;font-size:14px;background:var(--dds-card,#fff);color:inherit';
  var HELP_CHIP = 'font:inherit;font-size:12.5px;margin:var(--dds-s1,4px) var(--dds-s1,4px) 0 0;padding:var(--dds-s1,4px) var(--dds-s3,12px);border-radius:999px;border:1px solid var(--dds-line,#ddd);background:transparent;color:inherit;cursor:pointer';
  var HELP_LINK = 'display:inline-block;margin:6px var(--dds-s2,8px) 0 0;font-weight:600;font-size:13px;color:var(--dds-accent,#5b3fa0);text-decoration:none';
  function toggleHelp() {
    if (help && help.classList.contains('open')) { closeHelp(); return; }
    closeAllLayers();
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
    var qs = ['Change my hours', 'Publish my changes', 'Set up booking', 'Send an update', 'Connect a service'];
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
    if (prof && prof.classList.contains('open')) { prof.classList.remove('open'); setExpanded('dds-profile', false); return; }
    closeAllLayers();
    if (!prof) { prof = el('<div class="dds-pop" role="region" aria-label="Account menu"></div>'); document.body.appendChild(prof); prof.addEventListener('click', function (e) { e.stopPropagation(); }); }
    setExpanded('dds-profile', true);
    var email = (sb && sb.__email) || 'Signed in';
    var role = (CTX && CTX.site_role) || '';
    // Item 96: the role and the plan in words, not their codes ("business owner · presence")
    var ROLE_WORDS = { business_owner: 'Owner', business_staff: 'Team member', client_reviewer: 'Client', developer: 'Developer' };
    var roleWord = ROLE_WORDS[role] || (role ? role.replace(/_/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase(); }) : '');
    var plan = (CTX && CTX.edition_name && role !== 'client_reviewer') ? CTX.edition_name + ' plan' : '';
    var rows = '';
    if (CTX && CTX.is_agency) rows += '<a class="row" href="/agency.html">Studio</a>' +
      // item 44: the Sites page in one click, from anywhere
      '<a class="row" href="/sites.html" id="dds-all-sites">All sites<span class="sub">Every website you look after</span></a>';
    // Item 96: the platform's health door, for staff only. It sat on the studio's
    // Home as "Platform: 3 areas need a look", staff wording on the owner's page.
    if (CTX && CTX.is_operator) rows += '<a class="row" href="/admin-health.html" id="dds-health-row">Platform health<span class="sub" id="dds-health-sub"></span></a>';
    // Architecture v1.0: utility destinations (Connections, Settings, Help) live here.
    // Multi-item groups get a quiet header so a long menu stays scannable.
    UTILS.forEach(function (sec) {
      var vis = visibleItems(sec);
      if (vis.length > 1) rows += '<div style="padding:var(--dds-s2,8px) var(--dds-s4,16px) 2px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--dds-soft,#8a8198)">' + esc(sec.label) + '</div>';
      vis.forEach(function (i) { rows += '<a class="row" href="' + esc(withScope(i.href)) + '">' + esc(i.label) + (i.desc ? '<span class="sub">' + esc(i.desc) + '</span>' : '') + '</a>'; });
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
    prof.innerHTML = '<div class="who"><div class="n">' + esc(email) + '</div><div class="r">' + esc([roleWord, plan].filter(Boolean).join(' · ')) + '</div></div>' + rows;
    prof.classList.add('open');
    if (document.getElementById('dds-health-row')) api('/admin/health-center').then(function (r) {
      var sub = document.getElementById('dds-health-sub'); if (!sub || !r.ok) return;
      var areas = (r.body && r.body.data && Array.isArray(r.body.data.areas)) ? r.body.data.areas : [];
      var n = areas.filter(function (a) { return a && a.state === 'attention'; }).length;
      sub.textContent = n ? n + (n === 1 ? ' area needs' : ' areas need') + ' a look' : 'All clear';
    });
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
    if (so) so.addEventListener('click', function (e) {
      e.preventDefault();
      // PII: recent-record names must not persist for the next user of a shared machine
      try { localStorage.removeItem(RECENTS_KEY); } catch (_) { /* */ }
      window.ddsContextForget();
      if (sb) sb.auth.signOut().then(function () { location.href = door; }); else location.href = door;
    });
  }
  function closeProfile() { if (prof) prof.classList.remove('open'); setExpanded('dds-profile', false); }
  document.addEventListener('click', function () { closeNotifications(); closeProfile(); closeHelp(); closeShortcuts(); });
  // Escape closes whatever shell popover is open (WCAG 1.4.13) and returns
  // focus to its trigger so a keyboard user isn't stranded.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    // an open context-bar dropdown closes back to its trigger even when focus
    // wandered outside the menu (the menu's own keydown handles the inside case)
    var openSec = root && root.querySelector ? root.querySelector('.dds-nav .sec.open') : null;
    if (openSec) { var sb0 = openSec.querySelector('button[data-sec]'); closeMenus(); if (sb0) sb0.focus(); }
    if (notif && notif.classList.contains('open')) { closeNotifications(); var b1 = document.getElementById('dds-bell'); if (b1) b1.focus(); }
    if (prof && prof.classList.contains('open')) { closeProfile(); var b2 = document.getElementById('dds-profile'); if (b2) b2.focus(); }
    if (help && help.classList.contains('open')) { closeHelp(); var b3 = document.getElementById('dds-help'); if (b3) b3.focus(); }
    if (keys && keys.classList.contains('open')) closeShortcuts();
    // ⌘K palette too — its input handles Escape while focused, but the dialog must
    // also close when focus is elsewhere (closePalette returns focus to its trigger).
    if (pal && pal.classList.contains('open')) closePalette();
  });

  // ── Keyboard beyond ⌘K (benchmark item 10) ──────────────────────────────────
  // Three plain keys on every signed-in page: `/` opens the search (the ⌘K
  // input), `?` opens a small sheet listing what exists, `n` fires the page's
  // own "New" action. Plain keys only — nothing while typing in a field,
  // nothing with a modifier held, nothing while the palette or the tour is
  // up. Pages need no change: `n` finds a [data-new] element, else the first
  // visible "+ …" / "New …" / "Add …" button, a filled one first.
  var keys;
  function typingIn(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
  }
  function modalOpen() { return !!((pal && pal.classList.contains('open')) || tour || (window.ddsCreate && window.ddsCreate.isOpen())); }
  var NEW_RE = /^(\+|new\b|add\b)/i;
  function onScreen(n) { return !!(n && n.getClientRects && n.getClientRects().length); }
  function findNewAction() {
    var marked = document.querySelector('[data-new]');
    if (marked && onScreen(marked)) return marked;
    var all = document.querySelectorAll('button, a[href]'), first = null;
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.closest && n.closest('#dds-shell, .dds-pop, .dds-palette, .dds-drawer, #dds-mbar')) continue;
      if (!onScreen(n) || n.disabled) continue;
      if (!NEW_RE.test(String(n.textContent || '').trim())) continue;
      if (/(^|\s)(primary|filled)(\s|$)/.test(String(n.className || ''))) return n;
      if (!first) first = n;
    }
    return first;
  }
  window.ddsNewAction = findNewAction;   // read by tests; pages never need it
  // The Inbox's own keys (inbox.html wires them) are LISTED here, not rebuilt.
  var INBOX_KEYS = [['↑ ↓', 'Move between conversations'], ['Enter', 'Open the conversation'], ['Esc', 'Close a menu or sheet']];
  function keyRow(r) { return '<div class="row krow"><kbd>' + esc(r[0]) + '</kbd><span>' + esc(r[1]) + '</span></div>'; }
  function toggleShortcuts() {
    if (keys && keys.classList.contains('open')) { closeShortcuts(); return; }
    closeAllLayers();
    if (!keys) {
      keys = el('<div class="dds-pop dds-keys" role="dialog" aria-label="Keyboard shortcuts" tabindex="-1"><h4>Keyboard shortcuts</h4><div class="body"></div><button type="button" class="row kclose" id="dds-keys-close">Close</button></div>');
      document.body.appendChild(keys);
      keys.addEventListener('click', function (e) { e.stopPropagation(); });
      keys.querySelector('#dds-keys-close').addEventListener('click', closeShortcuts);
    }
    var rows = [[/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl K', 'Search Studio OS'], ['/', 'Search'], ['n', 'New — the page’s + button'], ['?', 'These shortcuts'], ['Esc', 'Close whatever is open']];
    if (canCreate()) rows.splice(3, 0, ['c', 'Create — log a call, a deal, an invoice…']);
    var html = rows.map(keyRow).join('');
    if (normalizePath(location.pathname) === '/inbox') html += '<div class="grp">In the Inbox</div>' + INBOX_KEYS.map(keyRow).join('');
    keys.querySelector('.body').innerHTML = html;
    keys.classList.add('open');
    try { keys.focus(); } catch (_) { /* */ }
  }
  function closeShortcuts() { if (keys) keys.classList.remove('open'); }
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || !CTX) return;   // signed out / minimal shell: no app keys
    if (typingIn(e.target)) return;
    if (e.key === '/') { if (modalOpen()) return; e.preventDefault(); openPalette(); }
    else if (e.key === '?') { if (modalOpen()) return; e.preventDefault(); toggleShortcuts(); }
    else if (e.key === 'c' && !e.shiftKey && canCreate()) { if (modalOpen()) return; e.preventDefault(); openCreate('', document.getElementById('dds-create'), true); }
    else if (e.key === 'n' && !e.shiftKey) {
      if (modalOpen()) return;
      var t = findNewAction();
      if (!t) { if (window.ddsToast) window.ddsToast('Nothing to create on this page.'); return; }
      e.preventDefault(); closeAllLayers();
      t.click(); try { t.focus(); } catch (_) { /* */ }
    }
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

  // ── the App Launcher panel (also the mobile nav sheet) ──────────────────────
  // ONE element serves both: ≥761px it is the waffle's click-invoked popover
  // (every destination grouped by section — the burger's old mega-list, so the
  // flat bar can show fewer top-level entries with nothing lost); ≤760px it is
  // the same full-screen sheet the burger opened, now opened by the waffle or
  // the bottom bar's Menu — a 1:1 capability replacement.
  var drawer, drawerOpener = '';
  function ensureDrawer() {
    if (drawer) return;
    drawer = el('<div class="dds-drawer" id="dds-drawer" role="navigation" aria-label="Workspace menu"></div>');
    // clicks INSIDE the panel (links navigate) must not bubble to the
    // document-level outside-click closer
    drawer.addEventListener('click', function (e) { e.stopPropagation(); });
    // slice-2 popup contract: arrows move between the panel's links
    drawer.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var links = [].slice.call(drawer.querySelectorAll('a'));
      var i = links.indexOf(document.activeElement);
      e.preventDefault();
      if (links.length) links[e.key === 'ArrowDown' ? Math.min(i + 1, links.length - 1) : Math.max(i - 1, 0)].focus();
    });
    // focus Tabbing out of the panel closes it (no stuck-open panel + stale
    // aria-expanded). Focus is NOT stolen back on this path. A NULL
    // relatedTarget is NOT "focus left the document": on iOS Safari a tap does
    // not focus a link, it only blurs the current element — closing here would
    // set display:none between pointerdown and click, so the tap misses the
    // item and falls through to the page underneath. Only a demonstrable move
    // to an element OUTSIDE the panel closes it; a move INTO the panel (or onto
    // either trigger — its click handles the toggle) keeps it.
    drawer.addEventListener('focusout', function (e) {
      if (!drawer.classList.contains('open')) return;
      var to = e.relatedTarget;
      if (!to) return;                        // iOS tap / focus left the document — keep open
      if (drawer.contains(to) || to.id === 'dds-waffle' || to.id === 'dds-mbar-menu') return;
      closeDrawer();
    });
    document.body.appendChild(drawer);
  }
  function closeDrawer() {
    if (drawer && drawer.classList.contains('open')) {
      drawer.classList.remove('open');
      setExpanded('dds-waffle', false); setExpanded('dds-mbar-menu', false);
    }
  }
  // Escape closes the panel and returns focus to whichever control opened it
  // (waffle or the mobile Menu) — WCAG 1.4.13 / the slice-2 popup contract.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !drawer || !drawer.classList.contains('open')) return;
    closeDrawer(); var b = document.getElementById(drawerOpener || 'dds-waffle'); if (b) b.focus();
  });
  // outside click closes the open panel (the waffle/Menu triggers stopPropagation)
  document.addEventListener('click', closeDrawer);
  function toggleDrawer(nav, openerId) {
    if (drawer && drawer.classList.contains('open')) { closeDrawer(); return; }
    closeAllLayers();
    drawerOpener = openerId || 'dds-waffle';
    var activeKey = activeItemKey(location.pathname, nav);
    // same split as the bar: the SECTION marks active (heading emphasis — covers
    // /crm.html record pages), item aria-current only on a genuine href match
    var secKey = activeSectionKey(nav, activeKey);
    // Oct 2026 nav cut: the drawer follows the menu's lists — hidden (⌘K-only)
    // items are not drawn, and a group with ONE item of the same name needs no
    // heading over it (eight "Today / Today" pairs read as noise on a phone).
    var html = (nav || []).map(function (s) {
      var vis = visibleItems(s);
      if (!vis.length) return '';
      var heading = (vis.length === 1 && vis[0].label === s.label) ? '' : '<p class="t">' + esc(s.label) + '</p>';
      return '<div class="g' + (s.key === secKey ? ' active' : '') + (s.utility ? ' util' : '') + '">' + heading + vis.map(function (i) { return '<a href="' + esc(withScope(i.href)) + '" class="' + (i.key === activeKey ? 'here' : '') + '"' + (i.key === activeKey ? ' aria-current="page"' : '') + '>' + esc(i.label) + '</a>'; }).join('') + '</div>';
    }).join('');
    ensureDrawer();
    drawer.innerHTML = html; drawer.classList.add('open');
    setExpanded('dds-waffle', true); setExpanded('dds-mbar-menu', true);
    var f = drawer.querySelector('a'); if (f) f.focus();
  }

  // ── SC-1 (global): carry the agency drill-in scope on EVERY static app link ──
  // Nav/bell/palette links already scope via withScope(); this covers the page-
  // authored anchors ("← Back to Today", empty-state CTAs, rail exits) that were
  // the one systematic leak — a scoped operator must never silently switch
  // tenants by tapping a hardcoded exit.
  // customers.html is deliberately EXCLUDED: it is the agency-portfolio roster,
  // fetched via /studio/customers keyed on agency_site_id=eq.{site}. Carrying a
  // drilled LEAF client's scope onto "← Customers" / "Open Customers" resolves
  // that query to the leaf (no sub-customers) → an empty roster, stranding the
  // operator. Those two anchors are the intended escape hatch UP to the full
  // list, so they must stay unscoped. (broadcasts stays: its handler is per-site,
  // so a drilled scope correctly shows that client's broadcasts.)
  var APP_PAGES = /^\/(today|presence|crm|contacts|broadcasts|pipeline|leads|projects|inbox|files|visual-studio|analytics|schedule|connections|sharing|attention|approval-center|timeline|upcoming|business-insights|content-tree|snapshot-history|website-health)\.html/;
  function carryScopeGlobally() {
    var s = scopeId(); if (!s) return;
    document.querySelectorAll('a[href^="/"]').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      // data-noscope: the anchor addresses a specific record exactly as cached
      // (the Customers caret's recents) — re-scoping it would resolve the record
      // against the wrong tenant. Skip; a recent navigates as originally stored.
      if (a.hasAttribute('data-noscope') || !APP_PAGES.test(h) || h.indexOf('client=') >= 0) return;
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
    // Visual refresh: the left sidebar (shell.css ≥761px). The website builder
    // keeps the top bar — it has its own left rail — and embedded frames have
    // no chrome at all.
    // Look refresh E: dds-app marks the same pages for shell.css's shared page anatomy
    // (the builder pre-stamps dds-side for the frame but keeps its own controls)
    if (location.pathname.indexOf('/presence') !== 0 && !document.documentElement.classList.contains('dds-embed')) document.documentElement.classList.add('dds-side', 'dds-app');
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
    root.innerHTML = '<a class="dds-brand" href="/"><span class="mark">S</span>Studio OS</a><div style="flex:1"></div><a class="dds-ic" href="/help.html" aria-label="Help">?</a><a class="dds-ic" href="/studio.html" aria-label="Sign in">◐</a>';
  }

  // ── PT-5: contextual onboarding — teach in context, show ONCE, disappear ────
  // Declarative + reuses the shell: any page marks a `.dds-hint[data-hint]`
  // element (hidden) next to the thing it explains. We reveal unseen ones with a
  // "Got it", remember the dismissal, and never show it again. No tour, no steps.
  function hintsSeen() { try { return JSON.parse(localStorage.getItem('dds-hints') || '{}'); } catch (_) { return {}; } }
  function markHint(k) { try { var s = hintsSeen(); s[k] = 1; localStorage.setItem('dds-hints', JSON.stringify(s)); } catch (_) { /* */ } }
  // Sales review item 27 (Nov 2026), the builder's rule (contextHint) for every
  // page: ONE tip per visit, and a tip that was shown is retired when the page is
  // left, Got it or not. "Notes here stay private…" came back on every visit to a
  // record, and the bell tip on every Home, because only Got it retired them.
  var hintThisVisit = '';
  window.addEventListener('pagehide', function () { if (hintThisVisit) markHint(hintThisVisit); });
  function attachDismiss(node, key) {
    hintThisVisit = key;
    var x = document.createElement('button');
    // no aria-label: the visible text IS the accessible name (WCAG 2.5.3 —
    // an aria-label here would make "Got it" unmatchable by voice control).
    x.className = 'x'; x.type = 'button'; x.textContent = 'Got it';
    x.addEventListener('click', function () { markHint(key); node.classList.remove('show'); setTimeout(function () { node.remove(); }, 200); });
    node.appendChild(x);
    requestAnimationFrame(function () { node.classList.add('show'); });
  }
  // declarative page-level hints (marked in the HTML). One at a time; never intrusive.
  function scanHints() {
    if (tour) return;   // Phase 4: never stack a hint on top of the first-login tour
    var seen = hintsSeen();
    Array.prototype.forEach.call(document.querySelectorAll('.dds-hint[data-hint]:not(.dds-live)'), function (node) {
      var key = node.getAttribute('data-hint');
      if (!key || seen[key]) { node.remove(); return; }
      if (hintThisVisit) return;   // one tip per visit; the next waits for the next visit
      if (document.querySelector('.dds-hint.show')) return;   // only one hint visible at once
      node.classList.add('dds-live'); node.hidden = false; attachDismiss(node, key);
    });
  }
  // imperative: teach the moment a context opens (a Studio-OS view, a desk).
  window.ddsHint = function (key, html) {
    var seen = hintsSeen();
    if (!key || seen[key]) return false;
    if (tour) return false;   // Phase 4: the tour is already teaching — one thing at a time
    if (hintThisVisit) return false;   // one tip per visit
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
      { sel: ['.dds-nav .sec > [data-href^="/today"]', '.dds-nav .sec > [data-href^="/agency"]', '#dds-mbar a[href^="/today"]', '#dds-mbar a[href^="/agency"]'], title: 'Home', text: 'This is your home — the one page that tells you what’s changed and what needs you. Nothing here is urgent by surprise.' },
      { sel: ['#dds-create', '#dds-mbar-create'], title: 'Create', text: 'Log a call, add a deal, send an invoice or a proposal — from any page. You pick who inside the form, so there’s no hunting for their page first.' },
      { sel: ['.dds-nav .sec > button[data-sec="website"]', '.dds-nav .sec > [data-href^="/presence"]', '#dds-mbar-menu'], title: 'Your website', text: 'Everything about your website lives behind this one door — edit pages, update business info, and publish. Nothing goes live without your OK.', mtext: 'On a phone, Menu holds the rest — your Website (edit and publish) and your Customers live in there. Nothing goes live without your OK.' },
      { sel: ['.dds-nav .sec > button[data-sec="customers"]', '.dds-nav .sec > [data-href^="/customers"]'], title: 'Customers', text: 'Your customers and the people behind them — their deal, billing, project, files and messages on one record.' },
      { sel: ['#dds-waffle'], title: 'App Launcher', text: 'Every part of your studio, one tap — the full list of destinations, grouped and always within reach.' },
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
  // ── The studio-level empty state ─────────────────────────────────────────────
  // Some records — projects, deals, contacts, invoices — live ONLY on the
  // studio's own site. Scope is sticky across navigation (carryScopeGlobally),
  // so once an operator drills into a client, those pages read `site_id = <the
  // client's site>` and can only ever come back empty. "No projects yet · Create
  // a project" is then false twice over: the studio HAS projects, and creating
  // one from a client scope is a trap.
  //
  // A state that can never be non-empty must not borrow the wording of one that
  // can. This says whose records these are, and hands over the way back —
  // never a create CTA that would do the wrong thing.
  //   window.ddsStudioLevel({ noun:'Projects', lower:'projects' })  → false when
  //   unscoped (the page renders its normal empty state), true when it painted.
  // The URL fallback matters: a page renders its own data as soon as ITS fetch
  // lands, which can be before the shell's context fetch. Keying only on CTX
  // would make the notice appear or not depending on which request won — so the
  // SCOPE comes from the URL (always present, never racy) and the NAME from CTX
  // when it has arrived. Unknown name degrades the copy, never the correctness.
  window.ddsScopeInfo = function () {
    var s = CTX && CTX.scope, id = scopeId();
    if (s && s.site_id) return { id: s.site_id, name: s.name || '' };
    if (heldBusinessId(id)) return null;   // builder item 83: one of the person's own businesses, not a studio inside a client
    return id ? { id: id, name: '' } : null;
  };
  window.ddsStudioLevel = function (host, opts) {
    var sc = window.ddsScopeInfo(); if (!sc) return false;
    host = hostOf(host); if (!host) return false;
    opts = opts || {};
    var noun = opts.noun || 'These records', lower = opts.lower || 'they';
    var who = sc.name || 'one client';
    // data-noscope is LOAD-BEARING: carryScopeGlobally rewrites every same-origin
    // APP_PAGES anchor to carry ?client=, so without it the escape hatch would be
    // re-scoped straight back into the client it is trying to leave.
    var href = opts.href || (location.pathname || '/agency.html');
    host.innerHTML = '<div class="dds-empty"><div class="ico">🏛️</div>' +
      '<h3>' + sEsc(noun + ' live at the studio level') + '</h3>' +
      '<p>' + sEsc('You’re looking at ' + who + '. Your ' + lower + ' belong to your studio, not to one client, so there’s nothing here to show — and nothing you could usefully add from inside a client.') + '</p>' +
      '<div class="act"><a class="primary" data-noscope href="' + sEsc(href) + '" style="display:inline-block;text-decoration:none">' + sEsc(opts.cta || ('Leave ' + who + ' and open ' + noun)) + '</a></div></div>';
    // The page's own fetch usually beats the shell's context fetch, so the first
    // paint often knows the scope but not the client's NAME. When context lands,
    // repaint once so the notice says who you are actually looking at. Guarded by
    // `!sc.name` so this can never loop.
    if (!sc.name) document.addEventListener('dds:context', function () { window.ddsStudioLevel(host, opts); }, { once: true });
    return true;
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
  // Phase 4 (delete safety): an optional third argument {label, onClick} adds ONE
  // action to the toast — "Undo" after a removal. A toast with an action stays
  // up longer and is clickable; plain toasts are unchanged.
  window.ddsToast = function (message, kind, action) {
    var t = el('<div class="dds-toast ' + (kind === 'err' ? 'err' : 'ok') + '" role="status" aria-live="polite"><span class="ico">' + (kind === 'err' ? '!' : '✓') + '</span><span class="t"></span></div>');
    t.querySelector('.t').textContent = String(message == null ? '' : message);
    var ms = kind === 'err' ? 5200 : 3200;
    if (action && action.label && typeof action.onClick === 'function') {
      var a = document.createElement('button'); a.type = 'button'; a.className = 'act'; a.textContent = String(action.label);
      a.addEventListener('click', function () { try { action.onClick(); } finally { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 250); } });
      t.appendChild(a); t.classList.add('has-act'); ms = 8000;
    }
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 250); }, ms);
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
        offBanner = el('<div id="dds-offline" role="alert" style="position:fixed;top:var(--dds-shell-h,54px);left:0;right:0;z-index:2147483003;background:#8a6d3b;color:#fff;font-family:var(--dds-sans,sans-serif);font-size:13px;font-weight:600;text-align:center;padding:var(--dds-s2,8px) 14px">You’re offline — changes can’t save until the connection returns. Keep this tab open.</div>');
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

  // ── Shared context handoff (PERF) ──
  // /portal/context is the single most expensive boot read and the shell already
  // fetches it — boot() publishes it as window.__ddsContext + the 'dds:context'
  // event. Pages await this instead of firing an identical second request:
  // resolves immediately when the shell's copy exists, else on the shell's
  // event; rejects after ~2500ms (minimal shell, signed out, or a non-shell
  // embed) so the caller falls back to its own api('/portal/context') read.
  window.ddsContext = function () {
    return new Promise(function (resolve, reject) {
      if (window.__ddsContext) return resolve(window.__ddsContext);
      var done = false;
      function settle() {
        if (done) return; done = true;
        if (window.__ddsContext) resolve(window.__ddsContext);
        else reject(new Error('shell context unavailable'));
      }
      document.addEventListener('dds:context', settle, { once: true });
      setTimeout(settle, 2500);
    });
  };

  // ── What an invited member's role can't use ──
  // The server refuses a member's delete or configure write (routes/workspace.ts
  // memberWriteGate). A page marks those controls data-needs="delete|configure|owner";
  // this names what the caller lacks on <html> and shell.css hides them, including any
  // the page draws later. Owners, a studio scoped in and platform staff never meet that
  // gate, so they lack nothing. Nor does anyone whose context didn't load: the server
  // still refuses, and a hidden button would be the worse failure for an owner.
  function markRoleLimits(ctx) {
    var caps = ctx.capabilities;
    if (ctx.site_role === 'business_owner' || ctx.scope || ctx.is_operator || !Array.isArray(caps)) return;
    var lacks = ['owner'];   // a few routes ask for the account owner by role, not by capability
    if (caps.indexOf('delete') < 0) lacks.push('delete');
    if (caps.indexOf('configure') < 0) lacks.push('configure');
    document.documentElement.setAttribute('data-dds-lacks', lacks.join(' '));
  }
  window.ddsLacks = function (need) {
    return (' ' + (document.documentElement.getAttribute('data-dds-lacks') || '') + ' ').indexOf(' ' + need + ' ') >= 0;
  };

  // ── The sign-in context is kept for the visit (speed, Nov 10 2026) ──
  // Every page used to wait for /portal/context before its menu drew, and every
  // move between pages asked again. The answer is now kept in this tab
  // (sessionStorage, per signed-in user and per client scope), so the next page
  // draws its menu at once and asks nothing. A copy older than CTX_FRESH_MS is
  // still used at once and read again behind the page; one older than
  // CTX_KEEP_MS is not used. It is a convenience only: the server checks every
  // call for itself. Sign out, and a page that changes the menu or the plan
  // (ddsContextForget), drop it.
  var CTX_FRESH_MS = 120000, CTX_KEEP_MS = 30 * 60000, CTX_PREFIX = 'dds-ctx:';
  var ctxUid = '';
  function ctxKey(uid) { return CTX_PREFIX + uid + ':' + (scopeId() || '-'); }
  function keptContext(uid) {
    if (!uid) return null;
    try {
      var k = JSON.parse(sessionStorage.getItem(ctxKey(uid)) || 'null');
      if (!k || !k.data || typeof k.at !== 'number') return null;
      var age = Date.now() - k.at;
      return (age >= 0 && age <= CTX_KEEP_MS) ? k : null;
    } catch (_) { return null; }
  }
  function keepContext(at) {
    if (!ctxUid || !CTX) return;
    try { sessionStorage.setItem(ctxKey(ctxUid), JSON.stringify({ at: at || Date.now(), data: CTX })); } catch (_) { /* storage may be full or denied */ }
  }
  var ctxKeptAt = 0;
  window.ddsContextForget = function () {
    try {
      for (var i = sessionStorage.length - 1; i >= 0; i--) { var k = sessionStorage.key(i); if (k && k.indexOf(CTX_PREFIX) === 0) sessionStorage.removeItem(k); }
    } catch (_) { /* */ }
  };
  // everything but the bell's number, which has its own refresh
  function ctxShape(c) { var o = {}; for (var k in c) if (k !== 'attention_count' && k !== 'attention_stale') o[k] = c[k]; return JSON.stringify(o); }
  function useContext(data, uid, keptAt) {
    CTX = data; ctxUid = uid; ctxKeptAt = keptAt || Date.now(); markRoleLimits(CTX); render();
    try { paintStudioRequests(); } catch (_) { /* a request banner must never break the shell */ }
    rememberBusinesses();   // builder item 83
    // B4: a fresh read IS the endpoint's read, so the 60s throttle window starts
    // here; a kept copy starts it when it was read
    if (keptAt) lastAttentionAt = keptAt; else markAttentionFresh();
    // batch B: a studio total Home already handed over wins; a stale or
    // missing one is refreshed behind the page unless Home hands one over first
    if (pendingBell !== null) { setAttention(Number(pendingBell)); pendingBell = null; }
    else if (!keptAt && studioTotals() && CTX.attention_stale) setTimeout(function () { if (!pageSetBell) readStudioTotal(false); }, 1200);
    try { trackCrmRecent(); } catch (_) { /* recents are best-effort */ }
    // PERF: /portal/context is the single most expensive boot read (~17
    // queries incl. 3× auth). The shell already has it — publish it so
    // a page can reuse it instead of firing an identical second request.
    try { window.__ddsContext = CTX; document.dispatchEvent(new CustomEvent('dds:context', { detail: CTX })); } catch (_) { /* */ }
    if (!keptAt) keepContext(ctxKeptAt);
    try { maybeTour(); } catch (_) { /* the tour must never break the shell */ }
  }
  // An older kept copy is read again behind the page. The frame is redrawn only
  // when something other than the bell's number changed; a failed read keeps
  // the copy on screen, and a refused one (signed out elsewhere) drops it.
  function rereadContext(uid) {
    api('/portal/context').then(function (r) {
      if (!r || !r.ok || !r.body || !r.body.data) { if (r && (r.status === 401 || r.status === 403)) window.ddsContextForget(); return; }
      var next = r.body.data, changed = ctxShape(next) !== ctxShape(CTX);
      var n = next.attention_count;
      if (changed) {
        if (pageSetBell) { next.attention_count = CTX.attention_count; next.attention_stale = CTX.attention_stale; }   // Home's own number stands
        CTX = next; markRoleLimits(CTX); render();
        try { paintStudioRequests(); } catch (_) { /* */ }
        rememberBusinesses();   // builder item 83
        try { window.__ddsContext = CTX; document.dispatchEvent(new CustomEvent('dds:context', { detail: CTX })); } catch (_) { /* */ }
      } else if (!pageSetBell) {
        CTX.attention_stale = next.attention_stale;
        if (typeof n === 'number' && isFinite(n) && n >= 0 && n !== CTX.attention_count) { CTX.attention_count = n; paintBell(); }
      }
      markAttentionFresh(); ctxKeptAt = Date.now(); keepContext(ctxKeptAt);
      if (!pageSetBell && studioTotals() && CTX.attention_stale) readStudioTotal(false);
    })['catch'](function () { /* keep the copy on screen */ });
  }

  function boot() {
    mountFrame();
    scanHints();
    ensureSupabase().then(function () {
      if (!window.supabase) { minimalShell(); return; }
      // Reuse the page's client when it made one for the same project: two clients on
      // one storage key both auto-refresh, and a refresh token only works once.
      sb = window.__ddsSb || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: 'dds-portal-auth', persistSession: true, autoRefreshToken: true } });
      // Keep TOKEN fresh: the SDK auto-refreshes the session (~hourly) and fires
      // this — without it the captured token goes stale and every call 401s.
      sb.auth.onAuthStateChange(function (_evt, session) { if (session && session.access_token) TOKEN = session.access_token; });
      sb.auth.getSession().then(function (res) {
        var sess = res && res.data && res.data.session;
        TOKEN = (sess && sess.access_token) || "";
        sb.__email = (sess && sess.user && sess.user.email) || '';
        if (!TOKEN) { minimalShell(); return; }
        var uid = (sess && sess.user && sess.user.id) || '';
        var kept = keptContext(uid);
        if (kept) {
          // kept from an earlier page of this visit: the menu draws now and the page's
          // own reads start now. An older copy is read again behind the page.
          useContext(kept.data, uid, kept.at);
          var age = Date.now() - kept.at;
          if (age > CTX_FRESH_MS || (age > ATTENTION_THROTTLE_MS && !studioTotals())) rereadContext(uid);
          else if (studioTotals() && (CTX.attention_stale || age > ATTENTION_THROTTLE_MS)) setTimeout(function () { if (!pageSetBell) { markAttentionFresh(); readStudioTotal(false); } }, 1200);
          return;
        }
        api('/portal/context').then(function (r) {
          if (!r.ok || !r.body || !r.body.data) { minimalShell(); return; }
          useContext(r.body.data, uid, 0);
        });
      }).catch(minimalShell);
    });
  }
  // ── A studio asked to work with you (final pass, Nov 8: S1) ──────────────
  // /portal/context lists the requests waiting on this site's OWNER. Each shows
  // once at the top of the page, with what saying yes means; nothing is linked
  // until Accept. Accepting can change what the owner sees (their studio's
  // projects and messages), so the page reloads after.
  function paintStudioRequests() {
    var list = (CTX && Array.isArray(CTX.studio_requests)) ? CTX.studio_requests : [];
    var old = document.getElementById('dds-studio-req'); if (old) old.remove();
    if (!list.length) return;
    var host = document.querySelector('main') || document.getElementById('main') || document.body;
    var wrap = document.createElement('div'); wrap.id = 'dds-studio-req';
    list.forEach(function (rq) {
      var box = document.createElement('section'); box.className = 'dds-req'; box.setAttribute('aria-label', 'A studio asked to work with you');
      var p = document.createElement('p');
      var b = document.createElement('b'); b.textContent = String(rq.studio || 'A studio');
      p.appendChild(b); p.appendChild(document.createTextNode(' asked to work with you on Studio OS. If you accept, they can open and work on your website, and send you messages and invoices here.'));
      var acts = document.createElement('div'); acts.className = 'acts';
      var yes = document.createElement('button'); yes.type = 'button'; yes.className = 'yes'; yes.textContent = 'Accept';
      var no = document.createElement('button'); no.type = 'button'; no.textContent = 'Decline';
      function answer(verb) {
        yes.disabled = true; no.disabled = true;
        window.ddsApi('/portal/studio-requests/' + encodeURIComponent(rq.id) + '/' + verb, { method: 'POST', body: {} }).then(function (r) {
          var msg = (r && r.body && r.body.message) || '';
          if (!r || !r.ok) { yes.disabled = false; no.disabled = false; if (window.ddsToast) window.ddsToast(msg || 'That didn’t save. Please try again.', 'err'); return; }
          box.remove();
          window.ddsContextForget();   // answered: the kept copy still lists this request
          if (verb === 'accept') {
            if (window.ddsToast) window.ddsToast('You’re connected with ' + String(rq.studio || 'the studio') + '.');
            setTimeout(function () { location.reload(); }, 900);
          } else if (window.ddsToast) window.ddsToast('Declined. ' + String(rq.studio || 'The studio') + ' won’t be connected.');
        });
      }
      yes.addEventListener('click', function () { answer('accept'); });
      no.addEventListener('click', function () { answer('decline'); });
      acts.appendChild(yes); acts.appendChild(no); box.appendChild(p); box.appendChild(acts); wrap.appendChild(box);
    });
    host.insertBefore(wrap, host.firstChild);
  }

  // Register the service worker on app pages too — this is what makes the
  // workspace installable (manifest + SW) and enables push. sw.js caches only
  // the marketing pages it lists, so every app page comes from the network.
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
  // An element that handles its own Enter/Space (a Pipeline card, a Files tile)
  // calls preventDefault and has already acted — clicking it as well opened the
  // card twice, and the second open took the focus-return target with it.
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return;
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
