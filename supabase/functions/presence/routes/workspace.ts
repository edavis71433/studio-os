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
import { projectIdOfApprovalPeriod } from '../lib/approvals.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { capabilitiesOf, contentWriteNeeds, memberWriteNeeds, siteCan } from '../lib/site_roles.ts';
import { leadIdOfNoticePeriod } from '../lib/commercial.ts';
import type { SiteRole } from '../lib/site_roles.ts';
import { buildNav, landingFor, normalizeHidden } from '../lib/navigation.ts';
import { readReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { editionFromPlan, editionFromSite, featuresOf, editionFlags, featureDelta, EDITION_DEFS, type EditionKey } from '../commerce/editions.ts';
import { nextPlanUp } from '../commerce/catalog.ts';
import { resolveAgencyMember } from '../agency/auth.ts';
import { filterForRole, visibleTo } from '../lib/visibility.ts';
import { svc, svcCount } from '../lib/db.ts';
import { displayName } from '../lib/dam.ts';
import { resolveSiteRoleCached, listSiteMembers, addSiteMember, changeSiteMemberRole, resendSiteInvite, revokeSiteMember, loadShares, overrideFor, setShare, isSharedStudioSite, listBusinesses } from '../lib/workspace.ts';
import { loadThreadMarks, newestClientMessageAt, threadUnread } from '../lib/thread_reads.ts';
import { shapeClientConversations, studioBellCount, noticeDismissible, NOTICE_ACCOUNT_KINDS, freshEnquiries, invoiceReminderIds, renderableNotices, noticeTier, noticePriority } from '../lib/inbox_feed.ts';
import { clearNotice } from '../lib/notice.ts';
import { healSupportOwners } from '../lib/service_bridge.ts';
import { supportActivityAt } from '../lib/support_activity.ts';

// ── Phase 3 (one source for numbers): the notice rows the bell COUNTS and Today
// RENDERS are the same rows. Drops the client_* throttle notices (their counted
// half is a message/support row) and any invoice reminder whose invoice is no
// longer open — and clears those stale reminders so the badge self-heals. One
// batched invoices read, only when a reminder exists; a failed read keeps every
// reminder (never an under-count). Best-effort end to end.
async function verifiedNotices(site: SiteRow, rows: any[]): Promise<any[]> {
  const ids = invoiceReminderIds(rows);
  let open: ReadonlySet<string> | null = null;
  if (ids.length) {
    try {
      const r = await svc(`presence_invoices?site_id=eq.${site.id}&id=in.(${ids.join(',')})&select=id,status&limit=${ids.length}`);
      if (r.ok && Array.isArray(r.json)) open = new Set((r.json as any[]).filter((i) => String(i.status) === 'open').map((i) => String(i.id)));
    } catch { open = null; }
  }
  const { keep, stale } = renderableNotices(rows, open);
  // stale = a paid invoice's reminder, an older week's copy of a still-open
  // nudge, or "Proposal accepted" once the deal is signed — each cleared by its
  // own kind + exact period, so nothing else can be touched.
  if (stale.length && site.client_id) {
    // item 90: all at once; one after another, they held up the bell
    await Promise.all(stale.filter((n) => n.kind && n.period).map((n) => clearNotice(String(site.client_id), String(n.kind), String(n.period)).catch(() => {})));
  }
  return keep;
}
import { missingColumnSignal } from '../lib/inbound_email.ts';

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

/** A member's write gets what their role allows, or a 403 that says so. A write
 *  on no list is refused. Marks the seat cleared for a content write, which is what
 *  lets siteDb send it: a write contentWriteNeeds doesn't recognise is never cleared,
 *  so it fails closed there. Reads a clone of the body, so the handler can still read it. */
export async function memberWriteGate(req: Request, route: string, method: string, member: NonNullable<Principal['member']>, cors: Record<string, string>): Promise<Response | null> {
  const fields = route === '/settings' ? Object.keys(await req.clone().json().catch(() => null) ?? {}) : [];
  const content = contentWriteNeeds(route, method, fields);
  const needs = content ?? memberWriteNeeds(route, method);
  if (needs !== 'open' && (!needs || !siteCan(member.role as SiteRole, needs))) return json({ error: 'forbidden', message: 'Your role on this site doesn’t include that — ask the account owner.' }, 403, cors);
  member.cleared = !!content;
  return null;
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
  // Invited to work on this site, so not the customer a bridged site's client surface is for.
  const worksOnSite = role === 'business_staff' || role === 'developer';

  // ONE concurrent wave for every independent read on this boot path — agency
  // membership, the bridged-customer links, the entitlement plan, and BOTH
  // attention (bell badge) waves that used to run serially. The predicates are
  // unchanged: a caller without the capability never fires the studio-only
  // reads — their slot resolves to the empty shape ('none') instead. Every
  // best-effort slot swallows its own failure so one bad read never costs the
  // others (same net effect as the old per-block try/catch).
  // Final pass (Nov 8, S1): a studio's request waiting on this site's OWNER (the
  // shell shows it with Accept / Decline). Started now, read after the wave below.
  const studioReqP: Promise<Array<{ id: string; studio: string }>> = role === 'business_owner' && !scopedName && !isOperator && !worksOnSite
    ? import('./connect_requests.ts').then((m) => m.studioRequestsFor(site, principal)).catch(() => [])
    : Promise.resolve([]);
  // builder item 83: the businesses this person can switch between (someone invited
  // somewhere, with two or more); started now, read at the end
  const businessesP = !isOperator && !scopedName ? listBusinesses(jwt, principal).catch(() => []) : Promise.resolve([]);
  const none = Promise.resolve({ ok: true, json: [] as any[] });
  const swallow = () => ({ ok: false, json: null as any });
  const [agencyMember, linksQ, ent, nQ, iQ, wQ, fQ, eQ, supQ, seenQ, msgQ, cmQ] = await Promise.all([
    // agency membership drives the Agency nav section (reviewers never need it)
    role !== 'client_reviewer' ? resolveAgencyMember(jwt).catch(() => null) : Promise.resolve(null),
    // Bridged-customer links (see isManagedClient below). Fired without waiting on
    // the agency lookup — the old !isAgency guard moved to the CONSUMER, so an
    // agency operator's result is simply discarded, never acted on.
    site.client_id && !isOperator && !scopedName && !worksOnSite
      ? svc(`presence_service_links?customer_client_id=eq.${site.client_id}&status=eq.active&select=project_id,agency_site_id&limit=50`).then((r) => ((r.json as any[]) || [])).catch(() => null)
      : Promise.resolve(null),
    // Phase D: the licensed plan (shared per-request memo — the boundary gate already read this row)
    site.client_id
      ? import('../middleware/entitlement.ts').then((m) => m.entitlementFor(principal, site.client_id)).catch(() => null)
      : Promise.resolve(null),
    // Phase FLOW: active notices (owner surfaces only; bounded — the badge caps out anyway)
    // period rides along so the badge counts what Today renders (one row per subject — renderableNotices)
    seesFull ? svc(`presence_plan_notices?site_id=eq.${site.id}&status=eq.active&select=id,kind,period&limit=100`).catch(swallow) : none,
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
    // client_upload + task_done were absent here, so a client's FILE never rang
    // the bell at all (uploads were invisible in-app end to end) and a completed
    // client to-do went unseen. Both are stamped detail.from='client' by the
    // client door, so the from-client filter below still keeps the studio's own
    // actions out of its own badge.
    seesFull ? svc(`presence_project_events?site_id=eq.${site.id}&kind=in.(message,approval_decided,survey_submitted,client_upload,task_done)&select=created_at,kind,detail,actor_kind&order=created_at.desc&limit=50`).catch(swallow) : none,
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
  // (isAgency / isOperator / scopedName) KEEPS the operator tools, a staff or
  // developer seat keeps theirs (worksOnSite), and a plain studio owner (no
  // customer-side link) is never mistaken for a client.
  // The lookup rides the wave above so the attention block below reuses it (no 2nd query).
  const customerLinks: any[] | null = isAgency ? null : linksQ;
  const isManagedClient = !!(customerLinks && customerLinks.length > 0);
  // builder list item 59: a managed client's pages carry their studio's name and logo (routes/studio_brand.ts)
  const studioSiteId = isManagedClient ? String(customerLinks![0]?.agency_site_id || '') : '';
  const studio = studioSiteId ? await import('./studio_brand.ts').then((m) => m.studioBrandOf(studioSiteId)).catch(() => null) : null;

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
  // The arithmetic itself is PURE (lib/inbox_feed.ts studioBellCount) — including
  // the two rules that used to be inline and untestable: the lead_followup ↔
  // new-enquiry dedupe, and (R-fix F1) leaving the four client_* portal notices
  // OUT of the count. Those notices are the operator email's throttle key and
  // still render in the bell rail; counting them too double-counted every client
  // action, and nothing ever cleared them, so the badge only ever rose.
  let attention_count: number | null = 0;
  let attention_stale = false;
  try {
    attention_count = studioBellCount({
      notices: await verifiedNotices(site, ((nQ.json as any[]) || [])),
      newEnquiries: ((eQ.json as any[])?.length || 0),
      proposedPlans: (iQ || 0),
      proposedWrites: (wQ || 0),
      filesPending: role === 'client_reviewer' && (await isSharedStudioSite(site.id)) !== false ? 0 : ((fQ.json as any[]) || []).filter((m) => (m.metadata || {}).pending_replace).length,   // review finding 5
      openFeedback: (cmQ || 0),
      // P2-D: service delivery folds into the ONE attention surface (no second
      // bell). Both slots resolve empty for a caller without view_all, so the
      // predicate lives in the reads above, not in a second branch here.
      openSupport: ((supQ.json as any[])?.length || 0),
      clientEvents: ((msgQ.json as any[]) || []),
      lastSeenAt: (seenQ.json as any[])?.[0]?.last_seen_at || null,
    });
  } catch { /* the badge is best-effort — never block the shell on it */ }
  // Sales review item 11 (Nov 2026): at STUDIO level the badge is the studio's
  // ONE needs-you list total — the same number Home heads its list with and the
  // bell's Needs-you tab lists (agency/routes.ts). On any failure the count
  // above stands.
  // Final pass (Nov 8, batch B): a page boot never computes that list (55–60
  // reads, 0.3–0.5 s, on every page). It shows the kept total; when that is
  // stale or missing it says so, and the shell refreshes the badge behind the
  // page. Missing = null ("not known yet"), never the site's own count.
  if (agencyMember && !scopedName && seesFull) {
    try {
      const { keptStudioNeedsTotal } = await import('../agency/routes.ts');
      const kept = keptStudioNeedsTotal(String((agencyMember as any).agency_id || ''));
      attention_count = kept ? kept.total : null;
      attention_stale = !kept || !kept.fresh;
    } catch { /* keep the site count */ }
  }

  // The bridged CUSTOMER's own badge (their unread client-visible delivery
  // activity) needs reads that DEPEND on their bridge links, so it stays here.
  try {
    if (!seesFull && site.client_id) {
      const links = customerLinks ?? (((await svc(`presence_service_links?customer_client_id=eq.${site.client_id}&status=eq.active&select=project_id,agency_site_id&limit=50`)).json as any[]) || []);
      if (links.length) {
        const s = links[0].agency_site_id; const ids = links.filter((l) => l.agency_site_id === s).map((l) => l.project_id);
        const [seen, ev] = await Promise.all([
          svc(`presence_activity_reads?site_id=eq.${s}&reader=eq.${encodeURIComponent('client:' + site.client_id)}&select=last_seen_at&limit=1`),
          ids.length ? svc(`presence_project_events?site_id=eq.${s}&project_id=in.(${ids.join(',')})&client_visible=is.true&select=created_at&order=created_at.desc&limit=50`) : Promise.resolve({ json: [] as any[] }),
        ]);
        const lastSeen = (seen.json as any[])?.[0]?.last_seen_at || null;
        attention_count = (attention_count || 0) + ((ev.json as any[]) || []).filter((e) => !lastSeen || String(e.created_at) > String(lastSeen)).length;
      }
    }
  } catch { /* best-effort */ }

  // Oct 2026 nav cut: "Get started" is listed only until the site is live — the
  // site row already in hand says so (deploy_reconcile stamps status 'live' +
  // last_published_at on the first successful publish).
  const siteLive = site.status === 'live' || !!site.last_published_at;
  // Item 54: at studio level, the areas this studio took out of its menu (a reserved row on
  // its own site, which is the site in hand when nothing is scoped). A failed read hides nothing.
  const hiddenSections = (isAgency && !scopedName) ? normalizeHidden(await readReservedJson(site.id, RESERVED_NAMES.navHidden)) : [];
  const navCtx = { role, edition: site.edition, capabilities: caps, isAgency, isOperator, editionKey, isManagedClient, scoped: !!scopedName, siteLive, hiddenSections };
  const businesses = (await businessesP).map((b) => ({ site_id: b.site_id, name: b.name, role: b.role, role_words: b.owned ? 'Owner' : (SEAT_ROLE_WORDS[b.role] || b.role), current: b.site_id === site.id }));
  return json({ data: {
    site_role: role,
    capabilities: caps,
    studio,                              // builder list item 59: { name, logo_url, accent } for a managed client, else null
    edition: site.edition,               // 'monitor' | 'presence' (site hosting dimension)
    site_live: !!siteLive,               // sales review item 24: the client Overview's Website tile (hosted elsewhere · live · not live yet)
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
    attention_count,                     // Phase FLOW: the shell bell badge (notices + pending approvals); null = not known yet (studio level, batch B)
    attention_stale,                     // batch B: the shell refreshes a stale or missing studio total behind the page
    studio_requests: await studioReqP,   // final pass S1: studios asking this owner to connect
    businesses,                          // builder item 83: [] unless this person can switch between two or more businesses
    business: businesses.find((b) => b.current) || null,   // …and which one this is
    nav: buildNav(navCtx),               // the ONE navigation source of truth, edition- + entitlement-filtered
  } }, 200, cors);
}

// Phase FLOW: where each notice kind sends the owner when tapped in the bell —
// straight to the page that resolves it, not a generic landing (one fewer hop).
const NOTICE_HREF: Record<string, string> = {
  lead_followup: '/inbox.html#enquiries',
  website_enquiry: '/inbox.html#enquiries',   // FIX 1: a brand-new website enquiry → the Inbox's Enquiries view
  connection_expired: '/connections.html', // FIX 2: a degraded connection → reconnect
  missing_required: '/presence.html#pages',  // FIX 4: a section blocking publish → the overview's Pages (content-tree.html retired, Oct 2026)
  deal_signed: '/pipeline.html',   // W1: a client accepted/signed → convert them from Pipeline
  deal_followup: '/pipeline.html', // CRM: a stale deal needs a nudge
  support_aging: '/projects.html', // service edge #3: an aging support request needs a reply (support lives in the project view)
  invoice_paid: '/pipeline.html',  // money landed → the deal it landed on
  invoice_upcoming: '/pipeline.html',   // item 47: a recurring invoice goes out in three days → that deal's Billing (noticeHrefFor deep-links it)
  invoice_void_paid: '/pipeline.html',   // 0119: money landed on a WITHDRAWN invoice → the deal, where the voided row is
  publish_failed: '/presence.html#publish',
  studio_published: '/presence.html',   // audit change 2: the client's studio published for them → their Website overview
  site_published: '/presence.html',     // builder list item 47: a publish finished → the Website overview (the studio's bell carries ?client=)
  traffic_spike: '/analytics.html',     // builder list item 47: a busy day → Analytics, where the visitors came from
  site_down: '/presence.html#foundations',   // a confirmed outage → the foundations desk (domain/hosting/health)
  domain_expiry: '/presence.html#domain',
  search_setup: '/presence.html#search',
  welcome_back: '/today.html',
  // account/billing notices land where billing can actually be FIXED — the
  // billing card in Settings (presence.html), which every edition's nav carries.
  capacity: '/presence.html#settings', trial_ending: '/presence.html#settings', trial_ended: '/presence.html#settings',
  payment_trouble: '/presence.html#settings', account_lapsed: '/presence.html#settings',
  winddown_reminder: '/presence.html#settings', win_back: '/presence.html#settings', deletion_requested: '/presence.html#settings',
  approval_decided: '/presence.html#activity',   // a reviewer/client decided something — the overview's Recent activity (timeline.html retired)
  new_booking: '/presence.html#bookings',   // a customer booked online → the Bookings desk (confirm/cancel)
  booking_followup: '/presence.html#bookings', // #164: a past appointment needs marking done / no-show
  booking_reminder: '/presence.html#bookings', // #164: silent send-once ledger (dismissed; never shown) — mapped for completeness
  new_review: '/presence.html#reviews',   // a customer left a review → the Reviews desk (approve/hide/reply)
  client_feedback: '/presence.html#design',   // G11: a client left a note on the shared draft → the builder's Comments panel
  email_auth: '/presence.html#foundations',   // DNS #5: unauthenticated email → the Foundations desk (email/DNS setup)
  apex_drift: '/presence.html#foundations',   // DNS: apex points at the wrong place → Foundations (domain/DNS)
  // 0116: the client portal's four operator-notifying actions. The EMAIL carries
  // an id-precise deep link (project/support id); the bell's href is kind-only,
  // so it lands on the surface that lists them.
  client_message: '/inbox.html',      // a client wrote (portal or emailed in) → the Inbox conversation list
  client_request: '/inbox.html',      // a support/service request opened or replied → same list (support rows live there)
  client_upload: '/projects.html',    // a client sent a file → project Files
  client_approval: '/presence.html#activity',  // a client decided an approval → Recent activity (matches approval_decided)
  approval_overdue: '/projects.html',   // audit change 8: a client approval passed its due date → the project (noticeHrefFor deep-links it)
};
export const noticeHref = (k: string): string => NOTICE_HREF[k] || '/today.html';
// A notice whose period names ONE row deep-links that row (Oct 2026 audit, gap 2):
// lead_followup's period is `lead:<id>` (commercial.ts leadFollowupNoticeKey), so
// its href selects that enquiry in the Inbox's Enquiries view — the reply is one
// click away instead of two. Every other kind keeps its kind-only landing.
export const noticeHrefFor = (n: { kind: string; period?: string | null }): string => {
  const base = noticeHref(n.kind);
  // approval_overdue's period is approval:<project>:<approval> (lib/approvals.ts) → open that project's record
  const project = n.kind === 'approval_overdue' ? projectIdOfApprovalPeriod(n.period) : null;
  if (project) return `${base}?project=${project}`;
  const id = n.kind === 'lead_followup' ? leadIdOfNoticePeriod(n.period) : null;
  if (id) return `${base}?sel=lead:${id}`;
  // sales review item 22: "Agreement signed — ready to convert" opens that deal at
  // its Convert step; "Proposal accepted" opens the deal (period signed:/accepted:<deal>)
  const deal = n.kind === 'deal_signed' ? /^(signed|accepted):([0-9a-f-]{36})$/i.exec(String(n.period || '')) : null;
  if (deal) return `/pipeline.html?deal=${deal[2]}${deal[1] === 'signed' ? '#convert' : ''}`;
  // item 47: an approved or passed-on estimate, a recurring invoice's heads-up or
  // its pause — each period starts <what>:<deal id>, so it opens that deal's Billing
  const billing = /^(estimate|estdeclined|recurnext|recurpause):([0-9a-f-]{36}):/i.exec(String(n.period || ''));
  if (billing && ((n.kind === 'deal_signed' && billing[1] === 'estimate') || (n.kind === 'deal_followup' && (billing[1] === 'estdeclined' || billing[1] === 'recurpause')) || (n.kind === 'invoice_upcoming' && billing[1] === 'recurnext'))) {
    return `/pipeline.html?deal=${billing[2]}&dtab=billing`;
  }
  return base;
};

/** The client portal's read: only what's shared with the reviewer — shared
 *  Business Moments, the site's publish status, and the plans awaiting their OK.
 *  Computed server-side with the visibility model, so it can never over-expose. */
export async function handlePortalFeed(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  return json({ data: await buildPortalFeed(jwt, site, principal) }, 200, cors);
}

// Sales review decision 2 (Nov 2026): at STUDIO level (an agency member on their
// own site, not drilled into a client) the Inbox and the bell are the sales
// side. Notices, moments and approvals about the studio's OWN website stay on
// the Website page — they read as sales work on Home and in the Inbox.
export const STUDIO_WEBSITE_NOTICE_KINDS: ReadonlySet<string> = new Set([
  'search_setup', 'domain_expiry', 'publish_failed', 'connection_expired', 'site_down', 'email_auth', 'apex_drift', 'new_review', 'missing_required', 'client_feedback',
  'site_published', 'traffic_spike',   // item 47: the studio's OWN site's news stays on its Website page; client sites' news reaches the bell through /agency/needs-you
]);
/** Pure: the feed as the studio sees it at studio level. */
export function studioLevelFeed<T extends { notices: any[]; moments: any[]; pending_approvals: any[] }>(d: T): T {
  return { ...d, notices: (d.notices || []).filter((n) => !STUDIO_WEBSITE_NOTICE_KINDS.has(String(n?.kind ?? ''))), moments: [], pending_approvals: [] };
}

/** What the feed hands the Inbox, at most: the newest FEED_ENQUIRIES new enquiries,
 *  the newest FEED_CONVERSATIONS conversations, and the first FEED_MESSAGE_CHARS of an
 *  enquiry's message. `enquiries_more` / `client_messages_more` / `message_cut` say
 *  when something was left out, so the Inbox can say so (bug hunt C2, C15). */
export const FEED_ENQUIRIES = 50, FEED_CONVERSATIONS = 20, FEED_MESSAGE_CHARS = 400;
/** The feed's rows — the Inbox, the bell panel and the studio's Needs-you list
 *  all read this one builder. */
export async function buildPortalFeed(jwt: string, site: SiteRow, principal: Principal): Promise<any> {
  const role = await resolveSiteRoleCached(principal, jwt, site.id);
  const seesFull = siteCan(role, 'view_all');   // owner surfaces get the notices rail; reviewers don't
  // review finding 5: a reviewer on a studio's shared site gets no waiting files (they'd be every client's)
  const filesHidden = role === 'client_reviewer' ? (await isSharedStudioSite(site.id)) !== false : false;
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
    // `period` joins the select (a widening, no migration) because the KIND alone
    // can't tell an unpaid-invoice reminder from an ordinary deal follow-up —
    // both are `deal_followup`, and only one of them may ever be dismissed.
    seesFull ? svc(`presence_plan_notices?site_id=eq.${site.id}&status=eq.active&select=id,kind,period,headline,body,created_at&order=created_at.desc&limit=30`) : Promise.resolve({ ok: true, json: [] as any[] }),
    svc(`presence_media?site_id=eq.${site.id}&asset_status=eq.pending&deleted_at=is.null&select=id,storage_path,alt_text,metadata&limit=10`), // DAM-2: files awaiting approval
    // FIX 1: brand-new website enquiries (owner surfaces only) — one synthetic feed
    // row so the bell + Inbox surface them like every other needs-you item.
    // Slice 2 widened the select (additive): the same read also feeds the per-lead
    // `enquiries` rows the Inbox list pane renders — never a second query.
    // (one past FEED_ENQUIRIES, so the Inbox can say when the list stops short; bug hunt C15)
    seesFull ? svc(`presence_form_submissions?site_id=eq.${site.id}&spam=eq.false&status=eq.new&select=id,form_kind,name,email,phone,message,status,created_at&order=created_at.desc&limit=${FEED_ENQUIRIES + 1}`) : noEnq,
    // bridged-customer links (owner-only; the unread reads that DEPEND on them stay below)
    seesFull && site.client_id ? svc(`presence_service_links?customer_client_id=eq.${site.client_id}&status=eq.active&select=project_id,agency_site_id&limit=50`).catch(swallow) : noEnq,
    // FIX 5 inputs: open support requests + client message events (owner-only, best-effort).
    // F3: the select PREFERS the write-time client_id stamp (0115); on a pre-0115
    // database the widened select 400s, so it falls back to the old column list —
    // rows keep flowing, grouping degrades to the requester-key match below.
    seesFull ? (async () => {
      const cols = 'id,subject,status,priority,assigned_to,project_id,requester,created_at,updated_at';   // priority + assigned_to: sales review item 34 (columns since 0078)
      const path = (sel: string) => `presence_support_requests?site_id=eq.${site.id}&status=not.in.(resolved,closed)&deleted_at=is.null&select=${sel}&order=updated_at.desc&limit=25`;
      let r = await svc(path(`${cols},client_id`));
      // R5: retry the narrow select ONLY on the precise missing-column signal
      // (pre-0115 client_id) — a transient 5xx must not trigger a silent
      // second read that happens to succeed and masks the flake.
      if (!r.ok && missingColumnSignal(r.json, r.text, 'client_id')) r = await svc(path(cols));
      return r;
    })().catch(swallow) : noEnq,
    // kind=message events carry detail.from ('client'|'studio') — stamped by the
    // client door — so we can tell whose turn it is without the author_kind
    // ambiguity (a solo owner and their customer are both 'client').
    // Widened beyond kind=message: an approval DECISION was counted by the bell
    // but had no Inbox row, and client uploads / completed client to-dos had
    // neither. The per-project row this feeds is "latest client activity on this
    // thread", so folding them in is the honest reading — a row's `count` now
    // spans the conversation, not only its messages.
    // `kind` rides the select (R-fix F6): the shaper has to tell a widened kind
    // apart from a plain message to know whether it awaits a studio reply.
    seesFull ? svc(`presence_project_events?site_id=eq.${site.id}&kind=in.(message,approval_decided,client_upload,task_done)&select=project_id,kind,detail,created_at&order=created_at.desc&limit=100`).catch(swallow) : noEnq,
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
  // Benchmark 8: every feed row carries a tier (needs_you | update) and a
  // priority flag (approvals + money) — the bell's tabs and ordering read them.
  const moments = filterForRole(role, (momQ.ok && momQ.json) || [], (m: any) => ({ surface: 'business_moments', override: overrideFor(shares, 'business_moments', m.id) })).map((m: any) => ({ ...m, tier: 'update', priority: false }));
  // approvals are 'always' visible to the reviewer (they must see what to approve)
  const showApprovals = visibleTo(role, 'approvals');
  const pending = (showApprovals ? [
    ...(((infraQ.ok && infraQ.json) || []) as any[]).map((p) => ({ id: p.id, kind: 'infrastructure', title: p.title, summary: p.summary, decide_path: `/foundations/plans/${p.id}/decide` })),
    ...(((writeQ.ok && writeQ.json) || []) as any[]).map((p) => ({ id: p.id, kind: 'connected', provider: p.provider_key, title: p.title, summary: p.summary, decide_path: `/connections/${p.provider_key}/write/${p.id}/decide` })),
    // DAM-2: a file replacement waiting for approval — same feed, links into Files
    // href is audience-aware: files.html is an OWNER page — a reviewer decides
    // from their own view, never a 403 wall.
    ...(((fileQ.ok && !filesHidden && fileQ.json) || []) as any[]).filter((m) => (m.metadata || {}).pending_replace).map((m) => ({ id: m.id, kind: 'file', title: `Replace ${displayName(m)}`, summary: 'A file replacement is waiting for your OK before it goes live.', decide_path: `/assets/${m.id}/status`, href: seesFull ? `/files.html?focus=${m.id}` : '/client.html' })),
  ] : []).map((p) => ({ ...p, tier: 'needs_you', priority: true }));   // an approval is always an ask, always on top
  const last = (pubQ.ok && pubQ.json?.[0]) || null;
  // Phase FLOW: the notices rail joins the ONE global feed the shell bell reads,
  // so "a lead is waiting" / "your domain expires soon" surface on every page —
  // not only in the portal card. Each carries the href that resolves it.
  // `dismissible` is derived from the SAME pure rule POST /commerce/notices/dismiss
  // enforces (lib/inbox_feed.noticeDismissible) — the client draws no "Done" button
  // the server would refuse, and refuses one the client never drew. A studio drilled
  // into a client also gets none on the client's account rows, which that route refuses
  // too. Synthetic rows below carry no id/period at all; the client's UUID guard is what
  // excludes them.
  const notices = (await verifiedNotices(site, (((noticeQ.ok && noticeQ.json) || []) as any[]))).map((n) => ({ id: n.id, kind: n.kind, period: n.period, headline: n.headline, body: n.body, href: noticeHrefFor(n), dismissible: noticeDismissible(n.kind, n.period) && !(principal.scope && NOTICE_ACCOUNT_KINDS.has(n.kind)), tier: noticeTier(n.kind), priority: noticePriority(n.kind, n.period) }));

  // FIX 1: a synthetic "new enquiries" row so a brand-new website lead reaches the
  // bell popup + the Inbox the same way every other needs-you item does — nothing
  // else raised this signal into the ONE feed before. Deduped against the
  // lead-followup cron notice (which covers AGED 'new' leads): the synthetic row
  // counts only still-fresh enquiries not yet represented by a follow-up notice,
  // so one submission never stacks two rows. (inbox.html renders per-lead detail
  // from /forms/inbox and filters this aggregate kind to avoid a double listing.)
  if (seesFull) {
    const newEnquiries = freshEnquiries(Math.min((((enqQ.ok && enqQ.json) || []) as any[]).length, FEED_ENQUIRIES), notices);
    if (newEnquiries > 0) notices.unshift({
      id: 'new-enquiries', kind: 'website_enquiry', period: null, dismissible: false, tier: 'needs_you', priority: false,
      headline: newEnquiries === 1 ? 'A new enquiry came in' : `${newEnquiries} new enquiries came in`,
      body: 'Someone reached out through your website and is waiting to hear back.',
      href: noticeHref('website_enquiry'),
    });

    // G11: a client left feedback on the shared draft — one synthetic row that
    // links straight into the builder's Comments panel (Design view). Mirrors
    // the new-enquiries row: counted live, never stored, gone when resolved.
    const openFeedback = feedbackQ || 0;
    if (openFeedback > 0) notices.unshift({
      id: 'client-feedback', kind: 'client_feedback', period: null, dismissible: false, tier: 'needs_you', priority: false,
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
        id: 'missing-required', kind: 'missing_required', period: null, dismissible: false, tier: 'needs_you', priority: false,
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
        if (unread > 0) notices.unshift({ id: 'bridge-updates', kind: 'client_updates', period: null, dismissible: false, tier: 'needs_you', priority: false, headline: unread === 1 ? 'An update from your studio' : `${unread} updates from your studio`, body: 'New activity on your project — messages, files, or something to approve.', href: '/client.html' });
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
  let client_messages: any[] = [], client_messages_more = false;
  if (seesFull) {
    try {
      // supR + evR landed in the initial wave above.
      // Summarize EVERY project conversation, not only the ones awaiting a reply, so
      // the operator sees who they're talking with even after they've answered.
      // The rules are PURE (lib/inbox_feed.ts shapeClientConversations) and carry
      // two R-fixes (F6): a STUDIO-side event of a widened kind — projectEvent
      // stamps no detail.from — no longer inflates the client-conversation count,
      // and a client APPROVING cleanly no longer flips the thread to needs-reply
      // (a rejection or change-request still does).
      const convo = shapeClientConversations(((evR.json as any[]) || []));
      const sup = ((supR.json as any[]) || []);
      // A support row's honest "latest client activity" = max(the request itself,
      // its newest CLIENT-authored reply). updated_at can't drive unread: client
      // replies only INSERT into presence_support_messages (never bump it) while
      // studio actions DO bump it (triage PATCH, the open→in_progress bump on a
      // studio reply) — wrong in both directions once a mark exists. ONE batched,
      // site-scoped messages read; null on failure → the rows below fall back to
      // the old updated_at behavior rather than failing the feed (best-effort).
      let supClientAt: Record<string, string> | null = null;
      const supAnyAt: Record<string, string> = {};
      if (sup.length) {
        try {
          const mr = await svc(`presence_support_messages?site_id=eq.${site.id}&request_id=in.(${sup.map((r) => String(r.id)).join(',')})&deleted_at=is.null&select=request_id,author_kind,created_at&order=created_at.desc&limit=500`);
          if (mr.ok && Array.isArray(mr.json)) {
            supClientAt = newestClientMessageAt(mr.json as any[]);
            // the newest message by anyone: a support row's time is real activity, not updated_at (portal walk, Nov 8)
            for (const m of mr.json as any[]) { const k = String(m.request_id || ''), at = String(m.created_at || ''); if (k && at && !(supAnyAt[k] > at)) supAnyAt[k] = at; }
          }
        } catch { supClientAt = null; }
      }
      const supWhen = (r: any): string => supportActivityAt(r, supAnyAt[String(r.id)] || null) || String(r.updated_at || '');
      // bug hunt C10: an open request the studio has answered is open, but no longer
      // waiting for a reply — the Inbox's Needs reply goes by whose word was last
      const supNeedsReply = (r: any): boolean => {
        if (!supClientAt) return true;   // the messages read failed → as before
        const last = supAnyAt[String(r.id)] || '';
        return !last || supLatestClient(r) >= last;
      };
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
      // F3: rows stamped at write time name their client directly — make sure the
      // name lookup below covers them even when no bridge/project ties them in.
      // Sales review B2 (Nov 2026): a request filed before the stamp existed, by a
      // customer tied to their workspace by email, matched nobody and read
      // "Support request". Resolve and stamp it once (lib/service_bridge.ts);
      // one that still names no customer shows the sender's email instead.
      const owners = await healSupportOwners(site.id, sup);
      for (const r of sup) { const cid = owners.clientOf[String(r.id)]; if (cid && !r.client_id) r.client_id = cid; }
      for (const r of sup) { if (r.client_id) clientIds.add(String(r.client_id)); }
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
      // F3: the write-time client_id stamp (0115) is PREFERRED; the bridge/project
      // mapping and the requester-key string match remain the fallback for
      // pre-stamp rows (deploy-order tolerant in both directions).
      const clientFor = (pid: string, requester: string, stamped = '') => {
        const cid = stamped || (pid && (projToClient[pid] || projById[pid]?.client_id)) || (requester ? requesterToClient[requester] : '') || '';
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
      // project_id (additive): the message rows below have always carried it, so
      // the Inbox's project lens could filter a conversation but not the support
      // thread sitting on the SAME project — the row carried only the project's
      // NAME. Stamping the id makes the lens whole. Purely additive: the page
      // falls back to matching a support row by project name when this is absent
      // (an older function build), so neither deploy order drops a row.
      for (const r of sup) { const pid = r.project_id ? String(r.project_id) : ''; const c = clientFor(pid, String(r.requester || ''), r.client_id ? String(r.client_id) : ''); const profilePid = pid || (c.client_id ? clientToProject[c.client_id] || '' : ''); const tk = `support:${r.id}`; client_messages.push({ type: 'support', id: r.id, subject: String(r.subject || 'Support request').slice(0, 120), status: String(r.status || 'open'), priority: String(r.priority || 'normal'), assigned_to: r.assigned_to ? String(r.assigned_to) : null, project: pid ? (projById[pid]?.name || '') : '', project_id: pid, client_id: c.client_id, client: c.client || owners.nameOf[String(r.id)] || owners.emailOf[String(r.id)] || '', created_at: supWhen(r), thread_key: tk, unread: threadUnread(supLatestClient(r), markFor(tk), true), needs_reply: supNeedsReply(r), href: profilePid ? `/crm.html?project=${profilePid}&tab=messages` : `/projects.html?support=${r.id}` }); }
      for (const [pid, cv] of convo) { const c = clientFor(pid, ''); const needsReply = cv.needsReply; const tk = c.client_id ? `client:${c.client_id}` : `client:${pid}`; client_messages.push({ type: 'message', project: projById[pid]?.name || '', project_id: pid, client_id: c.client_id, client: c.client, created_at: cv.latest.created_at, needs_reply: needsReply, count: cv.count, thread_key: tk, unread: threadUnread(cv.latestClientAt, markFor(tk), needsReply), href: `/crm.html?project=${pid}&tab=messages` }); }
      client_messages.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      client_messages_more = client_messages.length > FEED_CONVERSATIONS;   // C15: the Inbox says it shows the newest only
      client_messages = client_messages.slice(0, FEED_CONVERSATIONS).map((r) => ({ ...r, tier: (r.type === 'support' ? (r.status === 'open' || r.status === 'in_progress') : !!r.needs_reply) ? 'needs_you' : 'update', priority: false }));
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
  let enquiries: any[] | undefined = [], enquiries_more = false;
  if (seesFull) {
    try {
      enquiries_more = ((enqQ as any).ok && Array.isArray((enqQ as any).json)) && ((enqQ as any).json as any[]).length > FEED_ENQUIRIES;
      enquiries = ((enqQ as any).ok && Array.isArray((enqQ as any).json))
        ? (((enqQ as any).json) as any[]).slice(0, FEED_ENQUIRIES).map((f) => {
          const tk = `lead:${f.id}`;
          return {
            id: f.id, form_kind: String(f.form_kind || 'contact'), name: String(f.name || ''), email: String(f.email || ''),
            // bug hunt C2: the first FEED_MESSAGE_CHARS only, and a word when there is more
            // (the Inbox keeps the queue's whole message; this is for when that read failed)
            phone: String(f.phone || ''), message: String(f.message || '').slice(0, FEED_MESSAGE_CHARS), message_cut: String(f.message || '').length > FEED_MESSAGE_CHARS, status: String(f.status || 'new'),
            created_at: f.created_at, thread_key: tk, unread: threadUnread(String(f.created_at || ''), markFor(tk), true),
            tier: String(f.status || 'new') === 'new' ? 'needs_you' : 'update', priority: false,
          };
        })
        : undefined;
    } catch { enquiries = undefined; /* best-effort — the feed still works without the rows */ }
  }
  const data = { role, moments, notices, pending_approvals: pending, last_published: last, client_messages, enquiries, client_messages_more, enquiries_more };
  // studio level = an agency member on their own site, not drilled in
  if (seesFull && !principal.scope) {
    const member = await resolveAgencyMember(jwt).catch(() => null);
    if (member) return studioLevelFeed(data);
  }
  return data;
}

// Builder item 53: the words a role goes by, everywhere a person reads one
export const SEAT_ROLE_WORDS: Record<SiteRole, string> = { business_owner: 'Co-owner', business_staff: 'Staff', developer: 'Developer', client_reviewer: 'Reviewer' };
const STUDIO_ROLE_WORDS: Record<string, string> = { owner: 'Studio owner', admin: 'Admin', account_manager: 'Account manager' };

/** The studio that works on this site, and who on its team can open it (the roles
 *  lib/scope.ts lets in). Null when no studio works on it or the read failed. */
async function studioOf(siteId: string, me: string | null): Promise<{ name: string; role: string; people: Array<{ email: string; role: string; me: boolean }> } | null> {
  try {
    const link = ((await svc(`presence_agency_clients?site_id=eq.${siteId}&status=eq.active&select=agency_id&limit=1`)).json as any[])?.[0];
    if (!link?.agency_id) return null;
    const [ag, team] = await Promise.all([
      svc(`presence_agencies?id=eq.${link.agency_id}&select=name&limit=1`),
      svc(`presence_agency_members?agency_id=eq.${link.agency_id}&status=eq.active&select=email,role&order=created_at.asc&limit=200`),
    ]);
    const { can } = await import('../agency/auth.ts');
    const mine = String(me || '').toLowerCase();
    const people = (((team.json as any[]) || []).filter((m) => can(m.role, 'bulk_publish')))
      .map((m) => ({ email: String(m.email || '').toLowerCase(), role: STUDIO_ROLE_WORDS[m.role] || String(m.role || ''), me: !!mine && String(m.email || '').toLowerCase() === mine }));
    return { name: String(((ag.json as any[]) || [])[0]?.name || 'Your studio'), role: 'Website manager', people };
  } catch { return null; }
}

/** The People sheet (builder item 53): the owner, the studio that works on the site,
 *  the seats, an open transfer, and who may start one. `data` stays the seat list. */
export async function handleMembersList(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const g = await requireManager(jwt, site, principal, cors); if (g instanceof Response) return g;
  const now = new Date().toISOString();
  const { ownerFacts, ownerWho, openTransfer, transferSummary, lastSignIn } = await import('../lib/site_transfer.ts');
  const { transferSideFor } = await import('./site_transfer.ts');
  const [members, facts, open, studio, side] = await Promise.all([
    listSiteMembers(site.id),
    ownerFacts(site.id).catch(() => null),
    openTransfer(site.id, now).catch(() => ({ row: null, missing: true })),
    studioOf(site.id, principal.email),
    transferSideFor(jwt, site, principal).catch(() => null),
  ]);
  const who = ownerWho(facts?.client, facts?.contact?.name);
  const signedIn = who ? await lastSignIn(facts?.contact?.auth_user_id) : undefined;
  const owner = who ? { ...who, signed_in: signedIn === undefined ? null : signedIn !== null, me: !!principal.email && who.email === String(principal.email).toLowerCase() } : null;
  return json({ data: members.map((m) => ({ ...m, role_words: SEAT_ROLE_WORDS[m.role as SiteRole] || m.role })), owner, studio, transfer: transferSummary(open.row, now), transfer_ready: !open.missing, can_transfer: side }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

const ADD_WORDS: Record<string, [number, string]> = {
  bad_email: [400, 'That doesn’t look like an email address.'],
  bad_role: [400, 'Pick a role: Co-owner, Staff, Developer or Reviewer.'],
  shared_site: [400, 'This is your studio’s own site, which holds every client’s files, so a reviewer here would see them all. Open that client and invite the reviewer there instead.'],
  check_failed: [502, 'We couldn’t check this site just now, so nobody was added. Try again in a moment.'],
  is_owner: [409, 'That’s the owner’s own email. The owner already has everything.'],
  write_failed: [502, 'That didn’t save — please try again.'],
};

export async function handleMemberAdd(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const g = await requireManager(jwt, site, principal, cors); if (g instanceof Response) return g;
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  if (body?.resend === true) {
    // "Send it again": the same seat, the same role, a fresh sign-in email; nothing else changes
    const again = await resendSiteInvite(site.id, String(body?.email || ''));
    if (!again.ok) return again.error === 'not_found' ? json({ error: 'not_found', message: 'They aren’t on this site any more.' }, 404, cors) : json({ error: 'check_failed', message: ADD_WORDS.check_failed[1] }, 502, cors);
    return json({ data: { ok: true, emailed: !!again.emailed, member: again.member, message: again.emailed ? `Sent ${again.member?.email || 'them'} a new sign-in link.` : 'The email didn’t send. Try again in a moment.' } }, again.emailed ? 200 : 502, cors);
  }
  const { ownerFacts, ownerEmailsOf } = await import('../lib/site_transfer.ts');
  const ownerEmails = ownerEmailsOf(await ownerFacts(site.id).catch(() => null));
  const res = await addSiteMember(site.id, String(body?.email || ''), body?.role, principal.userId || 'owner', { restore: body?.restore === true, ownerEmails });
  if (!res.ok) {
    const m = res.member, words = m ? (SEAT_ROLE_WORDS[m.role as SiteRole] || m.role) : '';
    // bug hunt I1's rule, here too: someone already here is pointed at, never invited again
    if (res.error === 'already_member') return json({ error: 'already_member', member: m ? { id: m.id, email: m.email, role: m.role } : null, message: `${m?.email || 'They'} ${m ? `are already here as ${words}` : 'are already here'}. Change their role in the list instead.` }, 409, cors);
    if (res.error === 'was_removed') return json({ error: 'was_removed', member: m ? { id: m.id, email: m.email, role: m.role } : null, message: `${m?.email || 'They'} were removed earlier. Press Bring them back to let them in again with the role you picked.` }, 409, cors);
    const [status, message] = ADD_WORDS[res.error || 'write_failed'] || ADD_WORDS.write_failed;
    return json({ error: res.error, message }, status, cors);
  }
  const reviewer = body?.role === 'client_reviewer';
  const message = res.emailed
    ? (reviewer ? 'Invited — we’ve emailed them a sign-in link. They’ll see only what you choose to share.' : `Invited as ${SEAT_ROLE_WORDS[body.role as SiteRole] || 'a member'} — we’ve emailed them a sign-in link.`)
    : 'Added — but the invite email didn’t send. Send them their sign-in link yourself, or try again.';
  return json({ data: { ok: true, emailed: !!res.emailed, restored: !!res.restored, member: res.member || null, message } }, 200, cors);
}

/** Change one seat's role (builder item 53). The owner's own role isn't a seat, so it
 *  can't be changed here; handing the site over is Transfer ownership. */
export async function handleMemberRole(req: Request, jwt: string, site: SiteRow, memberId: string, principal: Principal, cors: Record<string, string>) {
  const g = await requireManager(jwt, site, principal, cors); if (g instanceof Response) return g;
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const res = await changeSiteMemberRole(site.id, memberId, body?.role);
  if (!res.ok) {
    if (res.error === 'not_found') return json({ error: 'not_found', message: 'That person isn’t on this site any more.' }, 404, cors);
    const [status, message] = ADD_WORDS[res.error || 'write_failed'] || ADD_WORDS.write_failed;
    return json({ error: res.error, message }, status, cors);
  }
  return json({ data: { ok: true, member: res.member, message: `${res.member?.email || 'Their role'} is now ${SEAT_ROLE_WORDS[body.role as SiteRole] || body.role}.` } }, 200, cors);
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
