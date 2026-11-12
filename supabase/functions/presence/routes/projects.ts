// ── Service Delivery routes (Presence CMS Phase 2, P2-D) ─────────────────────
// One coherent /projects/* resource surface — the authoritative post-sale
// delivery container and its tasks/milestones/activity. Every query is
// site_id-scoped (tenant isolation). The studio side (operator/agency) manages;
// the client side (the customer / reviewer) READS only client_visible rows. All
// writes are studio-side. Reuses the P2-C event/idempotency idioms; no legacy data.
import { json } from '../../_shared/http.ts';
import { clearNotice } from '../lib/notice.ts';
import { approvalOverduePeriod } from '../lib/approvals.ts';
import { missingColumnSignal } from '../lib/inbound_email.ts';
import { svc, svcAll } from '../lib/db.ts';
import { resolveSiteRoleCached } from '../lib/workspace.ts';
import { ensureProjectForDeal, ensureBridge, reconcileChecklistFacts } from '../lib/service_bridge.ts';
import { offerCsat, csatRatingsForProject } from '../lib/csat.ts';
import { templateByKey, templateChoices, templateFromProject, savedTemplates, templateStepCount, dueFromStart, MAX_SAVED_PROJECT_TEMPLATES, type ProjectTemplate, type SavedProjectTemplate } from '../lib/project_templates.ts';
import { readReservedJsonOrThrow, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';   // sales item 106
import {
  checklistState, checklistRowsFor, checklistStep, checklistKeyOf, isChecklistSource,
  DELIVERY_CHECKLIST, checklistStageOf,
} from '../lib/project_checklist.ts';
import {
  isProjectStatus, canProjectTransition, isTaskStatus, canTaskTransition, isTaskPriority,
  deriveTaskState, compareOrder, nextSortOrder, forViewer, clampLimit, clampOffset, progressOf,
  reportSummary, boardFacts, type BoardFacts, type ProjectStatus, type TaskStatus,
} from '../lib/service_delivery.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { callerToday } from '../lib/sales_lifecycle.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s: unknown, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();
/** Bug hunt C11 (Nov 10 2026): a step is overdue once the CALLER's day is over. The
 *  server's UTC day turns over mid-afternoon in Los Angeles, so a step due today
 *  read "overdue" from about 4pm there. deriveTaskState calls a step late once the
 *  end of its due day is before `now`, and the start of the caller's today is exactly
 *  that line. The page sends ?today= (item 65's callerToday); without it, or with a
 *  day no time zone could be on, this is the start of the UTC day — the old rule. */
const overdueLine = (req: Request) => callerToday(new URL(req.url).searchParams.get('today'), nowIso()) + 'T00:00:00.000Z';
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
  try { return (await resolveSiteRoleCached(principal, jwt, site.id)) !== 'client_reviewer'; } catch { return false; }
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

/** A4: seed a fresh project's milestones + tasks from a starter template. Inserts
 *  directly (no per-item activity events — this is the initial scaffold, not a
 *  stream of "a task was added" notifications to the customer). Best-effort per
 *  row; a hiccup on one task never blocks the project being usable. */
async function applyTemplate(siteId: string, projectId: string, tmpl: ProjectTemplate | SavedProjectTemplate, startDate: string | null = null): Promise<void> {
  let mOrder = 0, tOrder = 0;
  for (const m of tmpl.milestones) {
    let milestoneId: string | null = null;
    try {
      const mi = rows(await svc('presence_milestones', { method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ site_id: siteId, project_id: projectId, title: m.title, status: 'open', due_date: null, sort_order: mOrder, client_visible: true }) }))[0];
      milestoneId = mi?.id || null;
    } catch { /* skip a milestone that won't insert */ }
    mOrder += 10;
    for (const t of (m.tasks || [])) {
      const clientAction = t.client_action_required === true;
      await svc('presence_tasks', { method: 'POST', headers: { Prefer: 'return=minimal' },
        // sales item 106: a saved template's step is due N days after the project's start
        body: JSON.stringify({ site_id: siteId, project_id: projectId, milestone_id: milestoneId, title: t.title, detail: '', status: 'todo', priority: 'normal', client_visible: clientAction, client_action_required: clientAction, due_date: dueFromStart(startDate, (t as { due_days?: number }).due_days), sort_order: tOrder, source: 'template' }) }).catch(() => {});
      tOrder += 10;
    }
  }
}

// ═══ PROJECT TEMPLATES (sales item 106) ═══
// GET lists the built-in starter and the studio's own; POST { name, from_project_id }
// saves a project's milestones and steps as one (lib/project_templates.ts); DELETE
// /projects/templates/:id removes one. Studio side only, like every project write.
export async function handleProjectTemplates(req: Request, jwt: string, site: SiteRow, principal: Principal, id: string | null, cors: Record<string, string>): Promise<Response> {
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  if (req.method === 'GET' && !id) {
    let saved: SavedProjectTemplate[];
    try { saved = savedTemplates(await readReservedJsonOrThrow(site.id, RESERVED_NAMES.projectTemplates)); }
    catch { return json({ error: 'read_failed', message: 'Your templates couldn’t load just now.' }, 502, cors); }
    return json({ data: { builtin: templateChoices(), saved: saved.map((t) => ({ id: t.id, name: t.name, milestones: t.milestones.length, steps: templateStepCount(t), created_at: t.created_at })) } }, 200, cors);
  }
  if (req.method === 'POST' && !id) {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const name = clean(b.name, 80);
    if (!name) return json({ error: 'validation', message: 'Give the template a name.' }, 422, cors);
    if (!UUID_RE.test(String(b.from_project_id || ''))) return json({ error: 'validation', message: 'Pick the project to save.' }, 422, cors);
    const project = await loadProject(site.id, String(b.from_project_id));
    if (!project) return json({ error: 'not_found', message: 'That project isn’t here.' }, 404, cors);
    const [ms, ts] = await Promise.all([
      svc(`presence_milestones?project_id=eq.${project.id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,sort_order&order=sort_order.asc&limit=60`),
      svc(`presence_tasks?project_id=eq.${project.id}&site_id=eq.${site.id}&deleted_at=is.null&select=title,milestone_id,client_action_required,due_date,sort_order,source&order=sort_order.asc&limit=200`),
    ]);
    if (!ms.ok || !ts.ok) return json({ error: 'read_failed', message: 'That project couldn’t be read just now.' }, 502, cors);
    const tpl = templateFromProject({ id: crypto.randomUUID(), name, now: new Date().toISOString(), startDate: project.start_date, milestones: rows(ms), tasks: rows(ts) });
    if (!templateStepCount(tpl)) return json({ error: 'empty', message: 'That project has no steps of its own to save yet.' }, 422, cors);
    let full = false;
    const next = await updateReservedJson(site.id, RESERVED_NAMES.projectTemplates, (cur) => {
      const list = savedTemplates(cur);
      if (list.length >= MAX_SAVED_PROJECT_TEMPLATES) { full = true; return list; }
      return [...list, tpl];
    }, principal.email || principal.userId || 'system');
    if (full) return json({ error: 'too_many', message: `You can keep up to ${MAX_SAVED_PROJECT_TEMPLATES} project templates. Remove one first.` }, 409, cors);
    if (!next) return json({ error: 'write_failed', message: 'The template didn’t save — please try again.' }, 502, cors);
    return json({ data: { id: tpl.id, name: tpl.name, milestones: tpl.milestones.length, steps: templateStepCount(tpl) } }, 201, cors);
  }
  if (req.method === 'DELETE' && id) {
    let found = false;
    const next = await updateReservedJson(site.id, RESERVED_NAMES.projectTemplates, (cur) => {
      const list = savedTemplates(cur);
      found = list.some((t) => t.id === id);
      return list.filter((t) => t.id !== id);
    }, principal.email || principal.userId || 'system');
    if (!next && !found) return json({ error: 'not_found', message: 'That template isn’t here.' }, 404, cors);
    if (!found) return json({ error: 'not_found', message: 'That template isn’t here.' }, 404, cors);
    return json({ data: { ok: true, id } }, 200, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

// ═══ PROJECTS ═══
export async function handleProjects(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const studio = await isStudioSide(jwt, site, principal);
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const status = u.searchParams.get('status');
    const q = clean(u.searchParams.get('q'), 80).replace(/[(),*"\\]/g, ' ').trim();   // L2: neutralize PostgREST filter grammar
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

    // create-from-deal → the ONE idempotent handoff (project on THIS agency site +
    // the tenant-safe Agency–Client Bridge to the customer's own workspace).
    const dealId: string | null = UUID_RE.test(b.deal_id || '') ? b.deal_id : null;
    if (dealId) {
      const deal = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,converted_client_id,converted_site_id,created_project_id&limit=1`))[0];
      if (!deal) return json({ error: 'bad_deal', message: 'That deal isn’t in this workspace.' }, 422, cors);
      const ph = await ensureProjectForDeal({ agencySiteId: site.id, deal, clientId: deal.converted_client_id || null, customerSiteId: deal.converted_site_id || null, actor: principal.email || principal.userId || 'system', actorKind: principal.kind });
      if (!ph.ok || !ph.project) return json({ error: ph.conflict ? 'handoff_conflict' : 'write_failed', message: 'We couldn’t start that project — please try again.' }, ph.conflict ? 409 : 502, cors);
      return json({ data: ph.project, idempotent: ph.idempotent }, ph.idempotent ? 200 : 201, cors);
    }

    // manual project (no deal) — optionally attached to an existing customer (W6)
    // and/or seeded from a starter template (A4).
    const name = clean(b.name, 200);
    if (!name) return json({ error: 'validation', message: 'A project needs a name.' }, 422, cors);
    const sd = dateOrNull(b.start_date), td = dateOrNull(b.target_date);
    if (!sd.ok || !td.ok) return json({ error: 'validation', message: 'Dates must be YYYY-MM-DD.' }, 422, cors);

    // W6: attach to an existing customer THIS agency converted → the project becomes
    // client-visible in their own workspace via the Agency–Client Bridge. A customer
    // can have more than one project (the bridge is keyed per project). We verify the
    // customer is ours (a converted deal on this site) before trusting the id.
    let customerClientId: string | null = UUID_RE.test(b.customer_client_id || '') ? b.customer_client_id : null;
    let customerSiteId: string | null = null;
    if (customerClientId) {
      const owned = rows(await svc(`presence_deals?site_id=eq.${site.id}&converted_client_id=eq.${customerClientId}&deleted_at=is.null&select=converted_site_id&limit=1`))[0];
      // bug hunt H2 (Nov 10): + New project offers every customer on the studio's books (its
      // active service links, /studio/customers), not the deals touched lately; one whose deal
      // was since deleted is still the studio's customer
      const linked = owned ? null : rows(await svc(`presence_service_links?agency_site_id=eq.${site.id}&customer_client_id=eq.${customerClientId}&status=eq.active&select=customer_site_id&limit=1`))[0];
      if (!owned && !linked) return json({ error: 'bad_customer', message: 'That customer isn’t one of yours yet — convert their deal first.' }, 422, cors);
      customerSiteId = (owned && owned.converted_site_id) || (linked && linked.customer_site_id) || null;
    }
    const clientVisible = b.client_visible === false ? false : true;

    const ins = await svc('presence_projects', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: site.id, client_id: customerClientId, deal_id: null, name,
        description: clean(b.description, 5000), status: 'active',
        owner_user_id: UUID_RE.test(b.owner_user_id || '') ? b.owner_user_id : null,
        client_visible: clientVisible,
        start_date: sd.v, target_date: td.v }) });
    if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That project didn’t save — please try again.' }, 502, cors);
    const project = rows(ins)[0];
    await projectEvent(site.id, project.id, 'project_created', principal, project.client_visible, { name });

    // W6: build the bridge so the customer sees this project in their workspace.
    if (customerClientId) {
      const bridged = await ensureBridge(site.id, project.id, customerClientId, customerSiteId, null);
      if (!bridged) { // belongs to another studio — don't leave an orphan client-visible project
        await svc(`presence_projects?id=eq.${project.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ client_id: null, client_visible: false }) }).catch(() => {});
        return json({ error: 'bridge_denied', message: 'That customer is managed by another studio.' }, 409, cors);
      }
    }

    // A4: seed a starter scaffold into the (empty) new project — fills only, never merges.
    // Sales item 106: or one of the studio's own saved templates, by its id, dated from the start.
    let tmpl: ProjectTemplate | SavedProjectTemplate | null = templateByKey(clean(b.template, 40));
    if (!tmpl && UUID_RE.test(String(b.template || ''))) tmpl = savedTemplates(await readReservedJsonOrThrow(site.id, RESERVED_NAMES.projectTemplates).catch(() => null)).find((t) => t.id === b.template) || null;
    if (tmpl) await applyTemplate(site.id, project.id, tmpl, sd.v || new Date().toISOString().slice(0, 10));

    return json({ data: project, templated: !!tmpl, bridged: !!customerClientId }, 201, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

/** The ONE approvals read both records use. `due_date` (migration 0135) rides
 *  along; before the column exists PostgREST 400s on the select, so the read
 *  retries without it — the record still renders, just undated. ONLY on that
 *  precise signal (missingColumnSignal naming due_date): any other failure —
 *  an outage, a timeout, a 5xx — is returned as it is (no rows, like every
 *  other read on the record), never retried into an undated list that would
 *  quietly read "Awaiting approval" where it should read "Overdue". */
export async function loadApprovals(filter: string, cols: string): Promise<any[]> {
  const withDue = await svc(`presence_approvals?${filter}&select=${cols},due_date`);
  if (withDue.ok) return rows(withDue);
  if (!missingColumnSignal(withDue.json, withDue.text, 'due_date')) return rows(withDue);
  return rows(await svc(`presence_approvals?${filter}&select=${cols}`));
}

/** The studio's "Still waiting on the client" row (approval_overdue, raised by
 *  lifecycle.runApprovalReminders) ends the moment THAT approval is decided —
 *  from either side. The period is per-approval (a re-request mints a new
 *  approval, a new row), so the exact key is the right clear. Best-effort. */
export async function clearApprovalOverdue(siteId: string, projectId: string | null, approvalId: string): Promise<void> {
  try {
    if (!projectId) return;
    const siteQ = await svc(`presence_sites?id=eq.${siteId}&select=client_id&limit=1`);
    const clientId = siteQ.json?.[0]?.client_id;
    if (clientId) await clearNotice(clientId, 'approval_overdue', approvalOverduePeriod(projectId, approvalId));
  } catch { /* never block a decision on its echo */ }
}

export async function handleProject(req: Request, jwt: string, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const studio = await isStudioSide(jwt, site, principal);
  const project = await loadProject(site.id, id);
  if (!project || (!studio && !project.client_visible)) return json({ error: 'not_found', message: 'That project isn’t here.' }, 404, cors);

  if (req.method === 'GET') {
    const [ms, ts, ev, dl, ap] = await Promise.all([
      svc(`presence_milestones?project_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,status,due_date,sort_order,client_visible,completed_at&order=sort_order.asc`),
      // `source` rides along so the studio's Tasks card can tell which of the ten
      // standard delivery steps this project already holds (checklistState) —
      // the picker must never offer a step that is already here.
      svc(`presence_tasks?project_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,detail,status,priority,client_visible,client_action_required,assigned_to,milestone_id,due_date,sort_order,completed_at,source&order=sort_order.asc&limit=500`),
      svc(`presence_project_events?project_id=eq.${id}&site_id=eq.${site.id}&select=kind,detail,actor,client_visible,created_at&order=created_at.desc&limit=50`),
      svc(`presence_deliverables?project_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,note,status,client_visible,media_id,created_at&order=created_at.desc&limit=200`),
      loadApprovals(`project_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&order=created_at.desc&limit=100`, 'id,subject_type,subject_id,title,summary,content_hash,status,client_visible,requested_at,decided_at,decision_note'),
    ]);
    const now = overdueLine(req);   // C11: each task's derived.overdue on the caller's day
    const milestones = forViewer(rows(ms), studio).sort(compareOrder);
    const tasksAll = rows(ts);
    const tasks = forViewer(tasksAll, studio).sort(compareOrder).map((t) => ({ ...t, derived: deriveTaskState(t, now) }));
    const events = forViewer(rows(ev), studio);
    // for the client side, deliverables are only visible when shared; approvals only when client_visible
    const deliverables = (studio ? rows(dl) : rows(dl).filter((d) => d.client_visible === true && d.status === 'shared'));
    const approvals = forViewer(ap, studio);
    const progress = progressOf(studio ? tasksAll : tasksAll.filter((t) => t.client_visible === true));
    // W11 — on the STUDIO side, surface the customer's authoritative SaaS
    // subscription status (read-only). This is the customer's Studio OS SOFTWARE
    // state, NOT something the agency bills — so the studio knows at a glance
    // whether their customer's product is live/lapsed. Explicitly distinct from
    // the service invoices the agency issues (presence project work).
    let customer_saas: Record<string, unknown> | null = null;
    if (studio) {
      const link = rows(await svc(`presence_service_links?project_id=eq.${id}&select=customer_client_id&limit=1`))[0];
      const custId = link?.customer_client_id;
      if (custId) {
        const ent = rows(await svc(`presence_entitlements?client_id=eq.${custId}&product=eq.presence&select=plan,status,cancel_at_period_end,grace_until,current_period_end&limit=1`))[0];
        if (ent) customer_saas = {
          billing_type: 'saas', plan: ent.plan, status: ent.status,
          in_grace: !!ent.grace_until, cancel_at_period_end: ent.cancel_at_period_end === true,
          current_period_end: ent.current_period_end, managed_by_customer: true,   // the agency views, never edits it
        };
      }
    }
    // The studio's step picker: the canonical ten (lib/project_checklist.ts) each
    // marked with whether THIS project already holds it. Server-side on purpose —
    // the page must not carry a second copy of the list, and "already present" is
    // a fact about rows, not about the browser. Studio-only: the client never
    // picks steps, and the catalog is not theirs to see.
    const checklist = studio ? checklistState(tasksAll) : null;
    return json({ data: { project, milestones, tasks, events, deliverables, approvals, progress, checklist, is_studio_view: studio, customer_saas } }, 200, cors);
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

/** A calm client report composed from authoritative rows (no report store). The
 *  client sees counts of only what's client-visible; the studio sees everything. */
export async function handleProjectReport(req: Request, jwt: string, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const studio = await isStudioSide(jwt, site, principal);
  const project = await loadProject(site.id, id);
  if (!project || (!studio && !project.client_visible)) return json({ error: 'not_found' }, 404, cors);
  const [ts, ms, dl, ap, ev] = await Promise.all([
    svc(`presence_tasks?project_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=status,client_visible,client_action_required,due_date&limit=1000`),
    svc(`presence_milestones?project_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=status,client_visible`),
    svc(`presence_deliverables?project_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=status,client_visible`),
    svc(`presence_approvals?project_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=status,client_visible`),
    svc(`presence_project_events?project_id=eq.${id}&site_id=eq.${site.id}&select=created_at,client_visible&order=created_at.desc&limit=1`),
  ]);
  // the client's report reflects only what they can see
  const tasks = forViewer(rows(ts), studio);
  const milestones = forViewer(rows(ms), studio);
  const deliverables = (studio ? rows(dl) : rows(dl).filter((d) => d.client_visible === true));
  const approvals = forViewer(rows(ap), studio);
  const lastEv = (studio ? rows(ev) : rows(ev).filter((e) => e.client_visible === true))[0];
  const csatRatings = await csatRatingsForProject(site.id, id);   // service edge #1: computed CSAT average
  const summary = reportSummary({ tasks, milestones, deliverables, approvals, lastActivityAt: lastEv?.created_at || null, csatRatings }, overdueLine(req));   // C11
  return json({ data: { project: { id: project.id, name: project.name, status: project.status, start_date: project.start_date, target_date: project.target_date }, summary, generated_at: nowIso(), is_studio_view: studio } }, 200, cors);
}

/** Item 86: the Projects roster's Progress and Open approvals columns and Today's "Waiting on
 *  clients" card, for many projects in one read. They asked /projects/:id/report once per
 *  project, up to 60 at a time. Counts the same rows the report counts for these two numbers,
 *  with the same visibility rule: the client side sees only client-visible projects and rows.
 *  Each table is read once for all of them, in pages, so the row cap can't shorten a count.
 *  The bold redesign (Nov 2026) puts the roster on a board by stage, so the same rows also
 *  answer where each project stands and whose move it is (boardFacts) — one more table,
 *  the milestones, whose words place a project that isn't on the checklist. */
export const PROGRESS_BATCH_MAX = 60;
export async function handleProjectsProgress(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const asked = (new URL(req.url).searchParams.get('ids') || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => UUID_RE.test(s));
  const ids = [...new Set(asked)].slice(0, PROGRESS_BATCH_MAX);
  if (!ids.length) return json({ data: {} }, 200, cors);
  const studio = await isStudioSide(jwt, site, principal);
  const inIds = `in.(${ids.join(',')})`;
  const [pj, tasks, approvals, milestones] = await Promise.all([
    svc(`presence_projects?id=${inIds}&site_id=eq.${site.id}&deleted_at=is.null&select=id,client_visible`),
    svcAll(`presence_tasks?project_id=${inIds}&site_id=eq.${site.id}&deleted_at=is.null&select=id,project_id,status,client_visible,title,client_action_required,source,milestone_id,sort_order,due_date,created_at`, 'id'),
    svcAll(`presence_approvals?project_id=${inIds}&site_id=eq.${site.id}&deleted_at=is.null&select=id,project_id,status,client_visible,title,created_at`, 'id'),
    svcAll(`presence_milestones?project_id=${inIds}&site_id=eq.${site.id}&deleted_at=is.null&select=id,project_id,title,status,sort_order,created_at,client_visible`, 'id'),
  ]);
  if (!pj.ok) return json({ error: 'read_failed', message: 'The projects couldn’t be read just now.' }, 502, cors);
  const now = overdueLine(req);   // C11: "N steps overdue" and Late on the caller's day
  const out: Record<string, { progress: { total: number; done: number; pct: number }; pending_approvals: number } & BoardFacts> = {};
  for (const p of rows(pj)) {
    if (!studio && !p.client_visible) continue;
    const mine = <T extends { project_id: string }>(list: T[]) => list.filter((x) => x.project_id === p.id);
    const myTasks = forViewer(mine(tasks), studio), myApprovals = forViewer(mine(approvals), studio);
    out[p.id] = {
      progress: progressOf(myTasks),
      pending_approvals: myApprovals.filter((a: any) => a.status === 'pending').length,
      ...boardFacts({ tasks: myTasks, milestones: forViewer(mine(milestones), studio), approvals: myApprovals }, now, checklistStageOf),
    };
  }
  return json({ data: out }, 200, cors);
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
  // builder item 75: a reason given with the change (Customers' bulk "Mark as") is kept as an
  // internal note on the project: the status change itself can be the client's to see
  const reason = clean(b.reason, 300);
  if (reason) {
    const word = to === 'on_hold' ? 'Put on hold' : to === 'active' ? 'Marked active' : to === 'complete' ? 'Marked complete' : 'Archived';
    await svc('presence_project_messages', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ site_id: site.id, project_id: id, audience: 'internal', body: `${word}: ${reason}`, author: principal.email || principal.userId || 'system', author_kind: principal.kind }) }).catch(() => {});
  }
  // service edge #1: a completed project offers the client a one-question CSAT
  // (reuses the survey spine; idempotent per project; emails the bridged customer).
  if (to === 'complete') await offerCsat({ agencySiteId: site.id, projectId: id, source: 'project', sourceId: id });
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
  // ONE door for the ten standard steps. `source` is otherwise free text, so this
  // route could mint a second `checklist:<key>` row for a project — the exact
  // duplicate the auto-tick's single-row PATCH and the partial unique index both
  // depend on never existing. A standard step is added through /checklist, which
  // builds the row from lib/project_checklist.ts and skips what's already there.
  if (isChecklistSource(b.source)) {
    return json({ error: 'validation', message: 'Add a standard delivery step from the checklist picker, not as a free-text task.' }, 422, cors);
  }
  const existing = rows(await svc(`presence_tasks?project_id=eq.${projectId}&site_id=eq.${site.id}&deleted_at=is.null&select=sort_order&order=sort_order.desc&limit=1`)); // D2: only the current max, not the whole list
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
  // B1: a task newly flagged as a client action → tell the client (an activity event)
  if (task.client_action_required !== true && rows(up)[0].client_action_required === true) {
    await projectEvent(site.id, projectId, 'client_action', principal, true, { task_id: taskId, title: rows(up)[0].title });
  }
  return json({ data: rows(up)[0] }, 200, cors);
}

// ═══ THE STANDARD DELIVERY CHECKLIST (the studio's step picker) ═══════════════
// Eric asked for "a drop down for tasks that we know need to be completed that we
// add and once completed the percentage goes up". The ten steps are already the
// studio's spine (lib/project_checklist.ts) — this route is the door that puts a
// CHOSEN subset of them onto a project, producing rows identical to the ones the
// handoff seeder writes: same title, same source key, same client flags.
//
// WHY A ROUTE AND NOT `POST /tasks` WITH A TITLE. Three reasons, all of them the
// reason the checklist exists at all: the row must carry `source=checklist:<key>`
// or the auto-tick can never find it; the flags must match the step, not the
// operator's memory; and a step must never be added TWICE (the auto-tick PATCHes
// one addressable row, and presence_tasks_project_checklist_uq enforces it in the
// database once 0120/0123 is applied). So the caller sends KEYS, never a title.

/** The live (non-deleted) checklist rows a project holds. `source like 'checklist:%'`
 *  is the same predicate the partial unique index is built on — deliberately, so
 *  "what the picker refuses to offer" and "what the database refuses to store"
 *  can never disagree. A soft-deleted step is genuinely absent under both. */
async function heldChecklist(siteId: string, projectId: string) {
  const r = await svc(`presence_tasks?project_id=eq.${projectId}&site_id=eq.${siteId}&deleted_at=is.null&source=like.${encodeURIComponent('checklist:')}*&select=source,status&limit=100`);
  return rows(r);
}

export async function handleProjectChecklist(req: Request, jwt: string, site: SiteRow, principal: Principal, projectId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId)) return json({ error: 'bad_request' }, 400, cors);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  const project = await loadProject(site.id, projectId);
  if (!project) return json({ error: 'not_found', message: 'That project isn’t here.' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }

  // `all: true` = "add all the standard steps" — the affordance for a project
  // that has none (a pre-0120 handoff, showing an honest but useless 0/0). It is
  // NOT a separate code path: it just means "every key", and the same
  // already-present filter below makes it idempotent and additive.
  const asked: string[] = b.all === true
    ? DELIVERY_CHECKLIST.map((s) => s.key)
    : (Array.isArray(b.keys) ? b.keys : []).map((k: unknown) => clean(k, 60));
  if (!asked.length) return json({ error: 'validation', message: 'Pick at least one standard step to add.' }, 422, cors);
  const unknown = asked.filter((k) => !checklistStep(k));
  // no key echo in the message — the page's error filter (nice()) drops a string
  // that looks like machinery, and a step key does. The list is the contract.
  if (unknown.length) return json({ error: 'validation', message: 'That isn’t one of the standard delivery steps.', unknown }, 422, cors);

  const held = await heldChecklist(site.id, projectId);
  const present = new Set(held.map((t) => checklistKeyOf(t.source)).filter(Boolean) as string[]);
  const missing = [...new Set(asked)].filter((k) => !present.has(k));
  const skipped = [...new Set(asked)].filter((k) => present.has(k));

  let added: any[] = [];
  if (missing.length) {
    const ins = await svc('presence_tasks', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(checklistRowsFor(site.id, projectId, missing)) });
    if (!ins.ok) {
      // 409 = the partial unique index refused a duplicate, i.e. another tab (or
      // the 0120 backfill) added one of these between our read and our write. Say
      // so and hand back the TRUTH rather than pretending: one honest retry with
      // the recomputed gap, then a plain conflict the page refreshes on.
      if (ins.status === 409) {
        const held2 = await heldChecklist(site.id, projectId);
        const present2 = new Set(held2.map((t) => checklistKeyOf(t.source)).filter(Boolean) as string[]);
        const still = missing.filter((k) => !present2.has(k));
        const retry = still.length
          ? await svc('presence_tasks', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(checklistRowsFor(site.id, projectId, still)) })
          : null;
        if (retry && !retry.ok) {
          return json({ error: 'conflict', message: 'Those steps were just added somewhere else — refresh to see where the project stands.', checklist: checklistState(await heldChecklist(site.id, projectId)) }, 409, cors);
        }
        added = retry ? rows(retry) : [];
      } else {
        return json({ error: 'write_failed', message: 'Those steps didn’t save — please try again.' }, 502, cors);
      }
    } else {
      added = rows(ins);
    }
  }
  const addedKeys = added.map((t) => checklistKeyOf(t.source)).filter(Boolean) as string[];

  // EVIDENCE, NOT A FRESH ZERO. Two of the ten are facts the system already owns
  // (a signed contract, a paid deposit) and their live tick call sites fired long
  // before these rows existed. Adding the steps without reading that evidence
  // back would put Eric at "0%" on a project that is demonstrably 20% done — the
  // same lie the seeder's own reconcile exists to prevent. Same function, same
  // rule, and idempotent, so it is safe on every add. Only meaningful for a
  // project handed off from a deal; a manual project has no contract to read.
  const reconcilable = addedKeys.some((k) => { const s = checklistStep(k); return s?.auto === 'contract_signed' || s?.auto === 'deposit_paid'; });
  let reconciled = false;
  if (reconcilable && project.deal_id) { await reconcileChecklistFacts(site.id, String(project.deal_id), projectId); reconciled = true; }

  // ONE event, not ten. This is the scaffold going in (the same call
  // seedProjectChecklist and applyTemplate make), not a stream of "a task was
  // added" notifications — and it stays internal: the client's three steps show
  // up on their to-do card as tasks, which is the notification that matters.
  if (addedKeys.length) await projectEvent(site.id, projectId, 'checklist_steps_added', principal, false, { keys: addedKeys, count: addedKeys.length });

  const state = checklistState(await heldChecklist(site.id, projectId));
  return json({ data: { added: addedKeys.length, added_keys: addedKeys, skipped_keys: skipped, reconciled, checklist: state } }, addedKeys.length ? 201 : 200, cors);
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
  const existing = rows(await svc(`presence_milestones?project_id=eq.${projectId}&site_id=eq.${site.id}&deleted_at=is.null&select=sort_order&order=sort_order.desc&limit=1`)); // D2: only the current max
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
