// ── A studio's customers, one step at a time (builder list item 241, Nov 2026) ───
// Eric, Nov 15: "it looks like every time a customer has been created, it starts their
// site. shouldnt be that way. i also cant delete whats currently there". Drawn in Figma
// first (page "Customers: save, Create website, invite, delete — items 241 and 102").
//
//   · Save (Add a customer, mode 'save'): the customer and nothing else. A client record
//     with no owner (no sign-in, no email on it, the way + New site makes one), the
//     studio's project and link (so they are on Customers and have a profile), and the
//     person in the studio's contacts. No website, no workspace, nobody emailed.
//   · Their profile reads GET /sales/customers/:id: their website (none, ours, on their
//     own host, or a workspace with no website) and their portal (never invited, waiting,
//     the invite ran out, in).
//   · Create website is + New site's sheet opened for them (agency/sites.ts, client_id):
//     websiteForCustomer below makes the site for THEIR record and points the link at it.
//   · Invite to their portal (POST /sales/customers/:id/invite) is its own step: their
//     sign-in, then the email. The portal needs a workspace, so a customer with no website
//     gets one without a website first (the old "just their client workspace").
//   · Delete (POST /sales/customers/:id/delete) for a customer added by mistake: their
//     links end and their project(s) and contact(s) are set aside, recorded in
//     presence_deleted_customers (migration 0245); their website goes to the Sites Trash
//     with them (90 days there) or stays on Sites, the studio's choice. Restore
//     (POST /sales/customers/:id/restore, also from Recently deleted) puts back exactly
//     that for 30 days; then ops/customer_trash.ts lets the row go.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { validEmail, attachOwnerLogin } from '../commerce/account.ts';
import type { AttachOwnerError } from '../commerce/account.ts';
import { provisionForSignup } from '../commerce/provision.ts';
import { resolveAgencyMember, can, isActiveClient } from '../agency/auth.ts';
import type { AgencyMember } from '../agency/auth.ts';
import { roomOf, roomFullMessage, studioList, addsToRoom } from '../lib/site_room.ts';
import { claimPortfolioSite } from '../lib/connect_requests.ts';
import { portalPeople } from '../lib/portal_people.ts';
import { siteOrigin } from '../lib/site.ts';
import { emailMatch, normEmail, isUniqueViolation } from '../lib/contact_email.ts';
import { UUID_RE } from '../lib/uuid.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

export const CUSTOMER_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;
const rows = (r: { ok?: boolean; json?: unknown } | null | undefined): any[] => (r && r.ok !== false && Array.isArray(r.json) ? r.json as any[] : []);
const one = (r: { ok?: boolean; json?: unknown } | null | undefined): any => rows(r)[0] || null;
const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const nowIso = () => new Date().toISOString();
const notYours = (cors: Record<string, string>) => json({ error: 'not_found', message: 'That customer isn’t one of yours.' }, 404, cors);
const portalUrlFor = (studioSiteId: string) => `${(Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '')}/portal.html?studio=${studioSiteId}`;

type Link = { id: string; project_id: string; customer_site_id: string | null; status: string };
/** This studio's live links to a customer (the Customers list is made of these). */
async function studioLinks(studioSiteId: string, clientId: string): Promise<Link[]> {
  if (!UUID_RE.test(String(studioSiteId)) || !UUID_RE.test(String(clientId))) return [];
  return rows(await svc(`presence_service_links?agency_site_id=eq.${studioSiteId}&customer_client_id=eq.${clientId}&status=eq.active&select=id,project_id,customer_site_id,status&order=created_at.desc&limit=50`)) as Link[];
}
/** Their workspace (one per client record), when they have one. */
async function siteOfClient(clientId: string): Promise<{ id: string; edition: string; status: string; last_published_at: string | null; custom_domain: string | null; netlify_site_id: string | null } | null> {
  return one(await svc(`presence_sites?client_id=eq.${clientId}&select=id,edition,status,last_published_at,custom_domain,netlify_site_id&limit=1`));
}
/** A workspace we don't host keeps the address of their own website here (0031). */
async function elsewhereAddress(siteId: string): Promise<string> {
  const c = one(await svc(`presence_monitor_connections?site_id=eq.${siteId}&select=domain,url&limit=1`).catch(() => null));
  return c ? String(c.domain || c.url || '') : '';
}

// ═══ Save: the customer and nothing else ═══════════════════════════════════════════
/** Add a customer with no Studio OS account behind the email: a client record with no
 *  owner, the studio's project and link, and the person in the studio's contacts, linked to
 *  it. The same person saved twice is the same customer. The caller (handleSalesAddCustomer)
 *  has already asked someone else's account and reconnected one of the studio's own. */
export async function saveNewCustomer(site: SiteRow, o: { email: string; name: string; businessName: string; label: string }, cors: Record<string, string>): Promise<Response> {
  const email = normEmail(o.email);
  // the person, found or made in the studio's contacts (one email, one person: K1)
  const findPerson = async () => one(await svc(`presence_contacts?site_id=eq.${site.id}&${emailMatch(email)}&deleted_at=is.null&select=id,client_id,company,name&limit=1`));
  let person = await findPerson();
  if (person && UUID_RE.test(String(person.client_id || '')) && (await studioLinks(site.id, String(person.client_id))).length) {
    return json({ data: { mode: 'save', saved: true, already: true, created: false, client_id: person.client_id, contact_id: person.id, email } }, 200, cors);
  }
  // the customer record: no owner, so nobody can sign in to it until they are invited
  const ci = await svc('clients', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: o.label, status: 'active' }) });
  const clientId = one(ci)?.id ? String(one(ci).id) : '';
  if (!clientId) {
    if (/23502|not-null/i.test(String((ci as { text?: string }).text || ''))) return json({ error: 'needs_database_step', message: 'Saving a customer without setting them up needs one database step first.' }, 503, cors);
    return json({ error: 'write_failed', message: 'We couldn’t save them just now. Please try again.' }, 502, cors);
  }
  const undo = () => svc(`clients?id=eq.${clientId}`, { method: 'DELETE' }).catch(() => null);   // the link and project go with it (cascade)
  // the studio's project and link: this is what puts them on Customers with a profile
  const { bridgeCustomerToStudio } = await import('./sales.ts');
  const br = await bridgeCustomerToStudio({ agencySiteId: site.id, clientId, customerSiteId: null, label: o.label }).catch(() => ({ bridged: false, projectId: null, ownedElsewhere: false }));
  if (!br.bridged || !br.projectId) { await undo(); return json({ error: 'write_failed', message: 'We couldn’t save them just now. Please try again.' }, 502, cors); }
  // the person, linked to the customer (their business name on the contact, when it has none)
  if (!person) {
    const ins = await svc('presence_contacts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: site.id, name: o.name || '', email, company: o.businessName || '', notes: '', client_id: clientId }) });
    person = ins.ok ? one(ins) : (isUniqueViolation(ins) ? await findPerson() : null);
  }
  if (person && String(person.client_id || '') !== clientId) {
    const patch: Record<string, unknown> = { client_id: clientId };
    if (o.businessName && !String(person.company || '').trim()) patch.company = o.businessName;
    if (o.name && !String(person.name || '').trim()) patch.name = o.name;
    await svc(`presence_contacts?id=eq.${person.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify(patch) }).catch(() => null);
  }
  return json({ data: { mode: 'save', saved: true, created: true, client_id: clientId, contact_id: person?.id || null, project_id: br.projectId, email } }, 201, cors);
}

// ═══ Their profile: website and portal ═════════════════════════════════════════════
export type WebsiteState = 'none' | 'workspace' | 'ours' | 'elsewhere';
/** Pure: what a customer's website is, from their workspace row and the address on file. */
export function websiteState(site: { edition: string } | null, elsewhere: string): WebsiteState {
  if (!site) return 'none';
  if (site.edition !== 'monitor') return 'ours';
  return elsewhere ? 'elsewhere' : 'workspace';
}
/** Pure: what the profile offers. Create website for no website at all (a workspace with no
 *  website and no address counts); Invite for a customer never invited; the sign-in link again
 *  for one waiting or whose invite ran out. */
export function customerOffers(w: WebsiteState, portal: string): { create_website: boolean; invite: boolean; invite_again: boolean } {
  return { create_website: w === 'none' || w === 'workspace', invite: portal === 'none', invite_again: portal === 'waiting' || portal === 'expired' };
}

/** GET /sales/customers/:id: what the profile's two steps show. */
export async function handleCustomerRead(site: SiteRow, principal: Principal, clientId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(clientId)) return notYours(cors);
  const links = await studioLinks(site.id, clientId);
  if (!links.length) return notYours(cors);
  const [client, ws, people] = await Promise.all([
    svc(`clients?id=eq.${clientId}&select=id,name,email,contact_email,contact_id&limit=1`).then(one),
    siteOfClient(clientId),
    svc(`presence_contacts?site_id=eq.${site.id}&client_id=eq.${clientId}&deleted_at=is.null&select=id,name,email,company&order=created_at.asc&limit=5`).then(rows).catch(() => [] as any[]),
  ]);
  if (!client) return notYours(cors);
  const elsewhere = ws && ws.edition === 'monitor' ? await elsewhereAddress(ws.id) : '';
  const website = websiteState(ws, elsewhere);
  const pp = ws ? (await portalPeople([{ site_id: ws.id, name: String(client.name || '') }]).catch(() => []))[0] : null;
  const portalState = pp ? pp.state : 'none';
  const person = people[0] || null;
  // the Trash: a website that went there (Delete customer, or Sites) says so on the profile
  const am = principal.jwt ? await resolveAgencyMember(principal.jwt).catch(() => null) : null;
  const pf = ws && am ? one(await svc(`presence_agency_clients?site_id=eq.${ws.id}&agency_id=eq.${am.agency_id}&select=status&limit=1`).catch(() => null)) : null;
  return json({ data: {
    client_id: clientId,
    business_name: String(client.name || ''),
    person: person ? { name: String(person.name || ''), email: String(person.email || ''), company: String(person.company || '') } : null,
    website: { state: website, site_id: ws?.id || null, address: website === 'ours' ? siteOrigin(ws) || null : (elsewhere || null), live: !!(ws && (ws.status === 'live' || ws.last_published_at)), last_published_at: ws?.last_published_at || null, in_trash: pf?.status === 'trashed' },
    portal: { state: portalState, email: pp?.email || String(client.email || client.contact_email || '') || (person ? String(person.email || '') : ''), invited_at: pp?.invited_at || null, seen_at: pp?.seen_at || null },
    offers: { ...customerOffers(website, portalState), delete: true, can_manage_sites: !!(am && can(am.role, 'manage_clients')) },
  } }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

// ═══ Create website: the site for THEIR record ════════════════════════════════════
export type CustomerSite = { ok: true; siteId: string; clientId: string; created: boolean } | { ok: false; status: number; error: string; message: string; room?: unknown };
/** + New site opened for a customer (agency/sites.ts POST /agency/sites with client_id). Their
 *  record keeps the site: no second client, no owner, nobody emailed. A workspace with no
 *  website becomes a hosted site (provisionForSignup moves its edition); one that already has
 *  a website here, or keeps one on its own host, is left alone. The room rule is the same as
 *  + New site's; a workspace already on the list adds nothing to it. */
export async function websiteForCustomer(clientId: string, businessName: string, member: AgencyMember, own: { id: string } | null): Promise<CustomerSite> {
  if (!own) return { ok: false, status: 409, error: 'no_studio_site', message: 'Customers live on your studio’s own site, and this sign-in doesn’t have one.' };
  if (!UUID_RE.test(clientId) || !(await studioLinks(own.id, clientId)).length) return { ok: false, status: 404, error: 'not_found', message: 'That customer isn’t one of yours.' };
  const had = await siteOfClient(clientId);
  if (had && had.edition !== 'monitor') return { ok: false, status: 409, error: 'has_website', message: 'They already have a website. Open it from their profile.' };
  if (had && await elsewhereAddress(had.id)) return { ok: false, status: 409, error: 'hosted_elsewhere', message: 'Their website lives on its own host, so there’s nothing to make here.' };
  const list = await studioList(member.agency_id);
  if (list && addsToRoom(list, had?.id)) {
    const room = roomOf(list.map((l) => l.status), member.client_limit);
    if (room.full) return { ok: false, status: 409, error: 'client_limit', message: roomFullMessage(room.limit, 'new'), room };
  }
  const hadPlan = one(await svc(`presence_entitlements?client_id=eq.${clientId}&product=eq.presence&select=plan,status&limit=1`).catch(() => null));
  const prov = await provisionForSignup({ clientId, businessName, plan: 'presence', patch: { status: 'active' } as any, actorEmail: member.email });
  const undo = async (siteId: string | null) => {
    if (!had && siteId) await svc(`presence_sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => null);   // only a site this made
    if (!hadPlan) await svc(`presence_entitlements?client_id=eq.${clientId}&product=eq.presence`, { method: 'DELETE' }).catch(() => null);
    else await svc(`presence_entitlements?client_id=eq.${clientId}&product=eq.presence`, { method: 'PATCH', body: JSON.stringify({ plan: hadPlan.plan, status: hadPlan.status }) }).catch(() => null);
  };
  if (!prov.ok || !prov.siteId) {
    await undo((await siteOfClient(clientId))?.id || null);
    return { ok: false, status: prov.error === 'hosting_unconfigured' ? 503 : 502, error: prov.error || 'provision_incomplete', message: prov.error === 'hosting_unconfigured' ? 'Hosting isn’t available in this environment.' : 'We couldn’t make the site just now — please try again.' };
  }
  const claim = await claimPortfolioSite(member.agency_id, prov.siteId, '', { reactivate: true });
  if (claim !== 'linked' && claim !== 'already') { await undo(prov.siteId); return { ok: false, status: 502, error: 'write_failed', message: 'The site didn’t save — please try again.' }; }
  // their profile, Customers and the record now know the site
  await svc(`presence_service_links?agency_site_id=eq.${own.id}&customer_client_id=eq.${clientId}&status=eq.active&customer_site_id=is.null`, { method: 'PATCH', body: JSON.stringify({ customer_site_id: prov.siteId }) }).catch(() => null);
  return { ok: true, siteId: prov.siteId, clientId, created: !had };
}

// ═══ Their site lives somewhere else: watch it ══════════════════════════════════════
/** POST /sales/customers/:id/website {address}: a customer whose website is on another
 *  platform (Eric's external-client case, the old "they host it elsewhere"). Their
 *  workspace without a website of ours, the address recorded where Search Console and the
 *  checks read it (presence_monitor_connections, via recordExistingWebsite). Nothing is
 *  published and nobody is emailed. */
export async function handleCustomerElsewhere(req: Request, site: SiteRow, principal: Principal, clientId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(clientId)) return notYours(cors);
  let b: { address?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
  const raw = clean(b.address, 200);
  let host = '';
  try { const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); if (/^https?:$/.test(u.protocol) && u.hostname.includes('.')) host = u.hostname; } catch { host = ''; }
  if (!host) return json({ error: 'validation', message: 'Enter the address of their website, like acmebakery.com.' }, 422, cors);
  if (!(await studioLinks(site.id, clientId)).length) return notYours(cors);
  const client = one(await svc(`clients?id=eq.${clientId}&select=id,name&limit=1`));
  if (!client) return notYours(cors);
  let ws = await siteOfClient(clientId);
  if (ws && ws.edition !== 'monitor') return json({ error: 'has_website', message: 'They already have a website here. Open it from their profile.' }, 409, cors);
  if (ws && await elsewhereAddress(ws.id)) return json({ error: 'has_address', message: 'Their website’s address is already on file. Change it on their website page.' }, 409, cors);
  const am = principal.jwt ? await resolveAgencyMember(principal.jwt).catch(() => null) : null;
  if (!ws) {
    if (am) {
      const list = await studioList(am.agency_id);
      if (list) { const room = roomOf(list.map((l) => l.status), am.client_limit); if (room.full) return json({ error: 'client_limit', message: roomFullMessage(room.limit, 'add'), room }, 409, cors); }
    }
    const prov = await provisionForSignup({ clientId, businessName: String(client.name || host), plan: 'business_os_only', patch: { status: 'active' } as any, actorEmail: principal.email });
    if (!prov.ok || !prov.siteId) return json({ error: prov.error || 'provision_incomplete', message: 'We couldn’t record it just now — please try again.' }, 502, cors);
    if (am) await claimPortfolioSite(am.agency_id, prov.siteId, '').catch(() => 'failed');
    await svc(`presence_service_links?agency_site_id=eq.${site.id}&customer_client_id=eq.${clientId}&status=eq.active&customer_site_id=is.null`, { method: 'PATCH', body: JSON.stringify({ customer_site_id: prov.siteId }) }).catch(() => null);
    ws = await siteOfClient(clientId);
  }
  if (!ws) return json({ error: 'write_failed', message: 'We couldn’t record it just now — please try again.' }, 502, cors);
  const { recordExistingWebsite } = await import('./sales.ts');
  const kept = await recordExistingWebsite(ws.id, 'business_os_only', raw, principal, String(client.name || host));
  if (!kept) return json({ error: 'write_failed', message: 'We couldn’t record the address just now — please try again.' }, 502, cors);
  return json({ data: { site_id: ws.id, address: kept } }, 200, cors);
}

// ═══ Invite to their portal ═════════════════════════════════════════════════════════
const INVITE_REFUSED: Record<AttachOwnerError, [number, string]> = {
  account_exists: [409, 'That email already has a Studio OS account, so it can’t sign in to this one. Use another address for them.'],
  has_owner: [409, 'They already have a sign-in. Send the sign-in link again instead.'],
  auth_failed: [502, 'We couldn’t set up their sign-in just now — please try again.'],
  contact_failed: [502, 'We couldn’t set up their sign-in just now — please try again.'],
};
/** POST /sales/customers/:id/invite {email?}: their own sign-in and the email that opens their
 *  portal, on the studio's brand. Someone already invited gets the sign-in link again. */
export async function handleCustomerInvite(req: Request, site: SiteRow, principal: Principal, clientId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(clientId)) return notYours(cors);
  let b: { email?: unknown } = {}; try { b = await req.json(); } catch { /* the email is optional */ }
  const links = await studioLinks(site.id, clientId);
  if (!links.length) return notYours(cors);
  const client = one(await svc(`clients?id=eq.${clientId}&select=id,name,email,contact_email,contact_id&limit=1`));
  if (!client) return notYours(cors);
  const { sendCustomerInvite } = await import('./sales.ts');
  const ownerEmail = String(client.email || client.contact_email || '').trim().toLowerCase();
  if (ownerEmail || client.contact_id) {
    // already invited: the sign-in link again, to the address they sign in with
    if (!ownerEmail) return json({ error: 'has_owner', message: INVITE_REFUSED.has_owner[1] }, 409, cors);
    const again = await sendCustomerInvite(site.id, ownerEmail, false).catch(() => false);
    return json({ data: { invited: again, again: true, email: ownerEmail, portal_url: portalUrlFor(site.id) } }, 200, cors);
  }
  const person = one(await svc(`presence_contacts?site_id=eq.${site.id}&client_id=eq.${clientId}&deleted_at=is.null&select=id,name,email&order=created_at.asc&limit=1`).catch(() => null));
  const email = normEmail(clean(b.email, 160) || person?.email || '');
  if (!validEmail(email)) return json({ error: 'validation', message: 'Enter their email — that’s where the sign-in link goes.' }, 422, cors);
  // the portal needs their workspace: a customer with no website gets one without a website
  let ws = await siteOfClient(clientId);
  const am = principal.jwt ? await resolveAgencyMember(principal.jwt).catch(() => null) : null;
  if (!ws) {
    if (am) {
      const list = await studioList(am.agency_id);
      if (list) { const room = roomOf(list.map((l) => l.status), am.client_limit); if (room.full) return json({ error: 'client_limit', message: roomFullMessage(room.limit, 'add'), room }, 409, cors); }
    }
    const prov = await provisionForSignup({ clientId, businessName: String(client.name || person?.name || email), plan: 'business_os_only', patch: { status: 'active' } as any, actorEmail: principal.email });
    if (!prov.ok || !prov.siteId) return json({ error: prov.error || 'provision_incomplete', message: 'We couldn’t get their portal ready just now — please try again.' }, 502, cors);
    if (am) await claimPortfolioSite(am.agency_id, prov.siteId, email).catch(() => 'failed');
    await svc(`presence_service_links?agency_site_id=eq.${site.id}&customer_client_id=eq.${clientId}&status=eq.active&customer_site_id=is.null`, { method: 'PATCH', body: JSON.stringify({ customer_site_id: prov.siteId }) }).catch(() => null);
    ws = await siteOfClient(clientId);
  }
  const login = await attachOwnerLogin(clientId, email, String(person?.name || client.name || ''));
  if (!login.ok) { const [status, message] = INVITE_REFUSED[login.error]; return json({ error: login.error, message }, status, cors); }
  if (am && ws) await svc(`presence_agency_clients?site_id=eq.${ws.id}&agency_id=eq.${am.agency_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ owner_email: email }) }).catch(() => null);
  const invited = await sendCustomerInvite(site.id, email, true).catch(() => false);   // item 192: true only when the email left
  return json({ data: { invited, again: false, email, site_id: ws?.id || null, portal_url: portalUrlFor(site.id) } }, 200, cors);
}

// ═══ Delete and Restore ═════════════════════════════════════════════════════════════
const unavailable = (cors: Record<string, string>) => json({ error: 'unavailable', message: 'Deleting customers needs one database step first.' }, 503, cors);
const tableMissing = (r: { ok?: boolean; status?: number; text?: string }) => !r.ok && (r.status === 404 || /42P01|PGRST205|presence_deleted_customers/.test(String(r.text || '')));

/** POST /sales/customers/:id/delete {site: 'trash'|'keep'}: a customer added by mistake leaves
 *  Customers and Contacts with their project; their website goes to the Trash with them or
 *  stays on Sites. Invoices are money records and are never touched. Everything is recorded
 *  first, so a step that fails puts back what had been done. */
export async function handleCustomerDelete(req: Request, site: SiteRow, principal: Principal, clientId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(clientId)) return notYours(cors);
  let b: { site?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
  const choice = b.site === 'trash' ? 'trash' : b.site === 'keep' ? 'keep' : '';
  if (clientId === String(site.client_id || '')) return json({ error: 'bad_request', message: 'That’s your own studio, not a customer.' }, 400, cors);
  const links = await studioLinks(site.id, clientId);
  if (!links.length) return notYours(cors);
  const [client, ws, people] = await Promise.all([
    svc(`clients?id=eq.${clientId}&select=id,name&limit=1`).then(one),
    siteOfClient(clientId),
    svc(`presence_contacts?site_id=eq.${site.id}&client_id=eq.${clientId}&deleted_at=is.null&select=id,name,email&limit=50`).then(rows),
  ]);
  if (ws && !choice) return json({ error: 'bad_request', message: 'Say what happens to their website: trash or keep.' }, 400, cors);
  const projectIds = [...new Set(links.map((l) => String(l.project_id)))];
  const liveProjects = projectIds.length ? rows(await svc(`presence_projects?id=in.(${projectIds.join(',')})&site_id=eq.${site.id}&deleted_at=is.null&select=id`)).map((p) => String(p.id)) : [];
  // the website to the Trash: only one this studio looks after, and only by someone who manages clients
  let am: AgencyMember | null = null;
  if (ws && choice === 'trash') {
    am = principal.jwt ? await resolveAgencyMember(principal.jwt).catch(() => null) : null;
    if (!am || !(await isActiveClient(am.agency_id, ws.id))) return json({ error: 'not_on_sites', message: 'Their website isn’t on your Sites list, so it can’t go to your Trash. Choose to keep it.' }, 409, cors);
    if (!can(am.role, 'manage_clients')) return json({ error: 'forbidden', message: 'Only someone who looks after your clients’ sites can move one to the Trash. Choose to keep it.' }, 403, cors);
  }
  const at = nowIso();
  // the record first: it claims the deletion (one open per customer) and it is what Restore reads
  const name = clean(client?.name, 200) || clean(people[0]?.name, 200) || 'Customer';
  const rec = await svc('presence_deleted_customers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    studio_site_id: site.id, client_id: clientId, name, email: clean(people[0]?.email, 200),
    site_id: ws?.id || null, site_to_trash: !!(ws && choice === 'trash'),
    ended_links: links.map((l) => l.id), deleted_projects: liveProjects, deleted_contacts: people.map((p) => String(p.id)),
    deleted_by: clean(principal.email, 200), deleted_at: at,
  }) });
  if (tableMissing(rec)) return unavailable(cors);
  if (!rec.ok && (rec.status === 409 || isUniqueViolation(rec))) return json({ error: 'already_deleted', message: 'They’re already in Recently deleted.' }, 409, cors);
  const recId = one(rec)?.id ? String(one(rec).id) : '';
  if (!recId) return json({ error: 'write_failed', message: 'We couldn’t delete them just now. Please try again.' }, 502, cors);
  const giveUp = async (status: number, error: string, message: string) => {
    await putBack({ links: links.map((l) => l.id), projects: liveProjects, contacts: people.map((p) => String(p.id)) }, site.id).catch(() => null);
    await svc(`presence_deleted_customers?id=eq.${recId}`, { method: 'DELETE' }).catch(() => null);
    return json({ error, message }, status, cors);
  };
  let siteOut: Record<string, unknown> | null = ws ? { site_id: ws.id, kept: choice !== 'trash' } : null;
  if (ws && choice === 'trash' && am) {
    const { trashClientSite } = await import('../agency/sites.ts');
    const own = { id: site.id };
    const moved = await trashClientSite(ws.id, am, principal, own);
    if (!moved.ok) return giveUp(moved.status, moved.error, moved.message);
    siteOut = { ...moved.data, kept: false };
  }
  const endLinks = await svc(`presence_service_links?id=in.(${links.map((l) => l.id).join(',')})&status=eq.active`, { method: 'PATCH', body: JSON.stringify({ status: 'ended' }) });
  if (!endLinks.ok) {
    if (ws && choice === 'trash' && am) { const { restoreClientSite } = await import('../agency/sites.ts'); await restoreClientSite(ws.id, am, principal, { id: site.id }).catch(() => null); }
    return giveUp(502, 'write_failed', 'We couldn’t delete them just now. Please try again.');
  }
  if (liveProjects.length) await svc(`presence_projects?id=in.(${liveProjects.join(',')})&site_id=eq.${site.id}&deleted_at=is.null`, { method: 'PATCH', body: JSON.stringify({ deleted_at: at }) }).catch(() => null);
  if (people.length) await svc(`presence_contacts?id=in.(${people.map((p) => p.id).join(',')})&site_id=eq.${site.id}&deleted_at=is.null`, { method: 'PATCH', body: JSON.stringify({ deleted_at: at }) }).catch(() => null);
  return json({ data: { deleted: true, client_id: clientId, name, site: siteOut, days: CUSTOMER_KEEP_DAYS, restore_until: new Date(Date.parse(at) + CUSTOMER_KEEP_DAYS * DAY_MS).toISOString() } }, 200, cors);
}

/** Put back links, projects and contacts (Restore, or a Delete that couldn't finish). A person
 *  someone added again since stays as the new one; the answer counts who couldn't come back. */
async function putBack(w: { links: string[]; projects: string[]; contacts: string[] }, studioSiteId: string): Promise<{ links: boolean; people_left: number }> {
  const ids = (a: string[]) => a.filter((x) => UUID_RE.test(String(x)));
  const L = ids(w.links), P = ids(w.projects), C = ids(w.contacts);
  const lr = L.length ? await svc(`presence_service_links?id=in.(${L.join(',')})&agency_site_id=eq.${studioSiteId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }) : { ok: true };
  if (P.length) await svc(`presence_projects?id=in.(${P.join(',')})&site_id=eq.${studioSiteId}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: null }) }).catch(() => null);
  let left = 0;
  for (const c of C) {
    const r = await svc(`presence_contacts?id=eq.${c}&site_id=eq.${studioSiteId}&deleted_at=not.is.null`, { method: 'PATCH', body: JSON.stringify({ deleted_at: null }) }).catch(() => null);
    if (r && !r.ok) left++;
  }
  return { links: !!lr.ok, people_left: left };
}

/** POST /sales/customers/:id/restore: Recently deleted's Restore and the Undo right after.
 *  Their website comes back too when it went to the Trash with them and is still there (a full
 *  plan keeps it in the Trash and says so). */
export async function handleCustomerRestore(site: SiteRow, principal: Principal, clientId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(clientId)) return notYours(cors);
  const since = new Date(Date.now() - CUSTOMER_KEEP_DAYS * DAY_MS).toISOString();
  const q = await svc(`presence_deleted_customers?studio_site_id=eq.${site.id}&client_id=eq.${clientId}&restored_at=is.null&closed_at=is.null&deleted_at=gte.${encodeURIComponent(since)}&select=*&limit=1`);
  if (tableMissing(q)) return unavailable(cors);
  const rec = one(q);
  if (!rec) return json({ error: 'not_found', message: 'That customer isn’t in Recently deleted. Refresh to see what’s there.' }, 404, cors);
  // claim the restore, so two presses can't both run it
  const claim = await svc(`presence_deleted_customers?id=eq.${rec.id}&restored_at=is.null&closed_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ restored_at: nowIso() }) });
  if (!claim.ok || !rows(claim).length) return json({ error: 'not_found', message: 'That customer isn’t in Recently deleted. Refresh to see what’s there.' }, 404, cors);
  const back = await putBack({ links: rec.ended_links || [], projects: rec.deleted_projects || [], contacts: rec.deleted_contacts || [] }, site.id);
  if (!back.links) {
    await svc(`presence_deleted_customers?id=eq.${rec.id}`, { method: 'PATCH', body: JSON.stringify({ restored_at: null }) }).catch(() => null);
    return json({ error: 'write_failed', message: 'We couldn’t bring them back just now. Please try again.' }, 502, cors);
  }
  let siteOut: Record<string, unknown> | null = null;
  if (rec.site_to_trash && UUID_RE.test(String(rec.site_id || ''))) {
    const am = principal.jwt ? await resolveAgencyMember(principal.jwt).catch(() => null) : null;
    if (am && can(am.role, 'manage_clients')) {
      const { restoreClientSite } = await import('../agency/sites.ts');
      const moved = await restoreClientSite(String(rec.site_id), am, principal, { id: site.id });
      siteOut = moved.ok ? { site_id: rec.site_id, restored: true } : { site_id: rec.site_id, restored: false, message: moved.error === 'not_found' ? 'Their website isn’t in your Trash any more.' : moved.message };
    } else siteOut = { site_id: rec.site_id, restored: false, message: 'Their website is still in the Trash on Sites; someone who looks after your clients’ sites can restore it there.' };
  }
  return json({ data: { restored: true, client_id: clientId, name: String(rec.name || 'Customer'), site: siteOut, people_left: back.people_left } }, 200, cors);
}

/** Recently deleted's Customers: the last 30 days, newest first. Null when it can't be read. */
export async function deletedCustomers(studioSiteId: string): Promise<any[] | null> {
  const since = new Date(Date.now() - CUSTOMER_KEEP_DAYS * DAY_MS).toISOString();
  const q = await svc(`presence_deleted_customers?studio_site_id=eq.${studioSiteId}&restored_at=is.null&closed_at=is.null&deleted_at=gte.${encodeURIComponent(since)}&select=client_id,name,email,site_id,site_to_trash,deleted_at&order=deleted_at.desc&limit=200`).catch(() => null);
  if (!q || !q.ok) return tableMissing(q || {}) ? [] : null;   // before 0245 there's nothing to list
  return rows(q).map((r) => ({ id: String(r.client_id), name: String(r.name || 'Customer'), email: String(r.email || ''), site_went: !!(r.site_to_trash && r.site_id), site_kept: !!(r.site_id && !r.site_to_trash), deleted_at: r.deleted_at }));
}

/** The /sales/customers/:id routes. */
export async function handleCustomerRoute(req: Request, route: string, method: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response | null> {
  const m = route.match(/^\/sales\/customers\/([0-9a-f-]{36})(?:\/(invite|delete|restore|website))?$/);
  if (!m) return null;
  const [, id, what] = m;
  if (!what && method === 'GET') return handleCustomerRead(site, principal, id, cors);
  if (what === 'invite' && method === 'POST') return handleCustomerInvite(req, site, principal, id, cors);
  if (what === 'delete' && method === 'POST') return handleCustomerDelete(req, site, principal, id, cors);
  if (what === 'restore' && method === 'POST') return handleCustomerRestore(site, principal, id, cors);
  if (what === 'website' && method === 'POST') return handleCustomerElsewhere(req, site, principal, id, cors);
  return json({ error: 'method_not_allowed' }, 405, cors);
}
