// ── Items 56 + 115: Files basics — folders, the storage meter, where a file is
//    used, and a photo already in Files flagged when it is uploaded again ──────
// The pure cores (lib/dam.ts), then the REAL route handlers against a tiny
// in-memory PostgREST, so "where used", Delete, Replace, the repeat check and the
// folder move are proven on what they read and write. No Supabase, no network.
//   deno run --allow-read --allow-env --allow-net tests/presence/files_basics_test.mjs
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) Deno.env.set(k, v);

const P = '../../supabase/functions/presence';
const {
  settingsMediaUses, repointSettingsMedia, mediaIdsIn, sameContent, findRepeats, storageSummary,
  folderName, normalizeFolderMove, normalizeBulkRequest, usageSummary,
} = await import(`${P}/lib/dam.ts`);
const {
  handleAssetDetail, handleAssetDelete, handleAssetReplace, handleAssetsMatch, handleAssetsFolderMove,
  handleAssetsCollections, handleAssetsList, handleAssetsHealth,
} = await import(`${P}/routes/assets.ts`);
const { deleteMedia, createUpload } = await import(`${P}/lib/media.ts`);

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const M = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LIB1 = 'bbbbbbbb-0000-4000-8000-000000000001', LIB2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const labelsOf = (map, id) => (map.get(id) || []).map((r) => r.label);

const SETTINGS = () => ({
  site_id: SITE, logo_media_id: M(1), og_media_id: M(2), cover_media_id: M(3), industry_key: 'restaurant',
  blocks: [
    { type: 'gallery', title: 'Our work', image_ids: [M(10), M(11)] },
    { type: 'team', members: [{ name: 'Ana', role: 'Chef', media_id: M(12) }] },
    { type: 'linked', ref: LIB1 },
    { type: 'columns', id: 'cols-1', columns: [{ body: 'Hello', block: { type: 'image', image_id: M(13) } }] },
    { type: 'richtext', title: 'Plain words', body: 'No photo here' },
  ],
  pages: [{ slug: 'about-us', title: 'About us', blocks: [
    { type: 'before_after', items: [{ before_id: M(14), after_id: M(15) }] },
    { type: 'freeform', elements: [{ kind: 'image', x: 1, y: 1, w: 20, h: 20, image: { image_id: M(16) } }] },
  ] }],
  page_seo: { 'page:about-us': { share_image: M(17) }, offerings: { share_image: M(18) }, about: { title: 'About' } },
  brand_kit: { logo_media_id: M(19), primary: '#224466' },
});
const LIBRARY = () => [
  { id: LIB1, site_id: SITE, name: 'Opening hours card', kind: 'block', payload: { type: 'image', image_id: M(20) } },
  { id: LIB2, site_id: SITE, name: 'Spare promo', kind: 'block', payload: { type: 'cards', cards: [{ heading: 'Hi', image_id: M(21) }] } },
];

// ═══ 1. where a file is used — the whole settings row (pure) ═══
{
  const map = settingsMediaUses(SETTINGS(), { library: LIBRARY(), offeringLabel: 'Menu' });
  ok('the logo, the cover and the share image each name themselves',
    labelsOf(map, M(1))[0] === 'your logo (on every page)' && labelsOf(map, M(3))[0] === 'your cover photo' && labelsOf(map, M(2))[0] === 'your social share image');
  ok('a gallery photo names its section, by type and title, on the Home page', labelsOf(map, M(10))[0] === 'the Photo gallery section “Our work” on your Home page' && labelsOf(map, M(11)).length === 1);
  ok('a team member’s photo is a use of the Team section', labelsOf(map, M(12))[0] === 'the Team section on your Home page');
  ok('a photo inside a column’s nested block is found', labelsOf(map, M(13))[0] === 'the Columns section on your Home page');
  ok('a section on the owner’s own page names that page', labelsOf(map, M(14))[0] === 'the Before & after section on your “About us” page' && labelsOf(map, M(15)).length === 1);
  ok('a free-form picture is found at its depth', labelsOf(map, M(16))[0] === 'the Free-form section on your “About us” page');
  ok('a page’s own share image names the page by its title', labelsOf(map, M(17))[0] === 'the share image for your “About us” page');
  ok('the services page’s share image takes the industry’s word', labelsOf(map, M(18))[0] === 'the share image for your “Menu” page');
  const kit = (map.get(M(19)) || [])[0];
  ok('the Brand Kit logo is a use OFF the website (emails, cards)', kit && kit.surface === 'brand_kit' && kit.site === false);
  ok('a linked saved section names itself and the page it is on', labelsOf(map, M(20))[0] === 'the saved section “Opening hours card” on your Home page' && (map.get(M(20)) || [])[0].site !== false);
  const spare = (map.get(M(21)) || [])[0];
  ok('a saved section no page shows is a use off the website', spare && spare.label === 'the saved section “Spare promo” (not on a page yet)' && spare.site === false);
  ok('plain words never become a use', ![...map.keys()].some((k) => !/^[0-9a-f-]{36}$/.test(k)) && map.size === 15, String(map.size));

  const same = settingsMediaUses({ ...SETTINGS(), brand_kit: { logo_media_id: M(1) } }, {});
  ok('a Brand Kit logo that IS the site logo is one place, not two', (same.get(M(1)) || []).length === 1);
  ok('a link to a missing saved section names nothing', !settingsMediaUses({ blocks: [{ type: 'linked', ref: LIB1 }] }, { library: [] }).size);
  const upper = settingsMediaUses({ blocks: [{ type: 'image', image_id: M(13).toUpperCase() }] });
  ok('an id stored in capitals still matches', labelsOf(upper, M(13)).length === 1);
  ok('an empty or absent row is no use at all', settingsMediaUses(null).size === 0 && settingsMediaUses({}).size === 0);
  ok('mediaIdsIn is bounded and exact', mediaIdsIn({ a: [{ b: M(5) }], c: 'not-a-uuid', d: 12 }).size === 1);
  const sum = usageSummary([{ surface: 'section', label: 'x', live: true }, { surface: 'project', label: 'y', live: false, site: false }]);
  ok('the headline counts only live places as live', sum.total === 2 && sum.live === 1);
}

// ═══ 2. Replace points every place at the new file (pure) ═══
{
  const s = SETTINGS();
  const patch = repointSettingsMedia(s, M(14), M(99));
  ok('a custom page’s section moves to the new file', JSON.stringify(patch.pages).includes(M(99)) && !JSON.stringify(patch.pages).includes(M(14)));
  ok('only the columns that held it are in the patch', Object.keys(patch).join() === 'pages');
  ok('the rest of the page is untouched', patch.pages[0].title === 'About us' && patch.pages[0].blocks[1].elements[0].image.image_id === M(16));
  const all = repointSettingsMedia({ ...s, cover_media_id: M(14), page_seo: { about: { share_image: M(14) } } }, M(14), M(99));
  ok('the cover and a page share image move too', all.cover_media_id === M(99) && all.page_seo.about.share_image === M(99) && 'pages' in all);
  ok('a file used nowhere changes nothing', Object.keys(repointSettingsMedia(s, M(77), M(99))).length === 0);
}

// ═══ 3. the same file, uploaded again (pure) ═══
{
  const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64);
  const hashed = { id: '1', content_hash: H1, bytes: 5000, width: 800, height: 600, created_at: '2026-02-01T00:00:00Z' };
  const legacy = { id: '2', content_hash: '', bytes: 5000, width: 800, height: 600, created_at: '2026-01-01T00:00:00Z' };
  const pdf = { id: '3', content_hash: '', bytes: 9000, width: null, height: null, mime: 'application/pdf' };
  ok('the same hash is the same file', sameContent(hashed, { hash: H1 }) === 'exact');
  ok('two different hashes are two files, whatever their sizes', sameContent(hashed, { hash: H2, bytes: 5000, width: 800, height: 600 }) === null);
  ok('a row from before hashes matches on exact size AND pixels', sameContent(legacy, { hash: H2, bytes: 5000, width: 800, height: 600 }) === 'likely');
  ok('a near size is not a match', sameContent(legacy, { bytes: 5001, width: 800, height: 600 }) === null && sameContent(legacy, { bytes: 5000, width: 800, height: 601 }) === null);
  ok('a document only ever matches by hash', sameContent(pdf, { bytes: 9000 }) === null);
  const hits = findRepeats([legacy, hashed, { ...hashed }], { hash: H1, bytes: 5000, width: 800, height: 600 });
  ok('exact before likely, and one row once', hits.length === 2 && hits[0].asset.id === '1' && hits[0].match === 'exact' && hits[1].asset.id === '2' && hits[1].match === 'likely');
  const both = findRepeats([hashed, legacy], { bytes: 5000, width: 800, height: 600 });
  ok('with no hash, the oldest copy comes first', both.map((h) => h.asset.id).join() === '2,1');
  ok('a file is never its own repeat', findRepeats([hashed], { hash: H1 }, '1').length === 0);
}

// ═══ 4. the storage meter (pure) ═══
{
  const rows = [{ bytes: 400 }, { bytes: 600 }, { bytes: null }];
  const s = storageSummary(rows, { maxBytes: 10000, maxFiles: 100 });
  ok('used is the bytes summed, files every live row', s.used_bytes === 1000 && s.files === 3 && s.max_files === 100 && s.max_bytes === 10000 && s.level === 'ok');
  ok('nearly full on space warns', storageSummary([{ bytes: 8600 }], { maxBytes: 10000, maxFiles: 100 }).level === 'low');
  ok('nearly full on files warns', storageSummary(Array.from({ length: 90 }, () => ({ bytes: 1 })), { maxBytes: 10000, maxFiles: 100 }).level === 'low');
  ok('at the cap it is full', storageSummary(Array.from({ length: 100 }, () => ({ bytes: 1 })), { maxBytes: 10000, maxFiles: 100 }).level === 'full' && storageSummary([{ bytes: 10000 }], { maxBytes: 10000, maxFiles: 100 }).level === 'full');
}

// ═══ 5. folders (pure) ═══
{
  ok('a folder name is trimmed, one-spaced, bounded and clean', folderName('  Menu   photos\u0007 ') === 'Menu photos' && folderName('x'.repeat(200)).length === 80);
  const mv = normalizeFolderMove({ from: ' Menu photos ', to: 'Food' });
  ok('a move names both folders', mv.ok && mv.from === 'Menu photos' && mv.to === 'Food');
  ok('taking files out is a move to no folder', normalizeFolderMove({ from: 'Food', to: '' }).ok && normalizeFolderMove({ from: 'Food', to: '' }).to === '');
  ok('a move needs a folder, a target, and a change', !normalizeFolderMove({ to: 'x' }).ok && !normalizeFolderMove({ from: 'x' }).ok && !normalizeFolderMove({ from: 'x', to: ' x ' }).ok);
  const ids = [M(1)];
  ok('bulk: clear takes files out of folders', (() => { const r = normalizeBulkRequest({ action: 'collection', ids, clear: true }); return r.ok && r.collection === ''; })());
  ok('bulk: an empty name without clear is still refused', !normalizeBulkRequest({ action: 'collection', ids, collection: '   ' }).ok);
  ok('bulk: a folder name follows the same rule', normalizeBulkRequest({ action: 'collection', ids, collection: ' Menu   photos ' }).collection === 'Menu photos');
}

// ═══ the routes, against a tiny PostgREST ═══
let DB, CALLS, FAIL;
const reset = (tables = {}) => { DB = { presence_settings: [], presence_offerings: [], presence_posts: [], presence_deliverables: [], presence_content_library: [], presence_media: [], presence_publishes: [], presence_snapshots: [], presence_entitlements: [], presence_change_events: [], ...tables }; CALLS = []; FAIL = new Set(); };
const reply = (body, status = 200, headers = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const SKIP = new Set(['select', 'order', 'limit', 'offset']);
function matches(row, params) {
  for (const [k, v] of params) {
    if (SKIP.has(k)) continue;
    const val = row[k];
    if (v === 'is.null') { if (val != null) return false; }
    else if (v === 'not.is.null') { if (val == null) return false; }
    else if (v.startsWith('eq.')) { if (String(val ?? '') !== v.slice(3)) return false; }
    else if (v.startsWith('neq.')) { if (String(val ?? '') === v.slice(4)) return false; }
    else if (v.startsWith('in.(')) { if (!v.slice(4, -1).split(',').includes(String(val))) return false; }
  }
  return true;
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname !== 'stub.local') return reply({}, 404);
  if (u.pathname.startsWith('/storage/v1/')) {
    if (method !== 'GET' && method !== 'POST') CALLS.push({ table: 'storage', method });
    if (u.pathname.includes('/upload/sign/')) return reply({ url: '/object/upload/sign/x?token=t' });
    return reply({ signedURL: '/object/sign/x?token=t' });
  }
  const table = u.pathname.replace('/rest/v1/', '');
  const params = [...u.searchParams.entries()];
  const rows = DB[table] || (DB[table] = []);
  if (method !== 'GET' && method !== 'HEAD') CALLS.push({ table, method, query: decodeURIComponent(u.search), body: init.body ? JSON.parse(init.body) : null });
  if (FAIL.has(table)) return reply({ message: 'boom' }, 500);
  const hit = rows.filter((r) => matches(r, params));
  const prefer = new Headers(init.headers).get('Prefer') || '';
  if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `*/${hit.length}` } });
  if (method === 'GET') return reply(hit);
  if (method === 'POST') {
    const body = JSON.parse(init.body || '{}');
    const list = (Array.isArray(body) ? body : [body]).map((b) => ({ id: b.id || crypto.randomUUID(), ...b }));
    rows.push(...list);
    return prefer.includes('representation') ? reply(list, 201) : reply(null, 201);
  }
  if (method === 'PATCH') {
    const body = JSON.parse(init.body || '{}');
    for (const r of hit) Object.assign(r, body);
    return prefer.includes('representation') ? reply(hit) : reply(null, 204);
  }
  if (method === 'DELETE') { DB[table] = rows.filter((r) => !hit.includes(r)); return reply(null, 204); }
  return reply({}, 405);
};
const SITE_ROW = { id: SITE, client_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'draft', template_slug: 'restaurant-classic', template_version: '1.0.0', edition: 'presence' };
const principal = { kind: 'client', userId: 'u-1', tenantId: null, role: 'client', email: 'owner@example.com', jwt: '', requestId: 'test' };
const cors = {};
const media = (n, extra = {}) => ({ id: M(n), site_id: SITE, storage_path: `presence-media/${SITE}/${n}.jpg`, alt_text: `photo ${n}`, mime: 'image/jpeg', bytes: 1000 + n, width: 800, height: 600, tags: [], collection: '', metadata: {}, content_hash: '', brand: false, asset_status: 'approved', created_at: `2026-01-${String(1 + (n % 27)).padStart(2, '0')}T00:00:00Z`, deleted_at: null, ...extra });
const world = (extra = {}) => reset({
  presence_settings: [SETTINGS()], presence_content_library: LIBRARY(),
  presence_media: [1, 2, 3, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 50].map((n) => media(n)),
  ...extra,
});
const body = async (res) => ({ status: res.status, json: await res.json().catch(() => null) });
const req = (method, path, b) => new Request(`http://stub.local/functions/v1/presence${path}`, { method, body: b === undefined ? undefined : JSON.stringify(b), headers: { 'Content-Type': 'application/json' } });
const wroteTo = (table) => CALLS.filter((c) => c.table === table);

// ═══ 6. GET /assets/:id — where used, on the real read ═══
{
  world();
  const d = await body(await handleAssetDetail(SITE_ROW, M(14), cors));
  const labels = (d.json?.data?.usage || []).map((u) => u.label);
  ok('detail: a photo on the owner’s own page names that section and page', d.status === 200 && labels.includes('the Before & after section on your “About us” page'), labels.join(' | '));
  ok('detail: it reads as on the site', d.json?.data?.asset?.in_use === true && d.json?.data?.usage_complete === true);
  const kit = await body(await handleAssetDetail(SITE_ROW, M(19), cors));
  ok('detail: a Brand Kit-only logo is used, but not on the site', kit.json?.data?.usage?.length === 1 && kit.json?.data?.asset?.in_use === false);

  world({ presence_offerings: [{ id: 'o1', site_id: SITE, name: 'Latte', media_id: M(50), is_visible: true, deleted_at: null }], presence_deliverables: [{ id: 'd1', site_id: SITE, media_id: M(50), title: 'Signed menu', deleted_at: null }] });
  const both = await body(await handleAssetDetail(SITE_ROW, M(50), cors));
  const ls = (both.json?.data?.usage || []).map((u) => `${u.label}|${u.site === false ? 'off' : 'on'}`);
  ok('detail: a service photo names the page in the industry’s word', ls.includes('“Latte” on your Menu page|on'), ls.join(' ; '));
  ok('detail: a project file is listed, off the site', ls.includes('the project file “Signed menu”|off'));

  world({ presence_media: [media(60, { bytes: 5000, width: 800, height: 600 }), media(61, { bytes: 5000, width: 800, height: 600, created_at: '2025-12-01T00:00:00Z' }), media(62, { bytes: 5000, width: 800, height: 601 })] });
  const rep = await body(await handleAssetDetail(SITE_ROW, M(60), cors));
  ok('detail: another copy of the same photo is named', (rep.json?.data?.repeats || []).map((r) => r.id).join() === M(61) && rep.json.data.repeats[0].exact === false);
}

// ═══ 7. DELETE /assets/:id — refused on the complete list, and when unsure ═══
{
  world();
  const r = await body(await handleAssetDelete(SITE_ROW, principal, M(16), cors));
  ok('delete: a picture used only on the owner’s own page is refused, by name', r.status === 409 && r.json?.error === 'in_use' && /“About us” page/.test(r.json?.message || ''), r.json?.message);
  ok('delete: and nothing was written', wroteTo('presence_media').length === 0 && wroteTo('storage').length === 0);

  world(); FAIL.add('presence_offerings');
  const u = await body(await handleAssetDelete(SITE_ROW, principal, M(50), cors));
  ok('delete: a failed read is "couldn’t check", never a guess that it is unused', u.status === 503 && u.json?.error === 'usage_unknown' && wroteTo('presence_media').length === 0);

  world();
  const g = await body(await handleAssetDelete(SITE_ROW, principal, M(50), cors));
  ok('delete: an unused file still deletes', g.status === 200 && DB.presence_media.find((m) => m.id === M(50))?.deleted_at);
}

// ═══ 8. POST /assets/:id/replace — every place moves to the new version ═══
{
  world({ presence_media: [media(14), media(16), media(20), media(30), media(31)] });
  const r = await body(await handleAssetReplace(req('POST', `/assets/${M(14)}/replace`, { with: M(30) }), SITE_ROW, principal, M(14), cors));
  const s = DB.presence_settings[0];
  ok('replace: the custom page’s section now shows the new file', r.status === 200 && JSON.stringify(s.pages).includes(M(30)) && !JSON.stringify(s.pages).includes(M(14)));
  ok('replace: it says which places it changed', (r.json?.data?.affects || []).includes('the Before & after section on your “About us” page') && r.json?.data?.requires_publish === true);
  ok('replace: the old version is kept as the prior one', !!DB.presence_media.find((m) => m.id === M(14))?.deleted_at && DB.presence_media.find((m) => m.id === M(30))?.metadata?.replaces === M(14));

  const r2 = await body(await handleAssetReplace(req('POST', `/assets/${M(20)}/replace`, { with: M(31) }), SITE_ROW, principal, M(20), cors));
  ok('replace: a saved section’s own copy moves, so every linked page follows', r2.status === 200 && DB.presence_content_library.find((l) => l.id === LIB1)?.payload?.image_id === M(31));

  world({ presence_media: [media(40), media(41)], presence_deliverables: [{ id: 'd1', site_id: SITE, media_id: M(40), title: 'Signed plan', deleted_at: null }] });
  const p = await body(await handleAssetReplace(req('POST', `/assets/${M(40)}/replace`, { with: M(41) }), SITE_ROW, principal, M(40), cors));
  ok('replace: a project file is refused, and stays as delivered', p.status === 409 && p.json?.error === 'in_project' && !DB.presence_media.find((m) => m.id === M(40))?.deleted_at && wroteTo('presence_media').length === 0);
}

// ═══ 9. GET /assets/match — already in Files? ═══
{
  const H1 = 'c'.repeat(64), H2 = 'd'.repeat(64);
  world({ presence_media: [
    media(70, { content_hash: H1, bytes: 5000, width: 800, height: 600, metadata: { title: 'Storefront' } }),
    media(71, { bytes: 7000, width: 1200, height: 900, metadata: { title: 'Patio' }, collection: 'Outside' }),
    media(72, { bytes: 9000, width: null, height: null, mime: 'application/pdf', metadata: { title: 'Menu PDF' } }),
  ] });
  const ask = async (q) => (await body(await handleAssetsMatch(req('GET', `/assets/match?${q}`), SITE_ROW, cors))).json?.data?.match ?? null;
  const exact = await ask(`hash=${H1}&bytes=5000&width=800&height=600`);
  ok('match: the same hash answers with the file’s name', exact?.id === M(70) && exact.exact === true && exact.name === 'Storefront');
  const other = await ask(`hash=${H2}&bytes=5000&width=800&height=600`);
  ok('match: a different hash is a different file, same size or not', other === null);
  const old = await ask(`hash=${H2}&bytes=7000&width=1200&height=900`);
  ok('match: a file from before hashes matches on size and pixels, with its folder', old?.id === M(71) && old.exact === false && old.folder === 'Outside');
  ok('match: a document without a hash never matches by size', (await ask('bytes=9000')) === null);
  ok('match: nothing to go on is no match', (await ask('')) === null && (await ask('hash=nothex&bytes=-4')) === null);
}

// ═══ 10. POST /assets/folders/move — rename, and take files out ═══
{
  world({ presence_media: [
    media(80, { collection: 'Menu photos' }), media(81, { collection: 'Menu photos', asset_status: 'archived' }),
    media(82, { collection: 'Menu photos', deleted_at: '2026-01-01T00:00:00Z' }), media(83, { collection: 'Outside' }),
  ] });
  const r = await body(await handleAssetsFolderMove(req('POST', '/assets/folders/move', { from: 'Menu photos', to: 'Food' }), SITE_ROW, principal, cors));
  ok('folders: a rename moves every live file, archived ones too', r.status === 200 && r.json?.data?.moved === 2 && DB.presence_media.filter((m) => m.collection === 'Food').length === 2);
  ok('folders: a deleted file and another folder are left alone', DB.presence_media.find((m) => m.id === M(82)).collection === 'Menu photos' && DB.presence_media.find((m) => m.id === M(83)).collection === 'Outside');
  ok('folders: the write is site-scoped', wroteTo('presence_media').every((c) => c.query.includes(`site_id=eq.${SITE}`) && c.query.includes('collection=eq.Menu photos')));
  ok('folders: one change event says what moved', DB.presence_change_events.some((e) => /Moved 2 files from the folder “Menu photos” to “Food”/.test(e.summary || '')));
  const out = await body(await handleAssetsFolderMove(req('POST', '/assets/folders/move', { from: 'Food', to: '' }), SITE_ROW, principal, cors));
  ok('folders: removing a folder keeps its files, out of any folder', out.json?.data?.moved === 2 && DB.presence_media.filter((m) => m.collection === '').length === 2 && DB.presence_media.length === 4);
  const bad = await body(await handleAssetsFolderMove(req('POST', '/assets/folders/move', { from: 'Outside', to: 'Outside' }), SITE_ROW, principal, cors));
  ok('folders: a non-move is refused before anything is written', bad.status === 400 && wroteTo('presence_media').length === 2);
}

// ═══ 11. GET /assets/collections and /assets — counts and the meter ═══
{
  world({ presence_media: [
    media(90, { collection: 'Outside', bytes: 1000 }), media(91, { collection: 'Outside', asset_status: 'archived', bytes: 2000 }),
    media(92, { collection: 'Outside', client_private: true, bytes: 3000 }), media(93, { collection: 'Food', bytes: 4000 }),
  ] });
  const c = await body(await handleAssetsCollections(SITE_ROW, cors));
  const n = Object.fromEntries((c.json?.data || []).map((x) => [x.name, x.count]));
  ok('collections: a folder counts what opening it shows', n.Outside === 1 && n.Food === 1, JSON.stringify(n));
  const l = await body(await handleAssetsList(req('GET', '/assets'), SITE_ROW, cors));
  const st = l.json?.data?.storage;
  ok('list: the meter counts every live file, archived and private too', st?.files === 4 && st?.used_bytes === 10000, JSON.stringify(st));
  ok('list: against the template’s file cap and the site quota', st?.max_files === 100 && st?.max_bytes === 1024 * 1024 * 1024 && st?.level === 'ok');
  world();
  const h = await body(await handleAssetsHealth(SITE_ROW, cors));
  const unused = new Set((h.json?.data?.findings || []).filter((f) => f.kind === 'unused').map((f) => f.asset_id));
  ok('health: a section photo is no longer "not on your site"', !unused.has(M(10)) && !unused.has(M(16)) && !unused.has(M(20)));
  ok('health: but a Brand Kit-only logo and a spare saved section are', unused.has(M(19)) && unused.has(M(21)) && unused.has(M(50)));
}

// ═══ 12. the builder's own Delete (lib/media.ts) — the same new places ═══
{
  for (const [n, why] of [[16, 'a section on one of your pages'], [17, 'a page’s share image'], [19, 'your Brand Kit logo'], [20, 'the saved section “Opening hours card”']]) {
    world();
    const r = await deleteMedia(SITE, M(n));
    ok(`builder delete: refused for ${why}`, r.error === 'in_use' && r.message.includes(why) && wroteTo('presence_media').length === 0, r.message);
  }
  world();
  ok('builder delete: an unused file still deletes', (await deleteMedia(SITE, M(50))).ok === true);
}

// ═══ 13. the upload door keeps a well-formed fingerprint only ═══
{
  world({ presence_media: [] });
  const good = await createUpload(SITE, { mime: 'image/jpeg', bytes: 100, alt_text: 'A photo', width: 10, height: 10, content_hash: 'e'.repeat(64) });
  ok('upload: a SHA-256 from the page is stored', !('error' in good) && DB.presence_media[0]?.content_hash === 'e'.repeat(64));
  await createUpload(SITE, { mime: 'image/jpeg', bytes: 100, alt_text: 'A photo', content_hash: 'not-a-hash' });
  ok('upload: anything else is left out', !('content_hash' in DB.presence_media[1]));
  const routes = read('supabase/functions/presence/routes/media.ts');
  ok('upload: the route passes the page’s hash through', /content_hash: String\(body\?\.content_hash/.test(routes));
}

// ═══ 14. wiring ═══
{
  const idx = read('supabase/functions/presence/index.ts');
  ok('index: GET /assets/match and POST /assets/folders/move are routed',
    idx.includes("route === '/assets/match' && method === 'GET') return handleAssetsMatch(") && idx.includes("route === '/assets/folders/move' && method === 'POST') return handleAssetsFolderMove("));
  const roles = read('supabase/functions/presence/lib/site_roles.ts');
  ok('roles: moving a folder is an edit, like the bulk move', roles.includes("'POST /assets/folders/move',"));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ FILES BASICS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
