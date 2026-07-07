// ── The /agency router (M13) — orchestration over the frozen platform ───────
// Every handler: membership resolved (fail-closed) → role capability check →
// operations fenced to the agency's OWN linked sites → dispatch EXISTING
// per-site engines / read EXISTING rows. Nothing here has a power that a
// single-site route lacks; nothing bypasses client ownership (drafts and
// plans still wait on the client; publishing runs the one frozen pipeline).
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { can, agencySiteIds } from './auth.ts';
import { buildPortfolio, filterPortfolio, buildQueues, buildPatterns } from './portfolio.ts';
import type { AgencyMember } from './auth.ts';
import type { PortfolioInput } from './portfolio.ts';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const forbid = (cors: Record<string, string>) => json({ error: 'forbidden', message: 'Your role doesn’t include this.' }, 403, cors);

async function loadSites(ids: string[]): Promise<SiteRow[]> {
  if (!ids.length) return [];
  const r = await svc(`presence_sites?id=in.(${ids.join(',')})&select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition`);
  return r.json ?? [];
}

/* ── the fixed-cost gather: one batched query per table, any client count ── */
async function gather(agencyId: string, nowIso: string): Promise<PortfolioInput> {
  const linksQ = await svc(`presence_agency_clients?agency_id=eq.${agencyId}&select=site_id,status,tags,owner_email,assigned,notes,onboarded_at&limit=1000`);
  const links = (linksQ.json ?? []) as PortfolioInput['links'];
  const ids = links.map((l) => l.site_id);
  if (!ids.length) {
    return { sites: [], links: [], clientNames: {}, moments: [], evidence: [], opportunities: [], plans: [], drafts: [], connections: [], reviewReports: [], brandReports: [], lastChange: {}, nowIso };
  }
  const IN = `site_id=in.(${ids.join(',')})`;
  const [sitesQ, momQ, oppQ, planQ, draftQ, connQ, revQ, brandQ, evtQ, runQ] = await Promise.all([
    svc(`presence_sites?id=in.(${ids.join(',')})&select=id,client_id,edition,status,last_published_at,custom_domain&limit=1000`),
    svc(`presence_moments?${IN}&status=eq.active&select=site_id,moment_key,moment_type,headline&limit=1000`),
    svc(`presence_growth_opportunities?${IN}&status=eq.open&select=site_id,area,opportunity,timing_ends,created_at&limit=1000`),
    svc(`presence_infra_plans?${IN}&status=in.(proposed,approved)&select=site_id,kind,title,status&limit=1000`),
    svc(`presence_ai_drafts?${IN}&status=eq.proposed&select=site_id,kind,status,created_at&limit=1000`),
    svc(`presence_monitor_connections?${IN}&select=site_id,status,readiness&limit=1000`),
    svc(`presence_ai_reviews?${IN}&status=eq.open&select=site_id,status,open_count&limit=1000`),
    svc(`presence_brand_reports?${IN}&status=eq.open&select=site_id,status,open_count&limit=1000`),
    svc(`presence_change_events?${IN}&select=site_id,created_at&order=created_at.desc&limit=1000`),
    svc(`presence_evidence_runs?${IN}&finished_at=not.is.null&error_text=is.null&select=id,site_id,started_at&order=started_at.desc&limit=500`),
  ]);
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
  const evQ = runIds.length
    ? await svc(`presence_evidence?run_id=in.(${runIds.join(',')})&severity=in.(critical,warning)&select=run_id,type,severity,human&limit=2000`)
    : { json: [] as unknown[] };
  const sites = (sitesQ.json ?? []) as Array<PortfolioInput['sites'][0] & { client_id: string }>;
  const clientIds = [...new Set(sites.map((s) => s.client_id))];
  const namesQ = clientIds.length ? await svc(`clients?id=in.(${clientIds.join(',')})&select=id,name&limit=1000`) : { json: [] };
  const nameByClient = Object.fromEntries(((namesQ.json ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  return {
    sites, links,
    clientNames: Object.fromEntries(sites.map((s) => [s.id, nameByClient[s.client_id] || ''])),
    moments: ((momQ.json ?? []) as Array<{ site_id: string; moment_key: string; moment_type: string; headline: string }>)
      .map((m) => ({ site_id: m.site_id, moment_key: m.moment_key, type: m.moment_type, headline: m.headline })),
    evidence: ((evQ.json ?? []) as Array<{ run_id: string; type: string; severity: string; human: string }>)
      .map((e) => ({ site_id: runToSite[e.run_id], type: e.type, severity: e.severity, human: e.human })).filter((e) => e.site_id),
    opportunities: oppQ.json ?? [], plans: planQ.json ?? [], drafts: draftQ.json ?? [],
    connections: connQ.json ?? [], reviewReports: revQ.json ?? [], brandReports: brandQ.json ?? [],
    lastChange, nowIso,
  };
}

export async function handleAgency(req: Request, route: string, method: string, member: AgencyMember, principal: Principal, cors: Record<string, string>): Promise<Response> {
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
    return json({ data: { agency: member.agency_name, role: member.role, plan: member.plan, branding: member.branding } }, 200, cors);
  }

  // ── the portfolio: directory + everything observable from one place ──
  if (route === '/agency/portfolio' && method === 'GET') {
    const url = new URL(req.url);
    const input = await gather(member.agency_id, now);
    const rows = filterPortfolio(buildPortfolio(input), {
      search: url.searchParams.get('search') || undefined,
      tag: url.searchParams.get('tag') || undefined,
      archived: url.searchParams.has('archived') ? url.searchParams.get('archived') === 'true' : false,
    });
    return json({ data: rows }, 200, cors);
  }

  // ── work queues + cross-client patterns — from the existing pipeline only ──
  if (route === '/agency/queues' && method === 'GET') {
    const input = await gather(member.agency_id, now);
    return json({ data: { queues: buildQueues(input), patterns: buildPatterns(input) } }, 200, cors);
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
    const w = await svc(`presence_agency_clients?on_conflict=site_id&select=site_id,status,tags,owner_email`, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ site_id: b.site_id, agency_id: member.agency_id, tags: Array.isArray(b.tags) ? b.tags.slice(0, 10) : [], owner_email: member.email }),
    });
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

  // ── team management ──
  if (route === '/agency/members' && method === 'GET') {
    const r = await svc(`presence_agency_members?agency_id=eq.${member.agency_id}&select=id,email,role,status,created_at&order=created_at.asc&limit=200`);
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
    return json({ data: w.json[0] }, 200, cors);
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

  return json({ error: 'not_found', message: `No agency route for ${method} ${route}.` }, 404, cors);
}

/** Dispatch one existing engine per site, sequentially, each outcome recorded.
 *  Reversibility is inherited: observation/proposal engines change nothing;
 *  publish runs the frozen pipeline whose history restores in one step. */
async function runBulk(action: string, ids: string[], principal: Principal): Promise<Array<{ site_id: string; ok: boolean; note: string }>> {
  const sites = await loadSites(ids);
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
        const resp = await handlePublish(site, principal, {});
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
