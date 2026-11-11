import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// The editor after the new look, on a phone and with the keyboard (builder list item 171; the
// Nov 10 bug hunt's findings E1 to E7): the photo picker opens above the bar and dock, and its
// own buttons take the press; Exit closes it; the Pages card closes when the page is pressed or
// another card opens; More closes by itself; the page's end scrolls clear of the dock; and while
// one of the editor's questions is up, Ctrl+Z does nothing and Escape answers only the question.
const BLOCKS = [{ type: 'title', title: 'Fresh bread', subtitle: 'Baked daily' }, { type: 'richtext', title: 'Our story', body: 'Hello' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }, { sid: 'richtext', key: 'block_richtext', src_index: 1 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}section{padding:56px 24px;min-height:520px}footer.site{padding:24px}</style></head><body>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" class="block block-title" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0"><h2 data-dds-field="title">Fresh bread</h2></section>'
  + '<section id="b" class="block block-richtext" data-dds-sid="richtext" data-dds-key="block_richtext" data-dds-src="1"><h2 data-dds-field="title">Our story</h2></section></main>'
  + '<footer class="site"><p id="last">The last line</p></footer></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/settings': { data: { blocks: BLOCKS, section_meta: META } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
async function editor(page: Page) {
  await installApp(page, { api: API });
  const puts: string[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    puts.push(req.method() + ' ' + path);
    const body = req.postData() ? req.postDataJSON() : null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: path === '/settings' ? { ...body, section_meta: META } : (body || {}) }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return { puts };
}
const phone = (page: Page) => (page.viewportSize()?.width || 1200) <= 760;
const run = (page: Page, fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => { (window as any)[f as string](...(a as unknown[])); }, [fn, args] as const);
// what a press at the middle of this element lands on
const landsOn = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).first().boundingBox())!;
  return page.evaluate(([x, y, s]) => { const n = document.elementFromPoint(x as number, y as number); return !!n && !!n.closest(s as string); }, [b.x + b.width / 2, b.y + b.height / 2, sel] as const);
};

test.describe('the editor on a phone and with the keyboard (builder item 171)', () => {
  test('E1, E2: the photo picker opens above the bar and dock; its own buttons take the press, theirs don’t', async ({ page }) => {
    await editor(page);
    await run(page, 'openPicker', null);
    await expect(page.locator('#pickerScrim')).toHaveClass(/\bon\b/);
    expect(await landsOn(page, '#btnPickNone')).toBe(true);
    expect(await landsOn(page, '#pickerScrim [data-close]')).toBe(true);
    for (const sel of ['#btnUndo', '#dcBtnPublish', '#btnSettingsOpen', '#btnTrayOpen']) {
      const box = await page.locator(sel).boundingBox(); if (!box) continue;   // not on this screen
      const covered = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('#pickerScrim'), [box.x + box.width / 2, box.y + box.height / 2]);
      expect(covered, sel + ' is under the dimmed screen').toBe(true);
    }
  });

  test('E2: leaving the editor closes an open sheet', async ({ page }) => {
    await editor(page);
    await run(page, 'openPicker', null);
    await run(page, 'exitEditMode');
    await expect(page.locator('#pickerScrim')).not.toHaveClass(/\bon\b/);
  });

  test('E3: the Pages card closes when the page is pressed, and when Add or Styles opens', async ({ page }) => {
    await editor(page);
    await run(page, 'openPagesCard', 'dcPageSwitch');
    await expect(page.locator('#pagesCard')).toHaveClass(/\bon\b/);
    if (!phone(page)) {   // on a phone the card covers the page, and Done closes it
      await page.frameLocator('#designPreview').locator('#b').click({ position: { x: 600, y: 300 } });
      await expect(page.locator('#pagesCard')).not.toHaveClass(/\bon\b/);
    } else await page.locator('#btnPagesClose').click();
    for (const [fn, arg] of [['openTrayPanel', 'add'], ['openSettingsPanel', 'styles']]) {
      await run(page, 'openPagesCard', 'dcPageSwitch');
      await expect(page.locator('#pagesCard')).toHaveClass(/\bon\b/);
      await run(page, fn, arg);
      await expect(page.locator('#pagesCard')).not.toHaveClass(/\bon\b/);
    }
  });

  test('E4: on a phone More closes by itself: a press on the page, a dock button, a menu item', async ({ page }) => {
    test.skip(!phone(page), 'More is the phone’s dock');
    await editor(page);
    const dock = page.locator('#dcDock'), more = page.locator('#dkMore');
    await more.click(); await expect(dock).toHaveClass(/\bmore-open\b/);
    await page.frameLocator('#designPreview').locator('#b').tap({ position: { x: 30, y: 300 } });
    await expect(dock).not.toHaveClass(/\bmore-open\b/);
    await more.click(); await expect(dock).toHaveClass(/\bmore-open\b/);
    await page.locator('#btnTrayOpen').click();
    await expect(dock).not.toHaveClass(/\bmore-open\b/);
    await page.locator('#btnTrayClose').click();
    await more.click(); await expect(dock).toHaveClass(/\bmore-open\b/);
    await page.locator('#dkFind').click();
    await expect(dock).not.toHaveClass(/\bmore-open\b/);
  });

  test('E5: on a phone the end of the page scrolls clear of the dock', async ({ page }) => {
    test.skip(!phone(page), 'the phone’s dock lies along the bottom');
    await editor(page);
    const frame = page.locator('#designPreview');
    await frame.evaluate((f) => { const w = (f as HTMLIFrameElement).contentWindow!; w.scrollTo(0, w.document.documentElement.scrollHeight); });
    await page.waitForTimeout(200);
    const fb = (await frame.boundingBox())!;
    const last = await frame.evaluate((f) => (f as HTMLIFrameElement).contentDocument!.getElementById('last')!.getBoundingClientRect().bottom);
    const dockTop = (await page.locator('#dcDock').boundingBox())!.y;
    expect(fb.y + last).toBeLessThanOrEqual(dockTop);
  });

  test('E6: while a question is up, Ctrl+Z (or ⌘Z) undoes nothing', async ({ page }) => {
    const { puts } = await editor(page);
    await run(page, 'dcDuplicate', 0);   // something to undo
    await expect.poll(() => page.evaluate(() => (0, eval)('BLOCKS_WORK.length'))).toBe(3);
    await expect(page.locator('#btnUndo')).toBeEnabled();
    const before = puts.length;
    await page.evaluate(() => { (window as any).askYes('Delete this section?', { ok: 'Delete', danger: true }); });
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.keyboard.press('Control+z'); await page.keyboard.press('Meta+z');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (0, eval)('BLOCKS_WORK.length'))).toBe(3);
    expect(puts.length).toBe(before);
  });

  test('E7: Escape on a question asked from the Pages card closes only the question', async ({ page }) => {
    await editor(page);
    await run(page, 'openPagesCard', 'dcPageSwitch');
    await expect(page.locator('#pagesCard')).toHaveClass(/\bon\b/);
    await page.evaluate(() => { (window as any).askYes('Delete the page “About”?', { ok: 'Delete page', danger: true }); });
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('#pagesCard')).toHaveClass(/\bon\b/);
  });
});
