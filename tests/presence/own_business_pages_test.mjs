// ── A person's own second business is not a studio inside a client (builder item 83, follow-up) ──
// Someone with places in two businesses opens their second one with the same ?client=<site id>
// a studio uses to work inside a client. /portal/context tells the two apart: its `scope` is set
// only for a studio inside a client. The pages used to decide from the bare address, so a Co-owner
// or Staff member in their second business got a client's Settings (no Deal stages, Automations or
// plan; a Monthly report card), a client's Today, and a client's Pipeline, Contacts and Projects
// without their own tools. Each page now asks the context (or the shell's ddsScopeInfo, which
// reads it, or the businesses it remembers from the last visit) and keeps sending the address's
// id with every read and link, which is how the server knows the business.
//
// This runs each page's own decision code, cut from the page, through every case:
//   · no ?client=                                  → not inside a client
//   · ?client= and the context says a studio scope → inside a client (the studio, as before)
//   · ?client= and the context says one of yours   → not inside a client
//   · ?client= before the context, the shell remembers the business → not inside a client
//   · ?client= before the context, the shell doesn't → inside a client (the address, as before)
//   · ?client= before the shell has loaded at all  → inside a client (the address, as before)
//   · a context that names neither (an older server) → the shell decides, as it does for itself
//
//   deno run --allow-read tests/presence/own_business_pages_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const grab = (src, re, what) => { const m = src.match(re); if (!m) throw new Error('not found: ' + what); return m[0]; };

const SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', OTHER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const STUDIO_CTX = { scope: { site_id: SITE, name: 'A client' }, businesses: [], business: null };
const HELD_CTX = { scope: null, business: { site_id: SITE }, businesses: [{ site_id: OTHER }, { site_id: SITE }] };
// the shell's answer: ddsScopeInfo() is { id, name } for a studio inside a client, null for one of your own businesses
const SHELL_STUDIO = { ddsScopeInfo: () => ({ id: SITE, name: '' }) };
const SHELL_HELD = { ddsScopeInfo: () => null };
const NO_SHELL = {};

// every case: what the page knows, and the right answer
const CASES = [
  { n: 'no ?client=', client: '', ctx: null, win: SHELL_STUDIO, want: false },
  { n: 'a studio inside a client (context)', client: SITE, ctx: STUDIO_CTX, win: SHELL_STUDIO, want: true },
  { n: 'one of your own businesses (context)', client: SITE, ctx: HELD_CTX, win: SHELL_HELD, want: false },
  { n: 'before the context, the shell remembers the business', client: SITE, ctx: null, win: SHELL_HELD, want: false },
  { n: 'before the context, the shell doesn’t', client: SITE, ctx: null, win: SHELL_STUDIO, want: true },
  { n: 'before the shell has loaded', client: SITE, ctx: null, win: NO_SHELL, want: true },
  { n: 'a context that names neither (an older server): the shell decides', client: SITE, ctx: { scope: null }, win: SHELL_STUDIO, want: true },
  { n: 'a context that names neither, and the shell remembers the business', client: SITE, ctx: { scope: null }, win: SHELL_HELD, want: false },
  { n: 'the page’s own context lists the business before the shell knows it', client: SITE, ctx: HELD_CTX, win: SHELL_STUDIO, want: false },
  { n: 'the context says a studio inside a client, though the shell still remembers the business', client: SITE, ctx: STUDIO_CTX, win: SHELL_HELD, want: true },
];
const search = (c) => (c.client ? '?client=' + c.client : '');
// a ?client= that is no real site id: the shell reads none (its answer is null, as for your own business),
// and the pages keep what the address said before, a client
const ODD = { n: 'a ?client= that is no real site id', client: 'site-acme', ctx: null, win: SHELL_HELD, want: true };
// the shell's memory of your businesses (shell.js HELD_KEY), which two pages read before the shell has loaded
const storage = (held) => ({ getItem: (k) => (k === 'dds-held-businesses' && held ? JSON.stringify(held) : null) });
const EARLY = [
  { n: 'before the shell has loaded, its memory names the business', client: SITE, ctx: null, win: NO_SHELL, held: [OTHER, SITE], want: false },
  { n: 'before the shell has loaded, its memory names others only', client: SITE, ctx: null, win: NO_SHELL, held: [OTHER], want: true },
];
// pages that ask the shell alone: with a context in, the shell's answer is the context's
function SHELL_CASES_OF(cases) { return cases.map((c) => (c.ctx ? { ...c, want: c.win === SHELL_STUDIO } : c)); }
function matrix(page, judge, cases = CASES) {
  const wrong = cases.filter((c) => judge(c) !== c.want).map((c) => c.n);
  ok(`${page}: decides "a studio inside a client" from the context, else the shell, else the address`, wrong.length === 0, wrong.join('; '));
}

// ── settings.html: CTX (its own read or the shell's), window.__ddsContext, the shell ──
const settings = read('settings.html');
{
  const src = grab(settings, /function inClient\(\) \{[\s\S]*?\n\}/, 'settings inClient');
  const run = (SCOPE, CTX, win) => new Function('SCOPE', 'CTX', 'window', `${src}\nreturn inClient();`)(SCOPE, CTX, win);
  matrix('settings', (c) => run(c.client, c.ctx, { ...c.win }));
  ok('settings: a ?client= that is no real site id is no client at all, as before', run('', null, { ...SHELL_HELD }) === false && /const SCOPE = \(function \(\) \{ const v = new URLSearchParams\(location\.search\)\.get\('client'\) \|\| ''; return UUID_RE\.test\(v\) \? v : ''; \}\)\(\);/.test(settings));
  matrix('settings (the context as the shell published it)', (c) => run(c.client, null, { ...c.win, __ddsContext: c.ctx || undefined }));
  ok('settings: the address still goes with every read and every link', /'x-dds-scope-site': SCOPE \}\)/.test(settings) && /const withClient = \(href\) => \{ if \(!SCOPE\) return href;/.test(settings));
  ok('settings: Deal stages, the studio’s Automations and the plan are kept out, and the Monthly report and Enquiry replies shown, only inside a client',
    /const inC = inClient\(\);\n  const show = CARDS\.filter\([^\n]*!\(c\.ownerOnly && inC\) && !\(c\.studioOnly && inC\) && !\(c\.scopedOnly && !inC\)/.test(settings)
    && /async function loadPlan\(\) \{\s*if \(inClient\(\)\) return;/.test(settings)
    && /async function loadReport\(\) \{\s*if \(!inClient\(\) \|\|/.test(settings)
    && /if \(!inClient\(\)\) \{ loadStageNames\(\); loadMenu\(\); \}[^\n]*\n\s*else \{ wireReport\(\); loadReport\(\); \}/.test(settings)
    && /const automationsHere = \(\) => !inClient\(\) \|\| \(hasFeature\('website'\) && hasCap\('configure'\)\);/.test(settings)
    && /if \(automationsHere\(\)\) \{ wireAutomations\(\); paintAutomations\(\); \}/.test(settings)
    && /RECIPES\.filter\(\(r\) => !inClient\(\) \|\| r\.scoped\)/.test(settings) && /row\.hidden = inClient\(\) && !row\.hasAttribute\('data-scoped'\)/.test(settings)
    && /\$\('autoHint'\)\.textContent = inClient\(\) \?/.test(settings) && /if \(inClient\(\)\) return;   \/\/ the studio's own sections stay out of a client's settings/.test(settings));
  ok('settings: the studio’s own cards (Team, Your menu) still need the studio’s own level, no business picked',
    /!\(c\.agencyOnly && !\(CTX && CTX\.is_agency && !SCOPE\)\)/.test(settings) && /if \(SCOPE \|\| !\(CTX && CTX\.is_agency\)\) return;/.test(settings));
  // the cards' links: inside a client only the scoped cards carry it; in your own business every one keeps it
  const cardSrc = grab(settings, /function cardHtml\(c, status\) \{[\s\S]*?\n\}/, 'cardHtml');
  const withClientSrc = grab(settings, /const withClient = \(href\) => \{[^\n]*\};/, 'withClient');
  const card = (SCOPE, inC, c) => new Function('SCOPE', 'inClient', 'scopeName', 'CTX', 'esc', 'IC', 'statusHtml', 'c',
    `${withClientSrc}\n${cardSrc}\nreturn cardHtml(c, null);`)(SCOPE, () => inC, () => '', null, (s) => String(s), {}, () => '', c);
  const dev = { key: 'dev', href: '/developer.html', title: 'Developer', desc: 'd', scopedTitle: () => 'Your studio’s developer tools', scopedDesc: 'x' };
  const conn = { key: 'connections', href: '/connections.html', title: 'Connections', desc: 'd', scoped: true };
  const stages = { key: 'stages', href: '#stages', title: 'Deal stages', desc: 'd', studioOnly: true };
  const studioDev = card(SITE, true, dev), heldDev = card(SITE, false, dev), plainDev = card('', false, dev);
  ok('settings: inside a client a studio-level card leaves the client and says so (as before)', studioDev.includes('href="/developer.html"') && studioDev.includes('data-noscope="1"') && studioDev.includes('Your studio’s developer tools'));
  ok('settings: in your own second business every card keeps the business and speaks plainly', heldDev.includes(`href="/developer.html?client=${SITE}"`) && !heldDev.includes('data-noscope') && heldDev.includes('<b>Developer</b>')
    && card(SITE, false, conn).includes(`href="/connections.html?client=${SITE}"`) && card(SITE, false, stages).includes('href="#stages"'));
  ok('settings: with no business picked the cards are as before', plainDev.includes('href="/developer.html"') && plainDev.includes('data-noscope="1"') && card('', false, conn).includes('href="/connections.html"'));
  ok('settings: the studio look waits for the context before it decides', /async function loadStudioLook\(\) \{\s*if \(SCOPE\) await CTX_IN;[^\n]*\n\s*if \(inClient\(\)\) return;/.test(settings) && /CTX = \(r\.ok && r\.body && r\.body\.data\) \|\| null; \}\s*\n\s*ctxIn\(\);/.test(settings));
}

// ── today.html: a first answer from the shell, the context's answer once in ──
const today = read('today.html');
{
  const src = grab(today, /function studioInClient\(c\)\{[\s\S]*?\n\}/, 'today studioInClient');
  const run = (c, ctx) => new Function('location', 'window', 'ctx', 'localStorage', `${src}\nreturn studioInClient(ctx);`)({ search: search(c) }, { ...c.win }, ctx, storage(c.held));
  matrix('today (first answer)', (c) => run(c, undefined), [...CASES.map((c) => (c.ctx ? { ...c, want: c.win === SHELL_STUDIO } : c)), ...EARLY, ODD]);
  matrix('today (once the context is in)', (c) => run(c, c.ctx));
  ok('today: the context has the last word, and the four reads go again when it differs from the first answer',
    /const inFirst = studioInClient\(\);/.test(today) && /const inC = studioInClient\(c0\);/.test(today)
    && /if\(inC!==inFirst\) \[bridged, customers, example, rec\] = await Promise\.all\(scopedReads\(inC\)\);/.test(today)
    && /const \[rBridged, rCustomers, rExample, rRec\] = scopedReads\(inFirst\);/.test(today));
  ok('today: a studio inside a client still reads the client’s record and nothing of its own',
    /\(inC\?apiGet\('\/crm\/record\?client='/.test(today) && /\(inC\?Promise\.resolve\(null\):apiGet\('\/client\/projects'\)/.test(today)
    && /if\(c0 && \(c0\.is_agency \|\| c0\.is_operator\) && inC\) mountSiteDeck\(\)/.test(today));
  ok('today: a studio at its own level still goes Home (no ?client= at all)', /const studioHome = \(c\)=>!!\(c && c\.is_agency && !\(c\.scope && c\.scope\.site_id\) && !new URLSearchParams\(location\.search\)\.get\('client'\)\);/.test(today));
  ok('today: your own business’s project card shows, and opens that business’s portal', /function studioProjectCard\(d, inC\)\{[\s\S]{0,320}?if\(inC\) return;/.test(today) && /card\.href = scopeHref\('\/client\.html'\);/.test(today));
}

// ── crm.html: the record page's studio-level reads and links ──
const crm = read('crm.html');
{
  const head = grab(crm, /const scopeParam=\(\)=>[\s\S]*?\nconst H=\(scoped\)=>[^\n]*\n/, 'crm helpers');
  const links = grab(crm, /const agHref=[^\n]*\n[\s\S]*?const pinHref=[^\n]*\n/, 'crm links');
  const rq = grab(crm, /function recordQuery\(\)\{[\s\S]*?\n\}/, 'recordQuery');
  const run = (c, url) => new Function('QP', 'SUPABASE_KEY', 'TOKEN', 'window', 'localStorage',
    `${head}${links}${rq}\nreturn { H, agHref, pinHref, recordQuery, studioScoped };`)(() => new URLSearchParams(url), 'K', 'T', { ...c.win }, storage(c.held));
  const studio = run(CASES[1], `?client=${SITE}&deal=${OTHER}`), held = run(CASES[2], `?client=${SITE}&deal=${OTHER}`), none = run(CASES[0], `?deal=${OTHER}`);
  matrix('crm', (c) => run(c, search(c)).studioScoped(), [...SHELL_CASES_OF(CASES), ...EARLY, ODD]);
  ok('crm: inside a client the studio-level reads go unscoped and the links pin it off (as before)',
    !('x-dds-scope-site' in studio.H(false)) && studio.H(true)['x-dds-scope-site'] === SITE
    && studio.agHref('pipeline.html', 'deal=1') === '/pipeline.html?deal=1&client=' && studio.pinHref('/projects.html?project=1') === '/projects.html?project=1&client='
    && studio.recordQuery().includes('client=' + SITE));
  ok('crm: in your own second business they go to that business, and ?client= is no record key',
    held.H(false)['x-dds-scope-site'] === SITE && held.H(true)['x-dds-scope-site'] === SITE
    && held.agHref('pipeline.html', 'deal=1') === `/pipeline.html?deal=1&client=${SITE}` && held.pinHref('/projects.html?project=1') === `/projects.html?project=1&client=${SITE}`
    && held.recordQuery() === `?deal=${OTHER}`);
  ok('crm: with no business picked nothing changes', !('x-dds-scope-site' in none.H(false)) && none.agHref('pipeline.html', 'deal=1') === '/pipeline.html?deal=1&client=' && none.recordQuery() === `?deal=${OTHER}`);
  ok('crm: the early timeline and the move to the customer’s address are a studio’s only',
    /if\(q0\.get\('client'\)&&studioScoped\(\)&&!q0\.get\('deal'\)/.test(crm) && /if\(canon\.key==='client' && canon\.value && QP\(\)\.get\('client'\)!==canon\.value && !ownBusiness\(\)\)\{/.test(crm));
}

// ── analytics.html: its own CTX ({} when the read failed), else the shell ──
const analytics = read('analytics.html');
{
  const src = grab(analytics, /const inClient=\(\)=>\{[^\n]*\};/, 'analytics inClient');
  const run = (c, CTX) => new Function('scope', 'CTX', 'window', `${src}\nreturn inClient();`)(() => c.client, CTX, { ...c.win });
  matrix('analytics', (c) => run(c, c.ctx), [...CASES, ODD]);
  matrix('analytics (its context read failed)', (c) => run(c, {}), CASES.map((c) => (c.ctx ? { ...c, want: c.win === SHELL_STUDIO } : c)));
  ok('analytics: the Reports section is left out only inside a client', /const reportsShell=\(\)=>inClient\(\)\?'':/.test(analytics));
  ok('analytics: the studio’s portfolio still needs the studio’s own level, no business picked', /if\(CTX&&CTX\.is_agency&&!scope\(\)\)\{await loadPortfolio\(\);return;\}/.test(analytics));
}

// ── contacts, pipeline, projects: the shell answers ──
const SHELL_CASES = [...SHELL_CASES_OF(CASES), ODD];
for (const page of ['contacts', 'pipeline', 'projects']) {
  const html = read(`${page}.html`);
  const src = grab(html, /const inClient=\(\)=>!!scope\(\)&&\(window\.ddsScopeInfo&&[^\n]*\?!!window\.ddsScopeInfo\(\):true\);/, `${page} inClient`);
  matrix(page, (c) => new Function('scope', 'window', `${src}\nreturn inClient();`)(() => c.client, { ...c.win }), SHELL_CASES);
  ok(`${page}: the address still goes with every read`, /'x-dds-scope-site':(AG_MODE\?'':)?scope\(\)\}\)/.test(html));
}
const contacts = read('contacts.html'), pipeline = read('pipeline.html'), projects = read('projects.html');
ok('contacts: Save view, Add and Import are a client’s pipeline’s to hide; a paint before the context is painted again',
  /if\(VIEWS_ASKED\|\|inClient\(\)\)return;/.test(contacts) && /\$\{inClient\(\)\?'':addButtons\(\)\}/.test(contacts) && /async function loadImportStrip\(\)\{\s*if\(inClient\(\)\)return;/.test(contacts)
  && /if\(!ALL\.length&&inClient\(\)\)return `<div class="center"><h2>Contacts live at the studio level\./.test(contacts)
  && /function render\(\)\{\s*PAINTED_IN=inClient\(\);/.test(contacts) && /document\.addEventListener\('dds:context',\(\)=>\{if\(PAINTED_IN!==null&&PAINTED_IN!==inClient\(\)\)\{render\(\);loadSavedViews\(\);loadImportStrip\(\);\}\}\);/.test(contacts));
ok('pipeline: the page starts as a client’s under ?client= and gives your own business its tools back once the shell can tell',
  /if\(scope\(\)\)\{\['importDeals','pvBtn','chartsBtn','printBtn'\][^\n]*wireMore\(\);ownBusinessTools\(\);\}/.test(pipeline)
  && /const own=!inClient\(\);if\(own===OWN_TOOLS\)return;OWN_TOOLS=own;/.test(pipeline) && /nd\.hidden=!own;nd\.onclick=own\?openNewDeal:null;/.test(pipeline)
  && /if\(own&&!OWN_WIRED\)\{OWN_WIRED=true;wireViews\(\);studioLevelTools\(\);\}/.test(pipeline)
  && /document\.addEventListener\('dds:context',go\);/.test(pipeline) && /if\(VIEWS_ASKED\|\|inClient\(\)\)return;/.test(pipeline));
ok('projects: your own business reads its own projects and can start one; a context that differs reads again',
  /LOADED_IN=inClient\(\);\s*\n\s*if\(LOADED_IN&&!AG_MODE\)\{const sc=await resolveScopedClient\(\);/.test(projects) && /NEW_OK=STUDIO&&!LOADED_IN;/.test(projects)
  && /if\(LOADED_IN===null\|\|LOADED_IN===inClient\(\)\)return;AG_MODE=false;SCOPED_CLIENT=null;CUSTMAP=null;CUSTTRIED=false;load\(true\);/.test(projects)
  && /if\(r\.ok&&inClient\(\)\)takeCustomers\(rows\);/.test(projects));   // a studio's roster that lands after the context said "your own" names nothing

// ── connections.html: decided with the client's name, before the first paint ──
const conn = read('connections.html');
{
  const src = grab(conn, /async function resolveClientName\(\)\{[\s\S]*?\n\}/, 'resolveClientName');
  const verdicts = await Promise.all([...CASES, ODD].map(async (c) => {
    const r = await new Function('SCOPE', 'shellContext', 'window', `let IN_CLIENT = !!SCOPE;\n${src}\nreturn resolveClientName().then((name) => ({ name, IN_CLIENT }));`)(c.client, async () => c.ctx, { ...c.win });
    return r.IN_CLIENT === c.want ? '' : c.n;
  }));
  ok('connections: decides "a studio inside a client" from the shell’s context, else its memory, else the address', verdicts.every((v) => !v), verdicts.filter(Boolean).join('; '));
  ok('connections: “Asked the client”, the ask, “Whose account” and the studio’s own Calendar and email cards follow it; the pending connect keeps the business',
    /label: IN_CLIENT \? 'Asked the client'/.test(conn) && /if\(!IN_CLIENT \|\| !open\.length\)/.test(conn) && /\$\{IN_CLIENT\s*\n\s*\? `<p><b>Whose account:/.test(conn)
    && /\$\('calSec'\); if\(!host \|\| IN_CLIENT\) return;/.test(conn) && /\$\('logSec'\); if\(!host \|\| IN_CLIENT\) return;/.test(conn)
    && /if\(SCOPE\) localStorage\.setItem\('dds-pending-scope', SCOPE\)/.test(conn));
}

// ── presence.html: its own context (S.ctx), the shell's, else the shell's memory ──
const pres = read('presence.html');
{
  const src = grab(pres, /function studioInClient\(\) \{[\s\S]*?\n\}/, 'presence studioInClient');
  matrix('website editor', (c) => new Function('location', 'S', 'window', `${src}\nreturn studioInClient();`)({ search: search(c) }, { ctx: c.ctx }, { ...c.win }), [...CASES, ODD]);
  ok('website editor: the setup list, the welcome, the plan notice and the version words follow it',
    /function setupScoped\(\) \{ return studioInClient\(\); \}/.test(pres) && /if \(!studioInClient\(\)\) \{\s*renderFirstRun\(\);\s*renderPlanNotice\(\);/.test(pres)
    && /const scoped = studioInClient\(\);\n  if \(p\.by_kind === "client"\)/.test(pres) && /const forClient = studioInClient\(\);/.test(pres));
  ok('website editor: a studio’s own site is still a practice site, one of its own businesses is not',
    /if \(!scoped && !new URLSearchParams\(location\.search\)\.get\("client"\) && ctx0 && ctx0\.is_agency && !\(ctx0\.scope && ctx0\.scope\.name\)\) return off\(\);/.test(pres));
  ok('website editor: links out still carry ?client=', /function withClient\(path\) \{\s*const c = new URLSearchParams\(location\.search\)\.get\("client"\);/.test(pres) && /function carryScopeOnLinks\(\) \{\s*const c = new URLSearchParams\(location\.search\)\.get\("client"\);/.test(pres));
}

// ── developer.html and get-started.html: their reads and saves carry your own business, never a client's ──
// They sent no business at all, so in a second business they read and saved the first one's website code and
// setup. A studio inside a client still works on its own site there, as before.
for (const page of ['developer', 'get-started']) {
  const html = read(`${page}.html`);
  const src = grab(html, /const ownBusiness=\(\)=>\{[^\n]*\};/, `${page} ownBusiness`);
  const sent = (c) => new Function('location', 'window', `${src}\nreturn ownBusiness();`)({ search: search(c) }, { ...c.win });
  const wrong = [...CASES, ODD].filter((c) => sent(c) !== (c.client && c !== ODD && c.win === SHELL_HELD ? c.client : '')).map((c) => c.n);
  ok(`${page}: sends your own business with every read and save, a client’s never`, wrong.length === 0, wrong.join('; '));
  ok(`${page}: waits for the context before its first read when ?client= is there`, /'x-dds-scope-site':ownBusiness\(\)\}\);/.test(html) && /await businessKnown\(\);/.test(html)
    && /async function businessKnown\(\)\{if\(!new URLSearchParams\(location\.search\)\.get\('client'\)\)return;[^\n]*await window\.ddsContext\(\)\.catch\(\(\)=>null\);\}/.test(html));
}

// ── the shell's own answer, which every page above leans on, is PR 341's and unchanged ──
const shell = read('shell.js');
ok('shell: ddsScopeInfo is null for one of your own businesses, the scope for a studio inside a client',
  /window\.ddsScopeInfo = function \(\) \{\s*var s = CTX && CTX\.scope, id = scopeId\(\);\s*if \(s && s\.site_id\) return \{ id: s\.site_id, name: s\.name \|\| '' \};\s*if \(heldBusinessId\(id\)\) return null;/.test(shell));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ OWN BUSINESS PAGES: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
