// ── GET /projects/progress: many projects' Progress and Open approvals in one read ──
//   deno run --allow-read --allow-env --allow-net tests/presence/project_progress_batch_test.mjs
// Item 86 (Nov 8 2026). The Projects roster and Today's "Waiting on clients" asked
// /projects/:id/report once per project, up to 60 at a time. This route answers for all of
// them, counting the same rows the report counts for those two numbers, and is driven here
// through a fetch fake: the counts, who sees what, one read per table, paging past the row
// cap, the id limit, and the tenant scope of every query. The bold redesign (Nov 2026) puts
// the roster on a board by stage, so the same read now also says where each project stands
// and whose move it is (boardFacts) — pinned at the end, pure and through the route.
const ROOT = new URL('../../', import.meta.url);
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const { handleProjectsProgress, PROGRESS_BATCH_MAX } = await import('../../supabase/functions/presence/routes/projects.ts');
const { reportSummary, boardFacts, stageOfWords, PROJECT_STAGES } = await import('../../supabase/functions/presence/lib/service_delivery.ts');
const { DELIVERY_CHECKLIST, checklistSource, checklistStageOf } = await import('../../supabase/functions/presence/lib/project_checklist.ts');

const P1 = '11111111-1111-4111-8111-111111111111';   // client-visible
const P2 = '22222222-2222-4222-8222-222222222222';   // the studio's own
const P3 = '33333333-3333-4333-8333-333333333333';   // another site's: never asked for here
const SITE = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const PROJECTS = [{ id: P1, client_visible: true }, { id: P2, client_visible: false }];
const TASKS = [
  { id: 't1', project_id: P1, status: 'done', client_visible: true },
  { id: 't2', project_id: P1, status: 'todo', client_visible: true },
  { id: 't3', project_id: P1, status: 'in_progress', client_visible: false },   // internal
  { id: 't4', project_id: P2, status: 'done', client_visible: false },
];
const APPROVALS = [
  { id: 'a1', project_id: P1, status: 'pending', client_visible: true },
  { id: 'a2', project_id: P1, status: 'pending', client_visible: false },   // internal
  { id: 'a3', project_id: P1, status: 'approved', client_visible: true },
  { id: 'a4', project_id: P2, status: 'pending', client_visible: false },
];

// The fake: answers PostgREST by table, records every URL, and plays a reviewer's seat when asked.
let calls = [];
let reviewer = false;
let manyTasks = null;   // replaces TASKS, to page past the row cap
let boardRows = null;   // { tasks, approvals, milestones } for the board's facts, in place of the above
const realFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  calls.push(url);
  const body = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/auth/v1/user')) return body({ id: 'u-1', email: 'reviewer@example.com' });
  const q = new URL(url);
  const table = q.pathname.split('/').pop();
  if (table === 'presence_site_members') return body(reviewer ? [{ id: 'm-1', role: 'client_reviewer', user_id: 'u-1' }] : []);
  const page = (list) => {
    const limit = Number(q.searchParams.get('limit') || list.length), offset = Number(q.searchParams.get('offset') || 0);
    return list.slice(offset, offset + limit);
  };
  const want = (q.searchParams.get('id') || q.searchParams.get('project_id') || '').replace(/^in\.\(|\)$/g, '').split(',');
  if (table === 'presence_projects') return body(PROJECTS.filter((p) => want.includes(p.id)));
  if (table === 'presence_tasks') return body(page((boardRows ? boardRows.tasks : (manyTasks || TASKS)).filter((t) => want.includes(t.project_id))));
  if (table === 'presence_approvals') return body(page((boardRows ? boardRows.approvals : APPROVALS).filter((a) => want.includes(a.project_id))));
  if (table === 'presence_milestones') return body(page((boardRows ? boardRows.milestones : []).filter((m) => want.includes(m.project_id))));
  return new Response('[]', { status: 200 });
};
const ask = async (ids, principal = { kind: 'operator' }) => {
  calls = [];
  const req = new Request(`https://fn.example/presence/projects/progress?ids=${ids}`);
  const res = await handleProjectsProgress(req, 'jwt-' + Math.random(), SITE, principal, {});
  return { status: res.status, data: (await res.json()).data, calls: calls.filter((u) => u.includes('/rest/v1/presence_')) };
};

// ── the studio: every row counts ──
{
  const r = await ask([P1, P2].join(','));
  ok('answers 200 with an entry per project', r.status === 200 && Object.keys(r.data).sort().join() === [P1, P2].sort().join());
  ok('P1 progress counts every task: 1 of 3 done, 33%', JSON.stringify(r.data[P1]?.progress) === JSON.stringify({ total: 3, done: 1, pct: 33 }));
  ok('P1 open approvals count the internal one too: 2', r.data[P1]?.pending_approvals === 2);
  ok('P2, the studio’s own: 1 of 1 done, 1 open approval', r.data[P2]?.progress?.pct === 100 && r.data[P2]?.pending_approvals === 1);
  // the same numbers the per-project report gives
  const fromReport = reportSummary({ tasks: TASKS.filter((t) => t.project_id === P1), milestones: [], deliverables: [], approvals: APPROVALS.filter((a) => a.project_id === P1) }, new Date().toISOString());
  ok('the numbers match the report’s for the same rows', JSON.stringify(fromReport.progress) === JSON.stringify(r.data[P1].progress) && fromReport.pending_approvals === r.data[P1].pending_approvals);
  const tables = r.calls.map((u) => new URL(u).pathname.split('/').pop());
  ok('one read of each table for all the projects', ['presence_projects', 'presence_tasks', 'presence_approvals', 'presence_milestones'].every((t) => tables.filter((x) => x === t).length === 1), tables.join());
  const reads = r.calls.filter((u) => !u.includes('presence_site_members'));   // the role lookup is the shared one
  ok('every read is scoped to this site', reads.length === 4 && reads.every((u) => u.includes(`site_id=eq.${SITE.id}`)));
  ok('deleted rows are left out of every read', reads.every((u) => u.includes('deleted_at=is.null')));
}

// ── the client side: only what a client may see ──
{
  reviewer = true;
  const r = await ask([P1, P2].join(','), { kind: 'client', member: null });
  reviewer = false;
  ok('a client reviewer doesn’t get the studio’s own project', !(P2 in r.data));
  ok('their progress counts only client-visible tasks: 1 of 2', JSON.stringify(r.data[P1]?.progress) === JSON.stringify({ total: 2, done: 1, pct: 50 }));
  ok('their open approvals count only client-visible ones: 1', r.data[P1]?.pending_approvals === 1);
}

// ── the ids asked for ──
{
  const r = await ask('');
  ok('no ids: an empty answer and no reads', r.status === 200 && JSON.stringify(r.data) === '{}' && r.calls.length === 0);
  const junk = await ask(['not-a-uuid', "1');drop", P1.toUpperCase(), P1].join(','));
  ok('anything that isn’t an id is dropped, and an id asked twice is read once', Object.keys(junk.data).join() === P1 && junk.calls.every((u) => !u.includes('drop') && !u.includes('not-a-uuid')));
  const lots = Array.from({ length: 75 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const capped = await ask(lots.join(','));
  const asked = new URL(capped.calls.find((u) => u.includes('presence_projects'))).searchParams.get('id').replace(/^in\.\(|\)$/g, '').split(',');
  ok(`at most ${PROGRESS_BATCH_MAX} projects per read`, asked.length === PROGRESS_BATCH_MAX);
  const other = await ask([P1, P3].join(','));
  ok('a project of another site never answers', !(P3 in other.data));
}

// ── a big studio: the row cap can't shorten a count ──
{
  manyTasks = Array.from({ length: 2500 }, (_, i) => ({ id: `t${String(i).padStart(5, '0')}`, project_id: P1, status: i < 1000 ? 'done' : 'todo', client_visible: true }));
  const r = await ask(P1);
  manyTasks = null;
  const taskReads = r.calls.filter((u) => u.includes('presence_tasks'));
  ok('2,500 tasks are read in pages and all counted', r.data[P1]?.progress?.total === 2500 && r.data[P1]?.progress?.done === 1000, JSON.stringify(r.data[P1]?.progress));
  ok('the pages follow a fixed order, so none is read twice or skipped', taskReads.length === 3 && taskReads.every((u) => u.includes('order=id.asc')));
}

// ── the board: where each project stands and whose move it is (bold redesign) ──
{
  const NOW = '2026-11-09T12:00:00.000Z';
  const ck = (key, status, extra = {}) => ({ id: 'ck-' + key, status, source: checklistSource(key), title: DELIVERY_CHECKLIST.find((s) => s.key === key).title, client_action_required: !!DELIVERY_CHECKLIST.find((s) => s.key === key).clientAction, sort_order: DELIVERY_CHECKLIST.findIndex((s) => s.key === key) * 10, ...extra });
  const spine = (doneUpTo) => DELIVERY_CHECKLIST.map((s, i) => ck(s.key, i < doneUpTo ? 'done' : 'todo'));
  ok('four stages, in delivery order', PROJECT_STAGES.join() === 'kickoff,design,review,launch');
  ok('every checklist step names its stage, and they run in order', DELIVERY_CHECKLIST.every((s) => PROJECT_STAGES.includes(s.stage))
    && DELIVERY_CHECKLIST.map((s) => PROJECT_STAGES.indexOf(s.stage)).every((v, i, a) => i === 0 || v >= a[i - 1]));
  const atStep = (n) => boardFacts({ tasks: spine(n), milestones: [], approvals: [] }, NOW, checklistStageOf);
  ok('the checklist: a fresh project is at kickoff, and the next step is the studio’s', atStep(0).stage === 'kickoff' && atStep(0).next.theirs === false && atStep(0).waiting === null);
  ok('the checklist: on the content step it is still kickoff, and it waits on the client for it',
    atStep(3).stage === 'kickoff' && atStep(3).next.theirs === true && atStep(3).waiting?.kind === 'task' && atStep(3).waiting.title === atStep(3).next.title);
  ok('the checklist: the draft step is design, their review is review, the domain is launch',
    atStep(4).stage === 'design' && atStep(5).stage === 'review' && atStep(6).stage === 'review' && atStep(7).stage === 'launch');
  ok('the checklist: every step done → launch, with nothing next', atStep(10).stage === 'launch' && atStep(10).next === null);
  // the order is the steps' own, whatever order the rows arrive in
  ok('rows arriving out of order are put in order first', boardFacts({ tasks: spine(4).reverse(), milestones: [], approvals: [] }, NOW, checklistStageOf).stage === 'design');

  // a project on the starter template: its milestones' words place it
  const ms = [
    { id: 'm1', title: 'Kickoff & brief', status: 'complete', sort_order: 0 },
    { id: 'm2', title: 'Design & first draft', status: 'open', sort_order: 1 },
    { id: 'm3', title: 'Review & revisions', status: 'open', sort_order: 2 },
    { id: 'm4', title: 'Launch', status: 'open', sort_order: 3 },
  ];
  const tmpl = [
    { id: 't1', title: 'Share your logo, brand colours, and photos', status: 'done', milestone_id: 'm1', sort_order: 0, client_action_required: true },
    { id: 't2', title: 'Share the draft for your review', status: 'todo', milestone_id: 'm2', sort_order: 1, client_action_required: true },
    { id: 't3', title: 'Apply revisions', status: 'todo', milestone_id: 'm3', sort_order: 2 },
  ];
  const t = boardFacts({ tasks: tmpl, milestones: ms, approvals: [] }, NOW, checklistStageOf);
  ok('a template task takes its milestone’s stage, not its own words (“…for your review” is still design)', t.stage === 'design', t.stage);
  ok('words alone: launch and review win over what was made', stageOfWords('Connect the domain and go live') === 'launch' && stageOfWords('Share the draft for your review') === 'review' && stageOfWords('Wireframes') === 'design' && stageOfWords('Collect content') === 'kickoff');
  ok('words that name no stage stay unnamed', stageOfWords('Call the printer') === null && stageOfWords('') === null && stageOfWords(null) === null);
  ok('a free-text task with no milestone is placed by its own words', boardFacts({ tasks: [{ id: 'x', title: 'Homepage mockup', status: 'todo' }], milestones: [], approvals: [] }, NOW, checklistStageOf).stage === 'design');
  ok('no open task says → the first open milestone that does', boardFacts({ tasks: [{ id: 'x', title: 'Call the printer', status: 'todo' }, { id: 'y', title: 'Lunch', status: 'done' }], milestones: ms, approvals: [] }, NOW, checklistStageOf).stage === 'design');
  ok('nothing says and nothing is done → kickoff (it is starting)', boardFacts({ tasks: [{ id: 'x', title: 'Call the printer', status: 'todo' }], milestones: [], approvals: [] }, NOW, checklistStageOf).stage === 'kickoff'
    && boardFacts({ tasks: [], milestones: [], approvals: [] }, NOW, checklistStageOf).stage === 'kickoff');
  ok('nothing says but some is done → no stage, never a guess', boardFacts({ tasks: [{ id: 'x', title: 'Call the printer', status: 'todo' }, { id: 'y', title: 'Lunch', status: 'done' }], milestones: [], approvals: [] }, NOW, checklistStageOf).stage === null);
  ok('every milestone complete and no tasks → launch', boardFacts({ tasks: [], milestones: ms.map((m) => ({ ...m, status: 'complete' })), approvals: [] }, NOW, checklistStageOf).stage === 'launch');

  // what the client owes: the oldest pending approval first
  const appr = [
    { id: 'a2', status: 'pending', title: 'Homepage design', created_at: '2026-11-05T00:00:00Z' },
    { id: 'a1', status: 'pending', title: 'Stacked logo', created_at: '2026-11-01T00:00:00Z' },
    { id: 'a0', status: 'approved', title: 'Colours', created_at: '2026-10-01T00:00:00Z' },
  ];
  const w = boardFacts({ tasks: spine(6), milestones: [], approvals: appr }, NOW, checklistStageOf);
  ok('a pending approval is what they owe — the oldest one — even when the next step is the studio’s', w.waiting?.kind === 'approval' && w.waiting.title === 'Stacked logo' && w.next.theirs === false);
  ok('decided approvals owe nothing', boardFacts({ tasks: spine(6), milestones: [], approvals: [appr[2]] }, NOW, checklistStageOf).waiting === null);
  // late steps
  const late = spine(3).map((x, i) => (i === 3 ? { ...x, due_date: '2026-11-01' } : i === 4 ? { ...x, due_date: '2026-12-01' } : i === 0 ? { ...x, due_date: '2026-10-01' } : x));
  const lf = boardFacts({ tasks: late, milestones: [], approvals: [] }, NOW, checklistStageOf);
  ok('overdue counts open steps past their date (a done one never)', lf.overdue === 1, String(lf.overdue));
  ok('the next step carries its date', lf.next.due_date === '2026-11-01');

  // through the route: the same facts, and a client sees only their side
  boardRows = {
    tasks: [
      { id: 'b1', project_id: P1, status: 'done', client_visible: true, title: 'Agreement signed', source: checklistSource('agreement_signed'), sort_order: 0, client_action_required: false },
      { id: 'b2', project_id: P1, status: 'todo', client_visible: false, title: 'Homepage mockup', source: 'manual', sort_order: 5, client_action_required: false },
      { id: 'b3', project_id: P1, status: 'todo', client_visible: true, title: 'Send your content and photos', source: checklistSource('content_received'), sort_order: 30, client_action_required: true, due_date: '2020-01-01' },
    ],
    approvals: [{ id: 'ba', project_id: P1, status: 'pending', client_visible: false, title: 'Internal sign-off', created_at: '2026-11-01T00:00:00Z' }],
    milestones: [{ id: 'bm', project_id: P1, title: 'Design & first draft', status: 'open', sort_order: 0, client_visible: true }],
  };
  const studioView = await ask(P1);
  const sv = studioView.data[P1];
  ok('the route answers stage, next, waiting and overdue beside the counts', sv && 'stage' in sv && 'next' in sv && 'waiting' in sv && 'overdue' in sv && sv.progress.total === 3);
  ok('the studio sees its own next step and its internal approval', sv.next?.title === 'Homepage mockup' && sv.next.theirs === false && sv.waiting?.title === 'Internal sign-off' && sv.overdue === 1);
  ok('the studio’s stage is its first open step’s — the internal mockup: design', sv.stage === 'design', sv.stage);
  reviewer = true;
  const clientView = await ask(P1, { kind: 'client', member: null });
  reviewer = false;
  const cv = clientView.data[P1];
  ok('a client never hears of an internal step or approval: their next is their own content step', cv.next?.title === 'Send your content and photos' && cv.next.theirs === true && cv.waiting?.kind === 'task' && cv.waiting.title === 'Send your content and photos');
  ok('a client’s stage comes from what they can see (the checklist step: kickoff)', cv.stage === 'kickoff', cv.stage);
  const tReads = studioView.calls.filter((u) => u.includes('presence_tasks') || u.includes('presence_milestones') || u.includes('presence_approvals'));
  ok('the board’s columns are read in the same one read per table', tReads.length === 3 && tReads.every((u) => u.includes('deleted_at=is.null') && u.includes(`site_id=eq.${SITE.id}`)));
  boardRows = null;
}

// ── wiring ──
{
  const idx = Deno.readTextFileSync(new URL('supabase/functions/presence/index.ts', ROOT));
  ok('GET /projects/progress is wired, ahead of the /projects/:id routes', /route === '\/projects\/progress' && method === 'GET'\) return handleProjectsProgress\(/.test(idx) && idx.indexOf("'/projects/progress'") < idx.indexOf('/^\\/projects\\/([0-9a-f-]{36})$/'));
  for (const page of ['projects.html', 'today.html']) {
    const src = Deno.readTextFileSync(new URL(page, ROOT));
    ok(`${page} reads /projects/progress, and the per-project report only when that route is missing`, src.includes("'/projects/progress?ids='") && /404/.test(src.slice(src.indexOf("'/projects/progress?ids='"), src.indexOf("'/projects/progress?ids='") + 700)));
  }
}

globalThis.fetch = realFetch;
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
