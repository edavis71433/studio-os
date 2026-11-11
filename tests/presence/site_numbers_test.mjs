// ── Builder list items 129, 180 and 183: health kept by day, and every site's numbers ──
//   deno run --allow-read --allow-env tests/presence/site_numbers_test.mjs
// The health a run gives (lib/health_score.ts): problem TYPES counted once, state never
// counted, the studio's number from fixed weights, what was fixed and what is new; the
// evidence engine keeps one row a day; GET /agency/site-numbers folds visitors, Google
// clicks and health per site, says why a number is missing, never shows a zero for an
// unread number, and works before migration 0170. No Supabase is touched.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const P = '../../supabase/functions/presence';
const H = await import(`${P}/lib/health_score.ts`);
const { CATALOG } = await import(`${P}/evidence/contract.ts`);
const N = await import(`${P}/agency/site_numbers.ts`);
const read = (p) => Deno.readTextFileSync(new URL(p, import.meta.url));

// ── 1. one run's health ──
{
  const it = (type, severity, res = '/') => ({ type, severity, resource: res, fingerprint: `s|${type}|${res}` });
  const items = [
    it('seo.description_missing', 'warning', '/'), it('seo.description_missing', 'warning', '/about/'), it('seo.description_missing', 'warning', '/team/'),
    it('links.internal_broken', 'critical', '/team/'),
    it('website.hosting_missing', 'warning'), it('website.not_live', 'info'),
    it('seo.noindex', 'warning', '/thanks/'),
    it('media.unused', 'info', 'm1'),
  ];
  const live = H.healthOf(items, { live: true });
  eq('health: a problem type counts once, with how many places it touches', live.issues.map((i) => [i.type, i.n]), [['links.internal_broken', 1], ['seo.description_missing', 3], ['seo.noindex', 1]]);
  eq('health: critical first, then the most places', live.issues[0].severity, 'critical');
  ok('health: where a site is (not hosted with us, not live) is never a problem', !live.issues.some((i) => H.STATE_TYPES.has(i.type)));
  ok('health: ideas (info) are not things to look at', !live.issues.some((i) => i.type === 'media.unused'));
  eq('health: critical and warning types', [live.critical, live.warning], [1, 2]);
  eq('health: the studio number is 100 less 12 a critical type and 4 a warning type', live.score, 100 - 12 - 8);
  eq('health: the weights', H.HEALTH_WEIGHTS, { critical: 12, warning: 4 });
  ok('health: every failing item is fingerprinted for fixed and new', live.fingerprints.length === 5 && live.fingerprints.includes('s|links.internal_broken|/team/') && !live.fingerprints.some((f) => f.includes('hosting_missing')));
  const draft = H.healthOf(items, { live: false });
  ok('health: a site not published yet is meant to be hidden from Google', !draft.issues.some((i) => i.type === 'seo.noindex') && draft.warning === 1);
  const hidden = H.healthOf(items, { live: true, hidden: true });
  ok('health: so is one hidden from search on purpose', !hidden.issues.some((i) => i.type === 'seo.noindex'));
  eq('health: nothing wrong is 100 and nothing to look at', H.healthOf([], { live: true }), { score: 100, critical: 0, warning: 0, issues: [], fingerprints: [] });
  const many = H.healthOf(Array.from({ length: 12 }, (_, n) => it(`seo.x${n}`, 'critical')), { live: true });
  eq('health: the number never goes below 0', many.score, 0);
  eq('health: fixed and new, by fingerprint', H.sinceThen(['a', 'b', 'c'], ['b', 'c', 'd']), { fixed: ['a'], added: ['d'] });
  eq('health: nothing kept before is all new', H.sinceThen(null, ['x']), { fixed: [], added: ['x'] });
  eq('health: the type part of a fingerprint', H.typeOfFingerprint('site|seo.noindex|/x/'), 'seo.noindex');
}

// ── 2. every problem that can count has a plain title and a plain heading ──
{
  const counted = Object.entries(CATALOG).filter(([, v]) => v.severity !== 'info').map(([k]) => k);
  const untitled = counted.filter((t) => !H.TYPE_TITLES[t]);
  eq('titles: every critical or warning type in the catalog has a plain title', untitled, []);
  const cats = [...new Set(Object.values(CATALOG).map((v) => v.category))];
  const keys = new Set(H.HEADINGS.map((h) => h.key));
  ok('headings: every category sits under one of the seven headings', cats.every((c) => keys.has(H.headingOf(`${c}.x`))));
  eq('headings: the padlock is about reaching the site', H.headingOf('trust.ssl_missing'), 'reach');
  eq('headings: seven, in the Search tab’s order', H.HEADINGS.map((h) => h.title), ['Can people reach it', 'Speed', 'Google can read it', 'Everyone can use it', 'Words and pictures', 'Links', 'Business details']);
  ok('titles: plain words, no "template concern" talk', Object.values(H.TYPE_TITLES).every((t) => !/template|schema|ldjson|aria|DNS/i.test(t)));
  eq('titles: a type without a title falls back to the run’s sentence', H.titleOf('new.type', 'The run says so'), 'The run says so');
}

// ── 3. the evidence engine keeps one row a day ──
{
  const src = read(`${P}/evidence/engine.ts`);
  ok('engine: the day’s health is kept after the run is finished, best-effort', /await recordHealthDay\(site, runId, items, new Date\(\)\.toISOString\(\)\)\.catch\(\(\) => \{\}\);\n\s+return \{ ok: true/.test(src));
  ok('engine: one row per site and day, the last run of the day winning', /presence_health_days\?on_conflict=site_id,day/.test(src) && /resolution=merge-duplicates/.test(src) && /day: nowIso\.slice\(0, 10\)/.test(src));
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); return new Response(null, { status: 201 }); };
  const { recordHealthDay } = await import(`${P}/evidence/engine.ts`);
  const site = { id: 's1', client_id: 'c1', status: 'ready', last_published_at: '2026-10-01T00:00:00Z', template_slug: 't', template_version: '1', custom_domain: null, netlify_site_id: null, edition: 'presence' };
  const wrote = await recordHealthDay(site, 'run-1', [{ type: 'seo.noindex', severity: 'warning', fingerprint: 's1|seo.noindex|/' }], '2026-11-11T10:00:00.000Z');
  const body = JSON.parse(calls[0].init.body);
  ok('engine: published once means live, so hidden pages count', wrote && body.warning === 1 && body.score === 96 && body.day === '2026-11-11' && body.run_id === 'run-1');
  const migration = read('../../supabase/migrations/0170_site_numbers.sql'), pack = read('../../docs/presence/APPLY-0170-prod.sql');
  for (const [name, sql] of [['migration', migration], ['pack', pack]]) {
    ok(`${name}: the table, keyed by site and day, closed to everyone but the function`, /create table if not exists public\.presence_health_days/.test(sql) && /primary key \(site_id, day\)/.test(sql) && /enable row level security/.test(sql) && /revoke all on public\.presence_health_days from anon, authenticated/.test(sql));
    ok(`${name}: visitors counted in the database, for the function's key only`, /create or replace function public\.presence_month_visitors\(p_site_ids uuid\[\], p_since timestamptz\)/.test(sql) && /count\(distinct nullif\(v\.visitor_hash, ''\)\)/.test(sql) && /v\.kind = 'pageview'/.test(sql) && /grant execute on function public\.presence_month_visitors\(uuid\[\], timestamptz\) to service_role/.test(sql) && /revoke all on function public\.presence_month_visitors\(uuid\[\], timestamptz\) from public, anon, authenticated/.test(sql));
  }
  ok('retention: health days are kept a little over a year', /presence_health_days\?day=lt\./.test(read(`${P}/ops/retention.ts`)));
}

// ── 4. the months and days compared ──
{
  eq('months: on Nov 11 it is October against September', N.monthsCompared('2026-11-11T10:00:00Z'), { month: '2026-10', prior: '2026-09', label: 'October', priorLabel: 'September', sinceIso: '2026-09-01T00:00:00.000Z' });
  eq('months: in January it reaches back over the year', N.monthsCompared('2027-01-02T00:00:00Z').month + ' ' + N.monthsCompared('2027-01-02T00:00:00Z').prior, '2026-12 2026-11');
  const d = N.healthDays('2026-11-11T23:59:00Z');
  eq('health days: today, then yesterday', d.current, ['2026-11-11', '2026-11-10']);
  eq('health days: 30 days back first, then out to 26 and 34', [d.then[0], d.then.length, d.then.includes('2026-10-08'), d.then.includes('2026-10-16')], ['2026-10-12', 9, true, true]);
}

// ── 5. folding the numbers ──
{
  const S = (id, over = {}) => ({ id, client_id: 'c-' + id, edition: 'presence', status: 'live', last_published_at: '2026-06-01T00:00:00Z', ...over });
  const base = {
    sites: [S('live1'), S('watch', { edition: 'monitor' }), S('draft', { status: 'ready', last_published_at: null }), S('quiet'), S('new')],
    month: '2026-10', prior: '2026-09', nowIso: '2026-11-11T10:00:00Z',
    counterOff: new Set(['quiet']), connected: new Set(['live1', 'new', 'watch']),
    visits: [{ site_id: 'live1', month: '2026-10', visitors: 812 }, { site_id: 'live1', month: '2026-09', visitors: 688 }, { site_id: 'new', month: '2026-10', visitors: 40 }],
    visitsReady: true,
    clicks: [{ client_id: 'c-live1', period: '2026-10', value: 64 }, { client_id: 'c-live1', period: '2026-09', value: 59 }, { client_id: 'c-watch', period: '2026-10', value: 210 }],
    health: [{ site_id: 'live1', day: '2026-11-11', score: 86, critical: 0, warning: 2 }, { site_id: 'live1', day: '2026-10-12', score: 82, critical: 0, warning: 3 }, { site_id: 'live1', day: '2026-10-08', score: 50, critical: 3, warning: 1 },
      { site_id: 'watch', day: '2026-11-10', score: 74, critical: 1, warning: 1 }],
  };
  const out = N.foldSiteNumbers(base);
  eq('fold: last month against the month before', out.live1.visitors, { value: 812, prior: 688 });
  eq('fold: Google clicks the same way, per client', out.live1.search, { value: 64, prior: 59 });
  eq('fold: health today against the day nearest a month ago', out.live1.health, { score: 86, prior: 82, to_look_at: 2, day: '2026-11-11', prior_day: '2026-10-12' });
  eq('fold: a site we only watch has no counter of ours', [out.watch.visitors, out.watch.visitors_why], [null, 'no_counter']);
  eq('fold: …but its Google clicks and health still show (yesterday’s, if today’s isn’t in)', [out.watch.search, out.watch.health.score, out.watch.health.prior], [{ value: 210, prior: null }, 74, null]);
  eq('fold: a site not published yet has no visitors to count', out.draft.visitors_why, 'not_live');
  eq('fold: the owner switched the counter off', out.quiet.visitors_why, 'counter_off');
  eq('fold: a first month counts the month before as none', out.new.visitors, { value: 40, prior: 0 });
  eq('fold: connected, but Google hasn’t sent last month yet', [out.new.search, out.new.search_why], [null, 'waiting']);
  eq('fold: not connected to Search Console', out.draft.search_why, 'not_connected');
  eq('fold: never checked yet', out.draft.health_why, 'not_checked');
  const before = N.foldSiteNumbers({ ...base, visits: null, visitsReady: false, health: null, healthReady: false });
  eq('fold: before migration 0170, visitors and health aren’t ready, never zero', [before.live1.visitors, before.live1.visitors_why, before.live1.health, before.live1.health_why], [null, 'not_ready', null, 'not_ready']);
  const failed = N.foldSiteNumbers({ ...base, visits: null, clicks: null, health: null, connected: null });
  eq('fold: a failed read says so, never a zero', [failed.live1.visitors_why, failed.live1.search_why, failed.live1.health_why], ['unavailable', 'unavailable', 'unavailable']);
}

// ── 6. the route, against a stubbed database ──
{
  const AG = 'aaaaaaaa-0000-4000-8000-000000000000';
  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
  const CA = '33333333-3333-4333-8333-333333333333';
  let missing = false, seen = [];
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url)); const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search);
    seen.push(`${(init.method || 'GET').toUpperCase()} ${table}${q}`);
    if (table === 'presence_agency_clients') return reply([{ site_id: A }, { site_id: B }]);
    if (table === 'presence_sites') return reply([{ id: A, client_id: CA, edition: 'presence', status: 'live', last_published_at: null }, { id: B, client_id: null, edition: 'monitor', status: 'ready', last_published_at: null }]);
    if (table === 'presence_settings') return reply([]);
    if (table === 'presence_connections') return reply([{ site_id: A }]);
    if (table === 'rpc/presence_month_visitors') return missing ? reply({ code: 'PGRST202', message: 'Could not find the function' }, 404) : reply([{ site_id: A, month: '2026-10', visitors: 30, pageviews: 90 }, { site_id: A, month: '2026-09', visitors: 60, pageviews: 100 }]);
    if (table === 'presence_health_days') return missing ? reply({ code: 'PGRST205', message: 'Could not find the table' }, 404) : reply([{ site_id: A, day: '2026-11-11', score: 92, critical: 0, warning: 2 }]);
    if (table === 'signals') return reply([{ client_id: CA, period: '2026-10', value: 7 }, { client_id: CA, period: '2026-09', value: 14 }]);
    return reply([]);
  };
  const member = { agency_id: AG, member_id: 'm1', email: 'owner@studio.example', role: 'owner' };
  const r = await N.handleSiteNumbers('/agency/site-numbers', 'GET', member, {}, '2026-11-11T10:00:00Z');
  const j = await r.json();
  eq('route: the months, in words', [j.month, j.prior_month, j.month_label, j.prior_label, j.partial], ['2026-10', '2026-09', 'October', 'September', false]);
  eq('route: a drop is a drop', [j.data[A].visitors, j.data[A].search], [{ value: 30, prior: 60 }, { value: 7, prior: 14 }]);
  eq('route: health from the day kept', j.data[A].health.score, 92);
  ok('route: every site asked for at once, and only the two months', seen.some((s) => s.startsWith('POST rpc/presence_month_visitors')) && seen.some((s) => /signals\?client_id=in\.\(33333333-3333-4333-8333-333333333333\)&source=eq\.gsc&metric=eq\.search_clicks&period=in\.\(2026-10,2026-09\)/.test(s)));
  missing = true; seen = [];
  const r2 = await N.handleSiteNumbers('/agency/site-numbers', 'GET', member, {}, '2026-11-11T10:00:00Z');
  const j2 = await r2.json();
  eq('route: before 0170 the page still loads, with nothing invented', [r2.status, j2.partial, j2.data[A].visitors_why, j2.data[A].health_why, j2.data[A].search.value], [200, false, 'not_ready', 'not_ready', 7]);
  const viewer = await N.handleSiteNumbers('/agency/site-numbers', 'GET', { ...member, role: 'readonly' }, {}, '2026-11-11T10:00:00Z');
  eq('route: any studio seat that can read sees it', viewer.status, 200);
  eq('route: someone else’s route is left alone', await N.handleSiteNumbers('/agency/sites', 'GET', member, {}), null);
  ok('route: wired into the studio’s routes', /handleSiteNumbers\(route, method, member, cors, now\)/.test(read(`${P}/agency/routes.ts`)));
}

const failed = results.filter((r) => !r.p).length;
console.log(`site_numbers: ${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
