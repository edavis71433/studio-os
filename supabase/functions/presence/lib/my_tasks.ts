// ── My tasks (sales review item 29, Nov 2026) ───────────────────────────────
// One list of what the studio itself has to do, for Home: the next step on each
// OPEN deal, every open to-do on a deal that is not lost, and every studio-side
// task (not a client to-do) on an active or on-hold project that is unassigned
// or assigned to the person asking. Sales item 85: and every open to-do for a
// person, a customer or nobody (your own), from the same to-dos table, so Home's
// Done works the same way for it. Pure: the route reads the rows, this decides.

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
  later: boolean;        // item 53: an undated project step behind that project's next open step
  order: number | null;  // a project step's place on its checklist (sort_order), so Home can move the next one up
  for?: 'deal' | 'person' | 'customer' | 'me';   // item 85: whose a to-do (deal_task) is
  owner?: string | null;   // item 37: who owns the deal or to-do (their sign-in id); null = the business owner
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
  people?: any[];          // item 85: the people to-dos are for (id, name, email, deleted_at)
  customers?: any[];       // …and the customers (id, name, email)
  mine?: (assignedTo: unknown) => boolean;   // item 37: with a team, only your deals' next steps and your to-dos
}): MyTask[] {
  const out: MyTask[] = [];
  const yours = (o: unknown) => !input.mine || input.mine(o);
  for (const d of input.deals || []) {
    if (!d || !d.id || !MY_TASKS_OPEN_STAGES.includes(String(d.stage))) continue;
    if (!yours(d.assigned_to)) continue;   // item 37: a teammate's deal is theirs to follow up
    const t = String(d.next_step || '').trim();
    if (!t) continue;
    out.push({ owner: d.assigned_to ? String(d.assigned_to) : null, kind: 'next_step', id: String(d.id), parent_id: String(d.id), title: t, due: ymd(d.next_step_at), context: String(d.title || 'A deal'), href: `/pipeline.html?deal=${d.id}`, blocked: false, later: false, order: null });
  }
  const dealById = new Map((input.taskDeals || []).filter((d) => d && d.id).map((d) => [String(d.id), d]));
  const personById = new Map((input.people || []).filter((c) => c && c.id).map((c) => [String(c.id), c]));
  const customerById = new Map((input.customers || []).filter((c) => c && c.id).map((c) => [String(c.id), c]));
  for (const t of input.dealTasks || []) {
    if (!t || !t.id || String(t.status || 'open') !== 'open') continue;
    if (!yours(t.assigned_to)) continue;   // item 37: a teammate's to-do
    const title = String(t.title || '').trim();
    if (!title) continue;
    if (t.deal_id) {
      const d = dealById.get(String(t.deal_id));
      if (!d || String(d.stage) === 'lost') continue;   // a deleted deal, or one marked not a fit
      out.push({ owner: t.assigned_to ? String(t.assigned_to) : null, kind: 'deal_task', id: String(t.id), parent_id: String(d.id), title, due: ymd(t.due_date), context: String(d.title || 'A deal'), href: `/pipeline.html?deal=${d.id}`, blocked: false, later: false, order: null, for: 'deal' });
      continue;
    }
    // item 85: a to-do for a person or a customer opens their record; one for nobody is your own
    if (t.contact_id) {
      const c = personById.get(String(t.contact_id));
      if (!c || c.deleted_at) continue;   // a person taken off the list takes their to-dos with them (Recently deleted brings both back)
      out.push({ owner: t.assigned_to ? String(t.assigned_to) : null, kind: 'deal_task', id: String(t.id), parent_id: String(c.id), title, due: ymd(t.due_date), context: String(c.name || c.email || 'A contact'), href: `/crm.html?contact=${c.id}`, blocked: false, later: false, order: null, for: 'person' });
    } else if (t.client_id) {
      const k = customerById.get(String(t.client_id));
      out.push({ owner: t.assigned_to ? String(t.assigned_to) : null, kind: 'deal_task', id: String(t.id), parent_id: String(t.client_id), title, due: ymd(t.due_date), context: String((k && (k.name || k.email)) || 'A customer'), href: `/crm.html?client_id=${t.client_id}`, blocked: false, later: false, order: null, for: 'customer' });
    } else {
      out.push({ owner: t.assigned_to ? String(t.assigned_to) : null, kind: 'deal_task', id: String(t.id), parent_id: '', title, due: ymd(t.due_date), context: 'Your own to-do', href: '/todos.html', blocked: false, later: false, order: null, for: 'me' });
    }
  }
  const projById = new Map((input.projects || []).filter((p) => p && p.id).map((p) => [String(p.id), p]));
  // A studio-side step this list can show: still open, and yours or nobody's.
  const yoursOpen = (t: any) => !!t && !!t.id && t.client_action_required !== true && !!t.project_id
    && ['todo', 'in_progress', 'blocked'].includes(String(t.status || 'todo'))
    && !(t.assigned_to && String(t.assigned_to) !== String(input.userId || ''));
  // Second walk (Nov 8, item 53): Home listed 20 undated project steps — every
  // unticked line of four checklists. Only each project's NEXT open step (the
  // lowest sort_order) counts as now; the steps behind it, unless dated, are
  // `later`: Home hides them until Show all.
  // Sales 64 (F7): the next step is picked from the same steps the list shows. It was picked
  // from every step, so with a second seat a teammate's step (or a finished one) at the top
  // of a checklist turned all of yours on that project into "later", behind Show all.
  const nextOf: Record<string, any> = {};
  for (const t of input.projectTasks || []) {
    if (!yoursOpen(t)) continue;
    const k = String(t.project_id), cur = nextOf[k];
    const so = Number(t.sort_order ?? Infinity), cso = cur ? Number(cur.sort_order ?? Infinity) : Infinity;
    if (!cur || so < cso || (so === cso && String(t.title || '') < String(cur.title || ''))) nextOf[k] = t;
  }
  for (const t of input.projectTasks || []) {
    if (!yoursOpen(t)) continue;   // a client's to-do, a finished step, or someone else's
    const st = String(t.status || 'todo');
    const p = projById.get(String(t.project_id || ''));
    if (!p || !(p.status === 'active' || p.status === 'on_hold')) continue;
    const title = String(t.title || '').trim();
    if (!title) continue;
    out.push({ kind: 'project_task', id: String(t.id), parent_id: String(p.id), title, due: ymd(t.due_date), context: String(p.name || 'A project'), href: `/projects.html?project=${p.id}`, blocked: st === 'blocked', later: !ymd(t.due_date) && nextOf[String(p.id)] !== t, order: Number.isFinite(Number(t.sort_order)) && t.sort_order !== null ? Number(t.sort_order) : null });
  }
  // now before later; dated first, soonest (so overdue) first; then undated, next steps before to-dos before project tasks
  out.sort((a, b) => (a.later ? 1 : 0) - (b.later ? 1 : 0)
    || (a.due ? 0 : 1) - (b.due ? 0 : 1)
    || String(a.due || '').localeCompare(String(b.due || ''))
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || a.context.localeCompare(b.context) || a.title.localeCompare(b.title));
  return out;
}
