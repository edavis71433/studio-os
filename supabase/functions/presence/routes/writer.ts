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
import { rewriteSnippet, REWRITE_ACTIONS } from '../writer/rewrite.ts';
import type { RewriteAction } from '../writer/rewrite.ts';
import { anthropicModel } from '../writer/model.ts';
import type { WriterRequest, WriterKind } from '../writer/contract.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { loadPlan, draftingDenial } from '../commerce/enforce.ts';
import { meterModel, raiseCapacityNoticeIfNeeded, checkAiCeiling, ceilingDenial } from '../commerce/metering.ts';

const KINDS: WriterKind[] = ['identity_copy', 'faqs', 'offering_descriptions', 'post', 'testimonial_request', 'policy_doc', 'social_post', 'email_doc', 'page_copy', 'starter_site'];

export async function handleWriterGenerate(req: Request, site: SiteRow, cors: Record<string, string>) {
  // Plan enforcement: drafting belongs to Presence-and-up (entitlement, not UI).
  const plan = await loadPlan(site.client_id);
  const denied = draftingDenial(plan, cors);
  if (denied) return denied;
  // HARD cost ceiling — enforced before the provider call (a dismissed notice can't bypass it)
  const ceil = await checkAiCeiling(site.client_id);
  if (!ceil.allowed) { const d = ceilingDenial(cors); return json(d.body, d.status, d.cors); }

  const model = meterModel(anthropicModel(), { siteId: site.id, clientId: site.client_id, agent: 'writer' });
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
  // A successful generative op may raise the calm capacity notice (never blocks).
  raiseCapacityNoticeIfNeeded(site, plan).catch(() => {});
  return json({ data: summary }, 200, cors);
}

// ── POST /writer/rewrite — the builder's "Write with AI" on every text block ──
//   {text, action:'improve'|'shorten'|'lengthen'|'tone'|'write', tone?, prompt?, field?, count?}
//   → { data: { text, options? } }
// `count` (1–3, Express-Rewrite parity) asks for that many candidates in ONE
// metered call; the reply keeps `text` (the first candidate) so old clients are
// untouched, and adds `options` when more than one came back.
// Transforms ONE snippet and returns the words directly. Stores nothing,
// publishes nothing, accepts nothing — the owner uses it into their draft and
// publishes by hand. Same plan gate, same HARD cost ceiling, same voice
// grounding, same honest 503 as handleWriterGenerate.
export async function handleWriterRewrite(req: Request, site: SiteRow, cors: Record<string, string>) {
  const plan = await loadPlan(site.client_id);
  const denied = draftingDenial(plan, cors);
  if (denied) return denied;
  const ceil = await checkAiCeiling(site.client_id);
  if (!ceil.allowed) { const d = ceilingDenial(cors); return json(d.body, d.status, d.cors); }

  const model = meterModel(anthropicModel(), { siteId: site.id, clientId: site.client_id, agent: 'writer' });
  if (!model) return json({ error: 'writer_unavailable', message: 'Writing help isn’t switched on right now. Everything can still be written by hand — nothing about your site depends on it.' }, 503, cors);
  let body: { action?: unknown; text?: unknown; tone?: unknown; prompt?: unknown; field?: unknown; count?: unknown } = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'That request didn’t read right — nothing happened.' }, 400, cors); }
  const action = typeof body.action === 'string' && (body.action in REWRITE_ACTIONS) ? body.action as RewriteAction : null;
  if (!action) return json({ error: 'bad_action', message: 'Choose what you’d like to do first.' }, 400, cors);
  const count = Math.max(1, Math.min(3, Number(body.count) || 1));   // bounded; 1 = the original shape

  const res = await rewriteSnippet(site, {
    action,
    text: typeof body.text === 'string' ? body.text.slice(0, 8000) : undefined,
    tone: typeof body.tone === 'string' ? body.tone.slice(0, 40) : undefined,
    prompt: typeof body.prompt === 'string' ? body.prompt.slice(0, 400) : undefined,
    field: typeof body.field === 'string' ? body.field.slice(0, 40) : undefined,
  }, model, count);

  if (!res.ok) {
    const msgs: Record<string, string> = {
      nothing_to_rewrite: 'There isn’t any text there yet — tell me what it should say and I’ll draft it.',
      no_prompt: 'Add a line about what it should say first.',
      bad_action: 'Choose what you’d like to do first.',
    };
    const msg = msgs[res.error || ''] || 'The writing didn’t come through — nothing was changed. Try again in a moment.';
    return json({ error: 'rewrite_failed', message: msg }, res.error === 'nothing_to_rewrite' || res.error === 'no_prompt' || res.error === 'bad_action' ? 400 : 502, cors);
  }
  // {text} stays exactly as before (old clients); {options} rides along when the
  // caller asked for candidates (even if the model returned fewer than asked).
  const payload: { text: string; options?: string[] } = { text: res.text };
  if (count > 1 && Array.isArray(res.options)) payload.options = res.options;
  return json({ data: payload }, 200, cors);
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
