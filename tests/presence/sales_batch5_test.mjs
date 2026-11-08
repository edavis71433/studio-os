// ── Sales review batch five (Nov 2026): items 29, 30, 34, 36 ────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_batch5_test.mjs
//
//   29  "My tasks" on Home: next steps on open deals, open deal to-dos and the
//       studio's own project tasks, each with its due date and a Done.
//   30  the Board keeps a collapsed Won column and a Not-a-fit drop zone.
//   34  support requests show and take a priority and an assignee.
//   36  an empty Pipeline walks the four steps to a first customer.
const T = await import('../../supabase/functions/presence/lib/my_tasks.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ── 29: the rule ──
const ME = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const list = T.buildMyTasks({
  deals: [
    { id: 'd1', title: 'Harbor Lane Bakery', stage: 'proposal', next_step: 'Follow up call', next_step_at: '2026-11-05' },
    { id: 'd2', title: 'Northside Dental', stage: 'lead', next_step: '  ', next_step_at: '2026-11-01' },      // blank → nothing
    { id: 'd3', title: 'Willow Day Spa', stage: 'won', next_step: 'Send the welcome pack' },                  // closed → not a next step
    { id: 'd4', title: 'Acme', stage: 'qualified', next_step: 'Book a call' },                                // undated
  ],
  dealTasks: [
    { id: 'dt1', deal_id: 'd1', title: 'Price the add-ons', due_date: '2026-11-10', status: 'open' },
    { id: 'dt2', deal_id: 'd9', title: 'On a deal that is gone', status: 'open' },
    { id: 'dt3', deal_id: 'd5', title: 'On a lost deal', status: 'open' },
    { id: 'dt4', deal_id: 'd3', title: 'Welcome call', due_date: '2026-11-03T00:00:00Z', status: 'open' },    // a won deal's to-do stays
    { id: 'dt5', deal_id: 'd1', title: 'Already done', status: 'done' },
  ],
  taskDeals: [{ id: 'd1', title: 'Harbor Lane Bakery', stage: 'proposal' }, { id: 'd3', title: 'Willow Day Spa', stage: 'won' }, { id: 'd5', title: 'Gone cold', stage: 'lost' }],
  projectTasks: [
    { id: 'pt1', project_id: 'p1', title: 'Build the pages', status: 'in_progress', due_date: '2026-11-08' },
    { id: 'pt2', project_id: 'p1', title: 'Send the logo', status: 'todo', client_action_required: true },     // the client's to-do
    { id: 'pt3', project_id: 'p1', title: 'Dana\'s task', status: 'todo', assigned_to: OTHER },               // someone else's
    { id: 'pt4', project_id: 'p1', title: 'Mine', status: 'todo', assigned_to: ME },
    { id: 'pt5', project_id: 'p1', title: 'Waiting on hosting', status: 'blocked' },
    { id: 'pt6', project_id: 'p2', title: 'On a finished project', status: 'todo' },
    { id: 'pt7', project_id: 'p1', title: 'Done already', status: 'done' },
  ],
  projects: [{ id: 'p1', name: 'Website rebuild', status: 'active' }, { id: 'p2', name: 'Old site', status: 'complete' }],
  userId: ME,
});
eq('the order: dated soonest first, then undated by kind', list.map((t) => t.id), ['dt4', 'd1', 'pt1', 'dt1', 'd4', 'pt4', 'pt5']);
eq('kinds', list.map((t) => t.kind), ['deal_task', 'next_step', 'project_task', 'deal_task', 'next_step', 'project_task', 'project_task']);
eq('a next step opens its deal', list.find((t) => t.id === 'd1').href, '/pipeline.html?deal=d1');
eq('a project task opens its project and names it', [list.find((t) => t.id === 'pt1').href, list.find((t) => t.id === 'pt1').context], ['/projects.html?project=p1', 'Website rebuild']);
eq('a timestamp due date reads as its day', list.find((t) => t.id === 'dt4').due, '2026-11-03');
eq('a blocked task is flagged (Home offers no Done on it)', list.filter((t) => t.blocked).map((t) => t.id), ['pt5']);
eq('signed out of the list: nobody\'s user id → only unassigned tasks', T.buildMyTasks({ deals: [], dealTasks: [], taskDeals: [], projectTasks: [{ id: 'a', project_id: 'p', title: 'x', status: 'todo', assigned_to: ME }, { id: 'b', project_id: 'p', title: 'y', status: 'todo' }], projects: [{ id: 'p', name: 'P', status: 'on_hold' }], userId: null }).map((t) => t.id), ['b']);
eq('junk in → nothing out', T.buildMyTasks({ deals: [null, {}], dealTasks: [null], taskDeals: [], projectTasks: [{}], projects: [], userId: null }), []);
eq('the cap', T.MY_TASKS_MAX, 50);

// ── 29: the route and the page ──
const idx = read('supabase/functions/presence/index.ts');
ok('GET /sales/my-tasks sits with the other /sales routes (same gate)', /if \(route === '\/sales\/my-tasks' && method === 'GET'\) return handleSalesMyTasks\(req, site, principal, cors\);/.test(idx));
const sales = read('supabase/functions/presence/routes/sales.ts');
ok('it reads only the signed-in site\'s rows', (sales.match(/handleSalesMyTasks[\s\S]*?\n}\n/) || [''])[0].split('site_id=eq.${site.id}').length - 1 === 5);
ok('a failed read says partial, never a false empty list', /if \(!r\.ok\) \{ partial = true; return \[\]; \}/.test(sales) && /items: all\.slice\(0, MY_TASKS_MAX\), total: all\.length, partial/.test(sales));
const home = read('agency.html');
ok('Done uses the route that owns each kind', /if\(t\.kind==='next_step'\)return\['PATCH','\/sales\/deals\/'\+encodeURIComponent\(t\.id\),\{next_step:'',next_step_at:''\}\];/.test(home)
  && /if\(t\.kind==='deal_task'\)return\['PATCH','\/sales\/deal-tasks\/'\+encodeURIComponent\(t\.id\),\{status:'done'\}\];/.test(home)
  && /return\['PATCH','\/projects\/'\+encodeURIComponent\(t\.parent_id\)\+'\/tasks\/'\+encodeURIComponent\(t\.id\),\{status:'done'\}\];/.test(home));
ok('an older server without the route keeps This week', /const todos=MYTASKS\?\[\]:weekTodos\(deals\);/.test(home));
ok('a row leaves only after its write succeeds', /if\(!r\.ok\)\{b\.disabled=false;toast\(/.test(home) && /MYTASKS\.items=MYTASKS\.items\.filter\(x=>x!==t\)/.test(home));

// ── 30 + 36 ──
const pipe = read('pipeline.html');
ok('the board ends with Won and Not a fit', /<div class="board with-out">\$\{cols\}\$\{outcomeColsHtml\(\)\}<\/div>/.test(pipe));
ok('Not a fit is a drop zone the existing drag wiring serves', /<div class="col-body lost-drop" data-drop="lost">/.test(pipe));
ok('Won is never a drop target (it is convert-only)', !/data-drop="won"/.test(pipe));
ok('the Won column reads the summary\'s number once it has loaded', /if\(s\.won_month\)\{WON_MONTH=wm;/.test(pipe));
ok('an empty board shows the walkthrough, not four empty columns', /if\(!DEALS\.length\)\{if\(window\.ddsStudioLevel&&window\.ddsStudioLevel\(host,\{noun:'Deals',lower:'deals and invoices'\}\)\)return;renderFirstDeal\(host\);return;\}/.test(pipe));
ok('the walkthrough has four steps and step one\'s button', /<h3>Your first deal, in four steps<\/h3>/.test(pipe) && (pipe.match(/<li><b>/g) || []).length >= 4 && /id="fdNew">Add your first deal<\/button>/.test(pipe));

// ── 34 ──
const ws = read('supabase/functions/presence/routes/workspace.ts');
ok('the feed carries each request\'s priority and assignee', /const cols = 'id,subject,status,priority,assigned_to,project_id,requester,created_at,updated_at';/.test(ws)
  && /priority: String\(r\.priority \|\| 'normal'\), assigned_to: r\.assigned_to \? String\(r\.assigned_to\) : null,/.test(ws));
ok('the team list carries each person\'s sign-in id', /presence_agency_members\?agency_id=eq\.\$\{member\.agency_id\}&select=id,email,role,status,user_id,created_at/.test(read('supabase/functions/presence/agency/routes.ts')));
const inbox = read('inbox.html');
ok('the assignee picker shows only once a second person has signed in', /if\(team\.people\.length>1\)\{/.test(inbox));
ok('the row shows High and Urgent only', /\(p==='high'\|\|p==='urgent'\?`<span class="prio \$\{p\}">/.test(inbox));
ok('both save through the existing triage route', /api\('\/support\/'\+encodeURIComponent\(it\.support_id\),'PATCH',\{\[field\]:value\|\|null\}\)/.test(inbox));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
