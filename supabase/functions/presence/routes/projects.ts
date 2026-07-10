// ── Service Delivery routes (Presence CMS Phase 2, P2-D) ─────────────────────
// One coherent /projects/* resource surface — the authoritative post-sale
// delivery container and its tasks/milestones/activity. Every query is
// site_id-scoped (tenant isolation). The studio side (operator/agency) manages;
// the client side (the customer / reviewer) READS only client_visible rows. All
// writes are studio-side. Reuses the P2-C event/idempotency idioms; no legacy data.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { resolveSiteRole } from '../lib/workspace.ts';
import {
  isProjectStatus, canProjectTransition, isTaskStatus, canTaskTransition, isTaskPriority,
  deriveTaskState, compareOrder, nextSortOrder, forViewer, clampLimit, clampOffset, progressOf,
  type ProjectStatus, type TaskStatus,
} from '../lib/service_delivery.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s: unknown, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const dateOrNull = (v: unknown): { ok: true; v: string | null } | { ok: false } => {
  if (v === undefined || v === null || v === '') return { ok: true, v: null };
  const s = clean(v, 10);
  return DATE_RE.test(s) ? { ok: true, v: s } : { ok: false };
};

/** The studio side MANAGES delivery; the client side READS only client_visible.
 *  "Studio" = anyone who reaches the workspace and isn't a client_reviewer — the
 *  site owner (a solo business owner managing their own delivery), an operator, or
 *  an agency member drilled in. A client_reviewer (the customer's read-only portal
 *  audience) is the client side. Role-based, so a solo owner is never locked out. */
export async function isStudioSide(jwt: string, site: SiteRow, principal: Principal): Promise<boolean> {
  if (principal.kind === 'staff' || principal.kind === 'system') return true;
  try { return (await resolveSiteRole(jwt, site.id, principal.kind)) !== 'client_reviewer'; } catch { return false; }
}
export const studioDenied = (cors: Record<string, string>) =>
  json({ error: 'forbidden', message: 'Only your studio can change service-delivery records.' }, 403, cors);

export async function projectEvent(siteId: string, projectId: string, kind: string, principal: Principal, clientVisible: boolean, detail: Record<string, unknown> = {}) {
  await svc('presence_project_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ project_id: projectId, site_id: siteId, kind, actor: principal.email || principal.userId || 'system', actor_kind: principal.kind, client_visible: clientVisible, detail }) }).catch(() => {});
}

export async function loadProject(siteId: string, id: string) {
  const r = await svc(`presence_projects?id=eq.${id}&site_id=eq.${siteId}&deleted_at=is.null&select=*&limit=1`);
  return rows(r)[0] || null;
}

// ═══ PROJECTS ═══
export async function handleProjects(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const studio = await isStudioSide(jwt, site, principal);
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const status = u.searchParams.get('status');
    const q = clean(u.searchParams.get('q'), 80);
    const limit = clampLimit(u.searchParams.get('limit'));
    const offset = clampOffset(u.searchParams.get('offset'));
    let path = `presence_projects?site_id=eq.${site.id}&deleted_at=is.null&select=id,name,status,client_visible,client_id,deal_id,owner_user_id,start_date,target_date,updated_at&order=updated_at.desc&limit=${limit}&offset=${offset}`;
    if (status && isProjectStatus(status)) path += `&status=eq.${status}`;
    if (!studio) path += `&client_visible=is.true`;                 // client side: visible projects only
    if (q) path += `&name.ilike.*${encodeURIComponent(q)}*`;
    const r = await svc(path);
    if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t load projects just now.' }, 502, cors);
    return json({ data: rows(r), limit, offset, is_studio_view: studio }, 200, cors);
  }
  if (req.method === 'POST') {
    if (!studio) return studioDenied(cors);
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }

    // idempotent convert handoff: create-from-deal (a deal maps to at most one project)
    let dealId: string | null = UUID_RE.test(b.deal_id || '') ? b.deal_id : null;
    let clientId: string | null = null;
    if (dealId) {
      const deal = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,converted_client_id,created_project_id&limit=1`))[0];
      if (!deal) return json({ error: 'bad_deal', message: 'That deal isn’t in this workspace.' }, 422, cors);
      if (deal.created_project_id) {                                 // already handed off → return the existing project
        const existing = await loadProject(site.id, deal.created_project_id);
        if (existing) return json({ data: existing, idempotent: true }, 200, cors);
      }
      clientId = deal.converted_client_id || null;
      if (!b.name) b.name = deal.title;
    }
    const name = clean(b.name, 200);
    if (!name) return json({ error: 'validation', message: 'A project needs a name.' }, 422, cors);
    const sd = dateOrNull(b.start_date), td = dateOrNull(b.target_date);
    if (!sd.ok || !td.ok) return json({ error: 'validation', message: 'Dates must be YYYY-MM-DD.' }, 422, cors);

    const ins = await svc('presence_projects', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: site.id, client_id: clientId, deal_id: dealId, name,
        description: clean(b.description, 5000), status: 'active',
        owner_user_id: UUID_RE.test(b.owner_user_id || '') ? b.owner_user_id : null,
        client_visible: b.client_visible === false ? false : true,
        start_date: sd.v, target_date: td.v }) });
    if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That project didn’t save — please try again.' }, 502, cors);
    const project = rows(ins)[0];

    if (dealId) { // stamp the handoff idempotently (only if still unclaimed); orphan-safe
      const claim = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&created_project_id=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ created_project_id: project.id }) });
      if (!rows(claim)[0]) { // someone handed off first — drop our orphan, return theirs
        await svc(`presence_projects?id=eq.${project.id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: nowIso() }) }).catch(() => {});
        const deal = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&select=created_project_id&limit=1`))[0];
        const existing = deal?.created_project_id ? await loadProject(site.id, deal.created_project_id) : null;
        if (existing) return json({ data: existing, idempotent: true }, 200, cors);
      }
    }
    await projectEvent(site.id, project.id, 'project_created', principal, project.client_visible, { name });
    return json({ data: project }, 201, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

export async function handleProject(req: Request, jwt: string, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const studio = await isStudioSide(jwt, site, principal);
  const project = await loadProject(site.id, id);
  if (!project || (!studio && !project.client_visible)) return json({ error: 'not_found', message: 'That project isn’t here.' }, 404, cors);

  if (req.method === 'GET') {
    const [ms, ts, ev, dl, ap] = await Promise.all([
      svc(`presence_milestones?project_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,status,due_date,sort_order,client_visible,completed_at&order=sort_order.asc`),
      svc(`presence_tasks?project_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,detail,status,priority,client_visible,client_action_required,assigned_to,milestone_id,due_date,sort_order,completed_at&order=sort_order.asc&limit=500`),
      svc(`presence_project_events?project_id=eq.${id}&site_id=eq.${site.id}&select=kind,detail,actor,client_visible,created_at&order=created_at.desc&limit=50`),
      svc(`presence_deliverables?project_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,note,status,client_visible,media_id,created_at&order=created_at.desc&limit=200`),
      svc(`presence_approvals?project_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,subject_type,subject_id,title,summary,content_hash,status,client_visible,requested_at,decided_at,decision_note&order=created_at.desc&limit=100`),
    ]);
    const now = nowIso();
    const milestones = forViewer(rows(ms), studio).sort(compareOrder);
    const tasksAll = rows(ts);
    const tasks = forViewer(tasksAll, studio).sort(compareOrder).map((t) => ({ ...t, derived: deriveTaskState(t, now) }));
    const events = forViewer(rows(ev), studio);
    // for the client side, deliverables are only visible when shared; approvals only when client_visible
    const deliverables = (studio ? rows(dl) : rows(dl).filter((d) => d.client_visible === true && d.status === 'shared'));
    const approvals = forViewer(rows(ap), studio);
    const progress = progressOf(studio ? tasksAll : tasksAll.filter((t) => t.client_visible === true));
    return json({ data: { project, milestones, tasks, events, deliverables, approvals, progress, is_studio_view: studio } }, 200, cors);
  }
  if (req.method === 'PATCH') {
    if (!studio) return studioDenied(cors);
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) { const n = clean(b.name, 200); if (!n) return json({ error: 'validation', message: 'A project needs a name.' }, 422, cors); patch.name = n; }
    if (b.description !== undefined) patch.description = clean(b.description, 5000);
    if (b.client_visible !== undefined) patch.client_visible = !!b.client_visible;
    if (b.owner_user_id !== undefined) patch.owner_user_id = UUID_RE.test(b.owner_user_id || '') ? b.owner_user_id : null;
    for (const k of ['start_date', 'target_date'] as const) {
      if (b[k] !== undefined) { const d = dateOrNull(b[k]); if (!d.ok) return json({ error: 'validation', message: 'Dates must be YYYY-MM-DD.' }, 422, cors); patch[k] = d.v; }
    }
    if (!Object.keys(patch).length) return json({ error: 'empty_update' }, 400, cors);
    const up = await svc(`presence_projects?id=eq.${id}&site_id=eq.${site.id}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    if (!up.ok || !rows(up)[0]) return json({ error: 'write_failed' }, 502, cors);
    return json({ data: rows(up)[0] }, 200, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

export async function handleProjectStatus(req: Request, jwt: string, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const to = b.to as ProjectStatus;
  if (!isProjectStatus(to)) return json({ error: 'bad_status' }, 422, cors);
  const project = await loadProject(site.id, id);
  if (!project) return json({ error: 'not_found' }, 404, cors);
  if (project.status === to) return json({ data: project }, 200, cors); // idempotent no-op
  if (!canProjectTransition(project.status, to)) return json({ error: 'invalid_transition', message: `A project can’t move from ${project.status} to ${to}.` }, 409, cors);
  const patch: Record<string, unknown> = { status: to };
  const up = await svc(`presence_projects?id=eq.${id}&site_id=eq.${site.id}&status=eq.${project.status}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict', message: 'That project just changed — refresh and try again.' }, 409, cors); // optimistic: prior-status guard in WHERE
  await projectEvent(site.id, id, 'status_change', principal, project.client_visible, { from: project.status, to });
  return json({ data: rows(up)[0] }, 200, cors);
}

// ═══ TASKS ═══
export async function handleTasksCreate(req: Request, jwt: string, site: SiteRow, principal: Principal, projectId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  const project = await loadProject(site.id, projectId);
  if (!project) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const title = clean(b.title, 200);
  if (!title) return json({ error: 'validation', message: 'A task needs a title.' }, 422, cors);
  let milestoneId: string | null = UUID_RE.test(b.milestone_id || '') ? b.milestone_id : null;
  if (milestoneId) { const m = rows(await svc(`presence_milestones?id=eq.${milestoneId}&project_id=eq.${projectId}&site_id=eq.${site.id}&select=id&limit=1`))[0]; if (!m) milestoneId = null; }
  const dd = dateOrNull(b.due_date);
  if (!dd.ok) return json({ error: 'validation', message: 'Due date must be YYYY-MM-DD.' }, 422, cors);
  const existing = rows(await svc(`presence_tasks?project_id=eq.${projectId}&site_id=eq.${site.id}&deleted_at=is.null&select=sort_order`));
  const clientVisible = b.client_visible === true || b.client_action_required === true;
  const ins = await svc('presence_tasks', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, project_id: projectId, milestone_id: milestoneId, title,
      detail: clean(b.detail, 5000), status: 'todo',
      priority: isTaskPriority(b.priority) ? b.priority : 'normal',
      client_visible: clientVisible, client_action_required: b.client_action_required === true,
      assigned_to: UUID_RE.test(b.assigned_to || '') ? b.assigned_to : null,
      due_date: dd.v, sort_order: nextSortOrder(existing), source: clean(b.source, 40) || 'manual' }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That task didn’t save — please try again.' }, 502, cors);
  const task = rows(ins)[0];
  await projectEvent(site.id, projectId, 'task_created', principal, task.client_visible, { task_id: task.id, title });
  return json({ data: task }, 201, cors);
}

export async function handleTask(req: Request, jwt: string, site: SiteRow, principal: Principal, projectId: string, taskId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(taskId)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  const task = rows(await svc(`presence_tasks?id=eq.${taskId}&project_id=eq.${projectId}&site_id=eq.${site.id}&deleted_at=is.null&select=*&limit=1`))[0];
  if (!task) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }

  // a status change is a guarded transition + a recorded event
  if (b.status !== undefined) {
    const to = b.status as TaskStatus;
    if (!isTaskStatus(to)) return json({ error: 'bad_status' }, 422, cors);
    if (to !== task.status) {
      if (!canTaskTransition(task.status, to)) return json({ error: 'invalid_transition', message: `A task can’t move from ${task.status} to ${to}.` }, 409, cors);
      const patch: Record<string, unknown> = { status: to, completed_at: to === 'done' ? nowIso() : null };
      const up = await svc(`presence_tasks?id=eq.${taskId}&site_id=eq.${site.id}&status=eq.${task.status}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
      if (!up.ok || !rows(up)[0]) return json({ error: 'conflict', message: 'That task just changed — refresh and try again.' }, 409, cors);
      await projectEvent(site.id, projectId, 'task_status_change', principal, task.client_visible, { task_id: taskId, from: task.status, to });
      return json({ data: rows(up)[0] }, 200, cors);
    }
  }
  // otherwise a field patch
  const patch: Record<string, unknown> = {};
  if (b.title !== undefined) { const t = clean(b.title, 200); if (!t) return json({ error: 'validation', message: 'A task needs a title.' }, 422, cors); patch.title = t; }
  if (b.detail !== undefined) patch.detail = clean(b.detail, 5000);
  if (b.priority !== undefined) { if (!isTaskPriority(b.priority)) return json({ error: 'validation', message: 'Priority must be low, normal, or high.' }, 422, cors); patch.priority = b.priority; }
  if (b.client_visible !== undefined) patch.client_visible = !!b.client_visible;
  if (b.client_action_required !== undefined) { patch.client_action_required = !!b.client_action_required; if (b.client_action_required === true) patch.client_visible = true; }
  if (b.assigned_to !== undefined) patch.assigned_to = UUID_RE.test(b.assigned_to || '') ? b.assigned_to : null;
  if (b.milestone_id !== undefined) { const mid = UUID_RE.test(b.milestone_id || '') ? b.milestone_id : null; if (mid) { const m = rows(await svc(`presence_milestones?id=eq.${mid}&project_id=eq.${projectId}&site_id=eq.${site.id}&select=id&limit=1`))[0]; patch.milestone_id = m ? mid : null; } else patch.milestone_id = null; }
  if (b.due_date !== undefined) { const dd = dateOrNull(b.due_date); if (!dd.ok) return json({ error: 'validation', message: 'Due date must be YYYY-MM-DD.' }, 422, cors); patch.due_date = dd.v; }
  if (!Object.keys(patch).length) return json({ error: 'empty_update' }, 400, cors);
  const up = await svc(`presence_tasks?id=eq.${taskId}&site_id=eq.${site.id}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'write_failed' }, 502, cors);
  return json({ data: rows(up)[0] }, 200, cors);
}

// ═══ MILESTONES ═══
export async function handleMilestonesCreate(req: Request, jwt: string, site: SiteRow, principal: Principal, projectId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  const project = await loadProject(site.id, projectId);
  if (!project) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const title = clean(b.title, 200);
  if (!title) return json({ error: 'validation', message: 'A milestone needs a title.' }, 422, cors);
  const dd = dateOrNull(b.due_date);
  if (!dd.ok) return json({ error: 'validation', message: 'Due date must be YYYY-MM-DD.' }, 422, cors);
  const existing = rows(await svc(`presence_milestones?project_id=eq.${projectId}&site_id=eq.${site.id}&deleted_at=is.null&select=sort_order`));
  const ins = await svc('presence_milestones', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, project_id: projectId, title, status: 'open', due_date: dd.v,
      sort_order: nextSortOrder(existing), client_visible: b.client_visible === false ? false : true }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed' }, 502, cors);
  const m = rows(ins)[0];
  await projectEvent(site.id, projectId, 'milestone_created', principal, m.client_visible, { milestone_id: m.id, title });
  return json({ data: m }, 201, cors);
}

export async function handleMilestone(req: Request, jwt: string, site: SiteRow, principal: Principal, projectId: string, mid: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(mid)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  const m = rows(await svc(`presence_milestones?id=eq.${mid}&project_id=eq.${projectId}&site_id=eq.${site.id}&deleted_at=is.null&select=*&limit=1`))[0];
  if (!m) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const patch: Record<string, unknown> = {};
  if (b.title !== undefined) { const t = clean(b.title, 200); if (!t) return json({ error: 'validation', message: 'A milestone needs a title.' }, 422, cors); patch.title = t; }
  if (b.client_visible !== undefined) patch.client_visible = !!b.client_visible;
  if (b.due_date !== undefined) { const dd = dateOrNull(b.due_date); if (!dd.ok) return json({ error: 'validation', message: 'Due date must be YYYY-MM-DD.' }, 422, cors); patch.due_date = dd.v; }
  let completed = false;
  if (b.status !== undefined) {
    if (b.status !== 'open' && b.status !== 'complete') return json({ error: 'bad_status' }, 422, cors);
    patch.status = b.status;
    patch.completed_at = b.status === 'complete' ? nowIso() : null;
    completed = b.status === 'complete' && m.status !== 'complete';
  }
  if (!Object.keys(patch).length) return json({ error: 'empty_update' }, 400, cors);
  const up = await svc(`presence_milestones?id=eq.${mid}&site_id=eq.${site.id}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'write_failed' }, 502, cors);
  if (completed) await projectEvent(site.id, projectId, 'milestone_completed', principal, rows(up)[0].client_visible, { milestone_id: mid, title: rows(up)[0].title });
  return json({ data: rows(up)[0] }, 200, cors);
}
