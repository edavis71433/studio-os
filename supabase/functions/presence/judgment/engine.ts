// ── Judgment Engine orchestration (M9.1) ────────────────────────────────────
// load (I/O: the latest finished evidence run + prior judgment keys) →
// judge (pure) → store (append batch). Consumes ONLY M9.0 evidence rows —
// this module never inspects a website, never creates observations, never
// speaks to a customer, never calls a model.
import { svc } from '../lib/db.ts';
import { judge } from './rules.ts';
import type { EvidenceRow } from './contract.ts';
import type { SiteRow } from '../lib/site.ts';

export interface JudgeSummary {
  ok: boolean;
  batch_id: string | null;
  evidence_run_id: string | null;
  judged: number;
  active: number;
  suppressed: number;
  unmatched_types: string[];
  ms: number;
  error?: string;
}

export async function runJudgment(site: SiteRow): Promise<JudgeSummary> {
  const t0 = Date.now();
  try {
    // 1. the latest finished, error-free evidence run — the ONLY input source
    const runQ = await svc(`presence_evidence_runs?site_id=eq.${site.id}&finished_at=not.is.null&error_text=is.null&select=id,started_at&order=started_at.desc&limit=1`);
    const run = runQ.json?.[0];
    if (!run) return { ok: false, batch_id: null, evidence_run_id: null, judged: 0, active: 0, suppressed: 0, unmatched_types: [], ms: Date.now() - t0, error: 'no_evidence_run' };

    const evQ = await svc(`presence_evidence?run_id=eq.${run.id}&select=id,category,type,severity,confidence,resource,facts&order=type.asc,resource.asc&limit=1000`);
    const evidence: EvidenceRow[] = (evQ.json ?? []).map((e: EvidenceRow) => ({ ...e, confidence: Number(e.confidence) }));

    // 2. prior state: first_seen carries across batches per judgment_key
    const prevQ = await svc(`presence_judgments?site_id=eq.${site.id}&select=judgment_key,first_seen_at,created_at&order=created_at.desc&limit=200`);
    const previous: Record<string, { first_seen_at: string }> = {};
    for (const p of (prevQ.json ?? [])) if (!previous[p.judgment_key]) previous[p.judgment_key] = { first_seen_at: p.first_seen_at };

    // 3. the pure core. L3.1: the plan (edition) shifts audience — load it once;
    //    a Monitor site is presence_monitor, everything else reads its entitlement.
    const planQ = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(site.client_id)}&product=eq.presence&select=plan&limit=1`);
    const plan = (planQ.ok && Array.isArray(planQ.json) && planQ.json.length ? String(planQ.json[0].plan) : null) || (site.edition === 'monitor' ? 'presence_monitor' : 'presence');
    const now = new Date().toISOString();
    const { judgments, unmatched_types } = judge(evidence, { siteId: site.id, now, previous, plan });

    // 4. store the batch (suppressed included — suppression is auditable)
    const batchId = crypto.randomUUID();
    if (judgments.length) {
      const rows = judgments.map((j) => ({
        batch_id: batchId, site_id: site.id, evidence_run_id: run.id,
        judgment_key: j.dedupe_key, judgment_hash: j.judgment_id, rule: j.rule,
        category: j.category, priority: j.priority, severity: j.severity, confidence: j.confidence,
        reasoning: j.reasoning, business_impact: j.business_impact, customer_impact: j.customer_impact,
        timing: j.timing, audience: j.audience, status: j.status, suppression_reason: j.suppression_reason,
        evidence_ids: j.evidence_ids, evidence_count: j.evidence_count,
        dedupe_key: j.dedupe_key, first_seen_at: j.first_seen_at, expires_at: j.expires_at, created_at: j.timestamp,
      }));
      const ins = await svc('presence_judgments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
      if (!ins.ok) throw new Error(`judgment_insert_failed: ${ins.status}`);
    }

    return {
      ok: true, batch_id: batchId, evidence_run_id: run.id,
      judged: judgments.length,
      active: judgments.filter((j) => j.status === 'active').length,
      suppressed: judgments.filter((j) => j.status === 'suppressed').length,
      unmatched_types, ms: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, batch_id: null, evidence_run_id: null, judged: 0, active: 0, suppressed: 0, unmatched_types: [], ms: Date.now() - t0, error: (e as Error)?.message?.slice(0, 300) || 'judge_failed' };
  }
}
