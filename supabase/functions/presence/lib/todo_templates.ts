// ── Saved to-do lists (sales item 106, the to-do half of its pipeline template) ──
// A deal's to-dos saved as a named list, then added to another deal in one go, each
// due as many days after it is added as it was in the deal it came from. The lists
// live in one reserved JSON row per studio (lib/reserved_store.ts), so no new table.
// What they make are ordinary deal to-dos (presence_deal_tasks), the model the
// "email, restore, to-dos and views" work owns: the same columns its POST /sales/tasks
// writes, so a list keeps working before and after its 0173. Pure.

export const MAX_TODO_LISTS = 20;
export const MAX_TODO_LIST_ITEMS = 25;
export interface TodoListItem { title: string; days: number | null }
export interface TodoList { id: string; name: string; items: TodoListItem[]; created_at: string }

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayNumber = (ymd: string) => Math.floor(Date.parse(ymd + 'T00:00:00Z') / 86_400_000);
const cleanTitle = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
const cleanDays = (v: unknown): number | null => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 365 ? v as number : null);

/** A deal's to-dos as a list, in the order they were added: each title, and how many
 *  days after it was added it was due (none when it had no date). Removed ones and
 *  blank titles are left out. Pure. */
export function todoListFromTasks(o: { id: string; name: string; now: string; tasks: Array<{ title?: unknown; due_date?: unknown; created_at?: unknown; deleted_at?: unknown }> }): TodoList {
  const items: TodoListItem[] = [];
  const tasks = [...o.tasks].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  for (const t of tasks) {
    if (t.deleted_at) continue;
    const title = cleanTitle(t.title);
    if (!title) continue;
    const due = String(t.due_date ?? ''), made = String(t.created_at ?? '').slice(0, 10);
    const days = YMD.test(due) && YMD.test(made) ? Math.max(0, Math.min(365, dayNumber(due) - dayNumber(made))) : null;
    items.push({ title, days });
    if (items.length >= MAX_TODO_LIST_ITEMS) break;
  }
  return { id: o.id, name: o.name, items, created_at: o.now };
}

/** The saved lists, whatever the stored row holds: anything malformed is dropped. Pure. */
export function savedTodoLists(raw: unknown): TodoList[] {
  if (!Array.isArray(raw)) return [];
  const out: TodoList[] = [];
  for (const l of raw) {
    if (!l || typeof l !== 'object') continue;
    const r = l as Record<string, unknown>;
    const name = cleanTitle(r.name).slice(0, 80);
    if (!UUID.test(String(r.id || '')) || !name || !Array.isArray(r.items)) continue;
    const items = (r.items as unknown[]).map((i) => (i && typeof i === 'object' ? { title: cleanTitle((i as Record<string, unknown>).title), days: cleanDays((i as Record<string, unknown>).days) } : null))
      .filter((i): i is TodoListItem => !!i && !!i.title).slice(0, MAX_TODO_LIST_ITEMS);
    if (!items.length) continue;
    out.push({ id: String(r.id), name, items, created_at: String(r.created_at || '') });
    if (out.length >= MAX_TODO_LISTS) break;
  }
  return out;
}

/** The to-dos a list makes when it is added on `todayYmd` (the caller's own day). Pure. */
export function todosFromList(list: TodoList, todayYmd: string): Array<{ title: string; due_date: string | null }> {
  const base = YMD.test(todayYmd) ? dayNumber(todayYmd) : null;
  return list.items.map((i) => ({
    title: i.title,
    due_date: i.days === null || base === null ? null : new Date((base + i.days) * 86_400_000).toISOString().slice(0, 10),
  }));
}

/** What the page lists: the name, how many to-dos, and each with when it's due. Pure. */
export function todoListSummary(list: TodoList): { id: string; name: string; count: number; items: TodoListItem[]; created_at: string } {
  return { id: list.id, name: list.name, count: list.items.length, items: list.items, created_at: list.created_at };
}
