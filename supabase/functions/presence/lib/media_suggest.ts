// ── AI-proposed alt text + tags + caption for a photograph (propose-then-approve)
// The chore we make owners do by hand — writing alt text — becomes ONE TAP: the
// vision model PROPOSES alt + a few tags + a caption from the image; the owner
// accepts or edits before anything is saved. Nothing here writes to the media
// row; the proposal is returned to the UI and applied only on the owner's word.
//
// This file is the PURE, deterministic core: the tight prompt, and the parsing /
// sanitizing / clamping / junk-rejection of the model's reply. It never fabricates
// a suggestion and never trusts the model's output — every field is bounded and
// scrubbed before it can reach a field the owner sees. The model call is injected
// (VisionFn) so the whole flow is testable with no network.
import type { VisionFn } from '../writer/vision.ts';

export const SUGGEST_MAX_ALT = 120;      // alt text is short by law of good a11y
export const SUGGEST_MAX_CAPTION = 160;  // one calm line
export const SUGGEST_MAX_TAGS = 6;       // a few, not a pile
export const SUGGEST_MIN_ALT = 3;        // below this it isn't a description

export interface Suggestion { alt: string; tags: string[]; caption: string; }

// The tight, injection-hardened task the model answers. Kept deterministic so the
// prompt is part of the frozen, testable surface.
export const SUGGEST_SYSTEM = `You describe ONE business photograph for a website's media library.
Respond with ONLY a JSON object, nothing else:
{ "alt": string, "tags": string[], "caption": string }
Rules:
- "alt": factual alt text for what is literally visible, at most ${SUGGEST_MAX_ALT} characters. No "image of"/"photo of" prefix, no marketing, no emojis.
- "tags": 3 to ${SUGGEST_MAX_TAGS} short lowercase keyword tags (one or two words each) from what's visible.
- "caption": one short human caption, at most ${SUGGEST_MAX_CAPTION} characters.
- Describe only what you can see. Never invent names, prices, or claims. If unclear, describe it generally.`;

export const SUGGEST_USER = 'Describe this photograph as JSON with alt, tags, and caption. Only what is visible.';

// Control characters to strip from any model-supplied line (C0 range + DEL).
const CONTROL = /[\x00-\x1f\x7f]+/g;

// ── sanitizers ────────────────────────────────────────────────────────────────
/** One display line: strip HTML-ish, control chars, collapse whitespace, clamp. */
function cleanLine(v: unknown, max: number): string {
  let s = String(v ?? '');
  s = s.replace(/<[^>]*>/g, ' ');    // no markup ever
  s = s.replace(CONTROL, ' ');       // no control chars
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max).trim();
  return s;
}

/** Alt text: cleaned, plus drop the "photo/image/picture of" preamble models love. */
function cleanAlt(v: unknown): string {
  let s = cleanLine(v, SUGGEST_MAX_ALT + 24); // clean first, clamp after preamble strip
  s = s.replace(/^\s*(an?\s+)?(image|photo(?:graph)?|picture|screenshot)\s+(of|showing|depicting)\s+/i, '');
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (s.length) s = s[0].toUpperCase() + s.slice(1);
  if (s.length > SUGGEST_MAX_ALT) s = s.slice(0, SUGGEST_MAX_ALT).trim();
  return s;
}

/** Tags: lowercase, keep letters/digits/space/hyphen, dedupe, cap the count. */
function cleanTags(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : (typeof v === 'string' ? String(v).split(/[,;]/) : []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    let tag = String(t ?? '').toLowerCase();
    tag = tag.replace(/<[^>]*>/g, ' ').replace(/[^a-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim();
    tag = tag.replace(/^-+|-+$/g, '').slice(0, 30).trim();
    if (tag.length < 2 || seen.has(tag)) continue;
    seen.add(tag); out.push(tag);
    if (out.length >= SUGGEST_MAX_TAGS) break;
  }
  return out;
}

/** Turn a raw parsed object into a clean, bounded Suggestion — or null if junk. */
export function sanitizeSuggestion(raw: unknown): Suggestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const alt = cleanAlt(r.alt);
  if (alt.length < SUGGEST_MIN_ALT) return null;   // no usable description → not a suggestion
  const tags = cleanTags(r.tags);
  let caption = cleanLine(r.caption, SUGGEST_MAX_CAPTION);
  // Don't echo the alt verbatim as the caption — that's noise, not a caption.
  if (caption && caption.toLowerCase() === alt.toLowerCase()) caption = '';
  return { alt, tags, caption };
}

/** Extract the JSON object from a model reply (may be fenced or wrapped in prose). */
export function parseSuggestion(modelText: string): Suggestion | null {
  const text = String(modelText ?? '');
  // Prefer a fenced block, else the first {...} span.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try { obj = JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
  return sanitizeSuggestion(obj);
}

/** Encode raw image bytes to base64 for the vision API (chunked; large-safe). */
export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export interface SuggestResult {
  ok: boolean;
  suggestion?: Suggestion;
  error?: string;
  usage?: { model: string | null; input_tokens?: number; output_tokens?: number };
}

/** Orchestrate one suggestion: send the image to the injected model, then parse
 *  + sanitize the reply into a bounded proposal. Never throws; a failure is a
 *  plain result. The model is injected, so this is fully testable with no network. */
export async function suggestFromImage(vision: VisionFn, imageBytes: Uint8Array, mime: string): Promise<SuggestResult> {
  if (!imageBytes || imageBytes.length === 0) return { ok: false, error: 'no_image' };
  const r = await vision({ b64: bytesToB64(imageBytes), mime }, SUGGEST_SYSTEM, SUGGEST_USER);
  if (!r.ok) return { ok: false, error: r.error || 'model_error' };
  const suggestion = parseSuggestion(r.text);
  if (!suggestion) return { ok: false, error: 'unparseable', usage: { model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens } };
  return { ok: true, suggestion, usage: { model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens } };
}
