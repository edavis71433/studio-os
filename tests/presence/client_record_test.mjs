// ── The unified client record: what its server half does, and every way in ────
//   deno run --allow-read --allow-env --allow-net tests/presence/client_record_test.mjs
// One relationship, one page: crm.html is the record, GET /crm/record resolves any key a
// page links with (contact, deal, customer, project) into one identity, and ONE activity
// timeline (/crm/activity, with /crm/messages behind the page's fallback) carries every
// conversation channel. This suite drives the real handlers (routes/crm.ts, the pure
// mappers in crm/activity.ts, the Inbox feed in routes/workspace.ts) against the
// in-memory PostgREST in fake_pgrst.mjs, and the real router (index.ts, std's serve()
// handed a fake listener as in scoped_commerce_test) for the wiring. Two studios share
// the database; the other studio even holds rows naming this studio's project and
// customer. It proves:
//   1  the resolver: any key opens the same record; sections, the opening tab and the
//      canonical address follow from what exists; Overview only with a customer SITE;
//      another studio's ids name nobody
//   2  /crm/messages: one thread of project messages, support requests and their replies
//   3  /crm/activity: the merged timeline (six types) and the Upcoming band
//   4  the Inbox's conversations open the record's Activity (?tab=messages)
//   5  the wiring: GET reaches each handler, a studio only
//   6  pins: the hand-kept copies the record shares with pipeline.html, and the icon set
// The page half (crm.html, pipeline.html, projects.html and the pages that open the
// record) is proven in the browser; the list is at the end of this file.
import { installFakePostgrest } from './fake_pgrst.mjs';

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const rid = (k, n) => `${k}${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`;
const SITE_S = uuid('a'), SITE_O = uuid('b'), SITE_CUST = uuid('c'), SITE_OC = uuid('d');
const CLIENT_S = uuid('1'), CLIENT_O = uuid('2'), CUST = uuid('3'), CUST3 = uuid('4'), CUST_O = uuid('5');
const AG_S = uuid('6'), AG_O = uuid('7'), U_S = uuid('8'), U_O = uuid('9'), U_CUST = uuid('0');
const USERS = {
  'jwt-s': { id: U_S, email: 'owner@studio.example' },
  'jwt-o': { id: U_O, email: 'owner@other-studio.example' },
  'jwt-cust': { id: U_CUST, email: 'avery@harbor.example' },
};
const db = installFakePostgrest({ users: USERS, ownSite: { 'jwt-s': SITE_S, 'jwt-o': SITE_O, 'jwt-cust': SITE_CUST } });
Deno.env.delete('RESEND_API_KEY');
Deno.env.delete('OPS_ALERT_EMAIL');

const CRM = await import('../../supabase/functions/presence/routes/crm.ts');
const ACT = await import('../../supabase/functions/presence/crm/activity.ts');
const WS = await import('../../supabase/functions/presence/routes/workspace.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ── the studio, another studio, their customers ──
const C1 = rid('c', 1), C2 = rid('c', 2), C3 = rid('c', 3), CO = rid('c', 4);
const D1 = rid('1', 1), D2 = rid('1', 2), D3 = rid('1', 3), DO = rid('1', 4);
const P1 = rid('a', 1), PO = rid('a', 2), PO2 = rid('a', 3);
const F1 = rid('f', 1), B1 = rid('b', 1);
const SR1 = rid('5', 1), SR2 = rid('5', 2), SR3 = rid('5', 3), SR4 = rid('5', 4), SRX = rid('5', 5);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);
const site = (id, client_id) => ({ id, client_id, status: 'live', edition: 'presence', custom_domain: null, netlify_site_id: null, template_slug: 'restaurant-classic', template_version: '1.0.0', last_published_at: null });
const deal = (id, site_id, title, extra = {}) => ({ id, site_id, title, stage: 'lead', contact_id: null, converted_client_id: null, converted_site_id: null, created_project_id: null, expected_value_cents: 0, next_step: null, next_step_at: null, source_submission_id: null, deleted_at: null, updated_at: '2026-07-01T00:00:00Z', ...extra });
const world = () => ({
  presence_sites: [site(SITE_S, CLIENT_S), site(SITE_O, CLIENT_O), site(SITE_CUST, CUST), site(SITE_OC, CUST_O)],
  clients: [
    { id: CLIENT_S, name: 'Bright Studio', email: 'owner@studio.example', contact_email: null, contact_id: null, tenant_id: 'tenant-1', deleted_at: null },
    { id: CLIENT_O, name: 'Other Studio', email: 'owner@other-studio.example', contact_email: null, contact_id: null, tenant_id: 'tenant-1', deleted_at: null },
    { id: CUST, name: 'Harbor Bakery', email: 'avery@harbor.example', contact_email: null, contact_id: null, tenant_id: 'tenant-1', deleted_at: null },
    { id: CUST3, name: 'Juniper Floral', email: 'jo@juniper.example', contact_email: null, contact_id: null, tenant_id: 'tenant-1', deleted_at: null },
    { id: CUST_O, name: 'Willow Spa', email: 'dana@willow.example', contact_email: null, contact_id: null, tenant_id: 'tenant-1', deleted_at: null },
  ],
  presence_entitlements: [CLIENT_S, CLIENT_O, CUST].map((client_id) => ({ client_id, product: 'presence', plan: 'presence', status: 'active' })),
  memberships: [], contacts: [], presence_site_members: [],
  presence_agencies: [{ id: AG_S, name: 'Bright Studio', status: 'active', seat_limit: 5, client_limit: 50, plan: 'agency', branding: {} }, { id: AG_O, name: 'Other Studio', status: 'active', seat_limit: 5, client_limit: 50, plan: 'agency', branding: {} }],
  presence_agency_members: [
    { id: rid('6', 1), agency_id: AG_S, user_id: U_S, email: 'owner@studio.example', role: 'owner', status: 'active' },
    { id: rid('6', 2), agency_id: AG_O, user_id: U_O, email: 'owner@other-studio.example', role: 'owner', status: 'active' },
  ],
  presence_identity: [{ site_id: SITE_CUST, business_name: 'Harbor Bakery' }],
  presence_contacts: [
    { id: C1, site_id: SITE_S, name: 'Avery Stone', email: 'avery@harbor.example', phone: '555-0101', company: 'Harbor Bakery', found_via: null, deleted_at: null, created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
    { id: C2, site_id: SITE_S, name: 'Blake Rowe', email: 'blake@example.com', phone: '', company: 'Rowe Cycles', found_via: null, deleted_at: null, created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
    { id: C3, site_id: SITE_S, name: 'Casey Doe', email: 'casey@example.com', phone: '', company: '', found_via: null, deleted_at: null, created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
    { id: CO, site_id: SITE_O, name: 'Dana Lee', email: 'dana@willow.example', phone: '', company: 'Willow Spa', found_via: null, deleted_at: null, created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
  ],
  presence_deals: [
    deal(D1, SITE_S, 'Harbor Bakery website', { stage: 'won', contact_id: C1, converted_client_id: CUST, converted_site_id: SITE_CUST, created_project_id: P1, expected_value_cents: 320000, next_step: 'Kickoff call', next_step_at: day(3), source_submission_id: F1, updated_at: '2026-07-02T00:00:00Z' }),
    deal(D2, SITE_S, 'Rowe Cycles shop', { stage: 'qualified', contact_id: C2 }),
    deal(D3, SITE_S, 'Juniper logo job', { stage: 'won', converted_client_id: CUST3 }),   // a customer with no website of theirs here
    deal(DO, SITE_O, 'Willow Spa site', { stage: 'won', contact_id: CO, converted_client_id: CUST_O, converted_site_id: SITE_OC, created_project_id: PO }),
  ],
  presence_projects: [
    { id: P1, site_id: SITE_S, client_id: CUST, deal_id: D1, name: 'Harbor Bakery website', status: 'active', client_visible: true, deleted_at: null, created_at: '2026-07-01T00:00:00Z' },
    { id: PO, site_id: SITE_O, client_id: CUST_O, deal_id: DO, name: 'Willow Spa site', status: 'active', client_visible: true, deleted_at: null, created_at: '2026-07-01T00:00:00Z' },
    { id: PO2, site_id: SITE_O, client_id: CUST, deal_id: null, name: 'Other studio work for Harbor', status: 'active', client_visible: true, deleted_at: null, created_at: '2026-07-01T00:00:00Z' },
  ],
  presence_customer_agency: [{ customer_client_id: CUST, agency_site_id: SITE_S }, { customer_client_id: CUST_O, agency_site_id: SITE_O }],
  presence_service_links: [
    { id: rid('7', 1), project_id: P1, agency_site_id: SITE_S, customer_client_id: CUST, customer_site_id: SITE_CUST, deal_id: D1, status: 'active', created_at: '2026-07-01T00:00:00Z' },
    { id: rid('7', 2), project_id: PO, agency_site_id: SITE_O, customer_client_id: CUST_O, customer_site_id: SITE_OC, deal_id: DO, status: 'active', created_at: '2026-07-01T00:00:00Z' },
    // another studio linked to the same customer: never followed from this studio
    { id: rid('7', 3), project_id: PO2, agency_site_id: SITE_O, customer_client_id: CUST, customer_site_id: SITE_CUST, deal_id: null, status: 'active', created_at: '2026-09-01T00:00:00Z' },
  ],
  presence_form_submissions: [{ id: F1, site_id: SITE_S, form_kind: 'quote', name: 'Avery Stone', email: 'avery@harbor.example', message: 'Looking for a new website', spam: false, status: 'converted', created_at: '2026-06-01T09:00:00Z' }],
  presence_project_messages: [
    { id: rid('8', 1), site_id: SITE_S, project_id: P1, audience: 'client', author_kind: 'client', body: 'Can we swap the hero photo?', deleted_at: null, created_at: '2026-07-01T10:00:00Z' },
    { id: rid('8', 2), site_id: SITE_S, project_id: P1, audience: 'internal', author_kind: 'studio', body: 'Internal: check the budget first', deleted_at: null, created_at: '2026-07-02T10:00:00Z' },
    { id: rid('8', 3), site_id: SITE_S, project_id: P1, audience: 'client', author_kind: 'studio', body: 'Swapping it today.', deleted_at: null, created_at: '2026-07-03T10:00:00Z' },
    // on the other studio's site, naming this studio's project: never part of this thread
    { id: rid('8', 4), site_id: SITE_O, project_id: P1, audience: 'client', author_kind: 'studio', body: 'Other studio message', deleted_at: null, created_at: '2026-07-04T10:00:00Z' },
  ],
  presence_support_requests: [
    { id: SR1, site_id: SITE_S, project_id: P1, client_id: CUST, requester: 'avery@harbor.example', requester_kind: 'client', subject: 'Cannot sign in', body: 'The login link expired', status: 'open', priority: 'normal', assigned_to: null, deleted_at: null, created_at: '2026-07-05T09:00:00Z', updated_at: '2026-07-06T09:00:00Z' },
    { id: SR2, site_id: SITE_S, project_id: null, client_id: CUST, requester: 'avery@harbor.example', requester_kind: 'client', subject: 'Invoice question', body: 'Was the deposit received?', status: 'resolved', priority: 'normal', assigned_to: null, deleted_at: null, created_at: '2026-06-20T09:00:00Z', updated_at: '2026-06-21T09:00:00Z' },
    { id: SRX, site_id: SITE_O, project_id: null, client_id: CUST, requester: 'avery@harbor.example', requester_kind: 'client', subject: 'Other studio thread', body: 'Private to the other studio', status: 'open', priority: 'normal', assigned_to: null, deleted_at: null, created_at: '2026-07-06T09:00:00Z', updated_at: '2026-07-06T09:00:00Z' },
  ],
  presence_support_messages: [
    { id: rid('9', 1), site_id: SITE_S, request_id: SR1, author_kind: 'studio', body: 'Here is a fresh link', deleted_at: null, created_at: '2026-07-05T12:00:00Z' },
    { id: rid('9', 2), site_id: SITE_S, request_id: SR1, author_kind: 'client', body: 'That worked, thanks', deleted_at: null, created_at: '2026-07-06T08:00:00Z' },
  ],
  presence_appointments: [{ id: rid('2', 1), site_id: SITE_S, customer_email: 'avery@harbor.example', type_name: 'Intro call', slot_start_local: '2026-06-10T10:00', slot_start: '2026-06-10T17:00:00Z', note: 'Wants a quote', status: 'confirmed', created_at: '2026-06-05T09:00:00Z' }],
  presence_broadcast_sends: [{ id: rid('2', 2), site_id: SITE_S, broadcast_id: B1, email: 'avery@harbor.example', status: 'sent', created_at: '2026-06-25T09:00:00Z', opened_at: '2026-06-25T10:00:00Z' }],
  presence_broadcasts: [{ id: B1, site_id: SITE_S, subject: 'Summer hours' }],
  presence_deal_events: [
    { id: rid('3', 1), site_id: SITE_S, deal_id: D1, kind: 'note', from_stage: null, to_stage: null, detail: { activity_kind: 'call', body: 'Talked through the photos', occurred_at: '2026-07-02T15:00:00Z' }, actor: 'owner@studio.example', created_at: '2026-07-02T15:05:00Z' },
    { id: rid('3', 2), site_id: SITE_S, deal_id: D1, kind: 'stage_change', from_stage: 'contract', to_stage: 'won', detail: {}, actor: 'owner@studio.example', created_at: '2026-06-28T00:00:00Z' },
  ],
  presence_deal_tasks: [
    { id: rid('4', 1), site_id: SITE_S, deal_id: D1, title: 'Send the welcome pack', due_date: day(-1), status: 'open', completed_at: null, deleted_at: null, created_at: '2026-07-01T00:00:00Z' },
    { id: rid('4', 2), site_id: SITE_S, deal_id: D1, title: 'Book the photo shoot', due_date: null, status: 'open', completed_at: null, deleted_at: null, created_at: '2026-07-01T00:00:00Z' },
    { id: rid('4', 3), site_id: SITE_S, deal_id: D1, title: 'Collect the logo files', due_date: null, status: 'done', completed_at: '2026-07-03T12:00:00Z', deleted_at: null, created_at: '2026-07-01T00:00:00Z' },
  ],
  presence_invoices: [
    { id: rid('e', 1), site_id: SITE_S, deal_id: D1, customer_client_id: CUST, title: 'Balance', amount_cents: 160000, status: 'open', stripe_url: 'https://pay.example/x',  due_date: day(-2), purpose: 'service', deleted_at: null },
    { id: rid('e', 2), site_id: SITE_S, deal_id: D1, customer_client_id: CUST, title: 'Deposit', amount_cents: 160000, status: 'paid', due_date: null, purpose: 'deposit', deleted_at: null },
    { id: rid('e', 3), site_id: SITE_S, deal_id: D1, customer_client_id: CUST, title: 'Photos', amount_cents: 40000, status: 'open', stripe_url: 'https://pay.example/x',  due_date: day(5), processing_since: '2026-07-04T00:00:00Z', purpose: 'service', deleted_at: null },
  ],
  // the customer's own website news (shown only inside their record), and the studio's own (never)
  presence_publishes: [
    { id: rid('d', 1), site_id: SITE_CUST, kind: 'publish', status: 'live', change_summary: 'New menu page', created_at: '2026-07-07T09:00:00Z', completed_at: '2026-07-07T09:01:00Z' },
    { id: rid('d', 2), site_id: SITE_S, kind: 'publish', status: 'live', change_summary: 'The studio’s own site', created_at: '2026-07-08T09:00:00Z', completed_at: '2026-07-08T09:01:00Z' },
  ],
  presence_project_events: [
    { id: rid('b', 2), site_id: SITE_S, project_id: P1, kind: 'message', detail: { from: 'client' }, client_visible: true, created_at: '2026-07-06T08:30:00Z' },
  ],
});

// ── calling the handlers ──
const cors = {};
const person = (jwt, extra = {}) => ({ kind: 'client', userId: USERS[jwt].id, email: USERS[jwt].email, jwt, role: 'client', tenantId: 'tenant-1', requestId: 't', ...extra });
const siteRow = (id) => ({ ...db.tables.presence_sites.find((s) => s.id === id) });
const req = (path) => new Request(`https://fn.test/functions/v1/presence${path}`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
const res = async (r) => { const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ } return { status: r.status, body, text }; };
const studio = (q, jwt = 'jwt-s', siteId = SITE_S, extra = {}) => CRM.handleCrmRecord(req(`/crm/record${q}`), jwt, siteRow(siteId), person(jwt, extra), cors).then(res);
const messages = (q, jwt = 'jwt-s') => CRM.handleCrmMessages(req(`/crm/messages${q}`), jwt, siteRow(OWN[jwt]), person(jwt), cors).then(res);
const activity = (q, jwt = 'jwt-s', siteId, extra = {}) => CRM.handleCrmActivity(req(`/crm/activity${q}`), jwt, siteRow(siteId || OWN[jwt]), person(jwt, extra), cors).then(res);
const OWN = { 'jwt-s': SITE_S, 'jwt-o': SITE_O, 'jwt-cust': SITE_CUST };
const readsOn = (from, siteId) => db.log.slice(from).filter((c) => c.url.includes(`site_id=eq.${siteId}`) || c.url.includes(`agency_site_id=eq.${siteId}`));
const sameId = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ═══ 1. the resolver: any key opens the same record ═══
{
  db.reset(world());
  const FULL = { contact_id: C1, deal_id: D1, client_id: CUST, customer_site_id: SITE_CUST, project_id: P1 };
  const byKey = {};
  for (const [label, q] of [['a contact', `?contact=${C1}`], ['a deal', `?deal=${D1}`], ['a project', `?project=${P1}`], ['a customer', `?client_id=${CUST}`]]) byKey[label] = await studio(q);
  const wrongKey = Object.entries(byKey).filter(([, r]) => r.status !== 200 || !sameId(r.body?.data?.identity, FULL)).map(([k, r]) => `${k}: ${JSON.stringify(r.body?.data?.identity)}`);
  ok('a contact, a deal, a project or a customer id each open the same record (contact, deal, customer, their site, the project)', wrongKey.length === 0, wrongKey.join(' | '));
  const r = byKey['a deal'].body?.data || {};
  ok('the record says which parts exist: all five for a customer with a deal, a project and a website', sameId(r.sections, { overview: true, messages: true, deal: true, delivery: true, details: true }), JSON.stringify(r.sections));
  ok('…it opens on the project, and its address is the customer\'s website (the most stable key)', r.default_tab === 'delivery' && sameId(r.canonical, { key: 'client', value: SITE_CUST }), JSON.stringify([r.default_tab, r.canonical]));
  ok('…its header names the customer, and the highlights carry the deal\'s value, stage, next step and what is owed', /Harbor/.test(String(r.header?.name)) && r.header?.status === 'customer' && r.highlights?.value_cents === 320000 && r.highlights?.stage === 'won' && r.highlights?.next_step === 'Kickoff call' && r.highlights?.owed_cents === 200000, JSON.stringify([r.header, r.highlights]));
  ok('…and it lists the customer\'s projects and deals on this studio\'s site only', sameId((r.related_projects || []).map((p) => p.id), [P1]) && sameId((r.related_deals || []).map((d) => d.id), [D1]), JSON.stringify([r.related_projects, r.related_deals]));

  const lead = (await studio(`?contact=${C2}`)).body?.data || {};
  ok('a person with an open deal and no customer yet: the deal and details, no Overview; it opens on the deal and is addressed by it', sameId(lead.identity, { contact_id: C2, deal_id: D2, client_id: null, customer_site_id: null, project_id: null }) && sameId(lead.sections, { overview: false, messages: false, deal: true, delivery: false, details: true }) && lead.default_tab === 'deal' && sameId(lead.canonical, { key: 'deal', value: D2 }), JSON.stringify([lead.identity, lead.sections, lead.default_tab, lead.canonical]));
  const solo = (await studio(`?contact=${C3}`)).body?.data || {};
  ok('a person with no deal: details only, addressed by the contact, named in the header', sameId(solo.sections, { overview: false, messages: false, deal: false, delivery: false, details: true }) && solo.default_tab === 'details' && sameId(solo.canonical, { key: 'contact', value: C3 }) && solo.header?.name === 'Casey Doe', JSON.stringify([solo.sections, solo.default_tab, solo.canonical, solo.header?.name]));
  const noSite = (await studio(`?deal=${D3}`)).body?.data || {};
  ok('Overview needs the customer\'s own website: a customer with none gets no Overview (it would read the studio\'s own site)', noSite.identity?.client_id === CUST3 && noSite.identity?.customer_site_id === null && noSite.sections?.overview === false && noSite.sections?.messages === true, JSON.stringify([noSite.identity, noSite.sections]));

  // another studio's ids, from this studio's record
  const from = db.log.length;
  const foreign = await Promise.all([studio(`?deal=${DO}`), studio(`?contact=${CO}`), studio(`?project=${PO}`), studio(`?client_id=${CUST_O}`)]);
  ok('another studio\'s project or customer id names nobody here', foreign.slice(2).every((x) => x.status === 200 && Object.values(x.body?.data?.identity || {}).every((v) => v === null)), JSON.stringify(foreign.slice(2).map((x) => x.body?.data?.identity)));
  // A ?deal= or ?contact= id the studio's site doesn't hold is still echoed back as the record's key
  // (handleCrmRecord clears an unknown ?project=, never an unknown deal or contact), so the page draws a
  // Deal or Details tab that can't load. Nothing of the other studio's comes with it, which is what this pins.
  const bare = (x) => { const d = x.body?.data || {}; const id = d.identity || {}; return x.status === 200 && id.client_id === null && id.customer_site_id === null && id.project_id === null && !d.header?.name && !d.header?.email && Object.keys(d.highlights || {}).length === 0 && !(d.related_projects || []).length && !(d.related_deals || []).length; };
  ok('another studio\'s deal or contact id brings none of their data: no customer, project, person, header or money', bare(foreign[0]) && bare(foreign[1]) && foreign[0].body?.data?.identity?.contact_id === null && foreign[1].body?.data?.identity?.deal_id === null, JSON.stringify(foreign.slice(0, 2).map((x) => [x.body?.data?.identity, x.body?.data?.header, x.body?.data?.highlights])));
  ok('…and nothing on that studio\'s site is read', readsOn(from, SITE_O).length === 0 && !db.log.slice(from).some((c) => c.url.includes(`clients?id=eq.${CUST_O}`)), JSON.stringify(readsOn(from, SITE_O).map((c) => c.url)));
  // inside the customer's own site (a studio drilled in): their record, on this studio's site only
  const from2 = db.log.length;
  const scoped = (await studio('', 'jwt-s', SITE_CUST, { scope: { site_id: SITE_CUST, name: 'Harbor Bakery' } })).body?.data || {};
  ok('drilled into the customer\'s site, the record is theirs on this studio\'s site', scoped.identity?.client_id === CUST && scoped.identity?.project_id === P1 && scoped.identity?.deal_id === D1, JSON.stringify(scoped.identity));
  ok('…and the other studio\'s link to the same customer is never followed: its project is not even looked up', !db.log.slice(from2).some((c) => c.url.includes(PO2)) && readsOn(from2, SITE_O).length === 0, JSON.stringify(db.log.slice(from2).filter((c) => c.url.includes(PO2)).map((c) => c.url)));
  const outsider = await studio(`?contact=${C1}`, 'jwt-cust', SITE_CUST);
  ok('someone who is not a studio is refused (403) and told why', outsider.status === 403 && outsider.body?.error === 'forbidden' && /Only your studio/.test(outsider.body?.message || ''), outsider.text.slice(0, 160));
}

// ═══ 2. /crm/messages: one thread ═══
{
  db.reset(world());
  const m = await messages(`?client_id=${CUST}`);
  const items = m.body?.data?.items || [];
  const seq = items.map((i) => `${i.kind}:${i.from}`);
  ok('one thread, oldest first: the enquiry, support requests with their replies inline, project messages, a booking, an update, a logged call', m.status === 200 && sameId(seq, ['enquiry:client', 'booking:client', 'support:client', 'broadcast:studio', 'message:client', 'activity:studio', 'message:studio', 'support:client', 'support_reply:studio', 'support_reply:client']), JSON.stringify(seq));
  ok('…the studio\'s internal note on the project is left out of the client conversation', !items.some((i) => /Internal: check the budget/.test(i.body || '')));
  ok('…and nothing from another studio\'s site is in it, not even rows about this customer or this project', !items.some((i) => /Other studio/.test(String(i.body) + String(i.subject))), JSON.stringify(items.filter((i) => /Other/.test(String(i.body) + String(i.subject)))));
  ok('replies go to the project thread, and the newest open support request is the other way to answer', m.body?.data?.reply_to === `/projects/${P1}/messages` && m.body?.data?.project_id === P1 && m.body?.data?.reply_support_to === `/support/${SR1}/messages`, JSON.stringify([m.body?.data?.reply_to, m.body?.data?.reply_support_to]));
  const viaProject = await messages(`?project=${P1}`);
  ok('opened by the project instead, it is the same thread', sameId((viaProject.body?.data?.items || []).map((i) => i.id), items.map((i) => i.id)));
  // the newest OPEN request wins across project and project-less ones; a newer resolved one never does
  db.tables.presence_support_requests.push(
    { id: rid('5', 6), site_id: SITE_S, project_id: null, client_id: CUST, requester: 'avery@harbor.example', requester_kind: 'client', subject: 'Can I add a page?', body: 'A menu page', status: 'open', deleted_at: null, created_at: '2026-07-09T09:00:00Z', updated_at: '2026-07-09T09:00:00Z' },
    { id: rid('5', 7), site_id: SITE_S, project_id: P1, client_id: CUST, requester: 'avery@harbor.example', requester_kind: 'client', subject: 'Old login issue', body: 'Fixed', status: 'resolved', deleted_at: null, created_at: '2026-07-10T09:00:00Z', updated_at: '2026-07-10T09:00:00Z' },
  );
  const newest = await messages(`?client_id=${CUST}`);
  ok('the other way to answer is the newest open request, project or not; a newer resolved one is never it', newest.body?.data?.reply_support_to === `/support/${rid('5', 6)}/messages`, String(newest.body?.data?.reply_support_to));
  const outsider = await messages(`?client_id=${CUST}`, 'jwt-cust');
  ok('someone who is not a studio can\'t open a client conversation (403)', outsider.status === 403 && outsider.body?.error === 'forbidden');
}

// ═══ 3. /crm/activity: the merged timeline and the Upcoming band ═══
{
  db.reset(world());
  const a = await activity(`?client_id=${CUST}&deal=${D1}&today=${TODAY}`);
  const d = a.body?.data || {};
  const items = d.items || [];
  ok('the timeline is newest first', a.status === 200 && items.length > 0 && items.every((it, i) => i === 0 || String(items[i - 1].at) >= String(it.at)), JSON.stringify(items.map((i) => i.at)));
  const has = (pred) => items.some(pred);
  ok('it merges the conversation (messages, support, replies, the enquiry), the logged call, the booking and the update', has((i) => i.kind === 'message' && i.type === 'message') && has((i) => i.kind === 'support' && i.type === 'message') && has((i) => i.kind === 'support_reply') && has((i) => i.kind === 'enquiry') && has((i) => i.kind === 'activity' && i.type === 'call' && /logged a call/.test(i.title)) && has((i) => i.kind === 'booking' && i.type === 'call') && has((i) => i.kind === 'broadcast' && i.type === 'email'), JSON.stringify(items.map((i) => `${i.kind}/${i.type}`)));
  ok('…with the deal\'s own events as system rows and a finished to-do as a task row', has((i) => i.kind === 'deal_event' && i.type === 'system' && i.title === 'Moved to Won') && has((i) => i.kind === 'task' && i.type === 'task' && /Collect the logo files/.test(i.title)), JSON.stringify(items.filter((i) => i.kind === 'deal_event' || i.kind === 'task')));
  ok('…a logged call appears once, not again as a deal event', items.filter((i) => /Talked through the photos/.test(String(i.body))).length === 1);
  const up = d.upcoming || [];
  const upT = up.map((u) => `${u.kind}:${u.title}:${u.overdue}`);
  ok('Upcoming: the open to-dos (the late one marked), the deal\'s next step and the unpaid invoice (late), soonest first', sameId(upT, ['invoice:Unpaid invoice — Balance ($1,600):true', 'task:Send the welcome pack:true', `next_step:Next step — Kickoff call:false`, 'task:Book the photo shoot:false']), JSON.stringify(upT));
  ok('…never a paid invoice or one whose payment is already on its way', !up.some((u) => /Deposit|Photos/.test(u.title)));
  ok('…and each to-do carries its id, so the page can tick it done', up.filter((u) => u.kind === 'task').every((u) => /^4000000[12]-/.test(String(u.id))), JSON.stringify(up));
  ok('it answers with where replies go, like /crm/messages', d.reply_to === `/projects/${P1}/messages` && d.reply_support_to === `/support/${SR1}/messages` && d.deal_id === D1 && d.project_id === P1);
  ok('opened at studio level, the studio\'s own website news never lands in a client\'s timeline', !has((i) => i.kind === 'publish'), JSON.stringify(items.filter((i) => i.kind === 'publish')));
  const from3 = db.log.length;
  const inside = await activity(`?today=${TODAY}`, 'jwt-s', SITE_CUST, { scope: { site_id: SITE_CUST, name: 'Harbor Bakery' } });
  const pubs = (inside.body?.data?.items || []).filter((i) => i.kind === 'publish');
  ok('drilled into the customer\'s site, their own website news joins the timeline (as system rows), and only theirs', inside.status === 200 && pubs.length === 1 && pubs[0].type === 'system' && /New menu page|Published/.test(pubs[0].title + String(pubs[0].body)), JSON.stringify(pubs));
  ok('…its conversation is this studio\'s project, never the other studio\'s for the same customer (not even looked up)', inside.body?.data?.project_id === P1 && !db.log.slice(from3).some((c) => c.url.includes(PO2)) && readsOn(from3, SITE_O).length === 0, JSON.stringify([inside.body?.data?.project_id, db.log.slice(from3).filter((c) => c.url.includes(PO2)).map((c) => c.url)]));
  const outsider = await activity(`?client_id=${CUST}`, 'jwt-cust');
  ok('someone who is not a studio can\'t open a record\'s activity (403)', outsider.status === 403 && outsider.body?.error === 'forbidden');

  // the six types: every channel the mappers take lands in exactly one of them, and all six are used
  const SIX = ['message', 'email', 'call', 'task', 'note', 'system'];
  const at = '2026-07-01T00:00:00Z';
  const conv = ['message', 'support', 'support_reply', 'enquiry', 'booking', 'broadcast'].map((kind) => ACT.mapConversationItem({ kind, id: kind, from: 'client', body: 'x', created_at: at }));
  const logged = ['call', 'email', 'meeting', 'note', 'something_else'].map((activity_kind) => ACT.mapConversationItem({ kind: 'activity', id: activity_kind, activity_kind, from: 'studio', body: 'x', created_at: at }));
  const sent = ACT.mapConversationItem({ kind: 'activity', id: 'e2', activity_kind: 'email', via: 'app', subject: 'Hello', from: 'studio', body: 'x', created_at: at });
  const site_ = ['note', 'publish', 'change', 'connected', 'moment', 'approval', 'lead'].map((kind) => ACT.mapSiteEvent({ id: kind, kind, at, title: kind, detail: 'x', audience: 'shared' }));
  const dealEv = ['stage_change', 'proposal_decided', 'invoice_paid'].map((kind) => ACT.mapDealEvent({ id: kind, kind, to_stage: 'won', detail: { decision: 'accepted', amount_cents: 100 }, created_at: at }, 'd'));
  const done = ACT.mapDoneTask({ id: 't', status: 'done', title: 'x', completed_at: at }, 'd');
  const all = [...conv, ...logged, sent, ...site_, ...dealEv, done];
  const types = new Set(all.map((x) => x && x.type));
  ok('every channel the timeline takes maps to one of six types (message, email, call, task, note, system), and all six are used', all.every((x) => x && SIX.includes(x.type)) && SIX.every((t) => types.has(t)) && types.size === 6, JSON.stringify([...types]));
}

// ═══ 4. the Inbox's conversations open the record's Activity ═══
{
  db.reset(world());
  db.tables.presence_support_requests.push(
    { id: SR3, site_id: SITE_S, project_id: null, client_id: CUST, requester: 'avery@harbor.example', requester_kind: 'client', subject: 'Domain renewal', body: 'Is it renewing?', status: 'open', priority: 'normal', assigned_to: null, deleted_at: null, created_at: '2026-07-07T09:00:00Z', updated_at: '2026-07-07T09:00:00Z' },
    { id: SR4, site_id: SITE_S, project_id: null, client_id: null, requester: 'stranger@example.com', requester_kind: 'client', subject: 'A question', body: 'Hello?', status: 'open', priority: 'normal', assigned_to: null, deleted_at: null, created_at: '2026-07-08T09:00:00Z', updated_at: '2026-07-08T09:00:00Z' },
  );
  const f = await res(await WS.handlePortalFeed('jwt-s', siteRow(SITE_S), person('jwt-s'), cors));
  const rows = f.body?.data?.client_messages || [];
  const hrefOf = (pred) => rows.find(pred)?.href;
  const rec = `/crm.html?project=${P1}&tab=messages`;
  ok('a client\'s project conversation in the Inbox opens their record on its messages (?tab=messages)', f.status === 200 && hrefOf((x) => x.type === 'message' && x.project_id === P1) === rec, JSON.stringify(rows.map((x) => [x.type, x.href])));
  ok('…so do their support requests: on the project, or tied to them with no project', hrefOf((x) => x.type === 'support' && x.id === SR1) === rec && hrefOf((x) => x.type === 'support' && x.id === SR3) === rec, JSON.stringify(rows.map((x) => [x.id, x.href])));
  ok('…and a request nobody can be tied to opens on its own', hrefOf((x) => x.type === 'support' && x.id === SR4) === `/projects.html?support=${SR4}`);
}

// ═══ 5. the wiring, through the real router ═══
const queue = []; let wake = null;
Deno.listen = () => { let first = true; return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} }; };
Deno.serveHttp = () => ({ nextRequest: () => new Promise((r) => { if (queue.length) r(queue.shift()); else wake = r; }), close() {} });
await import('../../supabase/functions/presence/index.ts');
const send = (request) => new Promise((resolve) => { const ev = { request, respondWith: async (r) => { resolve(await r); } }; if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev); });
const route = async (jwt, method, path) => res(await send(new Request(`http://stub.local/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json', ...(jwt ? { 'x-dds-user-jwt': jwt } : {}) } })));
{
  db.reset(world());
  const rec = await route('jwt-s', 'GET', `/crm/record?deal=${D1}`);
  const msg = await route('jwt-s', 'GET', `/crm/messages?client_id=${CUST}`);
  const act = await route('jwt-s', 'GET', `/crm/activity?client_id=${CUST}&today=${TODAY}`);
  ok('GET /crm/record, /crm/messages and /crm/activity reach their handlers for the studio', rec.status === 200 && rec.body?.data?.identity?.project_id === P1 && msg.status === 200 && (msg.body?.data?.items || []).length === 10 && act.status === 200 && Array.isArray(act.body?.data?.upcoming), [rec, msg, act].map((r) => `${r.status} ${r.text.slice(0, 80)}`).join(' | '));
  const out = await Promise.all(['/crm/record?deal=' + D1, '/crm/messages?client_id=' + CUST, '/crm/activity?client_id=' + CUST].map((p) => route('jwt-cust', 'GET', p)));
  ok('…and refuse a signed-in business owner who is not a studio (403 each)', out.every((r) => r.status === 403 && r.body?.error === 'forbidden'), out.map((r) => r.status).join(','));
  const posts = await Promise.all(['/crm/record', '/crm/messages', '/crm/activity'].map((p) => route('jwt-s', 'POST', p)));
  ok('they are read-only: POST is no route (404)', posts.every((r) => r.status === 404), posts.map((r) => r.status).join(','));
  const anon = await route(null, 'GET', `/crm/record?deal=${D1}`);
  ok('no sign-in is a 401', anon.status === 401);
}

// ═══ 6. pins ═══
{
  const crm = read('crm.html');
  const pipeline = read('pipeline.html');
  const activityTs = read('supabase/functions/presence/crm/activity.ts');
  const boardNext = (src) => (src.match(/const BOARD_NEXT=\{[^}]+\}/) || [''])[0];
  // pin: crm.html's Path keeps a hand copy of pipeline.html's stage moves; the two pages must agree byte for byte
  ok('PATH: BOARD_NEXT is byte-identical to pipeline.html (all six stage keys pinned)', boardNext(crm) !== '' && boardNext(crm) === boardNext(pipeline));
  const stageLabelMap = (src) => (src.match(/const STAGE_LABEL=\{[^}]+\}/) || [''])[0];
  // pin: the same hand copy for the stage names the Path prints
  ok('PATH: STAGE_LABEL is byte-identical to pipeline.html', stageLabelMap(crm) !== '' && stageLabelMap(crm) === stageLabelMap(pipeline));
  const guidanceMap = (src) => (src.match(/const PIPELINE_GUIDANCE=\{[\s\S]*?\n\};/) || [''])[0];
  // pin: and for the guidance both Paths render under the stage bar
  ok('PATH: PIPELINE_GUIDANCE is byte-identical to pipeline.html', guidanceMap(crm) !== '' && guidanceMap(crm) === guidanceMap(pipeline));
  const typeUnion = (((activityTs.match(/export type ActivityType = ([^;]+);/) || ['', ''])[1]).match(/'([a-z]+)'/g) || []).map((s) => s.replace(/'/g, ''));
  const iconKeys = ((((crm.match(/TYPE_ICON=\{([^}]*)\}/) || ['', ''])[1]).match(/(\w+):/g)) || []).map((s) => s.replace(':', ''));
  // pin: the page's icon map is a hand copy of the server's ActivityType union, a TypeScript type with no runtime value to compare against
  ok('ACTIVITY: the page draws an icon for exactly the six types the server can send', typeUnion.join(',') === 'message,email,call,task,note,system' && iconKeys.join(',') === typeUnion.join(','), `${typeUnion} / ${iconKeys}`);
}

// Covered in the browser by (tests/e2e):
//   crm.html asks GET /crm/record for the URL's key:            record-truth.spec.ts › item 98 — an older deal’s link opens that deal (B10) › ?deal= of an older deal keeps the deal (and its project) through the tidy-up to ?client=
//                                                               sales-batch9.spec.ts › item 45 — the record's timeline starts beside the record read › opened by a deal, the timeline still waits for the record's ids
//   canonical redirect to ?client=, keeping the deal and ?act=: record-truth.spec.ts › item 98 — an older deal’s link opens that deal (B10) › ?deal= of an older deal keeps the deal (and its project) through the tidy-up to ?client=
//                                                               record-truth.spec.ts › item 98 — an older deal’s link opens that deal (B10) › ?act=invoice rides along and opens the invoice form once
//   highlights tiles (label, value, sub-line):                 record-billing.spec.ts › item 108 — the record shows all the money › J4: retainer payments count in Paid and are named on Billing
//                                                               crm.spec.ts › Relationship view › Billing — four money states: Paid · Processing · Upcoming · Overdue chips, one colour each; processing has no Resend/Void; the Outstanding tile and the record band run the same formula
//   ONE timeline + composer with Log call:                     crm.spec.ts › Relationship view › server /crm/activity feeds the timeline, the Upcoming band, and an enabled composer
//                                                               crm.spec.ts › Relationship view › one word per action: Log a call · To-do tabs, a log button that names what it logs, To-dos in the filter
//   Upcoming band, its checkbox PATCHes the to-do done:        crm.spec.ts › Relationship view › the Upcoming checkbox PATCHes the to-do done
//   ONE LINK on the record (headline act, Billing button + More, rows lose Send; the POST carries the pair):
//                                                               crm.spec.ts › Relationship view › ONE LINK — both drafted: the action bar headlines "Send proposal & agreement"; Billing shows it once, the row sends go under More
//                                                               crm.spec.ts › Relationship view › ONE LINK — the one button POSTs /sales/deals/:id/send with the pair it showed, and says what went out
//                                                               crm.spec.ts › Relationship view › ONE LINK — with only a proposal drafted, nothing collapses: the row keeps Send to client; the Path’s next step is the one filled button (experience review #4)
//   ONE LINK in pipeline.html's drawer:                        pipeline.spec.ts › deal drawer — one "Send proposal & agreement" › both drafted: one filled send, the row sends under More ▾, the rows keep their chips and other actions
//   the agreement's blanks guard on the combined send:         pipeline.spec.ts › deal drawer — one "Send proposal & agreement" › the agreement’s blanks guard runs on the combined send too — declining sends nothing at all
//   pipeline.html ?embed=1 hides the list and the back bar:    pipeline.spec.ts › Deal drawer Path › embed mode still renders the drawer + Path with the list hidden
//   contacts open the record's Details tab:                    rosters.spec.ts › Contacts list view › renders the table with the fields the route returns; rows open the record
//   the Inbox's "view deal" and convert open the record:       crm.spec.ts › Website enquiries (the Inbox’s Enquiries view) › a converted enquiry shows “✓ In pipeline — view deal” instead of the conversion actions
//                                                               scope.spec.ts › Scope carry — convert redirects + APP_PAGES coverage › Inbox enquiry pane: the + Make it a deal redirect keeps ?client=
//   agency opens the record by its project:                    agency.spec.ts › Agency portfolio › row drill-ins carry the client scope (SC-1): delivery project + plain record
//   customers (the preview's link):                            rosters.spec.ts › Customers list view › table rows open the client record; row action stays separate
// and in tests/e2e/client-record-212.spec.ts (new, item 212): the tab order with Activity first; old ?tab= links;
//   the picker with no key; Deal and Project as cards linking out, no frames; the unscoped sales and project reads;
//   the Path's fact line (tip and action), its forward button and the convert link; the fallback to /crm/messages +
//   /crm/timeline and the icon each of the six types gets; the Notes view (pinned first, Pin/Unpin); the composer's
//   no-target hint; ONE LINK's guards (won, converted, replaced proposal) and front buttons; pipeline.html's money
//   guard on the combined send and its convert message in embed mode; projects.html ?embed=1; the shell hidden in
//   pipeline.html's embed mode; the customers roster's own "Open record"; a stray convert message changes nothing.

const passed = results.filter((r) => r.p).length;
console.log(`\n════ UNIFIED CLIENT RECORD: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
Deno.exit(passed === results.length ? 0 : 1);
