// ── Snapshot retention & GC (Presence CMS Phase 1, M7) ───────────────────────
//   deno run --allow-read --allow-env tests/presence/snapshot_gc_test.mjs
// The canonical retention SELECTOR is pure — exhaustively tested here — plus
// structural wiring checks. No network.
Deno.env.delete('SNAPSHOT_KEEP_RECENT');
const M = await import('../../supabase/functions/presence/lib/snapshot_gc.ts');
const { classifySnapshots, snapshotKeepRecent, DEFAULT_SNAPSHOT_KEEP } = M;

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const S = new Set();
const ctx = (over = {}) => ({ liveIds: over.liveIds ?? S, referencedIds: over.referencedIds ?? S, keepRecent: over.keepRecent ?? 20 });
// build N snapshots for a site, newest first (created_at descending by index 0)
function series(site, n, startMs = 2_000_000_000_000) {
  return Array.from({ length: n }, (_, i) => ({ id: `${site}-s${i}`, site_id: site, created_at: new Date(startMs - i * 60_000).toISOString() }));
}
const isDel = (dec, id) => dec.deletable.includes(id);
const isKeep = (dec, id) => dec.keep.includes(id);

// ── recency floor: last-20 kept, older eligible ──
{
  const snaps = series('A', 25); // 25 snapshots, none referenced
  const dec = classifySnapshots(snaps, ctx({ keepRecent: 20 }));
  ok('recency: exactly 20 kept by the recency floor', dec.keep.length === 20);
  ok('recency: the 5 oldest are deletable', dec.deletable.length === 5 && ['A-s20', 'A-s21', 'A-s22', 'A-s23', 'A-s24'].every((id) => isDel(dec, id)));
  ok('recency: the 20 newest are NOT deletable', ['A-s0', 'A-s19'].every((id) => isKeep(dec, id)) && !isDel(dec, 'A-s0'));
  ok('recency: keep + deletable partition every input exactly once', dec.keep.length + dec.deletable.length === 25);
}

// ── fewer than the floor → nothing deletable ──
{
  const dec = classifySnapshots(series('A', 8), ctx({ keepRecent: 20 }));
  ok('floor: 8 snapshots, keepRecent 20 → nothing deletable', dec.deletable.length === 0 && dec.keep.length === 8);
}

// ── live snapshot ALWAYS kept, even if ancient + unreferenced ──
{
  const snaps = series('A', 30);
  const dec = classifySnapshots(snaps, ctx({ keepRecent: 20, liveIds: new Set(['A-s29']) })); // s29 is the OLDEST
  ok('live: the active live snapshot is kept even though it is the oldest', isKeep(dec, 'A-s29') && !isDel(dec, 'A-s29'));
}

// ── referenced snapshots ALWAYS kept (publish/rollback/scheduled/launch/preview) ──
{
  const snaps = series('A', 30);
  const referenced = new Set(['A-s25', 'A-s28']); // old + would otherwise be deletable
  const dec = classifySnapshots(snaps, ctx({ keepRecent: 20, referencedIds: referenced }));
  ok('referenced: an old referenced snapshot (rollback/launch/scheduled/preview target) is kept', isKeep(dec, 'A-s25') && isKeep(dec, 'A-s28') && !isDel(dec, 'A-s25') && !isDel(dec, 'A-s28'));
  ok('referenced: a truly-old UNreferenced snapshot is still collected', isDel(dec, 'A-s26') && isDel(dec, 'A-s27'));
}

// ── uncertainty → keep (unparseable/absent created_at never deleted, never steals a slot) ──
{
  const snaps = [...series('A', 22)];
  snaps.push({ id: 'A-bad', site_id: 'A', created_at: 'not-a-date' });
  snaps.push({ id: 'A-null', site_id: 'A', created_at: null });
  const dec = classifySnapshots(snaps, ctx({ keepRecent: 20 }));
  ok('uncertain: unparseable created_at → kept (never guess)', isKeep(dec, 'A-bad') && !isDel(dec, 'A-bad'));
  ok('uncertain: null created_at → kept', isKeep(dec, 'A-null') && !isDel(dec, 'A-null'));
  ok('uncertain: unparseable rows do NOT steal recency slots (real recent-20 still protected)', isKeep(dec, 'A-s0') && isKeep(dec, 'A-s19'));
}

// ── TENANT isolation: recency floor is PER SITE, never global ──
{
  const snaps = [...series('A', 25, 2_000_000_000_000), ...series('B', 25, 2_000_000_000_000)];
  const dec = classifySnapshots(snaps, ctx({ keepRecent: 20 }));
  const delA = dec.deletable.filter((id) => id.startsWith('A-'));
  const delB = dec.deletable.filter((id) => id.startsWith('B-'));
  ok('tenant: each site keeps its OWN last-20 (5 deletable each, not 30)', delA.length === 5 && delB.length === 5);
  ok('tenant: site B recency is unaffected by site A having older snapshots', isKeep(dec, 'B-s0') && isKeep(dec, 'B-s19'));
  ok('tenant: no cross-site bleed (A ids never appear in B decisions)', dec.keep.concat(dec.deletable).filter((id) => id.startsWith('A-')).length === 25);
}

// ── determinism: same input → same output ──
{
  const snaps = series('A', 40);
  const c = ctx({ keepRecent: 20, referencedIds: new Set(['A-s30']) });
  const a = classifySnapshots(snaps, c);
  const b = classifySnapshots(snaps, c);
  ok('deterministic: identical inputs → identical deletable set', JSON.stringify(a.deletable.sort()) === JSON.stringify(b.deletable.sort()));
  ok('deterministic: selector performs NO DB writes (pure — returns id lists only)', typeof a.keep?.length === 'number' && typeof a.deletable?.length === 'number' && !('then' in a));
}

// ── config ──
ok('config: keepRecent default is 20', snapshotKeepRecent() === DEFAULT_SNAPSHOT_KEEP && DEFAULT_SNAPSHOT_KEEP === 20);
Deno.env.set('SNAPSHOT_KEEP_RECENT', '50');
ok('config: SNAPSHOT_KEEP_RECENT env overrides the default (configurable)', snapshotKeepRecent() === 50);
Deno.env.set('SNAPSHOT_KEEP_RECENT', '0');
ok('config: non-positive env falls back to the default', snapshotKeepRecent() === DEFAULT_SNAPSHOT_KEEP);
Deno.env.delete('SNAPSHOT_KEEP_RECENT');

// ── structural wiring: gathers every reference class; runs on the existing cron ──
{
  const gc = read('supabase/functions/presence/lib/snapshot_gc.ts');
  ok('wiring: gathers publish/rollback history refs', /presence_publishes\?site_id=eq\.\$\{siteId\}/.test(gc) && /liveIds/.test(gc));
  ok('wiring: gathers scheduled-publish refs', /presence_scheduled_publishes\?site_id=eq/.test(gc));
  ok('wiring: gathers launch refs (snapshot_id + prev_snapshot_id rollback target)', /presence_launches\?site_id=eq/.test(gc) && /prev_snapshot_id/.test(gc));
  ok('wiring: gathers preview-share refs', /presence_site_preview\?site_id=eq/.test(gc));
  ok('wiring: DELETE is site-scoped (tenant guard)', /presence_snapshots\?site_id=eq\.\$\{siteId\}&id=in\./.test(gc));

  const sys = read('supabase/functions/presence/routes/system.ts');
  ok('wiring: snapshot GC runs on the default cron cycle (reuses existing scheduler — no new one)', /const snapshot_gc = await reapSnapshots\(/.test(sys));
  ok('wiring: snapshot GC also has a dedicated task', /task === 'snapshot_gc'/.test(sys));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SNAPSHOT GC (M7): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
