import { test, expect, Page, Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, ALL_FEATURES } from './helpers/app';

// Builder list item 150 (Nov 2026; Figma "A · Accessibility check, with a fix list"): the editor
// reads each page of the draft as it is drawn and lists what the owner can fix, each row opening
// the card that fixes it; three ticks only a person can judge; the Publish card says how many
// are left and never waits; Site health shows the same list.
const HEAD = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Draft</title>'
  + '<style>body{margin:0;background:#f5f0e8;color:#1b1525;font:16px system-ui}section{padding:56px 24px;min-height:260px}.faint p{color:#a9a39b}.sr{position:absolute;width:1px;height:1px;overflow:hidden}</style></head><body>';
const sec = (id: string, i: number, sid: string, inner: string, cls = '') => `<section id="${id}" class="block ${cls}" data-dds-sid="${sid}" data-dds-key="block_${sid}" data-dds-src="${i}">${inner}</section>`;
const PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const home = (described = false) => HEAD + '<header><a href="/">Marlow’s Kitchen</a></header><main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + sec('a', 0, 'title', '<h2 data-dds-field="title">Fresh bread, every morning</h2><p>Baked daily</p><a href="/menu/">Click here</a>')
  + sec('b', 1, 'richtext', '<h2 data-dds-field="title">Our story</h2><p>Hello</p><span class="sr">Only for screen readers</span><img src="' + PX + '" alt="" role="presentation" width="40" height="40">')
  + sec('c', 2, 'gallery', '<h2 data-dds-field="title">From the oven</h2><img src="' + PX + '" width="40" height="40"' + (described ? ' alt="A sourdough loaf"' : '') + '><img src="' + PX + '" width="40" height="40" alt="' + (described ? 'Rye rolls' : '') + '">')
  + '</main><footer><a href="/privacy/">Privacy</a></footer></body></html>';
const ABOUT = HEAD + '<main id="main"><section class="hero" data-dds-core="hero"><h1>About</h1></section>'
  + sec('a', 0, 'richtext', '<h2 data-dds-field="title">Who we are</h2><p>Bakers</p>')
  + sec('b', 1, 'team', '<h2 data-dds-field="title">Our team</h2><p>Grey on cream</p><p>More grey</p>', 'faint') + '</main></body></html>';
const NEWPAGE = HEAD + '<main id="main"><section class="hero" data-dds-core="hero"><h1>New page</h1></section>' + sec('a', 0, 'richtext', '<h2 data-dds-field="title">Lessons</h2><p>Soon</p>') + '</main></body></html>';

const BLOCKS = [{ type: 'title', title: 'Fresh bread, every morning', subtitle: 'Baked daily' }, { type: 'richtext', title: 'Our story', body: 'Hello' }, { type: 'gallery', title: 'From the oven' }];
const PAGES = [
  { slug: 'about', title: 'About', blocks: [{ type: 'richtext', title: 'Who we are', body: 'Bakers' }, { type: 'richtext', title: 'Our team', body: 'Grey on cream' }] },
  { slug: 'new-page', title: 'New page', blocks: [{ type: 'richtext', title: 'Lessons', body: 'Soon' }] },
];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }, { sid: 'richtext', key: 'block_richtext', src_index: 1 }, { sid: 'gallery', key: 'block_gallery', src_index: 2 }], pages: {} };
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const CTX = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete'] } };
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 2, first_publish: false, changes: [{ section: 'home', sentence: 'The welcome line changed.' }, { section: 'about', sentence: 'A new team section.' }], blockers: 0, warnings: 0, draft_hash: 'h1' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/website-health': { data: { overall: 'good', headline: 'Your website is healthy', summary: 'Your website is healthy.', ok_count: 5, categories: [{ key: 'reach', checks: [{ title: 'Online 100% of the time', state: 'ok' }] }] } },
};
type Kept = { ticks: Record<string, boolean>; last: null | { at: string; fix: number; passed: number; worst: string } };

async function mount(page: Page, opts: { hash?: string; kept?: Kept; described?: () => boolean; aboutFails?: boolean; tickFails?: boolean } = {}) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, pages: PAGES, section_meta: META };
  let kept: Kept = opts.kept || { ticks: { photo_words: false, zoom: false, captions: false }, last: null };
  const saves: Array<Record<string, any>> = [], reads: string[] = [];
  await installApp(page, { api: { ...API, '/portal/context': CTX, '/settings': { data: settings } } });
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    if (path === '/site/usable') {
      if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: kept }) });
      const body = req.postDataJSON(); saves.push(body);
      if (body.ticks && opts.tickFails) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'write_failed', message: 'That didn’t save. Nothing changed; try again.' }) });
      kept = { ticks: { ...kept.ticks, ...(body.ticks || {}) }, last: body.last ? { at: new Date().toISOString(), ...body.last } : kept.last };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: kept }) });
    }
    if (req.method() === 'GET') return route.fallback();
    const body = req.postData() ? req.postDataJSON() : null;
    if (path === '/settings') { settings = { ...settings, ...body }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => {
    const at = new URL(route.request().url()).searchParams.get('page') || '/';
    reads.push(at);
    if (at === '/about/' && opts.aboutFails) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'no' }) });
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: at === '/about/' ? ABOUT : at === '/new-page/' ? NEWPAGE : home(opts.described ? opts.described() : false) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  await page.waitForLoadState('networkidle');
  return { saves, reads, kept: () => kept };
}
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Usable by everyone' });
async function openCheck(page: Page) {
  await page.evaluate(() => (window as any).openUsable());
  await expect(sheet(page).locator('#ueChips')).toBeVisible();
}
const titles = (page: Page) => sheet(page).locator('.ue-row b').allTextContents();

test.describe('Usable by everyone: the fix list (builder item 150)', () => {
  test('the Page menu opens it: what to fix on every page, worst first, each with where it is', async ({ page }, info) => {
    const { reads, saves } = await mount(page);
    if (info.project.name === 'mobile') await page.evaluate(() => (window as any).openUsable());
    else { await page.locator('#dcPageSwitch').click(); await page.locator('#btnPageInfo').click(); await page.locator('#piUsable').click(); }
    await expect(sheet(page).locator('#ueChips')).toBeVisible();
    expect(await titles(page)).toEqual(['2 photos have no description', 'Words too faint for their background', 'A page is still called “New page”', 'A button only says “Click here”']);
    expect(await sheet(page).locator('.ue-where').allTextContents()).toEqual(['Home · From the oven', 'About · Our team', 'New page', 'Home · Fresh bread, every morning']);
    await expect(sheet(page).locator('.ue-row[data-kind="faint"] .ue-why')).toHaveText(/^\d\.\d to 1 now\. Easy reading needs 4\.5 to 1\.$/);
    expect(await sheet(page).locator('#ueChips .hb-chip').allTextContents()).toEqual(['4 to fix', '3 for you to check', '14 passed']);
    await expect(sheet(page).locator('.ue-when').first()).toHaveText(/^Checked on your draft at \d{1,2}:\d\d[ap]m\. Your live site changes when you publish\.$/);
    expect(await sheet(page).getByRole('button').allTextContents()).toEqual(['Done', 'Describe them', 'Pick colours', 'Rename', 'Change words', 'Check again']);
    expect(reads.filter((r) => r === '/about/').length).toBeGreaterThan(0);
    await expect.poll(() => saves.find((s) => s.last)?.last).toEqual({ fix: 4, passed: 14, worst: '2 photos on Home have no description.' });
    await expect(page.locator('iframe.ue-frame')).toHaveCount(0);   // nothing left behind
    await sheet(page).getByRole('button', { name: 'Done' }).click();
    await expect(sheet(page)).toBeHidden();
  });

  test('a tick is kept with the site and the count follows; one that doesn’t save goes back', async ({ page }) => {
    const { saves } = await mount(page);
    await openCheck(page);
    const box = sheet(page).getByLabel('Videos have captions');
    await box.check();
    await expect.poll(() => saves.find((s) => s.ticks)?.ticks).toEqual({ captions: true });
    await expect(sheet(page).locator('#ueChips')).toContainText('2 for you to check');
    await sheet(page).getByRole('button', { name: 'Done' }).click();
    await openCheck(page);
    await expect(sheet(page).getByLabel('Videos have captions')).toBeChecked();
  });

  test('a tick that fails to save is put back and says so', async ({ page }) => {
    await mount(page, { tickFails: true });
    await openCheck(page);
    const box = sheet(page).getByLabel('The site still reads well zoomed to 200%');
    await box.click();
    await expect(box).not.toBeChecked();
    await expect(sheet(page).locator('#ueChips')).toContainText('3 for you to check');
  });

  test('Pick colours goes to the page and opens the section’s Style tab with the faint pair marked', async ({ page }) => {
    await mount(page);
    await openCheck(page);
    await sheet(page).getByRole('button', { name: /^Pick colours/ }).click();
    await expect(sheet(page)).toBeHidden();
    await expect.poll(() => page.evaluate('DC_PAGE')).toBe('about');
    await expect(page.locator('#inspectorSeg [data-itab="style"]')).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate('BLOCKS_WORK[BLOCK_SOLO].title')).toBe('Our team');
    const note = page.locator('.ue-faint');
    await expect(note).toContainText('These words are too faint on this background');
    await expect(note).toContainText(/\d\.\d to 1 now\. Any background below with a tick reads easily\./);
    const rated = page.locator('.ins-swatches.ue-rated .ins-sw[data-ratio]');
    expect(await rated.count()).toBeGreaterThan(2);
    const dark = page.locator('.ins-swatches.ue-rated .ins-sw[data-ok="1"]').first();
    await expect(dark).toHaveAttribute('aria-label', /, \d+\.\d to 1, easy to read$/);
    await dark.click();
    await expect(page.locator('.ue-faint.ok')).toContainText('These words read easily now');
    // another section's Style tab says nothing
    await page.evaluate(() => (window as any).eeEditBlock(0, 'style'));
    await expect(page.locator('.ue-faint')).toHaveCount(0);
  });

  test('Rename opens that page’s settings; Describe them and Change words open the section', async ({ page }) => {
    await mount(page);
    await openCheck(page);
    await sheet(page).getByRole('button', { name: /^Rename/ }).click();
    await expect.poll(() => page.evaluate('DC_PAGE')).toBe('new-page');
    await expect(page.getByLabel('Page name').first()).toHaveValue('New page');
    await page.keyboard.press('Escape');
    await openCheck(page);
    await sheet(page).getByRole('button', { name: /^Describe them/ }).click();
    await expect.poll(() => page.evaluate('DC_PAGE')).toBe('');
    await expect.poll(() => page.evaluate('BLOCKS_WORK[BLOCK_SOLO] && BLOCKS_WORK[BLOCK_SOLO].type')).toBe('gallery');
    await expect(page.locator('#inspectorSeg [data-itab="content"]')).toHaveAttribute('aria-selected', 'true');
    await openCheck(page);
    await sheet(page).getByRole('button', { name: /^Change words/ }).click();
    await expect.poll(() => page.evaluate('BLOCKS_WORK[BLOCK_SOLO] && BLOCKS_WORK[BLOCK_SOLO].type')).toBe('title');
  });

  test('Check again reads the draft afresh: described photos leave the list', async ({ page }) => {
    let described = false;
    await mount(page, { described: () => described });
    await openCheck(page);
    expect((await titles(page))[0]).toBe('2 photos have no description');
    described = true;
    await sheet(page).getByRole('button', { name: 'Check again' }).click();
    await expect(sheet(page).locator('#ueChips')).toContainText('3 to fix');
    expect(await titles(page)).not.toContain('2 photos have no description');
  });

  test('a page that can’t be read is said, not guessed', async ({ page }) => {
    await mount(page, { aboutFails: true });
    await openCheck(page);
    await expect(sheet(page)).toContainText('One page couldn’t be read just now. Check again in a moment.');
    expect(await titles(page)).not.toContain('Words too faint for their background');
  });

  test('the Publish card says how many are left, never waits on them, and Review opens the list', async ({ page }) => {
    await mount(page);
    await page.locator('#dcBtnPublish:visible, #btnPublish:visible, #dockPublish:visible').first().click();
    const row = page.locator('#ueRit');
    await expect(row).toContainText('Usable by everyone');
    await expect(row.locator('small')).toHaveText('4 things to fix · 3 to check yourself');
    await expect(page.locator('#ritActions .pubbtn')).toBeEnabled();
    await expect(page.locator('#ritActions .pubbtn')).toHaveText('Publish these 2 changes');
    await row.getByRole('button', { name: /^Review/ }).click();
    await expect(sheet(page).locator('#ueChips')).toContainText('4 to fix');
    await expect(page.locator('#ritualWrap')).not.toHaveClass(/\bon\b/);
  });

  test('Site health shows the same list from the last check, and opens it', async ({ page }) => {
    await mount(page, { kept: { ticks: { photo_words: false, zoom: false, captions: true }, last: { at: '2026-11-12T10:42:00.000Z', fix: 4, passed: 14, worst: '2 photos on Home have no description.' } } });
    await page.evaluate(() => (window as any).go('search'));
    const block = page.locator('#ueHealth');
    await expect(block).toContainText('Usable by everyone');
    await expect(block.locator('.hb-chip')).toHaveText('4 to fix');
    await expect(block).toContainText('Worst first: 2 photos on Home have no description.');
    await block.getByRole('button', { name: 'Open the check in the editor' }).click();
    await expect(sheet(page).locator('#ueChips')).toContainText('2 for you to check');
  });

  test('before any check, Site health offers one', async ({ page }) => {
    await mount(page);
    await page.evaluate(() => (window as any).go('search'));
    await expect(page.locator('#ueHealth')).toContainText('Not checked yet.');
    await expect(page.locator('#ueHealth').getByRole('button', { name: 'Check now' })).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the list and the marked Style tab pass the accessibility scan in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mount(page);
      await openCheck(page);
      const list = await new AxeBuilder({ page }).include('.ue-sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(list.violations.filter((v) => ['serious', 'critical'].includes(v.impact || '')).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + (n.any[0]?.message || '')).join(' | ')}`)).toEqual([]);
      await sheet(page).getByRole('button', { name: /^Pick colours/ }).click();
      await expect(page.locator('.ue-faint')).toBeVisible();
      await page.waitForTimeout(600);   // the panel fades in; a scan mid-fade reads blended colours
      const tab = await new AxeBuilder({ page }).include('.ue-faint').include('.ins-swatches.ue-rated').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(tab.violations.filter((v) => ['serious', 'critical'].includes(v.impact || '')).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + (n.any[0]?.message || '')).join(' | ')}`)).toEqual([]);
    });
  }
});
