// ── The website editor in parts (builder item 38) ─────────────────────────────
// presence.html was one 1.5 MB file. Its styles are presence.css; its script is presence-core.js,
// loaded with the page, and presence-edit.js, Edit mode, loaded the first time it's wanted or once
// the page has settled. The two scripts share one global scope, so a name of presence-edit.js's
// exists only once that part has loaded. This parses both scripts and holds what keeps that safe:
//   • every name declared in both is one of the core's stand-ins, a function in both;
//   • presence-core.js uses nothing of presence-edit.js's except through a stand-in;
//   • a stand-in's answer is never used straight away where it's called (before the part is in, a
//     door answers a promise and any other stand-in answers nothing), except where SAFE says why;
//   • presence-edit.js marks itself in only with its last statement, after all of it has run.
// Then it runs the core's own loader and stand-ins against a pretend page: before the part is in,
// a door loads it and then answers with the part's own function, any other stand-in does nothing;
// once it's in, every stand-in hands its call straight to the part's own; a failed load can be
// tried again. (What the page loads, and when, is tests/e2e/editor-parts-38.spec.ts.)
//   deno run --allow-read --allow-env --allow-net tests/presence/editor_parts_test.mjs
import * as acorn from 'https://cdn.jsdelivr.net/npm/acorn@8.14.0/dist/acorn.mjs';
import * as walk from 'https://cdn.jsdelivr.net/npm/acorn-walk@8.3.4/dist/walk.mjs';

const ROOT = new URL('../../', import.meta.url);
const core = Deno.readTextFileSync(new URL('presence-core.js', ROOT));
const edit = Deno.readTextFileSync(new URL('presence-edit.js', ROOT));
let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };

const parse = (s) => acorn.parse(s, { ecmaVersion: 2023, sourceType: 'script', locations: true });
const C = parse(core), E = parse(edit);
const idsIn = (node) => { const out = []; walk.full(node, (x) => { if (x.type === 'Identifier') out.push(x.name); }); return out; };
const declared = (ast) => {
  const fns = new Set(), other = new Set();
  for (const st of ast.body) {
    if (st.type === 'FunctionDeclaration') fns.add(st.id.name);
    else if (st.type === 'ClassDeclaration') other.add(st.id.name);
    else if (st.type === 'VariableDeclaration') for (const d of st.declarations) idsIn(d.id).forEach((n) => (st.kind === 'var' ? fns : other).add(n));
  }
  return { fns, other, all: new Set([...fns, ...other]) };
};
const dc = declared(C), de = declared(E);
const topFn = (ast, name) => ast.body.find((s) => s.type === 'FunctionDeclaration' && s.id.name === name);
const topConst = (ast, name) => ast.body.find((s) => s.type === 'VariableDeclaration' && s.declarations.some((d) => d.id.name === name));

// the stand-ins: the names in `const DDS_STANDINS = new Set([...])`
const standinsDecl = topConst(C, 'DDS_STANDINS');
const STANDINS = new Set(standinsDecl ? standinsDecl.declarations[0].init.arguments[0].elements.map((e) => e.name) : []);
ok('presence-core.js lists its stand-ins', STANDINS.size > 10, String(STANDINS.size));
const both = [...de.all].filter((n) => dc.all.has(n));
ok('every name declared in both files is a stand-in', both.every((n) => STANDINS.has(n)), both.filter((n) => !STANDINS.has(n)).join(', '));
ok('…a function in both', both.every((n) => dc.fns.has(n) && de.fns.has(n)), both.filter((n) => !(dc.fns.has(n) && de.fns.has(n))).join(', '));
ok('every stand-in stands in for one of presence-edit.js’s functions', [...STANDINS].every((n) => de.fns.has(n) && dc.fns.has(n)), [...STANDINS].filter((n) => !de.fns.has(n)).join(', '));

// a stand-in is a door when its call passes `true` to ddsStub
const isDoor = (name) => {
  let door = null;
  walk.simple(topFn(C, name), { CallExpression(x) { if (x.callee.type === 'Identifier' && x.callee.name === 'ddsStub') door = x.arguments[3] && x.arguments[3].value === true; } });
  return door;
};

// ═══ presence-core.js reaches into presence-edit.js only through a stand-in ═══
const editOnly = new Set([...de.all].filter((n) => !STANDINS.has(n)));
const reached = [], usedNow = [];
// Uses whose answer is taken straight away, and why that is safe.
const SAFE = [
  // a door answers a promise of the page switch's own answer, which Promise.resolve takes as it is
  { name: 'dcSwitchPage', within: 'Promise.resolve' },
];
for (const st of C.body) {
  if (st.type === 'FunctionDeclaration' && STANDINS.has(st.id.name)) continue;
  walk.ancestor(st, { Identifier(n, _s, anc) {
    const p = anc[anc.length - 2], pp = anc[anc.length - 3];
    if (p && p.type === 'MemberExpression' && p.property === n && !p.computed) return;
    if (p && p.type === 'Property' && p.key === n && !p.computed && !p.shorthand) return;
    if (p && (p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && p.key === n && !p.computed) return;
    if (shadowed(anc, n.name)) return;   // a local of the same name isn't the part's
    if (editOnly.has(n.name)) reached.push(`${n.name} at presence-core.js:${n.loc.start.line}`);
    if (!STANDINS.has(n.name)) return;
    if (p.type === 'UnaryExpression' && p.operator === 'typeof') return;   // typeof X === "function": a stand-in is one
    if (p.type !== 'CallExpression' || p.callee !== n) return;              // a handler: called later, through the stand-in
    const quiet = pp.type === 'ExpressionStatement' || (pp.type === 'AwaitExpression' && anc[anc.length - 4].type === 'ExpressionStatement')
      || (pp.type === 'ArrowFunctionExpression' && pp.body === p) || (pp.type === 'UnaryExpression' && pp.operator === 'void')
      || pp.type === 'SequenceExpression' || (pp.type === 'LogicalExpression' && pp.right === p && anc[anc.length - 4].type === 'ExpressionStatement');
    const awaited = pp.type === 'AwaitExpression' || (pp.type === 'MemberExpression' && !pp.computed && /^(then|catch|finally)$/.test(pp.property.name));
    if (quiet || (isDoor(n.name) && awaited)) return;
    if (n.name === 'dcSavePendingEdits') return;   // its stand-in answers as the part's own does (driven below)
    const inside = anc.some((a) => a.type === 'CallExpression' && a.callee.type === 'MemberExpression' && a.callee.object.name === 'Promise' && a.callee.property.name === 'resolve');
    if (SAFE.some((s) => s.name === n.name && s.within === 'Promise.resolve' && inside)) return;
    usedNow.push(`${n.name} at presence-core.js:${n.loc.start.line}`);
  } });
}
function shadowed(anc, name) {
  const binds = (node) => node && idsIn(node).includes(name);
  for (const a of anc) {
    if ((a.type === 'FunctionDeclaration' || a.type === 'FunctionExpression' || a.type === 'ArrowFunctionExpression') && a.params.some(binds)) return true;
    if ((a.type === 'BlockStatement' || a.type === 'SwitchCase') && (a.body || a.consequent).some((s) => (s.type === 'VariableDeclaration' && s.declarations.some((d) => binds(d.id))) || (s.type === 'FunctionDeclaration' && s.id.name === name))) return true;
    if ((a.type === 'ForStatement' || a.type === 'ForOfStatement' || a.type === 'ForInStatement') && (a.init || a.left) && (a.init || a.left).type === 'VariableDeclaration' && (a.init || a.left).declarations.some((d) => binds(d.id))) return true;
    if (a.type === 'CatchClause' && binds(a.param)) return true;
  }
  return false;
}
ok('presence-core.js uses nothing of presence-edit.js’s but its stand-ins', reached.length === 0, reached.slice(0, 12).join('; '));
ok('no stand-in’s answer is used straight away (a door’s may be awaited)', usedNow.length === 0, usedNow.slice(0, 12).join('; '));

// ═══ presence-edit.js marks itself in with its last statement, and nowhere else ═══
const marks = [];
walk.simple(E, { AssignmentExpression(x) { if (x.left.type === 'MemberExpression' && x.left.computed && x.left.property.value === 'edit' && x.right.value === true) marks.push(x); } });
const last = E.body[E.body.length - 1];
ok('the part marks itself in once', marks.length === 1, String(marks.length));
ok('…with its last statement, after all of it has run', !!last && last.type === 'ExpressionStatement' && last.expression === marks[0]);

// ═══ the core's loader and stand-ins, run against a pretend page ═══
const nodeText = (n) => core.slice(n.start, n.end);
const pieces = ['ddsPartIn', 'ddsPart', 'ddsWith', 'ddsStub', ...STANDINS].map((n) => nodeText(topFn(C, n)));
const srcDecl = nodeText(topConst(C, 'DDS_PART_SRC'));
const names = [...STANDINS];
const make = new Function('window', 'document', 'toast', 'debounceFlush', [
  srcDecl, 'const DDS_PART_AT = {};', `const DDS_STANDINS = new Set([${names.join(', ')}]);`, ...pieces,
  `for (const n of ${JSON.stringify(names)}) window[n] = eval(n);`,
  'return { ddsPart, ddsWith, standins: new Map([...DDS_STANDINS].map((f) => [f.name, f])) };',
].join('\n'));
function pretendPage() {
  const added = [], toasts = [], flushed = [];
  const window = {};
  const document = { createElement: () => ({ remove() { this.removed = true; } }), head: { appendChild: (s) => added.push(s) } };
  const page = make(window, document, (m) => toasts.push(m), (k) => { flushed.push(k); return Promise.resolve(); });
  // the part arriving: its own functions replace the stand-ins, then it marks itself in
  const arrive = (own) => { for (const n of names) window[n] = own[n] || ((...a) => ({ own: n, args: a })); window.__ddsParts = { edit: true }; added[added.length - 1].onload(); };
  return { ...page, window, added, toasts, flushed, arrive };
}
const doors = names.filter((n) => isDoor(n) === true), skips = names.filter((n) => isDoor(n) === false);
ok('the stand-ins are doors and do-nothings, and only dcSavePendingEdits is written out by hand', doors.length > 5 && skips.length > 5 && names.filter((n) => isDoor(n) === null).join() === 'dcSavePendingEdits', names.filter((n) => isDoor(n) === null).join());
const tick = () => new Promise((r) => setTimeout(r, 0));
{
  const pg = pretendPage();
  const door = doors[0], skip = skips[0];
  ok(`before the part is in, a do-nothing (${skip}) does nothing and loads nothing`, pg.window[skip]('x') === undefined && pg.added.length === 0);
  const answer = pg.window[door]('a', 2);
  ok(`before the part is in, a door (${door}) loads it and answers a promise`, pg.added.length === 1 && pg.added[0].src === '/presence-edit.js?v=1' && answer instanceof Promise);
  const again = pg.window[doors[1]]();
  ok('a second door while it loads asks for it once', pg.added.length === 1);
  pg.arrive({});
  const got = await answer; await again;
  ok('…and once it’s in, the door runs the part’s own function with what it was given', got && got.own === door && JSON.stringify(got.args) === '["a",2]', JSON.stringify(got));
  // a stand-in a handler held on to goes straight to the part's own now
  const held = pg.standins.get(skip);
  const r = held('y', 3);
  ok('once it’s in, every stand-in hands its call straight to the part’s own', r && r.own === skip && JSON.stringify(r.args) === '["y",3]' && pg.added.length === 1, JSON.stringify(r));
  let ran = 0; pg.ddsWith('edit', () => { ran++; });
  ok('ddsWith runs at once when the part is in', ran === 1);
}
{
  const pg = pretendPage();
  let ran = 0; pg.ddsWith('edit', () => { ran++; });
  ok('ddsWith waits for the part', ran === 0 && pg.added.length === 1);
  pg.arrive({}); await tick(); await tick();
  ok('…and runs once it is in', ran === 1);
}
{
  const pg = pretendPage();
  const answer = pg.window[doors[0]]();
  pg.added[0].onerror();
  let refused = false; try { await answer; } catch { refused = true; }
  ok('a part that doesn’t load: the door says so', refused && pg.toasts.length === 1 && /didn’t load/.test(pg.toasts[0]) && pg.added[0].removed === true);
  await tick();
  const second = pg.window[doors[0]]('b');
  ok('…and the next try loads it again', pg.added.length === 2);
  pg.arrive({}); const got = await second;
  ok('…and goes through', got && got.own === doors[0]);
}
{
  const pg = pretendPage();
  const saved = await pg.window.dcSavePendingEdits();
  ok('before the part is in, saving what waits flushes the Business tab’s typing and answers “saved”', saved === true && pg.flushed.join() === 'identity:,location:' && pg.added.length === 0, `${saved} ${pg.flushed}`);
  pg.window.__ddsParts = { edit: true };
  pg.window.dcSavePendingEdits = (k) => `own ${k}`;
  ok('…once it’s in, the part’s own runs', (await pg.standins.get('dcSavePendingEdits')('keep')) === 'own keep');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
