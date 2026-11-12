// ── What /commerce answers while a studio works on a client's site (SC-1) ────
// /commerce is dispatched before the client gate so a stranger can sign up. That
// left the signed-in routes answering for the CALLER while the pages asked in the
// CLIENT's context (?client= → x-dds-scope-site). Inside a client's view a studio
// got its own notices, Dismiss changed its own rows, the portal opened its own
// Stripe customer, a deletion request filed against its own account, and Done on a
// client's row from Today or the bell got a 404.
//
// This suite drives the REAL function: index.ts, every gate, the real handlers and
// resolveScopedSite, against a stubbed PostgREST and a stubbed Stripe. std's serve()
// is handed a fake listener, so no socket opens and no credentials exist here.
//   · scoped: Done and Clear reach the client's row; every other route refuses
//   · denied: nothing is read or written, and it never falls back to the caller's site
//   · un-scoped: the same routes answer exactly as before, with no audit row
//
//   deno run --allow-read --allow-env tests/presence/scoped_commerce_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'SERVICE-KEY');
Deno.env.set('SUPABASE_ANON_KEY', 'ANON-KEY');
Deno.env.set('STRIPE_SECRET', 'sk_test_stub');
Deno.env.delete('RESEND_API_KEY');
Deno.env.delete('OPS_ALERT_EMAIL');

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE_STUDIO = uuid('5');   // the studio's own workspace, the wrong answer in a client's context
const SITE_A = uuid('a');        // the studio's client
const SITE_B = uuid('b');        // another studio's client
const SITE_ARCHIVED = uuid('c'); // this studio's client, archived
const SITE_PAUSED = uuid('8');   // this studio's client, subscription paused
const SITE_GONE = uuid('7');     // this studio's client, subscription deleted
const SITE_OWNED_RO = uuid('6'), SITE_OWNED_OTHER = uuid('4'), SITE_OWNED_PAUSED_AGENCY = uuid('3');
const AGENCY = uuid('d'), OTHER_AGENCY = uuid('e'), PAUSED_AGENCY = uuid('f');
const NOBODY = uuid('2');

/* `owns` is what my_presence_site_ids() returns for this JWT */
const USERS = {
  'jwt-studio': { id: uuid('1'), email: 'owner@studio.example', owns: [SITE_STUDIO] },
  'jwt-staff': { id: uuid('0'), email: 'staff@studio.example', owns: [] },
  'jwt-owner-a': { id: 'ffffffff-0000-4000-8000-00000000000a', email: 'owner-a@example.com', owns: [SITE_A] },
  'jwt-owner-b': { id: 'ffffffff-0000-4000-8000-00000000000b', email: 'owner-b@example.com', owns: [SITE_B] },
  'jwt-readonly': { id: 'ffffffff-0000-4000-8000-00000000000c', email: 'readonly@studio.example', owns: [SITE_OWNED_RO] },
  'jwt-reviewer': { id: 'ffffffff-0000-4000-8000-00000000000d', email: 'reviewer@studio.example', owns: [] },
  'jwt-other-studio': { id: 'ffffffff-0000-4000-8000-00000000000e', email: 'owner@other.example', owns: [SITE_OWNED_OTHER] },
  'jwt-paused-agency': { id: 'ffffffff-0000-4000-8000-00000000000f', email: 'owner@paused.example', owns: [SITE_OWNED_PAUSED_AGENCY] },
};
const siteRow = (id, client_id, extra = {}) => ({ id, client_id, status: 'draft', last_published_at: null, template_slug: 'restaurant-classic', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence', ...extra });
const notice = (id, site_id, client_id, kind, headline, created_at, period = '2026-11') => ({ id, site_id, client_id, kind, period, headline, body: `${headline} body`, status: 'active', created_at });
const when = (minute) => `2026-11-05T10:${String(minute).padStart(2, '0')}:00Z`;
const nid = (n) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`;
const N = {
  // the studio's own rows: never the answer, never touched, in a client's context
  STUDIO_PAY: nid(1), STUDIO_DOMAIN: nid(2), STUDIO_CAP: nid(3),
  // the client's site-level rows: the studio works on these
  A_DOMAIN: nid(10), A_LEAD: nid(11), A_FAILED: nid(12), A_INVOICE: nid(13), A_CHAT: nid(14),
  // the client's own account rows: for the owner
  A_PAY: nid(20), A_TRIAL: nid(21), A_CAP: nid(22), A_RENEW: nid(23), A_LAPSED: nid(24), A_DELETING: nid(25),
  B_DOMAIN: nid(30),
};

/* ── a tiny PostgREST: top-level filters AND, RLS for a JWT, none for the service role ── */
let T, calls, stripeCalls;
function reset() {
  T = {
    presence_sites: [
      siteRow(SITE_STUDIO, 'client-studio'),
      siteRow(SITE_A, 'client-a', { custom_domain: 'alpha.example', last_published_at: '2026-10-01T00:00:00Z' }),
      siteRow(SITE_B, 'client-b'),
      siteRow(SITE_ARCHIVED, 'client-archived'),
      siteRow(SITE_PAUSED, 'client-paused'),
      siteRow(SITE_GONE, 'client-gone'),
      siteRow(SITE_OWNED_RO, 'client-ro'),
      siteRow(SITE_OWNED_OTHER, 'client-other'),
      siteRow(SITE_OWNED_PAUSED_AGENCY, 'client-paused-agency'),
    ],
    presence_identity: [
      { site_id: SITE_A, business_name: 'Alpha Cafe', phone: '555-0100', email: '', description: '' },
      { site_id: SITE_STUDIO, business_name: 'Bright Studio', phone: '', email: '', description: '' },
    ],
    presence_brand_profile: [],
    presence_first_run: [
      { site_id: SITE_STUDIO, dismissed: false, welcomed_at: when(1) },
      { site_id: SITE_A, dismissed: false, welcomed_at: when(2) },
    ],
    presence_plan_notices: [
      notice(N.STUDIO_PAY, SITE_STUDIO, 'client-studio', 'payment_trouble', 'STUDIO card failed', when(50)),
      notice(N.STUDIO_DOMAIN, SITE_STUDIO, 'client-studio', 'domain_expiry', 'STUDIO domain expiring', when(49)),
      notice(N.STUDIO_CAP, SITE_STUDIO, 'client-studio', 'capacity', 'STUDIO outgrew its plan', when(48)),
      notice(N.A_PAY, SITE_A, 'client-a', 'payment_trouble', 'ALPHA card failed', when(45)),
      notice(N.A_TRIAL, SITE_A, 'client-a', 'trial_ending', 'ALPHA trial ending', when(44)),
      notice(N.A_CAP, SITE_A, 'client-a', 'capacity', 'ALPHA outgrew its plan', when(43)),
      notice(N.A_RENEW, SITE_A, 'client-a', 'renewal_reminder', 'ALPHA renews soon', when(42)),
      notice(N.A_LAPSED, SITE_A, 'client-a', 'account_lapsed', 'ALPHA account lapsed', when(41)),
      notice(N.A_DELETING, SITE_A, 'client-a', 'deletion_requested', 'ALPHA deletion requested', when(40)),
      notice(N.A_CHAT, SITE_A, 'client-a', 'client_message', 'ALPHA client wrote in', when(39)),
      notice(N.A_DOMAIN, SITE_A, 'client-a', 'domain_expiry', 'ALPHA domain expiring', when(30)),
      notice(N.A_LEAD, SITE_A, 'client-a', 'lead_followup', 'ALPHA lead waiting', when(29)),
      notice(N.A_FAILED, SITE_A, 'client-a', 'publish_failed', 'ALPHA publish failed', when(28)),
      notice(N.A_INVOICE, SITE_A, 'client-a', 'deal_followup', 'ALPHA invoice unpaid', when(27), 'invremind:inv-1'),
      notice(N.B_DOMAIN, SITE_B, 'client-b', 'domain_expiry', 'BRAVO domain expiring', when(26)),
    ],
    presence_entitlements: [
      ...[['client-studio', 'cus_studio'], ['client-a', 'cus_alpha'], ['client-b', 'cus_bravo'], ['client-ro', 'cus_ro'], ['client-other', 'cus_other'], ['client-paused-agency', 'cus_pa']]
        .map(([client_id, stripe_customer_id]) => ({ client_id, product: 'presence', plan: 'presence', status: 'active', term: 'monthly', founder: false, stripe_customer_id, stripe_subscription_id: `sub_${client_id}`, current_period_end: '2026-12-01T00:00:00Z', cancel_at_period_end: false, grace_until: null, trial_ends_at: null })),
      { client_id: 'client-paused', product: 'presence', plan: 'presence', status: 'paused', stripe_customer_id: 'cus_paused' },
      { client_id: 'client-gone', product: 'presence', plan: 'presence', status: 'deleted', stripe_customer_id: 'cus_gone' },
    ],
    presence_account_deletions: [],
    presence_contacts: [{ id: 'ex-contact', site_id: SITE_STUDIO, email: 'jo@marlows-kitchen.example', deleted_at: null }, { id: 'ex-contact-a', site_id: SITE_A, email: 'jo@marlows-kitchen.example', deleted_at: null }],
    presence_deals: [],
    presence_form_submissions: [],
    presence_scoped_access_events: [],
    presence_agencies: [
      { id: AGENCY, status: 'active', name: 'Bright Studio', seat_limit: 5, client_limit: 50, plan: 'studio', branding: {} },
      { id: OTHER_AGENCY, status: 'active', name: 'Other Studio', seat_limit: 5, client_limit: 50, plan: 'studio', branding: {} },
      { id: PAUSED_AGENCY, status: 'paused', name: 'Paused Studio', seat_limit: 5, client_limit: 50, plan: 'studio', branding: {} },
    ],
    presence_agency_members: [
      ['jwt-studio', AGENCY, 'owner'], ['jwt-staff', AGENCY, 'owner'], ['jwt-readonly', AGENCY, 'readonly'], ['jwt-reviewer', AGENCY, 'account_manager'],
      ['jwt-other-studio', OTHER_AGENCY, 'owner'], ['jwt-paused-agency', PAUSED_AGENCY, 'owner'],
    ].map(([jwt, agency_id, role]) => ({ id: USERS[jwt].id, agency_id, user_id: USERS[jwt].id, email: USERS[jwt].email, role, status: 'active' })),
    presence_agency_clients: [
      { agency_id: AGENCY, site_id: SITE_A, status: 'active' },
      { agency_id: AGENCY, site_id: SITE_PAUSED, status: 'active' },
      { agency_id: AGENCY, site_id: SITE_GONE, status: 'active' },
      { agency_id: AGENCY, site_id: SITE_ARCHIVED, status: 'archived' },
      { agency_id: OTHER_AGENCY, site_id: SITE_B, status: 'active' },
      { agency_id: PAUSED_AGENCY, site_id: SITE_A, status: 'active' },
    ],
    presence_site_members: [{ id: uuid('9'), site_id: SITE_A, user_id: USERS['jwt-reviewer'].id, email: USERS['jwt-reviewer'].email, role: 'client_reviewer', status: 'active' }],
    memberships: [{ user_id: USERS['jwt-staff'].id, tenant_id: 'tenant-1', role: 'owner' }],
    clients: Object.entries(USERS).filter(([jwt]) => jwt !== 'jwt-staff' && jwt !== 'jwt-reviewer').map(([, u]) => ({ id: `row-${u.id}`, email: u.email, tenant_id: 'tenant-1', name: 'Account' })),
    contacts: [],
    invoices: [],
    presence_ai_usage: [],
  };
  calls = [];
  stripeCalls = [];
}

function listOf(v) { return v.slice(v.indexOf('(') + 1, -1).split(',').map((s) => s.replace(/^"|"$/g, '')); }
function matches(row, params) {
  for (const [k, v] of params.entries()) {
    if (['select', 'limit', 'order', 'on_conflict', 'offset'].includes(k)) continue;
    if (k === 'or') {
      const parts = v.slice(1, -1).split(',');
      if (parts.every((p) => /^\w+\.eq\./.test(p)) && !parts.some((p) => { const [c, , ...val] = p.split('.'); return String(row[c]) === val.join('.'); })) return false;
      continue;
    }
    if (k.includes('->')) continue;
    if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false;
    if (v.startsWith('in.') && !listOf(v).includes(String(row[k]))) return false;
    if (v.startsWith('not.in.') && listOf(v).includes(String(row[k]))) return false;
    if (v === 'is.null' && row[k] != null) return false;
  }
  return true;
}

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const headers = new Headers(init.headers);
  const reply = (body, status = 200) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.hostname === 'api.stripe.com') {
    const form = new URLSearchParams(String(init.body || ''));
    stripeCalls.push({ path: u.pathname, customer: form.get('customer'), return_url: form.get('return_url') });
    return reply({ id: 'bps_1', url: `https://billing.stripe.test/${form.get('customer')}` });
  }
  const token = (headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (u.pathname === '/auth/v1/user') return USERS[token] ? reply(USERS[token]) : reply({}, 401);
  if (!u.pathname.startsWith('/rest/v1/')) return new Response('', { status: 404 });

  const table = u.pathname.replace('/rest/v1/', '');
  const method = (init.method || 'GET').toUpperCase();
  const role = token === 'SERVICE-KEY' ? 'service' : 'user';
  const owned = USERS[token]?.owns ?? [];
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ table, method, query: decodeURIComponent(u.search), role, token, apikey: headers.get('apikey'), body });
  const visible = (r) => role === 'service' || owned.includes(table === 'presence_sites' ? r.id : r.site_id);
  const filtered = () => (T[table] ||= []).filter((r) => visible(r) && matches(r, u.searchParams));

  if (method === 'GET') {
    let rows = filtered();
    if ((u.searchParams.get('order') || '').startsWith('created_at.desc')) rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const limit = Number(u.searchParams.get('limit'));
    return reply(limit ? rows.slice(0, limit) : rows);
  }
  if (method === 'PATCH') {
    // RLS: a JWT may read these tables, never write them
    if (role === 'user') return reply({ code: '42501', message: 'permission denied' }, 403);
    const hit = filtered(); hit.forEach((r) => Object.assign(r, body)); return reply(hit);
  }
  if (method === 'DELETE') { if (role === 'service') T[table] = (T[table] ||= []).filter((r) => !matches(r, u.searchParams)); return reply([]); }
  if (method === 'POST') {
    if (role === 'user') return reply({ code: '42501', message: 'new row violates row-level security policy' }, 403);
    const conflict = u.searchParams.get('on_conflict');
    const prefer = headers.get('Prefer') || '';
    let row = conflict && prefer.includes('merge-duplicates') ? (T[table] ||= []).find((r) => conflict.split(',').every((c) => r[c] === body[c])) : null;
    if (row) Object.assign(row, body);
    else { row = { id: crypto.randomUUID(), ...body }; (T[table] ||= []).push(row); }
    return prefer.includes('return=representation') ? reply([row], 201) : reply(null, 201);
  }
  return reply([]);
};

/* ── the real index.ts, with std's serve() handed a fake listener: no socket opens ── */
const queue = []; let wake = null;
Deno.listen = () => {
  let first = true;
  return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} };
};
Deno.serveHttp = () => ({ nextRequest: () => new Promise((res) => { if (queue.length) res(queue.shift()); else wake = res; }), close() {} });
await import('../../supabase/functions/presence/index.ts');
// builder item 191: closing the account asks for a fresh code; these people signed in with their
// authenticator app's code a moment ago, so it counts (lib/fresh_code.ts)
{
  const { freshDeps } = await import('../../supabase/functions/presence/lib/fresh_code.ts');
  freshDeps.user = async (jwt) => (USERS[jwt] ? { id: USERS[jwt].id, email: USERS[jwt].email, factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] } : null);
  freshDeps.claims = () => ({ aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] });
}

function send(request) {
  return new Promise((resolve) => {
    const ev = { request, respondWith: async (r) => { resolve(await r); } };
    if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev);
  });
}
async function call(jwt, method, route, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (jwt) headers['x-dds-user-jwt'] = jwt;
  if (opts.scope !== undefined) headers['x-dds-scope-site'] = opts.scope;
  const res = await send(new Request(`http://stub.local/functions/v1/presence${route}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: res.status, body, text };
}

const noticeRow = (id) => T.presence_plan_notices.find((n) => n.id === id);
const statusOf = (id) => noticeRow(id).status;
const headlines = (r) => (r.body?.data?.notices || []).map((n) => n.headline);
const audit = () => T.presence_scoped_access_events;
const everythingButAudit = () => JSON.stringify(Object.fromEntries(Object.entries(T).filter(([t]) => t !== 'presence_scoped_access_events')));
const CONTENT_TABLES = ['presence_plan_notices', 'presence_first_run', 'presence_identity', 'presence_brand_profile'];
const contentCalls = () => calls.filter((c) => CONTENT_TABLES.includes(c.table));
// resolveScopedSite reads the client's name for the audit row: the gate's read, not the route's
const routeReads = () => contentCalls().filter((c) => !(c.table === 'presence_identity' && c.query.endsWith('select=business_name&limit=1')));
const writes = () => calls.filter((c) => c.method !== 'GET' && c.table !== 'presence_scoped_access_events');
const pinnedTo = (c, site) => c.role === 'service' && (c.query.includes(`site_id=eq.${site}`) || c.body?.site_id === site);

const ALL_SIGNED_IN = [
  ['GET', '/commerce/subscription'], ['POST', '/commerce/portal', {}], ['GET', '/commerce/notices'], ['POST', '/commerce/notices/dismiss', { id: N.STUDIO_DOMAIN }],
  ['GET', '/commerce/first-run'], ['POST', '/commerce/first-run/dismiss'], ['GET', '/commerce/example-data'], ['POST', '/commerce/example-data/remove', {}],
  ['POST', '/commerce/delete-request', {}], ['POST', '/commerce/delete-cancel', {}],
];
const OWNER_ONLY = ALL_SIGNED_IN.filter(([, r]) => r !== '/commerce/notices/dismiss');

// ═══ 1. scoped dismiss: only the client's own rows, and only the ones a studio may clear ═══
{
  reset();
  const r = await call('jwt-studio', 'POST', '/commerce/notices/dismiss', { scope: SITE_A, body: { id: N.A_DOMAIN } });
  ok('scoped dismiss: Done on a row the feed showed reaches the client\'s row (it used to 404)', r.status === 200 && r.body?.data?.dismissed === true && statusOf(N.A_DOMAIN) === 'dismissed', `${r.status} ${statusOf(N.A_DOMAIN)}`);
  ok('scoped dismiss: nothing else changes', T.presence_plan_notices.filter((n) => n.status === 'dismissed').length === 1);
  ok('scoped dismiss: the write is pinned to the client', writes().length === 1 && writes()[0].table === 'presence_plan_notices' && pinnedTo(writes()[0], SITE_A), JSON.stringify(writes()));
  ok('scoped dismiss: the read before it is pinned too', routeReads().length === 2 && routeReads().every((c) => pinnedTo(c, SITE_A)), JSON.stringify(routeReads().map((c) => c.query)));
  ok('scoped dismiss: the access is recorded once, as allowed', audit().length === 1 && audit()[0].outcome === 'allowed' && audit()[0].client_site_id === SITE_A && audit()[0].route === '/commerce/notices/dismiss' && audit()[0].operator_email === 'owner@studio.example');
  reset();
  const staffDone = await call('jwt-staff', 'POST', '/commerce/notices/dismiss', { scope: SITE_A, body: { id: N.A_DOMAIN } });
  ok('scoped dismiss: platform staff holding the seat get the same answer', staffDone.status === 200 && statusOf(N.A_DOMAIN) === 'dismissed', staffDone.text.slice(0, 120));

  for (const [label, id, status] of [
    ['the studio\'s own row (this used to dismiss it, inside the client\'s view)', N.STUDIO_DOMAIN, 404],
    ['another tenant\'s row', N.B_DOMAIN, 404],
    ['the client\'s card-failed notice', N.A_PAY, 409],
    ['the client\'s trial notice', N.A_TRIAL, 409],
    ['the client\'s plan notice', N.A_CAP, 409],
    ['the client\'s renewal notice', N.A_RENEW, 409],
    ['the client\'s lapsed notice', N.A_LAPSED, 409],
    ['the client\'s deletion notice', N.A_DELETING, 409],
    ['a failed publish (protected for the owner too)', N.A_FAILED, 409],
    ['an unpaid-invoice reminder (protected for the owner too)', N.A_INVOICE, 409],
  ]) {
    reset();
    const before = everythingButAudit();
    const x = await call('jwt-studio', 'POST', '/commerce/notices/dismiss', { scope: SITE_A, body: { id } });
    ok(`scoped dismiss: ${label} → ${status}, nothing changes`, x.status === status && everythingButAudit() === before, `${x.status} ${x.text.slice(0, 120)}`);
  }
  reset();
  const before = everythingButAudit();
  const noId = await call('jwt-studio', 'POST', '/commerce/notices/dismiss', { scope: SITE_A, body: {} });
  ok('scoped dismiss: no id → refused, the legacy "clear the capacity card" is for the owner', noId.status === 422 && everythingButAudit() === before, `${noId.status} ${statusOf(N.A_CAP)} ${statusOf(N.STUDIO_CAP)}`);
  reset();
  const weird = await call('jwt-studio', 'POST', '/commerce/notices/dismiss', { scope: SITE_A, body: { id: `${N.STUDIO_DOMAIN}&site_id=eq.${SITE_STUDIO}` } });
  ok('scoped dismiss: an id can\'t smuggle a filter', weird.status === 404 && statusOf(N.STUDIO_DOMAIN) === 'active', String(weird.status));
}

// ═══ 2. every other signed-in route refuses, with nothing of anyone's in the answer ═══
for (const [method, route, body] of OWNER_ONLY) {
  reset();
  const before = everythingButAudit();
  const r = await call('jwt-studio', method, route, { scope: SITE_A, body });
  ok(`scoped ${method} ${route}: refused as owner_only`, r.status === 403 && r.body?.error === 'owner_only', `${r.status} ${r.text.slice(0, 160)}`);
  ok(`scoped ${method} ${route}: changes nothing and opens nothing`, everythingButAudit() === before && stripeCalls.length === 0 && writes().length === 0 && routeReads().length === 0, `stripe:${stripeCalls.length} writes:${writes().length} reads:${routeReads().length}`);
  ok(`scoped ${method} ${route}: answers with no account detail`, !/cus_|billing\.stripe|"plan"|"status"|"steps"|"notices"|"present"|scheduled_for|STUDIO|ALPHA/.test(r.text), r.text.slice(0, 160));
}
{
  reset();
  const staff = await call('jwt-staff', 'POST', '/commerce/portal', { scope: SITE_A, body: {} });
  ok('scoped portal: platform staff holding the seat are refused too', staff.status === 403 && staff.body?.error === 'owner_only' && stripeCalls.length === 0, `${staff.status}`);
  reset();
  const paused = await call('jwt-studio', 'POST', '/commerce/portal', { scope: SITE_PAUSED, body: {} });
  ok('scoped portal: a paused client is no way in', paused.status === 403 && stripeCalls.length === 0, `${paused.status} ${paused.text.slice(0, 100)}`);
  reset();
  const dismissed = await call('jwt-studio', 'POST', '/commerce/first-run/dismiss', { scope: SITE_A });
  ok('scoped first-run dismiss: neither site\'s row moves', dismissed.status === 403 && T.presence_first_run.every((f) => f.dismissed === false));
}

// ═══ 3. scoped requests meet the same gates as every other scoped request ═══
{
  reset();
  const rev = await call('jwt-reviewer', 'POST', '/commerce/notices/dismiss', { scope: SITE_A, body: { id: N.A_DOMAIN } });
  ok('gates: a client_reviewer seat is stopped at the reviewer boundary', rev.status === 403 && rev.body?.error === 'forbidden' && statusOf(N.A_DOMAIN) === 'active', `${rev.status} ${rev.text.slice(0, 120)}`);
  reset();
  T.presence_plan_notices.push(notice(nid(40), SITE_PAUSED, 'client-paused', 'domain_expiry', 'PAUSED domain expiring', when(5)));
  const write1 = await call('jwt-studio', 'POST', '/commerce/notices/dismiss', { scope: SITE_PAUSED, body: { id: nid(40) } });
  ok('gates: a paused client refuses a scoped write', write1.status === 403 && write1.body?.error === 'entitlement_paused' && statusOf(nid(40)) === 'active', `${write1.status} ${write1.text.slice(0, 120)}`);
  reset();
  T.presence_plan_notices.push(notice(nid(42), SITE_GONE, 'client-gone', 'domain_expiry', 'GONE domain expiring', when(5)));
  const gone = await call('jwt-studio', 'POST', '/commerce/notices/dismiss', { scope: SITE_GONE, body: { id: nid(42) } });
  ok('gates: a client with no live subscription gets no answer', gone.status === 403 && gone.body?.error === 'entitlement_inactive' && statusOf(nid(42)) === 'active', `${gone.status} ${gone.text.slice(0, 120)}`);
}

// ═══ 4. a denied scope: refused before anything is read, and never the caller's own site ═══
{
  const DENIED = [
    ['the studio asking for an archived client', 'jwt-studio', SITE_ARCHIVED, 403, 'archived_client'],
    ['the studio asking for another studio\'s client', 'jwt-studio', SITE_B, 403, 'unauthorized'],
    ['the studio asking for a site that doesn\'t exist', 'jwt-studio', NOBODY, 403, 'unauthorized'],
    ['the studio sending a malformed id', 'jwt-studio', 'not-a-uuid', 400, 'malformed_scope'],
    ['a business owner in no agency', 'jwt-owner-b', SITE_A, 403, 'missing_membership'],
    ['a read-only agency role', 'jwt-readonly', SITE_A, 403, 'read_only_role'],
    ['another studio', 'jwt-other-studio', SITE_A, 403, 'unauthorized'],
    ['a paused agency', 'jwt-paused-agency', SITE_A, 403, 'missing_membership'],
  ];
  for (const [who, jwt, scope, status, reason] of DENIED) {
    let same = true, leak = '', clean = true, logged = true, note = '';
    for (const [method, route, body] of ALL_SIGNED_IN) {
      reset();
      const before = everythingButAudit();
      const r = await call(jwt, method, route, { scope, body });
      if (r.status !== status || r.body?.error !== 'scope_denied') { same = false; note = `${method} ${route} → ${r.status} ${r.text.slice(0, 100)}`; }
      if (/ALPHA|BRAVO|STUDIO|cus_|billing\.stripe|"steps"|"notices"/.test(r.text)) leak = `${route}: ${r.text.slice(0, 100)}`;
      if (everythingButAudit() !== before || stripeCalls.length || contentCalls().length || writes().length) clean = false;
      const a = audit();
      if (a.length !== 1 || a[0].outcome !== 'denied' || a[0].reason !== reason || a[0].route !== route) logged = false;
    }
    ok(`denied, ${who}: every route answers ${status} scope_denied`, same, note);
    ok(`denied, ${who}: no data comes back`, !leak, leak);
    ok(`denied, ${who}: nothing is read or written, on any site`, clean);
    ok(`denied, ${who}: each attempt is recorded as denied (${reason})`, logged, JSON.stringify(audit()).slice(0, 200));
  }
  reset();
  const none = await call(null, 'GET', '/commerce/notices', { scope: SITE_A });
  const none2 = await call('jwt-unknown', 'POST', '/commerce/portal', { scope: SITE_A, body: {} });
  ok('denied: no sign-in → 401, with or without a scope', none.status === 401 && none2.status === 401 && stripeCalls.length === 0, `${none.status} ${none2.status}`);
}

// ═══ 5. un-scoped: byte-for-byte what it was, and no audit row ═══
for (const [label, header] of [['no header', undefined], ['the empty header the pages send when un-scoped', '']]) {
  const opts = (body) => ({ scope: header, body });
  {
    reset();
    const r = await call('jwt-studio', 'GET', '/commerce/notices', opts());
    ok(`un-scoped (${label}): the caller's own notices, billing rows included`, r.status === 200 && JSON.stringify(headlines(r)) === JSON.stringify(['STUDIO card failed', 'STUDIO domain expiring', 'STUDIO outgrew its plan']), headlines(r).join(' | '));
    ok(`un-scoped (${label}): the same response shape, actions included`, JSON.stringify(r.body?.data?.notices?.[0]?.actions) === JSON.stringify(['upgrade', 'learn_more', 'dismiss']) && r.body?.data?.notices?.[0]?.dismissible === true);
    ok(`un-scoped (${label}): read under the caller's JWT and the anon key, so RLS still decides`, contentCalls().length === 1 && contentCalls()[0].role === 'user' && contentCalls()[0].token === 'jwt-studio' && contentCalls()[0].apikey === 'ANON-KEY');
    ok(`un-scoped (${label}): nothing recorded`, audit().length === 0);
  }
  {
    reset();
    const r = await call('jwt-studio', 'POST', '/commerce/notices/dismiss', opts({ id: N.STUDIO_PAY }));
    ok(`un-scoped (${label}): an owner can still clear their own card-failed notice`, r.status === 200 && statusOf(N.STUDIO_PAY) === 'dismissed', r.text.slice(0, 120));
    ok(`un-scoped (${label}): the write is still the service role, confined by client_id`, writes().length === 1 && writes()[0].role === 'service' && writes()[0].query.includes(`id=eq.${N.STUDIO_PAY}`) && writes()[0].query.includes('client_id=eq.client-studio'), JSON.stringify(writes()));
    reset();
    const foreign = await call('jwt-studio', 'POST', '/commerce/notices/dismiss', opts({ id: N.A_DOMAIN }));
    ok(`un-scoped (${label}): a client's row is still not theirs`, foreign.status === 404 && statusOf(N.A_DOMAIN) === 'active');
    reset();
    T.presence_plan_notices.push(notice(nid(41), SITE_STUDIO, 'client-studio', 'publish_failed', 'STUDIO publish failed', when(6)));
    const prot = await call('jwt-studio', 'POST', '/commerce/notices/dismiss', opts({ id: nid(41) }));
    ok(`un-scoped (${label}): protected kinds still refuse`, prot.status === 409 && prot.body?.error === 'not_dismissable');
    reset();
    const noId = await call('jwt-studio', 'POST', '/commerce/notices/dismiss', opts({}));
    ok(`un-scoped (${label}): no id still clears only their capacity card`, noId.status === 200 && statusOf(N.STUDIO_CAP) === 'dismissed' && statusOf(N.STUDIO_PAY) === 'active' && statusOf(N.A_CAP) === 'active');
    ok(`un-scoped (${label}): nothing recorded`, audit().length === 0);
  }
  {
    reset();
    const r = await call('jwt-owner-a', 'GET', '/commerce/first-run', opts());
    ok(`un-scoped (${label}): an owner's welcome state is theirs, one read under their JWT`, r.status === 200 && r.body?.data?.dismissed === false && contentCalls().length === 1 && contentCalls().every((c) => c.table === 'presence_first_run' && c.role === 'user' && c.token === 'jwt-owner-a'), r.text.slice(0, 160));
    const d = await call('jwt-owner-a', 'POST', '/commerce/first-run/dismiss', opts());
    ok(`un-scoped (${label}): an owner can still dismiss their welcome`, d.status === 200 && T.presence_first_run.find((f) => f.site_id === SITE_A).dismissed === true && T.presence_first_run.find((f) => f.site_id === SITE_STUDIO).dismissed === false);
    ok(`un-scoped (${label}): nothing recorded`, audit().length === 0);
  }
  {
    reset();
    const sub = await call('jwt-studio', 'GET', '/commerce/subscription', opts());
    ok(`un-scoped (${label}): subscription is the caller's own`, sub.status === 200 && sub.body?.data?.plan === 'presence' && sub.body?.data?.billing_type === 'saas', sub.text.slice(0, 160));
    const p = await call('jwt-studio', 'POST', '/commerce/portal', opts({}));
    ok(`un-scoped (${label}): portal opens the caller's own Stripe customer`, p.status === 200 && p.body?.data?.url === 'https://billing.stripe.test/cus_studio' && stripeCalls.length === 1 && stripeCalls[0].customer === 'cus_studio', `${p.status} ${p.text.slice(0, 120)}`);
    const ex = await call('jwt-studio', 'GET', '/commerce/example-data', opts());
    ok(`un-scoped (${label}): example data still answers`, ex.status === 200 && ex.body?.data?.present === true, ex.text.slice(0, 120));
    const rm = await call('jwt-studio', 'POST', '/commerce/example-data/remove', opts({}));
    ok(`un-scoped (${label}): example data still removes, from their site only`, rm.status === 200 && T.presence_contacts.some((c) => c.site_id === SITE_A), rm.text.slice(0, 120));
    const del = await call('jwt-studio', 'POST', '/commerce/delete-request', opts({}));
    ok(`un-scoped (${label}): a deletion request is still theirs to make`, del.status === 200 && T.presence_account_deletions.length === 1 && T.presence_account_deletions[0].client_id === 'client-studio', del.text.slice(0, 160));
    const can = await call('jwt-studio', 'POST', '/commerce/delete-cancel', opts({}));
    ok(`un-scoped (${label}): …and to cancel`, can.status === 200 && can.body?.data?.canceled === true, can.text.slice(0, 160));
    ok(`un-scoped (${label}): nothing recorded`, audit().length === 0);
  }
}
{
  reset();
  const a = await call('jwt-studio', 'GET', '/commerce/notices');
  const b = await call('jwt-studio', 'GET', '/commerce/notices', { scope: '' });
  ok('un-scoped: no header and an empty header are the same answer, byte for byte', a.text === b.text && a.status === b.status);
  const none = await call(null, 'GET', '/commerce/subscription');
  ok('un-scoped: still 401 without a sign-in', none.status === 401);
}

// ═══ bug hunt I2 (Nov 10): a closing already asked for rides on the subscription read ═══
// Settings drew "Request deletion" on every load, because nothing read on load said a request
// was open; the only way back to Cancel was to ask again. The read now carries the open
// request's real date (null when there is none), and the portal returns to Settings (I9).
{
  reset();
  const before = await call('jwt-studio', 'GET', '/commerce/subscription');
  ok('I2: nothing asked for → deletion is null', before.status === 200 && before.body?.data?.deletion === null, before.text.slice(0, 200));
  const asked = await call('jwt-studio', 'POST', '/commerce/delete-request', { body: {} });
  const when = T.presence_account_deletions[0]?.scheduled_for;
  const after = await call('jwt-studio', 'GET', '/commerce/subscription');
  ok('I2: after a request, a fresh read carries the date it completes (what the card shows on every visit)', !!when && after.body?.data?.deletion?.scheduled_for === when && after.body?.data?.deletion?.status === 'pending' && asked.body?.data?.scheduled_for === when, after.text.slice(0, 240));
  await call('jwt-studio', 'POST', '/commerce/delete-cancel', { body: {} });
  const back = await call('jwt-studio', 'GET', '/commerce/subscription');
  ok('I2: …and after Cancel it is gone again', back.body?.data?.deletion === null, back.text.slice(0, 200));
  stripeCalls.length = 0;
  await call('jwt-studio', 'POST', '/commerce/portal', { body: {} });
  ok('I9: Manage billing comes back to Settings, not the website page', stripeCalls.length === 1 && /settings\.html#billing$/.test(String(stripeCalls[0].return_url || '')), JSON.stringify(stripeCalls[0] || {}));
}

// ═══ 6. public routes ignore a stray scope: a stranger can still sign up ═══
for (const [method, route, body, status] of [['GET', '/commerce/plans', undefined, 200], ['GET', '/commerce/checkout-status?session_id=cs_1', undefined, 200], ['POST', '/commerce/verify', { token: 'nope' }, 404], ['POST', '/commerce/billing-sync', { type: 'x' }, 403], ['POST', '/commerce/invoice-paid', { invoice_id: 'x' }, 403]]) {
  reset();
  const r = await call(null, method, route, { scope: SITE_A, body });
  ok(`public ${method} ${route.split('?')[0]}: answers as before under a stray scope`, r.status === status && audit().length === 0, `${r.status} ${r.text.slice(0, 100)}`);
}
{
  reset();
  const r = await call('jwt-studio', 'GET', '/commerce/plans', { scope: SITE_B });
  ok('public: even a scope the caller may not use is no barrier to the price list', r.status === 200 && audit().length === 0, String(r.status));
}

// ═══ 7. the bell and Today read the feed, so its flag has to tell the same truth ═══
{
  const flagOf = (r, id) => (r.body?.data?.notices || []).find((n) => n.id === id)?.dismissible;
  reset();
  const scoped = await call('jwt-studio', 'GET', '/portal/feed', { scope: SITE_A });
  ok('feed: 200 under a scope', scoped.status === 200, scoped.text.slice(0, 120));
  ok('feed: Done is offered on the client\'s site rows', flagOf(scoped, N.A_DOMAIN) === true);
  ok('feed: Done is not offered on the client\'s billing and account rows', [N.A_PAY, N.A_TRIAL, N.A_CAP, N.A_RENEW, N.A_LAPSED].every((id) => flagOf(scoped, id) === false || flagOf(scoped, id) === undefined) && flagOf(scoped, N.A_PAY) === false, JSON.stringify(scoped.body?.data?.notices?.map((n) => [n.kind, n.dismissible])));
  reset();
  const own = await call('jwt-owner-a', 'GET', '/portal/feed');
  ok('feed: an owner still gets Done on their own billing row', flagOf(own, N.A_PAY) === true);
  const failedNotices = (own.body?.data?.notices || []).filter((n) => n.kind === 'publish_failed');
  ok('feed: an owner still can\'t clear a protected row', failedNotices.length > 0 && failedNotices.every((n) => n.dismissible === false));
  reset();
  const shown = await call('jwt-studio', 'GET', '/portal/feed', { scope: SITE_A });
  const offered = shown.body.data.notices.filter((n) => n.dismissible);
  const answers = [];
  for (const n of offered) answers.push((await call('jwt-studio', 'POST', '/commerce/notices/dismiss', { scope: SITE_A, body: { id: n.id } })).status);
  ok('feed: every Done the feed offers, the route honours', offered.length > 0 && answers.every((s) => s === 200), answers.join(','));
  reset();
  // real rows only: the feed's synthetic rows have no UUID, and the pages' NOTICE_ID_RE never offers them Done
  const withheld = (await call('jwt-studio', 'GET', '/portal/feed', { scope: SITE_A })).body.data.notices.filter((n) => !n.dismissible && /^[0-9a-f-]{36}$/.test(String(n.id)));
  const refused = [];
  for (const n of withheld) refused.push((await call('jwt-studio', 'POST', '/commerce/notices/dismiss', { scope: SITE_A, body: { id: n.id } })).status);
  ok('feed: every Done the feed withholds, the route refuses', withheld.length > 0 && refused.every((s) => s === 409), refused.join(','));
}

// ═══ 8. the rules: one list, and the pages agree with it ═══
{
  const feed = await import('../../supabase/functions/presence/lib/inbox_feed.ts');
  const commerce = await import('../../supabase/functions/presence/routes/commerce.ts');
  const kinds = feed.NOTICE_ACCOUNT_KINDS;
  ok('rule: the account kinds are exactly the owner\'s subscription and account', kinds && ['capacity', 'trial_ending', 'trial_ended', 'payment_trouble', 'account_lapsed', 'renewal_reminder', 'winddown_reminder', 'win_back', 'welcome_back', 'deletion_requested'].every((k) => kinds.has(k)) && kinds.size === 10);
  ok('rule: site work is not an account kind', kinds && ['domain_expiry', 'lead_followup', 'website_enquiry', 'publish_failed', 'connection_expired', 'search_setup', 'new_booking', 'new_review', 'deal_followup', 'invoice_paid', 'agreement_renewal'].every((k) => !kinds.has(k)));
  const isPublic = commerce.isPublicCommerceRoute;
  ok('rule: the public list is exact', !!isPublic && [['GET', '/commerce/plans'], ['POST', '/commerce/signup'], ['POST', '/commerce/verify'], ['GET', '/commerce/checkout-status'], ['POST', '/commerce/billing-sync'], ['POST', '/commerce/invoice-paid']].every(([m, r]) => isPublic(r, m)));
  ok('rule: deletion needs a sign-in, so it isn\'t public', !!isPublic && !isPublic('/commerce/delete-request', 'POST') && !isPublic('/commerce/delete-cancel', 'POST'));
  ok('rule: neither is any other method or route', !!isPublic && !isPublic('/commerce/plans', 'POST') && !isPublic('/commerce/portal', 'POST') && !isPublic('/commerce', 'GET') && !isPublic('/commerce/plans/', 'GET'));

  const idx = read('supabase/functions/presence/index.ts');
  const at = (s) => idx.indexOf(s);
  ok('index: scoped /commerce reaches its handler only after the data path is built', at('const db = siteDb(jwt, site, principal);') > 0 && at('handleScopedCommerce(req, db,') > at('const db = siteDb(jwt, site, principal);'));
  ok('index: …and before the first ordinary route', at('handleScopedCommerce(req, db,') > 0 && at('handleScopedCommerce(req, db,') < at("if (route === '/site' && method === 'GET')"));

  const pres = read('presence.html');
  ok('presence: billing and deletion are gone from the builder, Settings owns them', !/mountBillingCard|mountDeletionCard/.test(pres));
  ok('presence: so are the plan card and the welcome', /if \(!new URLSearchParams\(location\.search\)\.get\("client"\)\) \{\s*renderFirstRun\(\);\s*renderPlanNotice\(\);/.test(pres));
  ok('presence: a payment notice goes to the billing card on Settings', /payment_trouble:\s*\{[^}]*settings\.html#billing/.test(pres) && /account_lapsed:\s*\{[^}]*settings\.html#billing/.test(pres));
  const settings = read('settings.html');
  ok('settings: the plan card still never loads in a drill-in', /async function loadPlan\(\) \{\s*if \(SCOPE\) return;/.test(settings));
  const today = read('today.html');
  ok('today: example data is still never asked for in a drill-in', /get\('client'\)\?Promise\.resolve\(null\):apiGet\('\/commerce\/example-data'\)/.test(today));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SCOPED COMMERCE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
Deno.exit(passed === results.length ? 0 : 1);
