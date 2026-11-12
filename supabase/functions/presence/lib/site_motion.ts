// ── A gentle "appear on scroll" (builder list item 158, Nov 2026) ─────────────
// One switch in Styles, "Gentle motion": each section after the first fades up a little
// as it scrolls into view. Not per-element effects (review file 02, finding 16). The
// style setting `motion` (lib/devmode.ts) is "gentle" when on; off is no setting at all,
// so a site without it is drawn exactly as before.
// Kind by design: nothing is hidden until the script runs (without it every section just
// shows), a visitor whose device asks for less motion gets none, the first section (the
// part people land on) never waits, and anything already on screen shows at once. The
// builder's canvas never moves (lib/render.ts leaves it out there). This file imports
// nothing, so a browser spec can scroll a real page drawn with it.
type FileMap = Record<string, string | Uint8Array>;

// The fade belongs to rising only: a section marked below the fold drops out of sight at once,
// rather than fading out first where a quick scroll could catch it.
export const MOTION_CSS = '@media screen and (prefers-reduced-motion:no-preference){main>section.dds-rise{opacity:0;transform:translateY(18px)}main>section.dds-rise.dds-up{opacity:1;transform:none;transition:opacity .7s ease,transform .7s ease}}';
// Sections below the fold are marked to rise; each rises once, the first time a tenth of it
// shows. A browser without IntersectionObserver, or a visitor asking for less motion, gets
// nothing marked, so nothing waits.
export const MOTION_JS = '(function(){if(!("IntersectionObserver" in window))return;if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;'
  + 'var s=[].slice.call(document.querySelectorAll("main>section")).slice(1),h=window.innerHeight||0;'
  + 'var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("dds-up");io.unobserve(e.target)}})},{threshold:0.1});'
  + 's.forEach(function(n){if(n.getBoundingClientRect().top<h)return;n.classList.add("dds-rise");io.observe(n)})})();';

/** The setting as stored: "gentle", or null for none. Pure. */
export function motionOf(raw: unknown): 'gentle' | null { return raw === 'gentle' ? 'gentle' : null; }

/** Every page with sections, given the switch. Off, or a page with no <main>, is left exactly
 *  as it was. Pure. */
export function applyMotion(fileMap: FileMap, raw: unknown): FileMap {
  if (!motionOf(raw)) return fileMap;
  const style = `<style id="dds-motion">${MOTION_CSS}</style>`;
  const script = `<script id="dds-motion-js">${MOTION_JS}</script>`;
  const out: FileMap = {};
  for (const [path, html] of Object.entries(fileMap)) {
    if (typeof html !== 'string' || !path.endsWith('.html') || !/<main[\s>]/.test(html) || html.includes('id="dds-motion"')) { out[path] = html; continue; }
    let next = html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : style + html;
    next = next.includes('</body>') ? next.replace('</body>', `${script}</body>`) : next + script;
    out[path] = next;
  }
  return out;
}
