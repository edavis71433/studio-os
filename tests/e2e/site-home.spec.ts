import { test, expect, devices, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// The Website page, Squarespace style (Nov 2026): the Overview is the site itself, with
// one bar and one to-do line, and the menu lives in the sidebar, grouped by job.
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
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: (api as any).__html || HTML }));
  await page.goto(url);
  return writes;
}
const isPhone = (page: Page) => page.viewportSize()!.width <= 760;
const SITE_HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><header><nav><a href="/">Home</a> <a href="/about/">About</a> <a href="/visit/">Visit</a> <a href="https://elsewhere.example/">Off site</a></nav></header><main id="main"><h1>Marlow’s Kitchen</h1></main><div id="presence-preview-badge" style="position:fixed;bottom:0;left:0;right:0">Preview of this site</div></body></html>';
const CHANGES = (blockers: number) => ({ '/changes': { data: { count: 1, first_publish: false, changes: [{ section: 'business', sentence: 'x' }], blockers, warnings: 0, draft_hash: 'h' } } });
// A site with every setup step done: details, address, hours, an offering (API's), logo,
// welcome picture, its own address, published.
const ALL_SET = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1, custom_domain: 'marlows.example', last_published_at: '2026-10-30T15:00:00Z' },
    identity: { business_name: 'Marlow’s Kitchen', description: 'Hello', phone: '555-0100' },
    location: { address_line1: '1 Main St', city: 'Burbank', hours: [{ day: 'mon', closed: false, intervals: [{ open: '09:00', close: '17:00' }] }] } } },
  '/settings': { data: { logo_media_id: 'm1', cover_media_id: 'm2' } },
};

test.describe('the Overview is the site', () => {
  test('the site fills the screen, under one bar with the page’s buttons', async ({ page }) => {
    await mount(page, '/presence.html');
    const frame = page.frameLocator('#siteFrame');
    await expect(frame.locator('h1').first()).toHaveText('Marlow’s Kitchen');
    await expect(page.locator('.topbar')).toBeHidden();
    await expect(page.locator('#ssBar #btnEditSite')).toBeVisible();
    if (!isPhone(page)) { await expect(page.locator('#ssBar #btnPreview')).toBeVisible(); await expect(page.locator('#ssBar #btnPublish')).toBeVisible(); }
    // no scrolling a report: the page is one screen
    const h = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, win: innerHeight, bottom: document.getElementById('siteStage')!.getBoundingClientRect().bottom }));
    expect(h.bottom).toBeLessThanOrEqual(h.win);
    if (!isPhone(page)) expect(h.doc).toBeLessThanOrEqual(h.win);
    const box = (await page.locator('#siteFrame').boundingBox())!;
    expect(box.height).toBeGreaterThan(h.win * 0.5);
  });

  test('none of the old report is on it', async ({ page }) => {
    await mount(page, '/presence.html');
    for (const sel of ['#statStrip', '#notesWrap', '#healthWrap', '.envelope', '.welcomebar', '#toolsCard', '#photosCard', '#designRailCard']) await expect(page.locator(sel)).toHaveCount(0);
  });

  test('leaving the Overview gives the buttons back to the title row', async ({ page }) => {
    await mount(page, '/presence.html');
    await expect(page.locator('#ssBar #btnEditSite')).toBeAttached();
    await page.evaluate(() => (window as any).go('faqs'));
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('.topbar #btnEditSite')).toBeAttached();
    await expect(page.locator('#ssBar #btnEditSite')).toHaveCount(0);
  });

  test('the preview ribbon stays out: the bar already says whether it’s live', async ({ page }) => {
    await mount(page, '/presence.html');
    await page.route('**/functions/v1/presence/preview**', (r: Route) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SITE_HTML }));
    await page.evaluate(() => (window as any).loadSiteStage(true));
    await expect(page.frameLocator('#siteFrame').locator('#presence-preview-badge')).toBeHidden();
    await expect(page.locator('#ssStatus')).toHaveText('Not live yet');
  });

  test('links walk the site in place, and a link off the site goes nowhere', async ({ page }) => {
    await mount(page, '/presence.html', { '/settings': { data: { pages: [{ slug: 'visit', title: 'Visit', blocks: [{ type: 'richtext', body: 'v' }] }] } } });
    const asked: string[] = [];
    await page.route('**/functions/v1/presence/preview**', (r: Route) => { asked.push(new URL(r.request().url()).searchParams.get('page') || ''); return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SITE_HTML }); });
    await page.evaluate(() => (window as any).loadSiteStage(true));
    const frame = page.frameLocator('#siteFrame');
    await frame.getByRole('link', { name: 'About' }).click();
    await expect.poll(() => asked.at(-1)).toBe('/about/');
    await expect(page.locator('#ssPage')).toHaveText('About');
    await frame.getByRole('link', { name: 'Off site' }).click();
    await page.waitForTimeout(200);
    expect(asked.filter((a) => a.includes('elsewhere'))).toHaveLength(0);
    await expect(page.locator('#ssPage')).toHaveText('About');
    expect(page.url()).toContain('/presence.html');
    // Edit opens the page you were looking at, when it's one of your own
    await frame.getByRole('link', { name: 'Visit' }).click();
    await expect(page.locator('#ssPage')).toHaveText('Visit');
    await page.locator('#btnEditSite').click();
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await expect(page.locator('#pagesBar .page-pill.on .pp-name')).toHaveText('Visit');
  });

  test('a deep link doesn’t draw the site until the Overview is opened', async ({ page }) => {
    let reads = 0;
    await page.route('**/functions/v1/presence/preview**', async (r: Route) => { reads++; await r.fallback(); });
    await mount(page, '/presence.html#faqs');
    await expect(page.locator('#view-faqs')).toBeVisible();
    await page.waitForTimeout(600);
    expect(reads).toBe(0);
    await page.evaluate(() => (window as any).go('today'));
    await expect(page.frameLocator('#siteFrame').locator('h1').first()).toBeVisible();
  });
});

test.describe('one to-do line', () => {
  test('it says what’s left, and shows the way there', async ({ page }) => {
    await mount(page, '/presence.html', CHANGES(3));
    const line = page.locator('#ssTodo');
    await expect(line).toContainText('3 things to finish before you can go live');
    await line.click();
    await expect(page.locator('#todoPanel')).toBeVisible();
    await page.getByRole('button', { name: 'See what’s blocking' }).click();
    await expect(page.locator('#ritualWrap')).toHaveClass(/\bon\b/);
  });

  test('nothing to finish, no line', async ({ page }) => {
    await mount(page, '/presence.html', { ...CHANGES(0), ...ALL_SET });
    await expect(page.frameLocator('#siteFrame').locator('h1').first()).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.locator('#ssTodo')).toBeHidden();
  });
});

test.describe('where everything else went', () => {
  test('Pages lists the pages; the old deep links land where their content moved', async ({ page }) => {
    await mount(page, '/presence.html#pages');
    await expect(page.locator('#view-pages')).toBeVisible();
    await expect(page.locator('#pagesList .hb-row').first()).toContainText('Home');
    await page.goto('/presence.html#health');
    await expect(page.locator('#view-search')).toBeVisible();
    await page.goto('/presence.html#activity');
    await expect(page.locator('#view-history')).toBeVisible();
    await expect(page.locator('#view-history h1.doc')).toHaveText('Versions');
    // the versions come first; what happened to the site follows them
    const order = await page.evaluate(() => { const k = [...document.querySelectorAll('#view-history > *')].map((n) => n.id); return [k.indexOf('pubList'), k.indexOf('activitySec')]; });
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order[1]).toBeGreaterThan(order[0]);
  });
  test('Add a page opens the new-page dialog in Edit mode', async ({ page }) => {
    await mount(page, '/presence.html#pages');
    await page.locator('#btnPagesAdd').click();
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await expect(page.getByPlaceholder(/Services, Gallery/)).toBeVisible();
  });
});

test.describe('the menu in the sidebar', () => {
  test.beforeEach(({ page }) => { test.skip(isPhone(page), 'a phone has the Menu sheet'); });

  test('it sits under Website, and nothing is listed twice', async ({ page }) => {
    await mount(page, '/presence.html');
    const sec = page.locator('.dds-nav .sec.has-site-menu');
    await expect(sec.locator('.site-menu .navitem[data-view="pages"]')).toBeVisible();
    await expect(sec.locator('.site-menu .navitem[data-view="today"]')).toBeHidden();         // Website itself is the Overview
    await expect(sec.locator('.site-menu .navitem[data-view="media"]')).toBeHidden();         // Files is already in the sidebar
    await expect(sec.locator('.site-menu .navitem[data-link="analytics"]')).toBeHidden();     // so is Analytics
    await expect(page.locator('.hb-tabs')).toHaveCount(0);                                    // no tab strip across the page
    await expect(page.locator('#dds-waffle')).toBeHidden();                                   // nor a launcher repeating the sidebar
  });

  test('Content and Site settings fold, and open on their own when you’re in them', async ({ page }) => {
    await mount(page, '/presence.html');
    const faqs = page.locator('#nav .navitem[data-view="faqs"]');
    await expect(faqs).toBeHidden();
    await page.locator('#nav .nav-fold[data-grp="Content"] > .grp').click();
    await expect(faqs).toBeVisible();
    await faqs.click();
    await expect(page.locator('#view-faqs')).toBeVisible();
    await expect(faqs).toHaveAttribute('aria-current', 'page');
    await page.goto('/presence.html#business');
    await page.reload();
    await expect(page.locator('#nav .navitem[data-view="business"]')).toBeVisible();
    await expect(faqs).toBeHidden();
  });

  test('Website goes to the Overview without reloading the page', async ({ page }) => {
    await mount(page, '/presence.html#faqs');
    await expect(page.locator('#view-faqs')).toBeVisible();
    await page.evaluate(() => { (window as any).__stillHere = true; });
    await page.locator('.dds-nav .sec.has-site-menu > a.it').click();
    await expect(page.locator('#siteStage')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__stillHere)).toBe(true);
  });

  test('every row fits on a short laptop: the list scrolls, the bottom row stays put', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await mount(page, '/presence.html#business');
    const nav = page.locator('.dds-nav');
    await expect(nav).toHaveCSS('overflow-y', 'auto');
    const bell = (await page.locator('#dds-bell').boundingBox())!;
    expect(bell.y + bell.height).toBeLessThanOrEqual(600);
  });

  test('a studio is never offered the Get started wizard', async ({ page }) => {
    const nav = [...STUDIO_NAV, { key: 'get_started', label: 'Get started', utility: true, items: [{ key: 'get_started', label: 'Get started', href: '/get-started.html' }] }];
    await mount(page, '/presence.html', { '/portal/context': { data: { ...(API['/portal/context'] as any).data, is_agency: true, nav } } });
    await expect(page.locator('.dds-nav .sec.has-site-menu')).toBeAttached();
    await expect(page.locator('.dds-nav')).not.toContainText('Get started');
  });
});

test.describe('on a phone', () => {
  test.beforeEach(({ page }) => { test.skip(!isPhone(page), 'the phone layout'); });
  test('the dock says Site and Menu, and the Menu sheet is grouped', async ({ page }) => {
    await mount(page, '/presence.html');
    await expect(page.locator('#dock button[data-tab="today"]')).toHaveText('Site');
    await page.locator('#dock button[data-tab="sections"]').click();
    await expect(page.locator('#sectionsNav .grp[data-grp="Content"]')).toBeVisible();
    await page.locator('#sectionsNav .navitem[data-view="pages"]').click();
    await expect(page.locator('#view-pages')).toBeVisible();
  });
  test('the top bar fits: the Account button is fully on screen', async ({ page }) => {
    await mount(page, '/presence.html');
    const p = (await page.locator('#dds-profile').boundingBox())!;
    expect(p.x + p.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await expect(page.locator('#dds-search kbd')).toBeHidden();
  });
  test('the site stops above the dock', async ({ page }) => {
    await mount(page, '/presence.html');
    await expect(page.frameLocator('#siteFrame').locator('h1').first()).toBeVisible();
    const stage = (await page.locator('#siteStage').boundingBox())!;
    const dock = (await page.locator('#dock').boundingBox())!;
    expect(stage.y + stage.height).toBeLessThanOrEqual(dock.y);
  });
});

// List item 31: editing by touch. A finger has no hover: a tap selects a section and
// its toolbar stays, a tap elsewhere moves or puts it away, and a second tap on the
// selected section's words edits them in place.
const TOUCH_PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body><main id="main">'
  + '<section class="hero" data-dds-core="hero"><h1 data-pr="identity.business_name">Marlow’s Kitchen</h1></section>'
  + '<section class="block" data-dds-core="about"><h2>About us</h2><p data-pr="identity.description">Hello</p></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Your heading</h2></section>'
  + '<section id="b" data-dds-sid="richtext" data-dds-key="block_richtext" data-dds-src="1" class="block"><h2 data-dds-field="title">Our story</h2></section>'
  + '</main><footer id="ft" style="padding:40px">Footer</footer></body></html>';
const touchCanvas = async (page: Page) => {
  const writes = await mount(page, '/presence.html#design', { __html: TOUCH_PAGE });
  const frame = page.frameLocator('#designPreview');
  await frame.locator('section#a h2').waitFor();
  await expect(frame.locator('#dds-dc-bar')).toBeAttached();
  await page.waitForLoadState('networkidle');
  return { writes, frame };
};
const touchChecks = () => {
  test('a tap selects a section, and its toolbar stays put', async ({ page }) => {
    const { frame } = await touchCanvas(page);
    const bar = frame.locator('#dds-dc-bar');
    await expect(bar).not.toHaveClass(/\bon\b/);
    await frame.locator('section#a').tap();
    await expect(bar).toHaveClass(/\bon\b/);
    await expect(frame.locator('section#a')).toHaveClass(/dc-hot/);
    await expect(bar.getByRole('button', { name: 'Duplicate this section' })).toBeVisible();
    await page.waitForTimeout(600);   // the pretend mouse-leave after a tap must not put it away
    await expect(bar).toHaveClass(/\bon\b/);
    await expect(frame.locator('[contenteditable]')).toHaveCount(0);   // the first tap selects, it doesn't edit
  });
  test('a tap on another section moves the toolbar there, and a tap off every section puts it away', async ({ page }) => {
    const { frame } = await touchCanvas(page);
    const bar = frame.locator('#dds-dc-bar');
    await frame.locator('section#a').tap();
    await frame.locator('section[data-dds-core="about"]').tap();
    await expect(frame.locator('section[data-dds-core="about"]')).toHaveClass(/dc-hot/);
    await expect(frame.locator('section#a')).not.toHaveClass(/dc-hot/);
    await expect(bar.getByRole('button', { name: /Remove this section from the page/ })).toBeVisible();
    await frame.locator('#ft').tap();
    await expect(bar).not.toHaveClass(/\bon\b/);
    await expect(frame.locator('.dc-hot')).toHaveCount(0);
  });
  test('a second tap on the selected section’s words edits them in place', async ({ page }) => {
    const { frame } = await touchCanvas(page);
    const h = frame.locator('section#a h2[data-dds-field="title"]');
    await frame.locator('section#a').tap();
    await expect(frame.locator('#dds-dc-bar')).toHaveClass(/\bon\b/);
    await h.tap();
    await expect(h).toHaveAttribute('contenteditable', /true|plaintext-only/);
    await expect(frame.locator('#dds-dc-bar')).not.toHaveClass(/\bon\b/);   // the toolbar steps aside while you type
  });
  test('Return saves the words and lets go of them, so an iPhone puts its keyboard away', async ({ page }) => {
    const { writes, frame } = await touchCanvas(page);
    const h = frame.locator('section#a h2[data-dds-field="title"]');
    await frame.locator('section#a').tap();
    await h.tap();
    await expect(h).toHaveAttribute('contenteditable', /true|plaintext-only/);
    await page.keyboard.press('End');
    await page.keyboard.insertText(' today');
    await page.keyboard.press('Enter');
    // straight away, before the save redraws the canvas: nothing keeps the keyboard
    expect(await h.evaluate((el) => el.ownerDocument.activeElement === el)).toBe(false);
    await expect.poll(() => writes.filter((w) => w.path === '/settings' && w.body && Array.isArray(w.body.blocks)).map((w) => w.body.blocks[0].title).at(-1)).toBe('Your heading today');
  });
  test('the editor’s tip says to tap, not double-click', async ({ page }) => {
    await touchCanvas(page);
    await expect(page.locator('.dds-hint.dds-live')).toContainText('Tap a section to select it, then tap its words');
  });
  test('the toolbar’s buttons work by touch', async ({ page }) => {
    const { writes, frame } = await touchCanvas(page);
    await frame.locator('section#b').tap();
    await frame.locator('#dds-dc-bar').getByRole('button', { name: 'Duplicate this section' }).tap();
    await expect.poll(() => writes.filter((w) => w.path === '/settings' && w.body && Array.isArray(w.body.blocks)).map((w) => w.body.blocks.length).at(-1)).toBe(3);
  });
};
test.describe('editing by touch: Safari on a phone and a tablet', () => {
  test.beforeEach(({}, testInfo) => { test.skip(!testInfo.project.use.hasTouch, 'touch devices only'); });
  touchChecks();
});
test.describe('editing by touch: Chrome on an Android phone', () => {
  const { defaultBrowserType: _d, ...PIXEL } = devices['Pixel 7'];
  test.use(PIXEL);
  test.beforeEach(({ browserName }) => { test.skip(browserName !== 'chromium', 'Chrome only'); });
  touchChecks();
});
test.describe('after an iPhone keyboard closes', () => {
  test('the editor goes back to the top, so Exit and Publish are on screen', async ({ page }) => {
    await touchCanvas(page);
    const y = await page.evaluate(async () => {
      const pad = document.createElement('div'); pad.style.height = '3000px'; document.body.appendChild(pad);   // room to be scrolled, as Safari does for its keyboard
      window.scrollTo(0, 400);
      const before = window.scrollY;
      window.visualViewport!.dispatchEvent(new Event('resize'));   // the keyboard has gone: the viewport is full height again
      await new Promise((r) => setTimeout(r, 50));
      return [before, window.scrollY];
    });
    expect(y[0]).toBeGreaterThan(0);
    expect(y[1]).toBe(0);
    await expect(page.locator('#btnEditExit')).toBeInViewport();
  });
});
test.describe('editing with a mouse is unchanged', () => {
  test.beforeEach(({}, testInfo) => { test.skip(!!testInfo.project.use.hasTouch, 'a mouse'); });
  test('hover shows the toolbar, leaving puts it away, and a click selects nothing', async ({ page }) => {
    const { frame } = await touchCanvas(page);
    const bar = frame.locator('#dds-dc-bar');
    await frame.locator('section#a').click();
    await expect(bar).toHaveClass(/\bon\b/);   // the hover that came with the click
    await expect(frame.locator('[contenteditable]')).toHaveCount(0);
    await frame.locator('#ft').hover();
    await expect(bar).not.toHaveClass(/\bon\b/);
  });
  test('the editor’s tip still says double-click', async ({ page }) => {
    await touchCanvas(page);
    await expect(page.locator('.dds-hint.dds-live')).toContainText('Double-click the words in a section');
  });
});

test.describe('a watch-plan site', () => {
  const WATCH = { '/site': { data: { site: { id: 's1', edition: 'monitor', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Sample Bakery', description: 'Hello' }, location: {} } } };
  const open = async (page: Page) => {
    await page.route('**/functions/v1/presence/preview**', (r: Route) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'feature_not_in_plan' }) }));
    await installApp(page, { api: { ...API, ...WATCH, '/settings': { data: { blocks: [], pages: [] } } } });
    await page.route('**/functions/v1/presence/preview**', (r: Route) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'feature_not_in_plan' }) }));
    await page.goto('/presence.html');
    await expect(page.locator('html')).toHaveClass(/plan-watch/);
  };
  test('it says what this plan is, whose site it is, and where to look', async ({ page }) => {
    await open(page);
    const note = page.locator('#ssNote');
    await expect(note).toContainText('Sample Bakery’s website lives somewhere else.');
    await expect(note.getByRole('button', { name: 'Search and health' })).toBeVisible();
    await note.getByRole('button', { name: 'Search and health' }).click();
    await expect(page.locator('#view-search')).toBeVisible();
  });
  test('the menu lists only what applies', async ({ page }) => {
    await open(page);
    for (const v of ['offerings', 'faqs', 'testimonials', 'updates', 'bookings', 'reviews', 'history']) expect(await page.locator(`#sectionsNav .navitem[data-view="${v}"]`).evaluate((n) => getComputedStyle(n).display), v).toBe('none');
    expect(await page.locator('#sectionsNav .grp[data-grp="Content"]').evaluate((n) => getComputedStyle(n).display)).toBe('none');
    expect(await page.locator('#sectionsNav .navitem[data-link="styles"]').evaluate((n) => getComputedStyle(n).display)).toBe('none');
    expect(await page.locator('#sectionsNav .navitem[data-view="search"]').evaluate((n) => getComputedStyle(n).display)).not.toBe('none');
    await expect(page.locator('#ssTodo')).toBeHidden();
    await expect(page.locator('#ssBar')).toBeHidden();      // no "Not live yet", no Edit, no Publish, no Preview of a page it doesn't host
    expect(await page.locator('#sectionsNav .navitem[data-view="pages"]').evaluate((n) => getComputedStyle(n).display)).toBe('none');
  });
});

test.describe('Business details holds only the business', () => {
  test('its name and contact details, address and hours stay; everything else has a better home', async ({ page }) => {
    await mount(page, '/presence.html#business');
    await expect(page.locator('#view-business h1.doc')).toHaveText('Business details');
    for (const id of ['f-business_name', 'f-phone', 'f-booking_url', 'f-city', 'hoursGrid', 'closedSwitch']) await expect(page.locator(`#view-business #${id}`)).toBeVisible();
    await expect(page.locator('#billingCard, #deleteCard')).toHaveCount(0);
    await expect(page.locator('#view-business #annCard, #view-business #knowledgeList')).toHaveCount(0);
    await expect(page.getByText('The technical side')).toHaveCount(0);
    await expect(page.locator('#view-updates #annCard')).toHaveCount(1);
    await expect(page.locator('#view-media #knowledgeList')).toHaveCount(1);
  });
});

test.describe('a tab opens on its title', () => {
  test('what the tab is for sits behind one small help button', async ({ page }) => {
    await mount(page, '/presence.html#updates');
    const sub = page.locator('#view-updates > .docsub');
    const help = page.locator('#view-updates > .tabhelp');
    await expect(page.locator('#view-updates > h1.doc')).toHaveText('Updates');
    await expect(sub).toBeHidden();
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await help.click();
    await expect(sub).toBeVisible();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    await help.click();
    await expect(sub).toBeHidden();
  });
  test('Edit mode keeps its one bar: no title and no help button', async ({ page }) => {
    await mount(page, '/presence.html#design');
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await expect(page.locator('#view-design > .tabhelp')).toBeHidden();
  });
});

test.describe('pictures in the pickers (item 25)', () => {
  test('every section in the rail and in the canvas’s Add section menu shows its picture', async ({ page }) => {
    await mount(page, '/presence.html#design');
    await expect(page.frameLocator('#designPreview').locator('#main > section').first()).toBeVisible();
    await page.evaluate(() => (window as any).openTrayPanel('add'));
    const items = page.locator('#designTray .tray-item.has-shot');
    await expect(items.first()).toBeVisible();
    const n = await items.count();
    expect(n).toBeGreaterThan(30);
    const loaded = await page.locator('#designTray .tray-item .ti-shot').evaluateAll(async (imgs: HTMLImageElement[]) => {
      await Promise.all(imgs.map((i) => { i.loading = 'eager'; return i.decode().catch(() => null); }));
      return imgs.filter((i) => i.naturalWidth === 440).length;
    });
    expect(loaded).toBe(n);                                                  // every picture is there and is a picture
    await expect(page.locator('#designTray .tray-item').filter({ hasText: 'Photo gallery' }).locator('.ti-shot')).toHaveAttribute('src', '/thumbs/sections/gallery.jpg');
    await page.evaluate(() => (window as any).openInsertMenu(0, null, { left: 200, top: 200, bottom: 220, right: 400 }));
    await expect(page.locator('.blk-insertmenu .tray-item.has-shot').first()).toBeVisible();
    expect(await page.locator('.blk-insertmenu .tray-item.has-shot').count()).toBe(n);
  });

  test('a picture that can’t load leaves the section’s name and icon, not a broken image', async ({ page }) => {
    await page.route('**/thumbs/sections/gallery.jpg', (route) => route.fulfill({ status: 404, body: '' }));
    await mount(page, '/presence.html#design');
    await expect(page.frameLocator('#designPreview').locator('#main > section').first()).toBeVisible();
    await page.evaluate(() => (window as any).openTrayPanel('add'));
    const gallery = page.locator('#designTray .tray-item').filter({ hasText: 'Photo gallery' });
    await gallery.scrollIntoViewIfNeeded();
    await expect(gallery.locator('.ti-shot')).toHaveCount(0);
    await expect(gallery).not.toHaveClass(/has-shot/);
    await expect(gallery.locator('.ti-ico svg')).toBeVisible();
  });
});

test.describe('Versions', () => {
  const pub = (i: number, more: Record<string, unknown> = {}) => ({ id: 'p' + i, kind: 'publish', status: 'live', summary: 'Version ' + i, label: '', at: new Date(Date.UTC(2026, 9, 30 - i, 15)).toISOString(), restorable: true, by_kind: 'client', ...more });
  const PUBS = [pub(0), pub(1, { by_kind: 'operator', label: 'Spring menu' }), pub(2, { status: 'failed', restorable: false }), ...Array.from({ length: 10 }, (_, i) => pub(i + 3))];
  const VERSIONS = {
    '/publishes': { data: PUBS }, '/publishes/checkpoints': { data: [] }, '/launches': { data: [] },
    '/preview/status': { data: { draft: { unpublished_changes: 1 }, preview: { exists: false }, live: { published: true, last_published_at: '2026-10-30T15:00:00Z' } } },
    '/publishes/compare': { data: { count: 1, from: { at: '2026-10-30' }, to: { ref: 'draft' }, changes: [{ section: 'business', sentence: 'Your hours changed.' }] } },
  };
  const rows = (page: Page) => page.locator('#pubList .hentry');
  test('the list leads: when, who, what changed, then View, Compare and Restore', async ({ page }) => {
    await mount(page, '/presence.html#history', VERSIONS);
    await expect(rows(page).first()).toContainText('Version 0');
    await expect(rows(page).first()).toContainText('Live now');
    await expect(rows(page).first()).toContainText('Published by you');
    await expect(rows(page).nth(1)).toContainText('“Spring menu”');
    await expect(rows(page).nth(1)).toContainText('Published by your studio');
    await expect(rows(page).nth(1)).not.toContainText('Live now');
    for (const name of ['View', 'Compare', 'Restore']) await expect(rows(page).first().getByRole('button', { name, exact: true })).toBeVisible();
    // a failed publish says so and offers nothing to do
    await expect(rows(page).nth(2)).toContainText('didn’t go through');
    await expect(rows(page).nth(2).locator('button')).toHaveCount(0);
    // the extra tools are out of the way for a client
    await expect(page.locator('#versionMore')).not.toHaveAttribute('open', '');
    await expect(page.getByRole('button', { name: 'Save a checkpoint' })).toBeHidden();
  });
  test('Compare opens in place, against the draft', async ({ page }) => {
    await mount(page, '/presence.html#history', VERSIONS);
    const asked = page.waitForRequest((r) => /\/publishes\/compare\?/.test(r.url()));
    await rows(page).first().getByRole('button', { name: 'Compare', exact: true }).click();
    const q = new URL((await asked).url()).searchParams;
    expect([q.get('a'), q.get('b')]).toEqual(['p0', 'draft']);
    await expect(rows(page).first()).toContainText('Your hours changed.');
    await expect(rows(page).first()).toContainText('your working draft');
    await rows(page).first().getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(rows(page).first().locator('.hcompare')).toBeHidden();
  });
  test('Restore asks first, and says where it goes', async ({ page }) => {
    await mount(page, '/presence.html#history', VERSIONS);
    await rows(page).first().getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.locator('#resSheetTitle')).toHaveText('Restore this version?');
    await expect(page.locator('#btnRestoreGo')).toHaveText('Restore to my draft');
  });
  test('ten at a time: older versions wait behind one button', async ({ page }) => {
    await mount(page, '/presence.html#history', VERSIONS);
    await expect(rows(page)).toHaveCount(10);
    await page.getByRole('button', { name: 'Show 3 older versions' }).click();
    await expect(rows(page)).toHaveCount(13);
  });
  test('the studio sees every tool, and reads the row from its own side', async ({ page }) => {
    const ctx = (API['/portal/context'] as any).data;
    await mount(page, '/presence.html?client=s1#history', { ...VERSIONS, '/portal/context': { data: { ...ctx, is_agency: true } } });
    await expect(page.locator('#versionMore')).toHaveAttribute('open', '');
    await expect(page.getByRole('button', { name: 'Save a checkpoint' })).toBeVisible();
    await expect(rows(page).first()).toContainText('Published by the client');
    await expect(rows(page).nth(1)).toContainText('Published by your team');
  });
});

test.describe('Pages: every page and the menu in one place', () => {
  const OWN = [
    { slug: 'gallery', title: 'Gallery', blocks: [] },
    { slug: 'landing', title: 'Landing', blocks: [], hideNav: true },
  ];
  const withPages = (extra: Record<string, unknown> = {}) => ({ '/settings': { data: { pages: OWN, ...extra } } });
  const names = (page: Page, list: string) => page.locator(`#${list} .pg-row .t b`).allTextContents();
  const navWrite = (writes: Write[]) => writes.filter((w) => w.path === '/settings' && w.body.nav).at(-1)?.body;
  const hrefs = (nav: Array<{ href: string }>) => nav.map((n) => n.href);
  const AUTO = ['/', '/services/', '/about/', '/faq/', '/updates/', '/contact/', '/gallery/'];
  const row = (page: Page, name: string) => page.locator('.pg-row').filter({ has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) });
  async function drag(page: Page, name: string, y: (box: { y: number; height: number }) => number, target: ReturnType<Page['locator']>) {
    await page.waitForLoadState('networkidle');
    await expect(row(page, name).locator('.pg-grab')).toBeVisible();
    await row(page, name).evaluate((n) => n.scrollIntoView({ block: 'center' }));   // clear of the phone and tablet dock
    const h = (await row(page, name).locator('.pg-grab').boundingBox())!;
    const box = (await target.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 6);
    await page.mouse.move(h.x + h.width / 2, y(box), { steps: 6 });
    await expect(page.locator('.pg-dropline')).toHaveCount(1);
    await page.mouse.up();
  }

  test('the menu is listed in the site’s own order, and a hidden page sits under Not linked', async ({ page }) => {
    const writes = await mount(page, '/presence.html#pages', withPages());
    await expect(page.getByRole('heading', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Not linked' })).toBeVisible();
    await expect.poll(() => page.locator('#pagesList .pg-row').evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.href))).toEqual(AUTO);
    expect(await names(page, 'pagesUnlinked')).toEqual(['Landing']);
    await expect(page.locator('#btnNavAuto')).toBeHidden();
    expect(writes.filter((w) => w.path === '/settings')).toHaveLength(0);   // just looking changes nothing
  });

  test('drag a page up the menu: one write, the menu in its new order', async ({ page }) => {
    test.skip(isPhone(page), 'the same pointer events; the finger test covers the phone');
    const writes = await mount(page, '/presence.html#pages', withPages());
    await drag(page, 'Contact', (b) => b.y + 2, row(page, 'About'));
    await expect.poll(() => navWrite(writes)).toBeTruthy();
    expect(hrefs(navWrite(writes).nav)).toEqual(['/', '/services/', '/contact/', '/about/', '/faq/', '/updates/', '/gallery/']);
    await expect.poll(async () => (await names(page, 'pagesList')).slice(2, 4)).toEqual(['Contact', 'About']);
    await expect(page.locator('.pg-dropline')).toHaveCount(0);
    await expect(page.locator('#btnNavAuto')).toBeVisible();
  });

  test('drag a page to Not linked: it leaves the menu and stays live; drag another in and it joins', async ({ page }) => {
    test.skip(isPhone(page), 'the same pointer events; the finger test covers the phone');
    const writes = await mount(page, '/presence.html#pages', withPages());
    await drag(page, 'Gallery', (b) => b.y + b.height - 2, page.locator('#pagesUnlinked'));
    await expect.poll(() => navWrite(writes)).toBeTruthy();
    expect(hrefs(navWrite(writes).nav)).not.toContain('/gallery/');
    expect(navWrite(writes).pages.find((p: any) => p.slug === 'gallery').hideNav).toBe(true);
    await expect.poll(async () => (await names(page, 'pagesUnlinked')).sort()).toEqual(['Gallery', 'Landing']);
    await drag(page, 'Landing', (b) => b.y + 2, row(page, 'About'));
    await expect.poll(() => hrefs(navWrite(writes).nav).indexOf('/landing/')).toBe(2);
    expect(navWrite(writes).pages.find((p: any) => p.slug === 'landing').hideNav).toBeUndefined();
  });

  // A phone has no arrow keys, so the handle is the only way it has to move a page.
  test.describe('with a finger', () => {
    const { defaultBrowserType: _, ...PHONE } = devices['Pixel 7'];
    test.use(PHONE);
    test.skip(({ browserName }) => browserName !== 'chromium', 'only Chromium takes a real touch drag from a test');

    test('drag a page up the menu: the row moves and the page stays still', async ({ page, context }) => {
      const writes = await mount(page, '/presence.html#pages', withPages());
      await page.waitForLoadState('networkidle');
      await expect(row(page, 'Contact').locator('.pg-grab')).toBeVisible();
      await row(page, 'Contact').evaluate((n) => n.scrollIntoView({ block: 'center' }));
      const h = (await row(page, 'Contact').locator('.pg-grab').boundingBox())!;
      expect(h.height).toBeGreaterThanOrEqual(44);
      const to = (await row(page, 'About').boundingBox())!.y + 2, from = h.y + h.height / 2, x = h.x + h.width / 2;
      const scrolled = await page.evaluate(() => scrollY);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + (to - from) * i / 8 }] });
      await expect(page.locator('.pg-dropline')).toHaveCount(1);
      expect(await page.evaluate(() => scrollY)).toBe(scrolled);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => navWrite(writes)).toBeTruthy();
      expect(hrefs(navWrite(writes).nav)).toEqual(['/', '/services/', '/contact/', '/about/', '/faq/', '/updates/', '/gallery/']);
      await expect.poll(async () => (await names(page, 'pagesList')).slice(2, 4)).toEqual(['Contact', 'About']);
    });
  });

  test('Escape drops a drag where it started, and writes nothing', async ({ page }) => {
    test.skip(isPhone(page), 'needs a keyboard');
    const writes = await mount(page, '/presence.html#pages', withPages());
    await page.waitForLoadState('networkidle');
    await expect(row(page, 'Contact').locator('.pg-grab')).toBeVisible();
    const h = (await row(page, 'Contact').locator('.pg-grab').boundingBox())!;
    await page.mouse.move(h.x + 8, h.y + 8); await page.mouse.down(); await page.mouse.move(h.x + 8, h.y - 60, { steps: 4 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('.pg-dragging')).toHaveCount(0);
    expect(writes.filter((w) => w.path === '/settings')).toHaveLength(0);
  });

  test('the arrow keys move a row, across the two lists, and the handle keeps focus', async ({ page }) => {
    const writes = await mount(page, '/presence.html#pages', withPages());
    await page.waitForLoadState('networkidle');
    await row(page, 'Gallery').locator('.pg-grab').focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => hrefs(navWrite(writes)?.nav || []).indexOf('/gallery/')).toBe(5);
    await expect(row(page, 'Gallery').locator('.pg-grab')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hrefs(navWrite(writes).nav).indexOf('/gallery/')).toBe(6);
    await page.keyboard.press('ArrowDown');   // off the end of the menu: Not linked
    await expect.poll(() => hrefs(navWrite(writes).nav)).not.toContain('/gallery/');
    await expect(row(page, 'Gallery').locator('.pg-grab')).toBeFocused();
    await expect.poll(() => names(page, 'pagesUnlinked')).toContain('Gallery');
  });

  test('two quick presses both count, each from where the last one left it', async ({ page }) => {
    const writes = await mount(page, '/presence.html#pages', withPages());
    await page.waitForLoadState('networkidle');
    await row(page, 'Gallery').locator('.pg-grab').focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => writes.filter((w) => w.path === '/settings' && w.body.nav).length).toBe(2);
    expect(hrefs(navWrite(writes).nav).indexOf('/gallery/')).toBe(4);
  });

  test('the menu can’t be emptied: that would quietly bring the automatic one back', async ({ page }) => {
    const writes = await mount(page, '/presence.html#pages', withPages({ nav: [{ label: 'Home', href: '/' }] }));
    await page.waitForLoadState('networkidle');
    await row(page, 'Home').locator('.pg-grab').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByText('Keep at least one page in the menu.')).toBeVisible();
    expect(writes.filter((w) => w.path === '/settings')).toHaveLength(0);
    expect(await names(page, 'pagesList')).toEqual(['Home']);
  });

  test('one settings button: name, address, label, dropdown and Google, each saved as it changes', async ({ page }) => {
    const writes = await mount(page, '/presence.html#pages', withPages());
    await page.getByRole('button', { name: 'Settings for Gallery' }).click();
    const panel = page.locator('#pageSettings');
    await expect(panel.getByRole('heading', { name: 'Gallery settings' })).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: 'Show this page on Google' })).toBeChecked();
    await expect(panel.getByLabel('Search headline for Gallery')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Delete page' })).toBeVisible();
    // the name
    await panel.getByLabel('Page name').fill('Our work');
    await panel.getByLabel('Page name').blur();
    await expect.poll(() => writes.at(-1)?.body?.pages?.find((p: any) => p.slug === 'gallery')?.title).toBe('Our work');
    // the address: the server forwards the old link from prev_slug
    await panel.getByLabel('Page address').fill('Our Work');
    await panel.getByLabel('Page address').blur();
    await expect.poll(() => writes.at(-1)?.body?.pages?.find((p: any) => p.slug === 'our-work')?.prev_slug).toBe('gallery');
    // the label in the menu makes the menu custom
    await panel.getByLabel('Label in the menu').fill('Work');
    await panel.getByLabel('Label in the menu').blur();
    await expect.poll(() => navWrite(writes)?.nav?.find((n: any) => n.href === '/our-work/')?.label).toBe('Work');
    // a dropdown under About
    await panel.getByLabel('Show under').selectOption('/about/');
    await expect.poll(() => navWrite(writes).nav.find((n: any) => n.href === '/about/')?.children?.[0]?.href).toBe('/our-work/');
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect(panel).toHaveCount(0);
    await expect(row(page, 'Work')).toHaveClass(/child/);
  });

  test('a built-in page can leave the menu; Home has no address to change', async ({ page }) => {
    const writes = await mount(page, '/presence.html#pages', withPages());
    await page.getByRole('button', { name: 'Settings for About' }).click();
    const panel = page.locator('#pageSettings');
    await expect(panel.getByLabel('Page address')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Delete page' })).toHaveCount(0);
    await panel.getByLabel('Show in the menu').uncheck();
    await expect.poll(() => navWrite(writes)).toBeTruthy();
    expect(hrefs(navWrite(writes).nav)).not.toContain('/about/');
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => names(page, 'pagesUnlinked')).toContain('About');
    await page.getByRole('button', { name: 'Settings for Home' }).click();
    await expect(panel).toContainText('search headline and description on the Search tab');
    await expect(panel.getByLabel('Page address')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Duplicate page' })).toBeVisible();
  });

  test('a custom page’s Show in the menu keeps an automatic menu automatic', async ({ page }) => {
    const writes = await mount(page, '/presence.html#pages', withPages());
    await page.getByRole('button', { name: 'Settings for Landing' }).click();
    await page.locator('#pageSettings').getByLabel('Show in the menu').check();
    await expect.poll(() => writes.at(-1)?.body?.pages?.find((p: any) => p.slug === 'landing')).toBeTruthy();
    expect(writes.at(-1)?.body?.pages?.find((p: any) => p.slug === 'landing').hideNav).toBeUndefined();
    expect(navWrite(writes)).toBeUndefined();
    await expect(page.locator('#btnNavAuto')).toBeHidden();
  });

  test('Add a link: a bad link is refused in place, a bare domain is completed', async ({ page }) => {
    const writes = await mount(page, '/presence.html#pages', withPages());
    await page.locator('#btnPagesAddLink').click();
    const panel = page.locator('#linkSettings');
    await panel.getByLabel('Label in the menu').fill('Order');
    await panel.getByLabel('Links to').fill('not a link');
    await panel.getByRole('button', { name: 'Add to the menu' }).click();
    await expect(panel.getByRole('alert')).toContainText('won’t work');
    expect(navWrite(writes)).toBeUndefined();
    await panel.getByLabel('Links to').fill('order.example.com/now');
    await panel.getByRole('button', { name: 'Add to the menu' }).click();
    await expect(panel).toHaveCount(0);
    expect(navWrite(writes).nav.at(-1)).toEqual({ label: 'Order', href: 'https://order.example.com/now' });
    await expect(row(page, 'Order').locator('.t span')).toHaveText('https://order.example.com/now');
    await expect(row(page, 'Order').getByRole('button', { name: /^Edit/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Settings for Order' }).click();
    await page.locator('#linkSettings').getByRole('button', { name: 'Remove from the menu' }).click();
    await expect.poll(() => hrefs(navWrite(writes).nav)).not.toContain('https://order.example.com/now');
    await expect(row(page, 'Order')).toHaveCount(0);
  });

  test('a saved custom menu is what shows, dropdowns included', async ({ page }) => {
    const nav = [{ label: 'Start', href: '/' }, { label: 'Our work', href: '/gallery/', children: [{ label: 'Say hello', href: '/contact/' }, { label: 'Booking', href: 'https://book.example.com' }] }];
    const writes = await mount(page, '/presence.html#pages', withPages({ nav }));
    await expect.poll(() => names(page, 'pagesList')).toEqual(['Start', 'Our work', 'Say hello', 'Booking']);
    await expect(row(page, 'Say hello')).toHaveClass(/child/);
    expect(await names(page, 'pagesUnlinked')).toEqual(expect.arrayContaining(['About', 'FAQ', 'Landing']));
    // a child row's arrow keys stay among its siblings
    await page.waitForLoadState('networkidle');
    await row(page, 'Say hello').locator('.pg-grab').focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => navWrite(writes)?.nav?.[1]?.children?.map((k: any) => k.label)).toEqual(['Booking', 'Say hello']);
    // Reset to automatic asks, then clears it
    page.once('dialog', (d) => d.accept());
    await page.locator('#btnNavAuto').click();
    await expect.poll(() => writes.at(-1)?.body?.nav).toEqual([]);
    await expect(page.locator('#btnNavAuto')).toBeHidden();
  });

  test('renaming a page keeps a custom menu pointing at it, and its label if that was the name', async ({ page }) => {
    const nav = [{ label: 'Home', href: '/' }, { label: 'Gallery', href: '/gallery/' }];
    const writes = await mount(page, '/presence.html#pages', withPages({ nav }));
    await page.getByRole('button', { name: 'Settings for Gallery' }).click();
    const panel = page.locator('#pageSettings');
    await panel.getByLabel('Page name').fill('Portfolio');
    await panel.getByLabel('Page name').blur();
    await expect.poll(() => navWrite(writes)?.nav?.[1]?.label).toBe('Portfolio');
    await panel.getByLabel('Page address').fill('portfolio');
    await panel.getByLabel('Page address').blur();
    await expect.poll(() => navWrite(writes)?.nav?.[1]?.href).toBe('/portfolio/');
  });

  test('deleting a page takes it off a custom menu, its dropdown staying; Undo puts both back', async ({ page }) => {
    const nav = [{ label: 'Home', href: '/' }, { label: 'Gallery', href: '/gallery/', children: [{ label: 'About', href: '/about/' }] }];
    const writes = await mount(page, '/presence.html#pages', withPages({ nav }));
    page.on('dialog', (d) => d.accept());
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Settings for Gallery' }).click();
    await page.locator('#pageSettings').getByRole('button', { name: 'Delete page' }).click();
    await expect.poll(() => navWrite(writes)?.nav?.map((n: any) => n.href)).toEqual(['/', '/about/']);
    expect(navWrite(writes).pages.map((p: any) => p.slug)).toEqual(['landing']);
    await expect(row(page, 'Gallery')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).last().click();
    await expect.poll(() => navWrite(writes)?.nav?.map((n: any) => n.href)).toEqual(['/', '/gallery/']);
    await expect(row(page, 'Gallery')).toHaveCount(1);
  });

  test('changing the kind of business keeps a custom menu’s link to the offerings page alive', async ({ page }) => {
    const nav = [{ label: 'Home', href: '/' }, { label: 'Services', href: '/services/' }, { label: 'Book', href: 'https://book.example.com' }];
    const writes = await mount(page, '/presence.html#business', withPages({ nav, industry_key: 'generic' }));
    await page.waitForLoadState('networkidle');
    await page.locator('#f-industry').selectOption('restaurant');
    await expect.poll(() => navWrite(writes)?.nav).toEqual([{ label: 'Home', href: '/' }, { label: 'Menu', href: '/menu/' }, { label: 'Book', href: 'https://book.example.com' }]);
  });

  test('Search no longer repeats each page’s settings, so the two can’t disagree', async ({ page }) => {
    await mount(page, '/presence.html#search', withPages());
    await expect(page.locator('#searchCard')).toContainText('use its settings button on the Pages tab');
    await expect(page.locator('#searchCard details', { hasText: 'Fine-tune' })).toHaveCount(0);
    await page.locator('#searchCard a', { hasText: 'Pages tab' }).click();
    await expect(page.locator('#view-pages')).toBeVisible();
  });

  test('from Edit mode, the Pages button and a page’s ⋯ both reach the same place', async ({ page }) => {
    await mount(page, '/presence.html#design', withPages());
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    if (!isPhone(page)) {
      await page.locator('#pagesBar .page-pill', { hasText: 'Gallery' }).locator('.pp-menu').click();
      await page.getByRole('button', { name: 'Page settings…' }).click();
      await expect(page.locator('#pageSettings').getByRole('heading', { name: 'Gallery settings' })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => document.getElementById('btnNavEdit')!.click());
    await expect(page.locator('#view-pages')).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/dc-edit/);
  });
});

test.describe('a section edited in its panel redraws at once (item 26)', () => {
  const setup = async (page: Page) => {
    const writes = await mount(page, '/presence.html#design');
    const frame = page.frameLocator('#designPreview');
    await frame.locator('#a h2').waitFor();
    await page.waitForLoadState('networkidle');
    const log: string[] = [];
    const asked: Array<{ index: number; blocks: any[] }> = [];
    await page.route('**/functions/v1/presence/preview/section', async (route: Route) => {
      const body = route.request().postDataJSON(); asked.push(body); log.push('section drawn');
      const b = body.blocks[body.index];
      const html = `<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="${body.index}" class="block"><h2 data-dds-field="title">${b.title}</h2></section>`;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { html } }) });
    });
    await page.route('**/functions/v1/presence/settings', async (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      log.push('save asked'); await new Promise((r) => setTimeout(r, 1200)); log.push('save answered'); return route.fallback();
    });
    await page.route('**/functions/v1/presence/preview?**', (route: Route) => { log.push('page drawn'); return route.fallback(); });
    return { writes, frame, log, asked };
  };

  test('the change shows on the canvas before its save answers, drawn from the list as it stands', async ({ page }) => {
    const { frame, log, asked, writes } = await setup(page);
    await page.evaluate(() => (window as any).eeEditBlock(0));
    const title = page.locator('#blocksCard input').first();
    await title.fill('A fresh heading');
    await title.blur();
    const edited = frame.locator('#main > section[data-dds-src="0"]');
    await expect(edited.locator('h2')).toHaveText('A fresh heading');
    expect(log).not.toContain('save answered');                       // shown before the save came back
    expect(asked.at(-1)!.index).toBe(0);
    expect(asked.at(-1)!.blocks).toHaveLength(2);                      // the whole page's list, so its tags come out right
    await expect(edited).toHaveAttribute('data-dc', '1');           // the new section is wired for editing
    await expect.poll(() => writes.filter((w) => w.path === '/settings' && w.method === 'PUT').length).toBe(1);
    await expect.poll(() => log.slice(log.indexOf('save answered')).includes('page drawn')).toBe(true);   // the save's own redraw still follows
  });

  test('typing shows on the canvas as you type, and the save still waits for the field to be left', async ({ page }) => {
    const { frame, writes } = await setup(page);
    await page.evaluate(() => (window as any).eeEditBlock(0));
    const title = page.locator('#blocksCard input').first();
    await title.click();
    await title.press('ControlOrMeta+a');
    await title.pressSequentially('Typed live', { delay: 30 });
    const edited = frame.locator('#main > section[data-dds-src="0"]');
    await expect(edited.locator('h2')).toHaveText('Typed live');           // while the field still has focus
    await expect(title).toBeFocused();                                      // nothing rebuilt the panel under the cursor
    await page.waitForTimeout(900);
    expect(writes.filter((w) => w.path === '/settings' && w.method === 'PUT')).toHaveLength(0);
    await title.blur();
    await expect.poll(() => writes.filter((w) => w.path === '/settings' && w.method === 'PUT').length).toBe(1);
    expect(writes.filter((w) => w.path === '/settings' && w.method === 'PUT')[0].body.blocks[0].title).toBe('Typed live');
  });

  test('a section added or removed waits for the full redraw instead', async ({ page }) => {
    const { asked } = await setup(page);
    await page.evaluate(() => (window as any).dcDuplicate(0));
    await page.waitForTimeout(700);
    expect(asked).toHaveLength(0);
  });
});

test.describe('one preview screen', () => {
  const OWN = { '/settings': { data: { pages: [{ slug: 'gallery', title: 'Gallery', blocks: [] }] } } };
  test('Edit mode’s Preview opens it on the page being edited, and Back returns to Edit', async ({ page }) => {
    await mount(page, '/presence.html#design', OWN);
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await expect(page.locator('#dcModeSeg [data-dcmode="preview"]')).toHaveCount(0);
    await page.evaluate(() => (window as any).dcSwitchPage('gallery'));
    await expect(page.locator('#pagesBar .page-pill.on')).toContainText('Gallery');
    const asked = page.waitForRequest((r) => /\/preview\?/.test(r.url()) && /version=draft/.test(r.url()) && /gallery/.test(decodeURIComponent(r.url())));
    await page.evaluate(() => document.getElementById('dcBtnPreview')!.click());
    await asked;
    await expect(page.locator('#stage')).toBeVisible();
    // the shell is hidden in Edit mode, so nothing of the editor shows beside the preview
    expect(await page.locator('#stage').evaluate((n) => { const b = n.getBoundingClientRect(); return [b.left, b.right, b.bottom]; })).toEqual([0, page.viewportSize()!.width, page.viewportSize()!.height]);
    await page.locator('#btnStageClose').click();
    await expect(page.locator('#stage')).toBeHidden();
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
  });
  test('it lists every page of the site, the owner’s own included, and has no template chooser', async ({ page }) => {
    await mount(page, '/presence.html#preview', OWN);
    await expect(page.locator('#stage')).toBeVisible();
    await expect(page.locator('#lookDrawer')).toHaveCount(0);
    await expect(page.locator('#lookSeg button')).toHaveCount(0);
    const pages = await page.locator('#pageWords button').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.page));
    expect(pages).toContain('/gallery/');
    expect(pages[0]).toBe('/');
  });
  test('past dates are for the studio; a client’s Edit bar has Edit and Comments', async ({ page }) => {
    await mount(page, '/presence.html#design');
    await expect(page.locator('#dcModeSeg [data-dcmode="comments"]')).toBeAttached();
    expect(await page.locator('#dcModeSeg [data-dcmode="timewarp"]').evaluate((n) => getComputedStyle(n).display)).toBe('none');
  });
  test('the studio keeps them', async ({ page }) => {
    const ctx = (API['/portal/context'] as any).data;
    await mount(page, '/presence.html#design', { '/portal/context': { data: { ...ctx, is_agency: true } } });
    await expect.poll(() => page.locator('#dcModeSeg [data-dcmode="timewarp"]').evaluate((n) => getComputedStyle(n).display)).not.toBe('none');
  });
});

test.describe('type into the welcome section and About on the canvas', () => {
  const WELCOME = '<!doctype html><html><head><meta charset="utf-8"></head><body><main id="main">'
    + '<section class="hero" data-dds-core="hero"><h1 data-pr="identity.business_name">Marlow’s Kitchen</h1><p class="tagline" data-pr="identity.tagline">A sample line: what you do, in a few words</p><a class="btn" href="/menu/">See the menu</a></section>'
    + '<section class="block" data-dds-core="about"><h2>About us</h2><p data-pr="identity.description">Hello</p></section>'
    + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Your heading</h2></section></main></body></html>';
  const canvas = async (page: Page) => {
    const writes = await mount(page, '/presence.html#design', { __html: WELCOME });
    const frame = page.frameLocator('#designPreview');
    await frame.locator('h1[data-pr]').waitFor();
    await page.waitForLoadState('networkidle');
    return { writes, frame };
  };
  const identityWrites = (writes: Write[]) => writes.filter((w) => w.path === '/identity');

  test('double-click the business name, type, Enter: it saves to Business details, and Undo puts it back', async ({ page }) => {
    const { writes, frame } = await canvas(page);
    const h1 = frame.locator('h1[data-pr="identity.business_name"]');
    await h1.dblclick();
    await expect(h1).toHaveAttribute('contenteditable', /true|plaintext-only/);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Rosa’s Cafe');
    await page.keyboard.press('Enter');
    await expect(h1).not.toHaveAttribute('contenteditable', /.+/);
    await expect(h1).toHaveText('Rosa’s Cafe');
    await expect.poll(() => identityWrites(writes).at(-1)?.body).toEqual({ business_name: 'Rosa’s Cafe' });
    await expect(page.locator('#f-business_name')).toHaveValue('Rosa’s Cafe');
    await page.locator('#btnUndo').click();
    await expect.poll(() => identityWrites(writes).at(-1)?.body).toEqual({ business_name: 'Marlow’s Kitchen' });
  });

  test('Escape puts the words back and saves nothing', async ({ page }) => {
    const { writes, frame } = await canvas(page);
    const p = frame.locator('p[data-pr="identity.description"]');
    await p.dblclick();
    await page.keyboard.type(' and more');
    await page.keyboard.press('Escape');
    await expect(p).toHaveText('Hello');
    await page.waitForTimeout(900);
    expect(identityWrites(writes)).toHaveLength(0);
  });

  test('a sample line is replaced by the first keystroke, and only real words are saved', async ({ page }) => {
    const { writes, frame } = await canvas(page);
    const tag = frame.locator('p[data-pr="identity.tagline"]');
    await tag.dblclick();
    await page.keyboard.type('Fresh pasta, made daily');
    await page.keyboard.press('Enter');
    await expect(tag).toHaveText('Fresh pasta, made daily');
    await expect.poll(() => identityWrites(writes).at(-1)?.body).toEqual({ tagline: 'Fresh pasta, made daily' });
  });

  test('a business keeps its name: clearing it changes nothing', async ({ page }) => {
    const { writes, frame } = await canvas(page);
    const h1 = frame.locator('h1[data-pr="identity.business_name"]');
    await h1.dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await expect(h1).toHaveText('Marlow’s Kitchen');
    await expect(page.getByText('Your business needs a name')).toBeVisible();
    await page.waitForTimeout(900);
    expect(identityWrites(writes)).toHaveLength(0);
  });

  test('the keyboard way: Tab to the words, Enter to type', async ({ page }) => {
    const { writes, frame } = await canvas(page);
    const p = frame.locator('p[data-pr="identity.description"]');
    await p.focus();
    await p.press('Enter');
    await expect(p).toHaveAttribute('contenteditable', /true|plaintext-only/);
    await page.keyboard.press('End');
    await page.keyboard.type(' there');
    await page.keyboard.press('Enter');
    await expect.poll(() => identityWrites(writes).at(-1)?.body).toEqual({ description: 'Hello there' });
  });

  // A slow server: each save of Business details takes most of a second to answer, and the
  // log says when it was asked, when it answered and when the page asked for a drawing.
  const slowDetails = async (page: Page) => {
    const log: string[] = [];
    await page.route('**/functions/v1/presence/identity', async (route: Route) => {
      log.push('save asked'); await new Promise((r) => setTimeout(r, 900)); log.push('save answered'); await route.fallback();
    });
    await page.route('**/functions/v1/presence/preview**', (route: Route) => { log.push('drawing'); return route.fallback(); });
    return log;
  };
  const drawnWhileSaving = (log: string[]) => {
    const from = log.lastIndexOf('save asked'), to = log.lastIndexOf('save answered');
    return log.slice(from, to < from ? undefined : to).filter((x) => x === 'drawing').length;
  };
  const leaveWarns = (page: Page) => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });

  test('a redraw asked for while typing waits, so it neither cuts the words off nor paints the old ones back', async ({ page }) => {
    const { writes, frame } = await canvas(page);
    const log = await slowDetails(page);
    const tag = frame.locator('p[data-pr="identity.tagline"]');
    await tag.dblclick();
    await page.keyboard.type('Fresh');
    await page.evaluate(() => (window as any).refreshDesignPreview());   // as when a panel's save lands mid-word
    await page.waitForTimeout(700);
    await expect(tag).toHaveAttribute('contenteditable', /true|plaintext-only/);
    await page.keyboard.type(' pasta');
    await page.keyboard.press('Enter');
    await expect.poll(() => identityWrites(writes).at(-1)?.body).toEqual({ tagline: 'Fresh pasta' });
    await expect.poll(() => log.slice(log.lastIndexOf('save answered')).includes('drawing')).toBe(true);   // the held redraw comes after the save
    expect(drawnWhileSaving(log)).toBe(0);
  });

  test('Preview right after Enter waits for the words, so it shows them', async ({ page }) => {
    test.skip(isPhone(page), 'Edit mode’s Preview button is in the desktop bar');
    const { writes, frame } = await canvas(page);
    const log = await slowDetails(page);
    const tag = frame.locator('p[data-pr="identity.tagline"]');
    await tag.dblclick();
    await page.keyboard.type('Fresh pasta');
    await page.keyboard.press('Enter');
    await page.locator('#dcBtnPreview').click();
    await expect(page.locator('#stage')).toHaveClass(/\bon\b/);
    await expect.poll(() => log.slice(log.lastIndexOf('save answered')).includes('drawing')).toBe(true);
    expect(drawnWhileSaving(log)).toBe(0);
    expect(identityWrites(writes).at(-1)?.body).toEqual({ tagline: 'Fresh pasta' });
  });

  test('a second double-click before the save answers keeps the new words', async ({ page }) => {
    const { writes, frame } = await canvas(page);
    await slowDetails(page);
    const tag = frame.locator('p[data-pr="identity.tagline"]');
    await tag.dblclick();
    await page.keyboard.type('Fresh pasta');
    await page.keyboard.press('Enter');
    await tag.dblclick();   // the saved copy still says "no tagline"; the words on screen are real now
    await page.keyboard.type('X');
    await page.keyboard.press('Enter');
    await expect.poll(() => identityWrites(writes).length).toBe(2);
    const last = identityWrites(writes).at(-1)!.body.tagline as string;
    expect(last).not.toBe('X');
    expect(last.startsWith('Fresh')).toBe(true);
  });

  test('closing the tab warns while typed words are still on their way', async ({ page }) => {
    const { writes, frame } = await canvas(page);
    await slowDetails(page);
    expect(await leaveWarns(page)).toBe(false);
    const tag = frame.locator('p[data-pr="identity.tagline"]');
    await tag.dblclick();
    await page.keyboard.type('Fresh pasta');
    expect(await leaveWarns(page)).toBe(true);    // typed, not yet handed over
    await page.keyboard.press('Enter');
    expect(await leaveWarns(page)).toBe(true);    // on its way
    await expect.poll(() => identityWrites(writes).length).toBe(1);
    await expect.poll(() => leaveWarns(page)).toBe(false);
    // the same for Business details typed in its own form, inside the form's pause
    await page.evaluate(() => { const i = document.getElementById('f-service_area') as HTMLInputElement; i.value = 'Burbank'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(await leaveWarns(page)).toBe(true);
  });

  test('the rest of a built-in section still says where its words live', async ({ page }) => {
    const { writes, frame } = await canvas(page);
    await frame.locator('section[data-dds-core="about"] h2').dblclick();
    await expect(page.getByText('These words come from your')).toBeVisible();
    expect(identityWrites(writes)).toHaveLength(0);
  });
});

test.describe('Styles show on the page at once, and save behind', () => {
  // A slow server: a style save takes most of a second to answer. The log says when the
  // page asked for a drawing of the canvas.
  const styles = async (page: Page, api: Record<string, unknown> = {}, fail = false) => {
    const writes = await mount(page, '/presence.html#design', api);
    const frame = page.frameLocator('#designPreview');
    await frame.locator('#main > section').first().waitFor();
    await page.waitForLoadState('networkidle');
    const log: string[] = [];
    await page.route('**/functions/v1/presence/dev/customization', async (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      log.push('save asked'); await new Promise((r) => setTimeout(r, 900)); log.push('save answered');
      if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Nothing was lost — that just didn’t go through. Try once more.' }) });
      return route.fallback();
    });
    await page.route('**/functions/v1/presence/preview**', (route: Route) => { log.push('drawing'); return route.fallback(); });
    await page.locator('#btnSettingsOpen').click();
    await expect(page.locator('#designCard')).toBeVisible();
    const pick = (name: string) => page.locator('#designCard').getByRole('button', { name, exact: true }).click();
    const cssVar = (name: string) => frame.locator('html').evaluate((h, n) => getComputedStyle(h).getPropertyValue(n).trim(), name);
    const saves = () => writes.filter((w) => w.path === '/dev/customization').map((w) => w.body.theme_tokens);
    return { writes, log, pick, cssVar, saves };
  };

  test('a colour shows on the canvas before its save answers, saves once, and the page isn’t redrawn', async ({ page }) => {
    const { log, pick, cssVar, saves } = await styles(page);
    await pick('Evergreen');
    await expect.poll(() => cssVar('--accent')).toBe('#23635a');
    expect(log).not.toContain('save answered');                  // shown before the save came back
    await expect.poll(saves).toEqual([{ accent: '#23635a', accent_dark: '#17453f', ink: '#1c2430', soft: '#5b6572' }]);
    await page.waitForTimeout(800);                               // past the redraw's own pause
    expect(log.filter((x) => x === 'drawing')).toHaveLength(0);
    expect(await cssVar('--accent-dark')).toBe('#17453f');        // the dashed name the templates read, as the server writes it
    await expect(page.locator('#designCard').getByRole('button', { name: 'Evergreen ✓' })).toBeVisible();
  });

  test('two quick picks keep both', async ({ page }) => {
    const { pick, cssVar, saves } = await styles(page);
    await pick('Evergreen');
    await pick('Understated mono');
    await expect.poll(() => cssVar('--font-display')).toContain('Courier New');
    expect(await cssVar('--accent')).toBe('#23635a');
    await expect.poll(() => saves().length).toBe(2);
    expect(saves()[1]).toMatchObject({ accent: '#23635a', font_display: "'Courier New', ui-monospace, monospace" });
  });

  test('a save that fails puts the page back as it was', async ({ page }) => {
    const { pick, cssVar } = await styles(page, {}, true);
    await pick('Evergreen');
    await expect.poll(() => cssVar('--accent')).toBe('#23635a');
    await expect.poll(() => cssVar('--accent'), { timeout: 6000 }).toBe('#111111');   // the colour the site had
    await expect(page.locator('#designCard').getByRole('button', { name: 'Evergreen', exact: true })).toBeVisible();
  });

  test('Original clears the choice, so the template’s own colour shows again', async ({ page }) => {
    const { pick, cssVar, saves } = await styles(page);
    await pick('Evergreen');
    await expect.poll(saves).toHaveLength(1);
    await page.locator('#designCard').getByRole('button', { name: 'Original', exact: true }).first().click();   // the Colors row's Original
    await expect.poll(() => cssVar('--accent')).toBe('');
    await expect.poll(() => saves().length).toBe(2);
    expect(saves()[1]).toEqual({});
  });

  test('More fonts: a family picked for headings loads on the canvas at once and saves as a style token', async ({ page }) => {
    const LIB = [
      { id: 'playfair-display', family: 'Playfair Display', css: 'Playfair Display', kind: 'serif', weights: [400, 700], fallback: 'Georgia, serif' },
      { id: 'inter', family: 'Inter', css: 'Inter', kind: 'sans', weights: [400, 700], fallback: 'system-ui, sans-serif' },
    ];
    const { pick, saves } = await styles(page, { '/dev/customization': { data: { theme_tokens: { accent: '#111111' }, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false, font_library: LIB } } });
    await page.locator('#designCard summary', { hasText: 'More fonts' }).click();
    const headings = page.locator('#designCard [aria-label="Headings font"]');
    const pf = headings.getByRole('button', { name: 'Playfair Display' });
    await expect(pf).toBeVisible();
    expect(await pf.evaluate((b) => getComputedStyle(b).fontFamily)).toContain('Playfair Display');   // each name in its own face
    await pf.click();
    const frame = page.frameLocator('#designPreview');
    await expect.poll(() => frame.locator('#presence-dev').evaluate((st) => st.textContent || '')).toContain("@font-face{font-family:'Playfair Display';src:url(/fonts/library/playfair-display-400.woff2)");
    const loaded = await frame.locator('html').evaluate(async () => (await document.fonts.load("700 32px 'Playfair Display'")).length);
    expect(loaded).toBeGreaterThan(0);                                   // the file is really there, and really a font
    await expect.poll(saves).toEqual([{ accent: '#111111', font_display: 'Playfair Display, Georgia, serif' }]);
    await expect(page.locator('#designCard [aria-label="Headings font"]').getByRole('button', { name: 'Playfair Display ✓' })).toBeVisible();   // still open after the card redraws
    await expect(page.locator('#designCard [aria-label="Body text font"]').getByRole('button', { name: 'Inter', exact: true })).toHaveAttribute('aria-pressed', 'false');
    void pick;
  });

  test('on Slate the colour choices are left out, and the panel says why', async ({ page }) => {
    await styles(page, { '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'slate', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen', description: 'Hello' }, location: { city: 'Burbank' } } } });
    await expect(page.locator('#designCard')).toContainText('keeps its own dark colors');
    await expect(page.locator('#designCard').getByRole('button', { name: 'Evergreen', exact: true })).toHaveCount(0);
    await expect(page.locator('#designCard').getByRole('button', { name: 'Understated mono', exact: true })).toBeVisible();
  });
});

test.describe('Publish waits for what was just typed', () => {
  test('a section edit still saving when Publish is pressed lands before the review reads', async ({ page }) => {
    const writes = await mount(page, '/presence.html#design');
    const frame = page.frameLocator('#designPreview');
    await frame.locator('#a h2[data-dds-field="title"]').waitFor();
    await page.waitForLoadState('networkidle');
    const log: string[] = [];
    await page.route('**/functions/v1/presence/settings**', async (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      log.push('save asked'); await new Promise((r) => setTimeout(r, 900)); log.push('save answered'); await route.fallback();
    });
    await page.route('**/functions/v1/presence/changes**', (route: Route) => { log.push('review read'); return route.fallback(); });
    const h2 = frame.locator('#a h2[data-dds-field="title"]');
    await h2.dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Fresh heading');
    await page.keyboard.press('Enter');
    log.push('publish opened');
    await page.evaluate(() => { (window as any).openRitual(); });   // at once, inside the save's pause
    await expect(page.locator('#ritTitle')).not.toHaveText('One moment.');
    await expect.poll(() => log.includes('save answered')).toBe(true);
    const firstRead = log.indexOf('review read', log.indexOf('publish opened'));
    expect(firstRead).toBeGreaterThan(log.indexOf('save answered'));
    const saved = writes.filter((w) => w.path === '/settings' && w.body && Array.isArray(w.body.blocks));
    expect(saved.at(-1)!.body.blocks[0].title).toBe('Fresh heading');
  });
});

test.describe('Undo takes back a menu-category move', () => {
  test('move a category earlier, then Undo: the order goes back', async ({ page }) => {
    const writes = await mount(page, '/presence.html#offerings', { '/offerings': { data: [
      { id: 'o1', name: 'Soup', category: 'Starters', price_text: '$5', description: '', is_visible: true, sort_order: 0 },
      { id: 'o2', name: 'Steak', category: 'Mains', price_text: '$25', description: '', is_visible: true, sort_order: 1 },
    ] } });
    const orders = () => writes.filter((w) => w.path === '/settings' && w.body && 'category_order' in w.body).map((w) => w.body.category_order);
    await page.getByRole('button', { name: 'Move Mains earlier' }).click();
    await expect.poll(orders).toEqual([['Mains', 'Starters']]);
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(orders).toEqual([['Mains', 'Starters'], []]);   // the usual order, as before any move
  });
});

test.describe('move the welcome section among the others', () => {
  const page_ = (movable: boolean) => '<!doctype html><html><head><meta charset="utf-8"></head><body><main id="main">'
    + '<section class="hero" data-dds-core="hero"' + (movable ? ' data-dds-movable' : '') + '><h1 data-pr="identity.business_name">Marlow’s Kitchen</h1></section>'
    + '<section class="block" data-dds-core="about"><h2>About us</h2><p data-pr="identity.description">Hello</p></section>'
    + '<section class="block alt" data-dds-core="offerings"><h2>Menu</h2></section>'
    + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Your heading</h2></section></main></body></html>';
  const canvas = async (page: Page, movable: boolean) => {
    const writes = await mount(page, '/presence.html#design', { __html: page_(movable) });
    const frame = page.frameLocator('#designPreview');
    await frame.locator('h1[data-pr]').waitFor();
    await expect(frame.locator('#dds-dc-bar')).toBeAttached();
    await page.waitForLoadState('networkidle');
    return { writes, frame };
  };
  const orders = (writes: Write[]) => writes.filter((w) => w.path === '/settings' && w.body && 'sections_order' in w.body).map((w) => w.body.sections_order);
  const barButton = (frame: ReturnType<Page['frameLocator']>, label: string) => frame.locator(`#dds-dc-bar button[aria-label="${label}"]`);

  test('the welcome section’s own toolbar moves it below About: one write, in the order the site reads', async ({ page }) => {
    const { writes, frame } = await canvas(page, true);
    await frame.locator('section[data-dds-core="hero"]').hover();
    await expect(barButton(frame, 'Move this section up')).toHaveClass(/dc-off/);   // already at the top
    await barButton(frame, 'Move this section down').click();
    await expect.poll(() => orders(writes)).toEqual([['about', 'hero', 'offerings', 'testimonials', 'faqs']]);
    await page.locator('#btnUndo').click();
    await expect.poll(() => orders(writes).at(-1)).toEqual([]);   // back to the usual order on a site that had none saved
  });

  test('a built-in section moves past its visible neighbour, and the last one can’t go further down', async ({ page }) => {
    const { writes, frame } = await canvas(page, true);
    await frame.locator('section[data-dds-core="about"]').hover();
    await barButton(frame, 'Move this section down').click();
    await expect.poll(() => orders(writes)).toEqual([['hero', 'offerings', 'about', 'testimonials', 'faqs']]);
    await frame.locator('section[data-dds-core="offerings"]').hover();
    await expect(barButton(frame, 'Move this section down')).toHaveClass(/dc-off/);   // added sections follow the built-in ones
  });

  test('on a template that keeps the welcome section on top, it has no arrows and nothing goes above it', async ({ page }) => {
    const { writes, frame } = await canvas(page, false);
    await frame.locator('section[data-dds-core="hero"]').hover();
    await expect(frame.locator('#dds-dc-bar')).toHaveClass(/\bon\b/);
    await expect(barButton(frame, 'Move this section down')).toHaveCount(0);
    await frame.locator('section[data-dds-core="about"]').hover();
    await expect(barButton(frame, 'Move this section up')).toHaveClass(/dc-off/);
    // the Styles list says the same
    const row = (name: string) => page.locator('#sectionsCard > div').filter({ hasText: name });
    await expect(row('Welcome').locator('button')).toHaveCount(2);
    await expect(row('Welcome').locator('button').first()).toBeDisabled();
    await expect(row('Welcome').locator('button').last()).toBeDisabled();
    await expect(row('About').locator('button').first()).toBeDisabled();
    await expect(row('About').locator('button').last()).toBeEnabled();
    expect(orders(writes)).toHaveLength(0);
  });

  test('the left list moves built-in sections too, and keeps the button in focus after the redraw', async ({ page }) => {
    const { writes } = await canvas(page, true);
    await page.evaluate(() => (window as any).openTrayPanel('contents'));   // the list's panel starts closed
    const row = page.locator('#designTreeList .dc-tree-row[data-core="about"]');
    await row.hover();
    await row.locator('button[aria-label="Move down"]').click();
    await expect.poll(() => orders(writes)).toEqual([['hero', 'offerings', 'about', 'testimonials', 'faqs']]);
    await expect(page.locator('#designTreeList .dc-tree-row[data-core="about"] button[aria-label="Move down"]')).toBeFocused();
  });
});

test.describe('the welcome list', () => {
  const SHOWN = { '/commerce/first-run': { data: { dismissed: false } } };   // the owner hasn't hidden it
  const status = (offline: string | null) => ({ draft: { unpublished_changes: 0 }, preview: { exists: false }, live: { published: true, last_published_at: '2026-10-30T15:00:00Z', offline_since: offline } });
  const PUBLISHED = { '/site': { data: { site: { ...ALL_SET['/site'].data.site }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } } };

  test('it counts what the site already has, goes straight to each step, and a step ticks itself once done', async ({ page }) => {
    const writes = await mount(page, '/presence.html', { ...CHANGES(0), ...SHOWN });
    const line = page.locator('#ssTodo');
    await expect(line).toContainText('Set up your site · 2 of 8');   // the fixture's city and its one offering
    await line.click();
    const card = page.locator('#setupCard');
    await expect(card.locator('h2')).toHaveText('Set up your site');
    await expect(card.locator('.meta')).toHaveText('2 of 8 done');
    await expect(card.locator('.hb-progress')).toHaveAttribute('aria-valuenow', '2');
    await expect(card.locator('.hb-task.done')).toHaveCount(2);
    await expect(card.locator('[data-step="address"]')).toHaveClass(/\bdone\b/);
    await expect(card.locator('[data-step="offerings"]')).toContainText('Add your services');   // the business's own word
    await expect(card.locator('.hb-task.just')).toHaveCount(0);   // done before you looked: nothing to tick
    await card.locator('[data-step="details"]').click();
    await expect(page.locator('#todoPanel')).toBeHidden();
    await expect(page.locator('#view-business')).toBeVisible();
    await expect(page.locator('#f-phone')).toBeFocused();   // the name is there, so the way to reach you is what's missing
    await page.locator('#f-phone').fill('555-0100');
    await expect.poll(() => writes.some((w) => w.path === '/identity' && w.body && w.body.phone === '555-0100')).toBe(true);
    await expect(line).toContainText('3 of 8');
    await page.evaluate(() => (window as any).go('today'));
    await line.click();
    await expect(card.locator('.meta')).toHaveText('3 of 8 done');
    await expect(card.locator('[data-step="details"]')).toHaveClass(/\bdone\b/);
    await expect(card.locator('[data-step="details"]')).toHaveClass(/\bjust\b/);   // done since you last looked: it ticks in front of you
  });

  test('a site never published is Private, with one Publish button', async ({ page }) => {
    await mount(page, '/presence.html', { ...CHANGES(0), ...SHOWN });
    await page.locator('#ssTodo').click();
    await expect(page.locator('#todoPanel .dc-panel-t')).toHaveText('Your site');
    await expect(page.locator('#siteStatusBadge')).toHaveText('Private');
    await expect(page.locator('#siteStatusCard')).toContainText('Only you can see it');
    await expect(page.locator('#siteStatusBtn')).toHaveText('Publish');
    await page.locator('#siteStatusBtn').click();
    await expect(page.locator('#ritualWrap')).toHaveClass(/\bon\b/);
  });

  test('a live site is Public, shows its address, and can be taken offline', async ({ page }) => {
    const writes = await mount(page, '/presence.html', { ...CHANGES(0), ...SHOWN, ...PUBLISHED });
    await page.route('**/functions/v1/presence/preview/status', (r) => r.fulfill({ json: { data: status(null) } }));
    await page.locator('#ssTodo').click();
    await expect(page.locator('#siteStatusBadge')).toHaveText('Public');
    await expect(page.locator('#siteStatusCard a')).toHaveText('marlows.example');
    await expect(page.locator('#siteStatusCard a')).toHaveAttribute('href', 'https://marlows.example');
    await expect(page.locator('#setupCard [data-step="publish"]')).toHaveClass(/\bdone\b/);
    page.once('dialog', (d) => d.accept());
    await page.locator('#siteStatusBtn').click();
    await expect.poll(() => writes.some((w) => w.method === 'POST' && w.path === '/site/offline')).toBe(true);
  });

  test('a site taken offline says so and brings itself back with one button', async ({ page }) => {
    const writes = await mount(page, '/presence.html', { ...CHANGES(0), ...SHOWN, ...PUBLISHED });
    let off: string | null = '2026-11-01T10:00:00Z';
    await page.route('**/functions/v1/presence/preview/status', (r) => r.fulfill({ json: { data: status(off) } }));
    await page.locator('#ssTodo').click();
    await expect(page.locator('#siteStatusBadge')).toHaveText('Offline');
    await expect(page.locator('#siteStatusCard a')).toHaveCount(0);
    off = null;
    await page.getByRole('button', { name: 'Bring back online' }).click();
    await expect.poll(() => writes.some((w) => w.method === 'POST' && w.path === '/site/online')).toBe(true);
    await expect(page.locator('#siteStatusBadge')).toHaveText('Public');
  });

  test('the owner can hide it, and it stays hidden', async ({ page }) => {
    const writes = await mount(page, '/presence.html', { ...CHANGES(0), ...SHOWN });
    await page.locator('#ssTodo').click();
    await page.getByRole('button', { name: 'Hide this list' }).click();
    await expect(page.locator('#setupCard')).toBeHidden();
    await expect(page.locator('#ssTodo')).toBeHidden();
    await expect.poll(() => writes.some((w) => w.method === 'POST' && w.path === '/commerce/first-run/dismiss')).toBe(true);
  });

  test('hidden before, no list', async ({ page }) => {
    await mount(page, '/presence.html', { ...CHANGES(0), '/commerce/first-run': { data: { dismissed: true } } });
    await expect(page.frameLocator('#siteFrame').locator('h1').first()).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.locator('#ssTodo')).toBeHidden();
  });

  test('the studio’s own site is a practice site: no list', async ({ page }) => {
    await mount(page, '/presence.html', { ...CHANGES(0), ...SHOWN, '/portal/context': { data: { ...(API['/portal/context'] as any).data, is_agency: true } } });
    await expect(page.frameLocator('#siteFrame').locator('h1').first()).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.locator('#ssTodo')).toBeHidden();
  });
});
