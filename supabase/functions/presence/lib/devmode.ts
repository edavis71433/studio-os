// ── Developer Mode (Phase B) — the safe customization layer ──────────────────
// Developer Mode is a CAPABILITY of Studio OS, not a separate app. Within the
// frozen constitution it customizes a site's PRESENTATION as DATA — theme tokens,
// custom CSS, and sanitized HTML blocks — versioned through the existing publish
// ritual and gated by the `use_developer_mode` capability. It NEVER introduces
// runtime code execution: this module strips every script/handler/dangerous URL
// before anything can reach a rendered page, so a developer's markup is content,
// not code. Render-LOGIC (the TypeScript templates/components) stays a build-time
// SDK activity — there is no in-app runtime code editor, by design (determinism +
// no-foreign-code are Product Laws). Pure.
import { sanitizeCustomCss } from './custom_css.ts';
import { cleanDevHtml, DEV_HTML_ALLOW } from './dev_html.ts';

export interface DevCustomization {
  theme_tokens: Record<string, string>;   // e.g. { accent:'#5b3fa0', ink:'#1b1525' }
  custom_css: string;                      // developer CSS (no code execution possible)
  custom_html: string;                     // a sanitized HTML block for a designated slot
}

// The theme tokens a developer may set, with the value shape each accepts.
const TOKEN_RULES: Record<string, RegExp> = {
  accent: /^#[0-9a-fA-F]{3,8}$/,
  accent_soft: /^#[0-9a-fA-F]{3,8}$/,
  accent_dark: /^#[0-9a-fA-F]{3,8}$/,   // Phase COMP: hover/active shade (templates read --accent-dark)
  soft: /^#[0-9a-fA-F]{3,8}$/,          // Phase COMP: secondary text
  ink: /^#[0-9a-fA-F]{3,8}$/,
  bg: /^#[0-9a-fA-F]{3,8}$/,
  radius: /^\d{1,3}(px|rem|em)$/,
  font_display: /^[a-zA-Z0-9'\", -]{3,120}$/,   // CP-2: curated stack strings — no {};()/ url possible
  font_body: /^[a-zA-Z0-9'\", -]{3,120}$/,
  spacing_scale: /^(0?\.\d+|1(\.\d+)?)$/,        // CP-2: density preset (like font_scale)
  font_scale: /^(0?\.\d+|1(\.\d+)?)$/,
  header_scroll: /^(scroll|stay|hide|fade)$/,   // builder items 50 and 123: what the header does on scroll (lib/site_header.ts)
  phone_bar: /^(off|light|dark)$/,              // builder item 122: the phone-only Call, Directions, Hours and Email bar (lib/phone_bar.ts)
  motion: /^gentle$/,                           // builder item 158: sections fade up as they scroll into view (lib/site_motion.ts)
  buttons: /^(filled|outline|pill|square|underline)$/,   // builder item 217: every button as one matched set (lib/site_buttons.ts)
  forms: /^(line|soft|round)$/,                 // builder item 217: every box people type into (lib/site_buttons.ts)
};
export const ALLOWED_TOKENS = Object.keys(TOKEN_RULES);

/** Keep only known tokens with valid values — reject everything else (deny by
 *  default), so a theme can never smuggle in arbitrary CSS/values. */
export function validateThemeTokens(input: unknown): { tokens: Record<string, string>; rejected: string[] } {
  const tokens: Record<string, string> = {};
  const rejected: string[] = [];
  if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const val = String(v ?? '');
      if (TOKEN_RULES[k] && TOKEN_RULES[k].test(val)) tokens[k] = val;
      else rejected.push(k);
    }
  }
  return { tokens, rejected };
}

/** Make a developer's HTML block safe (builder item 190). The block is read the way
 *  a browser reads it and written out again from an allow list (lib/dev_html.ts):
 *  only the content tags in DEV_HTML_ALLOW, only each tag's listed attributes, no
 *  on…= handler, no style=, and only http, https, mailto, tel or on-site addresses,
 *  judged after decoding. DEFENSE LAYERS (published sites): (1) this cleaner on
 *  save; (2) the same cleaner again at RENDER time (render.ts never trusts stored
 *  values); (3) the published site's own script rule (lib/site_csp.ts). */
export function sanitizeDevHtml(html: string): string {
  return cleanDevHtml(html);
}
export { DEV_HTML_ALLOW };

/** Custom CSS is inert (no execution). Sanitizing is delegated to the single
 *  hardened boundary in lib/custom_css.ts (the "Developer" story, layer 1): length
 *  cap, `</style>` breakout prevention, @import stripped, expression()/behavior:/
 *  -moz-binding: neutralized, and url() gated to relative/data:/platform-asset
 *  origins only (external url() is a privacy/CSS-exfil channel). Kept as a thin
 *  re-export so every existing caller (render re-sanitize, serializer, /dev save)
 *  gets the hardening without a second CSS sanitizer. */
export function sanitizeDevCss(css: string): string {
  return sanitizeCustomCss(css);
}

/** Build the safe, validated customization from raw input. */
export function buildCustomization(raw: { theme_tokens?: unknown; custom_css?: unknown; custom_html?: unknown }): DevCustomization {
  // The cap is applied to what goes IN, so a cut can never land inside a tag that was
  // already checked; a block that still comes out too long is cut shorter and cleaned again.
  let source = String(raw.custom_html ?? '').slice(0, 50_000);
  let custom_html = sanitizeDevHtml(source);
  while (custom_html.length > 50_000) {
    source = source.slice(0, Math.floor(source.length * 0.9));
    custom_html = sanitizeDevHtml(source);
  }
  return {
    theme_tokens: validateThemeTokens(raw.theme_tokens).tokens,
    custom_css: sanitizeDevCss(String(raw.custom_css ?? '')),
    custom_html,
  };
}

/** The developer "file explorer" — the resources a developer works with. Code
 *  files (render templates/components) are READ-ONLY here (edited via the SDK at
 *  build time); theme/css/html are the editable customization layer. */
export function projectFiles(templateSlug: string, templateVersion: string): Array<{ path: string; kind: 'theme' | 'css' | 'html' | 'template' | 'asset'; editable: boolean }> {
  return [
    { path: 'theme/tokens.json', kind: 'theme', editable: true },
    { path: 'styles/custom.css', kind: 'css', editable: true },
    { path: 'blocks/custom.html', kind: 'html', editable: true },
    { path: `templates/${templateSlug}/${templateVersion}/render.ts`, kind: 'template', editable: false },
    { path: `templates/${templateSlug}/${templateVersion}/manifest.json`, kind: 'template', editable: false },
    { path: 'assets/media', kind: 'asset', editable: true },
  ];
}
