// ── The ready-made looks, one list (builder item 333 and the openings per kind, Nov 2026) ─────
// Eric picked twelve looks in Figma (section D), grouped by mood. Styles offers them (presence-edit.js
// reads this list from GET /dev/customization, routes/dev.ts, beside the font library), and the
// openings per kind of business (lib/kind_openings.ts) start a new site in one of them, so the editor
// and + New site share one list. Each look sets its colours, its two library fonts (lib/fonts.ts, a
// family's css name then its fallback), its button set and corners, and names itself (look), which
// brings its own small layer of rules so every word reads on every template (lib/site_looks.ts).
// Hard hat's headings are in capitals, Blush's at regular weight (its face has one), Playground's
// main button has a solid shadow, Big & bright is the Larger text size, and the two dark looks bring
// the colours a template's cards, rules, shaded bands and accent sections take on a dark page.
// Original comes first: the template's own, setting nothing.
// tests/presence/style_looks_333_test.mjs reads every word of every template under each, and
// tests/e2e/style-looks-333.spec.ts draws the tiles. This file imports nothing, so a browser spec can.

export interface StyleLook { key: string; name: string; mood: string; tokens: Readonly<Record<string, string>> }

export const STYLE_LOOKS: readonly StyleLook[] = [
  { key: '', name: 'Original', mood: 'Template', tokens: {} },
  { key: 'golden_hour', name: 'Golden hour', mood: 'Warm', tokens: { look: 'golden_hour', accent: '#b4532a', accent_dark: '#904222', ink: '#3b2416', soft: '#6f5a4b', bg: '#fbf3e6', font_display: 'Fraunces, Georgia, serif', font_body: 'Nunito Sans, system-ui, sans-serif', buttons: 'pill' } },
  { key: 'hand_lettered', name: 'Hand-lettered', mood: 'Warm', tokens: { look: 'hand_lettered', accent: '#a8561a', accent_dark: '#8f4916', ink: '#2e2a26', soft: '#5f574f', bg: '#fdf6ec', font_display: 'Caveat, cursive', font_body: 'Poppins, system-ui, sans-serif', buttons: 'filled', button_radius: '14px', radius: '14px' } },
  { key: 'hard_hat', name: 'Hard hat', mood: 'Bold', tokens: { look: 'hard_hat', accent: '#111111', accent_dark: '#000000', ink: '#111111', soft: '#2b2b2b', bg: '#f2c230', font_display: 'Roboto Slab, Georgia, serif', font_body: 'Work Sans, system-ui, sans-serif', heading_case: 'upper', buttons: 'square', radius: '2px' } },
  { key: 'night_shift', name: 'Night shift', mood: 'Bold', tokens: { look: 'night_shift', scheme: 'dark', accent: '#ff5a1f', accent_dark: '#ff6e3a', accent_band: '#a63b14', ink: '#f5f5f5', soft: '#b6bcc6', bg: '#0e1116', card: '#1c1f23', line: '#33353a', wash: '#16191e', font_display: 'Space Grotesk, system-ui, sans-serif', font_body: 'Inter, system-ui, sans-serif', buttons: 'filled', button_radius: '4px', radius: '4px' } },
  { key: 'big_bright', name: 'Big & bright', mood: 'Bold', tokens: { look: 'big_bright', accent: '#d62839', accent_dark: '#ab202e', ink: '#101828', soft: '#475467', bg: '#ffffff', font_display: 'Outfit, system-ui, sans-serif', font_body: 'Figtree, system-ui, sans-serif', buttons: 'pill', font_scale: '1.08' } },
  { key: 'clinic_calm', name: 'Clinic calm', mood: 'Calm', tokens: { look: 'clinic_calm', accent: '#0e7c86', accent_dark: '#0b636b', ink: '#0e2f3a', soft: '#466069', bg: '#eef6f7', font_display: 'Plus Jakarta Sans, system-ui, sans-serif', font_body: 'Plus Jakarta Sans, system-ui, sans-serif', buttons: 'pill' } },
  { key: 'garden', name: 'Garden', mood: 'Calm', tokens: { look: 'garden', accent: '#2f5d3a', accent_dark: '#264a2e', ink: '#1f2a22', soft: '#55604f', bg: '#f1efe6', font_display: 'Lora, Georgia, serif', font_body: 'Manrope, system-ui, sans-serif', buttons: 'filled', button_radius: '10px', radius: '10px' } },
  { key: 'blush', name: 'Blush', mood: 'Elegant', tokens: { look: 'blush', accent: '#7a3b55', accent_dark: '#622f44', ink: '#2d1e24', soft: '#6e5a61', bg: '#f6e4df', font_display: 'DM Serif Display, Georgia, serif', font_body: 'DM Sans, system-ui, sans-serif', heading_weight: '400', buttons: 'pill' } },
  { key: 'black_gold', name: 'Black & gold', mood: 'Elegant', tokens: { look: 'black_gold', scheme: 'dark', accent: '#c9a45c', accent_dark: '#bf9c57', accent_band: '#6f5a33', ink: '#f5f0e6', soft: '#cfc6b8', bg: '#121212', card: '#201f1f', line: '#363634', wash: '#1a1a19', font_display: 'Playfair Display, Georgia, serif', font_body: 'Manrope, system-ui, sans-serif', buttons: 'filled', button_radius: '0px', radius: '2px' } },
  { key: 'newsprint', name: 'Newsprint', mood: 'Classic', tokens: { look: 'newsprint', accent: '#1a1a1a', accent_dark: '#000000', ink: '#1a1a1a', soft: '#4d4d4d', bg: '#f4f1ea', font_display: 'Libre Baskerville, Georgia, serif', font_body: 'Source Sans Three, system-ui, sans-serif', buttons: 'square', radius: '2px' } },
  { key: 'steady_navy', name: 'Steady navy', mood: 'Classic', tokens: { look: 'steady_navy', accent: '#13315c', accent_dark: '#0f274a', ink: '#0b2545', soft: '#4a5a70', bg: '#ffffff', font_display: 'Merriweather, Georgia, serif', font_body: 'Inter, system-ui, sans-serif', buttons: 'filled', button_radius: '2px', radius: '2px' } },
  { key: 'playground', name: 'Playground', mood: 'Friendly', tokens: { look: 'playground', accent: '#cc2a5a', accent_dark: '#a32248', ink: '#2b2d42', soft: '#5c5e70', bg: '#fff8e7', font_display: 'Quicksand, system-ui, sans-serif', font_body: 'Nunito, system-ui, sans-serif', buttons: 'pill', button_shadow: 'offset' } },
];

/** Everything a look may set: picking one clears all of these first, so the next look (or
 *  Original) leaves nothing of the last behind. */
export const LOOK_KEYS = ['accent', 'accent_dark', 'ink', 'soft', 'font_display', 'font_body', 'radius', 'bg', 'spacing_scale', 'font_scale', 'buttons', 'look', 'scheme', 'card', 'line', 'wash', 'accent_band', 'heading_case', 'heading_weight', 'button_radius', 'button_shadow'] as const;
/** The same, as the editor saves it: each setting emptied. */
export const LOOK_CLEAR: Readonly<Record<string, string>> = Object.fromEntries(LOOK_KEYS.map((k) => [k, '']));

/** One of the twelve by its key ('' and unknown keys: null). Pure. */
export const lookByKey = (key: unknown): StyleLook | null => (typeof key === 'string' && key ? STYLE_LOOKS.find((l) => l.key === key) || null : null);
