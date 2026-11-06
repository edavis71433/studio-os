import { test, expect, Page, Route } from '@playwright/test';
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
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.goto(url);
  return writes;
}
const isPhone = (page: Page) => page.viewportSize()!.width <= 760;
const SITE_HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><header><nav><a href="/">Home</a> <a href="/about/">About</a> <a href="/visit/">Visit</a> <a href="https://elsewhere.example/">Off site</a></nav></header><main id="main"><h1>Marlow’s Kitchen</h1></main><div id="presence-preview-badge" style="position:fixed;bottom:0;left:0;right:0">Preview of this site</div></body></html>';
const CHANGES = (blockers: number) => ({ '/changes': { data: { count: 1, first_publish: false, changes: [{ section: 'business', sentence: 'x' }], blockers, warnings: 0, draft_hash: 'h' } } });

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
    await mount(page, '/presence.html', CHANGES(0));
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
  test('the site stops above the dock', async ({ page }) => {
    await mount(page, '/presence.html');
    await expect(page.frameLocator('#siteFrame').locator('h1').first()).toBeVisible();
    const stage = (await page.locator('#siteStage').boundingBox())!;
    const dock = (await page.locator('#dock').boundingBox())!;
    expect(stage.y + stage.height).toBeLessThanOrEqual(dock.y);
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
