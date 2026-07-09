// ── AI cost model — token → dollars (operator/governance only) ───────────────
// The platform meters op-counts + raw tokens (presence_ai_usage); this turns that
// into an estimated dollar figure so spend is legible. OPERATOR-ONLY — a customer
// never sees tokens or cost (Law 13). Prices are provider rates and WILL drift;
// keep this table in sync with the provider's pricing page (or move to env later).
// Figures are USD per 1,000,000 tokens unless noted.

export interface ModelPrice { inputPerM: number; outputPerM: number; }

// Verify against the provider's current pricing before relying on the totals.
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-haiku-4-5-20251001': { inputPerM: 1.00, outputPerM: 5.00 },
};
export const DEFAULT_TEXT_PRICE: ModelPrice = { inputPerM: 1.00, outputPerM: 5.00 }; // fallback for an unlisted text model
export const IMAGE_PRICE_PER_IMAGE = 0.04;  // gpt-image-1 default-size estimate; verify per size/quality.

/** Estimated USD for one metered text call. Pure. */
export function estimateTextCostUsd(model: string | null, inputTokens: number, outputTokens: number): number {
  const p = (model && MODEL_PRICES[model]) || DEFAULT_TEXT_PRICE;
  const cost = (inputTokens / 1_000_000) * p.inputPerM + (outputTokens / 1_000_000) * p.outputPerM;
  return Math.round(cost * 10_000) / 10_000; // 4dp (fractions of a cent)
}

export interface UsageRollup { model?: string | null; input_tokens?: number | null; output_tokens?: number | null; generative_ops?: number | null; assistive_ops?: number | null; images?: number | null; }

/** Estimate USD across a set of usage rollup rows (e.g. one client's period, or all
 *  clients this month). Text via token price; images via per-image estimate. Pure. */
export function estimateUsageCostUsd(rows: UsageRollup[]): { text_usd: number; image_usd: number; total_usd: number } {
  let text = 0, image = 0;
  for (const r of rows) {
    text += estimateTextCostUsd(r.model ?? null, Number(r.input_tokens || 0), Number(r.output_tokens || 0));
    image += Number(r.images || 0) * IMAGE_PRICE_PER_IMAGE;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { text_usd: round(text), image_usd: round(image), total_usd: round(text + image) };
}
