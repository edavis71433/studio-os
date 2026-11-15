// ── Publishing and copying say what happened (builder item 196, Nov 12 review file 06) ──
// Finding 30: a page copied from another site keeps "needs a password" but never its password,
//   so Publish left it off the live site without a word. It is one thing to finish now.
// Finding 32: the copied-words item names the first copied section, and no longer sends a
//   client to Sites, a page only the studio has.
// Finding 33: Duplicate and templates keep menu folders and the pages in them.
// Finding 34: a shared draft link leaves out password and private pages, as the live site does.
// Finding 35: Bring back online (and every other way of putting a version live) follows
//   Publish's rules: an archived site never, a paused one only through platform staff.
// The routes run for real against the in-memory PostgREST (fake_pgrst.mjs).
//   deno run --allow-read --allow-env tests/presence/publish_says_196_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const db = installFakePostgrest({});
const L = await import('../../supabase/functions/presence/lib/site_layout.ts');
const PA = await import('../../supabase/functions/presence/lib/page_access.ts');
const LC = await import('../../supabase/functions/presence/lib/lifecycle.ts');
const PUB = await import('../../supabase/functions/presence/routes/publish.ts');
const PE = await import('../../supabase/functions/presence/routes/preview_env.ts');
const LA = await import('../../supabase/functions/presence/routes/launches.ts');
const { handleChanges } = await import('../../supabase/functions/presence/routes/room.ts');
const { handleTokenSections } = await import('../../supabase/functions/presence/routes/comments.ts');
const { signPreviewToken } = await import('../../supabase/functions/presence/lib/preview_link.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
// a check whose code throws (a helper the code under test doesn't have) fails, and the rest still run
const check = async (n, fn) => { let p = false; try { p = !!(await fn()); } catch (e) { return ok(n, false, String(e).slice(0, 80)); } ok(n, p); };
const SITE = '11111111-1111-4111-8111-111111111111', SNAP = '22222222-2222-4222-8222-222222222222';
const LOCK = '33333333-3333-4333-8333-333333333333', OTHER = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const fixture = JSON.parse(Deno.readTextFileSync(new URL('../../supabase/functions/presence/templates/business-classic/1.0.0/fixture.json', import.meta.url)));
const body = async (r) => { try { return await r.json(); } catch { return null; } };
const site = (over = {}) => ({ id: SITE, status: 'live', edition: 'presence', template_slug: 'business-classic', template_version: '1.0.0', netlify_site_id: null, custom_domain: null, last_published_at: null, ...over });
const CLIENT = { kind: 'client', userId: 'u-1', email: 'owner@example.com' };
const STAFF = { kind: 'staff', userId: 'u-2', email: 'staff@example.com' };

// ═══ finding 33: menu folders travel with the pages in them ═══
{
  const nav = [{ label: 'Home', href: '/' },
    { label: 'Services', href: '', folder: true, children: [{ label: 'Repairs', href: '/repairs/' }, { label: 'Book online', href: 'https://book.example' }] },
    { label: 'Elsewhere', href: '', folder: true, children: [{ label: 'Instagram', href: 'https://instagram.com/x' }] }];
  const m = L.menuForCopy(nav);
  ok('menu: a folder travels with its own pages in it', JSON.stringify(m[1]) === JSON.stringify({ label: 'Services', href: '', folder: true, children: [{ label: 'Repairs', href: '/repairs/' }] }));
  ok('menu: a folder left with nothing of this site\'s stays behind, and a link elsewhere never travels', m.length === 2 && !JSON.stringify(m).includes('Elsewhere') && !JSON.stringify(m).includes('book.example'));
}

// ═══ finding 32: the copied-words item names where the first copied section is, in words a client can act on ═══
{
  const content = { settings: { blocks: [{ type: 'divider' }, { type: 'richtext', title: 'About', body: 'We cook.' }], pages: [{ slug: 'team', title: 'Team', blocks: [{ type: 'richtext', title: 'Our team', body: 'Pat.' }] }] } };
  const prints = L.printSections(content);
  ok('print: each section says its page and place in it (a divider is skipped, but still counted)', JSON.stringify(prints.map((p) => [p.slug, p.index])) === JSON.stringify([['', 1], ['team', 0]]));
  const b = L.copiedBlocker({ sections: prints, photos: 0 });
  ok('blocker: it points at the first copied section', JSON.stringify(b.at) === JSON.stringify({ page: '', index: 1 }));
  ok('blocker: it never sends anyone to Sites (only the studio has it)', !/Sites|Keep/.test(b.message) && /Change them for this business before publishing\.$/.test(b.message));
  ok('blocker: photos alone have nothing to point at', L.copiedBlocker({ sections: [], photos: 2 }).at === undefined);
}

// ═══ finding 30: a password page with no password on this site ═══
{
  const content = { settings: { pages: [
    { slug: 'staff', title: 'Staff only', access: 'password', lock: LOCK },
    { slug: 'vip', title: 'VIP', access: 'password', lock: OTHER },
    { slug: 'loose', title: 'Loose', access: 'password' },
    { slug: 'open', title: 'Open' }, { slug: 'hidden', title: 'Hidden', access: 'private' }] } };
  const b = () => PA.pageLockBlockers(content, new Set([LOCK]));
  await check('password: one held here is fine; one from another site, or none, is one thing to finish each', () => JSON.stringify(b().map((x) => x.field)) === JSON.stringify(['page_lock.vip', 'page_lock.loose']));
  await check('password: the words name the page and both ways out', () => b()[0].message === '“VIP” asks for a password, but none is set on this site yet. Set one in its page settings, or choose who can see it.');
  await check('password: nothing for a site without password pages', () => PA.pageLockBlockers({ settings: { pages: [{ slug: 'a' }] } }, new Set()).length === 0 && PA.pageLockBlockers(null, new Set()).length === 0);
}

// ═══ finding 35: one rule for going live ═══
{
  await check('rule: archived or closing never; paused only through platform staff; otherwise yes', () =>
    LC.publishRefusal('archived', 'staff')?.error === 'lifecycle_blocked' && LC.publishRefusal('deleting', 'client')?.error === 'lifecycle_blocked'
    && LC.publishRefusal('paused', 'client')?.error === 'site_paused' && LC.publishRefusal('paused', 'staff') === null && LC.publishRefusal('live', 'client') === null);
  db.reset({ presence_sites: [site({ status: 'paused', offline_at: '2026-11-10T00:00:00Z' })], presence_sites_extra: [] });
  db.tables.presence_sites[0].offline_at = '2026-11-10T00:00:00Z';
  const paused = site({ status: 'paused' }), archived = site({ status: 'archived' });
  const r1 = await PUB.handleBackOnline(paused, CLIENT, {});
  const b1 = await body(r1);
  ok('Bring back online on a site the studio paused: refused, with Publish\'s words, and nothing deployed', r1.status === 409 && b1?.error === 'site_paused' && b1?.message === 'Your site is currently paused. Contact your studio to resume publishing.');
  const r2 = await PUB.handleBackOnline(archived, STAFF, {});
  ok('Bring back online on an archived site: refused even for staff', r2.status === 409 && (await body(r2))?.error === 'lifecycle_blocked');
  const restore = await PUB.handleRestore(new Request('http://x/restore', { method: 'POST', body: JSON.stringify({ publish_id: SNAP }) }), paused, CLIENT, {});
  ok('a version restored to live on a paused site: refused the same way', restore.status === 409 && (await body(restore))?.error === 'site_paused');
  const promote = await PE.handlePreviewPromote(paused, CLIENT, {});
  ok('the preview promoted on a paused site: refused the same way', promote.status === 409 && (await body(promote))?.error === 'site_paused');
  const launch = await LA.handleLaunchPromote(paused, CLIENT, SNAP, {}), back = await LA.handleLaunchRollback(paused, CLIENT, SNAP, {});
  ok('a launch, and its roll back, on a paused site: refused the same way', launch.status === 409 && back.status === 409 && (await body(launch))?.error === 'site_paused');
  ok('none of them wrote anything', db.log.filter((c) => c.method !== 'GET').length === 0);
}

// ═══ finding 34: the shared draft link leaves out password and private pages ═══
const content = structuredClone(fixture.content);
content.settings = { ...content.settings,
  pages: [
    { slug: 'gallery', title: 'Gallery', blocks: [{ type: 'richtext', title: 'Our work', body: 'Pictures of jobs.' }] },
    { slug: 'staff', title: 'Staff only', access: 'password', lock: LOCK, blocks: [{ type: 'richtext', title: 'Rota', body: 'The secret rota.' }] },
    { slug: 'plans', title: 'Plans', access: 'private', blocks: [{ type: 'richtext', title: 'Next year', body: 'The private plans.' }] }],
  nav: [{ label: 'Home', href: '/' }, { label: 'Gallery', href: '/gallery/' }, { label: 'Staff only', href: '/staff/' }, { label: 'Plans', href: '/plans/' }] };
const seed = () => db.reset({
  presence_sites: [site()],
  presence_snapshots: [{ id: SNAP, site_id: SITE, content, media_manifest: [], content_contract_version: fixture.content_contract_version, template_slug: 'business-classic', template_version: '1.0.0', created_at: '2026-11-12T00:00:00Z', dev_customization: null }],
  presence_site_preview: [{ site_id: SITE, token: TOKEN, snapshot_id: SNAP, password_hash: null }],
});
const open = async (page) => {
  const r = await PE.handlePublicPreviewOpen(new Request('http://x/p/' + TOKEN, { method: 'POST', body: JSON.stringify({ page }) }), TOKEN, {});
  return { status: r.status, html: String((await body(r))?.data?.html || '') };
};
{
  seed();
  const home = await open('/');
  ok('shared link: Home draws', home.status === 200 && home.html.includes('</html>'));
  ok('shared link: its menu keeps the open page and drops the password and private ones', home.html.includes('Gallery') && !home.html.includes('Staff only') && !home.html.includes('Plans'));
  const gallery = await open('/gallery/');
  ok('shared link: an open page of the owner\'s own still opens', gallery.status === 200 && gallery.html.includes('Pictures of jobs.'));
  const staff = await open('/staff/'), plans = await open('/plans/');
  ok('shared link: a password page isn\'t there to open', staff.status === 404 && !staff.html.includes('The secret rota.'));
  ok('shared link: nor is a private one', plans.status === 404 && !plans.html.includes('The private plans.'));
}
{
  // the signed link's feedback panel lists no sections for those pages either
  seed();
  Deno.env.set('PREVIEW_LINK_SECRET', 'secret-196');
  const tok = await signPreviewToken({ site_id: SITE, exp: Math.floor(Date.now() / 1000) + 600, scope: 'preview' }, 'secret-196');
  const list = async (page) => (await body(await handleTokenSections(new Request(`http://x/p/s/${tok}/sections?page=${encodeURIComponent(page)}`), tok, {})))?.data?.sections || [];
  ok('feedback panel: an open page lists its sections', (await list('/gallery/')).length === 1);
  ok('feedback panel: a password or private page lists none', (await list('/staff/')).length === 0 && (await list('/plans/')).length === 0);
}

// ═══ finding 30, wired: the publish list and Publish itself ═══
{
  seed();
  db.tables.presence_snapshots = [];
  db.tables.presence_settings = [{ site_id: SITE, pages: content.settings.pages, nav: content.settings.nav }];
  db.tables.presence_identity = [{ site_id: SITE, ...content.identity }];
  db.tables.presence_page_locks = [{ id: OTHER, site_id: SITE }];   // a password of this site's, but not the one "Staff only" names
  const ch = await body(await handleChanges(site(), {}));
  const items = (ch?.data?.blocker_list || []).filter((b) => String(b.field).startsWith('page_lock.'));
  ok('publish list: the copied password page is one thing to finish', items.length === 1 && items[0].field === 'page_lock.staff');
  const pub = await PUB.handlePublish(null, site(), STAFF, {});
  const pb = await body(pub);
  ok('Publish: refused before anything is sent, saying the same', pub.status === 422 && (pb?.fields || []).some((f) => f.field === 'page_lock.staff'));
  db.tables.presence_page_locks.push({ id: LOCK, site_id: SITE });
  const ch2 = await body(await handleChanges(site(), {}));
  ok('publish list: once it has a password here, nothing is held back for it', !(ch2?.data?.blocker_list || []).some((b) => String(b.field).startsWith('page_lock.')));
  db.fail.add('presence_page_locks');
  const ch3 = await body(await handleChanges(site(), {}));
  ok('publish list: a password read that fails says nothing, rather than ask for one that may be set', !(ch3?.data?.blocker_list || []).some((b) => String(b.field).startsWith('page_lock.')));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
