// ── Reserved JSON rows (no migration) ────────────────────────────────────────
// Small studio-level settings kept as ONE reserved presence_sales_templates row
// each (kind=proposal, a reserved name, the JSON in `body`): the same site-scoped,
// deny-all, function-mediated store the services catalog and contact fields use.
// The templates list leaves every reserved name out (routes/sales.ts).
import { svc } from './db.ts';

export const RESERVED_NAMES = {
  savedViews: '__saved_views__',          // sales review item 31
  broadcastLists: '__broadcast_lists__',  // sales review items 31 + 39
  stageNames: '__stage_names__',          // sales review item 38
} as const;

const rowsOf = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const path = (siteId: string, name: string, sel: string) => `presence_sales_templates?site_id=eq.${siteId}&kind=eq.proposal&name=eq.${encodeURIComponent(name)}&deleted_at=is.null&select=${sel}&limit=1`;

/** The stored JSON, or null when there is none or it can't be read. */
export async function readReservedJson(siteId: string, name: string): Promise<unknown> {
  try {
    const r = await svc(path(siteId, name, 'body'));
    if (!r.ok) return null;
    const row = rowsOf(r)[0];
    return row && row.body ? JSON.parse(String(row.body)) : null;
  } catch { return null; }
}

/** Find-or-create the one row and store `value`. False on any failure. */
export async function writeReservedJson(siteId: string, name: string, value: unknown, createdBy: string): Promise<boolean> {
  try {
    const body = JSON.stringify(value);
    const ex = rowsOf(await svc(path(siteId, name, 'id')))[0];
    const r = ex
      ? await svc(`presence_sales_templates?id=eq.${ex.id}&site_id=eq.${siteId}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ body, updated_at: new Date().toISOString() }) })
      : await svc('presence_sales_templates', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: siteId, kind: 'proposal', name, title: '', body, created_by: createdBy }) });
    return r.ok && rowsOf(r).length > 0;
  } catch { return false; }
}
