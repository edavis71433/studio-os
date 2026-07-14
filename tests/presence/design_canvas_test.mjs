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

// dcClampColumns(n): the Columns block is 2–3 columns (render drops <2, caps at 3).
const dcClampColumns = new Function('return (' + extractFn(html, 'dcClampColumns') + ')')();
ok(dcClampColumns(1) === 2, '1 clamps up to 2 (a 1-col layout would need a render change)');
ok(dcClampColumns(2) === 2, '2 stays 2');
ok(dcClampColumns(3) === 3, '3 stays 3');
ok(dcClampColumns(4) === 3, '4 clamps down to 3 (max)');
ok(dcClampColumns(0) === 2, '0/garbage clamps to the minimum of 2');
ok(dcClampColumns('3') === 3, 'coerces a numeric string');

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
ok(dcResizeColumns(three, 1).length === 2, 'a 1-col request is clamped to the min of 2');
ok(dcResizeColumns(null, 2).length === 2, 'missing columns builds two empty ones');
ok(dcResizeColumns([], 3).every((c) => c && c.body === ''), 'from empty, all columns are empty objects');
// Every column is a plain content object — no coordinate, z-index, or position.
ok(dcResizeColumns(two, 3).every((c) => typeof c === 'object' && !('x' in c) && !('y' in c) && !('z' in c)), 'columns carry no positional fields (moat)');

// dndDropIndex is REUSED by the canvas move (dcMove) — confirm it still exists as
// the single-index reindex the drag-to-reorder-on-page relies on.
const dndDropIndex = new Function('return (' + extractFn(html, 'dndDropIndex') + ')')();
ok(dndDropIndex(0, 3) === 2 && dndDropIndex(3, 1) === 1, 'canvas reorder still maps to one list index');

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  live-canvas pure logic — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
console.log(`\n════ LIVE CANVAS GATE: ${done ? '1/1 PASSED' : 'FAILED'} ════`);
if (!done) Deno.exit(1);
