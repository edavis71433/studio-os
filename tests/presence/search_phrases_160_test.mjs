// ── What people type to find you (builder list item 160, part two) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/search_phrases_160_test.mjs
// The two or three phrases a business wants to be found for, each checked against every
// page's search headline, ideas from its services and area, a High task for a phrase in no
// headline, and the save through a fetch fake.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const S = await import('../../supabase/functions/presence/lib/search_phrases.ts');

// ═══ the pure rules ═══
{
  eq('a phrase is kept as people type it: lower case, single spaces, six words at most',
    [S.phraseOf('  Italian   Restaurant, BURBANK!! '), S.phraseOf('a b c d e f g h'), S.phraseOf('<b>pizza</b>')], ['italian restaurant burbank', 'a b c d e f', 'b pizza b']);
  eq('stored phrases: each once, three at most, too-short ones dropped', S.normalizePhrases({ phrases: ['Pizza Burbank', 'pizza burbank', 'x', 'catering glendale', 'wine bar burbank', 'brunch'] }).phrases, ['pizza burbank', 'catering glendale', 'wine bar burbank']);
  ok('a save of four is refused in a sentence; a save of three is kept', /Up to 3 phrases/.test(S.applyPhrases(['a b', 'c d', 'e f', 'g h']).error) && S.applyPhrases(['a b', 'c d', 'e f']).phrases.length === 3 && /as a list/.test(S.applyPhrases('a b').error));
  const H = S.pageHeadlines({ name: 'Marlow’s Kitchen', seoTitle: 'Italian restaurant in Burbank — Marlow’s Kitchen', industry: 'restaurant', pageSeo: { about: { title: 'Our story, since 2014' }, 'page:private-events': { title: 'Private dining in Glendale' } }, pages: [{ slug: 'private-events', title: 'Private events' }, { slug: 'secret', title: 'Secret' }], hidden: ['page:secret', 'faq'] });
  eq('every page’s headline, as the site writes it: the owner’s own, else the template’s; hidden pages left out',
    H.map((h) => [h.key, h.title]),
    [['home', 'Italian restaurant in Burbank — Marlow’s Kitchen'], ['offerings', 'Menu — Marlow’s Kitchen'], ['about', 'Our story, since 2014'], ['updates', 'Updates — Marlow’s Kitchen'], ['contact', 'Contact & Hours — Marlow’s Kitchen'], ['page:private-events', 'Private dining in Glendale']]);
  ok('with no search headline the home page’s is the business name', S.pageHeadlines({ name: 'Marlow’s Kitchen' })[0].title === 'Marlow’s Kitchen');
  ok('a phrase is found when every word is in one headline, little words and order aside', S.phraseFoundIn('italian restaurant burbank', H)?.key === 'home' && S.phraseFoundIn('private dining in glendale', H)?.key === 'page:private-events' && S.phraseFoundIn('burbank italian restaurants', H)?.key === 'home');
  ok('…and not when a word is missing from every headline', S.phraseFoundIn('catering burbank', H) === null && S.phraseFoundIn('', H) === null);
  const ideas = S.phraseIdeas({ industry: 'restaurant', offerings: [{ name: 'Lasagne', category: 'Mains' }, { name: 'Tiramisu', category: 'Desserts' }, { name: 'Catering', category: 'Catering' }], city: 'Burbank', serviceArea: 'Serving Burbank and Glendale', chosen: ['restaurant burbank'] });
  ok('ideas pair what the business offers with where it works, up to six', ideas.length <= 6 && ideas.includes('catering burbank') && ideas.includes('restaurant glendale') && ideas.every((i) => i.split(' ').length <= 6));
  ok('…never one already chosen', !ideas.includes('restaurant burbank'));
  ok('no places, no ideas', S.phraseIdeas({ industry: 'restaurant', offerings: [{ name: 'Pizza' }] }).length === 0);
  const { searchTasks } = await import('../../supabase/functions/presence/lib/search_tools.ts');
  const base = { edition: 'presence', live: true, customDomain: true, hidden: false, console: true, listing: true, title: true, description: true, llms: true, followed: 1, issues: null, review: null };
  const t = searchTasks({ ...base, phrases: [{ phrase: 'italian restaurant burbank', found: true }, { phrase: 'private dining glendale', found: false }] });
  const missing = t.find((x) => x.key === 'phrase:private dining glendale'), found = t.find((x) => x.key === 'phrase:italian restaurant burbank');
  ok('a phrase in no headline is a High task, open, that goes to the phrases', missing && missing.priority === 'high' && !missing.done && missing.go === 'phrases' && /Put “private dining glendale” in a page’s search headline/.test(missing.title));
  ok('a phrase already in a headline is a finished task, after the open ones', found && found.done && t.indexOf(found) > t.indexOf(missing));
  ok('no phrases, no phrase tasks: the list is as it was', searchTasks(base).every((x) => !x.key.startsWith('phrase:')));
}

// ═══ the save, through a fetch fake ═══
{
  const store = {};
  const calls = [];
  const realFetch = globalThis.fetch;
  const res = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input), method = (init.method || 'GET').toUpperCase();
    const q = new URL(url), table = q.pathname.split('/').pop();
    calls.push(`${method} ${table}`);
    if (table === 'presence_sales_templates') {
      const name = decodeURIComponent((q.searchParams.get('name') || q.searchParams.get('id') || '').replace('eq.', ''));   // a write names the row by its id, which here is its name
      if (method === 'GET') return res(store[name] ? [{ id: name, body: JSON.stringify(store[name]), updated_at: '2026-11-12T00:00:00Z' }] : []);
      const body = JSON.parse(init.body);
      if (method === 'PATCH') { if (!store[name]) return res([]); store[name] = JSON.parse(body.body); return res([{ id: name }]); }
      if (method === 'POST') { store[body.name] = JSON.parse(body.body); return res([{ id: body.name }]); }
    }
    if (table === 'presence_identity') return res([{ business_name: 'Marlow’s Kitchen', seo_title: 'Italian restaurant in Burbank — Marlow’s Kitchen', service_area: 'Serving Burbank and Glendale' }]);
    if (table === 'presence_settings') return res([{ page_seo: {}, pages: [], pages_noindex: [], industry_key: 'restaurant' }]);
    if (table === 'presence_locations') return res([{ city: 'Burbank' }]);
    if (table === 'presence_offerings') return res([{ name: 'Catering', category: 'Catering' }]);
    return res([]);
  };
  const { handlePhrasesPut, phrasesView } = await import('../../supabase/functions/presence/routes/search_tab.ts');
  const site = { id: '00000000-0000-4000-8000-000000000001', client_id: '00000000-0000-4000-8000-000000000002', status: 'live', edition: 'presence' };
  const principal = { kind: 'owner', userId: 'u1', email: 'owner@example.com' };
  const put = async (phrases) => { const r = await handlePhrasesPut(new Request('https://x.example/visibility/phrases', { method: 'PUT', body: JSON.stringify({ phrases }) }), site, principal, {}); return { status: r.status, body: await r.json() }; };
  let r = await put(['Italian restaurant Burbank', 'catering glendale']);
  ok('a save keeps the phrases, cleaned', r.status === 200 && JSON.stringify(store.__search_phrases__) === JSON.stringify({ phrases: ['italian restaurant burbank', 'catering glendale'] }), JSON.stringify(r.body).slice(0, 200));
  ok('…and answers with where each is found', r.body.data.list[0].found?.key === 'home' && r.body.data.list[1].found === null && r.body.data.max === 3);
  ok('…with ideas that leave out the chosen ones', Array.isArray(r.body.data.ideas) && !r.body.data.ideas.includes('catering glendale') && r.body.data.ideas.includes('catering burbank'));
  ok('a new phrase is also followed on Google', (store.__followed_searches__?.terms || []).map((t) => t.term).join() === 'italian restaurant burbank,catering glendale');
  store.__followed_searches__ = { terms: Array.from({ length: 10 }, (_, i) => ({ term: 'old ' + i, added_at: '', added_by: null })) };
  r = await put(['italian restaurant burbank', 'catering glendale', 'wine bar burbank']);
  ok('with ten followed already, nothing is pushed off', store.__followed_searches__.terms.length === 10 && !store.__followed_searches__.terms.some((t) => t.term === 'wine bar burbank'));
  r = await put(['a b', 'c d', 'e f', 'g h']);
  ok('four are refused and nothing changes', r.status === 422 && store.__search_phrases__.phrases.length === 3);
  const v = await phrasesView(site);
  ok('the Search tab’s read carries them', v.list.length === 3 && v.list[2].phrase === 'wine bar burbank');
  ok('…with every page’s search headline now, to pick the one a phrase belongs on', v.pages.some((h) => h.key === 'home' && /Marlow’s Kitchen/.test(h.title)) && v.pages.some((h) => h.key === 'contact'));
  ok('…and the checklist’s tasks for them, the same as GET /visibility’s', JSON.stringify(v.tasks.map((t) => [t.key, t.done, t.go])) === JSON.stringify([['phrase:italian restaurant burbank', true, null], ['phrase:catering glendale', false, 'phrases'], ['phrase:wine bar burbank', false, 'phrases']]));
  const { handlePhrasesGet } = await import('../../supabase/functions/presence/routes/search_tab.ts');
  const g = await handlePhrasesGet(site, {});
  ok('GET /visibility/phrases answers the same view, without a write', g.status === 200 && (await g.json()).data.list.length === 3);
  globalThis.fetch = realFetch;
}

// ═══ wiring ═══
{
  const idx = read('supabase/functions/presence/index.ts');
  ok('the save is routed', idx.includes(`if (route === '/visibility/phrases' && method === 'PUT') return handlePhrasesPut(req, site, principal, cors);`));
  ok('…and so is the read', idx.includes(`if (route === '/visibility/phrases' && method === 'GET') return handlePhrasesGet(site, cors);`));
  ok('saving phrases is an edit for a member', read('supabase/functions/presence/lib/site_roles.ts').includes(`'PUT /visibility/phrases',`));
  const tab = read('supabase/functions/presence/routes/search_tab.ts');
  ok('GET /visibility’s extras carry the phrases and feed the tasks', /phrasesView\(site\),/.test(tab) && /phrases: phrases\.list\.map/.test(tab));
  ok('kept as a reserved row, no migration', read('supabase/functions/presence/lib/reserved_store.ts').includes(`searchPhrases: '__search_phrases__'`));
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
