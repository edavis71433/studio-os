// ── Two-step sign-in and fresh codes (builder list item 191) ──────────────────
// Drawn in Figma first: page "Two-step sign-in and fresh codes — item 191".
//
// A fresh code before the risky things (section C). Inviting a co-owner (or making
// someone one), handing a site to someone else, removing a domain and closing the
// account ask for a fresh code first. The server answers the first try with 403
// fresh_code_needed and says how the code comes: from the person's authenticator app,
// or by email (it has just been sent). This sheet asks for the six digits, sends the
// same request again with them (fresh_code in its body), and keeps the server's words
// when a code is wrong, has run out, or has had too many tries. Someone with two-step
// sign-in on types the code from their app instead: this sheet has Supabase check it with
// the page's own sign-in, then sends the sign-in that came back (fresh_jwt), which says the
// code was just typed. (The server never checks app codes itself: Supabase turns over the
// sign-in a check is made with.)
//
//   window.ddsFresh.run(send, { sb }): send(extra) makes the page's own request with `extra`
//   merged into its body and answers { ok, status, body }; sb is the page's Supabase client.
//   run() answers the final { ok, status, body }, or { ok: false, status: 0, cancelled: true,
//   body: {} } when they cancel.
//
// Two-step sign-in itself (sections A and B) is Supabase's own app codes (TOTP): free,
// and already on for the project. The pages use these pieces:
//   boxes(o)                the six code boxes over one input (A, B, C share them)
//   stepDue(sb)             after signing in: does this device still need the app's code?
//   verifyApp(sb, id, code) checks a code; on success the sign-in is complete (aal2)
//   status(sb)              Settings: is it on, and since when
//   turnOn(sb, o)           the set-up sheet: QR square, key, first code
//   turnOff(sb, factor, o)  asks for a code from the app, then turns it off
(function () {
  'use strict';
  if (window.ddsFresh) return;
  // the first answers that open the sheet, and the later ones that keep it open
  var OPEN = { fresh_code_needed: 1, fresh_code_expired: 1, fresh_code_sends: 1 };
  var KEEP = { fresh_code_wrong: 1, fresh_code_tries: 1, fresh_code_sends: 1, fresh_code_unavailable: 1, fresh_code_not_sent: 1, fresh_code_expired: 1, fresh_code_needed: 1 };
  var EYEBROW = { invite_coowner: 'Before this invite goes', transfer: 'Before this handover', domain_remove: 'Before this domain is removed', close_account: 'Before your account closes' };
  var FOOT = {
    invite_coowner: 'The site’s owner gets an email about this either way.',
    transfer: 'The site’s owner gets an email about this either way.',
    domain_remove: 'The site’s owner and your studio get an email about this.',
    close_account: '',
  };
  var NET = 'That didn’t go through. Check your connection and try again.';
  var SHIELD = '<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" focusable="false"><path d="M12 2.5 4.5 5.5v6c0 4.6 3.1 8.6 7.5 10 4.4-1.4 7.5-5.4 7.5-10v-6L12 2.5Z" fill="none" stroke="#b79ceb" stroke-width="1.6" stroke-linejoin="round"/><rect x="8.6" y="10.6" width="6.8" height="5.4" rx="1.2" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M10 10.6V9.2a2 2 0 0 1 4 0v1.4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>';

  function style() {
    if (document.getElementById('ddsf-style')) return;
    var st = document.createElement('style'); st.id = 'ddsf-style';
    st.textContent =
      '.ddsf{border:0;padding:0;margin:auto;width:min(520px,calc(100% - 32px));max-height:calc(100% - 32px);border-radius:20px;overflow:auto;background:var(--dds-card,#faf8f5);color:var(--dds-ink,#1f1a2b);box-shadow:0 24px 48px rgba(23,18,41,.22);font-family:var(--dds-sans,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif)}' +
      '.ddsf::backdrop{background:rgba(23,21,34,.55)}' +
      '.ddsf-band{display:flex;gap:16px;align-items:flex-start;padding:26px 28px;background:#241d38;color:#fff}' +
      '.ddsf-band svg{flex:0 0 auto;margin-top:2px}' +
      '.ddsf-eye{margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:#b79ceb}' +
      '.ddsf h2{margin:0;font-family:var(--dds-serif,Fraunces,Georgia,serif);font-weight:300;font-size:30px;line-height:1.15;color:#fff}' +
      '.ddsf-what{margin:8px 0 0;font-size:14px;line-height:1.45;color:#d9cdeb;overflow-wrap:anywhere}' +
      '.ddsf-body{padding:24px 28px 26px}' +
      '.ddsf-how{margin:0 0 16px;font-size:15px;line-height:1.45}' +
      '.ddsf-code{position:relative;width:100%;max-width:362px}' +
      '.ddsf-code input{position:absolute;inset:0;width:100%;height:100%;opacity:0;border:0;padding:0;margin:0;font-size:16px;cursor:text}' +
      '.ddsf-boxes{display:flex;gap:10px}' +
      '.ddsf-boxes span{display:grid;place-items:center;flex:1 1 0;min-width:0;max-width:52px;height:60px;border-radius:12px;background:var(--dds-bg-raised,#fff);border:1px solid var(--dds-line-strong,#e4ddd1);font-size:24px;font-weight:600;color:var(--dds-ink,#1f1a2b)}' +
      '.ddsf-code.on .ddsf-boxes span.at{border:2px solid var(--dds-p,#5b3fa0);box-shadow:0 0 0 3px var(--dds-p-soft,#ece6f7)}' +
      '.ddsf-code.bad .ddsf-boxes span{border-color:var(--dds-bad,#b42318)}' +
      '.ddsf-err{min-height:1.4em;margin:10px 0 0;font-size:13.5px;font-weight:600;color:var(--dds-bad,#b42318)}' +
      '.ddsf-err:empty{min-height:0;margin:0}' +
      '.ddsf-go{display:block;width:100%;min-height:48px;margin:16px 0 0;padding:12px 20px;border:0;border-radius:999px;background:var(--dds-p,#5b3fa0);color:var(--dds-on-p,#fff);font:inherit;font-size:15px;font-weight:600;cursor:pointer}' +
      '.ddsf-go:disabled{opacity:.6;cursor:default}' +
      '.ddsf-more{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;margin:14px 0 0}' +
      '.ddsf-more button{min-height:44px;padding:0;border:0;background:none;font:inherit;font-size:14px;font-weight:600;cursor:pointer;color:var(--dds-p,#5b3fa0)}' +
      '.ddsf-more button.ddsf-x{color:var(--dds-soft,#6b6478)}' +
      '.ddsf-more button:focus-visible,.ddsf-go:focus-visible,.ddss-copy:focus-visible,.ddss-here:focus-visible{outline:2px solid var(--dds-p,#5b3fa0);outline-offset:2px}' +
      '.ddsf-foot{margin:6px 0 0;font-size:13px;line-height:1.45;color:var(--dds-soft,#6b6478)}' +
      '.ddsf-foot:empty{display:none}' +
      '.ddsf-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
      // B2, the set-up sheet: three numbered steps, the square and its key
      '.ddss .ddsf-band{display:block}' +
      '.ddss-steps{list-style:none;margin:0;padding:0;counter-reset:ddss}' +
      '.ddss-steps>li{position:relative;padding:0 0 22px 40px;counter-increment:ddss}' +
      '.ddss-steps>li::before{content:counter(ddss);position:absolute;left:0;top:0;display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--dds-p,#5b3fa0);color:#fff;font-size:13px;font-weight:700}' +
      '.ddss-steps b{display:block;font-size:15px;line-height:1.45}' +
      '.ddss-steps>li>span{display:block;margin-top:4px;font-size:13.5px;line-height:1.45;color:var(--dds-soft,#6b6478)}' +
      '.ddss-scan{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;margin-top:12px}' +
      '.ddss-qr{display:grid;place-items:center;width:156px;height:156px;padding:8px;border-radius:12px;background:#fff;border:1px solid var(--dds-line-strong,#e4ddd1)}' +
      '.ddss-qr img{display:block;width:140px;height:140px}' +
      '.ddss-qr p{margin:0;padding:0 8px;font-size:12.5px;text-align:center;color:var(--dds-soft,#6b6478)}' +
      '.ddss-key{flex:1;min-width:180px;font-size:13px;line-height:1.45;color:var(--dds-soft,#6b6478)}' +
      '.ddss-key b{font-size:13.5px;color:var(--dds-ink,#1f1a2b)}' +
      '.ddss-key code{display:inline-block;margin:8px 0 4px;padding:8px 12px;border-radius:10px;background:#fff;border:1px solid var(--dds-line-strong,#e4ddd1);font:600 14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:var(--dds-ink,#1f1a2b);overflow-wrap:anywhere;user-select:all}' +
      '.ddss-copy,.ddss-here{display:inline-flex;align-items:center;min-height:44px;padding:0;border:0;background:none;font:inherit;font-size:13.5px;font-weight:600;color:var(--dds-p,#5b3fa0);cursor:pointer;text-decoration:none}' +
      '.ddss-here{margin-left:14px}' +
      '.ddss-copy[hidden],.ddss-here[hidden]{display:none}' +
      '.ddss-steps .ddsf-code{margin-top:12px}' +
      '@media (max-width:420px){.ddsf-band{padding:22px 20px}.ddsf-body{padding:20px}.ddsf h2{font-size:26px}.ddsf-boxes{gap:7px}.ddsf-boxes span{height:54px;font-size:22px}.ddss-steps>li{padding-left:36px}.ddss-here{margin-left:0}}';
    document.head.appendChild(st);
  }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  /** The six boxes over one hidden input. o: { id, label, describedBy, onFull(code), onEnter() }.
   *  Answers { el, err, input, value(), clear(), fault(msg), focus() }; the page places el and err. */
  function boxes(o) {
    style();
    o = o || {};
    var id = o.id || 'ddsf-in';
    var code = el('div', 'ddsf-code');
    var lab = el('label', 'ddsf-sr', o.label || '6-digit code'); lab.setAttribute('for', id); code.appendChild(lab);
    var row = el('div', 'ddsf-boxes'); row.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 6; i++) row.appendChild(el('span'));
    code.appendChild(row);
    var input = el('input'); input.id = id; input.type = 'text'; input.inputMode = 'numeric'; input.autocomplete = 'one-time-code'; input.maxLength = 6; input.setAttribute('pattern', '[0-9]*');
    var err = el('p', 'ddsf-err'); err.id = id + '-err'; err.setAttribute('role', 'alert');
    input.setAttribute('aria-describedby', ((o.describedBy || '') + ' ' + err.id).trim());
    code.appendChild(input);
    function paint() {
      var v = input.value, spans = row.children;
      for (var j = 0; j < 6; j++) { spans[j].textContent = v[j] || ''; spans[j].classList.toggle('at', j === Math.min(v.length, 5)); }
    }
    function fault(msg) { err.textContent = msg || ''; code.classList.toggle('bad', !!msg); }
    input.addEventListener('input', function () {
      var v = input.value.replace(/\D/g, '').slice(0, 6);
      if (v !== input.value) input.value = v;
      paint(); if (err.textContent) fault('');
      if (v.length === 6 && o.onFull) o.onFull(v);
    });
    input.addEventListener('focus', function () { code.classList.add('on'); paint(); });
    input.addEventListener('blur', function () { code.classList.remove('on'); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (o.onEnter) o.onEnter(); } });
    paint();
    return {
      el: code, err: err, input: input, fault: fault,
      value: function () { return input.value.replace(/\D/g, ''); },
      clear: function () { input.value = ''; paint(); },
      focus: function () { try { input.focus(); } catch (_) { /* gone */ } },
    };
  }

  // a dialog in the house look: the plum band (eyebrow, title, line) over a cream body
  function sheet(o) {
    style();
    var d = el('dialog', 'ddsf' + (o.cls ? ' ' + o.cls : '')); d.id = o.id; d.setAttribute('aria-labelledby', o.id + '-h');
    var band = el('div', 'ddsf-band'); if (o.shield) band.innerHTML = SHIELD;
    var words = el('div');
    words.appendChild(el('p', 'ddsf-eye', o.eyebrow));
    var h = el('h2', null, o.title); h.id = o.id + '-h'; h.tabIndex = -1; words.appendChild(h);
    var what = el('p', 'ddsf-what', o.what || ''); what.id = o.id + '-what'; words.appendChild(what);
    band.appendChild(words); d.appendChild(band);
    var body = el('div', 'ddsf-body'); d.appendChild(body);
    d.setAttribute('aria-describedby', what.id);
    return { d: d, body: body, what: what };
  }

  function ask(first, send, o) {
    o = o || {};
    return new Promise(function (resolve) {
      var opener = document.activeElement;
      var s = sheet({ id: 'dds-fresh', shield: true, eyebrow: EYEBROW[first.action] || 'Before this goes ahead', title: 'Confirm it’s you.', what: first.what || '' });
      var d = s.d, body = s.body;
      d.setAttribute('aria-describedby', 'dds-fresh-what ddsf-how');
      var how = el('p', 'ddsf-how'); how.id = 'ddsf-how'; body.appendChild(how);
      var box = boxes({ id: 'ddsf-in', describedBy: 'ddsf-how', onFull: function () { submit(); }, onEnter: function () { submit(); } });
      body.appendChild(box.el); body.appendChild(box.err);
      var go = el('button', 'ddsf-go', first.go || 'Confirm'); go.type = 'button'; body.appendChild(go);
      var more = el('div', 'ddsf-more');
      var again = el('button', 'ddsf-again', 'Send a new code'); again.type = 'button';
      var cancel = el('button', 'ddsf-x', 'Cancel'); cancel.type = 'button';
      more.appendChild(again); more.appendChild(cancel); body.appendChild(more);
      var foot = el('p', 'ddsf-foot'); body.appendChild(foot);
      document.body.appendChild(d);

      var way = first.way === 'app' ? 'app' : 'email', done = false, busy = false, factorId = first.factor_id ? String(first.factor_id) : '';
      function sayHow(b) {
        way = b && (b.way === 'app' || b.way === 'email') ? b.way : way;
        if (b && b.factor_id) factorId = String(b.factor_id);
        how.textContent = way === 'app' ? 'Type the 6-digit code from your authenticator app.' : (b && b.error !== 'fresh_code_sends' && b.message) || 'We emailed you a 6-digit code. It works for 10 minutes.';
        again.hidden = way === 'app';
        foot.textContent = way === 'app' ? 'You have two-step sign-in on, so the code comes from your phone, not your email.' : (FOOT[first.action] || '');
      }
      function finish(result) {
        if (done) return; done = true;
        try { d.close(); } catch (_) { /* already closed */ }
        d.remove();
        if (opener && opener.focus && document.contains(opener)) { try { opener.focus(); } catch (_) { /* gone */ } }
        resolve(result);
      }
      // the factor to check an app code against: the server names it, else the person's own list
      function appFactorId() {
        if (factorId || !o.sb) return Promise.resolve(factorId);
        return Promise.resolve(o.sb.auth.mfa.listFactors()).then(function (f) { var t = (f && f.data && f.data.totp) || []; factorId = t[0] ? String(t[0].id) : ''; return factorId; }, function () { return ''; });
      }
      // the app way: Supabase checks the code with the page's sign-in, then the request goes
      // again with the sign-in that came back; { ok: false, message } when it didn't check out
      function viaApp(c) {
        if (!o.sb || !o.sb.auth || !o.sb.auth.mfa) return Promise.resolve({ fault: 'Refresh this page, then try again.' });
        return appFactorId().then(function (id) {
          if (!id) return { fault: 'Refresh this page, then try again.' };
          return verifyApp(o.sb, id, c).then(function (v) {
            if (v.gone) return send({});   // it was turned off: the server asks the email way instead
            if (!v.ok) return { fault: v.message };
            return Promise.resolve(o.sb.auth.getSession()).then(function (s) {
              var t = s && s.data && s.data.session && s.data.session.access_token;
              return send({ fresh_jwt: t || '' });
            }).then(function (r) {
              var b = (r && r.body) || {};
              if (r && !r.ok && b.error === 'fresh_code_needed' && b.way === 'app') return { fault: 'Your code checked out, but it didn’t reach us in time. Type the newest one.' };
              return r;
            });
          });
        });
      }
      function submit() {
        if (busy) return;
        var c = box.value();
        if (c.length !== 6) { box.fault('Type all six digits.'); box.focus(); return; }
        busy = true; go.disabled = true; var label = go.textContent; go.textContent = 'Checking…'; box.fault('');
        Promise.resolve(way === 'app' ? viaApp(c) : send({ fresh_code: c })).then(function (r) {
          busy = false; go.disabled = false; go.textContent = label;
          if (r && r.fault) { box.fault(r.fault); box.clear(); box.focus(); return; }
          var b = (r && r.body) || {};
          if (r && r.ok) return finish(r);
          if (KEEP[b.error]) {
            if (b.error === 'fresh_code_expired' || b.error === 'fresh_code_needed') sayHow(b);
            box.fault(b.message || 'That code isn’t right.');
            box.clear(); box.focus();
            return;
          }
          finish(r);   // anything else is the page's own answer to show (a refusal, a fault)
        }, function () {
          busy = false; go.disabled = false; go.textContent = label;
          box.fault(NET);
        });
      }
      go.addEventListener('click', submit);
      cancel.addEventListener('click', function () { finish({ ok: false, status: 0, cancelled: true, body: {} }); });
      d.addEventListener('cancel', function (e) { e.preventDefault(); finish({ ok: false, status: 0, cancelled: true, body: {} }); });
      again.addEventListener('click', function () {
        if (busy) return;
        busy = true; again.disabled = true; box.fault('');
        Promise.resolve(send({})).then(function (r) {
          busy = false; again.disabled = false;
          var b = (r && r.body) || {};
          if (r && r.ok) return finish(r);   // nothing was asked after all
          if (b.error === 'fresh_code_needed' || b.error === 'fresh_code_expired') { sayHow(b); how.textContent = b.message ? b.message.replace(/^We emailed a /, 'We emailed a new ') : how.textContent; box.clear(); box.focus(); return; }
          box.fault(b.message || 'We couldn’t send a new code just now.');
        }, function () { busy = false; again.disabled = false; box.fault('We couldn’t send a new code just now.'); });
      });

      sayHow(first);
      if (first.error === 'fresh_code_sends' || first.error === 'fresh_code_expired') box.fault(first.error === 'fresh_code_sends' ? first.message : '');
      d.showModal();
      box.focus();
    });
  }

  // ── Two-step sign-in (sections A and B) ─────────────────────────────────────
  // Supabase's words for a refused code, in ours. A wrong code is 422
  // mfa_verification_failed; a challenge that ran out, mfa_challenge_expired.
  function codeTrouble(error) {
    var m = String((error && error.message) || ''), c = String((error && error.code) || ''), st = error && error.status;
    if (st === 429 || /rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute, then type the newest code.';
    if (c === 'mfa_verification_failed' || c === 'mfa_challenge_expired' || st === 422 || /invalid|expired|incorrect/i.test(m)) return 'That code isn’t right. The app shows a new one every 30 seconds, so type the one showing now.';
    return NET;
  }

  function claim(jwt, name) {
    try { return JSON.parse(atob(String(jwt).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))[name]; } catch (_) { return undefined; }
  }
  /** Signed in with a password or an emailed link: does this device still need the app's
   *  code? The sign-in kept on this device says (a fresh sign-in carries the person's
   *  factors), with no call; o.ask asks the server instead, for when the server refused a
   *  sign-in that looked complete (a phone set up, or taken off, on another device).
   *  Answers { due: true, factor } · { due: false } · { gone: true } (the sign-in itself
   *  is no longer good) · { due: false, unknown: true } (couldn't tell; the page carries on). */
  function stepDue(sb, o) {
    if (!sb || !sb.auth || !sb.auth.mfa) return Promise.resolve({ due: false, unknown: true });
    return Promise.resolve(sb.auth.getSession()).then(function (s) {
      var sess = s && s.data && s.data.session;
      if (!sess || !sess.access_token) return { due: false };
      if (claim(sess.access_token, 'aal') === 'aal2') return { due: false };
      if (!(o && o.ask)) {
        var mine = ((sess.user && sess.user.factors) || []).filter(function (x) { return x && x.factor_type === 'totp' && x.status === 'verified'; });
        return mine.length ? { due: true, factor: mine[0] } : { due: false };
      }
      return Promise.resolve(sb.auth.mfa.listFactors()).then(function (f) {
        if (f && f.error) { var st = f.error.status; return (st === 401 || st === 403) ? { gone: true } : { due: false, unknown: true }; }
        var on = (f && f.data && f.data.totp) || [];   // verified app factors only
        if (on.length) return { due: true, factor: on[0] };
        // the copy kept here may still list a phone taken off elsewhere: refresh it, so the
        // studio's pages stop sending them back to the code step
        return Promise.resolve(sb.auth.refreshSession()).then(function () { return { due: false }; }, function () { return { due: false }; });
      });
    }).catch(function () { return { due: false, unknown: true }; });
  }

  /** Check six digits against the person's app. { ok: true } completes the sign-in (aal2);
   *  { ok: false, message } says why not, in plain words; gone: the app was taken off this
   *  sign-in on another device (the page refreshes the sign-in and looks again). */
  function verifyApp(sb, factorId, code) {
    return Promise.resolve(sb.auth.mfa.challengeAndVerify({ factorId: factorId, code: code })).then(function (r) {
      if (r && !r.error) return { ok: true };
      var e = (r && r.error) || {};
      if (e.status === 404 || e.code === 'mfa_factor_not_found') return { ok: false, gone: true, message: 'Two-step sign-in was turned off for this account. Sign in again.' };
      return { ok: false, message: codeTrouble(e) };
    }, function () { return { ok: false, message: NET }; });
  }

  /** Settings: { read: true, on, factor, since } for the signed-in person, or { read: false }. */
  function status(sb) {
    if (!sb || !sb.auth || !sb.auth.mfa) return Promise.resolve({ read: false });
    return Promise.resolve(sb.auth.mfa.listFactors()).then(function (f) {
      if (!f || f.error || !f.data) return { read: false };
      var on = f.data.totp || [];
      var factor = on[0] || null;
      return { read: true, on: !!factor, factor: factor, since: factor ? (factor.updated_at || factor.created_at || '') : '' };
    }, function () { return { read: false }; });
  }

  // "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP", easier to type into an app by hand
  function grouped(key) { return String(key || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim(); }

  /** B2: the set-up sheet. o.issuer names the account in the app (default "Studio OS").
   *  Answers { on: true } once the first code checked out, { cancelled: true } otherwise. */
  function turnOn(sb, o) {
    o = o || {};
    return new Promise(function (resolve) {
      var opener = document.activeElement;
      var s = sheet({ id: 'dds-2step', cls: 'ddss', eyebrow: 'Sign-in and security', title: 'Turn on two-step sign-in', what: 'Three steps, about a minute. Keep this open while you use your phone.' });
      var d = s.d, body = s.body;
      var steps = el('ol', 'ddss-steps');
      var s1 = el('li'); s1.appendChild(el('b', null, 'Get an authenticator app on your phone'));
      s1.appendChild(el('span', null, 'Any app that shows 6-digit codes: Google Authenticator, Microsoft Authenticator, 1Password or Authy.'));
      var s2 = el('li'); s2.appendChild(el('b', null, 'Scan this square with the app'));
      var scan = el('div', 'ddss-scan');
      var qr = el('div', 'ddss-qr'); qr.appendChild(el('p', null, 'Getting your square…'));
      var keyBox = el('div', 'ddss-key'); keyBox.hidden = true;
      keyBox.appendChild(el('b', null, 'Can’t scan it?')); keyBox.appendChild(el('br'));
      keyBox.appendChild(document.createTextNode('Type this key into the app instead:')); keyBox.appendChild(el('br'));
      var key = el('code'); key.id = 'dds-2step-key'; keyBox.appendChild(key); keyBox.appendChild(el('br'));
      var copy = el('button', 'ddss-copy', 'Copy key'); copy.type = 'button'; keyBox.appendChild(copy);
      var here = el('a', 'ddss-here', 'On this phone? Add it to your app'); here.hidden = true; keyBox.appendChild(here);
      scan.appendChild(qr); scan.appendChild(keyBox); s2.appendChild(scan);
      var s3 = el('li'); var s3h = el('b', null, 'Type the 6-digit code the app shows'); s3h.id = 'dds-2step-how'; s3.appendChild(s3h);
      var box = boxes({ id: 'dds-2step-in', describedBy: 'dds-2step-how', onFull: function () { submit(); }, onEnter: function () { submit(); } });
      s3.appendChild(box.el); s3.appendChild(box.err);
      steps.appendChild(s1); steps.appendChild(s2); steps.appendChild(s3); body.appendChild(steps);
      var go = el('button', 'ddsf-go', 'Turn on two-step sign-in'); go.type = 'button'; go.disabled = true; body.appendChild(go);
      var more = el('div', 'ddsf-more'); var cancel = el('button', 'ddsf-x', 'Cancel'); cancel.type = 'button'; more.appendChild(cancel); body.appendChild(more);
      body.appendChild(el('p', 'ddsf-foot', 'When it’s on, any other device signed in as you is signed out, and signs in again with a code.'));
      document.body.appendChild(d);

      var factorId = '', secret = '', done = false, busy = false;
      function finish(result) {
        if (done) return; done = true;
        try { d.close(); } catch (_) { /* already closed */ }
        d.remove();
        // a set-up left half way is taken off again, so the next try starts clean
        if (!result.on && factorId) Promise.resolve(sb.auth.mfa.unenroll({ factorId: factorId })).catch(function () {});
        if (opener && opener.focus && document.contains(opener)) { try { opener.focus(); } catch (_) { /* gone */ } }
        resolve(result);
      }
      function submit() {
        if (busy || !factorId) return;
        var c = box.value();
        if (c.length !== 6) { box.fault('Type all six digits.'); box.focus(); return; }
        busy = true; go.disabled = true; go.textContent = 'Checking…'; box.fault('');
        verifyApp(sb, factorId, c).then(function (r) {
          busy = false; go.disabled = false; go.textContent = 'Turn on two-step sign-in';
          if (r.ok) return finish({ on: true });
          box.fault(r.message); box.clear(); box.focus();
        });
      }
      go.addEventListener('click', submit);
      cancel.addEventListener('click', function () { finish({ cancelled: true }); });
      d.addEventListener('cancel', function (e) { e.preventDefault(); finish({ cancelled: true }); });
      copy.addEventListener('click', function () {
        var said = function (w) { copy.textContent = w; setTimeout(function () { copy.textContent = 'Copy key'; }, 2400); };
        try { navigator.clipboard.writeText(secret).then(function () { said('Copied'); }, function () { said('Select the key to copy it'); }); } catch (_) { said('Select the key to copy it'); }
      });
      d.showModal();
      try { s.d.querySelector('h2').focus(); } catch (_) { /* */ }

      // a set-up someone started and left is taken off first: an app factor waiting for its first code
      Promise.resolve(sb.auth.mfa.listFactors()).then(function (f) {
        var left = ((f && f.data && f.data.all) || []).filter(function (x) { return x && x.factor_type === 'totp' && x.status !== 'verified'; });
        return Promise.all(left.map(function (x) { return Promise.resolve(sb.auth.mfa.unenroll({ factorId: x.id })).catch(function () {}); }));
      }).catch(function () {}).then(function () {
        return sb.auth.mfa.enroll({ factorType: 'totp', issuer: o.issuer || 'Studio OS' });
      }).then(function (r) {
        if (done) { if (r && r.data && r.data.id) Promise.resolve(sb.auth.mfa.unenroll({ factorId: r.data.id })).catch(function () {}); return; }
        var t = r && !r.error && r.data && r.data.totp;
        if (!t || !r.data.id) { qr.innerHTML = ''; qr.appendChild(el('p', null, 'We couldn’t start this just now.')); box.fault('Close this and try again in a moment. Nothing has changed.'); return; }
        factorId = r.data.id; secret = String(t.secret || '');
        qr.innerHTML = '';
        var img = el('img'); img.alt = 'A square code to scan with your authenticator app'; img.src = String(t.qr_code || ''); img.width = 140; img.height = 140; qr.appendChild(img);
        key.textContent = grouped(secret); keyBox.hidden = false;
        if (t.uri && window.matchMedia && window.matchMedia('(pointer:coarse)').matches) { here.href = String(t.uri); here.hidden = false; }
        go.disabled = false;
        box.focus();
      }, function () {
        if (done) return;
        qr.innerHTML = ''; qr.appendChild(el('p', null, 'We couldn’t start this just now.')); box.fault(NET);
      });
    });
  }

  /** B3's Turn off: a code from the app first, then the app is taken off this sign-in.
   *  o.lost: the line for someone who no longer has the phone. Answers { off: true } or { cancelled: true }. */
  function turnOff(sb, factor, o) {
    o = o || {};
    return new Promise(function (resolve) {
      var opener = document.activeElement;
      var s = sheet({ id: 'dds-2step-off', shield: true, eyebrow: 'Before two-step sign-in goes off', title: 'Confirm it’s you.', what: 'With it off, your password alone gets into your account again.' });
      var d = s.d, body = s.body;
      var how = el('p', 'ddsf-how', 'Type the 6-digit code from your authenticator app.'); how.id = 'dds-2step-off-how'; body.appendChild(how);
      var box = boxes({ id: 'dds-2step-off-in', describedBy: 'dds-2step-off-how', onFull: function () { submit(); }, onEnter: function () { submit(); } });
      body.appendChild(box.el); body.appendChild(box.err);
      var go = el('button', 'ddsf-go', 'Turn off two-step sign-in'); go.type = 'button'; body.appendChild(go);
      var more = el('div', 'ddsf-more'); var cancel = el('button', 'ddsf-x', 'Cancel'); cancel.type = 'button'; more.appendChild(cancel); body.appendChild(more);
      body.appendChild(el('p', 'ddsf-foot', o.lost || 'Lost your phone? Email support@davisdigitalstudio.com from your sign-in address. We check it’s you before turning it off.'));
      document.body.appendChild(d);
      var done = false, busy = false;
      function finish(result) {
        if (done) return; done = true;
        try { d.close(); } catch (_) { /* already closed */ }
        d.remove();
        if (opener && opener.focus && document.contains(opener)) { try { opener.focus(); } catch (_) { /* gone */ } }
        resolve(result);
      }
      function submit() {
        if (busy) return;
        var c = box.value();
        if (c.length !== 6) { box.fault('Type all six digits.'); box.focus(); return; }
        busy = true; go.disabled = true; go.textContent = 'Checking…'; box.fault('');
        var again = function (msg) { busy = false; go.disabled = false; go.textContent = 'Turn off two-step sign-in'; box.fault(msg); box.clear(); box.focus(); };
        verifyApp(sb, factor.id, c).then(function (r) {
          if (!r.ok) return again(r.message);
          return Promise.resolve(sb.auth.mfa.unenroll({ factorId: factor.id })).then(function (u) {
            if (u && u.error) return again('That didn’t go through. Two-step sign-in is still on.');
            // the sign-in on this device drops back to a password-only one at its next refresh; do it now
            Promise.resolve(sb.auth.refreshSession()).catch(function () {});
            finish({ off: true });
          }, function () { again('That didn’t go through. Two-step sign-in is still on.'); });
        });
      }
      go.addEventListener('click', submit);
      cancel.addEventListener('click', function () { finish({ cancelled: true }); });
      d.addEventListener('cancel', function (e) { e.preventDefault(); finish({ cancelled: true }); });
      d.showModal();
      box.focus();
    });
  }

  window.ddsFresh = {
    /** Make the page's request; when it needs a fresh code, ask for it and make it again. */
    run: function (send, o) {
      return Promise.resolve(send({})).then(function (r) {
        var b = r && r.body;
        if (!r || r.ok || !b || !OPEN[b.error] || (r.status !== 403 && r.status !== 429)) return r;
        return ask(b, send, o);
      });
    },
    boxes: boxes,
    stepDue: stepDue,
    verifyApp: verifyApp,
    status: status,
    turnOn: turnOn,
    turnOff: turnOff,
  };
})();
