// ── Phase T · Preview Environment helpers (FD-T20) ───────────────────────────
// The Preview badge + password hashing + token. The badge is a template-agnostic
// pass over rendered HTML (mirrors injectDevLayer/injectAnalytics) so EVERY
// template's preview carries an honest "this is a preview, not your live site"
// banner. Passwords are hashed (never stored plaintext). Pure where it can be.
import { describeChanges } from './diff.ts';
import type { SnapshotContent } from './render_types.ts';

/** A fixed, self-contained preview banner (no external assets, respects reduced
 *  motion by having none). Announced to assistive tech via role="status". */
export function previewBadgeHtml(businessName: string): string {
  const name = String(businessName || 'this site').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c));
  return `<div id="presence-preview-badge" role="status" style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#3a2470;color:#fff;font:600 13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;padding:9px 16px;text-align:center;box-shadow:0 -2px 12px rgba(0,0,0,.18)">🔒 Preview of ${name} — this is not the live site. Changes appear here before you promote them to Live.</div>`;
}

/** Inject the preview badge before </body> in every HTML file. Pure. Idempotent
 *  (skips a doc that already carries the marker). */
export function injectPreviewBadge(html: string, businessName: string): string {
  if (typeof html !== 'string' || html.includes('id="presence-preview-badge"')) return html;
  const badge = previewBadgeHtml(businessName);
  return html.includes('</body>') ? html.replace('</body>', `${badge}</body>`) : `${html}${badge}`;
}

/** SHA-256 hex of a preview password. Deterministic → testable. Empty → '' (no
 *  password = an open share link). */
export async function hashPreviewPassword(pw: string): Promise<string> {
  const clean = String(pw || '').trim();
  if (!clean) return '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A fresh, unguessable share token for a preview URL. Runtime (not pure). */
export function newPreviewToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
}

/** Shape the three-state status for the management surface. Pure. */
export interface PreviewStatus {
  draft: { unpublished_changes: number };
  preview: { exists: boolean; url: string | null; updated_at: string | null; has_password: boolean };
  live: { published: boolean; last_published_at: string | null; summary: string | null; offline_since: string | null };
}
export function shapePreviewStatus(input: {
  draftChanges: number;
  preview: { token: string | null; snapshot_id: string | null; updated_at: string | null; password_hash: string | null } | null;
  live: { last_published_at: string | null; summary: string | null } | null;
  baseUrl: string;
  offlineAt?: string | null;   // G10: when the owner took the site offline (null/absent = online)
}): PreviewStatus {
  const p = input.preview;
  return {
    draft: { unpublished_changes: Math.max(0, input.draftChanges | 0) },
    preview: {
      exists: !!(p && p.snapshot_id && p.token),
      url: p && p.token ? `${input.baseUrl.replace(/\/$/, '')}/functions/v1/presence/p/${p.token}` : null,
      updated_at: p?.updated_at ?? null,
      has_password: !!(p && p.password_hash),
    },
    live: { published: !!(input.live && input.live.last_published_at), last_published_at: input.live?.last_published_at ?? null, summary: input.live?.summary ?? null, offline_since: input.offlineAt ?? null },
  };
}

// ── Version tools · pure helpers (Compare · Timewarp · Checkpoint names) ──────
// These three features are almost entirely WIRING over engines that already
// exist — the change-sentence engine (lib/diff.ts describeChanges), the preview
// renderer (routes/preview.ts, reached by publish_id/launch_id), and the draft
// capture path (lib/staging.ts captureDraftSnapshot). The only genuinely new
// logic is pure and lives here so it is unit-testable without a database.

/** Compare ANY two versions in the SAME plain-language sentences the publish
 *  sheet uses. `describeChanges(draft, live)` reads "what the draft does relative
 *  to live", so to describe going FROM one version TO another we feed the TO
 *  content as the draft and the FROM content as the live baseline. One engine,
 *  never a second differ. Pure. */
export function describeVersionDiff(fromContent: SnapshotContent, toContent: SnapshotContent): ReturnType<typeof describeChanges> {
  return describeChanges(toContent, fromContent);
}

/** Trim + cap a checkpoint name; empty → a sensible default. Mirrors
 *  cleanLaunchName (checkpoints ride the same named-snapshot substrate) but with
 *  checkpoint wording. Pure. */
export function cleanCheckpointName(raw: unknown): string {
  let s = '';
  for (const ch of String(raw ?? '')) { const c = ch.codePointAt(0)!; if (c >= 32) s += ch; }
  s = s.replace(/\s+/g, ' ').trim().slice(0, 80);
  return s || 'Checkpoint';
}

// Timewarp: "see your site as it looked on {date}". A version was LIVE at a given
// moment if it is the most-recent live publish whose effective time is at or
// before that moment. Bounded to RETAINED versions — honest when a date predates
// what we still keep.
export interface TimewarpVersion { publish_id: string; effective_at: string; label?: string }
export type TimewarpResolution =
  | { ok: true; publish_id: string; effective_at: string; label: string; is_current: boolean }
  | { ok: false; reason: 'bad_date' | 'no_versions' | 'out_of_retention'; earliest_at?: string };

/** Resolve the retained version that was live at `targetIso`. Pure (all inputs
 *  injected). `out_of_retention` = the date is older than the earliest version we
 *  still keep (the honest boundary of the ~20-snapshot retention window). */
export function resolveTimewarpTarget(versions: TimewarpVersion[], targetIso: string): TimewarpResolution {
  const target = Date.parse(targetIso);
  if (!Number.isFinite(target)) return { ok: false, reason: 'bad_date' };
  const parsed = versions
    .map((v) => ({ ...v, t: Date.parse(v.effective_at) }))
    .filter((v) => Number.isFinite(v.t))
    .sort((a, b) => a.t - b.t); // oldest first
  if (!parsed.length) return { ok: false, reason: 'no_versions' };
  let chosen: (typeof parsed)[number] | null = null;
  for (const v of parsed) { if (v.t <= target) chosen = v; else break; }
  if (!chosen) return { ok: false, reason: 'out_of_retention', earliest_at: parsed[0].effective_at };
  const newest = parsed[parsed.length - 1];
  return { ok: true, publish_id: chosen.publish_id, effective_at: chosen.effective_at, label: chosen.label || '', is_current: chosen.publish_id === newest.publish_id };
}

/** Normalize a Timewarp date input. A bare `YYYY-MM-DD` means "as it looked on
 *  that day" → the END of that day (UTC), so a version published earlier that day
 *  is included. A full ISO timestamp is used as-is. Pure. */
export function normalizeTimewarpDate(raw: string): string {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T23:59:59.999Z`;
  return s;
}
