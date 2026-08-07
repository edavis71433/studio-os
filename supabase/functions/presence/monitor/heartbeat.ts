// ── Uptime heartbeat — "always up" made TRUE, not asserted ───────────────────
// The DNS/hosting study's #1 business-continuity gap: website_health.ts only
// INFERRED health from publish state — nothing ever fetched the live URL. If a
// hosted site went dark (DNS lapse, Netlify incident, cert expiry) the platform
// was silent and the owner heard it from a customer first. This closes that.
//
// READ-ONLY, structurally — same safety posture as monitor/external.ts: a
// bounded, short-timeout GET/HEAD of the site's OWN live URL. It can only
// observe; no method here writes to a customer's website.
//
// Reuse (no parallel systems):
//   • the safe-fetch shape (timed() abort + swallow) from monitor/external.ts
//   • the ONE notice model (raiseNotice/clearNotice → bell + email + push) —
//     mirrors publish.ts's publish_failed and connected/store.ts's
//     connection_expired raise-on-fail / clear-on-recover pattern exactly
//   • the branded email path (sendEmail + loadEmailBrand), as runDomainWatch uses
//
// FALSE-ALARM GUARD: a single blip never pages the owner. We alert only on the
// SECOND consecutive failed probe (DOWN_THRESHOLD), remembering the prior probe
// per site in presence_sites.uptime_* (see migration 0094 — owner-apply). The
// decision is a PURE state machine (nextUptimeState) tested without a network.

import { svc } from '../lib/db.ts';
import { raiseNotice, clearNotice } from '../lib/notice.ts';
import { sendEmail } from '../commerce/account.ts';
import { loadEmailBrand } from '../lib/email_brand.ts';

/** Consecutive failed probes required before we call a site confirmed-down.
 *  Two = one blip is forgiven; a real outage still alerts within ~2 ticks. */
export const DOWN_THRESHOLD = 2;

const timed = (ms: number) => AbortSignal.timeout(ms);

// ── URL selection (PURE) ─────────────────────────────────────────────────────
// The live address a visitor actually hits: the customer's own domain first,
// then the Netlify default. Mirrors publish.ts's baseUrl choice so the probe
// hits the SAME origin we publish to.
export interface HeartbeatSite { id: string; custom_domain?: string | null; netlify_site_id?: string | null }
export function pickLiveUrl(site: HeartbeatSite): string | null {
  if (site.custom_domain) return `https://${site.custom_domain}`;
  if (site.netlify_site_id) return `https://${site.netlify_site_id}.netlify.app`;
  return null;
}

// ── The probe (injectable I/O — mocked in tests) ─────────────────────────────
export interface ProbeResult { ok: boolean; https: boolean; status: number; error: string }
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** HEAD (cheap) then GET fallback. "ok" = the site answered 2xx/3xx — reachable
 *  from a visitor's point of view. A thrown fetch (timeout, connection refused,
 *  TLS/cert failure) IS an outage → ok:false, error captured, NEVER re-thrown. */
export async function probeSite(url: string, fetchImpl: FetchLike = fetch): Promise<ProbeResult> {
  const reachable = (r: Response): ProbeResult => ({ ok: r.status >= 200 && r.status < 400, https: r.url.startsWith('https://'), status: r.status, error: '' });
  try {
    const h = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: timed(10_000) });
    // Some hosts reject HEAD (405/501) — fall back to a GET before believing it's down.
    if (h.status === 405 || h.status === 501) {
      const g = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal: timed(10_000) });
      return reachable(g);
    }
    return reachable(h);
  } catch (e1) {
    // HEAD threw — some environments block HEAD entirely. Try GET once before
    // declaring an outage; only if THAT also fails is the site really unreachable.
    try {
      const g = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal: timed(10_000) });
      return reachable(g);
    } catch (e2) {
      return { ok: false, https: url.startsWith('https://'), status: 0, error: String((e2 as Error)?.message || (e1 as Error)?.message || 'unreachable').slice(0, 120) };
    }
  }
}

// ── Confirmed-down state machine (PURE — the tested heart of the feature) ─────
export interface UptimeState { ok: boolean | null; fail_streak: number }   // ok:null = never probed
export type UptimeTransition = 'none' | 'confirmed_down' | 'recovered';
export interface UptimeStep { ok: boolean; fail_streak: number; transition: UptimeTransition }

/** Fold a fresh probe into the prior per-site state. Deterministic, no I/O.
 *   ok → fail  : streak 1, still calm (a single blip never alerts)
 *   fail → fail: streak 2 → 'confirmed_down' (alert once)
 *   down → ok  : 'recovered' (clear + reassure once)
 *   blip → ok  : streak 1 then ok → 'none' (never alerted, so nothing to clear) */
export function nextUptimeState(prior: UptimeState | null, probeOk: boolean): UptimeStep {
  const priorStreak = prior?.fail_streak ?? 0;
  const wasConfirmedDown = priorStreak >= DOWN_THRESHOLD;
  if (probeOk) {
    return { ok: true, fail_streak: 0, transition: wasConfirmedDown ? 'recovered' : 'none' };
  }
  const streak = Math.min(priorStreak + 1, 9);   // capped — no unbounded growth
  const crossed = streak >= DOWN_THRESHOLD && priorStreak < DOWN_THRESHOLD;
  return { ok: false, fail_streak: streak, transition: crossed ? 'confirmed_down' : 'none' };
}

// ── Alert copy (calm, owner-facing) ──────────────────────────────────────────
const DOWN_HEADLINE = 'Your website didn’t respond just now';
const DOWN_BODY = 'We checked your website twice and it didn’t answer — visitors may be seeing an error right now. We’re watching closely and will tell you the moment it’s back. Often this clears on its own within minutes; if it doesn’t, it’s usually the domain or hosting, and we’ll reach out.';
const UP_SUBJECT = 'Good news — your website is back online';
const UP_BODY = '<p>Your website is answering again — visitors can reach it. Nothing more you need to do.</p><p>We’ll keep watching around the clock, as always.</p>';

// ── The sweep — one bounded, best-effort tick over live hosted sites ─────────
export interface HeartbeatResult { ok: true; run_type: 'heartbeat'; checked: number; confirmed_down: number; recovered: number; skipped_unmigrated?: boolean }

const COLS = 'id,client_id,custom_domain,netlify_site_id,uptime_ok,uptime_fail_streak,uptime_checked_at';
const CONCURRENCY = 6;

/** Probe each live hosted site, remember the result, and alert only on a
 *  CONFIRMED outage (2 consecutive fails) / clear on recovery. Best-effort: any
 *  one site's failure — or the whole feature being un-migrated — never throws. */
export async function runUptimeHeartbeat(limit = 25): Promise<HeartbeatResult> {
  const nowIso = new Date().toISOString();
  // Only HOSTED sites we actually serve: edition 'presence', ready/live, with a
  // reachable address. Monitor-edition sites observe someone ELSE's website — not
  // ours to page on. Rotation cursor (uptime_checked_at nulls-first) = fair at scale.
  const q = await svc(
    `presence_sites?edition=eq.presence&status=in.(ready,live)&or=(custom_domain.not.is.null,netlify_site_id.not.is.null)&select=${COLS}&order=uptime_checked_at.asc.nullsfirst&limit=${Math.max(1, Math.min(200, limit))}`,
  ).catch(() => ({ ok: false, json: null }));
  // Pre-apply (migration 0094 not yet run on this env): the uptime_* columns don't
  // exist, PostgREST 400s → we no-op cleanly rather than break the sweep. The
  // feature is simply dormant until the owner applies 0094 (same posture as the
  // P2-D routes awaiting 0075-0079).
  if (!q.ok || !Array.isArray(q.json)) return { ok: true, run_type: 'heartbeat', checked: 0, confirmed_down: 0, recovered: 0, skipped_unmigrated: true };

  const sites = q.json as Array<HeartbeatSite & { client_id: string; uptime_ok: boolean | null; uptime_fail_streak: number | null }>;
  let checked = 0, confirmed_down = 0, recovered = 0;

  // Bounded concurrency: a simple worker pool, so a large fleet is probed in
  // parallel without opening hundreds of sockets at once.
  let cursor = 0;
  const worker = async () => {
    while (cursor < sites.length) {
      const site = sites[cursor++];
      try {
        const url = pickLiveUrl(site);
        if (!url) continue;
        const probe = await probeSite(url);   // swallows its own errors → ok:false
        const prior: UptimeState = { ok: site.uptime_ok, fail_streak: Number(site.uptime_fail_streak) || 0 };
        const nextStep = nextUptimeState(prior, probe.ok);
        checked++;
        // Persist the new per-site state (best-effort; a PATCH failure is non-fatal).
        await svc(`presence_sites?id=eq.${site.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ uptime_ok: nextStep.ok, uptime_fail_streak: nextStep.fail_streak, uptime_checked_at: nowIso }),
        }).catch(() => {});

        if (nextStep.transition === 'confirmed_down') {
          confirmed_down++;
          await onConfirmedDown(site, url).catch(() => {});
        } else if (nextStep.transition === 'recovered') {
          recovered++;
          await onRecovered(site).catch(() => {});
        }
      } catch { /* best-effort — one site never stops the sweep */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sites.length) }, () => worker()));
  return { ok: true, run_type: 'heartbeat', checked, confirmed_down, recovered };
}

// Confirmed outage → the ONE notice model (bell + push, both idempotent via the
// unique client/kind/period key) + a calm branded email, sent exactly once per
// outage (raiseNotice returns fresh only on first insert).
async function onConfirmedDown(site: HeartbeatSite & { client_id: string }, url: string): Promise<void> {
  const period = `site:${site.id}`;
  const fresh = await raiseNotice({ siteId: site.id, clientId: site.client_id, kind: 'site_down', period, headline: DOWN_HEADLINE, body: DOWN_BODY });
  if (!fresh) return;   // already raised for this outage — don't re-email/re-push
  // customer email, on their brand (reuses the ONE branded send path)
  const cl = await svc(`clients?id=eq.${encodeURIComponent(site.client_id)}&select=email&limit=1`).catch(() => ({ json: null as any }));
  const email = cl.json?.[0]?.email;
  if (email) {
    const brand = await loadEmailBrand(site.id).catch(() => undefined);
    await sendEmail(email, DOWN_HEADLINE, `<p>${DOWN_BODY}</p>`, brand, { critical: true }).catch(() => {});
  }
  // operator heads-up too — a customer outage is worth an ops eye. critical:true
  // for the same reason the customer's copy above carries it: this is
  // OPERATIONAL mail to the platform operator about his own platform, and a
  // marketing opt-out must not be able to silence "a site is down". (A
  // bounce/complaint still suppresses it — account.ts:112-116.)
  const ops = Deno.env.get('OPS_ALERT_EMAIL') || '';
  if (ops) sendEmail(ops, `[Studio OS ops] Site down: ${url}`, `<p>${url} failed ${DOWN_THRESHOLD} consecutive uptime probes. The owner has been notified; we clear it automatically on recovery.</p>`, undefined, { critical: true }).catch(() => {});
}

// Recovery → clear the down notice (idempotent) + one calm "back online" email.
async function onRecovered(site: HeartbeatSite & { client_id: string }): Promise<void> {
  await clearNotice(site.client_id, 'site_down', `site:${site.id}`);
  const cl = await svc(`clients?id=eq.${encodeURIComponent(site.client_id)}&select=email&limit=1`).catch(() => ({ json: null as any }));
  const email = cl.json?.[0]?.email;
  if (email) {
    const brand = await loadEmailBrand(site.id).catch(() => undefined);
    await sendEmail(email, UP_SUBJECT, UP_BODY, brand, { critical: true }).catch(() => {});
  }
}
