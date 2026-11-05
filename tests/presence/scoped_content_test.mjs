// ── A studio can read and save a client's site through ?client= (SC-1) ───────
// Found by a real publish test on 2026-11-05: an agency operator drilled into a
// client got null from GET /identity, an empty GET /offerings, 403 from PUT
// /identity and 502 from PUT /location and /settings. Those routes ran under the
// caller's JWT, and RLS (my_presence_site_ids) only admits the site's owner.
//
// The fix (lib/db.ts siteDb) gives an authorised scope the service role, refused
// unless the query is pinned to that one site. That moves the tenant boundary out
// of the database for scoped requests, so this suite pins it hard. It drives the
// REAL handlers, siteDb, resolveScopedSite, guardStaleDraft and writeChangeEvent
// against a stubbed PostgREST that applies the production RLS predicate to JWT
// callers and none to the service role. No Supabase, no credentials.
//   · every scoped read and write reaches the client's rows, and only those
//   · the same query without an authorised scope still fails exactly as production did
//   · the owner's path is unchanged: their JWT, the anon key, RLS
//   · another tenant's rows can't be reached, and denied scopes never get a site
//   · reviewer limits hold, the optimistic lock works, and events name the right hand
//
//   deno run --allow-read --allow-env --allow-net tests/presence/scoped_content_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'SERVICE-KEY');
Deno.env.set('SUPABASE_ANON_KEY', 'ANON-KEY');

const { siteDb, pinViolation } = await import('../../supabase/functions/presence/lib/db.ts');
const { resolveScopedSite } = await import('../../supabase/functions/presence/lib/scope.ts');
const { resolveSiteRole } = await import('../../supabase/functions/presence/lib/workspace.ts');
const { draftHashForSite } = await import('../../supabase/functions/presence/lib/draft_hash.ts');
const { handleGetIdentity, handlePutIdentity } = await import('../../supabase/functions/presence/routes/identity.ts');
const { handleCollection, handleLocation, handleVoice, handleSettings, handlePageDuplicate } = await import('../../supabase/functions/presence/routes/content.ts');
const { handleGetSite } = await import('../../supabase/functions/presence/routes/site.ts');
const { handleBrandProfileGet, handleBrandProfilePut, handleBrandReportList, handleBrandReportGet } = await import('../../supabase/functions/presence/routes/brand.ts');
const { handleKnowledgeList } = await import('../../supabase/functions/presence/routes/knowledge.ts');
const { handleFoundationsPlans } = await import('../../supabase/functions/presence/routes/foundations.ts');
const { handleWriterList, handleWriterGet } = await import('../../supabase/functions/presence/routes/writer.ts');
const { handleReviewList, handleReviewGet } = await import('../../supabase/functions/presence/routes/review.ts');
const { handleMomentsList } = await import('../../supabase/functions/presence/routes/moments.ts');
const { handleCoachList } = await import('../../supabase/functions/presence/routes/coach.ts');
const { handleDnsGet } = await import('../../supabase/functions/presence/routes/services.ts');
const { reviewerAllowed } = await import('../../supabase/functions/presence/routes/workspace.ts');

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE_A = uuid('a');      // the studio's client
const SITE_B = uuid('b');      // another tenant, never authorised to this studio
const SITE_ARCHIVED = uuid('c');
const ROW_A = uuid('1'), ROW_B = uuid('2');
const AGENCY = uuid('d'), OTHER_AGENCY = uuid('e'), PAUSED_AGENCY = uuid('f');
const siteRow = (id, extra = {}) => ({ id, client_id: `client-${id[0]}`, status: 'draft', last_published_at: null, template_slug: 'restaurant-classic', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence', ...extra });
const A = siteRow(SITE_A, { custom_domain: 'alpha.example' });
const B = siteRow(SITE_B);

/* the people: `owns` is what my_presence_site_ids() returns for their JWT */
const USERS = {
  'jwt-owner-a': { id: uuid('3'), email: 'owner-a@example.com', owns: [SITE_A] },
  'jwt-owner-b': { id: uuid('4'), email: 'owner-b@example.com', owns: [SITE_B] },
  'jwt-studio': { id: uuid('5'), email: 'owner@studio.example', owns: [] },
  'jwt-staff-studio': { id: uuid('6'), email: 'staff@studio.example', owns: [] },
  'jwt-readonly': { id: uuid('7'), email: 'readonly@studio.example', owns: [] },
  'jwt-designer': { id: uuid('8'), email: 'designer@studio.example', owns: [] },
  'jwt-reviewer': { id: uuid('9'), email: 'reviewer@studio.example', owns: [] },
  'jwt-other-studio': { id: uuid('0'), email: 'owner@other.example', owns: [] },
  'jwt-paused': { id: uuid('a'), email: 'owner@paused.example', owns: [] },
  'jwt-stranger': { id: uuid('b'), email: 'stranger@example.com', owns: [] },
};
const principalOf = (jwt, extra = {}) => ({ kind: 'client', userId: USERS[jwt].id, tenantId: null, role: 'client', email: USERS[jwt].email, jwt, requestId: 'test', ...extra });
const authorised = (site, name = 'Client') => ({ scope: { site_id: site, name } });
const operator = principalOf('jwt-studio', authorised(SITE_A));          // an agency member drilled into the client
const staffOperator = principalOf('jwt-staff-studio', { kind: 'staff', ...authorised(SITE_A) });   // platform staff who also hold an agency seat
const owner = principalOf('jwt-owner-a');                                // the business owner in their own room
const unscoped = principalOf('jwt-studio');                              // the same operator with no authorised scope

const blocks = [{ id: 'hero-1', type: 'hero', title: 'Welcome' }];
function seedFor(site, id, tag) {
  return {
    presence_identity: { site_id: site, business_name: `${tag} Cafe`, tagline: '', description: `${tag} description`, phone: '', email: '', story: '', service_area: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '', updated_at: '2026-01-01T00:00:00Z' },
    presence_locations: { id, site_id: site, address_line1: '1 Main', address_line2: '', city: `${tag}-town`, region: 'CA', postal_code: '90000', country: 'US', phone: '', timezone: 'America/Los_Angeles', hours: [], holiday_exceptions: [], temporarily_closed: false, temporarily_closed_note: '', updated_at: '2026-01-01T00:00:00Z' },
    presence_settings: { site_id: site, category_order: [], announcement_text: `${tag} news`, blocks, pages: [], nav: null, updated_at: '2026-01-01T00:00:00Z' },
    presence_brand_profile: { site_id: site, mission: `${tag} mission`, voice_characteristics: `${tag} voice`, preferred_vocabulary: '', never_claims: '', learned: {}, updated_at: '2026-01-01T00:00:00Z' },
    presence_brand_reports: { id, site_id: site, scope: 'site', target: null, status: 'open', findings: [], open_count: 0, deterministic_only: true, created_at: '2026-01-01T00:00:00Z', headline: `${tag} report` },
    presence_ai_drafts: { id, site_id: site, kind: 'about', status: 'proposed', prompt_summary: `${tag} draft`, options: [], confidence: 'high', missing_facts: [], assumptions: [], approval_required: true, created_at: '2026-01-01T00:00:00Z' },
    presence_ai_reviews: { id, site_id: site, scope: `${tag} review`, target: null, status: 'open', findings: [], open_count: 0, deterministic_only: true, created_at: '2026-01-01T00:00:00Z' },
    presence_moments: { id, site_id: site, status: 'active', moment_type: 'milestone', headline: `${tag} moment`, summary: '', tone: 'calm', dismissable: true, importance: 1, moment_key: 'k', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' },
    presence_growth_opportunities: { id, site_id: site, status: 'open', opportunity: `${tag} opportunity`, area: 'website', created_at: '2026-01-01T00:00:00Z' },
    presence_knowledge_docs: { id, site_id: site, filename: `${tag}.txt`, extracted: { items: [1] }, created_at: '2026-01-01T00:00:00Z', deleted_at: null },
    presence_infra_plans: { id, site_id: site, kind: 'dns', title: `${tag} plan`, status: 'proposed', created_at: '2026-01-01T00:00:00Z' },
    presence_dns_zones: { site_id: site, records: [{ type: 'TXT', name: '@', value: `${tag} record`, ttl: 300 }], updated_at: '2026-01-01T00:00:00Z' },
    presence_dns_zone_history: { id, site_id: site, note: `${tag} note`, saved_at: '2026-01-01T00:00:00Z' },
    presence_offerings: { id, site_id: site, name: `${tag} plate`, category: 'Mains', description: '', price_text: '', media_id: null, is_visible: true, sort_order: 0, deleted_at: null, created_at: '2026-01-01T00:00:00Z' },
    presence_testimonials: { id, site_id: site, quote: `${tag} quote`, author: 'Sam', source: '', quote_date: null, is_visible: true, sort_order: 0, deleted_at: null, created_at: '2026-01-01T00:00:00Z' },
    presence_faqs: { id, site_id: site, question: `${tag} question`, answer: 'Yes', is_visible: true, sort_order: 0, deleted_at: null, created_at: '2026-01-01T00:00:00Z' },
    presence_posts: { id, site_id: site, title: `${tag} post`, slug: `${tag.toLowerCase()}-post`, body_md: '', excerpt: '', hero_media_id: null, status: 'published', published_at: '2026-01-01T00:00:00Z', noindex: false, tags: [], deleted_at: null, updated_at: '2026-01-01T00:00:00Z' },
  };
}

/* ── a tiny PostgREST: top-level filters AND, RLS for a JWT, none for the service role ── */
let T, calls, rejectOperatorKind;
function reset() {
  T = {};
  for (const seed of [seedFor(SITE_A, ROW_A, 'Alpha'), seedFor(SITE_B, ROW_B, 'Bravo')]) {
    for (const [table, row] of Object.entries(seed)) (T[table] ||= []).push(structuredClone(row));
  }
  T.presence_sites = [A, B, siteRow(SITE_ARCHIVED)];
  T.presence_change_events = [];
  T.presence_scoped_access_events = [];
  T.presence_agencies = [
    { id: AGENCY, status: 'active', name: 'Bright Studio', seat_limit: 5, client_limit: 50, plan: 'studio', branding: {} },
    { id: OTHER_AGENCY, status: 'active', name: 'Other Studio', seat_limit: 5, client_limit: 50, plan: 'studio', branding: {} },
    { id: PAUSED_AGENCY, status: 'paused', name: 'Paused Studio', seat_limit: 5, client_limit: 50, plan: 'studio', branding: {} },
  ];
  const member = (jwt, agency_id, role) => ({ id: USERS[jwt].id, agency_id, user_id: USERS[jwt].id, email: USERS[jwt].email, role, status: 'active' });
  T.presence_agency_members = [
    member('jwt-studio', AGENCY, 'owner'), member('jwt-staff-studio', AGENCY, 'owner'), member('jwt-readonly', AGENCY, 'readonly'),
    member('jwt-designer', AGENCY, 'designer'), member('jwt-reviewer', AGENCY, 'account_manager'),
    member('jwt-other-studio', OTHER_AGENCY, 'owner'), member('jwt-paused', PAUSED_AGENCY, 'owner'),
  ];
  T.presence_agency_clients = [
    { agency_id: AGENCY, site_id: SITE_A, status: 'active' },
    { agency_id: AGENCY, site_id: SITE_ARCHIVED, status: 'archived' },
    { agency_id: OTHER_AGENCY, site_id: SITE_B, status: 'active' },
    { agency_id: PAUSED_AGENCY, site_id: SITE_A, status: 'active' },
  ];
  T.presence_site_members = [{ id: uuid('9'), site_id: SITE_A, user_id: USERS['jwt-reviewer'].id, email: USERS['jwt-reviewer'].email, role: 'client_reviewer', status: 'active' }];
  calls = [];
  rejectOperatorKind = false;
}

function matches(row, params) {
  for (const [k, v] of params.entries()) {
    if (['select', 'limit', 'order', 'on_conflict', 'offset'].includes(k)) continue;
    if (k === 'or') {
      const parts = v.slice(1, -1).split(',');
      if (parts.every((p) => /^\w+\.eq\./.test(p)) && !parts.some((p) => { const [c, , ...val] = p.split('.'); return String(row[c]) === val.join('.'); })) return false;
      continue;
    }
    if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false;
    if (v === 'is.null' && row[k] != null) return false;
    if (v === 'is.true' && row[k] !== true) return false;
  }
  return true;
}

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const headers = new Headers(init.headers);
  const reply = (body, status = 200) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const token = (headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (u.pathname === '/auth/v1/user') return USERS[token] ? reply(USERS[token]) : reply({}, 401);
  if (!u.pathname.startsWith('/rest/v1/')) return new Response('', { status: 404 });   // the DNS-over-HTTPS read, anything else off-platform

  const table = u.pathname.replace('/rest/v1/', '');
  const method = (init.method || 'GET').toUpperCase();
  const role = token === 'SERVICE-KEY' ? 'service' : 'user';
  const owned = USERS[token]?.owns ?? [];
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ table, method, query: decodeURIComponent(u.search), role, token, apikey: headers.get('apikey'), body });
  const visible = (r) => role === 'service' || !('site_id' in r) || owned.includes(r.site_id);
  const rows = () => (T[table] ||= []).filter((r) => visible(r) && matches(r, u.searchParams));

  if (method === 'GET') return reply(rows());
  if (method === 'PATCH') { const hit = rows(); hit.forEach((r) => Object.assign(r, body)); return reply(hit); }
  if (method === 'POST') {
    if (table === 'presence_change_events' && rejectOperatorKind && body.actor_kind === 'operator') {
      return reply({ code: '23514', message: 'new row for relation "presence_change_events" violates check constraint "presence_change_events_actor_kind_check"' }, 400);
    }
    if (role === 'user' && !owned.includes(body.site_id)) return reply({ code: '42501', message: 'new row violates row-level security policy' }, 403);
    const conflict = u.searchParams.get('on_conflict');
    const prefer = headers.get('Prefer') || '';
    let row = conflict && prefer.includes('merge-duplicates') ? (T[table] ||= []).find((r) => r[conflict] === body[conflict]) : null;
    if (row) Object.assign(row, body);
    else { row = { id: crypto.randomUUID(), deleted_at: null, ...body }; (T[table] ||= []).push(row); }
    return prefer.includes('return=representation') ? reply([row], 201) : reply(null, 201);
  }
  return reply([]);
};

const cors = {};
const req = (method, route, body, headers = {}) => new Request(`http://stub.local/functions/v1/presence${route}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
const dbFor = (p, site = A) => siteDb(p.jwt, site, p);
const answer = async (res) => ({ status: res.status, body: await res.json() });
const rowsOf = (table, site) => (T[table] || []).filter((r) => r.site_id === site);
const tenantB = () => JSON.stringify(Object.fromEntries(Object.keys(seedFor(SITE_B, ROW_B, 'Bravo')).map((t) => [t, rowsOf(t, SITE_B)])));
const eventsOn = (site) => rowsOf('presence_change_events', site);
const pinned = (c, site) => c.query.includes(`site_id=eq.${site}`) || c.body?.site_id === site;

// ═══ 1. the pin: pure, and the only thing between a scoped query and every tenant ═══
{
  const S = SITE_A, O = SITE_B;
  const post = (body, prefer) => ({ method: 'POST', headers: prefer ? { Prefer: prefer } : {}, body: JSON.stringify(body) });
  ok('pin: a read filtered to the site passes', pinViolation(S, `presence_identity?site_id=eq.${S}&select=id&limit=1`) === null);
  ok('pin: a filter the query ANDs with cannot widen it', pinViolation(S, `presence_growth_opportunities?site_id=eq.${S}&or=(status.eq.open,and(status.eq.deferred))`) === null);
  ok('pin: an update filtered to the site passes', pinViolation(S, `presence_offerings?id=eq.${ROW_A}&site_id=eq.${S}&deleted_at=is.null`, { method: 'PATCH', body: JSON.stringify({ name: 'x' }) }) === null);
  ok('pin: an insert naming the site passes', pinViolation(S, 'presence_offerings?select=id', post({ site_id: S, name: 'x' })) === null);
  ok('pin: an upsert on site_id passes', pinViolation(S, 'presence_identity?on_conflict=site_id', post({ site_id: S }, 'resolution=merge-duplicates,return=representation')) === null);

  ok('pin: a read of another site → refused', pinViolation(S, `presence_identity?site_id=eq.${O}`) === 'not_filtered_to_site');
  ok('pin: a read with no site filter → refused', pinViolation(S, 'presence_identity?select=id') === 'not_filtered_to_site');
  ok('pin: a row looked up by id alone → refused', pinViolation(S, `presence_offerings?id=eq.${ROW_B}`) === 'not_filtered_to_site');
  ok('pin: a filter that only mentions the site inside or= → refused', pinViolation(S, `presence_identity?or=(site_id.eq.${S},site_id.eq.${O})`) === 'not_filtered_to_site');
  ok('pin: site_id=neq / in() are not a pin → refused', pinViolation(S, `presence_identity?site_id=neq.${O}`) === 'not_filtered_to_site' && pinViolation(S, `presence_identity?site_id=in.(${S},${O})`) === 'not_filtered_to_site');
  ok('pin: two site filters → refused', pinViolation(S, `presence_identity?site_id=eq.${S}&site_id=eq.${O}`) === 'not_filtered_to_site');
  ok('pin: an update with no site filter → refused', pinViolation(S, `presence_offerings?id=eq.${ROW_B}`, { method: 'PATCH', body: JSON.stringify({ name: 'x' }) }) === 'not_filtered_to_site');
  ok('pin: an update moving a row to another site → refused', pinViolation(S, `presence_offerings?id=eq.${ROW_A}&site_id=eq.${S}`, { method: 'PATCH', body: JSON.stringify({ site_id: O }) }) === 'moves_row_out_of_site');
  ok('pin: an insert for another site → refused', pinViolation(S, 'presence_offerings', post({ site_id: O })) === 'insert_outside_site');
  ok('pin: an insert naming no site → refused', pinViolation(S, 'presence_offerings', post({ name: 'x' })) === 'insert_outside_site');
  ok('pin: a bulk insert → refused, even when every row looks right', pinViolation(S, 'presence_offerings', { method: 'POST', body: JSON.stringify([{ site_id: S }, { site_id: O }]) }) === 'unreadable_body');
  ok('pin: an upsert merging on id could overwrite another tenant → refused',
    pinViolation(S, 'presence_offerings?on_conflict=id', post({ site_id: S, id: ROW_B }, 'resolution=merge-duplicates')) === 'upsert_not_on_site_id');
  ok('pin: a merge with no conflict target merges on the primary key → refused',
    pinViolation(S, 'presence_offerings', post({ site_id: S, id: ROW_B }, 'resolution=merge-duplicates')) === 'upsert_not_on_site_id');
  ok('pin: a hard DELETE → refused (these routes only soft-delete)', pinViolation(S, `presence_offerings?site_id=eq.${S}`, { method: 'DELETE' }) === 'method_not_allowed');
  ok('pin: an unreadable body → refused', pinViolation(S, `presence_offerings?site_id=eq.${S}`, { method: 'PATCH', body: 'not json' }) === 'unreadable_body');
  ok('pin: an RPC or a non-content table → refused', pinViolation(S, `rpc/anything?site_id=eq.${S}`) === 'not_a_content_table' && pinViolation(S, `clients?site_id=eq.${S}`) === 'not_a_content_table' && pinViolation(S, `presence_../clients?site_id=eq.${S}`) === 'not_a_content_table');
}

// ═══ 2. which identity siteDb hands out ═══
{
  const asks = async (db, path = `presence_identity?site_id=eq.${SITE_A}&select=business_name`) => { calls = []; const r = await db(path); return { r, c: calls[0] }; };
  reset();
  let t = await asks(siteDb('jwt-owner-a', A, owner));
  ok('no scope → the caller\'s JWT and the anon key', t.c.token === 'jwt-owner-a' && t.c.apikey === 'ANON-KEY' && t.c.role === 'user');
  t = await asks(siteDb('jwt-owner-a', A, { scope: null }));
  ok('a null scope → the caller\'s JWT', t.c.role === 'user');
  t = await asks(siteDb('jwt-owner-a', A, { scope: { site_id: '', name: '' } }));
  ok('an empty scope → the caller\'s JWT', t.c.role === 'user');
  t = await asks(siteDb('jwt-studio', A, authorised(SITE_B)));
  ok('a scope for a DIFFERENT site than the one being read → the caller\'s JWT, so RLS refuses', t.c.role === 'user' && t.r.json.length === 0);
  t = await asks(dbFor(operator));
  ok('the authorised site → the service role', t.c.token === 'SERVICE-KEY' && t.c.apikey === 'SERVICE-KEY' && t.r.json[0].business_name === 'Alpha Cafe');
  t = await asks(dbFor(staffOperator));
  ok('…staff holding an agency seat too: production\'s own account shape', t.c.role === 'service');

  calls = [];
  const refused = await dbFor(operator)(`presence_identity?site_id=eq.${SITE_B}`);
  ok('a query outside the pin never reaches the network', calls.length === 0);
  ok('…and fails like any write, with no rows', refused.ok === false && refused.status === 403 && refused.json === null);
}

// ═══ 3. every scoped read: the client's data, RLS's old answer, the owner's path ═══
const READS = [
  { route: 'GET /site', tables: ['presence_identity', 'presence_locations', 'presence_brand_profile'], run: (db) => handleGetSite(db, A, cors), has: (b) => b.data.identity?.business_name === 'Alpha Cafe' && b.data.location?.city === 'Alpha-town' && b.data.voice?.tone_notes === 'Alpha voice' },
  { route: 'GET /identity', tables: ['presence_identity'], run: (db) => handleGetIdentity(db, A, cors), has: (b) => b.data?.business_name === 'Alpha Cafe' },
  { route: 'GET /location', tables: ['presence_locations'], run: (db, p) => handleLocation(req('GET', '/location'), db, A, p, cors), has: (b) => b.data?.city === 'Alpha-town' },
  { route: 'GET /settings', tables: ['presence_settings'], run: (db, p) => handleSettings(req('GET', '/settings'), db, A, p, cors), has: (b) => b.data?.announcement_text === 'Alpha news' },
  { route: 'GET /voice', tables: ['presence_brand_profile'], run: (db, p) => handleVoice(req('GET', '/voice'), db, A, p, cors), has: (b) => b.data?.tone_notes === 'Alpha voice' },
  { route: 'GET /offerings', tables: ['presence_offerings'], run: (db, p) => handleCollection(req('GET', '/offerings'), db, A, p, 'offerings', null, cors), has: (b) => b.data?.[0]?.name === 'Alpha plate' && b.data.length === 1 },
  { route: 'GET /testimonials', tables: ['presence_testimonials'], run: (db, p) => handleCollection(req('GET', '/testimonials'), db, A, p, 'testimonials', null, cors), has: (b) => b.data?.[0]?.quote === 'Alpha quote' && b.data.length === 1 },
  { route: 'GET /faqs', tables: ['presence_faqs'], run: (db, p) => handleCollection(req('GET', '/faqs'), db, A, p, 'faqs', null, cors), has: (b) => b.data?.[0]?.question === 'Alpha question' && b.data.length === 1 },
  { route: 'GET /posts', tables: ['presence_posts'], run: (db, p) => handleCollection(req('GET', '/posts'), db, A, p, 'posts', null, cors), has: (b) => b.data?.[0]?.title === 'Alpha post' && b.data.length === 1 },
  { route: 'GET /brand/profile', tables: ['presence_brand_profile'], run: (db) => handleBrandProfileGet(db, A, cors), has: (b) => b.data?.mission === 'Alpha mission' },
  { route: 'GET /brand/reports', tables: ['presence_brand_reports'], run: (db) => handleBrandReportList(db, A, cors), has: (b) => b.data?.[0]?.id === ROW_A && b.data.length === 1 },
  { route: 'GET /brand/reports/:id', tables: ['presence_brand_reports'], run: (db) => handleBrandReportGet(db, A, ROW_A, cors), has: (b) => b.data?.id === ROW_A },
  { route: 'GET /knowledge/docs', tables: ['presence_knowledge_docs'], run: (db) => handleKnowledgeList(db, A, cors), has: (b) => b.data?.[0]?.filename === 'Alpha.txt' && b.data.length === 1 },
  { route: 'GET /foundations/plans', tables: ['presence_infra_plans'], run: (db) => handleFoundationsPlans(db, A, cors), has: (b) => b.data?.[0]?.title === 'Alpha plan' && b.data.length === 1 },
  { route: 'GET /writer/drafts', tables: ['presence_ai_drafts'], run: (db) => handleWriterList(db, A, cors), has: (b) => b.data?.[0]?.prompt_summary === 'Alpha draft' && b.data.length === 1 },
  { route: 'GET /writer/drafts/:id', tables: ['presence_ai_drafts'], run: (db) => handleWriterGet(db, A, ROW_A, cors), has: (b) => b.data?.prompt_summary === 'Alpha draft' },
  { route: 'GET /review/reports', tables: ['presence_ai_reviews'], run: (db) => handleReviewList(db, A, cors), has: (b) => b.data?.[0]?.scope === 'Alpha review' && b.data.length === 1 },
  { route: 'GET /review/reports/:id', tables: ['presence_ai_reviews'], run: (db) => handleReviewGet(db, A, ROW_A, cors), has: (b) => b.data?.scope === 'Alpha review' },
  { route: 'GET /moments', tables: ['presence_moments'], run: (db) => handleMomentsList(db, A, cors), has: (b) => b.data?.[0]?.headline === 'Alpha moment' && b.data.length === 1 },
  { route: 'GET /coach/opportunities', tables: ['presence_growth_opportunities'], run: (db) => handleCoachList(db, A, cors), has: (b) => b.data?.[0]?.opportunity === 'Alpha opportunity' && b.data.length === 1 },
  { route: 'GET /foundations/dns', tables: ['presence_dns_zones', 'presence_dns_zone_history'], run: (db) => handleDnsGet(db, A, cors), has: (b) => b.data?.desired?.[0]?.value === 'Alpha record' },
];
const blank = ({ status, body }) => status === 404 || body.data === null || (Array.isArray(body.data) && body.data.length === 0) || body.data?.identity === null || (Array.isArray(body.data?.desired) && body.data.desired.length === 0);

for (const r of READS) {
  reset();
  let out = await answer(await r.run(dbFor(operator), operator));
  ok(`${r.route} scoped: the client's real data`, out.status === 200 && r.has(out.body), JSON.stringify(out.body).slice(0, 120));
  ok(`${r.route} scoped: nothing of the other tenant`, !JSON.stringify(out.body).includes('Bravo'));
  ok(`${r.route} scoped: service role, pinned, no JWT call`, !calls.some((c) => c.role === 'user') && r.tables.every((t) => calls.some((c) => c.table === t && c.role === 'service' && pinned(c, SITE_A))));

  reset();
  out = await answer(await r.run(dbFor(unscoped), unscoped));
  ok(`${r.route} without an authorised scope: RLS still answers nothing`, blank(out), JSON.stringify(out.body).slice(0, 120));

  reset();
  out = await answer(await r.run(dbFor(owner), owner));
  ok(`${r.route} owner: same data`, out.status === 200 && r.has(out.body));
  // /site alone also reads these tables through the service role, for the draft hash (the one serializer)
  const viaJwt = (c) => c.role === 'user' && c.token === 'jwt-owner-a' && c.apikey === 'ANON-KEY';
  ok(`${r.route} owner: the content query runs under their JWT and the anon key`,
    r.tables.every((t) => { const on = calls.filter((c) => c.table === t); return r.route === 'GET /site' ? on.some(viaJwt) : on.length > 0 && on.every(viaJwt); }));
}

// ═══ 4. every scoped write ═══
const row = (t, site = SITE_A) => rowsOf(t, site)[0];
const REQUIRED = { offerings: { name: 'New plate', category: 'Mains' }, testimonials: { quote: 'New quote', author: 'Ana' }, faqs: { question: 'New?', answer: 'Yes' }, posts: { title: 'New post' } };
const EDIT = { offerings: { name: 'Edited' }, testimonials: { quote: 'Edited' }, faqs: { question: 'Edited' }, posts: { title: 'Edited' } };
const TABLE = { offerings: 'presence_offerings', testimonials: 'presence_testimonials', faqs: 'presence_faqs', posts: 'presence_posts' };
const WRITES = [
  { route: 'PUT /identity', table: 'presence_identity', status: 200, rlsStatus: 403, run: (db, p) => handlePutIdentity(req('PUT', '/identity', { business_name: 'Renamed' }), db, A, p, cors), saved: () => row('presence_identity').business_name === 'Renamed' },
  { route: 'PUT /location', table: 'presence_locations', status: 200, rlsStatus: 502, run: (db, p) => handleLocation(req('PUT', '/location', { city: 'Newtown' }), db, A, p, cors), saved: () => row('presence_locations').city === 'Newtown' && rowsOf('presence_locations', SITE_A).length === 1 },
  { route: 'PUT /settings', table: 'presence_settings', status: 200, rlsStatus: 502, run: (db, p) => handleSettings(req('PUT', '/settings', { announcement_text: 'Now open' }), db, A, p, cors), saved: () => row('presence_settings').announcement_text === 'Now open' },
  { route: 'PUT /voice', table: 'presence_brand_profile', status: 200, rlsStatus: 502, run: (db, p) => handleVoice(req('PUT', '/voice', { tone_notes: 'Warm' }), db, A, p, cors), saved: () => row('presence_brand_profile').voice_characteristics === 'Warm' },
  { route: 'PUT /brand/profile', table: 'presence_brand_profile', status: 200, rlsStatus: 502, run: (db, p) => handleBrandProfilePut(req('PUT', '/brand/profile', { mission: 'New mission' }), db, A, p, cors), saved: () => row('presence_brand_profile').mission === 'New mission' },
  { route: 'POST /pages/duplicate', table: 'presence_settings', status: 201, rlsStatus: 502, run: (db, p) => handlePageDuplicate(req('POST', '/pages/duplicate', { slug: '' }), db, A, p, cors), saved: () => row('presence_settings').pages.length === 1 },
];
for (const e of Object.keys(REQUIRED)) {
  WRITES.push({ route: `POST /${e}`, table: TABLE[e], status: 201, rlsStatus: 502, run: (db, p) => handleCollection(req('POST', `/${e}`, REQUIRED[e]), db, A, p, e, null, cors), saved: () => rowsOf(TABLE[e], SITE_A).length === 2 });
  WRITES.push({ route: `PUT /${e}/:id`, table: TABLE[e], status: 200, rlsStatus: 404, run: (db, p) => handleCollection(req('PUT', `/${e}/${ROW_A}`, EDIT[e]), db, A, p, e, ROW_A, cors), saved: () => Object.values(row(TABLE[e])).includes('Edited') });
  WRITES.push({ route: `DELETE /${e}/:id`, table: TABLE[e], status: 200, rlsStatus: 404, run: (db, p) => handleCollection(req('DELETE', `/${e}/${ROW_A}`), db, A, p, e, ROW_A, cors), saved: () => !!row(TABLE[e]).deleted_at });
}
const writesOn = (t) => calls.filter((c) => c.table === t && c.method !== 'GET');

for (const w of WRITES) {
  reset();
  const before = tenantB();
  let out = await answer(await w.run(dbFor(operator), operator));
  ok(`${w.route} scoped: ${w.status} and saved`, out.status === w.status && w.saved(), `${out.status} ${JSON.stringify(out.body).slice(0, 120)}`);
  ok(`${w.route} scoped: the write is the service role, pinned`, writesOn(w.table).length === 1 && writesOn(w.table).every((c) => c.role === 'service' && pinned(c, SITE_A)));
  ok(`${w.route} scoped: the other tenant is byte-identical`, tenantB() === before);
  ok(`${w.route} scoped: exactly one change event, on this site`, eventsOn(SITE_A).length === 1 && T.presence_change_events.length === 1);
  const scopedShape = writesOn(w.table).map((c) => [c.method, c.query]);

  reset();
  out = await answer(await w.run(dbFor(unscoped), unscoped));
  ok(`${w.route} without an authorised scope: still refused (${w.rlsStatus})`, out.status === w.rlsStatus && !w.saved(), `${out.status} ${out.body.error}`);
  ok(`${w.route} without an authorised scope: no event`, T.presence_change_events.length === 0);

  reset();
  out = await answer(await w.run(dbFor(owner), owner));
  ok(`${w.route} owner: ${w.status} and saved`, out.status === w.status && w.saved());
  ok(`${w.route} owner: under their JWT and the anon key`, writesOn(w.table).length === 1 && writesOn(w.table).every((c) => c.role === 'user' && c.token === 'jwt-owner-a' && c.apikey === 'ANON-KEY'));
  ok(`${w.route} owner: the same query as the scoped write; only the identity differs`, JSON.stringify(writesOn(w.table).map((c) => [c.method, c.query])) === JSON.stringify(scopedShape));
}

// ═══ 5. scoped to one client, another tenant's rows can't be reached ═══
{
  const db = dbFor(operator);
  for (const e of Object.keys(TABLE)) {
    reset(); let before = tenantB();
    let out = await answer(await handleCollection(req('PUT', `/${e}/${ROW_B}`, EDIT[e]), db, A, operator, e, ROW_B, cors));
    ok(`cross-tenant: PUT another tenant's ${e} row by id → 404, untouched`, out.status === 404 && tenantB() === before && T.presence_change_events.length === 0);
    reset(); before = tenantB();
    out = await answer(await handleCollection(req('DELETE', `/${e}/${ROW_B}`), db, A, operator, e, ROW_B, cors));
    ok(`cross-tenant: DELETE another tenant's ${e} row by id → 404, untouched`, out.status === 404 && tenantB() === before && T.presence_change_events.length === 0);
  }
  reset();
  for (const [name, h] of [['writer draft', handleWriterGet], ['AI review', handleReviewGet], ['brand report', handleBrandReportGet]]) {
    const out = await answer(await h(db, A, ROW_B, cors));
    ok(`cross-tenant: GET another tenant's ${name} by id → 404`, out.status === 404);
  }

  reset(); let before = tenantB();
  let out = await answer(await handleCollection(req('POST', '/offerings', { ...REQUIRED.offerings, site_id: SITE_B }), db, A, operator, 'offerings', null, cors));
  ok('cross-tenant: POST /offerings naming the other site in the body → lands on the authorised site', out.status === 201 && rowsOf('presence_offerings', SITE_A).length === 2 && tenantB() === before);
  reset(); before = tenantB();
  out = await answer(await handlePutIdentity(req('PUT', '/identity', { business_name: 'Hijacked', site_id: SITE_B }), db, A, operator, cors));
  ok('cross-tenant: PUT /identity naming the other site in the body → refused as an unknown field', out.status === 422 && tenantB() === before);
  reset(); before = tenantB();
  out = await answer(await handleLocation(req('PUT', '/location', { city: 'Hijacked', site_id: SITE_B }), db, A, operator, cors));
  ok('cross-tenant: PUT /location naming the other site in the body → lands on the authorised site', out.status === 200 && row('presence_locations').city === 'Hijacked' && tenantB() === before);
  reset(); before = tenantB();
  out = await answer(await handleSettings(req('PUT', '/settings', { announcement_text: 'Hijacked', site_id: SITE_B }), db, A, operator, cors));
  ok('cross-tenant: PUT /settings naming the other site in the body → lands on the authorised site', out.status === 200 && row('presence_settings').announcement_text === 'Hijacked' && tenantB() === before);

  // the principal says A, the handler is handed B: a wiring slip must fail closed
  reset(); before = tenantB();
  const mismatched = siteDb('jwt-studio', B, operator);
  out = await answer(await handleGetIdentity(mismatched, B, cors));
  ok('a scope for A with a site row for B: reads nothing', out.status === 200 && out.body.data === null);
  out = await answer(await handlePutIdentity(req('PUT', '/identity', { business_name: 'Hijacked' }), mismatched, B, operator, cors));
  ok('a scope for A with a site row for B: writes refused by RLS', out.status === 403 && out.body.error === 'write_failed' && tenantB() === before);
}

// ═══ 6. a denied scope never gets a site, so it never gets a principal.scope ═══
{
  const audit = { route: '/identity', method: 'PUT', requestId: 'test' };
  const DENIED = [
    ['a signed-in person with no agency', 'jwt-stranger', SITE_A, 403, 'not_agency'],
    ['a business owner forging the header', 'jwt-owner-b', SITE_A, 403, 'not_agency'],
    ['a read-only agency role', 'jwt-readonly', SITE_A, 403, 'role'],
    ['a designer (no manage capability)', 'jwt-designer', SITE_A, 403, 'role'],
    ['a member of a paused agency', 'jwt-paused', SITE_A, 403, 'not_agency'],
    ['another studio reaching for this client', 'jwt-other-studio', SITE_A, 403, 'unauthorized'],
    ['this studio reaching for another tenant', 'jwt-studio', SITE_B, 403, 'unauthorized'],
    ['this studio reaching for an archived client', 'jwt-studio', SITE_ARCHIVED, 403, 'unauthorized'],
    ['a malformed site id', 'jwt-studio', "x' OR 1=1", 400, 'bad_scope'],
    ['an expired or unknown token', 'jwt-nobody', SITE_A, 403, 'not_agency'],
  ];
  for (const [who, jwt, target, status, reason] of DENIED) {
    reset();
    const sc = await resolveScopedSite(jwt, target, audit);
    ok(`denied: ${who} → ${status} ${reason}`, sc.ok === false && sc.status === status && sc.reason === reason, JSON.stringify(sc));
    ok(`denied: ${who} → no site row handed back, none even loaded`, !('site' in sc) && !calls.some((c) => ['presence_sites', 'presence_identity'].includes(c.table)));
    ok(`denied: ${who} → recorded as denied in the audit ledger`, T.presence_scoped_access_events.length === 1 && T.presence_scoped_access_events[0].outcome === 'denied');
  }

  reset();
  let sc = await resolveScopedSite('jwt-studio', SITE_A, audit);
  ok('allowed: this studio on its own client → the site and the scope', sc.ok === true && sc.site.id === SITE_A && sc.scoped.site_id === SITE_A && T.presence_scoped_access_events[0].outcome === 'allowed');
  reset();
  sc = await resolveScopedSite('jwt-staff-studio', SITE_A, audit);
  ok('allowed: staff holding an agency seat', sc.ok === true && sc.site.id === SITE_A);

  // what an allowed decision hands to siteDb is what the data path honours
  reset();
  const live = await resolveScopedSite('jwt-studio', SITE_A, audit);
  const stamped = principalOf('jwt-studio', authorised(live.scoped.site_id, live.scoped.name));
  const out = await answer(await handleGetIdentity(siteDb('jwt-studio', live.site, stamped), live.site, cors));
  ok('end to end: an authorised scope reads the client through the real resolver', out.body.data?.business_name === 'Alpha Cafe');

  // authorisation is recomputed each request: archive the client and the next one is denied
  T.presence_agency_clients.find((c) => c.agency_id === AGENCY && c.site_id === SITE_A).status = 'archived';
  const after = await resolveScopedSite('jwt-studio', SITE_A, audit);
  ok('stale scope: once the client is archived the same request is denied', after.ok === false && after.status === 403);
}

// ═══ 7. reviewer limits ═══
{
  const uuidPath = (route) => route.replace(':id', ROW_A);
  const inventory = [...READS.map((r) => r.route), ...WRITES.map((w) => w.route)];
  ok('reviewer: refused every route that uses this data path (the boundary sits ahead of the router)',
    inventory.every((r) => { const [m, p] = r.split(' '); return reviewerAllowed(uuidPath(p), m) === false; }));
  reset();
  ok('reviewer: an agency member who is ALSO a client_reviewer on the site still resolves as the reviewer',
    await resolveSiteRole('jwt-reviewer', SITE_A, 'client') === 'client_reviewer');
  ok('reviewer: the scoped operator with no member row stays the default', await resolveSiteRole('jwt-studio', SITE_A, 'client') === 'business_owner');
  // reviewers never get a scope of their own: un-scoped, a reviewer stays under RLS
  const reviewer = principalOf('jwt-reviewer');
  const out = await answer(await handleGetIdentity(dbFor(reviewer), A, cors));
  ok('reviewer: un-scoped on the client site, RLS still answers nothing', out.body.data === null);
}

// ═══ 8. the optimistic lock on a scoped write ═══
{
  reset();
  const db = dbFor(operator);
  const h0 = await draftHashForSite(A);
  ok('lock: the draft hash computes for a scoped site', typeof h0 === 'string' && h0.length === 64);

  let out = await answer(await handlePutIdentity(req('PUT', '/identity', { business_name: 'Should not land' }, { 'If-Match': '"deadbeef"' }), db, A, operator, cors));
  ok('lock: a stale If-Match → 409 stale_draft carrying the current hash', out.status === 409 && out.body.error === 'stale_draft' && out.body.current_hash === h0);
  ok('lock: …and nothing was written', row('presence_identity').business_name === 'Alpha Cafe' && writesOn('presence_identity').length === 0 && T.presence_change_events.length === 0);

  out = await answer(await handlePutIdentity(req('PUT', '/identity', { business_name: 'Renamed' }, { 'If-Match': `"${h0}"` }), db, A, operator, cors));
  ok('lock: the current hash → saved', out.status === 200 && row('presence_identity').business_name === 'Renamed');
  const h1 = await draftHashForSite(A);
  ok('lock: a scoped save moves the hash', h1 !== h0);

  out = await answer(await handlePutIdentity(req('PUT', '/identity', { business_name: 'Overwrites the newer edit' }, { 'If-Match': `"${h0}"` }), db, A, operator, cors));
  ok('lock: the old hash is now stale → 409, the newer edit survives', out.status === 409 && out.body.current_hash === h1 && row('presence_identity').business_name === 'Renamed');
  ok('lock: the conflict names the operator as who last moved the draft', out.body.last_change?.actor_kind === 'operator');

  out = await answer(await handlePutIdentity(req('PUT', '/identity', { business_name: 'No precondition' }), db, A, operator, cors));
  ok('lock: no If-Match → opt-in, so it saves as it always did', out.status === 200 && row('presence_identity').business_name === 'No precondition');

  // owner and studio share one version token: each sees the other's edit as a conflict
  reset();
  const shared = await draftHashForSite(A);
  await handlePutIdentity(req('PUT', '/identity', { business_name: 'The owner got there first' }), dbFor(owner), A, owner, cors);
  out = await answer(await handlePutIdentity(req('PUT', '/identity', { business_name: 'The studio, from a stale tab' }, { 'If-Match': `"${shared}"` }), db, A, operator, cors));
  ok('lock: the owner saves, then the studio\'s stale tab → 409, the owner\'s edit survives', out.status === 409 && row('presence_identity').business_name === 'The owner got there first');
  ok('lock: …and that conflict names the owner', out.body.last_change?.actor_kind === 'client');

  const STALE = { 'If-Match': '"deadbeef"' };
  const guarded = [
    ['PUT /location', 'presence_locations', () => handleLocation(req('PUT', '/location', { city: 'x' }, STALE), db, A, operator, cors)],
    ['PUT /settings', 'presence_settings', () => handleSettings(req('PUT', '/settings', { announcement_text: 'x' }, STALE), db, A, operator, cors)],
    ['POST /offerings', 'presence_offerings', () => handleCollection(req('POST', '/offerings', REQUIRED.offerings, STALE), db, A, operator, 'offerings', null, cors)],
    ['PUT /offerings/:id', 'presence_offerings', () => handleCollection(req('PUT', `/offerings/${ROW_A}`, EDIT.offerings, STALE), db, A, operator, 'offerings', ROW_A, cors)],
    ['DELETE /offerings/:id', 'presence_offerings', () => handleCollection(req('DELETE', `/offerings/${ROW_A}`, undefined, STALE), db, A, operator, 'offerings', ROW_A, cors)],
    ['POST /pages/duplicate', 'presence_settings', () => handlePageDuplicate(req('POST', '/pages/duplicate', { slug: '' }, STALE), db, A, operator, cors)],
  ];
  for (const [route, table, run] of guarded) {
    reset();
    out = await answer(await run());
    ok(`lock: ${route} with a stale If-Match → 409, no write`, out.status === 409 && writesOn(table).length === 0 && T.presence_change_events.length === 0);
  }
}

// ═══ 9. change events say whose hand it was ═══
{
  const put = (p) => handlePutIdentity(req('PUT', '/identity', { business_name: 'Secret new name' }), dbFor(p), A, p, cors);
  reset();
  await put(operator);
  let ev = T.presence_change_events[0];
  ok('attribution: an agency member scoped in → operator', ev.actor_kind === 'operator');
  ok('attribution: …with the member\'s own user id, on the client\'s site', ev.actor_user_id === USERS['jwt-studio'].id && ev.site_id === SITE_A);
  ok('attribution: field names only, never the value', JSON.stringify(ev.detail) === '{"fields":["business_name"]}' && !JSON.stringify(ev).includes('Secret new name'));
  ok('attribution: the event still goes through the service role', calls.some((c) => c.table === 'presence_change_events' && c.role === 'service'));

  reset();
  await put(staffOperator);
  ev = T.presence_change_events[0];
  ok('attribution: platform staff scoped in → staff, their own id', ev.actor_kind === 'staff' && ev.actor_user_id === USERS['jwt-staff-studio'].id && ev.site_id === SITE_A);

  reset();
  await put(owner);
  ev = T.presence_change_events[0];
  ok('attribution: the owner in their own room → client (unchanged)', ev.actor_kind === 'client' && ev.actor_user_id === USERS['jwt-owner-a'].id);

  reset();
  rejectOperatorKind = true;
  const out = await answer(await put(operator));
  ev = T.presence_change_events[0];
  ok('attribution: a database before 0133 → the save stands, recorded as staff (the studio\'s hand)', out.status === 200 && ev?.actor_kind === 'staff' && T.presence_change_events.length === 1);

  reset();
  await answer(await handleCollection(req('PUT', `/offerings/${ROW_B}`, EDIT.offerings), dbFor(operator), A, operator, 'offerings', ROW_B, cors));
  ok('attribution: a write that found nothing records nothing', T.presence_change_events.length === 0);
}

// ═══ 10. wiring: the code above is what production runs ═══
{
  const idx = read('supabase/functions/presence/index.ts');
  const at = (s) => idx.indexOf(s);
  const SCOPE_READ = "req.headers.get('x-dds-scope-site')";
  const DENY = "if (!sc.ok) return json({ error: 'scope_denied'";
  const STAMP = 'principal.scope = { site_id: sc.scoped.site_id, name: sc.scoped.name };';
  const BUILD = 'const db = siteDb(jwt, site, principal);';
  ok('index: a denied scope returns before anything is stamped', at(SCOPE_READ) > 0 && at(SCOPE_READ) < at(DENY) && at(DENY) < at(STAMP));
  ok('index: principal.scope is stamped in one place', idx.split('principal.scope =').length === 2);
  ok('index: only the un-scoped branch can reach resolveSite', at(STAMP) < at('site = await resolveSite(jwt);') && /\} else \{\s*site = await resolveSite\(jwt\);/.test(idx));
  ok('index: the data path is built once, after the entitlement, reviewer, edition and feature gates',
    idx.split('siteDb(').length === 2 && [
      'const ent = await checkEntitlement(principal, site.client_id);',
      "if (siteRole === 'client_reviewer' && !reviewerAllowed(route, method))",
      "if (site.edition === 'monitor'",
      'const denial = requireFeature(edition, needed, cors);',
    ].every((gate) => at(gate) > 0 && at(gate) < at(BUILD)));
  ok('index: …and before the first route', at(BUILD) < at("if (route === '/site' && method === 'GET')"));

  const handed = [...idx.matchAll(/\b(handle\w+)\((?:req, )?db,/g)].map((m) => m[1]).sort();
  const EXPECTED = ['handleBrandProfileGet', 'handleBrandProfilePut', 'handleBrandReportGet', 'handleBrandReportList', 'handleCoachList', 'handleCollection', 'handleDnsGet', 'handleFoundationsPlans', 'handleGetIdentity', 'handleGetSite', 'handleKnowledgeList', 'handleLocation', 'handleMomentsList', 'handlePageDuplicate', 'handlePutIdentity', 'handleReviewGet', 'handleReviewList', 'handleScopedCommerce', 'handleSettings', 'handleVoice', 'handleWriterGet', 'handleWriterList'].sort();
  ok('index: the handlers on this path are exactly the audited list', JSON.stringify(handed) === JSON.stringify(EXPECTED), handed.join(','));

  const reviewerRoutes = idx.split('\n').filter((l) => /'\/portal\/(context|feed)'|\/decide\$\/|\/status\$\/|\/foundations\/plans\/\[|\/launches\/\[/.test(l) || /handle(PortalContext|PortalFeed|FoundationsDecide|WriteDecide|AssetStatus|LaunchDecide)\(/.test(l));
  ok('index: nothing a reviewer may reach is handed this data path', reviewerRoutes.length > 0 && reviewerRoutes.every((l) => !/\(db,|, db,/.test(l)));

  const commerceGate = idx.slice(at("route.startsWith('/commerce/')"), at("route.startsWith('/commerce/')") + 240);
  ok('index: /commerce only skips the scope gate when there is no scope or the route is public, so its asUser reads are the caller\'s own site',
    at("route.startsWith('/commerce/')") < at(SCOPE_READ) && commerceGate.includes("if (!req.headers.get('x-dds-scope-site') || isPublicCommerceRoute(route, method)) {"));
  const scopedCommerce = read('supabase/functions/presence/routes/commerce_scoped.ts');
  ok('routes: the scoped /commerce file can only reach data through db', !/\b(svc|asUser|resolveSite)\(/.test(scopedCommerce) && !/import \{[^}]*\b(svc|asUser)\b[^}]*\} from '\.\.\/lib\/db\.ts'/.test(scopedCommerce));

  const inRoutes = [];
  for (const f of Deno.readDirSync(new URL('supabase/functions/presence/routes/', ROOT))) {
    if (f.isFile && /\basUser\(/.test(read(`supabase/functions/presence/routes/${f.name}`))) inRoutes.push(f.name);
  }
  ok('routes: past the scope gate, nothing calls asUser directly', JSON.stringify(inRoutes) === '["commerce.ts"]', inRoutes.join(','));

  const stamps = [];
  const walk = (dir) => {
    for (const f of Deno.readDirSync(new URL(dir, ROOT))) {
      if (f.isDirectory) walk(`${dir}${f.name}/`);
      else if (f.name.endsWith('.ts') && /\.scope\s*=[^=]/.test(read(`${dir}${f.name}`))) stamps.push(`${dir}${f.name}`);
    }
  };
  walk('supabase/functions/presence/');
  walk('supabase/functions/_shared/');
  ok('nothing else assigns a principal\'s scope', JSON.stringify(stamps) === '["supabase/functions/presence/index.ts"]', stamps.join(','));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SCOPED CONTENT: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
