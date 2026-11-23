// ── Accent sections read on every template (found building list item 217, Nov 2026) ──
//   deno run --allow-read --allow-env tests/presence/accent_band_test.mjs
// A section whose background is "accent" (BLOCK_CSS .block--bg-accent) draws white words on the
// site's darker accent. Slate's two teals are light, as its dark page needs, so the words read
// 2.49:1 on #14b8a6; Slate now names a deeper teal for the band, --accent-band. This draws every
// template's full sample with every section on the accent band, reads what the band draws from
// the stylesheet the site ships and from every button set (lib/site_buttons.ts), and measures
// each colour of words on each colour behind them: under the template's own colours, and under
// every palette and look the editor offers to a template that takes them.
import { renderSnapshot, renderForBuilder, listTemplates, FIXED_COLOR_TEMPLATES } from '../../supabase/functions/presence/lib/render.ts';
import { BLOCK_CSS } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { BUTTON_SETS, buttonStyle, siteColours, contrast, mixHex, hex6 } from '../../supabase/functions/presence/lib/site_buttons.ts';
import { STYLE_LOOKS } from '../../supabase/functions/presence/lib/style_looks.ts';   // the ready-made looks: the server's one list
import { fixture, fullFixture } from './full_fixture.mjs';
import { editorSource } from './editor_source.mjs';   // builder item 38: the editor is four files now

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const PAGE = editorSource();
const SITE = { baseUrl: 'https://example.com' };
const cssOf = (files) => String(files[Object.keys(files).find((k) => k.startsWith('assets/') && k.endsWith('.css'))]);

// ── the band's colour, and who reads it ──
const BAND = 'var(--accent-band,var(--accent-dark,var(--accent)))';
ok('an accent section is drawn in --accent-band where a template names one, else the darker accent, and the site’s grey words follow its white ones', BLOCK_CSS.includes(`.block.block--bg-accent{background:${BAND};color:#fff;--soft:currentColor}`));
ok('its buttons are white, with words in the band’s colour', BLOCK_CSS.includes(`.block.block--bg-accent .btn{background:#fff;color:${BAND};border-color:#fff}`));
const bandWords = (/\.block\.block--bg-accent :is\(([^)]*)\)[^{]*\{color:inherit\}/.exec(BLOCK_CSS)?.[1] || '').split(',');
ok('a form’s labels and its red required mark (a span) take the band’s white words', bandWords.includes('label') && bandWords.includes('span'));
ok('a section’s own accent colour (its Style tab) still colours its band', BLOCK_CSS.includes('.block.ov-accent{--accent:var(--ov-accent);--accent-dark:var(--ov-accent-dark,var(--ov-accent));--accent-band:var(--ov-accent-dark,var(--ov-accent))}'));
ok('the section’s Accent theme tile is drawn in the band’s colour, as the canvas has it', PAGE.includes('["band", "--accent-band"]') && PAGE.includes('if (v === "accent") return { bg: c.band,'));

// ── reading the rules ──
/** Rules outside @media blocks (print rules don't draw the screen), as {selectors, declarations}. */
const screenRules = (css) => {
  let s = css.replace(/\/\*[\s\S]*?\*\//g, ''), i;
  while ((i = s.indexOf('@media')) >= 0) {
    let k = s.indexOf('{', i), depth = 0;
    for (; k < s.length; k++) { if (s[k] === '{') depth++; else if (s[k] === '}' && --depth === 0) break; }
    s = s.slice(0, i) + s.slice(k + 1);
  }
  return [...s.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].split(/,(?![^(]*\))/).map((x) => x.trim()), decl: m[2] }));
};
/** The rules that reach into an accent section. */
const bandRules = (css) => screenRules(css).filter((r) => r.sels.some((s) => s.includes('.block--bg-accent')));
const prop = (decl, name) => { let v; for (const m of decl.matchAll(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'g'))) v = m[1].trim(); return v; };
/** What a colour value draws on this site: the band's colour, white or a hex, a share of white or
 *  black over the band (the cards, the boxes), or the boxes' own fill where the template names one
 *  (--band-box); null for a value this check can't read yet. */
const colour = (v, band, box) => {
  if (v === BAND) return band;
  const named = /^var\(--band-box,(.*)\)$/.exec(v);
  if (named) return box || colour(named[1], band);
  const w = /^rgba\((255|0),\s*\1,\s*\1,\s*([\d.]+)\)$/.exec(v);
  return w ? mixHex(w[1] === '255' ? '#ffffff' : '#000000', band, Number(w[2])) : hex6(v);
};
/** A template's --band-box, followed to a hex through its :root variables; null where it names none. */
const boxOf = (css) => {
  const vars = {};
  for (const r of screenRules(css)) if (r.sels.includes(':root')) for (const m of r.decl.matchAll(/--([\w-]+)\s*:\s*([^;]+)/g)) vars[m[1]] = m[2].trim();
  let v = vars['band-box'];
  for (let n = 0; v && n < 5; n++) { const m = /^var\(--([\w-]+)\)$/.exec(v); if (!m) break; v = vars[m[1]]; }
  return v ? hex6(v) : null;
};
/** Every colour of words the band draws, every colour behind them (the band, its cards), and the
 *  buttons that bring their own colour. */
function drawn(rules, band, box) {
  const self = rules.find((r) => r.sels.includes('.block.block--bg-accent'));
  const ink = colour(prop(self?.decl || '', 'color') || '', band);
  const behind = [['the band', band]], words = [['the band’s words', ink]], own = [], unread = [];
  for (const r of rules) {
    if (r === self) continue;
    const what = r.sels.find((s) => s.includes('.block--bg-accent'));
    const bgv = prop(r.decl, 'background') ?? prop(r.decl, 'background-color'), fgv = prop(r.decl, 'color');
    const clear = bgv === undefined || bgv === 'transparent' || bgv === 'none';
    const bg = clear ? null : colour(bgv, band, box), fg = fgv === undefined ? null : fgv === 'inherit' ? ink : colour(fgv, band, box);
    if ((!clear && !bg) || (fgv !== undefined && !fg)) { unread.push(`${what}{${r.decl}}`); continue; }
    if (bg && fg) own.push([what, fg, bg]);
    else if (bg) behind.push([what, bg]);
    else if (fg) words.push([what, fg]);
  }
  return { behind, words, own, unread };
}

// ── every template, every set, every palette ──
const pageArray = (name) => new Function(`return ${PAGE.match(new RegExp(`\\nconst ${name} = (\\[[\\s\\S]*?\\n\\]);`))[1]};`)();
const CHOICES = [{ name: 'its own colours', tokens: {} }, ...[...pageArray('PALETTES'), ...STYLE_LOOKS].filter((p) => p.tokens && Object.keys(p.tokens).length)];
const onBand = (list) => (list || []).map((b) => ({ ...b, look: { ...(b.look || {}), background: 'accent' } }));
for (const { slug } of listTemplates()) {
  const fx = fullFixture(slug);   // one of every section the builder offers, a form among them
  fx.content.settings.blocks = onBand(fx.content.settings.blocks);
  fx.content.settings.pages = fx.content.settings.pages.map((p) => ({ ...p, blocks: onBand(p.blocks) }));
  const files = await renderSnapshot(fx, SITE);
  const css = cssOf(files), rules = bandRules(css);
  ok(`${slug}: the sample draws its sections on the accent band, and ships the band’s rules`, String(files['index.html']).includes('block--bg-accent') && css.includes(`.block.block--bg-accent{background:${BAND}`) && css.includes('.block.block--bg-accent .btn{'));
  const own = siteColours(css, {});
  ok(slug === 'slate' ? 'slate: names a deeper teal for its band, and keeps its two teals, so its links, labels and button hovers read as before'
    : `${slug}: draws its band in its darker accent, as before`,
  slug === 'slate' ? own.band === '#115e59' && own.accent === '#2dd4bf' && own.accentDark === '#14b8a6' : !css.includes('--accent-band:') && own.band === own.accentDark);
  const worst = {}, unread = new Set();
  const note = (k, v, why) => { if (!worst[k] || v < worst[k].v) worst[k] = { v, why }; };
  for (const choice of FIXED_COLOR_TEMPLATES.has(slug) ? CHOICES.slice(0, 1) : CHOICES) {
    const c = siteColours(css, FIXED_COLOR_TEMPLATES.has(slug) ? null : choice.tokens);
    for (const set of [null, ...BUTTON_SETS]) {
      const style = set ? buttonStyle(set, null, c).replace(/^<style[^>]*>|<\/style>$/g, '') : '';
      const setRules = bandRules(style);
      const d = drawn([...rules, ...setRules], c.band, boxOf(css)), w = `${set || 'the template’s'} buttons, ${choice.name}`;
      d.unread.forEach((x) => unread.add(x));
      for (const [wa, fg] of d.words) for (const [ba, bg] of d.behind) note('words on the band and on a card in it', contrast(fg, bg), `${wa} ${fg} on ${ba} ${bg}, ${w}`);
      for (const [wa, fg, bg] of d.own) note('a button on the band, its words on its own colour', contrast(fg, bg), `${wa} ${fg} on ${bg}, ${w}`);
      // a filled, pill or square set darkens a button when it's pressed; on the band, that's the white one
      const press = /:root \.btn:hover\{box-shadow:inset 0 0 0 999px rgba\(0,0,0,([\d.]+)\)/.exec(style);
      const white = d.own.find(([wa]) => wa === '.block.block--bg-accent .btn');
      if (press && white && !setRules.some((r) => r.sels.includes(':root .block--bg-accent .btn'))) note('a button on the band when pressed', contrast(white[1], mixHex('#000000', white[2], Number(press[1]))), `${white[1]}, ${w}`);
    }
  }
  ok(`${slug}: every colour the band draws is one this check reads`, unread.size === 0, [...unread].join(' | '));
  ok(`${slug}: the band's words, its buttons and a pressed button were all measured`, Object.keys(worst).length === 3, Object.keys(worst).join(', '));
  for (const [k, { v, why }] of Object.entries(worst)) ok(`${slug}: ${k} reads at ${v.toFixed(2)}:1 at worst`, v >= 4.5, why);

  // pages stay light: a site with no accent section ships none of the band's rules
  const plain = cssOf(await renderSnapshot(fixture(slug), SITE));
  ok(`${slug}: a site with no accent section ships none of the band’s rules`, !plain.includes('.block.block--bg-accent'));
}

// the builder's canvas keeps every section style, so the tile and a section just set to accent agree
{
  const canvas = cssOf(await renderForBuilder(fixture('slate')));
  ok('slate: the canvas draws the band in the deeper teal too', canvas.includes('--accent-band:#115e59') && canvas.includes(`.block.block--bg-accent{background:${BAND}`));
}

const failed = results.filter((r) => !r.p).length;
console.log(`${failed ? 'FAIL' : 'PASS'}  accent sections read on every template — ${results.length} assertions, ${failed} failures`);
if (failed) Deno.exit(1);
