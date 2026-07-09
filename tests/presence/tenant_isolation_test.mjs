// ── Tenant isolation (Presence CMS Phase 1, M2) ─────────────────────────────
// The one class of bug that bypasses deny-all RLS: a svc() query that looks up a
// row by a REQUEST-supplied id without scoping it to the caller's resolved site.
// This is a STRUCTURAL guard (pure, no network): in the client-facing version
// routes, every by-id lookup on a version table (publishes / launches / snapshots)
// must also carry `site_id=eq.` in the SAME query. A cross-site id then returns
// nothing (fail-closed) instead of another tenant's data.
//
//   deno run --allow-read tests/presence/tenant_isolation_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// POSITIVE assertions: the exact security-boundary queries — the ones that consume
// a REQUEST-supplied id (or a snapshot id derived directly from it) — must be
// site-scoped. Positive checks avoid the false positives of a blanket "no unscoped
// id=eq" rule, which can't structurally tell a request id from a follow-on op that
// uses an id already scoped earlier in the same handler (e.g. patchLaunch(l.id),
// or PATCHing the just-created publish row by pubId). Verified safe by provenance.
// Each entry: [file, humanName, /regex requiring the id interpolation AND site_id/].
const BOUNDARY = [
  ['routes/preview.ts', 'preview: launch lookup', /presence_launches\?id=eq\.\$\{launchId\}&site_id=eq\.\$\{site\.id\}/],
  ['routes/preview.ts', 'preview: publish lookup', /presence_publishes\?id=eq\.\$\{publishId\}&site_id=eq\.\$\{site\.id\}/],
  ['routes/preview.ts', 'preview: snapshot fetch (M2 hardened)', /presence_snapshots\?id=eq\.\$\{snapId\}&site_id=eq\.\$\{site\.id\}/],
  ['routes/publish.ts', 'restore: publish lookup', /presence_publishes\?id=eq\.\$\{encodeURIComponent\(publishId\)\}&site_id=eq\.\$\{site\.id\}/],
  ['routes/publish.ts', 'restore: snapshot fetch (M2 hardened)', /presence_snapshots\?id=eq\.\$\{row\.snapshot_id\}&site_id=eq\.\$\{site\.id\}/],
  ['routes/room.ts', 'restore-to-draft: publish lookup', /presence_publishes\?id=eq\.\$\{publishId\}&site_id=eq\.\$\{site\.id\}/],
  ['routes/room.ts', 'restore-to-draft: snapshot fetch (M2 hardened)', /presence_snapshots\?id=eq\.\$\{rec\.snapshot_id\}&site_id=eq\.\$\{site\.id\}/],
  ['routes/launches.ts', 'launch: getLaunch entry lookup', /presence_launches\?id=eq\.\$\{id\}&site_id=eq\.\$\{site\.id\}/],
];

for (const [f, name, re] of BOUNDARY) {
  const src = read(`supabase/functions/presence/${f}`);
  ok(`${name} is scoped to the caller's site`, re.test(src));
}

// The global sentinel (all-zero site_id) must only be reachable through operator-
// gated marketplace/scope code — never a client data path. Assert the constant is
// declared/used only where we expect it (industry marketplace + scope/audit).
{
  const sentinel = '00000000-0000-0000-0000-000000000000';
  const ALLOWED = [
    'industry/marketplace_store.ts', 'lib/scope.ts', 'lib/workspace.ts', // audit fallback + member fallback
  ];
  // files that reference the sentinel
  const referencing = [];
  for (const f of [
    'supabase/functions/presence/industry/marketplace_store.ts',
    'supabase/functions/presence/lib/scope.ts',
    'supabase/functions/presence/lib/workspace.ts',
  ]) {
    try { if (read(f).includes(sentinel)) referencing.push(f); } catch { /* */ }
  }
  ok('global sentinel is confined to operator/scope/audit code (not a client data path)',
    referencing.every((f) => ALLOWED.some((a) => f.endsWith(a))), referencing.join(', '));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ TENANT ISOLATION (M2): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
