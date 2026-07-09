// ── Phase T · Stock Library — provider registry (FD-T10) ─────────────────────
// One place to pick the active provider, so the DEFAULT can be swapped (Pexels →
// Unsplash → a paid source) without touching the routes or the customer UI. The
// choice is env-driven (STOCK_PROVIDER); Pexels is the recommended default.
import type { StockProvider } from './contract.ts';
import { pexels } from './pexels.ts';

const PROVIDERS: Record<string, StockProvider> = { pexels };

export function stockProvider(): StockProvider {
  const chosen = (Deno.env.get('STOCK_PROVIDER') || 'pexels').toLowerCase();
  return PROVIDERS[chosen] || pexels;
}
