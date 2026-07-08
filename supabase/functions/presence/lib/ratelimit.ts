// ── Fixed-window rate limiter (Phase S / FD-M2) ─────────────────────────────
// Wraps the durable, table-backed rate_hit() RPC (migration 0008) — a fixed-window
// counter keyed by an opaque bucket string, shared across function instances (an
// in-memory counter would reset every cold start). Fail-OPEN: if the limiter
// itself errors, the request proceeds (availability > perfect throttling for a
// public form). The presence function had NO throttling on its public write
// routes before this; this closes that abuse surface without new infrastructure.
import { svc } from './db.ts';

/** The caller's best-effort IP, from the edge's forwarded header. */
export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip')?.trim()
    || req.headers.get('x-real-ip')?.trim()
    || 'unknown';
}

/** Floor `now` to the window start (ISO) for a fixed-window bucket. */
function windowStart(windowSec: number): string {
  const ms = windowSec * 1000;
  return new Date(Math.floor(Date.now() / ms) * ms).toISOString();
}

/** Returns true if the hit is ALLOWED, false if the bucket is over `max` in this
 *  window. Fail-open on any limiter error. `bucket` should be a stable opaque key
 *  (e.g. `forms:<ip>` or `forms:<siteId>:<ip>`). */
export async function rateAllow(bucket: string, max: number, windowSec: number): Promise<boolean> {
  try {
    const r = await svc('rpc/rate_hit', {
      method: 'POST',
      body: JSON.stringify({ p_bucket: bucket.slice(0, 200), p_window: windowStart(windowSec), p_max: max }),
    });
    // rate_hit returns a bare boolean; PostgREST wraps it as the body.
    if (!r.ok) return true;                       // limiter unavailable → allow
    return r.json === true || r.json === null;    // true = under cap; null = unparsed → allow
  } catch {
    return true;                                   // fail open
  }
}

/** Standard 429 body — calm, honest, matches the platform's voice. */
export function tooMany(cors: Record<string, string>, retryAfterSec = 60): Response {
  return new Response(JSON.stringify({ error: 'rate_limited', message: 'That’s a lot of requests in a short time — please wait a minute and try again.' }), {
    status: 429,
    headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSec) },
  });
}
