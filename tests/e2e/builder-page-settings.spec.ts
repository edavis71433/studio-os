import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { newPageLock, gatePage, sealPage } from '../../supabase/functions/presence/lib/page_gate';

// One page's settings in the Pages card (builder list items 48 and 120, Nov 2026; Figma
// "A · Page settings"): the page, who can see it, header and footer, the menu, and how it shows
// on Google, with the search headline and description counting beside their names. Who can see
// it is three cards: Everyone, Password (asked for first, kept only as a key on the server) and
// Private (kept off the live site). The header and footer are two switches. Then the visitor's
// side: the password box a sealed page shows, opened in each browser.
const BLOCKS = [{ type: 'title', title: 'Your heading', subtitle: 'A quiet sub line' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><style>section{padding:48px 24px}</style></head><body>'
  + '<header class="site"><b>Marlow’s Kitchen</b></header>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Your heading</h2></section></main></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1, netlify_site_id: 'abc' };
const LOCK = '11111111-2222-4333-8444-555555555555';
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen', description: 'Fresh bread every morning in Burbank since 2014.' }, location: { city: 'Burbank' } } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/page-locks': { data: { ids: [], ready: true } },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
type Own = { slug: string; title: string; blocks: unknown[]; hideNav?: boolean; access?: string; lock?: string; noHeader?: boolean; noFooter?: boolean };
const OWN: Own[] = [
  { slug: 'gallery', title: 'Gallery', blocks: [] },
  { slug: 'landing', title: 'Landing', blocks: [], hideNav: true, noHeader: true, noFooter: true },
];
type Write = { method: string; path: string; body: any };
async function mount(page: Page, opts: { pages?: Own[]; api?: Record<string, unknown> } = {}) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META, pages: opts.pages ?? OWN };
  await installApp(page, { api: { ...API, ...(opts.api || {}), '/settings': { data: settings } } });
  const writes: Write[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/settings') { settings = { ...settings, ...body }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) }); }
    if (path === '/page-locks') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: LOCK } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return writes;
}
const card = (page: Page) => page.locator('#pagesCard');
const crow = (page: Page, name: string) => page.locator('#pagesCard .pc-row').filter({ has: page.locator('.pp-name', { hasText: new RegExp(`^${name}$`) }) });
async function openSettings(page: Page, name: string) {
  await page.locator('#dcPageSwitch').click();
  await expect(card(page)).toHaveClass(/\bon\b/);
  await crow(page, name).locator('.pg-gear').click();
  const panel = card(page).locator('#pageSettings');
  await expect(panel).toBeVisible();
  return panel;
}
const pagesWrites = (writes: Write[]) => writes.filter((w) => w.path === '/settings' && w.body.pages);
const pageIn = (w: Write | undefined, slug: string) => (w?.body.pages || []).find((p: Own) => p.slug === slug);
const accessCard = (panel: ReturnType<Page['locator']>, name: string) => panel.locator('.pg-acc').filter({ hasText: name });

test.describe('one page’s settings (builder items 48 and 120)', () => {
  test('an own page: the page, who can see it, header and footer, menu and Google, in that order; counts beside the names', async ({ page }) => {
    const writes = await mount(page);
    const panel = await openSettings(page, 'Gallery');
    await expect(panel.getByRole('heading', { name: 'Gallery settings' })).toBeVisible();
    await expect(panel.getByLabel('Page name')).toBeFocused();   // the first field still takes the cursor
    await expect(panel.locator('.pg-where')).toHaveText(/\/gallery\/$/);
    expect(await panel.locator('h4.pg-h').allTextContents()).toEqual(['Page', 'Who can see it', 'Header and footer', 'Menu', 'On Google']);
    // three cards, Everyone picked, and the sentence for it
    expect(await panel.locator('.pg-acc').allTextContents()).toEqual(['Everyone', 'Password', 'Private']);
    await expect(accessCard(panel, 'Everyone')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('[data-group="access"] .pg-says')).toHaveText('Everyone can see this page once you publish.');
    await expect(panel.getByLabel('Show the header')).toBeChecked();
    await expect(panel.getByLabel('Show the footer')).toBeChecked();
    // the headline and description count as they're typed, beside their names
    const count = panel.locator('#cnt-page-gallery-title');
    await expect(count).toHaveText(/^Empty — Google shows/);
    await panel.getByLabel('Search headline for Gallery').fill('Our bakes, in pictures');
    await expect(count).toHaveText('22 of 60');
    await expect(count).toHaveClass(/good/);
    const lab = await panel.locator('.pg-lrow').first().boundingBox(), cnt = await count.boundingBox();
    expect(Math.abs((cnt!.y + cnt!.height / 2) - (lab!.y + lab!.height / 2))).toBeLessThan(12);   // on the name's line, not under the field
    await panel.getByLabel('Search description for Gallery').fill('Short');
    await expect(panel.locator('#cnt-page-gallery-description')).toContainText('5 of 160 — a little short');
    // the share fields have names of their own now
    await expect(panel.getByLabel('Share headline')).toHaveAttribute('placeholder', 'Same as the search headline');
    await expect(panel.getByLabel('Share picture for Gallery')).toBeVisible();
    expect(pagesWrites(writes)).toHaveLength(0);   // looking and typing in a field not yet left wrote nothing
  });

  test('Private is one press: saved on the page, said in a sentence, a chip on its row; Everyone takes it back', async ({ page }) => {
    const writes = await mount(page);
    const panel = await openSettings(page, 'Gallery');
    await accessCard(panel, 'Private').click();
    await expect.poll(() => pageIn(pagesWrites(writes).at(-1), 'gallery')?.access).toBe('private');
    await expect(accessCard(panel, 'Private')).toHaveAttribute('aria-pressed', 'true');
    await expect(accessCard(panel, 'Private')).toBeFocused();
    await expect(panel.locator('[data-group="access"] .pg-says')).toContainText('isn’t on your live site, in its menu or on Google');
    expect(pageIn(pagesWrites(writes).at(-1), 'landing')).toMatchObject({ noHeader: true, noFooter: true, hideNav: true });   // the other page is untouched
    await card(page).locator('#pcBack').click();
    await expect(crow(page, 'Gallery').locator('.pc-access')).toHaveText('Private');
    await crow(page, 'Gallery').locator('.pg-gear').click();
    await accessCard(card(page).locator('#pageSettings'), 'Everyone').click();
    await expect.poll(() => pagesWrites(writes).length).toBe(2);
    expect(pageIn(pagesWrites(writes).at(-1), 'gallery')).not.toHaveProperty('access');
    await card(page).locator('#pcBack').click();
    await expect(crow(page, 'Gallery').locator('.pc-access')).toHaveCount(0);
  });

  test('Password asks first: nothing changes until it’s saved, the password goes to the server once, and the page names its lock', async ({ page }) => {
    const writes = await mount(page);
    const panel = await openSettings(page, 'Gallery');
    await accessCard(panel, 'Password').click();
    const pw = panel.getByLabel('Password', { exact: true });
    await expect(pw).toBeFocused();
    await expect(pw).toHaveAttribute('type', 'password');
    expect(pagesWrites(writes)).toHaveLength(0);                          // picking it alone changes nothing
    await expect(panel.locator('[data-group="access"]')).toContainText('It keeps casual visitors out, not secrets');   // item 204
    await pw.fill('letmein');
    await panel.getByRole('button', { name: 'Save password' }).click();
    await expect(panel.locator('[data-group="access"] .pg-err')).toHaveText('Use at least 8 letters or numbers.');   // item 204: seven is too few
    expect(writes.filter((w) => w.path === '/page-locks')).toHaveLength(0);
    await panel.getByRole('button', { name: 'Show' }).click();
    await expect(panel.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await panel.getByLabel('Password', { exact: true }).fill('open sesame');
    await panel.getByLabel('Password', { exact: true }).press('Enter');
    await expect.poll(() => pageIn(pagesWrites(writes).at(-1), 'gallery')).toMatchObject({ access: 'password', lock: LOCK });
    const locks = writes.filter((w) => w.path === '/page-locks');
    expect(locks).toEqual([{ method: 'POST', path: '/page-locks', body: { password: 'open sesame' } }]);
    expect(JSON.stringify(pagesWrites(writes))).not.toContain('sesame');   // the page holds the lock, never the password
    await expect(panel.locator('.pg-saved .hb-chip')).toHaveText('Password saved');
    await expect(accessCard(panel, 'Password')).toHaveAttribute('aria-pressed', 'true');
    await card(page).locator('#pcBack').click();
    await expect(crow(page, 'Gallery').locator('.pc-access')).toHaveText('Password');
  });

  test('a password the page had comes back without being typed again; Cancel leaves things as they were', async ({ page }) => {
    const writes = await mount(page, { pages: [{ slug: 'gallery', title: 'Gallery', blocks: [], lock: LOCK }], api: { '/page-locks': { data: { ids: [LOCK], ready: true } } } });
    const panel = await openSettings(page, 'Gallery');
    await accessCard(panel, 'Password').click();
    await expect.poll(() => pageIn(pagesWrites(writes).at(-1), 'gallery')).toMatchObject({ access: 'password', lock: LOCK });
    expect(writes.filter((w) => w.path === '/page-locks')).toHaveLength(0);
    await panel.getByRole('button', { name: 'Change password' }).click();
    await expect(panel.getByLabel('Password', { exact: true })).toBeFocused();
    await panel.getByRole('button', { name: 'Cancel' }).click();
    await expect(panel.getByLabel('Password', { exact: true })).toHaveCount(0);
    await expect(accessCard(panel, 'Password')).toHaveAttribute('aria-pressed', 'true');
    expect(pagesWrites(writes)).toHaveLength(1);
  });

  test('a password page whose key is gone asks for a new one', async ({ page }) => {
    const writes = await mount(page, { pages: [{ slug: 'gallery', title: 'Gallery', blocks: [], lock: LOCK }] });   // the server has no such lock
    const panel = await openSettings(page, 'Gallery');
    await accessCard(panel, 'Password').click();
    await expect(panel.getByLabel('Password', { exact: true })).toBeFocused();
    expect(pagesWrites(writes)).toHaveLength(0);
  });

  test('the header and footer switches save on the page, one at a time, and a landing page says so on its row', async ({ page }) => {
    const writes = await mount(page);
    await page.locator('#dcPageSwitch').click();
    await expect(crow(page, 'Landing').locator('.pc-sub')).toHaveText('No header or footer');
    await crow(page, 'Gallery').locator('.pg-gear').click();
    const panel = card(page).locator('#pageSettings');
    await panel.getByLabel('Show the header').uncheck();
    await expect.poll(() => pageIn(pagesWrites(writes).at(-1), 'gallery')).toMatchObject({ noHeader: true });
    expect(pageIn(pagesWrites(writes).at(-1), 'gallery')).not.toHaveProperty('noFooter');
    await panel.getByLabel('Show the footer').uncheck();
    await expect.poll(() => pagesWrites(writes).length).toBe(2);
    expect(pageIn(pagesWrites(writes).at(-1), 'gallery')).toMatchObject({ noHeader: true, noFooter: true });
    await panel.getByLabel('Show the header').check();
    await expect.poll(() => pagesWrites(writes).length).toBe(3);
    expect(pageIn(pagesWrites(writes).at(-1), 'gallery')).not.toHaveProperty('noHeader');
    await card(page).locator('#pcBack').click();
    await expect(crow(page, 'Gallery').locator('.pc-sub')).toHaveText('No footer');
  });

  test('Undo takes back a Private pick', async ({ page }) => {
    const writes = await mount(page);
    const panel = await openSettings(page, 'Gallery');
    await accessCard(panel, 'Private').click();
    await expect.poll(() => pageIn(pagesWrites(writes).at(-1), 'gallery')?.access).toBe('private');
    await page.locator('#btnUndo').click();
    await expect.poll(() => pagesWrites(writes).length).toBe(2);
    expect(pageIn(pagesWrites(writes).at(-1), 'gallery')).not.toHaveProperty('access');
  });

  test('the template’s own pages stay open to everyone, with both, and say why', async ({ page }) => {
    await mount(page);
    const panel = await openSettings(page, 'FAQ');
    await expect(panel.locator('.pg-acc')).toHaveCount(0);
    await expect(panel.getByLabel('Show the header')).toHaveCount(0);
    await expect(panel.locator('.dc-modal-sub').first()).toContainText('always open to everyone, with your header and footer');
    await expect(panel.getByLabel('Show in the menu')).toBeChecked();
  });
});

// ── the visitor's side: a sealed page's password box, in each browser ──
const PAGE_DRAWN = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Gallery — Marlow’s Kitchen</title>\n<meta name="description" content="The members gallery.">\n<style>:root{--ink:#1c2430;--accent:#23635a;--line:#e2e4e1;--card:#fff}</style>\n</head>\n<body>\n<a class="skip" href="#main">Skip to main content</a>\n<header class="site"><div class="wrap"><a class="brand" href="/">Marlow’s Kitchen</a></div></header>\n<main id="main">\n<h1>Members gallery</h1><p id="secret">The secret recipe is love.</p>\n</main>\n<footer class="site"><div class="wrap">© Marlow’s Kitchen</div></footer>\n</body>\n</html>';
test.describe('a password page on the live site (builder items 48 and 120)', () => {
  test('the box opens the page with the right password only, and remembers it for the visit', async ({ page }) => {
    const lock = await newPageLock('open sesame');
    const gate = gatePage(PAGE_DRAWN, await sealPage(PAGE_DRAWN, lock.key), lock, { title: 'Gallery' });
    await page.route('**/zz-sealed/', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: gate }));
    await page.goto('/zz-sealed/');
    await expect(page.getByRole('heading', { name: 'This page needs a password' })).toBeVisible();
    await expect(page.locator('header.site')).toContainText('Marlow’s Kitchen');
    await expect(page.locator('footer.site')).toBeVisible();
    expect(await page.content()).not.toContain('secret recipe');
    await page.getByLabel('Password').fill('open sesam');
    await page.getByRole('button', { name: 'Open the page' }).click();
    await expect(page.getByRole('alert')).toHaveText('That password isn’t right. Try again.', { timeout: 15_000 });
    await expect(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('Password').fill('  open sesame ');
    await page.getByLabel('Password').press('Enter');
    await expect(page.locator('#secret')).toHaveText('The secret recipe is love.', { timeout: 15_000 });
    await expect(page).toHaveTitle('Gallery — Marlow’s Kitchen');
    await expect(page.getByRole('heading', { name: 'This page needs a password' })).toHaveCount(0);
    // back to it in the same visit: no second ask
    await page.reload();
    await expect(page.locator('#secret')).toHaveText('The secret recipe is love.', { timeout: 15_000 });
  });
});
