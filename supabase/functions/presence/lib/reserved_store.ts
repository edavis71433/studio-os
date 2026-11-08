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
  calendarFeed: '__calendar_feed__',      // sales review item 46: the private calendar link
} as const;

const rowsOf = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
// Final pass (Nov 8, F2 + F9): one row per site and name — migration 0138 makes
// the database refuse a second — and the newest row wins wherever two exist
// (before the migration lands, or for a moment during a race).
const live = (siteId: string, name: string) => `presence_sales_templates?site_id=eq.${siteId}&kind=eq.proposal&name=eq.${encodeURIComponent(name)}&deleted_at=is.null`;
const path = (siteId: string, name: string, sel: string) => `${live(siteId, name)}&select=${sel}&order=updated_at.desc&limit=1`;
const parse = (body: unknown): unknown => { try { return body ? JSON.parse(String(body)) : null; } catch { return null; } };

/** The stored JSON, or null when there is none or it can't be read. */
export async function readReservedJson(siteId: string, name: string): Promise<unknown> {
  try {
    const r = await svc(path(siteId, name, 'body'));
    if (!r.ok) return null;
    const row = rowsOf(r)[0];
    return row ? parse(row.body) : null;
  } catch { return null; }
}

/** Store `value` as the whole setting. Every live row of the name gets it, so a
 *  stray duplicate can never keep an old value (a calendar link "turned off" in
 *  one row stayed on in the other). Creates the row when there is none; a
 *  second writer racing to create it gets the database's unique refusal and
 *  writes over the winner instead. False on any failure. */
export async function writeReservedJson(siteId: string, name: string, value: unknown, createdBy: string): Promise<boolean> {
  try {
    const body = JSON.stringify(value);
    const patch = () => svc(`${live(siteId, name)}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ body, updated_at: new Date().toISOString() }) });
    const p1 = await patch();
    if (p1.ok && rowsOf(p1).length) return true;
    const ins = await svc('presence_sales_templates', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: siteId, kind: 'proposal', name, title: '', body, created_by: createdBy }) });
    if (ins.ok && rowsOf(ins).length) return true;
    if (ins.status === 409) { const p2 = await patch(); return p2.ok && rowsOf(p2).length > 0; }   // lost the race to create it
    return false;
  } catch { return false; }
}

/** Change PART of a setting (one list's saved views, one picked list) without
 *  losing a change someone else saved a moment earlier (F9: read, change, write
 *  used to drop the other person's save). The write only lands if the row is
 *  still the version that was read; otherwise it reads again and re-applies the
 *  change. `change` gets the current value (null when there is none) and
 *  returns the new one. Returns the stored value, or null when it couldn't. */
export async function updateReservedJson<T>(siteId: string, name: string, change: (current: unknown) => T, createdBy: string, tries = 5): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const cur = rowsOf(await svc(path(siteId, name, 'id,body,updated_at')))[0];
      const next = change(cur ? parse(cur.body) : null);
      const body = JSON.stringify(next);
      if (cur) {
        const w = await svc(`presence_sales_templates?id=eq.${cur.id}&site_id=eq.${siteId}&updated_at=eq.${encodeURIComponent(String(cur.updated_at))}&select=id`, {
          method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ body, updated_at: new Date().toISOString() }),
        });
        if (w.ok && rowsOf(w).length) return next;
        if (!w.ok) return null;
        continue;   // someone saved in between — read their version and apply ours to it
      }
      const ins = await svc('presence_sales_templates', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: siteId, kind: 'proposal', name, title: '', body, created_by: createdBy }) });
      if (ins.ok && rowsOf(ins).length) return next;
      if (ins.status !== 409) return null;   // a racing first save made the row — go round and apply ours to it
    } catch { return null; }
  }
  return null;
}
