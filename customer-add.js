// ── Add a customer and Delete customer: one box each (builder items 102 and 241) ───
// Home (agency.html), Customers and Contacts open the same Add a customer box; the
// customer's profile (crm.html) and Customers open the same Delete customer box. They
// used to be copies kept in sync by hand (item 102). Drawn in Figma (page "Customers:
// save, Create website, invite, delete — items 241 and 102").
//
// Item 241 (Eric, Nov 15: "it looks like every time a customer has been created, it starts
// their site. shouldnt be that way"): adding a customer saves the customer and nothing
// else. No website, no sign-in, nobody emailed. Their profile then has Create website and
// Invite to their portal, each on its own.
//
//   const ADD = window.ddsAddCustomer.mount({ request(method, path, body), toast(msg, bad), done() });
//   ADD.open();
//   window.ddsCustomerDelete.open({ request, toast, customer: { client_id, name, website }, onDeleted(data) });
//
// They talk to POST /sales/customers (mode 'save') and POST /sales/customers/:id/delete
// (routes/customers.ts). The ids inside (cu-name, cu-submit, cust-done…) are the ones the
// browser tests have always used.
(function () {
  'use strict';
  if (window.ddsAddCustomer) return;

  var CSS = [
    '#custDlg .done{text-align:center;padding:var(--dds-s2,8px) 0 var(--dds-s1,4px)}',
    '#custDlg .done .tick{width:48px;height:48px;border-radius:50%;background:var(--dds-good-soft,#e7f1ea);color:var(--dds-good,#33664b);display:flex;align-items:center;justify-content:center;font-size:22px;margin:0 auto var(--dds-s3,12px)}',
    '#custDlg .done p{color:var(--dds-soft,#6b6478);font-size:14px;margin:6px 0 0}',
    '#custDlg .cu-lead{font-size:13.5px;color:var(--dds-soft,#6b6478);margin:0 0 var(--dds-s2,8px);line-height:1.5}',
    '#custDlg .opt{font-weight:500;color:var(--dds-faint,#746b8a)}',
    // the Delete customer box (item 241)
    '#custDelDlg{max-width:520px}',
    '#custDelDlg .cd-head{display:flex;align-items:center;gap:12px;margin:0 0 10px}',
    '#custDelDlg .cd-mark{flex:0 0 auto;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--dds-bad-soft,#fde8e6);color:var(--dds-bad,#b42318)}',
    "#custDelDlg h3{margin:0;font-family:'Fraunces','Iowan Old Style',Georgia,serif;font-weight:600;font-size:21px;line-height:1.25;overflow-wrap:anywhere}",
    '#custDelDlg .cd-what{font-size:14px;color:var(--dds-soft,#6b6478);line-height:1.5;margin:0 0 14px}',
    '#custDelDlg fieldset{border:0;padding:0;margin:0 0 12px;display:flex;flex-direction:column;gap:8px}',
    '#custDelDlg legend{font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--dds-p,#5b3fa0);margin:0 0 8px;padding:0}',
    '#custDelDlg .cd-opt{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--dds-line,#eee9e0);border-radius:12px;padding:12px 14px;cursor:pointer;font-size:14px;color:var(--dds-ink,#1b1525);background:var(--dds-card,#fff)}',
    '#custDelDlg .cd-opt:has(input:checked){border:2px solid var(--dds-p,#5b3fa0);background:var(--dds-p-soft,#efeafa);padding:11px 13px}',
    '#custDelDlg .cd-opt:has(input:disabled){opacity:.6;cursor:not-allowed}',
    '#custDelDlg .cd-opt input{width:auto;margin-top:2px;accent-color:var(--dds-p,#5b3fa0)}',
    '#custDelDlg .cd-opt strong{display:block;font-weight:600;font-size:14.5px}',
    '#custDelDlg .cd-opt span span{display:block;font-size:13px;color:var(--dds-soft,#6b6478);margin-top:2px;line-height:1.45}',
    '#custDelDlg .cd-note{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;line-height:1.45;color:var(--dds-info,#245fa0);background:var(--dds-info-soft,#eef3fb);border-radius:10px;padding:10px 12px;margin:4px 0 0}',
    '#custDelDlg .cd-note svg{flex:0 0 auto;margin-top:2px}',
    '#custDelDlg .cd-err{margin:10px 0 0;font-size:13.5px;color:var(--dds-bad,#b42318)}',
    '#custDelDlg .btn.danger,#custDelDlg button.danger{background:var(--dds-bad,#b42318);color:#fff;border:0}',
    '@media (max-width:640px){#custDelDlg{margin:auto 0 0;width:100%;max-width:none;border-radius:20px 20px 0 0}#custDelDlg .row2{flex-direction:column-reverse}#custDelDlg .row2 .btn{width:100%;min-height:48px}}',
  ].join('\n');

  var ADD_MARKUP = ''
    + '<dialog id="custDlg" aria-label="Add a customer">'
    + '<form id="custForm" class="dbody">'
    + '<div id="cust-fields">'
    + '<h3>Add a customer</h3>'
    + '<p class="cu-lead">Saves them to your customers. No website is made and nobody is emailed. Their profile has Create website and Invite to their portal for when you’re ready.</p>'
    + '<label for="cu-name">Their name</label>'
    + '<input id="cu-name" maxlength="120" placeholder="Jane Doe" autocomplete="off">'
    + '<label for="cu-biz">Business name <span class="opt">(optional)</span></label>'
    + '<input id="cu-biz" maxlength="120" placeholder="Acme Bakery" autocomplete="off">'
    + '<label for="cu-email">Email <span class="opt">(or a phone)</span></label>'
    + '<input id="cu-email" type="email" maxlength="160" placeholder="jane@acmebakery.com" autocomplete="off">'
    + '<label for="cu-phone">Phone <span class="opt">(optional)</span></label>'
    + '<input id="cu-phone" type="tel" maxlength="40" placeholder="(555) 123-4567" autocomplete="off">'
    + '<div class="row2"><button type="button" class="btn ghost" id="cu-cancel">Cancel</button><button type="submit" class="btn" id="cu-submit">Save customer</button></div>'
    + '</div>'
    + '<div id="cust-done" style="display:none"></div>'
    + '</form>'
    + '</dialog>';

  var O = null;   // the page's options (mount)
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toastWith(o, m, bad, action) { try { if (o && o.toast) o.toast(m, bad, action); else if (window.ddsToast) window.ddsToast(m, bad ? 'err' : 'ok', action); } catch (_) { /* a toast is never worth an error */ } }
  function css() {
    if (document.getElementById('dds-custdlg-css')) return;
    var st = document.createElement('style'); st.id = 'dds-custdlg-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  var profileHref = function (clientId) { return '/crm.html?client_id=' + encodeURIComponent(clientId); };

  function open() {
    ensure();
    $('cu-name').value = ''; $('cu-biz').value = ''; $('cu-email').value = ''; $('cu-phone').value = '';
    $('cust-fields').style.display = ''; $('cust-done').style.display = 'none'; $('cust-done').innerHTML = '';
    var sb = $('cu-submit'); if (sb) { sb.disabled = false; sb.textContent = 'Save customer'; }
    // Name is the box's first field, so showModal already focuses it; the late nudge never
    // pulls focus back from a field someone has moved to (item 199's focus race)
    var d = $('custDlg'); d.showModal();
    setTimeout(function () { var a = document.activeElement; if (!d.contains(a) || a === d) $('cu-name').focus(); }, 20);
  }

  function submit(e) {
    e.preventDefault();
    var name = $('cu-name').value.trim(), business_name = $('cu-biz').value.trim(), email = $('cu-email').value.trim(), phone = $('cu-phone').value.trim();
    // sales item 150: an email or a phone saves them; with a phone alone, a name says who this is
    if (!email && !phone) { toastWith(O, 'Enter their email or phone number to save them.', true); $('cu-email').focus(); return; }
    if (!email && !name) { toastWith(O, 'Enter their name too, so you know who this is.', true); $('cu-name').focus(); return; }
    var btn = $('cu-submit'); btn.disabled = true; btn.textContent = 'Saving…';
    var failed = function (m) { toastWith(O, m || 'We couldn’t save them just now.', true); btn.disabled = false; btn.textContent = 'Save customer'; };
    // The pages go live on merge and the server only with the deploy that follows. A server from
    // before item 241 reads every mode but 'connect' as "set up their website and invite them",
    // so the box asks for 'connect' with save: true. This server saves the customer; an older one
    // only saves them to the contacts and emails nobody.
    var body = { mode: 'connect', save: true, name: name || undefined, business_name: business_name || undefined, email: email || undefined, phone: phone || undefined };
    return Promise.resolve().then(function () { return O.request('POST', '/sales/customers', body); }).then(function (r) {
      if (!r || !r.ok) {
        failed(r && r.status === 403 ? 'Customers are part of your plan’s business tools — an upgrade adds them.' : (r && r.body && r.body.message) || '');
        return 'stop';
      }
      showDone((r.body && r.body.data) || {}, name, business_name, email || phone);
    }).then(function (how) {
      if (how === 'stop') return;
      // the save SUCCEEDED: the list refresh is best-effort and never repaints that success as
      // a failure (SS6); its own failure gets the soft couldn't-refresh line
      return Promise.resolve().then(function () { return O.done ? O.done() : null; })
        .catch(function () { toastWith(O, 'We couldn’t refresh the list just now — Refresh will catch it up.', true); });
    }, function () { failed(''); });
  }

  function showDone(d, name, business_name, email) {
    var who = esc(business_name || name || email);
    var heading, line, openBtn = '';
    if (d.requested) {
      // final pass S1: an account that isn't yours yet is asked, never taken
      heading = 'Request sent';
      line = who + ' already has a Studio OS account, so they need to say yes first. They’ll see your request the next time they sign in.';
    } else if (d.connected) {
      heading = 'Connected again';
      line = who + ' was already your customer, so they’re connected again. Nothing was emailed and no website was made.';
    } else if (d.already) {
      heading = 'Already your customer';
      line = who + ' is already on your Customers list. Nothing new was made.';
    } else if (d.mode === 'connect') {
      // an older server's answer, in the minutes before the deploy: a contact, not a customer yet
      heading = 'Saved to your contacts';
      line = who + ' is in your contacts. No website yet, and nothing was emailed.';
    } else {
      heading = 'Saved to your customers';
      line = who + ' is on your Customers list. No website yet, and nothing was emailed.';
    }
    if (d.client_id && !d.requested) openBtn = '<a class="btn" id="cu-open" href="' + esc(profileHref(d.client_id)) + '">Open their profile</a>';
    $('cust-fields').style.display = 'none';
    var done = $('cust-done');
    done.innerHTML = '<div class="done"><div class="tick" aria-hidden="true">✓</div><h3 style="margin:0 0 4px">' + heading + '</h3><p>' + line + '</p></div>'
      + '<div class="row2">' + (openBtn ? '<button type="button" class="btn ghost" id="cu-again">Add another</button>' + openBtn : '<button type="button" class="btn" id="cu-close">Done</button>') + '</div>';
    done.style.display = '';
    var first = $('cu-open') || $('cu-close'); if (first) first.focus();
    var cl = $('cu-close'); if (cl) cl.onclick = function () { $('custDlg').close(); };
    var ag = $('cu-again'); if (ag) ag.onclick = function () { open(); };
  }

  function ensure() {
    css();
    if ($('custDlg')) return;
    var holder = document.createElement('div'); holder.innerHTML = ADD_MARKUP;
    document.body.appendChild(holder.firstChild);
    $('cu-cancel').onclick = function () { $('custDlg').close(); };
    $('custForm').onsubmit = submit;
  }

  window.ddsAddCustomer = {
    // opts: { request(method, path, body) → {ok,status,body}, toast(msg, bad), done() }
    mount: function (opts) { O = opts || {}; ensure(); return { open: open }; },
    open: open,
  };

  // ── Delete customer (item 241): one box for their profile and the Customers list ──
  // customer: { client_id, name, website: { state: 'none'|'workspace'|'ours'|'elsewhere', in_trash, live }, can_manage_sites }
  var TRASH = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 7h16M10 7V5h4v2M6.5 7l1 13h9l1-13"/></svg>';
  var CLOCK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  function openDelete(o) {
    css();
    var c = o.customer || {}, w = c.website || {};
    var hasSite = !!w.state && w.state !== 'none' && !w.in_trash;
    var canTrash = c.can_manage_sites !== false;
    var what = w.state === 'workspace' ? 'workspace' : 'website';
    var old = $('custDelDlg'); if (old) old.remove();
    var d = document.createElement('dialog'); d.id = 'custDelDlg'; d.setAttribute('aria-labelledby', 'cd-title');
    d.innerHTML = '<form class="dbody" method="dialog" id="cd-form">'
      + '<div class="cd-head"><span class="cd-mark">' + TRASH + '</span><h3 id="cd-title">Delete ' + esc(c.name || 'this customer') + '?</h3></div>'
      + '<p class="cd-what">They leave Customers and Contacts, with their project and its messages. Their invoices stay in Invoices, as money records always do.</p>'
      + (hasSite ? '<fieldset id="cd-site"><legend>Their ' + what + '</legend>'
        + '<label class="cd-opt"><input type="radio" name="cdsite" value="trash"' + (canTrash ? ' checked' : ' disabled') + '><span><strong>Move it to the Trash</strong><span>'
        + (canTrash ? 'It leaves Sites' + (w.live ? ' and goes offline' : '') + '. You can restore it from the Trash on Sites for 90 days.' : 'Only someone who looks after your clients’ sites can move one to the Trash.') + '</span></span></label>'
        + '<label class="cd-opt"><input type="radio" name="cdsite" value="keep"' + (canTrash ? '' : ' checked') + '><span><strong>Keep it on Sites</strong><span>It stays as it is, and you keep looking after it without a customer.</span></span></label>'
        + '</fieldset>' : (w.in_trash ? '<p class="cd-what">Their website is already in the Trash on Sites.</p>' : ''))
      + '<p class="cd-note">' + CLOCK + '<span id="cd-back">Changed your mind? Bring them back from Recently deleted for 30 days' + (hasSite && canTrash ? ', and their ' + what + ' with them' : '') + '.</span></p>'
      + '<p class="cd-err" id="cd-err" role="alert" hidden></p>'
      + '<div class="row2"><button type="button" class="btn ghost" id="cd-cancel">Cancel</button><button type="submit" class="btn danger" id="cd-go" data-needs="delete">Delete customer</button></div>'
      + '</form>';
    document.body.appendChild(d);
    var back = function () { var b = $('cd-back'); var t = d.querySelector('input[name="cdsite"]:checked'); if (b) b.textContent = 'Changed your mind? Bring them back from Recently deleted for 30 days' + (t && t.value === 'trash' ? ', and their ' + what + ' with them' : '') + '.'; };
    d.querySelectorAll('input[name="cdsite"]').forEach(function (r) { r.addEventListener('change', back); });
    var opener = o.back || document.activeElement;
    var close = function () { d.close(); };
    d.addEventListener('close', function () { d.remove(); if (opener && opener.isConnected && opener.focus) try { opener.focus(); } catch (_) { /* */ } });
    $('cd-cancel').onclick = close;
    $('cd-form').onsubmit = function (e) {
      e.preventDefault();
      var go = $('cd-go'), err = $('cd-err'), t = d.querySelector('input[name="cdsite"]:checked');
      var body = hasSite ? { site: t ? t.value : 'keep' } : {};
      go.disabled = true; go.textContent = 'Deleting…'; err.hidden = true;
      Promise.resolve().then(function () { return o.request('POST', '/sales/customers/' + encodeURIComponent(c.client_id) + '/delete', body); }).then(function (r) {
        if (!r || !r.ok) { err.textContent = (r && r.body && r.body.message) || 'We couldn’t delete them just now. Please try again.'; err.hidden = false; go.disabled = false; go.textContent = 'Delete customer'; return; }
        opener = null; d.close();
        if (o.onDeleted) o.onDeleted((r.body && r.body.data) || {});
      }, function () { err.textContent = 'We couldn’t delete them just now. Please try again.'; err.hidden = false; go.disabled = false; go.textContent = 'Delete customer'; });
    };
    d.showModal();
    setTimeout(function () { var f = d.querySelector('input[name="cdsite"]:checked') || $('cd-cancel'); var a = document.activeElement; if (f && (!d.contains(a) || a === d)) f.focus(); }, 20);
    return d;
  }
  /** Undo a delete (the toast right after, or Recently deleted). */
  function restore(o, clientId) {
    return Promise.resolve().then(function () { return o.request('POST', '/sales/customers/' + encodeURIComponent(clientId) + '/restore', {}); });
  }
  window.ddsCustomerDelete = { open: openDelete, restore: restore };
})();
