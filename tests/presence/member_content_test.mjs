// ── An invited member can read and save the site they were invited to (MC-1) ─
// Read from the code after SC-1, then proven: a business_staff, developer or
// business_owner member got empty reads and failed saves on every content route,
// the same symptoms the studio had. They own no site, so they arrive through the
// membership fallback in index.ts, but their queries ran under their JWT, and RLS
// (my_presence_site_ids) only admits the site's owner.
//
// The fix (lib/db.ts siteDb) gives a member's own active seat the service role,
// pinned to that one site, and memberWriteGate holds each write to lib/site_roles.ts.
// This drives the REAL handlers, siteDb, resolveMemberSite, memberWriteGate and
// writeChangeEvent against a stubbed PostgREST that applies the production RLS
// predicate, worked out from clients and contacts as my_client_ids() does it, to JWT
// callers and none to the service role. No Supabase, no credentials.
//   · the policy this models is the one the migrations define
//   · each role reaches the rows it should, and only on its own site
//   · each role's writes are exactly what the capability table gives it
//   · a reviewer stays limited, even when the role lookup fails
//   · an owner's path, and everyone without a seat, is unchanged
//
//   deno run --allow-read --allow-env --allow-net tests/presence/member_content_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'SERVICE-KEY');
Deno.env.set('SUPABASE_ANON_KEY', 'ANON-KEY');

const { siteDb } = await import('../../supabase/functions/presence/lib/db.ts');
const { resolveSite } = await import('../../supabase/functions/presence/lib/site.ts');
const { resolveMemberSite, resolveSiteRole, resolveSiteRoleCached } = await import('../../supabase/functions/presence/lib/workspace.ts');
const { SITE_ROLES, siteCan, contentWriteNeeds, SETTINGS_CONTENT_FIELDS } = await import('../../supabase/functions/presence/lib/site_roles.ts');
const { draftHashForSite } = await import('../../supabase/functions/presence/lib/draft_hash.ts');
const { handleGetIdentity, handlePutIdentity } = await import('../../supabase/functions/presence/routes/identity.ts');
const { handleCollection, handleLocation, handleSettings, handlePageDuplicate } = await import('../../supabase/functions/presence/routes/content.ts');
const { handleGetSite } = await import('../../supabase/functions/presence/routes/site.ts');
const { handleBrandProfileGet, handleBrandProfilePut, handleBrandReportList, handleBrandReportGet } = await import('../../supabase/functions/presence/routes/brand.ts');
const { handleKnowledgeList } = await import('../../supabase/functions/presence/routes/knowledge.ts');
const { handleFoundationsPlans } = await import('../../supabase/functions/presence/routes/foundations.ts');
const { handleWriterList, handleWriterGet } = await import('../../supabase/functions/presence/routes/writer.ts');
const { handleReviewList, handleReviewGet } = await import('../../supabase/functions/presence/routes/review.ts');
const { handleMomentsList } = await import('../../supabase/functions/presence/routes/moments.ts');
const { handleCoachList } = await import('../../supabase/functions/presence/routes/coach.ts');
const { reviewerAllowed, memberWriteGate } = await import('../../supabase/functions/presence/routes/workspace.ts');

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE_A = uuid('a');      // the site the members were invited to
const SITE_B = uuid('b');      // another tenant
const ROW_A = uuid('1'), ROW_B = uuid('2');
const CLIENT_A = uuid('c'), CLIENT_B = uuid('d');
const siteRow = (id, client_id) => ({ id, client_id, status: 'draft', last_published_at: null, template_slug: 'restaurant-classic', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence' });
const A = { ...siteRow(SITE_A, CLIENT_A), custom_domain: 'alpha.example' };
const B = siteRow(SITE_B, CLIENT_B);

const USERS = {
  'jwt-owner': { id: uuid('3'), email: 'owner-a@example.com' },
  'jwt-owner-b': { id: uuid('4'), email: 'owner-b@example.com' },
  'jwt-staff': { id: uuid('5'), email: 'staff@example.com' },
  'jwt-dev': { id: uuid('6'), email: 'dev@example.com' },
  'jwt-reviewer': { id: uuid('7'), email: 'reviewer@example.com' },
  'jwt-coowner': { id: uuid('8'), email: 'coowner@example.com' },
  'jwt-both': { id: uuid('9'), email: 'owner-a@example.com' },   // holds a seat AND the client's own email
  'jwt-revoked': { id: uuid('0'), email: 'revoked@example.com' },
  'jwt-stranger': { id: uuid('e'), email: 'stranger@example.com' },
  'jwt-two-seats': { id: uuid('f'), email: 'two@example.com' },
  'jwt-by-email': { id: '11111111-2222-4333-8444-555555555555', email: 'pending@example.com' },
};
const principalOf = (jwt, extra = {}) => ({ kind: 'client', userId: USERS[jwt].id, tenantId: null, role: 'client', email: USERS[jwt].email, jwt, requestId: 'test', ...extra });
const seated = (jwt, role) => principalOf(jwt, { member: { site_id: SITE_A, role } });
const owner = principalOf('jwt-owner');
const SEATS = [['business_staff', 'jwt-staff'], ['developer', 'jwt-dev'], ['business_owner', 'jwt-coowner']];

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
    presence_offerings: { id, site_id: site, name: `${tag} plate`, category: 'Mains', description: '', price_text: '', media_id: null, is_visible: true, sort_order: 0, deleted_at: null, created_at: '2026-01-01T00:00:00Z' },
    presence_testimonials: { id, site_id: site, quote: `${tag} quote`, author: 'Sam', source: '', quote_date: null, is_visible: true, sort_order: 0, deleted_at: null, created_at: '2026-01-01T00:00:00Z' },
    presence_faqs: { id, site_id: site, question: `${tag} question`, answer: 'Yes', is_visible: true, sort_order: 0, deleted_at: null, created_at: '2026-01-01T00:00:00Z' },
    presence_posts: { id, site_id: site, title: `${tag} post`, slug: `${tag.toLowerCase()}-post`, body_md: '', excerpt: '', hero_media_id: null, status: 'published', published_at: '2026-01-01T00:00:00Z', noindex: false, tags: [], deleted_at: null, updated_at: '2026-01-01T00:00:00Z' },
  };
}

/* ── a tiny PostgREST: top-level filters AND, the real RLS predicate for a JWT, none for the service role ── */
let T, calls, failSeatReads;
function reset() {
  T = {};
  for (const seed of [seedFor(SITE_A, ROW_A, 'Alpha'), seedFor(SITE_B, ROW_B, 'Bravo')]) {
    for (const [table, row] of Object.entries(seed)) (T[table] ||= []).push(structuredClone(row));
  }
  T.contacts = [{ id: 'contact-a', auth_user_id: USERS['jwt-owner'].id }];
  T.clients = [
    { id: CLIENT_A, contact_id: 'contact-a', email: 'owner-a@example.com', contact_email: null },
    { id: CLIENT_B, contact_id: null, email: null, contact_email: 'owner-b@example.com' },
  ];
  T.presence_sites = [A, B];
  T.presence_change_events = [];
  const seat = (jwt, site_id, role, status = 'active', created_at = '2026-01-01T00:00:00Z') => ({ id: crypto.randomUUID(), site_id, email: USERS[jwt].email, user_id: USERS[jwt].id, role, status, created_at });
  T.presence_site_members = [
    seat('jwt-staff', SITE_A, 'business_staff'), seat('jwt-dev', SITE_A, 'developer'), seat('jwt-reviewer', SITE_A, 'client_reviewer'),
    seat('jwt-coowner', SITE_A, 'business_owner'), seat('jwt-both', SITE_A, 'business_staff'), seat('jwt-revoked', SITE_A, 'business_staff', 'revoked'),
    seat('jwt-two-seats', SITE_B, 'business_staff', 'active', '2026-03-01T00:00:00Z'), seat('jwt-two-seats', SITE_A, 'developer', 'active', '2026-02-01T00:00:00Z'),
    { id: crypto.randomUUID(), site_id: SITE_A, email: USERS['jwt-by-email'].email, user_id: null, role: 'business_staff', status: 'active', created_at: '2026-01-01T00:00:00Z' },
  ];
  calls = [];
  failSeatReads = false;
}

const lower = (s) => String(s ?? '').toLowerCase();
// my_client_ids() and my_presence_site_ids(), as section 1 pins them to the migrations
const myClientIds = (u) => {
  const contacts = T.contacts.filter((c) => c.auth_user_id === u.id).map((c) => c.id);
  return T.clients.filter((c) => contacts.includes(c.contact_id) || (u.email && (lower(c.email) === lower(u.email) || lower(c.contact_email) === lower(u.email)))).map((c) => c.id);
};
const myPresenceSiteIds = (u) => T.presence_sites.filter((s) => myClientIds(u).includes(s.client_id)).map((s) => s.id);
const NO_POLICY = new Set(['presence_site_members', 'presence_change_events']);

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
  if (!u.pathname.startsWith('/rest/v1/')) return new Response('', { status: 404 });

  const table = u.pathname.replace('/rest/v1/', '');
  const method = (init.method || 'GET').toUpperCase();
  const role = token === 'SERVICE-KEY' ? 'service' : 'user';
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ table, method, query: decodeURIComponent(u.search), role, token, apikey: headers.get('apikey'), body });
  if (table === 'presence_site_members' && failSeatReads) return reply({ message: 'boom' }, 500);
  const user = USERS[token] || {};
  const admitted = role === 'user' ? myPresenceSiteIds(user) : [];
  const visible = (r) => {
    if (role === 'service') return true;
    if (NO_POLICY.has(table)) return false;
    if (table === 'presence_sites') return myClientIds(user).includes(r.client_id);
    return !('site_id' in r) || admitted.includes(r.site_id);
  };
  const [orderBy, direction] = (u.searchParams.get('order') || '').split('.');
  const sorted = (list) => (orderBy && list.every((r) => orderBy in r) ? [...list].sort((a, b) => String(a[orderBy]).localeCompare(String(b[orderBy])) * (direction === 'desc' ? -1 : 1)) : list);
  const rows = () => sorted((T[table] ||= []).filter((r) => visible(r) && matches(r, u.searchParams)));

  if (method === 'GET') return reply(rows());
  if (method === 'PATCH') { const hit = rows(); hit.forEach((r) => Object.assign(r, body)); return reply(hit); }
  if (method === 'POST') {
    if (role === 'user' && !admitted.includes(body.site_id)) return reply({ code: '42501', message: 'new row violates row-level security policy' }, 403);
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
const pinned = (c, site) => c.query.includes(`site_id=eq.${site}`) || c.body?.site_id === site;

// ═══ 1. the policy this suite models is the one the migrations define ═══
// Production's bodies were read from the dashboard on 2026-11-05, unchanged: both
// functions match the text below, and presence_site_members has no policy.
{
  const baseline = read('supabase/migrations/0000_baseline.sql');
  const start = baseline.indexOf('CREATE OR REPLACE FUNCTION "public"."my_client_ids"()');
  const clientIds = baseline.slice(start, baseline.indexOf('$$;', start));
  ok('policy: my_client_ids follows contacts.auth_user_id and the client\'s two email columns', start > 0 && /co\.auth_user_id = auth\.uid\(\)/.test(clientIds) && /cl\.email/.test(clientIds) && /cl\.contact_email/.test(clientIds));
  ok('policy: my_client_ids never looks at a member', !/site_members/.test(clientIds));

  const phase1 = read('supabase/migrations/0015_presence_phase1.sql');
  const fn = phase1.slice(phase1.indexOf('create or replace function public.my_presence_site_ids()'), phase1.indexOf('revoke all on function public.my_presence_site_ids()'));
  ok('policy: my_presence_site_ids is sites of my_client_ids, nothing else', /where s\.client_id in \(select public\.my_client_ids\(\)\)/.test(fn) && !/site_members/.test(fn));

  const migrations = [...Deno.readDirSync(new URL('supabase/migrations/', ROOT))].filter((f) => f.name.endsWith('.sql')).map((f) => f.name);
  const statements = migrations.flatMap((f) => read(`supabase/migrations/${f}`).split(';'));
  const policies = statements.filter((s) => /create\s+policy/i.test(s));
  ok('policy: no migration writes a policy that mentions a member', policies.length > 0 && !policies.some((s) => /site_members/.test(s)));
  // Item 135 (0152): my_client_ids is defined once more, to never match an empty address —
  // the `u.email &&` this suite's model below has always had. Its other ways in are unchanged.
  const defs = statements.filter((s) => /create\s+(or\s+replace\s+)?function\s+"?(public"?\.)?"?(my_client_ids|my_presence_site_ids)/i.test(s));
  const latest = read('supabase/migrations/0152_site_without_owner.sql');
  const redefined = latest.slice(latest.indexOf('create or replace function public.my_client_ids()'), latest.indexOf('$$;'));
  ok('policy: no other migration redefines either function (the baseline, 0015 and 0152)', defs.length === 3 && defs.filter((s) => /my_client_ids"?\(\)\s+returns/i.test(s)).length === 2);
  ok('policy: 0152\'s my_client_ids is this model — the contact, or a NON-EMPTY address on either email column, never a member', /co\.auth_user_id = auth\.uid\(\)/.test(redefined) && /cl\.email/.test(redefined) && /cl\.contact_email/.test(redefined) && /coalesce\(auth\.jwt\(\) ->> 'email', ''\) <> ''/.test(redefined) && !/site_members/.test(redefined));
  ok('policy: an invite writes a member row and no client or contact', !/\bclients\b|\bcontacts\b/.test(read('supabase/functions/presence/lib/workspace.ts').split('export async function addSiteMember')[1].split('export async function revokeSiteMember')[0]));

  reset();
  ok('model: the owner, by contact, is admitted to their site', JSON.stringify(myPresenceSiteIds(USERS['jwt-owner'])) === JSON.stringify([SITE_A]));
  ok('model: another owner, by contact_email, is admitted to theirs', JSON.stringify(myPresenceSiteIds(USERS['jwt-owner-b'])) === JSON.stringify([SITE_B]));
  for (const [role, jwt] of [...SEATS, ['client_reviewer', 'jwt-reviewer']]) ok(`model: a ${role} member is admitted nowhere`, myPresenceSiteIds(USERS[jwt]).length === 0);
  ok('model: a member carrying the client\'s own email IS admitted, as an owner', JSON.stringify(myPresenceSiteIds(USERS['jwt-both'])) === JSON.stringify([SITE_A]));
}

// ═══ 2. the role table, and what each write needs ═══
{
  const FIELDS_IN_SOURCE = [...read('supabase/functions/presence/routes/content.ts').split('const SETTINGS_FIELDS')[1].split('\n};')[0].matchAll(/(?<!kind: 'json', )\b([a-z_]+): \{/g)].map((m) => m[1]);   // a JSON field's own limits (json: {…}) aren't a field
  const CONFIG = ['industry_key', 'auto_ack_enquiries', 'invoice_reminders', 'invoice_remind_after_days', 'deal_nudges', 'deal_nudge_days', 'review_requests', 'review_request_after_days', 'visit_counter', 'ai_crawlers', 'search_hidden', 'llms_txt', 'google_tag_id', 'meta_pixel_id', 'stage_stale_days', 'google_site_verification', 'bing_site_verification',
    // sales item 87 (0175): the recipes are automations, so they need configure like the switches above
    'auto_ack_message', 'enquiry_followups', 'enquiry_followup_1_days', 'enquiry_followup_2_days', 'enquiry_followup_1_message', 'enquiry_followup_2_message', 'invoice_overdue_repeat', 'quote_expiry_reminders',
    // sales item 88 (0176): who signs agreements for the studio
    'signs_as_name', 'signs_as_title'];
  ok('fields: the settings field list was read', FIELDS_IN_SOURCE.length >= 25, FIELDS_IN_SOURCE.join(','));
  ok('fields: every settings field is on one side, and the audited split still holds',
    FIELDS_IN_SOURCE.every((f) => SETTINGS_CONTENT_FIELDS.has(f) !== CONFIG.includes(f)), FIELDS_IN_SOURCE.filter((f) => SETTINGS_CONTENT_FIELDS.has(f) === CONFIG.includes(f)).join(','));
  ok('fields: nothing on the content side is stale', [...SETTINGS_CONTENT_FIELDS].every((f) => FIELDS_IN_SOURCE.includes(f)));

  const needs = (route, method, fields) => contentWriteNeeds(route, method, fields);
  ok('needs: the singletons are edit', ['/identity', '/location', '/brand/profile'].every((r) => needs(r, 'PUT') === 'edit'));
  ok('needs: their reads are not writes', ['/identity', '/location', '/brand/profile', '/settings', '/offerings'].every((r) => needs(r, 'GET') === null));
  ok('needs: duplicating a page is edit', needs('/pages/duplicate', 'POST') === 'edit');
  ok('needs: settings with only content is edit', needs('/settings', 'PUT', ['blocks', 'announcement_text']) === 'edit');
  ok('needs: settings with no fields is edit, and the handler refuses it as empty', needs('/settings', 'PUT', []) === 'edit');
  for (const f of CONFIG) ok(`needs: settings.${f} is configure`, needs('/settings', 'PUT', [f]) === 'configure');
  ok('needs: one configuration field among content makes the whole save configure', needs('/settings', 'PUT', ['blocks', 'google_site_verification']) === 'configure');
  ok('needs: a field nobody listed is configure, so a new column starts closed', needs('/settings', 'PUT', ['brand_new_column']) === 'configure');
  for (const e of ['offerings', 'testimonials', 'faqs', 'posts']) {
    ok(`needs: /${e} create and edit are edit`, needs(`/${e}`, 'POST') === 'edit' && needs(`/${e}/${ROW_A}`, 'PUT') === 'edit' && needs(`/${e}/${ROW_A}`, 'PATCH') === 'edit');
    ok(`needs: /${e} remove is delete`, needs(`/${e}/${ROW_A}`, 'DELETE') === 'delete');
    ok(`needs: /${e} with a method the handler ignores is no write`, needs(`/${e}`, 'DELETE') === null && needs(`/${e}/${ROW_A}`, 'POST') === null);
  }
  ok('needs: a route off this path is not this table\'s business', ['/publish', '/media/upload-url', '/foundations/plans', '/portal/members'].every((r) => needs(r, 'POST') === null));
}

// ═══ 3. which identity siteDb hands a member ═══
{
  const asks = async (db, path = `presence_identity?site_id=eq.${SITE_A}&select=business_name`) => { calls = []; const r = await db(path); return { r, c: calls[0] }; };
  reset();
  for (const [role, jwt] of SEATS) {
    const t = await asks(dbFor(seated(jwt, role)));
    ok(`${role}: a pinned read → the service role`, t.c.token === 'SERVICE-KEY' && t.c.apikey === 'SERVICE-KEY' && t.r.json[0].business_name === 'Alpha Cafe');
  }
  let t = await asks(dbFor(seated('jwt-reviewer', 'client_reviewer')));
  ok('client_reviewer: their JWT, so RLS answers nothing', t.c.role === 'user' && t.c.token === 'jwt-reviewer' && t.r.json.length === 0);
  t = await asks(dbFor(seated('jwt-staff', 'made_up_role')));
  ok('an unknown role: their JWT', t.c.role === 'user' && t.r.json.length === 0);
  t = await asks(dbFor(principalOf('jwt-staff')));
  ok('no seat: their JWT, the wall as it was', t.c.role === 'user' && t.r.json.length === 0);
  t = await asks(dbFor(principalOf('jwt-staff', { member: null })));
  ok('a null seat: their JWT', t.c.role === 'user');
  t = await asks(dbFor(seated('jwt-staff', 'business_staff'), B));
  ok('a seat on A with a site row for B → their JWT, so RLS refuses', t.c.role === 'user' && t.r.json.length === 0);

  const seat = seated('jwt-staff', 'business_staff');
  calls = [];
  const refused = await dbFor(seat)(`presence_identity?site_id=eq.${SITE_B}`);
  ok('a query outside the pin never reaches the network', calls.length === 0 && refused.ok === false && refused.status === 403);
  calls = [];
  const noFilter = await dbFor(seat)('presence_identity?select=business_name');
  ok('a query with no site filter never reaches the network', calls.length === 0 && noFilter.status === 403);

  const write = { method: 'PATCH', body: JSON.stringify({ business_name: 'x' }) };
  const path = `presence_identity?site_id=eq.${SITE_A}`;
  calls = [];
  const uncleared = await dbFor(seat)(path, write);
  ok('a write the gate never cleared fails closed, off the network', calls.length === 0 && uncleared.status === 403 && uncleared.text === 'write_not_cleared');
  const cleared = dbFor({ ...seat, member: { ...seat.member, cleared: true } });
  calls = [];
  await cleared(path, write);
  ok('…and goes through once it is cleared', calls.length === 1 && calls[0].role === 'service' && pinned(calls[0], SITE_A));
  calls = [];
  const outside = await cleared(`presence_identity?site_id=eq.${SITE_B}`, write);
  ok('being cleared never lifts the pin', calls.length === 0 && outside.status === 403 && outside.text === 'not_filtered_to_site');
  const scopedOnly = siteDb('jwt-studio', A, { scope: { site_id: SITE_A, name: 'x' } });
  calls = [];
  await scopedOnly(path, write);
  ok('a studio\'s scope needs no clearing: SC-1 is unchanged', calls.length === 1 && calls[0].role === 'service');
}

// ═══ 4. the seat that admits a member comes from their own row ═══
{
  const find = (jwt) => resolveMemberSite({ userId: USERS[jwt].id, email: USERS[jwt].email });
  reset();
  for (const [role, jwt] of [...SEATS, ['client_reviewer', 'jwt-reviewer']]) {
    const s = await find(jwt);
    ok(`seat: a ${role} gets their site and the role their row states`, s?.site.id === SITE_A && s.member?.site_id === SITE_A && s.member.role === role);
  }
  for (const [role, jwt] of [...SEATS, ['client_reviewer', 'jwt-reviewer']]) ok(`seat: RLS finds no site for a ${role}, so the fallback runs`, await resolveSite(jwt) === null);
  ok('seat: RLS finds the owner their site, so the fallback never runs', (await resolveSite('jwt-owner'))?.id === SITE_A);
  ok('seat: RLS finds the site for a seat holder with the client\'s own email: an owner, with no seat', (await resolveSite('jwt-both'))?.id === SITE_A);
  ok('seat: a revoked member has none', await find('jwt-revoked') === null);
  ok('seat: a stranger has none', await find('jwt-stranger') === null);
  const email = await find('jwt-by-email');
  ok('seat: an invite matched by email, before user_id is learned', email?.site.id === SITE_A && email.member.role === 'business_staff');
  const two = await find('jwt-two-seats');
  ok('seat: two seats → the oldest, and only that one', two?.site.id === SITE_A && two.member.role === 'developer');

  reset();
  T.presence_site_members.find((m) => m.email === USERS['jwt-staff'].email).role = 'made_up_role';
  const odd = await find('jwt-staff');
  ok('seat: an unknown role still finds the site, as today, but carries no seat', odd?.site.id === SITE_A && odd.member === null);
  reset();
  T.presence_sites = [B];
  ok('seat: a site that is gone → none', await find('jwt-staff') === null);
  reset();
  failSeatReads = true;
  ok('seat: a failed read → none', await find('jwt-staff') === null);
  reset();
  T.presence_site_members.push({ id: 'seat-b', site_id: SITE_B, email: 'someone@example.com', user_id: uuid('2'), role: 'business_owner', status: 'active', created_at: '2020-01-01T00:00:00Z' });
  const other = await find('jwt-staff');
  ok('seat: someone else\'s older seat elsewhere is not mine', other?.site.id === SITE_A);
}

// ═══ 5. every content read ═══
const READS = [
  { route: 'GET /site', tables: ['presence_identity', 'presence_locations', 'presence_brand_profile'], run: (db) => handleGetSite(db, A, cors), has: (b) => b.data.identity?.business_name === 'Alpha Cafe' && b.data.location?.city === 'Alpha-town' && b.data.voice?.tone_notes === 'Alpha voice' },
  { route: 'GET /identity', tables: ['presence_identity'], run: (db) => handleGetIdentity(db, A, cors), has: (b) => b.data?.business_name === 'Alpha Cafe' },
  { route: 'GET /location', tables: ['presence_locations'], run: (db, p) => handleLocation(req('GET', '/location'), db, A, p, cors), has: (b) => b.data?.city === 'Alpha-town' },
  { route: 'GET /settings', tables: ['presence_settings'], run: (db, p) => handleSettings(req('GET', '/settings'), db, A, p, cors), has: (b) => b.data?.announcement_text === 'Alpha news' },
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
];
const blank = ({ status, body }) => status === 404 || body.data === null || (Array.isArray(body.data) && body.data.length === 0) || body.data?.identity === null || (Array.isArray(body.data?.desired) && body.data.desired.length === 0);

for (const r of READS) {
  for (const [role, jwt] of SEATS) {
    const p = seated(jwt, role);
    reset();
    const out = await answer(await r.run(dbFor(p), p));
    ok(`${r.route} ${role}: the site's real data`, out.status === 200 && r.has(out.body), JSON.stringify(out.body).slice(0, 120));
    ok(`${r.route} ${role}: nothing of the other tenant`, !JSON.stringify(out.body).includes('Bravo'));
    ok(`${r.route} ${role}: service role, pinned, no JWT call`, !calls.some((c) => c.role === 'user') && r.tables.every((t) => calls.some((c) => c.table === t && c.role === 'service' && pinned(c, SITE_A))));
  }

  // the bug as it stood: the same caller with no seat on the data path
  const walled = principalOf('jwt-staff');
  reset();
  let out = await answer(await r.run(dbFor(walled), walled));
  ok(`${r.route} a member with no seat: RLS answers nothing`, blank(out), JSON.stringify(out.body).slice(0, 120));

  reset();
  out = await answer(await r.run(dbFor(owner), owner));
  ok(`${r.route} owner: same data`, out.status === 200 && r.has(out.body));
  const viaJwt = (c) => c.role === 'user' && c.token === 'jwt-owner' && c.apikey === 'ANON-KEY';
  ok(`${r.route} owner: the content query runs under their JWT and the anon key`,
    r.tables.every((t) => { const on = calls.filter((c) => c.table === t); return r.route === 'GET /site' ? on.some(viaJwt) : on.length > 0 && on.every(viaJwt); }));
}

// ═══ 6. every content write, through the real gate, as each role ═══
const row = (t, site = SITE_A) => rowsOf(t, site)[0];
const REQUIRED = { offerings: { name: 'New plate', category: 'Mains' }, testimonials: { quote: 'New quote', author: 'Ana' }, faqs: { question: 'New?', answer: 'Yes' }, posts: { title: 'New post' } };
const EDIT = { offerings: { name: 'Edited' }, testimonials: { quote: 'Edited' }, faqs: { question: 'Edited' }, posts: { title: 'Edited' } };
const TABLE = { offerings: 'presence_offerings', testimonials: 'presence_testimonials', faqs: 'presence_faqs', posts: 'presence_posts' };
const WRITES = [
  { name: 'PUT /identity', method: 'PUT', route: '/identity', body: { business_name: 'Renamed' }, needs: 'edit', table: 'presence_identity', status: 200, rlsStatus: 403, run: (r, db, p) => handlePutIdentity(r, db, A, p, cors), saved: () => row('presence_identity').business_name === 'Renamed' },
  { name: 'PUT /location', method: 'PUT', route: '/location', body: { city: 'Newtown' }, needs: 'edit', table: 'presence_locations', status: 200, rlsStatus: 502, run: (r, db, p) => handleLocation(r, db, A, p, cors), saved: () => row('presence_locations').city === 'Newtown' && rowsOf('presence_locations', SITE_A).length === 1 },
  { name: 'PUT /settings (content)', method: 'PUT', route: '/settings', body: { announcement_text: 'Now open' }, needs: 'edit', table: 'presence_settings', status: 200, rlsStatus: 502, run: (r, db, p) => handleSettings(r, db, A, p, cors), saved: () => row('presence_settings').announcement_text === 'Now open' },
  { name: 'PUT /settings (a page)', method: 'PUT', route: '/settings', body: { blocks: [{ id: 'hero-2', type: 'hero', title: 'New' }] }, needs: 'edit', table: 'presence_settings', status: 200, rlsStatus: 502, run: (r, db, p) => handleSettings(r, db, A, p, cors), saved: () => row('presence_settings').blocks[0].id === 'hero-2' },
  { name: 'PUT /settings (verification code)', method: 'PUT', route: '/settings', body: { google_site_verification: 'abc' }, needs: 'configure', table: 'presence_settings', status: 200, rlsStatus: 502, run: (r, db, p) => handleSettings(r, db, A, p, cors), saved: () => row('presence_settings').google_site_verification === 'abc' },
  { name: 'PUT /settings (automation switch)', method: 'PUT', route: '/settings', body: { deal_nudges: true }, needs: 'configure', table: 'presence_settings', status: 200, rlsStatus: 502, run: (r, db, p) => handleSettings(r, db, A, p, cors), saved: () => row('presence_settings').deal_nudges === true },
  // deep pass, Part 7.11: the review switch (list item 29) and its days; a staff seat has no configure
  { name: 'PUT /settings (the review switch and its days)', method: 'PUT', route: '/settings', body: { review_requests: true, review_request_after_days: 5 }, needs: 'configure', table: 'presence_settings', status: 200, rlsStatus: 502, run: (r, db, p) => handleSettings(r, db, A, p, cors), saved: () => row('presence_settings').review_requests === true && row('presence_settings').review_request_after_days === 5 },
  { name: 'PUT /settings (content and a code together)', method: 'PUT', route: '/settings', body: { announcement_text: 'Now open', google_site_verification: 'abc' }, needs: 'configure', table: 'presence_settings', status: 200, rlsStatus: 502, run: (r, db, p) => handleSettings(r, db, A, p, cors), saved: () => row('presence_settings').google_site_verification === 'abc' && row('presence_settings').announcement_text === 'Now open' },
  { name: 'PUT /brand/profile', method: 'PUT', route: '/brand/profile', body: { mission: 'New mission' }, needs: 'edit', table: 'presence_brand_profile', status: 200, rlsStatus: 502, run: (r, db, p) => handleBrandProfilePut(r, db, A, p, cors), saved: () => row('presence_brand_profile').mission === 'New mission' },
  { name: 'POST /pages/duplicate', method: 'POST', route: '/pages/duplicate', body: { slug: '' }, needs: 'edit', table: 'presence_settings', status: 201, rlsStatus: 502, run: (r, db, p) => handlePageDuplicate(r, db, A, p, cors), saved: () => row('presence_settings').pages.length === 1 },
];
for (const e of Object.keys(REQUIRED)) {
  WRITES.push({ name: `POST /${e}`, method: 'POST', route: `/${e}`, body: REQUIRED[e], needs: 'edit', table: TABLE[e], status: 201, rlsStatus: 502, run: (r, db, p) => handleCollection(r, db, A, p, e, null, cors), saved: () => rowsOf(TABLE[e], SITE_A).length === 2 });
  WRITES.push({ name: `PUT /${e}/:id`, method: 'PUT', route: `/${e}/${ROW_A}`, body: EDIT[e], needs: 'edit', table: TABLE[e], status: 200, rlsStatus: 404, run: (r, db, p) => handleCollection(r, db, A, p, e, ROW_A, cors), saved: () => Object.values(row(TABLE[e])).includes('Edited') });
  WRITES.push({ name: `DELETE /${e}/:id`, method: 'DELETE', route: `/${e}/${ROW_A}`, needs: 'delete', table: TABLE[e], status: 200, rlsStatus: 404, run: (r, db, p) => handleCollection(r, db, A, p, e, ROW_A, cors), saved: () => !!row(TABLE[e]).deleted_at });
}
const writesOn = (t) => calls.filter((c) => c.table === t && c.method !== 'GET');
/* what index.ts does, in its order: the gate, then the data path, then the handler */
async function member(w, p, headers = {}) {
  const r = req(w.method, w.route, w.body, headers);
  const refused = await memberWriteGate(r, w.route, w.method, p.member, cors);
  if (refused) return answer(refused);
  return answer(await w.run(r, dbFor(p), p));
}

for (const w of WRITES) {
  for (const [role, jwt] of SEATS) {
    const p = seated(jwt, role);
    const allowed = siteCan(role, w.needs);
    reset();
    const before = tenantB();
    const seed = JSON.stringify(T[w.table].filter((x) => x.site_id === SITE_A));
    const out = await member(w, p);
    if (allowed) {
      ok(`${w.name} ${role}: ${w.status} and saved`, out.status === w.status && w.saved(), `${out.status} ${JSON.stringify(out.body).slice(0, 120)}`);
      ok(`${w.name} ${role}: the write is the service role, pinned`, writesOn(w.table).length === 1 && writesOn(w.table).every((c) => c.role === 'service' && pinned(c, SITE_A)));
      ok(`${w.name} ${role}: exactly one change event, on this site, in their name`, T.presence_change_events.length === 1 && T.presence_change_events[0].site_id === SITE_A && T.presence_change_events[0].actor_user_id === USERS[jwt].id);
    } else {
      ok(`${w.name} ${role}: refused, the role has no ${w.needs}`, out.status === 403 && out.body.error === 'forbidden', `${out.status} ${out.body.error}`);
      ok(`${w.name} ${role}: nothing written, no event`, writesOn(w.table).length === 0 && T.presence_change_events.length === 0 && JSON.stringify(T[w.table].filter((x) => x.site_id === SITE_A)) === seed);
    }
    ok(`${w.name} ${role}: the other tenant is byte-identical`, tenantB() === before);
  }

  const walled = principalOf('jwt-staff');
  reset();
  let out = await answer(await w.run(req(w.method, w.route, w.body), dbFor(walled), walled));
  ok(`${w.name} a member with no seat: refused as it was (${w.rlsStatus})`, out.status === w.rlsStatus && !w.saved(), `${out.status} ${out.body.error}`);
  ok(`${w.name} a member with no seat: no event`, T.presence_change_events.length === 0);

  // the owner never meets the gate (index.ts: principal.member is unset), whatever they send
  reset();
  out = await answer(await w.run(req(w.method, w.route, w.body), dbFor(owner), owner));
  ok(`${w.name} owner: ${w.status} and saved`, out.status === w.status && w.saved());
  ok(`${w.name} owner: under their JWT and the anon key`, writesOn(w.table).length === 1 && writesOn(w.table).every((c) => c.role === 'user' && c.token === 'jwt-owner' && c.apikey === 'ANON-KEY'));
  ok(`${w.name} owner: the change event says client`, T.presence_change_events[0]?.actor_kind === 'client');
}
// deep pass, Part 7.11: a day count the review switch can't use is refused whole, even from
// the owner, and nothing is written (the page keeps the box in range; this is the server's half)
for (const days of [0, 91, -3, 'soon']) {
  reset();
  const seed = JSON.stringify(T.presence_settings.filter((x) => x.site_id === SITE_A));
  const out = await answer(await handleSettings(req('PUT', '/settings', { review_requests: true, review_request_after_days: days }), dbFor(owner), A, owner, cors));
  ok(`review switch: ${JSON.stringify(days)} days is refused, and nothing is written`, out.status === 422 && out.body.error === 'validation_failed' && out.body.fields?.[0]?.field === 'review_request_after_days'
    && writesOn('presence_settings').length === 0 && T.presence_change_events.length === 0 && JSON.stringify(T.presence_settings.filter((x) => x.site_id === SITE_A)) === seed, `${out.status} ${JSON.stringify(out.body).slice(0, 120)}`);
}
{
  reset();
  const out = await answer(await handleSettings(req('PUT', '/settings', { review_request_after_days: 2.9 }), dbFor(owner), A, owner, cors));
  ok('review switch: a part day is cut to whole days', out.status === 200 && row('presence_settings').review_request_after_days === 2, `${out.status} ${row('presence_settings').review_request_after_days}`);
}

// ═══ 7. the role table is what the routes obey, not a coincidence of this list ═══
{
  ok('staff: edits, can\'t delete, can\'t configure', siteCan('business_staff', 'edit') && !siteCan('business_staff', 'delete') && !siteCan('business_staff', 'configure'));
  ok('developer: edits and configures, can\'t delete', siteCan('developer', 'edit') && siteCan('developer', 'configure') && !siteCan('developer', 'delete'));
  ok('owner seat: all of it', siteCan('business_owner', 'edit') && siteCan('business_owner', 'configure') && siteCan('business_owner', 'delete'));
  ok('every write on the list needs a capability', WRITES.every((w) => contentWriteNeeds(w.route, w.method, w.route === '/settings' ? Object.keys(w.body) : []) === w.needs));
  const p = seated('jwt-staff', 'business_staff');
  reset();
  const bad = await memberWriteGate(new Request('http://stub.local/functions/v1/presence/settings', { method: 'PUT', body: 'not json' }), '/settings', 'PUT', p.member, cors);
  ok('gate: an unreadable settings body reaches the handler, which refuses it', bad === null && p.member.cleared === true);
  const handled = await answer(await handleSettings(new Request('http://stub.local/functions/v1/presence/settings', { method: 'PUT', body: 'not json' }), dbFor(p), A, p, cors));
  ok('…as bad_json, after the gate read a clone of the body', handled.status === 400 && handled.body.error === 'bad_json');
  const other = seated('jwt-staff', 'business_staff');
  ok('gate: a route off this path passes, uncleared', await memberWriteGate(req('POST', '/publish', {}), '/publish', 'POST', other.member, cors) === null && other.member.cleared === false);
}

// ═══ 8. a reviewer stays limited ═══
{
  const uuidPath = (route) => route.replace(':id', ROW_A);
  ok('reviewer: refused every read on this path', READS.every((r) => { const [m, q] = r.route.split(' '); return reviewerAllowed(uuidPath(q), m) === false; }));
  ok('reviewer: refused every write on this path', WRITES.every((w) => reviewerAllowed(w.route, w.method) === false));
  ok('reviewer: what they can reach is still only theirs', reviewerAllowed('/portal/context', 'GET') && reviewerAllowed('/portal/feed', 'GET') && reviewerAllowed(`/launches/${ROW_A}/decide`, 'POST'));

  const reviewer = seated('jwt-reviewer', 'client_reviewer');
  reset();
  const read = await answer(await handleGetIdentity(dbFor(reviewer), A, cors));
  ok('reviewer: past the boundary by some slip, RLS still answers nothing', read.body.data === null && calls.every((c) => c.role === 'user'));
  const write = await answer(await handlePutIdentity(req('PUT', '/identity', { business_name: 'x' }), dbFor(reviewer), A, reviewer, cors));
  ok('reviewer: …and a write is refused by RLS', write.status === 403 && row('presence_identity').business_name === 'Alpha Cafe');
  const gate = await memberWriteGate(req('PUT', '/identity', { business_name: 'x' }), '/identity', 'PUT', reviewer.member, cors);
  ok('reviewer: the gate refuses a content write too', gate?.status === 403);

  // resolveSiteRole falls open to business_owner on a failed read. That default is
  // meant for an owner; for a member it would walk them past the reviewer boundary.
  reset();
  failSeatReads = true;
  ok('fail-open: on a failed read, resolveSiteRole alone says business_owner (why the seat outranks it)', await resolveSiteRole('jwt-reviewer', SITE_A, 'client') === 'business_owner');
  const role = await resolveSiteRoleCached(seated('jwt-reviewer', 'client_reviewer'), 'jwt-reviewer', SITE_A);
  ok('fail-open: the reviewer boundary reads the seat, so they stay a reviewer', role === 'client_reviewer');
  ok('fail-open: a seat on another site doesn\'t speak for this one', await resolveSiteRoleCached(principalOf('jwt-reviewer', { member: { site_id: SITE_B, role: 'client_reviewer' } }), 'jwt-reviewer', SITE_A) === 'business_owner');
  reset();
  const learned = T.presence_site_members.find((m) => m.email === USERS['jwt-by-email'].email);
  await resolveSiteRoleCached(seated('jwt-by-email', 'business_staff'), 'jwt-by-email', SITE_A);
  ok('the seat outranking the lookup still learns a member\'s user_id on first sight', learned.user_id === USERS['jwt-by-email'].id);
  T.presence_site_members = T.presence_site_members.filter((m) => m.email !== USERS['jwt-owner'].email);
  ok('an owner with no seat keeps today\'s answer', await resolveSiteRoleCached(principalOf('jwt-owner'), 'jwt-owner', SITE_A) === 'business_owner');
}

// ═══ 9. a member never reaches another site ═══
{
  const p = () => seated('jwt-coowner', 'business_owner');    // the widest role, so the role is never what stops it
  for (const e of Object.keys(TABLE)) {
    reset(); let before = tenantB();
    let out = await member({ method: 'PUT', route: `/${e}/${ROW_B}`, body: EDIT[e], run: (r, db, x) => handleCollection(r, db, A, x, e, ROW_B, cors) }, p());
    ok(`cross-tenant: PUT another tenant's ${e} row by id → 404, untouched`, out.status === 404 && tenantB() === before && T.presence_change_events.length === 0);
    reset(); before = tenantB();
    out = await member({ method: 'DELETE', route: `/${e}/${ROW_B}`, run: (r, db, x) => handleCollection(r, db, A, x, e, ROW_B, cors) }, p());
    ok(`cross-tenant: DELETE another tenant's ${e} row by id → 404, untouched`, out.status === 404 && tenantB() === before && T.presence_change_events.length === 0);
  }
  reset();
  for (const [name, h] of [['writer draft', handleWriterGet], ['AI review', handleReviewGet], ['brand report', handleBrandReportGet]]) {
    const out = await answer(await h(dbFor(p()), A, ROW_B, cors));
    ok(`cross-tenant: GET another tenant's ${name} by id → 404`, out.status === 404);
  }
  reset(); let before = tenantB();
  let out = await member({ method: 'POST', route: '/offerings', body: { ...REQUIRED.offerings, site_id: SITE_B }, run: (r, db, x) => handleCollection(r, db, A, x, 'offerings', null, cors) }, p());
  ok('cross-tenant: POST /offerings naming the other site in the body → lands on their own site', out.status === 201 && rowsOf('presence_offerings', SITE_A).length === 2 && tenantB() === before);
  reset(); before = tenantB();
  out = await member({ method: 'PUT', route: '/identity', body: { business_name: 'Hijacked', site_id: SITE_B }, run: (r, db, x) => handlePutIdentity(r, db, A, x, cors) }, p());
  ok('cross-tenant: PUT /identity naming the other site in the body → refused as an unknown field', out.status === 422 && tenantB() === before);
  reset(); before = tenantB();
  out = await member({ method: 'PUT', route: '/settings', body: { announcement_text: 'Hijacked', site_id: SITE_B }, run: (r, db, x) => handleSettings(r, db, A, x, cors) }, p());
  ok('cross-tenant: PUT /settings naming the other site → lands on their own site at most', tenantB() === before);

  // the seat says A, the handler is handed B: a wiring slip must fail closed
  reset(); before = tenantB();
  const slip = p();
  await memberWriteGate(req('PUT', '/identity', { business_name: 'Hijacked' }), '/identity', 'PUT', slip.member, cors);
  const mismatched = siteDb(slip.jwt, B, slip);
  out = await answer(await handleGetIdentity(mismatched, B, cors));
  ok('a seat on A with a site row for B: reads nothing', out.status === 200 && out.body.data === null);
  out = await answer(await handlePutIdentity(req('PUT', '/identity', { business_name: 'Hijacked' }), mismatched, B, slip, cors));
  ok('a seat on A with a site row for B: writes refused by RLS', out.status === 403 && out.body.error === 'write_failed' && tenantB() === before);
}

// ═══ 10. the optimistic lock on a member's write ═══
{
  reset();
  const h0 = await draftHashForSite(A);
  const put = (name, headers) => member({ method: 'PUT', route: '/identity', body: { business_name: name }, run: (r, db, x) => handlePutIdentity(r, db, A, x, cors) }, seated('jwt-staff', 'business_staff'), headers);
  let out = await put('Should not land', { 'If-Match': '"deadbeef"' });
  ok('lock: a stale If-Match → 409 stale_draft, nothing written', out.status === 409 && out.body.error === 'stale_draft' && out.body.current_hash === h0 && row('presence_identity').business_name === 'Alpha Cafe' && T.presence_change_events.length === 0);
  out = await put('Renamed', { 'If-Match': `"${h0}"` });
  ok('lock: the current hash → saved', out.status === 200 && row('presence_identity').business_name === 'Renamed');
  out = await put('Overwrites the newer edit', { 'If-Match': `"${h0}"` });
  ok('lock: the old hash is now stale → 409, the newer edit survives', out.status === 409 && row('presence_identity').business_name === 'Renamed');
  ok('lock: …and the conflict names the business\'s side, not the studio', out.body.last_change?.actor_kind === 'client');

  reset();
  const shared = await draftHashForSite(A);
  await handlePutIdentity(req('PUT', '/identity', { business_name: 'The owner got there first' }), dbFor(owner), A, owner, cors);
  out = await put('From a stale tab', { 'If-Match': `"${shared}"` });
  ok('lock: the owner saves, then a member\'s stale tab → 409, the owner\'s edit survives', out.status === 409 && row('presence_identity').business_name === 'The owner got there first');
}

// ═══ 11. change events say whose hand it was ═══
{
  reset();
  await member({ method: 'PUT', route: '/identity', body: { business_name: 'Secret new name' }, run: (r, db, x) => handlePutIdentity(r, db, A, x, cors) }, seated('jwt-staff', 'business_staff'));
  const ev = T.presence_change_events[0];
  ok('attribution: a member → client, the business\'s side, never the studio\'s operator', ev.actor_kind === 'client');
  ok('attribution: …with the member\'s own user id, on their site', ev.actor_user_id === USERS['jwt-staff'].id && ev.site_id === SITE_A);
  ok('attribution: field names only, never the value', JSON.stringify(ev.detail) === '{"fields":["business_name"]}' && !JSON.stringify(ev).includes('Secret new name'));
}

// ═══ 12. wiring: the code above is what production runs ═══
{
  const idx = read('supabase/functions/presence/index.ts');
  const at = (s) => idx.indexOf(s);
  const SEAT = "if (principal.kind === 'client') principal.member = seated.member;";
  const REVIEWER = "if (siteRole === 'client_reviewer' && !reviewerAllowed(route, method))";
  const GATE = 'const refused = await memberWriteGate(req, route, method, principal.member, cors);';
  const BUILD = 'const db = siteDb(jwt, site, principal);';
  ok('index: the seat is stamped in one place, only for a client caller, so platform staff stay as they were', idx.split('principal.member =').length === 2 && at(SEAT) > 0);
  ok('index: …only in the un-scoped branch, after RLS found no site of their own',
    /\} else \{\s*site = await resolveSite\(jwt\);/.test(idx) && at('site = await resolveSite(jwt);') < at('if (!site && (principal.userId || principal.email))') && at('if (!site && (principal.userId || principal.email))') < at(SEAT) && at('principal.scope = {') < at('site = await resolveSite(jwt);'));
  ok('index: the reviewer boundary runs before the member gate, and the gate before the data path', at(REVIEWER) > 0 && at(REVIEWER) < at(GATE) && at(GATE) < at(BUILD));
  ok('index: the gate applies to every write method', idx.includes("const isWrite = method === 'PUT' || method === 'POST' || method === 'DELETE' || method === 'PATCH';") && idx.includes('if (principal.member && isWrite) {'));
  ok('index: the gate\'s refusal returns', idx.includes('if (refused) return refused;'));
  ok('index: the data path is built once', idx.split('siteDb(').length === 2);

  // A write route handed the data path has to be classified, or a member's write on
  // it fails closed in siteDb. So a new one fails here until someone decides what it needs.
  const onPath = idx.split('\n').filter((l) => /\((req, )?db,/.test(l) && /route === '/.test(l) && /'(PUT|POST|PATCH|DELETE)'/.test(l));
  const writes = onPath.map((l) => [l.match(/route === '([^']+)'/)[1], l.match(/'(PUT|POST|PATCH|DELETE)'/)[1]]);
  ok('index: the write routes handed the data path were found', JSON.stringify(writes.map(([r]) => r).sort()) === JSON.stringify(['/brand/profile', '/identity', '/location', '/pages/duplicate', '/settings']), writes.map(([r]) => r).join(','));
  ok('index: every one is classified', writes.every(([r, m]) => contentWriteNeeds(r, m) !== null));
  ok('index: and the collections, the one route handed it by pattern, are the same four', idx.includes('route.match(/^\\/(offerings|testimonials|faqs|posts)(?:\\/([0-9a-f-]{36}))?$/)') && read('supabase/functions/presence/lib/site_roles.ts').includes('(?:offerings|testimonials|faqs|posts)'));
  ok('this suite drives each of them', [...writes.map(([r]) => r), ...Object.keys(TABLE).map((e) => `/${e}`)].every((r) => WRITES.some((w) => w.route === r || w.route.startsWith(`${r}/`))));

  const attrib = read('supabase/functions/presence/lib/actor_kind.ts');
  ok('attribution reads the scope, never the seat', !/\.member\b/.test(attrib));

  const stamps = [];
  const walk = (dir) => {
    for (const f of Deno.readDirSync(new URL(dir, ROOT))) {
      if (f.isDirectory) walk(`${dir}${f.name}/`);
      else if (f.name.endsWith('.ts') && /\bprincipal\.member\s*=[^=]/.test(read(`${dir}${f.name}`))) stamps.push(`${dir}${f.name}`);
    }
  };
  walk('supabase/functions/presence/');
  walk('supabase/functions/_shared/');
  ok('nothing else assigns a principal\'s seat', JSON.stringify(stamps) === '["supabase/functions/presence/index.ts"]', stamps.join(','));

  ok('roles: the list this suite iterates covers every role', SITE_ROLES.length === 4 && SEATS.length === 3 && SITE_ROLES.every((r) => r === 'client_reviewer' || SEATS.some(([s]) => s === r)));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ MEMBER CONTENT: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
