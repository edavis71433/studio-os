// ── Four fifths of the database was history nobody reads (builder item 408) ──────
// Nov 22 review, file 14, finding 10: presence_moments (93 MB, 137,090 rows for 9 sites)
// was never trimmed and audit_log (51 MB) is written only by the old server; together
// with the job's own ledger they held 177 of 225 MB. The retention sweep now calls
// presence_prune_history (migration 0246) every tick: each site keeps its newest 500
// moments and every dismissed one, audit_log keeps 90 days, in bites of 2,000 rows a
// table. This pins:
//   · the sweep's call and what it records, before and after 0246, and on a refusal;
//   · every reader of moments takes fewer rows than the sweep keeps;
//   · the migration and the apply pack say the same thing, keep dismissed rows, work
//     in bites, and drop the one unused index.
//   deno run --allow-read --allow-env --allow-net tests/presence/history_trim_408_test.mjs
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}`);
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
Deno.env.set('SUPABASE_URL', 'https://db.test'); Deno.env.set('SERVICE_ROLE_KEY', 'svc'); Deno.env.set('SUPABASE_ANON_KEY', 'anon');

// a pretend database: every prune answers ok; the history function answers as the test says
const world = { seen: [], history: null };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = (init.method || 'GET').toUpperCase();
  const table = url.pathname.replace('/rest/v1/', '');
  world.seen.push({ method, table, body: init.body ? JSON.parse(String(init.body)) : null });
  if (table === 'rpc/presence_prune_history') return world.history ? world.history() : reply({ message: 'Could not find the function' }, 404);
  if (table === 'rpc/presence_prune_health') return reply({ runs: 0, recommendations: 0 });
  return reply([]);
};
const R = await import('../../supabase/functions/presence/ops/retention.ts');

// ═══ 1. the sweep ═══
{
  world.seen = []; world.history = () => reply({ moments: 2000, audit: 731 });
  const out = await R.runRetentionSweep(new Date('2026-11-22T12:00:00Z'));
  const call = world.seen.find((s) => s.table === 'rpc/presence_prune_history');
  eq('the sweep asks for 500 moments a site, 90 days of audit log, 2,000 rows a bite', call?.body, { keep_moments: 500, keep_audit_days: 90, max_rows: 2000 });
  eq('…and records what went', [out.moments, out.audit_log], [2000, 731]);
  ok('…every other prune still runs', ['visits', 'search_terms', 'scheduled_runs', 'ops_errors', 'rate_limit_state', 'plan_notices', 'audit_leads', 'health_days'].every((k) => out[k] === true), JSON.stringify(out));
  world.seen = []; world.history = null;
  const before = await R.runRetentionSweep(new Date('2026-11-22T12:00:00Z'));
  ok('before 0246: a skip, not a failure (the watchdog stays quiet)', before.skipped_history === true && before.history === undefined && before.moments === undefined);
  world.history = () => reply({ message: 'permission denied for function presence_prune_history' }, 403);
  ok('a refused prune is a failed sweep the watchdog hears about', (await R.runRetentionSweep(new Date('2026-11-22T12:00:00Z'))).history === false);
  const { sweepIssues } = await import('../../supabase/functions/presence/routes/system.ts');
  ok('…and sweepIssues names it', sweepIssues({ retention: { history: false } }).length === 1 && sweepIssues({ retention: { skipped_history: true, moments: 0, audit_log: 0 } }).length === 0);
}

// ═══ 2. every reader of moments takes fewer rows than the sweep keeps ═══
{
  // (agency/routes.ts reads active moments across every client of a studio, at most three a site, all of them newest: not a per-site history read)
  const readers = ['moments/engine.ts', 'routes/timeline.ts', 'routes/moments.ts', 'crm/store.ts', 'concierge/grounding.ts', 'coach/engine.ts', 'routes/admin.ts', 'routes/workspace.ts'];
  const limits = [];
  for (const f of readers) {
    const src = read(`supabase/functions/presence/${f}`);
    for (const m of src.matchAll(/presence_moments\?[^`'"]*limit=(\d+)/g)) limits.push([f, Number(m[1])]);
  }
  ok('every read of presence_moments is bounded, and under what is kept per site', limits.length >= 8 && limits.every(([, n]) => n <= R.MOMENTS_KEEP), JSON.stringify(limits));
  ok('the coach reads dismissals back, which the trim never deletes', /presence_moments\?[^`]*status=in\.\(active,dismissed\)/.test(read('supabase/functions/presence/coach/engine.ts')));
}

// ═══ 3. the migration and the pack ═══
{
  const migration = read('supabase/migrations/0246_history_trim.sql'), pack = read('docs/presence/APPLY-0246-prod.sql');
  const fn = (s) => (s.match(/create or replace function public\.presence_prune_history[\s\S]*?\$\$;/) || [''])[0];
  ok('the pack carries the migration\'s function, word for word', fn(migration).length > 500 && fn(migration) === fn(pack));
  ok('the function keeps dismissed moments', /status <> 'dismissed'/.test(fn(migration)));
  ok('the function keeps each site\'s newest, counted per site, newest first', /partition by site_id order by created_at desc/.test(fn(migration)) && /where n > keep/.test(fn(migration)));
  ok('the function works in bites', /limit bite/.test(fn(migration)) && /least\(coalesce\(max_rows, 2000\), 20000\)/.test(fn(migration)));
  ok('the function trims audit_log by age only', /from public\.audit_log where created_at < cutoff/.test(fn(migration)));
  ok('only the service role may call it', /revoke all on function public\.presence_prune_history\(int, int, int\) from public, anon, authenticated;/.test(migration) && /grant execute on function public\.presence_prune_history\(int, int, int\) to service_role;/.test(migration));
  ok('the unused request_id index goes; the two the queries use stay', /drop index if exists public\.audit_log_request_id_idx;/.test(migration) && !/audit_log_created_at_idx|audit_log_tenant_idx/.test(migration.replace(/--[^\n]*/g, '')));
  ok('the pack says how to see the sizes before and after, and the one-time vacuum', /pg_total_relation_size\('public\.presence_moments'\)/.test(pack) && /vacuum \(full, analyze\) public\.presence_moments;/.test(pack));
  const clever = read('supabase/functions/clever-api/index.ts');
  ok('nothing reads audit_log by request id (the old server only writes it, through audit_write)', !/audit_log\?[^`'"]*request_id/.test(clever) && /rpc\/audit_write/.test(clever));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { for (const r of results) if (!r.p) console.log('  FAIL ' + r.n); Deno.exit(1); }
