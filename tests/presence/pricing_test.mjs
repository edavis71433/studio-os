// ── AI cost model (token → dollars) — pure ───────────────────────────────────
//   deno run --allow-read --allow-env tests/presence/pricing_test.mjs
import { estimateTextCostUsd, estimateUsageCostUsd, MODEL_PRICES, IMAGE_PRICE_PER_IMAGE } from '../../supabase/functions/presence/commerce/pricing.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const near = (a, b) => Math.abs(a - b) < 1e-6;

const HAIKU = 'claude-haiku-4-5-20251001';
ok('price table has the shipping Haiku model', !!MODEL_PRICES[HAIKU]);
ok('1M in + 1M out at listed Haiku price', near(estimateTextCostUsd(HAIKU, 1_000_000, 1_000_000), MODEL_PRICES[HAIKU].inputPerM + MODEL_PRICES[HAIKU].outputPerM));
ok('unlisted model → default text price (never NaN/undefined)', typeof estimateTextCostUsd('some-future-model', 500_000, 100_000) === 'number');
ok('zero tokens → zero cost', estimateTextCostUsd(HAIKU, 0, 0) === 0);
ok('output weighted higher than input (matches provider shape)', estimateTextCostUsd(HAIKU, 0, 1_000_000) > estimateTextCostUsd(HAIKU, 1_000_000, 0));

{
  const roll = estimateUsageCostUsd([{ input_tokens: 2_000_000, output_tokens: 1_000_000 }, { input_tokens: 0, output_tokens: 0, images: 3 }]);
  ok('rollup sums text tokens across rows', near(roll.text_usd, 2 * MODEL_PRICES[HAIKU].inputPerM + 1 * MODEL_PRICES[HAIKU].outputPerM));
  ok('rollup prices images separately', near(roll.image_usd, 3 * IMAGE_PRICE_PER_IMAGE));
  ok('rollup total = text + image', near(roll.total_usd, Math.round((roll.text_usd + roll.image_usd) * 100) / 100));
  ok('empty rollup → zero', estimateUsageCostUsd([]).total_usd === 0);
  ok('missing/null token fields treated as zero (no NaN)', !Number.isNaN(estimateUsageCostUsd([{ input_tokens: null, output_tokens: undefined }]).total_usd));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ AI PRICING: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
