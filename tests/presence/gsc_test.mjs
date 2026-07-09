// ── Phase AN-3.1: Google Search Console — pure parsing + detail composition ───
//   deno run --allow-read --allow-env tests/presence/gsc_test.mjs
import { propertyCandidates, gscQueryBody, gscMonthWindow, parseTotals, parseTermRows, signalRowsFor } from '../../supabase/functions/presence/lib/gsc.ts';
import { searchDetailInsights } from '../../supabase/functions/presence/analytics/search_perf.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

// ── property candidates (Domain vs URL-prefix), reused from the proven collector ──
ok('propertyCandidates: domain + url-prefix forms, strips www/scheme', JSON.stringify(propertyCandidates('https://www.joesplumbing.com/')) === JSON.stringify(['sc-domain:joesplumbing.com', 'https://joesplumbing.com/', 'https://www.joesplumbing.com/']));
ok('propertyCandidates: empty → []', propertyCandidates('').length === 0);

// ── month window (previous full calendar month) ──
{
  const w = gscMonthWindow(new Date('2026-07-15T00:00:00Z'));
  ok('gscMonthWindow: previous month range + period', w.startDate === '2026-06-01' && w.endDate === '2026-06-30' && w.period === '2026-06');
  const jan = gscMonthWindow(new Date('2026-01-10T00:00:00Z'));
  ok('gscMonthWindow: rolls over the year (Jan → prev Dec)', jan.period === '2025-12' && jan.startDate === '2025-12-01' && jan.endDate === '2025-12-31');
}

// ── request body (quota-safe rowLimit) ──
ok('gscQueryBody: dimensions + clamped rowLimit', (() => { const b = gscQueryBody('2026-06-01', '2026-06-30', ['query'], 9999); return b.dimensions[0] === 'query' && b.rowLimit === 250; })());
ok('gscQueryBody: site totals = no dimensions', gscQueryBody('2026-06-01', '2026-06-30').dimensions.length === 0);

// ── parse the proven GSC response shapes ──
ok('parseTotals: reads clicks/impressions/ctr/position', (() => { const t = parseTotals({ rows: [{ clicks: 37, impressions: 1284, ctr: 0.0288, position: 12.3 }] }); return t.clicks === 37 && t.impressions === 1284 && Math.abs(t.ctr - 0.0288) < 1e-6 && t.position === 12.3; })());
ok('parseTotals: empty response → zeros, ctr null (no fabrication)', (() => { const t = parseTotals({}); return t.impressions === 0 && t.clicks === 0 && t.ctr === null && t.position === null; })());
ok('parseTermRows: rows with keys[] → normalized terms', (() => { const r = parseTermRows({ rows: [{ keys: ['plumber near me'], clicks: 10, impressions: 100, position: 4.5 }, { keys: [''], clicks: 1, impressions: 2 }] }); return r.length === 1 && r[0].key === 'plumber near me' && r[0].clicks === 10 && r[0].position === 4.5; })());

// ── signals rows (aggregate → the shared time-series store) ──
{
  const rows = signalRowsFor('c1', '2026-06', { impressions: 1284, clicks: 37, ctr: 0.0288, position: 12.34 });
  ok('signalRowsFor: impressions + clicks + ctr(pct) + position rows', rows.length === 4 && rows.find((r) => r.metric === 'search_impressions').value === 1284 && rows.find((r) => r.metric === 'search_ctr').value === 2.9 && rows.find((r) => r.metric === 'avg_position').value === 12.3);
  ok('signalRowsFor: all tagged source=gsc, scope=client, given period', rows.every((r) => r.source === 'gsc' && r.scope === 'client' && r.period === '2026-06' && r.client_id === 'c1'));
  ok('signalRowsFor: omits ctr/position when absent', signalRowsFor('c1', '2026-06', { impressions: 5, clicks: 0, ctr: null, position: null }).length === 2);
}

// ── plain-English detail (AN-3.1 §Analytics — sentences, no keyword table, no jargon) ──
{
  const qs = [{ key: 'joes plumbing', clicks: 12, impressions: 200, position: 3 }, { key: 'emergency plumber', clicks: 5, impressions: 80, position: 6 }];
  const ps = [{ key: 'https://x.com/services/', clicks: 9, impressions: 150, position: 4 }];
  const cards = searchDetailInsights(qs, ps);
  ok('detail: top query as a sentence', cards.some((c) => /Your top search is “joes plumbing” — 12 clicks from 200 appearances on Google\./.test(c.sentence)));
  ok('detail: top page in plain English (no raw URL)', cards.some((c) => c.key === 'top_page' && /Your services page brings the most people/.test(c.sentence)));
  ok('detail: NO SEO jargon (no CTR/impressions/query/SERP)', !/\bCTR\b|\bimpressions?\b|\bquery\b|\bSERP\b/i.test(cards.map((c) => c.sentence + ' ' + (c.detail || '')).join(' ')));
  ok('detail: empty when no data (honest)', searchDetailInsights([], []).length === 0);
}

// ── AN-3.1 no-AI guard (sync + lib are deterministic) ──
{
  const gscSrc = await Deno.readTextFile(new URL('../../supabase/functions/presence/lib/gsc.ts', import.meta.url));
  const syncSrc = await Deno.readTextFile(new URL('../../supabase/functions/presence/ops/gsc_sync.ts', import.meta.url));
  const banned = /(writer\/model|anthropic|openai|concierge)/;
  ok('AN-3.1: GSC lib + sync use no AI', !banned.test(gscSrc) && !banned.test(syncSrc));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ GSC (AN-3.1): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
