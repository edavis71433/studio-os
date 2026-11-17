// ── Deleted customers, let go after 30 days (builder list item 241) ─────────────────
// A customer a studio deleted can be restored from Recently deleted for 30 days
// (routes/customers.ts). After that the daily hygiene sweep closes the record, one
// at a time and safe to repeat:
//   · the row is claimed first (closed_at), so a Restore pressed at the same moment
//     can't half-run against it;
//   · a bare customer record goes for good: one nobody can sign in to, with no
//     website or workspace, no link to any studio and no invoice ever made out to
//     it (money records are never deleted). Anything else stays: their own sign-in,
//     a website kept on Sites, or one still in the Trash (which keeps its own 90 days).
// Their project and contact stay deleted, as every soft delete here does.
import { svc } from '../lib/db.ts';
import { CUSTOMER_KEEP_DAYS } from '../routes/customers.ts';

const rows = (r: { ok?: boolean; json?: unknown } | null | undefined): any[] => (r && r.ok !== false && Array.isArray(r.json) ? r.json as any[] : []);

/** Pure: may a customer record be removed for good? Only a bare one. */
export function bareCustomer(f: { client: { email?: string | null; contact_email?: string | null; contact_id?: string | null } | null; sites: number; links: number; invoices: number }): boolean {
  if (!f.client) return false;
  const owned = !!(String(f.client.email || '').trim() || String(f.client.contact_email || '').trim() || f.client.contact_id);
  return !owned && f.sites === 0 && f.links === 0 && f.invoices === 0;
}

/** Let go of up to `limit` deleted customers older than 30 days. Counts only: never a bare
 *  false (the tick's report reads every field as a number). */
export async function runCustomerTrashSweep(limit = 20): Promise<{ due: number; closed: number; removed: number; failed: number; unavailable: number }> {
  const cutoff = new Date(Date.now() - CUSTOMER_KEEP_DAYS * 86_400_000).toISOString();
  const q = await svc(`presence_deleted_customers?restored_at=is.null&closed_at=is.null&deleted_at=lte.${encodeURIComponent(cutoff)}&select=id,client_id&order=deleted_at.asc&limit=${Math.max(1, Math.min(50, limit))}`).catch(() => null);
  if (!q || !q.ok) return { due: 0, closed: 0, removed: 0, failed: 0, unavailable: 1 };   // before migration 0245
  const due = rows(q);
  let closed = 0, removed = 0, failed = 0;
  for (const d of due) {
    try {
      const claim = await svc(`presence_deleted_customers?id=eq.${d.id}&restored_at=is.null&closed_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ closed_at: new Date().toISOString() }) });
      if (!claim.ok) { failed++; continue; }
      if (!rows(claim).length) continue;   // restored or closed meanwhile
      closed++;
      const id = String(d.client_id);
      const [c, s, l, i] = await Promise.all([
        svc(`clients?id=eq.${id}&select=email,contact_email,contact_id&limit=1`),
        svc(`presence_sites?client_id=eq.${id}&select=id&limit=1`),
        svc(`presence_service_links?customer_client_id=eq.${id}&status=eq.active&select=id&limit=1`),
        svc(`presence_invoices?customer_client_id=eq.${id}&select=id&limit=1`),
      ]);
      if (![c, s, l, i].every((r) => r.ok)) continue;   // a read that failed keeps the record: nothing is guessed
      if (!bareCustomer({ client: rows(c)[0] || null, sites: rows(s).length, links: rows(l).length, invoices: rows(i).length })) continue;
      const gone = await svc(`clients?id=eq.${id}&email=is.null&contact_id=is.null`, { method: 'DELETE' });
      if (gone.ok) { removed++; console.log(JSON.stringify({ evt: 'customer_trash_removed', client_id: id })); }
      else failed++;
    } catch (e) {
      failed++;
      console.error('customer trash sweep failed:', d.id, (e as Error)?.message);
    }
  }
  return { due: due.length, closed, removed, failed, unavailable: 0 };
}
