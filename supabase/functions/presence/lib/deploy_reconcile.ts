// ── Deploy reconcile + robustness (Presence CMS Phase 1, M5) ─────────────────
// Recovery for in-flight publishes, the global concurrent-deploy ceiling, and
// the shared tunables. NO second pipeline, NO queue — this only READS Netlify's
// authoritative deploy state and finalizes the existing publish record. It never
// re-deploys, so it can run repeatedly (idempotent) from both the GET /publishes
// lazy path and the cron.
import { svc } from './db.ts';
import { deployState } from './netlify.ts';

// ── tunables (configurable; sensible defaults) ──
export const DEPLOY_POLL_MS = Number(Deno.env.get('DEPLOY_POLL_MS')) || 30_000;   // in-request poll bound (netlify.ts)
export const DEFAULT_DEPLOY_CEILING = 8;                                          // global simultaneous Netlify deploys
export const RECONCILE_STALE_MS = 90_000;      // in-flight this long past creation → reconcile it (past the 30s poll)
export const ABANDON_MS = 15 * 60_000;         // in-flight with NO deploy id this long → interrupted before deploy → fail

// ── pure decision helpers (unit-testable) ──
export function deployCeiling(): number {
  const n = Number(Deno.env.get('MAX_CONCURRENT_DEPLOYS'));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DEPLOY_CEILING;
}
export function deployCeilingExceeded(deployingCount: number, ceiling: number): boolean {
  return deployingCount >= ceiling;
}
/** Map Netlify's deploy state to the terminal publish outcome. Pure. */
export function deployStateOutcome(state: string | null): 'live' | 'failed' | 'pending' {
  return state === 'ready' ? 'live' : state === 'error' ? 'failed' : 'pending';
}
export function ageMs(createdAt: string | null | undefined, nowMs: number): number {
  if (!createdAt) return 0;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? nowMs - t : 0;
}

// ── I/O: resolve ONE in-flight publish against Netlify's authoritative state.
//    Only reads state + finalizes the record — NEVER re-deploys. Idempotent. ──
export interface InflightPublish { id: string; site_id: string; netlify_deploy_id: string | null; created_at: string | null }

export async function reconcileOnePublish(p: InflightPublish, nowMs: number): Promise<'live' | 'failed' | 'pending' | 'abandoned'> {
  const nowIso = new Date(nowMs).toISOString();
  if (!p.netlify_deploy_id) {
    // never reached the deploy stage. If it's ancient, the publish was interrupted
    // before deploying — fail it so it stops holding the per-site one-in-flight gate.
    if (ageMs(p.created_at, nowMs) >= ABANDON_MS) {
      await svc(`presence_publishes?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error_text: 'interrupted before deploy (reconciled)', completed_at: nowIso }) });
      return 'abandoned';
    }
    return 'pending';
  }
  const outcome = deployStateOutcome(await deployState(p.netlify_deploy_id));
  if (outcome === 'live') {
    await svc(`presence_publishes?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'live', completed_at: nowIso }) });
    await svc(`presence_sites?id=eq.${p.site_id}`, { method: 'PATCH', body: JSON.stringify({ status: 'live', last_published_at: nowIso }) });
    // The OTHER door to "live" — an async deploy that finished after the request
    // returned. The checklist's "Site live" step must tick from both, or a slow
    // deploy silently costs the studio 10%. Same idempotent tick as routes/publish.ts;
    // dynamic import keeps this leaf module import-cycle-free. A FRESH tick
    // (true = the step just transitioned) also sends the client their "your
    // website is live" email — same send-once gate as routes/publish.ts, so
    // whichever door reaches "live" first sends it, and only that door.
    await import('./service_bridge.ts').then(async (m) => {
      const fresh = await m.tickChecklistForCustomerSite(String(p.site_id), 'site_live', 'publish-reconcile', 'system');
      if (fresh) await m.emailCustomerSiteLive(String(p.site_id));
    }).catch(() => false);
  } else if (outcome === 'failed') {
    await svc(`presence_publishes?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error_text: 'deploy: netlify reported error (reconciled)', completed_at: nowIso }) });
  }
  return outcome;
}

/** Per-site lazy reconcile — GET /publishes reuses this (ONE implementation). */
export async function reconcileSitePublishes(siteId: string): Promise<void> {
  const now = Date.now();
  const pend = await svc(`presence_publishes?site_id=eq.${siteId}&status=in.(queued,deploying)&select=id,site_id,netlify_deploy_id,created_at`);
  for (const p of (Array.isArray(pend.json) ? pend.json : [])) await reconcileOnePublish(p as InflightPublish, now);
}
