/* ── "+ Create": log a call, start a deal, send an invoice, add a to-do — from
   any page (sales list item 70, the bold redesign, Nov 2026) ─────────────────
   Timed against Salesforce, every one of these started by finding and opening
   the customer first; Salesforce has one global "Log a Call". shell.js draws
   the button (top of the sidebar) and the + (middle of the phone bar), loads
   this file on idle, and calls window.ddsCreate.open(kind, opener): no kind
   opens the menu, a kind opens that form. "#create:<kind>" in any link does
   the same. You pick WHO inside the form — never "open their record first".

   Everything rides routes the pages already use, nothing new on the server:
     GET  /sales/deals?limit=200 · /sales/contacts · /sales/stages
     POST /sales/contacts (dedupes by email) · /sales/deals
     POST /sales/deals/:id/activity · /sales/deals/:id/invoice · /sales/deals/:id/tasks
     PATCH /sales/deals/:id (the next step)
   A call, an invoice and a to-do all live on a deal. Picking a person who has
   no deal says so and starts one for them ("<name> — project", the same deal
   Contacts' "→ New deal" makes) — on the button, never silently. */
(function () {
  'use strict';
  if (window.ddsCreate) return;

  /* create-pure:start — no DOM; tests/presence/create_kit_test.mjs runs this exact text */
  var CR_OPEN = ['lead', 'qualified', 'proposal', 'contract'];
  function crPad(n) { return (n < 10 ? '0' : '') + n; }
  function crYmd(d) { return d.getFullYear() + '-' + crPad(d.getMonth() + 1) + '-' + crPad(d.getDate()); }
  // a due date from a chip, in the studio's own (the browser's) calendar — never UTC
  function crDue(choice, now) {
    var d = new Date(now == null ? Date.now() : now);
    d.setHours(12, 0, 0, 0);
    var add = function (n) { d.setDate(d.getDate() + n); return crYmd(d); };
    switch (String(choice)) {
      case 'receipt': case 'today': return add(0);
      case 'tomorrow': return add(1);
      case '7': return add(7);
      case '14': return add(14);
      case '30': return add(30);
      case 'friday': { var f = (5 - d.getDay() + 7) % 7; return add(f === 0 ? 7 : f); }   // the coming Friday (a week on, on a Friday)
      case 'nextweek': { var m = (1 - d.getDay() + 7) % 7; return add(m === 0 ? 7 : m); } // next Monday
      default: return '';
    }
  }
  // "$1,200.50" → 120050; "5k" or "$2.5K" → thousands (item 97: "5k" was dropped and the deal
  // saved with no value); nothing usable → 0
  function crCents(v) {
    var s = String(v == null ? '' : v).replace(/[$\s,]/g, '');
    var k = /^(\d+(?:\.\d+)?)k$/i.exec(s);
    if (k) return Math.round(Number(k[1]) * 100000);
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return 0;
    return Math.round(Number(s) * 100);
  }
  function crMoney(c) {
    var n = (Number(c) || 0) / 100;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  // How the call went → the note's first words (a call needs no note of its own)
  function crCallBody(outcome, notes) {
    var n = String(notes || '').trim();
    var lead = outcome === 'voicemail' ? 'Left a voicemail.' : outcome === 'noanswer' ? 'No answer.' : '';
    return lead ? (n ? lead + ' ' + n : lead) : n;
  }
  // One list of who you can pick: every deal that isn't lost (its person's name
  // first), then people who have no deal yet. Lost deals are history.
  function crCandidates(deals, contacts) {
    var byId = {};
    (contacts || []).forEach(function (c) { if (c && c.id) byId[c.id] = c; });
    var withDeal = {};
    var out = [];
    (deals || []).forEach(function (d) {
      if (!d || !d.id || d.stage === 'lost') return;
      var c = d.contact_id ? byId[d.contact_id] : null;
      if (c) withDeal[c.id] = true;
      out.push({ kind: 'deal', id: d.id, deal_id: d.id, title: String(d.title || 'Deal'), stage: String(d.stage || ''),
        open: CR_OPEN.indexOf(d.stage) >= 0, value_cents: Number(d.expected_value_cents) || 0,
        name: c ? String(c.name || c.email || '') : '', company: c ? String(c.company || '') : '', email: c ? String(c.email || '') : '',
        next_step: d.next_step || '', next_step_at: d.next_step_at || '', last_contacted_at: d.last_contacted_at || '', updated_at: d.updated_at || '' });
    });
    (contacts || []).forEach(function (c) {
      if (!c || !c.id || withDeal[c.id]) return;
      out.push({ kind: 'contact', id: c.id, deal_id: '', title: '', stage: '', open: false, value_cents: 0,
        name: String(c.name || c.email || 'Someone'), pname: String(c.name || ''), company: String(c.company || ''), email: String(c.email || ''),
        next_step: '', next_step_at: '', last_contacted_at: '', updated_at: c.updated_at || '' });
    });
    return out;
  }
  function crMatch(c, q) {
    var s = String(q || '').trim().toLowerCase();
    if (!s) return true;
    return [c.name, c.company, c.email, c.title].some(function (v) { return String(v || '').toLowerCase().indexOf(s) >= 0; });
  }
  // With nothing typed: open deals, the ones with a next step due soonest first
  // (overdue at the top), then the most recently touched.
  function crSuggest(cands, limit) {
    var open = (cands || []).filter(function (c) { return c.kind === 'deal' && c.open; });
    open.sort(function (a, b) {
      if (a.next_step_at && b.next_step_at) return a.next_step_at < b.next_step_at ? -1 : a.next_step_at > b.next_step_at ? 1 : 0;
      if (a.next_step_at) return -1;
      if (b.next_step_at) return 1;
      return String(b.updated_at) < String(a.updated_at) ? -1 : String(b.updated_at) > String(a.updated_at) ? 1 : 0;
    });
    return open.slice(0, limit || 5);
  }
  // The deal a person with no deal gets: the same title Contacts' "→ New deal" uses
  function crNewDealTitle(c) { return String((c && (c.pname || c.company || c.email)) || 'New') + ' — project'; }
  // A person picked as "no deal yet" may have one past the first 100 read: use
  // their newest open deal, else their newest won one; lost deals are history.
  function crPickDeal(deals) {
    var list = (deals || []).filter(function (d) { return d && d.id && d.stage !== 'lost'; });
    var open = list.filter(function (d) { return CR_OPEN.indexOf(d.stage) >= 0; });
    return (open[0] || list[0] || null);
  }
  // Fold rows a search found into what's already loaded (by id, newest wins)
  function crMerge(have, more) {
    var out = (have || []).slice(), at = {};
    out.forEach(function (x, i) { if (x && x.id) at[x.id] = i; });
    (more || []).forEach(function (x) { if (!x || !x.id) return; if (at[x.id] != null) out[at[x.id]] = x; else { at[x.id] = out.length; out.push(x); } });
    return out;
  }
  // What the main button says, so starting a deal is never a surprise
  function crGoLabel(kind, cand) {
    var needsDeal = !!(cand && cand.kind === 'contact');
    // sales item 85: a call or a to-do for someone with no deal stays on them; an invoice still needs a deal
    if (kind === 'call') return 'Log call';
    if (kind === 'invoice') return needsDeal ? 'Start a deal and send' : 'Send invoice';
    if (kind === 'todo') return 'Add to-do';
    if (kind === 'proposal') return 'Open the proposal';
    if (kind === 'deal') return 'Add deal';
    if (kind === 'project') return 'Create project';
    return 'Save';
  }
  /* create-pure:end */

  var ITEMS = [
    { kind: 'call', icon: 'phone', label: 'Log a call', sub: 'Pick who, jot what you said', key: 'l' },
    { kind: 'deal', icon: 'pipeline', label: 'New deal', sub: 'Name, value, who — it lands on the board', key: 'd' },
    { kind: 'invoice', icon: 'receipt', label: 'Send an invoice', sub: 'Who, how much — they get a Pay button', key: 'i' },
    { kind: 'proposal', icon: 'doc', label: 'Send a proposal', sub: 'Pick the deal; it opens ready to fill', key: 'p' },
    { kind: 'customer', icon: 'customers', label: 'Add a customer', sub: 'Their workspace and sign-in', key: 'c' },
    { kind: 'todo', icon: 'check', label: 'Add a to-do', sub: 'For you, with a date', key: 't' },
    // sales item 91: Create knew sales but not projects or websites
    { kind: 'project', icon: 'folder', label: 'New project', sub: 'A checklist for a customer’s work', key: 'j' },
    { kind: 'site', icon: 'globe', label: 'New site', sub: 'A client’s website, built in private', key: 's' },
    { kind: 'update', icon: 'megaphone', label: 'Send an update', sub: 'One email to a list of people', key: 'u' },
  ];
  var LINKS = { customer: '/agency.html#add', update: '/broadcasts.html', site: '/sites.html#new' };
  // Sales item 91: inside a client, Create is for that client. CLIENT = { site_id, name } while a
  // studio is inside one (shell.js hands it over on each open). The menu offers what can be made
  // for them, each form opens with them already picked, every read and write goes to the studio's
  // own book (no client in the request), and what was made opens on their record, inside the client.
  var CLIENT = null;
  var CLIENT_KINDS = ['call', 'invoice', 'proposal', 'todo', 'project', 'deal'];
  var CLIENT_SUBS = { call: 'With them — jot what you said', invoice: 'On their deal; they get a Pay button', proposal: 'Opens on their deal, ready to fill', todo: 'For them, with a date', project: 'A checklist for their work', deal: 'Another piece of work with them' };
  var STAGE = { lead: 'New lead', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' };
  var PATHS = {
    phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
    pipeline: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="9.5" y="4" width="5" height="10" rx="1"/><rect x="16" y="4" width="5" height="13" rx="1"/>',
    receipt: '<path d="M5 3h14v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    doc: '<path d="M6 3h8l5 5v13H6z"/><path d="M9 13h6M9 17h6"/>',
    customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5A5 5 0 0 1 21.5 20"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  var svg = function (k) { return '<svg class="cr-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (PATHS[k] || '') + '</svg>'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var initials = function (s) { return String(s || '').split(/[\s—–-]+/).filter(function (w) { return /^[A-Za-z0-9]/.test(w); }).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '•'; };
  // inside a client the studio's book is asked without the client (opts.scope ''), as crm.html's apiAg does
  var api = function (path, opts) { return window.ddsApi(path, CLIENT ? Object.assign({ scope: '' }, opts || {}) : opts); };
  // who the client is on the studio's book: their deal, their person, their customer record (asked WITH the client)
  var WHO_IS = {};
  function clientIdentity() {
    if (!CLIENT) return Promise.resolve(null);
    var id = CLIENT.site_id;
    if (!WHO_IS[id]) WHO_IS[id] = window.ddsApi('/crm/record?client=' + encodeURIComponent(id)).then(function (r) {
      var d = r && r.ok && r.body && r.body.data && r.body.data.identity;
      if (!d) { delete WHO_IS[id]; return null; }
      return d;
    }, function () { delete WHO_IS[id]; return null; });
    return WHO_IS[id];
  }
  // where "Open" goes after making something: their record inside the client, else the studio's page
  function hrefFor(dealId, tab, contactId) {
    if (CLIENT) return '/crm.html?client=' + encodeURIComponent(CLIENT.site_id) + (dealId ? '&deal=' + encodeURIComponent(dealId) : '') + (tab ? '&tab=' + tab : '');
    return dealId ? '/crm.html?deal=' + encodeURIComponent(dealId) + (tab ? '&tab=' + tab : '') : '/crm.html?contact=' + encodeURIComponent(contactId);
  }
  var toast = function (m, k, a) { return window.ddsToast ? window.ddsToast(m, k, a) : null; };
  var phone = function () { return !!(window.matchMedia && window.matchMedia('(max-width:760.98px)').matches); };
  var rowsOf = function (r) { var d = r && r.ok && r.body && r.body.data; return Array.isArray(d) ? d : []; };   // a list, or nothing
  var nowTodayYmd = function () { return crYmd(new Date()); };

  // ── the people/deals behind the pickers: read on open, kept 30 s ──
  var DATA = null, DATA_AT = 0, LOADING = null;
  function load(force) {
    if (!force && DATA && Date.now() - DATA_AT < 30000) return Promise.resolve(DATA);
    if (LOADING) return LOADING;
    LOADING = Promise.all([api('/sales/deals?limit=100'), api('/sales/contacts?limit=100'), api('/sales/stages')]).then(function (r) {
      LOADING = null;
      if (!r[0].ok && !r[1].ok) return Promise.reject(r[0].status === 403 || r[1].status === 403 ? 'plan' : 'read');
      var labels = (r[2].ok && r[2].body && r[2].body.data && r[2].body.data.labels) || {};
      Object.keys(labels).forEach(function (k) { if (labels[k]) STAGE[k] = labels[k]; });
      var deals = rowsOf(r[0]), contacts = rowsOf(r[1]);
      DATA = { deals: deals, contacts: contacts, cands: crCandidates(deals, contacts) }; DATA_AT = Date.now();
      return DATA;
    }, function (e) { LOADING = null; return Promise.reject(e); });
    return LOADING;
  }
  // The first read holds the newest 100 people and deals; past that, a typed
  // name also asks the server (the same searches Contacts and Pipeline run).
  var SEARCH_T = 0, SEARCH_TOK = 0, SEARCHED = {};
  function searchServer(q) {
    clearTimeout(SEARCH_T);
    var key = String(q || '').trim().toLowerCase();
    if (key.length < 2 || SEARCHED[key] || !DATA) return;
    SEARCH_T = setTimeout(function () {
      var tok = ++SEARCH_TOK, enc = encodeURIComponent(key);
      Promise.all([api('/sales/contacts?limit=20&q=' + enc), api('/sales/deals?limit=20&q=' + enc)]).then(function (r) {
        if (tok !== SEARCH_TOK || !DATA) return;
        SEARCHED[key] = 1;
        var c = rowsOf(r[0]), d = rowsOf(r[1]);
        if (!c.length && !d.length) return;
        DATA.contacts = crMerge(DATA.contacts, c); DATA.deals = crMerge(DATA.deals, d);
        DATA.cands = crCandidates(DATA.deals, DATA.contacts);
        if (S && dlg && dlg.open && S.q.trim().toLowerCase() === key) paintWho();
      }, function () { /* the loaded list still answers */ });
    }, 220);
  }

  // ── one dialog for everything: the menu, then a form ──
  var dlg = null, opener = null, mode = '';
  var KEYS = false;   // opened from the keyboard: the menu's first job takes focus (a tap leaves no ring on it)
  function ensure() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'dds-cr'; dlg.className = 'dds-cr';
    dlg.setAttribute('aria-labelledby', 'dds-cr-title');
    document.body.appendChild(dlg);
    // a click on the backdrop (the dialog box itself, outside its content) closes it
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    dlg.addEventListener('close', function () { restore(); });
    return dlg;
  }
  function show(cls) {
    ensure();
    dlg.className = 'dds-cr ' + cls + (phone() ? ' sheet' : '');
    if (!dlg.open) { try { dlg.showModal(); } catch (_) { dlg.setAttribute('open', ''); } }
    document.documentElement.classList.add('dds-cr-on');
  }
  function close() {
    if (dlg && dlg.open) { try { dlg.close(); } catch (_) { dlg.removeAttribute('open'); restore(); } }
  }
  function restore() {
    document.documentElement.classList.remove('dds-cr-on');
    if (opener && opener.focus && document.contains(opener)) { try { opener.focus(); } catch (_) { /* */ } }
    if (opener) opener.setAttribute && opener.setAttribute('aria-expanded', 'false');
  }

  // ── the menu ──
  function openMenu() {
    mode = 'menu';
    show('menu');
    var tiles = phone();
    var list = CLIENT ? CLIENT_KINDS.map(function (k) { return ITEMS.filter(function (x) { return x.kind === k; })[0]; }) : ITEMS;
    dlg.innerHTML =
      '<div class="cr-menu' + (tiles ? ' tiles' : '') + '" tabindex="-1">' +
        (tiles ? '<div class="cr-grab" aria-hidden="true"></div>' : '') +
        (CLIENT ? '<div class="cr-for"><span class="cr-av" aria-hidden="true">' + esc(initials(CLIENT.name)) + '</span><span class="cr-ot"><b id="dds-cr-title">Create for ' + esc(CLIENT.name) + '</b><small>Each one opens with them already picked</small></span></div>'
          : '<h2 id="dds-cr-title" class="cr-h' + (tiles ? '' : ' sr-only') + '">Create</h2>') +
        '<div class="cr-items" role="menu" aria-labelledby="dds-cr-title">' +
          list.map(function (it) {
            return '<button type="button" role="menuitem" class="cr-item" data-kind="' + it.kind + '">' +
              '<span class="cr-tile">' + svg(it.icon) + '</span>' +
              '<span class="cr-tx"><b>' + esc(it.label) + '</b>' + (tiles ? '' : '<small>' + esc(CLIENT ? CLIENT_SUBS[it.kind] : it.sub) + '</small>') + '</span>' +
              (tiles ? '' : '<kbd aria-hidden="true">' + it.key.toUpperCase() + '</kbd>') + '</button>';
          }).join('') +
        '</div>' + (CLIENT ? '<p class="cr-else">Something for someone else? Back to studio first.</p>' : '') + '</div>';
    if (!tiles) place();
    var items = [].slice.call(dlg.querySelectorAll('.cr-item'));
    items.forEach(function (b) { b.addEventListener('click', function () { pick(b.getAttribute('data-kind')); }); });
    dlg.querySelector('.cr-items').addEventListener('keydown', function (e) {
      var i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); var n = items.length; items[(i + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n].focus(); return; }
      if (e.key === 'Home') { e.preventDefault(); items[0].focus(); return; }
      if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); return; }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        var it = list.filter(function (x) { return x.key === e.key.toLowerCase(); })[0];
        if (it) { e.preventDefault(); pick(it.kind); }
      }
    });
    setTimeout(function () { var m = dlg.querySelector('.cr-menu'); if (KEYS && items[0]) items[0].focus(); else if (m) m.focus(); }, 0);
    load().catch(function () { /* the form says so when it opens */ });   // warm the pickers while you choose
  }
  // beside the sidebar, level with its Create button — a menu, not a screen-wide dialog
  function place() {
    var r = opener && opener.getBoundingClientRect ? opener.getBoundingClientRect() : null;
    var side = opener && opener.closest ? opener.closest('#dds-shell') : null;
    var edge = side ? side.getBoundingClientRect().right : (r ? r.right : 0);
    if (r && r.width) {
      dlg.style.left = Math.max(8, Math.min(window.innerWidth - 388, edge + 8)) + 'px';
      dlg.style.top = Math.max(8, Math.min(window.innerHeight - dlg.offsetHeight - 8, r.top)) + 'px';
    } else { dlg.style.left = ''; dlg.style.top = ''; }
  }
  function pick(kind) {
    if (LINKS[kind]) { close(); location.assign(LINKS[kind]); return; }
    openForm(kind);
  }

  // ── the forms ──
  var S = null;   // the open form's state
  var TITLES = {
    call: ['Log a call', 'From anywhere — no need to open their record first'],
    deal: ['New deal', 'It starts as a new lead on your board'],
    invoice: ['Send an invoice', 'They get an email with a Pay button — card or bank'],
    todo: ['Add a to-do', 'It shows in My to-dos on Home'],
    proposal: ['Send a proposal', 'Pick the deal; its proposal opens ready to fill'],
    project: ['New project', 'A checklist for the work you do for a customer'],
  };
  var WHO_LABEL = { call: 'Who did you talk to?', invoice: 'Who is it for?', todo: 'Which deal is it for?', proposal: 'Which deal?' };
  function openForm(kind, preset) {
    if (!TITLES[kind]) kind = 'call';
    mode = kind;
    S = { kind: kind, pick: null, q: '', active: -1, outcome: 'talked', due: kind === 'invoice' ? '14' : kind === 'todo' ? 'tomorrow' : '', nextDue: 'tomorrow', busy: false, someoneNew: false, tpl: 'website' };
    show('form');
    dlg.style.left = ''; dlg.style.top = '';
    var t = TITLES[kind];
    dlg.innerHTML =
      '<form class="cr-form" novalidate>' +
        (phone() ? '<div class="cr-grab" aria-hidden="true"></div>' : '') +
        '<header class="cr-head"><div><h2 id="dds-cr-title">' + esc(t[0]) + '</h2><p>' + esc(t[1]) + '</p></div>' +
          '<button type="button" class="cr-x" aria-label="Close">' + svg('x') + '</button></header>' +
        '<div class="cr-body">' + bodyHtml(kind) + '</div>' +
        '<p class="cr-err" role="alert" hidden></p>' +
        '<footer class="cr-foot"><span class="cr-note" id="cr-note"></span>' +
          '<button type="button" class="cr-cancel">Cancel</button>' +
          '<button type="submit" class="cr-go">' + esc(crGoLabel(kind, null)) + '</button></footer>' +
      '</form>';
    var f = dlg.querySelector('form');
    f.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    dlg.querySelector('.cr-x').addEventListener('click', close);
    dlg.querySelector('.cr-cancel').addEventListener('click', close);
    wireChips(f);
    if (kind === 'deal') wireDeal(f);
    if (WHO_LABEL[kind] || kind === 'deal') wireWho(f);
    if (kind === 'invoice') wireInvoice(f);
    if (kind === 'project') wireProject(f);
    var first = f.querySelector(kind === 'deal' ? '#cr-title' : kind === 'project' ? '#cr-pjname' : '#cr-who');
    setTimeout(function () { if (first) first.focus(); }, 0);
    if (WHO_LABEL[kind] || kind === 'deal') {
      if (DATA) paintWho(); else loadWho();
      load().then(function () { paintWho(); }, function () { /* loadWho says it */ });
    }
    note();
    if (preset && preset.deal_id && WHO_LABEL[kind]) presetPick(String(preset.deal_id));
    else if (CLIENT && (WHO_LABEL[kind] || kind === 'deal')) presetClient();
  }
  // sales item 91: inside a client the form starts on them: their deal, else their person
  function presetClient() {
    var mine = S;
    clientIdentity().then(function (who) {
      if (!who || S !== mine || !dlg || !dlg.open || S.pick) return;
      if (who.deal_id && S.kind !== 'deal') return presetPick(String(who.deal_id));
      if (!who.contact_id || S.kind === 'proposal') return;
      return api('/sales/contacts/' + encodeURIComponent(who.contact_id)).then(function (r) {
        var d = r.ok && r.body && r.body.data, c = d && (d.contact || d);
        if (!c || !c.id || S !== mine || !dlg.open || S.pick) return;
        var cand = { kind: 'contact', id: c.id, deal_id: '', title: '', stage: '', open: false, value_cents: 0, name: String(c.name || c.email || 'Someone'), pname: String(c.name || ''), company: String(c.company || ''), email: String(c.email || '') };
        SHOWN = [cand]; choose(0);
      });
    }, function () { /* the search still works */ });
  }
  // a page that already knows the deal (the Customers preview) starts the form on
  // it: from the first read, else that one deal by id (it may be past the first 200)
  function presetPick(id) {
    var mine = S;
    load().then(function () {
      var hit = DATA && DATA.cands.filter(function (c) { return c.kind === 'deal' && c.deal_id === id; })[0];
      if (hit) return hit;
      return api('/sales/deals/' + encodeURIComponent(id)).then(function (r) {
        var d = r.ok && r.body && r.body.data && r.body.data.deal; if (!d || !d.id) return null;
        var p = r.body.data.contact;
        return crCandidates([d], p && p.id ? [p] : [])[0] || null;
      });
    }).then(function (c) {
      if (!c || S !== mine || !dlg || !dlg.open || S.pick) return;   // closed, reopened or already picked meanwhile
      if (S.kind === 'proposal' && !c.open) return;
      SHOWN = [c]; choose(0);
    }, function () { /* the search still works */ });
  }
  function chips(name, label, opts, on) {
    return '<div class="cr-chips" role="group" aria-label="' + esc(label) + '" data-chips="' + name + '">' +
      opts.map(function (o) { return '<button type="button" class="cr-chip' + (o[0] === on ? ' on' : '') + '" aria-pressed="' + (o[0] === on ? 'true' : 'false') + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>';
  }
  function whoHtml(kind) {
    return '<label class="cr-l" for="cr-who">' + esc(WHO_LABEL[kind]) + '</label>' +
      '<div class="cr-who" id="cr-whobox">' +
        '<input id="cr-who" class="cr-in" type="search" autocomplete="off" spellcheck="false" placeholder="Type a name, business or deal…" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="cr-who-list">' +
        '<div class="cr-hint" id="cr-who-hint">Loading…</div>' +
        '<div id="cr-who-list" class="cr-list" role="listbox" aria-label="People and deals"></div>' +
      '</div>' +
      '<div class="cr-picked" id="cr-picked" hidden></div>';
  }
  function bodyHtml(kind) {
    if (kind === 'call') return whoHtml(kind) +
      '<span class="cr-l">How did it go?</span>' + chips('outcome', 'How did it go?', [['talked', 'We talked'], ['voicemail', 'Left a voicemail'], ['noanswer', 'No answer']], 'talked') +
      '<label class="cr-l" for="cr-notes">What did you talk about? <span class="cr-opt">optional</span></label>' +
      '<textarea id="cr-notes" class="cr-in cr-ta" rows="3" maxlength="2000" placeholder="Agreed the stacked logo; they’ll confirm colors by Friday…"></textarea>' +
      '<label class="cr-l" for="cr-next">Next step <span class="cr-opt">optional</span></label>' +
      '<input id="cr-next" class="cr-in" maxlength="200" placeholder="e.g. Send the revised logo">' +
      chips('nextDue', 'When is the next step due?', [['tomorrow', 'Tomorrow'], ['friday', 'Friday'], ['nextweek', 'Next week']], 'tomorrow') +
      '<label class="cr-l" for="cr-when">When was the call?</label>' +
      '<input id="cr-when" class="cr-in cr-date" type="date" value="' + nowTodayYmd() + '" max="' + nowTodayYmd() + '">';
    if (kind === 'deal') return '<label class="cr-l" for="cr-title">Deal name</label>' +
      '<input id="cr-title" class="cr-in" maxlength="200" required placeholder="e.g. Blue Finch — online orders">' +
      '<label class="cr-l" for="cr-value">Value <span class="cr-opt">optional</span></label>' +
      '<input id="cr-value" class="cr-in cr-money" inputmode="decimal" placeholder="$2,500">' +
      '<span class="cr-l">Who is it with? <span class="cr-opt">optional</span></span>' +
      chips('dealWho', 'Who is it with?', [['existing', 'Someone you know'], ['new', 'Someone new']], 'existing') +
      '<div id="cr-existing">' + whoHtml('call').replace('Who did you talk to?', 'Pick them') + '</div>' +
      '<div id="cr-new" hidden><label class="cr-l" for="cr-pname">Their name</label><input id="cr-pname" class="cr-in" maxlength="120" placeholder="Jane Doe">' +
      '<label class="cr-l" for="cr-pemail">Their email <span class="cr-opt">optional</span></label><input id="cr-pemail" class="cr-in" type="email" maxlength="160" placeholder="name@business.com"></div>';
    if (kind === 'invoice') return whoHtml(kind) +
      '<label class="cr-l" for="cr-what">What for</label>' +
      '<input id="cr-what" class="cr-in" maxlength="200" placeholder="e.g. Website — 50% deposit">' +
      '<label class="cr-l" for="cr-amt">Amount</label>' +
      '<input id="cr-amt" class="cr-in cr-money" inputmode="decimal" required placeholder="$700">' +
      '<div class="cr-fill" id="cr-fill" hidden></div>' +
      '<span class="cr-l">Due</span>' + chips('due', 'When is it due?', [['receipt', 'On receipt'], ['7', '7 days'], ['14', '14 days'], ['30', '30 days']], '14') +
      '<div class="cr-preview" id="cr-preview" aria-live="polite"></div>';
    if (kind === 'todo') return '<label class="cr-l" for="cr-what">What needs doing?</label>' +
      '<input id="cr-what" class="cr-in" maxlength="200" required placeholder="e.g. Call about the homepage photos">' +
      '<span class="cr-l">Due</span>' + chips('due', 'When is it due?', [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['friday', 'Friday'], ['nextweek', 'Next week'], ['', 'No date']], 'tomorrow') +
      whoHtml(kind);
    if (kind === 'project') return '<label class="cr-l" for="cr-pjname">Project name</label>' +
      '<input id="cr-pjname" class="cr-in" maxlength="200" required placeholder="e.g. Blue Finch — website build">' +
      '<label class="cr-l" for="cr-cust">For</label>' +
      '<div class="cr-picked" id="cr-custcard" hidden></div>' +
      '<select id="cr-cust" class="cr-in"><option value="">Just my studio (internal)</option></select>' +
      '<p class="cr-sub" id="cr-custnote">A customer sees their project in their portal.</p>' +
      '<span class="cr-l">Start from</span>' + chips('tpl', 'Start from', [['website', 'Website build · a ready-made checklist'], ['', 'Empty']], 'website') +
      '<select id="cr-tpl" class="cr-in" aria-label="Your templates" hidden></select>' +
      '<label class="cr-l" for="cr-target">Target date <span class="cr-opt">optional</span></label>' +
      '<input id="cr-target" class="cr-in cr-date" type="date">';
    return whoHtml(kind);   // proposal: just the deal
  }
  // sales item 91: New project. The customer list is the studio's roster (the one projects.html's
  // own dialog reads); inside a client theirs is picked, shown as a card with Change.
  function wireProject(f) {
    var sel = f.querySelector('#cr-cust'), card = f.querySelector('#cr-custcard'), tpl = f.querySelector('#cr-tpl'), mine = S;
    var showCard = function (name) {
      card.innerHTML = '<span class="cr-av" aria-hidden="true">' + esc(initials(name)) + '</span><span class="cr-ot"><b>' + esc(name) + '</b><small>They’ll see it in their portal</small></span><button type="button" class="cr-change">Change</button>';
      card.hidden = false; sel.hidden = true; f.querySelector('#cr-custnote').hidden = true;
      card.querySelector('.cr-change').addEventListener('click', function () { card.hidden = true; sel.hidden = false; sel.focus(); });
    };
    Promise.all([api('/studio/customers'), clientIdentity()]).then(function (res) {
      if (S !== mine) return;
      var d = res[0].ok && res[0].body && res[0].body.data, rows = Array.isArray(d) ? d : (d && Array.isArray(d.customers) ? d.customers : []);
      rows = rows.filter(function (c) { return c && c.client_id; }).sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
      sel.innerHTML = '<option value="">Just my studio (internal)</option>' + rows.map(function (c) { return '<option value="' + esc(c.client_id) + '">' + esc(c.name || 'Customer') + '</option>'; }).join('');
      var who = res[1];
      if (who && who.client_id) {
        if (!rows.some(function (c) { return String(c.client_id) === String(who.client_id); })) sel.insertAdjacentHTML('beforeend', '<option value="' + esc(who.client_id) + '">' + esc(CLIENT.name) + '</option>');
        sel.value = who.client_id; showCard(CLIENT.name);
      }
    }, function () { /* internal stays the choice */ });
    api('/projects/templates').then(function (r) {
      var saved = r.ok && r.body && r.body.data && r.body.data.saved;
      if (S !== mine || !Array.isArray(saved) || !saved.length) return;
      tpl.innerHTML = '<option value="">Your templates…</option>' + saved.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + ' · ' + Number(t.steps || 0) + ' step' + (Number(t.steps) === 1 ? '' : 's') + '</option>'; }).join('');
      tpl.hidden = false;
      tpl.addEventListener('change', function () {   // a saved template takes over from the chips
        [].slice.call(f.querySelectorAll('[data-chips=tpl] .cr-chip')).forEach(function (x) { var on = !tpl.value && x.getAttribute('data-v') === S.tpl; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      });
    }, function () { /* the two built-in starts remain */ });
  }
  function wireChips(f) {
    [].slice.call(f.querySelectorAll('[data-chips]')).forEach(function (g) {
      var name = g.getAttribute('data-chips');
      g.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.cr-chip') : null; if (!b) return;
        [].slice.call(g.querySelectorAll('.cr-chip')).forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        var v = b.getAttribute('data-v');
        if (name === 'outcome') S.outcome = v;
        else if (name === 'nextDue') S.nextDue = v;
        else if (name === 'due') S.due = v;
        else if (name === 'tpl') { S.tpl = v; var ts = f.querySelector('#cr-tpl'); if (ts) ts.value = ''; }
        else if (name === 'dealWho') { S.someoneNew = v === 'new'; f.querySelector('#cr-existing').hidden = S.someoneNew; f.querySelector('#cr-new').hidden = !S.someoneNew; if (S.someoneNew) { var n = f.querySelector('#cr-pname'); if (n) n.focus(); } }
        if (S.kind === 'invoice') preview();
      });
    });
  }
  function wireDeal(f) {
    var v = f.querySelector('#cr-value');
    v.addEventListener('blur', function () { var c = crCents(v.value); if (c) v.value = crMoney(c); });
  }
  function wireInvoice(f) {
    var a = f.querySelector('#cr-amt'), w = f.querySelector('#cr-what');
    a.addEventListener('input', preview); w.addEventListener('input', preview);
    a.addEventListener('blur', function () { var c = crCents(a.value); if (c) a.value = crMoney(c); preview(); });
    f.querySelector('#cr-fill').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-amt]') : null; if (!b) return;
      a.value = crMoney(Number(b.getAttribute('data-amt'))); if (!w.value && b.getAttribute('data-what')) w.value = b.getAttribute('data-what'); preview();
    });
    preview();
  }

  // ── the who picker ──
  function wireWho(f) {
    var inp = f.querySelector('#cr-who'); if (!inp) return;
    inp.addEventListener('input', function () { S.q = inp.value; S.active = S.q.trim() ? 0 : -1; paintWho(); searchServer(S.q); });
    inp.addEventListener('keydown', function (e) {
      var opts = [].slice.call(f.querySelectorAll('#cr-who-list [role=option]'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!opts.length) return; S.active = S.active < 0 ? (e.key === 'ArrowDown' ? 0 : opts.length - 1) : (S.active + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length; mark(opts); return; }
      if (e.key === 'Enter') { e.preventDefault(); var o = opts[S.active]; if (o) choose(Number(o.getAttribute('data-i'))); }
    });
    f.querySelector('#cr-who-list').addEventListener('click', function (e) {
      var o = e.target.closest ? e.target.closest('[role=option]') : null; if (o) choose(Number(o.getAttribute('data-i')));
    });
    f.querySelector('#cr-picked').addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.cr-change')) { S.pick = null; S.q = ''; inp.value = ''; f.querySelector('#cr-picked').hidden = true; f.querySelector('#cr-whobox').hidden = false; paintWho(); note(); inp.focus(); }
    });
  }
  var SHOWN = [];
  function pool() {
    var all = (DATA && DATA.cands) || [];
    if (S.kind === 'proposal') return all.filter(function (c) { return c.kind === 'deal' && c.open; });
    if (S.kind === 'deal') {   // the person a new deal is with: people, not deals
      var seen = {}, out = [];
      (DATA ? DATA.contacts : []).forEach(function (c) { if (c && c.id && !seen[c.id]) { seen[c.id] = 1; out.push({ kind: 'contact', id: c.id, deal_id: '', name: String(c.name || c.email || 'Someone'), pname: String(c.name || ''), company: String(c.company || ''), email: String(c.email || ''), title: '', stage: '' }); } });
      return out;
    }
    return all;
  }
  // bug hunt A8: a failed read used to be painted once and then overwritten with
  // "Loading your people and deals…" by the next keystroke, for ever. The failure is
  // kept until a read works, and comes with Try again.
  var WHO_ERR = '';
  function loadWho() {
    WHO_ERR = ''; paintWho();
    load(true).then(function () { WHO_ERR = ''; paintWho(); }, function (why) {
      WHO_ERR = why === 'plan' ? 'Deals are part of your plan’s business tools — an upgrade adds them.' : 'We couldn’t load your people and deals just now.';
      paintWho();
    });
  }
  function paintWho(err) {
    var list = dlg && dlg.querySelector('#cr-who-list'); if (!list || !S) return;
    var hint = dlg.querySelector('#cr-who-hint');
    if (err) { hint.textContent = err; list.innerHTML = ''; return; }
    if (!DATA && WHO_ERR) {
      hint.innerHTML = esc(WHO_ERR) + (/plan/.test(WHO_ERR) ? '' : ' <button type="button" class="cr-retry">Try again</button>');
      list.innerHTML = '';
      var rb = hint.querySelector('.cr-retry'); if (rb) rb.addEventListener('click', function () { loadWho(); });
      return;
    }
    if (!DATA) { hint.textContent = 'Loading your people and deals…'; list.innerHTML = ''; return; }
    var q = S.q.trim();
    var all = pool();
    SHOWN = q ? all.filter(function (c) { return crMatch(c, q); }).slice(0, 8)
      : (S.kind === 'deal' ? all.slice(0, 5) : crSuggest(all, 5));
    if (!q && !SHOWN.length && S.kind !== 'deal') SHOWN = all.slice(0, 5);
    hint.textContent = q ? (SHOWN.length ? 'Matches' : 'No one matches “' + q + '”.' + (S.kind === 'proposal' ? ' A proposal needs an open deal.' : ''))
      : (S.kind === 'deal' ? 'People you know' : S.kind === 'call' ? 'Due a call, and recent' : 'Your open deals');
    if (S.active >= SHOWN.length) S.active = SHOWN.length ? 0 : -1;
    list.innerHTML = SHOWN.map(function (c, i) {
      var who = c.name ? c.name + (c.company ? ' · ' + c.company : '') : c.title;
      var sub = c.kind === 'contact' ? (c.email ? c.email + ' · ' : '') + (S.kind === 'deal' ? 'Contact' : 'No deal yet')
        : (c.name ? c.title + ' · ' : '') + (STAGE[c.stage] || c.stage) + (c.next_step && c.open ? ' · next: ' + c.next_step : '');
      return '<div role="option" class="cr-opt-row" id="cr-o-' + i + '" data-i="' + i + '" aria-selected="' + (i === S.active ? 'true' : 'false') + '">' +
        '<span class="cr-av" aria-hidden="true">' + esc(initials(c.name || c.title)) + '</span>' +
        '<span class="cr-ot"><b>' + esc(who) + '</b><small>' + esc(sub) + '</small></span></div>';
    }).join('');
    var inp = dlg.querySelector('#cr-who'); if (inp) inp.setAttribute('aria-activedescendant', S.active >= 0 && SHOWN.length ? 'cr-o-' + S.active : '');
  }
  function mark(opts) {
    opts.forEach(function (o, i) { o.setAttribute('aria-selected', i === S.active ? 'true' : 'false'); });
    var inp = dlg.querySelector('#cr-who'); if (inp) inp.setAttribute('aria-activedescendant', 'cr-o-' + S.active);
    if (opts[S.active] && opts[S.active].scrollIntoView) opts[S.active].scrollIntoView({ block: 'nearest' });
  }
  function choose(i) {
    var c = SHOWN[i]; if (!c) return;
    S.pick = c;
    dlg.querySelector('#cr-whobox').hidden = true; dlg.querySelector('#cr-picked').hidden = false;
    paintPicked();
    var next = dlg.querySelector(S.kind === 'call' ? '[data-chips=outcome] .cr-chip.on' : S.kind === 'invoice' ? '#cr-what' : '.cr-go');
    // a phone would raise its keyboard over the quick-fill buttons: focus stays on the card
    if (next && phone() && /^(INPUT|TEXTAREA)$/.test(next.tagName)) next = dlg.querySelector('#cr-picked .cr-change');
    if (next) next.focus();
    // "no deal yet" is only what the first 100 rows say: ask now, so the card
    // and the button show their real deal before anything is pressed
    if (c.kind === 'contact' && S.kind !== 'deal') lookDeal(c)['catch'](function () { /* ensureDeal asks again */ });
  }
  function paintPicked() {
    var c = S && S.pick, picked = dlg && dlg.querySelector('#cr-picked'); if (!c || !picked) return;
    var sub = c.kind === 'contact' ? (S.kind === 'deal' ? (c.email || 'Contact') : S.kind === 'invoice' ? 'No deal yet — one starts for them' : 'No deal yet — kept on them') : (c.name ? c.title + ' · ' : '') + (STAGE[c.stage] || c.stage);
    picked.innerHTML = '<span class="cr-av" aria-hidden="true">' + esc(initials(c.name || c.title)) + '</span>' +
      '<span class="cr-ot"><b>' + esc(c.name ? c.name + (c.company ? ' · ' + c.company : '') : c.title) + '</b><small>' + esc(sub) + '</small></span>' +
      '<button type="button" class="cr-change">Change</button>';
    var go = dlg.querySelector('.cr-go'); if (go && S.kind !== 'deal') go.textContent = crGoLabel(S.kind, c);
    if (S.kind === 'invoice') { fills(c); preview(); }
    note();
  }
  function fills(c) {
    var box = dlg.querySelector('#cr-fill'); if (!box) return;
    var v = c && c.kind === 'deal' ? c.value_cents : 0;
    if (!v) { box.hidden = true; box.innerHTML = ''; return; }
    var half = Math.round(v / 2);
    box.hidden = false;
    box.innerHTML = '<span class="cr-fl">Quick fill:</span>' +
      '<button type="button" class="cr-chip" data-amt="' + half + '" data-what="50% deposit">50% of the deal · ' + esc(crMoney(half)) + '</button>' +
      '<button type="button" class="cr-chip" data-amt="' + v + '" data-what="Full payment">Full · ' + esc(crMoney(v)) + '</button>';
  }
  function preview() {
    var box = dlg && dlg.querySelector('#cr-preview'); if (!box) return;
    var amt = crCents((dlg.querySelector('#cr-amt') || {}).value);
    var who = S.pick && S.pick.name ? S.pick.name : 'they';   // the email names the project; this names the person
    var due = crDue(S.due);
    var when = due ? new Date(due + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    box.innerHTML = '<span class="cr-pl">What ' + esc(who === 'they' ? 'they get' : who + ' gets') + '</span>' +
      '<b>' + esc((dlg.querySelector('#cr-what') || {}).value || 'Invoice') + ' — ' + (amt ? esc(crMoney(amt)) : '$—') + (when ? ' due ' + esc(S.due === 'receipt' ? 'on receipt' : when) : '') + '</b>' +
      '<span class="cr-paybtn" aria-hidden="true">Pay ' + (amt ? esc(crMoney(amt)) : '') + '</span>';
  }
  function note() {
    var n = dlg && dlg.querySelector('#cr-note'); if (!n || !S) return;
    var c = S.pick;
    var t = '';
    if (S.kind === 'call') t = c ? (c.kind === 'contact' ? 'Saved on ' + (c.name || 'them') + ', with no deal needed' : 'Saved on this deal') : 'Pick who you talked to';
    else if (S.kind === 'invoice') t = c ? (c.kind === 'contact' ? 'Starts a deal for ' + (c.name || 'them') + '; the invoice is saved on it' : 'Saved on this deal, under Invoices') : 'Pick who it’s for';
    else if (S.kind === 'todo') t = c ? 'Shows in your To-dos and on Home' : 'Pick who it’s for';
    else if (S.kind === 'proposal') t = c ? 'Opens the deal with a new proposal' : 'Pick an open deal';
    else if (S.kind === 'deal') t = 'Starts as a new lead';
    else if (S.kind === 'project') t = 'It opens on Projects when it’s made';
    n.textContent = t;
  }
  function failForm(msg) {
    var e = dlg && dlg.querySelector('.cr-err'); if (!e) { toast(msg, 'err'); return; }
    e.textContent = msg; e.hidden = false;
    // an open invoice for a different amount: say so, and offer a second one beside it
    if (S && S.offerSecond) {
      S.offerSecond = false;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'cr-second'; b.textContent = 'Send a second invoice';
      b.addEventListener('click', function () { submit(true); });
      e.appendChild(document.createTextNode(' ')); e.appendChild(b);
    }
    S.busy = false; var go = dlg.querySelector('.cr-go'); if (go) go.disabled = false;
  }

  // ── saving ──
  function msg(r, fallback) { return (r && r.body && (r.body.message || (r.body.error && typeof r.body.error === 'string' && r.body.error.length > 20 ? r.body.error : ''))) || fallback; }
  // the pick becomes that deal, so pressing again never starts a second
  function become(c, id, title, stage) {
    c.kind = 'deal'; c.deal_id = id; c.title = String(title || crNewDealTitle(c)); c.stage = stage || 'lead'; c.open = CR_OPEN.indexOf(c.stage) >= 0;
    if (S && S.pick === c) paintPicked();
    return id;
  }
  // a person shown as "no deal yet": their newest usable deal ('' when none)
  function lookDeal(c) {
    if (!c._look) c._look = api('/sales/contacts/' + encodeURIComponent(c.id)).then(function (r0) {
      if (!r0.ok) { c._look = null; return Promise.reject(msg(r0, 'Couldn’t check their deals just now — please try again.')); }
      var have = crPickDeal(r0.body && r0.body.data && Array.isArray(r0.body.data.deals) ? r0.body.data.deals : []);
      if (have && c.kind === 'contact') become(c, have.id, have.title, have.stage);
      return c.kind === 'deal' ? c.deal_id : '';
    }, function () { c._look = null; return Promise.reject('Couldn’t check their deals just now — please try again.'); });
    return c._look;
  }
  // sales item 85: a call or to-do for a person. Their own deal, when they have one, still takes it
  // (as before); with none it is kept on them. A server without the person routes yet (404) or
  // before its database update (409) answers null, and the caller falls back to starting a deal.
  function onPerson(c, write, finish) {
    return lookDeal(c).then(function (have) {
      if (have) return Promise.reject({ useDeal: true });
      return write().then(function (r) {
        if (r.status === 404 || (r.status === 409 && r.body && r.body.error === 'needs_update')) return Promise.reject({ useDeal: true });
        if (!r.ok) return Promise.reject(msg(r, 'That didn’t save — please try again.'));
        DATA_AT = 0;
        finish(r);
      });
    });
  }
  function ensureDeal(c) {
    if (c.kind === 'deal') return Promise.resolve(c.deal_id);
    return lookDeal(c).then(function (have) {
      if (have) return have;
      var title = crNewDealTitle(c);
      return api('/sales/deals', { method: 'POST', body: { title: title, contact_id: c.id } }).then(function (r) {
        var id = r.ok && r.body && r.body.data && r.body.data.id;
        if (!id) return Promise.reject(msg(r, r.status === 403 ? 'Deals are part of your plan’s business tools — an upgrade adds them.' : 'Couldn’t start a deal for them — please try again.'));
        DATA_AT = 0;   // the lists changed
        return become(c, id, title, 'lead');
      });
    });
  }
  function finishDone(text, href, kind) {
    var detail = { kind: S.kind };
    close();
    toast(text, kind || 'ok', href ? { label: 'Open', onClick: function () { location.assign(href); } } : null);
    try { window.dispatchEvent(new CustomEvent('dds:created', { detail: detail })); } catch (_) { /* */ }
  }
  function submit(force) {
    if (!S || S.busy) return;
    // bug hunt A9: a save answers the form that SENT it. If that form was closed and
    // another opened while it worked, the result is a toast only: it never closes,
    // fills or unlocks the form now open.
    var mine = S;
    var stillMine = function () { return S === mine && dlg && dlg.open; };
    var done = function (text, href, kind) {
      if (stillMine()) return finishDone(text, href, kind);
      toast(text, kind || 'ok', href ? { label: 'Open', onClick: function () { location.assign(href); } } : null);
      try { window.dispatchEvent(new CustomEvent('dds:created', { detail: { kind: mine.kind } })); } catch (_) { /* */ }
    };
    var fail = function (m) { if (stillMine()) return failForm(m); toast(m, 'err'); };
    S.force = force === true;   // only "Send a second invoice" sends one beside an open one
    var f = dlg.querySelector('form'); var err = dlg.querySelector('.cr-err'); if (err) err.hidden = true;
    var go = dlg.querySelector('.cr-go');
    var val = function (id) { var el = f.querySelector('#' + id); return el ? String(el.value || '').trim() : ''; };
    var need = function (msgText, focusSel) { fail(msgText); var el = focusSel && f.querySelector(focusSel); if (el) el.focus(); };
    var k = S.kind, c = S.pick;
    if (k === 'project' && !val('cr-pjname')) return need('A project needs a name.', '#cr-pjname');
    if (k !== 'deal' && k !== 'project' && !c) return need(k === 'call' ? 'Pick who you talked to.' : k === 'invoice' ? 'Pick who the invoice is for.' : k === 'proposal' ? 'Pick the deal.' : 'Pick who it’s for.', '#cr-who');
    if (k === 'deal' && !val('cr-title')) return need('Give the deal a name.', '#cr-title');
    // item 97: a value that isn't a number is said, never saved as no value
    if (k === 'deal' && val('cr-value') && !crCents(val('cr-value'))) return need('Write the value as a number, like 2500 or 2.5k.', '#cr-value');
    if (k === 'invoice' && !crCents(val('cr-amt'))) return need('Enter the amount.', '#cr-amt');
    if (k === 'todo' && !val('cr-what')) return need('Say what needs doing.', '#cr-what');
    if (k === 'proposal') { close(); location.assign('/pipeline.html?deal=' + encodeURIComponent(c.deal_id) + '&dtab=billing&compose=proposal'); return; }
    S.busy = true; if (go) go.disabled = true;
    var p;
    if (k === 'call') {
      var body = crCallBody(S.outcome, val('cr-notes'));
      var when = val('cr-when');
      var next = val('cr-next');
      // sales item 85: someone with no deal keeps the call on their own record; "next" becomes a to-do for them
      if (c.kind === 'contact') {
        p = onPerson(c, function () {
          return api('/sales/people/activity', { method: 'POST', body: { kind: 'call', body: body, contact_id: c.id, occurred_at: when && when !== nowTodayYmd() ? when : undefined, follow_up: next ? crDue(S.nextDue) || undefined : undefined, follow_up_title: next || undefined } });
        }, function (r) {
          var fu = r.body && r.body.data && r.body.data.follow_up;
          if (next && !(fu && fu.id)) done('The call is logged, but the to-do didn’t save — add it from To-dos.', hrefFor('', '', c.id), 'err');
          else done('Call logged — ' + (c.name || 'them'), hrefFor('', '', c.id));
        });
      }
      var viaDeal = function () { return ensureDeal(c).then(function (id) {
        return api('/sales/deals/' + encodeURIComponent(id) + '/activity', { method: 'POST', body: { kind: 'call', body: body, occurred_at: when && when !== nowTodayYmd() ? when : undefined } }).then(function (r) {
          if (!r.ok) return Promise.reject(msg(r, 'That call didn’t save — please try again.'));
          if (!next) return { id: id, nextOk: true };
          return api('/sales/deals/' + encodeURIComponent(id), { method: 'PATCH', body: { next_step: next, next_step_at: crDue(S.nextDue) } }).then(function (r2) {
            return { id: id, nextOk: !!r2.ok };
          }, function () { return { id: id, nextOk: false }; });
        });
      }).then(function (res) {
        var href = hrefFor(res.id, 'deal');
        if (!res.nextOk) done('The call is logged, but the next step didn’t save — add it on the deal.', href, 'err');
        else done('Call logged' + (c.title ? ' — ' + c.title : ''), href);
      }); };
      // their own deal, or a server without the person routes yet: the deal path, as before
      p = p ? p.catch(function (e) { return e && e.useDeal ? viaDeal() : Promise.reject(e); }) : viaDeal();
    } else if (k === 'deal') {
      var title = val('cr-title'), cents = crCents(val('cr-value'));
      var person = S.someoneNew ? { name: val('cr-pname'), email: val('cr-pemail') } : null;
      if (person && !person.name && !person.email) person = null;
      var contactP = S.someoneNew
        ? (person ? api('/sales/contacts', { method: 'POST', body: { name: person.name || person.email.split('@')[0], email: person.email || undefined } }).then(function (r) {
            var id = r.ok && r.body && r.body.data && r.body.data.id; if (!id) return Promise.reject(msg(r, 'That person didn’t save — please try again.')); return id; }) : Promise.resolve(null))
        : Promise.resolve(c && c.kind === 'contact' ? c.id : null);
      p = contactP.then(function (contactId) {
        return api('/sales/deals', { method: 'POST', body: { title: title, contact_id: contactId || undefined, expected_value_cents: cents || undefined } });
      }).then(function (r) {
        var id = r.ok && r.body && r.body.data && r.body.data.id;
        if (!id) return Promise.reject(msg(r, r.status === 403 ? 'Deals are part of your plan’s business tools — an upgrade adds them.' : 'That deal didn’t save — please try again.'));
        DATA_AT = 0;
        done('Deal added — ' + title, CLIENT ? hrefFor(id, 'deal') : '/pipeline.html?deal=' + encodeURIComponent(id));
      });
    } else if (k === 'invoice') {
      var amt = crCents(val('cr-amt')), what = val('cr-what');
      p = ensureDeal(c).then(function (id) {
        var b = { purpose: 'service', amount_cents: amt, due_date: crDue(S.due) };
        if (what) b.title = what;
        if (S.force) b.force = true;
        return api('/sales/deals/' + encodeURIComponent(id) + '/invoice', { method: 'POST', body: b }).then(function (r) {
          if (r.status === 409 && !S.force && r.body && r.body.error === 'amount_mismatch') {
            S.offerSecond = true;
            return Promise.reject(msg(r, 'There’s already an open invoice for a different amount on this deal.'));
          }
          if (!r.ok) return Promise.reject(msg(r, r.status === 409 ? 'There’s already an open invoice for a different amount on this deal — open the deal to send or void it.' : 'That invoice didn’t send — please try again.'));
          var b2 = r.body || {}, url = b2.url || '', href = hrefFor(id, 'billing');
          if (b2.warning === 'link_failed' || !url) return Promise.reject(b2.message || 'The invoice saved, but its payment link didn’t generate — press Send invoice again to finish it.');
          if (b2.emailed) { done('Invoice sent — emailed to ' + (c.name || 'them'), href); return; }
          var copy = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(url).then(function () { return true; }, function () { return false; }) : Promise.resolve(false);
          return copy.then(function (copied) {
            var lead = b2.reused ? 'That invoice was already open on this deal — nothing new was emailed' : 'Invoice ready — nothing was emailed';
            done(lead + (copied ? ', so its payment link is copied for you to send.' : '. Open the deal to copy its payment link.'), href, 'err');
          });
        });
      });
    } else if (k === 'todo') {
      var what2 = val('cr-what'), due = crDue(S.due);
      // sales item 85: a to-do for someone with no deal is theirs; no deal starts for it
      if (c.kind === 'contact') {
        p = onPerson(c, function () {
          return api('/sales/tasks', { method: 'POST', body: due ? { title: what2, due_date: due, contact_id: c.id } : { title: what2, contact_id: c.id } });
        }, function () { done('To-do added — ' + (c.name || 'them'), hrefFor('', '', c.id)); });
      }
      var todoViaDeal = function () { return ensureDeal(c).then(function (id) {
        return api('/sales/deals/' + encodeURIComponent(id) + '/tasks', { method: 'POST', body: due ? { title: what2, due_date: due } : { title: what2 } }).then(function (r) {
          if (!r.ok) return Promise.reject(msg(r, 'That to-do didn’t save — please try again.'));
          done('To-do added' + (c.title ? ' — ' + c.title : ''), hrefFor(id, 'deal'));
        });
      }); };
      p = p ? p.catch(function (e) { return e && e.useDeal ? todoViaDeal() : Promise.reject(e); }) : todoViaDeal();
    }
    else if (k === 'project') {
      var pj = { name: val('cr-pjname') }, cust = val('cr-cust'), tplv = val('cr-tpl') || S.tpl, target = val('cr-target');
      if (cust) pj.customer_client_id = cust;
      if (tplv) pj.template = tplv;
      if (target) pj.target_date = target;
      p = api('/projects', { method: 'POST', body: pj }).then(function (r) {
        var id = r.ok && r.body && r.body.data && r.body.data.id;
        if (!id) return Promise.reject(msg(r, r.status === 403 ? 'Projects are part of your plan’s business tools — an upgrade adds them.' : 'That project didn’t save — please try again.'));
        // inside a client their Project page shows it; else the studio's Projects opens it
        done('Project created — ' + pj.name, CLIENT && cust ? '/projects.html?client=' + encodeURIComponent(CLIENT.site_id) : '/projects.html?project=' + encodeURIComponent(id));
      });
    }
    if (p) p.catch(function (e) { fail(typeof e === 'string' ? e : 'Something went wrong — please try again.'); });
  }

  window.ddsCreate = {
    open: function (kind, from, viaKey, preset, client) {
      // sales item 91: the client a studio is inside, or null; a change of client drops what was read
      var next = client && client.site_id ? { site_id: String(client.site_id), name: String(client.name || 'this client') } : null;
      if ((next && next.site_id) !== (CLIENT && CLIENT.site_id)) { DATA = null; DATA_AT = 0; }
      CLIENT = next;
      if (CLIENT && kind && CLIENT_KINDS.indexOf(kind) < 0) kind = '';
      KEYS = !!viaKey;
      opener = from || document.activeElement || null;
      if (opener && opener.setAttribute) opener.setAttribute('aria-expanded', 'true');
      if (kind && LINKS[kind]) { location.assign(LINKS[kind]); return; }
      if (kind) openForm(kind, preset); else openMenu();
    },
    close: close,
    isOpen: function () { return !!(dlg && dlg.open); },
  };
})();
