// ── AEM-style live canvas — pure editor-logic gate ────────────────────────────
// The design preview became the editor (drag onto the page, reorder in place,
// column controls). The moat-critical math is list-order / column-count ONLY —
// never x/y. This gate EXTRACTS the pure helpers from presence.html's inline
// script and pins their behaviour so the "structured, responsive" guarantee can't
// silently regress. Pure filesystem; no network.
//
//   deno run --allow-read tests/presence/design_canvas_test.mjs
const ROOT = new URL('../../', import.meta.url);
const html = await Deno.readTextFile(new URL('presence.html', ROOT));

// Pull `function NAME(...) { ... }` out of the page by brace-matching from its start.
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  FAIL → ' + msg); } };

// dcClampColumns(n): the Layout Container is 1–6 columns (Adobe allows 1..N; we cap
// at 6 for a small-business site). render + serializer now support the full range.
const dcClampColumns = new Function('return (' + extractFn(html, 'dcClampColumns') + ')')();
ok(dcClampColumns(1) === 1, '1 column is allowed now (single-column layout container)');
ok(dcClampColumns(2) === 2, '2 stays 2');
ok(dcClampColumns(3) === 3, '3 stays 3');
ok(dcClampColumns(6) === 6, '6 stays 6 (max)');
ok(dcClampColumns(7) === 6, '7 clamps down to 6 (max)');
ok(dcClampColumns(0) === 1, '0/garbage clamps to the minimum of 1');
ok(dcClampColumns('3') === 3, 'coerces a numeric string');

// dcEqualSpans(n): distribute 12 grid units across n columns; leftmost get remainder.
// Always integers summing to exactly 12 — the moat (span = integer grid unit, no x/y).
const dcEqualSpans = new Function(
  extractFn(html, 'dcClampColumns') + '\n' + extractFn(html, 'dcEqualSpans') + '\n return dcEqualSpans;'
)();
const sums = (a) => a.reduce((x, y) => x + y, 0);
ok(JSON.stringify(dcEqualSpans(2)) === JSON.stringify([6, 6]), '2 columns → 6|6');
ok(JSON.stringify(dcEqualSpans(3)) === JSON.stringify([4, 4, 4]), '3 columns → 4|4|4');
ok(JSON.stringify(dcEqualSpans(1)) === JSON.stringify([12]), '1 column → full 12');
ok(sums(dcEqualSpans(5)) === 12 && dcEqualSpans(5).every((s) => Number.isInteger(s) && s >= 1), '5 columns still sum to 12 with integer units');
ok(dcEqualSpans(4).every((s) => s === 3), '4 columns → 3|3|3|3');

// dcResizeColumns(cols, n): grow pads with an empty column, shrink truncates —
// existing columns (and their content) are preserved in order. Never returns XY.
const dcResizeColumns = new Function(
  extractFn(html, 'dcClampColumns') + '\n' + extractFn(html, 'dcResizeColumns') + '\n return dcResizeColumns;'
)();
const two = [{ body: 'A' }, { body: 'B' }];
ok(dcResizeColumns(two, 3).length === 3, 'grow 2→3 yields three columns');
ok(dcResizeColumns(two, 3)[0].body === 'A' && dcResizeColumns(two, 3)[1].body === 'B', 'grow preserves existing columns in order');
ok(dcResizeColumns(two, 3)[2].body === '', 'grow pads with an empty column');
const three = [{ body: 'A' }, { body: 'B' }, { body: 'C' }];
ok(dcResizeColumns(three, 2).length === 2, 'shrink 3→2 yields two columns');
ok(dcResizeColumns(three, 2)[0].body === 'A' && dcResizeColumns(three, 2)[1].body === 'B', 'shrink keeps the first columns');
ok(dcResizeColumns(three, 1).length === 1, 'a 1-column layout container is now allowed');
ok(dcResizeColumns(null, 2).length === 2, 'missing columns builds two empty ones');
ok(dcResizeColumns([], 3).every((c) => c && c.body === ''), 'from empty, all columns are empty objects');
// Every column is a plain content object — no coordinate, z-index, or position.
ok(dcResizeColumns(two, 3).every((c) => typeof c === 'object' && !('x' in c) && !('y' in c) && !('z' in c)), 'columns carry no positional fields (moat)');

// dndDropIndex is REUSED by the canvas move (dcMove) — confirm it still exists as
// the single-index reindex the drag-to-reorder-on-page relies on.
const dndDropIndex = new Function('return (' + extractFn(html, 'dndDropIndex') + ')')();
ok(dndDropIndex(0, 3) === 2 && dndDropIndex(3, 1) === 1, 'canvas reorder still maps to one list index');

// pdPickGap(gaps, cy): the pointer-drag engine's drop resolver. It replaced native
// cross-frame DnD — on pointerup it must resolve the drop to a SINGLE LIST INDEX
// (the nearest gap), NEVER an x/y coordinate. This pins that guarantee.
const pdPickGap = new Function('return (' + extractFn(html, 'pdPickGap') + ')')();
// three sections → gaps "before 0, before 1, before 2" + trailing append (gap 3),
// spaced 100px apart in the parent viewport.
const gaps = [{ gap: 0, y: 100 }, { gap: 1, y: 200 }, { gap: 2, y: 300 }, { gap: 3, y: 400 }];
ok(pdPickGap(gaps, 104) === 0, 'cursor near the first boundary resolves to gap 0 (insert at top)');
ok(pdPickGap(gaps, 210) === 1, 'cursor near the second boundary resolves to gap 1');
ok(pdPickGap(gaps, 500) === 3, 'cursor past the last section resolves to the append gap (list length)');
ok(pdPickGap(gaps, -50) === 0, 'cursor above everything clamps to the first gap');
ok(pdPickGap(gaps, 251) === 2, 'a cursor between boundaries picks the nearer one');
ok(pdPickGap([], 120) === 0, 'no sections (empty page) → the single append gap 0');
// The resolved value is ALWAYS one integer list index — never an x/y or object (moat).
for (let y = -100; y <= 600; y += 37) {
  const r = pdPickGap(gaps, y);
  ok(Number.isInteger(r) && r >= 0 && r <= 3, 'pdPickGap(' + y + ') is a single list index in range, not a coordinate');
}

// ── AEM parity: in-canvas insertion targets + Content Tree (structure guards) ──
// The drop no longer depends on cross-frame section rects — it snaps to injected
// "＋ Add section" bars, each carrying a LIST INDEX in data-gap. Confirm the engine
// reads those bars and that every reorder/insert path is a single integer index.
ok(/\.dc-ins\[data-gap\]/.test(html), 'pdGaps snaps the drag ghost to injected insertion bars (data-gap index)');
ok(/class\s*=\s*["']dc-emptyzone["']|"dc-emptyzone"/.test(html), 'empty page gets a big "add your first section" drop placeholder (AEM "drag components here")');
ok(/parseInt\(elx\.getAttribute\("data-gap"\), 10\)/.test(html), 'insertion targets resolve to an integer list index — never an x/y');
const treeRow = extractFn(html, 'dcTreeRow');
ok(/dcMove\(c\.bi, c\.bi - 1\)/.test(treeRow), 'content-tree "move up" reindexes by one list position');
ok(/dcMove\(c\.bi, c\.bi \+ 2\)/.test(treeRow), 'content-tree "move down" reindexes by one list position');
ok(/eeEditBlock\(c\.bi\)/.test(treeRow) && /eeEditCore\(c\.view\)/.test(treeRow), 'every tree component opens its own settings ("meta")');
ok(!/left\s*:\s*e\.clientX|top\s*:\s*e\.clientY|style\.transform\s*=\s*["']translate\(\$\{/.test(treeRow), 'tree rows carry no free x/y placement (structured only)');
const buildInserts = extractFn(html, 'dcBuildInserts');
ok(/data-gap/.test(buildInserts) && /BLOCKS_WORK \|\| \[\]\)\.length/.test(buildInserts), 'the trailing insert bar appends at the list length');

// ── Undo / Redo (AEM parity) — must re-persist a prior snapshot through the SAME
// validating save path (server re-validates), never mutate render output directly. ──
ok(/function dcUndo\(\)/.test(html) && /function dcRedo\(\)/.test(html), 'undo + redo both exist');
const applyHist = extractFn(html, 'dcApplyHistory');
ok(/BLOCKS_WORK = arr/.test(applyHist) && /saveBlocks\(\)/.test(applyHist), 'undo/redo restore a block-list snapshot and re-persist through saveBlocks (server re-validates — moat)');
ok(/JSON\.parse\(snapJson\)/.test(applyHist), 'history entries are serialized block lists (structured), not rendered HTML or x/y');
ok(/DC_HIST_SILENT/.test(html), 'undo/redo suppress their own history recording (no infinite loop)');

// ── Copy / Cut / Paste — a structured section clipboard; paste re-keys MULTI blocks
// and re-persists through saveBlocks. Never raw HTML; a single list index insert. ──
const pasteFn = extractFn(html, 'dcPasteAt');
ok(/uniqueBlockId\(blk\.type/.test(pasteFn), 'paste gives a MULTI-instance block a fresh unique id (no render-key collision)');
ok(/BLOCKS_WORK\.splice\(at, 0, blk\)/.test(pasteFn) && /saveBlocks\(\)/.test(pasteFn), 'paste inserts at ONE list index and re-persists through the validating save');
ok(/JSON\.parse\(JSON\.stringify\(clip\)\)/.test(pasteFn), 'paste deep-copies the clipboard (structured block), never shares references or raw HTML');
ok(/function dcCopyBlock\(/.test(html) && /function dcCutBlock\(/.test(html), 'copy + cut both exist');

// ── G13 · server-stamped section keys — the three client mirrors are DELETED and
// must STAY deleted (docs/design/G13-INPLACE-EDITING.md §1.5). Section identity is
// read off data-dds-sid/-core stamps; sid → BLOCKS_WORK index is a PURE LOOKUP into
// the server's /settings section_meta sidecar — no heading text in the code path. ──
ok(!/EE_MANDATORY_H2|eeEffHeading|eeSlug\(|eeBuildIdMap|EE_IDMAP/.test(html), 'the heading/slug mirror (EE_MANDATORY_H2 + eeEffHeading + eeSlug + eeBuildIdMap + EE_IDMAP) stays deleted');
ok(!/function cmSectionIds|eeBlockKey/.test(html), 'the comment-id mirror (cmSectionIds) and the render-key mirror (eeBlockKey) stay deleted');
const classify = extractFn(html, 'eeClassify');
ok(/data-dds-src/.test(classify) && /data-dds-sid/.test(classify) && /data-dds-core/.test(classify), 'eeClassify reads the server stamps (data-dds-src / data-dds-sid / data-dds-core)');
ok(classify.indexOf('data-dds-src') < classify.indexOf('data-dds-sid'), 'the stored-index stamp (data-dds-src) is checked FIRST — the sid join is the fallback');
ok(!/querySelector|textContent|classList|h1,h2,h3/.test(classify), 'eeClassify contains NO structural probes or heading-text reads (mirror-free)');
ok(/DDS_SIDMAP/.test(classify), 'sid resolution goes through the sidecar-built lookup only');
{
  // Behavior: pure lookup + fallbacks, extracted and driven with stub elements.
  const coreView = (html.match(/const DDS_CORE_VIEW = \{[^}]*\};/) || [''])[0];
  ok(!!coreView, 'DDS_CORE_VIEW (core key → panel view) exists');
  const mk = new Function('S', 'DC_PAGE', 'BLOCKS_WORK', 'DDS_SRCMAP_IN',
    'let DDS_SIDMAP = null;\nlet DDS_SRCMAP = DDS_SRCMAP_IN || null;\n' + coreView + '\n' +
    extractFn(html, 'ddsMetaFor') + '\n' + extractFn(html, 'ddsRebuildSidMap') + '\n' +
    extractFn(html, 'ddsSidFor') + '\n' + extractFn(html, 'ddsKeyFor') + '\n' + extractFn(html, 'eeClassify') + '\n' +
    'ddsRebuildSidMap(); return { classify: eeClassify, sidFor: ddsSidFor, keyFor: ddsKeyFor };');
  const meta = { blocks: [
    { sid: 'richtext', key: 'block_richtext', src_index: 1 },
    { sid: 'richtext#2', key: 'block_richtext_2', src_index: 3 },
    { sid: 'columns:cols_a', key: 'block_columns_cols_a', src_index: 4 },
  ], pages: { team: [{ sid: 'cta', key: 'block_cta', src_index: 0 }] } };
  const el = (attrs) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null) });
  const home = mk({ sectionMeta: meta }, '', new Array(6));
  const c1 = home.classify(el({ 'data-dds-sid': 'richtext#2' }));
  ok(c1.kind === 'block' && c1.bi === 3, 'a stamped sid resolves to its src_index by pure sidecar lookup');
  ok(home.sidFor(3) === 'richtext#2' && home.keyFor(1) === 'block_richtext', 'ddsSidFor/ddsKeyFor read the same sidecar in reverse');
  const c2 = home.classify(el({ 'data-dds-sid': 'ghost#9' }));
  ok(c2.kind === 'core' && c2.view === 'design', 'an unknown sid degrades to the panel fallback (never a dead click)');
  const c3 = home.classify(el({ 'data-dds-core': 'offerings' }));
  ok(c3.kind === 'core' && c3.view === 'offerings' && c3.key === 'offerings', 'data-dds-core routes to its tab + hide key');
  const c4 = home.classify(el({ 'data-dds-core': 'hero' }));
  ok(c4.view === 'business' && c4.key === 'hero', 'hero routes to the business tab with its sections_hidden key');
  const c5 = home.classify(el({}));
  ok(c5.kind === 'core' && c5.view === 'design' && c5.key === null, 'an UNSTAMPED section (stale render) gets today\'s design-panel fallback — feature-detect, no hard dependency');
  const pg = mk({ sectionMeta: meta }, 'team', new Array(2));
  ok(pg.classify(el({ 'data-dds-sid': 'cta' })).bi === 0, 'a custom page resolves through its own pages["slug"] meta');
  const noMeta = mk({}, '', new Array(6));
  const c6 = noMeta.classify(el({ 'data-dds-sid': 'richtext' }));
  ok(c6.kind === 'core' && c6.view === 'design', 'stamps without a loaded sidecar degrade to the panel (no crash, no guess)');

  // ── G13 fix: data-dds-src (the render's stored-list provenance) is PRIMARY ──
  // Poisoning test — a deliberately WRONG sid map must LOSE to the stamp: this is
  // the sid-divergence bug (linked-resolve / media-drop pages shift the per-type
  // #N counters, so the sid join lands on the wrong same-type block).
  const s1 = home.classify(el({ 'data-dds-sid': 'richtext#2', 'data-dds-src': '5' }));
  ok(s1.kind === 'block' && s1.bi === 5, 'data-dds-src WINS over a wrong sidecar sid join (the divergence class is dead)');
  const s2 = home.classify(el({ 'data-dds-src': '0' }));
  ok(s2.kind === 'block' && s2.bi === 0, 'data-dds-src alone resolves — no sidecar needed for the index join');
  ok(noMeta.classify(el({ 'data-dds-src': '2' })).bi === 2, 'src works with NO sidecar loaded at all (render truth is self-sufficient)');
  // bounds-check: an out-of-range stamp (stale vs the working list) falls back
  const s3 = home.classify(el({ 'data-dds-sid': 'richtext#2', 'data-dds-src': '6' }));
  ok(s3.kind === 'block' && s3.bi === 3, 'src ≥ BLOCKS_WORK.length is rejected → the sid join fallback');
  const s4 = home.classify(el({ 'data-dds-src': '99' }));
  ok(s4.kind === 'core' && s4.view === 'design', 'out-of-range src with no usable sid degrades to the panel (never a dead click)');
  const s5 = home.classify(el({ 'data-dds-sid': 'richtext', 'data-dds-src': '-1' }));
  ok(s5.kind === 'block' && s5.bi === 1, 'a non-integer/negative src is ignored (validated parse) → sid join');
  const s6 = home.classify(el({ 'data-dds-sid': 'richtext', 'data-dds-src': 'junk' }));
  ok(s6.kind === 'block' && s6.bi === 1, 'garbage src is ignored → sid join');
  // ABSENT src (an old deployed function's render) → the sid join, unchanged —
  // the same feature-detect degrade posture as c5/c6 above (pinned by c1 too).
  const s7 = home.classify(el({ 'data-dds-sid': 'columns:cols_a' }));
  ok(s7.kind === 'block' && s7.bi === 4, 'absent src → the sid join keeps working (old-function deploy window)');
  // the dcMove stale-window remap: eeClassify applies DDS_SRCMAP over the stamp
  const moved = mk({ sectionMeta: meta }, '', new Array(6), { 2: 0, 0: 1, 1: 2 });
  ok(moved.classify(el({ 'data-dds-src': '2' })).bi === 0, 'DDS_SRCMAP remaps a stale stamp after a local move (until the reload re-stamps)');
  ok(moved.classify(el({ 'data-dds-src': '4' })).bi === 4, 'indices outside the remap pass through unchanged');
}
// dcPermuteIndex — the ONE permutation both stale-map compensations (DDS_SIDMAP
// + DDS_SRCMAP) apply after a local move. Pin it against ground truth: actually
// splice a marker list and check every old index lands where the helper says.
{
  const dcPermuteIndex = new Function('return (' + extractFn(html, 'dcPermuteIndex') + ')')();
  let bad = [];
  for (let len = 2; len <= 5; len++) for (let from = 0; from < len; from++) for (let gap = 0; gap <= len; gap++) {
    const to = dndDropIndex(from, gap);
    if (to === from) continue;
    const arr = Array.from({ length: len }, (_, i) => i);
    const [x] = arr.splice(from, 1); arr.splice(to, 0, x);
    arr.forEach((old, j) => { if (dcPermuteIndex(old, from, to) !== j) bad.push(`len=${len} from=${from} gap=${gap} old=${old}`); });
  }
  ok(bad.length === 0, 'dcPermuteIndex matches the real splice for every (len, from, gap): ' + bad.slice(0, 3).join(' | '));
  const moveFn = extractFn(html, 'dcMove');
  ok(/DDS_SIDMAP\[sid\] = dcPermuteIndex\(/.test(moveFn) && /dcComposeSrcMap\([^;]*dcPermuteIndex\(v, from, to\)/.test(moveFn), 'dcMove shifts BOTH stale maps (sid join + src stamps) with the one extracted permutation');
  ok(/ddsRebuildSidMap\(\);\s*\n\s*DDS_SRCMAP = null/.test(html), 'dcInjectCanvas resets the src remap when the reloaded canvas brings fresh stamps');
  const orphan = extractFn(html, 'cmOrphanRows');
  ok(/querySelectorAll\("\[data-dds-sid\]"\)/.test(orphan) && /ddsMetaFor/.test(orphan), 'cmOrphanRows reads live sids from the canvas stamps UNIONed with the sidecar (never stamps-blind)');
}

// ── G13 fix, review finding 1: NON-MOVE local edits (delete / cut / duplicate /
// paste / add) splice BLOCKS_WORK too — each must compose its shift into
// DDS_SRCMAP so a second quick action on the not-yet-reloaded DOM hits the TRUE
// block. dcShiftIndex is the ONE pure shift; dcComposeSrcMap is the ONE
// composition every splice site (moves included) goes through. ──
const mkSrcMaps = () => new Function(
  extractFn(html, 'dcPermuteIndex') + '\n' + extractFn(html, 'dcShiftIndex') + '\n' +
  'let DDS_SRCMAP = null;\n' + extractFn(html, 'dcComposeSrcMap') + '\n' +
  'return { compose: dcComposeSrcMap, shift: dcShiftIndex, permute: dcPermuteIndex, get: () => DDS_SRCMAP };'
)();
{
  const { shift } = mkSrcMaps();
  // Pin dcShiftIndex against ground truth: actually splice a marker list and
  // check every old index lands where the helper says (-1 = the marker is gone).
  let bad = [];
  for (let len = 2; len <= 5; len++) {
    for (let at = 0; at < len; at++) {          // removal at `at`
      const arr = Array.from({ length: len }, (_, i) => i); arr.splice(at, 1);
      for (let i = 0; i < len; i++) if (shift(i, at, -1) !== arr.indexOf(i)) bad.push(`del len=${len} at=${at} i=${i}`);
    }
    for (let at = 0; at <= len; at++) {         // insertion at `at` (incl. append)
      const arr = Array.from({ length: len }, (_, i) => i); arr.splice(at, 0, 'new');
      for (let i = 0; i < len; i++) if (shift(i, at, 1) !== arr.indexOf(i)) bad.push(`ins len=${len} at=${at} i=${i}`);
    }
  }
  ok(bad.length === 0, 'dcShiftIndex matches the real splice for every (len, at, index), removal AND insertion: ' + bad.slice(0, 3).join(' | '));
  ok(shift(-1, 0, -1) === -1 && shift(-1, 0, 1) === -1, 'an already-deleted index (-1) stays -1 through further edits (gone is gone)');
}
{
  // Stacking: the composition domain is the DOM's stamp set AT LAST RELOAD —
  // it must survive later length changes. 5 sections at reload; dcDelete(1)
  // (list is now 4), then dcMove 0 → slot 2: every stamp 0..4 must still map
  // to ground truth, including the top stamp 4 the shrunken list no longer has.
  const m = mkSrcMaps();
  m.compose(5, (v) => m.shift(v, 1, -1));                     // dcDelete(1) with pre-splice length 5
  ok(JSON.stringify(m.get()) === JSON.stringify({ 0: 0, 1: -1, 2: 1, 3: 2, 4: 3 }), 'a local delete composes its shift into DDS_SRCMAP (stamp 1 → -1 gone, later stamps down one)');
  m.compose(4, (v) => m.permute(v, 0, 2));                    // dcMove over the CURRENT map (post-delete length 4)
  ok(JSON.stringify(m.get()) === JSON.stringify({ 0: 2, 1: -1, 2: 0, 3: 1, 4: 3 }), 'a move stacked on a delete composes OVER the current map — the stamp-4 key survives the shrunken list (multiple quick edits stack)');
}
{
  // eeClassify with a post-delete map — THE reviewer repro: delete block 1 of
  // 5, then hover the not-yet-reloaded DOM. Old stamps must resolve to the
  // TRUE post-splice blocks, and the deleted section's own ghost must fall
  // back (never a wrong-but-in-range block).
  const meta2 = { blocks: [], pages: {} };
  const el2 = (attrs) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null) });
  const mk2 = new Function('S', 'DC_PAGE', 'BLOCKS_WORK', 'DDS_SRCMAP_IN',
    'let DDS_SIDMAP = null;\nlet DDS_SRCMAP = DDS_SRCMAP_IN || null;\n' +
    (html.match(/const DDS_CORE_VIEW = \{[^}]*\};/) || [''])[0] + '\n' +
    extractFn(html, 'ddsMetaFor') + '\n' + extractFn(html, 'ddsRebuildSidMap') + '\n' + extractFn(html, 'eeClassify') + '\n' +
    'ddsRebuildSidMap(); return { classify: eeClassify };');
  const delMap = (() => { const m = mkSrcMaps(); m.compose(5, (v) => m.shift(v, 1, -1)); return m.get(); })();
  const afterDel = mk2({ sectionMeta: meta2 }, '', new Array(4), delMap);
  ok(afterDel.classify(el2({ 'data-dds-src': '2' })).bi === 1, 'REVIEW FINDING 1 PINNED: delete block 1 of 5 → the old src=2 section resolves to its true index 1, not the wrong block');
  ok(afterDel.classify(el2({ 'data-dds-src': '4' })).bi === 3, 'post-delete: the old LAST stamp (in range pre-fix, off by one) now resolves true (4 → 3)');
  ok(afterDel.classify(el2({ 'data-dds-src': '0' })).bi === 0, 'post-delete: stamps before the removal are untouched');
  const ghost = afterDel.classify(el2({ 'data-dds-src': '1' }));
  ok(ghost.kind === 'core' && ghost.view === 'design', "post-delete: the DELETED section's own ghost maps to -1 → fails the bounds-check → panel fallback, never a wrong block");
  // the reviewer's caveat: deleting the LAST section already escaped via the
  // bounds-check — the -1 convention must keep that exact posture.
  const delLastMap = (() => { const m = mkSrcMaps(); m.compose(5, (v) => m.shift(v, 4, -1)); return m.get(); })();
  const afterDelLast = mk2({ sectionMeta: meta2 }, '', new Array(4), delLastMap);
  const lastGhost = afterDelLast.classify(el2({ 'data-dds-src': '4' }));
  ok(lastGhost.kind === 'core' && lastGhost.view === 'design', 'deleting the LAST section still escapes to the fallback (-1 preserves the pre-fix bounds-check posture)');
  ok(afterDelLast.classify(el2({ 'data-dds-src': '2' })).bi === 2, 'last-section delete: every earlier stamp is untouched');
  // insertion (duplicate / paste / add): stamps at/after the point shift up.
  const dupMap = (() => { const m = mkSrcMaps(); m.compose(4, (v) => m.shift(v, 2, 1)); return m.get(); })();
  const afterDup = mk2({ sectionMeta: meta2 }, '', new Array(5), dupMap);
  ok(afterDup.classify(el2({ 'data-dds-src': '2' })).bi === 3, 'INSERTION PINNED: duplicate/paste/add at 2 → the old src=2 section resolves to 3 (shifted past the insert)');
  ok(afterDup.classify(el2({ 'data-dds-src': '1' })).bi === 1, 'post-insert: stamps before the insertion point are untouched');
}
{
  // Every splice site composes, BEFORE its splice (pre-splice length = the
  // stamp domain when the map is fresh). eeMoveBlock is a one-slot MOVE and
  // reuses dcPermuteIndex, exactly like dcMove.
  for (const [fn, kind] of [['dcDelete', '-1'], ['dcCutBlock', '-1'], ['dcDuplicate', '1'], ['dcPasteAt', '1'], ['addBlockAt', '1']]) {
    const s = extractFn(html, fn);
    ok(new RegExp('dcComposeSrcMap\\(BLOCKS_WORK\\.length, \\(v\\) => dcShiftIndex\\(v, [^,]+, ' + kind + '\\)\\)').test(s), fn + ' composes dcShiftIndex(…, ' + (kind === '-1' ? 'removal' : 'insertion') + ') into DDS_SRCMAP');
    ok(s.indexOf('dcComposeSrcMap(') < s.indexOf('.splice('), fn + ' composes BEFORE its splice (the pre-splice length is the stamp domain)');
  }
  const eeMove = extractFn(html, 'eeMoveBlock');
  ok(/dcComposeSrcMap\(o\.length, \(v\) => dcPermuteIndex\(v, bi, ni\)\)/.test(eeMove), 'eeMoveBlock (adjacent swap = one-slot move) composes dcPermuteIndex like dcMove');
}
ok(/route === "\/settings" && j && j\.data && j\.data\.section_meta/.test(html), 'api() captures the /settings section_meta sidecar into S.sectionMeta (the ONE writer)');

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  live-canvas pure logic — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
console.log(`\n════ LIVE CANVAS GATE: ${done ? '1/1 PASSED' : 'FAILED'} ════`);
if (!done) Deno.exit(1);
