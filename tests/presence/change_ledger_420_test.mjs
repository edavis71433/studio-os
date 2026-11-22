// ── Every database change writes its number down (builder item 420) ─────────────────
// Database changes reach production by hand, from apply packs, and nothing recorded which
// ran. From 0260 on, each migration and each apply pack ends by writing its own number
// into presence_change_ledger; the server knows the newest change it was written with
// (lib/schema_ledger.ts); the health answer and the Health page compare the two; and the
// release refuses to go out while production's ledger doesn't have the code's newest
// (deploy.yml; tests/workflows/deploy_gate_test.mjs runs that step). The rehearsal on every
// pull request runs all of it on a real scratch database (scripts/rehearse-changes.sh).
// Here: the rules every new change must keep, and the Health page's words.
//   deno run --allow-read tests/presence/change_ledger_420_test.mjs
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const FIRST = 260;

const { CODE_NEWEST_CHANGE, changesArea } = await import('../../supabase/functions/presence/lib/schema_ledger.ts');

// ═══ 1. The numbers line up ═══
const migrations = [...Deno.readDirSync(new URL('supabase/migrations/', ROOT))].map((e) => e.name).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
const packs = [...Deno.readDirSync(new URL('docs/presence/', ROOT))].map((e) => e.name).filter((f) => /^APPLY-\d{4}-prod\.sql$/.test(f)).sort();
const num = (f) => Number(f.match(/(\d{4})/)[1]);
const newest = Math.max(...migrations.map(num));
ok('the code\'s newest change is the newest migration (raise CODE_NEWEST_CHANGE with each new one)', CODE_NEWEST_CHANGE === newest, `code ${CODE_NEWEST_CHANGE}, newest migration ${newest}`);

// A statement outside comments: the line, with -- comments dropped.
const statements = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean);
const note = (n) => new RegExp(`^select public\\.presence_ledger_note\\(${n}, '[a-z0-9_]+'\\);$`);
for (const f of migrations.filter((m) => num(m) >= FIRST)) {
  const s = statements(read(`supabase/migrations/${f}`));
  ok(`${f} ends by writing its own number down`, note(num(f)).test(s[s.length - 1] || ''), s[s.length - 1]);
  ok(`${f} has an apply pack`, packs.includes(`APPLY-${f.slice(0, 4)}-prod.sql`));
}
for (const f of packs.filter((p) => num(p) >= FIRST)) {
  const s = statements(read(`docs/presence/${f}`));
  ok(`${f} writes its own number down, outside a comment`, s.some((l) => note(num(f)).test(l)));
  ok(`${f} names its migration`, migrations.some((m) => m.startsWith(`${f.slice(6, 10)}_`)) && read(`docs/presence/${f}`).includes(`Covers: supabase/migrations/${f.slice(6, 10)}_`));
}

// ═══ 2. The ledger, the same in its migration and its pack ═══
const def = (sql, start, end) => { const i = sql.indexOf(start); return i < 0 ? '' : sql.slice(i, sql.indexOf(end, i) + end.length); };
const m260 = read('supabase/migrations/0260_change_ledger.sql'), p260 = read('docs/presence/APPLY-0260-prod.sql');
const table = (s) => def(s, 'create table if not exists public.presence_change_ledger', ');');
const fn = (s) => def(s, 'create or replace function public.presence_ledger_note', '$$;');
ok('the ledger table is the same in 0260 and its pack', !!table(m260) && table(m260) === table(p260));
ok('presence_ledger_note is the same in 0260 and its pack', !!fn(m260) && fn(m260) === fn(p260));
for (const s of [m260, p260]) {
  ok('…only the service role may read, write or call it', s.includes('revoke all on table public.presence_change_ledger from public, anon, authenticated;') && s.includes('grant select, insert, update on table public.presence_change_ledger to service_role;') && s.includes('revoke all on function public.presence_ledger_note(int, text) from public, anon, authenticated;') && s.includes('alter table public.presence_change_ledger enable row level security;'));
}
ok('a second run counts the run and keeps the first time (on conflict)', /on conflict \(number\) do update\s+set last_at = now\(\), runs = l\.runs \+ 1/.test(fn(m260)));

// The backfill: what production had before the ledger, written once as "backfill".
const backfill = p260.slice(p260.indexOf('-- BACKFILL-LIST-START'), p260.indexOf('-- BACKFILL-LIST-END'));
const listed = [...backfill.matchAll(/\((\d+), '([a-z0-9_-]*)', 'backfill'\)/g)].map((m) => Number(m[1]));
ok('the pack backfills what production already had, each number once, all before 0260, never the fenced 0003 to 0005', listed.length >= 100 && new Set(listed).size === listed.length && listed.every((n) => n >= 0 && n < FIRST) && !listed.some((n) => n >= 3 && n <= 5), `${listed.length} numbers`);
ok('…and a re-run adds nothing (on conflict do nothing)', /'backfill'\)[\s\S]*?on conflict \(number\) do nothing;/.test(backfill));

// ═══ 3. 0261: 0247's counts, plus the four new ones, in one trip ═══
const counts = (s) => def(s, 'create or replace function public.presence_health_counts()', '$$;');
const keys = (s) => [...counts(s).matchAll(/^\s+'([a-z0-9_]+)',/gm)].map((m) => m[1]);
const m247 = read('supabase/migrations/0247_health_counts.sql'), m261 = read('supabase/migrations/0261_crash_counts.sql'), p261 = read('docs/presence/APPLY-0261-prod.sql');
ok('presence_health_counts is the same in 0261 and its pack', !!counts(m261) && counts(m261) === counts(p261));
const added = keys(m261).filter((k) => !keys(m247).includes(k));
ok('0261 keeps every count 0247 had, and adds the crashes and the ledger', keys(m247).every((k) => keys(m261).includes(k)) && added.join() === 'crashes_1h,crashes_24h,ledger_newest,ledger_rows', added.join());
ok('…still read-only and for the service role only', /stable\s+as \$\$/.test(counts(m261)) && m261.includes('grant execute on function public.presence_health_counts() to service_role;'));

// ═══ 4. The Health page's words ═══
ok('no ledger yet: asks for 0260 and the packs after it', changesArea(null, 261).state === 'attention' && changesArea(null, 261).detail.includes('APPLY-0260'));
ok('behind: names both numbers and what to run', changesArea(259, 261).state === 'attention' && changesArea(259, 261).detail === 'The newest database change here is 0259; this code needs 0261. Run the apply packs after 0259, in order, then release.');
ok('level: calm', changesArea(261, 261).state === 'ok' && changesArea(261, 261).detail === 'Every database change this code needs is in, up to 0261.');
ok('ahead (a change applied before its release): calm, and says so', changesArea(262, 261).state === 'ok' && changesArea(262, 261).detail.includes('ahead of this code'));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ CHANGE LEDGER (420): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
