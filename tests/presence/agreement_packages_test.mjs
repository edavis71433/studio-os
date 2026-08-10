// ── One agreement per package ────────────────────────────────────────────────
// Eric's agreement used to be ONE template whose cover page hardcoded
// "Package: Custom + Photography" and carried that package's what's-included
// lists. Every deal got that document, whatever was actually sold — so a Growth
// client signed a page promising art-directed photography they were never
// buying, and a salon could have been handed a restaurant's scope.
//
// pipeline.html now ships an ORDERED MAP of package → { label, cover, scope,
// body } — Growth, Custom + Photography, and Template build. The things that
// matter, and that this suite pins:
//
//   1. The legal terms (sections 1-19) are ONE shared const, spliced into every
//      package's body. Not copies. Copies drift, and a drifted §12 kill fee in
//      one package and not the other is a legal difference nobody chose.
//   2. Every scope of work lives INSIDE the agreement — one document, one
//      signature — built on the standard 11-section skeleton Eric wrote:
//      general prose verbatim, with [BRACKETED] fill-in points intact so he can
//      complete them per client. A salon must never receive Tock reservations.
//   3. Every promise traces to a document Eric published (the Bacchus Growth
//      scope, the Custom + Photography docx, or the marketing site) — and every
//      money figure prints THROUGH the placeholders, never as a typed number.
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
const coverAndScopeOf = (k) => PKGS[k].body.slice(0, PKGS[k].body.indexOf('PROJECT AGREEMENT\n\n'));

// ═══ 1. The shipped set ═══
{
  ok('exactly the three published packages ship, in offer order', JSON.stringify(KEYS) === JSON.stringify(['growth', 'custom_photography', 'template_build']), KEYS.join(','));
  ok('growth is labelled “Growth”', PKGS.growth.label === 'Growth', PKGS.growth.label);
  ok('custom_photography is labelled “Custom + Photography”', PKGS.custom_photography.label === 'Custom + Photography', PKGS.custom_photography.label);
  ok('template_build is labelled “Template build”', PKGS.template_build.label === 'Template build', PKGS.template_build.label);
  ok('every package has a label and a non-stub body', KEYS.every((k) => PKGS[k].label && PKGS[k].body && PKGS[k].body.length > 10000),
    KEYS.map((k) => `${k}:${(PKGS[k].body || '').length}`).join(' '));
  ok('every body stays inside the server’s clean(b.body, 50000) cap', KEYS.every((k) => PKGS[k].body.length <= 50000),
    KEYS.map((k) => `${k}:${PKGS[k].body.length}`).join(' '));
  ok('every package now carries a scope of work (the Template-build debt is paid)', KEYS.every((k) => PKGS[k].scope && PKGS[k].scope.length > 5000),
    KEYS.map((k) => `${k}:${(PKGS[k].scope || '').length}`).join(' '));
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
  // One package must never carry another's promises.
  ok('the Growth body does not promise Custom + Photography’s art-directed photography',
    !/Art-directed photography/.test(PKGS.growth.body.slice(0, PKGS.growth.body.indexOf('PROJECT AGREEMENT\n\n'))));
  ok('the Template build body does not promise art-directed photography either', !/Art-directed photography/.test(coverAndScopeOf('template_build')));
  ok('the Custom + Photography body carries no Growth scope of work', !/SCOPE OF WORK — GROWTH PACKAGE/.test(PKGS.custom_photography.body));
  ok('the Template build body carries neither of the other scopes',
    !/SCOPE OF WORK — GROWTH PACKAGE/.test(PKGS.template_build.body) && !/SCOPE OF WORK — CUSTOM \+ PHOTOGRAPHY PACKAGE/.test(PKGS.template_build.body));
  ok('only Growth promises revenue pages — its distinguishing section', /REVENUE PAGES/.test(PKGS.growth.body)
    && !/REVENUE PAGES/.test(PKGS.custom_photography.body) && !/REVENUE PAGES/.test(PKGS.template_build.body));
}

// ═══ 4. The two newer packages carry their sourced content ═══
// custom_photography: the docx's Project Summary lists on the cover, its §1
// copywriting promise (up to seven core pages) in the scope, and the crisp
// docx distinction — photography DIRECTION is included, SHOOT COSTS are not.
// template_build: the tier as published (pricing-estimator.html's starter
// tier), with SEO only as a bracketed optional block — the $800 add-on
// decision is still open with Eric, so no baked-in SEO promise.
{
  const cp = PKGS.custom_photography.body, cpScope = coverAndScopeOf('custom_photography');
  ok('custom_photography: the docx included-list opens the cover', cp.includes('WHAT\'S INCLUDED IN THIS PACKAGE\n\nBespoke custom website design (not a template), art-directed to the brand\nArt-directed photography direction for a distinctive, professional look'));
  ok('custom_photography: the docx not-included list is on the cover, shoot costs and all', cp.includes('NOT INCLUDED (QUOTED SEPARATELY IF NEEDED)\n\nOngoing website support / maintenance (available as a monthly plan)\nPaid advertising management (Google Ads, social ads)\nCustom photography shoot costs (photographer fees, location, talent)\nCopywriting beyond standard page content, e-commerce, or custom integrations'));
  ok('custom_photography: its scope opens with its own heading', cp.includes('SCOPE OF WORK — CUSTOM + PHOTOGRAPHY PACKAGE'));
  ok('custom_photography: photography DIRECTION is the deliverable — the shoot itself is excluded, crisply',
    cpScope.includes('This scope covers photography direction: the art direction and the shot list. It does not include the shoot itself. Photographer fees, location, and talent are not part of the project fee — they are quoted separately if needed.'));
  ok('custom_photography: the docx §1 copywriting promise (typically up to seven core pages) is in the scope',
    cpScope.includes('typically up to seven pages, such as Home, About, Services, Contact, and related core pages'));
  ok('custom_photography: the 30-day post-launch check-in survives (docx), and support stays a separate monthly plan',
    cpScope.includes('A 30-day post-launch check-in is included.') && cpScope.includes('available as a separate monthly plan'));
  ok('custom_photography: two rounds PER MAJOR DELIVERABLE, matching Agreement §3',
    cpScope.includes('Two rounds of revisions per major deliverable are included. The major deliverables are the initial design concept, the built-out pages before launch, and the final pre-launch site'));

  const tb = PKGS.template_build.body, tbScope = coverAndScopeOf('template_build');
  ok('template_build: its scope opens with its own heading', tb.includes('SCOPE OF WORK — TEMPLATE BUILD PACKAGE'));
  ok('template_build: the published tier’s shape — template on the fitting platform, up to five pages, one revision round, walkthrough video',
    tbScope.includes('[PLATFORM — the platform that fits your business]') && tbScope.includes('[LIST THE PAGES — up to five]')
    && tbScope.includes('One revision round — One round of consolidated feedback before launch.') && tbScope.includes('Launch walkthrough video'));
  ok('template_build: basic on-page SEO + Analytics + Search Console are the ONLY unconditional SEO promises',
    tbScope.includes('Basic on-page SEO — Page titles and meta descriptions set up on every page.')
    && tbScope.includes('Google Analytics setup') && tbScope.includes('Google Search Console setup'));
  ok('template_build: SEO strategy appears ONLY as the bracketed optional block (the $800 add-on decision is still open)',
    tbScope.includes('[OPTIONAL SEO STRATEGY ADD-ON — only if the proposal includes it: keyword research, competitor analysis, and a content roadmap. Delete this line if it was not part of the proposal.]')
    && !/keyword research/i.test(tbScope.replace(/\[[A-Z]{2}[^\]\n]*\]/g, '').replace(/- Keyword research, competitor analysis, or an SEO content roadmap, unless the proposal includes the SEO strategy add-on named in section 2\./, '')));
  ok('template_build: no Growth-only promises leak in (keyword research row, SEMrush, GBP optimization, monthly reporting)',
    !/SEMrush/.test(tb) && !/Google Business Profile optimization/.test(tbScope) && !/Monthly traffic and lead report/.test(tbScope));
  ok('template_build: the post-launch fix window is a bracketed decision, not an invented promise',
    tbScope.includes('[POST-LAUNCH FIX WINDOW — state it here if offered'));
  ok('template_build: the search-results honesty does NOT claim keywords the tier never bought',
    tbScope.includes('It will be faster, readable by Google, and correctly structured. That part is immediate.')
    && !tbScope.includes('built around real keywords'));
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

  // The general clauses folded in from Eric's Bacchus scope — verbatim.
  ok('§5: the content-fourteen-days rule is in, verbatim', g.includes('Content delivery is the single most common cause of delay on projects like this. If content is more than fourteen days late, the launch date moves accordingly. This is not a penalty. It is simply what happens when there is nothing to build with.'));
  ok('§5: timely feedback + the single named approver are listed', g.includes('- Timely review and feedback at each revision round.') && g.includes('- A single named person authorized to approve work and give final sign off.'));
  ok('§5: Google Business Profile access is asked for (its optimization is in scope)', g.includes('- Access to your Google Business Profile, or authorization for me to claim it on your behalf.'));
  ok('§6: the piecemeal-feedback rule is in, verbatim', g.includes('Feedback sent piecemeal after a round has closed counts toward the next round. Additional rounds beyond the two included are billable and will be quoted and approved in writing before any work begins.'));
  ok('§6: the gather-your-notes sentence is in, verbatim', g.includes('Please gather your notes, and any notes from anyone else whose opinion matters, and send them together.'));
  ok('§6: out-of-scope does not get absorbed — verbatim', g.includes('Anything not described in this document is out of scope. If you decide you want it, it does not simply get absorbed into the project.'));
  ok('§6: “This is not me being rigid” keeps Eric’s voice', g.includes('This is not me being rigid. It is how the fixed fee stays fixed and the launch date stays real.'));
  ok('§1: the fixed-fee sentence is verbatim', g.includes('The project fee is fixed. It does not change based on how many hours the work takes.'));
  ok('§9: the fourteen-day broken-means-broken window is verbatim', g.includes('For fourteen days after launch I will fix, at no charge, anything that is broken or does not work as described in this document. Broken means broken.'));
  ok('§2: the included-automatically-through-the-platform list survives, generalized', g.includes('Included automatically through the platform, with no setup required: mobile responsiveness, SSL padlock, XML sitemap and robots file, and fast load speed through a global content delivery network.'));
}

// ═══ 6. Nothing Bacchus-specific ships in ANY template ═══
// The load-bearing separation: Bacchus facts (Tock, wine club, Squarespace,
// Pasadena, $3,200) exist only in Eric's signed Bacchus documents — the
// templates carry [BRACKETED] fill-ins in their place. Bracketed EXAMPLES
// ("e.g. Tock, Calendly") are allowed: they are instructions to Eric that the
// blank-warning stops from ever reaching a client.
{
  const BLANK = /\[[A-Z]{2}[^\]\n]*\]/g;
  for (const k of KEYS) {
    const outsideBrackets = PKGS[k].body.replace(BLANK, '');
    const BACCHUS = /\bTock\b|Bacchus|bacchuskitchen|Squarespace|Pasadena|wine\s?club|Old Town|\bWix\b/i;
    ok(`${k}: no Bacchus-specific fact outside a bracketed fill-in`, !BACCHUS.test(outsideBrackets),
      (outsideBrackets.match(BACCHUS) || []).join(','));
    // Every money figure on the cover + scope prints THROUGH the placeholders.
    // (§2/§3 of the legal terms carry the $95/hour rate and late interest — those
    // are terms Eric transcribed, not deal figures, and live past this slice.)
    const cs = coverAndScopeOf(k);
    ok(`${k}: no typed-in dollar figure ahead of the legal terms — placeholders carry the money`, !/\$\d/.test(cs), (cs.match(/[^\n]*\$\d[^\n]*/) || []).join(' | '));
    ok(`${k}: the deal tokens all appear in the cover/scope`, ['{{deal_value}}', '{{deposit_amount}}', '{{balance_amount}}'].every((t) => cs.includes(t)));
  }
}

// ═══ 7. The fill-in blanks ═══
// Every scope is general prose + industry-specific BLANKS Eric completes per
// client. They must survive into the shipped body (so he sees them), and the
// detector must find them WITHOUT mistaking the filler's own honest fallbacks
// ([project fee]) or the signature block's [Client Name / Title] for one.
{
  ok('unfilledBlanks() is exported by the block', typeof unfilledBlanks === 'function');
  const counts = Object.fromEntries(KEYS.map((k) => [k, unfilledBlanks(PKGS[k].body).length]));
  ok('the Growth body ships all 26 fill-in blanks', counts.growth === 26, `${counts.growth} found`);
  ok('the Custom + Photography body ships all 24 fill-in blanks', counts.custom_photography === 24, `${counts.custom_photography} found`);
  ok('the Template build body ships all 23 fill-in blanks', counts.template_build === 23, `${counts.template_build} found`);
  const found = unfilledBlanks(PKGS.growth.body);
  ok('the Growth blanks are the industry-specific ones', found.includes('[PLATFORM]') && found.includes('[LIST THE FIVE CORE PAGES]')
    && found.includes('[REVENUE PAGE 1]') && found.includes('[CITY OR MARKET]') && found.includes('[MONTH YEAR]'));
  ok('the Custom + Photography blanks include its industry fill-ins', (() => {
    const b = unfilledBlanks(PKGS.custom_photography.body);
    return b.includes('[ANY INDUSTRY-SPECIFIC PAGE OR FEATURE FROM THE PROPOSAL]') && b.includes('[CITY OR MARKET]') && b.includes('[HOSTING OR PLATFORM SUBSCRIPTION]');
  })());
  ok('the Template build blanks include the open decisions (SEO add-on, fix window, copy)', (() => {
    const b = unfilledBlanks(PKGS.template_build.body);
    return b.some((x) => x.startsWith('[OPTIONAL SEO STRATEGY ADD-ON')) && b.some((x) => x.startsWith('[POST-LAUNCH FIX WINDOW'))
      && b.some((x) => x.startsWith('[WHO WRITES THE PAGE COPY'));
  })());
  // the filler's honest degradations are NOT blanks — a deal with no value would
  // otherwise nag about "[project fee]", which the operator is not meant to type over
  const bare = applyPlaceholders(LEGAL, buildPlaceholderValues({ deal: {}, contact: null, studioName: 'X', now: new Date() }));
  ok('[project fee] / [50% deposit] / [50% balance] are not counted as blanks', unfilledBlanks(bare + ' [project fee] [50% deposit] [50% balance]').length === 0);
  ok('[Client Name / Title] in the signature block is not counted as a blank', unfilledBlanks('\n{{studio_name}}       [Client Name / Title]').length === 0);
  for (const k of KEYS) ok(`a completed ${k} body reports zero blanks`, unfilledBlanks(PKGS[k].body.replace(/\[[A-Z]{2}[^\]\n]*\]/g, 'Filled')).length === 0);
  ok('the detector is not fooled by a bracket that never closes', unfilledBlanks('[UNCLOSED and then a new line\nplain text').length === 0);
}

// ═══ 8. The page offers the choice, and the send-time guard exists ═══
{
  ok('the agreement form offers a package chooser', /id\s*=\s*'conPkg'/.test(pipe) && /DDS_PACKAGE_KEYS\.map/.test(pipe));
  ok('precedence is unchanged: restored draft → saved template → the chosen package’s body',
    /api\('\/sales\/templates\?with_body=contract'\)/.test(pipe) && /fillDocPlaceholders\(DDS_AGREEMENT_PACKAGES\[/.test(pipe));
  ok('the send paths run the unfilled-blanks guard', (pipe.match(/confirmBlanks\(/g) || []).length >= 3);
  ok('the guard is a confirm, never a hard block', /function confirmBlanks\(/.test(pipe) && /confirm\(/.test(pipe.slice(pipe.indexOf('function confirmBlanks('), pipe.indexOf('function confirmBlanks(') + 900)));
  ok('the retired single-template const is gone', !/DDS_CONTRACT_TEMPLATE/.test(pipe));
  ok('the OWED extension-point note is retired — the Template build entry is real now', !/OWED: Eric has published/.test(pipe));
}

const passed = results.filter((r) => r.p).length;
const failed = results.length - passed;
console.log(`\n════ AGREEMENT PACKAGES: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''} ════`);
if (failed) Deno.exit(1);
