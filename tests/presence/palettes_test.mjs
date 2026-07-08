// ── Phase COMP: curated palettes (FD-T6-lite) ────────────────────────────────
// Accessibility stays a PLATFORM guarantee even when the customer picks the look:
// every palette must pass real WCAG contrast math — white-on-accent ≥ 4.5:1
// (buttons/links on accent), ink-on-paper ≥ 7:1 (body text on both templates'
// paper tones) — and every token must pass the devmode validation rules, and the
// dev layer must emit the dash-cased vars the templates actually consume.
//   deno run --allow-read --allow-env tests/presence/palettes_test.mjs
import { PALETTES, paletteByKey, currentPaletteKey } from '../../supabase/functions/presence/lib/palettes.ts';
import { validateThemeTokens } from '../../supabase/functions/presence/lib/devmode.ts';
import { devLayerFragments } from '../../supabase/functions/presence/lib/render.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// WCAG relative luminance + contrast ratio
function lum(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

const PAPERS = ['#f7f7f5' /* business-classic */, '#faf6ef' /* restaurant-classic */];

// ═══ 1. every palette: valid tokens + real contrast ═══
ok('6 curated palettes', PALETTES.length === 6);
for (const p of PALETTES) {
  const v = validateThemeTokens(p.tokens);
  ok(`${p.key}: all tokens pass devmode validation`, v.rejected.length === 0 && Object.keys(v.tokens).length === 4);
  ok(`${p.key}: white on accent ≥ 4.5:1 (buttons)`, ratio('#ffffff', p.tokens.accent) >= 4.5, ratio('#ffffff', p.tokens.accent).toFixed(2));
  ok(`${p.key}: white on accent_dark ≥ 4.5:1 (hover)`, ratio('#ffffff', p.tokens.accent_dark) >= 4.5);
  ok(`${p.key}: ink ≥ 7:1 on both templates' paper`, PAPERS.every((bg) => ratio(p.tokens.ink, bg) >= 7));
  ok(`${p.key}: soft text ≥ 4.5:1 on both papers`, PAPERS.every((bg) => ratio(p.tokens.soft, bg) >= 4.5));
}

// ═══ 2. the dev layer emits the dash vars the templates consume ═══
{
  const s = devLayerFragments({ theme_tokens: PALETTES[1].tokens, custom_css: '', custom_html: '' }).style;
  ok('emits --accent + --ink + --soft', s.includes('--accent:#') && s.includes('--ink:#') && s.includes('--soft:#'));
  ok('accent_dark also emits template-consumable --accent-dark', s.includes('--accent_dark:#') && s.includes('--accent-dark:#'));
}

// ═══ 3. helpers ═══
ok('paletteByKey + currentPaletteKey round-trip', paletteByKey('harbor').name === 'Harbor blue' && currentPaletteKey(paletteByKey('harbor').tokens) === 'harbor' && currentPaletteKey({}) === '' && currentPaletteKey({ accent: '#000001' }) === '');

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
