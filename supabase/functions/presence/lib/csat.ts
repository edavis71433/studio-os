// ── CSAT "ask how it went" — a 1-question survey, no new store (service edge #1) ─
// After a support request is resolved or a project completes, offer the client a
// single-question rating. A CSAT is just a SMALL survey, so this REUSES the whole
// survey spine (presence_surveys + presence_survey_responses, the same idempotent
// respond path in routes/service_intake.ts / routes/client_delivery.ts) — no new
// table, no second feedback system. The offer email rides the existing bridged-
// customer channel (lib/service_bridge.ts emailBridgedCustomer). The resulting
// rating folds into the existing client report as a COMPUTED average (see
// lib/service_delivery.ts reportSummary) — never a stored metric.
//
// The pure helpers (marker, title, average) carry no I/O so they are unit-tested;
// offerCsat() does the idempotent create + best-effort email.
import { svc } from './db.ts';
import { emailBridgedCustomer } from './service_bridge.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];

/** The stable question key that MARKS a survey as a CSAT (so responses aggregate
 *  uniformly and the report can find them). Reused on read + write. */
export const CSAT_QUESTION_KEY = 'csat';

/** The one rating question a CSAT survey is built from — the survey Question shape. Pure. */
export function csatQuestions(): Array<{ key: string; label: string; type: 'rating' }> {
  return [{ key: CSAT_QUESTION_KEY, label: 'How would you rate your experience?', type: 'rating' }];
}

/** Deterministic title per source, so the offer is idempotent (one CSAT per
 *  project on completion; one per resolved ticket). Pure. */
export function csatTitle(source: 'project' | 'support', sourceId: string): string {
  return source === 'support'
    ? `How did we do? (request ${String(sourceId).slice(0, 8)})`
    : 'How did we do?';
}

/** A CSAT survey is any survey whose question set carries the csat key. Pure. */
export function isCsatSurvey(s: { questions?: unknown }): boolean {
  const q = Array.isArray((s as any)?.questions) ? (s as any).questions : [];
  return q.some((x: any) => x && x.key === CSAT_QUESTION_KEY);
}

/** Read the csat rating (1..N) from a response's answers bag, or null. Pure. */
export function csatRatingOf(resp: { answers?: Record<string, unknown> }): number | null {
  const n = Number(resp?.answers?.[CSAT_QUESTION_KEY]);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** Average (one decimal) + count over a list of numeric ratings, or null when
 *  none. The report's single source of the CSAT figure — computed, not stored. Pure. */
export function csatAverage(ratings: number[]): { count: number; average: number } | null {
  const vals = ratings.filter((n) => Number.isFinite(n) && n >= 1);
  if (!vals.length) return null;
  return { count: vals.length, average: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 };
}

/** The CSAT ratings collected for a project (across its CSAT surveys' submitted
 *  responses). Bounded. Impure (reads surveys + responses); the report folds
 *  these into a computed average. Never throws — a read failure yields []. */
export async function csatRatingsForProject(siteId: string, projectId: string): Promise<number[]> {
  try {
    const surveys = rows(await svc(`presence_surveys?site_id=eq.${siteId}&project_id=eq.${projectId}&deleted_at=is.null&select=id,questions&limit=100`));
    const ids = surveys.filter(isCsatSurvey).map((s) => s.id);
    if (!ids.length) return [];
    const resp = rows(await svc(`presence_survey_responses?site_id=eq.${siteId}&survey_id=in.(${ids.join(',')})&status=eq.submitted&deleted_at=is.null&select=answers&limit=500`));
    return resp.map((r) => csatRatingOf(r)).filter((n): n is number => n !== null);
  } catch { return []; }
}

/** Offer a CSAT for a completed project or a resolved support request. Idempotent:
 *  a CSAT survey with this source's deterministic title is created at most once
 *  (a second call no-ops). Requires a project_id (the only thing the client can
 *  reach through the bridge + the only thing emailBridgedCustomer can resolve a
 *  recipient from). Best-effort: never throws; returns true only on a fresh offer. */
export async function offerCsat(opts: {
  agencySiteId: string; projectId: string | null; source: 'project' | 'support'; sourceId: string;
}): Promise<boolean> {
  const { agencySiteId, projectId, source, sourceId } = opts;
  if (!projectId) return false;
  try {
    const title = csatTitle(source, sourceId);
    // idempotent guard: scan this project's (few) surveys in code so we never
    // depend on PostgREST filter grammar for a title with spaces/parens.
    const existing = rows(await svc(`presence_surveys?site_id=eq.${agencySiteId}&project_id=eq.${projectId}&deleted_at=is.null&select=id,title,questions&limit=100`));
    if (existing.some((s) => isCsatSurvey(s) && s.title === title)) return false;
    const ins = await svc('presence_surveys', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: agencySiteId, project_id: projectId, title, questions: csatQuestions(), status: 'active', client_visible: true }) });
    const survey = rows(ins)[0];
    if (!survey) return false;
    // surface it on the client's timeline/bell like every manual survey does
    await svc('presence_project_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ project_id: projectId, site_id: agencySiteId, kind: 'survey_requested', actor: 'system', actor_kind: 'system', client_visible: true, detail: { survey_id: survey.id, title, csat: true } }) }).catch(() => {});
    // the calm transactional offer email (rides the "your project needs you" channel)
    const lead = source === 'support' ? 'Your support request is resolved.' : 'Your project is complete.';
    await emailBridgedCustomer(agencySiteId, projectId,
      'How did we do?',
      `<p>${lead} We'd love a quick word on how it went — it takes about ten seconds, one question.</p>`).catch(() => {});
    return true;
  } catch (e) {
    console.error(`[csat] offer failed for project ${projectId}: ${String((e as Error)?.message || e)} (non-fatal)`);
    return false;
  }
}
