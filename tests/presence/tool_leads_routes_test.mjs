// ── Free-tool leads on Prospects (sales review item 114): the real routes ─────
// A free Site Review / AI Visibility unlock mirrors the visitor into
// audit_leads; these routes surface them, and one click makes a contact AND a
// deal. Platform staff only — audit_leads has no site_id, so a client owner,
// a seat or a scoped studio must never read or write it. Real handlers against
// the shared in-memory PostgREST; all names made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/tool_leads_routes_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('1'), OWNER = uuid('2'), U = uuid('3'), L1 = uuid('a'), L2 = uuid('b'), L3 = uuid('c');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@example.com' } }, ownSite: { 'jwt-owner': SITE } });

// nothing here may leave the building: anything but the fake database is recorded
const pg = globalThis.fetch;
let outside = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== 'db.test') { outside.push(`${(init.method || 'GET').toUpperCase()} ${u.hostname}`); return new Response('{}', { status: 404 }); }
  return pg(url, init);
};
const PX = await import('../../supabase/functions/presence/routes/prospects.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
const cors = {};
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const staff = { kind: 'staff', userId: U, tenantId: null, role: 'owner', email: 'eric@example.com', jwt: 'jwt-staff', requestId: 't' };
const clientOwner = { kind: 'client', userId: U, role: 'client', email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't' };
const scopedStudio = { ...clientOwner, scope: { site_id: SITE, name: 'Alpha' } };
const req = (method, path, body) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const lead = (id, over = {}) => ({
  id, created_at: `2026-11-0${id === L1 ? 9 : 8}T12:00:00Z`, tool: 'site_review',
  business_name: 'Cedar Core Plumbing', client_email: 'pat@cedarcore.example', url: 'https://cedarcore.example',
  city: 'Burbank', business_type: 'Plumber', score: 41, status: 'new', contact_id: null, deal_id: null,
  notes: 'Free Tools report: https://tools.example/report.html?id=rep-1', ...over,
});
const leads = () => db.tables.audit_leads || [];
const world = (rows) => { db.reset({ presence_sites: [{ id: SITE, client_id: OWNER }], audit_leads: rows }); outside = []; };

// ═══ staff only: everyone else is refused, with nothing read or written ═══
{
  world([lead(L1)]);
  for (const [who, p] of [['a client owner', clientOwner], ['a scoped studio', scopedStudio]]) {
    const g = await res(await PX.handleToolLeads(site, p, cors));
    const c = await res(await PX.handleToolLeadConvert(req('POST', `/sales/tool-leads/${L1}/convert`), site, p, L1, cors));
    const m = await res(await PX.handleToolLead(req('PATCH', `/sales/tool-leads/${L1}`, { status: 'not_a_fit' }), site, p, L1, cors));
    ok(`${who} is refused on all three routes`, g.status === 403 && c.status === 403 && m.status === 403 && /staff only/.test(g.body.message));
  }
  ok('nothing was converted or re-stamped by the refusals', leads()[0].status === 'new' && !leads()[0].deal_id && (db.tables.presence_deals || []).length === 0);
}

// ═══ the list: newest first, plain tool words, the report link out of the notes ═══
{
  world([lead(L1), lead(L2, { tool: 'ai_visibility', business_name: null, client_email: 'sam@quietcafe.example', score: 82, url: null, notes: null }), lead(L3, { status: 'not_a_fit' })]);
  const r = await res(await PX.handleToolLeads(site, staff, cors));
  ok('staff get the leads, newest first, without the not-a-fit one', r.status === 200 && r.body.data.length === 2 && r.body.data[0].id === L1);
  const [a, b] = r.body.data;
  ok('each lead carries the words the page shows', a.tool_word === 'Site Review' && b.tool_word === 'AI Visibility Check' && a.score === 41 && a.business_name === 'Cedar Core Plumbing');
  ok('the report link is lifted out of the notes, and the notes stay server-side', a.report_url === 'https://tools.example/report.html?id=rep-1' && b.report_url === null && !('notes' in a));
}

// ═══ "→ Contact + deal": one click, once ═══
{
  world([lead(L1)]);
  const r = await res(await PX.handleToolLeadConvert(req('POST', `/sales/tool-leads/${L1}/convert`), site, staff, L1, cors));
  const contact = (db.tables.presence_contacts || [])[0];
  const deal = (db.tables.presence_deals || [])[0];
  ok('one click makes the contact and the deal together', r.status === 201 && contact && deal && r.body.data.deal.id === deal.id && r.body.data.contact.id === contact.id);
  ok('the contact is the person who left their email', contact.name === 'Cedar Core Plumbing' && contact.email === 'pat@cedarcore.example' && contact.site_id === SITE);
  ok('the deal starts at lead with the score, their site and the report in its notes',
    deal.stage === 'lead' && deal.source === 'free_tools' && deal.contact_id === contact.id
    && /Score: 41\/100/.test(deal.notes) && /cedarcore\.example/.test(deal.notes) && /tools\.example\/report/.test(deal.notes), deal.notes);
  ok('the lead remembers both and reads converted', leads()[0].contact_id === contact.id && leads()[0].deal_id === deal.id && leads()[0].status === 'converted');
  const again = await res(await PX.handleToolLeadConvert(req('POST', `/sales/tool-leads/${L1}/convert`), site, staff, L1, cors));
  ok('a second click returns the same deal, never a twin', again.status === 200 && again.body.already_converted === true && (db.tables.presence_deals || []).length === 1);
  const list = await res(await PX.handleToolLeads(site, staff, cors));
  ok('a converted lead still shows, so the row can open its deal', list.body.data.length === 1 && list.body.data[0].deal_id === deal.id);
  ok('nothing left the building (no email, no outside call)', outside.length === 0);
}

// ═══ an existing contact with that email is reused, never duplicated ═══
{
  world([lead(L1)]);
  db.tables.presence_contacts = [{ id: uuid('9'), site_id: SITE, name: 'Pat Cedar', email: 'pat@cedarcore.example', deleted_at: null }];
  const r = await res(await PX.handleToolLeadConvert(req('POST', `/sales/tool-leads/${L1}/convert`), site, staff, L1, cors));
  ok('the click reuses this site\'s contact for that email', r.status === 201 && r.body.data.contact.id === uuid('9') && (db.tables.presence_contacts || []).length === 1);
}

// ═══ status: contacted and not-a-fit by hand; nonsense refused ═══
{
  world([lead(L1)]);
  const r = await res(await PX.handleToolLead(req('PATCH', `/sales/tool-leads/${L1}`, { status: 'contacted' }), site, staff, L1, cors));
  ok('a lead can be marked contacted', r.status === 200 && r.body.data.status === 'contacted');
  const bad = await res(await PX.handleToolLead(req('PATCH', `/sales/tool-leads/${L1}`, { status: 'converted' }), site, staff, L1, cors));
  ok('converted is the convert\'s to set, not the patch\'s; nonsense is refused too', bad.status === 422);
  await PX.handleToolLead(req('PATCH', `/sales/tool-leads/${L1}`, { status: 'not_a_fit' }), site, staff, L1, cors);
  const list = await res(await PX.handleToolLeads(site, staff, cors));
  ok('not a fit leaves the list but keeps the row', list.body.data.length === 0 && leads().length === 1);
  const missing = await res(await PX.handleToolLead(req('PATCH', `/sales/tool-leads/${uuid('d')}`, { status: 'contacted' }), site, staff, uuid('d'), cors));
  ok('a lead that isn\'t there answers 404', missing.status === 404);
}

// ═══ before APPLY-0151 (no deal_id column) everything still works ═══
{
  world([lead(L1)]);
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname.includes('audit_leads') && (u.search.includes('deal_id') || String(init.body || '').includes('deal_id'))) {
      return new Response(JSON.stringify({ code: '42703', message: 'column audit_leads.deal_id does not exist' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    return real(url, init);
  };
  const list = await res(await PX.handleToolLeads(site, staff, cors));
  ok('pre-0151, the list falls back to the old shape and still answers', list.status === 200 && list.body.data.length === 1 && list.body.data[0].deal_id === null);
  const r = await res(await PX.handleToolLeadConvert(req('POST', `/sales/tool-leads/${L1}/convert`), site, staff, L1, cors));
  ok('pre-0151, the convert still works and stamps what it can', r.status === 201 && leads()[0].status === 'converted' && leads()[0].contact_id && !leads()[0].deal_id);
  globalThis.fetch = real;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
