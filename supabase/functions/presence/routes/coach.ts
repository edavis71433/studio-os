// ── Client-facing Growth Coach routes (M9.5E) ────────────────────────────────
//   POST /coach/run                        — refresh the opportunity list
//   GET  /coach/opportunities              — open (+ matured deferred) opportunities
//   POST /coach/opportunities/:id/decide   — {decision: accept|dismiss|defer, until?}
// The Coach observes, plans, and prepares. Nothing here writes content,
// publishes, schedules, or sends. "Accept" returns the prepared handoff and
// the room invokes the EXISTING Writer/Editor flow — proposal, approval,
// Draft Writer, all unchanged. Ignoring an opportunity is always free.
import { json } from '../../_shared/http.ts';
import { asUser } from '../lib/db.ts';
import { runGrowthCoach, decideOpportunity } from '../coach/engine.ts';
import type { SiteRow } from '../lib/site.ts';

const OPP_SELECT = 'id,area,opportunity,why_it_matters,supporting_evidence,expected_benefit,estimated_effort,timing_starts,timing_ends,timing_phrase,suggested_next_step,manual_possible,approval_required,ai_can_draft,handoff,status,deferred_until,created_at';

export async function handleCoachRun(site: SiteRow, cors: Record<string, string>) {
  const summary = await runGrowthCoach(site);
  if (!summary.ok) return json({ error: 'coach_failed', message: 'The look-ahead didn’t come through — nothing was changed, because the coach never changes anything.' }, 502, cors);
  return json({ data: summary }, 200, cors);
}

export async function handleCoachList(jwt: string, site: SiteRow, cors: Record<string, string>) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await asUser(jwt, `presence_growth_opportunities?site_id=eq.${site.id}&or=(status.eq.open,and(status.eq.deferred,deferred_until.lte.${today}))&select=${OPP_SELECT}&order=timing_ends.asc.nullslast,created_at.desc&limit=12`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t open the opportunity list just now.' }, 502, cors);
  return json({ data: r.json ?? [] }, 200, cors);
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
