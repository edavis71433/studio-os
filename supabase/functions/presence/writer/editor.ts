// ── The AI Editor (M9.5B) — improve, never replace; preserve, never invent ──
// Rides the Writer's rails: same fact sheet, same Fact Guard (with the
// EXISTING content added to the allowed truth — editing may keep every fact
// already published), same proposal table, same acceptance through the
// unmodified Draft Writer. What the Editor adds:
//   • a 22-action taxonomy, each with its own why + expected benefit
//   • before-builders per kind, and a deterministic change summary
//   • the compare pack on every option — customers learn from edits
//   • recommendation awareness: an accepted recommendation's reasoning may
//     inform the edit; the editor never invents recommendations of its own
import { svc } from '../lib/db.ts';
import { buildFactSheet } from './facts.ts';
import { factGuard, selfCheck } from './guard.ts';
import { packFor } from './pack.ts';
import { WRITER_SYSTEM_BASE } from './model.ts';
import type { EditorKind, WriterPayload, WriterOption, ComparePack } from './contract.ts';
import type { ModelFn } from './model.ts';
import type { FactSheet } from './facts.ts';
import type { SiteRow } from '../lib/site.ts';
// (generateEdit stores on the Writer's proposal table; acceptance is shared)

export interface EditRequest {
  kind: EditorKind;
  action: string;                 // one of EDIT_ACTIONS
  target_id?: string;             // faq/offering/post id for single-entity kinds
  text?: string;                  // edit_document: the customer's own text to improve
  instructions?: string;
  tones?: string[];
  recommendation_hash?: string;   // recommendation awareness — never invention
}

/** The editing action taxonomy. Every action explains itself. */
export const EDIT_ACTIONS: Record<string, { instruction: string; why: string; benefit: string }> = {
  rewrite:        { instruction: 'Rewrite it fresh while keeping every fact and the same core message.', why: 'the current wording works, but a cleaner pass reads better', benefit: 'the same facts land with less effort for the reader' },
  expand:         { instruction: 'Expand it with more helpful detail — only from facts on the sheet.', why: 'the current text is thinner than what customers usually want to know', benefit: 'customers find answers without having to ask' },
  condense:       { instruction: 'Condense it — keep every fact, cut every spare word.', why: 'the current text takes longer to read than it needs to', benefit: 'more customers read to the end' },
  simplify:       { instruction: 'Simplify the language — shorter sentences, everyday words.', why: 'plain words reach more people', benefit: 'easier reading for every customer, on every device' },
  clarify:        { instruction: 'Clarify anything ambiguous; make each sentence say one thing.', why: 'small ambiguities make customers hesitate', benefit: 'fewer misunderstandings, fewer support questions' },
  modernize:      { instruction: 'Refresh dated phrasing without changing the personality.', why: 'some wording reads older than the business feels', benefit: 'the site feels current and cared-for' },
  readability:    { instruction: 'Improve readability: sentence rhythm, paragraph size, natural flow.', why: 'reading ease is measurable and this can score better', benefit: 'customers stay on the page longer' },
  accessibility:  { instruction: 'Improve accessibility of the text: descriptive phrasing, no vague references, clear structure.', why: 'clear structure helps assistive-technology users most of all', benefit: 'the content works for customers using screen readers' },
  seo:            { instruction: 'Improve how search engines read it: front-load the subject, natural keywords from the facts, never stuffing.', why: 'searchers see this text before they see the site', benefit: 'a clearer, more clickable search listing' },
  aeo:            { instruction: 'Improve answerability: lead with a direct answer, then the detail, so answer engines can quote it.', why: 'assistants and answer boxes quote text that answers directly', benefit: 'the business gets cited when customers ask questions' },
  conversion:     { instruction: 'Make the next step clearer and easier to take, using only real paths from the facts.', why: 'ready customers should never wonder what to do next', benefit: 'more visits turn into bookings and orders' },
  trust:         { instruction: 'Strengthen trust: concrete facts over adjectives, honest specifics over hype.', why: 'specifics are believed; superlatives are skimmed', benefit: 'customers trust what they read' },
  cta:            { instruction: 'Strengthen the calls to action: name the action and the destination plainly.', why: 'vague buttons lose ready customers', benefit: 'the path from reading to acting gets shorter' },
  headlines:      { instruction: 'Strengthen the headline(s): concrete, specific, in the business’s voice.', why: 'the headline decides whether the rest gets read', benefit: 'more readers continue past the first line' },
  linking:        { instruction: 'Where the text mentions other parts of the site (menu, questions, contact), phrase it so those references are natural and clear.', why: 'clear internal references help readers and search engines move through the site', benefit: 'visitors find related pages without hunting' },
  structure:      { instruction: 'Improve the structure: logical order, one idea per paragraph, headings in order where used.', why: 'well-ordered text is easier to scan and to quote', benefit: 'readers and search engines both follow it better' },
  flow:           { instruction: 'Improve the flow between sentences and paragraphs.', why: 'small seams in the writing make reading feel like work', benefit: 'the text reads like one voice, start to finish' },
  scannability:   { instruction: 'Make it scannable: front-loaded sentences, short paragraphs, list-like rhythm where natural.', why: 'most visitors scan before they read', benefit: 'scanners still leave with the facts' },
  grammar:        { instruction: 'Fix grammar, punctuation, and consistency without changing the voice.', why: 'small errors quietly cost credibility', benefit: 'polish that customers feel but never notice' },
  consistency:    { instruction: 'Make terminology and style consistent with the rest of the site’s content.', why: 'mixed terms for the same thing confuse customers', benefit: 'one voice across every page' },
  tone:           { instruction: 'Adjust the tone per the requested direction while keeping every fact.', why: 'the same truth can be said warmer, calmer, or more confidently', benefit: 'the writing sounds like the business at its best' },
  brand:          { instruction: 'Align the text with the voice profile: its tone notes, preferred vocabulary, and never-claims.', why: 'the voice profile is the brand in writing', benefit: 'everything reads unmistakably like this business' },
};

/* ── before-builders: the current text per kind (also fed to the guard as allowed truth) ── */
export function buildBefore(kind: EditorKind, facts: FactSheet, targetId: string | undefined, text: string | undefined): { before: Record<string, string>; ok: boolean; error?: string } {
  if (kind === 'edit_identity' || kind === 'site_polish') {
    const before: Record<string, string> = {};
    for (const k of ['tagline', 'description', 'story', 'service_area'] as const) if (facts[k]) before[k] = facts[k];
    if (kind === 'site_polish') {
      for (const f of facts.faqs_full.filter((f) => f.visible).slice(0, 12)) before[`faq:${f.id}`] = `${f.question}\n${f.answer}`;
      for (const o of facts.offerings.filter((o) => o.visible && o.description).slice(0, 20)) before[`offering:${o.id}`] = o.description;
    }
    if (!Object.keys(before).length) return { before, ok: false, error: 'nothing_to_edit' };
    return { before, ok: true };
  }
  if (kind === 'edit_faq') {
    const f = facts.faqs_full.find((x) => x.id === targetId);
    if (!f) return { before: {}, ok: false, error: 'target_not_found' };
    return { before: { question: f.question, answer: f.answer }, ok: true };
  }
  if (kind === 'edit_offering') {
    const o = facts.offerings.find((x) => x.id === targetId);
    if (!o) return { before: {}, ok: false, error: 'target_not_found' };
    return { before: { name: o.name, description: o.description || '(no description yet)' }, ok: true };
  }
  if (kind === 'edit_post') {
    const p = facts.posts_full.find((x) => x.id === targetId);
    if (!p) return { before: {}, ok: false, error: 'target_not_found' };
    return { before: { title: p.title, body_md: p.body_md, excerpt: p.excerpt }, ok: true };
  }
  if (kind === 'edit_document') {
    const t = (text || '').trim().slice(0, 8000);
    if (t.length < 20) return { before: {}, ok: false, error: 'text_too_short' };
    return { before: { document: t }, ok: true };
  }
  return { before: {}, ok: false, error: 'unknown_kind' };
}

/* ── the deterministic change summary — customers see what actually moved ── */
const words = (s: string) => (s || '').split(/\s+/).filter(Boolean).length;
export function changeSummary(before: Record<string, string>, payload: WriterPayload): string {
  const parts: string[] = [];
  const cmp = (label: string, was: string | undefined, now: string | undefined) => {
    if (!now) return;
    if (!was) { parts.push(`${label}: written (${words(now)} words)`); return; }
    if (was.trim() === now.trim()) { parts.push(`${label}: unchanged`); return; }
    const dw = words(now) - words(was);
    parts.push(`${label}: revised (${words(was)}→${words(now)} words${dw === 0 ? ', same length' : ''})`);
  };
  if (payload.identity) for (const [k, v] of Object.entries(payload.identity)) cmp(k.replace(/_/g, ' '), before[k], v);
  for (const f of payload.faqs_edit || []) { cmp('question', before.question, f.question); cmp('answer', before.answer, f.answer); }
  for (const p of payload.posts_edit || []) { cmp('title', before.title, p.title); cmp('update body', before.body_md, p.body_md); }
  for (const o of payload.offering_descriptions || []) cmp('item description', before[`offering:${o.id}`] ?? before.description, o.description);
  if (payload.document) cmp('the text', before.document, payload.document.body);
  return parts.length ? parts.join('; ') : 'no measurable change';
}

/* ── prompt fields per kind ── */
const EDIT_FIELDS: Record<EditorKind, string> = {
  edit_identity: 'payload.identity — ONLY the fields present in CURRENT, improved in place',
  edit_faq: 'payload.faqs_edit: [{id (the exact id from CURRENT), question, answer}] — the same faq, improved',
  edit_offering: 'payload.offering_descriptions: [{id (exact), description}] — the same item, better described',
  edit_post: 'payload.posts_edit: [{id (exact), title, body_md, excerpt?}] — the same update, improved',
  edit_document: 'payload.document: {title, body} — the provided text, improved',
  site_polish: 'payload.identity (fields present in CURRENT) + payload.faqs_edit (ids from CURRENT) + payload.offering_descriptions (ids from CURRENT) — improve what exists; add nothing new',
};

const EDITOR_ADDENDUM = `
YOU ARE EDITING, NOT WRITING FRESH:
- CURRENT holds the text as it exists. Improve it per the action; keep its meaning and every fact it states.
- Never remove a fact. Never add a fact that is not in CURRENT or the fact sheet.
- Use the exact entity ids given in CURRENT.
- If CURRENT already does the action well, small honest touches are better than change for its own sake.`;

export interface EditGenerateResult {
  ok: boolean;
  system?: string;
  user?: string;
  before?: Record<string, string>;
  why?: string;
  benefit?: string;
  evidence_used?: string[];
  error?: string;
}

/** Assemble everything the model call needs — pure except the recommendation lookup. */
export async function buildEditTask(site: SiteRow, req: EditRequest, facts: FactSheet): Promise<EditGenerateResult> {
  const action = EDIT_ACTIONS[req.action];
  if (!action) return { ok: false, error: 'unknown_action' };
  const b = buildBefore(req.kind, facts, req.target_id, req.text);
  if (!b.ok) return { ok: false, error: b.error };

  // recommendation awareness: an existing, active recommendation may inform the edit
  let recReason = '';
  const evidence_used: string[] = [];
  if (req.recommendation_hash && /^r_[0-9a-f]{16}$/.test(req.recommendation_hash)) {
    const rQ = await svc(`presence_recommendations?site_id=eq.${site.id}&recommendation_hash=eq.${req.recommendation_hash}&status=eq.active&select=reason,expected_benefit&order=created_at.desc&limit=1`);
    if (rQ.json?.[0]) { recReason = String(rQ.json[0].reason || '').slice(0, 300); evidence_used.push(req.recommendation_hash); }
  }

  const pack = packFor(site.template_slug);
  const tones = (req.tones && req.tones.length ? req.tones : ['faithful']).slice(0, 3);
  const system = WRITER_SYSTEM_BASE + EDITOR_ADDENDUM +
    `\n\nVERTICAL GUARDRAILS (${pack.slug}): ${pack.voiceGuardrails}\nVOCABULARY: ${pack.vocabularyHints}`;
  const user =
    `<<<FACTS\n${JSON.stringify(facts)}\nFACTS>>>\n` +
    `<<<TASK\nEDIT ACTION: ${req.action} — ${action.instruction}\n` +
    `CURRENT (improve this, in place): ${JSON.stringify(b.before)}\n` +
    `Fill: ${EDIT_FIELDS[req.kind]}\n` +
    `Directions to offer (${Math.min(tones.length, req.kind === 'site_polish' ? 1 : 3)}): ${tones.join(', ')}\n` +
    (recReason ? `CONTEXT (an accepted concern this edit supports — do not invent others): ${recReason}\n` : '') +
    `Owner's instructions: ${String(req.instructions || '').slice(0, 400) || '(none)'}\nTASK>>>`;

  return {
    ok: true, system, user, before: b.before,
    why: action.why + (recReason ? ' — and it supports a concern the room already raised' : ''),
    benefit: action.benefit, evidence_used,
  };
}

/** Attach the compare pack to a guarded option (pure). */
export function comparePack(before: Record<string, string>, payload: WriterPayload, why: string, benefit: string): ComparePack {
  return { before, change_summary: changeSummary(before, payload), why, expected_benefit: benefit };
}

/** Guard helper: the existing text is allowed truth for edits. */
export function editGuard(payload: WriterPayload, facts: FactSheet, before: Record<string, string>) {
  return factGuard(payload, facts, JSON.stringify(before));
}
export { selfCheck };

/** Closed-shape sanitizer for edit payloads: only known fields, only real ids. */
export function sanitizeEditPayload(raw: WriterPayload | undefined, kind: EditorKind, facts: FactSheet): WriterPayload {
  const p: WriterPayload = {};
  if (!raw || typeof raw !== 'object') return p;
  const s = (v: unknown, cap: number) => typeof v === 'string' ? v.trim().slice(0, cap) : '';
  if (raw.identity && (kind === 'edit_identity' || kind === 'site_polish')) {
    p.identity = {};
    for (const [k, cap] of [['tagline', 140], ['description', 1000], ['story', 4000], ['service_area', 300], ['seo_title', 70], ['seo_description', 170]] as const) {
      const v = s((raw.identity as Record<string, unknown>)[k], cap);
      if (v) (p.identity as Record<string, string>)[k] = v;
    }
    if (!Object.keys(p.identity).length) delete p.identity;
  }
  if (Array.isArray(raw.faqs_edit) && (kind === 'edit_faq' || kind === 'site_polish')) {
    const ids = new Set(facts.faqs_full.map((f) => f.id));
    p.faqs_edit = raw.faqs_edit.slice(0, 15)
      .map((f) => ({ id: String(f?.id || ''), question: s(f?.question, 200), answer: s(f?.answer, 2000) }))
      .filter((f) => ids.has(f.id) && f.question && f.answer);
    if (!p.faqs_edit.length) delete p.faqs_edit;
  }
  if (Array.isArray(raw.offering_descriptions) && (kind === 'edit_offering' || kind === 'site_polish')) {
    const ids = new Set(facts.offerings.map((o) => o.id));
    p.offering_descriptions = raw.offering_descriptions.slice(0, 25)
      .map((o) => ({ id: String(o?.id || ''), description: s(o?.description, 500) }))
      .filter((o) => ids.has(o.id) && o.description);
    if (!p.offering_descriptions.length) delete p.offering_descriptions;
  }
  if (Array.isArray(raw.posts_edit) && kind === 'edit_post') {
    const ids = new Set(facts.posts_full.map((x) => x.id));
    p.posts_edit = raw.posts_edit.slice(0, 3)
      .map((x) => ({ id: String(x?.id || ''), title: s(x?.title, 160), body_md: s(x?.body_md, 20000), excerpt: s(x?.excerpt, 300) || undefined }))
      .filter((x) => ids.has(x.id) && x.title && x.body_md);
    if (!p.posts_edit.length) delete p.posts_edit;
  }
  if (raw.document && kind === 'edit_document') {
    const doc = { title: s(raw.document.title, 160) || 'Improved text', body: s(raw.document.body, 12000) };
    if (doc.body) p.document = doc;
  }
  return p;
}

export interface EditSummary {
  ok: boolean; draft_id: string | null; kind: EditorKind; options: number;
  dropped_options: number; missing_facts: string[]; error?: string; model: string; ms: number;
}

/** The Editor's orchestration: task → model → sanitize → guard(+before) →
 *  self-check → compare pack → store as a proposal on the Writer's table. */
export async function generateEdit(site: SiteRow, req: EditRequest, model: ModelFn): Promise<EditSummary> {
  const t0 = Date.now();
  const facts = await buildFactSheet(site);
  const task = await buildEditTask(site, req, facts);
  if (!task.ok) return { ok: false, draft_id: null, kind: req.kind, options: 0, dropped_options: 0, missing_facts: [], error: task.error, model: '', ms: Date.now() - t0 };

  const res = await model(task.system!, task.user!);
  if (!res.ok) return { ok: false, draft_id: null, kind: req.kind, options: 0, dropped_options: 0, missing_facts: [], error: res.error || 'model_failed', model: res.model, ms: Date.now() - t0 };

  let parsed: { options?: Array<{ label?: string; tone?: string; payload?: WriterPayload }>; missing_facts?: string[]; assumptions?: string[] } | null = null;
  const cleaned = res.text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  try { parsed = JSON.parse(cleaned); } catch { const m = cleaned.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { /* no */ } } }
  if (!parsed || !Array.isArray(parsed.options)) return { ok: false, draft_id: null, kind: req.kind, options: 0, dropped_options: 0, missing_facts: [], error: 'unparseable_output', model: res.model, ms: Date.now() - t0 };

  const options: Array<WriterOption & { compare: ComparePack }> = [];
  let dropped = 0;
  for (const [i, o] of parsed.options.slice(0, 3).entries()) {
    const payload = sanitizeEditPayload(o?.payload, req.kind, facts);
    if (!Object.keys(payload).length) { dropped++; continue; }
    const guard = editGuard(payload, facts, task.before!);
    const check = selfCheck(payload, facts);
    if (!guard.ok || !check.field_limits_ok) { dropped++; continue; }
    options.push({
      label: String(o?.label || `Direction ${i + 1}`).slice(0, 60),
      tone: String(o?.tone || 'faithful').slice(0, 30),
      payload, self_check: check, fact_guard: guard,
      compare: comparePack(task.before!, payload, task.why!, task.benefit!),
    });
  }
  const missing = Array.isArray(parsed.missing_facts) ? parsed.missing_facts.slice(0, 8).map((m) => String(m).slice(0, 200)) : [];
  if (!options.length) return { ok: false, draft_id: null, kind: req.kind, options: 0, dropped_options: dropped, missing_facts: missing, error: 'all_options_failed_fact_guard', model: res.model, ms: Date.now() - t0 };

  const conf = Math.max(0.5, 0.95 - 0.15 * missing.length);
  const ins = await svc('presence_ai_drafts?select=id', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: site.id, kind: req.kind,
      origin: task.evidence_used!.length ? 'recommendation' : 'customer_request',
      prompt_summary: `improve — ${req.action}${req.instructions ? ` — “${String(req.instructions).slice(0, 60)}”` : ''}`,
      instructions: String(req.instructions || '').slice(0, 600),
      options, confidence: Math.round(conf * 100) / 100,
      missing_facts: missing, assumptions: [],
      evidence_used: task.evidence_used, model: res.model,
    }),
  });
  const id = ins.json?.[0]?.id ?? null;
  if (!id) return { ok: false, draft_id: null, kind: req.kind, options: options.length, dropped_options: dropped, missing_facts: missing, error: 'store_failed', model: res.model, ms: Date.now() - t0 };
  return { ok: true, draft_id: id, kind: req.kind, options: options.length, dropped_options: dropped, missing_facts: missing, model: res.model, ms: Date.now() - t0 };
}
