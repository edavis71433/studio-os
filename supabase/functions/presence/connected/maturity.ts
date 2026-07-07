// ── Provider Maturity Matrix (L4.5) — generated, never hand-kept ────────────
// Every connected provider's maturity, DERIVED from what is actually built:
// its normalizer (read), whether its reads feed Connected Intelligence, and
// whether it has an approval-gated write workflow. No new providers, no new
// capabilities — this only reports the truth the code already encodes, so the
// matrix can never drift from reality.
import { CONNECTED_PROVIDERS } from './providers.ts';
import { normalize } from './adapters.ts';
import { writeWorkflowsForProvider } from './writes.ts';

export type MaturityStage = 'planned' | 'read' | 'connected_intelligence' | 'approved_writes' | 'fully_mature';

// The normalized fields Connected Intelligence (L4.2) actually consumes.
const INTELLIGENCE_FIELDS = ['rating', 'review_count', 'unreplied_reviews', 'search_clicks', 'visitors'];

// A kitchen-sink raw response covering every key the normalizers read, so a
// probe reveals which providers produce real data (read) vs a label-only stub
// (planned). Deterministic — same input, same maturity, every run.
const SINK: Record<string, unknown> = {
  rating: 1, averageRating: 1, reviewCount: 1, totalReviewCount: 1, newReviews: 1, unreplied: 1,
  clicks: 1, impressions: 1, indexingIssues: 1, Clicks: 1, Impressions: 1,
  visitors: 1, pageviews: 1, stars: 1, numberOfReviews: 1,
  followers_count: 1, fan_count: 1, firstDegreeSize: 1, followerCount: 1,
  total: 1, totalSize: 1, total_items: 1,
  totals: { users: 1, screenPageViews: 1 }, score: { trustScore: 1 }, stats: { member_count: 1, open_rate: 1 },
  items: [{ statistics: { subscriberCount: 1, videoCount: 1 } }], collection: [{}], results: [{}],
  data: [{ attributes: { profile_count: 1 } }], posts: { data: [{}] }, media: { data: [{}] }, payments: [{}],
};

export interface ProviderMaturity {
  key: string; label: string; category: string;
  read: boolean; connected_intelligence: boolean; approved_writes: boolean;
  stage: MaturityStage;
}

export function providerMaturity(): ProviderMaturity[] {
  return CONNECTED_PROVIDERS.map((p) => {
    const norm = normalize(p.key, SINK, p.customerLabel) as Record<string, unknown>;
    const fields = Object.keys(norm).filter((k) => k !== 'label' && norm[k] !== undefined);
    const read = fields.length > 0;
    const intelligence = fields.some((f) => INTELLIGENCE_FIELDS.includes(f));
    const writes = writeWorkflowsForProvider(p.key).some((w) => w.kind === 'write');
    const stage: MaturityStage =
      writes && intelligence ? 'fully_mature'
      : writes ? 'approved_writes'
      : intelligence ? 'connected_intelligence'
      : read ? 'read'
      : 'planned';
    return { key: p.key, label: p.customerLabel, category: p.category, read, connected_intelligence: intelligence, approved_writes: writes, stage };
  });
}

export function maturitySummary(): Record<MaturityStage, number> {
  const out: Record<MaturityStage, number> = { planned: 0, read: 0, connected_intelligence: 0, approved_writes: 0, fully_mature: 0 };
  for (const m of providerMaturity()) out[m.stage]++;
  return out;
}
