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
import { runPipeline, takeSiteOffline } from '../routes/publish.ts';
import { reconcileOnePublish, RECONCILE_STALE_MS, type InflightPublish } from '../lib/deploy_reconcile.ts';
import { blocksNeedRewindow } from '../lib/content_window.ts';
import type { Principal } from '../../_shared/auth.ts';
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
//
// FAIRNESS (0091): ordered by the last_observed_at rotation cursor (nulls
// first), and every site CONSIDERED gets the cursor stamped — a true
// round-robin, so no site starves however many exist. updated_at ordering was
// wrong here: nothing in the cycle bumps it, so the same window repeated
// forever. Falls back to the old ordering until 0091 is applied.
async function activeSites(limit: number): Promise<SiteRow[]> {
  // svcAll, not a bare select: PostgREST's max-rows cap would silently truncate
  // a NONDETERMINISTIC subset of active clients (~1000), dropping their sites
  // out of observation with zero signal. Paged + ordered + logged at the bound.
  const { svcAll } = await import('../lib/db.ts');
  const er = await svcAll('presence_entitlements?product=eq.presence&status=eq.active&select=client_id', 'client_id');
  const activeClients = new Set(er.map((r: any) => String(r.client_id)));
  if (!activeClients.size) return [];
  let sr = await svc(`presence_sites?status=in.(ready,live)&select=${SITE_COLS}&order=last_observed_at.asc.nullsfirst&limit=${limit * 3}`);
  if (!sr.ok) sr = await svc(`presence_sites?status=in.(ready,live)&select=${SITE_COLS}&order=updated_at.asc&limit=${limit * 3}`);
  const fetched = (sr.ok && Array.isArray(sr.json) ? sr.json : []) as SiteRow[];
  const sites = fetched.filter((s: any) => activeClients.has(String(s.client_id))).slice(0, limit);
  // Stamp EVERY row fetched, not just the selected ones: a ready/live site whose
  // client has no active entitlement would otherwise sit unstamped at the
  // nulls-first front of the window forever and (past limit*3 of them) starve
  // the active sites — the exact defect this cursor exists to fix.
  await stampCursor('presence_sites', 'id', fetched.map((s) => s.id), { last_observed_at: new Date().toISOString() });
  return sites;
}

/** Stamp a rotation cursor on a set of rows, CHUNKED at 50 ids per PATCH — a
 *  200-UUID in.(...) list brushes the ~8KB URI limit, and a 414 on a
 *  best-effort call would silently stop the cursor advancing (starvation
 *  quietly returns). Exported for the other two sweeps. Best-effort. */
export async function stampCursor(table: string, key: string, ids: string[], body: Record<string, string>, extraFilter = ''): Promise<void> {
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (!chunk.length) continue;
    await svc(`${table}?${key}=in.(${chunk.join(',')})${extraFilter}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }).catch(() => {});
  }
}

/** Resolve runs stuck 'running' past any plausible invocation lifetime (the
 *  invocation died before its terminal PATCH). Marking them failed makes them
 *  count toward failures_last_24h — a repeatedly-dying tick now ALARMS instead
 *  of accreting silent forensics rows forever. */
export async function reapStaleRuns(): Promise<{ ok: boolean }> {
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
  const r = await svc(`presence_scheduled_runs?status=eq.running&started_at=lt.${encodeURIComponent(twoHoursAgo)}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'failed', finished_at: new Date().toISOString(), last_error: 'interrupted: still running after 2h (invocation died before finishing)' }),
  }).catch(() => ({ ok: false }));
  return { ok: !!(r as { ok?: boolean }).ok };
}

// ── FD-1: fire due scheduled publishes/reverts through the ONE publish pipeline.
// A due row loads its frozen snapshot and runs runPipeline (publish or restore),
// exactly as a manual publish would — no second publish path. Each row's outcome
// is recorded; one failure never stops the others.
export async function runDuePublishes(limit = 25): Promise<CycleResult> {
  const nowIso = new Date().toISOString();
  // A publish claimed (fired_at set) but never finalized — the invocation died
  // mid-run — would otherwise sit status=pending FOREVER: unclaimable (the
  // atomic claim filters fired_at=is.null), unledgered, and still shown to the
  // customer as an upcoming change. At-most-once is right for publishes, so we
  // surface it as failed (visible + alertable) rather than silently retrying.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  await svc(`presence_scheduled_publishes?status=eq.pending&fired_at=not.is.null&fired_at=lt.${encodeURIComponent(hourAgo)}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'failed', last_error: 'interrupted: claimed but never finalized (invocation died mid-publish)' }),
  }).catch(() => {});
  const q = await svc(`presence_scheduled_publishes?status=eq.pending&scheduled_for=lte.${encodeURIComponent(nowIso)}&select=id,site_id,snapshot_id,kind,summary,created_by&order=scheduled_for.asc&limit=${limit}`);
  const rows = (q.ok && Array.isArray(q.json)) ? q.json : [];
  const results: SiteRunResult[] = [];
  const sysPrincipal: Principal = { kind: 'system', userId: 'scheduler', tenantId: null, role: null, email: null, jwt: null, requestId: 'scheduled-publish' };
  for (const row of rows) {
    // claim it (pending → running-ish) so a concurrent cycle can't double-fire.
    // fired_at=is.null makes the claim ATOMIC: two overlapping ticks both match
    // status=pending, but only the first PATCH finds fired_at still null.
    const claim = await svc(`presence_scheduled_publishes?id=eq.${row.id}&status=eq.pending&fired_at=is.null`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ fired_at: nowIso }) });
    if (!claim.ok || !claim.json?.[0]) continue;   // someone else took it
    let ok = false, err = '';
    try {
      const site = (await svc(`presence_sites?id=eq.${row.site_id}&select=${SITE_COLS}&limit=1`)).json?.[0];
      // G5 "unpublish at": a kind='offline' row carries no snapshot — it takes the
      // site offline via the SAME core the POST /site/offline route uses (G10).
      if (row.kind === 'offline') {
        if (!site) { err = 'site gone'; }
        else {
          const res = await takeSiteOffline(site as SiteRow, sysPrincipal);
          ok = res.ok;
          if (!res.ok) err = `${res.error}: ${res.message}`.slice(0, 200);
        }
        await svc(`presence_scheduled_publishes?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: ok ? 'done' : 'failed', last_error: err }) });
        results.push({ site_id: String(row.site_id), ok, steps: { offline: ok }, error: err || undefined });
        continue;
      }
      const snap = (await svc(`presence_snapshots?id=eq.${row.snapshot_id}&select=content,media_manifest,content_contract_version,template_slug,template_version,created_at,dev_customization&limit=1`)).json?.[0];
      if (!site || !snap) { err = 'site or snapshot gone'; }
      else {
        // Phase EXP: a boundary-republish row (created_by sentinel) re-emits the CURRENT
        // live snapshot but with its render clock set to the FIRE time, so the pure
        // window filter re-evaluates and ONLY the time-gated sections flip — every other
        // byte is frozen in that snapshot (no unrelated draft edit can ride along).
        const isRewindow = String(row.created_by || '').startsWith('scheduler:rewindow');
        const snapshot = { content: snap.content, content_contract_version: snap.content_contract_version, template_slug: snap.template_slug, template_version: snap.template_version, created_at: isRewindow ? nowIso : snap.created_at, dev_customization: snap.dev_customization ?? null };
        const res = await runPipeline(site as SiteRow, sysPrincipal, row.kind === 'revert' ? 'restore' : 'publish', { snapshot, snapshotId: row.snapshot_id, mediaManifest: snap.media_manifest || [] }, row.summary || 'Scheduled change', {});
        ok = res.status === 200;
        if (!ok) { try { err = (await res.clone().json())?.error || `status ${res.status}`; } catch { err = `status ${res.status}`; } }
      }
    } catch (e) { err = String(e).slice(0, 200); }
    await svc(`presence_scheduled_publishes?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: ok ? 'done' : 'failed', last_error: err }) });
    results.push({ site_id: String(row.site_id), ok, steps: { [row.kind]: ok }, error: err || undefined });
  }
  const failures = results.filter((r) => !r.ok).length;
  if (failures > 0) await alertFailures('scheduled-publish', failures, results.length, results.filter((r) => !r.ok));
  return { ok: failures === 0, run_type: 'scheduled-publish', considered: rows.length, ran: results.length, failures, results };
}

// ── Phase EXP: auto-expiring content — the boundary-republish sweep ───────────
// A live site whose content carries a section with a show_from/show_until window
// goes stale on its own the instant a boundary passes: the live bytes were rendered
// at the last publish's clock, so a special that just expired (or a banner that just
// went live) wouldn't come down / go up until the next manual publish. This sweep
// detects that and enqueues a re-emit of the CURRENT LIVE snapshot through the SAME
// publish machinery (presence_scheduled_publishes + runDuePublishes). The row's
// created_by sentinel marks it a rewindow, so runDuePublishes re-renders that frozen
// snapshot at the FIRE time — ONLY the time-gated sections flip; every other byte is
// frozen in the snapshot, so no unrelated draft edit can ride along. Idempotent
// (skips a site already publishing or already enqueued) and best-effort (one site's
// failure never stops another). Reuses the ONE pipeline — no second publish path.
export async function runWindowExpiries(limit = 40): Promise<{ ok: true; run_type: 'window_expiry'; scanned: number; enqueued: number; site_ids: string[] }> {
  const nowIso = new Date().toISOString();
  // Live sites only — a window can only be stale on a site that's actually published.
  const cap = Math.max(1, Math.min(200, limit));
  const sr = await svc(`presence_sites?status=eq.live&select=id&order=last_published_at.asc.nullsfirst&limit=${cap}`);
  const sites = (sr.ok && Array.isArray(sr.json)) ? sr.json as Array<{ id: string }> : [];
  let enqueued = 0; const siteIds: string[] = [];
  for (const s of sites) {
    try {
      // the current live publish → its snapshot content + the clock the live bytes
      // were rendered at (the publish record's completed/created time IS that clock —
      // for a normal publish ≈ snapshot.created_at, for a prior rewindow = its fire time,
      // so an already-flipped section never re-fires).
      const pub = (await svc(`presence_publishes?site_id=eq.${s.id}&status=eq.live&snapshot_id=not.is.null&select=snapshot_id,created_at,completed_at&order=created_at.desc&limit=1`)).json?.[0];
      if (!pub?.snapshot_id) continue;
      const liveIso = String(pub.completed_at || pub.created_at || '');
      if (!liveIso) continue;
      const snap = (await svc(`presence_snapshots?id=eq.${pub.snapshot_id}&select=content&limit=1`)).json?.[0];
      if (!blocksNeedRewindow(snap?.content?.settings?.blocks, liveIso, nowIso)) continue;
      // idempotent: don't stack a rewindow while a publish is in flight or one is
      // already queued for this site (that publish will carry the flip anyway).
      const inflight = (await svc(`presence_publishes?site_id=eq.${s.id}&status=in.(queued,deploying)&select=id&limit=1`)).json;
      if (Array.isArray(inflight) && inflight.length) continue;
      const pendingSched = (await svc(`presence_scheduled_publishes?site_id=eq.${s.id}&status=eq.pending&select=id&limit=1`)).json;
      if (Array.isArray(pendingSched) && pendingSched.length) continue;
      const ins = await svc('presence_scheduled_publishes', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ site_id: s.id, snapshot_id: pub.snapshot_id, kind: 'publish', scheduled_for: nowIso, status: 'pending', summary: 'A timed section went live or came down', created_by: 'scheduler:rewindow' }),
      });
      if (ins.ok && ins.json?.[0]?.id) { enqueued++; siteIds.push(s.id); }
    } catch { /* best-effort — the next tick retries this site */ }
  }
  return { ok: true, run_type: 'window_expiry', scanned: sites.length, enqueued, site_ids: siteIds };
}

// ── M5: reconcile STUCK publishes — the recovery process for publishes left
// in-flight (queued/deploying) past the in-request poll window. Reads Netlify's
// authoritative state per record and finalizes it (live/failed), or fails a
// publish interrupted before it ever deployed. NEVER re-deploys → idempotent,
// history-safe. Global (all sites), oldest first, bounded per tick. Reuses the
// SAME reconcileOnePublish the GET /publishes lazy path uses (no second impl).
export async function runReconcileStuckPublishes(limit = 50): Promise<{ ok: true; run_type: 'reconcile'; scanned: number; live: number; failed: number; abandoned: number; pending: number }> {
  const now = Date.now();
  const staleBefore = new Date(now - RECONCILE_STALE_MS).toISOString();
  const q = await svc(`presence_publishes?status=in.(queued,deploying)&created_at=lte.${encodeURIComponent(staleBefore)}&select=id,site_id,netlify_deploy_id,created_at&order=created_at.asc&limit=${Math.max(1, Math.min(200, limit))}`);
  const rows: InflightPublish[] = Array.isArray(q.json) ? q.json : [];
  const tally = { ok: true as const, run_type: 'reconcile' as const, scanned: rows.length, live: 0, failed: 0, abandoned: 0, pending: 0 };
  for (const p of rows) {
    const r = await reconcileOnePublish(p, now);
    tally[r] += 1;
  }
  return tally;
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
// critical:true — this is OPERATIONAL mail to the platform operator about his
// own platform, not marketing. maySend suppresses non-critical mail for an
// opted-out address silently, so a single unsubscribe click would otherwise kill
// "your scheduled jobs are failing" with no signal anywhere. It still respects a
// bounce/complaint (account.ts:112-116) — a dead address stays dead.
async function alertFailures(runType: string, failures: number, total: number, failed: SiteRunResult[]): Promise<void> {
  const lines = failed.slice(0, 20).map((f) => `• ${f.site_id}: ${f.error || Object.entries(f.steps).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'failed'}`).join('<br>');
  await sendEmail(OPS_ALERT_EMAIL, `Studio OS — ${failures}/${total} scheduled ${runType} runs failed`,
    `<p>The scheduled ${runType} had ${failures} failure(s) of ${total}. They're recorded in presence_scheduled_runs and eligible for automatic retry.</p><p>${lines}</p>`,
    undefined, { critical: true },
  ).catch(() => {});
}
