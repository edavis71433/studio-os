// ── Final pass on the sales side, security batch A (Nov 8 2026) ──────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/security_batch_a_test.mjs
// Drives the real handlers against a small in-memory PostgREST and asserts what
// was — and was NOT — written:
//   S1  a studio only gets a site it created, one already its customer, or one
//       whose owner accepted its request (connect, set up now, convert, the agency
//       "add a site" route); the email check and the account lookup can't be
//       turned into "any account"; the owner's Accept / Decline.
//   S2  a template can't be named like Studio OS's own settings rows.
//   S3  the record never follows a link onto another studio's site.
//   F1  opening the record from a deal or a contact finds the customer, not the
//       studio itself.
const SERVICE = 'svc-key';
Deno.env.set('SUPABASE_URL', 'https://db.test');
Deno.env.set('SERVICE_ROLE_KEY', SERVICE);
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
// the studio under test, another studio, and three accounts
const STUDIO_SITE = uuid('1'), STUDIO_CLIENT = uuid('2'), AG1 = uuid('3'), U_STUDIO = uuid('4');
const OTHER_SITE = uuid('5'), OTHER_CLIENT = uuid('6'), AG2 = uuid('7');
const CUST_CLIENT = uuid('8'), CUST_SITE = uuid('9'), U_CUST = uuid('a');        // signed up on their own, no studio
const M_CLIENT = uuid('b'), M_SITE = uuid('c'), P_OTHER = uuid('d');            // the OTHER studio's customer
const MINE_CLIENT = uuid('e'), MINE_SITE = uuid('f'), P_MINE = '0aaaaaaa-0000-4000-8000-000000000001';
const D_MINE = '0aaaaaaa-0000-4000-8000-000000000002', C_MINE = '0aaaaaaa-0000-4000-8000-000000000003';
const D_M = '0aaaaaaa-0000-4000-8000-000000000004', C_M = '0aaaaaaa-0000-4000-8000-000000000005';

const USERS = {
  'jwt-studio': { id: U_STUDIO, email: 'owner@studio.test' },
  'jwt-cust': { id: U_CUST, email: 'sam@harbor.test' },
  'jwt-m': { id: uuid('0'), email: 'dana@willow.test' },
};
const OWN_SITE = { 'jwt-studio': STUDIO_SITE, 'jwt-cust': CUST_SITE, 'jwt-m': M_SITE };
const UNIQUE = {
  presence_agency_clients: ['site_id'], presence_connect_requests: ['studio_site_id', 'email'],
  presence_customer_agency: ['customer_client_id'], presence_service_links: ['project_id'],
};

let T, log, failTables;
function world() {
  T = {
    presence_sites: [
      { id: STUDIO_SITE, client_id: STUDIO_CLIENT, status: 'live', edition: 'presence' },
      { id: OTHER_SITE, client_id: OTHER_CLIENT, status: 'live', edition: 'presence' },
      { id: CUST_SITE, client_id: CUST_CLIENT, status: 'draft', edition: 'presence' },
      { id: M_SITE, client_id: M_CLIENT, status: 'live', edition: 'presence' },
      { id: MINE_SITE, client_id: MINE_CLIENT, status: 'live', edition: 'monitor' },
    ],
    clients: [
      { id: STUDIO_CLIENT, name: 'Test Studio', email: 'owner@studio.test', contact_email: null, deleted_at: null },
      { id: OTHER_CLIENT, name: 'Other Studio', email: 'boss@other.test', contact_email: null, deleted_at: null },
      { id: CUST_CLIENT, name: 'Sam Rivera', email: 'sam@harbor.test', contact_email: null, deleted_at: null },
      { id: M_CLIENT, name: 'Dana Lee', email: 'dana@willow.test', contact_email: null, deleted_at: null },
      { id: MINE_CLIENT, name: 'Lee Park', email: 'lee@maple.test', contact_email: null, deleted_at: null },
    ],
    presence_identity: [
      { site_id: STUDIO_SITE, business_name: 'Test Studio' }, { site_id: OTHER_SITE, business_name: 'Other Studio' },
      { site_id: CUST_SITE, business_name: 'Harbor Lane Bakery' }, { site_id: M_SITE, business_name: 'Willow Day Spa' },
      { site_id: MINE_SITE, business_name: 'Maple Street Studio' },
    ],
    presence_agency_members: [
      { id: uuid('0').replace(/^0/, '1'), agency_id: AG1, email: 'owner@studio.test', user_id: U_STUDIO, role: 'owner', status: 'active' },
    ],
    presence_agencies: [{ id: AG1, name: 'Test Studio', status: 'active', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} }, { id: AG2, name: 'Other Studio', status: 'active', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} }],
    presence_agency_clients: [{ site_id: M_SITE, agency_id: AG2, status: 'active', owner_email: 'boss@other.test' }],
    presence_customer_agency: [
      { customer_client_id: M_CLIENT, agency_site_id: OTHER_SITE },
      { customer_client_id: MINE_CLIENT, agency_site_id: STUDIO_SITE },
    ],
    presence_service_links: [
      { project_id: P_OTHER, agency_site_id: OTHER_SITE, customer_client_id: M_CLIENT, customer_site_id: M_SITE, status: 'active', deal_id: D_M, created_at: '2026-07-01T00:00:00Z' },
      { project_id: P_MINE, agency_site_id: STUDIO_SITE, customer_client_id: MINE_CLIENT, customer_site_id: MINE_SITE, status: 'active', deal_id: D_MINE, created_at: '2026-07-01T00:00:00Z' },
    ],
    presence_projects: [
      { id: P_OTHER, site_id: OTHER_SITE, client_id: M_CLIENT, name: 'Willow build', status: 'active', deleted_at: null, created_at: '2026-07-01T00:00:00Z' },
      { id: P_MINE, site_id: STUDIO_SITE, client_id: MINE_CLIENT, name: 'Maple build', status: 'active', deleted_at: null, created_at: '2026-07-01T00:00:00Z' },
    ],
    presence_deals: [
      { id: D_MINE, site_id: STUDIO_SITE, title: 'Maple Street Studio', stage: 'won', contact_id: C_MINE, converted_client_id: MINE_CLIENT, converted_site_id: MINE_SITE, created_project_id: P_MINE, converted_at: '2026-07-01T00:00:00Z', deleted_at: null, updated_at: '2026-07-01T00:00:00Z', expected_value_cents: 320000 },
      { id: D_M, site_id: STUDIO_SITE, title: 'Willow Day Spa', stage: 'won', contact_id: C_M, converted_client_id: null, converted_site_id: null, created_project_id: null, converted_at: null, deleted_at: null, updated_at: '2026-07-02T00:00:00Z', expected_value_cents: 90000 },
    ],
    presence_contacts: [
      { id: C_MINE, site_id: STUDIO_SITE, name: 'Lee Park', email: 'lee@maple.test', company: '', phone: '', client_id: null, notes: '', deleted_at: null, updated_at: '2026-07-01T00:00:00Z' },
      { id: C_M, site_id: STUDIO_SITE, name: 'Dana Lee', email: 'dana@willow.test', company: 'Willow Day Spa', phone: '', client_id: null, notes: '', deleted_at: null, updated_at: '2026-07-01T00:00:00Z' },
    ],
    presence_connect_requests: [], presence_sales_templates: [], presence_change_events: [],
    presence_support_requests: [
      { id: '0bbbbbbb-0000-4000-8000-000000000001', site_id: OTHER_SITE, project_id: null, client_id: null, requester: 'dana@willow.test', subject: 'Other studio’s private thread', status: 'open', deleted_at: null, created_at: '2026-07-03T00:00:00Z' },
    ],
    presence_project_messages: [
      { id: '0ccccccc-0000-4000-8000-000000000001', project_id: P_OTHER, site_id: OTHER_SITE, audience: 'shared', body: 'Other studio message', author_kind: 'studio', deleted_at: null, created_at: '2026-07-04T00:00:00Z' },
    ],
  };
  log = []; failTables = new Set();
}

// ── a small PostgREST ──
const reply = (body, status = 200, headers = {}) => new Response(status === 204 ? null : (body === null ? '' : JSON.stringify(body)), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const unq = (v) => { v = String(v); if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(.)/g, '$1'); return v; };
function splitTop(s) { const out = []; let cur = '', depth = 0, q = false; for (let i = 0; i < s.length; i++) { const ch = s[i]; if (q) { cur += ch; if (ch === '\\') { cur += s[++i] ?? ''; continue; } if (ch === '"') q = false; continue; } if (ch === '"') { q = true; cur += ch; continue; } if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; } cur += ch; } if (cur) out.push(cur); return out; }
const likeRe = (p, flags) => new RegExp('^' + String(p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/%/g, '.*') + '$', flags);
function test(row, col, expr) {
  const v = row[col];
  const m = /^(not\.)?(eq|neq|is|in|like|ilike|gte|lte|gt|lt)\.(.*)$/s.exec(expr);
  if (!m) return true;
  const [, not, op, raw] = m; let r;
  if (op === 'eq') r = String(v ?? '') === unq(raw) && v !== null && v !== undefined;
  else if (op === 'neq') r = String(v ?? '') !== unq(raw);
  else if (op === 'is') r = raw === 'null' ? (v === null || v === undefined) : String(v) === raw;
  else if (op === 'in') r = splitTop(raw.replace(/^\(|\)$/g, '')).map(unq).includes(String(v));
  else if (op === 'like') r = v != null && likeRe(unq(raw), 's').test(String(v));
  else if (op === 'ilike') r = v != null && likeRe(unq(raw), 'is').test(String(v));
  else if (op === 'gte') r = String(v ?? '') >= unq(raw); else if (op === 'lte') r = String(v ?? '') <= unq(raw);
  else if (op === 'gt') r = String(v ?? '') > unq(raw); else r = String(v ?? '') < unq(raw);
  return not ? !r : r;
}
const META = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
function filterRows(rows, params) {
  return rows.filter((row) => params.every(([k, v]) => {
    if (META.has(k)) return true;
    if (k === 'or') return splitTop(v.replace(/^\(|\)$/g, '')).some((c) => { const i = c.indexOf('.'); return test(row, c.slice(0, i), c.slice(i + 1)); });
    return test(row, k, v);
  }));
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  const h = new Headers(init.headers); const token = (h.get('Authorization') || '').replace(/^Bearer /, '');
  const body = init.body ? JSON.parse(String(init.body)) : null;
  log.push({ method, url: decodeURIComponent(u.pathname + u.search), body });
  if (u.pathname === '/auth/v1/user') return USERS[token] ? reply(USERS[token]) : reply({}, 401);
  if (u.pathname.startsWith('/auth/v1/admin/users/')) { const id = u.pathname.split('/').pop(); const x = Object.values(USERS).find((y) => y.id === id); return x ? reply(x) : reply({}, 404); }
  if (!u.pathname.startsWith('/rest/v1/')) return reply({}, 404);
  const table = u.pathname.slice('/rest/v1/'.length);
  if (failTables.has(table)) return reply({ message: 'relation does not exist' }, 404);
  const params = [...u.searchParams.entries()];
  if (token !== SERVICE) {   // a user token: row-level security lets them see their own site only
    if (table === 'presence_sites' && method === 'GET') return reply(OWN_SITE[token] ? T.presence_sites.filter((s) => s.id === OWN_SITE[token]) : []);
    return reply([]);
  }
  const rows = (T[table] ||= []);
  if (method === 'GET' || method === 'HEAD') {
    let out = filterRows(rows, params);
    const order = (u.searchParams.get('order') || '').split(',')[0];
    if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (dir === 'desc' ? -1 : 1)); }
    const lim = Number(u.searchParams.get('limit') || 0); if (lim) out = out.slice(0, lim);
    return method === 'HEAD' ? new Response(null, { status: 200, headers: { 'content-range': `*/${out.length}` } }) : reply(out);
  }
  const prefer = h.get('Prefer') || ''; const rep = prefer.includes('return=representation');
  if (method === 'POST') {
    const conflictCols = (u.searchParams.get('on_conflict') || '').split(',').filter(Boolean);
    const keys = conflictCols.length ? conflictCols : (UNIQUE[table] || []);
    const out = [];
    for (const rec of (Array.isArray(body) ? body : [body])) {
      const clash = keys.length ? rows.find((r) => keys.every((k) => String(r[k]) === String(rec[k]))) : null;
      if (clash) {
        if (prefer.includes('ignore-duplicates')) continue;
        if (prefer.includes('merge-duplicates')) { Object.assign(clash, rec); out.push(clash); continue; }
        return reply({ code: '23505', message: 'duplicate key' }, 409);
      }
      const row = { id: rec.id || crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null, ...rec };
      rows.push(row); out.push(row);
    }
    return rep ? reply(out, 201) : reply(null, 201);
  }
  if (method === 'PATCH') { const hit = filterRows(rows, params); for (const r of hit) Object.assign(r, body); return rep ? reply(hit) : reply(null, 204); }
  if (method === 'DELETE') { const hit = new Set(filterRows(rows, params)); T[table] = rows.filter((r) => !hit.has(r)); return reply(null, 204); }
  return reply({}, 405);
};
const wrote = (table) => log.filter((c) => c.method !== 'GET' && c.method !== 'HEAD' && c.url.startsWith(`/rest/v1/${table}`));
const read = (frag) => log.filter((c) => c.method === 'GET' && c.url.includes(frag));
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const site = (id) => T.presence_sites.find((s) => s.id === id);
const studio = (extra = {}) => ({ kind: 'client', userId: U_STUDIO, email: 'owner@studio.test', jwt: 'jwt-studio', requestId: 't', ...extra });
const ownerOf = (jwt, extra = {}) => ({ kind: 'client', userId: USERS[jwt].id, email: USERS[jwt].email, jwt, requestId: 't', ...extra });

const ACC = await import('../../supabase/functions/presence/commerce/account.ts');
const CR = await import('../../supabase/functions/presence/lib/connect_requests.ts');
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const R = await import('../../supabase/functions/presence/routes/connect_requests.ts');
const CRM = await import('../../supabase/functions/presence/routes/crm.ts');
const AGR = await import('../../supabase/functions/presence/agency/routes.ts');

// ═══ the email check and the account lookup ═══
world();
ok('a crafted "either/or" email is not an email', !ACC.validEmail('x@y.co,id.not.is.null') && !ACC.validEmail('x@y.co)') && !ACC.validEmail('"x"@y.com'));
ok('real addresses still are', ACC.validEmail('sam@harbor.test') && ACC.validEmail("o'brien+news@mail.co.uk") && ACC.validEmail('x@xn--mnchen-3ya.de'));
ok('the crafted email finds no account and never reaches the database', (await ACC.findClientByEmail('x@y.co,id.not.is.null')) === null && read('/rest/v1/clients').length === 0);
{ const c = await ACC.findClientByEmail('SAM@harbor.test'); ok('a real email finds its own account', c && c.id === CUST_CLIENT); }
ok('the lookup quotes the value inside the either/or', read('/rest/v1/clients?or=(email.eq."sam@harbor.test"').length === 1);

// ═══ the studio-to-site control link ═══
world();
ok('a site another studio manages is never taken', (await CR.claimPortfolioSite(AG1, M_SITE, 'owner@studio.test')) === 'owned_elsewhere' && T.presence_agency_clients.find((r) => r.site_id === M_SITE).agency_id === AG2);
ok('…and the write asked to ignore a clash, never to merge it', wrote('presence_agency_clients').every((c) => !JSON.stringify(c).includes('merge-duplicates')));
ok('a free site is linked', (await CR.claimPortfolioSite(AG1, CUST_SITE, 'owner@studio.test')) === 'linked');
ok('linking again says it is already yours', (await CR.claimPortfolioSite(AG1, CUST_SITE, 'owner@studio.test')) === 'already');
T.presence_agency_clients.find((r) => r.site_id === CUST_SITE).status = 'archived';
ok('your own archived site comes back when asked', (await CR.claimPortfolioSite(AG1, CUST_SITE, 'x', { reactivate: true })) === 'already' && T.presence_agency_clients.find((r) => r.site_id === CUST_SITE).status === 'active');
world();
ok('a customer is yours when their one studio is you', await CR.isCustomerOfStudio(STUDIO_SITE, MINE_CLIENT));
ok('…not when it is another studio, or nobody', !(await CR.isCustomerOfStudio(STUDIO_SITE, M_CLIENT)) && !(await CR.isCustomerOfStudio(STUDIO_SITE, CUST_CLIENT)));

// ═══ add a customer: connect / set up now ═══
const NOT_TAKEN = (n) => { ok(`${n}: nothing linked, bridged or provisioned`, ['presence_agency_clients', 'presence_service_links', 'presence_customer_agency', 'presence_projects', 'presence_entitlements'].every((t) => wrote(t).length === 0) && wrote('presence_sites').length === 0, JSON.stringify(log.filter((c) => c.method !== 'GET').map((c) => c.method + ' ' + c.url.split('?')[0]))); };
world();
{
  const r = await res(await S.handleSalesAddCustomer(req('POST', '/sales/customers', { mode: 'connect', email: 'sam@harbor.test', name: 'Sam' }), site(STUDIO_SITE), studio(), cors));
  ok('connect, someone else\'s account: a request, not a takeover', r.status === 200 && r.body?.data?.requested === true && r.body?.data?.connected === false);
  NOT_TAKEN('connect');
  const q = T.presence_connect_requests[0];
  ok('the request names the studio, its agency and the email, and waits', T.presence_connect_requests.length === 1 && q.studio_site_id === STUDIO_SITE && q.agency_id === AG1 && q.email === 'sam@harbor.test' && q.status === 'pending');
}
world();
{
  const r = await res(await S.handleSalesAddCustomer(req('POST', '/sales/customers', { mode: 'provision', email: 'dana@willow.test', business_name: 'Willow' }), site(STUDIO_SITE), studio(), cors));
  ok('set up now, an account another studio manages: asked, and no ids handed back', r.status === 200 && r.body?.data?.requested === true && r.body?.data?.already_exists === true && !r.body?.data?.client_id && !r.body?.data?.site_id);
  NOT_TAKEN('set up now');
  ok('the other studio still manages it', T.presence_agency_clients.find((x) => x.site_id === M_SITE).agency_id === AG2);
}
world();
{
  const r = await res(await S.handleSalesAddCustomer(req('POST', '/sales/customers', { mode: 'connect', email: 'lee@maple.test' }), site(STUDIO_SITE), studio(), cors));
  ok('connect, your own customer: connected as before, no request', r.status === 200 && r.body?.data?.connected === true && T.presence_connect_requests.length === 0);
}
world();
ok('a crafted email is refused before anything is read', (await res(await S.handleSalesAddCustomer(req('POST', '/sales/customers', { mode: 'connect', email: 'x@y.co,id.not.is.null' }), site(STUDIO_SITE), studio(), cors))).status === 422 && read('/rest/v1/clients').length === 0);
world(); failTables.add('presence_connect_requests');
ok('before the database update lands, asking says so (503) and takes nothing', (await res(await S.handleSalesAddCustomer(req('POST', '/sales/customers', { mode: 'connect', email: 'sam@harbor.test' }), site(STUDIO_SITE), studio(), cors))).status === 503 && wrote('presence_agency_clients').length === 0);

// ═══ convert a won deal whose email is someone else's account ═══
world();
{
  const r = await res(await S.handleSalesConvert(req('POST', `/sales/deals/${D_M}/convert`, { plan: 'presence' }), site(STUDIO_SITE), studio(), D_M, cors));
  const d = T.presence_deals.find((x) => x.id === D_M);
  ok('convert: 409 needs_acceptance with a message the deal page shows whole', r.status === 409 && r.body?.error === 'needs_acceptance' && String(r.body?.message || '').length < 160);
  ok('convert: the deal is released, not stamped', d.converted_at === null && d.converted_client_id === null);
  NOT_TAKEN('convert');
  ok('convert: the request is waiting', T.presence_connect_requests.some((q) => q.email === 'dana@willow.test' && q.status === 'pending'));
}

// ═══ the owner answers ═══
world();
await S.handleSalesAddCustomer(req('POST', '/sales/customers', { mode: 'connect', email: 'sam@harbor.test' }), site(STUDIO_SITE), studio(), cors);
{
  const list = await R.studioRequestsFor(site(CUST_SITE), ownerOf('jwt-cust'));
  ok('the owner sees the request with the studio\'s name', list.length === 1 && list[0].studio === 'Test Studio');
  ok('a team seat sees none', (await R.studioRequestsFor(site(CUST_SITE), ownerOf('jwt-cust', { member: { site_id: CUST_SITE, role: 'developer' } }))).length === 0);
  const id = list[0].id;
  const seat = await res(await R.handleStudioRequests(req('POST', `/portal/studio-requests/${id}/accept`), `/portal/studio-requests/${id}/accept`, site(CUST_SITE), ownerOf('jwt-cust', { member: { site_id: CUST_SITE, role: 'developer' } }), cors));
  ok('a team seat can\'t accept (403) and nothing is linked', seat.status === 403 && wrote('presence_agency_clients').length === 0);
  const wrongSite = await res(await R.handleStudioRequests(req('POST', `/portal/studio-requests/${id}/accept`), `/portal/studio-requests/${id}/accept`, site(M_SITE), ownerOf('jwt-m'), cors));
  ok('someone the request wasn\'t sent to can\'t accept it', wrongSite.status === 404);
  const a = await res(await R.handleStudioRequests(req('POST', `/portal/studio-requests/${id}/accept`), `/portal/studio-requests/${id}/accept`, site(CUST_SITE), ownerOf('jwt-cust'), cors));
  ok('accept: 200', a.status === 200 && a.body?.data?.accepted === true, JSON.stringify(a.body));
  ok('accept: the studio may now work on the site', T.presence_agency_clients.some((x) => x.site_id === CUST_SITE && x.agency_id === AG1));
  ok('accept: they are the studio\'s customer', T.presence_customer_agency.some((x) => x.customer_client_id === CUST_CLIENT && x.agency_site_id === STUDIO_SITE) && T.presence_service_links.some((l) => l.customer_client_id === CUST_CLIENT && l.agency_site_id === STUDIO_SITE));
  ok('accept: the request is answered and the studio is told', T.presence_connect_requests[0].status === 'accepted' && T.presence_change_events.some((e) => e.site_id === STUDIO_SITE));
}
world();
await S.handleSalesAddCustomer(req('POST', '/sales/customers', { mode: 'connect', email: 'dana@willow.test' }), site(STUDIO_SITE), studio(), cors);
{
  const id = T.presence_connect_requests[0].id;
  const a = await res(await R.handleStudioRequests(req('POST', `/portal/studio-requests/${id}/accept`), `/portal/studio-requests/${id}/accept`, site(M_SITE), ownerOf('jwt-m'), cors));
  ok('accept while another studio manages the site: refused with the reason', a.status === 409 && a.body?.error === 'owned_elsewhere');
  ok('…and nothing moved', T.presence_agency_clients.find((x) => x.site_id === M_SITE).agency_id === AG2 && !T.presence_service_links.some((l) => l.customer_client_id === M_CLIENT && l.agency_site_id === STUDIO_SITE));
  T.presence_agency_clients = [];   // the other studio no longer manages the site, but they are still its customer
  const b = await res(await R.handleStudioRequests(req('POST', `/portal/studio-requests/${id}/accept`), `/portal/studio-requests/${id}/accept`, site(M_SITE), ownerOf('jwt-m'), cors));
  ok('accept while already another studio\'s customer: refused, and the claim it made is undone', b.status === 409 && T.presence_agency_clients.length === 0);
  const d = await res(await R.handleStudioRequests(req('POST', `/portal/studio-requests/${id}/decline`), `/portal/studio-requests/${id}/decline`, site(M_SITE), ownerOf('jwt-m'), cors));
  ok('decline: answered, nothing linked', d.status === 200 && T.presence_connect_requests[0].status === 'declined' && T.presence_agency_clients.length === 0);
}

// ═══ the agency "add a site" route ═══
world();
const MEMBER = { agency_id: AG1, member_id: 'm1', email: 'owner@studio.test', role: 'owner', agency_name: 'Test Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} };
const agencyReq = (b) => new Request('https://fn.test/functions/v1/presence/agency/clients', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': 'jwt-studio' }, body: JSON.stringify(b) });
{
  const r = await res(await AGR.handleAgency(agencyReq({ site_id: M_SITE }), '/agency/clients', 'POST', MEMBER, studio(), cors));
  ok('add a site you have no relationship with: refused', r.status === 409 && r.body?.error === 'not_your_customer');
  ok('…and the other studio keeps it', T.presence_agency_clients.find((x) => x.site_id === M_SITE).agency_id === AG2 && wrote('presence_agency_clients').length === 0);
  const r2 = await res(await AGR.handleAgency(agencyReq({ site_id: CUST_SITE }), '/agency/clients', 'POST', MEMBER, studio(), cors));
  ok('a stranger\'s site (no studio at all): refused too', r2.status === 409 && !T.presence_agency_clients.some((x) => x.site_id === CUST_SITE));
  const r3 = await res(await AGR.handleAgency(agencyReq({ site_id: MINE_SITE }), '/agency/clients', 'POST', MEMBER, studio(), cors));
  ok('your own customer\'s site: added', r3.status === 200 && T.presence_agency_clients.some((x) => x.site_id === MINE_SITE && x.agency_id === AG1));
}

// ═══ templates can't be settings rows ═══
world();
{
  const r = await res(await S.handleSalesTemplates(req('POST', '/sales/templates', { kind: 'proposal', name: '__calendar_feed__', line_items: [], body: '{"token":"' + 'a'.repeat(40) + '"}' }), site(STUDIO_SITE), studio(), cors));
  ok('a template named like a settings row is refused, nothing written', r.status === 422 && r.body?.error === 'reserved_name' && T.presence_sales_templates.length === 0);
  T.presence_sales_templates.push({ id: '0ddddddd-0000-4000-8000-000000000001', site_id: STUDIO_SITE, kind: 'proposal', name: '__stage_names__', body: '{}', deleted_at: null });
  const d = await res(await S.handleSalesTemplateDelete(site(STUDIO_SITE), '0ddddddd-0000-4000-8000-000000000001', cors));
  ok('…and a settings row can\'t be removed as a template', d.status === 422 && T.presence_sales_templates[0].deleted_at === null);
  const n = await res(await S.handleSalesTemplates(req('POST', '/sales/templates', { kind: 'proposal', name: 'Monthly care', line_items: [{ label: 'Care', qty: 1, unit_cents: 10000 }] }), site(STUDIO_SITE), studio(), cors));
  ok('an ordinary template still saves', n.status === 201);
}

// ═══ the record ═══
world();
const recordOf = async (q, s = site(STUDIO_SITE), p = studio()) => res(await CRM.handleCrmRecord(req('GET', `/crm/record?${q}`), 'jwt-studio', s, p, cors));
{
  const r = await recordOf(`deal=${D_MINE}`);
  ok('F1: from a deal, the record is the customer — not your own studio', r.status === 200 && r.body?.data?.canonical?.key === 'client' && r.body?.data?.canonical?.value === MINE_SITE && r.body?.data?.identity?.client_id === MINE_CLIENT, JSON.stringify(r.body?.data?.canonical));
  ok('F1: …and its header is theirs', r.body?.data?.header?.name !== 'Test Studio' && /Maple|Lee/.test(String(r.body?.data?.header?.name)));
  const c = await recordOf(`contact=${C_MINE}`);
  ok('F1: from a contact, the same', c.body?.data?.canonical?.value === MINE_SITE);
}
world();
{
  const r = await recordOf(`project=${P_OTHER}`);
  ok('S3: another studio\'s project id is ignored', r.status === 200 && !r.body?.data?.identity?.project_id && !r.body?.data?.identity?.client_id);
  ok('S3: …and nothing on that studio\'s site is read', !log.some((c) => c.url.includes(`site_id=eq.${OTHER_SITE}`)) && read(`clients?id=eq.${M_CLIENT}`).length === 0);
  const q = await recordOf(`client_id=${M_CLIENT}`);
  ok('S3: a customer id that isn\'t yours names nobody', q.status === 200 && !q.body?.data?.identity?.client_id && read(`clients?id=eq.${M_CLIENT}`).length === 0);
  const a = await res(await CRM.handleCrmActivity(req('GET', `/crm/activity?project=${P_OTHER}`), 'jwt-studio', site(STUDIO_SITE), studio(), cors));
  ok('S3: the timeline doesn\'t follow it either — no reads or writes there', a.status === 200 && !log.some((c) => c.url.includes(`site_id=eq.${OTHER_SITE}`)) && wrote('presence_support_requests').length === 0);
}
world();
T.presence_service_links.push({ project_id: '0eeeeeee-0000-4000-8000-000000000001', agency_site_id: OTHER_SITE, customer_client_id: MINE_CLIENT, customer_site_id: MINE_SITE, status: 'active', created_at: '2026-09-01T00:00:00Z' });
{
  const r = await recordOf('', site(MINE_SITE), studio({ scope: { site_id: MINE_SITE, name: 'Maple Street Studio' } }));
  ok('scoped into a customer: their record, on your studio\'s site only', r.status === 200 && r.body?.data?.identity?.client_id === MINE_CLIENT && r.body?.data?.identity?.project_id === P_MINE);
  ok('scoped: a link from another studio to the same customer is never followed', !log.some((c) => c.url.includes(`site_id=eq.${OTHER_SITE}`)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
