import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// A section's colours and layouts (builder list items 49 and 118, Nov 2026; Figma "A · Section
// colours and layouts"): the Style tab leads with the section's colour theme, five tiles drawn
// in the site's own colours; while Styles is on Colours (or a section's card is on Style) every
// section on the canvas wears a tag naming its theme; the Layout tab draws each layout as
// itself; and picking a ready-made look shows the whole page at half size.
const BLOCKS = [
  { type: 'title', title: 'Fresh bread, every morning', subtitle: 'Baked in Burbank' },
  { type: 'richtext', title: 'Our story', body: 'Ten years at the market.', look: { background: 'dark' } },
  { type: 'cta', text: 'Order for the weekend', button: 'Order', url: 'https://order.example' },
];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }, { sid: 'richtext', key: 'block_richtext', src_index: 1 }, { sid: 'cta', key: 'block_cta', src_index: 2 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><style>'
  + ':root{--paper:#fbfaf7;--card:#ffffff;--ink:#201b17;--soft:#5e554d;--accent:#8a5a3c;--accent-dark:#6e4630;--wash:#f3ece6}'
  + 'body{margin:0;background:var(--paper)}section{padding:48px 24px;min-height:260px}.block--bg-dark{background:#1a1622;color:#f2eef8}</style></head><body>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Fresh bread, every morning</h2></section>'
  + '<section id="b" data-dds-sid="richtext" data-dds-key="block_richtext" data-dds-src="1" class="block block--bg-dark"><h2 data-dds-field="title">Our story</h2></section>'
  + '<section id="c" data-dds-sid="cta" data-dds-key="block_cta" data-dds-src="2" class="block block-cta"><p data-dds-field="text">Order for the weekend</p></section></main></body></html>';
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
async function mount(page: Page, blocks: unknown[] = BLOCKS, api: Record<string, unknown> = {}) {
  let settings: Record<string, unknown> = { blocks, section_meta: META };
  await installApp(page, { api: { ...API, ...api, '/settings': { data: settings } } });
  const writes: Write[] = [];
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
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return writes;
}
const isPhone = (page: Page) => page.viewportSize()!.width <= 760;
const frame = (page: Page) => page.frameLocator('#designPreview');
const openSection = async (page: Page, i: number, tab: string) => { await page.evaluate(([n, t]) => (window as any).eeEditBlock(n, t), [i, tab] as const); await expect(page.locator('#settingsPanel')).toHaveClass(/\bon\b/); };
const theme = (page: Page, name: string) => page.locator('#settingsPanel .ins-theme').filter({ hasText: new RegExp(`^${name}$`) });
const blocksWrite = (writes: Write[]) => writes.filter((w) => w.path === '/settings' && w.body.blocks).at(-1)?.body.blocks;
const bg = (l: ReturnType<Page['locator']>) => l.evaluate((n) => getComputedStyle(n).backgroundImage !== 'none' ? getComputedStyle(n).backgroundImage : getComputedStyle(n).backgroundColor);

test.describe('a section’s colours and layouts (builder items 49 and 118)', () => {
  test('the Style tab leads with the colour theme: five tiles in the site’s own colours, then colours, then type', async ({ page }) => {
    const writes = await mount(page);
    await openSection(page, 1, 'style');
    expect(await page.locator('#settingsPanel .ins-theme').allTextContents()).toEqual(['Default', 'Tinted', 'Plain', 'Accent', 'Dark']);
    await expect(theme(page, 'Dark')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#settingsPanel [data-group="theme"] .ins-says')).toHaveText('Light words on a deep background, buttons in your accent colour.');
    // each tile is drawn in this site's colours, as the canvas has them
    expect(await bg(theme(page, 'Dark').locator('.ins-theme-pic'))).toBe('rgb(26, 22, 34)');
    expect(await bg(theme(page, 'Accent').locator('.ins-theme-pic'))).toBe('rgb(110, 70, 48)');   // the site's --accent-dark
    expect(await bg(theme(page, 'Plain').locator('.ins-theme-pic'))).toBe('rgb(251, 250, 247)');  // its --paper
    expect(await theme(page, 'Dark').locator('.ins-theme-pic b').evaluate((n) => getComputedStyle(n).backgroundColor)).toBe('rgb(138, 90, 60)');   // buttons in its accent
    expect(await page.locator('#settingsPanel .ins-group').allTextContents()).toEqual(['Colours · from your site', 'Type']);
    // a pick moves the theme and saves with the section
    await theme(page, 'Tinted').click();
    await expect(theme(page, 'Tinted')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => blocksWrite(writes)?.[1]?.look?.background, { timeout: 8000 }).toBe('tinted');
    await theme(page, 'Default').click();
    await expect.poll(() => blocksWrite(writes)?.[1]?.look, { timeout: 8000 }).toBeUndefined();
  });

  test('a section with a background colour of its own shows no theme picked and says how to use one', async ({ page }) => {
    await mount(page, [BLOCKS[0], { ...BLOCKS[1], look: undefined, style: { bg_color: '#225577' } }, BLOCKS[2]]);
    await openSection(page, 1, 'style');
    await expect(page.locator('#settingsPanel .ins-theme[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator('#settingsPanel [data-group="theme"] .ins-says')).toHaveText('A background colour of your own is set under Colours. Pick a theme to use it instead.');
  });

  test('every section wears its theme while Colours is open, and Styles lists them; Looks and Content put the tags away', async ({ page }) => {
    await mount(page);
    await page.locator(isPhone(page) ? '#btnSettingsOpen' : '#btnSettingsOpen').click();
    await page.locator('#stylesSeg [data-stab="colours"]').click();
    const tags = frame(page).locator('#dds-dc-themes .dds-theme-tag');
    await expect.poll(() => tags.allTextContents()).toEqual(['Aa · Template', 'Aa · Default', 'Aa · Dark', 'Aa · Default']);
    await expect(page.locator('#stThemesNow .ins-says')).toHaveText('1 Template · 2 Default · 1 Dark');
    // the tag sits at its section's top left and takes no clicks
    const sec = await frame(page).locator('#b').boundingBox(), tag = await tags.nth(2).boundingBox();
    expect(tag!.x).toBeGreaterThanOrEqual(sec!.x + 11);
    expect(Math.abs(tag!.y - sec!.y - 12)).toBeLessThan(3);
    expect(await frame(page).locator('#dds-dc-themes').evaluate((n) => getComputedStyle(n).pointerEvents)).toBe('none');
    if (!isPhone(page)) {   // and clear of the dock floating over the page's left edge
      const dock = await page.locator('#dcDock').boundingBox(), first = await tags.nth(1).boundingBox();
      if (dock && dock.width) expect(first!.x).toBeGreaterThanOrEqual(dock.x + dock.width);
    }
    await page.locator('#stylesSeg [data-stab="looks"]').click();
    await expect(frame(page).locator('#dds-dc-themes')).toHaveCount(0);
    await page.locator('#btnSettingsClose').click();
    await openSection(page, 2, 'style');
    await expect.poll(() => tags.count()).toBe(4);
    await page.locator('#inspectorSeg [data-itab="content"]').click();
    await expect(frame(page).locator('#dds-dc-themes')).toHaveCount(0);
  });

  test('picking a look shows the whole page at half size; Fonts, a tablet frame, a phone and closing don’t', async ({ page }) => {
    await mount(page);
    await page.locator('#btnSettingsOpen').click();
    await expect(page.locator('#stylesSeg [data-stab="looks"]')).toHaveAttribute('aria-selected', 'true');
    const iframe = page.locator('#designPreview');
    if (page.viewportSize()!.width <= 1180) {
      await expect(page.locator('html')).not.toHaveClass(/dc-zoomout/);   // a tablet's or a phone's canvas has no room to spare
      return;
    }
    await expect(page.locator('html')).toHaveClass(/dc-zoomout/);
    await expect.poll(() => iframe.evaluate((n) => getComputedStyle(n).transform)).toMatch(/^matrix\(0\.5, 0, 0, 0\.5, \d+(\.\d+)?, 0\)$/);
    await expect(page.locator('#dcZoomNote')).toBeVisible();
    // the page at half size, its own width kept, in the room between the dock and the Styles card
    const box = await iframe.boundingBox(), card = await page.locator('#settingsPanel').boundingBox(), dock = await page.locator('#dcDock').boundingBox();
    expect(box!.x).toBeGreaterThan(dock!.x + dock!.width);
    expect(box!.x + box!.width).toBeLessThanOrEqual(card!.x);
    expect(await iframe.evaluate((n) => (n as HTMLIFrameElement).contentWindow!.innerWidth)).toBe(await page.locator('.dp-frame').evaluate((n) => Math.round(n.getBoundingClientRect().width)));
    await page.locator('#stylesSeg [data-stab="fonts"]').click();
    await expect(page.locator('html')).not.toHaveClass(/dc-zoomout/);
    await expect(page.locator('#dcZoomNote')).toBeHidden();
    await page.locator('#stylesSeg [data-stab="looks"]').click();
    await expect(page.locator('html')).toHaveClass(/dc-zoomout/);
    await page.locator('#dpDevSeg [data-dpdev="tablet"]').click();
    await expect(page.locator('html')).not.toHaveClass(/dc-zoomout/);
    await page.locator('#dpDevSeg [data-dpdev="desktop"]').click();
    await expect(page.locator('html')).toHaveClass(/dc-zoomout/);
    await page.locator('#btnSettingsClose').click();
    await expect(page.locator('html')).not.toHaveClass(/dc-zoomout/);
    await expect.poll(() => iframe.evaluate((n) => getComputedStyle(n).transform)).toBe('none');
  });

  test('the Layout tab draws each layout as itself, and a pick saves', async ({ page }) => {
    const writes = await mount(page);
    await openSection(page, 2, 'layout');
    const pics = page.locator('#settingsPanel .ins-pic');
    expect(await pics.evaluateAll((n) => n.map((x) => (x as HTMLElement).dataset.pic))).toEqual(['cta:default', 'cta:card', 'width:normal', 'width:full']);
    await expect(page.locator('#settingsPanel .ins-pic[data-pic="cta:card"] i.k')).toHaveCount(1);   // the card's button is drawn
    await page.locator('#settingsPanel .ins-tile').filter({ hasText: 'Card' }).click();
    await expect.poll(() => blocksWrite(writes)?.[2]?.variant, { timeout: 8000 }).toBe('card');
  });

  test('Fonts lists the fonts in use first, under “fewer fonts, faster site”; Text has one text size (item 119)', async ({ page }) => {
    const LIB = [
      { id: 'playfair-display', family: 'Playfair Display', css: 'Playfair Display', kind: 'serif', weights: [400, 700], fallback: 'Georgia, serif' },
      { id: 'inter', family: 'Inter', css: 'Inter', kind: 'sans', weights: [400, 700], fallback: 'system-ui, sans-serif' },
      { id: 'lora', family: 'Lora', css: 'Lora', kind: 'serif', weights: [400, 700], fallback: 'Georgia, serif' },
    ];
    await mount(page, BLOCKS, { '/dev/customization': { data: { theme_tokens: { font_display: 'Inter, system-ui, sans-serif', font_body: 'Lora, Georgia, serif' }, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false, font_library: LIB } } });
    await page.locator('#btnSettingsOpen').click();
    await page.locator('#stylesSeg [data-stab="fonts"]').click();
    await expect(page.locator('#designCard').getByText('Fonts · fewer fonts, faster site')).toBeVisible();
    await page.locator('#designCard summary', { hasText: 'More fonts' }).click();
    expect(await page.locator('#designCard [aria-label="Headings font"] button').allTextContents()).toEqual(['Inter ✓', 'Lora · in use', 'Playfair Display']);
    expect(await page.locator('#designCard [aria-label="Body text font"] button').allTextContents()).toEqual(['Lora ✓', 'Inter · in use', 'Playfair Display']);
    await page.locator('#stylesSeg [data-stab="text"]').click();
    await expect(page.locator('#designCard').getByText('Text size', { exact: true })).toBeVisible();
  });
});
