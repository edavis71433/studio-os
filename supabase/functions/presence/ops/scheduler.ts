// ── L2 · Scheduled Operations — the platform keeps watching, unattended ─────
// Iterates active sites and runs the SAME per-site engines the operator runs by
// hand (evidence → judgment → recommendation → moments, + coach), one site's
// failure never stopping another. Every unit of work is recorded in
// presence_scheduled_runs with its outcome, so failures can be retried and an
// operator can see what happened while no one was watching.
//
// No new intelligence — this is orchestration of the frozen pipeline under a
// system (cron) identity. Engines run under the service role and need only a
// SiteRow, exactly as the agency bulk runner already does.

import { svc } from '../lib/db.ts';
import { runEvidence } from '../evidence/engine.ts';
import { runJudgment } from '../judgment/engine.ts';
import { runRecommendation } from '../recommendation/engine.ts';
import { runMoments } from '../moments/engine.ts';
import { runGrowthCoach } from '../coach/engine.ts';
import { sendEmail } from '../commerce/account.ts';
import type { SiteRow } from '../lib/site.ts';

const SITE_COLS = 'id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition';
const DEFAULT_LIMIT = 40;               // sites per invocation — cron cadence covers the rest
const OPS_ALERT_EMAIL = Deno.env.get('OPS_ALERT_EMAIL') || 'eric@davisdigitalstudio.com';

export interface SiteRunResult { site_id: string; ok: boolean; steps: Record<string, boolean>; error?: string; }
export interface CycleResult {
  ok: boolean; run_type: string; considered: number; ran: number; failures: number;
  results: SiteRunResult[]; note?: string;
}

// Active sites = serviceable ones: status ready/live, backed by an active
// entitlement. (Monitor sites qualify — observation is their whole point.)
async function activeSites(limit: number): Promise<SiteRow[]> {
  const er = await svc('presence_entitlements?product=eq.presence&status=eq.active&select=client_id');
  const activeClients = new Set((er.ok && Array.isArray(er.json) ? er.json : []).map((r: any) => String(r.client_id)));
  if (!activeClients.size) return [];
  const sr = await svc(`presence_sites?status=in.(ready,live)&select=${SITE_COLS}&order=updated_at.asc&limit=${limit * 3}`);
  const sites = (sr.ok && Array.isArray(sr.json) ? sr.json : []).filter((s: any) => activeClients.has(String(s.client_id)));
  return sites.slice(0, limit) as SiteRow[];
}

// Run one site through the observation pipeline, isolated. Evidence gates the
// rest (judgment/recommendation/moments need a fresh evidence run); a failure
// anywhere is captured, never thrown.
export async function runSiteCycle(site: SiteRow, withCoach: boolean): Promise<SiteRunResult> {
  const steps: Record<string, boolean> = {};
  try {
    const ev = await runEvidence(site, 'schedule');
    steps.evidence = !!ev.ok;
    if (ev.ok) {
      const jd = await runJudgment(site); steps.judgment = !!jd.ok;
      if (jd.ok) {
        const rc = await runRecommendation(site); steps.recommendation = !!rc.ok;
        if (rc.ok) { const mo = await runMoments(site); steps.moments = !!mo.ok; }
      }
    }
    if (withCoach) { try { const co = await runGrowthCoach(site); steps.coach = !!co.ok; } catch { steps.coach = false; } }
    const ok = Object.values(steps).every(Boolean);
    return { site_id: site.id, ok, steps };
  } catch (e) {
    return { site_id: site.id, ok: false, steps, error: String((e as Error)?.message || e).slice(0, 300) };
  }
}

async function ledgerOpen(runType: string, siteId: string | null): Promise<string | null> {
  const r = await svc('presence_scheduled_runs', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ run_type: runType, site_id: siteId, status: 'running', started_at: new Date().toISOString(), attempts: 1 }),
  });
  return r.json?.[0]?.id || null;
}
async function ledgerClose(id: string | null, ok: boolean, result: unknown, error = ''): Promise<void> {
  if (!id) return;
  await svc(`presence_scheduled_runs?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: ok ? 'done' : 'failed', finished_at: new Date().toISOString(), result, last_error: error.slice(0, 500) }),
  });
}

// The main cycle: run each active site, ledger each, alert on failures.
export async function runOperationsCycle(opts: { limit?: number; withCoach?: boolean } = {}): Promise<CycleResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const withCoach = opts.withCoach ?? false;
  const sites = await activeSites(limit);
  const results: SiteRunResult[] = [];
  for (const site of sites) {
    const runId = await ledgerOpen('cycle', site.id);
    const res = await runSiteCycle(site, withCoach);
    await ledgerClose(runId, res.ok, { steps: res.steps }, res.error || (res.ok ? '' : 'one or more steps failed'));
    results.push(res);
  }
  const failures = results.filter((r) => !r.ok).length;
  if (failures > 0) await alertFailures('cycle', failures, results.length, results.filter((r) => !r.ok));
  return { ok: failures === 0, run_type: 'cycle', considered: sites.length, ran: results.length, failures, results };
}

// Retry queue: pick up failed runs still under their attempt ceiling and re-run
// that site. Failure recovery without an operator.
export async function retryFailedRuns(limit = 20): Promise<CycleResult> {
  // PostgREST can't compare two columns, so fetch failed cycle runs and filter
  // attempts < max_attempts in code.
  const fr = await svc(`presence_scheduled_runs?status=eq.failed&run_type=eq.cycle&select=id,site_id,attempts,max_attempts&order=updated_at.asc&limit=${limit * 2}`);
  const rows = ((fr.ok && Array.isArray(fr.json)) ? fr.json : []).filter((r: any) => (r.attempts || 0) < (r.max_attempts || 3)).slice(0, limit);
  const results: SiteRunResult[] = [];
  for (const row of rows) {
    if (!row.site_id) continue;
    const sr = await svc(`presence_sites?id=eq.${row.site_id}&select=${SITE_COLS}&limit=1`);
    const site = sr.json?.[0] as SiteRow | undefined;
    if (!site) { await svc(`presence_scheduled_runs?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'skipped', last_error: 'site gone' }) }); continue; }
    await svc(`presence_scheduled_runs?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'running', attempts: (row.attempts || 1) + 1, started_at: new Date().toISOString() }) });
    const res = await runSiteCycle(site, false);
    await svc(`presence_scheduled_runs?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: res.ok ? 'done' : 'failed', finished_at: new Date().toISOString(), result: { steps: res.steps }, last_error: res.error || (res.ok ? '' : 'retry: steps failed') }) });
    results.push(res);
  }
  const failures = results.filter((r) => !r.ok).length;
  return { ok: failures === 0, run_type: 'retry', considered: rows.length, ran: results.length, failures, results };
}

// Operator alert — best-effort email; the failure is always in the ledger too.
async function alertFailures(runType: string, failures: number, total: number, failed: SiteRunResult[]): Promise<void> {
  const lines = failed.slice(0, 20).map((f) => `• ${f.site_id}: ${f.error || Object.entries(f.steps).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'failed'}`).join('<br>');
  await sendEmail(OPS_ALERT_EMAIL, `Studio OS — ${failures}/${total} scheduled ${runType} runs failed`,
    `<p>The scheduled ${runType} had ${failures} failure(s) of ${total}. They're recorded in presence_scheduled_runs and eligible for automatic retry.</p><p>${lines}</p>`,
  ).catch(() => {});
}
