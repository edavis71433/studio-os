// ── A studio asks; the owner says yes (final pass, Nov 8 2026: S1) ──────────
// Connecting a studio to an account that already existed used to happen the
// moment the studio typed an email: its agency took over that site's portfolio
// row (the studio could then open and publish the site), even when another
// studio already managed it. The same was true of "set them up now" and a deal
// convert whose email had an account, and of POST /agency/clients with a bare
// site id. The rule now: a studio only gets a site it created, one whose owner
// is already its customer, or one whose owner accepted its request.
//
//   isCustomerOfStudio   — is this account already this studio's customer?
//   claimPortfolioSite   — add a site to an agency's portfolio, never taking it
//                          from another agency (insert-only, then verify)
//   requestConnection    — a studio's pending request to the person at an email
//   pendingRequestsFor   — the requests waiting on one owner's emails
import { svc } from './db.ts';
import { pgrstQuoted, validEmail } from '../commerce/account.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];

/** True when this account is already this studio's customer: the one primary
 *  studio on record for them (presence_customer_agency) is this site, or —
 *  for a customer bridged before that table — an active link from this site. */
export async function isCustomerOfStudio(studioSiteId: string, clientId: string): Promise<boolean> {
  if (!UUID_RE.test(String(studioSiteId)) || !UUID_RE.test(String(clientId))) return false;
  const primary = rows(await svc(`presence_customer_agency?customer_client_id=eq.${clientId}&select=agency_site_id&limit=1`))[0];
  if (primary) return String(primary.agency_site_id) === String(studioSiteId);
  return rows(await svc(`presence_service_links?agency_site_id=eq.${studioSiteId}&customer_client_id=eq.${clientId}&status=eq.active&select=project_id&limit=1`)).length > 0;
}

export type PortfolioClaim = 'linked' | 'already' | 'owned_elsewhere' | 'failed';

/** Put a site in an agency's portfolio. Insert-only: a site another agency
 *  already manages is never taken (the old merge-duplicates upsert overwrote
 *  agency_id on the site_id primary key). `reactivate` brings back this
 *  agency's own archived row. */
export async function claimPortfolioSite(agencyId: string, siteId: string, ownerEmail: string, opts: { reactivate?: boolean; tags?: string[] } = {}): Promise<PortfolioClaim> {
  if (!UUID_RE.test(String(agencyId)) || !UUID_RE.test(String(siteId))) return 'failed';
  try {
    const body: Record<string, unknown> = { site_id: siteId, agency_id: agencyId, status: 'active', owner_email: String(ownerEmail || '').toLowerCase().slice(0, 200) };
    if (opts.tags) body.tags = opts.tags;
    const ins = await svc('presence_agency_clients?on_conflict=site_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(body) });
    if (ins.ok && rows(ins).length) return 'linked';
    const have = rows(await svc(`presence_agency_clients?site_id=eq.${siteId}&select=agency_id,status&limit=1`))[0];
    if (!have) return 'failed';
    if (String(have.agency_id) !== String(agencyId)) return 'owned_elsewhere';
    if (have.status !== 'active' && opts.reactivate) {
      await svc(`presence_agency_clients?site_id=eq.${siteId}&agency_id=eq.${agencyId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }).catch(() => {});
    }
    return 'already';
  } catch { return 'failed'; }
}

/** Undo a claim this request made (a later step refused). Only this agency's row. */
export async function releasePortfolioSite(agencyId: string, siteId: string): Promise<void> {
  if (!UUID_RE.test(String(agencyId)) || !UUID_RE.test(String(siteId))) return;
  await svc(`presence_agency_clients?site_id=eq.${siteId}&agency_id=eq.${agencyId}`, { method: 'DELETE' }).catch(() => {});
}

/** Record (or renew) a studio's request to the person at this email. False
 *  when it couldn't be saved — e.g. before migration 0138 is applied. */
export async function requestConnection(o: { studioSiteId: string; agencyId: string | null; email: string; name: string; requestedBy: string }): Promise<boolean> {
  const email = String(o.email || '').trim().toLowerCase();
  if (!UUID_RE.test(String(o.studioSiteId)) || !validEmail(email)) return false;
  try {
    const r = await svc('presence_connect_requests?on_conflict=studio_site_id,email', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        studio_site_id: o.studioSiteId, agency_id: o.agencyId && UUID_RE.test(o.agencyId) ? o.agencyId : null,
        email, name: String(o.name || '').slice(0, 120), requested_by: String(o.requestedBy || '').slice(0, 200),
        status: 'pending', decided_at: null, updated_at: new Date().toISOString(),
      }),
    });
    return r.ok;
  } catch { return false; }
}

export interface PendingRequest { id: string; studio_site_id: string; agency_id: string | null; email: string; name: string }

/** The pending requests addressed to any of these emails, newest first; never
 *  one from the owner's own site. Empty on any failure (incl. pre-0138). */
export async function pendingRequestsFor(emails: string[], ownSiteId?: string): Promise<PendingRequest[]> {
  const list = [...new Set(emails.map((e) => String(e || '').trim().toLowerCase()).filter(validEmail))].slice(0, 5);
  if (!list.length) return [];
  try {
    const r = await svc(`presence_connect_requests?status=eq.pending&email=in.(${list.map(pgrstQuoted).join(',')})&select=id,studio_site_id,agency_id,email,name,created_at&order=created_at.desc&limit=10`);
    return rows(r)
      .filter((x) => UUID_RE.test(String(x.id)) && UUID_RE.test(String(x.studio_site_id)) && String(x.studio_site_id) !== String(ownSiteId || ''))
      .map((x) => ({ id: String(x.id), studio_site_id: String(x.studio_site_id), agency_id: x.agency_id ? String(x.agency_id) : null, email: String(x.email), name: String(x.name || '') }));
  } catch { return []; }
}

/** What each studio is called, for the owner's "Davis Digital Studio asked to…". */
export async function studioNames(studioSiteIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(studioSiteIds.filter((x) => UUID_RE.test(String(x))))];
  if (!ids.length) return {};
  try {
    const out: Record<string, string> = {};
    for (const i of rows(await svc(`presence_identity?site_id=in.(${ids.join(',')})&select=site_id,business_name`))) {
      const n = String(i.business_name || '').trim();
      if (n) out[String(i.site_id)] = n.slice(0, 120);
    }
    return out;
  } catch { return {}; }
}

/** An owner's own emails: the sign-in email and their account's emails. */
export async function ownerEmails(principalEmail: string | null | undefined, clientId: string | null | undefined): Promise<string[]> {
  const out = [String(principalEmail || '').trim().toLowerCase()];
  if (clientId && UUID_RE.test(String(clientId))) {
    try {
      const c = rows(await svc(`clients?id=eq.${clientId}&select=email,contact_email&limit=1`))[0];
      if (c) out.push(String(c.email || '').toLowerCase(), String(c.contact_email || '').toLowerCase());
    } catch { /* the sign-in email alone */ }
  }
  return [...new Set(out.filter(validEmail))];
}
