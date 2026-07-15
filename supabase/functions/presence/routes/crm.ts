// ── /crm/* — the Client Relationship Center (Phase C) ────────────────────────
// An operational relationship hub, not a sales CRM. It AGGREGATES existing
// signals (publishes, changes, connected events, moments, approvals) into one
// calm per-client view, plus relationship notes. Reachable through the normal
// site gate; the reviewer boundary already refuses /crm/* (it's the workspace).
// Audience: the studio side (operator + agency) sees internal items; the client
// side (a business owner on their own account) sees only shared items. This uses
// existing principal/agency signals — permission/visibility models unchanged.
//   GET  /crm/profile              — profile + calm health + relationship summary
//   GET  /crm/timeline             — unified activity feed (audience-filtered)
//   GET  /crm/notes                — relationship notes (internal hidden from client side)
//   POST /crm/notes                — add { audience, body }
//   POST /crm/notes/:id/pin        — { pinned }
//   DELETE /crm/notes/:id          — soft-delete
import { json } from '../../_shared/http.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { resolveAgencyMember } from '../agency/auth.ts';
import { loadProfile, loadTimeline, listNotes, addNote, setNotePinned, deleteNote } from '../crm/store.ts';
import { filterTimeline, relationshipSummary, isAudience, cleanNoteBody } from '../crm/contract.ts';
import { svc } from '../lib/db.ts';
import { linksForCustomer } from '../lib/service_bridge.ts';

/** W3: resolve this customer's Pipeline deal + linked project so the studio can
 *  open them in context from the CRM (studio-side only; additive, best-effort).
 *  The deal lives on the agency site (converted_client_id = this client); the
 *  project comes through the Agency–Client Bridge. */
async function crmContext(site: SiteRow): Promise<{ deal_id?: string; project_id?: string }> {
  const ctx: { deal_id?: string; project_id?: string } = {};
  if (!site.client_id) return ctx;
  try {
    const [dealR, links] = await Promise.all([
      svc(`presence_deals?converted_client_id=eq.${site.client_id}&deleted_at=is.null&select=id,updated_at&order=updated_at.desc&limit=1`),
      linksForCustomer(site.client_id),
    ]);
    const dealId = (Array.isArray(dealR.json) ? dealR.json[0]?.id : null) || null;
    if (dealId) ctx.deal_id = dealId;
    if (links[0]?.project_id) ctx.project_id = links[0].project_id;
  } catch { /* doorways are additive — never block the profile */ }
  return ctx;
}

/** The studio side sees internal items; the client side sees only shared. */
async function isStudioSide(jwt: string, principal: Principal): Promise<boolean> {
  if (principal.kind === 'staff' || principal.kind === 'system') return true;
  try { return !!(await resolveAgencyMember(jwt)); } catch { return false; }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json[0] : null) as any;

/** ── /crm/record — the RESOLVER behind the unified Client Record ───────────────
 *  One relationship is physically split across four tables (contact → deal →
 *  client → project). This resolves ANY inbound key the existing entry points
 *  already emit (?contact= / ?deal= / ?client= / ?project=) into ONE canonical
 *  identity tuple + a header + which sections exist, so the record page can show
 *  the right tabs and address itself by the most-stable key. Studio-side only.
 *
 *  The CRM data (deals/contacts/projects) lives on the AGENCY site. When the page
 *  is scoped to a customer's own site (?client=<customer_site_id> → site.client_id
 *  is set), we hop through the bridge to reach the agency site the deal/project
 *  live on. Un-scoped, `site` already IS the operator's agency site. */
export async function handleCrmRecord(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (!(await isStudioSide(jwt, principal))) return json({ error: 'forbidden', message: 'Only your studio can open a client record.' }, 403, cors);
  const u = new URL(req.url);
  const qp = (k: string) => { const v = u.searchParams.get(k) || ''; return UUID_RE.test(v) ? v : ''; };
  let contactId = qp('contact_id') || qp('contact');
  let dealId = qp('deal_id') || qp('deal');
  let clientId = qp('client_id');
  let projectId = qp('project_id') || qp('project');
  let customerSiteId = '';

  // Determine the agency site the relationship data lives on.
  let agencySiteId = site.id;
  if (site.client_id) {                     // scoped to a customer's own site
    clientId = clientId || String(site.client_id);
    customerSiteId = String(site.id);
    const links = await linksForCustomer(String(site.client_id));
    if (links[0]) { agencySiteId = links[0].agency_site_id; if (!projectId) projectId = links[0].project_id; }
  }
  const AS = agencySiteId;

  try {
    // project → bridge → client (+ agency site + deal)
    if (projectId && !clientId) {
      const lk = one(await svc(`presence_service_links?project_id=eq.${projectId}&status=eq.active&select=customer_client_id,customer_site_id,agency_site_id,deal_id&limit=1`));
      if (lk) { clientId = String(lk.customer_client_id || ''); customerSiteId = customerSiteId || String(lk.customer_site_id || ''); if (lk.agency_site_id) agencySiteId = String(lk.agency_site_id); if (!dealId && lk.deal_id) dealId = String(lk.deal_id); }
    }
    // client → newest deal (+ its converted site)
    if (clientId && !dealId) {
      const d = one(await svc(`presence_deals?converted_client_id=eq.${clientId}&site_id=eq.${AS}&deleted_at=is.null&select=id,converted_site_id,created_project_id&order=updated_at.desc&limit=1`));
      if (d) { dealId = String(d.id); if (!customerSiteId && d.converted_site_id) customerSiteId = String(d.converted_site_id); if (!projectId && d.created_project_id) projectId = String(d.created_project_id); }
    }
    // deal → its contact + convert outputs
    if (dealId) {
      const d = one(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${AS}&deleted_at=is.null&select=contact_id,converted_client_id,converted_site_id,created_project_id&limit=1`));
      if (d) {
        if (!contactId && d.contact_id) contactId = String(d.contact_id);
        if (!clientId && d.converted_client_id) clientId = String(d.converted_client_id);
        if (!customerSiteId && d.converted_site_id) customerSiteId = String(d.converted_site_id);
        if (!projectId && d.created_project_id) projectId = String(d.created_project_id);
      }
    }
    // contact → newest deal (only when we arrived contact-first)
    if (contactId && !dealId) {
      const d = one(await svc(`presence_deals?contact_id=eq.${contactId}&site_id=eq.${AS}&deleted_at=is.null&select=id,converted_client_id,converted_site_id,created_project_id&order=updated_at.desc&limit=1`));
      if (d) { dealId = String(d.id); if (!clientId && d.converted_client_id) clientId = String(d.converted_client_id); if (!customerSiteId && d.converted_site_id) customerSiteId = String(d.converted_site_id); if (!projectId && d.created_project_id) projectId = String(d.created_project_id); }
    }

    // ── Header (best-effort; the Overview tab fetches rich health separately) ──
    let header: Record<string, unknown> = { name: '', company: '', email: '', phone: '', status: '' };
    if (clientId) {
      const c = one(await svc(`clients?id=eq.${clientId}&select=name,email,contact_email&limit=1`));
      if (c) header = { name: c.name || c.email || 'Client', company: '', email: c.email || c.contact_email || '', phone: '', status: 'customer' };
    }
    if (contactId && !header.name) {
      const c = one(await svc(`presence_contacts?id=eq.${contactId}&site_id=eq.${AS}&select=name,company,email,phone&limit=1`));
      if (c) header = { name: c.name || c.email || 'Contact', company: c.company || '', email: c.email || '', phone: c.phone || '', status: 'contact' };
    }

    // overview (the relationship health view) reads /crm/profile, which is only
    // SAFE when we can scope to a real customer site — otherwise it would run
    // against the operator's own site (the old crm.html landmine). Gate on the site.
    const sections = { overview: !!customerSiteId, deal: !!dealId, delivery: !!projectId, details: !!contactId };
    const default_tab = projectId ? 'delivery' : (dealId ? 'deal' : (customerSiteId ? 'overview' : 'details'));
    // canonical addressing: the most-stable key that exists (customer site → deal → contact)
    const canonical = customerSiteId ? { key: 'client', value: customerSiteId } : (dealId ? { key: 'deal', value: dealId } : { key: 'contact', value: contactId });

    return json({ data: {
      identity: { contact_id: contactId || null, deal_id: dealId || null, client_id: clientId || null, customer_site_id: customerSiteId || null, project_id: projectId || null },
      header, sections, default_tab, canonical,
    } }, 200, cors);
  } catch (_e) {
    return json({ error: 'resolve_failed', message: 'We couldn’t open that client record just now.' }, 502, cors);
  }
}

export async function handleCrmProfile(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const now = new Date().toISOString();
  const studio = await isStudioSide(jwt, principal);
  const [profile, timeline] = await Promise.all([
    loadProfile(site, now),
    loadTimeline(site, { includeInternalNotes: studio, limit: 60 }),
  ]);
  const visible = filterTimeline(timeline, studio);
  const summary = relationshipSummary(profile, visible[0]?.at ?? null, now);
  const context = studio ? await crmContext(site) : {};   // W3: Pipeline/Project doorways, studio-side only
  return json({ data: { profile, summary, context, is_studio_view: studio, last_activity_at: visible[0]?.at ?? null } }, 200, cors);
}

export async function handleCrmTimeline(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const studio = await isStudioSide(jwt, principal);
  const timeline = await loadTimeline(site, { includeInternalNotes: studio, limit: 60 });
  return json({ data: { items: filterTimeline(timeline, studio), is_studio_view: studio } }, 200, cors);
}

export async function handleCrmNotesList(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const studio = await isStudioSide(jwt, principal);
  const notes = await listNotes(site.id, studio);   // internal notes only for the studio side
  return json({ data: { notes, can_write_internal: studio } }, 200, cors);
}

export async function handleCrmNoteAdd(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const studio = await isStudioSide(jwt, principal);
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const audience = isAudience(b?.audience) ? b.audience : 'internal';
  if (audience === 'internal' && !studio) {
    return json({ error: 'forbidden', message: 'Internal notes are for your studio. You can leave a shared note instead.' }, 403, cors);
  }
  const body = cleanNoteBody(b?.body);
  if (!body) return json({ error: 'bad_request', message: 'Write a little something first.' }, 400, cors);
  const res = await addNote(site.id, audience, body, principal.userId || 'user', principal.kind);
  if (!res.ok) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  return json({ data: { ok: true, id: res.id, message: audience === 'shared' ? 'Shared with the client.' : 'Saved to your studio notes.' } }, 200, cors);
}

export async function handleCrmNotePin(req: Request, jwt: string, site: SiteRow, principal: Principal, noteId: string, cors: Record<string, string>) {
  if (!(await isStudioSide(jwt, principal))) return json({ error: 'forbidden', message: 'Only your studio can pin relationship notes.' }, 403, cors);
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const ok = await setNotePinned(site.id, noteId, !!b?.pinned);
  return ok ? json({ data: { ok: true } }, 200, cors) : json({ error: 'not_found', message: 'That note isn’t here.' }, 404, cors);
}

export async function handleCrmNoteDelete(jwt: string, site: SiteRow, principal: Principal, noteId: string, cors: Record<string, string>) {
  if (!(await isStudioSide(jwt, principal))) return json({ error: 'forbidden', message: 'Only your studio can remove relationship notes.' }, 403, cors);
  const ok = await deleteNote(site.id, noteId);
  return ok ? json({ data: { ok: true, message: 'Removed.' } }, 200, cors) : json({ error: 'not_found', message: 'That note isn’t here.' }, 404, cors);
}
