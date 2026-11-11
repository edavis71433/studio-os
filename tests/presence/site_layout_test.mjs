// ── Duplicate copies the pages; a site can be saved as "my template" (builder list item 145) ──
// File 02 finding 3 and file 03 finding 3 (Nov 10 review): Duplicate started a new
// site from another one's setup only, so every page had to be rebuilt. Now the pages
// travel: sections with their words and true copies of their photos, saved sections,
// the menu's own page links, the section order, the look and its CSS; the old name in
// the words becomes the new one; and the copy is recorded, so publishing lists what
// is still exactly as copied until it is changed or kept. This suite pins:
//   · the pure rules (lib/site_layout.ts): the menu, id and name swaps, the photos a
//     layout uses, a section's print (restyling isn't rewriting), what's left, and the
//     one publish item, which never names the other business;
//   · the routes, through the real handleAgency() against an in-memory PostgREST and a
//     stand-in for storage: Duplicate's copy and what it never touches, the record,
//     Keep, a site that already has pages, Save as a template (photos kept in the
//     studio's template folder), the kits list saying which are templates, and a
//     template landing on a new site;
//   · the wiring: room.ts and publish.ts both ask copiedBlockerFor, the page.
//   deno run --allow-read --allow-env tests/presence/site_layout_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'service-key');
const L = await import('../../supabase/functions/presence/lib/site_layout.ts');
const { copiedBlockerFor } = await import('../../supabase/functions/presence/lib/copied_record.ts');
const { serializeDraft } = await import('../../supabase/functions/presence/lib/serializer.ts');
const { getTemplate } = await import('../../supabase/functions/presence/lib/render.ts');
const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');
const { RESERVED_NAMES } = await import('../../supabase/functions/presence/lib/reserved_store.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));

// ═══ 1. the pure rules ═══
{
  const nav = [{ label: 'Home', href: '/' }, { label: 'Instagram', href: 'https://instagram.com/bistro' }, { label: 'Call us', href: 'tel:555' }, { label: 'Email', href: 'mailto:a@b.example' },
    { label: 'Menu', href: '/menu/', children: [{ label: 'Dinner', href: '/dinner/' }, { label: 'Order', href: 'https://order.example' }] }];
  const m = L.menuForCopy(nav);
  ok('menu: only links to the site\'s own pages travel (other websites, email and phone stay behind)', JSON.stringify(m) === JSON.stringify([{ label: 'Home', href: '/' }, { label: 'Menu', href: '/menu/', children: [{ label: 'Dinner', href: '/dinner/' }] }]));
  ok('menu: nothing that isn\'t a list is a menu', L.menuForCopy(null).length === 0 && L.menuForCopy({ a: 1 }).length === 0);
  const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  ok('ids: every old id becomes its new one, at any depth, any case', JSON.stringify(L.swapIds({ x: [A.toUpperCase(), { y: A }], z: 'keep' }, { [A]: B })) === JSON.stringify({ x: [B, { y: B }], z: 'keep' }));
  const sw = L.swapName({ type: 'richtext', title: 'Welcome to Bistro Nine', body: 'Bistro Nine’s kitchen. Bistro Niner is another place.', url: 'https://bistro-nine.example/Bistro Nine', id: 'Bistro Nine', button: { label: 'Visit Bistro Nine', url: '/Bistro Nine/' } }, 'Bistro Nine', 'Bistro Twelve');
  ok('name: the old business name in the words becomes the new one, whole words only', sw.title === 'Welcome to Bistro Twelve' && sw.body === 'Bistro Twelve’s kitchen. Bistro Niner is another place.' && sw.button.label === 'Visit Bistro Twelve');
  ok('name: never inside a link, an id or a type', sw.url === 'https://bistro-nine.example/Bistro Nine' && sw.id === 'Bistro Nine' && sw.type === 'richtext' && sw.button.url === '/Bistro Nine/');
  ok('name: an empty, one-letter or same name changes nothing', L.swapName({ t: 'A b' }, 'A', 'Z').t === 'A b' && L.swapName({ t: 'x' }, '', 'Z').t === 'x' && L.swapName({ t: 'Bistro' }, 'Bistro', 'Bistro').t === 'Bistro');
  const settings = { blocks: [{ type: 'image', image_id: A }, { type: 'linked', ref: B }], pages: [{ slug: 'team', blocks: [{ type: 'team', members: [{ name: 'Pat', media_id: 'cccccccc-3333-4333-8333-cccccccccccc' }] }] }] };
  ok('photos: every id a layout\'s sections (and its saved sections) hold', ['cccccccc-3333-4333-8333-cccccccccccc', A, B, 'dddddddd-4444-4444-8444-dddddddddddd'].every((id) => L.layoutMediaIds(settings, [{ payload: { type: 'image', image_id: 'dddddddd-4444-4444-8444-dddddddddddd' } }]).includes(id)));
  ok('linked: the saved sections it links to', JSON.stringify(L.layoutLinkedIds(settings)) === JSON.stringify([B]));
  ok('counts: pages, every section on Home and the pages, the menu', JSON.stringify(L.layoutCounts({ ...settings, nav })) === JSON.stringify({ pages: 1, sections: 3, menu: 5 }));

  const photo = (path, alt = 'A dish') => ({ alt, variants: { w400: `${path}-400.webp`, w800: `${path}-800.webp` }, width: 800, height: 600 });
  const content = (blocks, pages) => ({ settings: { blocks, ...(pages ? { pages } : {}) } });
  const base = content([{ type: 'richtext', title: 'About', body: 'We cook.' }, { type: 'image', image: photo('/img/aa') }, { type: 'divider', style: 'line', size: 'm' }], [{ slug: 'team', title: 'Team', blocks: [{ type: 'team', title: 'Our team', members: [{ name: 'Pat' }] }] }]);
  const prints = L.printSections(base);
  ok('print: every section with words or photos, with its page; a divider carries nothing of theirs', prints.length === 3 && prints.map((p) => p.page).join(',') === 'Home,Home,Team' && prints[0].title === 'About' && prints[1].title === 'Image' && prints[2].title === 'Our team');
  const restyled = content([{ type: 'richtext', title: 'About', body: 'We cook.', look: { bg: 'dark' }, style: { pad: 'l' } }, { type: 'image', image: { ...photo('/img/aa'), variants: { w1200: '/img/aa-1200.webp' } } }]);
  ok('print: a new background or style, or a new look\'s photo sizes, isn\'t a rewrite', L.printSections(restyled)[0].print === prints[0].print && L.printSections(restyled)[1].print === prints[1].print);
  const rewritten = content([{ type: 'richtext', title: 'About', body: 'We cook for you.' }, { type: 'image', image: photo('/img/bb') }]);
  ok('print: new words or another photo is', L.printSections(rewritten)[0].print !== prints[0].print && L.printSections(rewritten)[1].print !== prints[1].print);
  const rec = { from: 'Bistro Nine', at: '', sections: prints.map((p) => p.print), media: ['m-1', 'm-2'], kept: false };
  const left = L.copiedLeftovers(rec, rewritten, ['m-2', 'm-9']);
  ok('left: only what is still exactly as copied, and the copied photos still in use', left.sections.length === 0 && left.photos === 1);
  const all = L.copiedLeftovers(rec, base, ['M-1', 'm-2']);
  ok('left: untouched sections are listed with their pages (case doesn\'t matter for photos)', all.sections.length === 3 && all.photos === 2);
  ok('left: nothing once kept, or with no record', L.copiedLeftovers({ ...rec, kept: true }, base, ['m-1']).sections.length === 0 && L.copiedLeftovers(null, base, []).photos === 0);
  const b = L.copiedBlocker(all);
  ok('blocker: one thing to finish that names the pages and sections, and how to clear it', b.field === 'copied' && b.message === 'Still exactly as copied from another site: 3 sections (Home: About, Image; Team: Our team) and 2 photos. Change them for this business, or press Keep on this site’s card in Sites.');
  ok('blocker: never names the other business (the site\'s owner may read it)', !/Bistro/.test(b.message));
  ok('blocker: none when nothing is left', L.copiedBlocker({ sections: [], photos: 0 }) === null && L.copiedBlocker({ sections: [], photos: 1 }).message.includes('1 photo.'));
  ok('record: anything malformed is no record', L.normalizeCopied(null) === null && L.normalizeCopied('x') === null && L.normalizeCopied({ from: 'X', sections: 'no', media: [1], kept: 'yes' }).kept === false);
}

// ═══ 2. the routes ═══
const AG = 'aaaaaaaa-0000-4000-8000-000000000001';
const ME = '11111111-1111-4111-8111-111111111111', RO = '33333333-3333-4333-8333-333333333333';
const UID = '99999999-0000-4000-8000-000000000009';
const S1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', NEW = 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4', NEW2 = 'd5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5', BUSY = 'd6d6d6d6-d6d6-4d6d-8d6d-d6d6d6d6d6d6';
const OWN = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', STRANGER = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const C1 = 'c1000000-0000-4000-8000-000000000001', CN = 'c4000000-0000-4000-8000-000000000004', CN2 = 'c4000000-0000-4000-8000-000000000005', CB = 'c4000000-0000-4000-8000-000000000006', CO = 'c5000000-0000-4000-8000-000000000005';
const M1 = 'f1f1f1f1-1111-4111-8111-f1f1f1f1f1f1', M2 = 'f2f2f2f2-2222-4222-8222-f2f2f2f2f2f2', M3 = 'f3f3f3f3-3333-4333-8333-f3f3f3f3f3f3', LIB = 'e1e1e1e1-1111-4111-8111-e1e1e1e1e1e1';
let T, writes, copies;
function reset() {
  const site = (id, client, over = {}) => ({ id, client_id: client, edition: 'presence', status: 'ready', last_published_at: null, custom_domain: null, netlify_site_id: 'nf', template_slug: 'atelier', template_version: '1.0.0', ...over });
  T = {
    presence_agency_members: [{ id: ME, agency_id: AG, email: 'eric@studio.example', role: 'owner', status: 'active', user_id: UID }, { id: RO, agency_id: AG, email: 'ro@studio.example', role: 'readonly', status: 'active' }],
    presence_agency_clients: [S1, NEW, NEW2, BUSY].map((site_id) => ({ site_id, agency_id: AG, status: 'active', tags: [], owner_email: '', assigned: [], notes: '', onboarded_at: '2026-11-01T00:00:00Z' })),
    presence_sites: [site(S1, C1, { status: 'live', last_published_at: '2026-10-20T00:00:00Z', template_slug: 'business-classic' }), site(NEW, CN), site(NEW2, CN2), site(BUSY, CB), site(OWN, CO), site(STRANGER, 'c-x')],
    clients: [{ id: C1, name: 'Bistro Nine', email: 'owner@bistro.example' }, { id: CN, name: 'Bistro Twelve', email: 'new@twelve.example' }, { id: CN2, name: 'Cafe Thirteen', email: 'cafe@thirteen.example' }, { id: CB, name: 'Busy Bee', email: 'b@bee.example' }],
    presence_identity: [{ site_id: S1, business_name: 'Bistro Nine', phone: '555-0100' }, { site_id: NEW, business_name: 'Bistro Twelve' }, { site_id: NEW2, business_name: 'Cafe Thirteen' }, { site_id: BUSY, business_name: 'Busy Bee' }],
    presence_settings: [
      { site_id: S1, industry_key: 'restaurant', category_order: ['Dinner'],
        blocks: [
          { type: 'richtext', title: 'About', body: 'Welcome to Bistro Nine, on the corner since 1999.' },
          { type: 'image_text', title: 'Our room', body: 'Bistro Nine seats forty.', image_id: M1, side: 'left' },
          { type: 'linked', ref: LIB },
          { type: 'divider', style: 'line', size: 'm' },
        ],
        pages: [{ slug: 'team', title: 'Team', blocks: [{ type: 'team', title: 'Our team', members: [{ name: 'Pat', role: 'Chef', media_id: M2 }] }] }],
        nav: [{ label: 'Home', href: '/' }, { label: 'Team', href: '/team/' }, { label: 'Instagram', href: 'https://instagram.com/bistronine' }, { label: 'Call', href: 'tel:5550100' }],
        sections_order: ['about'], sections_hidden: [], hero_layout: 'split', nav_style: 'classic', footer_hours: true, footer_social: false,
        page_seo: { about: { title: 'Bistro Nine — About' } }, logo_media_id: M3 },
      { site_id: BUSY, blocks: [{ type: 'richtext', title: 'Mine', body: 'Already here.' }], pages: [] },
    ],
    presence_dev_customizations: [{ site_id: S1, theme_tokens: { accent: '#7a2e2e' }, custom_css: '.hero{letter-spacing:.01em}', custom_html: '<script>track()</script>' }],
    presence_content_library: [{ id: LIB, site_id: S1, name: 'Opening hours note', kind: 'block', payload: { type: 'richtext', title: 'Hours', body: 'Bistro Nine is closed Mondays.' } }],
    presence_media: [
      { id: M1, site_id: S1, storage_path: 'presence-media/s1/room.jpg', mime: 'image/jpeg', alt_text: 'The dining room', bytes: 1000, width: 1600, height: 1000, focal_x: 50, focal_y: 40, deleted_at: null },
      { id: M2, site_id: S1, storage_path: 'presence-media/s1/pat.jpg', mime: 'image/jpeg', alt_text: 'Pat', bytes: 900, width: 800, height: 800, focal_x: null, focal_y: null, deleted_at: null },
      { id: M3, site_id: S1, storage_path: 'presence-media/s1/logo.png', mime: 'image/png', alt_text: 'Bistro Nine logo', bytes: 100, width: 200, height: 200, focal_x: null, focal_y: null, deleted_at: null },
    ],
    presence_offerings: [{ site_id: S1, name: 'Tasting menu', category: 'Dinner', description: 'Seven courses', price_text: '$90', sort_order: 0, deleted_at: null, is_visible: true }],
    presence_faqs: [], presence_voice: [], presence_sales_templates: [], presence_starter_kits: [],
  };
  writes = []; copies = [];
}
function match(r, k, v) {
  const val = (x) => decodeURIComponent(x).replace(/^"(.*)"$/, '$1');
  if (v.startsWith('eq.')) return String(r[k]) === val(v.slice(3));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(r[k]));
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
  if (v === 'is.true') return r[k] === true;
  return true;
}
const CTRL = ['select', 'limit', 'order', 'on_conflict'];
function rowsFor(table, params) {
  let rows = (T[table] || []).filter((r) => [...params.entries()].every(([k, v]) => CTRL.includes(k) || match(r, k, v)));
  const lim = Number(params.get('limit')); if (lim) rows = rows.slice(0, lim);
  // PostgREST's alias:col->key select (GET /agency/kits reads summary:payload->layout_summary)
  const arrows = (params.get('select') || '').split(',').map((s) => s.match(/^(\w+):(\w+)->(\w+)$/)).filter(Boolean);
  if (arrows.length) rows = rows.map((r) => { const o = { ...r }; for (const [, alias, col, key] of arrows) o[alias] = r[col] ? r[col][key] ?? null : null; return o; });
  return rows;
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  const reply = (b, status = 200) => new Response(b === null ? null : JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.pathname === '/storage/v1/object/copy') { copies.push(body); return reply({ Key: body.destinationKey }); }
  if (u.pathname.includes('/storage/v1/object/sign/')) return reply({ signedURL: u.pathname.replace('/storage/v1', '') + '?token=t' });
  const table = u.pathname.replace(/^.*\/rest\/v1\//, '');
  const auth = String((init.headers || {}).Authorization || '');
  if (method === 'GET' && table === 'presence_sites' && /jwt-studio/.test(auth)) return reply(T.presence_sites.filter((s) => s.id === OWN));
  if (method === 'GET' && /jwt-/.test(auth)) return reply([]);
  if (method === 'GET') return reply(rowsFor(table, u.searchParams));
  writes.push({ table, method, body, query: u.search });
  const conflict = u.searchParams.get('on_conflict');
  if (method === 'PATCH') {
    // reserved rows: the compare-and-swap on updated_at (lib/reserved_store.ts)
    const hit = rowsFor(table, u.searchParams); hit.forEach((r) => Object.assign(r, body)); return reply(hit);
  }
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]);
    const out = list.map((r) => {
      if (conflict) { const keys = conflict.split(','); const have = (T[table] || []).find((x) => keys.every((k) => String(x[k]) === String(r[k]))); if (have) { Object.assign(have, r); return have; } }
      const row = { id: crypto.randomUUID(), created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z', deleted_at: null, ...r };
      (T[table] = T[table] || []).push(row); return row;
    });
    return reply(out, 201);
  }
  return reply([]);
};
const asMember = (over = {}) => ({ agency_id: AG, member_id: ME, email: 'eric@studio.example', role: 'owner', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {}, ...over });
const PRINCIPAL = { kind: 'client', userId: UID, email: 'eric@studio.example' };
async function call(member, method, route, body) {
  const req = new Request('http://stub.local/functions/v1/presence' + route, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': 'jwt-studio' } });
  const res = await handleAgency(req, route.split('?')[0], method, member, PRINCIPAL, {});
  return { status: res.status, body: await res.json() };
}
const settingsOf = (id) => T.presence_settings.find((s) => s.site_id === id) || {};
const recordOf = (id) => { const r = T.presence_sales_templates.find((t) => t.site_id === id && t.name === RESERVED_NAMES.copiedFrom); return r ? JSON.parse(r.body) : null; };
async function draftOf(id) {
  const s = T.presence_sites.find((x) => x.id === id);
  const t = getTemplate(s.template_slug, s.template_version);
  return serializeDraft(id, t.manifest, { templateSlug: s.template_slug, templateVersion: s.template_version, now: '2026-11-10T00:00:00Z' });
}

// ── Duplicate: the pages travel ──
{
  reset();
  const d = await call(asMember(), 'POST', `/agency/sites/${S1}/duplicate`, { site_id: NEW });
  ok('duplicate: 200 and it says what came across — 1 page, 5 sections, the menu, 2 photos, the look', d.status === 200 && JSON.stringify(d.body.data.pages) === JSON.stringify({ pages: 1, sections: 5, menu: 2, photos: 2, photos_failed: 0 }) && d.body.data.look === 'Business Classic' && d.body.data.applied.offerings === 1);
  const ns = settingsOf(NEW);
  ok('duplicate: Home\'s sections land with the old name in their words swapped for the new one', ns.blocks?.[0]?.body === 'Welcome to Bistro Twelve, on the corner since 1999.' && ns.blocks?.[1]?.body === 'Bistro Twelve seats forty.');
  const newMedia = T.presence_media.filter((m) => m.site_id === NEW);
  ok('duplicate: the photos the sections use are the new site\'s own copies — never the logo, never a shared file', newMedia.length === 2 && copies.length === 2 && copies.every((c) => c.destinationKey.startsWith(`${NEW}/`) && c.bucketId === 'presence-media') && copies.map((c) => c.sourceKey).sort().join(',') === 's1/pat.jpg,s1/room.jpg');
  ok('duplicate: each copy is marked as copied, keeps its words for the blind, and its crop', newMedia.every((m) => m.metadata.copied_from === 'Bistro Nine') && newMedia.find((m) => m.alt_text === 'The dining room').focal_y === 40);
  const room = newMedia.find((m) => m.alt_text === 'The dining room'), pat = newMedia.find((m) => m.alt_text === 'Pat');
  ok('duplicate: the sections point at the copies, not the old site\'s photos', ns.blocks[1].image_id === room.id && ns.pages[0].blocks[0].members[0].media_id === pat.id && !JSON.stringify(ns.blocks).includes(M1));
  const lib = T.presence_content_library.find((x) => x.site_id === NEW);
  ok('duplicate: a linked saved section becomes the new site\'s own, its words swapped too', !!lib && ns.blocks[2].ref === lib.id && lib.payload.body === 'Bistro Twelve is closed Mondays.');
  ok('duplicate: the menu keeps its own pages only (no Instagram, no phone)', JSON.stringify(ns.nav) === JSON.stringify([{ label: 'Home', href: '/' }, { label: 'Team', href: '/team/' }]));
  ok('duplicate: the section order and header and footer choices come across', ns.hero_layout === 'split' && ns.nav_style === 'classic' && ns.footer_social === false && JSON.stringify(ns.sections_order) === '["about"]');
  ok('duplicate: search titles, the logo and the old site\'s scripts never do', !('page_seo' in ns) && !('logo_media_id' in ns) && !(T.presence_dev_customizations.find((x) => x.site_id === NEW)?.custom_html));
  ok('duplicate: the look\'s own CSS does', T.presence_dev_customizations.find((x) => x.site_id === NEW)?.custom_css === '.hero{letter-spacing:.01em}');
  ok('duplicate: nothing is written to the old site', writes.every((w) => !String(w.query).includes(S1) && [].concat(w.body || []).every((b) => !b || typeof b !== 'object' || !('site_id' in b) || b.site_id !== S1)));
  const rec = recordOf(NEW);
  ok('record: the copy is recorded on the new site — every section with words or photos printed, and the two copies', rec && rec.from === 'Bistro Nine' && rec.kept === false && rec.sections.length === 4 && rec.media.length === 2 && rec.media.includes(room.id));
  ok('record: the history says where the pages came from, on the new site only', T.presence_change_events.some((e) => e.site_id === NEW && e.summary === 'Copied the pages and sections from Bistro Nine'));

  // ── the publish item ──
  let dr = await draftOf(NEW);
  let blk = await copiedBlockerFor(NEW, dr.snapshot.content, dr.mediaManifest);
  ok('publish: right after the copy, one thing to finish lists the untouched sections and photos', !!blk && /4 sections \(Home: About, Our room, Hours; Team: Our team\) and 2 photos/.test(blk.message));
  settingsOf(NEW).blocks[0] = { ...settingsOf(NEW).blocks[0], body: 'Welcome to Bistro Twelve, new on Main Street.' };
  settingsOf(NEW).blocks[1] = { ...settingsOf(NEW).blocks[1], look: { bg: 'dark' } };
  dr = await draftOf(NEW);
  blk = await copiedBlockerFor(NEW, dr.snapshot.content, dr.mediaManifest);
  ok('publish: rewriting a section clears it; restyling one doesn\'t', /3 sections \(Home: Our room, Hours; Team: Our team\) and 2 photos/.test(blk.message));
  const ro = await call(asMember({ member_id: RO, role: 'readonly', email: 'ro@studio.example' }), 'POST', `/agency/sites/${NEW}/copied`, { keep: true });
  ok('keep: a view-only member can\'t keep them', ro.status === 403);
  ok('keep: it has to say keep', (await call(asMember(), 'POST', `/agency/sites/${NEW}/copied`, { keep: 'yes' })).status === 400);
  ok('keep: a site that had nothing copied says so, and nothing is written', (await call(asMember(), 'POST', `/agency/sites/${NEW2}/copied`, { keep: true })).status === 404 && !T.presence_sales_templates.some((t) => t.site_id === NEW2));
  const kept = await call(asMember(), 'POST', `/agency/sites/${NEW}/copied`, { keep: true });
  ok('keep: 200, the record says kept, and its history says so', kept.status === 200 && kept.body.data.copied.kept === true && recordOf(NEW).kept === true && T.presence_change_events.some((e) => e.site_id === NEW && /^Kept the words and photos copied from Bistro Nine as they are$/.test(e.summary)));
  dr = await draftOf(NEW);
  ok('publish: once kept, nothing is held back', (await copiedBlockerFor(NEW, dr.snapshot.content, dr.mediaManifest)) === null);
  const list = await call(asMember(), 'GET', '/agency/sites');
  const card = (list.body.data || []).find((x) => x.site_id === NEW);
  ok('Sites: the card knows it was started from Bistro Nine, and that it was kept; others carry nothing', card && JSON.stringify(card.copied) === JSON.stringify({ from: 'Bistro Nine', kept: true }) && (list.body.data || []).find((x) => x.site_id === NEW2).copied === null);
}

// ── fill-only-empty: a site with its own pages keeps them ──
{
  reset();
  const d = await call(asMember(), 'POST', `/agency/sites/${S1}/duplicate`, { site_id: BUSY });
  ok('duplicate onto a site with its own sections: they stay, and the answer says the pages were left out', d.status === 200 && d.body.data.pages === null && d.body.data.skipped.includes('pages and sections (this site already has its own)') && settingsOf(BUSY).blocks.length === 1 && settingsOf(BUSY).blocks[0].body === 'Already here.');
  ok('…and nothing was copied or recorded', copies.length === 0 && !recordOf(BUSY) && !T.presence_media.some((m) => m.site_id === BUSY));
}

// ── Save as a template, then start a site from it ──
{
  reset();
  const saved = await call(asMember(), 'POST', '/agency/kits', { site_id: S1, name: 'Bistro', with_pages: true });
  const kit = T.presence_starter_kits[0];
  ok('template: saved with its pages, and the answer says how much', saved.status === 200 && saved.body.data.kind === 'template' && JSON.stringify(saved.body.data.summary) === JSON.stringify({ pages: 1, sections: 5, photos: 2 }) && kit.payload.layout?.settings?.blocks?.length === 4);
  ok('template: its photos are copied into the studio\'s template folder now, so it outlives the site it came from', copies.length === 2 && copies.every((c) => c.destinationKey.startsWith(`templates/${AG}/`)) && kit.payload.layout.media.every((m) => m.storage_path.startsWith(`presence-media/templates/${AG}/`)));
  ok('template: nothing lands on any site when it\'s saved', !T.presence_media.some((m) => m.site_id !== S1) && !writes.some((w) => w.table === 'presence_settings'));
  const plain = await call(asMember(), 'POST', '/agency/kits', { site_id: S1, name: 'Just the setup' });
  ok('a starter kit saved the old way stays a kit (no pages, no photos)', plain.body.data.kind === 'kit' && !T.presence_starter_kits[1].payload.layout);
  T.presence_starter_kits.forEach((k, i) => { k.agency_id = AG; k.id = i ? 'abcdabcd-abcd-4bcd-8bcd-abcdabcdab02' : 'abcdabcd-abcd-4bcd-8bcd-abcdabcdab01'; });
  const kits = await call(asMember(), 'GET', '/agency/kits');
  ok('kits list: says which is a template and what it carries, without sending the pages', kits.status === 200 && kits.body.data.find((k) => k.name === 'Bistro').kind === 'template' && kits.body.data.find((k) => k.name === 'Bistro').summary.sections === 5 && kits.body.data.find((k) => k.name === 'Just the setup').kind === 'kit' && kits.body.data.every((k) => !('payload' in k)));
  copies = []; writes = [];
  const applied = await call(asMember(), 'POST', '/agency/kits/abcdabcd-abcd-4bcd-8bcd-abcdabcdab01/apply', { site_id: NEW2 });
  const ns = settingsOf(NEW2);
  ok('template → new site: the pages land, with the template\'s name for the business swapped for this one', applied.status === 200 && applied.body.data.layout?.applied === true && ns.blocks?.[0]?.body === 'Welcome to Cafe Thirteen, on the corner since 1999.' && ns.pages?.[0]?.title === 'Team');
  ok('template → new site: photos copied from the template\'s folder into the site\'s own', copies.length === 2 && copies.every((c) => c.sourceKey.startsWith(`templates/${AG}/`) && c.destinationKey.startsWith(`${NEW2}/`)) && T.presence_media.filter((m) => m.site_id === NEW2).every((m) => m.metadata.copied_from === 'your “Bistro” template'));
  ok('template → new site: the look, and a record named for the template', T.presence_sites.find((s) => s.id === NEW2).template_slug === 'business-classic' && recordOf(NEW2)?.from === 'your “Bistro” template' && T.presence_change_events.some((e) => e.site_id === NEW2 && e.summary === 'Applied the “Bistro” template'));
}

// ═══ 3. the wiring ═══
{
  const room = read('supabase/functions/presence/routes/room.ts'), pub = read('supabase/functions/presence/routes/publish.ts');
  const wired = (src) => /const copied = await copiedBlockerFor\(site\.id, snapshot\.content, mediaManifest\);\s*if \(copied\) \{ v\.blockers\.push\(copied\); v\.ok = false; \}/.test(src);
  ok('publish list and publish gate both ask, so the editor\'s "things to finish" and a refused publish agree', wired(room) && wired(pub) && /const \[\{ snapshot, mediaManifest \}, lastLiveQ, lastAnyQ\]/.test(room));
  ok('a reserved name, so the templates list never shows the record', RESERVED_NAMES.copiedFrom === '__copied_from__');
  const kits = read('supabase/functions/presence/lib/kits.ts');
  ok('the kits law says why a template is the one kit that carries words and photos', /Builder list item 145 adds one exception to law 1, on purpose/.test(kits));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
