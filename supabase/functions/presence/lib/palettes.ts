// ⚠️ PARTIALLY WIRED — the PALETTES array + paletteByKey/currentPaletteKey remain a
// spec-only contract (owner palette-picker awaiting its phase; no production import).
// BUT `brandTint()` below IS live: lib/site_blocks.ts BLOCK_CSS uses it as the source
// of the per-section background tint (Phase T-STYLE). Keep brandTint pure + tested.
// ── Curated color palettes (Phase COMP — FD-T6-lite) ─────────────────────────
// The no-code half of styling: an OWNER picks a designed palette; it becomes the
// SAME theme tokens Developer Mode uses (one machinery, no duplication), rides
// the snapshot, renders deterministically, and publishes approval-first.
// Every palette is contrast-validated by test (white-on-accent ≥ 4.5:1 for
// buttons; ink-on-paper ≥ 7:1 for body text) so accessibility stays a platform
// guarantee even when the customer chooses the look. Backgrounds are left to the
// template on purpose — palettes recolor the BRAND, not the paper.
export interface Palette {
  key: string;
  name: string;
  /** the tokens written to the dev-customization layer (validated by devmode rules) */
  tokens: { accent: string; accent_dark: string; ink: string; soft: string };
}

export const PALETTES: Palette[] = [
  { key: 'terracotta', name: 'Warm terracotta', tokens: { accent: '#8c3b2e', accent_dark: '#6f2e24', ink: '#241d1a', soft: '#6b5f58' } },
  { key: 'evergreen',  name: 'Evergreen',       tokens: { accent: '#23635a', accent_dark: '#17453f', ink: '#1c2430', soft: '#5b6572' } },
  { key: 'harbor',     name: 'Harbor blue',     tokens: { accent: '#2f5d8a', accent_dark: '#224566', ink: '#1b2530', soft: '#5a6570' } },
  { key: 'plum',       name: 'Quiet plum',      tokens: { accent: '#5b3fa0', accent_dark: '#463079', ink: '#221e2c', soft: '#635d70' } },
  { key: 'espresso',   name: 'Espresso',        tokens: { accent: '#5d4037', accent_dark: '#43302a', ink: '#25201d', soft: '#6d625c' } },
  { key: 'slate',      name: 'Modern slate',    tokens: { accent: '#37474f', accent_dark: '#263238', ink: '#1e262a', soft: '#5c686e' } },
  // Phase PT — premium editorial/luxury range (each still contrast-validated by test)
  { key: 'claret',     name: 'Claret',          tokens: { accent: '#6d232a', accent_dark: '#4f181d', ink: '#241a1b', soft: '#6b5a5c' } },
  { key: 'ink-navy',   name: 'Ink navy',        tokens: { accent: '#26324d', accent_dark: '#1a2438', ink: '#1b2230', soft: '#5a6472' } },
  { key: 'forest',     name: 'Deep forest',     tokens: { accent: '#2f4a34', accent_dark: '#213620', ink: '#1b241d', soft: '#5b665d' } },
  { key: 'aubergine',  name: 'Aubergine',       tokens: { accent: '#5a2d4d', accent_dark: '#3f1f36', ink: '#241b21', soft: '#665c63' } },
  { key: 'graphite',   name: 'Graphite',        tokens: { accent: '#33383d', accent_dark: '#24282c', ink: '#1e2124', soft: '#5f666c' } },
  { key: 'oxide',      name: 'Burnt oxide',     tokens: { accent: '#8a3b1e', accent_dark: '#6a2c15', ink: '#241c18', soft: '#6b5d55' } },
];

export function paletteByKey(key: string): Palette | null {
  return PALETTES.find((p) => p.key === key) || null;
}

// ── Section background tint (Phase T-STYLE) ──────────────────────────────────
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

/** Which palette (if any) the current tokens correspond to; '' = original/custom. */
export function currentPaletteKey(tokens: Record<string, string> | null | undefined): string {
  if (!tokens || !tokens.accent) return '';
  const hit = PALETTES.find((p) => p.tokens.accent.toLowerCase() === String(tokens.accent).toLowerCase());
  return hit ? hit.key : '';
}
