// ── My tasks (sales review item 29, Nov 2026) ───────────────────────────────
// One list of what the studio itself has to do, for Home: the next step on each
// OPEN deal, every open to-do on a deal that is not lost, and every studio-side
// task (not a client to-do) on an active or on-hold project that is unassigned
// or assigned to the person asking. Pure: the route reads the rows, this decides.

export type MyTaskKind = 'next_step' | 'deal_task' | 'project_task';
export interface MyTask {
  kind: MyTaskKind;
  id: string;            // the deal (next_step), the deal to-do, or the project task
  parent_id: string;     // the deal or the project
  title: string;
  due: string | null;    // YYYY-MM-DD
  context: string;       // the deal title or project name
  href: string;
  blocked: boolean;      // a blocked project task cannot be ticked done from Home
}
export const MY_TASKS_OPEN_STAGES = ['lead', 'qualified', 'proposal', 'contract'];
export const MY_TASKS_MAX = 50;
const ymd = (v: unknown) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : null; };
const KIND_ORDER: Record<MyTaskKind, number> = { next_step: 0, deal_task: 1, project_task: 2 };

export function buildMyTasks(input: {
  deals: any[];            // open-stage deals with next_step / next_step_at
  dealTasks: any[];        // open deal to-dos
  taskDeals: any[];        // the deals those to-dos belong to (id, title, stage)
  projectTasks: any[];     // open studio-side project tasks
  projects: any[];         // the projects those belong to (id, name, status)
  userId: string | null;
}): MyTask[] {
  const out: MyTask[] = [];
  for (const d of input.deals || []) {
    if (!d || !d.id || !MY_TASKS_OPEN_STAGES.includes(String(d.stage))) continue;
    const t = String(d.next_step || '').trim();
    if (!t) continue;
    out.push({ kind: 'next_step', id: String(d.id), parent_id: String(d.id), title: t, due: ymd(d.next_step_at), context: String(d.title || 'A deal'), href: `/pipeline.html?deal=${d.id}`, blocked: false });
  }
  const dealById = new Map((input.taskDeals || []).filter((d) => d && d.id).map((d) => [String(d.id), d]));
  for (const t of input.dealTasks || []) {
    if (!t || !t.id || String(t.status || 'open') !== 'open') continue;
    const d = dealById.get(String(t.deal_id || ''));
    if (!d || String(d.stage) === 'lost') continue;   // a deleted deal, or one marked not a fit
    const title = String(t.title || '').trim();
    if (!title) continue;
    out.push({ kind: 'deal_task', id: String(t.id), parent_id: String(d.id), title, due: ymd(t.due_date), context: String(d.title || 'A deal'), href: `/pipeline.html?deal=${d.id}`, blocked: false });
  }
  const projById = new Map((input.projects || []).filter((p) => p && p.id).map((p) => [String(p.id), p]));
  for (const t of input.projectTasks || []) {
    if (!t || !t.id || t.client_action_required === true) continue;
    const st = String(t.status || 'todo');
    if (st !== 'todo' && st !== 'in_progress' && st !== 'blocked') continue;
    if (t.assigned_to && String(t.assigned_to) !== String(input.userId || '')) continue;   // someone else's
    const p = projById.get(String(t.project_id || ''));
    if (!p || !(p.status === 'active' || p.status === 'on_hold')) continue;
    const title = String(t.title || '').trim();
    if (!title) continue;
    out.push({ kind: 'project_task', id: String(t.id), parent_id: String(p.id), title, due: ymd(t.due_date), context: String(p.name || 'A project'), href: `/projects.html?project=${p.id}`, blocked: st === 'blocked' });
  }
  // dated first, soonest (so overdue) first; then undated, next steps before to-dos before project tasks
  out.sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1)
    || String(a.due || '').localeCompare(String(b.due || ''))
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || a.context.localeCompare(b.context) || a.title.localeCompare(b.title));
  return out;
}
