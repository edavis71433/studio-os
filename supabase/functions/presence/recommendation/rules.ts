// ── The recommendation rule catalog (M9.2) — deterministic, explainable ─────
// One entry per M9.1 judgment rule (integrity-tested: every judgment rule with
// an interruptible audience has exactly one recommendation rule). Each entry
// answers, in internal engineering language (NEVER customer copy):
//   what should be done (action + description) · why (the judgment's reasoning
//   rides along) · benefit (hedged, honest) · effort · risk · undoability ·
//   whether the proposed workflow uses AI (with a manual path ALWAYS available).
//
// recommend() is pure: (judgments, ctx) → recommendations. Same input,
// byte-identical output, order-independent.
import type { JudgmentRow, Recommendation, ActionType, ValueDimension, Effort, Risk, Undoability } from './contract.ts';
import { recommendationHash } from './contract.ts';

export interface RecommendContext {
  siteId: string;
  now: string;
  previous: Record<string, { first_seen_at: string }>; // recommendation_key → prior state
}

interface RecRule {
  judgmentRule: string;              // consumes this M9.1 rule
  action: ActionType;
  title: string;                     // internal structured title
  description: string;               // internal: what should be done
  expected_benefit: string;
  value: ValueDimension[];
  effort: Effort;
  risk: Risk;
  undoability: Undoability;
  requires_ai: boolean;              // proposed workflow uses AI drafting (M9.3+); manual path always exists
  ttlDays: number;
}

export const REC_RULES: RecRule[] = [
  { judgmentRule: 'site_unreachable', action: 'verify',
    title: 'verify hosting and certificate health',
    description: 'run the admin hosting health check; repair provisioning or SSL if the provider confirms a fault',
    expected_benefit: 'restores reachability and secure serving for every visitor',
    value: ['trust', 'reputation'], effort: 'minutes', risk: 'none', undoability: 'not_applicable', requires_ai: false, ttlDays: 2 },

  { judgmentRule: 'hosting_unprovisioned', action: 'connect',
    title: 'provision hosting for this site',
    description: 'run idempotent provisioning from the admin surface; verify the site record gains hosting',
    expected_benefit: 'unblocks the path to first publish',
    value: ['business_accuracy'], effort: 'minutes', risk: 'none', undoability: 'not_applicable', requires_ai: false, ttlDays: 14 },

  { judgmentRule: 'site_not_yet_live', action: 'complete',
    title: 'complete the first publish',
    description: 'finish the remaining draft facts, preview, and run the publish ritual when the client is ready',
    expected_benefit: 'the business gains a public presence customers and search engines can find',
    value: ['business_accuracy', 'search_visibility'], effort: 'hour', risk: 'none', undoability: 'versioned', requires_ai: false, ttlDays: 30 },

  { judgmentRule: 'search_snippets', action: 'update',
    title: 'update search titles and descriptions',
    description: 'fill or differentiate seo_title / seo_description (and thin page text) in the draft, then publish',
    expected_benefit: 'search results show complete, distinct snippets instead of blanks or duplicates',
    value: ['search_visibility'], effort: 'minutes', risk: 'none', undoability: 'versioned', requires_ai: true, ttlDays: 30 },

  { judgmentRule: 'search_infrastructure', action: 'review',
    title: 'review template search plumbing',
    description: 'template-layer pass: canonicals, robots, sitemap, headings, schema fields, OG tags; ships as a template version',
    expected_benefit: 'search engines read the site the way the template bar intends',
    value: ['search_visibility'], effort: 'hours', risk: 'low', undoability: 'versioned', requires_ai: false, ttlDays: 30 },

  { judgmentRule: 'accessibility_content', action: 'update',
    title: 'add or improve image descriptions',
    description: 'write alt text for undescribed or one-word-described photographs in the draft, then publish',
    expected_benefit: 'assistive-tech users get the images; search engines get the content',
    value: ['accessibility', 'search_visibility'], effort: 'minutes', risk: 'none', undoability: 'versioned', requires_ai: true, ttlDays: 30 },

  { judgmentRule: 'accessibility_template', action: 'review',
    title: 'review template accessibility structure',
    description: 'template-layer pass: landmarks, lang, heading order, link text; ships as a template version',
    expected_benefit: 'assistive navigation matches the WCAG-AA-by-construction bar',
    value: ['accessibility'], effort: 'hours', risk: 'low', undoability: 'versioned', requires_ai: false, ttlDays: 60 },

  { judgmentRule: 'broken_paths', action: 'review',
    title: 'repair broken internal paths',
    description: 'point saved redirects at existing pages; if template links are dangling, fix at the template layer',
    expected_benefit: 'no visitor or crawler hits a dead page from inside the site',
    value: ['trust', 'search_visibility'], effort: 'minutes', risk: 'none', undoability: 'versioned', requires_ai: false, ttlDays: 7 },

  { judgmentRule: 'business_facts_incomplete', action: 'complete',
    title: 'complete the missing business facts',
    description: 'fill the empty identity/address/hours/contact fields in the draft, then publish',
    expected_benefit: 'customers can find, reach, and plan a visit; publish blockers clear',
    value: ['business_accuracy', 'trust', 'conversion'], effort: 'minutes', risk: 'none', undoability: 'versioned', requires_ai: false, ttlDays: 14 },

  { judgmentRule: 'facts_inconsistent', action: 'verify',
    title: 'verify which phone number is correct',
    description: 'confirm with the client which number is right; make identity and location agree (or clear one)',
    expected_benefit: 'every published fact agrees with every other fact',
    value: ['business_accuracy', 'trust'], effort: 'minutes', risk: 'none', undoability: 'versioned', requires_ai: false, ttlDays: 14 },

  { judgmentRule: 'closed_flag_stale', action: 'verify',
    title: 'verify the temporarily-closed notice',
    description: 'confirm whether the business has reopened; clear the flag if so, then publish',
    expected_benefit: 'stops turning away customers if the business is actually open',
    value: ['business_accuracy', 'conversion', 'reputation'], effort: 'minutes', risk: 'none', undoability: 'versioned', requires_ai: false, ttlDays: 7 },

  { judgmentRule: 'public_freshness', action: 'refresh',
    title: 'refresh stale public content',
    description: 'confirm hours/menu are current; publish a small true update so the site shows recent life',
    expected_benefit: 'visitors and crawlers see a maintained, current business',
    value: ['freshness', 'trust', 'search_visibility'], effort: 'minutes', risk: 'none', undoability: 'versioned', requires_ai: false, ttlDays: 45 },

  { judgmentRule: 'draft_waiting', action: 'review',
    title: 'review the waiting draft changes',
    description: 'read the pending diff; publish it or discard it so draft and reality stop diverging',
    expected_benefit: 'customers see the corrections that already exist in the draft',
    value: ['business_accuracy', 'freshness'], effort: 'minutes', risk: 'none', undoability: 'versioned', requires_ai: false, ttlDays: 21 },

  { judgmentRule: 'media_quality', action: 'replace',
    title: 'replace heavy photographs and fill photo gaps',
    description: 'swap oversized sources for lighter ones; add photographs to visible menu items that lack them',
    expected_benefit: 'faster pages and menu items that sell themselves visually',
    value: ['performance', 'conversion', 'customer_experience'], effort: 'hour', risk: 'none', undoability: 'versioned', requires_ai: false, ttlDays: 45 },

  { judgmentRule: 'template_performance', action: 'review',
    title: 'review template render-path weight',
    description: 'template-layer pass on page weight, blocking scripts, and font loading; ships as a template version',
    expected_benefit: 'pages paint within the platform performance budget',
    value: ['performance'], effort: 'hours', risk: 'low', undoability: 'versioned', requires_ai: false, ttlDays: 60 },

  { judgmentRule: 'conversion_paths', action: 'create',
    title: 'add the missing next-step paths',
    description: 'add booking/ordering links and prices where the business offers them (may be intentional to omit)',
    expected_benefit: 'a ready customer has an obvious next step',
    value: ['conversion', 'customer_experience'], effort: 'minutes', risk: 'none', undoability: 'versioned', requires_ai: false, ttlDays: 45 },

  { judgmentRule: 'content_depth', action: 'create',
    title: 'deepen thin content sections',
    description: 'draft first FAQs/updates, expand the short description, gather a recent testimonial — into the draft, for review',
    expected_benefit: 'the site answers more customer questions before they leave to ask elsewhere',
    value: ['trust', 'search_visibility', 'conversion'], effort: 'hour', risk: 'none', undoability: 'versioned', requires_ai: true, ttlDays: 60 },

  { judgmentRule: 'security_headers', action: 'enable',
    title: 'enable edge security headers',
    description: 'add the missing HSTS / content-type-options headers at the hosting edge configuration',
    expected_benefit: 'defense-in-depth for every visitor connection',
    value: ['trust'], effort: 'minutes', risk: 'low', undoability: 'fully_undoable', requires_ai: false, ttlDays: 60 },
];

export interface RecommendResult {
  recommendations: Recommendation[];
  unconsumed_rules: string[];   // active judgment rules with no recommendation rule — visibility, not failure
}

/** The Recommendation Engine's pure core. Consumes ONLY judgments. */
export function recommend(judgments: JudgmentRow[], ctx: RecommendContext): RecommendResult {
  const byRule = new Map<string, RecRule>(REC_RULES.map((r) => [r.judgmentRule, r]));
  const out: Recommendation[] = [];
  const unconsumed: string[] = [];

  // stable input: active, non-expired, interruptible judgments — deduped per rule
  const eligible = new Map<string, JudgmentRow>();
  for (const j of [...judgments].sort((a, b) => a.rule.localeCompare(b.rule))) {
    if (j.status !== 'active') continue;                       // suppressed judgments recommend nothing
    if (j.audience === 'none') continue;                       // nobody to propose to
    if (new Date(j.expires_at) <= new Date(ctx.now)) continue; // expired judgments are stale input
    if (!eligible.has(j.rule)) eligible.set(j.rule, j);        // duplicates collapse deterministically
  }

  for (const [rule, j] of eligible) {
    const rec = byRule.get(rule);
    if (!rec) { unconsumed.push(rule); continue; }
    const expires = new Date(Math.min(
      new Date(j.expires_at).getTime(),
      new Date(ctx.now).getTime() + rec.ttlDays * 86400000,
    )).toISOString();
    const key = 'rec_' + rule;
    const prior = ctx.previous[key];
    out.push({
      recommendation_id: recommendationHash(ctx.siteId, key, [j.judgment_hash]),
      timestamp: ctx.now,
      supporting_judgment_ids: [j.judgment_hash],
      category: j.category,
      title: rec.title,
      description: rec.description,
      reason: j.reasoning,                                  // traceable: the judgment explains itself
      expected_benefit: rec.expected_benefit,
      estimated_effort: rec.effort,
      estimated_risk: rec.risk,
      undoability: rec.undoability,
      timing: j.timing,                                     // urgency came from evidence via judgment
      affected_resources: [...new Set(j.evidence_ids)].slice(0, 50),
      recommended_action: rec.action,
      requires_ai: rec.requires_ai,
      manual_available: true,
      approval_required: true,
      expiration: expires,
      deduplication_key: key,
      rule: key,
      priority: j.priority,
      audience: j.audience as 'customer' | 'operator',
      value_dimensions: rec.value,
      status: 'active',
      suppression_reason: '',
      first_seen_at: prior?.first_seen_at || ctx.now,
    });
  }

  // suppression: informational-priority proposals are recorded, not surfaced —
  // "may be intentional" findings never interrupt anyone downstream
  for (const r of out) {
    if (r.priority === 'informational') { r.status = 'suppressed'; r.suppression_reason = 'informational_floor'; r.timing = 'none'; }
  }

  // stable order: priority desc, then rule — reproducibility includes order
  const PRIO: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, informational: 1 };
  out.sort((a, b) => (PRIO[b.priority] - PRIO[a.priority]) || a.rule.localeCompare(b.rule));

  return { recommendations: out, unconsumed_rules: unconsumed.sort() };
}
