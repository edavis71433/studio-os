// ── Projects and Analytics (sales list item 111, bug hunt H1 to H11) ──────────
//   deno run --allow-read --allow-env --allow-net tests/presence/projects_analytics_111_test.mjs
// H1: a win is dated by its move into Won (the Reports' date), never its last edit, on the
// caller's clock. H2: + New project takes any customer on the studio's books. H3: a project's
// Support card asks for its own requests. H7: Analytics' reads go side by side. H10: the old
// home is gone. Real handlers against the shared in-memory PostgREST; all names made up.
import { installFakePostgrest } from './fake_pgrst.mjs';
const db = installFakePostgrest();
const P = '../../supabase/functions/presence';
const { dealOutcome, foldCloses, readCloseDates, closesPath } = await import(`${P}/lib/deal_closes.ts`);
const { summarizePipeline } = await import(`${P}/lib/sales_lifecycle.ts`);
const { recentWins, priorMonthIso } = await import(`${P}/lib/analytics_dashboard.ts`);
const { handleAnalyticsDashboard } = await import(`${P}/routes/analytics.ts`);
const { handleSupport } = await import(`${P}/routes/service_intake.ts`);
const { handleProjects } = await import(`${P}/routes/projects.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));

const STUDIO = '11111111-1111-4111-8111-111111111111', CLIENT_SITE = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333', LINKED_ONLY = '44444444-4444-4444-8444-444444444444';
const D_OLD = 'd0000000-0000-4000-8000-000000000001', D_NEW = 'd0000000-0000-4000-8000-000000000002', D_LOST = 'd0000000-0000-4000-8000-000000000003', D_OPEN = 'd0000000-0000-4000-8000-000000000004';
const PROJ = 'b0000000-0000-4000-8000-000000000001', PROJ2 = 'b0000000-0000-4000-8000-000000000002';
const site = { id: STUDIO, client_id: 'c-studio', status: 'live', edition: 'presence', last_published_at: '2026-10-01T00:00:00Z' };
const staff = { kind: 'staff', userId: 'u1', email: 'eric@studio.example', jwt: 'jwt', requestId: 't' };
const cors = {};
const NOW = new Date().toISOString();
const thisMonth = NOW.slice(0, 7);
const ago = (d) => new Date(Date.now() - d * 86400_000).toISOString();

// ═══ H1: when a deal closed ═══
{
  ok('H1: won is converted or stage won; lost is Not a fit; the rest are open', dealOutcome({ stage: 'won' }) === 'won' && dealOutcome({ converted_client_id: 'x', stage: 'contract' }) === 'won' && dealOutcome({ stage: 'lost' }) === 'lost' && dealOutcome({ stage: 'proposal' }) === '');
  const outcome = new Map([[D_OLD, 'won'], [D_LOST, 'lost']]);
  const at = foldCloses(outcome, [
    { deal_id: D_OLD, to_stage: 'won', created_at: '2026-09-20T10:00:00Z' },   // newest first
    { deal_id: D_OLD, to_stage: 'won', created_at: '2026-08-01T10:00:00Z' },
    { deal_id: D_LOST, to_stage: 'won', created_at: '2026-07-01T10:00:00Z' },   // not its outcome now
    { deal_id: D_LOST, to_stage: 'lost', created_at: '2026-06-01T10:00:00Z' },
  ]);
  ok('H1: the close is the newest move into the outcome the deal has now', at[D_OLD] === '2026-09-20T10:00:00Z' && at[D_LOST] === '2026-06-01T10:00:00Z');
  const paths = [];
  const many = Array.from({ length: 230 }, (_, i) => ({ id: `d${String(i).padStart(7, '0')}-0000-4000-8000-000000000000`, stage: 'won' }));
  const r = await readCloseDates([...many, { id: 'not-a-uuid', stage: 'won' }, { id: D_OPEN, stage: 'proposal' }], `site_id=eq.${STUDIO}`, async (p) => { paths.push(p); return paths.length === 2 ? null : []; });
  ok('H1: 100 deals a read, side by side; open deals and bad ids are not asked about', paths.length === 3 && paths.every((p) => p.startsWith(`presence_deal_events?site_id=eq.${STUDIO}&kind=in.(stage_change,converted)&to_stage=in.(won,lost)&deal_id=in.(`)) && !paths.join().includes(D_OPEN) && !paths.join().includes('not-a-uuid'));
  ok('H1: a failed read says partial (those deals keep the old fallback)', r.partial === true);
  ok('H1: the Reports and the tiles read the same path', closesPath('site_id=eq.X', ['a']) === 'presence_deal_events?site_id=eq.X&kind=in.(stage_change,converted)&to_stage=in.(won,lost)&deal_id=in.(a)&select=deal_id,to_stage,created_at&order=created_at.desc&limit=2000');

  // a deal marked Won by hand in September, renamed today: updated_at moved, the win didn't
  const edited = { id: D_OLD, title: 'Old win', stage: 'won', expected_value_cents: 500000, converted_client_id: null, converted_at: null, updated_at: NOW };
  const closed = { [D_OLD]: '2026-09-20T10:00:00Z' };
  ok('H1: before, the last edit made it "won this month" (the bug)', summarizePipeline([edited], NOW).won_month.count === 1);
  ok('H1: with its close date it stays in September', summarizePipeline([edited], NOW, undefined, {}, closed).won_month.count === 0);
  ok('H1: …and counts in September’s "won" when that month is asked', summarizePipeline([edited], '2026-09-25T12:00:00Z', undefined, {}, closed).won_month.count === 1);
  ok('H1: Recent wins dates it by its win, not by today', recentWins([edited], Date.now(), 120, 6, closed).every((w) => w.closed_at === '2026-09-20T10:00:00Z') && !recentWins([edited], Date.now(), 120, 6, closed).some((w) => w.closed_at === NOW));
  // the caller's month: 9pm on November 30 in Los Angeles (480 minutes behind UTC) is December 1 in UTC
  const late = Date.parse('2026-12-01T05:00:00Z');
  ok('H1: last month on the caller’s clock: October from the evening of November 30 in Los Angeles', priorMonthIso(late, 480).slice(0, 7) === '2026-10' && priorMonthIso(late).slice(0, 7) === '2026-11');
  const wonEvening = { id: D_NEW, stage: 'won', expected_value_cents: 1000, updated_at: '2026-12-01T04:00:00Z' };
  ok('H1: a deal won at 8pm on November 30 there is November’s, on that clock', summarizePipeline([wonEvening], '2026-12-01T05:00:00Z', undefined, { offsetMinutes: 480 }, { [D_NEW]: '2026-12-01T04:00:00Z' }).won_month.count === 1);
}

// ═══ H1 + H7 through the dashboard ═══
{
  db.reset({
    presence_deals: [
      { id: D_OLD, site_id: STUDIO, title: 'Old win', stage: 'won', expected_value_cents: 500000, converted_client_id: null, converted_at: null, updated_at: NOW, deleted_at: null },
      { id: D_NEW, site_id: STUDIO, title: 'New win', stage: 'won', expected_value_cents: 200000, converted_client_id: null, converted_at: null, updated_at: ago(1), deleted_at: null },
      { id: D_OPEN, site_id: STUDIO, title: 'Open one', stage: 'proposal', expected_value_cents: 90000, converted_client_id: null, converted_at: null, updated_at: ago(2), deleted_at: null },
    ],
    presence_deal_events: [
      { id: 'e1', site_id: STUDIO, deal_id: D_OLD, kind: 'stage_change', from_stage: 'contract', to_stage: 'won', created_at: '2026-09-20T10:00:00Z' },
      { id: 'e2', site_id: STUDIO, deal_id: D_NEW, kind: 'stage_change', from_stage: 'contract', to_stage: 'won', created_at: ago(1) },
    ],
  });
  const res = await handleAnalyticsDashboard(new Request('https://fn.test/functions/v1/presence/analytics/dashboard?period=this_month&tzo=0'), site, cors);
  const d = (await res.json()).data;
  const sales = d && d.sales;
  ok('H1: "Won this month" counts the deal won yesterday, not the one renamed today', !!sales && sales.won.this_month.count === (ago(1).slice(0, 7) === thisMonth ? 1 : 0) && sales.won.this_month.value_cents === (ago(1).slice(0, 7) === thisMonth ? 200000 : 0), JSON.stringify(sales && sales.won));
  ok('H1: Recent wins dates the old one September 20', (sales.recent_wins || []).every((w) => w.title !== 'Old win' || w.closed_at === '2026-09-20T10:00:00Z'));
  const evReads = db.log.filter((c) => c.method === 'GET' && c.url.includes('presence_deal_events'));
  ok('H1: the close dates are read from the deal events, pinned to the deals’ own site', evReads.length === 1 && evReads[0].url.includes(`site_id=in.(${STUDIO})`) && evReads[0].url.includes('to_stage=in.(won,lost)'), JSON.stringify(evReads.map((c) => c.url)));
  const route = read('supabase/functions/presence/routes/analytics.ts');
  const dash = route.slice(route.indexOf('export async function handleAnalyticsDashboard'));
  const firstBatch = dash.slice(dash.indexOf('await Promise.all(['), dash.indexOf(']);'));
  ok('H7: the dashboard’s external address and connection state are in its first batch', /presence_monitor_connections/.test(firstBatch) && /connectionState\(site\.id\)/.test(firstBatch));
  ok('H7: …and nothing after it waits on its own: close dates, search terms and Google Analytics go together', /const \[closes, termsAndPages, g4\] = await Promise\.all\(\[/.test(dash) && !/await safe\(connectionState/.test(dash) && !/await safe\(readGa4Signals/.test(dash));
  const pf = route.slice(route.indexOf('export async function handleAnalyticsPortfolio'), route.indexOf('export async function handleAnalyticsDashboard'));
  ok('H7: the portfolio makes no read on its own after the site list: two side-by-side rounds', !/await svc\(/.test(pf) && (pf.match(/await Promise\.all\(\[/g) || []).length === 3);
  const idx = read('supabase/functions/presence/index.ts');
  ok('H10: GET /analytics, with no caller, is gone', !idx.includes(`route === '/analytics' &&`) && !route.includes('handleAnalyticsHome'));
  const page = read('analytics.html');
  ok('H1: the page sends its clock with the dashboard read', /api\('\/analytics\/dashboard\?period='\+encodeURIComponent\(period\)\+'&tzo='\+new Date\(\)\.getTimezoneOffset\(\)\)/.test(page));
  ok('H6: Refresh marks Insights to be read again, and a failed re-read keeps the last good ones', /REP_STALE=true;INS_STALE=true;loadDash\(true\)/.test(page) && /if\(!r\.ok&&INSIGHTS\)\{INS_STALE=false;\}/.test(page));
  ok('H5: our counter’s numbers are called visits, and say a person counts once a day', /title:measuring\?'Visits':'Visitors'/.test(page) && /'Visits over time'/.test(page) && /name:'Visits',title:'Visits that opened this page\. '\+VISIT_WORDS/.test(page) && /Visits \(7 days\)/.test(page) && !/name:'People',title:'Different people who opened this page'/.test(page));
}

// ═══ H3: a project's own support requests ═══
{
  const reqs = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, site_id: STUDIO, subject: `Request ${i}`, status: 'open', priority: 'normal', project_id: PROJ2, requester: 'x', updated_at: ago(i), deleted_at: null }));
  db.reset({ presence_support_requests: [...reqs, { id: 'mine', site_id: STUDIO, subject: 'Old one on this project', status: 'open', priority: 'normal', project_id: PROJ, requester: 'x', updated_at: ago(90), deleted_at: null }] });
  const before = await (await handleSupport(new Request('https://fn.test/functions/v1/presence/support'), 'jwt', site, staff, cors)).json();
  ok('H3: (the studio’s newest 25 leave the old request out: what the card used to filter)', before.data.length === 25 && !before.data.some((r) => r.id === 'mine'));
  const mine = await (await handleSupport(new Request(`https://fn.test/functions/v1/presence/support?project_id=${PROJ}&limit=100`), 'jwt', site, staff, cors)).json();
  ok('H3: asked by project, the old request is there, and only this project’s', mine.data.length === 1 && mine.data[0].id === 'mine');
  const junk = await (await handleSupport(new Request('https://fn.test/functions/v1/presence/support?project_id=nope'), 'jwt', site, staff, cors)).json();
  ok('H3: a project id that isn’t one is ignored, never put in the query', junk.data.length === 25 && !db.log.some((c) => c.url.includes('project_id=eq.nope')));
  const pageP = read('projects.html');
  ok('H3: the Support card asks for its project', /api\('\/support\?project_id='\+encodeURIComponent\(id\)\+'&limit=100'\)/.test(pageP));
}

// ═══ H2: a new project for any customer on the studio's books ═══
{
  db.reset({
    presence_deals: [{ id: D_NEW, site_id: STUDIO, converted_client_id: CLIENT_ID, converted_site_id: CLIENT_SITE, deleted_at: null }],
    presence_service_links: [{ id: 'l1', agency_site_id: STUDIO, project_id: PROJ, customer_client_id: LINKED_ONLY, customer_site_id: CLIENT_SITE, status: 'active', created_at: ago(30) }],
    presence_projects: [], presence_project_events: [],
  });
  const make = async (cust) => handleProjects(new Request('https://fn.test/functions/v1/presence/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Spring refresh', customer_client_id: cust }) }), 'jwt', site, staff, cors);
  const viaDeal = await make(CLIENT_ID);
  ok('H2: a customer with a converted deal: created', viaDeal.status === 201);
  const viaLink = await make(LINKED_ONLY);
  const body = await viaLink.json().catch(() => ({}));
  ok('H2: a customer on the books by their service link alone (their deal since deleted): created too', viaLink.status === 201 && body.data && body.data.client_id === LINKED_ONLY, `${viaLink.status} ${JSON.stringify(body).slice(0, 160)}`);
  const stranger = await make('55555555-5555-4555-8555-555555555555');
  ok('H2: a customer who isn’t the studio’s is still refused', stranger.status === 422);
  const pageP = read('projects.html');
  ok('H2: the picker is built from the customer roster, not the pipeline’s newest 25', /async function loadCustomerOptions\(\)\{[\s\S]*?await ensureCustomers\(\);[\s\S]*?CUSTROWS/.test(pageP) && !/api\('\/sales\/deals'\)/.test(pageP));
  ok('H9: one roster read when scoped (the scope check names the customers too), and Refresh reads it again', /if\(r\.ok&&inClient\(\)\)takeCustomers\(rows\);/.test(pageP) && /CUST_STALE=true;return load\(true\)/.test(pageP) && !/dataset\.loaded/.test(pageP));
  ok('H4: + Share keeps Save off while the file goes up', /const save=host\.querySelector\('form button\[type="submit"\]'\);/.test(pageP) && /if\(save\)save\.disabled=true;/.test(pageP));
  ok('H8: an action re-reads the record and report; the side lists stay unless still loading', /const reopen=\(\)=>openProject\(id,\{keepSides:true\}\);/.test(pageP) && /if\(!\(kept&&kept\.support\)\)loadSupport\(id\);/.test(pageP) && !/openProject\(id\);/.test(pageP));
  ok('H8: a kept message form reads its own "internal note" box, wherever it now sits', /const internal=e\.currentTarget\.querySelector\('#mm-internal'\)/.test(pageP));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PROJECTS AND ANALYTICS (item 111): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
