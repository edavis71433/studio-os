// ── Sales extras, batch 1 (item 69, Nov 2026): the chance each stage closes with
// Pipeline's Expected total, and the sending-domain line in Settings. Real
// handlers against the shared in-memory PostgREST; all names are made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_extras_1_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const db = installFakePostgrest({ unique: { presence_sales_templates: [{ cols: ['site_id', 'kind', 'name'], where: (r) => r.deleted_at == null && /^__.*__$/.test(String(r.name)) }] } });
const SN = await import('../../supabase/functions/presence/lib/stage_names.ts');
const R = await import('../../supabase/functions/presence/lib/sales_reports.ts');
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const E = await import('../../supabase/functions/presence/routes/email_sending.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString();
const deal = (id, stage, cents, extra = {}) => ({ id, site_id: SITE, title: 'Deal ' + id.slice(-1), stage, expected_value_cents: cents, created_at: day(-20), updated_at: day(-1), deleted_at: null, source: 'manual', ...extra });
const DEALS = [
  deal('d0000000-0000-4000-8000-000000000001', 'lead', 100000),       // $1,000 × 10% = $100
  deal('d0000000-0000-4000-8000-000000000002', 'proposal', 300000),   // $3,000 × 50% = $1,500
  deal('d0000000-0000-4000-8000-000000000003', 'contract', 200001),   // $2,000.01 × 75% = $1,500.0075 → 150001
  deal('d0000000-0000-4000-8000-000000000004', 'won', 900000, { converted_client_id: '44444444-4444-4444-8444-444444444444', converted_at: day(-3) }),
  deal('d0000000-0000-4000-8000-000000000005', 'lost', 500000, { lost_reason: 'Price' }),
];

// ═══ the percents: pure rules ═══
{
  ok('defaults: 10, 25, 50, 75; Won 100; Not a fit 0', JSON.stringify(SN.stageChances(null)) === JSON.stringify({ lead: 10, qualified: 25, proposal: 50, contract: 75, won: 100, lost: 0 }));
  const c = SN.normalizeStageChances({ lead: '15', qualified: 25, proposal: 101, contract: -1, won: 50, lost: 20, junk: 9 });
  ok('only open stages, whole numbers 0–100, and only real changes are kept', JSON.stringify(c) === JSON.stringify({ lead: 15 }), JSON.stringify(c));
  ok('blank or missing means the usual percent', JSON.stringify(SN.normalizeStageChances({ lead: '', qualified: null })) === '{}');
  ok('0 and 100 are allowed for an open stage', JSON.stringify(SN.normalizeStageChances({ lead: 0, contract: 100 })) === JSON.stringify({ lead: 0, contract: 100 }));
  ok('a saved Won or Not a fit percent can never change them', SN.stageChances({ won: 10, lost: 90 }).won === 100 && SN.stageChances({ won: 10, lost: 90 }).lost === 0);
  const ex = SN.expectedValue(DEALS, SN.stageChances(null));
  ok('Expected: each open deal\'s value × its stage\'s chance, in whole cents', ex.value_cents === 10000 + 150000 + 150001 && ex.by_stage.lead === 10000 && ex.by_stage.proposal === 150000 && ex.by_stage.contract === 150001 && ex.by_stage.qualified === 0, JSON.stringify(ex));
  ok('Expected: won, not a fit and turned-into-customer deals never count', SN.expectedValue([{ stage: 'proposal', expected_value_cents: 1000, converted_client_id: 'x' }, { stage: 'won', expected_value_cents: 5000 }, { stage: 'lost', expected_value_cents: 5000 }], SN.stageChances(null)).value_cents === 0);
  ok('Expected follows the studio\'s percents', SN.expectedValue(DEALS, SN.stageChances({ lead: 50 })).by_stage.lead === 50000);
}

// ═══ saving: names and percents never overwrite each other ═══
{
  db.reset({ presence_sales_templates: [], presence_deals: DEALS });
  const n = await res(await S.handleSalesStages(req('PUT', '/sales/stages', { names: { lead: 'Enquiry' } }), site, owner, cors));
  const c = await res(await S.handleSalesStages(req('PUT', '/sales/stages', { chances: { lead: 20, qualified: 25, proposal: 60, contract: 75 } }), site, owner, cors));
  const g = await res(await S.handleSalesStages(req('GET', '/sales/stages'), site, owner, cors));
  ok('PUT { chances } keeps the renamed stage; PUT { names } kept no percents it wasn\'t given', n.status === 200 && c.status === 200 && g.body?.data?.labels?.lead === 'Enquiry' && g.body?.data?.chances?.lead === 20 && g.body?.data?.chances?.proposal === 60, JSON.stringify(g.body));
  const n2 = await res(await S.handleSalesStages(req('PUT', '/sales/stages', { names: { lead: 'Enquiry', qualified: 'Talking' } }), site, owner, cors));
  ok('PUT { names } afterwards leaves the percents alone', n2.body?.data?.chances?.lead === 20 && n2.body?.data?.labels?.qualified === 'Talking', JSON.stringify(n2.body?.data));
  ok('GET answers every stage\'s percent and the usual ones', g.body?.data?.chances?.won === 100 && g.body?.data?.chances?.lost === 0 && g.body?.data?.chance_defaults?.contract === 75);
  const empty = await res(await S.handleSalesStages(req('PUT', '/sales/stages', {}), site, owner, cors));
  ok('a PUT with neither is refused, nothing written', empty.status === 422);
  db.failMethod.set('presence_sales_templates', 'POST');
  db.tables.presence_sales_templates = [];
  const bad = await res(await S.handleSalesStages(req('PUT', '/sales/stages', { chances: { lead: 30 } }), site, owner, cors));
  ok('a percent save that fails says so', bad.status === 502 && /percents/.test(bad.body?.message || ''), JSON.stringify(bad));
}

// ═══ Pipeline's summary and the Deals by stage report ═══
{
  db.reset({ presence_sales_templates: [], presence_deals: DEALS, presence_invoices: [] });
  SN.forgetStageChances(SITE); SN.forgetStageLabels(SITE);
  const s = await res(await S.handleSalesSummary(req('GET', '/sales/summary'), site, owner, cors));
  const d = s.body?.data || {};
  ok('summary: Expected = $100 + $1,500 + $1,500.01 at the usual percents', d.expected?.value_cents === 310001, JSON.stringify(d.expected));
  const p = (d.by_stage || []).find((b) => b.stage === 'proposal');
  ok('summary: each stage carries its percent and expected cents', p && p.chance === 50 && p.expected_cents === 150000, JSON.stringify(d.by_stage));
  // the studio changes a percent → the summary follows (once the kept percents are forgotten, which a save does)
  await S.handleSalesStages(req('PUT', '/sales/stages', { chances: { lead: 10, qualified: 25, proposal: 100, contract: 75 } }), site, owner, cors);
  const s2 = await res(await S.handleSalesSummary(req('GET', '/sales/summary'), site, owner, cors));
  ok('summary: a saved percent shows at once', s2.body?.data?.expected?.value_cents === 10000 + 300000 + 150001, JSON.stringify(s2.body?.data?.expected));
  const rep = R.dealsByStage(DEALS, {}, new Date().toISOString(), undefined, SN.stageChances(null));
  const rp = rep.rows.find((r) => r.stage === 'proposal');
  ok('report: Deals by stage shows each stage\'s percent and expected, and the total', rp.chance === 50 && rp.expected_cents === 150000 && rep.expected_cents === 310001, JSON.stringify(rep));
  const old = R.dealsByStage(DEALS, {}, new Date().toISOString());
  ok('report: without percents (older callers) nothing is invented', old.expected_cents === null && old.rows.every((r) => r.expected_cents === null && r.chance === null));
}

// ═══ the sending-domain line ═══
{
  const doms = [{ name: 'example.com', status: 'verified' }, { name: 'reply.example.com', status: 'not_started' }];
  ok('domainState: verified only when the provider says so', E.domainState('example.com', doms) === 'verified' && E.domainState('reply.example.com', doms) === 'not_verified' && E.domainState('other.test', doms) === 'not_verified');
  ok('domainState: no answer from the provider is "unknown", never a guess', E.domainState('example.com', null) === 'unknown');
  const realFetch = globalThis.fetch;
  const calls = [];
  const stub = (status, body) => { globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), auth: new Headers(init.headers || {}).get('authorization') }); return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }; };
  Deno.env.set('EMAIL_FROM', 'Studio <hello@example.com>'); Deno.env.set('RESEND_INBOUND_DOMAIN', 'reply.example.com'); Deno.env.set('RESEND_KEY', 'test-key');
  try {
    E.forgetProviderDomains(); stub(200, { data: [{ name: 'example.com', status: 'verified' }, { name: 'reply.example.com', status: 'verified' }] });
    const a = await res(await E.handleEmailSending(cors));
    ok('handler: names the address and says verified, replies come back to the Inbox', a.status === 200 && a.body.data.from === 'hello@example.com' && a.body.data.domain === 'example.com' && a.body.data.sending === 'verified' && a.body.data.replies === 'inbox' && a.body.data.receiving === 'verified', JSON.stringify(a.body));
    ok('handler: one read of the provider\'s domain list, with the key', calls.length === 1 && calls[0].url === 'https://api.resend.com/domains' && calls[0].auth === 'Bearer test-key');
    await E.handleEmailSending(cors);
    ok('handler: the answer is kept (no second read inside ten minutes)', calls.length === 1);
    E.forgetProviderDomains(); stub(500, { message: 'boom' });
    const b = await res(await E.handleEmailSending(cors));
    ok('handler: a failed read says "unknown", never verified', b.body.data.sending === 'unknown');
    stub(200, { data: [{ name: 'example.com', status: 'verified' }] });
    await E.handleEmailSending(cors);
    ok('handler: a failed read was not kept (the next one asks again)', calls.length === 3);
    E.forgetProviderDomains(); Deno.env.delete('RESEND_KEY');
    const c = await res(await E.handleEmailSending(cors));
    ok('handler: no key, no read, "unknown"', c.body.data.sending === 'unknown' && calls.length === 3);
  } finally { globalThis.fetch = realFetch; }
}

// ═══ the pages ═══
{
  const read = (rel) => Deno.readTextFileSync(new URL(rel, import.meta.url));
  const st = read('../../settings.html'), pipe = read('../../pipeline.html'), an = read('../../analytics.html'), idx = read('../../supabase/functions/presence/index.ts');
  ok('Settings: a percents card of its own (the names card keeps its four boxes)', /id="stageChances"/.test(st) && (st.match(/id="sc-(lead|qualified|proposal|contract)" min="0" max="100"/g) || []).length === 4 && /id="scSave">Save percents</.test(st));
  ok('Settings: saving sends only the percents', /api\('\/sales\/stages', 'PUT', \{ chances \}\)/.test(st));
  ok('Settings: the Domain & email card says where emails go out from and whether it\'s verified', /api\('\/email\/sending'\)/.test(st) && /setStatus\('domains', \{ text: `Emails go out from \$\{d\.from\} · verified`/.test(st) && /not verified, so they may land in spam/.test(st));
  ok('Pipeline: an Expected tile, kept off a phone (it rides under Open there)', /const expT=ex\?tile\('Expected'/.test(pipe) && /\$\{openT\}\$\{expT\}\$\{wonT\}/.test(pipe) && /\.stats \.st-exp\{display:none\}/.test(pipe) && /\.stats \.exp-sub\{display:inline\}/.test(pipe));
  ok('Pipeline: the stage cells show each stage\'s percent', /\$\{b\.chance!=null\?` · \$\{b\.chance\}%`:''\}/.test(pipe));
  ok('Analytics: Deals by stage gains an Expected column when the server sends it', /\.\.\.\(exp\?\['Expected'\]:\[\]\)/.test(an));
  ok('the route is wired: GET /email/sending', /route === '\/email\/sending' && method === 'GET'\) return handleEmailSending\(cors\)/.test(idx));
}

console.log(`\n════ SALES EXTRAS 1 (item 69): ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) { console.log('failed:', failed.join(' | ')); Deno.exit(1); }
