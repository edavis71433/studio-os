// ── Projects routes (P2-D): what the delivery routes do, for two studios side by side ──
//   deno run --allow-read --allow-env --allow-net tests/presence/projects_routes_test.mjs
// Drives the real handlers (routes/projects.ts, lib/service_bridge.ts) against the
// in-memory PostgREST in fake_pgrst.mjs, and the real router (index.ts, with std's
// serve() handed a fake listener as in scoped_commerce_test, so no socket opens) for
// the gates and the wiring. Two studios share the database; studio B even holds rows
// that name studio A's project id. It proves:
//   1  tenant safety: A's calls never read or change B's rows, and every row they
//      write is A's, whatever the request body says
//   2  the studio side manages; the client side (a client_reviewer seat) reads only
//      what is client-visible and can change nothing
//   3  status moves are guarded: a move the ladder forbids, or one that lost a race
//      with another tab, changes nothing
//   4  a deal becomes one project, once: idempotent, race-safe, bridged to the customer
//   5  every meaningful change is recorded as an event
//   6  validation: dates, control characters, client actions
//   7  the gates and the wiring: the plan's feature gate and the reviewer boundary stand
//      in front of /projects; /projects/* and /client/* reach their handlers
//   8  the migration and the pure rules file (pins, each says why)
import { installFakePostgrest } from './fake_pgrst.mjs';

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const rid = (k, n) => `${k}${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`;
const SITE_A = uuid('a'), SITE_B = uuid('b'), SITE_M = uuid('c'), SITE_C = uuid('d'), SITE_CB = uuid('e');
const CLIENT_A = uuid('1'), CLIENT_B = uuid('2'), CLIENT_M = uuid('3'), CUST = uuid('4'), CUST_B = uuid('5'), CUST_X = uuid('6');
const U = { a: uuid('7'), b: uuid('8'), rev: uuid('9'), staff: uuid('0'), mon: rid('f', 1), cust: rid('f', 2) };
const USERS = {
  'jwt-a': { id: U.a, email: 'owner@studio-a.example' },
  'jwt-b': { id: U.b, email: 'owner@studio-b.example' },
  'jwt-rev': { id: U.rev, email: 'reviewer@client.example' },
  'jwt-staff': { id: U.staff, email: 'helper@studio-a.example' },
  'jwt-mon': { id: U.mon, email: 'owner@monitor.example' },
  'jwt-cust': { id: U.cust, email: 'owner@customer.example' },
};
const db = installFakePostgrest({
  users: USERS,
  ownSite: { 'jwt-a': SITE_A, 'jwt-b': SITE_B, 'jwt-mon': SITE_M, 'jwt-cust': SITE_C },
  unique: { presence_service_links: [['project_id']], presence_customer_agency: [['customer_client_id']] },
});
Deno.env.delete('RESEND_API_KEY');
Deno.env.delete('OPS_ALERT_EMAIL');

const P = await import('../../supabase/functions/presence/routes/projects.ts');
const SD = await import('../../supabase/functions/presence/lib/service_delivery.ts');
const { featureForRoute } = await import('../../supabase/functions/presence/middleware/feature.ts');
const { reviewerAllowed } = await import('../../supabase/functions/presence/routes/workspace.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ── the two studios, a customer, a monitor-plan studio ──
const PA = rid('a', 1), PA_HIDDEN = rid('a', 2), PW = rid('a', 3), PB = rid('b', 1);
const MA1 = rid('c', 1), MA2 = rid('c', 2), MB1 = rid('c', 3), MB_SMUG = rid('c', 4);
const TA1 = rid('d', 1), TA2 = rid('d', 2), TA3 = rid('d', 3), TA4 = rid('d', 4), TB1 = rid('d', 5), TB_SMUG = rid('d', 6);
const EA1 = rid('e', 1), EA2 = rid('e', 2), EB1 = rid('e', 3), EB_SMUG = rid('e', 4);
const DA = rid('1', 1), DA2 = rid('1', 2), DX = rid('1', 3), DB = rid('1', 4);
const AP1 = rid('2', 1), DL1 = rid('3', 1), DL2 = rid('3', 2);
const T0 = '2026-10-01T00:00:00Z';
const site = (id, client_id, edition = 'presence') => ({ id, client_id, status: 'live', edition, custom_domain: null, netlify_site_id: null, template_slug: 'restaurant-classic', template_version: '1.0.0', last_published_at: null });
const project = (id, site_id, name, extra = {}) => ({ id, site_id, client_id: null, deal_id: null, name, description: '', status: 'active', owner_user_id: null, client_visible: true, start_date: null, target_date: null, created_at: T0, updated_at: T0, deleted_at: null, ...extra });
const task = (id, site_id, project_id, title, extra = {}) => ({ id, site_id, project_id, milestone_id: null, title, detail: '', status: 'todo', priority: 'normal', client_visible: false, client_action_required: false, assigned_to: null, due_date: null, sort_order: 0, source: 'manual', completed_at: null, created_at: T0, updated_at: T0, deleted_at: null, ...extra });
const milestone = (id, site_id, project_id, title, extra = {}) => ({ id, site_id, project_id, title, status: 'open', due_date: null, sort_order: 0, client_visible: true, completed_at: null, created_at: T0, updated_at: T0, deleted_at: null, ...extra });
const event = (id, site_id, project_id, kind, extra = {}) => ({ id, site_id, project_id, kind, detail: {}, actor: 'someone@example.com', actor_kind: 'client', client_visible: false, created_at: T0, ...extra });
const world = () => ({
  presence_sites: [site(SITE_A, CLIENT_A), site(SITE_B, CLIENT_B), site(SITE_M, CLIENT_M, 'monitor'), site(SITE_C, CUST), site(SITE_CB, CUST_B)],
  clients: [
    { id: CLIENT_A, name: 'Studio A', email: 'owner@studio-a.example', contact_email: null, tenant_id: 'tenant-1', deleted_at: null },
    { id: CLIENT_B, name: 'Studio B', email: 'owner@studio-b.example', contact_email: null, tenant_id: 'tenant-1', deleted_at: null },
    { id: CLIENT_M, name: 'Watcher', email: 'owner@monitor.example', contact_email: null, tenant_id: 'tenant-1', deleted_at: null },
    { id: CUST, name: 'Harbor Bakery', email: 'owner@customer.example', contact_email: null, tenant_id: 'tenant-1', deleted_at: null },
    { id: CUST_B, name: 'Willow Spa', email: 'owner@willow.example', contact_email: null, tenant_id: 'tenant-1', deleted_at: null },
  ],
  presence_entitlements: [
    { client_id: CLIENT_A, product: 'presence', plan: 'presence', status: 'active' },
    { client_id: CLIENT_B, product: 'presence', plan: 'presence', status: 'active' },
    { client_id: CLIENT_M, product: 'presence', plan: 'presence_monitor', status: 'active' },
    { client_id: CUST, product: 'presence', plan: 'presence', status: 'active' },
  ],
  memberships: [], contacts: [],
  presence_site_members: [
    { id: rid('5', 1), site_id: SITE_A, user_id: U.rev, email: 'reviewer@client.example', role: 'client_reviewer', status: 'active', created_at: T0 },
    { id: rid('5', 2), site_id: SITE_A, user_id: U.staff, email: 'helper@studio-a.example', role: 'business_staff', status: 'active', created_at: T0 },
  ],
  presence_projects: [
    project(PA, SITE_A, 'Harbor Bakery site', { client_id: CUST }),
    project(PA_HIDDEN, SITE_A, 'Internal tidy-up', { client_visible: false }),
    project(PW, SITE_A, 'Juniper Floral build', { client_id: CUST, deal_id: DA2 }),
    project(PB, SITE_B, 'Willow Spa site', { client_id: CUST_B }),
  ],
  presence_milestones: [
    milestone(MA1, SITE_A, PA, 'Design and first draft', { sort_order: 0 }),
    milestone(MA2, SITE_A, PA, 'Internal QA', { sort_order: 10, client_visible: false }),
    milestone(MB1, SITE_B, PB, 'Kickoff'),
    // studio B's row naming studio A's project: must never surface or change through A
    milestone(MB_SMUG, SITE_B, PA, 'Smuggled milestone'),
  ],
  presence_tasks: [
    task(TA1, SITE_A, PA, 'Send the homepage draft', { client_visible: true, sort_order: 0 }),
    task(TA2, SITE_A, PA, 'Tidy the stylesheet', { sort_order: 10 }),
    task(TA3, SITE_A, PA, 'Kickoff call', { client_visible: true, status: 'done', completed_at: T0, sort_order: 20 }),
    task(TA4, SITE_A, PA, 'Wait on the printer', { status: 'blocked', sort_order: 30 }),
    task(TB1, SITE_B, PB, 'B task'),
    task(TB_SMUG, SITE_B, PA, 'Smuggled task', { client_visible: true }),
  ],
  presence_project_events: [
    event(EA1, SITE_A, PA, 'project_created', { client_visible: true }),
    event(EA2, SITE_A, PA, 'note', { detail: { body: 'internal' } }),
    event(EB1, SITE_B, PB, 'project_created', { client_visible: true }),
    event(EB_SMUG, SITE_B, PA, 'note', { client_visible: true, detail: { body: 'smuggled' } }),
  ],
  presence_deliverables: [
    { id: DL1, site_id: SITE_A, project_id: PA, title: 'Logo files', note: '', status: 'shared', client_visible: true, media_id: null, created_at: T0, deleted_at: null },
    { id: DL2, site_id: SITE_A, project_id: PA, title: 'Rough sketch', note: '', status: 'draft', client_visible: false, media_id: null, created_at: T0, deleted_at: null },
  ],
  presence_approvals: [
    { id: AP1, site_id: SITE_A, project_id: PA, subject_type: 'deliverable', subject_id: DL1, title: 'Homepage draft', summary: '', content_hash: 'h1', status: 'pending', client_visible: true, requested_at: T0, decided_at: null, decision_note: '', created_at: T0, deleted_at: null },
  ],
  presence_deals: [
    { id: DA, site_id: SITE_A, title: 'Harbor Bakery website', stage: 'won', contact_id: null, converted_client_id: CUST, converted_site_id: SITE_C, created_project_id: null, deleted_at: null, updated_at: T0 },
    { id: DA2, site_id: SITE_A, title: 'Juniper Floral build', stage: 'won', contact_id: null, converted_client_id: CUST, converted_site_id: SITE_C, created_project_id: null, deleted_at: null, updated_at: T0 },
    // a deal that became studio B's customer (B already holds them)
    { id: DX, site_id: SITE_A, title: 'Willow Spa refresh', stage: 'won', contact_id: null, converted_client_id: CUST_X, converted_site_id: null, created_project_id: null, deleted_at: null, updated_at: T0 },
    { id: DB, site_id: SITE_B, title: 'Studio B deal', stage: 'won', contact_id: null, converted_client_id: CUST_B, converted_site_id: SITE_CB, created_project_id: null, deleted_at: null, updated_at: T0 },
  ],
  presence_customer_agency: [
    { customer_client_id: CUST, agency_site_id: SITE_A },
    { customer_client_id: CUST_B, agency_site_id: SITE_B },
    { customer_client_id: CUST_X, agency_site_id: SITE_B },
  ],
  presence_service_links: [
    { id: rid('6', 1), project_id: PA, agency_site_id: SITE_A, customer_client_id: CUST, customer_site_id: SITE_C, deal_id: null, status: 'active', created_at: T0 },
    { id: rid('6', 2), project_id: PA_HIDDEN, agency_site_id: SITE_A, customer_client_id: CUST, customer_site_id: SITE_C, deal_id: null, status: 'active', created_at: T0 },
    { id: rid('6', 3), project_id: PB, agency_site_id: SITE_B, customer_client_id: CUST_B, customer_site_id: SITE_CB, deal_id: null, status: 'active', created_at: T0 },
  ],
  presence_contracts: [], presence_invoices: [], presence_surveys: [], presence_project_messages: [],
});

// ── calling the handlers ──
const cors = {};
const person = (jwt, extra = {}) => ({ kind: 'client', userId: USERS[jwt].id, email: USERS[jwt].email, jwt, role: 'client', tenantId: 'tenant-1', requestId: 't', ...extra });
const ownerA = () => person('jwt-a'), reviewer = () => person('jwt-rev'), staffSeat = () => person('jwt-staff');
const siteRow = (id) => ({ ...db.tables.presence_sites.find((s) => s.id === id) });
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => { const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ } return { status: r.status, body, text }; };
const as = (jwt) => ({ jwt, principal: person(jwt), site: siteRow(OWNSITE[jwt]) });
const OWNSITE = { 'jwt-a': SITE_A, 'jwt-rev': SITE_A, 'jwt-staff': SITE_A, 'jwt-b': SITE_B };
const H = {
  list: (who, q = '') => P.handleProjects(req('GET', `/projects${q}`), who.jwt, who.site, who.principal, cors),
  create: (who, b) => P.handleProjects(req('POST', '/projects', b), who.jwt, who.site, who.principal, cors),
  get: (who, id) => P.handleProject(req('GET', `/projects/${id}`), who.jwt, who.site, who.principal, id, cors),
  patch: (who, id, b) => P.handleProject(req('PATCH', `/projects/${id}`, b), who.jwt, who.site, who.principal, id, cors),
  report: (who, id) => P.handleProjectReport(req('GET', `/projects/${id}/report`), who.jwt, who.site, who.principal, id, cors),
  progress: (who, ids) => P.handleProjectsProgress(req('GET', `/projects/progress?ids=${ids.join(',')}`), who.jwt, who.site, who.principal, cors),
  status: (who, id, b) => P.handleProjectStatus(req('POST', `/projects/${id}/status`, b), who.jwt, who.site, who.principal, id, cors),
  addTask: (who, id, b) => P.handleTasksCreate(req('POST', `/projects/${id}/tasks`, b), who.jwt, who.site, who.principal, id, cors),
  task: (who, id, tid, b) => P.handleTask(req('PATCH', `/projects/${id}/tasks/${tid}`, b), who.jwt, who.site, who.principal, id, tid, cors),
  addMilestone: (who, id, b) => P.handleMilestonesCreate(req('POST', `/projects/${id}/milestones`, b), who.jwt, who.site, who.principal, id, cors),
  milestone: (who, id, mid, b) => P.handleMilestone(req('PATCH', `/projects/${id}/milestones/${mid}`, b), who.jwt, who.site, who.principal, id, mid, cors),
  checklist: (who, id, b) => P.handleProjectChecklist(req('POST', `/projects/${id}/checklist`, b), who.jwt, who.site, who.principal, id, cors),
  templates: (who, b) => P.handleProjectTemplates(req('POST', '/projects/templates', b), who.jwt, who.site, who.principal, null, cors),
};
const call = async (p) => res(await p);
const row = (table, id) => db.tables[table].find((r) => r.id === id);
const snap = (table, pred) => JSON.stringify((db.tables[table] || []).filter(pred));
const bRows = () => JSON.stringify(['presence_projects', 'presence_milestones', 'presence_tasks', 'presence_project_events', 'presence_deals'].map((t) => (db.tables[t] || []).filter((r) => r.site_id === SITE_B)));
const writesTo = (...tables) => db.log.filter((c) => c.method !== 'GET' && c.method !== 'HEAD' && tables.some((t) => c.url.startsWith(`/rest/v1/${t}`)));
const eventsOf = (pid) => (db.tables.presence_project_events || []).filter((e) => e.project_id === pid && e.site_id === SITE_A).map((e) => e.kind);
// every request studio A's calls make to the four delivery tables is recorded here, to sweep at the end
const DELIVERY = ['presence_projects', 'presence_milestones', 'presence_tasks', 'presence_project_events'];
const aLog = [];
const asA = async (p) => { const from = db.log.length; const r = await call(p); aLog.push(...db.log.slice(from)); return r; };
// a write that reaches the database a moment after another tab's: `before` runs once, just
// before the first matching write is applied (lib/db.ts calls the global fetch each time)
const pgrst = globalThis.fetch;
let race = null;
globalThis.fetch = (url, init = {}) => {
  const m = String(init.method || 'GET').toUpperCase();
  if (race && m === race.method && decodeURIComponent(String(url)).includes(race.match)) { const f = race.before; race = null; f(); }
  return pgrst(url, init);
};

// ═══ 1. tenant safety: studio A never reads or changes studio B's rows ═══
{
  db.reset(world());
  const A = as('jwt-a');
  const before = bRows();
  const list = await asA(H.list(A));
  const ids = (list.body?.data || []).map((p) => p.id).sort();
  ok('the project list is the studio\'s own projects, never another studio\'s', list.status === 200 && JSON.stringify(ids) === JSON.stringify([PA, PA_HIDDEN, PW].sort()), JSON.stringify(ids));

  const g = await asA(H.get(A, PA));
  const d = g.body?.data || {};
  ok('a project\'s milestones are its own studio\'s, not rows on another site that name it', g.status === 200 && JSON.stringify(d.milestones.map((m) => m.id)) === JSON.stringify([MA1, MA2]), JSON.stringify(d.milestones?.map((m) => m.id)));
  ok('…its tasks too', JSON.stringify(d.tasks.map((t) => t.id)) === JSON.stringify([TA1, TA2, TA3, TA4]), JSON.stringify(d.tasks?.map((t) => t.id)));
  ok('…and its activity', JSON.stringify(d.events.map((e) => e.kind).sort()) === JSON.stringify(['note', 'project_created']) && !JSON.stringify(d.events).includes('smuggled'), JSON.stringify(d.events));
  ok('…so its progress counts only its own tasks (1 of 4 done)', JSON.stringify(d.progress) === JSON.stringify({ total: 4, done: 1, pct: 25 }), JSON.stringify(d.progress));
  const rep = await asA(H.report(A, PA));
  ok('the report counts only the studio\'s own rows', rep.status === 200 && rep.body?.data?.summary?.progress?.total === 4 && rep.body?.data?.summary?.milestones?.total === 2, JSON.stringify(rep.body?.data?.summary));
  const pr = await asA(H.progress(A, [PA, PB]));
  ok('progress for many projects answers only for the studio\'s own (another studio\'s id is left out)', pr.status === 200 && JSON.stringify(Object.keys(pr.body?.data || {})) === JSON.stringify([PA]) && pr.body.data[PA].progress.total === 4, JSON.stringify(pr.body?.data));

  // another studio's project, by its id: every door is a 404 and nothing of theirs moves
  const doors = [
    ['open it', () => H.get(A, PB), 404], ['rename it', () => H.patch(A, PB, { name: 'Taken over' }), 404],
    ['move its status', () => H.status(A, PB, { to: 'on_hold' }), 404], ['read its report', () => H.report(A, PB), 404],
    ['add a task to it', () => H.addTask(A, PB, { title: 'Sneaky task' }), 404], ['add a milestone to it', () => H.addMilestone(A, PB, { title: 'Sneaky milestone' }), 404],
    ['change its task', () => H.task(A, PB, TB1, { status: 'done' }), 404], ['complete its milestone', () => H.milestone(A, PB, MB1, { status: 'complete' }), 404],
    ['add checklist steps to it', () => H.checklist(A, PB, { all: true }), 404],
  ];
  const wrong = [];
  for (const [what, fn, status] of doors) { const r = await asA(fn()); if (r.status !== status) wrong.push(`${what}: ${r.status}`); }
  ok('another studio\'s project, by its id: open, rename, status, report, tasks, milestones and checklist are all a 404', wrong.length === 0, wrong.join('; '));
  // rows on B's site that carry A's project id can't be reached through A's project either
  const t = await asA(H.task(A, PA, TB_SMUG, { status: 'done' }));
  const m = await asA(H.milestone(A, PA, MB_SMUG, { status: 'complete' }));
  ok('a task or milestone on another studio\'s site is a 404 even under the studio\'s own project id', t.status === 404 && m.status === 404, `${t.status} ${m.status}`);
  ok('…and every one of another studio\'s rows is exactly as it was', bRows() === before);

  // what A writes is A's, whatever the request body claims
  db.reset(world());
  const mk = await asA(H.create(A, { name: 'Bakery menu', site_id: SITE_B }));
  const tk = await asA(H.addTask(A, PA, { title: 'Upload photos', site_id: SITE_B }));
  const ms = await asA(H.addMilestone(A, PA, { title: 'Launch', site_id: SITE_B }));
  const made = [row('presence_projects', mk.body?.data?.id), row('presence_tasks', tk.body?.data?.id), row('presence_milestones', ms.body?.data?.id)];
  ok('a new project, task and milestone are written on the studio\'s own site, never the one a body names', mk.status === 201 && tk.status === 201 && ms.status === 201 && made.every((r) => r && r.site_id === SITE_A), JSON.stringify(made.map((r) => r?.site_id)));
  ok('…and their activity is recorded on the studio\'s own site', (db.tables.presence_project_events || []).filter((e) => e.site_id !== SITE_A && e.site_id !== SITE_B).length === 0 && writesTo('presence_project_events').every((c) => c.body?.site_id === SITE_A));

  // the deal handoff looks the deal up on the studio's own site only
  db.reset(world());
  const before2 = bRows();
  const h = await asA(H.create(A, { deal_id: DB }));
  ok('another studio\'s deal can\'t be turned into a project here (422), and nothing is written', h.status === 422 && h.body?.error === 'bad_deal' && writesTo('presence_projects', 'presence_deals', 'presence_service_links', 'presence_tasks').length === 0 && bRows() === before2, JSON.stringify(h.body));
}

// ═══ 2. the studio side manages; the client side reads what is client-visible ═══
{
  db.reset(world());
  const studio = await call(H.list(as('jwt-a')));
  const seat = await call(H.list(as('jwt-staff')));
  const rev = await call(H.list(as('jwt-rev')));
  ok('the site\'s own owner is the studio side, with no agency at all (not agency-only)', studio.body?.is_studio_view === true);
  ok('a business_staff seat is the studio side too; a client_reviewer seat is the client side', seat.body?.is_studio_view === true && rev.body?.is_studio_view === false, `${seat.body?.is_studio_view} ${rev.body?.is_studio_view}`);
  ok('the client side lists only client-visible projects', JSON.stringify((rev.body?.data || []).map((p) => p.id).sort()) === JSON.stringify([PA, PW].sort()), JSON.stringify(rev.body?.data?.map((p) => p.id)));
  const hidden = await call(H.get(as('jwt-rev'), PA_HIDDEN));
  const hiddenRep = await call(H.report(as('jwt-rev'), PA_HIDDEN));
  ok('a project the client can\'t see is a 404 for them, and so is its report', hidden.status === 404 && hiddenRep.status === 404);
  const cb = (await call(H.get(as('jwt-rev'), PA))).body?.data || {};
  ok('the client\'s view of a project holds only client-visible milestones, tasks and activity', JSON.stringify(cb.milestones?.map((m) => m.id)) === JSON.stringify([MA1]) && JSON.stringify(cb.tasks?.map((t) => t.id)) === JSON.stringify([TA1, TA3]) && JSON.stringify(cb.events?.map((e) => e.kind)) === JSON.stringify(['project_created']), JSON.stringify([cb.milestones?.map((m) => m.id), cb.tasks?.map((t) => t.id), cb.events?.map((e) => e.kind)]));
  ok('…only shared files and visible approvals, and no step picker or subscription details', JSON.stringify(cb.deliverables?.map((x) => x.id)) === JSON.stringify([DL1]) && cb.approvals?.length === 1 && cb.checklist === null && cb.customer_saas === null && cb.is_studio_view === false);
  ok('the client\'s progress counts only the steps they can see (1 of 2), the studio\'s counts all (1 of 4)', JSON.stringify(cb.progress) === JSON.stringify({ total: 2, done: 1, pct: 50 }) && JSON.stringify((await call(H.get(as('jwt-a'), PA))).body?.data?.progress) === JSON.stringify({ total: 4, done: 1, pct: 25 }), JSON.stringify(cb.progress));
  const crep = (await call(H.report(as('jwt-rev'), PA))).body?.data?.summary;
  ok('the client\'s report counts only what they can see', crep?.progress?.total === 2 && crep?.milestones?.total === 1 && crep?.shared_files === 1, JSON.stringify(crep));

  // every write is the studio's alone
  const before = JSON.stringify(db.tables);
  const writes = [
    ['create a project', () => H.create(as('jwt-rev'), { name: 'Client project' })],
    ['hand off a deal', () => H.create(as('jwt-rev'), { deal_id: DA })],
    ['edit a project', () => H.patch(as('jwt-rev'), PA, { name: 'Renamed' })],
    ['move its status', () => H.status(as('jwt-rev'), PA, { to: 'complete' })],
    ['add a task', () => H.addTask(as('jwt-rev'), PA, { title: 'Mine' })],
    ['tick a task', () => H.task(as('jwt-rev'), PA, TA1, { status: 'done' })],
    ['add a milestone', () => H.addMilestone(as('jwt-rev'), PA, { title: 'Mine' })],
    ['complete a milestone', () => H.milestone(as('jwt-rev'), PA, MA1, { status: 'complete' })],
    ['add checklist steps', () => H.checklist(as('jwt-rev'), PA, { all: true })],
    ['save a template', () => H.templates(as('jwt-rev'), { name: 'Mine', from_project_id: PA })],
  ];
  const let_through = [];
  for (const [what, fn] of writes) { const r = await call(fn()); if (r.status !== 403 || r.body?.error !== 'forbidden') let_through.push(`${what}: ${r.status}`); }
  ok('the client side can\'t create, hand off, edit, move, add or tick anything (403 each)', let_through.length === 0, let_through.join('; '));
  ok('…and nothing changed anywhere', JSON.stringify(db.tables) === before);
}

// ═══ 3. guarded status moves ═══
{
  db.reset(world());
  const A = as('jwt-a');
  db.tables.presence_projects.find((p) => p.id === PA_HIDDEN).status = 'archived';
  const bad = await asA(H.status(A, PA_HIDDEN, { to: 'on_hold' }));
  ok('a move the ladder forbids (archived to on hold) is a 409 and the project stays archived', bad.status === 409 && bad.body?.error === 'invalid_transition' && row('presence_projects', PA_HIDDEN).status === 'archived', JSON.stringify(bad.body));
  // another tab puts the project on hold between our read and our write
  race = { method: 'PATCH', match: `presence_projects?id=eq.${PA}`, before: () => { row('presence_projects', PA).status = 'on_hold'; } };
  const lost = await asA(H.status(A, PA, { to: 'complete' }));
  ok('a project move that lost a race is a 409, and the other tab\'s status stands', lost.status === 409 && lost.body?.error === 'conflict' && row('presence_projects', PA).status === 'on_hold', `${lost.status} ${row('presence_projects', PA).status}`);
  ok('…and no status change is recorded for it', !eventsOf(PA).includes('status_change'));
  const okMove = await asA(H.status(A, PA, { to: 'active' }));
  ok('an ordinary move goes through (on hold to active)', okMove.status === 200 && row('presence_projects', PA).status === 'active');

  const badTask = await asA(H.task(A, PA, TA4, { status: 'done' }));
  ok('a task move the ladder forbids (blocked to done) is a 409 and the task stays blocked', badTask.status === 409 && badTask.body?.error === 'invalid_transition' && row('presence_tasks', TA4).status === 'blocked', JSON.stringify(badTask.body));
  race = { method: 'PATCH', match: `presence_tasks?id=eq.${TA1}`, before: () => { row('presence_tasks', TA1).status = 'blocked'; } };
  const lostTask = await asA(H.task(A, PA, TA1, { status: 'in_progress' }));
  ok('a task move that lost a race is a 409, and the other tab\'s status stands', lostTask.status === 409 && lostTask.body?.error === 'conflict' && row('presence_tasks', TA1).status === 'blocked', `${lostTask.status} ${row('presence_tasks', TA1).status}`);

  db.reset(world());
  const done = await asA(H.task(A, PA, TA1, { status: 'done' }));
  const stamped = row('presence_tasks', TA1).completed_at;
  const reopened = await asA(H.task(A, PA, TA1, { status: 'todo' }));
  ok('a task marked done is stamped with when, and reopening it clears the stamp', done.status === 200 && typeof stamped === 'string' && stamped.length > 0 && reopened.status === 200 && row('presence_tasks', TA1).completed_at === null && row('presence_tasks', TA1).status === 'todo', `${stamped} ${row('presence_tasks', TA1).completed_at}`);
}

// ═══ 4. a deal becomes one project, once ═══
{
  db.reset(world());
  const A = as('jwt-a');
  const first = await asA(H.create(A, { deal_id: DA }));
  const p = first.body?.data;
  const deal = row('presence_deals', DA);
  ok('handing off a won deal makes one project on the studio\'s site, for that customer', first.status === 201 && first.body?.idempotent === false && p?.site_id === SITE_A && p?.deal_id === DA && p?.client_id === CUST && p?.client_visible === true && p?.name === 'Harbor Bakery website', JSON.stringify(first.body));
  ok('…the deal is stamped with it', deal.created_project_id === p?.id);
  const links = () => db.tables.presence_service_links.filter((l) => l.project_id === p?.id);
  ok('…and the customer is bridged to it (one active link, from this studio\'s site)', links().length === 1 && links()[0].agency_site_id === SITE_A && links()[0].customer_client_id === CUST && links()[0].customer_site_id === SITE_C && links()[0].status === 'active', JSON.stringify(links()));
  ok('…it starts as the ten-step delivery checklist, not an empty shell', db.tables.presence_tasks.filter((t) => t.project_id === p?.id && t.site_id === SITE_A && String(t.source).startsWith('checklist:')).length === 10);
  const projectsBefore = db.tables.presence_projects.length;
  const again = await asA(H.create(A, { deal_id: DA }));
  ok('handing off the same deal again returns the same project (200, idempotent) and makes nothing new', again.status === 200 && again.body?.idempotent === true && again.body?.data?.id === p?.id && db.tables.presence_projects.length === projectsBefore && links().length === 1, JSON.stringify(again.body));

  // another tab hands the same deal off between our insert and our claim
  db.reset(world());
  const winnerBefore = JSON.stringify(row('presence_projects', PW));
  race = { method: 'PATCH', match: `presence_deals?id=eq.${DA2}`, before: () => { row('presence_deals', DA2).created_project_id = PW; } };
  const lost = await call(H.create(A, { deal_id: DA2 }));
  const orphans = db.tables.presence_projects.filter((x) => x.deal_id === DA2 && x.id !== PW);
  ok('a handoff that lost the race answers with the winner\'s project (idempotent)', lost.status === 200 && lost.body?.idempotent === true && lost.body?.data?.id === PW, JSON.stringify(lost.body));
  ok('…the deal keeps the winner, and the loser\'s own project is dropped (deleted), not left live', row('presence_deals', DA2).created_project_id === PW && orphans.length === 1 && !!orphans[0].deleted_at && JSON.stringify(row('presence_projects', PW)) === winnerBefore, JSON.stringify(orphans));
  ok('…so the deal has exactly one live project', db.tables.presence_projects.filter((x) => x.deal_id === DA2 && !x.deleted_at).length === 1);

  // the bridge: one link per project, and a customer another studio holds is never taken
  db.reset(world());
  const x = await asA(H.create(A, { name: 'Willow refresh', customer_client_id: CUST_X }));
  const madeX = db.tables.presence_projects.find((r) => r.name === 'Willow refresh');
  ok('a project for a customer another studio already holds is refused (409) and nothing is bridged', x.status === 409 && x.body?.error === 'bridge_denied' && !db.tables.presence_service_links.some((l) => l.customer_client_id === CUST_X) && db.tables.presence_customer_agency.find((c) => c.customer_client_id === CUST_X).agency_site_id === SITE_B, JSON.stringify(x.body));
  ok('…and the project it started is no longer theirs to see (no customer, not client-visible)', !!madeX && madeX.client_id === null && madeX.client_visible === false, JSON.stringify(madeX));
  const own = await asA(H.create(A, { name: 'Second Harbor project', customer_client_id: CUST }));
  ok('a project for the studio\'s own customer is bridged to them', own.status === 201 && own.body?.bridged === true && db.tables.presence_service_links.filter((l) => l.project_id === own.body?.data?.id && l.agency_site_id === SITE_A && l.customer_client_id === CUST).length === 1, JSON.stringify(own.body));
}

// ═══ 5. every meaningful change is recorded ═══
{
  db.reset(world());
  const A = as('jwt-a');
  const mk = await asA(H.create(A, { name: 'Event trail' }));
  const id = mk.body?.data?.id;
  const t = await asA(H.addTask(A, id, { title: 'Write the copy' }));
  await asA(H.task(A, id, t.body?.data?.id, { status: 'in_progress' }));
  const m = await asA(H.addMilestone(A, id, { title: 'First draft' }));
  await asA(H.milestone(A, id, m.body?.data?.id, { status: 'complete' }));
  await asA(H.status(A, id, { to: 'on_hold' }));
  const kinds = eventsOf(id);
  ok('creating, moving, adding tasks and milestones and completing one are each recorded as an event', ['project_created', 'task_created', 'task_status_change', 'milestone_created', 'milestone_completed', 'status_change'].every((k) => kinds.includes(k)), JSON.stringify(kinds));
  const sc = db.tables.presence_project_events.find((e) => e.project_id === id && e.kind === 'status_change');
  ok('…with what changed and who did it', sc?.detail?.from === 'active' && sc?.detail?.to === 'on_hold' && sc?.actor === 'owner@studio-a.example', JSON.stringify(sc));
}

// ═══ 6. validation ═══
{
  db.reset(world());
  const A = as('jwt-a');
  const badDates = [
    await asA(H.create(A, { name: 'Dated', start_date: '2026/11/20' })),
    await asA(H.patch(A, PA, { target_date: 'next week' })),
    await asA(H.addTask(A, PA, { title: 'Dated task', due_date: '20-11-2026' })),
    await asA(H.addMilestone(A, PA, { title: 'Dated milestone', due_date: 'soon' })),
  ];
  ok('a date that isn\'t YYYY-MM-DD is a 422 that says so (not a 502), for projects, tasks and milestones', badDates.every((r) => r.status === 422 && /YYYY-MM-DD/.test(r.body?.message || '')), badDates.map((r) => r.status).join(','));
  ok('…and nothing was written', writesTo('presence_projects', 'presence_tasks', 'presence_milestones').length === 0 && row('presence_projects', PA).target_date === null);
  const good = await asA(H.create(A, { name: 'Dated right', start_date: '2026-11-20', target_date: '' }));
  ok('a good date is kept, an empty one is no date', good.status === 201 && good.body?.data?.start_date === '2026-11-20' && good.body?.data?.target_date === null);

  const messy = await asA(H.create(A, { name: 'Harbor\u0000\u0007 Bakery\u0008\u000B\u001F\u007F site', description: 'Line one\nLine\ttwo\u0001' }));
  ok('control characters are stripped from what is saved (\\u0000-\\u0008, \\u000B-\\u001F, \\u007F)', messy.status === 201 && messy.body?.data?.name === 'Harbor Bakery site' && messy.body?.data?.description === 'Line one\nLine\ttwo', JSON.stringify([messy.body?.data?.name, messy.body?.data?.description]));
  const plain = await asA(H.create(A, { name: 'Café – Phase 2 (A-Z) #1 ~ “quotes” 🙂' }));
  ok('…and nothing else is: punctuation, a hyphen, accents, curly quotes and emoji all survive', plain.body?.data?.name === 'Café – Phase 2 (A-Z) #1 ~ “quotes” 🙂', JSON.stringify(plain.body?.data?.name));

  const ask = await asA(H.addTask(A, PA, { title: 'Send us your logo', client_action_required: true, client_visible: false }));
  ok('a task that asks the client for something is visible to them, even when sent as internal', ask.status === 201 && ask.body?.data?.client_action_required === true && ask.body?.data?.client_visible === true, JSON.stringify(ask.body?.data));
  const flip = await asA(H.task(A, PA, TA2, { client_action_required: true }));
  ok('…and so is an internal task once it starts asking the client, with a client-visible event saying so', flip.status === 200 && row('presence_tasks', TA2).client_visible === true && db.tables.presence_project_events.some((e) => e.project_id === PA && e.kind === 'client_action' && e.client_visible === true && e.site_id === SITE_A), JSON.stringify(row('presence_tasks', TA2)));
}

// ═══ the sweep: every request A's calls sent to the delivery tables named A's site ═══
for (const t of DELIVERY) {
  const mine = aLog.filter((c) => c.url.split('?')[0] === `/rest/v1/${t}`);
  const loose = mine.filter((c) => (c.method === 'POST' ? ![].concat(c.body || []).every((r) => r && r.site_id === SITE_A) : !c.url.includes(`site_id=eq.${SITE_A}`)));
  ok(`every read and write of ${t} in studio A's calls named studio A's site (${mine.length} requests)`, mine.length > 0 && loose.length === 0, loose[0] ? `${loose[0].method} ${loose[0].url}` : 'none sent');
}

// ═══ 7. the gates and the wiring, through the real router ═══
const queue = []; let wake = null;
Deno.listen = () => { let first = true; return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} }; };
Deno.serveHttp = () => ({ nextRequest: () => new Promise((r) => { if (queue.length) r(queue.shift()); else wake = r; }), close() {} });
await import('../../supabase/functions/presence/index.ts');
const send = (request) => new Promise((resolve) => { const ev = { request, respondWith: async (r) => { resolve(await r); } }; if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev); });
const route = async (jwt, method, path, body) => {
  const headers = { 'Content-Type': 'application/json' };
  if (jwt) headers['x-dds-user-jwt'] = jwt;
  return res(await send(new Request(`http://stub.local/functions/v1/presence${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })));
};
const touched = (from, table) => db.log.slice(from).filter((c) => c.url.startsWith(`/rest/v1/${table}`));
{
  db.reset(world());
  // the plan's feature gate stands in front of every /projects route
  ok('/projects belongs to the relationship part of a plan, like /crm and /sales', ['GET /projects', 'POST /projects', 'GET /projects/x', 'PATCH /projects/x/tasks/y', 'POST /projects/x/milestones'].every((s) => { const [m, r] = s.split(' '); return featureForRoute(r, m) === 'relationship'; }) && featureForRoute('/crm/record', 'GET') === 'relationship' && featureForRoute('/sales/deals', 'GET') === 'relationship');
  let from = db.log.length;
  const mon = await route('jwt-mon', 'GET', '/projects');
  const monPost = await route('jwt-mon', 'POST', '/projects', { name: 'Not on this plan' });
  ok('a studio on the Monitor plan is refused /projects with an upgrade answer (403 feature_not_in_plan)', mon.status === 403 && mon.body?.error === 'feature_not_in_plan' && mon.body?.feature === 'relationship' && monPost.status === 403 && monPost.body?.error === 'feature_not_in_plan', `${mon.status} ${mon.text.slice(0, 120)}`);
  ok('…before any project is read or written', touched(from, 'presence_projects').length === 0);

  // the reviewer boundary: a client_reviewer never reaches the delivery routes on the agency site
  from = db.log.length;
  const revGet = await route('jwt-rev', 'GET', '/projects');
  const revOne = await route('jwt-rev', 'GET', `/projects/${PA}`);
  const revPost = await route('jwt-rev', 'POST', `/projects/${PA}/tasks`, { title: 'From the reviewer' });
  ok('a client_reviewer seat is stopped at the reviewer boundary for /projects (403 forbidden)', [revGet, revOne, revPost].every((r) => r.status === 403 && r.body?.error === 'forbidden'), [revGet, revOne, revPost].map((r) => `${r.status} ${r.body?.error}`).join(' | '));
  ok('…before any delivery row is read or written', DELIVERY.every((t) => touched(from, t).length === 0));
  const delivery = ['/projects', `/projects/${PA}`, `/projects/${PA}/report`, `/approvals/${AP1}/decide`, `/surveys/${AP1}/respond`, '/support', `/support/${AP1}`, '/notifications', `/projects/${PA}/messages`, '/projects/progress'];
  ok('the reviewer allowlist holds no delivery route (projects, approvals, surveys, support, notifications, messages), only the shared feed', delivery.every((r) => !reviewerAllowed(r, 'GET') && !reviewerAllowed(r, 'POST') && !reviewerAllowed(r, 'PATCH')) && reviewerAllowed('/portal/feed', 'GET'));

  // the studio owner gets through, and each nested route reaches its handler
  const list = await route('jwt-a', 'GET', '/projects');
  ok('the studio owner reaches GET /projects and gets their own list', list.status === 200 && list.body?.is_studio_view === true && JSON.stringify((list.body?.data || []).map((p) => p.id).sort()) === JSON.stringify([PA, PA_HIDDEN, PW].sort()), list.text.slice(0, 160));
  const addT = await route('jwt-a', 'POST', `/projects/${PA}/tasks`, { title: 'Routed task' });
  const moveT = await route('jwt-a', 'PATCH', `/projects/${PA}/tasks/${TA1}`, { status: 'in_progress' });
  const addM = await route('jwt-a', 'POST', `/projects/${PA}/milestones`, { title: 'Routed milestone' });
  const doneM = await route('jwt-a', 'PATCH', `/projects/${PA}/milestones/${MA1}`, { status: 'complete' });
  const st = await route('jwt-a', 'POST', `/projects/${PA}/status`, { to: 'on_hold' });
  ok('POST and PATCH on /projects/:id/tasks[/:id] and /milestones[/:id], and POST /status, each reach their handler', addT.status === 201 && moveT.status === 200 && addM.status === 201 && doneM.status === 200 && st.status === 200 && row('presence_tasks', TA1).status === 'in_progress' && row('presence_milestones', MA1).status === 'complete' && row('presence_projects', PA).status === 'on_hold', [addT, moveT, addM, doneM, st].map((r) => r.status).join(','));
  const anon = await route(null, 'GET', '/projects');
  ok('no sign-in is a 401', anon.status === 401);

  // the customer reaches their delivery through the bridge, on their own site
  const cl = await route('jwt-cust', 'GET', '/client/projects');
  ok('GET /client/projects lists the customer\'s bridged, visible projects (not a hidden one, not another studio\'s)', cl.status === 200 && JSON.stringify((cl.body?.data || []).map((p) => p.id)) === JSON.stringify([PA]), cl.text.slice(0, 200));
  const one = await route('jwt-cust', 'GET', `/client/projects/${PA}`);
  const other = await route('jwt-cust', 'GET', `/client/projects/${PB}`);
  ok('GET /client/projects/:id opens their project with only the visible steps, and another studio\'s project is a 404', one.status === 200 && JSON.stringify((one.body?.data?.tasks || []).map((t) => t.id)) === JSON.stringify([TA1, TA3]) && other.status === 404, `${one.status} ${other.status} ${one.text.slice(0, 160)}`);
  const decide = await route('jwt-cust', 'POST', `/client/approvals/${AP1}/decide`, { decision: 'approved' });
  ok('POST /client/approvals/:id/decide reaches the approval through the bridge and records the answer', decide.status === 200 && row('presence_approvals', AP1).status === 'approved', `${decide.status} ${decide.text.slice(0, 160)}`);
}

// ═══ 8. the rules file stays pure; the migration ═══
{
  const realFetch = globalThis.fetch; let asked = 0;
  globalThis.fetch = () => { asked++; throw new Error('no network in the rules'); };
  const now = '2026-11-15T12:00:00Z';
  const answers = [
    SD.canProjectTransition('active', 'complete') === true, SD.canProjectTransition('archived', 'on_hold') === false,
    SD.canTaskTransition('blocked', 'done') === false, SD.canTaskTransition('done', 'todo') === true,
    SD.deriveTaskState({ status: 'todo', due_date: '2026-11-01' }, now).overdue === true,
    JSON.stringify(SD.progressOf([{ status: 'done' }, { status: 'todo' }])) === JSON.stringify({ total: 2, done: 1, pct: 50 }),
    SD.forViewer([{ client_visible: true }, { client_visible: false }], false).length === 1,
    SD.reportSummary({ tasks: [], milestones: [], deliverables: [], approvals: [] }, now).progress.total === 0,
    SD.boardFacts({ tasks: [], milestones: [], approvals: [] }, now).stage === 'kickoff',
  ];
  globalThis.fetch = realFetch;
  ok('the delivery rules (lib/service_delivery.ts) answer with no database or network at all', answers.every(Boolean) && asked === 0, JSON.stringify(answers));
  const lib = read('supabase/functions/presence/lib/service_delivery.ts');
  // pin: "imports nothing" is the file's own design rule (boardFacts takes the checklist lookup as an argument to keep it so); an import is structure no behaviour shows
  ok('lib/service_delivery.ts imports nothing', !/^import /m.test(lib));

  const mig = read('supabase/migrations/0075_p2d_service_delivery.sql');
  for (const t of ['presence_projects', 'presence_milestones', 'presence_tasks', 'presence_project_events']) {
    // pin: there is no database here; the table, its site_id foreign key and RLS exist only in the SQL
    ok(`migration: ${t} exists, site_id-scoped, RLS enabled`, new RegExp(`create table if not exists public\\.${t}[\\s\\S]*?site_id uuid not null references public\\.presence_sites`).test(mig) && new RegExp(`alter table public\\.${t} enable row level security`).test(mig));
  }
  // pin: the CHECK constraints are the database's own guard on the status ladders
  ok('migration: bounded project + task status CHECKs', /check \(status in \('active','on_hold','complete','archived'\)\)/.test(mig) && /check \(status in \('todo','in_progress','blocked','done'\)\)/.test(mig));
  // pin: a column default is the database's; a task inserted with no flag must stay internal
  ok('migration: tasks default INTERNAL (client_visible default false)', /client_visible boolean not null default false/.test(mig));
  // pin: indexes exist only in the SQL
  ok('migration: project/task/milestone pagination + status indexes present', /presence_projects_site_status_idx/.test(mig) && /presence_tasks_project_status_idx/.test(mig) && /presence_milestones_project_idx/.test(mig));
  // pin: the cascade is a foreign-key rule in the SQL
  ok('migration: cascade on project delete for children', /project_id uuid not null references public\.presence_projects\(id\) on delete cascade/.test(mig));
  // pin: the rollback is a comment block a person pastes; nothing runs it here
  ok('migration: rollback block present', /drop table if exists public\.presence_projects;/.test(mig) && /drop column if exists created_project_id/.test(mig));
  // pin: the partial unique index is what makes two simultaneous handoffs of one deal impossible in the database (the race above is the code's half)
  ok('migration: a deal maps to at most one project (unique index on created_project_id)', /presence_deals_created_project_uq[\s\S]*?created_project_id.*where created_project_id is not null/.test(mig));
}

// ═══ sales items 161 and 150: the name search reaches the database; an empty project says so ═══
{
  const from = db.log.length;
  const r = await call(H.list(as('jwt-a'), '?q=Cove'));
  const asked = db.log.slice(from).find((c) => c.method === 'GET' && c.url.includes('/rest/v1/presence_projects'));
  ok('item 161: ?q= is sent as name=ilike.*…* (written without the "=" the database ignored it and gave back every project)', r.status === 200 && !!asked && /[?&]name=ilike\.\*Cove\*/.test(asked.url) && !/name\.ilike/.test(asked.url), asked && asked.url);
  const empty = await call(H.create(as('jwt-a'), { name: 'Saved customer, nothing yet' }));
  const pid = empty.body?.data?.id;
  const p1 = await call(H.progress(as('jwt-a'), [pid]));
  ok('item 150: a project with no step, no milestone, no approval and no deal behind it is flagged nothing_yet (the board leaves it out)', p1.status === 200 && p1.body?.data?.[pid]?.nothing_yet === true, JSON.stringify(p1.body?.data?.[pid]));
  await call(H.addTask(as('jwt-a'), pid, { title: 'Kick-off call' }));
  const p2 = await call(H.progress(as('jwt-a'), [pid]));
  ok('item 150: its first step puts it on the board', p2.status === 200 && p2.body?.data?.[pid]?.nothing_yet === false && p2.body.data[pid].stage === 'kickoff', JSON.stringify(p2.body?.data?.[pid]));
  ok('item 150 (pure): nothingYet is true only with nothing behind the project', P.nothingYet({ tasks: [], milestones: [], approvals: [] }) === true && P.nothingYet({ tasks: [], milestones: [], approvals: [], deal_id: SITE_A }) === false && P.nothingYet({ tasks: [{}], milestones: [], approvals: [] }) === false && P.nothingYet({ tasks: [], milestones: [{}], approvals: [] }) === false && P.nothingYet({ tasks: [], milestones: [], approvals: [{}] }) === false);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PROJECTS ROUTES (P2-D): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
Deno.exit(passed === results.length ? 0 : 1);
