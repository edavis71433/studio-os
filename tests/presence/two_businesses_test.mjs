// ── One person, two businesses (builder item 83) ─────────────────────────────
// Before, an invited member reached only their oldest seat, and the second invite did
// nothing anyone could see (deep pass part 4.9). Now the ?client= every page already
// sends picks one of the person's own businesses: a site they own, or one where they
// hold a seat. A studio's own rules are asked first and are unchanged; a person's own
// business is opened as themself, never as a studio. This drives the real
// lib/scope.ts, lib/workspace.ts and /portal/context against an in-memory PostgREST
// that keeps row level security's one rule (a sign-in sees only the sites it owns):
//   · the pick: owned, seat, neither; never another tenant; nothing recorded as a
//     studio visit when it is the person's own business, the refusal kept when not;
//   · a studio inside its client is untouched, and a studio member's own seat elsewhere works;
//   · the list for the switch: only someone invited somewhere, with two or more;
//   · /portal/context says which business this is, with the role in words;
//   · index.ts stamps a seat in one place, and a held business never sets a studio scope.
//
//   deno run --allow-read --allow-env --allow-net tests/presence/two_businesses_test.mjs
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example' })) Deno.env.set(k, v);

const P = '../../supabase/functions/presence';
const { resolveScopedSite } = await import(`${P}/lib/scope.ts`);
const { resolveHeldBusiness, listBusinesses, resolveSiteRoleCached } = await import(`${P}/lib/workspace.ts`);
const { handlePortalContext } = await import(`${P}/routes/workspace.ts`);
const { siteDb } = await import(`${P}/lib/db.ts`);

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const MAPLE = uuid('a'), JUNIPER = uuid('b'), BLUEBIRD = uuid('c'), STRANGER = uuid('d'), STUDIO_SITE = uuid('e'), CLIENT_OF_STUDIO = uuid('f'), AGENCY = uuid('9');
const USERS = {
  'jwt-dana': { id: uuid('1'), email: 'dana@example.com' },        // Staff on Maple, Co-owner on Juniper, Reviewer on Bluebird
  'jwt-mia': { id: uuid('2'), email: 'mia@juniper.example' },      // owns Juniper, Staff on Maple
  'jwt-solo': { id: uuid('3'), email: 'solo@maple.example' },      // owns Maple, invited nowhere
  'jwt-studio': { id: uuid('4'), email: 'eric@studio.example' },   // a studio owner; Staff on Bluebird, which isn't a client
  'jwt-designer': { id: uuid('5'), email: 'dee@studio.example' },  // a studio designer (can't open clients); Staff on Bluebird
  'jwt-one': { id: uuid('6'), email: 'one@seat.example' },         // one seat, nothing else
};
const SITE = (id, client) => ({ id, client_id: client, status: 'live', last_published_at: null, template_slug: 'atelier', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence', created_at: '2026-01-01T00:00:00Z' });
let DB, OWNS, audits;
function reset() {
  DB = {
    presence_sites: [SITE(MAPLE, uuid('7')), SITE(JUNIPER, uuid('8')), SITE(BLUEBIRD, uuid('0')), SITE(STRANGER, uuid('6')), SITE(STUDIO_SITE, uuid('5')), SITE(CLIENT_OF_STUDIO, uuid('4'))],
    presence_site_members: [
      { site_id: MAPLE, email: 'dana@example.com', user_id: USERS['jwt-dana'].id, role: 'business_staff', status: 'active', created_at: '2026-02-01T00:00:00Z' },
      { site_id: JUNIPER, email: 'dana@example.com', user_id: null, role: 'business_owner', status: 'active', created_at: '2026-03-01T00:00:00Z' },
      { site_id: BLUEBIRD, email: 'dana@example.com', user_id: null, role: 'client_reviewer', status: 'active', created_at: '2026-04-01T00:00:00Z' },
      { site_id: STRANGER, email: 'dana@example.com', user_id: null, role: 'developer', status: 'revoked', created_at: '2026-05-01T00:00:00Z' },
      { site_id: MAPLE, email: 'mia@juniper.example', user_id: null, role: 'business_staff', status: 'active', created_at: '2026-02-02T00:00:00Z' },
      { site_id: BLUEBIRD, email: 'eric@studio.example', user_id: null, role: 'business_staff', status: 'active', created_at: '2026-02-03T00:00:00Z' },
      { site_id: BLUEBIRD, email: 'dee@studio.example', user_id: null, role: 'business_staff', status: 'active', created_at: '2026-02-04T00:00:00Z' },
      { site_id: JUNIPER, email: 'one@seat.example', user_id: null, role: 'weird_role', status: 'active', created_at: '2026-02-05T00:00:00Z' },
    ],
    presence_identity: [{ site_id: MAPLE, business_name: 'Maple & Main Realty' }, { site_id: JUNIPER, business_name: 'Juniper Floral Co.' }, { site_id: BLUEBIRD, business_name: 'Bluebird Bakery' }],
    presence_agency_members: [
      { id: uuid('7'), agency_id: AGENCY, email: 'eric@studio.example', user_id: USERS['jwt-studio'].id, role: 'owner', status: 'active' },
      { id: uuid('8'), agency_id: AGENCY, email: 'dee@studio.example', user_id: USERS['jwt-designer'].id, role: 'designer', status: 'active' },
    ],
    presence_agencies: [{ id: AGENCY, name: 'Bright Studio', status: 'active', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} }],
    presence_agency_clients: [{ agency_id: AGENCY, site_id: CLIENT_OF_STUDIO, status: 'active' }],
    presence_scoped_access_events: [],
  };
  // row level security's one rule here: a sign-in sees only the sites it owns
  OWNS = { 'jwt-mia': [JUNIPER], 'jwt-solo': [MAPLE], 'jwt-studio': [STUDIO_SITE] };
  audits = DB.presence_scoped_access_events;
}
const splitTop = (s) => { const out = []; let depth = 0, cur = ''; for (const c of s) { if (c === '(') depth++; if (c === ')') depth--; if (depth === 0 && c === ',') { out.push(cur); cur = ''; } else cur += c; } if (cur) out.push(cur); return out; };
function cond(row, expr) {
  const m = /^(and|or)\((.*)\)$/.exec(expr);
  if (m) { const parts = splitTop(m[2]); return m[1] === 'and' ? parts.every((p) => cond(row, p)) : parts.some((p) => cond(row, p)); }
  const [col, op, ...rest] = expr.split('.'); const val = rest.join('.');
  if (op === 'eq') return String(row[col]) === val;
  if (op === 'neq') return String(row[col]) !== val;
  if (op === 'in') return val.slice(1, -1).split(',').includes(String(row[col]));
  if (op === 'is') return row[col] === null || row[col] === undefined;
  throw new Error('stub: no op ' + op);
}
const CTRL = ['select', 'limit', 'order'];
function filterRows(table, params) {
  let rows = (DB[table] || []).filter((r) => [...params.entries()].every(([k, v]) => CTRL.includes(k) || (k === 'or' ? cond(r, `or${v}`) : cond(r, `${k}.${v}`))));
  const order = params.get('order'); if (order) { const [col, dir] = order.split('.'); rows = rows.slice().sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1)); }
  const lim = Number(params.get('limit')); if (lim) rows = rows.slice(0, lim);
  return rows;
}
const reply = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'content-range': '*/0' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  const token = (new Headers(init.headers).get('Authorization') || '').replace(/^Bearer /, '');
  if (u.pathname === '/auth/v1/user') return USERS[token] ? reply(USERS[token]) : reply({}, 401);
  if (!u.pathname.startsWith('/rest/v1/')) return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', '');
  if (method === 'HEAD') return reply(null);
  if (method === 'POST') { const body = JSON.parse(init.body || '{}'); (DB[table] = DB[table] || []).push(body); return reply(null, 201); }
  if (method !== 'GET') return reply([]);
  if (token !== 'SERVICE-KEY') {   // a user's own sign-in: row level security
    if (table !== 'presence_sites') return reply([]);
    return reply(filterRows(table, u.searchParams).filter((s) => (OWNS[token] || []).includes(s.id)));
  }
  return reply(filterRows(table, u.searchParams));
};
const principalOf = (jwt, extra = {}) => ({ kind: 'client', userId: USERS[jwt].id, tenantId: null, role: 'client', email: USERS[jwt].email, jwt, requestId: 'test', ...extra });
const audit = { route: '/portal/context', method: 'GET', requestId: 'test' };
const pick = (jwt, siteId, extra = {}) => { const p = principalOf(jwt, extra); return resolveScopedSite(jwt, siteId, audit, (id) => resolveHeldBusiness(jwt, p, id)); };
const quiet = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };

// ═══ 1. picking one of your own businesses ═══
{
  reset();
  const staff = await pick('jwt-dana', MAPLE);
  ok('pick: a seat opens that business, with the seat\'s role, as the person themself', staff.ok && staff.site.id === MAPLE && staff.held?.member?.role === 'business_staff' && !('scoped' in staff));
  const co = await pick('jwt-dana', JUNIPER);
  ok('pick: a second seat, matched by email before their first sign-in there, opens the second business', co.ok && co.site.id === JUNIPER && co.held.member.role === 'business_owner');
  const rev = await pick('jwt-dana', BLUEBIRD);
  ok('pick: a reviewer seat opens as a reviewer (the reviewer boundary still applies)', rev.ok && rev.held.member.role === 'client_reviewer');
  ok('pick: none of that is recorded as a studio visit', audits.length === 0);
  const owned = await pick('jwt-mia', JUNIPER);
  ok('pick: a site you own opens with no seat (row level security proves it)', owned.ok && owned.site.id === JUNIPER && owned.held.member === null);
  const theirs = await pick('jwt-mia', MAPLE);
  ok('pick: …and the owner\'s seat elsewhere opens that one', theirs.ok && theirs.held.member.role === 'business_staff');
}

// ═══ 2. never anything else ═══
{
  reset();
  const gone = await pick('jwt-dana', STRANGER);
  ok('refused: a removed seat opens nothing, and the refusal is recorded as before', !gone.ok && gone.status === 403 && audits.length === 1 && audits[0].outcome === 'denied');
  reset();
  const other = await pick('jwt-solo', JUNIPER);
  ok('refused: someone else\'s business', !other.ok && other.status === 403 && audits.length === 1);
  reset();
  const forged = await pick('jwt-dana', CLIENT_OF_STUDIO);
  ok('refused: a studio\'s client, to someone who isn\'t the studio', !forged.ok && forged.status === 403);
  reset();
  const odd = await pick('jwt-one', JUNIPER);
  ok('refused: a seat with a role this code doesn\'t know', !odd.ok);
  reset();
  const bad = await pick('jwt-dana', "x' OR 1=1");
  ok('refused: a malformed id, before anything is asked', !bad.ok && bad.status === 400);
  ok('held: never for platform staff, nor for a malformed id', (await resolveHeldBusiness('jwt-dana', principalOf('jwt-dana', { kind: 'staff' }), MAPLE)) === null && (await resolveHeldBusiness('jwt-dana', principalOf('jwt-dana'), 'nope')) === null);
  reset();
  const plain = await resolveScopedSite('jwt-dana', MAPLE, audit);
  ok('unchanged: without the held check (every older caller), a seat holder is refused as before', !plain.ok && plain.reason === 'not_agency');
}

// ═══ 3. a studio is unchanged ═══
{
  reset();
  const drill = await pick('jwt-studio', CLIENT_OF_STUDIO);
  ok('studio: inside its own client it is still the studio (a scope, recorded as allowed)', drill.ok && drill.scoped?.site_id === CLIENT_OF_STUDIO && !('held' in drill) && audits.length === 1 && audits[0].outcome === 'allowed');
  reset();
  const own = await pick('jwt-studio', BLUEBIRD);
  ok('studio: a studio owner with a seat on a business that isn\'t their client opens it by the seat', own.ok && own.held?.member?.role === 'business_staff' && audits.length === 0);
  reset();
  const des = await pick('jwt-designer', BLUEBIRD);
  ok('studio: a designer (who can\'t open clients) still opens a business that seated them', des.ok && des.held?.member?.role === 'business_staff');
  reset();
  const desClient = await pick('jwt-designer', CLIENT_OF_STUDIO);
  ok('studio: …but still can\'t open the studio\'s clients', !desClient.ok && desClient.reason === 'role');
}

// ═══ 4. what the pick hands the data path ═══
{
  reset();
  const staff = await pick('jwt-dana', MAPLE);
  const p = principalOf('jwt-dana', { member: staff.held.member });
  ok('role: the picked seat decides the role there', (await resolveSiteRoleCached(p, 'jwt-dana', MAPLE)) === 'business_staff');
  const db = siteDb('jwt-dana', staff.site, p);
  const r = await db(`presence_identity?site_id=eq.${MAPLE}&select=business_name`);
  ok('data: a full-workspace seat reads that business through the pinned path', r.ok && r.json[0]?.business_name === 'Maple & Main Realty');
  const leak = await quiet(() => db(`presence_identity?site_id=eq.${JUNIPER}&select=business_name`));
  ok('data: …and only that business', !leak.ok && leak.status === 403);
  const owned = await pick('jwt-mia', JUNIPER);
  const own = principalOf('jwt-mia', { member: owned.held.member });
  ok('data: an owned business stays under the owner\'s own sign-in (row level security)', own.member === null && (await resolveSiteRoleCached(own, 'jwt-mia', JUNIPER)) === 'business_owner');
}

// ═══ 5. the list the switch shows ═══
{
  reset();
  const dana = await listBusinesses('jwt-dana', principalOf('jwt-dana'));
  ok('list: every business with an active seat, oldest first, named, removed ones left out', dana.map((b) => b.name).join(' · ') === 'Maple & Main Realty · Juniper Floral Co. · Bluebird Bakery' && dana.every((b) => !b.owned));
  ok('list: the role on each', dana.map((b) => b.role).join(',') === 'business_staff,business_owner,client_reviewer');
  const mia = await listBusinesses('jwt-mia', principalOf('jwt-mia'));
  ok('list: what you own comes first, marked as owned', mia.length === 2 && mia[0].site_id === JUNIPER && mia[0].owned && mia[1].site_id === MAPLE && !mia[1].owned);
  ok('list: someone invited nowhere gets none, so nothing changes for them', (await listBusinesses('jwt-solo', principalOf('jwt-solo'))).length === 0);
  DB.presence_site_members = DB.presence_site_members.filter((s) => s.email !== 'mia@juniper.example');
  DB.presence_site_members.push({ site_id: JUNIPER, email: 'mia@juniper.example', user_id: null, role: 'business_staff', status: 'active', created_at: '2026-06-01T00:00:00Z' });
  const same = await listBusinesses('jwt-mia', principalOf('jwt-mia'));
  ok('list: a seat on a business you own counts once, as owned (and one business is no list)', same.length === 0);
  ok('list: platform staff get none', (await listBusinesses('jwt-dana', principalOf('jwt-dana', { kind: 'staff' }))).length === 0);
}

// ═══ 6. /portal/context says which business this is ═══
{
  reset();
  const ctxOf = async (principal, site, scopedName = null) => { const res = await quiet(() => handlePortalContext(principal.jwt, site, principal, {}, scopedName)); return (await res.json()).data; };
  const maple = DB.presence_sites.find((s) => s.id === MAPLE);
  const c = await ctxOf(principalOf('jwt-dana', { member: { site_id: MAPLE, role: 'business_staff' } }), maple);
  ok('context: the businesses, with the role in words and the current one marked', c.businesses.length === 3 && c.businesses.map((b) => b.role_words).join(',') === 'Staff,Co-owner,Reviewer' && c.businesses[0].current === true && c.businesses.filter((b) => b.current).length === 1);
  ok('context: …and which business this is', c.business && c.business.site_id === MAPLE && c.business.name === 'Maple & Main Realty' && c.business.role_words === 'Staff');
  ok('context: the first is the one the server opens when nothing is picked (the oldest seat here), so it needs no ?client=', c.businesses.map((b) => b.default).join(',') === 'true,false,false');
  ok('context: a held business is never a studio scope', c.scope === null);
  const juniper = DB.presence_sites.find((s) => s.id === JUNIPER);
  const m = await ctxOf(principalOf('jwt-mia'), juniper);
  ok('context: the owner reads "Owner" on what they own', m.business?.role_words === 'Owner' && m.businesses.find((b) => b.site_id === MAPLE)?.role_words === 'Staff');
  ok('context: …and what they own is the default, ahead of their seats', m.businesses[0].site_id === JUNIPER && m.businesses[0].default === true);
  const solo = await ctxOf(principalOf('jwt-solo'), maple);
  ok('context: someone with one business gets an empty list and no business line', Array.isArray(solo.businesses) && solo.businesses.length === 0 && solo.business === null);
  const studio = await ctxOf(principalOf('jwt-studio', { scope: { site_id: CLIENT_OF_STUDIO, name: 'Client' } }), DB.presence_sites.find((s) => s.id === CLIENT_OF_STUDIO), 'Client');
  ok('context: a studio inside a client gets no business list (it has Switch site)', studio.businesses.length === 0 && studio.business === null);
}

// ═══ 7. wiring ═══
{
  const idx = read('supabase/functions/presence/index.ts');
  ok('index: the studio check is asked first, with the person\'s own businesses as its fallback', /resolveScopedSite\(jwt, scopeReq, \{[\s\S]*?\}, \(id\) => resolveHeldBusiness\(jwt, principal, id\)\);/.test(idx));
  const heldBranch = idx.slice(idx.indexOf("if ('held' in sc) {"), idx.indexOf('} else {', idx.indexOf("if ('held' in sc) {")));
  ok('index: a held business sets no studio scope and no client name', heldBranch.includes('seated = sc.held;') && !heldBranch.includes('principal.scope') && !heldBranch.includes('scopedName'));
  ok('index: a seat is stamped in one place, for a client caller alone', idx.includes("if (principal.kind === 'client') principal.member = seated.member;") && idx.split('principal.member =').length === 2);
  const scope = read('supabase/functions/presence/lib/scope.ts');
  ok('scope: only "not a studio", "a role that can\'t open clients" and "not your client" fall back to the person\'s own businesses', scope.includes("if (!pre.ok && held && (pre.reason === 'not_agency' || pre.reason === 'role' || pre.reason === 'unauthorized')) {"));
  ok('scope: a held answer must be the site that was asked for', scope.includes('if (own && own.site.id === requestedSiteId) return { ok: true, site: own.site, held: own };'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ TWO BUSINESSES: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
