// ── Client-facing Brand Guardian routes (M9.5D) ─────────────────────────────
//   GET  /brand/profile              — the customer's Brand Profile (+ learned, read-only)
//   PUT  /brand/profile              — the customer edits their own identity (manual parity)
//   POST /brand/review               — {scope: site|section, section?} → one report
//   GET  /brand/reports              — recent reports
//   GET  /brand/reports/:id          — one report (findings; internal metrics stay internal)
//   POST /brand/reports/:id/dismiss  — {finding_id}
// The Guardian critiques; "Improve" hands findings to the AI Editor through
// the customer. Nothing here writes content. No scores reach customers.
import { json } from '../../_shared/http.ts';
import { asUser, svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { runBrandReview, dismissBrandFinding } from '../guardian/engine.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const TEXT_FIELDS: Record<string, number> = {
  mission: 600, vision: 600, personality: 400, voice_characteristics: 600,
  preferred_vocabulary: 1000, never_claims: 1000, elevator_pitch: 600,
  target_audience: 400, brand_promise: 400,
};
const LIST_FIELDS: Record<string, number> = {
  core_values: 10, words_prefer: 30, words_avoid: 30, industry_terminology: 30, taglines: 8, selling_points: 10,
};
const READING_LEVELS = ['everyday', 'relaxed', 'professional', 'technical'];
const PROFILE_SELECT = 'mission,vision,core_values,personality,voice_characteristics,preferred_vocabulary,words_prefer,words_avoid,never_claims,reading_level,industry_terminology,taglines,elevator_pitch,target_audience,brand_promise,selling_points,learned,updated_at';

export async function handleBrandProfileGet(jwt: string, site: SiteRow, cors: Record<string, string>) {
  const r = await asUser(jwt, `presence_brand_profile?site_id=eq.${site.id}&select=${PROFILE_SELECT}&limit=1`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t open your brand profile just now.' }, 502, cors);
  return json({ data: r.json?.[0] ?? null }, 200, cors);
}

export async function handleBrandProfilePut(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { return json({ error: 'bad_json', message: 'That didn’t read right — nothing changed.' }, 400, cors); }
  const clean: Record<string, unknown> = {};
  const fields: string[] = [];
  for (const [k, cap] of Object.entries(TEXT_FIELDS)) {
    if (k in payload) { clean[k] = String(payload[k] ?? '').slice(0, cap); fields.push(k); }
  }
  for (const [k, cap] of Object.entries(LIST_FIELDS)) {
    if (k in payload && Array.isArray(payload[k])) {
      clean[k] = (payload[k] as unknown[]).slice(0, cap).map((v) => String(v).slice(0, 80)).filter(Boolean);
      fields.push(k);
    }
  }
  if ('reading_level' in payload && READING_LEVELS.includes(String(payload.reading_level))) {
    clean.reading_level = payload.reading_level; fields.push('reading_level');
  }
  if (!fields.length) return json({ error: 'empty_update', message: 'No editable fields were provided.' }, 400, cors);
  // `learned` is deliberately not writable here — guidance belongs to observation, the profile to the customer
  const w = await asUser(jwt, `presence_brand_profile?on_conflict=site_id&select=${PROFILE_SELECT}`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ site_id: site.id, ...clean }),
  });
  if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — nothing was changed. Please try again.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: 'Updated the brand profile', principal, provenance: 'human', fields });
  return json({ data: w.json[0] }, 200, cors);
}

export async function handleBrandReviewRun(req: Request, site: SiteRow, cors: Record<string, string>) {
  let body: { scope?: string; section?: string } = {};
  try { body = await req.json(); } catch { /* defaults to whole site */ }
  const kind = body?.scope === 'section' ? 'section' as const : 'site' as const;
  const section = kind === 'section' && ['business', 'offerings', 'faqs', 'updates'].includes(body?.section || '') ? body.section : undefined;
  if (kind === 'section' && !section) return json({ error: 'bad_scope', message: 'Which part should be looked over?' }, 400, cors);
  const summary = await runBrandReview(site, { kind, section });
  if (!summary.ok) return json({ error: 'brand_review_failed', message: 'The look-over didn’t come through — nothing was changed, because brand reviews never change anything.' }, 502, cors);
  return json({ data: summary }, 200, cors);
}

export async function handleBrandReportList(jwt: string, site: SiteRow, cors: Record<string, string>) {
  const r = await asUser(jwt, `presence_brand_reports?site_id=eq.${site.id}&select=id,scope,target,status,open_count,deterministic_only,created_at&order=created_at.desc&limit=10`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t open the brand reports just now.' }, 502, cors);
  return json({ data: r.json ?? [] }, 200, cors);
}

export async function handleBrandReportGet(jwt: string, site: SiteRow, reportId: string, cors: Record<string, string>) {
  // internal_metrics deliberately not selected — numbers stay internal (Law 13)
  const r = await asUser(jwt, `presence_brand_reports?id=eq.${reportId}&site_id=eq.${site.id}&select=id,scope,target,status,findings,open_count,deterministic_only,created_at&limit=1`);
  if (!r.ok || !r.json?.[0]) return json({ error: 'not_found', message: 'That report isn’t here.' }, 404, cors);
  return json({ data: r.json[0] }, 200, cors);
}

export async function handleBrandReportDismiss(req: Request, site: SiteRow, reportId: string, cors: Record<string, string>) {
  let body: { finding_id?: string } = {};
  try { body = await req.json(); } catch { /* below */ }
  const fid = String(body?.finding_id || '');
  if (!fid) return json({ error: 'bad_request', message: 'Which finding should be set aside?' }, 400, cors);
  const ok = await dismissBrandFinding(site.id, reportId, fid);
  if (!ok) return json({ error: 'not_found', message: 'That finding is gone already.' }, 404, cors);
  return json({ data: { ok: true } }, 200, cors);
}
