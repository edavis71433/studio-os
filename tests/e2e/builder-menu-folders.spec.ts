import { test, expect, Page, Route, Locator } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Folders in the menu (builder list item 48, second half, Nov 2026; Figma "A · Folders in the
// menu"): a menu heading with no page of its own, whose dropdown lists the pages put in it. Add
// one from the Pages card or the Pages tab, put pages in it by dragging or with Show under,
// rename it, and remove it (its pages move up to the top of the menu). A folder never goes
// inside another dropdown.
const BLOCKS = [{ type: 'title', title: 'Your heading', subtitle: 'A quiet sub line' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Your heading</h2></section></main></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
const OWN = [{ slug: 'gallery', title: 'Gallery', blocks: [] }, { slug: 'catering', title: 'Catering', blocks: [] }];
const FOLDER = '#f-abc123';
const MENU = [{ label: 'Home', href: '/' }, { label: 'Extras', href: FOLDER, folder: true }, { label: 'Gallery', href: '/gallery/' }, { label: 'Catering', href: '/catering/' }, { label: 'Contact', href: '/contact/' }];
type Write = { method: string; path: string; body: any };
async function mount(page: Page, nav?: unknown[], hash = '#design') {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META, pages: OWN, ...(nav ? { nav } : {}) };
  await installApp(page, { api: { ...API, '/settings': { data: settings } } });
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
  await page.goto('/presence.html' + hash);
  if (hash === '#design') {
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  }
  return writes;
}
const isPhone = (page: Page) => page.viewportSize()!.width <= 760;
const card = (page: Page) => page.locator('#pagesCard');
const openCard = async (page: Page) => { await page.locator('#dcPageSwitch').click(); await expect(card(page)).toHaveClass(/\bon\b/); };
const crow = (page: Page, name: string) => page.locator('#pagesCard .pc-row').filter({ has: page.locator('.pp-name', { hasText: new RegExp(`^${name}$`) }) });
const navWrite = (writes: Write[]) => writes.filter((w) => w.path === '/settings' && w.body.nav).at(-1)?.body.nav;
async function rect(l: Locator) { const b = await l.boundingBox(); if (!b) throw new Error('not laid out'); return b; }
async function drag(page: Page, name: string, target: Locator) {
  await page.waitForLoadState('networkidle');
  const grab = crow(page, name).locator('.pg-grab');
  await crow(page, name).evaluate((n) => n.scrollIntoView({ block: 'center' }));
  const h = await rect(grab), box = await rect(target);
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 6);
  await page.mouse.move(h.x + h.width / 2, box.y + 2, { steps: 6 });
  await expect(page.locator('#pagesCard .pg-dropline')).toHaveCount(1);
  await page.mouse.up();
}

test.describe('folders in the menu (builder item 48)', () => {
  test('+ Folder: named, added to the menu, and empty with a place to drop a page', async ({ page }) => {
    const writes = await mount(page);
    await openCard(page);
    await card(page).locator('#btnPcFolder').click();
    const pane = card(page).locator('#folderSettings');
    await expect(pane.getByRole('heading', { name: 'Add a folder' })).toBeVisible();
    await expect(pane.getByLabel('Name in the menu')).toBeFocused();
    await pane.getByRole('button', { name: 'Add to the menu' }).click();
    await expect(pane.getByRole('alert')).toHaveText('Give it a name for the menu.');
    await pane.getByLabel('Name in the menu').fill('Services');
    await pane.getByLabel('Name in the menu').press('Enter');
    await expect.poll(() => navWrite(writes)).toBeTruthy();
    const nav = navWrite(writes);
    const folder = nav.at(-1);
    expect(folder).toMatchObject({ label: 'Services', folder: true });
    expect(folder.href).toMatch(/^#f-[a-z0-9]+$/);
    expect(nav.slice(0, -1).map((x: any) => x.href)).toEqual(['/', '/services/', '/about/', '/faq/', '/updates/', '/contact/', '/gallery/', '/catering/']);   // the automatic menu became the custom one, as it was
    await expect(card(page).locator('#folderSettings')).toHaveCount(0);   // back to the list
    await expect(crow(page, 'Services').last()).toHaveAttribute('data-page', 'folder');
    await expect(crow(page, 'Services').last().locator('.pc-sub')).toHaveText('Empty folder');
    await expect(card(page).locator('#pcMenu .pg-slot')).toContainText('Drag a page here');
    await expect(card(page).locator('#pagesSub')).toHaveText(/· 1 folder$/);
  });

  test('Show under puts a page in a folder; rename it; Remove folder keeps the page where the folder was', async ({ page }) => {
    const writes = await mount(page, MENU);
    await openCard(page);
    await expect(card(page).locator('#pcMenu .pg-slot')).toHaveCount(1);
    await crow(page, 'Gallery').locator('.pg-gear').click();
    const settings = card(page).locator('#pageSettings');
    await expect(settings.getByLabel('Show under').locator('option', { hasText: 'Extras' })).toHaveCount(1);
    await settings.getByLabel('Show under').selectOption(FOLDER);
    await expect.poll(() => navWrite(writes)?.find((x: any) => x.href === FOLDER)?.children).toEqual([{ label: 'Gallery', href: '/gallery/' }]);
    expect(navWrite(writes).map((x: any) => x.href)).toEqual(['/', FOLDER, '/catering/', '/contact/']);
    await card(page).locator('#pcBack').click();
    await expect(crow(page, 'Extras').locator('.pc-sub')).toHaveText('Folder · 1 page');
    await expect(crow(page, 'Gallery')).toHaveClass(/\bchild\b/);
    await expect(crow(page, 'Gallery')).toHaveAttribute('data-parent', FOLDER);
    await expect(card(page).locator('#pcMenu .pg-slot')).toHaveCount(0);
    // its settings: the name, what's in it, Remove folder
    await crow(page, 'Extras').locator('.pg-gear').click();
    const pane = card(page).locator('#folderSettings');
    await expect(pane.getByRole('heading', { name: 'Extras folder' })).toBeVisible();
    await expect(pane.locator('.pc-note')).toHaveText('Gallery is in it.');
    await pane.getByLabel('Name in the menu').fill('Our services');
    await pane.getByLabel('Name in the menu').blur();
    await expect.poll(() => navWrite(writes)?.find((x: any) => x.href === FOLDER)?.label).toBe('Our services');
    await expect(pane.getByRole('heading', { name: 'Our services folder' })).toBeVisible();
    await pane.getByRole('button', { name: 'Remove folder' }).click();
    await expect.poll(() => navWrite(writes)?.map((x: any) => x.href)).toEqual(['/', '/gallery/', '/catering/', '/contact/']);
    expect(navWrite(writes).find((x: any) => x.href === '/gallery/')).toEqual({ label: 'Gallery', href: '/gallery/' });
    await expect(card(page).locator('#folderSettings')).toHaveCount(0);
    await expect(crow(page, 'Gallery')).not.toHaveClass(/\bchild\b/);
  });

  test('drag a page onto an empty folder’s row and it goes in', async ({ page }) => {
    test.skip(isPhone(page), 'the same pointer events; the Pages card’s finger test covers the phone');
    const writes = await mount(page, MENU);
    await openCard(page);
    await drag(page, 'Catering', card(page).locator('#pcMenu .pg-slot'));
    await expect.poll(() => navWrite(writes)?.find((x: any) => x.href === FOLDER)?.children).toEqual([{ label: 'Catering', href: '/catering/' }]);
    expect(navWrite(writes).map((x: any) => x.href)).toEqual(['/', FOLDER, '/gallery/', '/contact/']);
    await expect(crow(page, 'Catering')).toHaveAttribute('data-parent', FOLDER);
  });

  test('a folder stays on the top level: dropped among another dropdown’s pages, it lands after that dropdown', async ({ page }) => {
    test.skip(isPhone(page), 'the same pointer events; the Pages card’s finger test covers the phone');
    const writes = await mount(page, [{ label: 'Home', href: '/' }, { label: 'Later', href: '#f-later1', folder: true }, { label: 'Food', href: '#f-food01', folder: true, children: [{ label: 'Catering', href: '/catering/' }, { label: 'Gallery', href: '/gallery/' }] }, { label: 'Contact', href: '/contact/' }]);
    await openCard(page);
    await drag(page, 'Later', crow(page, 'Gallery'));
    await expect.poll(() => navWrite(writes)).toBeTruthy();
    const nav = navWrite(writes);
    expect(nav.map((x: any) => x.href)).toEqual(['/', '#f-food01', '#f-later1', '/contact/']);
    expect(nav.find((x: any) => x.href === '#f-food01').children.map((k: any) => k.href)).toEqual(['/catering/', '/gallery/']);
  });

  test('the Pages tab adds a folder the same way', async ({ page }) => {
    const writes = await mount(page, undefined, '#pages');
    await page.getByRole('button', { name: '＋ Add a folder' }).click();
    const dialog = page.locator('#folderSettings');
    await expect(dialog.getByRole('heading', { name: 'Add a folder' })).toBeVisible();
    await dialog.getByLabel('Name in the menu').fill('Services');
    await dialog.getByRole('button', { name: 'Add to the menu' }).click();
    await expect.poll(() => navWrite(writes)?.at(-1)).toMatchObject({ label: 'Services', folder: true });
    await expect(page.locator('#pagesList .pg-row[data-page="folder"]')).toContainText('Empty folder');
    await expect(page.locator('#pagesList .pg-slot')).toHaveCount(1);
  });
});
