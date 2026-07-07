// ── /system/* — the unattended operations surface (L2) ──────────────────────
// Secret-gated (SCHEDULER_SECRET), no user principal. Handled at the very top of
// the router (before principal resolution) because cron has no session. This is
// how the platform keeps observing, retries failures, and reports its own health
// while no operator is present.
//   POST /system/run     {secret, task?: 'cycle'|'retry'|'coach', limit?}
//   GET  /system/health  ?secret=…   (or x-system-secret header)
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { runOperationsCycle, retryFailedRuns } from '../ops/scheduler.ts';

const SCHEDULER_SECRET = Deno.env.get('SCHEDULER_SECRET') || '';

// Required vs optional secrets — the platform runs degraded but honest without
// the optional ones (AI off, billing off), and cannot run at all without required.
const REQUIRED = ['SUPABASE_URL', 'SERVICE_ROLE_KEY', 'SCHEDULER_SECRET'];
const OPTIONAL = ['SUPABASE_ANON_KEY', 'ANTHROPIC_KEY', 'STRIPE_SECRET', 'BILLING_SYNC_SECRET', 'NETLIFY_AUTH_TOKEN', 'RESEND_KEY'];

function envPresent(name: string): boolean {
  // tolerate the two service-role aliases used across the codebase
  if (name === 'SERVICE_ROLE_KEY') return !!(Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  if (name === 'SUPABASE_URL') return !!(Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL'));
  return !!Deno.env.get(name);
}

export function validateSecrets() {
  const missingRequired = REQUIRED.filter((n) => !envPresent(n));
  const missingOptional = OPTIONAL.filter((n) => !envPresent(n));
  return {
    ok: missingRequired.length === 0,
    required_present: REQUIRED.filter(envPresent),
    missing_required: missingRequired,
    missing_optional: missingOptional,
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
      return json({ data: await runOperationsCycle({ limit }) }, 200, cors);
    } catch (e) {
      return json({ error: 'run_failed', detail: String((e as Error)?.message || e) }, 502, cors);
    }
  }
  if (route === '/system/health' && method === 'GET') {
    return json({ data: await health() }, 200, cors);
  }
  return json({ error: 'not_found', message: `No system route for ${method} ${route}.` }, 404, cors);
}
