// ── Sales 37 (owners and Mine) and sales 64's F7 (My tasks' next step) ──────────
//   deno run --allow-read --allow-env --allow-net tests/presence/owners_mine_37_test.mjs
// F7: each project's next step is picked from the steps My tasks shows (open, and yours
// or nobody's), so a teammate's step, or a finished one, at the top of a checklist no
// longer turns every one of yours into "later" behind Show all.
import { installFakePostgrest } from './fake_pgrst.mjs';
const ME_ID = 'aaaaaaaa-0000-4000-8000-000000000001', MATE_ID = 'aaaaaaaa-0000-4000-8000-000000000002', OUTSIDER = 'aaaaaaaa-0000-4000-8000-000000000009';
const SITE = '11111111-1111-4111-8111-111111111111', AGENCY = 'cccccccc-0000-4000-8000-000000000001', CLIENT_SITE = '11111111-1111-4111-8111-1111111111c1';
const db = installFakePostgrest({ users: { 'jwt-owner': { id: ME_ID, email: 'owner@studio.test' }, 'jwt-mate': { id: MATE_ID, email: 'alex@studio.test' } } });
const T = await import('../../supabase/functions/presence/lib/my_tasks.ts');
const O = await import('../../supabase/functions/presence/lib/team_owner.ts');
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const TD = await import('../../supabase/functions/presence/routes/todos.ts');
const SI = await import('../../supabase/functions/presence/routes/service_intake.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const ME = 'aaaaaaaa-0000-4000-8000-000000000001', MATE = 'aaaaaaaa-0000-4000-8000-000000000002';
const PROJ = 'bbbbbbbb-0000-4000-8000-000000000001';
const step = (id, title, sort, extra = {}) => ({ id, project_id: PROJ, title, status: 'todo', due_date: null, assigned_to: null, client_action_required: false, sort_order: sort, ...extra });
const run = (projectTasks, userId = ME) => T.buildMyTasks({ deals: [], dealTasks: [], taskDeals: [], userId, projectTasks, projects: [{ id: PROJ, name: 'Northside Dental', status: 'active' }] })
  .map((t) => `${t.title}:${t.later ? 'later' : 'now'}`);

// ═══ F7: a teammate's step first on the checklist ═══
eq('a teammate’s first step no longer hides yours: your first open one is now', run([
  step('s1', 'Write the brief', 1, { assigned_to: MATE }),
  step('s2', 'Upload the new team photos', 2),
  step('s3', 'Check the contact form', 3, { assigned_to: ME }),
]), ['Upload the new team photos:now', 'Check the contact form:later']);
eq('a finished step at the top doesn’t count as next either', run([
  step('s0', 'Kickoff call', 0, { status: 'done' }),
  step('s2', 'Upload the new team photos', 2),
  step('s3', 'Check the contact form', 3),
]), ['Upload the new team photos:now', 'Check the contact form:later']);
eq('the teammate sees their own step as next, and none of yours', run([
  step('s1', 'Write the brief', 1, { assigned_to: MATE }),
  step('s2', 'Upload the new team photos', 2, { assigned_to: ME }),
], MATE), ['Write the brief:now']);
eq('a dated step of yours is now, wherever it sits', run([
  step('s1', 'Write the brief', 1),
  step('s2', 'Send the proof', 2, { due_date: '2026-11-20' }),
]), ['Send the proof:now', 'Write the brief:now']);

// ═══ sales 37: the team, and what is whose ═══
{
  const t = O.teamFrom(MATE_ID, [{ user_id: ME_ID, role: 'owner' }, { user_id: MATE_ID, role: 'designer' }, { user_id: null, role: 'support' }]);
  eq('the team: me, the business owner, and everyone who has signed in', t, { me: MATE_ID, owner: ME_ID, ids: [ME_ID, MATE_ID] });
  ok('a row with no owner is the business owner’s, not a teammate’s', O.isMine(O.teamFrom(ME_ID, [{ user_id: ME_ID, role: 'owner' }]), null) && !O.isMine(t, null) && O.isMine(t, MATE_ID) && !O.isMine(t, ME_ID));
  eq('Mine for the business owner takes in the ones nobody owns yet', O.mineFilter(O.teamFrom(ME_ID, [{ user_id: ME_ID, role: 'owner' }])), `&or=(assigned_to.eq.${ME_ID},assigned_to.is.null)`);
  eq('Mine for a teammate is their own', O.mineFilter(t), `&assigned_to=eq.${MATE_ID}`);
  ok('an owner can be set only to someone on the team, or nobody', O.ownerToSet(t, ME_ID).ok && O.ownerToSet(t, '').ok && !O.ownerToSet(t, OUTSIDER).ok && !O.ownerToSet(t, 'not-an-id').ok);
  eq('a person on no team is a team of one', O.teamFrom(ME_ID, []), { me: ME_ID, owner: ME_ID, ids: [ME_ID] });
}

// ═══ the routes, on the shared in-memory PostgREST ═══
const site = { id: SITE, client_id: null, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: ME_ID, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const mate = { kind: 'client', userId: MATE_ID, email: 'alex@studio.test', jwt: 'jwt-mate', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const deal = (id, title, assigned_to, extra = {}) => ({ id, site_id: SITE, title, stage: 'lead', source: 'manual', expected_value_cents: 0, expected_close: null, contact_id: null, converted_client_id: null, assigned_to, next_step: '', next_step_at: null, deleted_at: null, updated_at: '2026-11-10T10:00:00Z', created_at: '2026-11-01T10:00:00Z', ...extra });
const D1 = 'dddddddd-0000-4000-8000-000000000001', D2 = 'dddddddd-0000-4000-8000-000000000002', D3 = 'dddddddd-0000-4000-8000-000000000003';
const world = (extra = {}) => db.reset({
  presence_agencies: [{ id: AGENCY, name: 'Bright Studio', status: 'active', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} }],
  presence_agency_members: [
    { id: 'm1', agency_id: AGENCY, email: 'owner@studio.test', user_id: ME_ID, role: 'owner', status: 'active', created_at: '2026-01-01T00:00:00Z' },
    { id: 'm2', agency_id: AGENCY, email: 'alex@studio.test', user_id: MATE_ID, role: 'designer', status: 'active', created_at: '2026-02-01T00:00:00Z' },
  ],
  presence_agency_clients: [{ site_id: CLIENT_SITE, agency_id: AGENCY, status: 'active' }],
  presence_deals: [deal(D1, 'Mine', ME_ID, { next_step: 'Call Ana' }), deal(D2, 'Alex’s', MATE_ID, { next_step: 'Send the quote' }), deal(D3, 'From before owners', null, { next_step: 'Old step' })],
  presence_deal_tasks: [], presence_tasks: [], presence_projects: [], presence_contacts: [], presence_sales_templates: [], presence_deal_events: [],
  ...extra,
});
{
  world();
  const a = await res(await S.handleSalesDeals(req('GET', '/sales/deals?limit=100&mine=1'), site, owner, cors));
  eq('Pipeline’s Mine for the business owner: theirs and the ones from before owners', a.body.data.map((d) => d.title).sort(), ['From before owners', 'Mine']);
  const b = await res(await S.handleSalesDeals(req('GET', '/sales/deals?limit=100&mine=1'), site, mate, cors));
  eq('…and for a teammate: only theirs', b.body.data.map((d) => d.title), ['Alex’s']);
  const all = await res(await S.handleSalesDeals(req('GET', '/sales/deals?limit=100'), site, mate, cors));
  ok('Everyone is everyone’s, each with its owner', all.body.data.length === 3 && all.body.data.some((d) => d.assigned_to === MATE_ID));
  const made = await res(await S.handleSalesDeals(req('POST', '/sales/deals', { title: 'New one' }), site, mate, cors));
  ok('whoever adds a deal owns it', made.status === 201 && db.tables.presence_deals.find((d) => d.title === 'New one').assigned_to === MATE_ID, JSON.stringify(made.body));
  const bad = await res(await S.handleSalesDeal(req('PATCH', `/sales/deals/${D2}`, { assigned_to: OUTSIDER }), site, owner, D2, cors));
  ok('the owner can’t be set to someone off the team', bad.status === 422 && db.tables.presence_deals.find((d) => d.id === D2).assigned_to === MATE_ID);
  const good = await res(await S.handleSalesDeal(req('PATCH', `/sales/deals/${D2}`, { assigned_to: ME_ID }), site, owner, D2, cors));
  ok('…and can be changed to a teammate', good.status === 200 && db.tables.presence_deals.find((d) => d.id === D2).assigned_to === ME_ID);
}
{
  world();
  const m = await res(await S.handleSalesMyTasks(req('GET', '/sales/my-tasks'), site, mate, cors));
  eq('Home’s My tasks: a teammate sees only their deals’ next steps', m.body.data.items.map((t) => t.title), ['Send the quote']);
  const o = await res(await S.handleSalesMyTasks(req('GET', '/sales/my-tasks'), site, owner, cors));
  eq('…the business owner sees theirs and the ones nobody owns', o.body.data.items.map((t) => t.title).sort(), ['Call Ana', 'Old step']);
}
{
  world();
  const add = await res(await TD.handleSalesTasks(req('POST', '/sales/tasks', { title: 'Book the shoot' }), site, mate, cors));
  ok('whoever adds a to-do owns it', add.status === 201 && db.tables.presence_deal_tasks.find((t) => t.title === 'Book the shoot').assigned_to === MATE_ID, JSON.stringify(add.body));
  await TD.handleSalesTasks(req('POST', '/sales/tasks', { title: 'Order the prints' }), site, owner, cors);
  const mineMate = await res(await TD.handleSalesTasks(req('GET', '/sales/tasks?mine=1'), site, mate, cors));
  ok('To-dos’ Mine: a teammate sees their to-do and their deal’s step, not yours', mineMate.body.data.items.some((t) => t.title === 'Book the shoot') && !mineMate.body.data.items.some((t) => t.title === 'Order the prints' || t.title === 'Call Ana'));
  const every = await res(await TD.handleSalesTasks(req('GET', '/sales/tasks'), site, mate, cors));
  ok('Everyone: the team’s, each with its owner', every.body.data.items.some((t) => t.title === 'Order the prints' && t.owner === ME_ID) && every.body.data.items.some((t) => t.title === 'Book the shoot' && t.owner === MATE_ID));
  const named = await res(await TD.handleSalesTasks(req('POST', '/sales/tasks', { title: 'For Alex', assigned_to: MATE_ID }), site, owner, cors));
  ok('a to-do can be added for a teammate', named.status === 201 && db.tables.presence_deal_tasks.find((t) => t.title === 'For Alex').assigned_to === MATE_ID);
  const off = await res(await TD.handleSalesTasks(req('POST', '/sales/tasks', { title: 'Nope', assigned_to: OUTSIDER }), site, owner, cors));
  ok('…but not for someone off the team', off.status === 422);
}
{
  // before APPLY-0199: a to-do saves without its owner
  world();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const body = String(init.body || '');
    if (String(url).includes('/rest/v1/presence_deal_tasks') && (init.method || 'GET') === 'POST' && body.includes('assigned_to')) return new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'assigned_to' column of 'presence_deal_tasks' in the schema cache" }), { status: 400 });
    return real(url, init);
  };
  const add = await res(await TD.handleSalesTasks(req('POST', '/sales/tasks', { title: 'Before 0199' }), site, mate, cors));
  globalThis.fetch = real;
  ok('before APPLY-0199 the to-do still saves, without an owner', add.status === 201 && db.tables.presence_deal_tasks.some((t) => t.title === 'Before 0199' && !t.assigned_to));
}
{
  world({ presence_support_requests: [
    { id: 'eeeeeeee-0000-4000-8000-000000000001', site_id: CLIENT_SITE, subject: 'Swap the hero photo', status: 'open', priority: 'normal', requester: 'u:x', assigned_to: null, deleted_at: null, updated_at: '2026-11-10T00:00:00Z' },
    { id: 'eeeeeeee-0000-4000-8000-000000000002', site_id: CLIENT_SITE, subject: 'New hours in the footer', status: 'open', priority: 'normal', requester: 'u:x', assigned_to: MATE_ID, deleted_at: null, updated_at: '2026-11-11T00:00:00Z' },
  ] });
  const owner2 = await O.studioOwnerOfSite(CLIENT_SITE);
  ok('a request a client sends starts with the studio’s business owner', owner2 === ME_ID);
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/client_delivery.ts', import.meta.url));
  ok('…the portal’s request route sets it', /studioOwnerOfSite\(s\)/.test(src) && /\.\.\.\(owner \? \{ assigned_to: owner \} : \{\}\)/.test(src));
  const si = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/service_intake.ts', import.meta.url));
  ok('the requests search is a filter PostgREST reads (it had no "=")', /&subject=ilike\./.test(si) && !/&subject\.ilike\./.test(si));
  ok('Requests’ Mine is the studio’s own, through the same rule', /if \(studio && u\.searchParams\.get\('mine'\) === '1'\) path \+= mineFilter\(await teamOf\(principal\)\)/.test(si));
}
{
  // what was done lately follows Mine too, each with its owner
  world({ presence_deal_tasks: [
    { id: 'tttttttt-0000-4000-8000-000000000001', site_id: SITE, deal_id: D1, title: 'Sent the welcome', status: 'done', completed_at: new Date().toISOString(), due_date: null, assigned_to: ME_ID, deleted_at: null },
    { id: 'tttttttt-0000-4000-8000-000000000002', site_id: SITE, deal_id: D2, title: 'Sent the quote', status: 'done', completed_at: new Date().toISOString(), due_date: null, assigned_to: MATE_ID, deleted_at: null },
  ] });
  const m = await res(await TD.handleSalesTasks(req('GET', '/sales/tasks?mine=1'), site, mate, cors));
  eq('To-dos’ Done under Mine: only the teammate’s own', m.body.data.done.map((t) => t.title), ['Sent the quote']);
  const e = await res(await TD.handleSalesTasks(req('GET', '/sales/tasks'), site, mate, cors));
  ok('…and under Everyone, both, each with its owner', e.body.data.done.length === 2 && e.body.data.done.some((t) => t.title === 'Sent the welcome' && t.owner === ME_ID));
}
{
  // the pages: the switch shows only with a second person, and the owner is changed through the routes above
  const read = (f) => Deno.readTextFileSync(new URL('../../' + f, import.meta.url));
  const pipe = read('pipeline.html'), todos = read('todos.html'), inbox = read('inbox.html');
  ok('Pipeline: Everyone / Mine in front of the stage chips', /<div class="ownbar" id="ownerBar" hidden><\/div>\s*<div class="bar" id="filters"/.test(pipe) && /data-own="mine"/.test(pipe) && /const teamOn=\(\)=>!!\(TEAM&&TEAM\.people\.length>1\)/.test(pipe));
  ok('Pipeline: Mine narrows every view', /const base=MINE&&teamOn\(\)\?DEALS\.filter\(isMineDeal\):DEALS;/.test(pipe));
  ok('Pipeline: the deal and its quick view change the owner through PATCH /sales/deals/:id', /api\('\/sales\/deals\/'\+encodeURIComponent\(id\),'PATCH',\{assigned_to:uid\|\|null\}\)/.test(pipe) && /id="dOwnSlot"/.test(pipe) && /data-own-sel/.test(pipe));
  ok('Pipeline: only active seats can own something, as the server checks', /\(m\.status\|\|'active'\)==='active'&&m\.user_id/.test(pipe));
  ok('To-dos: opens on Mine, and a new one can be a teammate’s', /let TEAM=null,MINE=true;/.test(todos) && /body\.assigned_to=ow\.value/.test(todos) && /id="addOwner"/.test(todos));
  ok('Support: Mine filters the list; the request’s picker is called Owner', /\.filter\(enqMatch\)\.filter\(ownMatch\)/.test(inbox) && />Owner <select id="supAsg">/.test(inbox) && !/Assigned to <select/.test(inbox));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
