// ── Sales items 85 and 106 (Nov 2026): to-dos and logged calls for anyone, and the ─
//    reads behind the To-dos and Invoices pages
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_todos_85_test.mjs
//
//   1  Home's list (lib/my_tasks.ts) carries to-dos for a person, a customer and nobody
//   2  POST /sales/tasks makes one for a deal, a person, a customer or nobody, and only for
//      this studio's own; before APPLY-0173 it says it needs the update
//   3  GET /sales/tasks: every open one, and what was done lately, each saying what it was for
//   4  POST /sales/people/activity logs a call for someone with no deal; "Follow up on" adds a
//      to-do; a deal's log takes "Follow up on" too
//   5  the record shows a person's own history (and a sent email reads as sent)
//   6  the overdue nudge covers a person's to-do; search opens their record; a call logged for
//      a person counts for "Not contacted in"
//   7  GET /sales/invoices: every invoice, who it is for, its state; a part payment is its own row
//   8  migration 0173 and its pack; the routes and roles; the record page's wiring
import { installFakePostgrest } from './fake_pgrst.mjs';
const db = installFakePostgrest({});
Deno.env.set('SITE_URL', 'https://app.example.test');
const M = await import('../../supabase/functions/presence/lib/my_tasks.ts');
const T = await import('../../supabase/functions/presence/routes/todos.ts');
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const C = await import('../../supabase/functions/presence/routes/crm.ts');
const A = await import('../../supabase/functions/presence/crm/activity.ts');
const I = await import('../../supabase/functions/presence/routes/invoices_list.ts');
const LC = await import('../../supabase/functions/presence/commerce/lifecycle.ts');
const R = await import('../../supabase/functions/presence/lib/site_roles.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const SITE = '11111111-1111-4111-8111-111111111111', OWNER = '22222222-2222-4222-8222-222222222222', OTHER = '99999999-9999-4999-8999-999999999999';
const CUST = '66666666-6666-4666-8666-666666666666';
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: '33333333-3333-4333-8333-333333333333', email: 'owner@studio.test', jwt: 'jwt', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const ago = (d) => new Date(Date.now() - d * 86400_000).toISOString();
const day = (d) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
const cid = (n) => `cccccccc-0000-4000-8000-00000000000${n}`, did = (n) => `dddddddd-0000-4000-8000-00000000000${n}`, tid = (n) => `abababab-0000-4000-8000-00000000000${n}`;
const world = () => ({
  presence_sites: [{ id: SITE, client_id: OWNER }],
  presence_contacts: [
    { id: cid(1), site_id: SITE, name: 'Avery Stone', email: 'avery@example.com', deleted_at: null, created_at: ago(90), updated_at: ago(1) },
    { id: cid(2), site_id: SITE, name: 'Blake Rowe', email: 'blake@example.com', deleted_at: ago(1), created_at: ago(90), updated_at: ago(1) },
    { id: cid(3), site_id: OTHER, name: 'Someone Else', email: 'else@example.com', deleted_at: null },
    { id: cid(4), site_id: SITE, name: 'Casey Quiet', email: 'casey@example.com', deleted_at: null, created_at: ago(200), updated_at: ago(3) },
  ],
  clients: [{ id: CUST, name: 'Larkspur Studio', email: 'jordan@larkspur.example', deleted_at: null }],
  presence_service_links: [{ agency_site_id: SITE, customer_client_id: CUST, status: 'active', created_at: ago(30) }],
  presence_deals: [{ id: did(1), site_id: SITE, title: 'Harbor Dental site', stage: 'proposal', contact_id: null, deleted_at: null, created_at: ago(9), updated_at: ago(1) }],
  presence_deal_tasks: [
    { id: tid(1), site_id: SITE, deal_id: did(1), title: 'Send the quote', due_date: day(1), status: 'open', deleted_at: null, created_at: ago(2) },
    { id: tid(2), site_id: SITE, deal_id: null, contact_id: cid(1), title: 'Call Avery about spring', due_date: day(-2), status: 'open', deleted_at: null, created_at: ago(5) },
    { id: tid(3), site_id: SITE, deal_id: null, client_id: CUST, title: 'Send the yearly check-in', due_date: day(3), status: 'open', deleted_at: null, created_at: ago(5) },
    { id: tid(4), site_id: SITE, deal_id: null, title: 'Renew my insurance', due_date: null, status: 'open', deleted_at: null, created_at: ago(1) },
    { id: tid(5), site_id: SITE, deal_id: null, contact_id: cid(2), title: 'For someone deleted', due_date: day(-1), status: 'open', deleted_at: null, created_at: ago(5) },
    { id: tid(6), site_id: SITE, deal_id: null, contact_id: cid(1), title: 'Sent the photos', status: 'done', completed_at: ago(2), deleted_at: null, created_at: ago(9) },
  ],
  presence_person_events: [],
});

// ═══ 1. Home's list ═══
{
  const out = M.buildMyTasks({ deals: [], dealTasks: world().presence_deal_tasks, taskDeals: [{ id: did(1), title: 'Harbor Dental site', stage: 'proposal' }], projectTasks: [], projects: [], userId: null,
    people: world().presence_contacts, customers: world().clients });
  const by = Object.fromEntries(out.map((t) => [t.title, t]));
  ok('a deal\'s to-do reads as before', by['Send the quote'] && by['Send the quote'].for === 'deal' && by['Send the quote'].href === `/pipeline.html?deal=${did(1)}`);
  ok('a person\'s to-do names them and opens their record', by['Call Avery about spring'].context === 'Avery Stone' && by['Call Avery about spring'].href === `/crm.html?contact=${cid(1)}` && by['Call Avery about spring'].for === 'person');
  ok('a customer\'s to-do names them and opens their record', by['Send the yearly check-in'].context === 'Larkspur Studio' && by['Send the yearly check-in'].href === `/crm.html?client_id=${CUST}`);
  ok('one for nobody is your own, on the To-dos page', by['Renew my insurance'].context === 'Your own to-do' && by['Renew my insurance'].href === '/todos.html' && by['Renew my insurance'].for === 'me');
  ok('a deleted person\'s to-do and a done one are not on the list', !by['For someone deleted'] && !by['Sent the photos']);
  ok('all are kind deal_task, so Home\'s Done (PATCH /sales/deal-tasks/:id) works for each', ['Call Avery about spring', 'Send the yearly check-in', 'Renew my insurance'].every((k) => by[k].kind === 'deal_task'));
  eq('the overdue one comes first', out[0].title, 'Call Avery about spring');
}

// ═══ 2. making one ═══
{
  db.reset(world());
  const make = async (b) => res(await T.handleSalesTasks(req('POST', '/sales/tasks', b), site, owner, cors));
  let r = await make({ title: 'Ring Avery', due_date: day(7), contact_id: cid(1) });
  ok('a to-do for a person on this site', r.status === 201 && r.body.data.contact_id === cid(1) && r.body.data.deal_id === null && r.body.data.for === 'person' && r.body.data.context === 'Avery Stone', JSON.stringify(r));
  r = await make({ title: 'Check in', client_id: CUST });
  ok('a to-do for one of this studio\'s customers', r.status === 201 && r.body.data.client_id === CUST && r.body.data.context === 'Larkspur Studio', JSON.stringify(r));
  r = await make({ title: 'Mine' });
  ok('a to-do for nobody is your own', r.status === 201 && r.body.data.for === 'me' && !r.body.data.contact_id && !r.body.data.client_id);
  r = await make({ title: 'On the deal', deal_id: did(1), due_date: 'not a day' });
  ok('a to-do for a deal still works here, and a bad day is no day', r.status === 201 && r.body.data.deal_id === did(1) && r.body.data.due_date === null);
  r = await make({ title: 'Snoop', contact_id: cid(3) });
  ok('another studio\'s person is refused', r.status === 422 && /isn.t in this workspace/.test(r.body.message));
  r = await make({ title: 'Snoop', client_id: '77777777-7777-4777-8777-777777777777' });
  ok('a customer that isn\'t this studio\'s is refused', r.status === 422 && /isn.t one of yours/.test(r.body.message));
  r = await make({ title: '  ' });
  ok('a to-do needs a title', r.status === 422);
  // before APPLY-0173 the database refuses a to-do without a deal
  db.reset(world()); db.failMethod.set('presence_deal_tasks', 'POST');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/rest/v1/presence_deal_tasks') && (init.method || 'GET') === 'POST') return new Response(JSON.stringify({ code: '23502', message: 'null value in column "deal_id" of relation "presence_deal_tasks" violates not-null constraint' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    return realFetch(url, init);
  };
  r = await make({ title: 'Ring Avery', contact_id: cid(1) });
  globalThis.fetch = realFetch;
  ok('before APPLY-0173 it says it needs a quick update (409), and files nothing', r.status === 409 && r.body.error === 'needs_update' && /quick database update/.test(r.body.message), JSON.stringify(r));
}

// ═══ 3. the To-dos page's read ═══
{
  db.reset(world());
  const r = await res(await T.handleSalesTasks(req('GET', '/sales/tasks'), site, owner, cors));
  const d = r.body.data;
  ok('every open to-do, the person\'s, the customer\'s and your own included', ['Send the quote', 'Call Avery about spring', 'Send the yearly check-in', 'Renew my insurance'].every((t) => d.items.some((x) => x.title === t)) && d.total === d.items.length, JSON.stringify(d.items.map((x) => x.title)));
  eq('what was done in the last 30 days, with what it was for', d.done.map((x) => [x.title, x.context, x.href]), [['Sent the photos', 'Avery Stone', `/crm.html?contact=${cid(1)}`]]);
  ok('nothing failed', d.partial === false && d.done_days === 30);
}

// ═══ 4. a call for someone with no deal ═══
{
  db.reset(world());
  const log = async (b) => res(await T.handlePeopleActivity(req('POST', '/sales/people/activity', b), site, owner, cors));
  let r = await log({ contact_id: cid(1), kind: 'call', body: 'Talked about the spring menu', occurred_at: ago(1), follow_up: day(7) });
  const ev = db.tables.presence_person_events[0];
  ok('the call is kept on the person', r.status === 201 && ev.contact_id === cid(1) && ev.kind === 'call' && ev.body === 'Talked about the spring menu' && ev.via === '' && ev.actor === 'owner@studio.test', JSON.stringify(ev));
  const fu = db.tables.presence_deal_tasks.find((t) => t.title === 'Follow up with Avery Stone');
  ok('"Follow up on" adds a to-do for them, due that day, in the same step', !!fu && fu.contact_id === cid(1) && fu.due_date === day(7) && r.body.data.follow_up && r.body.data.follow_up.id === fu.id, JSON.stringify(r.body));
  r = await log({ client_id: CUST, kind: 'meeting', body: '' });
  ok('a meeting for a customer', r.status === 201 && db.tables.presence_person_events.some((e) => e.client_id === CUST && e.kind === 'meeting'));
  r = await log({ kind: 'call' });
  ok('a log needs someone', r.status === 422 && /Whose call/.test(r.body.message));
  r = await log({ contact_id: cid(1), kind: 'note', body: '' });
  ok('a note needs words', r.status === 422);
  r = await log({ contact_id: cid(3), kind: 'call' });
  ok('another studio\'s person is refused', r.status === 422);
  r = await log({ contact_id: cid(1), kind: 'fax' });
  ok('an unknown kind is refused', r.status === 422);
  // a deal's own log takes "Follow up on" too
  db.reset(world());
  r = await res(await S.handleSalesDealActivity(req('POST', `/sales/deals/${did(1)}/activity`, { kind: 'call', body: '', follow_up: day(2), follow_up_title: 'Follow up with Harbor' }), site, owner, did(1), cors));
  const dfu = db.tables.presence_deal_tasks.find((t) => t.title === 'Follow up with Harbor');
  ok('a deal\'s call can add a follow-up to-do on the deal', r.status === 201 && dfu && dfu.deal_id === did(1) && dfu.due_date === day(2) && r.body.data.follow_up.id === dfu.id, JSON.stringify(r.body));
}

// ═══ 5. the record shows it ═══
{
  const w = world();
  w.presence_person_events = [
    { id: 'pe1', site_id: SITE, contact_id: cid(1), client_id: null, kind: 'call', body: 'Spring menu', subject: '', occurred_at: ago(2), via: '', actor: 'owner@studio.test', created_at: ago(2), deleted_at: null },
    { id: 'pe2', site_id: SITE, contact_id: null, client_id: CUST, kind: 'email', body: 'Here is the plan', subject: 'Your plan', occurred_at: ago(1), via: 'app', actor: 'owner@studio.test', created_at: ago(1), deleted_at: null },
    { id: 'pe3', site_id: OTHER, contact_id: cid(1), client_id: null, kind: 'call', body: 'Not ours', occurred_at: ago(1), via: '', created_at: ago(1), deleted_at: null },
  ];
  db.reset(w);
  const p = await C.personActivity(SITE, cid(1), CUST);
  eq('a person\'s own calls and emails, and the customer\'s, from this site only', p.events.map((e) => e.id).sort(), ['pe1', 'pe2']);
  ok('…and their to-dos that aren\'t on a deal', p.tasks.some((t) => t.title === 'Call Avery about spring') && p.tasks.some((t) => t.title === 'Send the yearly check-in') && !p.tasks.some((t) => t.title === 'Send the quote'));
  const none = await C.personActivity(SITE, cid(3), '');
  ok('another site\'s person shows nothing', none.events.length === 0 && none.tasks.length === 0);
  const items = p.events.map((e) => A.mapConversationItem(e, 'owner@studio.test'));
  ok('a call logged for them reads as a logged call', items.some((i) => i.title === 'You logged a call' && i.type === 'call'));
  ok('an email sent from Studio OS reads as sent, with its subject', items.some((i) => i.title === 'You sent an email — Your plan' && i.meta === 'Email' && i.type === 'email'));
  ok('a logged email still reads as logged', A.mapConversationItem({ kind: 'activity', activity_kind: 'email', via: 'bcc', created_at: ago(1), body: 'x', actor: '' }).title === 'You logged an email');
}

// ═══ 6. the nudge, search and "Not contacted in" ═══
{
  db.reset(world());
  const r = await LC.runDealTaskReminders(20);
  const notices = db.writes('presence_plan_notices').filter((w) => w.method === 'POST').map((w) => w.body);
  ok('an overdue to-do for a person is nudged, naming them', notices.some((n) => n.kind === 'deal_task_due' && /Call Avery about spring \(Avery Stone\)/.test(String(n.headline))), JSON.stringify(notices.map((n) => n.headline)));
  ok('a deleted person\'s to-do stays quiet', !notices.some((n) => /For someone deleted/.test(String(n.headline))));
  ok('the job says how many it nudged', r.nudged >= 1);
  const crm = read('supabase/functions/presence/routes/crm.ts');
  ok('search: a person\'s to-do opens their record; one of your own, the To-dos page', crm.includes("href: t.deal_id ? dealHref(t.deal_id) : t.contact_id ? `/crm.html?contact=${t.contact_id}` : t.client_id ? `/crm.html?client_id=${t.client_id}` : '/todos.html'"));
  // a call logged for the person (no deal) counts as contact
  const w = world();
  w.presence_person_events = [{ id: 'pe9', site_id: SITE, contact_id: cid(1), kind: 'call', occurred_at: ago(3), deleted_at: null, created_at: ago(3) }];
  db.reset(w);
  const q = await res(await S.handleSalesContacts(req('GET', '/sales/contacts?quiet=30&sort=name'), site, owner, cors));
  ok('"Not contacted in 30 days" leaves out someone called for, with no deal, last week', q.status === 200 && !q.body.data.some((c) => c.name === 'Avery Stone') && q.body.data.some((c) => c.name === 'Casey Quiet'), JSON.stringify(q.body.data && q.body.data.map((c) => c.name)));
}

// ═══ 7. the Invoices page's read ═══
{
  const INV = (n) => `eeeeeeee-0000-4000-8000-00000000000${n}`;
  const w = world();
  w.presence_deals[0].contact_id = cid(1);
  w.presence_invoices = [
    { id: INV(1), site_id: SITE, number: 12, title: 'Website, half up front', amount_cents: 150000, purpose: 'deposit', status: 'open', due_date: day(-6), deal_id: did(1), customer_client_id: null, created_at: ago(20), deleted_at: null },
    { id: INV(2), site_id: SITE, number: 13, title: 'Monthly care', amount_cents: 9000, purpose: 'invoice', status: 'paid', paid_at: ago(3), paid_method: 'check', deal_id: null, customer_client_id: CUST, created_at: ago(10), deleted_at: null },
    { id: INV(3), site_id: SITE, number: null, title: 'Part payment', amount_cents: 50000, status: 'paid', paid_at: ago(1), paid_method: 'zelle', payment_for: INV(1), deal_id: did(1), created_at: ago(1), deleted_at: null },
    { id: INV(4), site_id: SITE, number: 14, title: 'Mistake', amount_cents: 100, status: 'void', deal_id: null, created_at: ago(5), deleted_at: null },
    { id: INV(5), site_id: OTHER, number: 1, title: 'Not ours', amount_cents: 1, status: 'open', created_at: ago(1), deleted_at: null },
  ];
  db.reset(w);
  const r = await res(await I.handleSalesInvoicesList(req('GET', `/sales/invoices?today=${day(0)}`), site, cors));
  const d = r.body.data;
  const by = Object.fromEntries(d.items.map((i) => [i.title, i]));
  ok('every invoice of this studio, newest first, none of another\'s', r.status === 200 && d.items.length === 4 && d.items[0].title === 'Part payment' && !by['Not ours'], JSON.stringify(d.items.map((i) => i.title)));
  ok('an overdue deposit: its number, its deal and its person', by['Website, half up front'].state === 'overdue' && by['Website, half up front'].number_label === '#0012' && by['Website, half up front'].deal_title === 'Harbor Dental site' && by['Website, half up front'].person === 'Avery Stone');
  ok('a paid one: how it was paid, and the customer it was billed to', by['Monthly care'].state === 'paid' && by['Monthly care'].paid_method === 'check' && by['Monthly care'].business === 'Larkspur Studio');
  ok('a part payment is its own paid row, pointing at its invoice', by['Part payment'].payment_for === INV(1) && by['Part payment'].state === 'paid');
  ok('a void one has no money state', by['Mistake'].status === 'void' && by['Mistake'].state === '');
  ok('not cut short', d.partial === false && d.today === day(0));
  db.reset(w); db.fail.add('presence_invoices');
  const f = await res(await I.handleSalesInvoicesList(req('GET', '/sales/invoices'), site, cors));
  ok('a failed read says so (502), never an empty book', f.status === 502 && /couldn.t load/.test(f.body.message));
}

// ═══ 8. migration, pack, routes, roles, the record page ═══
{
  const mig = read('supabase/migrations/0173_todos_and_calls_for_anyone.sql'), pack = read('docs/presence/APPLY-0173-prod.sql');
  ok('0173: a to-do\'s deal becomes optional, and it can be for a person or a customer', mig.includes('alter table public.presence_deal_tasks alter column deal_id drop not null;') && /add column if not exists contact_id uuid references public\.presence_contacts\(id\) on delete cascade/.test(mig) && /add column if not exists client_id uuid references public\.clients\(id\) on delete cascade/.test(mig));
  ok('0173: the person events table is deny-all and needs someone', mig.includes('alter table public.presence_person_events enable row level security;') && mig.includes('check (contact_id is not null or client_id is not null)') && !/create policy/i.test(mig));
  ok('0173: an index on each new link', ['presence_deal_tasks_contact_id_idx', 'presence_deal_tasks_client_id_idx', 'presence_person_events_contact_id_idx', 'presence_person_events_client_id_idx'].every((x) => mig.includes(x)));
  ok('0173 is the only migration with that number', [...Deno.readDirSync(new URL('supabase/migrations/', ROOT))].filter((e) => e.name.startsWith('0173_')).length === 1);
  // statements without their comments (a whole-line comment, or one after the code)
  const stmts = (t) => t.split('\n').filter((l) => !/^\s*--/.test(l)).map((l) => l.replace(/\s--\s.*$/, '')).join('\n').split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const migS = stmts(mig), packS = stmts(pack);
  ok('the pack runs every statement of the migration, all or nothing', packS[0] === 'begin' && packS.includes('commit') && migS.every((x) => packS.includes(x)), migS.filter((x) => !packS.includes(x)).join(' | '));
  const idx = read('supabase/functions/presence/index.ts');
  ok('routes: the To-dos read and write, the person log and the Invoices read', idx.includes("if (route === '/sales/tasks' && (method === 'GET' || method === 'POST')) return (await import('./routes/todos.ts')).handleSalesTasks(req, site, principal, cors);")
    && idx.includes("if (route === '/sales/people/activity' && method === 'POST') return (await import('./routes/todos.ts')).handlePeopleActivity(req, site, principal, cors);")
    && idx.includes("if (route === '/sales/invoices' && method === 'GET') return (await import('./routes/invoices_list.ts')).handleSalesInvoicesList(req, site, cors);"));
  eq('roles: a to-do for anyone and a call for anyone are edits', [R.memberWriteNeeds('/sales/tasks', 'POST'), R.memberWriteNeeds('/sales/people/activity', 'POST')], ['edit', 'edit']);
  const crm = read('crm.html'), pipe = read('pipeline.html');
  ok('record: a person with no deal has the Activity tab, Log a call and To-do', crm.includes('idParams().contact||(REC&&REC.identity&&REC.identity.client_id)') && crm.includes("if(hasDeal||hasPerson()){tabs.push(['logcall','Log a call']);tabs.push(['task','To-do']);}"));
  ok('record: the timeline asks for the person\'s own history', crm.includes("if(ids.contact)q.push('contact='+encodeURIComponent(ids.contact));"));
  ok('record: a call and a to-do go to the deal when there is one, else to the person', crm.includes("await apiAg('/sales/people/activity','POST',{...base,...personIds()})") && crm.includes("await apiAg('/sales/tasks','POST',{title,...(due?{due_date:due}:{}),...personIds()})"));
  ok('record and deal: "Follow up on" with Tomorrow and Next week', crm.includes('id="logFollow"') && crm.includes('data-fu="7">Next week') && pipe.includes('id="qlFollow"') && pipe.includes("follow_up:fu,follow_up_title:'Follow up'+(who?' with '+who:'')"));
}

// ═══ 9. the two pages, the menu, Home and + Create ═══
{
  const NAV = await import('../../supabase/functions/presence/lib/navigation.ts');
  const caps = ['view_all', 'edit', 'publish', 'connect', 'configure', 'invite'];
  const studio = NAV.buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: true, isOperator: false, siteLive: true });
  const keys = studio.filter((x) => !x.utility).map((x) => x.key);
  ok('the menu: To-dos right after Inbox, Invoices right after Pipeline', keys.indexOf('todos') === keys.indexOf('inbox') + 1 && keys.indexOf('invoices') === keys.indexOf('pipeline') + 1, keys.join(' · '));
  const item = (k) => studio.flatMap((x) => x.items).find((i) => i.key === k);
  ok('…each opens its page', item('todos').href === '/todos.html' && item('invoices').href === '/invoices.html' && !item('todos').hidden && !item('invoices').hidden);
  const headers = read('_headers'), redirects = read('_redirects');
  ok('clean addresses for both, never cached stale', ['/todos', '/invoices'].every((u) => headers.includes(`${u}\n  Cache-Control: no-cache, must-revalidate`)) && redirects.includes('/todos.html                   /todos               301!') && redirects.includes('/invoices.html                /invoices            301!'));
  const todos = read('todos.html'), invoices = read('invoices.html'), home = read('agency.html'), create = read('create.js'), shell = read('shell.js');
  ok('To-dos reads the whole list and makes one for anyone', todos.includes("api('/sales/tasks')") && todos.includes("api('/sales/tasks','POST',body)") && todos.includes("body.contact_id=fv.slice(8)") && todos.includes("body.client_id=fv.slice(7)"));
  ok('To-dos: Done uses the route that owns each kind, and each has its way back', todos.includes("['PATCH','/sales/deal-tasks/'+encodeURIComponent(t.id),{status:back?'open':'done'}]") && todos.includes("{next_step:t.title,next_step_at:t.due||null}") && todos.includes("{status:back?'todo':'done'}"));
  ok('Invoices: the read, the PDF, and a payment by hand through the deal page\'s own route', invoices.includes("api('/sales/invoices?today='+ymd())") && invoices.includes("'/sales/invoices/'+encodeURIComponent(i.id)+'/document'") && invoices.includes("'/sales/invoices/'+encodeURIComponent(i.id)+'/payment?today='+ymd()"));
  ok('Invoices: an older server says the page is on its way, and opens Pipeline\'s Who owes you', invoices.includes('Invoices is on its way.') && invoices.includes('href="/pipeline.html#outstanding"'));
  ok('To-dos: an older server says the page is on its way too', todos.includes('To-dos is on its way.') && todos.includes("r.status===404&&!(r.body&&r.body.data)"));
  ok('Home\'s to-do card opens the whole list', home.includes('<a href="/todos.html" data-noscope="1">All to-dos →</a>'));
  ok('the menu has an icon for each', /todos: '<path/.test(shell) && /invoices: '<path/.test(shell));
  ok('+ Create: a call or a to-do for someone with no deal stays on them, and an older server falls back to starting a deal', create.includes("api('/sales/people/activity'") && create.includes("api('/sales/tasks'") && create.includes("if (r.status === 404 || (r.status === 409 && r.body && r.body.error === 'needs_update')) return Promise.reject({ useDeal: true });") && create.includes("p = p ? p.catch(function (e) { return e && e.useDeal ? viaDeal() : Promise.reject(e); }) : viaDeal();"));
}
// a deleted to-do for a person names them on Recently deleted
{
  const w = world();
  w.presence_deal_tasks.push({ id: tid(8), site_id: SITE, deal_id: null, contact_id: cid(1), title: 'Old reminder', status: 'open', deleted_at: ago(1) });
  db.reset(w);
  const r = await res(await S.handleSalesDeleted(site, cors));
  const t = r.body.data.todos.find((x) => x.title === 'Old reminder');
  ok('Recently deleted names who a deleted to-do was for, and opens their record', t && t.for_name === 'Avery Stone' && t.href === `/crm.html?contact=${cid(1)}`, JSON.stringify(t));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
