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

/** Strip anything that could execute or exfiltrate. Denylist + defensive: no
 *  <script>/<iframe>/<object>/<embed>/<link>/<meta>/<style>, no on*= handlers,
 *  no javascript:/data:/vbscript: URLs, no <base>. What remains is inert markup.
 *  DEFENSE LAYERS (published sites): (1) this sanitizer — denylist + an allow-list
 *  tag pass (DEV_HTML_ALLOW) below; (2) re-sanitization at RENDER time (render.ts
 *  never trusts stored values); (3) a partial published-site CSP (object-src
 *  'none' + base-uri 'self', render.ts injectCsp). STILL QUEUED before granting
 *  `developer` beyond trusted people: a STRICT script-src CSP (needs the per-site
 *  analytics script hashed/externalised + a browser smoke) and a full HTML parser.
 *  Until those land, keep the `developer` role narrow. */
export function sanitizeDevHtml(html: string): string {
  let s = String(html || '');
  // remove dangerous elements entirely (with their content)
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|noscript|template|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  // remove self-closing / unclosed dangerous tags
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|svg|math)\b[^>]*>/gi, '');
  // strip on*= event handler attributes (quoted or unquoted)
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '').replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '').replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  // neutralize dangerous URL schemes in href/src
  s = s.replace(/(href|src|xlink:href)\s*=\s*("|')\s*(javascript|data|vbscript):[^"']*\2/gi, '$1=$2#$2');
  // strip style="" attributes that could contain url()/expression() (custom_css is the sanctioned styling channel)
  s = s.replace(/\sstyle\s*=\s*"[^"]*"/gi, '').replace(/\sstyle\s*=\s*'[^']*'/gi, '');
  // allow-list pass (defense-in-depth toward a parser): keep only safe content
  // tag wrappers; any other tag is stripped (its inner text is preserved). The
  // denylist above already removed the dangerous elements with their content;
  // this ensures nothing exotic survives even if the denylist is later widened.
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g, (m, tag) => DEV_HTML_ALLOW.has(String(tag).toLowerCase()) ? m : '');
  return s.trim();
}

/** The only element wrappers permitted in a developer HTML block — presentational
 *  content tags. No scripting, embedding, form, or metadata elements. */
export const DEV_HTML_ALLOW: ReadonlySet<string> = new Set([
  'div', 'span', 'p', 'a', 'img', 'picture', 'source', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i',
  'u', 's', 'small', 'sub', 'sup', 'br', 'hr', 'blockquote', 'q', 'cite', 'pre',
  'code', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main',
  'address', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'col', 'colgroup', 'dl', 'dt', 'dd', 'time', 'mark', 'abbr',
]);

/** Custom CSS is inert (no execution), but strip the few CSS constructs that can
 *  fetch/execute: url(javascript:…), expression(), @import, and behavior:. */
export function sanitizeDevCss(css: string): string {
  let s = String(css || '');
  s = s.replace(/@import[^;]+;?/gi, '');
  s = s.replace(/expression\s*\([^)]*\)/gi, '');
  s = s.replace(/url\s*\(\s*["']?\s*(javascript|vbscript|data):[^)]*\)/gi, 'none');
  s = s.replace(/behavior\s*:[^;}]+/gi, '');
  return s.slice(0, 100_000); // hard size cap
}

/** Build the safe, validated customization from raw input. */
export function buildCustomization(raw: { theme_tokens?: unknown; custom_css?: unknown; custom_html?: unknown }): DevCustomization {
  return {
    theme_tokens: validateThemeTokens(raw.theme_tokens).tokens,
    custom_css: sanitizeDevCss(String(raw.custom_css ?? '')),
    custom_html: sanitizeDevHtml(String(raw.custom_html ?? '')).slice(0, 50_000),
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
