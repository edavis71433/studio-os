// ── Item 263: does the stock photo library answer? ───────────────────────────
// On Nov 9 2026 and again on Nov 21 every stock search on the live app failed because the
// provider refused the key, and nothing said so until a reviewer tried a search. The Health
// Center now asks the provider once (a one-photo search), remembers the answer for ten
// minutes so the watchdog's five-minute reads cost at most a few calls an hour, and shows a
// "Stock photos" line. The network call is the only impure line; `stockHealthWords` is pure.
import { StockProviderError, type StockProvider } from './contract.ts';
import { stockProvider } from './registry.ts';

export interface StockHealth { configured: boolean; answered: boolean | null; status: number; provider: string }

const REMEMBER_MS = 10 * 60_000;
let last: { at: number; result: StockHealth } | null = null;

export async function stockHealth(provider: StockProvider = stockProvider(), now = Date.now()): Promise<StockHealth> {
  if (!provider.available()) return { configured: false, answered: null, status: 0, provider: provider.name };
  if (last && last.result.provider === provider.name && now - last.at < REMEMBER_MS) return last.result;
  let result: StockHealth;
  try { await provider.search('coffee', 1); result = { configured: true, answered: true, status: 200, provider: provider.name }; }
  catch (e) { result = { configured: true, answered: false, status: e instanceof StockProviderError ? e.status : 0, provider: provider.name }; }
  last = { at: now, result };
  return result;
}

/** For tests: forget the remembered answer. */
export function forgetStockHealth(): void { last = null; }

/** The Health Center's state and sentence for the stock library. Pure. */
export function stockHealthWords(h: StockHealth | null | undefined): { state: 'ok' | 'attention' | 'off'; detail: string } {
  if (!h || !h.configured) return { state: 'off', detail: 'No stock photo key is set, so the photo search in the editor is off.' };
  if (h.answered) return { state: 'ok', detail: `${h.provider} answers, so stock photo searches work.` };
  if (h.status === 401 || h.status === 403) return { state: 'attention', detail: `${h.provider} is refusing the stock photo key, so every photo search in the editor fails. Make a new key at ${h.provider} and set PEXELS_API_KEY.` };
  if (h.status === 429) return { state: 'attention', detail: `${h.provider} is limiting searches just now, so photo searches may fail for a while.` };
  return { state: 'attention', detail: `${h.provider} isn’t answering${h.status ? ` (HTTP ${h.status})` : ''}, so photo searches fail.` };
}
