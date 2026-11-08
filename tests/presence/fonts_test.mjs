// ── The curated font library (list item 24) ─────────────────────────────────────
//   deno run --allow-read --allow-env tests/presence/fonts_test.mjs
// Every family's files are in the app with their licence; a pick is a valid style token;
// the style layer loads a picked family from the site's own copy; publish fetches exactly
// those files and refuses anything that isn't a font.
import { FONT_LIBRARY, fontFilePath, fontStack, libraryFontsIn, fontFaceCss, fetchLibraryFonts } from '../../supabase/functions/presence/lib/fonts.ts';
import { validateThemeTokens } from '../../supabase/functions/presence/lib/devmode.ts';
import { devLayerFragments, renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);

// ═══ 1. the library and its files ═══
ok('about 25 families, each listed once', FONT_LIBRARY.length >= 20 && FONT_LIBRARY.length <= 30 && new Set(FONT_LIBRARY.map((f) => f.id)).size === FONT_LIBRARY.length, String(FONT_LIBRARY.length));
const missing = [], notFont = [];
for (const f of FONT_LIBRARY) for (const w of f.weights) {
  let bytes = null;
  try { bytes = Deno.readFileSync(new URL(fontFilePath(f, w), ROOT)); } catch { missing.push(fontFilePath(f, w)); continue; }
  if (String.fromCharCode(...bytes.slice(0, 4)) !== 'wOF2') notFont.push(fontFilePath(f, w));
}
ok('every weight of every family has its file in the app', missing.length === 0, missing.join(', '));
ok('every file is a woff2 font', notFont.length === 0, notFont.join(', '));
const noLicence = FONT_LIBRARY.filter((f) => { try { return !/Open Font License|Apache License/.test(Deno.readTextFileSync(new URL(`fonts/library/licenses/${f.id}.txt`, ROOT))); } catch { return true; } });
ok('every family carries its licence', noLicence.length === 0, noLicence.map((f) => f.id).join(', '));
ok('every CSS name works without quotes (the style layer strips them)', FONT_LIBRARY.every((f) => /^[A-Za-z][A-Za-z-]*( [A-Za-z][A-Za-z-]*)*$/.test(f.css)));
ok('every family is regular and bold, or regular only', FONT_LIBRARY.every((f) => f.weights.includes(400) && f.weights.every((w) => w === 400 || w === 700)));

// ═══ 2. a pick is a valid token, and the style layer loads it ═══
const pf = FONT_LIBRARY.find((f) => f.id === 'playfair-display'), inter = FONT_LIBRARY.find((f) => f.id === 'inter');
const picks = { font_display: fontStack(pf), font_body: fontStack(inter) };
ok('a picked family passes the style token rules', Object.keys(validateThemeTokens(picks).tokens).length === 2);
ok('the families a style names are found by the first name in each stack', JSON.stringify(libraryFontsIn(picks).map((f) => f.id)) === JSON.stringify(['playfair-display', 'inter']));
ok('a stack that starts with another family names none', libraryFontsIn({ font_display: "Georgia, 'Iowan Old Style', serif", font_body: 'system-ui, sans-serif' }).length === 0);
ok('the same family in both names it once', libraryFontsIn({ font_display: fontStack(inter), font_body: fontStack(inter) }).length === 1);
const faces = fontFaceCss([pf]);
ok('one @font-face per weight, from the site’s own copy', (faces.match(/@font-face/g) || []).length === 2 && faces.includes("url(/fonts/library/playfair-display-700.woff2) format('woff2')") && faces.includes('font-display:swap'));
const layer = devLayerFragments({ theme_tokens: picks, custom_css: 'h1{letter-spacing:0}', custom_html: '' }).style;
ok('the style layer carries the rules, after the variables and before custom CSS',
  /^<style id="presence-dev">:root\{[^}]*\}@font-face/.test(layer) && layer.indexOf('@font-face') < layer.indexOf('h1{letter-spacing:0}') && layer.includes("font-family:'Inter'"));
ok('a style without library fonts loads none', !devLayerFragments({ theme_tokens: { accent: '#23635a' }, custom_css: '', custom_html: '' }).style.includes('@font-face'));
{
  const fx = JSON.parse(Deno.readTextFileSync(new URL('supabase/functions/presence/templates/meadow/1.0.0/fixture.json', ROOT)));
  fx.dev_customization = { theme_tokens: picks, custom_css: '', custom_html: '' };
  const out = renderSnapshot(fx, { baseUrl: 'https://example.com' });
  ok('every page of a rendered site loads the picked fonts', Object.entries(out).filter(([k]) => k.endsWith('.html')).every(([, v]) => String(v).includes("@font-face{font-family:'Playfair Display'")));
}

// ═══ 3. publish fetches exactly those files, and only fonts ═══
{
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = (url) => {
    asked.push(String(url));
    if (String(url).endsWith('inter-700.woff2')) return Promise.resolve(new Response('<!doctype html>not here', { status: 200 }));
    return Promise.resolve(new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3]), { status: 200 }));
  };
  const got = await fetchLibraryFonts([pf, inter]);
  globalThis.fetch = realFetch;
  ok('publish asks the app for each weight of each picked family', asked.length === 4 && asked.every((u) => /^https:\/\/[^/]+\/fonts\/library\/[a-z-]+-(400|700)\.woff2$/.test(u)), asked.join(' '));
  ok('the files land at the same path on the site', Object.keys(got.files).sort().join() === 'fonts/library/inter-400.woff2,fonts/library/playfair-display-400.woff2,fonts/library/playfair-display-700.woff2');
  ok('a page that isn’t a font is refused, so the publish says so', got.failed.join() === 'fonts/library/inter-700.woff2');
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ FONT LIBRARY: ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { for (const f of failed) console.log(' FAIL: ' + f.n); Deno.exit(1); }
