// ── Phase T · Preview Environment helpers (FD-T20) ───────────────────────────
// The Preview badge + password hashing + token. The badge is a template-agnostic
// pass over rendered HTML (mirrors injectDevLayer/injectAnalytics) so EVERY
// template's preview carries an honest "this is a preview, not your live site"
// banner. Passwords are hashed (never stored plaintext). Pure where it can be.

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
  live: { published: boolean; last_published_at: string | null; summary: string | null };
}
export function shapePreviewStatus(input: {
  draftChanges: number;
  preview: { token: string | null; snapshot_id: string | null; updated_at: string | null; password_hash: string | null } | null;
  live: { last_published_at: string | null; summary: string | null } | null;
  baseUrl: string;
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
    live: { published: !!(input.live && input.live.last_published_at), last_published_at: input.live?.last_published_at ?? null, summary: input.live?.summary ?? null },
  };
}
