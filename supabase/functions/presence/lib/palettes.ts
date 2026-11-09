// ── Section background tint (Phase T-STYLE) ──────────────────────────────────
// brandTint() is the one live export here: lib/site_blocks.ts BLOCK_CSS uses it as
// the source of the per-section background tint. Keep it pure and tested.
// Item 105: this file used to carry a second copy of the owner palettes (with
// paletteByKey and currentPaletteKey), which nothing but its own test read. The
// palettes owners pick from live in presence.html (PALETTES and STYLE_LOOKS), and
// tests/presence/palettes_test.mjs checks their contrast there.
// The no-code "give this section a soft brand background" option. Derives a light
// wash from the site's brand accent by mixing a SMALL amount of it into the paper,
// then GUARANTEES the tint is contrast-safe: if dark body text on the tint would
// fail WCAG AA (< 4.5:1) — e.g. a pathologically light accent — it falls back to a
// neutral near-paper wash instead. Pure + deterministic. Reuses brand_kit's colour
// math (one colour engine, no duplication). BLOCK_CSS bakes brandTint('#5b3fa0') as
// the no-`color-mix` fallback; live sites derive from var(--accent) via color-mix.
import { mix, contrastRatio } from './brand_kit.ts';
/** Dark body-text colour the tint must stay legible under (templates' default ink). */
const TINT_TEXT = '#1c2430';
export function brandTint(accent: string, paper = '#f7f7f5'): string {
  const a = /^#[0-9a-f]{6}$/i.test(accent) ? accent.toLowerCase() : '#5b3fa0';
  const tint = mix(a, paper, 0.92);                 // ~8% brand, 92% paper → a soft wash
  if (contrastRatio(TINT_TEXT, tint) >= 4.5) return tint;
  return mix('#000000', paper, 0.05);               // neutral safety wash (accent too light)
}
