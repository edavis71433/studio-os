// ── Saved to-do lists (sales item 106) ──
// GET    /sales/todo-templates                      the studio's lists
// POST   /sales/todo-templates {name, from_deal_id}  save a deal's to-dos as a list (edit)
// DELETE /sales/todo-templates/:id                  remove one (delete)
// POST   /sales/deals/:id/tasks/from-template {template_id}?today=YYYY-MM-DD
//        add a list's to-dos to a deal, dated from the caller's own day (edit)
// The lists are one reserved JSON row (lib/reserved_store.ts); what they make are plain
// deal to-dos in presence_deal_tasks, the same columns POST /sales/deals/:id/tasks writes.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { readReservedJsonOrThrow, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { todoListFromTasks, savedTodoLists, todosFromList, todoListSummary, MAX_TODO_LISTS } from '../lib/todo_templates.ts';
import { callerToday } from '../lib/sales_lifecycle.ts';
import { UUID_RE } from '../lib/uuid.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const clean = (s: unknown, max = 80) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const by = (p: Principal) => p.email || p.userId || 'system';
const dealHere = async (siteId: string, dealId: string) =>
  rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${siteId}&deleted_at=is.null&select=id&limit=1`))[0] || null;

export async function handleTodoTemplates(req: Request, site: SiteRow, principal: Principal, id: string | null, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'GET' && !id) {
    let lists;
    try { lists = savedTodoLists(await readReservedJsonOrThrow(site.id, RESERVED_NAMES.todoLists)); }
    catch { return json({ error: 'read_failed', message: 'Your saved to-do lists couldn’t load just now.' }, 502, cors); }
    return json({ data: lists.map(todoListSummary) }, 200, cors);
  }
  if (req.method === 'POST' && !id) {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const name = clean(b.name);
    if (!name) return json({ error: 'validation', message: 'Give the list a name.' }, 422, cors);
    const dealId = String(b.from_deal_id || '');
    if (!UUID_RE.test(dealId)) return json({ error: 'validation', message: 'Pick the deal whose to-dos to save.' }, 422, cors);
    if (!(await dealHere(site.id, dealId))) return json({ error: 'not_found', message: 'That deal isn’t here.' }, 404, cors);
    const t = await svc(`presence_deal_tasks?site_id=eq.${site.id}&deal_id=eq.${dealId}&deleted_at=is.null&select=title,due_date,created_at&order=created_at.asc&limit=200`);
    if (!t.ok) return json({ error: 'read_failed', message: 'That deal’s to-dos couldn’t be read just now.' }, 502, cors);
    const list = todoListFromTasks({ id: crypto.randomUUID(), name, now: new Date().toISOString(), tasks: rows(t) });
    if (!list.items.length) return json({ error: 'empty', message: 'This deal has no to-dos to save yet.' }, 422, cors);
    let full = false;
    const next = await updateReservedJson(site.id, RESERVED_NAMES.todoLists, (cur) => {
      const saved = savedTodoLists(cur);
      if (saved.length >= MAX_TODO_LISTS) { full = true; return saved; }
      return [...saved, list];
    }, by(principal));
    if (full) return json({ error: 'too_many', message: `You can keep up to ${MAX_TODO_LISTS} to-do lists. Remove one first.` }, 409, cors);
    if (!next) return json({ error: 'write_failed', message: 'The list didn’t save — please try again.' }, 502, cors);
    return json({ data: todoListSummary(list) }, 201, cors);
  }
  if (req.method === 'DELETE' && id) {
    let found = false;
    const next = await updateReservedJson(site.id, RESERVED_NAMES.todoLists, (cur) => {
      const saved = savedTodoLists(cur);
      found = saved.some((l) => l.id === id);
      return saved.filter((l) => l.id !== id);
    }, by(principal));
    if (!found) return json({ error: 'not_found', message: 'That list isn’t here.' }, 404, cors);
    if (!next) return json({ error: 'write_failed', message: 'The list wasn’t removed — please try again.' }, 502, cors);
    return json({ data: { ok: true, id } }, 200, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

export async function handleDealTasksFromTemplate(req: Request, site: SiteRow, _principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const listId = String(b.template_id || '');
  if (!UUID_RE.test(listId)) return json({ error: 'validation', message: 'Pick a saved list.' }, 422, cors);
  if (!(await dealHere(site.id, dealId))) return json({ error: 'not_found', message: 'That deal isn’t here.' }, 404, cors);
  let lists;
  try { lists = savedTodoLists(await readReservedJsonOrThrow(site.id, RESERVED_NAMES.todoLists)); }
  catch { return json({ error: 'read_failed', message: 'Your saved to-do lists couldn’t load just now.' }, 502, cors); }
  const list = lists.find((l) => l.id === listId);
  if (!list) return json({ error: 'not_found', message: 'That list isn’t here any more.' }, 404, cors);
  const today = callerToday(new URL(req.url).searchParams.get('today'), new Date().toISOString());
  const todos = todosFromList(list, today);
  // one insert for the whole list: it lands together or not at all
  const ins = await svc('presence_deal_tasks', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify(todos.map((t) => ({ site_id: site.id, deal_id: dealId, title: t.title, due_date: t.due_date, status: 'open' }))) });
  if (!ins.ok || !rows(ins).length) return json({ error: 'write_failed', message: 'The to-dos weren’t added — please try again.' }, 502, cors);
  return json({ data: { added: rows(ins).length, list: list.name } }, 201, cors);
}
