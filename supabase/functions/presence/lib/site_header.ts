// ── What the site's header does when the page scrolls (builder list items 50 and 123, Nov 2026) ──
// Four choices, picked from four pictures in the editor's Header card: it scrolls away with
// the page, stays on top, hides while you scroll down and comes back when you scroll up, or
// fades away the same way. The choice is the style setting `header_scroll` (lib/devmode.ts);
// with none set, each template keeps its own (seven stay on top, Restaurant Classic scrolls
// away). Every template draws its header as <header class="site">, so one pass covers all
// eight: a small screen-only style, and for hide and fade a few lines of script that watch
// the scroll direction. Printing keeps each template's own rules. This file imports nothing,
// so the browser spec that scrolls a real page with it reaches only this file.
type FileMap = Record<string, string | Uint8Array>;

export const HEADER_SCROLLS = ['scroll', 'stay', 'hide', 'fade'] as const;
export type HeaderScroll = typeof HEADER_SCROLLS[number];

const STICKY = 'header.site{position:sticky;top:0;z-index:20}';
const MOVES = 'header.site{transition:transform .25s ease,opacity .25s ease}@media (prefers-reduced-motion:reduce){header.site{transition:none}}';
export const HEADER_CSS: Record<HeaderScroll, string> = {
  scroll: 'header.site{position:relative;top:auto}',
  stay: STICKY,
  hide: STICKY + MOVES + 'header.site.dds-hdr-off{transform:translateY(-100%)}',
  fade: STICKY + MOVES + 'header.site.dds-hdr-off{opacity:0;pointer-events:none}',
};
// Hidden only past the header's own height, so the top of the page always shows it; back the
// moment anyone scrolls up or tabs into it.
export const HEADER_JS = '(function(){var h=document.querySelector("header.site");if(!h)return;var y=window.scrollY,busy=false;'
  + 'window.addEventListener("scroll",function(){if(busy)return;busy=true;requestAnimationFrame(function(){var n=window.scrollY;h.classList.toggle("dds-hdr-off",n>y&&n>h.offsetHeight);y=n;busy=false})},{passive:true});'
  + 'h.addEventListener("focusin",function(){h.classList.remove("dds-hdr-off")})})();';

/** The setting as stored, or null for the template's own. Pure. */
export function headerScrollOf(raw: unknown): HeaderScroll | null {
  return typeof raw === 'string' && (HEADER_SCROLLS as readonly string[]).includes(raw) ? raw as HeaderScroll : null;
}

/** Every page with the site's header, given the chosen behaviour. No choice, or a page with
 *  no header (a landing page), is left exactly as it was. Pure. */
export function applyHeaderScroll(fileMap: FileMap, raw: unknown): FileMap {
  const mode = headerScrollOf(raw);
  if (!mode) return fileMap;
  const style = `<style id="dds-hdr">@media screen{${HEADER_CSS[mode]}}</style>`;
  const script = mode === 'hide' || mode === 'fade' ? `<script id="dds-hdr-js">${HEADER_JS}</script>` : '';
  const out: FileMap = {};
  for (const [path, html] of Object.entries(fileMap)) {
    if (typeof html !== 'string' || !path.endsWith('.html') || !html.includes('<header class="site"') || html.includes('id="dds-hdr"')) { out[path] = html; continue; }
    let next = html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : style + html;
    if (script) next = next.includes('</body>') ? next.replace('</body>', `${script}</body>`) : next + script;
    out[path] = next;
  }
  return out;
}
