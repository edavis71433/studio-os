// ── Motion on the live site (builder list items 158 and 302, Nov 2026) ─────────
// One picker in Styles. "Gentle" (item 158) fades each section after the first up a little as it
// scrolls into view. Item 302 adds three bolder choices that cost no weight (a few lines of CSS,
// the same tiny script): "Slide", each section slides in from the side its words sit on;
// "Scale", each section grows from a touch smaller; "Zoom", the gentle rise plus a slow, steady
// zoom on the welcome photo. All four lift buttons, cards and photos a little under the pointer.
// The style setting `motion` (lib/devmode.ts) names the choice; off is no setting at all, so a
// site without it is drawn exactly as before.
// Kind by design: nothing is hidden until the script runs (without it every section just
// shows), a visitor whose device asks for less motion gets none, the first section (the
// part people land on) never waits, and anything already on screen shows at once. The
// builder's canvas never moves (lib/render.ts leaves it out there). This file imports
// nothing, so a browser spec can scroll a real page drawn with it.
type FileMap = Record<string, string | Uint8Array>;

export const MOTIONS = ['gentle', 'slide', 'scale', 'zoom'] as const;
export type Motion = typeof MOTIONS[number];

// Every choice rises the same way; the differences are the start of the rise and the cover.
// The fade belongs to rising only: a section marked below the fold drops out of sight at once,
// rather than fading out first where a quick scroll could catch it.
const RISE = (from: string) => `main>section.dds-rise{opacity:0;transform:${from}}main>section.dds-rise.dds-up{opacity:1;transform:none;transition:opacity .7s ease,transform .7s ease}`;
const LIFT = '.btn,.svc,.card,.teaser-card,.gallery .ga img,.post-thumb img,.rw-card{transition:transform .18s ease,box-shadow .18s ease}'
  + '.btn:hover,.svc:hover,.card:hover,.teaser-card:hover,.rw-card:hover{transform:translateY(-3px)}'
  + '.gallery .ga img:hover,.post-thumb img:hover{transform:scale(1.03)}';
const ZOOM = '.hero-img img,.hero-photo .hero-bg img,.split-img img{animation:dds-zoom 18s ease-out both}@keyframes dds-zoom{from{transform:scale(1)}to{transform:scale(1.08)}}';
export const MOTION_CSS: Record<Motion, string> = {
  gentle: `@media screen and (prefers-reduced-motion:no-preference){${RISE('translateY(18px)')}${LIFT}}`,
  slide: `@media screen and (prefers-reduced-motion:no-preference){${RISE('translateX(-40px)')}main>section.dds-rise.dds-alt{transform:translateX(40px)}${LIFT}}`,
  scale: `@media screen and (prefers-reduced-motion:no-preference){${RISE('scale(.94)')}${LIFT}}`,
  zoom: `@media screen and (prefers-reduced-motion:no-preference){${RISE('translateY(18px)')}${LIFT}.hero-img,.hero-photo .hero-bg,.split-img{overflow:hidden}${ZOOM}}`,
};
// Sections below the fold are marked to rise; each rises once, the first time a tenth of it
// shows. Every other one is marked as the other side, for the slide. A browser without
// IntersectionObserver, or a visitor asking for less motion, gets nothing marked, so nothing waits.
export const MOTION_JS = '(function(){if(!("IntersectionObserver" in window))return;if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;'
  + 'var s=[].slice.call(document.querySelectorAll("main>section")).slice(1),h=window.innerHeight||0;'
  + 'var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("dds-up");io.unobserve(e.target)}})},{threshold:0.1});'
  + 's.forEach(function(n,i){if(n.getBoundingClientRect().top<h)return;n.classList.add("dds-rise");if(i%2)n.classList.add("dds-alt");io.observe(n)})})();';

/** The setting as stored: one of the four choices, or null for none. Pure. */
export function motionOf(raw: unknown): Motion | null { return typeof raw === 'string' && (MOTIONS as readonly string[]).includes(raw) ? raw as Motion : null; }

/** Every page with sections, given the choice. Off, or a page with no <main>, is left exactly
 *  as it was. Pure. */
export function applyMotion(fileMap: FileMap, raw: unknown): FileMap {
  const mode = motionOf(raw);
  if (!mode) return fileMap;
  const style = `<style id="dds-motion">${MOTION_CSS[mode]}</style>`;
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
