import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, pressButton, touchScreen } from './helpers/app';
import { FONT_LIBRARY } from '../../supabase/functions/presence/lib/fonts';
import { applyLookLayer } from '../../supabase/functions/presence/lib/site_looks';
import { applyButtonStyles } from '../../supabase/functions/presence/lib/site_buttons';
import { STYLE_LOOKS, LOOK_CLEAR } from '../../supabase/functions/presence/lib/style_looks';

// Builder list item 333 (Nov 2026): Styles › Looks. The twelve ready-made looks Eric picked in Figma
// (section D), grouped by mood, each drawn small in its own fonts, colours and button. A tap tries
// the look on the page and the panel stays where it is: same scroll, the tile keeps the keyboard.
// tests/presence/style_looks_333_test.mjs covers the server: the settings, the look's own layer and
// every word of every template under every look.
const BLOCKS = [{ type: 'title', title: 'Fresh bread, every morning', subtitle: 'Baked in Burbank' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--paper:#fbf8f3;--ink:#231c17;--accent:#8a4b2a;--accent-dark:#6b3a20;--card:#ffffff}body{margin:0;background:var(--paper)}section{padding:48px 24px;min-height:420px}</style></head><body>'
  + '<main id="main"><section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Fresh bread, every morning</h2><a class="btn" href="/menu/">Book a table</a></section></main></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1, netlify_site_id: 'n1' };
const CTX = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } };
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/media': { data: [] }, '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] }, '/publishes': { data: [] }, '/launches': { data: [] },
  '/preview/status': { data: { draft: { unpublished_changes: 0 }, preview: { exists: false }, live: { published: true, last_published_at: '2026-11-10T15:00:00Z' } } },
  '/portal/context': CTX,
};
// the library the server sends with the site's style (routes/dev.ts), so each tile can load its faces,
// and the looks with what picking one clears: the server's one list (lib/style_looks.ts)
const FONTS = FONT_LIBRARY.map(({ id, family, css, kind, weights, fallback }) => ({ id, family, css, kind, weights, fallback }));
// Figma section D, in order: name, mood, the heading's face
const LOOKS: Array<[string, string, string]> = [
  ['Golden hour', 'Warm', 'Fraunces'], ['Hand-lettered', 'Warm', 'Caveat'], ['Hard hat', 'Bold', 'Roboto Slab'], ['Night shift', 'Bold', 'Space Grotesk'],
  ['Big & bright', 'Bold', 'Outfit'], ['Clinic calm', 'Calm', 'Plus Jakarta Sans'], ['Garden', 'Calm', 'Lora'], ['Blush', 'Elegant', 'DM Serif Display'],
  ['Black & gold', 'Elegant', 'Playfair Display'], ['Newsprint', 'Classic', 'Libre Baskerville'], ['Steady navy', 'Classic', 'Merriweather'], ['Playground', 'Friendly', 'Quicksand'],
];
// what a tap on Black & gold saves: the look's settings and nothing else
const BLACK_GOLD = { look: 'black_gold', scheme: 'dark', accent: '#c9a45c', accent_dark: '#bf9c57', accent_band: '#6f5a33', ink: '#f5f0e6', soft: '#cfc6b8', bg: '#121212', card: '#201f1f', line: '#363634', wash: '#1a1a19',
  font_display: 'Playfair Display, Georgia, serif', font_body: 'Manrope, system-ui, sans-serif', buttons: 'filled', button_radius: '0px', radius: '2px' };
const PLAYGROUND = { look: 'playground', accent: '#cc2a5a', accent_dark: '#a32248', ink: '#2b2d42', soft: '#5c5e70', bg: '#fff8e7', font_display: 'Quicksand, system-ui, sans-serif', font_body: 'Nunito, system-ui, sans-serif', buttons: 'pill', button_shadow: 'offset' };
const GARDEN = { look: 'garden', accent: '#2f5d3a', accent_dark: '#264a2e', ink: '#1f2a22', soft: '#55604f', bg: '#f1efe6', font_display: 'Lora, Georgia, serif', font_body: 'Manrope, system-ui, sans-serif', buttons: 'filled', button_radius: '10px', radius: '10px' };

type Write = { method: string; path: string; body: any };
const json = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
async function editor(page: Page, tokens: Record<string, string> = {}) {
  let saved: Record<string, string> = { ...tokens };
  await installApp(page, { api: { ...API,
    '/settings': { data: { blocks: BLOCKS, section_meta: META } },
    '/dev/customization': { data: { theme_tokens: saved, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false, font_library: FONTS, looks: STYLE_LOOKS, look_clear: LOOK_CLEAR } },
  } });
  const writes: Write[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/dev/customization') { saved = body.theme_tokens || {}; return json(route, { ...body, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false }); }
    return json(route, body || {});
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  await page.locator('#btnSettingsOpen').click();
  await expect(page.locator('#stylesSeg [data-stab="looks"]')).toHaveAttribute('aria-selected', 'true');
  await expect(tiles(page)).toHaveCount(13);
  return { writes };
}
const tiles = (page: Page) => page.locator('#designCard .st-look');
const tile = (page: Page, name: string) => page.getByRole('group', { name: 'Ready-made looks' }).getByRole('button', { name, exact: true });
const tokenWrites = (m: { writes: Write[] }) => m.writes.filter((w) => w.path === '/dev/customization');
const scroller = (page: Page) => page.locator('#settingsPanel .dc-panel-scroll');
// a mark on the card as it stands, gone once the card has been drawn again after a save
const markCard = (page: Page) => page.locator('#designCard').evaluate((c) => { (c as HTMLElement & { e2eOld?: boolean }).e2eOld = true; });
const cardRedrawn = (page: Page) => expect.poll(() => page.locator('#designCard').evaluate((c) => !(c as HTMLElement & { e2eOld?: boolean }).e2eOld)).toBe(true);

test.describe('Styles › Looks: the twelve ready-made looks (builder item 333)', () => {
  test('Original, then the twelve in order with their moods, each drawn in its own fonts, colours and button', async ({ page }) => {
    await editor(page);
    expect(await tiles(page).evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))).toEqual(['Original', ...LOOKS.map(([n]) => n)]);
    await expect(page.locator('#designCard .st-look-mood')).toHaveText(['Template', ...LOOKS.map(([, m]) => m)]);
    await expect(page.locator('#designCard .st-look-h')).toHaveText(['Original', ...LOOKS.map(([n]) => n)]);
    for (const [name, , face] of LOOKS) {
      const h = tile(page, name).locator('.st-look-h');
      expect(await h.evaluate((e) => getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '').trim()), name).toBe(face);
    }
    // the real faces, not a stand-in: each heading's face has loaded, at the weight the tile draws it
    await page.evaluate(() => document.fonts.ready);
    for (const [name, , face] of LOOKS) {
      const weights = name === 'Blush' ? ['400', 'normal'] : ['700', 'bold'];
      await expect.poll(() => page.evaluate(([f, ws]) => [...document.fonts].some((x) => x.family.replace(/["']/g, '') === f && (ws as string[]).includes(x.weight) && x.status === 'loaded'), [face, weights] as const), `${name}: ${face}`).toBe(true);
    }
    // each look's own touches, as on its page
    await expect(tile(page, 'Hard hat').locator('.st-look-h')).toHaveCSS('text-transform', 'uppercase');
    await expect(tile(page, 'Blush').locator('.st-look-h')).toHaveCSS('font-weight', '400');
    await expect(tile(page, 'Golden hour').locator('.st-look-h')).toHaveCSS('font-weight', '700');
    await expect(tile(page, 'Golden hour').locator('.st-look-b')).toHaveCSS('border-top-left-radius', '999px');
    await expect(tile(page, 'Newsprint').locator('.st-look-b')).toHaveCSS('text-transform', 'uppercase');
    await expect(tile(page, 'Playground').locator('.st-look-b')).not.toHaveCSS('box-shadow', 'none');
    const size = async (n: string) => parseFloat(await tile(page, n).locator('.st-look-h').evaluate((e) => getComputedStyle(e).fontSize));
    expect(await size('Big & bright')).toBeGreaterThan(await size('Golden hour'));
    // the dark looks are drawn dark, their buttons bright with dark words, as the site fills them
    await expect(tile(page, 'Night shift')).toHaveCSS('background-color', 'rgb(14, 17, 22)');
    await expect(tile(page, 'Night shift').locator('.st-look-b')).toHaveCSS('background-color', 'rgb(255, 90, 31)');
    await expect(tile(page, 'Night shift').locator('.st-look-b')).toHaveCSS('color', 'rgb(17, 17, 17)');
    await expect(tile(page, 'Golden hour').locator('.st-look-b')).toHaveCSS('color', 'rgb(255, 255, 255)');
    // nothing picked yet: Original is ringed and says On, and only it
    await expect(tile(page, 'Original')).toHaveAttribute('aria-pressed', 'true');
    await expect(tile(page, 'Original').locator('.st-look-on')).toBeVisible();
    await expect(page.locator('#designCard .st-look[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#designCard .st-look-on:visible')).toHaveCount(1);
    await expect(page.locator('#designCard [data-stab="looks"]').first()).toContainText('Tap one to try it on the page. The panel stays where it is.');
    expect(await page.getByRole('group', { name: 'Ready-made looks' }).locator('xpath=..').innerText()).not.toMatch(/[—–]/);
  });

  test('a tap saves exactly the look, the panel keeps its scroll and its place, and the tile keeps the keyboard', async ({ page }) => {
    const m = await editor(page);
    // scroll the panel down to the last tile
    const target = tile(page, 'Playground');
    await target.scrollIntoViewIfNeeded();   // where a finger or a pointer finds it, so the press itself scrolls nothing
    const before = { top: await scroller(page).evaluate((s) => s.scrollTop), y: (await target.boundingBox())!.y };
    expect(before.top).toBeGreaterThan(0);
    await markCard(page);
    await pressButton(target);
    await expect.poll(() => tokenWrites(m).length).toBe(1);
    expect(tokenWrites(m)[0].body.theme_tokens).toEqual(PLAYGROUND);
    await cardRedrawn(page);
    await expect(tile(page, 'Playground')).toHaveAttribute('aria-pressed', 'true');
    await expect(tile(page, 'Playground').locator('.st-look-on')).toBeVisible();
    await expect(tile(page, 'Original')).toHaveAttribute('aria-pressed', 'false');
    expect(Math.abs(await scroller(page).evaluate((s) => s.scrollTop) - before.top)).toBeLessThanOrEqual(1);
    expect(Math.abs((await tile(page, 'Playground').boundingBox())!.y - before.y)).toBeLessThanOrEqual(1);
    // the keyboard: a tile with the focus keeps it after its look is saved and the card drawn again
    const bg = tile(page, 'Black & gold');
    await bg.scrollIntoViewIfNeeded();
    await bg.focus();
    const top = await scroller(page).evaluate((s) => s.scrollTop), y = (await bg.boundingBox())!.y;
    await markCard(page);
    await page.keyboard.press('Enter');
    await expect.poll(() => tokenWrites(m).length).toBe(2);
    expect(tokenWrites(m)[1].body.theme_tokens).toEqual(BLACK_GOLD);   // Playground's settings are all cleared
    await cardRedrawn(page);
    await expect(tile(page, 'Black & gold')).toBeFocused();
    await expect(tile(page, 'Black & gold')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#designCard .st-look[aria-pressed="true"]')).toHaveCount(1);
    expect(Math.abs(await scroller(page).evaluate((s) => s.scrollTop) - top)).toBeLessThanOrEqual(1);
    expect(Math.abs((await tile(page, 'Black & gold').boundingBox())!.y - y)).toBeLessThanOrEqual(1);
    // the look in use: a tap on it saves nothing
    await pressButton(tile(page, 'Black & gold'));
    await page.waitForTimeout(300);
    expect(tokenWrites(m).length).toBe(2);
  });

  test('Undo puts the last look back, and Original takes every look setting away', async ({ page }) => {
    const m = await editor(page, GARDEN);
    await expect(tile(page, 'Garden')).toHaveAttribute('aria-pressed', 'true');
    await pressButton(tile(page, 'Black & gold'));
    await expect.poll(() => tokenWrites(m).length).toBe(1);
    await expect(tile(page, 'Black & gold')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#btnUndoTop:visible, #btnUndo:visible').first().click();
    await expect.poll(() => tokenWrites(m).length).toBe(2);
    expect(tokenWrites(m)[1].body.theme_tokens).toEqual(GARDEN);
    await expect(tile(page, 'Garden')).toHaveAttribute('aria-pressed', 'true');
    await pressButton(tile(page, 'Original'));
    await expect.poll(() => tokenWrites(m).length).toBe(3);
    expect(tokenWrites(m)[2].body.theme_tokens).toEqual({});
    await expect(tile(page, 'Original')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a colour picked over a dark look goes back to a light page', async ({ page }) => {
    const m = await editor(page, BLACK_GOLD);
    await page.locator('#stylesSeg [data-stab="colours"]').click();
    await expect(page.locator('#designCard')).toContainText('This look has a dark page. A colour or background picked here goes back to a light page.');
    await pressButton(page.locator('#designCard .ins-swatches').getByRole('button', { name: 'Evergreen', exact: true }));
    await expect.poll(() => tokenWrites(m).length).toBe(1);
    expect(tokenWrites(m)[0].body.theme_tokens).toEqual({ accent: '#23635a', accent_dark: '#17453f', ink: '#1c2430', soft: '#5b6572', font_display: BLACK_GOLD.font_display, font_body: BLACK_GOLD.font_body, buttons: 'filled', button_radius: '0px', radius: '2px' });
  });

  test('the tiles are two across, on screen, and at least 44px for a finger @touch @layout', async ({ page }) => {
    await editor(page);
    const w = page.viewportSize()!.width;
    for (const b of await tiles(page).all()) {
      await b.scrollIntoViewIfNeeded();
      const r = (await b.boundingBox())!;
      expect(r.x).toBeGreaterThanOrEqual(-0.5); expect(r.x + r.width).toBeLessThanOrEqual(w + 0.5);
      expect(r.height).toBeGreaterThanOrEqual(44); expect(r.width).toBeGreaterThanOrEqual(44);
    }
    // two across: each pair shares a row, and the next pair starts below it
    const tops = await tiles(page).evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().top + (b.closest('.dc-panel-scroll') as HTMLElement).scrollTop)));
    for (let i = 0; i + 1 < tops.length; i += 2) expect(Math.abs(tops[i] - tops[i + 1])).toBeLessThanOrEqual(1);
    for (let i = 2; i < tops.length; i += 2) expect(tops[i]).toBeGreaterThan(tops[i - 2]);
    // every name and its mood whole in the tile
    for (const b of await tiles(page).all()) {
      expect(await b.locator('.st-look-mood').evaluate((e) => e.scrollWidth <= e.clientWidth + 0.5)).toBe(true);
      expect(await b.evaluate((e) => e.scrollWidth <= e.clientWidth + 0.5)).toBe(true);
    }
    if (touchScreen()) {
      await tile(page, 'Steady navy').tap();
      await expect(tile(page, 'Steady navy')).toHaveAttribute('aria-pressed', 'true');
    }
  });
});

// ── a page drawn with the looks' own settings, in a real browser ──
// The look's layer as lib/site_looks.ts writes it, after the button set as lib/site_buttons.ts does.
const SITE_CSS = ':root{--paper:var(--bg,#f7f7f5);--ink:#1c2430;--accent:#23635a;--accent-dark:#17453f;--wash:#eef1ee;--card:#ffffff;--line:#e2e4e1;--soft:#5b6572}'
  + 'body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,sans-serif}h1,h2,h3{font-family:var(--font-display,inherit);font-weight:700}'
  + 'header.site{background:var(--card)}footer.site{background:var(--ink);color:#dfe4e1;padding:20px}.card{background:var(--card);padding:16px}'
  + '.btn{display:inline-block;background:var(--accent);color:#fff;padding:13px 24px;border-radius:10px;text-decoration:none;font-weight:700}.btn.ghost{background:transparent;color:var(--accent-dark);border:2px solid var(--accent)}';
const BODY = '<header class="site"><a class="brand" href="/">Marlow’s Kitchen</a></header><main><h1 id="h">Fresh bread</h1><h2 id="h2">Every morning</h2><div class="card" id="card"><p>Open until six</p></div>'
  + '<a class="btn" id="main-btn" href="#">Book a table</a> <a class="btn ghost" id="second" href="#">See the menu</a></main><footer class="site" id="foot"><p>Hours</p></footer>';
async function draw(page: Page, tokens: Record<string, string>) {
  const dev = `<style id="presence-dev">:root{${Object.entries(tokens).map(([k, v]) => `--${k}:${v};--${k.replace(/_/g, '-')}:${v}`).join(';')}}</style>`;
  const map = { 'index.html': `<!doctype html><html><head><meta charset="utf-8"><style>${SITE_CSS}</style></head><body>${BODY}</body></html>`, 'assets/site-0001.css': SITE_CSS };
  const html = String(applyLookLayer(applyButtonStyles(map, tokens), tokens, { template: 'business-classic' })['index.html']).replace('</head>', `${dev}</head>`);
  await page.setContent(html);
}
const css = (page: Page, sel: string, prop: string) => page.locator(sel).evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);

test.describe('a page drawn with a look’s own settings', () => {
  test('capitals, regular weight, button corners and the solid shadow, each only where set', async ({ page }) => {
    await draw(page, { heading_case: 'upper', buttons: 'square' });
    expect(await css(page, '#h2', 'text-transform')).toBe('uppercase');
    await draw(page, { heading_weight: '400', buttons: 'pill' });
    expect(await css(page, '#h2', 'font-weight')).toBe('400');
    expect(await css(page, '#h2', 'text-transform')).toBe('none');
    await draw(page, { buttons: 'filled', button_radius: '14px' });
    expect(await css(page, '#main-btn', 'border-top-left-radius')).toBe('14px');
    expect(await css(page, '#second', 'border-top-left-radius')).toBe('14px');   // the second button too, over the set's 12px
    await draw(page, { buttons: 'pill', button_shadow: 'offset', ink: '#2b2d42' });
    expect(await css(page, '#main-btn', 'box-shadow')).toContain('3px 3px 0px');
    expect(await css(page, '#second', 'box-shadow')).toBe('none');
    await draw(page, { buttons: 'pill' });
    expect(await css(page, '#main-btn', 'box-shadow')).toBe('none');
    expect(await css(page, '#h2', 'font-weight')).toBe('700');
  });

  test('a dark look: a dark page whose cards, header and footer follow it', async ({ page }) => {
    const night = { look: 'night_shift', scheme: 'dark', accent: '#ff5a1f', accent_dark: '#ff6e3a', accent_band: '#a63b14', ink: '#f5f5f5', soft: '#b6bcc6', bg: '#0e1116', card: '#1c1f23', line: '#33353a', wash: '#16191e', buttons: 'filled', button_radius: '4px' };
    await draw(page, night);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
    expect(await css(page, 'body', 'background-color')).toBe('rgb(14, 17, 22)');
    expect(await css(page, '#card', 'background-color')).toBe('rgb(28, 31, 35)');
    expect(await css(page, '#foot', 'background-color')).toBe('rgb(28, 31, 35)');   // not the light text colour
    expect(await css(page, 'header.site', 'background-color')).toBe('rgb(14, 17, 22)');   // the page's own colour
    expect(await css(page, '#main-btn', 'background-color')).toBe('rgb(255, 90, 31)');
    expect(await css(page, '#main-btn', 'color')).toBe('rgb(17, 17, 17)');
    expect(await css(page, '#main-btn', 'border-top-left-radius')).toBe('4px');
  });
});
