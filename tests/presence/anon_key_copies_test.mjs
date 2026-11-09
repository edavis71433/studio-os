// ── Item 105: the public anon key, pasted into the pages ─────────────────────
// The key can't live in one shared file without changing load order: each page's
// own inline script builds its Supabase client at the top, and that script runs
// before the deferred shell.js (the one shared script). A blocking shared script
// would add a request ahead of every page. So the copies stay, and this test
// makes a rotation safe instead:
//   - every key pasted into a page or root script is an ANON key (never the
//     service key, which would hand the whole database to anyone),
//   - each project has exactly ONE anon key across every file, so a rotation that
//     misses a page fails here and names the page,
//   - shell.js holds production's.
// To rotate: change shell.js, run this test, and change every file it names.
//   deno run --allow-read tests/presence/anon_key_copies_test.mjs
const ROOT = new URL('../../', import.meta.url);
const PROD_REF = 'qksstlqzbhesadrrofgn';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const files = [];
for (const e of Deno.readDirSync(ROOT)) if (e.isFile && /\.(html|js)$/.test(e.name)) files.push(e.name);
files.sort();

const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const payload = (t) => {
  const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  try { return JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4))); } catch { return null; }
};

const byRef = new Map();   // ref -> Map(token -> [files])
const notAnon = [];
for (const f of files) {
  const text = Deno.readTextFileSync(new URL(f, ROOT));
  for (const t of new Set(text.match(JWT) || [])) {
    const p = payload(t);
    if (!p || p.iss !== 'supabase') continue;   // not a Supabase key
    if (p.role !== 'anon') notAnon.push(`${f} (${p.role})`);
    if (!byRef.has(p.ref)) byRef.set(p.ref, new Map());
    const m = byRef.get(p.ref);
    m.set(t, [...(m.get(t) || []), f]);
  }
}

ok('every Supabase key in a page or root script is an anon key', notAnon.length === 0, notAnon.join(', '));
ok('production\'s key is in the pages', byRef.has(PROD_REF));
for (const [ref, tokens] of byRef) {
  const spread = [...tokens.values()].map((fs) => fs.length);
  const minority = [...tokens.entries()].sort((a, b) => b[1].length - a[1].length).slice(1).flatMap(([, fs]) => fs);
  ok(`project ${ref}: one key everywhere (${spread.reduce((a, b) => a + b, 0)} files)`, tokens.size === 1,
    tokens.size > 1 ? `files on a different key: ${minority.join(', ')}` : '');
}
const shell = Deno.readTextFileSync(new URL('shell.js', ROOT));
const shellKeys = (shell.match(JWT) || []).map(payload).filter(Boolean);
ok('shell.js holds production\'s anon key', shellKeys.some((p) => p.ref === PROD_REF && p.role === 'anon'));

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
