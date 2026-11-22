// ── Owner palettes: contrast and token checks ────────────────────────────────
// Accessibility stays a PLATFORM guarantee even when the customer picks the look:
// every palette must pass real WCAG contrast math — white-on-accent ≥ 4.5:1
// (buttons/links on accent), ink-on-paper ≥ 7:1 (body text on both templates'
// paper tones) — and every token must pass the devmode validation rules, and the
// dev layer must emit the dash-cased vars the templates actually consume.
// Item 105: the server's second copy of the palettes (lib/palettes.ts PALETTES)
// had no caller, so it went. These checks now read the lists owners actually pick
// from: presence.html's PALETTES and the colours of its STYLE_LOOKS.
// Item 333: the twelve ready-made looks each bring their own page colour (two of them dark) and
// a button set, so a look is measured on its own page and with the button words the site draws
// (lib/site_buttons.ts buttonChoice). tests/presence/style_looks_333_test.mjs reads every word
// of every template under each.
//   deno run --allow-read --allow-env tests/presence/palettes_test.mjs
import { validateThemeTokens } from '../../supabase/functions/presence/lib/devmode.ts';
import { devLayerFragments } from '../../supabase/functions/presence/lib/render.ts';
import { buttonChoice } from '../../supabase/functions/presence/lib/site_buttons.ts';
import { editorSource } from './editor_source.mjs';   // builder item 38: the editor is four files now

const PAGE = editorSource();
/** A top-level `const NAME = [ ... ];` array literal from the page, evaluated. */
function pageArray(name) {
  const m = PAGE.match(new RegExp(`\\nconst ${name} = (\\[[\\s\\S]*?\\n\\]);`));
  if (!m) throw new Error(`presence.html has no const ${name} = [...]`);
  return new Function(`return ${m[1]};`)();
}
const PALETTES = pageArray('PALETTES').filter((p) => p.tokens);   // "Original" has none
const LOOKS = pageArray('STYLE_LOOKS').filter((l) => l.tokens && l.tokens.accent).map((l) => ({ key: `look "${l.name}"`, tokens: l.tokens }));

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

// ═══ 1. every palette and look: valid tokens + real contrast ═══
ok('the page offers six palettes and twelve looks', PALETTES.length === 6 && LOOKS.length === 12, `${PALETTES.length} + ${LOOKS.length}`);
ok('each palette swatch shows its own accent', PALETTES.every((p) => p.accent === p.tokens.accent));
for (const p of PALETTES) {
  const v = validateThemeTokens(p.tokens);
  ok(`${p.key}: all tokens pass devmode validation`, v.rejected.length === 0 && Object.keys(v.tokens).length === 4);
  ok(`${p.key}: white on accent ≥ 4.5:1 (buttons)`, ratio('#ffffff', p.tokens.accent) >= 4.5, ratio('#ffffff', p.tokens.accent).toFixed(2));
  ok(`${p.key}: white on accent_dark ≥ 4.5:1 (hover)`, ratio('#ffffff', p.tokens.accent_dark) >= 4.5);
  ok(`${p.key}: ink ≥ 7:1 on both templates' paper`, PAPERS.every((bg) => ratio(p.tokens.ink, bg) >= 7));
  ok(`${p.key}: soft text ≥ 4.5:1 on both papers`, PAPERS.every((bg) => ratio(p.tokens.soft, bg) >= 4.5));
}
// a look is drawn on its own page colour, with its own button set
for (const p of LOOKS) {
  const t = p.tokens, v = validateThemeTokens(t);
  ok(`${p.key}: every setting passes devmode validation`, v.rejected.length === 0 && Object.keys(v.tokens).length === Object.keys(t).length, v.rejected.join(', '));
  const ch = buttonChoice({ paper: t.bg, ink: t.ink, accent: t.accent, accentDark: t.accent_dark, band: t.accent_band || t.accent_dark, card: t.card || t.bg, soft: t.soft });
  ok(`${p.key}: a button's words on its fill ≥ 4.5:1`, ratio(ch.onFill, ch.fill) >= 4.5, `${ch.onFill} on ${ch.fill}`);
  ok(`${p.key}: the fill is the look's own accent`, ch.fill === t.accent);
  ok(`${p.key}: the darker shade reads on the look's page (links, small words) ≥ 4.5:1`, ratio(t.accent_dark, t.bg) >= 4.5, ratio(t.accent_dark, t.bg).toFixed(2));
  ok(`${p.key}: ink ≥ 7:1 on its page`, ratio(t.ink, t.bg) >= 7, ratio(t.ink, t.bg).toFixed(2));
  ok(`${p.key}: soft text ≥ 4.5:1 on its page`, ratio(t.soft, t.bg) >= 4.5);
  ok(`${p.key}: white words on its accent sections ≥ 4.5:1`, ratio('#ffffff', t.accent_band || t.accent_dark) >= 4.5);
}

// ═══ 2. the dev layer emits the dash vars the templates consume ═══
{
  const s = devLayerFragments({ theme_tokens: PALETTES[1].tokens, custom_css: '', custom_html: '' }).style;
  ok('emits --accent + --ink + --soft', s.includes('--accent:#') && s.includes('--ink:#') && s.includes('--soft:#'));
  ok('accent_dark also emits template-consumable --accent-dark', s.includes('--accent_dark:#') && s.includes('--accent-dark:#'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
