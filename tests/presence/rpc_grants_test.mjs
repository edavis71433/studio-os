// ── Every database function the server calls, the server may run ─────────────
// 0091 revoked prune_evidence_runs from public, anon and authenticated and never
// granted it to service_role. Production's default privileges give new
// functions to postgres only (0000_baseline), so the service role had nothing
// left: from Jul to Nov 2026 every 15-minute tick got "permission denied for
// function prune_evidence_runs", ended failed, and kept /system/health at
// ok:false. Every other service-role function pairs its revoke with a grant.
// This replays the grants and revokes of every migration, in order, for each
// rpc the edge functions call, so the next one fails here, not on production.
// It also pins the 0141 apply pack.
//   deno run --allow-read tests/presence/rpc_grants_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. what the edge functions call ═══
const walk = (dir) => [...Deno.readDirSync(new URL(dir, ROOT))].flatMap((e) =>
  e.isDirectory ? walk(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []);
const called = new Map();   // function name -> first file that calls it
for (const f of walk('supabase/functions')) {
  const src = read(f);
  for (const m of src.matchAll(/rpc\/([a-z_][a-z0-9_]*)/g)) if (!called.has(m[1])) called.set(m[1], f);
  for (const m of src.matchAll(/\brpc(?:<[^>]*>)?\(\s*'([a-z_][a-z0-9_]*)'/g)) if (!called.has(m[1])) called.set(m[1], f);   // _shared/tools/db.ts rpc()
}
ok('found the server\'s rpc calls', called.size >= 6, [...called.keys()].join(', '));
ok('prune_evidence_runs is among them', called.has('prune_evidence_runs'));

// ═══ 2. replay the migrations ═══
const migrations = [...Deno.readDirSync(new URL('supabase/migrations/', ROOT))]
  .map((e) => e.name).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();
const statementsOf = (sql) => sql
  .replace(/--[^\n]*/g, '')                          // comments: rollback notes repeat grants
  .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, "''")   // function bodies
  .split(';')
  .map((s) => s.replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase())
  .filter(Boolean);
const roles = (list) => list.split(',').map((r) => r.trim());
function replay(files) {
  const fns = new Map();   // name -> { revokedPublic, granted, grantFile }
  const at = (n) => fns.get(n) ?? fns.set(n, { revokedPublic: false, granted: false, grantFile: '' }).get(n);
  for (const f of files) {
    for (const st of statementsOf(read(`supabase/migrations/${f}`))) {
      let m;
      if ((m = /^create (?:or replace )?function (?:public\.)?([a-z_][a-z0-9_]*)\s*\(/.exec(st))) at(m[1]);
      else if ((m = /^drop function (?:if exists )?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/.exec(st))) fns.delete(m[1]);
      else if ((m = /^revoke (?:all|execute)(?: privileges)? on function (?:public\.)?([a-z_][a-z0-9_]*)\s*\(.*\)\s*from (.+)$/.exec(st))) {
        const fn = at(m[1]);
        if (roles(m[2]).includes('public')) fn.revokedPublic = true;
        if (roles(m[2]).includes('service_role')) fn.granted = false;
      } else if ((m = /^grant (?:all|execute)(?: privileges)? on function (?:public\.)?([a-z_][a-z0-9_]*)\s*\(.*\)\s*to (.+)$/.exec(st))) {
        if (roles(m[2]).includes('service_role')) Object.assign(at(m[1]), { granted: true, grantFile: f });
      }
    }
  }
  return fns;
}

const now = replay(migrations);
for (const [name, where] of called) {
  const fn = now.get(name);
  ok(`${name} (called from ${where.replace('supabase/functions/', '')}) is created by a migration`, !!fn);
  ok(`${name}: the service role may execute it`, !!fn && (!fn.revokedPublic || fn.granted),
    fn ? `revoked from public: ${fn.revokedPublic}, granted to service_role: ${fn.granted}` : 'missing');
}

// the replay sees the bug that hit production
const before = replay(migrations.filter((f) => !f.startsWith('0141_')));
ok('without 0141 the replay finds the July bug (revoked, never granted)', before.get('prune_evidence_runs')?.revokedPublic === true && before.get('prune_evidence_runs')?.granted === false);
ok('0141 is what grants it', now.get('prune_evidence_runs')?.grantFile === '0141_prune_evidence_runs_grant.sql');

// ═══ 3. the migration and its apply pack ═══
const migration = read('supabase/migrations/0141_prune_evidence_runs_grant.sql');
const pack = read('docs/presence/APPLY-0141-prod.sql');
const packStatements = pack.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
const GRANT = 'grant execute on function public.prune_evidence_runs(int) to service_role';
ok('the migration starts with a rollback note', migration.startsWith('-- rollback:'));
ok('the migration\'s only statement is the grant', JSON.stringify(statementsOf(migration)) === JSON.stringify([GRANT]));
ok('the pack is two statements: the same grant, then a check', packStatements.length === 2 && packStatements[0] === GRANT, String(packStatements.length));
ok('the check only reads', /^select has_function_privilege\('service_role'/.test(packStatements[1] || '') && !/\b(insert|update|delete|drop|alter|truncate|grant|revoke|create)\b/i.test((packStatements[1] || '').replace(/'[^']*'/g, "''")));
ok('the check also proves anon and signed-in callers still can\'t', /'anon'/.test(packStatements[1] || '') && /'authenticated'/.test(packStatements[1] || ''));
ok('the pack names its migration', pack.includes('supabase/migrations/0141_prune_evidence_runs_grant.sql'));
ok('ASCII only (pbcopy without a UTF-8 locale mangles anything else)', [...pack, ...migration].every((c) => c.codePointAt(0) < 128));

const passed = results.filter(Boolean).length;
console.log(`\n════ RPC GRANTS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
