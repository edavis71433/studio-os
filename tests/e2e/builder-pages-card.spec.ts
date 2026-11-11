import { test, expect, devices, Page, Route, Locator } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, answerAsks } from './helpers/app';

// The website editor's floating studio, part three (Nov 2026; Figma 66:339 and 65:382).
// · The Pages card: every page in the order of the site's menu, dragged to reorder, a status
//   chip and a gear on each, the pages off the menu below, then Header and footer, Not found
//   page and Search appearance. Its rows, drag and saves are the Pages tab's own (pgModel,
//   pgMove, pgOpenSettings), so nothing about pages leaves Edit mode any more.
// · The phone pass: on a phone every card ends above the dock, and one section's card is
//   half a screen that opens with its first field in view; on a tablet the Add card takes
//   the dock's place instead of covering half the page.
const BLOCKS = [
  { type: 'title', title: 'Your heading', subtitle: 'A quiet sub line' },
  { type: 'richtext', title: 'Our story', body: 'Hello' },
];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }, { sid: 'richtext', key: 'block_richtext', src_index: 1 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><style>section{padding:48px 24px}.block{min-height:420px}</style></head><body>'
  + '<header><b>Marlow’s Kitchen</b><nav class="primary"><a href="/">Home</a> <a href="/about/">About</a></nav></header>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Your heading</h2></section>'
  + '<section id="b" data-dds-sid="richtext" data-dds-key="block_richtext" data-dds-src="1" class="block"><h2 data-dds-field="title">Our story</h2></section></main>'
  + '<div id="presence-preview-badge" role="status" style="position:fixed;left:0;right:0;bottom:0">Preview of this site</div></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen', description: 'Hello' }, location: { city: 'Burbank' } } },
  '/offerings': { data: [{ id: 'o1', name: 'Soup', category: 'Starters', price_text: '$5', description: '', is_visible: true, sort_order: 0 }] },
  '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 1, first_publish: false, changes: [{ section: 'business', sentence: 'x' }], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: { accent: '#111111' }, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
const OWN = [
  { slug: 'gallery', title: 'Gallery', blocks: [] },
  { slug: 'landing', title: 'Landing', blocks: [], hideNav: true },
];
type Write = { method: string; path: string; body: any };
async function mount(page: Page, api: Record<string, unknown> = {}) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META, pages: OWN, ...((api['/settings'] as any)?.data || {}) };
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
  // the editor's one-time tip can sit over a card's last row; seen, it stays away
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return writes;
}
const LIVE = { '/site': { data: { site: { ...SITE, netlify_site_id: 'abc' }, identity: { business_name: 'Marlow’s Kitchen', description: 'Hello' }, location: { city: 'Burbank' } } } };
const isPhone = (page: Page) => page.viewportSize()!.width <= 760;
const isTablet = (page: Page) => { const w = page.viewportSize()!.width; return w > 760 && w <= 1180; };
const card = (page: Page) => page.locator('#pagesCard');
const openCard = async (page: Page) => { await page.locator('#dcPageSwitch').click(); await expect(card(page)).toBeVisible(); await expect(card(page)).toHaveClass(/\bon\b/); };
const crow = (page: Page, name: string) => page.locator('#pagesCard .pc-row').filter({ has: page.locator('.pp-name', { hasText: new RegExp(`^${name}$`) }) });
const rowNames = (page: Page, list: 'pcMenu' | 'pcOff') => page.locator(`#${list} .pc-row:not([hidden]) .pp-name`).allTextContents();
const navWrite = (writes: Write[]) => writes.filter((w) => w.path === '/settings' && w.body.nav).at(-1)?.body;
const hrefs = (nav: Array<{ href: string }>) => nav.map((n) => n.href);
const AUTO = ['/', '/services/', '/about/', '/faq/', '/updates/', '/contact/', '/gallery/'];
async function rect(l: Locator) { const b = await l.boundingBox(); if (!b) throw new Error('not laid out'); return b; }
async function drag(page: Page, name: string, y: (box: { y: number; height: number }) => number, target: Locator) {
  await page.waitForLoadState('networkidle');
  const grab = crow(page, name).locator('.pg-grab');
  await expect(grab).toBeVisible();
  await crow(page, name).evaluate((n) => n.scrollIntoView({ block: 'center' }));
  const h = await rect(grab), box = await rect(target);
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 6);
  await page.mouse.move(h.x + h.width / 2, y(box), { steps: 6 });
  await expect(page.locator('#pagesCard .pg-dropline')).toHaveCount(1);
  await page.mouse.up();
}

test.describe('the Pages card (the floating studio, part three)', () => {
  test('the menu in its own order, the pages off it below, and the page being edited marked', async ({ page }) => {
    const writes = await mount(page);
    await openCard(page);
    await expect(card(page).locator('#pagesTitle')).toHaveText('Pages');
    await expect.poll(() => page.locator('#pcMenu .pc-row').evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.href))).toEqual(AUTO);
    expect(await rowNames(page, 'pcOff')).toEqual(['Landing']);
    await expect(crow(page, 'Home')).toHaveClass(/\bon\b/);
    await expect(crow(page, 'Home').locator('.pc-open')).toHaveAttribute('aria-current', 'page');
    await expect(crow(page, 'Home').locator('.pc-sub')).toHaveText('Editing now');
    // a page on the canvas is a tab here; the template's own pages are not
    expect(await page.locator('#pagesBar .page-pill .pp-name').allTextContents()).toEqual(['Home', 'Gallery', 'Landing']);
    await expect(card(page).locator('#btnPcAuto')).toBeHidden();
    for (const id of ['pcHeadFoot', 'pcNotFound', 'pcSearchLook', 'btnPageInfo']) await expect(card(page).locator('#' + id)).toBeAttached();
    expect(writes.filter((w) => w.path === '/settings')).toHaveLength(0);   // just looking changes nothing
  });

  test('each page says what is waiting on it, and nothing when nothing is', async ({ page }) => {
    await mount(page, { ...LIVE, '/changes': { data: { count: 2, first_publish: false, changes: [{ section: 'business', sentence: 'Your tagline changes.' }, { section: 'site', sentence: '1 section added on “Gallery”.' }], blockers: 0, warnings: 0, draft_hash: 'h' } } });
    await openCard(page);
    await expect(crow(page, 'Gallery').locator('.hb-chip')).toHaveText('1 change');
    await expect(crow(page, 'Home').locator('.hb-chip')).toHaveText('1 change');      // the business details show on Home
    await expect(crow(page, 'FAQ').locator('.hb-chip')).toHaveCount(0);              // live, nothing waiting: nothing said
    await expect(crow(page, 'Landing').locator('.hb-chip')).toHaveCount(0);
  });

  test('a site never published says each page isn’t live yet', async ({ page }) => {
    await mount(page);   // no live address yet
    await openCard(page);
    for (const name of ['Home', 'FAQ', 'Gallery']) await expect(crow(page, name).locator('.hb-chip')).toHaveText('Not live yet');
  });

  test('a press on a page opens it on the canvas and puts the card away; Edit mode stays', async ({ page }) => {
    await mount(page);
    await openCard(page);
    await crow(page, 'Gallery').locator('.pc-open').click();
    await expect(card(page)).toBeHidden();
    await expect(page.locator('#dcPageName')).toHaveText('Gallery');
    await openCard(page);
    await expect(crow(page, 'Gallery')).toHaveClass(/\bon\b/);
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
  });

  test('drag a page up the menu inside the card: the Pages tab’s one write, and Edit mode stays', async ({ page }) => {
    test.skip(isPhone(page), 'the same pointer events; the finger test covers the phone');
    const writes = await mount(page);
    await openCard(page);
    await drag(page, 'Contact', (b) => b.y + 2, crow(page, 'About'));
    await expect.poll(() => navWrite(writes)).toBeTruthy();
    expect(hrefs(navWrite(writes).nav)).toEqual(['/', '/services/', '/contact/', '/about/', '/faq/', '/updates/', '/gallery/']);
    await expect.poll(async () => (await rowNames(page, 'pcMenu')).slice(2, 4)).toEqual(['Contact', 'About']);
    await expect(page.locator('.pg-dropline')).toHaveCount(0);
    await expect(card(page)).toBeVisible();   // the card stays open for the next move
    await expect(card(page).locator('#btnPcAuto')).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
  });

  test('drag a page into Not in the menu: it leaves the menu and stays live', async ({ page }) => {
    test.skip(isPhone(page), 'the same pointer events; the finger test covers the phone');
    const writes = await mount(page);
    await openCard(page);
    await drag(page, 'Gallery', (b) => b.y + b.height - 2, page.locator('#pcOff'));
    await expect.poll(() => navWrite(writes)).toBeTruthy();
    expect(hrefs(navWrite(writes).nav)).not.toContain('/gallery/');
    expect(navWrite(writes).pages.find((p: any) => p.slug === 'gallery').hideNav).toBe(true);
    await expect.poll(async () => (await rowNames(page, 'pcOff')).sort()).toEqual(['Gallery', 'Landing']);
    await expect(crow(page, 'Gallery')).toHaveAttribute('data-nav', 'hidden');
  });

  test('the arrow keys on a row’s handle move it, and the handle keeps the focus', async ({ page }) => {
    test.skip(isPhone(page), 'needs a keyboard');
    const writes = await mount(page);
    await openCard(page);
    await page.waitForLoadState('networkidle');
    await crow(page, 'Gallery').locator('.pg-grab').focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => navWrite(writes)).toBeTruthy();
    expect(hrefs(navWrite(writes).nav).indexOf('/gallery/')).toBe(5);
    await expect(crow(page, 'Gallery').locator('.pg-grab')).toBeFocused();
  });

  test('a page’s gear opens its settings in the card; a change saves, and All pages comes back', async ({ page }) => {
    const writes = await mount(page);
    await openCard(page);
    await card(page).getByRole('button', { name: 'Settings for Gallery' }).click();
    const panel = card(page).locator('#pageSettings');
    await expect(panel.getByRole('heading', { name: 'Gallery settings' })).toBeVisible();
    await expect(card(page).locator('#pcFind')).toBeHidden();                         // the list steps aside
    await panel.getByLabel('Show in the menu').uncheck();
    await expect.poll(() => writes.filter((w) => w.path === '/settings').at(-1)?.body?.pages?.find((p: any) => p.slug === 'gallery')?.hideNav).toBe(true);
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect(card(page).locator('#pageSettings')).toHaveCount(0);
    await expect.poll(async () => (await rowNames(page, 'pcOff')).sort()).toEqual(['Gallery', 'Landing']);
    await expect(page.locator('#pageSettings')).toHaveCount(0);                      // no second copy over the page
  });

  test('a built-in page’s settings say where its words live, and that button is the one way out', async ({ page }) => {
    await mount(page);
    await openCard(page);
    await crow(page, 'Services').locator('.pc-open').click();                         // the template's own page: a press opens its settings
    const panel = card(page).locator('#pageSettings');
    await expect(panel).toContainText('built from the items on your Services tab');
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await panel.getByRole('button', { name: 'Change what’s on it' }).click();
    await expect(page.locator('#view-offerings')).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/dc-edit/);
  });

  test('＋ Link adds a link to the menu from inside the card', async ({ page }) => {
    const writes = await mount(page);
    await openCard(page);
    await card(page).getByRole('button', { name: '＋ Link' }).click();
    const panel = card(page).locator('#linkSettings');
    await expect(panel.getByLabel('Label in the menu')).toBeVisible();
    await panel.getByLabel('Label in the menu').fill('Order');
    await panel.getByLabel('Links to').fill('order.example.com');
    await panel.getByRole('button', { name: 'Add to the menu' }).click();
    await expect.poll(() => navWrite(writes)?.nav?.at(-1)).toEqual({ label: 'Order', href: 'https://order.example.com' });
    await expect(card(page).locator('#linkSettings')).toHaveCount(0);
    await expect(card(page).locator('#pcMenu .pc-row[data-page="link"] .pc-sub')).toHaveText('https://order.example.com');
  });

  test('Find a page narrows the list; Escape clears the words first, then puts the card away', async ({ page }) => {
    await mount(page);
    await openCard(page);
    await page.locator('#pcFind').fill('gal');
    await expect.poll(() => rowNames(page, 'pcMenu')).toEqual(['Gallery']);
    await expect(page.locator('#pcOffH')).toBeHidden();
    await page.locator('#pcFind').fill('zzz');
    await expect(page.locator('#pcNone')).toHaveText('No page has “zzz” in its name.');
    if (isPhone(page)) return;
    await page.keyboard.press('Escape');
    await expect(page.locator('#pcFind')).toHaveValue('');
    await expect.poll(async () => (await rowNames(page, 'pcMenu')).length).toBe(7);
    await expect(card(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card(page)).toBeHidden();
    // words left in the box when the card closes don't follow it to the next opening
    await openCard(page);
    await page.locator('#pcFind').fill('gal');
    await page.locator('#btnPagesClose').click();
    await openCard(page);
    await expect(page.locator('#pcFind')).toHaveValue('');
    await expect.poll(async () => (await rowNames(page, 'pcMenu')).length).toBe(7);
  });

  test('Header and footer: the arrangement saves; the footer’s words are the business details', async ({ page }) => {
    const writes = await mount(page);
    await openCard(page);
    await card(page).locator('#pcHeadFoot').click();
    const pane = card(page).locator('#pcHeadFootPane');
    await expect(pane.getByRole('heading', { name: 'Header and footer' })).toBeVisible();
    await pane.getByRole('button', { name: /^Centered/ }).click();
    await expect.poll(() => writes.find((w) => w.path === '/settings' && w.body.nav_style)?.body.nav_style).toBe('centered');
    await expect(pane.getByRole('button', { name: /^Centered ✓/ })).toBeVisible();   // the row redraws with the pick
    await pane.getByRole('button', { name: 'Change the business details' }).click();
    await expect(page.locator('#view-business')).toBeVisible();
  });

  test('Not found page: an old address is forwarded with the Search tab’s own tool', async ({ page }) => {
    const writes = await mount(page);
    await openCard(page);
    await card(page).locator('#pcNotFound').click();
    const pane = card(page).locator('#pcNotFoundPane');
    await expect(pane).toContainText('That page isn’t here');
    await expect(pane).toContainText('No forwards yet.');
    await pane.getByLabel('Old address').fill('/old-menu/');
    await pane.getByLabel('Where it goes now').fill('/services/');
    await pane.getByRole('button', { name: 'Forward it' }).click();
    await expect.poll(() => writes.find((w) => w.path === '/redirects')?.body).toEqual({ from_path: '/old-menu/', to_path: '/services/' });
  });

  test('Search appearance: each page’s headline on Google, and a page opens its settings', async ({ page }) => {
    await mount(page, { '/settings': { data: { page_seo: { 'page:gallery': { title: 'Our bakes, in pictures' } }, pages_noindex: ['faq'] } } });
    await openCard(page);
    await card(page).locator('#pcSearchLook').click();
    const pane = card(page).locator('#pcSearchPane');
    await expect(pane.locator('.pc-mrow', { hasText: 'Gallery' })).toContainText('Our bakes, in pictures');
    await expect(pane.locator('.pc-mrow', { hasText: 'FAQ' })).toContainText('Hidden from Google');
    await expect(pane.locator('.pc-mrow', { hasText: 'Contact' })).toContainText('Contact & Hours — Marlow’s Kitchen');
    await pane.locator('.pc-mrow', { hasText: 'Gallery' }).click();
    const panel = card(page).locator('#pageSettings');
    await expect(panel.getByRole('heading', { name: 'Gallery settings' })).toBeVisible();
    await expect(panel.getByLabel('Search headline for Gallery')).toHaveValue('Our bakes, in pictures');
  });

  test('a press on the site’s menu on the canvas opens the card, not the Pages tab', async ({ page }) => {
    await mount(page);
    await page.frameLocator('#designPreview').locator('header nav.primary').click();
    await expect(card(page)).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await expect(page.locator('#view-pages')).toBeHidden();
  });

  test('the card clears the other cards: Add, Styles and a section close it, and it closes them', async ({ page }) => {
    await mount(page);
    // opened by script: on a tablet the dock steps aside while the card is open
    for (const open of ['openTrayPanel("add")', 'openSettingsPanel("styles")', 'eeEditBlock(1)']) {
      await openCard(page);
      await page.evaluate((js) => (0, eval)(js), open);
      await expect(card(page), open).toBeHidden();
      await expect(page.locator(open.startsWith('openTray') ? '#trayPanel' : '#settingsPanel')).toHaveClass(/\bon\b/);
      await openCard(page);   // and the card puts the other one away
      await expect(page.locator('#trayPanel')).not.toHaveClass(/\bon\b/);
      await expect(page.locator('#settingsPanel')).not.toHaveClass(/\bon\b/);
      await page.keyboard.press('Escape');
      await expect(card(page)).toBeHidden();
    }
  });

  test.describe('with a finger', () => {
    const { defaultBrowserType: _, ...PHONE } = devices['Pixel 7'];
    test.use(PHONE);
    test.skip(({ browserName }) => browserName !== 'chromium', 'only Chromium takes a real touch drag from a test');

    test('drag a page up the menu in the phone’s card: the row moves, the card stays still', async ({ page, context }) => {
      const writes = await mount(page);
      await openCard(page);
      await page.waitForLoadState('networkidle');
      const grab = crow(page, 'Contact').locator('.pg-grab');
      await crow(page, 'Contact').evaluate((n) => n.scrollIntoView({ block: 'center' }));
      const h = await rect(grab);
      expect(h.height).toBeGreaterThanOrEqual(44);
      const to = (await rect(crow(page, 'About'))).y + 2, from = h.y + h.height / 2, x = h.x + h.width / 2;
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + (to - from) * i / 8 }] });
      await expect(page.locator('#pagesCard .pg-dropline')).toHaveCount(1);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => navWrite(writes)).toBeTruthy();
      expect(hrefs(navWrite(writes).nav)).toEqual(['/', '/services/', '/contact/', '/about/', '/faq/', '/updates/', '/gallery/']);
    });
  });
});

test.describe('the phone pass (the floating studio, part three)', () => {
  // Each card, opened the way a person opens it. The section card opens from the canvas.
  const CARDS: Array<[string, (p: Page) => Promise<unknown>, string]> = [
    ['Pages', (p) => p.locator('#dcPageSwitch').click(), '#pagesCard'],
    ['Add', (p) => p.locator('#btnTrayOpen').click(), '#trayPanel'],
    ['Styles', (p) => p.locator('#btnSettingsOpen').click(), '#settingsPanel'],
    ['Photos', (p) => p.locator('#dkPhotos').click(), '#trayPanel'],
    ['a section', (p) => p.evaluate(() => (window as any).eeEditBlock(1)), '#settingsPanel'],
    ['Publish', (p) => p.locator('#dcBtnPublish').click(), '#ritualWrap'],
  ];
  test('every card ends above the dock, or beside it, never over it', async ({ page }) => {
    test.slow();   // six cards opened and closed in turn
    await mount(page);
    for (const [name, open, sel] of CARDS) {
      await open(page);
      const c = page.locator(sel);
      await expect(c, name).toHaveClass(/\bon\b/);
      const dock = page.locator('#dcDock');
      // the card has finished sliding in when its box stops moving
      await expect.poll(async () => { const a = await c.boundingBox(); await page.waitForTimeout(60); const b = await c.boundingBox(); return !!a && !!b && a.y === b.y; }, { message: name }).toBe(true);
      // on a tablet the dock steps aside for Pages, Add and Photos (and comes back for the rest)
      if (isTablet(page) && sel !== '#settingsPanel' && sel !== '#ritualWrap') await expect(dock, name).toBeHidden();
      else await expect(dock, name).toBeVisible();
      const cb = await rect(c), db = (await dock.isVisible()) ? await dock.boundingBox() : null;   // a hidden dock still has a box
      if (isPhone(page)) {
        expect(db, 'the phone keeps its dock').toBeTruthy();
        expect(cb.y + cb.height, `${name} ends above the dock`).toBeLessThanOrEqual(db!.y + 1);
        expect(cb.y, `${name} starts under the bar`).toBeGreaterThanOrEqual((await rect(page.locator('.dc-bar'))).y + (await rect(page.locator('.dc-bar'))).height - 1);
      } else if (db) {
        const apart = cb.x >= db.x + db.width - 1 || db.x >= cb.x + cb.width - 1 || cb.y >= db.y + db.height - 1 || db.y >= cb.y + cb.height - 1;
        expect(apart, `${name} is clear of the dock`).toBe(true);
      }
      if (name === 'Publish') await page.locator('#btnRitualBack').click(); else await page.keyboard.press('Escape');
      await expect(c, name).not.toHaveClass(/\bon\b/);
    }
  });

  test('one section’s card opens at its top, the Heading in view under the tabs; on a phone it is half a screen', async ({ page }) => {
    await mount(page);
    const p = page.locator('#settingsPanel');
    const check = async (bi: number) => {
      await page.evaluate((i) => (window as any).eeEditBlock(i), bi);
      await expect(p).toHaveClass(/\bon\b/);
      const field = p.getByRole('textbox', { name: 'Heading' });
      await expect(field).toBeVisible();
      await expect.poll(async () => { const a = await p.boundingBox(); await page.waitForTimeout(60); const b = await p.boundingBox(); return !!a && !!b && a.y === b.y; }).toBe(true);
      await page.waitForTimeout(120);   // the card's own timers (focus, scroll) have run
      const tabs = await rect(page.locator('#inspectorSeg')), f = await rect(field), card = await rect(p);
      expect(f.y, 'the Heading is under the tabs, not behind them').toBeGreaterThanOrEqual(tabs.y + tabs.height - 1);
      expect(f.y + f.height, 'and inside the card').toBeLessThanOrEqual(card.y + card.height + 1);
      return { card, field };
    };
    const first = await check(1);
    if (isPhone(page)) {
      const vh = page.viewportSize()!.height;
      expect(first.card.height, 'half a screen').toBeLessThanOrEqual(vh * 0.6);
      // the section being edited stays in view above the card
      const sec = await page.frameLocator('#designPreview').locator('#b').boundingBox();
      expect(sec!.y).toBeLessThan(first.card.y - 40);
      expect(sec!.y).toBeGreaterThanOrEqual(0);
    }
    await expect(p.getByRole('textbox', { name: 'Heading' })).toBeFocused();   // the caret is in the heading, and putting it there scrolled nothing
    // scrolled down in one section's card, the next section's card still opens at the top
    await p.locator('.dc-panel-scroll').evaluate((n) => { n.scrollTop = n.scrollHeight; });
    await page.keyboard.press('Escape');
    await expect(p).not.toHaveClass(/\bon\b/);
    await check(0);
  });

  test('on a tablet, a card on the left takes the dock’s place instead of covering half the page', async ({ page }) => {
    test.skip(!isTablet(page), 'a tablet or a small laptop');
    await mount(page);
    const vw = page.viewportSize()!.width;
    for (const [open, sel, close] of [['#btnTrayOpen', '#trayPanel', '#btnTrayClose'], ['#dcPageSwitch', '#pagesCard', '#btnPagesClose']] as const) {
      await page.locator(open).click();
      const c = page.locator(sel);
      await expect(c).toHaveClass(/\bon\b/);
      await expect(page.locator('#dcDock')).toBeHidden();
      const b = await rect(c);
      expect(b.x + b.width, `${sel} covers at most 40% of the page`).toBeLessThanOrEqual(vw * 0.4);
      await page.locator(close).click();
      await expect(page.locator('#dcDock')).toBeVisible();
    }
  });
});
