// ── Service delivery — pure decision logic (P2-D) ────────────────────────────
//   deno run --allow-read tests/presence/service_delivery_test.mjs
import {
  PROJECT_STATUSES, isProjectStatus, canProjectTransition,
  TASK_STATUSES, isTaskStatus, canTaskTransition, isTaskPriority,
  deriveTaskState, compareOrder, nextSortOrder, visibleToClient, forViewer,
  clampLimit, clampOffset, progressOf,
} from '../../supabase/functions/presence/lib/service_delivery.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

// ── project status ladder ──
ok('project statuses are the four bounded states', PROJECT_STATUSES.join(',') === 'active,on_hold,complete,archived');
ok('isProjectStatus guards the enum', isProjectStatus('active') && !isProjectStatus('deleted') && !isProjectStatus(''));
ok('project: active→on_hold allowed', canProjectTransition('active', 'on_hold'));
ok('project: active→complete allowed', canProjectTransition('active', 'complete'));
ok('project: on_hold→active allowed', canProjectTransition('on_hold', 'active'));
ok('project: complete→archived allowed', canProjectTransition('complete', 'archived'));
ok('project: archived→active (reopen) allowed', canProjectTransition('archived', 'active'));
ok('project: archived→complete refused (not adjacent)', !canProjectTransition('archived', 'complete'));
ok('project: same→same refused (no-op is not a transition)', !canProjectTransition('active', 'active'));

// ── task status ladder ──
ok('task statuses are the four bounded states', TASK_STATUSES.join(',') === 'todo,in_progress,blocked,done');
ok('isTaskStatus guards the enum', isTaskStatus('todo') && !isTaskStatus('cancelled'));
ok('task: todo→in_progress allowed', canTaskTransition('todo', 'in_progress'));
ok('task: in_progress→done allowed', canTaskTransition('in_progress', 'done'));
ok('task: any active→blocked allowed', canTaskTransition('todo', 'blocked') && canTaskTransition('in_progress', 'blocked'));
ok('task: blocked→in_progress allowed (unblock)', canTaskTransition('blocked', 'in_progress'));
ok('task: done→todo allowed (reopen)', canTaskTransition('done', 'todo'));
ok('task: blocked→done refused (must unblock first)', !canTaskTransition('blocked', 'done'));
ok('task: todo→todo refused', !canTaskTransition('todo', 'todo'));
ok('isTaskPriority guards the enum', isTaskPriority('high') && isTaskPriority('low') && !isTaskPriority('urgent'));

// ── derived task state ──
const NOW = '2026-07-10T12:00:00.000Z';
ok('derive: overdue when past due and not done', deriveTaskState({ status: 'todo', due_date: '2026-07-01' }, NOW).overdue === true);
ok('derive: NOT overdue when done', deriveTaskState({ status: 'done', due_date: '2026-07-01' }, NOW).overdue === false);
ok('derive: NOT overdue when due in the future', deriveTaskState({ status: 'todo', due_date: '2026-08-01' }, NOW).overdue === false);
ok('derive: no due date → never overdue', deriveTaskState({ status: 'todo', due_date: null }, NOW).overdue === false);
ok('derive: blocked reflects status', deriveTaskState({ status: 'blocked' }, NOW).blocked === true);
ok('derive: open reflects not-done', deriveTaskState({ status: 'in_progress' }, NOW).open === true && deriveTaskState({ status: 'done' }, NOW).open === false);

// ── deterministic ordering ──
const items = [
  { id: 'c', sort_order: 1, created_at: '2026-01-01' },
  { id: 'a', sort_order: 0, created_at: '2026-01-03' },
  { id: 'b', sort_order: 0, created_at: '2026-01-02' },
];
const sorted = [...items].sort(compareOrder).map((x) => x.id).join('');
ok('order: sort_order asc, then created_at asc (b before a; c last)', sorted === 'bac');
ok('order is a total order (stable by id on full ties)', [{ id: 'y', sort_order: 0, created_at: 't' }, { id: 'x', sort_order: 0, created_at: 't' }].sort(compareOrder)[0].id === 'x');
ok('nextSortOrder appends after the max', nextSortOrder([{ sort_order: 0 }, { sort_order: 3 }, { sort_order: 1 }]) === 4);
ok('nextSortOrder of empty is 0', nextSortOrder([]) === 0);

// ── client-visibility projection ──
ok('visibleToClient: studio sees internal', visibleToClient({ client_visible: false }, true) === true);
ok('visibleToClient: client sees only visible', visibleToClient({ client_visible: false }, false) === false && visibleToClient({ client_visible: true }, false) === true);
const mixed = [{ client_visible: true, id: 1 }, { client_visible: false, id: 2 }];
ok('forViewer(studio) keeps all', forViewer(mixed, true).length === 2);
ok('forViewer(client) drops internal', forViewer(mixed, false).length === 1 && forViewer(mixed, false)[0].id === 1);

// ── pagination ──
ok('clampLimit default is 25', clampLimit(undefined) === 25 && clampLimit('0') === 25 && clampLimit('-3') === 25);
ok('clampLimit caps at 100', clampLimit('9999') === 100 && clampLimit('50') === 50);
ok('clampOffset floors at 0', clampOffset('-5') === 0 && clampOffset('10') === 10 && clampOffset('x') === 0);

// ── progress roll-up ──
ok('progress: 1 of 4 done = 25%', (() => { const p = progressOf([{ status: 'done' }, { status: 'todo' }, { status: 'in_progress' }, { status: 'blocked' }]); return p.total === 4 && p.done === 1 && p.pct === 25; })());
ok('progress: empty is 0% (no divide-by-zero)', (() => { const p = progressOf([]); return p.total === 0 && p.pct === 0; })());

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SERVICE DELIVERY (P2-D pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
