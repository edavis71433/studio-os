// ── People on one site (builder list item 53, Nov 2026) ───────────────────────
// Wix's model: the client owns the site and the studio works on it with a role.
// One sheet, used twice: the Sites page opens it for a client's site (ddsPeople.open),
// and the Sharing page draws it in place for the owner's own site (ddsPeople.mount).
// It shows the owner, the studio that works on the site, and the people on their
// side with a role each; invites someone by role; changes a role; removes someone
// (press twice); and starts or stops a transfer of ownership. Every rule is the
// server's (routes/workspace.ts, routes/site_transfer.ts): this only draws what
// GET /portal/members says and says back what a refusal says.
// The page hands over its own request function (`api(path, method, body)`), which
// carries the site as x-dds-scope-site, so the sheet never guesses a site.
(function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var day = function (iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); };
  var initials = function (s) { var w = String(s || '?').replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean); return ((w[0] || '?').charAt(0) + (w[1] ? w[1].charAt(0) : '')).toUpperCase(); };
  var first = function (s) { var n = String(s || '').trim(); return /@/.test(n) ? n : (n.split(/\s+/)[0] || n); };
  var CAPS = ['Edit pages', 'Publish', 'Settings', 'Delete', 'Invite people'];
  // what each role can do, in the server's words (lib/site_roles.ts): Settings is configure
  var ROLES = [
    { key: 'business_owner', name: 'Co-owner', desc: 'Everything the owner can do, except hand the site to someone else.', can: [1, 1, 1, 1, 1] },
    { key: 'business_staff', name: 'Staff', desc: 'Edits pages, publishes, answers enquiries and bookings.', can: [1, 1, 0, 0, 0] },
    { key: 'developer', name: 'Developer', desc: 'What staff can do, plus settings and the code tools.', can: [1, 1, 1, 0, 0] },
    { key: 'client_reviewer', name: 'Reviewer', desc: 'Sees only what you share with them, approves and leaves notes.', can: [0, 0, 0, 0, 0], also: 'Approve' },
  ];
  var roleName = function (k) { var r = ROLES.filter(function (x) { return x.key === k; })[0]; return r ? r.name : k; };
  // Developer is paused (Nov 12 2026, lib/workspace.ts DEVELOPER_PAUSED): never offered,
  // but a seat that already holds it still reads Developer in its list.
  var OFFERED = ROLES.filter(function (r) { return r.key !== 'developer'; });
  var choicesFor = function (current) { return ROLES.filter(function (r) { return r.key !== 'developer' || r.key === current; }); };
  var TONES = ['#e3f0fb|#285f95', '#fdf0dc|#8a5a10', '#e6f5ec|#1f6b43', '#fbe7ee|#9b2c55', '#efeafa|#5b3fa0'];
  var tone = function (s) { var n = 0; String(s || '').split('').forEach(function (c) { n = (n * 31 + c.charCodeAt(0)) % 997; }); return TONES[n % TONES.length].split('|'); };

  var styled = false;
  function style() {
    if (styled) return; styled = true;
    var st = document.createElement('style'); st.id = 'dds-people-css';
    st.textContent = [
      '.pp-dlg{border:none;padding:0;border-radius:20px;width:min(580px,calc(100% - 24px));max-height:calc(100% - 32px);background:var(--dds-card,#fff);color:var(--dds-ink,#171522);box-shadow:0 12px 40px rgba(26,13,64,.14)}',
      '.pp-dlg::backdrop{background:rgba(27,21,37,.42)}',
      '@media (max-width:640px){.pp-dlg{width:100%;max-width:100%;margin:auto 0 0;border-radius:20px 20px 0 0;max-height:92vh}}',
      '.pp{display:flex;flex-direction:column;gap:14px;padding:22px 24px 24px;font-family:var(--dds-font,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);font-size:14px;line-height:1.45}',
      '.pp-inline .pp{padding:0}',
      '.pp-head{display:flex;align-items:flex-start;gap:12px}.pp-head .tt{flex:1;min-width:0}',
      '.pp-head h2{font-family:"Fraunces","Iowan Old Style",Georgia,serif;font-weight:600;font-size:22px;line-height:1.2;margin:0}',
      '.pp-head h2:focus{outline:none}',
      '.pp-head .sub{color:var(--dds-soft,#55526a);font-size:13px;margin-top:2px;overflow-wrap:anywhere}',
      '.pp-x{flex:0 0 auto;width:44px;height:44px;margin:-10px -12px 0 0;border:none;background:none;color:var(--dds-faint,#69667d);font-size:18px;border-radius:12px;cursor:pointer}.pp-x:hover{background:var(--dds-p-soft,#efeafa);color:var(--dds-p,#6d3fd4)}',
      '.pp-note{background:var(--dds-p-soft,#efeafa);color:var(--dds-p-deep,#40297f);border-radius:12px;padding:12px 14px;font-size:13px;font-weight:500}',
      '.pp-lab{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dds-faint,#69667d);margin-top:2px}',
      '.pp-row{display:flex;align-items:center;gap:12px;padding:8px 0;min-width:0}',
      '.pp-av{flex:0 0 auto;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700}',
      '.pp-av.sq{border-radius:9px;background:var(--dds-p,#6d3fd4);color:#fff}',
      '.pp-who{flex:1;min-width:0}.pp-who .n{font-weight:600;overflow-wrap:anywhere;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.pp-who .s{font-size:12.5px;color:var(--dds-soft,#55526a);overflow-wrap:anywhere}',
      '.pp-chip{display:inline-block;font-size:11.5px;font-weight:600;border-radius:999px;padding:2px 8px;background:var(--dds-good-soft,#e6f5ec);color:var(--dds-good,#11744a)}',
      '.pp-link{border:none;background:none;padding:0;font:inherit;font-weight:600;color:var(--dds-p,#6d3fd4);cursor:pointer;min-height:24px}.pp-link:hover{text-decoration:underline}',
      '.pp-btn{font:inherit;font-size:13px;font-weight:600;border-radius:999px;border:1px solid var(--dds-line,#e7e6ef);background:var(--dds-card,#fff);color:var(--dds-ink,#171522);padding:8px 14px;min-height:36px;cursor:pointer;flex:0 0 auto}',
      '.pp-btn:hover{border-color:var(--dds-p,#6d3fd4);color:var(--dds-p,#6d3fd4)}.pp-btn:disabled{opacity:.55;cursor:default}',
      '.pp-btn.pri{background:var(--dds-p,#6d3fd4);border-color:var(--dds-p,#6d3fd4);color:var(--dds-on-p,#fff)}.pp-btn.pri:hover{background:var(--dds-p-deep,#40297f);color:var(--dds-on-p,#fff)}',
      '.pp-btn.bad{color:var(--dds-bad,#b32929)}.pp-btn.armed{background:var(--dds-bad,#b32929);border-color:var(--dds-bad,#b32929);color:#fff}',
      '.pp-sel{font:inherit;font-size:12.5px;font-weight:600;border:1px solid var(--dds-line,#e7e6ef);border-radius:8px;background:var(--dds-card,#fff);color:var(--dds-ink,#171522);padding:6px 8px;min-height:36px;flex:0 0 auto;max-width:130px}',
      '.pp-rule{height:1px;background:var(--dds-line,#e7e6ef)}',
      '.pp-faint{font-size:12.5px;color:var(--dds-faint,#69667d)}',
      '.pp-wait{background:var(--dds-warn-soft,#fdf2e2);color:var(--dds-warn,#975208);border-radius:12px;padding:12px 14px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.pp-wait .t{flex:1 1 220px}',
      '.pp-err{background:var(--dds-warn-soft,#fdf2e2);color:var(--dds-warn,#975208);border-radius:12px;padding:12px 14px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.pp-err .t{flex:1 1 220px}',
      '.pp-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.pp-field{width:100%;box-sizing:border-box;font:inherit;font-size:15px;padding:11px 14px;border:1.5px solid var(--dds-line,#e7e6ef);border-radius:12px;background:var(--dds-card,#fff);color:var(--dds-ink,#171522)}.pp-field:focus{outline:none;border-color:var(--dds-p,#6d3fd4);box-shadow:0 0 0 3px var(--dds-p-soft,#efeafa)}',
      '.pp-roles{display:flex;flex-direction:column;gap:8px;border:none;padding:0;margin:0}.pp-roles legend{padding:0;margin-bottom:6px}',
      '.pp-role{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dds-line,#e7e6ef);border-radius:14px;padding:12px 14px;cursor:pointer;position:relative}',
      '.pp-role:has(input:checked){border:2px solid var(--dds-p,#6d3fd4);background:var(--dds-p-soft,#efeafa);padding:11px 13px}',
      '.pp-role:focus-within{outline:2px solid var(--dds-p,#6d3fd4);outline-offset:2px}',
      '.pp-role .top{display:flex;align-items:flex-start;gap:10px}.pp-role input{width:18px;height:18px;margin:1px 0 0;accent-color:var(--dds-p,#6d3fd4);flex:0 0 auto}',
      '.pp-role .nm{font-weight:600;font-size:14.5px;flex:0 0 auto}.pp-role .ds{color:var(--dds-soft,#55526a);font-size:13px}',
      '.pp-can{display:flex;flex-wrap:wrap;gap:6px;padding-left:28px}.pp-can span{font-size:11.5px;font-weight:600;border-radius:999px;padding:2px 8px;background:var(--dds-bg,#f4f3f9);color:var(--dds-faint,#69667d)}.pp-can span.y{background:var(--dds-good-soft,#e6f5ec);color:var(--dds-good,#11744a)}',
      '.pp-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.pp-step{background:var(--dds-bg,#f4f3f9);border-radius:14px;padding:12px;font-size:12px;color:var(--dds-soft,#55526a)}.pp-step b{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--dds-ink,#171522);margin-bottom:4px}',
      '.pp-step .n{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--dds-card,#fff);font-size:11px}.pp-step.now{background:var(--dds-p-soft,#efeafa);outline:1px solid var(--dds-p,#6d3fd4)}.pp-step.now .n{background:var(--dds-p,#6d3fd4);color:#fff}',
      '.pp-check{display:flex;align-items:flex-start;gap:10px;cursor:pointer}.pp-check input{width:18px;height:18px;margin:2px 0 0;accent-color:var(--dds-p,#6d3fd4);flex:0 0 auto}',
      '.pp-what{background:var(--dds-bg,#f4f3f9);border-radius:12px;padding:12px 14px;font-size:12.5px;color:var(--dds-soft,#55526a)}.pp-what b{color:var(--dds-ink,#171522)}.pp-what ul{margin:6px 0 0;padding-left:18px}',
      '.pp-load{padding:30px 0;text-align:center;color:var(--dds-faint,#69667d)}',
      '@media (max-width:640px){.pp{padding:18px 16px 22px}.pp-btn,.pp-sel{min-height:44px}.pp-row{flex-wrap:wrap}.pp-row .pp-who{flex-basis:calc(100% - 44px)}}',
    ].join('');
    document.head.appendChild(st);
  }

  // ── one sheet's state and drawing ──
  function Sheet(host, o) {
    this.host = host; this.o = o; this.d = null; this.view = o.view || 'people'; this.armed = ''; this.err = null; this.pick = 'business_staff'; this.busy = false;
  }
  Sheet.prototype.req = function (path, method, body) { return this.o.api(path, method || 'GET', body); };
  // builder item 191: inviting a co-owner, making someone one, bringing one back and handing
  // the site over ask for a fresh code first; fresh-code.js asks for it and sends again
  var freshP = null;
  function loadFresh() {
    if (window.ddsFresh) return Promise.resolve(window.ddsFresh);
    if (!freshP) freshP = new Promise(function (res) {
      var s = document.createElement('script'); s.src = '/fresh-code.js?v=191';
      s.onload = function () { res(window.ddsFresh || null); };
      s.onerror = function () { freshP = null; res(null); };
      document.head.appendChild(s);
    });
    return freshP;
  }
  Sheet.prototype.reqFresh = function (path, method, body) {
    var me = this;
    return loadFresh().then(function (F) {
      return F ? F.run(function (extra) { return me.req(path, method, Object.assign({}, body, extra)); }, { sb: me.o.sb }) : me.req(path, method, body);
    });
  };
  Sheet.prototype.load = function () {
    var me = this;
    me.host.innerHTML = '<div class="pp"><div class="pp-load" role="status">Loading the people…</div></div>';
    return me.req('/portal/members').then(function (r) {
      if (r.status === 403) { me.d = null; me.host.innerHTML = '<div class="pp">' + me.headHtml() + '<p class="pp-faint">' + esc((r.body && r.body.message) || 'Only the owner can manage who can get in.') + '</p></div>'; me.wire(); return; }
      if (!r.ok || !r.body || !Array.isArray(r.body.data)) { me.host.innerHTML = '<div class="pp">' + me.headHtml() + '<p class="pp-faint">The people wouldn’t load just now.</p><div class="pp-foot"><button type="button" class="pp-btn" data-pp="retry">Try again</button></div></div>'; me.wire(); return; }
      me.d = r.body; me.draw();
    });
  };
  Sheet.prototype.headHtml = function (title, sub) {
    var t = title || (this.view === 'invite' ? 'Invite someone' : this.view === 'transfer' ? 'Hand ' + (this.o.siteName || 'this site') + ' to someone else' : 'People');
    var s = sub != null ? sub : (this.view === 'people' ? (this.o.siteName || '') + (this.o.address ? ' · ' + this.o.address : '') : this.view === 'invite' ? 'To ' + (this.o.siteName || 'this site') + '. They get a sign-in link by email.' : 'Transfer ownership.');
    return '<div class="pp-head"><div class="tt"><h2 id="pp-title" tabindex="-1">' + esc(t) + '</h2>' + (s ? '<div class="sub">' + esc(s) + '</div>' : '') + '</div>' + (this.o.dialog ? '<button type="button" class="pp-x" data-pp="close" aria-label="Close">✕</button>' : '') + '</div>';
  };
  Sheet.prototype.side = function () { return (this.d && this.d.can_transfer) || null; };
  Sheet.prototype.ownerLine = function () {
    var d = this.d, ow = d.owner;
    if (!ow) return 'Nobody owns this site yet.';
    return ow.me ? 'You own this site.' : (ow.name || ow.email) + ' owns this site.';
  };
  Sheet.prototype.draw = function () {
    if (this.view === 'invite') return this.drawInvite();
    if (this.view === 'transfer') return this.drawTransfer();
    var me = this, d = me.d, ow = d.owner, st = d.studio, seats = d.data || [];
    var studioView = me.side() === 'studio' || !!(st && st.people.some(function (p) { return p.me; }));
    var live = seats.filter(function (m) { return m.status !== 'revoked'; }), gone = seats.filter(function (m) { return m.status === 'revoked'; });
    var h = '<div class="pp" aria-labelledby="pp-title">' + me.headHtml();
    var note = me.ownerLine() + (st ? (studioView ? ' Your studio works on it as ' + st.role + '.' : ' ' + st.name + ' works on it as ' + st.role + '.') : '') + (ow ? ' People on ' + (ow.me ? 'your' : first(ow.name) + '’s') + ' side each get their own sign-in, with a role.' : '');
    h += '<div class="pp-note">' + esc(note) + '</div>';
    h += '<div class="pp-lab">Owner</div>';
    if (ow) {
      var sub = ow.email + (ow.signed_in === false ? ' · Hasn’t signed in yet' : '');
      var canStart = !!me.side() && d.transfer_ready && !d.transfer;
      h += '<div class="pp-row" data-owner><span class="pp-av" style="background:var(--dds-p-soft,#efeafa);color:var(--dds-p,#6d3fd4)" aria-hidden="true">' + esc(initials(ow.name || ow.email)) + '</span><span class="pp-who"><span class="n">' + esc(ow.name || ow.email) + (ow.me ? ' <span class="pp-faint">· you</span>' : '') + ' <span class="pp-chip">Owner</span></span><span class="s">' + esc(sub) + '</span></span>' + (canStart ? '<button type="button" class="pp-btn" data-pp="transfer">Transfer ownership</button>' : '') + '</div>';
    } else {
      h += '<p class="pp-faint">Nobody owns this site yet. Invite the owner from the Sites page first.</p>';
    }
    if (d.transfer) {
      var t = d.transfer, wait = t.status === 'asked_owner' ? 'Waiting for ' + (ow && !ow.me ? first(ow.name) : 'the owner') + ' to agree' : 'Waiting for ' + t.to_email + ' to accept';
      if (ow && ow.me && t.status === 'asked_owner') wait = 'Waiting for you to agree. Check your email';
      h += '<div class="pp-wait" data-wait><span class="t">Handing over to ' + esc(t.to_email) + '. ' + esc(wait) + ', sent ' + esc(day(t.created_at) || 'today') + '. Lapses ' + esc(day(t.expires_at)) + '.</span>' + (me.side() ? '<button type="button" class="pp-btn bad" data-pp="stop">Stop the handover</button>' : '') + '</div>';
    }
    if (st) {
      h += '<div class="pp-rule"></div><div class="pp-lab">' + esc((studioView ? 'Your studio' : st.name) + ' · ' + st.role) + '</div>';
      st.people.forEach(function (p) { h += '<div class="pp-row"><span class="pp-av sq" aria-hidden="true">' + esc(initials(p.email)) + '</span><span class="pp-who"><span class="n">' + esc(p.email) + (p.me ? ' <span class="pp-faint">· you</span>' : '') + '</span><span class="s">' + esc(p.role) + '</span></span></div>'; });
      h += '<p class="pp-faint">' + esc(studioView ? 'Your studio’s owners, admins and account managers can open every client. Change them in Settings › Team.' : 'They can open your site to work on it. Ask ' + st.name + ' if that should change.') + '</p>';
    }
    h += '<div class="pp-rule"></div><div class="pp-lab">' + esc(ow ? (ow.me ? 'Your people' : first(ow.name) + '’s side') : 'Their side') + '</div>';
    if (!live.length) h += '<p class="pp-faint">Nobody else yet.</p>';
    live.forEach(function (m) {
      var tn = tone(m.email);
      var when = m.joined ? 'Joined ' + day(m.created_at) : 'Invited ' + day(m.created_at);
      var opts = choicesFor(m.role).map(function (r) { return '<option value="' + r.key + '"' + (r.key === m.role ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('');
      h += '<div class="pp-row" data-seat="' + esc(m.id) + '"><span class="pp-av" style="background:' + tn[0] + ';color:' + tn[1] + '" aria-hidden="true">' + esc(initials(m.email)) + '</span><span class="pp-who"><span class="n">' + esc(m.email) + '</span><span class="s">' + esc(when) + (m.joined ? '' : ' · <button type="button" class="pp-link" data-pp="resend" data-email="' + esc(m.email) + '">Send it again</button>') + '</span></span>' +
        '<select class="pp-sel" data-pp="role" data-id="' + esc(m.id) + '" aria-label="Role for ' + esc(m.email) + '">' + opts + '</select>' +
        '<button type="button" class="pp-btn bad' + (me.armed === m.id ? ' armed' : '') + '" data-pp="remove" data-id="' + esc(m.id) + '" aria-label="' + esc((me.armed === m.id ? 'Press again to remove ' : 'Remove ') + m.email) + '">' + (me.armed === m.id ? 'Press again' : 'Remove') + '</button></div>';
    });
    if (gone.length) {
      h += '<details class="pp-faint"><summary>Removed (' + gone.length + ')</summary>' + gone.map(function (m) { return '<div class="pp-row"><span class="pp-who"><span class="n">' + esc(m.email) + '</span><span class="s">Was ' + esc(roleName(m.role)) + '</span></span><button type="button" class="pp-btn" data-pp="restore" data-email="' + esc(m.email) + '" data-role="' + esc(m.role) + '">Bring them back</button></div>'; }).join('') + '</details>';
    }
    h += '<div class="pp-foot"><button type="button" class="pp-btn pri" data-pp="invite">+ Invite someone</button><span class="pp-faint">Removing someone ends their sign-in to this site at once.</span></div></div>';
    me.host.innerHTML = h; me.wire();
  };
  Sheet.prototype.drawInvite = function () {
    var me = this, d = me.d || {}, ow = d.owner;
    var owner = ow ? (ow.me ? 'you' : first(ow.name)) : 'the owner';
    var h = '<div class="pp">' + me.headHtml();
    h += '<label class="pp-lab" for="pp-email">Email</label><input class="pp-field" id="pp-email" type="email" autocomplete="off" placeholder="name@theirbusiness.com" value="' + esc(me.email || '') + '">';
    h += '<fieldset class="pp-roles"><legend class="pp-lab">What can they do?</legend>' + OFFERED.map(function (r) {
      var desc = r.key === 'business_owner' ? 'Everything ' + owner + ' can do, except hand the site to someone else.' : r.desc;
      return '<label class="pp-role"><span class="top"><input type="radio" name="pp-role" value="' + r.key + '"' + (me.pick === r.key ? ' checked' : '') + '><span class="nm">' + esc(r.name) + '</span><span class="ds">' + esc(desc) + '</span></span><span class="pp-can">' + CAPS.map(function (c, i) { return '<span class="' + (r.can[i] ? 'y' : '') + '">' + (r.can[i] ? '✓ ' : '✕ ') + esc(c) + '</span>'; }).join('') + (r.also ? '<span class="y">✓ ' + esc(r.also) + '</span>' : '') + '</span></label>';
    }).join('') + '</fieldset>';
    if (me.err) h += '<div class="pp-err" role="alert"><span class="t">' + esc(me.err.message) + '</span>' + (me.err.action ? '<button type="button" class="pp-btn" data-pp="' + esc(me.err.action) + '">' + esc(me.err.label) + '</button>' : '') + '</div>';
    h += '<div class="pp-foot"><button type="button" class="pp-btn pri" data-pp="send"' + (me.busy ? ' disabled' : '') + '>' + (me.busy ? 'Sending…' : 'Send invite') + '</button><button type="button" class="pp-btn" data-pp="back">Cancel</button></div>';
    h += '<p class="pp-faint">Settings means things like the domain, bookings set-up and taking the site offline. Only the owner can hand the site to someone else.</p></div>';
    me.host.innerHTML = h; me.wire();
    var f = me.host.querySelector('#pp-email'); if (f) f.focus();
  };
  Sheet.prototype.drawTransfer = function () {
    var me = this, d = me.d || {}, ow = d.owner || { name: '', email: '' }, side = me.side();
    var who = ow.me ? 'you' : first(ow.name);
    var h = '<div class="pp">' + me.headHtml(null, 'Transfer ownership. ' + (ow.me ? 'You own it today.' : (ow.name || ow.email) + ' owns it today.'));
    var steps = side === 'studio'
      ? [[1, first(ow.name) + ' agrees', 'We email ' + first(ow.name) + '. Only the owner can let the site go.'], [2, 'They accept', 'Then the new owner gets an email and accepts.'], [3, 'It’s theirs', 'Only now does the owner change. Nothing before.']]
      : [[1, 'They accept', 'The new owner gets an email and accepts.'], [2, 'It’s theirs', 'Only now does the owner change. Nothing before.']];
    h += '<div class="pp-steps">' + steps.map(function (s, i) { return '<div class="pp-step' + (i === 0 ? ' now' : '') + '"><b><span class="n" aria-hidden="true">' + s[0] + '</span>' + esc(s[1]) + '</b>' + esc(s[2]) + '</div>'; }).join('') + '</div>';
    h += '<label class="pp-lab" for="pp-to">New owner’s email</label><input class="pp-field" id="pp-to" type="email" autocomplete="off" placeholder="name@theirbusiness.com" value="' + esc(me.toEmail || '') + '">';
    h += '<label class="pp-check"><input type="checkbox" id="pp-keep"' + (me.keep === false ? '' : ' checked') + '><span><b>' + esc(ow.me ? 'Keep me on as Co-owner' : 'Keep ' + first(ow.name) + ' on as Co-owner') + '</b><br><span class="pp-faint">' + esc(ow.me ? 'Untick it if you’re leaving the business.' : 'Untick it if ' + who + ' is leaving the business.') + '</span></span></label>';
    h += '<div class="pp-what"><b>What changes</b><ul><li>The new owner signs in as the owner and decides who else gets in.</li><li>The pages, the plan, the people and your studio’s role stay as they are.</li><li>If the plan is paid by card, the new owner puts in their own card.</li><li>You or ' + esc(side === 'studio' ? first(ow.name) : 'the new owner') + ' can stop it any time before the new owner accepts. It lapses after 14 days.</li></ul></div>';
    if (me.err) h += '<div class="pp-err" role="alert"><span class="t">' + esc(me.err.message) + '</span></div>';
    h += '<div class="pp-foot"><button type="button" class="pp-btn pri" data-pp="hand"' + (me.busy ? ' disabled' : '') + '>' + (me.busy ? 'Sending…' : (side === 'studio' ? 'Send to ' + first(ow.name) + ' to agree' : 'Send to them to accept')) + '</button><button type="button" class="pp-btn" data-pp="back">Cancel</button></div>';
    h += '<p class="pp-faint">' + esc(side === 'studio' ? 'When ' + first(ow.name) + ' starts it from their own account, only the new owner has to accept.' : 'Nothing changes until the new owner accepts.') + ' Someone who already owns a business here can’t own a second one yet: add them as Co-owner instead.</p></div>';
    me.host.innerHTML = h; me.wire();
    var f = me.host.querySelector('#pp-to'); if (f) f.focus();
  };
  Sheet.prototype.say = function (msg, bad) { if (window.ddsToast) window.ddsToast(msg, bad ? 'err' : 'ok'); };
  Sheet.prototype.changed = function () { if (typeof this.o.onChanged === 'function') this.o.onChanged(this.d); };
  Sheet.prototype.to = function (view) { this.view = view; this.err = null; this.busy = false; this.draw(); var t = this.host.querySelector('#pp-title'); if (t && view === 'people') t.focus(); };
  Sheet.prototype.wire = function () {
    var me = this;
    [].forEach.call(me.host.querySelectorAll('[data-pp]'), function (b) {
      var what = b.getAttribute('data-pp');
      if (what === 'role') { b.addEventListener('change', function () { me.setRole(b.getAttribute('data-id'), b.value, b); }); return; }
      b.addEventListener('click', function (e) {
        e.preventDefault();
        if (what === 'close') return me.o.close && me.o.close();
        if (what === 'retry') return me.load();
        if (what === 'invite') return me.to('invite');
        if (what === 'transfer') return me.to('transfer');
        if (what === 'back') return me.to('people');
        if (what === 'send') return me.invite();
        if (what === 'hand') return me.hand();
        if (what === 'stop') return me.stop(b);
        if (what === 'resend') return me.resend(b.getAttribute('data-email'), b);
        if (what === 'restore') return me.restore(b.getAttribute('data-email'), b.getAttribute('data-role'), b);
        if (what === 'remove') return me.remove(b.getAttribute('data-id'));
        if (what === 'show') { me.to('people'); var row = me.host.querySelector('[data-seat="' + (me.showId || '') + '"]'); if (row) { row.scrollIntoView({ block: 'center' }); var sel = row.querySelector('select'); if (sel) sel.focus(); } return; }
        if (what === 'comeback') return me.restore(me.email, me.pick, b);
      });
    });
    var f = me.host.querySelector('#pp-email');
    if (f) f.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); me.invite(); } });
    [].forEach.call(me.host.querySelectorAll('input[name="pp-role"]'), function (r) { r.addEventListener('change', function () { me.pick = r.value; }); });
  };
  Sheet.prototype.invite = function () {
    var me = this, f = me.host.querySelector('#pp-email');
    me.email = String(f && f.value || '').trim();
    if (!me.email) { me.err = { message: 'Type their email first.' }; return me.draw(); }
    me.busy = true; me.err = null; me.draw();
    return me.reqFresh('/portal/members', 'POST', { email: me.email, role: me.pick }).then(function (r) {
      me.busy = false;
      if (r.cancelled) return me.draw();
      var b = r.body || {};
      if (r.ok) { me.say((b.data && b.data.message) || 'Invited.'); me.email = ''; me.view = 'people'; me.changed(); return me.load(); }
      if (b.error === 'already_member') { me.showId = b.member && b.member.id; me.err = { message: b.message, action: 'show', label: 'Show me' }; }
      else if (b.error === 'was_removed') { me.err = { message: (b.member ? b.member.email : 'They') + ' were removed earlier. Bring them back as ' + roleName(me.pick) + '?', action: 'comeback', label: 'Bring them back' }; }
      else me.err = { message: b.message || 'That didn’t send. Try again.' };
      me.draw();
    });
  };
  Sheet.prototype.restore = function (email, role, btn) {
    var me = this; if (btn) btn.disabled = true;
    return me.reqFresh('/portal/members', 'POST', { email: email, role: role, restore: true }).then(function (r) {
      if (r.cancelled) { if (btn) btn.disabled = false; return; }
      if (r.ok) { me.say(email + ' is back as ' + roleName(role) + '.'); me.email = ''; me.view = 'people'; me.changed(); return me.load(); }
      if (btn) btn.disabled = false; me.say((r.body && r.body.message) || 'That didn’t work. Try again.', true);
    });
  };
  Sheet.prototype.resend = function (email, btn) {
    var me = this; if (btn) btn.disabled = true;
    return me.req('/portal/members', 'POST', { email: email, resend: true }).then(function (r) {
      if (btn) btn.disabled = false;
      me.say(r.ok ? ((r.body.data && r.body.data.message) || 'Sent again.') : ((r.body && r.body.message) || 'That didn’t send. Try again.'), !r.ok);
    });
  };
  Sheet.prototype.setRole = function (id, role, sel) {
    var me = this, seat = (me.d.data || []).filter(function (m) { return m.id === id; })[0], was = seat ? seat.role : '';
    sel.disabled = true;
    return me.reqFresh('/portal/members/' + encodeURIComponent(id) + '/role', 'POST', { role: role }).then(function (r) {
      sel.disabled = false;
      if (r.cancelled) { sel.value = was; return; }
      if (r.ok) { if (seat) { seat.role = role; seat.role_words = roleName(role); } me.say((r.body.data && r.body.data.message) || 'Changed.'); me.changed(); return; }
      sel.value = was; me.say((r.body && r.body.message) || 'That didn’t save. Try again.', true);
    });
  };
  // the two-press remove: the first press arms it, a second within a few seconds removes
  Sheet.prototype.remove = function (id) {
    var me = this;
    if (me.armed !== id) { me.armed = id; me.draw(); var b = me.host.querySelector('[data-pp="remove"][data-id="' + id + '"]'); if (b) b.focus(); clearTimeout(me.armT); me.armT = setTimeout(function () { if (me.armed === id) { me.armed = ''; if (me.view === 'people') me.draw(); } }, 5000); return; }
    me.armed = '';
    return me.req('/portal/members/' + encodeURIComponent(id) + '/revoke', 'POST', {}).then(function (r) {
      if (r.ok) { me.say('Removed. They can’t sign in to this site any more.'); me.changed(); return me.load(); }
      me.say((r.body && r.body.message) || 'That didn’t work. Try again.', true); me.draw();
    });
  };
  Sheet.prototype.hand = function () {
    var me = this, f = me.host.querySelector('#pp-to'), k = me.host.querySelector('#pp-keep');
    me.toEmail = String(f && f.value || '').trim(); me.keep = !!(k && k.checked);
    if (!me.toEmail) { me.err = { message: 'Type the new owner’s email first.' }; return me.draw(); }
    me.busy = true; me.err = null; me.draw();
    return me.reqFresh('/portal/transfer', 'POST', { email: me.toEmail, keep_owner: me.keep }).then(function (r) {
      me.busy = false;
      if (r.cancelled) return me.draw();
      if (r.ok) { me.say((r.body.data && r.body.data.message) || 'Sent.'); me.toEmail = ''; me.view = 'people'; me.changed(); return me.load(); }
      me.err = { message: (r.body && r.body.message) || 'That didn’t send. Try again.' }; me.draw();
    });
  };
  Sheet.prototype.stop = function (btn) {
    var me = this; btn.disabled = true;
    return me.req('/portal/transfer/cancel', 'POST', {}).then(function (r) {
      if (r.ok) { me.say((r.body.data && r.body.data.message) || 'Stopped.'); me.changed(); return me.load(); }
      btn.disabled = false; me.say((r.body && r.body.message) || 'That didn’t work. Try again.', true);
    });
  };

  // ── the two ways in ──
  var dlg = null, opener = null;
  function closeDialog() { if (dlg && dlg.open) dlg.close(); }
  window.ddsPeople = {
    /** The People sheet over the page (the Sites page): o = { siteName, address, api, onChanged, view } */
    open: function (o) {
      style();
      if (!dlg) {
        dlg = document.createElement('dialog'); dlg.className = 'pp-dlg'; dlg.id = 'dds-people'; dlg.setAttribute('aria-labelledby', 'pp-title');
        document.body.appendChild(dlg);
        dlg.addEventListener('close', function () { if (opener && opener.focus) opener.focus(); });
        dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDialog(); });   // a press on the backdrop closes it
      }
      opener = document.activeElement;
      var sheet = new Sheet(dlg, Object.assign({}, o, { dialog: true, close: closeDialog }));
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      return sheet.load().then(function () { if (o.view && o.view !== 'people' && sheet.d) sheet.to(o.view); var t = dlg.querySelector('#pp-title'); if (t) t.focus(); return sheet; });
    },
    /** The People sheet drawn in place (the Sharing page): o = { siteName, api, onChanged } */
    mount: function (host, o) {
      style();
      host.classList.add('pp-inline');
      var sheet = new Sheet(host, Object.assign({}, o, { dialog: false }));
      return sheet.load().then(function () { return sheet; });
    },
    roles: ROLES,
    close: closeDialog,
  };
})();
