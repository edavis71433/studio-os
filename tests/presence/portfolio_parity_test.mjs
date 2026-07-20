// ── SS7 seams: /analytics/portfolio ↔ /agency/portfolio parity (pure) ────────
//   deno run --allow-read tests/presence/portfolio_parity_test.mjs
// The SS7 review CONFIRMED: the KPI band (websites[] + insights) was built from
// the UNFILTERED gather() — archived clients skewed "Enquiries waiting"/"Needs
// attention" and "Sites live" could exceed "Clients" (client_count is
// active-only via agencySiteIds; /agency/portfolio excludes archived by
// default). These pins hold the two reads to the SAME client set, and pin the
// additive websites[] fields (site_id + visitors) the rollup joins on.
import { buildPortfolio, filterPortfolio } from '../../supabase/functions/presence/agency/portfolio.ts';
import { portfolioInsights, websiteRows } from '../../supabase/functions/presence/analytics/compose.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const NOW = Date.parse('2026-07-08T12:00:00Z');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ── the fixture: one ACTIVE client (quiet) + one ARCHIVED client (noisy) ──
const ACTIVE = '11111111-1111-4111-8111-111111111111';
const ARCHIVED = '22222222-2222-4222-8222-222222222222';
const input = {
  sites: [
    { id: ACTIVE, client_id: 'c1', edition: 'presence', status: 'live', last_published_at: '2026-07-01T00:00:00Z', custom_domain: null },
    { id: ARCHIVED, client_id: 'c2', edition: 'presence', status: 'live', last_published_at: '2026-06-20T00:00:00Z', custom_domain: null },
  ],
  links: [
    { site_id: ACTIVE, status: 'active', tags: [], owner_email: '', assigned: [], notes: '', onboarded_at: '' },
    { site_id: ARCHIVED, status: 'archived', tags: [], owner_email: '', assigned: [], notes: '', onboarded_at: '' },
  ],
  clientNames: { [ACTIVE]: 'Active Co', [ARCHIVED]: 'Archived Co' },
  moments: [], evidence: [], opportunities: [], plans: [], drafts: [],
  connections: [], reviewReports: [], brandReports: [],
  leads: [{ site_id: ARCHIVED }, { site_id: ARCHIVED }],   // ONLY the archived client has leads waiting
  notices: [],
  lastChange: {}, nowIso: '2026-07-08T12:00:00Z',
};

const rows = buildPortfolio(input);
const active = filterPortfolio(rows, {});   // the /agency/portfolio default — archived excluded

// ── item 1: the KPI band counts the SAME clients as the rollup ──
ok('parity: filterPortfolio({}) drops the archived client (the rollup default)',
  active.length === 1 && active[0].site_id === ACTIVE);
{
  // insights composed over the ACTIVE set: the archived client's 2 waiting
  // leads + attention must NOT surface on the operator's KPI band
  const { insights } = portfolioInsights(active.map((c) => ({ name: c.name, leads_waiting: c.leads_waiting, unpublished_changes: c.unpublished_changes, last_published_at: c.last_published_at, attention: c.attention, visitors: 0 })), NOW);
  ok('parity: insights over the active set — no inquiries/attention from the archived client',
    !insights.find((i) => i.key === 'growing') && !insights.find((i) => i.key === 'attention'));
  // and the unfiltered set WOULD have raised them — the confirmed skew
  const skewed = portfolioInsights(rows.map((c) => ({ name: c.name, leads_waiting: c.leads_waiting, unpublished_changes: c.unpublished_changes, last_published_at: c.last_published_at, attention: c.attention, visitors: 0 })), NOW);
  ok('parity: the unfiltered set demonstrates the skew this pin prevents',
    !!skewed.insights.find((i) => i.key === 'growing') && !!skewed.insights.find((i) => i.key === 'attention'));
}

// ── item 1+2: websites[] rows — active-only, with site_id + visitors ──
{
  const websites = websiteRows(active, { planBySite: { [ACTIVE]: 'active' }, failedSites: [], visitorsBySite: { [ACTIVE]: 7 } });
  ok('websites: one row per ACTIVE client — "Sites live" can never exceed "Clients"',
    websites.length === 1 && websites.length === active.length && !websites.find((w) => w.name === 'Archived Co'));
  const w0 = websites[0];
  ok('websites: each row carries site_id (uuid) — the rollup join/drill key', UUID_RE.test(String(w0.site_id)) && w0.site_id === ACTIVE);
  ok('websites: each row carries visitors (number)', typeof w0.visitors === 'number' && w0.visitors === 7);
  ok('websites: existing shape intact (additive — nothing removed or renamed)',
    w0.draft_live === 'live' && w0.last_published_at === '2026-07-01T00:00:00Z' && w0.unpublished_changes === false
    && w0.leads_waiting === 0 && w0.publish_failed === false && w0.plan_status === 'active' && w0.needs_attention === false);
}
{
  // AN-4 honesty: a failed visits read → visitors null (never a fake 0);
  // a SUCCESSFUL read with no visits for the site → an honest 0.
  const failed = websiteRows(active, { planBySite: { [ACTIVE]: 'active' }, failedSites: [], visitorsBySite: null });
  ok('websites: visits read failed → visitors is null, never a fabricated 0', failed[0].visitors === null);
  const quiet = websiteRows(active, { planBySite: { [ACTIVE]: 'active' }, failedSites: [], visitorsBySite: {} });
  ok('websites: successful read, no visits → an honest 0', quiet[0].visitors === 0);
}
{
  // the attention rollup survives the extraction (plan blockers + failed publishes)
  const w = websiteRows(active, { planBySite: { [ACTIVE]: 'lapsed' }, failedSites: [ACTIVE], visitorsBySite: {} });
  ok('websites: needs_attention still rolls up failed publish + paused/lapsed plan',
    w[0].publish_failed === true && w[0].plan_status === 'lapsed' && w[0].needs_attention === true);
  const unknown = websiteRows(active, {});
  ok('websites: missing plan map → coarse "unknown", never a crash', unknown[0].plan_status === 'unknown' && unknown[0].visitors === null);
}

// ── structural: the ROUTE composes the pure pieces exactly this way ──
{
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/analytics.ts', import.meta.url));
  const seg = src.split('handleAnalyticsPortfolio')[1] || '';
  ok('route: portfolio filtered to ACTIVE clients (filterPortfolio default) before insights + websites',
    /filterPortfolio\(buildPortfolio\(input\), \{\}\)/.test(seg));
  ok('route: websites built by the pure websiteRows builder', /websiteRows\(portfolio/.test(seg));
  ok('route: visitors map is null on a FAILED visits read (honest, not 0)',
    /visitorsBySite:\s*\(?vr[\s\S]{0,80}\?\s*Object\.fromEntries[\s\S]{0,120}:\s*null/.test(seg));
  ok('route: client_count still the active agencySiteIds count', /client_count: siteIds\.length/.test(seg));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SS7 PORTFOLIO PARITY (pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
