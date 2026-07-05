/* ============================================================================
   dp-mode.js — Studio OS Design Partner Mode
   ----------------------------------------------------------------------------
   A research instrument, not a demo mode. Drop-in: no changes to the host
   page's code. Captures explicit feedback (5-question panel) and passive
   signals (pages, time, clicks, rage clicks, backtracking, abandoned flows,
   JS errors).

   HONESTY CONTRACT (enforced in code, tell your partners this):
     • Never records what anyone types. No input values, ever.
     • Shows a visible "Research mode" pill at all times. No covert telemetry.
     • Records interaction metadata only: element, page, timing.
     • Data goes to YOUR Supabase (dp_events / dp_feedback), readable only
       by you via the service role. Partners can insert, never read.

   INSTALL (2 lines, just before </body>):
     <script src="/dp-mode.js"></script>
     <script>DPMode.init({ app:'admin' });</script>   // or app:'portal'

   The script auto-discovers the Supabase URL + anon key + session from the
   page (SB_URL/SB_KEY or SUPABASE_URL/SUPABASE_KEY globals, and the
   'dds-admin-auth' / 'dds-portal-auth' storage keys). Override in init() if
   ever needed: DPMode.init({ app:'admin', url:'...', anon:'...', storageKey:'...' })

   OPTIONAL (better page names in a SPA — one line in your nav handler):
     DPMode.page('Tasks');
   Without it, pages are inferred from location.hash / document.title.

   OPTIONAL flow tracking for custom modals (forms are automatic):
     DPMode.flowStart('Create client'); DPMode.flowComplete('Create client');
   ========================================================================== */
(function () {
  'use strict';

  // ── state ─────────────────────────────────────────────────────────────
  var cfg = null;
  var queue = [];
  var sessionId = null;
  var curPage = null;
  var pageEnteredAt = 0;
  var visibleMs = 0;          // accumulated visible time on current page
  var visibleSince = 0;       // ts when page last became visible
  var pageTrail = [];         // [{page, ms}] recent history for backtrack detection
  var clickLog = {};          // target -> [timestamps] for rage detection
  var repeatCounts = {};      // target -> count within this page view
  var openFlows = {};         // flowName -> startTs
  var flushTimer = null;
  var ready = false;
  // on-screen diagnostics (this machine may block DevTools; never rely on console)
  var stat = { sent: 0, fails: 0, lastFlush: 0, lastErr: null, session: false, cfgOk: false };
  var pendingSearch = null;      // {sel, timer} — outcome tracked, query NEVER read
  var askedThisSession = false;  // confidence check-in: hard cap of one per session

  function now() { return Date.now(); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function store(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function persist(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  // ── session / auth discovery (no supabase-js dependency) ─────────────
  function findConfig(user) {
    var url = (user && user.url) || window.SB_URL || window.SUPABASE_URL || null;
    var anon = (user && user.anon) || window.SB_KEY || window.SUPABASE_KEY || null;
    var storageKey = (user && user.storageKey) ||
      (user && user.app === 'portal' ? 'dds-portal-auth' : 'dds-admin-auth');
    return { url: url, anon: anon, storageKey: storageKey };
  }
  function readSession() {
    // supabase-js v2 persists the session JSON at the storageKey.
    try {
      var raw = localStorage.getItem(cfg.storageKey);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (s && s.currentSession) s = s.currentSession; // older shapes
      if (!s || !s.access_token || !s.user) return null;
      return { token: s.access_token, userId: s.user.id, email: s.user.email || null };
    } catch (e) { return null; }
  }

  // ── on-screen status (no console needed) ──────────────────────────────
  function paintStatus() {
    var dot = document.getElementById('dp-dot');
    var diag = document.getElementById('dp-diag');
    var color, msg;
    if (!stat.cfgOk) { color = '#B3261E'; msg = 'Setup issue: Supabase URL or anon key not found on this page.'; }
    else if (stat.lastErr) { color = '#B3261E'; msg = 'Last send failed: ' + stat.lastErr; }
    else if (!stat.session) { color = '#B26A00'; msg = 'No login session found yet \u2014 log in, then click around.'; }
    else if (stat.sent > 0) { color = '#2E7D52'; msg = 'Working. ' + stat.sent + ' events saved' + (stat.lastFlush ? ' \u00b7 last send ' + Math.round((now() - stat.lastFlush) / 1000) + 's ago' : '') + '.'; }
    else { color = 'var(--brass,#B08D57)'; msg = 'Running \u2014 nothing sent yet (first batch goes after ~15s or 20 events).'; }
    if (dot) dot.style.background = color;
    if (diag) diag.textContent = 'Diagnostics: ' + msg;
  }

  // ── event pipeline ────────────────────────────────────────────────────
  function track(type, detail) {
    if (!ready) return;
    queue.push({ type: type, page: curPage, detail: detail || {}, at: new Date().toISOString() });
    if (queue.length >= 20) flush(false);
  }

  function flush(unloading) {
    if (!queue.length) return;
    var sess = readSession();
    stat.session = !!sess;
    if (!sess) { queue.length = 0; paintStatus(); return; }   // logged out: drop silently
    var rows = queue.splice(0, queue.length).map(function (e) {
      return {
        session_id: sessionId, user_id: sess.userId, email: sess.email,
        app: cfg.app, page: e.page, type: e.type, detail: e.detail, created_at: e.at
      };
    });
    try {
      fetch(cfg.url + '/rest/v1/dp_events', {
        method: 'POST',
        keepalive: !!unloading,
        headers: {
          'apikey': cfg.anon,
          'Authorization': 'Bearer ' + sess.token,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(rows)
      }).then(function (r) {
        if (r.ok) { stat.sent += rows.length; stat.lastFlush = now(); stat.lastErr = null; }
        else { stat.fails++; stat.lastErr = 'HTTP ' + r.status + (r.status === 404 ? ' (dp_events table missing? run the SQL)' : (r.status === 401 || r.status === 403) ? ' (auth/RLS \u2014 re-run the SQL policies)' : ''); }
        paintStatus();
      }).catch(function () { stat.fails++; stat.lastErr = 'network'; paintStatus(); });
    } catch (e) { stat.fails++; stat.lastErr = 'send error'; paintStatus(); }
  }

  // ── page detection (SPA-safe: poll + hash + manual API) ───────────────
  function inferPage() {
    if (location.hash && location.hash.length > 1) return decodeURIComponent(location.hash.slice(1));
    return (document.title || 'app').replace(/\s*[|·—-].*$/, '').trim();
  }
  function setPage(name) {
    name = String(name || '').slice(0, 80);
    if (!name || name === curPage) return;
    var t = now();
    if (curPage !== null) {
      // close out old page
      if (document.visibilityState === 'visible' && visibleSince) visibleMs += t - visibleSince;
      var repeats = 0;
      Object.keys(repeatCounts).forEach(function (k) { if (repeatCounts[k] > repeats) repeats = repeatCounts[k]; });
      track('page_leave', { ms: visibleMs, repeats: repeats });
      abandonOpenFlows('page_change');
      resolveSearch('search_abandon');
      pageTrail.push({ page: curPage, ms: visibleMs });
      if (pageTrail.length > 6) pageTrail.shift();
      // backtrack: A -> B -> A with short dwell on B
      var n = pageTrail.length;
      if (n >= 2 && pageTrail[n - 2].page === name && pageTrail[n - 1].ms < 8000) {
        track('backtrack', { from: pageTrail[n - 1].page, ms: pageTrail[n - 1].ms });
      }
    }
    curPage = name;
    pageEnteredAt = t; visibleMs = 0;
    visibleSince = document.visibilityState === 'visible' ? t : 0;
    repeatCounts = {};
    track('page_view', {});
    var pill = document.getElementById('dp-pill-page');
    if (pill) pill.textContent = name;
  }

  // ── clicks / rage / repeats ───────────────────────────────────────────
  function selectorOf(el) {
    if (!el || !el.tagName) return '?';
    var s = el.tagName.toLowerCase();
    if (el.id) return s + '#' + el.id;
    if (el.classList && el.classList.length) s += '.' + el.classList[0];
    return s;
  }
  function labelOf(el) {
    var t = (el.getAttribute && (el.getAttribute('aria-label') || el.title)) || el.textContent || '';
    return t.replace(/\s+/g, ' ').trim().slice(0, 40); // metadata only, never values
  }
  function onClick(ev) {
    var el = ev.target && ev.target.closest ? (ev.target.closest('button, a, [role="button"], .sbtn, input[type="checkbox"], input[type="radio"], select, [onclick]') || ev.target) : ev.target;
    if (!el || !el.tagName) return;
    // never look at what's typed
    if (/^(input|textarea)$/i.test(el.tagName) && !/^(checkbox|radio|button|submit)$/i.test(el.type || '')) return;
    if (el.closest && el.closest('#dp-widget')) return; // don't measure the instrument

    var sel = selectorOf(el), t = now();
    var log = clickLog[sel] = (clickLog[sel] || []).filter(function (ts) { return t - ts < 900; });
    log.push(t);
    repeatCounts[sel] = (repeatCounts[sel] || 0) + 1;
    if (log.length >= 3) {
      track('rage_click', { sel: sel, text: labelOf(el), n: log.length });
      clickLog[sel] = [];
    } else {
      track('click', { sel: sel, text: labelOf(el) });
    }
  }

  // ── flows: forms automatically, custom via API ────────────────────────
  function flowKeyFor(el) {
    var box = el.closest && el.closest('form, [data-dp-flow], .modal, [role="dialog"]');
    if (!box) return null;
    return box.getAttribute('data-dp-flow') || box.id || (box.tagName === 'FORM' ? 'form' : 'dialog');
  }
  function onFocusIn(ev) {
    var el = ev.target;
    if (!el || !/^(input|textarea|select)$/i.test(el.tagName)) return;
    if (el.closest && el.closest('#dp-widget')) return;
    var key = flowKeyFor(el);
    if (key && !openFlows[key]) { openFlows[key] = now(); track('flow_start', { flow: key }); }
  }
  function onSubmitLike(ev) {
    var el = ev.target;
    var key = ev.type === 'submit' ? flowKeyFor(el) :
      (el.closest && el.closest('button[type="submit"], .sbtn') ? flowKeyFor(el) : null);
    if (key && openFlows[key]) {
      var fms = now() - openFlows[key];
      track('flow_complete', { flow: key, ms: fms });
      delete openFlows[key];
      maybeCheckin(key, fms);
    }
  }
  function abandonOpenFlows(reason) {
    Object.keys(openFlows).forEach(function (k) {
      track('flow_abandon', { flow: k, ms: now() - openFlows[k], why: reason });
      delete openFlows[k];
    });
  }

  // ── errors partners will never report themselves ──────────────────────
  function onError(ev) {
    var msg = (ev && (ev.message || (ev.reason && (ev.reason.message || String(ev.reason))))) || 'unknown';
    track('error', { msg: String(msg).slice(0, 200) });
  }

  // ── visibility (count only visible time) ──────────────────────────────
  function onVisibility() {
    var t = now();
    if (document.visibilityState === 'hidden') {
      if (visibleSince) { visibleMs += t - visibleSince; visibleSince = 0; }
      flush(true);
    } else {
      visibleSince = t;
    }
  }

  // ── search outcomes: searched-then-found vs searched-then-gave-up ─────
  // Constitution: we record that a search happened and how it ended.
  // We NEVER read the query. No .value access anywhere in this block.
  function isSearchField(el) {
    if (!el || !/^input$/i.test(el.tagName || '')) return false;
    if ((el.type || '') === 'search') return true;
    var ph = (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '');
    return /search|jump to/i.test(ph) || el.hasAttribute('data-dp-search');
  }
  function resolveSearch(outcome) {
    if (!pendingSearch) return;
    clearTimeout(pendingSearch.timer);
    track(outcome, { sel: pendingSearch.sel });
    pendingSearch = null;
  }
  function onSearchKey(ev) {
    var el = ev.target;
    if (!isSearchField(el) || (el.closest && el.closest('#dp-widget'))) return;
    if (pendingSearch) clearTimeout(pendingSearch.timer);
    var sel = selectorOf(el);
    if (!pendingSearch || pendingSearch.sel !== sel) track('search', { sel: sel });
    pendingSearch = { sel: sel, timer: setTimeout(function () { resolveSearch('search_abandon'); }, 12000) };
  }
  function onSearchOutcomeClick(ev) {
    if (!pendingSearch) return;
    var el = ev.target;
    if (isSearchField(el) || (el.closest && el.closest('#dp-widget'))) return;
    resolveSearch('search_click');
  }

  // ── confidence check-in: one tap, only at meaningful moments ──────────
  // Fires only after the FIRST completion of a flow that took >= 20s.
  // Max one ask per session; never the same flow twice, ever; gone in 15s.
  function maybeCheckin(flowName, ms) {
    if (askedThisSession || ms < 20000) return;
    if (persist('dpCk_' + flowName)) return;
    askedThisSession = true;
    persist('dpCk_' + flowName, '1');
    var el = document.createElement('div');
    el.id = 'dp-checkin';
    el.innerHTML = '<span style="font-size:12px;margin-right:8px;">Quick one \u2014 how confident did that feel?</span>' +
      '<span id="dp-ck-btns"></span>' +
      '<button id="dp-ck-skip" type="button" style="background:none;border:none;color:rgba(255,255,255,.55);font-size:11px;cursor:pointer;margin-left:6px;">skip</button>';
    var btns = el.querySelector('#dp-ck-btns');
    for (var i = 1; i <= 5; i++) (function (v) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = v;
      b.style.cssText = 'width:26px;height:26px;margin:0 2px;border:1px solid rgba(255,255,255,.35);background:none;color:#fff;border-radius:6px;font-size:12px;cursor:pointer;';
      b.addEventListener('click', function () {
        var sess = readSession();
        if (sess) {
          fetch(cfg.url + '/rest/v1/dp_feedback', {
            method: 'POST',
            headers: { 'apikey': cfg.anon, 'Authorization': 'Bearer ' + sess.token, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ session_id: sessionId, user_id: sess.userId, email: sess.email, app: cfg.app, page: curPage, trying_to: flowName, confidence: v })
          }).catch(function () {});
        }
        el.innerHTML = '<span style="font-size:12px;">Thanks \u2014 noted.</span>';
        setTimeout(function () { el.remove(); }, 1200);
      });
      btns.appendChild(b);
    })(i);
    el.querySelector('#dp-ck-skip').addEventListener('click', function () { el.remove(); });
    el.style.cssText = 'position:fixed;z-index:99999;right:18px;bottom:64px;background:var(--ink,#1B1525);color:#fff;border-radius:12px;padding:10px 14px;font-family:Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(27,21,37,.3);display:flex;align-items:center;';
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 15000);
  }

  // ── the feedback widget ───────────────────────────────────────────────
  var CSS = '' +
    '#dp-widget{position:fixed;z-index:99999;right:18px;bottom:18px;font-family:Inter,system-ui,sans-serif}' +
    '#dp-pill{display:flex;align-items:center;gap:8px;background:var(--ink,#1B1525);color:#fff;border:none;border-radius:999px;padding:9px 16px;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(27,21,37,.25)}' +
    '#dp-pill b{font-weight:600}#dp-pill-page{opacity:.65;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#dp-dot{width:8px;height:8px;border-radius:50%;background:var(--brass,#B08D57);flex:none}' +
    '#dp-panel{display:none;position:absolute;right:0;bottom:52px;width:330px;max-height:76vh;overflow:auto;background:var(--paper,#FBFAF7);color:var(--ink,#1B1525);border:1px solid rgba(27,21,37,.12);border-radius:14px;box-shadow:0 18px 50px rgba(27,21,37,.22);padding:18px}' +
    '#dp-panel h3{margin:0 0 4px;font-family:Fraunces,Georgia,serif;font-size:17px}' +
    '#dp-panel .dp-sub{font-size:12px;color:rgba(27,21,37,.6);margin-bottom:12px;line-height:1.5}' +
    '#dp-panel label{display:block;font-size:12px;font-weight:600;margin:10px 0 4px}' +
    '#dp-panel textarea{width:100%;box-sizing:border-box;border:1px solid rgba(27,21,37,.18);border-radius:8px;padding:8px;font:13px/1.4 Inter,system-ui,sans-serif;background:#fff;resize:vertical;min-height:34px}' +
    '#dp-conf{display:flex;gap:6px;margin-top:4px}' +
    '#dp-conf button{flex:1;padding:7px 0;border:1px solid rgba(27,21,37,.18);background:#fff;border-radius:8px;font-size:13px;cursor:pointer}' +
    '#dp-conf button.on{background:var(--p,#5B3FA0);border-color:var(--p,#5B3FA0);color:#fff}' +
    '#dp-send{width:100%;margin-top:14px;padding:10px;border:none;border-radius:9px;background:var(--p,#5B3FA0);color:#fff;font-size:14px;font-weight:600;cursor:pointer}' +
    '#dp-send[disabled]{opacity:.55;cursor:default}' +
    '#dp-thanks{display:none;text-align:center;padding:26px 6px;font-size:14px;line-height:1.6}' +
    '#dp-notice{position:fixed;z-index:99998;left:50%;transform:translateX(-50%);bottom:74px;max-width:420px;background:var(--ink,#1B1525);color:#fff;border-radius:12px;padding:14px 16px;font:13px/1.55 Inter,system-ui,sans-serif;box-shadow:0 12px 34px rgba(27,21,37,.35)}' +
    '#dp-notice button{margin-top:10px;background:var(--brass,#B08D57);border:none;color:#fff;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer}';

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function buildWidget() {
    var style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    var w = document.createElement('div'); w.id = 'dp-widget';
    w.innerHTML =
      '<div id="dp-panel">' +
      '  <div id="dp-form">' +
      '    <h3>Tell me what just happened</h3>' +
      '    <div class="dp-sub">Two minutes, totally raw is perfect. You are shaping this product.</div>' +
      '    <label>What were you trying to do?</label><textarea id="dp-q1" rows="2"></textarea>' +
      '    <label>Was anything confusing on this page?</label><textarea id="dp-q2" rows="2"></textarea>' +
      '    <label>Did anything surprise you?</label><textarea id="dp-q3" rows="2"></textarea>' +
      '    <label>Was anything missing?</label><textarea id="dp-q4" rows="2"></textarea>' +
      '    <label>How confident did you feel here?</label>' +
      '    <div id="dp-conf">' +
      '      <button data-v="1">1</button><button data-v="2">2</button><button data-v="3">3</button>' +
      '      <button data-v="4">4</button><button data-v="5">5</button>' +
      '    </div>' +
      '    <label>Anything else</label><textarea id="dp-q5" rows="2"></textarea>' +
      '    <button id="dp-send">Send feedback →</button>' +
      '  </div>' +
      '  <div id="dp-thanks">Got it — thank you.<br>Every note like this changes the product.</div>' +
      '  <div id="dp-diag" style="margin-top:10px;padding-top:9px;border-top:1px dashed rgba(27,21,37,.15);font-size:11px;color:rgba(27,21,37,.55);line-height:1.5"></div>' +
      '</div>' +
      '<button id="dp-pill" type="button" title="Design partner research mode is on">' +
      '  <span id="dp-dot"></span><b>Research mode</b><span id="dp-pill-page"></span>' +
      '</button>';
    document.body.appendChild(w);

    var confidence = null;
    w.querySelector('#dp-pill').addEventListener('click', function () {
      var p = w.querySelector('#dp-panel');
      p.style.display = p.style.display === 'block' ? 'none' : 'block';
      w.querySelector('#dp-form').style.display = 'block';
      w.querySelector('#dp-thanks').style.display = 'none';
      paintStatus();
    });
    w.querySelector('#dp-conf').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      confidence = parseInt(b.getAttribute('data-v'), 10);
      w.querySelectorAll('#dp-conf button').forEach(function (x) { x.classList.toggle('on', x === b); });
    });
    w.querySelector('#dp-send').addEventListener('click', function () {
      var sess = readSession(); if (!sess) return;
      var btn = this; btn.disabled = true;
      var body = {
        session_id: sessionId, user_id: sess.userId, email: sess.email,
        app: cfg.app, page: curPage,
        trying_to: val('dp-q1'), confusing: val('dp-q2'), surprising: val('dp-q3'),
        missing: val('dp-q4'), confidence: confidence, notes: val('dp-q5')
      };
      fetch(cfg.url + '/rest/v1/dp_feedback', {
        method: 'POST',
        headers: { 'apikey': cfg.anon, 'Authorization': 'Bearer ' + sess.token, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(body)
      }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { alert('That didn\u2019t save \u2014 mind trying once more?'); return; }
        w.querySelector('#dp-form').style.display = 'none';
        w.querySelector('#dp-thanks').style.display = 'block';
        ['dp-q1','dp-q2','dp-q3','dp-q4','dp-q5'].forEach(function (id) { document.getElementById(id).value = ''; });
        confidence = null;
        w.querySelectorAll('#dp-conf button').forEach(function (x) { x.classList.remove('on'); });
        setTimeout(function () { w.querySelector('#dp-panel').style.display = 'none'; }, 1600);
      }).catch(function () { btn.disabled = false; alert('That didn\u2019t save \u2014 mind trying once more?'); });
    });
    function val(id) { var v = document.getElementById(id).value.trim(); return v || null; }
  }

  function showNoticeOnce() {
    if (persist('dpAckV1')) return;
    var n = document.createElement('div'); n.id = 'dp-notice';
    n.innerHTML = '<b>Research mode is on.</b><br>' +
      'This design-partner deployment records how the product is used \u2014 pages, clicks, and timing. ' +
      '<b>It never records what you type.</b> The little pill in the corner is always there to send feedback. Thank you for shaping this.' +
      '<br><button type="button">Sounds good</button>';
    n.querySelector('button').addEventListener('click', function () { persist('dpAckV1', '1'); n.remove(); });
    document.body.appendChild(n);
  }

  // ── public API ────────────────────────────────────────────────────────
  window.DPMode = {
    init: function (user) {
      if (ready) return;
      cfg = findConfig(user || {});
      cfg.app = (user && user.app) || 'admin';
      stat.cfgOk = !!(cfg.url && cfg.anon);
      sessionId = store('dpSession') || uuid(); store('dpSession', sessionId);

      buildWidget();
      if (!stat.cfgOk) {
        // Some machines block DevTools: say it on screen instead and stop.
        paintStatus();
        var pg = document.getElementById('dp-pill-page');
        if (pg) pg.textContent = 'setup issue \u2014 click';
        return;
      }
      ready = true;
      stat.session = !!readSession();
      // Fleet kill switch: the public version route says whether the Design
      // Agent is enabled (pi_settings.dp_mode_enabled). Fail-open: if the
      // check errors, research mode stays on; a kill switch that kills on
      // network blips would be worse than none.
      try {
        fetch(cfg.url + '/functions/v1/clever-api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.anon },
          body: JSON.stringify({ type: 'version' })
        }).then(function (r) { return r.json(); }).then(function (j) {
          if (j && j.data && j.data.dp_enabled === false) {
            ready = false; queue.length = 0;
            var w = document.getElementById('dp-widget'); if (w) w.remove();
            var n = document.getElementById('dp-notice'); if (n) n.remove();
          }
        }).catch(function () {});
      } catch (e) {}
      showNoticeOnce();

      document.addEventListener('click', onClick, true);
      document.addEventListener('focusin', onFocusIn, true);
      document.addEventListener('submit', onSubmitLike, true);
      document.addEventListener('click', onSubmitLike, true);
      document.addEventListener('keyup', onSearchKey, true);
      document.addEventListener('click', onSearchOutcomeClick, true);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('error', onError);
      window.addEventListener('unhandledrejection', onError);
      window.addEventListener('pagehide', function () {
        onVisibility(); abandonOpenFlows('left'); setPage('__end'); flush(true);
      });

      setPage(inferPage());
      setInterval(function () {
        var p = inferPage();
        if (p && p !== curPage && curPage !== '__end') setPage(p);
      }, 1200);
      flushTimer = setInterval(function () { flush(false); }, 15000);
      paintStatus();
      setInterval(paintStatus, 5000);
    },
    page: function (name) { setPage(name); },
    flowStart: function (name) { if (name && !openFlows[name]) { openFlows[name] = now(); track('flow_start', { flow: name }); } },
    flowComplete: function (name) { if (name && openFlows[name]) { var fms = now() - openFlows[name]; track('flow_complete', { flow: name, ms: fms }); delete openFlows[name]; maybeCheckin(name, fms); } },
    event: function (type, detail) { track(String(type).slice(0, 30), detail || {}); },
    openFeedback: function () { var p = document.getElementById('dp-panel'); if (p) p.style.display = 'block'; }
  };
})();
