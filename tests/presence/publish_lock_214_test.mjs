// ── Publish again, and Lock publishing (builder item 214, Nov 12 review file 03, finding 2) ──
// Publish again puts an earlier publish back on the live site in one step and leaves the draft
// alone; the one live now isn't offered twice. Lock publishing holds the live site as it is:
// while it is on, nothing goes live by any route (Publish, Publish again, Bring back online,
// Take offline, and a scheduled publish, which waits), and a lock that can't be read holds too.
// The studio and platform staff lock and unlock; the owner only of a site no studio looks after,
// and only a lock the owner set. The routes run for real against the in-memory PostgREST.
//   deno run --allow-read --allow-env tests/presence/publish_lock_214_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const db = installFakePostgrest({});
// a module the code under test doesn't have yet is an empty one, so every check still runs
const L = await import('../../supabase/functions/presence/lib/publish_lock.ts').catch(() => ({}));
const R = await import('../../supabase/functions/presence/routes/publish_lock.ts').catch(() => ({}));
const PUB = await import('../../supabase/functions/presence/routes/publish.ts');
const { runDuePublishes } = await import('../../supabase/functions/presence/ops/scheduler.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const check = async (n, fn) => { let p = false; try { p = !!(await fn()); } catch (e) { return ok(n, false, String(e).slice(0, 90)); } ok(n, p); };
const body = async (r) => { try { return await r.json(); } catch { return null; } };

const SITE = '11111111-1111-4111-8111-111111111111', OWN = '22222222-2222-4222-8222-222222222222';
const SNAP_NOW = '33333333-3333-4333-8333-333333333333', SNAP_OLD = '44444444-4444-4444-8444-444444444444';
const PUB_NOW = '55555555-5555-4555-8555-555555555555', PUB_OLD = '66666666-6666-4666-8666-666666666666';
const site = (id = SITE, over = {}) => ({ id, status: 'live', edition: 'presence', template_slug: 'business-classic', template_version: '1.0.0', netlify_site_id: null, custom_domain: null, last_published_at: null, client_id: null, ...over });
const STUDIO = { kind: 'client', userId: 'u-studio', email: 'studio@example.com', scope: { site_id: SITE, name: 'Marlow’s Kitchen' } };
const STAFF = { kind: 'staff', userId: 'u-staff', email: 'staff@example.com' };
const OWNER = { kind: 'client', userId: 'u-owner', email: 'owner@example.com' };
const SEAT = { kind: 'client', userId: 'u-seat', email: 'seat@example.com', member: { site_id: OWN, role: 'business_staff' } };
const lockRow = (siteId, lock) => ({ id: crypto.randomUUID(), site_id: siteId, kind: 'proposal', name: '__publish_lock__', title: '', body: JSON.stringify(lock), deleted_at: null, updated_at: '2026-11-12T15:40:00Z' });
const STUDIO_LOCK = { on: true, at: '2026-11-12T15:40:00Z', by_kind: 'operator', words: 'Launch freeze until Friday, Nov 14.' };
const snapRow = (id) => ({ id, site_id: SITE, content: { identity: { business_name: 'Marlow’s Kitchen' }, settings: {} }, media_manifest: [], content_contract_version: 1, template_slug: 'business-classic', template_version: '1.0.0', created_at: '2026-11-08T09:15:00Z', dev_customization: null });
const seed = (extra = {}) => db.reset({
  presence_sites: [site(), site(OWN)],
  presence_agency_clients: [{ agency_id: 'a1', site_id: SITE, status: 'active' }],   // a studio looks after SITE; nobody looks after OWN
  presence_sales_templates: [],
  presence_snapshots: [snapRow(SNAP_NOW), snapRow(SNAP_OLD)],
  presence_publishes: [
    { id: PUB_NOW, site_id: SITE, snapshot_id: SNAP_NOW, kind: 'publish', status: 'live', change_summary: 'Changed the opening hours', version_label: null, created_at: '2026-11-12T10:42:00Z' },
    { id: PUB_OLD, site_id: SITE, snapshot_id: SNAP_OLD, kind: 'publish', status: 'live', change_summary: 'The new lunch page', version_label: 'Spring menu', created_at: '2026-11-08T09:15:00Z' },
  ],
  ...extra,
});
const restoreReq = (id) => new Request('http://x/restore', { method: 'POST', body: JSON.stringify({ publish_id: id }) });
const lockReq = (b) => new Request('http://x/site/publish-lock', { method: 'PUT', body: JSON.stringify(b) });

// ═══ the rules (pure) ═══
await check('words: one line, at most 140 characters, anything else none', () => L.lockWords('  Launch\nfreeze  ') === 'Launch freeze' && L.lockWords('x'.repeat(300)).length === 140 && L.lockWords(7) === '');
await check('a stored lock read safely: malformed is none, an unknown hand counts as staff', () => L.normalizeLock({ on: 'yes' }) === null && L.normalizeLock({ on: true, at: 'soon' }) === null && L.normalizeLock({ on: true, at: STUDIO_LOCK.at, by_kind: 'x' }).by_kind === 'staff');
await check('who may change it: the studio and staff always; the owner of a site no studio looks after; never a seat', () => {
  const studioLock = { ...STUDIO_LOCK }, ownLock = { ...STUDIO_LOCK, by_kind: 'client' };
  return L.mayChangeLock(studioLock, 'operator', true, false) && L.mayChangeLock(studioLock, 'staff', null, false)
    && L.mayChangeLock(null, 'client', false, true) && L.mayChangeLock(ownLock, 'client', false, true)
    && !L.mayChangeLock(studioLock, 'client', false, true)      // the owner can't lift a studio's lock
    && !L.mayChangeLock(null, 'client', true, true)             // nor lock a site a studio looks after
    && !L.mayChangeLock(null, 'client', null, true)             // nor when that couldn't be read
    && !L.mayChangeLock(null, 'client', false, false);          // and a seat never
});
await check('the refusal speaks to whoever asked', () => L.lockedSentence(STUDIO_LOCK, 'client') === 'Your studio locked publishing on Nov 12. Their note: “Launch freeze until Friday, Nov 14.” Nothing was published. Ask them if something needs to go live.'
  && L.lockedSentence(STUDIO_LOCK, 'operator') === 'Publishing is locked since Nov 12. Nothing was published. Unlock it in Versions to publish.');

// ═══ the switch ═══
seed();
await check('the studio locks it with a note for the client, and it is recorded', async () => {
  const r = await R.handlePublishLockPut(lockReq({ on: true, words: 'Launch freeze until Friday, Nov 14.' }), 'jwt', site(), STUDIO, {});
  const d = (await body(r))?.data;
  const stored = JSON.parse(db.tables.presence_sales_templates.find((t) => t.name === '__publish_lock__')?.body || 'null');
  return r.status === 200 && d.on === true && d.words === 'Launch freeze until Friday, Nov 14.' && d.can_change === true && stored.by_kind === 'operator'
    && (db.tables.presence_change_events || []).some((e) => e.summary === 'Locked publishing: “Launch freeze until Friday, Nov 14.”');
});
await check('the client sees it, and can’t lift it', async () => {
  const g = (await body(await R.handlePublishLockGet('jwt', site(), OWNER, {})))?.data;
  const p = await R.handlePublishLockPut(lockReq({ on: false }), 'jwt', site(), OWNER, {});
  return g.on === true && g.can_change === false && g.words === 'Launch freeze until Friday, Nov 14.' && p.status === 403 && (await body(p)).message === 'Your studio locked publishing. Ask them to unlock it.';
});
await check('the owner of a site no studio looks after locks and unlocks it; a seat there can’t', async () => {
  const on = await R.handlePublishLockPut(lockReq({ on: true }), 'jwt', site(OWN), OWNER, {});
  const seat = await R.handlePublishLockPut(lockReq({ on: false }), 'jwt', site(OWN), SEAT, {});
  const off = await R.handlePublishLockPut(lockReq({ on: false }), 'jwt', site(OWN), OWNER, {});
  return on.status === 200 && seat.status === 403 && off.status === 200 && (await body(off)).data.on === false;
});
await check('it has to say on or off', async () => (await R.handlePublishLockPut(lockReq({ on: 'yes' }), 'jwt', site(), STUDIO, {})).status === 400);

// ═══ while it is on, nothing goes live ═══
seed({ presence_sales_templates: [lockRow(SITE, STUDIO_LOCK)] });
{
  const asOwner = await PUB.handlePublish(null, site(), OWNER, {});
  const ob = await body(asOwner);
  ok('Publish: refused, saying who locked it and their note', asOwner.status === 409 && ob?.error === 'publish_locked' && /^Your studio locked publishing on Nov 12\. Their note: “Launch freeze until Friday, Nov 14\.”/.test(ob?.message || ''));
  const asStaff = await PUB.handlePublish(null, site(), STAFF, {});
  ok('Publish: refused for platform staff too (unlock first)', asStaff.status === 409 && (await body(asStaff))?.error === 'publish_locked');
  const again = await PUB.handleRestore(restoreReq(PUB_OLD), site(), STUDIO, {});
  ok('Publish again: refused', again.status === 409 && (await body(again))?.error === 'publish_locked');
  db.tables.presence_sites[0].offline_at = '2026-11-12T16:00:00Z';
  const online = await PUB.handleBackOnline(site(), STUDIO, {});
  ok('Bring back online: refused', online.status === 409 && (await body(online))?.error === 'publish_locked');
  const offline = await PUB.takeSiteOffline(site(SITE, { netlify_site_id: 'nf-1' }), OWNER);
  ok('Take offline: refused (it changes the live site too)', offline.ok === false && offline.error === 'publish_locked');
  ok('nothing was recorded as a publish', db.tables.presence_publishes.length === 2);
}
{
  // a scheduled publish waits, unclaimed, and goes once the lock comes off
  seed({ presence_sales_templates: [lockRow(SITE, STUDIO_LOCK)], presence_scheduled_publishes: [{ id: 'sp-1', site_id: SITE, snapshot_id: SNAP_OLD, kind: 'publish', status: 'pending', fired_at: null, scheduled_for: '2026-11-12T09:00:00Z', summary: 'Weekend specials', created_by: 'owner' }] });
  const cyc = await runDuePublishes();
  const row = db.tables.presence_scheduled_publishes[0];
  ok('scheduled publish: waits while locked, unclaimed, and the tick reports nothing wrong', row.status === 'pending' && row.fired_at === null && cyc.ok === true && cyc.ran === 0);
  db.tables.presence_sales_templates = [lockRow(SITE, { ...STUDIO_LOCK, on: false })];
  await runDuePublishes();
  ok('scheduled publish: goes on the next tick once unlocked', db.tables.presence_scheduled_publishes[0].fired_at !== null);
}
{
  seed({ presence_sales_templates: [lockRow(SITE, STUDIO_LOCK)] });
  db.fail.add('presence_sales_templates');
  const r = await PUB.handlePublish(null, site(), STUDIO, {});
  ok('a lock that can’t be read holds too, and says so', r.status === 503 && (await body(r))?.error === 'lock_unreadable');
}

// ═══ Publish again ═══
{
  seed();
  const same = await PUB.handleRestore(restoreReq(PUB_NOW), site(), STUDIO, {});
  ok('the version live now isn’t published twice', same.status === 409 && (await body(same))?.error === 'already_live');
  await PUB.handleRestore(restoreReq(PUB_OLD), site(), STUDIO, {});
  const rec = db.tables.presence_publishes.find((p) => p.id !== PUB_NOW && p.id !== PUB_OLD);
  ok('an earlier one goes through the one pipeline, kept as “Published again” with its name', !!rec && rec.kind === 'restore' && rec.snapshot_id === SNAP_OLD && rec.change_summary === 'Published again: “Spring menu”');
  ok('and the draft isn’t touched', !(db.writes('presence_settings').length) && !(db.writes('presence_identity').length));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
