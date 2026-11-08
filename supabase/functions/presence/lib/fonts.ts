// ── The curated font library (list item 24) ─────────────────────────────────────
// Open-licence families from Google Fonts, taken from the Fontsource 5.3 packages:
// latin subset, woff2, regular and bold. The files live in the app at
// /fonts/library/<id>-<weight>.woff2 with each family's licence beside them, and a site
// carries its own copy: publish adds the ones the site's style names at that same path,
// so a live site never loads a font from anyone else, and the canvas and preview (drawn
// inside the app) load them from the app.
//
// A family is chosen through the existing font tokens (font_display, font_body), whose
// value is a stack that starts with the family's css name. The style layer then carries
// an @font-face rule per weight for each library family the stack names.
// presence.html builds the same rules for the canvas (dcFontFaces): change both together.

export type FontKind = 'serif' | 'sans' | 'friendly' | 'character';
export interface LibraryFont {
  id: string;          // file name stem
  family: string;      // the name people see
  css: string;         // the font-family name in CSS: a plain identifier sequence, no quotes needed
  kind: FontKind;
  weights: number[];
  fallback: string;    // what shows while it loads, or if it can't
}

const SERIF = 'Georgia, serif', SANS = 'system-ui, sans-serif';
export const FONT_LIBRARY: LibraryFont[] = [
  { id: 'playfair-display', family: 'Playfair Display', css: 'Playfair Display', kind: 'serif', weights: [400, 700], fallback: SERIF },
  { id: 'fraunces', family: 'Fraunces', css: 'Fraunces', kind: 'serif', weights: [400, 700], fallback: SERIF },
  { id: 'cormorant-garamond', family: 'Cormorant Garamond', css: 'Cormorant Garamond', kind: 'serif', weights: [400, 700], fallback: SERIF },
  { id: 'libre-baskerville', family: 'Libre Baskerville', css: 'Libre Baskerville', kind: 'serif', weights: [400, 700], fallback: SERIF },
  { id: 'lora', family: 'Lora', css: 'Lora', kind: 'serif', weights: [400, 700], fallback: SERIF },
  { id: 'dm-serif-display', family: 'DM Serif Display', css: 'DM Serif Display', kind: 'serif', weights: [400], fallback: SERIF },
  { id: 'eb-garamond', family: 'EB Garamond', css: 'EB Garamond', kind: 'serif', weights: [400, 700], fallback: SERIF },
  { id: 'merriweather', family: 'Merriweather', css: 'Merriweather', kind: 'serif', weights: [400, 700], fallback: SERIF },
  { id: 'inter', family: 'Inter', css: 'Inter', kind: 'sans', weights: [400, 700], fallback: SANS },
  { id: 'dm-sans', family: 'DM Sans', css: 'DM Sans', kind: 'sans', weights: [400, 700], fallback: SANS },
  { id: 'manrope', family: 'Manrope', css: 'Manrope', kind: 'sans', weights: [400, 700], fallback: SANS },
  { id: 'work-sans', family: 'Work Sans', css: 'Work Sans', kind: 'sans', weights: [400, 700], fallback: SANS },
  { id: 'outfit', family: 'Outfit', css: 'Outfit', kind: 'sans', weights: [400, 700], fallback: SANS },
  { id: 'plus-jakarta-sans', family: 'Plus Jakarta Sans', css: 'Plus Jakarta Sans', kind: 'sans', weights: [400, 700], fallback: SANS },
  { id: 'nunito-sans', family: 'Nunito Sans', css: 'Nunito Sans', kind: 'sans', weights: [400, 700], fallback: SANS },
  // a CSS family name that starts a word with a digit needs quotes, which the style layer strips
  { id: 'source-sans-3', family: 'Source Sans 3', css: 'Source Sans Three', kind: 'sans', weights: [400, 700], fallback: SANS },
  { id: 'figtree', family: 'Figtree', css: 'Figtree', kind: 'sans', weights: [400, 700], fallback: SANS },
  { id: 'space-grotesk', family: 'Space Grotesk', css: 'Space Grotesk', kind: 'sans', weights: [400, 700], fallback: SANS },
  { id: 'nunito', family: 'Nunito', css: 'Nunito', kind: 'friendly', weights: [400, 700], fallback: SANS },
  { id: 'quicksand', family: 'Quicksand', css: 'Quicksand', kind: 'friendly', weights: [400, 700], fallback: SANS },
  { id: 'poppins', family: 'Poppins', css: 'Poppins', kind: 'friendly', weights: [400, 700], fallback: SANS },
  { id: 'roboto-slab', family: 'Roboto Slab', css: 'Roboto Slab', kind: 'character', weights: [400, 700], fallback: SERIF },
  { id: 'ibm-plex-mono', family: 'IBM Plex Mono', css: 'IBM Plex Mono', kind: 'character', weights: [400, 700], fallback: 'ui-monospace, monospace' },
  { id: 'caveat', family: 'Caveat', css: 'Caveat', kind: 'character', weights: [400, 700], fallback: 'cursive' },
];

export const FONT_DIR = 'fonts/library';
export const fontFilePath = (f: LibraryFont, w: number) => `${FONT_DIR}/${f.id}-${w}.woff2`;
/** The token value that chooses a family: its css name, then its fallback. */
export const fontStack = (f: LibraryFont) => `${f.css}, ${f.fallback}`;

/** The library families a style's font tokens name (by the first family in each stack). */
export function libraryFontsIn(tokens: Record<string, unknown> | null | undefined): LibraryFont[] {
  const out: LibraryFont[] = [];
  for (const k of ['font_display', 'font_body']) {
    const first = String((tokens || {})[k] ?? '').split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
    const f = first && FONT_LIBRARY.find((x) => x.css.toLowerCase() === first);
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/** One @font-face rule per weight, loading from the site's own copy. */
export function fontFaceCss(fonts: LibraryFont[]): string {
  return fonts.flatMap((f) => f.weights.map((w) =>
    `@font-face{font-family:'${f.css}';src:url(/${fontFilePath(f, w)}) format('woff2');font-weight:${w};font-style:normal;font-display:swap}`)).join('');
}

// Item 89: a font file once fetched stays for this function instance, and a fetch that
// hiccups is tried twice more before the file counts as failed.
const FONT_FILES = new Map<string, Uint8Array>();

/** Publish: the files of these families, fetched from the app, keyed by their path on the site. */
export async function fetchLibraryFonts(fonts: LibraryFont[], opts: { tries?: number; pauseMs?: number } = {}): Promise<{ files: Record<string, Uint8Array>; failed: string[] }> {
  const APP_URL = (Deno.env.get('APP_URL') || 'https://app.davisdigitalstudio.com').replace(/\/$/, '');
  const tries = opts.tries ?? 3, pause = opts.pauseMs ?? 300;
  const files: Record<string, Uint8Array> = {};
  const failed: string[] = [];
  await Promise.all(fonts.flatMap((f) => f.weights.map(async (w) => {
    const path = fontFilePath(f, w);
    const kept = FONT_FILES.get(path);
    if (kept) { files[path] = kept; return; }
    for (let t = 0; t < tries; t++) {
      if (t) await new Promise((r) => setTimeout(r, pause * t));
      try {
        const r = await fetch(`${APP_URL}/${path}`);
        const bytes = r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
        // a woff2 file starts "wOF2"; anything else (an HTML 404 page) isn't the font
        if (bytes && bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 4)) === 'wOF2') { FONT_FILES.set(path, bytes); files[path] = bytes; return; }
      } catch { /* tried again below */ }
    }
    failed.push(path);
  })));
  return { files, failed };
}
