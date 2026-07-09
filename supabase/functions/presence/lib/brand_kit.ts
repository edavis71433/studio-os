// ── Phase T · Brand Kit (FD-T9) — one source of truth, deterministic ─────────
// An owner's brand (a logo + a primary colour + type + corner) deterministically
// DERIVES the platform's existing Design-Studio tokens — it does NOT introduce a
// second theme engine. The derived tokens are written to the SAME dev-token layer
// (presence_dev_customizations.theme_tokens) that Design Studio, the render
// pipeline, and Developer Mode already consume, so buttons, forms, and links
// (all `var(--accent)` in every template) rebrand at once. The kit is also the
// single source emails + documents read from. Pure: no I/O, no clock, no
// randomness — same brand in → same tokens out, and colours are contrast-checked
// so a light brand never yields unreadable buttons.

export interface BrandKit {
  logo_media_id?: string | null;
  primary: string;               // hex — the brand colour
  secondary?: string;            // optional secondary/brand accent (kept for emails/docs)
  neutral?: string;              // optional ink base; when set, derives ink/soft
  heading_font?: string;         // preset key or a raw font stack
  body_font?: string;            // preset key or a raw font stack
  corner?: string;               // radius token (e.g. '2px' | '' | '18px')
}

// ── colour math (deterministic) ──────────────────────────────────────────────
export function normHex(x: string | null | undefined): string | null {
  let h = String(x ?? '').trim().toLowerCase();
  if (/^#?[0-9a-f]{3}$/.test(h)) { h = h.replace('#', ''); h = `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`; return h; }
  if (/^#?[0-9a-f]{6}$/.test(h)) return h.startsWith('#') ? h : `#${h}`;
  return null;
}
function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = toRgb(a), [br, bg, bb] = toRgb(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}
export function darken(hex: string, amt: number): string { return mix(hex, '#000000', amt); }
export function lighten(hex: string, amt: number): string { return mix(hex, '#ffffff', amt); }
function chan(c: number): number { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
export function luminance(hex: string): number { const [r, g, b] = toRgb(hex); return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b); }
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Darken `color` in fixed steps until white text on it meets `min` contrast
 *  (buttons render white text on --accent). Deterministic; caps at near-black. */
export function readableOnWhiteText(color: string, min = 4.5): string {
  let c = color;
  for (let i = 0; i < 20 && contrastRatio('#ffffff', c) < min; i++) c = darken(c, 0.08);
  return c;
}

// ── type presets (local/system fonts only — Part 4: zero external origins) ────
const FONT_STACKS: Record<string, string> = {
  classic_serif: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  modern_sans: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  editorial: "Georgia, 'Iowan Old Style', serif",
  friendly: "'Avenir Next Rounded', 'Trebuchet MS', system-ui, sans-serif",
  mono: "'Courier New', ui-monospace, monospace",
};
function fontStack(x: string | undefined): string | undefined {
  if (!x) return undefined;
  return FONT_STACKS[x] || (x.includes(',') || /serif|sans|mono/i.test(x) ? x : undefined);
}

/** Derive the platform's dev-layer theme tokens from a brand kit. Deterministic,
 *  contrast-safe. Only sets what the kit specifies, so it composes with defaults. */
export function deriveBrandTokens(kit: BrandKit): Record<string, string> {
  const primary = normHex(kit.primary) || '#5b3fa0';
  const accent = readableOnWhiteText(primary);          // buttons/links/forms use --accent (white text)
  const accent_dark = darken(accent, 0.16);
  const tokens: Record<string, string> = { accent, accent_dark, accent_soft: mix(primary, '#ffffff', 0.9) };
  const neutral = normHex(kit.neutral || '');
  if (neutral) {
    const ink = mix(darken(neutral, 0.15), primary, 0.06);  // near-black, faintly brand-tinted
    tokens.ink = ink;
    tokens.soft = mix(ink, '#ffffff', 0.55);
  }
  const hd = fontStack(kit.heading_font); if (hd) tokens.font_display = hd;
  const bd = fontStack(kit.body_font); if (bd) tokens.font_body = bd;
  if (typeof kit.corner === 'string') tokens.radius = kit.corner;
  return tokens;
}

/** Validate + normalize a raw kit into a safe stored kit (or null if unusable). */
export function sanitizeBrandKit(raw: unknown): BrandKit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const primary = normHex(r.primary as string);
  if (!primary) return null;                             // primary colour is the one required field
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const kit: BrandKit = { primary };
  if (typeof r.logo_media_id === 'string' && UUID.test(r.logo_media_id)) kit.logo_media_id = r.logo_media_id;
  const sec = normHex(r.secondary as string); if (sec) kit.secondary = sec;
  const neu = normHex(r.neutral as string); if (neu) kit.neutral = neu;
  if (typeof r.heading_font === 'string') kit.heading_font = String(r.heading_font).slice(0, 120);
  if (typeof r.body_font === 'string') kit.body_font = String(r.body_font).slice(0, 120);
  if (typeof r.corner === 'string') kit.corner = String(r.corner).slice(0, 8);
  return kit;
}
