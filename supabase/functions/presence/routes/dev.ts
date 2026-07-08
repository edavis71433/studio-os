// ── /dev/* — Developer Mode (Phase B) ────────────────────────────────────────
// A capability of Studio OS, not a separate app. Reachable ONLY by an operator
// (Platform Admin) or a site member holding `use_developer_mode` (the developer
// role — which is how an Agency/Business/Enterprise Developer, or an entitled
// owner granted that role, gets in). Everyone else is 403 and never sees the
// nav entry. The surface authors the SAFE presentation layer — theme tokens,
// custom CSS, sanitized HTML — validated/sanitized server-side so nothing that
// could execute ever lands. Render-LOGIC (TS templates) stays a build-time SDK
// activity; the file explorer shows those files READ-ONLY.
//   GET  /dev/files              — the project structure (editable + read-only)
//   GET  /dev/customization      — the site's theme tokens + custom CSS/HTML
//   PUT  /dev/customization      — save (validated + sanitized); reports rejected tokens
import { json } from '../../_shared/http.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { siteCan } from '../lib/site_roles.ts';
import type { SiteRole } from '../lib/site_roles.ts';
import { resolveSiteRole } from '../lib/workspace.ts';
import { svc } from '../lib/db.ts';
import { ALLOWED_TOKENS, buildCustomization, projectFiles, validateThemeTokens, sanitizeDevCss, sanitizeDevHtml } from '../lib/devmode.ts';

/** Access rule (route logic — the role model is NOT modified): the operator, or
 *  a member with `use_developer_mode`. Pure + exported for tests. */
export function devModeAllowed(role: SiteRole, principalKind: string): boolean {
  if (principalKind === 'staff' || principalKind === 'system') return true; // Platform Admin
  return siteCan(role, 'use_developer_mode');
}

async function requireDeveloper(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<{ role: SiteRole } | Response> {
  const role = await resolveSiteRole(jwt, site.id, principal.kind);
  if (!devModeAllowed(role, principal.kind)) {
    return json({ error: 'forbidden', message: 'Developer Mode is available to developers on this account. Ask your studio to grant developer access.' }, 403, cors);
  }
  return { role };
}

export async function handleDevFiles(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const g = await requireDeveloper(jwt, site, principal, cors); if (g instanceof Response) return g;
  return json({ data: {
    template: { slug: site.template_slug, version: site.template_version },
    files: projectFiles(site.template_slug, site.template_version),
    note: 'Theme, CSS and HTML blocks are editable here. Template render files are read-only — they are authored with the SDK at build time and version-pinned.',
  } }, 200, cors);
}

export async function handleDevCustomizationGet(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const g = await requireDeveloper(jwt, site, principal, cors); if (g instanceof Response) return g;
  const r = await svc(`presence_dev_customizations?site_id=eq.${site.id}&select=theme_tokens,custom_css,custom_html,updated_at,updated_by&limit=1`);
  const row = (r.ok && r.json?.[0]) || null;
  return json({ data: {
    theme_tokens: row?.theme_tokens ?? {},
    custom_css: row?.custom_css ?? '',
    custom_html: row?.custom_html ?? '',
    allowed_tokens: ALLOWED_TOKENS,
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  } }, 200, cors);
}

export async function handleDevCustomizationPut(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const g = await requireDeveloper(jwt, site, principal, cors); if (g instanceof Response) return g;
  let body: any = {}; try { body = await req.json(); } catch { /* */ }

  // report which tokens were rejected BEFORE we strip them (developer feedback)
  const rejected = validateThemeTokens(body?.theme_tokens).rejected;
  const clean = buildCustomization({ theme_tokens: body?.theme_tokens, custom_css: body?.custom_css, custom_html: body?.custom_html });
  // what did sanitization change? (honest signal, so a developer knows their
  // <script> was dropped rather than silently swallowed)
  const cssStripped = String(body?.custom_css ?? '') !== clean.custom_css;
  const htmlStripped = sanitizeDevHtml(String(body?.custom_html ?? '')) !== String(body?.custom_html ?? '').trim();

  const r = await svc(`presence_dev_customizations?on_conflict=site_id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      site_id: site.id,
      theme_tokens: clean.theme_tokens,
      custom_css: clean.custom_css,
      custom_html: clean.custom_html,
      updated_by: principal.userId || 'developer',
      updated_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  return json({ data: {
    ok: true,
    saved: clean,
    rejected_tokens: rejected,
    sanitized: { css: cssStripped, html: htmlStripped },
    message: rejected.length || cssStripped || htmlStripped
      ? 'Saved. Some values weren’t allowed and were adjusted for safety.'
      : 'Saved. Publish through your normal approval flow to take it live.',
  } }, 200, cors);
}
