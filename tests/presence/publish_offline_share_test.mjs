// ── Taking a site offline, bringing it back, and sharing a draft (G5, G6, G10) ──
// Builder item 212 rewrote this suite from text checks to the code running. It proves:
//   · the holding page and its four files, the schedule kinds, the status shape and the signed
//     share token (mint, check, expiry, tampering): pure, as before
//   · Take offline (routes/publish.ts) puts the holding page up on the site's own host through
//     the one deploy, deletes nothing, marks the site and writes its history; it refuses while a
//     publish is in flight, before the first publish, after a failed deploy and before migration
//     0111; a paused site is platform staff's to take offline, not its owner's
//   · Bring back online puts the last live version back up through the one publish pipeline and
//     clears the mark; any publish that goes live clears it too, and a failed one leaves it
//   · Scheduling offline (routes/commercial.ts) freezes no snapshot, and the cron
//     (ops/scheduler.ts) fires it through the same take-offline core, drawing the page then
//   · Share a draft link (routes/preview_env.ts) captures the draft into the one preview slot
//     and signs a link that opens that site's draft only, until it expires
//   · the routes through the real router (index.ts): signed in or public, and the site always
//     comes from the sign-in, never the request
//   · two studios side by side: one studio's call never reads or changes the other's rows
//   · migration 0111 and its APPLY pack (no database here, so the SQL is the contract)
// The database is the in-memory PostgREST (fake_pgrst.mjs); the host (Netlify) is stubbed below.
//   deno run --allow-read --allow-env --allow-net tests/presence/publish_offline_share_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';

Deno.env.set('NETLIFY_AUTH_TOKEN', 'nf-test-token');
Deno.env.set('PREVIEW_LINK_SECRET', 'preview-secret-0111');
Deno.env.set('SCHEDULER_SECRET', 'cron-secret-0111');
Deno.env.set('APP_URL', 'https://app.example.test');
for (const k of ['APPROVAL_SECRET', 'STATE_SIGNING_SECRET', 'RESEND_API_KEY', 'OPS_ALERT_EMAIL', 'MAX_CONCURRENT_DEPLOYS', 'DEPLOY_POLL_MS']) Deno.env.delete(k);

const SITE_A = '11111111-1111-4111-8111-111111111111';   // the studio under test
const SITE_B = '22222222-2222-4222-8222-222222222222';   // another studio, live beside it
const SITE_C = '33333333-3333-4333-8333-333333333333';   // a third, never published
const U = { [SITE_A]: 'aaaaaaaa-0000-4000-8000-00000000000a', [SITE_B]: 'bbbbbbbb-0000-4000-8000-00000000000b', [SITE_C]: 'cccccccc-0000-4000-8000-00000000000c' };
const BIZ = {
  [SITE_A]: { name: 'Alpha Bakery', email: 'hello@alpha-bakery.example', owner: 'owner@alpha-bakery.example', phone: '(818) 555-0100', primary: '#0a7d5c', client: 'client-a', nf: 'nf-alpha', jwt: 'jwt-alpha' },
  [SITE_B]: { name: 'Bravo Florist', email: 'hello@bravo-florist.example', owner: 'owner@bravo-florist.example', phone: '(818) 555-0177', primary: '#7a2e8c', client: 'client-b', nf: 'nf-bravo', jwt: 'jwt-bravo' },
  [SITE_C]: { name: 'Charlie Cafe', email: 'hello@charlie-cafe.example', owner: 'owner@charlie-cafe.example', phone: '(818) 555-0142', primary: '#1f4e8c', client: 'client-c', nf: 'nf-charlie', jwt: 'jwt-charlie' },
};
// another studio's rows come first in every table, so a read that lost its site filter answers with theirs
const ORDER = [SITE_B, SITE_C, SITE_A];
const users = {}, ownSite = {};
for (const id of ORDER) { users[BIZ[id].jwt] = { id: U[id], email: BIZ[id].owner }; ownSite[BIZ[id].jwt] = id; }
const db = installFakePostgrest({ users, ownSite });

// ── the host (Netlify), stubbed: deploys by digest, uploads, the deploy visitors see ──
const sha1 =async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let host;
const hostSite = (id) => (host.sites[id] ||= { live: null, has: new Set() });
function newHost(from) {
  host = { sites: {}, deploys: from ? [...from.deploys] : [], uploads: [], calls: [], failCreate: new Set(), next: from ? from.next : 1 };
  if (from) for (const [id, s] of Object.entries(from.sites)) host.sites[id] = { live: s.live, has: new Set(s.has) };
}
newHost();
async function netlify(u, init) {
  const method = (init.method || 'GET').toUpperCase();
  const p = u.pathname.replace('/api/v1', '');
  host.calls.push({ method, path: p });
  let m;
  if (method === 'GET' && (m = /^\/sites\/([^/]+)$/.exec(p))) {
    const id = decodeURIComponent(m[1]), s = hostSite(id);
    return reply({ id, name: id, default_domain: `${id}.netlify.app`, state: 'current', published_deploy: s.live ? { id: s.live } : null });
  }
  if (method === 'POST' && (m = /^\/sites\/([^/]+)\/deploys$/.exec(p))) {
    const site = decodeURIComponent(m[1]);
    if (host.failCreate.has(site)) return reply({ message: 'the host is down' }, 500);
    const b = JSON.parse(String(init.body)), s = hostSite(site), id = `dep-${host.next++}`;
    host.deploys.push({ id, site, files: b.files, title: b.title });
    return reply({ id, required: [...new Set(Object.values(b.files))].filter((d) => !s.has.has(d)) });
  }
  if (method === 'PUT' && (m = /^\/deploys\/([^/]+)\/files(\/.*)$/.exec(p))) {
    const dep = host.deploys.find((d) => d.id === m[1]);
    const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
    hostSite(dep.site).has.add(await sha1(bytes));
    host.uploads.push({ deploy: dep.id, site: dep.site, path: decodeURIComponent(m[2]), text: new TextDecoder().decode(bytes) });
    return reply({});
  }
  if (method === 'GET' && (m = /^\/deploys\/([^/]+)$/.exec(p))) {
    const dep = host.deploys.find((d) => d.id === m[1]);
    if (dep) hostSite(dep.site).live = dep.id;   // ready: visitors now get this deploy
    return reply({ id: m[1], state: 'ready' });
  }
  return reply({ message: 'no such host route' }, 404);
}

// ── the database: the shared fake, plus what this suite needs around it ──
//   · seen: the site of every row a read answered (an unfiltered read would show another studio's)
//   · the column defaults the fake doesn't know: a scheduled row starts pending and unfired, and a
//     kept version is stamped when it is written (the privacy page prints that day, so a version
//     put back up must carry the day it was drawn, as the database's now() gives it)
//   · dbHook: one test's stand-in for a database answer (a column before its migration)
const pg = globalThis.fetch;
const seen = [];
let dbHook = null;
const siteKey = (table, row) => (table === 'presence_sites' ? row.id : row.site_id);
const DEFAULTS = {
  presence_scheduled_publishes: () => ({ status: 'pending', fired_at: null, last_error: null }),
  presence_snapshots: () => ({ created_at: new Date().toISOString() }),
};
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'api.netlify.com') return netlify(u, init);
  const method = (init.method || 'GET').toUpperCase();
  const table = u.pathname.startsWith('/rest/v1/') ? u.pathname.slice('/rest/v1/'.length) : '';
  if (dbHook) { const r = dbHook(table, method, decodeURIComponent(u.search)); if (r) return r; }
  if (DEFAULTS[table] && method === 'POST') {
    const b = JSON.parse(String(init.body));
    init = { ...init, body: JSON.stringify(Array.isArray(b) ? b.map((x) => ({ ...DEFAULTS[table](), ...x })) : { ...DEFAULTS[table](), ...b }) };
  }
  const res = await pg(url, init);
  if (table && method === 'GET' && res.ok) {
    try { const rows = await res.clone().json(); if (Array.isArray(rows)) for (const r of rows) seen.push({ table, site: siteKey(table, r) }); } catch { /* not rows */ }
  }
  return res;
};

// ── the code under test ──
const P = '../../supabase/functions/presence';
const OP = await import(`${P}/lib/offline_page.ts`);
const { renderOfflinePage, offlineFileMap } = OP;
const CM = await import(`${P}/lib/commercial.ts`);
const { isScheduleKind, validateScheduleTime } = CM;
const PE = await import(`${P}/lib/preview_env.ts`);
const { shapePreviewStatus } = PE;
const PL = await import(`${P}/lib/preview_link.ts`);
const { signPreviewToken, verifyPreviewToken, clampTtlSeconds, PREVIEW_LINK_MAX_TTL_S } = PL;
const PUB = await import(`${P}/routes/publish.ts`);
const PENV = await import(`${P}/routes/preview_env.ts`);
const COM = await import(`${P}/routes/commercial.ts`);
const { runDuePublishes } = await import(`${P}/ops/scheduler.ts`);
const { digestFiles, sameFiles } = await import(`${P}/lib/netlify.ts`);
const { brandFromKit } = await import(`${P}/lib/email_brand.ts`);

// the real index.ts, with std's serve() handed a fake listener: no socket opens
const queue = []; let wake = null;
Deno.listen = () => { let first = true; return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} }; };
Deno.serveHttp = () => ({ nextRequest: () => new Promise((res) => { if (queue.length) res(queue.shift()); else wake = res; }), close() {} });
await import(`${P}/index.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const quiet = async (fn) => { const l = console.log, e = console.error, w = console.warn; console.log = () => {}; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; console.warn = w; } };
const answer = async (res) => { const text = await res.text(); let body = null; try { body = JSON.parse(text); } catch { /* html */ } return { status: res.status, body, text, headers: res.headers }; };
// a handler that throws is a failed check (status 0), not a crash of the whole suite
const run = (fn) => quiet(async () => { try { return await answer(await fn()); } catch (e) { return { status: 0, body: null, text: String(e), headers: new Headers() }; } });
const FN = 'https://fn.example.test/functions/v1/presence';
const req = (method, route, b) => new Request(`${FN}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const OWNER = Object.fromEntries(ORDER.map((id) => [id, { kind: 'client', userId: U[id], tenantId: 'tenant-1', role: 'client', email: BIZ[id].owner, jwt: BIZ[id].jwt, requestId: 'test' }]));
const STAFF = { kind: 'staff', userId: 'dddddddd-0000-4000-8000-00000000000d', tenantId: 'tenant-1', role: 'owner', email: 'staff@studio.example', jwt: null, requestId: 'test' };
const siteOf = (id) => ({ ...db.tables.presence_sites.find((s) => s.id === id) });
const offlineAt = (id) => db.tables.presence_sites.find((s) => s.id === id).offline_at;
const rowsOf = (id) => JSON.stringify(Object.keys(db.tables).sort().map((t) => [t, db.tables[t].filter((r) => siteKey(t, r) === id)]));
const mark = () => ({ log: db.log.length, seen: seen.length, calls: host.calls.length, deploys: host.deploys.length });
const deploysSince = (m) => host.deploys.slice(m.deploys);
const writesSince = (m) => db.log.slice(m.log).filter((c) => c.method !== 'GET' && c.method !== 'HEAD');
// nothing of that site's is named in a request, comes back from a read, or is asked of its host
function leftAlone(id, m) {
  const named = db.log.slice(m.log).filter((c) => c.url.includes(id) || JSON.stringify(c.body ?? '').includes(id));
  const read = seen.slice(m.seen).filter((r) => r.site === id);
  const hosted = host.calls.slice(m.calls).filter((c) => c.path.includes(BIZ[id].nf));
  return { ok: !named.length && !read.length && !hosted.length, note: `named in ${named.map((c) => c.method + ' ' + c.url.slice(0, 60)).join(' | ')}; rows read ${read.map((r) => r.table).join(',')}; host ${hosted.map((c) => c.path).join(',')}` };
}
const accentOf = (id) => brandFromKit({ primary: BIZ[id].primary }, BIZ[id].name).accent;
const holdingFor = (id, over = {}) => renderOfflinePage({ businessName: BIZ[id].name, accent: accentOf(id), email: BIZ[id].email, phone: BIZ[id].phone, ...over });
const pageSent = (dep) => host.uploads.find((x) => x.deploy === dep?.id && x.path === '/index.html')?.text || '';
const soon = (ms) => new Date(Date.now() + ms).toISOString();
const DAY = 86_400_000;

// ═══ 1. the offline holding page (pure) ═══
{
  const holding = renderOfflinePage({ businessName: 'Rosie’s Bakery', accent: '#0a7d5c', email: 'hi@rosies.example', phone: '(818) 555-0199' });
  ok('offline page: on-brand, the business name is on it', holding.includes('Rosie’s Bakery'));
  ok('offline page: on-brand, the accent colour is used', holding.includes('#0a7d5c'));
  ok('offline page: honest words, temporarily offline, not an error', /temporarily offline/i.test(holding));
  ok('offline page: search engines are told not to index it', holding.includes('noindex,nofollow'));
  ok('offline page: the contact email and phone are there and work', holding.includes('mailto:hi@rosies.example') && holding.includes('tel:8185550199') && holding.includes('(818) 555-0199'));
  ok('offline page: it carries the holding marker', holding.includes('presence-offline-holding'));
  ok('offline page: self-contained, no outside files', !/src="http|href="http/.test(holding));
  const hostile = renderOfflinePage({ businessName: '<script>alert(1)</script>', accent: 'red;}</style><script>', email: '"><img src=x>' });
  ok('offline page: a name with markup in it is escaped', !hostile.includes('<script>alert(1)</script>') && hostile.includes('&lt;script&gt;'));
  ok('offline page: an accent that is not a hex colour falls back to the default', hostile.includes('#5b3fa0') && !hostile.includes('</style><script>'));
  ok('offline page: with nothing to go on it is still an honest page', /temporarily offline/i.test(renderOfflinePage({})));
  ok('offline page: the same details give the same bytes', renderOfflinePage({ businessName: 'X' }) === renderOfflinePage({ businessName: 'X' }));
  const files = offlineFileMap(holding);
  ok('offline deploy: index.html and 404.html both carry the holding page', files['index.html'] === holding && files['404.html'] === holding);
  ok('offline deploy: robots.txt disallows everything', /Disallow: \/\n/.test(files['robots.txt']));
  ok('offline deploy: _headers keeps the tenant security headers', /Strict-Transport-Security/.test(files['_headers']) && /X-Frame-Options: DENY/.test(files['_headers']) && /Content-Security-Policy/.test(files['_headers']));
  ok('offline deploy: _headers adds X-Robots-Tag noindex', /X-Robots-Tag: noindex/.test(files['_headers']));
  ok('offline deploy: exactly the four files, nothing of the site goes with them', Object.keys(files).sort().join(',') === '404.html,_headers,index.html,robots.txt');
}

// ═══ 2. schedule kinds: offline is a scheduled action like publish and revert (pure) ═══
{
  ok('schedule: publish, revert and offline are the kinds', isScheduleKind('publish') && isScheduleKind('revert') && isScheduleKind('offline'));
  ok('schedule: anything else is refused', !isScheduleKind('delete') && !isScheduleKind('') && !isScheduleKind(null) && !isScheduleKind('OFFLINE'));
  const now = '2026-07-15T12:00:00.000Z';
  ok('schedule: a time in the future is accepted', validateScheduleTime('2026-07-16T09:00:00Z', now).ok === true);
  ok('schedule: a time in the past is refused', validateScheduleTime('2026-07-14T09:00:00Z', now).ok === false);
}

// ═══ 3. the status shape carries the offline mark (pure) ═══
{
  const st = shapePreviewStatus({ draftChanges: 2, preview: null, live: { last_published_at: '2026-07-01T00:00:00Z', summary: 's' }, baseUrl: 'https://x', offlineAt: '2026-07-10T00:00:00Z' });
  ok('status: offline_since is on the live block', st.live.offline_since === '2026-07-10T00:00:00Z' && st.live.published === true);
  const on = shapePreviewStatus({ draftChanges: 0, preview: null, live: null, baseUrl: 'https://x' });
  ok('status: with no mark the site is online (null), as older callers expect', on.live.offline_since === null);
}

// ═══ 4. the signed share token: mint, check, expired, tampered (pure) ═══
{
  const secret = 'probe-secret-0111';
  const now = Math.floor(Date.now() / 1000);
  const ttl = clampTtlSeconds(7 * 86400);
  ok('token: seven days is within the server ceiling', ttl === 7 * 86400 && ttl <= PREVIEW_LINK_MAX_TTL_S);
  const tok = await signPreviewToken({ site_id: SITE_A, exp: now + ttl, scope: 'preview' }, secret);
  const v = await verifyPreviewToken(tok, secret, now);
  ok('token: minted, then checked, it comes back whole', v.ok === true && v.payload.site_id === SITE_A);
  ok('token: it names exactly one site, for previews only', v.ok && v.payload.site_id !== SITE_B && v.payload.scope === 'preview');
  const expired = await signPreviewToken({ site_id: SITE_A, exp: now - 10, scope: 'preview' }, secret);
  const ve = await verifyPreviewToken(expired, secret, now);
  ok('token: an expired one is refused', ve.ok === false && ve.error === 'expired');
  // the body re-pointed at another site, the old signature kept
  const [body, sig] = tok.split('.');
  const swapped = btoa(JSON.stringify({ site_id: SITE_B, exp: now + ttl, scope: 'preview' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const vt = await verifyPreviewToken(`${swapped}.${sig}`, secret, now);
  ok('token: a body re-pointed at another site is refused (bad signature)', vt.ok === false && vt.error === 'bad_signature');
  // flip the FIRST hex character: the old slice(0,-2)+"ab" changed nothing whenever the signature
  // already ended in "ab" (about 1 in 256), and reddened CI at random (deploy #20)
  const badSig = (sig[0] === '0' ? '1' : '0') + sig.slice(1);
  const vs = await verifyPreviewToken(`${body}.${badSig}`, secret, now);
  ok('token: a changed signature is refused', vs.ok === false && vs.error === 'bad_signature');
  const vw = await verifyPreviewToken(tok, 'some-other-secret', now);
  ok('token: signed with another secret, refused', vw.ok === false && vw.error === 'bad_signature');
  const vm = await verifyPreviewToken('not-a-token', secret, now);
  ok('token: not a token at all, refused', vm.ok === false && vm.error === 'malformed');
}

// ═══ 5. two studios' sites, each published live on its own host ═══
const HOURS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({ day, closed: day === 'sun', intervals: day === 'sun' ? [] : [{ open: '08:00', close: '16:00' }] }));
function world() {
  const t = {
    presence_sites: [], presence_identity: [], presence_locations: [], presence_settings: [], presence_entitlements: [], clients: [],
    contacts: [], memberships: [], presence_site_members: [], presence_agency_clients: [], presence_offerings: [], presence_testimonials: [],
    presence_faqs: [], presence_posts: [], presence_media: [], presence_redirects: [], presence_dev_customizations: [], presence_reviews: [],
    presence_content_library: [], presence_page_locks: [], presence_publishes: [], presence_snapshots: [], presence_change_events: [],
    presence_plan_notices: [], presence_scheduled_publishes: [], presence_site_preview: [], presence_sales_templates: [],
  };
  for (const id of ORDER) {
    const b = BIZ[id];
    t.presence_sites.push({ id, client_id: b.client, status: 'ready', last_published_at: null, template_slug: 'restaurant-classic', template_version: '1.0.0', custom_domain: null, netlify_site_id: b.nf, edition: 'presence', offline_at: null, visitor_password_at: null });
    t.presence_identity.push({ site_id: id, business_name: b.name, tagline: 'Fresh every morning', description: `${b.name} is a neighbourhood shop in Burbank.`, phone: b.phone, email: b.email, story: '', service_area: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '' });
    t.presence_locations.push({ id: crypto.randomUUID(), site_id: id, address_line1: '100 Example Ave', address_line2: '', city: 'Burbank', region: 'CA', postal_code: '91502', country: 'US', timezone: 'America/Los_Angeles', hours: HOURS, holiday_exceptions: [], temporarily_closed: false, created_at: '2026-01-01T00:00:00Z' });
    t.presence_settings.push({ site_id: id, category_order: [], nav: null, blocks: [], pages: [], brand_kit: { primary: b.primary }, logo_media_id: null });
    t.presence_entitlements.push({ client_id: b.client, product: 'presence', plan: 'presence', status: 'active' });
    t.clients.push({ id: `row-${b.client}`, email: b.owner, tenant_id: 'tenant-1', name: b.name });
  }
  return t;
}
db.reset(world());
const firstA = await run(() => PUB.handlePublish(null, siteOf(SITE_A), OWNER[SITE_A], {}));
const firstB = await run(() => PUB.handlePublish(null, siteOf(SITE_B), OWNER[SITE_B], {}));
const liveOf = (id) => db.tables.presence_publishes.filter((p) => p.site_id === id && p.status === 'live').at(-1);
const LIVE_A = liveOf(SITE_A), LIVE_B = liveOf(SITE_B);
ok('setup: both studios’ sites go live, each on its own host, through the real publish', firstA.status === 200 && firstA.body?.data?.status === 'live' && firstB.body?.data?.status === 'live'
  && LIVE_A?.netlify_deploy_id && host.sites[BIZ[SITE_A].nf]?.live === LIVE_A.netlify_deploy_id && host.sites[BIZ[SITE_B].nf]?.live === LIVE_B?.netlify_deploy_id && !!LIVE_A.deploy_files,
  `${firstA.status} ${firstA.text.slice(0, 300)} | ${firstB.status} ${firstB.text.slice(0, 200)}`);
const BASE = { tables: structuredClone(db.tables), host: structuredClone({ sites: host.sites, deploys: host.deploys, next: host.next }) };
function restore(edit) {
  db.reset(BASE.tables);
  seen.length = 0; dbHook = null;
  newHost(BASE.host);
  if (edit) edit(db.tables);
}
const siteRow = (t, id) => t.presence_sites.find((s) => s.id === id);

// ═══ 6. Take offline: the holding page over the live site, nothing deleted ═══
{
  restore();
  const bBefore = rowsOf(SITE_B), keptBefore = JSON.stringify([db.tables.presence_publishes, db.tables.presence_snapshots]);
  const m = mark();
  const r = await run(() => PUB.handleTakeOffline(siteOf(SITE_A), OWNER[SITE_A], {}));
  const deps = deploysSince(m);
  const want = await digestFiles(offlineFileMap(holdingFor(SITE_A)));
  ok('take offline: it answers that the site is offline and that nothing was deleted', r.status === 200 && r.body?.data?.offline === true && /nothing was deleted/.test(r.body?.data?.message || ''), `${r.status} ${r.text.slice(0, 200)}`);
  ok('take offline: one deploy, on this site’s own host, of exactly the holding page’s four files', deps.length === 1 && deps[0].site === BIZ[SITE_A].nf && deps[0].title === 'offline holding page' && sameFiles(deps[0].files, want), JSON.stringify(deps.map((d) => [d.site, d.title, Object.keys(d.files)])));
  ok('take offline: the host now shows the holding page to visitors', host.sites[BIZ[SITE_A].nf].live === deps[0]?.id);
  const page = pageSent(deps[0]);
  ok('take offline: the page names this business, with its own email, phone and colour, never another studio’s', page.includes('Alpha Bakery is temporarily offline') && page.includes('mailto:hello@alpha-bakery.example') && page.includes('tel:8185550100') && page.includes(accentOf(SITE_A)) && !/Bravo|Charlie/.test(page), page.slice(0, 200));
  ok('take offline: nothing is deleted, on the host or in the database, and every kept version is still there', !host.calls.slice(m.calls).some((c) => c.method === 'DELETE') && !db.log.slice(m.log).some((c) => c.method === 'DELETE') && JSON.stringify([db.tables.presence_publishes, db.tables.presence_snapshots]) === keptBefore);
  const ev = db.tables.presence_change_events.filter((e) => e.site_id === SITE_A && e.entity_type === 'site');
  ok('take offline: the site is marked offline, and its history says so, by whom, field and all', !Number.isNaN(Date.parse(offlineAt(SITE_A) || '')) && ev.length === 1 && /^Took the website offline/.test(ev[0].summary) && /Every version is kept/.test(ev[0].summary) && ev[0].actor_user_id === U[SITE_A] && JSON.stringify(ev[0].detail) === '{"fields":["offline_at"]}', JSON.stringify(ev));
  const alone = leftAlone(SITE_B, m);
  ok('take offline: another studio’s site, host and history are not read and not changed', rowsOf(SITE_B) === bBefore && alone.ok, alone.note);
  const m2 = mark();
  const again = await run(() => PUB.handleTakeOffline(siteOf(SITE_A), OWNER[SITE_A], {}));
  ok('take offline: a second press is a calm 409 that deploys nothing', again.status === 409 && again.body?.error === 'already_offline' && deploysSince(m2).length === 0, `${again.status} ${again.text.slice(0, 120)}`);
}
{
  restore((t) => t.presence_publishes.push({ id: crypto.randomUUID(), site_id: SITE_A, snapshot_id: null, kind: 'publish', status: 'deploying', created_at: '2026-11-15T10:00:00Z' }));
  const m = mark();
  const r = await run(() => PUB.handleTakeOffline(siteOf(SITE_A), OWNER[SITE_A], {}));
  ok('take offline: refused while a publish of this site is in flight, and nothing deploys', r.status === 409 && r.body?.error === 'publish_in_progress' && r.body?.message === 'A publish is in progress — let it finish, then take the site offline.' && deploysSince(m).length === 0 && offlineAt(SITE_A) === null, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  restore((t) => t.presence_publishes.push({ id: crypto.randomUUID(), site_id: SITE_B, snapshot_id: null, kind: 'publish', status: 'deploying', created_at: '2026-11-15T10:00:00Z' }));
  const r = await run(() => PUB.handleTakeOffline(siteOf(SITE_A), OWNER[SITE_A], {}));
  ok('take offline: another studio’s publish in flight doesn’t hold this site up', r.status === 200 && !!offlineAt(SITE_A) && offlineAt(SITE_B) === null, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  restore();
  const m = mark();
  const r = await run(() => PUB.handleTakeOffline(siteOf(SITE_C), OWNER[SITE_C], {}));
  ok('take offline: a site that never went live has nothing to take offline, though others are live', r.status === 409 && r.body?.error === 'not_live' && deploysSince(m).length === 0 && offlineAt(SITE_C) === null, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  restore();
  host.failCreate.add(BIZ[SITE_A].nf);
  const r = await run(() => PUB.handleTakeOffline(siteOf(SITE_A), OWNER[SITE_A], {}));
  ok('take offline: a deploy that fails leaves the site online, unmarked, and says the live site is unchanged', r.status === 502 && r.body?.error === 'deploy_failed' && /live site is unchanged/.test(r.body?.message || '') && offlineAt(SITE_A) === null && !db.tables.presence_change_events.some((e) => e.site_id === SITE_A && e.entity_type === 'site'), `${r.status} ${r.text.slice(0, 160)}`);
}
{
  restore();
  dbHook = (table, method, q) => (table === 'presence_sites' && method === 'GET' && /select=offline_at/.test(q) ? reply({ code: '42703', message: 'column presence_sites.offline_at does not exist' }, 400) : null);
  const m = mark();
  const r = await run(() => PUB.handleTakeOffline(siteOf(SITE_A), OWNER[SITE_A], {}));
  dbHook = null;
  ok('take offline: before migration 0111 it refuses up front and deploys nothing it couldn’t record', r.status === 503 && r.body?.error === 'unavailable' && deploysSince(m).length === 0, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  restore((t) => { siteRow(t, SITE_A).status = 'paused'; });
  const m = mark();
  const asOwner = await run(() => PUB.handleTakeOffline(siteOf(SITE_A), OWNER[SITE_A], {}));
  const ownerDeploys = deploysSince(m).length;
  const asStaff = await run(() => PUB.handleTakeOffline(siteOf(SITE_A), STAFF, {}));
  ok('take offline: a paused site’s owner is refused and nothing deploys; platform staff can', asOwner.status === 409 && asOwner.body?.error === 'site_paused' && ownerDeploys === 0 && asStaff.status === 200 && !!offlineAt(SITE_A), `${asOwner.status} ${asStaff.status}`);
  restore((t) => { siteRow(t, SITE_A).status = 'archived'; });
  const m2 = mark();
  const archived = await run(() => PUB.handleTakeOffline(siteOf(SITE_A), STAFF, {}));
  ok('take offline: an archived site can’t be changed, by staff either', archived.status === 409 && archived.body?.error === 'lifecycle_blocked' && deploysSince(m2).length === 0);
}

// ═══ 7. Bring back online: the last live version, through the one pipeline ═══
{
  restore();
  await run(() => PUB.handleTakeOffline(siteOf(SITE_A), OWNER[SITE_A], {}));
  const bBefore = rowsOf(SITE_B), pubsBefore = db.tables.presence_publishes.length;
  const m = mark();
  const r = await run(() => PUB.handleBackOnline(siteOf(SITE_A), OWNER[SITE_A], {}));
  const rec = db.tables.presence_publishes.slice(pubsBefore), deps = deploysSince(m);
  ok('back online: it answers that the site is live', r.status === 200 && r.body?.data?.status === 'live', `${r.status} ${r.text.slice(0, 200)}`);
  ok('back online: the last live version goes back up as a restore through the publish pipeline, kept in the history', rec.length === 1 && rec[0].site_id === SITE_A && rec[0].kind === 'restore' && rec[0].snapshot_id === LIVE_A.snapshot_id && rec[0].change_summary === 'Brought the website back online' && rec[0].status === 'live' && rec[0].netlify_deploy_id === deps[0]?.id, JSON.stringify(rec));
  ok('back online: the host gets the real site again, file for file as last published, and shows it', deps.length === 1 && deps[0].site === BIZ[SITE_A].nf && sameFiles(deps[0].files, LIVE_A.deploy_files) && host.sites[BIZ[SITE_A].nf].live === deps[0].id, JSON.stringify(deps.map((d) => [d.site, Object.keys(d.files).length])));
  ok('back online: the offline mark is cleared, and nothing was deleted on the way back', offlineAt(SITE_A) === null && !host.calls.slice(m.calls).some((c) => c.method === 'DELETE') && !db.log.slice(m.log).some((c) => c.method === 'DELETE'));
  const alone = leftAlone(SITE_B, m);
  ok('back online: another studio’s site, versions and host are not read and not changed', rowsOf(SITE_B) === bBefore && alone.ok, alone.note);
  const m2 = mark();
  const again = await run(() => PUB.handleBackOnline(siteOf(SITE_A), OWNER[SITE_A], {}));
  ok('back online: a site that is online is told so, and nothing deploys', again.status === 409 && again.body?.error === 'not_offline' && deploysSince(m2).length === 0, `${again.status} ${again.text.slice(0, 120)}`);
}
{
  restore((t) => { siteRow(t, SITE_A).offline_at = '2026-11-14T09:00:00Z'; for (const p of t.presence_publishes) if (p.site_id === SITE_A) p.snapshot_id = null; });
  const m = mark();
  const r = await run(() => PUB.handleBackOnline(siteOf(SITE_A), OWNER[SITE_A], {}));
  ok('back online: with no kept version left it says to publish the draft instead, and deploys nothing', r.status === 410 && r.body?.error === 'not_restorable' && /publish your draft instead/.test(r.body?.message || '') && deploysSince(m).length === 0 && !!offlineAt(SITE_A), `${r.status} ${r.text.slice(0, 160)}`);
}
{
  restore();
  await run(() => PUB.handleTakeOffline(siteOf(SITE_A), OWNER[SITE_A], {}));
  db.tables.presence_sites.find((s) => s.id === SITE_A).status = 'paused';
  const m = mark();
  const asOwner = await run(() => PUB.handleBackOnline(siteOf(SITE_A), OWNER[SITE_A], {}));
  const ownerDeploys = deploysSince(m).length;
  const asStaff = await run(() => PUB.handleBackOnline(siteOf(SITE_A), STAFF, {}));
  ok('back online: Publish’s rules apply: a paused site’s owner is refused, platform staff bring it back', asOwner.status === 409 && asOwner.body?.error === 'site_paused' && ownerDeploys === 0 && asStaff.status === 200 && offlineAt(SITE_A) === null, `${asOwner.status} ${asStaff.status} ${asStaff.text.slice(0, 120)}`);
}

// ═══ 8. any publish that goes live clears the mark; a failed one leaves it ═══
{
  restore();
  await run(() => PUB.handleTakeOffline(siteOf(SITE_A), OWNER[SITE_A], {}));
  const m = mark();
  const r = await run(() => PUB.handlePublish(null, siteOf(SITE_A), OWNER[SITE_A], {}));
  const dep = deploysSince(m)[0];
  ok('publish: a publish that goes live replaces the holding page and clears the offline mark', r.status === 200 && r.body?.data?.status === 'live' && deploysSince(m).length === 1 && dep.title !== 'offline holding page' && host.sites[BIZ[SITE_A].nf].live === dep.id && offlineAt(SITE_A) === null, `${r.status} ${r.text.slice(0, 160)}`);
  ok('publish: deletes nothing on the host or in the database either', !host.calls.slice(m.calls).some((c) => c.method === 'DELETE') && !db.log.slice(m.log).some((c) => c.method === 'DELETE'));
}
{
  restore();
  await run(() => PUB.handleTakeOffline(siteOf(SITE_A), OWNER[SITE_A], {}));
  const was = offlineAt(SITE_A);
  host.failCreate.add(BIZ[SITE_A].nf);
  const r = await run(() => PUB.handlePublish(null, siteOf(SITE_A), OWNER[SITE_A], {}));
  ok('publish: a publish whose deploy fails leaves the site offline, mark and all', r.status === 502 && !!was && offlineAt(SITE_A) === was, `${r.status} ${offlineAt(SITE_A)}`);
}
{
  restore();
  await run(() => PUB.handleTakeOffline(siteOf(SITE_A), OWNER[SITE_A], {}));
  const was = offlineAt(SITE_A);
  db.tables.presence_identity.find((i) => i.site_id === SITE_B).tagline = 'Flowers for every day';
  const m = mark();
  const r = await run(() => PUB.handlePublish(null, siteOf(SITE_B), OWNER[SITE_B], {}));
  ok('publish: another studio’s publish going live leaves this site offline', r.status === 200 && r.body?.data?.status === 'live' && deploysSince(m).length === 1 && offlineAt(SITE_A) === was && !!was, `${r.status} ${offlineAt(SITE_A)}`);
}

// ═══ 9. Scheduling offline: no snapshot frozen; this site's rows only ═══
{
  restore();
  const when = soon(2 * DAY);
  const m = mark();
  const r = await run(() => COM.handleScheduleCreate(req('POST', '/schedule', { kind: 'offline', scheduled_for: when }), siteOf(SITE_A), OWNER[SITE_A], {}));
  const rows = db.tables.presence_scheduled_publishes;
  ok('schedule offline: stored for this site, kind offline, at that time, with no snapshot', r.status === 200 && r.body?.data?.kind === 'offline' && rows.length === 1 && rows[0].site_id === SITE_A && rows[0].kind === 'offline' && rows[0].snapshot_id === null && rows[0].summary === 'Scheduled to take the site offline' && rows[0].scheduled_for === when, `${r.status} ${JSON.stringify(rows)}`);
  ok('schedule offline: nothing is frozen, no snapshot written and the draft not even read', db.writes('presence_snapshots').length === 0 && !db.log.slice(m.log).some((c) => /presence_(identity|settings|offerings|locations)\?/.test(c.url)));
  const p = await run(() => COM.handleScheduleCreate(req('POST', '/schedule', { kind: 'publish', scheduled_for: when, note: 'Holiday hours' }), siteOf(SITE_A), OWNER[SITE_A], {}));
  const snaps = db.writes('presence_snapshots'), row = db.tables.presence_scheduled_publishes[1];
  const frozen = db.tables.presence_snapshots.find((s) => s.id === row?.snapshot_id);
  ok('schedule publish, for contrast: the draft is frozen into one snapshot of this site, named on the row', p.status === 200 && snaps.length === 1 && row?.kind === 'publish' && frozen?.site_id === SITE_A && frozen?.content?.identity?.business_name === 'Alpha Bakery' && row.summary === 'Holiday hours');
  const before = db.tables.presence_scheduled_publishes.length;
  const past = await run(() => COM.handleScheduleCreate(req('POST', '/schedule', { kind: 'offline', scheduled_for: soon(-2 * DAY) }), siteOf(SITE_A), OWNER[SITE_A], {}));
  ok('schedule: a time in the past is refused, and nothing is stored', past.status === 400 && past.body?.error === 'past' && db.tables.presence_scheduled_publishes.length === before);
  const theirs = await run(() => COM.handleScheduleCreate(req('POST', '/schedule', { kind: 'revert', publish_id: LIVE_B.id, scheduled_for: when }), siteOf(SITE_A), OWNER[SITE_A], {}));
  ok('schedule: a return to another studio’s version is refused, and nothing is stored', theirs.status === 400 && theirs.body?.message === 'Choose a version to revert to.' && db.tables.presence_scheduled_publishes.length === before);
}
{
  const B_ROW = 'b0b0b0b0-0000-4000-8000-0000000000b0', A_ROW = 'a0a0a0a0-0000-4000-8000-0000000000a0';
  restore((t) => t.presence_scheduled_publishes.push(
    { id: B_ROW, site_id: SITE_B, snapshot_id: null, kind: 'offline', scheduled_for: soon(3 * DAY), status: 'pending', fired_at: null, summary: 'Closed for the holidays', created_by: U[SITE_B] },
    { id: A_ROW, site_id: SITE_A, snapshot_id: null, kind: 'offline', scheduled_for: soon(4 * DAY), status: 'pending', fired_at: null, summary: 'Scheduled to take the site offline', created_by: U[SITE_A] },
  ));
  const list = await run(() => COM.handleScheduleList(siteOf(SITE_A), {}));
  ok('schedule list: this site’s rows only', list.status === 200 && JSON.stringify((list.body?.data?.scheduled || []).map((s) => s.id)) === JSON.stringify([A_ROW]), list.text.slice(0, 200));
  const cross = await run(() => COM.handleScheduleCancel(siteOf(SITE_A), B_ROW, OWNER[SITE_A], {}));
  ok('schedule cancel: another studio’s row is a 404, and stays pending', cross.status === 404 && db.tables.presence_scheduled_publishes.find((s) => s.id === B_ROW).status === 'pending');
  const own = await run(() => COM.handleScheduleCancel(siteOf(SITE_A), A_ROW, OWNER[SITE_A], {}));
  ok('schedule cancel: its own row is canceled', own.status === 200 && db.tables.presence_scheduled_publishes.find((s) => s.id === A_ROW).status === 'canceled');
}

// ═══ 10. the cron fires an offline row through the same take-offline core ═══
{
  restore();
  const due = soon(-30_000);   // half a minute ago: the schedule route still takes it
  const schedule = (id, b) => run(() => COM.handleScheduleCreate(req('POST', '/schedule', b), siteOf(id), OWNER[id], {}));
  await schedule(SITE_A, { kind: 'offline', scheduled_for: due });
  await schedule(SITE_B, { kind: 'publish', scheduled_for: due, note: 'Weekend specials' });
  await schedule(SITE_C, { kind: 'offline', scheduled_for: due });
  await schedule(SITE_A, { kind: 'offline', scheduled_for: soon(3 * DAY) });
  const rowOf = (id, kind, when) => db.tables.presence_scheduled_publishes.find((s) => s.site_id === id && s.kind === kind && (!when || s.scheduled_for === when));
  // the business's number changes after the offline was scheduled: the page is drawn when it fires
  db.tables.presence_identity.find((i) => i.site_id === SITE_A).phone = '(818) 555-0123';
  const m = mark();
  const cyc = await quiet(() => runDuePublishes());
  const depsA = deploysSince(m).filter((d) => d.site === BIZ[SITE_A].nf);
  const rowA = rowOf(SITE_A, 'offline', new Date(due).toISOString());
  const want = await digestFiles(offlineFileMap(holdingFor(SITE_A, { phone: '(818) 555-0123' })));
  ok('cron: the due offline row takes the site offline through the take-offline core, the holding page and nothing else', !!offlineAt(SITE_A) && depsA.length === 1 && depsA[0].title === 'offline holding page' && sameFiles(depsA[0].files, want), JSON.stringify(depsA.map((d) => d.title)));
  ok('cron: the page is drawn when it fires, with the phone number as it is then', pageSent(depsA[0]).includes('tel:8185550123') && !pageSent(depsA[0]).includes('tel:8185550100'));
  // item 239 (PR 448): the scheduler signs as the system on behalf of whoever set the row; a bare
// 'scheduler' id was refused by the uuid column, so those lines never reached the change log
ok('cron: the row is done, claimed once, with no error, and the history says the system did it for who scheduled it', rowA?.status === 'done' && !!rowA?.fired_at && rowA?.last_error === '' && db.tables.presence_change_events.some((e) => e.site_id === SITE_A && /^Took the website offline/.test(e.summary) && e.actor_kind === 'system' && e.actor_user_id === rowA.created_by), JSON.stringify(db.tables.presence_change_events.filter((e) => e.site_id === SITE_A).map((e) => [e.summary, e.actor_kind, e.actor_user_id])));
  ok('cron: a scheduled publish in the same tick goes through the same loop', rowOf(SITE_B, 'publish')?.status === 'done' && offlineAt(SITE_B) === null, JSON.stringify(rowOf(SITE_B, 'publish')));
  const rowC = rowOf(SITE_C, 'offline');
  ok('cron: an offline row for a site that never went live fails, says why, and changes nothing', rowC?.status === 'failed' && /^not_live: /.test(rowC?.last_error || '') && offlineAt(SITE_C) === null && !deploysSince(m).some((d) => d.site === BIZ[SITE_C].nf), JSON.stringify(rowC));
  const later = db.tables.presence_scheduled_publishes.find((s) => s.site_id === SITE_A && s.kind === 'offline' && s.id !== rowA?.id);
  ok('cron: a row whose time hasn’t come waits, unclaimed', later?.status === 'pending' && later?.fired_at === null, JSON.stringify(later));
  ok('cron: the tick reports three due, three run, one failure, and the offline step', cyc.considered === 3 && cyc.ran === 3 && cyc.failures === 1 && cyc.results.some((x) => x.site_id === SITE_A && x.ok === true && x.steps.offline === true), JSON.stringify({ considered: cyc.considered, ran: cyc.ran, failures: cyc.failures }));
}

// ═══ 11. Share a draft link: the one preview slot, a link to this site only ═══
const TOKEN_B = 'b'.repeat(64);
const now = () => Math.floor(Date.now() / 1000);
const tokenOf = (url) => new URL(url).searchParams.get('s');
let TOK_A = '';
{
  restore((t) => t.presence_site_preview.push({ site_id: SITE_B, snapshot_id: LIVE_B.snapshot_id, token: TOKEN_B, password_hash: null, updated_at: '2026-11-10T10:00:00Z' }));
  const bBefore = rowsOf(SITE_B);
  const m0 = mark();
  const none = await run(() => PENV.handlePreviewShareLink(req('POST', '/preview/share-link', {}), siteOf(SITE_A), OWNER[SITE_A], {}));
  ok('share link: with no preview and no capture it asks for a preview first, and writes nothing', none.status === 409 && none.body?.error === 'no_preview' && writesSince(m0).length === 0, `${none.status} ${none.text.slice(0, 120)}`);

  const m = mark();
  const snapsBefore = db.tables.presence_snapshots.length;
  const r = await run(() => PENV.handlePreviewShareLink(req('POST', '/preview/share-link', { capture: true, ttl_seconds: 7 * 86400 }), siteOf(SITE_A), OWNER[SITE_A], {}));
  const captured = db.tables.presence_snapshots.slice(snapsBefore);
  const slot = () => db.tables.presence_site_preview.find((p) => p.site_id === SITE_A);
  ok('share link: capture puts the draft as it is now into this site’s preview slot', r.status === 200 && captured.length === 1 && captured[0].site_id === SITE_A && captured[0].content?.identity?.business_name === 'Alpha Bakery' && slot()?.snapshot_id === captured[0].id && /^[0-9a-f]{64}$/.test(slot()?.token || ''), `${r.status} ${r.text.slice(0, 200)}`);
  TOK_A = tokenOf(r.body?.data?.url || 'https://x/');
  const v = await verifyPreviewToken(TOK_A || '', 'preview-secret-0111', now());
  const left = v.ok ? v.payload.exp - now() : 0;
  ok('share link: the link is the draft viewer, signed for this site only, good for seven days', (r.body?.data?.url || '').startsWith('https://app.example.test/draft.html?s=') && v.ok && v.payload.site_id === SITE_A && v.payload.scope === 'preview' && left > 7 * 86400 - 30 && left <= 7 * 86400 && r.body?.data?.ttl_seconds === 7 * 86400 && r.body?.data?.expires_at === new Date(v.payload.exp * 1000).toISOString(), JSON.stringify(r.body));
  ok('share link: the history says a timed draft link was shared', db.tables.presence_change_events.some((e) => e.site_id === SITE_A && e.entity_type === 'preview' && e.summary === 'Shared a timed draft preview link'));
  const tokenThen = slot()?.token;

  const long = await run(() => PENV.handlePreviewShareLink(req('POST', '/preview/share-link', { ttl_seconds: 30 * 86400 }), siteOf(SITE_A), OWNER[SITE_A], {}));
  const dflt = await run(() => PENV.handlePreviewShareLink(req('POST', '/preview/share-link', {}), siteOf(SITE_A), OWNER[SITE_A], {}));
  ok('share link: a longer time is cut to seven days, and none asked for means one day', long.body?.data?.ttl_seconds === 7 * 86400 && dflt.body?.data?.ttl_seconds === 86400 && db.tables.presence_snapshots.length === snapsBefore + 1, `${long.text.slice(0, 120)} ${dflt.text.slice(0, 120)}`);

  // "Update preview" and the share capture fill the same slot: same token, the newer draft
  db.tables.presence_identity.find((i) => i.site_id === SITE_A).tagline = 'Sourdough on Saturdays';
  const upd = await run(() => PENV.handlePreviewPublish(siteOf(SITE_A), OWNER[SITE_A], {}));
  const afterUpdate = slot();
  const again = await run(() => PENV.handlePreviewShareLink(req('POST', '/preview/share-link', { capture: true, ttl_seconds: 7 * 86400 }), siteOf(SITE_A), OWNER[SITE_A], {}));
  const newest = db.tables.presence_snapshots.at(-1);
  ok('share link: Update preview and the share capture fill the same slot, the token kept, the newer draft in it', upd.status === 200 && again.status === 200 && afterUpdate?.token === tokenThen && slot()?.token === tokenThen && slot()?.snapshot_id === newest?.id && newest?.site_id === SITE_A && newest?.content?.identity?.tagline === 'Sourdough on Saturdays' && db.tables.presence_site_preview.length === 2, JSON.stringify(db.tables.presence_site_preview.map((p) => [p.site_id.slice(0, 4), p.token.slice(0, 6), p.snapshot_id?.slice(0, 6)])));
  TOK_A = tokenOf(again.body?.data?.url || 'https://x/') || TOK_A;
  const alone = leftAlone(SITE_B, m);
  ok('share link: another studio’s preview, token and versions are not read and not changed', rowsOf(SITE_B) === bBefore && db.tables.presence_site_preview.find((p) => p.site_id === SITE_B)?.token === TOKEN_B && slot()?.token !== TOKEN_B && alone.ok, alone.note);

  const saved = Deno.env.get('PREVIEW_LINK_SECRET'), cron = Deno.env.get('SCHEDULER_SECRET');
  Deno.env.delete('PREVIEW_LINK_SECRET'); Deno.env.delete('SCHEDULER_SECRET');
  const m2 = mark();
  let off;
  try { off = await run(() => PENV.handlePreviewShareLink(req('POST', '/preview/share-link', { capture: true }), siteOf(SITE_A), OWNER[SITE_A], {})); }
  finally { Deno.env.set('PREVIEW_LINK_SECRET', saved); Deno.env.set('SCHEDULER_SECRET', cron); }
  ok('share link: with no signing secret it refuses before capturing anything', off.status === 503 && off.body?.error === 'unavailable' && writesSince(m2).length === 0, `${off.status} ${off.text.slice(0, 120)}`);
}

// ═══ 12. the signed door: this site's draft only, until it expires ═══
{
  const door = (token, q = '?embed=1') => run(() => PENV.handleSignedPreview(new Request(`${FN}/p/s/${token}${q}`), token, {}));
  const r = await door(TOK_A);
  ok('signed door: the link opens this site’s draft as captured, noindex, never another studio’s', r.status === 200 && /text\/html/.test(r.headers.get('Content-Type') || '') && r.text.includes('Alpha Bakery') && r.text.includes('Sourdough on Saturdays') && !r.text.includes('Bravo') && r.text.includes('<meta name="robots" content="noindex,nofollow">') && /noindex/.test(r.headers.get('X-Robots-Tag') || ''), `${r.status} ${r.text.slice(0, 160)}`);
  const go = await door(TOK_A, '');
  ok('signed door: opened directly it goes on to the draft viewer on the app', go.status === 302 && go.headers.get('Location') === `https://app.example.test/draft.html?s=${encodeURIComponent(TOK_A)}`, `${go.status} ${go.headers.get('Location')}`);
  const expired = await signPreviewToken({ site_id: SITE_A, exp: now() - 5, scope: 'preview' }, 'preview-secret-0111');
  const ex = await door(expired);
  ok('signed door: an expired link is a 410 that says so, and shows nothing of the draft', ex.status === 410 && /has expired/.test(ex.text) && !ex.text.includes('Alpha Bakery'));
  const [, sig] = TOK_A.split('.');
  const toB = btoa(JSON.stringify({ site_id: SITE_B, exp: now() + 3600, scope: 'preview' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const moved = await door(`${toB}.${sig}`);
  ok('signed door: a link re-pointed at another studio’s site is refused, and shows nothing of theirs', moved.status === 404 && /isn’t valid/.test(moved.text) && !moved.text.includes('Bravo'));
  const other = await door(await signPreviewToken({ site_id: SITE_A, exp: now() + 3600, scope: 'preview' }, 'another-secret'));
  ok('signed door: a link signed with another secret is refused', other.status === 404 && !other.text.includes('Alpha Bakery'));
}

// ═══ 13. the status read carries this site's mark, not another's ═══
{
  restore();
  await run(() => PUB.handleTakeOffline(siteOf(SITE_A), OWNER[SITE_A], {}));
  const a = await run(() => PENV.handlePreviewStatus(siteOf(SITE_A), {}));
  const b = await run(() => PENV.handlePreviewStatus(siteOf(SITE_B), {}));
  ok('status read: this site’s offline mark reaches the panel; the other studio’s site reads online', a.status === 200 && a.body?.data?.live?.offline_since === offlineAt(SITE_A) && !!offlineAt(SITE_A) && a.body?.data?.live?.published === true && b.body?.data?.live?.offline_since === null, `${a.text.slice(0, 200)} | ${b.text.slice(0, 120)}`);
}

// ═══ 14. the routes, through the real router ═══
function send(request) {
  return new Promise((resolve) => { const ev = { request, respondWith: async (r) => { resolve(await r); } }; if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev); });
}
async function call(jwt, method, route, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (jwt) headers['x-dds-user-jwt'] = jwt;
  return quiet(async () => answer(await send(new Request(`${FN}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }))));
}
{
  restore();
  let m = mark();
  let r = await call(null, 'POST', '/site/offline');
  ok('router: POST /site/offline signed out is a 401, and nothing deploys', r.status === 401 && deploysSince(m).length === 0 && ORDER.every((id) => offlineAt(id) === null), `${r.status} ${r.text.slice(0, 120)}`);
  m = mark();
  r = await call(BIZ[SITE_B].jwt, 'POST', '/site/offline', { site_id: SITE_A });
  ok('router: the site comes from the sign-in, never the request: the other owner naming this site takes only their own offline', r.status === 200 && !!offlineAt(SITE_B) && offlineAt(SITE_A) === null && deploysSince(m).every((d) => d.site === BIZ[SITE_B].nf) && deploysSince(m).length === 1, `${r.status} ${r.text.slice(0, 160)}`);
  m = mark();
  r = await call(BIZ[SITE_A].jwt, 'GET', '/site/offline');
  ok('router: GET /site/offline is not a way to take a site offline', r.status === 404 && offlineAt(SITE_A) === null && deploysSince(m).length === 0, `${r.status} ${r.text.slice(0, 120)}`);
  m = mark();
  r = await call(BIZ[SITE_A].jwt, 'POST', '/site/offline');
  ok('router: POST /site/offline from the owner takes their own site offline', r.status === 200 && r.body?.data?.offline === true && !!offlineAt(SITE_A) && deploysSince(m).length === 1 && deploysSince(m)[0].site === BIZ[SITE_A].nf, `${r.status} ${r.text.slice(0, 160)}`);
  m = mark();
  r = await call(null, 'POST', '/site/online');
  ok('router: POST /site/online signed out is a 401, and the site stays offline', r.status === 401 && !!offlineAt(SITE_A) && deploysSince(m).length === 0, `${r.status}`);
  const pubs = db.tables.presence_publishes.length;
  r = await call(BIZ[SITE_A].jwt, 'POST', '/site/online');
  ok('router: POST /site/online from the owner brings their site back through a publish', r.status === 200 && offlineAt(SITE_A) === null && !!offlineAt(SITE_B) && db.tables.presence_publishes.slice(pubs).some((p) => p.site_id === SITE_A && p.kind === 'restore'), `${r.status} ${r.text.slice(0, 160)}`);
}
{
  restore();
  const snaps = db.tables.presence_snapshots.length;
  let r = await call(null, 'POST', '/preview/share-link', { capture: true });
  ok('router: POST /preview/share-link signed out is a 401, and captures nothing', r.status === 401 && db.tables.presence_snapshots.length === snaps);
  r = await call(BIZ[SITE_A].jwt, 'POST', '/preview/share-link', { capture: true, ttl_seconds: 7 * 86400 });
  const tok = tokenOf(r.body?.data?.url || 'https://x/') || '';
  const v = await verifyPreviewToken(tok, 'preview-secret-0111', now());
  ok('router: POST /preview/share-link from the owner signs a link to their own site', r.status === 200 && v.ok && v.payload.site_id === SITE_A, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(null, 'GET', `/p/s/${tok}`);
  ok('router: GET /p/s/:token is public, no sign-in, and goes on to the viewer', r.status === 302 && r.headers.get('Location') === `https://app.example.test/draft.html?s=${encodeURIComponent(tok)}`, `${r.status} ${r.headers.get('Location')}`);
  r = await call(null, 'GET', `/p/s/${tok}?embed=1`);
  ok('router: the viewer’s ask for the page needs no sign-in either, and gets the draft', r.status === 200 && r.text.includes('Alpha Bakery'), `${r.status}`);
  const when = soon(5 * DAY);
  r = await call(BIZ[SITE_A].jwt, 'POST', '/schedule', { kind: 'offline', scheduled_for: when, site_id: SITE_B });
  const row = db.tables.presence_scheduled_publishes.at(-1);
  ok('router: POST /schedule from the owner stores the offline row for their own site, whatever the body says', r.status === 200 && db.tables.presence_scheduled_publishes.length === 1 && row.site_id === SITE_A && row.kind === 'offline' && row.snapshot_id === null, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  restore();
  await run(() => COM.handleScheduleCreate(req('POST', '/schedule', { kind: 'offline', scheduled_for: soon(-30_000) }), siteOf(SITE_A), OWNER[SITE_A], {}));
  const row = db.tables.presence_scheduled_publishes[0];
  let m = mark();
  let r = await call(null, 'POST', '/system/run', { task: 'publish' });
  ok('router: the cron door without the scheduler secret is a 403, and nothing fires', r.status === 403 && row.status === 'pending' && row.fired_at === null && offlineAt(SITE_A) === null && deploysSince(m).length === 0, `${r.status}`);
  m = mark();
  r = await call(null, 'POST', '/system/run', { task: 'publish', secret: 'cron-secret-0111' });
  ok('router: the cron door with the secret fires the due offline row', r.status === 200 && r.body?.data?.ran === 1 && db.tables.presence_scheduled_publishes[0].status === 'done' && !!offlineAt(SITE_A) && deploysSince(m).length === 1, `${r.status} ${r.text.slice(0, 160)}`);
}

// ═══ 15. migration 0111 and its APPLY pack ═══
{
  const read = (p) => Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url));
  const sql = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join(' ').replace(/\s+/g, ' ').trim();
  const migText = read('supabase/migrations/0111_offline_unpublish.sql');
  const packText = read('docs/presence/APPLY-0111-prod.sql');
  // pin: there is no database here; the column, the kind check and the nullable snapshot are the SQL itself
  ok('migration 0111: offline_at on sites, the offline kind, and an offline row needs no snapshot', /alter table public\.presence_sites add column if not exists offline_at timestamptz;/.test(sql(migText)) && /check \(kind in \('publish','revert','offline'\)\)/.test(sql(migText)) && /alter table public\.presence_scheduled_publishes alter column snapshot_id drop not null;/.test(sql(migText)));
  // pin: additive only; the one drop is the old kind check, swapped for the wider one
  ok('migration 0111: additive, nothing dropped but the old kind check, no rows changed', !/drop table|drop column|delete from|update public/i.test(sql(migText)) && (sql(migText).match(/drop constraint/g) || []).length === 1);
  // pin: the pack is what gets run on production; it must be the migration, in one transaction, under the house header
  ok('apply pack: APPLY-0111 is the house pack for 0111 and runs exactly the migration, in one transaction', /APPLY PACK · migration 0111/.test(packText) && sql(packText) === `begin; ${sql(migText)} commit;`);
}

// Covered in the browser by (the page checks this suite used to make on presence.html's text):
//   · tests/e2e/editor-comforts-158-two.spec.ts › open the draft on your phone (builder item 158) ›
//       Preview’s On my phone shows the code for the private link; Escape closes the card, not Preview
//       (the link is minted with { capture: true, ttl_seconds: 604800 })
//   · tests/e2e/editor-comforts-158-two.spec.ts › open the draft on your phone (builder item 158) ›
//       the Page menu has Open on my phone… beside Share a draft link…
//   · tests/e2e/schedule.spec.ts › Scheduling — one place, inside Publish ›
//       the publish page opens with the schedule panel already on it — resting until the date field has focus
//   · tests/e2e/schedule.spec.ts › Scheduling — one place, inside Publish › what is already scheduled is listed with its own Cancel
//   · tests/e2e/thin-spots.spec.ts › the Welcome panel’s status ›
//       a live site taken offline from it: the question says what happens, and the panel follows
//       (Take Marlow’s Kitchen OFFLINE now? … Nothing is deleted; then Bring back online)
//   · tests/e2e/site-home.spec.ts › the welcome list › a site taken offline says so and brings itself back with one button
//       (Bring back online sends POST /site/online)
//   · tests/e2e/publish-offline-share-212.spec.ts (new with this rewrite): Share a draft link… copies the
//       fresh 7-day link; the schedule panel's "Also take the site offline later" sends kind offline after
//       the publish, refuses an offline time before it, and lists a scheduled offline row with its Cancel;
//       the Page menu's Take site offline… asks first, and its Bring back online sends POST /site/online

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PUBLISH SURFACE (G5/G6/G10): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
Deno.exit(passed === results.length ? 0 : 1);
