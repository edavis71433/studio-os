// ── The AI Writer engine (M9.5A) ─────────────────────────────────────────────
// generate: fact sheet → task prompt → model (injectable) → parse → per-option
//           Fact Guard + Self-Check → store a PROPOSAL. Nothing touches the
//           site draft. Options that violate the Fact Law are dropped; if all
//           violate, the proposal fails honestly.
// accept:   compose the chosen option into a merged snapshot (pure) and apply
//           it through the UNMODIFIED Draft Writer — safety snapshot,
//           provenance, hide-not-delete semantics all inherited. Document-only
//           kinds are simply marked accepted; they publish nowhere.
// Nothing here can publish. The ritual still stands between all of it and the world.
import { svc } from '../lib/db.ts';
import { serializeDraft } from '../lib/serializer.ts';
import { getTemplate } from '../lib/render.ts';
import { applySnapshotToDraft } from '../lib/draft_writer.ts';
import { buildFactSheet } from './facts.ts';
import { factGuard, selfCheck } from './guard.ts';
import { packFor } from './pack.ts';
import { WRITER_SYSTEM_BASE } from './model.ts';
import { CONTRACT_KINDS, DOCUMENT_KINDS } from './contract.ts';
import type { WriterRequest, WriterKind, WriterOption, WriterPayload } from './contract.ts';
import type { ModelFn } from './model.ts';
import type { FactSheet } from './facts.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import type { SnapshotContent } from '../lib/render_types.ts';

/* ── task prompts per kind (what fields the model may fill) ── */
const TASKS: Record<WriterKind, { summary: string; fields: string; optionCount: number }> = {
  identity_copy: { summary: 'business voice copy', optionCount: 3,
    fields: 'payload.identity with any of: tagline, description, story, service_area, seo_title, seo_description — only the ones the task asks for or that are empty on the fact sheet' },
  faqs: { summary: 'answered questions', optionCount: 2,
    fields: 'payload.faqs: 2-4 {question, answer} pairs customers actually ask this kind of business; answers only from facts on the sheet or placeholders' },
  offering_descriptions: { summary: 'menu item descriptions', optionCount: 2,
    fields: 'payload.offering_descriptions: {id, description} for items on the fact sheet that lack descriptions (use their exact ids); appetizing, concrete, no invented ingredients presented as facts' },
  post: { summary: 'an update', optionCount: 3,
    fields: 'payload.post: {title, body_md, excerpt?} — news/seasonal/holiday/promotion/event per the instructions; markdown allowed, no invented dates or offers' },
  testimonial_request: { summary: 'a note asking a customer for kind words', optionCount: 2,
    fields: 'payload.document: {title, body} — a short warm note the OWNER can send a happy customer asking for a testimonial. Never write the testimonial itself.' },
  policy_doc: { summary: 'a policy draft', optionCount: 1,
    fields: 'payload.document: {title, body} — a plain-language privacy or terms draft with [bracketed placeholders] wherever legal specifics are unknown; note that a professional should review it' },
  social_post: { summary: 'a social post', optionCount: 3,
    fields: 'payload.document: {title, body} — the post text for the named platform; hashtags sparing; facts only from the sheet' },
  email_doc: { summary: 'an email draft', optionCount: 2,
    fields: 'payload.document: {title, body} — subject line as title, body as the email; facts only from the sheet' },
  page_copy: { summary: 'page copy', optionCount: 2,
    fields: 'payload.document: {title, body} — the requested page copy as a document (the site template does not have this page type yet)' },
  starter_site: { summary: 'a starter website draft', optionCount: 1,
    fields: 'payload.identity (tagline, description, story, seo_title, seo_description), payload.faqs (3), payload.post (one welcome update), and payload.offerings_new built ONLY from the services provided in the task (their names/prices verbatim; you may write descriptions)' },
};

export interface GenerateSummary {
  ok: boolean; draft_id: string | null; kind: WriterKind; options: number;
  dropped_options: number; missing_facts: string[]; error?: string; model: string; ms: number;
}

function parseModelJson(text: string): { options?: Array<{ label?: string; tone?: string; payload?: WriterPayload }>; missing_facts?: string[]; assumptions?: string[] } | null {
  const cleaned = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { /* try embedded */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* no */ } }
  return null;
}

/** Closed-shape sanitizer: only known payload fields survive, as strings. */
function sanitizePayload(raw: WriterPayload | undefined, kind: WriterKind, facts: FactSheet): WriterPayload {
  const p: WriterPayload = {};
  if (!raw || typeof raw !== 'object') return p;
  const s = (v: unknown, cap: number) => typeof v === 'string' ? v.trim().slice(0, cap) : '';
  if (raw.identity && (kind === 'identity_copy' || kind === 'starter_site')) {
    p.identity = {};
    for (const [k, cap] of [['tagline', 140], ['description', 1000], ['story', 4000], ['service_area', 300], ['seo_title', 70], ['seo_description', 170]] as const) {
      const v = s((raw.identity as Record<string, unknown>)[k], cap);
      if (v) (p.identity as Record<string, string>)[k] = v;
    }
  }
  if (Array.isArray(raw.faqs) && (kind === 'faqs' || kind === 'starter_site')) {
    p.faqs = raw.faqs.slice(0, 5).map((f) => ({ question: s(f?.question, 200), answer: s(f?.answer, 2000) })).filter((f) => f.question && f.answer);
  }
  if (Array.isArray(raw.offering_descriptions) && kind === 'offering_descriptions') {
    const ids = new Set(facts.offerings.map((o) => o.id));
    p.offering_descriptions = raw.offering_descriptions.slice(0, 20)
      .map((o) => ({ id: String(o?.id || ''), description: s(o?.description, 500) }))
      .filter((o) => ids.has(o.id) && o.description);   // only EXISTING offerings — never invents items
  }
  if (raw.post && (kind === 'post' || kind === 'starter_site')) {
    const post = { title: s(raw.post.title, 160), body_md: s(raw.post.body_md, 20000), excerpt: s(raw.post.excerpt, 300) || undefined };
    if (post.title && post.body_md) p.post = post;
  }
  if (Array.isArray(raw.offerings_new) && kind === 'starter_site') {
    p.offerings_new = raw.offerings_new.slice(0, 30).map((o) => ({
      name: s(o?.name, 120), category: s(o?.category, 60) || 'Menu',
      description: s(o?.description, 500) || undefined, price_text: s(o?.price_text, 40) || undefined,
    })).filter((o) => o.name);
  }
  if (raw.document && DOCUMENT_KINDS.includes(kind)) {
    const doc = { title: s(raw.document.title, 160), body: s(raw.document.body, 12000) };
    if (doc.title && doc.body) p.document = doc;
  }
  return p;
}

export async function generateDraft(site: SiteRow, req: WriterRequest, model: ModelFn): Promise<GenerateSummary> {
  const t0 = Date.now();
  const task = TASKS[req.kind];
  if (!task) return { ok: false, draft_id: null, kind: req.kind, options: 0, dropped_options: 0, missing_facts: [], error: 'unknown_kind', model: '', ms: 0 };

  const facts = await buildFactSheet(site);
  const pack = packFor(site.template_slug);
  const tones = (req.tones && req.tones.length ? req.tones : pack.toneDefaults).slice(0, 3);
  const optionCount = Math.min(task.optionCount, tones.length) || task.optionCount;

  // starter facts provided by the CUSTOMER are facts too
  const starterFacts = req.kind === 'starter_site' && req.starter
    ? `\nCUSTOMER-PROVIDED SERVICES (verbatim facts): ${JSON.stringify(req.starter.services || [])}\nGOALS: ${String(req.starter.goals || '').slice(0, 300)}`
    : '';

  const system = WRITER_SYSTEM_BASE +
    `\n\nVERTICAL GUARDRAILS (${pack.slug}): ${pack.voiceGuardrails}\nVOCABULARY: ${pack.vocabularyHints}`;
  const user =
    `<<<FACTS\n${JSON.stringify(facts)}${starterFacts}\nFACTS>>>\n` +
    `<<<TASK\nWrite ${task.summary}. Fill: ${task.fields}\n` +
    `Directions to offer (${optionCount}): ${tones.slice(0, optionCount).join(', ')}\n` +
    `Owner's instructions: ${String(req.instructions || '').slice(0, 600) || '(none)'}\nTASK>>>`;

  const res = await model(system, user);
  if (!res.ok) return { ok: false, draft_id: null, kind: req.kind, options: 0, dropped_options: 0, missing_facts: [], error: res.error || 'model_failed', model: res.model, ms: Date.now() - t0 };

  const parsed = parseModelJson(res.text);
  if (!parsed || !Array.isArray(parsed.options)) return { ok: false, draft_id: null, kind: req.kind, options: 0, dropped_options: 0, missing_facts: [], error: 'unparseable_output', model: res.model, ms: Date.now() - t0 };

  // sanitize → guard → self-check, per option; violating options are dropped
  const starterAllowed = req.kind === 'starter_site' ? JSON.stringify(req.starter || {}) : '';
  const options: WriterOption[] = [];
  let dropped = 0;
  for (const [i, o] of parsed.options.slice(0, 3).entries()) {
    const payload = sanitizePayload(o?.payload, req.kind, facts);
    if (!Object.keys(payload).length) { dropped++; continue; }
    const guard = factGuard(payload, facts, starterAllowed);
    const check = selfCheck(payload, facts);
    if (!guard.ok || !check.field_limits_ok) { dropped++; continue; }
    options.push({
      label: String(o?.label || `Direction ${i + 1}`).slice(0, 60),
      tone: String(o?.tone || tones[i] || 'warm').slice(0, 30),
      payload, self_check: check, fact_guard: guard,
    });
  }
  const missing = Array.isArray(parsed.missing_facts) ? parsed.missing_facts.slice(0, 8).map((m) => String(m).slice(0, 200)) : [];
  const assumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions.slice(0, 8).map((m) => String(m).slice(0, 200)) : [];

  if (!options.length) {
    return { ok: false, draft_id: null, kind: req.kind, options: 0, dropped_options: dropped, missing_facts: missing, error: 'all_options_failed_fact_guard', model: res.model, ms: Date.now() - t0 };
  }

  const conf = Math.max(0.5, 0.95 - 0.15 * missing.length - 0.1 * assumptions.length);
  const ins = await svc('presence_ai_drafts?select=id', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: site.id, kind: req.kind,
      origin: req.recommendation_hash ? 'recommendation' : 'customer_request',
      prompt_summary: `${task.summary}${req.instructions ? ` — “${String(req.instructions).slice(0, 80)}”` : ''}`,
      instructions: String(req.instructions || '').slice(0, 600),
      options, confidence: Math.round(conf * 100) / 100,
      missing_facts: missing, assumptions,
      evidence_used: req.recommendation_hash ? [req.recommendation_hash] : [],
      model: res.model,
    }),
  });
  const id = ins.json?.[0]?.id ?? null;
  if (!id) return { ok: false, draft_id: null, kind: req.kind, options: options.length, dropped_options: dropped, missing_facts: missing, error: 'store_failed', model: res.model, ms: Date.now() - t0 };
  return { ok: true, draft_id: id, kind: req.kind, options: options.length, dropped_options: dropped, missing_facts: missing, model: res.model, ms: Date.now() - t0 };
}

/* ── acceptance: compose (pure) + the unmodified Draft Writer ── */
export function composeMerged(current: SnapshotContent, payload: WriterPayload, edits: WriterPayload | null): SnapshotContent {
  const p = edits && Object.keys(edits).length ? edits : payload;  // the customer's edits win entirely
  const merged: SnapshotContent = structuredClone(current);
  if (p.identity) merged.identity = { ...merged.identity, ...p.identity };
  if (p.faqs?.length) {
    merged.faqs = [...(merged.faqs || []), ...p.faqs.map((f, i) => ({
      id: crypto.randomUUID(), question: f.question, answer: f.answer,
      sort_order: (merged.faqs || []).length + i + 1,
    }))];
  }
  if (p.offering_descriptions?.length) {
    const byId = new Map(p.offering_descriptions.map((o) => [o.id, o.description]));
    merged.offerings = (merged.offerings || []).map((o) => byId.has(o.id) ? { ...o, description: byId.get(o.id)! } : o);
  }
  if (p.offerings_new?.length) {
    merged.offerings = [...(merged.offerings || []), ...p.offerings_new.map((o, i) => ({
      id: crypto.randomUUID(), name: o.name, category: o.category,
      description: o.description, price_text: o.price_text,
      sort_order: (merged.offerings || []).length + i + 1,
    }))];
  }
  if (p.post) {
    merged.posts = [...(merged.posts || []), {
      id: crypto.randomUUID(), title: p.post.title,
      slug: p.post.title.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'update',
      body_md: p.post.body_md, excerpt: p.post.excerpt, published_at: new Date().toISOString(),
    }];
  }
  // M9.5B — in-place edits: the same entities, improved (never appended)
  if (p.faqs_edit?.length) {
    const byId = new Map(p.faqs_edit.map((f) => [f.id, f]));
    merged.faqs = (merged.faqs || []).map((f) => byId.has(f.id) ? { ...f, question: byId.get(f.id)!.question, answer: byId.get(f.id)!.answer } : f);
  }
  if (p.posts_edit?.length) {
    const byId = new Map(p.posts_edit.map((x) => [x.id, x]));
    merged.posts = (merged.posts || []).map((x) => byId.has(x.id) ? { ...x, title: byId.get(x.id)!.title, body_md: byId.get(x.id)!.body_md, excerpt: byId.get(x.id)!.excerpt ?? x.excerpt } : x);
  }
  return merged;
}

export interface AcceptResult { ok: boolean; applied_summary: string; error?: string }

export async function acceptDraft(site: SiteRow, draftId: string, optionIndex: number, edits: WriterPayload | null, principal: Principal): Promise<AcceptResult> {
  const q = await svc(`presence_ai_drafts?id=eq.${draftId}&site_id=eq.${site.id}&status=eq.proposed&select=id,kind,options,prompt_summary&limit=1`);
  const row = q.json?.[0];
  if (!row) return { ok: false, applied_summary: '', error: 'not_found' };
  const opt = (row.options || [])[optionIndex];
  if (!opt) return { ok: false, applied_summary: '', error: 'bad_option' };

  const EDIT_CONTRACT = ['edit_identity', 'edit_faq', 'edit_offering', 'edit_post', 'site_polish'];
  let summary = '';
  if (CONTRACT_KINDS.includes(row.kind) || EDIT_CONTRACT.includes(row.kind)) {
    const t = getTemplate(site.template_slug, site.template_version);
    if (!t) return { ok: false, applied_summary: '', error: 'template_missing' };
    const { snapshot, mediaManifest } = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now: new Date().toISOString() });
    const merged = composeMerged(snapshot.content, opt.payload, edits);
    const parts: string[] = [];
    if (opt.payload.identity || edits?.identity) parts.push('business copy');
    const nFaq = (edits?.faqs || opt.payload.faqs || []).length; if (nFaq) parts.push(`${nFaq} answered question${nFaq > 1 ? 's' : ''}`);
    const nOff = (edits?.offering_descriptions || opt.payload.offering_descriptions || []).length; if (nOff) parts.push(`${nOff} item description${nOff > 1 ? 's' : ''}`);
    const nNew = (edits?.offerings_new || opt.payload.offerings_new || []).length; if (nNew) parts.push(`${nNew} menu item${nNew > 1 ? 's' : ''}`);
    if (edits?.post || opt.payload.post) parts.push('an update');
    const nFqE = (edits?.faqs_edit || opt.payload.faqs_edit || []).length; if (nFqE) parts.push(`${nFqE} improved answer${nFqE > 1 ? 's' : ''}`);
    const nPoE = (edits?.posts_edit || opt.payload.posts_edit || []).length; if (nPoE) parts.push(`${nPoE} improved update${nPoE > 1 ? 's' : ''}`);
    summary = `Accepted a drafted proposal: ${parts.join(', ') || row.prompt_summary}`;
    const applied = await applySnapshotToDraft(
      site,
      { content: merged, media_manifest: mediaManifest, content_contract_version: snapshot.content_contract_version, template_slug: site.template_slug, template_version: site.template_version },
      principal, summary,
    );
    if (!applied.ok) return { ok: false, applied_summary: '', error: applied.error || 'apply_failed' };
  } else {
    summary = `Kept as a document: ${row.prompt_summary}`;
  }

  await svc(`presence_ai_drafts?id=eq.${draftId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'accepted', chosen_option: optionIndex, applied_summary: summary, resolved_at: new Date().toISOString() }),
  });
  return { ok: true, applied_summary: summary };
}

export async function discardDraft(site: SiteRow, draftId: string): Promise<boolean> {
  const r = await svc(`presence_ai_drafts?id=eq.${draftId}&site_id=eq.${site.id}&status=eq.proposed`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'discarded', resolved_at: new Date().toISOString() }),
  });
  return r.ok && Array.isArray(r.json) && r.json.length > 0;
}
