// ── Backup codes for two-step sign-in (builder list item 347, the Nov 22 review) ──
// Ten one-use codes, MADE HERE on the page (crypto.getRandomValues), shown once, and only
// their hashes sent to the server (POST /auth/backup-codes { hashes, salt }). A lost phone
// then has a way in without emailing anyone: on the sign-in page, "Use a backup code"
// (POST /auth/backup-codes/use, public) turns two-step sign-in off for that account, so
// the person signs in with their first step and sets it up again. The owner can also turn
// a client's two-step off from Settings, after a fresh code (routes/backup_codes.ts).
// Loaded by client.html, settings.html, portal.html and studio.html with ?v=347.
//   window.ddsBackup.make()            → { codes: ['ABCD-EFGH', …10], hashes: [64-hex × 10], salt }
//   window.ddsBackup.save(api)         → the page's api(): posts the hashes; answers api's result
//   window.ddsBackup.remaining(api)    → { remaining, total } or null
//   window.ddsBackup.show(codes, o)    → the sheet with the codes, Copy and Print (o.studio names who)
//   window.ddsBackup.useForm(host, o)  → the lost-phone form on a sign-in page (o.fn, o.key, o.email, o.onDone)
(function () {
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I: nothing to mistake when read out
  var COUNT = 10, LEN = 8;
  function hex(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += ('0' + bytes[i].toString(16)).slice(-2); return s; }
  function oneCode() { var b = new Uint8Array(LEN); crypto.getRandomValues(b); var s = ''; for (var i = 0; i < LEN; i++) s += ALPHABET[b[i] % 32]; return s; }   // 32 symbols: byte % 32 is unbiased
  function pretty(c) { return c.slice(0, 4) + '-' + c.slice(4); }
  function plain(c) { return String(c || '').toUpperCase().replace(/[^A-Z2-9]/g, ''); }
  function sha256(text) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) { return hex(new Uint8Array(buf)); }); }
  function make() {
    var salt = new Uint8Array(16); crypto.getRandomValues(salt); var saltHex = hex(salt);
    var codes = []; while (codes.length < COUNT) { var c = oneCode(); if (codes.indexOf(c) < 0) codes.push(c); }
    return Promise.all(codes.map(function (c) { return sha256(saltHex + '|' + c); })).then(function (hashes) {
      return { codes: codes.map(pretty), hashes: hashes, salt: saltHex };
    });
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  var CSS = '.ddsb-d{border:0;border-radius:18px;padding:0;max-width:440px;width:calc(100vw - 32px);background:var(--dds-card,#fff);color:var(--dds-ink,#1b1525);box-shadow:0 18px 50px rgba(27,21,37,.25)}' +
    '.ddsb-d::backdrop{background:rgba(27,21,37,.45)}.ddsb-in{padding:24px}.ddsb-eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--dds-p,#5b3fa0)}' +
    '.ddsb-t{font-size:22px;font-weight:600;margin:6px 0 4px}.ddsb-what{font-size:14px;line-height:1.5;color:var(--dds-soft,#6b6478);margin:0 0 14px}' +
    '.ddsb-codes{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0;padding:0;list-style:none}.ddsb-codes li{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;letter-spacing:.06em;padding:10px 12px;border:1px solid var(--dds-line,#e5e1da);border-radius:10px;text-align:center;background:var(--dds-bg,#faf8f5)}' +
    '.ddsb-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.ddsb-row button{flex:1 1 120px;min-height:44px;padding:10px 16px;border-radius:999px;border:1px solid var(--dds-line,#e5e1da);background:var(--dds-card,#fff);color:var(--dds-ink,#1b1525);font:inherit;font-size:14px;font-weight:600;cursor:pointer}' +
    '.ddsb-row button.main{background:var(--dds-p,#5b3fa0);color:#fff;border-color:transparent}.ddsb-foot{font-size:12.5px;color:var(--dds-soft,#6b6478);margin:14px 0 0;line-height:1.5}' +
    '.ddsb-form{display:grid;gap:10px;margin-top:10px}.ddsb-form label{font-size:13px;font-weight:600}.ddsb-form input{width:100%;box-sizing:border-box;min-height:44px;font:inherit;font-size:15px;padding:10px 12px;border:1px solid var(--dds-line,#e5e1da);border-radius:10px;background:var(--dds-card,#fff);color:var(--dds-ink,#1b1525)}' +
    '.ddsb-form button{min-height:44px;border-radius:999px;border:0;background:var(--dds-p,#5b3fa0);color:#fff;font:inherit;font-size:15px;font-weight:600;padding:10px 18px;cursor:pointer}.ddsb-form button:disabled{opacity:.6}.ddsb-err{color:#9f3a2f;font-size:13.5px;margin:0}' +
    '@media print{body>*{display:none!important}.ddsb-print{display:block!important;font:16px/1.6 ui-monospace,Menlo,monospace;padding:24px}}';
  function style() { if (document.getElementById('ddsb-css')) return; var s = el('style'); s.id = 'ddsb-css'; s.textContent = CSS; document.head.appendChild(s); }
  /** The sheet with the ten codes, shown once. Answers when it closes. */
  function show(codes, o) {
    o = o || {}; style();
    return new Promise(function (resolve) {
      var d = el('dialog', 'ddsb-d'); d.setAttribute('aria-labelledby', 'ddsb-title');
      var inn = el('div', 'ddsb-in'); d.appendChild(inn);
      inn.appendChild(el('div', 'ddsb-eyebrow', 'Backup codes'));
      var t = el('h2', 'ddsb-t', 'Keep these somewhere safe.'); t.id = 'ddsb-title'; inn.appendChild(t);
      inn.appendChild(el('p', 'ddsb-what', 'Each code works once, if you ever lose your phone. This is the only time they are shown; making new ones replaces these.'));
      var ul = el('ul', 'ddsb-codes'); codes.forEach(function (c) { ul.appendChild(el('li', '', c)); }); inn.appendChild(ul);
      var row = el('div', 'ddsb-row');
      var copy = el('button', 'main', 'Copy'); copy.type = 'button';
      var print = el('button', '', 'Print'); print.type = 'button';
      var done = el('button', '', 'Done'); done.type = 'button';
      row.appendChild(copy); row.appendChild(print); row.appendChild(done); inn.appendChild(row);
      inn.appendChild(el('p', 'ddsb-foot', (o.studio ? o.studio : 'Your account') + ' never sees these codes, only a scrambled copy. Used one up? Make a new set from your account.'));
      copy.addEventListener('click', function () {
        var text = codes.join('\n');
        var fallback = function () { var ta = el('textarea'); ta.value = text; inn.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (_) { /* nothing */ } ta.remove(); copy.textContent = 'Copied'; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { copy.textContent = 'Copied'; }, fallback); else fallback();
      });
      print.addEventListener('click', function () {
        var pr = el('div', 'ddsb-print'); pr.style.display = 'none';
        pr.textContent = 'Backup codes for two-step sign-in' + (o.studio ? ' (' + o.studio + ')' : '') + '\n\n' + codes.join('\n') + '\n\nEach code works once.';
        document.body.appendChild(pr); window.print(); setTimeout(function () { pr.remove(); }, 500);
      });
      var close = function () { try { d.close(); } catch (_) { /* closed */ } d.remove(); resolve(true); };
      done.addEventListener('click', close);
      d.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
      document.body.appendChild(d);
      if (d.showModal) d.showModal(); else d.setAttribute('open', '');
      copy.focus();
    });
  }
  /** Make a set and send its hashes with the page's api(path, method, body). */
  function save(api) {
    return make().then(function (set) {
      return Promise.resolve(api('/auth/backup-codes', 'POST', { hashes: set.hashes, salt: set.salt })).then(function (r) { return { r: r, codes: set.codes }; });
    });
  }
  function remaining(api) {
    return Promise.resolve(api('/auth/backup-codes', 'GET')).then(function (r) { return r && r.ok && r.body && r.body.data ? r.body.data : null; }).catch(function () { return null; });
  }
  /** The lost-phone form on a sign-in page: email + code → two-step sign-in off for that account. */
  function useForm(host, o) {
    o = o || {}; style();
    host.textContent = '';
    var f = el('form', 'ddsb-form'); f.noValidate = true;
    var l1 = el('label', '', 'Your email'); l1.htmlFor = 'ddsb-email'; var em = el('input'); em.id = 'ddsb-email'; em.type = 'email'; em.autocomplete = 'email'; em.value = o.email || '';
    var l2 = el('label', '', 'One backup code'); l2.htmlFor = 'ddsb-code'; var cd = el('input'); cd.id = 'ddsb-code'; cd.type = 'text'; cd.autocomplete = 'one-time-code'; cd.placeholder = 'XXXX-XXXX'; cd.setAttribute('inputmode', 'latin'); cd.spellcheck = false;
    var go = el('button', '', 'Use this code'); go.type = 'submit';
    var err = el('p', 'ddsb-err', ''); err.setAttribute('role', 'alert');
    var foot = el('p', 'ddsb-foot', 'This turns two-step sign-in off for your account, so you can sign in with your first step and set it up again. ' + (o.studio ? 'No codes left? Ask ' + o.studio + '.' : ''));
    f.appendChild(l1); f.appendChild(em); f.appendChild(l2); f.appendChild(cd); f.appendChild(go); f.appendChild(err); f.appendChild(foot); host.appendChild(f);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      var email = em.value.trim().toLowerCase(), code = plain(cd.value);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Type the email you sign in with.'; em.focus(); return; }
      if (code.length !== LEN) { err.textContent = 'A backup code is eight letters and numbers, like ABCD-EFGH.'; cd.focus(); return; }
      go.disabled = true;
      fetch(o.fn + '/presence/auth/backup-codes/use', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: o.key, Authorization: 'Bearer ' + o.key }, body: JSON.stringify({ email: email, code: code }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { status: r.status, ok: r.ok, body: b }; }); })
        .then(function (r) {
          go.disabled = false;
          if (r.ok && r.body && r.body.ok) { if (o.onDone) o.onDone(r.body); return; }
          if (r.status === 429) { err.textContent = 'Too many tries. Wait a quarter of an hour and try again.'; return; }
          if (r.status === 503) { err.textContent = 'Backup codes aren’t switched on here yet. ' + (o.studio ? 'Ask ' + o.studio + '.' : ''); return; }
          err.textContent = (r.body && r.body.message) || 'That didn’t work. Check the email address and the code, and try again.';
        })
        .catch(function () { go.disabled = false; err.textContent = 'Couldn’t reach the server just now. Check your connection and try again.'; });
    });
    (o.email ? cd : em).focus();
    return f;
  }
  window.ddsBackup = { make: make, save: save, remaining: remaining, show: show, useForm: useForm, plain: plain };
})();
