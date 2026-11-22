// ── The one small model the product's own AI runs on (builder item 409) ───────
// Nov 22 review, file 14, finding 11: the app's own AI (the Writer, the help box, the
// concierge's polish, photo descriptions) ran on claude-haiku-4-5-20251001 at $1 in and
// $5 out per million tokens, while the free tools already ran on claude-haiku-5-5 at
// $0.10 and $0.50 (Anthropic's price list, Nov 3 2026): about ten times dearer for the
// same class of work. Every in-app caller names SMALL_MODEL now, and the free tools'
// own names (NARRATIVE_MODEL, EXTRACT_MODEL) read it too, so a model change is one line.
//
// The newer model thinks before it answers, by default at a medium effort that is billed
// as output; these are short jobs (reword a note, describe a photo, draft a section), so
// every call sends SMALL_EFFORT, as the free tools do. Prompts are unchanged.
export const SMALL_MODEL = 'claude-haiku-5-5';
export const SMALL_EFFORT = 'low';
/** The request fields every small-model call sends, beyond its own prompt. */
export const SMALL_OUTPUT_CONFIG = { effort: SMALL_EFFORT } as const;
/** USD per million tokens, from Anthropic's price list (read Nov 3 and Nov 22 2026). */
export const SMALL_MODEL_PRICE = { inputPerM: 0.10, outputPerM: 0.50 } as const;
