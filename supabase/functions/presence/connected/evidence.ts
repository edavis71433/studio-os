// ── Connected data → Evidence (L4.1) ────────────────────────────────────────
// The bridge that makes connected data flow through the ONE pipeline, never
// around it: normalized read-cache → evidence → judgment → …. This is a pure
// evidence provider (no I/O — the I/O is the adapter read + the collector); it
// reads `input.connected` and emits measured observations, nothing more. Like
// every optimization observation before it, connected evidence is recorded and
// (for now) judged-but-suppressed: turning it into customer moments is a
// deliberate later step (L4.2), never a side effect of connecting a service.
import type { Provider } from '../evidence/providers.ts';
import type { Category, Severity } from '../evidence/contract.ts';
import type { NormalizedConnected } from './adapters.ts';

type Facts = Record<string, string | number | boolean>;
interface CatalogEntry { category: Category; severity: Severity; confidence: number; next_action: string; human: (f: Facts) => string; tech: (f: Facts) => string; }
const s = (v: unknown) => String(v ?? '');

// Connected evidence types — additive catalog entries, merged into the one
// CATALOG (evidence/contract.ts). All reuse EXISTING categories (no new category,
// no migration): reviews / seo / analytics.
// Types are category-prefixed (the catalog convention); the CONNECTED provenance
// is carried by the emitting provider ('connected@…' in the evidence source).
export const CONNECTED_CATALOG: Record<string, CatalogEntry> = {
  'reviews.connected_summary': { category: 'reviews', severity: 'info', confidence: 1,
    next_action: 'None — an observation of your review standing.',
    human: (f) => `${s(f.label)}: ${s(f.count)} reviews${f.rating ? `, ${s(f.rating)} stars` : ''}.`,
    tech: (f) => `connected read: review_count=${s(f.count)} rating=${s(f.rating)} (${s(f.label)}).` },
  'reviews.connected_rating_low': { category: 'reviews', severity: 'warning', confidence: 0.9,
    next_action: 'Look at recent reviews and consider replying.',
    human: (f) => `${s(f.label)} is sitting at ${s(f.rating)} stars — worth a look at what recent customers said.`,
    tech: (f) => `connected: rating ${s(f.rating)} < 4.0 (${s(f.label)}).` },
  'reviews.connected_unreplied': { category: 'reviews', severity: 'info', confidence: 0.9,
    next_action: 'Reply to the waiting reviews on the provider.',
    human: (f) => `You have ${s(f.count)} review${Number(f.count) === 1 ? '' : 's'} on ${s(f.label)} waiting for a reply.`,
    tech: (f) => `connected: ${s(f.count)} unreplied reviews (${s(f.label)}).` },
  'seo.connected_search': { category: 'seo', severity: 'info', confidence: 1,
    next_action: 'None — an observation of your search visibility.',
    human: (f) => `${s(f.clicks)} people reached you from search recently (${s(f.label)}).`,
    tech: (f) => `connected read: search_clicks=${s(f.clicks)} (${s(f.label)}).` },
  'analytics.connected_traffic': { category: 'analytics', severity: 'info', confidence: 1,
    next_action: 'None — an observation of your visitor numbers.',
    human: (f) => `${s(f.visitors)} people visited your site recently (${s(f.label)}).`,
    tech: (f) => `connected read: visitors=${s(f.visitors)} (${s(f.label)}).` },
};

export const CONNECTED_EVIDENCE_TYPES = Object.keys(CONNECTED_CATALOG);

export const connectedProvider: Provider = {
  name: 'connected',
  provide(i, emit) {
    const rows: NormalizedConnected[] = (i as any).connected || [];
    for (const c of rows) {
      if (!c || !c.label) continue;
      if (typeof c.rating === 'number' && c.rating < 4.0) emit('reviews.connected_rating_low', 'connected', c.label, { label: c.label, rating: c.rating });
      if (typeof c.unreplied_reviews === 'number' && c.unreplied_reviews > 0) emit('reviews.connected_unreplied', 'connected', c.label, { label: c.label, count: c.unreplied_reviews });
      if (typeof c.review_count === 'number') emit('reviews.connected_summary', 'connected', c.label, { label: c.label, count: c.review_count, rating: c.rating ?? '' });
      if (typeof c.search_clicks === 'number') emit('seo.connected_search', 'connected', c.label, { label: c.label, clicks: c.search_clicks });
      if (typeof c.visitors === 'number') emit('analytics.connected_traffic', 'connected', c.label, { label: c.label, visitors: c.visitors });
    }
  },
};
