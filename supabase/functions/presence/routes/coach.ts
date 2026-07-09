// ── Client-facing Growth Coach routes (M9.5E) ────────────────────────────────
//   POST /coach/run                        — refresh the opportunity list
//   GET  /coach/opportunities              — open (+ matured deferred) opportunities
//   POST /coach/opportunities/:id/decide   — {decision: accept|dismiss|defer, until?}
// The Coach observes, plans, and prepares. Nothing here writes content,
// publishes, schedules, or sends. "Accept" returns the prepared handoff and
// the room invokes the EXISTING Writer/Editor flow — proposal, approval,
// Draft Writer, all unchanged. Ignoring an opportunity is always free.
import { json } from '../../_shared/http.ts';
import { asUser, svc } from '../lib/db.ts';
import { runGrowthCoach, decideOpportunity } from '../coach/engine.ts';
import { coachRead } from '../lib/health_coach.ts';
import { buildTimeline } from '../lib/customer_timeline.ts';
import { memorySentence } from '../lib/business_memory.ts';
import { loadBusinessMemory } from '../concierge/grounding.ts';
import { anthropicModel } from '../writer/model.ts';
import type { SiteRow } from '../lib/site.ts';
import { loadPlan } from '../commerce/enforce.ts';
import { raiseCapacityNoticeIfNeeded } from '../commerce/metering.ts';

const OPP_SELECT = 'id,area,opportunity,why_it_matters,supporting_evidence,expected_benefit,estimated_effort,timing_starts,timing_ends,timing_phrase,suggested_next_step,manual_possible,approval_required,ai_can_draft,handoff,status,deferred_until,created_at';

export async function handleCoachRun(site: SiteRow, cors: Record<string, string>) {
  // Coach is observational — available on every plan (Monitor included). When the
  // AI tier is on, a run is a metered generative op (counts toward capacity).
  const aiOn = anthropicModel() !== null;
  const summary = await runGrowthCoach(site, true);   // AI-1: explicit user request → model tier allowed + metered in-engine (real tokens)
  if (!summary.ok) return json({ error: 'coach_failed', message: 'The look-ahead didn’t come through — nothing was changed, because the coach never changes anything.' }, 502, cors);
  if (aiOn) {
    // token metering now happens inside runGrowthCoach via meterModel (real counts);
    // here we only raise the calm capacity notice if they've outgrown their plan.
    loadPlan(site.client_id).then((plan) => raiseCapacityNoticeIfNeeded(site, plan)).catch(() => {});
  }
  return json({ data: summary }, 200, cors);
}

export async function handleCoachList(jwt: string, site: SiteRow, cors: Record<string, string>) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await asUser(jwt, `presence_growth_opportunities?site_id=eq.${site.id}&or=(status.eq.open,and(status.eq.deferred,deferred_until.lte.${today}))&select=${OPP_SELECT}&order=timing_ends.asc.nullslast,created_at.desc&limit=12`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t open the opportunity list just now.' }, 502, cors);
  return json({ data: r.json ?? [] }, 200, cors);
}

// ── PT-6: the Business Health Coach — one plain-English read, never a score ──
// Composes signals the platform already stores into the coach's calm sentence +
// at most three suggestions. Reuses the notices/approvals/leads/domain state.
export async function handleCoachHealth(site: SiteRow, cors: Record<string, string>) {
  const nowIso = new Date().toISOString();
  const [infra, writes, conns, leads, lastChange, meta] = await Promise.all([
    svc(`presence_infra_plans?site_id=eq.${site.id}&status=eq.proposed&select=id`),
    svc(`presence_connection_writes?site_id=eq.${site.id}&status=eq.proposed&select=id`),
    svc(`presence_connections?site_id=eq.${site.id}&select=status,health`),
    svc(`presence_form_submissions?site_id=eq.${site.id}&status=eq.new&spam=is.false&select=id`),
    svc(`presence_change_events?site_id=eq.${site.id}&select=created_at&order=created_at.desc&limit=1`),
    svc(`presence_sites?id=eq.${site.id}&select=domain_expires_at&limit=1`),
  ]);
  const arr = (r: { json?: unknown }): any[] => (Array.isArray((r as { json?: unknown[] }).json) ? (r as { json: any[] }).json : []);
  const connAttn = arr(conns).filter((c) => ['error', 'expired', 'revoked'].includes(c.status) || ['attention', 'down'].includes(c.health)).length;
  const lastChangeAt = arr(lastChange)[0]?.created_at || null;
  const domExp = arr(meta)[0]?.domain_expires_at || null;
  const domainDays = domExp ? Math.floor((Date.parse(domExp) - Date.parse(nowIso)) / 86400_000) : null;
  const read = coachRead({
    live: site.status === 'live',
    lastPublishedAt: site.last_published_at || null,
    pendingApprovals: arr(infra).length + arr(writes).length,
    connectedNeedingAttention: connAttn,
    searchIssues: 0,
    leadsWaiting: arr(leads).length,
    unpublishedChanges: !!lastChangeAt && (!site.last_published_at || lastChangeAt > site.last_published_at),
    domainExpiringDays: domainDays,
  }, nowIso);
  return json({ data: read }, 200, cors);
}

// ── PT-7: the Customer Timeline — the business journey, from existing events ──
export async function handleCoachJourney(site: SiteRow, cors: Record<string, string>) {
  const nowIso = new Date().toISOString();
  const [firstPub, firstLead, firstVisit, ident, ent, meta] = await Promise.all([
    svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=created_at,completed_at&order=created_at.asc&limit=1`),
    svc(`presence_form_submissions?site_id=eq.${site.id}&spam=is.false&select=created_at&order=created_at.asc&limit=1`),
    svc(`presence_visits?site_id=eq.${site.id}&kind=eq.pageview&select=ts&order=ts.asc&limit=1`),
    svc(`presence_identity?site_id=eq.${site.id}&select=settings&limit=1`),
    site.client_id ? svc(`presence_entitlements?client_id=eq.${encodeURIComponent(site.client_id)}&product=eq.presence&select=status,created_at,current_period_end&limit=1`) : Promise.resolve({ json: [] }),
    svc(`presence_sites?id=eq.${site.id}&select=created_at&limit=1`),
  ]);
  const arr = (r: { json?: unknown }): any[] => (Array.isArray((r as { json?: unknown[] }).json) ? (r as { json: any[] }).json : []);
  const verification = arr(ident)[0]?.settings?.verification;
  const e = arr(ent)[0] || {};
  const journey = buildTimeline({
    createdAt: arr(meta)[0]?.created_at || nowIso,
    firstPublishedAt: arr(firstPub)[0]?.completed_at || arr(firstPub)[0]?.created_at || null,
    searchVerified: !!(verification && (verification.google || verification.bing)),
    firstVisitorAt: arr(firstVisit)[0]?.ts || null,
    firstInquiryAt: arr(firstLead)[0]?.created_at || null,
    firstCustomerAt: e.status === 'active' ? (e.created_at || null) : null,
    renewsAt: e.current_period_end || null,
  }, nowIso);
  return json({ data: journey }, 200, cors);
}

// ── PT-9: AI Business Memory — what the AI knows, assembled from existing data ─
export async function handleCoachMemory(site: SiteRow, cors: Record<string, string>) {
  const memory = await loadBusinessMemory(site);
  return json({ data: { memory, sentence: memorySentence(memory) } }, 200, cors);
}

export async function handleCoachDecide(req: Request, site: SiteRow, oppId: string, cors: Record<string, string>) {
  let body: { decision?: string; until?: string } = {};
  try { body = await req.json(); } catch { /* below */ }
  const decision = ['accept', 'dismiss', 'defer'].includes(body?.decision || '') ? body!.decision as 'accept' | 'dismiss' | 'defer' : null;
  if (!decision) return json({ error: 'bad_request', message: 'Decide with accept, dismiss, or defer.' }, 400, cors);
  const r = await decideOpportunity(site.id, oppId, decision, body?.until);
  if (!r.ok) return json({ error: 'not_found', message: 'That opportunity isn’t open anymore.' }, 404, cors);
  return json({ data: { ok: true, handoff: r.handoff ?? null } }, 200, cors);
}
