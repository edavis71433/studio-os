// ── Builder list item 426 (Nov 22 review): plans in the words Sites uses ──
//   deno run --allow-read --allow-env tests/presence/plan_words_426_test.mjs
// Analytics' customer table said "presence · ready", Settings said "Your plan: Presence",
// the account menu "Studio OS plan", while Sites called the same plans "Website + tools"
// and "Business tools". One map in commerce/catalog.ts now words a plan for every screen;
// agency/sites.ts keeps its own copy until it can import this one, so the two must agree.
// The Analytics table reads the words from the portfolio rows (agency/portfolio.ts).
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) if (!Deno.env.get(k)) Deno.env.set(k, v);
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const P = '../../supabase/functions/presence';
const { PLAN_WORDS, planWords, PLANS } = await import(`${P}/commerce/catalog.ts`);
const sites = await import(`${P}/agency/sites.ts`);
const { buildPortfolio } = await import(`${P}/agency/portfolio.ts`);

ok('the words are the ones Sites puts on a card, plan for plan', JSON.stringify(Object.entries(PLAN_WORDS).sort()) === JSON.stringify(Object.entries(sites.PLAN_WORDS).sort()));
ok('every plan in the catalog has its words', PLANS.every((p) => typeof PLAN_WORDS[p.key] === 'string' && PLAN_WORDS[p.key].length > 0), PLANS.map((p) => p.key).join(','));
ok('…and none of them is the catalog’s own name ("Presence", "CMS", "Business OS")', PLANS.every((p) => !/^(Presence|CMS|Business OS|Presence Monitor|Presence Managed|Studio OS)$/.test(planWords(p.key))));
ok('the main plan reads "Website + tools", the watch plan "Watch"', planWords('presence') === 'Website + tools' && planWords('presence_monitor') === 'Watch' && planWords('business_os_only') === 'Business tools');
ok('an unknown plan reads in plain letters, never its code; no plan reads nothing', planWords('new_thing') === 'New thing' && planWords('') === '' && planWords(null) === '' && planWords(undefined) === '');
ok('Sites words a card the same way', sites.planOf({ client_id: 'c', plan: 'presence', status: 'active' }, '2026-11-22T12:00:00Z').words === planWords('presence'));

// the portfolio rows Analytics draws from
const base = { sites: [{ id: 's1', edition: 'presence', status: 'ready', last_published_at: null, custom_domain: null }, { id: 's2', edition: 'monitor', status: 'ready', last_published_at: null, custom_domain: null }],
  links: [], clientNames: { s1: 'A', s2: 'B' }, moments: [], evidence: [], opportunities: [], plans: [], drafts: [], connections: [], reviewReports: [], brandReports: [], lastChange: {}, nowIso: '2026-11-22T12:00:00Z' };
{
  const rows = buildPortfolio({ ...base, planWordsBySite: { s1: 'Website + tools', s2: 'Watch' } });
  ok('each row carries its plan in those words', rows[0].plan_words === 'Website + tools' && rows[1].plan_words === 'Watch', JSON.stringify(rows.map((r) => r.plan_words)));
  ok('…and the edition and status stay codes the page no longer shows', rows[0].edition === 'presence' && rows[0].status === 'ready');
  const none = buildPortfolio({ ...base, planWordsBySite: { s1: 'No plan on file', s2: null } });
  ok('no plan row says so, as Sites does; a failed read is null (the page shows a dash)', none[0].plan_words === 'No plan on file' && none[1].plan_words === null);
  ok('a gather without the words (an older caller) gives null, never a code', buildPortfolio(base).every((r) => r.plan_words === null));
}

const passed = results.filter(Boolean).length;
console.log(`${passed} passed, ${results.length - passed} failed`);
if (passed !== results.length) Deno.exit(1);
