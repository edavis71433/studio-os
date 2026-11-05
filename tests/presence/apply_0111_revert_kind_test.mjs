// ── Apply pack 0111 repair: scheduled reverts can save on production ──────────
// Production's presence_scheduled_publishes_kind_check says publish, launch, offline,
// while migration 0111 and the code say publish, revert, offline. So POST /schedule
// with kind 'revert' fails the check. This pins the repair pack: it restores exactly
// the migration's list, it can't change anything else, it pastes cleanly, and nothing
// in the code still depends on the 'launch' kind it removes.
//   deno run --allow-read --allow-env tests/presence/apply_0111_revert_kind_test.mjs
import { isScheduleKind } from '../../supabase/functions/presence/lib/commercial.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const pack = read('docs/presence/APPLY-0111-revert-kind-prod.sql');
const migration = read('supabase/migrations/0111_offline_unpublish.sql');
const statements = pack.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
const kindsIn = (s) => [.../check \(kind in \(([^)]*)\)\)/.exec(s)?.[1].matchAll(/'([^']+)'/g) ?? []].map((m) => m[1]);
const addStatement = statements.find((s) => /add constraint presence_scheduled_publishes_kind_check/.test(s)) ?? '';

// ═══ 1. it restores exactly what the migration and the code say ═══
const packKinds = kindsIn(addStatement);
ok('the pack lists the same kinds as migration 0111', packKinds.length === 3 && JSON.stringify(packKinds) === JSON.stringify(kindsIn(migration)), packKinds.join(','));
ok('the code accepts every kind in the pack', packKinds.every(isScheduleKind));
ok('the code still sends revert', /kind === 'revert'/.test(read('supabase/functions/presence/routes/commercial.ts')));
ok('the code rejects launch as a schedule kind', !isScheduleKind('launch'));

// ═══ 2. nothing depends on the kind it removes ═══
for (const f of ['routes/launches.ts', 'ops/scheduler.ts', 'routes/commercial.ts']) {
  ok(`${f} never writes kind launch`, !/kind:\s*'launch'/.test(read(`supabase/functions/presence/${f}`)));
}
ok('launches schedule as publish', /snapshot_id: l\.snapshot_id, kind: 'publish'/.test(read('supabase/functions/presence/routes/launches.ts')));

// ═══ 3. it can't change anything else ═══
ok('five statements: begin, drop, add, commit, verify', statements.length === 5, String(statements.length));
ok('the drop and the add share one transaction', statements[0] === 'begin' && statements[3] === 'commit');
ok('re-runnable: the drop is "if exists"', /^alter table public\.presence_scheduled_publishes\s+drop constraint if exists presence_scheduled_publishes_kind_check$/.test(statements[1]));
ok('the add touches only this constraint', /^alter table public\.presence_scheduled_publishes\s+add constraint presence_scheduled_publishes_kind_check\s+check \(kind in /.test(statements[2]));
ok('the verify only reads', /^with c as/.test(statements[4]) && !/\b(insert|update|delete|drop|alter|truncate|grant|revoke|create)\b/i.test(statements[4].replace(/'[^']*'/g, "''")));

// ═══ 4. it pastes cleanly: pbcopy without a UTF-8 locale mangles anything else ═══
ok('ASCII only', [...pack].every((c) => c.codePointAt(0) < 128));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ APPLY PACK 0111 REPAIR: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
