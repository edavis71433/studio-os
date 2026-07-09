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
import { sanitizeBrandKit, deriveBrandTokens } from '../lib/brand_kit.ts';

/** Access rule (route logic — the role model is NOT modified): the operator, or
 *  a member with `use_developer_mode`. Pure + exported for tests. */
export function devModeAllowed(role: SiteRole, principalKind: string): boolean {
  if (principalKind === 'staff' || principalKind === 'system') return true; // Platform Admin
  return siteCan(role, 'use_developer_mode');
}

/** Phase COMP (FD-T6-lite): the DESIGN surface — theme tokens only — is an
 *  OWNER capability, not a developer one. Picking a curated palette is everyday
 *  authoring; custom CSS/HTML remain Developer Mode. Pure + exported for tests. */
export function designAllowed(role: SiteRole, principalKind: string): boolean {
  return devModeAllowed(role, principalKind) || role === 'business_owner';
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
  // Phase COMP: owners may READ the customization (the Design card shows the
  // current palette); full Developer Mode still gates the editor surface.
  const role = await resolveSiteRole(jwt, site.id, principal.kind);
  if (!designAllowed(role, principal.kind)) {
    return json({ error: 'forbidden', message: 'Developer Mode is available to developers on this account. Ask your studio to grant developer access.' }, 403, cors);
  }
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

// ── FD-T9: Brand Kit — one source of truth → the EXISTING dev-token layer ─────
// Owner-or-developer (designAllowed). Stores the kit on settings and DERIVES the
// same theme tokens Design Studio writes, so buttons/forms/links (all var(--accent))
// rebrand at once. No second theme engine; publishes through the normal flow.
export async function handleBrandKitGet(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const role = await resolveSiteRole(jwt, site.id, principal.kind);
  if (!designAllowed(role, principal.kind)) return json({ error: 'forbidden', message: 'Design is available to the account owner or a developer.' }, 403, cors);
  const r = await svc(`presence_settings?site_id=eq.${site.id}&select=brand_kit&limit=1`);
  return json({ data: { brand_kit: (r.ok && r.json?.[0]?.brand_kit) || null } }, 200, cors);
}

export async function handleBrandKitPut(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const role = await resolveSiteRole(jwt, site.id, principal.kind);
  if (!designAllowed(role, principal.kind)) return json({ error: 'forbidden', message: 'Design is available to the account owner or a developer.' }, 403, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const kit = sanitizeBrandKit(body?.brand_kit ?? body);
  if (!kit) return json({ error: 'bad_brand_kit', message: 'A brand colour is required (e.g. #2f5d8a).' }, 422, cors);
  // same-site guard on the logo reference; drop it if it isn't in this library
  if (kit.logo_media_id) {
    const m = await svc(`presence_media?id=eq.${kit.logo_media_id}&site_id=eq.${site.id}&deleted_at=is.null&select=id&limit=1`);
    if (!(Array.isArray(m.json) && m.json.length)) delete kit.logo_media_id;
  }
  // 1) persist the kit (the source of truth) on the settings row
  const s = await svc(`presence_settings?on_conflict=site_id`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ site_id: site.id, brand_kit: kit, ...(kit.logo_media_id ? { logo_media_id: kit.logo_media_id } : {}) }),
  });
  if (!s.ok) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  // 2) derive tokens and merge into the ONE dev-token layer (owner tier: tokens only)
  const derived = deriveBrandTokens(kit);
  const existing = await svc(`presence_dev_customizations?site_id=eq.${site.id}&select=theme_tokens,custom_css,custom_html&limit=1`);
  const cur = (existing.ok && existing.json?.[0]) || {};
  const clean = buildCustomization({ theme_tokens: { ...(cur.theme_tokens || {}), ...derived }, custom_css: cur.custom_css || '', custom_html: cur.custom_html || '' });
  const w = await svc(`presence_dev_customizations?on_conflict=site_id`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ site_id: site.id, theme_tokens: clean.theme_tokens, custom_css: clean.custom_css, custom_html: clean.custom_html, updated_by: principal.userId || 'owner', updated_at: new Date().toISOString() }),
  });
  if (!w.ok) return json({ error: 'write_failed', message: 'The brand was saved but couldn’t be applied — please try again.' }, 502, cors);
  return json({ data: { ok: true, brand_kit: kit, applied_tokens: clean.theme_tokens, message: 'Brand kit saved and applied. Publish through your normal approval flow to take it live.' } }, 200, cors);
}

export async function handleDevCustomizationPut(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  // Phase COMP: two tiers through ONE machinery — a developer edits everything;
  // a business owner edits THEME TOKENS ONLY (the Design card's curated
  // palettes). An owner's request never touches css/html: whatever a developer
  // saved there is preserved verbatim.
  const role = await resolveSiteRole(jwt, site.id, principal.kind);
  const isDev = devModeAllowed(role, principal.kind);
  if (!isDev && !designAllowed(role, principal.kind)) {
    return json({ error: 'forbidden', message: 'Developer Mode is available to developers on this account. Ask your studio to grant developer access.' }, 403, cors);
  }
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  if (!isDev) {
    const existing = await svc(`presence_dev_customizations?site_id=eq.${site.id}&select=custom_css,custom_html&limit=1`);
    body = { theme_tokens: body?.theme_tokens, custom_css: existing.json?.[0]?.custom_css ?? '', custom_html: existing.json?.[0]?.custom_html ?? '' };
  }

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
