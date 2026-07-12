// ── /system/* — the unattended operations surface (L2) ──────────────────────
// Secret-gated (SCHEDULER_SECRET), no user principal. Handled at the very top of
// the router (before principal resolution) because cron has no session. This is
// how the platform keeps observing, retries failures, and reports its own health
// while no operator is present.
//   POST /system/run     {secret, task?: 'cycle'|'retry'|'coach', limit?}
//   GET  /system/health  ?secret=…   (or x-system-secret header)
import { json } from '../../_shared/http.ts';
import { svc, svcCount } from '../lib/db.ts';
import { runOperationsCycle, retryFailedRuns, runDuePublishes, runReconcileStuckPublishes, reapStaleRuns } from '../ops/scheduler.ts';
import { runGscSync } from '../ops/gsc_sync.ts';
import { runRetentionSweep } from '../ops/retention.ts';
import { reapMedia } from '../lib/media_gc.ts';
import { reapSnapshots } from '../lib/snapshot_gc.ts';
import { runLifecycleSweep, runWeeklyDigest, runDomainWatch, runLeadFollowups, runDealFollowups, runRenewalReminders, runInvoiceReminders, runSalesDocReminders } from '../commerce/lifecycle.ts';
import { runDeletionSweep } from '../commerce/deletion.ts';
import { runBillingReconcile } from '../commerce/entitlement_sync.ts';
import { summarizeHealthCenter } from '../lib/health_center.ts';

const SCHEDULER_SECRET = Deno.env.get('SCHEDULER_SECRET') || '';

// ── Phase J: the production activation dashboard ─────────────────────────────
// Every production secret the `presence` function reads, grouped by the
// capability it activates, with what each one enables and whether it's required
// for the platform to boot or optional (the feature degrades gracefully without
// it). `/system/health` reports this so the owner sees exactly what's live and
// what a missing secret disables — the activation source of truth.
function envPresent(name: string): boolean {
  if (name === 'SERVICE_ROLE_KEY') return !!(Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  if (name === 'SUPABASE_URL') return !!(Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL'));
  if (name === 'SUPABASE_ANON_KEY') return !!(Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY'));
  return !!Deno.env.get(name);
}

interface SecretDef { name: string; required: boolean; enables: string }
const SECRET_GROUPS: Record<string, SecretDef[]> = {
  core: [
    { name: 'SUPABASE_URL', required: true, enables: 'database + storage (platform cannot run without it)' },
    { name: 'SERVICE_ROLE_KEY', required: true, enables: 'system-table reads/writes (platform cannot run without it)' },
    { name: 'SUPABASE_ANON_KEY', required: true, enables: 'caller-JWT RLS reads (platform cannot run without it)' },
    { name: 'SCHEDULER_SECRET', required: true, enables: 'the cron/operations surface (/system/run) + billing-sync auth' },
  ],
  commerce: [
    { name: 'STRIPE_SECRET', required: false, enables: 'checkout + subscriptions (without it: signup creates the account but checkout returns "billing unavailable")' },
    { name: 'STRIPE_WEBHOOK_SECRET', required: false, enables: 'verifying Stripe webhooks (provisioning on payment)' },
    { name: 'BILLING_SYNC_SECRET', required: false, enables: 'the authed billing-sync path' },
  ],
  email: [
    { name: 'RESEND_KEY', required: false, enables: 'ALL email — lead notifications, one-tap approvals, digests, receipts (without it: email silently no-ops, logged)' },
    { name: 'EMAIL_FROM', required: false, enables: 'the From address (defaults to a studio address)' },
    { name: 'OPS_ALERT_EMAIL', required: false, enables: 'operational failure alerts (defaults to a studio address)' },
  ],
  hosting: [
    { name: 'NETLIFY_AUTH_TOKEN', required: false, enables: 'publishing customer sites (without it: publish fails with a clear config error — nothing goes live)' },
  ],
  approvals: [
    { name: 'APPROVAL_SECRET', required: false, enables: 'one-tap client approval links (falls back to SCHEDULER_SECRET; without either: /approve/send returns 503)' },
  ],
  operator: [
    { name: 'OPERATOR_SECRET', required: false, enables: 'the programmatic operator caller (x-operator-secret header) for marketplace/enterprise management (without it: those surfaces are operable only by an interactive staff login)' },
  ],
  ai: [
    { name: 'ANTHROPIC_KEY', required: false, enables: 'AI drafting / concierge / coach (without it: honest "AI unavailable", never filler)' },
    { name: 'VISUAL_MODEL_KEY', required: false, enables: 'AI Visual Studio image generation (gated off without it)' },
  ],
  connected: [
    { name: 'GOOGLE_CLIENT_ID', required: false, enables: 'Google OAuth (Connected Platform)' },
    { name: 'GOOGLE_CLIENT_SECRET', required: false, enables: 'Google OAuth token exchange' },
    { name: 'STATE_SIGNING_SECRET', required: false, enables: 'signed OAuth state (CSRF-safe connect flow)' },
    { name: 'CONNECTION_ENC_KEY', required: false, enables: 'encrypting connected tokens at rest (FAIL-CLOSED: without it, token storage is refused, not faked)' },
  ],
  site: [
    { name: 'SITE_URL', required: false, enables: 'absolute links in emails (defaults to the production host)' },
  ],
};

/** The activation dashboard: presence of every secret, grouped, + the derived
 *  "which capabilities are live right now" map. Pure over the environment. */
export function validateSecrets() {
  const groups: Record<string, Array<SecretDef & { present: boolean }>> = {};
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  for (const [group, defs] of Object.entries(SECRET_GROUPS)) {
    groups[group] = defs.map((d) => {
      const present = envPresent(d.name);
      if (!present) (d.required ? missingRequired : missingOptional).push(d.name);
      return { ...d, present };
    });
  }
  const has = (n: string) => envPresent(n);
  const capabilities = {
    platform_boots: has('SUPABASE_URL') && has('SERVICE_ROLE_KEY') && has('SUPABASE_ANON_KEY'),
    purchase_and_billing: has('STRIPE_SECRET'),
    stripe_webhooks: has('STRIPE_WEBHOOK_SECRET'),
    email: has('RESEND_KEY'),
    publishing: has('NETLIFY_AUTH_TOKEN'),
    scheduled_publishing: has('SCHEDULER_SECRET'), // + an external cron actually calling /system/run
    one_tap_approvals: has('APPROVAL_SECRET') || has('SCHEDULER_SECRET'),
    operator_management: has('OPERATOR_SECRET'), // marketplace/enterprise via x-operator-secret
    ai: has('ANTHROPIC_KEY'),
    visual_studio: has('VISUAL_MODEL_KEY'),
    connected_platform: has('GOOGLE_CLIENT_ID') && has('GOOGLE_CLIENT_SECRET') && has('CONNECTION_ENC_KEY'),
  };
  return {
    ok: missingRequired.length === 0,           // backward-compatible
    required_present: Object.values(groups).flat().filter((s) => s.required && s.present).map((s) => s.name),
    missing_required: missingRequired,
    missing_optional: missingOptional,
    groups,                                       // Phase J: full grouped inventory
    capabilities,                                 // Phase J: what's live right now
  };
}

function authorized(req: Request, body: any): boolean {
  if (!SCHEDULER_SECRET) return false;
  // FD-AUD16: body or header ONLY — never the query string (query strings land in
  // edge/proxy access logs, and this secret is high-value). The pg_cron job passes
  // it in the body, so nothing legitimate used the query path.
  const fromBody = body && typeof body.secret === 'string' ? body.secret : '';
  const fromHeader = req.headers.get('x-system-secret') || '';
  return fromBody === SCHEDULER_SECRET || fromHeader === SCHEDULER_SECRET;
}

const CRON_STALE_MS = 45 * 60_000;   // 3 missed 15-min ticks = the scheduler is dead
const FAILURE_ALARM_24H = 10;        // sustained failures = something systemic

async function health(): Promise<any> {
  const secrets = validateSecrets();
  // db reachability + cheap operational reads (exact counts — never fetch-to-count)
  let dbOk = false, activeSites = 0, lastCycle: any = null, failures24h = 0;
  try {
    const ping = await svc('presence_sites?select=id&limit=1');
    dbOk = ping.ok;
    activeSites = (await svcCount('presence_entitlements?product=eq.presence&status=eq.active')) ?? 0;
    // Liveness reads the TICK row (written unconditionally every tick), not just
    // 'cycle' (written only per active-entitled site — with zero active sites a
    // healthy scheduler would look dead, or a dead one undetectable).
    const last = await svc('presence_scheduled_runs?run_type=in.(tick,cycle)&order=created_at.desc&select=status,started_at,finished_at,site_id&limit=1');
    lastCycle = last.json?.[0] || null;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    failures24h = (await svcCount(`presence_scheduled_runs?status=eq.failed&created_at=gte.${since}`)) ?? 0;
  } catch { /* dbOk stays false */ }
  // Top-level ok is what the external watchdog pages on, so it must reflect the
  // failures a human needs to hear about — not just "the box is on". A dead cron
  // (no cycle in 45 min, once one has EVER run) or sustained failures degrade it.
  const lastCycleAt = lastCycle ? Date.parse(lastCycle.finished_at || lastCycle.started_at || '') : NaN;
  const cronStale = Number.isFinite(lastCycleAt) && (Date.now() - lastCycleAt) > CRON_STALE_MS;
  const failureAlarm = failures24h >= FAILURE_ALARM_24H;
  const ok = secrets.ok && dbOk && !cronStale && !failureAlarm;
  const health_center = await computeHealthCenter().catch(() => null);
  return { ok, secrets, db_ok: dbOk, cron_stale: cronStale, failure_alarm: failureAlarm, active_sites: activeSites, last_cycle: lastCycle, failures_last_24h: failures24h, health_center, checked_at: new Date().toISOString() };
}

// ── PT-8: the Admin Health Center — ONE unified operational read (no new monitoring).
// Aggregates signals the platform already produces into one status per area.
// Self-contained so it also powers the operator-authenticated /admin/health-center.
export async function computeHealthCenter(): Promise<any> {
  const nowIso = new Date().toISOString();
  const period = nowIso.slice(0, 7);
  const soon = new Date(Date.now() + 30 * 86400_000).toISOString();
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const since24 = new Date(Date.now() - 24 * 3600_000).toISOString();
  const arr = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []);
  const cronQ = await svc('presence_scheduled_runs?run_type=in.(tick,cycle)&order=created_at.desc&select=status,started_at,finished_at&limit=1');
  const lastCycle = arr(cronQ)[0] || null;
  // Exact counts (HEAD + count=exact) — fetch-to-count went WRONG past the
  // PostgREST max-rows cap, silently under-reporting at scale.
  const [failedRuns, live, doms, domsSoon, entActive, entPaused, entLapsed, notices, failPub, aiUseQ] = await Promise.all([
    svcCount(`presence_scheduled_runs?status=eq.failed&created_at=gte.${encodeURIComponent(since24)}`),
    svcCount('presence_sites?status=eq.live'),
    svcCount('presence_sites?custom_domain=not.is.null'),
    svcCount(`presence_sites?custom_domain=not.is.null&domain_expires_at=lte.${encodeURIComponent(soon)}&domain_expires_at=gte.${encodeURIComponent(nowIso)}`),
    svcCount('presence_entitlements?product=eq.presence&status=eq.active'),
    svcCount('presence_entitlements?product=eq.presence&status=eq.paused'),
    svcCount('presence_entitlements?product=eq.presence&status=eq.lapsed'),
    svcCount('presence_plan_notices?status=eq.active'),
    svcCount(`presence_publishes?status=eq.failed&created_at=gte.${encodeURIComponent(since)}`),
    svc(`presence_ai_usage?period=eq.${period}&select=generative_ops,assistive_ops&limit=1000`),
  ]);
  const aiOps = (arr(aiUseQ) as Array<{ generative_ops?: number; assistive_ops?: number }>).reduce((n, r) => n + (r.generative_ops || 0) + (r.assistive_ops || 0), 0);
  const missing = Object.values(SECRET_GROUPS).flat().filter((d) => d.required && !envPresent(d.name)).map((d) => d.name);
  return summarizeHealthCenter({
    nowIso,
    cronLastRunAt: lastCycle?.finished_at || lastCycle?.started_at || null,
    secretsMissingRequired: missing,
    domainsWatched: doms ?? 0,
    domainsExpiringSoon: domsSoon ?? 0,
    billing: { active: entActive ?? 0, paused: entPaused ?? 0, lapsed: entLapsed ?? 0 },
    aiConfigured: envPresent('ANTHROPIC_KEY'),
    aiOpsThisMonth: aiOps,
    emailConfigured: envPresent('RESEND_KEY'),
    sitesLive: live ?? 0,
    failedPublishes: failPub ?? 0,
    failedRuns: failedRuns ?? 0,
    activeNotices: notices ?? 0,
    backupsVerified: envPresent('BACKUPS_VERIFIED'),
  });
}

// What in this tick deserves a human's attention? ok:false, failures/errors>0,
// or a prune that returned false — but NOT informational falses (skipped_*,
// feature-off flags). Returns human-readable issue strings, empty = clean tick.
function sweepIssues(progress: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const [name, v] of Object.entries(progress)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (o.ok === false) { issues.push(`${name}: ok=false`); continue; }
    for (const [k, val] of Object.entries(o)) {
      if ((k === 'failures' || k === 'errors' || k === 'failed') && typeof val === 'number' && val > 0) issues.push(`${name}.${k}=${val}`);
      else if (val === false && !k.startsWith('skipped') && k !== 'ok') issues.push(`${name}.${k} failed`);
    }
  }
  return issues;
}

// Keep the ledgered tick progress compact: per-sweep counters only, never the
// per-site result arrays (the cycle already ledgers those per site).
function summarizeProgress(progress: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(progress)) {
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      out[k] = Object.fromEntries(Object.entries(o).filter(([, val]) => typeof val === 'number' || typeof val === 'boolean').slice(0, 12));
    } else out[k] = v;
  }
  return out;
}

export async function handleSystem(req: Request, route: string, method: string, cors: Record<string, string>): Promise<Response> {
  let body: any = null;
  if (method === 'POST') { try { body = await req.json(); } catch { body = null; } }
  if (!authorized(req, body)) return json({ error: 'forbidden' }, 403, cors);

  if (route === '/system/run' && method === 'POST') {
    const task = String(body?.task || 'cycle');
    const limit = Number.isFinite(body?.limit) ? Math.max(1, Math.min(200, Number(body.limit))) : undefined;
    try {
      if (task === 'retry') return json({ data: await retryFailedRuns(limit) }, 200, cors);
      if (task === 'coach') return json({ data: await runOperationsCycle({ limit, withCoach: true }) }, 200, cors);
      if (task === 'publish') return json({ data: await runDuePublishes(limit) }, 200, cors);   // FD-1 scheduled publishes
      if (task === 'reconcile') return json({ data: await runReconcileStuckPublishes(limit) }, 200, cors); // M5: finalize stuck publishes
      if (task === 'media_gc') return json({ data: await reapMedia(limit ?? 100) }, 200, cors); // M6: reap soft-deleted + orphaned media
      if (task === 'snapshot_gc') return json({ data: await reapSnapshots(limit ?? 200) }, 200, cors); // M7: prune old unreferenced snapshots
      if (task === 'lifecycle') return json({ data: await runLifecycleSweep(limit) }, 200, cors); // Phase RL: trial expiry + lifecycle comms
      if (task === 'deletion') return json({ data: await runDeletionSweep(limit) }, 200, cors);   // P2-E W2: execute eligible account deletions
      if (task === 'reconcile_billing') return json({ data: await runBillingReconcile(limit) }, 200, cors);   // P2-E W7: correct entitlement drift vs Stripe
      if (task === 'gsc_sync') return json({ data: await runGscSync(limit) }, 200, cors);          // AN-3.1: Search Console scheduled sync

      // ── SPLIT MODE (the scaling knob): run one GROUP of the default chain as
      // its own ledgered tick. As the fleet grows, the single 15-min tick's
      // observation cycle can eat the invocation wall-clock and silently starve
      // everything after it — split mode gives each group its own invocation
      // (and its own pg_cron job; see supabase/ops/schedule-presence-cron.sql).
      // The default single tick below stays for small fleets. run_type stays
      // 'tick' so the health liveness read covers both modes.
      if (task === 'observe' || task === 'revenue' || task === 'hygiene') {
        const GROUPS: Record<string, Array<[string, () => Promise<unknown>]>> = {
          observe: [
            ['cycle', () => runOperationsCycle({ limit })],
            ['scheduled_publishes', () => runDuePublishes(limit)],
            ['reconcile', () => runReconcileStuckPublishes(50)],
          ],
          revenue: [
            ['reconcile_billing', () => runBillingReconcile(30)],
            ['lifecycle', () => runLifecycleSweep(limit)],
            ['deletion', () => runDeletionSweep(25)],
            ['leads', () => runLeadFollowups(20)],
            ['deal_nudges', () => runDealFollowups(20)],
            ['renewals', () => runRenewalReminders(50)],
            ['invoice_nudges', () => runInvoiceReminders(20)],
            ['doc_reminders', () => runSalesDocReminders(20)],
          ],
          hygiene: [
            ['digest', () => runWeeklyDigest()],
            ['domains', () => runDomainWatch(10)],
            ['retention', () => runRetentionSweep()],
            ['media_gc', () => reapMedia(100)],
            ['snapshot_gc', () => reapSnapshots(200)],
            ['stale_runs', () => reapStaleRuns()],
          ],
        };
        const progress: Record<string, unknown> = { group: task };
        const row = await svc('presence_scheduled_runs', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ run_type: 'tick', site_id: null, status: 'running', started_at: new Date().toISOString(), attempts: 1 }),
        }).then((r) => r.json?.[0]?.id || null).catch(() => null);
        for (const [name, fn] of GROUPS[task]) {
          progress[name] = await fn();
          if (row) await svc(`presence_scheduled_runs?id=eq.${row}`, { method: 'PATCH', body: JSON.stringify({ result: { progress: summarizeProgress(progress) } }) }).catch(() => {});
        }
        const issues = sweepIssues(progress);
        if (row) await svc(`presence_scheduled_runs?id=eq.${row}`, { method: 'PATCH', body: JSON.stringify({ status: issues.length ? 'failed' : 'done', finished_at: new Date().toISOString(), last_error: issues.join('; ').slice(0, 500), result: { progress: summarizeProgress(progress) } }) }).catch(() => {});
        return json({ data: summarizeProgress(progress) }, 200, cors);
      }
      // ── The default tick: one chain covering observation + revenue + hygiene.
      // OBSERVABILITY: the whole chain is ledgered in ONE presence_scheduled_runs
      // row (run_type 'tick'), progressively updated after EVERY sweep — so if
      // the invocation dies mid-chain (wall-clock limit, crash), the row stays
      // 'running' and result.progress shows exactly which sweep died. Previously
      // the sub-sweeps' outcomes lived only in this (unstored) HTTP response.
      const progress: Record<string, unknown> = {};
      const tickRow = await svc('presence_scheduled_runs', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ run_type: 'tick', site_id: null, status: 'running', started_at: new Date().toISOString(), attempts: 1 }),
      }).then((r) => r.json?.[0]?.id || null).catch(() => null);
      const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        const res = await fn();
        progress[name] = res;
        if (tickRow) await svc(`presence_scheduled_runs?id=eq.${tickRow}`, { method: 'PATCH', body: JSON.stringify({ result: { progress: summarizeProgress(progress) } }) }).catch(() => {});
        return res;
      };

      const cycle = await step('cycle', () => runOperationsCycle({ limit }));
      const scheduled = await step('scheduled_publishes', () => runDuePublishes(limit));
      const reconcile = await step('reconcile', () => runReconcileStuckPublishes(50));   // M5: finalize stuck publishes every tick
      // P2-E: reconcile billing BEFORE the lifecycle sweep so grace-clock
      // enforcement (W9) acts on Stripe-fresh state (a recovered customer already
      // had grace_until cleared) rather than possibly-stale data.
      const reconcile_billing = await step('reconcile_billing', () => runBillingReconcile(30));
      const lifecycle = await step('lifecycle', () => runLifecycleSweep(limit));   // Phase RL: the revenue lifecycle
      const deletion = await step('deletion', () => runDeletionSweep(25));         // P2-E W2: eligible account deletions
      const digest = await step('digest', () => runWeeklyDigest());                // CP-3: the Monday routine (7-day dedupe)
      const domains = await step('domains', () => runDomainWatch(10));             // INF: RDAP expiry+registrar, 24h dedupe
      const leads = await step('leads', () => runLeadFollowups(20));               // CRM: nudge un-replied leads, once per lead
      const dealNudges = await step('deal_nudges', () => runDealFollowups(20));    // CRM: nudge stale deals
      const renewals = await step('renewals', () => runRenewalReminders(50));      // PP-2: annual renewal heads-up
      const invoiceNudges = await step('invoice_nudges', () => runInvoiceReminders(20)); // MONEY: unpaid invoice reminders
      const docReminders = await step('doc_reminders', () => runSalesDocReminders(20));  // SALES: unsigned doc reminders
      const retention = await step('retention', () => runRetentionSweep());        // bounded detail tables (visits/terms/ledgers/evidence)
      const media_gc = await step('media_gc', () => reapMedia(100));               // M6: reap soft-deleted + orphan media
      const snapshot_gc = await step('snapshot_gc', () => reapSnapshots(200));     // M7: prune old unreferenced snapshots
      await step('stale_runs', () => reapStaleRuns());                             // resolve runs stuck 'running' >2h → failed (alarms)

      // Terminal status reflects EVERY sweep, not just the cycle: a persistently
      // failing prune/reminder marks the tick failed → counts toward
      // failures_last_24h → the watchdog pages. Previously visible only inside
      // result.progress, which nobody reads until something else breaks.
      const issues = sweepIssues(progress);
      if (tickRow) await svc(`presence_scheduled_runs?id=eq.${tickRow}`, { method: 'PATCH', body: JSON.stringify({ status: issues.length ? 'failed' : 'done', finished_at: new Date().toISOString(), last_error: issues.join('; ').slice(0, 500), result: { progress: summarizeProgress(progress) } }) }).catch(() => {});
      return json({ data: { ...cycle, scheduled_publishes: { ran: scheduled.ran, failures: scheduled.failures }, reconcile, media_gc, snapshot_gc, lifecycle, deletion, reconcile_billing, digest, domains, leads, dealNudges, renewals, invoiceNudges, docReminders, retention } }, 200, cors);
    } catch (e) {
      return json({ error: 'run_failed', detail: String((e as Error)?.message || e) }, 502, cors);
    }
  }
  if (route === '/system/health' && method === 'GET') {
    return json({ data: await health() }, 200, cors);
  }
  return json({ error: 'not_found', message: `No system route for ${method} ${route}.` }, 404, cors);
}
