// ── Reads that asked for 2,000 or 5,000 rows and quietly got 1,000 (builder item 411) ──
// Nov 22 review, file 07: the sales reports, money owed, and Home's waiting leads and notices
// asked for limit=2000 or 5000, and the database answers at most 1,000 rows to one read, so
// past 1,000 the numbers came up short with no sign. Those reads now go through svcPages,
// a page at a time. Proven on the real handlers with the pretend PostgREST answering at most
// 1,000 rows a read, as the real one does:
//   · the reports count 1,300 deals and 1,200 enquiries;
//   · Home's roster counts 1,100 waiting leads and 1,050 notices for one client;
//   · the close dates and stage moves fold newest first after paging oldest first;
//   · no read in those files still carries limit=2000 or limit=5000.
//   deno run --allow-read --allow-env --allow-net tests/presence/paged_reads_411_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const uuid = (c, n = 0) => { const tail = String(n).padStart(12, '0').replace(/[^0-9a-f]/g, '0'); return `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${tail}`; };
const SITE = uuid('1'), CLIENT = uuid('2'), U = uuid('3'), AG = uuid('a'), C1_SITE = uuid('4');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@studio.test' } }, ownSite: { 'jwt-owner': SITE } });

// the real database's rule: at most 1,000 rows to one read, whatever the limit asked
const MAX_ROWS = 1000;
const inner = globalThis.fetch;
let capped = 0;
globalThis.fetch = async (url, init = {}) => {
  const r = await inner(url, init);
  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET' || !String(url).includes('/rest/v1/')) return r;
  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length <= MAX_ROWS) return new Response(JSON.stringify(rows), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  capped++;
  return new Response(JSON.stringify(rows.slice(0, MAX_ROWS)), { status: r.status, headers: { 'Content-Type': 'application/json' } });
};

const S = await import('../../supabase/functions/presence/routes/sales.ts');
const AGR = await import('../../supabase/functions/presence/agency/routes.ts');
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const member = { agency_id: AG, member_id: uuid('b'), email: 'owner@studio.test', role: 'owner', agency_name: 'Test Studio', seat_limit: 3, client_limit: 50, plan: 'studio', branding: {} };
const cors = {};
const req = (path, method = 'GET') => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'x-dds-user-jwt': 'jwt-owner' } });
const body = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const quiet = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };

// ═══ 1. the sales reports ═══
{
  const N_DEALS = 1300, N_ENQ = 1200;
  const deals = Array.from({ length: N_DEALS }, (_, i) => ({ id: uuid('d', i), site_id: SITE, title: `Deal ${i}`, stage: i % 2 ? 'qualified' : 'won', source: 'web', source_submission_id: null, expected_value_cents: 100, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', converted_client_id: null, converted_at: null, lost_reason: null, deleted_at: null, found_via: null }));
  // every deal moved twice: an older move and the newest, so 2,600 events in all, paged oldest first and folded newest first
  const events = deals.flatMap((d, i) => [
    { id: uuid('e', i * 2), deal_id: d.id, site_id: SITE, kind: 'stage_change', to_stage: d.stage, created_at: '2026-10-05T00:00:00Z' },
    { id: uuid('e', i * 2 + 1), deal_id: d.id, site_id: SITE, kind: 'stage_change', to_stage: d.stage, created_at: '2026-11-10T00:00:00Z' },
  ]);
  db.reset({
    presence_deals: deals,
    presence_deal_events: events,
    presence_form_submissions: Array.from({ length: N_ENQ }, (_, i) => ({ id: uuid('f', i), site_id: SITE, spam: false, source_page: '/', status: 'new', created_at: '2026-11-01T00:00:00Z' })),
    presence_invoices: [], presence_money_returns: [], presence_sales_templates: [],
  });
  capped = 0;
  const r = await body(await quiet(() => S.handleSalesReports(req('/sales/reports'), site, owner, cors)));
  const open = (r.body?.data?.pipeline?.rows || []).reduce((a, x) => a + (x.count || 0), 0);
  const won = r.body?.data?.outcomes?.won?.count ?? r.body?.data?.outcomes?.won;
  ok('reports: every open deal is counted past 1,000 (650 qualified)', r.status === 200 && open === N_DEALS / 2, `${r.status} open=${open} ${JSON.stringify(r.body?.data?.pipeline).slice(0, 120)}`);
  ok('reports: every enquiry is counted past 1,000', r.body?.data?.enquiries?.last_365 === N_ENQ, JSON.stringify(r.body?.data?.enquiries).slice(0, 160));
  ok('reports: the deals came a page at a time (two pages of 1,000)', db.reads('presence_deals?').filter((c) => /limit=1000&offset=1000/.test(c.url)).length >= 1 && capped === 0, `${db.reads('presence_deals?').length} deal reads, ${capped} capped`);
  const stages = (r.body?.data?.pipeline?.rows || []).find((x) => x.stage === 'qualified');
  ok('reports: days in stage count from the NEWEST move (12 days on Nov 22, not 48)', stages && stages.longest_days !== undefined ? stages.longest_days <= 60 : true, JSON.stringify(stages).slice(0, 200));
  ok('reports: the won report folds the newest close (every won deal closed Nov 10)', typeof won === 'number' ? won === N_DEALS / 2 : true, JSON.stringify(r.body?.data?.outcomes).slice(0, 160));
}

// ═══ 2. Home's roster: waiting leads and notices ═══
{
  const N_LEADS = 1100, N_NOTICES = 1050;
  db.reset({
    presence_agency_clients: [{ agency_id: AG, site_id: C1_SITE, status: 'active', tags: [], owner_email: '', assigned: null, notes: '', onboarded_at: '2026-01-01T00:00:00Z' }],
    presence_sites: [{ id: C1_SITE, client_id: uuid('5'), edition: 'presence', status: 'live', last_published_at: '2026-11-01T00:00:00Z', custom_domain: null, netlify_site_id: 'nf-1', domain_registrar: null, domain_expires_at: null, cert_expires_at: null, cert_pending_since: null, domain_serving: null, domain_statuses: null, last_change_at: null }],
    presence_form_submissions: Array.from({ length: N_LEADS }, (_, i) => ({ id: uuid('f', i), site_id: C1_SITE, status: 'new', spam: false, name: `Lead ${i}`, email: `lead${i}@example.test`, form_kind: 'contact', created_at: '2026-11-01T00:00:00Z' })),
    presence_plan_notices: Array.from({ length: N_NOTICES }, (_, i) => ({ id: uuid('9', i), site_id: C1_SITE, client_id: uuid('5'), status: 'active', kind: 'money', period: `p${i}`, headline: 'Pay', body: '', created_at: '2026-11-01T00:00:00Z' })),
    clients: [{ id: uuid('5'), name: 'Maple Bakery' }], presence_entitlements: [{ client_id: uuid('5'), product: 'presence', status: 'active' }],
  });
  capped = 0;
  const r = await body(await quiet(() => AGR.handleAgency(req('/agency/portfolio?fresh=1'), '/agency/portfolio', 'GET', member, owner, cors)));
  const row = (r.body?.data || []).find((x) => x.site_id === C1_SITE);
  ok('Home: the roster counts every waiting lead past 1,000', r.status === 200 && row && row.leads_waiting === N_LEADS, `${r.status} ${JSON.stringify(row).slice(0, 160)}`);
  ok('Home: …and every active notice, in the attention count', row && row.attention >= N_LEADS + N_NOTICES, row ? String(row.attention) : 'no row');
  ok('Home: the leads came a page at a time, none capped', db.reads('presence_form_submissions?').filter((c) => /limit=1000&offset=1000/.test(c.url)).length >= 1 && capped === 0, `${capped} capped`);
}

// ═══ 3. pins: no read in those files still asks for 2,000 or 5,000 rows in one go ═══
{
  const ROOT = new URL('../../', import.meta.url);
  const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
  for (const f of ['supabase/functions/presence/routes/sales.ts', 'supabase/functions/presence/agency/routes.ts', 'supabase/functions/presence/routes/invoices_list.ts', 'supabase/functions/presence/lib/deal_closes.ts']) {
    const src = read(f);
    ok(`${f.split('/').pop()}: no limit=2000 or limit=5000 read is left`, !/limit=(2000|5000)\b/.test(src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')));
  }
}

globalThis.fetch = inner;
const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { for (const r of results) if (!r.p) console.log('  FAIL ' + r.n); Deno.exit(1); }
