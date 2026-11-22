// ── The studio's own clock, for money (sales item 152, Nov 22 2026 review) ─────
// Money ran on three clocks: the invoice reminder sweep took "today" from the
// server's UTC day (so "Due today" went out at about 4 pm the day before in
// Burbank), revenue by month cut months on the UTC day, and the Invoices page used
// the studio's own day. One rule now: the studio's own day, read from its location
// (presence_locations.timezone), Pacific when it has none, the same default the
// recurring invoices already used. Reads are best-effort: a failed read is the
// default zone, never a missing number.
import { svc } from './db.ts';
import { localClock, RECURRING_DEFAULT_TZ, RECURRING_SEND_HOUR } from './recurring_invoices.ts';

export { localClock, RECURRING_DEFAULT_TZ as STUDIO_DEFAULT_TZ, RECURRING_SEND_HOUR as STUDIO_MORNING_HOUR };

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];

/** One site's time zone ('' when it has none: localClock then uses the default). */
export async function studioZone(siteId: string): Promise<string> {
  try { return String(rows(await svc(`presence_locations?site_id=eq.${siteId}&select=timezone&limit=1`))[0]?.timezone || ''); } catch { return ''; }
}
/** Several sites' zones in one read: site id → zone ('' for none). */
export async function studioZones(siteIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(siteIds.filter(Boolean))];
  if (!ids.length) return out;
  try { for (const r of rows(await svc(`presence_locations?site_id=in.(${ids.join(',')})&select=site_id,timezone`))) out.set(String(r.site_id), String(r.timezone || '')); } catch { /* the default zone */ }
  return out;
}

/** "2026-11" for a moment, on the studio's day in `tz`. A missing or bad zone means the
 *  default; `null` means UTC (the pure reports keep UTC unless told a zone). Pure. */
export function monthIn(iso: unknown, tz: string | null | undefined): string {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '';
  if (tz === null) return new Date(t).toISOString().slice(0, 7);
  return localClock(tz || undefined, t).ymd.slice(0, 7);
}
/** Is it the studio's morning yet (9 or later, its time)? Reminders go out then, not at
 *  the first tick after midnight. Pure. */
export function morningYet(local: { hour: number }): boolean { return local.hour >= RECURRING_SEND_HOUR; }
