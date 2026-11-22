// ── The twelve ready-made looks (builder list item 333, Nov 2026) ──────────────────────────
//   deno run --allow-read --allow-env tests/presence/style_looks_333_test.mjs
// Eric picked twelve looks in Figma (section D), grouped by mood. The editor holds them
// (presence-edit.js STYLE_LOOKS); each sets colours, two library fonts and a button set through the
// style settings, and a few settings of its own that lib/site_looks.ts draws: headings in capitals
// or at regular weight, the buttons' corners, a solid shadow, the look's own small layer of rules,
// and a dark page. This drives the settings' validation, the layer itself, how pages carry it, that a
// site without a look is drawn exactly as before, and then reads every word on every page of every
// template under every look (the cascade in style_cascade.mjs), on a desktop and a phone, with the
// sections plain and on the accent and dark bands: each must read at 4.5:1 or better.
// tests/e2e/style-looks-333.spec.ts draws the tiles in the editor.
import { validateThemeTokens } from '../../supabase/functions/presence/lib/devmode.ts';
import { renderSnapshot, renderForBuilder, listTemplates, FIXED_COLOR_TEMPLATES } from '../../supabase/functions/presence/lib/render.ts';
import { lookStyle, lookSettings, applyLookLayer, leaveDarkLook, ownButtonWords, LOOK_COLOUR_TOKENS, DARK_LOOK_TOKENS } from '../../supabase/functions/presence/lib/site_looks.ts';
import { STYLE_LOOKS, LOOK_CLEAR, LOOK_KEYS, lookByKey } from '../../supabase/functions/presence/lib/style_looks.ts';
import { siteColours, buttonChoice, contrast } from '../../supabase/functions/presence/lib/site_buttons.ts';
import { FONT_LIBRARY, libraryFontsIn, fontStack } from '../../supabase/functions/presence/lib/fonts.ts';
import { fixture, fullFixture } from './full_fixture.mjs';
import { parseHtml, elementsIn, sheetsOf, cascade, hexOf } from './style_cascade.mjs';
import { editorSource } from './editor_source.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const SITE = { baseUrl: 'https://example.com' };

// ── the looks, as the editor is sent them (lib/style_looks.ts), and what it clears when a colour is picked over a dark one ──
const PAGE = editorSource();
const pageValue = (name, open, close) => new Function(`return ${PAGE.match(new RegExp(`\\nconst ${name} = (\\${open}[\\s\\S]*?\\${close});`))[1]};`)();
const ALL = STYLE_LOOKS, CLEAR = LOOK_CLEAR, DARK_CLEAR = pageValue('DARK_LOOK_CLEAR', '{', '}');
const LOOKS = ALL.filter((l) => l.key);
const FIGMA = [['Golden hour', 'Warm'], ['Hand-lettered', 'Warm'], ['Hard hat', 'Bold'], ['Night shift', 'Bold'], ['Big & bright', 'Bold'], ['Clinic calm', 'Calm'], ['Garden', 'Calm'],
  ['Blush', 'Elegant'], ['Black & gold', 'Elegant'], ['Newsprint', 'Classic'], ['Steady navy', 'Classic'], ['Playground', 'Friendly']];
ok('Original comes first and sets nothing', ALL[0].name === 'Original' && ALL[0].key === '' && Object.keys(ALL[0].tokens).length === 0);
ok('then the twelve, in the order and moods picked in Figma', JSON.stringify(LOOKS.map((l) => [l.name, l.mood])) === JSON.stringify(FIGMA), LOOKS.map((l) => l.name).join(', '));
ok('every look names itself', LOOKS.every((l) => l.tokens.look === l.key));
ok('no name or mood carries a dash for a pause', ALL.every((l) => !/[—–]/.test(l.name + l.mood)));
for (const l of LOOKS) {
  const t = l.tokens, v = validateThemeTokens(t);
  ok(`${l.name}: every setting passes the style layer's checks`, v.rejected.length === 0 && Object.keys(v.tokens).length === Object.keys(t).length, v.rejected.join(', '));
  const fonts = libraryFontsIn(t);
  ok(`${l.name}: both fonts are library families, named as the library names them`, ['font_display', 'font_body'].every((k) => fonts.some((f) => fontStack(f) === t[k])), `${t.font_display} / ${t.font_body}`);
  ok(`${l.name}: the look clears every setting it makes, so the next look leaves nothing of it`, Object.keys(t).every((k) => k in CLEAR));
}
ok('a dark look is cleared whole when a colour is picked over it', LOOKS.filter((l) => l.tokens.scheme).every((l) => Object.keys(l.tokens).filter((k) => !/^(font_|buttons|button_|radius|heading_)/.test(k)).every((k) => k in DARK_CLEAR)));
// the faces drawn: Blush's face has one weight, so its headings are set at it; Hard hat's are in capitals
{
  const by = Object.fromEntries(LOOKS.map((l) => [l.key, l.tokens]));
  ok('Blush sets its headings at the one weight its face has', FONT_LIBRARY.find((f) => f.css === 'DM Serif Display').weights.join() === '400' && by.blush.heading_weight === '400');
  ok('Hard hat sets its headings in capitals, Playground its button shadow, Big & bright the larger text', by.hard_hat.heading_case === 'upper' && by.playground.button_shadow === 'offset' && by.big_bright.font_scale === '1.08');
  ok('the two dark looks are Night shift and Black & gold', LOOKS.filter((l) => l.tokens.scheme === 'dark').map((l) => l.key).join() === 'night_shift,black_gold');
}
// each look's own colours: words on its page, button words on its fill (as the site fills it), its accent sections
for (const l of LOOKS) {
  const t = l.tokens;
  const ch = buttonChoice({ paper: t.bg, ink: t.ink, accent: t.accent, accentDark: t.accent_dark, band: t.accent_band || t.accent_dark, card: t.card || t.bg, soft: t.soft });
  const worst = Math.min(contrast(t.ink, t.bg), contrast(t.soft, t.bg), contrast(ch.onFill, ch.fill), contrast(t.accent_dark, t.bg), contrast('#ffffff', t.accent_band || t.accent_dark));
  ok(`${l.name}: text, soft text, its darker shade and button words read at 4.5:1 or better (worst ${worst.toFixed(2)})`, worst >= 4.5);
}

// ── the settings ──
{
  const good = { look: 'golden_hour', scheme: 'dark', card: '#1c1f23', line: '#33353a', wash: '#16191e', accent_band: '#a63b14', heading_case: 'upper', heading_weight: '400', button_radius: '14px', button_shadow: 'offset' };
  const v = validateThemeTokens(good);
  ok('the style layer keeps each of the looks\' settings', v.rejected.length === 0 && JSON.stringify(v.tokens) === JSON.stringify(good));
  ok('corners from 0 to 40px', ['0px', '4px', '40px'].every((r) => validateThemeTokens({ button_radius: r }).tokens.button_radius === r));
  const bad = { look: 'Golden Hour', scheme: 'light', card: 'red', line: '#12', wash: 'url(x)', accent_band: '#a63b14;}', heading_case: 'lower', heading_weight: '700', button_radius: '41px', button_shadow: 'blur' };
  const w = validateThemeTokens(bad);
  ok('and refuses anything else, so no CSS can ride in', Object.keys(w.tokens).length === 0 && w.rejected.length === Object.keys(bad).length, Object.keys(w.tokens).join(', '));
  ok('a corner in any other unit is refused', ['4em', '1rem', '4', '-4px', '100px'].every((r) => !validateThemeTokens({ button_radius: r }).tokens.button_radius));
}

// ── the layer ──
const css = (tokens, place) => lookStyle(tokens, place).replace(/^<style id="dds-look">|<\/style>$/g, '');
ok('nothing set draws nothing', lookStyle({}) === '' && lookStyle(null) === '' && lookStyle({ accent: '#123456', buttons: 'pill', radius: '8px' }) === '');
ok('a refused value draws nothing', lookStyle({ heading_case: 'lower', button_radius: '4em', button_shadow: 'x', scheme: 'light', look: 'X' }) === '');
ok('one style element when something is set', /^<style id="dds-look">[^<]+<\/style>$/.test(lookStyle({ heading_case: 'upper' })));
{
  const upper = css({ heading_case: 'upper' }), regular = css({ heading_weight: '400' }), corners = css({ button_radius: '4px' }), shadow = css({ button_shadow: 'offset' });
  ok('capitals set the headings in capitals, and nothing else', /:root :is\(h1,h2,h3\)\{text-transform:uppercase/.test(upper) && !/font-weight|border-radius|box-shadow|--/.test(upper));
  ok('regular weight sets headings and the name at 400, never thickened', /font-synthesis-weight:none/.test(regular) && /:is\(h1,h2,h3,\.brand\)\{font-weight:400\}/.test(regular) && !/text-transform|border-radius/.test(regular));
  ok('button corners round every button, the second ones too, by the setting', corners.includes(':root .btn,:root .btn.ghost,:root .btn.btn-outline{border-radius:var(--button-radius)}') && !/text-transform|box-shadow/.test(corners));
  ok('the shadow sits beside the main button only, and shrinks when pressed', /\.btn:not\(\.ghost\):not\(\.btn-outline\)\{box-shadow:3px 3px 0 var\(--ink\)\}/.test(shadow) && /:hover\{box-shadow:1px 1px 0 var\(--ink\)\}/.test(shadow));
  const look = css({ look: 'golden_hour' });
  ok('a look\'s own layer: small accent words in the darker shade, box examples in soft text', look.includes('.sp-eyebrow') && look.includes('::placeholder{color:var(--soft);opacity:1}') && !/color-scheme/.test(look));
  ok('a dark page comes only with the dark setting', /color-scheme:dark/.test(css({ scheme: 'dark' })) && /footer\.site,:root \.strip\{background:var\(--card\)\}/.test(css({ scheme: 'dark' })) && !/color-scheme/.test(css({ look: 'night_shift' })));
  const on = (template) => css({ look: 'garden' }, { template });
  ok('a template\'s own few rules come only on it: Harbor\'s headings, Aurora\'s and Meadow\'s headers, Meadow\'s glow', on('harbor').includes('.checklist li::before') && on('aurora').includes('header.site{background:color-mix(in srgb,var(--paper) 82%') && on('meadow').includes('body{background-image:none}')
    && ['business-classic', 'editorial', 'atelier', 'restaurant-classic', 'aurora', 'meadow'].every((t) => !on(t).includes('.checklist')) && on('business-classic') === look && on('editorial') === look);
  ok('on a dark page, the menu\'s place sits on the accent band only where the template fills it with the accent (Aurora, Meadow)', ['aurora', 'meadow'].every((t) => css({ scheme: 'dark' }, { template: t }).includes('a[aria-current="page"]{background:var(--accent-band)}'))
    && ['harbor', 'atelier', 'editorial', 'business-classic', 'restaurant-classic'].every((t) => !css({ scheme: 'dark' }, { template: t }).includes('aria-current')));
  const fixed = css({ look: 'black_gold', scheme: 'dark', heading_weight: '400', button_radius: '0px' }, { fixed: true, template: 'slate' });
  ok('a template that keeps its own colours takes the shapes and type, none of the colour rules', fixed.includes('font-weight:400') && fixed.includes('var(--button-radius)') && !/color-scheme|--accent|--steel|placeholder|footer/.test(fixed));
  ok('the settings are read the same way', JSON.stringify(lookSettings({ heading_case: 'upper', button_radius: '41px', scheme: 'dark' })) === JSON.stringify({ upper: true, regular: false, corners: false, offset: false, look: false, dark: true }));
}

// ── pages ──
{
  const page = '<!doctype html><html><head><title>x</title></head><body><a class="btn">Book</a></body></html>';
  const map = { 'index.html': page, 'about/index.html': page, 'robots.txt': 'x', 'logo.png': new Uint8Array([1]) };
  ok('nothing set: every file exactly as it was', applyLookLayer(map, {}) === map && applyLookLayer(map, null) === map && applyLookLayer(map, { buttons: 'pill' }) === map);
  const on = applyLookLayer(map, { look: 'garden', button_radius: '10px' });
  ok('a look set: each page carries one style, at the end of its head', ['index.html', 'about/index.html'].every((p) => on[p].split('id="dds-look"').length === 2 && /<style id="dds-look">[^<]*<\/style><\/head>/.test(on[p])));
  ok('files that aren\'t pages are left alone, and a page is never done twice', on['robots.txt'] === 'x' && on['logo.png'] === map['logo.png'] && applyLookLayer(on, { look: 'garden' })['index.html'] === on['index.html']);
}
const look = (key) => LOOKS.find((l) => l.key === key).tokens;
const withTokens = (fx, tokens) => ({ ...fx, dev_customization: { theme_tokens: tokens, custom_css: '', custom_html: '' } });
{
  const files = await renderSnapshot(withTokens(fixture('business-classic'), look('playground')), SITE);
  const home = String(files['index.html']);
  ok('a site drawn with a look: the set, then the look, then the developer layer', home.indexOf('id="dds-buttons"') > 0 && home.indexOf('id="dds-buttons"') < home.indexOf('id="dds-look"') && home.indexOf('id="dds-look"') < home.indexOf('id="presence-dev"'));
  ok('every page carries it', Object.entries(files).filter(([k]) => k.endsWith('.html')).every(([, v]) => String(v).includes('id="dds-look"')));
  const canvas = await renderForBuilder(withTokens(fixture('business-classic'), look('playground')));
  ok('the builder\'s canvas carries it too', String(canvas['index.html']).includes('id="dds-look"'));
}
// a site without a look is drawn as before: no new style, and the settings it has write the same variables
for (const { slug } of listTemplates()) {
  const own = await renderSnapshot(fixture(slug), SITE);
  ok(`${slug}: its own sample carries no look`, Object.entries(own).every(([k, v]) => !k.endsWith('.html') || !String(v).includes('dds-look')));
  const old = await renderSnapshot(withTokens(fixture(slug), { accent: '#8c3b2e', accent_dark: '#6f2e24', ink: '#241d1a', soft: '#6b5f58', radius: '18px', bg: '#faf6ee' }), SITE);   // the old "Warm" look's settings
  ok(`${slug}: a site on one of the old looks carries no look either`, Object.entries(old).every(([k, v]) => !k.endsWith('.html') || !String(v).includes('dds-look')));
}
// Slate keeps its own colours: a dark look's colours never reach it, its shapes and type do
{
  const files = await renderSnapshot(withTokens(fixture('slate'), look('black_gold')), SITE);
  const home = String(files['index.html']);
  const dev = /<style id="presence-dev">([^<]*)<\/style>/.exec(home)?.[1] || '';
  ok('slate: none of a dark look\'s colours in its style layer', LOOK_COLOUR_TOKENS.every((k) => !dev.includes(`--${k}:`)) && !dev.includes('--accent-band:'));
  ok('slate: no dark page rules, but the look\'s button corners', home.includes('var(--button-radius)') && !/color-scheme:dark;--paper/.test(home));
  const other = String((await renderSnapshot(withTokens(fixture('aurora'), look('black_gold')), SITE))['index.html']);
  ok('a template that takes colours gets them all', /--card:#201f1f/.test(other) && /--accent-band:#6f5a33/.test(other) && /color-scheme:dark/.test(other));
}
// the button set reads a dark look's cards and accent sections
{
  const c = siteColours(':root{--paper:var(--bg,#ffffff);--ink:#111111;--accent:#333333;--card:#ffffff}', look('night_shift'));
  ok('the button set measures against a dark look\'s cards and accent sections', c.card === '#1c1f23' && c.band === '#a63b14' && c.paper === '#0e1116');
  ok('a light look keeps the template\'s cards', siteColours(':root{--card:#fafafa}', look('garden')).card === '#fafafa');
}
// a brand colour over a dark look starts from the template's own colours, on a light page
{
  const night = look('night_shift');
  const left = leaveDarkLook(night);
  ok('a brand colour over a dark look leaves its colours, keeps its fonts, buttons and corners', DARK_LOOK_TOKENS.every((k) => !(k in left)) && left.font_display === night.font_display && left.buttons === 'filled' && left.button_radius === '4px');
  ok('any other style is returned as it is', leaveDarkLook(look('garden')) === look('garden') && JSON.stringify(leaveDarkLook(null)) === '{}');
}

// ── every word on every page, under every look ──
const VIEWS = [1280, 390];
const onBand = (fx, band) => {
  if (!band) return fx;
  const put = (list) => (list || []).map((b) => ({ ...b, look: { ...(b.look || {}), background: band } }));
  fx.content.settings.blocks = put(fx.content.settings.blocks);
  fx.content.settings.pages = fx.content.settings.pages.map((p) => ({ ...p, blocks: put(p.blocks) }));
  return fx;
};
for (const { slug } of listTemplates()) {
  if (FIXED_COLOR_TEMPLATES.has(slug)) continue;   // Slate keeps its own colours (above)
  for (const band of ['', 'accent', 'dark']) {
    let measured = 0, worst = { r: Infinity, why: '' };
    const unread = new Set(), under = [];
    for (const l of LOOKS) {
      const files = await renderSnapshot(withTokens(onBand(fullFixture(slug), band), l.tokens), SITE);
      for (const path of Object.keys(files).filter((k) => k.endsWith('.html'))) {
        const doc = parseHtml(String(files[path])), all = [...elementsIn(doc)];
        const head = all.find((e) => e.tag === 'head'), body = all.find((e) => e.tag === 'body');
        if (!head || !body) continue;
        const sheets = [...sheetsOf(head, files), ...sheetsOf(body, files)];
        for (const width of VIEWS) {
          const c = cascade(doc, sheets, { width, height: 900, later: true });
          c.unread.forEach((x) => unread.add(x));
          for (const el of elementsIn(body)) for (const w of c.words(el)) {
            measured++;
            const why = `${l.name}, ${path} at ${width}px: ${el.tag}${el.classes.size ? '.' + [...el.classes].join('.') : ''} "${w.what.slice(0, 30)}" ${hexOf(w.fg)} on ${hexOf(w.bg)}`;
            if (w.image) { unread.add(`words on a picture: ${why}`); continue; }
            if (w.ratio < worst.r) worst = { r: w.ratio, why };
            if (w.ratio < 4.5) under.push(`${w.ratio.toFixed(2)} ${why}`);
          }
        }
      }
    }
    const where = band ? `every section on the ${band} band` : 'its sections as they are';
    ok(`${slug}, ${where}: every colour, selector and rule is one the cascade reads`, unread.size === 0, [...unread].slice(0, 4).join(' | '));
    ok(`${slug}, ${where}: words were measured under all twelve looks (${measured})`, measured > 12 * 2000);
    ok(`${slug}, ${where}: every word reads at 4.5:1 or better under every look (worst ${worst.r.toFixed(2)}:1)`, under.length === 0, `${under.length} under: ${under.slice(0, 6).join(' | ')}`);
  }
}

// ── "Your template's" buttons picked over a look ──
// Styles' Buttons can go back to the template's own after a look (it clears the set, its corners and
// its shadow). Five templates fill their main button with the accent under white words; a look whose
// accent is too light for them gives those buttons words that read on it (lib/site_looks.ts).
{
  ok('a light look keeps the template\'s white button words', LOOKS.filter((l) => !l.tokens.scheme).every((l) => ownButtonWords(l.tokens) === ''));
  ok('the two dark looks\' bright accents take dark words that read on the accent and its darker shade', ['night_shift', 'black_gold'].every((k) => { const t = look(k), w = ownButtonWords(t); return w === '#111111' && contrast(w, t.accent) >= 4.5 && contrast(w, t.accent_dark) >= 4.5; }));
  ok('no accent, or one the style layer refuses, names no words', ownButtonWords({}) === '' && ownButtonWords(null) === '' && ownButtonWords({ accent: 'red' }) === '' && ownButtonWords({ accent: '#c9a45c80' }) === '');
  const own = (k) => { const { buttons: _b, button_radius: _r, button_shadow: _s, ...t } = look(k); return t; };
  ok('the words are written only with the template\'s own buttons, only on the five that fill them with the accent', css(own('black_gold'), { template: 'harbor' }).includes(':root .btn:not(:where(.ghost,.btn-outline)){color:#111111}')
    && !css(look('black_gold'), { template: 'harbor' }).includes(':where(.ghost') && ['atelier', 'editorial'].every((t) => !css(own('black_gold'), { template: t }).includes(':where(.ghost'))
    && !css(own('black_gold'), { fixed: true, template: 'slate' }).includes(':where(.ghost') && !css(own('garden'), { template: 'harbor' }).includes(':where(.ghost'));
  for (const { slug } of listTemplates()) {
    if (FIXED_COLOR_TEMPLATES.has(slug)) continue;
    let measured = 0;
    const under = [], unread = new Set();
    for (const l of LOOKS) {
      const files = await renderSnapshot(withTokens(fullFixture(slug), own(l.key)), SITE);
      for (const path of Object.keys(files).filter((k) => k.endsWith('.html'))) {
        const doc = parseHtml(String(files[path])), all = [...elementsIn(doc)];
        const head = all.find((e) => e.tag === 'head'), body = all.find((e) => e.tag === 'body');
        if (!head || !body) continue;
        const c = cascade(doc, [...sheetsOf(head, files), ...sheetsOf(body, files)], { width: 1280, height: 900, later: true });
        c.unread.forEach((x) => unread.add(x));
        for (const el of elementsIn(body)) for (const w of c.words(el)) {
          measured++;
          if (!w.image && w.ratio < 4.5) under.push(`${w.ratio.toFixed(2)} ${l.name}, ${path}: ${el.tag}${el.classes.size ? '.' + [...el.classes].join('.') : ''} "${w.what.slice(0, 30)}" ${hexOf(w.fg)} on ${hexOf(w.bg)}`);
        }
      }
    }
    ok(`${slug}, the template's own buttons under every look: every word reads at 4.5:1 or better (${measured} words)`, under.length === 0 && unread.size === 0 && measured > 12 * 1000, `${under.length} under: ${under.slice(0, 4).join(' | ')} ${[...unread].slice(0, 2).join(' | ')}`);
  }
}

const failed = results.filter((r) => !r.p).length;
console.log(`${failed ? 'FAIL' : 'PASS'}  the twelve ready-made looks (item 333) — ${results.length} assertions, ${failed} failures`);
if (failed) Deno.exit(1);
