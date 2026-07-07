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
import { deriveConnectedIntelligence } from '../connected/intelligence.ts';
import { PACK_JUDGMENT_RULES } from '../industry/compose.ts';

export interface JudgeContext {
  siteId: string;
  now: string;                                         // the pass's clock
  previous: Record<string, { first_seen_at: string }>; // judgment_key → prior state
  plan?: string;                                       // L3.1: the commercial rung, for edition-aware audience
}

export interface Rule {
  key: string;                       // judgment_key + dedupe_key (stable per site)
  category: JudgmentCategory;
  // L3.1: audience may be edition-dependent — the SAME evidence reaches a
  // different audience by plan, per the Optimization Promotion Constitution.
  audience: Audience | ((ctx: JudgeContext) => Audience);
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

// ── L3.1: edition-aware audience (the Optimization Promotion Constitution) ───
// Ownership decides audience; the plan (edition) shifts it. The rule: customer
// interruptions DECREASE as Studio OS owns more of the work. Monitor is the one
// edition where evidence flips TOWARD the customer — it's their external site,
// so everything is honest migration evidence.
//   knowledge    — only the customer holds the fact → customer on every edition
//   optimization — customer's own content work → they do it on self-serve
//                  Presence/Monitor; the studio does it on Managed and up
//   platform     — WE own the fix (template/renderer/hosting) → silent on our
//                  editions (Law 24); customer migration evidence on Monitor
//   infra        — a per-site operator action → operator on our editions;
//                  customer (their own infrastructure) on Monitor
//   dormant      — a feature that doesn't exist yet → nobody, ever
export type AudienceMode = 'knowledge' | 'optimization' | 'platform' | 'infra' | 'dormant';
export const LADDER_PLANS = ['presence_monitor', 'presence', 'presence_managed', 'agency', 'enterprise'] as const;
export function audienceByMode(mode: AudienceMode, plan: string): Audience {
  const monitor = plan === 'presence_monitor';
  const managed = plan === 'presence_managed' || plan === 'agency' || plan === 'enterprise';
  switch (mode) {
    case 'knowledge': return 'customer';
    case 'optimization': return monitor ? 'customer' : managed ? 'operator' : 'customer';
    case 'platform': return monitor ? 'customer' : 'none';
    case 'infra': return monitor ? 'customer' : 'operator';
    case 'dormant': return 'none';
  }
}
const aud = (mode: AudienceMode) => (ctx: JudgeContext): Audience => audienceByMode(mode, ctx.plan || 'presence');

// Resolve a rule's audience for a given plan (used by judge() and integrity tests).
export function resolveRuleAudience(audience: Audience | ((ctx: JudgeContext) => Audience), plan: string): Audience {
  return typeof audience === 'function' ? audience({ siteId: '', now: '', previous: {}, plan }) : audience;
}

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
    // Base capabilities not shipped yet — recorded, always suppressed. (The M10/L3
    // optimization types formerly parked here are now classified into the business
    // -task rules below, per the Optimization Promotion Constitution.)
    types: ['local_presence.profile_unconnected', 'reviews.source_unconnected',
            'trust.policy_page_missing', 'local_presence.map_signal_missing', 'business_info.holiday_hours_missing'],
    dimensions: ['business_accuracy'],
    impactNote: 'capabilities the platform has not shipped yet (destinations, contract pages)',
    customerImpact: 'none — there is nothing anyone can act on today',
    priority: () => 'informational' },

  // ═══ L3.1 — OPTIMIZATION JUDGMENT DEPTH ═════════════════════════════════════
  // The suppressed optimization observations, now classified into BUSINESS TASKS
  // (not technical findings), grouped so many observations become one calm issue,
  // audience chosen by ownership + edition. Constitution 07 governs every choice.
  // Customer copy lives downstream (recommendations/moments); these carry only
  // the grouping, the audience, and the timing.

  // ── Customer-owned tasks (business knowledge / their own content) ──
  { key: 'opt_ai_search', category: 'discoverability', audience: aud('optimization'), timing: 'whenever', ttlDays: 45,
    types: ['aeo.answers_thin'],
    dimensions: ['search_visibility'], impactNote: 'AEO: answers the business owns, thin for AI answer engines',
    customerImpact: 'AI assistants can’t quote the business well', priority: () => 'low' },

  { key: 'opt_details_everywhere', category: 'accuracy', audience: aud('knowledge'), timing: 'soon', ttlDays: 30,
    types: ['aeo.citation_facts_incomplete', 'local_presence.nap_inconsistent'],
    dimensions: ['business_accuracy', 'search_visibility'], impactNote: 'core details incomplete/inconsistent across the site — only the owner knows the truth',
    customerImpact: 'directories and AI search distrust a business whose details disagree', priority: bySeverity('high', 'medium', 'low') },

  { key: 'opt_menu_reconcile', category: 'accuracy', audience: aud('knowledge'), timing: 'soon', ttlDays: 21,
    types: ['knowledge.item_unlisted', 'knowledge.price_mismatch', 'knowledge.phone_mismatch', 'knowledge.hours_available'],
    dimensions: ['business_accuracy'], impactNote: 'the owner’s uploaded document and the site disagree — only they can say which is right',
    customerImpact: 'customers see prices/items/hours that don’t match reality', priority: bySeverity('high', 'medium', 'low') },

  { key: 'opt_photos', category: 'media', audience: aud('knowledge'), timing: 'whenever', ttlDays: 60,
    types: ['media.imagery_none'],
    dimensions: ['conversion'], impactNote: 'no photographs — words doing all the work; only the owner can supply real ones',
    customerImpact: 'customers can’t picture the business before deciding', priority: () => 'low' },

  // (opt_reputation removed in L3.4 — "you haven't added a testimonial lately" is
  //  engagement-nudge, not business insight; reviews.velocity_slowing is now dormant.)

  { key: 'opt_story', category: 'trust', audience: aud('knowledge'), timing: 'whenever', ttlDays: 90,
    types: ['trust.team_info_missing'],
    dimensions: ['customer_trust'], impactNote: 'no one behind the business is named — only the owner knows their story',
    customerImpact: 'faces and names build the trust a nameless site can’t', priority: () => 'low' },

  // ── Platform-owned (Law 24: silent on our editions; migration evidence on Monitor) ──
  { key: 'opt_search_hygiene', category: 'discoverability', audience: aud('platform'), timing: 'whenever', ttlDays: 60,
    types: ['seo.sitemap_page_missing', 'seo.orphan_page', 'seo.duplicate_page', 'seo.noindex',
            'aeo.faq_schema_missing', 'aeo.entity_links_missing', 'media.og_image_missing'],
    dimensions: ['search_visibility'], impactNote: 'search/AI hygiene the renderer + template own; on Monitor it is migration evidence',
    customerImpact: 'a site that’s harder for search and AI to read fully', priority: () => 'low' },

  { key: 'opt_technical_access', category: 'accessibility', audience: aud('platform'), timing: 'whenever', ttlDays: 60,
    types: ['accessibility.form_label_missing', 'accessibility.tabindex_positive', 'accessibility.aria_hidden_focusable', 'accessibility.table_structure'],
    dimensions: ['accessibility'], impactNote: 'template-level accessibility we own; on Monitor it is migration evidence',
    customerImpact: 'assistive-technology users hit avoidable obstacles', priority: bySeverity('medium', 'low', 'low') },

  { key: 'opt_speed', category: 'operations', audience: aud('platform'), timing: 'whenever', ttlDays: 60,
    types: ['performance.compression_missing', 'performance.cache_headers_missing', 'performance.slow_response', 'performance.cdn_absent', 'performance.lazy_loading_missing'],
    dimensions: ['performance'], impactNote: 'hosting/render performance we own; on Monitor it is migration evidence',
    customerImpact: 'a slower site quietly loses impatient visitors', priority: bySeverity('medium', 'low', 'low') },

  // ── Operator/infra (per-site studio action; customer’s own infra on Monitor) ──
  { key: 'opt_foundations', category: 'operations', audience: aud('infra'), timing: 'soon', ttlDays: 30,
    types: ['infrastructure.dns_apex_unresolved', 'infrastructure.dns_www_unresolved', 'infrastructure.domain_expiring',
            'infrastructure.http_not_redirected', 'infrastructure.redirect_chain', 'infrastructure.spf_missing',
            'infrastructure.dmarc_missing', 'infrastructure.caa_missing', 'seo.robots_blocks_all'],
    dimensions: ['business_accuracy', 'customer_trust'], impactNote: 'domain/DNS/email/security foundations; the studio holds these on our editions',
    customerImpact: 'foundations that, unattended, can take a site or its email down', priority: bySeverity('critical', 'high', 'low') },

  // ── Dormant (a feature that doesn’t exist yet — nobody, ever, until it ships) ──
  { key: 'opt_dormant', category: 'platform', audience: 'none', timing: 'none', ttlDays: 90,
    // Integrations not shipped + L3.4 low-value cuts (observed for migration
    // readiness / future analytics, surfaced to no one): a slowing testimonial
    // stream (engagement-nudge, not insight), a location term the heuristic often
    // gets wrong, duplicate uploads (housekeeping), and Twitter/X cards (near-zero
    // SMB value).
    types: ['analytics.not_connected', 'local_presence.apple_business_unconnected',
            'reviews.velocity_slowing', 'aeo.location_terms_missing', 'media.duplicate_image', 'seo.twitter_card_missing'],
    dimensions: ['business_accuracy'], impactNote: 'integrations not shipped + low-value observations; emitted for completeness, surfaced to no one',
    customerImpact: 'none — nothing to act on, or too low-value to interrupt for', priority: () => 'informational' },

  // ── L4.1/L4.2: connected-provider reads enter the pipeline HERE (no bypass).
  //    Pure summaries stay observed-only (the customer sees these numbers
  //    directly on the Connections surface — "your rating: 4.6"), so nobody is
  //    interrupted just for connecting a service.
  { key: 'connected_observed', category: 'platform', audience: 'none', timing: 'none', ttlDays: 30,
    types: ['reviews.connected_summary', 'seo.connected_search', 'analytics.connected_traffic'],
    dimensions: ['business_accuracy'], impactNote: 'connected-provider snapshot; recorded, shown on the Connections surface, no interruption',
    customerImpact: 'the customer sees these directly on their Connections surface', priority: () => 'informational' },

  // ── L4.2 CONNECTED REPUTATION — the one connected concern that earns a place
  //    on the customer's list, and only because it satisfies the Optimization
  //    Constitution: the reviews are the OWNER'S, the work (a reply, lifting a
  //    low rating) is genuinely theirs, and it has no on-site equivalent to merge
  //    into. Edition-aware (aud optimization): the customer owns it on self-serve;
  //    the studio owns it on Managed and up — so work decreases as editions rise.
  //    Mergeable downstream, so it folds into the improvements bundle rather than
  //    adding a fresh interruption.
  { key: 'connected_reputation', category: 'trust', audience: aud('optimization'), timing: 'whenever', ttlDays: 30,
    types: ['reviews.connected_rating_low', 'reviews.connected_unreplied'],
    dimensions: ['reputation', 'customer_trust'], impactNote: 'connected reviews the owner can act on — unreplied, or a rating worth lifting',
    customerImpact: 'replying to reviews and lifting a low rating builds trust customers act on', priority: () => 'low' },

  // ── L4.2 CONNECTED IMPROVEMENT — measured good news. Grouped so several
  //    improvements become ONE calm celebration, never a per-metric ping. Always
  //    the customer's to enjoy (a celebration is not work, so it isn't reduced by
  //    edition). Flows the full pipeline → a celebration Business Moment.
  { key: 'connected_improved', category: 'trust', audience: aud('knowledge'), timing: 'whenever', ttlDays: 14,
    types: ['analytics.connected_traffic_up', 'seo.connected_search_up', 'reviews.connected_rating_up', 'reviews.connected_reviews_up'],
    dimensions: ['reputation', 'search_visibility', 'conversion'], impactNote: 'measured improvement since the prior read — traffic, search, rating, or new reviews up',
    customerImpact: 'the business is doing better on a channel it can see — worth acknowledging', priority: () => 'low' },

  // ── L5.1 Industry Pack judgment rules — appended generically; each consumes
  //    ONLY its pack's namespaced evidence types, so it is inert for every other
  //    industry (no engine industry-filter). Restaurant is the flagship pack.
  ...PACK_JUDGMENT_RULES,
];

/** Deterministic suppression — noise never reaches M9.2. Each check returns a
 *  reason string; the judgment is kept, marked suppressed, and stays auditable. */
function suppressionReason(j: Judgment, active: Map<string, Judgment>, plan: string): string {
  // roadmap state is recorded, never surfaced
  if (j.rule === 'platform_roadmap') return 'platform_roadmap';
  // audience 'none' is by definition not worth anyone's interruption
  if (j.audience === 'none') return 'no_audience';
  // L3.4: on Monitor the room's draft/publish workflow doesn't exist — those base
  // customer judgments ("your basics are missing… clears the way to publishing")
  // are false for a site we don't host. Only the edition-aware optimization
  // (opt_*) rules speak to a Monitor site, as honest migration evidence.
  // (connected_* rules are the customer's OWN external accounts — always
  //  applicable on Monitor, so they are exempt alongside the opt_* rules.)
  if (plan === 'presence_monitor' && j.audience === 'customer' && !j.rule.startsWith('opt_') && !j.rule.startsWith('connected_')) return 'monitor_not_applicable';
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
      audience: resolveRuleAudience(rule.audience, ctx.plan || 'presence'),
      status: 'active',
      suppression_reason: '',
      evidence_count: matched.length,
      first_seen_at: prior?.first_seen_at || ctx.now,
    });
  }

  // ── L4.2 connected intelligence: connected evidence informs OTHER judgments
  //    (never bypasses the pipeline). Corroboration nudges confidence up and
  //    records why; contradiction marks a false on-site judgment for suppression.
  //    Pure + deterministic; additive — connected-less runs are provably unchanged.
  const intel = deriveConnectedIntelligence(evidence);
  for (const j of draft) {
    const boost = intel.boosts.get(j.rule);
    if (boost) {
      j.confidence = Math.round(Math.min(1, j.confidence + boost.bump) * 100) / 100;
      j.reasoning += ' ' + boost.note;
    }
  }

  // suppression pass (deterministic; order-independent: computed against the full
  // active map). A contradicted judgment leaves the map, so its conflict cascade
  // (e.g. "site not live" suppressing public-facing concerns) lifts too — connected
  // data corrects the false positive AND everything that rode on it.
  const activeMap = new Map(draft.filter((j) => !intel.contradicts.has(j.rule)).map((j) => [j.rule, j]));
  for (const j of draft) {
    const reason = intel.contradicts.has(j.rule) ? 'connected_contradicts' : suppressionReason(j, activeMap, ctx.plan || 'presence');
    if (reason) { j.status = 'suppressed'; j.suppression_reason = reason; j.timing = 'none'; }
  }

  // stable output order: priority desc, then rule name — reproducibility includes order
  const PRIO: Record<Priority, number> = { critical: 5, high: 4, medium: 3, low: 2, informational: 1 };
  draft.sort((a, b) => (PRIO[b.priority] - PRIO[a.priority]) || (SEV_RANK[b.severity] - SEV_RANK[a.severity]) || a.rule.localeCompare(b.rule));

  const unmatched = [...new Set(evidence.map((e) => e.type).filter((t) => !consumed.has(t)))].sort();
  return { judgments: draft, unmatched_types: unmatched };
}
