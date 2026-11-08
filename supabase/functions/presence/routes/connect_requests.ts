// ═══ A studio asked to work with you (final pass, Nov 8 2026: S1) ═══════════
//   GET  /portal/studio-requests            — the requests waiting on you
//   POST /portal/studio-requests/:id/accept — say yes: the studio can open and
//                                             work on your website, and you see
//                                             its projects, messages and invoices
//   POST /portal/studio-requests/:id/decline
// Only the site's OWNER answers (not a team seat, not a studio scoped in): saying
// yes hands the studio control of the website. A request is matched to the owner
// by email — the studio typed it; the owner signs in with it or it is on their
// account. Nothing is taken from another studio: a site another studio manages,
// or an owner who already works with a studio, is refused with a plain reason.
import { json } from '../../_shared/http.ts';
import type { Principal } from '../../_shared/auth.ts';
import type { SiteRow } from '../lib/site.ts';
import { svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { pendingRequestsFor, studioNames, ownerEmails, claimPortfolioSite, releasePortfolioSite } from '../lib/connect_requests.ts';
import { bridgeCustomerToStudio } from './sales.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
const ownerOnly = (principal: Principal) => principal.kind === 'client' && !(principal as any).member && !principal.scope;
const notOwner = (cors: Record<string, string>) => json({ error: 'forbidden', message: 'Only the owner of this website can answer a studio’s request.' }, 403, cors);

/** The pending requests for this owner, with each studio's name. */
export async function studioRequestsFor(site: SiteRow, principal: Principal): Promise<Array<{ id: string; studio: string }>> {
  if (!ownerOnly(principal) || !site.client_id) return [];
  const reqs = await pendingRequestsFor(await ownerEmails(principal.email, site.client_id), site.id);
  if (!reqs.length) return [];
  const names = await studioNames(reqs.map((r) => r.studio_site_id));
  // one row per studio (a studio that asked twice, under two of your emails, asks once)
  const seen = new Set<string>();
  return reqs.filter((r) => (seen.has(r.studio_site_id) ? false : (seen.add(r.studio_site_id), true)))
    .map((r) => ({ id: r.id, studio: names[r.studio_site_id] || 'A studio' }));
}

export async function handleStudioRequests(req: Request, route: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'GET' && route === '/portal/studio-requests') {
    return json({ data: { requests: await studioRequestsFor(site, principal) } }, 200, cors);
  }
  const m = route.match(/^\/portal\/studio-requests\/([0-9a-f-]{36})\/(accept|decline)$/);
  if (!m || req.method !== 'POST') return json({ error: 'not_found' }, 404, cors);
  if (!ownerOnly(principal)) return notOwner(cors);
  if (!site.client_id) return json({ error: 'no_account', message: 'This website has no owner account yet.' }, 422, cors);
  const [, id, verb] = m;
  // the request must be pending and addressed to one of THIS owner's emails
  const emails = await ownerEmails(principal.email, site.client_id);
  const r = rows(await svc(`presence_connect_requests?id=eq.${id}&status=eq.pending&select=id,studio_site_id,agency_id,email,name&limit=1`))[0];
  if (!r || !emails.includes(String(r.email || '').toLowerCase()) || !UUID_RE.test(String(r.studio_site_id))) {
    return json({ error: 'not_found', message: 'That request isn’t waiting any more.' }, 404, cors);
  }
  const studioSiteId = String(r.studio_site_id);
  if (studioSiteId === site.id) return json({ error: 'not_found', message: 'That request isn’t waiting any more.' }, 404, cors);
  const decide = (status: 'accepted' | 'declined') =>
    svc(`presence_connect_requests?id=eq.${id}&status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ status, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  const studio = (await studioNames([studioSiteId]))[studioSiteId] || 'The studio';

  if (verb === 'decline') {
    const d = await decide('declined');
    return d.ok ? json({ data: { declined: true, studio } }, 200, cors) : json({ error: 'write_failed', message: 'That didn’t save. Please try again.' }, 502, cors);
  }

  // ── accept ──
  const ident = rows(await svc(`presence_identity?site_id=eq.${site.id}&select=business_name&limit=1`))[0];
  const label = String(ident?.business_name || r.name || 'Website').slice(0, 120);
  // 1) the studio's agency may open and work on the website — never taken from another
  let claimed: 'linked' | 'already' | null = null;
  if (r.agency_id && UUID_RE.test(String(r.agency_id))) {
    const c = await claimPortfolioSite(String(r.agency_id), site.id, String(r.email));
    if (c === 'owned_elsewhere') return json({ error: 'owned_elsewhere', message: 'Another studio already looks after your website on Studio OS. Ask them to let it go first, then accept this request.' }, 409, cors);
    if (c === 'failed') return json({ error: 'write_failed', message: 'That didn’t save. Please try again.' }, 502, cors);
    claimed = c;
  }
  // 2) you become the studio's customer (one studio per customer)
  const b = await bridgeCustomerToStudio({ agencySiteId: studioSiteId, clientId: String(site.client_id), customerSiteId: site.id, label });
  if (!b.bridged) {
    if (claimed === 'linked') await releasePortfolioSite(String(r.agency_id), site.id);
    return b.ownedElsewhere
      ? json({ error: 'owned_elsewhere', message: 'You already work with another studio on Studio OS, so this one can’t be added. If you’re switching studios, ask the first one to let you go.' }, 409, cors)
      : json({ error: 'write_failed', message: 'That didn’t save. Please try again.' }, 502, cors);
  }
  // 3) the studio's contact for this email is now you; the request is answered
  await svc(`presence_contacts?site_id=eq.${studioSiteId}&email=eq.${encodeURIComponent(String(r.email))}&deleted_at=is.null`, { method: 'PATCH', body: JSON.stringify({ client_id: site.client_id }) }).catch(() => {});
  await decide('accepted').catch(() => null);
  // 4) the studio sees it happen
  await writeChangeEvent({ siteId: studioSiteId, entityType: 'client', entityId: String(site.client_id), action: 'connect', summary: `${label} accepted your request — they’re in Customers now`, principal, provenance: 'human' }).catch(() => {});
  return json({ data: { accepted: true, studio, managed: !!claimed, project_id: b.projectId } }, 200, cors);
}
