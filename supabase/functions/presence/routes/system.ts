// ── /system/* — the unattended operations surface (L2) ──────────────────────
// Secret-gated (SCHEDULER_SECRET), no user principal. Handled at the very top of
// the router (before principal resolution) because cron has no session. This is
// how the platform keeps observing, retries failures, and reports its own health
// while no operator is present.
//   POST /system/run     {secret, task?, limit?} — task defaults to 'cycle' (the
//                        15-minute tick); the single tasks are listed in the handler
//   GET  /system/health  the secret in the x-system-secret header (never ?secret=)
import { json } from '../../_shared/http.ts';
import { svc, svcAll, svcCount, tickMemoBegin, tickMemoEnd } from '../lib/db.ts';
import { runOperationsCycle, retryFailedRuns, runDuePublishes, runReconcileStuckPublishes, reapStaleRuns, runWindowExpiries } from '../ops/scheduler.ts';
import { runUptimeHeartbeat } from '../monitor/heartbeat.ts';
import { runGscSync } from '../ops/gsc_sync.ts';
import { readHostPlan, netlifyConfigured } from '../lib/netlify.ts';
import { runGa4Sync } from '../ops/ga4_sync.ts';
import { runRetentionSweep } from '../ops/retention.ts';
import { reapMedia } from '../lib/media_gc.ts';
import { reapSnapshots } from '../lib/snapshot_gc.ts';
import { runRecurringInvoices } from './recurring_invoices.ts';   // sales review item 47: a fresh invoice on a schedule
import { runTrafficSpikes } from '../ops/traffic_spikes.ts';
import { runEmailOutbox } from '../lib/email_outbox.ts';
import { runMonthlyReports } from '../ops/monthly_report.ts';
import { runAiChecks } from '../ops/ai_checks.ts';
import { runRankGridScans } from '../ops/rank_grid_scans.ts';
import { runSiteTrashPurge } from '../ops/site_trash.ts';
import { runCustomerTrashSweep } from '../ops/customer_trash.ts';
import { runFileTrashPurge } from '../ops/file_trash.ts';
import { runDuePosts } from '../ops/scheduled_posts.ts';
import { runLifecycleSweep, runWeeklyDigest, runDomainWatch, runLeadFollowups, runDealFollowups, runRenewalReminders, runInvoiceReminders, runRetainerRenewalNotes, runSalesDocReminders, runReviewRequests, runProspectNurture, runSupportAging, runAgreementRenewalReminders, runBookingReminders, runBookingFollowups, runEmailAuthNudges, runApexDriftWatch, runApprovalReminders } from '../commerce/lifecycle.ts';
import { runScheduledBroadcasts } from '../lib/broadcast.ts';
import { runDeletionSweep } from '../commerce/deletion.ts';
import { runBillingReconcile } from '../commerce/entitlement_sync.ts';
import { runStripeCheck } from '../commerce/stripe_check.ts';   // sales item 130: the daily check against Stripe
import { summarizeHealthCenter } from '../lib/health_center.ts';
import { stockHealth } from '../lib/stock/health.ts';
import { timingSafeEqual } from '../../_shared/hmac.ts';
import { CONNECTED_PROVIDERS } from '../connected/providers.ts';
import { oauthConfigured } from '../connected/auth.ts';
import { heldKeyKind } from '../commerce/stripe.ts';
import { CODE_NEWEST_CHANGE } from '../lib/schema_ledger.ts';
import { runClientReminders } from '../lib/client_reminders.ts';   // builder item 336: to-dos, questionnaires and undated approvals still open after 3 and 7 days

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
  if (name === 'PSI_KEY') return !!(Deno.env.get('PSI_KEY') || Deno.env.get('PSI_API_KEY'));
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
    { name: 'AGENCY_SITE_ID', required: false, enables: 'the OPS_ALERT_EMAIL fallback for operator notifications, on the platform’s OWN agency site only — a site whose presence_identity.email AND owner-client email are both blank falls back to OPS_ALERT_EMAIL when, and only when, its site id matches this value (without it: that last-resort rung does not exist and the notification is skipped with a warn, which is the safe default — sending another tenant’s client activity to the platform operator would be a privacy breach)' },
    { name: 'RESEND_WEBHOOK_SECRET', required: false, enables: 'the Resend bounce/complaint webhook (/email/events) — bounces auto-suppress (without it: the endpoint 404s)' },
    { name: 'NURTURE_DRIP', required: false, enables: 'the day-7 free-review follow-up email (owner-approved outbound; set to 1 to activate)' },
    { name: 'RESEND_INBOUND_SECRET', required: false, enables: 'checking that an email reply coming in really is from Resend (without it: the reply webhook 404s and replies never reach the Inbox)' },
    { name: 'RESEND_INBOUND_DOMAIN', required: false, enables: 'the reply address domain, so a customer’s reply to a sent email lands in the Inbox (without it: replies go to the sender’s own mailbox)' },
    { name: 'PLATFORM_REPLY_TO', required: false, enables: 'the reply-to address on the platform’s own mail (defaults to the studio’s address)' },
  ],
  hosting: [
    { name: 'NETLIFY_AUTH_TOKEN', required: false, enables: 'publishing customer sites (without it: publish fails with a clear config error — nothing goes live)' },
  ],
  domains: [
    { name: 'AWS_ACCESS_KEY_ID', required: false, enables: 'managed domains: DNS we run on Amazon Route 53 (lib/route53.ts), paired with AWS_SECRET_ACCESS_KEY (without both: those routes answer 503)' },
    { name: 'AWS_SECRET_ACCESS_KEY', required: false, enables: 'the Route 53 key’s secret half, for managed domains' },
  ],
  approvals: [
    // builder item 394: every kind of signed link has its own key, made from one root (_shared/link_keys.ts)
    { name: 'LINK_SECRET', required: false, enables: 'the root every signed link’s own key is made from (any long random value; optional: without it APPROVAL_SECRET is the root, else the database key; never the scheduler’s secret). Setting it later breaks no link already sent' },
    { name: 'APPROVAL_SECRET', required: false, enables: 'the root for signed links when LINK_SECRET isn’t set (one-tap approvals, proposals and agreements, booking, form and Join our list links each get a key of their own from it); links signed with it directly before Nov 23 2026 still open until Feb 21 2027' },
    { name: 'PREVIEW_LINK_SECRET', required: false, enables: 'shared draft links’ own key (without it: one made from the link root)' },
    { name: 'STATE_SIGNING_SECRET', required: false, enables: 'an older signing secret, read only to open links signed with it before Nov 23 2026, until Feb 21 2027' },
  ],
  operator: [
    { name: 'OPERATOR_SECRET', required: false, enables: 'the programmatic operator caller (x-operator-secret header) for marketplace/enterprise management (without it: those surfaces are operable only by an interactive staff login)' },
  ],
  ai: [
    { name: 'ANTHROPIC_KEY', required: false, enables: 'AI drafting / concierge / coach (without it: honest "AI unavailable", never filler)' },
    { name: 'VISUAL_MODEL_KEY', required: false, enables: 'AI Visual Studio image generation (gated off without it)' },
    { name: 'REPLICATE_API_TOKEN', required: false, enables: 'the photo editor’s “Cut out the subject” (Replicate; without it the button doesn’t show)' },
    { name: 'CONCIERGE_POLISH', required: false, enables: 'AI polish of the concierge’s answers (set to on; off by default)' },
    { name: 'HELP_POLISH', required: false, enables: 'AI polish of the help answers (set to on; off by default)' },
  ],
  photos: [
    { name: 'PEXELS_API_KEY', required: false, enables: 'the stock photo search (Pexels; without it the search is off)' },
    { name: 'PLACES_KEY', required: false, enables: 'the Prospects page’s business search and the Search tab’s map rank grid (Google Places; without it, finding businesses and scanning say it isn’t switched on)' },
  ],
  push: [
    { name: 'VAPID_PUBLIC_KEY', required: false, enables: 'device notifications (Web Push), paired with VAPID_PRIVATE_KEY (without both: push is cleanly off)' },
    { name: 'VAPID_PRIVATE_KEY', required: false, enables: 'the private half of the device notifications key' },
    { name: 'VAPID_SUBJECT', required: false, enables: 'the contact sent with device notifications (defaults to the support address)' },
  ],
  free_tools: [
    { name: 'TURNSTILE_SECRET', required: false, enables: 'the free tools’ bot check (Cloudflare Turnstile; without it every free scan is refused as unverified)' },
    { name: 'TOOLS_HASH_SALT', required: false, enables: 'salting the free tools’ visitor counters (falls back to the service key)' },
    { name: 'PSI_KEY', required: false, enables: 'Google PageSpeed Insights for the free site review (PSI_API_KEY accepted too; without it the review has no PageSpeed scores)' },
  ],
  // These are the names connected/auth.ts ACTUALLY reads (credsSource): a
  // provider's own CONNECTED_<PROVIDER_KEY>_CLIENT_ID/_SECRET pair, else, for a
  // Google product, the studio's Google app GOOGLE_CLIENT_ID/_SECRET (since Nov 8
  // 2026; before that GOOGLE_* lit nothing here). The OAuth state is SEALED with
  // CONNECTION_ENC_KEY (auth.ts signState); auth.ts doesn't read
  // STATE_SIGNING_SECRET. connected_platform below asks auth.ts itself, so the two can't
  // disagree again.
  connected: [
    { name: 'CONNECTION_ENC_KEY', required: false, enables: 'encrypting connected tokens at rest AND sealing the OAuth state (FAIL-CLOSED: without it, token storage is refused, not faked)' },
    { name: 'GOOGLE_CLIENT_ID', required: false, enables: 'the studio’s Google app (the back office reads with it too). Serves every Google connection that has no CONNECTED_GOOGLE_* pair of its own — paired with GOOGLE_CLIENT_SECRET. The app must list https://app.davisdigitalstudio.com/connections-callback.html (APP_URL) as a redirect and carry each product’s permissions' },
    { name: 'GOOGLE_CLIENT_SECRET', required: false, enables: 'the studio’s Google app’s secret, for the token exchange + silent refresh of those Google connections' },
    { name: 'CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID', required: false, enables: 'optional: a Google app of its own for Search Console, used instead of the studio’s Google app — paired with _CLIENT_SECRET' },
    { name: 'CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET', required: false, enables: 'optional: that app’s secret. Whichever app is used must list https://app.davisdigitalstudio.com/connections-callback.html (APP_URL) as a redirect' },
  ],
  site: [
    { name: 'SITE_URL', required: false, enables: 'the app’s address for every link in an email and every return from Stripe (without it: APP_URL, then app.davisdigitalstudio.com; never the main site, whose pages are gone)' },
    { name: 'APP_URL', required: false, enables: 'the app’s own address: the Google return page, font files and links back to the app (defaults to app.davisdigitalstudio.com)' },
    { name: 'VISITS_SALT', required: false, enables: 'salting the visit counter’s visitor fingerprints (falls back to APPROVAL_SECRET)' },
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
    one_tap_approvals: has('LINK_SECRET') || has('APPROVAL_SECRET') || has('SERVICE_ROLE_KEY'),   // item 394: the link root (the database key at the last)
    operator_management: has('OPERATOR_SECRET'), // marketplace/enterprise via x-operator-secret
    ai: has('ANTHROPIC_KEY'),
    visual_studio: has('VISUAL_MODEL_KEY'),
    // true only when a customer could actually complete a connection today: the
    // encryption key (storage + state sealing) plus a real provider credential
    // PAIR under the name connected/auth.ts reads. Derived from the registry, so
    // flipping a second provider live needs no edit here.
    connected_platform: has('CONNECTION_ENC_KEY') && CONNECTED_PROVIDERS.some((p) =>
      p.status !== 'planned' && oauthConfigured(p.key)),
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
  // constant-time compare — a high-value shared secret must not leak via timing
  return timingSafeEqual(fromBody, SCHEDULER_SECRET) || timingSafeEqual(fromHeader, SCHEDULER_SECRET);
}

const CRON_STALE_MS = 45 * 60_000;   // 3 missed 15-min ticks = the scheduler is dead
const FAILURE_ALARM_24H = 10;        // sustained failures = something systemic
// Builder item 416: a request that crashes writes one ops_errors row (index.ts). More than
// this many in an hour means something is broken for someone, so health turns not-ok and
// the watchdog's email and the outside check (uptime.yml) carry it.
export const CRASH_ALARM_1H = 5;

// ── Builder item 403: every count the health check needs, in one trip ─────────────
// The 5-minute alarm check made 16 or 17 reads, 6 or 7 of them one after another and
// three of them twice, from Ohio, at about 200 ms each: 2.8 s a check, 288 times a day.
// presence_health_counts (migration 0247) answers them all in one database trip. Before
// 0247 the function isn't there (404): the same counts are read as one wave of reads
// side by side, none twice. A database that can't answer at all leaves `counts` null.
export interface HealthCounts {
  active_sites: number; last_cycle: { status: string; started_at: string | null; finished_at: string | null; site_id: string | null } | null;
  failures_24h: number; last_failure: { run_type: string; last_error: string; at: string } | null; stuck_runs: number;   // `at`: the watchdog's SQL reads last_failure->>'at'
  live_sites: number; domains_watched: number; domains_soon: number; ent_paused: number; ent_lapsed: number;
  notices: number; failed_publishes: number; ai_ops: number; paid_publishes_30d: number;
  // builder item 416: crashes (ops_errors rows) in the last hour and day; null when they couldn't be counted
  crashes_1h: number | null; crashes_24h: number | null;
  // builder item 420: the newest database change this database has (presence_change_ledger, 0260); null before 0260
  ledger_newest: number | null; ledger_rows: number | null;
  // builder item 393: kept emails waiting to be tried again, and those given up on in 7 days; null before 0268
  outbox_waiting?: number | null; outbox_failed_7d?: number | null;
}
type CrashesAndLedger = Pick<HealthCounts, 'crashes_1h' | 'crashes_24h' | 'ledger_newest' | 'ledger_rows'>;
// Before migration 0261 the one trip (0247's function) doesn't carry these, so they come in
// three small reads side by side. Before 0260 there's no ledger, and its numbers stay null.
async function readCrashesAndLedger(now: number): Promise<CrashesAndLedger> {
  const since1 = new Date(now - 3600_000).toISOString(), since24 = new Date(now - 24 * 3600_000).toISOString();
  const [c1, c24, ledger] = await Promise.all([
    svcCount(`ops_errors?created_at=gte.${encodeURIComponent(since1)}`),
    svcCount(`ops_errors?created_at=gte.${encodeURIComponent(since24)}`),
    svc('presence_change_ledger?select=number&order=number.desc').catch(() => null),
  ]);
  const rows = ledger && ledger.ok && Array.isArray(ledger.json) ? (ledger.json as Array<{ number: number }>) : null;
  return { crashes_1h: c1, crashes_24h: c24, ledger_newest: rows && rows.length ? Number(rows[0].number) || null : null, ledger_rows: rows ? rows.length : null };
}
const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export async function readHealthCounts(now = Date.now()): Promise<HealthCounts | null> {
  const nowIso = new Date(now).toISOString();
  const r = await svc('rpc/presence_health_counts', { method: 'POST', body: '{}' }).catch(() => null);
  if (r && r.ok && r.json && typeof r.json === 'object' && !Array.isArray(r.json)) {
    const j = r.json as Record<string, unknown>;
    const n = (k: string) => Number(j[k] ?? 0) || 0;
    return {
      active_sites: n('active_sites'), last_cycle: (j.last_cycle as HealthCounts['last_cycle']) || null,
      failures_24h: n('failures_24h'), last_failure: j.last_failure ? { run_type: String((j.last_failure as any).run_type || ''), last_error: String((j.last_failure as any).last_error || '').slice(0, 300), at: String((j.last_failure as any).created_at || '') } : null,
      stuck_runs: n('stuck_runs'), live_sites: n('live_sites'), domains_watched: n('domains_watched'), domains_soon: n('domains_soon'),
      ent_paused: n('ent_paused'), ent_lapsed: n('ent_lapsed'), notices: n('notices'), failed_publishes: n('failed_publishes'), ai_ops: n('ai_ops'), paid_publishes_30d: n('paid_publishes_30d'),
      // with 0261 these come in the same trip; with only 0247, three small reads of their own
      ...('crashes_1h' in j
        ? { crashes_1h: numOrNull(j.crashes_1h), crashes_24h: numOrNull(j.crashes_24h), ledger_newest: numOrNull(j.ledger_newest), ledger_rows: numOrNull(j.ledger_rows) }
        : await readCrashesAndLedger(now)),
      // builder item 393: in the same trip from 0268 on; before it the Health page leaves them out
      ...('outbox_waiting' in j ? { outbox_waiting: numOrNull(j.outbox_waiting), outbox_failed_7d: numOrNull(j.outbox_failed_7d) } : {}),
    };
  }
  if (r && !r.ok && r.status !== 404) return null;
  // before 0247 (404), or an answer that isn't the counts: one wave, side by side, nothing read twice
  const period = nowIso.slice(0, 7);
  const soon = new Date(now + 30 * 86400_000).toISOString();
  const since7 = new Date(now - 7 * 86400_000).toISOString();
  const since24 = new Date(now - 24 * 3600_000).toISOString();
  const since30 = new Date(now - 30 * 86400_000).toISOString();
  const twoHoursAgo = new Date(now - 2 * 3600_000).toISOString();
  try {
    const [entActive, last, failures24h, lf, stuck, live, doms, domsSoon, entPaused, entLapsed, notices, failPub, aiRows, paid, extras] = await Promise.all([
      svcCount('presence_entitlements?product=eq.presence&status=eq.active'),
      // Liveness reads the last FINISHED tick, not the last STARTED one: a chain that dies
      // mid-run keeps inserting fresh 'running' rows, so finish time is the only honest signal.
      svc('presence_scheduled_runs?run_type=in.(tick,cycle)&status=eq.done&finished_at=not.is.null&order=created_at.desc&select=status,started_at,finished_at,site_id&limit=1'),
      svcCount(`presence_scheduled_runs?status=eq.failed&created_at=gte.${encodeURIComponent(since24)}`),
      // the newest failure in its own words, so the watchdog's email can say WHY
      svc(`presence_scheduled_runs?status=eq.failed&created_at=gte.${encodeURIComponent(since24)}&order=created_at.desc&select=run_type,last_error,created_at&limit=1`),
      // runs stuck 'running' past any plausible invocation lifetime: the chain dies before its own reaper
      svcCount(`presence_scheduled_runs?status=eq.running&started_at=lt.${encodeURIComponent(twoHoursAgo)}`),
      svcCount('presence_sites?edition=eq.presence&offline_at=is.null&or=(status.eq.live,last_published_at.not.is.null)'),   // item 261: the one rule (lib/site_live.ts), as a count
      svcCount('presence_sites?custom_domain=not.is.null'),
      svcCount(`presence_sites?custom_domain=not.is.null&domain_expires_at=lte.${encodeURIComponent(soon)}&domain_expires_at=gte.${encodeURIComponent(nowIso)}`),
      svcCount('presence_entitlements?product=eq.presence&status=eq.paused'),
      svcCount('presence_entitlements?product=eq.presence&status=eq.lapsed'),
      svcCount('presence_plan_notices?status=eq.active'),
      svcCount(`presence_publishes?status=eq.failed&created_at=gte.${encodeURIComponent(since7)}`),
      svcAll(`presence_ai_usage?period=eq.${period}&select=client_id,generative_ops,assistive_ops`, 'client_id'),
      svcCount(`presence_publishes?netlify_deploy_id=not.is.null&created_at=gte.${encodeURIComponent(since30)}`),
      readCrashesAndLedger(now),   // builder items 416 and 420, in the same wave
    ]);
    if (!last.ok || entActive === null) return null;
    const row = lf.json?.[0];
    return {
      active_sites: entActive ?? 0, last_cycle: last.json?.[0] || null, failures_24h: failures24h ?? 0,
      last_failure: row ? { run_type: row.run_type, last_error: String(row.last_error || '').slice(0, 300), at: row.created_at } : null,
      stuck_runs: stuck ?? 0, live_sites: live ?? 0, domains_watched: doms ?? 0, domains_soon: domsSoon ?? 0, ent_paused: entPaused ?? 0, ent_lapsed: entLapsed ?? 0,
      notices: notices ?? 0, failed_publishes: failPub ?? 0,
      ai_ops: (aiRows as Array<{ generative_ops?: number; assistive_ops?: number }>).reduce((n, r) => n + (r.generative_ops || 0) + (r.assistive_ops || 0), 0),
      paid_publishes_30d: paid ?? 0,
      ...extras,
    };
  } catch { return null; }
}

// Top-level ok is what the watchdog and the outside check page on, so it must reflect the
// failures a human needs to hear about, not just "the box is on": a database that doesn't
// answer, a dead cron (no COMPLETED tick in 45 min, once one has EVER completed), sustained
// failures or stuck runs, and (builder item 416) more than CRASH_ALARM_1H crashes in an hour.
// Pure, and shared by /system/health and the public /status read, so the two can't disagree.
export function judgeHealth(counts: HealthCounts | null, settingsOk: boolean, now = Date.now()) {
  const dbOk = !!counts;
  const lastCycle = counts?.last_cycle ?? null;
  const lastCycleAt = lastCycle ? Date.parse(lastCycle.finished_at || lastCycle.started_at || '') : NaN;
  const cronStale = Number.isFinite(lastCycleAt) && (now - lastCycleAt) > CRON_STALE_MS;
  const failureAlarm = (counts?.failures_24h ?? 0) >= FAILURE_ALARM_24H || (counts?.stuck_runs ?? 0) > 0;
  const crashAlarm = (counts?.crashes_1h ?? 0) > CRASH_ALARM_1H;
  return { ok: settingsOk && dbOk && !cronStale && !failureAlarm && !crashAlarm, dbOk, cronStale, failureAlarm, crashAlarm };
}

async function health(): Promise<any> {
  const secrets = validateSecrets();
  // db reachability + the operational counts, in one trip (builder item 403)
  const counts = await readHealthCounts();
  const v = judgeHealth(counts, secrets.ok);
  const health_center = await computeHealthCenter(counts).catch(() => null);
  return {
    ok: v.ok, secrets, db_ok: v.dbOk, cron_stale: v.cronStale, failure_alarm: v.failureAlarm, crash_alarm: v.crashAlarm,
    stuck_runs: counts?.stuck_runs ?? 0, active_sites: counts?.active_sites ?? 0, last_cycle: counts?.last_cycle ?? null,
    failures_last_24h: counts?.failures_24h ?? 0, last_failure: counts?.last_failure ?? null,
    // builder item 416: crashes counted (the watchdog's email names the hour's count when it alarms)
    crashes: { last_hour: counts?.crashes_1h ?? null, last_day: counts?.crashes_24h ?? null, alarm_above: CRASH_ALARM_1H },
    // builder item 420: the newest database change here, and the newest the code expects
    changes: { newest: counts?.ledger_newest ?? null, code_newest: CODE_NEWEST_CHANGE },
    health_center, checked_at: new Date().toISOString(),
  };
}

// ── Builder item 417: the public status read ─────────────────────────────────────
// GET /status, no secret and no session: the outside check (.github/workflows/uptime.yml)
// asks it every 15 minutes from GitHub, beside the watchdog that reads /system/health with
// the secret. It answers the same verdict as /system/health, from the same one database
// trip, as true or false per part and nothing else: no counts, no names, no settings'
// names, and no call out to the host or the photo library. A worker answers from its
// last read for 60 seconds, so a burst of callers costs one trip a minute.
const STATUS_MEMO_MS = 60_000;
let statusMemo: { at: number; body: Record<string, unknown> } | null = null;
export async function publicStatus(now = Date.now()): Promise<Record<string, unknown>> {
  if (statusMemo && now - statusMemo.at < STATUS_MEMO_MS) return statusMemo.body;
  const counts = await readHealthCounts(now);
  const settingsOk = validateSecrets().ok;
  const v = judgeHealth(counts, settingsOk, now);
  const body = {
    ok: v.ok, server: true, database: v.dbOk, schedule: v.dbOk && !v.cronStale, failures: v.dbOk && !v.failureAlarm,
    crashes: v.dbOk && !v.crashAlarm, settings: settingsOk, checked_at: new Date(now).toISOString(),
  };
  statusMemo = { at: now, body };
  return body;
}
/** Tests: forget the last answer. */
export function forgetStatusMemo(): void { statusMemo = null; }
export async function handleStatus(_req: Request, cors: Record<string, string>): Promise<Response> {
  return json({ data: await publicStatus() }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

// ── PT-8: the Admin Health Center — ONE unified operational read (no new monitoring).
// Aggregates signals the platform already produces into one status per area.
// Self-contained so it also powers the operator-authenticated /admin/health-center.
// Builder item 403: the counts come in once (readHealthCounts); the health check hands
// in the ones it already read, so nothing is read twice.
export async function computeHealthCenter(counts?: HealthCounts | null): Promise<any> {
  const nowIso = new Date().toISOString();
  const c = counts === undefined ? await readHealthCounts() : counts;
  const lastCycle = c?.last_cycle ?? null;
  const [failedRuns, live, doms, domsSoon, entActive, entPaused, entLapsed, notices, failPub] = [c?.failures_24h, c?.live_sites, c?.domains_watched, c?.domains_soon, c?.active_sites, c?.ent_paused, c?.ent_lapsed, c?.notices, c?.failed_publishes];
  const aiOps = c?.ai_ops ?? 0;

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
    ...(c && c.outbox_waiting !== undefined ? { outbox: { waiting: c.outbox_waiting ?? null, gaveUp7d: c.outbox_failed_7d ?? null } } : {}),   // builder item 393
    sitesLive: live ?? 0,
    failedPublishes: failPub ?? 0,
    failedRuns: failedRuns ?? 0,
    activeNotices: notices ?? 0,
    backupsVerified: envPresent('BACKUPS_VERIFIED'),
    stripeKey: heldKeyKind(),   // sales item 131: restricted or full-power, from the prefix alone
    crashes: { lastHour: c ? c.crashes_1h : null, lastDay: c ? c.crashes_24h : null, alarmAbove: CRASH_ALARM_1H },   // builder item 416
    changesNewest: c ? c.ledger_newest : null,   // builder item 420
    // builder item 403: the two calls out (the host's plan, the photo key) go side by side
    ...await Promise.all([
      netlifyConfigured() ? readHostPlan(nowIso, c?.paid_publishes_30d ?? 0).catch(() => null) : Promise.resolve(null),   // builder list item 269: the host's plan, as the host tells it; the paid publishes it knows of say whether "0 used" can be believed
      stockHealth().catch(() => null),   // item 263: a refused photo key shows here, not only in a failed search
    ]).then(([hosting, stock]) => ({ hosting, stock })),
  });
}

// ── Builder item 416: the newest ten crashes, for the Health page ─────────────────
// Each row is one request that crashed: which route (kind, e.g. "presence:POST /site") and
// the first line of what it said, cut to 300 characters. Operators only (/admin/health-center).
export async function readRecentCrashes(limit = 10): Promise<Array<{ what: string; said: string; at: string }> | null> {
  const r = await svc(`ops_errors?select=kind,detail,created_at&order=created_at.desc&limit=${Math.max(1, Math.min(50, limit))}`).catch(() => null);
  if (!r || !r.ok || !Array.isArray(r.json)) return null;
  return (r.json as Array<{ kind?: string; detail?: string; created_at?: string }>).map((x) => ({
    what: String(x.kind || '').replace(/^presence:/, '').slice(0, 120),
    said: String(x.detail || '').split('\n')[0].slice(0, 300),
    at: String(x.created_at || ''),
  }));
}

// What in this tick deserves a human's attention? ok:false, failures/errors>0,
// or a prune that returned false — but NOT informational falses (skipped_*,
// feature-off flags). Returns human-readable issue strings, empty = clean tick.
// EXPORTED for the predicate test: this function gates what pages the watchdog,
// so its judgment over every sweep's real return shape is pinned by
// tests/presence/sweep_issues_test.mjs (a false positive here = permanent
// alert fatigue; a false negative = silent failures — both have happened).
export function sweepIssues(progress: Record<string, unknown>): string[] {
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

// Builder item 402: the progress note used to be rewritten after every chore (41 writes a
// run, 3,940 a day, on a table that grew to 33 MB). It is still the forensics for a run
// that dies mid-chain (the wall clock, a crash): now it is written when a chore ends and
// NOTE_EVERY_MS have passed since the last note, and at the end with the verdict. A dying
// run's note is at most that many seconds behind.
export const NOTE_EVERY_MS = 3_000;
function progressNote(row: string | null, progress: Record<string, unknown>) {
  let last = Date.now();
  return {
    maybe: async () => {
      if (!row || Date.now() - last < NOTE_EVERY_MS) return;
      last = Date.now();
      await svc(`presence_scheduled_runs?id=eq.${row}`, { method: 'PATCH', body: JSON.stringify({ result: { progress: summarizeProgress(progress) } }) }).catch(() => {});
    },
  };
}

export async function handleSystem(req: Request, route: string, method: string, cors: Record<string, string>): Promise<Response> {
  let body: any = null;
  if (method === 'POST') { try { body = await req.json(); } catch { body = null; } }
  if (!authorized(req, body)) return json({ error: 'forbidden' }, 403, cors);

  if (route === '/system/run' && method === 'POST') {
    const task = String(body?.task || 'cycle');
    const limit = Number.isFinite(body?.limit) ? Math.max(1, Math.min(200, Number(body.limit))) : undefined;
    // Builder item 404: a tiny call every 4 minutes that touches nothing, so the worker the
    // next person meets is already awake (a cold start cost 0.75 to 1.7 s on the first click).
    if (task === 'ping') return json({ data: { ok: true, awake: true } }, 200, cors);
    try {
      if (task === 'retry') return json({ data: await retryFailedRuns(limit) }, 200, cors);
      if (task === 'coach') return json({ data: await runOperationsCycle({ limit, withCoach: true }) }, 200, cors);
      if (task === 'window_expiry') return json({ data: await runWindowExpiries(limit) }, 200, cors);   // Phase EXP: enqueue rewindow re-emits for crossed show-from/until boundaries
      if (task === 'publish') return json({ data: await runDuePublishes(limit) }, 200, cors);   // FD-1 scheduled publishes
      if (task === 'scheduled_posts') return json({ data: await runDuePosts(limit) }, 200, cors);   // builder list item 40: blog posts whose time has come
      if (task === 'reconcile') return json({ data: await runReconcileStuckPublishes(limit) }, 200, cors); // M5: finalize stuck publishes
      if (task === 'heartbeat') return json({ data: await runUptimeHeartbeat(limit ?? 25) }, 200, cors); // uptime: probe live hosted sites
      if (task === 'media_gc') return json({ data: await reapMedia(limit ?? 100) }, 200, cors); // M6: reap soft-deleted + orphaned media
      if (task === 'file_trash') return json({ data: await runFileTrashPurge(limit ?? 100) }, 200, cors); // item 218: empty what's been in a Trash 30 days
      if (task === 'snapshot_gc') return json({ data: await reapSnapshots(limit ?? 200) }, 200, cors); // M7: prune old unreferenced snapshots
      if (task === 'lifecycle') return json({ data: await runLifecycleSweep(limit) }, 200, cors); // Phase RL: trial expiry + lifecycle comms
      if (task === 'deletion') return json({ data: await runDeletionSweep(limit) }, 200, cors);   // P2-E W2: execute eligible account deletions
      if (task === 'reconcile_billing') return json({ data: await runBillingReconcile(limit) }, 200, cors);   // P2-E W7: correct entitlement drift vs Stripe
      if (task === 'stripe_check') return json({ data: await runStripeCheck(limit ? { invoices: limit, retainers: limit, receipts: limit } : {}) }, 200, cors);   // sales item 130
      if (task === 'email_outbox') return json({ data: await runEmailOutbox(limit) }, 200, cors);   // builder item 393: kept emails tried again
      if (task === 'gsc_sync') {
        // Ledgered like the tick groups: the daily pg_cron job's response is
        // discarded by pg_net, so without a ledger row a persistently failing
        // sync (expired refresh token, Google 5xx) is structurally invisible.
        const row = await svc('presence_scheduled_runs', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ run_type: 'gsc_sync', site_id: null, status: 'running', started_at: new Date().toISOString(), attempts: 1 }),
        }).then((r) => r.json?.[0]?.id || null).catch(() => null);
        const res = await runGscSync(limit);
        const issues = sweepIssues({ gsc_sync: res });
        if (row) await svc(`presence_scheduled_runs?id=eq.${row}`, { method: 'PATCH', body: JSON.stringify({ status: issues.length ? 'failed' : 'done', finished_at: new Date().toISOString(), last_error: issues.join('; ').slice(0, 500), result: res }) }).catch(() => {});
        return json({ data: res }, 200, cors);
      }
      if (task === 'ga4_sync') {
        // Ledgered exactly like gsc_sync (the daily pg_cron response is discarded
        // by pg_net — without a ledger row a persistently failing sync is invisible).
        const row = await svc('presence_scheduled_runs', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ run_type: 'ga4_sync', site_id: null, status: 'running', started_at: new Date().toISOString(), attempts: 1 }),
        }).then((r) => r.json?.[0]?.id || null).catch(() => null);
        const res = await runGa4Sync(limit);
        const issues = sweepIssues({ ga4_sync: res });
        if (row) await svc(`presence_scheduled_runs?id=eq.${row}`, { method: 'PATCH', body: JSON.stringify({ status: issues.length ? 'failed' : 'done', finished_at: new Date().toISOString(), last_error: issues.join('; ').slice(0, 500), result: res }) }).catch(() => {});
        return json({ data: res }, 200, cors);
      }

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
            ['scheduled_posts', () => runDuePosts(limit ?? 25)],   // builder list item 40: blog posts whose time has come go live, before the other publishes
            ['window_expiry', () => runWindowExpiries(limit ?? 40)],   // Phase EXP: enqueue rewindow re-emits BEFORE the due-publish fire, so a crossed boundary flips this same tick
            ['scheduled_publishes', () => runDuePublishes(limit)],
            ['reconcile', () => runReconcileStuckPublishes(50)],
            ['heartbeat', () => runUptimeHeartbeat(limit ?? 25)],   // uptime: probe live hosted sites, alert on confirmed outage
          ],
          revenue: [
            ['email_outbox', () => runEmailOutbox()],   // builder item 393: money, sign-in and agreement emails the sending service didn't take, tried again (first, before new mail joins them)
            ['reconcile_billing', () => runBillingReconcile(30)],
            ['stripe_check', () => runStripeCheck()],   // sales item 130: a few invoices and retainers asked about each tick, each once a day, before the reminders
            ['lifecycle', () => runLifecycleSweep(limit)],
            ['deletion', () => runDeletionSweep(25)],
            ['leads', () => runLeadFollowups(20)],
            ['deal_nudges', () => runDealFollowups(20)],
            ['support_aging', () => runSupportAging(20)],
            ['renewals', () => runRenewalReminders(50)],
            ['agreement_renewals', () => runAgreementRenewalReminders(50)],
            ['invoice_nudges', () => runInvoiceReminders(20)],
            ['retainer_notes', () => runRetainerRenewalNotes(20)],   // sales item 163: a week before a yearly retainer charge
            ['doc_reminders', () => runSalesDocReminders(20)],
            ['recurring_invoices', () => runRecurringInvoices(20)],   // item 47: send the recurring invoices that are due (and the heads-up three days before)
            ['approval_reminders', () => runApprovalReminders(50)],   // audit change 8: chase a dated client approval (day before + daily overdue), once a day
            ['client_reminders', () => runClientReminders(50)],   // builder item 336: a to-do, a questionnaire or an undated approval still open after 3 and 7 days
            ['review_requests', () => runReviewRequests(20)],   // list item 29: ask a finished project's client for a review, once, behind the switch
            ['booking_reminders', () => runBookingReminders(50)],   // #164: calm customer reminders (transactional, send-once)
            ['booking_followups', () => runBookingFollowups(50)],   // #164: owner no-show/completion nudge (bell only)
            ['nurture', () => runProspectNurture(10)],
            ['broadcasts', () => runScheduledBroadcasts(25)],   // owner-approved scheduled sends, dispatched at due time
          ],
          hygiene: [
            ['stale_runs', () => reapStaleRuns()],   // FIRST: converts the previous run's stuck rows into countable failures
            ['digest', () => runWeeklyDigest()],
            ['domains', () => runDomainWatch(10)],
            ['traffic_spikes', () => runTrafficSpikes(200)],   // builder list item 47: a busy day of visitors, said once per site per day
            ['monthly_reports', () => runMonthlyReports(20)],   // builder list item 58: last month's report to each switched-on client, on the 4th to 6th of a month
            ['rank_grids', () => runRankGridScans(1)],   // builder list item 185: one switched-on client's monthly map rank grid at most (a few seconds a search)
            ['site_trash', () => runSiteTrashPurge(10)],   // builder list item 154: a site 90 days in a studio's trash is deleted for good
            ['file_trash', () => runFileTrashPurge(100)],   // builder list item 218: a file 30 days in a site's Trash is deleted for good, unless the live site still shows it
            ['customer_trash', () => runCustomerTrashSweep(20)],   // builder list item 241: a customer 30 days in Recently deleted is let go; a bare record goes for good
            ['email_auth', () => runEmailAuthNudges(20)],   // DNS #5: escalate persistent SPF/DMARC/DKIM gaps to one owner nudge
            ['apex_drift', () => runApexDriftWatch(10)],    // DNS: verify the apex still points home; surface drift as a finding
            ['retention', () => runRetentionSweep()],
            ['media_gc', () => reapMedia(100)],
            ['snapshot_gc', () => reapSnapshots(200)],
            ['ai_checks', () => runAiChecks(1)],   // builder list item 182: one client's monthly AI check at most (it takes up to a minute), last
          ],
        };
        const progress: Record<string, unknown> = { group: task };
        const row = await svc('presence_scheduled_runs', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ run_type: 'tick', site_id: null, status: 'running', started_at: new Date().toISOString(), attempts: 1 }),
        }).then((r) => r.json?.[0]?.id || null).catch(() => null);
        const note = progressNote(row, progress);
        tickMemoBegin();
        try {
          for (const [name, fn] of GROUPS[task]) {
            progress[name] = await fn();
            await note.maybe();
          }
        } finally { tickMemoEnd(); }
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
      const note = progressNote(tickRow, progress);
      const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        const res = await fn();
        progress[name] = res;
        await note.maybe();
        return res;
      };
      tickMemoBegin();   // builder item 402: the chores share their reads for this run
      try {

      // The reaper runs FIRST: it converts the PREVIOUS tick's stuck 'running'
      // rows into countable failures. At the end of the chain it would itself
      // be skipped by exactly the mid-chain death it exists to surface.
      await step('stale_runs', () => reapStaleRuns());
      const cycle = await step('cycle', () => runOperationsCycle({ limit }));
      // Phase EXP: enqueue rewindow re-emits for any live site whose windowed section
      // just crossed a boundary — BEFORE the due-publish fire, so it flips this tick.
      await step('scheduled_posts', () => runDuePosts(25));   // builder list item 40: blog posts whose time has come go live, before the other publishes
      const windowExpiry = await step('window_expiry', () => runWindowExpiries(40));
      const scheduled = await step('scheduled_publishes', () => runDuePublishes(limit));
      const reconcile = await step('reconcile', () => runReconcileStuckPublishes(50));   // M5: finalize stuck publishes every tick
      const heartbeat = await step('heartbeat', () => runUptimeHeartbeat(25));   // uptime: probe live hosted sites, alert on confirmed outage (2 fails)
      // P2-E: reconcile billing BEFORE the lifecycle sweep so grace-clock
      // enforcement (W9) acts on Stripe-fresh state (a recovered customer already
      // had grace_until cleared) rather than possibly-stale data.
      await step('email_outbox', () => runEmailOutbox());                          // builder item 393: money, sign-in and agreement emails the sending service didn't take, tried again
      const reconcile_billing = await step('reconcile_billing', () => runBillingReconcile(30));
      await step('stripe_check', () => runStripeCheck());                           // sales item 130: what a lost Stripe message missed, before the invoice reminders ask a client who paid
      const lifecycle = await step('lifecycle', () => runLifecycleSweep(limit));   // Phase RL: the revenue lifecycle
      const deletion = await step('deletion', () => runDeletionSweep(25));         // P2-E W2: eligible account deletions
      const digest = await step('digest', () => runWeeklyDigest());                // CP-3: the Monday routine (7-day dedupe)
      const domains = await step('domains', () => runDomainWatch(10));             // INF: RDAP expiry+registrar, 24h dedupe
      await step('traffic_spikes', () => runTrafficSpikes(200));                   // builder list item 47: a busy day of visitors, once per site per day (day:<date> dedupes)
      await step('monthly_reports', () => runMonthlyReports(20));                  // builder list item 58: last month's report to each switched-on client (last_month dedupes)
      await step('rank_grids', () => runRankGridScans(1));                         // builder list item 185: one switched-on client's monthly map rank grid at most (month claimed first)
      await step('site_trash', () => runSiteTrashPurge(10));                       // builder list item 154: a site 90 days in a studio's trash is deleted for good
      await step('file_trash', () => runFileTrashPurge(100));                      // builder list item 218: a file 30 days in a site's Trash is deleted for good, unless the live site still shows it
      await step('customer_trash', () => runCustomerTrashSweep(20));               // builder list item 241: a customer 30 days in Recently deleted is let go; a bare record goes for good
      const emailAuth = await step('email_auth', () => runEmailAuthNudges(20));     // DNS #5: escalate persistent SPF/DMARC/DKIM gaps → one owner nudge
      const apexDrift = await step('apex_drift', () => runApexDriftWatch(10));       // DNS: verify the apex still points home; surface drift as a finding
      const leads = await step('leads', () => runLeadFollowups(20));               // CRM: nudge un-replied leads, once per lead
      const dealNudges = await step('deal_nudges', () => runDealFollowups(20));    // CRM: nudge stale deals
      const supportAging = await step('support_aging', () => runSupportAging(20)); // service edge #3: nudge owner on aging support requests
      const renewals = await step('renewals', () => runRenewalReminders(50));      // PP-2: annual renewal heads-up
      const agreementRenewals = await step('agreement_renewals', () => runAgreementRenewalReminders(50)); // signed-agreement term-end heads-up (owner-only)
      const invoiceNudges = await step('invoice_nudges', () => runInvoiceReminders(20)); // MONEY: unpaid invoice reminders
      await step('retainer_notes', () => runRetainerRenewalNotes(20));                  // sales item 163: a week before a yearly retainer charge
      const docReminders = await step('doc_reminders', () => runSalesDocReminders(20));  // SALES: unsigned doc reminders
      const recurringInvoices = await step('recurring_invoices', () => runRecurringInvoices(20));  // item 47: recurring invoices due today (and the heads-up three days before)
      const approvalReminders = await step('approval_reminders', () => runApprovalReminders(50)); // audit change 8: chase a dated client approval (day before + daily overdue), once a day
      const clientReminders = await step('client_reminders', () => runClientReminders(50)); // builder item 336: a to-do, a questionnaire or an undated approval still open after 3 and 7 days
      const reviewRequests = await step('review_requests', () => runReviewRequests(20)); // list item 29: ask a finished project's client for a review, once, behind the switch
      const bookingReminders = await step('booking_reminders', () => runBookingReminders(50)); // #164: customer appointment reminders (transactional, send-once)
      const bookingFollowups = await step('booking_followups', () => runBookingFollowups(50)); // #164: owner no-show/completion nudge (bell only, never auto-mark)
      await step('nurture', () => runProspectNurture(10));                        // CRO: day-7 free-review follow-up (owner-gated NURTURE_DRIP=1)
      await step('broadcasts', () => runScheduledBroadcasts(25));                 // BROADCASTS: dispatch owner-approved scheduled sends at their due time
      const retention = await step('retention', () => runRetentionSweep());        // bounded detail tables (visits/terms/ledgers/evidence)
      const media_gc = await step('media_gc', () => reapMedia(100));               // M6: reap soft-deleted + orphan media
      const snapshot_gc = await step('snapshot_gc', () => reapSnapshots(200));     // M7: prune old unreferenced snapshots
      await step('ai_checks', () => runAiChecks(1));                               // builder list item 182: one client's monthly AI check at most, last (it takes up to a minute)

      // Terminal status reflects EVERY sweep, not just the cycle: a persistently
      // failing prune/reminder marks the tick failed → counts toward
      // failures_last_24h → the watchdog pages. Previously visible only inside
      // result.progress, which nobody reads until something else breaks.
      const issues = sweepIssues(progress);
      if (tickRow) await svc(`presence_scheduled_runs?id=eq.${tickRow}`, { method: 'PATCH', body: JSON.stringify({ status: issues.length ? 'failed' : 'done', finished_at: new Date().toISOString(), last_error: issues.join('; ').slice(0, 500), result: { progress: summarizeProgress(progress) } }) }).catch(() => {});
      return json({ data: { ...cycle, window_expiry: { enqueued: windowExpiry.enqueued, scanned: windowExpiry.scanned }, scheduled_publishes: { ran: scheduled.ran, failures: scheduled.failures }, reconcile, heartbeat, media_gc, snapshot_gc, lifecycle, deletion, reconcile_billing, digest, domains, emailAuth, apexDrift, leads, dealNudges, supportAging, renewals, invoiceNudges, docReminders, recurringInvoices, approvalReminders, reviewRequests, bookingReminders, bookingFollowups, retention } }, 200, cors);
      } finally { tickMemoEnd(); }
    } catch (e) {
      return json({ error: 'run_failed', detail: String((e as Error)?.message || e) }, 502, cors);
    }
  }
  if (route === '/system/health' && method === 'GET') {
    return json({ data: await health() }, 200, cors);
  }
  return json({ error: 'not_found', message: `No system route for ${method} ${route}.` }, 404, cors);
}
