// ── List item 175: site controls borrowed from Squarespace ──────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/site_controls_test.mjs
// The AI crawler switch: off, the published robots.txt asks every known AI crawler to
// stay out, search engines untouched; on (absent), the site draws byte for byte as before.
// The visitor password: Netlify's site-wide password, put on only once the live site
// itself asks a stranger for it (a 401), and taken straight back off when it doesn't.
// No Supabase, no Netlify: both are answered by a stub, and nothing leaves.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', NETLIFY_AUTH_TOKEN: 'fake' })) Deno.env.set(k, v);
const P = '../../supabase/functions/presence';
const { AI_CRAWLERS, aiCrawlerGroup, withAiCrawlerChoice, blocksAiCrawlers } = await import(`${P}/lib/ai_crawlers.ts`);
const { AI_BOTS, agentAllowed } = await import('../../supabase/functions/_shared/tools/ai_visibility/readiness.ts');
const { renderSnapshot } = await import(`${P}/lib/render.ts`);
const { describeChanges } = await import(`${P}/lib/diff.ts`);
const { shapePreviewStatus } = await import(`${P}/lib/preview_env.ts`);
const { probeSite } = await import(`${P}/monitor/heartbeat.ts`);
const { handleSitePassword, VISITOR_PASSWORD_MIN } = await import(`${P}/routes/publish.ts`);
const { setSitePassword } = await import(`${P}/lib/netlify.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url));

// ═══ 1. the AI crawler switch ═══
{
  ok('list: every AI crawler the free AI Visibility Check looks for is on the switch\'s list', AI_BOTS.every((b) => AI_CRAWLERS.includes(b.agent)), AI_BOTS.map((b) => b.agent).join(','));
  ok('list: no search engine crawler is on it', !AI_CRAWLERS.some((a) => /^(googlebot|bingbot|duckduckbot|applebot|yandex|baiduspider|slurp)$/.test(a)));
  ok('switch: absent and true both mean allowed', !blocksAiCrawlers(undefined) && !blocksAiCrawlers({}) && !blocksAiCrawlers({ ai_crawlers: true }) && blocksAiCrawlers({ ai_crawlers: false }));
  const files = { 'robots.txt': 'User-agent: *\nAllow: /\nDisallow: /thanks/\n\nSitemap: https://example.com/sitemap.xml\n', 'index.html': '<p>hi</p>' };
  ok('allowed: the drawn files come back untouched (the same object)', withAiCrawlerChoice(files, {}) === files);
  const blocked = withAiCrawlerChoice(files, { ai_crawlers: false })['robots.txt'];
  ok('blocked: the template\'s own rules and sitemap stay', blocked.startsWith(files['robots.txt'].trimEnd()) && blocked.includes('Sitemap: https://example.com/sitemap.xml'));
  ok('blocked: one group names every AI crawler and disallows the whole site', blocked.includes(aiCrawlerGroup()) && AI_CRAWLERS.every((a) => blocked.includes(`User-agent: ${a}\n`)) && /Disallow: \/\n$/.test(blocked));
  ok('blocked: the AI crawlers read "keep out" (the free tool\'s own robots reader agrees)', AI_BOTS.every((b) => !agentAllowed(blocked, b.agent)));
  ok('blocked: Google and Bing search still read the whole site', agentAllowed(blocked, 'googlebot') && agentAllowed(blocked, 'bingbot'));
  ok('allowed: the AI crawlers may read the site', AI_BOTS.every((b) => agentAllowed(files['robots.txt'], b.agent)));

  // the real publish draw, on a real template
  const fx = JSON.parse(read('supabase/functions/presence/templates/business-classic/1.0.0/fixture.json'));
  fx.template_slug = 'business-classic'; fx.template_version = '1.0.0';
  const SITE = { baseUrl: 'https://example.com' };
  const on = await renderSnapshot(fx, SITE);
  const offSnap = structuredClone(fx); offSnap.content.settings = { ...(offSnap.content.settings || {}), ai_crawlers: false };
  const off = await renderSnapshot(offSnap, SITE);
  ok('publish: switched off, the published robots.txt asks the AI crawlers to stay out', off['robots.txt'].includes('User-agent: gptbot') && !agentAllowed(off['robots.txt'], 'claudebot') && agentAllowed(off['robots.txt'], 'googlebot'));
  ok('publish: switched on, robots.txt is the template\'s own', !on['robots.txt'].includes('gptbot') && on['robots.txt'].startsWith('User-agent: *'));
  ok('publish: only robots.txt differs between the two', Object.keys(on).every((k) => k === 'robots.txt' || String(on[k]) === String(off[k])));
  const offCh = describeChanges(offSnap.content, fx.content).changes.map((c) => c.sentence);
  const onCh = describeChanges(fx.content, offSnap.content).changes.map((c) => c.sentence);
  ok('changes: switching off is a change to publish, in words, and says search is unaffected', offCh.some((s) => /AI assistants like ChatGPT, Claude and Perplexity are asked not to read your site\. Google and Bing search are not affected\./.test(s)));
  ok('changes: switching back on is too', onCh.includes('AI assistants can read your site again.'));
  ok('changes: nothing to say when both are on', !describeChanges(fx.content, structuredClone(fx.content)).changes.some((c) => /AI assistants/.test(c.sentence)));

  const content = read('supabase/functions/presence/routes/content.ts');
  const serializer = read('supabase/functions/presence/lib/serializer.ts');
  ok('settings: /settings takes ai_crawlers as a yes/no', /ai_crawlers: \{ kind: 'bool' \}/.test(content));
  ok('settings: the read and save step down without the 0159 column, ahead of the older packs', /CRAWLER_SETTINGS_COLS = 'ai_crawlers'/.test(content) && /OPTIONAL_SETTINGS_COLS = \[(?:[A-Z_]+_SETTINGS_COLS, )*CRAWLER_SETTINGS_COLS, (?:[A-Z_]+_SETTINGS_COLS, )*VISIT_SETTINGS_COLS,/.test(content) && /\+ ',' \+ CRAWLER_SETTINGS_COLS\b/.test(content));
  ok('snapshot: only an off switch reaches the snapshot, so an allowed site\'s snapshot is unchanged', /\.\.\.\(settings\.ai_crawlers === false \? \{ ai_crawlers: false \} : \{\}\)/.test(serializer));
}

// ═══ 2. the migration and its apply pack ═══
{
  const mig = read('supabase/migrations/0159_site_availability_ai_crawlers.sql');
  const pack = read('docs/presence/APPLY-0159-prod.sql');
  for (const [name, src] of [['migration 0159', mig], ['apply pack 0159', pack]]) {
    ok(`${name}: adds the visitor password time, empty`, /alter table public\.presence_sites\s+add column if not exists visitor_password_at timestamptz;/.test(src));
    ok(`${name}: adds the AI switch, on by default`, /alter table public\.presence_settings\s+add column if not exists ai_crawlers boolean not null default true;/.test(src));
    ok(`${name}: never a column for the password itself`, !/add column if not exists \w*password(?!_at)\w*/.test(src));
  }
}

// ═══ 3. the visitor password ═══
const SITE_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const A = { id: SITE_ID, client_id: 'cccccccc-1111-4111-8111-cccccccccccc', status: 'live', last_published_at: '2026-01-01T00:00:00Z', template_slug: 'business-classic', template_version: '1.0.0', custom_domain: 'alpha.example', netlify_site_id: 'nf-1', edition: 'presence' };
const HOME = 'https://presence-aaaaaaaa1111.netlify.app/';
let world;
function fresh(fx = {}) {
  world = { netlify: [], probes: [], writes: [], events: [], hostAccepts: fx.hostAccepts !== false, protectedAfter: fx.protectedAfter ?? true,
    protectedNow: !!fx.hadPassword, column: fx.column !== false, live: fx.live !== false, hadPassword: !!fx.hadPassword };
}
const reply = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.netlify.com') {
    const body = init.body ? JSON.parse(init.body) : null;
    world.netlify.push({ method, path: u.pathname, body });
    if (!world.hostAccepts) return reply({ message: 'nope' }, 422);
    world.protectedNow = !!body.password && world.protectedAfter;
    return reply({ id: 'nf-1' });
  }
  if (u.href === HOME) { world.probes.push(u.href); return new Response('page', { status: world.protectedNow ? 401 : 200 }); }
  if (u.hostname !== 'stub.local') return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', '');
  const q = decodeURIComponent(u.search);
  if (method !== 'GET') {
    const body = init.body ? JSON.parse(init.body) : null;
    if (table === 'presence_change_events') world.events.push(body); else world.writes.push({ table, body });
    return reply(null, 201);
  }
  if (table === 'presence_publishes') return reply(world.live ? [{ id: 'p1' }] : []);
  if (table === 'presence_sites' && q.includes('visitor_password_at')) return world.column ? reply([{ visitor_password_at: world.hadPassword ? '2026-11-01T00:00:00Z' : null }]) : reply({ message: 'column does not exist' }, 400);
  return reply([]);
};
globalThis.setTimeout = ((fn) => { fn(); return 0; });   // the stranger checks wait between tries; not here
const req = (body) => new Request('http://stub.local/functions/v1/presence/site/password', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const principal = { kind: 'client', userId: 'u1', tenantId: null, role: 'client', email: 'owner@example.com', jwt: 'jwt', requestId: 't' };
const run = async (body, fx) => { fresh(fx); const r = await handleSitePassword(req(body), A, principal, {}); return { status: r.status, body: await r.json() }; };
const quiet = async (fn) => { const l = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = l; } };
{
  fresh();
  await setSitePassword('nf-1', 'open sesame');
  ok('netlify: the password goes to the site itself, once, as Netlify\'s site-wide password', world.netlify.length === 1 && world.netlify[0].method === 'PATCH' && world.netlify[0].path === '/api/v1/sites/nf-1' && world.netlify[0].body.password === 'open sesame');

  let r = await quiet(() => run({ password: 'open sesame' }));
  ok('set: the site asks strangers for it, so it is put on', r.status === 200 && r.body.data.password === true, `${r.status} ${r.body.error || ''}`);
  ok('set: it asked the live site itself, at its own Netlify address', world.probes.length >= 1 && world.probes.every((p) => p === HOME));
  ok('set: only when it went on is it noted, and the password is never written down by us', world.writes.length === 1 && world.writes[0].table.startsWith('presence_sites') && typeof world.writes[0].body.visitor_password_at === 'string' && !JSON.stringify(world.writes).includes('open sesame'));
  ok('set: the change is in the site\'s history', world.events.length === 1 && /visitor password/i.test(world.events[0].summary));

  r = await quiet(() => run({ password: 'open sesame' }, { protectedAfter: false }));
  ok('set: when the site doesn\'t start asking, nothing is claimed', r.status === 502 && r.body.error === 'not_protected' && world.writes.length === 0 && world.events.length === 0);
  ok('set: and the password is taken straight back off', world.netlify.length === 2 && world.netlify[1].body.password === '');

  r = await quiet(() => run({ password: 'open sesame' }, { hostAccepts: false }));
  ok('set: hosting refuses it → the site is unchanged and says so', r.status === 502 && r.body.error === 'host_refused' && world.writes.length === 0 && world.probes.length === 0);

  r = await quiet(() => run({ password: '' }, { hadPassword: true }));
  ok('remove: an empty password takes it off once strangers can see the site again', r.status === 200 && r.body.data.password === false && world.netlify[0].body.password === '' && world.writes[0].body.visitor_password_at === null);
  r = await quiet(() => run({ password: '' }));
  ok('remove: nothing to take off → a plain answer, nothing sent', r.status === 409 && r.body.error === 'no_password' && world.netlify.length === 0);

  r = await quiet(() => run({ password: 'x'.repeat(VISITOR_PASSWORD_MIN - 1) }));
  ok('check: too short a password is refused before anything is sent', r.status === 422 && world.netlify.length === 0);
  r = await quiet(() => run({ password: 'open sesame' }, { live: false }));
  ok('check: a site never published has nothing to protect yet', r.status === 409 && r.body.error === 'not_live' && world.netlify.length === 0);
  r = await quiet(() => run({ password: 'open sesame' }, { column: false }));
  ok('check: before the 0159 apply pack, it says it isn\'t available and sends nothing', r.status === 503 && r.body.error === 'unavailable' && world.netlify.length === 0);

  const st = shapePreviewStatus({ draftChanges: 0, preview: null, live: { last_published_at: '2026-01-01T00:00:00Z', summary: null }, baseUrl: 'https://app.example', passwordAt: '2026-11-11T00:00:00Z' });
  ok('status: the site\'s status says since when it has a password', st.live.password_since === '2026-11-11T00:00:00Z' && shapePreviewStatus({ draftChanges: 0, preview: null, live: null, baseUrl: 'x' }).live.password_since === null);

  const probe = await probeSite('https://alpha.example/', async () => new Response('', { status: 401 }));
  ok('uptime: a site asking for its password is up, not down', probe.ok === true && probe.status === 401);
  ok('uptime: a broken site is still down', (await probeSite('https://alpha.example/', async () => new Response('', { status: 503 }))).ok === false);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SITE CONTROLS (item 175): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
