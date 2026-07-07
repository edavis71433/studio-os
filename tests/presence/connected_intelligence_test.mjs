// ── L4.2 Connected Intelligence suite ───────────────────────────────────────
// Connected data must make the platform SMARTER, not noisier. This proves the
// whole thesis on the real pipeline (evidence → judge → recommend → momentize →
// concierge): change detection, confidence strengthening, false-positive
// suppression, merging (never duplicating), calm celebration, edition behavior,
// and that a connected-less run is provably unchanged.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/connected_intelligence_test.mjs
import { connectedProvider, CONNECTED_EVIDENCE_TYPES } from '../../supabase/functions/presence/connected/evidence.ts';
import { deriveConnectedIntelligence, deriveSignals } from '../../supabase/functions/presence/connected/intelligence.ts';
import { CATALOG, makeEmit } from '../../supabase/functions/presence/evidence/contract.ts';
import { judge, RULES, resolveRuleAudience } from '../../supabase/functions/presence/judgment/rules.ts';
import { recommend, REC_RULES } from '../../supabase/functions/presence/recommendation/rules.ts';
import { momentize, TEMPLATES } from '../../supabase/functions/presence/moments/rules.ts';
import { answer, classifyIntent } from '../../supabase/functions/presence/concierge/answer.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-07-07T12:00:00.000Z';
const SITE = '00000000-0000-4000-8000-000000000001';

// ── real-chain bridges (identical shapes to what each engine stores) ──
function connectedEvidence(connected, connectedPrior = []) {
  const items = [];
  connectedProvider.provide({ site: { id: SITE }, now: NOW, connected, connectedPrior }, makeEmit(SITE, 'connected', NOW, items));
  return items.map((i) => ({ id: i.fingerprint, category: i.category, type: i.type, severity: i.severity, confidence: i.confidence, resource: i.resource, facts: i.facts }));
}
let seq = 0;
const ev = (type, resource = '', facts = {}) => {
  const c = CATALOG[type];
  return { id: `e${++seq}`, category: c.category, type, severity: c.severity, confidence: c.confidence, resource, facts };
};
const jctx = (plan = 'presence', previous = {}) => ({ siteId: SITE, now: NOW, previous, plan });
function judgmentRows(evidence, plan = 'presence') {
  return judge(evidence, jctx(plan)).judgments.map((j) => ({
    judgment_hash: j.judgment_id, judgment_key: j.dedupe_key, rule: j.rule, category: j.category,
    priority: j.priority, severity: j.severity, confidence: j.confidence, reasoning: j.reasoning,
    timing: j.timing, audience: j.audience, status: j.status, evidence_count: j.evidence_count,
    evidence_ids: j.evidence_ids, first_seen_at: j.first_seen_at, expires_at: j.expires_at,
  }));
}
function recRows(evidence, plan = 'presence') {
  const recs = recommend(judgmentRows(evidence, plan), { siteId: SITE, now: NOW, previous: {} }).recommendations;
  return recs.map((r) => ({
    recommendation_hash: r.recommendation_id, rule: r.rule, priority: r.priority, audience: r.audience,
    status: r.status, value_dimensions: r.value_dimensions, timing: r.timing, expires_at: r.expiration,
  }));
}
function pipeline(evidence, plan = 'presence') {
  return momentize(recRows(evidence, plan), { siteId: SITE, now: NOW, previous: {}, dismissals: {} });
}
const active = (m) => m.moments.filter((x) => x.status === 'active');

// ═══ 1. change detection — only MEANINGFUL improvement earns an observation ═══
{
  const up = connectedEvidence(
    [{ label: 'analytics', visitors: 300 }, { label: 'search', search_clicks: 240 }, { label: 'reviews', rating: 4.4, review_count: 50 }],
    [{ label: 'analytics', visitors: 200 }, { label: 'search', search_clicks: 120 }, { label: 'reviews', rating: 4.1, review_count: 45 }],
  ).map((e) => e.type);
  ok('change: real gains emit traffic_up, search_up, rating_up, reviews_up',
    up.includes('analytics.connected_traffic_up') && up.includes('seo.connected_search_up') &&
    up.includes('reviews.connected_rating_up') && up.includes('reviews.connected_reviews_up'), up.join(','));

  const tiny = connectedEvidence(
    [{ label: 'a', visitors: 205 }, { label: 'r', rating: 4.2, review_count: 47 }],
    [{ label: 'a', visitors: 200 }, { label: 'r', rating: 4.1, review_count: 45 }],
  ).map((e) => e.type);
  ok('change: sub-threshold wiggles are NOT change (no traffic/rating/reviews up)',
    !tiny.includes('analytics.connected_traffic_up') && !tiny.includes('reviews.connected_rating_up') && !tiny.includes('reviews.connected_reviews_up'), tiny.join(','));

  const down = connectedEvidence(
    [{ label: 'a', visitors: 120 }, { label: 'r', rating: 3.9, review_count: 45 }],
    [{ label: 'a', visitors: 200 }, { label: 'r', rating: 4.4, review_count: 45 }],
  ).map((e) => e.type);
  ok('change: a dip is never bad news — read-only intelligence never scolds', !down.some((t) => t.endsWith('_up')), down.join(','));

  const first = connectedEvidence([{ label: 'a', visitors: 900 }], []).map((e) => e.type);
  ok('change: with no prior read, no change is invented', !first.some((t) => t.endsWith('_up')));
}

// ═══ 2. NO BYPASS — every connected type is judged by exactly one rule ═══
{
  const owners = (t) => RULES.filter((r) => r.types.includes(t)).length;
  ok('no bypass: all 9 connected evidence types map to exactly one judgment rule',
    CONNECTED_EVIDENCE_TYPES.length === 9 && CONNECTED_EVIDENCE_TYPES.every((t) => owners(t) === 1), `${CONNECTED_EVIDENCE_TYPES.length} types`);
  ok('catalog: every connected evidence type is registered in the ONE catalog', CONNECTED_EVIDENCE_TYPES.every((t) => !!CATALOG[t]));
}

// ═══ 3. strengthen confidence — connected search corroborates the on-site listing ═══
{
  // a sub-1.0 on-site judgment, so the (bounded) corroboration nudge is visible
  const onSite = [{ ...ev('seo.title_missing', '/'), confidence: 0.8 }];
  const baseline = judge(onSite, jctx()).judgments.find((j) => j.rule === 'search_snippets');
  const withConnected = judge([...onSite, ...connectedEvidence([{ label: 'search', search_clicks: 180 }])], jctx()).judgments.find((j) => j.rule === 'search_snippets');
  ok('confidence: connected search nudges the on-site search-listing judgment UP', withConnected.confidence > baseline.confidence, `${baseline.confidence}→${withConnected.confidence}`);
  ok('confidence: the boost is recorded in reasoning (auditable, never silent)', /compounds real, measured reach/.test(withConnected.reasoning));
  ok('confidence: the nudge is bounded, never over 1.0', withConnected.confidence <= 1);
  // no false corroboration: connected search present, but a UNRELATED judgment is untouched
  const alt = judge([ev('accessibility.img_alt_missing', '/a'), ...connectedEvidence([{ label: 'search', search_clicks: 180 }])], jctx()).judgments.find((j) => j.rule === 'accessibility_content');
  const altBase = judge([ev('accessibility.img_alt_missing', '/a')], jctx()).judgments.find((j) => j.rule === 'accessibility_content');
  ok('confidence: unrelated judgments are NOT boosted (no invented corroboration)', alt.confidence === altBase.confidence);
}

// ═══ 4. reduce false positives — real activity contradicts "not live yet" ═══
{
  const notLiveOnly = judge([ev('website.not_live', '/'), ev('freshness.publish_stale', '/', { days: 300 })], jctx()).judgments;
  const snl = notLiveOnly.find((j) => j.rule === 'site_not_yet_live');
  ok('baseline: with no connected data, "site not live" stands', snl.status === 'active');

  const withTraffic = judge([ev('website.not_live', '/'), ev('freshness.publish_stale', '/', { days: 300 }), ...connectedEvidence([{ label: 'analytics', visitors: 400 }])], jctx()).judgments;
  const snl2 = withTraffic.find((j) => j.rule === 'site_not_yet_live');
  ok('suppress: real visitors PROVE the site is live → "not live" is suppressed as contradicted',
    snl2.status === 'suppressed' && snl2.suppression_reason === 'connected_contradicts');
  const fresh = withTraffic.find((j) => j.rule === 'public_freshness');
  ok('cascade: the false "not live" no longer suppresses valid public concerns (freshness surfaces)', fresh.status === 'active');
}

// ═══ 5. connected reputation — the one earned concern, edition-aware ═══
{
  const revEv = connectedEvidence([{ label: 'your Google listing', rating: 3.5, review_count: 60, unreplied_reviews: 4 }]);
  const jPresence = judge(revEv, jctx('presence')).judgments.find((j) => j.rule === 'connected_reputation');
  ok('reputation: a low rating + unreplied reviews becomes ONE active reputation task', jPresence.status === 'active' && jPresence.audience === 'customer');
  const jManaged = judge(revEv, jctx('presence_managed')).judgments.find((j) => j.rule === 'connected_reputation');
  ok('edition: on Managed the STUDIO owns reputation work (audience operator) — customer work drops', jManaged.audience === 'operator');
  const jMonitor = judge(revEv, jctx('presence_monitor')).judgments.find((j) => j.rule === 'connected_reputation');
  ok('monitor: the customer’s own reviews are applicable on Monitor (not suppressed)', jMonitor.status === 'active' && jMonitor.suppression_reason === '');
}

// ═══ 6. celebration flows the FULL pipeline (never a shortcut) ═══
{
  const improved = connectedEvidence([{ label: 'analytics', visitors: 500 }], [{ label: 'analytics', visitors: 300 }]);
  const jr = judgmentRows(improved).find((j) => j.rule === 'connected_improved');
  ok('celebration: measured improvement becomes an active customer judgment', !!jr && jr.status === 'active' && jr.audience === 'customer');
  const rr = recRows(improved).find((r) => r.rule === 'rec_connected_improved');
  ok('celebration: it survives to a recommendation (not floored as informational)', !!rr && rr.status === 'active');
  const m = active(pipeline(improved)).find((x) => x.deduplication_key === 'connected_win');
  ok('celebration: it lands as a calm CELEBRATION moment', !!m && m.moment_type === 'celebration' && m.tone === 'celebratory');
}

// ═══ 7. merge, never duplicate — several small connected+on-site concerns → ONE bundle ═══
{
  const mixed = [
    ...connectedEvidence([{ label: 'g', rating: 3.6, review_count: 20, unreplied_reviews: 3 }]),  // reputation
    ev('content.faqs_none', '/'), ev('content.updates_none', '/'), ev('content.description_thin', '/'), // content_depth
    ev('freshness.publish_stale', '/', { days: 120 }),                                            // freshness
  ];
  const a = active(pipeline(mixed));
  ok('merge: multiple mergeable concerns collapse into ONE improvements bundle (not many pings)',
    a.length <= 3 && a.some((m) => m.deduplication_key === 'improvements_bundle'), `active=${a.length}`);
  const bundle = a.find((m) => m.deduplication_key === 'improvements_bundle');
  ok('merge: the bundle carries the reputation task alongside the on-site ones (no duplicate rec)',
    !!bundle && bundle.supporting_recommendation_ids.length >= 3);
}

// ═══ 8. multi-provider harmony — GBP + Analytics + Search together, no conflict ═══
{
  const cur = [{ label: 'your Google listing', rating: 4.7, review_count: 130, unreplied_reviews: 0 }, { label: 'visitors', visitors: 620 }, { label: 'search', search_clicks: 410 }];
  const prev = [{ label: 'your Google listing', rating: 4.6, review_count: 128, unreplied_reviews: 0 }, { label: 'visitors', visitors: 500 }, { label: 'search', search_clicks: 300 }];
  const a = active(pipeline(connectedEvidence(cur, prev)));
  ok('multi-provider: a thriving business yields calm good news, no contradictory tasks',
    a.length >= 1 && a.length <= 3 && !a.some((m) => m.moment_type === 'needs_attention'), a.map((m) => m.moment_type).join(','));
}

// ═══ 9. additive safety + determinism — a connected-less run is unchanged ═══
{
  ok('additive: with no connected evidence, the intelligence pass is a no-op',
    deriveConnectedIntelligence([]).contradicts.size === 0 && deriveConnectedIntelligence([]).boosts.size === 0);
  const s = deriveSignals(connectedEvidence([{ label: 'a', visitors: 5 }, { label: 's', search_clicks: 9 }, { label: 'r', review_count: 3 }]));
  ok('signals: measured activity is read honestly (live + search + reviews present)', s.liveActivity && s.searchActive && s.reviewsPresent);
  const e = connectedEvidence([{ label: 'analytics', visitors: 500 }], [{ label: 'analytics', visitors: 300 }]);
  const r1 = JSON.stringify(judge(e, jctx()).judgments.map((j) => [j.rule, j.status, j.confidence]));
  const r2 = JSON.stringify(judge(e, jctx()).judgments.map((j) => [j.rule, j.status, j.confidence]));
  ok('determinism: same connected evidence in → byte-identical judgments out', r1 === r2);
}

// ═══ 10. concierge — speaks connected data naturally, no jargon ═══
{
  // a celebration moment: warm voice, whatever is asked
  const gWin = {
    businessName: 'Marlow’s', tone: 'celebratory',
    moments: [{ id: 'm1', key: 'connected_win', moment_type: 'celebration', headline: 'More people are finding you lately.', summary: 'One of your connected accounts is showing real improvement — more visits and kinder words from customers.', tone: 'celebratory', supporting_recommendation_ids: ['rc1'] }],
    recommendations: [{ hash: 'rc1', rule: 'rec_connected_improved', title: '', description: '', reason: '', expected_benefit: 'the business sees a channel doing better', estimated_effort: 'minutes', estimated_risk: 'none', undoability: 'not_applicable', action: 'monitor', timing: 'whenever', requires_ai: false, value_dimensions: ['reputation'], supporting_judgment_ids: [] }],
    judgments: [], evidence: [],
  };
  const winAns = answer({ question: 'what does this mean?', topicId: 'm1' }, gWin);
  ok('concierge: a connected win is celebrated warmly (verb celebrate)', winAns.verb === 'celebrate' && /real improvement/i.test(winAns.text) && /enjoy it/i.test(winAns.text));

  // a reputation task: how-to points to Connections, in plain words
  const gRep = {
    businessName: 'Marlow’s',
    moments: [{ id: 'm2', key: 'reviews_reply', moment_type: 'opportunity', headline: 'A few reviews are waiting for a reply.', summary: 'Some recent reviews haven’t been answered yet.', tone: 'encouraging', supporting_recommendation_ids: ['rc2'] }],
    recommendations: [{ hash: 'rc2', rule: 'rec_connected_reputation', title: '', description: '', reason: '', expected_benefit: 'replied-to reviews build trust', estimated_effort: 'minutes', estimated_risk: 'none', undoability: 'not_applicable', action: 'review', timing: 'whenever', requires_ai: false, value_dimensions: ['reputation'], supporting_judgment_ids: [] }],
    judgments: [], evidence: [],
  };
  const repAns = answer({ question: 'how do I fix this?', topicId: 'm2' }, gRep);
  ok('concierge: reputation how-to references the reviews and points to Connections', /review/i.test(repAns.text) && repAns.actions.some((a) => a.section === 'connections'));
  const denylist = /\b(SEO|schema|API|URL|OAuth|token|scope|rate limit|metric|analytics dashboard)\b|!/i;
  ok('concierge: connected answers carry no jargon, no alarm', !denylist.test(winAns.text) && !denylist.test(repAns.text));
}

// ═══ 11. integrity — templates + rec rules for the new connected rules ═══
{
  ok('integrity: connected_reputation + connected_improved each have a recommendation rule',
    REC_RULES.some((r) => r.judgmentRule === 'connected_reputation') && REC_RULES.some((r) => r.judgmentRule === 'connected_improved'));
  ok('integrity: each customer-capable connected rule has a moment template',
    TEMPLATES.some((t) => t.recRule === 'rec_connected_reputation') && TEMPLATES.some((t) => t.recRule === 'rec_connected_improved'));
  ok('integrity: connected_observed stays audience-none on every edition (observed, never an interruption)',
    ['presence_monitor', 'presence', 'presence_managed', 'agency', 'enterprise'].every((p) =>
      resolveRuleAudience(RULES.find((r) => r.key === 'connected_observed').audience, p) === 'none'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ CONNECTED INTELLIGENCE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }
