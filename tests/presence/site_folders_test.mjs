// ── Folders, tags and saved views on Sites (builder list item 176, Nov 2026) ──────
//   deno run --allow-read --allow-env --allow-net tests/presence/site_folders_test.mjs
// One folder a site; renaming or reordering keeps each folder's sites; a removed folder
// sends its sites back to No folder; moving many at once; saved views kept for the team;
// one tag onto or off several sites. The routes run against a stubbed database: only a
// role that manages clients changes anything, only the studio's own sites move, and a
// failed read is never "no folders".
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) Deno.env.set(k, v);
const P = '../../supabase/functions/presence';
const F = await import(`${P}/agency/site_folders.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const S1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa1', S2 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2', S3 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa3', OTHER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb1';

// ── the stored folders ──
{
  const f = F.normalizeFolders({ folders: [
    { id: 'f-aaaaaaaa', name: ' Retainers ', color: 'teal', sites: [S1, S2, S1, 'nope'] },
    { id: 'f-bbbbbbbb', name: 'retainers', color: 'amber', sites: [S3] },          // the same name again: dropped
    { id: 'f-cccccccc', name: 'Builds', color: 'pink', sites: [S2, S3] },          // S2 is already in Retainers
    { id: 'bad', name: 'No id', sites: [] },
  ] });
  ok('folders: valid ones, each name once', JSON.stringify(f.map((x) => x.name)) === '["Retainers","Builds"]');
  ok('folders: a site is in one folder, the first that has it', JSON.stringify(f[0].sites) === JSON.stringify([S1, S2]) && JSON.stringify(f[1].sites) === JSON.stringify([S3]));
  ok('folders: a colour that isn’t one is violet', f[1].color === 'violet' && f[0].color === 'teal');
  ok('folders: junk is no folders', F.normalizeFolders(null).length === 0 && F.normalizeFolders({ folders: 'x' }).length === 0);
  ok('folders: thirty at most', F.normalizeFolders({ folders: Array.from({ length: 40 }, (_, i) => ({ id: 'f-' + String(i).padStart(8, '0'), name: 'F' + i })) }).length === F.MAX_FOLDERS);
}

// ── the list as the studio wants it ──
{
  const cur = F.normalizeFolders({ folders: [{ id: 'f-aaaaaaaa', name: 'Retainers', color: 'violet', sites: [S1] }, { id: 'f-bbbbbbbb', name: 'Builds', color: 'amber', sites: [S2] }] });
  const next = F.applyFolderList(cur, [{ id: 'f-bbbbbbbb', name: 'Builds in progress' }, { name: 'Watch plans' }]);
  ok('list: a kept folder keeps its sites and colour, renamed and moved up', next[0].id === 'f-bbbbbbbb' && next[0].name === 'Builds in progress' && next[0].color === 'amber' && JSON.stringify(next[0].sites) === JSON.stringify([S2]));
  ok('list: a new folder starts empty, with a colour not taken', /^f-[a-z0-9]{8}$/.test(next[1].id) && next[1].sites.length === 0 && !['violet', 'amber'].includes(next[1].color));
  ok('list: a folder left out is gone, and its site in no folder', !next.some((x) => x.id === 'f-aaaaaaaa') && !next.some((x) => x.sites.includes(S1)));
  ok('list: the same name twice is refused, in words', /already a folder called “builds”/i.test(F.applyFolderList(cur, [{ name: 'Builds' }, { name: 'builds' }]).error || ''));
  ok('list: a folder needs a name', F.applyFolderList(cur, [{ name: '  ' }]).error === 'Give each folder a name.');
  ok('list: not a list is refused', !!F.applyFolderList(cur, 'x').error);
}

// ── moving sites ──
{
  const cur = F.normalizeFolders({ folders: [{ id: 'f-aaaaaaaa', name: 'Retainers', sites: [S1, S2] }, { id: 'f-bbbbbbbb', name: 'Builds', sites: [S3] }] });
  const moved = F.moveSites(cur, [S2, S3], 'f-aaaaaaaa');
  ok('move: into a folder, out of any other, each once', JSON.stringify(moved[0].sites) === JSON.stringify([S1, S2, S3]) && moved[1].sites.length === 0);
  const out = F.moveSites(cur, [S1], null);
  ok('move: out of every folder', !out.some((f) => f.sites.includes(S1)) && out[0].sites.includes(S2));
  ok('move: into a folder that has gone is refused, in words', /isn’t there any more/.test(F.moveSites(cur, [S1], 'f-zzzzzzzz').error || ''));
}

// ── saved views and tags ──
{
  const v = F.normalizeSiteViews({ views: [
    { id: 'v-aaaaaaaa', name: 'Retainers that dropped', folder: 'f-aaaaaaaa', filter: 'drops', sort: { key: 'drop', dir: 'desc' }, display: 'cards', q: '  maple  ' },
    { name: 'No folder sites', folder: 'none', tag: '  Upsell  Next ', filter: 'weird', display: 'table' },
    { id: 'v-bbbbbbbb', name: 'retainers that dropped', folder: 'evil', filter: 'live' },   // the same name: the later wins
  ] });
  ok('views: each name once, the later one winning', v.length === 2 && v[1].id === 'v-bbbbbbbb' && v[1].filter === 'live' && v[1].folder === '');
  ok('views: the folder, tag, filter, search, sort and display kept clean', v[0].folder === 'none' && v[0].tag === 'upsell next' && v[0].filter === 'all' && v[0].display === 'table' && /^v-[a-z0-9]{8}$/.test(v[0].id));
  const one = F.normalizeSiteViews([{ name: 'A', sort: { key: 'drop', dir: 'desc' }, q: '  maple  ' }])[0];
  ok('views: "desc" sorts down; the search is tidied', one.sort.dir === -1 && one.q === 'maple');
  ok('views: twenty at most', F.normalizeSiteViews(Array.from({ length: 30 }, (_, i) => ({ name: 'V' + i }))).length === F.MAX_SITE_VIEWS);
  ok('tags: lower case, single spaces, no commas', F.cleanTag('  Needs,  Photos ') === 'needs photos');
  ok('tags: add once, take off, ten at most', JSON.stringify(F.retag(['bakery', 'Bakery', 'upsell'], 'glendale', 'upsell')) === '["bakery","glendale"]' && F.retag(Array.from({ length: 12 }, (_, i) => 't' + i), 'new', '').length === F.MAX_TAGS);
}

// ── the routes, against a stubbed database ──
const STUDIO = 'cccccccc-3333-4333-8333-cccccccccccc';
let store, agencyRows, writes, failRead;
const reset = () => { store = {}; agencyRows = [{ site_id: S1, tags: ['bakery'] }, { site_id: S2, tags: [] }, { site_id: S3, tags: ['upsell', 'dental'] }]; writes = []; failRead = false; };
let clock = 0;
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  const table = u.pathname.replace('/rest/v1/', '');
  const q = decodeURIComponent(u.search);
  if (table === 'presence_agency_clients') {
    if (method === 'GET') return reply(q.includes('select=site_id,tags') ? agencyRows.filter((r) => q.includes(r.site_id)) : agencyRows.map((r) => ({ site_id: r.site_id })));
    if (method === 'PATCH') { const id = /site_id=eq\.([0-9a-f-]{36})/.exec(q)[1]; const b = JSON.parse(init.body); agencyRows = agencyRows.map((r) => (r.site_id === id ? { ...r, ...b } : r)); writes.push({ table, id, b }); return reply([]); }
  }
  if (table === 'presence_sales_templates') {
    const name = /name=eq\.([^&]+)/.exec(q)?.[1];
    if (method === 'GET') { if (failRead) return reply({ message: 'boom' }, 500); const row = store[name]; return reply(row ? [row] : []); }
    if (method === 'POST') { const b = JSON.parse(init.body); store[b.name] = { id: 'r-' + b.name, body: b.body, updated_at: String(++clock) }; writes.push({ table, name: b.name }); return reply([{ id: 'r-' + b.name }], 201); }
    if (method === 'PATCH') {
      const id = /id=eq\.([^&]+)/.exec(q)?.[1], at = /updated_at=eq\.([^&]+)/.exec(q)?.[1];
      const key = Object.keys(store).find((k) => store[k].id === id);
      if (!key || (at && store[key].updated_at !== at)) return reply([]);
      store[key] = { ...store[key], body: JSON.parse(init.body).body, updated_at: String(++clock) }; writes.push({ table, name: key });
      return reply([{ id }]);
    }
  }
  return reply([]);
};
const member = (role) => ({ agency_id: 'ag-1', agency_name: 'Studio', role, plan: 'studio', branding: {}, email: 'eric@studio.example', member_id: 'mm-1' });
const deps = { ownSite: async () => ({ id: STUDIO }) };
const call = async (route, method, body, role = 'owner') => {
  const req = new Request('http://stub.local/functions/v1/presence' + route, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const res = await F.handleSiteFolders(req, route, method, member(role), {}, deps);
  return res ? { status: res.status, body: await res.json() } : null;
};
{
  reset();
  const r0 = await call('/agency/sites/organize', 'GET');
  ok('route: nothing saved yet is no folders and no views, and the owner may change them', r0.status === 200 && r0.body.data.folders.length === 0 && r0.body.data.views.length === 0 && r0.body.data.can_change === true);
  const made = await call('/agency/sites/folders', 'PUT', { folders: [{ name: 'Retainers' }, { name: 'Builds in progress' }] });
  ok('route: two folders made', made.status === 200 && made.body.data.folders.length === 2);
  const [ret, bld] = made.body.data.folders;
  const mv = await call('/agency/sites/folders/move', 'POST', { site_ids: [S1, S2], folder: ret.id });
  ok('route: two sites moved into Retainers', mv.status === 200 && JSON.stringify(mv.body.data.folders[0].sites) === JSON.stringify([S1, S2]));
  const mv2 = await call('/agency/sites/folders/move', 'POST', { site_ids: [S2], folder: bld.id });
  ok('route: moving one on takes it out of the first', mv2.body.data.folders[0].sites.join() === S1 && mv2.body.data.folders[1].sites.join() === S2);
  const theirs = await call('/agency/sites/folders/move', 'POST', { site_ids: [OTHER], folder: ret.id });
  ok('route: another studio’s site is refused, and nothing is written', theirs.status === 404 && JSON.parse(store.__site_folders__.body).folders[0].sites.join() === S1);
  const gone = await call('/agency/sites/folders/move', 'POST', { site_ids: [S3], folder: 'f-zzzzzzzz' });
  ok('route: a folder that has gone says so', gone.status === 400 && /isn’t there any more/.test(gone.body.message));
  const rm = await call('/agency/sites/folders', 'PUT', { folders: [{ id: bld.id, name: 'Builds in progress' }] });
  ok('route: removing Retainers leaves its site in no folder', rm.status === 200 && rm.body.data.folders.length === 1 && !rm.body.data.folders.some((f) => f.sites.includes(S1)));
  const views = await call('/agency/sites/views', 'PUT', { views: [{ name: 'Needs me', filter: 'needs' }] });
  ok('route: a saved view kept for the team', views.status === 200 && views.body.data.views[0].name === 'Needs me' && (await call('/agency/sites/organize', 'GET')).body.data.views.length === 1);
  const tagged = await call('/agency/sites/tags', 'POST', { site_ids: [S1, S2, S3], add: 'Upsell' });
  ok('route: a tag onto three sites, each once', tagged.status === 200 && agencyRows.every((r) => r.tags.includes('upsell')) && agencyRows.find((r) => r.site_id === S3).tags.filter((t) => t === 'upsell').length === 1);
  const before = writes.length;
  await call('/agency/sites/tags', 'POST', { site_ids: [S1], add: 'upsell' });
  ok('route: a tag a site already has writes nothing', writes.length === before);
  await call('/agency/sites/tags', 'POST', { site_ids: [S3], remove: 'dental' });
  ok('route: a tag taken off one site', JSON.stringify(agencyRows.find((r) => r.site_id === S3).tags) === '["upsell"]');
  ok('route: no tag is refused', (await call('/agency/sites/tags', 'POST', { site_ids: [S1] })).status === 400);
  // roles
  const ro = await call('/agency/sites/folders', 'PUT', { folders: [] }, 'readonly');
  const roRead = await call('/agency/sites/organize', 'GET', undefined, 'readonly');
  ok('route: a read-only member sees the folders and can’t change them', ro.status === 403 && roRead.status === 200 && roRead.body.data.can_change === false);
  ok('route: a designer can’t tag or move either', (await call('/agency/sites/tags', 'POST', { site_ids: [S1], add: 'x' }, 'designer')).status === 403 && (await call('/agency/sites/folders/move', 'POST', { site_ids: [S1], folder: null }, 'designer')).status === 403);
  failRead = true;
  const bad = await call('/agency/sites/organize', 'GET');
  ok('route: a failed read says so, never "no folders"', bad.status === 502 && bad.body.error === 'read_failed');
  failRead = false;
  ok('route: someone else’s route is not answered', (await call('/agency/sites', 'GET')) === null && (await call('/agency/sites/folders', 'GET')) === null);
}

// ── wiring ──
{
  const routes = Deno.readTextFileSync(new URL('../../supabase/functions/presence/agency/routes.ts', import.meta.url));
  ok('wiring: the routes are asked before the Sites routes', routes.indexOf('handleSiteFolders(req, route, method, member, cors') > 0 && routes.indexOf('handleSiteFolders(req, route, method, member, cors') < routes.indexOf('const r = await handleAgencySites('));
  const rs = Deno.readTextFileSync(new URL('../../supabase/functions/presence/lib/reserved_store.ts', import.meta.url));
  ok('wiring: two reserved rows of their own', /siteFolders: '__site_folders__'/.test(rs) && /siteViews: '__site_views__'/.test(rs));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ SITES FOLDERS, TAGS AND VIEWS (item 176): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
