// ── Adding a customer saves the customer and nothing else (builder list item 241) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/customers_241_test.mjs
// Eric, Nov 15: "it looks like every time a customer has been created, it starts their
// site. shouldnt be that way. i also cant delete whats currently there". Drives the real
// handlers (routes/sales.ts, routes/customers.ts, agency/routes.ts, ops/customer_trash.ts)
// on the in-memory PostgREST, with stand-ins for the sign-in service, the hosting and the
// mail service, so every outside call is seen:
//   · Save: a customer record with no owner, their project and link, the person in the
//     contacts; no site, no sign-in, no email. The same person twice is one customer.
//   · Their profile: no website, never invited; what it offers.
//   · Create website: + New site for THEIR record (no second customer), and only once.
//   · Invite to their portal: a workspace with no website when they have none, their own
//     sign-in, the email; the link again for someone invited.
//   · Delete: their website to the Trash or kept; Recently deleted; Restore puts back
//     exactly what went; before the database step nothing changes.
//   · The daily sweep after 30 days, and the member gate.
Deno.env.set('NETLIFY_AUTH_TOKEN', 'netlify-test');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('SITE_URL', 'https://app.test');
import { installFakePostgrest } from './fake_pgrst.mjs';

const STUDIO = '11111111-1111-4111-8111-111111111111', STUDIO_CLIENT = '22222222-2222-4222-8222-222222222222';
const AG = 'aaaaaaaa-0000-4000-8000-000000000001', MEMBER = 'aaaaaaaa-0000-4000-8000-000000000002', UID = '33333333-3333-4333-8333-333333333333';
const OTHER_STUDIO = '44444444-4444-4444-8444-444444444444', THEIRS = '55555555-5555-4555-8555-555555555555';
const users = { 'jwt-owner': { id: UID, email: 'owner@studio.test' } };
const db = installFakePostgrest({
  users, ownSite: { 'jwt-owner': STUDIO },
  unique: {
    presence_contacts: [{ cols: ['site_id', 'email'], where: (r) => r.deleted_at == null && String(r.email || '') !== '', key: (r) => r.site_id + '|' + String(r.email || '').toLowerCase() }],
    presence_deleted_customers: [{ cols: ['studio_site_id', 'client_id'], where: (r) => r.restored_at == null && r.closed_at == null }],
    presence_agency_clients: [['site_id']], presence_service_links: [['project_id']], presence_customer_agency: [['customer_client_id']],
    presence_sites: [['client_id']], presence_entitlements: [['client_id', 'product']],
  },
});
// the outside world: sign-ins made, emails sent, hosting asked for
const outside = { logins: [], mails: [], hosts: [] };
const inner = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)), method = (init.method || 'GET').toUpperCase();
  let body = null; try { body = init.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
  const ok = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
    if (users.taken && body.email === users.taken) return ok({ msg: 'A user with this email address has already been registered', code: 'email_exists' }, 422);
    const id = crypto.randomUUID(); outside.logins.push(body.email); users['jwt-' + id] = { id, email: body.email }; return ok({ id, email: body.email });
  }
  if (u.pathname === '/auth/v1/admin/generate_link') return ok({ action_link: 'https://app.test/sign-in-link', properties: { action_link: 'https://app.test/sign-in-link' } });
  if (u.hostname === 'api.resend.com') { outside.mails.push({ to: body.to, subject: body.subject }); return ok({ id: 'mail-' + outside.mails.length }); }
  if (u.hostname === 'api.netlify.com') {
    outside.hosts.push(method + ' ' + u.pathname);
    if (method === 'POST' && u.pathname === '/api/v1/sites') return ok({ id: 'nf-' + outside.hosts.length, name: body.name, default_domain: body.name + '.netlify.app' });
    const id = u.pathname.split('/').pop(); return ok({ id, default_domain: id + '.netlify.app' });
  }
  return inner(url, init);
};
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const C = await import('../../supabase/functions/presence/routes/customers.ts');
const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');
const { handleStudioCustomers } = await import('../../supabase/functions/presence/routes/client_delivery.ts');
const { runCustomerTrashSweep, bareCustomer } = await import('../../supabase/functions/presence/ops/customer_trash.ts');
const { memberWriteNeeds } = await import('../../supabase/functions/presence/lib/site_roles.ts');
const { sweepIssues } = await import('../../supabase/functions/presence/routes/system.ts');
const CRM = await import('../../supabase/functions/presence/routes/crm.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: STUDIO, client_id: STUDIO_CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'staff', userId: UID, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const member = { agency_id: AG, member_id: MEMBER, email: 'owner@studio.test', role: 'owner', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} };
const cors = {};
const req = (method, path, b, h = {}) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': 'jwt-owner', ...h }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const add = (b) => S.handleSalesAddCustomer(req('POST', '/sales/customers', b), site, owner, cors).then(res);
const route = (method, path, b) => C.handleCustomerRoute(req(method, path, b), path, method, site, owner, cors).then((r) => r ? res(r) : { status: 0, body: null });
const agency = (method, path, b) => handleAgency(req(method, path, b), path, method, member, owner, cors).then(res);
const T = () => db.tables;
const base = () => ({
  presence_sites: [{ id: STUDIO, client_id: STUDIO_CLIENT, edition: 'presence', status: 'live' }, { id: THEIRS, client_id: OTHER_STUDIO, edition: 'presence', status: 'live' }],
  clients: [{ id: STUDIO_CLIENT, name: 'Bright Studio', email: 'owner@studio.test', status: 'active' }, { id: OTHER_STUDIO, name: 'Someone Else', email: 'taken@else.test', status: 'active' }],
  presence_agencies: [{ id: AG, name: 'Bright Studio', status: 'active', client_limit: 25, seat_limit: 5, plan: 'agency', branding: {} }],
  presence_agency_members: [{ id: MEMBER, agency_id: AG, email: 'owner@studio.test', role: 'owner', status: 'active', user_id: UID }],
  presence_contacts: [], presence_projects: [], presence_service_links: [], presence_customer_agency: [], presence_agency_clients: [],
  presence_entitlements: [], presence_identity: [], presence_brand_profile: [], presence_first_run: [], presence_deleted_customers: [], presence_invoices: [],
  presence_monitor_connections: [], presence_settings: [],
});

// ═══ 1. Save: the customer and nothing else ═══
db.reset(base());
const saved = await add({ mode: 'save', name: 'Maya Ortiz', business_name: 'Willow & Ash Bakery', email: 'Maya@WillowAsh.example' });
const CID = saved.body?.data?.client_id;
const cust = () => T().clients.find((c) => c.id === CID);
ok('save: answers saved and new, with their customer record', saved.status === 201 && saved.body?.data?.saved === true && saved.body?.data?.created === true && !!CID, JSON.stringify(saved));
ok('save: the record is named for the business and has no owner (nobody can sign in to it)', cust()?.name === 'Willow & Ash Bakery' && !cust()?.email && !cust()?.contact_email && !cust()?.contact_id);
ok('save: no website or workspace, no plan, no hosting, no sign-in, no email', !T().presence_sites.some((s) => s.client_id === CID) && !T().presence_entitlements.length && !outside.hosts.length && !outside.logins.length && !outside.mails.length);
const link = T().presence_service_links.find((l) => l.customer_client_id === CID);
ok('save: their project and the studio’s link put them on Customers', !!link && link.agency_site_id === STUDIO && link.status === 'active' && !link.customer_site_id && T().presence_projects.some((p) => p.id === link.project_id && p.name === 'Willow & Ash Bakery'));
const person = T().presence_contacts.find((c) => c.client_id === CID);
ok('save: the person is in the contacts, lower-cased, with their business, belonging to the customer', person?.email === 'maya@willowash.example' && person?.name === 'Maya Ortiz' && person?.company === 'Willow & Ash Bakery');
const roster = await res(await handleStudioCustomers(req('GET', '/studio/customers'), 'jwt-owner', site, owner, cors));
ok('save: the Customers list shows them', roster.status === 200 && (roster.body?.data || []).some((r) => r.client_id === CID), JSON.stringify(roster.body));
const again = await add({ mode: 'save', name: 'Maya', email: 'maya@willowash.example' });
ok('save: the same person again is the same customer, nothing new made', again.status === 200 && again.body?.data?.already === true && again.body?.data?.client_id === CID && T().clients.length === 3);
const asked = await add({ mode: 'save', name: 'Pat', email: 'taken@else.test' });
ok('save: someone with their own account elsewhere is asked, never taken', asked.status === 200 && asked.body?.data?.requested === true && !T().presence_service_links.some((l) => l.customer_client_id === OTHER_STUDIO));
{
  db.tables.presence_contacts.push({ id: 'c0ffee00-0000-4000-8000-000000000001', site_id: STUDIO, name: 'Lee', email: 'lee@shop.example', company: '', client_id: null, deleted_at: null, created_at: '2026-10-01T00:00:00Z' });
  const lee = await add({ mode: 'save', name: 'Lee Park', business_name: 'Park Shoes', email: 'lee@shop.example' });
  const c = T().presence_contacts.filter((x) => x.email === 'lee@shop.example');
  ok('save: a person already in the contacts becomes the customer’s (no second contact), their business filled in', lee.status === 201 && c.length === 1 && c[0].client_id === lee.body?.data?.client_id && c[0].company === 'Park Shoes' && c[0].name === 'Lee');
}

// ═══ 2. Their profile ═══
{
  const r = await route('GET', `/sales/customers/${CID}`);
  ok('profile: no website, never invited; it offers Create website and Invite', r.status === 200 && r.body?.data?.website?.state === 'none' && r.body?.data?.portal?.state === 'none' && r.body?.data?.offers?.create_website === true && r.body?.data?.offers?.invite === true && r.body?.data?.offers?.invite_again === false, JSON.stringify(r.body));
  ok('profile: it names the business and the person to invite', r.body?.data?.business_name === 'Willow & Ash Bakery' && r.body?.data?.person?.email === 'maya@willowash.example' && r.body?.data?.portal?.email === 'maya@willowash.example');
  const stranger = await route('GET', `/sales/customers/${OTHER_STUDIO}`);
  ok('profile: another studio’s customer is not yours', stranger.status === 404);
  const rec = await res(await CRM.handleCrmRecord(req('GET', `/crm/record?client_id=${CID}`), 'jwt-owner', site, owner, cors));
  ok('their record names the business and the person, and their email from their contact (nobody owns the record yet)', rec.status === 200 && rec.body?.data?.header?.name === 'Willow & Ash Bakery' && rec.body?.data?.header?.email === 'maya@willowash.example' && rec.body?.data?.header?.status === 'customer', JSON.stringify(rec.body?.data?.header));
  ok('pure: what a website is', C.websiteState(null, '') === 'none' && C.websiteState({ edition: 'presence' }, '') === 'ours' && C.websiteState({ edition: 'monitor' }, 'theirs.example') === 'elsewhere' && C.websiteState({ edition: 'monitor' }, '') === 'workspace');
  ok('pure: what the profile offers', JSON.stringify(C.customerOffers('workspace', 'waiting')) === JSON.stringify({ create_website: true, invite: false, invite_again: true }) && C.customerOffers('ours', 'joined').create_website === false && C.customerOffers('elsewhere', 'none').invite === true);
}

// ═══ 3. Create website: + New site for THEIR record ═══
{
  const before = T().clients.length;
  const r = await agency('POST', '/agency/sites', { business_name: 'Willow & Ash Bakery', client_id: CID, industry_key: 'restaurant' });
  const made = T().presence_sites.find((s) => s.client_id === CID);
  ok('create website: made for their record, no second customer', r.status === 201 && r.body?.data?.client_id === CID && r.body?.data?.for_customer === true && T().clients.length === before && made?.id === r.body?.data?.site_id, JSON.stringify(r.body));
  ok('create website: a hosted site, on the studio’s Sites list, with the kind of business picked', made?.edition === 'presence' && T().presence_agency_clients.some((p) => p.site_id === made.id && p.agency_id === AG && p.status === 'active') && T().presence_settings.some((x) => x.site_id === made.id && x.industry_key === 'restaurant') && outside.hosts.some((h) => h.startsWith('POST /api/v1/sites')));
  ok('create website: their profile and Customers now know the site; nobody was emailed', T().presence_service_links.find((l) => l.customer_client_id === CID).customer_site_id === made.id && !outside.mails.length && !outside.logins.length);
  const twice = await agency('POST', '/agency/sites', { business_name: 'Willow & Ash Bakery', client_id: CID });
  ok('create website: only once (they already have one)', twice.status === 409 && twice.body?.error === 'has_website');
  const notMine = await agency('POST', '/agency/sites', { business_name: 'X', client_id: OTHER_STUDIO });
  ok('create website: never for someone who isn’t your customer', notMine.status === 404);
}

// ═══ 4. Invite to their portal ═══
{
  const r = await route('POST', `/sales/customers/${CID}/invite`, {});
  ok('invite: their own sign-in, at the person’s email, and the email went', r.status === 200 && r.body?.data?.invited === true && r.body?.data?.email === 'maya@willowash.example' && outside.logins.includes('maya@willowash.example') && outside.mails.some((m) => String(m.to).includes('maya@willowash.example')), JSON.stringify(r.body));
  ok('invite: the record now names them as its owner', cust()?.email === 'maya@willowash.example' && !!cust()?.contact_id);
  const mails = outside.mails.length;
  const resend = await route('POST', `/sales/customers/${CID}/invite`, {});
  ok('invite: someone already invited gets the sign-in link again, no second sign-in', resend.status === 200 && resend.body?.data?.again === true && outside.mails.length === mails + 1 && outside.logins.filter((e) => e === 'maya@willowash.example').length === 1);
  // a customer with no website yet gets a workspace with no website first (the portal needs it)
  const s2 = await add({ mode: 'save', name: 'Ana', business_name: 'Ana Tutoring', email: 'ana@tutor.example' });
  const C2 = s2.body?.data?.client_id;
  const inv = await route('POST', `/sales/customers/${C2}/invite`, { email: 'ana@tutor.example' });
  const ws = T().presence_sites.find((s) => s.client_id === C2);
  ok('invite with no website: a workspace with no website (no hosting), on Sites, and the invite', inv.status === 200 && inv.body?.data?.invited === true && ws?.edition === 'monitor' && !outside.hosts.some((h) => h.includes(ws.id)) && T().presence_agency_clients.some((p) => p.site_id === ws.id), JSON.stringify(inv.body));
  const prof = await route('GET', `/sales/customers/${C2}`);
  // invited and not in yet: 'waiting' for a week, then 'expired' (the in-memory database's clock starts Nov 8)
  ok('…and their profile still offers Create website (a workspace isn’t a website), and the sign-in link again', prof.body?.data?.website?.state === 'workspace' && prof.body?.data?.offers?.create_website === true && ['waiting', 'expired'].includes(prof.body?.data?.portal?.state) && prof.body?.data?.offers?.invite_again === true, JSON.stringify(prof.body?.data));
  const up = await agency('POST', '/agency/sites', { business_name: 'Ana Tutoring', client_id: C2 });
  ok('create website on a workspace: the same site becomes a hosted one (nothing added to the count)', up.status === 201 && up.body?.data?.site_id === ws.id && T().presence_sites.find((s) => s.id === ws.id).edition === 'presence');
  const s3 = await add({ mode: 'save', name: 'Bo', email: 'bo@corner.example' });
  const bad = await route('POST', `/sales/customers/${s3.body?.data?.client_id}/invite`, { email: 'not an email' });
  ok('invite: an address that isn’t one is refused, nothing made', bad.status === 422 && !T().presence_sites.some((s) => s.client_id === s3.body?.data?.client_id));
  users.taken = 'bo@corner.example';
  const clash = await route('POST', `/sales/customers/${s3.body?.data?.client_id}/invite`, {});
  ok('invite: an email that already signs in elsewhere is refused in plain words', clash.status === 409 && clash.body?.error === 'account_exists' && /already has a Studio OS account/.test(clash.body?.message || ''), JSON.stringify(clash.body));
  delete users.taken;
}

// ═══ 4b. Their site lives somewhere else: watch it (Eric's external-client case) ═══
{
  const s6 = await add({ mode: 'save', name: 'Rae', business_name: 'Acme Bakery', email: 'rae@acme.example' });
  const C6 = s6.body?.data?.client_id;
  const bad = await route('POST', `/sales/customers/${C6}/website`, { address: 'not an address' });
  ok('elsewhere: an address that isn’t one is refused, nothing made', bad.status === 422 && !T().presence_sites.some((x) => x.client_id === C6));
  const hosts = outside.hosts.length, mails = outside.mails.length;
  const r = await route('POST', `/sales/customers/${C6}/website`, { address: 'https://www.acmebakery.example/menu' });
  const ws = T().presence_sites.find((x) => x.client_id === C6);
  ok('elsewhere: a workspace with no website of ours, the address on file where Search Console reads it', r.status === 200 && r.body?.data?.address === 'www.acmebakery.example' && ws?.edition === 'monitor' && T().presence_monitor_connections.some((m) => m.site_id === ws.id && m.domain === 'www.acmebakery.example'), JSON.stringify(r.body));
  ok('elsewhere: on Sites and linked to their profile; no hosting, nobody emailed', T().presence_agency_clients.some((p) => p.site_id === ws.id) && T().presence_service_links.find((l) => l.customer_client_id === C6).customer_site_id === ws.id && outside.hosts.length === hosts && outside.mails.length === mails);
  const prof = await route('GET', `/sales/customers/${C6}`);
  ok('elsewhere: their profile says their website lives on its own host, and no longer offers Create website', prof.body?.data?.website?.state === 'elsewhere' && prof.body?.data?.website?.address === 'www.acmebakery.example' && prof.body?.data?.offers?.create_website === false);
  const again = await route('POST', `/sales/customers/${C6}/website`, { address: 'other.example' });
  ok('elsewhere: an address already on file is changed on their website page, not here', again.status === 409 && again.body?.error === 'has_address');
  const hosted = await route('POST', `/sales/customers/${CID}/website`, { address: 'other.example' });
  ok('elsewhere: a customer with a website of ours is left alone', hosted.status === 409 && hosted.body?.error === 'has_website');
  const notMine = await route('POST', `/sales/customers/${OTHER_STUDIO}/website`, { address: 'x.example' });
  ok('elsewhere: never for someone who isn’t your customer', notMine.status === 404);
}

// ═══ 5. Delete and Restore ═══
{
  const siteId = T().presence_sites.find((s) => s.client_id === CID).id;
  const noChoice = await route('POST', `/sales/customers/${CID}/delete`, {});
  ok('delete: a customer with a website needs the choice first; nothing changes', noChoice.status === 400 && T().presence_service_links.find((l) => l.customer_client_id === CID).status === 'active');
  const del = await route('POST', `/sales/customers/${CID}/delete`, { site: 'trash' });
  ok('delete: done, and it says for how long they can come back', del.status === 200 && del.body?.data?.deleted === true && del.body?.data?.days === 30 && del.body?.data?.site?.kept === false, JSON.stringify(del.body));
  ok('delete: off Customers, their project and the person set aside', T().presence_service_links.filter((l) => l.customer_client_id === CID).every((l) => l.status === 'ended') && T().presence_projects.filter((p) => p.client_id === CID).every((p) => !!p.deleted_at) && T().presence_contacts.filter((c) => c.client_id === CID).every((c) => !!c.deleted_at));
  ok('delete: their website went to the Trash on Sites; nothing was deleted for good', T().presence_agency_clients.find((p) => p.site_id === siteId).status === 'trashed' && T().presence_sites.some((s) => s.id === siteId) && T().clients.some((c) => c.id === CID));
  const roster2 = await res(await handleStudioCustomers(req('GET', '/studio/customers'), 'jwt-owner', site, owner, cors));
  ok('delete: the Customers list no longer shows them', !(roster2.body?.data || []).some((r) => r.client_id === CID));
  const gone = await res(await S.handleSalesDeleted(site, cors));
  const row = (gone.body?.data?.customers || []).find((x) => x.id === CID);
  ok('Recently deleted: lists them, and that their website went with them', !!row && row.name === 'Willow & Ash Bakery' && row.site_went === true, JSON.stringify(gone.body?.data?.customers));
  const twice = await route('POST', `/sales/customers/${CID}/delete`, { site: 'keep' });
  ok('delete: twice is nothing (they’re not your customer any more)', twice.status === 404);
  const back = await route('POST', `/sales/customers/${CID}/restore`);
  ok('restore: they’re back, with their website', back.status === 200 && back.body?.data?.restored === true && back.body?.data?.site?.restored === true, JSON.stringify(back.body));
  ok('restore: the link, the project, the person and the website are exactly as they were', T().presence_service_links.filter((l) => l.customer_client_id === CID).every((l) => l.status === 'active') && T().presence_projects.filter((p) => p.client_id === CID).every((p) => !p.deleted_at) && T().presence_contacts.filter((c) => c.client_id === CID).every((c) => !c.deleted_at) && T().presence_agency_clients.find((p) => p.site_id === siteId).status === 'active');
  const re = await route('POST', `/sales/customers/${CID}/restore`);
  ok('restore: twice finds nothing to bring back', re.status === 404);
  const keep = await route('POST', `/sales/customers/${CID}/delete`, { site: 'keep' });
  ok('delete, keeping the website: it stays on Sites as it was', keep.status === 200 && keep.body?.data?.site?.kept === true && T().presence_agency_clients.find((p) => p.site_id === siteId).status === 'active');
  const gone2 = await res(await S.handleSalesDeleted(site, cors));
  ok('Recently deleted: says the website was kept', (gone2.body?.data?.customers || []).find((x) => x.id === CID)?.site_kept === true);
  await route('POST', `/sales/customers/${CID}/restore`);
  const self = await route('POST', `/sales/customers/${STUDIO_CLIENT}/delete`, { site: 'keep' });
  ok('delete: the studio itself is never a customer to delete', self.status === 400);
}
{
  // before migration 0245
  const s4 = await add({ mode: 'save', name: 'Kim', email: 'kim@x.example' });
  const K = s4.body?.data?.client_id;
  const keepTables = db.tables.presence_deleted_customers; delete db.tables.presence_deleted_customers;
  db.fail.add('presence_deleted_customers');
  const r = await route('POST', `/sales/customers/${K}/delete`, { site: 'keep' });
  db.fail.delete('presence_deleted_customers'); db.tables.presence_deleted_customers = keepTables;
  ok('before the database step: Delete says so and changes nothing', (r.status === 503 || r.status === 502) && T().presence_service_links.find((l) => l.customer_client_id === K).status === 'active', JSON.stringify(r));
}

// ═══ 6. The daily sweep after 30 days ═══
{
  const old = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
  const s5 = await add({ mode: 'save', name: 'Mistake', email: 'oops@x.example' });
  const BARE = s5.body?.data?.client_id;
  await route('POST', `/sales/customers/${BARE}/delete`, {});
  const withSite = T().presence_sites.find((s) => s.client_id === CID).id;
  await route('POST', `/sales/customers/${CID}/delete`, { site: 'keep' });
  for (const r of T().presence_deleted_customers) if (!r.restored_at) r.deleted_at = old(31);
  const out = await runCustomerTrashSweep(20);
  ok('sweep: rows past 30 days are let go', out.closed >= 2 && T().presence_deleted_customers.filter((r) => !r.restored_at).every((r) => !!r.closed_at || !T().clients.some((c) => c.id === r.client_id)), JSON.stringify(out));
  ok('sweep: a bare record (no sign-in, no website, no invoice) goes for good', !T().clients.some((c) => c.id === BARE));
  ok('sweep: a customer with a website kept on Sites keeps their record', T().clients.some((c) => c.id === CID) && T().presence_sites.some((s) => s.id === withSite));
  ok('sweep: its report is counts only, and a clean run reads as healthy', !Object.values(out).includes(false) && sweepIssues({ customer_trash: out }).length === 0);
  const rs = await route('POST', `/sales/customers/${CID}/restore`);
  ok('after 30 days Restore finds nothing', rs.status === 404);
  ok('pure: only a bare record may go', bareCustomer({ client: { email: null }, sites: 0, links: 0, invoices: 0 }) && !bareCustomer({ client: { email: 'a@b.c' }, sites: 0, links: 0, invoices: 0 }) && !bareCustomer({ client: {}, sites: 1, links: 0, invoices: 0 }) && !bareCustomer({ client: {}, sites: 0, links: 0, invoices: 1 }) && !bareCustomer({ client: null, sites: 0, links: 0, invoices: 0 }));
}

// ═══ 7. Who may ═══
ok('gate: deleting a customer needs delete', memberWriteNeeds(`/sales/customers/${STUDIO}/delete`, 'POST') === 'delete');
ok('gate: restoring, inviting and keeping the address of a site elsewhere are everyday edits', ['restore', 'invite', 'website'].every((w) => memberWriteNeeds(`/sales/customers/${STUDIO}/${w}`, 'POST') === 'edit'));

// ═══ 8. The deploy gap ═══
// The pages go live on merge and this server only with the deploy after it. The box sends
// 'connect' with save: true, which a server from before item 241 reads as connect (a contact,
// nobody emailed) instead of "set up their website and invite them". This one saves the customer.
{
  db.reset(base());
  const logins = outside.logins.length, mails = outside.mails.length;
  const viaBox = await add({ mode: 'connect', save: true, name: 'Ivy Chen', business_name: 'Ivy Florals', email: 'ivy@florals.example' });
  const id = viaBox.body?.data?.client_id;
  ok('gap: what the box sends saves the customer here, with no website, sign-in or email', viaBox.status === 201 && viaBox.body?.data?.mode === 'save' && viaBox.body?.data?.saved === true && T().presence_service_links.some((l) => l.customer_client_id === id && l.status === 'active') && !T().presence_sites.some((s) => s.client_id === id) && outside.logins.length === logins && outside.mails.length === mails, JSON.stringify(viaBox.body));
  const plain = await add({ mode: 'connect', name: 'Oz', email: 'oz@plain.example' });
  ok('gap: connect without save still only saves a contact (the CSV import), no customer record', plain.status === 200 && plain.body?.data?.mode === 'connect' && plain.body?.data?.connected === false && T().presence_contacts.some((c) => c.email === 'oz@plain.example' && !c.client_id) && T().clients.length === 3, JSON.stringify(plain.body));
}

console.log(`\n════ CUSTOMERS, ONE STEP AT A TIME (builder item 241): ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
