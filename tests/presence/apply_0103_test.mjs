// ── Apply pack 0103: updates load on production again ────────────────────────
// The PR #90 production re-test found GET /posts answering 502: presence_posts.tags
// doesn't exist there, because migration 0103 was never applied and had no pack.
// This pins the pack: it adds exactly what the migration adds, it can't change
// anything else, it pastes cleanly, and its report covers every other migration
// that has no pack, so the next missed one shows up instead of a 502.
//   deno run --allow-read --allow-env tests/presence/apply_0103_test.mjs
import { normalizeTags } from '../../supabase/functions/presence/lib/search_index.ts';
import { SPECS } from '../../supabase/functions/presence/routes/content.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const pack = read('docs/presence/APPLY-0103-prod.sql');
const migration = read('supabase/migrations/0103_post_tags.sql');
const DDL = "add column if not exists tags text[] not null default '{}'";
const statements = pack.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);

// ═══ 1. why it exists, and what it adds ═══
ok('the route really depends on the column', SPECS.posts.select.split(',').includes('tags'));
ok('the pack adds the same column the migration does', pack.includes(DDL) && migration.includes(DDL));
const commentOf = (s) => /comment on column public\.presence_posts\.tags is\s+'([^']+)'/.exec(s)?.[1];
ok('…with the same column comment', !!commentOf(pack) && commentOf(pack) === commentOf(migration));

// ═══ 2. it can't change anything else ═══
ok('three statements: add the column, comment on it, report', statements.length === 3, String(statements.length));
ok('the first alters presence_posts and nothing else', /^alter table public\.presence_posts\s+add column if not exists tags /.test(statements[0]));
ok('the second only comments', /^comment on column public\.presence_posts\.tags is/.test(statements[1]));
ok('the third only reads', /^with\b/.test(statements[2]) && /\bselect \* from \(values\b/.test(statements[2]));
ok('no statement writes data or drops anything', !/\b(insert|update|delete|drop|truncate|grant|revoke|create)\b/i.test(statements.join('\n').replace(/'[^']*'/g, "''")));
ok('re-runnable: the column is added "if not exists"', statements[0].includes('if not exists'));

// ═══ 3. it pastes cleanly: pbcopy without a UTF-8 locale mangles anything else ═══
ok('ASCII only', [...pack].every((c) => c.codePointAt(0) < 128));

// ═══ 4. no draft hash moves when it runs ═══
ok('a missing column and the new empty default serialize the same', JSON.stringify(normalizeTags(undefined)) === '[]' && JSON.stringify(normalizeTags([])) === '[]');

// ═══ 5. the report covers every other migration with no pack ═══
{
  const covered = new Set();
  for (const f of Deno.readDirSync(new URL('docs/presence/', ROOT))) {
    const m = /^APPLY-(\d{4})(?:-(\d{4}))?-prod\.sql$/.exec(f.name);
    if (m) for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++) covered.add(n);
  }
  const unpacked = [];
  for (const f of Deno.readDirSync(new URL('supabase/migrations/', ROOT))) {
    const m = /^(\d{4})_/.exec(f.name);
    if (m && Number(m[1]) >= 102 && Number(m[1]) <= 128 && !covered.has(Number(m[1]))) unpacked.push(m[1]);
  }
  const reported = new Set([...pack.matchAll(/^\s*\('(\d{4})',/gm)].map((m) => m[1]));
  // 0120 only backfills data, so the schema can't show whether it ran
  const missing = unpacked.filter((n) => n !== '0120' && !reported.has(n));
  ok('every migration from 0102 to 0128 with no pack is in the report', unpacked.length > 0 && missing.length === 0, missing.join(','));
  ok('the report says why 0120 is left out', /0120 is not listed: it only\s+-- backfills data/.test(pack));
  ok('the report leads with this pack\'s own row', reported.has('0103') && /'0103', 'presence_posts\.tags \(THIS PACK\)'/.test(pack));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ APPLY PACK 0103: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
