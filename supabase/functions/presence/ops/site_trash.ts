// ── The trash, emptied (builder list item 154, Nov 2026 review) ──────────────
// Once a site has been in a studio's Trash for 90 days (lib/site_trash.ts), the
// daily hygiene sweep lets it go, one site at a time, each step safe to repeat.
// Item 204 (Nov 12 review, finding 94): what happens depends on whose it is.
//   · A site with no owner (made with "+ New site" and never invited: no email, no
//     sign-in) has no one else to keep it, so it is deleted for good: its website comes
//     down (the hosting is removed; a failure stops here and the next run tries again, so
//     a "deleted" site can never stay up), the site row is marked 'deleting' with no host
//     and no domain, and its account follows the account-deletion path
//     (commerce/deletion.ts: billing stopped, records anonymised, the money kept).
//   · A site with an owner is theirs: nothing on it is deleted. The studio lets go of it,
//     and the owner is emailed that their website, sign-in and files are still theirs.
// Either way it then leaves the studio for good (the portfolio row is removed). When it
// can't be told whose a site is, nothing happens to it and the next run asks again.
// Nothing here runs for a site that was restored: the claim below only takes a row
// that is still in the trash and past its 90 days.
import { svc } from '../lib/db.ts';
import { deleteSite, netlifyConfigured } from '../lib/netlify.ts';
import { requestDeletion } from '../commerce/deletion.ts';
import { TRASH_DAYS, letGoEmail } from '../lib/site_trash.ts';
import { sendEmail } from '../commerce/account.ts';
import { loadEmailBrand } from '../lib/email_brand.ts';
import { ownerFacts, ownerEmailsOf } from '../lib/site_transfer.ts';

const rowsOf = <T,>(r: { ok?: boolean; json?: unknown }): T[] => (r.ok !== false && Array.isArray(r.json) ? r.json as T[] : []);
const hasOwner = (c: { email?: string | null; contact_email?: string | null; contact_id?: string | null } | undefined) => !!c && !!(String(c.email || '').trim() || String(c.contact_email || '').trim() || c.contact_id);

/** Let go of up to `limit` sites that have been in a trash for 90 days: delete the ones
 *  nobody owns, hand back the ones somebody does. */
export async function runSiteTrashPurge(limit = 10): Promise<{ due: number; deleted: number; kept: number; failed: number; unavailable?: boolean }> {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86_400_000).toISOString();
  const q = await svc(`presence_agency_clients?status=eq.trashed&trashed_at=lte.${encodeURIComponent(cutoff)}&select=site_id,agency_id,trashed_at,trashed_was_live&order=trashed_at.asc&limit=${Math.max(1, Math.min(50, limit))}`);
  if (!q.ok) return { due: 0, deleted: 0, kept: 0, failed: 0, unavailable: true };   // before migration 0154: no trash yet
  const due = rowsOf<{ site_id: string; agency_id: string; trashed_at: string; trashed_was_live?: boolean | null }>(q);
  let deleted = 0, kept = 0, failed = 0;
  for (const d of due) {
    try {
      const sr = await svc(`presence_sites?id=eq.${d.site_id}&select=id,client_id,netlify_site_id,status&limit=1`);
      if (!sr.ok) { failed++; continue; }
      const site = rowsOf<{ id: string; client_id: string | null; netlify_site_id: string | null; status: string }>(sr)[0];
      // whose is it? A read that fails leaves the site exactly as it is until the next run
      let client: { name?: string | null; email?: string | null; contact_email?: string | null; contact_id?: string | null } | undefined;
      if (site?.client_id) {
        const cr = await svc(`clients?id=eq.${site.client_id}&select=name,email,contact_email,contact_id&limit=1`);
        if (!cr.ok) { failed++; continue; }
        client = rowsOf<NonNullable<typeof client>>(cr)[0];
      }
      const owned = hasOwner(client);
      if (site && !owned) {
        // 1. nobody's site: the website comes down, hosting first, and only then the pointer to it
        if (site.netlify_site_id) {
          if (!netlifyConfigured()) { failed++; continue; }
          const del = await deleteSite(site.netlify_site_id).catch(() => ({ ok: false }));
          if (!(del as { ok?: boolean }).ok) { failed++; continue; }
        }
        await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'deleting', netlify_site_id: null, custom_domain: null }) });
        // 2. an owner who was never invited leaves nobody to keep the account
        if (site.client_id && client) await requestDeletion(site.client_id, site.id, 'site trash (90 days)');
      }
      // 3. out of the studio for good — only the row that is still in the trash
      const gone = await svc(`presence_agency_clients?site_id=eq.${d.site_id}&agency_id=eq.${d.agency_id}&status=eq.trashed`, { method: 'DELETE' });
      if (!gone.ok) { failed++; continue; }
      if (site && owned) {
        // 4. somebody's site: it stays theirs, and they hear the studio let go (once: the row above is gone)
        kept++;
        await tellOwnerLetGo(site.id, d).catch(() => false);
        console.log(JSON.stringify({ evt: 'site_trash_let_go', site_id: d.site_id, agency_id: d.agency_id, trashed_at: d.trashed_at }));
      } else {
        deleted++;
        console.log(JSON.stringify({ evt: 'site_trash_deleted', site_id: d.site_id, agency_id: d.agency_id, trashed_at: d.trashed_at }));
      }
    } catch (e) {
      failed++;
      console.error('site trash purge failed:', d.site_id, (e as Error)?.message);
    }
  }
  return { due: due.length, deleted, kept, failed };
}

/** Item 204: the owner's "no longer looks after" email, on the site's own brand. A reply
 *  reaches the platform, which can put the site back online or help move it. */
async function tellOwnerLetGo(siteId: string, d: { agency_id: string; trashed_at: string; trashed_was_live?: boolean | null }): Promise<boolean> {
  const facts = await ownerFacts(siteId);
  const to = ownerEmailsOf(facts)[0];
  if (!to) return false;
  const [ag, brand] = await Promise.all([svc(`presence_agencies?id=eq.${d.agency_id}&select=name&limit=1`).catch(() => null), loadEmailBrand(siteId)]);
  const studio = String((ag && rowsOf<{ name?: string }>(ag)[0]?.name) || 'Your studio').trim();
  const mail = letGoEmail({ studio, site: String(facts?.client?.name || '').trim() || 'your website', wasLive: d.trashed_was_live === true, since: d.trashed_at });
  // to the owner, about their own website: it always arrives (critical)
  return await sendEmail(to, mail.subject, mail.html, brand, { critical: true });
}
