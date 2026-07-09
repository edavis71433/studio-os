// ── Phase AN-1: Analytics — plain-English composition (pure) + AN-9 no-AI guard ──
//   deno run --allow-read --allow-env tests/presence/analytics_test.mjs
import { windowCounts, trendPhrase, inquiriesInsight, publishingInsight, notMeasured, searchReadinessInsight, portfolioInsights } from '../../supabase/functions/presence/analytics/compose.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const NOW = Date.parse('2026-07-08T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();

// ── windowCounts ──
{
  const times = [daysAgo(1), daysAgo(3), daysAgo(6), daysAgo(9), daysAgo(13)]; // 3 in last 7d, 2 in prior 7d
  const c = windowCounts(times, NOW, 7);
  ok('windowCounts: splits current vs prior window', c.current === 3 && c.prior === 2);
  ok('windowCounts: ignores junk/empty timestamps', windowCounts([null, '', 'nonsense', daysAgo(2)], NOW, 7).current === 1);
}

// ── trendPhrase ──
ok('trendPhrase: up', trendPhrase(6, 4, 'week').includes('up from 4'));
ok('trendPhrase: down', trendPhrase(2, 5, 'week').includes('down from 5'));
ok('trendPhrase: steady', trendPhrase(4, 4, 'week').includes('steady'));
ok('trendPhrase: no prior → no invented comparison', trendPhrase(3, 0, 'week') === '');

// ── inquiries ──
{
  const none = inquiriesInsight([], { contact: 0, quote: 0, booking: 0 }, 0, NOW, 'week');
  ok('inquiries: zero history → honest "no inquiries yet" (no fake number)', /no inquiries yet/i.test(none.sentence) && none.number === 0);
  const some = inquiriesInsight([daysAgo(1), daysAgo(2), daysAgo(3), daysAgo(10)], { contact: 2, quote: 1, booking: 0 }, 2, NOW, 'week');
  ok('inquiries: counts this week + trend vs prior', some.number === 3 && /3 inquiries this week/.test(some.sentence) && /up from 1/.test(some.sentence));
  ok('inquiries: unread surfaces as the detail', /2 inquiries are still waiting/.test(some.detail));
  ok('inquiries: single inquiry reads "1 inquiry"', /1 inquiry this week/.test(inquiriesInsight([daysAgo(1)], { contact: 1, quote: 0, booking: 0 }, 0, NOW, 'week').sentence));
}

// ── publishing ──
ok('publishing: never published → honest prompt', /hasn’t been published yet/.test(publishingInsight([], null, NOW, 'week').sentence));
ok('publishing: last updated N days + count this period', (() => { const i = publishingInsight([daysAgo(2), daysAgo(5)], daysAgo(2), NOW, 'week'); return /last updated 2 days ago/.test(i.sentence) && /published 2 updates this week/.test(i.sentence); })());
ok('publishing: long-stale flags attention', publishingInsight([daysAgo(90)], daysAgo(90), NOW, 'month').tone === 'attention');

// ── not-measured (NEVER fabricated) ──
{
  const both = notMeasured(false, false);
  ok('notMeasured: disconnected → honest traffic + search cards, no numbers', both.length === 2 && both.every((c) => c.number === null) && both.some((c) => c.key === 'traffic') && both.some((c) => c.key === 'search'));
  ok('notMeasured: connected → nothing to disclaim', notMeasured(true, true).length === 0);
  ok('notMeasured: traffic card points to Connections (actionable)', both.find((c) => c.key === 'traffic').href === '/connections.html');
}

// ── search readiness (real booleans, not fake impressions) ──
ok('searchReadiness: all set → confident, good tone', searchReadinessInsight({ verified: true, titleSet: true, descriptionSet: true, sitemap: true, brokenLinks: 0 }).tone === 'good');
ok('searchReadiness: missing pieces named plainly', /missing a search title, a search description/.test(searchReadinessInsight({ verified: true, titleSet: false, descriptionSet: false, sitemap: true, brokenLinks: 0 }).sentence));
ok('searchReadiness: broken links flagged', /point somewhere broken/.test(searchReadinessInsight({ verified: true, titleSet: true, descriptionSet: true, sitemap: true, brokenLinks: 2 }).sentence));

// ── agency portfolio (composes buildPortfolio rows) ──
{
  const clients = [
    { name: 'Joe’s Plumbing', leads_waiting: 2, attention: 3, last_published_at: daysAgo(3) },
    { name: 'Bella Salon', leads_waiting: 0, attention: 0, last_published_at: daysAgo(45) },
    { name: 'Acme Co', leads_waiting: 1, attention: 1, last_published_at: daysAgo(2) },
  ];
  const { headline, insights } = portfolioInsights(clients, NOW);
  ok('portfolio: surfaces who has new inquiries', insights.find((i) => i.key === 'growing')?.number === 2);
  ok('portfolio: surfaces who needs attention', insights.find((i) => i.key === 'attention')?.number === 2);
  ok('portfolio: surfaces who has gone quiet (>30d)', insights.find((i) => i.key === 'quiet')?.number === 1);
  ok('portfolio: headline frames the whole portfolio', /Across 3 clients/.test(headline));
  const calm = portfolioInsights([{ name: 'X', leads_waiting: 0, attention: 0, last_published_at: daysAgo(2) }], NOW);
  ok('portfolio: all-quiet → reassuring headline, no invented work', calm.insights.length === 0 && /nothing needs you/.test(calm.headline));
}

// ── AN-9: Analytics adds NO AI. The route + compose must not import any model. ──
{
  const routeSrc = await Deno.readTextFile(new URL('../../supabase/functions/presence/routes/analytics.ts', import.meta.url));
  const composeSrc = await Deno.readTextFile(new URL('../../supabase/functions/presence/analytics/compose.ts', import.meta.url));
  const banned = /(writer\/model|anthropic|openai|concierge|runEvidence|runJudgment|runRecommendation|runMoments|runGrowthCoach)/;
  ok('AN-9: routes/analytics.ts imports no AI/model/engine-run (reads stored rows only)', !banned.test(routeSrc));
  ok('AN-9: analytics/compose.ts is pure (no AI, no import statements)', !banned.test(composeSrc) && !/^\s*import\s/m.test(composeSrc));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ ANALYTICS (AN-1): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
