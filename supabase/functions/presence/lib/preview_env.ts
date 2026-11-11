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
  return `<div id="presence-preview-badge" role="status" style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#3a2470;color:#fff;font:600 13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;padding:9px 16px;text-align:center;box-shadow:0 -2px 12px rgba(0,0,0,.18)">🔒 Preview of ${name} — this is not the live site. Changes appear here before you publish them.</div>`;
}

/** Inject the preview badge before </body> in every HTML file. Pure. Idempotent
 *  (skips a doc that already carries the marker). */
export function injectPreviewBadge(html: string, businessName: string): string {
  if (typeof html !== 'string' || html.includes('id="presence-preview-badge"')) return html;
  const badge = previewBadgeHtml(businessName);
  return html.includes('</body>') ? html.replace('</body>', `${badge}</body>`) : `${html}${badge}`;
}

/** Item 60: a draft is drawn from the app, where the published site's /img/ files don't
 *  exist. Swap each image address for its signed one: the plain src, and every candidate
 *  inside a srcset (a <picture>'s sources and the <img>'s own). A srcset with a candidate
 *  we couldn't sign is dropped, because a browser never falls back from a broken srcset
 *  candidate to the src; a picture <source> left with nothing to offer goes too. Pure. */
export function signPreviewImages(html: string, urls: Record<string, string>): string {
  if (typeof html !== 'string') return html;
  let out = html.replace(/\ssrcset="([^"]*)"/g, (_m, set: string) => {
    const signed = set.split(',').map((c) => c.trim()).filter(Boolean).map((c) => {
      const [u, ...rest] = c.split(/\s+/);
      return urls[u] ? [urls[u], ...rest].join(' ') : null;
    });
    return signed.length && signed.every(Boolean) ? ` srcset="${signed.join(', ')}"` : '';
  });
  out = out.replace(/<source\b(?![^>]*\ssrcset=)[^>]*\stype="image\/[^"]*"[^>]*>/g, '');
  for (const [outPath, signed] of Object.entries(urls)) out = out.replaceAll(`"${outPath}"`, `"${signed}"`);
  return out;
}

/** A shared draft link is served from the functions host, where the site's /fonts/library/
 *  files don't exist; point them at the app, which serves the same files. Pure. */
export function absoluteLibraryFonts(html: string, appUrl: string): string {
  if (typeof html !== 'string') return html;
  return html.replaceAll('url(/fonts/library/', `url(${appUrl.replace(/\/$/, '')}/fonts/library/`);
}

/** SHA-256 hex of a preview password. Deterministic → testable. Empty → '' (no
 *  password = an open share link). */

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h: string): Uint8Array<ArrayBuffer> => new Uint8Array((h.match(/../g) || []).map((x) => parseInt(x, 16)));
const sameText = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const PW_ITERATIONS = 60_000;
async function pbkdf2(pw: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** Item 74: a preview password, stored salted and stretched ("pbkdf2$iterations$salt$hash"),
 *  never as typed. Empty → '' (no password = an open share link). */
export async function hashPreviewPassword(pw: string): Promise<string> {
  const clean = String(pw || '').trim();
  if (!clean) return '';
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PW_ITERATIONS}$${hex(salt)}$${await pbkdf2(clean, salt, PW_ITERATIONS)}`;
}

/** Does this password match what's stored? Reads the salted form, and the plain SHA-256
 *  hex every password set before item 74 was stored as, so those keep working. */
export async function verifyPreviewPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  const clean = String(pw || '').trim();
  if (!clean || !stored) return false;
  const parts = stored.split('$');
  if (parts[0] === 'pbkdf2' && parts.length === 4) {
    const n = Number(parts[1]);
    if (!Number.isInteger(n) || n < 1000 || n > 1_000_000) return false;
    return sameText(await pbkdf2(clean, unhex(parts[2]), n), parts[3]);
  }
  return sameText(hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean))), stored);
}

/** After the right password, the viewer keeps a short-lived pass instead of the password:
 *  "<expiry>.<signature>" over the link and the stored hash, so changing the password or
 *  resetting the link ends every pass. */
export async function mintPreviewPass(token: string, passwordHash: string, secret: string, nowSec: number, ttlSec = 12 * 3600): Promise<string> {
  const exp = nowSec + ttlSec;
  return `${exp}.${await hmacHex(secret, `pvpass:${token}:${passwordHash}:${exp}`)}`;
}
export async function verifyPreviewPass(pass: string, token: string, passwordHash: string, secret: string, nowSec: number): Promise<boolean> {
  const m = /^(\d{9,12})\.([0-9a-f]{64})$/.exec(String(pass || ''));
  if (!m || Number(m[1]) < nowSec) return false;
  return sameText(await hmacHex(secret, `pvpass:${token}:${passwordHash}:${m[1]}`), m[2]);
}
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}

/** Where a shared draft opens: the viewer page on the app (draft.html), never the function's
 *  own address, which Supabase serves as plain text. `t` is the lasting link, `s` the timed one. */
export function draftLinkUrl(appUrl: string, kind: 't' | 's', token: string): string {
  return `${appUrl.replace(/\/$/, '')}/draft.html?${kind}=${encodeURIComponent(token)}`;
}

/** A fresh, unguessable share token for a preview URL. Runtime (not pure). */
export function newPreviewToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
}

/** Shape the three-state status for the management surface. Pure. */
export interface PreviewStatus {
  draft: { unpublished_changes: number };
  preview: { exists: boolean; url: string | null; updated_at: string | null; has_password: boolean };
  live: { published: boolean; last_published_at: string | null; summary: string | null; offline_since: string | null; password_since: string | null };
}
export function shapePreviewStatus(input: {
  draftChanges: number;
  preview: { token: string | null; snapshot_id: string | null; updated_at: string | null; password_hash: string | null } | null;
  live: { last_published_at: string | null; summary: string | null } | null;
  baseUrl: string;
  offlineAt?: string | null;   // G10: when the owner took the site offline (null/absent = online)
  passwordAt?: string | null;  // list item 175: when a visitor password went on (null/absent = none)
}): PreviewStatus {
  const p = input.preview;
  return {
    draft: { unpublished_changes: Math.max(0, input.draftChanges | 0) },
    preview: {
      exists: !!(p && p.snapshot_id && p.token),
      url: p && p.token ? draftLinkUrl(input.baseUrl, 't', p.token) : null,   // baseUrl is the app's address
      updated_at: p?.updated_at ?? null,
      has_password: !!(p && p.password_hash),
    },
    live: { published: !!(input.live && input.live.last_published_at), last_published_at: input.live?.last_published_at ?? null, summary: input.live?.summary ?? null, offline_since: input.offlineAt ?? null, password_since: input.passwordAt ?? null },
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
