import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder item 190, second half (Nov 12 review, file 06, finding 1): the editor's page frames
// are walled off from the app, so a drawn page can't reach the signed-in session. The drawn page
// below carries what a Developer's custom HTML might smuggle past the cleaner: an image's
// onerror, an SVG's onload, a javascript: link and a <script>, each trying to touch the app's
// window. Edit's canvas and the Overview run none of the page's scripts (the editor's own tools
// still work there); Preview runs them, as a visitor's browser would, in a frame with no origin
// that can't reach the app. (The cleaner itself is tests/presence/devmode_test.mjs.)
const TOUCH = (what: string) => `parent.__ran=(parent.__ran||[]).concat('${what}')`;
const HOSTILE = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}section{padding:56px 24px;min-height:320px}</style></head><body>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1><a id="about" href="/about/">About us</a></section>'
  + '<section id="a" class="block block-title" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0"><h2 data-dds-field="title">Fresh bread</h2>'
  + `<img id="bad" src="x-not-there.png" alt="" onerror="${TOUCH('img')}">`
  + `<svg width="10" height="10" onload="${TOUCH('svg')}"><rect width="10" height="10"/></svg>`
  + `<a id="js" href="javascript:${TOUCH('link')}">a link</a></section></main>`
  // the page's own script: it marks the page it ran in, and tries to read the app
  + `<script>document.body.setAttribute('data-own','ran');try{document.body.setAttribute('data-reach',String(parent.document.title));${TOUCH('script')}}catch(e){document.body.setAttribute('data-reach','blocked')}</script>`
  + '</body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/notes': { data: [] }, '/moments': { data: [] }, '/health': { data: {} },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/settings': { data: { blocks: [{ type: 'title', title: 'Fresh bread' }], section_meta: { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} } } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
async function mount(page: Page, hash: string) {
  await installApp(page, { api: API });
  const pages: string[] = [];
  await page.route('**/functions/v1/presence/preview**', (route: Route) => {
    pages.push(new URL(route.request().url()).searchParams.get('page') || '/');
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HOSTILE });
  });
  await page.route('**/functions/v1/presence/**', (route: Route) => route.request().method() === 'GET' ? route.fallback()
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1, 'publish-atomic': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html' + hash);
  return { pages };
}
const touched = (page: Page) => page.evaluate(() => (window as unknown as { __ran?: string[] }).__ran || []);

test('Edit’s canvas runs none of the drawn page’s scripts, and the editor still works on it', async ({ page }) => {
  await mount(page, '#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  const frame = page.frameLocator('#designPreview');
  await expect(frame.locator('#dds-dc-bar')).toBeAttached();
  await expect(frame.locator('#a h2')).toHaveText('Fresh bread');
  await page.waitForTimeout(600);   // the broken image has failed by now, and the SVG has loaded
  await frame.locator('#js').click({ force: true }).catch(() => { /* the editor may keep the click */ });
  await page.waitForTimeout(300);
  expect(await touched(page)).toEqual([]);
  await expect(frame.locator('body')).not.toHaveAttribute('data-own', 'ran');
  // the editor's own tools still answer on the page (WebKit drops them in a script-less sandbox)
  const phone = (page.viewportSize()?.width || 1200) < 768;
  if (phone) await frame.locator('#a').tap({ position: { x: 40, y: 20 } }); else await frame.locator('#a h2').hover();
  await expect(frame.locator('#dds-dc-bar')).toHaveClass(/\bon\b/);
});

test('the Overview runs none of them either', async ({ page }) => {
  await mount(page, '');
  const frame = page.frameLocator('#siteFrame');
  await expect(frame.locator('#a h2')).toHaveText('Fresh bread');
  await page.waitForTimeout(600);
  expect(await touched(page)).toEqual([]);
  await expect(frame.locator('body')).not.toHaveAttribute('data-own', 'ran');
});

test('Preview runs the page as a visitor’s browser would, in a frame that can’t reach the app', async ({ page }) => {
  const { pages } = await mount(page, '#preview');
  const frame = page.frameLocator('#previewFrame');
  await expect(frame.locator('#a h2')).toHaveText('Fresh bread');
  await expect(frame.locator('body')).toHaveAttribute('data-own', 'ran');      // the page's own script ran
  await expect(frame.locator('body')).toHaveAttribute('data-reach', 'blocked'); // and couldn't read the app
  await page.waitForTimeout(600);
  expect(await touched(page)).toEqual([]);
  // the page still walks the site: a link inside it asks the editor for that page, by message
  const before = pages.length;
  await frame.locator('#about').click();
  await expect.poll(() => pages.slice(before)).toContain('/about/');
});

test('a message from anywhere but the Preview page is ignored', async ({ page }) => {
  const { pages } = await mount(page, '#preview');
  await expect(page.frameLocator('#previewFrame').locator('#a h2')).toHaveText('Fresh bread');
  const before = pages.length;
  await page.evaluate(() => window.postMessage({ presenceNav: '/elsewhere/' }, '*'));
  await page.waitForTimeout(800);
  expect(pages.slice(before)).not.toContain('/elsewhere/');
});
