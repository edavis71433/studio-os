// ── /system/* — the unattended operations surface (L2) ──────────────────────
// Secret-gated (SCHEDULER_SECRET), no user principal. Handled at the very top of
// the router (before principal resolution) because cron has no session. This is
// how the platform keeps observing, retries failures, and reports its own health
// while no operator is present.
//   POST /system/run     {secret, task?: 'cycle'|'retry'|'coach', limit?}
//   GET  /system/health  ?secret=…   (or x-system-secret header)
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { runOperationsCycle, retryFailedRuns, runDuePublishes } from '../ops/scheduler.ts';
import { runLifecycleSweep, runWeeklyDigest, runDomainWatch, runLeadFollowups } from '../commerce/lifecycle.ts';

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
  const fromBody = body && typeof body.secret === 'string' ? body.secret : '';
  const fromHeader = req.headers.get('x-system-secret') || '';
  const fromQuery = (() => { try { return new URL(req.url).searchParams.get('secret') || ''; } catch { return ''; } })();
  return fromBody === SCHEDULER_SECRET || fromHeader === SCHEDULER_SECRET || fromQuery === SCHEDULER_SECRET;
}

async function health(): Promise<any> {
  const secrets = validateSecrets();
  // db reachability + a couple of cheap operational reads
  let dbOk = false, activeSites = 0, lastCycle: any = null, failures24h = 0;
  try {
    const ping = await svc('presence_sites?select=id&limit=1');
    dbOk = ping.ok;
    const ent = await svc('presence_entitlements?product=eq.presence&status=eq.active&select=client_id');
    activeSites = (ent.ok && Array.isArray(ent.json)) ? ent.json.length : 0;
    const last = await svc('presence_scheduled_runs?run_type=eq.cycle&order=created_at.desc&select=status,started_at,finished_at,site_id&limit=1');
    lastCycle = last.json?.[0] || null;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const fails = await svc(`presence_scheduled_runs?status=eq.failed&created_at=gte.${since}&select=id`);
    failures24h = (fails.ok && Array.isArray(fails.json)) ? fails.json.length : 0;
  } catch { /* dbOk stays false */ }
  const ok = secrets.ok && dbOk;
  return { ok, secrets, db_ok: dbOk, active_sites: activeSites, last_cycle: lastCycle, failures_last_24h: failures24h, checked_at: new Date().toISOString() };
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
      if (task === 'lifecycle') return json({ data: await runLifecycleSweep(limit) }, 200, cors); // Phase RL: trial expiry + lifecycle comms
      // default cycle ALSO fires any due scheduled publishes, so a single cron tick covers both
      const cycle = await runOperationsCycle({ limit });
      const scheduled = await runDuePublishes(limit);
      const lifecycle = await runLifecycleSweep(limit);   // Phase RL: one cron tick covers the revenue lifecycle too
      const digest = await runWeeklyDigest();             // CP-3: the Monday routine, automated (7-day dedupe)
      const domains = await runDomainWatch(10);           // INF: RDAP expiry+registrar, 24h per-domain dedupe
      const leads = await runLeadFollowups(20);            // CRM: nudge un-replied leads (1–7d old), once per lead
      return json({ data: { ...cycle, scheduled_publishes: { ran: scheduled.ran, failures: scheduled.failures }, lifecycle, digest, domains, leads } }, 200, cors);
    } catch (e) {
      return json({ error: 'run_failed', detail: String((e as Error)?.message || e) }, 502, cors);
    }
  }
  if (route === '/system/health' && method === 'GET') {
    return json({ data: await health() }, 200, cors);
  }
  return json({ error: 'not_found', message: `No system route for ${method} ${route}.` }, 404, cors);
}
