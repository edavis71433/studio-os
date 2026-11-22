// ── A dated test holds its clock, and only through the clock helpers (builder item 421) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/clock_rule_test.mjs
//   deno run --allow-read --allow-write tests/presence/clock_rule_test.mjs --update
//
// Tests tied to today's date broke main three times in November 2026: a fixture dated
// Nov 15 went stale at midnight, a "six days ago" label flipped between 15:00 and 16:00
// UTC, and a sales fixture went past its date. Each held a calendar date while the page or
// the code under test read the real clock. The rule: a test sets the clock to a calendar
// moment only through tests/e2e/helpers/clock.ts (pinClock(page, at), before page.goto) or
// tests/presence/clock.mjs (pinClock(at), withClock(at, fn)), so there is one way to do it
// and one place that says how. This suite holds it:
//   1. no file under tests/e2e/ but the helper calls page.clock.setFixedTime( or
//      page.clock.install({ time }) itself (install() with no time, runFor, fastForward,
//      pauseAt, resume and setSystemTime drive timers or move a clock already set: they stay);
//   2. no file under tests/presence/ but clock.mjs swaps Date or Date.now by hand;
//   3. a browser spec that holds a calendar date (2026-11-15) and never calls pinClock is on
//      the "specs" list in real_clock_allowed.json, and the list only shrinks: a spec not on
//      it fails until it pins, and a listed one that pins now (or holds no date) fails until
//      it is taken off;
//   4. the same for pure suites ("suites"): one that holds a date and reads the real clock
//      (Date.now(), new Date()) without importing ./clock.mjs;
//   5. clock.mjs does what the suites rely on.
// The test files' own text is the contract here, so these checks read files on purpose
// (their number is in text_checks_allowed.json). --update writes today's lists down; a name
// added to a list belongs in the review of the change that adds it.
import { pinClock, withClock, PINNED_NOW, clockPinned } from './clock.mjs';

const HERE = new URL('./', import.meta.url);
const E2E = new URL('../e2e/', import.meta.url);
const LIST_FILE = new URL('real_clock_allowed.json', HERE);

let pass = 0, fail = 0;
const ok = (name, cond, note = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`); };

// What the rule looks for.
const DATE = /\b20\d\d-[01]\d-[0-3]\d/;                                                  // a calendar date written out
const SETS_PAGE_CLOCK = /\.clock\.(?:setFixedTime\s*\(|install\s*\(\s*\{\s*time\b)/;     // Playwright's clock set to a moment
const SWAPS_DATE = /(?<![\w$.])(?:(?:globalThis|window|self|global)\.)?Date(?:\.now)?\s*=(?![=>])/;   // the global clock swapped
const PINS_PAGE = /\bpinClock\s*\(/;
const READS_CLOCK = /\bDate\.now\s*\(\s*\)|\bnew\s+Date\s*\(\s*\)/;                       // the real clock: Date.now(), new Date()
const USES_CLOCK_MJS = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]\.\/clock\.mjs['"]/;

const read = (url) => Deno.readTextFileSync(url);
// Every script under a folder, as [its path inside the folder, its text]. golden/ holds
// rendered sites, not tests.
function scripts(dir, rel = '') {
  const out = [];
  for (const e of Deno.readDirSync(new URL(rel, dir))) {
    if (e.isDirectory && e.name !== 'golden' && e.name !== 'node_modules') out.push(...scripts(dir, rel + e.name + '/'));
    else if (e.isFile && /\.[cm]?[jt]s$/.test(e.name)) out.push([rel + e.name, read(new URL(rel + e.name, dir))]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
const linesOf = (text, re) => [...text.matchAll(new RegExp(re.source, 'g'))].map((m) => text.slice(0, m.index).split('\n').length).join(', ');

const e2e = scripts(E2E);
const specs = e2e.filter(([f]) => f.endsWith('.spec.ts'));
const suites = [...Deno.readDirSync(HERE)].map((e) => e.name).filter((f) => f.endsWith('_test.mjs')).sort().map((f) => [f, read(new URL(f, HERE))]);
const onRealClock = {
  specs: specs.filter(([, s]) => DATE.test(s) && !PINS_PAGE.test(s)).map(([f]) => f).sort(),
  suites: suites.filter(([, s]) => DATE.test(s) && READS_CLOCK.test(s) && !USES_CLOCK_MJS.test(s)).map(([f]) => f).sort(),
};

if (Deno.args.includes('--update')) {
  Deno.writeTextFileSync(LIST_FILE, JSON.stringify(onRealClock, null, 1) + '\n');
  console.log(`wrote ${onRealClock.specs.length} specs and ${onRealClock.suites.length} suites`);
  Deno.exit(0);
}

// ═══ 0. what the rule looks for, on made-up lines ═══
{
  const G = ['globalThis', 'Date'].join('.'), N = ['Date', 'now'].join('.');   // spliced, so this file doesn't trip its own rule
  ok('a page\'s clock set by hand is found', ["await page.clock.setFixedTime(new Date('2026-11-15T18:00:00Z'));", "await page.clock.install({ time: new Date('2026-11-10T09:00:00Z') });", 'await page.clock.install({time: t});', 'await page.clock.install({\n  time: t,\n});'].every((l) => SETS_PAGE_CLOCK.test(l)));
  ok('…but not the clock\'s timers, a clock already set, or pinClock', ['await page.clock.install();', 'await page.clock.runFor(5000);', 'await page.clock.fastForward(61_000);', 'await page.clock.setSystemTime(t);', "await pinClock(page, '2026-11-15T18:00:00Z');"].every((l) => !SETS_PAGE_CLOCK.test(l)));
  ok('a clock swapped by hand is found', [`${G} = class extends RealDate {};`, `${N} = () => NOW;`, 'Date' + ' = FixedDate;', `${G}.now = () => 1;`].every((l) => SWAPS_DATE.test(l)));
  ok('…but not a comparison, a name ending in Date, or keeping the real one', [`if (${G} === RealDate) {}`, 'const startDate = 1;', `const realNow = ${N};`, 'const RealDate = Date;'].every((l) => !SWAPS_DATE.test(l)));
  ok('a read of the real clock is Date.now() or new Date() with nothing in it', READS_CLOCK.test('const t = Date.now();') && READS_CLOCK.test('const d = new Date();') && !READS_CLOCK.test("new Date('2026-11-15')") && !READS_CLOCK.test('new RealDate()'));
  ok('a calendar date is a written-out day, not a version or a count', DATE.test("'2026-11-15T18:00:00Z'") && DATE.test('until: "2026-11-09"') && !DATE.test('v1.2026') && !DATE.test('12026-11-15'));
}

// ═══ 1. a browser test sets the page's clock only through pinClock ═══
{
  const helper = read(new URL('helpers/clock.ts', E2E));
  ok('the browser helper is where the page\'s clock is set', SETS_PAGE_CLOCK.test(helper));
  const byHand = e2e.filter(([f, s]) => f !== 'helpers/clock.ts' && SETS_PAGE_CLOCK.test(s));
  for (const [f, s] of byHand) ok(`tests/e2e/${f} sets the page's clock through pinClock`, false, `line ${linesOf(s, SETS_PAGE_CLOCK)}: use pinClock(page, at) from ./helpers/clock, with { ticking: true } for a clock that runs on`);
  ok('no browser test sets the page\'s clock to a moment by hand', byHand.length === 0);
}

// ═══ 2. a pure suite swaps the clock only through clock.mjs ═══
{
  const byHand = scripts(HERE).filter(([f, s]) => f !== 'clock.mjs' && SWAPS_DATE.test(s));
  for (const [f, s] of byHand) ok(`tests/presence/${f} pins the clock through clock.mjs`, false, `line ${linesOf(s, SWAPS_DATE)}: use pinClock(at) or withClock(at, fn) from ./clock.mjs`);
  ok('no pure suite swaps Date or Date.now by hand', byHand.length === 0);
}

// ═══ 3 and 4. specs and suites still on the real clock are listed, and the lists only shrink ═══
{
  const listed = JSON.parse(read(LIST_FILE));
  const RATCHET = {
    specs: { what: 'browser spec', where: 'tests/e2e/', why: 'holds a calendar date but never pins the clock', fix: 'call pinClock(page) from ./helpers/clock before page.goto, or pinClock(page, at) for another moment' },
    suites: { what: 'pure suite', where: 'tests/presence/', why: 'holds a calendar date and reads the real clock', fix: 'pin it with pinClock(at) or withClock(at, fn) from ./clock.mjs' },
  };
  for (const [kind, { what, where, why, fix }] of Object.entries(RATCHET)) {
    const list = listed[kind] || [];
    const now = new Set(onRealClock[kind]), allowed = new Set(list);
    const added = onRealClock[kind].filter((f) => !allowed.has(f));
    const offNow = list.filter((f) => !now.has(f));
    for (const f of added) ok(`${where}${f} pins its clock`, false, `it ${why}: ${fix}`);
    for (const f of offNow) ok(`${where}${f} is off the "${kind}" list`, false, `it pins its clock now, holds no date or is gone: take it off "${kind}" in tests/presence/real_clock_allowed.json (the list only shrinks)`);
    ok(`no ${what} off the list holds a date on the real clock`, added.length === 0);
    ok(`every ${what} on the list is still on the real clock, so the list only shrinks`, offNow.length === 0);
    ok(`the "${kind}" list is sorted, each name once`, list.every((f, i) => i === 0 || list[i - 1] < f));
  }
  console.log(`on the real clock: ${onRealClock.specs.length} of ${specs.length} browser specs, ${onRealClock.suites.length} of ${suites.length} pure suites`);
}

// ═══ 5. clock.mjs does what the suites rely on ═══
{
  const Real = globalThis.Date;
  const made = new Date('2026-01-02T03:04:05Z');   // made before the pin
  const at = Date.parse(PINNED_NOW);
  const restore = pinClock(PINNED_NOW);
  ok('pinned: new Date() and Date.now() are the pinned moment', new Date().getTime() === at && Date.now() === at && clockPinned());
  ok('pinned: Date() without new says the pinned moment, as text', typeof Date() === 'string' && Date() === new Real(at).toString());
  ok('pinned: new Date(x) is still x', new Date('2026-01-02T03:04:05Z').getTime() === made.getTime() && new Date(0).getTime() === 0 && new Date(2026, 0, 2).getDate() === 2);
  ok('pinned: Date.parse and Date.UTC still work', Date.parse('2026-01-02T00:00:00Z') === Date.UTC(2026, 0, 2));
  ok('pinned: a date made before the pin is still a Date, and so is a new one', made instanceof Date && new Date() instanceof Date && new Date(0) instanceof Real);
  restore();
  ok('restored: the real Date is back', globalThis.Date === Real && Date.now() !== at && !clockPinned());
}
{
  const Real = globalThis.Date;
  let inside = null, threw = null;
  try { await withClock('2026-11-15T18:00:00Z', () => { inside = Date.now(); throw new Error('stop'); }); } catch (e) { threw = e.message; }
  ok('withClock runs on the moment it is given', inside === Date.parse('2026-11-15T18:00:00Z'));
  ok('withClock puts the real clock back when the function throws, and the throw goes on', threw === 'stop' && globalThis.Date === Real && !clockPinned());
}

console.log(`\n════ CLOCK RULE: ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) Deno.exit(1);
