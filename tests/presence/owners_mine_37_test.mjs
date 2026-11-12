// ── Sales 37 (owners and Mine) and sales 64's F7 (My tasks' next step) ──────────
//   deno run --allow-read --allow-env --allow-net tests/presence/owners_mine_37_test.mjs
// F7: each project's next step is picked from the steps My tasks shows (open, and yours
// or nobody's), so a teammate's step, or a finished one, at the top of a checklist no
// longer turns every one of yours into "later" behind Show all.
const T = await import('../../supabase/functions/presence/lib/my_tasks.ts');

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
