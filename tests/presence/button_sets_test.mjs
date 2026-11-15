// ── Builder list item 217 (Nov 2026): button sets and form styles ─────────────
//   deno run --allow-read --allow-env tests/presence/button_sets_test.mjs
// Two style settings restyle every button (filled, outline, pill, square, underline) and every
// box people type into (line, soft, round) across a site; none chosen leaves each template's own.
// This checks the settings, what a page carries, that a site without a choice is drawn exactly as
// before, and that every set reads at 4.5:1 on every template under every palette and look the
// editor offers, as the Buttons tab says. lib/site_buttons.ts is the code; the editor's tab is in
// presence.html (BUTTON_SET_OPTS, FORM_STYLE_OPTS); tests/e2e/button-sets-217.spec.ts draws it.
import { renderSnapshot, renderForBuilder, listTemplates, FIXED_COLOR_TEMPLATES } from '../../supabase/functions/presence/lib/render.ts';
import { validateThemeTokens } from '../../supabase/functions/presence/lib/devmode.ts';
import { contrastRatio, mix } from '../../supabase/functions/presence/lib/brand_kit.ts';
import { BUTTON_SETS, FORM_STYLES, buttonSetOf, formStyleOf, applyButtonStyles, buttonStyle, siteColours, buttonChoice, contrast, mixHex } from '../../supabase/functions/presence/lib/site_buttons.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const PAGE = Deno.readTextFileSync(new URL('../../presence.html', import.meta.url));

// ── the settings ──
ok('five sets and three form styles', BUTTON_SETS.join() === 'filled,outline,pill,square,underline' && FORM_STYLES.join() === 'line,soft,round');
ok('a set is one of the five, or the template’s own', BUTTON_SETS.every((s) => buttonSetOf(s) === s) && buttonSetOf('ghost') === null && buttonSetOf('') === null && buttonSetOf(undefined) === null);
ok('a form style is one of the three, or the template’s own', FORM_STYLES.every((s) => formStyleOf(s) === s) && formStyleOf('boxed') === null && formStyleOf(null) === null);
{
  const v = validateThemeTokens({ buttons: 'pill', forms: 'soft' });
  ok('the style layer keeps a known set and form style', v.tokens.buttons === 'pill' && v.tokens.forms === 'soft' && v.rejected.length === 0);
  const bad = validateThemeTokens({ buttons: 'pill;}body{display:none', forms: 'round ' });
  ok('and refuses anything else, so no CSS can ride in', !('buttons' in bad.tokens) && !('forms' in bad.tokens) && bad.rejected.includes('buttons') && bad.rejected.includes('forms'));
}

// ── what a page carries ──
const CSS = ':root{--paper:#f7f7f5;--ink:#1c2430;--accent:#23635a;--accent-dark:#17453f;--card:#ffffff;--soft:#5b6572}';
const page = '<!doctype html><html><head><link rel="stylesheet" href="/assets/site-0011.css"></head><body><main><a class="btn" href="/x/">Book</a><a class="btn ghost" href="/y/">See</a></main></body></html>';
const map = { 'index.html': page, 'about/index.html': page, 'assets/site-0011.css': CSS, 'robots.txt': 'x', 'menu.pdf': new Uint8Array([1]) };
ok('nothing chosen: every file is exactly as it was', applyButtonStyles(map, {}) === map && applyButtonStyles(map, undefined) === map && applyButtonStyles(map, { buttons: 'bevel' }) === map);
{
  const on = applyButtonStyles(map, { buttons: 'pill' });
  ok('a set chosen: each page carries one style, at the end of its head', on['index.html'].split('id="dds-buttons"').length === 2 && /<style id="dds-buttons">[^<]*<\/style><\/head>/.test(on['index.html']) && on['about/index.html'].includes('dds-buttons'));
  ok('files that aren’t pages are left alone', on['robots.txt'] === 'x' && on['menu.pdf'] === map['menu.pdf'] && on['assets/site-0011.css'] === CSS);
  ok('a page is never done twice', applyButtonStyles(on, { buttons: 'pill' })['index.html'] === on['index.html']);
}
{
  const c = siteColours(CSS, {});
  const each = Object.fromEntries(BUTTON_SETS.map((s) => [s, buttonStyle(s, null, c)]));
  ok('pill rounds every button', /:root \.btn\{[^}]*border-radius:999px/.test(each.pill) && !each.pill.includes('uppercase'));
  ok('square squares them and sets the words in capitals', /:root \.btn\{[^}]*border-radius:0;text-transform:uppercase/.test(each.square));
  ok('outline rules the main button and draws the second as words', /:root \.btn\{background:transparent;[^}]*border:2px solid currentColor/.test(each.outline) && /\.btn\.ghost,:root \.btn\.btn-outline\{background:none;[^}]*text-decoration:underline/.test(each.outline));
  ok('underline draws words with a thick rule and an arrow', each.underline.includes('text-decoration-thickness:3px') && each.underline.includes('content:"\\2192"') && !/:root \.btn\{[^}]*background:var/.test(each.underline));
  ok('the arrow only nudges for visitors whose device allows motion', /@media \(prefers-reduced-motion:no-preference\)\{[^@]*translateX\(3px\)/.test(each.underline));
  ok('filled tints the second button', /\.btn\.ghost,:root \.btn\.btn-outline\{background:var\(--dds-bm\)/.test(each.filled));
  ok('a page ships only its own set', BUTTON_SETS.every((s) => BUTTON_SETS.filter((o) => o !== s).every((o) => buttonStyle(s, null, c) !== buttonStyle(o, null, c))) && !each.pill.includes('\\2192') && !each.pill.includes('input:not'));
  ok('a form style alone carries no button rules', !/\.btn\{/.test(buttonStyle(null, 'soft', c)) && buttonStyle(null, 'soft', c).includes('textarea'));
  ok('form styles leave tick boxes, choices, files and buttons alone', /input:not\(\[type=checkbox\],\[type=radio\],\[type=file\],\[type=submit\],\[type=button\]/.test(buttonStyle(null, 'line', c)));
  ok('every form style keeps a visible ring when a box has the cursor', FORM_STYLES.every((f) => buttonStyle(null, f, c).includes(':focus-visible{outline:2px solid var(--dds-bl)')));
  const sizes = BUTTON_SETS.flatMap((s) => [null, ...FORM_STYLES].map((f) => buttonStyle(s, f, c).length));
  ok(`small: the largest set with a form style is ${Math.max(...sizes)} bytes, under 2.5 kB`, Math.max(...sizes) < 2500);
  ok('nothing chosen draws nothing', buttonStyle(null, null, c) === '');
}
// the dark and accent sections: words stay white on the section's own colour
{
  const c = siteColours(CSS, {});
  const filled = buttonStyle('filled', null, c);
  ok('on an accent section a second button is ruled, never a lighter tint behind white words', /\.block--bg-accent \.btn\.ghost,:root \.block--bg-accent \.btn\.btn-outline\{background:transparent;color:#fff;border-color:#fff\}/.test(filled));
  ok('on a dark section a filled main button keeps the readable fill', /:root \.block--bg-dark \.btn\{background:var\(--dds-bf\);color:var\(--dds-bi\)/.test(filled));
}

// ── the colour arithmetic is lib/brand_kit's ──
ok('contrast agrees with brand_kit', [['#ffffff', '#23635a'], ['#1c2430', '#f7f7f5'], ['#2dd4bf', '#06201c']].every(([a, b]) => Math.abs(contrast(a, b) - contrastRatio(a, b)) < 1e-9));
ok('mixing agrees with brand_kit (there t is the share of the second colour)', mixHex('#23635a', '#ffffff', 0.12) === mix('#ffffff', '#23635a', 0.12) && mixHex('#1c2430', '#f7f7f5', 0.62) === mix('#f7f7f5', '#1c2430', 0.62));

// ── every set reads on every template, under every palette and look the editor offers ──
const pageArray = (name) => new Function(`return ${PAGE.match(new RegExp(`\\nconst ${name} = (\\[[\\s\\S]*?\\n\\]);`))[1]};`)();
const CHOICES = [{ name: 'its own colours', tokens: {} }, ...[...pageArray('PALETTES'), ...pageArray('STYLE_LOOKS')].filter((p) => p.tokens && Object.keys(p.tokens).length)];
const DARK_BAND = '#1a1622';   // BLOCK_CSS .block--bg-dark
const sample = new Map();
for (const { slug } of listTemplates()) {
  const fx = JSON.parse(Deno.readTextFileSync(new URL(`../../supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`, import.meta.url)));
  const files = await renderSnapshot(fx, { baseUrl: 'https://example.com' });
  sample.set(slug, { fx, files });
  const css = String(files[Object.keys(files).find((k) => k.startsWith('assets/') && k.endsWith('.css'))]);
  const worst = {};
  const note = (k, v, why) => { if (!worst[k] || v < worst[k].v) worst[k] = { v, why }; };
  for (const choice of FIXED_COLOR_TEMPLATES.has(slug) ? CHOICES.slice(0, 1) : CHOICES) {
    const c = siteColours(css, choice.tokens), ch = buttonChoice(c), w = choice.name;
    note('a filled button’s words on its fill', contrast(ch.onFill, ch.fill), `${ch.onFill} on ${ch.fill}, ${w}`);
    note('ruled and underlined buttons on the page', contrast(ch.line, c.paper), `${ch.line} on ${c.paper}, ${w}`);
    note('ruled and underlined buttons on a card band', contrast(ch.line, c.card), `${ch.line} on ${c.card}, ${w}`);
    note('ruled and underlined buttons on a tinted section', contrast(ch.line, mixHex(c.accent, c.paper, 0.08)), w);
    note('a ruled button when pressed', contrast(ch.onLine, ch.line), `${ch.onLine} on ${ch.line}, ${w}`);
    note('a second button drawn as words', Math.min(contrast(ch.text, c.paper), contrast(ch.text, c.card)), `${ch.text}, ${w}`);
    note('a filled set’s tinted second button', contrast(ch.line, ch.tint), `${ch.line} on ${ch.tint}, ${w}`);
    note('words typed in a Soft box', contrast(c.ink, ch.field), `${c.ink} on ${ch.field}, ${w}`);
    note('example words in a Soft or Round box', Math.min(contrast(ch.placeholder, ch.field), contrast(ch.placeholder, c.card)), `${ch.placeholder}, ${w}`);
    note('example words in a Line box', contrast(mixHex(c.ink, c.paper, 0.78), c.paper), w);
    note('white words on a dark section’s soft second button', contrast('#ffffff', mixHex('#ffffff', DARK_BAND, 0.12)), w);
    note('the edge of a Round box (3:1)', contrast(ch.fieldBorder, c.paper) / 3 * 4.5, `${ch.fieldBorder} on ${c.paper}, ${w}`);
  }
  for (const [k, { v, why }] of Object.entries(worst)) ok(`${slug}: ${k} reads at ${(k.includes('3:1') ? v / 4.5 * 3 : v).toFixed(2)}:1`, v >= 4.5, why);
}

// ── a site without a choice is drawn as before; with one, every page and the canvas carry it ──
for (const [slug, { fx, files }] of sample) {
  ok(`${slug}: no choice, no button style on any page`, Object.entries(files).every(([k, v]) => !k.endsWith('.html') || !String(v).includes('dds-buttons')));
  const tokens = { ...(fx.dev_customization?.theme_tokens || {}), buttons: 'square', forms: 'round' };
  const snap = { ...fx, dev_customization: { theme_tokens: tokens, custom_css: '', custom_html: '' } };
  const on = await renderSnapshot(snap, { baseUrl: 'https://example.com' });
  const pages = Object.entries(on).filter(([k]) => k.endsWith('.html'));
  ok(`${slug}: square buttons and round boxes on every page`, pages.length > 2 && pages.every(([, v]) => String(v).includes('<style id="dds-buttons">') && String(v).includes('text-transform:uppercase')));
  const home = String(on['index.html']);
  ok(`${slug}: the set comes before the developer layer, so a developer’s own CSS has the last word`, home.indexOf('id="dds-buttons"') < home.indexOf('id="presence-dev"'));
  const canvas = await renderForBuilder(snap);
  ok(`${slug}: the builder’s canvas shows the set too`, String(canvas['index.html']).includes('id="dds-buttons"'));
}

// ── the editor's Buttons tab names the same sets ──
{
  const opts = (name) => [...(PAGE.match(new RegExp(`const ${name} = \\[([^\\n]*)\\];`)) || [, ''])[1].matchAll(/\["[^"]*", "([a-z]*)"/g)].map((m) => m[1]);
  ok('the Buttons tab offers the template’s own and the five sets', JSON.stringify(opts('BUTTON_SET_OPTS')) === JSON.stringify(['', ...BUTTON_SETS]));
  ok('and the template’s own and the three form styles', JSON.stringify(opts('FORM_STYLE_OPTS')) === JSON.stringify(['', ...FORM_STYLES]));
  ok('Buttons is a Styles tab', /data-stab="buttons"[^>]*>Buttons<\/button>/.test(PAGE) && /\["looks", "fonts", "colours", "buttons", "text"\]\.indexOf\(name\)/.test(PAGE) && /\[data-stab="buttons"\] \.dc-panel-scroll \[data-stab\]:not\(\[data-stab="buttons"\]\)/.test(PAGE));
  ok('a new set redraws the canvas from the server, which draws the set', /const redraw = "buttons" in change \|\| "forms" in change;/.test(PAGE));
}

const failed = results.filter((r) => !r.p).length;
console.log(`${failed ? 'FAIL' : 'PASS'}  button sets and form styles (item 217) — ${results.length} assertions, ${failed} failures`);
if (failed) Deno.exit(1);
