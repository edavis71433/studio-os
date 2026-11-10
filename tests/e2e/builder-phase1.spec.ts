import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Website builder, Phase 1 (Nov 2026): the editor as one tool. Full-screen Edit mode,
// one editor per section, one save rule, undo everywhere, one set of tabs.
const BLOCKS = [
  { type: 'title', title: 'Your heading', subtitle: 'A quiet sub line' },
  { type: 'richtext', title: 'Our story', body: 'Hello' },
];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }, { sid: 'richtext', key: 'block_richtext', src_index: 1 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Your heading</h2></section>'
  + '<section id="b" data-dds-sid="richtext" data-dds-key="block_richtext" data-dds-src="1" class="block"><h2 data-dds-field="title">Our story</h2></section></main><div id="presence-preview-badge" role="status" style="position:fixed;left:0;right:0;bottom:0">Preview of this site</div></body></html>';
const API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen', description: 'Hello' }, location: { city: 'Burbank' } } },
  '/offerings': { data: [{ id: 'o1', name: 'Soup', category: 'Starters', price_text: '$5', description: '', is_visible: true, sort_order: 0 }] },
  '/faqs': { data: [{ id: 'f1', question: 'Open late?', answer: 'Until nine.', is_visible: true, sort_order: 0 }] },
  '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 1, first_publish: false, changes: [{ section: 'business', sentence: 'x' }], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: { accent: '#111111' }, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
type Write = { method: string; path: string; body: any };
async function mount(page: Page, url: string, api: Record<string, unknown> = {}) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META, pages: [], ...((api['/settings'] as any)?.data || {}) };
  await installApp(page, { api: { ...API, ...api, '/settings': { data: settings } } });
  const writes: Write[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/settings') { settings = { ...settings, ...body }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) }); }
    const data = req.method() === 'POST' ? { id: 'new-' + writes.length, ...body } : (body || {});
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.goto(url);
  return writes;
}
const isPhone = (page: Page) => page.viewportSize()!.width <= 760;
// The floating studio (Nov 2026): the page tabs live in a card that opens from the bar's
// page switcher, so a test that clicks a page opens the card first.
const openPages = async (page: Page) => {
  const sw = page.locator('#dcPageSwitch');
  if ((await sw.getAttribute('aria-expanded')) !== 'true') await sw.click();
  await expect(page.locator('#pagesCard')).toBeVisible();
};

test.describe('full-screen Edit mode', () => {
  test('the canvas takes the screen, and Exit goes back where you came from', async ({ page }) => {
    await mount(page, '/presence.html#faqs');
    await expect(page.locator('#view-faqs')).toBeVisible();
    await page.locator('#btnEditSite').click();
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    for (const sel of ['.topbar', '#nav', '#view-design > h1.doc', '#view-design > .docsub', '#dock']) await expect(page.locator(sel)).toBeHidden();
    await expect(page.locator('#dds-shell')).toBeHidden();
    const vp = page.viewportSize()!;
    const frame = await page.locator('.dp-frame').boundingBox();
    expect(frame!.y + frame!.height).toBeGreaterThan(vp.height - 2);        // runs to the bottom of the screen
    expect(frame!.height).toBeGreaterThan(vp.height * 0.7);                 // it used to start below the halfway line
    expect(frame!.x).toBeLessThan(2);                                       // no sidebar, no rail
    await page.locator('#btnEditExit').click();
    await expect(page.locator('html')).not.toHaveClass(/dc-edit/);
    await expect(page.locator('#view-faqs')).toBeVisible();
    await expect(page.locator('.topbar')).toBeVisible();
  });

  test('the bar stays one tidy strip, and Publish stays in reach', async ({ page }) => {
    await mount(page, '/presence.html#design');
    await expect(page.locator('#dcBtnPublish')).toBeVisible();
    await expect(page.locator('#dcBtnPublish')).toHaveText(isPhone(page) ? 'Publish·1' : 'Publish 1 change');
    await expect(page.locator('#dcBtnPublish')).toHaveAttribute('aria-label', 'Publish 1 change');
    await expect(page.locator('#dcBtnPublish')).toHaveClass(/inked/);
    const bar = await page.locator('.dc-bar').boundingBox();
    expect(bar!.height).toBeLessThan(isPhone(page) ? 70 : 110);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);   // no sideways page scroll
    await page.locator('#dcBtnPublish').click();
    await expect(page.locator('#ritualWrap')).toHaveClass(/\bon\b/);
  });

  test('the chrome is plum now; the client’s site keeps its own colours inside the frame', async ({ page }) => {
    await mount(page, '/presence.html#design');
    await expect(page.locator('#dcBtnPublish')).toHaveClass(/inked/);
    const plum = await page.locator('#dcBtnPublish').evaluate(async (n) => { await Promise.allSettled(n.getAnimations().map((a) => a.finished)); const [r, g, b] = getComputedStyle(n).backgroundColor.match(/\d+/g)!.map(Number); return b - r > 40 && b - g > 60; });
    expect(plum).toBe(true);                                                           // Publish is the plum gradient button
    const bar = page.locator('.dc-bar');
    expect(await bar.evaluate((n) => getComputedStyle(n).borderTopLeftRadius)).toBe('999px');   // one floating pill
    await expect(page.locator('#dcDock')).toBeVisible();
    const frame = page.frameLocator('#designPreview');
    await expect(frame.locator('#main > section').first()).toBeVisible();
    // the editor's tools inside the frame are drawn from the shell's tokens; the site's own
    // words and backgrounds are untouched (the fixture has no styles: black on nothing)
    expect(await frame.locator('#main h1').first().evaluate((n) => getComputedStyle(n).color)).toBe('rgb(0, 0, 0)');
    expect(await frame.locator('#main > section').first().evaluate((n) => getComputedStyle(n).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const css = await frame.locator('#dds-dc-style').evaluate((n) => n.textContent || '');
    expect(css).not.toMatch(/(^|[}+,])\s*(section|h1|h2|p|body|main)\s*\{/);                 // no bare element rules
    expect(await frame.locator('#dds-dc-tokens').evaluate((n) => n.textContent || '')).toMatch(/--ddsdc-p:#/);   // the plum comes in as a token
  });

  test('a watch plan keeps the normal page: there is nothing to edit full screen', async ({ page }) => {
    await mount(page, '/presence.html#design', { '/site': { data: { site: { id: 's2', edition: 'monitor', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: {}, location: null } } });
    await expect(page.locator('html')).toHaveClass(/plan-watch/);
    await expect(page.locator('#view-design > h1.doc')).toBeVisible();
    await expect(page.locator('#btnEditSite')).toBeHidden();
    await expect(page.locator('.dc-bar')).toBeHidden();
  });
});

test.describe('one set of tabs', () => {
  test('the sidebar and the phone sheet list the same places, grouped by job', async ({ page }) => {
    await mount(page, '/presence.html');
    const menu = (await page.locator('#nav .navitem').allTextContents()).map((s) => s.trim());
    const sheet = (await page.locator('#sectionsNav .navitem').allTextContents()).map((s) => s.trim());
    expect(menu).toEqual(['Overview', 'Pages', 'Styles', 'Files', 'Search', 'Services', 'Questions', 'Testimonials', 'Updates', 'Bookings', 'Reviews', 'Analytics', 'Business details', 'Domain & email', 'Versions', 'Connections', 'Sharing & access', 'See the client’s view']);
    expect(sheet).toEqual(['Edit site', ...menu]);     // plus the way into Edit mode
    await page.evaluate(() => (window as any).go('faqs'));
    await expect(page.locator('#view-faqs')).toBeVisible();
    await expect(page.locator('#nav .navitem[data-view="faqs"]')).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('one editor per section', () => {
  const openSection = async (page: Page) => {
    await page.evaluate(() => (window as any).eeEditBlock(1));
    await expect(page.locator('#settingsPanel')).toHaveClass(/\bon\b/);
  };
  test('Edit opens only that section, with the page still in view', async ({ page }) => {
    await mount(page, '/presence.html#design');
    await expect(page.frameLocator('#designPreview').locator('#main > section').first()).toBeVisible();
    await openSection(page);
    // the inspector card: the section's own heading on top, its kind and page under it (part two)
    await expect(page.locator('#settingsTitle')).toHaveText('Our story');
    await expect(page.locator('#settingsSub')).toHaveText('Text box · on Home');
    await expect(page.locator('#inspectorSeg [data-itab="content"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#blkSub-1 input').first()).toBeVisible();
    await expect(page.locator('#blkSub-0')).toHaveCount(0);
    await expect(page.locator('#blocksCard').getByText('Add a section', { exact: true })).toHaveCount(0);
    for (const sel of ['#designGallery', '#designCard', '#formsCard']) await expect(page.locator(sel)).toBeHidden();
    await expect(page.locator('#dcScrim')).toBeHidden();
    await page.locator('#btnSettingsClose').click();
    await expect(page.locator('#settingsPanel')).not.toHaveClass(/\bon\b/);
  });

  test('Styles is only about how the site looks; the rest is one link away', async ({ page }) => {
    await mount(page, '/presence.html#design');
    await page.locator('#btnSettingsOpen').click();
    await expect(page.locator('#settingsTitle')).toHaveText('Styles');
    await expect(page.locator('#designCard')).toBeVisible();
    for (const sel of ['#blocksCard', '#formsCard']) await expect(page.locator(sel)).toBeHidden();
    await page.locator('#btnSettingsClose').click();
    await page.locator('#btnTrayOpen').click();
    await page.locator('.tray-more').getByRole('button', { name: 'Forms' }).click();
    await expect(page.locator('#settingsTitle')).toHaveText('Forms');
    await expect(page.locator('#formsCard')).toBeVisible();
    await expect(page.locator('#designCard')).toBeHidden();
  });

  test('moving a section on the canvas closes its editor rather than editing the wrong one', async ({ page }) => {
    await mount(page, '/presence.html#design');
    await expect(page.frameLocator('#designPreview').locator('#main > section').first()).toBeVisible();
    await openSection(page);
    await page.evaluate(() => (window as any).dcDuplicate(0));
    await expect(page.locator('#settingsPanel')).not.toHaveClass(/\bon\b/);
  });
});

test.describe('one save rule', () => {
  test('a section saves itself, once, with no Save button, and says so in one place', async ({ page }) => {
    const writes = await mount(page, '/presence.html#design');
    await expect(page.frameLocator('#designPreview').locator('#main > section').first()).toBeVisible();
    await page.evaluate(() => (window as any).eeEditBlock(1));
    await expect(page.getByRole('button', { name: 'Save sections' })).toHaveCount(0);
    const heading = page.locator('#blkSub-1 input').first();
    await heading.fill('Our real story');
    await heading.blur();
    await expect.poll(() => writes.filter((w) => w.path === '/settings').length).toBe(1);
    expect(writes[0].body.blocks[1].title).toBe('Our real story');
    await expect(page.locator('#dcWhisper')).toHaveText(/Saved just now|Everything saved/);
    await page.waitForTimeout(1000);
    expect(writes.filter((w) => w.path === '/settings').length).toBe(1);   // an unchanged list writes nothing
  });

  test('a menu item saves field by field, and Done just closes it', async ({ page }) => {
    const writes = await mount(page, '/presence.html#offerings');
    await page.locator('#view-offerings').getByText('Soup').first().click();
    const name = page.locator('#view-offerings .editor [data-k="name"]');
    await name.fill('Tomato soup');
    await name.blur();
    await expect.poll(() => writes.filter((w) => w.method === 'PATCH').length).toBe(1);
    expect(writes[0]).toMatchObject({ path: '/offerings/o1', body: { name: 'Tomato soup' } });
    await page.locator('#view-offerings .editor').getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('#view-offerings .editor')).toHaveCount(0);
    expect(writes.filter((w) => w.method === 'PATCH').length).toBe(1);
  });

  test('the announcement bar has no Save button either', async ({ page }) => {
    const writes = await mount(page, '/presence.html#updates');
    await expect(page.locator('#ann-save')).toHaveCount(0);
    await page.locator('#ann-text').fill('Closed Monday');
    await page.locator('#ann-text').blur();
    await expect.poll(() => writes.filter((w) => w.path === '/settings').length).toBe(1);
    expect(writes[0].body.announcement_text).toBe('Closed Monday');
  });
});

test.describe('undo everywhere', () => {
  test('a business field: undo puts it back, redo brings it forward', async ({ page }) => {
    const writes = await mount(page, '/presence.html#business');
    await expect(page.locator('#btnUndoTop')).toBeHidden();
    const name = page.locator('#f-business_name');
    await expect(name).toHaveValue('Marlow’s Kitchen');
    await name.fill('Marlow’s Bistro');
    await expect.poll(() => writes.filter((w) => w.path === '/identity').length).toBe(1);
    await expect(page.locator('#btnUndoTop')).toBeEnabled();
    await page.locator('#btnUndoTop').click();
    await expect.poll(() => writes.filter((w) => w.path === '/identity').length).toBe(2);
    expect(writes[1].body).toEqual({ business_name: 'Marlow’s Kitchen' });
    await expect(name).toHaveValue('Marlow’s Kitchen');
    await page.locator('#btnRedoTop').click();
    await expect(name).toHaveValue('Marlow’s Bistro');
    expect(writes.filter((w) => w.path === '/identity').pop()!.body).toEqual({ business_name: 'Marlow’s Bistro' });
  });

  test('a burst of typing in one field is one step', async ({ page }) => {
    const writes = await mount(page, '/presence.html#business');
    const name = page.locator('#f-business_name');
    await name.fill('A');
    await expect.poll(() => writes.length).toBe(1);
    await name.fill('AB');
    await expect.poll(() => writes.length).toBe(2);
    await page.locator('#btnUndoTop').click();
    await expect(name).toHaveValue('Marlow’s Kitchen');
    await expect(page.locator('#btnUndoTop')).toBeDisabled();
  });

  test('removing a question comes back; adding one goes away', async ({ page }) => {
    const writes = await mount(page, '/presence.html#faqs');
    await expect(page.locator('#view-faqs')).toContainText('Open late?');   // the row is loaded, so undo has something to bring back
    await page.evaluate(async () => { await (window as any).api('DELETE', '/faqs/f1'); await (0, eval)('S.faqs = []; renderFaqs();'); });
    await page.locator('#btnUndoTop').click();
    await expect.poll(() => writes.filter((w) => w.method === 'POST').length).toBe(1);
    expect(writes.find((w) => w.method === 'POST')!.body).toMatchObject({ question: 'Open late?', answer: 'Until nine.' });
    await expect(page.locator('#view-faqs')).toContainText('Open late?');
    const r = await page.evaluate(async () => (await (window as any).api('POST', '/faqs', { question: 'New?', answer: 'Yes.' })).data.id);
    await page.locator('#btnUndoTop').click();
    await expect.poll(() => writes.some((w) => w.method === 'DELETE' && w.path === `/faqs/${r}`)).toBe(true);
  });

  test('quick presses run in order: redo removes the row undo just brought back, under its new id', async ({ page }) => {
    const writes = await mount(page, '/presence.html#faqs');
    await expect(page.locator('#view-faqs')).toContainText('Open late?');   // the row is loaded, so undo has something to bring back
    await page.evaluate(async () => { await (window as any).api('DELETE', '/faqs/f1'); await (0, eval)('S.faqs = []; renderFaqs();'); });
    await page.evaluate(() => { (0, eval)('dcUndo(); dcRedo();'); });
    await expect.poll(() => writes.filter((w) => w.method === 'DELETE').length).toBe(2);
    const post = writes.findIndex((w) => w.method === 'POST');
    const del = writes.slice(post).find((w) => w.method === 'DELETE')!;
    expect(del.path).toMatch(/^\/faqs\/new-/);        // the id the restored row was given, not the one it had before
  });

  test('styles and sections share the same history, in order, in Edit mode', async ({ page }) => {
    const writes = await mount(page, '/presence.html#design');
    await expect(page.frameLocator('#designPreview').locator('#main > section').first()).toBeVisible();
    await expect(page.locator('#btnUndo')).toBeDisabled();
    await page.evaluate(() => (window as any).saveTokens({ accent: '#222222' }, 'Color'));
    await expect.poll(() => writes.filter((w) => w.path === '/dev/customization').length).toBe(1);
    await page.evaluate(() => (window as any).dcDuplicate(0));
    await expect.poll(() => writes.filter((w) => w.path === '/settings').length).toBe(1);
    await page.locator('#btnUndo').click();     // the section first…
    await expect.poll(() => writes.filter((w) => w.path === '/settings').length).toBe(2);
    expect(writes.filter((w) => w.path === '/settings').pop()!.body.blocks).toHaveLength(2);
    await page.locator('#btnUndo').click();     // …then the color
    await expect.poll(() => writes.filter((w) => w.path === '/dev/customization').length).toBe(2);
    expect(writes.filter((w) => w.path === '/dev/customization').pop()!.body.theme_tokens).toEqual({ accent: '#111111' });
    await expect(page.locator('#btnUndo')).toBeDisabled();
    await expect(page.locator('#btnRedo')).toBeEnabled();
  });

  test('Ctrl+Z works on any tab but leaves typing alone', async ({ page }) => {
    const writes = await mount(page, '/presence.html#business');
    const name = page.locator('#f-business_name');
    await name.fill('Changed');
    await expect.poll(() => writes.length).toBe(1);
    await name.press('Control+z');      // inside the field: the browser's own text undo, not ours
    expect(writes.length).toBe(1);
    await name.blur();
    await page.waitForTimeout(900);
    const before = writes.length;
    await page.locator('h1.hb-title').click();
    await page.keyboard.press('Control+z');
    await expect.poll(() => writes.length).toBeGreaterThan(before);
  });
});

test.describe('the Edit bar and the panels', () => {
  const metrics = (page: Page) => page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const bar = document.querySelector('.dc-bar') as HTMLElement;
    return { barH: r('.dc-bar').height, barScroll: bar.scrollWidth, barClient: bar.clientWidth, frameB: r('.dp-frame').bottom, iframeB: r('#designPreview').bottom, iframeX: r('#designPreview').x, pubR: r('#dcBtnPublish').right };
  });
  for (const [w, h] of [[1920, 1080], [1440, 860], [1366, 768], [1280, 720], [1181, 760]]) {
    test(`at ${w} wide the bar is one row with nothing out of reach, even with lots of pages`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      const many = ['About', 'Our menu', 'Private events', 'Catering', 'Gift cards', 'Contact us'].map((t, i) => ({ slug: 'p' + i, title: t, blocks: [{ type: 'title' }] }));
      await mount(page, '/presence.html#design', { '/settings': { data: { blocks: BLOCKS, section_meta: META, pages: many } } });
      await expect(page.locator('html')).toHaveClass(/dc-edit/);
      await expect(page.locator('#dcPageName')).toHaveText('Home');
      await expect(page.locator('#dcPageCount')).toHaveText('7 pages');   // the pages fold into the switcher
      const m = await metrics(page);
      expect(m.barH).toBeLessThanOrEqual(56);
      expect(m.barScroll).toBeLessThanOrEqual(m.barClient);          // nothing pushed off the end
      const bar = (await page.locator('.dc-bar').boundingBox())!;
      expect(m.pubR).toBeGreaterThan(bar.x + bar.width - 12);        // Publish is the bar's last word
      expect(Math.abs(bar.x + bar.width / 2 - w / 2)).toBeLessThan(2);   // the pill floats at the top centre
      const dock = (await page.locator('#dcDock').boundingBox())!;
      expect(dock.x + dock.width).toBeLessThan(bar.x);               // and never touches the dock
      for (const sel of ['#btnEditExit', '#btnTrayOpen', '#dkPages', '#btnSettingsOpen', '#dkPhotos', '#btnComments', '#dkFind', '#btnUndo', '#btnRedo']) await expect(page.locator(sel)).toBeInViewport();
      await openPages(page);
      await expect(page.locator('#pagesBar .page-pill').first()).toBeVisible();
      await expect(page.locator('#btnNavEdit')).toBeInViewport();
    });
  }
  test('the canvas runs to the very bottom and the very left of the screen', async ({ page }) => {
    await mount(page, '/presence.html#design');
    await page.frameLocator('#designPreview').locator('[data-dds-sid="richtext"]').waitFor();
    const m = await metrics(page);
    expect(m.iframeB).toBe(page.viewportSize()!.height);
    expect(m.iframeX).toBe(0);
  });
  test('in dark mode every button in the bar is readable', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await mount(page, '/presence.html#design');
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    // Publish fills in when /changes lands, and its background fades there over 200ms
    // while its text flips at once (a gap of 8, climbing to 217). Wait for the fill and
    // for the fade to finish: this measures the colors the button rests at, not a frame.
    await expect(page.locator('#dcBtnPublish')).toHaveClass(/inked/);
    const lum = (rgb: string) => { const [r, g, b] = rgb.match(/\d+/g)!.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    for (const sel of ['#btnTrayOpen', '#btnSettingsOpen', '#dkPages', '#dkPhotos', '#btnComments', '#btnEditExit', '#dcBtnPreview', '#dcPageSwitch', '#dcBtnPublish']) {
      const c = await page.locator(sel).evaluate(async (n) => {
        await Promise.allSettled(n.getAnimations().map((a) => a.finished));
        const s = getComputedStyle(n); return [s.color, s.backgroundColor];
      });
      expect(Math.abs(lum(c[0]) - lum(c[1])), sel).toBeGreaterThan(100);
    }
  });
  test('Add lives in the dock on every screen; the old floating Add section button is gone', async ({ page }) => {
    await mount(page, '/presence.html#design');
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await page.frameLocator('#designPreview').locator('[data-dds-sid="richtext"]').waitFor();
    await expect(page.locator('#btnAddFab')).toBeHidden();
    await page.locator('#btnTrayOpen').click();
    await expect(page.locator('#trayPanel')).toHaveClass(/\bon\b/);
    await expect(page.locator('#tabAdd')).toHaveAttribute('aria-selected', 'true');
    if (isPhone(page)) {
      const dock = (await page.locator('#dcDock').boundingBox())!;
      expect(dock.y).toBeGreaterThan(page.viewportSize()!.height / 2);   // a pill along the bottom
    }
  });
  test('side panels open under the bar, and Publish stays reachable', async ({ page }) => {
    await mount(page, '/presence.html#design');
    await page.locator('#btnSettingsOpen').evaluate((n: HTMLElement) => n.click());
    await expect(page.locator('#settingsPanel')).toBeVisible();
    await expect(page.locator('#dcScrim')).toBeHidden();             // the page stays undimmed, so a style change can be seen
    await expect(page.locator('#btnSettingsClose')).toHaveText('Done');
    if (!isPhone(page)) {
      const top = await page.locator('#settingsPanel').boundingBox();
      expect(top!.y).toBeGreaterThanOrEqual(51);
    }
    await expect(page.locator('#dcBtnPublish')).toBeInViewport();
    await page.locator('#dcBtnPublish').click();
    await expect(page.locator('#ritualWrap')).toHaveClass(/\bon\b/);
  });
  test('the save status never moves the row, and rests hidden when there is no room', async ({ page }) => {
    test.skip(page.viewportSize()!.width > 1180, 'the wide bar has its own room');
    await mount(page, '/presence.html#design');
    await expect(page.locator('#dcWhisper')).toBeHidden();
    const before = (await page.locator('#btnUndo').boundingBox())!.x;
    await page.evaluate(() => (window as any).whisper('topWhisper', 'saving'));
    await expect(page.locator('#dcWhisper')).toBeVisible();
    await expect(page.locator('#dcWhisper')).toHaveText('Saving…');
    expect((await page.locator('#btnUndo').boundingBox())!.x).toBe(before);
    expect((await page.locator('#dcWhisper').boundingBox())!.y).toBeGreaterThanOrEqual(52);
  });
  test('a phone or tablet bar is Exit, the page, Undo, Redo and Publish, with the tools in the dock', async ({ page }) => {
    test.skip(page.viewportSize()!.width > 1180, 'the wide bar has one fixed order');
    await mount(page, '/presence.html#design');
    await expect(page.locator('#dcPageName')).toHaveText('Home');
    const xs = await page.evaluate(() => ['#btnEditExit', '#dcPageSwitch', '#btnUndo', '#btnRedo', '#dcBtnPublish'].map((s) => document.querySelector(s)!.getBoundingClientRect().x));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    const barBox = (await page.locator('.dc-bar').boundingBox())!;
    expect(barBox.height).toBeLessThanOrEqual(56);
    expect(await page.locator('.dc-bar').evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true);   // nothing scrolls sideways
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('#dcDock')).toBeVisible();
    for (const sel of ['#dkPages', '#btnTrayOpen', '#btnSettingsOpen', '#dkPhotos']) await expect(page.locator(sel)).toBeInViewport();
    if (isPhone(page)) {
      await expect(page.locator('#dkMore')).toBeVisible();
      await expect(page.locator('#btnComments')).toBeHidden();          // Notes, Versions, Find and Preview wait behind More
      await page.locator('#dkMore').click();
      await expect(page.locator('#btnComments')).toBeVisible();
      await expect(page.locator('#dkPreview')).toBeVisible();
    } else {
      await expect(page.locator('#dkMore')).toBeHidden();
      await expect(page.locator('#btnComments')).toBeInViewport();
    }
  });
});

// Found by opening Edit mode on a real workspace in Chrome: sample data had hidden all of these.
test.describe('what a real site showed', () => {
  const TEMPLATES = { '/site/templates': { data: { current: { slug: 'business-classic', version: '1.0.0' }, templates: [
    { slug: 'business-classic', name: 'Business Classic', version: '1.0.0' },
    { slug: 'editorial', name: 'Editorial', version: '1.0.0' },
    { slug: 'warm', name: 'Warm', version: '1.0.0' },
  ] } } };

  test('Add section opens at the top of its list, with the search box in view', async ({ page }) => {
    await mount(page, '/presence.html#design');
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    // the search takes focus while the panel is still about 1px wide: the list must not scroll then
    await page.evaluate(() => {
      const w = window as any; const f = HTMLElement.prototype.focus; w.__traySeen = [];
      HTMLElement.prototype.focus = function (this: HTMLElement, o?: FocusOptions) {
        const r = f.call(this, o); const t = document.getElementById('designTray');
        if (t && this.matches('.tray-search')) w.__traySeen.push(t.scrollTop);
        return r;
      };
    });
    await page.locator('#btnTrayOpen').click();
    const search = page.locator('#designTray .tray-search');
    await expect(search).toBeFocused();
    expect(await page.evaluate(() => (window as any).__traySeen)).toEqual([0]);
    await page.waitForTimeout(400);
    await expect(search).toBeInViewport();
    expect(await page.locator('#designTray').evaluate((n) => n.scrollTop)).toBe(0);
  });

  test('Styles leads with the choices people use: templates are one tidy row until asked for', async ({ page }) => {
    const previews: string[] = [];
    page.on('request', (r) => { if (/\/preview\?.*template=/.test(r.url())) previews.push(r.url()); });
    await mount(page, '/presence.html#design', TEMPLATES);
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await page.locator('#btnSettingsOpen').click();
    await page.locator('#stylesSeg [data-stab="colours"]').click();   // the brand kit is on the Colours tab
    await expect(page.locator('#brandKitCard')).toBeInViewport();
    await page.locator('#stylesSeg [data-stab="looks"]').click();     // the template row is on Looks
    const fold = page.locator('#designGallery .tg-fold');
    await expect(fold).toContainText('Business Classic');
    await expect(page.locator('#designGallery .tg-card').first()).toBeHidden();
    expect(previews).toHaveLength(0);

    // the row sits inside the panel's margins, not against its edge. One read, after the
    // panel has finished sliding in, so both boxes describe the same moment.
    const margins = async (sel: string) => { await page.waitForTimeout(350); return page.evaluate((q) => {
      const p = document.getElementById('settingsPanel')!.getBoundingClientRect(); const r = document.querySelector(q)!.getBoundingClientRect();
      return { left: r.left - p.left, right: p.right - r.right };
    }, sel); };
    const row = await margins('#designGallery .tg-fold');
    expect(row.left).toBeGreaterThanOrEqual(12);
    expect(row.right).toBeGreaterThanOrEqual(12);

    await fold.locator('summary').click();
    const card = page.locator('#designGallery .tg-card[data-look="editorial"]');
    await expect(card).toBeVisible();
    await expect(page.locator('#designGallery .tg-card')).toHaveCount(3);
    expect((await margins('#designGallery .tg-card[data-look="editorial"]')).right).toBeGreaterThanOrEqual(12);   // no card runs off the side
    // each card is the template's picture, not a live drawing of it (item 25)
    await expect.poll(() => card.locator('.tg-pic').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(640);
    expect(previews).toHaveLength(0);
    await expect(card.locator('.tg-start')).toHaveText('Start with this');
    await expect(page.locator('#designGallery .tg-second')).toHaveCount(0);           // it pointed at the panel you're already in

    await fold.locator('summary').click();
    await fold.locator('summary').click();
    await expect(card).toBeVisible();
    expect(previews).toHaveLength(0);
  });

  test('the purple preview ribbon stays out of Edit mode and shows in Preview', async ({ page }) => {
    await mount(page, '/presence.html#design');
    const frame = page.frameLocator('#designPreview');
    await frame.locator('[data-dds-sid="richtext"]').waitFor();
    await expect(frame.locator('#dds-dc-style')).toHaveCount(1);
    await expect(frame.locator('#presence-preview-badge')).toBeHidden();
  });

  test('double-clicking a core section says where its words live, and stays in Edit mode', async ({ page }) => {
    await mount(page, '/presence.html#design');
    const frame = page.frameLocator('#designPreview');
    await frame.locator('[data-dds-sid="richtext"]').waitFor();
    const h1 = frame.locator('[data-dds-core="hero"] h1');
    await h1.dispatchEvent('dblclick');
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    const toast = page.locator('.toast').filter({ hasText: 'Business' }).first();
    await expect(toast).toBeVisible();
    // readable, and clear of the on-screen tip that's still up on a first visit
    await expect(page.locator('.dds-hint.show')).toBeVisible();
    const [m, tip] = await page.evaluate(() => [document.querySelector('.toast')!, document.querySelector('.dds-hint.show')!].map((n) => { const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width }; }));
    expect(m.width).toBeGreaterThan(260);                            // it used to be squeezed into a narrow column on a phone
    expect(m.bottom <= tip.top || tip.bottom <= m.top).toBe(true);
    // the same for a stamped field inside a core section, which takes the in-place path first
    await h1.evaluate((n) => n.setAttribute('data-dds-field', 'title'));
    await h1.dispatchEvent('dblclick');
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await expect(h1).not.toHaveAttribute('contenteditable', /.+/);
    // the toast's action is the way there, and the way back is offered on arrival
    await toast.getByRole('button', { name: 'Edit them there' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dc-edit/);
    await expect(page.locator('#view-business')).toBeVisible();
    const back = page.getByRole('button', { name: 'Back to your page' });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
  });

  test('double-clicking section text still edits it in place', async ({ page }) => {
    await mount(page, '/presence.html#design');
    const frame = page.frameLocator('#designPreview');
    const h2 = frame.locator('[data-dds-sid="richtext"] h2');
    await h2.waitFor();
    await h2.dispatchEvent('dblclick');
    await expect(h2).toHaveAttribute('contenteditable', /.+/);
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
  });

  test('the on-screen tip promises only what works', async ({ page }) => {
    await mount(page, '/presence.html#design');
    const tip = await page.evaluate(() => (0, eval)('VIEW_HINTS.design[1]'));
    expect(tip).not.toMatch(/any text/);
    expect(tip).toMatch(/section/);
  });
});

// Found by the real save test: a real server takes a moment to answer, and typing doesn't
// stop for it. Each of these lost text with no warning while the page said "Everything saved".
test.describe('nothing typed gets lost', () => {
  const settle = async (page: Page) => { await expect(page.locator('html')).toHaveClass(/dc-edit/); await page.frameLocator('#designPreview').locator('[data-dds-sid="richtext"]').waitFor(); };
  const holdNextSave = async (page: Page) => {
    let holds = 1;
    await page.route('**/functions/v1/presence/settings', async (route) => {
      if (route.request().method() === 'PUT' && holds > 0) { holds--; await new Promise((r) => setTimeout(r, 1500)); }
      return route.fallback();
    });
  };
  const putsOf = (writes: Write[]) => writes.filter((w) => w.path === '/settings' && w.method === 'PUT');

  test('a field finished while the last save is on its way still saves', async ({ page }) => {
    const writes = await mount(page, '/presence.html#design');
    await settle(page);
    await holdNextSave(page);
    await page.evaluate(() => (window as any).eeEditBlock(1));
    const title = page.locator('#blocksCard input').first();
    const body = page.locator('#blocksCard textarea').first();
    await title.fill('Heading saved first');
    await title.blur();
    await page.waitForTimeout(850);                                  // that save has left and hasn't answered yet
    await body.fill('Body finished during the save');
    await body.blur();
    await expect.poll(() => putsOf(writes).length, { timeout: 8000 }).toBe(2);
    expect(putsOf(writes)[1].body.blocks[1]).toMatchObject({ title: 'Heading saved first', body: 'Body finished during the save' });
    await expect(body).toHaveValue('Body finished during the save');
    await expect(page.locator('#dcWhisper')).toHaveText(/Saved just now|Everything saved/);
    // and they stay two separate steps: undo takes back the body and keeps the heading
    await page.evaluate(() => (window as any).dcUndo());
    await expect.poll(() => putsOf(writes).length).toBe(3);
    expect(putsOf(writes)[2].body.blocks[1]).toMatchObject({ title: 'Heading saved first', body: 'Hello' });
  });

  test('a save coming back leaves the field you are typing in alone', async ({ page }) => {
    const writes = await mount(page, '/presence.html#design');
    await settle(page);
    await holdNextSave(page);
    await page.evaluate(() => (window as any).eeEditBlock(1));
    const title = page.locator('#blocksCard input').first();
    const body = page.locator('#blocksCard textarea').first();
    await title.fill('Heading');
    await title.blur();
    await page.waitForTimeout(850);
    await body.focus();
    await body.fill('Still typing');
    await expect.poll(() => putsOf(writes).length, { timeout: 8000 }).toBe(1);
    await page.waitForTimeout(300);
    await expect(body).toBeFocused();
    await expect(body).toHaveValue('Still typing');
    await body.blur();
    await expect.poll(() => putsOf(writes).length, { timeout: 8000 }).toBe(2);
    expect(putsOf(writes)[1].body.blocks[1]).toMatchObject({ title: 'Heading', body: 'Still typing' });
  });

  test('switching pages right after an edit saves it to the page it belongs to', async ({ page }) => {
    const writes = await mount(page, '/presence.html#design', { '/settings': { data: { pages: [{ slug: 'visit', title: 'Visit', blocks: [{ type: 'richtext', body: 'Visit page' }] }] } } });
    await settle(page);
    await page.evaluate(() => {
      const w = window as any; w.eeEditBlock(1);
      const ta = document.querySelector('#blocksCard textarea') as HTMLTextAreaElement;
      ta.value = 'Typed just before switching';
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      w.dcSwitchPage('visit');                                       // the same moment: a click on the page pill
    });
    await expect.poll(() => putsOf(writes).length, { timeout: 5000 }).toBe(1);
    const put = putsOf(writes)[0].body;
    expect(put.pages).toBeUndefined();                               // it went to Home, where it was typed
    expect(put.blocks[1].body).toBe('Typed just before switching');
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => (0, eval)('BLOCKS_WORK')[0].body)).toBe('Visit page');   // and the Visit page is untouched
    expect(putsOf(writes)).toHaveLength(1);
    await page.evaluate(() => (window as any).dcSwitchPage(''));
    expect(await page.evaluate(() => (0, eval)('BLOCKS_WORK')[1].body)).toBe('Typed just before switching');
  });

  test('Undo right after typing takes back that typing, and Redo brings it back', async ({ page }) => {
    const writes = await mount(page, '/presence.html#design');
    await settle(page);
    await page.evaluate(() => {
      const w = window as any; w.eeEditBlock(1);
      const ta = document.querySelector('#blocksCard textarea') as HTMLTextAreaElement;
      ta.value = 'Typed then undone';
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      w.dcUndo();                                                    // before its save has even left
    });
    const work = () => page.evaluate(() => (0, eval)('BLOCKS_WORK')[1].body);
    await expect.poll(work).toBe('Hello');
    await page.evaluate(() => (window as any).dcRedo());
    await expect.poll(work).toBe('Typed then undone');
    await expect.poll(() => putsOf(writes).at(-1)?.body.blocks[1].body, { timeout: 5000 }).toBe('Typed then undone');
  });

  const FORM = { type: 'form', id: 'contact', title: 'Contact us', kind: 'contact', fields: [{ key: 'name', label: 'Your name', type: 'text' }], rules: [] };
  const WITH_FORM = { '/settings': { data: { blocks: [...BLOCKS, FORM] } } };

  test('the form builder never rebuilds under a field you are typing in', async ({ page }) => {
    const writes = await mount(page, '/presence.html#design', WITH_FORM);
    await settle(page);
    await holdNextSave(page);
    await page.evaluate(() => (window as any).openSettingsPanel('forms'));
    await expect(page.locator('#btnSettingsClose')).toBeFocused();   // the panel takes the focus 40ms after it opens
    const title = page.locator('#formsCard input[placeholder="Form title"]').first();
    const label = page.locator('#formsCard input[placeholder="Question / label"]').first();
    await title.fill('Say hello');
    await title.blur();
    await page.waitForTimeout(850);
    await label.focus();
    await label.fill('Typing a question');
    await expect.poll(() => putsOf(writes).length, { timeout: 8000 }).toBe(1);
    await page.waitForTimeout(300);
    await expect(label).toBeFocused();
    await expect(label).toHaveValue('Typing a question');
    await label.blur();
    await expect.poll(() => putsOf(writes).length, { timeout: 8000 }).toBe(2);
    const form = putsOf(writes)[1].body.blocks.find((b: any) => b.type === 'form');
    expect(form).toMatchObject({ title: 'Say hello' });
    expect(form.fields[0].label).toBe('Typing a question');
  });

  test('a form field finished while the last save is on its way still saves', async ({ page }) => {
    const writes = await mount(page, '/presence.html#design', WITH_FORM);
    await settle(page);
    await holdNextSave(page);
    await page.evaluate(() => (window as any).openSettingsPanel('forms'));
    await expect(page.locator('#btnSettingsClose')).toBeFocused();   // the panel takes the focus 40ms after it opens
    const title = page.locator('#formsCard input[placeholder="Form title"]').first();
    const label = page.locator('#formsCard input[placeholder="Question / label"]').first();
    await title.fill('Say hello');
    await title.blur();
    await page.waitForTimeout(850);
    await label.fill('Finished during the save');
    await label.blur();
    await expect.poll(() => putsOf(writes).length, { timeout: 8000 }).toBe(2);
    const form = putsOf(writes)[1].body.blocks.find((b: any) => b.type === 'form');
    expect(form.fields[0].label).toBe('Finished during the save');
  });

  test('a form save does not make the sections look unsaved', async ({ page }) => {
    const writes = await mount(page, '/presence.html#design', WITH_FORM);
    await settle(page);
    await page.evaluate(() => (window as any).openSettingsPanel('forms'));
    await expect(page.locator('#btnSettingsClose')).toBeFocused();   // the panel takes the focus 40ms after it opens
    const title = page.locator('#formsCard input[placeholder="Form title"]').first();
    await title.fill('Say hello');
    await title.blur();
    await expect.poll(() => putsOf(writes).length, { timeout: 5000 }).toBe(1);
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => (0, eval)('blocksDirty()'))).toBe(false);
    expect(putsOf(writes)).toHaveLength(1);
  });
});
