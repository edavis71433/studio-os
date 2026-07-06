// ── Evidence Engine orchestration (M9.0) ────────────────────────────────────
// collect (I/O) → providers (pure) → store (append). The run record lists the
// providers that executed so ABSENCE of an item in later runs is meaningful —
// that is how improvement becomes provable (constitution 05 §10).
// This module never judges, never ranks, never talks to customers.
import { svc } from '../lib/db.ts';
import { collect } from './collect.ts';
import { PROVIDERS, runProviders } from './providers.ts';
import type { SiteRow } from '../lib/site.ts';

export interface RunSummary {
  ok: boolean;
  run_id: string | null;
  item_count: number;
  providers: Array<{ name: string; ok: boolean; items: number; error?: string }>;
  ms: number;
  error?: string;
}

export async function runEvidence(site: SiteRow, trigger: 'operator' | 'schedule' | 'publish'): Promise<RunSummary> {
  const t0 = Date.now();
  // open the run first: even a failed collection leaves an honest record
  const open = await svc('presence_evidence_runs?select=id', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, trigger }),
  });
  const runId: string | null = open.json?.[0]?.id ?? null;
  if (!runId) return { ok: false, run_id: null, item_count: 0, providers: [], ms: Date.now() - t0, error: 'run_insert_failed' };

  try {
    const input = await collect(site);
    const { items, record } = runProviders(input, PROVIDERS);

    if (items.length) {
      const rows = items.map((it) => ({
        run_id: runId, site_id: site.id,
        category: it.category, type: it.type, severity: it.severity, confidence: it.confidence,
        source: it.source, resource: it.resource, human: it.human, tech: it.tech,
        next_action: it.next_action, facts: it.facts, observed_at: it.observed_at, fingerprint: it.fingerprint,
      }));
      const ins = await svc('presence_evidence', {
        method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows),
      });
      if (!ins.ok) throw new Error(`evidence_insert_failed: ${ins.status}`);
    }

    await svc(`presence_evidence_runs?id=eq.${runId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        finished_at: new Date().toISOString(),
        providers: record, item_count: items.length,
        input: {
          live_fetched: !!input.liveFetch?.attempted,
          has_live_snapshot: !!input.live,
          filemap_from: input.fileMapFrom,
          page_count: input.pages.length,
          media_count: input.mediaRows.length,
        },
      }),
    });
    return { ok: true, run_id: runId, item_count: items.length, providers: record, ms: Date.now() - t0 };
  } catch (e) {
    const msg = (e as Error)?.message?.slice(0, 300) || 'run_failed';
    await svc(`presence_evidence_runs?id=eq.${runId}`, {
      method: 'PATCH', body: JSON.stringify({ finished_at: new Date().toISOString(), error_text: msg }),
    });
    return { ok: false, run_id: runId, item_count: 0, providers: [], ms: Date.now() - t0, error: msg };
  }
}
