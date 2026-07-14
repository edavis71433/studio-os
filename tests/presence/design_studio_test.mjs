// ── Design studio redesign — pure editor-logic gate ───────────────────────────
// The Design surface's drag-reorder + add-tray search live in presence.html's
// inline script. This gate EXTRACTS the two pure, self-contained helpers and
// proves their behaviour, so the moat-critical "list-order only" reindex math and
// the tray search predicate can't silently regress. Pure filesystem; no network.
//
//   deno run --allow-read tests/presence/design_studio_test.mjs
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

// dndDropIndex(from, gap): removing `from` then inserting before gap i means the
// effective target shifts left by one when the gap is after the removed item.
const dndDropIndex = new Function('return (' + extractFn(html, 'dndDropIndex') + ')')();
ok(dndDropIndex(0, 0) === 0, 'drop before self (gap==from) is a no-op index');
ok(dndDropIndex(0, 1) === 0, 'move item 0 to the very next gap stays put (no-op)');
ok(dndDropIndex(0, 3) === 2, 'move item 0 down to gap 3 lands at index 2');
ok(dndDropIndex(3, 1) === 1, 'move item 3 up to gap 1 lands at index 1');
ok(dndDropIndex(2, 5) === 4, 'move item 2 down to gap 5 lands at index 4');
ok(dndDropIndex(4, 0) === 0, 'move item 4 to the top lands at index 0');
// Never produces an x/y coordinate — always a single list index (moat guarantee).
for (let f = 0; f < 8; f++) for (let g = 0; g <= 8; g++) {
  const r = dndDropIndex(f, g);
  ok(Number.isInteger(r) && r >= 0, 'dropIndex(' + f + ',' + g + ') is a non-negative integer');
}

// trayItemMatches(name, alias, type, q): plain multi-word substring search across
// the section's name, familiar alias and stored type.
const trayItemMatches = new Function('return (' + extractFn(html, 'trayItemMatches') + ')')();
ok(trayItemMatches('Photo gallery', 'carousel / grid', 'gallery', '') === true, 'empty query matches everything');
ok(trayItemMatches('Photo gallery', 'carousel / grid', 'gallery', 'carousel') === true, 'matches on the familiar alias');
ok(trayItemMatches('Photo gallery', 'carousel / grid', 'gallery', 'GALLERY') === true, 'case-insensitive on type');
ok(trayItemMatches('Photo gallery', 'carousel / grid', 'gallery', 'photo grid') === true, 'all words must be present (both found)');
ok(trayItemMatches('Photo gallery', 'carousel / grid', 'gallery', 'photo video') === false, 'a missing word fails the match');
ok(trayItemMatches('Buttons', 'button / link', 'buttons', 'link') === true, 'alias word matches');
ok(trayItemMatches('Buttons', 'button / link', 'buttons', 'zzz') === false, 'no match for gibberish');

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  design studio pure logic — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
console.log(`\n════ DESIGN STUDIO GATE: ${done ? '1/1 PASSED' : 'FAILED'} ════`);
if (!done) Deno.exit(1);
