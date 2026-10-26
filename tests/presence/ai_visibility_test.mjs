// ── Free Tools Phase 3: AI Visibility Check ──────────────────────────────────
//   deno run --allow-read --allow-env tests/presence/ai_visibility_test.mjs
// Pure tier: no network. Claude (the engine, the extraction, the ambiguity check
// and the narrative) and the business's website are scripted stand-ins; the
// database is the in-memory fake from free_tools_fake.mjs.
import { makeFake, setFakeEnv } from './fixtures/free_tools_fake.mjs';

setFakeEnv();
Deno.env.set('ANTHROPIC_KEY', 'sk-test');
const fake = makeFake();
globalThis.fetch = fake.fetch;

const { buildPrompts } = await import('../../supabase/functions/_shared/tools/ai_visibility/prompts.ts');
const { sameBusiness, nameTokens, domainOf } = await import('../../supabase/functions/_shared/tools/ai_visibility/extract.ts');
const { readClaudeAnswer, ENGINES } = await import('../../supabase/functions/_shared/tools/ai_visibility/engines.ts');
const { agentAllowed } = await import('../../supabase/functions/_shared/tools/ai_visibility/readiness.ts');
const { scoreAll, competitorsFrom, sourcesFrom } = await import('../../supabase/functions/_shared/tools/ai_visibility/score.ts');
const { handler, scanDeps } = await import('../../supabase/functions/ai-visibility/handler.ts');
const { publicReport } = await import('../../supabase/functions/_shared/tools/report_view.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

// ── prompts ──
const P = buildPrompts({ businessName: 'Saffron & Shear', city: 'Burbank', businessType: 'salon', searchPhrases: 'balayage, color correction', url: null, detail: '' });
ok('prompts: 5 unbranded + 2 branded', P.filter((p) => p.kind === 'unbranded').length === 5 && P.filter((p) => p.kind === 'branded').length === 2);
ok('prompts: the visitor\'s search phrase goes into the industry question', P[4].text === "What's the best place for balayage in Burbank?");
ok('prompts: branded questions name the business and city', P[5].text === 'What do you know about Saffron & Shear in Burbank?' && /Saffron & Shear in Burbank any good/.test(P[6].text));
ok('prompts: the street/neighborhood detail is used when given', buildPrompts({ businessName: 'Joe\'s Pizza', city: 'Burbank', businessType: 'restaurant', searchPhrases: '', url: null, detail: 'on Magnolia' })[5].text.includes("Joe's Pizza (on Magnolia) in Burbank"));
ok('prompts: restaurant default industry question is date night', buildPrompts({ businessName: 'X', city: 'Pasadena', businessType: 'restaurant', searchPhrases: '', url: null, detail: '' })[4].text === 'Where should I eat for date night in Pasadena?');

// ── fuzzy matching ──
const bac = { name: 'Bacchus Kitchen', city: 'Pasadena' };
ok('match: "Bacchus Kitchen + Wine Bar" counts as Bacchus Kitchen', sameBusiness(bac, { name: 'Bacchus Kitchen + Wine Bar', city: 'Pasadena' }));
ok('match: works the other way round and ignores punctuation/case', sameBusiness({ name: 'Bacchus Kitchen + Wine Bar', city: 'Pasadena' }, { name: 'bacchus kitchen', city: null }));
ok('match: a namesake in another city does not count', !sameBusiness(bac, { name: 'Bacchus Kitchen', city: 'Phoenix' }));
ok('match: a different business sharing one word does not count', !sameBusiness(bac, { name: 'Bacchus Wine Bar', city: 'Pasadena' }) && !sameBusiness({ name: 'Bar', city: 'X' }, { name: 'Bar Amá', city: null }));
const { cacheKeyFor } = await import('../../supabase/functions/_shared/tools/guard.ts');
ok('cache key: "Cedar & Core" and "cedar and core" share a slot', cacheKeyFor('ai_visibility', { business_name: 'Cedar & Core', city: 'Burbank' }) === cacheKeyFor('ai_visibility', { business_name: 'cedar and core', city: 'BURBANK' }));
ok('match: "&" and "and" are the same', nameTokens('Cedar & Core').join(' ') === nameTokens('Cedar and Core').join(' '));

// ── reading a Claude answer ──
const read = readClaudeAnswer([
  { type: 'server_tool_use', name: 'web_search', input: { query: 'x' } },
  { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.yelp.com/biz/a', title: 'A - Yelp' }, { type: 'web_search_result', url: 'https://eater.com/la', title: 'Eater' }] },
  { type: 'text', text: 'Try Union.', citations: [{ type: 'web_search_result_location', url: 'https://www.yelp.com/biz/a', title: 'A - Yelp', cited_text: '…' }] },
  { type: 'text', text: ' Or Bacchus Kitchen.' },
]);
ok('engine: answer text joined, sources from results and citations, deduplicated', read.text === 'Try Union. Or Bacchus Kitchen.' && read.sources.length === 2 && domainOf(read.sources[0].url) === 'yelp.com');
ok('engine: only Claude is enabled for Phase 3', ENGINES.map((e) => e.id).join() === 'claude');

// ── robots for AI crawlers ──
ok('robots: a GPTBot-only block blocks just GPTBot', !agentAllowed('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /', 'gptbot') && agentAllowed('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /', 'claudebot'));
ok('robots: "User-agent: * / Disallow: /" blocks every AI crawler', ['gptbot', 'claudebot', 'perplexitybot', 'google-extended'].every((a) => !agentAllowed('User-agent: *\nDisallow: /', a)));
ok('robots: no rules means allowed', agentAllowed('', 'gptbot'));

// ── scoring ──
const ex = (names, pos, extra = {}) => ({ businesses: names.map((n) => ({ name: n, city: null })), targetFound: pos != null, targetPosition: pos, targetDescription: '', knows: 'no', describedCorrectly: true, flags: [], ...extra });
const rec = (kind, extraction, sources = []) => ({ engine: 'claude', engineName: 'Claude', promptId: 'x', kind, question: 'q', ok: true, sources, extraction });
const recs = [
  rec('unbranded', ex(['Bacchus Kitchen', 'Union'], 1)),
  rec('unbranded', ex(['Union', 'Bacchus Kitchen'], 2)),
  rec('unbranded', ex(['Union', 'Sushi Ichiban', 'Perle', 'Bacchus Kitchen'], 4)),
  rec('unbranded', ex(['Union', 'Perle'], null), [{ url: 'https://www.yelp.com/x', title: '' }]),
  rec('unbranded', ex(['Union'], null), [{ url: 'https://www.yelp.com/y', title: '' }]),
  rec('branded', ex([], null, { knows: 'yes', describedCorrectly: true })),
  rec('branded', ex([], null, { knows: 'vague', describedCorrectly: true, flags: [{ type: 'wrong_hours', detail: 'Said it opens at 9am.' }] })),
];
const s = scoreAll(recs, { checked: false, reason: 'no_url' });
ok('score: recommendation rate weighted by position (1st 1.0, 2nd-3rd 0.7, lower 0.4)', s.rec === Math.round(((1 + 0.7 + 0.4) / 5) * 100));
ok('score: awareness 100 for knew-and-correct, 50 for vague', s.aw === 75);
ok('score: accuracy is 100 minus 25 per distinct flag', s.acc === 75);
ok('score: with no website, readiness is left out and the rest re-weighted', s.pillars[3].score === null && s.pillars[3].note === 'No website given' && s.overall === Math.round((s.rec * 40 + s.aw * 25 + s.acc * 20) / 85));
const withReady = scoreAll(recs, { checked: true, score: 50, checks: [], facts: {}, homeUrl: 'https://x.com/', pagesRead: [] });
ok('score: with a website, 40/25/20/15', withReady.overall === Math.round((s.rec * 40 + s.aw * 25 + s.acc * 20 + 50 * 15) / 100));
const comps = competitorsFrom(recs, bac);
ok('competitors: counted once per answer, ranked, and "ranked above you" when ahead or you were absent', comps[0].name === 'Union' && comps[0].mentions === 5 && comps[0].aboveYou === true && comps.find((c) => c.name === 'Perle').mentions === 2 && comps.length <= 5);
const srcs = sourcesFrom(recs, 'bacchuskitchen.com');
const { canonicalSource } = await import('../../supabase/functions/_shared/tools/ai_visibility/score.ts');
ok('sources: country and city editions merge (tripadvisor.in, la.eater.com, m.yelp.com)', canonicalSource('tripadvisor.in') === 'tripadvisor.com' && canonicalSource('tripadvisor.co.uk') === 'tripadvisor.com' && canonicalSource('la.eater.com') === 'eater.com' && canonicalSource('m.yelp.com') === 'yelp.com' && canonicalSource('glowupfinder.com') === 'glowupfinder.com');
ok('sources: counted per answer, directories marked', srcs[0].domain === 'yelp.com' && srcs[0].count === 2 && srcs[0].directory === true);

// ── the function end to end, with scripted Claude ──
// The scenario says, per question, what the engine answers and what extraction reads from it.
function scenario(map) {
  const calls = { engine: 0, extract: 0, ambiguity: 0, narrative: 0 };
  const respond = (obj, status = 200) => Promise.resolve(new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } }));
  const fn = (url, init) => {
    const body = JSON.parse(init.body);
    const sys = String(body.system || '');
    const text = (o) => respond({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(o) }], usage: { input_tokens: 800, output_tokens: 200 } });
    if (body.tools) {
      calls.engine++;
      const q = body.messages[0].content;
      const s = map.answer(q);
      if (!s) return respond({ type: 'error', error: { message: 'overloaded' } }, 529);
      return respond({ stop_reason: 'end_turn', content: [{ type: 'web_search_tool_result', content: (s.sources || []).map((u) => ({ type: 'web_search_result', url: u, title: '' })) }, { type: 'text', text: s.text }], usage: { input_tokens: 5000, output_tokens: 600, server_tool_use: { web_search_requests: 2 } } });
    }
    if (sys.startsWith('You decide whether a business name')) { calls.ambiguity++; return text({ ambiguous: !!map.ambiguous, reason: map.ambiguous ? 'A chain with many locations.' : 'Distinctive name.' }); }
    if (sys.startsWith('You read one answer')) {
      calls.extract++;
      const q = /Question asked: (.*)\n/.exec(body.messages[0].content)[1];
      const s = map.answer(q);
      return text({ businesses_mentioned: s.names.map((n) => ({ name: n, city: null })), target_mentioned: false, target_description: s.desc || '', knows_business: s.knows || 'no', described_correctly: !(s.flags || []).length, accuracy_flags: s.flags || [] });
    }
    calls.narrative++;
    return map.narrativeDown ? respond({ type: 'error' }, 529) : text(map.narrative || { summary: 'x', findings: [], top_three: [] });
  };
  return { fn, calls };
}

const req = (body, ip) => new Request('https://x/functions/v1/ai-visibility', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, origin: 'https://tools.davisdigitalstudio.com' }, body: JSON.stringify({ turnstile_token: 'good-token', ...body }) });
const readAll = async (r) => (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const lastRow = () => fake.state.tables.tool_reports[fake.state.tables.tool_reports.length - 1];
Object.assign(scanDeps, { guard: async (raw) => new URL(raw) });

let r = await handler(req({ business_name: '', city: 'Burbank' }, '198.51.100.1'));
ok('function: missing business name is a 400 with a plain message', r.status === 400 && /business name/.test((await r.json()).message));
r = await handler(req({ business_name: 'Bacchus Kitchen', city: 'Burbank', turnstile_token: 'bad-token' }, '198.51.100.1'));
ok('function: failed Turnstile is a 403', r.status === 403);

// Cedar & Core: fake business. Never named, unknown by name → "AI doesn't know you exist yet".
let sc = scenario({
  answer: (q) => /Cedar/.test(q) ? { text: "I don't have information about a business called Cedar & Core in Burbank.", names: [], knows: 'no' }
    : { text: 'Try Burbank Pilates Co or CorePower Yoga.', names: ['Burbank Pilates Co', 'CorePower Yoga'], sources: ['https://www.yelp.com/search?x', 'https://classpass.com/burbank'] },
  narrativeDown: true,
});
Object.assign(scanDeps, { aiFetch: sc.fn });
r = await handler(req({ business_name: 'Cedar & Core', city: 'Burbank', business_type: 'health and wellness' }, '198.51.100.2'));
let events = await readAll(r);
let doneEv = events.find((e) => e.type === 'done');
let row = lastRow();
const cedarFull = publicReport({ ...row, unlocked: true });
ok('Cedar & Core: report saved; asked 7 questions, read 7 answers, 1 ambiguity check', !!doneEv && sc.calls.engine === 7 && sc.calls.extract === 7 && sc.calls.ambiguity === 1);
ok('Cedar & Core: headline finding is "AI doesn\'t know you exist yet"', cedarFull.findings[0]?.title === "AI doesn't know you exist yet" && cedarFull.findings[0].priority === 'Fix now');
ok('Cedar & Core: accuracy left out when AI never mentioned it, so the overall score is 0', row.scores.pillars[2].score === null && row.scores.pillars[2].note === 'AI said nothing about you to check' && row.scores.overall === 0);
ok('Cedar & Core: appeared in 0 of 5, top competitor named, recommendation 0', row.scores.highlights[0].value === '0 of 5 answers' && row.scores.highlights[1].value === 'Burbank Pilates Co' && row.scores.pillars[0].score === 0);
ok('Cedar & Core: snapshot wording from the spec is on the report', row.scores.notes[0] === "Based on live AI queries run today through each company's API. Answers vary by person and day, so treat this as a snapshot.");
ok('Cedar & Core: Claude narrative down → template summary still says 0 of 5', /0 of 5 answers/.test(row.findings.summary) && row.raw_results.narrative.source === 'template');
ok('Cedar & Core: progress streamed in order (asking → reading → writing)', ['asking', 'reading', 'writing'].every((s, i, a) => { const idx = events.findIndex((e) => e.step === s); return idx >= 0 && (i === 0 || idx > events.findIndex((e) => e.step === a[i - 1])); }) && events.some((e) => e.step === 'asking' && e.done === 7 && e.total === 7));
const teaser = doneEv.report;
ok('teaser: score, "appeared in", top competitor and summary only (no findings, no pillars)', teaser.highlights.length === 2 && teaser.findings.length === 0 && teaser.pillars.length === 0 && !!teaser.summary && teaser.tables.length === 0);
ok('full report: competitors, sources and the questions tables', ['Who AI recommends instead', 'Sources AI cited', 'The questions we asked', 'Answers by AI'].every((t) => cedarFull.tables.some((x) => x.title === t)) && cedarFull.tables.find((t) => t.title === 'Who AI recommends instead').rows[0][0] === 'Burbank Pilates Co');
ok('cost logged: 7 engine calls + 7 extractions + checks', fake.state.tables.tool_usage_log.some((u) => u.kind === 'scan' && u.report_id === row.id && u.cost_usd > 0.1));

// Bacchus Kitchen: real, appears in 3 of 5, Union beats it, wrong hours from Yelp, website blocks GPTBot.
const SITE = 'https://www.bacchus.example';
const sitePages = {
  [`${SITE}/`]: `<html lang="en"><head><title>Bacchus Kitchen | Pasadena Restaurant & Wine Bar</title><script type="application/ld+json">{"@type":"Restaurant","name":"Bacchus Kitchen","telephone":"(626) 555-0100","address":{"streetAddress":"1384 E Washington Blvd","addressLocality":"Pasadena"},"openingHours":"Tu-Su 17:00-22:00"}</script></head><body><nav><a href="/about">About</a><a href="/menu">Menu</a></nav><h1>Bacchus Kitchen, Pasadena</h1><p>${'wine '.repeat(200)}</p></body></html>`,
  [`${SITE}/about`]: `<html><head><title>About</title></head><body><h1>About</h1><p>${'story '.repeat(200)}</p></body></html>`,
  [`${SITE}/menu`]: `<html><head><title>Menu</title></head><body><h1>Menu</h1><p>${'dish '.repeat(200)}</p></body></html>`,
};
const siteFetch = (u) => {
  const url = String(u);
  if (url === `${SITE}/robots.txt`) return Promise.resolve(new Response('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n', { status: 200 }));
  if (sitePages[url]) return Promise.resolve(new Response(sitePages[url], { status: 200 }));
  return Promise.resolve(new Response('nope', { status: 404 }));
};
// Named in the first three local questions only; decided by the question, so
// the engine call and the extraction of the same answer always agree.
const namedIn = /best restaurant|recommend a restaurant|top rated restaurant/;
sc = scenario({
  answer: (q) => {
    if (/What do you know about Bacchus/.test(q)) return { text: 'Bacchus Kitchen is a wine bar in Pasadena, open from 9am.', names: ['Bacchus Kitchen'], knows: 'yes', flags: [{ type: 'wrong_hours', detail: 'It said Bacchus Kitchen opens at 9am.' }], sources: ['https://www.yelp.com/biz/bacchus'] };
    if (/Bacchus/.test(q)) return { text: 'Bacchus Kitchen + Wine Bar in Pasadena is well liked.', names: ['Bacchus Kitchen + Wine Bar'], knows: 'yes', sources: ['https://www.yelp.com/biz/bacchus'] };
    return namedIn.test(q) ? { text: 'Union, then Bacchus Kitchen + Wine Bar.', names: ['Union', 'Bacchus Kitchen + Wine Bar'], sources: ['https://www.yelp.com/x', 'https://la.eater.com/y'] } : { text: 'Union or Perle.', names: ['Union', 'Perle'], sources: ['https://www.yelp.com/z'] };
  },
  narrative: { summary: 'You come up in 3 of 5 local answers, but Union is named in 5.', top_three: ['a', 'b', 'c'], findings: [] },
});
Object.assign(scanDeps, { aiFetch: sc.fn, siteFetch });
r = await handler(req({ business_name: 'Bacchus Kitchen', city: 'Pasadena', business_type: 'restaurant', url: 'www.bacchus.example' }, '198.51.100.3'));
events = await readAll(r);
row = lastRow();
const bacFull = publicReport({ ...row, unlocked: true });
const ids = row.findings.items.map((f) => f.title);
ok('Bacchus: appeared in 3 of 5 (fuzzy match on "+ Wine Bar")', row.scores.highlights[0].value === '3 of 5 answers');
ok('Bacchus: Union is the top competitor, ranked above', row.raw_results.competitors[0].name === 'Union' && row.raw_results.competitors[0].mentions === 5 && row.raw_results.competitors[0].aboveYou);
ok('Bacchus: "AI recommends Union instead" names the source (Yelp)', ids.some((t) => t === 'AI recommends Union instead') && /Yelp/.test(JSON.stringify(row.findings.items.find((f) => f.title === 'AI recommends Union instead'))));
ok('Bacchus: wrong hours flagged, and where it came from', ids.includes('AI has some of your facts wrong') && /9am/.test(JSON.stringify(row.findings.items)) && row.scores.pillars[2].score === 75);
ok('Bacchus: website read for readiness; GPTBot block found', row.raw_results.readiness.checked && row.raw_results.readiness.checks.find((c) => c.id === 'ai_crawlers').status === 'warn' && ids.includes('Your website blocks some AI crawlers'));
ok('Bacchus: known facts from the site fed to extraction (hours)', row.raw_results.readiness.facts.hours === 'Tu-Su 17:00-22:00' && /1384 E Washington/.test(row.raw_results.readiness.facts.address));
ok('Bacchus: "website" step streamed when a URL is given', events.some((e) => e.step === 'website'));
ok('Bacchus: readiness table and wrong-facts table in the full report', bacFull.tables.some((t) => t.title === 'AI readiness of your website') && bacFull.tables.some((t) => t.title === 'Wrong facts in AI answers'));
ok('Bacchus: Claude summary kept (its numbers are real)', row.findings.summary === 'You come up in 3 of 5 local answers, but Union is named in 5.');

// Ambiguous name → ask for the street; no engine calls spent.
sc = scenario({ ambiguous: true, answer: () => ({ text: 'x', names: [] }) });
Object.assign(scanDeps, { aiFetch: sc.fn });
r = await handler(req({ business_name: 'Starbucks', city: 'Los Angeles' }, '198.51.100.4'));
let ev = (await readAll(r)).find((e) => e.type === 'needs_detail');
ok('ambiguous: a chain asks for the street or neighborhood, before any paid AI calls', !!ev && /street or neighborhood/.test(ev.message) && sc.calls.engine === 0);
sc = scenario({ ambiguous: true, answer: () => ({ text: 'Starbucks on Sunset.', names: ['Starbucks'] }), narrativeDown: true });
Object.assign(scanDeps, { aiFetch: sc.fn });
r = await handler(req({ business_name: 'Starbucks', city: 'Los Angeles', detail: 'on Sunset Blvd' }, '198.51.100.5'));
ok('ambiguous: with a street given, it runs (no second ambiguity check)', (await readAll(r)).some((e) => e.type === 'done') && sc.calls.ambiguity === 0);

// Every engine down → friendly retry, no report.
const before = fake.state.tables.tool_reports.length;
sc = scenario({ answer: () => null });
Object.assign(scanDeps, { aiFetch: sc.fn });
r = await handler(req({ business_name: 'Valleyline Plumbing', city: 'Glendale', business_type: 'home services' }, '198.51.100.6'));
ev = (await readAll(r)).find((e) => e.type === 'error');
ok('engines down: friendly retry message and no report saved', ev?.error === 'engines_failed' && /try again/i.test(ev.message) && fake.state.tables.tool_reports.length === before);

// Cache: same business + city within 7 days → a locked copy, no AI calls.
sc = scenario({ answer: () => ({ text: 'x', names: [] }) });
Object.assign(scanDeps, { aiFetch: sc.fn });
r = await handler(req({ business_name: 'cedar and core', city: 'BURBANK' }, '198.51.100.7'));
const cached = await r.json();
ok('cache: a repeat within 7 days is a fresh locked copy, no AI calls', cached.type === 'done' && cached.cached === true && sc.calls.engine === 0 && sc.calls.ambiguity === 0);

// ── structural ──
const file = (p) => Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url));
const js = file('ai-visibility.js');
ok('page: never parses report data as HTML', !/innerHTML/.test(js));
ok('page: fires scan_started, scan_completed and scan_failed; handles needs_detail', ['scan_started', 'scan_completed', 'scan_failed'].every((e) => js.includes(`'${e}'`)) && js.includes("'needs_detail'"));
ok('redirects: /ai-visibility serves the page', /^\/ai-visibility\s+\/ai-visibility\.html\s+200$/m.test(file('_redirects')));
ok('deploy: ai-visibility ships to production', file('.github/workflows/deploy.yml').includes('functions deploy ai-visibility --no-verify-jwt --project-ref ${{ secrets.SUPABASE_PROJECT_REF_PROD }}'));
const eng = file('supabase/functions/_shared/tools/ai_visibility/engines.ts');
ok('engine: Claude Sonnet 5.5, live web search, no temperature', eng.includes("'claude-sonnet-5-5'") && eng.includes("'web_search_20260209'") && !/temperature/.test(eng.replace(/\/\/.*$/gm, '')));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ FREE TOOLS PHASE 3 AI VISIBILITY: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
