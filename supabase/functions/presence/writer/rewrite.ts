// ── The Writer's snippet rewriter (M9.5H) — one small piece of text, in and out ─
// The website builder needs an AI helper on EVERY text-bearing block. Those
// blocks live in settings.blocks (not the identity/faq/offering/post entities),
// so the proposal-based Writer/Editor can't touch them. This is the missing
// rung: transform ONE arbitrary snippet and hand the text straight back.
//
// It rides the same rails as the Writer — the fact sheet's voice, the vertical
// pack, the Fact Law, injection-hardening (via the shared model caller) — but it
// stores NOTHING and publishes NOTHING. It returns text only. The owner sees a
// draft, chooses "Use it", edits freely, and publishes by hand. The ritual
// still stands between the model and the world.
import { buildFactSheet } from './facts.ts';
import { packFor } from './pack.ts';
import type { IndustryPack } from './pack.ts';
import type { ModelFn } from './model.ts';
import type { FactSheet } from './facts.ts';
import type { SiteRow } from '../lib/site.ts';

export type RewriteAction = 'improve' | 'shorten' | 'lengthen' | 'tone' | 'write';

/** The verbs the builder's "Write with AI" offers — each one a plain instruction. */
export const REWRITE_ACTIONS: Record<RewriteAction, string> = {
  improve: 'Rewrite it clearer and tighter, keeping every fact and the same core message.',
  shorten: 'Make it shorter — keep every fact, cut every spare word.',
  lengthen: 'Expand it with a little more helpful detail, drawn ONLY from facts on the sheet or already in the text.',
  tone: 'Rewrite it in the requested tone, keeping every fact and the same core message.',
  write: 'Write the text the owner asked for, using ONLY facts on the sheet. Leave a [bracketed placeholder] for anything not on the sheet — never invent one.',
};

export interface RewriteRequest {
  action: RewriteAction;
  text?: string;        // the block's current text — required for every action except 'write'
  tone?: string;        // for action:'tone', e.g. "friendlier", "more professional"
  prompt?: string;      // for action:'write' — the owner's "what should this say?"
  field?: string;       // a plain field label, e.g. "heading", "button label" — bounds the length
}

export interface RewriteResult { ok: boolean; text: string; model: string; error?: string; ms: number }

// A self-contained system prompt: the Fact Law and the voice rules, but a
// single-object output (the shared WRITER_SYSTEM_BASE mandates an options array,
// which is the wrong shape for a one-snippet rewrite).
export const REWRITE_SYSTEM = `You are the studio's writer, improving one small piece of text for a small business's website.

THE FACT LAW (absolute):
- You may state ONLY facts present in the fact sheet or already in the text you are given.
- NEVER invent: hours, phone numbers, addresses, prices, staff names, awards, licenses, certifications, guarantees, reviews, testimonials, customer quotes, ratings, or business history (like founding years).
- If a needed fact is unknown, leave it as a [bracketed placeholder]; never make one up.
- Respect the never_claim list absolutely.

VOICE: follow the voice profile and the vertical guardrails. Plain, warm, concrete merchant language. No marketing jargon, no exclamation marks, no clichés.

OUTPUT: respond with ONLY a JSON object of the shape {"text": string}. No prose, no options, no other keys. "text" is the finished words, ready to drop straight onto the page — no labels, no quotation marks around the whole thing, no markdown fences.`;

// Field-shape hints keep a heading from coming back as a paragraph, etc.
const FIELD_HINTS: Record<string, string> = {
  heading: 'This is a short section heading — a few words, title-style, no trailing period.',
  title: 'This is a short section heading — a few words, title-style, no trailing period.',
  'button label': 'This is a button label — 1 to 4 words naming the action (e.g. "Book a table").',
  button: 'This is a button label — 1 to 4 words naming the action.',
  tagline: 'This is a tagline — one short line, no period needed.',
  'banner text': 'This is a short banner line — one sentence at most.',
  caption: 'This is an image caption — one short line.',
  question: 'This is a question a customer would ask — phrase it as a question.',
  answer: 'This is the answer to a customer question — direct first, then any detail.',
};

/** Pure prompt builder — no I/O. Returns the model messages, or an error reason. */
export function buildRewritePrompt(
  facts: FactSheet,
  pack: IndustryPack,
  req: RewriteRequest,
): { ok: true; system: string; user: string } | { ok: false; error: string } {
  const instruction = REWRITE_ACTIONS[req.action];
  if (!instruction) return { ok: false, error: 'bad_action' };
  const text = String(req.text || '').trim().slice(0, 8000);
  const prompt = String(req.prompt || '').trim().slice(0, 400);
  if (req.action === 'write') {
    if (!prompt) return { ok: false, error: 'no_prompt' };
  } else if (!text) {
    return { ok: false, error: 'nothing_to_rewrite' };
  }

  const fieldKey = String(req.field || '').trim().toLowerCase();
  const fieldHint = FIELD_HINTS[fieldKey] || '';
  const toneLine = req.action === 'tone' && req.tone ? `TONE TO USE: ${String(req.tone).trim().slice(0, 40)}\n` : '';

  const system = REWRITE_SYSTEM +
    `\n\nVERTICAL GUARDRAILS (${pack.slug}): ${pack.voiceGuardrails}\nVOCABULARY: ${pack.vocabularyHints}`;
  const user =
    `<<<FACTS\n${JSON.stringify(facts)}\nFACTS>>>\n` +
    `<<<TASK\nACTION: ${req.action} — ${instruction}\n` +
    toneLine +
    (fieldHint ? `FIELD: ${fieldHint}\n` : '') +
    (req.action === 'write'
      ? `WHAT IT SHOULD SAY: ${prompt}\n`
      : `CURRENT TEXT (rewrite this, in place):\n${text}\n`) +
    `TASK>>>`;
  return { ok: true, system, user };
}

/** Pull the single string out of the model's JSON, tolerant of fences/stray prose. */
export function parseRewriteText(raw: string): string {
  const cleaned = String(raw || '').replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  let obj: { text?: unknown } | null = null;
  try { obj = JSON.parse(cleaned); } catch { /* try embedded */ }
  if (!obj) { const m = cleaned.match(/\{[\s\S]*\}/); if (m) { try { obj = JSON.parse(m[0]); } catch { /* no */ } } }
  const t = obj && typeof obj.text === 'string' ? obj.text.trim() : '';
  return t.slice(0, 8000);
}

/** Orchestration: fact sheet (voice grounding) → pure prompt → model → text. */
export async function rewriteSnippet(site: SiteRow, req: RewriteRequest, model: ModelFn): Promise<RewriteResult> {
  const t0 = Date.now();
  const facts = await buildFactSheet(site);
  const pack = packFor(site.template_slug);
  const built = buildRewritePrompt(facts, pack, req);
  if (!built.ok) return { ok: false, text: '', model: '', error: built.error, ms: Date.now() - t0 };

  const res = await model(built.system, built.user);
  if (!res.ok) return { ok: false, text: '', model: res.model, error: res.error || 'model_failed', ms: Date.now() - t0 };
  const text = parseRewriteText(res.text);
  if (!text) return { ok: false, text: '', model: res.model, error: 'unparseable_output', ms: Date.now() - t0 };
  return { ok: true, text, model: res.model, ms: Date.now() - t0 };
}
