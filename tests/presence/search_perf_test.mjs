// ── Phase AN-3: Search Performance — plain-English composition (pure) ─────────
//   deno run --allow-read --allow-env tests/presence/search_perf_test.mjs
import { searchInsights, searchNotice, searchHealth, searchMilestones, agencySearchState } from '../../supabase/functions/presence/analytics/search_perf.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const g = (o) => ({ impressions: 0, clicks: 0, priorImpressions: null, priorClicks: null, ctr: null, position: null, period: '2026-06', hasData: true, totalImpressions: 0, totalClicks: 0, firstImpressionAt: null, firstSearchClickAt: null, ...o });

// ── honest empty (the state everywhere today — no GSC data) ──
ok('searchInsights: NO data → empty (honest, never fabricated)', searchInsights(g({ hasData: false })).length === 0);

// ── real data → plain English, jargon translated (AN-3 §3 + §9) ──
{
  const ins = searchInsights(g({ impressions: 1284, clicks: 37, priorImpressions: 900, priorClicks: 30, period: '2026-06' }));
  const imp = ins.find((i) => i.key === 'search_impressions');
  ok('searchInsights: impressions → "People saw your business N times on Google"', /People saw your business 1,284 times on Google in June/.test(imp.sentence));
  ok('searchInsights: impressions trend is plain', /up 43% from the month before/.test(imp.sentence));
  const clk = ins.find((i) => i.key === 'search_clicks');
  ok('searchInsights: clicks → "N of them clicked through"', /37 of them clicked through to your website/.test(clk.sentence));
}
{
  const ctr = searchInsights(g({ impressions: 1000, clicks: 20, ctr: 0.02, position: 8 }));
  ok('searchInsights: CTR translated to "1 in N", never the acronym', ctr.some((i) => /1 in 50 people who saw you on Google clicked/.test(i.sentence)));
  ok('searchInsights: position translated to plain "first page"', ctr.some((i) => /first page of Google/.test(i.sentence)));
  ok('searchInsights: top-3 position → "right near the top"', searchInsights(g({ impressions: 100, clicks: 5, position: 2 })).some((i) => /right near the top/.test(i.sentence)));
}
// the no-jargon guarantee (AN-3 §9)
{
  const all = [...searchInsights(g({ impressions: 1000, clicks: 20, ctr: 0.02, position: 15, priorImpressions: 500 }))].map((i) => `${i.sentence} ${i.detail || ''}`).join(' ');
  ok('searchInsights: NO SEO jargon reaches the customer', !/\bCTR\b|\bimpressions?\b|canonical|crawl budget|\bSERP\b|click-through rate/i.test(all));
}

// ── search notice — meaningful change only, never noise ──
ok('searchNotice: big rise → good moment', searchNotice(g({ impressions: 400, priorImpressions: 200 })).tone === 'good');
ok('searchNotice: big drop → attention moment', searchNotice(g({ impressions: 80, priorImpressions: 300 })).tone === 'attention');
ok('searchNotice: tiny numbers → no moment (no noise)', searchNotice(g({ impressions: 10, priorImpressions: 8 })) === null);
ok('searchNotice: no prior → no fabricated comparison', searchNotice(g({ impressions: 400, priorImpressions: null })) === null);

// ── health signal for the coach ──
ok('searchHealth: halving impressions → falling', searchHealth(g({ impressions: 40, priorImpressions: 120 })).impressionsFalling === true);
ok('searchHealth: zero impressions → noVisibility', searchHealth(g({ impressions: 0, priorImpressions: null })).noVisibility === true);
ok('searchHealth: steady → neither', (() => { const h = searchHealth(g({ impressions: 110, priorImpressions: 100 })); return !h.impressionsFalling && !h.noVisibility; })());

// ── genuine milestones (no fakes) ──
{
  const m = searchMilestones(1200, 130, '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z');
  ok('milestones: first impression achieved with real date', m.find((x) => x.key === 'first_impression').achieved && /🎉/.test(m.find((x) => x.key === 'first_impression').note));
  ok('milestones: first click achieved', m.find((x) => x.key === 'first_search_click').achieved);
  ok('milestones: 1,000 impressions milestone reached', m.find((x) => x.key === 'impressions_1k').achieved);
  const none = searchMilestones(0, 0, null, null);
  ok('milestones: nothing achieved → anticipatory, not faked', none.every((x) => !x.achieved) && /will show here/.test(none.find((x) => x.key === 'first_search_click').note));
}

// ── agency state classification ──
ok('agencyState: no data → not_connected', agencySearchState(g({ hasData: false })) === 'not_connected');
ok('agencyState: rising → growing', agencySearchState(g({ impressions: 200, priorImpressions: 100 })) === 'growing');
ok('agencyState: dropping → falling', agencySearchState(g({ impressions: 50, priorImpressions: 100 })) === 'falling');
ok('agencyState: flat → steady', agencySearchState(g({ impressions: 105, priorImpressions: 100 })) === 'steady');

// ── AN-3 §quality / no-AI guard ──
{
  const src = await Deno.readTextFile(new URL('../../supabase/functions/presence/analytics/search_perf.ts', import.meta.url));
  ok('AN-3: search_perf composer uses no AI (deterministic)', !/(writer\/model|anthropic|openai|concierge)/.test(src));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SEARCH PERFORMANCE (AN-3): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
