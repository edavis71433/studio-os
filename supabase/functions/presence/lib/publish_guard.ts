// ── Publish guard (Presence CMS Phase 1, M4) ─────────────────────────────────
// Pure decision logic for publish idempotency + the 60-second per-site cooldown.
// No I/O — the route wires these to the DB (the partial unique index + the
// authoritative persisted last_published_at). Kept pure so the rules are unit-
// testable and the route stays a thin orchestration.

export const PUBLISH_COOLDOWN_MS = 60_000;       // 60-second per-site cooldown
export const MAX_IDEMPOTENCY_KEY_LEN = 200;      // reasonable upper bound

/** Parse + validate the `Idempotency-Key` request header.
 *  - absent / empty  → { ok:true, key:null }  (backward-compatible: no dedup)
 *  - valid           → { ok:true, key }
 *  - malformed / too long → { ok:false }       (fail-closed)
 *  Charset covers UUIDs and the usual client-generated key formats; anything
 *  with whitespace/control/exotic characters or over the length cap is rejected.
 */
export function parseIdempotencyKey(raw: string | null | undefined): { ok: true; key: string | null } | { ok: false } {
  if (raw == null) return { ok: true, key: null };
  const k = String(raw).trim();
  if (k === '') return { ok: true, key: null };
  if (k.length > MAX_IDEMPOTENCY_KEY_LEN) return { ok: false };
  if (!/^[A-Za-z0-9._:-]+$/.test(k)) return { ok: false };
  return { ok: true, key: k };
}

/** Milliseconds remaining in the cooldown window since the last successful
 *  publish. 0 = clear (no last publish, unparseable timestamp, or window passed).
 *  Uses the authoritative persisted timestamp — multi-instance safe. Pure. */
export function cooldownRemainingMs(lastPublishedAt: string | null | undefined, nowMs: number, windowMs = PUBLISH_COOLDOWN_MS): number {
  if (!lastPublishedAt) return 0;
  const last = Date.parse(lastPublishedAt);
  if (!Number.isFinite(last)) return 0;
  const remaining = windowMs - (nowMs - last);
  return remaining > 0 ? remaining : 0;
}

/** Map a stored publish row to the /publish response data shape, for an
 *  idempotent replay (same key → same result, no new work). Pure. */
export function replayData(row: { status?: string | null; change_summary?: string | null }): {
  status: 'live' | 'publishing' | 'failed';
  message: string;
  summary: string;
  idempotent_replay: true;
} {
  const s = String(row.status || '');
  const status = s === 'live' ? 'live' : s === 'failed' ? 'failed' : 'publishing';
  const message = status === 'live'
    ? 'Your site is live. Every change you made is now published.'
    : status === 'failed'
      ? 'That publish didn’t complete — start a fresh publish to try again.'
      : 'Your site is being updated — this usually takes under a minute.';
  return { status, message, summary: row.change_summary || 'Publishing your site', idempotent_replay: true };
}
