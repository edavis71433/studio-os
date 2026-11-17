// ── Every word in an accent or a dark section reads, on every template (Nov 2026) ──
//   deno run --allow-read --allow-env tests/presence/band_words_test.mjs
// A section's Colour theme can be the accent band or the dark band (BLOCK_CSS .block--bg-accent,
// .block--bg-dark): light words throughout. accent_band_test.mjs measures the colours the band's
// rules draw; this one reads what each word on the page actually gets, as CSS settles it
// (style_cascade.mjs): every template's full sample and a page of every section variant, with
// every section on the band. Under the template's own colours and every palette and look the
// editor offers a template that takes them, with its own buttons and every button set, and with
// every form style, each word must read at 4.5:1 on what is behind it, on a desktop and a phone.
// Words that show later count too: a closed answer, another tab, a photo opened large.
// One kind is listed, not failed: a box's example words in the browser's own grey (#757575, the
// sign-up box's "you@example.com"). They read the same in every section, band or not: 4.07 to
// 4.61:1 on the templates' own boxes.
import { renderSnapshot, devLayerFragments, listTemplates, FIXED_COLOR_TEMPLATES } from '../../supabase/functions/presence/lib/render.ts';
import { BUTTON_SETS, FORM_STYLES, buttonStyle, siteColours } from '../../supabase/functions/presence/lib/site_buttons.ts';
import { fixture, fullFixture, variantPages } from './full_fixture.mjs';
import { parseHtml, elementsIn, sheetsOf, cascade, hexOf } from './style_cascade.mjs';
import { editorSource } from './editor_source.mjs';   // builder item 38: the editor is four files now

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const SITE = { baseUrl: 'https://example.com' };
const PAGE = editorSource();
const pageArray = (name) => new Function(`return ${PAGE.match(new RegExp(`\\nconst ${name} = (\\[[\\s\\S]*?\\n\\]);`))[1]};`)();
// every palette and look the editor offers; a look with a palette's very colours is read once
const COLOUR_TOKENS = ['accent', 'accent_dark', 'ink', 'soft', 'bg'];
const CHOICES = [{ name: 'its own colours', tokens: {} }, ...[...pageArray('PALETTES'), ...pageArray('STYLE_LOOKS')].filter((p) => p.tokens && Object.keys(p.tokens).length)]
  .filter((c, i, all) => all.findIndex((d) => COLOUR_TOKENS.every((k) => d.tokens[k] === c.tokens[k])) === i);
const VIEWS = [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }];
const UA_PLACEHOLDER = '#757575';
const BANDS = ['accent', 'dark'];

// ── a site with every section on a band ──
function onBand(fx, band) {
  const put = (list) => (list || []).map((b) => ({ ...b, look: { ...(b.look || {}), background: band } }));
  fx.content.settings.blocks = put(fx.content.settings.blocks);
  fx.content.settings.pages = [...fx.content.settings.pages, ...variantPages()].map((p) => ({ ...p, blocks: put(p.blocks) }));
  return fx;
}
const pagesOf = (files) => Object.keys(files).filter((k) => k.endsWith('.html') && String(files[k]).includes('block--bg-'));
/** A page's head and body, parsed once; the cascade keeps what it matched on the elements. */
function readPage(html) {
  const doc = parseHtml(html), all = [...elementsIn(doc)];
  return { doc, head: all.find((e) => e.tag === 'head'), body: all.find((e) => e.tag === 'body'), sections: all.filter((e) => e.classes.has('block') && (e.classes.has('block--bg-accent') || e.classes.has('block--bg-dark'))) };
}
/** :root variables out of a <style> (the palette's style layer, a button set's colours) and its
 *  other rules. */
function splitStyle(style) {
  const css = style.replace(/^<style[^>]*>|<\/style>$/g, '');
  const m = /^:root\{([^{}]*)\}/.exec(css);
  const root = Object.fromEntries((m ? m[1] : '').split(';').filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
  return { root, rules: m ? css.slice(m[0].length) : css };
}
/** Every word in the page's band sections: { key, what, fg, bg, image, ratio }. A set's or form
 *  style's rules go where the site puts them, at the end of the head (lib/site_buttons.ts). */
function wordsOf(page, files, view, extra = { root: {}, rules: '' }) {
  page.sheets ||= new Map();
  if (!page.sheets.has(extra.rules)) page.sheets.set(extra.rules, [...sheetsOf(page.head, files), ...(extra.rules ? [extra.rules] : []), ...sheetsOf(page.body, files)]);
  const c = cascade(page.doc, page.sheets.get(extra.rules), { ...view, later: true, root: extra.root });
  const out = [];
  for (const sec of page.sections) {
    const kind = [...sec.classes].filter((x) => /^block-[a-z]/.test(x)).join('.');
    for (const el of [...elementsIn(sec), sec]) for (const w of c.words(el)) {
      out.push({ key: `${kind} ${el.tag}${el.classes.size ? '.' + [...el.classes].join('.') : ''} ${w.what.slice(0, 40)}`, what: w.what, fg: hexOf(w.fg), bg: hexOf(w.bg), image: w.image, ratio: w.ratio });
    }
  }
  return { out, unread: c.unread };
}

for (const { slug } of listTemplates()) {
  const fixed = FIXED_COLOR_TEMPLATES.has(slug);
  for (const band of BANDS) {
    const files = await renderSnapshot(onBand(fullFixture(slug), band), SITE);
    const css = String(files[Object.keys(files).find((k) => /^assets\/.*\.css$/.test(k))]);
    const pages = pagesOf(files).map((p) => ({ path: p, ...readPage(String(files[p])) }));
    ok(`${slug}, ${band} band: the sample draws its sections on the band, on ${pages.length} pages`, pages.length === 4 && pages.every((p) => p.sections.length));
    const worst = new Map(), unread = new Set(), placeholders = new Set();
    let measured = 0;
    // the template's buttons and every set with no form style, then every form style with the
    // template's buttons: each under its own colours and every palette and look
    const looks = [...[null, ...BUTTON_SETS].map((set) => ({ set, form: null })), ...FORM_STYLES.map((form) => ({ set: null, form }))];
    for (const choice of fixed ? CHOICES.slice(0, 1) : CHOICES) {
      const dev = splitStyle(devLayerFragments({ theme_tokens: choice.tokens, custom_css: '', custom_html: '' }).style);
      for (const { set, form } of looks) {
        const style = set || form ? splitStyle(buttonStyle(set, form, siteColours(css, fixed ? null : choice.tokens))) : { root: {}, rules: '' };
        const extra = { root: { ...style.root, ...dev.root }, rules: style.rules };
        for (const view of VIEWS) {
          if (view.name === 'phone' && (set || form || choice !== CHOICES[0])) continue;   // a phone: the template's own look
          for (const page of pages) {
            const { out, unread: u } = wordsOf(page, files, view, extra);
            u.forEach((x) => unread.add(x));
            measured += out.length;
            for (const w of out) {
              if (w.what.startsWith('::placeholder') && w.fg === UA_PLACEHOLDER) { placeholders.add(w.ratio.toFixed(2)); continue; }
              const why = `${page.path} ${w.key}: ${w.fg} on ${w.bg}, ${set || 'the template’s'} buttons${form ? `, ${form} boxes` : ''}, ${choice.name}, ${view.name}`;
              if (w.image) unread.add(`words on a picture: ${why}`);
              if (!worst.has(w.key) || w.ratio < worst.get(w.key).ratio) worst.set(w.key, { ratio: w.ratio, why });
            }
          }
        }
      }
    }
    ok(`${slug}, ${band} band: every colour, selector and rule on the page is one the cascade reads`, unread.size === 0, [...unread].slice(0, 6).join(' | '));
    ok(`${slug}, ${band} band: words were measured (${measured})`, measured > 1000);
    const failing = [...worst.values()].filter((w) => w.ratio < 4.5).sort((a, b) => a.ratio - b.ratio);
    const least = [...worst.values()].reduce((a, w) => (w.ratio < a.ratio ? w : a), { ratio: Infinity, why: '' });
    ok(`${slug}, ${band} band: every word reads at 4.5:1 or better (worst ${least.ratio.toFixed(2)}:1)`, !failing.length,
      `${failing.length} under: ` + failing.slice(0, 8).map((w) => `${w.ratio.toFixed(2)} ${w.why}`).join(' | '));
    if (placeholders.size) console.log(`note  ${slug}, ${band} band: a box's example words in the browser's own grey read ${[...placeholders].sort().join(', ')}:1 (as in every section)`);
  }

  // the way this check adds a set, a form style and a palette (above) is the way a site is drawn
  {
    const tokens = fixed ? { buttons: 'outline', forms: 'line' } : { ...CHOICES[1].tokens, buttons: 'outline', forms: 'line' };
    const fx = onBand(fullFixture(slug), 'accent');
    const plain = await renderSnapshot(structuredClone(fx), SITE);
    fx.dev_customization = { theme_tokens: tokens, custom_css: '', custom_html: '' };
    const real = await renderSnapshot(fx, SITE);
    const css = String(plain[Object.keys(plain).find((k) => /^assets\/.*\.css$/.test(k))]);
    const style = splitStyle(buttonStyle('outline', 'line', siteColours(css, fixed ? null : tokens)));
    const dev = splitStyle(devLayerFragments({ theme_tokens: tokens, custom_css: '', custom_html: '' }).style);
    let same = true, note = '';
    for (const path of pagesOf(plain)) {
      const a = wordsOf(readPage(String(real[path])), real, VIEWS[0]).out;
      const b = wordsOf(readPage(String(plain[path])), plain, VIEWS[0], { root: { ...style.root, ...dev.root }, rules: style.rules }).out;
      const diff = a.findIndex((w, i) => !b[i] || w.key !== b[i].key || w.fg !== b[i].fg || w.bg !== b[i].bg);
      if (a.length !== b.length || diff >= 0) { same = false; note = `${path}: ${a.length} vs ${b.length} words; first difference ${JSON.stringify(a[diff])} vs ${JSON.stringify(b[diff])}`; break; }
    }
    ok(`${slug}: a set, a form style${fixed ? '' : ' and a palette'} added here draw every word exactly as a site drawn with them`, same, note);
  }

  // the bands' section styles ship only with a band (a template's own .block--bg-* rules, such as
  // its see-through feature cards, are part of its stylesheet)
  const plainCss = String(Object.entries(await renderSnapshot(fixture(slug), SITE)).find(([k]) => /^assets\/.*\.css$/.test(k))[1]);
  ok(`${slug}: a site with no accent or dark section ships none of the bands' section styles`, !/\.block\.block--bg-(accent|dark)|\.block--bg-(accent|dark) \.cta-inner|--soft:currentColor/.test(plainCss));
}

const failed = results.filter((r) => !r.p).length;
console.log(`${failed ? 'FAIL' : 'PASS'}  every word in accent and dark sections reads — ${results.length} assertions, ${failed} failures`);
if (failed) Deno.exit(1);
