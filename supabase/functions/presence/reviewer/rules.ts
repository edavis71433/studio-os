// ── The AI Reviewer's rules (M9.5C) — critique only, pure where it matters ──
// The Reviewer CRITIQUES. The Editor improves. The Writer creates. Never
// overlapping: findings carry no payloads, only explanations and a mapped
// handoff (requires_editor/requires_writer are DERIVED from category +
// location by fixed tables — the model never controls the handoff).
//
// Two tiers:
//   deterministic — always runs, even with AI off. Real checks over real text.
//   model         — optional depth; its findings are sanitized against the
//                   actual content: fake locations dropped, unquotable
//                   "evidence" stripped, unknown categories rejected.
import type { FactSheet } from '../writer/facts.ts';

export type ReviewCategory =
  | 'readability' | 'accessibility' | 'seo' | 'aeo' | 'trust' | 'conversion'
  | 'brand_voice' | 'grammar' | 'tone' | 'consistency' | 'plain_language'
  | 'structure' | 'cta' | 'internal_linking' | 'heading_hierarchy'
  | 'scannability' | 'freshness' | 'missing_information' | 'duplicate_content'
  | 'customer_questions' | 'local_presence';
export const CATEGORIES: ReviewCategory[] = [
  'readability', 'accessibility', 'seo', 'aeo', 'trust', 'conversion',
  'brand_voice', 'grammar', 'tone', 'consistency', 'plain_language',
  'structure', 'cta', 'internal_linking', 'heading_hierarchy',
  'scannability', 'freshness', 'missing_information', 'duplicate_content',
  'customer_questions', 'local_presence'];

// M9.5G: brand-identity concerns are CEDED to the Brand Guardian — it reads
// the Brand Profile and grounds these better. The taxonomy above stays frozen
// (historical reports still render); the model tier simply may no longer emit
// these three. The customer meets both engines as ONE review surface.
export const CEDED_TO_GUARDIAN: ReviewCategory[] = ['brand_voice', 'tone', 'consistency'];
export const MODEL_CATEGORIES: ReviewCategory[] = CATEGORIES.filter((c) => !CEDED_TO_GUARDIAN.includes(c));

export type Severity = 'attention' | 'suggestion' | 'note';

export interface FindingLocation {
  kind: 'identity' | 'faq' | 'offering' | 'post' | 'site';
  id?: string;          // entity id for faq/offering/post
  field?: string;       // identity field name
}

/** The frozen 15-field finding contract. */
export interface Finding {
  review_id: string;                 // finding id, stable within its report
  category: ReviewCategory;
  severity: Severity;
  confidence: number;
  location: FindingLocation;
  finding: string;                   // what was found, merchant words
  reason: string;                    // why it matters
  expected_benefit: string;
  suggested_action: string;          // how to improve it, in words
  requires_editor: boolean;          // the AI Editor can help (derived, never model-set)
  requires_writer: boolean;          // needs NEW content (derived)
  manual_possible: true;             // constitutional constant
  approval_required: true;           // constitutional constant
  supporting_evidence: string[];     // verbatim quotes from the actual content
  status: 'open' | 'dismissed';
  // the prepared handoff (client passes it to /editor/improve or /writer/generate)
  handoff: { route: 'editor' | 'writer' | 'manual'; kind?: string; action?: string; target_id?: string } ;
}

/* ── the derived handoff tables — responsibilities never overlap ── */
const EDITOR_ACTION: Partial<Record<ReviewCategory, string>> = {
  readability: 'readability', accessibility: 'accessibility', seo: 'seo', aeo: 'aeo',
  trust: 'trust', conversion: 'conversion', brand_voice: 'brand', grammar: 'grammar',
  tone: 'tone', consistency: 'consistency', plain_language: 'simplify', structure: 'structure',
  cta: 'cta', internal_linking: 'linking', heading_hierarchy: 'structure', scannability: 'scannability',
  freshness: 'modernize', duplicate_content: 'rewrite',
};
const WRITER_CATEGORIES: ReviewCategory[] = ['missing_information', 'customer_questions'];
const LOC_TO_EDIT_KIND: Record<FindingLocation['kind'], string> = {
  identity: 'edit_identity', faq: 'edit_faq', offering: 'edit_offering', post: 'edit_post', site: 'site_polish',
};

export function deriveHandoff(category: ReviewCategory, location: FindingLocation): Finding['handoff'] & { requires_editor: boolean; requires_writer: boolean } {
  if (WRITER_CATEGORIES.includes(category)) {
    return { route: 'writer', kind: category === 'customer_questions' ? 'faqs' : 'identity_copy', requires_editor: false, requires_writer: true };
  }
  const action = EDITOR_ACTION[category];
  if (action) {
    return { route: 'editor', kind: LOC_TO_EDIT_KIND[location.kind], action, target_id: location.id, requires_editor: true, requires_writer: false };
  }
  return { route: 'manual', requires_editor: false, requires_writer: false }; // e.g. local_presence — nothing to write, only to verify
}

let seq = 0;
export function makeFinding(
  category: ReviewCategory, severity: Severity, confidence: number,
  location: FindingLocation, finding: string, reason: string,
  benefit: string, action: string, quotes: string[],
): Finding {
  const h = deriveHandoff(category, location);
  return {
    review_id: `f_${category}_${++seq}`,
    category, severity, confidence: Math.round(confidence * 100) / 100,
    location, finding, reason, expected_benefit: benefit, suggested_action: action,
    requires_editor: h.requires_editor, requires_writer: h.requires_writer,
    manual_possible: true, approval_required: true,
    supporting_evidence: quotes.filter(Boolean).slice(0, 3),
    status: 'open',
    handoff: { route: h.route, kind: h.kind, action: h.action, target_id: h.target_id },
  };
}
export const resetFindingSeq = () => { seq = 0; };

/* ── deterministic tier — always runs, even with AI off ── */
const flesch = (t: string): number => {
  const s = Math.max(1, (t.match(/[.!?]+/g) || []).length);
  const w = t.split(/\s+/).filter(Boolean);
  if (!w.length) return 100;
  const syll = w.reduce((n, x) => n + Math.max(1, (x.toLowerCase().match(/[aeiouy]+/g) || []).length), 0);
  return Math.round(206.835 - 1.015 * (w.length / s) - 84.6 * (syll / w.length));
};
const JARGON = /\b(synergy|leverage|utilize|best-in-class|cutting[- ]edge|state[- ]of[- ]the[- ]art|solutions|paradigm)\b/i;
const WEAK_CTA = /\b(click here|learn more|submit|read more)\b/i;
const snip = (s: string, n = 90) => s.length > n ? s.slice(0, n - 1) + '…' : s;

export function deterministicFindings(facts: FactSheet, scope: { kind: 'site' | 'section' | 'entity'; section?: string; targetId?: string }): Finding[] {
  const out: Finding[] = [];
  const wantSection = (name: string) =>
    scope.kind === 'site' || (scope.kind === 'section' && scope.section === name);
  const wantEntity = (id: string) => scope.kind !== 'entity' || scope.targetId === id;

  // identity prose
  if (wantSection('business')) {
    if (facts.description) {
      const r = flesch(facts.description);
      if (r < 50) out.push(makeFinding('readability', 'suggestion', 0.9, { kind: 'identity', field: 'description' },
        'The business description reads at a difficult level.', 'Dense sentences lose skimming visitors.',
        'more customers read it to the end', 'Shorter sentences, everyday words.', [snip(facts.description)]));
      if (JARGON.test(facts.description)) out.push(makeFinding('plain_language', 'suggestion', 0.95, { kind: 'identity', field: 'description' },
        'The description leans on marketing jargon.', 'Customers trust plain words more than buzzwords.',
        'the writing sounds like a person, not a brochure', 'Swap the jargon for concrete, everyday language.', [snip(facts.description)]));
    } else {
      out.push(makeFinding('missing_information', 'attention', 1, { kind: 'identity', field: 'description' },
        'There is no business description yet.', 'It is the first thing customers and search engines read.',
        'visitors immediately understand what this business is', 'Write a few sentences about the business.', []));
    }
    if (!facts.booking_url && !facts.ordering_url && WEAK_CTA.test(facts.description + facts.story)) {
      out.push(makeFinding('cta', 'note', 0.7, { kind: 'identity', field: 'description' },
        'The text gestures at next steps without naming one.', 'Vague invitations lose ready customers.',
        'a clear next step turns reading into visits', 'Name the action: reserve, order, call.', []));
    }
  }

  // faqs
  if (wantSection('faqs')) {
    if (!facts.faqs_full.length) {
      out.push(makeFinding('customer_questions', 'suggestion', 0.9, { kind: 'site' },
        'No customer questions are answered yet.', 'Customers with unanswered questions ask a competitor’s site.',
        'the site answers before customers have to call', 'Answer the one question customers ask most.', []));
    }
    const seen = new Map<string, string>();
    for (const f of facts.faqs_full.filter((f) => f.visible && wantEntity(f.id))) {
      const key = f.question.trim().toLowerCase();
      if (seen.has(key)) out.push(makeFinding('duplicate_content', 'suggestion', 1, { kind: 'faq', id: f.id },
        'Two answered questions are nearly identical.', 'Duplicates read as clutter and split the answer’s strength.',
        'one strong answer instead of two weak ones', 'Merge or remove the duplicate.', [snip(f.question)]));
      seen.set(key, f.id);
      if (f.answer && flesch(f.answer) < 45) out.push(makeFinding('readability', 'note', 0.8, { kind: 'faq', id: f.id },
        'This answer reads harder than it needs to.', 'Answers get skimmed; hard ones get skipped.',
        'the answer lands on first read', 'Simplify the sentences.', [snip(f.answer)]));
    }
  }

  // offerings
  if (wantSection('offerings')) {
    const names = new Map<string, number>();
    for (const o of facts.offerings.filter((o) => o.visible)) names.set(o.name, (names.get(o.name) || 0) + 1);
    for (const [name, n] of names) if (n > 1) out.push(makeFinding('duplicate_content', 'suggestion', 1, { kind: 'site' },
      `“${name}” appears ${n} times on the menu.`, 'Repeated items confuse customers and readers alike.',
      'a cleaner menu that reads deliberately', 'Remove or rename the duplicate.', [name]));
    const undescribed = facts.offerings.filter((o) => o.visible && !o.description && wantEntity(o.id));
    if (undescribed.length >= 3) out.push(makeFinding('missing_information', 'note', 0.85, { kind: 'site' },
      `${undescribed.length} menu items have no description.`, 'A line of description sells better than a name alone.',
      'items sell themselves on the page', 'Add a short line to the items that matter most.', undescribed.slice(0, 3).map((o) => o.name)));
  }

  // posts: heading hierarchy in markdown
  if (wantSection('updates')) {
    for (const p of facts.posts_full.filter((p) => p.shown && wantEntity(p.id))) {
      const levels = [...p.body_md.matchAll(/^(#{1,6})\s/gm)].map((m) => m[1].length);
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] > levels[i - 1] + 1) {
          out.push(makeFinding('heading_hierarchy', 'note', 1, { kind: 'post', id: p.id },
            'Headings in this update skip a level.', 'Ordered headings help scanning readers and assistive tools.',
            'the update scans cleanly top to bottom', 'Keep heading levels in order.', [snip(p.title)]));
          break;
        }
      }
      if (WEAK_CTA.test(p.body_md)) out.push(makeFinding('cta', 'note', 0.8, { kind: 'post', id: p.id },
        'This update closes on a vague invitation.', 'Vague buttons and links lose ready customers.',
        'readers know exactly what to do next', 'Name the action and the destination.', [snip(p.title)]));
    }
  }

  return out;
}

/* ── model-finding sanitizer — the model critiques; it does not get to lie ── */
export interface RawModelFinding {
  category?: string; severity?: string; confidence?: number;
  location?: { kind?: string; id?: string; field?: string };
  finding?: string; reason?: string; expected_benefit?: string; suggested_action?: string;
  supporting_evidence?: string[];
}

export function sanitizeModelFindings(raw: unknown, facts: FactSheet): Finding[] {
  if (!Array.isArray(raw)) return [];
  const out: Finding[] = [];
  const validIds = {
    faq: new Set(facts.faqs_full.map((f) => f.id)),
    offering: new Set(facts.offerings.map((o) => o.id)),
    post: new Set(facts.posts_full.map((p) => p.id)),
  };
  const IDENTITY_FIELDS = new Set(['tagline', 'description', 'story', 'service_area', 'seo_title', 'seo_description']);
  const corpus = JSON.stringify(facts);
  const s = (v: unknown, cap: number) => typeof v === 'string' ? v.trim().slice(0, cap) : '';

  for (const f of (raw as RawModelFinding[]).slice(0, 20)) {
    const category = MODEL_CATEGORIES.includes(f?.category as ReviewCategory) ? f!.category as ReviewCategory : null;
    if (!category) continue;
    const locKind = ['identity', 'faq', 'offering', 'post', 'site'].includes(f?.location?.kind || '') ? f!.location!.kind as FindingLocation['kind'] : null;
    if (!locKind) continue;
    const location: FindingLocation = { kind: locKind };
    if (locKind === 'identity') {
      const field = s(f?.location?.field, 40);
      if (!IDENTITY_FIELDS.has(field)) continue;               // fake fields die here
      location.field = field;
    } else if (locKind !== 'site') {
      const id = s(f?.location?.id, 40);
      if (!validIds[locKind].has(id)) continue;                // fake entity ids die here
      location.id = id;
    }
    const finding = s(f?.finding, 240), reason = s(f?.reason, 240);
    if (!finding || !reason) continue;
    const quotes = (Array.isArray(f?.supporting_evidence) ? f!.supporting_evidence! : [])
      .map((q) => s(q, 160))
      .filter((q) => q.length >= 8 && corpus.includes(q));      // unquotable "evidence" dies here
    const severity: Severity = f?.severity === 'attention' ? 'attention' : f?.severity === 'note' ? 'note' : 'suggestion';
    const confidence = Math.min(0.9, Math.max(0.5, Number(f?.confidence) || 0.7));
    out.push(makeFinding(category, severity, confidence, location, finding, reason,
      s(f?.expected_benefit, 200) || 'a small, honest improvement', s(f?.suggested_action, 240) || 'Improve it in place.', quotes));
  }
  return out;
}

/** Merge tiers: deterministic findings win their (category, location) slot. */
export function mergeFindings(deterministic: Finding[], model: Finding[], cap = 20): Finding[] {
  const key = (f: Finding) => `${f.category}|${f.location.kind}|${f.location.id || f.location.field || ''}`;
  const seen = new Set(deterministic.map(key));
  const merged = [...deterministic];
  for (const f of model) {
    if (seen.has(key(f))) continue;
    seen.add(key(f));
    merged.push(f);
  }
  const RANK: Record<Severity, number> = { attention: 3, suggestion: 2, note: 1 };
  merged.sort((a, b) => (RANK[b.severity] - RANK[a.severity]) || a.category.localeCompare(b.category));
  return merged.slice(0, cap);
}
