// ── What a checked save costs in reads of the draft (Nov 2026) ───────────────
// PR 127 answers each write that moves the draft with the version it left. It read the
// whole draft twice for that: 11 reads before the write, for the check that refuses a
// stale version, and the same 11 again after it, for the answer. A restore read it three
// times and accepting a writing proposal four. Now the read after a write takes the
// tables the request wrote (lib/db.ts) and reads only those again, and a restore's safety
// copy and a proposal's starting point use the read the check already made.
//
// This suite drives the REAL function: index.ts, every gate, the real handlers, against
// a stubbed PostgREST (std's serve() is handed a fake listener, as in
// scoped_commerce_test). Per request it pins:
//   · the whole draft is read once, then only what the write moved, and hashed twice
//   · the version answered is the one a fresh read of the whole draft gives
//   · a stale version is refused after one read; a write naming none reads nothing
//   · a template switch names the new template's version (the next save was refused)
//   · another instance's change to a part the save didn't touch isn't taken into the
//     version, so the caller's next save is checked against it
//   · every PostgREST call in the function goes through lib/db.ts, so no write is missed
//
//   deno run --allow-read --allow-env --allow-net tests/presence/draft_version_reads_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'SERVICE-KEY');
Deno.env.set('SUPABASE_ANON_KEY', 'ANON-KEY');
Deno.env.delete('RESEND_API_KEY');
Deno.env.delete('OPS_ALERT_EMAIL');

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const hex = (k, i) => `${k}${i.toString(16).padStart(7, '0')}-0000-4000-8000-000000000000`;
const SITE = uuid('a');
const OWNER = { id: uuid('3'), email: 'owner@example.com' };
const site = { id: SITE, client_id: 'client-a', status: 'draft', last_published_at: null, template_slug: 'restaurant-classic', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence' };
const LIB = hex(6, 1), PUB = hex(9, 1), SNAP = hex(9, 2), CHECKPOINT = hex(9, 3), PROPOSAL = hex(9, 4);
const MEDIA = [0, 1, 2].map((i) => hex(1, i));
const OFFER = [0, 1, 2].map((i) => hex(2, i));

/* ── a small draft that touches every part the version covers ── */
let T, calls, onWrite;
function reset() {
  T = {
    presence_sites: [{ ...site }],
    presence_entitlements: [{ client_id: 'client-a', product: 'presence', plan: 'presence', status: 'active' }],
    clients: [{ id: 'row-a', email: OWNER.email, tenant_id: 'tenant-1', name: 'Account' }],
    contacts: [], memberships: [], presence_site_members: [],
    presence_identity: [{ site_id: SITE, business_name: 'Sample Cafe', tagline: 'Good food', description: 'A neighbourhood cafe.', phone: '', email: '', story: '', service_area: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '' }],
    presence_locations: [{ id: hex(7, 1), site_id: SITE, address_line1: '1 Main St', city: 'Town', region: 'CA', postal_code: '90000', country: 'US', hours: [], holiday_exceptions: [], temporarily_closed: false, created_at: '2026-01-01T00:00:00Z' }],
    presence_offerings: OFFER.map((id, i) => ({ id, site_id: SITE, name: `Dish ${i}`, category: 'Mains', description: '', price_text: '$9', media_id: MEDIA[i], is_visible: true, sort_order: i, deleted_at: null, created_at: '2026-01-01T00:00:00Z' })),
    presence_testimonials: [{ id: hex(3, 1), site_id: SITE, quote: 'Lovely', author: 'Sam', source: '', is_visible: true, sort_order: 0, deleted_at: null }],
    presence_faqs: [{ id: hex(4, 1), site_id: SITE, question: 'Parking?', answer: 'Yes', is_visible: true, sort_order: 0, deleted_at: null }],
    presence_posts: [{ id: hex(5, 1), site_id: SITE, title: 'News', slug: 'news', body_md: 'Hello', excerpt: '', hero_media_id: MEDIA[1], status: 'published', published_at: '2026-02-01T00:00:00Z', noindex: false, tags: [], deleted_at: null }],
    presence_media: MEDIA.map((id, i) => ({ id, site_id: SITE, storage_path: `${SITE}/photo-${i}.jpg`, alt_text: `Photo ${i}`, mime: 'image/jpeg', width: 1600, height: 1000, focal_x: null, focal_y: null, deleted_at: null })),
    presence_redirects: [],
    presence_settings: [{ site_id: SITE, category_order: [], announcement_text: 'Open late', nav: null,
      blocks: [{ id: 'hero-1', type: 'hero', title: 'Welcome', media_id: MEDIA[0] }, { type: 'linked', ref: LIB }, { id: 'text-1', type: 'richtext', body: 'We cook.' }],
      pages: [{ slug: 'menu', title: 'Menu', blocks: [{ type: 'linked', ref: LIB }] }, { slug: 'about', title: 'About', blocks: [{ type: 'richtext', body: 'Since 2010.' }] }] }],
    presence_dev_customizations: [],
    presence_reviews: [{ site_id: SITE, reviewer_name: 'Ann', rating: 5, body: 'Great', owner_reply: '', status: 'approved', approved_at: '2026-03-01T00:00:00Z', created_at: '2026-03-01T00:00:00Z' }],
    presence_content_library: [{ id: LIB, site_id: SITE, name: 'Opening hours', kind: 'section', payload: { type: 'richtext', body: 'Open every day.' } }],
    presence_change_events: [], presence_publishes: [], presence_snapshots: [], presence_launches: [], presence_ai_drafts: [],
  };
  calls = []; onWrite = null;
}

function listOf(v) { return v.slice(v.indexOf('(') + 1, -1).split(',').map((s) => s.replace(/^"|"$/g, '')); }
function matches(row, params) {
  for (const [k, v] of params.entries()) {
    if (['select', 'limit', 'order', 'on_conflict', 'offset', 'or'].includes(k)) continue;
    if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false;
    if (v.startsWith('in.') && !listOf(v).includes(String(row[k]))) return false;
    if (v === 'is.null' && row[k] != null) return false;
    if (v === 'not.is.null' && row[k] == null) return false;
    if (v === 'is.true' && row[k] !== true) return false;
  }
  return true;
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const headers = new Headers(init.headers);
  const reply = (body, status = 200) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const token = (headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (u.pathname === '/auth/v1/user') return token === 'jwt-owner' ? reply(OWNER) : reply({}, 401);
  if (!u.pathname.startsWith('/rest/v1/')) return new Response('', { status: 404 });
  const table = u.pathname.replace('/rest/v1/', '');
  const method = (init.method || 'GET').toUpperCase();
  const role = token === 'SERVICE-KEY' ? 'service' : 'user';
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ table, method, query: decodeURIComponent(u.search).replace(/^\?/, '') });
  if (method !== 'GET' && onWrite) { const f = onWrite; onWrite = null; f(); }
  const visible = (r) => role === 'service' || (table === 'presence_sites' ? r.id : r.site_id) === SITE;
  const rows = () => (T[table] ||= []).filter((r) => visible(r) && matches(r, u.searchParams));
  if (method === 'GET') { const lim = Number(u.searchParams.get('limit')); const r = rows(); return reply(lim ? r.slice(0, lim) : r); }
  if (method === 'PATCH') { const hit = rows(); hit.forEach((r) => Object.assign(r, body)); return reply(hit); }
  if (method === 'DELETE') { T[table] = (T[table] ||= []).filter((r) => !(visible(r) && matches(r, u.searchParams))); return reply([]); }
  if (method === 'POST') {
    const conflict = u.searchParams.get('on_conflict');
    const prefer = headers.get('Prefer') || '';
    let row = conflict && prefer.includes('merge-duplicates') ? (T[table] ||= []).find((r) => conflict.split(',').every((c) => r[c] === body[c])) : null;
    if (row) Object.assign(row, body); else { row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...body }; (T[table] ||= []).push(row); }
    return prefer.includes('return=representation') ? reply([row], 201) : reply(null, 201);
  }
  return reply([]);
};

// a whole-draft hash: the canonical draft material starts with its sorted first key
const hashes = { n: 0 };
const digest = crypto.subtle.digest.bind(crypto.subtle);
const DRAFT_TEXT = new TextEncoder().encode('{"content":{');
crypto.subtle.digest = (alg, data) => {
  const head = new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, Math.min(DRAFT_TEXT.length, data.byteLength));
  if (head.every((b, i) => b === DRAFT_TEXT[i])) hashes.n++;
  return digest(alg, data);
};

/* ── the real index.ts, with std's serve() handed a fake listener: no socket opens ── */
const queue = []; let wake = null;
Deno.listen = () => { let first = true; return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} }; };
Deno.serveHttp = () => ({ nextRequest: () => new Promise((res) => { if (queue.length) res(queue.shift()); else wake = res; }), close() {} });
await import('../../supabase/functions/presence/index.ts');
const { draftHashForSite, readDraft, draftTablesMoved } = await import('../../supabase/functions/presence/lib/draft_hash.ts');
const { draftAsFound, noteDraftBefore } = await import('../../supabase/functions/presence/lib/optimistic_lock.ts');
const { svc, asUser, writeMark, writtenSince } = await import('../../supabase/functions/presence/lib/db.ts');
const { serializeDraft } = await import('../../supabase/functions/presence/lib/serializer.ts');
const { getTemplate } = await import('../../supabase/functions/presence/lib/render.ts');

function send(request) {
  return new Promise((resolve) => { const ev = { request, respondWith: async (r) => { resolve(await r); } }; if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev); });
}
async function call(method, route, body, version) {
  const headers = { 'Content-Type': 'application/json', 'x-dds-user-jwt': 'jwt-owner', ...(version ? { 'If-Match': `"${version}"` } : {}) };
  const res = await send(new Request(`http://stub.local/functions/v1/presence${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, version: res.headers.get('X-Draft-Version'), text: await res.text() };
}

// The serializer's reads, by table: exactly these queries are a read of the draft.
const DRAFT_READ = {
  presence_identity: /^site_id=eq\.[^&]+&limit=1$/,
  presence_locations: /^site_id=eq\.[^&]+&order=created_at\.asc$/,
  presence_offerings: /^site_id=eq\.[^&]+&deleted_at=is\.null&is_visible=is\.true&order=sort_order\.asc,created_at\.asc$/,
  presence_testimonials: /^site_id=eq\.[^&]+&deleted_at=is\.null&is_visible=is\.true&order=sort_order\.asc,created_at\.asc$/,
  presence_faqs: /^site_id=eq\.[^&]+&deleted_at=is\.null&is_visible=is\.true&order=sort_order\.asc,created_at\.asc$/,
  presence_posts: /^site_id=eq\.[^&]+&deleted_at=is\.null&status=eq\.published&order=published_at\.desc$/,
  presence_media: /^site_id=eq\.[^&]+&deleted_at=is\.null&id=in\.\([^)]*\)&select=id,storage_path,alt_text,mime,width,height,focal_x,focal_y$/,   // item 208: by id
  presence_redirects: /^site_id=eq\.[^&]+&order=from_path\.asc&select=from_path,to_path$/,
  presence_settings: /^site_id=eq\.[^&]+&limit=1$/,
  presence_dev_customizations: /^site_id=eq\.[^&]+&select=theme_tokens,custom_css,custom_html&limit=1$/,
  presence_reviews: /^site_id=eq\.[^&]+&status=eq\.approved&order=approved_at\.desc,created_at\.desc&select=[^&]+&limit=500$/,
  presence_content_library: /^site_id=eq\.[^&]+&id=in\.\([^)]+\)&select=id,payload$/,
};
const TABLES = Object.keys(DRAFT_READ);
const draftReadsIn = (cs) => Object.fromEntries(TABLES.map((t) => [t, cs.filter((c) => c.method === 'GET' && c.table === t && DRAFT_READ[t].test(c.query)).length]));
const liveSite = () => { const s = T.presence_sites[0]; return { ...site, template_slug: s.template_slug, template_version: s.template_version }; };
const total = (r) => Object.values(r).reduce((a, b) => a + b, 0);
// how many times each table was read beyond once, e.g. { presence_settings: 1 }
const extra = (r) => Object.fromEntries(Object.entries(r).filter(([, n]) => n !== 1).map(([t, n]) => [t.replace('presence_', ''), n - 1]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** One request, measured: the version the draft had, the reads and hashes it took, and
 *  the version a fresh read of the whole draft gives once it's done. */
async function measured(fn) {
  const before = await draftHashForSite(liveSite());
  calls = []; hashes.n = 0;
  const r = await fn(before);
  const seen = calls.slice(), nHashes = hashes.n;
  const after = await draftHashForSite(liveSite());
  return { ...r, before, after, reads: draftReadsIn(seen), hashes: nHashes, writes: seen.filter((c) => c.method !== 'GET').map((c) => c.table) };
}

// ═══ 1. a section save: the whole draft once, then the settings row and what links into it ═══
{
  reset();
  const r = await measured((v) => call('PUT', '/settings', { announcement_text: 'Closed Monday' }, v));
  ok('section save: saved, and answered with a version', r.status === 200 && !!r.version, `${r.status} ${r.text.slice(0, 120)}`);
  ok('section save: the version answered is the one a fresh read of the whole draft gives', r.version === r.after && r.after !== r.before);
  ok('section save: the whole draft is read once, then only the settings row and the library rows its sections link to (was every table twice)',
    same(extra(r.reads), { settings: 1, content_library: 1 }), JSON.stringify(r.reads));
  ok('section save: 14 reads of the draft (was 24 with this draft\'s library read)', total(r.reads) === 14, String(total(r.reads)));
  ok('section save: hashed twice, once each side of the write', r.hashes === 2, String(r.hashes));
}

// ═══ 2. other checked saves read again only what they wrote ═══
for (const [label, method, route, body, moved] of [
  ['business details', 'PUT', '/identity', { tagline: 'Better food' }, { identity: 1 }],
  ['a menu item', 'PATCH', `/offerings/${OFFER[1]}`, { name: 'Dish one, renamed' }, { offerings: 1 }],
  ['a page duplicated', 'POST', '/pages/duplicate', { slug: 'about' }, { settings: 1, content_library: 1 }],
  ['a forward (a route the check doesn\'t refuse)', 'POST', '/redirects', { from_path: '/old/', to_path: '/menu/' }, { redirects: 1 }],
  ['a photo description: menu items and updates show photos too', 'PUT', `/media/${MEDIA[2]}`, { alt_text: 'A plate of food' }, { offerings: 1, posts: 1, media: 1 }],
  ['a saved section that two pages link to', 'PUT', `/content-library/${LIB}`, { block: { type: 'richtext', body: 'Open every day but Monday.' } }, { content_library: 1 }],
  ['a page renamed: its forward is in the draft', 'PUT', '/settings', { pages: [{ slug: 'food', title: 'Menu', prev_slug: 'menu', blocks: [{ type: 'linked', ref: LIB }] }, { slug: 'about', title: 'About', blocks: [] }] }, { redirects: 1, settings: 1, content_library: 1 }],
]) {
  reset();
  const r = await measured((v) => call(method, route, body, v));
  ok(`${label}: saved, with the version a fresh read gives`, r.status < 300 && r.version === r.after && r.after !== r.before, `${r.status} ${r.text.slice(0, 120)}`);
  ok(`${label}: the whole draft once, then only ${Object.keys(moved).join(', ')} again`, same(extra(r.reads), moved), JSON.stringify(extra(r.reads)));
  ok(`${label}: hashed twice`, r.hashes === 2, String(r.hashes));
}

// ═══ 3. a stale version: one read, refused, nothing written; no version: no read ═══
{
  reset();
  const r = await measured(() => call('PUT', '/settings', { announcement_text: 'Over theirs' }, 'deadbeef'));
  ok('stale: refused as stale_draft', r.status === 409 && JSON.parse(r.text).error === 'stale_draft');
  ok('stale: the draft read once, hashed once, nothing written to it', total(r.reads) === TABLES.length && Object.values(r.reads).every((n) => n === 1) && r.hashes === 1 && !r.writes.some((t) => TABLES.includes(t)), JSON.stringify({ reads: r.reads, writes: r.writes }));
  reset();
  const n = await measured(() => call('PUT', '/settings', { announcement_text: 'No version named' }));
  ok('no version: saved as it always was, naming none', n.status === 200 && n.version === null);
  ok('no version: the draft isn\'t read or hashed at all', total(n.reads) === 0 && n.hashes === 0, JSON.stringify(n.reads));
}

// ═══ 4. a template switch names the new template's version ═══
{
  reset();
  const r = await measured((v) => call('PUT', '/site/template', { slug: 'business-classic' }, v));
  ok('template: switched', r.status === 200 && T.presence_sites[0].template_slug === 'business-classic', r.text.slice(0, 120));
  ok('template: the version answered is the new template\'s (it used to name the old one\'s)', r.version === r.after && r.after !== r.before);
  ok('template: the rows aren\'t read again, only which template the site is on', total(r.reads) === TABLES.length && calls.filter((c) => c.table === 'presence_sites' && c.query.includes('select=template_slug,template_version')).length === 1, JSON.stringify(r.reads));
  const next = await call('PUT', '/settings', { announcement_text: 'After the switch' }, r.version);
  ok('template: the next save, naming that version, goes through (it was refused as someone else\'s change)', next.status === 200, `${next.status} ${next.text.slice(0, 120)}`);
}

// ═══ 5. restoring a version, a checkpoint, a writing proposal: the draft is read once ═══
async function keptVersion() {
  const t = getTemplate(site.template_slug, site.template_version);
  const { snapshot, mediaManifest } = await serializeDraft(SITE, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now: '2026-11-01T00:00:00Z' });
  T.presence_snapshots.push({ id: SNAP, site_id: SITE, content: snapshot.content, media_manifest: mediaManifest, content_contract_version: snapshot.content_contract_version, template_slug: site.template_slug, template_version: site.template_version, dev_customization: null });
  T.presence_publishes.push({ id: PUB, site_id: SITE, snapshot_id: SNAP, status: 'live', created_at: '2026-11-01T00:00:00Z' });
  T.presence_launches.push({ id: CHECKPOINT, site_id: SITE, status: 'checkpoint', name: 'Before the menu change', snapshot_id: SNAP });
  T.presence_ai_drafts.push({ id: PROPOSAL, site_id: SITE, status: 'proposed', kind: 'identity_copy', prompt_summary: 'A new tagline', options: [{ payload: { identity: { tagline: 'Proposed tagline' } } }] });
  T.presence_identity[0].tagline = 'Changed since';   // so bringing the version back changes the draft
}
const fullReads = (r) => Math.min(...TABLES.filter((t) => t !== 'presence_content_library').map((t) => r.reads[t]));
for (const [label, route, body, was] of [
  ['restore a published version', '/restore-to-draft', { publish_id: PUB }, 3],
  ['restore a checkpoint', `/publishes/checkpoints/${CHECKPOINT}/restore`, {}, 3],
  ['accept a writing proposal', `/writer/drafts/${PROPOSAL}/accept`, { option: 0 }, 4],
]) {
  reset(); await keptVersion();
  const safety = T.presence_snapshots.length;
  const r = await measured((v) => call('POST', route, body, v));
  ok(`${label}: done, with the version a fresh read gives`, r.status === 200 && r.version === r.after && r.after !== r.before, `${r.status} ${r.text.slice(0, 120)}`);
  ok(`${label}: the whole draft read once (was ${was} times): the safety copy uses the check's read`, fullReads(r) === 1, JSON.stringify(r.reads));
  const copy = T.presence_snapshots[safety];
  ok(`${label}: the safety copy is the draft as it was`, T.presence_snapshots.length === safety + 1 && copy?.content?.identity?.tagline === 'Changed since');
}

// ═══ 6. another instance's change, mid-save, to a part the save didn't touch ═══
{
  reset();
  const r = await measured((v) => { onWrite = () => { T.presence_identity[0].tagline = 'Their change'; }; return call('PUT', '/settings', { announcement_text: 'Mine' }, v); });
  ok('alongside: the save lands, and its version leaves out the change it never loaded', r.status === 200 && r.version && r.version !== r.after);
  const next = await call('PUT', '/identity', { tagline: 'Mine, over theirs' }, r.version);
  ok('alongside: so the next save is checked against that change and refused (a read of the whole draft let it through)', next.status === 409 && T.presence_identity[0].tagline === 'Their change', `${next.status}`);
}

// ═══ 7. the parts, without the router ═══
{
  ok('moved: a settings write moves the settings', same([...draftTablesMoved(['presence_settings', 'presence_change_events'])], ['presence_settings']));
  ok('moved: a photo write moves menu items and updates too (0016 clears them on delete)', same([...draftTablesMoved(['presence_media'])].sort(), ['presence_media', 'presence_offerings', 'presence_posts']));
  ok('moved: the site row is followed, for its template', draftTablesMoved(['presence_sites']).has('presence_sites'));
  ok('moved: writes outside the draft move none of it', draftTablesMoved(['presence_change_events', 'presence_snapshots']).size === 0);
  ok('moved: a database function can\'t be placed, so it moves all of it', draftTablesMoved(['presence_settings', 'rpc/anything']) === null);

  reset();
  const first = await readDraft(site);
  calls = [];
  const unmoved = await readDraft(site, first, ['presence_change_events']);
  ok('readDraft: nothing moved → the same read back, no reads', unmoved === first && calls.length === 0);
  calls = [];
  const all = await readDraft(site, first, ['rpc/anything']);
  ok('readDraft: a write it can\'t place → the whole draft again', fullReads({ reads: draftReadsIn(calls) }) === 1 && all.hash === first.hash);

  const mark = writeMark();
  await svc(`presence_faqs?id=eq.${hex(4, 1)}&site_id=eq.${SITE}`, { method: 'PATCH', body: JSON.stringify({ answer: 'No' }) });
  await asUser('jwt-owner', 'presence_testimonials?select=id', { method: 'POST', body: JSON.stringify({ site_id: SITE, quote: 'x', author: 'y' }) });
  await svc(`presence_identity?site_id=eq.${SITE}&limit=1`);
  ok('ledger: writes through svc and asUser are counted by table; reads aren\'t', same([...writtenSince(mark)].sort(), ['presence_faqs', 'presence_testimonials']));

  const req = new Request('http://stub.local/functions/v1/presence/restore-to-draft', { method: 'POST', headers: { 'If-Match': '"v"' } });
  ok('as found: nothing for a request that named no version', await draftAsFound(new Request('http://stub.local/x', { method: 'POST' })) === null);
  await noteDraftBefore(req, '/restore-to-draft', site);
  const found = await draftAsFound(req);
  ok('as found: the check\'s read, while nothing has written the draft', !!found && found.hash === await draftHashForSite(site));
  await svc(`presence_faqs?id=eq.${hex(4, 1)}&site_id=eq.${SITE}`, { method: 'PATCH', body: JSON.stringify({ answer: 'Yes' }) });
  ok('as found: nothing once the draft has been written since', await draftAsFound(req) === null);
}

// ═══ 8. the ledger sees every write: all PostgREST calls go through lib/db.ts ═══
{
  const files = [];
  const walk = (dir) => { for (const e of Deno.readDirSync(new URL(dir, ROOT))) { const p = `${dir}/${e.name}`; if (e.isDirectory) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
  walk('supabase/functions/presence');
  const outside = files.filter((p) => p !== 'supabase/functions/presence/lib/db.ts').flatMap((p) => read(p).split('\n').map((l, i) => ({ p, i: i + 1, l })))
    .filter(({ l }) => /rest\/v1\/[a-z]/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/developers\.google\.com/.test(l));
  ok('ledger: the only PostgREST address built outside lib/db.ts is the error ledger\'s', outside.length === 1 && outside[0].p.endsWith('presence/index.ts') && /rest\/v1\/ops_errors/.test(outside[0].l), outside.map((o) => `${o.p}:${o.i}`).join(', '));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ DRAFT READS PER CHECKED SAVE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
