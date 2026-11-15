// ═══ TO-DOS AND LOGGED CALLS FOR ANYONE (sales items 85 and 106, Nov 2026) ═══
//   GET  /sales/tasks            the To-dos page: every open to-do and next step (Home's My tasks,
//                                all of it), and the to-dos done in the last 30 days
//   POST /sales/tasks            a to-do for a deal, a person, a customer, or nobody (your own)
//   POST /sales/people/activity  a call, email, meeting or note logged for a person or a customer
//                                with no deal, with an optional "follow up on" day that adds a to-do
// To-dos are rows of presence_deal_tasks (0108), which since APPLY-0173 needn't have a deal; the
// logs are presence_person_events (0173). A deal's own logs and to-dos keep their routes
// (/sales/deals/:id/activity and /tasks). Before APPLY-0173 the writes here say they need a quick
// database update, and the reads leave the new rows out.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { loadMyTasks } from './sales.ts';
import { customerOfThisStudio } from './crm.ts';
import { isDealActivityKind, activityNeedsBody, cleanActivityBody, normalizeOccurredAt, type DealActivityKind } from '../crm/deal_activity.ts';
import { missingInsertColumns } from '../lib/inbound_email.ts';
import { teamOf, ownerToSet, isMine } from '../lib/team_owner.ts';   // item 37: owners and Mine

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const clean = (s: unknown, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DONE_DAYS = 30;
const NEEDS_UPDATE = 'To-dos and calls for someone without a deal need a quick database update before they can be saved.';

/** Who a write is for. Each id must be this studio's: a deal or a person on its site, or a
 *  customer it serves. null (with the message) when one isn't; `none` when nothing was named. */
export async function resolveTarget(siteId: string, b: any): Promise<{ deal_id: string | null; contact_id: string | null; client_id: string | null; name: string } | { error: string }> {
  const id = (k: string) => (UUID_RE.test(String(b?.[k] || '')) ? String(b[k]) : null);
  const dealId = id('deal_id'), contactId = id('contact_id'), clientId = id('client_id');
  if (dealId) {
    const d = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${siteId}&deleted_at=is.null&select=id,title&limit=1`))[0];
    if (!d) return { error: 'That deal isn’t in this workspace.' };
    return { deal_id: dealId, contact_id: null, client_id: null, name: String(d.title || 'the deal') };
  }
  let name = '';
  if (contactId) {
    const c = rows(await svc(`presence_contacts?id=eq.${contactId}&site_id=eq.${siteId}&deleted_at=is.null&select=id,name,email&limit=1`))[0];
    if (!c) return { error: 'That person isn’t in this workspace.' };
    name = String(c.name || c.email || '');
  }
  if (clientId) {
    if (!(await customerOfThisStudio(siteId, clientId)).ok) return { error: 'That customer isn’t one of yours.' };
    if (!name) { const k = rows(await svc(`clients?id=eq.${clientId}&select=name,email&limit=1`))[0]; name = String((k && (k.name || k.email)) || ''); }
  }
  return { deal_id: null, contact_id: contactId, client_id: clientId, name };
}

/** One to-do, for whoever resolveTarget found. A missing column (before APPLY-0173) is the
 *  update message, never a to-do filed against nobody. */
export async function insertTodo(siteId: string, t: { deal_id: string | null; contact_id: string | null; client_id: string | null }, title: string, due: string | null, owner: string | null = null): Promise<{ row?: any; status?: number; message?: string }> {
  const row: Record<string, unknown> = { site_id: siteId, title, due_date: due, status: 'open', deal_id: t.deal_id };
  if (t.contact_id) row.contact_id = t.contact_id;
  if (t.client_id) row.client_id = t.client_id;
  if (owner && UUID_RE.test(owner)) row.assigned_to = owner;   // item 37: whoever adds it owns it
  let ins = await svc('presence_deal_tasks', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
  // before APPLY-0199 the to-do saves without its owner
  if (!ins.ok && 'assigned_to' in row && missingInsertColumns(ins.json, ins.text, ['assigned_to']).length) { delete row.assigned_to; ins = await svc('presence_deal_tasks', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) }); }
  if (ins.ok && rows(ins)[0]) return { row: rows(ins)[0] };
  // before APPLY-0173: no contact_id or client_id column, and deal_id may not be empty
  if (!t.deal_id && (missingInsertColumns(ins.json, ins.text, ['contact_id', 'client_id']).length || /deal_id|not-null|null value/i.test(String(ins.text || JSON.stringify(ins.json || ''))))) return { status: 409, message: NEEDS_UPDATE };
  return { status: 502, message: 'That to-do didn’t save — please try again.' };
}

export async function handleSalesTasks(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'GET') {
    // the whole open list (Home shows its first few), and what was done lately, newest first
    const since = encodeURIComponent(new Date(Date.now() - DONE_DAYS * 86_400_000).toISOString());
    const donePath = (cols: string) => `presence_deal_tasks?site_id=eq.${site.id}&status=eq.done&deleted_at=is.null&completed_at=gte.${since}&select=${cols}&order=completed_at.desc&limit=100`;
    // item 37: mine=1 is your own (a to-do or deal with no owner is the business owner's); without it, the team's
    const team = new URL(req.url).searchParams.get('mine') === '1' ? await teamOf(principal) : null;
    const [mine, doneR] = await Promise.all([
      loadMyTasks(site.id, principal.userId || null, team),
      // each done one's owner (0199) rides along, then the reads from before it
      svc(donePath('id,deal_id,contact_id,client_id,title,due_date,completed_at,assigned_to')).then((r) => r.ok ? r : svc(donePath('id,deal_id,contact_id,client_id,title,due_date,completed_at')))
        .then((r) => r.ok ? r : svc(donePath('id,deal_id,title,due_date,completed_at'))).catch(() => null),
    ]);
    const done = (doneR && doneR.ok ? rows(doneR) : []).filter((t: any) => !team || team.ids.length < 2 || isMine(team, t.assigned_to));
    // what each done one was for, the way the open list says it
    const ids = (k: string) => [...new Set(done.map((t: any) => String(t[k] || '')).filter((x: string) => UUID_RE.test(x)))].slice(0, 100);
    const [deals, people, customers] = await Promise.all([
      ids('deal_id').length ? svc(`presence_deals?id=in.(${ids('deal_id').join(',')})&site_id=eq.${site.id}&select=id,title`).then(rows).catch(() => []) : Promise.resolve([]),
      ids('contact_id').length ? svc(`presence_contacts?id=in.(${ids('contact_id').join(',')})&site_id=eq.${site.id}&select=id,name,email`).then(rows).catch(() => []) : Promise.resolve([]),
      ids('client_id').length ? svc(`clients?id=in.(${ids('client_id').join(',')})&select=id,name,email`).then(rows).catch(() => []) : Promise.resolve([]),
    ]);
    const nameOf = (list: any[], id: unknown, k = 'name') => { const x = list.find((r: any) => String(r.id) === String(id)); return x ? String(x[k] || x.email || '') : ''; };
    const doneItems = done.map((t: any) => {
      const ctx = t.deal_id ? (nameOf(deals, t.deal_id, 'title') || 'A deal') : t.contact_id ? (nameOf(people, t.contact_id) || 'A contact') : t.client_id ? (nameOf(customers, t.client_id) || 'A customer') : 'Your own to-do';
      const href = t.deal_id ? `/pipeline.html?deal=${t.deal_id}` : t.contact_id ? `/crm.html?contact=${t.contact_id}` : t.client_id ? `/crm.html?client_id=${t.client_id}` : '/todos.html';
      return { id: t.id, title: String(t.title || 'To-do'), context: ctx, href, completed_at: t.completed_at, due: t.due_date || null, for: t.deal_id ? 'deal' : t.contact_id ? 'person' : t.client_id ? 'customer' : 'me', owner: t.assigned_to ? String(t.assigned_to) : null };
    });
    return json({ data: { items: mine.all, total: mine.all.length, done: doneItems, done_days: DONE_DAYS, partial: mine.partial || !(doneR && doneR.ok) } }, 200, cors);
  }
  if (req.method === 'POST') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const title = clean(b.title, 200);
    if (!title) return json({ error: 'validation', message: 'Give the to-do a title.' }, 422, cors);
    const due = typeof b.due_date === 'string' && DAY_RE.test(b.due_date) ? b.due_date : null;
    const t = await resolveTarget(site.id, b);
    if ('error' in t) return json({ error: 'bad_target', message: t.error }, 422, cors);
    // item 37: whoever adds a to-do owns it, unless it names someone on the team
    let owner: string | null = principal.userId || null;
    if (b.assigned_to !== undefined) { const o = ownerToSet(await teamOf(principal), b.assigned_to); if (!o.ok) return json({ error: 'validation', message: 'That person isn’t on your team.' }, 422, cors); owner = o.value || principal.userId || null; }
    const out = await insertTodo(site.id, t, title, due, owner);
    if (!out.row) return json({ error: out.status === 409 ? 'needs_update' : 'write_failed', message: out.message }, out.status || 502, cors);
    return json({ data: { ...out.row, for: t.deal_id ? 'deal' : t.contact_id ? 'person' : t.client_id ? 'customer' : 'me', context: t.name || 'Your own to-do' } }, 201, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

export async function handlePeopleActivity(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const kind = b.kind as DealActivityKind;
  if (!isDealActivityKind(kind)) return json({ error: 'validation', message: 'Pick a call, email, meeting, or note.' }, 422, cors);
  const body = cleanActivityBody(b.body);
  if (activityNeedsBody(kind) && !body) return json({ error: 'validation', message: 'Write a short note.' }, 422, cors);
  const t = await resolveTarget(site.id, { contact_id: b.contact_id, client_id: b.client_id });   // a deal's own logs go to its deal
  if ('error' in t) return json({ error: 'bad_target', message: t.error }, 422, cors);
  if (!t.contact_id && !t.client_id) return json({ error: 'validation', message: 'Whose call was it? Open their record and log it there.' }, 422, cors);
  const occurredAt = normalizeOccurredAt(b.occurred_at, new Date().toISOString());
  const ins = await svc('presence_person_events', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    site_id: site.id, contact_id: t.contact_id, client_id: t.client_id, kind, body, occurred_at: occurredAt, via: '',
    actor: principal.email || principal.userId || 'system', actor_kind: principal.kind,
  }) });
  if (!ins.ok || !rows(ins)[0]) {
    const missing = ins.status === 404 || /presence_person_events|relation .* does not exist|PGRST205/i.test(String(ins.text || JSON.stringify(ins.json || '')));
    return json({ error: missing ? 'needs_update' : 'write_failed', message: missing ? NEEDS_UPDATE : 'That didn’t save — please try again.' }, missing ? 409 : 502, cors);
  }
  // "Follow up on [day]" in the same step: a to-do for the same person, due that day
  let followUp: any = null;
  const fu = typeof b.follow_up === 'string' && DAY_RE.test(b.follow_up) ? b.follow_up : '';
  if (fu) {
    const out = await insertTodo(site.id, t, clean(b.follow_up_title, 200) || (t.name ? `Follow up with ${t.name}` : 'Follow up'), fu, principal.userId || null);
    followUp = out.row || { error: out.message };
  }
  return json({ data: { item: rows(ins)[0], last_contacted_at: occurredAt, ...(followUp ? { follow_up: followUp } : {}) } }, 201, cors);
}
