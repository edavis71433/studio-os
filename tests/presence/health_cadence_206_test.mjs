// ── Builder list item 206: a site's health is checked once a day and after a publish ──
//   deno run --allow-read --allow-env --allow-net tests/presence/health_cadence_206_test.mjs
// The 15-minute tick used to run the whole health check for every site every time: 96
// checks a site a day, each writing a new set of findings. On production (Nov 11 2026)
// that was 2.4 GB for 8 sites, and the recommendations were never cleared. Here a day of
// ticks is played against a stand-in database: one check a site a day, another after a
// publish, a failed check tried again in an hour, and the sweep clearing 30-day-old
// history in bites. Also finding 82: the batch reads name the site. No Supabase is touched.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const P = '../../supabase/functions/presence';
const read = (p) => Deno.readTextFileSync(new URL(p, import.meta.url));

// ── the stand-in database: just what a tick's health cycle asks for ──
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const CLIENT = '44444444-4444-4444-8444-444444444444';
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
let now = Date.parse('2026-11-12T03:15:00Z');
const realNow = Date.now, realFetch = globalThis.fetch;
Date.now = () => now;
const world = { sites: [], checks: [], failEvidenceFor: new Set(), seen: [], rpc: {} };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input)), method = (init.method || 'GET').toUpperCase();
  if (url.host !== 'stub.local') return new Response('', { status: 599 });   // a site's own pages: unreachable here
  const table = url.pathname.replace('/rest/v1/', ''), q = url.searchParams;
  const body = init.body ? JSON.parse(String(init.body)) : null;
  world.seen.push(`${method} ${table}${url.search}`);
  if (table === 'presence_entitlements') return reply(q.get('select') === 'client_id' ? [{ client_id: CLIENT }] : [{ plan: 'presence' }]);
  if (table === 'presence_sites' && method === 'GET') {
    let rows = world.sites.filter((s) => !q.get('id') || q.get('id') === `eq.${s.id}`);
    const due = /^\(last_observed_at\.is\.null,last_observed_at\.lt\.(.+)\)$/.exec(q.get('or') || '');
    if (due) rows = rows.filter((s) => !s.last_observed_at || Date.parse(s.last_observed_at) < Date.parse(due[1]));
    rows = [...rows].sort((a, b) => (a.last_observed_at ? Date.parse(a.last_observed_at) : -1) - (b.last_observed_at ? Date.parse(b.last_observed_at) : -1));
    return reply(rows.slice(0, Number(q.get('limit') || 1000)));
  }
  if (table === 'presence_sites' && method === 'PATCH') {
    const ids = (q.get('id') || '').replace(/^(eq\.|in\.\(|\))/g, '').replace(/\)$/, '').split(',');
    for (const s of world.sites) if (ids.includes(s.id)) Object.assign(s, body);
    return reply([]);
  }
  if (table === 'presence_evidence_runs' && method === 'POST') {
    world.checks.push({ site: body.site_id, at: now, trigger: body.trigger });
    return world.failEvidenceFor.has(body.site_id) ? reply({ message: 'no' }, 500) : reply([{ id: crypto.randomUUID() }], 201);
  }
  // the later steps of a check read back the newest run and the newest batches
  if (table === 'presence_evidence_runs' && method === 'GET') return reply([{ id: crypto.randomUUID(), started_at: new Date(now).toISOString() }]);
  if ((table === 'presence_judgments' || table === 'presence_recommendations') && method === 'GET' && q.get('limit') === '1') return reply([{ batch_id: crypto.randomUUID() }]);
  if (table.startsWith('rpc/')) {
    const h = world.rpc[table.slice(4)];
    return h ? h(body) : reply({ code: 'PGRST202', message: 'Could not find the function' }, 404);
  }
  if (method === 'POST') return reply([{ id: crypto.randomUUID() }], 201);
  return reply([]);
};
const site = (id, mark = null) => ({ id, client_id: CLIENT, status: 'live', edition: 'presence', template_slug: 'business-classic', template_version: '1.0.0', last_published_at: '2026-11-01T00:00:00Z', last_observed_at: mark });

const S = await import(`${P}/ops/scheduler.ts`);
const K = await import(`${P}/lib/check_soon.ts`);
const checksOf = (id) => world.checks.filter((c) => c.site === id).length;

// ── 1. a day of 15-minute ticks: one check a site ──
{
  world.sites = [site(A), site(B), site(C)];
  for (let t = 0; t < 96; t++) { await S.runOperationsCycle({}); now += 15 * MIN; }
  eq('a day of ticks: each site is checked once, not 96 times', [checksOf(A), checksOf(B), checksOf(C)], [1, 1, 1]);
  const first = world.checks.find((c) => c.site === A).at;
  await S.runOperationsCycle({});   // the same time the next day
  eq('the next day: checked again, at the same tick as the day before', [checksOf(A), world.checks.filter((c) => c.site === A)[1].at - first], [2, DAY]);
  for (let t = 0; t < 96 * 6; t++) { now += 15 * MIN; await S.runOperationsCycle({}); }
  eq('a week of ticks: one check a site a day', [checksOf(A), checksOf(B), checksOf(C)], [8, 8, 8]);
  const days = new Set(world.checks.filter((c) => c.site === A).map((c) => new Date(c.at).toISOString().slice(0, 10)));
  eq('every day has its check, so the trend line has a point for every day', days.size, 8);
}

// ── 2. a publish: checked again at the next tick ──
{
  const before = checksOf(B);
  now += 3 * HOUR;
  await S.runOperationsCycle({});
  eq('three hours after its check, nothing is due', checksOf(B), before);
  await K.checkSoon(B);
  eq('a publish empties the site\'s mark', world.sites.find((s) => s.id === B).last_observed_at, null);
  now += 15 * MIN; await S.runOperationsCycle({});
  eq('the next tick checks the published site, and only that one', [checksOf(B), checksOf(A), checksOf(C)], [before + 1, 8, 8]);
  now += 15 * MIN; await S.runOperationsCycle({});
  eq('and not again on the tick after', checksOf(B), before + 1);
  const pub = read(`${P}/routes/publish.ts`), rec = read(`${P}/lib/deploy_reconcile.ts`);
  ok('a publish that goes live asks for the check', /if \(live\) await checkSoon\(site\.id\);/.test(pub));
  ok('so does one that goes live later, found by the reconcile', /last_published_at: nowIso[\s\S]{0,600}await checkSoon\(p\.site_id\);/.test(rec));
}

// ── 3. a failed check is tried again in an hour, not a day later and not every tick ──
{
  world.sites = [site(A)]; world.checks = []; world.failEvidenceFor = new Set([A]);
  for (let t = 0; t < 8; t++) { await S.runOperationsCycle({}); now += 15 * MIN; }   // two hours
  eq('a failing site: tried once an hour', checksOf(A), 2);
  world.failEvidenceFor = new Set();
  eq('the constants: a little under a day, and an hour', [K.CHECK_EVERY_MS < DAY && K.CHECK_EVERY_MS > DAY - 15 * MIN, K.CHECK_RETRY_MS], [true, HOUR]);
}

// ── 4. the sweep clears 30-day-old history in bites, and keeps working before 0190 ──
{
  const R = await import(`${P}/ops/retention.ts`);
  world.seen = []; world.rpc = { presence_prune_health: (b) => { world.asked = b; return reply({ runs: 500, recommendations: 9000 }); } };
  const out = await R.runRetentionSweep(new Date(now));
  eq('sweep: asks for 30 days, 500 runs at a time', world.asked, { keep_days: 30, max_runs: 500 });
  eq('sweep: reports what it cleared', [out.evidence_runs, out.recommendations], [500, 9000]);
  ok('sweep: the old one-statement prune is not called once 0190 is in', !world.seen.some((s) => s.includes('rpc/prune_evidence_runs')));
  world.seen = []; world.rpc = { prune_evidence_runs: (b) => { world.askedOld = b; return reply(3); } };
  const before0190 = await R.runRetentionSweep(new Date(now));
  eq('before 0190: the old prune runs on its old 180 days, never 30 in one statement', [world.askedOld, before0190.evidence_runs], [{ keep_days: 180 }, 3]);
  world.rpc = { presence_prune_health: () => reply({ message: 'permission denied for function presence_prune_health' }, 403) };
  eq('a refused prune is a failed sweep the watchdog hears about', (await R.runRetentionSweep(new Date(now))).evidence_runs, false);
}

// ── 5. the migration and the pack ──
{
  const migration = read('../../supabase/migrations/0190_health_history_prune.sql'), pack = read('../../docs/presence/APPLY-0190-prod.sql');
  for (const [name, sql] of [['migration', migration], ['pack', pack]]) {
    ok(`${name}: the function, for the function's key only`, /create or replace function public\.presence_prune_health\(keep_days int default 30, max_runs int default 500\)/.test(sql) && /grant execute on function public\.presence_prune_health\(int, int\) to service_role/.test(sql) && /revoke all on function public\.presence_prune_health\(int, int\) from public, anon, authenticated/.test(sql));
    ok(`${name}: each site's newest run and newest good run are never cleared`, /distinct on \(site_id\) id from public\.presence_evidence_runs\s+order by site_id, started_at desc/.test(sql) && /where finished_at is not null and error_text is null\s+order by site_id, started_at desc/.test(sql));
    ok(`${name}: a bounded bite per call`, /limit bite\b/.test(sql) && /limit bite \* 20/.test(sql));
    ok(`${name}: moments and health days are left alone`, !/(delete from|truncate table)[^;]*presence_(moments|health_days)/.test(sql));
  }
  ok('pack: the function body is the migration\'s, word for word', pack.includes(migration.slice(migration.indexOf('create or replace function'))));
  const step3 = pack.slice(pack.indexOf('\nbegin;'));
  ok('pack: the clear-out is one transaction that locks the four tables first', /^\nbegin;\s+lock table public\.presence_evidence_runs, public\.presence_evidence,\s+public\.presence_judgments, public\.presence_recommendations\s+in access exclusive mode;/.test(step3) && /\ncommit;/.test(step3));
  ok('pack: it keeps the last check of each day, each site\'s newest, and what a health day points to', /distinct on \(site_id, \(started_at at time zone 'utc'\)::date\)/.test(step3) && /select run_id from public\.presence_health_days where run_id is not null/.test(step3));
  ok('pack: it stops, changing nothing, when a site would lose its newest check', /raise exception 'clear-out stopped, nothing changed/.test(step3) && step3.indexOf('raise exception') < step3.indexOf('truncate table'));
  ok('pack: no cascade, so no other table can be emptied by it', !/cascade/i.test(step3));
  ok('pack: says the schedule is untouched and how to go back', /No scheduled job is added, changed or removed/.test(pack) && /revert the item 206 pull request/.test(pack) && !/cron\.(schedule|unschedule)\(/.test(pack));
}

// ── 6. finding 82: a batch is read by site and batch, which the indexes start with ──
{
  const rec = read(`${P}/recommendation/engine.ts`), mom = read(`${P}/moments/engine.ts`), adm = read(`${P}/routes/admin.ts`);
  ok('recommendations read their judgment batch by site and batch', /presence_judgments\?site_id=eq\.\$\{site\.id\}&batch_id=eq\.\$\{jb\}/.test(rec));
  ok('moments read their recommendation batch by site and batch', /presence_recommendations\?site_id=eq\.\$\{site\.id\}&batch_id=eq\.\$\{rb\}/.test(mom));
  ok('no read of either table by batch alone is left', ![rec, mom, adm].some((s) => /presence_(judgments|recommendations)\?batch_id=/.test(s)));
}

Date.now = realNow; globalThis.fetch = realFetch;
const failed = results.filter((r) => !r.p).length;
console.log(`health_cadence_206: ${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
