// ── The /agency router (M13) — orchestration over the frozen platform ───────
// Every handler: membership resolved (fail-closed) → role capability check →
// operations fenced to the agency's OWN linked sites → dispatch EXISTING
// per-site engines / read EXISTING rows. Nothing here has a power that a
// single-site route lacks; nothing bypasses client ownership (drafts and
// plans still wait on the client; publishing runs the one frozen pipeline).
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { noticeTier } from '../lib/inbox_feed.ts';
import { can, agencySiteIds } from './auth.ts';
import { buildPortfolio, filterPortfolio, buildQueues, buildPatterns } from './portfolio.ts';
import { needsYouPayload, dealNoticeIds, staleDealNotices, snoozeUntil, SNOOZE_KEY_RE, SNOOZE_MAX_DAYS } from './needs_you.ts';
import { clearNotice } from '../lib/notice.ts';
import { healSupportOwners, supportActivity } from '../lib/service_bridge.ts';
import { buildPortalFeed, noticeHrefFor } from '../routes/workspace.ts';
import { loadReceivables } from '../routes/sales.ts';
import { resolveSite, SITE_COLS } from '../lib/site.ts';
import type { AgencyMember } from './auth.ts';
import type { PortfolioInput } from './portfolio.ts';
import type { KitPayload } from '../lib/kits.ts';
import { kitFromSite, applyKitTo } from './kit_io.ts';
import { handleAgencySites } from './sites.ts';
import { HIDEABLE_SECTIONS, normalizeHidden } from '../lib/navigation.ts';
import { readReservedJsonOrThrow, writeReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { sendInviteLink } from '../lib/workspace.ts';
import { brandFromKit } from '../lib/email_brand.ts';
import { runEvidence } from '../evidence/engine.ts';
import { runJudgment } from '../judgment/engine.ts';
import { runRecommendation } from '../recommendation/engine.ts';
import { runMoments } from '../moments/engine.ts';
import { runGrowthCoach } from '../coach/engine.ts';
import { runReview } from '../reviewer/engine.ts';
import { runBrandReview } from '../guardian/engine.ts';
import { computeReadiness } from '../routes/monitor.ts';
import { handlePublish } from '../routes/publish.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
// ── L5.7: orchestrate Enterprise + the Approved-Plan tables (never duplicate) ──
import { getOrganization, listLocations, saveOrgOperation, decideOrgOperation } from '../enterprise/store.ts';
import { planOrgOperation } from '../enterprise/rollout.ts';
import { ORG_OPS } from '../enterprise/contract.ts';
import type { OrgOp } from '../enterprise/contract.ts';
import { crossOrgRollup, approvalQueue, crossClientSummary } from './orchestrate.ts';
import type { PendingPlan } from './orchestrate.ts';
import { resolveIndustryKey } from '../industry/registry.ts';
import { loadCustomerNames } from '../lib/customer_names.ts';
import { isCustomerOfStudio, claimPortfolioSite } from '../lib/connect_requests.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';

const forbid = (cors: Record<string, string>) => json({ error: 'forbidden', message: 'Your role doesn’t include this.' }, 403, cors);

async function loadSites(ids: string[]): Promise<SiteRow[]> {
  if (!ids.length) return [];
  const r = await svc(`presence_sites?id=in.(${ids.join(',')})&select=${SITE_COLS}`);
  return r.json ?? [];
}

/* ── the fixed-cost gather: one batched query per table, any client count ──
 *  Exported so Analytics (AN-7) composes the SAME portfolio rollup — no duplicate aggregation. */
export async function gather(agencyId: string, nowIso: string): Promise<PortfolioInput> {
  const linksQ = await svc(`presence_agency_clients?agency_id=eq.${agencyId}&select=site_id,status,tags,owner_email,assigned,notes,onboarded_at&limit=1000`);
  const links = (linksQ.json ?? []) as PortfolioInput['links'];
  const ids = links.map((l) => l.site_id);
  if (!ids.length) {
    return { sites: [], links: [], clientNames: {}, moments: [], evidence: [], opportunities: [], plans: [], drafts: [], connections: [], reviewReports: [], brandReports: [], lastChange: {}, nowIso };
  }
  const IN = `site_id=in.(${ids.join(',')})`;
  // Speed (final pass, Nov 8: batch B): the customer-links read rides this first
  // wave, and the three reads that wait on it (the latest runs' evidence, the
  // client names, their billing) go side by side — six waits became four.
  const [sitesQ, momQ, oppQ, planQ, draftQ, connQ, revQ, brandQ, evtQ, runQ, leadsQ, noticesQ, filesQ, slQ] = await Promise.all([
    svc(`presence_sites?id=in.(${ids.join(',')})&select=id,client_id,edition,status,last_published_at,custom_domain,domain_registrar,domain_expires_at,cert_expires_at,cert_pending_since,domain_serving,domain_statuses&limit=1000`),   // cert_*: item 134 (0149); domain_serving (0153); domain_statuses: item 162 (0162)
    svc(`presence_moments?${IN}&status=eq.active&select=site_id,moment_key,moment_type,headline&limit=1000`),
    svc(`presence_growth_opportunities?${IN}&status=eq.open&select=site_id,area,opportunity,timing_ends,created_at&limit=1000`),
    svc(`presence_infra_plans?${IN}&status=in.(proposed,approved)&select=site_id,kind,title,status&limit=1000`),
    svc(`presence_ai_drafts?${IN}&status=eq.proposed&select=site_id,kind,status,created_at&limit=1000`),
    svc(`presence_monitor_connections?${IN}&select=site_id,status,readiness&limit=1000`),
    svc(`presence_ai_reviews?${IN}&status=eq.open&select=site_id,status,open_count&limit=1000`),
    svc(`presence_brand_reports?${IN}&status=eq.open&select=site_id,status,open_count&limit=1000`),
    svc(`presence_change_events?${IN}&select=site_id,created_at&order=created_at.desc&limit=1000`),
    svc(`presence_evidence_runs?${IN}&finished_at=not.is.null&error_text=is.null&select=id,site_id,started_at&order=started_at.desc&limit=500`),
    svc(`presence_form_submissions?${IN}&status=eq.new&spam=is.false&select=id,site_id,name,email,form_kind,created_at&limit=2000`),   // Section 3: leads waiting (+ who/when for Needs you)
    svc(`presence_plan_notices?${IN}&status=eq.active&select=id,site_id,kind,period,headline,body,created_at&limit=2000`),   // Section 3: attention + billing; item 47: the words too, for the bell's news per site
    svc(`presence_media?${IN}&asset_status=eq.pending&deleted_at=is.null&select=site_id,metadata&limit=2000`), // DAM-2: files awaiting approval
    svc(`presence_service_links?customer_site_id=in.(${ids.join(',')})&status=eq.active&select=agency_site_id,customer_site_id,customer_client_id&limit=1000`).catch(() => ({ ok: false, json: [] as unknown[] })),   // item 49: whose customer each site is
  ]);
  const filesPending: Record<string, number> = {};
  for (const m of ((filesQ.json ?? []) as Array<{ site_id: string; metadata: any }>)) {
    if ((m.metadata || {}).pending_replace) filesPending[m.site_id] = (filesPending[m.site_id] || 0) + 1;
  }
  // latest change per site + latest run per site (reduce, not re-query)
  const lastChange: Record<string, string> = {};
  for (const e of (evtQ.json ?? []) as Array<{ site_id: string; created_at: string }>) {
    if (!lastChange[e.site_id]) lastChange[e.site_id] = e.created_at;
  }
  const latestRun: Record<string, string> = {};
  for (const r of (runQ.json ?? []) as Array<{ id: string; site_id: string }>) {
    if (!latestRun[r.site_id]) latestRun[r.site_id] = r.id;
  }
  const runIds = Object.values(latestRun);
  const runToSite = Object.fromEntries(Object.entries(latestRun).map(([s, r]) => [r, s]));
  const sites = (sitesQ.json ?? []) as Array<PortfolioInput['sites'][0] & { client_id: string }>;
  const clientIds = [...new Set(sites.map((s) => s.client_id))];
  const [evQ, namesQ, entQ] = await Promise.all([
    runIds.length ? svc(`presence_evidence?run_id=in.(${runIds.join(',')})&severity=in.(critical,warning)&select=run_id,type,severity,human&limit=2000`) : Promise.resolve({ json: [] as unknown[] }),
    clientIds.length ? svc(`clients?id=in.(${clientIds.join(',')})&select=id,name&limit=1000`) : Promise.resolve({ json: [] as unknown[] }),
    // Section 3: authoritative billing status per client → mapped to each of their sites (one query, fixed cost).
    clientIds.length ? svc(`presence_entitlements?client_id=in.(${clientIds.join(',')})&product=eq.presence&select=client_id,status&limit=1000`) : Promise.resolve({ json: [] as unknown[] }),
  ]);
  const nameByClient = Object.fromEntries(((namesQ.json ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  // Sales review item 49 (the rest, Nov 8): Home's Needs you, its roster and
  // Analytics lead with the business too — the same reader Customers and the
  // record use, on the studio site each customer is linked to. Best-effort: a
  // failed read leaves the stored names.
  const bizBySite: Record<string, string> = {};
  try {
    const sl = (Array.isArray(slQ.json) ? slQ.json : []) as Array<{ agency_site_id: string; customer_site_id: string; customer_client_id: string }>;
    const byStudio = new Map<string, typeof sl>();
    for (const l of sl) if (l.agency_site_id && l.customer_site_id && l.customer_client_id) byStudio.set(String(l.agency_site_id), [...(byStudio.get(String(l.agency_site_id)) || []), l]);
    // each studio's names side by side, applied in the same order as before (the first studio's name wins)
    const studios = [...byStudio];
    const named = await Promise.all(studios.map(([studioSite, ls]) => loadCustomerNames(studioSite, ls.map((l) => ({ clientId: String(l.customer_client_id), clientName: nameByClient[String(l.customer_client_id)], customerSiteId: String(l.customer_site_id) })), (path) => svc(path).then((r) => (Array.isArray(r.json) ? r.json as any[] : [])))
      .catch(() => ({} as Awaited<ReturnType<typeof loadCustomerNames>>))));
    studios.forEach(([, ls], i) => { for (const l of ls) { const n = named[i][String(l.customer_client_id)]; if (n && n.name && !bizBySite[String(l.customer_site_id)]) bizBySite[String(l.customer_site_id)] = n.name; } });
  } catch { /* the stored names stand */ }
  const statusByClient = Object.fromEntries(((entQ.json ?? []) as Array<{ client_id: string; status: string }>).map((e) => [e.client_id, e.status]));
  const billingBySite = Object.fromEntries(sites.map((s) => [s.id, statusByClient[s.client_id] || 'active']));
  return {
    sites, links,
    clientNames: Object.fromEntries(sites.map((s) => [s.id, bizBySite[s.id] || nameByClient[s.client_id] || ''])),
    moments: ((momQ.json ?? []) as Array<{ site_id: string; moment_key: string; moment_type: string; headline: string }>)
      .map((m) => ({ site_id: m.site_id, moment_key: m.moment_key, type: m.moment_type, headline: m.headline })),
    evidence: ((evQ.json ?? []) as Array<{ run_id: string; type: string; severity: string; human: string }>)
      .map((e) => ({ site_id: runToSite[e.run_id], type: e.type, severity: e.severity, human: e.human })).filter((e) => e.site_id),
    opportunities: oppQ.json ?? [], plans: planQ.json ?? [], drafts: draftQ.json ?? [],
    connections: connQ.json ?? [], reviewReports: revQ.json ?? [], brandReports: brandQ.json ?? [],
    leads: ((leadsQ.json ?? []) as Array<{ site_id: string }>).map((l) => ({ site_id: l.site_id })),
    enquiries: (leadsQ.json ?? []) as PortfolioInput['enquiries'],
    notices: (noticesQ.json ?? []) as Array<{ id?: string; site_id: string; kind: string; period?: string; headline?: string; body?: string; created_at?: string }>,
    filesPending,
    billingBySite,
    lastChange, nowIso,
  };
}

// ── One gather for requests that arrive together (final pass, Nov 8: batch B) ──
// Home asks for the portfolio, the archived portfolio and Needs you at the same
// moment, and each ran the whole gather (≈170 reads cold). Calls for one agency
// within GATHER_SHARE_MS share one gather. The result is only ever read, never
// changed; any agency write forgets it, and a failed gather isn't kept.
export const GATHER_SHARE_MS = 2_000;
const gathers = new Map<string, { at: number; p: Promise<PortfolioInput> }>();
export function sharedGather(agencyId: string, nowIso: string): Promise<PortfolioInput> {
  const hit = gathers.get(agencyId);
  if (hit && Date.now() - hit.at < GATHER_SHARE_MS) return hit.p;
  const p = gather(agencyId, nowIso);
  gathers.set(agencyId, { at: Date.now(), p });
  p.catch(() => { if (gathers.get(agencyId)?.p === p) gathers.delete(agencyId); });
  return p;
}
/** Forget what this agency's reads are sharing — after any write. */
export function forgetAgencyReads(agencyId: string): void {
  gathers.delete(agencyId);
  for (const k of [...needsRuns.keys()]) if (k.startsWith(agencyId + ':')) needsRuns.delete(k);
}

export async function handleAgency(req: Request, route: string, method: string, member: AgencyMember, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (method !== 'GET') forgetAgencyReads(member.agency_id);
  try {
    return await handleAgencyInner(req, route, method, member, principal, cors);
  } catch (e) {
    // honest failure, never a bare 500: nothing was half-done downstream
    return json({ error: 'agency_failed', message: `That didn’t come through: ${(e as Error)?.message?.slice(0, 200) || 'unknown error'}` }, 502, cors);
  }
}

async function handleAgencyInner(req: Request, route: string, method: string, member: AgencyMember, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const now = new Date().toISOString();
  const body = async () => { try { return await req.json(); } catch { return {}; } };

  // ── who am I ──
  if (route === '/agency/me' && method === 'GET') {
    // email + member_id: the Team section needs to know which row is YOURS (no
    // controls on yourself). The server guard below is the law; this is the hint.
    return json({ data: { agency: member.agency_name, role: member.role, plan: member.plan, branding: member.branding, email: member.email, member_id: member.member_id } }, 200, cors);
  }

  // ── item 54: the menu areas this studio hides (Settings › Your menu). Kept once per
  //    studio on its own site; every member sees the same menu. Nothing is deleted: a
  //    hidden area keeps its page, its buttons elsewhere and its ⌘K entry. ──
  if (route === '/agency/nav' && (method === 'GET' || method === 'PUT')) {
    if (!can(member.role, method === 'GET' ? 'read' : 'manage_clients')) return forbid(cors);
    const own = await ownSiteOf(req.headers.get('x-dds-user-jwt') || '', principal);
    if (!own) return json({ error: 'no_studio_site', message: 'Your menu is kept on your studio’s own site, and this sign-in doesn’t have one.' }, 409, cors);
    if (method === 'PUT') {
      let b: { hidden?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
      if (!Array.isArray(b.hidden)) return json({ error: 'bad_request', message: 'Say which areas to hide, as a list.' }, 400, cors);
      const hidden = normalizeHidden(b.hidden);
      if (!(await writeReservedJson(own.id, RESERVED_NAMES.navHidden, { hidden }, member.email))) return json({ error: 'write_failed', message: 'That didn’t save.' }, 502, cors);
      return json({ data: { hidden, choices: HIDEABLE_SECTIONS, can_edit: true } }, 200, cors);
    }
    // bug hunt C4: a failed read is not "nothing hidden" — Settings showed every area on,
    // and the next switch saved that over the real list. The page leaves the card away.
    let stored: unknown;
    try { stored = await readReservedJsonOrThrow(own.id, RESERVED_NAMES.navHidden); }
    catch { return json({ error: 'read_failed', message: 'Your menu couldn’t load just now.' }, 502, cors); }
    // C16: the page shows the switches by the same rule this PUT keeps (manage_clients)
    return json({ data: { hidden: normalizeHidden(stored), choices: HIDEABLE_SECTIONS, can_edit: can(member.role, 'manage_clients') } }, 200, cors);
  }

  // ── the Sites and Domains pages, Pin and Duplicate (builder list items 43, 45, 52) ──
  {
    const r = await handleAgencySites(req, route, method, member, principal, cors, {
      gather: sharedGather, ownSite: () => ownSiteOf(req.headers.get('x-dds-user-jwt') || '', principal),
    });
    if (r) return r;
  }

  // ── the portfolio: directory + everything observable from one place ──
  if (route === '/agency/portfolio' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    const url = new URL(req.url);
    const input = await sharedGather(member.agency_id, now);
    const all = buildPortfolio(input);
    const rows = filterPortfolio(all, {
      search: url.searchParams.get('search') || undefined,
      tag: url.searchParams.get('tag') || undefined,
      archived: url.searchParams.has('archived') ? url.searchParams.get('archived') === 'true' : false,
    });
    // internal notes are a capability of their own (support reads them, readonly does not)
    const out = can(member.role, 'notes') ? rows : rows.map((r) => ({ ...r, notes: '' }));
    // which sites are archived, alongside the list: the roster page folds the
    // bridge list (/studio/customers) into these rows and must NOT give an
    // archived client a fresh bridge-only row in All. Same read, no second gather.
    const archivedSiteIds = all.filter((r) => r.archived).map((r) => r.site_id);
    return json({ data: out, archived_site_ids: archivedSiteIds }, 200, cors);
  }

  // ── work queues + cross-client patterns — from the existing pipeline only ──
  if (route === '/agency/queues' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    const input = await sharedGather(member.agency_id, now);
    return json({ data: { queues: buildQueues(input), patterns: buildPatterns(input) } }, 200, cors);
  }

  // ── Needs you: the studio's OWN work, one list (Oct 2026 home rebuild). The
  //    pure helper (needs_you.ts) decides what counts; this gathers the rows at a
  //    fixed query count: the portfolio gather (clients' sites, evidence, plans,
  //    enquiries, last changes) + the studio's own money, support, deals and
  //    reminders + the clients' publishes and connections. Every extra read is
  //    best-effort: a failed slot contributes nothing and `partial` says so. ──
  if (route === '/agency/needs-you' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    const jwt = req.headers.get('x-dds-user-jwt') || '';
    const q = new URL(req.url).searchParams;
    // batch B: ?fresh=1 when a page just changed something (never a shared run);
    // ?only=total is the bell's badge — the same list, just its number
    const d = await computeStudioNeeds(member, principal, jwt, now, { fresh: q.get('fresh') === '1' });
    if (q.get('only') === 'total') return json({ data: { total: Number(d.total) || 0, partial: !!d.partial } }, 200, cors);
    return json({ data: d }, 200, cors);
  }

  // ── Snooze (bold redesign, sales item 70): a row leaves Home's list, the bell
  //    and the roster's Next for 1–30 days, studio-wide; Wake brings it back
  //    now. Anyone who can see the list can do either (like the Inbox's Close).
  //    Before APPLY-0146 there is no table: the list says snooze_ready:false and
  //    the page hides the buttons; a write here answers 503, plainly. ──
  if ((route === '/agency/needs-you/snooze' || route === '/agency/needs-you/wake') && method === 'POST') {
    if (!can(member.role, 'read')) return forbid(cors);
    const b = await body();
    const key = String(b?.key ?? '');
    if (!SNOOZE_KEY_RE.test(key)) return json({ error: 'bad_request', message: 'That item can’t be snoozed.' }, 400, cors);
    const wake = route.endsWith('/wake');
    const until = wake ? null : snoozeUntil(now, b?.days);
    if (!wake && !until) return json({ error: 'bad_request', message: `Snooze for 1 to ${SNOOZE_MAX_DAYS} days.` }, 400, cors);
    const r = wake
      ? await svc(`presence_needs_snoozes?agency_id=eq.${member.agency_id}&row_key=eq.${encodeURIComponent(key)}`, { method: 'DELETE' })
      : await svc('presence_needs_snoozes?on_conflict=agency_id,row_key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ agency_id: member.agency_id, row_key: key, until, created_by: principal.email || principal.userId || null, created_at: now }) });   // a re-snooze restarts "since when" (bug hunt A2)
    if (!r.ok) {
      const missing = r.status === 404 || /presence_needs_snoozes/.test(String(r.text || ''));
      return json({ error: missing ? 'unavailable' : 'write_failed', message: missing ? 'Snooze isn’t switched on yet — it needs one database step.' : 'That didn’t save — please try again.' }, missing ? 503 : 502, cors);
    }
    forgetAgencyReads(member.agency_id); needsTotals.delete(member.agency_id);   // the next read (and the bell) recounts
    return json({ data: { key, until } }, 200, cors);
  }

  // ── client management ──
  if (route === '/agency/clients' && method === 'POST') {
    if (!can(member.role, 'manage_clients')) return forbid(cors);
    const b = await body();
    if (!UUID_RE.test(String(b?.site_id || ''))) return json({ error: 'bad_request', message: 'A site_id is needed.' }, 400, cors);
    const existing = await svc(`presence_agency_clients?agency_id=eq.${member.agency_id}&select=site_id&limit=1000`);
    if ((existing.json ?? []).length >= member.client_limit) {
      return json({ error: 'client_limit', message: `The plan covers ${member.client_limit} clients — the limit can grow with the plan.` }, 400, cors);
    }
    // Final pass (Nov 8, S1): this added ANY site id to the portfolio, overwriting
    // the agency that managed it — site ids show on published pages and in reply
    // addresses, so any studio could take over any business's site. Now: a site
    // already in this portfolio (restored if archived), or one whose owner is
    // already this studio's customer (they were set up here or accepted a request).
    // Insert-only either way: another agency's site is never taken.
    const siteId = String(b.site_id);
    const mine = (existing.json ?? []).some((r: any) => String(r.site_id) === siteId);   // every status — an archived one comes back
    if (!mine) {
      const target = (await svc(`presence_sites?id=eq.${siteId}&select=client_id&limit=1`)).json?.[0];
      const jwt = req.headers.get('x-dds-user-jwt') || '';
      const own = await ownSiteOf(jwt, principal);
      const ok = !!(target?.client_id && own?.id && await isCustomerOfStudio(own.id, String(target.client_id)));
      if (!ok) return json({ error: 'not_your_customer', message: 'You can add a site once its owner is your customer — set them up from Customers, or send them a request there.' }, 409, cors);
    }
    const tags = Array.isArray(b.tags) ? b.tags.slice(0, 10).map((t: unknown) => String(t).slice(0, 40)) : [];
    const claim = await claimPortfolioSite(member.agency_id, siteId, member.email, { reactivate: true, tags });
    if (claim === 'owned_elsewhere') return json({ error: 'owned_elsewhere', message: 'Another studio looks after that site.' }, 409, cors);
    if (claim === 'failed') return json({ error: 'write_failed', message: 'That didn’t save.' }, 502, cors);
    const w = await svc(`presence_agency_clients?site_id=eq.${siteId}&agency_id=eq.${member.agency_id}&select=site_id,status,tags,owner_email&limit=1`);
    if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save.' }, 502, cors);
    return json({ data: { ...w.json[0], onboarding: onboardingChecklist() } }, 200, cors);
  }
  {
    const m = route.match(/^\/agency\/clients\/([0-9a-f-]{36})$/);
    if (m && method === 'PATCH') {
      if (!can(member.role, m ? 'manage_clients' : 'read')) return forbid(cors);
      const b = await body();
      const patch: Record<string, unknown> = {};
      if (Array.isArray(b.tags)) patch.tags = b.tags.slice(0, 10).map((t: unknown) => String(t).slice(0, 40));
      if (typeof b.notes === 'string' && can(member.role, 'notes')) patch.notes = b.notes.slice(0, 4000);
      if (typeof b.owner_email === 'string') patch.owner_email = b.owner_email.toLowerCase().slice(0, 200);
      if (Array.isArray(b.assigned)) patch.assigned = b.assigned.slice(0, 10).map((e: unknown) => String(e).toLowerCase());
      if (b.status === 'archived' || b.status === 'active') patch.status = b.status;   // archive / restore
      if (!Object.keys(patch).length) return json({ error: 'empty_update', message: 'Nothing to change.' }, 400, cors);
      const w = await svc(`presence_agency_clients?site_id=eq.${m[1]}&agency_id=eq.${member.agency_id}&select=site_id,status,tags,owner_email,assigned,notes`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
      });
      if (!w.ok || !w.json?.[0]) return json({ error: 'not_found', message: 'Not one of your clients.' }, 404, cors);
      return json({ data: w.json[0] }, 200, cors);
    }
    if (m && method === 'GET') {
      // guided onboarding checklist, derived from the site's actual state
      const ids = await agencySiteIds(member.agency_id, true);
      if (!ids.includes(m[1])) return json({ error: 'not_found', message: 'Not one of your clients.' }, 404, cors);
      const [site] = await loadSites([m[1]]);
      const [conn, brand, docs] = await Promise.all([
        svc(`presence_monitor_connections?site_id=eq.${m[1]}&select=status&limit=1`),
        svc(`presence_brand_profile?site_id=eq.${m[1]}&select=personality,words_avoid&limit=1`),
        svc(`presence_knowledge_docs?site_id=eq.${m[1]}&deleted_at=is.null&select=id&limit=1`),
      ]);
      const steps = onboardingChecklist({
        edition: site?.edition,
        monitor_status: conn.json?.[0]?.status ?? null,
        brand_started: !!(brand.json?.[0]?.personality || (brand.json?.[0]?.words_avoid || []).length),
        knowledge: (docs.json ?? []).length > 0,
        published: !!site?.last_published_at,
      });
      return json({ data: { site_id: m[1], edition: site?.edition, onboarding: steps } }, 200, cors);
    }
  }

  // ── Phase CP-1: starter kits — save a linked site's SETUP, apply it to a
  //    fresh one. Structure + house style only (lib/kits.ts strips business
  //    facts/testimonials/posts/media); apply is FILL-ONLY-EMPTY (never
  //    overwrites). Fenced to the agency's own linked sites, both directions.
  if (route === '/agency/kits' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    const r = await svc(`presence_starter_kits?agency_id=eq.${member.agency_id}&select=id,name,industry_key,created_from_site,created_by,created_at&order=created_at.desc&limit=100`);
    return json({ data: r.json ?? [] }, 200, cors);
  }
  if (route === '/agency/kits' && method === 'POST') {
    if (!can(member.role, 'manage_clients')) return forbid(cors);
    const b = await body();
    const siteId = String(b?.site_id || ''); const name = String(b?.name || '').trim().slice(0, 80);
    if (!UUID_RE.test(siteId) || !name) return json({ error: 'bad_request', message: 'A site_id and a kit name are needed.' }, 400, cors);
    const ids = await agencySiteIds(member.agency_id, true);
    if (!ids.includes(siteId)) return json({ error: 'not_found', message: 'Not one of your clients.' }, 404, cors);
    const payload = await kitFromSite(siteId);
    const w = await svc('presence_starter_kits', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ agency_id: member.agency_id, name, industry_key: payload.industry_key, payload, created_from_site: siteId, created_by: member.email }),
    });
    if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save.' }, 502, cors);
    return json({ data: { id: w.json[0].id, name, offerings: payload.offerings.length, faqs: payload.faqs.length } }, 200, cors);
  }
  {
    const km = route.match(/^\/agency\/kits\/([0-9a-f-]{36})$/);
    if (km && method === 'DELETE') {
      if (!can(member.role, 'manage_clients')) return forbid(cors);
      const w = await svc(`presence_starter_kits?id=eq.${km[1]}&agency_id=eq.${member.agency_id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
      if (!w.ok || !Array.isArray(w.json) || !w.json.length) return json({ error: 'not_found', message: 'Not one of your kits.' }, 404, cors);
      return json({ data: { ok: true } }, 200, cors);
    }
    const am = route.match(/^\/agency\/kits\/([0-9a-f-]{36})\/apply$/);
    if (am && method === 'POST') {
      if (!can(member.role, 'manage_clients')) return forbid(cors);
      const b = await body();
      const siteId = String(b?.site_id || '');
      if (!UUID_RE.test(siteId)) return json({ error: 'bad_request', message: 'A site_id is needed.' }, 400, cors);
      const ids = await agencySiteIds(member.agency_id, true);
      if (!ids.includes(siteId)) return json({ error: 'not_found', message: 'Not one of your clients.' }, 404, cors);
      const kq = await svc(`presence_starter_kits?id=eq.${am[1]}&agency_id=eq.${member.agency_id}&select=payload,name&limit=1`);
      if (!kq.json?.[0]) return json({ error: 'not_found', message: 'Not one of your kits.' }, 404, cors);
      const kit = kq.json[0].payload as KitPayload;
      return json({ data: await applyKitTo(kit, siteId, principal, `Applied the “${kq.json[0].name}” starter kit`) }, 200, cors);
    }
  }

  // ── team management ──
  if (route === '/agency/members' && method === 'GET') {
    // user_id (learned at each member's sign-in): the Inbox assigns a support request to a person by it (sales review item 34)
    const r = await svc(`presence_agency_members?agency_id=eq.${member.agency_id}&select=id,email,role,status,user_id,created_at&order=created_at.asc&limit=200`);
    return json({ data: r.json ?? [] }, 200, cors);
  }
  if (route === '/agency/members' && method === 'POST') {
    if (!can(member.role, 'manage_members')) return forbid(cors);
    const b = await body();
    const email = String(b?.email || '').toLowerCase().trim();
    const role = ['owner', 'admin', 'account_manager', 'content_strategist', 'designer', 'developer', 'support', 'readonly'].includes(b?.role) ? b.role : null;
    if (!email.includes('@') || !role) return json({ error: 'bad_request', message: 'An email and a role are needed.' }, 400, cors);
    const seats = await svc(`presence_agency_members?agency_id=eq.${member.agency_id}&status=eq.active&select=id&limit=500`);
    if ((seats.json ?? []).length >= member.seat_limit) {
      return json({ error: 'seat_limit', message: `The plan covers ${member.seat_limit} seats — the limit can grow with the plan.` }, 400, cors);
    }
    const w = await svc(`presence_agency_members?on_conflict=agency_id,email&select=id,email,role,status`, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ agency_id: member.agency_id, email, role, status: 'active' }),
    });
    if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save.' }, 502, cors);
    // best-effort invite — the seat row is the truth; email never blocks it.
    // The ONE shared sender (lib/workspace.ts), on the AGENCY's brand (white label).
    const agencyName = String(member.branding?.display_name || member.agency_name || 'your agency');
    const agencyNameHtml = agencyName.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const emailed = await sendInviteLink(email, {
      subject: `You’ve been invited to join ${agencyName}`,
      intro: `You’ve been invited to join the <strong>${agencyNameHtml}</strong> team.`,
      brand: brandFromKit({ primary: String(member.branding?.color_accent || '') }, agencyName),
      next: '/agency.html',
    }).catch(() => false);
    return json({ data: { ...w.json[0], emailed } }, 200, cors);
  }
  {
    const m = route.match(/^\/agency\/members\/([0-9a-f-]{36})$/);
    if (m && method === 'PATCH') {
      if (!can(member.role, 'manage_members')) return forbid(cors);
      const b = await body();
      const patch: Record<string, unknown> = {};
      if (['owner', 'admin', 'account_manager', 'content_strategist', 'designer', 'developer', 'support', 'readonly'].includes(b?.role)) patch.role = b.role;
      if (b?.status === 'revoked' || b?.status === 'active') patch.status = b.status;
      if (!Object.keys(patch).length) return json({ error: 'empty_update', message: 'Nothing to change.' }, 400, cors);
      // Your own row is off limits — nobody demotes or removes themselves. The
      // page hides the controls on your row; this is what makes it true.
      const ownRow = () => json({ error: 'own_row', message: 'You can’t change your own role or remove yourself. Ask another owner to do it.' }, 409, cors);
      if (m[1] === member.member_id) return ownRow();
      const cur = await svc(`presence_agency_members?id=eq.${m[1]}&agency_id=eq.${member.agency_id}&select=id,email,role,status&limit=1`);
      const target = (cur.json ?? [])[0] as { id: string; email: string; role: string; status: string } | undefined;
      if (!cur.ok || !target) return json({ error: 'not_found', message: 'No such member.' }, 404, cors);
      if (String(target.email || '').toLowerCase() === String(member.email || '').toLowerCase()) return ownRow();
      // The team always keeps one owner: the last active owner can be neither
      // demoted nor removed (an admin can manage members, so this is not covered
      // by the own-row rule alone).
      const losesOwner = target.role === 'owner' && target.status === 'active' && ((typeof patch.role === 'string' && patch.role !== 'owner') || patch.status === 'revoked');
      if (losesOwner) {
        const owners = await svc(`presence_agency_members?agency_id=eq.${member.agency_id}&role=eq.owner&status=eq.active&select=id&limit=100`);
        if ((owners.json ?? []).length <= 1) return json({ error: 'last_owner', message: 'The team needs at least one owner. Make someone else an owner first.' }, 409, cors);
      }
      const w = await svc(`presence_agency_members?id=eq.${m[1]}&agency_id=eq.${member.agency_id}&select=id,email,role,status`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
      });
      if (!w.ok || !w.json?.[0]) return json({ error: 'not_found', message: 'No such member.' }, 404, cors);
      return json({ data: w.json[0] }, 200, cors);
    }
  }

  // ── white label ──
  if (route === '/agency/branding' && method === 'GET') {
    return json({ data: member.branding }, 200, cors);
  }
  if (route === '/agency/branding' && method === 'PUT') {
    if (!can(member.role, 'manage_branding')) return forbid(cors);
    const b = await body();
    const branding: Record<string, string> = {};
    for (const k of ['display_name', 'logo_url', 'color_ink', 'color_accent', 'email_from', 'portal_note', 'report_footer']) {
      if (typeof b?.[k] === 'string') branding[k] = b[k].slice(0, 400);
    }
    const w = await svc(`presence_agencies?id=eq.${member.agency_id}&select=branding`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ branding }),
    });
    if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save.' }, 502, cors);
    return json({ data: w.json[0].branding }, 200, cors);
  }

  // ── usage: seats, clients, activity — billing preparation ──
  if (route === '/agency/usage' && method === 'GET') {
    const [seats, clients] = await Promise.all([
      svc(`presence_agency_members?agency_id=eq.${member.agency_id}&status=eq.active&select=id&limit=500`),
      svc(`presence_agency_clients?agency_id=eq.${member.agency_id}&select=site_id,status&limit=1000`),
    ]);
    const links = (clients.json ?? []) as Array<{ site_id: string; status: string }>;
    const ids = links.filter((l) => l.status === 'active').map((l) => l.site_id);
    const sites = await loadSites(ids);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const pubs = ids.length ? await svc(`presence_publishes?site_id=in.(${ids.join(',')})&status=eq.live&created_at=gt.${since}&select=id&limit=1000`) : { json: [] };
    return json({ data: {
      plan: member.plan,
      seats: { used: (seats.json ?? []).length, limit: member.seat_limit },
      clients: { used: links.length, active: ids.length, archived: links.length - ids.length, limit: member.client_limit },
      editions: sites.reduce((acc: Record<string, number>, s) => { acc[s.edition] = (acc[s.edition] || 0) + 1; return acc; }, {}),
      publishes_30d: (pubs.json ?? []).length,
    } }, 200, cors);
  }

  // ── bulk operations: dispatch the EXISTING engines, per site, explained ──
  if (route === '/agency/bulk' && method === 'POST') {
    const b = await body();
    const action = String(b?.action || '');
    const requested: string[] = Array.isArray(b?.site_ids) ? b.site_ids.filter((x: string) => UUID_RE.test(x)) : [];
    const OBSERVE = ['observe', 'judge', 'recommend', 'moments', 'coach', 'review', 'brand_review', 'readiness'];
    const needsCap = action === 'publish' ? 'bulk_publish' as const : 'bulk_observe' as const;
    if (![...OBSERVE, 'publish'].includes(action)) return json({ error: 'bad_action', message: `Bulk actions: ${OBSERVE.join(', ')}, publish.` }, 400, cors);
    if (!can(member.role, needsCap)) return forbid(cors);
    const mine = await agencySiteIds(member.agency_id);
    const ids = requested.filter((id) => mine.includes(id)).slice(0, 25);
    if (!ids.length) return json({ error: 'bad_request', message: 'No sites of yours in that list.' }, 400, cors);
    if (b?.run_after) {
      // scheduled bulk work (incl. scheduled publishing) — a job, run when due
      const w = await svc('presence_agency_jobs?select=id,run_after', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ agency_id: member.agency_id, action, site_ids: ids, params: {}, run_after: b.run_after, created_by: member.email }),
      });
      return json({ data: { scheduled: true, job_id: w.json?.[0]?.id, run_after: w.json?.[0]?.run_after } }, 200, cors);
    }
    const results = await runBulk(action, ids, principal);
    return json({ data: { action, results } }, 200, cors);
  }
  if (route === '/agency/jobs' && method === 'GET') {
    const r = await svc(`presence_agency_jobs?agency_id=eq.${member.agency_id}&select=id,action,site_ids,run_after,status,results,created_by,created_at&order=created_at.desc&limit=50`);
    return json({ data: r.json ?? [] }, 200, cors);
  }
  if (route === '/agency/jobs/run-due' && method === 'POST') {
    if (!can(member.role, 'bulk_publish')) return forbid(cors);
    const due = await svc(`presence_agency_jobs?agency_id=eq.${member.agency_id}&status=eq.queued&run_after=lte.${now}&select=id,action,site_ids&limit=5`);
    const out: Array<{ job_id: string; results: unknown }> = [];
    for (const j of (due.json ?? []) as Array<{ id: string; action: string; site_ids: string[] }>) {
      const results = await runBulk(j.action, j.site_ids, principal);
      await svc(`presence_agency_jobs?id=eq.${j.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done', results }) });
      out.push({ job_id: j.id, results });
    }
    return json({ data: { ran: out.length, jobs: out } }, 200, cors);
  }

  // ══ L5.7 — orchestrate the full platform (Enterprise/Marketplace/Connected/
  //    approvals) through ONE agency experience. Every handler: capability check
  //    → fenced to the agency's own sites/orgs → calls the EXISTING store; every
  //    state change is an Approved Plan (the spine). No new engine/table. ══
  const sites = await agencySiteIds(member.agency_id);
  const orgIdsOf = async (): Promise<string[]> => {
    if (!sites.length) return [];
    const r = await svc(`presence_sites?id=in.(${sites.join(',')})&org_id=not.is.null&select=org_id`);
    return [...new Set(((r.json ?? []) as any[]).map((s) => String(s.org_id)).filter(Boolean))];
  };

  // the organizations this agency manages (fenced: only orgs of its own sites)
  if (route === '/agency/organizations' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    const orgIds = await orgIdsOf();
    const orgs = (await Promise.all(orgIds.map((id) => getOrganization(id)))).filter(Boolean);
    return json({ data: { organizations: orgs.map((o: any) => ({ id: o.id, name: o.name })) } }, 200, cors);
  }

  // cross-client + cross-organization rollups (READ-side; consumes the pipeline)
  if (route === '/agency/rollups' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    const siteRows = await loadSites(sites);
    const clients = siteRows.map((s) => ({ site_id: s.id, industry: resolveIndustryKey(s.template_slug), edition: s.edition }));
    const momentsQ = sites.length ? await svc(`presence_moments?site_id=in.(${sites.join(',')})&status=eq.active&select=site_id,moment_type`) : { json: [] };
    const byS = new Map<string, { a: number; n: number }>();
    for (const m of (momentsQ.json ?? [])) { const e = byS.get(m.site_id) || { a: 0, n: 0 }; e.a++; if (m.moment_type === 'needs_attention') e.n++; byS.set(m.site_id, e); }
    const orgIds = await orgIdsOf();
    const perOrg = await Promise.all(orgIds.map(async (id) => {
      const locs = await listLocations(id);
      return { org_id: id, name: id.slice(0, 8), locations: locs.map((l: any) => ({ site_id: l.id, name: l.custom_domain || l.id.slice(0, 8), active_moments: byS.get(l.id)?.a || 0, needs_attention: byS.get(l.id)?.n || 0 })) };
    }));
    return json({ data: { cross_client: crossClientSummary(clients), cross_org: crossOrgRollup(perOrg) } }, 200, cors);
  }

  // the UNIFIED approval queue — every pending Approved Plan across the portfolio
  if (route === '/agency/approvals' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    const inSites = sites.length ? `in.(${sites.join(',')})` : 'in.()';
    const orgIds = await orgIdsOf();
    const inOrgs = orgIds.length ? `in.(${orgIds.join(',')})` : 'in.()';
    const [cw, ip, oo] = await Promise.all([
      svc(`presence_connection_writes?site_id=${inSites}&status=in.(proposed,approved)&select=id,title,status,site_id&limit=200`),
      svc(`presence_infra_plans?site_id=${inSites}&status=in.(proposed,approved)&select=id,title,status,site_id&limit=200`),
      orgIds.length ? svc(`presence_org_operations?org_id=${inOrgs}&status=in.(proposed,approved)&select=id,title,status,org_id&limit=200`) : Promise.resolve({ json: [] }),
    ]);
    const plans: PendingPlan[] = [
      ...(cw.json ?? []).map((r: any) => ({ source: 'connected_write' as const, id: r.id, title: r.title, status: r.status, scope: r.site_id })),
      ...(ip.json ?? []).map((r: any) => ({ source: 'infra_plan' as const, id: r.id, title: r.title, status: r.status, scope: r.site_id })),
      ...((oo as any).json ?? []).map((r: any) => ({ source: 'org_operation' as const, id: r.id, title: r.title, status: r.status, scope: r.org_id })),
    ];
    return json({ data: approvalQueue(plans) }, 200, cors);
  }

  // orchestrate an Enterprise rollout — prepare (needs manage_enterprise + the org in the portfolio)
  {
    const m = route.match(/^\/agency\/organizations\/([0-9a-f-]{36})\/rollout\/prepare$/);
    if (m && method === 'POST') {
      if (!can(member.role, 'manage_enterprise')) return forbid(cors);
      const orgIds = await orgIdsOf();
      if (!orgIds.includes(m[1])) return json({ error: 'forbidden', message: 'That organization isn’t in your portfolio.' }, 403, cors);
      let body: any = {}; try { body = await req.json(); } catch { /* */ }
      const op = String(body?.op || '') as OrgOp;
      if (!ORG_OPS.includes(op)) return json({ error: 'bad_op', message: `Operation must be one of: ${ORG_OPS.join(', ')}.` }, 400, cors);
      const targets = (await listLocations(m[1])).map((l: any) => l.id);
      const plan = planOrgOperation(op, m[1], targets);
      const row = await saveOrgOperation(plan, body?.patch || {});
      return json({ data: row }, 200, cors);
    }
  }
  // orchestrate the approval (needs approve_plans) — the sign-off that runs the spine
  {
    const m = route.match(/^\/agency\/organizations\/([0-9a-f-]{36})\/rollout\/([0-9a-f-]{36})\/decide$/);
    if (m && method === 'POST') {
      if (!can(member.role, 'approve_plans')) return forbid(cors);
      const orgIds = await orgIdsOf();
      if (!orgIds.includes(m[1])) return json({ error: 'forbidden', message: 'That organization isn’t in your portfolio.' }, 403, cors);
      let body: any = {}; try { body = await req.json(); } catch { /* */ }
      const verb = body?.decision === 'approve' ? 'approve' : body?.decision === 'abandon' ? 'abandon' : null;
      if (!verb) return json({ error: 'bad_request', message: 'Decide with approve or abandon.' }, 400, cors);
      const row = await decideOrgOperation(m[2], verb);
      if (!row) return json({ error: 'not_found', message: 'That rollout isn’t open for a decision.' }, 404, cors);
      return json({ data: row }, 200, cors);
    }
  }

  return json({ error: 'not_found', message: `No agency route for ${method} ${route}.` }, 404, cors);
}

/** The agency member's OWN studio site — where its money, support and deals
 *  live. The same two-step index.ts uses: RLS (resolveSite) first, then an
 *  active membership for a seat that owns no site. Null when there is none;
 *  the caller degrades honestly (partial). */
// ── The studio's ONE "needs you" list (sales review item 11, Nov 2026) ───────
// Home's list, the bell badge at studio level and the bell's Needs-you tab are
// this one computation; the Inbox's rows feed it.
// Speed (final pass, Nov 8: batch B): no page boot computes it any more. The
// total is kept per agency: fresh for NEEDS_TOTAL_TTL_MS, and shown for up to
// NEEDS_TOTAL_KEEP_MS while the shell refreshes it behind the page
// (/agency/needs-you?only=total). Calls that arrive together share one run.
export const NEEDS_TOTAL_TTL_MS = 60_000;
export const NEEDS_TOTAL_KEEP_MS = 30 * 60_000;
export const NEEDS_SHARE_MS = 2_000;
const needsTotals = new Map<string, { at: number; total: number }>();
const needsRuns = new Map<string, { at: number; p: Promise<any> }>();
/** The kept total for a page boot — never computed here. Null when none is kept. */
export function keptStudioNeedsTotal(agencyId: string): { total: number; fresh: boolean } | null {
  const hit = needsTotals.get(agencyId);
  if (!hit) return null;
  const age = Date.now() - hit.at;
  return age > NEEDS_TOTAL_KEEP_MS ? null : { total: hit.total, fresh: age < NEEDS_TOTAL_TTL_MS };
}
export function computeStudioNeeds(member: AgencyMember, principal: Principal, jwt: string, now: string, opts: { fresh?: boolean } = {}) {
  const key = `${member.agency_id}:${principal.userId || principal.email || ''}`;
  const hit = needsRuns.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < NEEDS_SHARE_MS) return hit.p;
  if (opts.fresh) gathers.delete(member.agency_id);
  const p = runStudioNeeds(member, principal, jwt, now);
  needsRuns.set(key, { at: Date.now(), p });
  p.catch(() => { if (needsRuns.get(key)?.p === p) needsRuns.delete(key); });
  return p;
}
async function runStudioNeeds(member: AgencyMember, principal: Principal, jwt: string, now: string) {
    const [input, own] = await Promise.all([sharedGather(member.agency_id, now), ownSiteOf(jwt, principal)]);
    // item 11: the studio site's own Inbox rows (the SAME builder the Inbox and the
    // bell read), so the list, the bell and the Inbox name one set of things
    const ownFeedP: Promise<any> = own ? buildPortalFeed(jwt, own, principal).catch(() => null) : Promise.resolve(null);
    const ids = input.links.filter((l) => l.status === 'active').map((l) => l.site_id);
    const IN = `site_id=in.(${ids.join(',')})`;
    const none = Promise.resolve({ ok: true, json: [] as unknown[] });
    const swallow = () => ({ ok: false, json: null as unknown });
    const todayStart = now.slice(0, 10) + 'T00:00:00Z';
    const [recv, supQ, slinkQ, dealsQ, pubQ, connQ, remQ, snQ] = await Promise.all([
      own ? loadReceivables(own).catch(() => null) : Promise.resolve(null),
      // client_id + requester (sales review B2): name a project-less request; the
      // narrow select is the fallback for a database without 0115's column
      own ? svc(`presence_support_requests?site_id=eq.${own.id}&status=in.(open,in_progress)&deleted_at=is.null&select=id,subject,project_id,client_id,requester,created_at,updated_at&limit=200`)
        .then((r) => (r.ok ? r : svc(`presence_support_requests?site_id=eq.${own.id}&status=in.(open,in_progress)&deleted_at=is.null&select=id,subject,project_id,created_at,updated_at&limit=200`))).catch(swallow) : none,
      own ? svc(`presence_service_links?agency_site_id=eq.${own.id}&status=eq.active&select=project_id,customer_client_id,customer_site_id&limit=500`).catch(swallow) : none,
      // next_step/next_step_at land with migration 0089 — a database without it answers "no stale steps", never an error
      own ? svc(`presence_deals?site_id=eq.${own.id}&deleted_at=is.null&stage=in.(lead,qualified,proposal,contract)&next_step=not.is.null&select=id,title,stage,next_step,next_step_at,contact_id,converted_client_id,converted_site_id&limit=500`).then((r) => (r.ok ? r : { ok: true, json: [] })).catch(swallow) : none,
      ids.length ? svc(`presence_publishes?${IN}&select=site_id,status,created_at,error_text&order=created_at.desc&limit=1000`).catch(swallow) : none,
      ids.length ? svc(`presence_connections?${IN}&status=in.(expired,error,revoked)&select=site_id,provider_key,status&limit=500`).catch(swallow) : none,
      own ? svc(`presence_plan_notices?site_id=eq.${own.id}&kind=eq.deal_followup&period=like.invremind:*&created_at=gte.${todayStart}&select=period,created_at&limit=500`).catch(swallow) : none,
      // item 70: what's snoozed (APPLY-0146); before the table exists the read fails and nothing is held back
      svc(`presence_needs_snoozes?agency_id=eq.${member.agency_id}&until=gt.${encodeURIComponent(now)}&select=row_key,until,created_at&limit=500`).catch(swallow),
    ]);
    const rowsOf = <T,>(q: { ok: boolean; json: unknown }): T[] => (q.ok && Array.isArray(q.json) ? (q.json as T[]) : []);
    // Sales review B2: a request with no stamp and no project names its customer
    // through the requester's sign-in (stamped once), or at least their email.
    const supportRows = rowsOf<{ id: string; project_id?: string | null; client_id?: string | null; requester?: string | null; requester_email?: string | null; requester_name?: string | null }>(supQ);
    if (own && supportRows.length) {
      // item 96: when each request last saw a message, read beside the stamp (which can move
      // updated_at, so updated_at can't say); a failed read leaves every request un-aged
      const [owners, activity] = await Promise.all([healSupportOwners(own.id, supportRows), supportActivity(own.id, supportRows as Array<{ id?: unknown; created_at?: unknown }>)]);
      if (activity) for (const r of supportRows) (r as { last_activity_at?: string | null }).last_activity_at = activity[r.id] || null;
      for (const r of supportRows) { const cid = owners.clientOf[r.id]; if (cid && !r.client_id) r.client_id = cid; if (owners.emailOf[r.id]) r.requester_email = owners.emailOf[r.id]; if (owners.nameOf[r.id]) r.requester_name = owners.nameOf[r.id]; }
    }
    const invoices = (recv?.items ?? []) as Array<{ client_id: string | null; deal_id: string | null }>;
    const serviceLinks = rowsOf<{ project_id: string | null; customer_client_id: string | null; customer_site_id: string | null }>(slinkQ);
    const deals = rowsOf<{ id: string; title: string; stage: string; next_step: string | null; next_step_at: string | null; contact_id: string | null; converted_client_id: string | null; converted_site_id: string | null }>(dealsQ);
    // names the portfolio does not know by site: bridged-only customers (by client id) and deal contacts — two batched reads
    const clientIds = [...new Set([
      ...invoices.map((v) => v.client_id), ...serviceLinks.map((l) => l.customer_client_id), ...deals.map((d) => d.converted_client_id), ...supportRows.map((r) => r.client_id),
    ].filter((x): x is string => !!x && UUID_RE.test(x)))];
    const contactIds = [...new Set(deals.map((d) => d.contact_id).filter((x): x is string => !!x && UUID_RE.test(x)))];
    const [cnQ, ctQ] = await Promise.all([
      clientIds.length ? svc(`clients?id=in.(${clientIds.join(',')})&select=id,name,email&limit=1000`).catch(swallow) : none,
      contactIds.length ? svc(`presence_contacts?id=in.(${contactIds.join(',')})&select=id,name,email&limit=1000`).catch(swallow) : none,
    ]);
    const namesByClient = Object.fromEntries(rowsOf<{ id: string; name: string | null; email: string | null }>(cnQ).map((c) => [c.id, String(c.name || c.email || '')]).filter(([, n]) => n));
    const contactName = Object.fromEntries(rowsOf<{ id: string; name: string | null; email: string | null }>(ctQ).map((c) => [c.id, String(c.name || c.email || '')]));
    const ownFeed = await ownFeedP;
    // the deals the studio's deal notices name — a notice about a deal since
    // converted, lost or deleted is not a row, and it is cleared here
    let ownDeals: Record<string, { stage?: string | null; converted_client_id?: string | null; deleted_at?: string | null }> | undefined;
    if (own && ownFeed) {
      const ids = dealNoticeIds(ownFeed.notices || []);
      if (ids.length) {
        const dr = await svc(`presence_deals?site_id=eq.${own.id}&id=in.(${ids.join(',')})&select=id,stage,converted_client_id,deleted_at`).catch(() => null);
        if (dr && dr.ok && Array.isArray(dr.json)) {
          ownDeals = Object.fromEntries((dr.json as Array<{ id: string; stage: string; converted_client_id: string | null; deleted_at: string | null }>).map((d) => [String(d.id).toLowerCase(), d]));
          // batch B: the stale ones clear side by side, not one after another
          if (own.client_id) await Promise.all(staleDealNotices(ownFeed.notices || [], ownDeals).map((n) => clearNotice(String(own.client_id), String(n.kind), String(n.period)).catch(() => {})));
        }
      }
    }
    const payload = needsYouPayload({
      nowIso: now, links: input.links, clientNames: input.clientNames, namesByClient, sites: input.sites,
      invoices: (recv?.items ?? []) as never, reminders: rowsOf<{ period: string; created_at: string }>(remQ).map((r) => ({ period: r.period, at: r.created_at })),
      enquiries: input.enquiries, support: supportRows.map(({ requester: _r, ...row }) => row), serviceLinks,
      deals: deals.map((d) => ({ ...d, contact_name: d.contact_id ? contactName[d.contact_id] || null : null })),
      publishes: rowsOf(pubQ), connections: rowsOf(connQ), evidence: input.evidence, plans: input.plans, lastChange: input.lastChange,
      own: ownFeed ? { site_id: own?.id || null, enquiries: ownFeed.enquiries || [], messages: ownFeed.client_messages || [], notices: ownFeed.notices || [], deals: ownDeals } : undefined,
      snoozed: Object.fromEntries(rowsOf<{ row_key: string; until: string }>(snQ).map((x) => [String(x.row_key), String(x.until)])),
      snoozedAt: Object.fromEntries(rowsOf<{ row_key: string; created_at?: string | null }>(snQ).filter((x) => x.created_at).map((x) => [String(x.row_key), String(x.created_at)])),   // bug hunt A2: news after the snooze wakes the row
    });
    // partial = a slot could not be read (the list may be missing rows, never wrong ones); own_site=false = no studio site to read money/support/deals from
    const partial = !own || !recv || !ownFeed || [supQ, slinkQ, dealsQ, pubQ, connQ, remQ].some((q) => !q.ok);
    needsTotals.set(member.agency_id, { at: Date.now(), total: Number(payload.total) || 0 });
    // batch B: the bell's Updates tab — the same feed rows /portal/feed would
    // have sent, so opening the bell is one call, not two feeds
    const update_notices = ownFeed ? (ownFeed.notices || []).filter((n: { tier?: string }) => n && n.tier === 'update') : [];
    // builder list item 47: news per client site for the bell's Updates tab, each naming the
    // site and opening the right place inside it (?client= carries the scope)
    const news = siteNews(input.notices || [], input.clientNames, now);
    return { ...payload, partial, own_site: !!own, update_notices, news, snooze_ready: !!snQ.ok };
}

/** Item 47 (pure): the update-tier notices across client sites from the last fourteen days,
 *  newest first, at most twelve, each with the site's name and a link that carries the
 *  client's scope: "Bacchus Kitchen — Published 3 changes · View". */
export const SITE_NEWS_KINDS: ReadonlySet<string> = new Set(['site_published', 'traffic_spike', 'domain_expiry', 'new_review', 'new_booking']);
export function siteNews(notices: Array<{ id?: string; site_id: string; kind: string; period?: string; headline?: string; body?: string; created_at?: string }>, names: Record<string, string>, nowIso: string, cap = 12) {
  const since = new Date(Date.parse(nowIso) - 14 * 86_400_000).toISOString();
  return notices
    .filter((n) => SITE_NEWS_KINDS.has(String(n.kind)) && String(n.created_at || '') >= since && names[n.site_id])
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, cap)
    .map((n) => ({ id: n.id || null, site_id: n.site_id, name: names[n.site_id], kind: n.kind, headline: String(n.headline || ''), body: String(n.body || ''), at: n.created_at || null,
      href: withClient(noticeHrefFor({ kind: String(n.kind), period: n.period }), n.site_id), tier: noticeTier(n.kind) }));
}
const withClient = (href: string, siteId: string) => { const [p, h] = href.split('#'); return p + (p.includes('?') ? '&' : '?') + 'client=' + encodeURIComponent(siteId) + (h ? '#' + h : ''); };

async function ownSiteOf(jwt: string, principal: Principal): Promise<SiteRow | null> {
  if (!jwt) return null;
  try {
    const s = await resolveSite(jwt);
    if (s) return s;
    if (!principal.userId && !principal.email) return null;
    const or = `or=(user_id.eq.${encodeURIComponent(principal.userId || '00000000-0000-0000-0000-000000000000')},email.eq.${encodeURIComponent((principal.email || '').toLowerCase())})`;
    const m = await svc(`presence_site_members?status=eq.active&${or}&select=site_id&order=created_at.asc&limit=1`);
    const siteId = Array.isArray(m.json) && (m.json as Array<{ site_id: string }>)[0]?.site_id;
    if (!siteId) return null;
    const [site] = await loadSites([siteId]);
    return site || null;
  } catch { return null; }
}

/** Dispatch one existing engine per site, sequentially, each outcome recorded.
 *  Reversibility is inherited: observation/proposal engines change nothing;
 *  publish runs the frozen pipeline whose history restores in one step. */
async function runBulk(action: string, ids: string[], principal: Principal): Promise<Array<{ site_id: string; ok: boolean; note: string }>> {
  const sites = await loadSites(ids);
  // the client names the scope carries (one batched read; the publish path
  // only needs site_id to attribute, the name is for the record)
  const names = new Map<string, string>();
  if (action === 'publish' && sites.length) {
    try {
      const r = await svc(`presence_identity?site_id=in.(${sites.map((s) => s.id).join(',')})&select=site_id,business_name`);
      for (const row of (Array.isArray(r.json) ? r.json : []) as Array<{ site_id: string; business_name?: string }>) if (row.business_name) names.set(row.site_id, String(row.business_name));
    } catch { /* names are cosmetic; attribution does not depend on them */ }
  }
  const results: Array<{ site_id: string; ok: boolean; note: string }> = [];
  for (const site of sites) {
    try {
      if (action === 'observe') { const r = await runEvidence(site, 'operator'); results.push({ site_id: site.id, ok: r.ok, note: `${r.item_count} observations` }); }
      else if (action === 'judge') { const r = await runJudgment(site); results.push({ site_id: site.id, ok: r.ok, note: 'judged' }); }
      else if (action === 'recommend') { const r = await runRecommendation(site); results.push({ site_id: site.id, ok: r.ok, note: 'recommendations refreshed' }); }
      else if (action === 'moments') { const r = await runMoments(site); results.push({ site_id: site.id, ok: r.ok, note: `${r.active ?? 0} active moments` }); }
      else if (action === 'coach') { const r = await runGrowthCoach(site); results.push({ site_id: site.id, ok: r.ok, note: `${r.opportunities} opportunities` }); }
      else if (action === 'review') { const r = await runReview(site, { kind: 'site' }); results.push({ site_id: site.id, ok: r.ok, note: `${r.findings ?? 0} findings` }); }
      else if (action === 'brand_review') { const r = await runBrandReview(site, { kind: 'site' }); results.push({ site_id: site.id, ok: r.ok, note: `${r.findings} findings` }); }
      else if (action === 'readiness') { const r = await computeReadiness(site); results.push({ site_id: site.id, ok: !!r, note: r ? 'readiness refreshed' : 'no verified connection' }); }
      else if (action === 'publish') {
        if (site.edition === 'monitor') { results.push({ site_id: site.id, ok: false, note: 'monitor sites never publish' }); continue; }
        // Studio audit change 2 (follow-up): a bulk publish is the STUDIO's hand on
        // each client's site, exactly like the ?client= drill-in — so hand the
        // pipeline a principal scoped to THIS site. lib/actor_kind.ts then records
        // actor_kind 'operator' (platform staff stay 'staff') and the client gets
        // the "Your studio published a change" notice. A per-site copy: the
        // member's own principal is never mutated across the loop.
        const scoped: Principal = { ...principal, scope: { site_id: site.id, name: names.get(site.id) || 'Client' } };
        const resp = await handlePublish(null, site, scoped, {}); // M4: agency bulk — no client idempotency/cooldown per site
        results.push({ site_id: site.id, ok: resp.status === 200, note: resp.status === 200 ? 'published through the one pipeline' : `refused (${resp.status})` });
      }
    } catch (e) {
      results.push({ site_id: site.id, ok: false, note: (e as Error)?.message?.slice(0, 120) || 'failed' });
    }
  }
  return results;
}

/* guided onboarding — a checklist derived from actual state, never a wizard that acts alone */
function onboardingChecklist(s?: { edition?: string; monitor_status?: string | null; brand_started?: boolean; knowledge?: boolean; published?: boolean }) {
  return [
    { step: 'Choose the edition', done: !!s?.edition, how: 'Monitor observes their existing site; Presence hosts a new one. The operator flips it any time.' },
    { step: 'Connect & verify their website (Monitor)', done: s?.monitor_status === 'verified', how: 'One read-only proof — a meta tag, a file, or a DNS record. Nothing on their site changes.' },
    { step: 'Start the Brand Profile', done: !!s?.brand_started, how: 'Three fields carry most of it: personality, words to avoid, reading level.' },
    { step: 'Bring their papers', done: !!s?.knowledge, how: 'A menu or price sheet pasted in — disagreements start surfacing on their own.' },
    { step: 'First observation run', done: !!s?.published || s?.monitor_status === 'verified', how: 'Run observe from the portfolio — moments and queues fill from there.' },
  ];
}
