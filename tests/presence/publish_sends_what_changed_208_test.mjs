// ── Builder list item 208: a publish reads only the photos it uses and sends only what changed ──
// Review file 06, findings 81 and 84; file 03, findings 1 and 11.
//   · the draft reads its photos by id, so a site with more than 1,000 files can't lose one
//     from a publish; a later read asks only for an id it hasn't seen
//   · a restore to the draft reads only the photos that version kept
//   · a photo the live site already has is named by the digest it went up with and is made
//     again only if the host asks for it; the rest are made and sent a few at a time
//   · a publish or a restore whose files are all the same as the live deploy's sends nothing:
//     no paid deploy, the record says so, and the answer says so
//   · a live site showing another deploy (the offline page) is always deployed over
//   · before migration 0205 publishing works as it did
//
//   deno run --allow-read --allow-env --allow-net tests/presence/publish_sends_what_changed_208_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';

Deno.env.set('NETLIFY_AUTH_TOKEN', 'nf-test');
Deno.env.delete('RESEND_API_KEY');
Deno.env.delete('OPS_ALERT_EMAIL');
const db = installFakePostgrest();
const pg = globalThis.fetch;

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const quiet = async (fn) => { const e = console.error, w = console.warn, l = console.log; console.error = () => {}; console.warn = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };

const hex = (k, i) => `${k}${i.toString(16).padStart(7, '0')}-0000-4000-8000-000000000000`;
const SITE = hex('a', 1);
const MEDIA = [0, 1, 2, 3].map((i) => hex('b', i));
const OFFER = [0, 1].map((i) => hex('c', i));
const POST = hex('d', 1), LIB = hex('e', 1), LOC = hex('f', 1);

// ── the host and the photo store, stubbed; the database is fake_pgrst ──
const sha1 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();
let nf, store;
function resetHost() {
  nf = { has: new Set(), deploys: [], uploads: [], live: null, inFlight: 0, maxInFlight: 0, required: null, nextId: 1 };
  store = { transforms: [], inFlight: 0, maxInFlight: 0 };
}
resetHost();
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tick = () => new Promise((r) => setTimeout(r, 1));
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.netlify.com') {
    const p = u.pathname.replace('/api/v1', '');
    if (method === 'GET' && /^\/sites\/[^/]+$/.test(p)) return json({ id: 'nf1', name: 'presence-a', default_domain: 'presence-a.netlify.app', custom_domain: null, state: 'current', published_deploy: nf.live ? { id: nf.live } : null });
    if (method === 'POST' && /^\/sites\/[^/]+\/deploys$/.test(p)) {
      const b = JSON.parse(init.body);
      const id = `dep${nf.nextId++}`;
      const required = nf.required ? nf.required(b.files) : [...new Set(Object.values(b.files))].filter((d) => !nf.has.has(d));
      nf.deploys.push({ id, files: b.files, title: b.title, required });
      return json({ id, required });
    }
    if (method === 'PUT' && /^\/deploys\/[^/]+\/files\//.test(p)) {
      nf.inFlight++; nf.maxInFlight = Math.max(nf.maxInFlight, nf.inFlight);
      await tick(); await tick();
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
      nf.has.add(await sha1(bytes));
      nf.uploads.push(decodeURIComponent(p.replace(/^\/deploys\/[^/]+\/files/, '')));
      nf.inFlight--;
      return json({});
    }
    if (method === 'GET' && /^\/deploys\/[^/]+$/.test(p)) { const id = p.split('/').pop(); nf.live = id; return json({ id, state: 'ready' }); }
    return json({}, 404);
  }
  if (u.pathname.startsWith('/storage/v1/render/image/') || u.pathname.startsWith('/storage/v1/object/authenticated/')) {
    store.inFlight++; store.maxInFlight = Math.max(store.maxInFlight, store.inFlight);
    await tick(); await tick();
    store.transforms.push(u.pathname + u.search);
    store.inFlight--;
    return new Response(enc.encode(`img:${u.pathname}:${u.searchParams.get('width')}:${u.searchParams.get('format')}`), { status: 200 });
  }
  return pg(url, init);
};

const S = await import('../../supabase/functions/presence/lib/serializer.ts');
const { readDraft } = await import('../../supabase/functions/presence/lib/draft_hash.ts');
const { fetchVariants } = await import('../../supabase/functions/presence/lib/media.ts');
const { deployFileMap, digestFiles, sameFiles, UPLOADS_AT_ONCE } = await import('../../supabase/functions/presence/lib/netlify.ts');
const { fewAtATime } = await import('../../supabase/functions/presence/lib/few_at_a_time.ts');
const { handlePublish, handleRestore, unchangedMessage } = await import('../../supabase/functions/presence/routes/publish.ts');
const { getTemplate } = await import('../../supabase/functions/presence/lib/render.ts');

const site = { id: SITE, client_id: 'client-a', status: 'ready', last_published_at: null, template_slug: 'restaurant-classic', template_version: '1.0.0', custom_domain: null, netlify_site_id: 'nf1', edition: 'presence' };
const hours = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({ day, closed: day === 'sun', intervals: day === 'sun' ? [] : [{ open: '09:00', close: '17:00' }] }));
function seed({ files = 0 } = {}) {
  const filler = Array.from({ length: files }, (_, i) => ({ id: hex('9', i), site_id: SITE, storage_path: `presence-media/${SITE}/filler-${i}.jpg`, alt_text: 'Old photo', mime: 'image/jpeg', width: 800, height: 600, deleted_at: null }));
  db.reset({
    presence_sites: [{ ...site }],
    presence_identity: [{ site_id: SITE, business_name: 'Sample Cafe', tagline: 'Good food', description: 'A neighbourhood cafe.', phone: '555-0100', email: '', story: '', service_area: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '' }],
    presence_locations: [{ id: LOC, site_id: SITE, address_line1: '1 Main St', city: 'Town', region: 'CA', postal_code: '90000', country: 'US', timezone: 'America/Los_Angeles', hours, holiday_exceptions: [], temporarily_closed: false, created_at: '2026-01-01T00:00:00Z' }],
    presence_offerings: OFFER.map((id, i) => ({ id, site_id: SITE, name: `Dish ${i}`, category: 'Mains', description: '', price_text: '$9', media_id: MEDIA[i], is_visible: true, sort_order: i, deleted_at: null, created_at: '2026-01-01T00:00:00Z' })),
    presence_testimonials: [], presence_faqs: [], presence_redirects: [], presence_dev_customizations: [], presence_reviews: [],
    presence_posts: [{ id: POST, site_id: SITE, title: 'News', slug: 'news', body_md: 'Hello', excerpt: '', hero_media_id: MEDIA[2], status: 'published', published_at: '2026-02-01T00:00:00Z', noindex: false, tags: [], deleted_at: null }],
    // the site's own photos come last, after the files it doesn't use
    presence_media: [...filler, ...MEDIA.map((id, i) => ({ id, site_id: SITE, storage_path: `presence-media/${SITE}/photo-${i}.jpg`, alt_text: `Photo ${i}`, mime: 'image/jpeg', width: 1600, height: 1000, focal_x: null, focal_y: null, deleted_at: null }))],
    presence_settings: [{ site_id: SITE, category_order: [], nav: null, blocks: [{ type: 'image', title: 'Welcome', image_id: MEDIA[3] }, { type: 'linked', ref: LIB }], pages: [] }],
    presence_content_library: [{ id: LIB, site_id: SITE, name: 'Opening hours', kind: 'section', payload: { type: 'richtext', body: 'Open every day.' } }],
    presence_publishes: [], presence_snapshots: [], presence_change_events: [], presence_page_locks: [], presence_plan_notices: [],
  });
}
const mediaReads = () => db.log.filter((c) => c.method === 'GET' && c.url.startsWith('/rest/v1/presence_media?'));
const T = getTemplate('restaurant-classic', '1.0.0');
const OWNER = { kind: 'client', userId: 'u1', email: 'owner@example.com' };
const answer = async (res) => ({ status: res.status, body: await res.json() });
const publish = () => quiet(async () => answer(await handlePublish(null, { ...db.tables.presence_sites[0] }, OWNER, {})));
const restore = (publishId) => quiet(async () => answer(await handleRestore(new Request('http://x/restore', { method: 'POST', body: JSON.stringify({ publish_id: publishId }) }), { ...db.tables.presence_sites[0] }, OWNER, {})));

// ═══ 1. pure parts ═══
{
  const rows = {
    presence_settings: [{ site_id: SITE, logo_media_id: MEDIA[0], blocks: [{ id: hex('7', 1), type: 'gallery', items: [{ media_id: MEDIA[1] }] }], page_seo: { home: { share_image: MEDIA[2] } } }],
    presence_offerings: [{ id: OFFER[0], site_id: SITE, media_id: MEDIA[3] }],
    presence_posts: [{ id: POST, site_id: SITE, hero_media_id: null, body_md: `![a plate](media:${MEDIA[2].toUpperCase()})` }],
    presence_media: [{ id: hex('8', 1) }],
  };
  const ids = S.mediaIdsIn(rows, SITE);
  ok('ids: every photo the rows name, from a logo, a section, a share image, a menu item and a post’s text', MEDIA.every((m) => ids.includes(m)), ids.join(' '));
  ok('ids: never the site, a row’s own id, or a photo row itself', !ids.includes(SITE) && !ids.includes(OFFER[0]) && !ids.includes(POST) && !ids.includes(hex('8', 1)));
  ok('ids: a section’s own id may come along (one read keeps only photos)', ids.includes(hex('7', 1)));
  ok('same files: same paths and digests', sameFiles({ '/a': '1', '/b': '2' }, { '/b': '2', '/a': '1' }));
  ok('same files: a changed digest, an extra file or a missing list is not the same', !sameFiles({ '/a': '1' }, { '/a': '2' }) && !sameFiles({ '/a': '1' }, { '/a': '1', '/b': '2' }) && !sameFiles({ '/a': '1' }, null));
  let live = 0, most = 0;
  const out = await fewAtATime([5, 1, 4, 2, 3, 0, 6], 3, async (n) => { live++; most = Math.max(most, live); await new Promise((r) => setTimeout(r, n)); live--; return n * 10; });
  ok('a few at a time: answers in place, never more than asked', out.join() === '50,10,40,20,30,0,60' && most === 3, `${out} / ${most}`);
}

// ═══ 2. the draft reads its photos by id: 1,200 files, the site's own read last ═══
{
  seed({ files: 1200 });
  const { snapshot, mediaManifest } = await quiet(() => S.serializeDraft(SITE, T.manifest, { templateSlug: 'restaurant-classic', templateVersion: '1.0.0', now: '2026-11-12T00:00:00Z' }));
  const used = new Set(mediaManifest.map((m) => m.media_id));
  ok('draft: every photo it uses is in the publish, though 1,200 other files come first', MEDIA.every((m) => used.has(m)) && used.size === 4, [...used].join(' '));
  ok('draft: a menu item, the post and the opening section show their photos', snapshot.content.offerings.every((o) => o.media) && snapshot.content.posts[0].hero && JSON.stringify(snapshot.content.settings.blocks).includes('/img/'));
  const reads = mediaReads();
  ok('draft: the photos are read by id only, never the whole library', reads.length >= 1 && reads.every((c) => /[?&]id=in\.\(/.test(c.url) && /deleted_at=is\.null/.test(c.url)), reads.map((c) => c.url.slice(0, 90)).join(' | '));
  ok('draft: at most 100 ids in one read', reads.every((c) => (/id=in\.\(([^)]*)\)/.exec(c.url)?.[1].split(',').length || 0) <= S.MEDIA_IDS_PER_READ));
}
// a later read asks only for what it hasn't seen
{
  seed();
  const first = await quiet(() => readDraft(site));
  db.log = [];
  db.tables.presence_settings[0].announcement_text = 'Closed Monday';
  const same = await quiet(() => readDraft(site, first, ['presence_settings']));
  ok('re-read: a save naming no new photo reads no photos', mediaReads().length === 0 && same.mediaManifest.length === 4, String(mediaReads().length));
  db.log = [];
  db.tables.presence_settings[0].blocks.push({ type: 'gallery', image_ids: [hex('9', 5)] });
  db.tables.presence_media.push({ id: hex('9', 5), site_id: SITE, storage_path: `presence-media/${SITE}/new.jpg`, alt_text: 'New', mime: 'image/jpeg', width: 800, height: 600, deleted_at: null });
  const more = await quiet(() => readDraft(site, same, ['presence_settings']));
  const r = mediaReads();
  ok('re-read: a new photo is read alone, by its id', r.length === 1 && r[0].url.includes(hex('9', 5)) && !r[0].url.includes(MEDIA[0]), r.map((c) => c.url).join(' | '));
  ok('re-read: and reaches the publish', more.mediaManifest.some((m) => m.media_id === hex('9', 5)));
  db.log = [];
  db.tables.presence_media.find((m) => m.id === MEDIA[0]).alt_text = 'Renamed';
  await quiet(() => readDraft(site, more, ['presence_media']));
  ok('re-read: a change to the files reads every photo named again', mediaReads().length >= 1 && mediaReads().some((c) => c.url.includes(MEDIA[0])));
}

// ═══ 3. making photos: what the live site has is named, not made ═══
{
  resetHost();
  const manifest = [0, 1, 2].map((i) => ({ media_id: MEDIA[i], storage_path: `presence-media/${SITE}/photo-${i}.jpg`, variants: [400, 800, 1600].flatMap((w) => ['webp', 'avif'].map((f) => ({ name: `w${w}${f === 'avif' ? '_avif' : ''}`, width: w, format: f, output_path: S.variantPath(`presence-media/${SITE}/photo-${i}.jpg`, w, f) }))) }));
  const all = await fetchVariants(manifest);
  ok('photos: with nothing known, every size is made (18)', store.transforms.length === 18 && Object.keys(all.files).length === 18 && all.reused === 0, String(store.transforms.length));
  ok('photos: a few at a time, not all at once', store.maxInFlight <= 8 && store.maxInFlight > 1, String(store.maxInFlight));
  const known = {};
  for (const v of manifest[0].variants.concat(manifest[1].variants)) known[v.output_path] = 'sha-' + v.output_path;
  resetHost();
  const some = await fetchVariants(manifest, known);
  ok('photos: the two the live site has are named by digest, only the new one is made (6)', store.transforms.length === 6 && some.reused === 12 && store.transforms.every((t) => t.includes('photo-2')), String(store.transforms.length));
  const named = some.files[manifest[0].variants[0].output_path.slice(1)];
  ok('photos: a named one carries its digest and can still be made', named && named.sha === known[manifest[0].variants[0].output_path] && typeof named.load === 'function');
}

// ═══ 4. the host is sent only what it asks for, a few at a time ═══
{
  resetHost();
  const files = { 'index.html': '<h1>a</h1>', 'b.html': 'b', 'c.html': 'c', 'd.html': 'd', 'e.html': 'e', 'f.html': 'f', 'img/x-400.webp': { sha: 'feed', load: async () => { nf.loaded = (nf.loaded || 0) + 1; return enc.encode('x'); } }, 'img/y-400.webp': { sha: 'beef', load: async () => { nf.loadedY = 1; return enc.encode('y'); } } };
  const digests = await digestFiles(files);
  nf.required = (asked) => Object.entries(asked).filter(([p]) => p !== '/img/y-400.webp').map(([, d]) => d);
  const r = await deployFileMap('nf1', files, { title: 't', pollMs: 50, digests });
  ok('send: only what the host asked for goes up, a named photo made when asked', r.ok && nf.uploads.length === 7 && nf.loaded === 1 && !nf.loadedY, `${nf.uploads.length} ${nf.loaded} ${nf.loadedY}`);
  ok(`send: at most ${UPLOADS_AT_ONCE} at once, more than one`, nf.maxInFlight <= UPLOADS_AT_ONCE && nf.maxInFlight > 1, String(nf.maxInFlight));
  ok('send: the answer lists every file’s digest as sent', sameFiles(r.files, digests) && r.files['/img/y-400.webp'] === 'beef');
  resetHost();
  nf.required = (asked) => Object.values(asked);
  const bad = await deployFileMap('nf1', { 'a.html': 'a', 'img/z.webp': { sha: 'dead', load: async () => null } }, { pollMs: 50 });
  ok('send: a named photo that can’t be made stops the deploy, plainly', !bad.ok && /couldn't be made/.test(bad.error || ''), bad.error);
}

// ═══ 5. the whole publish: first, unchanged, a restore, one word, another deploy live ═══
{
  seed(); resetHost();
  const first = await publish();
  const rec1 = db.tables.presence_publishes[0];
  ok('first publish: live, one deploy, every photo made once', first.status === 200 && first.body.data.status === 'live' && nf.deploys.length === 1 && store.transforms.length === 4 * 6, `${first.status} ${JSON.stringify(first.body).slice(0, 160)} transforms=${store.transforms.length}`);
  ok('first publish: the record keeps what went up, and was paid for', rec1.status === 'live' && rec1.netlify_deploy_id === 'dep1' && rec1.deploy_files && Object.keys(rec1.deploy_files).length === Object.keys(nf.deploys[0].files).length && rec1.unchanged !== true);

  store.transforms = []; nf.deploys = []; nf.uploads = [];
  const again = await publish();
  const rec2 = db.tables.presence_publishes[1];
  ok('nothing changed: no deploy and no photo made', nf.deploys.length === 0 && store.transforms.length === 0 && nf.uploads.length === 0, `${nf.deploys.length} ${store.transforms.length}`);
  ok('nothing changed: the answer says live, and why nothing was sent', again.status === 200 && again.body.data.status === 'live' && again.body.data.unchanged === true && again.body.data.message === unchangedMessage('publish'));
  ok('nothing changed: recorded as live on the same deploy, marked unchanged', rec2.status === 'live' && rec2.netlify_deploy_id === 'dep1' && rec2.unchanged === true && sameFiles(rec2.deploy_files, rec1.deploy_files));
  ok('nothing changed: the site still counts as just published', !!db.tables.presence_sites[0].last_published_at);

  // the database stamps a kept version when it's written, the same day the publish drew it
  // (the privacy page prints that day); the fake's own clock starts on another day
  for (const snap of db.tables.presence_snapshots) snap.created_at = new Date().toISOString();
  const back = await restore(rec1.id);
  ok('a restore to what is live: nothing sent either', back.status === 200 && back.body.data.unchanged === true && back.body.data.message === unchangedMessage('restore') && nf.deploys.length === 0 && store.transforms.length === 0, `${back.status} ${JSON.stringify(back.body).slice(0, 200)} deploys=${nf.deploys.length} transforms=${store.transforms.length}`);
  ok('a restore to what is live: recorded as a restore, unchanged', db.tables.presence_publishes[2].kind === 'restore' && db.tables.presence_publishes[2].unchanged === true);

  db.tables.presence_identity[0].tagline = 'Better food';
  const word = await publish();
  ok('one word changed: a deploy, and no photo made again', word.body.data.status === 'live' && !word.body.data.unchanged && nf.deploys.length === 1 && store.transforms.length === 0, `${nf.deploys.length} ${store.transforms.length}`);
  ok('one word changed: only changed pages go up, never a photo', nf.uploads.length > 0 && nf.uploads.every((p) => !p.startsWith('/img/')), nf.uploads.join(' '));
  const rec4 = db.tables.presence_publishes[3];
  ok('one word changed: the new record keeps the new list', rec4.netlify_deploy_id === 'dep2' && !sameFiles(rec4.deploy_files, rec1.deploy_files) && rec4.unchanged !== true);

  // the offline page (or anything else) went live since: never skipped
  nf.live = 'dep-offline'; nf.deploys = [];
  const over = await publish();
  ok('another deploy is live: the same files are deployed over it', over.body.data.status === 'live' && !over.body.data.unchanged && nf.deploys.length === 1);
}

// ═══ 6. before migration 0205: publishing works as it did ═══
{
  seed(); resetHost();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url)); const method = (init.method || 'GET').toUpperCase();
    if (u.pathname === '/rest/v1/presence_publishes' && ((method === 'GET' && /deploy_files/.test(decodeURIComponent(u.search))) || (method === 'PATCH' && /deploy_files|unchanged/.test(String(init.body))))) return json({ code: '42703', message: 'column presence_publishes.deploy_files does not exist' }, 400);
    return real(url, init);
  };
  const a = await publish();
  const b = await publish();
  globalThis.fetch = real;
  ok('before 0205: both publishes go live, each one a deploy as before', a.body.data.status === 'live' && b.body.data.status === 'live' && nf.deploys.length === 2 && db.tables.presence_publishes.every((p) => p.status === 'live' && !p.deploy_files), `${nf.deploys.length}`);
}

// ═══ 7. restore to the draft reads only the photos that version kept ═══
{
  const src = read('supabase/functions/presence/lib/draft_writer.ts');
  ok('restore to draft: reads the version’s photos by id, every file a page at a time only without a list', /readMediaByIds\(site\.id, keptIds/.test(src) && /svcAll\(`presence_media\?site_id=eq\.\$\{site\.id\}&deleted_at=is\.null&select=id,storage_path,alt_text`, 'id'\)/.test(src) && !/\(await svc\(`presence_media\?site_id=eq\.\$\{site\.id\}&deleted_at=is\.null&select=id,storage_path,alt_text`\)\)/.test(src));
}

// ═══ 8. migration 0205 and its pack say the same ═══
{
  const mig = read('supabase/migrations/0205_publish_sends_what_changed.sql');
  const pack = read('docs/presence/APPLY-0205-prod.sql');
  const body = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim();
  ok('0205: adds the two columns, empty, and nothing else', /add column if not exists deploy_files jsonb/.test(mig) && /add column if not exists unchanged boolean not null default false/.test(mig) && !/update |delete |drop /i.test(body(mig)));
  ok('0205: the pack runs exactly the migration', body(pack) === body(mig), `${body(pack).length} vs ${body(mig).length}`);
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
