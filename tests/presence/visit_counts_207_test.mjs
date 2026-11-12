// ── Builder list item 207: visits are counted in the database ────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/visit_counts_207_test.mjs
// Analytics, the client portal, the Health page and Business insights asked for up to
// 5,000 visit rows and counted them in code, but one read returns 1,000 rows at most. A
// site with more than that in the window was understated, the older weeks of the chart
// fell to zero, and the "cut short" note waited for 5,000 rows that never came. Here a
// stand-in database holds 1,500 visitors this month and hands back 1,000 rows a read, as
// production does. The pages must say 1,500: from the database's count (migration 0191),
// and, before that migration, from reading every page of rows. No Supabase is touched.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const P = '../../supabase/functions/presence';
const read = (p) => Deno.readTextFileSync(new URL(p, import.meta.url));

const SITE = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const DAY = 86_400_000;
const realNow = Date.now, realFetch = globalThis.fetch;
const NOW = Date.parse('2026-11-20T12:00:00Z');
Date.now = () => NOW;
const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };

// ── the rows: 1,500 people this month (one page view each, 300 came back for a second
//    page), 400 in the same span before it, and 100 a week in the weeks before that ──
const rows = [];
const add = (ms, who, extra = {}) => rows.push({ site_id: SITE, ts: new RealDate(ms).toISOString(), kind: 'pageview', path: '/', ref_host: 'google.com', utm_source: '', device: 'mobile', country: 'US', visitor_hash: who, ...extra });
const monthStart = Date.parse('2026-11-01T00:00:00Z'), span = NOW - monthStart;
for (let i = 0; i < 1500; i++) add(monthStart + Math.floor((i + 0.5) * span / 1500), `m${i}`, i % 5 === 0 ? { ref_host: 'google.co.uk' } : i % 7 === 0 ? { ref_host: '', utm_source: 'chatgpt.com' } : {});
for (let i = 0; i < 300; i++) add(monthStart + Math.floor((i * 5 + 0.6) * span / 1500), `m${i * 5}`, { path: '/menu/', ref_host: 'google.co.uk' });
for (let i = 0; i < 400; i++) add(monthStart - 1 - Math.floor(i * span / 400), `b${i}`);
for (let w = 6; w < 12; w++) for (let i = 0; i < 100; i++) add(NOW - w * 7 * DAY - (i + 1) * 60_000, `w${w}_${i}`);
for (let i = 0; i < 40; i++) rows.push({ ...rows[i], kind: 'phone' });
rows.push({ ...rows[0], site_id: OTHER, visitor_hash: 'elsewhere' });

// ── the stand-in database: 1,000 rows a read at most, like production ──
const world = { hasFunction: true, seen: [], failVisits: false };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const distinct = (xs) => new Set(xs.filter(Boolean)).size;
function dbStats(b) {   // what migration 0191's function answers, worked out the plain way
  const t = (r) => RealDate.parse(r.ts), start = RealDate.parse(b.p_start), now = RealDate.parse(b.p_now), end = b.p_end ? RealDate.parse(b.p_end) : Infinity;
  const mine = rows.filter((r) => r.site_id === b.p_site_id && t(r) < end && (!b.p_paths || b.p_paths.includes(r.path)));
  const pv = mine.filter((r) => r.kind === 'pageview' && t(r) >= start);
  const group = (xs, key) => { const m = new Map(); for (const x of xs) { const k = key(x); m.set(k, [...(m.get(k) || []), x]); } return [...m.entries()]; };
  return {
    visitors: distinct(pv.map((r) => r.visitor_hash)), pageviews: pv.length,
    prior_visitors: b.p_prior_start ? distinct(mine.filter((r) => r.kind === 'pageview' && t(r) >= RealDate.parse(b.p_prior_start) && t(r) < start).map((r) => r.visitor_hash)) : null,
    events: Object.fromEntries(group(mine.filter((r) => r.kind !== 'pageview' && t(r) >= start), (r) => r.kind).map(([k, xs]) => [k, xs.length])),
    pages: group(pv, (r) => r.path).map(([path, xs]) => ({ path, views: xs.length, visitors: distinct(xs.map((r) => r.visitor_hash)) })).sort((a, b2) => b2.views - a.views),
    sources: group(pv, (r) => `${r.ref_host}|${r.utm_source}`).map(([, xs]) => ({ ref_host: xs[0].ref_host, utm_source: xs[0].utm_source, visits: distinct(xs.map((r) => r.visitor_hash)) })),
    devices: group(pv, (r) => r.device).map(([device, xs]) => ({ device, views: xs.length })),
    countries: group(pv, (r) => r.country).map(([country, xs]) => ({ country, visits: xs.length })),
    weekly: b.p_weeks ? Array.from({ length: b.p_weeks }, (_, i) => distinct(mine.filter((r) => r.kind === 'pageview' && now - t(r) >= 0 && Math.floor((now - t(r)) / (7 * DAY)) === b.p_weeks - 1 - i).map((r) => r.visitor_hash))) : null,
  };
}
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input)), method = (init.method || 'GET').toUpperCase();
  const table = url.pathname.replace('/rest/v1/', ''), q = url.searchParams;
  const body = init.body ? JSON.parse(String(init.body)) : null;
  world.seen.push(`${method} ${table}${decodeURIComponent(url.search)}`);
  if (table === 'rpc/presence_visit_stats') return world.hasFunction ? reply(dbStats(body)) : reply({ code: 'PGRST202', message: 'Could not find the function public.presence_visit_stats' }, 404);
  if (table === 'rpc/presence_sites_visitors') {
    if (!world.hasFunction) return reply({ code: 'PGRST202', message: 'Could not find the function' }, 404);
    return reply(body.p_site_ids.map((id) => ({ site_id: id, visitors: distinct(rows.filter((r) => r.site_id === id && r.kind === 'pageview' && r.ts >= body.p_since).map((r) => r.visitor_hash)), pageviews: 0 })));
  }
  if (table === 'presence_visits' && method === 'GET') {
    if (world.failVisits) return reply({ message: 'no' }, 500);
    let out = rows.filter((r) => q.get('site_id') === `eq.${r.site_id}`);
    for (const f of q.getAll('ts')) { const [op, v] = [f.slice(0, f.indexOf('.')), f.slice(f.indexOf('.') + 1)]; out = out.filter((r) => (op === 'gte' ? r.ts >= v : op === 'lt' ? r.ts < v : true)); }
    const kind = q.get('kind') || '';
    if (kind.startsWith('in.(')) out = out.filter((r) => kind.slice(4, -1).split(',').includes(r.kind));
    if (kind.startsWith('not.in.(')) out = out.filter((r) => !kind.slice(8, -1).split(',').includes(r.kind));
    if (kind.startsWith('eq.')) out = out.filter((r) => r.kind === kind.slice(3));
    const dir = (q.get('order') || '').endsWith('.asc') ? 1 : -1;
    out = [...out].sort((a, b) => dir * a.ts.localeCompare(b.ts));
    const off = Number(q.get('offset') || 0);
    return reply(out.slice(off, off + Math.min(1000, Number(q.get('limit') || 1000))));   // the cap: 1,000 rows a read, whatever was asked
  }
  if (method === 'POST') return reply([{ id: crypto.randomUUID() }], 201);
  return reply([]);
};

const V = await import(`${P}/lib/visit_stats.ts`);
const { handleClientWebsiteStats } = await import(`${P}/routes/client_delivery.ts`);
const AN = await import(`${P}/routes/analytics.ts`);
const site = { id: SITE, client_id: null, status: 'live', edition: 'presence', last_published_at: '2026-10-01T00:00:00Z', template_slug: 'business-classic', template_version: '1.0.0' };
const cors = {};
const weeks = (w) => w.reduce((a, b) => a + b, 0);

// ── 1. the client portal: 1,500 visitors is 1,500 ──
for (const hasFunction of [true, false]) {
  world.hasFunction = hasFunction; world.seen = [];
  const when = hasFunction ? 'counted in the database' : 'before 0191, every page of rows';
  const m = (await (await handleClientWebsiteStats(new Request('https://fn.test/x'), site, {}, cors)).json()).data.month;
  eq(`portal, ${when}: this month's visitors and page views are all there, not the first 1,000 rows`, [m.visitors, m.pageviews], [1500, 1800]);
  eq(`portal, ${when}: the 12-week line reaches back, older weeks aren't zero`, [m.weekly.length, m.weekly.slice(0, 6), m.weekly.slice(6).every((n) => n > 0)], [12, [100, 100, 100, 100, 100, 100], true]);
  eq(`portal, ${when}: calls and taps, the pages, and nothing marked cut short`, [m.actions, m.top_pages.map((p) => [p.path, p.views]), m.truncated], [40, [['/', 1500], ['/menu/', 300]], false]);
  eq(`portal, ${when}: Google's hosts are one row, AI assistants another`, m.sources.map((s) => s.source).sort(), ['AI assistants', 'Google']);
  ok(`portal, ${when}: ${hasFunction ? 'one question to the database, no rows fetched' : 'the rows are read page after page'}`, hasFunction
    ? world.seen.filter((s) => s.includes('rpc/presence_visit_stats')).length === 1 && !world.seen.some((s) => s.startsWith('GET presence_visits'))
    : world.seen.filter((s) => s.startsWith('GET presence_visits') && s.includes('offset=')).length >= 3);
}

// ── 2. Analytics: the same numbers, and the period before ──
for (const hasFunction of [true, false]) {
  world.hasFunction = hasFunction;
  const when = hasFunction ? 'counted in the database' : 'before 0191, every page of rows';
  const d = (await (await AN.handleAnalyticsDashboard(new Request('https://fn.test/functions/v1/presence/analytics/dashboard?period=this_month&tzo=0'), site, cors)).json()).data;
  const t = d.website?.traffic || d.traffic || d.website;
  eq(`Analytics, ${when}: visitors, page views and the period before`, [t.visitors, t.pageviews, t.prior_visitors, t.truncated], [1500, 1800, 400, false]);
  eq(`Analytics, ${when}: the weekly line adds up past 1,000`, [t.weekly.length, weeks(t.weekly) > 1000, t.weekly[0]], [12, true, 100]);
  eq(`Analytics, ${when}: the portal and Analytics agree`, t.visitors, 1500);
}
world.hasFunction = true;

// ── 3. the Health page and Business insights (the last 30 days, and the 30 before) ──
{
  const a = await AN.loadVisitAgg(SITE, 'month', NOW);
  const want = distinct(rows.filter((r) => r.site_id === SITE && r.kind === 'pageview' && RealDate.parse(r.ts) >= NOW - 30 * DAY).map((r) => r.visitor_hash));
  ok('health and insights: the 30-day count is past 1,000 and whole', a.visitors === want && want > 1000 && a.truncated === false, `${a.visitors} of ${want}`);
  ok('health and insights: the 30 days before are counted for the trend', a.priorVisitors > 0);
  ok('the old row loader with its 5,000 cap is gone', AN.loadVisits === undefined && !/limit=5000`\)\);\s+\/\/ item 157/.test(read(`${P}/routes/analytics.ts`)));
  world.failVisits = true; world.hasFunction = false;
  const none = await AN.loadVisitAgg(SITE, 'month', NOW);
  eq('a failed read is nothing to say, never a made-up number', [none.visitors, none.hasData], [0, false]);
  eq('…and the stats read itself answers null, so Analytics can say it could not load', await V.readVisitStats(SITE, { startMs: NOW - DAY, nowMs: NOW }), null);
  world.failVisits = false; world.hasFunction = true;
}

// ── 4. a form's "seen by" and the studio's client list ──
{
  world.seen = [];
  const s = await V.readVisitStats(SITE, { startMs: NOW - 30 * DAY, nowMs: NOW, paths: ['/menu/', '/menu'] });
  eq('a form\'s pages: the people who saw them, counted in the database', s.agg.visitors, 300);
  ok('a form\'s pages: the paths ride along', world.seen.some((x) => x.includes('rpc/presence_visit_stats')));
  eq('client list: visitors per site in one question', await V.readSitesVisitors([SITE, OTHER], new RealDate(NOW - 7 * DAY).toISOString()), { [SITE]: distinct(rows.filter((r) => r.site_id === SITE && r.kind === 'pageview' && RealDate.parse(r.ts) >= NOW - 7 * DAY).map((r) => r.visitor_hash)), [OTHER]: 0 });
  world.hasFunction = false;
  eq('client list before 0191: null, and the route falls back to its old read', await V.readSitesVisitors([SITE], new RealDate(NOW - 7 * DAY).toISOString()), null);
  world.hasFunction = true;
  const an = read(`${P}/routes/analytics.ts`), com = read(`${P}/routes/commercial.ts`);
  ok('client list: the stand-in read says "cut short" at a full page of 1,000, not at a cap it can never reach', /truncated: truncated \|\| arr\(vr\)\.length >= 1000/.test(an));
  ok('form answers: no row read with a limit one read can\'t reach', /readVisitStats\(site\.id, \{ startMs: Date\.parse\(since\), nowMs: Date\.now\(\), paths: formPaths \}\)/.test(com) && !/presence_visits\?[^`]*limit=20000/.test(com));
}

// ── 5. the database's answer in the pages' shapes ──
{
  const s = V.statsFromDb({ visitors: 10, pageviews: 30, prior_visitors: 4, events: { phone: 2, cta: 1, outbound: 9 },
    pages: [{ path: '/', views: 20, visitors: 9 }, { path: '/a/', views: 10, visitors: 5 }],
    sources: [{ ref_host: 'google.com', utm_source: '', visits: 4 }, { ref_host: 'google.de', utm_source: '', visits: 2 }, { ref_host: '', utm_source: '', visits: 3 }, { ref_host: 'chatgpt.com', utm_source: '', visits: 1 }, { ref_host: '', utm_source: 'perplexity', visits: 2 }],
    devices: [{ device: 'desktop', views: 10 }, { device: 'mobile', views: 30 }], countries: [{ country: 'US', visits: 25 }], weekly: [1, 2, 3] }, 3);
  eq('shape: sources worded by the one sourceLabel, same wording added up', s.agg.topSources, [{ source: 'Google', visits: 6 }, { source: 'Direct', visits: 3 }, { source: 'AI assistants', visits: 3 }]);
  eq('shape: who the AI assistants were', s.agg.aiAssistants, [{ name: 'Perplexity', visits: 2 }, { name: 'ChatGPT', visits: 1 }]);
  eq('shape: devices as whole percents, largest first', s.agg.devices, [{ device: 'mobile', share: 75 }, { device: 'desktop', share: 25 }]);
  eq('shape: the rest', [s.agg.visitors, s.agg.pageviews, s.priorVisitors, s.agg.events, s.weekly, s.agg.topPages, s.agg.hasData, s.truncated], [10, 30, 4, { phone: 2, email: 0, cta: 1, download: 0 }, [1, 2, 3], [{ path: '/', views: 20 }, { path: '/a/', views: 10 }], true, false]);
  eq('shape: no window before asked for is null, never zero', V.statsFromDb({ visitors: 1, pageviews: 1, prior_visitors: null }).priorVisitors, null);
  eq('shape: an empty answer is an honest nothing', [V.statsFromDb(null).agg.hasData, V.statsFromDb(null, 2).weekly], [false, [0, 0]]);
}

// ── 6. the migration and the pack ──
{
  const migration = read('../../supabase/migrations/0191_visit_stats.sql'), pack = read('../../docs/presence/APPLY-0191-prod.sql');
  const SIG = 'uuid, timestamptz, timestamptz, timestamptz, timestamptz, int, text\\[\\]';
  for (const [name, sql] of [['migration', migration], ['pack', pack]]) {
    ok(`${name}: both functions, for the function's key only`, new RegExp(`grant execute on function public\\.presence_visit_stats\\(${SIG}\\) to service_role`).test(sql) && new RegExp(`revoke all on function public\\.presence_visit_stats\\(${SIG}\\) from public, anon, authenticated`).test(sql)
      && /grant execute on function public\.presence_sites_visitors\(uuid\[\], timestamptz\) to service_role/.test(sql) && /revoke all on function public\.presence_sites_visitors\(uuid\[\], timestamptz\) from public, anon, authenticated/.test(sql));
    ok(`${name}: a visitor is a day's mark on a page view, and a row with no mark is not a person`, /count\(distinct vh\) from pv/.test(sql) && /nullif\(v\.visitor_hash, ''\) as vh/.test(sql) && /pv as \(select \* from cur where kind = 'pageview'\)/.test(sql));
    ok(`${name}: read-only (stable, no writes)`, /language sql stable/.test(sql) && !/\b(insert into|update public|delete from|truncate)\b/i.test(sql));
  }
  ok('pack: the function bodies are the migration\'s, word for word', pack.includes(migration.slice(migration.indexOf('create or replace function public.presence_visit_stats'))));
  const named = [...read(`${P}/lib/visit_stats.ts`).matchAll(/\b(p_[a-z_]+):/g)].map((m) => m[1]);
  ok('the server names only arguments the functions have', named.length >= 9 && named.every((a) => new RegExp(`\\b${a}\\b`).test(migration)), named.join(','));
}

globalThis.Date = RealDate; Date.now = realNow; globalThis.fetch = realFetch;
const failed = results.filter((r) => !r.p).length;
console.log(`visit_counts_207: ${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
