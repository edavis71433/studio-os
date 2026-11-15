// ── A trash for sites, and deleted pages kept 30 days (builder list item 154) ──
// File 02 finding 6 and file 03 finding 7 (Nov 10 review): a studio could neither put a
// finished site away nor safely remove one, and a deleted page could only come back in
// the 20 seconds of its Undo: restoring a version or the "Before deleting" checkpoint
// never brought pages back (lib/draft_writer.ts rewrites business details and lists,
// not pages). This suite pins:
//   · the pure rules (lib/site_trash.ts): the 90-day and 30-day clocks, the Trash list,
//     the deleted-pages list, a free address for a page that comes back;
//   · the routes, through the real handleAgency() against an in-memory PostgREST and a
//     stand-in for the hosting: Move to trash (who may, before the database step, a
//     site that isn't live, a live site taken offline, a failed take-down that leaves
//     everything as it was), the Trash on Sites and its absence from Home, Restore;
//   · the daily job that empties the trash after 90 days, and what it never touches;
//     item 204 (Nov 12 review, finding 94): only a site nobody owns is deleted for good;
//     a site with an owner is let go of, kept whole, and its owner is emailed, as they
//     are when it goes in the trash;
//   · Versions' deleted pages: the list and Put back;
//   · the wiring: the job in both sweeps, the migration and its pack, the member gate.
//   deno run --allow-read --allow-env tests/presence/site_trash_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'service-key');
Deno.env.set('NETLIFY_AUTH_TOKEN', 'netlify-test');
Deno.env.set('DEPLOY_POLL_MS', '50');
Deno.env.set('RESEND_KEY', 'test-resend-key');   // item 204: the owner's emails are the outside calls that prove they were told
const T_ = await import('../../supabase/functions/presence/lib/site_trash.ts');
const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');
const { runSiteTrashPurge } = await import('../../supabase/functions/presence/ops/site_trash.ts');
const { handleDeletedPages, handleDeletedPageRestore } = await import('../../supabase/functions/presence/routes/deleted_pages.ts');
const { contentWriteNeeds } = await import('../../supabase/functions/presence/lib/site_roles.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const DAY = 86_400_000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();

// ═══ 1. the pure rules ═══
{
  const at = '2026-11-10T12:00:00.000Z';
  ok('clock: a site trashed today goes 90 days later', T_.goesAt(at, 90) === '2027-02-08T12:00:00.000Z' && T_.goesAt('', 90) === null);
  ok('clock: days left count down to 0, never below', T_.daysLeft('2026-11-10T12:00:00.000Z', at, 90) === 90 && T_.daysLeft('2027-02-07T13:00:00.000Z', at, 90) === 1 && T_.daysLeft('2027-03-01T00:00:00.000Z', at, 90) === 0);
  ok('clock: due on the 90th day, not before', T_.trashDue('2027-02-08T12:00:00.000Z', at) && !T_.trashDue('2027-02-08T11:59:00.000Z', at) && !T_.trashDue(at, null));
  const trash = T_.buildTrash([{ site_id: 'a', trashed_at: '2026-10-02T00:00:00Z', trashed_by: 'pat@studio.example', trashed_was_live: true }, { site_id: 'b', trashed_at: '2026-11-10T00:00:00Z' }, { site_id: 'c', trashed_at: null }], { a: 'Maple Street Bakery', b: 'Ortiz Photography' }, '2026-11-10T00:00:00Z');
  ok('trash list: newest first, named, with the day it goes and the days left; a row without a date isn\'t one', trash.length === 2 && trash[0].name === 'Ortiz Photography' && trash[0].days_left === 90 && trash[1].days_left === 51 && trash[1].was_live === true && trash[1].goes_at === '2026-12-31T00:00:00.000Z');
  const pages = T_.deletedPagesList([
    { id: '1', slug: 'gallery', title: 'Gallery', page: { slug: 'gallery', title: 'Gallery', blocks: [{}, {}, {}] }, deleted_at: '2026-11-09T00:00:00Z' },
    { id: '2', slug: 'old', title: '', page: { title: 'Old specials', blocks: [] }, deleted_at: '2026-10-01T00:00:00Z' },
    { id: '3', slug: 'spring', title: 'Spring', page: { blocks: [{}] }, deleted_at: '2026-10-20T00:00:00Z' },
  ], '2026-11-10T00:00:00Z');
  ok('deleted pages: only the last 30 days, newest first, with their sections and days left', pages.length === 2 && pages[0].title === 'Gallery' && pages[0].sections === 3 && pages[0].days_left === 29 && pages[1].slug === 'spring' && pages[1].days_left === 9);
  ok('address: its own when free, else the first free -2, -3', T_.freeSlug('gallery', ['about']) === 'gallery' && T_.freeSlug('gallery', ['gallery', 'gallery-2']) === 'gallery-3');
}

// ═══ 2. the routes ═══
const AG = 'aaaaaaaa-0000-4000-8000-000000000001';
const ME = '11111111-1111-4111-8111-111111111111', RO = '33333333-3333-4333-8333-333333333333';
const UID = '99999999-0000-4000-8000-000000000009';
const LIVE = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', DRAFT = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', OLD = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', OLD2 = 'c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4', FRESH = 'c5c5c5c5-c5c5-4c5c-8c5c-c5c5c5c5c5c5';
const OWN = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', STRANGER = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const CL = 'c1000000-0000-4000-8000-000000000001', CD = 'c1000000-0000-4000-8000-000000000002', CO1 = 'c1000000-0000-4000-8000-000000000003', CO2 = 'c1000000-0000-4000-8000-000000000004', CF = 'c1000000-0000-4000-8000-000000000005', COWN = 'c1000000-0000-4000-8000-000000000006';
let T, writes, netlify, opts, mails = [];
function reset(o = {}) {
  opts = { noTrashState: false, deployFails: false, deleteFails: false, noDeletedPages: false, ownerReadFails: false, ...o };
  mails = [];
  const link = (site_id, over = {}) => ({ site_id, agency_id: AG, status: 'active', tags: [], owner_email: '', assigned: [], notes: '', onboarded_at: '2026-01-01T00:00:00Z', trashed_at: null, trashed_by: null, trashed_was_live: false, ...over });
  const site = (id, client, over = {}) => ({ id, client_id: client, edition: 'presence', status: 'ready', last_published_at: null, custom_domain: null, netlify_site_id: null, template_slug: 'business-classic', template_version: '1.0.0', offline_at: null, ...over });
  T = {
    presence_agency_members: [{ id: ME, agency_id: AG, email: 'eric@studio.example', role: 'owner', status: 'active', user_id: UID }, { id: RO, agency_id: AG, email: 'ro@studio.example', role: 'readonly', status: 'active' }],
    presence_agency_clients: [link(LIVE), link(DRAFT),
      link(OLD, { status: 'trashed', trashed_at: ago(91), trashed_by: 'eric@studio.example', trashed_was_live: true }),
      link(OLD2, { status: 'trashed', trashed_at: ago(95), trashed_by: 'eric@studio.example' }),
      link(FRESH, { status: 'trashed', trashed_at: ago(10), trashed_by: 'eric@studio.example' })],
    presence_sites: [site(LIVE, CL, { status: 'live', last_published_at: '2026-10-01T00:00:00Z', netlify_site_id: 'nf-live', custom_domain: 'live.example' }), site(DRAFT, CD),
      site(OLD, CO1, { netlify_site_id: 'nf-old', custom_domain: 'old.example', offline_at: ago(91) }), site(OLD2, CO2, { netlify_site_id: 'nf-old2' }), site(FRESH, CF, { netlify_site_id: 'nf-fresh' }), site(OWN, COWN, { status: 'live' }), site(STRANGER, 'c-x')],
    clients: [{ id: CL, name: 'Live Bakery', email: 'owner@live.example' }, { id: CD, name: 'Draft Florist', email: null }, { id: CO1, name: 'Old Photography', email: 'old@photo.example', contact_id: 'k1' }, { id: CO2, name: 'Never Invited', email: null, contact_email: null, contact_id: null }, { id: CF, name: 'Fresh Trash', email: null }],
    presence_identity: [{ site_id: LIVE, business_name: 'Live Bakery', email: 'hi@live.example', phone: '555' }],
    presence_agencies: [{ id: AG, name: 'Bright Studio' }],   // item 204: the studio's name in the owner's email
    presence_publishes: [{ id: 'p1', site_id: LIVE, status: 'live', created_at: '2026-10-01T00:00:00Z' }],
    presence_deleted_pages: [
      { id: 'dddddddd-0000-4000-8000-000000000001', site_id: DRAFT, slug: 'gallery', title: 'Gallery', page: { slug: 'gallery', title: 'Gallery', blocks: [{ type: 'richtext', body: 'Our work' }] }, deleted_at: ago(1) },
      { id: 'dddddddd-0000-4000-8000-000000000002', site_id: DRAFT, slug: 'ancient', title: 'Ancient', page: { slug: 'ancient', title: 'Ancient', blocks: [] }, deleted_at: ago(31) },
      { id: 'dddddddd-0000-4000-8000-000000000003', site_id: LIVE, slug: 'theirs', title: 'Theirs', page: { slug: 'theirs', blocks: [] }, deleted_at: ago(1) },
    ],
    presence_settings: [{ site_id: DRAFT, pages: [{ slug: 'gallery', title: 'Gallery (new)', blocks: [] }, { slug: 'about-us', title: 'About us', blocks: [] }] }],
  };
  writes = []; netlify = [];
}
function match(r, k, v) {
  const val = (x) => decodeURIComponent(x).replace(/^"(.*)"$/, '$1');
  if (v.startsWith('eq.')) return String(r[k]) === val(v.slice(3));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(r[k]));
  if (v.startsWith('lte.')) return r[k] != null && Date.parse(r[k]) <= Date.parse(val(v.slice(4)));
  if (v.startsWith('gt.')) return r[k] != null && Date.parse(r[k]) > Date.parse(val(v.slice(3)));
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
  return true;
}
const CTRL = ['select', 'limit', 'order', 'on_conflict'];
const rowsFor = (table, params) => { let rows = (T[table] || []).filter((r) => [...params.entries()].every(([k, v]) => CTRL.includes(k) || match(r, k, v))); const lim = Number(params.get('limit')); return lim ? rows.slice(0, lim) : rows; };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? (typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : init.body) : null;
  const reply = (b, status = 200) => new Response(b === null ? null : JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.host === 'api.resend.com') { mails.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ id: `e${mails.length}` }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  if (u.host === 'api.netlify.com') {
    netlify.push({ method, path: u.pathname });
    if (/\/sites\/[^/]+\/deploys$/.test(u.pathname) && method === 'POST') return opts.deployFails ? reply({ message: 'boom' }, 500) : reply({ id: 'dep-1', required: [] });
    if (/\/deploys\/dep-1$/.test(u.pathname)) return reply({ id: 'dep-1', state: 'ready' });
    if (/\/sites\/[^/]+$/.test(u.pathname) && method === 'DELETE') return opts.deleteFails ? reply({}, 500) : reply(null, 204);
    return reply({});
  }
  const table = u.pathname.replace(/^.*\/rest\/v1\//, '');
  const auth = String((init.headers || {}).Authorization || '');
  if (method === 'GET' && table === 'presence_sites' && /jwt-studio/.test(auth)) return reply(T.presence_sites.filter((s) => s.id === OWN));
  if (method === 'GET' && /jwt-/.test(auth)) return reply([]);
  if (table === 'presence_deleted_pages' && opts.noDeletedPages) return reply({ code: '42P01', message: 'relation "public.presence_deleted_pages" does not exist' }, 404);
  if (method === 'GET') {
    if (table === 'presence_agency_clients' && opts.noTrashState && /trashed/.test(u.search)) return reply({ code: '42703', message: 'column presence_agency_clients.trashed_at does not exist' }, 400);
    if (table === 'clients' && opts.ownerReadFails) return reply({ message: 'boom' }, 503);
    return reply(rowsFor(table, u.searchParams));
  }
  writes.push({ table, method, body, query: u.search });
  if (method === 'PATCH') {
    if (table === 'presence_agency_clients' && opts.noTrashState && body && body.status === 'trashed') return reply({ code: '23514', message: 'new row for relation "presence_agency_clients" violates check constraint "presence_agency_clients_status_check"' }, 400);
    const hit = rowsFor(table, u.searchParams); hit.forEach((r) => Object.assign(r, body)); return reply(hit);
  }
  if (method === 'DELETE') { const hit = rowsFor(table, u.searchParams); T[table] = (T[table] || []).filter((r) => !hit.includes(r)); return reply(hit); }
  if (method === 'POST') {
    const conflict = u.searchParams.get('on_conflict');
    const list = Array.isArray(body) ? body : [body];
    const out = list.map((r) => { if (conflict) { const have = (T[table] || []).find((x) => String(x[conflict]) === String(r[conflict])); if (have) { Object.assign(have, r); return have; } } const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }; (T[table] = T[table] || []).push(row); return row; });
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
const linkOf = (id) => T.presence_agency_clients.find((l) => l.site_id === id);

// ── Move to trash ──
{
  reset({ noTrashState: true });
  const r = await call(asMember(), 'POST', `/agency/sites/${LIVE}/trash`);
  ok('trash: before the database step, a plain 503 — and the live site is never taken offline', r.status === 503 && /one database step/.test(r.body.message) && netlify.length === 0 && linkOf(LIVE).status === 'active');
  const list = await call(asMember(), 'GET', '/agency/sites');
  ok('Sites: before the step, the page still loads, with an empty Trash', list.status === 200 && Array.isArray(list.body.trash) && list.body.trash.length === 0);
}
{
  reset();
  ok('trash: a view-only member can\'t', (await call(asMember({ member_id: RO, role: 'readonly', email: 'ro@studio.example' }), 'POST', `/agency/sites/${DRAFT}/trash`)).status === 403);
  ok('trash: someone else\'s site, or one already in the trash, is not found', (await call(asMember(), 'POST', `/agency/sites/${STRANGER}/trash`)).status === 404 && (await call(asMember(), 'POST', `/agency/sites/${FRESH}/trash`)).status === 404);
  ok('trash: the refusals changed nothing', writes.length === 0 && netlify.length === 0);
  const d = await call(asMember(), 'POST', `/agency/sites/${DRAFT}/trash`);
  ok('trash: a site that was never live goes in at once — no take-down needed', d.status === 200 && d.body.data.was_live === false && d.body.data.offline === false && netlify.length === 0 && linkOf(DRAFT).status === 'trashed' && linkOf(DRAFT).trashed_by === 'eric@studio.example' && !!linkOf(DRAFT).trashed_at);
  ok('trash: the answer says when it goes for good', Math.round((Date.parse(d.body.data.goes_at) - Date.parse(d.body.data.trashed_at)) / DAY) === 90);
  const l = await call(asMember(), 'POST', `/agency/sites/${LIVE}/trash`);
  const site = T.presence_sites.find((s) => s.id === LIVE);
  ok('trash: a live site is taken offline first (the holding page goes up) and the trash remembers it was live', l.status === 200 && l.body.data.was_live === true && l.body.data.offline === true && netlify.some((n) => n.method === 'POST' && n.path === '/api/v1/sites/nf-live/deploys') && !!site.offline_at && linkOf(LIVE).trashed_was_live === true);
  ok('trash: the studio\'s history says so', T.presence_change_events.some((e) => e.site_id === OWN && e.summary === 'Moved a client site to the trash and took it offline'));
  // item 204: LIVE's owner signs in (Live Bakery, owner@live.example); DRAFT has no owner
  const toOwner = mails.filter((m) => (Array.isArray(m.to) ? m.to[0] : m.to) === 'owner@live.example');
  ok('trash (item 204): a site with an owner: they are emailed, once, that it is in the trash, offline, and nothing is deleted', l.body.data.owner_told === true && toOwner.length === 1 && toOwner[0].subject === 'Bright Studio moved Live Bakery to its trash' && /moved your website, Live Bakery, to its trash in Studio OS and took it offline\./.test(toOwner[0].html) && /Nothing has been deleted\./.test(toOwner[0].html) && /your website, your sign-in and your files stay yours/.test(toOwner[0].html), JSON.stringify(mails.map((m) => [m.to, m.subject])));
  ok('trash (item 204): …and their own history says so too, not only the studio\'s', T.presence_change_events.some((e) => e.site_id === LIVE && e.summary === 'Bright Studio moved this site to their trash and took it offline'));
  ok('trash (item 204): a site with no owner emails nobody', d.body.data.owner_told === false && mails.length === 1);
  const list = await call(asMember(), 'GET', '/agency/sites');
  const ids = (list.body.data || []).map((x) => x.site_id);
  ok('Sites: trashed sites leave the cards and the table', !ids.includes(DRAFT) && !ids.includes(LIVE));
  const trash = list.body.trash;
  ok('Sites: the Trash lists them, newest first, named, with 90 days left; the oldest with what\'s left of theirs', trash.length === 5 && trash.slice(0, 2).every((t) => t.days_left === 90) && trash.some((t) => t.name === 'Live Bakery' && t.was_live) && trash.find((t) => t.site_id === FRESH).days_left === 80 && list.body.can_trash === true && list.body.trash_days === 90);
  const home = await call(asMember(), 'GET', '/agency/portfolio');
  const homeArchived = await call(asMember(), 'GET', '/agency/portfolio?archived=true');
  ok('Home: a trashed site is on neither the list nor Archived, and is told apart so no customer row brings it back', !home.body.data.some((x) => x.site_id === DRAFT) && !homeArchived.body.data.some((x) => x.site_id === DRAFT) && home.body.archived_site_ids.includes(DRAFT));
  const ro = await call(asMember({ member_id: RO, role: 'readonly', email: 'ro@studio.example' }), 'GET', '/agency/sites');
  ok('Sites: a view-only member sees the Trash but isn\'t offered it', ro.body.can_trash === false && ro.body.trash.length === 5);
}
{
  reset({ deployFails: true });
  const r = await call(asMember(), 'POST', `/agency/sites/${LIVE}/trash`);
  ok('trash: if the site can\'t be taken offline, it stays where it was — live, in the list — and the answer says why', r.status === 502 && /couldn’t be taken offline/.test(r.body.message) && linkOf(LIVE).status === 'active' && linkOf(LIVE).trashed_at === null && !T.presence_sites.find((s) => s.id === LIVE).offline_at);
}

// ── Restore ──
{
  reset();
  ok('restore: a view-only member can\'t', (await call(asMember({ member_id: RO, role: 'readonly', email: 'ro@studio.example' }), 'POST', `/agency/sites/${FRESH}/restore`)).status === 403);
  ok('restore: a site that isn\'t in the trash is not found', (await call(asMember(), 'POST', `/agency/sites/${DRAFT}/restore`)).status === 404);
  const r = await call(asMember(), 'POST', `/agency/sites/${OLD}/restore`);
  ok('restore: back in the list, every trash mark cleared — and still offline until it is published or brought back', r.status === 200 && linkOf(OLD).status === 'active' && linkOf(OLD).trashed_at === null && linkOf(OLD).trashed_by === null && !!T.presence_sites.find((s) => s.id === OLD).offline_at);
  const list = await call(asMember(), 'GET', '/agency/sites');
  ok('restore: its card is back and it left the Trash', list.body.data.some((x) => x.site_id === OLD) && !list.body.trash.some((t) => t.site_id === OLD));
  ok('restore: the history says so', T.presence_change_events.some((e) => e.site_id === OWN && e.summary === 'Restored a client site from the trash'));
}

// ── the trash, emptied after 90 days ──
{
  reset();
  const res = await runSiteTrashPurge(10);
  ok('purge: the two sites past 90 days leave the studio; the one trashed 10 days ago and the active ones stay', res.due === 2 && res.deleted === 1 && res.kept === 1 && res.failed === 0 && !linkOf(OLD) && !linkOf(OLD2) && linkOf(FRESH)?.status === 'trashed' && linkOf(LIVE)?.status === 'active');
  ok('purge: a site nobody owns comes down for good: hosting deleted, then the site marked deleting with no host and no domain', netlify.some((n) => n.method === 'DELETE' && n.path === '/api/v1/sites/nf-old2') && T.presence_sites.find((s) => s.id === OLD2).status === 'deleting' && T.presence_sites.find((s) => s.id === OLD2).netlify_site_id === null);
  // item 204: OLD has an owner who signs in (an email and a contact): it is theirs, so nothing on it is deleted
  const old = T.presence_sites.find((s) => s.id === OLD);
  ok('purge (item 204): a site with an owner keeps its hosting, its domain and its state; only the studio lets go', !netlify.some((n) => n.method === 'DELETE' && n.path === '/api/v1/sites/nf-old') && old.netlify_site_id === 'nf-old' && old.custom_domain === 'old.example' && old.status !== 'deleting');
  const told = mails.filter((m) => (Array.isArray(m.to) ? m.to[0] : m.to) === 'old@photo.example');
  ok('purge (item 204): …and its owner is emailed that it is still theirs, once', told.length === 1 && told[0].subject === 'Bright Studio no longer looks after Old Photography' && /Nothing was deleted: your website, your sign-in and your files are still yours\. The website is offline\./.test(told[0].html) && mails.length === 1, JSON.stringify(mails.map((m) => [m.to, m.subject])));
  const dels = T.presence_account_deletions || [];
  ok('purge: a site whose owner was never invited takes its account with it; an owner who signs in keeps theirs', dels.length === 1 && dels[0].client_id === CO2 && dels[0].status === 'pending' && !dels.some((d) => d.client_id === CO1));
  ok('purge: nothing outside the trash was touched', !netlify.some((n) => /nf-live|nf-fresh/.test(n.path)) && T.presence_sites.find((s) => s.id === FRESH).status === 'ready');
}
{
  reset({ deleteFails: true });
  const res = await runSiteTrashPurge(10);
  ok('purge: if the hosting won\'t come down, nothing else happens to that site and the next run tries again (and the sweep reports it)', res.deleted === 0 && res.failed === 1 && linkOf(OLD2)?.status === 'trashed' && T.presence_sites.find((s) => s.id === OLD2).netlify_site_id === 'nf-old2' && !(T.presence_account_deletions || []).length);
  ok('purge (item 204): an owned site needs no take-down, so it is let go of all the same', res.kept === 1 && !linkOf(OLD));
}
{
  reset({ ownerReadFails: true });
  const res = await runSiteTrashPurge(10);
  ok('purge (item 204): when it can\'t be told whose a site is, nothing happens to it: no take-down, no deletion, still in the trash', res.failed === 2 && res.deleted === 0 && res.kept === 0 && !netlify.some((n) => n.method === 'DELETE') && linkOf(OLD)?.status === 'trashed' && linkOf(OLD2)?.status === 'trashed' && !(T.presence_account_deletions || []).length && mails.length === 0);
}
{
  reset({ noTrashState: true });
  const res = await runSiteTrashPurge(10);
  ok('purge: before the database step it says so and does nothing', res.unavailable === true && res.deleted === 0 && netlify.length === 0);
}

// ── Versions: the pages deleted in the last 30 days ──
const siteRow = (id) => T.presence_sites.find((s) => s.id === id);
const db = (path, init) => globalThis.fetch('http://stub.local/rest/v1/' + path, { ...(init || {}), headers: { Authorization: 'Bearer service', ...((init || {}).headers || {}) } }).then(async (r) => { const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ } return { ok: r.ok, status: r.status, json, text }; });
const restoreReq = () => new Request('http://stub.local/functions/v1/presence/pages/deleted/x/restore', { method: 'POST' });
{
  reset();
  const r = await handleDeletedPages(siteRow(DRAFT), {});
  const b = await r.json();
  ok('deleted pages: this site\'s, from the last 30 days only', r.status === 200 && b.ready === true && b.data.length === 1 && b.data[0].title === 'Gallery' && b.data[0].sections === 1 && b.keep_days === 30);
  const back = await handleDeletedPageRestore(restoreReq(), db, siteRow(DRAFT), PRINCIPAL, 'dddddddd-0000-4000-8000-000000000001', {});
  const bb = await back.json();
  const pages = T.presence_settings.find((s) => s.site_id === DRAFT).pages;
  ok('put back: the page returns at the end, as it was — under "-2" because its address is taken now', back.status === 200 && bb.data.slug === 'gallery-2' && bb.data.moved === true && pages.length === 3 && pages[2].slug === 'gallery-2' && pages[2].blocks[0].body === 'Our work' && pages[0].title === 'Gallery (new)');
  ok('put back: it leaves the list, and the history says where it went', !T.presence_deleted_pages.some((p) => p.id === 'dddddddd-0000-4000-8000-000000000001') && T.presence_change_events.some((e) => e.site_id === DRAFT && e.summary === 'Put back the page “Gallery” as /gallery-2/'));
  ok('put back: a page older than 30 days, or another site\'s, is not found', (await handleDeletedPageRestore(restoreReq(), db, siteRow(DRAFT), PRINCIPAL, 'dddddddd-0000-4000-8000-000000000002', {})).status === 404 && (await handleDeletedPageRestore(restoreReq(), db, siteRow(DRAFT), PRINCIPAL, 'dddddddd-0000-4000-8000-000000000003', {})).status === 404);
  ok('put back: a made-up id is refused before anything is read', (await handleDeletedPageRestore(restoreReq(), db, siteRow(DRAFT), PRINCIPAL, 'nope', {})).status === 400);
}
{
  reset({ noDeletedPages: true });
  const b = await (await handleDeletedPages(siteRow(DRAFT), {})).json();
  ok('deleted pages: before the database step, an empty list that says why', b.ready === false && b.data.length === 0 && /one database step/.test(b.message));
}

// ═══ 3. the wiring ═══
{
  const sys = read('supabase/functions/presence/routes/system.ts');
  ok('the job runs in the hygiene sweep and in the default tick', /\['site_trash', \(\) => runSiteTrashPurge\(10\)\]/.test(sys) && /await step\('site_trash', \(\) => runSiteTrashPurge\(10\)\)/.test(sys));
  const mig = read('supabase/migrations/0154_trash_and_deleted_pages.sql'), pack = read('docs/presence/APPLY-0154-prod.sql');
  const body = (x) => x.slice(x.indexOf('-- ── 1. the trash ──'), x.indexOf('execute function public.presence_keep_deleted_pages();'));
  ok('0154: the migration and its production pack make the same change', body(mig).length > 1000 && body(mig) === body(pack));
  ok('0154: a third state, trashed, beside active and archived', /check \(status in \('active','archived','trashed'\)\)/.test(mig));
  ok('0154: the trigger can never stand in the way of a save, and runs only when pages change', /exception when others then\s+null;/.test(mig) && /after update of pages on public\.presence_settings/.test(mig) && /when \(OLD\.pages is distinct from NEW\.pages\)/.test(mig) && /security definer set search_path = public/.test(mig));
  ok('0154: a rename isn\'t a deletion, Undo takes a page off the list, and 30 days is the keep', /renamed: the same sections under another address/.test(mig) && /a page that came back as it was \(Undo\) leaves the list/.test(mig) && /interval '30 days'/.test(mig));
  ok('the member gate: putting a page back is an edit, like duplicating one', contentWriteNeeds('/pages/deleted/dddddddd-0000-4000-8000-000000000001/restore', 'POST') === 'edit' && contentWriteNeeds('/pages/deleted', 'GET') === null);
  const idx = read('supabase/functions/presence/index.ts');
  ok('index: both routes are wired', /route === '\/pages\/deleted' && method === 'GET'\) return handleDeletedPages\(site, cors\)/.test(idx) && /handleDeletedPageRestore\(req, db, site, principal, dm\[1\], cors\)/.test(idx));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
