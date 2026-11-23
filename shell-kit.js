/* ── Studio OS — the shell's shared helpers (builder item 101, Nov 2026) ──────
   One API helper, one toast, one styled confirm (with its small prompt), one
   money and one date formatter, for every signed-in page. Each page used to
   carry its own copy, and the copies disagreed: a failure toast with a green
   tick, "a brief hiccup" when the sign-in had run out, buttons left stuck after
   a dropped connection, "today" a different day on two pages, "$1,200.00" on
   the pay page and "$1,200" in the portal, and the browser's own pop-up for
   eighteen questions in the back office.

   This file is part of the shell. It loads WITHOUT defer, in the body, right
   before the sign-in library and the page's own script, so the page can use it
   anywhere, and nothing in the head holds up the first paint (page_speed_test):
       <script src="/shell-kit.js"></script><script src="/vendor/supabase-js-2.45.4.js"></script><script>…the page…</script>
   shell.js (deferred in the head: the menu, the bell, search) runs after it and
   uses it too. Nothing here
   touches the page until it is called; the toast and the dialogs wait for
   <body> if a page asks before it exists. Styles live in shell.css. */
(function () {
  'use strict';
  if (window.ddsKit) return;

  var SUPABASE_URL = 'https://qksstlqzbhesadrrofgn.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrc3N0bHF6Ymhlc2FkcnJvZmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NzMwMDMsImV4cCI6MjA5NzU0OTAwM30.4V94Ua7z5cntPWtvtqN24TUnfY5A6K6-zCxY0iEcgYo';
  var FN = SUPABASE_URL + '/functions/v1/presence';
  // x-region: run the server beside the database in Oregon, not in the region nearest the
  // visitor. From the east coast each of the small database calls behind one answer crossed
  // the country: about 1 s an answer, 0.4 s beside the database (client.html, Nov 15 2026).
  // A signed-in call always gains: the server checks who is asking against the database
  // before anything else. Only for our own functions: Storage uploads and other hosts don't
  // allow the header, and the push key (shell.js) reads no database, so it goes without.
  var FN_REGION = 'us-west-2';
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function scopeId() { try { var v = new URLSearchParams(location.search).get('client') || ''; return UUID_RE.test(v) ? v : ''; } catch (_) { return ''; } }
  function onBody(fn) {
    if (typeof document === 'undefined') return;   // not in a page (the pure tests)
    if (document.body) { fn(); return; }
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  // ── The sign-in the API calls carry ─────────────────────────────────────────
  // A page hands over its own Supabase client (ddsApi.use(sb)), so the calls go
  // out with exactly the sign-in the page shows. Without one, the shell's shared
  // client (window.__ddsSb, which shell.js reuses), made on first use.
  var CLIENT = null, WATCHED = null, SESSION = null, SIGN_IN = '/studio.html';
  function client() {
    if (CLIENT) return CLIENT;
    if (window.__ddsSb) return window.__ddsSb;
    if (window.supabase && window.supabase.createClient) {
      window.__ddsSb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: 'dds-portal-auth', persistSession: true, autoRefreshToken: true } });
      return window.__ddsSb;
    }
    return null;
  }
  function watch(c) {
    if (WATCHED === c) return;
    WATCHED = c; SESSION = null;
    try { c.auth.onAuthStateChange(function (evt, s) { if (s && s.access_token) SESSION = s; else if (evt === 'SIGNED_OUT') SESSION = null; }); } catch (_) { /* an old client: getSession below still works */ }
  }
  // The session's token, read again from the client when it is close to running
  // out (the client refreshes a run-out one), so a tab left open overnight sends
  // a fresh one instead of failing.
  function token() {
    var c = client();
    if (!c || !c.auth) return Promise.resolve('');
    watch(c);
    var s = SESSION;
    if (s && s.access_token && !(s.expires_at && s.expires_at * 1000 - Date.now() < 60000)) return Promise.resolve(s.access_token);
    return Promise.resolve(c.auth.getSession()).then(function (res) {
      var n = res && res.data && res.data.session;
      if (n && n.access_token) SESSION = n;
      return (n && n.access_token) || '';
    }, function () { return (s && s.access_token) || ''; });
  }

  // ── The one API helper ──────────────────────────────────────────────────────
  //   ddsApi(path, { method, body, scope, headers, signal, keepalive }) → { ok, status, body }
  // It never throws for a failed call: no answer at all (no signal, a dropped
  // connection) is { ok:false, status:0, offline:true } with a sentence in
  // body.message, so a page's own "that didn't work" path always runs and a
  // button it switched off comes back. scope: '' sends a call with no client
  // in it (the studio's own book from inside a client); left out, the client
  // in the address (?client=) goes with it.
  var OFFLINE_MSG = 'We couldn’t reach Studio OS. Check your connection and try again.';
  var RAN_OUT_MSG = 'Your sign-in has run out. Sign in again to carry on.';
  function request(path, opts, jwt) {
    var h = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-dds-user-jwt': jwt, 'x-region': FN_REGION };
    var site = opts.scope !== undefined ? (opts.scope || '') : scopeId();
    if (site) h['x-dds-scope-site'] = site;   // none at all, not an empty one, for the studio's own book
    if (opts.headers) for (var k in opts.headers) if (opts.headers[k] != null) h[k] = opts.headers[k];
    var init = { method: opts.method || 'GET', headers: h };
    if (opts.body !== undefined && opts.body !== null) init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    if (opts.signal) init.signal = opts.signal;
    if (opts.keepalive) init.keepalive = true;
    return fetch(FN + path, init);
  }
  function api(path, opts) {
    opts = opts || {};
    return token().then(function (jwt) {
      return request(path, opts, jwt).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (b) {
          var out = { ok: r.ok, status: r.status, body: (b && typeof b === 'object') ? b : {} };
          if (r.status === 401 && jwt && (!out.body.error || out.body.error === 'unauthorized')) ranOut(out);
          return out;
        });
      }, function (e) {
        if (e && e.name === 'AbortError') throw e;   // a page that cancels its own call decides what that means
        return { ok: false, status: 0, offline: true, body: { error: 'offline', message: OFFLINE_MSG } };
      });
    });
  }
  // A download (a CSV, a PDF, a zip): the same call, answered with the browser's own Response
  // for the page to read as a file. No answer at all rejects, as fetch does, but with the
  // connection sentence as its message (never "Failed to fetch").
  api.raw = function (path, opts) {
    opts = opts || {};
    return token().then(function (jwt) {
      return request(path, opts, jwt).then(function (r) {
        if (r.status === 401 && jwt) ranOut({ body: {} });
        return r;
      }, function (e) {
        if (e && e.name === 'AbortError') throw e;
        var x = new Error(OFFLINE_MSG); x.offline = true; throw x;
      });
    });
  };
  // the page's own sign-in: ddsApi.use(sb), or ddsApi.use(sb, { signIn: '/portal.html' }) for a client's page
  // Builder item 414: a studio page's own client becomes the shared one (window.__ddsSb), so
  // shell.js reuses it instead of starting a second on the same storage key (the browser warned
  // on every page, and two clients both refreshing one session is a race). A client's portal
  // page (signIn given) keeps its client to itself: its session is on another key.
  api.use = function (c, o) { if (c && c.auth) { CLIENT = c; watch(c); if (!(o && o.signIn) && !window.__ddsSb) window.__ddsSb = c; } if (o && o.signIn) SIGN_IN = o.signIn; return api; };
  // The sentence for a call that didn't work: what the server said, else the
  // sign-in or connection sentence, else the page's own words.
  api.say = function (r, fallback) {
    if (r && r.status === 0) return OFFLINE_MSG;
    if (r && r.signedOut) return RAN_OUT_MSG;
    var m = r && r.body && r.body.message;
    return (typeof m === 'string' && m.trim()) ? m : (fallback || 'That didn’t work. Try again in a moment.');
  };

  // ── The sign-in has run out ────────────────────────────────────────────────
  // Every page now says so the same way, once, with the way back: a bar under
  // the top bar with "Sign in again", which brings the person back to this
  // page afterwards (the sign-in page reads dds-studio-return).
  var RAN_OUT = false;
  function ranOut(out) {
    out.signedOut = true;
    out.body = Object.assign({}, out.body, { message: RAN_OUT_MSG });
    if (RAN_OUT) return;
    RAN_OUT = true;
    onBody(function () {
      if (document.getElementById('dds-signin-again')) return;
      var bar = document.createElement('div'); bar.id = 'dds-signin-again'; bar.setAttribute('role', 'alert');
      bar.innerHTML = '<span class="t"></span><a class="go"></a>';
      bar.querySelector('.t').textContent = RAN_OUT_MSG;
      var a = bar.querySelector('.go'); a.href = SIGN_IN; a.textContent = 'Sign in again';
      a.addEventListener('click', function () {
        try { localStorage.setItem('dds-studio-return', JSON.stringify({ path: location.pathname + location.search + location.hash, at: Date.now() })); } catch (_) { /* the sign-in page then opens Home */ }
      });
      document.body.appendChild(bar);
    });
  }

  // ── The one toast ───────────────────────────────────────────────────────────
  //   ddsToast(message, kind, action) — kind 'err' (or 'error', 'bad', true) is a
  //   failure: it shows "!" and stays up longer; anything else is a success.
  //   action { label, onClick, ms } adds one button ("Undo") and keeps it up 8 s
  //   (or ms). A toast never covers one that holds a button, or a tip that's up: it sits just above.
  function isBad(kind) { return kind === 'err' || kind === 'error' || kind === 'bad' || kind === true; }
  function toast(message, kind, action) {
    var bad = isBad(kind);
    var t = document.createElement('div');
    t.className = 'dds-toast ' + (bad ? 'err' : 'ok'); t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite');
    t.innerHTML = '<span class="ico" aria-hidden="true"></span><span class="t"></span>';
    t.querySelector('.ico').textContent = bad ? '!' : '✓';
    t.querySelector('.t').textContent = String(message == null ? '' : message);
    var ms = bad ? 5200 : 3200;
    if (action && action.label && typeof action.onClick === 'function') {
      var a = document.createElement('button'); a.type = 'button'; a.className = 'act'; a.textContent = String(action.label);
      a.addEventListener('click', function () { try { action.onClick(); } finally { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 250); } });
      t.appendChild(a); t.classList.add('has-act'); ms = action.ms > 0 ? action.ms : 8000;
    }
    onBody(function () {
      document.body.appendChild(t);
      liftAbove(t);
      requestAnimationFrame(function () { t.classList.add('show'); });
      setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 250); }, ms);
    });
    return t;
  }

  // A toast that holds a button stays up long enough to press it; one that comes
  // after it, where it would cover it, goes just above it, so the button (Undo) is
  // never covered. The same for a tip that's up where the toast would land (the
  // editor's first-visit tip in Edit mode, on a phone).
  function liftAbove(t) {
    var me = t.getBoundingClientRect(), top = Infinity;
    Array.prototype.forEach.call(document.querySelectorAll('.dds-toast.has-act, .dds-hint'), function (o) {
      if (o === t || !o.classList.contains('show')) return;
      var r = o.getBoundingClientRect();
      if (!r.height || r.right <= me.left || r.left >= me.right || r.bottom <= me.top || r.top >= me.bottom) return;   // not in its way
      if (r.top < top) top = r.top;
    });
    if (top !== Infinity) t.style.bottom = Math.max(0, Math.round(window.innerHeight - top + 12)) + 'px';   // 12: clear of it while it slides in
  }

  // ── The one styled confirm, and its small prompt ────────────────────────────
  //   ddsConfirm({ title, text, yes, no, danger }) → Promise<true | false>
  //   ddsConfirm(title, text, yes, { danger })     (the same, in a line)
  //   ddsConfirm('Void this invoice? It stops being payable.', null, 'Void invoice', { danger: true })
  //     (a one-sentence question: up to the first "? " is the title, the rest the words under it)
  // The browser's own box can't be styled, reads like a system warning and, on a
  // phone, shows the site's address over the question. This one is the builder's
  // (item 33): a question that removes, sends or replaces something (danger)
  // starts on Cancel, so Enter never takes the risky path, and its button is red.
  // Escape and Cancel answer false. Focus goes back to what asked.
  //   ddsAsk({ title, text, label, value, placeholder, yes, password, max, required }) → Promise<string | null>
  var DLG_N = 0;
  function dialogBox(o, field) {
    return new Promise(function (resolve) {
      onBody(function () {
        var id = 'ddsDlg' + (++DLG_N), back = document.activeElement;
        var d = document.createElement('dialog');
        // ask-yes / ask-msg / ask-ok / ask-cancel are the builder's names for its question (item 33),
        // kept so one test helper (tests/e2e/helpers/app.ts answerAsks) answers both; dds-ask is the
        // list kit's name for its naming prompt
        d.className = 'dds-dlg ' + (field ? 'dds-ask' : 'ask-yes') + (o.danger ? ' danger' : '');
        d.innerHTML = '<form method="dialog"><div class="ask-msg"></div><div class="dlg-row"><button type="button" class="ask-cancel"></button><button type="submit" class="ask-ok"></button></div></form>';
        var msg = d.querySelector('.ask-msg');
        var title = String(o.title == null ? '' : o.title).trim(), text = String(o.text == null ? '' : o.text).trim();
        // a question written as one sentence ("Void this invoice? It stops being payable."): the
        // question is the title, the rest the words under it, and together they read as before
        var cut = (!field && title && !text) ? title.indexOf('? ') : -1;
        if (cut > 0) { text = title.slice(cut + 2).trim(); title = title.slice(0, cut + 1); }
        if (title) {
          var h = document.createElement('h2'); h.className = 'dlg-t'; h.id = id + 't'; h.textContent = title; msg.appendChild(h);
          d.setAttribute('aria-labelledby', h.id);
        }
        if (text) {
          if (title) msg.appendChild(document.createTextNode(' '));
          var p = document.createElement('p'); p.className = title ? 'dlg-d' : 'dlg-q'; p.id = id + 'd'; p.textContent = text; msg.appendChild(p);
          d.setAttribute(title ? 'aria-describedby' : 'aria-labelledby', p.id);
        }
        var inp = null;
        if (field) {
          var lab = document.createElement('label'); lab.className = 'dlg-l'; lab.htmlFor = id + 'i'; lab.textContent = o.label || title || 'Your answer';
          if (!o.label) lab.className += ' dds-sr-only';
          inp = document.createElement('input'); inp.id = id + 'i'; inp.type = o.password ? 'password' : 'text'; inp.autocomplete = 'off';
          inp.maxLength = o.max || 200; if (o.placeholder) inp.placeholder = o.placeholder; if (o.value != null) inp.value = String(o.value);
          msg.appendChild(lab); msg.appendChild(inp);
        }
        var no = d.querySelector('.ask-cancel'), go = d.querySelector('.ask-ok');
        no.textContent = o.no || 'Cancel'; go.textContent = o.yes || (field ? 'Save' : 'OK');
        var done = false;
        function finish(v) {
          if (done) return; done = true;
          try { d.close(); } catch (_) { /* */ }
          d.remove(); resolve(v);
          if (back && back !== document.body && back.isConnected && back.focus) try { back.focus({ preventScroll: true }); } catch (_) { /* */ }
        }
        no.addEventListener('click', function () { finish(field ? null : false); });
        d.querySelector('form').addEventListener('submit', function (e) {
          e.preventDefault();
          if (!field) { finish(true); return; }
          var v = o.password ? inp.value : inp.value.trim();   // a password is never trimmed
          if (!v && o.required !== false) { inp.focus(); return; }
          finish(v);
        });
        d.addEventListener('cancel', function (e) { e.preventDefault(); finish(field ? null : false); });
        document.body.appendChild(d);
        if (d.showModal) d.showModal(); else d.setAttribute('open', '');
        if (inp) { inp.focus(); try { inp.select(); } catch (_) { /* */ } }
        else (o.danger ? no : go).focus();
      });
    });
  }
  function confirmBox(a, b, c, x) {
    var o = (a && typeof a === 'object') ? a : Object.assign({ title: a, text: b, yes: c }, x || {});
    return dialogBox(o, false);
  }
  function askBox(o) { return dialogBox(o || {}, true); }

  // ── The one money format ────────────────────────────────────────────────────
  //   ddsMoney(cents) → "$1,250", "$1,250.50", "$0", "-$40"
  // Whole dollars show none of the cents; an amount with cents shows both
  // digits ("$1,234.50", never "$1,234.5"); nothing (no amount at all) is ''
  // or opts.none; zero is "$0", never a blank. ddsMoney.dollars(n) takes
  // dollars. opts.cents: true always shows the cents.
  function money(cents, opts) {
    opts = opts || {};
    if (cents === null || cents === undefined || cents === '') return opts.none != null ? opts.none : '';
    var n = Number(cents);
    if (!isFinite(n)) return opts.none != null ? opts.none : '';
    n = Math.round(n);
    var neg = n < 0, abs = Math.abs(n), whole = Math.floor(abs / 100), part = abs % 100;
    var s = '$' + String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (part || opts.cents) s += '.' + (part < 10 ? '0' : '') + part;
    return (neg ? '-' : '') + s;
  }
  money.dollars = function (n, opts) {
    if (n === null || n === undefined || n === '') return money(null, opts);
    var v = Number(n); return money(isFinite(v) ? Math.round(v * 100) : NaN, opts);
  };

  // ── The one date format ─────────────────────────────────────────────────────
  // Every day word is the person's own calendar day, on this device: "today"
  // means the same day on every page (the Inbox and Files counted 24 hours back,
  // the record counted calendar days, so a 10pm enquiry read "today" in one and
  // "yesterday" in the other the next morning). A plain day ("2026-11-16") is
  // that day here, never midnight in London.
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function toDate(x) {
    if (x === null || x === undefined || x === '') return null;
    if (x instanceof Date) return isNaN(x.getTime()) ? null : x;
    if (typeof x === 'number') { var dn = new Date(x); return isNaN(dn.getTime()) ? null : dn; }
    var s = String(x).trim(), m = DAY_RE.exec(s);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var t = Date.parse(s);
    return isFinite(t) ? new Date(t) : null;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(x) { var d = x === undefined ? new Date() : toDate(x); return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) : ''; }
  // whole calendar days from today to x: 0 today, -1 yesterday, 1 tomorrow; null when x isn't a date
  function days(x, now) {
    var d = toDate(x); if (!d) return null;
    var n = now === undefined ? new Date() : toDate(now);
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) / 86400000);
  }
  // "Nov 3", or "Nov 3, 2025" outside this year
  function short(x) {
    var d = toDate(x); if (!d) return '';
    return MON[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : '');
  }
  // "Today", "Yesterday", "Tomorrow", else short()
  function day(x) {
    var n = days(x); if (n === null) return '';
    return n === 0 ? 'Today' : n === -1 ? 'Yesterday' : n === 1 ? 'Tomorrow' : short(x);
  }
  // "3:05 PM"
  function time(x) {
    var d = toDate(x); if (!d) return '';
    var h = d.getHours(), m = d.getMinutes();
    return ((h % 12) || 12) + ':' + pad(m) + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  // How long ago, in days: "today", "yesterday", "3 days ago", "last week",
  // "3 weeks ago", "2 months ago" (the server's own words: crm/contract.ts
  // humanWhen); a day still to come is "soon"
  function ago(x) {
    var n = days(x); if (n === null) return '';
    var d = -n;
    if (d < 0) return 'soon';
    if (d === 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 7) return d + ' days ago';
    if (d < 14) return 'last week';
    if (d < 60) return Math.floor(d / 7) + ' weeks ago';
    return Math.floor(d / 30) + ' months ago';
  }
  // How long ago, to the minute: "just now", "5 min ago", "3 hours ago", then
  // the day words: "yesterday", "3 days ago", then the date
  function since(x) {
    var d = toDate(x); if (!d) return '';
    var s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var n = -days(d);
    if (n <= 1) return 'yesterday';
    if (n < 7) return n + ' days ago';
    return short(d);
  }
  var DATE = { parse: toDate, ymd: ymd, days: days, short: short, day: day, time: time, ago: ago, since: since };

  // ── "Remind them if it isn't paid?" asked once (sales item 166) ─────────────
  // The first send of an invoice with reminders off answers ask_reminders: true. The page
  // calls this; the answer either way is written (invoice_reminders_asked), so it is asked
  // once per studio. `scope` is the page's ?client= business, when it has one.
  //   ddsAskReminders(scope) → Promise<boolean>  (true when reminders were switched on)
  function askReminders(scope) {
    return confirmBox({ title: 'Remind them if it isn’t paid?', text: 'A friendly email a week before the due date, on the due date, and two days after. You can change this any time under Settings, Automations.', yes: 'Yes, remind them', no: 'No thanks' })
      .then(function (yes) {
        var body = yes ? { invoice_reminders: true, invoice_reminders_asked: true } : { invoice_reminders_asked: true };
        return api('/settings', { method: 'PUT', body: body, scope: scope || '' }).then(function (r) {
          if (yes) toast(r.ok ? 'Reminders are on for every unpaid invoice.' : 'Couldn’t switch reminders on just now. Settings, Automations has the switch.', r.ok ? 'ok' : 'err');
          return !!(yes && r.ok);
        }, function () { return false; });
      });
  }
  // ── Builder item 369: the studio's voice ────────────────────────────────────
  //   ddsTheirVoice(text): the app's words to a business owner ("Your website is ready when you
  //   are.") as the studio reads them on that owner's behalf ("Their website is ready when they
  //   are."). Only for the app's own sentences (moments, the publish summary), never for what a
  //   person typed. "you" after a word that takes an object, or with no doing word after it, is
  //   "them"; "you" doing something, after "if", "when" and the like, or opening a sentence, is
  //   "they". "Thank you" stays as it is, and so does anything in quotes: a summary quotes what
  //   someone typed (“Can you deliver?”), and that is theirs.
  var TAKES = 'lets?|let’s|helps?|makes?|gives?|shows?|tells?|asks?|reminds?|sends?|keeps?|finding|find|reach|reaches|for|to|with|from|about|than|of|at|by|on|around';
  var DOES = 'are|were|have|had|can|could|will|would|should|may|might|must|need|want|do|did|don’t|didn’t|haven’t|aren’t|can’t|won’t|get|go|add|open|publish|set|see|know|make|run|use|look|start|keep|choose|pick|write|wrote|press|decide|ask|try|take|already|still|now|just|only|also|[a-z]+ed';
  var LEADS = 'if|when|whenever|once|until|unless|before|after|while|because|whether|though|although|since|so|and|or|but|that|what|where|how';
  function theirVoice(text) {
    return String(text == null ? '' : text).split(/(“[^”]*”|"[^"]*")/).map(function (part, i) { return i % 2 ? part : unquotedVoice(part); }).join('');
  }
  function unquotedVoice(text) {
    var cap = function (w, rep) { return /^[A-Z]/.test(w) ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep; };
    return text
      .replace(/\b(thank[\s-])you\b/gi, '$1\u0000')
      .replace(/\byoursel(?:f|ves)\b/gi, function (w) { return cap(w, 'themselves'); })
      .replace(/\byours\b/gi, function (w) { return cap(w, 'theirs'); })
      .replace(/\byour\b/gi, function (w) { return cap(w, 'their'); })
      .replace(new RegExp('\\b(' + TAKES + ')\\s+you\\b', 'gi'), function (m, w) { return w + ' them'; })
      .replace(/\byou(?=[’'](?:re|ve|ll|d)\b)/gi, function (w) { return cap(w, 'they'); })
      .replace(new RegExp('\\b(' + LEADS + ')\\s+you\\b', 'gi'), function (m, w) { return w + ' they'; })
      .replace(new RegExp('\\byou(?=\\s+(?:' + DOES + ')\\b)', 'gi'), function (w) { return cap(w, 'they'); })
      .replace(/(^|[.!?:]\s+)you\b/gi, function (m, pre) { return pre + 'They'; })
      .replace(/\byou\b/gi, function (w) { return cap(w, 'them'); })
      .replace(/\u0000/g, 'you');
  }
  // ── The website's own menu (builder item 370): one list for every page it opens ──
  // The website page draws it into the sidebar under Website (presence-core.js,
  // mountSiteNav). Its Analytics and Connections are pages of their own, so inside a
  // client those pages draw the same menu there too, their own item lit, instead of
  // the sidebar losing it. Each item is [view, label]; a named group folds.
  var SITE_MENU = [
    [null, [['today', 'Overview'], ['pages', 'Pages'], ['styles', 'Styles'], ['media', 'Files'], ['search', 'Search']]],
    ['Content', [['offerings', 'Menu'], ['faqs', 'Questions'], ['testimonials', 'Testimonials'], ['updates', 'Blog']]],
    [null, [['bookings', 'Bookings'], ['reviews', 'Reviews'], ['analytics', 'Analytics']]],
    ['Site settings', [['business', 'Business details'], ['domain', 'Domain & email'], ['history', 'Versions'], ['connections', 'Connections'], ['sharing', 'Sharing & access'], ['clientview', 'See the client’s view']]]
  ];
  var SITE_PAGES = { analytics: '/analytics.html?view=website', connections: '/connections.html', sharing: '/sharing.html', clientview: '/client.html' };
  // the tabs about the business, not the website: a Designer never sees them (presence-core.js isBusinessTab)
  var BUSINESS_TABS = ['search', 'bookings', 'reviews', 'analytics', 'domain', 'connections', 'clientview'];
  var WATCH_HIDES = ['pages', 'styles', 'bookings', 'reviews', 'history'];
  // the site's own word for its offerings (Menu, Services…), as the website page last said it
  var WORD_KEY = 'dds-offer-word:';
  function offerWord(client, set) {
    try { if (set) { sessionStorage.setItem(WORD_KEY + client, set); return set; } return sessionStorage.getItem(WORD_KEY + client) || 'Services'; } catch (_) { return set || 'Services'; }
  }
  function siteMenuHref(view, client) {
    var page = SITE_PAGES[view] || '/presence.html';
    var q = client ? (page.indexOf('?') >= 0 ? '&' : '?') + 'client=' + encodeURIComponent(client) : '';
    return page + q + (SITE_PAGES[view] || view === 'today' ? '' : '#' + view);
  }
  // Draws the menu under Website in the sidebar, `current` lit, and again after the shell redraws.
  function mountSiteMenu(current) {
    var client = new URLSearchParams(location.search).get('client');
    if (!client) return;   // a client's website menu: studio-level pages keep their own sidebar
    function build() {
      var shell = document.getElementById('dds-shell'); if (!shell) return;
      var it = shell.querySelector('.dds-nav .sec > .it[data-href="/presence.html"]'); if (!it) return;
      var sec = it.parentElement, nav = document.getElementById('siteMenu');
      if (nav && nav.parentElement === sec) return;
      var ctx = window.__ddsContext || {}, feats = ctx.edition_features;
      var off = function (f) { return Array.isArray(feats) && feats.indexOf(f) < 0; };
      // a site hosted elsewhere (the watch plan) has no pages, look or content here: the website page hides them too
      var watch = ctx.edition === 'monitor';
      nav = document.createElement('nav'); nav.id = 'siteMenu'; nav.className = 'menu site-menu'; nav.setAttribute('aria-label', 'Website sections');
      SITE_MENU.forEach(function (g) {
        var host = nav;
        if (watch && g[0] === 'Content') return;
        if (g[0]) {
          var fold = document.createElement('div'); fold.className = 'nav-fold';
          var head = document.createElement('button'); head.type = 'button'; head.className = 'grp'; head.textContent = g[0]; head.setAttribute('aria-expanded', 'false');
          head.addEventListener('click', function () { var o = fold.classList.toggle('open'); head.setAttribute('aria-expanded', String(o)); });
          fold.appendChild(head); nav.appendChild(fold); host = fold;
        }
        g[1].forEach(function (t) {
          if ((t[0] === 'connections' && off('connected')) || (t[0] === 'analytics' && off('reports'))) return;
          if (watch && WATCH_HIDES.indexOf(t[0]) >= 0) return;
          var a = document.createElement('a'); a.className = 'navitem'; a.href = siteMenuHref(t[0], client);
          a.textContent = t[0] === 'offerings' ? offerWord(client) : t[1];
          if (t[0] === 'today') a.setAttribute('data-view', 'today');   // Website itself is the Overview, as on the website page
          if (BUSINESS_TABS.indexOf(t[0]) >= 0) a.setAttribute('data-needs', 'business');
          if (t[0] === 'sharing') a.setAttribute('data-needs', 'owner');
          if (t[0] === current) {
            a.classList.add('on'); a.setAttribute('aria-current', 'page');
            if (host !== nav) { host.classList.add('open'); host.firstChild.setAttribute('aria-expanded', 'true'); }
          }
          host.appendChild(a);
        });
      });
      sec.classList.add('open', 'has-site-menu');
      it.insertAdjacentElement('afterend', nav);
    }
    function startOn(sh) { new MutationObserver(build).observe(sh, { childList: true }); build(); }
    var sh0 = document.getElementById('dds-shell');
    if (sh0) { startOn(sh0); return; }
    var wait = new MutationObserver(function () { var sh = document.getElementById('dds-shell'); if (sh) { wait.disconnect(); startOn(sh); } });
    wait.observe(document.documentElement, { childList: true, subtree: true });
  }
  window.ddsSiteMenu = { groups: SITE_MENU, href: siteMenuHref, mount: mountSiteMenu, word: offerWord };

  window.ddsTheirVoice = theirVoice;
  window.ddsAskReminders = askReminders;
  window.ddsKit = { api: api, toast: toast, confirm: confirmBox, ask: askBox, money: money, date: DATE, askReminders: askReminders, theirVoice: theirVoice };
  window.ddsApi = api;
  window.ddsToast = toast;
  window.ddsConfirm = confirmBox;
  window.ddsAsk = askBox;
  window.ddsMoney = money;
  window.ddsDate = DATE;
})();
