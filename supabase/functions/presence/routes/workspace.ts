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
import { resolveSiteRole, listSiteMembers, addSiteMember, revokeSiteMember, loadShares, overrideFor, setShare } from '../lib/workspace.ts';

/** The ONLY routes a client_reviewer (the client portal audience) may reach.
 *  Everything else in the client gate is 403 for a reviewer — so the simplified
 *  portal is a real security boundary, not a UI facade. Pure + exported for tests.
 *  Reviewer = read the shared feed, and approve the plans put to them. */
export function reviewerAllowed(route: string, method: string): boolean {
  if (method === 'GET' && (route === '/portal/context' || route === '/portal/feed')) return true;
  if (method === 'GET' && route === '/projects') return true;                                   // P2-D: client sees its visible projects
  if (method === 'GET' && /^\/projects\/[0-9a-f-]{36}$/.test(route)) return true;               // P2-D: a client-visible project's status (handler filters visibility)
  if (method === 'GET' && /^\/projects\/[0-9a-f-]{36}\/deliverables\/[0-9a-f-]{36}\/download$/.test(route)) return true; // P2-D-2: download a shared deliverable
  if (method === 'POST' && /^\/approvals\/[0-9a-f-]{36}\/decide$/.test(route)) return true;      // P2-D-2: the client decides an approval put to them
  if (method === 'POST' && /^\/foundations\/plans\/[0-9a-f-]{36}\/decide$/.test(route)) return true;   // approve an infra plan
  if (method === 'POST' && /^\/connections\/[a-z0-9_]+\/write\/[0-9a-f-]{36}\/decide$/.test(route)) return true; // approve a connected write
  if (method === 'POST' && /^\/assets\/[0-9a-f-]{36}\/status$/.test(route)) return true; // DAM-2: approve/reject a file (action-restricted in the handler)
  if (method === 'POST' && /^\/launches\/[0-9a-f-]{36}\/decide$/.test(route)) return true; // FD-T7: approve/reject a staged launch
  return false;
}

async function requireManager(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<{ role: SiteRole } | Response> {
  const role = await resolveSiteRole(jwt, site.id, principal.kind);
  if (!siteCan(role, 'invite') && !siteCan(role, 'configure')) {
    return json({ error: 'forbidden', message: 'Only the account owner can manage who sees what.' }, 403, cors);
  }
  return { role };
}

export async function handlePortalContext(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>, scopedName?: string | null) {
  const role = await resolveSiteRole(jwt, site.id, principal.kind);
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
      const ent = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(site.client_id)}&product=eq.presence&select=plan&limit=1`);
      const plan = ent.ok && Array.isArray(ent.json) && ent.json[0]?.plan;
      if (plan) { planKey = String(plan); editionKey = editionFromPlan(planKey); }
    }
  } catch { /* keep the fallback edition */ }

  // Phase P: the honest upsell — the next self-serve rung + what it GAINS (from
  // featureDelta, so it can never overpromise). Shown only to owners (never to
  // client reviewers or operators); null at the top of the ladder = no card.
  let upsell: { plan_key: string; name: string; tagline: string; monthly: number | null; gains: string[] } | null = null;
  if (planKey && role === 'business_owner' && !isOperator) {
    const next = nextPlanUp(planKey);
    if (next) {
      const gains = featureDelta(editionKey, editionFromPlan(next.key)).gained;
      upsell = { plan_key: next.key, name: next.name, tagline: next.tagline || '', monthly: next.monthly, gains: gains.slice(0, 4) };
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
    const [nQ, iQ, wQ, fQ] = await Promise.all([
      seesFull ? svc(`presence_plan_notices?site_id=eq.${site.id}&status=eq.active&select=id`) : none,
      showApprovals ? svc(`presence_infra_plans?site_id=eq.${site.id}&status=eq.proposed&select=id`) : none,
      showApprovals ? svc(`presence_connection_writes?site_id=eq.${site.id}&status=eq.proposed&select=id`) : none,
      showApprovals ? svc(`presence_media?site_id=eq.${site.id}&asset_status=eq.pending&deleted_at=is.null&select=id,metadata`) : none, // DAM-2: files awaiting approval
    ]);
    const filesPending = ((fQ.json as any[]) || []).filter((m) => (m.metadata || {}).pending_replace).length;
    attention_count = ((nQ.json as any[])?.length || 0) + ((iQ.json as any[])?.length || 0) + ((wQ.json as any[])?.length || 0) + filesPending;
  } catch { /* the badge is best-effort — never block the shell on it */ }

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
  domain_expiry: '/presence.html#business',
  search_setup: '/presence.html#search',
  welcome_back: '/today.html',
  capacity: '/portal.html', trial_ending: '/portal.html', trial_ended: '/portal.html',
  payment_trouble: '/portal.html', account_lapsed: '/portal.html',
  winddown_reminder: '/portal.html', win_back: '/portal.html', deletion_requested: '/portal.html',
};
const noticeHref = (k: string): string => NOTICE_HREF[k] || '/today.html';

/** The client portal's read: only what's shared with the reviewer — shared
 *  Business Moments, the site's publish status, and the plans awaiting their OK.
 *  Computed server-side with the visibility model, so it can never over-expose. */
export async function handlePortalFeed(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const role = await resolveSiteRole(jwt, site.id, principal.kind);
  const shares = await loadShares(site.id);
  const seesFull = siteCan(role, 'view_all');   // owner surfaces get the notices rail; reviewers don't
  const [momQ, pubQ, infraQ, writeQ, noticeQ, fileQ] = await Promise.all([
    svc(`presence_moments?site_id=eq.${site.id}&status=eq.active&select=id,headline,summary,moment_type,created_at&order=created_at.desc&limit=10`),
    svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=created_at,completed_at&order=created_at.desc&limit=1`),
    svc(`presence_infra_plans?site_id=eq.${site.id}&status=eq.proposed&select=id,title,summary,risk&limit=10`),
    svc(`presence_connection_writes?site_id=eq.${site.id}&status=eq.proposed&select=id,provider_key,title,summary&limit=10`),
    seesFull ? svc(`presence_plan_notices?site_id=eq.${site.id}&status=eq.active&select=id,kind,headline,body,created_at&order=created_at.desc&limit=10`) : Promise.resolve({ ok: true, json: [] as any[] }),
    svc(`presence_media?site_id=eq.${site.id}&asset_status=eq.pending&deleted_at=is.null&select=id,storage_path,alt_text,metadata&limit=10`), // DAM-2: files awaiting approval
  ]);
  const moments = filterForRole(role, (momQ.ok && momQ.json) || [], (m: any) => ({ surface: 'business_moments', override: overrideFor(shares, 'business_moments', m.id) }));
  // approvals are 'always' visible to the reviewer (they must see what to approve)
  const showApprovals = visibleTo(role, 'approvals');
  const pending = showApprovals ? [
    ...(((infraQ.ok && infraQ.json) || []) as any[]).map((p) => ({ id: p.id, kind: 'infrastructure', title: p.title, summary: p.summary, decide_path: `/foundations/plans/${p.id}/decide` })),
    ...(((writeQ.ok && writeQ.json) || []) as any[]).map((p) => ({ id: p.id, kind: 'connected', provider: p.provider_key, title: p.title, summary: p.summary, decide_path: `/connections/${p.provider_key}/write/${p.id}/decide` })),
    // DAM-2: a file replacement waiting for approval — same feed, links into Files
    ...(((fileQ.ok && fileQ.json) || []) as any[]).filter((m) => (m.metadata || {}).pending_replace).map((m) => ({ id: m.id, kind: 'file', title: `Replace ${displayName(m)}`, summary: 'A file replacement is waiting for your OK before it goes live.', decide_path: `/assets/${m.id}/status`, href: `/files.html?focus=${m.id}` })),
  ] : [];
  const last = (pubQ.ok && pubQ.json?.[0]) || null;
  // Phase FLOW: the notices rail joins the ONE global feed the shell bell reads,
  // so "a lead is waiting" / "your domain expires soon" surface on every page —
  // not only in the portal card. Each carries the href that resolves it.
  const notices = (((noticeQ.ok && noticeQ.json) || []) as any[]).map((n) => ({ id: n.id, kind: n.kind, headline: n.headline, body: n.body, href: noticeHref(n.kind) }));
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
  return json({ data: { ok: true, message: 'Added. They’ll see only what you choose to share.' } }, 200, cors);
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
