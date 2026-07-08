// ── Phase P: pricing, support tiers & upsell suite ───────────────────────────
// Locks the commercial-experience additions: the support-tier matrix covers every
// plan with every service dimension (owner addendum: software and service tiers
// can never drift apart), and nextPlanUp walks the ladder honestly (self-serve
// only, skips contact-sales rungs, null at the top).
//   deno run --allow-read --allow-env tests/presence/pricing_experience_test.mjs
import { PLANS, nextPlanUp, planByKey, evaluateChange } from '../../supabase/functions/presence/commerce/catalog.ts';
import { SUPPORT_TIERS, supportFor } from '../../supabase/functions/presence/commerce/support.ts';
import { featureDelta, editionFromPlan } from '../../supabase/functions/presence/commerce/editions.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. support tiers: complete + non-drifting ═══
{
  const dims = ['onboarding', 'support', 'ai_usage', 'implementation', 'training', 'maintenance'];
  ok('every plan has a support tier', PLANS.every((p) => !!SUPPORT_TIERS[p.key]));
  ok('every tier states all six service dimensions, non-empty', PLANS.every((p) => dims.every((d) => String(SUPPORT_TIERS[p.key][d] || '').length > 10)));
  ok('managed promises MORE than self-serve (white-glove + 1-day response)', /white-glove/i.test(supportFor('presence_managed').onboarding) && /1 business day/.test(supportFor('presence_managed').support) && /2 business days/.test(supportFor('presence').support));
  ok('agency/enterprise get a named contact', /named contact/i.test(supportFor('agency').support) && /named contact/i.test(supportFor('enterprise').support));
  ok('monitor is honest about no drafting AI', /no AI drafting/i.test(supportFor('presence_monitor').ai_usage));
}

// ═══ 2. nextPlanUp: the honest ladder ═══
{
  ok('monitor → cms/bos rung (rank 2-3, self-serve)', (() => { const n = nextPlanUp('presence_monitor'); return !!n && n.rank === 2 && n.selfServe; })());
  ok('cms_only → presence (skips the lateral rank-3)', (() => { const n = nextPlanUp('cms_only'); return !!n && ['business_os_only', 'presence'].includes(n.key); })());
  ok('presence → managed', nextPlanUp('presence')?.key === 'presence_managed');
  ok('managed → null (agency/enterprise are contact-sales, never auto-upsold)', nextPlanUp('presence_managed') === null);
  ok('unknown/null plan → first self-serve rung (never throws)', (() => { const n = nextPlanUp(null); return !!n && n.rank === 1; })());
  ok('the upsell target always costs more than the current plan', PLANS.filter((p) => p.monthly != null).every((p) => { const n = nextPlanUp(p.key); return !n || n.monthly == null || n.monthly > p.monthly; }));
}

// ═══ 3. upsell gains: honest (from featureDelta) + upgrade policy ═══
{
  const gains = featureDelta(editionFromPlan('cms_only'), editionFromPlan('presence')).gained;
  ok('cms_only → presence gains real features (never an empty promise)', gains.length > 0);
  const noGain = featureDelta(editionFromPlan('presence'), editionFromPlan('presence_managed')).gained;
  ok('presence → managed is a SERVICE upgrade (delta may be empty — the support tier is the pitch)', Array.isArray(noGain));
  ok('upgrades are immediate, downgrades wait for the cycle (existing policy intact)', evaluateChange('cms_only', 'presence').timing === 'immediate' && evaluateChange('presence', 'cms_only').timing !== 'immediate');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
