// ── Recommendation Engine orchestration (M9.2) ──────────────────────────────
// load (I/O: the latest judgment batch + prior recommendation keys) →
// recommend (pure) → store (append batch). Consumes ONLY M9.1 judgments —
// never evidence, never websites, never a model, never a customer surface.
import { svc } from '../lib/db.ts';
import { recommend } from './rules.ts';
import type { JudgmentRow } from './contract.ts';
import type { SiteRow } from '../lib/site.ts';

export interface RecommendSummary {
  ok: boolean;
  batch_id: string | null;
  judgment_batch_id: string | null;
  recommended: number;
  active: number;
  suppressed: number;
  unconsumed_rules: string[];
  ms: number;
  error?: string;
}

export async function runRecommendation(site: SiteRow): Promise<RecommendSummary> {
  const t0 = Date.now();
  try {
    // 1. the latest judgment batch — the ONLY input source
    const latest = await svc(`presence_judgments?site_id=eq.${site.id}&select=batch_id,created_at&order=created_at.desc&limit=1`);
    const jb = latest.json?.[0]?.batch_id ?? null;
    if (!jb) return { ok: false, batch_id: null, judgment_batch_id: null, recommended: 0, active: 0, suppressed: 0, unconsumed_rules: [], ms: Date.now() - t0, error: 'no_judgment_batch' };

    const jQ = await svc(`presence_judgments?batch_id=eq.${jb}&select=judgment_hash,judgment_key,rule,category,priority,severity,confidence,reasoning,timing,audience,status,evidence_count,evidence_ids,first_seen_at,expires_at&limit=200`);
    const judgments: JudgmentRow[] = (jQ.json ?? []).map((j: JudgmentRow) => ({ ...j, confidence: Number(j.confidence) }));

    // 2. prior state per recommendation key
    const prevQ = await svc(`presence_recommendations?site_id=eq.${site.id}&select=recommendation_key,first_seen_at,created_at&order=created_at.desc&limit=200`);
    const previous: Record<string, { first_seen_at: string }> = {};
    for (const p of (prevQ.json ?? [])) if (!previous[p.recommendation_key]) previous[p.recommendation_key] = { first_seen_at: p.first_seen_at };

    // 3. the pure core
    const now = new Date().toISOString();
    const { recommendations, unconsumed_rules } = recommend(judgments, { siteId: site.id, now, previous });

    // 4. store the batch (suppressed included — auditable)
    const batchId = crypto.randomUUID();
    if (recommendations.length) {
      const rows = recommendations.map((r) => ({
        batch_id: batchId, site_id: site.id, judgment_batch_id: jb,
        recommendation_key: r.deduplication_key, recommendation_hash: r.recommendation_id, rule: r.rule,
        category: r.category, priority: r.priority, action: r.recommended_action,
        title: r.title, description: r.description, reason: r.reason, expected_benefit: r.expected_benefit,
        value_dimensions: r.value_dimensions, estimated_effort: r.estimated_effort, estimated_risk: r.estimated_risk,
        undoability: r.undoability, timing: r.timing, audience: r.audience,
        affected_resources: r.affected_resources, requires_ai: r.requires_ai,
        manual_available: r.manual_available, approval_required: r.approval_required,
        status: r.status, suppression_reason: r.suppression_reason,
        supporting_judgment_ids: r.supporting_judgment_ids,
        first_seen_at: r.first_seen_at, expires_at: r.expiration, created_at: r.timestamp,
      }));
      const ins = await svc('presence_recommendations', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
      if (!ins.ok) throw new Error(`recommendation_insert_failed: ${ins.status}`);
    }

    return {
      ok: true, batch_id: batchId, judgment_batch_id: jb,
      recommended: recommendations.length,
      active: recommendations.filter((r) => r.status === 'active').length,
      suppressed: recommendations.filter((r) => r.status === 'suppressed').length,
      unconsumed_rules, ms: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, batch_id: null, judgment_batch_id: null, recommended: 0, active: 0, suppressed: 0, unconsumed_rules: [], ms: Date.now() - t0, error: (e as Error)?.message?.slice(0, 300) || 'recommend_failed' };
  }
}
