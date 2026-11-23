// ── "The price is typed once and flows to the end" (operator audit 1, 2, 8 + two long-tail) ──
// Five defects, one theme: the number Eric types into a proposal must reach the
// contract placeholders, the deposit invoice, the pipeline rollup and the deal's
// record without being retyped, and the drawer must never contradict the signed
// fact. This suite drives the REAL presence function (index.ts, every gate, the real
// handlers) in-process against the in-memory PostgREST, with Stripe and the mail
// service stubbed, two studios side by side:
//   1. proposal ACCEPT fills the deal value (never a hand-set one), for this studio only
//   2. agreement SEND mints the deposit: once, ever, from the SAME split the document
//      printed; skips and warns on a valueless deal; never $0; never emailed
//   2b the ONE LINK (choose, sign, pay): what the client's page may read at each step,
//      the forced order on signing, and the combined send
//   3. the drawer guidance branches on the signed FACT (pipeline.html's mirror is run)
//   4. the renewal reminder can arm (honest term detection, the page's mirror is run)
//   5. the enquiry text travels onto the deal (notes + the created event)
// With Stripe not set up, the send mints nothing: stripe.ts reads STRIPE_SECRET once, as
// it loads, so that part runs in a Worker (this same file, ?phase=no-stripe) that loads
// the function before the key is set. The page halves are browser tests (list at the end).
//
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_price_flow_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
import { depositSplit, buildPlaceholderValues, formatMoney } from '../../supabase/functions/presence/lib/doc_placeholders.ts';
import { agreementSigned, impliedTermMonths, summarizePipeline, proposalTotals, currentProposal, flowSignGate } from '../../supabase/functions/presence/lib/sales_lifecycle.ts';
import { PIPELINE_GUIDANCE, CONTRACT_SIGNED_GUIDANCE, guidanceFor } from '../../supabase/functions/presence/lib/pipeline_guidance.ts';

Deno.env.set('APPROVAL_SECRET', 'sign-secret-for-tests-0123456789abcdef');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Example Studio <hello@example.com>');
Deno.env.set('SITE_URL', 'https://app.example.com');
Deno.env.delete('STRIPE_SECRET');   // set again, by the main run only, once the Worker has loaded without it
Deno.env.delete('OPS_ALERT_EMAIL');
Deno.env.delete('RESEND_INBOUND_DOMAIN');

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ── two studios, made up ──
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SITE_A = id(1), SITE_B = id(2), USER_A = id(3), USER_B = id(4), CLIENT_A = id(5), CLIENT_B = id(6);
const DEAL = id(10), DEAL_T = id(11), DEAL_2 = id(12), DEAL_B = id(20);
const CT_A = id(30), CT_B = id(31);
const PROP = id(40), PROP_2 = id(41), V2 = id(42), PROP_B = id(43), PROP_T = id(44);
const CON = id(50), CON_B = id(51), CON_T = id(52);
const SUB_A = id(60), SUB_B = id(61), TPL = id(70);
const HASH = 'c0'.repeat(32);
const BODY_DEPOSIT = 'A non-refundable deposit of 50% of the total project fee is due before work begins.';
const LINES_DT = [{ label: 'Design', qty: 2, unit_cents: 150000 }, { __meta__: { discount: { mode: 'percent', value: 10 }, tax_pct: 8 } }];   // $3,000 − 10% + 8% tax = $2,916
const T0 = '2026-11-01T10:00:00.000Z';
const ahead = (days) => new Date(Date.now() + days * 86400_000).toISOString();

const dealRow = (dealId, site, over = {}) => ({ id: dealId, site_id: site, title: 'Blue Finch Café website', stage: 'proposal', contact_id: site === SITE_A ? CT_A : CT_B, expected_value_cents: 0, expected_close: null, next_step: null, next_step_at: null, notes: '', converted_client_id: null, converted_site_id: null, deleted_at: null, created_at: T0, updated_at: T0, ...over });
const propRow = (pid, dealId, site, status, lines, over = {}) => ({ id: pid, site_id: site, deal_id: dealId, title: 'Website build', line_items: lines, subtotal_cents: 300000, currency: 'usd', terms: '', status, version: 1, first_viewed_at: null, expires_at: ahead(20), sent_at: status === 'draft' ? null : T0, decided_at: null, deleted_at: null, created_at: T0, updated_at: T0, ...over });
const conRow = (cid, dealId, site, status, body, over = {}) => ({ id: cid, site_id: site, deal_id: dealId, proposal_id: null, title: 'Service agreement', body, content_hash: HASH, terms_snapshot: {}, status, signed_at: null, signer_name: null, signer_email: null, sent_at: status === 'draft' ? null : T0, deleted_at: null, created_at: T0, updated_at: T0, ...over });
const invRow = (iid, dealId, site, over = {}) => ({ id: iid, site_id: site, deal_id: dealId, title: 'Deposit', description: 'Deposit — Blue Finch Café website', amount_cents: 190000, currency: 'usd', purpose: 'deposit', status: 'open', stripe_url: `https://pay.example.test/${iid}`, due_date: null, paid_at: null, deleted_at: null, created_at: T0, updated_at: T0, ...over });
const base = (extra = {}) => ({
  presence_sites: [{ id: SITE_A, client_id: CLIENT_A, status: 'live', edition: 'presence' }, { id: SITE_B, client_id: CLIENT_B, status: 'live', edition: 'presence' }],
  presence_entitlements: [CLIENT_A, CLIENT_B].map((client_id) => ({ client_id, product: 'presence', plan: 'presence', status: 'active' })),
  clients: [{ id: id(90), email: 'owner-a@example.com', tenant_id: 'tenant-1', name: 'Alex Rivera' }, { id: id(91), email: 'owner-b@example.com', tenant_id: 'tenant-1', name: 'Bo Chen' }],
  presence_identity: [{ site_id: SITE_A, business_name: 'Bright Studio' }, { site_id: SITE_B, business_name: 'Other Studio' }],
  presence_contacts: [{ id: CT_A, site_id: SITE_A, name: 'Riley Park', email: 'riley@example.com', company: 'Blue Finch Café', deleted_at: null }, { id: CT_B, site_id: SITE_B, name: 'Sam Lee', email: 'sam@example.com', company: '', deleted_at: null }],
  presence_deals: [dealRow(DEAL_B, SITE_B, { title: 'Other studio deal' })],
  presence_proposals: [], presence_contracts: [], presence_invoices: [], presence_deal_events: [], presence_form_submissions: [], presence_plan_notices: [], presence_sales_templates: [],
  ...extra,
});

// ═══ With Stripe not set up (the Worker) ═══
async function stripeOffChecks() {
  const out = [];
  const ok = (n, p, note = '') => out.push({ n, p: !!p, note: String(note || '') });
  const db = installFakePostgrest({});
  const pg = globalThis.fetch, stripeCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.stripe.com') { stripeCalls.push(u.pathname); return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    if (u.hostname === 'api.resend.com') return new Response('{"id":"em_1"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    return pg(url, init);
  };
  const S = await import('../../supabase/functions/presence/routes/sales.ts');
  const site = { id: SITE_A, client_id: CLIENT_A, status: 'live', edition: 'presence' };
  const owner = { kind: 'client', userId: USER_A, email: 'owner-a@example.com', jwt: 'jwt-a', requestId: 't' };
  const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
  ok('this run really has no Stripe key', S && !Deno.env.get('STRIPE_SECRET'));
  db.reset(base({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'contract', expected_value_cents: 380000 })], presence_contracts: [conRow(CON, DEAL, SITE_A, 'draft', BODY_DEPOSIT)] }));
  db.fail.add('rpc/rate_hit');
  let r = await res(await S.handleSalesContractSend(req('POST', `/sales/contracts/${CON}/send`), site, owner, CON, {}));
  ok('no Stripe: sending the agreement still works (200, sent)', r.status === 200 && db.tables.presence_contracts[0].status === 'sent', JSON.stringify(r));
  ok('no Stripe: …and mints no deposit, since a request with no pay link couldn’t land anyone on pay', r.body?.deposit?.minted === false && !r.body.deposit.warning && !(db.tables.presence_invoices || []).length && !stripeCalls.length, JSON.stringify(r.body?.deposit));
  db.reset(base({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'qualified', expected_value_cents: 380000 })], presence_proposals: [propRow(PROP, DEAL, SITE_A, 'draft', LINES_DT)], presence_contracts: [conRow(CON, DEAL, SITE_A, 'draft', BODY_DEPOSIT)] }));
  db.fail.add('rpc/rate_hit');
  r = await res(await S.handleSalesDealSend(req('POST', `/sales/deals/${DEAL}/send`, {}), site, owner, DEAL, {}));
  ok('no Stripe: the one-link send sends both documents and mints nothing', r.status === 200 && r.body?.sent?.contract === true && r.body.data?.deposit?.minted === false && !(db.tables.presence_invoices || []).length, JSON.stringify(r.body));
  return out;
}
async function runStripeOffWorker() {
  const w = new Worker(new URL('?phase=no-stripe', import.meta.url).href, { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('the no-Stripe Worker took over 120 s')), 120_000);
      w.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
      w.onerror = (e) => { clearTimeout(t); e.preventDefault(); reject(new Error(e.message)); };
    });
  } finally { w.terminate(); }
}

// ═══ The main run ═══
async function main() {
  const results = [];
  const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${!p && note ? ' — ' + note : ''}`); };

  // 0. Stripe not set up (its own isolate, loaded before the key below exists)
  let off = [];
  try { off = await runStripeOffWorker(); } catch (e) { ok('the no-Stripe checks ran', false, String(e?.message || e)); }
  for (const x of off) ok(x.n, x.p, x.note);

  Deno.env.set('STRIPE_SECRET', 'sk_test_stub');
  const db = installFakePostgrest({
    users: { 'jwt-a': { id: USER_A, email: 'owner-a@example.com' }, 'jwt-b': { id: USER_B, email: 'owner-b@example.com' } },
    ownSite: { 'jwt-a': SITE_A, 'jwt-b': SITE_B },
  });
  // Stripe and the mail service answer and keep what they were given; `trip` drops one
  // matching database call like a lost connection; presence_deal_events has exactly the
  // columns migration 0074 gave it, and a write naming any other is refused as PostgREST does.
  const pg = globalThis.fetch;
  const mail = [], stripe = [];
  let trip = null;
  const EVENT_COLS = new Set(['id', 'deal_id', 'site_id', 'kind', 'from_stage', 'to_stage', 'detail', 'actor', 'actor_kind', 'created_at']);
  const answer = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = (init.method || 'GET').toUpperCase();
    if (u.hostname === 'api.resend.com') { mail.push(JSON.parse(String(init.body || '{}'))); return answer({ id: `em_${mail.length}` }); }
    if (u.hostname === 'api.stripe.com') {
      const form = Object.fromEntries(new URLSearchParams(String(init.body || '')));
      stripe.push({ path: u.pathname, form });
      if (u.pathname === '/v1/prices') return answer({ id: `price_${stripe.length}`, unit_amount: Number(form.unit_amount) });
      if (u.pathname === '/v1/payment_links') return answer({ id: `plink_${stripe.length}`, url: `https://pay.example.test/${form['metadata[presence_invoice_id]']}` });
      return answer({});
    }
    const path = decodeURIComponent(u.pathname + u.search);
    if (trip && trip(method, path)) { trip = null; throw new TypeError('connection reset'); }
    if (method === 'POST' && u.pathname === '/rest/v1/presence_deal_events') {
      let b = null; try { b = JSON.parse(String(init.body || 'null')); } catch { b = null; }
      const bad = (Array.isArray(b) ? b : [b]).flatMap((x) => Object.keys(x || {})).find((k) => !EVENT_COLS.has(k));
      if (bad) return answer({ code: 'PGRST204', message: `Could not find the '${bad}' column of 'presence_deal_events' in the schema cache` }, 400);
    }
    return pg(url, init);
  };

  // the real index.ts, with std's serve() handed a fake listener: no socket opens
  const queue = []; let wake = null;
  Deno.listen = () => { let first = true; return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} }; };
  Deno.serveHttp = () => ({ nextRequest: () => new Promise((res) => { if (queue.length) res(queue.shift()); else wake = res; }), close() {} });
  await import('../../supabase/functions/presence/index.ts');
  const SALES = await import('../../supabase/functions/presence/routes/sales.ts');
  const send = (request) => new Promise((resolve) => { const ev = { request, respondWith: async (r) => { resolve(await r); } }; if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev); });
  const call = async (jwt, method, route, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (jwt) headers['x-dds-user-jwt'] = jwt;
    const res = await send(new Request(`https://db.test/functions/v1/presence${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await res.text(); let b = null; try { b = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: b, text };
  };
  const asA = (m, r, b) => call('jwt-a', m, r, b), asB = (m, r, b) => call('jwt-b', m, r, b), pub = (m, r, b) => call(null, m, r, b);
  const tok = (t, idv, site = SITE_A, expIn = 3600) => SALES.signSalesToken({ t, id: idv, site_id: site, exp: Math.floor(Date.now() / 1000) + expIn }, SALES.linkSecret());
  const world = (extra = {}) => { db.reset(base(extra)); db.fail.add('rpc/rate_hit'); mail.length = 0; stripe.length = 0; trip = null; };
  const T = (t) => db.tables[t] || [];
  const row = (t, rid) => T(t).find((r) => r.id === rid);
  const snap = (t, rid) => JSON.stringify(row(t, rid));
  const evs = (dealId, kind) => T('presence_deal_events').filter((e) => e.deal_id === dealId && (!kind || e.kind === kind));
  const invs = (dealId) => T('presence_invoices').filter((i) => i.deal_id === dealId);
  const short = (r) => `${r.status} ${r.text.slice(0, 160)}`;
  const flowView = async (dealId, site = SITE_A) => pub('GET', `/sales/p/${await tok('flow', dealId, site)}`);

  // ═══ 0. depositSplit: the ONE split both the document and the invoice speak ═══
  {
    ok('50/50 on a whole amount', JSON.stringify(depositSplit(380000)) === JSON.stringify({ deposit_cents: 190000, balance_cents: 190000 }));
    const odd = depositSplit(100001);
    ok('an odd total never loses a cent (the deposit rounds, the balance takes the rest)', odd.deposit_cents === 50001 && odd.balance_cents === 50000 && odd.deposit_cents + odd.balance_cents === 100001);
    ok('zero, null or garbage is an honest 0 and 0, never NaN', [0, null, undefined, 'x'].every((v) => { const s = depositSplit(v); return s.deposit_cents === 0 && s.balance_cents === 0; }));
    ok('a negative value clamps to 0 (never a negative invoice)', depositSplit(-500).deposit_cents === 0);
    // the agreement prints exactly the split, on every total (an odd cent, a big number, a tiny one)
    const totals = [1, 3, 99, 100, 101, 12345, 100001, 380000, 999999, 123456789];
    const printedWrong = totals.filter((c) => {
      const v = buildPlaceholderValues({ deal: { expected_value_cents: c }, contact: null, studioName: '', now: new Date(Date.UTC(2026, 7, 7)) });
      const s = depositSplit(c); const cents = [c, s.deposit_cents, s.balance_cents].some((x) => x % 100 !== 0);
      return v.deposit_amount !== formatMoney(s.deposit_cents, cents) || v.balance_amount !== formatMoney(s.balance_cents, cents);
    });
    ok('the agreement prints the deposit and balance of that same split, on every total', printedWrong.length === 0, printedWrong.join(', '));
    const vals = buildPlaceholderValues({ deal: { expected_value_cents: 380000 }, contact: null, studioName: '', now: new Date(Date.UTC(2026, 7, 7)) });
    ok('a $3,800 deal prints a $1,900 deposit and a $1,900 balance', vals.deposit_amount === '$1,900' && vals.balance_amount === '$1,900');
  }

  // ═══ 1. Accept fills the deal value (once, and only this studio's deal) ═══
  {
    const decide = async (pid, token, decision = 'accepted', extra = {}) => pub('POST', `/sales/proposals/${pid}/decide`, { token, decision, ...(decision === 'accepted' ? { name: 'Riley Park' } : {}), ...extra });   // sales item 184: a yes takes a typed name
    world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'proposal' }), dealRow(DEAL_B, SITE_B)], presence_proposals: [propRow(PROP, DEAL, SITE_A, 'sent', LINES_DT)] });
    let r = await decide(PROP, await tok('flow', DEAL));
    ok('accepting on the client’s page answers 200 and the proposal reads accepted', r.status === 200 && r.body?.data?.status === 'accepted' && row('presence_proposals', PROP).status === 'accepted', short(r));
    ok('the deal value fills from the proposal’s final total, after discount and tax ($2,916)', row('presence_deals', DEAL).expected_value_cents === 291600 && proposalTotals(LINES_DT).total_cents === 291600, String(row('presence_deals', DEAL).expected_value_cents));
    const dec = evs(DEAL, 'proposal_decided');
    ok('the change is on the deal’s record: the decision event carries value_backfilled_cents', dec.length === 1 && dec[0].site_id === SITE_A && dec[0].detail.decision === 'accepted' && dec[0].detail.value_backfilled_cents === 291600, JSON.stringify(dec));
    ok('the deal moves on to the agreement stage', row('presence_deals', DEAL).stage === 'contract');
    // sales item 136: the deal's history (the record's timeline, read through the real route) says so
    const story = (await asA('GET', `/sales/deals/${DEAL}`)).body?.data?.timeline || [];
    ok('the deal’s history says the value was filled in: “Proposal accepted — deal value set to $2,916”', story.some((it) => it.text === 'Proposal accepted — deal value set to $2,916'), JSON.stringify(story.map((it) => it.text)));
    const now = '2026-08-10T12:00:00.000Z';
    const summary = summarizePipeline([{ stage: 'won', expected_value_cents: row('presence_deals', DEAL).expected_value_cents, converted_at: '2026-08-09T00:00:00.000Z' }], now);
    ok('a deal won after that rolls up the filled value (never $0 again)', summary.won_month.value_cents === 291600 && summary.won_month.count === 1, `won_month=${summary.won_month.value_cents}`);
    const zero = summarizePipeline([{ stage: 'won', expected_value_cents: 0, converted_at: '2026-08-09T00:00:00.000Z' }], now);
    ok('…which was the defect: a won deal left at 0 rolls up as $0', zero.won_month.value_cents === 0);

    world({ presence_deals: [dealRow(DEAL, SITE_A, { expected_value_cents: 500000 })], presence_proposals: [propRow(PROP, DEAL, SITE_A, 'sent', LINES_DT)] });
    r = await decide(PROP, await tok('proposal', PROP));
    ok('a value the studio set by hand is never overwritten, and the event says nothing was filled', r.status === 200 && row('presence_deals', DEAL).expected_value_cents === 500000 && evs(DEAL, 'proposal_decided').length === 1 && !('value_backfilled_cents' in evs(DEAL, 'proposal_decided')[0].detail), short(r));
    const kept = (await asA('GET', `/sales/deals/${DEAL}`)).body?.data?.timeline || [];
    ok('…and its history says only “Proposal accepted”, naming no value', kept.some((it) => it.text === 'Proposal accepted') && !kept.some((it) => /deal value set to/.test(it.text)), JSON.stringify(kept.map((it) => it.text)));

    world({ presence_deals: [dealRow(DEAL, SITE_A)], presence_proposals: [propRow(PROP, DEAL, SITE_A, 'sent', [{ label: 'Platform build', qty: 2, unit_cents: 75_000_000 }])] });
    r = await decide(PROP, await tok('proposal', PROP));
    ok('a $1.5M proposal fills the deal at the $1,000,000 cap, like every value write', r.status === 200 && row('presence_deals', DEAL).expected_value_cents === 100_000_000 && evs(DEAL, 'proposal_decided')[0]?.detail.value_backfilled_cents === 100_000_000, String(row('presence_deals', DEAL).expected_value_cents));

    world({ presence_deals: [dealRow(DEAL, SITE_A)], presence_proposals: [propRow(PROP, DEAL, SITE_A, 'sent', [{ label: 'Free consult', qty: 1, unit_cents: 0 }])] });
    r = await decide(PROP, await tok('proposal', PROP));
    ok('a $0 proposal fills nothing (the deal stays at 0, the event names no value)', r.status === 200 && row('presence_deals', DEAL).expected_value_cents === 0 && !('value_backfilled_cents' in (evs(DEAL, 'proposal_decided')[0]?.detail || {})), short(r));

    world({ presence_deals: [dealRow(DEAL, SITE_A)], presence_proposals: [propRow(PROP, DEAL, SITE_A, 'sent', LINES_DT)] });
    r = await decide(PROP, await tok('proposal', PROP), 'declined');
    ok('only an accept fills it: a decline leaves the value at 0 and the stage where it was', r.status === 200 && row('presence_proposals', PROP).status === 'declined' && row('presence_deals', DEAL).expected_value_cents === 0 && row('presence_deals', DEAL).stage === 'proposal' && evs(DEAL, 'proposal_decided')[0]?.detail.decision === 'declined' && !('value_backfilled_cents' in evs(DEAL, 'proposal_decided')[0].detail), short(r));

    world({ presence_deals: [dealRow(DEAL, SITE_A)], presence_proposals: [propRow(PROP, DEAL, SITE_A, 'sent', LINES_DT)] });
    trip = (m, p) => m === 'PATCH' && p.startsWith('/rest/v1/presence_deals?') && p.includes('expected_value_cents=eq.0');
    r = await decide(PROP, await tok('proposal', PROP));
    ok('a fill that fails can’t sink the accept: 200, accepted, moved on, and nothing claims a value', r.status === 200 && row('presence_proposals', PROP).status === 'accepted' && row('presence_deals', DEAL).stage === 'contract' && row('presence_deals', DEAL).expected_value_cents === 0 && !('value_backfilled_cents' in (evs(DEAL, 'proposal_decided')[0]?.detail || {})) && trip === null, short(r));

    // another studio's proposal pointing at this studio's deal: accepting it touches nothing here
    world({ presence_deals: [dealRow(DEAL, SITE_A), dealRow(DEAL_B, SITE_B)], presence_proposals: [propRow(PROP_B, DEAL, SITE_B, 'sent', LINES_DT)] });
    const mine = snap('presence_deals', DEAL);
    r = await decide(PROP_B, await tok('proposal', PROP_B, SITE_B));
    ok('another studio’s proposal that names this studio’s deal fills nothing here: the deal stays exactly as it was', r.status === 200 && snap('presence_deals', DEAL) === mine && !T('presence_deal_events').some((e) => e.site_id === SITE_A), `${short(r)} ${snap('presence_deals', DEAL)}`);

    // the link is the only key, and it opens one door
    const base1 = () => world({ presence_deals: [dealRow(DEAL, SITE_A), dealRow(DEAL_2, SITE_A, { title: 'Another deal' })], presence_proposals: [propRow(PROP, DEAL, SITE_A, 'sent', LINES_DT), propRow(PROP_2, DEAL_2, SITE_A, 'sent', LINES_DT)] });
    const untouched = () => row('presence_proposals', PROP).status === 'sent' && row('presence_deals', DEAL).expected_value_cents === 0 && !evs(DEAL).length;
    base1(); r = await decide(PROP, await tok('proposal', PROP_2));
    ok('a link to one proposal can’t decide another (403, nothing changes)', r.status === 403 && r.body?.error === 'invalid_link' && untouched(), short(r));
    base1(); r = await decide(PROP, await tok('flow', DEAL_2));
    ok('a deal’s link can’t decide a proposal on another deal (403, nothing changes)', r.status === 403 && untouched(), short(r));
    base1(); r = await decide(PROP, await tok('proposal', PROP, SITE_B));
    ok('a link signed for another studio can’t reach this studio’s proposal (404, nothing changes)', r.status === 404 && untouched(), short(r));
    base1(); { const good = await tok('proposal', PROP_2); const forged = btoa(JSON.stringify({ t: 'proposal', id: PROP, site_id: SITE_A, exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + good.split('.')[1]; r = await decide(PROP, forged); }
    ok('a link whose words were changed after signing is refused (403)', r.status === 403 && untouched(), short(r));
    base1(); r = await decide(PROP, await tok('proposal', PROP, SITE_A, -60));
    ok('an expired link is refused (403)', r.status === 403 && untouched(), short(r));
    base1(); r = await decide(PROP, '');
    ok('no link at all is refused (403)', r.status === 403 && untouched(), short(r));
  }

  // ═══ 2. Agreement send mints the deposit (once, honestly) ═══
  {
    const sendCon = (cid, as = asA) => as('POST', `/sales/contracts/${cid}/send`);
    world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'contract', expected_value_cents: 380000 })], presence_contracts: [conRow(CON, DEAL, SITE_A, 'draft', BODY_DEPOSIT)] });
    let r = await sendCon(CON);
    let inv = invs(DEAL);
    ok('a fresh send answers 200, marks the agreement sent and hands the minted deposit back to the drawer', r.status === 200 && row('presence_contracts', CON).status === 'sent' && r.body?.deposit?.minted === true && r.body.deposit.amount_cents === 190000 && r.body.deposit.invoice_id === inv[0]?.id, short(r));
    ok('the deposit is half the deal value, the same figure the agreement prints ($1,900 of $3,800)', inv.length === 1 && inv[0].amount_cents === depositSplit(380000).deposit_cents && formatMoney(inv[0].amount_cents) === buildPlaceholderValues({ deal: { expected_value_cents: 380000 }, contact: null }).deposit_amount, JSON.stringify(inv));
    ok('it is an open deposit request on this studio’s deal, with its Stripe pay link', inv[0]?.site_id === SITE_A && inv[0].purpose === 'deposit' && inv[0].status === 'open' && inv[0].currency === 'usd' && inv[0].stripe_url === `https://pay.example.test/${inv[0].id}` && stripe.some((s) => s.path === '/v1/prices' && s.form.unit_amount === '190000'), JSON.stringify(inv[0]));
    const auto = evs(DEAL, 'invoice_sent');
    ok('the deal’s record says so, marked automatic (invoice_sent from contract_send)', auto.length === 1 && JSON.stringify(auto[0].detail) === JSON.stringify({ invoice_id: inv[0]?.id, amount_cents: 190000, purpose: 'deposit', auto: 'contract_send' }) && evs(DEAL, 'contract_sent').length === 1, JSON.stringify(auto));
    ok('one email goes out, the agreement; the deposit is not emailed (its pay link waits on the sign page)', mail.length === 1 && mail[0].to === 'riley@example.com' && mail[0].subject === 'Your agreement is ready to sign' && !JSON.stringify(mail).includes('pay.example.test'), JSON.stringify(mail.map((m) => [m.to, m.subject])));
    ok('the link handed back is the deal’s one page', /^https:\/\/app\.example\.com\/sign\.html\?t=/.test(r.body?.url || ''), r.body?.url);

    // signing on that page lands on pay
    const pay = inv[0];
    r = await pub('POST', `/sales/contracts/${CON}/sign`, { token: await tok('flow', DEAL), signer_name: 'Riley Park', signer_email: 'riley@example.com', presented_hash: HASH });
    ok('signing then hands back that deposit’s pay link and amount', r.status === 200 && r.body?.data?.status === 'signed' && r.body.data.pay_url === pay?.stripe_url && r.body.data.pay_amount_cents === 190000, short(r));

    // the same shape "Request a deposit" writes, by its own route
    world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'contract', expected_value_cents: 380000 }), dealRow(DEAL_2, SITE_A, { stage: 'contract', expected_value_cents: 380000 })], presence_contracts: [conRow(CON, DEAL, SITE_A, 'draft', BODY_DEPOSIT)] });
    await sendCon(CON);
    r = await asA('POST', `/sales/deals/${DEAL_2}/invoice`, { purpose: 'deposit', amount_cents: 190000 });
    const [minted] = invs(DEAL), [asked] = invs(DEAL_2);
    const shape = (i) => i && JSON.stringify([i.title, i.description, i.currency, i.purpose, i.status, i.due_date, i.customer_client_id, i.customer_site_id, i.amount_cents, i.created_by]);
    ok('the minted row has the same shape "Request a deposit" writes (title, wording, currency, purpose, open, no due date)', r.status === 201 && !!minted && shape(minted) === shape(asked), `${shape(minted)} vs ${shape(asked)}`);

    // the agreement from a template prints the deposit the send then mints
    world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'contract', expected_value_cents: 100001 })],
      presence_sales_templates: [{ id: TPL, site_id: SITE_A, kind: 'contract', name: 'Standard', title: 'Service agreement', body: 'Project fee {{deal_value}}. A deposit of {{deposit_amount}} is due at signing; {{balance_amount}} before launch.', deleted_at: null }] });
    r = await asA('POST', `/sales/deals/${DEAL}/contracts`, { template_id: TPL });
    const drafted = T('presence_contracts')[0];
    const sent = drafted ? await sendCon(drafted.id) : { status: 0, text: 'no draft' };
    inv = invs(DEAL);
    ok('an odd total: the drafted agreement says a deposit of $500.01, and the send mints exactly $500.01', r.status === 201 && /A deposit of \$500\.01 is due at signing; \$500\.00 before launch/.test(drafted?.body || '') && sent.status === 200 && inv.length === 1 && inv[0].amount_cents === 50001 && (drafted.body || '').includes(formatMoney(inv[0].amount_cents, true)), `${drafted?.body} · ${JSON.stringify(inv)}`);

    // never a ~$0 invoice; a valueless deal warns
    for (const [value, wanted] of [[98, null], [100, 50], [0, null]]) {
      world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'contract', expected_value_cents: value })], presence_contracts: [conRow(CON, DEAL, SITE_A, 'draft', BODY_DEPOSIT)] });
      r = await sendCon(CON);
      if (wanted) ok(`a $${(value / 100).toFixed(2)} deal mints a deposit of exactly ${wanted}¢ (Stripe’s 50¢ floor is met)`, r.status === 200 && invs(DEAL).length === 1 && invs(DEAL)[0].amount_cents === wanted && r.body.deposit.minted === true, short(r));
      else ok(`a $${(value / 100).toFixed(2)} deal mints nothing and warns no_value (the agreement printed a blank, not a number); the send still goes`, r.status === 200 && row('presence_contracts', CON).status === 'sent' && !invs(DEAL).length && r.body?.deposit?.minted === false && r.body.deposit.warning === 'no_value', short(r));
    }
    world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'contract', expected_value_cents: 380000 })], presence_contracts: [conRow(CON, DEAL, SITE_A, 'draft', 'Five core pages, built on the studio’s platform. Payment terms are on the invoice.')] });
    r = await sendCon(CON);
    ok('an agreement that never says "deposit" made no promise, so nothing is minted (and no warning)', r.status === 200 && !invs(DEAL).length && r.body?.deposit?.minted === false && !r.body.deposit.warning, short(r));

    // at most once, ever: any deposit already on the deal, whatever its state
    for (const status of ['open', 'paid', 'void']) {
      world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'contract', expected_value_cents: 380000 })], presence_contracts: [conRow(CON, DEAL, SITE_A, 'draft', BODY_DEPOSIT)], presence_invoices: [invRow(id(80), DEAL, SITE_A, { status })] });
      r = await sendCon(CON);
      ok(`a deposit already on the deal (${status}) means no second one`, r.status === 200 && invs(DEAL).length === 1 && r.body?.deposit?.minted === false && !stripe.length, short(r));
    }
    world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'contract', expected_value_cents: 380000 })], presence_contracts: [conRow(CON, DEAL, SITE_A, 'draft', BODY_DEPOSIT)], presence_invoices: [invRow(id(80), DEAL, SITE_A, { deleted_at: T0 })] });
    r = await sendCon(CON);
    ok('a deleted deposit row doesn’t count: the send mints a fresh one', r.status === 200 && invs(DEAL).filter((i) => !i.deleted_at).length === 1 && r.body?.deposit?.minted === true, short(r));
    // another studio's row naming this deal blocks nothing here
    world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'contract', expected_value_cents: 380000 }), dealRow(DEAL_B, SITE_B)], presence_contracts: [conRow(CON, DEAL, SITE_A, 'draft', BODY_DEPOSIT)], presence_invoices: [invRow(id(81), DEAL, SITE_B, { status: 'paid' })] });
    r = await sendCon(CON);
    ok('another studio’s deposit row that names this deal blocks nothing: this studio’s own deposit is minted', r.status === 200 && r.body?.deposit?.minted === true && invs(DEAL).filter((i) => i.site_id === SITE_A).length === 1 && row('presence_invoices', id(81)).status === 'paid', short(r));

    // best-effort: a mint that fails never blocks the send
    world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'contract', expected_value_cents: 380000 })], presence_contracts: [conRow(CON, DEAL, SITE_A, 'draft', BODY_DEPOSIT)] });
    trip = (m, p) => m === 'GET' && p.startsWith('/rest/v1/presence_invoices?') && p.includes('purpose=eq.deposit');
    r = await sendCon(CON);
    ok('a mint that fails midway never blocks the send: 200, sent, emailed, nothing minted', r.status === 200 && row('presence_contracts', CON).status === 'sent' && r.body?.emailed === true && r.body.deposit?.minted === false && !invs(DEAL).length && trip === null, short(r));

    // a RESEND makes sure the deposit exists, once
    world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'contract', expected_value_cents: 380000 })], presence_contracts: [conRow(CON, DEAL, SITE_A, 'sent', BODY_DEPOSIT)] });
    r = await sendCon(CON);
    ok('a resend of an agreement sent before the deposit existed mints it (already_sent, link back, no email)', r.status === 200 && r.body?.already_sent === true && r.body.deposit?.minted === true && invs(DEAL).length === 1 && !mail.length && /sign\.html\?t=/.test(r.body.url || ''), short(r));
    r = await sendCon(CON);
    ok('…and resending again never mints a second', r.status === 200 && r.body?.deposit?.minted === false && invs(DEAL).length === 1 && !mail.length, short(r));

    // this studio's agreement, sent by another studio
    world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'contract', expected_value_cents: 380000 }), dealRow(DEAL_B, SITE_B)], presence_contracts: [conRow(CON, DEAL, SITE_A, 'draft', BODY_DEPOSIT)] });
    const before = snap('presence_contracts', CON);
    r = await sendCon(CON, asB);
    ok('another studio can’t send this studio’s agreement: 404, it stays a draft, nothing minted or emailed', r.status === 404 && snap('presence_contracts', CON) === before && !T('presence_invoices').length && !mail.length && !stripe.length, short(r));
    r = await pub('POST', `/sales/contracts/${CON}/send`);
    ok('not signed in: 401 and nothing moves', r.status === 401 && snap('presence_contracts', CON) === before, short(r));
  }

  // ═══ 2b. ONE LINK from proposal to deposit ═══
  // The deal's one page: a `flow` token bound to the DEAL carries choose → sign → pay. The
  // agreement's words leave the server only once the proposal is accepted, the pay link
  // only once the agreement is signed, and the sign route holds the same order.
  {
    const SENT_DEP = invRow(id(82), DEAL, SITE_A);
    world({ presence_deals: [dealRow(DEAL, SITE_A)], presence_proposals: [propRow(PROP, DEAL, SITE_A, 'sent', LINES_DT)], presence_contracts: [conRow(CON, DEAL, SITE_A, 'sent', BODY_DEPOSIT)], presence_invoices: [SENT_DEP] });
    let r = await flowView(DEAL);
    let d = r.body?.data || {};
    ok('the page reads the deal’s proposal, and the agreement only as locked: no words, no fingerprint', r.status === 200 && d.kind === 'flow' && d.proposal?.id === PROP && d.contract?.locked === true && d.contract.id === CON && !('body' in d.contract) && !('content_hash' in d.contract), short(r));
    ok('…and the deposit shows, with no pay link before signing', d.deposit?.amount_cents === 190000 && d.deposit.status === 'open' && d.deposit.url === null, JSON.stringify(d.deposit));
    ok('the answer always says whether a proposal or agreement is pending', 'proposal_pending' in d && 'contract_pending' in d && d.proposal_pending === false && d.contract_pending === false);
    r = await pub('POST', `/sales/contracts/${CON}/sign`, { token: await tok('flow', DEAL), signer_name: 'Riley Park', signer_email: 'riley@example.com', presented_hash: HASH });
    ok('signing before accepting is refused: 409 accept_first, "Accept the proposal first", still unsigned', r.status === 409 && r.body?.error === 'accept_first' && /Accept the proposal first/.test(r.body.message) && row('presence_contracts', CON).status === 'sent', short(r));

    r = await pub('POST', `/sales/proposals/${PROP}/decide`, { token: await tok('flow', DEAL), decision: 'accepted', name: 'Riley Park' });
    d = (await flowView(DEAL)).body?.data || {};
    ok('once accepted, the agreement’s words and fingerprint come back (the fingerprint the sign route checks)', r.status === 200 && d.contract?.body === BODY_DEPOSIT && d.contract.content_hash === HASH && !d.contract.locked, JSON.stringify(d.contract));
    const unsignedPdf = d.contract && 'pdf_url' in d.contract;
    ok('…and still no pay link until it is signed', d.deposit?.url === null);
    r = await pub('POST', `/sales/contracts/${CON}/sign`, { token: await tok('flow', DEAL), signer_name: 'Riley Park', signer_email: 'riley@example.com', presented_hash: HASH });
    d = (await flowView(DEAL)).body?.data || {};
    ok('signed with an open deposit: now the page gets the pay link', r.status === 200 && row('presence_contracts', CON).status === 'signed' && d.deposit?.url === SENT_DEP.stripe_url && d.deposit.processing === false, `${short(r)} ${JSON.stringify(d.deposit)}`);

    const signedWith = (dep) => world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'won' })], presence_proposals: [propRow(PROP, DEAL, SITE_A, 'accepted', LINES_DT)], presence_contracts: [conRow(CON, DEAL, SITE_A, 'signed', BODY_DEPOSIT, { signed_at: T0, signer_name: 'Riley Park' })], presence_invoices: dep ? [dep] : [] });
    signedWith(invRow(id(82), DEAL, SITE_A, { processing_since: T0 }));
    d = (await flowView(DEAL)).body?.data || {};
    ok('a bank payment already settling: no pay link, and the page is told it is on its way', d.deposit?.url === null && d.deposit.processing === true, JSON.stringify(d.deposit));
    signedWith(invRow(id(82), DEAL, SITE_A, { status: 'paid', paid_at: T0 }));
    d = (await flowView(DEAL)).body?.data || {};
    ok('a paid deposit still shows (status paid, when) so the page can say "deposit paid"', d.deposit?.status === 'paid' && d.deposit.paid_at === T0 && d.deposit.url === null, JSON.stringify(d.deposit));
    ok('a signed agreement comes with a link to its signed PDF; one not yet signed has none', /^https:\/\/db\.test\/functions\/v1\/presence\/sales\/doc\/[^?]+\?format=pdf$/.test(d.contract?.pdf_url || '') && unsignedPdf === false, `${d.contract?.pdf_url} ${unsignedPdf}`);
    signedWith(invRow(id(82), DEAL, SITE_A, { status: 'void' }));
    d = (await flowView(DEAL)).body?.data || {};
    ok('a voided deposit is not offered at all', d.deposit === null, JSON.stringify(d.deposit));

    // the deal's current proposal, as the page and the sign route both read it
    const flowCase = async (props, cons = [conRow(CON, DEAL, SITE_A, 'sent', BODY_DEPOSIT)]) => {
      world({ presence_deals: [dealRow(DEAL, SITE_A)], presence_proposals: props, presence_contracts: cons });
      const v = (await flowView(DEAL)).body?.data || {};
      const s = await pub('POST', `/sales/contracts/${CON}/sign`, { token: await tok('flow', DEAL), signer_name: 'Riley Park', signer_email: 'riley@example.com', presented_hash: HASH });
      return { v, s };
    };
    const supd = (p, by) => ({ ...p, line_items: [...p.line_items, { __meta__: { superseded_by: by } }] });
    const v1 = propRow(PROP, DEAL, SITE_A, 'sent', [{ label: 'Site', qty: 1, unit_cents: 380000 }], { created_at: '2026-11-01T10:00:00.000Z' });
    const v2 = propRow(V2, DEAL, SITE_A, 'draft', [{ label: 'Site', qty: 1, unit_cents: 360000 }], { created_at: '2026-11-02T10:00:00.000Z', version: 2 });
    let c = await flowCase([v2, supd(v1, V2)]);
    ok('between versions (v1 revised, v2 still a draft): no current proposal, pending, the agreement locked', c.v.proposal === null && c.v.proposal_pending === true && c.v.contract?.locked === true && !('body' in (c.v.contract || {})), JSON.stringify([c.v.proposal, c.v.proposal_pending, c.v.contract]));
    ok('…and the sign route refuses: 409 accept_first, "updating the proposal", still unsigned', c.s.status === 409 && c.s.body?.error === 'accept_first' && /updating the proposal/.test(c.s.body.message) && row('presence_contracts', CON).status === 'sent', short(c.s));
    c = await flowCase([v2, supd({ ...v1, status: 'declined' }, V2)]);
    ok('a declined v1 revised into a draft v2 is pending too (locked, signing refused)', c.v.proposal === null && c.v.proposal_pending === true && c.s.status === 409 && c.s.body?.error === 'accept_first');
    c = await flowCase([{ ...v2, status: 'sent' }, supd(v1, V2)]);
    ok('after v2 is sent it is the current proposal; still unaccepted, so signing is refused', c.v.proposal?.id === V2 && c.v.proposal_pending === false && c.v.contract?.locked === true && c.s.status === 409 && /Accept the proposal first/.test(c.s.body?.message || ''), JSON.stringify(c.v.proposal?.id));
    c = await flowCase([{ ...v2, status: 'accepted' }, supd(v1, V2)]);
    ok('after v2 is accepted the agreement opens and signing goes through', c.v.proposal?.id === V2 && c.v.contract?.body === BODY_DEPOSIT && c.s.status === 200 && row('presence_contracts', CON).status === 'signed', short(c.s));
    c = await flowCase([propRow(PROP_2, DEAL, SITE_A, 'sent', LINES_DT, { created_at: '2026-11-03T10:00:00.000Z' }), propRow(PROP, DEAL, SITE_A, 'accepted', LINES_DT)]);
    ok('an accepted proposal wins over a newer sent one (the agreement stays open)', c.v.proposal?.id === PROP && c.v.contract?.body === BODY_DEPOSIT && c.s.status === 200, JSON.stringify(c.v.proposal?.id));
    c = await flowCase([propRow(PROP, DEAL, SITE_A, 'declined', LINES_DT)]);
    ok('a declined (not revised) proposal keeps the agreement locked, with the declined wording', c.v.proposal?.status === 'declined' && c.v.contract?.locked === true && c.s.status === 409 && /declined/.test(c.s.body?.message || ''), short(c.s));
    c = await flowCase([]);
    ok('a deal that never had a proposal starts at the agreement: readable, and signing goes through', c.v.proposal === null && c.v.proposal_pending === false && c.v.contract?.body === BODY_DEPOSIT && c.s.status === 200, short(c.s));
    c = await flowCase([v2]);
    ok('a never-sent draft alone is not pending (the studio sent the agreement on its own)', c.v.proposal === null && c.v.proposal_pending === false && c.v.contract?.body === BODY_DEPOSIT && c.s.status === 200, short(c.s));
    c = await flowCase([{ ...supd(v1, V2), deleted_at: T0 }]);
    ok('a deleted proposal counts for nothing', c.v.proposal === null && c.v.proposal_pending === false && c.s.status === 200);
    world({ presence_deals: [dealRow(DEAL, SITE_A)], presence_proposals: [propRow(PROP, DEAL, SITE_A, 'accepted', LINES_DT)], presence_contracts: [conRow(CON, DEAL, SITE_A, 'draft', BODY_DEPOSIT)] });
    d = (await flowView(DEAL)).body?.data || {};
    ok('an agreement drafted but not sent: no agreement on the page, and contract_pending says it is being prepared', d.contract === null && d.contract_pending === true, JSON.stringify([d.contract, d.contract_pending]));

    // the same rules as the pure helpers the routes lean on
    const sup = (rw, by) => ({ ...rw, line_items: [...rw.line_items, { __meta__: { superseded_by: by } }] });
    const pv1 = { id: 'v1', status: 'sent', line_items: [{ label: 'Site', qty: 1, unit_cents: 380000 }] };
    const pv2 = { id: 'v2', status: 'draft', line_items: [{ label: 'Site', qty: 1, unit_cents: 360000 }] };
    const win = currentProposal([pv2, sup(pv1, 'v2')]);
    ok('currentProposal: v1 superseded and v2 a draft is no proposal, pending', win.proposal === null && win.pending === true);
    ok('flowSignGate: …refused as accept_first, "updating the proposal"', (() => { const g = flowSignGate(win); return !!g && g.error === 'accept_first' && /updating the proposal/.test(g.message); })());
    const dtr = currentProposal([pv2, sup({ ...pv1, status: 'declined' }, 'v2')]);
    ok('currentProposal: a declined v1 revised into a draft v2 is pending too', dtr.proposal === null && dtr.pending === true && flowSignGate(dtr)?.error === 'accept_first');
    const s2 = currentProposal([{ ...pv2, status: 'sent' }, sup(pv1, 'v2')]);
    ok('currentProposal: after v2 is sent it is current, not pending; the gate says "Accept the proposal first"', s2.proposal?.id === 'v2' && s2.pending === false && /Accept the proposal first/.test(flowSignGate(s2)?.message || ''));
    const a2 = currentProposal([{ ...pv2, status: 'accepted' }, sup(pv1, 'v2')]);
    ok('currentProposal: after v2 is accepted the gate opens and v2 wins', a2.proposal?.id === 'v2' && flowSignGate(a2) === null);
    ok('currentProposal: an accepted proposal wins over a newer sent one', currentProposal([{ id: 'b', status: 'sent', line_items: [] }, { id: 'a', status: 'accepted', line_items: [] }]).proposal?.id === 'a');
    const dOnly = currentProposal([{ ...pv1, status: 'declined' }]);
    ok('currentProposal: a declined (not revised) proposal locks with the declined wording', dOnly.proposal?.status === 'declined' && /declined/.test(flowSignGate(dOnly)?.message || ''));
    const none = currentProposal([]);
    ok('currentProposal: no proposal in play starts at the agreement (not pending, gate open)', none.proposal === null && none.pending === false && flowSignGate(none) === null);
    const dr = currentProposal([pv2]);
    ok('currentProposal: a never-sent draft alone is not pending', dr.proposal === null && dr.pending === false);
    const del = currentProposal([{ ...sup(pv1, 'v2'), deleted_at: '2026-10-20T00:00:00Z' }]);
    ok('currentProposal: a soft-deleted row counts for nothing', del.proposal === null && del.pending === false);
    ok('currentProposal: garbage in, empty out, never a throw', currentProposal(null).proposal === null && currentProposal([null, 3, 'x']).pending === false);

    // this studio's page never shows another studio's rows, whatever they name
    world({ presence_deals: [dealRow(DEAL, SITE_A), dealRow(DEAL_B, SITE_B)], presence_contracts: [conRow(CON, DEAL, SITE_A, 'sent', BODY_DEPOSIT)],
      presence_proposals: [propRow(PROP_B, DEAL, SITE_B, 'accepted', LINES_DT)], presence_invoices: [invRow(id(83), DEAL, SITE_B)] });
    db.tables.presence_contracts.push(conRow(CON_B, DEAL, SITE_B, 'signed', 'Another studio’s words.', { created_at: '2026-11-05T10:00:00.000Z' }));
    d = (await flowView(DEAL)).body?.data || {};
    ok('rows of another studio that name this deal never reach its page (no proposal, its own agreement, no deposit)', d.proposal === null && d.proposal_pending === false && d.contract?.id === CON && d.deposit === null, JSON.stringify([d.proposal?.id, d.contract?.id, d.deposit]));
    let x = await flowView(DEAL_B, SITE_A);
    ok('a page link signed for this studio can’t open another studio’s deal (404)', x.status === 404 && !/Other studio deal/.test(x.text), short(x));
    x = await pub('GET', `/sales/p/${(await tok('flow', DEAL)).replace(/.$/, (ch) => ch === '0' ? '1' : '0')}`);
    ok('a page link with a broken signature is refused (403)', x.status === 403, short(x));
    world({ presence_deals: [dealRow(DEAL, SITE_A), dealRow(DEAL_B, SITE_B)], presence_contracts: [conRow(CON, DEAL, SITE_A, 'sent', BODY_DEPOSIT)] });
    const unsigned = snap('presence_contracts', CON);
    x = await pub('POST', `/sales/contracts/${CON}/sign`, { token: await tok('flow', DEAL, SITE_B), signer_name: 'Mallory Grey', signer_email: 'mallory@example.com', presented_hash: HASH });
    ok('a link signed for another studio, even one naming this deal, can’t sign this studio’s agreement (404, still unsigned)', x.status === 404 && snap('presence_contracts', CON) === unsigned && !evs(DEAL, 'contract_signed').length, short(x));

    // ── the combined send: one email, the same transitions each send makes ──
    const both = (dealId, pid, cid, stage = 'qualified') => [dealRow(dealId, SITE_A, { stage, expected_value_cents: 500000 }), propRow(pid, dealId, SITE_A, 'draft', LINES_DT), conRow(cid, dealId, SITE_A, 'draft', BODY_DEPOSIT)];
    const [dA, pA, cA] = both(DEAL, PROP, CON), [dT, pT, cT] = both(DEAL_T, PROP_T, CON_T);
    world({ presence_deals: [dA, dT, dealRow(DEAL_B, SITE_B)], presence_proposals: [pA, pT], presence_contracts: [cA, cT] });
    r = await asA('POST', `/sales/deals/${DEAL}/send`, {});
    const mailBoth = mail.splice(0);
    ok('the one-link send answers 200 and says both went out', r.status === 200 && r.body?.sent?.proposal === true && r.body.sent.contract === true && r.body.emailed === true && /sign\.html\?t=/.test(r.body.url || ''), short(r));
    ok('ONE email, "Your proposal and agreement from Bright Studio", to the client, carrying the one link', mailBoth.length === 1 && mailBoth[0].to === 'riley@example.com' && mailBoth[0].subject === 'Your proposal and agreement from Bright Studio' && mailBoth[0].html.includes(r.body?.url), JSON.stringify(mailBoth.map((m) => m.subject)));
    ok('the deposit minted with it is not emailed either', r.body?.data?.deposit?.minted === true && invs(DEAL).length === 1 && !JSON.stringify(mailBoth).includes('pay.example.test'), JSON.stringify(r.body?.data?.deposit));
    const pr1 = row('presence_proposals', PROP), cr1 = row('presence_contracts', CON);
    ok('the proposal is sent with a date and a 30-day expiry; the agreement is sent', pr1.status === 'sent' && !!pr1.sent_at && Math.abs(Date.parse(pr1.expires_at) - Date.now() - 30 * 86400_000) < 120_000 && cr1.status === 'sent' && !!cr1.sent_at, JSON.stringify([pr1.status, pr1.expires_at, cr1.status]));
    // the twin deal goes out the old way, one document at a time
    const pOne = await asA('POST', `/sales/proposals/${PROP_T}/send`), cOne = await asA('POST', `/sales/contracts/${CON_T}/send`);
    const mailEach = mail.splice(0);
    const kinds = (dealId) => evs(dealId).map((e) => `${e.kind}${e.to_stage ? '>' + e.to_stage : ''}${e.detail?.auto ? '/' + e.detail.auto : ''}`).sort().join(' ');
    const prT = row('presence_proposals', PROP_T), crT = row('presence_contracts', CON_T);
    ok('each draft makes the same move its own send makes: the same events, stage, statuses and deposit', pOne.status === 200 && cOne.status === 200 && kinds(DEAL) === 'contract_sent invoice_sent/contract_send proposal_sent stage_change>proposal' && kinds(DEAL) === kinds(DEAL_T) && row('presence_deals', DEAL).stage === row('presence_deals', DEAL_T).stage && row('presence_deals', DEAL).stage === 'proposal'
      && prT.status === pr1.status && !!prT.sent_at && !!prT.expires_at && crT.status === cr1.status && JSON.stringify(invs(DEAL).map((i) => [i.amount_cents, i.purpose, i.status])) === JSON.stringify(invs(DEAL_T).map((i) => [i.amount_cents, i.purpose, i.status])), `${kinds(DEAL)} | ${kinds(DEAL_T)}`);
    ok('…where sending them one at a time is two emails', mailEach.length === 2);

    world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'contract', expected_value_cents: 500000 })], presence_proposals: [propRow(PROP, DEAL, SITE_A, 'draft', LINES_DT)], presence_contracts: [conRow(CON, DEAL, SITE_A, 'sent', BODY_DEPOSIT)] });
    r = await asA('POST', `/sales/deals/${DEAL}/send`, {});
    ok('an agreement already out still gets its deposit when the proposal goes with it', r.status === 200 && r.body?.sent?.proposal === true && r.body.sent.contract === false && r.body.data?.deposit?.minted === true && invs(DEAL).length === 1, short(r));
    mail.length = 0;
    r = await asA('POST', `/sales/deals/${DEAL}/send`, {});
    ok('nothing newly out: no second email, already_sent with the link handed back, and no second deposit', r.status === 200 && r.body?.already_sent === true && r.body.emailed === false && r.body.sent?.proposal === false && r.body.sent.contract === false && /sign\.html\?t=/.test(r.body.url || '') && !mail.length && invs(DEAL).length === 1, short(r));

    world({ presence_deals: [dealRow(DEAL, SITE_A, { stage: 'qualified', expected_value_cents: 500000 }), dealRow(DEAL_B, SITE_B)], presence_proposals: [propRow(PROP, DEAL, SITE_A, 'draft', LINES_DT)], presence_contracts: [conRow(CON, DEAL, SITE_A, 'draft', BODY_DEPOSIT)] });
    const pBefore = snap('presence_proposals', PROP), cBefore = snap('presence_contracts', CON);
    r = await asB('POST', `/sales/deals/${DEAL}/send`, {});
    ok('another studio can’t send this studio’s deal: 404, both stay drafts, no email, no deposit', r.status === 404 && snap('presence_proposals', PROP) === pBefore && snap('presence_contracts', CON) === cBefore && !mail.length && !T('presence_invoices').length, short(r));
  }

  // ═══ 3. The drawer stops contradicting itself on signed deals ═══
  {
    ok('agreementSigned: a signed agreement row is true', agreementSigned([{ status: 'sent' }, { status: 'signed' }]) === true);
    ok('agreementSigned: sent or draft only is false', agreementSigned([{ status: 'sent' }, { status: 'draft' }]) === false);
    ok('agreementSigned: a soft-deleted signed row does not count', agreementSigned([{ status: 'signed', deleted_at: '2026-01-01' }]) === false);
    ok('agreementSigned: garbage in is false, never a throw', agreementSigned(null) === false && agreementSigned('x') === false && agreementSigned([null, 42]) === false);
    ok('an unsigned agreement stage keeps the stage copy', guidanceFor('contract') === PIPELINE_GUIDANCE.contract && guidanceFor('contract', {}) === PIPELINE_GUIDANCE.contract);
    ok('signed and not converted gets the convert copy, never "Get it signed"', guidanceFor('contract', { agreement_signed: true }) === CONTRACT_SIGNED_GUIDANCE && !/signed/i.test(CONTRACT_SIGNED_GUIDANCE.suggested_action));
    ok('the signed copy tells him to convert', /convert/i.test(CONTRACT_SIGNED_GUIDANCE.tip) && /convert/i.test(CONTRACT_SIGNED_GUIDANCE.suggested_action));
    ok('converted falls back to the stage table (the drawer shows such a deal as won)', guidanceFor('contract', { agreement_signed: true, converted: true }) === PIPELINE_GUIDANCE.contract);
    ok('other stages ignore the facts', guidanceFor('proposal', { agreement_signed: true }) === PIPELINE_GUIDANCE.proposal);
    const g = CONTRACT_SIGNED_GUIDANCE;
    ok('the signed copy keeps the calm bounds (tip ≤160, action ≤120, 2 to 5 to-dos ≤200, no markup)',
      g.tip.length <= 160 && g.suggested_action.length <= 120 && g.todos.length >= 2 && g.todos.length <= 5 && g.todos.every((t) => t.length <= 200 && !/[<>]/.test(t)) && !/[<>]/.test(g.tip + g.suggested_action));

    // pipeline.html keeps its own copy of the table and the branch, by hand: run it as the page does
    const pipe = read('pipeline.html');
    const gFrom = pipe.indexOf('const PIPELINE_GUIDANCE={'), gTo = pipe.indexOf('// ── Renewal-term detection');
    let M = null; try { M = new Function(`${pipe.slice(gFrom, gTo)}\nreturn { PIPELINE_GUIDANCE, CONTRACT_SIGNED_GUIDANCE, guidanceFor };`)(); } catch { M = null; }
    const same = (a, b) => !!a && !!b && a.tip === b.tip && a.action === b.suggested_action && JSON.stringify(a.todos) === JSON.stringify(b.todos);
    ok('the page’s signed-deal copy is the server’s word for word (tip, action, to-dos)', !!M && same(M.CONTRACT_SIGNED_GUIDANCE, CONTRACT_SIGNED_GUIDANCE), JSON.stringify(M && M.CONTRACT_SIGNED_GUIDANCE));
    ok('the page’s guidance picks the signed copy exactly when the server does (contract: unsigned, signed, signed and converted; another stage)', !!M
      && same(M.guidanceFor('contract', {}), guidanceFor('contract', {}))
      && same(M.guidanceFor('contract', { signed: true, converted: false }), guidanceFor('contract', { agreement_signed: true }))
      && same(M.guidanceFor('contract', { signed: true, converted: true }), guidanceFor('contract', { agreement_signed: true, converted: true }))
      && same(M.guidanceFor('proposal', { signed: true }), guidanceFor('proposal', { agreement_signed: true })));
  }

  // ═══ 4. The renewal reminder can actually arm ═══
  {
    ok('"12-month term" reads as 12', impliedTermMonths('This engagement is a 12-month term beginning at signing.') === 12);
    ok('"a term of twelve (12) months" reads as 12', impliedTermMonths('The term of this Agreement is twelve (12) months.') === 12);
    ok('"for a term of 6 months" reads as 6', impliedTermMonths('The parties engage for a term of 6 months.') === 6);
    ok('"for a period of three (3) months" reads as 3', impliedTermMonths('Reporting continues for a period of three (3) months.') === 3);
    const LOOKBACK = 'in no event shall studio’s total liability exceed the fees paid by client to studio under this agreement in the twelve (12) months immediately preceding the event giving rise to the claim';
    ok('§10’s liability lookback never reads as a term (no invented dates)', impliedTermMonths(LOOKBACK) === null);
    ok('"thirty (30) days" is not months', impliedTermMonths('negotiate for a minimum period of thirty (30) days') === null);
    ok('empty or garbage is null, never a throw', impliedTermMonths('') === null && impliedTermMonths(null) === null && impliedTermMonths(12) === null);
    ok('absurd terms are refused (0 or over 60 months)', impliedTermMonths('a 99-month term') === null);

    // the agreements pipeline.html ships state no operative term, so no default may come from them
    const pipe = read('pipeline.html');
    const a = pipe.indexOf('/* ==== agreement packages: start'), b = pipe.indexOf('/* ==== agreement packages: end ==== */');
    const PKGS = new Function(`${pipe.slice(a, b)}\nreturn DDS_AGREEMENT_PACKAGES;`)();
    for (const k of Object.keys(PKGS)) ok(`the shipped ${k} agreement yields no term (a hint only, no invented default)`, impliedTermMonths(PKGS[k].body) === null);
    // the page's own copy of the reader, run and compared
    const start = pipe.indexOf('function impliedTermMonths(');
    let depth = 0, end = -1;
    for (let j = pipe.indexOf('{', start); j < pipe.length; j++) { if (pipe[j] === '{') depth++; else if (pipe[j] === '}' && --depth === 0) { end = j + 1; break; } }
    const mirror = new Function(`${pipe.slice(start, end)}\nreturn impliedTermMonths;`)();
    const CASES = ['a 12-month term', 'The term of this Agreement is twelve (12) months.', 'for a term of 6 months', LOOKBACK, PKGS.growth.body, PKGS.custom_photography.body, PKGS.template_build.body, '', 'no term at all', 'a 99-month term'];
    ok('the page’s reader agrees with the server’s on every case', CASES.every((c) => mirror(c) === impliedTermMonths(c)), CASES.filter((c) => mirror(c) !== impliedTermMonths(c)).map((c) => c.slice(0, 40)).join(' · '));
    // the page's date math for the prefill, run
    const amLine = pipe.split('\n').find((l) => l.startsWith('const addMonthsISO='));
    const addMonths = new Function(`${amLine}\nreturn addMonthsISO;`)();
    ok('addMonthsISO: +12 months lands on the anniversary', addMonths('2026-07-15T10:00:00.000Z', 12) === '2027-07-15');
    ok('addMonthsISO: a month-end overflow normalizes, never NaN', ['2026-03-03', '2026-02-28'].includes(addMonths('2026-01-31', 1)), addMonths('2026-01-31', 1));
    ok('addMonthsISO: garbage is an empty string', addMonths('', 12) === '' && addMonths('not-a-date', 12) === '');
  }

  // ═══ 5. The enquiry text lands on the deal ═══
  {
    const MSG = 'We need a site before our March opening.';
    const subRow = (sid, site, message) => ({ id: sid, site_id: site, form_kind: 'quote', name: 'Riley Park', email: 'riley@example.com', message, status: 'new', created_at: T0, deleted_at: null });
    const newDeal = (b, as = asA) => as('POST', '/sales/deals', { title: 'Blue Finch Café website', contact_id: CT_A, source: 'website_form', ...b });
    world({ presence_deals: [], presence_form_submissions: [subRow(SUB_A, SITE_A, MSG), subRow(SUB_B, SITE_B, 'Another studio’s private enquiry.')] });
    db.log.length = 0;
    let r = await newDeal({ source_submission_id: SUB_A });
    let made = T('presence_deals').find((x) => x.id === r.body?.data?.id);
    ok('a deal made from an enquiry carries its words in Notes', r.status === 201 && made?.notes === `Website enquiry: ${MSG}` && made.source_submission_id === SUB_A && made.site_id === SITE_A, short(r));
    ok('one read of the enquiry does both jobs: it proves it is this studio’s, and fetches the words', db.reads('presence_form_submissions').length === 1, JSON.stringify(db.reads('presence_form_submissions').map((c) => c.url)));
    ok('the enquiry is marked converted', T('presence_form_submissions').find((s) => s.id === SUB_A).status === 'converted');
    const created = evs(made?.id, 'created');
    ok('the words also ride the deal’s created event (it outlives a Notes rewrite), and the event is written', created.length === 1 && created[0].site_id === SITE_A && created[0].to_stage === 'lead' && created[0].detail?.source_submission_id === SUB_A && created[0].detail.enquiry === MSG, JSON.stringify(created));
    ok('…with the enquiry link inside detail: presence_deal_events has no source_submission_id column (that insert was refused, and no created event was ever written)', created.length === 1 && !('source_submission_id' in created[0]), JSON.stringify(created[0]));

    world({ presence_deals: [], presence_form_submissions: [subRow(SUB_A, SITE_A, MSG)] });
    r = await newDeal({ source_submission_id: SUB_A, notes: 'Call after 3pm' });
    made = T('presence_deals').find((x) => x.id === r.body?.data?.id);
    ok('notes the studio typed win over the enquiry’s words', r.status === 201 && made?.notes === 'Call after 3pm' && evs(made.id, 'created')[0]?.detail.enquiry === MSG, JSON.stringify(made?.notes));

    const noisy = `Hello\u0007 there\u0000, ${'x'.repeat(2500)}`;
    world({ presence_deals: [], presence_form_submissions: [subRow(SUB_A, SITE_A, noisy)] });
    r = await newDeal({ source_submission_id: SUB_A });
    made = T('presence_deals').find((x) => x.id === r.body?.data?.id);
    const ev = evs(made?.id, 'created')[0];
    ok('the words are cleaned of control characters and bounded like every typed string (2,000 in Notes, 500 on the event)', r.status === 201 && /^Website enquiry: Hello there, x+$/.test(made?.notes || '') && made.notes.length === 2000 && ev?.detail.enquiry.length === 500 && !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(made.notes + ev.detail.enquiry), `${made?.notes?.length} ${ev?.detail?.enquiry?.length}`);

    world({ presence_deals: [], presence_form_submissions: [subRow(SUB_A, SITE_A, MSG), subRow(SUB_B, SITE_B, 'Another studio’s private enquiry.')] });
    const theirs = snap('presence_form_submissions', SUB_B);
    r = await newDeal({ source_submission_id: SUB_B });
    made = T('presence_deals').find((x) => x.id === r.body?.data?.id);
    ok('another studio’s enquiry id links nothing: no words copied, no link kept, their enquiry untouched', r.status === 201 && made?.source_submission_id === null && made.notes === '' && snap('presence_form_submissions', SUB_B) === theirs && !evs(made.id, 'created')[0]?.detail.enquiry, JSON.stringify(made));
  }

  const passed = results.filter((x) => x.p).length;
  const failed = results.length - passed;
  console.log(`\n════ SALES PRICE FLOW (audit 1/2/8 + long-tail): ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''} ════`);
  if (failed) Deno.exit(1);
  Deno.exit(0);   // std serve() keeps its fake listener open
}

if (new URL(import.meta.url).searchParams.get('phase') === 'no-stripe') {
  let out;
  try { out = await stripeOffChecks(); } catch (e) { out = [{ n: 'the no-Stripe checks ran', p: false, note: String(e?.stack || e) }]; }
  self.postMessage(out);
  self.close();
} else {
  await main();
}

// ── Covered in the browser by (the page halves of the checks above) ──
//   pipeline.html warns before sending a valueless agreement (money-blank confirm):
//     pipeline.spec.ts › deal drawer — signed fact, renewal hint, deposit mint › a VALUELESS agreement warns before send — the doc prints "[50% deposit]" nobody computed
//   …on Save & send and on the one combined send too:
//     sales-price-flow-212.spec.ts › Save & send for signature with money blanks asks first; declining saves and sends nothing
//     sales-price-flow-212.spec.ts › the one "Send proposal & agreement" asks about money blanks too; declining sends nothing
//   the send toast reports the minted deposit:
//     pipeline.spec.ts › deal drawer — signed fact, renewal hint, deposit mint › sending the agreement reports the deposit the server minted alongside it
//     pipeline.spec.ts › deal drawer — one "Send proposal & agreement" › the one button POSTs /sales/deals/:id/send with both ids; the toast names the client and the minted deposit
//   the signed fact reaches the stage note, the to-do presets and the convert deep link:
//     pipeline.spec.ts › deal drawer — signed fact, renewal hint, deposit mint › a SIGNED deal’s guidance says convert — never "Get it signed" — and deep-links the button
//     pipeline.spec.ts › deal drawer — signed fact, renewal hint, deposit mint › an UNSIGNED sent agreement keeps the current copy
//     stage-notes-124.spec.ts › when the notes can’t be read, what the deal knows still shows (they signed: convert them), with no Edit note
//     sales-price-flow-212.spec.ts › a signed deal’s to-do presets fill the to-do box, and nothing is added until Add
//   the renewal hint, the prefill and the one Save:
//     pipeline.spec.ts › deal drawer — signed fact, renewal hint, deposit mint › a signed agreement missing its renewal date says the reminder can’t arm (no invented default)
//     pipeline.spec.ts › deal drawer — signed fact, renewal hint, deposit mint › an agreement that STATES a term prefills signed_at + N months — set only by pressing Save
//     pipeline.spec.ts › deal drawer — signed fact, renewal hint, deposit mint › once a renewal date is set, the hint goes away
//     sales-price-flow-212.spec.ts › the renewal hint says the date is only filled in, and nothing is set until Save
//   sign.html (the one page: choose, sign, pay):
//     sign.spec.ts › sign.html — one page from proposal to deposit › lands on Choose: the proposal is open with Accept, the agreement and deposit are locked and unreadable
//     sign.spec.ts › … › Accept POSTs the decision with the link token; then Choose folds away and the agreement unlocks
//     sign.spec.ts › … › Sign POSTs the typed name + the presented hash; the news, the signature and the Pay step follow
//     sign.spec.ts › … › accepted but the agreement isn’t ready: the page says the studio is preparing it; Pay stays waiting
//     sign.spec.ts › … › between versions (the studio revised the proposal and hasn’t sent v2): Choose waits, Sign stays locked, nothing is readable
//     sign.spec.ts › … › a stale version (409) keeps the agreement on screen and swaps the action for "Load the latest version"
//     sign.spec.ts › … › an old per-document link (a proposal token) still renders the single proposal and accepts it
//     sign.spec.ts › … › an old per-document link (a contract token) still signs and hands over the deposit link
//     sales-price-flow-212.spec.ts › sign.html: the stale-version button says "Load the latest version", and the signed copy names its fingerprint
//   the Inbox enquiry pane sends the enquiry's id with "Make it a deal" (the server carries the words):
//     crm.spec.ts › Website enquiries (the Inbox’s Enquiries view) › + Make it a deal turns the enquiry into a deal and the card flips to “In pipeline”
//     enquiry-source-89.spec.ts › An enquiry says where the visitor came from (item 89) › Make it a deal carries the answer to the person and the deal
