// ── lib/custom_css.ts — the Custom CSS safety boundary (Developer story, layer 1) ──
// A technical owner may restyle their OWN published marketing site with CSS. This
// sanitizer is the moat's non-negotiable safety contract: it must be IMPOSSIBLE for
// custom CSS to (a) break out of the <style> element into HTML/JS, (b) run script,
// or (c) leak a visitor's data to a third-party origin. The result is injected only
// into that owner's own single-tenant published site — worst case is a visual glitch
// on their own site, which is versioned with the snapshot and revertible. It never
// reaches the admin app or another tenant.
//
// Defense-in-depth: this runs at SAVE time AND again at RENDER time (the render
// pipeline never trusts stored values). It is the single hardened CSS-sanitizing
// path — lib/devmode.ts::sanitizeDevCss delegates here, so the render re-sanitize,
// the serializer's buildDevLayer, and the /dev/customization save all share it.
//
// Pure/deterministic given its inputs. The one environment read (the platform asset
// origin, mirroring injectAnalytics) only WIDENS what is allowed; when absent
// (tests/local) the sanitizer is strictly stricter, never less safe.

const MAX = 40_000; // ~40KB cap — hand-written site CSS never approaches this.

/** The platform's own asset/media origin (Supabase storage), reused from the same
 *  SUPABASE_URL the media pipeline (lib/media.ts) signs against. url()s to this
 *  origin are the site's own media and are allowed; everything cross-origin is
 *  blocked. Absent → only relative + data: pass (strictly safer). */
function platformOrigins(): string[] {
  let u = '';
  try { u = (typeof Deno !== 'undefined' && Deno?.env?.get('SUPABASE_URL')) || ''; } catch { /* env not granted → stricter */ }
  u = u.replace(/\/+$/, '').toLowerCase();
  return u ? [u] : [];
}

/** Is a single url() target allowed? Allowed = relative (root-relative `/…`,
 *  same-document `#…`, or schemeless `img/x.png`), a self-contained `data:` URI, or
 *  an http(s) URL on the platform's own asset origin. Blocked = protocol-relative
 *  `//host` (external), any non-data scheme (javascript:, vbscript:, file:, ftp:…),
 *  and any http(s) origin that is not ours (privacy / CSS-exfil channel). */
export function isAllowedCssUrl(rawInner: string): boolean {
  const s = String(rawInner).trim().replace(/^["']|["']$/g, '').trim();
  if (!s) return true;                       // empty url() — inert
  const low = s.toLowerCase();
  if (low.startsWith('data:')) return true;  // self-contained; makes no third-party request
  if (s.startsWith('#')) return true;        // same-document fragment (e.g. SVG filter ref)
  if (s.startsWith('//')) return false;      // protocol-relative → external origin
  if (s.startsWith('/')) return true;        // root-relative → same origin
  const scheme = low.match(/^([a-z][a-z0-9+.-]*):/);
  if (scheme) {
    if (scheme[1] === 'http' || scheme[1] === 'https') {
      return platformOrigins().some((o) => low === o || low.startsWith(o + '/'));
    }
    return false;                            // javascript:, vbscript:, file:, ftp:, mailto:, etc.
  }
  return true;                               // schemeless relative path → same origin
}

/**
 * Sanitize raw custom CSS into inert, styling-only CSS. Rules (all case-insensitive,
 * whitespace-tolerant):
 *   1. Cap length at ~40KB (drop the rest).
 *   2. Prevent <style> breakout: remove every `</` sequence (kills `</style>`,
 *      `</script>`, etc. while preserving the child combinator `>` and the media
 *      range `<`/`<=`, which never use `</`). Strip `<!--` and `-->`.
 *   3. Strip `@import` at-rules entirely (external stylesheet pull / privacy leak).
 *   4. Neutralize legacy script vectors: `expression(`, `behavior:`, `-moz-binding:`.
 *   5. Neutralize `url(...)`: allow only relative / data: / the platform asset host;
 *      blank any external-origin or dangerous-scheme url() (privacy + CSS-exfil).
 * Returns clean CSS (empty string for empty input).
 */
export function sanitizeCustomCss(raw: string): string {
  let s = String(raw ?? '');
  if (!s) return '';
  // 1) length cap
  if (s.length > MAX) s = s.slice(0, MAX);
  // 2) breakout prevention — no closing tag can survive, so the injected <style>
  //    element can never be closed early and turned into HTML. Global, so a `</`
  //    hidden inside a comment or a string is removed too.
  s = s.replace(/<\//g, '');
  s = s.replace(/<!--/g, '').replace(/-->/g, '');
  // 3) no external stylesheet pull
  s = s.replace(/@import[^;]*;?/gi, '');
  // 4) legacy script vectors (dead in modern engines — belt-and-suspenders for old
  //    ones). Word-boundary lookbehind so we never clip a legitimate property such
  //    as `scroll-behavior:` or an author class/name containing these substrings.
  s = s.replace(/(?<![\w-])expression\s*\(/gi, '(');
  s = s.replace(/(?<![\w-])behavior\s*:[^;}]*/gi, '');
  s = s.replace(/(?<![\w-])-moz-binding\s*:[^;}]*/gi, '');
  // 5) url() origin gate — blank anything that could reach a third party or execute.
  s = s.replace(/url\(\s*([^)]*)\)/gi, (full, inner) => isAllowedCssUrl(String(inner)) ? full : 'none');
  return s;
}
