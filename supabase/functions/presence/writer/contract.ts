// ── The AI Writer contract (M9.5A — constitution 05 §7, verb: Draft) ────────
// The Writer produces PROPOSALS of structured content — never HTML, never
// renderer output, never live changes. Every proposal is reviewable, fully
// editable, optional, and reversible; acceptance flows through the unmodified
// Draft Writer; the publish ritual still stands between everything and the
// world. The Fact Law is enforced by a deterministic guard, not by trust.

/** What each kind is, and where its content can legally live. */
export type WriterKind =
  | 'identity_copy'            // tagline/description/story/service_area/seo — the homepage & about voice
  | 'faqs'                     // new answered questions
  | 'offering_descriptions'    // descriptions for EXISTING offerings (never invents items or prices)
  | 'post'                     // updates: news, seasonal, holiday, promotion, event
  | 'testimonial_request'      // a note the OWNER can send a customer — never a testimonial itself
  | 'policy_doc'               // template-assisted privacy/terms — DOCUMENT ONLY (contract has no policy pages)
  | 'social_post'              // GBP/Facebook/Instagram/LinkedIn — DOCUMENT ONLY until destinations (M10)
  | 'email_doc'                // announcement/newsletter draft — DOCUMENT ONLY
  | 'page_copy'                // landing/service/team-page copy — DOCUMENT ONLY until contract pages (Class C)
  | 'starter_site';            // whole-website structured draft from customer-provided facts

/** Kinds whose acceptance composes into the site draft via the Draft Writer. */
export const CONTRACT_KINDS: WriterKind[] = ['identity_copy', 'faqs', 'offering_descriptions', 'post', 'starter_site'];
/** Kinds kept as reviewable documents — they can't publish anywhere yet, and say so. */
export const DOCUMENT_KINDS: WriterKind[] = ['testimonial_request', 'policy_doc', 'social_post', 'email_doc', 'page_copy'];

/** The structured payload a single option may carry. Closed shape — the model
 *  fills these fields and nothing else survives validation. */
export interface WriterPayload {
  identity?: {
    tagline?: string; description?: string; story?: string; service_area?: string;
    seo_title?: string; seo_description?: string;
  };
  faqs?: Array<{ question: string; answer: string }>;
  offering_descriptions?: Array<{ id: string; description: string }>;
  post?: { title: string; body_md: string; excerpt?: string };
  offerings_new?: Array<{ name: string; category: string; description?: string; price_text?: string }>; // starter_site only; names/prices from customer input
  document?: { title: string; body: string };  // document-only kinds
  // M9.5B editor fields — IN-PLACE improvements of existing entities (by id)
  faqs_edit?: Array<{ id: string; question: string; answer: string }>;
  posts_edit?: Array<{ id: string; title: string; body_md: string; excerpt?: string }>;
}

/** M9.5B editor kinds — improve existing content, never invent it. */
export type EditorKind = 'edit_identity' | 'edit_faq' | 'edit_offering' | 'edit_post' | 'edit_document' | 'site_polish';
export const EDITOR_CONTRACT_KINDS: EditorKind[] = ['edit_identity', 'edit_faq', 'edit_offering', 'edit_post', 'site_polish'];

/** The compare pack every editing option carries — customers learn from edits. */
export interface ComparePack {
  before: Record<string, string>;   // field → current text
  change_summary: string;           // deterministic: what changed, by field
  why: string;                      // from the action taxonomy (+ recommendation reason if aware)
  expected_benefit: string;         // from the action taxonomy
}

export interface WriterOption {
  label: string;                 // 'Warm & neighborly' — the direction, in customer words
  tone: string;                  // professional | friendly | luxury | playful | minimal | warm
  payload: WriterPayload;
  self_check: SelfCheck;
  fact_guard: { ok: boolean; violations: string[]; placeholders: string[] };
}

export interface SelfCheck {
  readability: number;           // Flesch score of the main prose
  reading_ok: boolean;
  seo: string[];                 // notes (length checks) — empty is clean
  weak_cta: boolean;
  duplicate_of_existing: boolean;
  plain_language_ok: boolean;
  field_limits_ok: boolean;
  grammar_notes: string[];
}

/** Field caps mirror the API's closed field rules — the Writer can never
 *  produce content the contract would reject. */
export const FIELD_CAPS: Record<string, number> = {
  tagline: 140, description: 1000, story: 4000, service_area: 300,
  seo_title: 70, seo_description: 170,
  question: 200, answer: 2000,
  offering_description: 500,
  post_title: 160, post_body: 20000, post_excerpt: 300,
  document_body: 12000,
};

/** The generation request (client-supplied, bounded). */
export interface WriterRequest {
  kind: WriterKind;
  instructions: string;                       // the customer's words
  tones?: string[];                           // requested directions (<=3)
  recommendation_hash?: string;               // when initiated from a recommendation
  starter?: {                                 // starter_site only — customer-provided FACTS
    services?: Array<{ name: string; category?: string; price_text?: string; description_hint?: string }>;
    goals?: string;
  };
}
