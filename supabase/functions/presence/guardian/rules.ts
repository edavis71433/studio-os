// ── The Brand Guardian's rules (M9.5D) — protect identity, never replace it ─
// The Guardian PROTECTS consistency. It does not write, edit, or review
// quality (the Writer, Editor, and Reviewer own those). Findings only;
// "Improve" hands off to the AI Editor through the customer.
//
// Two tiers, like the Reviewer: a deterministic consistency engine that runs
// with AI off, and an optional model tier for contradiction/personality
// detection — sanitized against the real corpus. Internal measures are
// numbers; customer-facing output is always sentences (Law 13).
import type { FactSheet } from '../writer/facts.ts';

export type GuardianCategory =
  | 'tone_drift' | 'vocabulary' | 'terminology' | 'formatting' | 'capitalization'
  | 'headlines' | 'cta_consistency' | 'personality' | 'reading_level' | 'professionalism'
  | 'business_consistency' | 'generic_ai_language' | 'repeated_phrases'
  | 'contradictory_messaging' | 'visual_photography' | 'visual_assets';
export const GUARDIAN_CATEGORIES: GuardianCategory[] = [
  'tone_drift', 'vocabulary', 'terminology', 'formatting', 'capitalization',
  'headlines', 'cta_consistency', 'personality', 'reading_level', 'professionalism',
  'business_consistency', 'generic_ai_language', 'repeated_phrases',
  'contradictory_messaging', 'visual_photography', 'visual_assets'];

export interface BrandProfile {
  mission: string; vision: string; core_values: string[]; personality: string;
  voice_characteristics: string; preferred_vocabulary: string;
  words_prefer: string[]; words_avoid: string[]; never_claims: string;
  reading_level: 'everyday' | 'relaxed' | 'professional' | 'technical';
  industry_terminology: string[]; taglines: string[]; elevator_pitch: string;
  target_audience: string; brand_promise: string; selling_points: string[];
}

export interface GuardianLocation { kind: 'identity' | 'faq' | 'offering' | 'post' | 'media' | 'site'; id?: string; field?: string }

export interface GuardianFinding {
  review_id: string;
  category: GuardianCategory;
  severity: 'attention' | 'suggestion' | 'note';
  confidence: number;
  location: GuardianLocation;
  finding: string;
  reason: string;
  expected_benefit: string;
  suggested_action: string;
  requires_editor: boolean;
  requires_writer: boolean;
  manual_possible: true;
  approval_required: true;
  supporting_evidence: string[];
  status: 'open' | 'dismissed';
  handoff: { route: 'editor' | 'manual'; kind?: string; action?: string; target_id?: string };
}

/* handoff derivation — fixed table; the model never chooses */
const EDITOR_ACTION: Partial<Record<GuardianCategory, string>> = {
  tone_drift: 'tone', vocabulary: 'brand', terminology: 'consistency', formatting: 'consistency',
  capitalization: 'consistency', headlines: 'headlines', cta_consistency: 'cta',
  personality: 'brand', reading_level: 'simplify', professionalism: 'tone',
  generic_ai_language: 'brand', repeated_phrases: 'rewrite',
};
const LOC_TO_EDIT_KIND: Record<string, string> = {
  identity: 'edit_identity', faq: 'edit_faq', offering: 'edit_offering', post: 'edit_post', site: 'site_polish',
};
export function deriveGuardianHandoff(category: GuardianCategory, location: GuardianLocation): GuardianFinding['handoff'] & { requires_editor: boolean } {
  const action = EDITOR_ACTION[category];
  if (action && location.kind !== 'media') {
    return { route: 'editor', kind: LOC_TO_EDIT_KIND[location.kind] || 'site_polish', action, target_id: location.id, requires_editor: true };
  }
  return { route: 'manual', requires_editor: false }; // visual + business-fact verification stay with humans
}

let seq = 0;
export const resetGuardianSeq = () => { seq = 0; };
export function gFinding(category: GuardianCategory, severity: GuardianFinding['severity'], confidence: number,
  location: GuardianLocation, finding: string, reason: string, benefit: string, action: string, quotes: string[]): GuardianFinding {
  const h = deriveGuardianHandoff(category, location);
  return {
    review_id: `b_${category}_${++seq}`, category, severity,
    confidence: Math.round(confidence * 100) / 100, location, finding, reason,
    expected_benefit: benefit, suggested_action: action,
    requires_editor: h.requires_editor, requires_writer: false,
    manual_possible: true, approval_required: true,
    supporting_evidence: quotes.filter(Boolean).slice(0, 3), status: 'open',
    handoff: { route: h.route, kind: h.kind, action: h.action, target_id: h.target_id },
  };
}

/* ── internal measures (numbers for the machine, never for the customer) ── */
const flesch = (t: string): number => {
  const s = Math.max(1, (t.match(/[.!?]+/g) || []).length);
  const w = t.split(/\s+/).filter(Boolean);
  if (!w.length) return 100;
  const syll = w.reduce((n, x) => n + Math.max(1, (x.toLowerCase().match(/[aeiouy]+/g) || []).length), 0);
  return Math.round(206.835 - 1.015 * (w.length / s) - 84.6 * (syll / w.length));
};
const READING_BANDS: Record<BrandProfile['reading_level'], [number, number]> = {
  everyday: [60, 100], relaxed: [50, 90], professional: [35, 75], technical: [20, 65],
};
const GENERIC_AI = /\b(nestled|elevate[sd]?|culinary journey|look no further|we pride ourselves|hidden gem|delve|unparalleled|tantalize|a testament to|whether you'?re .{3,40} or)\b/i;
const snip = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const digitsOnly = (s: string) => (s || '').replace(/\D/g, '');

export interface VisualInput { media: Array<{ id: string; width: number | null; height: number | null; alt_text: string }> }

export interface GuardianResult { findings: GuardianFinding[]; metrics: Record<string, number> }

export function guardianFindings(facts: FactSheet, profile: BrandProfile, visual: VisualInput,
  scope: { kind: 'site' | 'section'; section?: string }): GuardianResult {
  const out: GuardianFinding[] = [];
  const metrics: Record<string, number> = {};
  const want = (name: string) => scope.kind === 'site' || scope.section === name;

  // the written corpus, labeled by location
  const corpus: Array<{ loc: GuardianLocation; label: string; text: string }> = [];
  if (want('business')) {
    if (facts.description) corpus.push({ loc: { kind: 'identity', field: 'description' }, label: 'description', text: facts.description });
    if (facts.story) corpus.push({ loc: { kind: 'identity', field: 'story' }, label: 'story', text: facts.story });
    if (facts.tagline) corpus.push({ loc: { kind: 'identity', field: 'tagline' }, label: 'tagline', text: facts.tagline });
  }
  if (want('faqs')) for (const f of facts.faqs_full.filter((f) => f.visible)) corpus.push({ loc: { kind: 'faq', id: f.id }, label: 'an answer', text: f.answer });
  if (want('offerings')) for (const o of facts.offerings.filter((o) => o.visible && o.description)) corpus.push({ loc: { kind: 'offering', id: o.id }, label: `“${o.name}”`, text: o.description });
  if (want('updates')) for (const p of facts.posts_full.filter((p) => p.shown)) corpus.push({ loc: { kind: 'post', id: p.id }, label: `“${p.title}”`, text: p.body_md });
  const allText = corpus.map((c) => c.text).join('\n');

  // ── tone drift: reading-ease spread across substantial texts ──
  const substantial = corpus.filter((c) => c.text.split(/\s+/).length >= 15);
  if (substantial.length >= 2) {
    const eases = substantial.map((c) => ({ c, e: flesch(c.text) }));
    const max = eases.reduce((a, b) => (a.e > b.e ? a : b)), min = eases.reduce((a, b) => (a.e < b.e ? a : b));
    metrics.tone_spread = max.e - min.e;
    if (max.e - min.e > 45) {
      out.push(gFinding('tone_drift', 'suggestion', 0.8, { kind: 'site' },
        `Parts of the site read very differently — ${min.c.label} is much denser than ${max.c.label}.`,
        'A site that shifts voice mid-visit reads like it was written by different people.',
        'one voice, start to finish', 'Bring the denser passages closer to the lighter ones.',
        [snip(min.c.text), snip(max.c.text)]));
    }
  }

  // ── vocabulary: the customer's own words-to-avoid list ──
  for (const word of (profile.words_avoid || []).map((w) => String(w).trim()).filter((w) => w.length > 2)) {
    const hit = corpus.find((c) => c.text.toLowerCase().includes(word.toLowerCase()));
    if (hit) out.push(gFinding('vocabulary', 'attention', 1, hit.loc,
      `“${word}” appears in ${hit.label} — it’s on your words-to-avoid list.`,
      'You decided this word doesn’t sound like you.',
      'the writing stays yours', `Replace “${word}” with something from your preferred vocabulary.`,
      [snip(hit.text)]));
  }

  // ── generic AI-ish language ──
  for (const c of corpus) {
    const m = c.text.match(GENERIC_AI);
    if (m) {
      out.push(gFinding('generic_ai_language', 'suggestion', 0.9, c.loc,
        `${c.label[0].toUpperCase()}${c.label.slice(1)} slips into stock website language (“${m[0]}”).`,
        'Phrases every website uses make yours sound like every website.',
        'writing that could only be about this business', 'Say it the way you’d say it across the counter.',
        [snip(c.text)]));
      break; // one finding, not a pile-on
    }
  }

  // ── repeated phrases: a 4-gram appearing 3+ times ──
  {
    const grams = new Map<string, number>();
    const wordsAll = allText.toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i + 3 < wordsAll.length; i++) {
      const g = wordsAll.slice(i, i + 4).join(' ');
      grams.set(g, (grams.get(g) || 0) + 1);
    }
    const repeated = [...grams.entries()].filter(([g, n]) => n >= 3 && g.length > 14).sort((a, b) => b[1] - a[1])[0];
    metrics.max_repeated_phrase = repeated?.[1] || 0;
    if (repeated) out.push(gFinding('repeated_phrases', 'note', 0.85, { kind: 'site' },
      `The phrase “${repeated[0]}” appears ${repeated[1]} times across the site.`,
      'A phrase loses its power the third time a reader meets it.',
      'each page earns its own words', 'Vary the wording where it repeats.', [repeated[0]]));
  }

  // ── formatting: mixed price styles ──
  if (want('offerings')) {
    const prices = facts.offerings.filter((o) => o.visible && o.price_text).map((o) => o.price_text);
    const styles = new Set(prices.map((p) => /^\$\d+$/.test(p) ? 'plain' : /^\$\d+\.\d{2}$/.test(p) ? 'cents' : /^\d/.test(p) ? 'bare' : 'word'));
    metrics.price_styles = styles.size;
    if (prices.length >= 3 && styles.size >= 3) out.push(gFinding('formatting', 'note', 0.9, { kind: 'site' },
      'Prices are written three different ways on the menu.',
      'Mixed formats read as unedited.',
      'a menu that looks deliberate', 'Pick one style — most menus read best as “$18”.',
      prices.slice(0, 3)));
  }

  // ── capitalization: category casing variants ──
  if (want('offerings')) {
    const cats = new Map<string, Set<string>>();
    for (const o of facts.offerings.filter((o) => o.visible)) {
      const key = o.category.toLowerCase();
      if (!cats.has(key)) cats.set(key, new Set());
      cats.get(key)!.add(o.category);
    }
    for (const [, variants] of cats) if (variants.size > 1) {
      out.push(gFinding('capitalization', 'note', 1, { kind: 'site' },
        `A menu section is written ${variants.size} ways (${[...variants].join(', ')}).`,
        'Same word, different dress — small, but customers notice tidy.',
        'one consistent menu', 'Pick one casing for the section name.', [...variants]));
      break;
    }
  }

  // ── reading level vs the profile's target ──
  if (want('business') && facts.description && facts.description.split(/\s+/).length >= 15) {
    const e = flesch(facts.description);
    const [lo, hi] = READING_BANDS[profile.reading_level] || READING_BANDS.everyday;
    metrics.description_ease = e;
    if (e < lo || e > hi) out.push(gFinding('reading_level', 'suggestion', 0.8, { kind: 'identity', field: 'description' },
      `The description reads ${e < lo ? 'heavier' : 'lighter'} than the “${profile.reading_level}” level you chose.`,
      'You set a reading level so the writing meets your customers where they are.',
      'writing pitched exactly for your audience', e < lo ? 'Loosen the sentences.' : 'It can afford a little more substance.',
      [snip(facts.description)]));
  }

  // ── business consistency: phone digits in copy vs the real phone ──
  {
    const real = digitsOnly(facts.phone);
    const inCopy = allText.match(/\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/g) || [];
    for (const p of inCopy) {
      if (real && digitsOnly(p) !== real) {
        const hit = corpus.find((c) => c.text.includes(p));
        out.push(gFinding('business_consistency', 'attention', 1, hit?.loc || { kind: 'site' },
          `A phone number in the copy (${p}) doesn’t match your business number.`,
          'Two numbers means one of them is wrong for somebody.',
          'every number a customer dials is the right one', 'Make the copy match the business number, or update the number.',
          [p]));
        break;
      }
    }
  }

  // ── cta consistency: links vs language ──
  if (want('business')) {
    if (facts.ordering_url && !/order/i.test(allText) && corpus.length) {
      out.push(gFinding('cta_consistency', 'note', 0.7, { kind: 'identity', field: 'description' },
        'You have an online-ordering link, but the writing never mentions ordering.',
        'Customers won’t look for a door the writing never points to.',
        'the words and the buttons agree', 'A sentence like “order online for pickup” closes the gap.', []));
    }
    if (!facts.booking_url && /\b(reserve|reservation|book a table)\b/i.test(allText)) {
      out.push(gFinding('cta_consistency', 'suggestion', 0.85, { kind: 'site' },
        'The writing invites reservations, but there’s no reservation link.',
        'An invitation without a door frustrates the exact customer you want.',
        'every invitation has its door', 'Add the reservation link, or soften the invitation.', []));
    }
  }

  // ── visual: photography style + asset quality (review only, never changes) ──
  {
    const withDims = visual.media.filter((m) => m.width && m.height);
    const portrait = withDims.filter((m) => m.height! > m.width!).length;
    const landscape = withDims.filter((m) => m.width! >= m.height!).length;
    metrics.photo_count = visual.media.length;
    if (withDims.length >= 4 && portrait >= 2 && landscape >= 2 && Math.min(portrait, landscape) / withDims.length > 0.3) {
      out.push(gFinding('visual_photography', 'note', 0.7, { kind: 'media' },
        'Your photographs mix portrait and landscape roughly evenly.',
        'A consistent orientation reads as a deliberate style.',
        'a photo collection that feels curated', 'Favor one orientation for the site’s main photographs.', []));
    }
    const tiny = withDims.filter((m) => Math.max(m.width!, m.height!) < 600);
    if (tiny.length) out.push(gFinding('visual_assets', 'note', 0.9, { kind: 'media', id: tiny[0].id },
      `${tiny.length} photograph${tiny.length > 1 ? 's are' : ' is'} small enough to look soft on large screens.`,
      'Low-resolution images quietly undercut an otherwise polished page.',
      'crisp photographs at every size', 'Replace with larger originals when convenient.', []));
  }

  const RANK = { attention: 3, suggestion: 2, note: 1 } as const;
  out.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.category.localeCompare(b.category));
  return { findings: out.slice(0, 16), metrics };
}

/* ── model-finding sanitizer (guardian categories, real locations, real quotes) ── */
export function sanitizeGuardianFindings(raw: unknown, facts: FactSheet): GuardianFinding[] {
  if (!Array.isArray(raw)) return [];
  const out: GuardianFinding[] = [];
  const valid = {
    faq: new Set(facts.faqs_full.map((f) => f.id)),
    offering: new Set(facts.offerings.map((o) => o.id)),
    post: new Set(facts.posts_full.map((p) => p.id)),
  };
  const FIELDS = new Set(['tagline', 'description', 'story', 'service_area']);
  const corpus = JSON.stringify(facts);
  const s = (v: unknown, cap: number) => (typeof v === 'string' ? v.trim().slice(0, cap) : '');
  const MODEL_CATS: GuardianCategory[] = ['contradictory_messaging', 'personality', 'tone_drift', 'professionalism', 'terminology', 'headlines'];
  for (const f of (raw as Array<Record<string, unknown>>).slice(0, 10)) {
    const category = MODEL_CATS.includes(f?.category as GuardianCategory) ? f!.category as GuardianCategory : null;
    if (!category) continue;
    const lk = (f?.location as Record<string, string>)?.kind;
    const locKind = ['identity', 'faq', 'offering', 'post', 'site'].includes(lk) ? lk as GuardianLocation['kind'] : null;
    if (!locKind) continue;
    const location: GuardianLocation = { kind: locKind };
    if (locKind === 'identity') {
      const field = s((f?.location as Record<string, unknown>)?.field, 40);
      if (!FIELDS.has(field)) continue;
      location.field = field;
    } else if (locKind !== 'site') {
      const id = s((f?.location as Record<string, unknown>)?.id, 40);
      if (!valid[locKind as 'faq' | 'offering' | 'post'].has(id)) continue;
      location.id = id;
    }
    const finding = s(f?.finding, 240), reason = s(f?.reason, 240);
    if (!finding || !reason) continue;
    const quotes = (Array.isArray(f?.supporting_evidence) ? f!.supporting_evidence as string[] : [])
      .map((q) => s(q, 160)).filter((q) => q.length >= 8 && corpus.includes(q));
    if (category === 'contradictory_messaging' && quotes.length < 2) continue; // a contradiction needs both sides quoted
    out.push(gFinding(category, 'suggestion', Math.min(0.85, Math.max(0.5, Number(f?.confidence) || 0.7)),
      location, finding, reason, s(f?.expected_benefit, 200) || 'a steadier brand voice',
      s(f?.suggested_action, 240) || 'Align the wording.', quotes));
  }
  return out;
}

/* ── learning: observation of outcomes → GUIDANCE, never profile edits ── */
export interface LearningInput { kind: string; status: string; options?: Array<{ tone?: string }>; chosen_option?: number | null }
export function observeLearning(drafts: LearningInput[], nowIso: string): Record<string, unknown> {
  const accepted: Record<string, number> = {}, discarded: Record<string, number> = {}, tones: Record<string, number> = {};
  for (const d of drafts) {
    if (d.status === 'accepted') {
      accepted[d.kind] = (accepted[d.kind] || 0) + 1;
      const tone = d.options?.[d.chosen_option ?? -1]?.tone;
      if (tone) tones[tone] = (tones[tone] || 0) + 1;
    }
    if (d.status === 'discarded') discarded[d.kind] = (discarded[d.kind] || 0) + 1;
  }
  return { accepted_kinds: accepted, discarded_kinds: discarded, chosen_tones: tones, observed_at: nowIso };
}
