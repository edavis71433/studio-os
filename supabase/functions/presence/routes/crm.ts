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
const arr = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const isClientKind = (k: unknown) => k === 'client' || k === 'customer';

/** Resolve a customer's identity keys (auth id via their contact + emails) so a
 *  project-less support request they filed still ties to them. `clients` has NO
 *  auth_user_id column — it lives on the linked contact. Mirrors project_comms.
 *  Also returns the raw email addresses (original + lowercased) so email-keyed
 *  channels (bookings, broadcast sends) can join onto the same identity. */
async function customerRequesterKeys(_agencySiteId: string, clientId: string): Promise<{ keys: string[]; emails: string[] }> {
  if (!clientId) return { keys: [], emails: [] };
  const c = one(await svc(`clients?id=eq.${clientId}&select=email,contact_email,contact_id&limit=1`));
  if (!c) return { keys: [], emails: [] };
  let authId = '';
  if (c.contact_id) { const ct = one(await svc(`contacts?id=eq.${c.contact_id}&select=auth_user_id&limit=1`)); authId = ct?.auth_user_id ? String(ct.auth_user_id) : ''; }
  const raw = [authId, c.email, c.contact_email].filter((k) => k != null && String(k).trim() !== '').map((k) => String(k));
  const emails = [...new Set(raw.filter((k) => k.includes('@')).flatMap((e) => [e, e.toLowerCase()]))];
  return { keys: raw.map((k) => encodeURIComponent(`"${k.replace(/"/g, '')}"`)), emails };
}

/** ── /crm/search — global record search (the Salesforce global-search pattern) ──
 *  Searches contacts + deals + projects on the operator's site by name/title, each
 *  result linking to its Client Record. Studio-side only; feeds the ⌘K palette. */
export async function handleCrmSearch(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (!(await isStudioSide(jwt, principal))) return json({ data: { results: [] } }, 200, cors);
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').replace(/[(),*"\\%]/g, ' ').trim().slice(0, 60);
  if (q.length < 2) return json({ data: { results: [] } }, 200, cors);
  const eq = encodeURIComponent(q);
  try {
    const [contacts, deals, projects] = await Promise.all([
      svc(`presence_contacts?site_id=eq.${site.id}&deleted_at=is.null&or=(name.ilike.*${eq}*,email.ilike.*${eq}*,company.ilike.*${eq}*)&select=id,name,email,company&limit=6`),
      svc(`presence_deals?site_id=eq.${site.id}&deleted_at=is.null&title=ilike.*${eq}*&select=id,title,stage&order=updated_at.desc&limit=6`),
      svc(`presence_projects?site_id=eq.${site.id}&deleted_at=is.null&name=ilike.*${eq}*&select=id,name,status&limit=6`),
    ]);
    const results: any[] = [];
    for (const c of arr(contacts)) results.push({ label: String(c.name || c.email || 'Contact'), sub: 'Contact' + (c.company ? ' · ' + String(c.company) : ''), href: `/crm.html?contact=${c.id}&tab=details` });
    for (const d of arr(deals)) results.push({ label: String(d.title || 'Deal'), sub: 'Deal' + (d.stage ? ' · ' + String(d.stage) : ''), href: `/crm.html?deal=${d.id}&tab=deal` });
    for (const p of arr(projects)) results.push({ label: String(p.name || 'Project'), sub: 'Project', href: `/crm.html?project=${p.id}&tab=delivery` });
    return json({ data: { results } }, 200, cors);
  } catch (_e) {
    return json({ data: { results: [] } }, 200, cors);
  }
}

/** ── /crm/messages — ONE activity thread per client (the Salesforce model) ──
 *  Every communication with a customer, merged chronologically on their record:
 *  project/general messages across ALL linked projects (not just the first) +
 *  support tickets/replies + their original website enquiry + bookings + logged
 *  calls/emails/meetings + email broadcasts they received — each tagged with its
 *  channel and from client|studio. The operator replies from ONE composer: into
 *  the project thread when one exists, else into the newest open support thread
 *  (reply_support_to). Studio-side only; resolves the agency site the data lives
 *  on. Every added channel is best-effort — one failing read never blanks the
 *  conversation, it just omits that channel. */
export async function handleCrmMessages(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (!(await isStudioSide(jwt, principal))) return json({ error: 'forbidden', message: 'Only your studio can open a client conversation.' }, 403, cors);
  const u = new URL(req.url);
  const qp = (k: string) => { const v = u.searchParams.get(k) || ''; return UUID_RE.test(v) ? v : ''; };
  let projectId = qp('project');
  let clientId = qp('client_id');
  let dealId = qp('deal_id') || qp('deal');
  let agencySiteId = site.id;
  if (site.client_id) {
    clientId = clientId || String(site.client_id);
    const links = await linksForCustomer(String(site.client_id));
    if (links[0]) { agencySiteId = links[0].agency_site_id; if (!projectId) projectId = links[0].project_id; }
  }
  // project → its customer (so a project-scoped record still resolves project-less tickets)
  if (projectId && !clientId) { const lk = one(await svc(`presence_service_links?project_id=eq.${projectId}&status=eq.active&select=customer_client_id,agency_site_id&limit=1`)); if (lk) { clientId = String(lk.customer_client_id || ''); if (lk.agency_site_id) agencySiteId = String(lk.agency_site_id); } }
  const AS = agencySiteId;

  try {
    // every project on this relationship — a multi-project client loses nothing
    const projectIds: string[] = projectId ? [projectId] : [];
    if (clientId) { try { for (const lk of await linksForCustomer(clientId)) { const p = String(lk.project_id || ''); if (p && !projectIds.includes(p)) projectIds.push(p); } } catch { /* additive */ } }
    // the deal anchors the enquiry + logged-activity channels
    let srcSub = '';
    if (!dealId && clientId) {
      const d = one(await svc(`presence_deals?converted_client_id=eq.${clientId}&site_id=eq.${AS}&deleted_at=is.null&select=id,source_submission_id&order=updated_at.desc&limit=1`));
      if (d) { dealId = String(d.id); srcSub = String(d.source_submission_id || ''); }
    } else if (dealId) {
      const d = one(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${AS}&select=source_submission_id&limit=1`));
      if (d) srcSub = String(d.source_submission_id || '');
    }

    const items: any[] = [];
    if (projectIds.length) {
      for (const m of arr(await svc(`presence_project_messages?project_id=in.(${projectIds.join(',')})&site_id=eq.${AS}&deleted_at=is.null&select=id,project_id,audience,body,author_kind,created_at&order=created_at.asc&limit=300`))) {
        if (m.audience === 'internal') continue;   // internal notes aren't part of the client conversation
        items.push({ id: m.id, kind: 'message', project_id: m.project_id, from: isClientKind(m.author_kind) ? 'client' : 'studio', body: String(m.body || ''), created_at: m.created_at });
      }
    }
    const ident = clientId ? await customerRequesterKeys(AS, clientId) : { keys: [], emails: [] };
    const sup: any[] = [];
    const seen = new Set<string>();
    const addSup = (rows_: any[]) => { for (const s of rows_) { if (!seen.has(String(s.id))) { seen.add(String(s.id)); sup.push(s); } } };
    if (projectIds.length) addSup(arr(await svc(`presence_support_requests?site_id=eq.${AS}&project_id=in.(${projectIds.join(',')})&deleted_at=is.null&select=id,subject,body,status,requester_kind,created_at&order=created_at.asc&limit=100`)));
    if (ident.keys.length) addSup(arr(await svc(`presence_support_requests?site_id=eq.${AS}&project_id=is.null&deleted_at=is.null&requester=in.(${ident.keys.join(',')})&select=id,subject,body,status,requester_kind,created_at&order=created_at.asc&limit=100`)));
    let replySupportTo: string | null = null;
    for (const s of sup) {
      if (s.status !== 'resolved' && s.status !== 'closed') replySupportTo = `/support/${s.id}/messages`;   // newest open wins (sup is created_at asc)
      items.push({ id: s.id, kind: 'support', support_id: s.id, subject: String(s.subject || 'Support request'), status: s.status, from: 'client', body: String(s.body || ''), created_at: s.created_at });
      for (const r of arr(await svc(`presence_support_messages?request_id=eq.${s.id}&site_id=eq.${AS}&deleted_at=is.null&select=id,body,author_kind,created_at&order=created_at.asc&limit=200`))) {
        items.push({ id: r.id, kind: 'support_reply', support_id: s.id, from: isClientKind(r.author_kind) ? 'client' : 'studio', body: String(r.body || ''), created_at: r.created_at });
      }
    }
    // the original website enquiry that started the relationship
    if (srcSub) {
      try {
        const f = one(await svc(`presence_form_submissions?id=eq.${srcSub}&site_id=eq.${AS}&select=id,form_kind,message,created_at&limit=1`));
        if (f) items.push({ id: f.id, kind: 'enquiry', from: 'client', subject: 'Website enquiry', body: String(f.message || ''), created_at: f.created_at });
      } catch { /* channel is additive */ }
    }
    // bookings with the studio (matched on the client's email identity)
    if (ident.emails.length) {
      try {
        const em = ident.emails.map((e) => encodeURIComponent(`"${e.replace(/"/g, '')}"`)).join(',');
        for (const a of arr(await svc(`presence_appointments?site_id=eq.${AS}&customer_email=in.(${em})&select=id,type_name,slot_start_local,slot_start,note,status,created_at&order=created_at.asc&limit=50`))) {
          if (a.status === 'canceled') continue;
          const when = String(a.slot_start_local || '').replace('T', ' ') || String(a.slot_start || '').slice(0, 16).replace('T', ' ');
          items.push({ id: a.id, kind: 'booking', from: 'client', subject: `Booked: ${String(a.type_name || 'a call')}${when ? ` · ${when}` : ''}`, body: String(a.note || ''), created_at: a.created_at });
        }
      } catch { /* channel is additive */ }
    }
    // logged calls/emails/meetings + sent-document stamps (the deal quick-log)
    if (dealId) {
      try {
        const SYS = ['proposal_sent', 'contract_sent', 'invoice_sent'];
        for (const ev of arr(await svc(`presence_deal_events?deal_id=eq.${dealId}&site_id=eq.${AS}&select=id,kind,detail,created_at&order=created_at.asc&limit=200`))) {
          const d = (ev.detail && typeof ev.detail === 'object') ? ev.detail : {};
          if (ev.kind === 'note' && ['call', 'email', 'meeting', 'note'].includes(String(d.activity_kind))) {
            items.push({ id: ev.id, kind: 'activity', activity_kind: String(d.activity_kind), from: 'studio', body: String(d.body || ''), created_at: String(d.occurred_at || ev.created_at) });
          } else if (SYS.includes(String(ev.kind))) {
            items.push({ id: ev.id, kind: 'activity', activity_kind: String(ev.kind), from: 'studio', body: '', created_at: ev.created_at });
          }
        }
      } catch { /* channel is additive */ }
    }
    // email broadcasts this client actually received
    if (ident.emails.length) {
      try {
        const em = ident.emails.map((e) => encodeURIComponent(`"${e.replace(/"/g, '')}"`)).join(',');
        const sends = arr(await svc(`presence_broadcast_sends?site_id=eq.${AS}&status=eq.sent&email=in.(${em})&select=broadcast_id,created_at&order=created_at.asc&limit=50`));
        const bIds = [...new Set(sends.map((s) => String(s.broadcast_id)))];
        const subj = new Map<string, string>();
        if (bIds.length) for (const b of arr(await svc(`presence_broadcasts?id=in.(${bIds.join(',')})&select=id,subject&limit=50`))) subj.set(String(b.id), String(b.subject || 'A studio update'));
        for (const s of sends) items.push({ id: `${s.broadcast_id}:${s.created_at}`, kind: 'broadcast', from: 'studio', subject: subj.get(String(s.broadcast_id)) || 'A studio update', body: '', created_at: s.created_at });
      } catch { /* channel is additive */ }
    }
    items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return json({ data: { items, project_id: projectId || null, reply_to: projectId ? `/projects/${projectId}/messages` : null, reply_support_to: replySupportTo } }, 200, cors);
  } catch (_e) {
    return json({ error: 'read_failed', message: 'We couldn’t load this conversation just now.' }, 502, cors);
  }
}

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
    // messages = the ONE conversation with this client (project msgs + support), shown
    // whenever we can tie the record to a project or a customer.
    // highlights — the pinned key facts (Salesforce highlights panel): deal value +
    // stage + next step, and total owed. Cheap, best-effort; never blocks the record.
    const highlights: Record<string, unknown> = {};
    try {
      if (dealId) {
        const dv = one(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${AS}&select=stage,expected_value_cents,next_step&limit=1`));
        if (dv) { if (dv.expected_value_cents) highlights.value_cents = Number(dv.expected_value_cents) || 0; if (dv.stage) highlights.stage = String(dv.stage); if (dv.next_step) highlights.next_step = String(dv.next_step); }
      }
      if (dealId || clientId) {
        const invFilter = dealId ? `deal_id=eq.${dealId}` : `customer_client_id=eq.${clientId}`;
        const owed = arr(await svc(`presence_invoices?site_id=eq.${AS}&${invFilter}&status=eq.open&deleted_at=is.null&select=amount_cents&limit=100`)).reduce((a, i) => a + (Number(i.amount_cents) || 0), 0);
        if (owed) highlights.owed_cents = owed;
      }
    } catch { /* highlights are additive — never block the record */ }

    const sections = { overview: !!customerSiteId, messages: !!(projectId || clientId), deal: !!dealId, delivery: !!projectId, details: !!contactId };
    const default_tab = projectId ? 'delivery' : (dealId ? 'deal' : (customerSiteId ? 'overview' : 'details'));
    // canonical addressing: the most-stable key that exists (customer site → deal → contact)
    const canonical = customerSiteId ? { key: 'client', value: customerSiteId } : (dealId ? { key: 'deal', value: dealId } : { key: 'contact', value: contactId });

    return json({ data: {
      identity: { contact_id: contactId || null, deal_id: dealId || null, client_id: clientId || null, customer_site_id: customerSiteId || null, project_id: projectId || null },
      header, highlights, sections, default_tab, canonical,
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
