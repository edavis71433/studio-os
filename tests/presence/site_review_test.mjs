// ── Free Tools Phase 2: Site Review (crawler, checks, scoring, narrative) ────
//   deno run --allow-read --allow-env tests/presence/site_review_test.mjs
// Pure tier: no network. The business's website, Google PageSpeed and Claude
// are all stand-ins; the database is the in-memory fake from free_tools_fake.mjs.
import { makeFake, setFakeEnv } from './fixtures/free_tools_fake.mjs';

setFakeEnv();
Deno.env.set('PSI_KEY', 'psi-test');
Deno.env.set('ANTHROPIC_KEY', 'sk-test');
const fake = makeFake();
globalThis.fetch = fake.fetch;

const { assertPublicHttpUrl, normalizeSiteUrl } = await import('../../supabase/functions/_shared/tools/url_guard.ts');
const { parsePage } = await import('../../supabase/functions/_shared/tools/site_review/html.ts');
const { socialProfiles } = await import('../../supabase/functions/_shared/site_discovery.ts');
const { candidatesFrom, pickPages, looksBlocked, sitemapLocs } = await import('../../supabase/functions/_shared/tools/site_review/crawl.ts');
const { readPsi } = await import('../../supabase/functions/_shared/tools/site_review/psi.ts');
const { runChecks, pillarScores, overallScore, deriveBusinessName, andList } = await import('../../supabase/functions/_shared/tools/site_review/checks.ts');
const { writeNarrative, groundedIn } = await import('../../supabase/functions/_shared/tools/site_review/narrative.ts');
const { handler, scanDeps } = await import('../../supabase/functions/site-review/handler.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const rejects = async (fn) => { try { await fn(); return false; } catch { return true; } };

// ── URL safety ──
const noDns = async () => [];
ok('guard: refuses localhost, loopback, private and metadata addresses',
  (await rejects(() => assertPublicHttpUrl('http://localhost/', noDns))) && (await rejects(() => assertPublicHttpUrl('http://127.0.0.1/', noDns))) &&
  (await rejects(() => assertPublicHttpUrl('http://10.0.0.5/', noDns))) && (await rejects(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data', noDns))) &&
  (await rejects(() => assertPublicHttpUrl('http://[::1]/', noDns))) && (await rejects(() => assertPublicHttpUrl('http://192.168.1.1/', noDns))));
ok('guard: refuses other schemes, credentials and single-label hosts',
  (await rejects(() => assertPublicHttpUrl('file:///etc/passwd', noDns))) && (await rejects(() => assertPublicHttpUrl('ftp://example.com/', noDns))) &&
  (await rejects(() => assertPublicHttpUrl('https://user:pw@example.com/', noDns))) && (await rejects(() => assertPublicHttpUrl('http://intranet/', noDns))));
ok('guard: refuses a public name that resolves to a private address', await rejects(() => assertPublicHttpUrl('https://sneaky.example.com/', async (_h, t) => (t === 'A' ? ['10.1.2.3'] : []))));
ok('guard: allows a normal public site', !(await rejects(() => assertPublicHttpUrl('https://www.bacchuskitchen.com/', async (_h, t) => (t === 'A' ? ['198.185.159.144'] : [])))));
ok('normalize: adds https, drops the fragment, refuses junk',
  normalizeSiteUrl('bacchuskitchen.com') === 'https://bacchuskitchen.com/' && normalizeSiteUrl('http://x.com/a#b') === 'http://x.com/a' &&
  normalizeSiteUrl('mailto:a@b.com') === null && normalizeSiteUrl('not a url') === null && normalizeSiteUrl('localhost') === null && normalizeSiteUrl('') === null);

// ── a small business site, as the stand-in web ──
const SITE = 'https://www.example-bistro.com';
const page = ({ title, desc, h1 = 'Sample Bistro', body = '', head = '', footer = '' }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${title}</title>${desc ? `<meta name="description" content="${desc}">` : ''}<link rel="canonical" href="${SITE}/">
<meta property="og:title" content="Sample Bistro"><meta property="og:description" content="x"><meta property="og:image" content="${SITE}/og.jpg"><meta property="og:site_name" content="Sample Bistro"><link rel="icon" href="/favicon.ico">${head}</head>
<body><header><nav><a href="/">Home</a><a href="/about">About</a><a href="/menu">Menu</a><a href="/contact">Contact</a><a href="/blog/post-one">A post</a><a href="tel:+18185550142">Call</a></nav></header>
<main><h1>${h1}</h1><p>${body}</p></main>
<footer>${footer}<a href="https://instagram.com/samplebistro">Instagram</a> <a href="/privacy">Privacy</a></footer>
<script>var tpl = '<a href="/\\'+esc(href)+\\'">x</a>';</script></body></html>`;
const words = (n, w = 'fresh') => Array.from({ length: n }, () => w).join(' ');
const HOME_JSONLD = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Restaurant","name":"Sample Bistro","telephone":"(818) 555-0142","address":{"@type":"PostalAddress","streetAddress":"123 Olive Ave","addressLocality":"Burbank"},"openingHours":"Mo-Su 11:00-22:00"}</script>`;
const pages = {
  [`${SITE}/`]: page({ title: 'Sample Bistro | Italian Restaurant in Burbank', desc: 'Handmade pasta and wood-fired dishes in downtown Burbank, open every day for lunch and dinner. Book a table online.', h1: 'Sample Bistro, Burbank', head: HOME_JSONLD, body: `<a href="/reserve">Book a table</a> ${words(200)} Burbank`, footer: '123 Olive Ave, Burbank, CA 91502 <a href="tel:8185550142">(818) 555-0142</a>' }),
  [`${SITE}/about`]: page({ title: 'About Sample Bistro and Our Kitchen Team', desc: 'The story of our family kitchen, our chef and the farms we buy from across Southern California every week.', h1: 'About us', body: words(300) }),
  [`${SITE}/menu`]: page({ title: 'Menu | Sample Bistro Italian Restaurant Burbank', desc: '', h1: 'Menu', body: 'Lorem ipsum dolor sit amet ' + words(40) }),
  [`${SITE}/contact`]: page({ title: 'Contact Sample Bistro | Reservations and Hours', desc: 'Find us on Olive Avenue in Burbank. Call, email or book a table online for lunch, dinner and private events.', h1: 'Contact', body: `<form action="/x"><input name="e"></form> ${words(180)}`, footer: '<iframe src="https://www.google.com/maps/embed?pb=1"></iframe>' }),
  [`${SITE}/blog/post-one`]: page({ title: 'A post', desc: '', h1: '', body: words(30) }),
};
const robots = 'User-agent: *\nAllow: /\nSitemap: https://www.example-bistro.com/sitemap.xml\n';
const sitemap = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE}/</loc></url><url><loc>${SITE}/about</loc></url><url><loc>${SITE}/menu</loc></url><url><loc>${SITE}/contact</loc></url></urlset>`;
const siteRequests = [];
function siteFetch(input, init = {}) {
  const url = String(input);
  siteRequests.push(`${init.method || 'GET'} ${url}`);
  if (url === 'http://www.example-bistro.com/') return Promise.resolve(new Response(null, { status: 301, headers: { location: `${SITE}/` } }));
  if (url === `${SITE}/robots.txt`) return Promise.resolve(new Response(robots, { status: 200 }));
  if (url === `${SITE}/sitemap.xml`) return Promise.resolve(new Response(sitemap, { status: 200 }));
  if (pages[url]) return Promise.resolve(new Response(pages[url], { status: 200, headers: { 'content-type': 'text/html' } }));
  if (url.startsWith(SITE)) return Promise.resolve(new Response('not found', { status: 404 }));
  return Promise.reject(new Error(`unexpected site request ${url}`));
}
const allowAll = async (raw) => new URL(raw);

// ── HTML facts ──
const home = parsePage(pages[`${SITE}/`], `${SITE}/`, socialProfiles);
ok('html: title, description, H1, canonical and viewport', home.title === 'Sample Bistro | Italian Restaurant in Burbank' && home.metaDescription.startsWith('Handmade pasta') && home.h1s.length === 1 && home.h1s[0] === 'Sample Bistro, Burbank' && !!home.canonical && home.viewport);
ok('html: tap-to-call link, address in the footer, and the first-screen CTA', home.telLinks.includes('+18185550142') && /123 Olive Ave/.test(home.address || '') && home.addressInFooter && home.cta === 'Book a table');
ok('html: JSON-LD parsed, social profile found', home.jsonld.items.some((i) => i['@type'] === 'Restaurant') && home.social.includes('instagram.com'));
ok('html: links inside a <script> string are not treated as links', !home.links.some((l) => /esc\(|%27|'/.test(l.href)));
const menuFacts = parsePage(pages[`${SITE}/menu`], `${SITE}/menu`, socialProfiles);
ok('html: placeholder text is caught', /lorem ipsum/i.test(menuFacts.placeholder || ''));
const alt = parsePage('<html><body><img src=a><img src=b alt=""><img src=c alt="" role="presentation"><img src=d alt="Pasta"></body></html>', 'https://x.com/', socialProfiles);
ok('html: images without alt counted (decorative alt="" excluded)', alt.images.total === 4 && alt.images.missingAlt === 2);

// ── page picking ──
const cands = candidatesFrom(`${SITE}/`, [...home.links, { href: 'https://other-site.com/x', text: 'x', inNav: true, inFooter: false }, { href: '/menu.pdf', text: 'PDF', inNav: true, inFooter: false }], sitemapLocs(sitemap));
ok('crawl: same-site page links only (no other sites, no files, no duplicates)', cands.every((c) => c.url.startsWith(SITE)) && !cands.some((c) => c.path.endsWith('.pdf')) && new Set(cands.map((c) => c.path)).size === cands.length);
const picks = pickPages(cands);
ok('crawl: prefers about, menu and contact, takes at most one nested page', ['/about', '/menu', '/contact'].every((p) => picks.some((c) => c.path === p)) && picks.filter((c) => c.path.split('/').filter(Boolean).length > 1).length <= 1 && picks.length <= 7);
const many = Array.from({ length: 40 }, (_, i) => ({ href: `/page-${i}`, text: `P${i}`, inNav: true, inFooter: false }));
ok('crawl: never more than 8 pages including the homepage', pickPages(candidatesFrom(`${SITE}/`, many, [])).length === 7);
ok('crawl: bot walls are recognized', looksBlocked(403, '') && looksBlocked(200, '<html><title>Just a moment...</title>') && looksBlocked(200, '<!-- saved from botfailover.html -->') && !looksBlocked(200, '<html><title>Sample Bistro</title>'));

// ── PageSpeed reading ──
const PSI = {
  lighthouseResult: {
    finalUrl: `${SITE}/`,
    categories: { performance: { score: 0.52 }, seo: { score: 0.92 }, accessibility: { score: 0.88 }, 'best-practices': { score: 0.96 } },
    audits: {
      'largest-contentful-paint': { numericValue: 4800 }, 'cumulative-layout-shift': { numericValue: 0.04 }, 'total-blocking-time': { numericValue: 350 }, 'first-contentful-paint': { numericValue: 2600 },
      'image-delivery-insight': { score: 0, details: { overallSavingsBytes: 3 * 1024 * 1024, items: [{ url: 'a' }, { url: 'b' }] } },
    },
  },
};
const psi = readPsi(PSI);
const v = Object.fromEntries(psi.vitals.map((x) => [x.key, x]));
ok('psi: category scores as 0-100', psi.scores.performance === 52 && psi.scores.seo === 92 && psi.scores.bestPractices === 96);
ok('psi: vitals graded on Google thresholds (TBT stands in for INP)', v.lcp.status === 'poor' && v.lcp.display === '4.8 s' && v.cls.status === 'good' && v.tbt.status === 'needs_work' && v.fcp.status === 'needs_work' && !v.inp);
ok('psi: real-visitor INP used when Google has it', readPsi({ ...PSI, loadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 180 } } } }).vitals.some((x) => x.key === 'inp' && x.status === 'good'));
ok('psi: oversized images counted', psi.oversizedImages?.count === 2 && psi.oversizedImages?.savingsKb === 3072);

// ── checks and scoring ──
const allPages = Object.entries(pages).filter(([u]) => !u.includes('/blog/')).map(([u, h]) => parsePage(h, u, socialProfiles));
const disc = { robotsTxt: true, robotsTxtBlocksAll: false, sitemapDeclared: true, sitemapUrl: `${SITE}/sitemap.xml`, sitemapXml: true, sitemapUrlCount: 4, sitemapIsIndex: false };
const base = { homeUrl: `${SITE}/`, pages: allPages, disc, httpRedirect: true, broken: [], linksChecked: 5, psi, businessName: 'Sample Bistro', businessType: 'restaurant', city: 'Burbank' };
const checks = runChecks(base);
const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
ok('checks: Restaurant schema with name/address/phone/hours passes', byId.schema_type.status === 'pass' && byId.schema_details.status === 'pass' && byId.nap_consistency.status === 'pass');
ok('checks: missing description on /menu and its placeholder text are caught with evidence', byId.desc_present.status === 'warn' && /\/menu/.test(byId.desc_present.evidence) && byId.placeholder.status === 'fail' && /lorem ipsum/i.test(byId.placeholder.evidence));
ok('checks: city, CTA, tap-to-call, map and HTTPS redirect pass', ['city_mention', 'cta_first_screen', 'tel_link', 'map_embed', 'http_redirect', 'https'].every((id) => byId[id].status === 'pass'));
ok('checks: slow LCP is a failing Core Web Vital with the real value', byId.vital_lcp.status === 'fail' && /4\.8 s/.test(byId.vital_lcp.draft.what));
ok('checks: every failing or warning check carries plain-English text', checks.filter((c) => c.status === 'fail' || c.status === 'warn').every((c) => c.draft && c.draft.title && c.draft.what && c.draft.why && c.draft.fix));
const pillars = pillarScores(checks, true);
ok('scoring: four pillars weighted 30/30/20/20', pillars.map((p) => `${p.key}:${p.weight}`).join(',') === 'performance:30,search:30,trust:20,local:20');
ok('scoring: overall is the weighted sum of the pillars', overallScore(pillars) === Math.round(pillars.reduce((n, p) => n + p.score * p.weight, 0) / 100));
const noPsi = pillarScores(runChecks({ ...base, psi: { ok: false, reason: 'timeout' } }), false);
ok('scoring: PageSpeed failure → Performance "Couldn\'t measure today" and left out', noPsi[0].score === null && noPsi[0].note === "Couldn't measure today" && overallScore(noPsi) === Math.round((noPsi[1].score * 30 + noPsi[2].score * 20 + noPsi[3].score * 20) / 70));
ok('scoring: noindex on the homepage is a Fix-now failure', runChecks({ ...base, pages: [{ ...allPages[0], noindex: true }, ...allPages.slice(1)] }).find((c) => c.id === 'noindex').status === 'fail');
ok('business name: og:site_name, else the brand part of the title', deriveBusinessName(home) === 'Sample Bistro' && deriveBusinessName({ ...home, og: { ...home.og, siteName: '' }, jsonld: { blocks: 0, parseErrors: 0, items: [] }, title: 'Home | Cedar & Core' }) === 'Cedar & Core');
ok('wording: lists read naturally', andList(['a']) === 'a' && andList(['a', 'b']) === 'a and b' && andList(['search', 'trust and conversion', 'local']) === 'search, trust and conversion, and local');

// ── the narrative's guardrails ──
const issue = checks.find((c) => c.id === 'vital_lcp');
ok('narrative: a finding that invents a number is rejected', !groundedIn({ title: 'Slow site', what_we_found: 'Your page takes 9.2 seconds and loses 40% of visitors.' }, issue) && groundedIn({ title: 'Slow on phones', what_we_found: 'Google measured 4.8 s on mobile; good is under 2.5 s.' }, issue));
const narrIn = { businessName: 'Sample Bistro', businessType: 'restaurant', city: 'Burbank', url: `${SITE}/`, overall: 70, pillars: pillars.map((p) => ({ name: p.name, score: p.score })), issues: checks.filter((c) => c.draft && c.status !== 'pass'), strengths: [], pagesReviewed: ['/', '/about'], notes: [] };
let claudeCalls = 0;
const claudeDown = () => { claudeCalls++; return Promise.resolve(new Response(JSON.stringify({ type: 'error', error: { message: 'overloaded' } }), { status: 529 })); };
const tpl = await writeNarrative(narrIn, 50_000, claudeDown);
ok('narrative: Claude failing twice → template text, two attempts', tpl.source === 'template' && tpl.attempts === 2 && claudeCalls === 2 && tpl.findings.length === narrIn.issues.length && tpl.top_three.length === 3);
const goodJson = { summary: 'Your menu and story pages are strong. Speed on phones is the first thing to fix.', top_three: ['Speed up the homepage.', 'Remove the placeholder text.', 'Add a menu description.'],
  findings: [{ check_id: 'vital_lcp', title: 'The main photo takes 4.8 s to show', what_we_found: 'Google measured 4.8 s on mobile.', why_it_matters: 'Diners leave.', fix: 'Lighten the hero image.' },
    { check_id: 'placeholder', title: 'Template text on the menu', what_we_found: 'We found 12 lines of lorem ipsum on /menu.', why_it_matters: 'Looks unfinished.', fix: 'Replace it.' },
    { check_id: 'made_up_check', title: 'x', what_we_found: 'x', why_it_matters: 'x', fix: 'x' }] };
let sentBody = null;
const claudeOk = (_u, init) => { sentBody = JSON.parse(init.body); return Promise.resolve(new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(goodJson) }], usage: { input_tokens: 4000, output_tokens: 1200 } }), { status: 200 })); };
const nar = await writeNarrative(narrIn, 50_000, claudeOk);
const lcpF = nar.findings.find((f) => f.check_id === 'vital_lcp'), phF = nar.findings.find((f) => f.check_id === 'placeholder');
ok('narrative: Claude text kept when grounded; our priority and pillar win', nar.source === 'claude' && lcpF.title === 'The main photo takes 4.8 s to show' && lcpF.priority === 'Important' && lcpF.pillar === 'Performance' && nar.findings.find((f) => f.check_id === 'perf_score')?.priority === 'Important');
ok('narrative: an ungrounded Claude finding falls back to the template', phF.title === byId.placeholder.draft.title && !/12 lines/.test(phF.what_we_found));
ok('narrative: findings for unknown checks are dropped; skipped checks still reported', !nar.findings.some((f) => f.check_id === 'made_up_check') && nar.findings.length === narrIn.issues.length);
ok('narrative: request uses Haiku 5.5, structured output, no temperature', sentBody.model === 'claude-haiku-5-5' && sentBody.output_config?.format?.type === 'json_schema' && !('temperature' in sentBody) && sentBody.max_tokens > 0);
ok('narrative: cost logged from usage ($0.10 / $0.50 per million)', Math.abs(nar.costUsd - (4000 * 0.1 + 1200 * 0.5) / 1e6) < 1e-9);

// ── the site-review function, end to end ──
Object.assign(scanDeps, { guard: allowAll, siteFetch, psiFetch: () => Promise.resolve(new Response(JSON.stringify(PSI), { status: 200 })), claudeFetch: claudeOk });
const req = (body, ip = '203.0.113.50') => new Request('https://x/functions/v1/site-review', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, origin: 'https://tools.davisdigitalstudio.com' }, body: JSON.stringify(body) });
const readAll = async (r) => (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));

let r = await handler(req({ url: 'not a site', turnstile_token: 'good-token' }));
ok('function: a bad address is a 400 with a plain message', r.status === 400 && /yourbusiness\.com/.test((await r.json()).message));
Object.assign(scanDeps, { guard: (raw) => assertPublicHttpUrl(raw, async () => ['10.0.0.9']) });
r = await handler(req({ url: 'https://internal.example.com', turnstile_token: 'good-token' }));
ok('function: an address that resolves privately is refused before any scan', r.status === 400 && (await r.json()).error === 'unreachable');
Object.assign(scanDeps, { guard: allowAll });
r = await handler(req({ url: SITE, business_type: 'restaurant', turnstile_token: 'bad-token' }));
ok('function: failed Turnstile → 403, nothing fetched', r.status === 403 && !siteRequests.length);

r = await handler(req({ url: 'www.example-bistro.com', business_type: 'restaurant', city: 'Burbank', turnstile_token: 'good-token' }));
const events = await readAll(r);
const prog = events.filter((e) => e.type === 'progress');
const doneEv = events.find((e) => e.type === 'done');
ok('function: streams newline-delimited progress', r.headers.get('content-type').includes('ndjson') && prog.length >= 5);
ok('function: progress follows the spec order and counts pages', ['pages', 'speed', 'search', 'trust', 'writing'].every((s, i, a) => { const idx = prog.findIndex((p) => p.step === s); return idx >= 0 && (i === 0 || idx > prog.findIndex((p) => p.step === a[i - 1])); }) && prog.some((p) => p.step === 'pages' && p.total >= 4 && p.done === p.total));
const row = fake.state.tables.tool_reports.find((x) => x.id === doneEv?.report_id);
ok('function: report saved with input, scores, findings and raw results', !!row && row.tool === 'site_review' && row.input.business_name === 'Sample Bistro' && row.input.city === 'Burbank' && typeof row.scores.overall === 'number' && row.findings.items.length > 0 && row.raw_results.pages.length >= 4);
ok('function: answer is the teaser (two findings, no tables)', doneEv.report.unlocked === false && doneEv.report.findings.length === 2 && doneEv.report.tables.length === 0 && doneEv.report.pillars.length === 4);
ok('function: full report has the CWV and per-page tables', row.findings.tables.length === 2 && row.findings.tables[0].rows.length === 4 && row.findings.tables[1].columns.includes('Images missing alt'));
ok('function: scan cost and cache recorded', fake.state.tables.tool_usage_log.some((u) => u.kind === 'scan' && u.report_id === row.id && u.cost_usd > 0) && fake.state.tables.tool_scan_cache.some((c) => c.report_id === row.id && c.cache_key === 'example-bistro.com'));
ok('function: the crawler stayed on the site and checked robots, sitemap and http→https', siteRequests.every((s) => s.includes('example-bistro.com')) && siteRequests.some((s) => s.endsWith('/robots.txt')) && siteRequests.some((s) => s.startsWith('GET http://www.example-bistro.com/')));

const before = siteRequests.length;
r = await handler(req({ url: 'https://example-bistro.com/', business_type: 'restaurant', turnstile_token: 'good-token' }, '203.0.113.51'));
const cached = await r.json();
ok('function: a repeat within 24 h is served from cache as a new locked copy, no crawl', cached.type === 'done' && cached.cached === true && cached.report_id !== row.id && siteRequests.length === before);

Object.assign(scanDeps, { siteFetch: () => Promise.resolve(new Response('<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x"></script></html>', { status: 403 })) });
r = await handler(req({ url: 'https://walled.example.com', turnstile_token: 'good-token' }, '203.0.113.52'));
let ev = (await readAll(r)).find((e) => e.type === 'error');
ok('function: bot wall → "Your site blocked our checker" with a call link', ev?.error === 'blocked' && ev.message === "Your site blocked our checker. Book a call and I'll review it by hand." && !!ev.calendly);
Object.assign(scanDeps, { siteFetch: () => Promise.reject(new Error('ENOTFOUND')) });
r = await handler(req({ url: 'https://gone.example.com', turnstile_token: 'good-token' }, '203.0.113.53'));
ev = (await readAll(r)).find((e) => e.type === 'error');
ok('function: unreachable site → the spec\'s "couldn\'t load that address" message', ev?.error === 'unreachable' && ev.message === "We couldn't load that address. Check the URL or try the homepage.");
Object.assign(scanDeps, { siteFetch: () => Promise.resolve(new Response('%PDF-1.7 binary', { status: 200 })) });
r = await handler(req({ url: 'https://pdf.example.com/menu.pdf', turnstile_token: 'good-token' }, '203.0.113.54'));
ev = (await readAll(r)).find((e) => e.type === 'error');
ok('function: a non-HTML address is reported as unreachable', ev?.error === 'unreachable');

// PageSpeed down + Claude down: the report still runs.
Object.assign(scanDeps, { siteFetch, psiFetch: () => Promise.resolve(new Response('{"error":{"code":500}}', { status: 500 })), claudeFetch: claudeDown });
r = await handler(req({ url: 'https://www.example-bistro.com/menu', business_type: 'restaurant', turnstile_token: 'good-token' }, '203.0.113.55'));
const d2 = (await readAll(r)).find((e) => e.type === 'done');
const row2 = fake.state.tables.tool_reports.find((x) => x.id === d2?.report_id);
ok('function: PageSpeed and Claude both down → report still runs, Performance "Couldn\'t measure today"', !!row2 && row2.scores.pillars[0].score === null && row2.scores.pillars[0].note === "Couldn't measure today" && row2.raw_results.narrative.source === 'template' && row2.scores.notes.some((n) => /speed test/.test(n)));

// ── structural ──
const read = (p) => Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url));
const js = read('site-review.js');
ok('page: never parses report data as HTML', !/innerHTML/.test(js));
ok('page: fires scan_started, scan_completed and scan_failed', ['scan_started', 'scan_completed', 'scan_failed'].every((e) => js.includes(`'${e}'`)));
ok('page: Turnstile site key wired in', js.includes('0x4AAAAAAFl7hPNwYacRr2Z2') && read('site-review.html').includes('challenges.cloudflare.com/turnstile'));
ok('redirects: /site-review serves the page', /^\/site-review\s+\/site-review\.html\s+200$/m.test(read('_redirects')));
ok('deploy: site-review ships to production', read('.github/workflows/deploy.yml').includes('functions deploy site-review --no-verify-jwt --project-ref ${{ secrets.SUPABASE_PROJECT_REF_PROD }}'));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ FREE TOOLS PHASE 2 SITE REVIEW: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
