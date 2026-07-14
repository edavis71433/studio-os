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

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  live-canvas pure logic — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
console.log(`\n════ LIVE CANVAS GATE: ${done ? '1/1 PASSED' : 'FAILED'} ════`);
if (!done) Deno.exit(1);
