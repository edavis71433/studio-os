// ── Add a customer: the one box (builder item 102) ─────────────────────────────
// Home (agency.html), Customers and Contacts open this same box. It used to be three
// copies kept in sync by hand, and the copies drifted (one said templates, one didn't).
// A page mounts it once with its own way of asking the server, its toast, whether this
// sign-in runs an agency (starter kits are an agency's), and what to refresh after a save:
//
//   const ADD = window.ddsAddCustomer.mount({ request(method, path, body), toast(msg, bad),
//                                             isAgency(), done() });
//   ADD.open();          // "Just save them for now" picked
//   ADD.open(true);      // opens on setting them up (Home's ⌘K "Starter kits")
//
// It talks to POST /sales/customers (routes/sales.ts handleSalesAddCustomer) and, for a
// starter kit, POST /agency/kits/:id/apply on the new site. The ids inside (cu-name,
// cu-submit, cust-done…) are the ones the browser tests have always used.
(function () {
  'use strict';
  if (window.ddsAddCustomer) return;

  var CSS = [
    '#custDlg #cu-mode{display:flex;flex-direction:column;gap:var(--dds-s2,8px);margin:2px 0 var(--dds-s1,4px)}',
    '#custDlg .modeopt{display:flex;align-items:flex-start;gap:var(--dds-s2,8px);border:1px solid var(--dds-line,#eee9e0);border-radius:var(--dds-r,8px);padding:10px var(--dds-s3,12px);cursor:pointer;font-size:14px;color:var(--dds-ink,#1b1525)}',
    '#custDlg .modeopt:has(input:checked){border-color:var(--dds-p,#5b3fa0);background:var(--dds-p-soft,#efeafa)}',
    '#custDlg .modeopt input{width:auto;margin-top:var(--dds-s1,4px);accent-color:var(--dds-p,#5b3fa0)}',
    // builder item 98: on a touch screen a finger just left of the round button still picks the choice
    '@media (pointer:coarse){#custDlg .modeopt{padding-left:20px}}',
    '#custDlg .modeopt strong{display:block;font-weight:600;font-size:13.5px}',
    '#custDlg .modehint{display:block;font-size:12px;color:var(--dds-faint,#746b8a);margin-top:2px;line-height:1.45}',
    // builder item 198: a full plan is said in the box, where the person is looking, not in a toast
    '#custDlg .cu-full{background:var(--dds-warn-soft,#f3ead9);color:var(--dds-warn,#775d31);border-radius:10px;padding:12px 14px;font-size:13.5px;line-height:1.45}',
    '#custDlg .cu-full b{display:block}',
    '#custDlg .done{text-align:center;padding:var(--dds-s2,8px) 0 var(--dds-s1,4px)}',
    '#custDlg .done .tick{width:44px;height:44px;border-radius:50%;background:var(--dds-good-soft,#e7f1ea);color:var(--dds-good,#33664b);display:flex;align-items:center;justify-content:center;font-size:22px;margin:0 auto var(--dds-s3,12px)}',
    '#custDlg .done p{color:var(--dds-soft,#6b6478);font-size:14px;margin:6px 0 0}',
  ].join('\n');

  var MARKUP = ''
    + '<dialog id="custDlg" aria-label="Add a customer">'
    + '<form id="custForm" class="dbody">'
    + '<div id="cust-fields">'
    + '<h3>Add a customer</h3>'
    + '<label for="cu-name">Their name</label>'
    + '<input id="cu-name" maxlength="120" placeholder="Jane Doe" autocomplete="off">'
    + '<label for="cu-email">Email</label>'
    + '<input id="cu-email" type="email" maxlength="160" placeholder="jane@acmebakery.com" autocomplete="off">'
    + '<div id="cu-mode" role="radiogroup" aria-label="What adding them does">'
    + '<label class="modeopt"><input type="radio" name="cumode" value="connect" checked>'
    + '<span><strong>Just save them for now</strong><span class="modehint">No website yet, and nothing is emailed. You can set up their website later.</span></span></label>'
    + '<label class="modeopt"><input type="radio" name="cumode" value="provision">'
    + '<span><strong>Set up their website and invite them</strong><span class="modehint">Makes their workspace and website now, and emails them a link to sign in.</span></span></label>'
    + '</div>'
    + '<div id="cu-provision-only" style="display:none">'
    + '<label for="cu-biz">Business name</label>'
    + '<input id="cu-biz" maxlength="120" placeholder="Acme Bakery" autocomplete="off">'
    + '<label for="cu-edition">What kind of work is this?</label>'
    + '<select id="cu-edition">'
    + '<option value="presence" selected>Their site will live on my platform (Studio OS)</option>'
    + '<option value="business_os_only">Building or redoing their site on another platform — they host it elsewhere</option>'
    + '<option value="business_os_no_site">Just their client workspace / business tools — no site work</option>'
    + '<option value="presence_monitor">Just monitoring a site they already have</option>'
    + '</select>'
    + '<div id="cu-kit-wrap" style="display:none">'
    + '<label for="cu-kit">Start from</label>'
    + '<select id="cu-kit"><option value="">No kit — start empty</option></select>'
    + '<p class="note">A starter kit copies a saved client’s setup — services, FAQs, voice and colors — onto their new site; a template brings its pages, sections and photos too. Their own business details stay theirs to fill in.</p>'
    + '</div>'
    + '<div id="cu-website-wrap" style="display:none">'
    + '<label for="cu-website">Their existing website address</label>'
    + '<input id="cu-website" maxlength="200" placeholder="acmebakery.com" autocomplete="off" inputmode="url">'
    + '<p class="note">You don’t host this one, so record where it lives. Google Search Console reports on a domain whoever hosts it — with the address on file, their existing search numbers start arriving. Visitor counts still can’t come from here (there’s no counter of ours on their pages). You can add or change this later on their website page.</p>'
    + '</div>'
    + '<p class="note">Adding them creates their client workspace and their site, and emails them a sign-in link. You bill them for your work the usual way — they never pay for software here.</p>'
    + '</div>'
    + '<p class="note cu-full" id="cu-full" role="alert" hidden></p>'
    + '<div class="row2"><button type="button" class="btn ghost" id="cu-cancel">Cancel</button><button type="submit" class="btn" id="cu-submit">Save</button></div>'
    + '</div>'
    + '<div id="cust-done" style="display:none"></div>'
    + '</form>'
    + '</dialog>';

  var O = null;                    // the page's options (mount)
  var CU_AGENCY = null, CU_KITS = null;   // bug hunt K7: read once per page, asked again after a failure

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(m, bad) { try { if (O && O.toast) O.toast(m, bad); else if (window.ddsToast) window.ddsToast(m, bad ? 'err' : 'ok'); } catch (_) { /* a toast is never worth an error */ } }
  function req(method, path, body) { return O.request(method, path, body); }

  // The four dropdown answers map to THREE server plans (sales.ts CONVERT_PLANS):
  // 'business_os_no_site' is the same Business OS plan as the build-elsewhere option.
  // The server knows no such key, and an unknown value would default to 'presence',
  // the hosted plan: exactly wrong for a no-site customer.
  function cuPlan() { var v = $('cu-edition').value; return v === 'business_os_no_site' ? 'business_os_only' : v; }
  // Who gets asked "where is their website?": build-elsewhere and monitor. That domain is
  // the one thing Search Console needs; the no-site answer has nothing to track.
  function cuAsksWebsite() { var v = $('cu-edition').value; return v === 'business_os_only' || v === 'presence_monitor'; }
  function syncCuSignup() { var w = $('cu-website-wrap'); if (w) w.style.display = cuAsksWebsite() ? '' : 'none'; }
  // Builder item 199, then Eric (Nov 15): adding a customer starts nothing unless asked.
  // "Just save them for now" (connect, the default) saves them to the contacts and emails
  // nobody; "Set up their website and invite them" (provision) makes their workspace and site.
  function cuMode() { var r = document.querySelector('input[name="cumode"]:checked'); return r ? r.value : 'connect'; }
  function syncCuMode() {
    var save = cuMode() === 'connect';
    var po = $('cu-provision-only'); if (po) po.style.display = save ? 'none' : '';
    var sb = $('cu-submit'); if (sb) sb.textContent = save ? 'Save' : 'Set up + invite';
    var cf = $('cu-full'); if (cf) cf.hidden = true;   // item 198's full-plan words belong to the last set-up attempt
    if (!save) syncCuSignup();
  }
  // Start from a kit (Oct 2026 studio audit, change 4): an agency's saved starter kits,
  // applied to the NEW site once the POST answers with its site_id. No agency, no kits or
  // a failed read hides the field: the box never offers what it can't do.
  function cuIsAgency() {
    if (CU_AGENCY !== null) return Promise.resolve(CU_AGENCY);
    return Promise.resolve().then(function () { return O.isAgency ? O.isAgency() : false; })
      .then(function (yes) { CU_AGENCY = !!yes; return CU_AGENCY; }, function () { return false; });
  }
  function cuKits() {
    if (CU_KITS) return Promise.resolve(CU_KITS);
    return req('GET', '/agency/kits').then(function (r) {
      if (!(r && r.ok && r.body && Array.isArray(r.body.data))) return [];
      CU_KITS = r.body.data; return CU_KITS;
    });
  }
  function syncCuKits() {
    var w = $('cu-kit-wrap'), sel = $('cu-kit'); if (!w || !sel) return Promise.resolve();
    w.style.display = 'none'; sel.innerHTML = '<option value="">No kit — start empty</option>';
    return cuIsAgency().then(function (yes) {
      if (!yes) return;
      return cuKits().then(function (kits) {
        if (!kits.length) return;
        // item 145: a template brings its pages too, and says so
        sel.innerHTML += kits.map(function (k) { return '<option value="' + esc(k.id) + '">' + esc(k.name) + (k.kind === 'template' ? ' — template with its pages' : '') + '</option>'; }).join('');
        w.style.display = '';
      });
    }).catch(function () { /* kits are a nicety: the field just stays hidden */ });
  }

  function open(setUp) {   // setUp===true opens on setting them up (a click passes an event)
    ensure();
    $('cu-name').value = ''; $('cu-biz').value = ''; $('cu-email').value = ''; $('cu-edition').value = 'presence';
    var wf = $('cu-website'); if (wf) wf.value = '';
    var sv = document.querySelector('input[name="cumode"][value="' + (setUp === true ? 'provision' : 'connect') + '"]'); if (sv) sv.checked = true;
    syncCuMode(); syncCuKits();
    $('cust-fields').style.display = ''; $('cust-done').style.display = 'none'; $('cust-done').innerHTML = '';
    var cf = $('cu-full'); if (cf) { cf.hidden = true; cf.textContent = ''; }
    var sb = $('cu-submit'); if (sb) sb.disabled = false;
    // Name is the box's first field, so showModal already focuses it; the late nudge never
    // pulls focus back from a field someone has moved to (item 199's focus race)
    var d = $('custDlg'); d.showModal();
    setTimeout(function () { var a = document.activeElement; if (!d.contains(a) || a === d) $('cu-name').focus(); }, 20);
  }

  function submit(e) {
    e.preventDefault();
    var mode = cuMode();
    var name = $('cu-name').value.trim(), business_name = $('cu-biz').value.trim(), email = $('cu-email').value.trim();
    var kitSel = $('cu-kit'), kitId = (mode === 'provision' && kitSel && kitSel.value) || '';
    var kitName = kitId ? String((kitSel.options[kitSel.selectedIndex] || {}).textContent || 'kit').trim() : '';
    if (!email) { toast(mode === 'connect' ? 'Enter their email to save them.' : 'Enter their email — that’s where the sign-in invitation goes.', true); $('cu-email').focus(); return; }
    var label = mode === 'connect' ? 'Save' : 'Set up + invite';
    var btn = $('cu-submit'); btn.disabled = true; btn.textContent = mode === 'connect' ? 'Saving…' : 'Setting up…';
    var body = mode === 'connect' ? { mode: 'connect', name: name || undefined, email: email }
      : { mode: 'provision', name: name || undefined, business_name: business_name || undefined, email: email, edition: cuPlan(),
        website_url: (cuAsksWebsite() && $('cu-website') && $('cu-website').value.trim()) || undefined };
    var failed = function () { toast(mode === 'connect' ? 'We couldn’t save them just now.' : 'We couldn’t set them up just now.', true); btn.disabled = false; btn.textContent = label; };
    var r;
    return Promise.resolve().then(function () { return req('POST', '/sales/customers', body); }).then(function (res) {
      r = res;
      if (!r.ok) {
        // builder item 198: the plan's sites are all in use; nothing was made, and the box says why
        if (r.status === 409 && r.body && r.body.error === 'client_limit') {
          var cf = $('cu-full'), t = String(r.body.message || ''), cut = t.indexOf('. ');
          if (cf) { cf.innerHTML = cut > 0 ? '<b>' + esc(t.slice(0, cut + 1)) + '</b>' + esc(t.slice(cut + 2)) : esc(t); cf.hidden = false; }
          btn.disabled = false; btn.textContent = label; return 'stop';
        }
        var m = r.status === 403 ? 'Customers are part of your plan’s business tools — an upgrade adds them.' : ((r.body && r.body.message) || (mode === 'connect' ? 'We couldn’t save them just now.' : 'We couldn’t set them up just now.'));
        toast(m, true); btn.disabled = false; btn.textContent = label; return 'stop';
      }
      return showDone(r, mode, name, business_name, email, kitId, kitName);
    }).then(function (how) {
      if (how === 'stop') return;
      // the creation SUCCEEDED: the list refresh is best-effort and never repaints that
      // success as a failure (SS6); its own failure gets the soft couldn't-refresh line
      return Promise.resolve().then(function () { return O.done ? O.done() : null; })
        .catch(function () { toast('We couldn’t refresh the list just now — Refresh will catch it up.', true); });
    }, failed);
  }

  function showDone(r, mode, name, business_name, email, kitId, kitName) {
    var d = (r.body && r.body.data) || {};
    var who = esc((mode === 'provision' && business_name) || name || email);
    var heading, line;
    if (d.requested) {
      // final pass S1: an account that isn't yours yet is asked, never taken
      heading = 'Request sent';
      line = who + ' already has a Studio OS account, so they need to say yes first. They’ll see your request the next time they sign in.';
    } else if (mode === 'connect') {
      // saved, not set up: no website and no email (someone already yours is connected again)
      if (d.connected) { heading = 'Connected again'; line = who + ' was already your customer, so they’re connected again. Nothing was emailed and no website was made.'; }
      else { heading = 'Saved'; line = who + ' is saved to your contacts. No website yet, and nothing was emailed. To set up their website later, open Add a customer again and choose Set up their website and invite them.'; }
    } else if (d.already_exists) {
      heading = 'They already have a workspace';
      line = who + ' already had an account — connected to their existing workspace. Nothing duplicated. Send them their sign-in link if they need it.';
    } else if (d.invited === false) {
      // honest outcome: the account exists but the invitation email failed (SS6)
      heading = 'Account created — the invitation email couldn’t be sent';
      line = 'Their workspace is ready, but our email to ' + esc(email) + ' didn’t go out. Share their sign-in page with them instead.';
    } else {
      heading = 'Invitation sent';
      line = 'Invitation sent to ' + esc(email) + '. They’ll sign in from the email and land in their client portal.';
    }
    // the kit, applied to THEIR new site after the set-up succeeded, on its own: a kit that
    // won't apply never repaints the set-up as a failure (bug hunt A4: it offers itself again)
    var applyKit = function () {
      return Promise.resolve().then(function () { return req('POST', '/agency/kits/' + encodeURIComponent(kitId) + '/apply', { site_id: d.site_id }); })
        .then(function (k) { return !!(k && k.ok); }, function () { return false; });
    };
    var kitStep;
    if (!kitId) kitStep = Promise.resolve({ line: '', retry: null });
    else if (d.already_exists || d.requested) kitStep = Promise.resolve({ line: 'The ' + esc(kitName) + ' kit wasn’t applied — they already had a workspace, and a kit only starts a new site.', retry: null });
    else if (!d.site_id) kitStep = Promise.resolve({ line: 'The ' + esc(kitName) + ' kit wasn’t applied: their new site didn’t come back to us, so there was nothing to apply it to. Their account is ready.', retry: null });
    else kitStep = applyKit().then(function (ok) { return { line: ok ? esc(kitName) + ' applied.' : 'The ' + esc(kitName) + ' kit didn’t apply. Their account is ready.', retry: ok ? null : applyKit }; });
    return kitStep.then(function (kit) {
      // a portal link only makes sense once they actually have a workspace
      var link = d.portal_url ? '<p style="margin-top:12px"><a class="link" href="' + esc(d.portal_url) + '" target="_blank" rel="noopener">Their sign-in page →</a></p>' : '';
      $('cust-fields').style.display = 'none';
      var done = $('cust-done');
      done.innerHTML = '<div class="done"><div class="tick" aria-hidden="true">✓</div><h3 style="margin:0 0 4px">' + heading + '</h3><p>' + line + '</p>' + (kit.line ? '<p id="cu-kit-line">' + kit.line + '</p>' : '') + link + '</div>'
        + '<div class="row2">' + (kit.retry ? '<button type="button" class="btn ghost" id="cu-kit-again">Try the kit again</button>' : '') + '<button type="button" class="btn" id="cu-close">Done</button></div>';
      done.style.display = '';
      var cl = $('cu-close'); if (cl) { cl.focus(); cl.onclick = function () { $('custDlg').close(); }; }
      var ka = $('cu-kit-again');
      if (ka && kit.retry) ka.onclick = function () {
        ka.disabled = true; ka.textContent = 'Applying…';
        kit.retry().then(function (okNow) {
          var kl = $('cu-kit-line');
          if (okNow) { if (kl) kl.textContent = kitName + ' applied.'; ka.remove(); toast(kitName + ' applied.'); }
          else { ka.disabled = false; ka.textContent = 'Try the kit again'; toast('The kit didn’t apply this time either.', true); }
        });
      };
    });
  }

  function ensure() {
    if ($('custDlg')) return;
    if (!document.getElementById('dds-custdlg-css')) {
      var st = document.createElement('style'); st.id = 'dds-custdlg-css'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    var holder = document.createElement('div'); holder.innerHTML = MARKUP;
    document.body.appendChild(holder.firstChild);
    $('cu-cancel').onclick = function () { $('custDlg').close(); };
    $('cu-edition').onchange = syncCuSignup;
    document.querySelectorAll('input[name="cumode"]').forEach(function (r) { r.addEventListener('change', syncCuMode); });
    $('custForm').onsubmit = submit;
  }

  window.ddsAddCustomer = {
    // opts: { request(method, path, body) → {ok,status,body}, toast(msg, bad), isAgency() → bool, done() }
    mount: function (opts) { O = opts || {}; ensure(); return { open: open }; },
    open: open,
  };
})();
