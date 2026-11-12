import { test, expect, Page, Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 158, second part (Nov 2026; Figma "A · Right-click and keyboard shortcuts"):
// a right-click on a section opens the same actions as its tools, each with its key; a few keys
// work on the section you picked; ? (or the menu's foot) lists them. Phones and tablets keep the
// pill, and its More now holds the same list.
const BLOCKS = (lock: unknown = null) => [
  { type: 'title', title: 'Fresh bread', subtitle: 'Baked daily' },
  { type: 'richtext', title: 'Our story', body: 'Hello', ...(lock ? { lock } : {}) },
  { type: 'richtext', title: 'From the oven', body: 'Loaves' },
];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }, { sid: 'richtext', key: 'block_richtext', src_index: 1 }, { sid: 'richtext_2', key: 'block_richtext_2', src_index: 2 }], pages: {} };
const HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Draft</title><style>body{margin:0}section{padding:56px 24px;min-height:300px}</style></head><body>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" class="block block-title" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0"><h2 data-dds-field="title">Fresh bread</h2><p data-dds-field="subtitle">Baked daily</p></section>'
  + '<section id="b" class="block block-richtext" data-dds-sid="richtext" data-dds-key="block_richtext" data-dds-src="1"><h2 data-dds-field="title">Our story</h2><p>Hello</p></section>'
  + '<section id="c" class="block block-richtext" data-dds-sid="richtext_2" data-dds-key="block_richtext_2" data-dds-src="2"><h2 data-dds-field="title">From the oven</h2><p>Loaves</p></section></main></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const ctx = (studio: boolean) => ({ data: { site_role: studio ? 'agency_owner' : 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: studio, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } });
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
};
type Put = { blocks?: Array<Record<string, any>> };
type Frame = ReturnType<Page['frameLocator']>;
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function mount(page: Page, { studio = true, lock, site }: { studio?: boolean; lock?: unknown; site?: Record<string, unknown> } = {}) {
  let settings: Record<string, unknown> = { blocks: BLOCKS(lock), section_meta: META };
  await installApp(page, { api: { ...API, '/site': { data: { site: { ...SITE, ...(site || {}) }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } }, '/portal/context': ctx(studio), '/settings': { data: settings } } });
  const puts: Put[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    if (path === '/settings') { puts.push(body); settings = { ...settings, ...body }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto(studio ? '/presence.html?client=s1#design' : '/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  const frame = page.frameLocator('#designPreview');
  await expect(frame.locator('#dds-dc-bar')).toBeAttached();
  await page.waitForLoadState('networkidle');
  await expect(frame.locator('#dds-dc-bar')).toBeAttached();
  return { frame, lastBlocks: () => (puts.filter((p) => p && Array.isArray(p.blocks)).at(-1) || {}).blocks };
}
const menu = (frame: Frame) => frame.locator('#dds-dc-ctx');
const items = (frame: Frame) => frame.locator('#dds-dc-ctx [role="menuitem"] > span:not(.dc-keys)').allTextContents();
async function rightClick(frame: Frame, sel: string) {
  await frame.locator(sel + ' h2').click({ button: 'right' });
  await expect(menu(frame)).toHaveClass(/\bon\b/);
}
// a finger picks a section with a tap; the section is brought to the middle first, clear of the dock
async function tapSection(frame: Frame, sel: string) {
  await frame.locator(sel).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await frame.locator(sel + ' p').tap();
  await expect(frame.locator('#dds-dc-bar')).toHaveClass(/\bon\b/);
}
async function hover(frame: Frame, sel: string) {
  await frame.locator(sel + ' h2').hover();
  await expect(frame.locator('#dds-dc-bar')).toHaveClass(/\bon\b/);
}

test.describe('right-click on a section (builder item 158)', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop-chromium', 'a right-click and keys need a mouse and a keyboard; phones and tablets keep the pill'); });

  test('opens the section’s actions with their keys, named for the section, and Duplicate does it', async ({ page }) => {
    const { frame, lastBlocks } = await mount(page);
    await rightClick(frame, '#b');
    await expect(frame.locator('#dds-dc-ctx .dc-ctx-h')).toHaveText('Our story · Text box');
    expect(await items(frame)).toEqual(['Edit section', 'Style', 'Duplicate', 'Copy', 'Cut', 'Move up', 'Move down', 'Hide on this page', 'Lock this section', 'Delete', 'All keyboard shortcuts']);
    const dup = frame.getByRole('menuitem', { name: 'Duplicate' });
    await expect(dup.locator('kbd')).toHaveText([process.platform === 'darwin' ? '⌘' : 'Ctrl', 'D']);
    await expect(dup).toHaveAttribute('aria-keyshortcuts', process.platform === 'darwin' ? 'Meta+D' : 'Control+D');
    await expect(frame.getByRole('menuitem', { name: 'Edit section' })).toBeFocused();
    await dup.click();
    await expect(menu(frame)).not.toHaveClass(/\bon\b/);
    await expect.poll(() => (lastBlocks() || []).map((b) => b.title)).toEqual(['Fresh bread', 'Our story', 'Our story', 'From the oven']);
  });

  test('Copy, then Paste below appears and puts the copy under the section right-clicked', async ({ page }) => {
    const { frame, lastBlocks } = await mount(page);
    await rightClick(frame, '#a');
    expect(await items(frame)).not.toContain('Paste below');
    await frame.getByRole('menuitem', { name: 'Copy' }).click();
    await rightClick(frame, '#c');
    await expect(frame.getByRole('menuitem', { name: 'Paste below' })).toBeVisible();
    await frame.getByRole('menuitem', { name: 'Paste below' }).click();
    await expect.poll(() => (lastBlocks() || []).map((b) => b.title)).toEqual(['Fresh bread', 'Our story', 'From the oven', 'Fresh bread']);
  });

  test('the first section can’t move up; arrows walk the menu; Escape closes it and a press elsewhere does too', async ({ page }) => {
    const { frame } = await mount(page);
    await rightClick(frame, '#a');
    await expect(frame.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(frame.getByRole('menuitem', { name: 'Style' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(frame.getByRole('menuitem', { name: 'All keyboard shortcuts' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu(frame)).not.toHaveClass(/\bon\b/);
    await rightClick(frame, '#b');
    await page.locator('#dcDock').click({ position: { x: 4, y: 4 } });
    await expect(menu(frame)).not.toHaveClass(/\bon\b/);
  });

  test('a client’s locked section offers its words only', async ({ page }) => {
    const { frame } = await mount(page, { studio: false, lock: { id: 'lk-0123456789', words: true } });
    await rightClick(frame, '#b');
    expect(await items(frame)).toEqual(['Edit words', 'All keyboard shortcuts']);
  });

  test('a client never sees Lock', async ({ page }) => {
    const { frame } = await mount(page, { studio: false });
    await rightClick(frame, '#b');
    expect(await items(frame)).not.toContain('Lock this section');
  });

  test('All keyboard shortcuts opens the list; Done closes it', async ({ page }) => {
    const { frame } = await mount(page);
    await rightClick(frame, '#b');
    await frame.getByRole('menuitem', { name: 'All keyboard shortcuts' }).click();
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!, vw = page.viewportSize()!.width;
    expect(Math.abs(box.x + box.width / 2 - vw / 2)).toBeLessThan(4);   // in the middle of the screen, not pinned to a corner
    await expect(sheet).toContainText('The section you picked');
    await expect(sheet).toContainText('Delete it (asks first)');
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the menu and the list pass the accessibility check (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const { frame } = await mount(page);
      await rightClick(frame, '#b');
      const inFrame = await new AxeBuilder({ page }).include('#designPreview').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(inFrame.violations.filter((v) => ['serious', 'critical'].includes(v.impact || '')).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + (n.any[0]?.message || '')).join(' | ')}`)).toEqual([]);
      await page.keyboard.press('Escape');
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
      const sheet = await new AxeBuilder({ page }).include('.dck-sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(sheet.violations.filter((v) => ['serious', 'critical'].includes(v.impact || '')).map((v) => v.id)).toEqual([]);
    });
  }
});

test.describe('keys on the section you picked (builder item 158)', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop-chromium', 'keys need a keyboard'); });

  test('? opens the editor’s list, not the shell’s, from the page around it and from inside the page', async ({ page }) => {
    const { frame } = await mount(page);
    await page.keyboard.press('?');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    await expect(page.locator('.dds-keys.open')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await frame.locator('#b p').click();   // the page in focus
    await page.keyboard.press('?');
    await expect(sheet).toBeVisible();
    await page.keyboard.press('?');   // ? again puts it away
    await expect(sheet).toHaveCount(0);
  });

  test('⌘D duplicates, ⌥↓ moves down, and Delete asks first', async ({ page }) => {
    const { frame, lastBlocks } = await mount(page);
    await hover(frame, '#a');
    await page.keyboard.press(`${MOD}+d`);
    await expect.poll(() => (lastBlocks() || []).map((b) => b.title)).toEqual(['Fresh bread', 'Fresh bread', 'Our story', 'From the oven']);
    await hover(frame, '#c');
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => (lastBlocks() || []).map((b) => b.title)).toContain('From the oven');
    const order = (lastBlocks() || []).map((b) => b.title);
    expect(order.indexOf('From the oven')).toBeLessThan(order.indexOf('Our story'));
    await hover(frame, '#b');
    await page.keyboard.press('Backspace');
    const ask = page.locator('dialog[open]');
    await expect(ask).toContainText('Delete this');
    await ask.getByRole('button', { name: 'Cancel' }).click();
  });

  test('keys never fire while typing in a box', async ({ page }) => {
    const { frame, lastBlocks } = await mount(page);
    await hover(frame, '#a');
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'probe'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press(`${MOD}+d`);
    await page.keyboard.type('?');
    await expect(page.locator('#probe')).toHaveValue('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
    expect(lastBlocks()).toBeUndefined();
  });

  test('⌘Z inside the page undoes, as it does around it', async ({ page }) => {
    const { frame, lastBlocks } = await mount(page);
    await hover(frame, '#a');
    await page.keyboard.press(`${MOD}+d`);
    await expect.poll(() => (lastBlocks() || []).length).toBe(4);
    await frame.locator('#c p').click();
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => (lastBlocks() || []).length).toBe(3);
  });
});

test.describe('a finger keeps the pill; its More holds the same list (builder item 158)', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name === 'desktop-chromium', 'the touch screens'); });

  test('More: Move up and down, and Paste below once a section is copied', async ({ page }) => {
    const { frame, lastBlocks } = await mount(page);
    await tapSection(frame, '#b');
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'More' }).tap();
    const more = frame.locator('#dds-dc-more .dc-mi');
    await expect(more.filter({ hasText: 'Move up' })).toBeVisible();
    await expect(more.filter({ hasText: 'Paste below' })).toHaveCount(0);
    await more.filter({ hasText: 'Copy' }).tap();
    await tapSection(frame, '#c');
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'More' }).tap();
    await more.filter({ hasText: 'Paste below' }).tap();
    await expect.poll(() => (lastBlocks() || []).map((b) => b.title)).toEqual(['Fresh bread', 'Our story', 'From the oven', 'Our story']);
  });
});

// Figma "A · Open the draft on your phone": Preview's "On my phone" shows the private draft link
// (the one Share a draft link copies: read-only, no sign-in, 7 days) as a code a phone's camera
// opens. On a phone the button opens the link in a new tab instead.
async function shareLinkApi(page: Page, url: string) {
  const asks: Array<Record<string, unknown>> = [];
  await page.route('**/functions/v1/presence/preview/share-link', (route: Route) => {
    asks.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true, url, expires_at: '2026-11-19T12:00:00Z', ttl_seconds: 604800 } }) });
  });
  return asks;
}
const LINK = 'https://app.example.com/draft.html?s=eyJzaXRlX2lkIjoiczEifQ.0123456789abcdef';

test.describe('open the draft on your phone (builder item 158)', () => {
  test('Preview’s On my phone shows the code for the private link; Escape closes the card, not Preview', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'a phone opens the link itself (the next test)');
    await mount(page);
    const asks = await shareLinkApi(page, LINK);
    await page.evaluate(() => (window as any).openPreview('draft'));
    await expect(page.locator('#stage')).toBeVisible();
    await page.getByRole('button', { name: 'On my phone' }).click();
    const card = page.getByRole('dialog', { name: 'Open it on your phone' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('img', { name: 'A code that opens your draft on a phone' })).toBeVisible();
    await expect(card).toContainText('works until Nov 19');
    await expect(card).toContainText('not your live site');
    expect(asks).toEqual([{ capture: true, ttl_seconds: 604800 }]);
    const code = await page.evaluate((u) => (window as any).DDSQR.matrix(u).length, LINK);
    expect(code).toBeGreaterThan(20);   // qr.js drew it (the code itself is checked in tests/presence/qr_test.mjs)
    await expect(card.getByRole('button', { name: 'Copy the link' })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(page.locator('#stage')).toBeVisible();
  });

  test('the Page menu has Open on my phone… beside Share a draft link…', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'a phone opens the link itself');
    await mount(page);
    await shareLinkApi(page, LINK);
    await page.locator('#dcPageSwitch').click();
    await page.locator('#btnPageInfo').click();
    const share = page.locator('#piShareDraft'), phone = page.locator('#piOnPhone');
    await expect(phone).toHaveText('Open on my phone…');
    expect(await phone.evaluate((el) => el.previousElementSibling?.id)).toBe(await share.evaluate((el) => el.id));
    await phone.click();
    const card = page.getByRole('dialog', { name: 'Open it on your phone' });
    await expect(card.getByRole('img', { name: 'A code that opens your draft on a phone' })).toBeVisible();
    await card.getByRole('button', { name: 'Done' }).click();
    await expect(card).toHaveCount(0);
  });

  test('a link that can’t be made says why, and Try again makes it', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'the card is the computer’s');
    await mount(page);
    let n = 0;
    await page.route('**/functions/v1/presence/preview/share-link', (route: Route) => (++n === 1
      ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'no_preview', message: 'This site can’t update its preview right now.' }) })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { url: LINK, expires_at: '2026-11-19T12:00:00Z' } }) })));
    await page.evaluate(() => (window as any).openOnPhone());
    const card = page.getByRole('dialog', { name: 'Open it on your phone' });
    await expect(card.getByRole('alert')).toContainText('can’t update its preview');
    await card.getByRole('button', { name: 'Try again' }).click();
    await expect(card.getByRole('img', { name: 'A code that opens your draft on a phone' })).toBeVisible();
  });

  test('on a phone the button says Open in my browser and opens the link in a new tab', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'the phone');
    await mount(page);
    const here = new URL(page.url());
    const link = `${here.origin}/qr-draft-probe?s=tok`;
    await page.context().route('**/qr-draft-probe**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Draft</title><p>the draft</p>' }));
    await shareLinkApi(page, link);
    await page.evaluate(() => (window as any).openPreview('draft'));
    const btn = page.getByRole('button', { name: 'Open in my browser' });
    await expect(btn).toBeVisible();
    const [tab] = await Promise.all([page.waitForEvent('popup'), btn.click()]);
    await tab.waitForURL(/qr-draft-probe\?s=tok/);
    await expect(page.getByRole('dialog', { name: 'Open it on your phone' })).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the card passes the accessibility check (${scheme})`, async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-chromium', 'one device is enough for the card’s colours');
      await page.emulateMedia({ colorScheme: scheme });
      await mount(page);
      await shareLinkApi(page, LINK);
      await page.evaluate(() => (window as any).openOnPhone());
      const card = page.getByRole('dialog', { name: 'Open it on your phone' });
      await expect(card.getByRole('img')).toBeVisible();
      const r = await new AxeBuilder({ page }).include('.op-sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact || '')).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});

// Figma "A · A Coming soon page": before the first publish, Your site offers a Coming soon page
// beside Publish; while it's up the panel says so, and Publish puts the real site there.
// (What visitors see is checked in tests/presence/editor_comforts_158_two_test.mjs.)
async function soonApi(page: Page) {
  const posts: Array<Record<string, unknown>> = [];
  let up: string | null = null;
  await page.route('**/functions/v1/presence/preview/status', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { draft: { unpublished_changes: 0 }, preview: { exists: false, url: null, updated_at: null, has_password: false }, live: { published: false, last_published_at: null, summary: null, offline_since: null, password_since: null, coming_soon_since: up } } }) }));
  await page.route('**/functions/v1/presence/site/coming-soon', (r: Route) => {
    if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { coming_soon: { line: up ? 'Opening December 1 on Main Street.' : '', phone: true, email: true, list: !!up, up_at: up }, published: false, contact: { phone: '(818) 555-0147', email: 'hello@marlows.example' } } }) });
    posts.push(r.request().postDataJSON()); up = '2026-11-12T10:00:00Z';
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true, message: 'Your Coming soon page is up. Publishing puts your real site there instead.' } }) });
  });
  return posts;
}
const yourSite = (page: Page) => page.evaluate(() => { (window as any).go('today'); (window as any).openTodoPanel(); });

test.describe('a Coming soon page before the first publish (builder item 158)', () => {
  test('Your site offers it beside Publish; the sheet puts it up; then the panel says Coming soon', async ({ page }) => {
    await mount(page, { site: { netlify_site_id: 'nf-1' } });
    const posts = await soonApi(page);
    await yourSite(page);
    await expect(page.locator('#siteStatusBadge')).toHaveText('Private');
    await expect(page.locator('#siteStatusBtn')).toHaveText('Publish');
    await page.locator('#siteSoonBtn').click();
    const sheet = page.getByRole('dialog', { name: 'A Coming soon page' });
    await expect(sheet).toContainText('Visitors to your address see this until you publish your site.');
    await expect(sheet.getByRole('switch', { name: /Show the phone number/ })).toBeChecked();
    await expect(sheet).toContainText('(818) 555-0147, from Business details');
    await expect(sheet.getByRole('switch', { name: /Let people join your list/ })).not.toBeChecked();
    await expect(sheet).toContainText('Search engines are told it’s temporary');
    await sheet.getByRole('button', { name: 'Put it up' }).click();
    await expect(sheet.locator('#csLineErr')).toContainText('Write one line first');
    expect(posts).toEqual([]);
    await sheet.getByLabel('One line').fill('Opening December 1 on Main Street.');
    await sheet.getByRole('switch', { name: /Let people join your list/ }).check();
    await sheet.getByRole('button', { name: 'Put it up' }).click();
    await expect(sheet).toHaveCount(0);
    expect(posts).toEqual([{ line: 'Opening December 1 on Main Street.', phone: true, email: true, list: true }]);
    await expect(page.locator('#siteStatusBadge')).toHaveText('Coming soon');
    await expect(page.locator('#siteStatusCard')).toContainText('Visitors see your Coming soon page. Publish puts your real site there instead.');
    await expect(page.locator('#siteStatusBtn')).toHaveText('Publish my site');
    await expect(page.locator('#siteSoonBtn')).toHaveText('Change the page…');
    await page.locator('#siteSoonBtn').click();
    await expect(sheet.getByLabel('One line')).toHaveValue('Opening December 1 on Main Street.');
    await expect(sheet.getByRole('button', { name: 'Save the page' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet).toHaveCount(0);
  });

  test('a site with no address yet isn’t offered one', async ({ page }) => {
    await mount(page);
    await soonApi(page);
    await yourSite(page);
    await expect(page.locator('#siteStatusBtn')).toHaveText('Publish');
    await expect(page.locator('#siteSoonBtn')).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the sheet passes the accessibility check (${scheme})`, async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-chromium', 'one device is enough for the sheet’s colours');
      await page.emulateMedia({ colorScheme: scheme });
      await mount(page, { site: { netlify_site_id: 'nf-1' } });
      await soonApi(page);
      await yourSite(page);
      await page.locator('#siteSoonBtn').click();
      await expect(page.getByRole('dialog', { name: 'A Coming soon page' })).toBeVisible();
      const r = await new AxeBuilder({ page }).include('.cs-sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact || '')).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});
