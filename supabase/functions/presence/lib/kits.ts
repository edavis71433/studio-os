// ── Starter kits — pure core (Phase CP-1) ────────────────────────────────────
// The reuse engine for agencies & freelancers. Two laws shape everything here:
//   1. A kit carries STRUCTURE + HOUSE STYLE, never another business's facts —
//      no names/contact/story/social, no testimonials (never transplant another
//      business's reviews), no posts, no media, no verification tokens.
//   2. Applying a kit is FILL-ONLY-EMPTY — it can add to a fresh site but can
//      NEVER overwrite or delete existing work (no-data-loss, test-locked).
// Pure functions; routes do the I/O and agency fencing.

export interface KitOffering { name: string; category: string; description: string; price_text: string; sort_order: number }
export interface KitFaq { question: string; answer: string; sort_order: number }
export interface KitPayload {
  version: 1;
  industry_key: string;
  template_slug: string;
  category_order: string[];
  offerings: KitOffering[];
  faqs: KitFaq[];
  voice: { tone_notes: string; preferred_vocabulary: string; never_claim: string };
  theme_tokens: Record<string, string>;
  seo_defaults: { seo_title_pattern: string };   // reserved seam; V1 keeps it empty
}

const s = (v: unknown, max: number): string => {
  let out = '';
  for (const ch of String(v ?? '')) { const c = ch.codePointAt(0)!; if (c === 10 || c >= 32) out += ch; }
  return out.trim().slice(0, max);
};

/** Build a kit from a site's rows. Deliberately IGNORES identity facts,
 *  testimonials, posts, media, announcements, and verification tokens. */
export function buildKitPayload(input: {
  industry_key?: string; template_slug?: string; category_order?: unknown;
  offerings?: Array<Record<string, unknown>>; faqs?: Array<Record<string, unknown>>;
  voice?: Record<string, unknown> | null; theme_tokens?: Record<string, unknown> | null;
}): KitPayload {
  return {
    version: 1,
    industry_key: s(input.industry_key || 'generic', 40) || 'generic',
    template_slug: s(input.template_slug || '', 60),
    category_order: Array.isArray(input.category_order) ? input.category_order.slice(0, 30).map((c) => s(c, 60)).filter(Boolean) : [],
    offerings: (input.offerings || []).slice(0, 60).map((o, i) => ({
      name: s(o.name, 120), category: s(o.category, 60) || 'General',
      description: s(o.description, 500), price_text: s(o.price_text, 40),
      sort_order: Number.isFinite(Number(o.sort_order)) ? Number(o.sort_order) : i,
    })).filter((o) => o.name),
    faqs: (input.faqs || []).slice(0, 30).map((f, i) => ({
      question: s(f.question, 200), answer: s(f.answer, 2000),
      sort_order: Number.isFinite(Number(f.sort_order)) ? Number(f.sort_order) : i,
    })).filter((f) => f.question && f.answer),
    voice: {
      tone_notes: s(input.voice?.tone_notes, 1000),
      preferred_vocabulary: s(input.voice?.preferred_vocabulary, 1000),
      never_claim: s(input.voice?.never_claim, 1000),
    },
    theme_tokens: Object.fromEntries(Object.entries(input.theme_tokens || {}).slice(0, 12).map(([k, v]) => [s(k, 30), s(v, 60)])),
    seo_defaults: { seo_title_pattern: '' },
  };
}

export interface ApplyState {
  offerings_count: number; faqs_count: number;
  has_voice: boolean; has_tokens: boolean;
  industry_key: string; category_order_count: number;
}
export interface ApplyPlan {
  insert_offerings: KitOffering[];
  insert_faqs: KitFaq[];
  set_voice: KitPayload['voice'] | null;
  set_tokens: Record<string, string> | null;
  set_industry: string | null;
  set_category_order: string[] | null;
  skipped: string[];   // honest report of what was NOT applied and why
}

/** Fill-only-empty: every section applies ONLY when the target has nothing there. */
export function applyPlan(kit: KitPayload, state: ApplyState): ApplyPlan {
  const skipped: string[] = [];
  const plan: ApplyPlan = {
    insert_offerings: [], insert_faqs: [], set_voice: null, set_tokens: null, set_industry: null, set_category_order: null, skipped,
  };
  if (state.offerings_count === 0 && kit.offerings.length) plan.insert_offerings = kit.offerings;
  else if (kit.offerings.length) skipped.push(`offerings (site already has ${state.offerings_count} — never overwritten)`);
  if (state.faqs_count === 0 && kit.faqs.length) plan.insert_faqs = kit.faqs;
  else if (kit.faqs.length) skipped.push(`FAQs (site already has ${state.faqs_count})`);
  const kitHasVoice = !!(kit.voice.tone_notes || kit.voice.preferred_vocabulary || kit.voice.never_claim);
  if (!state.has_voice && kitHasVoice) plan.set_voice = kit.voice;
  else if (kitHasVoice) skipped.push('voice (already set)');
  if (!state.has_tokens && Object.keys(kit.theme_tokens).length) plan.set_tokens = kit.theme_tokens;
  else if (Object.keys(kit.theme_tokens).length) skipped.push('colors (already customized)');
  if ((state.industry_key === 'generic' || !state.industry_key) && kit.industry_key !== 'generic') plan.set_industry = kit.industry_key;
  if (state.category_order_count === 0 && kit.category_order.length && state.offerings_count === 0) plan.set_category_order = kit.category_order;
  return plan;
}
