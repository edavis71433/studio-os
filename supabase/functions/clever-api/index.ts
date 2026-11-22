import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
// M1 _shared extraction: identity, CORS, and the json helper now live in
// _shared so the future presence function imports the same primitives.
// Behavior is byte-identical; route logic, gates, and tables stay here.
import { corsFor, cors, CORS_ORIGINS } from '../_shared/cors.ts';
import { json } from '../_shared/http.ts';
import {
  verifyStaff, staffRevocation, atLeast, jwtIatMs,
  resolvePrincipal, ROLE_RANK, type Principal,
} from '../_shared/auth.ts';
import { ADMIN_READS, adminReadTable } from './admin_reads.ts';
import { appBase } from '../_shared/app_url.ts';

const RESEND_KEY = Deno.env.get('RESEND_KEY') || '';
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_KEY') || ''; // matches the ANTHROPIC_KEY secret in Supabase
const ERIC = 'eric@davisdigitalstudio.com';
const FROM = 'Davis Digital Studio <noreply@davisdigitalstudio.com>';

// Service-role key + project URL for privileged server-side calls (creating auth users).
// SUPABASE_URL is auto-injected by Supabase into every Edge Function with the
// project's OWN value, so staging talks to staging and prod to prod with no code
// change. The old hardcoded production fallback was a config-only-variance
// violation (Build Brief 2.8): on staging it would have silently pointed writes
// at production. Removed. If the var is ever missing the loud guard below fires.
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// CORS (corsFor + static cors) moved to ../_shared/cors.ts — M1 extraction.

// ============================================================================
//  PART 2a — FAIL-CLOSED STAFF VERIFICATION (replaces the old admin checks)
// ============================================================================
//  WHAT CHANGED vs. the previous version:
//   • verifyAdminJwt        → DELETED (it returned the email even when the
//                             admins lookup was inconclusive: a real hole).
//   • isAuthorizedAdmin     → DELETED (the x-dds-admin shared-secret check).
//   • isAdminRequest        → DELETED (wrapper around the above two).
//   • PRIVILEGED_TYPES set  → DELETED (privilege now comes from role, see gate).
//   • ADMIN_SECRET / ADMIN_EMAILS env reads → DELETED.
//
//  Source of truth is now the `memberships` table (Part 1). EVERY uncertain
//  path returns null. There is no "accept on validated session" fallback.
// ============================================================================

// TENANT_ID moved to ../_shared/auth.ts — M1 extraction.


// verifyStaff, verifyAdminJwt, staffRevocation, ROLE_RANK, atLeast moved to
// ../_shared/auth.ts — M1 extraction. Per-route minimums (ROUTE_MIN_ROLE,
// below) and the gate that applies them stay here: they are route logic.

// Minimum role each privileged route requires. Builder item 213 (Nov 2026): the
// old server keeps only the requests something still sends. Every route listed
// here is the Growth page's (admin-growth.html), the one page still built on this
// function; destructive ones sit at a higher bar. Routes NOT listed are public
// (PUBLIC_ROUTES below).
const ROUTE_MIN_ROLE: Record<string, keyof typeof ROLE_RANK> = {
  admin_query:             'staff',   // GET-only reads (the client and contact pickers)
  // ── Growth Partnership (staff manage; owner for destructive) ──
  partnership_list:        'staff',
  partnership_get:         'staff',
  partnership_upsert:      'admin',
  partnership_delete:      'owner',
  partnership_dashboard:   'staff',
  goal_upsert:             'staff',
  rec_upsert:              'staff',
  rec_decide:              'staff',
  rec_generate:            'staff',
  rec_to_task:             'staff',
  worklog_upsert:          'staff',
  content_upsert:          'staff',
  review_upsert:           'staff',
  review_draft:            'staff',
  review_publish:          'staff',
  note_upsert:             'staff',
  note_delete:             'staff',
  health_upsert:           'staff',
  reminders_feed:          'staff',
};

// ═══ AI MODEL — single source of configuration. When Anthropic deprecates a
// model, this is the ONE line to change (the Growth page's two drafts read it).
const AI_MODEL = 'claude-haiku-4-5-20251001';
const DDS_BUILD = '2026-11-22.1'; // bump on every deploy that renames/removes a route

// Builder item 392 took out the AI gateway (askAI): the help chat was its last user. The
// Growth page's two drafts call the model themselves, below.

// ═══ PAGED READ — silent truncation is a correctness bug at scale: limit=500
// looks fine at 3 clients and quietly under-counts revenue at 50. This pages
// through PostgREST until the result set is complete (bounded at `cap`).
async function svcReadAll(path: string, cap = 5000): Promise<any[]> {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const url = Deno.env.get('SUPABASE_URL') || '';
  if (!key || !url) return [];
  const out: any[] = []; const page = 1000;
  for (let from = 0; from < cap; from += page) {
    try {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Range': `${from}-${from + page - 1}` } });
      if (!r.ok) break;
      const rows = await r.json(); if (!Array.isArray(rows)) break;
      out.push(...rows);
      if (rows.length < page) break; // complete
    } catch { break; }
  }
  return out;
}


// Tables a staffer may READ via admin_query (GET only): the two lists the Growth
// page's pickers load (admin-growth.html). Builder item 213 narrowed this from
// every table the old console once read to what is still asked for. Builder item 392
// (Nov 22 2026 review, file 07 finding 11): the read itself is now written by the
// server, whole, in admin_reads.ts; nothing the page sends reaches the address.
const ADMIN_READ_TABLES = new Set(['clients', 'contacts']);

// ── PUBLIC ROUTES (deny-by-default registry) ──
// Every route type that is legitimately reachable WITHOUT a staff role, each
// with its own protection inside the route, and each with a sender today
// (builder item 213; tests/presence/clever_api_characterization_test.mjs finds
// the sender of every kind this function answers):
//   • whoami: the Growth page asks who is signed in (the three sign-in pages ask the
//     main server since builder item 392, and ask here only until that is live)
//   • version: the deploy's smoke test reads the build stamp
//   • lead_intake: the contact form (contact.html, whose address forwards to the main
//     site); rate-limited
// Builder item 392 took out three: the project survey (now POST /survey on the main
// server), the help chat (its one live page, the portal's terms, no longer loads it) and
// the nightly-data-sync job's run (the job is switched off, and listed for deletion).
// Anything NOT in this set and NOT in ROUTE_MIN_ROLE returns 403. Adding a new
// route now requires an explicit decision about who may call it.
const PUBLIC_ROUTES = new Set([
  'whoami', 'version', 'lead_intake',
]);


// ── Simple in-memory per-IP rate limiter for cost-bearing routes ──
// The public form (lead_intake) is here because it triggers a DB write plus an
// outbound email, and the Growth page's two AI drafts because each costs a model
// call, so an unthrottled loop is a spam/cost vector. NOTE: this limiter is in-memory per instance; the
// durable, table-backed one below runs first and this is its fallback.
const RATE_LIMITED_TYPES = new Set(['rec_generate', 'review_draft', 'lead_intake']);
const RATE_MAX = 12;
const RATE_WINDOW_MS = 60_000;
const rateHits = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

function isRateLimited(req: Request): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const rec = rateHits.get(ip);
  if (!rec || now > rec.resetAt) {
    rateHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  rec.count++;
  return rec.count > RATE_MAX;
}

// ── DURABLE RATE LIMITER (pipeline stage; table-backed via rate_hit RPC) ──
// Replaces the in-memory counter with a durable, cross-instance one. Bucket is
// per-TENANT for authenticated staff, per-IP for everything else (public tools).
// Ceilings stay the current numbers (RATE_MAX / 60s) until entitlements (step 4).
//
// FAIL-SAFE: returns a tri-state so the caller can degrade gracefully. If the DB
// call errors (limiter outage must never take down the public tools), we return
// 'error' and the caller falls back to the in-memory per-IP limiter — so
// throttling is always on, and a limiter hiccup never blocks legitimate traffic.
function rateBucketKey(principal: Principal | null, req: Request): string {
  if (principal && principal.kind === 'staff' && principal.tenantId) return `t:${principal.tenantId}`;
  return `ip:${clientIp(req)}`;
}
async function durableRateCheck(bucketKey: string): Promise<'allowed' | 'limited' | 'error'> {
  try {
    if (!SB_SERVICE) return 'error';
    const windowStart = new Date(Math.floor(Date.now() / RATE_WINDOW_MS) * RATE_WINDOW_MS).toISOString();
    const r = await fetch(`${SB_URL}/rest/v1/rpc/rate_hit`, {
      method: 'POST',
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_bucket: bucketKey, p_window: windowStart, p_max: RATE_MAX }),
      // Hard bound: a hung limiter RPC must not block the request; on timeout we
      // return 'error' and the caller falls back to the in-memory limiter.
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return 'error';
    const allowed = await r.json(); // rate_hit returns boolean: true = allowed
    return allowed === true ? 'allowed' : allowed === false ? 'limited' : 'error';
  } catch (_) {
    return 'error';
  }
}

// json() moved to ../_shared/http.ts — M1 extraction.

// Loud startup guard: SUPABASE_URL is auto-injected; if it is ever empty the
// function cannot reach the database or auth at all. Fail loud in the logs
// rather than silently building broken request URLs.
if (!SB_URL) {
  console.error('[config] SUPABASE_URL is not set — every DB/auth call will fail. This should be auto-injected by Supabase.');
}

// Loud startup guard: if Resend isn't configured, every send will fail. Make
// that obvious in the function logs instead of silently no-opping.
if (!RESEND_KEY) {
  console.error('[email] RESEND_KEY is not set — all Resend emails will fail. Set it as an Edge Function secret.');
}

// Sender identities (deliverability audit, 2026-07-06):
//  - FROM (noreply@) is the SYSTEM sender: internal ops alerts to Eric, where
//    replies are meaningless and deliverability to his own inbox is a non-issue.
//  - CLIENT_OPTS routes CLIENT-FACING relationship/transactional mail from Eric
//    himself, with a real Reply-To, because replies are both a strong inbox
//    signal and on-brand for a studio whose whole promise is a real person who
//    answers. Cold outreach already sends from eric@ separately (unchanged).
// Pass CLIENT_OPTS as the optional 4th arg at a client-facing call site; omit it
// and the send stays exactly as before (system FROM, no Reply-To).
const CLIENT_FROM = `Eric Davis <${ERIC}>`;
const CLIENT_OPTS: { from: string; replyTo: string } = { from: CLIENT_FROM, replyTo: ERIC };

// Core sender. Returns the raw Resend Response so the ~30 existing call sites
// that ignore the return value keep working unchanged. New code should prefer
// emailOk() below, which returns a clean boolean. Failures are always logged
// with the exact Resend status + body so they're visible in dev/prod logs.
// Recipients are MASKED in logs (edge logs are operator-visible + provider-retained).
function maskAddr(e: string): string { return String(e || '').replace(/^(.).*@/, '$1***@'); }
async function sendEmail(to: string, subject: string, html: string, opts?: { from?: string; replyTo?: string; critical?: boolean }) {
  if (!RESEND_KEY) {
    console.error('[email] skipped send to', maskAddr(to), '— RESEND_KEY not configured. Subject:', subject);
    return new Response(JSON.stringify({ error: 'resend_not_configured' }), { status: 500 });
  }
  try {
    // Domain-wide deliverability: honor the SAME suppression store + one-click
    // unsubscribe as the presence sender (_shared/email_infra — ONE module for
    // both functions). One sender ignoring bounces junks the whole domain.
    // critical:true = transactional (login links, signed copies, payment links):
    // survives an OPT-OUT — matching the unsubscribe page's promise — but never
    // a bounce/complaint.
    const { maySend, unsubscribeUrl, unsubscribePageUrl, maskEmail } = await import('../_shared/email_infra.ts');
    const gate = await maySend(to, { critical: !!(opts && opts.critical) });
    if (!gate.ok) {
      console.warn(`[email] suppressed (${gate.reason}) — not sending to`, maskEmail(to), '| subject:', subject);
      return new Response(JSON.stringify({ error: 'recipient_suppressed' }), { status: 200 });
    }
    // Plain-text alternative (spam-scoring + text-only clients), same strip as
    // the presence sender.
    const text = String(html || '')
      .replace(/<\s*(br|\/p|\/div|\/tr|\/h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n').trim();
    // Sales items 74 + 75, as in the presence sender: mail an unsubscribe stops carries the
    // one-click header AND a plain Unsubscribe link at its foot; mail that always arrives
    // (critical: a receipt, an invoice, a quote, a sign-in) carries neither.
    const optional = !(opts && opts.critical);
    const pageUrl = optional ? await unsubscribePageUrl(to) : '';
    const payload: Record<string, unknown> = {
      from: (opts && opts.from) || FROM, to: [to], subject,
      html: optional ? withUnsubscribeLink(html, pageUrl) : html,
      text: optional ? `${text}\n\nUnsubscribe: ${pageUrl}` : text,
      headers: optional ? {
        'List-Unsubscribe': `<${await unsubscribeUrl(to)}>, <mailto:support@davisdigitalstudio.com?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      } : {},
    };
    if (opts && opts.replyTo) payload.reply_to = opts.replyTo;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      let detail = '';
      try { detail = await r.text(); } catch (_) { /* ignore */ }
      console.error('[email] Resend send FAILED', r.status, 'to', maskAddr(to), '| subject:', subject, '| detail:', detail);
    } else {
      console.log('[email] sent to', maskAddr(to), '| subject:', subject);
    }
    return r;
  } catch (e) {
    console.error('[email] Resend send THREW to', maskAddr(to), '| subject:', subject, '|', String(e));
    return new Response(null, { status: 500 });
  }
}

/** Sales item 75: the plain Unsubscribe line at the foot of an email, before </body> when the
 *  email is a whole document. Grey that reads on the dark shell and on a white one. */
function withUnsubscribeLink(html: string, url: string): string {
  if (!/^https:\/\//.test(url)) return html;
  const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const line = `<p style="max-width:560px;margin:0 auto;padding:0 24px 28px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#8a8494;text-align:center">Don’t want these emails? <a href="${safe}" style="color:#8a8494;text-decoration:underline">Unsubscribe</a></p>`;
  const at = String(html || '').search(/<\/body>/i);
  return at >= 0 ? html.slice(0, at) + line + html.slice(at) : String(html || '') + line;
}

// Boolean wrapper for new code paths that want a truthful emailed flag without
// inspecting a Response object. Never throws.
async function emailOk(to: string, subject: string, html: string, opts?: { from?: string; replyTo?: string; critical?: boolean }): Promise<boolean> {
  try {
    const r = await sendEmail(to, subject, html, opts);
    return !!(r && (r as Response).ok);
  } catch (_) {
    return false;
  }
}

function emailWrap(body: string) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0f0820;font-family:'Helvetica Neue',Arial,sans-serif;">${body}</body></html>`;
}

function notifyShell(heading: string, lines: string[], cta?: { label: string; href: string }) {
  // Lines can carry PUBLIC input (lead_intake) — escape them so
  // a submitted message can never inject HTML into the owner's trusted email.
  const escLine = (s: string) => String(s ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] as string));
  return emailWrap(`
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <a href="https://davisdigitalstudio.com" style="font-family:Georgia,serif;font-size:18px;color:#fff;text-decoration:none;display:block;margin-bottom:20px;">Davis<span style="color:#c4aee8;">Digital</span> Studio</a>
      <div style="background:#1e1338;border-radius:16px;padding:28px;">
        <h1 style="font-family:Georgia,serif;font-size:21px;font-weight:400;color:#fff;margin:0 0 14px;">${escLine(heading)}</h1>
        ${lines.map(l => `<p style="font-size:14px;color:rgba(255,255,255,0.65);line-height:1.6;margin:0 0 10px;">${escLine(l)}</p>`).join('')}
        ${cta ? `<div style="text-align:center;margin-top:20px;"><a href="${cta.href}" style="display:inline-block;background:#5b3fa0;color:#fff;font-size:13px;font-weight:600;padding:11px 24px;border-radius:100px;text-decoration:none;">${cta.label}</a></div>` : ''}
      </div>
    </div>
  `);
}


// Builder item 392 took out the nightly job's engine: the data adapters, the signal
// scores, the observation collectors and the opportunity rows they kept. The job
// (nightly-data-sync) was switched off and nothing else read them.


// ════════════════════════════════════════════════════════════════════════════
//  PIPELINE STAGE 1 — TENANT RESOLVER (additive seam; nothing enforces on it yet)
//
//  Runs once per request at the top of serve() and returns a Principal. This is
//  the identity+tenant stage of the request pipeline made a first-class object.
//
//  ADDITIVE ONLY (this phase): the existing authorization gate and every handler
//  are UNCHANGED — they still call verifyStaff / their own JWT checks. Nothing
//  reads this Principal for enforcement. It exists so the next increments
//  (revocation, durable rate limiting, audit) and the later service-role cutover
//  have one place to get {who, which tenant, what role, request id}.
//
//  Contract: NEVER throws (any error resolves to a public principal). Public
//  requests (no JWT, no secret) cost zero I/O. Authenticated requests reuse the
//  same auth/membership lookups the handlers already do — during this seam phase
//  that is briefly redundant with the gate's verifyStaff; it collapses to a
//  single resolution when the gate is cut over to consume the Principal in a
//  later increment.
// ════════════════════════════════════════════════════════════════════════════
// Principal type + jwtIatMs moved to ../_shared/auth.ts — M1 extraction.

// ── AUDIT (pipeline stage; append-only trail via the audit_write RPC) ──
// Writes one row through the SECURITY DEFINER audit_write() function. Best-effort
// by contract (Brief §12 + Eric rule 10): a logging failure NEVER breaks the
// request path. Awaited so the row lands before the response returns (edge
// runtimes may drop background work after the response), but wrapped so it can
// never throw. actor_label prefers the email, else a coarse kind label.
async function auditWrite(
  p: Principal | null,
  eventType: 'action' | 'auth_failure' | 'permission_denied' | 'revoked' | 'rate_limited',
  opts: { route?: string | null; target?: string | null; detail?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    if (!SB_SERVICE) return;
    const label = (p && p.email) ? p.email : (p && p.kind === 'system' ? 'system' : (p && p.userId ? p.userId : 'anon'));
    await fetch(`${SB_URL}/rest/v1/rpc/audit_write`, {
      method: 'POST',
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_request_id: (p && p.requestId) || 'unknown',
        p_event_type: eventType,
        p_tenant_id: (p && p.tenantId) || null,
        p_actor_user_id: (p && p.userId) || null,
        p_actor_label: label,
        p_route: opts.route ?? null,
        p_target: opts.target ?? null,
        p_detail: opts.detail || {},
      }),
      // Hard bound so a hung RPC can never block the request path (the catch
      // handles thrown errors, but only a timeout stops an indefinite await).
      signal: AbortSignal.timeout(2500),
    });
  } catch (_) { /* audit is best-effort; never breaks the request path */ }
}

// resolvePrincipal moved to ../_shared/auth.ts — M1 extraction.


// Per-request CORS on EVERY response. Many routes below still call json()
// without passing reqCors, so they fall back to CORS_ORIGINS[0]. When the
// ALLOWED_ORIGINS secret was reordered (Oct 2026) that silently broke the public
// free tools on davisdigitalstudio.com. Fixing it at the response layer covers
// every route at once: if the caller's origin is on the allowlist, it is what
// the browser gets back, whichever helper built the response.
function withRequestCors(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const res = await handler(req);
    try {
      const origin = req.headers.get('origin') || '';
      if (origin && CORS_ORIGINS.includes(origin) && res.status >= 200 && res.status <= 599 &&
          res.headers.get('Access-Control-Allow-Origin') !== origin) {
        const headers = new Headers(res.headers);
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Vary', 'Origin');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }
    } catch (_) { /* the CORS fix-up must never break a response */ }
    return res;
  };
}
const serveWithRequestCors = (handler: (req: Request) => Promise<Response>) => serve(withRequestCors(handler));

serveWithRequestCors(async (req) => {
  const reqCors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: reqCors });

  try {
    // Routes are POST with a JSON body; a GET with ?type=... is read the same way
    // (the Google OAuth redirect that needed it left with builder item 213).
    let body: any = {};
    const _url = new URL(req.url);
    if (req.method === 'GET') {
      body = Object.fromEntries(_url.searchParams.entries());
    } else {
      try { body = await req.json(); } catch { body = {}; }
      if (!body || !body.type) { const qt = _url.searchParams.get('type'); if (qt) body.type = qt; }
    }
    const { type } = body;

    // ── PIPELINE STAGE 1: resolve the principal once (additive; not enforced) ──
    // Emits one structured log line per request (the request-id logging floor,
    // Brief §13). Nothing below reads `principal` yet — the gate and handlers are
    // unchanged. Wrapped so a resolver hiccup can never affect request handling.
    let principal: Principal | null = null;
    try {
      principal = await resolvePrincipal(req, body);
      console.log(JSON.stringify({ rid: principal.requestId, kind: principal.kind, tenant: principal.tenantId, role: principal.role, route: String(type || '') }));
    } catch (_) { /* resolver is additive; never blocks a request */ }

    // ═══════════════════════════════════════════════════════════════════════
    //  PIPELINE STAGE: REVOCATION (ENFORCED — staff principals only)
    //  Decisions locked by Eric 2026-07-05: immediate reject, no grace period.
    //  Two checks, one combined query
    //  Runs once, up front. Privileged routes (ROUTE_MIN_ROLE) require a real
    //  membership row AND sufficient role. Everything else falls through to its
    //  own handling (public routes, client-portal routes, secret-gated jobs).
    // ═══════════════════════════════════════════════════════════════════════
    {
      const minRole = ROUTE_MIN_ROLE[type as string];
      if (minRole) {
        const staff = await verifyStaff(req);
        if (!staff) { await auditWrite(principal, 'auth_failure', { route: String(type || '') }); return json({ error: 'unauthorized' }, 401, reqCors); }
        if (!atLeast(staff.role, minRole)) { await auditWrite(principal, 'permission_denied', { route: String(type || ''), detail: { required: minRole, has: staff.role } }); return json({ error: 'forbidden' }, 403, reqCors); }
        // REVOCATION: reject a valid staff session when the tenant is
        // suspended/closed/purge_scheduled, or the membership changed after the
        // token was issued. Immediate, fail-closed. Only affects staff-gated
        // routes (public/client routes fall through unchanged).
        const revoked = await staffRevocation(staff.userId, req.headers.get('x-dds-user-jwt') || '');
        if (revoked) { await auditWrite(principal, 'revoked', { route: String(type || ''), detail: { code: revoked.code } }); return json({ error: revoked.code }, revoked.status, reqCors); }
        // AUDIT the authorized privileged action here — EXCEPT for rate-limited
        // types, which log their 'action' only after passing the rate-limit
        // check below (so a request that gets 429'd logs 'rate_limited', not
        // 'action'). Exactly one row per executed privileged action.
        if (!RATE_LIMITED_TYPES.has(String(type))) { await auditWrite(principal, 'action', { route: String(type || '') }); }
      } else if (!PUBLIC_ROUTES.has(String(type))) {
        // Deny-by-default: an unregistered type fails closed here. (The generic
        // notify relay that once answered invented types is gone: builder item
        // 213 removed it with the other routes nothing sends.)
        return json({ error: 'unknown_route' }, 403, reqCors);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  WHOAMI — lightweight identity check (not gated; safe for anyone logged in)
    //  Returns the caller's role if they're a team member, or role:null if not.
    //  Used by set-password.html to send team members to the admin panel and
    //  clients to the client portal. Reveals nothing an attacker couldn't learn
    //  by trying to log in; it only reflects the caller's own membership.
    // ═══════════════════════════════════════════════════════════════════════
    if (type === 'whoami') {
      const staff = await verifyStaff(req);
      if (!staff) return json({ role: null, isTeam: false }, 200, reqCors);
      return json({ role: staff.role, isTeam: true, email: staff.email }, 200, reqCors);
    }


    if (RATE_LIMITED_TYPES.has(type)) {
      // Durable, tenant/IP-keyed limiter; fall back to the in-memory per-IP
      // limiter if the durable check errors (fail-safe: never break public tools
      // on a limiter outage, but stay throttled).
      const durable = await durableRateCheck(rateBucketKey(principal, req));
      const limited = durable === 'limited' ? true : durable === 'error' ? isRateLimited(req) : false;
      if (limited) {
        await auditWrite(principal, 'rate_limited', { route: String(type || '') });
        return json({ error: 'rate_limited', message: 'Too many requests. Please wait a minute and try again.' }, 429, reqCors);
      }
      // passed the limit: log the deferred 'action' row for privileged
      // (staff-gated) rate-limited routes (public ones are not privileged actions).
      if (ROUTE_MIN_ROLE[type as string]) { await auditWrite(principal, 'action', { route: String(type || '') }); }
    }


    // ── ADMIN_QUERY ── (gate: staff) — Part 2c GET-only reads
    // Body: { type:'admin_query', table:'clients' } (the page's old { path } still works:
    // only the part before "?" counts, and it must be exactly 'clients' or 'contacts').
    // The method is hard-coded to GET, so this surface can NEVER mutate, and the whole
    // address is the server's own (admin_reads.ts, builder item 392).
    if (type === 'admin_query') {
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500, reqCors);
      const table = adminReadTable(body);
      if (!table || !ADMIN_READ_TABLES.has(table)) {
        return json({ error: 'table_not_allowed' }, 403, reqCors);
      }
      try {
        const res = await fetch(`${SB_URL}/rest/v1/${ADMIN_READS[table]}`, {
          method: 'GET', // hard-coded — this route cannot mutate
          headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
        });
        const text = await res.text();
        let data: unknown = null;
        try { data = text ? JSON.parse(text) : null; } catch (_e) { data = text; }
        if (!res.ok) return json({ error: 'db_error', status: res.status, detail: data }, 200, reqCors);
        return json({ data }, 200, reqCors);
      } catch (e) {
        return json({ error: 'admin_query_failed', detail: String(e) }, 200, reqCors);
      }
    }


    // ===== LEAD INTAKE (PUBLIC): the contact form on contact.html =====
    // Writes a row in leads (+ lead_messages) and tells Eric.
    if (type === 'lead_intake') {

      const leadDb = async (path: string, method = 'GET', payload: unknown = null) => {
        const headers: Record<string, string> = {
          'apikey': SB_SERVICE,
          'Authorization': `Bearer ${SB_SERVICE}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        };
        const init: RequestInit = { method, headers };
        if (payload !== null && method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(payload);
        const res = await fetch(`${SB_URL}/rest/v1/${path}`, init);
        const text = await res.text();
        let data: unknown = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        return res.ok ? { ok: true, data } : { ok: false, status: res.status, detail: data };
      };

      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const lname    = String(body.name || '').slice(0, 200) || null;
      const lemail   = String(body.email || '').slice(0, 200) || null;
      const lphone   = String(body.phone || '').slice(0, 60) || null;
      const lsource  = ['website_form','instagram','google','phone','email','manual'].includes(body.source) ? body.source : 'website_form';
      const lsubject = String(body.subject || '').slice(0, 200) || null;
      const lmessage = String(body.message || '').slice(0, 4000) || null;
      if (!lmessage && !lsubject) return json({ error: 'message or subject required' }, 400, reqCors);

      const row = {
        name: lname, email: lemail, phone: lphone, source: lsource, subject: lsubject, message: lmessage,
        status: 'new', unread: true,
        last_message: (lmessage || lsubject || '').slice(0, 160),
        last_actor: 'them',
      };
      const created = await leadDb('leads', 'POST', row);
      if (!created.ok) return json({ error: 'lead_create_failed', detail: created.detail }, 200, reqCors);
      const lead = Array.isArray(created.data) ? created.data[0] : created.data;

      if (lead && lead.id && (lmessage || lsubject)) {
        await leadDb('lead_messages', 'POST', { lead_id: lead.id, who: 'them', body: lmessage || lsubject });
      }

      // TWO-DOOR BRIDGE: the owner's working inbox is the Inbox's Enquiries view, which
      // reads presence_form_submissions on the STUDIO's own workspace. Without
      // this insert, marketing-site enquiries reached only an email — never the
      // product's Leads/Pipeline. Resolve the studio workspace via the same
      // ownership chain the connect-workspace SQL creates; skip quietly if the
      // workspace isn't connected yet (the email above still goes out).
      try {
        const H2 = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' };
        const cl = await fetch(`${SB_URL}/rest/v1/clients?email=ilike.${encodeURIComponent('eric@davisdigitalstudio.com')}&select=id&limit=1`, { headers: H2 });
        const clientId = ((await cl.json().catch(() => []))[0] || {}).id;
        if (clientId) {
          const st = await fetch(`${SB_URL}/rest/v1/presence_sites?client_id=eq.${clientId}&select=id&order=created_at.asc&limit=1`, { headers: H2 });
          const studioSiteId = ((await st.json().catch(() => []))[0] || {}).id;
          if (studioSiteId) {
            await fetch(`${SB_URL}/rest/v1/presence_form_submissions`, {
              method: 'POST', headers: { ...H2, Prefer: 'return=minimal' },
              body: JSON.stringify({
                site_id: studioSiteId, form_kind: 'contact',
                name: lname || '', email: lemail || '', phone: lphone || '',
                message: [lsubject, lmessage].filter(Boolean).join(' — ').slice(0, 4000),
                source_page: String(body.source_page || 'davisdigitalstudio.com/contact'),
              }),
            });
          }
        }
      } catch (_) { /* the legacy row + owner email above already captured the lead */ }

      try { await sendEmail(ERIC, `New lead: ${lname || lemail || 'someone'}`,
        notifyShell('New lead in your inbox', [
          `${lname || 'Someone'} just reached out${lsubject ? ` about “${lsubject}”` : ''}.`,
          lmessage ? lmessage.slice(0, 300) : '',
        ], { label: 'Open your enquiries →', href: `${appBase()}/inbox#enquiries` })); } catch (_) {}   // builder item 388: the app's Inbox (the main site's inbox.html is gone)

      // ACKNOWLEDGE THE ENQUIRER — the promise on the contact page ("I reply
      // personally, usually within one business day" + "You'll also get a short
      // email confirming this went through") was made by contact.html but kept
      // by no one: the old contact_reply route had zero callers, so the person
      // who just reached out heard nothing. Same wording as contact_reply had, same
      // CLIENT_OPTS (from Eric, real Reply-To — replying continues the thread).
      // Best-effort: the lead is already recorded and Eric already notified.
      let ackEmailed = false;
      if (lemail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lemail)) {
        try {
          ackEmailed = await emailOk(lemail, `Thanks for reaching out to Davis Digital Studio`,
            notifyShell(`Thanks for reaching out${lname ? `, ${lname}` : ''}`, [
              `I got your message and I'll get back to you personally, usually within one business day.`,
              `In the meantime, feel free to reply to this email with anything else you'd like me to know.`,
              `— Eric Davis, Davis Digital Studio`,
            ], { label: 'See my work →', href: 'https://davisdigitalstudio.com/work' }), CLIENT_OPTS);
        } catch (_) { /* the enquiry itself is safe — never fail intake over the ack */ }
      }

      return json({ ok: true, id: lead && lead.id, acked: ackEmailed }, 200, reqCors);
    }


    // ===== CLIENT TALKING POINTS ===== (gate: staff)
    // Walk into the meeting with this: 4-6 grounded talking points built from
    // the client's real record — metric moves, work delivered, money status,
    // and health. Inside the 60-day renewal window it switches to renewal
    // framing: value recap with proof points. AI narrates facts assembled
    // here and may not invent; deterministic fallback when AI is unavailable.
    // ═══ LIFECYCLE LOOP ═══ (gate: staff)
    // Closes the business loop: Client -> Report -> Renewal -> Retention ->
    // Expansion -> Referral. THIN — it reuses the signals clientReason and the
    // pulse already compute; it invents no new reasoning. It only (a) buckets
    // recurring clients into a lifecycle stage, and (b) records the two
    // loop-closing moments (renewal recorded, referral asked) as timeline
    // events + pipeline, so expansion/referral flow back to the funnel the OS
    // already runs.


    if (type === 'version') {
      // cache-busting handshake: clients compare their embedded build with the
      // server's and hard-refresh once on mismatch, so stale cached HTML never
      // calls renamed routes.
      let dpOn = true;
      try { const s = await svcReadAll('pi_settings?id=eq.1&select=dp_mode_enabled&limit=1'); if (s && s[0]) dpOn = s[0].dp_mode_enabled !== false; } catch (_) {}
      return json({ data: { build: DDS_BUILD, dp_enabled: dpOn } }, 200, reqCors);
    }


    // ===== END AI MANAGER — HOME BRIEFING =====


    // ═══════════════════════════════════════════════════════════════════════
    //  GROWTH PARTNERSHIP ROUTES (post-launch client experience)
    //  Added as a drop-in block. Same conventions as the routes above:
    //  reqCors, json(), SB_SERVICE service-role reads, JWT-scoped client reads.
    //  Staff/role enforcement happens at the central gate via ROUTE_MIN_ROLE.
    // ═══════════════════════════════════════════════════════════════════════
//  top of serve(), or inline per block — shown here as a local for clarity.)
const gpDb = async (path: string, method = 'GET', payload: unknown = null) => {
  const headers: Record<string, string> = {
    'apikey': SB_SERVICE,
    'Authorization': `Bearer ${SB_SERVICE}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
  const init: RequestInit = { method, headers };
  if (payload !== null && method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(payload);
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, init);
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return res.ok ? { ok: true, data } : { ok: false, status: res.status, detail: data };
};
const period = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;


// ════════════════════════════════════════════════════════════════════════════
//  PARTNERSHIPS
// ════════════════════════════════════════════════════════════════════════════

if (type === 'partnership_list') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const seg = ['new_business','established','maintenance','growth'].includes(body.segment) ? body.segment : null;
  const st  = ['onboarding','active','paused','ended'].includes(body.status) ? body.status : null;
  let q = `v_partnership_overview?select=*&order=updated_at.desc&limit=300`;
  if (seg) q += `&segment=eq.${seg}`;
  if (st)  q += `&status=eq.${st}`;
  const r = await gpDb(q);
  if (!r.ok) return json({ error: 'list_failed', detail: r.detail }, 200, reqCors);
  return json({ data: r.data }, 200, reqCors);
}

if (type === 'partnership_get') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const id = String(body.id || '');
  if (!id) return json({ error: 'id required' }, 400, reqCors);
  const [p, goals, recs, tasks, work, content, reviews, notes, health] = await Promise.all([
    gpDb(`v_partnership_overview?id=eq.${id}&select=*&limit=1`),
    gpDb(`partnership_goals?partnership_id=eq.${id}&select=*&order=created_at.desc`),
    gpDb(`recommendations?partnership_id=eq.${id}&select=*&order=created_at.desc`),
    gpDb(`growth_tasks?partnership_id=eq.${id}&select=*&order=priority.asc,created_at.desc`),
    gpDb(`work_log?partnership_id=eq.${id}&select=*&order=done_at.desc&limit=100`),
    gpDb(`content_calendar?partnership_id=eq.${id}&select=*&order=scheduled_for.asc`),
    gpDb(`monthly_reviews?partnership_id=eq.${id}&select=*&order=period.desc`),
    gpDb(`client_notes?partnership_id=eq.${id}&select=*&order=pinned.desc,created_at.desc`),
    gpDb(`health_metrics?partnership_id=eq.${id}&select=*&order=period.desc&limit=12`),
  ]);
  if (!p.ok || !Array.isArray(p.data) || !p.data.length) return json({ error: 'not_found' }, 404, reqCors);
  return json({ data: {
    partnership: p.data[0],
    goals: goals.ok ? goals.data : [],
    recommendations: recs.ok ? recs.data : [],
    tasks: tasks.ok ? tasks.data : [],
    work_log: work.ok ? work.data : [],
    content: content.ok ? content.data : [],
    reviews: reviews.ok ? reviews.data : [],
    notes: notes.ok ? notes.data : [],
    health: health.ok ? health.data : [],
  } }, 200, reqCors);
}

if (type === 'partnership_upsert') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const id = body.id ? String(body.id) : null;
  const allowed = ['client_id','contact_id','segment','status','plan_label',
    'monthly_amount','primary_site','started_at','launched_at','renews_at','health','health_note'];
  const row: Record<string, unknown> = {};
  for (const k of allowed) if (body[k] !== undefined) row[k] = body[k];
  if (!id && !row.client_id && !row.contact_id) return json({ error: 'client_id or contact_id required' }, 400, reqCors);

  let r;
  if (id) r = await gpDb(`partnerships?id=eq.${id}`, 'PATCH', row);
  else {
    // try to backfill launched_at + primary_site from the client's project/site.
    if (!row.launched_at && row.contact_id) {
      const pr = await gpDb(`projects?contact_id=eq.${row.contact_id}&select=launched_at&order=created_at.desc&limit=1`);
      if (pr.ok && Array.isArray(pr.data) && pr.data[0]?.launched_at) row.launched_at = pr.data[0].launched_at;
    }
    r = await gpDb('partnerships', 'POST', row);
  }
  if (!r.ok) return json({ error: 'upsert_failed', detail: r.detail }, 200, reqCors);
  const saved = Array.isArray(r.data) ? r.data[0] : r.data;

  // Onboard side-effects: when a partnership is first created, also add the
  // client's site to the monitoring watchlist (reuses your visibility module).
  if (!id && saved && row.primary_site) {
    let u = String(row.primary_site).trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    await gpDb('monitored_sites', 'POST', {
      label: saved.client_name || u, url: u, source: 'client', client_id: row.client_id || null,
    }).catch(() => {});
  }
  return json({ data: saved }, 200, reqCors);
}

if (type === 'partnership_delete') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const id = String(body.id || '');
  if (!id) return json({ error: 'id required' }, 400, reqCors);
  const r = await gpDb(`partnerships?id=eq.${id}`, 'DELETE');   // cascades children
  if (!r.ok) return json({ error: 'delete_failed', detail: r.detail }, 200, reqCors);
  return json({ ok: true }, 200, reqCors);
}

// The Growth Partnership dashboard: portfolio-wide snapshot for Eric's home.
if (type === 'partnership_dashboard') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const all = await gpDb(`v_partnership_overview?select=*`);
  const rows: any[] = all.ok && Array.isArray(all.data) ? all.data : [];
  const active = rows.filter(r => r.status === 'active' || r.status === 'onboarding');
  const mrr = active.reduce((s, r) => s + (Number(r.monthly_amount) || 0), 0);
  const bySegment: Record<string, number> = {};
  for (const r of rows) bySegment[r.segment] = (bySegment[r.segment] || 0) + 1;

  // renewals in the next 45 days
  const soon = new Date(Date.now() + 45 * 86400000).toISOString();
  const renewals = rows
    .filter(r => r.renews_at && r.renews_at <= soon && r.status !== 'ended')
    .sort((a, b) => String(a.renews_at).localeCompare(String(b.renews_at)));

  const atRisk = rows.filter(r => r.health === 'yellow' || r.health === 'red');
  const needsReview = rows.filter(r => {
    if (r.status === 'ended') return false;
    return r.last_review_period !== period();      // no review published this month
  });
  const pendingRecs = rows.reduce((s, r) => s + (Number(r.pending_recs) || 0), 0);

  return json({ data: {
    counts: {
      activeClients: active.length,
      mrr,
      renewalsSoon: renewals.length,
      atRisk: atRisk.length,
      needsReviewThisMonth: needsReview.length,
      pendingRecs,
    },
    bySegment,
    renewals: renewals.slice(0, 12),
    atRisk: atRisk.slice(0, 12),
    needsReview: needsReview.slice(0, 12),
  } }, 200, reqCors);
}


// ════════════════════════════════════════════════════════════════════════════
//  GOALS · NOTES · CONTENT · WORK LOG · HEALTH  (simple CRUD, staff-gated)
// ════════════════════════════════════════════════════════════════════════════

const simpleUpsert = async (table: string, allowed: string[]) => {
  const id = body.id ? String(body.id) : null;
  const row: Record<string, unknown> = {};
  for (const k of allowed) if (body[k] !== undefined) row[k] = body[k];
  if (id) return gpDb(`${table}?id=eq.${id}`, 'PATCH', row);
  return gpDb(table, 'POST', row);
};

if (type === 'goal_upsert') {
  const r = await simpleUpsert('partnership_goals',
    ['partnership_id','title','detail','metric','target','status','quarter','client_visible']);
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

if (type === 'note_upsert') {
  const r = await simpleUpsert('client_notes', ['partnership_id','kind','body','pinned','remind_at']);
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}
if (type === 'note_delete') {
  const id = String(body.id || ''); if (!id) return json({ error: 'id required' }, 400, reqCors);
  const r = await gpDb(`client_notes?id=eq.${id}`, 'DELETE');
  return r.ok ? json({ ok: true }, 200, reqCors) : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

if (type === 'content_upsert') {
  const r = await simpleUpsert('content_calendar',
    ['partnership_id','title','kind','status','scheduled_for','published_at','notes','client_visible']);
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

if (type === 'worklog_upsert') {
  if (body.period === undefined) body.period = period();
  const r = await simpleUpsert('work_log',
    ['partnership_id','title','detail','category','task_id','period','client_visible','done_at']);
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

if (type === 'health_upsert') {
  if (body.period === undefined) body.period = period();
  // upsert by (partnership_id, period)
  const pid = String(body.partnership_id || '');
  const per = String(body.period);
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);
  const existing = await gpDb(`health_metrics?partnership_id=eq.${pid}&period=eq.${per}&select=id&limit=1`);
  const row: Record<string, unknown> = {};
  for (const k of ['partnership_id','period','calls','forms','bookings','visits','notes']) if (body[k] !== undefined) row[k] = body[k];
  let r;
  if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
    r = await gpDb(`health_metrics?id=eq.${existing.data[0].id}`, 'PATCH', row);
  } else {
    r = await gpDb('health_metrics', 'POST', row);
  }
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}


// ════════════════════════════════════════════════════════════════════════════
//  RECOMMENDATIONS  (Eric-authored + AI-generated, with the review gate)
// ════════════════════════════════════════════════════════════════════════════


if (type === 'rec_upsert') {
  const r = await simpleUpsert('recommendations',
    ['partnership_id','source','category','title','detail','why','effort','impact','status','client_visible']);
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

// approve / share / dismiss / mark done — the review gate in one place.
if (type === 'rec_decide') {
  const id = String(body.id || '');
  const decision = String(body.decision || '');
  if (!id || !['approve','share','dismiss','accept','decline','done'].includes(decision)) {
    return json({ error: 'id and valid decision required' }, 400, reqCors);
  }
  const patch: Record<string, unknown> = { decided_at: new Date().toISOString() };
  if (decision === 'approve') patch.status = 'approved';
  if (decision === 'share')   { patch.status = 'shared'; patch.client_visible = true; patch.shared_at = new Date().toISOString(); }
  if (decision === 'dismiss') { patch.status = 'dismissed'; patch.client_visible = false; }
  if (decision === 'accept')  patch.status = 'accepted';
  if (decision === 'decline') patch.status = 'declined';
  if (decision === 'done')    patch.status = 'done';
  const r = await gpDb(`recommendations?id=eq.${id}`, 'PATCH', patch);
  if (!r.ok) return json({ error: 'failed', detail: r.detail }, 200, reqCors);

  // sharing a rec notifies the client (reuses your notify pattern)
  if (decision === 'share') {
    const rec = Array.isArray(r.data) ? r.data[0] : r.data;
    try {
      const pr = await gpDb(`v_partnership_overview?id=eq.${rec.partnership_id}&select=contact_email,client_email,client_name&limit=1`);
      const row = pr.ok && Array.isArray(pr.data) ? pr.data[0] : null;
      const to = row?.contact_email || row?.client_email;
      if (to) {
        await sendEmail(to, `A recommendation from Eric`,
          notifyShell(`I spotted something worth doing`,
            [rec.title, rec.detail || '', rec.why ? `Why it matters: ${rec.why}` : ''].filter(Boolean),
            { label: 'See it in your workspace →', href: `${appBase()}/portal.html` }), CLIENT_OPTS);
      }
    } catch (_) { /* never block on email */ }
  }
  return json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors);
}

// promote a recommendation into a task on Eric's queue.
if (type === 'rec_to_task') {
  const id = String(body.id || '');
  if (!id) return json({ error: 'id required' }, 400, reqCors);
  const rr = await gpDb(`recommendations?id=eq.${id}&select=*&limit=1`);
  const rec = rr.ok && Array.isArray(rr.data) && rr.data.length ? rr.data[0] : null;
  if (!rec) return json({ error: 'not_found' }, 404, reqCors);
  const prio = rec.impact === 'high' ? 1 : rec.impact === 'low' ? 3 : 2;
  const t = await gpDb('growth_tasks', 'POST', {
    partnership_id: rec.partnership_id,
    title: rec.title,
    detail: rec.detail,
    source: 'recommendation',
    recommendation_id: rec.id,
    priority: prio,
    client_facing_label: rec.title,
  });
  if (!t.ok) return json({ error: 'task_create_failed', detail: t.detail }, 200, reqCors);
  await gpDb(`recommendations?id=eq.${id}`, 'PATCH', { status: rec.status === 'suggested' ? 'approved' : rec.status }).catch(() => {});
  return json({ data: Array.isArray(t.data) ? t.data[0] : t.data }, 200, reqCors);
}


// ── AI: generate "notices" for a partnership, grounded in real data. ─────────
// Pulls the latest site_check + health metrics + goals, asks the model to
// surface a few specific, plain-English opportunities. They land as
// status='suggested', client_visible=false — Eric's review gate.
if (type === 'rec_generate') {
  if (!ANTHROPIC_KEY) return json({ error: 'Server missing ANTHROPIC_KEY secret' }, 500, reqCors);
  const pid = String(body.partnership_id || '');
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);

  const [p, goals, health, recent] = await Promise.all([
    gpDb(`v_partnership_overview?id=eq.${pid}&select=*&limit=1`),
    gpDb(`partnership_goals?partnership_id=eq.${pid}&status=eq.active&select=title,metric,target`),
    gpDb(`health_metrics?partnership_id=eq.${pid}&select=*&order=period.desc&limit=3`),
    gpDb(`recommendations?partnership_id=eq.${pid}&select=title&order=created_at.desc&limit=20`),
  ]);
  const part = p.ok && Array.isArray(p.data) ? p.data[0] : null;
  if (!part) return json({ error: 'not_found' }, 404, reqCors);

  // latest health check for the site, if we monitor it
  let siteCheck: any = null;
  if (part.primary_site) {
    const ms = await gpDb(`monitored_sites?select=id&url=ilike.*${encodeURIComponent(part.primary_site.replace(/^https?:\/\//,''))}*&limit=1`);
    const sid = ms.ok && Array.isArray(ms.data) && ms.data[0]?.id;
    if (sid) {
      const sc = await gpDb(`site_checks?site_id=eq.${sid}&select=overall,performance,visibility,local,findings,checked_at&order=checked_at.desc&limit=1`);
      siteCheck = sc.ok && Array.isArray(sc.data) ? sc.data[0] : null;
    }
  }

  const snapshot = {
    business: part.client_name,
    segment: part.segment,
    site: part.primary_site,
    goals: goals.ok ? goals.data : [],
    health_trend: health.ok ? health.data : [],
    site_check: siteCheck,
    existing_recs: recent.ok ? ((recent as any).data || []).map((x: any) => x.title) : [],
  };

  const system = `You are the strategist inside Davis Digital Studio's platform, helping Eric Davis spot what's worth doing next for a specific client's website and online presence. You are given a real data snapshot. Surface 3 to 5 SPECIFIC, plain-English opportunities a small-business owner would understand. Think like a digital strategist, not a chatbot. Do NOT repeat anything already in existing_recs. Do NOT invent data not supported by the snapshot; if data is thin, base recs on the segment and goals. No em dashes.

Respond with ONLY a JSON array, no markdown, no preamble:
[
  {
    "category": "visibility|local|demand|competitor|seasonal|content|performance",
    "title": "specific, under 12 words",
    "detail": "2 to 3 plain sentences: what it is and what to do",
    "why": "one sentence on why it matters for THIS business",
    "effort": "low|medium|high",
    "impact": "low|medium|high"
  }
]`;
  const userMsg = `SNAPSHOT (JSON):\n${JSON.stringify(snapshot).slice(0, 6000)}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 1500, system, messages: [{ role: 'user', content: userMsg }] }),
      signal: AbortSignal.timeout(40000),
    });
    const aiData = await aiRes.json();
    if (aiData.error) return json({ error: aiData.error.message || 'ai_error' }, 200, reqCors);
    let text = '';
    if (Array.isArray(aiData.content)) text = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    text = (text || '').trim().replace(/```json|```/g, '').trim();
    let arr: any[] = [];
    try { arr = JSON.parse(text); } catch (_) { const m = text.match(/\[[\s\S]*\]/); if (m) { try { arr = JSON.parse(m[0]); } catch (_2) {} } }
    if (!Array.isArray(arr) || !arr.length) return json({ error: 'parse_failed' }, 200, reqCors);

    const CATS = new Set(['visibility','local','demand','competitor','seasonal','content','performance']);
    const LV = new Set(['low','medium','high']);
    const inserted: any[] = [];
    for (const x of arr.slice(0, 5)) {
      const row = {
        partnership_id: pid,
        source: 'ai',
        category: CATS.has(x.category) ? x.category : 'visibility',
        title: String(x.title || '').slice(0, 160),
        detail: String(x.detail || '').slice(0, 600),
        why: String(x.why || '').slice(0, 240),
        effort: LV.has(x.effort) ? x.effort : 'medium',
        impact: LV.has(x.impact) ? x.impact : 'medium',
        status: 'suggested',
        client_visible: false,
      };
      if (!row.title) continue;
      const ins = await gpDb('recommendations', 'POST', row);
      if (ins.ok) inserted.push(Array.isArray(ins.data) ? ins.data[0] : ins.data);
    }
    return json({ data: inserted }, 200, reqCors);
  } catch (e) {
    return json({ error: 'rec_generate_failed', message: String(e) }, 200, reqCors);
  }
}


// ════════════════════════════════════════════════════════════════════════════
//  MONTHLY REVIEWS  (upsert / AI-draft / publish: the Growth page, admin-growth.html)
// ════════════════════════════════════════════════════════════════════════════

if (type === 'review_upsert') {
  if (body.period === undefined) body.period = period();
  // upsert by (partnership_id, period)
  const pid = String(body.partnership_id || '');
  const per = String(body.period);
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);
  const allowed = ['partnership_id','period','improved','work_done','found','next_up','payoff','headline','intro','metrics','status'];
  const row: Record<string, unknown> = {};
  for (const k of allowed) if (body[k] !== undefined) row[k] = body[k];
  const existing = await gpDb(`monthly_reviews?partnership_id=eq.${pid}&period=eq.${per}&select=id&limit=1`);
  let r;
  if (existing.ok && Array.isArray(existing.data) && existing.data.length) r = await gpDb(`monthly_reviews?id=eq.${existing.data[0].id}`, 'PATCH', row);
  else r = await gpDb('monthly_reviews', 'POST', row);
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

// AI-assisted draft: grounds the five sections in this month's real work_log +
// health trend + shared recs. Returns a draft for Eric to edit, never auto-sends.
if (type === 'review_draft') {
  if (!ANTHROPIC_KEY) return json({ error: 'Server missing ANTHROPIC_KEY secret' }, 500, reqCors);
  const pid = String(body.partnership_id || '');
  const per = String(body.period || period());
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);

  const [p, work, health, recs] = await Promise.all([
    gpDb(`v_partnership_overview?id=eq.${pid}&select=*&limit=1`),
    gpDb(`work_log?partnership_id=eq.${pid}&period=eq.${per}&select=title,detail,category`),
    gpDb(`health_metrics?partnership_id=eq.${pid}&select=*&order=period.desc&limit=2`),
    gpDb(`recommendations?partnership_id=eq.${pid}&status=in.(shared,accepted,done)&select=title,why&order=created_at.desc&limit=6`),
  ]);
  const part = p.ok && Array.isArray(p.data) ? p.data[0] : null;
  if (!part) return json({ error: 'not_found' }, 404, reqCors);

  const snapshot = {
    business: part.client_name,
    segment: part.segment,
    month: per,
    work_done: work.ok ? work.data : [],
    health_this_month: health.ok && (health.data as any[])?.[0] ? (health.data as any[])[0] : null,
    health_last_month: health.ok && (health.data as any[])?.[1] ? (health.data as any[])[1] : null,
    recommendations: recs.ok ? recs.data : [],
  };

  const system = `You are Eric Davis writing the monthly review for a Growth Partnership client. Warm, plain, human, direct. No em dashes. No corporate filler. Never invent numbers not in the snapshot. It is OK and good to say a month was quiet if the data is light. Translate website things into business things (customers, calls, found-you-on-Google), not jargon.

Write the five sections of the review. Respond with ONLY this JSON, no markdown:
{
  "headline": "one warm, specific sentence about the month",
  "intro": "2 to 3 warm sentences setting it up, using their name/business naturally",
  "improved": "what got better, in business terms, grounded in the numbers if present",
  "work_done": "what you did this month, plain list folded into a short paragraph",
  "found": "one opportunity or thing you noticed worth their attention",
  "next_up": "one clear recommendation for next month, ready to act on",
  "payoff": "one honest sentence on how the investment is paying off over time"
}`;
  const userMsg = `SNAPSHOT (JSON):\n${JSON.stringify(snapshot).slice(0, 6000)}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 1400, system, messages: [{ role: 'user', content: userMsg }] }),
      signal: AbortSignal.timeout(40000),
    });
    const aiData = await aiRes.json();
    if (aiData.error) return json({ error: aiData.error.message || 'ai_error' }, 200, reqCors);
    let text = '';
    if (Array.isArray(aiData.content)) text = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    text = (text || '').trim().replace(/```json|```/g, '').trim();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch (_) { const m = text.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch (_2) {} } }
    if (!parsed) return json({ error: 'parse_failed' }, 200, reqCors);

    // save as a draft (upsert by partnership+period)
    const row = {
      partnership_id: pid, period: per, status: 'draft',
      headline: parsed.headline || '', intro: parsed.intro || '',
      improved: parsed.improved || '', work_done: parsed.work_done || '',
      found: parsed.found || '', next_up: parsed.next_up || '', payoff: parsed.payoff || '',
      metrics: snapshot.health_this_month || {},
    };
    const existing = await gpDb(`monthly_reviews?partnership_id=eq.${pid}&period=eq.${per}&select=id&limit=1`);
    let saved;
    if (existing.ok && Array.isArray(existing.data) && existing.data.length) saved = await gpDb(`monthly_reviews?id=eq.${existing.data[0].id}`, 'PATCH', row);
    else saved = await gpDb('monthly_reviews', 'POST', row);
    return json({ data: Array.isArray(saved.data) ? saved.data[0] : saved.data }, 200, reqCors);
  } catch (e) {
    return json({ error: 'review_draft_failed', message: String(e) }, 200, reqCors);
  }
}

// publish: flips to published + emails the client the review.
if (type === 'review_publish') {
  const id = String(body.id || '');
  if (!id) return json({ error: 'id required' }, 400, reqCors);
  const rr = await gpDb(`monthly_reviews?id=eq.${id}&select=*&limit=1`);
  const review = rr.ok && Array.isArray(rr.data) && rr.data.length ? rr.data[0] : null;
  if (!review) return json({ error: 'not_found' }, 404, reqCors);

  const r = await gpDb(`monthly_reviews?id=eq.${id}`, 'PATCH', { status: 'published', published_at: new Date().toISOString() });
  if (!r.ok) return json({ error: 'publish_failed', detail: r.detail }, 200, reqCors);

  try {
    const pr = await gpDb(`v_partnership_overview?id=eq.${review.partnership_id}&select=contact_email,client_email,client_name,contact_name&limit=1`);
    const row = pr.ok && Array.isArray(pr.data) ? pr.data[0] : null;
    const to = row?.contact_email || row?.client_email;
    if (to) {
      const name = row?.contact_name || row?.client_name || 'there';
      const body = `
        <p style="font-size:14px;color:rgba(255,255,255,0.7);line-height:1.7;margin:0 0 16px;">${review.intro || ''}</p>
        ${[['What got better', review.improved],['What I did', review.work_done],['What I found', review.found],['What we should do next', review.next_up],['How it\'s paying off', review.payoff]]
          .filter(([_, v]) => v).map(([h, v]) => `
            <div style="margin-bottom:16px;"><div style="font-family:Georgia,serif;font-size:16px;color:#fff;margin-bottom:6px;">${h}</div>
            <div style="font-size:14px;color:rgba(255,255,255,0.65);line-height:1.65;">${String(v).replace(/\n/g,'<br>')}</div></div>`).join('')}
      `;
      await sendEmail(to, review.headline || `Your monthly review from Davis Digital Studio`,
        notifyShell(review.headline || `Your month with Davis Digital Studio`, [body],
          { label: 'See it in your workspace →', href: `${appBase()}/portal.html` }), CLIENT_OPTS);
    }
  } catch (_) { /* never block on email */ }
  return json({ ok: true }, 200, reqCors);
}


// ════════════════════════════════════════════════════════════════════════════
//  RELATIONSHIP REMINDERS  — Eric's "what needs me" across partnerships.
//  Surfaces: due notes/dates, renewals soon, missing reviews, pending recs,
//  at-risk health. One calm, prioritized feed.
// ════════════════════════════════════════════════════════════════════════════
if (type === 'reminders_feed') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const now = new Date();
  const soon = new Date(Date.now() + 14 * 86400000).toISOString();
  const [notes, rows] = await Promise.all([
    gpDb(`client_notes?remind_at=not.is.null&remind_at=lte.${soon}&select=id,partnership_id,body,remind_at&order=remind_at.asc&limit=50`),
    gpDb(`v_partnership_overview?select=*`),
  ]);
  const items: any[] = [];
  for (const n of (notes.ok && Array.isArray(notes.data) ? notes.data : [])) {
    items.push({ kind: 'reminder', partnership_id: n.partnership_id, title: n.body, when: n.remind_at });
  }
  for (const p of (rows.ok && Array.isArray(rows.data) ? rows.data : [])) {
    if (p.status === 'ended') continue;
    if (p.renews_at && p.renews_at <= soon) items.push({ kind: 'renewal', partnership_id: p.id, title: `${p.client_name} renews soon`, when: p.renews_at });
    if (p.health === 'yellow' || p.health === 'red') items.push({ kind: 'at_risk', partnership_id: p.id, title: `${p.client_name} health is ${p.health}`, detail: p.health_note });
    if (p.last_review_period !== period()) items.push({ kind: 'review_due', partnership_id: p.id, title: `${p.client_name} needs this month's review` });
    if (Number(p.pending_recs) > 0) items.push({ kind: 'recs', partnership_id: p.id, title: `${p.pending_recs} AI rec(s) to review for ${p.client_name}` });
  }
  return json({ data: { items: items.slice(0, 40) } }, 200, reqCors);
}


    //  END GROWTH PARTNERSHIP ROUTES

    // ===== end routes =====

    return json({ error: 'Unknown type' }, 400);

  } catch (err) {
    console.error('Edge function error:', err);
    return json({ error: String(err) }, 500);
  }
});