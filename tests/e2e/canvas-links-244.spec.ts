import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, settled, pressButton } from './helpers/app';

// A link or a form on the editor's canvas never loads another page into it (builder list item 244,
// Nov 2026). In Edit mode, pressing the business name in the header took the canvas to the
// editor's own address, on every device, and so did a section's button, a footer link and a
// form's Send. Preview and Timewarp already held them; now every mode does, from the moment a
// page is in the canvas rather than once it has loaded. Presses keep their editing meaning: the
// header's name and links don't open its card, the menu opens Pages.
const BLOCKS = [{ type: 'title', title: 'Fresh bread, every morning', subtitle: 'Baked in Burbank' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}header.site{background:#fff;padding:18px 24px;display:flex;justify-content:space-between}section{padding:48px 24px;min-height:300px;text-align:center}footer.site{background:#201b17;color:#fff;padding:40px 24px;text-align:center}footer.site a{color:#fff}</style></head><body>'
  + '<header class="site"><div class="wrap nav"><a class="brand" href="/">Marlow’s Kitchen</a><nav class="primary" aria-label="Main"><ul><li><a href="/">Home</a></li><li><a href="/about/">About</a></li></ul></nav></div></header>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1><p><a class="btn" href="/book/">Book a table</a></p></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Fresh bread, every morning</h2>'
  + '<form action="/thanks/" method="get"><label>Email <input name="email" value="sam@example.com"></label> <button type="submit">Send</button></form></section></main>'
  + '<footer class="site"><div class="wrap"><h2>Marlow’s Kitchen</h2><p><a class="privacy" href="/privacy/">Privacy</a></p></div></footer></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/settings': { data: { blocks: BLOCKS, section_meta: META } },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
const frame = (page: Page) => page.frameLocator('#designPreview');

async function mount(page: Page) {
  await installApp(page, { api: API });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(frame(page).locator('#dds-dc-bar')).toBeAttached();
  await settled(page);
  // every page the canvas frame goes to from here on
  const went: string[] = [];
  page.on('framenavigated', (f) => { if (f !== page.mainFrame()) went.push(f.url()); });
  // what the browser does with each press on a link or a form, once every handler has had it:
  // the frame's own window hears it last, so a press nothing held back is one the browser follows
  await page.evaluate(() => {
    const w = (document.getElementById('designPreview') as HTMLIFrameElement).contentWindow as Window & { __presses?: Array<{ on: string; follows: boolean }> };
    w.__presses = [];
    w.addEventListener('click', (e) => { const a = (e.target as Element).closest?.('a[href]'); if (a) w.__presses!.push({ on: a.textContent!.trim(), follows: !e.defaultPrevented }); });
    w.addEventListener('submit', (e) => { w.__presses!.push({ on: 'the form', follows: !e.defaultPrevented }); });
  });
  const presses = () => page.evaluate(() => ((document.getElementById('designPreview') as HTMLIFrameElement).contentWindow as Window & { __presses?: unknown[] }).__presses || null);
  return { went, presses };
}

test.describe('a link on the canvas never loads another page into it (builder item 244)', () => {
  test('pressing the business name in the header leaves the canvas on the draft', async ({ page }) => {
    const { went, presses } = await mount(page);
    await pressButton(frame(page).locator('header.site a.brand'));
    await expect.poll(presses).toEqual([{ on: 'Marlow’s Kitchen', follows: false }]);
    await settled(page);
    expect(went).toEqual([]);
    await expect(frame(page).locator('#a h2')).toHaveText('Fresh bread, every morning');   // still the draft, still editable
    await expect(frame(page).locator('#dds-dc-bar')).toBeAttached();
    await expect(page.locator('#settingsPanel')).not.toHaveClass(/\bon\b/);   // the name doesn't open the header's card
  });

  test('a section’s button, a footer link and a form’s Send don’t either, pressed twice (a tap picks the section first)', async ({ page }) => {
    const { went, presses } = await mount(page);
    for (const target of [frame(page).locator('section.hero a.btn'), frame(page).locator('footer.site a.privacy'), frame(page).getByRole('button', { name: 'Send' })]) {
      await pressButton(target);
      await settled(page);
      await pressButton(target);
      await settled(page);
    }
    const all = (await presses()) as Array<{ on: string; follows: boolean }>;
    expect(all.filter((p) => p.follows)).toEqual([]);
    expect(all.map((p) => p.on)).toEqual(expect.arrayContaining(['Book a table', 'Privacy']));
    expect(went).toEqual([]);
    await expect(frame(page).locator('#a h2')).toHaveText('Fresh bread, every morning');
  });

  test('a press the moment the canvas is drawn again, with a photo still coming, doesn’t either', async ({ page }) => {
    const { went } = await mount(page);
    // Every save draws the canvas again. The new page can be pressed as soon as it's there, but its
    // load (when the editor's own tools come) waits for its photos, and the guard used to wait with
    // them: on a slow connection a press in that moment loaded another page. Here a photo never comes.
    await page.route('**/photo-still-coming.jpg', () => { /* never answered: the page never loads */ });
    await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML.replace('<h1>', '<img src="/photo-still-coming.jpg" width="48" height="48" alt=""><h1>') }));
    await page.evaluate(() => (window as unknown as { refreshDesignPreview: () => void }).refreshDesignPreview());
    await expect(frame(page).locator('img[src="/photo-still-coming.jpg"]')).toBeAttached();
    expect(await frame(page).locator('html').evaluate(() => document.readyState)).not.toBe('complete');
    await page.evaluate(() => {   // the new page's own window hears the press last; kept on the editor's side
      const w = (document.getElementById('designPreview') as HTMLIFrameElement).contentWindow!;
      const top = window as unknown as { __follows?: boolean[] };
      w.addEventListener('click', (e) => { top.__follows = [...(top.__follows || []), !e.defaultPrevented]; });
    });
    await pressButton(frame(page).locator('header.site a.brand'));
    await expect.poll(() => page.evaluate(() => (window as unknown as { __follows?: boolean[] }).__follows)).toEqual([false]);
    await settled(page);
    expect(went.filter((u) => u !== 'about:srcdoc')).toEqual([]);   // the redraw is the only page the canvas took
    await expect(frame(page).locator('#a h2')).toHaveText('Fresh bread, every morning');
  });

  test('the menu still opens the Pages card, and the canvas stays', async ({ page }) => {
    const { went } = await mount(page);
    await pressButton(frame(page).locator('header nav.primary a', { hasText: 'About' }));
    await expect(page.locator('#pagesCard')).toHaveClass(/\bon\b/);
    await settled(page);
    expect(went).toEqual([]);
    await expect(frame(page).locator('#a h2')).toHaveText('Fresh bread, every morning');
  });
});
