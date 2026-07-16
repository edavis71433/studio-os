// ── /portal/* — A7 workspace context, members, and client-visibility shares ──
// context: any signed-in caller learns their site-role + capabilities (so the UI
// can present the business-owner workspace vs the simpler client portal).
// members + shares: managing them requires the owner (or the operator) — a
// client_reviewer can never manage members or change what's shared.
//   GET  /portal/context                 — { site_role, capabilities, sees_full_workspace }
//   GET  /portal/members                 — list (owner/operator)
//   POST /portal/members                 — { email, role } add/update (owner/operator)
//   POST /portal/members/:id/revoke      — revoke (owner/operator)
//   GET  /portal/shares                  — current overrides (owner/operator)
//   POST /portal/shares                  — { surface, item_id?, shared } set (owner/operator)
import { json } from '../../_shared/http.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { capabilitiesOf, siteCan } from '../lib/site_roles.ts';
import type { SiteRole } from '../lib/site_roles.ts';
import { buildNav, landingFor } from '../lib/navigation.ts';
import { editionFromPlan, editionFromSite, featuresOf, editionFlags, featureDelta, EDITION_DEFS, type EditionKey } from '../commerce/editions.ts';
import { nextPlanUp } from '../commerce/catalog.ts';
import { resolveAgencyMember } from '../agency/auth.ts';
import { filterForRole, visibleTo } from '../lib/visibility.ts';
import { svc, svcCount } from '../lib/db.ts';
import { displayName } from '../lib/dam.ts';
import { resolveSiteRoleCached, listSiteMembers, addSiteMember, revokeSiteMember, loadShares, overrideFor, setShare } from '../lib/workspace.ts';
import { loadThreadMarks, newestClientMessageAt, threadUnread } from '../lib/thread_reads.ts';

/** The ONLY routes a client_reviewer (the client portal audience) may reach.
 *  Everything else in the client gate is 403 for a reviewer — so the simplified
 *  portal is a real security boundary, not a UI facade. Pure + exported for tests.
 *  Reviewer = read the shared feed, and approve the plans put to them. */
export function reviewerAllowed(route: string, method: string): boolean {
  if (method === 'GET' && (route === '/portal/context' || route === '/portal/feed')) return true;
  // NOTE (P2-D hardening): the customer's service-delivery view is NOT reached as a
  // client_reviewer on the agency site — it is served through the Agency–Client
  // Bridge under /client/* on the customer's OWN site (they are its owner, so they
  // pass this boundary normally). Reviewer P2-D delivery access was removed to
  // eliminate the site-wide `client_visible` path that could expose one client's
  // records to another reviewer on a shared site. /client/* is bridge-scoped.
  if (method === 'POST' && /^\/foundations\/plans\/[0-9a-f-]{36}\/decide$/.test(route)) return true;   // approve an infra plan
  if (method === 'POST' && /^\/connections\/[a-z0-9_]+\/write\/[0-9a-f-]{36}\/decide$/.test(route)) return true; // approve a connected write
  if (method === 'POST' && /^\/assets\/[0-9a-f-]{36}\/status$/.test(route)) return true; // DAM-2: approve/reject a file (action-restricted in the handler)
  if (method === 'POST' && /^\/launches\/[0-9a-f-]{36}\/decide$/.test(route)) return true; // FD-T7: approve/reject a staged launch
  return false;
}

async function requireManager(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<{ role: SiteRole } | Response> {
  const role = await resolveSiteRoleCached(principal, jwt, site.id);
  // Managing PEOPLE (members + what clients see) is the 'invite' capability
  // alone. 'configure' is settings power, deliberately NOT people power — a
  // developer can configure the site but must never add members or reshape
  // client visibility (matches the capability table's own comment).
  if (!siteCan(role, 'invite')) {
    return json({ error: 'forbidden', message: 'Only the account owner can manage who sees what.' }, 403, cors);
  }
  return { role };
}

export async function handlePortalContext(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>, scopedName?: string | null) {
  const role = await resolveSiteRoleCached(principal, jwt, site.id);
  const isOperator = principal.kind === 'staff' || principal.kind === 'system';
  const caps = capabilitiesOf(role);
  const seesFull = siteCan(role, 'view_all');
  const showApprovals = visibleTo(role, 'approvals');
  const reader = String(principal.userId || principal.email || 'anon'); // same key /notifications(/read) uses

  // ONE concurrent wave for every independent read on this boot path — agency
  // membership, the bridged-customer links, the entitlement plan, and BOTH
  // attention (bell badge) waves that used to run serially. The predicates are
  // unchanged: a caller without the capability never fires the studio-only
  // reads — their slot resolves to the empty shape ('none') instead. Every
  // best-effort slot swallows its own failure so one bad read never costs the
  // others (same net effect as the old per-block try/catch).
  const none = Promise.resolve({ ok: true, json: [] as any[] });
  const swallow = () => ({ ok: false, json: null as any });
  const [agencyMember, linksQ, ent, nQ, iQ, wQ, fQ, eQ, supQ, seenQ, msgQ, cmQ] = await Promise.all([
    // agency membership drives the Agency nav section (reviewers never need it)
    role !== 'client_reviewer' ? resolveAgencyMember(jwt).catch(() => null) : Promise.resolve(null),
    // Bridged-customer links (see isManagedClient below). Fired without waiting on
    // the agency lookup — the old !isAgency guard moved to the CONSUMER, so an
    // agency operator's result is simply discarded, never acted on.
    site.client_id && !isOperator && !scopedName
      ? svc(`presence_service_links?customer_client_id=eq.${site.client_id}&status=eq.active&select=project_id,agency_site_id&limit=50`).then((r) => ((r.json as any[]) || [])).catch(() => null)
      : Promise.resolve(null),
    // Phase D: the licensed plan (shared per-request memo — the boundary gate already read this row)
    site.client_id
      ? import('../middleware/entitlement.ts').then((m) => m.entitlementFor(principal, site.client_id)).catch(() => null)
      : Promise.resolve(null),
    // Phase FLOW: active notices (owner surfaces only; bounded — the badge caps out anyway)
    seesFull ? svc(`presence_plan_notices?site_id=eq.${site.id}&status=eq.active&select=id,kind&limit=100`).catch(swallow) : none,
    // proposed plans/writes are pure counts — HEAD + count=exact, flat cost at any size
    showApprovals ? svcCount(`presence_infra_plans?site_id=eq.${site.id}&status=eq.proposed`) : Promise.resolve(0),
    showApprovals ? svcCount(`presence_connection_writes?site_id=eq.${site.id}&status=eq.proposed`) : Promise.resolve(0),
    showApprovals ? svc(`presence_media?site_id=eq.${site.id}&asset_status=eq.pending&deleted_at=is.null&select=id,metadata`).catch(swallow) : none, // DAM-2: files awaiting approval
    // FIX 1: brand-new website enquiries must ring the bell too (owner surfaces only).
    seesFull ? svc(`presence_form_submissions?site_id=eq.${site.id}&spam=eq.false&status=eq.new&select=id&limit=50`).catch(swallow) : none,
    // P2-D (studio side): open support requests + unread client messages need triage
    seesFull ? svc(`presence_support_requests?site_id=eq.${site.id}&status=in.(open,in_progress)&deleted_at=is.null&select=id&limit=50`).catch(swallow) : none,
    seesFull ? svc(`presence_activity_reads?site_id=eq.${site.id}&reader=eq.${encodeURIComponent(reader)}&select=last_seen_at&limit=1`).catch(swallow) : none,
    // FD-N: a client's message — AND their approval decisions / survey answers —
    // must reach the bell/Today, not only the Inbox.
    seesFull ? svc(`presence_project_events?site_id=eq.${site.id}&kind=in.(message,approval_decided,survey_submitted)&select=created_at,kind,detail,actor_kind&order=created_at.desc&limit=50`).catch(swallow) : none,
    // G11: open client feedback on the shared draft — one HEAD count (owner
    // surfaces only; null on any failure, incl. a database without 0112 yet).
    seesFull ? svcCount(`presence_section_comments?site_id=eq.${site.id}&author_kind=eq.client&status=eq.open&deleted_at=is.null`) : Promise.resolve(0),
  ]);
  const isAgency = !!agencyMember;

  // Bridged-customer detection (presentation only): the signed-in user is an
  // agency's CLIENT signed into their OWN site (converted from a deal → provisioned
  // as its business_owner). They must get the calm CLIENT experience (client.html),
  // NOT the operator workspace. Signal: site.client_id set AND ≥1 ACTIVE
  // service_link keyed by THIS customer (customer_client_id) — the CUSTOMER side of
  // the bridge. Guarded so an agency operator who scope-switched INTO this customer
  // (isAgency / isOperator / scopedName) KEEPS the operator tools, and a plain
  // studio owner (no customer-side link) is never mistaken for a client.
  // The lookup rides the wave above so the attention block below reuses it (no 2nd query).
  const customerLinks: any[] | null = isAgency ? null : linksQ;
  const isManagedClient = !!(customerLinks && customerLinks.length > 0);

  // Phase D: resolve the FEATURE edition from the licensed plan (falls back to
  // the site edition when no entitlement plan is recorded). Navigation adapts to
  // it automatically — one nav, many editions. Never throws on missing rows.
  let editionKey: EditionKey = editionFromSite(site.edition, { isAgency });
  let planKey: string | null = null;
  const plan = ent?.plan;
  if (plan) { planKey = String(plan); editionKey = editionFromPlan(planKey); }

  // Phase P: the honest upsell — the next self-serve rung + what it GAINS (from
  // featureDelta, so it can never overpromise). Shown only to owners (never to
  // client reviewers or operators); null at the top of the ladder = no card.
  let upsell: { plan_key: string; name: string; tagline: string; monthly: number | null; gains: string[]; gives_up: string[] } | null = null;
  if (planKey && role === 'business_owner' && !isOperator) {
    const next = nextPlanUp(planKey);
    if (next) {
      const delta = featureDelta(editionKey, editionFromPlan(next.key));
      // HONEST both ways: if the "next rung" would switch anything OFF (e.g.
      // Monitor → CMS loses Moments/Connections/AI), the card must say so —
      // an upsell that silently removes what they use is a trust-killer.
      upsell = { plan_key: next.key, name: next.name, tagline: next.tagline || '', monthly: next.monthly, gains: delta.gained.slice(0, 4), gives_up: delta.lost.slice(0, 4) };
    }
  }

  // Phase FLOW: one "needs you" count powers the shell bell badge on EVERY page,
  // so the owner sees there's something waiting without clicking into the portal.
  // All the reads already landed in the wave above; best-effort so the shell
  // never breaks on it.
  let attention_count = 0;
  try {
    const filesPending = ((fQ.json as any[]) || []).filter((m) => (m.metadata || {}).pending_replace).length;
    // FIX 1 dedupe: the lead-followup cron already raises a per-lead notice for AGED
    // 'new' leads (counted via nQ). Count only the still-fresh new enquiries not yet
    // represented by a follow-up notice, so a single lead never stacks two signals.
    const leadFollowups = ((nQ.json as any[]) || []).filter((n) => n.kind === 'lead_followup').length;
    const newEnquiries = Math.max(0, ((eQ.json as any[])?.length || 0) - leadFollowups);
    attention_count = ((nQ.json as any[])?.length || 0) + (iQ || 0) + (wQ || 0) + filesPending + newEnquiries + (cmQ || 0);
  } catch { /* the badge is best-effort — never block the shell on it */ }

  // P2-D: fold service delivery into the ONE attention surface (no second bell).
  try {
    if (seesFull) { // studio: open support requests + unread client messages need triage
      attention_count += ((supQ.json as any[])?.length || 0);
      const lastSeen = (seenQ.json as any[])?.[0]?.last_seen_at || null;
      attention_count += ((msgQ.json as any[]) || []).filter((e) => {
        if (lastSeen && String(e.created_at) <= String(lastSeen)) return false;
        // detail.from='client' is stamped ONLY by the client door (client_delivery.ts)
        // — actor_kind can't distinguish the customer from the studio owner (both
        // 'client'), and the studio's own decisions must never ring its own bell.
        return (e.detail || {}).from === 'client';
      }).length;
    } else if (site.client_id) { // bridged customer: their UNREAD client-visible delivery activity
      const links = customerLinks ?? (((await svc(`presence_service_links?customer_client_id=eq.${site.client_id}&status=eq.active&select=project_id,agency_site_id&limit=50`)).json as any[]) || []);
      if (links.length) {
        const s = links[0].agency_site_id; const ids = links.filter((l) => l.agency_site_id === s).map((l) => l.project_id);
        const [seen, ev] = await Promise.all([
          svc(`presence_activity_reads?site_id=eq.${s}&reader=eq.${encodeURIComponent('client:' + site.client_id)}&select=last_seen_at&limit=1`),
          ids.length ? svc(`presence_project_events?site_id=eq.${s}&project_id=in.(${ids.join(',')})&client_visible=is.true&select=created_at&order=created_at.desc&limit=50`) : Promise.resolve({ json: [] as any[] }),
        ]);
        const lastSeen = (seen.json as any[])?.[0]?.last_seen_at || null;
        attention_count += ((ev.json as any[]) || []).filter((e) => !lastSeen || String(e.created_at) > String(lastSeen)).length;
      }
    }
  } catch { /* best-effort */ }

  const navCtx = { role, edition: site.edition, capabilities: caps, isAgency, isOperator, editionKey, isManagedClient };
  return json({ data: {
    site_role: role,
    capabilities: caps,
    edition: site.edition,               // 'monitor' | 'presence' (site hosting dimension)
    edition_key: editionKey,             // Phase D: the FEATURE edition (cms_only … enterprise)
    edition_name: EDITION_DEFS[editionKey]?.name || '',
    edition_features: featuresOf(editionKey),
    edition_flags: editionFlags(editionKey),
    plan_key: planKey,                   // Phase P: what they own, by name
    upsell,                              // Phase P: the next rung + honest gains (null at the top)
    is_agency: isAgency,
    is_operator: isOperator,
    is_managed_client: isManagedClient,  // a converted/bridged customer on their OWN site → client experience (client.html), not operator tools
    sees_full_workspace: siteCan(role, 'view_all'),
    is_client_portal: siteCan(role, 'view_shared') && !siteCan(role, 'view_all'),
    landing: landingFor(navCtx),
    scope: scopedName ? { site_id: site.id, name: scopedName } : null,   // SC-1: agency drill-in → the breadcrumb "Studio › {name}"
    attention_count,                     // Phase FLOW: the shell bell badge (notices + pending approvals)
    nav: buildNav(navCtx),               // the ONE navigation source of truth, edition- + entitlement-filtered
  } }, 200, cors);
}

// Phase FLOW: where each notice kind sends the owner when tapped in the bell —
// straight to the page that resolves it, not a generic landing (one fewer hop).
const NOTICE_HREF: Record<string, string> = {
  lead_followup: '/leads.html',
  website_enquiry: '/leads.html',      // FIX 1: a brand-new website enquiry → the leads inbox
  connection_expired: '/connections.html', // FIX 2: a degraded connection → reconnect
  missing_required: '/content-tree.html',  // FIX 4: a section blocking publish → the website map
  deal_signed: '/pipeline.html',   // W1: a client accepted/signed → convert them from Pipeline
  deal_followup: '/pipeline.html', // CRM: a stale deal needs a nudge
  support_aging: '/projects.html', // service edge #3: an aging support request needs a reply (support lives in the project view)
  invoice_paid: '/pipeline.html',  // money landed → the deal it landed on
  publish_failed: '/presence.html#publish',
  site_down: '/presence.html#foundations',   // a confirmed outage → the foundations desk (domain/hosting/health)
  domain_expiry: '/presence.html#business',
  search_setup: '/presence.html#search',
  welcome_back: '/today.html',
  // account/billing notices land where billing can actually be FIXED — the
  // billing card in Settings (presence.html), which every edition's nav carries.
  capacity: '/presence.html#settings', trial_ending: '/presence.html#settings', trial_ended: '/presence.html#settings',
  payment_trouble: '/presence.html#settings', account_lapsed: '/presence.html#settings',
  winddown_reminder: '/presence.html#settings', win_back: '/presence.html#settings', deletion_requested: '/presence.html#settings',
  approval_decided: '/timeline.html',   // a reviewer/client decided something — the story lives on the timeline
  new_booking: '/presence.html#bookings',   // a customer booked online → the Bookings desk (confirm/cancel)
  booking_followup: '/presence.html#bookings', // #164: a past appointment needs marking done / no-show
  booking_reminder: '/presence.html#bookings', // #164: silent send-once ledger (dismissed; never shown) — mapped for completeness
  new_review: '/presence.html#reviews',   // a customer left a review → the Reviews desk (approve/hide/reply)
  client_feedback: '/presence.html#design',   // G11: a client left a note on the shared draft → the builder's Comments panel
  email_auth: '/presence.html#foundations',   // DNS #5: unauthenticated email → the Foundations desk (email/DNS setup)
  apex_drift: '/presence.html#foundations',   // DNS: apex points at the wrong place → Foundations (domain/DNS)
};
export const noticeHref = (k: string): string => NOTICE_HREF[k] || '/today.html';

/** The client portal's read: only what's shared with the reviewer — shared
 *  Business Moments, the site's publish status, and the plans awaiting their OK.
 *  Computed server-side with the visibility model, so it can never over-expose. */
export async function handlePortalFeed(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const role = await resolveSiteRoleCached(principal, jwt, site.id);
  const seesFull = siteCan(role, 'view_all');   // owner surfaces get the notices rail; reviewers don't
  const noEnq = Promise.resolve({ ok: true, json: [] as any[] });
  const swallow = () => ({ ok: false, json: [] as any[] });   // best-effort slots must never sink the whole feed
  // FIX 4: kick off the Content Tree read CONCURRENTLY with the feed's own queries
  // (owner-only, best-effort) so surfacing missing-required content adds no serial
  // latency to this bell hot path. Dynamic import avoids any top-level import cycle.
  const treeP: Promise<any> = seesFull
    ? import('./room.ts').then((m) => m.siteContentTree(site)).catch(() => null)
    : Promise.resolve(null);
  // ONE initial wave: shares + the feed's own queries + every independent
  // owner-only read the sections below consume (bridge links, support requests,
  // message events, agency links). Predicates unchanged — a reviewer never
  // fires the studio-only reads. Only genuinely dependent stages (bridge
  // links → unread reads, projects → clients → contacts) stay sequential.
  const [shares, momQ, pubQ, infraQ, writeQ, noticeQ, fileQ, enqQ, bridgeQ, supR, evR, agencyLinksQ, feedbackQ, marksQ] = await Promise.all([
    loadShares(site.id),
    svc(`presence_moments?site_id=eq.${site.id}&status=eq.active&select=id,headline,summary,moment_type,created_at&order=created_at.desc&limit=10`),
    svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=created_at,completed_at&order=created_at.desc&limit=1`),
    svc(`presence_infra_plans?site_id=eq.${site.id}&status=eq.proposed&select=id,title,summary,risk&limit=10`),
    svc(`presence_connection_writes?site_id=eq.${site.id}&status=eq.proposed&select=id,provider_key,title,summary&limit=10`),
    seesFull ? svc(`presence_plan_notices?site_id=eq.${site.id}&status=eq.active&select=id,kind,headline,body,created_at&order=created_at.desc&limit=10`) : Promise.resolve({ ok: true, json: [] as any[] }),
    svc(`presence_media?site_id=eq.${site.id}&asset_status=eq.pending&deleted_at=is.null&select=id,storage_path,alt_text,metadata&limit=10`), // DAM-2: files awaiting approval
    // FIX 1: brand-new website enquiries (owner surfaces only) — one synthetic feed
    // row so the bell + Inbox surface them like every other needs-you item.
    // Slice 2 widened the select (additive): the same read also feeds the per-lead
    // `enquiries` rows the Inbox list pane renders — never a second query.
    seesFull ? svc(`presence_form_submissions?site_id=eq.${site.id}&spam=eq.false&status=eq.new&select=id,form_kind,name,email,phone,message,status,created_at&order=created_at.desc&limit=50`) : noEnq,
    // bridged-customer links (owner-only; the unread reads that DEPEND on them stay below)
    seesFull && site.client_id ? svc(`presence_service_links?customer_client_id=eq.${site.client_id}&status=eq.active&select=project_id,agency_site_id&limit=50`).catch(swallow) : noEnq,
    // FIX 5 inputs: open support requests + client message events (owner-only, best-effort)
    seesFull ? svc(`presence_support_requests?site_id=eq.${site.id}&status=not.in.(resolved,closed)&deleted_at=is.null&select=id,subject,status,project_id,requester,created_at,updated_at&order=updated_at.desc&limit=25`).catch(swallow) : noEnq,
    // kind=message events carry detail.from ('client'|'studio') — stamped by the
    // client door — so we can tell whose turn it is without the author_kind
    // ambiguity (a solo owner and their customer are both 'client').
    seesFull ? svc(`presence_project_events?site_id=eq.${site.id}&kind=eq.message&select=project_id,detail,created_at&order=created_at.desc&limit=100`).catch(swallow) : noEnq,
    // the Agency–Client Bridge for THIS studio (agency_site_id = my site) — the
    // authoritative "who are my customers" list + project→customer mapping.
    seesFull ? svc(`presence_service_links?agency_site_id=eq.${site.id}&status=eq.active&select=project_id,customer_client_id&limit=200`).catch(swallow) : noEnq,
    // G11: open client feedback on the shared draft (owner-only; one HEAD count;
    // null on any failure — incl. a database without 0112 yet — so no row shows).
    seesFull ? svcCount(`presence_section_comments?site_id=eq.${site.id}&author_kind=eq.client&status=eq.open&deleted_at=is.null`) : Promise.resolve(0),
    // Slice 2: this reader's per-thread read marks (presence_thread_reads, 0113) —
    // powers the Inbox's real unread dots. NULL on a pre-0113 database (deploy-order
    // tolerance): every unread flag below then falls back to the needs-reply heuristic.
    seesFull ? loadThreadMarks(site.id, String(principal.userId || principal.email || 'anon')).catch(() => null) : Promise.resolve(null),
  ]);
  const marks = (marksQ as Record<string, string> | null) || null;
  const markFor = (key: string) => (marks ? (marks[key] ?? null) : null);
  const moments = filterForRole(role, (momQ.ok && momQ.json) || [], (m: any) => ({ surface: 'business_moments', override: overrideFor(shares, 'business_moments', m.id) }));
  // approvals are 'always' visible to the reviewer (they must see what to approve)
  const showApprovals = visibleTo(role, 'approvals');
  const pending = showApprovals ? [
    ...(((infraQ.ok && infraQ.json) || []) as any[]).map((p) => ({ id: p.id, kind: 'infrastructure', title: p.title, summary: p.summary, decide_path: `/foundations/plans/${p.id}/decide` })),
    ...(((writeQ.ok && writeQ.json) || []) as any[]).map((p) => ({ id: p.id, kind: 'connected', provider: p.provider_key, title: p.title, summary: p.summary, decide_path: `/connections/${p.provider_key}/write/${p.id}/decide` })),
    // DAM-2: a file replacement waiting for approval — same feed, links into Files
    // href is audience-aware: files.html is an OWNER page — a reviewer decides
    // from their own view, never a 403 wall.
    ...(((fileQ.ok && fileQ.json) || []) as any[]).filter((m) => (m.metadata || {}).pending_replace).map((m) => ({ id: m.id, kind: 'file', title: `Replace ${displayName(m)}`, summary: 'A file replacement is waiting for your OK before it goes live.', decide_path: `/assets/${m.id}/status`, href: seesFull ? `/files.html?focus=${m.id}` : '/client.html' })),
  ] : [];
  const last = (pubQ.ok && pubQ.json?.[0]) || null;
  // Phase FLOW: the notices rail joins the ONE global feed the shell bell reads,
  // so "a lead is waiting" / "your domain expires soon" surface on every page —
  // not only in the portal card. Each carries the href that resolves it.
  const notices = (((noticeQ.ok && noticeQ.json) || []) as any[]).map((n) => ({ id: n.id, kind: n.kind, headline: n.headline, body: n.body, href: noticeHref(n.kind) }));

  // FIX 1: a synthetic "new enquiries" row so a brand-new website lead reaches the
  // bell popup + the Inbox the same way every other needs-you item does — nothing
  // else raised this signal into the ONE feed before. Deduped against the
  // lead-followup cron notice (which covers AGED 'new' leads): the synthetic row
  // counts only still-fresh enquiries not yet represented by a follow-up notice,
  // so one submission never stacks two rows. (inbox.html renders per-lead detail
  // from /forms/inbox and filters this aggregate kind to avoid a double listing.)
  if (seesFull) {
    const leadFollowups = notices.filter((n) => n.kind === 'lead_followup').length;
    const newEnquiries = Math.max(0, (((enqQ.ok && enqQ.json) || []) as any[]).length - leadFollowups);
    if (newEnquiries > 0) notices.unshift({
      id: 'new-enquiries', kind: 'website_enquiry',
      headline: newEnquiries === 1 ? 'A new enquiry came in' : `${newEnquiries} new enquiries came in`,
      body: 'Someone reached out through your website and is waiting to hear back.',
      href: noticeHref('website_enquiry'),
    });

    // G11: a client left feedback on the shared draft — one synthetic row that
    // links straight into the builder's Comments panel (Design view). Mirrors
    // the new-enquiries row: counted live, never stored, gone when resolved.
    const openFeedback = feedbackQ || 0;
    if (openFeedback > 0) notices.unshift({
      id: 'client-feedback', kind: 'client_feedback',
      headline: openFeedback === 1 ? 'Your client left a note on the draft' : `${openFeedback} notes from your client on the draft`,
      body: 'Feedback on the shared draft is waiting — read and resolve it in the builder’s Comments panel.',
      href: noticeHref('client_feedback'),
    });

    // FIX 4: a section that BLOCKS publishing (missing required content) should show
    // in the main Inbox/bell, not only the Attention Center. Reuse the Content Tree's
    // existing missing_required signal (no new store); the read was started above,
    // concurrently — awaiting it here adds no serial latency. Best-effort.
    try {
      const tree = await treeP;
      const missing = tree ? tree.pages.flatMap((p: any) => p.sections.filter((s: any) => s.status === 'missing_required')) : [];
      if (missing.length > 0) notices.push({
        id: 'missing-required', kind: 'missing_required',
        headline: missing.length === 1 ? 'A section needs filling in before you can publish' : `${missing.length} sections need filling in before you can publish`,
        body: 'Add the missing details and your website is ready to go live.',
        href: noticeHref('missing_required'),
      });
    } catch { /* best-effort — the feed still works without the content-tree row */ }
  }

  // Bridged customer: their unread delivery activity lives on the AGENCY site
  // (counted into the bell by /portal/context) — without a findable row here the
  // badge points at nothing. One calm row that links where the items actually are.
  // Owners only: a client_reviewer can't open /client/* (403), so never show them the row.
  if (seesFull && site.client_id) {
    try {
      const links = ((bridgeQ.json as any[]) || []);
      if (links.length) {
        const s = links[0].agency_site_id; const ids = links.filter((l) => l.agency_site_id === s).map((l) => l.project_id);
        const [seen, ev] = await Promise.all([
          svc(`presence_activity_reads?site_id=eq.${s}&reader=eq.${encodeURIComponent('client:' + site.client_id)}&select=last_seen_at&limit=1`),
          ids.length ? svc(`presence_project_events?site_id=eq.${s}&project_id=in.(${ids.join(',')})&client_visible=is.true&select=created_at&order=created_at.desc&limit=50`) : Promise.resolve({ json: [] as any[] }),
        ]);
        const lastSeen = ((seen.json as any[]) || [])[0]?.last_seen_at || null;
        const unread = (((ev.json as any[]) || [])).filter((e) => !lastSeen || String(e.created_at) > String(lastSeen)).length;
        if (unread > 0) notices.unshift({ id: 'bridge-updates', kind: 'client_updates', headline: unread === 1 ? 'An update from your studio' : `${unread} updates from your studio`, body: 'New activity on your project — messages, files, or something to approve.', href: '/client.html' });
      }
    } catch { /* best-effort — the bell still works without this row */ }
  }
  // FIX 5: a FIRST-CLASS "Messages from your clients" section for the studio inbox.
  // Client support requests + client project messages were only reachable through a
  // dim, auto-marked-read "Project activity" line; a project-less request showed
  // nowhere actionable. Surface them prominently here, each linking to WHERE the
  // operator replies (the customer's delivery view, or the project-less request).
  // Deliberately NOT tied to the per-reader last-seen mark, so opening the Inbox
  // never clears them — an OPEN support request persists until resolved, and a
  // client message persists until the studio actually replies (the latest message
  // in the thread is no longer the client's). Owner/operator surfaces only.
  let client_messages: any[] = [];
  if (seesFull) {
    try {
      // supR + evR landed in the initial wave above.
      // Summarize EVERY project conversation, not only the ones awaiting a reply, so
      // the operator sees who they're talking with even after they've answered. evR is
      // created_at.desc, so the FIRST event seen per project is its latest; `needs_reply`
      // (that latest message came FROM the client) flags the ones still on the studio.
      // latestClient = the newest event stamped from='client' (evR is created_at.desc,
      // so the first client event seen per project is its latest) — the honest input
      // to the per-thread unread rule (client activity newer than the reader's mark).
      const convo = new Map<string, { latest: any; count: number; latestClient: any }>();
      for (const e of ((evR.json as any[]) || [])) {
        const pid = String(e.project_id || ''); if (!pid) continue;
        const fromClient = (e.detail || {}).from === 'client';
        const cur = convo.get(pid);
        if (cur) { cur.count++; if (!cur.latestClient && fromClient) cur.latestClient = e; }
        else convo.set(pid, { latest: e, count: 1, latestClient: fromClient ? e : null });
      }
      const sup = ((supR.json as any[]) || []);
      // A support row's honest "latest client activity" = max(the request itself,
      // its newest CLIENT-authored reply). updated_at can't drive unread: client
      // replies only INSERT into presence_support_messages (never bump it) while
      // studio actions DO bump it (triage PATCH, the open→in_progress bump on a
      // studio reply) — wrong in both directions once a mark exists. ONE batched,
      // site-scoped messages read; null on failure → the rows below fall back to
      // the old updated_at behavior rather than failing the feed (best-effort).
      let supClientAt: Record<string, string> | null = null;
      if (sup.length) {
        try {
          const mr = await svc(`presence_support_messages?site_id=eq.${site.id}&request_id=in.(${sup.map((r) => String(r.id)).join(',')})&deleted_at=is.null&select=request_id,author_kind,created_at&order=created_at.desc&limit=500`);
          if (mr.ok && Array.isArray(mr.json)) supClientAt = newestClientMessageAt(mr.json as any[]);
        } catch { supClientAt = null; }
      }
      const supLatestClient = (r: any): string => {
        if (!supClientAt) return String(r.updated_at || '');   // read failed → today's behavior
        const reply = supClientAt[String(r.id)] || '';
        const opened = String(r.created_at || '');
        return reply > opened ? reply : opened;
      };
      const pids = [...new Set([...sup.filter((r) => r.project_id).map((r) => String(r.project_id)), ...convo.keys()])];
      // project → { name, client_id }. client_id ties a project's messages back to the
      // CUSTOMER so the Inbox can group by client (tenant-safe: the project is fetched
      // on THIS studio's site).
      const projById: Record<string, { name: string; client_id: string }> = {};
      if (pids.length) { for (const p of (((await svc(`presence_projects?id=in.(${pids.join(',')})&site_id=eq.${site.id}&deleted_at=is.null&select=id,name,client_id`)).json as any[]) || [])) projById[String(p.id)] = { name: String(p.name || ''), client_id: p.client_id ? String(p.client_id) : '' }; }
      // Grouping-by-client enrichment. TWO cheap, batched lookups (never N+1):
      //  1) the Agency–Client Bridge (agencyLinksQ, read in the initial wave) — the
      //     authoritative "who are my customers" list + project→customer mapping.
      //  2) one clients read for every customer id we touched — name + identity keys.
      // A project-less request carries only a `requester` reader key; match it to a
      // customer via their auth-user-id/email so it groups under the right client too.
      const links = ((agencyLinksQ.json as any[]) || []);
      const projToClient: Record<string, string> = {};
      const clientToProject: Record<string, string> = {};  // client id → one of their projects (to open their profile)
      const clientIds = new Set<string>();
      for (const l of links) { const pid = String(l.project_id || ''); const cid = String(l.customer_client_id || ''); if (cid) { clientIds.add(cid); if (pid) { projToClient[pid] = cid; if (!clientToProject[cid]) clientToProject[cid] = pid; } } }
      for (const pid of pids) { const cid = projById[pid]?.client_id; if (cid) clientIds.add(cid); }
      const clientById: Record<string, string> = {};       // client id → display name
      const requesterToClient: Record<string, string> = {}; // reader key → client id
      if (clientIds.size) {
        // `clients` has no auth_user_id column — the customer's auth identity lives on
        // their linked contact (clients.contact_id -> contacts.auth_user_id). Read the
        // clients + their contacts (two batched lookups), then a project-less request
        // filed while signed in (requester = auth uuid) still groups under the client.
        const clientRows = (((await svc(`clients?id=in.(${[...clientIds].join(',')})&select=id,name,email,contact_email,contact_id`)).json as any[]) || []);
        const contactIds = [...new Set(clientRows.map((c) => c.contact_id).filter(Boolean).map(String))];
        const authByContact: Record<string, string> = {};
        if (contactIds.length) { for (const ct of (((await svc(`contacts?id=in.(${contactIds.join(',')})&select=id,auth_user_id`)).json as any[]) || [])) { if (ct.auth_user_id) authByContact[String(ct.id)] = String(ct.auth_user_id); } }
        for (const c of clientRows) {
          const cid = String(c.id); clientById[cid] = String(c.name || c.email || 'Client');
          const authId = c.contact_id ? authByContact[String(c.contact_id)] : '';
          for (const k of [authId, c.email, c.contact_email]) { if (k != null && String(k).trim() !== '') requesterToClient[String(k)] = cid; }
        }
      }
      const clientFor = (pid: string, requester: string) => {
        const cid = (pid && (projToClient[pid] || projById[pid]?.client_id)) || (requester ? requesterToClient[requester] : '') || '';
        return { client_id: cid, client: cid ? (clientById[cid] || 'Client') : '' };
      };
      // href: a request opens the CLIENT'S PROFILE (delivery view) wherever we can tie
      // it to one — a project-scoped request opens its project; a project-less request
      // opens the customer's project when the bridge knows one; only a truly orphaned
      // request (no client, no project) falls back to its standalone conversation page.
      // Slice 2 (additive): every row gains a stable thread_key + a real per-thread
      // `unread` — latest client activity newer than the reader's mark for that key
      // (threadUnread falls back to the old needs-reply heuristic when no mark exists,
      // so a pre-0113 database behaves exactly like today). Support rows also carry
      // their status so the list pane can chip "Support · open" without a second read.
      for (const r of sup) { const pid = r.project_id ? String(r.project_id) : ''; const c = clientFor(pid, String(r.requester || '')); const profilePid = pid || (c.client_id ? clientToProject[c.client_id] || '' : ''); const tk = `support:${r.id}`; client_messages.push({ type: 'support', id: r.id, subject: String(r.subject || 'Support request').slice(0, 120), status: String(r.status || 'open'), project: pid ? (projById[pid]?.name || '') : '', client_id: c.client_id, client: c.client, created_at: r.updated_at, thread_key: tk, unread: threadUnread(supLatestClient(r), markFor(tk), true), href: profilePid ? `/crm.html?project=${profilePid}&tab=messages` : `/projects.html?support=${r.id}` }); }
      for (const [pid, cv] of convo) { const c = clientFor(pid, ''); const needsReply = (cv.latest.detail || {}).from === 'client'; const tk = c.client_id ? `client:${c.client_id}` : `client:${pid}`; client_messages.push({ type: 'message', project: projById[pid]?.name || '', project_id: pid, client_id: c.client_id, client: c.client, created_at: cv.latest.created_at, needs_reply: needsReply, count: cv.count, thread_key: tk, unread: threadUnread(cv.latestClient ? String(cv.latestClient.created_at || '') : null, markFor(tk), needsReply), href: `/crm.html?project=${pid}&tab=messages` }); }
      client_messages.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      client_messages = client_messages.slice(0, 20);
    } catch { /* best-effort — the inbox still renders without this section */ }
  }
  // Slice 2 (additive): per-lead rows so the Inbox list pane renders its Enquiries
  // view from this ONE feed call. The synthetic website_enquiry NOTICE above stays —
  // it is the bell's aggregate; these are the per-item rows (same read, widened
  // select, no second query). Owner surfaces only; reviewers never see leads.
  // When the widened submissions read FAILED the key is OMITTED entirely
  // (undefined → dropped by JSON.stringify): an empty array would read as the
  // authoritative "no leads" and the Inbox would hide enquiries its own
  // /forms/inbox fetch still sees. Absent key → the frontend's Array.isArray
  // gate falls back to that fetch (deploy-order tolerance, both directions).
  let enquiries: any[] | undefined = [];
  if (seesFull) {
    try {
      enquiries = ((enqQ as any).ok && Array.isArray((enqQ as any).json))
        ? (((enqQ as any).json) as any[]).map((f) => {
          const tk = `lead:${f.id}`;
          return {
            id: f.id, form_kind: String(f.form_kind || 'contact'), name: String(f.name || ''), email: String(f.email || ''),
            phone: String(f.phone || ''), message: String(f.message || '').slice(0, 400), status: String(f.status || 'new'),
            created_at: f.created_at, thread_key: tk, unread: threadUnread(String(f.created_at || ''), markFor(tk), true),
          };
        })
        : undefined;
    } catch { enquiries = undefined; /* best-effort — the feed still works without the rows */ }
  }
  return json({ data: { role, moments, notices, pending_approvals: pending, last_published: last, client_messages, enquiries } }, 200, cors);
}

export async function handleMembersList(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const g = await requireManager(jwt, site, principal, cors); if (g instanceof Response) return g;
  return json({ data: await listSiteMembers(site.id) }, 200, cors);
}

export async function handleMemberAdd(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const g = await requireManager(jwt, site, principal, cors); if (g instanceof Response) return g;
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const res = await addSiteMember(site.id, String(body?.email || ''), body?.role, principal.userId || 'owner');
  if (!res.ok) {
    const msg = res.error === 'bad_email' ? 'That doesn’t look like an email address.' : res.error === 'bad_role' ? 'Pick a valid role.' : 'That didn’t save — please try again.';
    return json({ error: res.error, message: msg }, res.error === 'write_failed' ? 502 : 400, cors);
  }
  const message = res.emailed
    ? 'Invited — we’ve emailed them a sign-in link. They’ll see only what you choose to share.'
    : 'Added — but the invite email didn’t send. Send them their sign-in link yourself, or try again.';
  return json({ data: { ok: true, emailed: !!res.emailed, message } }, 200, cors);
}

export async function handleMemberRevoke(jwt: string, site: SiteRow, memberId: string, principal: Principal, cors: Record<string, string>) {
  const g = await requireManager(jwt, site, principal, cors); if (g instanceof Response) return g;
  const ok = await revokeSiteMember(site.id, memberId);
  return ok ? json({ data: { ok: true, message: 'Access removed.' } }, 200, cors) : json({ error: 'not_found', message: 'That person isn’t on this account.' }, 404, cors);
}

export async function handleSharesList(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const g = await requireManager(jwt, site, principal, cors); if (g instanceof Response) return g;
  const m = await loadShares(site.id);
  return json({ data: { shares: [...m.entries()].map(([k, shared]) => { const [surface, item] = k.split(':'); return { surface, item_id: item === '*' ? null : item, shared }; }) } }, 200, cors);
}

export async function handleShareSet(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const g = await requireManager(jwt, site, principal, cors); if (g instanceof Response) return g;
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const surface = String(body?.surface || '').trim();
  if (!surface) return json({ error: 'bad_request', message: 'Which kind of item?' }, 400, cors);
  const ok = await setShare(site.id, surface, body?.item_id ?? null, !!body?.shared, principal.userId || 'owner');
  return ok ? json({ data: { ok: true, message: body?.shared ? 'Shared with your client.' : 'Kept internal.' } }, 200, cors) : json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
}
