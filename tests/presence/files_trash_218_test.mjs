// ── Files keep a Trash for 30 days (builder list item 218) ───────────────────
// Nov 12 review, file 01, finding 8: Delete in Files removed the stored file at once, so a
// client deleting their only logo had no way back. This suite pins:
//   · the pure rules (lib/media_trash.ts): the 30-day clock, the row's change going in and
//     coming out, who is named, the Trash row, the limits Put back keeps;
//   · the routes, through the real handlers against an in-memory PostgREST and storage:
//     Delete moves to the Trash and keeps the stored file; a file in use is refused; before
//     the database step nothing is deleted; the Trash list; Put back (and the full site);
//     Delete for good (and the file the live site still shows); the editor's Remove;
//   · what a published page that uses a file in the Trash does: a draft or a version that
//     names one takes it out of the Trash (publish, restore, restore to the draft, a page
//     put back from Versions);
//   · the daily sweep: past 30 days a file goes for good, unless the live site still shows
//     it (kept) or the draft uses it again (put back); a failed store delete keeps the row;
//     closing an account takes the Trash with it;
//   · the wiring: both sweeps, media_gc leaving the Trash alone, the migration and its pack,
//     the member gate.
//   deno run --allow-read --allow-env --allow-net tests/presence/files_trash_218_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'service-key');
const P = '../../supabase/functions/presence';
const MT = await import(`${P}/lib/media_trash.ts`);
const { handleAssetDelete, handleAssetsTrash, handleAssetPutBack, handleAssetDeleteForGood, handleAssetsList } = await import(`${P}/routes/assets.ts`);
const { handleMediaDelete } = await import(`${P}/routes/media.ts`);
const { runFileTrashPurge } = await import(`${P}/ops/file_trash.ts`);
const { sweepIssues } = await import(`${P}/routes/system.ts`);
const { memberWriteNeeds } = await import(`${P}/lib/site_roles.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const DAY = 86_400_000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const quiet = async (fn) => { const l = console.log, e = console.error, w = console.warn; console.log = () => {}; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; console.warn = w; } };

// ═══ 1. the pure rules ═══
{
  const at = '2026-11-15T12:00:00.000Z';
  ok('clock: a file put in the Trash today goes 30 days later', MT.trashGoesAt(at) === '2026-12-15T12:00:00.000Z' && MT.trashGoesAt(null) === null && MT.FILE_TRASH_DAYS === 30);
  ok('clock: days left count down to 0, never below', MT.trashDaysLeft(at, at) === 30 && MT.trashDaysLeft('2026-12-14T13:00:00.000Z', at) === 1 && MT.trashDaysLeft('2027-01-30T00:00:00.000Z', at) === 0);
  ok('clock: due on the 30th day, not before', MT.trashDue('2026-12-15T12:00:00.000Z', at) && !MT.trashDue('2026-12-15T11:59:00.000Z', at) && !MT.trashDue(at, ''));
  const tp = MT.trashPatch(at, 'Eric', { caption: 'Shop front', favorite: true });
  ok('going in: out of every list (deleted_at), marked as in the Trash, who did it kept with its other notes', tp.deleted_at === at && tp.trashed_at === at && tp.metadata.trashed_by === 'Eric' && tp.metadata.caption === 'Shop front' && tp.metadata.favorite === true);
  const pb = MT.putBackPatch({ caption: 'Shop front', trashed_by: 'Eric' });
  ok('coming out: both marks cleared, the note of who put it there goes, the rest stays', pb.deleted_at === null && pb.trashed_at === null && !('trashed_by' in pb.metadata) && pb.metadata.caption === 'Shop front');
  ok('who: a name, else the first part of the email, capitalised, else "Someone"', MT.trashedBy({ name: 'Maya Ortiz', email: 'x@y.z' }) === 'Maya Ortiz' && MT.trashedBy({ email: 'eric@davisdigital.studio' }) === 'Eric' && MT.trashedBy({ email: 'maya.ortiz@studio.example' }) === 'Maya' && MT.trashedBy({ email: null }) === 'Someone');
  const row = MT.trashRow({ id: 'f1', mime: 'image/jpeg', bytes: 605000, collection: 'Spring promo', trashed_at: ago(3), metadata: { trashed_by: 'Maya' } }, new Date().toISOString(), true);
  ok('Trash row: kind, size, folder, when it goes, days left, who, and whether the live site still shows it', row.kind === 'image' && row.bytes === 605000 && row.folder === 'Spring promo' && row.days_left === 27 && row.by === 'Maya' && row.live === true && row.kept_live === false && !!row.goes_at);
  const old = MT.trashRow({ id: 'f2', mime: 'application/pdf', trashed_at: ago(40) }, new Date().toISOString(), true);
  ok('Trash row: past its days while the live site shows it says kept, not gone', old.kind === 'document' && old.days_left === 0 && old.kept_live === true && old.by === null);
  const lim = { maxFiles: 100, maxBytes: 1_000_000_000 };
  ok('Put back keeps the upload door\'s limits: the file cap, then the space', MT.putBackRefusal({ files: 100, bytes: 0 }, 10, lim) === 'files' && MT.putBackRefusal({ files: 3, bytes: 999_999_990 }, 20, lim) === 'space' && MT.putBackRefusal({ files: 99, bytes: 0 }, 20, lim) === null && MT.putBackRefusal(null, 20, lim) === null);
}

// ═══ 2. an in-memory PostgREST and store ═══
const SITE = '5175e000-0000-4000-8000-000000000001';
const OTHER = '5175e000-0000-4000-8000-000000000009';
const id = (n) => `f11e0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FREE = id(1), USED = id(2), LIVE = id(3), GONE = id(4), POSTED = id(5), OLD = id(6), OLD_LIVE = id(7), OLD_AGAIN = id(8), OLD_STUCK = id(9), FRESH = id(10), THEIRS = id(11), DOC = id(12);
const SNAP = 'aaaaaaaa-0000-4000-8000-0000000000a1';
let T, writes, store, opts;
const media = (mid, over = {}) => ({ id: mid, site_id: SITE, storage_path: `presence-media/${SITE}/${mid}.jpg`, alt_text: `Photo ${mid.slice(-2)}`, mime: 'image/jpeg', bytes: 1000, width: 800, height: 600, collection: null, metadata: {}, asset_status: 'approved', created_at: ago(60), deleted_at: null, trashed_at: null, ...over });
const trashed = (mid, days, over = {}) => media(mid, { deleted_at: ago(days), trashed_at: ago(days), metadata: { trashed_by: 'Eric' }, ...over });
function reset(o = {}) {
  opts = { noTrashColumn: false, storeDeleteFails: [], usage: { files: 3, bytes: 3000 }, ...o };
  T = {
    presence_media: [
      media(FREE), media(USED), media(LIVE), media(DOC, { mime: 'application/pdf', storage_path: `presence-media/${SITE}/${DOC}.pdf` }),
      trashed(GONE, 2), trashed(POSTED, 5),
      trashed(OLD, 31), trashed(OLD_LIVE, 35), trashed(OLD_AGAIN, 33), trashed(OLD_STUCK, 32), trashed(FRESH, 10),
      { ...trashed(THEIRS, 40), site_id: OTHER },
      media(id(20), { deleted_at: ago(9), metadata: { replaced_by: FREE } }),   // an old version a Replace left: not the Trash's
    ],
    // the draft: one section shows USED; OLD_AGAIN came back into the draft (an undo); POSTED is named by a restored page
    presence_settings: [{ site_id: SITE, logo_media_id: null, og_media_id: null, cover_media_id: null, icon_media_id: null, blocks: [{ type: 'gallery', images: [{ media_id: USED }, { media_id: OLD_AGAIN }] }], pages: [{ slug: 'spring', blocks: [{ type: 'image_text', media_id: POSTED }] }], page_seo: {}, brand_kit: null }],
    presence_offerings: [], presence_posts: [], presence_deliverables: [], presence_content_library: [],
    // the live site: its last publish shows LIVE, OLD_LIVE and GONE
    presence_publishes: [{ id: 'pub1', site_id: SITE, status: 'live', snapshot_id: SNAP, created_at: ago(20) }],
    presence_snapshots: [{ id: SNAP, site_id: SITE, media_manifest: [{ media_id: LIVE }, { media_id: OLD_LIVE }, { media_id: GONE }] }],
    presence_change_events: [],
  };
  writes = []; store = [];
}
function match(r, k, v) {
  const val = (x) => decodeURIComponent(x).replace(/^"(.*)"$/, '$1');
  if (v.startsWith('eq.')) return String(r[k]) === val(v.slice(3));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(r[k]));
  if (v.startsWith('lte.')) return r[k] != null && Date.parse(r[k]) <= Date.parse(val(v.slice(4)));
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
  return true;   // like., or., …: not needed to tell these rows apart
}
const CTRL = ['select', 'limit', 'order', 'on_conflict', 'offset'];
const rowsFor = (table, params) => { const rows = (T[table] || []).filter((r) => [...params.entries()].every(([k, v]) => CTRL.includes(k) || match(r, k, v))); const lim = Number(params.get('limit')); return lim ? rows.slice(0, lim) : rows; };
const noColumn = () => new Response(JSON.stringify({ code: '42703', message: 'column presence_media.trashed_at does not exist' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return init.body; } })() : null;
  const reply = (b, status = 200, headers = {}) => new Response(b === null ? null : JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  if (u.pathname.startsWith('/storage/v1/')) {
    store.push({ method, path: u.pathname });
    if (method === 'DELETE') return opts.storeDeleteFails.some((m) => u.pathname.includes(m)) ? reply({ message: 'boom' }, 500) : reply({});
    return reply({});   // signing: no URL, so no thumbnail
  }
  const table = u.pathname.replace(/^.*\/rest\/v1\//, '');
  if (table === 'rpc/presence_media_usage') return reply([opts.usage]);
  const touchesTrash = /trashed_at/.test(u.search) || (body && typeof body === 'object' && 'trashed_at' in body);
  if (opts.noTrashColumn && table === 'presence_media' && touchesTrash) return noColumn();
  if (method === 'HEAD') { const n = rowsFor(table, u.searchParams).length; return new Response(null, { status: 200, headers: { 'content-range': n ? `0-${n - 1}/${n}` : '*/0' } }); }
  if (method === 'GET') return reply(rowsFor(table, u.searchParams));
  writes.push({ table, method, body, query: decodeURIComponent(u.search) });
  if (method === 'PATCH') { const hit = rowsFor(table, u.searchParams); hit.forEach((r) => Object.assign(r, body)); return reply(hit); }
  if (method === 'DELETE') { const hit = rowsFor(table, u.searchParams); T[table] = (T[table] || []).filter((r) => !hit.includes(r)); return reply(hit); }
  if (method === 'POST') { const list = Array.isArray(body) ? body : [body]; const out = list.map((r) => { const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }; (T[table] = T[table] || []).push(row); return row; }); return reply(out, 201); }
  return reply([]);
};
const A = { id: SITE, client_id: 'c1000000-0000-4000-8000-000000000001', template_slug: 'business-classic', template_version: '1.0.0', edition: 'presence', status: 'ready' };
const ME = { kind: 'client', userId: '99999999-0000-4000-8000-000000000009', tenantId: null, role: 'client', email: 'eric@studio.example', jwt: 'jwt-x', requestId: 't' };
const cors = {};
const answer = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
const rowOf = (mid) => T.presence_media.find((m) => m.id === mid);
const storeDeletes = () => store.filter((s) => s.method === 'DELETE');
const events = (summary) => T.presence_change_events.filter((e) => e.summary === summary);

// ═══ 3. Delete moves a file to the Trash ═══
{
  reset();
  const r = await answer(await handleAssetDelete(A, ME, FREE, cors));
  const f = rowOf(FREE);
  ok('Delete: the file goes in the Trash, out of every list, with who did it', r.status === 200 && r.body.data.trashed === true && !!f.deleted_at && f.trashed_at === f.deleted_at && f.metadata.trashed_by === 'Eric', JSON.stringify(r.body));
  ok('Delete: the stored file is kept, so Put back has something to bring back', storeDeletes().length === 0);
  ok('Delete: the answer says when it goes for good, and that the live site doesn\'t show it', Math.round((Date.parse(r.body.data.goes_at) - Date.parse(f.trashed_at)) / DAY) === 30 && r.body.data.days === 30 && r.body.data.on_live === false);
  ok('Delete: the history says "Moved a file to the Trash"', events('Moved a file to the Trash').length === 1 && events('Moved a file to the Trash')[0].action === 'delete');
  const live = await answer(await handleAssetDelete(A, ME, LIVE, cors));
  ok('Delete: a file only the live site shows may go in the Trash, and the answer says the live site still shows it', live.status === 200 && live.body.data.on_live === true && !!rowOf(LIVE).trashed_at);
  const n = writes.length;
  const used = await answer(await handleAssetDelete(A, ME, USED, cors));
  ok('Delete: a file the draft uses is refused, by name, and nothing is written', used.status === 409 && used.body.error === 'in_use' && writes.length === n && rowOf(USED).trashed_at === null);
}
{
  reset({ noTrashColumn: true });
  const r = await quiet(async () => answer(await handleAssetDelete(A, ME, FREE, cors)));
  ok('before the database step: Delete says the Trash isn\'t on and deletes nothing', r.status === 503 && r.body.error === 'trash_unavailable' && rowOf(FREE).deleted_at === null && storeDeletes().length === 0, JSON.stringify(r.body));
  const t = await answer(await handleAssetsTrash(A, cors));
  ok('before the database step: the Trash reads as empty, said as not on yet', t.status === 200 && t.body.data.files.length === 0 && t.body.data.available === false);
}
{
  reset();
  const r = await answer(await handleMediaDelete(A, ME, FREE, cors));
  ok('the editor\'s Remove moves the photo to the Trash too, and keeps the stored file', r.status === 200 && r.body.data.trashed === true && !!rowOf(FREE).trashed_at && storeDeletes().length === 0 && events('Moved a photo to the Trash').length === 1);
}

// ═══ 4. the Trash, Put back, Delete for good ═══
{
  reset();
  const t = await answer(await handleAssetsTrash(A, cors));
  const files = t.body.data.files;
  ok('Trash: this site\'s files only, newest first', t.status === 200 && files.length === 7 && files[0].id === GONE && !files.some((f) => f.id === THEIRS) && !files.some((f) => f.id === id(20)), files.map((f) => f.id.slice(-2)).join(','));
  const g = files.find((f) => f.id === GONE), ol = files.find((f) => f.id === OLD_LIVE);
  ok('Trash: each with its days left, who, and whether the live site still shows it', g.days_left === 28 && g.by === 'Eric' && g.live === true && files.find((f) => f.id === POSTED).live === false && !!g.name);
  ok('Trash: past its days but still live reads as kept', ol.kept_live === true && ol.days_left === 0);
  const list = await answer(await handleAssetsList(new Request('http://stub.local/functions/v1/presence/assets'), A, cors));
  ok('Files: the list carries the Trash\'s count for its chip', list.status === 200 && list.body.data.trash === 7, String(list.body?.data?.trash));
}
{
  reset();
  const r = await answer(await handleAssetPutBack(A, ME, POSTED, cors));
  const f = rowOf(POSTED);
  ok('Put back: out of the Trash and back in Files, the note of who trashed it gone', r.status === 200 && f.deleted_at === null && f.trashed_at === null && !('trashed_by' in f.metadata) && r.body.data.asset.id === POSTED);
  ok('Put back: the history says so', events('Put a file back from the Trash').length === 1 && events('Put a file back from the Trash')[0].action === 'restore');
  ok('Put back: a file that isn\'t in the Trash is not found', (await answer(await handleAssetPutBack(A, ME, FREE, cors))).status === 404 && (await answer(await handleAssetPutBack(A, ME, THEIRS, cors))).status === 404);
  reset({ usage: { files: 100, bytes: 0 } });
  const full = await answer(await handleAssetPutBack(A, ME, POSTED, cors));
  ok('Put back: refused while Files is full, as an upload would be, and nothing changes', full.status === 409 && full.body.error === 'full' && /full/.test(full.body.message) && rowOf(POSTED).trashed_at !== null);
}
{
  reset();
  const live = await answer(await handleAssetDeleteForGood(A, ME, GONE, cors));
  ok('Delete for good: not while the live site still shows it, and it says to publish first', live.status === 409 && live.body.error === 'still_live' && /Publish your site first/.test(live.body.message) && !!rowOf(GONE) && storeDeletes().length === 0);
  const r = await answer(await handleAssetDeleteForGood(A, ME, POSTED, cors));
  ok('Delete for good: the stored file, then the row', r.status === 200 && !rowOf(POSTED) && storeDeletes().length === 1 && storeDeletes()[0].path.endsWith(`${POSTED}.jpg`));
  ok('Delete for good: the history says so', events('Deleted a file for good').length === 1);
  ok('Delete for good: only a file in the Trash', (await answer(await handleAssetDeleteForGood(A, ME, FREE, cors))).status === 404 && !!rowOf(FREE));
  reset({ storeDeleteFails: [OLD] });
  const fail = await quiet(async () => answer(await handleAssetDeleteForGood(A, ME, OLD, cors)));
  ok('Delete for good: when the store won\'t delete, the row stays in the Trash and it says so', fail.status === 502 && !!rowOf(OLD) && rowOf(OLD).trashed_at !== null);
}

// ═══ 5. a version or a draft that names a file in the Trash brings it back ═══
{
  reset();
  const back = await MT.putBackUsed(SITE, [FREE, GONE, POSTED, THEIRS, 'not-an-id'], ME, 'a version going live uses it');
  ok('putBackUsed: only this site\'s files in the Trash among the ids come back', back.sort().join() === [GONE, POSTED].sort().join() && rowOf(GONE).trashed_at === null && T.presence_media.find((m) => m.id === THEIRS).trashed_at !== null);
  ok('putBackUsed: each says why in the history', events('Put a file back from the Trash: a version going live uses it').length === 2);
  reset();
  const draft = await MT.putBackWhatTheDraftUses(SITE, ME);
  ok('publish: the files in the Trash that the draft names come out of it first, and only those', draft.sort().join() === [POSTED, OLD_AGAIN].sort().join() && rowOf(POSTED).deleted_at === null && rowOf(OLD).trashed_at !== null, draft.join(','));
  reset();
  T.presence_media = T.presence_media.filter((m) => !m.trashed_at);
  const before = writes.length;
  ok('publish: a site with nothing in the Trash costs one small read and writes nothing', (await MT.putBackWhatTheDraftUses(SITE, ME)).length === 0 && writes.length === before);
  reset();
  const PAGE = 'dddddddd-0000-4000-8000-000000000218';
  T.presence_deleted_pages = [{ id: PAGE, site_id: SITE, slug: 'gallery', title: 'Gallery', page: { slug: 'gallery', title: 'Gallery', blocks: [{ type: 'gallery', images: [{ media_id: GONE }] }] }, deleted_at: ago(2) }];
  const { handleDeletedPageRestore } = await import(`${P}/routes/deleted_pages.ts`);
  const { svc } = await import(`${P}/lib/db.ts`);
  const pr = await answer(await handleDeletedPageRestore(new Request('http://stub.local/functions/v1/presence/pages/deleted/x/restore', { method: 'POST' }), (p, i) => svc(p, i), A, ME, PAGE, cors));
  ok('a page put back from Versions brings its photo out of the Trash with it', pr.status === 200 && rowOf(GONE).trashed_at === null && rowOf(GONE).deleted_at === null && rowOf(OLD).trashed_at !== null, JSON.stringify(pr.body).slice(0, 160));
}

// ═══ 6. the daily sweep ═══
{
  reset({ storeDeleteFails: [OLD_STUCK] });
  const r = await quiet(() => runFileTrashPurge(100));
  ok('sweep: what has been in a Trash 30 days, everywhere, oldest first', r.due === 5, JSON.stringify(r));
  ok('sweep: an unused file goes for good, stored file and row', !rowOf(OLD) && store.some((s) => s.method === 'DELETE' && s.path.endsWith(`${OLD}.jpg`)) && !T.presence_media.some((m) => m.id === THEIRS));
  ok('sweep: one the live site still shows is kept, not deleted', !!rowOf(OLD_LIVE) && rowOf(OLD_LIVE).trashed_at !== null && r.kept_live === 1);
  ok('sweep: one the draft uses again comes out of the Trash', rowOf(OLD_AGAIN).trashed_at === null && rowOf(OLD_AGAIN).deleted_at === null && r.put_back === 1);
  ok('sweep: when the store won\'t delete, the row stays for the next run and it counts as failed', !!rowOf(OLD_STUCK) && r.failed === 1 && r.deleted === 2);
  ok('sweep: a file 10 days in is left alone', rowOf(FRESH).trashed_at !== null);
  ok('sweep: a failure pages, as every sweep\'s does', sweepIssues({ file_trash: r }).length === 1);
  reset();
  const clean = await quiet(() => runFileTrashPurge(100));
  ok('sweep: a clean run reads as healthy, with no bare false anywhere', sweepIssues({ file_trash: clean }).length === 0 && !Object.values(clean).includes(false), JSON.stringify(clean));
  reset({ noTrashColumn: true });
  const before = await runFileTrashPurge(100);
  ok('sweep: before the database step it skips, said as skipped_unavailable, and reads as healthy', before.skipped_unavailable === true && sweepIssues({ file_trash: before }).length === 0 && storeDeletes().length === 0);
  reset();
  T.presence_media = T.presence_media.filter((m) => !m.trashed_at || Date.parse(m.trashed_at) > Date.now() - 30 * DAY);
  const none = await runFileTrashPurge(100);
  ok('sweep: nothing due, nothing read beyond the one query', none.due === 0 && none.deleted === 0 && writes.length === 0);
}

// ═══ 6b. closing an account takes the Trash with it ═══
{
  reset();
  const { eraseSiteData, eraseDeps } = await import(`${P}/commerce/erase.ts`);
  eraseDeps.list = async () => [];
  eraseDeps.remove = async () => true;
  const r = await quiet(() => eraseSiteData(SITE));
  ok('closing an account: files in the Trash lose its mark, so the 7-day clean-up clears them with the rest', r.ok === true && T.presence_media.filter((m) => m.site_id === SITE).every((m) => m.trashed_at === null && !!m.deleted_at) && T.presence_media.find((m) => m.id === THEIRS).trashed_at !== null, JSON.stringify(r));
  reset({ noTrashColumn: true });
  ok('closing an account before the database step still completes', (await quiet(() => eraseSiteData(SITE))).ok === true);
}

// ═══ 7. the wiring ═══
{
  const sys = read('supabase/functions/presence/routes/system.ts');
  const groups = sys.slice(sys.indexOf('const GROUPS'), sys.indexOf("json({ data: summarizeProgress"));
  const chain = sys.slice(sys.indexOf('// ── The default tick'));
  ok('wiring: the sweep runs in the hygiene group and the default tick, after the sites\' trash', /hygiene: \[[\s\S]*'site_trash'[\s\S]*'file_trash', \(\) => runFileTrashPurge\(100\)/.test(groups) && /step\('site_trash'[\s\S]*step\('file_trash', \(\) => runFileTrashPurge\(100\)\)/.test(chain));
  const gc = read('supabase/functions/presence/lib/media_gc.ts');
  ok('wiring: media_gc\'s 7-day clean-up leaves the Trash alone, in its read and its delete', /deleted_at=lte\.\$\{encodeURIComponent\(softBefore\)\}&trashed_at=is\.null/.test(gc) && /deleted_at=not\.is\.null&trashed_at=is\.null`, \{ method: 'DELETE' \}/.test(gc));
  const pub = read('supabase/functions/presence/routes/publish.ts');
  ok('wiring: a restore, Back online or Publish again brings its files out of the Trash before the photos are fetched', pub.indexOf("if (kind === 'restore') await putBackUsed(") > 0 && pub.indexOf("if (kind === 'restore') await putBackUsed(") < pub.indexOf('await fetchVariants(snapshotArg.mediaManifest'));
  const hp = pub.slice(pub.indexOf('export async function handlePublish'));
  ok('wiring: a publish brings the draft\'s files out of the Trash before reading the draft', hp.indexOf('await putBackWhatTheDraftUses(site.id, principal);') > 0 && hp.indexOf('await putBackWhatTheDraftUses(site.id, principal);') < hp.indexOf('await serializeDraft('));
  const dw = read('supabase/functions/presence/lib/draft_writer.ts');
  ok('wiring: a version restored to the draft keeps its photos that went in the Trash', dw.indexOf('await putBackUsed(site.id, keptIds, principal') > 0 && dw.indexOf('await putBackUsed(site.id, keptIds, principal') < dw.indexOf('await readMediaByIds(site.id, keptIds'));
  ok('wiring: the server\'s own clean-ups still delete at once (a public upload that didn\'t finish)', /deleteMedia\(siteId, file\.id\)/.test(read('supabase/functions/presence/routes/intake_public.ts')));
  ok('member gate: Put back is an edit, Delete for good a delete, like the Delete that started it', memberWriteNeeds(`/assets/${FREE}/put-back`, 'POST') === 'edit' && memberWriteNeeds(`/assets/${FREE}/forever`, 'DELETE') === 'delete' && memberWriteNeeds(`/assets/${FREE}`, 'DELETE') === 'delete');
  const idx = read('supabase/functions/presence/index.ts');
  ok('router: the Trash, Put back and Delete for good are routed', idx.includes("route === '/assets/trash' && method === 'GET'") && /assets\\\/\(\[0-9a-f-\]\{36\}\)\\\/put-back\$/.test(idx) && /assets\\\/\(\[0-9a-f-\]\{36\}\)\\\/forever\$/.test(idx));
  const mig = read('supabase/migrations/0225_files_trash.sql'), pack = read('docs/presence/APPLY-0225-prod.sql');
  const sql = (s) => s.split('\n').filter((l) => !l.startsWith('--')).join('\n').trim();
  ok('migration 0225 and its pack: one column and two indexes, the same statements, additive', /add column if not exists trashed_at timestamptz/.test(mig) && (mig.match(/create index if not exists presence_media_trash_/g) || []).length === 2 && sql(mig) === sql(pack) && !/\bdrop\b/i.test(sql(mig)));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ FILES TRASH (item 218): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
