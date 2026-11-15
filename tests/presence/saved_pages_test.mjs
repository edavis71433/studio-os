// ── Pages saved to the studio, added to any client's site (builder list item 216) ──
// lib/saved_pages.ts decides what a saved page carries and how it lands (pure);
// agency/saved_pages.ts keeps the studio's list (GET, POST, PATCH, DELETE /agency/pages);
// routes/saved_pages.ts lands one on a site (POST /pages/from-saved). This drives the real
// handlers against an in-memory PostgREST, a stand-in for file storage and for the
// sign-in check:
//   · what a saved page carries: its sections, the saved sections they link to, copies
//     of its photos in the studio's own folder; never a business detail;
//   · fenced to the studio both ways: another studio's saved page, a site outside the
//     studio, a member without the studio, a role that can't manage clients;
//   · landing: photos become the site's own copies, the old name becomes the new one,
//     ids made new, the page joins the menu, and the copy is recorded so Publish lists
//     what's untouched;
//   · before migration 0217 nothing breaks: the list is empty and a save says so.
//   deno run --allow-read --allow-env tests/presence/saved_pages_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'service-key');
const P = '../../supabase/functions/presence';
const { handleAgency } = await import(`${P}/agency/routes.ts`);
const { handlePageFromSaved } = await import(`${P}/routes/saved_pages.ts`);
const L = await import(`${P}/lib/saved_pages.ts`);
const { printPageSections, normalizeCopied } = await import(`${P}/lib/site_layout.ts`);
const { RESERVED_NAMES } = await import(`${P}/lib/reserved_store.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const AG = 'aaaaaaaa-0000-4000-8000-000000000001', OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const USER = '11111111-1111-4111-8111-111111111111', MEMBER = '22222222-2222-4222-8222-222222222222';
const SALON = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', BISTRO = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', STRANGER = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3';
const PH1 = 'd1d1d1d1-1111-4111-8111-d1d1d1d1d1d1', PH2 = 'd2d2d2d2-2222-4222-8222-d2d2d2d2d2d2', LIB = 'e1e1e1e1-1111-4111-8111-e1e1e1e1e1e1';
const SAVED = 'f1f1f1f1-1111-4111-8111-f1f1f1f1f1f1', THEIRS = 'f2f2f2f2-2222-4222-8222-f2f2f2f2f2f2';

const SERVICES = [
  { type: 'title', title: 'Bella Hair Studio services', subtitle: 'Cuts and colour at Bella Hair Studio.' },
  { type: 'cards', id: 'svc', title: 'What we offer', cards: [{ heading: 'Cut', text: 'A cut at Bella Hair Studio', image_id: PH1 }, { heading: 'Colour', text: 'Colour', image_id: PH2 }] },
  { type: 'linked', ref: LIB },
  { type: 'form', id: 'book', title: 'Ask us', fields: [{ key: 'name', label: 'Name', type: 'text' }] },
];
let T, storage, writes, missing;
function reset() {
  missing = false; storage = []; writes = [];
  T = {
    presence_agencies: [{ id: AG, name: 'Bright Studio', status: 'active', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} }, { id: OTHER, name: 'Other', status: 'active' }],
    presence_agency_members: [{ id: MEMBER, agency_id: AG, email: 'eric@studio.example', role: 'owner', status: 'active', user_id: USER }],
    presence_agency_clients: [{ agency_id: AG, site_id: SALON, status: 'active' }, { agency_id: AG, site_id: BISTRO, status: 'active' }],
    presence_identity: [{ site_id: SALON, business_name: 'Bella Hair Studio' }, { site_id: BISTRO, business_name: 'Bistro Nine' }],
    presence_settings: [
      { site_id: SALON, blocks: [{ type: 'richtext', title: 'Hi', body: 'Home words' }], pages: [{ slug: 'salon-services', title: 'Salon services', blocks: SERVICES }, { slug: 'empty', title: 'Empty', blocks: [] }], nav: [] },
      { site_id: BISTRO, blocks: [{ type: 'cards', id: 'svc', title: 'Menu', cards: [{ heading: 'Soup' }] }], pages: [{ slug: 'about-us', title: 'About us', blocks: [] }], nav: [{ label: 'Home', href: '/' }, { label: 'About', href: '/about-us/' }] },
    ],
    presence_content_library: [{ id: LIB, site_id: SALON, name: 'Opening hours', kind: 'block', payload: { type: 'richtext', title: 'Bella Hair Studio hours', body: 'Open late on Thursdays.' } }],
    presence_media: [
      { id: PH1, site_id: SALON, storage_path: `presence-media/${SALON}/cut.jpg`, mime: 'image/jpeg', alt_text: 'A haircut', bytes: 100, width: 800, height: 600, focal_x: null, focal_y: null, deleted_at: null },
      { id: PH2, site_id: SALON, storage_path: `presence-media/${SALON}/colour.jpg`, mime: 'image/jpeg', alt_text: 'Colour', bytes: 100, width: 800, height: 600, focal_x: null, focal_y: null, deleted_at: null },
    ],
    presence_saved_pages: [
      { id: THEIRS, agency_id: OTHER, name: 'Not yours', purpose: 'sell', created_at: '2026-11-01T00:00:00Z', payload: { v: 1, title: 'x', from_name: 'x', blocks: [{ type: 'richtext', body: 'secret' }], library: [], media: [] } },
    ],
    presence_sales_templates: [],
    presence_change_events: [],
  };
}
const CTRL = ['select', 'limit', 'order', 'on_conflict', 'offset'];
const decode = (v) => decodeURIComponent(v);
const match = (r, k, v) => {
  if (v.startsWith('eq.')) return String(r[k]).toLowerCase() === decode(v.slice(3)).toLowerCase();
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => decode(x).toLowerCase()).includes(String(r[k]).toLowerCase());
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  return true;
};
function rowsFor(table, params) {
  let rows = (T[table] || []).filter((r) => [...params.entries()].every(([k, v]) => CTRL.includes(k) || k === 'or' || match(r, k, v)));
  const sel = params.get('select');
  if (sel) rows = rows.map((r) => Object.fromEntries(sel.split(',').map((part) => {
    const m = part.match(/^(\w+):(\w+)((?:->\w+)+)$/);
    if (m) { let v = r[m[2]]; for (const k of m[3].split('->').filter(Boolean)) v = v && typeof v === 'object' ? v[k] ?? null : null; return [m[1], v ?? null]; }
    return [part, r[part]];
  })));
  const lim = Number(params.get('limit')); return lim ? rows.slice(0, lim) : rows;
}
let nextId = 0;
const newId = () => `0000000${++nextId}`.slice(-8) + '-9999-4999-8999-999999999999';
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  const reply = (b, status = 200, headers = {}) => new Response(b === null ? null : JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  if (u.pathname === '/auth/v1/user') {
    const jwt = String(init.headers?.Authorization || '').replace('Bearer ', '');
    return jwt === 'jwt-studio' ? reply({ id: USER, email: 'eric@studio.example' }) : reply({ message: 'no' }, 401);
  }
  if (u.pathname.startsWith('/storage/v1/object/')) {
    const body = init.body ? JSON.parse(init.body) : null;
    storage.push({ method, path: u.pathname.replace('/storage/v1/object/', ''), body });
    return reply({ Key: body?.destinationKey || '' });
  }
  const table = u.pathname.replace(/^.*\/rest\/v1\//, '');
  if (missing && table === 'presence_saved_pages') return reply({ code: 'PGRST205', message: 'Could not find the table' }, 404);
  if (method === 'HEAD') { const n = rowsFor(table, u.searchParams).length; return new Response(null, { status: 200, headers: { 'content-range': `0-${n}/${n}` } }); }
  if (method === 'GET') return reply(rowsFor(table, u.searchParams));
  const body = init.body ? JSON.parse(init.body) : null;
  writes.push({ table, method, body, query: u.search });
  const hit = (T[table] || []).filter((r) => [...u.searchParams.entries()].every(([k, v]) => CTRL.includes(k) || match(r, k, v)));
  if (method === 'PATCH') { hit.forEach((r) => Object.assign(r, body)); return reply(hit.map((r) => ({ ...r }))); }
  if (method === 'DELETE') { T[table] = (T[table] || []).filter((r) => !hit.includes(r)); return reply(hit); }
  if (method === 'POST') {
    const list = Array.isArray(body) ? body : [body];
    const out = [];
    for (const b of list) {
      if (u.searchParams.get('on_conflict') === 'site_id') {
        const cur = (T[table] || []).find((r) => r.site_id === b.site_id);
        if (cur) { Object.assign(cur, b); out.push({ ...cur }); continue; }
      }
      const row = { id: newId(), created_at: '2026-11-12T10:00:00Z', ...b };
      (T[table] = T[table] || []).push(row); out.push({ ...row });
    }
    return reply(out, 201);
  }
  return reply([]);
};
const asMember = (over = {}) => ({ agency_id: AG, member_id: MEMBER, email: 'eric@studio.example', role: 'owner', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {}, ...over });
async function agency(member, method, route, body) {
  const req = new Request('http://stub.local/functions/v1/presence' + route, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } });
  const res = await handleAgency(req, route, method, member, { kind: 'client', userId: USER, email: member.email }, {});
  return { status: res.status, body: await res.json() };
}
const SITE = (id) => ({ id, template_slug: 'business-classic', template_version: '1.0.0' });
async function land(siteId, body, opts = {}) {
  const req = new Request('http://stub.local/functions/v1/presence/pages/from-saved', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': opts.jwt ?? 'jwt-studio' } });
  const principal = { kind: 'client', userId: USER, email: 'eric@studio.example', scope: opts.own ? null : { site_id: siteId, name: 'x' }, member: null };
  const res = await handlePageFromSaved(req, SITE(siteId), principal, {});
  return { status: res.status, body: await res.json() };
}
const settingsOf = (id) => T.presence_settings.find((s) => s.site_id === id);

// ═══ 1. what a saved page carries (pure) ═══
{
  eq('a name is one line, no control characters, at most 80', [L.cleanSavedName('  Salon\n services  '), L.cleanSavedName('x'.repeat(90)).length, L.cleanSavedName('\u0007')], ['Salon services', 80, '']);
  eq('Home is the page with no address; a page is found by its own', [L.pageInSettings({ blocks: [1] }, '')?.title, L.pageInSettings({ pages: [{ slug: 'a', title: 'A', blocks: [] }] }, 'a')?.title, L.pageInSettings({ pages: [] }, 'b')], ['Home', 'A', null]);
  eq('the picture: each section by its kind, a linked one by what it shows', L.outlineOf(SERVICES, [{ id: LIB, name: 'x', payload: { type: 'richtext' } }]), ['title', 'cards', 'richtext', 'form']);
  const p = L.buildSavedPayload({ title: 'Salon services', from_name: 'Bella Hair Studio', blocks: SERVICES, library: [], media: [{ id: PH1, storage_path: 'x' }] });
  eq('the payload: its sections, how many, and its photos', [p.v, p.summary, p.blocks.length], [1, { sections: 4, photos: 1 }, 4]);
  const row = L.savedPageRow({ id: SAVED, name: 'Salon services', purpose: 'sell', from_name: 'Bella Hair Studio', outline: ['title', 'cards'], summary: { sections: 2, photos: 1 }, payload: p });
  ok('the list never sends sections or photos', !('payload' in row) && !('blocks' in row) && !JSON.stringify(row).includes('A cut'));
  eq('a new page’s address: the one asked for, else from its name, never a built-in page or one taken', [L.newPageSlug('our-services', 'X', new Set()), L.newPageSlug('', 'Services', new Set()), L.newPageSlug('', 'Contact', new Set()), L.newPageSlug('gallery', 'Gallery', new Set(['gallery'])), L.newPageSlug('Bad Slug!', 'Menu', new Set())], ['our-services', 'services-2', 'contact-2', 'gallery-2', 'menu-2']);
  const landed = L.landSavedPage({ blocks: [{ type: 'form', id: 'book_2' }], pages: [], nav: [{ label: 'Home', href: '/' }] }, { ...p, blocks: SERVICES }, { title: 'Salon services', slug: 'salon-services', map: { [PH1]: 'NEW-PHOTO' }, toName: 'Bistro Nine' });
  const page = landed.page;
  ok('landing: the old business’s name becomes the new one in the words', JSON.stringify(page.blocks).includes('Bistro Nine services') && !JSON.stringify(page.blocks).includes('Bella Hair'));
  ok('landing: photos point at the site’s own copies', JSON.stringify(page.blocks).includes('NEW-PHOTO') && !JSON.stringify(page.blocks).includes(PH1));
  ok('landing: ids are made new, past every id on the site', page.blocks.find((b) => b.type === 'form').id !== 'book' && page.blocks.find((b) => b.type === 'form').id !== 'book_2' && page.blocks.find((b) => b.type === 'cards').id === 'svc_2');
  eq('landing: the menu of its own gains the page', landed.nav, [{ label: 'Home', href: '/' }, { label: 'Salon services', href: '/salon-services/' }]);
  ok('landing: a site on the automatic menu keeps it', L.landSavedPage({ pages: [], nav: [] }, p, { title: 'A', slug: '', map: {}, toName: '' }).nav === null);
  ok('landing: a full menu keeps its twelve', L.landSavedPage({ pages: [], nav: Array.from({ length: 12 }, (_, i) => ({ label: 'x' + i, href: '/' })) }, p, { title: 'A', slug: '', map: {}, toName: '' }).nav === null);
  ok('landing: a site with 20 pages of its own says so', L.landSavedPage({ pages: Array.from({ length: 20 }, (_, i) => ({ slug: 'p' + i, title: 'P', blocks: [] })) }, p, { title: 'A', slug: '', map: {}, toName: '' }).error === 'page_limit');
  const kept = { from: 'Bella', at: 't', sections: ['old'], media: ['m0'], kept: true }, open = { ...kept, kept: false };
  eq('the copy record: a kept record starts again with the new page only', L.addToCopied(kept, 'your “Salon” page', 'now', ['a', 'b'], ['m1']), { from: 'your “Salon” page', at: 'now', sections: ['a', 'b'], media: ['m1'], kept: false });
  eq('the copy record: an open one keeps its leftovers and adds the new page', L.addToCopied(open, 'your “Salon” page', 'now', ['a'], ['m1']), { from: 'Bella', at: 'now', sections: ['old', 'a'], media: ['m0', 'm1'], kept: false });
  const content = { settings: { blocks: [{ type: 'richtext', body: 'home' }], pages: [{ slug: 'a', blocks: [{ type: 'richtext', body: 'one' }, { type: 'divider' }] }, { slug: 'b', blocks: [{ type: 'richtext', body: 'two' }] }] } };
  ok('prints: only that page’s sections, and never a divider', printPageSections(content, 'a').length === 1 && printPageSections(content, 'b')[0] !== printPageSections(content, 'a')[0] && printPageSections(content, '').length === 1);
}

// ═══ 2. the studio's list ═══
{
  reset();
  let r = await agency(asMember(), 'POST', '/agency/pages', { site_id: SALON, slug: 'salon-services', name: 'Salon services', purpose: 'sell' });
  ok('save: answers the saved page, with its counts and outline', r.status === 201 && r.body.data.name === 'Salon services' && r.body.data.purpose === 'sell' && r.body.data.summary.sections === 4 && r.body.data.summary.photos === 2 && r.body.data.from_name === 'Bella Hair Studio', JSON.stringify(r.body));
  const stored = T.presence_saved_pages.find((x) => x.name === 'Salon services');
  ok('save: kept for this studio, from that site, by whom', stored && stored.agency_id === AG && stored.created_from_site === SALON && stored.created_by === 'eric@studio.example');
  ok('save: its sections and the saved section it links to travel', stored.payload.blocks.length === 4 && stored.payload.library.length === 1 && stored.payload.library[0].payload.body === 'Open late on Thursdays.');
  ok('save: its photos are copies in the studio’s own folder, so it outlives the site', stored.payload.media.length === 2 && stored.payload.media.every((m) => m.storage_path.startsWith(`presence-media/templates/${AG}/`)) && storage.filter((s) => s.path === 'copy').length === 2);
  ok('save: never a business detail', !JSON.stringify(stored.payload).match(/"(phone|email|address|hours|business_name)"/));
  const savedId = stored.id;

  r = await agency(asMember(), 'GET', '/agency/pages');
  ok('list: this studio’s saved pages only, newest first, with who may manage them', r.status === 200 && r.body.data.length === 1 && r.body.data[0].id === savedId && r.body.available === true && r.body.can_manage === true);
  ok('list: its outline and counts, never its sections or photos', JSON.stringify(r.body.data[0].outline) === JSON.stringify(['title', 'cards', 'richtext', 'form']) && !JSON.stringify(r.body).includes('A cut') && !JSON.stringify(r.body).includes('storage_path'));

  r = await agency(asMember({ role: 'designer' }), 'POST', '/agency/pages', { site_id: SALON, slug: 'salon-services', name: 'x', purpose: 'sell' });
  ok('save: a role that can’t manage clients can’t', r.status === 403);
  r = await agency(asMember(), 'POST', '/agency/pages', { site_id: STRANGER, slug: '', name: 'x', purpose: 'sell' });
  ok('save: a site outside the studio is refused, and nothing is copied', r.status === 404 && storage.filter((s) => s.path === 'copy').length === 2);
  r = await agency(asMember(), 'POST', '/agency/pages', { site_id: SALON, slug: 'salon-services', name: 'x', purpose: 'shop' });
  ok('save: what it is for is one of the four', r.status === 400 && r.body.error === 'bad_purpose');
  r = await agency(asMember(), 'POST', '/agency/pages', { site_id: SALON, slug: 'salon-services', name: '  ', purpose: 'sell' });
  ok('save: it needs a name', r.status === 400 && r.body.error === 'bad_name');
  r = await agency(asMember(), 'POST', '/agency/pages', { site_id: SALON, slug: 'empty', name: 'Empty', purpose: 'show' });
  ok('save: a page with no sections says to add some', r.status === 422 && r.body.error === 'empty_page');
  r = await agency(asMember(), 'POST', '/agency/pages', { site_id: SALON, slug: 'nope', name: 'x', purpose: 'show' });
  ok('save: a page that isn’t there', r.status === 404);

  r = await agency(asMember(), 'PATCH', `/agency/pages/${savedId}`, { name: 'Hair salon services', purpose: 'show' });
  ok('rename and regroup', r.status === 200 && r.body.data.name === 'Hair salon services' && r.body.data.purpose === 'show');
  r = await agency(asMember(), 'PATCH', `/agency/pages/${THEIRS}`, { name: 'Mine now' });
  ok('rename: another studio’s saved page is not yours', r.status === 404 && T.presence_saved_pages.find((x) => x.id === THEIRS).name === 'Not yours');
  r = await agency(asMember(), 'PATCH', `/agency/pages/${savedId}`, { purpose: 'shop' });
  ok('rename: what it is for is still one of the four', r.status === 400);

  r = await agency(asMember(), 'DELETE', `/agency/pages/${THEIRS}`);
  ok('remove: another studio’s saved page stays', r.status === 404 && T.presence_saved_pages.some((x) => x.id === THEIRS));
  const before = storage.length;
  r = await agency(asMember(), 'DELETE', `/agency/pages/${savedId}`);
  const gone = storage.slice(before).filter((s) => s.method === 'DELETE');
  ok('remove: gone, with its own photo copies, only from the studio’s folder', r.status === 200 && r.body.data.photos_removed === 2 && gone.every((g) => g.path.startsWith(`presence-media/templates/${AG}/`)) && !T.presence_saved_pages.some((x) => x.id === savedId));
}

// ═══ 3. before migration 0217 ═══
{
  reset(); missing = true;
  let r = await agency(asMember(), 'GET', '/agency/pages');
  ok('before 0217: the list is empty and says it isn’t switched on', r.status === 200 && r.body.data.length === 0 && r.body.available === false);
  r = await agency(asMember(), 'POST', '/agency/pages', { site_id: SALON, slug: 'salon-services', name: 'Salon services', purpose: 'sell' });
  const copies = storage.filter((s) => s.path === 'copy').length, removed = storage.filter((s) => s.method === 'DELETE').length;
  ok('before 0217: a save says so, and the photo copies made for it go again', r.status === 503 && r.body.error === 'not_ready' && copies === 2 && removed === 2);
  r = await land(BISTRO, { saved_id: SAVED, title: 'Salon services' });
  ok('before 0217: adding one says so and adds nothing', r.status === 503 && settingsOf(BISTRO).pages.length === 1);
}

// ═══ 4. landing on a client's site ═══
{
  reset();
  await agency(asMember(), 'POST', '/agency/pages', { site_id: SALON, slug: 'salon-services', name: 'Salon services', purpose: 'sell' });
  const savedId = T.presence_saved_pages.find((x) => x.name === 'Salon services').id;
  writes = [];
  let r = await land(BISTRO, { saved_id: THEIRS, title: 'x' });
  ok('add: another studio’s saved page isn’t yours to add', r.status === 404 && settingsOf(BISTRO).pages.length === 1);
  r = await land(STRANGER, { saved_id: savedId, title: 'x' });
  ok('add: a site outside the studio is refused', r.status === 404);
  r = await land(BISTRO, { saved_id: savedId, title: 'x' }, { jwt: 'jwt-client' });
  ok('add: someone who isn’t in the studio can’t', r.status === 403 && r.body.message === 'Only your studio can add its saved pages.');
  r = await land(BISTRO, { saved_id: 'not-an-id' });
  ok('add: it says which saved page', r.status === 400);

  r = await land(BISTRO, { saved_id: savedId, title: 'Our services', slug: 'our-services' });
  const s = settingsOf(BISTRO), page = s.pages.find((p) => p.slug === 'our-services');
  ok('add: the page lands at the end, under its own name and address', r.status === 201 && r.body.data.slug === 'our-services' && r.body.data.title === 'Our services' && s.pages.at(-1) === page && page.blocks.length === 4);
  ok('add: the old business’s name becomes this one’s', JSON.stringify(page.blocks).includes('Bistro Nine services') && !JSON.stringify(page.blocks).includes('Bella Hair'));
  const mine = T.presence_media.filter((m) => m.site_id === BISTRO);
  ok('add: the photos are this site’s own copies, marked where they came from', mine.length === 2 && mine.every((m) => m.storage_path.startsWith(`presence-media/${BISTRO}/`) && m.metadata.copied_from === 'your “Salon services” page'));
  const cards = page.blocks.find((b) => b.type === 'cards');
  ok('add: the sections point at those copies', cards.cards.every((c) => mine.some((m) => m.id === c.image_id)));
  const lib = T.presence_content_library.find((x) => x.site_id === BISTRO);
  ok('add: the saved section it links to becomes this site’s own, with the name swapped', lib && page.blocks.some((b) => b.type === 'linked' && b.ref === lib.id) && lib.payload.title === 'Bistro Nine hours');
  ok('add: an id already on the site isn’t shared', page.blocks.find((b) => b.type === 'cards').id !== 'svc' && page.blocks.find((b) => b.type === 'form').id !== 'book');
  eq('add: the menu of its own gains the page', s.nav.map((n) => n.href), ['/', '/about-us/', '/our-services/']);
  const rec = normalizeCopied(JSON.parse(T.presence_sales_templates.find((x) => x.site_id === BISTRO && x.name === RESERVED_NAMES.copiedFrom)?.body || 'null'));
  ok('add: the copy is recorded, so Publish lists what’s untouched', !!rec && rec.kept === false && rec.from === 'your “Salon services” page' && rec.media.length === 2 && rec.sections.length >= 1, JSON.stringify(rec));
  ok('add: the change is written down in words', T.presence_change_events.some((e) => e.summary === 'Added the “Our services” page from the studio’s saved pages'));

  const again = await land(BISTRO, { saved_id: savedId, title: 'Our services', slug: 'our-services' });
  ok('add again: a taken address gets the next free one', again.status === 201 && again.body.data.slug === 'our-services-2');

  // the studio's own site: no record (the studio owns both ends)
  T.presence_settings.push({ site_id: STRANGER, blocks: [], pages: [], nav: [] });
  T.presence_identity.push({ site_id: STRANGER, business_name: 'Bright Studio' });
  const own = await land(STRANGER, { saved_id: savedId, title: 'Services', slug: 'services' }, { own: true });
  ok('the studio’s own site: it lands, at a free address, with no copy record', own.status === 201 && own.body.data.slug === 'services-2' && own.body.data.recorded === false && !T.presence_sales_templates.some((x) => x.site_id === STRANGER));
}

// ═══ 5. wiring ═══
{
  const lock = read('supabase/functions/presence/lib/optimistic_lock.ts'), page = read('presence.html');
  const rx = (src) => (src.match(/const DRAFT_WRITE = (\/.*\/);/) || [])[1];
  ok('a draft write on both sides, in the same words', rx(lock) && rx(lock) === rx(page) && rx(lock).includes('pages\\/(?:duplicate|from-saved)'));
  const idx = read('supabase/functions/presence/index.ts');
  ok('router: POST /pages/from-saved, off the member data path', idx.includes("if (route === '/pages/from-saved' && method === 'POST') return handlePageFromSaved(req, site, principal, cors);"));
  ok('agency: the saved pages routes run inside the studio router', read('supabase/functions/presence/agency/routes.ts').includes('const r = await handleSavedPages(req, route, method, member, cors, { ownSite: () => ownSiteOf('));
  const roles = await import(`${P}/lib/site_roles.ts`);
  ok('members: open on the member list, because the route admits the studio alone and says so', roles.memberWriteNeeds('/pages/from-saved', 'POST') === 'open' && roles.contentWriteNeeds('/pages/from-saved', 'POST') === null && read('supabase/functions/presence/routes/saved_pages.ts').includes("return json({ error: 'forbidden', message: 'Only your studio can add its saved pages.' }, 403, cors);"));
  for (const [name, sql] of [['migration', read('supabase/migrations/0217_saved_pages.sql')], ['pack', read('docs/presence/APPLY-0217-prod.sql')]]) {
    ok(`${name}: one row a saved page, closed to everyone but the function`, /create table if not exists public\.presence_saved_pages/.test(sql) && /enable row level security/.test(sql) && /revoke all on public\.presence_saved_pages from anon, authenticated/.test(sql) && /references public\.presence_agencies\(id\) on delete cascade/.test(sql));
    ok(`${name}: what it is for is one of the four`, sql.includes("check (purpose in ('introduce', 'sell', 'show', 'home'))"));
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\n════ SAVED PAGES: ${results.length - failed}/${results.length} ${failed ? 'FAILED' : 'PASSED'} ════`);
if (failed) Deno.exit(1);
Deno.exit(0);
