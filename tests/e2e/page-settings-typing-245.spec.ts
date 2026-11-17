import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, settled, pressButton } from './helpers/app';

// A page's settings panel doesn't draw itself again under someone typing in it (builder list item
// 245, Nov 2026). It used to: the site's saved passwords are read when a password page's settings
// open, and when that read landed the "Who can see it" part was drawn again, so words typed into
// the password page's Heading vanished unsaved and the Password field lost its focus. A save
// landing (a new page name) drew the whole panel again under the next field being typed in, and
// closed a Password field just opened, with the password being typed in it; a quick press on
// Password lost its field to the page name, focused a moment after opening.
// Each test holds the read or the save on purpose, types, then lets it land.
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
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
type Own = { slug: string; title: string; blocks: unknown[]; access?: string; lock?: string };
const PAGES: Own[] = [
  { slug: 'gallery', title: 'Gallery', blocks: [] },
  { slug: 'members', title: 'Members', blocks: [], access: 'password', lock: LOCK },   // its password is this site's
  { slug: 'staff', title: 'Staff', blocks: [], access: 'password' },                   // asks for one: none set yet
];
type Write = { method: string; path: string; body: any };
// a door the test opens: what's behind it waits until then
const door = () => { let open = () => {}; const opened = new Promise<void>((r) => { open = r; }); return { opened, open: () => open() }; };

async function mount(page: Page) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META, pages: PAGES };
  await installApp(page, { api: { ...API, '/settings': { data: settings } } });
  const writes: Write[] = [];
  const held = { locks: door(), locksAnswered: false, saves: null as null | ReturnType<typeof door> };
  await page.route('**/functions/v1/presence/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/settings') {
      if (held.saves) await held.saves.opened;   // a save the test is holding lands when it lets it
      settings = { ...settings, ...body };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) });
    }
    if (path === '/page-locks') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: LOCK } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  // the site's saved passwords: read when a password page's settings open, answered when the test says
  await page.route('**/functions/v1/presence/page-locks', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await held.locks.opened;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ids: [LOCK], ready: true } }) });
    held.locksAnswered = true;
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return { writes, held };
}
const card = (page: Page) => page.locator('#pagesCard');
const crow = (page: Page, name: string) => page.locator('#pagesCard .pc-row').filter({ has: page.locator('.pp-name', { hasText: new RegExp(`^${name}$`) }) });
const panelOf = (page: Page) => card(page).locator('#pageSettings');
async function openSettings(page: Page, name: string) {
  await pressButton(page.locator('#dcPageSwitch'));
  await expect(card(page)).toHaveClass(/\bon\b/);
  await pressButton(crow(page, name).locator('.pg-gear'));
  await expect(panelOf(page)).toBeVisible();
  return panelOf(page);
}
const lastPage = (writes: Write[], slug: string) => writes.filter((w) => w.path === '/settings' && w.body.pages).at(-1)?.body.pages.find((p: Own) => p.slug === slug);
// let the held read land, and wait until the page has done what it does with it
async function letLocksLand(page: Page, held: { locks: ReturnType<typeof door>; locksAnswered: boolean }) {
  held.locks.open();
  await expect.poll(() => held.locksAnswered).toBe(true);
  await settled(page);
}

test.describe('a page’s settings keep what’s being typed (builder item 245)', () => {
  test('words typed into the password page’s Heading stay, focused, when its read lands, and save on leaving', async ({ page }) => {
    const { writes, held } = await mount(page);
    const panel = await openSettings(page, 'Members');
    await expect(panel.getByText('What the password page says')).toBeVisible();
    const heading = panel.getByLabel('Heading', { exact: true });
    await heading.fill('Members’ prices');
    await expect(heading).toBeFocused();
    await letLocksLand(page, held);
    await expect(heading).toHaveValue('Members’ prices');
    await expect(heading).toBeFocused();
    await expect(panel.locator('.pg-saved .hb-chip')).toHaveText('Password saved');   // its password is this site's: nothing to ask
    await heading.blur();
    await expect.poll(() => lastPage(writes, 'members')?.lockTitle).toBe('Members’ prices');
  });

  test('the Password field keeps its focus and what’s typed in it when the read lands, then saves', async ({ page }) => {
    const { writes, held } = await mount(page);
    const panel = await openSettings(page, 'Staff');
    const pw = panel.getByLabel('Password', { exact: true });
    await pw.fill('open sesame');
    await expect(pw).toBeFocused();
    await letLocksLand(page, held);
    await expect(pw).toHaveValue('open sesame');
    await expect(pw).toBeFocused();
    await pw.press('Enter');
    await expect.poll(() => lastPage(writes, 'staff')).toMatchObject({ access: 'password', lock: LOCK });
    expect(writes.filter((w) => w.path === '/page-locks')).toEqual([{ method: 'POST', path: '/page-locks', body: { password: 'open sesame' } }]);
  });

  test('a press on Password the moment the panel opens keeps the Password field focused', async ({ page }) => {
    await mount(page);
    await pressButton(page.locator('#dcPageSwitch'));
    await expect(card(page)).toHaveClass(/\bon\b/);
    // the gear and then Password, in one go: quicker than the panel's own first focus, a moment after it opens
    await crow(page, 'Gallery').locator('.pg-gear').evaluate((gear: HTMLElement) => {
      gear.click();
      (document.querySelector('#pageSettings .pg-acc[data-access="password"]') as HTMLElement).click();
    });
    const pw = panelOf(page).getByLabel('Password', { exact: true });
    await expect(pw).toBeVisible();
    await settled(page);
    await expect(pw).toBeFocused();
  });

  test('a new page name landing keeps the words typed in the next field, focused, and they save on leaving', async ({ page }) => {
    const { writes, held } = await mount(page);
    const panel = await openSettings(page, 'Gallery');
    await settled(page);
    held.saves = door();
    const name = panel.getByLabel('Page name', { exact: true });
    await name.fill('Photos');
    const headline = panel.locator('input[aria-label^="Search headline for "]');   // named for the page, whose name is changing
    await headline.fill('Our photos of the bakery');   // leaving the name sends it; its save is held
    await expect.poll(() => writes.filter((w) => w.path === '/settings').length).toBe(1);
    held.saves.open();
    await settled(page);
    await expect(panel.locator('.dc-modal-h')).toHaveText('Photos settings');   // the panel was drawn again
    await expect(headline).toHaveValue('Our photos of the bakery');
    await expect(headline).toBeFocused();
    await expect(panel.locator('.srp-page')).toContainText('Our photos of the bakery');   // the Google preview reads them too
    await headline.blur();
    await expect.poll(() => writes.filter((w) => w.path === '/settings' && w.body.page_seo).at(-1)?.body.page_seo['page:gallery']?.title).toBe('Our photos of the bakery');
  });

  test('choosing Password while a new page name is still saving keeps the Password field and what’s typed in it, and it saves', async ({ page }) => {
    const { writes, held } = await mount(page);
    const panel = await openSettings(page, 'Gallery');
    await settled(page);
    held.saves = door();
    await panel.getByLabel('Page name', { exact: true }).fill('Photos');
    await pressButton(panel.locator('.pg-acc[data-access="password"]'));   // leaving the name sends it; its save is held
    const pw = panel.getByLabel('Password', { exact: true });
    await expect(pw).toBeFocused();
    await pw.fill('open sesame');
    await expect.poll(() => writes.filter((w) => w.path === '/settings').length).toBe(1);
    held.saves.open();
    await settled(page);
    await expect(panel.locator('.dc-modal-h')).toHaveText('Photos settings');   // the panel was drawn again
    await expect(pw).toHaveValue('open sesame');   // the field it opened is still open, with the words in it
    await expect(pw).toBeFocused();
    await pw.press('Enter');
    await expect.poll(() => lastPage(writes, 'gallery')).toMatchObject({ title: 'Photos', access: 'password', lock: LOCK });
    expect(writes.filter((w) => w.path === '/page-locks')).toEqual([{ method: 'POST', path: '/page-locks', body: { password: 'open sesame' } }]);
    await expect(panel.locator('.pg-saved .hb-chip')).toHaveText('Password saved');
  });
});
