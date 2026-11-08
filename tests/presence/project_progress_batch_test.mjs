// ── GET /projects/progress: many projects' Progress and Open approvals in one read ──
//   deno run --allow-read --allow-env --allow-net tests/presence/project_progress_batch_test.mjs
// Item 86 (Nov 8 2026). The Projects roster and Today's "Waiting on clients" asked
// /projects/:id/report once per project, up to 60 at a time. This route answers for all of
// them, counting the same rows the report counts for those two numbers, and is driven here
// through a fetch fake: the counts, who sees what, one read per table, paging past the row
// cap, the id limit, and the tenant scope of every query.
const ROOT = new URL('../../', import.meta.url);
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const { handleProjectsProgress, PROGRESS_BATCH_MAX } = await import('../../supabase/functions/presence/routes/projects.ts');
const { reportSummary } = await import('../../supabase/functions/presence/lib/service_delivery.ts');

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
  if (table === 'presence_tasks') return body(page((manyTasks || TASKS).filter((t) => want.includes(t.project_id))));
  if (table === 'presence_approvals') return body(page(APPROVALS.filter((a) => want.includes(a.project_id))));
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
  ok('one read of each table for all the projects', ['presence_projects', 'presence_tasks', 'presence_approvals'].every((t) => tables.filter((x) => x === t).length === 1), tables.join());
  const reads = r.calls.filter((u) => !u.includes('presence_site_members'));   // the role lookup is the shared one
  ok('every read is scoped to this site', reads.length === 3 && reads.every((u) => u.includes(`site_id=eq.${SITE.id}`)));
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
