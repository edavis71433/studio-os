// ── New tests check behaviour, not the code's text (builder item 212) ────────
//   deno run --allow-read tests/presence/text_checks_ratchet_test.mjs
//   deno run --allow-read --allow-write tests/presence/text_checks_ratchet_test.mjs --update
//
// Most suites here used to prove things by reading a source file and matching a piece of
// its text (`ok('…', /site_id=eq\./.test(sales))`). Tidying a line fails such a check though
// nothing broke, and a real break that keeps the text passes it (review file 06, finding
// 108). The ten largest were rewritten to drive the real code in Nov 2026. This suite keeps
// the number from growing again: it counts, in every suite, the checks that test text read
// from a file, and fails when a suite has more than text_checks_allowed.json allows. A suite
// that isn't listed is allowed none.
//
// A new check should import the module and drive it (tests/presence/fake_pgrst.mjs stands
// in for the database; scoped_commerce_test.mjs drives the real router), or test the page
// in a browser (tests/e2e). Where the text itself is the contract (a migration's SQL, a
// header line, two hand-kept copies that must match), raise that suite's number in
// text_checks_allowed.json in the same change, so the reason is in its review. A suite
// that has fewer than it's allowed passes; --update writes today's numbers down.
const DIR = new URL('./', import.meta.url);
const ALLOWED_FILE = new URL('text_checks_allowed.json', DIR);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const READS = String.raw`Deno\.readTextFile(?:Sync)?`;

// How many `ok(` lines in a suite test text it read from a file. A file's text is bound
// to a name (`const sales = read('…')` or `= Deno.readTextFileSync(…)`), and a check uses
// that name with a text test (`.test(sales)`, `sales.includes(`, `.match(`, `.indexOf(`).
export function textChecks(src) {
  if (!new RegExp(READS).test(src)) return 0;
  const names = new Set([...src.matchAll(new RegExp(String.raw`(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?` + READS, 'g'))].map((m) => m[1]));
  const helpers = new Set([
    ...[...src.matchAll(new RegExp(String.raw`(?:const|let|var|function)\s+(\w+)\s*=?\s*(?:\([^)]*\)|\w+)\s*=>\s*(?:\{[^}]*)?` + READS, 'g'))].map((m) => m[1]),
    ...[...src.matchAll(new RegExp(String.raw`function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*` + READS, 'g'))].map((m) => m[1]),
  ]);
  for (const h of helpers) {
    for (const m of src.matchAll(new RegExp(String.raw`(?:const|let|var)\s+(\w+)\s*=\s*` + esc(h) + String.raw`\(`, 'g'))) names.add(m[1]);
    names.add(h);
  }
  if (!names.size) return 0;
  const n = [...names].map(esc).join('|');
  const uses = new RegExp(String.raw`\b(?:${n})(?:\([^)]*\))?(?:\.\w+)*\s*\)|\.(?:test|includes|match|indexOf|search)\(\s*(?:${n})\b|\b(?:${n})(?:\([^)]*\))?\.(?:includes|match|indexOf|search|split|slice)\(`);
  return src.split('\n').filter((line) => /\bok\(/.test(line) && uses.test(line)).length;
}

const counts = {};
for (const f of [...Deno.readDirSync(DIR)].map((e) => e.name).filter((x) => x.endsWith('_test.mjs')).sort()) {
  const c = textChecks(Deno.readTextFileSync(new URL(f, DIR)));
  if (c) counts[f] = c;
}

if (Deno.args.includes('--update')) {
  Deno.writeTextFileSync(ALLOWED_FILE, JSON.stringify(counts, null, 1) + '\n');
  console.log(`wrote ${Object.keys(counts).length} suites, ${Object.values(counts).reduce((a, b) => a + b, 0)} checks`);
  Deno.exit(0);
}

let pass = 0, fail = 0;
const ok = (name, cond, note = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`); };

// The counter itself, on made-up suites (the read is spliced in, so this file doesn't count itself).
const RD = ['Deno', 'readTextFileSync'].join('.');
ok('a check matching a file\'s text counts', textChecks(`const s = ${RD}('a.ts');\nok('x', /y/.test(s));`) === 1);
ok('…through a reading helper too', textChecks(`const read = (p) => ${RD}(p);\nconst s = read('a.ts');\nok('x', s.includes('y'));\nok('z', /w/.test(read('b.ts')));`) === 2);
ok('a check on what the code returned doesn\'t count', textChecks(`const s = ${RD}('a.json');\nconst r = await handler();\nok('x', r.status === 200);`) === 0);
ok('a suite that reads no file has none', textChecks("ok('x', /y/.test('abc'));") === 0);

const allowed = JSON.parse(Deno.readTextFileSync(ALLOWED_FILE));
const over = Object.entries(counts).filter(([f, c]) => c > (allowed[f] ?? 0));
for (const [f, c] of over) {
  ok(`${f} adds no check on the code's text`, false, `${c} now, ${allowed[f] ?? 0} allowed: drive the code instead, or raise its number in text_checks_allowed.json if the text is the contract`);
}
ok('no suite has more checks on the code\'s text than it is allowed', over.length === 0);
const total = Object.values(counts).reduce((a, b) => a + b, 0), cap = Object.values(allowed).reduce((a, b) => a + b, 0);
console.log(`checks on the code's text: ${total} in ${Object.keys(counts).length} suites (allowed ${cap})`);

console.log(`\n════ TEXT CHECKS RATCHET: ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) Deno.exit(1);
