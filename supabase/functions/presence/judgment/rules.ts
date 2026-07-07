// ── The judgment rules (M9.1) — deterministic, composable, explainable ──────
// Each rule GROUPS related evidence into one business issue (twenty missing
// alt texts → ONE judgment), assigns priority from evidence severity/counts
// (never randomness, never a model), and declares audience + timing — the
// engine's answer to "should the customer even be interrupted?".
//
// judge() is a pure function: (evidence, ctx) → judgments. The previous
// batch's keys ride in via ctx (I/O stays in engine.ts), so first-seen
// carries across runs deterministically.
import type { EvidenceRow, Judgment, Priority, Timing, Audience, JudgmentCategory, ImpactDimension } from './contract.ts';
import { judgmentHash, maxSeverity, minConfidence, buildReasoning, SEV_RANK } from './contract.ts';

export interface JudgeContext {
  siteId: string;
  now: string;                                         // the pass's clock
  previous: Record<string, { first_seen_at: string }>; // judgment_key → prior state
}

interface Rule {
  key: string;                       // judgment_key + dedupe_key (stable per site)
  category: JudgmentCategory;
  audience: Audience;
  timing: Timing;
  ttlDays: number;                   // expiration if no newer batch arrives
  types: string[];                   // evidence types this rule consumes
  dimensions: ImpactDimension[];
  impactNote: string;                // internal impact explanation (not customer copy)
  customerImpact: string;            // internal explanation of what customers experience
  priority: (ev: EvidenceRow[]) => Priority;
  extraReasoning?: (ev: EvidenceRow[]) => string;
}

/* deterministic priority helpers */
const bySeverity = (critical: Priority, warning: Priority, info: Priority) =>
  (ev: EvidenceRow[]): Priority => {
    const s = maxSeverity(ev);
    return s === 'critical' ? critical : s === 'warning' ? warning : info;
  };
const byCount = (floor: Priority, over: Priority, threshold: number) =>
  (ev: EvidenceRow[]): Priority => (ev.length >= threshold ? over : floor);

export const RULES: Rule[] = [
  { key: 'site_unreachable', category: 'availability', audience: 'operator', timing: 'immediate', ttlDays: 2,
    types: ['website.http_status', 'website.live_fetch_failed', 'trust.ssl_missing'],
    dimensions: ['customer_trust', 'reputation'],
    impactNote: 'the live site is failing or insecure for every visitor',
    customerImpact: 'visitors may be unable to reach or trust the site right now',
    priority: bySeverity('critical', 'high', 'medium') },

  { key: 'hosting_unprovisioned', category: 'operations', audience: 'operator', timing: 'soon', ttlDays: 14,
    types: ['website.hosting_missing'],
    dimensions: ['business_accuracy'],
    impactNote: 'nothing can go live until hosting is provisioned',
    customerImpact: 'none yet — the site has never been public',
    priority: () => 'high' },

  { key: 'site_not_yet_live', category: 'availability', audience: 'customer', timing: 'soon', ttlDays: 30,
    types: ['website.not_live', 'trust.hours_not_public'],
    dimensions: ['business_accuracy', 'search_visibility'],
    impactNote: 'the business has no public presence until first publish',
    customerImpact: 'customers cannot find the business online yet',
    priority: () => 'medium' },

  { key: 'search_snippets', category: 'discoverability', audience: 'customer', timing: 'soon', ttlDays: 30,
    types: ['seo.title_missing', 'seo.title_duplicate', 'seo.title_length',
            'seo.description_missing', 'seo.description_duplicate', 'seo.description_length', 'seo.thin_content'],
    dimensions: ['search_visibility'],
    impactNote: 'search result snippets are the business’s first impression in Google',
    customerImpact: 'searchers see weak or missing snippets where competitors show polished ones',
    priority: (ev) => (maxSeverity(ev) === 'critical' ? 'high' : ev.length >= 4 ? 'medium' : 'low') },

  { key: 'search_infrastructure', category: 'discoverability', audience: 'operator', timing: 'soon', ttlDays: 30,
    types: ['seo.robots_missing', 'seo.sitemap_missing', 'seo.canonical_missing',
            'seo.h1_missing', 'seo.h1_multiple',
            'structured_data.ldjson_invalid', 'structured_data.schema_missing', 'structured_data.schema_field_missing',
            'metadata.og_missing', 'metadata.favicon_missing'],
    dimensions: ['search_visibility'],
    impactNote: 'crawl/indexing plumbing is a template concern, not a client edit',
    customerImpact: 'invisible to visitors; affects how search engines read the site',
    priority: bySeverity('high', 'medium', 'low') },

  { key: 'accessibility_content', category: 'accessibility', audience: 'customer', timing: 'soon', ttlDays: 30,
    types: ['accessibility.img_alt_missing', 'media.alt_short'],
    dimensions: ['accessibility', 'search_visibility'],
    impactNote: 'undescribed images exclude assistive-tech users and hide content from search',
    customerImpact: 'customers using screen readers miss the photographs entirely',
    priority: byCount('low', 'medium', 3) },

  { key: 'accessibility_template', category: 'accessibility', audience: 'operator', timing: 'whenever', ttlDays: 60,
    types: ['accessibility.link_text_vague', 'accessibility.landmark_missing',
            'accessibility.lang_missing', 'accessibility.heading_skip'],
    dimensions: ['accessibility'],
    impactNote: 'structural accessibility is owned by the template bar',
    customerImpact: 'assistive-tech navigation is harder than it should be',
    priority: bySeverity('medium', 'medium', 'low') },

  { key: 'broken_paths', category: 'trust', audience: 'operator', timing: 'immediate', ttlDays: 7,
    types: ['links.internal_broken', 'links.redirect_to_missing'],
    dimensions: ['customer_trust', 'search_visibility'],
    impactNote: 'dead paths read as neglect to both visitors and crawlers',
    customerImpact: 'a visitor following these links hits a missing page',
    priority: bySeverity('high', 'medium', 'low') },

  { key: 'business_facts_incomplete', category: 'accuracy', audience: 'customer', timing: 'immediate', ttlDays: 14,
    types: ['business_info.identity_incomplete', 'business_info.address_incomplete',
            'business_info.hours_incomplete', 'trust.contact_missing'],
    dimensions: ['business_accuracy', 'customer_trust', 'conversion'],
    impactNote: 'missing core facts (name/description/address/hours/contact) block the basics',
    customerImpact: 'customers cannot find, reach, or plan a visit to the business',
    priority: bySeverity('critical', 'high', 'medium') },

  { key: 'facts_inconsistent', category: 'accuracy', audience: 'customer', timing: 'soon', ttlDays: 14,
    types: ['business_info.phone_mismatch'],
    dimensions: ['business_accuracy', 'customer_trust'],
    impactNote: 'disagreeing facts erode confidence in every other fact',
    customerImpact: 'customers see two different phone numbers and cannot know which is right',
    priority: () => 'medium' },

  { key: 'closed_flag_stale', category: 'accuracy', audience: 'customer', timing: 'immediate', ttlDays: 7,
    types: ['business_info.closed_longstanding'],
    dimensions: ['business_accuracy', 'conversion', 'reputation'],
    impactNote: 'a long-standing "temporarily closed" turns customers away, possibly wrongly',
    customerImpact: 'the site may be telling customers the business is closed when it is open',
    priority: () => 'high' },

  { key: 'public_freshness', category: 'freshness', audience: 'customer', timing: 'seasonal', ttlDays: 45,
    types: ['freshness.publish_stale', 'freshness.updates_quiet', 'freshness.menu_unchanged'],
    dimensions: ['customer_trust', 'search_visibility'],
    impactNote: 'a site that never changes reads as possibly abandoned to visitors and crawlers',
    customerImpact: 'customers cannot tell whether what they read is still true',
    priority: (ev) => {
      const worstDays = Math.max(...ev.map((e) => Number(e.facts.days || 0)));
      return worstDays >= 240 ? 'medium' : 'low';
    },
    extraReasoning: (ev) => `worst staleness ${Math.max(...ev.map((e) => Number(e.facts.days || 0)))}d.` },

  { key: 'draft_waiting', category: 'freshness', audience: 'customer', timing: 'soon', ttlDays: 21,
    types: ['freshness.draft_idle'],
    dimensions: ['business_accuracy'],
    impactNote: 'work exists that customers cannot see; the draft and reality may have diverged',
    customerImpact: 'customers see the older version of whatever the draft already fixed',
    priority: () => 'medium' },

  { key: 'media_quality', category: 'media', audience: 'customer', timing: 'whenever', ttlDays: 45,
    types: ['performance.image_oversized', 'performance.image_dimensions_missing',
            'media.offering_photo_missing', 'media.unused'],
    dimensions: ['performance', 'conversion'],
    impactNote: 'heavy or missing imagery costs load time and appetite appeal',
    customerImpact: 'pages load slower and menu items sell themselves without pictures',
    priority: (ev) => (ev.some((e) => e.severity === 'warning') ? 'medium' : 'low') },

  { key: 'template_performance', category: 'operations', audience: 'operator', timing: 'whenever', ttlDays: 60,
    types: ['performance.page_weight', 'performance.blocking_scripts', 'performance.font_swap_missing'],
    dimensions: ['performance'],
    impactNote: 'render-path weight is a template concern under the template bar',
    customerImpact: 'pages paint slower than the platform budget intends',
    priority: () => 'low' },

  { key: 'conversion_paths', category: 'conversion', audience: 'customer', timing: 'whenever', ttlDays: 45,
    types: ['conversion.booking_missing', 'conversion.ordering_missing', 'conversion.prices_missing', 'content.cta_missing'],
    dimensions: ['conversion'],
    impactNote: 'visitors with intent have no obvious next step (may be intentional for this business)',
    customerImpact: 'a ready customer has to work out how to book, order, or price the visit',
    priority: (ev) => (ev.some((e) => e.type === 'conversion.prices_missing' && Number(e.facts.count || 0) >= 3) ? 'low' : 'informational') },

  { key: 'content_depth', category: 'content', audience: 'customer', timing: 'seasonal', ttlDays: 60,
    types: ['content.faqs_none', 'content.updates_none', 'content.description_thin',
            'content.reading_hard', 'content.offering_duplicate',
            'reviews.testimonials_none', 'reviews.testimonials_stale'],
    dimensions: ['customer_trust', 'search_visibility', 'conversion'],
    impactNote: 'thin sections answer fewer customer questions than the contract allows',
    customerImpact: 'customers with questions leave to ask a competitor’s site instead',
    priority: byCount('informational', 'low', 3) },

  { key: 'security_headers', category: 'operations', audience: 'operator', timing: 'whenever', ttlDays: 60,
    types: ['trust.security_header_missing'],
    dimensions: ['customer_trust'],
    impactNote: 'edge hardening headers are a hosting-layer concern',
    customerImpact: 'no visible effect; defense-in-depth for visitors',
    priority: () => 'low' },

  { key: 'platform_roadmap', category: 'platform', audience: 'none', timing: 'none', ttlDays: 90,
    types: ['local_presence.profile_unconnected', 'reviews.source_unconnected',
            'trust.policy_page_missing', 'local_presence.map_signal_missing', 'business_info.holiday_hours_missing',
            // M10 Optimization Engine types — consciously acknowledged here (the
            // completeness law: every catalog type has a judging rule), recorded
            // and ALWAYS suppressed, exactly like the entries above. Promoting
            // any of these to a surfaced judgment is a deliberate future rules
            // change, not a side effect of observing more. Additive data only.
            'infrastructure.dns_apex_unresolved', 'infrastructure.dns_www_unresolved', 'infrastructure.domain_expiring',
            'infrastructure.http_not_redirected', 'infrastructure.redirect_chain', 'infrastructure.spf_missing',
            'infrastructure.dmarc_missing', 'seo.sitemap_page_missing', 'seo.robots_blocks_all', 'seo.orphan_page',
            'seo.duplicate_page', 'aeo.faq_schema_missing', 'aeo.entity_links_missing', 'aeo.answers_thin',
            'aeo.citation_facts_incomplete', 'aeo.location_terms_missing', 'accessibility.form_label_missing',
            'accessibility.tabindex_positive', 'accessibility.aria_hidden_focusable', 'performance.compression_missing',
            'performance.cache_headers_missing', 'performance.slow_response', 'local_presence.nap_inconsistent',
            'reviews.velocity_slowing', 'analytics.not_connected', 'trust.team_info_missing', 'media.imagery_none',
            'media.og_image_missing', 'media.duplicate_image', 'knowledge.item_unlisted', 'knowledge.price_mismatch',
            'knowledge.phone_mismatch', 'knowledge.hours_available',
            // L3 Optimization Engine (Foundation) gap-fill types — same discipline:
            // observed and recorded now, ALWAYS suppressed; promoting them into
            // customer-facing recommendations is L3.1 (Optimization Judgment Depth),
            // deliberately not this milestone. Additive data only.
            'infrastructure.caa_missing', 'seo.noindex', 'seo.twitter_card_missing',
            'performance.cdn_absent', 'performance.lazy_loading_missing', 'accessibility.table_structure',
            'local_presence.apple_business_unconnected'],
    dimensions: ['business_accuracy'],
    impactNote: 'capabilities the platform has not shipped yet (destinations, contract pages) plus M10/L3 optimization observations awaiting deliberate judgment rules (L3.1)',
    customerImpact: 'none — there is nothing anyone can act on today',
    priority: () => 'informational' },
];

/** Deterministic suppression — noise never reaches M9.2. Each check returns a
 *  reason string; the judgment is kept, marked suppressed, and stays auditable. */
function suppressionReason(j: Judgment, active: Map<string, Judgment>): string {
  // roadmap state is recorded, never surfaced
  if (j.rule === 'platform_roadmap') return 'platform_roadmap';
  // audience 'none' is by definition not worth anyone's interruption
  if (j.audience === 'none') return 'no_audience';
  // conflict: a site that was never published makes public-facing judgments moot
  const notLive = active.has('site_not_yet_live') || active.has('hosting_unprovisioned');
  if (notLive && ['public_freshness', 'broken_paths', 'search_snippets', 'security_headers', 'site_unreachable'].includes(j.rule)) {
    return 'site_not_live';
  }
  // noise floor: a lone low-confidence informational observation is not a finding
  if (j.priority === 'informational' && j.evidence_count === 1 && j.confidence < 0.9) return 'noise_floor';
  return '';
}

export interface JudgeResult {
  judgments: Judgment[];
  unmatched_types: string[];     // evidence types no rule consumed — visibility, not failure
}

/** The Judgment Engine's pure core. Same evidence + same context → byte-identical output. */
export function judge(evidence: EvidenceRow[], ctx: JudgeContext): JudgeResult {
  const consumed = new Set<string>();
  const draft: Judgment[] = [];

  for (const rule of RULES) {
    const matched = evidence
      .filter((e) => rule.types.includes(e.type))
      .sort((a, b) => (a.type + a.resource).localeCompare(b.type + b.resource)); // order-independence
    if (!matched.length) continue;
    matched.forEach((e) => consumed.add(e.type));

    const expires = new Date(new Date(ctx.now).getTime() + rule.ttlDays * 86400000).toISOString();
    const prior = ctx.previous[rule.key];
    draft.push({
      judgment_id: judgmentHash(ctx.siteId, rule.key, matched),
      timestamp: ctx.now,
      evidence_ids: matched.map((e) => e.id),
      category: rule.category,
      priority: rule.priority(matched),
      severity: maxSeverity(matched),
      confidence: minConfidence(matched),
      reasoning: buildReasoning(rule.key, matched, rule.extraReasoning ? rule.extraReasoning(matched) : ''),
      business_impact: { dimensions: rule.dimensions, note: rule.impactNote },
      customer_impact: rule.customerImpact,
      timing: rule.timing,
      dedupe_key: rule.key,
      expires_at: expires,
      rule: rule.key,
      audience: rule.audience,
      status: 'active',
      suppression_reason: '',
      evidence_count: matched.length,
      first_seen_at: prior?.first_seen_at || ctx.now,
    });
  }

  // suppression pass (deterministic; order-independent: computed against the full active map)
  const activeMap = new Map(draft.map((j) => [j.rule, j]));
  for (const j of draft) {
    const reason = suppressionReason(j, activeMap);
    if (reason) { j.status = 'suppressed'; j.suppression_reason = reason; j.timing = 'none'; }
  }

  // stable output order: priority desc, then rule name — reproducibility includes order
  const PRIO: Record<Priority, number> = { critical: 5, high: 4, medium: 3, low: 2, informational: 1 };
  draft.sort((a, b) => (PRIO[b.priority] - PRIO[a.priority]) || (SEV_RANK[b.severity] - SEV_RANK[a.severity]) || a.rule.localeCompare(b.rule));

  const unmatched = [...new Set(evidence.map((e) => e.type).filter((t) => !consumed.has(t)))].sort();
  return { judgments: draft, unmatched_types: unmatched };
}
