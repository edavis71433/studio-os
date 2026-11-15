// ── A restore brings back sections, pages and the menu (builder list item 187, Nov 2026) ──
// Restoring a version or a checkpoint rewrote the business details, the lists and the
// colours, never the website's own settings, so a deleted section or page never came back
// that way. Now each snapshot keeps those settings as stored (presence_snapshots
// .draft_settings, migration 0169) and a restore writes them back; a snapshot from before
// rebuilds them from its content. Real handlers against the shared in-memory PostgREST:
//   · a checkpoint brings back a deleted Home section, a deleted page, the menu, the header
//     and footer choices, exactly as stored (a link to a saved section stays a link, a
//     half-filled section stays), and leaves account settings alone
//   · a photo that has left the library is taken out and counted once
//   · the restored page is the page Recently deleted pages keeps and puts back (item 154)
//   · a version kept before 0169 (and a database without the column) still brings them back
//   · accepting a writing proposal doesn't touch them
//   · every photo-carrying section survives the trip from the render back to storage
//   · the client's restore keeps the sections their studio locked (item 155): an unchanged one
//     keeps its lock, one it would remove or change refuses it with nothing written
//   deno run --allow-read --allow-env --allow-net tests/presence/restore_sections_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const hex = (k, i) => `${k}${i.toString(16).padStart(7, '0')}-0000-4000-8000-000000000000`;
const SITE = uuid('a'), U = uuid('3'), LIB = hex(6, 1), LOCK = hex(8, 1), PUB = hex(9, 1), BIN = hex(9, 2);
const MEDIA = [0, 1, 2, 3].map((i) => hex(1, i));
const db = installFakePostgrest();

// a database before migration 0169 answers the way PostgREST does for a column it hasn't got
let before0169 = false;
const pg = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (before0169 && u.pathname.endsWith('/presence_snapshots')) {
    const asks = decodeURIComponent(u.search).includes('draft_settings'), sends = String(init.body || '').includes('"draft_settings"');
    if (sends) return new Response(JSON.stringify({ code: 'PGRST204', message: 'Could not find the \'draft_settings\' column of \'presence_snapshots\' in the schema cache' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (asks) return new Response(JSON.stringify({ code: '42703', message: 'column presence_snapshots.draft_settings does not exist' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  return pg(url, init);
};
const P = await import('../../supabase/functions/presence/routes/publish.ts');
const R = await import('../../supabase/functions/presence/routes/room.ts');
const D = await import('../../supabase/functions/presence/routes/deleted_pages.ts');
const { applySnapshotToDraft, mediaResolver } = await import('../../supabase/functions/presence/lib/draft_writer.ts');
const { draftSettingsOf, withoutMedia } = await import('../../supabase/functions/presence/lib/draft_settings.ts');
const { buildSnapshot } = await import('../../supabase/functions/presence/lib/serializer.ts');
const { getTemplate } = await import('../../supabase/functions/presence/lib/render.ts');
const { validateBlocks, unresolveBlockMedia } = await import('../../supabase/functions/presence/lib/site_blocks.ts');
const { SETTINGS_CONTENT_FIELDS } = await import('../../supabase/functions/presence/lib/site_roles.ts');
const { svc } = await import('../../supabase/functions/presence/lib/db.ts');
const { restoreUnderLocks, lockedRestoreMessage } = await import('../../supabase/functions/presence/lib/section_lock.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
// key order isn't meaning (jsonb doesn't keep it); undefined fields aren't stored
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const same = (a, b) => canon(a) === canon(b);
const cors = {};
const site = { id: SITE, client_id: 'client-a', status: 'draft', last_published_at: null, template_slug: 'restaurant-classic', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't' };
const req = (path, body) => new Request(`https://fn.test/functions/v1/presence${path}`, { method: 'POST', body: JSON.stringify(body ?? {}), headers: { 'Content-Type': 'application/json' } });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

/* ── a draft that uses every part a restore brings back ── */
const HOME = [
  { type: 'richtext', title: 'Welcome', body: 'We cook every day.' },
  { type: 'gallery', title: 'The room', image_ids: [MEDIA[0], MEDIA[1]], captions: ['Front', 'Back'] },
  { type: 'linked', ref: LIB },                                  // a saved section, placed as a link
  { type: 'features', title: 'Still writing this', items: [] },   // not filled in yet: off the live site, kept in the draft
];
const PAGES = [
  { slug: 'our-team', title: 'Our team', blocks: [{ type: 'team', title: 'Who we are', members: [{ name: 'Sam', role: 'Chef', media_id: MEDIA[2] }] }], noFooter: true },
  { slug: 'offers', title: 'Offers', blocks: [{ type: 'cta', text: 'Ten percent off on Tuesdays', button: 'Book', url: 'https://example.com/book' }], access: 'password', lock: LOCK, hideNav: true },
];
const NAV = [{ label: 'Home', href: '/' }, { label: 'More', href: '', folder: true, children: [{ label: 'Our team', href: '/our-team/' }, { label: 'Offers', href: '/offers/' }] }];
const WEBSITE = {
  category_order: ['Mains'], blocks: HOME, pages: PAGES, nav: NAV, nav_style: 'centered', hero_layout: 'split',
  sections_hidden: ['testimonials'], sections_order: ['hero', 'offerings', 'faq'], footer_hours: false, footer_social: true,
  logo_media_id: MEDIA[3], og_media_id: null, cover_media_id: MEDIA[0], icon_media_id: MEDIA[3],   // builder list item 158: the logo as the tab icon too
  announcement_text: 'Open late on Fridays', announcement_url: '', announcement_expires_at: null,
  page_seo: { 'page:our-team': { title: 'Meet the team', share_image: MEDIA[1] } }, pages_noindex: ['page:offers'],
  post_categories: [{ id: 'news', name: 'News' }], post_authors: [{ id: 'sam', name: 'Sam', bio: 'Chef' }],   // builder list item 40: the blog's lists
  popup: { on: true, heading: 'Ten percent off on Tuesdays', text: 'Join our list for the code.', action: 'signup', buttons: [], after: 'seconds', seconds: 8, scroll: 50, pages: 'all', picked: [], again: 'week', phones: true, from: '', until: '' },   // builder list item 148
};
// account settings in the same row: a restore never touches them
const ACCOUNT = { google_site_verification: 'code-from-google', auto_ack_enquiries: true, industry_key: 'restaurant' };
const world = () => db.reset({
  presence_sites: [{ ...site }],
  presence_identity: [{ site_id: SITE, business_name: 'Sample Cafe', tagline: 'Good food', description: 'A neighbourhood cafe.', phone: '', email: '', story: '', service_area: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '' }],
  presence_locations: [], presence_offerings: [], presence_testimonials: [], presence_faqs: [], presence_posts: [], presence_redirects: [], presence_reviews: [], presence_dev_customizations: [],
  presence_media: MEDIA.map((id, i) => ({ id, site_id: SITE, storage_path: `${SITE}/photo-${i}.jpg`, alt_text: `Photo ${i}`, mime: 'image/jpeg', width: 1600, height: 1000, focal_x: null, focal_y: null, deleted_at: null })),
  presence_settings: [{ site_id: SITE, ...structuredClone(WEBSITE), ...ACCOUNT }],
  presence_content_library: [{ id: LIB, site_id: SITE, name: 'Opening hours', payload: { type: 'richtext', title: 'Hours', body: 'Open every day.' } }],
  presence_snapshots: [], presence_launches: [], presence_publishes: [], presence_change_events: [], presence_deleted_pages: [],
});
const settings = () => db.tables.presence_settings[0];
// what the editor's saves do between the checkpoint and the restore (PUT /settings)
const editSince = () => {
  const s = settings();
  s.blocks = HOME.filter((b) => b.type !== 'gallery');                                    // a section deleted
  s.pages = [PAGES[0], { slug: 'new-page', title: 'New page', blocks: [{ type: 'richtext', body: 'Draft words.' }] }];   // a page deleted, one added
  s.nav = [{ label: 'Home', href: '/' }];
  s.nav_style = ''; s.hero_layout = ''; s.footer_hours = true; s.sections_hidden = [];
  s.announcement_text = ''; s.logo_media_id = null; s.cover_media_id = null; s.page_seo = {}; s.pages_noindex = []; s.popup = null; s.icon_media_id = null;
  s.post_categories = []; s.post_authors = [{ id: 'new', name: 'Someone new' }];   // the blog's lists changed too
  s.google_site_verification = 'changed since';                                          // account settings move on their own
};
const saveCheckpoint = async (name) => {
  const r = await res(await P.handleCheckpointSave(req('/publishes/checkpoints', { name }), site, owner, cors));
  return { ...r, snap: db.tables.presence_snapshots.at(-1) };
};
const websiteNow = () => Object.fromEntries(SETTINGS_CONTENT_FIELDS ? [...SETTINGS_CONTENT_FIELDS].map((f) => [f, settings()[f]]) : []);

// ═══ 1. a checkpoint keeps the website's settings as stored, and only those ═══
{
  world();
  const cp = await saveCheckpoint('Before the spring menu');
  ok('checkpoint: saved', cp.status === 201 && !!cp.body?.data?.id, JSON.stringify(cp.body));
  ok('checkpoint: its snapshot keeps the sections, pages and menu exactly as stored', same(cp.snap?.draft_settings, WEBSITE), canon(cp.snap?.draft_settings).slice(0, 300));
  ok('checkpoint: account settings aren’t kept with it', !('google_site_verification' in (cp.snap?.draft_settings || {})) && !('auto_ack_enquiries' in (cp.snap?.draft_settings || {})));
  ok('the kept fields are the ones “edit” covers (lib/site_roles.ts), every one of them', same(Object.keys(cp.snap?.draft_settings || {}).sort(), [...SETTINGS_CONTENT_FIELDS].sort()));
}

// ═══ 2. returning to it brings a deleted section, a deleted page and the menu back as they were ═══
{
  world();
  const cp = await saveCheckpoint('Before removing “The room”');
  editSince();
  const back = await res(await P.handleCheckpointRestore(req(`/publishes/checkpoints/${cp.body.data.id}/restore`), site, owner, cp.body.data.id, cors));
  ok('restore: 200 and the usual sentence, nothing left off', back.status === 200 && /is now in your draft/.test(back.body?.data?.message) && !/left off/.test(back.body?.data?.message), JSON.stringify(back.body));
  const s = settings();
  ok('the deleted Home section is back, in its place', same(s.blocks, HOME), canon(s.blocks).slice(0, 300));
  ok('the saved section is still a link, not a copy', s.blocks[2]?.type === 'linked' && s.blocks[2]?.ref === LIB);
  ok('the half-filled section the live site never showed is back too', s.blocks[3]?.type === 'features' && s.blocks[3]?.title === 'Still writing this');
  ok('the deleted page is back with its sections, password and header choices; the page made since is gone', same(s.pages, PAGES), canon(s.pages).slice(0, 300));
  ok('the menu is back, folder and all', same(s.nav, NAV));
  ok('the header and footer choices are back', s.nav_style === 'centered' && s.hero_layout === 'split' && s.footer_hours === false && s.footer_social === true);
  ok('the logo, cover, announcement, page search settings and Home’s section order are back',
    s.logo_media_id === MEDIA[3] && s.cover_media_id === MEDIA[0] && s.announcement_text === 'Open late on Fridays'
    && same(s.page_seo, WEBSITE.page_seo) && same(s.pages_noindex, ['page:offers']) && same(s.sections_hidden, ['testimonials']));
  ok('every website field is as the checkpoint had it', same(websiteNow(), WEBSITE));
  ok('account settings stay as they are now', s.google_site_verification === 'changed since' && s.auto_ack_enquiries === true && s.industry_key === 'restaurant');
  const safety = db.tables.presence_snapshots.at(-1);
  ok('the draft it replaced is kept as the safety copy, with its sections and pages as stored', db.tables.presence_snapshots.length === 2
    && safety?.draft_settings?.pages?.some((p) => p.slug === 'new-page') && !safety?.draft_settings?.blocks?.some((b) => b.type === 'gallery'));
  ok('one restore event, in plain words', (db.tables.presence_change_events || []).some((e) => e.entity_type === 'restore' && /Returned to checkpoint/.test(e.summary)));
}

// ═══ 3. a photo that has left the library is taken out, and counted once ═══
{
  world();
  const cp = await saveCheckpoint('Before the photos');
  editSince();
  db.tables.presence_media.find((m) => m.id === MEDIA[1]).deleted_at = '2026-11-10T00:00:00Z';   // used by the gallery AND the team page's share image
  const back = await res(await P.handleCheckpointRestore(req(`/publishes/checkpoints/${cp.body.data.id}/restore`), site, owner, cp.body.data.id, cors));
  const s = settings();
  const gallery = s.blocks.find((b) => b.type === 'gallery');
  ok('gone photo: the gallery comes back without it, and its caption goes with it', same(gallery?.image_ids, [MEDIA[0]]) && same(gallery?.captions, ['Front']), canon(gallery));
  ok('gone photo: the page keeps its search title, not the share image', same(s.page_seo, { 'page:our-team': { title: 'Meet the team' } }), canon(s.page_seo));
  ok('gone photo: counted once though it was used twice', back.body?.data?.applied?.dropped_media === 1, JSON.stringify(back.body?.data?.applied));
  ok('gone photo: the checkpoint’s sentence says so', /1 photo from that checkpoint is no longer in your library and was left off\./.test(back.body?.data?.message || ''), back.body?.data?.message);
  ok('gone photo: everything else comes back', same(s.pages, PAGES) && same(s.nav, NAV) && s.logo_media_id === MEDIA[3]);

  // the walk alone: lists lose the id (captions aligned), fields lose the key, other ids stay
  const took = new Set();
  const out = withoutMedia({ image_ids: [MEDIA[0], MEDIA[1].toUpperCase(), MEDIA[2]], captions: ['a', 'b', 'c'], cell: { image_id: MEDIA[1], body: 'x' }, ref: LIB }, new Set([MEDIA[1]]), took);
  ok('withoutMedia: out of the list with its caption, off the field, any case', same(out, { image_ids: [MEDIA[0], MEDIA[2]], captions: ['a', 'c'], cell: { body: 'x' }, ref: LIB }) && same([...took], [MEDIA[1]]), canon(out));
}

// ═══ 4. the page that comes back is the page Recently deleted pages keeps (item 154) ═══
{
  // the trigger on presence_settings (0154) keeps a page that leaves the draft as stored, and
  // drops it off the list when the same page comes back with the same sections
  world();
  const cp = await saveCheckpoint('Before deleting “Offers”');
  editSince();
  const kept = { id: BIN, site_id: SITE, slug: 'offers', title: 'Offers', page: structuredClone(PAGES[1]), deleted_at: new Date().toISOString() };
  db.tables.presence_deleted_pages.push(kept);
  await P.handleCheckpointRestore(req(`/publishes/checkpoints/${cp.body.data.id}/restore`), site, owner, cp.body.data.id, cors);
  const restored = settings().pages.find((p) => p.slug === 'offers');
  ok('bin: the restored page is exactly the page the list keeps', same(restored, kept.page));
  ok('bin: so the trigger takes it off the list (same address, same sections)', restored?.slug === kept.slug && same(restored?.blocks, kept.page.blocks));

  // Put back, on its own, adds the same page
  world();
  settings().pages = [PAGES[0]];
  db.tables.presence_deleted_pages.push(structuredClone(kept));
  const put = await res(await D.handleDeletedPageRestore(req(`/pages/deleted/${BIN}/restore`), svc, site, owner, BIN, cors));
  ok('bin: Put back adds the same page a restore brings back', put.status === 200 && same(settings().pages.find((p) => p.slug === 'offers'), restored), JSON.stringify(put.body).slice(0, 200));
}

// ═══ 5. a version kept before 0169, on a database without the column ═══
{
  world(); before0169 = true;
  const cp = await saveCheckpoint('Kept before the update');
  ok('before 0169: a checkpoint still saves, without the column', cp.status === 201 && cp.snap && !('draft_settings' in cp.snap), JSON.stringify(cp.body));
  db.tables.presence_publishes.push({ id: PUB, site_id: SITE, snapshot_id: cp.snap.id, status: 'live', kind: 'publish', created_at: '2026-11-01T00:00:00Z' });
  editSince();
  const back = await res(await R.handleRestoreToDraft(req('/restore-to-draft', { publish_id: PUB }), site, owner, cors));
  ok('before 0169: the version restores', back.status === 200 && /is now in your draft/.test(back.body?.data?.message), JSON.stringify(back.body));
  const s = settings();
  // rebuilt from what the version showed: the link is a copy now, the half-filled section isn't there
  ok('rebuilt: Home’s sections as that version showed them, the deleted gallery back with its photos and captions', same(s.blocks, [
    { type: 'richtext', title: 'Welcome', body: 'We cook every day.' },
    { type: 'gallery', title: 'The room', image_ids: [MEDIA[0], MEDIA[1]], captions: ['Front', 'Back'] },
    { type: 'richtext', title: 'Hours', body: 'Open every day.' },
  ]), canon(s.blocks));
  ok('rebuilt: the deleted page back, with its password and header choices; the new one gone', same(s.pages, PAGES), canon(s.pages));
  ok('rebuilt: the menu back', same(s.nav, NAV), canon(s.nav));
  ok('rebuilt: logo, cover, share image and site icon back as media ids, not file paths', s.logo_media_id === MEDIA[3] && s.cover_media_id === MEDIA[0] && s.icon_media_id === MEDIA[3] && same(s.page_seo, WEBSITE.page_seo), canon(s.page_seo));
  ok('rebuilt: header, footer, announcement, section order and search settings back',
    s.nav_style === 'centered' && s.hero_layout === 'split' && s.footer_hours === false && s.announcement_text === 'Open late on Fridays'
    && same(s.sections_hidden, ['testimonials']) && same(s.sections_order, WEBSITE.sections_order) && same(s.pages_noindex, ['page:offers']) && same(s.category_order, ['Mains']));
  ok('rebuilt: account settings stay as they are now', s.google_site_verification === 'changed since' && s.auto_ack_enquiries === true);
  before0169 = false;

  // the same old version on a database that has the column: still rebuilt (its row has none)
  world();
  const cp2 = await saveCheckpoint('Kept with the column');
  delete db.tables.presence_snapshots.at(-1).draft_settings;   // as every snapshot from before 0169 is
  editSince();
  await P.handleCheckpointRestore(req(`/publishes/checkpoints/${cp2.body.data.id}/restore`), site, owner, cp2.body.data.id, cors);
  ok('an old checkpoint on the new database: the deleted section and page come back', settings().blocks.some((b) => b.type === 'gallery') && same(settings().pages, PAGES) && same(settings().nav, NAV));
}

// ═══ 6. accepting a writing proposal leaves the sections, pages and menu alone ═══
{
  world();
  const r = await applySnapshotToDraft(site, {
    content: { identity: { business_name: 'Sample Cafe', tagline: 'A proposed tagline' }, locations: [], settings: { category_order: ['Mains'] }, offerings: [], testimonials: [], faqs: [], posts: [], redirects: [] },
    media_manifest: [], content_contract_version: 1, template_slug: site.template_slug, template_version: site.template_version,
  }, owner, 'Accepted a drafted proposal: business copy', null);
  ok('proposal: applied', r.ok === true, JSON.stringify(r));
  ok('proposal: sections, pages, menu and header untouched', same(websiteNow(), WEBSITE), canon(websiteNow()).slice(0, 200));
}

// ═══ 7. every photo-carrying section survives the trip from the render back to storage ═══
{
  const t = getTemplate(site.template_slug, site.template_version);
  const PDF = hex(1, 9);
  const media = [...MEDIA.map((id, i) => ({ id, storage_path: `${SITE}/photo-${i}.jpg`, alt_text: `Photo ${i}`, mime: 'image/jpeg', width: 1600, height: 1000 })),
    { id: PDF, storage_path: `${SITE}/menu.pdf`, alt_text: 'Our menu', mime: 'application/pdf', width: null, height: null }];
  const stored = [
    { type: 'team', title: 'Team', members: [{ name: 'Sam', role: 'Chef', media_id: MEDIA[0] }, { name: 'Ana', bio: 'Pastry' }], look: { width: 'wide' } },
    { type: 'gallery', title: 'Room', image_ids: [MEDIA[0], MEDIA[1]], captions: ['', 'Back'], zoom: true, show_from: '2026-01-01' },
    { type: 'before_after', title: 'Fixes', items: [{ before_id: MEDIA[0], after_id: MEDIA[1], caption: 'Kitchen' }] },
    { type: 'video', title: 'Tour', url: 'https://example.com/tour', caption: 'A look round', poster_id: MEDIA[2] },
    { type: 'partners', title: 'Trusted by', image_ids: [MEDIA[2], MEDIA[3]] },
    { type: 'map', title: 'Find us', address: '1 Main St', image_media_id: MEDIA[3], directions_url: 'https://example.com/map' },
    { type: 'image', title: 'Plate', image_id: MEDIA[1], caption: 'Lunch', alt: 'A plate of food', link: '/menu/', decorative: true },
    { type: 'image_text', title: 'Story', image_id: MEDIA[2], body: 'Since 2010.', side: 'right', button: { label: 'More', url: '/about/' } },
    { type: 'columns', id: 'cols', title: 'Three things', columns: [{ body: 'One', image_id: MEDIA[0], span: 4 }, { body: 'Two', button: { label: 'Go', url: '/go/' } }, { body: '', block: { type: 'image', image_id: MEDIA[3], caption: 'Nested' } }] },
    { type: 'tabs', title: 'Menus', tabs: [{ label: 'Lunch', body: 'Soup', image_id: MEDIA[1] }, { label: 'Dinner', body: 'Steak' }] },
    { type: 'carousel', title: 'Slides', slides: [{ image_id: MEDIA[0], caption: 'First' }, { image_id: MEDIA[1] }] },
    { type: 'cards', id: 'cards', title: 'Cards', cards: [{ heading: 'A', text: 'Alpha', image_id: MEDIA[2], link: '/a/' }, { heading: 'B' }] },
    { type: 'download', title: 'Menu', file_id: PDF, label: 'Download the menu' },
    { type: 'freeform', id: 'canvas', title: 'Canvas', aspect: 'banner', elements: [
      { id: 'e1', kind: 'image', x: 0, y: 0, w: 40, h: 50, z: 1, image: { image_id: MEDIA[0], alt: 'Our front door' } },
      { id: 'e2', kind: 'image', x: 50, y: 0, w: 40, h: 50, z: 2, image: { image_id: MEDIA[1], decorative: true } },
      { id: 'e3', kind: 'text', x: 0, y: 60, w: 50, h: 20, z: 3, text: { body: 'Hello', size: 'l' } },
      { id: 'e4', kind: 'button', x: 60, y: 60, w: 30, h: 10, z: 4, hide_on_phone: true, button: { label: 'Book', url: '/book/', style: 'primary' } },
    ] },
    { type: 'richtext', title: 'Words', body: 'No photos here.' },
  ];
  const rows = { presence_identity: [{ business_name: 'Sample Cafe' }], presence_locations: [], presence_offerings: [], presence_testimonials: [], presence_faqs: [], presence_posts: [],
    presence_media: media, presence_redirects: [], presence_settings: [{ blocks: stored }], presence_dev_customizations: [], presence_reviews: [], presence_content_library: [] };
  const { snapshot, mediaManifest } = buildSnapshot(rows, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now: '2026-11-11T00:00:00Z' });
  const valid = validateBlocks(stored);
  ok('round trip: every fixture section is valid and rendered', valid.length === stored.length && snapshot.content.settings.blocks.length === stored.length, `${valid.length} ${snapshot.content.settings.blocks.length}`);
  const altById = new Map(media.map((m) => [m.id, m.alt_text]));
  const gone = new Set();
  const back = unresolveBlockMedia(snapshot.content.settings.blocks, mediaResolver(mediaManifest, media, gone), (id) => altById.get(id));
  ok('round trip: every section comes back exactly as stored, photos as ids', same(back, valid), back.map((b, i) => (same(b, valid[i]) ? '' : `${b.type}: ${canon(b)} ≠ ${canon(valid[i])}`)).filter(Boolean).join(' | '));
  ok('round trip: nothing counted as gone', gone.size === 0);

  const lost = new Set();
  const less = unresolveBlockMedia(snapshot.content.settings.blocks, mediaResolver(mediaManifest, media.filter((m) => m.id !== MEDIA[1]), lost), (id) => altById.get(id));
  const by = (type) => less.find((b) => b.type === type);
  ok('a gone photo: the gallery loses it and its caption; the pair, slide and canvas photo that were it go',
    same(by('gallery').image_ids, [MEDIA[0]]) && !('captions' in by('gallery')) && by('before_after').items.length === 0
    && same(by('carousel').slides, [{ image_id: MEDIA[0], caption: 'First' }]) && !by('freeform').elements.some((e) => e.id === 'e2'), canon(less));
  ok('a gone photo: sections that only showed it keep their words', !('image_id' in by('image')) && by('image').caption === 'Lunch' && !('image_id' in by('tabs').tabs[0]) && by('tabs').tabs[0].body === 'Soup');
  ok('a gone photo: counted once, by its file', lost.size === 1 && [...lost][0] === `${SITE}/photo-1.jpg`, JSON.stringify([...lost]));

  // a reviews wall goes back to how many it shows; the reviews were never stored on it
  const wall = unresolveBlockMedia([{ type: 'reviews_wall', title: 'Kind words', reviews: [{ author: 'A', rating: 5, body: 'Great' }], aggregate: { count: 1, average: 5 } }], () => null);
  ok('reviews wall: back to its title and how many to show', same(wall, [{ type: 'reviews_wall', title: 'Kind words', max: 12 }]), canon(wall));

  // the guard: a photo-carrying type added to resolveBlockMedia needs its way back here too
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/lib/site_blocks.ts', import.meta.url));
  const cases = (from, to) => new Set([...src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from) + from.length)).matchAll(/case '([a-z_]+)'/g)].map((m) => m[1]));
  const forward = cases('export function resolveBlockMedia(', 'export function resolveBlockMediaTracked(');
  const backward = cases('export function unresolveBlockMedia(', '\n}\n');
  const missing = [...forward].filter((c) => !backward.has(c));
  ok('every section resolveBlockMedia rebuilds has its way back', forward.size >= 15 && missing.length === 0, `missing: ${missing.join(', ')}`);
}

// ═══ 8. the defaults: a draft with no settings row keeps the column defaults ═══
{
  const d = draftSettingsOf(null);
  ok('no settings row: every website field at its column default', same(d, { category_order: [], cover_media_id: null, logo_media_id: null, og_media_id: null, announcement_text: '', announcement_url: '', announcement_expires_at: null, hero_layout: '', nav_style: '', sections_hidden: [], sections_order: [], footer_hours: true, footer_social: true, pages_noindex: [], page_seo: {}, blocks: [], pages: [], nav: [], popup: null, icon_media_id: null }), canon(d));
}

// ═══ 9. the client's restore keeps the sections their studio locked (item 155) ═══
{
  const L = (words) => ({ id: 'lock-welcome', words });
  const studio = { ...owner, scope: { site_id: SITE, name: 'Sample Cafe' } };   // the studio, scoped into this client
  const staff = { kind: 'staff', userId: uuid('5'), email: 'ops@example.com', jwt: 'jwt-staff', requestId: 't' };
  const restoreAs = async (who, cp) => res(await P.handleCheckpointRestore(req(`/publishes/checkpoints/${cp.body.data.id}/restore`), site, who, cp.body.data.id, cors));
  const written = () => canon({ settings: settings(), snapshots: db.tables.presence_snapshots.length, events: db.tables.presence_change_events.length, identity: db.tables.presence_identity });

  // locked after the checkpoint, as it was then: the restore goes ahead and the lock stays
  world();
  let cp = await saveCheckpoint('Before the lock');
  editSince();
  settings().blocks[0] = { ...HOME[0], lock: L(false) };
  let back = await restoreAs(owner, cp);
  ok('lock: a locked section the version has as it is now doesn’t stop the restore', back.status === 200, JSON.stringify(back.body));
  ok('lock: …it keeps its lock, and the rest comes back', same(settings().blocks[0], { ...HOME[0], lock: L(false) }) && settings().blocks.some((b) => b.type === 'gallery') && same(settings().pages, PAGES), canon(settings().blocks));

  // words open: the version's words come back under the same lock
  world();
  cp = await saveCheckpoint('Before new words');
  settings().blocks[0] = { ...HOME[0], body: 'New words since.', lock: L(true) };
  back = await restoreAs(owner, cp);
  ok('lock: with its words open, the version’s words come back and the lock stays', back.status === 200 && same(settings().blocks[0], { ...HOME[0], lock: L(true) }), canon(settings().blocks[0]));

  // words closed and changed since: refused, and nothing at all is written
  world();
  cp = await saveCheckpoint('Before new words');
  editSince();
  settings().blocks[0] = { ...HOME[0], body: 'New words since.', lock: L(false) };
  let was = written();
  back = await restoreAs(owner, cp);
  ok('lock: a restore that would change a locked section is refused (403) with the sentence',
    back.status === 403 && back.body?.error === 'section_locked' && back.body?.message === 'Your studio locked “Welcome”, and that checkpoint changes it. Ask them to restore it. Nothing was changed.'
    && same(back.body?.sections, [{ name: 'Welcome', what: 'removed' }]), JSON.stringify(back.body));
  ok('lock: …and nothing was written: no safety copy, no event, the draft as it was', written() === was);

  // the studio and platform staff are never stopped; their restore is exact
  back = await restoreAs(studio, cp);
  ok('lock: the studio’s own restore goes ahead, exactly as the version had it', back.status === 200 && same(settings().blocks[0], HOME[0]), JSON.stringify(back.body).slice(0, 200));
  settings().blocks[0] = { ...HOME[0], body: 'New words since.', lock: L(false) };
  back = await restoreAs(staff, cp);
  ok('lock: so does platform staff’s', back.status === 200 && same(settings().blocks[0], HOME[0]));

  // restyled since under the same lock: refused
  world();
  settings().blocks[0] = { ...HOME[0], style: 'dark', lock: L(true) };
  cp = await saveCheckpoint('While dark');
  settings().blocks[0] = { ...HOME[0], style: 'light', lock: L(true) };
  back = await restoreAs(owner, cp);
  ok('lock: a version with the locked section in another style is refused', back.status === 403 && same(back.body?.sections, [{ name: 'Welcome', what: 'changed' }]) && settings().blocks[0].style === 'light', JSON.stringify(back.body));

  // a lock the version brings back is the studio's own: it comes back
  world();
  settings().blocks[0] = { ...HOME[0], lock: L(false) };
  cp = await saveCheckpoint('While locked');
  settings().blocks[0] = { ...HOME[0] };   // the studio unlocked it since
  back = await restoreAs(owner, cp);
  ok('lock: a lock the version had comes back with it', back.status === 200 && same(settings().blocks[0], { ...HOME[0], lock: L(false) }), JSON.stringify(back.body));

  // a locked section on a page the version hasn't got: the version's restore says so in its words
  world();
  cp = await saveCheckpoint('Before the prices page');
  db.tables.presence_publishes.push({ id: PUB, site_id: SITE, snapshot_id: cp.snap.id, status: 'live', kind: 'publish', created_at: '2026-11-01T00:00:00Z' });
  settings().pages = [...settings().pages, { slug: 'prices', title: 'Prices', blocks: [{ type: 'richtext', title: 'Our prices', body: 'From ten dollars.', lock: { id: 'lock-prices', words: true } }] }];
  was = written();
  back = await res(await R.handleRestoreToDraft(req('/restore-to-draft', { publish_id: PUB }), site, owner, cors));
  ok('lock: a version without the page a locked section is on is refused, in the version’s words',
    back.status === 403 && back.body?.message === 'Your studio locked “Our prices”, and that version changes it. Ask them to restore it. Nothing was changed.' && written() === was, JSON.stringify(back.body));

  // the rule itself
  const home = [{ type: 'richtext', title: 'A', body: 'a' }, { type: 'richtext', title: 'B', body: 'b', lock: { id: 'lock-b', words: false } }];
  const restoring = { blocks: [{ type: 'richtext', title: 'B', body: 'b' }, { type: 'richtext', title: 'B', body: 'b' }, { type: 'richtext', title: 'C', body: 'c' }], pages: [] };
  const copy = structuredClone(restoring);
  const k = restoreUnderLocks({ blocks: home, pages: [] }, restoring);
  ok('rule: the lock goes onto the version’s first copy, wherever it sits on the page, and only one',
    k.edits.length === 0 && same(k.blocks[0].lock, { id: 'lock-b', words: false }) && !('lock' in k.blocks[1]) && !('lock' in k.blocks[2]), canon(k));
  ok('rule: what it was given is left as it was', same(restoring, copy));
  ok('rule: a section locked on Home doesn’t take the lock of a copy on a page', restoreUnderLocks({ blocks: home, pages: [] }, { blocks: [], pages: [{ slug: 'p', title: 'P', blocks: [{ type: 'richtext', title: 'B', body: 'b' }] }] }).edits.length === 1);

  // the sentence: under the 160 characters the editor shows as they are (presence.html nice())
  const html = await Deno.readTextFile(new URL('../../presence.html', import.meta.url));
  const nice = new Function(`${html.match(/function nice\(e\) \{[\s\S]*?\n\}/)[0]}; return nice;`)();
  const longest = lockedRestoreMessage([{ name: 'x'.repeat(60), what: 'changed' }], 'that checkpoint');
  ok('sentence: with the longest name it reaches the editor as it is', nice(new Error(longest)) === longest && longest.length < 160, String(longest.length));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
