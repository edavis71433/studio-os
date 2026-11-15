import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 216 (Nov 12 review, file 01, findings 2 and 3; Figma 377:1623, 379:1650, 380:1677).
// · Add a page is one dialog: a name, and a picture of every ready-made page grouped by what the
//   page is for (Introduce, Sell, Show, Home pages), Blank page on top. Picking one names the page
//   until a name is typed; adding saves it as any new page is saved.
// · The studio sees its own saved pages on top, each pictured by its sections' pictures, and what
//   comes across before adding one (POST /pages/from-saved). Rename and Remove from studio.
// · ★ Save to your studio… in a page's ⋯ menu (the studio only): its name and what it is for.
// · A client sees neither studio part. On a phone the dialog is a sheet with the groups as chips.
const BLOCKS = [{ type: 'title', title: 'Your heading', subtitle: 'A quiet sub line' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><style>section{padding:48px 24px}.block{min-height:300px}</style></head><body>'
  + '<header><b>Marlow’s Kitchen</b></header><main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Your heading</h2></section></main></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const READY = {
  groups: [
    { key: 'introduce', name: 'Introduce', line: 'Pages that tell people who you are.' },
    { key: 'sell', name: 'Sell', line: 'Pages that turn visitors into customers.' },
    { key: 'show', name: 'Show', line: 'Pages that prove you are good at what you do.' },
    { key: 'home', name: 'Home pages', line: 'Whole front pages, laid out for a kind of business.' },
  ],
  pages: [
    { key: 'about_us', name: 'About us', group: 'introduce', title: 'About us', slug: 'about-us', description: 'Your story.', blocks: [{ type: 'title', title: 'About us' }, { type: 'richtext', title: 'Our story', body: 'Words' }] },
    { key: 'services', name: 'Services', group: 'sell', title: 'Services', slug: 'our-services', description: 'What you offer, each with a price and a way to book.', blocks: [{ type: 'title', title: 'Our services' }, { type: 'cards', id: 'services', title: 'What we offer', cards: [{ heading: 'One' }] }, { type: 'cta', text: 'Book' }] },
    { key: 'gallery', name: 'Gallery', group: 'show', title: 'Gallery', slug: 'gallery', description: 'Your best photos.', blocks: [{ type: 'title', title: 'Our work' }, { type: 'gallery', title: 'Recent work', image_ids: [] }] },
    { key: 'generic', name: 'Simple business', group: 'home', title: 'Welcome', slug: 'welcome', description: 'A calm home page.', blocks: [{ type: 'richtext', title: 'Welcome', body: 'Hi' }] },
    { key: 'restaurant', name: 'Restaurant & cafe', group: 'home', title: 'Welcome', slug: 'welcome', description: 'For food places.', blocks: [{ type: 'richtext', title: 'Welcome', body: 'Hi' }] },
  ],
  recommended: 'restaurant',
};
const SAVED = [
  { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Salon services', purpose: 'sell', from_name: 'Bella Hair Studio', created_at: '2026-11-12T10:00:00Z', outline: ['title', 'cards', 'pricing', 'accordion', 'cta'], summary: { sections: 5, photos: 3 } },
  { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', name: 'Meet the team', purpose: 'introduce', from_name: 'Harbor Dental', created_at: '2026-10-21T10:00:00Z', outline: ['title', 'team'], summary: { sections: 2, photos: 0 } },
];
const ctx = (studio: boolean) => ({ data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: studio, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null, ...(studio ? { scope: { site_id: 's1', name: 'Marlow’s Kitchen' } } : {}) } });
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen', description: 'Hello' }, location: { city: 'Burbank' } } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 1, first_publish: false, changes: [{ section: 'business', sentence: 'x' }], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: { accent: '#111111' }, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/pages/ready': { data: READY },
};
type Write = { method: string; path: string; body: any };
type Seen = { reads: string[]; writes: Write[] };
async function mount(page: Page, opts: { studio?: boolean; saved?: unknown[]; pages?: unknown[] } = {}): Promise<Seen> {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META, pages: opts.pages || [{ slug: 'menu-page', title: 'Lunch', blocks: [{ type: 'richtext', title: 'Lunch', body: 'Soup' }] }] };
  await installApp(page, { api: { ...API, '/portal/context': ctx(!!opts.studio), '/settings': { data: settings }, '/agency/pages': { data: opts.saved || SAVED, available: true, can_manage: true } } });
  const seen: Seen = { reads: [], writes: [] };
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    if (req.method() === 'GET') { seen.reads.push(path); return route.fallback(); }
    const body = req.postData() ? req.postDataJSON() : null;
    seen.writes.push({ method: req.method(), path, body });
    if (path === '/settings') { settings = { ...settings, ...body }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) }); }
    if (path === '/pages/from-saved') {
      const pages = [...(settings.pages as unknown[]), { slug: body.slug, title: body.title, blocks: [{ type: 'title', title: 'Marlow’s Kitchen services' }] }];
      settings = { ...settings, pages };
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { slug: body.slug, title: body.title, pages, nav: null, sections: 1, photos: 3, photos_failed: 0, recorded: true } }) });
    }
    if (path === '/agency/pages') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'new', ...body } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true, ...body } }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.route('**/thumbs/**', (route: Route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="440" height="460"><rect width="440" height="460" fill="#ddd"/></svg>' }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return seen;
}
const isPhone = (page: Page) => page.viewportSize()!.width <= 620;
const openCard = async (page: Page) => { const sw = page.locator('#dcPageSwitch'); if ((await sw.getAttribute('aria-expanded')) !== 'true') await sw.click(); await expect(page.locator('#pagesCard')).toBeVisible(); };
async function openAdd(page: Page) {
  await openCard(page);
  await page.locator('#pagesCard .page-add').click();
  const dlg = page.getByRole('dialog', { name: 'Add a page' });
  await expect(dlg).toBeVisible();
  return dlg;
}
const card = (page: Page, name: string) => page.locator('dialog.ap-dlg .ap-card').filter({ has: page.locator('.ap-cn', { hasText: new RegExp(`^${name}$`) }) });
const lastWrite = (seen: Seen, path: string) => seen.writes.filter((w) => w.path === path).at(-1);

test.describe('Add a page with pictures by purpose (item 216)', () => {
  test('every ready-made page as a picture, grouped by what it is for, and one added by name @layout', async ({ page }) => {
    const seen = await mount(page);
    const dlg = await openAdd(page);
    if (isPhone(page)) {
      await expect(dlg.locator('.ap-nav')).toBeHidden();
      await expect(dlg.locator('.ap-chip')).toHaveText(['Blank', 'Introduce', 'Sell', 'Show', 'Home']);
      const box = await dlg.boundingBox(), vh = page.viewportSize()!.height;
      expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(vh - 2);   // a sheet, from the bottom
    } else {
      await expect(dlg.locator('.ap-gl')).toHaveText(['Introduce', 'Sell', 'Show', 'Home pages']);
      await expect(dlg.locator('.ap-nav').getByRole('button', { name: 'Services', exact: true })).toBeVisible();
      await expect(dlg.locator('.ap-nav').getByRole('button', { name: '2 home pages' })).toBeVisible();
    }
    await expect(dlg.locator('.ap-gh')).toHaveText(['Introduce', 'Sell', 'Show', 'Home pages']);
    await expect(card(page, 'Services').locator('img')).toHaveAttribute('src', '/thumbs/pages/services.jpg');
    // the home layout this business suits leads its group
    await expect(dlg.locator('[data-group="home"] .ap-card').first()).toContainText('Restaurant & cafe');
    await expect(dlg.locator('[data-group="home"] .ap-card').first().locator('.ap-sugg')).toHaveText('Suggested');
    // nothing is picked yet, so nothing can be added
    await expect(dlg.getByRole('button', { name: 'Add the page' })).toBeDisabled();
    await card(page, 'Services').click();
    await expect(card(page, 'Services')).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, 'Services').locator('.ap-picked')).toBeVisible();
    await expect(dlg.getByPlaceholder('e.g. Services, Gallery, Pricing')).toHaveValue('Services');
    await expect(dlg.locator('.ap-line')).toContainText('Services comes in with 3 sections.');
    await dlg.getByRole('button', { name: 'Add the Services page' }).click();
    await expect(dlg).toBeHidden();
    const put = lastWrite(seen, '/settings')!.body;
    const added = put.pages.at(-1);
    expect(added.slug).toBe('our-services');   // its own address: never the template's built-in Services page
    expect(added.title).toBe('Services');
    expect(added.blocks.map((b: { type: string }) => b.type)).toEqual(['title', 'cards', 'cta']);
    expect(added.blocks[1].id).not.toBe('services');   // ids made new, as every added page's are
  });

  test('a typed name wins over the picked page’s, and Blank adds an empty page', async ({ page }) => {
    const seen = await mount(page);
    let dlg = await openAdd(page);
    await card(page, 'About us').click();
    const name = dlg.getByPlaceholder('e.g. Services, Gallery, Pricing');
    await name.fill('Our people');
    await card(page, 'Gallery').click();
    await expect(name).toHaveValue('Our people');   // typed, so it stays
    await dlg.getByRole('button', { name: 'Add the Our people page' }).click();
    expect(lastWrite(seen, '/settings')!.body.pages.at(-1).slug).toBe('our-people');
    dlg = await openAdd(page);
    await dlg.locator('.ap-nb[data-key="_blank"]:visible, .ap-chip[data-group="_blank"]:visible').first().click();
    await expect(dlg.getByRole('button', { name: 'Add the new page' })).toBeDisabled();
    await dlg.getByPlaceholder('e.g. Services, Gallery, Pricing').fill('Specials');
    await page.keyboard.press('Enter');
    await expect(dlg).toBeHidden();
    const last = lastWrite(seen, '/settings')!.body.pages.at(-1);
    expect([last.slug, last.blocks]).toEqual(['specials', []]);
  });

  test('Escape closes it and gives the focus back; nothing is saved', async ({ page }) => {
    const seen = await mount(page);
    const dlg = await openAdd(page);
    await card(page, 'Services').click();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    // back where it was: the Pages switch where a click focuses the button (its card closed for the
    // dialog), the page itself on WebKit, where a click leaves the focus where it was
    const back = await page.evaluate(() => { const a = document.activeElement; return !!a && a !== document.body && !a.closest('dialog,[aria-hidden="true"]'); });
    expect(back).toBe(true);
    if (test.info().project.name === 'desktop-chromium') await expect(page.locator('#dcPageSwitch')).toBeFocused();
    expect(seen.writes.filter((w) => w.path === '/settings')).toHaveLength(0);
  });

  test('the studio’s saved pages: pictured by their sections, what comes across, and one added', async ({ page }) => {
    const seen = await mount(page, { studio: true });
    const dlg = await openAdd(page);
    await expect(dlg.locator('[data-group="saved"] .ap-gh')).toHaveText('Saved by your studio');
    const salon = card(page, 'Salon services');
    await expect(salon.locator('.ap-stack img')).toHaveCount(5);
    await expect(salon.locator('.ap-stack img').first()).toHaveAttribute('src', '/thumbs/sections/title.jpg');
    await salon.click();
    const side = dlg.getByRole('complementary', { name: 'What comes across' });
    await expect(side).toBeVisible();
    await expect(side).toContainText('5 sections, with their words and layout');
    await expect(side).toContainText('3 photos, copied into this site’s Files');
    await expect(side).toContainText('“Bella Hair Studio” in the words becomes “Marlow’s Kitchen”');
    await expect(side).toContainText('Never: business details, hours, reviews');
    await expect(side).toContainText('Publish lists it as copied from another site');
    await expect(dlg.getByPlaceholder('e.g. Services, Gallery, Pricing')).toHaveValue('Salon services');
    await dlg.getByRole('button', { name: 'Add Salon services to this site' }).click();
    await expect(dlg).toBeHidden();
    expect(lastWrite(seen, '/pages/from-saved')!.body).toEqual({ saved_id: SAVED[0].id, title: 'Salon services', slug: 'salon-services' });
    await expect(page.locator('#pagesBar .page-pill.on .pp-name')).toHaveText('Salon services');
  });

  test('the studio renames and removes a saved page in the dialog', async ({ page }) => {
    const seen = await mount(page, { studio: true });
    const dlg = await openAdd(page);
    await card(page, 'Meet the team').click();
    const side = dlg.getByRole('complementary', { name: 'What comes across' });
    await side.getByRole('button', { name: 'Rename' }).click();
    const ask = page.locator('dialog').filter({ hasText: 'Rename this saved page' });
    await ask.locator('input').fill('Our team');
    await ask.getByRole('button', { name: 'Rename' }).click();
    await expect(card(page, 'Our team')).toBeVisible();
    expect(lastWrite(seen, `/agency/pages/${SAVED[1].id}`)).toEqual({ method: 'PATCH', path: `/agency/pages/${SAVED[1].id}`, body: { name: 'Our team' } });
    await side.getByRole('button', { name: 'Remove from studio' }).click();
    await page.locator('dialog.ask-yes').getByRole('button', { name: 'Remove' }).click();
    await expect(card(page, 'Our team')).toHaveCount(0);
    expect(seen.writes.some((w) => w.method === 'DELETE' && w.path === `/agency/pages/${SAVED[1].id}`)).toBe(true);
  });

  test('★ Save to your studio from a page’s menu: its name and what it is for', async ({ page }) => {
    const seen = await mount(page, { studio: true });
    await openCard(page);
    const row = page.locator('#pagesCard .pc-row').filter({ has: page.locator('.pp-name', { hasText: /^Lunch$/ }) });
    await row.locator('.pp-menu').click();
    await page.getByRole('button', { name: '★ Save to your studio…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Save to your studio' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel('Name')).toHaveValue('Lunch');
    await expect(dlg.getByRole('radio', { name: 'Sell' })).toHaveAttribute('aria-checked', 'true');   // a page with "menu" in it sells
    await expect(dlg).toContainText('Marlow’s Kitchen’s business details, hours, reviews and contact details never travel.');
    await dlg.getByRole('radio', { name: 'Show' }).click();
    await expect(dlg.getByRole('radio', { name: 'Sell' })).toHaveAttribute('aria-checked', 'false');
    await dlg.getByLabel('Name').fill('Lunch menu');
    await dlg.getByRole('button', { name: 'Save to studio' }).click();
    await expect(dlg).toBeHidden();
    expect(lastWrite(seen, '/agency/pages')!.body).toEqual({ site_id: 's1', slug: 'menu-page', name: 'Lunch menu', purpose: 'show' });
    await expect(page.getByText('Saved to your studio. Add it to any client’s site from Add a page.')).toBeVisible();
  });

  test('a client sees neither studio part', async ({ page }) => {
    const seen = await mount(page, { studio: false });
    await openCard(page);
    const row = page.locator('#pagesCard .pc-row').filter({ has: page.locator('.pp-name', { hasText: /^Lunch$/ }) });
    await row.locator('.pp-menu').click();
    await expect(page.getByRole('button', { name: 'Duplicate page' })).toBeVisible();
    await expect(page.getByRole('button', { name: '★ Save to your studio…' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const dlg = await openAdd(page);
    await expect(dlg.locator('[data-group="saved"]')).toHaveCount(0);
    expect(seen.reads.filter((r) => r.startsWith('/agency/pages'))).toHaveLength(0);
  });
});
