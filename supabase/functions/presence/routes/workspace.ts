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
import { svc } from '../lib/db.ts';
import { displayName } from '../lib/dam.ts';
import { resolveSiteRoleCached, listSiteMembers, addSiteMember, revokeSiteMember, loadShares, overrideFor, setShare } from '../lib/workspace.ts';

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
  // agency membership drives the Agency nav section (reviewers never need it)
  let isAgency = false;
  if (role !== 'client_reviewer') { try { isAgency = !!(await resolveAgencyMember(jwt)); } catch { /* */ } }
  const caps = capabilitiesOf(role);

  // Phase D: resolve the FEATURE edition from the licensed plan (falls back to
  // the site edition when no entitlement plan is recorded). Navigation adapts to
  // it automatically — one nav, many editions. Never throws on missing rows.
  let editionKey: EditionKey = editionFromSite(site.edition, { isAgency });
  let planKey: string | null = null;
  try {
    if (site.client_id) {
      // shared per-request memo — the boundary gate already read this row
      const { entitlementFor } = await import('../middleware/entitlement.ts');
      const plan = (await entitlementFor(principal, site.client_id)).plan;
      if (plan) { planKey = String(plan); editionKey = editionFromPlan(planKey); }
    }
  } catch { /* keep the fallback edition */ }

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
  // Active notices (owner surfaces only) + plans awaiting approval, one cheap
  // parallel read on the boot path; best-effort so the shell never breaks on it.
  let attention_count = 0;
  try {
    const seesFull = siteCan(role, 'view_all');
    const showApprovals = visibleTo(role, 'approvals');
    const none = Promise.resolve({ ok: true, json: [] as any[] });
    const [nQ, iQ, wQ, fQ, eQ] = await Promise.all([
      seesFull ? svc(`presence_plan_notices?site_id=eq.${site.id}&status=eq.active&select=id,kind`) : none,
      showApprovals ? svc(`presence_infra_plans?site_id=eq.${site.id}&status=eq.proposed&select=id`) : none,
      showApprovals ? svc(`presence_connection_writes?site_id=eq.${site.id}&status=eq.proposed&select=id`) : none,
      showApprovals ? svc(`presence_media?site_id=eq.${site.id}&asset_status=eq.pending&deleted_at=is.null&select=id,metadata`) : none, // DAM-2: files awaiting approval
      // FIX 1: brand-new website enquiries must ring the bell too (owner surfaces only).
      seesFull ? svc(`presence_form_submissions?site_id=eq.${site.id}&spam=eq.false&status=eq.new&select=id&limit=50`) : none,
    ]);
    const filesPending = ((fQ.json as any[]) || []).filter((m) => (m.metadata || {}).pending_replace).length;
    // FIX 1 dedupe: the lead-followup cron already raises a per-lead notice for AGED
    // 'new' leads (counted via nQ). Count only the still-fresh new enquiries not yet
    // represented by a follow-up notice, so a single lead never stacks two signals.
    const leadFollowups = ((nQ.json as any[]) || []).filter((n) => n.kind === 'lead_followup').length;
    const newEnquiries = Math.max(0, ((eQ.json as any[])?.length || 0) - leadFollowups);
    attention_count = ((nQ.json as any[])?.length || 0) + ((iQ.json as any[])?.length || 0) + ((wQ.json as any[])?.length || 0) + filesPending + newEnquiries;
  } catch { /* the badge is best-effort — never block the shell on it */ }

  // P2-D: fold service delivery into the ONE attention surface (no second bell).
  try {
    if (siteCan(role, 'view_all')) { // studio: open support requests + unread client messages need triage
      const reader = String(principal.userId || principal.email || 'anon'); // same key /notifications(/read) uses
      const [sup, seenQ, msgQ] = await Promise.all([
        svc(`presence_support_requests?site_id=eq.${site.id}&status=in.(open,in_progress)&deleted_at=is.null&select=id&limit=50`),
        svc(`presence_activity_reads?site_id=eq.${site.id}&reader=eq.${encodeURIComponent(reader)}&select=last_seen_at&limit=1`),
        // FD-N: a client's message — AND their approval decisions / survey answers —
        // must reach the bell/Today, not only the Inbox.
        svc(`presence_project_events?site_id=eq.${site.id}&kind=in.(message,approval_decided,survey_submitted)&select=created_at,kind,detail,actor_kind&order=created_at.desc&limit=50`),
      ]);
      attention_count += ((sup.json as any[])?.length || 0);
      const lastSeen = (seenQ.json as any[])?.[0]?.last_seen_at || null;
      attention_count += ((msgQ.json as any[]) || []).filter((e) => {
        if (lastSeen && String(e.created_at) <= String(lastSeen)) return false;
        // detail.from='client' is stamped ONLY by the client door (client_delivery.ts)
        // — actor_kind can't distinguish the customer from the studio owner (both
        // 'client'), and the studio's own decisions must never ring its own bell.
        return (e.detail || {}).from === 'client';
      }).length;
    } else if (site.client_id) { // bridged customer: their UNREAD client-visible delivery activity
      const links = ((await svc(`presence_service_links?customer_client_id=eq.${site.client_id}&status=eq.active&select=project_id,agency_site_id&limit=50`)).json as any[]) || [];
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

  const navCtx = { role, edition: site.edition, capabilities: caps, isAgency, isOperator, editionKey };
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
};
export const noticeHref = (k: string): string => NOTICE_HREF[k] || '/today.html';

/** The client portal's read: only what's shared with the reviewer — shared
 *  Business Moments, the site's publish status, and the plans awaiting their OK.
 *  Computed server-side with the visibility model, so it can never over-expose. */
export async function handlePortalFeed(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const role = await resolveSiteRoleCached(principal, jwt, site.id);
  const shares = await loadShares(site.id);
  const seesFull = siteCan(role, 'view_all');   // owner surfaces get the notices rail; reviewers don't
  const noEnq = Promise.resolve({ ok: true, json: [] as any[] });
  // FIX 4: kick off the Content Tree read CONCURRENTLY with the feed's own queries
  // (owner-only, best-effort) so surfacing missing-required content adds no serial
  // latency to this bell hot path. Dynamic import avoids any top-level import cycle.
  const treeP: Promise<any> = seesFull
    ? import('./room.ts').then((m) => m.siteContentTree(site)).catch(() => null)
    : Promise.resolve(null);
  const [momQ, pubQ, infraQ, writeQ, noticeQ, fileQ, enqQ] = await Promise.all([
    svc(`presence_moments?site_id=eq.${site.id}&status=eq.active&select=id,headline,summary,moment_type,created_at&order=created_at.desc&limit=10`),
    svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=created_at,completed_at&order=created_at.desc&limit=1`),
    svc(`presence_infra_plans?site_id=eq.${site.id}&status=eq.proposed&select=id,title,summary,risk&limit=10`),
    svc(`presence_connection_writes?site_id=eq.${site.id}&status=eq.proposed&select=id,provider_key,title,summary&limit=10`),
    seesFull ? svc(`presence_plan_notices?site_id=eq.${site.id}&status=eq.active&select=id,kind,headline,body,created_at&order=created_at.desc&limit=10`) : Promise.resolve({ ok: true, json: [] as any[] }),
    svc(`presence_media?site_id=eq.${site.id}&asset_status=eq.pending&deleted_at=is.null&select=id,storage_path,alt_text,metadata&limit=10`), // DAM-2: files awaiting approval
    // FIX 1: brand-new website enquiries (owner surfaces only) — one synthetic feed
    // row so the bell + Inbox surface them like every other needs-you item.
    seesFull ? svc(`presence_form_submissions?site_id=eq.${site.id}&spam=eq.false&status=eq.new&select=id&limit=50`) : noEnq,
  ]);
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
      const links = ((await svc(`presence_service_links?customer_client_id=eq.${site.client_id}&status=eq.active&select=project_id,agency_site_id&limit=50`)).json as any[]) || [];
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
  return json({ data: { role, moments, notices, pending_approvals: pending, last_published: last } }, 200, cors);
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
