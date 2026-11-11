// ── List item 170: database housekeeping from Supabase's adviser (0164) ─────
// 55 links (foreign keys) get an index, 3 duplicate indexes go, and the row rules of
// 30 tables ask who you are once per query, one rule per table and action. Who may do
// what is unchanged: that was checked in PGlite against production's 89 rules (every
// read, insert, update, move and delete for 14 kinds of caller, 55,286 answers, all the
// same). This pins the shape, so a later edit can't quietly undo it.
//   deno run --allow-read tests/presence/adviser_housekeeping_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const mig = read('supabase/migrations/0164_adviser_housekeeping.sql');
const pack = read('docs/presence/APPLY-0164-prod.sql');
const revert = read('docs/presence/APPLY-0164-revert-prod.sql');
// statements, without comment lines (a statement never shares a line with a comment here)
const statements = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  .split(/;\s*\n/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
const M = statements(mig), PK = statements(pack), RV = statements(revert);

// ═══ 1. the pack is the migration, in one transaction ═══
ok('the pack runs the migration\'s statements, in order', JSON.stringify(PK.slice(1, -1)) === JSON.stringify(M), `${M.length} statements`);
ok('the pack is all or nothing', PK[0] === 'begin' && PK[PK.length - 1] === 'commit' && RV[0] === 'begin' && RV[RV.length - 1] === 'commit');
ok('the migration names its undo', /^-- rollback: docs\/presence\/APPLY-0164-revert-prod\.sql/m.test(mig));
ok('0164 is the only migration with that number', [...Deno.readDirSync(new URL('supabase/migrations/', ROOT))].filter((e) => e.name.startsWith('0164_')).length === 1);

// ═══ 2. indexes ═══
const created = M.map((s) => /^create index if not exists (\w+) on public\.(\w+) \((\w+)\)$/.exec(s)).filter(Boolean);
ok('55 links get an index, each named for its table and column', created.length === 55 && created.every(([, n, t, c]) => n === `${t}_${c}_idx`) && new Set(created.map((m) => m[1])).size === 55);
ok('the big one is among them: an evidence run\'s judgments', created.some(([, , t, c]) => t === 'presence_judgments' && c === 'evidence_run_id'));
ok('no index is built in a way that can\'t run in one transaction', !/concurrently/i.test(mig));
const dropped = M.filter((s) => s.startsWith('drop index')).map((s) => s.replace('drop index if exists public.', ''));
ok('the three duplicates go, one copy of each stays', JSON.stringify(dropped) === JSON.stringify(['audit_leads_created_idx', 'idx_tasks_partnership', 'idx_memberships_user']));
{
  const base = read('supabase/migrations/0000_baseline.sql');
  ok('the copies that stay are made by the baseline', /CREATE INDEX "audit_leads_created_at_idx"/.test(base) && /CREATE INDEX "idx_growth_tasks_partnership"/.test(base) && /CREATE INDEX "memberships_user_id_idx"/.test(base));
}

// ═══ 3. row rules ═══
const rules = M.filter((s) => /^(drop|create|alter) policy/.test(s));
const creates = rules.filter((s) => s.startsWith('create policy'));
const alters = rules.filter((s) => s.startsWith('alter policy'));
const body = (s) => s.replace(/^(create|alter) policy "[^"]+" on public\.\w+( for \w+ to [\w, ]+)?/, '');
ok('82 rules made, 6 single rules only rewritten', creates.length === 82 && alters.length === 6);
ok('who is asking is asked once per query: no bare auth.uid(), auth.jwt() or auth.email() is left', [...creates, ...alters].every((s) => !/(?<!select )auth\.(uid|jwt|email)\(\)/.test(body(s))),
  [...creates, ...alters].filter((s) => /(?<!select )auth\.(uid|jwt|email)\(\)/.test(body(s))).map((s) => s.slice(0, 60)).join(' | '));
ok('nor a bare dds_my_contact_id(), nor a per-row dds_is_staff()', [...creates, ...alters].every((s) => !/(?<!select )dds_my_contact_id\(\)/.test(body(s)) && !/dds_is_staff\(/.test(s)));
{
  const key = (s) => { const m = /^create policy "[^"]+" on public\.(\w+) for (\w+) to ([\w, ]+?) (using|with check)/.exec(s); return m ? `${m[1]} ${m[2]} ${m[3]}` : s; };
  const seen = new Map(); for (const s of creates) seen.set(key(s), (seen.get(key(s)) || 0) + 1);
  ok('one rule per table, action and audience', [...seen.values()].every((n) => n === 1), [...seen].filter(([, n]) => n > 1).map(([k]) => k).join(', '));
  const all = creates.filter((s) => / for all to /.test(s)).map((s) => /on public\.(\w+)/.exec(s)[1]);
  const per = creates.filter((s) => / for (select|insert|update|delete) to authenticated/.test(s)).map((s) => /on public\.(\w+)/.exec(s)[1]);
  ok('a table with a rule for every action has no other signed-in rule beside it', all.every((t) => !per.includes(t)));
}
ok('rules aimed at everyone are only the two "anyone may add" ones', creates.filter((s) => / to (public|anon)\b/.test(s)).map((s) => /^create policy "([^"]+)"/.exec(s)[1]).sort().join() === 'audit_leads_insert_anyone,discovery_intake_insert_anyone'
  && creates.filter((s) => /_insert_anyone"/.test(s)).every((s) => / for insert to (public|anon) with check \(true\)$/.test(s)));
ok('every rule it makes is dropped first, so the step can run twice', creates.every((s) => { const [, n, t] = /^create policy "([^"]+)" on public\.(\w+)/.exec(s); return rules.indexOf(`drop policy if exists "${n}" on public.${t}`) > -1 && rules.indexOf(`drop policy if exists "${n}" on public.${t}`) < rules.indexOf(s); }));
ok('no rule mentions a member (member_content_test\'s rule holds)', !/site_members/.test(mig));

// ═══ 4. the undo ═══
{
  const oldNames = new Set([...rules.filter((s) => s.startsWith('drop policy')).map((s) => /"([^"]+)" on public\.(\w+)/.exec(s)).map(([, n, t]) => `${t}.${n}`), ...alters.map((s) => /"([^"]+)" on public\.(\w+)/.exec(s)).map(([, n, t]) => `${t}.${n}`)]);
  const newNames = creates.map((s) => /"([^"]+)" on public\.(\w+)/.exec(s)).map(([, n, t]) => `${t}.${n}`);
  const back = RV.filter((s) => s.startsWith('create policy')).map((s) => /"([^"]+)" on public\.(\w+)/.exec(s)).map(([, n, t]) => `${t}.${n}`);
  ok('the undo puts back 89 rules', back.length === 89 && new Set(back).size === 89);
  ok('…every rule 0164 drops or rewrites, and none of its own', [...oldNames].filter((n) => !newNames.includes(n)).every((n) => back.includes(n)) && newNames.filter((n) => !oldNames.has(n)).every((n) => !back.includes(n)));
  ok('…after dropping every rule 0164 makes', newNames.every((n) => { const [t, p] = n.split(/\.(.+)/); return RV.includes(`drop policy if exists "${p}" on public.${t}`); }));
  ok('…and puts the three duplicates back and the 55 new indexes away', RV.filter((s) => s.startsWith('create index')).length === 3 && RV.filter((s) => s.startsWith('drop index')).length === 55);
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
