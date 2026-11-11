// ── The trash, emptied (builder list item 154, Nov 2026 review) ──────────────
// Once a site has been in a studio's Trash for 90 days (lib/site_trash.ts), the
// daily hygiene sweep deletes it for good, one site at a time, each step safe to
// repeat:
//   1. its website comes down: the hosting is removed (a failure stops here and the
//      next run tries again, so a "deleted" site can never stay up), and the site row
//      is marked 'deleting' with no host and no domain, as an account deletion does;
//   2. a site whose owner was never invited (no email, no sign-in: "+ New site") has
//      no one else to keep it, so its account follows the account-deletion path
//      (commerce/deletion.ts: billing stopped, records anonymised, the money and audit
//      records kept);
//   3. it leaves the studio for good (the portfolio row is removed).
// An owner who signs in keeps their sign-in, files and invoices; only the website
// goes. Nothing here runs for a site that was restored: the claim below only takes a
// row that is still in the trash and past its 90 days.
import { svc } from '../lib/db.ts';
import { deleteSite, netlifyConfigured } from '../lib/netlify.ts';
import { requestDeletion } from '../commerce/deletion.ts';
import { TRASH_DAYS } from '../lib/site_trash.ts';

const rowsOf = <T,>(r: { ok?: boolean; json?: unknown }): T[] => (r.ok !== false && Array.isArray(r.json) ? r.json as T[] : []);

/** Delete for good up to `limit` sites that have been in a trash for 90 days. */
export async function runSiteTrashPurge(limit = 10): Promise<{ due: number; deleted: number; failed: number; unavailable?: boolean }> {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86_400_000).toISOString();
  const q = await svc(`presence_agency_clients?status=eq.trashed&trashed_at=lte.${encodeURIComponent(cutoff)}&select=site_id,agency_id,trashed_at&order=trashed_at.asc&limit=${Math.max(1, Math.min(50, limit))}`);
  if (!q.ok) return { due: 0, deleted: 0, failed: 0, unavailable: true };   // before migration 0154: no trash yet
  const due = rowsOf<{ site_id: string; agency_id: string; trashed_at: string }>(q);
  let deleted = 0, failed = 0;
  for (const d of due) {
    try {
      const site = rowsOf<{ id: string; client_id: string | null; netlify_site_id: string | null; status: string }>(await svc(`presence_sites?id=eq.${d.site_id}&select=id,client_id,netlify_site_id,status&limit=1`))[0];
      // 1. the website comes down: hosting first, and only then the pointer to it
      if (site?.netlify_site_id) {
        if (!netlifyConfigured()) { failed++; continue; }
        const del = await deleteSite(site.netlify_site_id).catch(() => ({ ok: false }));
        if (!(del as { ok?: boolean }).ok) { failed++; continue; }
      }
      if (site) await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'deleting', netlify_site_id: null, custom_domain: null }) });
      // 2. an owner who was never invited leaves nobody to keep the account
      if (site?.client_id) {
        const c = rowsOf<{ email?: string | null; contact_email?: string | null; contact_id?: string | null }>(await svc(`clients?id=eq.${site.client_id}&select=email,contact_email,contact_id&limit=1`))[0];
        const hasOwner = !!c && !!(String(c.email || '').trim() || String(c.contact_email || '').trim() || c.contact_id);
        if (c && !hasOwner) await requestDeletion(site.client_id, site.id, 'site trash (90 days)');
      }
      // 3. out of the studio for good — only the row that is still in the trash
      const gone = await svc(`presence_agency_clients?site_id=eq.${d.site_id}&agency_id=eq.${d.agency_id}&status=eq.trashed`, { method: 'DELETE' });
      if (!gone.ok) { failed++; continue; }
      console.log(JSON.stringify({ evt: 'site_trash_deleted', site_id: d.site_id, agency_id: d.agency_id, trashed_at: d.trashed_at }));
      deleted++;
    } catch (e) {
      failed++;
      console.error('site trash purge failed:', d.site_id, (e as Error)?.message);
    }
  }
  return { due: due.length, deleted, failed };
}
