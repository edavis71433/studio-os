// ── L3.1 Optimization Judgment Depth suite ──────────────────────────────────
// Verifies the promotion of optimization evidence into customer-facing
// intelligence obeys the Optimization Promotion Constitution: every optimization
// type is classified into exactly one business-task rule; audience follows
// ownership and shifts by edition (interruptions decrease up the ladder; Monitor
// flips toward the customer); silent stays silent; no jargon; no scores.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/optimization_judgment_test.mjs
import { judge, RULES, resolveRuleAudience, LADDER_PLANS } from '../../supabase/functions/presence/judgment/rules.ts';
import { REC_RULES } from '../../supabase/functions/presence/recommendation/rules.ts';
import { TEMPLATES } from '../../supabase/functions/presence/moments/rules.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const OPT_RULE_KEYS = ['opt_ai_search', 'opt_details_everywhere', 'opt_menu_reconcile', 'opt_photos', 'opt_story', 'opt_search_hygiene', 'opt_technical_access', 'opt_speed', 'opt_foundations', 'opt_dormant']; // opt_reputation removed in L3.4
const ruleByKey = new Map(RULES.map((r) => [r.key, r]));
const OPT_TYPES = OPT_RULE_KEYS.flatMap((k) => ruleByKey.get(k).types);

// ═══ 1. classification: every optimization type in exactly one rule, none suppressed-as-roadmap ═══
{
  const owners = (t) => RULES.filter((r) => r.types.includes(t)).map((r) => r.key);
  const multi = OPT_TYPES.filter((t) => owners(t).length !== 1);
  ok('classification: every optimization observation belongs to exactly one rule', multi.length === 0, multi.map((t) => `${t}→[${owners(t)}]`).join(', '));
  const roadmap = ruleByKey.get('platform_roadmap');
  ok('classification: no optimization type is parked on platform_roadmap anymore', OPT_TYPES.every((t) => !roadmap.types.includes(t)));
  ok('classification: 40+ optimization observations collapse to ~11 business-task rules (grouping, not one-per)', OPT_TYPES.length >= 38 && OPT_RULE_KEYS.length <= 12, `${OPT_TYPES.length} types → ${OPT_RULE_KEYS.length} rules`);
}

// ═══ 2. edition matrix: same evidence, audience shifts by plan ═══
let _id = 0;
const ev = (type, sev = 'warning', conf = 0.95) => ({ id: `e${++_id}`, category: type.split('.')[0], type, severity: sev, confidence: conf, resource: `r${_id}`, facts: {} });
// one representative observation per optimization rule
const EVIDENCE = [
  ev('aeo.answers_thin'),                         // opt_ai_search (optimization)
  ev('local_presence.nap_inconsistent'),          // opt_details_everywhere (knowledge)
  ev('knowledge.price_mismatch'),                 // opt_menu_reconcile (knowledge)
  ev('media.imagery_none'),                       // opt_photos (knowledge)
  ev('reviews.velocity_slowing', 'info'),         // opt_dormant now (L3.4 cut — suppressed)
  ev('trust.team_info_missing', 'info'),          // opt_story (knowledge)
  ev('seo.noindex'),                              // opt_search_hygiene (platform)
  ev('accessibility.form_label_missing'),         // opt_technical_access (platform)
  ev('performance.slow_response'),                // opt_speed (platform)
  ev('infrastructure.dmarc_missing'),             // opt_foundations (infra)
  ev('analytics.not_connected', 'info'),          // opt_dormant (dormant)
];
const judgeFor = (plan) => {
  const { judgments } = judge(EVIDENCE, { siteId: 's', now: '2027-01-20T00:00:00Z', previous: {}, plan });
  return new Map(judgments.map((j) => [j.rule, j]));
};
const aud = (m, key) => m.get(key)?.audience;

{
  const M = judgeFor('presence_monitor'), P = judgeFor('presence'), G = judgeFor('presence_managed');

  // Presence: platform silent, infra operator, knowledge/optimization customer
  ok('Presence: platform-owned stays silent (audience none)', aud(P, 'opt_search_hygiene') === 'none' && aud(P, 'opt_technical_access') === 'none' && aud(P, 'opt_speed') === 'none');
  ok('Presence: infrastructure is operator work (never a raw customer alarm)', aud(P, 'opt_foundations') === 'operator');
  ok('Presence: customer-owned business tasks reach the customer', aud(P, 'opt_menu_reconcile') === 'customer' && aud(P, 'opt_details_everywhere') === 'customer' && aud(P, 'opt_ai_search') === 'customer');

  // Monitor: the same evidence flips toward the customer (migration evidence)
  ok('Monitor: platform + infra evidence becomes customer-facing (migration signal)',
    aud(M, 'opt_search_hygiene') === 'customer' && aud(M, 'opt_technical_access') === 'customer' && aud(M, 'opt_speed') === 'customer' && aud(M, 'opt_foundations') === 'customer');

  // Managed+: optimization work moves to the operator (concierge); knowledge stays customer
  ok('Managed: the studio takes the optimization work; only true business knowledge reaches the customer',
    aud(G, 'opt_ai_search') === 'operator' && aud(G, 'opt_menu_reconcile') === 'customer' && aud(G, 'opt_search_hygiene') === 'none');

  // dormant never reaches anyone
  ok('dormant: never anyone, any edition', aud(M, 'opt_dormant') === 'none' && aud(P, 'opt_dormant') === 'none' && aud(G, 'opt_dormant') === 'none');

  // THE LADDER LAW: customer interruptions decrease as Studio OS owns more
  const customerCount = (m) => [...m.values()].filter((j) => j.audience === 'customer' && j.status === 'active').length;
  const cM = customerCount(M), cP = customerCount(P), cG = customerCount(G);
  ok('the ladder: customer interruptions DECREASE up the ladder (Monitor ≥ Presence ≥ Managed; Monitor > Managed)',
    cM >= cP && cP >= cG && cM > cG, `monitor=${cM} presence=${cP} managed=${cG}`);
}

// ═══ 3. silence stays silent; suppression is honest ═══
{
  const P = judgeFor('presence');
  ok('silent: platform rules are recorded but suppressed (auditable, not deleted)',
    ['opt_search_hygiene', 'opt_technical_access', 'opt_speed'].every((k) => P.get(k)?.status === 'suppressed' && P.get(k)?.suppression_reason === 'no_audience'));
  ok('silent: dormant suppressed too', judgeFor('presence').get('opt_dormant')?.status === 'suppressed');
}

// ═══ 4. no jargon, no scores in any customer-facing template ═══
{
  const optTemplates = TEMPLATES.filter((t) => t.recRule.startsWith('rec_opt_'));
  ok('coverage: every customer-capable optimization rule has a moment template (9 after L3.4 cut)', optTemplates.length === 9, `${optTemplates.length}`);
  const denylist = /\b(SEO|schema|metadata|canonical|HTML|CSS|API|URL|DNS|CDN|DMARC|SPF|CAA|robots|sitemap|WCAG|ARIA|score|grade|percent|rating|ranking)\b|!|%|\d+\s*\/\s*\d+/i;
  const blame = /\b(you failed|you forgot|you should have|your fault|neglect)\b/i;
  const offenders = optTemplates.filter((t) => denylist.test(t.headline) || denylist.test(t.summary) || denylist.test(t.bundleWord) || blame.test(t.headline) || blame.test(t.summary));
  ok('language: optimization moments carry no jargon, no scores, no blame, no alarm', offenders.length === 0, offenders.map((t) => t.recRule).join(','));
  ok('language: recommendations expose no score/grade/percentage anywhere', REC_RULES.filter((r) => r.judgmentRule.startsWith('opt_')).every((r) => !/\b(score|grade|percent|rating|ranking)\b|%/i.test(r.title + ' ' + r.expected_benefit)));
}

// ═══ 5. determinism ═══
{
  const a = JSON.stringify(judgeFor('presence').get('opt_menu_reconcile'));
  const b = JSON.stringify(judgeFor('presence').get('opt_menu_reconcile'));
  ok('determinism: same evidence + plan → identical judgment', a === b);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }
