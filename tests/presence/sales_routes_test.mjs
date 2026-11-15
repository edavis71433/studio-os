// ── Sales routes: what /sales does, for one studio and never for another (P2-C) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_routes_test.mjs
//
// The real handlers (routes/sales.ts) and the real router (index.ts) run against the
// shared in-memory PostgREST (fake_pgrst.mjs). The outside world is stood in for
// below: sign-ins (the auth admin API), mail (Resend), hosting (Netlify) and Stripe,
// each answering and keeping what it was asked. Two studios share the database,
// Juniper Web Co. (A) and Cobalt Studio (B): section 1 sweeps the routes for anything
// of Cobalt's that Juniper can read or change, and the later sections check the same
// wherever a link, a session or an email could cross over. All names are made up.
//
//   1  tenant safety: Cobalt's ids are 404s, its rows stay exactly as they were,
//      nothing of it comes back, and every row Juniper writes carries Juniper's site
//   2  the public links: signed, read in the link's own studio, rate limited per IP
//   3  the one link (flow): minted for the deal, taken in place of a document link,
//      the agreement unlocks only after the proposal is accepted, no drafts shown
//   4  once only: sends, decisions and signatures; the version and stage guards hold
//      when a change lands in between
//   5  deals: the close date, the value, the stage ladder and its events, the contact
//   6  convert: a real sign-in, one claim, roll back only what it made
//   7  Add a customer: set up now, already set up, connect by email
//   8  the services catalog
//   9  document links open on the studio's own site
//  10  the router: which routes are public, and the gates in front of the rest
//  11  pins: the migration's tables, checks and indexes (there is no database here)
//  12  the checks PR 433 (builder item 199) rewrites, left as text until it lands
// Page behaviour is checked in the browser: the list at the end, and
// tests/e2e/sales-routes-212.spec.ts.
import { installFakePostgrest } from './fake_pgrst.mjs';

const SECRET = 'sign-secret-for-tests-0123456789abcdef';
Deno.env.set('APPROVAL_SECRET', SECRET);
Deno.env.set('RESEND_KEY', 're_test_key');
Deno.env.set('EMAIL_FROM', 'Example Studio <hello@example.com>');
Deno.env.set('SITE_URL', 'https://app.example.com');
Deno.env.set('NETLIFY_AUTH_TOKEN', 'nf_test_token');   // hosting answers below
Deno.env.set('STRIPE_SECRET', 'sk_test_stub');          // so any Stripe call would show up below
for (const k of ['STATE_SIGNING_SECRET', 'SCHEDULER_SECRET', 'RESEND_API_URL', 'RESEND_INBOUND_DOMAIN', 'OPS_ALERT_EMAIL', 'OPERATOR_SECRET']) Deno.env.delete(k);

const id = (p) => (n) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id('aaaaaaaa'), B = id('bbbbbbbb'), O = id('cccccccc');
// Juniper Web Co. (A): the studio under test
const SITE_A = A(1), CLIENT_A = A(2), USER_A = A(3);
const CT_A = A(11), CT_A2 = A(12), DEAL_A = A(21), DEAL_A2 = A(22), PROP_A = A(31), PROP_A2 = A(32), CON_A = A(41), TPL_A = A(51), SUB_A = A(61);
// Cobalt Studio (B): the other studio, whose rows must never move
const SITE_B = B(1), CLIENT_B = B(2), USER_B = B(3);
const CT_B = B(11), CT_B_GONE = B(12), DEAL_B = B(21), DEAL_B_GONE = B(22), PROP_B = B(31), CON_B = B(41), TPL_B = B(51), TPL_B_CON = B(52), SUB_B = B(61), EV_B = B(71);
// other accounts the router meets
const SITE_C = O(1), CLIENT_C = O(2), USER_C = O(3);     // an edition without the Customers area
const SITE_P = O(11), CLIENT_P = O(12), USER_P = O(13);  // a paused subscription
const SITE_G = O(21), CLIENT_G = O(22), USER_G = O(23);  // an ended subscription
const CLIENT_N = O(32), USER_N = O(33);                  // an account with no site
const AGENCY_A = A(90), MEMBER_A = A(91);
const EXISTING = O(41), EXISTING_SITE = O(42), OTHER_CLIENT = O(43);   // customers already on the platform

const USERS = {
  'jwt-a': { id: USER_A, email: 'owner@juniper.example' },
  'jwt-b': { id: USER_B, email: 'owner@cobalt.example' },
  'jwt-cms': { id: USER_C, email: 'owner@crafted.example' },
  'jwt-paused': { id: USER_P, email: 'owner@paused.example' },
  'jwt-gone': { id: USER_G, email: 'owner@gone.example' },
  'jwt-nosite': { id: USER_N, email: 'owner@nosite.example' },
};
const db = installFakePostgrest({
  users: USERS,
  ownSite: { 'jwt-a': SITE_A, 'jwt-b': SITE_B, 'jwt-cms': SITE_C, 'jwt-paused': SITE_P, 'jwt-gone': SITE_G },
  unique: { presence_sites: [['client_id']] },
});

// ── the outside world: sign-ins, mail, hosting and Stripe answer here and keep what they were asked ──
const pg = globalThis.fetch;
const outside = [];          // { to: 'auth' | 'mail' | 'hosting' | 'stripe', ... }
const signIns = new Map();   // email -> the sign-in's id (people who can already sign in)
const knob = {};             // per-test switches: refuseBucket, linkFails, before (a change landing mid-request), spy
const resetKnobs = () => { knob.refuseBucket = null; knob.linkFails = new Set(); knob.before = null; knob.spy = null; };
resetKnobs();
const reply = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  let body = null; try { body = init.body ? JSON.parse(String(init.body)) : null; } catch { body = String(init.body || ''); }
  if (knob.spy) knob.spy({ method, url: u, body });
  if (u.hostname === 'api.resend.com') { outside.push({ to: 'mail', body }); return reply({ id: `em_${outside.length}` }); }
  if (u.hostname === 'api.netlify.com') {
    outside.push({ to: 'hosting', method, path: u.pathname });
    if (method === 'POST') return reply({ id: `nf-${body.name}`, name: body.name, default_domain: `${body.name}.netlify.app`, state: 'current' }, 201);
    const nid = decodeURIComponent(u.pathname.split('/').pop());
    return reply({ id: nid, name: nid, default_domain: `${nid}.netlify.app`, state: 'current' });
  }
  if (u.hostname === 'api.stripe.com') { outside.push({ to: 'stripe', method, path: u.pathname }); return reply({ id: `st_${outside.length}`, url: `https://buy.stripe.test/${outside.length}` }); }
  if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
    outside.push({ to: 'auth', method, path: u.pathname, email: body.email });
    if (signIns.has(body.email)) return reply({ msg: 'A user with this email address has already been registered' }, 422);
    const uid = crypto.randomUUID(); signIns.set(body.email, uid); return reply({ id: uid, email: body.email });
  }
  if (u.pathname.startsWith('/auth/v1/admin/users/') && method === 'DELETE') {
    const uid = decodeURIComponent(u.pathname.split('/').pop());
    outside.push({ to: 'auth', method, path: u.pathname, id: uid });
    for (const [e, i] of signIns) if (i === uid) signIns.delete(e);
    return reply({});
  }
  if (u.pathname === '/auth/v1/admin/generate_link') {
    outside.push({ to: 'auth', method, path: u.pathname, type: body.type, email: body.email, redirect_to: body.redirect_to });
    if (knob.linkFails.has(body.type)) return reply({ msg: 'refused' }, 422);
    return reply({ action_link: `https://db.test/auth/v1/verify?type=${body.type}&token=tk-${body.type}` });
  }
  // the rate limiter's database function: true = under the limit
  if (u.pathname === '/rest/v1/rpc/rate_hit') return reply(!(knob.refuseBucket && knob.refuseBucket(String(body.p_bucket))));
  if (knob.before) { const r = await knob.before({ method, path: decodeURIComponent(u.pathname + u.search), body }); if (r) return r; }
  return pg(url, init);
};

const S = await import('../../supabase/functions/presence/routes/sales.ts');
const L = await import('../../supabase/functions/presence/lib/sales_lifecycle.ts');
const LC = await import('../../supabase/functions/presence/commerce/lifecycle.ts');
const { hmacHex } = await import('../../supabase/functions/_shared/hmac.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${!p && note ? `\n        ${String(note).slice(0, 400)}` : ''}`); };
const cors = {};
const IP = '198.51.100.7';
const req = (method, path, body, headers = {}) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-forwarded-for': IP, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const res = async (rp) => { const r = await rp; const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* html */ } return { status: r.status, body, text, type: r.headers.get('Content-Type') || '', headers: r.headers }; };
const DAY = 86_400_000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const ahead = (d) => new Date(Date.now() + d * DAY).toISOString();
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const nowSec = () => Math.floor(Date.now() / 1000);
const sign = (o) => S.signSalesToken({ exp: nowSec() + 3600, ...o }, SECRET);
const verify = (t) => S.verifySalesToken(t, SECRET, nowSec());
const row = (table, rid) => (db.tables[table] || []).find((r) => r.id === rid);
const writes = () => db.log.filter((c) => c.method !== 'GET' && c.method !== 'HEAD');
const wrote = (table, method) => writes().filter((c) => c.url.split('?')[0] === `/rest/v1/${table}` && (!method || c.method === method));
const mailTo = (addr) => outside.filter((o) => o.to === 'mail' && o.body && o.body.to === addr);
const authCreates = () => outside.filter((o) => o.to === 'auth' && o.method === 'POST' && o.path === '/auth/v1/admin/users');
const authDeletes = () => outside.filter((o) => o.to === 'auth' && o.method === 'DELETE');
const flowOf = async (url) => { const m = /\/sign\.html\?t=([^"&\s]+)/.exec(String(url || '')); return m ? verify(decodeURIComponent(m[1])) : null; };
const settle = async (cond) => { for (let i = 0; i < 500 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); return cond(); };   // a send nobody waits on

const siteA = { id: SITE_A, client_id: CLIENT_A, status: 'live', edition: 'presence' };
const siteB = { id: SITE_B, client_id: CLIENT_B, status: 'live', edition: 'presence' };
const principal = (jwt) => ({ kind: 'client', userId: USERS[jwt].id, tenantId: null, role: 'client', email: USERS[jwt].email, jwt, requestId: `test-${jwt}` });
const studioA = principal('jwt-a'), studioB = principal('jwt-b');

const LINES = [{ label: 'Homepage', qty: 1, unit_cents: 120000 }, { label: 'Menu page', qty: 2, unit_cents: 30000 }];
const AGREEMENT = 'This agreement covers the Blue Finch Cafe website. Payment is due on completion.';
const HASH = await L.contractHash(AGREEMENT, {});
const siteRow = (sid, client_id, extra = {}) => ({ id: sid, client_id, status: 'live', edition: 'presence', netlify_site_id: null, template_slug: 'restaurant-classic', ...extra });
const clientRow = (cid, name, email) => ({ id: cid, name, email, contact_email: email, status: 'active', tenant_id: null, deleted_at: null });
const ent = (client_id, extra = {}) => ({ client_id, product: 'presence', plan: 'presence', status: 'active', ...extra });
const contact = (cid, site_id, name, email, company = '', extra = {}) => ({ id: cid, site_id, name, email, phone: '', company, notes: '', client_id: null, found_via: '', deleted_at: null, created_at: ago(30), updated_at: ago(10), ...extra });
const deal = (did, site_id, title, stage, contact_id, extra = {}) => ({ id: did, site_id, title, stage, contact_id, source: 'manual', source_submission_id: null, expected_value_cents: 0, expected_close: null, notes: '', assigned_to: null, lost_reason: '', converted_client_id: null, converted_site_id: null, converted_at: null, created_project_id: null, next_step: null, next_step_at: null, deleted_at: null, created_at: ago(20), updated_at: ago(2), ...extra });
const proposal = (pid, site_id, deal_id, status, extra = {}) => ({ id: pid, site_id, deal_id, title: 'Website proposal', line_items: LINES, subtotal_cents: 180000, currency: 'usd', terms: '', status, version: 1, sent_at: status === 'draft' ? null : ago(1), decided_at: null, decided_note: '', first_viewed_at: null, expires_at: status === 'draft' ? null : ahead(29), deleted_at: null, created_at: ago(3), updated_at: ago(1), ...extra });
const agreement = (cid, site_id, deal_id, status, extra = {}) => ({ id: cid, site_id, deal_id, proposal_id: null, title: 'Service agreement', body: AGREEMENT, content_hash: HASH, terms_snapshot: {}, status, signer_name: '', signer_email: '', signed_at: null, signed_evidence: {}, version: 1, sent_at: status === 'draft' ? null : ago(1), deleted_at: null, created_at: ago(3), updated_at: ago(1), ...extra });

// Both studios, a few of Juniper's own records, and Cobalt's records that must never move.
// `edit` changes the tables before they are loaded.
function world(edit = () => {}) {
  const t = {
    presence_sites: [siteRow(SITE_A, CLIENT_A), siteRow(SITE_B, CLIENT_B), siteRow(SITE_C, CLIENT_C), siteRow(SITE_P, CLIENT_P), siteRow(SITE_G, CLIENT_G)],
    clients: [clientRow(CLIENT_A, 'Juniper Web Co.', 'owner@juniper.example'), clientRow(CLIENT_B, 'Cobalt Studio', 'owner@cobalt.example'), clientRow(CLIENT_C, 'Crafted Pages', 'owner@crafted.example'),
      clientRow(CLIENT_P, 'Paused Bakery', 'owner@paused.example'), clientRow(CLIENT_G, 'Gone Garage', 'owner@gone.example'), clientRow(CLIENT_N, 'No Site Yet', 'owner@nosite.example')],
    presence_entitlements: [ent(CLIENT_A), ent(CLIENT_B), ent(CLIENT_C, { plan: 'cms_only' }), ent(CLIENT_P, { status: 'paused' }), ent(CLIENT_G, { status: 'deleted' })],
    presence_identity: [{ site_id: SITE_A, business_name: 'Juniper Web Co.' }, { site_id: SITE_B, business_name: 'Cobalt Studio' }],
    presence_contacts: [
      contact(CT_A, SITE_A, 'Riley Park', 'riley@example.org', 'Blue Finch Cafe'),
      contact(CT_A2, SITE_A, 'Quinn Ash', '', ''),
      contact(CT_B, SITE_B, 'Morgan Lee', 'morgan@example.net', 'Harbor Dental'),
      contact(CT_B_GONE, SITE_B, 'Dale Fern', 'dale@example.net', '', { deleted_at: ago(2) }),
    ],
    presence_deals: [
      deal(DEAL_A, SITE_A, 'Blue Finch Cafe website', 'lead', CT_A),
      deal(DEAL_A2, SITE_A, 'Quinn Ash logo', 'qualified', CT_A2),
      deal(DEAL_B, SITE_B, 'Harbor Dental refresh', 'proposal', CT_B, { expected_value_cents: 450000 }),
      deal(DEAL_B_GONE, SITE_B, 'Harbor Dental signage', 'lead', CT_B, { deleted_at: ago(3) }),
    ],
    presence_proposals: [proposal(PROP_A, SITE_A, DEAL_A, 'draft'), proposal(PROP_B, SITE_B, DEAL_B, 'draft')],
    presence_contracts: [agreement(CON_A, SITE_A, DEAL_A, 'draft'), agreement(CON_B, SITE_B, DEAL_B, 'draft')],
    presence_deal_events: [{ id: EV_B, deal_id: DEAL_B, site_id: SITE_B, kind: 'created', from_stage: '', to_stage: 'lead', detail: {}, actor: 'owner@cobalt.example', actor_kind: 'client', created_at: ago(9) }],
    presence_sales_templates: [
      { id: TPL_A, site_id: SITE_A, kind: 'proposal', name: 'Starter site', title: 'Starter site', body: '', line_items: LINES, deleted_at: null, updated_at: ago(5) },
      { id: TPL_B, site_id: SITE_B, kind: 'proposal', name: 'Cobalt package', title: 'Cobalt package', body: '', line_items: LINES, deleted_at: null, updated_at: ago(4) },
      { id: TPL_B_CON, site_id: SITE_B, kind: 'contract', name: 'Cobalt agreement', title: 'Cobalt agreement', body: 'Cobalt terms for {{client_name}}.', line_items: [], deleted_at: null, updated_at: ago(4) },
    ],
    presence_form_submissions: [
      { id: SUB_A, site_id: SITE_A, status: 'new', name: 'Ira Moss', email: 'ira@example.org', message: 'We need a site before our March opening.' },
      { id: SUB_B, site_id: SITE_B, status: 'new', name: 'Pat Vale', email: 'pat@example.net', message: 'Cobalt enquiry, a quote please.' },
    ],
  };
  edit(t);
  db.reset(t);
  outside.length = 0; signIns.clear(); resetKnobs();
}
// Cobalt's rows, in every table, as they are now: compared before and after Juniper acts
const B_KEYS = new Set([SITE_B, CLIENT_B]);
const theirs = () => JSON.stringify(Object.entries(db.tables).map(([t, rs]) => [t, (rs || []).filter((r) => r && [r.site_id, r.id, r.client_id, r.agency_site_id, r.customer_client_id].some((k) => B_KEYS.has(k)))]).filter(([, rs]) => rs.length));
// anything of Cobalt's that must never come back in Juniper's answers
const COBALT = [SITE_B, CLIENT_B, CT_B, CT_B_GONE, DEAL_B, DEAL_B_GONE, PROP_B, CON_B, TPL_B, TPL_B_CON, SUB_B, EV_B, 'Harbor Dental', 'Cobalt', 'Dale Fern', 'Pat Vale', 'Cobalt enquiry'];
const leaks = (text) => COBALT.filter((s) => String(text).includes(s));

// ═══ 1. Tenant safety: Juniper never reads or changes a row of Cobalt's ═══
{
  // rows that sit on Juniper's own deal but carry Cobalt's site: only a missing site filter would show them
  world((t) => {
    t.presence_deal_events.push({ id: B(72), deal_id: DEAL_A, site_id: SITE_B, kind: 'note', from_stage: '', to_stage: '', detail: { activity_kind: 'note', body: 'Cobalt private note' }, actor: 'x', actor_kind: 'client', created_at: ago(1) });
    t.presence_proposals.push(proposal(B(33), SITE_B, DEAL_A, 'sent', { title: 'Cobalt stray proposal' }));
    t.presence_contracts.push(agreement(B(43), SITE_B, DEAL_A, 'sent', { title: 'Cobalt stray agreement' }));
  });
  COBALT.push('Cobalt private note', 'Cobalt stray proposal', 'Cobalt stray agreement', B(33), B(43), B(72));
  const before = theirs();
  const ids = (table) => new Set((db.tables[table] || []).map((r) => r.id));
  const had = Object.fromEntries(['presence_deals', 'presence_contacts', 'presence_proposals', 'presence_contracts', 'presence_deal_events', 'presence_sales_templates'].map((t) => [t, ids(t)]));
  const seen = [];
  const call = async (label, p) => { const r = await res(await p); seen.push([label, r]); return r; };
  const at = (method, path, body) => req(method, path, body);

  // Cobalt's ids, from Juniper
  const cross = [
    ['read a deal', () => S.handleSalesDeal(at('GET', `/sales/deals/${DEAL_B}`), siteA, studioA, DEAL_B, cors)],
    ['edit a deal', () => S.handleSalesDeal(at('PATCH', `/sales/deals/${DEAL_B}`, { title: 'Taken', expected_value_cents: 1 }), siteA, studioA, DEAL_B, cors)],
    ['delete a deal', () => S.handleSalesDeal(at('DELETE', `/sales/deals/${DEAL_B}`), siteA, studioA, DEAL_B, cors)],
    ['move a deal', () => S.handleSalesDealStage(at('POST', `/sales/deals/${DEAL_B}/stage`, { to: 'lost' }), siteA, studioA, DEAL_B, cors)],
    ['log a call on a deal', () => S.handleSalesDealActivity(at('POST', `/sales/deals/${DEAL_B}/activity`, { kind: 'call', body: 'Called them' }), siteA, studioA, DEAL_B, cors)],
    ['draft a proposal on a deal', () => S.handleSalesProposalCreate(at('POST', `/sales/deals/${DEAL_B}/proposals`, { line_items: LINES }), siteA, studioA, DEAL_B, cors)],
    ['draft an agreement on a deal', () => S.handleSalesContractCreate(at('POST', `/sales/deals/${DEAL_B}/contracts`, { body: 'Terms.' }), siteA, studioA, DEAL_B, cors)],
    ['send a deal', () => S.handleSalesDealSend(at('POST', `/sales/deals/${DEAL_B}/send`, {}), siteA, studioA, DEAL_B, cors)],
    ['convert a deal', () => S.handleSalesConvert(at('POST', `/sales/deals/${DEAL_B}/convert`, {}), siteA, studioA, DEAL_B, cors)],
    ['resend a welcome', () => S.handleSalesResendInvite(at('POST', `/sales/deals/${DEAL_B}/resend-invite`, {}), siteA, studioA, DEAL_B, cors)],
    ['bring back a deleted deal', () => S.handleSalesRestoreDeal(siteA, DEAL_B_GONE, cors)],
    ['send a proposal', () => S.handleSalesProposalSend(at('POST', `/sales/proposals/${PROP_B}/send`, {}), siteA, studioA, PROP_B, cors)],
    ['revise a proposal', () => S.handleSalesProposalRevise(at('POST', `/sales/proposals/${PROP_B}/revise`, {}), siteA, studioA, PROP_B, cors)],
    ['delete a proposal', () => S.handleSalesProposalDelete(siteA, studioA, PROP_B, cors)],
    ['send an agreement', () => S.handleSalesContractSend(at('POST', `/sales/contracts/${CON_B}/send`, {}), siteA, studioA, CON_B, cors)],
    ['delete an agreement', () => S.handleSalesContractDelete(siteA, studioA, CON_B, cors)],
    ['link to a document', () => S.handleSalesDocumentLink(siteA, 'proposal', PROP_B, cors)],
    ['read a contact', () => S.handleSalesContact(at('GET', `/sales/contacts/${CT_B}`), siteA, studioA, CT_B, cors)],
    ['edit a contact', () => S.handleSalesContact(at('PATCH', `/sales/contacts/${CT_B}`, { name: 'Taken' }), siteA, studioA, CT_B, cors)],
    ['delete a contact', () => S.handleSalesContact(at('DELETE', `/sales/contacts/${CT_B}?confirm=1`), siteA, studioA, CT_B, cors)],
    ['bring back a removed contact', () => S.handleSalesContactRestore(siteA, CT_B_GONE, cors)],
    ['delete a template', () => S.handleSalesTemplateDelete(siteA, TPL_B, cors)],
  ];
  const wrong = [];
  for (const [label, fn] of cross) { const r = await call(label, fn()); if (r.status !== 404) wrong.push(`${label}: ${r.status} ${r.text.slice(0, 80)}`); }
  ok(`each of Cobalt's deals, proposals, agreements, contacts and templates is a 404 to Juniper (${cross.length} routes)`, wrong.length === 0, wrong.join(' | '));

  // Juniper's own records, pointed at Cobalt's
  const badContact = await call('a deal with their contact', S.handleSalesDeals(at('POST', '/sales/deals', { title: 'Borrowed contact', contact_id: CT_B }), siteA, studioA, cors));
  ok('a new deal naming Cobalt\'s contact is refused (422 bad_contact) and nothing is saved', badContact.status === 422 && badContact.body?.error === 'bad_contact' && !db.tables.presence_deals.some((d) => d.title === 'Borrowed contact'), badContact.text);
  const relink = await call('point a deal at their contact', S.handleSalesDeal(at('PATCH', `/sales/deals/${DEAL_A}`, { contact_id: CT_B }), siteA, studioA, DEAL_A, cors));
  ok('pointing Juniper\'s deal at Cobalt\'s contact is refused and the deal keeps its own', relink.status === 422 && row('presence_deals', DEAL_A).contact_id === CT_A, relink.text);
  const fromTheirEnquiry = await call('a deal from their enquiry', S.handleSalesDeals(at('POST', '/sales/deals', { title: 'From their enquiry', source_submission_id: SUB_B }), siteA, studioA, cors));
  const made = db.tables.presence_deals.find((d) => d.title === 'From their enquiry');
  ok('a deal naming Cobalt\'s website enquiry is made without the link, without its words, and the enquiry stays new', fromTheirEnquiry.status === 201 && made && made.source_submission_id === null && !/Cobalt enquiry/.test(made.notes) && row('presence_form_submissions', SUB_B).status === 'new', fromTheirEnquiry.text);
  const tpl = await call('their proposal template', S.handleSalesProposalCreate(at('POST', `/sales/deals/${DEAL_A}/proposals`, { template_id: TPL_B }), siteA, studioA, DEAL_A, cors));
  const tplC = await call('their agreement template', S.handleSalesContractCreate(at('POST', `/sales/deals/${DEAL_A}/contracts`, { template_id: TPL_B_CON }), siteA, studioA, DEAL_A, cors));
  ok('drafting from Cobalt\'s proposal or agreement template is a 404', tpl.status === 404 && tplC.status === 404, `${tpl.status} ${tplC.status}`);
  const conWithTheirs = await call('an agreement naming their proposal', S.handleSalesContractCreate(at('POST', `/sales/deals/${DEAL_A}/contracts`, { body: 'Our terms.', proposal_id: PROP_B }), siteA, studioA, DEAL_A, cors));
  ok('an agreement naming Cobalt\'s proposal is saved without that link', conWithTheirs.status === 201 && conWithTheirs.body?.data?.proposal_id === null, conWithTheirs.text);
  const sameEmail = await call('a contact with their email', S.handleSalesContacts(at('POST', '/sales/contacts', { name: 'M. Lee', email: 'morgan@example.net', site_id: SITE_B }), siteA, studioA, cors));
  ok('a contact with the same email as one of Cobalt\'s is Juniper\'s own new contact, never theirs handed back', sameEmail.status === 201 && !sameEmail.body?.deduped && sameEmail.body?.data?.id !== CT_B && row('presence_contacts', sameEmail.body?.data?.id)?.site_id === SITE_A, sameEmail.text);

  // the reads list Juniper's own rows only
  const deals = await call('the deal list', S.handleSalesDeals(at('GET', '/sales/deals?limit=100'), siteA, studioA, cors));
  ok('the deal list is Juniper\'s deals only', deals.status === 200 && deals.body.data.length > 0 && deals.body.data.every((d) => row('presence_deals', d.id)?.site_id === SITE_A), deals.text.slice(0, 200));
  const people = await call('the contact list', S.handleSalesContacts(at('GET', '/sales/contacts?limit=100&include_deleted=1'), siteA, studioA, cors));
  ok('the contact list is Juniper\'s contacts only, even asking for removed ones too', people.status === 200 && people.body.data.length >= 2 && people.body.data.every((c) => row('presence_contacts', c.id)?.site_id === SITE_A), people.text.slice(0, 200));
  const detail = await call('a deal of theirs on our deal', S.handleSalesDeal(at('GET', `/sales/deals/${DEAL_A}`), siteA, studioA, DEAL_A, cors));
  ok('Juniper\'s deal shows only its own proposals, agreements and history, never rows stamped with Cobalt\'s site', detail.status === 200 && detail.body.data.proposals.every((p) => p.id !== B(33)) && detail.body.data.contracts.every((c) => c.id !== B(43)) && detail.body.data.events.every((e) => e.id !== B(72)), detail.text.slice(0, 200));
  const tlist = await call('the template list', S.handleSalesTemplates(at('GET', '/sales/templates'), siteA, studioA, cors));
  ok('the template list is Juniper\'s templates only', tlist.status === 200 && tlist.body.data.length === 1 && tlist.body.data[0].id === TPL_A, tlist.text.slice(0, 200));

  // Juniper writes its own records: every one lands on Juniper's site, whatever the body says
  await call('a deal', S.handleSalesDeals(at('POST', '/sales/deals', { title: 'Planted deal', site_id: SITE_B }), siteA, studioA, cors));
  await call('a proposal', S.handleSalesProposalCreate(at('POST', `/sales/deals/${DEAL_A}/proposals`, { line_items: LINES, site_id: SITE_B }), siteA, studioA, DEAL_A, cors));
  await call('an activity', S.handleSalesDealActivity(at('POST', `/sales/deals/${DEAL_A}/activity`, { kind: 'call', body: 'Talked about the menu', site_id: SITE_B }), siteA, studioA, DEAL_A, cors));
  await call('a template', S.handleSalesTemplates(at('POST', '/sales/templates', { kind: 'proposal', name: 'Quick quote', line_items: LINES, site_id: SITE_B }), siteA, studioA, cors));
  await call('the services', S.handleSalesServices(at('PUT', '/sales/services', { services: [{ name: 'Logo refresh', price_cents: 60000 }], site_id: SITE_B }), siteA, studioA, cors));
  const fresh = Object.entries(had).flatMap(([t, old]) => (db.tables[t] || []).filter((r) => !old.has(r.id)).map((r) => [t, r]));
  const tablesWritten = new Set(fresh.map(([t]) => t));
  ok('every row Juniper wrote carries Juniper\'s site, even when the body named Cobalt\'s (deals, contacts, proposals, agreements, events, templates)',
    ['presence_deals', 'presence_contacts', 'presence_proposals', 'presence_contracts', 'presence_deal_events', 'presence_sales_templates'].every((t) => tablesWritten.has(t)) && fresh.every(([, r]) => r.site_id === SITE_A),
    JSON.stringify(fresh.filter(([, r]) => r.site_id !== SITE_A).map(([t, r]) => [t, r.id, r.site_id])) + ' tables: ' + [...tablesWritten].join(','));

  const leaked = seen.map(([label, r]) => [label, leaks(r.text)]).filter(([, l]) => l.length);
  ok('none of those answers carried anything of Cobalt\'s', leaked.length === 0, JSON.stringify(leaked));
  ok('and Cobalt\'s rows, in every table, are exactly as they were', theirs() === before);
  ok('nothing was emailed and no sign-in was made for any of it', outside.filter((o) => o.to === 'mail' || o.to === 'auth').length === 0, JSON.stringify(outside));
}

// ═══ 2. The public links: signed, read in the link's own studio, rate limited per IP ═══
{
  // the token itself
  const exp = nowSec() + 600;
  const t = await sign({ t: 'proposal', id: PROP_A, site_id: SITE_A, exp });
  const v = await verify(t);
  ok('a link signed here opens, and says which document, which studio and until when', !!v && v.t === 'proposal' && v.id === PROP_A && v.site_id === SITE_A && v.exp === exp, JSON.stringify(v));
  const [, mac] = t.split('.');
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const forged = await Promise.all([
    { t: 'proposal', id: PROP_A, site_id: SITE_B, exp: nowSec() + 600 },
    { t: 'proposal', id: PROP_A2, site_id: SITE_A, exp: nowSec() + 600 },
    { t: 'flow', id: PROP_A, site_id: SITE_A, exp: nowSec() + 600 },
    { t: 'proposal', id: PROP_A, site_id: SITE_A, exp: nowSec() + 99999 },
  ].map((p) => verify(`${b64(p)}.${mac}`)));
  ok('a link whose studio, document, kind or expiry was changed after signing does not open', forged.every((x) => x === null));
  const otherSecret = await S.signSalesToken({ t: 'proposal', id: PROP_A, site_id: SITE_A, exp: nowSec() + 600 }, 'another-secret');
  ok('neither does one signed with another secret, nor a cut or padded one', (await verify(otherSecret)) === null && (await verify(t.split('.')[0])) === null && (await verify(`${t}.x`)) === null && (await verify('')) === null);
  ok('an expired link does not open', (await verify(await sign({ t: 'proposal', id: PROP_A, site_id: SITE_A, exp: nowSec() - 1 }))) === null);
  const odd = await Promise.all([
    sign({ t: 'doc', id: PROP_A, site_id: SITE_A }), sign({ t: 'admin', id: PROP_A, site_id: SITE_A }),
    sign({ t: 'proposal', id: 'not-a-uuid', site_id: SITE_A }), sign({ t: 'proposal', id: PROP_A, site_id: 'nobody' }),
    S.signSalesToken({ t: 'proposal', id: PROP_A, site_id: SITE_A, exp: String(nowSec() + 600) }, SECRET),
  ]);
  ok('a signed link of an unknown kind, with a broken id or studio, or an expiry that is not a number, does not open', (await Promise.all(odd.map(verify))).every((x) => x === null));
  const kinds = await Promise.all(['proposal', 'contract', 'flow', 'estimate'].map(async (k) => (await verify(await sign({ t: k, id: PROP_A, site_id: SITE_A })))?.t));
  ok('the kinds that open are proposal, contract, flow and estimate', JSON.stringify(kinds) === JSON.stringify(['proposal', 'contract', 'flow', 'estimate']), JSON.stringify(kinds));

  const sent = (t) => {
    t.presence_deals.find((d) => d.id === DEAL_A).stage = 'proposal';
    t.presence_proposals = [proposal(PROP_A, SITE_A, DEAL_A, 'sent'), proposal(PROP_B, SITE_B, DEAL_B, 'sent')];
    t.presence_contracts = [agreement(CON_A, SITE_A, DEAL_A, 'sent'), agreement(CON_B, SITE_B, DEAL_B, 'sent')];
  };
  const decide = (pid, body, ip = IP) => res(S.handleSalesProposalDecide(req('POST', `/sales/proposals/${pid}/decide`, body, { 'x-forwarded-for': ip }), pid, cors));
  const signIt = (cid, body, ip = IP) => res(S.handleSalesContractSign(req('POST', `/sales/contracts/${cid}/sign`, body, { 'x-forwarded-for': ip }), cid, cors));
  const view = (tok, ip = IP) => res(S.handleSalesPublicView(req('GET', `/sales/view/${tok}`, undefined, { 'x-forwarded-for': ip }), tok, cors));
  const signer = { presented_hash: HASH, signer_name: 'Riley Park', signer_email: 'riley@example.org' };

  // deciding a proposal
  world(sent);
  const before = theirs();
  const noTok = await decide(PROP_A, { decision: 'accepted' });
  const junk = await decide(PROP_A, { decision: 'accepted', token: 'not.a-token' });
  const old = await decide(PROP_A, { decision: 'accepted', token: await sign({ t: 'proposal', id: PROP_A, site_id: SITE_A, exp: nowSec() - 5 }) });
  ok('deciding a proposal with no link, a made-up one or an expired one is a 403, and the proposal stays sent', [noTok, junk, old].every((r) => r.status === 403 && r.body?.error === 'invalid_link') && row('presence_proposals', PROP_A).status === 'sent', [noTok, junk, old].map((r) => r.status).join(','));
  const elsewhere = await decide(PROP_A, { decision: 'accepted', token: await sign({ t: 'proposal', id: PROP_A, site_id: SITE_B }) });
  const theirsTok = await decide(PROP_B, { decision: 'declined', token: await sign({ t: 'proposal', id: PROP_B, site_id: SITE_A }) });
  ok('a link is read in its own studio only: Juniper\'s proposal under a Cobalt-signed link, and Cobalt\'s under a Juniper-signed one, are 404s', elsewhere.status === 404 && theirsTok.status === 404 && row('presence_proposals', PROP_A).status === 'sent' && row('presence_proposals', PROP_B).status === 'sent', `${elsewhere.status} ${theirsTok.status}`);
  const yes = await decide(PROP_A, { decision: 'accepted', token: await sign({ t: 'proposal', id: PROP_A, site_id: SITE_A }) });
  ok('the proposal\'s own link decides it', yes.status === 200 && yes.body?.data?.status === 'accepted' && row('presence_proposals', PROP_A).status === 'accepted' && !!row('presence_proposals', PROP_A).decided_at, yes.text);
  ok('Cobalt\'s rows did not move', theirs() === before);

  // signing an agreement
  world(sent);
  const sNo = await signIt(CON_A, { ...signer });
  const sJunk = await signIt(CON_A, { ...signer, token: 'x.y' });
  const sElse = await signIt(CON_A, { ...signer, token: await sign({ t: 'contract', id: CON_A, site_id: SITE_B }) });
  const sTheirs = await signIt(CON_B, { ...signer, token: await sign({ t: 'contract', id: CON_B, site_id: SITE_A }) });
  ok('signing with no link or a made-up one is a 403; a link from the other studio is a 404; nothing is signed', sNo.status === 403 && sJunk.status === 403 && sElse.status === 404 && sTheirs.status === 404 && row('presence_contracts', CON_A).status === 'sent' && row('presence_contracts', CON_B).status === 'sent', [sNo, sJunk, sElse, sTheirs].map((r) => r.status).join(','));
  const sOk = await signIt(CON_A, { ...signer, token: await sign({ t: 'contract', id: CON_A, site_id: SITE_A }) });
  ok('the agreement\'s own link signs it, with the signer\'s name and email', sOk.status === 200 && row('presence_contracts', CON_A).status === 'signed' && row('presence_contracts', CON_A).signer_name === 'Riley Park' && row('presence_contracts', CON_A).signer_email === 'riley@example.org', sOk.text);

  // the page a link opens
  world(sent);
  const vJunk = await view('garbage');
  const vElse = await view(await sign({ t: 'proposal', id: PROP_A, site_id: SITE_B }));
  const vP = await view(await sign({ t: 'proposal', id: PROP_A, site_id: SITE_A }));
  const vC = await view(await sign({ t: 'contract', id: CON_A, site_id: SITE_A }));
  ok('the page opens only from a good link: a made-up one is a 403, one from the other studio a 404', vJunk.status === 403 && vElse.status === 404, `${vJunk.status} ${vElse.status}`);
  ok('a good link shows that proposal, or that agreement with the fingerprint the signature must present', vP.status === 200 && vP.body?.data?.kind === 'proposal' && vP.body.data.id === PROP_A && vC.status === 200 && vC.body?.data?.kind === 'contract' && vC.body.data.content_hash === HASH, `${vP.text.slice(0, 120)} ${vC.text.slice(0, 120)}`);

  // the per-IP limit
  world(sent);
  knob.refuseBucket = (b) => b.endsWith(':203.0.113.9');
  const NOISY = '203.0.113.9';
  const docTok = (await res(await S.handleSalesDocumentLink(siteA, 'proposal', PROP_A, cors))).body?.url?.split('t=')[1] || '';
  const limited = [
    await decide(PROP_A, { decision: 'accepted', token: await sign({ t: 'proposal', id: PROP_A, site_id: SITE_A }) }, NOISY),
    await signIt(CON_A, { ...signer, token: await sign({ t: 'contract', id: CON_A, site_id: SITE_A }) }, NOISY),
    await view(await sign({ t: 'proposal', id: PROP_A, site_id: SITE_A }), NOISY),
    await res(S.handleSalesDocument(req('GET', `/sales/doc/${docTok}`, undefined, { 'x-forwarded-for': NOISY }), decodeURIComponent(docTok), cors)),
  ];
  ok('an address over the limit gets a 429 from decide, sign, the page and the document, and nothing moves', limited.every((r) => r.status === 429) && row('presence_proposals', PROP_A).status === 'sent' && row('presence_contracts', CON_A).status === 'sent' && !row('presence_proposals', PROP_A).first_viewed_at, limited.map((r) => r.status).join(','));
  const calm = [
    await view(await sign({ t: 'proposal', id: PROP_A, site_id: SITE_A })),
    await decide(PROP_A, { decision: 'accepted', token: await sign({ t: 'proposal', id: PROP_A, site_id: SITE_A }) }),
    await signIt(CON_A, { ...signer, token: await sign({ t: 'contract', id: CON_A, site_id: SITE_A }) }),
  ];
  ok('the limit is per address: another address is answered as usual at the same moment', calm.every((r) => r.status === 200), calm.map((r) => r.status).join(','));
}

// ═══ 3. The one link (flow) ═══
{
  // every send hands out the deal's one link
  world();
  const pSend = await res(await S.handleSalesProposalSend(req('POST', `/sales/proposals/${PROP_A}/send`, {}), siteA, studioA, PROP_A, cors));
  const pTok = await flowOf(pSend.body?.url);
  ok('sending the proposal hands back <SITE_URL>/sign.html with a flow link for the DEAL (not the proposal) in this studio', pSend.status === 200 && pSend.body.url.startsWith('https://app.example.com/sign.html?t=') && pTok?.t === 'flow' && pTok.id === DEAL_A && pTok.site_id === SITE_A, pSend.text.slice(0, 200));
  ok('…good for 30 days', pTok && Math.abs(pTok.exp - (nowSec() + 30 * 86400)) < 120, JSON.stringify(pTok));
  const pMail = mailTo('riley@example.org');
  ok('…and the email to the client carries that same link', pMail.length === 1 && pMail[0].body.html.includes(pSend.body.url), pMail.map((m) => m.body.subject).join(' | '));
  const cSend = await res(await S.handleSalesContractSend(req('POST', `/sales/contracts/${CON_A}/send`, {}), siteA, studioA, CON_A, cors));
  const cTok = await flowOf(cSend.body?.url);
  ok('sending the agreement hands out the same deal link (flow, this deal, this studio)', cSend.status === 200 && cTok?.t === 'flow' && cTok.id === DEAL_A && cTok.site_id === SITE_A && mailTo('riley@example.org').length === 2 && mailTo('riley@example.org')[1].body.html.includes(cSend.body.url), cSend.text.slice(0, 200));
  const clientMail = mailTo('riley@example.org').map((m) => m.body.html);
  world();
  const dSend = await res(await S.handleSalesDealSend(req('POST', `/sales/deals/${DEAL_A}/send`, {}), siteA, studioA, DEAL_A, cors));
  const dTok = await flowOf(dSend.body?.url);
  ok('sending both at once hands out the same deal link, in ONE email', dSend.status === 200 && dSend.body.sent.proposal && dSend.body.sent.contract && dTok?.t === 'flow' && dTok.id === DEAL_A && mailTo('riley@example.org').length === 1 && mailTo('riley@example.org')[0].body.html.includes(dSend.body.url), dSend.text.slice(0, 200));
  clientMail.push(...mailTo('riley@example.org').map((m) => m.body.html));
  const linksSent = clientMail.flatMap((h) => [...h.matchAll(/\/sign\.html\?t=([^"&\s<]+)/g)].map((m) => m[1]));
  const kindsSent = await Promise.all(linksSent.map(async (x) => { const v = await verify(decodeURIComponent(x)); return v ? `${v.t}:${v.id === DEAL_A}` : 'invalid'; }));
  ok('every link in those emails is the deal\'s one flow link, never a link to a single document', linksSent.length >= 3 && kindsSent.every((k) => k === 'flow:true'), JSON.stringify(kindsSent));
  // no signing secret: nothing to hand out
  world();
  const saved = Deno.env.get('APPROVAL_SECRET');
  Deno.env.delete('APPROVAL_SECRET');
  const bare = await res(await S.handleSalesProposalSend(req('POST', `/sales/proposals/${PROP_A}/send`, {}), siteA, studioA, PROP_A, cors));
  Deno.env.set('APPROVAL_SECRET', saved);
  ok('with no signing secret configured the send still happens, with no link and no email (never an unsigned link)', bare.status === 200 && bare.body.url === null && bare.body.emailed === false && row('presence_proposals', PROP_A).status === 'sent' && mailTo('riley@example.org').length === 0, bare.text.slice(0, 200));
  // the reminder a few days later
  world((t) => { t.presence_contracts = [agreement(CON_A, SITE_A, DEAL_A, 'sent', { sent_at: ago(4) })]; t.presence_proposals = []; });
  await LC.runSalesDocReminders(10);
  await settle(() => mailTo('riley@example.org').length > 0);
  const remind = mailTo('riley@example.org')[0];
  const rTok = remind ? await flowOf(remind.body.html) : null;
  ok('the reminder for an agreement left unsigned carries the same deal link', rTok?.t === 'flow' && rTok.id === DEAL_A && rTok.site_id === SITE_A, remind ? remind.body.html.slice(0, 200) : 'no reminder mail');

  // which links reach which document
  const decided = (t) => {
    t.presence_deals.find((d) => d.id === DEAL_A).stage = 'proposal';
    t.presence_proposals = [proposal(PROP_A, SITE_A, DEAL_A, 'sent')];
    t.presence_contracts = [agreement(CON_A, SITE_A, DEAL_A, 'sent')];
  };
  const decideWith = async (tok) => { world(decided); return res(S.handleSalesProposalDecide(req('POST', `/sales/proposals/${PROP_A}/decide`, { decision: 'accepted', token: tok }), PROP_A, cors)); };
  const okFlow = await decideWith(await sign({ t: 'flow', id: DEAL_A, site_id: SITE_A }));
  ok('a flow link for the proposal\'s deal decides it', okFlow.status === 200 && row('presence_proposals', PROP_A).status === 'accepted', okFlow.text);
  const refusedDecide = [
    await decideWith(await sign({ t: 'flow', id: DEAL_A2, site_id: SITE_A })),
    await decideWith(await sign({ t: 'proposal', id: PROP_A2, site_id: SITE_A })),
    await decideWith(await sign({ t: 'contract', id: PROP_A, site_id: SITE_A })),
    await decideWith(await sign({ t: 'estimate', id: PROP_A, site_id: SITE_A })),
  ];
  ok('a flow link for another deal, a proposal link for another proposal, an agreement or estimate link: 403, still undecided', refusedDecide.every((r) => r.status === 403 && r.body?.error === 'invalid_link') && row('presence_proposals', PROP_A).status === 'sent', refusedDecide.map((r) => r.status).join(','));
  const accepted = (t) => { decided(t); t.presence_proposals[0].status = 'accepted'; };
  const signWith = async (tok, edit = accepted) => { world(edit); return res(S.handleSalesContractSign(req('POST', `/sales/contracts/${CON_A}/sign`, { token: tok, presented_hash: HASH, signer_name: 'Riley Park', signer_email: 'riley@example.org' }), CON_A, cors)); };
  const sFlow = await signWith(await sign({ t: 'flow', id: DEAL_A, site_id: SITE_A }));
  ok('a flow link for the agreement\'s deal signs it', sFlow.status === 200 && row('presence_contracts', CON_A).status === 'signed', sFlow.text);
  const refusedSign = [
    await signWith(await sign({ t: 'flow', id: DEAL_A2, site_id: SITE_A })),
    await signWith(await sign({ t: 'contract', id: A(49), site_id: SITE_A })),
    await signWith(await sign({ t: 'proposal', id: CON_A, site_id: SITE_A })),
  ];
  ok('a flow link for another deal, an agreement link for another agreement, a proposal link: 403, still unsigned', refusedSign.every((r) => r.status === 403 && r.body?.error === 'invalid_link') && row('presence_contracts', CON_A).status === 'sent', refusedSign.map((r) => r.status).join(','));

  // the agreement unlocks only once the proposal is accepted
  const flow = await sign({ t: 'flow', id: DEAL_A, site_id: SITE_A });
  const order = [
    ['sent, not yet accepted', decided],
    ['declined', (t) => { decided(t); t.presence_proposals[0].status = 'declined'; }],
    ['between versions (v1 replaced, v2 still a draft)', (t) => { decided(t); t.presence_proposals = [proposal(PROP_A, SITE_A, DEAL_A, 'sent', { line_items: L.packLineItems(LINES, { superseded_by: PROP_A2 }) }), proposal(PROP_A2, SITE_A, DEAL_A, 'draft', { version: 2, created_at: ago(1), line_items: L.packLineItems(LINES, { revised_from: PROP_A }) })]; }],
  ];
  const locked = [];
  for (const [label, edit] of order) { const r = await signWith(flow, edit); locked.push([label, r.status, r.body?.error, row('presence_contracts', CON_A).status]); }
  ok('with the flow link, signing while the proposal is sent-not-accepted, declined, or between versions is a 409 accept_first and nothing is signed', locked.every(([, s, e, st]) => s === 409 && e === 'accept_first' && st === 'sent'), JSON.stringify(locked));
  const noProposal = await signWith(flow, (t) => { decided(t); t.presence_proposals = []; });
  ok('a deal that never had a proposal signs straight away', noProposal.status === 200 && row('presence_contracts', CON_A).status === 'signed', noProposal.text);
  const ownLink = await signWith(await sign({ t: 'contract', id: CON_A, site_id: SITE_A }), decided);
  ok('the agreement\'s own link (sent on its own) is not held to that order', ownLink.status === 200 && row('presence_contracts', CON_A).status === 'signed', ownLink.text);

  // the client's page
  const page = async (edit, tok = flow) => { world(edit); return res(S.handleSalesPublicView(req('GET', `/sales/view/${tok}`), tok, cors)); };
  const drafts = await page(() => {});
  ok('the page shows the deal, and never a draft: no proposal yet, and the agreement only as "being prepared"', drafts.status === 200 && drafts.body.data.kind === 'flow' && drafts.body.data.deal.id === DEAL_A && drafts.body.data.proposal === null && drafts.body.data.proposal_pending === false && drafts.body.data.contract === null && drafts.body.data.contract_pending === true, drafts.text.slice(0, 300));
  const newerDraft = await page((t) => { decided(t); t.presence_proposals.push(proposal(PROP_A2, SITE_A, DEAL_A, 'draft', { title: 'Unsent rethink', created_at: ago(0.5) })); });
  ok('a newer draft never takes the sent proposal\'s place on the page', newerDraft.body?.data?.proposal?.id === PROP_A && !newerDraft.text.includes('Unsent rethink'), newerDraft.text.slice(0, 200));
  ok('until the proposal is accepted the agreement is shown locked, without its text or fingerprint', newerDraft.body?.data?.contract?.locked === true && newerDraft.body.data.contract.body === undefined && newerDraft.body.data.contract.content_hash === undefined, JSON.stringify(newerDraft.body?.data?.contract));
  const open = await page(accepted);
  ok('once accepted, the agreement\'s text and fingerprint are on the page', open.body?.data?.contract?.body === AGREEMENT && open.body.data.contract.content_hash === HASH && !open.body.data.contract.locked, JSON.stringify(open.body?.data?.contract).slice(0, 200));
  const between = await page(order[2][1]);
  ok('between versions the page says the proposal is being updated (pending), never "no proposal"', between.body?.data?.proposal === null && between.body.data.proposal_pending === true && between.body.data.contract?.locked === true, between.text.slice(0, 200));
  const otherStudio = await page(decided, await sign({ t: 'flow', id: DEAL_A, site_id: SITE_B }));
  const gone = await page((t) => { decided(t); t.presence_deals.find((d) => d.id === DEAL_A).deleted_at = ago(1); });
  ok('the page is a 404 when the link\'s studio is not the deal\'s, or the deal was deleted', otherStudio.status === 404 && gone.status === 404, `${otherStudio.status} ${gone.status}`);
}

// ═══ 4. Once only, and the guards that hold when something lands in between ═══
{
  world((t) => { t.presence_proposals = [proposal(PROP_A, SITE_A, DEAL_A, 'draft')]; t.presence_contracts = []; });
  const send = () => res(S.handleSalesProposalSend(req('POST', `/sales/proposals/${PROP_A}/send`, {}), siteA, studioA, PROP_A, cors));
  const first = await send(), second = await send();
  const sentEvents = db.tables.presence_deal_events.filter((e) => e.kind === 'proposal_sent');
  ok('sending a proposal twice: the second answers already_sent with the same link, and nothing is sent again', first.status === 200 && second.status === 200 && second.body.already_sent === true && (await flowOf(second.body.url))?.id === DEAL_A && sentEvents.length === 1 && mailTo('riley@example.org').length === 1, `${second.text.slice(0, 160)} events=${sentEvents.length} mails=${mailTo('riley@example.org').length}`);
  world();
  const both = () => res(S.handleSalesDealSend(req('POST', `/sales/deals/${DEAL_A}/send`, {}), siteA, studioA, DEAL_A, cors));
  await both(); const again = await both();
  ok('sending the deal twice: the second sends nothing and emails nobody', again.status === 200 && again.body.already_sent === true && again.body.emailed === false && mailTo('riley@example.org').length === 1, again.text.slice(0, 160));

  const out = (t) => { t.presence_deals.find((d) => d.id === DEAL_A).stage = 'proposal'; t.presence_proposals = [proposal(PROP_A, SITE_A, DEAL_A, 'sent')]; t.presence_contracts = [agreement(CON_A, SITE_A, DEAL_A, 'sent')]; };
  world(out);
  const pTok = await sign({ t: 'proposal', id: PROP_A, site_id: SITE_A });
  const d1 = await res(S.handleSalesProposalDecide(req('POST', `/sales/proposals/${PROP_A}/decide`, { decision: 'accepted', token: pTok }), PROP_A, cors));
  const d2 = await res(S.handleSalesProposalDecide(req('POST', `/sales/proposals/${PROP_A}/decide`, { decision: 'accepted', token: pTok }), PROP_A, cors));
  ok('accepting twice: the second answers already, with one decision on the record', d1.status === 200 && d2.status === 200 && d2.body.already === true && db.tables.presence_deal_events.filter((e) => e.kind === 'proposal_decided').length === 1, d2.text);
  const cTok = await sign({ t: 'contract', id: CON_A, site_id: SITE_A });
  const signNow = (extra = {}) => res(S.handleSalesContractSign(req('POST', `/sales/contracts/${CON_A}/sign`, { token: cTok, presented_hash: HASH, signer_name: 'Riley Park', signer_email: 'riley@example.org', ...extra }), CON_A, cors));
  const s1 = await signNow(), s2 = await signNow();
  ok('signing twice: the second answers already, with one signature and one signed copy', s1.status === 200 && s2.status === 200 && s2.body.already === true && db.tables.presence_deal_events.filter((e) => e.kind === 'contract_signed').length === 1 && mailTo('riley@example.org').filter((m) => /signed copy/i.test(m.body.subject)).length === 1, s2.text);

  // the version a client signs is the version they read
  world(out);
  const stale = await signNow({ presented_hash: 'f'.repeat(64) });
  ok('signing with the fingerprint of another version is a 409 version_mismatch, nothing signed', stale.status === 409 && stale.body.error === 'version_mismatch' && row('presence_contracts', CON_A).status === 'sent', stale.text);
  world(out);
  knob.before = ({ method, path, body }) => { if (method === 'PATCH' && path.startsWith('/rest/v1/presence_contracts?') && body?.status === 'signed') row('presence_contracts', CON_A).content_hash = 'e'.repeat(64); };
  const edited = await signNow();
  ok('an edit landing between the read and the signature wins: 409, the agreement is not signed and nobody is told it was', edited.status === 409 && row('presence_contracts', CON_A).status === 'sent' && !row('presence_contracts', CON_A).signer_name && !db.tables.presence_deal_events.some((e) => e.kind === 'contract_signed') && mailTo('riley@example.org').length === 0, edited.text);

  // a stage move never overwrites one that landed first
  world();
  knob.before = ({ method, path, body }) => { if (method === 'PATCH' && path.startsWith('/rest/v1/presence_deals?') && body?.stage === 'qualified') row('presence_deals', DEAL_A).stage = 'lost'; };
  const raced = await res(await S.handleSalesDealStage(req('POST', `/sales/deals/${DEAL_A}/stage`, { to: 'qualified' }), siteA, studioA, DEAL_A, cors));
  ok('a move landing between the read and the write wins: 409, the deal keeps it, and no stage change is recorded', raced.status === 409 && row('presence_deals', DEAL_A).stage === 'lost' && !(db.tables.presence_deal_events || []).some((e) => e.kind === 'stage_change' && e.deal_id === DEAL_A), raced.text);
}

// ═══ 5. Deals: the close date, the value, the ladder and its events, the contact ═══
{
  world();
  const make = (b) => res(S.handleSalesDeals(req('POST', '/sales/deals', b), siteA, studioA, cors));
  const patch = (b, did = DEAL_A) => res(S.handleSalesDeal(req('PATCH', `/sales/deals/${did}`, b), siteA, studioA, did, cors));
  const dealsBefore = db.tables.presence_deals.length;
  const badDate = await make({ title: 'Spring menu', expected_close: 'next friday' });
  ok('a close date that is not YYYY-MM-DD is a 422 (never a 502), and no deal is made', badDate.status === 422 && badDate.body.error === 'validation' && db.tables.presence_deals.length === dealsBefore, badDate.text);
  const good = await make({ title: 'Spring menu', expected_close: '2026-12-01', expected_value_cents: 250000 });
  ok('a real date is kept', good.status === 201 && row('presence_deals', good.body.data.id).expected_close === '2026-12-01', good.text);
  const pBad = await patch({ expected_close: 'soon' });
  const pClear = await patch({ expected_close: '' });
  ok('…the same on an edit: a bad date is a 422 and changes nothing, an empty one clears it', pBad.status === 422 && pClear.status === 200 && row('presence_deals', DEAL_A).expected_close === null, `${pBad.status} ${pClear.status}`);
  const huge = await make({ title: 'Huge', expected_value_cents: 5e12 });
  const neg = await make({ title: 'Negative', expected_value_cents: -500 });
  const junk = await make({ title: 'Words', expected_value_cents: 'lots' });
  ok('a deal\'s value is held between $0 and $1,000,000 (and a non-number is 0)', row('presence_deals', huge.body.data.id).expected_value_cents === 100000000 && row('presence_deals', neg.body.data.id).expected_value_cents === 0 && row('presence_deals', junk.body.data.id).expected_value_cents === 0);
  await patch({ expected_value_cents: 9e15 });
  const v1 = row('presence_deals', DEAL_A).expected_value_cents;
  await patch({ expected_value_cents: -1 });
  ok('…on an edit too', v1 === 100000000 && row('presence_deals', DEAL_A).expected_value_cents === 0, String(v1));

  // the ladder
  world();
  const move = async (to, did = DEAL_A, extra = {}) => res(S.handleSalesDealStage(req('POST', `/sales/deals/${did}/stage`, { to, ...extra }), siteA, studioA, did, cors));
  const jump = await move('contract');
  const won = await move('won');
  const bogus = await move('archived');
  ok('a lead can\'t jump to Agreement out or to Won (Won comes from convert), and an unknown stage is refused', jump.status === 409 && jump.body.error === 'invalid_transition' && won.status === 409 && bogus.status === 422 && row('presence_deals', DEAL_A).stage === 'lead', `${jump.status} ${won.status} ${bogus.status}`);
  const step = await move('qualified');
  const back = await move('lead');
  const lost = await move('lost', DEAL_A, { reason: 'Went with a friend' });
  const reopen = await move('lead');
  const moves = db.tables.presence_deal_events.filter((e) => e.kind === 'stage_change' && e.deal_id === DEAL_A).map((e) => `${e.from_stage}>${e.to_stage}`);
  ok('one step forward, one back, Not a fit and reopening each move the deal and are recorded once', [step, back, lost, reopen].every((r) => r.status === 200) && JSON.stringify(moves) === JSON.stringify(['lead>qualified', 'qualified>lead', 'lead>lost', 'lost>lead']), JSON.stringify(moves));
  const same = await move('lead');
  ok('moving to where it already is changes nothing and records nothing', same.status === 200 && db.tables.presence_deal_events.filter((e) => e.kind === 'stage_change').length === 4);
  // the whole ladder, pair by pair: tests/e2e/sales-routes-212.spec.ts checks the board and
  // the deal page offer exactly these moves
  const LADDER = { lead: ['qualified', 'lost'], qualified: ['proposal', 'lead', 'lost'], proposal: ['contract', 'qualified', 'lost'], contract: ['proposal', 'lost'], won: [], lost: ['lead'] };
  const wrongPairs = [];
  for (const from of Object.keys(LADDER)) for (const to of Object.keys(LADDER)) {
    if (from === to) continue;
    world((t) => { t.presence_deals.find((d) => d.id === DEAL_A).stage = from; });
    const r = await move(to);
    const fine = LADDER[from].includes(to) ? r.status === 200 && row('presence_deals', DEAL_A).stage === to : r.status === 409 && row('presence_deals', DEAL_A).stage === from;
    if (!fine) wrongPairs.push(`${from}>${to}: ${r.status}`);
  }
  ok('the ladder, pair by pair: one step on or back, Not a fit from any open stage and back to New lead only, Won never by hand (30 pairs)', wrongPairs.length === 0, wrongPairs.join(' | '));

  // the stage moves itself when the client acts, and says so once per real move
  world((t) => { t.presence_contracts = [agreement(CON_A, SITE_A, DEAL_A, 'draft')]; });
  const flowTok = await sign({ t: 'flow', id: DEAL_A, site_id: SITE_A });
  await S.handleSalesDealSend(req('POST', `/sales/deals/${DEAL_A}/send`, {}), siteA, studioA, DEAL_A, cors);
  const afterSend = row('presence_deals', DEAL_A).stage;
  await S.handleSalesProposalDecide(req('POST', `/sales/proposals/${PROP_A}/decide`, { decision: 'accepted', token: flowTok }), PROP_A, cors);
  const afterAccept = row('presence_deals', DEAL_A).stage;
  await S.handleSalesContractSign(req('POST', `/sales/contracts/${CON_A}/sign`, { token: flowTok, presented_hash: HASH, signer_name: 'Riley Park', signer_email: 'riley@example.org' }), CON_A, cors);
  const afterSign = row('presence_deals', DEAL_A).stage;
  const auto = db.tables.presence_deal_events.filter((e) => e.kind === 'stage_change').map((e) => e.to_stage);
  ok('sending, accepting and signing move the deal to Proposal sent, Agreement out, then Won (no deposit waiting)', afterSend === 'proposal' && afterAccept === 'contract' && afterSign === 'won', `${afterSend} ${afterAccept} ${afterSign}`);
  ok('…each move recorded exactly once, and no event for a move that did not happen', JSON.stringify(auto) === JSON.stringify(['proposal', 'contract', 'won']), JSON.stringify(auto));
  world((t) => { t.presence_deals.find((d) => d.id === DEAL_A).stage = 'contract'; });
  await S.handleSalesProposalSend(req('POST', `/sales/proposals/${PROP_A}/send`, {}), siteA, studioA, PROP_A, cors);
  ok('a proposal sent on a deal already further along leaves the stage, and records no move', row('presence_deals', DEAL_A).stage === 'contract' && !db.tables.presence_deal_events.some((e) => e.kind === 'stage_change'));

  // the signature evidence keeps a hash of the signer's address, never the address
  world((t) => { t.presence_proposals = []; t.presence_contracts = [agreement(CON_A, SITE_A, DEAL_A, 'sent')]; });
  await S.handleSalesContractSign(req('POST', `/sales/contracts/${CON_A}/sign`, { token: await sign({ t: 'contract', id: CON_A, site_id: SITE_A }), presented_hash: HASH, signer_name: 'Riley Park', signer_email: 'riley@example.org' }, { 'x-forwarded-for': '203.0.113.50' }), CON_A, cors);
  const ev = row('presence_contracts', CON_A).signed_evidence || {};
  ok('the signature evidence records the fingerprint signed and a keyed hash of the signer\'s IP, not the IP itself', ev.hash === HASH && ev.ip_hash === await hmacHex(SECRET, '203.0.113.50') && !JSON.stringify(ev).includes('203.0.113.50') && typeof ev.token_exp === 'number', JSON.stringify(ev));

  // the deal's contact can be set, changed and cleared after the deal is made
  world((t) => { t.presence_deals.find((d) => d.id === DEAL_A2).contact_id = null; });
  const link = await patch({ contact_id: CT_A2 }, DEAL_A2);
  ok('a deal made with no contact gains one later', link.status === 200 && row('presence_deals', DEAL_A2).contact_id === CT_A2, link.text);
  const unknown = await patch({ contact_id: A(19) }, DEAL_A2);
  const foreign = await patch({ contact_id: CT_B }, DEAL_A2);
  ok('an unknown contact, or another studio\'s, is a 422 bad_contact and the link stays as it was', unknown.status === 422 && unknown.body.error === 'bad_contact' && foreign.status === 422 && foreign.body.error === 'bad_contact' && row('presence_deals', DEAL_A2).contact_id === CT_A2);
  const malformed = await patch({ contact_id: 'robert' }, DEAL_A2);
  ok('a malformed contact id is a 422, never a quiet unlink', malformed.status === 422 && row('presence_deals', DEAL_A2).contact_id === CT_A2, malformed.text);
  const cleared = await patch({ contact_id: null }, DEAL_A2);
  await patch({ contact_id: CT_A2 }, DEAL_A2);
  const blank = await patch({ contact_id: '' }, DEAL_A2);
  ok('an explicit null, or a blank, clears it', cleared.status === 200 && blank.status === 200 && row('presence_deals', DEAL_A2).contact_id === null);
}

// ═══ 6. Convert: a real sign-in, one claim, roll back only what it made ═══
{
  const DEAL_C = A(25), CT_C = A(15), EMAIL = 'sam@rivera-patios.example';
  const convertible = (over = {}, contactOver = {}) => (t) => {
    t.presence_contacts.push(contact(CT_C, SITE_A, 'Sam Rivera', EMAIL, 'Rivera Patios', contactOver));
    t.presence_deals.push(deal(DEAL_C, SITE_A, 'Rivera Patios website', 'contract', CT_C, { expected_value_cents: 300000, ...over }));
  };
  const asAgency = (t) => {
    t.presence_agencies = [{ id: AGENCY_A, status: 'active', name: 'Juniper Web Co.', seat_limit: 5, client_limit: 50, plan: 'agency', branding: {} }];
    t.presence_agency_members = [{ id: MEMBER_A, agency_id: AGENCY_A, user_id: USER_A, email: 'owner@juniper.example', role: 'owner', status: 'active' }];
  };
  const theirAccount = (t) => {   // Rivera Patios is already Juniper's customer, with a workspace of their own
    t.clients.push(clientRow(EXISTING, 'Rivera Patios', EMAIL));
    t.presence_sites.push(siteRow(EXISTING_SITE, EXISTING, { netlify_site_id: 'nf-existing' }));
    t.presence_entitlements.push(ent(EXISTING));
    t.presence_customer_agency = [{ customer_client_id: EXISTING, agency_site_id: SITE_A }];
  };
  const both = (...fs) => (t) => fs.forEach((f) => f(t));
  const convert = (b = {}) => res(S.handleSalesConvert(req('POST', `/sales/deals/${DEAL_C}/convert`, b), siteA, studioA, DEAL_C, cors));
  const dealC = () => row('presence_deals', DEAL_C);
  const accountByEmail = () => db.tables.clients.filter((c) => c.email === EMAIL);
  const PROVISIONING = ['clients', 'contacts', 'presence_entitlements', 'presence_sites', 'presence_identity', 'presence_brand_profile', 'presence_first_run'];
  const provisioned = () => PROVISIONING.filter((t) => wrote(t, 'POST').length);

  // a new customer
  world(both(convertible(), asAgency));
  let claimAtFirstAccount;
  knob.spy = ({ method, url }) => { if (claimAtFirstAccount === undefined && method === 'POST' && (url.pathname === '/auth/v1/admin/users' || url.pathname === '/rest/v1/clients')) claimAtFirstAccount = dealC()?.converted_at ?? null; };
  const r = await convert();
  const acct = accountByEmail()[0];
  const login = signIns.get(EMAIL);
  const site = (db.tables.presence_sites || []).find((s) => s.client_id === acct?.id);
  ok('it claims the deal before it makes any sign-in, account or workspace', typeof claimAtFirstAccount === 'string' && claimAtFirstAccount.length > 0, String(claimAtFirstAccount));
  ok('convert gives the customer a real sign-in: one for their email, tied to their new account', r.status === 200 && r.body.data.converted === true && !!login && acct && r.body.data.client_id === acct.id && (db.tables.contacts || []).some((c) => c.auth_user_id === login && c.id === acct.contact_id), r.text.slice(0, 300));
  ok('…runs the one provisioning: the plan (active), the workspace, its starter records', JSON.stringify(provisioned()) === JSON.stringify(PROVISIONING) && site && r.body.data.site_id === site.id && db.tables.presence_entitlements.some((e) => e.client_id === acct.id && e.status === 'active' && e.plan === 'presence'), JSON.stringify(provisioned()));
  ok('…stamps the deal Won with the customer and their workspace', dealC().stage === 'won' && dealC().converted_client_id === acct.id && dealC().converted_site_id === site.id);
  const invite = mailTo(EMAIL);
  const magic = outside.find((o) => o.to === 'auth' && o.path === '/auth/v1/admin/generate_link');
  ok('…and emails them a sign-in link that lands in their client portal', r.body.data.invited === true && invite.length === 1 && invite[0].body.html.includes('https://db.test/auth/v1/verify?type=invite') && magic?.redirect_to === 'https://app.example.com/portal.html', JSON.stringify(magic));
  ok('the next step is the guided start (get-started), and the portal link names the studio', r.body.data.onboarding === '/get-started.html' && r.body.data.portal_url === `https://app.example.com/portal.html?studio=${SITE_A}`, r.text.slice(0, 300));
  ok('an agency owner\'s new customer joins the agency\'s portfolio', r.body.data.managed === true && (db.tables.presence_agency_clients || []).some((x) => x.agency_id === AGENCY_A && x.site_id === site?.id && x.status === 'active'), JSON.stringify(db.tables.presence_agency_clients));
  ok('…and the delivery project is bridged to the customer, on Juniper\'s site', !!r.body.data.project_id && row('presence_projects', r.body.data.project_id)?.site_id === SITE_A && (db.tables.presence_service_links || []).some((l) => l.customer_client_id === acct.id && l.agency_site_id === SITE_A && l.deal_id === DEAL_C));
  ok('nothing about it touched Stripe (a service customer pays the studio, not a subscription)', !outside.some((o) => o.to === 'stripe') && !db.tables.presence_entitlements.some((e) => e.client_id === acct.id && (e.stripe_subscription_id || e.stripe_customer_id)));
  // again: the same customer, nothing new
  const writesBefore = writes().length, authBefore = authCreates().length;
  const twice = await convert();
  const newProvisioning = writes().slice(writesBefore).filter((c) => PROVISIONING.includes(c.url.split('?')[0].replace('/rest/v1/', '')) && c.method === 'POST');
  ok('converting again returns the same customer and workspace (idempotent), making no account, sign-in or site', twice.status === 200 && twice.body.data.idempotent === true && twice.body.data.client_id === acct.id && twice.body.data.site_id === site.id && newProvisioning.length === 0 && authCreates().length === authBefore && accountByEmail().length === 1, twice.text.slice(0, 200));
  ok('…and still hands off to get-started', twice.body.data.onboarding === '/get-started.html');

  // a solo studio: no portfolio row
  world(convertible());
  const solo = await convert();
  ok('a studio with no agency converts the same, with no portfolio row', solo.status === 200 && solo.body.data.managed === false && !(db.tables.presence_agency_clients || []).length, solo.text.slice(0, 200));

  // the invite's fallback when no one-tap link can be made
  world(convertible());
  knob.linkFails = new Set(['invite', 'magiclink']);
  const fb = await convert();
  const rec = outside.find((o) => o.to === 'auth' && o.type === 'recovery');
  ok('when no one-tap link can be made, the invite is a set-password link that lands in the client portal (?next=/client.html)', fb.status === 200 && fb.body.data.invited === true && rec?.redirect_to === 'https://app.example.com/set-password.html?next=/client.html' && mailTo(EMAIL)[0]?.body.html.includes('type=recovery'), JSON.stringify(rec));

  // the plan is picked from a short list
  const planOf = async (b) => { world(convertible()); const x = await convert(b); const cid = x.body?.data?.client_id; return [x.body?.data?.plan, db.tables.presence_entitlements.find((e) => e.client_id === cid)?.plan]; };
  const plans = [await planOf({ plan: 'cms_only' }), await planOf({ plan: 'presence_monitor' }), await planOf({ plan: 'agency' }), await planOf({ plan: 'enterprise' }), await planOf({})];
  ok('the plan can be chosen from the list (cms_only, presence_monitor), anything else is the default Presence', JSON.stringify(plans) === JSON.stringify([['cms_only', 'cms_only'], ['presence_monitor', 'presence_monitor'], ['presence', 'presence'], ['presence', 'presence'], ['presence', 'presence']]), JSON.stringify(plans));

  // an account that is already Juniper's customer is reused, never duplicated
  world(both(convertible(), theirAccount));
  const reuse = await convert();
  ok('an email that is already Juniper\'s customer reuses their account and workspace: no sign-in, no account, no second site', reuse.status === 200 && reuse.body.data.client_id === EXISTING && reuse.body.data.site_id === EXISTING_SITE && authCreates().length === 0 && wrote('clients', 'POST').length === 0 && db.tables.presence_sites.filter((s) => s.client_id === EXISTING).length === 1, reuse.text.slice(0, 200));

  // an account that is Cobalt's customer: Juniper asks, takes nothing, and lets the deal go
  world(both(convertible(), (t) => { t.clients.push(clientRow(OTHER_CLIENT, 'Rivera Patios', EMAIL)); t.presence_customer_agency = [{ customer_client_id: OTHER_CLIENT, agency_site_id: SITE_B }]; }));
  const cobaltsBefore = theirs();
  const asks = await convert();
  ok('an email that is another studio\'s customer is a 409 needs_acceptance: a request waits, nothing is provisioned, the deal is let go, and Cobalt\'s rows stay', asks.status === 409 && asks.body.error === 'needs_acceptance' && (db.tables.presence_connect_requests || []).some((q) => q.studio_site_id === SITE_A && q.email === EMAIL && q.status === 'pending') && authCreates().length === 0 && provisioned().length === 0 && dealC().converted_at === null && dealC().converted_client_id === null && theirs() === cobaltsBefore, asks.text);

  // two converts at once: the second waits; a claim left behind heals
  world(convertible({ converted_at: minutesAgo(1) }));
  const busy = await convert();
  ok('while another convert holds the deal (claimed a minute ago) it is a 409, and no sign-in, account or site is made', busy.status === 409 && busy.body.error === 'conversion_in_progress' && authCreates().length === 0 && provisioned().length === 0, busy.text);
  world(convertible({ converted_at: minutesAgo(10) }));
  const healed = await convert();
  ok('a claim left behind more than 5 minutes ago is taken over, and the convert goes through', healed.status === 200 && healed.body.data.converted === true && dealC().converted_client_id === healed.body.data.client_id, healed.text.slice(0, 200));
  // the stamp only lands on a deal no one converted meanwhile
  world(convertible());
  knob.before = ({ method, path, body }) => { if (method === 'PATCH' && path.startsWith('/rest/v1/presence_deals?') && body?.converted_client_id && !dealC().converted_client_id) dealC().converted_client_id = OTHER_CLIENT; };
  const lostRace = await convert();
  ok('when another convert finishes first, this one answers with that customer, never overwrites it, and removes the account it made', lostRace.status === 200 && lostRace.body.data.idempotent === true && lostRace.body.data.client_id === OTHER_CLIENT && dealC().converted_client_id === OTHER_CLIENT && accountByEmail().length === 0 && authDeletes().length === 1, lostRace.text.slice(0, 200));

  // a failure part way: only what this convert made is taken back, and the deal is let go
  const failProvisioning = () => db.failMethod.set('presence_entitlements', 'POST');
  world(convertible()); failProvisioning();
  const f1 = await convert();
  ok('provisioning fails for a new customer: 502, the account it made is deleted and its sign-in removed, the deal is let go', f1.status === 502 && f1.body.error === 'provision_incomplete' && accountByEmail().length === 0 && authDeletes().length === 1 && signIns.size === 0 && dealC().converted_at === null && dealC().converted_client_id === null, f1.text);
  world(both(convertible(), theirAccount)); failProvisioning();
  const f2 = await convert();
  ok('provisioning fails for a customer it reused: their account and site stay, nothing is deleted, the deal is let go', f2.status === 502 && !!row('clients', EXISTING) && !!row('presence_sites', EXISTING_SITE) && wrote('clients', 'DELETE').length === 0 && authDeletes().length === 0 && dealC().converted_at === null, f2.text);
  world(convertible()); signIns.set(EMAIL, 'existing-sign-in'); failProvisioning();
  const f3 = await convert();
  ok('a sign-in that already existed (no account yet): the account row it added is deleted, the sign-in is kept', f3.status === 502 && accountByEmail().length === 0 && wrote('clients', 'POST').length === 1 && authDeletes().length === 0 && signIns.get(EMAIL) === 'existing-sign-in' && dealC().converted_at === null, f3.text);
  world(convertible({}, { email: '' })); failProvisioning();
  const f4 = await convert();
  ok('a contact with no email (a studio-run workspace): the account row it added is deleted', f4.status === 502 && wrote('clients', 'POST').length === 1 && !db.tables.clients.some((c) => c.name === 'Rivera Patios') && dealC().converted_at === null, f4.text);
  const clash = () => { knob.before = ({ method, path, body }) => (method === 'PATCH' && path.startsWith('/rest/v1/presence_deals?') && body?.converted_client_id ? reply({ code: '23505', message: 'duplicate key value violates unique constraint "presence_deals_converted_client_uq"' }, 409) : null); };
  world(convertible()); clash();
  const f5 = await convert();
  ok('the customer is already another deal\'s (the stamp is refused): 409, the account and sign-in it made are removed, the contact unlinked, the deal let go', f5.status === 409 && f5.body.error === 'convert_conflict' && accountByEmail().length === 0 && authDeletes().length === 1 && row('presence_contacts', CT_C).client_id === null && dealC().converted_at === null, f5.text);
  world(both(convertible(), theirAccount)); clash();
  const f6 = await convert();
  ok('…and for a reused customer the same refusal deletes nothing of theirs', f6.status === 409 && !!row('clients', EXISTING) && wrote('clients', 'DELETE').length === 0 && authDeletes().length === 0 && dealC().converted_at === null, f6.text);

  // what can't be converted
  world(convertible({ stage: 'proposal' }));
  const early = await convert();
  world(convertible({ stage: 'lost' }));
  const lostDeal = await convert();
  ok('a deal not yet at Agreement out, or one marked Not a fit, is a 409 and nothing is made', early.status === 409 && early.body.error === 'not_ready' && lostDeal.status === 409 && lostDeal.body.error === 'lost' && authCreates().length === 0, `${early.status} ${lostDeal.status}`);
}

// ═══ 7. Add a customer: set up now, already set up, connect by email ═══
{
  const EMAIL = 'dana@willow-yoga.example';
  const add = (b, who = studioA, where = siteA) => res(S.handleSalesAddCustomer(req('POST', '/sales/customers', b), where, who, cors));
  const PROVISIONING = ['clients', 'contacts', 'presence_entitlements', 'presence_sites', 'presence_identity', 'presence_brand_profile', 'presence_first_run'];
  const provisioned = () => PROVISIONING.filter((t) => wrote(t, 'POST').length);
  const nothingMade = () => authCreates().length === 0 && provisioned().filter((t) => t !== 'contacts').length === 0 && !wrote('presence_projects', 'POST').length && mailTo(EMAIL).length === 0;

  world();
  const before = theirs();
  const r = await add({ name: 'Dana Wills', business_name: 'Willow Yoga', email: EMAIL });
  const acct = db.tables.clients.find((c) => c.email === EMAIL);
  const site = acct && db.tables.presence_sites.find((s) => s.client_id === acct.id);
  ok('with no mode it sets them up now: 201 created, a sign-in for their email and the one provisioning (plan, workspace, starter records)', r.status === 201 && r.body.data.created === true && signIns.has(EMAIL) && JSON.stringify(provisioned()) === JSON.stringify(PROVISIONING), r.text.slice(0, 300));
  ok('the answer names the new workspace\'s site, the one the dialog applies a starter kit to', !!site && r.body.data.site_id === site.id && r.body.data.client_id === acct.id);
  ok('the plan is active access on the default Presence plan, with no Stripe subscription and no Stripe call', db.tables.presence_entitlements.some((e) => e.client_id === acct.id && e.status === 'active' && e.plan === 'presence' && !e.stripe_subscription_id && !e.stripe_customer_id) && !outside.some((o) => o.to === 'stripe'));
  ok('the invitation goes to them once', r.body.data.invited === true && mailTo(EMAIL).length === 1);
  const proj = r.body.data.project_id && row('presence_projects', r.body.data.project_id);
  ok('they are bridged to Juniper: Juniper is their one studio, with a delivery project and a live link (no deal)', proj?.site_id === SITE_A && proj.client_id === acct.id && (db.tables.presence_customer_agency || []).some((x) => x.customer_client_id === acct.id && x.agency_site_id === SITE_A) && (db.tables.presence_service_links || []).filter((l) => l.customer_client_id === acct.id && l.agency_site_id === SITE_A && l.status === 'active' && !l.deal_id).length === 1, JSON.stringify(db.tables.presence_service_links));
  ok('the person is a contact of Juniper\'s, tied to the new customer', db.tables.presence_contacts.some((c) => c.site_id === SITE_A && c.email === EMAIL && c.client_id === acct.id));
  // the same email again
  const authBefore = authCreates().length, projectsBefore = db.tables.presence_projects.length, sitesBefore = db.tables.presence_sites.length;
  const again = await add({ name: 'Dana Wills', email: EMAIL });
  ok('adding them again: 200 already_exists, the same account and project, nothing duplicated and no second invitation', again.status === 200 && again.body.data.already_exists === true && again.body.data.created === false && again.body.data.client_id === acct.id && again.body.data.project_id === r.body.data.project_id && authCreates().length === authBefore && db.tables.presence_projects.length === projectsBefore && db.tables.presence_sites.length === sitesBefore && db.tables.clients.filter((c) => c.email === EMAIL).length === 1 && mailTo(EMAIL).length === 1, again.text.slice(0, 200));
  ok('Cobalt\'s rows did not move', theirs() === before);

  // the plan comes from the same short list as convert
  world();
  const bos = await add({ email: EMAIL, edition: 'business_os_only' });
  const bosEnt = db.tables.presence_entitlements.find((e) => e.client_id === bos.body?.data?.client_id);
  const bosHosted = outside.some((o) => o.to === 'hosting');
  world();
  const odd = await add({ email: EMAIL, edition: 'enterprise' });
  const oddEnt = db.tables.presence_entitlements.find((e) => e.client_id === odd.body?.data?.client_id);
  ok('the work type picks the plan (business_os_only is hosted elsewhere, so no hosting); a plan off the list is Presence', bosEnt?.plan === 'business_os_only' && bos.body.data.hosted === false && !bosHosted && oddEnt?.plan === 'presence', `${bosEnt?.plan} ${bos.body?.data?.hosted} ${bosHosted} ${oddEnt?.plan}`);

  // the same provisioning as convert, so the same rollback
  world(); db.failMethod.set('presence_entitlements', 'POST');
  const fails = await add({ email: EMAIL, business_name: 'Willow Yoga' });
  ok('when provisioning fails nothing is left behind: 502, no account, the sign-in removed, no invitation', fails.status === 502 && !db.tables.clients.some((c) => c.email === EMAIL) && authDeletes().length === 1 && mailTo(EMAIL).length === 0, fails.text);

  // connect by email: record them, provision nothing
  world();
  const odd2 = await add({ email: EMAIL, mode: 'whatever' });
  ok('a mode that is not "connect" is the usual set-up', odd2.status === 201 && odd2.body.data.created === true);
  world();
  const pending = await add({ name: 'Dana Wills', email: EMAIL, mode: 'connect' });
  ok('connect, no account yet: pending, not connected, and they are saved as Juniper\'s contact', pending.status === 200 && pending.body.data.pending === true && pending.body.data.connected === false && db.tables.presence_contacts.some((c) => c.site_id === SITE_A && c.email === EMAIL), pending.text.slice(0, 200));
  ok('…and nothing is provisioned: no sign-in, no account, no plan, no site, no project, no email', nothingMade(), JSON.stringify([authCreates().length, provisioned(), mailTo(EMAIL).length]));
  world((t) => {   // Dana is already Juniper's customer (Juniper is their one studio), with no project yet
    t.clients.push(clientRow(EXISTING, 'Willow Yoga', EMAIL));
    t.presence_sites.push(siteRow(EXISTING_SITE, EXISTING));
    t.presence_customer_agency = [{ customer_client_id: EXISTING, agency_site_id: SITE_A }];
  });
  const c1 = await add({ email: EMAIL, mode: 'connect' });
  ok('connect, an account that is already Juniper\'s customer: connected now and bridged, with nothing provisioned', c1.status === 200 && c1.body.data.connected === true && c1.body.data.bridged === true && c1.body.data.client_id === EXISTING && authCreates().length === 0 && wrote('clients', 'POST').length === 0 && wrote('presence_sites', 'POST').length === 0 && mailTo(EMAIL).length === 0, c1.text.slice(0, 200));
  const projects = db.tables.presence_projects.length;
  const c2 = await add({ email: EMAIL, mode: 'connect' });
  ok('connecting again reuses that link: the same project, no second one', c2.body?.data?.project_id === c1.body.data.project_id && db.tables.presence_projects.length === projects && (db.tables.presence_service_links || []).filter((l) => l.customer_client_id === EXISTING).length === 1);
  // never the studio to itself
  world();
  const self = await add({ email: 'owner@juniper.example', mode: 'connect' });
  const selfSetUp = await add({ email: 'owner@juniper.example' });
  ok('Juniper\'s own email is never bridged to Juniper, in connect mode or set-up mode', self.status === 200 && self.body.data.connected === true && self.body.data.bridged === false && selfSetUp.body?.data?.already_exists === true && !(db.tables.presence_projects || []).length && !(db.tables.presence_service_links || []).length && !(db.tables.presence_customer_agency || []).some((x) => x.customer_client_id === CLIENT_A), `${self.text.slice(0, 160)} ${selfSetUp.text.slice(0, 160)}`);
  const bad = await add({ email: 'not an email' });
  ok('an address that is not an email is a 422 and nothing is read or made', bad.status === 422 && authCreates().length === 0);
}

// ═══ 8. The services catalog: one settings row per studio, cleaned and capped ═══
{
  world();
  const put = (services, where = siteA, who = studioA) => res(S.handleSalesServices(req('PUT', '/sales/services', { services }), where, who, cors));
  const get = (where = siteA, who = studioA) => res(S.handleSalesServices(req('GET', '/sales/services'), where, who, cors));
  await put([{ name: 'Cobalt audit', price_cents: 99000 }], siteB, studioB);
  const before = theirs();
  const logFrom = db.log.length;
  const saved = await put([
    { name: 'Website build', price_cents: 320000 },
    { name: '   ', price_cents: 5000 },
    { name: 'N'.repeat(150), price_cents: -400 },
    { name: 'Retainer', price_cents: 9_999_999_999 },
    { name: 'Logo\u0007 refresh', price_cents: '60000' },
  ]);
  const want = [{ name: 'Website build', price_cents: 320000 }, { name: 'N'.repeat(120), price_cents: 0 }, { name: 'Retainer', price_cents: 100000000 }, { name: 'Logo refresh', price_cents: 60000 }];
  ok('saving keeps the named rows, trims a name to 120 characters, strips control characters and holds prices between $0 and $1,000,000', saved.status === 200 && JSON.stringify(saved.body.data) === JSON.stringify(want), saved.text.slice(0, 300));
  const read1 = await get();
  ok('reading it back gives that list', read1.status === 200 && JSON.stringify(read1.body.data) === JSON.stringify(want));
  const mine = () => db.tables.presence_sales_templates.filter((t) => t.site_id === SITE_A && S.isReservedName(t.name));
  ok('it is kept as one row in Juniper\'s own sales-templates store, under a reserved settings name, and nothing else is written', mine().length === 1 && mine()[0].kind === 'proposal' && db.log.slice(logFrom).filter((c) => c.method !== 'GET').every((c) => c.url.split('?')[0] === '/rest/v1/presence_sales_templates'), JSON.stringify(mine()));
  await put([{ name: 'Website build', price_cents: 350000 }]);
  ok('saving again updates that row, never a second one', mine().length === 1 && JSON.stringify((await get()).body.data) === JSON.stringify([{ name: 'Website build', price_cents: 350000 }]));
  ok('Juniper never reads or changes Cobalt\'s catalog, and Cobalt still reads only its own', !read1.text.includes('Cobalt audit') && theirs() === before && JSON.stringify((await get(siteB, studioB)).body.data) === JSON.stringify([{ name: 'Cobalt audit', price_cents: 99000 }]));
  const list = await res(await S.handleSalesTemplates(req('GET', '/sales/templates'), siteA, studioA, cors));
  ok('the catalog row never shows as a reusable template', list.status === 200 && list.body.data.some((t) => t.id === TPL_A) && list.body.data.every((t) => !S.isReservedName(t.name)), list.text.slice(0, 200));
  const writesBefore = writes().length;
  const tooMany = await put(Array.from({ length: 41 }, (_, i) => ({ name: `Service ${i}`, price_cents: 100 })));
  const notList = await res(await S.handleSalesServices(req('PUT', '/sales/services', { services: 'Website build' }), siteA, studioA, cors));
  ok('more than 40 services, or something that is not a list, is a 422 and nothing is written', tooMany.status === 422 && notList.status === 422 && writes().length === writesBefore, `${tooMany.status} ${notList.status}`);
  const forty = await put(Array.from({ length: 40 }, (_, i) => ({ name: `Service ${i}`, price_cents: 100 })));
  ok('forty is fine', forty.status === 200 && forty.body.data.length === 40);
}

// ═══ 9. Document links open on the studio's own site ═══
{
  world((t) => { t.presence_proposals = [proposal(PROP_A, SITE_A, DEAL_A, 'sent', { title: 'Blue Finch proposal' }), proposal(PROP_B, SITE_B, DEAL_B, 'sent')]; t.presence_contracts = [agreement(CON_A, SITE_A, DEAL_A, 'sent')]; t.presence_deals.find((d) => d.id === DEAL_A).stage = 'proposal'; });
  ok('a viewer link is <SITE_URL>/doc.html?t=<token>, the token escaped', S.docViewerUrl('a b/c') === 'https://app.example.com/doc.html?t=a%20b%2Fc');
  const link = await res(await S.handleSalesDocumentLink(siteA, 'proposal', PROP_A, cors));
  const tok = link.body?.url ? new URL(link.body.url).searchParams.get('t') : '';
  ok('the deal page\'s document link opens the viewer on the studio site, never the function address', link.status === 200 && link.body.url.startsWith('https://app.example.com/doc.html?t=') && !link.body.url.includes('/functions/v1/'), link.text.slice(0, 200));
  ok('…its PDF is the function\'s own address, only as a ?format=pdf download', link.body?.pdf_url === `https://db.test/functions/v1/presence/sales/doc/${encodeURIComponent(tok)}?format=pdf`, link.body?.pdf_url);
  const page = await res(await S.handleSalesDocument(req('GET', `/sales/doc/${tok}`), tok, cors));
  ok('the viewer\'s token opens that very document as a page (the raw render the viewer fetches still answers)', page.status === 200 && page.type.startsWith('text/html') && page.text.includes('Blue Finch proposal'), page.text.slice(0, 160));
  ok('…which asks not to be indexed', /noindex/.test(page.headers.get('X-Robots-Tag') || ''));
  const pdf = await S.handleSalesDocument(req('GET', `/sales/doc/${tok}?format=pdf`), tok, cors);
  ok('…and the PDF address answers a PDF', pdf.status === 200 && /^application\/pdf/.test(pdf.headers.get('Content-Type') || ''));
  const bad = await res(await S.handleSalesDocument(req('GET', '/sales/doc/forged'), 'forged', cors));
  ok('a made-up document link is a 403 page that says to ask for a fresh copy', bad.status === 403 && bad.type.startsWith('text/html') && /fresh copy/.test(bad.text));
  ok('another studio\'s document gets no link (Cobalt\'s sent proposal is a 404 to Juniper)', !!row('presence_proposals', PROP_B) && (await res(await S.handleSalesDocumentLink(siteA, 'proposal', PROP_B, cors))).status === 404);
  // the signed copy the client is emailed links to the viewer too
  await S.handleSalesContractSign(req('POST', `/sales/contracts/${CON_A}/sign`, { token: await sign({ t: 'contract', id: CON_A, site_id: SITE_A }), presented_hash: HASH, signer_name: 'Riley Park', signer_email: 'riley@example.org' }), CON_A, cors);
  const copy = mailTo('riley@example.org').find((m) => /signed copy/i.test(m.body.subject));
  const copyLink = copy && /https:\/\/app\.example\.com\/doc\.html\?t=([^"&\s]+)/.exec(copy.body.html);
  const reopened = copyLink ? await res(await S.handleSalesDocument(req('GET', `/sales/doc/${copyLink[1]}`), decodeURIComponent(copyLink[1]), cors)) : null;
  ok('the signed copy emailed to the client links to the viewer (never the function address), and that link opens the signed agreement', !!copyLink && !copy.body.html.includes('/functions/v1/presence/sales/doc/') && reopened?.status === 200 && reopened.text.includes('Riley Park'), copy ? copy.body.html.slice(0, 200) : 'no signed-copy mail');
  ok('…with the PDF attached', (copy?.body?.attachments || []).length === 1);
  const signedView = await res(await S.handleSalesPublicView(req('GET', '/sales/view/x'), await sign({ t: 'contract', id: CON_A, site_id: SITE_A }), cors));
  ok('the signed agreement\'s page offers its PDF from the function address, as a download only', /^https:\/\/db\.test\/functions\/v1\/presence\/sales\/doc\/[^?]+\?format=pdf$/.test(signedView.body?.data?.pdf_url || ''), signedView.body?.data?.pdf_url);
}

// ═══ 10. The router: which routes are public, and the gates in front of the rest ═══
{
  // the real index.ts, with std's serve() handed a fake listener: no socket opens
  const queue = []; let wake = null;
  Deno.listen = () => { let first = true; return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} }; };
  Deno.serveHttp = () => ({ nextRequest: () => new Promise((r) => { if (queue.length) r(queue.shift()); else wake = r; }), close() {} });
  await import('../../supabase/functions/presence/index.ts');
  const send = (request) => new Promise((resolve) => { const ev = { request, respondWith: async (r) => { resolve(await r); } }; if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev); });
  const call = async (jwt, method, route, body) => { const h = { 'Content-Type': 'application/json', 'x-forwarded-for': IP }; if (jwt) h['x-dds-user-jwt'] = jwt; return res(await send(new Request(`https://fn.test/functions/v1/presence${route}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }))); };
  const out = (t) => { t.presence_deals.find((d) => d.id === DEAL_A).stage = 'proposal'; t.presence_proposals = [proposal(PROP_A, SITE_A, DEAL_A, 'sent')]; t.presence_contracts = [agreement(CON_A, SITE_A, DEAL_A, 'sent')]; };
  const SALES = [['GET', '/sales/deals'], ['POST', '/sales/deals', { title: 'X' }], ['POST', '/sales/customers', { email: 'jo@example.com' }], ['GET', '/sales/services'], ['PUT', '/sales/services', { services: [] }],
    ['POST', `/sales/deals/${DEAL_A}/send`, {}], ['POST', `/sales/deals/${DEAL_A}/convert`, {}], ['POST', `/sales/proposals/${PROP_A}/send`, {}]];

  world(out);
  const anon = [];
  for (const [m, r, b] of SALES) anon.push([m, r, (await call(null, m, r, b)).status]);
  ok('signed out, every studio /sales route is a 401 (deals, customers, services, send, convert) and nothing is written', anon.every(([, , s]) => s === 401) && writes().length === 0, JSON.stringify(anon.filter(([, , s]) => s !== 401)));

  const p = await sign({ t: 'proposal', id: PROP_A, site_id: SITE_A }), c = await sign({ t: 'contract', id: CON_A, site_id: SITE_A });
  const pages = [await call(null, 'GET', `/sales/view/${p}`), await call(null, 'GET', `/sales/p/${p}`), await call(null, 'GET', `/sales/c/${c}`)];
  ok('the client\'s page answers signed out at /sales/view, /sales/p and /sales/c', pages.every((x) => x.status === 200) && pages[0].body.data.kind === 'proposal' && pages[2].body.data.kind === 'contract', pages.map((x) => x.status).join(','));
  const sess = await call('jwt-a', 'POST', `/sales/proposals/${PROP_A}/decide`, { decision: 'accepted' });
  ok('a signed-in session is no substitute for the link: deciding with a session but no link is a 403', sess.status === 403 && sess.body.error === 'invalid_link' && row('presence_proposals', PROP_A).status === 'sent', sess.text);
  const dec = await call(null, 'POST', `/sales/proposals/${PROP_A}/decide`, { decision: 'accepted', token: p });
  const sgn = await call(null, 'POST', `/sales/contracts/${CON_A}/sign`, { token: c, presented_hash: HASH, signer_name: 'Riley Park', signer_email: 'riley@example.org' });
  ok('signed out, the link decides the proposal and signs the agreement', dec.status === 200 && sgn.status === 200 && row('presence_proposals', PROP_A).status === 'accepted' && row('presence_contracts', CON_A).status === 'signed', `${dec.status} ${sgn.status}`);
  const doc = (await res(await S.handleSalesDocumentLink(siteA, 'contract', CON_A, cors))).body.url.split('t=')[1];
  const raw = await call(null, 'GET', `/sales/doc/${doc}`);
  ok('signed out, the raw document route still renders the page doc.html fetches', raw.status === 200 && raw.type.startsWith('text/html') && raw.text.includes('Riley Park'), raw.text.slice(0, 120));

  world(out);
  const svc = await call('jwt-a', 'PUT', '/sales/services', { services: [{ name: 'Website build', price_cents: 320000 }] });
  const svcRead = await call('jwt-a', 'GET', '/sales/services');
  ok('signed in, a studio reads and saves its services at GET and PUT /sales/services', svc.status === 200 && svcRead.status === 200 && svcRead.body.data[0]?.name === 'Website build' && db.tables.presence_sales_templates.some((t) => t.site_id === SITE_A && S.isReservedName(t.name)), `${svc.status} ${svcRead.status}`);
  const other = [await call('jwt-a', 'POST', '/sales/services', { services: [] }), await call('jwt-a', 'GET', '/sales/customers')];
  ok('those are the only methods: POST /sales/services and GET /sales/customers are 404s', other.every((x) => x.status === 404), other.map((x) => x.status).join(','));
  const added = await call('jwt-a', 'POST', '/sales/customers', { email: 'jo@parkflorist.example', business_name: 'Park Florist' });
  ok('signed in, POST /sales/customers sets a customer up for that studio', added.status === 201 && added.body.data.created === true && (db.tables.presence_service_links || []).some((l) => l.agency_site_id === SITE_A && l.customer_client_id === added.body.data.client_id), added.text.slice(0, 200));
  const sendAll = await call('jwt-a', 'POST', `/sales/deals/${DEAL_A}/send`, {});
  ok('signed in, POST /sales/deals/:id/send reaches the studio\'s deal', sendAll.status === 200 && (await flowOf(sendAll.body.url))?.id === DEAL_A, sendAll.text.slice(0, 160));
  const list = await call('jwt-a', 'GET', '/sales/deals');
  ok('the deal list read through the router is the signed-in studio\'s only', list.status === 200 && list.body.data.length > 0 && list.body.data.every((d) => row('presence_deals', d.id)?.site_id === SITE_A), list.text.slice(0, 160));
  const before = JSON.stringify(row('presence_deals', DEAL_A));
  const cross = [await call('jwt-b', 'GET', `/sales/deals/${DEAL_A}`), await call('jwt-b', 'POST', `/sales/deals/${DEAL_A}/convert`, {}), await call('jwt-b', 'POST', `/sales/deals/${DEAL_A}/stage`, { to: 'lost' })];
  ok('Cobalt\'s session meets Juniper\'s deal as a 404, and the deal does not move', cross.every((x) => x.status === 404) && JSON.stringify(row('presence_deals', DEAL_A)) === before, cross.map((x) => x.status).join(','));

  world();
  const ws = writes().length;
  const cms = [await call('jwt-cms', 'GET', '/sales/deals'), await call('jwt-cms', 'POST', '/sales/customers', { email: 'jo@example.com' }), await call('jwt-cms', 'GET', '/sales/services'), await call('jwt-cms', 'PUT', '/sales/services', { services: [] })];
  ok('a plan without the Customers area is refused at the door on every /sales route (403 feature_not_in_plan, relationship), and nothing is written', cms.every((x) => x.status === 403 && x.body?.error === 'feature_not_in_plan' && x.body.feature === 'relationship') && writes().length === ws && authCreates().length === 0, cms.map((x) => `${x.status} ${x.body?.error}`).join(','));
  const paused = [await call('jwt-paused', 'GET', '/sales/services'), await call('jwt-paused', 'PUT', '/sales/services', { services: [] }), await call('jwt-paused', 'POST', '/sales/customers', { email: 'jo@example.com' })];
  ok('a paused subscription can read but not write: GET 200, PUT and POST 403 entitlement_paused', paused[0].status === 200 && paused.slice(1).every((x) => x.status === 403 && x.body?.error === 'entitlement_paused') && writes().length === ws, paused.map((x) => x.status).join(','));
  const ended = [await call('jwt-gone', 'GET', '/sales/services'), await call('jwt-gone', 'POST', '/sales/customers', { email: 'jo@example.com' })];
  ok('an ended subscription is turned away before any /sales route (403 entitlement_inactive), with no account made', ended.every((x) => x.status === 403 && x.body?.error === 'entitlement_inactive') && authCreates().length === 0 && writes().length === ws, ended.map((x) => x.status).join(','));
  const noSite = await call('jwt-nosite', 'GET', '/sales/deals');
  ok('an account with no site is told so (404 no_site), never handed another studio\'s', noSite.status === 404 && noSite.body?.error === 'no_site', noSite.text);
}

// ═══ 11. Pins: there is no database here, so the migration's own words are the contract ═══
{
  const ROOT = new URL('../../', import.meta.url);
  const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
  const mig = read('supabase/migrations/0074_p2c_sales_lifecycle.sql');
  for (const t of ['presence_contacts', 'presence_deals', 'presence_deal_events', 'presence_proposals', 'presence_contracts']) {
    // pin: the table, its NOT NULL site_id foreign key and RLS exist only in the SQL
    ok(`migration: ${t} exists, site_id-scoped, RLS enabled`, new RegExp(`create table if not exists public\\.${t}[\\s\\S]*?site_id uuid not null references public\\.presence_sites`).test(mig) && new RegExp(`alter table public\\.${t} enable row level security`).test(mig));
  }
  // pin: the bounded stage ladder is a CHECK constraint, only in the SQL
  ok('migration: bounded stage ladder as a CHECK', /check \(stage in \('lead','qualified','proposal','contract','won','lost'\)\)/.test(mig));
  // pin: a customer converts from one deal at most: a partial unique index, only in the SQL
  ok('migration: unique index on converted_client_id (one deal per customer)', /presence_deals_converted_client_uq[\s\S]*?converted_client_id.*where converted_client_id is not null/.test(mig));
  // pin: the indexes the pipeline pages read by, only in the SQL
  ok('migration: pagination/stage indexes present', /presence_deals_site_stage_idx/.test(mig) && /presence_deals_site_recent_idx/.test(mig));
  // pin: the rollback block an operator follows by hand
  ok('migration: rollback block present', /^--   drop table if exists public\.presence_contracts;/m.test(mig));
}

// ═══ 12. PR 433 (builder item 199) rewrites this block; left as text until it lands ═══
// The sign-up hook, CONNECT_INTENT_TAG, the connect-mode chooser (cumode, cu-signup,
// cu-connect-only, cu-provision-only) and its copy, exactly as they were.
{
  const ROOT = new URL('../../', import.meta.url);
  const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
  const sales = read('supabase/functions/presence/routes/sales.ts');
  const add = sales.slice(sales.indexOf('export async function handleSalesAddCustomer'));
  ok('connect: no account → records the pending contact (ensureConnectContact, tagged) + pending:true', /ensureConnectContact\(site\.id, email, name, true\)[\s\S]*?pending: true/.test(add) && /async function ensureConnectContact/.test(sales));
  // the pending record is a presence_contacts row (site-scoped = the studio), tagged
  // with the shared marker — NO new table.
  ok('connect: pending record reuses presence_contacts (site-scoped) + the shared CONNECT_INTENT_TAG (no new table)', /export const CONNECT_INTENT_TAG =/.test(sales) && /svc\('presence_contacts', \{ method: 'POST'/.test(sales) && /notes: mark \? CONNECT_INTENT_TAG/.test(sales));

  // ── SIGNUP AUTO-CONNECT HOOK (commerce/handleSignup) ──────────────────────────
  // When a pre-listed email self-serve signs up, they auto-connect to that studio —
  // reusing the SAME bridge (bridgeCustomerToStudio → ensureBridge), best-effort.
  {
    const commerce = read('supabase/functions/presence/routes/commerce.ts');
    ok('signup-hook: commerce imports the SHARED bridge + tag from sales (no parallel bridge)', /import \{ bridgeCustomerToStudio, CONNECT_INTENT_TAG \} from '\.\/sales\.ts'/.test(commerce));
    // finds the tagged pending contact by email, resolves its site_id (= the studio)
    ok('signup-hook: resolves the pre-listing studio via the tagged presence_contacts (site_id)', /presence_contacts\?\$\{emailMatch\(email\)\}&notes=ilike\.\*\$\{needle\}\*/.test(commerce) && /CONNECT_INTENT_TAG\.replace\(/.test(commerce));
    // calls the shared bridge — never a second bridge implementation in commerce
    ok('signup-hook: bridges via the shared bridgeCustomerToStudio (single bridge path)', /bridgeCustomerToStudio\(\{ agencySiteId, clientId, customerSiteId/.test(commerce) && !/ensureBridge\(/.test(commerce) && !/presence_service_links/.test(commerce));
    // wired into handleSignup for BOTH the trial and the paid path, best-effort
    ok('signup-hook: called from handleSignup (trial + paid), best-effort (never blocks signup)', (commerce.match(/autoConnectPreListedStudio\(chain\.clientId/g) || []).length >= 2 && /async function autoConnectPreListedStudio[\s\S]*?try \{[\s\S]*?\} catch/.test(commerce));
    // masked logging (no raw email in logs)
    ok('signup-hook: logs are email-masked', /maskEmail\(email\)/.test(commerce));
  }

  // ── UI: contacts.html "Add a customer": the two-option chooser and its copy ──
  {
    const contacts = read('contacts.html');
    // TWO-OPTION chooser (owner's words): "set them up now" vs "connect by email".
    ok('ui: a two-option chooser (radiogroup) precedes the work-type field', /role="radiogroup"/.test(contacts) && /name="cumode" value="provision"/.test(contacts) && /name="cumode" value="connect"/.test(contacts) && contacts.indexOf('name="cumode"') < contacts.indexOf('id="cu-edition"'));
    ok('ui: option copy — set-up-now (default) + sign-up-themselves', /I’ll set them up now/.test(contacts) && /They’ll sign up themselves — connect by email/.test(contacts) && /value="provision" checked/.test(contacts));
    ok('ui: connect copy explains existing-vs-later auto-connect', /If they already have an account, they connect to you now\. If not, they’ll connect automatically the moment they sign up/.test(contacts));
    ok('ui: mode drives the POST body (provision vs connect) to /sales/customers', /mode:'connect',name:name\|\|undefined,email/.test(contacts) && /mode:'provision'/.test(contacts) && /const mode=cuMode\(\)/.test(contacts));
    ok('ui: distinct success states — connected / saved-for-later / invitation-sent', /When '\+esc\(email\)\+' signs up, they’ll connect to you automatically/.test(contacts) && /Connected to their workspace/.test(contacts));
    ok('ui: connect mode hides provision-only fields (no workspace set-up)', /id="cu-provision-only"/.test(contacts) && /po\.style\.display=connect\?'none':''/.test(contacts));
  }

  // ── Oct 2026 studio audit, change 4 — the dialog is honest and needs no password,
  //    on all THREE hand-synced copies (agency.html is the home; the rosters keep theirs)
  for (const p of ['agency.html', 'customers.html', 'contacts.html']) {
    const h = read(p);
    const di = h.indexOf('<dialog id="custDlg"'), dlg = h.slice(di, h.indexOf('</dialog>', di) + 9);
    const prov = dlg.slice(dlg.indexOf('id="cu-provision-only"'), dlg.indexOf('id="cu-connect-only"'));
    const conn = dlg.slice(dlg.indexOf('id="cu-connect-only"'));
    ok(`${p}: no "set their password" anywhere in the dialog or its done screen`, !/set their password/.test(h) && /Create their workspace and email them a sign-in link\./.test(dlg) && /They’ll sign in from the email and land in their client portal\./.test(h));
    ok(`${p}: provision mode says what provisioning does (workspace + site + sign-in link, never pay for software)`, /Adding them creates their client workspace and their site, and emails them a sign-in link\. You bill them for your work the usual way — they never pay for software here\./.test(prov));
    ok(`${p}: the pricing box lives in CONNECT mode only (nothing is bought when the studio provisions)`, !/id="cu-signup"/.test(prov) && /id="cu-signup"/.test(conn) && /send them this to sign up/.test(conn));
    ok(`${p}: "Start from" kit select in provision mode (default "No kit — start empty")`, /id="cu-kit-wrap"/.test(prov) && /<select id="cu-kit"><option value="">No kit — start empty<\/option><\/select>/.test(prov));
  }
}

// ═══ Covered in the browser by: ═══
// The page halves of the old text checks, as behaviour in a real browser against the real pages:
//   tests/e2e/pipeline.spec.ts › deal page — Contact block (ask 2) › renders pre-filled for a deal that HAS a contact, and Save patches that contact
//   tests/e2e/pipeline.spec.ts › deal page — Contact block (ask 2) › a CONTACTLESS deal gains a contact: create, then link it to the deal
//   tests/e2e/pipeline.spec.ts › deal page — Contact block (ask 2) › a failed LINK doesn’t leave a duplicate contact behind on retry
//   tests/e2e/pipeline.spec.ts › deal page — Contact block (ask 2) › an email that already belongs to someone else says whose — never a silent swap
//   tests/e2e/pipeline.spec.ts › deal page — Contact block (ask 2) › sending with NO client email says exactly why, and points at the fix
//   tests/e2e/pipeline.spec.ts › services catalog — starter list (ask 1) › the starter rows are editable and deletable, and Save sends exactly what’s on screen
//   tests/e2e/crm.spec.ts › Website enquiries (the Inbox’s Enquiries view) › + Make it a deal turns the enquiry into a deal and the card flips to “In pipeline”
//   tests/e2e/getting-in.spec.ts › Getting in (builder item 192) › an invite link that names its page still decides, and the server could not be asked: nothing moves
//   tests/e2e/doc.spec.ts › doc.html viewer › fetches the tokened document and renders it (title + body)
//   tests/e2e/doc.spec.ts › doc.html viewer › an expired/invalid token (403) shows the friendly error, not raw output
//   tests/e2e/agency.spec.ts › Agency home — one home, one roster › ⌘K’s "Add a customer" lands on /agency.html#add: the dialog opens and the hash is cleared
//   tests/e2e/agency.spec.ts › Agency home — one home, one roster › Start from a kit: the select lists /agency/kits, a chosen kit is applied to the NEW site, and the done screen names it
//   tests/e2e/agency.spec.ts › Agency home — one home, one roster › a kit that won’t apply never repaints the set-up as a failure; no kit chosen → no apply call; no kits → no field
//   tests/e2e/rosters.spec.ts › Customers — the agency member gets the roster (no forward since the nav cut) › customers (drilled agency) — the Start-from kit select lists /agency/kits; a plain owner never sees it
//   tests/e2e/rosters.spec.ts › Customers — the agency member gets the roster (no forward since the nav cut) › contacts — the same gate on its copy: agency sees the kit field, owner does not
//   tests/e2e/rosters.spec.ts › Contacts — the Add-a-customer dialog on phones (SS6 pin) › provision submits over the pinned roster table: POST /sales/customers lands and the done panel renders
//   tests/e2e/contacts.spec.ts › Contacts — Add-a-customer work-type dropdown › no-site-work submits the SAME Business OS plan (mapped, never the raw UI key) and no website_url
//   tests/e2e/sales-routes-212.spec.ts (new): the Add-a-customer dialog on contacts.html (opens, labels, service words,
//     invitation sent and already set up), kits applied from customers.html and contacts.html, the proposal
//     editor's service picker and its empty-catalog hint, the New deal dialog naming a deduped contact,
//     the board's Move menu and the deal page offering only the stage moves the server allows, and doc.html's noindex.
// Covered by another Deno suite: the portfolio claim convert makes is insert-only, never taking a site another
// studio manages: tests/presence/security_batch_a_test.mjs › a site another studio manages is never taken.

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SALES ROUTES (behaviour, two studios): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
Deno.exit(passed === results.length ? 0 : 1);
