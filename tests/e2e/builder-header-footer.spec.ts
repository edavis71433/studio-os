import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { applyHeaderScroll } from '../../supabase/functions/presence/lib/site_header';

// The site's header and footer, picked on the page (builder list items 41, 50 and 123, Nov 2026;
// Figma "A · Header and footer on the canvas"): a press on either outlines it, names it "· on
// every page" and opens its card. The header's card holds the logo, the arrangement, what it does
// when the page scrolls (four pictures) and the way to the menu; the footer's, two switches and
// the way to the business details. Then a visitor's page scrolled for real with each choice.
const BLOCKS = [{ type: 'title', title: 'Fresh bread, every morning', subtitle: 'Baked in Burbank' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}header.site{position:sticky;top:0;background:#fff;padding:18px 24px;display:flex;justify-content:space-between}section{padding:48px 24px;min-height:500px}footer.site{background:#201b17;color:#fff;padding:40px 24px}</style></head><body>'
  + '<header class="site"><div class="wrap nav"><a class="brand" href="/">Marlow’s Kitchen</a><nav class="primary" aria-label="Main"><ul><li><a href="/">Home</a></li><li><a href="/about/">About</a></li></ul></nav></div></header>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Fresh bread, every morning</h2></section></main>'
  + '<footer class="site"><div class="wrap"><h2>Marlow’s Kitchen</h2><p>12 Olive Ave, Burbank</p></div></footer></body></html>';
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
async function mount(page: Page) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META };
  await installApp(page, { api: { ...API, '/settings': { data: settings } } });
  const writes: Write[] = [];
  let draws = 0;
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/settings') { settings = { ...settings, ...body }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) }); }
    if (path === '/dev/customization') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...body, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => { draws++; return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }); });
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return { writes, draws: () => draws };
}
const frame = (page: Page) => page.frameLocator('#designPreview');
const panel = (page: Page) => page.locator('#settingsPanel');
const tile = (page: Page, name: string) => page.locator('#hfCard .hf-tile').filter({ hasText: new RegExp(`^${name}$`) });
async function pressBare(page: Page, sel: string) {   // a press on the header or footer itself, away from its links and words
  const box = (await frame(page).locator(sel).boundingBox())!;
  await page.mouse.click(box.x + box.width - 6, sel.startsWith('footer') ? box.y + 30 : box.y + box.height - 4);
}

test.describe('the header and footer, picked on the page (builder items 41, 50 and 123)', () => {
  test('a press on the header outlines it, says it’s on every page and opens its card', async ({ page }) => {
    await mount(page);
    await expect(frame(page).locator('header.site .dc-hf-chip')).toHaveText('Header · on every page');
    await pressBare(page, 'header.site');
    await expect(panel(page)).toHaveAttribute('data-mode', 'header');
    await expect(page.locator('#settingsTitle')).toHaveText('Header');
    await expect(page.locator('#settingsSub')).toHaveText('On every page');
    await expect(frame(page).locator('header.site')).toHaveClass(/dc-hf-on/);
    await expect(frame(page).locator('header.site .dc-hf-chip')).toBeVisible();
    expect(await page.locator('#hfCard .ins-lbl').allTextContents()).toEqual(['Logo', 'Arrangement', 'When the page scrolls', 'Menu']);
    await expect(tile(page, 'Standard')).toHaveAttribute('aria-pressed', 'true');
    await expect(tile(page, 'Stays on top')).toHaveAttribute('aria-pressed', 'true');   // the template's own, read from the canvas
    await expect(page.locator('#hfCard .hf-says')).toHaveText('The header stays at the top of the screen while visitors scroll.');
    await expect(page.locator('#dcScrim')).toBeHidden();   // the page stays in view, undimmed
    await page.locator('#btnSettingsClose').click();
    await expect(frame(page).locator('header.site')).not.toHaveClass(/dc-hf-on/);
  });

  test('how the header scrolls saves as a style and redraws the page; the arrangement saves too', async ({ page }) => {
    const { writes, draws } = await mount(page);
    await pressBare(page, 'header.site');
    const before = draws();
    await tile(page, 'Hides, comes back').click();
    await expect.poll(() => writes.filter((w) => w.path === '/dev/customization').at(-1)?.body.theme_tokens?.header_scroll).toBe('hide');
    await expect.poll(() => draws()).toBeGreaterThan(before);
    await expect(tile(page, 'Hides, comes back')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#hfCard .hf-says')).toHaveText('The header slides away while visitors scroll down, and comes back when they scroll up.');
    await tile(page, 'Centered').click();
    await expect.poll(() => writes.filter((w) => w.path === '/settings').at(-1)?.body).toEqual({ nav_style: 'centered' });
    await expect(tile(page, 'Centered')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the menu: Edit the menu and a press on the menu itself both open the Pages card', async ({ page }) => {
    await mount(page);
    await pressBare(page, 'header.site');
    await page.locator('#hfCard').getByRole('button', { name: 'Edit the menu' }).click();
    await expect(page.locator('#pagesCard')).toHaveClass(/\bon\b/);
    await page.locator('#btnPagesClose').click();
    await frame(page).locator('header.site nav.primary').click();
    await expect(page.locator('#pagesCard')).toHaveClass(/\bon\b/);
    await expect(panel(page)).not.toHaveClass(/\bon\b/);   // one card at a time
  });

  test('the footer: its own card, two switches, and the way to the business details', async ({ page }) => {
    const { writes } = await mount(page);
    await frame(page).locator('footer.site').scrollIntoViewIfNeeded();
    await expect(frame(page).locator('footer.site .dc-hf-chip')).toHaveText('Footer · on every page');
    await pressBare(page, 'footer.site');
    await expect(panel(page)).toHaveAttribute('data-mode', 'footer');
    await expect(page.locator('#settingsTitle')).toHaveText('Footer');
    await expect(frame(page).locator('footer.site')).toHaveClass(/dc-hf-on/);
    await expect(page.locator('#hfCard').getByLabel('Show opening hours')).toBeChecked();
    await page.locator('#hfCard').getByLabel('Show opening hours').uncheck();
    await expect.poll(() => writes.filter((w) => w.path === '/settings').at(-1)?.body).toEqual({ footer_hours: false });
    await expect(page.locator('#hfCard').getByRole('button', { name: 'Change the business details' })).toBeVisible();
  });

  test('the chip is the way in by keyboard; the name and links in the header don’t open the card', async ({ page }) => {
    await mount(page);
    await frame(page).locator('header.site .dc-hf-chip').focus();
    await expect(frame(page).locator('header.site .dc-hf-chip')).toHaveCSS('opacity', '1');   // seen once it has the focus
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveAttribute('data-mode', 'header');
    await page.locator('#btnSettingsClose').click();
    await frame(page).locator('header.site a.brand').hover();
    const name = (await frame(page).locator('header.site a.brand').boundingBox())!, chip = (await frame(page).locator('header.site .dc-hf-chip').boundingBox())!;
    expect(chip.y).toBeGreaterThanOrEqual(name.y + name.height - 1);   // the chip hangs below; the name stays clear
    await frame(page).locator('header.site a.brand').click();
    await page.waitForTimeout(300);
    await expect(panel(page)).not.toHaveClass(/\bon\b/);
  });
});

// ── a visitor's page, scrolled for real with each choice ──
const LIVE = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}header.site{background:#fff;height:64px}main{height:4000px}</style></head><body><header class="site"><a href="/">Marlow’s Kitchen</a></header><main id="main"><p>Fresh bread</p></main></body></html>';
test.describe('how the header scrolls on the live site (builder items 50 and 123)', () => {
  for (const mode of ['scroll', 'stay', 'hide', 'fade'] as const) {
    test(`${mode}`, async ({ page }) => {
      const html = applyHeaderScroll({ 'index.html': LIVE }, mode)['index.html'] as string;
      await page.route('**/zz-header/', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
      await page.goto('/zz-header/');
      const header = page.locator('header.site');
      expect(await header.evaluate((n) => getComputedStyle(n).position)).toBe(mode === 'scroll' ? 'relative' : 'sticky');
      await page.evaluate(() => window.scrollTo(0, 800));
      if (mode === 'hide' || mode === 'fade') {
        await expect(header).toHaveClass(/dds-hdr-off/);
        if (mode === 'hide') await expect.poll(() => header.evaluate((n) => getComputedStyle(n).transform)).not.toBe('none');
        else await expect.poll(() => header.evaluate((n) => getComputedStyle(n).opacity)).toBe('0');
        await page.evaluate(() => window.scrollTo(0, 500));   // a little way back up
        await expect(header).not.toHaveClass(/dds-hdr-off/);
      } else {
        await page.waitForTimeout(150);
        await expect(header).not.toHaveClass(/dds-hdr-off/);
        const top = await header.evaluate((n) => Math.round(n.getBoundingClientRect().top));
        if (mode === 'stay') expect(top).toBe(0); else expect(top).toBeLessThan(-100);   // stuck on top, or scrolled away
      }
    });
  }
});
