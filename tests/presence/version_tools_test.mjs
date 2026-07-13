// ── Version tools (Compare · Timewarp · Checkpoint) — pure tests ─────────────
//   deno run --allow-read --allow-env tests/presence/version_tools_test.mjs
// The three features are wiring over engines that already exist; the only new
// logic is pure and lives in lib/preview_env.ts. This proves it end-to-end
// without a database:
//   • Compare  → describeVersionDiff feeds two snapshot CONTENTS to the ONE
//     change-sentence engine (lib/diff.ts describeChanges) in the from→to order.
//   • Timewarp → resolveTimewarpTarget resolves the retained version live on a
//     date, incl. honest out-of-retention handling; normalizeTimewarpDate maps a
//     bare day to end-of-day.
//   • Checkpoint → cleanCheckpointName trims/caps/defaults the label.
import { describeVersionDiff, resolveTimewarpTarget, normalizeTimewarpDate, cleanCheckpointName } from '../../supabase/functions/presence/lib/preview_env.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };

// ── minimal snapshot CONTENT builder (describeChanges normalizes the rest) ────
const content = (over = {}) => ({ identity: { business_name: 'Blue Fig' }, locations: [], offerings: [], faqs: [], testimonials: [], posts: [], redirects: [], settings: {}, ...over });

// ── Compare (describeVersionDiff = describeChanges in from→to order) ──────────
{
  const from = content({ identity: { business_name: 'Blue Fig' } });
  const to = content({ identity: { business_name: 'Red Fig' } });
  const cs = describeVersionDiff(from, to);
  ok('compare returns a change set with sentences', cs.count >= 1 && Array.isArray(cs.changes) && typeof cs.changes[0].sentence === 'string');
  // direction: going FROM Blue Fig TO Red Fig → "...from “Blue Fig” to “Red Fig”."
  const sentence = cs.changes.map((c) => c.sentence).join(' ');
  ok('compare honors from→to direction', sentence.includes('Blue Fig') && sentence.includes('Red Fig') && sentence.indexOf('Blue Fig') < sentence.indexOf('Red Fig'));
}
{
  // identical versions → zero changes (the UI shows "identical")
  const a = content({ offerings: [{ id: 'o1', name: 'Latte', category: 'Drinks', price_text: '$4' }] });
  const b = content({ offerings: [{ id: 'o1', name: 'Latte', category: 'Drinks', price_text: '$4' }] });
  const cs = describeVersionDiff(a, b);
  ok('compare of identical content → 0 changes', cs.count === 0);
}
{
  // a real offering change surfaces as an offerings sentence
  const from = content({ offerings: [{ id: 'o1', name: 'Latte', category: 'Drinks', price_text: '$4' }] });
  const to = content({ offerings: [{ id: 'o1', name: 'Latte', category: 'Drinks', price_text: '$5' }] });
  const cs = describeVersionDiff(from, to);
  ok('compare detects a price change in the right section', cs.changes.some((c) => c.section === 'offerings' && c.sentence.includes('$4') && c.sentence.includes('$5')));
}

// ── Timewarp resolution ──────────────────────────────────────────────────────
const V = [
  { publish_id: 'p1', effective_at: '2026-07-01T10:00:00Z', label: 'launch' },
  { publish_id: 'p2', effective_at: '2026-07-05T10:00:00Z', label: '' },
  { publish_id: 'p3', effective_at: '2026-07-10T10:00:00Z', label: 'summer menu' },
];
{
  const r = resolveTimewarpTarget(V, '2026-07-06T00:00:00Z');
  ok('timewarp picks the version live at the target (p2)', r.ok && r.publish_id === 'p2' && r.is_current === false);
}
{
  const r = resolveTimewarpTarget(V, '2026-07-10T10:00:00Z');
  ok('timewarp on the newest boundary → current version', r.ok && r.publish_id === 'p3' && r.is_current === true);
}
{
  const r = resolveTimewarpTarget(V, '2026-08-01T00:00:00Z');
  ok('timewarp in the future → still the current version', r.ok && r.publish_id === 'p3' && r.is_current === true);
}
{
  const r = resolveTimewarpTarget(V, '2026-06-01T00:00:00Z');
  ok('timewarp before retention → honest out_of_retention with earliest_at', !r.ok && r.reason === 'out_of_retention' && r.earliest_at === '2026-07-01T10:00:00Z');
}
{
  const r = resolveTimewarpTarget([], '2026-07-06T00:00:00Z');
  ok('timewarp with no versions → no_versions', !r.ok && r.reason === 'no_versions');
}
{
  const r = resolveTimewarpTarget(V, 'not-a-date');
  ok('timewarp with a bad date → bad_date', !r.ok && r.reason === 'bad_date');
}
{
  // unparseable effective_at rows are ignored, not crashed on
  const r = resolveTimewarpTarget([{ publish_id: 'x', effective_at: 'nope' }, ...V], '2026-07-06T00:00:00Z');
  ok('timewarp ignores unparseable version timestamps', r.ok && r.publish_id === 'p2');
}

// ── normalizeTimewarpDate ────────────────────────────────────────────────────
ok('bare day → end of that day (UTC)', normalizeTimewarpDate('2026-07-05') === '2026-07-05T23:59:59.999Z');
ok('full ISO timestamp passes through', normalizeTimewarpDate('2026-07-05T08:30:00Z') === '2026-07-05T08:30:00Z');
{
  // a version published earlier on the chosen DAY is included (end-of-day semantics)
  const r = resolveTimewarpTarget(V, normalizeTimewarpDate('2026-07-05'));
  ok('bare-day timewarp includes a version published that morning', r.ok && r.publish_id === 'p2');
}

// ── Checkpoint name round-trip ───────────────────────────────────────────────
ok('checkpoint name trims + collapses whitespace', cleanCheckpointName('  Before   redesign  ') === 'Before redesign');
ok('empty checkpoint name → sensible default', cleanCheckpointName('') === 'Checkpoint' && cleanCheckpointName('   ') === 'Checkpoint');
ok('checkpoint name capped at 80 chars', cleanCheckpointName('x'.repeat(200)).length === 80);
ok('checkpoint name strips control characters', cleanCheckpointName('safepoint') === 'safepoint');

const passed = results.filter((r) => r.p).length;
console.log(`\n════ VERSION TOOLS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) throw new Error(`${results.length - passed} version-tools test(s) failed`);
