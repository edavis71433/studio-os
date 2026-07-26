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

// ═══════════════════════════════════════════════════════════════════════════════
// G13 slice 2 · the in-place canvas TEXT editor (docs/design/G13-INPLACE-EDITING.md
// §2–3). Pure pieces extracted + pinned: the guarded dot-path writer, the client
// cap table (a soft mirror of validateBlocks' s()/ml() caps — drift only mis-warns,
// the server stays the moat), the DOM→markdown serializer over EXACTLY
// renderMarkdown's output allowlist, and the Edit-mode/feature-detect gate.
// ═══════════════════════════════════════════════════════════════════════════════

// extract `const NAME = {...};` by brace-matching (same idiom as extractFn)
function extractConst(src, name) {
  const start = src.indexOf('const ' + name + ' = {');
  if (start < 0) throw new Error('const not found: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) + ';'; }
  }
  throw new Error('unbalanced braces for ' + name);
}

// ── ipeSetPath: the guarded field-path writer (dot-path incl. array indices) ──
{
  const ipeSetPath = new Function('return (' + extractFn(html, 'ipeSetPath') + ')')();
  const ipeGetPath = new Function('return (' + extractFn(html, 'ipeGetPath') + ')')();
  const b1 = { type: 'features', title: 'Why', items: [{ title: 'A', text: 'x' }, { title: 'B' }] };
  ok(ipeSetPath(b1, 'title', 'New') === true && b1.title === 'New', 'a top-level string field writes in place');
  ok(ipeSetPath(b1, 'items.1.title', 'Bee') === true && b1.items[1].title === 'Bee', 'an array-index dot-path writes the right item');
  ok(ipeSetPath(b1, 'items.5.title', 'Z') === false, 'an OUT-OF-BOUNDS array index is refused (guarded, never extends)');
  ok(ipeSetPath(b1, 'items.1.text', 'tee') === true && b1.items[1].text === 'tee', 'an absent-but-legal string slot on an existing item is writable');
  const it = { type: 'image_text', body: 'b', button: { label: 'Go', url: 'https://x.example' } };
  ok(ipeSetPath(it, 'button.label', 'Run') === true && it.button.label === 'Run' && it.button.url === 'https://x.example', 'button.label writes INSIDE the object — the url is untouched');
  ok(ipeSetPath(it, 'button', 'nope') === false, 'a path landing on an OBJECT slot is refused (fields are string slots only)');
  ok(ipeSetPath(it, 'button.url.host', 'x') === false, 'walking INTO a string is refused');
  const tb = { type: 'table', headers: ['A'], rows: [['r1a', 'r1b'], ['r2a', 'r2b']] };
  ok(ipeSetPath(tb, 'rows.1.0', 'X') === true && tb.rows[1][0] === 'X', 'nested array indices (table cells) write the right cell');
  ok(ipeSetPath(tb, 'rows.2.0', 'X') === false, 'a table row past the end is refused');
  ok(ipeSetPath({}, 'a.b', 'x') === false, 'a missing parent object is refused (no vivification)');
  ok(ipeSetPath({ a: {} }, '0', 'x') === false, 'a numeric segment on a non-array is refused');
  ok(ipeSetPath(b1, 'title', '<b>x</b> & "quotes"') === true && b1.title === '<b>x</b> & "quotes"', 'THE MOAT: the value is stored as a literal STRING — markup is data, never interpreted');
  ok(ipeGetPath(it, 'button.label') === 'Run' && ipeGetPath(b1, 'items.1.title') === 'Bee' && ipeGetPath(b1, 'items.9.title') === undefined, 'ipeGetPath reads the same paths back (the unchanged-commit check)');
}

// ── ipeCapFor: the client cap table mirrors validateBlocks' s()/ml() caps ──
{
  const ipeCapFor = new Function(extractConst(html, 'IPE_CAPS') + '\n' + extractFn(html, 'ipeCapFor') + '\nreturn ipeCapFor;')();
  ok(ipeCapFor('features', 'items.0.text') === 240, 'features items.N.text caps at 240 (validateBlocks s())');
  ok(ipeCapFor('features', 'items.12.title') === 80, 'any numeric index normalizes to the same cap');
  ok(ipeCapFor('cta', 'text') === 160 && ipeCapFor('cta', 'button') === 40, 'cta text 160 / button 40');
  ok(ipeCapFor('richtext', 'body') === 4000 && ipeCapFor('image_text', 'body') === 2000, 'markdown bodies cap at the ml() bounds (4000 / 2000)');
  ok(ipeCapFor('accordion', 'items.3.summary') === 120 && ipeCapFor('accordion', 'items.3.body') === 1500, 'accordion summary 120 / body 1500');
  ok(ipeCapFor('spotlight', 'title') === 120 && ipeCapFor('spotlight', 'body') === 800, 'spotlight has its OWN title cap (120) + body 800');
  ok(ipeCapFor('title', 'title') === 120 && ipeCapFor('title', 'subtitle') === 200, 'the title block: 120 / 200');
  ok(ipeCapFor('gallery', 'title') === 80, 'a block with no own title entry falls back to the shared 80 (s(title, 80))');
  ok(ipeCapFor('table', 'rows.3.2') === 200 && ipeCapFor('table', 'headers.1') === 80, 'table cells 200 / headers 80');
  ok(ipeCapFor('columns', 'columns.2.button.label') === 40, 'a nested button label caps at 40');
  ok(ipeCapFor('unknown_type', 'weird.path') === null, 'an unknown field has NO client cap (the server still enforces truth)');
}

// ── ipeGate: Edit-mode-only + feature-detect + block-sections-only ──
{
  const ipeGate = new Function('return (' + extractFn(html, 'ipeGate') + ')')();
  ok(ipeGate('edit', 'title', { kind: 'block', bi: 0 }) === true, 'Edit mode + a stamped field + a block section → editable');
  ok(ipeGate('comments', 'title', { kind: 'block', bi: 0 }) === false, 'Comments mode never edits in place');
  ok(ipeGate('preview', 'title', { kind: 'block', bi: 0 }) === false, 'Preview mode never edits in place');
  ok(ipeGate('timewarp', 'title', { kind: 'block', bi: 0 }) === false, 'Timewarp never edits in place');
  ok(ipeGate('edit', '', { kind: 'block', bi: 0 }) === false && ipeGate('edit', null, { kind: 'block', bi: 0 }) === false, 'no data-dds-field stamp (old function) → no in-place affordance (feature-detect)');
  ok(ipeGate('edit', 'title', { kind: 'core', view: 'business', key: 'hero' }) === false, 'core/hero sections are NOT in-place editable this slice');
  ok(ipeGate('edit', 'title', null) === false, 'an unresolved section never edits');
}

// ── ipeSerializeMd: DOM → markdown over renderMarkdown's exact allowlist ──
const T = (s) => ({ nodeType: 3, nodeValue: s });
const E = (tag, attrs, ...kids) => ({
  nodeType: 1, tagName: tag.toUpperCase(), childNodes: kids, attrs: attrs || {},
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
  hasAttribute(k) { return k in this.attrs; },
});
const ipeSerializeMd = new Function('return (' + extractFn(html, 'ipeSerializeMd') + ')')();
{
  const dom = E('div', { 'data-dds-field': 'body', 'data-dds-md': '1' },
    E('p', {}, T('Hello '), E('strong', {}, T('world'))),
    E('ul', {}, E('li', {}, T('first')), E('li', {}, T('second'))));
  ok(ipeSerializeMd(dom) === 'Hello **world**\n\n- first\n- second', 'p/strong/ul round-trip to markdown source');
  const dom2 = E('div', {},
    E('h2', {}, T('Head')), E('h3', {}, T('Sub')),
    E('p', {}, T('a'), E('br', {}), T('b')),
    E('ol', {}, E('li', {}, T('one')), E('li', {}, T('two'))),
    E('blockquote', {}, E('p', {}, T('quoted'))),
    E('p', {}, E('a', { href: 'https://x.example', rel: 'noopener' }, T('link me'))));
  ok(ipeSerializeMd(dom2) === '## Head\n\n### Sub\n\na\nb\n\n1. one\n2. two\n\n> quoted\n\n[link me](https://x.example)',
    'h2/h3, br, ol numbering, blockquote and links all serialize to their markdown forms');
  // THE image_text nuance: the md container (.it-text) also wraps the button
  // anchor — an element carrying its OWN data-dds-field is another field and
  // must never leak into the body serialization.
  const itDom = E('div', { 'data-dds-field': 'body', 'data-dds-md': '1' },
    E('p', {}, T('Beside the '), E('strong', {}, T('image'))),
    E('p', { class: 'it-cta' }, E('a', { class: 'btn', href: 'https://x.example', rel: 'noopener', 'data-dds-field': 'button.label' }, T('Go now'))));
  const itMd = ipeSerializeMd(itDom);
  ok(itMd === 'Beside the **image**', 'image_text: the button anchor (its own data-dds-field) is EXCLUDED from the body — not eaten, not serialized');
  ok(!/Go now/.test(itMd), 'the button label never leaks into the stored body');
  const junk = E('div', {},
    E('p', { contenteditable: 'false' }, T('chrome')),
    E('section', {}, T('pasted '), E('span', {}, E('em', {}, T('markup')))),
    E('table', {}, T('tabular')));
  ok(ipeSerializeMd(junk) === 'pasted *markup*\n\ntabular', 'unknown nodes collapse to content (meaning stripped, content kept); contenteditable=false chrome is skipped');
  ok(ipeSerializeMd(E('div', {})) === '', 'an empty container serializes to the empty string');
}
// ── G13 slice-2 review, finding 1+2: the MINI-BAR INVARIANT ──────────────────
// After ANY wrap action, serialize(session DOM) re-rendered through the REAL
// renderMarkdown must show EXACTLY the formatting the user was looking at.
// renderMarkdown parses strong FIRST ('**…**' can never span a '*'), then em —
// so em may contain strong but never the reverse; the serializer emits a
// strong-holding-em as split runs ('**a ***b*** c**' → strong/em·strong/strong,
// the same visual, since the browser bolds a nested em too), same-tag nesting
// once (never '****x****'), and merges directly-adjacent ems ('*a**b*' tears).
// The comparison is FORMATTING RUNS (text + bold/italic/href), the observable
// truth independent of em(strong) vs strong(em) nesting order.
{
  const { renderMarkdown } = await import('../../supabase/functions/presence/lib/markdown.ts');
  const parseHtml = (src) => {
    const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const root = E('div', {}); const stack = [root];
    const re = /<(\/?)([a-z0-9]+)((?:\s+[a-z-]+="[^"]*")*)\s*>|([^<]+)/gi;
    let m;
    while ((m = re.exec(src))) {
      if (m[4] !== undefined) { stack[stack.length - 1].childNodes.push(T(unesc(m[4]))); continue; }
      if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
      const el2 = E(m[2], {});
      (m[3] || '').replace(/([a-z-]+)="([^"]*)"/gi, (_x, k, v) => { el2.attrs[k] = unesc(v); return ''; });
      stack[stack.length - 1].childNodes.push(el2);
      if (m[2].toLowerCase() !== 'br') stack.push(el2);
    }
    return root;
  };
  const runsOf = (root) => {
    const nh = (h) => { try { return h == null ? null : decodeURIComponent(h); } catch (_) { return h; } };
    const acc = [];
    const walk = (n, b, i2, href) => {
      for (const ch of n.childNodes || []) {
        if (ch.nodeType === 3) { const t2 = String(ch.nodeValue || ''); if (t2) acc.push({ t: t2, b, i: i2, href }); continue; }
        if (ch.nodeType !== 1) continue;
        const t = String(ch.tagName || '').toUpperCase();
        walk(ch, b || t === 'STRONG' || t === 'B', i2 || t === 'EM' || t === 'I', t === 'A' ? nh(ch.getAttribute('href') || href) : href);
      }
    };
    walk(root, false, false, null);
    const out = [];
    for (const r of acc) {
      const last = out[out.length - 1];
      if (last && last.b === r.b && last.i === r.i && last.href === r.href) last.t += r.t;
      else out.push({ t: r.t, b: r.b, i: r.i, href: r.href });
    }
    return out.map((r) => ({ t: r.t.replace(/\s+/g, ' '), b: r.b, i: r.i, href: r.href })).filter((r) => r.t.trim());
  };
  const SHAPES = [
    ['B over a run containing italics', E('div', {}, E('p', {}, E('strong', {}, T('a '), E('em', {}, T('b')), T(' c'))))],
    ['B on already-bold (nested strong)', E('div', {}, E('p', {}, E('strong', {}, E('strong', {}, T('x')))))],
    ['I on already-italic (nested em)', E('div', {}, E('p', {}, E('em', {}, E('em', {}, T('x')))))],
    ['directly-adjacent ems', E('div', {}, E('p', {}, E('em', {}, T('a')), E('em', {}, T('b'))))],
    ['I over a run containing bold', E('div', {}, E('p', {}, E('em', {}, T('a '), E('strong', {}, T('b')), T(' c'))))],
    ['bold run containing a link', E('div', {}, E('p', {}, E('strong', {}, T('go '), E('a', { href: 'https://x.example' }, T('here')), T(' now'))))],
    ['em-of-strong (stored ***both***)', E('div', {}, E('p', {}, E('em', {}, E('strong', {}, T('both')))))],
    ['strong at line edges via br', E('div', {}, E('p', {}, E('strong', {}, T('a'), E('br', {}), T('b'))))],
    ['B snapped around a whole em mid-word', E('div', {}, E('p', {}, E('strong', {}, T('x'), E('em', {}, T('both')), T('y'))))],
  ];
  for (const [name, dom] of SHAPES) {
    const src = ipeSerializeMd(dom);
    const h = renderMarkdown(src);
    const want = JSON.stringify(runsOf(dom));
    const got = JSON.stringify(runsOf(parseHtml(h)));
    ok(want === got, 'MINI-BAR INVARIANT (' + name + '): serialized=' + JSON.stringify(src) + ' want=' + want + ' got=' + got);
  }
  // finding 2: a block boundary inside a wrap is a LINE BREAK, never a glue —
  // the reviewer's exact repro (extractContents put two <p>s inside a strong).
  const cross = E('div', {},
    E('p', {}, T('before '), E('strong', {}, E('p', {}, T('tail one')), E('p', {}, T('head two')))),
    E('p', {}, T(' after')));
  const crossSrc = ipeSerializeMd(cross);
  ok(!/onehead/.test(crossSrc), 'FINDING 2 PINNED: cross-paragraph bold never glues words (no "onehead"): ' + JSON.stringify(crossSrc));
  ok(crossSrc === 'before **tail one**\n**head two**\n\nafter',
    'cross-paragraph bold emits per-line bold with the break kept: ' + JSON.stringify(crossSrc));
  const crossH = renderMarkdown(crossSrc);
  ok(/<strong>tail one<\/strong><br><strong>head two<\/strong>/.test(crossH), 'the re-render keeps both lines bold with the break: ' + JSON.stringify(crossH));
  // a literal '*' typed inside what became a strong has NO faithful bold form
  // (no escape support): the serializer must not tear — it keeps the content,
  // drops only the meaning it cannot express.
  const litStar = ipeSerializeMd(E('div', {}, E('p', {}, E('strong', {}, T('2 * 3')))));
  const litH = renderMarkdown(litStar);
  ok(!/\*\*/.test(litH.replace(/<[^>]*>/g, '')), 'a literal * inside strong never fabricates torn ** markers: stored=' + JSON.stringify(litStar) + ' renders=' + JSON.stringify(litH));
}

// The §2.3 property: for every fixture, render(serialize(render(x))) === render(x)
// — driven through the REAL renderMarkdown and a subset parser of its output.
{
  const { renderMarkdown } = await import('../../supabase/functions/presence/lib/markdown.ts');
  const parseHtml = (src) => {
    const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const root = E('div', {}); const stack = [root];
    const re = /<(\/?)([a-z0-9]+)((?:\s+[a-z-]+="[^"]*")*)\s*>|([^<]+)/gi;
    let m;
    while ((m = re.exec(src))) {
      if (m[4] !== undefined) { stack[stack.length - 1].childNodes.push(T(unesc(m[4]))); continue; }
      if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
      const el2 = E(m[2], {});
      (m[3] || '').replace(/([a-z-]+)="([^"]*)"/gi, (_x, k, v) => { el2.attrs[k] = unesc(v); return ''; });
      stack[stack.length - 1].childNodes.push(el2);
      if (m[2].toLowerCase() !== 'br') stack.push(el2);
    }
    return root;
  };
  const FIX = [
    'Hello **world**',
    'One para\n\nTwo *em* and **strong** mix',
    '## Heading\n\nBody line\nsecond line',
    '### Sub\n\n- a\n- b **bold b**\n\n1. one\n1. two',
    '> quoted line\n> second',
    'Link me [Davis](https://davisdigital.example) now',
    'a * b * c',
    'Ampers& and <angle> chars stay text',
    'Multi\n\n\n\nblank runs collapse',
  ];
  let badP = [];
  for (const x of FIX) {
    const h1 = renderMarkdown(x);
    const h2 = renderMarkdown(ipeSerializeMd(parseHtml(h1)));
    if (h1 !== h2) badP.push(JSON.stringify(x) + ' → ' + JSON.stringify(ipeSerializeMd(parseHtml(h1))));
  }
  ok(badP.length === 0, 'PROPERTY: renderMarkdown(serialize(renderMarkdown(x))) === renderMarkdown(x) for every fixture: ' + badP.slice(0, 2).join(' | '));
}

// ── the session engine + save model: source pins (the impure half) ──
{
  const inject = extractFn(html, 'dcInjectCanvas');
  ok(/addEventListener\("dblclick"/.test(inject) && /ipeStart\(/.test(inject) && /eeEditTarget\(el2\)/.test(inject), 'dcInjectCanvas wires dblclick → in-place edit on a stamped field, panel routing otherwise (never a dead double-click)');
  ok(/DC_MODE !== "edit"/.test(inject), 'the dblclick wiring is Edit-mode-gated at EVENT time (Comments-mode chrome never edits)');
  ok(/if \(IPE\) return;/.test(inject), 'the hover toolbar is suppressed while a session is active');
  const start = extractFn(html, 'ipeStart');
  ok(/plaintext-only/.test(start), 'plain fields request contenteditable=plaintext-only (rich formatting cannot enter)');
  ok(/setAttribute\("role", "textbox"\)/.test(start) && /aria-label/.test(start), 'a11y: the session element becomes an aria-labelled textbox');
  const paste = extractFn(html, 'ipePaste');
  ok(/preventDefault\(\)/.test(paste) && /insertText/.test(paste) && /text\/plain/.test(paste), 'the UNCONDITIONAL paste guard inserts plain text only (plaintext-only is non-universal)');
  const kd = extractFn(html, 'ipeKeydown');
  ok(/Escape/.test(kd) && /ipeCancel\(\)/.test(kd), 'Escape always exits without saving (no trap)');
  const commit = extractFn(html, 'ipeCommit');
  ok(/ipeSerializeMd\(/.test(commit) && /ipeReadPlain\(/.test(commit), 'commit reads markdown SOURCE for md fields, collapsed plain text otherwise');
  ok(/eeClassify\(/.test(commit), 'commit RE-RESOLVES the section index at commit time (tree-rail deletes/moves mid-session — DDS_SRCMAP applies)');
  ok(/ipeSetPath\(/.test(commit) && /ipeSaveSoon\(\)/.test(commit), 'commit writes through the guarded path writer then the debounced save — no other write path');
  ok(!/\bapi\(/.test(commit) && !/fetch\(/.test(commit), 'NO parallel save path: commit never calls the API directly');
  ok(!/innerHTML\s*=/.test(commit), 'commit never writes HTML anywhere — the value is a string field on a structured block');
  ok(/ipeCapFor\(/.test(commit), 'commit enforces the client cap (no silent server truncation)');
  const cancel = extractFn(html, 'ipeCancel');
  ok(/\.innerHTML = s\.orig/.test(cancel), 'cancel restores the element\'s ORIGINAL server-rendered DOM');
  const soon = extractFn(html, 'ipeSaveSoon');
  ok(/setTimeout/.test(soon) && /1200/.test(soon) && /saveBlocks\(\)/.test(soon), 'the in-place save is the EXISTING saveBlocks, debounced ~1.2s (one undo checkpoint per burst)');
  ok(/IPE_SAVE_PENDING/.test(soon), 'a save landing during a NEW session defers — the reload can never destroy an active contenteditable');
  const rdp = extractFn(html, 'refreshDesignPreview');
  ok(/if \(IPE\) ipeCommit\(\);[\s\S]*?frame\.srcdoc = html/.test(rdp), 'a canvas repaint banks any in-flight session FIRST (text is never silently lost)');
  const sb = extractFn(html, 'saveBlocks');
  ok(/closest\("#blocksCard"\)/.test(sb), 'saveBlocks skips the panel rebuild under a focused panel input (the §3 clobber hazard, closed)');
  ok(!/ipeStart/.test(extractFn(html, 'eeInjectChrome')), 'the read-only stage proof gets NO text editing (its bar is unchanged)');
  const wrap = extractFn(html, 'ipeWrapSel');
  ok(/surroundContents|extractContents/.test(wrap) && !/execCommand/.test(wrap), 'B/I use direct Range wrapping — not the deprecated execCommand');
  const link = extractFn(html, 'ipeLink');
  ok(/askText\(/.test(link) && /https:\/\//.test(link), 'Link reuses the parent askText dialog + the bare-domain→https normalization (rtLink rule)');
}

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  live-canvas pure logic — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
console.log(`\n════ LIVE CANVAS GATE: ${done ? '1/1 PASSED' : 'FAILED'} ════`);
if (!done) Deno.exit(1);
