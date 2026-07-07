// ── Client-facing AI Reviewer routes (M9.5C) ────────────────────────────────
//   POST /review/run                     — {scope: site|section|entity, section?, target_id?}
//   GET  /review/reports                 — recent reports (RLS-read)
//   GET  /review/reports/:id             — one report with its findings
//   POST /review/reports/:id/dismiss     — {finding_id} — per-finding, recorded
// The Reviewer only critiques. "Fix this" is the room handing a finding's
// prepared handoff to /editor/improve or /writer/generate — through the
// customer, with the same approvals as always.
import { json } from '../../_shared/http.ts';
import { asUser } from '../lib/db.ts';
import { runReview, dismissFinding } from '../reviewer/engine.ts';
import type { ReviewScope } from '../reviewer/engine.ts';
import type { SiteRow } from '../lib/site.ts';

export async function handleReviewRun(req: Request, site: SiteRow, cors: Record<string, string>) {
  let body: { scope?: string; section?: string; target_id?: string } = {};
  try { body = await req.json(); } catch { /* defaults to whole site */ }
  const kind = ['site', 'section', 'entity'].includes(body?.scope || '') ? body.scope as ReviewScope['kind'] : 'site';
  const scope: ReviewScope = {
    kind,
    section: kind === 'section' && ['business', 'offerings', 'faqs', 'updates'].includes(body?.section || '') ? body.section : undefined,
    targetId: kind === 'entity' && /^[0-9a-f-]{36}$/.test(body?.target_id || '') ? body.target_id : undefined,
  };
  if (kind === 'section' && !scope.section) return json({ error: 'bad_scope', message: 'Which part should be looked over?' }, 400, cors);
  if (kind === 'entity' && !scope.targetId) return json({ error: 'bad_scope', message: 'Which item should be looked over?' }, 400, cors);

  const summary = await runReview(site, scope);
  if (!summary.ok) return json({ error: 'review_failed', message: 'The review didn’t come through — nothing was changed, because reviews never change anything.' }, 502, cors);
  return json({ data: summary }, 200, cors);
}

export async function handleReviewList(jwt: string, site: SiteRow, cors: Record<string, string>) {
  const r = await asUser(jwt, `presence_ai_reviews?site_id=eq.${site.id}&select=id,scope,target,status,open_count,deterministic_only,created_at&order=created_at.desc&limit=10`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t open the reviews just now.' }, 502, cors);
  return json({ data: r.json ?? [] }, 200, cors);
}

export async function handleReviewGet(jwt: string, site: SiteRow, reviewId: string, cors: Record<string, string>) {
  const r = await asUser(jwt, `presence_ai_reviews?id=eq.${reviewId}&site_id=eq.${site.id}&select=id,scope,target,status,findings,open_count,deterministic_only,created_at&limit=1`);
  if (!r.ok || !r.json?.[0]) return json({ error: 'not_found', message: 'That review isn’t here.' }, 404, cors);
  return json({ data: r.json[0] }, 200, cors);
}

export async function handleReviewDismiss(req: Request, site: SiteRow, reviewId: string, cors: Record<string, string>) {
  let body: { finding_id?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const fid = String(body?.finding_id || '');
  if (!fid) return json({ error: 'bad_request', message: 'Which finding should be set aside?' }, 400, cors);
  const ok = await dismissFinding(site.id, reviewId, fid);
  if (!ok) return json({ error: 'not_found', message: 'That finding is gone already.' }, 404, cors);
  return json({ data: { ok: true } }, 200, cors);
}
