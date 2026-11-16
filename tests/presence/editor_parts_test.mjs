// ── The website editor in parts (builder item 38) ─────────────────────────────
// presence.html was one 1.5 MB file. Its styles are presence.css; its script is presence-core.js,
// loaded with the page, and presence-edit.js, Edit mode, loaded the first time it's wanted or once
// the page has settled. The two scripts share one global scope, so a name in presence-edit.js is
// there only once that part has loaded. This parses both and holds the rules that keep that safe:
//   • the page loads presence.css and presence-core.js, never presence-edit.js itself;
//   • presence-core.js uses nothing of presence-edit.js's except through a stand-in it declares,
//     and every name declared in both files is such a stand-in, a function in both;
//   • a stand-in's answer is never used straight away where it is called (before the part is in,
//     a door answers a promise and any other stand-in answers nothing), except where the list
//     below says why it's safe;
//   • each stand-in hands its call to the part's own function once the part is in;
//   • presence-edit.js says it is in only at its very end, after everything in it has run.
//   deno run --allow-read --allow-env --allow-net tests/presence/editor_parts_test.mjs
import * as acorn from 'https://cdn.jsdelivr.net/npm/acorn@8.14.0/dist/acorn.mjs';
import * as walk from 'https://cdn.jsdelivr.net/npm/acorn-walk@8.3.4/dist/walk.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };

const page = read('presence.html');
const core = read('presence-core.js'), edit = read('presence-edit.js');

// ═══ what the page loads ═══
ok('the page links presence.css in its head', /<head>[\s\S]*<link rel="stylesheet" href="\/presence\.css\?v=\d+">[\s\S]*<\/head>/.test(page));
ok('…and keeps no style sheet of its own', !/<style[\s>]/.test(page));
ok('the page loads presence-core.js after its markup, where its script was', /<script src="\/presence-core\.js\?v=\d+"><\/script>\s*<\/body>/.test(page));
ok('…and runs no script of its own', !/<script>/.test(page));
ok('the page never loads presence-edit.js itself: presence-core.js does, when it is wanted', !page.includes('presence-edit.js') && /DDS_PART_SRC = \{"edit":"\/presence-edit\.js\?v=\d+"\}/.test(core));

// ═══ the two scripts ═══
const parse = (s) => acorn.parse(s, { ecmaVersion: 2023, sourceType: 'script', locations: true });
const C = parse(core), E = parse(edit);
const declared = (ast) => {
  const fns = new Set(), other = new Set();
  for (const st of ast.body) {
    if (st.type === 'FunctionDeclaration') fns.add(st.id.name);
    else if (st.type === 'ClassDeclaration') other.add(st.id.name);
    else if (st.type === 'VariableDeclaration') for (const d of st.declarations) walk.full(d.id, (n) => { if (n.type === 'Identifier') other.add(n.name); });
  }
  return { fns, other, all: new Set([...fns, ...other]) };
};
const dc = declared(C), de = declared(E);
const STANDINS = new Set((core.match(/const DDS_STANDINS = new Set\(\[([^\]]*)\]\)/) || [, ''])[1].split(',').map((s) => s.trim()).filter(Boolean));
ok('presence-core.js lists its stand-ins', STANDINS.size > 10, String(STANDINS.size));
const both = [...de.all].filter((n) => dc.all.has(n));
ok('every name declared in both files is a stand-in', both.every((n) => STANDINS.has(n)), both.filter((n) => !STANDINS.has(n)).join(', '));
ok('…a function in both', both.every((n) => dc.fns.has(n) && de.fns.has(n)), both.filter((n) => !(dc.fns.has(n) && de.fns.has(n))).join(', '));
ok('every stand-in is one of presence-edit.js’s functions', [...STANDINS].every((n) => de.fns.has(n)), [...STANDINS].filter((n) => !de.fns.has(n)).join(', '));

// each stand-in hands its call on: the generated shape, or the one written out by hand
const standinBody = new Map();
for (const st of C.body) if (st.type === 'FunctionDeclaration' && STANDINS.has(st.id.name)) standinBody.set(st.id.name, core.slice(st.start, st.end));
const HAND_WRITTEN = { dcSavePendingEdits: /if \(!DDS_STANDINS\.has\(window\.dcSavePendingEdits\)\) return window\.dcSavePendingEdits\(keepSession\);/ };
for (const [n, body] of standinBody) {
  const shaped = new RegExp(`^function ${n}\\(\\.\\.\\.a\\) \\{ return ddsStub\\("edit", "${n}", a, (true|false)\\); \\}$`).test(body);
  ok(`stand-in ${n} hands its call to the part's own once it is in`, shaped || (HAND_WRITTEN[n] && HAND_WRITTEN[n].test(body)), body.slice(0, 160));
}

// ═══ presence-core.js reaches into presence-edit.js only through a stand-in ═══
const editOnly = new Set([...de.all].filter((n) => !STANDINS.has(n)));
const reached = [], usedNow = [];
// Uses whose answer is taken straight away, and why that is safe.
const SAFE = [
  // a door answers a promise of the switch's own answer, which Promise.resolve takes as it is
  'Promise.resolve(slug === DC_PAGE || dcSwitchPage(slug))',
];
const lines = core.split('\n');
for (const st of C.body) {
  if (st.type === 'FunctionDeclaration' && STANDINS.has(st.id.name)) continue;
  walk.ancestor(st, { Identifier(n, _s, anc) {
    const p = anc[anc.length - 2], pp = anc[anc.length - 3];
    if (p && p.type === 'MemberExpression' && p.property === n && !p.computed) return;
    if (p && p.type === 'Property' && p.key === n && !p.computed && !p.shorthand) return;
    if (p && (p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && p.key === n && !p.computed) return;
    // a local of the same name isn't the part's: only a name nothing in its function declares
    if (editOnly.has(n.name) && !shadowed(anc, n.name)) reached.push(`${n.name} at presence-core.js:${n.loc.start.line}`);
    if (!STANDINS.has(n.name) || shadowed(anc, n.name)) return;
    if (p.type === 'UnaryExpression' && p.operator === 'typeof') return;   // typeof X === "function": a stand-in is one
    if (p.type !== 'CallExpression' || p.callee !== n) return;              // passed as a handler: called later, through the stand-in
    const quiet = pp.type === 'ExpressionStatement' || (pp.type === 'AwaitExpression' && anc[anc.length - 4].type === 'ExpressionStatement')
      || (pp.type === 'ArrowFunctionExpression' && pp.body === p) || (pp.type === 'UnaryExpression' && pp.operator === 'void')
      || pp.type === 'SequenceExpression' || (pp.type === 'LogicalExpression' && pp.right === p && anc[anc.length - 4].type === 'ExpressionStatement');
    const door = /, true\); \}$/.test(standinBody.get(n.name) || '');
    const awaited = pp.type === 'AwaitExpression' || (pp.type === 'MemberExpression' && /^(then|catch|finally)$/.test(pp.property && pp.property.name));
    if (quiet || (door && awaited) || n.name === 'dcSavePendingEdits') return;   // the hand-written one answers as the real one does
    if (SAFE.some((s) => lines[n.loc.start.line - 1].includes(s))) return;
    usedNow.push(`${n.name} at presence-core.js:${n.loc.start.line}`);
  } });
}
function shadowed(anc, name) {
  for (const a of anc) {
    if ((a.type === 'FunctionDeclaration' || a.type === 'FunctionExpression' || a.type === 'ArrowFunctionExpression') && a.params.some((q) => { let hit = false; walk.full(q, (x) => { if (x.type === 'Identifier' && x.name === name) hit = true; }); return hit; })) return true;
    if (a.type === 'BlockStatement' || a.type === 'Program' || a.type === 'SwitchCase') {
      for (const s of a.body || a.consequent || []) {
        if (s.type === 'VariableDeclaration' && a.type !== 'Program') for (const d of s.declarations) { let hit = false; walk.full(d.id, (x) => { if (x.type === 'Identifier' && x.name === name) hit = true; }); if (hit) return true; }
        if (s.type === 'FunctionDeclaration' && a.type !== 'Program' && s.id.name === name) return true;
      }
    }
    if ((a.type === 'ForStatement' || a.type === 'ForOfStatement' || a.type === 'ForInStatement') && (a.init || a.left) && (a.init || a.left).type === 'VariableDeclaration') {
      for (const d of (a.init || a.left).declarations) { let hit = false; walk.full(d.id, (x) => { if (x.type === 'Identifier' && x.name === name) hit = true; }); if (hit) return true; }
    }
    if (a.type === 'CatchClause' && a.param) { let hit = false; walk.full(a.param, (x) => { if (x.type === 'Identifier' && x.name === name) hit = true; }); if (hit) return true; }
  }
  return false;
}
ok('presence-core.js uses nothing of presence-edit.js’s but its stand-ins', reached.length === 0, reached.slice(0, 12).join('; '));
ok('no stand-in’s answer is used straight away (a door’s may be awaited)', usedNow.length === 0, usedNow.slice(0, 12).join('; '));

// ═══ presence-edit.js says it is in only once everything in it has run ═══
const last = E.body[E.body.length - 1];
ok('the part’s last statement marks it in', last && edit.slice(last.start, last.end) === '(window.__ddsParts || (window.__ddsParts = {}))["edit"] = true;');
ok('…and nothing else marks it', (edit.match(/__ddsParts/g) || []).length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
