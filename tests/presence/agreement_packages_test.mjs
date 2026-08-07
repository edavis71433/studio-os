// ── One agreement per package ────────────────────────────────────────────────
// Eric's agreement used to be ONE template whose cover page hardcoded
// "Package: Custom + Photography" and carried that package's what's-included
// lists. Every deal got that document, whatever was actually sold — so a Growth
// client signed a page promising art-directed photography they were never
// buying, and a salon could have been handed a restaurant's scope.
//
// pipeline.html now ships an ORDERED MAP of package → { label, cover, scope,
// body }. The two things that matter, and that this suite pins:
//
//   1. The legal terms (sections 1-19) are ONE shared const, spliced into every
//      package's body. Not copies. Copies drift, and a drifted §12 kill fee in
//      one package and not the other is a legal difference nobody chose.
//   2. The scope of work lives INSIDE the agreement — one document, one
//      signature — and the Growth scope is the standard skeleton Eric wrote,
//      verbatim, with its [BRACKETED] fill-in points intact so he can complete
//      them per client. A salon must never receive Tock reservations.
//
// The block is EXTRACTED FROM pipeline.html AND EXECUTED (the idiom of
// doc_placeholders_test.mjs §7), so a regex can't be satisfied by text that
// doesn't actually assemble.
//
//   deno run --allow-read tests/presence/agreement_packages_test.mjs
import { buildPlaceholderValues, applyPlaceholders, PLACEHOLDER_TOKENS } from '../../supabase/functions/presence/lib/doc_placeholders.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const pipe = Deno.readTextFileSync(new URL('../../pipeline.html', import.meta.url));
const SCOPE = Deno.readTextFileSync(new URL('./fixtures/scope-growth.txt', import.meta.url)).replace(/\n+$/, '');

// ═══ 0. Extract + execute the package block ═══
const START = '/* ==== agreement packages: start';
const END = '/* ==== agreement packages: end ==== */';
let PKGS = null, LEGAL = '', unfilledBlanks = null;
{
  const a = pipe.indexOf(START), b = pipe.indexOf(END);
  ok('pipeline.html carries the extractable agreement-packages block', a >= 0 && b > a, `${a} → ${b}`);
  if (a >= 0 && b > a) {
    const src = pipe.slice(a, b);
    const mod = new Function(`${src}\nreturn { DDS_AGREEMENT_PACKAGES, DDS_AGREEMENT_LEGAL, DDS_PACKAGE_KEYS, unfilledBlanks };`)();
    PKGS = mod.DDS_AGREEMENT_PACKAGES; LEGAL = mod.DDS_AGREEMENT_LEGAL; unfilledBlanks = mod.unfilledBlanks;
    ok('the block EXECUTES and yields the package map', !!PKGS && typeof PKGS === 'object');
    ok('DDS_PACKAGE_KEYS is the map’s key order', JSON.stringify(mod.DDS_PACKAGE_KEYS) === JSON.stringify(Object.keys(PKGS)));
  }
}
if (!PKGS) { console.log('\n════ AGREEMENT PACKAGES: extraction FAILED ════'); Deno.exit(1); }

const KEYS = Object.keys(PKGS);

// ═══ 1. The shipped set ═══
{
  ok('exactly the two packages Eric has content for ship', JSON.stringify(KEYS) === JSON.stringify(['growth', 'custom_photo']), KEYS.join(','));
  ok('growth is labelled “Growth”', PKGS.growth.label === 'Growth', PKGS.growth.label);
  ok('custom_photo is labelled “Custom + Photography”', PKGS.custom_photo.label === 'Custom + Photography', PKGS.custom_photo.label);
  ok('every package has a label and a non-stub body', KEYS.every((k) => PKGS[k].label && PKGS[k].body && PKGS[k].body.length > 10000),
    KEYS.map((k) => `${k}:${(PKGS[k].body || '').length}`).join(' '));
  ok('every body stays inside the server’s clean(b.body, 50000) cap', KEYS.every((k) => PKGS[k].body.length <= 50000),
    KEYS.map((k) => `${k}:${PKGS[k].body.length}`).join(' '));
}

// ═══ 2. The legal terms are SHARED, not copied ═══
// Byte-identity is the assertion. Two packages whose §1-19 differ by so much as
// a space are two different contracts, and nobody chose the difference.
{
  ok('the shared legal const carries all 19 sections, numbered once each', (() => {
    const heads = [...LEGAL.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    return heads.length === 19 && heads.every((n, i) => n === i + 1);
  })(), [...LEGAL.matchAll(/^(\d+)\. /gm)].map((m) => m[1]).join(','));
  ok('the shared legal const opens at PROJECT AGREEMENT and closes at the signature block',
    LEGAL.startsWith('PROJECT AGREEMENT\n\n') && /Date: _+ +Date: _+$/.test(LEGAL));

  // Each body must CONTAIN the shared const, at exactly one place, byte for byte.
  for (const k of KEYS) {
    const parts = PKGS[k].body.split(LEGAL);
    ok(`${k}: the legal terms appear byte-identically, exactly once`, parts.length === 2, `${parts.length - 1} occurrence(s)`);
    ok(`${k}: the legal terms are the TAIL of the document`, parts.length === 2 && parts[1] === '');
  }
  // …and cross-package: slice §1-19 out of each body and demand equality.
  const legalOf = (k) => PKGS[k].body.slice(PKGS[k].body.indexOf('PROJECT AGREEMENT\n\n'));
  const first = legalOf(KEYS[0]);
  ok('every package’s §1-19 is byte-identical to every other’s', KEYS.every((k) => legalOf(k) === first),
    KEYS.map((k) => `${k}:${legalOf(k).length}`).join(' '));
  ok('the legal text is stored ONCE in pipeline.html (not pasted per package)',
    (pipe.match(/This Project Agreement \("Agreement"\) is entered into between/g) || []).length === 1);
}

// ═══ 3. Covers — each names ITS OWN package, and only tokens the filler knows ═══
{
  for (const k of KEYS) {
    const m = PKGS[k].body.match(/^Package: +(.+)$/m);
    ok(`${k}: the cover’s “Package:” line reads exactly its label`, !!m && m[1].trim() === PKGS[k].label, m ? m[1].trim() : 'no Package: line');
    ok(`${k}: the letterhead is the tenant’s own name (token, not a hardcode)`, PKGS[k].body.startsWith('{{studio_name_upper}}\nProject Agreement & Scope of Work\n'));
    ok(`${k}: NO hardcoded studio identity survives`, !/Davis Digital Studio/i.test(PKGS[k].body) && !/Eric Davis/.test(PKGS[k].body));
    ok(`${k}: the SAMPLE disclaimer is nowhere in the body`, !/\bSAMPLE\b/.test(PKGS[k].body) && !/SAMPLE — for review/.test(PKGS[k].body));
    ok(`${k}: every {{token}} the agreement uses is one the filler knows`, (() => {
      const used = [...new Set([...PKGS[k].body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((x) => x[1]))];
      return used.length > 0 && used.every((t) => PLACEHOLDER_TOKENS.includes(t));
    })(), [...new Set([...PKGS[k].body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((x) => x[1]))].join(','));
    // and after filling, a client sees no raw token anywhere
    const filled = applyPlaceholders(PKGS[k].body, buildPlaceholderValues({
      deal: { title: 'Acme website', expected_value_cents: 500000 }, contact: { name: 'Sam', company: 'Acme' },
      studioName: 'Northwind Web Co.', now: new Date(Date.UTC(2026, 7, 7, 12, 0, 0)),
    }));
    ok(`${k}: a filled body carries no literal {{token}}`, !/\{\{/.test(filled));
    ok(`${k}: a filled body never names another studio`, !/Davis Digital Studio/i.test(filled) && filled.startsWith('NORTHWIND WEB CO.\n'));
  }
  // One package must never carry another's cover promises.
  ok('the Growth cover does not promise Custom + Photography’s art-directed photography',
    !/Art-directed photography direction/.test(PKGS.growth.body.slice(0, PKGS.growth.body.indexOf('PROJECT AGREEMENT\n\n'))));
  ok('the Custom + Photography body carries no Growth scope of work', !/SCOPE OF WORK — GROWTH PACKAGE/.test(PKGS.custom_photo.body));
}

// ═══ 4. custom_photo is the OLD template, unchanged ═══
// This was a carry-over, not a rewrite: the body must equal the template that
// shipped before the split, byte for byte.
{
  const snap = Deno.readTextFileSync(new URL('./fixtures/agreement-custom-photo.txt', import.meta.url)).replace(/\n+$/, '');
  ok('custom_photo’s body is byte-identical to the pre-split DDS_CONTRACT_TEMPLATE', PKGS.custom_photo.body === snap,
    PKGS.custom_photo.body === snap ? '' : `${PKGS.custom_photo.body.length} vs ${snap.length}`);
}

// ═══ 5. Growth carries Eric's scope of work, VERBATIM ═══
{
  const g = PKGS.growth.body;
  ok('the Growth body contains the scope of work verbatim, in one piece', g.includes(SCOPE), `scope ${SCOPE.length} chars`);
  ok('the scope sits BETWEEN the cover and the legal terms — one document, one signature', (() => {
    const s = g.indexOf(SCOPE), l = g.indexOf('PROJECT AGREEMENT\n\n');
    return s > 0 && l > s && g.slice(0, s).includes('Package:        Growth');
  })());
  ok('the scope opens with its own heading', SCOPE.startsWith('SCOPE OF WORK — GROWTH PACKAGE'));
  ok('the scope’s 11 numbered sections are all present, in order', (() => {
    const want = ['1. THE PACKAGE', '2. WHAT GETS BUILT', '3. SITE MAP', '4. WHAT IS NOT INCLUDED', '5. WHAT YOU PROVIDE',
      '6. REVISIONS AND CHANGES', '7. PROCESS AND TIMELINE', '8. PAYMENT AND THIRD PARTY COSTS',
      '9. LAUNCH, ACCEPTANCE, AND SUPPORT', '10. ABOUT SEARCH RESULTS', '11. SCOPE ACKNOWLEDGMENT'];
    let at = -1;
    return want.every((h) => { const i = g.indexOf('\n' + h + '\n'); if (i <= at) return false; at = i; return true; });
  })());
  ok('the scope’s opening sentence is verbatim', g.includes('This document defines exactly what is being built, what it costs, what each of us is responsible for, and how the project runs from start to finish.'));
  ok('the scope’s closing sentence is verbatim', g.includes('The legal terms that govern the work follow below.'));
  ok('the scope’s fee lines use the deal tokens, not typed-in numbers',
    g.includes('Growth package, one time project fee                    {{deal_value}}')
    && g.includes('Deposit due at signing, 50 percent                      {{deposit_amount}}')
    && g.includes('Balance due at launch, 50 percent                       {{balance_amount}}'));
  ok('the six-month search-results honesty paragraph survived', g.includes('Realistically it takes about six months before you see a meaningful change'));
}

// ═══ 6. The fill-in blanks ═══
// The Growth skeleton is general prose + industry-specific BLANKS Eric completes
// per client. They must survive into the shipped body (so he sees them), and the
// detector must find them WITHOUT mistaking the filler's own honest fallbacks
// ([project fee]) or the signature block's [Client Name / Title] for one.
{
  ok('unfilledBlanks() is exported by the block', typeof unfilledBlanks === 'function');
  const found = unfilledBlanks(PKGS.growth.body);
  ok('the Growth body ships all 25 fill-in blanks', found.length === 25, `${found.length} found`);
  ok('the blanks are the industry-specific ones', found.includes('[PLATFORM]') && found.includes('[LIST THE FIVE CORE PAGES]')
    && found.includes('[REVENUE PAGE 1]') && found.includes('[CITY OR MARKET]'));
  ok('custom_photo has no fill-in blanks at all', unfilledBlanks(PKGS.custom_photo.body).length === 0,
    unfilledBlanks(PKGS.custom_photo.body).join(','));
  // the filler's honest degradations are NOT blanks — a deal with no value would
  // otherwise nag about "[project fee]", which the operator is not meant to type over
  const bare = applyPlaceholders(PKGS.custom_photo.body, buildPlaceholderValues({ deal: {}, contact: null, studioName: 'X', now: new Date() }));
  ok('[project fee] / [50% deposit] / [50% balance] are not counted as blanks', unfilledBlanks(bare).length === 0, unfilledBlanks(bare).join(','));
  ok('[Client Name / Title] in the signature block is not counted as a blank', unfilledBlanks('\n{{studio_name}}       [Client Name / Title]').length === 0);
  ok('a completed Growth body reports zero blanks', unfilledBlanks(PKGS.growth.body.replace(/\[[A-Z]{2}[^\]\n]*\]/g, 'Squarespace')).length === 0);
  ok('the detector is not fooled by a bracket that never closes', unfilledBlanks('[UNCLOSED and then a new line\nplain text').length === 0);
}

// ═══ 7. The page offers the choice, and the send-time guard exists ═══
{
  ok('the agreement form offers a package chooser', /id\s*=\s*'conPkg'/.test(pipe) && /DDS_PACKAGE_KEYS\.map/.test(pipe));
  ok('precedence is unchanged: restored draft → saved template → the chosen package’s body',
    /api\('\/sales\/templates\?with_body=contract'\)/.test(pipe) && /fillDocPlaceholders\(DDS_AGREEMENT_PACKAGES\[/.test(pipe));
  ok('the send paths run the unfilled-blanks guard', (pipe.match(/confirmBlanks\(/g) || []).length >= 3);
  ok('the guard is a confirm, never a hard block', /function confirmBlanks\(/.test(pipe) && /confirm\(/.test(pipe.slice(pipe.indexOf('function confirmBlanks('), pipe.indexOf('function confirmBlanks(') + 900)));
  ok('the retired single-template const is gone', !/DDS_CONTRACT_TEMPLATE/.test(pipe));
  ok('the Template-build tier is left as a documented extension point, not invented',
    /Template build/i.test(pipe) && !/template_build\s*:\s*\{\s*label/.test(pipe));
}

const passed = results.filter((r) => r.p).length;
const failed = results.length - passed;
console.log(`\n════ AGREEMENT PACKAGES: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''} ════`);
if (failed) Deno.exit(1);
