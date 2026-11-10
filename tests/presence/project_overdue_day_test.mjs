// ── Bug hunt C11 (Nov 10 2026): a step due today is overdue only once YOUR day is over ──
//   deno run --allow-read --allow-env --allow-net tests/presence/project_overdue_day_test.mjs
// Projects counted a step overdue once its due day had ended on the UTC clock, which turns
// over mid-afternoon in Los Angeles: from about 4pm (3pm in summer) a step due today read
// "1 step overdue" and the project "Late". Item 65 fixed the pipeline and records by
// sending the page's own day (?today=, lib/sales_lifecycle.ts callerToday); this pins the
// same for the three Projects reads — the board's progress, the report and the record —
// through a PostgREST fetch fake, plus the page sending its day.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const { handleProjectsProgress, handleProjectReport, handleProject } = await import('../../supabase/functions/presence/routes/projects.ts');

const P1 = '11111111-1111-4111-8111-111111111111';
const SITE = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const STUDIO = { kind: 'operator' };
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const UTC_TODAY = day(0), UTC_YESTERDAY = day(-1);
// the evening in Los Angeles: the server's UTC day has turned over, the studio's hasn't —
// so the studio's "today" is the UTC yesterday, and a step due then is due today, not late
const TASKS = [
  { id: 't1', project_id: P1, status: 'todo', client_visible: true, title: 'Send the draft', due_date: UTC_YESTERDAY, sort_order: 1, created_at: '2026-10-01T00:00:00Z' },
  { id: 't2', project_id: P1, status: 'todo', client_visible: true, title: 'Collect photos', due_date: day(-3), sort_order: 2, created_at: '2026-10-01T00:00:00Z' },   // late on anyone's clock
  { id: 't3', project_id: P1, status: 'done', client_visible: true, title: 'Kickoff call', due_date: day(-5), sort_order: 0, created_at: '2026-10-01T00:00:00Z' },
];
const jr = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  const table = new URL(url).pathname.split('/').pop();
  if (table === 'presence_projects') return jr([{ id: P1, site_id: SITE.id, name: 'Shop site', status: 'active', client_visible: true }]);
  if (table === 'presence_tasks') return jr(TASKS);
  return jr([]);
};
const req = (path) => new Request(`https://fn.example/presence${path}`);
const progress = async (q) => (await (await handleProjectsProgress(req(`/projects/progress?ids=${P1}${q}`), 'jwt', SITE, STUDIO, {})).json()).data[P1];
const report = async (q) => (await (await handleProjectReport(req(`/projects/${P1}/report${q ? '?' + q.slice(1) : ''}`), 'jwt', SITE, STUDIO, P1, {})).json()).data.summary;
const record = async (q) => (await (await handleProject(req(`/projects/${P1}${q ? '?' + q.slice(1) : ''}`), 'jwt', SITE, STUDIO, P1, {})).json()).data;

// ── the board's progress (GET /projects/progress) ──
ok('board: with no day sent, the UTC day decides (as before): 2 overdue', (await progress('')).overdue === 2);
ok('board: the studio\'s day is still yesterday on the UTC clock → the step due then is not overdue: 1', (await progress(`&today=${UTC_YESTERDAY}`)).overdue === 1);
ok('board: the studio\'s day the same as UTC → 2', (await progress(`&today=${UTC_TODAY}`)).overdue === 2);
ok('board: a day no time zone is on (three back) falls back to UTC → 2', (await progress(`&today=${day(-3)}`)).overdue === 2);
ok('board: not a day at all falls back to UTC → 2', (await progress('&today=tomorrow')).overdue === 2);
ok('board: a step done is never overdue, whatever the day', (await progress(`&today=${day(1)}`)).overdue === 2);

// ── the report (GET /projects/:id/report) ──
ok('report: no day sent → 2 overdue', (await report('')).overdue_tasks === 2);
ok('report: the studio\'s day → 1', (await report(`&today=${UTC_YESTERDAY}`)).overdue_tasks === 1);

// ── the record (GET /projects/:id): each task's own "overdue" tag ──
{
  const late = (d) => d.tasks.filter((t) => t.derived && t.derived.overdue).map((t) => t.id).sort().join(',');
  ok('record: no day sent → both open steps past their day are tagged', late(await record('')) === 't1,t2');
  ok('record: the studio\'s day → only the one really late', late(await record(`&today=${UTC_YESTERDAY}`)) === 't2');
}

// ── the page sends its own day on all three ──
{
  const h = Deno.readTextFileSync(new URL('../../projects.html', import.meta.url));
  ok('page: the board\'s progress read carries today', /api\('\/projects\/progress\?ids='\+part\.join\(','\)\+'&today='\+today\)/.test(h));
  ok('page: the record and its report carry today', /const td='\?today='\+todayYmd\(\);/.test(h) && /api\('\/projects\/'\+id\+td\),api\('\/projects\/'\+id\+'\/report'\+td\)/.test(h));
  ok('page: today is the computer\'s own day', /const todayYmd=\(\)=>\{const d=new Date\(\);return d\.getFullYear\(\)/.test(h));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ PROJECT OVERDUE ON YOUR DAY (bug hunt C11): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
