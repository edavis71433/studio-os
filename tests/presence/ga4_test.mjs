// ── GA4: Google Analytics 4 — pure shaping/parsing vs the OFFICIAL contract ──
// The sandbox cannot reach Google, so — exactly as AN-3.1 did for Search
// Console — the fixtures below are TRANSCRIBED from the official API contract:
//   runReport request/response:
//     https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
//     discovery: https://analyticsdata.googleapis.com/$discovery/rest?version=v1beta
//   accountSummaries.list response:
//     https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list
//     discovery: https://analyticsadmin.googleapis.com/$discovery/rest?version=v1beta
//   metric names (totalUsers, sessions, screenPageViews):
//     https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
//
//   deno run --allow-read --allow-env tests/presence/ga4_test.mjs
import { ga4PropertyPath, ga4RunReportBody, ga4RecentWindow, parseGa4Report, parseAccountSummaries, ga4SignalRows, GA4_METRICS } from '../../supabase/functions/presence/lib/ga4.ts';
import { normalize } from '../../supabase/functions/presence/connected/adapters.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

// ── property path (the URL half of "POST properties/{id}:runReport") ──
ok('ga4PropertyPath: bare id → properties/<id>', ga4PropertyPath('313646501') === 'properties/313646501');
ok('ga4PropertyPath: already-pathed id passes through', ga4PropertyPath('properties/42') === 'properties/42');
ok('ga4PropertyPath: non-numeric fails CLOSED (never a malformed URL)',
  ga4PropertyPath('bacchus') === null && ga4PropertyPath('') === null && ga4PropertyPath(null) === null && ga4PropertyPath('properties/x;y') === null);

// ── RunReportRequest (transcribed schema: dateRanges/metrics/dimensions/limit) ──
{
  const b = ga4RunReportBody('2026-07-01', '2026-07-31');
  ok('runReport body: dateRanges [{startDate,endDate}] exactly as the schema spells them',
    Array.isArray(b.dateRanges) && b.dateRanges.length === 1 && b.dateRanges[0].startDate === '2026-07-01' && b.dateRanges[0].endDate === '2026-07-31');
  ok('runReport body: metrics are [{name}] objects — totalUsers, sessions, screenPageViews',
    JSON.stringify(b.metrics) === JSON.stringify([{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }]) &&
    JSON.stringify([...GA4_METRICS]) === JSON.stringify(['totalUsers', 'sessions', 'screenPageViews']));
  ok('runReport body: totals = no dimensions; limit is a STRING (int64 per the schema), clamped',
    b.dimensions.length === 0 && b.limit === '1' && ga4RunReportBody('a', 'b', [], 9999).limit === '250');
  const dim = ga4RunReportBody('2026-07-01', '2026-07-31', ['pagePath'], 10);
  ok('runReport body: a breakdown carries [{name}] dimensions', dim.dimensions.length === 1 && dim.dimensions[0].name === 'pagePath');
}

// ── the recent window (deterministic; ends yesterday — intraday numbers settle) ──
{
  const w = ga4RecentWindow(new Date('2026-08-10T12:00:00Z'), 30);
  ok('ga4RecentWindow: 30 days ending yesterday', w.endDate === '2026-08-09' && w.startDate === '2026-07-11');
}

// ── RunReportResponse parsing (fixture transcribed from the response schema:
//    rows[].metricValues[].value are STRINGS, headers echo request order) ──
const REPORT = {
  dimensionHeaders: [],
  metricHeaders: [{ name: 'totalUsers', type: 'TYPE_INTEGER' }, { name: 'sessions', type: 'TYPE_INTEGER' }, { name: 'screenPageViews', type: 'TYPE_INTEGER' }],
  rows: [{ dimensionValues: [], metricValues: [{ value: '512' }, { value: '683' }, { value: '2100' }] }],
  rowCount: 1,
  metadata: { currencyCode: 'USD', timeZone: 'America/Los_Angeles' },
  kind: 'analyticsData#runReport',
};
{
  const t = parseGa4Report(REPORT);
  ok('parseGa4Report: reads visitors/sessions/pageviews from string metricValues', t.visitors === 512 && t.sessions === 683 && t.pageviews === 2100 && t.hasRows);
  // header-order independence: values must follow the HEADERS, not our request order
  const shuffled = { ...REPORT, metricHeaders: [{ name: 'screenPageViews' }, { name: 'totalUsers' }, { name: 'sessions' }], rows: [{ metricValues: [{ value: '2100' }, { value: '512' }, { value: '683' }] }] };
  const s = parseGa4Report(shuffled);
  ok('parseGa4Report: matches metrics BY HEADER NAME, not position', s.visitors === 512 && s.sessions === 683 && s.pageviews === 2100);
  // a property with no data in the window: rowCount 0, no rows key — never fabricate
  const empty = parseGa4Report({ metricHeaders: REPORT.metricHeaders, rowCount: 0, kind: 'analyticsData#runReport' });
  ok('parseGa4Report: empty report → nulls + hasRows:false (no fabricated zeros)', empty.visitors === null && empty.pageviews === null && !empty.hasRows);
  const junk = parseGa4Report(null);
  ok('parseGa4Report: garbage never throws', junk.visitors === null && !junk.hasRows);
}

// ── the normalizer consumes the REAL RunReportResponse (what the registry flip claims) ──
{
  const n = normalize('google_analytics', REPORT, 'your visitor numbers');
  ok('normalize: google_analytics maps a doc-shaped RunReportResponse → visitors/pageviews',
    n.visitors === 512 && n.pageviews === 2100 && n.label === 'your visitor numbers');
  ok('normalize: legacy defensive shapes still degrade safely',
    normalize('google_analytics', { totals: { users: 7, screenPageViews: 9 } }, 'x').visitors === 7 &&
    normalize('google_analytics', null, 'x').label === 'x');
}

// ── accountSummaries.list parsing (fixture transcribed from the Admin schema) ──
const SUMMARIES = {
  accountSummaries: [
    { name: 'accountSummaries/100', account: 'accounts/100', displayName: 'Davis Digital Studio',
      propertySummaries: [
        { property: 'properties/313646501', displayName: 'Bacchus Kitchen', propertyType: 'PROPERTY_TYPE_ORDINARY', parent: 'accounts/100' },
        { property: 'properties/313646502', displayName: 'davisdigitalstudio.com', propertyType: 'PROPERTY_TYPE_ORDINARY', parent: 'accounts/100' },
      ] },
    { name: 'accountSummaries/200', account: 'accounts/200', displayName: 'Client-Owned',
      propertySummaries: [{ property: 'properties/99', displayName: 'Old Site', propertyType: 'PROPERTY_TYPE_ORDINARY', parent: 'accounts/200' }] },
    { name: 'accountSummaries/300', account: 'accounts/300', displayName: 'No Properties Yet' },
  ],
};
{
  const props = parseAccountSummaries(SUMMARIES);
  ok('parseAccountSummaries: flattens every property across accounts, bare numeric ids',
    props.length === 3 && props[0].id === '313646501' && props[0].name === 'Bacchus Kitchen' && props[0].account === 'Davis Digital Studio' && props[2].id === '99');
  ok('parseAccountSummaries: an account with no properties contributes nothing', props.every((p) => p.id !== '300'));
  ok('parseAccountSummaries: malformed property refs are skipped, never guessed',
    parseAccountSummaries({ accountSummaries: [{ propertySummaries: [{ property: 'not-a-property', displayName: 'x' }] }] }).length === 0);
  ok('parseAccountSummaries: garbage never throws', parseAccountSummaries(null).length === 0 && parseAccountSummaries({}).length === 0);
}

// ── signals rows (the shared time-series store, provenance attached) ──
{
  const rows = ga4SignalRows('c1', '2026-07', { visitors: 512, sessions: 683, pageviews: 2100, hasRows: true });
  ok('ga4SignalRows: visitors + sessions + pageviews rows', rows.length === 3 &&
    rows.find((r) => r.metric === 'visitors').value === 512 && rows.find((r) => r.metric === 'sessions').value === 683 && rows.find((r) => r.metric === 'pageviews').value === 2100);
  ok('ga4SignalRows: every row tagged source=ga4 (NEVER the first-party source), scope=client, given period',
    rows.every((r) => r.source === 'ga4' && r.source !== 'visits' && r.scope === 'client' && r.period === '2026-07' && r.client_id === 'c1'));
  ok('ga4SignalRows: absent metrics are omitted, not zeroed (no fabrication)',
    ga4SignalRows('c1', '2026-07', { visitors: 5, sessions: null, pageviews: null, hasRows: true }).length === 1);
}

// ── no-AI guard (lib + sync are deterministic, like AN-3.1's) ──
{
  const libSrc = await Deno.readTextFile(new URL('../../supabase/functions/presence/lib/ga4.ts', import.meta.url));
  const syncSrc = await Deno.readTextFile(new URL('../../supabase/functions/presence/ops/ga4_sync.ts', import.meta.url));
  const banned = /(writer\/model|anthropic|openai|concierge)/;
  ok('GA4: lib + sync use no AI', !banned.test(libSrc) && !banned.test(syncSrc));
  // the sync must bucket periods EXACTLY like GSC (one month, both Google sources agree)
  ok('GA4: the sync reuses gscMonthWindow (one period bucketing for both Google sources)', /gscMonthWindow/.test(syncSrc));
  // and it must never write into the first-party visits store — signals only
  ok('GA4: the sync writes signals (source=ga4) and never queries/writes presence_visits',
    /svc\('signals\?on_conflict=client_id,metric,period,source'/.test(syncSrc) && !/svc\([^)]*presence_visits/.test(syncSrc));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ GA4: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
