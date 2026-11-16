// ── "+ Create" (sales list item 70, the bold redesign, Nov 2026) ─────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/create_kit_test.mjs
//
//   Timed against Salesforce, every everyday job started by finding the
//   customer and opening their page. "+ Create" (create.js, loaded by
//   shell.js) logs a call, adds a deal, sends an invoice, opens a proposal or
//   adds a to-do from any page; you pick WHO inside the form.
//
//   1  the rules: create.js's own pure block (between the create-pure markers),
//      run exactly as the page has it
//   2  the server routes Create calls, through the REAL presence function (index.ts,
//      every gate, the real handlers) against the in-memory PostgREST, with Stripe and
//      the mail service stubbed: method and path reach the handler, signed in only, and
//      one studio's call never reads or changes another studio's rows
//   3  the page wiring is browser tests (tests/e2e/create.spec.ts, create-kit-212.spec.ts;
//      the list is at the end, with the phone bar's own spec from PR 416); what stays
//      text here is three pins whose text is the contract
import { installFakePostgrest } from './fake_pgrst.mjs';
Deno.env.set('STRIPE_SECRET', 'sk_test_stub');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Example Studio <hello@example.com>');
Deno.env.set('SITE_URL', 'https://app.example.com');
Deno.env.delete('OPS_ALERT_EMAIL');
Deno.env.delete('RESEND_INBOUND_DOMAIN');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note ? '— ' + note : ''); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ═══ 1. create.js's rules, run as the page runs them ═══
const create = read('create.js');
const a = create.indexOf('/* create-pure:start'), b = create.indexOf('/* create-pure:end */');
ok('create.js has its pure block', a > 0 && b > a);
const K = new Function(create.slice(a, b) + '\nreturn { crDue, crCents, crMoney, crCallBody, crCandidates, crMatch, crSuggest, crNewDealTitle, crPickDeal, crMerge, crGoLabel };')();

// ── dates from the chips, in the studio's own calendar ──
const MON = new Date(2026, 10, 9, 15, 30).getTime();    // Monday 9 Nov 2026, mid-afternoon local
const FRI = new Date(2026, 10, 13, 9, 0).getTime();     // Friday 13 Nov
const LATE = new Date(2026, 10, 9, 23, 50).getTime();   // ten to midnight: still the 9th here, whatever UTC says
eq('on receipt is today', K.crDue('receipt', MON), '2026-11-09');
eq('today', K.crDue('today', LATE), '2026-11-09');
eq('tomorrow', K.crDue('tomorrow', MON), '2026-11-10');
eq('7 / 14 / 30 days', [K.crDue('7', MON), K.crDue('14', MON), K.crDue('30', MON)], ['2026-11-16', '2026-11-23', '2026-12-09']);
eq('Friday from a Monday is this Friday', K.crDue('friday', MON), '2026-11-13');
eq('Friday from a Friday is next Friday', K.crDue('friday', FRI), '2026-11-20');
eq('next week is next Monday, from a Monday too', [K.crDue('nextweek', MON), K.crDue('nextweek', FRI)], ['2026-11-16', '2026-11-16']);
eq('"No date" is no date', K.crDue('', MON), '');

// ── money as people type it ──
eq('dollars and cents with commas', K.crCents('$1,200.50'), 120050);
eq('a bare number', K.crCents('700'), 70000);
eq('one decimal', K.crCents('9.5'), 950);
eq('nothing usable is zero (never a guess)', [K.crCents(''), K.crCents('abc'), K.crCents('1.234'), K.crCents('-5'), K.crCents(null)], [0, 0, 0, 0, 0]);
eq('shown back the way it reads', [K.crMoney(120050), K.crMoney(70000), K.crMoney(5)], ['$1,200.50', '$700', '$0.05']);

// ── a call needs no note of its own ──
eq('a voicemail says so', K.crCallBody('voicemail', ''), 'Left a voicemail.');
eq('no answer, with a note', K.crCallBody('noanswer', ' called twice '), 'No answer. called twice');
eq('we talked: just the note', K.crCallBody('talked', '  Agreed the logo '), 'Agreed the logo');
eq('we talked, no note: an empty body (the server allows it for a call, section 2)', K.crCallBody('talked', ''), '');

// ── who you can pick ──
const people = [
  { id: 'c1', name: 'Jane Doe', company: 'Blue Finch', email: 'jane@example.com' },
  { id: 'c2', name: 'Sam Lee', company: '', email: 'sam@example.com' },
  { id: 'c3', name: '', company: 'Oak & Iron', email: 'hi@oak.example' },
  { id: 'c4', name: 'Lost Lou', email: 'lou@example.com' },
];
const deals = [
  { id: 'd1', title: 'Blue Finch — site', stage: 'proposal', contact_id: 'c1', expected_value_cents: 250000, next_step: 'Call back', next_step_at: '2026-11-12', updated_at: '2026-11-01' },
  { id: 'd2', title: 'Sam — logo', stage: 'lead', contact_id: 'c2', updated_at: '2026-11-08' },
  { id: 'd3', title: 'Old job', stage: 'won', contact_id: 'c2', updated_at: '2026-10-01' },
  { id: 'd4', title: 'Lost one', stage: 'lost', contact_id: 'c4', updated_at: '2026-11-07' },
  { id: 'd5', title: 'Overdue', stage: 'qualified', contact_id: null, next_step_at: '2026-11-02', updated_at: '2026-09-01' },
];
const cands = K.crCandidates(deals, people);
eq('every deal but the lost one, then people with no deal yet', cands.map((c) => c.id), ['d1', 'd2', 'd3', 'd5', 'c3', 'c4']);
ok('a deal carries its person', cands[0].name === 'Jane Doe' && cands[0].company === 'Blue Finch' && cands[0].value_cents === 250000);
ok('a person whose only deal is lost can be picked again (as no deal yet)', cands.find((c) => c.id === 'c4')?.kind === 'contact');
ok('a person with no name keeps their own name empty (the title falls to the business)', cands.find((c) => c.id === 'c3')?.pname === '' && cands.find((c) => c.id === 'c3')?.name === 'hi@oak.example');
eq('with nothing typed: open deals, the overdue next step first', K.crSuggest(cands, 5).map((c) => c.id), ['d5', 'd1', 'd2']);
ok('a won deal is never suggested (it isn’t open)', !K.crSuggest(cands, 9).some((c) => c.id === 'd3'));
ok('typing finds a person, a business or a deal', K.crMatch(cands[0], 'finch') && K.crMatch(cands[0], 'JANE') && K.crMatch(cands.find((c) => c.id === 'c3'), 'oak') && K.crMatch(cands[1], 'logo') && !K.crMatch(cands[1], 'finch'));

// ── never two deals for one person ──
eq('a new deal is titled the way Contacts titles it (name, business, email)', [K.crNewDealTitle({ pname: 'Jane Doe', company: 'X', email: 'j@x' }), K.crNewDealTitle({ pname: '', company: 'Oak & Iron', email: 'hi@oak' }), K.crNewDealTitle({ pname: '', company: '', email: 'hi@oak' }), K.crNewDealTitle({})], ['Jane Doe — project', 'Oak & Iron — project', 'hi@oak — project', 'New — project']);
eq('a person with an open deal gets that deal, not a new one', K.crPickDeal([{ id: 'w', stage: 'won' }, { id: 'o', stage: 'qualified' }])?.id, 'o');
eq('…else their won deal', K.crPickDeal([{ id: 'l', stage: 'lost' }, { id: 'w', stage: 'won' }])?.id, 'w');
eq('…and only lost deals means a new one', K.crPickDeal([{ id: 'l', stage: 'lost' }]), null);
eq('a search folds in by id', K.crMerge([{ id: 'a', v: 1 }, { id: 'b', v: 1 }], [{ id: 'b', v: 2 }, { id: 'c', v: 2 }]).map((x) => x.id + x.v), ['a1', 'b2', 'c2']);

// ── the button says what it will do ──
eq('the main button, for a deal and for a person with none', [K.crGoLabel('call', { kind: 'deal' }), K.crGoLabel('call', { kind: 'contact' }), K.crGoLabel('invoice', { kind: 'contact' }), K.crGoLabel('todo', null), K.crGoLabel('deal', null), K.crGoLabel('proposal', null)],
  ['Log call', 'Log call', 'Start a deal and send', 'Add to-do', 'Add deal', 'Open the proposal']);   // sales item 85: a call for someone with no deal stays on them

// ═══ 2. The routes Create calls, through the real function ═══
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SITE_A = id(1), SITE_B = id(2), USER_A = id(3), USER_B = id(4), CLIENT_A = id(5), CLIENT_B = id(6);
const D_A = id(10), D_A2 = id(11), D_B = id(20);
const CT_A = id(30), CT_A2 = id(31), CT_B = id(32);
const TASK_A = id(40), TASK_B = id(41), TASK_X = id(42);
const T0 = '2026-11-01T10:00:00.000Z';
const db = installFakePostgrest({
  users: { 'jwt-a': { id: USER_A, email: 'owner-a@example.com' }, 'jwt-b': { id: USER_B, email: 'owner-b@example.com' } },
  ownSite: { 'jwt-a': SITE_A, 'jwt-b': SITE_B },
});
const pg = globalThis.fetch;
const mail = [], stripe = [];
const answer = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'api.resend.com') { mail.push(JSON.parse(String(init.body || '{}'))); return answer({ id: `em_${mail.length}` }); }
  if (u.hostname === 'api.stripe.com') {
    const form = Object.fromEntries(new URLSearchParams(String(init.body || '')));
    stripe.push({ path: u.pathname, form });
    if (u.pathname === '/v1/prices') return answer({ id: `price_${stripe.length}` });
    if (u.pathname === '/v1/payment_links') return answer({ id: `plink_${stripe.length}`, url: `https://pay.example.test/${form['metadata[presence_invoice_id]']}` });
    return answer({});
  }
  return pg(url, init);
};
// the real index.ts, with std's serve() handed a fake listener: no socket opens
const queue = []; let wake = null;
Deno.listen = () => { let first = true; return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} }; };
Deno.serveHttp = () => ({ nextRequest: () => new Promise((res) => { if (queue.length) res(queue.shift()); else wake = res; }), close() {} });
await import('../../supabase/functions/presence/index.ts');
const send = (request) => new Promise((resolve) => { const ev = { request, respondWith: async (r) => { resolve(await r); } }; if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev); });
const call = async (jwt, method, route, body) => {
  const headers = { 'Content-Type': 'application/json' };
  if (jwt) headers['x-dds-user-jwt'] = jwt;
  const res = await send(new Request(`https://db.test/functions/v1/presence${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text(); let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: j, text };
};
const asA = (m, r, x) => call('jwt-a', m, r, x), asB = (m, r, x) => call('jwt-b', m, r, x), anon = (m, r, x) => call(null, m, r, x);
const short = (r) => `${r.status} ${r.text.slice(0, 160)}`;
const dealRow = (did, site, over = {}) => ({ id: did, site_id: site, title: 'Blue Finch — site', stage: 'proposal', contact_id: null, expected_value_cents: 250000, next_step: null, next_step_at: null, notes: '', converted_client_id: null, converted_site_id: null, deleted_at: null, created_at: T0, updated_at: T0, ...over });
const world = () => {
  db.reset({
    presence_sites: [{ id: SITE_A, client_id: CLIENT_A, status: 'live', edition: 'presence' }, { id: SITE_B, client_id: CLIENT_B, status: 'live', edition: 'presence' }],
    presence_entitlements: [CLIENT_A, CLIENT_B].map((client_id) => ({ client_id, product: 'presence', plan: 'presence', status: 'active' })),
    clients: [{ id: id(90), email: 'owner-a@example.com', tenant_id: 'tenant-1', name: 'Alex Rivera' }, { id: id(91), email: 'owner-b@example.com', tenant_id: 'tenant-1', name: 'Bo Chen' }],
    presence_identity: [{ site_id: SITE_A, business_name: 'Bright Studio' }, { site_id: SITE_B, business_name: 'Other Studio' }],
    presence_contacts: [
      { id: CT_A, site_id: SITE_A, name: 'Jane Doe', company: 'Blue Finch', email: 'jane@example.com', deleted_at: null, created_at: T0, updated_at: '2026-11-03T10:00:00.000Z' },
      { id: CT_A2, site_id: SITE_A, name: '', company: 'Oak & Iron', email: 'hi@oak.example.com', deleted_at: null, created_at: T0, updated_at: '2026-11-02T10:00:00.000Z' },
      { id: CT_B, site_id: SITE_B, name: 'Jane Roe', company: 'Harbor Lane', email: 'jane.roe@example.com', deleted_at: null, created_at: T0, updated_at: '2026-11-04T10:00:00.000Z' },
    ],
    presence_deals: [dealRow(D_A, SITE_A, { contact_id: CT_A }), dealRow(D_A2, SITE_A, { title: 'Oak & Iron — project', stage: 'lead', contact_id: CT_A2, expected_value_cents: 0, updated_at: '2026-11-02T10:00:00.000Z' }), dealRow(D_B, SITE_B, { title: 'Harbor Lane — finches', contact_id: CT_B })],
    presence_deal_tasks: [
      { id: TASK_A, site_id: SITE_A, deal_id: D_A, title: 'Send the logo', due_date: null, status: 'open', deleted_at: null, created_at: T0 },
      { id: TASK_B, site_id: SITE_B, deal_id: D_B, title: 'Their own to-do', due_date: null, status: 'open', deleted_at: null, created_at: T0 },
      { id: TASK_X, site_id: SITE_B, deal_id: D_A, title: 'Another studio’s row naming this deal', due_date: null, status: 'open', deleted_at: null, created_at: T0 },
    ],
    presence_deal_events: [], presence_invoices: [], presence_form_submissions: [],
  });
  db.fail.add('rpc/rate_hit');
  mail.length = 0; stripe.length = 0;
};
const T = (t) => db.tables[t] || [];
const bRows = () => JSON.stringify(['presence_deals', 'presence_contacts', 'presence_deal_tasks', 'presence_deal_events', 'presence_invoices'].map((t) => T(t).filter((r) => r.site_id === SITE_B)));

// ── Log a call: POST /sales/deals/:id/activity ──
{
  world();
  let r = await asA('POST', `/sales/deals/${D_A}/activity`, { kind: 'call', body: '' });
  const ev = T('presence_deal_events');
  ok('a call with no note is logged on the studio’s deal (201, one event: the call, its empty note)', r.status === 201 && ev.length === 1 && ev[0].site_id === SITE_A && ev[0].deal_id === D_A && ev[0].kind === 'note' && ev[0].detail?.activity_kind === 'call' && ev[0].detail.body === '', short(r));
  const quiet = [];
  for (const kind of ['email', 'meeting']) quiet.push((await asA('POST', `/sales/deals/${D_A}/activity`, { kind, body: '' })).status);
  ok('an email or a meeting needs no note either', quiet.every((s) => s === 201) && T('presence_deal_events').length === 3, JSON.stringify(quiet));
  r = await asA('POST', `/sales/deals/${D_A}/activity`, { kind: 'note', body: '   ' });
  ok('a note does need words: 422 "Write a short note.", nothing written', r.status === 422 && r.body?.message === 'Write a short note.' && T('presence_deal_events').length === 3, short(r));
  r = await asA('GET', `/sales/deals/${D_A}/activity`);
  ok('the route takes a POST only (a GET finds no route)', r.status === 404 && r.body?.error === 'not_found', short(r));
  world();
  const before = bRows();
  r = await asA('POST', `/sales/deals/${D_B}/activity`, { kind: 'call', body: 'Hello' });
  ok('a call on another studio’s deal is a 404, and nothing of theirs changes', r.status === 404 && bRows() === before && !T('presence_deal_events').length, short(r));
  r = await anon('POST', `/sales/deals/${D_A}/activity`, { kind: 'call', body: '' });
  ok('not signed in: 401, nothing written', r.status === 401 && !T('presence_deal_events').length, short(r));
}

// ── To-dos on a deal: GET + POST /sales/deals/:id/tasks ──
{
  world();
  let r = await asA('GET', `/sales/deals/${D_A}/tasks`);
  ok('the deal’s to-dos list this studio’s own only (never another studio’s row naming the deal)', r.status === 200 && JSON.stringify((r.body?.data || []).map((t) => t.id)) === JSON.stringify([TASK_A]), short(r));
  r = await asA('POST', `/sales/deals/${D_A}/tasks`, { title: 'Price the add-ons', due_date: '2026-11-16' });
  const made = T('presence_deal_tasks').find((t) => t.title === 'Price the add-ons');
  ok('adding one saves it on the studio’s deal, open, with its date and its owner', r.status === 201 && made?.site_id === SITE_A && made.deal_id === D_A && made.status === 'open' && made.due_date === '2026-11-16' && made.assigned_to === USER_A, short(r));
  r = await asA('POST', `/sales/deals/${D_A}/tasks`, { title: '  ' });
  ok('a to-do needs a title (422)', r.status === 422, short(r));
  const theirs = bRows();
  const theirList = (await asB('GET', `/sales/deals/${D_B}/tasks`)).body?.data;
  await asA('POST', `/sales/deals/${D_B}/tasks`, { title: 'Slipped in' });
  ok('a to-do aimed at another studio’s deal never reaches them: their rows and their list are as they were', bRows() === theirs && JSON.stringify((await asB('GET', `/sales/deals/${D_B}/tasks`)).body?.data) === JSON.stringify(theirList));
  r = await anon('GET', `/sales/deals/${D_A}/tasks`);
  ok('not signed in: 401', r.status === 401, short(r));
}

// ── Send an invoice: POST /sales/deals/:id/invoice ──
{
  world();
  T('presence_deals').find((d) => d.id === D_A).contact_id = CT_A;
  let r = await asA('POST', `/sales/deals/${D_A}/invoice`, { purpose: 'service', amount_cents: 125000, due_date: '2026-11-16', title: '50% deposit' });
  const inv = T('presence_invoices');
  ok('an invoice is made on the studio’s deal: open, the amount, the date, its pay link', r.status === 201 && inv.length === 1 && inv[0].site_id === SITE_A && inv[0].deal_id === D_A && inv[0].status === 'open' && inv[0].amount_cents === 125000 && inv[0].due_date === '2026-11-16' && inv[0].title === '50% deposit' && r.body?.url === `https://pay.example.test/${inv[0].id}`, short(r));
  ok('…and emailed to the person on the deal (Create says "emailed to Jane Doe")', r.body?.emailed === true && mail.length === 1 && mail[0].to === 'jane@example.com', JSON.stringify(mail.map((m) => m.to)));
  world();
  const before = bRows();
  r = await asA('POST', `/sales/deals/${D_B}/invoice`, { purpose: 'service', amount_cents: 125000 });
  ok('an invoice on another studio’s deal is a 404: no invoice, no pay link, no email', r.status === 404 && !T('presence_invoices').length && !stripe.length && !mail.length && bRows() === before, short(r));
  r = await anon('POST', `/sales/deals/${D_A}/invoice`, { purpose: 'service', amount_cents: 125000 });
  ok('not signed in: 401, nothing made', r.status === 401 && !T('presence_invoices').length, short(r));
}

// ── Who to pick: GET /sales/contacts, /sales/deals, /sales/contacts/:id ──
{
  world();
  let r = await asA('GET', '/sales/contacts?limit=100');
  ok('the first read of people lists this studio’s people only', r.status === 200 && JSON.stringify((r.body?.data || []).map((c) => c.id).sort()) === JSON.stringify([CT_A, CT_A2].sort()), short(r));
  r = await asA('GET', '/sales/contacts?limit=20&q=jane');
  ok('typing a name asks the server, which finds this studio’s Jane and never the other studio’s', r.status === 200 && JSON.stringify((r.body?.data || []).map((c) => c.id)) === JSON.stringify([CT_A]), short(r));
  r = await asA('GET', '/sales/deals?limit=100');
  ok('the first read of deals lists this studio’s deals only', r.status === 200 && JSON.stringify((r.body?.data || []).map((d) => d.id).sort()) === JSON.stringify([D_A, D_A2].sort()), short(r));
  r = await asA('GET', '/sales/deals?limit=20&q=finch');
  ok('typing a deal’s name finds this studio’s deal and not the other studio’s', r.status === 200 && JSON.stringify((r.body?.data || []).map((d) => d.id)) === JSON.stringify([D_A]), short(r));
  r = await asA('GET', `/sales/contacts/${CT_A2}`);
  ok('a person’s own deals come back with them (what Create checks before starting one)', r.status === 200 && JSON.stringify((r.body?.data?.deals || []).map((d) => d.id)) === JSON.stringify([D_A2]), short(r));
  r = await asA('GET', `/sales/contacts/${CT_B}`);
  ok('another studio’s person is a 404, with nothing of theirs in the answer', r.status === 404 && !/Jane Roe|Harbor Lane/.test(r.text), short(r));
  r = await anon('GET', '/sales/contacts?limit=100');
  ok('not signed in: 401', r.status === 401, short(r));
}

// ── Making a person and a deal: POST /sales/contacts, POST /sales/deals, PATCH /sales/deals/:id ──
{
  world();
  let r = await asA('POST', '/sales/contacts', { name: 'Ola Smith', email: 'ola@example.com' });
  const ola = T('presence_contacts').find((c) => c.email === 'ola@example.com');
  ok('someone new is saved in this studio', (r.status === 201 || r.status === 200) && ola?.site_id === SITE_A && ola.name === 'Ola Smith', short(r));
  r = await asA('POST', '/sales/deals', { title: 'Oak & Iron — project', contact_id: CT_A2 });
  const made = T('presence_deals').find((d) => d.id === r.body?.data?.id);
  ok('a deal started for a person is this studio’s, on that person, as a new lead', r.status === 201 && made?.site_id === SITE_A && made.contact_id === CT_A2 && made.title === 'Oak & Iron — project' && made.stage === 'lead', short(r));
  const before = T('presence_deals').length;
  r = await asA('POST', '/sales/deals', { title: 'Their person', contact_id: CT_B });
  ok('a deal can’t be pinned on another studio’s person (422, nothing made)', r.status === 422 && r.body?.error === 'bad_contact' && T('presence_deals').length === before, short(r));
  r = await asA('PATCH', `/sales/deals/${D_A}`, { next_step: 'Send the logo', next_step_at: '2026-11-13' });
  const da = T('presence_deals').find((d) => d.id === D_A);
  ok('the call’s next step lands on the studio’s deal', r.status === 200 && da.next_step === 'Send the logo' && da.next_step_at === '2026-11-13', short(r));
  const theirs = bRows();
  r = await asA('PATCH', `/sales/deals/${D_B}`, { next_step: 'Hijack' });
  ok('…and never on another studio’s (404, theirs unchanged)', r.status === 404 && bRows() === theirs, short(r));
}

// ═══ 3. Kept as text ═══
const shell = read('shell.js');
const css = read('shell.css');
const headers = read('_headers');

// pin: _headers is the cache contract Netlify serves; without no-cache a deploy leaves browsers on a stale create.js
ok('/create.js revalidates like shell.js', /\n\/create\.js\n  Cache-Control: no-cache, must-revalidate\n/.test(headers));
// pin: the public build allowlist; create.js ships only because build-public.sh copies every root .js
ok('the public build copies it (every root .js)', /cp \.\/\*\.js dist\//.test(read('scripts/build-public.sh')));
// pin: env(safe-area-inset-bottom) is 0 in every test browser, so the room under the phone sheet's button for the iPhone's home bar can't be measured; the rule is the contract
ok('a phone sheet keeps room for the home bar under its button', /\.dds-cr\.sheet \.cr-foot\{padding:12px 16px calc\(12px \+ env\(safe-area-inset-bottom,0px\)\)\}/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:\n  ' + failed.join('\n  ')); Deno.exit(1); }
Deno.exit(0);   // std serve() keeps its fake listener open

// ── Covered in the browser by (the page halves of the old text checks) ──
//   the phone bar (PR 416): Home · Sites or Website · + · Inbox · Menu, the + whenever they may create:
//     phone-bar-menu-165.spec.ts › a studio’s bar: Home · Sites · + · Inbox · Menu, and the top bar has no second Menu
//     phone-bar-menu-165.spec.ts › inside a client: Overview · Website · Messages · Menu, the + in the middle when Create shows there
//     phone-bar-menu-165.spec.ts › an owner running their own site: Home · Website · Inbox · Menu
//     phone-bar-menu-165.spec.ts › a studio that hid Sites in Your menu: no Sites on the bar either
//   create.js checks the person’s deals before starting one; the check starts as soon as they are picked:
//     create.spec.ts › + Create › someone past the first 100: typing asks the server, and their own deal is used — none is started
//     create.spec.ts › + Create › a person with no deal: the call stays on them, and pressing again after a failure logs it once
//   a failed check never risks a second deal; the pick becomes the deal it started:
//     create-kit-212.spec.ts › a failed check of their deals stops and says so, and starts no deal
//     create-kit-212.spec.ts › the deal started for a person is the one used when pressing again
//   a reply that isn’t a list counts as an empty one; past the first 100, typing asks the server:
//     create-kit-212.spec.ts › a reply that isn’t a list counts as empty: the rest still lists, nothing breaks
//     create-kit-212.spec.ts › the first read asks for 100 people and 100 deals; typing asks the server for 20 of each
//   an invoice whose link didn’t generate keeps the form open:
//     create.spec.ts › + Create › an invoice whose payment link didn’t generate stays open; Send again finishes the same one and says nothing was emailed
//     create-kit-212.spec.ts › an invoice answered with no pay link keeps the form open and says so
//   "copied" only when the copy worked:
//     create-kit-212.spec.ts › nothing emailed: "copied" only when the copy worked (it did) / (it didn’t)
//   only a studio with Pipeline gets Create; the sidebar button only when it applies:
//     create.spec.ts › + Create › only a studio: an owner gets no Create; inside a client it stays, for that client (sales item 91)
//     create.spec.ts › + Create: the bug hunt fixes (A3, A8, A9) › A3 — a studio that hid Pipeline in Your menu keeps the + on a phone: Home · Inbox · + · Menu
//     create-kit-212.spec.ts › a studio without Pipeline, or a reviewer, gets no Create
//   create.js loads on idle from the site itself; a failed load says so and the next press retries:
//     create-kit-212.spec.ts › create.js loads on its own from this site; a failed load says so, and the next press retries
//   "c" opens it, never while typing or under an open form; ⌘K lists the jobs last and opens them in place:
//     create.spec.ts › + Create › keys: c opens it, ⌘K finds "log a call", and a #create link opens its form once
//     create-kit-212.spec.ts › c does nothing while typing, or over a form that is open
//     create-kit-212.spec.ts › ⌘K lists the Create jobs after the pages and opens one in place, with no #hash
//   "#create:<kind>" opens it once and clears itself:
//     create.spec.ts › + Create › keys: c opens it, ⌘K finds "log a call", and a #create link opens its form once
//     create-kit-212.spec.ts › every #create:<kind> link opens its own form once and clears the address
//   the n key never picks the shell’s Create:
//     wave2-bets.spec.ts › 10: `n` fires the page’s New action (the Inbox’s + New enquiry) and says so when a page has none
//     create-kit-212.spec.ts › n presses the page’s own New button, never the shell’s Create
//   shell.css: hidden unless the sidebar shows it; 44px with no key hints on a touch screen; hidden parts stay hidden;
//   a phone sheet; no motion for people who ask for none:
//     create.spec.ts › + Create › a studio gets one button for the everyday jobs: the sidebar on a computer or iPad, the + on a phone
//     create.spec.ts › + Create › a new deal with someone new: the person, then the deal with its value
//     create.spec.ts › + Create › a phone gets a sheet: tiles to pick from, the form’s button above the home bar, nothing wider than the screen
//     create-kit-212.spec.ts › + Create: a touch screen › the Create button is 44px tall and shows no key hint
//     create-kit-212.spec.ts › a mouse and keyboard screen keeps the C hint beside Create
//     create-kit-212.spec.ts › no motion for people who ask for none
//   the proposal lands open on the deal (compose=proposal, Billing, never a second, the address drops it):
//     create.spec.ts › + Create › a proposal: only open deals, and it lands on the deal with a new proposal open
//     create.spec.ts › + Create › a deal with a draft proposal already: that draft is the one to send, never a second
//     create-kit-212.spec.ts › compose=proposal alone lands on Billing with a new proposal open, and the address drops it
//   Contacts and Create name a new deal the same way:
//     create-kit-212.spec.ts › Contacts and Create give a person’s new deal the same name
