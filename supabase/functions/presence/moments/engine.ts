// ── Business Moments orchestration (M9.3) ───────────────────────────────────
// load (I/O: latest recommendation batch + prior moment keys + dismissal
// memory) → momentize (pure) → supersede the previous active set → store.
// Consumes ONLY M9.2 recommendations. No AI, no chat, no concierge — moments
// are written; the concierge that carries them is M9.4.
import { svc } from '../lib/db.ts';
import { momentize, DISMISSAL_TTL_DAYS } from './rules.ts';
import type { RecRow, MomentContext } from './rules.ts';
import type { SiteRow } from '../lib/site.ts';

export interface MomentsSummary {
  ok: boolean;
  batch_id: string | null;
  recommendation_batch_id: string | null;
  active: number;
  suppressed: number;
  deferred: string[];
  untranslated_rules: string[];
  ms: number;
  error?: string;
}

export async function runMoments(site: SiteRow): Promise<MomentsSummary> {
  const t0 = Date.now();
  try {
    // 1. the latest recommendation batch — the ONLY input source
    const latest = await svc(`presence_recommendations?site_id=eq.${site.id}&select=batch_id&order=created_at.desc&limit=1`);
    const rb = latest.json?.[0]?.batch_id ?? null;
    if (!rb) return { ok: false, batch_id: null, recommendation_batch_id: null, active: 0, suppressed: 0, deferred: [], untranslated_rules: [], ms: Date.now() - t0, error: 'no_recommendation_batch' };

    const rQ = await svc(`presence_recommendations?batch_id=eq.${rb}&select=recommendation_hash,rule,priority,audience,status,value_dimensions,timing,expires_at&limit=200`);
    const recs: RecRow[] = rQ.json ?? [];

    // 2. memory: prior first_seen per key + the freshest dismissal per key (within TTL window)
    const prevQ = await svc(`presence_moments?site_id=eq.${site.id}&select=moment_key,moment_hash,importance,first_seen_at,status,dismissed_at,created_at&order=created_at.desc&limit=300`);
    const previous: MomentContext['previous'] = {};
    const dismissals: MomentContext['dismissals'] = {};
    const now = new Date().toISOString();
    for (const p of (prevQ.json ?? [])) {
      if (!previous[p.moment_key]) previous[p.moment_key] = { first_seen_at: p.first_seen_at };
      if (p.status === 'dismissed' && p.dismissed_at && !dismissals[p.moment_key]) {
        const ageDays = (new Date(now).getTime() - new Date(p.dismissed_at).getTime()) / 86400000;
        if (ageDays < DISMISSAL_TTL_DAYS) dismissals[p.moment_key] = { moment_hash: p.moment_hash, importance: p.importance, dismissed_at: p.dismissed_at };
      }
    }

    // 3. the pure core
    const result = momentize(recs, { siteId: site.id, now, previous, dismissals });

    // 4. supersede the previous active set, then store the new batch
    await svc(`presence_moments?site_id=eq.${site.id}&status=eq.active`, {
      method: 'PATCH', body: JSON.stringify({ status: 'superseded' }),
    });
    const batchId = crypto.randomUUID();
    if (result.moments.length) {
      const rows = result.moments.map((m) => ({
        batch_id: batchId, site_id: site.id, recommendation_batch_id: rb,
        moment_key: m.deduplication_key, moment_hash: m.moment_id,
        moment_type: m.moment_type, headline: m.headline, summary: m.summary, tone: m.tone,
        importance: m.importance, dismissable: m.dismissable,
        supporting_recommendation_ids: m.supporting_recommendation_ids,
        future_follow_up: m.future_follow_up, first_seen_at: m.first_seen_at,
        expires_at: m.expires_at, status: m.status, suppression_reason: m.suppression_reason,
        created_at: m.timestamp,
      }));
      const ins = await svc('presence_moments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
      if (!ins.ok) throw new Error(`moment_insert_failed: ${ins.status}`);
    }

    return {
      ok: true, batch_id: batchId, recommendation_batch_id: rb,
      active: result.moments.filter((m) => m.status === 'active').length,
      suppressed: result.moments.filter((m) => m.status === 'suppressed').length,
      deferred: result.deferred, untranslated_rules: result.untranslated_rules,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, batch_id: null, recommendation_batch_id: null, active: 0, suppressed: 0, deferred: [], untranslated_rules: [], ms: Date.now() - t0, error: (e as Error)?.message?.slice(0, 300) || 'moments_failed' };
  }
}

/** Client dismissal — the outcome IS the memory (mirrors notes semantics). */
export async function dismissMoment(siteId: string, momentId: string): Promise<{ ok: boolean; error?: string }> {
  const r = await svc(`presence_moments?id=eq.${momentId}&site_id=eq.${siteId}&status=eq.active&dismissable=is.true`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'dismissed', dismissed_at: new Date().toISOString() }),
  });
  if (!r.ok || !Array.isArray(r.json) || !r.json.length) return { ok: false, error: 'not_found' };
  return { ok: true };
}
