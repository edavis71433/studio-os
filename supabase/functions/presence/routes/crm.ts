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
import { loadCustomerNames } from '../lib/customer_names.ts';
import { loadStageLabels, renameMovedTo } from '../lib/stage_names.ts';
import { callerToday } from '../lib/sales_lifecycle.ts';
import { json } from '../../_shared/http.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { resolveAgencyMember } from '../agency/auth.ts';
import { loadProfile, loadTimeline, listNotes, addNote, setNotePinned, deleteNote } from '../crm/store.ts';
import { filterTimeline, relationshipSummary, isAudience, cleanNoteBody } from '../crm/contract.ts';
import { mapConversationItem, mapSiteEvent, mapDealEvent, mapDoneTask, mergeActivity, buildUpcoming, type ActivityItem } from '../crm/activity.ts';
import { svc } from '../lib/db.ts';
import { linksForCustomer, healUnstampedSupport } from '../lib/service_bridge.ts';
import { resolveSite } from '../lib/site.ts';
import { resolveMemberSite } from '../lib/workspace.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { CONTACT_MORE_COLS, addressLine } from '../lib/contact_fields.ts';

/** W3: resolve this customer's Pipeline deal + linked project so the studio can
 *  open them in context from the CRM (studio-side only; additive, best-effort).
 *  The deal lives on the agency site (converted_client_id = this client); the
 *  project comes through the Agency–Client Bridge. */
async function crmContext(site: SiteRow, studioSiteId: string): Promise<{ deal_id?: string; project_id?: string }> {
  const ctx: { deal_id?: string; project_id?: string } = {};
  if (!site.client_id || !studioSiteId) return ctx;
  try {
    // this studio's deal and project for the customer — never another studio's (S3)
    const [dealR, links] = await Promise.all([
      svc(`presence_deals?converted_client_id=eq.${site.client_id}&site_id=eq.${studioSiteId}&deleted_at=is.null&select=id,updated_at&order=updated_at.desc&limit=1`),
      linksForCustomer(site.client_id),
    ]);
    const dealId = (Array.isArray(dealR.json) ? dealR.json[0]?.id : null) || null;
    if (dealId) ctx.deal_id = dealId;
    const mine = links.find((l) => String(l.agency_site_id) === studioSiteId);
    if (mine?.project_id) ctx.project_id = mine.project_id;
  } catch { /* doorways are additive — never block the profile */ }
  return ctx;
}

/** The studio side sees internal items; the client side sees only shared. */
async function isStudioSide(jwt: string, principal: Principal): Promise<boolean> {
  if (principal.kind === 'staff' || principal.kind === 'system') return true;
  try { return !!(await resolveAgencyMember(jwt)); } catch { return false; }
}

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
  const ql = q.toLowerCase();
  try {
    // Phase 2 (search across everything): customers and invoices join contacts,
    // deals and projects; a money word ("invoice", "owed", "unpaid") lists what's
    // open; and the first customers matched get ACTION rows ("Send invoice to
    // Jordan", "Message Jordan") that land on the record with the form open.
    const moneyWord = /^(inv|invoice|invoices|owed|unpaid|outstanding|money|paid)/.test(ql);
    const cents = /^\$?\d{2,}(\.\d{2})?$/.test(ql) ? Math.round(Number(ql.replace('$', '')) * 100) : 0;
    const [contacts, deals, projects, links, invoices] = await Promise.all([
      svc(`presence_contacts?site_id=eq.${site.id}&deleted_at=is.null&or=(name.ilike.*${eq}*,email.ilike.*${eq}*,company.ilike.*${eq}*)&select=id,name,email,company&limit=6`),
      svc(`presence_deals?site_id=eq.${site.id}&deleted_at=is.null&title=ilike.*${eq}*&select=id,title,stage,converted_client_id&order=updated_at.desc&limit=6`),
      svc(`presence_projects?site_id=eq.${site.id}&deleted_at=is.null&name=ilike.*${eq}*&select=id,name,status&limit=6`),
      svc(`presence_service_links?agency_site_id=eq.${site.id}&status=eq.active&select=customer_client_id,customer_site_id&limit=200`),
      moneyWord
        ? svc(`presence_invoices?site_id=eq.${site.id}&deleted_at=is.null&status=eq.open&select=id,title,amount_cents,status,deal_id&order=created_at.desc&limit=6`)
        : svc(`presence_invoices?site_id=eq.${site.id}&deleted_at=is.null&or=(title.ilike.*${eq}*${cents ? `,amount_cents.eq.${cents}` : ''})&select=id,title,amount_cents,status,deal_id&order=created_at.desc&limit=6`),
    ]);
    const results: any[] = [];
    // customers: the studio's bridged clients, matched by name/email in memory (≤200)
    const siteByClient: Record<string, string> = {};
    const clientIds = [...new Set(arr(links).map((l: any) => { if (l.customer_site_id) siteByClient[String(l.customer_client_id)] = String(l.customer_site_id); return String(l.customer_client_id || ''); }).filter(Boolean))];
    const customers = clientIds.length ? arr(await svc(`clients?id=in.(${clientIds.join(',')})&select=id,name,email&limit=200`)) : [];
    const hit = (s: unknown) => String(s || '').toLowerCase().includes(ql);
    const matchedCustomers = customers.filter((c: any) => hit(c.name) || hit(c.email)).slice(0, 6);
    const recordHref = (c: any) => siteByClient[String(c.id)] ? `/crm.html?client=${siteByClient[String(c.id)]}` : `/crm.html?client_id=${c.id}`;
    for (const c of matchedCustomers) results.push({ kind: 'customer', label: String(c.name || c.email || 'Customer'), sub: 'Customer', href: recordHref(c) });
    for (const c of arr(contacts)) results.push({ kind: 'contact', label: String(c.name || c.email || 'Contact'), sub: 'Contact' + (c.company ? ' · ' + String(c.company) : ''), href: `/crm.html?contact=${c.id}&tab=details` });
    for (const d of arr(deals)) results.push({ kind: 'deal', label: String(d.title || 'Deal'), sub: 'Deal' + (d.stage ? ' · ' + String(d.stage) : ''), href: `/crm.html?deal=${d.id}&tab=deal` });
    for (const v of arr(invoices)) results.push({ kind: 'invoice', label: `${String(v.title || 'Invoice')} — $${Math.round((Number(v.amount_cents) || 0) / 100).toLocaleString('en-US')}`, sub: 'Invoice · ' + (v.status === 'open' ? 'awaiting payment' : String(v.status || '')), href: v.deal_id ? `/crm.html?deal=${v.deal_id}&tab=billing` : '/pipeline.html' });
    for (const p of arr(projects)) results.push({ kind: 'project', label: String(p.name || 'Project'), sub: 'Project', href: `/crm.html?project=${p.id}&tab=delivery` });
    if (moneyWord) results.push({ kind: 'page', label: 'Who owes you', sub: 'Pipeline · outstanding invoices', href: '/pipeline.html#receivables' });
    // actions on the matched customers (the ones with a record to land on)
    for (const c of matchedCustomers.slice(0, 2)) {
      const name = String(c.name || c.email || 'them');
      results.push({ kind: 'action', label: `Send invoice to ${name}`, sub: 'Action', href: `${recordHref(c)}&tab=billing&act=invoice` });
      results.push({ kind: 'action', label: `Message ${name}`, sub: 'Action', href: `${recordHref(c)}&tab=details&act=message` });
    }
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
  try {
    const rs = await relationshipScope(jwt, site, principal);
    const conv = await collectClientConversation(new URL(req.url), rs);
    return json({ data: { items: conv.items, project_id: conv.projectId || null, reply_to: conv.projectId ? `/projects/${conv.projectId}/messages` : null, reply_support_to: conv.replySupportTo } }, 200, cors);
  } catch (_e) {
    return json({ error: 'read_failed', message: 'We couldn’t load this conversation just now.' }, 502, cors);
  }
}

// ── Whose relationship is this? (final pass, Nov 8 2026: F1 + S3) ────────────
// Two bugs had one cause. (1) "Scoped to a customer's own site" was decided by
// site.client_id — and the studio's OWN site has one too, so opening the record
// from a deal or a contact resolved the studio itself and the page said "You
// don't have access to that client". (2) ?project= followed that project's link
// to whichever studio owned it, so its messages, support thread and deal notes
// were read (and its support rows stamped) on another studio's site. Now:
//   scoped (index.ts authorised an x-dds-scope-site drill-in): the customer is
//     that site; the relationship lives on the caller's OWN studio site — links
//     from any other studio are never followed.
//   not scoped: `site` IS the caller's studio site; a ?client_id or ?project
//     only counts when it belongs to that site (deals and contacts are read with
//     site_id = that site already).
interface RelScope { scoped: boolean; studioSiteId: string; customerClientId: string; customerSiteId: string; links: Array<{ project_id: string; agency_site_id: string }> }
async function callerOwnSiteId(jwt: string, principal: Principal): Promise<string> {
  try { const s = await resolveSite(jwt); if (s?.id) return String(s.id); } catch { /* try the seat */ }
  try { const m = await resolveMemberSite(principal as any); if (m?.site?.id) return String(m.site.id); } catch { /* none */ }
  return '';
}
async function relationshipScope(jwt: string, site: SiteRow, principal: Principal): Promise<RelScope> {
  const scoped = !!principal.scope && principal.scope.site_id === site.id;
  if (!scoped) return { scoped: false, studioSiteId: site.id, customerClientId: '', customerSiteId: '', links: [] };
  const customerClientId = site.client_id ? String(site.client_id) : '';
  const own = await callerOwnSiteId(jwt, principal);
  const links = customerClientId && own ? (await linksForCustomer(customerClientId)).filter((l) => String(l.agency_site_id) === own) : [];
  return { scoped: true, studioSiteId: own, customerClientId, customerSiteId: String(site.id), links };
}
/** Unscoped: a customer id only counts when it is this studio's — an active
 *  link from this site, or a deal on this site that became them. */
async function customerOfThisStudio(studioSiteId: string, clientId: string): Promise<{ ok: boolean; customerSiteId: string }> {
  if (!studioSiteId || !UUID_RE.test(clientId)) return { ok: false, customerSiteId: '' };
  const lk = one(await svc(`presence_service_links?agency_site_id=eq.${studioSiteId}&customer_client_id=eq.${clientId}&status=eq.active&select=customer_site_id&order=created_at.desc&limit=1`));
  if (lk) return { ok: true, customerSiteId: String(lk.customer_site_id || '') };
  const d = one(await svc(`presence_deals?site_id=eq.${studioSiteId}&converted_client_id=eq.${clientId}&deleted_at=is.null&select=converted_site_id&limit=1`));
  return d ? { ok: true, customerSiteId: String(d.converted_site_id || '') } : { ok: false, customerSiteId: '' };
}

/** The one conversation collector both /crm/messages and /crm/activity share:
 *  resolves the identity keys, then reads every channel best-effort and returns
 *  the raw chronological (asc) items + the resolved ids + the reply targets.
 *  Every capped read fetches created_at.DESC (so past the cap the NEWEST rows
 *  survive, matching the newest-first product contract) and reverses in memory
 *  — under the cap the output is byte-identical to the old asc reads. The deal
 *  row + deal-event window it fetched ride along in the return so /crm/activity
 *  reuses the SAME window instead of re-querying a different one. */
async function collectClientConversation(u: URL, rs: RelScope): Promise<{
  items: any[]; projectId: string; clientId: string; dealId: string; agencySiteId: string; replySupportTo: string | null;
  deal: any | null; dealEvents: any[];
}> {
  const qp = (k: string) => { const v = u.searchParams.get(k) || ''; return UUID_RE.test(v) ? v : ''; };
  let projectId = qp('project');
  let clientId = '';
  let dealId = qp('deal_id') || qp('deal');
  const AS = rs.studioSiteId;   // the caller's own studio site — never another studio's (S3)
  if (!AS) return { items: [], projectId: '', clientId: '', dealId: '', agencySiteId: '', replySupportTo: null, deal: null, dealEvents: [] };
  // Final pass (Nov 8, batch B): the reads go in four rounds, side by side
  // within each — who this is → the relationship's ids → every channel → the
  // support replies and broadcast subjects — instead of fifteen-plus one after
  // another (and one read per support request). Items are still pushed channel
  // by channel in the same order and sorted by time at the end, so the
  // conversation reads exactly as before.
  if (rs.scoped) {
    clientId = rs.customerClientId;
    if (!projectId && rs.links[0]) projectId = String(rs.links[0].project_id || '');
  }
  const asked = rs.scoped ? '' : qp('client_id');
  // round 1 — the customer asked for, and the project's customer (only this studio's projects, and, scoped, this customer's)
  const [askedOk, lk] = await Promise.all([
    asked ? customerOfThisStudio(AS, asked).then((x) => x.ok) : Promise.resolve(false),
    projectId ? svc(`presence_service_links?project_id=eq.${projectId}&agency_site_id=eq.${AS}&status=eq.active${rs.scoped && clientId ? `&customer_client_id=eq.${clientId}` : ''}&select=customer_client_id&limit=1`).then(one) : Promise.resolve(null),
  ]);
  if (askedOk) clientId = asked;
  if (projectId) { if (lk) { if (!clientId) clientId = String(lk.customer_client_id || ''); } else projectId = ''; }

  {
    // round 2 — every project on this relationship, the deal, the customer's
    // identity keys, and the heal that stamps their old unstamped requests (it
    // must land before round 3's stamped read; sales review B2)
    // the deal anchors the enquiry + logged-activity channels; the row also
    // feeds /crm/activity's highlights/upcoming (stage/next_step — tolerant
    // select: those columns land with migration 0089)
    const readDeal = async (): Promise<any> => {
      if (!dealId && clientId) {
        let r = await svc(`presence_deals?converted_client_id=eq.${clientId}&site_id=eq.${AS}&deleted_at=is.null&select=id,stage,next_step,next_step_at,source_submission_id&order=updated_at.desc&limit=1`);
        if (!one(r)) r = await svc(`presence_deals?converted_client_id=eq.${clientId}&site_id=eq.${AS}&deleted_at=is.null&select=id,stage,source_submission_id&order=updated_at.desc&limit=1`);
        return one(r) || null;
      }
      if (dealId) {
        let r = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${AS}&deleted_at=is.null&select=id,stage,next_step,next_step_at,source_submission_id&limit=1`);
        if (!one(r)) r = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${AS}&deleted_at=is.null&select=id,stage,source_submission_id&limit=1`);
        return one(r) || null;
      }
      return null;
    };
    const [links, dealRow, ident] = await Promise.all([
      clientId ? linksForCustomer(clientId).catch(() => [] as any[]) : Promise.resolve([] as any[]),   // additive
      readDeal(),
      clientId ? customerRequesterKeys(AS, clientId) : Promise.resolve({ keys: [] as string[], emails: [] as string[] }),
      clientId ? healUnstampedSupport(AS) : Promise.resolve(),
    ]);
    // every project on this relationship — a multi-project client loses nothing
    const projectIds: string[] = projectId ? [projectId] : [];
    for (const l of links) { if (String(l.agency_site_id) !== AS) continue; const p = String(l.project_id || ''); if (p && !projectIds.includes(p)) projectIds.push(p); }
    // A client_id-only call (the Inbox reading pane) still deserves a reply
    // target: adopt the first active bridge link's project as the top-level
    // projectId so reply_to resolves. A caller that DID pass ?project= is untouched.
    if (!projectId && projectIds.length) projectId = projectIds[0];
    let srcSub = '';
    if (dealRow) { if (!dealId) dealId = String(dealRow.id); srcSub = String(dealRow.source_submission_id || ''); }

    // round 3 — every channel at once. The capped reads fetch created_at.DESC (so
    // past the cap the NEWEST rows survive) and are reversed below. Best-effort
    // channels answer null on failure and are left out, as before.
    const em = ident.emails.map((e) => encodeURIComponent(`"${e.replace(/"/g, '')}"`)).join(',');
    const [msgs, supByProject, supByClient, supByKeys, enquiry, bookings, dealEventRows, sends] = await Promise.all([
      projectIds.length ? svc(`presence_project_messages?project_id=in.(${projectIds.join(',')})&site_id=eq.${AS}&deleted_at=is.null&select=id,project_id,audience,body,author_kind,created_at&order=created_at.desc&limit=300`).then(arr) : Promise.resolve([] as any[]),
      projectIds.length ? svc(`presence_support_requests?site_id=eq.${AS}&project_id=in.(${projectIds.join(',')})&deleted_at=is.null&select=id,subject,body,status,requester_kind,created_at&order=created_at.desc&limit=100`).then(arr) : Promise.resolve([] as any[]),
      // F3: PREFER the write-time client_id stamp (0115) — a stamped project-less
      // ticket ties to this record even when its requester key matches none of
      // the derived identity keys. Additive: pre-0115 the filter 400s → [].
      clientId ? svc(`presence_support_requests?site_id=eq.${AS}&project_id=is.null&client_id=eq.${clientId}&deleted_at=is.null&select=id,subject,body,status,requester_kind,created_at&order=created_at.desc&limit=100`).then(arr).catch(() => [] as any[]) : Promise.resolve([] as any[]),
      ident.keys.length ? svc(`presence_support_requests?site_id=eq.${AS}&project_id=is.null&deleted_at=is.null&requester=in.(${ident.keys.join(',')})&select=id,subject,body,status,requester_kind,created_at&order=created_at.desc&limit=100`).then(arr) : Promise.resolve([] as any[]),
      // the original website enquiry that started the relationship
      srcSub ? svc(`presence_form_submissions?id=eq.${srcSub}&site_id=eq.${AS}&select=id,form_kind,message,created_at&limit=1`).then(one).catch(() => null) : Promise.resolve(null),
      // bookings with the studio (matched on the client's email identity)
      ident.emails.length ? svc(`presence_appointments?site_id=eq.${AS}&customer_email=in.(${em})&select=id,type_name,slot_start_local,slot_start,note,status,created_at&order=created_at.desc&limit=50`).then(arr).catch(() => null) : Promise.resolve([] as any[]),
      // logged calls/emails/meetings + sent-document stamps (the deal quick-log).
      // ONE 200-row window feeds BOTH this conversation channel and
      // /crm/activity's system events — two windows would dedupe apart.
      dealId ? svc(`presence_deal_events?deal_id=eq.${dealId}&site_id=eq.${AS}&select=id,kind,from_stage,to_stage,detail,actor,created_at&order=created_at.desc&limit=200`).then(arr).catch(() => null) : Promise.resolve([] as any[]),
      // email broadcasts this client actually received — and (item 69) whether they
      // opened each; before APPLY-0144 there is no opened_at, so read without it
      ident.emails.length ? svc(`presence_broadcast_sends?site_id=eq.${AS}&status=eq.sent&email=in.(${em})&select=broadcast_id,created_at,opened_at&order=created_at.desc&limit=50`)
        .then((r) => r.ok ? arr(r) : svc(`presence_broadcast_sends?site_id=eq.${AS}&status=eq.sent&email=in.(${em})&select=broadcast_id,created_at&order=created_at.desc&limit=50`).then(arr)).catch(() => null) : Promise.resolve([] as any[]),
    ]);
    // newest open wins — computed across the UNION (project-scoped + project-less)
    // sorted by created_at, so an older project-less ticket can never outrank a
    // newer project-scoped one.
    const sup: any[] = [];
    const seen = new Set<string>();
    const addSup = (rows_: any[]) => { for (const s of rows_) { if (!seen.has(String(s.id))) { seen.add(String(s.id)); sup.push(s); } } };
    addSup([...supByProject].reverse()); addSup([...supByClient].reverse()); addSup([...supByKeys].reverse());
    const openSup = sup.filter((s) => s.status !== 'resolved' && s.status !== 'closed')
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const replySupportTo: string | null = openSup.length ? `/support/${openSup[openSup.length - 1].id}/messages` : null;

    // round 4 — every request's replies in ONE read (newest 200 per request, as
    // before), and the subjects of the broadcasts they received
    const supIds = sup.map((x) => String(x.id)).filter((x) => UUID_RE.test(x));
    const bIds = [...new Set((sends || []).map((x: any) => String(x.broadcast_id)).filter((x: string) => UUID_RE.test(x)))];
    const [replies, broadcasts] = await Promise.all([
      supIds.length ? svc(`presence_support_messages?request_id=in.(${supIds.join(',')})&site_id=eq.${AS}&deleted_at=is.null&select=id,request_id,body,author_kind,created_at&order=created_at.desc&limit=${Math.min(200 * supIds.length, 4000)}`).then(arr) : Promise.resolve([] as any[]),
      bIds.length ? svc(`presence_broadcasts?id=in.(${bIds.join(',')})&select=id,subject&limit=50`).then(arr).catch(() => [] as any[]) : Promise.resolve([] as any[]),
    ]);
    const repliesOf = new Map<string, any[]>();
    for (const r of replies) { const k = String(r.request_id); const a = repliesOf.get(k) || []; if (a.length < 200) { a.push(r); repliesOf.set(k, a); } }

    const items: any[] = [];
    for (const m of [...msgs].reverse()) {
      if (m.audience === 'internal') continue;   // internal notes aren't part of the client conversation
      items.push({ id: m.id, kind: 'message', project_id: m.project_id, from: isClientKind(m.author_kind) ? 'client' : 'studio', body: String(m.body || ''), created_at: m.created_at });
    }
    for (const x of sup) {
      items.push({ id: x.id, kind: 'support', support_id: x.id, subject: String(x.subject || 'Support request'), status: x.status, from: 'client', body: String(x.body || ''), created_at: x.created_at });
      for (const r of [...(repliesOf.get(String(x.id)) || [])].reverse()) {
        items.push({ id: r.id, kind: 'support_reply', support_id: x.id, from: isClientKind(r.author_kind) ? 'client' : 'studio', body: String(r.body || ''), created_at: r.created_at });
      }
    }
    if (enquiry) items.push({ id: enquiry.id, kind: 'enquiry', from: 'client', subject: 'Website enquiry', body: String(enquiry.message || ''), created_at: enquiry.created_at });
    for (const a of [...(bookings || [])].reverse()) {
      if (a.status === 'canceled') continue;
      const when = String(a.slot_start_local || '').replace('T', ' ') || String(a.slot_start || '').slice(0, 16).replace('T', ' ');
      items.push({ id: a.id, kind: 'booking', from: 'client', subject: `Booked: ${String(a.type_name || 'a call')}${when ? ` · ${when}` : ''}`, body: String(a.note || ''), created_at: a.created_at });
    }
    const dealEvents: any[] = [...(dealEventRows || [])].reverse();
    const SYS = ['proposal_sent', 'contract_sent', 'invoice_sent'];
    for (const ev of dealEvents) {
      const d = (ev.detail && typeof ev.detail === 'object') ? ev.detail : {};
      if (ev.kind === 'note' && ['call', 'email', 'meeting', 'note'].includes(String(d.activity_kind))) {
        items.push({ id: ev.id, kind: 'activity', activity_kind: String(d.activity_kind), from: 'studio', body: String(d.body || ''), created_at: String(d.occurred_at || ev.created_at) });
      } else if (SYS.includes(String(ev.kind))) {
        items.push({ id: ev.id, kind: 'activity', activity_kind: String(ev.kind), from: 'studio', body: '', created_at: ev.created_at });
      }
    }
    if (sends) {
      const subj = new Map<string, string>(broadcasts.map((b: any) => [String(b.id), String(b.subject || 'A studio update')]));
      for (const x of [...sends].reverse()) items.push({ id: `${x.broadcast_id}:${x.created_at}`, kind: 'broadcast', from: 'studio', subject: subj.get(String(x.broadcast_id)) || 'A studio update', body: '', created_at: x.created_at, opened: !!x.opened_at });
    }
    items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return { items, projectId, clientId, dealId, agencySiteId: AS, replySupportTo, deal: dealRow, dealEvents };
  }
}

/** ── /crm/activity — the record page's ONE timeline (Salesforce anatomy) ─────
 *  Read-time merge under one contract: every conversation channel /crm/messages
 *  reads today PLUS the deal's system events, completed to-dos, and (for a
 *  customer-scoped record) the site-ops timeline /crm/timeline serves. Also
 *  derives the "Upcoming & Overdue" band (open deal to-dos + the deal's next
 *  step + unpaid invoices). Same identity keys as /crm/messages (?project= /
 *  ?client_id=) plus optional &deal=. Every added channel stays best-effort —
 *  one failing read omits that channel, never blanks the timeline. The old
 *  routes (/crm/messages, /crm/timeline) stay untouched until the UI is off
 *  them. Studio-side only; no new tables ("one log, derived views"). */
export async function handleCrmActivity(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  // batch B (final pass, Nov 8): whose relationship this is, read beside the studio check
  const rsP = relationshipScope(jwt, site, principal);
  rsP.catch(() => { /* judged inside the try below */ });
  if (!(await isStudioSide(jwt, principal))) return json({ error: 'forbidden', message: 'Only your studio can open a client record.' }, 403, cors);
  try {
    const rs = await rsP;
    const stageNamesP = rs.studioSiteId ? loadStageLabels(rs.studioSiteId).catch(() => null) : Promise.resolve(null);   // item 38 names, kept per site
    // site-ops events (publishes, approvals, notes, connected, moments) — only
    // when scoped to a real customer site (the same gate as the old Overview:
    // un-scoped this would read the operator's OWN site, the crm.html landmine).
    // They need nothing from the conversation, so they start now.
    const siteEventsP: Promise<(ActivityItem | null)[]> = rs.scoped   // F1: only inside a customer's own site — never the studio's own timeline
      ? loadTimeline(site, { includeInternalNotes: true, limit: 60 }).then((tl) => filterTimeline(tl, true).map(mapSiteEvent)).catch(() => [])
      : Promise.resolve([]);
    const conv = await collectClientConversation(new URL(req.url), rs);
    const AS = conv.agencySiteId;
    const dealId = conv.dealId;
    const now = new Date().toISOString();

    // deal extras — each channel best-effort (crm.ts:104 doctrine). The deal row
    // and the deal-event window come FROM the collector: one 200-row window feeds
    // both the conversation items and these system events (two windows would
    // dedupe apart past 200 events), and the deal row isn't fetched twice.
    const deal: any = conv.deal;
    const dealEvents: any[] = conv.dealEvents;
    // batch B: the stage names, the deal's to-dos and its open invoices in one round
    const readInvoices = async (): Promise<any[]> => {
      const invFilter = dealId ? `deal_id=eq.${dealId}` : `customer_client_id=eq.${conv.clientId}`;
      // processing_since lands with migration 0132 (tolerant: pre-0132 shape second)
      let ir = await svc(`presence_invoices?site_id=eq.${AS}&${invFilter}&status=eq.open&deleted_at=is.null&select=id,title,amount_cents,due_date,status,deal_id,processing_since&limit=100`);
      if (!ir.ok) ir = await svc(`presence_invoices?site_id=eq.${AS}&${invFilter}&status=eq.open&deleted_at=is.null&select=id,title,amount_cents,due_date,status,deal_id&limit=100`);
      return arr(ir);
    };
    const [stageNames, tasks, invoices, siteEvents] = await Promise.all([
      dealEvents.length ? stageNamesP : Promise.resolve(null),   // item 38: the studio's own stage names
      dealId ? svc(`presence_deal_tasks?site_id=eq.${AS}&deal_id=eq.${dealId}&deleted_at=is.null&select=id,title,due_date,status,completed_at,created_at&order=due_date.asc.nullslast,created_at.asc&limit=200`).then(arr).catch(() => [] as any[]) : Promise.resolve([] as any[]),
      (dealId || conv.clientId) ? readInvoices().catch(() => [] as any[]) : Promise.resolve([] as any[]),
      siteEventsP,
    ]);

    const items = mergeActivity([
      conv.items.map(mapConversationItem),
      dealEvents.map((e) => { const it = mapDealEvent(e, dealId); return it && stageNames ? { ...it, title: renameMovedTo(it.title, stageNames) } : it; }),   // item 38
      tasks.map((t) => mapDoneTask(t, dealId)),
      siteEvents,
    ]);
    // item 65: the band's "overdue" is judged on the record page's local day (?today=),
    // the UTC day without it; buildUpcoming reads only the day part of what it is given
    const upcoming = buildUpcoming({ tasks, deal, invoices }, callerToday(new URL(req.url).searchParams.get('today'), now));
    return json({ data: {
      upcoming, items,
      project_id: conv.projectId || null, deal_id: dealId || null,
      reply_to: conv.projectId ? `/projects/${conv.projectId}/messages` : null,
      reply_support_to: conv.replySupportTo,
    } }, 200, cors);
  } catch (_e) {
    return json({ error: 'read_failed', message: 'We couldn’t load this record’s activity just now.' }, 502, cors);
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
  // batch B (final pass, Nov 8): whose relationship this is, read beside the studio check
  const rsP = relationshipScope(jwt, site, principal);
  rsP.catch(() => { /* awaited below */ });
  if (!(await isStudioSide(jwt, principal))) return json({ error: 'forbidden', message: 'Only your studio can open a client record.' }, 403, cors);
  const u = new URL(req.url);
  const qp = (k: string) => { const v = u.searchParams.get(k) || ''; return UUID_RE.test(v) ? v : ''; };
  let contactId = qp('contact_id') || qp('contact');
  let dealId = qp('deal_id') || qp('deal');
  let clientId = '';
  let projectId = qp('project_id') || qp('project');
  let customerSiteId = '';

  // Whose relationship this is (F1 + S3): scoped → that customer, on the caller's
  // own studio site; unscoped → the studio site itself, and only its own ids.
  const rs = await rsP;
  const AS = rs.studioSiteId;
  if (rs.scoped) {
    clientId = rs.customerClientId; customerSiteId = rs.customerSiteId;
    if (!projectId && rs.links[0]) projectId = String(rs.links[0].project_id || '');
  } else {
    const asked = qp('client_id');
    if (asked) { const own = await customerOfThisStudio(AS, asked); if (own.ok) { clientId = asked; customerSiteId = own.customerSiteId; } }
  }

  try {
    // project → bridge → client (+ deal), only for this studio's projects (and, scoped, this customer's)
    if (projectId) {
      const lk = AS ? one(await svc(`presence_service_links?project_id=eq.${projectId}&agency_site_id=eq.${AS}&status=eq.active${rs.scoped && clientId ? `&customer_client_id=eq.${clientId}` : ''}&select=customer_client_id,customer_site_id,deal_id&limit=1`)) : null;
      if (lk) { if (!clientId) clientId = String(lk.customer_client_id || ''); customerSiteId = customerSiteId || String(lk.customer_site_id || ''); if (!dealId && lk.deal_id) dealId = String(lk.deal_id); }
      else projectId = '';
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

    // batch B (final pass, Nov 8): once the ids are known, the header, the
    // highlights and both related lists only need them — one round, side by
    // side (they were seven reads one after another). Each part stays
    // best-effort exactly as before.
    // ── Header (best-effort; the Overview tab fetches rich health separately) ──
    const headerP = (async (): Promise<Record<string, unknown>> => {
      let header: Record<string, unknown> = { name: '', company: '', email: '', phone: '', status: '' };
      // the contact is read beside the client and used only when the client gives no name
      const [c, ct] = await Promise.all([
        clientId ? svc(`clients?id=eq.${clientId}&select=name,email,contact_email&limit=1`).then(one) : Promise.resolve(null),
        // item 69: found_via rides along; before APPLY-0143 the same read without it.
        // item 89: and the job title, second phone, address and tags (APPLY-0166) before both
        contactId ? svc(`presence_contacts?id=eq.${contactId}&site_id=eq.${AS}&select=name,company,email,phone,found_via,${CONTACT_MORE_COLS.join(',')}&limit=1`)
          .then((r) => r.ok ? r : svc(`presence_contacts?id=eq.${contactId}&site_id=eq.${AS}&select=name,company,email,phone,found_via&limit=1`))
          .then((r) => r.ok ? r : svc(`presence_contacts?id=eq.${contactId}&site_id=eq.${AS}&select=name,company,email,phone&limit=1`)).then(one) : Promise.resolve(null),
      ]);
      if (c) header = { name: c.name || c.email || 'Client', company: '', email: c.email || c.contact_email || '', phone: '', status: 'customer' };
      // item 22 (second half) + item 49: lead with the business, name the person
      // beside it — the record's own contact first, else the won deal's
      if (c) {
        try {
          const nm = (await loadCustomerNames(AS, [{ clientId, clientName: c.name, customerSiteId: customerSiteId || null, contactId: contactId || null }], (path) => svc(path).then((r) => arr(r))))[clientId];
          if (nm) header = { ...header, name: nm.name || header.name, company: nm.business_name, person: nm.person_name, phone: nm.phone || '' };
        } catch { /* the plain header stands */ }
      }
      if (contactId && !header.name && ct) header = { name: ct.name || ct.email || 'Contact', company: ct.company || '', email: ct.email || '', phone: ct.phone || '', status: 'contact' };
      if (ct && ct.found_via) header = { ...header, found_via: String(ct.found_via) };   // item 69: "How did they find you?"
      // item 89: what the person's contact holds beside name, email and phone
      if (ct) {
        const more: Record<string, unknown> = {};
        if (ct.job_title) more.job_title = String(ct.job_title);
        if (ct.phone2) more.phone2 = String(ct.phone2);
        if (!header.phone && ct.phone) more.phone = String(ct.phone);
        const line = addressLine(ct.address); if (line) more.address = line;
        if (Array.isArray(ct.tags) && ct.tags.length) more.tags = ct.tags.map(String);
        header = { ...header, ...more };
      }
      return header;
    })();

    // overview (the relationship health view) reads /crm/profile, which is only
    // SAFE when we can scope to a real customer site — otherwise it would run
    // against the operator's own site (the old crm.html landmine). Gate on the site.
    // messages = the ONE conversation with this client (project msgs + support), shown
    // whenever we can tie the record to a project or a customer.
    // highlights — the pinned key facts (Salesforce highlights panel): deal value +
    // stage + next step, and total owed. Cheap, best-effort; never blocks the record.
    const highlightsP = (async (): Promise<Record<string, unknown>> => {
      const highlights: Record<string, unknown> = {};
      try {
        const invFilter = dealId ? `deal_id=eq.${dealId}` : `customer_client_id=eq.${clientId}`;
        const [dv, inv] = await Promise.all([
          dealId ? svc(`presence_deals?id=eq.${dealId}&site_id=eq.${AS}&select=stage,expected_value_cents,next_step&limit=1`).then(one) : Promise.resolve(null),
          (dealId || clientId) ? svc(`presence_invoices?site_id=eq.${AS}&${invFilter}&status=eq.open&deleted_at=is.null&select=amount_cents&limit=100`).then(arr) : Promise.resolve([] as any[]),
        ]);
        if (dv) { if (dv.expected_value_cents) highlights.value_cents = Number(dv.expected_value_cents) || 0; if (dv.stage) highlights.stage = String(dv.stage); if (dv.next_step) highlights.next_step = String(dv.next_step); }
        const owed = inv.reduce((a: number, i: any) => a + (Number(i.amount_cents) || 0), 0);
        if (owed) highlights.owed_cents = owed;
      } catch { /* highlights are additive — never block the record */ }
      return highlights;
    })();

    // Sales review item 26 (Nov 2026): a repeat customer's projects as a list —
    // the record opened one project, so a second (or an archived first) showed
    // nowhere but the ⌘K palette. Every project actively bridged to this customer
    // on this studio's site (status=eq.active, the bridge's access convention),
    // newest first. Additive and best-effort.
    const relatedProjectsP = (async (): Promise<Array<{ id: string; name: string; status: string }>> => {
      try {
        if (!clientId) return [];
        const pids = [...new Set(arr(await svc(`presence_service_links?customer_client_id=eq.${clientId}&agency_site_id=eq.${AS}&status=eq.active&select=project_id&limit=50`)).map((l) => String(l.project_id || '')).filter((x) => UUID_RE.test(x)))];
        if (!pids.length) return [];
        return arr(await svc(`presence_projects?id=in.(${pids.join(',')})&site_id=eq.${AS}&deleted_at=is.null&select=id,name,status,created_at&order=created_at.desc&limit=50`))
          .map((p) => ({ id: String(p.id), name: String(p.name || 'Project'), status: String(p.status || 'active') }));
      } catch { return []; }
    })();
    // …and the same for deals: every deal that became this customer (a second
    // site, a retainer after a build), newest first.
    const relatedDealsP = (async (): Promise<Array<{ id: string; title: string; stage: string; value_cents: number }>> => {
      try {
        if (!clientId) return [];
        return arr(await svc(`presence_deals?converted_client_id=eq.${clientId}&site_id=eq.${AS}&deleted_at=is.null&select=id,title,stage,expected_value_cents,updated_at&order=updated_at.desc&limit=50`))
          .map((d) => ({ id: String(d.id), title: String(d.title || 'Deal'), stage: String(d.stage || 'lead'), value_cents: Number(d.expected_value_cents) || 0 }));
      } catch { return []; }
    })();
    const [header, highlights, related_projects, related_deals] = await Promise.all([headerP, highlightsP, relatedProjectsP, relatedDealsP]);

    const sections = { overview: !!customerSiteId, messages: !!(projectId || clientId), deal: !!dealId, delivery: !!projectId, details: !!contactId };
    const default_tab = projectId ? 'delivery' : (dealId ? 'deal' : (customerSiteId ? 'overview' : 'details'));
    // canonical addressing: the most-stable key that exists (customer site → deal → contact)
    const canonical = customerSiteId ? { key: 'client', value: customerSiteId } : (dealId ? { key: 'deal', value: dealId } : { key: 'contact', value: contactId });

    return json({ data: {
      identity: { contact_id: contactId || null, deal_id: dealId || null, client_id: clientId || null, customer_site_id: customerSiteId || null, project_id: projectId || null },
      header, highlights, sections, default_tab, canonical, related_projects, related_deals,
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
  // W3: Pipeline/Project doorways, studio-side only — and only inside a customer's site (F1)
  const rs = studio ? await relationshipScope(jwt, site, principal) : null;
  const context = rs && rs.scoped ? await crmContext(site, rs.studioSiteId) : {};
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
