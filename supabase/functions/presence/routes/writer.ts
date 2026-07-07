// ── Client-facing AI Writer routes (M9.5A) — the Draft verb, rung 2 ─────────
//   POST /writer/generate            — writes a PROPOSAL, only when asked
//   GET  /writer/drafts              — recent proposals (own site, RLS-read)
//   GET  /writer/drafts/:id          — one proposal with its options
//   POST /writer/drafts/:id/accept   — {option, edits?} → the unmodified Draft Writer
//   POST /writer/drafts/:id/discard  — gone, recorded
// Everything optional, everything editable, everything reversible, nothing
// auto-publishes. Without ANTHROPIC_KEY the routes answer honestly that
// drafting help isn't available — the manual paths are always the product.
import { json } from '../../_shared/http.ts';
import { asUser } from '../lib/db.ts';
import { generateDraft, acceptDraft, discardDraft } from '../writer/engine.ts';
import { anthropicModel } from '../writer/model.ts';
import type { WriterRequest, WriterKind } from '../writer/contract.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const KINDS: WriterKind[] = ['identity_copy', 'faqs', 'offering_descriptions', 'post', 'testimonial_request', 'policy_doc', 'social_post', 'email_doc', 'page_copy', 'starter_site'];

export async function handleWriterGenerate(req: Request, site: SiteRow, cors: Record<string, string>) {
  const model = anthropicModel();
  if (!model) return json({ error: 'writer_unavailable', message: 'Drafting help isn’t switched on right now. Everything can still be written by hand — nothing about your site depends on it.' }, 503, cors);
  let body: Partial<WriterRequest> = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'That request didn’t read right — nothing happened.' }, 400, cors); }
  const kind = KINDS.includes(body.kind as WriterKind) ? body.kind as WriterKind : null;
  if (!kind) return json({ error: 'bad_kind', message: 'Choose what you’d like drafted first.' }, 400, cors);

  const summary = await generateDraft(site, {
    kind,
    instructions: String(body.instructions || '').slice(0, 600),
    tones: Array.isArray(body.tones) ? body.tones.slice(0, 3).map((t) => String(t).slice(0, 30)) : undefined,
    recommendation_hash: typeof body.recommendation_hash === 'string' ? body.recommendation_hash.slice(0, 40) : undefined,
    starter: kind === 'starter_site' && body.starter ? {
      services: Array.isArray(body.starter.services) ? body.starter.services.slice(0, 30) : [],
      goals: String(body.starter.goals || '').slice(0, 300),
    } : undefined,
  }, model);

  if (!summary.ok) {
    const msg = summary.error === 'all_options_failed_fact_guard'
      ? 'The draft came back wanting to say things we can’t verify, so it was set aside. Try again — or write it by hand, which always works.'
      : 'The drafting didn’t come through — nothing was changed. Try again in a moment.';
    return json({ error: 'generate_failed', message: msg, missing_facts: summary.missing_facts }, 502, cors);
  }
  return json({ data: summary }, 200, cors);
}

export async function handleWriterList(jwt: string, site: SiteRow, cors: Record<string, string>) {
  const r = await asUser(jwt, `presence_ai_drafts?site_id=eq.${site.id}&select=id,kind,status,prompt_summary,confidence,missing_facts,created_at,resolved_at,applied_summary&order=created_at.desc&limit=20`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t open your drafts just now.' }, 502, cors);
  return json({ data: r.json ?? [] }, 200, cors);
}

export async function handleWriterGet(jwt: string, site: SiteRow, draftId: string, cors: Record<string, string>) {
  const r = await asUser(jwt, `presence_ai_drafts?id=eq.${draftId}&site_id=eq.${site.id}&select=id,kind,status,prompt_summary,options,chosen_option,confidence,missing_facts,assumptions,approval_required,created_at&limit=1`);
  if (!r.ok || !r.json?.[0]) return json({ error: 'not_found', message: 'That draft isn’t here.' }, 404, cors);
  return json({ data: r.json[0] }, 200, cors);
}

export async function handleWriterAccept(req: Request, site: SiteRow, draftId: string, principal: Principal, cors: Record<string, string>) {
  let body: { option?: number; edits?: Record<string, unknown> } = {};
  try { body = await req.json(); } catch { /* option required below */ }
  const option = Number.isInteger(body?.option) ? Number(body.option) : -1;
  if (option < 0 || option > 2) return json({ error: 'bad_option', message: 'Choose which direction you’d like to keep.' }, 400, cors);
  const res = await acceptDraft(site, draftId, option, (body?.edits as never) || null, principal);
  if (!res.ok) {
    const msg = res.error === 'not_found' ? 'That draft is gone already.' : 'That didn’t apply — your draft is unchanged and nothing was lost.';
    return json({ error: res.error || 'accept_failed', message: msg }, res.error === 'not_found' ? 404 : 502, cors);
  }
  return json({ data: { ok: true, applied_summary: res.applied_summary, note: 'It’s in your draft now — look it over, edit anything, and publish when it reads right.' } }, 200, cors);
}

export async function handleWriterDiscard(site: SiteRow, draftId: string, cors: Record<string, string>) {
  const ok = await discardDraft(site, draftId);
  if (!ok) return json({ error: 'not_found', message: 'That draft is gone already.' }, 404, cors);
  return json({ data: { ok: true } }, 200, cors);
}
