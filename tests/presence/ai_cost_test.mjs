// ── AI cost control — pure (P2-E W1) ─────────────────────────────────────────
//   deno run --allow-read tests/presence/ai_cost_test.mjs
import { classifyAgent, hardCeilingUsd, generativeAllowance } from '../../supabase/functions/presence/commerce/capacity.ts';
import { estimateUsageCostUsd, estimateTextCostUsd, IMAGE_PRICE_PER_IMAGE } from '../../supabase/functions/presence/commerce/pricing.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

// classification (F3): visual is generative, not the uncapped analysis class
ok('classify: visual is GENERATIVE (was misclassified as analysis)', classifyAgent('visual') === 'generative');
ok('classify: writer/coach generative; editor/concierge assistive; reviewer analysis', classifyAgent('writer') === 'generative' && classifyAgent('coach') === 'generative' && classifyAgent('concierge') === 'assistive' && classifyAgent('reviewer') === 'analysis');

// hard ceilings per plan
ok('ceiling: paid self-serve plans have a hard USD ceiling', hardCeilingUsd('presence') > 0 && hardCeilingUsd('cms_only') > 0 && hardCeilingUsd('business_os_only') > 0 && hardCeilingUsd('presence_monitor') > 0);
ok('ceiling: pooled-by-contract plans have NO ceiling (null)', hardCeilingUsd('presence_managed') === null && hardCeilingUsd('agency') === null && hardCeilingUsd('enterprise') === null);

// image cost is now real (F1): images must NOT be $0 when present
ok('cost: image spend is non-zero when images present', estimateUsageCostUsd([{ images: 10 }]).image_usd === Math.round(10 * IMAGE_PRICE_PER_IMAGE * 100) / 100 && estimateUsageCostUsd([{ images: 10 }]).image_usd > 0);
ok('cost: total includes text + image', (() => { const c = estimateUsageCostUsd([{ input_tokens: 1_000_000, output_tokens: 1_000_000, images: 5 }]); return c.text_usd > 0 && c.image_usd > 0 && Math.abs(c.total_usd - (c.text_usd + c.image_usd)) < 0.001; })());
ok('cost: zero usage is $0 (no divide/NaN)', estimateUsageCostUsd([{}]).total_usd === 0 && estimateTextCostUsd(null, 0, 0) === 0);

// a realistic ceiling breach: enough images to exceed a plan ceiling
ok('ceiling breach: N images can exceed the business_os ceiling', (estimateUsageCostUsd([{ images: 300 }]).total_usd) >= hardCeilingUsd('business_os_only'));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ AI COST CONTROL (P2-E W1 pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
