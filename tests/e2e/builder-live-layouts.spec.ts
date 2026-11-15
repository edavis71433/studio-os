import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// A section's Layout tab shows the section itself in each arrangement it can take (builder list
// item 224, Nov 2026; Figma "A · Saved pages, button sets, live layouts and section links",
// frames 224·1 and 224·2). Each picture is the section drawn by the server that way (POST
// /preview/section), in a small frame with the canvas's own styles, shrunk to its tile. The tile
// is the button; picking one saves the arrangement as before, Undo takes it back, and when a
// picture can't be drawn the tile keeps its sketch.
const BLOCKS = [
  { type: 'title', title: 'Fresh bread, every morning', subtitle: 'Baked in Burbank' },
  { type: 'reviews_wall', title: 'What our guests say', max: 6 },
  { type: 'image_text', title: 'Our story', body: 'A Saturday stall at the farmers market, ten years on.', side: 'left' },
  { type: 'richtext', title: 'Visit us', body: 'Open daily from seven.' },
];
const META = { blocks: BLOCKS.map((b, i) => ({ sid: b.type, key: 'block_' + b.type, src_index: i })), pages: {} };
const HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><style>'
  + ':root{--paper:#fbf8f3;--card:#ffffff;--ink:#231c17;--soft:#6e6157;--accent:#8a4b2a;--accent-dark:#6e3a20;--wash:#f2ebe2}'
  + 'body{margin:0;background:var(--paper);color:var(--ink);font-family:Georgia,serif}section{padding:40px 24px}.block-reviews_wall{background:var(--wash)}'
  + '.v-quotes p{font-style:italic;text-align:center}</style></head><body class="site">'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + BLOCKS.map((b, i) => `<section data-dds-sid="${b.type}" data-dds-key="block_${b.type}" data-dds-src="${i}" class="block block-${b.type}"><h2 data-dds-field="title">${b.title}</h2></section>`).join('')
  + '</main></body></html>';
// what the server would draw for one section of the list, marked with the arrangement it was asked for
const drawn = (b: any, i: number) => {
  const way = b.type === 'image_text' ? 'side-' + (b.side || 'left') : (b.variant || 'default');
  return `<section class="block block-${b.type} v-${way}" data-dds-src="${i}" data-way="${way}"><h2>${b.title}</h2><p>${b.type === 'image_text' ? b.body : 'Jordan P.: The sourdough is the best in Burbank.'}</p></section>`;
};
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
type Write = { method: string; path: string; body: any };
async function mount(page: Page, opts: { sectionDraws?: 'ok' | 'fail' } = {}) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META };
  await installApp(page, { api: { ...API, '/settings': { data: settings } } });
  const writes: Write[] = [], asks: any[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/settings') { settings = { ...settings, ...body }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  // registered last, so it answers the one-section drawings before the page route above
  await page.route('**/functions/v1/presence/preview/section', (route: Route) => {
    const body = route.request().postDataJSON();
    asks.push(body);
    if (opts.sectionDraws === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'render_failed', message: 'We couldn’t draw that section just now.' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { html: drawn(body.blocks[body.index], body.index) } }) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return { writes, asks };
}
const openSection = async (page: Page, i: number, tab: string) => { await page.evaluate(([n, t]) => (window as any).eeEditBlock(n, t), [i, tab] as const); await expect(page.locator('#settingsPanel')).toHaveClass(/\bon\b/); };
const tiles = (page: Page) => page.locator('#settingsPanel [data-group="arrangement"] .ins-live-tile');
const tile = (page: Page, name: string) => tiles(page).filter({ has: page.locator('.ins-live-name > span:first-child', { hasText: new RegExp(`^${name}$`) }) });
// the whole tile: the picture, and the button under it that reaches over both
const items = (page: Page) => page.locator('#settingsPanel [data-group="arrangement"] .ins-live-item');
const item = (page: Page, name: string) => items(page).filter({ has: page.locator('.ins-live-name > span:first-child', { hasText: new RegExp(`^${name}$`) }) });
const blocksWrite = (writes: Write[]) => writes.filter((w) => w.path === '/settings' && w.body && w.body.blocks).at(-1)?.body.blocks;
// what each tile's little frame shows, read from the editor (the frames run nothing themselves)
const framesSay = (page: Page) => page.locator('#settingsPanel [data-group="arrangement"]').evaluate((g) => [...g.querySelectorAll('.ins-live-win')].map((w) => {
  const f = w.querySelector('iframe') as HTMLIFrameElement | null, d = f && f.contentDocument;
  return { on: w.classList.contains('on'), way: d ? d.querySelector('[data-way]')?.getAttribute('data-way') : null, words: d ? (d.querySelector('h2')?.textContent || '') : '' };
}));
async function undo(page: Page) {
  const b = page.locator('#btnUndo');
  if (await b.isVisible()) await b.click(); else await page.locator('#btnUndoTop').click();
}

test.describe('a section’s Layout tab draws the section itself each way (builder item 224)', () => {
  test('one live picture per arrangement, in the section’s own words; the one in use is pressed', async ({ page }) => {
    const { asks } = await mount(page);
    await openSection(page, 1, 'layout');
    await expect(tiles(page)).toHaveCount(3);
    expect(await tiles(page).locator('.ins-live-name > span:first-child').allTextContents()).toEqual(['Cards', 'Big quotes', 'Compact strip']);
    await expect(tile(page, 'Cards')).toHaveAttribute('aria-pressed', 'true');
    await expect(tile(page, 'Cards').locator('.ins-live-chip')).toHaveText('In use');
    await expect(tile(page, 'Big quotes')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await framesSay(page)).every((f) => f.on), { timeout: 10000 }).toBe(true);
    expect(await framesSay(page)).toEqual([
      { on: true, way: 'default', words: 'What our guests say' },
      { on: true, way: 'quotes', words: 'What our guests say' },
      { on: true, way: 'strip', words: 'What our guests say' },
    ]);
    // each was drawn from the page's list as it stands, with only this section's arrangement changed
    expect(asks.map((a) => [a.index, a.blocks[1].variant || ''])).toEqual(expect.arrayContaining([[1, ''], [1, 'quotes'], [1, 'strip']]));
    expect(asks.every((a) => a.blocks.length === BLOCKS.length && a.blocks[0].title === BLOCKS[0].title)).toBe(true);
    // the frames carry the canvas's styles, take no clicks and stay out of the tab order
    const fr = page.locator('#settingsPanel [data-group="arrangement"] iframe').first();
    await expect(fr).toHaveAttribute('aria-hidden', 'true');
    await expect(fr).toHaveAttribute('tabindex', '-1');
    await expect(fr).toHaveAttribute('sandbox', 'allow-same-origin');
    expect(await fr.evaluate((f) => getComputedStyle(f).pointerEvents)).toBe('none');
    expect(await fr.evaluate((f) => getComputedStyle((f as HTMLIFrameElement).contentDocument!.querySelector('section')!).backgroundColor)).toBe('rgb(242, 235, 226)');
    // and none of the editor's own tools came with them
    expect(await fr.evaluate((f) => !!(f as HTMLIFrameElement).contentDocument!.getElementById('dds-dc-style'))).toBe(false);
  });

  test('picking one saves it; Undo brings the last one back; the pictures aren’t asked for twice', async ({ page }) => {
    const { writes, asks } = await mount(page);
    await openSection(page, 1, 'layout');
    await expect.poll(async () => (await framesSay(page)).filter((f) => f.on).length, { timeout: 10000 }).toBe(3);
    const asked = asks.length;
    await tile(page, 'Big quotes').click();
    await expect(tile(page, 'Big quotes')).toHaveAttribute('aria-pressed', 'true');
    await expect(tile(page, 'Cards')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => blocksWrite(writes)?.[1]?.variant, { timeout: 8000 }).toBe('quotes');
    // the card drew again: its three pictures came from what was already drawn (the one ask the
    // pick may make is the canvas's own live redraw of the section, item 26)
    await expect.poll(async () => (await framesSay(page)).filter((f) => f.on).length, { timeout: 10000 }).toBe(3);
    expect(asks.length - asked).toBeLessThanOrEqual(1);
    const settled = asks.length;
    await page.locator('#inspectorSeg [data-itab="content"]').click();
    await page.locator('#inspectorSeg [data-itab="layout"]').click();
    await expect.poll(async () => (await framesSay(page)).filter((f) => f.on).length, { timeout: 10000 }).toBe(3);
    expect(asks.length).toBe(settled);
    await undo(page);
    await expect.poll(() => blocksWrite(writes)?.[1]?.variant ?? '', { timeout: 8000 }).toBe('');
    await openSection(page, 1, 'layout');   // Undo puts the card away, as it does for any step
    await expect(tile(page, 'Cards')).toHaveAttribute('aria-pressed', 'true');
  });

  test('an image beside words: the photo’s side is a Layout choice, drawn both ways, and no longer a Content field', async ({ page }) => {
    const { writes } = await mount(page);
    await openSection(page, 2, 'content');
    await expect(page.locator('#settingsPanel').getByText('Image on the', { exact: false })).toHaveCount(0);
    await expect(page.locator('#settingsPanel').getByText('Which side the photo sits on is under Layout.', { exact: false })).toBeVisible();
    await page.locator('#inspectorSeg [data-itab="layout"]').click();
    expect(await tiles(page).locator('.ins-live-name > span:first-child').allTextContents()).toEqual(['Photo on the left', 'Photo on the right']);
    await expect(tile(page, 'Photo on the left')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await framesSay(page)).map((f) => f.way), { timeout: 10000 }).toEqual(['side-left', 'side-right']);
    await item(page, 'Photo on the right').click({ position: { x: 30, y: 30 } });   // a tap on the picture itself picks it
    await expect.poll(() => blocksWrite(writes)?.[2]?.side, { timeout: 8000 }).toBe('right');
    // a Content edit afterwards keeps the side picked under Layout
    await page.locator('#inspectorSeg [data-itab="content"]').click();
    const words = page.locator('#settingsPanel textarea').first();
    await words.fill('Ten years at the market, and still baking.');
    await words.blur();
    await expect.poll(() => blocksWrite(writes)?.[2]?.body, { timeout: 8000 }).toBe('Ten years at the market, and still baking.');
    expect(blocksWrite(writes)?.[2]?.side).toBe('right');
  });

  test('when a picture can’t be drawn, the tile keeps its sketch and still picks', async ({ page }) => {
    const { writes } = await mount(page, { sectionDraws: 'fail' });
    await openSection(page, 1, 'layout');
    await expect(tiles(page)).toHaveCount(3);
    expect(await items(page).locator('.ins-pic').evaluateAll((n) => n.map((x) => (x as HTMLElement).dataset.pic))).toEqual(['reviews_wall:default', 'reviews_wall:quotes', 'reviews_wall:strip']);
    await page.waitForTimeout(600);   // the failed asks have come back
    await expect(page.locator('#settingsPanel .ins-live-win.on')).toHaveCount(0);
    await expect(item(page, 'Compact strip').locator('.ins-pic')).toBeVisible();
    await tile(page, 'Compact strip').click();
    await expect.poll(() => blocksWrite(writes)?.[1]?.variant, { timeout: 8000 }).toBe('strip');
    // nothing went wrong out loud: a sketch is an honest picture of the choice
    await expect(page.locator('.toast, #toasts .toast').filter({ hasText: 'draw that section' })).toHaveCount(0);
  });

  test('@layout the pictures fill the card on every screen, with readable names and big targets', async ({ page }) => {
    await mount(page);
    await openSection(page, 1, 'layout');
    await expect.poll(async () => (await framesSay(page)).filter((f) => f.on).length, { timeout: 10000 }).toBe(3);
    const group = await page.locator('#settingsPanel [data-group="arrangement"]').boundingBox();
    for (let i = 0; i < 3; i++) {
      const t = await items(page).nth(i).boundingBox();
      expect(Math.abs(t!.width - group!.width)).toBeLessThan(2);   // full width, one under another
      expect(t!.height).toBeGreaterThanOrEqual(44);
      // the frame is never inside the button: a picture can't be a control in a control
      expect(await tiles(page).nth(i).locator('iframe').count()).toBe(0);
      const win = items(page).nth(i).locator('.ins-live-win');
      // the drawing is shrunk to the tile, never wider than it
      const w = await win.boundingBox(), fr = await win.locator('iframe').boundingBox();
      expect(fr!.width).toBeLessThanOrEqual(w!.width + 1);
      expect(fr!.width).toBeGreaterThan(w!.width - 2);
    }
    const sizes = await tiles(page).locator('.ins-live-name span').evaluateAll((n) => n.map((x) => parseFloat(getComputedStyle(x).fontSize)));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
    // the layout choice leads the tab, as drawn
    const first = page.locator('#blocksCard .ins-pane[data-pane="layout"] > .ins-field').first();
    await expect(first).toHaveAttribute('data-group', 'arrangement');
    await tiles(page).nth(1).focus();
    expect(await items(page).nth(1).evaluate((n) => getComputedStyle(n).outlineStyle)).toBe('solid');
  });
});
