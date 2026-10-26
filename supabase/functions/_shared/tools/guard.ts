// ── Free Tools: the gate every scan passes through ───────────────────────────
// Spec order: verify the Turnstile token server side, check rate limits, check
// the cache, check the daily spend cap, and only then run the (paid) scan.
// Rate limits reuse the durable rate_hit() RPC (0008); spend and cache use the
// 0136 tables.
//
// Failure posture: Turnstile and the spend cap fail CLOSED (they are what stops
// a bill); the rate limiter fails OPEN (the spend cap still bounds the cost, and
// a limiter hiccup shouldn't turn every visitor away).

import { CACHE_HOURS, CALENDLY_URL, LIMITS, RESTING_MESSAGE, dailySpendCapUsd, toolsJson, type ToolId } from './config.ts';
import { enc, insert, rpc, select, upsert } from './db.ts';

// ── pure helpers (unit-tested) ───────────────────────────────────────────────

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') || '';
  return (xff.split(',')[0] || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || '').trim() || 'unknown';
}

/** Start of the fixed window containing `now` (UTC hour, UTC day, ISO week from Monday). */
export function windowStart(now: Date, unit: 'hour' | 'day' | 'week'): Date {
  const d = new Date(now.getTime());
  d.setUTCMinutes(0, 0, 0);
  if (unit === 'hour') return d;
  d.setUTCHours(0);
  if (unit === 'day') return d;
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

/** Collapse a free-text input so "Bacchus Kitchen " and "bacchus  kitchen" share a cache slot. */
export const normalizeKeyPart = (s: unknown) =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

/** Site Review caches per URL (host + path); AI Visibility per business + city. */
export function cacheKeyFor(tool: ToolId, input: Record<string, unknown>): string {
  if (tool === 'site_review') {
    const raw = String(input.url || '').trim();
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const host = u.hostname.toLowerCase().replace(/^www\./, '');
      const path = u.pathname.replace(/\/+$/, '') || '';
      return `${host}${path}`;
    } catch { return normalizeKeyPart(raw); }
  }
  return `${normalizeKeyPart(input.business_name)}|${normalizeKeyPart(input.city)}`;
}

export const isEmail = (s: unknown) => typeof s === 'string' && s.length <= 254 && /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(s.trim());

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** IPs and emails are never stored raw in counters: salted hash, truncated. */
export async function hashId(kind: 'ip' | 'email', value: string): Promise<string> {
  const salt = Deno.env.get('TOOLS_HASH_SALT') || Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'dds-tools';
  return (await sha256Hex(`${salt}:${kind}:${value.trim().toLowerCase()}`)).slice(0, 24);
}

// ── checks that call out ─────────────────────────────────────────────────────

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token: unknown, ip: string): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET') || '';
  if (!secret || typeof token !== 'string' || !token || token.length > 4096) return false;
  try {
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    if (ip && ip !== 'unknown') form.append('remoteip', ip);
    const r = await fetch(Deno.env.get('TURNSTILE_VERIFY_URL') || TURNSTILE_VERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(10_000) });
    const out = await r.json();
    return out?.success === true;
  } catch { return false; }
}

/** One durable counter hit. True = allowed. Fails open (see header). */
export async function rateHit(bucket: string, unit: 'hour' | 'day' | 'week', max: number, now = new Date()): Promise<boolean> {
  try {
    return (await rpc<boolean>('rate_hit', { p_bucket: bucket, p_window: windowStart(now, unit).toISOString(), p_max: max })) !== false;
  } catch { return true; }
}

export async function spendCapReached(): Promise<boolean> {
  try {
    const spent = Number(await rpc('tool_spend_today'));
    return !Number.isFinite(spent) || spent >= dailySpendCapUsd();
  } catch { return true; }
}

export async function logUsage(row: { tool: string; kind: 'scan' | 'cache_hit' | 'unlock' | 'blocked'; ip_hash?: string; email?: string | null; report_id?: string | null; cost_usd?: number; note?: string }): Promise<void> {
  try { await insert('tool_usage_log', { cost_usd: 0, ...row }); } catch { /* logging never blocks a visitor */ }
}

/** A fresh cached scan for this key, if any. */
export async function findCached(tool: ToolId, key: string): Promise<string | null> {
  try {
    const rows = await select<{ report_id: string }>(`tool_scan_cache?tool=eq.${tool}&cache_key=eq.${enc(key)}&expires_at=gt.${enc(new Date().toISOString())}&select=report_id&limit=1`);
    return rows[0]?.report_id || null;
  } catch { return null; }
}

export async function storeCache(tool: ToolId, key: string, reportId: string): Promise<void> {
  const expires = new Date(Date.now() + CACHE_HOURS[tool] * 3600_000).toISOString();
  try { await upsert('tool_scan_cache', 'tool,cache_key', { tool, cache_key: key, report_id: reportId, expires_at: expires, created_at: new Date().toISOString() }); } catch { /* a miss next time is fine */ }
}

/** A cache hit gets its OWN locked copy, so one visitor's unlock never opens
 *  another visitor's report. Costs nothing: no scan runs. */
export async function cloneForVisitor(reportId: string): Promise<Record<string, unknown> | null> {
  const rows = await select(`tool_reports?id=eq.${enc(reportId)}&select=tool,input,raw_results,findings,scores&limit=1`);
  if (!rows[0]) return null;
  return await insert('tool_reports', { ...rows[0], unlocked: false, cached_from: reportId });
}

// ── the gate ─────────────────────────────────────────────────────────────────

export type ScanGate =
  | { ok: false; response: Response }
  | { ok: true; ipHash: string; cacheKey: string; cachedReport: Record<string, unknown> | null };

/** Run before any scan. On ok with cachedReport set, return that report's
 *  teaser instead of scanning. On ok without it, scan, then call finishScan. */
export async function beginScan(req: Request, opts: { tool: ToolId; turnstileToken: unknown; input: Record<string, unknown> }): Promise<ScanGate> {
  const ip = clientIp(req);
  const ipHash = await hashId('ip', ip);
  const stop = (status: number, error: string, message: string, note = error): ScanGate => {
    logUsage({ tool: opts.tool, kind: 'blocked', ip_hash: ipHash, note });
    return { ok: false, response: toolsJson(req, { error, message, calendly: CALENDLY_URL }, status) };
  };

  if (!(await verifyTurnstile(opts.turnstileToken, ip))) {
    return stop(403, 'verification_failed', "We couldn't confirm you're a person. Refresh the page and try again.");
  }
  const hourOk = await rateHit(`tools:scan:${ipHash}:h`, 'hour', LIMITS.scansPerHour);
  const dayOk = hourOk && await rateHit(`tools:scan:${ipHash}:d`, 'day', LIMITS.scansPerDay);
  if (!hourOk || !dayOk) {
    return stop(429, 'rate_limited', "You've run a few scans already. Try again later, or book a call and I'll go through your results with you.");
  }

  const cacheKey = cacheKeyFor(opts.tool, opts.input);
  const cachedId = await findCached(opts.tool, cacheKey);
  if (cachedId) {
    const copy = await cloneForVisitor(cachedId).catch(() => null);
    if (copy) {
      logUsage({ tool: opts.tool, kind: 'cache_hit', ip_hash: ipHash, report_id: String(copy.id) });
      return { ok: true, ipHash, cacheKey, cachedReport: copy };
    }
  }

  if (await spendCapReached()) return stop(503, 'resting', RESTING_MESSAGE, 'spend_cap');
  return { ok: true, ipHash, cacheKey, cachedReport: null };
}

/** After a successful scan: log its estimated cost and cache it. */
export async function finishScan(opts: { tool: ToolId; ipHash: string; cacheKey: string; reportId: string; costUsd: number }): Promise<void> {
  await logUsage({ tool: opts.tool, kind: 'scan', ip_hash: opts.ipHash, report_id: opts.reportId, cost_usd: Math.max(0, opts.costUsd || 0) });
  await storeCache(opts.tool, opts.cacheKey, opts.reportId);
}
